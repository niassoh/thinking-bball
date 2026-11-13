// Watches the morning's runs from the Mac and retries what they left stale, so the site has
// the night's data between 7 and 8 am Pacific and no GitHub runner is paid to sleep until a
// retry is due (docs/daily-pipeline-requirements.md). launchd runs it several times a morning
// and a few times later in the day; each run looks at today's runs and starts at most one:
// - while a run (or the Mac job) is going: nothing;
// - no run today: the Mac's 5 am job didn't happen, so it runs scripts/mac-nightly.sh now;
// - steps today's newest full run failed, less the sheet steps a later tracking run or team
//   retry redid: team-retry.yml for a short team sheet alone, else a full rerun (2 a day, and
//   none once the same step failed twice running); games-check alone isn't retried
//   (pbpstats' own data); a failed tracking-only run is rerun as one;
// - data committed today with no deploy since (its dispatch failed, or was cancelled): the
//   deploy, started from here.
// From 7:45 on it alerts (macOS, and ntfy when NTFY_TOPIC is set) while the site lacks
// today's data or a step is still stale, and when it fails itself.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO = 'niassoh/thinking-bball'
const SITE = 'niassoh/tbball'
// Reruns a day by kind; each sheet one nudges the production sheet, and a full one is ~45
// private Actions minutes.
const BUDGET = { full: 2, tracking: 2, team: 3 }
const SHEET = ['season', 'team', 'recent', 'tracking-seasons'] // what a scope=tracking run redoes
const LOCK = '/tmp/thinking-bball-nightly.lock' // held while mac-nightly.sh runs
const DRY = process.argv.includes('--dry-run') // say what it would start, start nothing

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })
const now = new Date()
const midnight = new Date(now)
midnight.setHours(0, 0, 0, 0) // local time: the Mac runs on Pacific
const minutes = now.getHours() * 60 + now.getMinutes()
const late = minutes >= 7 * 60 + 45
const hhmm = now.toTimeString().slice(0, 5)
const at = r => new Date(r.createdAt)
const runs = (wf, repo = REPO) => JSON.parse(gh('run', 'list', '-R', repo, '-w', wf, '-L', '30',
  '--json', 'databaseId,createdAt,status,conclusion,displayTitle')).filter(r => at(r) >= midnight)
const dispatch = (wf, repo, ...inputs) => {
  console.log(`${DRY ? 'would start' : 'starting'} ${wf} ${inputs.join(' ')}`)
  if (!DRY) gh('workflow', 'run', wf, '-R', repo, ...inputs.flatMap(i => ['-f', i]))
}

const notify = msg => {
  console.log(`${DRY ? 'would alert' : 'ALERT'}: ${msg}`)
  if (DRY) return
  execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "thinking-bball nightly" sound name "Basso"`])
  if (process.env.NTFY_TOPIC) {
    try {
      execFileSync('curl', ['-s', '-m', '20', '-H', 'Title: thinking-bball nightly', '-d', msg, `https://ntfy.sh/${process.env.NTFY_TOPIC}`])
    } catch (e) { console.log(`ntfy failed: ${e.message}`) }
  }
}

// A scheduled run whose gate stood down (a run already started today) never ran the job.
const ran = r => JSON.parse(gh('api', `repos/${REPO}/actions/runs/${r.databaseId}/jobs`)).jobs
  .some(j => j.name === 'nightly' && j.conclusion !== 'skipped')
const isTracking = r => /tracking$/.test(r.displayTitle) // run-name: nightly <scope>

// Steps with continue-on-error report success to the API, so failures come from the log:
// the command of each '##[group]Run' block that an '##[error]' follows.
const STEP = [[/backfill-seasons/, 'season'], [/sheets-teamcat/, 'team'], [/pull:recent/, 'recent'],
  [/tracking-seasons/, 'tracking-seasons'], [/games-check/, 'games-check'],
  [/workflow run pages\.yml/, 'deploy'], [/^exit 1$/, null]]
