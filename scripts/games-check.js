// The season's finished regular-season games on ESPN, checked against pbpstats' list:
// pbpstats is what the stats sheet and the play-by-play read, so a game it lacks (LAC-LAL
// 2026-10-23 for two days) or has the wrong final for (MEM-GSW that night, 108-109 for
// 111-108) is short in every stat built from it. Each such game is listed (and in the
// run's summary) and the script exits 1, so the nightly fails at its end, after its data is
// committed and deployed, and GitHub emails the repo's owner.
//
// node scripts/games-check.js 2026-27
const fs = require('fs')
const { fetchJson, sleep } = require('../lib/http')
const pbp = require('../lib/pbpstats')

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' }
const etDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const main = async () => {
  const season = process.argv[2]
  const listed = [...(await pbp.games(season)).values()]
  const byGame = new Map(listed.map(g => [`${g.Date} ${g.AwayTeamAbbreviation}@${g.HomeTeamAbbreviation}`, g]))
  const problems = []
  let finals = 0
  // ESPN's scoreboard takes one date a call (a range is a 400).
  for (let d = new Date(`${season.slice(0, 4)}-10-01T12:00:00Z`); etDate(d) <= etDate(new Date()); d.setUTCDate(d.getUTCDate() + 1)) {
    const { events = [] } = await fetchJson(`${ESPN}?dates=${etDate(d).replace(/-/g, '')}`)
    await sleep(100)
    for (const e of events.filter(e => e.season.type === 2 && e.status.type.completed)) {
      finals++
      const side = s => e.competitions[0].competitors.find(c => c.homeAway === s)
      const [home, away] = [side('home'), side('away')]
      const abbr = c => ABBR[c.team.abbreviation] || c.team.abbreviation
      const key = `${etDate(e.date)} ${abbr(away)}@${abbr(home)}`
      const g = byGame.get(key)
      if (!g) problems.push(`${key} (final ${away.score}-${home.score}): not on pbpstats`)
      else if (g.HomePoints !== +home.score || g.AwayPoints !== +away.score) {
        problems.push(`${key} ${g.GameId}: pbpstats has ${g.AwayPoints}-${g.HomePoints}, the final was ${away.score}-${home.score}`)
      }
    }
  }
  console.log(`games-check ${season}: ${finals} finished games on ESPN, ${listed.length} on pbpstats, ${problems.length} wrong`)
  for (const p of problems) console.log(`  ${p}`)
  if (problems.length && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**pbpstats is missing or wrong on ${problems.length} game(s)**; every stat built from them is short:\n\n${problems.map(p => `- ${p}`).join('\n')}\n`)
  }
  if (problems.length) process.exitCode = 1
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
