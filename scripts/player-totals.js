// data/player-totals.json: each player's own rates for the latest regular season with
// games (pbpstats player totals), for the footprint's teammate checks (lib/footprint.js
// SKILLS): the skills the sheet has no column for (shot blocking, rebounding, shooting
// fouls, corner threes). One call; pbpstats keeps the 500 players with the most minutes.
// --season=YYYY-YY: a past season, to data/seasons/YYYY-YY/player-totals.json.
const pbp = require('../lib/pbpstats')
const { writeArtifact } = require('../lib/artifacts')

const SEASON = (process.argv.find(a => a.startsWith('--season=')) || '').slice('--season='.length) || null
if (SEASON && !/^\d{4}-\d{2}$/.test(SEASON)) throw new Error(`--season takes a season like 2024-25, not ${SEASON}`)

const main = async () => {
  const season = SEASON || await pbp.latestSeasonWithGames()
  const rows = await pbp.playerTotals(season)
  if (!rows.length) throw new Error(`${season}: no player totals`)
  const players = Object.fromEntries(rows.map(r => [String(r.EntityId), {
    minutes: r.Minutes || 0,
    blocksPer100: r.DefPoss ? (100 * (r.Blocks || 0)) / r.DefPoss : 0,
    orebPct: r.OffFGReboundPct || 0,
    drebPct: r.DefFGReboundPct || 0,
    shootingFoulsPer100: r.DefPoss ? (100 * (r.ShootingFouls || 0)) / r.DefPoss : 0,
    corner3PAPer36: r.Minutes ? (36 * (r.Corner3FGA || 0)) / r.Minutes : 0
  }]).sort(([a], [b]) => a.localeCompare(b)))
  const changed = writeArtifact(SEASON ? `seasons/${SEASON}` : '', 'player-totals', { season, generatedAt: new Date().toISOString(), players })
  console.log(`player totals ${season}: ${rows.length} players${changed ? '' : ' (unchanged)'}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