const failedSteps = log => {
  const failed = new Set()
  let step = 'setup'
  for (const line of log.split('\n')) {
    const group = line.match(/##\[group\]Run (.*)$/)
    if (group) step = group[1].trim()
    else if (line.includes('##[error]')) {
      const known = STEP.find(([re]) => re.test(step))
      if (!known) failed.add(step)
      else if (known[1]) failed.add(known[1])
    }
  }
  return [...failed]
}
// What a run left stale: deploys and games-check are handled elsewhere or not at all.
const staleOf = r => {
  if (r.conclusion === 'success') return []
  const steps = failedSteps(gh('run', 'view', String(r.databaseId), '-R', REPO, '--log'))
    .filter(s => s !== 'games-check' && s !== 'deploy')
  if (!steps.length && r.conclusion !== 'failure') return [r.conclusion] // cancelled, timed out
  return steps
}

// Today's data commits (the nightly's and team retries'), newest first, and the deploys since
// the first and the last of them: the site has today's data once a deploy after the first
// succeeded; a commit with no deploy after it (succeeded or under way) needs one started.
const deployState = () => {
  const commits = JSON.parse(gh('api', `repos/${REPO}/commits?sha=master&per_page=30`))
    .filter(c => /^Data: (nightly|team sheet retry)/.test(c.commit.message) && new Date(c.commit.committer.date) >= midnight)
    .map(c => new Date(c.commit.committer.date))
  if (!commits.length) return { last: null }
  const deploys = runs('pages.yml', SITE)
  const since = t => deploys.filter(r => at(r) >= t)
  return {
    last: commits[0],
    lastDeployed: since(commits[0]).some(r => r.conclusion === 'success' || r.status !== 'completed'),
    today: since(commits.at(-1)).some(r => r.conclusion === 'success')
  }
}

const main = () => {
  console.log(`== ${now} (supervise)`)
  const d = deployState()
  const alerts = []
  if (late && !d.today) alerts.push(d.last ? 'today\'s data is committed but not deployed yet' : 'no data committed today yet')

  const nightly = runs('nightly.yml')
  const teamRetries = runs('team-retry.yml')
  const busy = [...nightly, ...teamRetries].some(r => r.status !== 'completed') || fs.existsSync(LOCK)

  if (busy) console.log('a run is in progress')
  else if (d.last && !d.lastDeployed && now - d.last > 10 * 60000) dispatch('pages.yml', SITE)
  else {
    const real = nightly.filter(ran) // newest first
    const full = real.filter(r => !isTracking(r))
    if (!full.length) {
      if (minutes < 12 * 60) {
        console.log(`no run today: ${DRY ? 'would run' : 'running'} the Mac job now`)
        if (!DRY) execFileSync('zsh', [path.join(__dirname, 'mac-nightly.sh')], { stdio: 'inherit' })
      } else alerts.push('no nightly run today')
    } else {
      // The newest full run's failures, less the sheet steps a later run redid.
      const after = r => at(r) > at(full[0])
      let stale = staleOf(full[0])
      for (const r of real.filter(r => isTracking(r) && after(r) && r.conclusion === 'success')) stale = stale.filter(s => !SHEET.includes(s))
      if (teamRetries.some(r => after(r) && r.conclusion === 'success')) stale = stale.filter(s => s !== 'team')
      const tracking = real.find(r => isTracking(r) && after(r))
      const trackingStale = tracking ? staleOf(tracking).filter(s => SHEET.includes(s) && !stale.includes(s)) : []
      const used = {
        full: full.length - 1,
        tracking: real.filter(r => isTracking(r)).length - 1, // the 7 am top-up is the first
        team: teamRetries.length
      }
      const stuck = full.length >= 2 && staleOf(full[1]).some(s => !SHEET.includes(s) && stale.includes(s))
      if (stale.length) {
        console.log(`run ${full[0].databaseId} left stale: ${stale.join(', ')}`)
        const kind = stale.every(s => s === 'team') ? 'team' : 'full'
        if (kind === 'full' && stuck) alerts.push(`${stale.join(', ')} failed twice running; not retrying today`)
        else if (used[kind] >= BUDGET[kind]) alerts.push(`out of ${kind} retries; still stale: ${stale.join(', ')}`)
        else {
          if (kind === 'team') dispatch('team-retry.yml', REPO, 'wait=0', 'tries=1')
          else dispatch('nightly.yml', REPO, 'scope=all')
          alerts.push(`still stale: ${stale.join(', ')}; retrying`)
        }
      } else if (trackingStale.length && used.tracking < BUDGET.tracking) {
        // The 5 am data stands; only the top-up's refresh failed, so no alert.
        console.log(`the tracking run left stale: ${trackingStale.join(', ')}`)
        dispatch('nightly.yml', REPO, 'scope=tracking')
      } else console.log(d.today ? 'site is up to date' : 'waiting on the deploy')
    }
  }
  if (late && alerts.length) notify(`${hhmm}: ${alerts.join('; ')}.`)
}

if (require.main === module) {
  try { main() } catch (e) {
    console.log(e.stack)
    if (late) notify(`${hhmm}: the supervisor failed (${e.message.split('\n')[0]}); see the log.`)
  }
}
module.exports = { failedSteps, main }
