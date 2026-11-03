// Each team's playoff run, season by season, from NBA.com's playoff game log ->
// data/team-playoffs.json, which the Team board's documents carry (lib/teamboard.js) for
// the team card's trophies. A game id is 004YY00RSG (R the round, S the series, G the
// game), so a team's games by round are its series: the opponent and the wins each way.
// A Finals won 4 games to anything is the title; one under way is no one's yet. The
// play-in isn't in the log (its own season type). Runs on the Mac (scripts/mac-nightly.sh,
// the season being played): stats.nba.com doesn't answer GitHub's runners.
//   node scripts/team-playoffs.js [season ...]   (default: every Team board season)
const fs = require('fs')
const path = require('path')
const { fetchJson, sleep, NBA_HEADERS } = require('../lib/http')
const { SEASONS } = require('../lib/teamboard')

const OUT = path.join(__dirname, '..', 'data', 'team-playoffs.json')

// { team: { round, champion, series: [{ round, opp, w, l }] } } from the log's rows.
const runsOf = ({ headers, rowSet }) => {
  const at = k => headers.indexOf(k)
  const series = new Map()
  for (const r of rowSet) {
    const team = r[at('TEAM_ABBREVIATION')]
    const round = Number(r[at('GAME_ID')][7])
    const key = `${team}|${round}`
    const s = series.get(key) || { team, round, opp: r[at('MATCHUP')].slice(-3), w: 0, l: 0 }
    s[r[at('WL')] === 'W' ? 'w' : 'l']++
    series.set(key, s)
  }
  const runs = {}
  for (const { team, ...s } of [...series.values()].sort((a, b) => a.round - b.round)) (runs[team] ||= { series: [] }).series.push(s)
  for (const run of Object.values(runs)) {
    const last = run.series[run.series.length - 1]
    run.round = last.round
    run.champion = last.round === 4 && last.w === 4
  }
  return Object.fromEntries(Object.keys(runs).sort().map(t => [t, { round: runs[t].round, champion: runs[t].champion, series: runs[t].series }]))
}

const main = async () => {
  const wanted = process.argv.slice(2)
  const doc = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { source: 'stats.nba.com leaguegamelog (Playoffs, teams)', seasons: {} }
  for (const season of wanted.length ? wanted : SEASONS) {
    const q = new URLSearchParams({ Season: season, SeasonType: 'Playoffs', PlayerOrTeam: 'T', Direction: 'ASC', Sorter: 'DATE', Counter: 0, LeagueID: '00' })
    const { resultSets } = await fetchJson(`https://stats.nba.com/stats/leaguegamelog?${q}`, { headers: NBA_HEADERS })
    const runs = runsOf(resultSets[0])
    if (Object.keys(runs).length) doc.seasons[season] = runs
    else delete doc.seasons[season]
    const champ = Object.entries(runs).find(([, r]) => r.champion)
    console.log(`${season}: ${Object.keys(runs).length} playoff teams${champ ? `, ${champ[0]} champions` : ''}`)
    await sleep(800)
  }
  doc.seasons = Object.fromEntries(Object.entries(doc.seasons).sort())
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`)
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1) })
module.exports = { runsOf }
