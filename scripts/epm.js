// data/epm.json: each player's defensive EPM (Dunks & Threes) by regular season, 2001-02 on,
// from the user-supplied export data/sources/epm/public.player_epm.csv (no calls): its rows
// from each season's end (source dunksandthrees.com/player/eskills; 2025-26 also has a later
// dunksandthrees.com/epm snapshot, left out), a player's latest where he has several. Each
// season holds { nbaId: [defensive EPM, minutes per 48] } (the minutes EPM's estimate,
// p_mp_48, not his average: Bogut's 2015-16 reads 11.9), for Footprint's defensive monsters
// (lib/profile.js).
//   node scripts/epm.js
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const { writeArtifact } = require('../lib/artifacts')

const FILE = path.join(__dirname, '..', 'data', 'sources', 'epm', 'public.player_epm.csv')
const SOURCE = 'dunksandthrees.com/player/eskills'

const { data } = Papa.parse(fs.readFileSync(FILE, 'utf8'), { header: true, skipEmptyLines: true })
const latest = new Map()
for (const r of data) {
  if (r.source !== SOURCE || r.epm_def === '' || !r.nba_player_id) continue
  const key = `${r.season}|${r.nba_player_id}`
  if (!latest.has(key) || r.game_dt > latest.get(key).game_dt) latest.set(key, r)
}
const seasons = {}
for (const r of latest.values()) {
  const y = Number(r.season)
  const season = `${y - 1}-${String(y).slice(2)}`
  seasons[season] = seasons[season] || {}
  seasons[season][r.nba_player_id] = [Math.round(Number(r.epm_def) * 1000) / 1000, Math.round(Number(r.p_mp_48) * 10) / 10]
}
const sorted = Object.fromEntries(Object.keys(seasons).sort().map(s => [s, Object.fromEntries(Object.entries(seasons[s]).sort(([a], [b]) => Number(a) - Number(b)))]))
writeArtifact('', 'epm', { generatedAt: new Date().toISOString(), source: 'data/sources/epm/public.player_epm.csv (user-supplied, Dunks & Threes)', fields: ['depm', 'mp48'], seasons: sorted }, { inlineNumberArrays: true })
console.log(Object.entries(sorted).map(([s, p]) => `${s} ${Object.keys(p).length}`).join(' · '))
