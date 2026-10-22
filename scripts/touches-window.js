// Time of Poss % over the Last 30 Days card's windows (lib/window.js) -> data/recent-touches.json,
// which scripts/recent-shift.js reads: the stats sheet's date window re-scopes only its
// play-by-play import, not its tracking tabs, and NBA.com's touches take a date range.
// Figured as the sheet's Touches tab does: seconds with the ball (seconds a touch x touches)
// over half the minutes played, about the team's time with the ball. Runs on the Mac
// (scripts/mac-nightly.sh): stats.nba.com doesn't answer GitHub's runners. NBA.com posts a
// night's touches the next morning, so a last night it hasn't posted is left out of the
// window. While the season is under a window old there's no shift, so no players.
//   node scripts/touches-window.js [--season=2025-26] [--out=<file>]
const fs = require('fs')
const path = require('path')
const pbp = require('../lib/pbpstats')
const { fetchJson, sleep, NBA_HEADERS } = require('../lib/http')
const { recentWindow } = require('../lib/window')

const opt = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null
const OUT = opt('out') || path.join(__dirname, '..', 'data', 'recent-touches.json')
// leaguedashptstats wants every filter, if blank.
const BLANK = ['College', 'Conference', 'Country', 'Division', 'DraftPick', 'DraftYear', 'GameScope', 'Height', 'ISTRound', 'Location', 'Outcome', 'PlayerExperience', 'PlayerPosition', 'SeasonSegment', 'StarterBench', 'VsConference', 'VsDivision', 'Weight']
const us = date => `${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}`

// Each player's Time of Poss % from `from` to `to`, by NBA id.
const timeOfPoss = async (season, from, to) => {
  const q = new URLSearchParams({
    ...Object.fromEntries(BLANK.map(k => [k, ''])),
    LastNGames: 0, LeagueID: '00', Month: 0, OpponentTeamID: 0, PORound: 0, TeamID: 0, PerMode: 'Totals',
    PlayerOrTeam: 'Player', PtMeasureType: 'Possessions', Season: season, SeasonType: 'Regular Season', DateFrom: us(from), DateTo: us(to)
  })
  const [rs] = (await fetchJson(`https://stats.nba.com/stats/leaguedashptstats?${q}`, { headers: NBA_HEADERS, retries: 3 })).resultSets
  await sleep(1500)
  const at = k => rs.headers.indexOf(k)
  return new Map(rs.rowSet.filter(r => r[at('MIN')] > 0).map(r => [String(r[at('PLAYER_ID')]), Math.round(((r[at('AVG_SEC_PER_TOUCH')] * r[at('TOUCHES')]) / (r[at('MIN')] * 30)) * 1000) / 10]))
}

const main = async () => {
  const season = opt('season') || await pbp.latestSeasonWithGames()
  const games = [...(await pbp.games(season)).values()]
  let win = recentWindow(games)
  if (win.restEnd >= win.seasonStart && !(await timeOfPoss(season, win.end, win.end)).size) win = recentWindow(games.filter(g => g.Date < win.end))
  const players = {}
  if (win.restEnd >= win.seasonStart) {
    const recent = await timeOfPoss(season, win.start, win.end)
    const rest = await timeOfPoss(season, win.seasonStart, win.restEnd)
    for (const [id, v] of recent) if (rest.has(id)) players[id] = { recent: v, rest: rest.get(id) }
  }
  fs.writeFileSync(OUT, JSON.stringify({ season, window: win, players }) + '\n')
  console.log(`touches ${season}: ${Object.keys(players).length} players, ${win.start}..${win.end}${win.restEnd >= win.seasonStart ? '' : ` (under ${win.days} days in: none)`}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
