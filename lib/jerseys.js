// Jerseys on the portraits: the team colour palettes (data/jersey-palettes.json), which
// jersey a team wore in a season, and the built jersey layers
// (assets/players/jersey/manifest.json, scripts/portraits/jersey-build.js).
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PALETTES = path.join(ROOT, 'data', 'jersey-palettes.json')
const JERSEY_DIR = path.join(ROOT, 'assets', 'players', 'jersey')
const MANIFEST = path.join(JERSEY_DIR, 'manifest.json')

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)

let cache = null
const load = () => {
  if (!cache) cache = { palettes: (readJson(PALETTES) || { teams: {} }).teams, manifest: (readJson(MANIFEST) || { players: {} }).players }
  return cache
}
const reset = () => {
  cache = null
}

// Seasons as 'YYYY-YY' compare as strings.
const covers = (era, season) => era.from <= season && (!era.to || season <= era.to)

// The palette entry a team wore in a season: the era covering it, else the nearest one
// (the earliest for a season before the first era, the latest after the last).
const eraFor = (team, season, palettes = load().palettes) => {
  const eras = palettes[team]
  if (!eras || !eras.length) return null
  if (!season) return eras[eras.length - 1]
  return eras.find(e => covers(e, season)) || (season < eras[0].from ? eras[0] : eras[eras.length - 1])
}
const jerseyId = (team, season, palettes) => {
  const era = eraFor(team, season, palettes)
  return era ? era.id : null
}
const eraById = (id, palettes = load().palettes) => {
  for (const eras of Object.values(palettes)) for (const e of eras) if (e.id === id) return e
  return null
}

// A player's built layers, { v, top, ids, current }, or null (none built).
const layersOf = slug => {
  const m = load().manifest[slug]
  return m ? { v: m.v, top: m.top, ids: m.ids, current: m.current } : null
}

module.exports = { eraFor, jerseyId, eraById, layersOf, reset, JERSEY_DIR, MANIFEST }
