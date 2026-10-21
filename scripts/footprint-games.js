// data/footprint/<season>/games.json: each regular-season game's date by game id
// (pbpstats get-games), for analysis/footprint/footprint_pbp.py. The possession cache has
// no dates, and game ids don't run in date order (the NBA Cup's December games, a
// postponed game made up later), so a season is split at trade dates by these.
// One call a season.
//   node scripts/footprint-games.js 2013-14 ... 2025-26
const pbp = require('../lib/pbpstats')
const { writeArtifact } = require('../lib/artifacts')

const SEASONS = process.argv.slice(2)
if (!SEASONS.length || SEASONS.some(s => !/^\d{4}-\d{2}$/.test(s))) throw new Error('give seasons like 2024-25')

const main = async () => {
  for (const season of SEASONS) {
    const games = [...(await pbp.games(season)).values()].sort((a, b) => a.GameId.localeCompare(b.GameId))
    if (!games.length) throw new Error(`${season}: no games`)
    const changed = writeArtifact(`footprint/${season}`, 'games', { season, generatedAt: new Date().toISOString(), games: Object.fromEntries(games.map(g => [g.GameId, g.Date])) })
    console.log(`games ${season}: ${games.length}${changed ? '' : ' (unchanged)'}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
