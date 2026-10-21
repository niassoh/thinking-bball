// The playoff lineups the bio card shows for seasons the play-by-play history doesn't cover
// in the playoffs (data/history/playoffs/lineups/ starts at 2013-14, analysis/footprint/
// lineup_history.py): pbpstats' lineup totals, one call per playoff team (a run is well
// under its LINEUP_CAP rows), written in the history's shape to
// data/history/playoffs/lineups/<season>/<TEAM>.json under the era's codes (SEA, NJN, CHH).
// Each team's lineup seconds are checked against its playoff minutes (pbpstats' team
// totals). pbpstats misses some playoff games before 2000-01 (1996-97 CHI: 16 of 19), so
// those runs' lineups cover the games it has, as their playoff stats do.
//   node scripts/playoff-lineup-history.js [1996-97 ...]  (default 1996-97..2012-13)
const fs = require('fs')
const path = require('path')
const pbp = require('../lib/pbpstats')

const OUT = path.join(__dirname, '..', 'data', 'history', 'playoffs', 'lineups')
const DEFAULT_SEASONS = Array.from({ length: 17 }, (_, i) => `${1996 + i}-${String(97 + i).slice(-2)}`)

const main = async () => {
  const seasons = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SEASONS
  if (!seasons.every(s => /^(19|20)\d{2}-\d{2}$/.test(s))) throw new Error(`Bad season in ${seasons.join(' ')}`)
  for (const season of seasons) {
    const teams = await pbp.teamTotals(season, 'playoffs')
    if (!teams.length) throw new Error(`${season}: no playoff teams`)
    const dir = path.join(OUT, season)
    fs.mkdirSync(dir, { recursive: true })
    const off = []
    for (const t of teams) {
      const rows = await pbp.lineups(t.TeamId, season, null, null, 'playoffs')
      if (rows.length >= pbp.LINEUP_CAP) throw new Error(`${season} ${t.TeamAbbreviation}: ${rows.length} lineups, at the cap`)
      const lineups = rows.map(r => ({ ids: r.EntityId.split('-'), seconds: r.SecondsPlayed || 0, offPoss: r.OffPoss || 0, defPoss: r.DefPoss || 0, plusMinus: r.PlusMinus || 0 }))
        .sort((a, b) => b.seconds - a.seconds)
      // Five players on the floor: the lineups' seconds are the team's minutes over five.
      const minutes = lineups.reduce((a, l) => a + l.seconds, 0) / 60
      if (Math.abs(minutes - t.Minutes / 5) > 1) off.push(`${t.TeamAbbreviation} ${Math.round(minutes)} of ${Math.round(t.Minutes / 5)}`)
      fs.writeFileSync(path.join(dir, `${t.TeamAbbreviation}.json`), JSON.stringify({ season, team: t.TeamAbbreviation, lineups }))
    }
    console.log(`${season}: ${teams.length} teams${off.length ? `; lineup minutes off the team's: ${off.join(', ')}` : ''}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
