// data/history/positions.json: every player's listed position each regular season from
// 1996-97 (Basketball-Reference's, its first where it lists two: PG-SG is PG), from the
// user-supplied play-by-play archive's public.fact_player_season_stats.csv, kept at
// data/sources/archive/ (no calls). For a past season's rotation where the sheet has no
// position estimate (lib/profile.js rotationFor): none before 2000-01, a third of
// 2000-01's players. { seasons: { 'YYYY-YY': { name: 'PG' | 'SG' | 'SF' | 'PF' | 'C' } } },
// a name as the table writes it less the Hall of Fame star.
//   node scripts/positions.js
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const { writeArtifact } = require('../lib/artifacts')

const FILE = path.join(__dirname, '..', 'data', 'sources', 'archive', 'public.fact_player_season_stats.csv')
const FIRST = 1997

const { data } = Papa.parse(fs.readFileSync(FILE, 'utf8'), { header: true, skipEmptyLines: true })
const seasons = {}
for (const r of data) {
  const year = Number(r.season)
  const pos = (r.pos || '').split('-')[0]
  if (r.season_type !== 'Regular Season' || year < FIRST || !['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) continue
  const season = `${year - 1}-${String(year).slice(2)}`
  seasons[season] = seasons[season] || {}
  seasons[season][r.player.replace(/\*$/, '')] = pos
}
const sorted = Object.fromEntries(Object.keys(seasons).sort().map(s => [s, seasons[s]]))
writeArtifact('history', 'positions', { generatedAt: new Date().toISOString(), source: 'data/sources/archive/public.fact_player_season_stats.csv (user-supplied, Basketball-Reference)', seasons: sorted })
console.log(Object.entries(sorted).map(([s, p]) => `${s} ${Object.keys(p).length}`).join(' · '))
