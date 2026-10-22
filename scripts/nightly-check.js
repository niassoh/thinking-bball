// The nightly run's look at its pulls before it commits data/: each against the last
// commit's, so a source that came back short (a half-loaded sheet, an outage) doesn't
// replace good data. No calls; exits non-zero with what failed.
//   node scripts/nightly-check.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { decompress } = require('compress-json')
const { loadCache, regularSeasonKeys } = require('../lib/players')

const DATA_DIR = path.join(__dirname, '..', 'data')
const readJson = file => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
const committed = file => {
  try {
    return JSON.parse(execFileSync('git', ['show', `HEAD:data/${file}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    return null
  }
}
const players = raw => (raw ? decompress(raw).values.length - 2 : 0)

const key = regularSeasonKeys().pop()
const sheetNow = loadCache()[key]
const sheetWas = (committed('cached-data.json') || {})[key]
// A column most of the last commit's players had that came back mostly blank: a sheet
// formula erroring, as its league averages did on 2026-10-21 (BPM blank for everyone).
const filledOf = raw => {
  const d = raw ? decompress(raw) : { values: [[]] }
  return Object.fromEntries(d.values[0].map((c, i) => [c, d.values.slice(2).filter(r => r[i] !== '' && r[i] !== '-').length]))
}
const was = filledOf(sheetWas)
const now = filledOf(sheetNow)
const full = Object.keys(was).filter(c => !c.startsWith('perc') && was[c] >= players(sheetWas) / 2)
const blank = full.filter(c => (now[c] || 0) < was[c] / 2)
const checks = [
  [`${key} players`, players(sheetNow), 0.9 * players(sheetWas)],
  [`${key} filled columns${blank.length ? ` (blank now: ${blank.join(', ')})` : ''}`, full.length - blank.length, full.length],
  ['bio.json players', Object.keys(readJson('bio.json')).length, 0.98 * Object.keys(committed('bio.json') || {}).length],
  ['depth-chart players', Object.keys(readJson('depth/_index.json')).length, 400]
]
const failed = checks.filter(([, n, min]) => n < min)
for (const [what, n, min] of checks) console.log(`${n < min ? 'FAIL' : 'ok  '} ${what}: ${n} (at least ${Math.ceil(min)})`)
if (failed.length) process.exit(1)
