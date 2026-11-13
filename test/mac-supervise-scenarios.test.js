// What mac-supervise.js starts or alerts on in a given morning, with gh, osascript, zsh and the
// clock stubbed (no network, nothing dispatched).
const test = require('node:test')
const assert = require('node:assert')
const cp = require('child_process')
const fs = require('fs')
const path = require('path')
const SCRIPT = path.join(__dirname, '..', 'scripts', 'mac-supervise.js')
const RealDate = Date
const T = hm => `2026-11-12T${String(+hm.split(':')[0] + 8).padStart(2, '0')}:${hm.split(':')[1]}:00Z` // PST -> UTC
const logOf = steps => steps.map(s => `nightly\tx\t2026 ##[group]Run ${s.cmd}\n` + (s.err ? 'nightly\tx\t2026 ##[error]Process completed with exit code 1.\n' : '')).join('')
const CMD = { season: 'node scripts/backfill-seasons.js "$SEASON"', team: 'node sheets-teamcat.js --season="$SEASON"', games: 'npm run pull:games', lineups: 'npm run pull:lineups', deploy: 'gh workflow run pages.yml -R niassoh/tbball' }
const failLog = (...names) => logOf([...names.map(n => ({ cmd: CMD[n], err: true })), { cmd: 'exit 1', err: true }])

const sim = (name, { clock, nightly = [], team = [], pages = [], commits = [], lock = false }, expect) => test(`mac-supervise at ${name}`, () => {
  const calls = []
  global.Date = class extends RealDate { constructor (...a) { super(...(a.length ? a : [T(clock)])) } static now () { return new RealDate(T(clock)).getTime() } }
  cp.execFileSync = (cmd, args) => {
    if (cmd === 'osascript') { calls.push('ALERT'); return '' }
    if (cmd === 'curl') return ''
    if (cmd === 'zsh') { calls.push('mac-nightly'); return '' }
    const a = args.join(' ')
    if (a.startsWith('run list') && a.includes('nightly.yml')) return JSON.stringify(nightly.map(r => ({ ...r, createdAt: T(r.at) })))
    if (a.startsWith('run list') && a.includes('team-retry.yml')) return JSON.stringify(team.map(r => ({ ...r, createdAt: T(r.at) })))
    if (a.startsWith('run list') && a.includes('pages.yml')) return JSON.stringify(pages.map(r => ({ ...r, createdAt: T(r.at) })))
    if (a.includes('/commits')) return JSON.stringify(commits.map(c => ({ commit: { message: 'Data: nightly 2026-11-12', committer: { date: T(c) } } })))
    if (a.includes('/jobs')) return JSON.stringify({ jobs: [{ name: 'nightly', conclusion: 'success' }] })
    if (a.startsWith('run view')) return nightly.find(r => a.includes(String(r.databaseId))).log || ''
    if (a.startsWith('workflow run')) { calls.push(a.replace(/ -R \S+/, '')); return '' }
    throw new Error('unstubbed gh ' + a)
  }
  const exists = fs.existsSync; fs.existsSync = p => p.includes('nightly.lock') ? lock : exists(p)
  delete require.cache[SCRIPT]
  const log = console.log; console.log = () => {}
  try { require(SCRIPT).main() } finally { console.log = log; fs.existsSync = exists; global.Date = RealDate }
  assert.deepStrictEqual(calls, expect)
})
const run = (id, at, conclusion, log, title = 'nightly all') => ({ databaseId: id, at, status: 'completed', conclusion, log, displayTitle: title })
const ok = (at, id = 1) => run(id, at, 'success', '')

sim('6:00 season hung at 5 -> full rerun', { clock: '6:00', nightly: [run(1, '5:03', 'failure', failLog('season'))], commits: ['5:50'], pages: [{ at: '5:51', status: 'completed', conclusion: 'success' }] }, ['workflow run nightly.yml -f scope=all'])
sim('6:00 team short alone -> team-retry', { clock: '6:00', nightly: [run(1, '5:03', 'failure', failLog('team'))], commits: ['5:50'], pages: [{ at: '5:51', status: 'completed', conclusion: 'success' }] }, ['workflow run team-retry.yml -f wait=0 -f tries=1'])
sim('7:25 team fixed by a team retry -> nothing', { clock: '7:25', nightly: [run(1, '5:03', 'failure', failLog('team'))], team: [{ at: '6:00', status: 'completed', conclusion: 'success' }], commits: ['6:10', '5:50'], pages: [{ at: '6:11', status: 'completed', conclusion: 'success' }] }, [])
sim('7:50 lineups failed, later tracking run ok -> still a full rerun + alert', { clock: '7:50', nightly: [run(2, '7:03', 'success', '', 'nightly tracking'), run(1, '5:03', 'failure', failLog('lineups'))], commits: ['7:15', '5:50'], pages: [{ at: '7:16', status: 'completed', conclusion: 'success' }, { at: '5:51', status: 'completed', conclusion: 'success' }] }, ['workflow run nightly.yml -f scope=all', 'ALERT'])
sim('7:50 season failed, later tracking run redid it -> nothing', { clock: '7:50', nightly: [run(2, '7:03', 'success', '', 'nightly tracking'), run(1, '5:03', 'failure', failLog('season'))], commits: ['7:15', '5:50'], pages: [{ at: '7:16', status: 'completed', conclusion: 'success' }, { at: '5:51', status: 'completed', conclusion: 'success' }] }, [])
sim('7:50 5am ok, tracking top-up failed season -> tracking rerun, no alert', { clock: '7:50', nightly: [run(2, '7:03', 'failure', failLog('season'), 'nightly tracking'), ok('5:03')], commits: ['5:50'], pages: [{ at: '5:51', status: 'completed', conclusion: 'success' }] }, ['workflow run nightly.yml -f scope=tracking'])
sim('7:50 games failed twice running -> alert, no rerun', { clock: '7:50', nightly: [run(2, '6:00', 'failure', failLog('games')), run(1, '5:03', 'failure', failLog('games'))], commits: ['6:45', '5:50'], pages: [{ at: '6:46', status: 'completed', conclusion: 'success' }] }, ['ALERT'])
sim('7:50 a run still going and nothing deployed today -> alert only', { clock: '7:50', nightly: [{ ...run(1, '6:57', ''), status: 'in_progress' }] }, ['ALERT'])
sim('7:25 data committed 30 min ago, its deploy failed -> deploy from the Mac', { clock: '7:25', nightly: [ok('5:03')], commits: ['6:55'], pages: [{ at: '6:56', status: 'completed', conclusion: 'failure' }] }, ['workflow run pages.yml'])
sim('6:00 deploy dispatch failed in the run -> deploy, not a rerun', { clock: '6:00', nightly: [run(1, '5:03', 'failure', failLog('deploy'))], commits: ['5:45'] }, ['workflow run pages.yml'])
sim('6:00 no run today -> the Mac job', { clock: '6:00' }, ['mac-nightly'])
sim('6:00 no run today but the Mac job holds the lock -> nothing', { clock: '6:00', lock: true }, [])
sim('16:00 two full reruns used, still failing lineups -> alert out of retries', { clock: '16:00', nightly: [run(3, '10:00', 'failure', failLog('lineups', 'team')), run(2, '6:00', 'failure', failLog('season')), run(1, '5:03', 'failure', failLog('season'))], commits: ['10:40'], pages: [{ at: '10:41', status: 'completed', conclusion: 'success' }] }, ['ALERT'])
