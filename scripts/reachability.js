// Which sources answer from this machine: one request to each, its HTTP status or why it
// failed, printed (and added to the GitHub job summary in the nightly run). NBA.com is
// known to drop requests from cloud machines; this is how the nightly log shows it. (Its
// cdn.nba.com liveData files refuse any non-browser client, from anywhere: not probed.)
// Read-only; always exits 0.
//   node scripts/reachability.js
const fs = require('fs')
const { NBA_HEADERS } = require('../lib/http')

const SEASON = process.env.SEASON || '2026-27'
const GAME = `002${SEASON.slice(2, 4)}00001`
const TRACKING = 'College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&Height=&LastNGames=0&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=Totals&PlayerExperience=&PlayerOrTeam=Player&PlayerPosition=&PtMeasureType=Drives&SeasonSegment=&SeasonType=Regular%20Season&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight='
const PROBES = [
  ['stats.nba.com play-by-play', `https://stats.nba.com/stats/playbyplayv3?GameID=${GAME}&StartPeriod=0&EndPeriod=0`, NBA_HEADERS],
  ['stats.nba.com tracking', `https://stats.nba.com/stats/leaguedashptstats?${TRACKING}&Season=${SEASON}`, NBA_HEADERS],
  ['pbpstats', `https://api.pbpstats.com/get-games/nba?Season=${SEASON}&SeasonType=Regular%20Season`],
  ['ESPN', 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'],
  ['Google Sheets', 'https://sheets.googleapis.com/$discovery/rest?version=v4']
]

const probe = async ([name, url, headers]) => {
  const start = Date.now()
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    await res.body?.cancel()
    return `| ${name} | ${res.status} in ${Date.now() - start} ms |`
  } catch (err) {
    return `| ${name} | **no answer**: ${err.cause ? err.cause.code || err.cause.message : err.name} after ${Date.now() - start} ms |`
  }
}

Promise.all(PROBES.map(probe)).then(rows => {
  const table = ['| Source | Answer |', '|---|---|', ...rows].join('\n')
  console.log(table)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Reachability\n\n${table}\n\n`)
})
