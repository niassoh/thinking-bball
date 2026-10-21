// Our own play-by-play for the season being played -> data/pbp/<season>/<gameId>.json.gz:
// each regular-season game pbpstats lists (so, finished), as NBA.com's v3 play-by-play in
// the fields analysis/footprint/pbp.py reads, with the game's starters from the v3 box
// score. The possession pipeline (analysis/footprint/build.py) builds Footprint and
// Lonestar from these. Kept in git (about 10 KB a game) as the durable copy the old
// archive wasn't. A night costs two calls a new game: games already saved are skipped.
// A game whose play-by-play doesn't end on pbpstats' final score isn't saved and is tried
// again the next run; one still off two days later fails the run.
//   node scripts/pbp-fetch.js
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const pbp = require('../lib/pbpstats')
const { fetchJson, sleep, NBA_HEADERS } = require('../lib/http')

// pbp.py's kaggle_rows columns, less the game id (the file's).
const FIELDS = ['actionNumber', 'period', 'clock', 'scoreHome', 'scoreAway', 'teamTricode', 'personId', 'playerNameI', 'actionType', 'subType', 'shotResult', 'xLegacy', 'yLegacy', 'shotDistance', 'description']
const nba = query => fetchJson(`https://stats.nba.com/stats/${query}`, { headers: NBA_HEADERS, retries: 3 })

const main = async () => {
  const season = await pbp.latestSeasonWithGames()
  const dir = path.join(__dirname, '..', 'data', 'pbp', season)
  fs.mkdirSync(dir, { recursive: true })
  const have = new Set(fs.readdirSync(dir).map(f => f.split('.')[0]))
  const todo = [...(await pbp.games(season)).values()].filter(g => !have.has(g.GameId))
  const stale = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  let saved = 0
  for (const g of todo) {
    const { actions } = (await nba(`playbyplayv3?GameID=${g.GameId}&StartPeriod=0&EndPeriod=0`)).game
    const box = (await nba(`boxscoretraditionalv3?GameID=${g.GameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`)).boxScoreTraditional
    await sleep(500)
    const final = side => Math.max(0, ...actions.map(a => Number(a[side]) || 0))
    if (final('scoreHome') !== g.HomePoints || final('scoreAway') !== g.AwayPoints) {
      console.warn(`${g.GameId} (${g.Date}): play-by-play ends ${final('scoreHome')}-${final('scoreAway')}, pbpstats has ${g.HomePoints}-${g.AwayPoints}; not saved`)
      if (g.Date < stale) process.exitCode = 1
      continue
    }
    const starters = [...box.homeTeam.players, ...box.awayTeam.players].filter(p => p.position).map(p => String(p.personId))
    const doc = { gameId: g.GameId, starters, fields: FIELDS, actions: actions.map(a => FIELDS.map(f => a[f])) }
    fs.writeFileSync(path.join(dir, `${g.GameId}.json.gz`), zlib.gzipSync(JSON.stringify(doc)))
    saved++
  }
  console.log(`pbp ${season}: ${saved} new games saved, ${todo.length - saved} not, ${have.size} already here`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
