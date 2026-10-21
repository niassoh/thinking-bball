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
const checks = [
  [`${key} players`, players(loadCache()[key]), 0.9 * players((committed('cached-data.json') || {})[key])],
  ['bio.json players', Object.keys(readJson('bio.json')).length, 0.98 * Object.keys(committed('bio.json') || {}).length],
  ['depth-chart players', Object.keys(readJson('depth/_index.json')).length, 400]
]
const failed = checks.filter(([, n, min]) => n < min)
for (const [what, n, min] of checks) console.log(`${n < min ? 'FAIL' : 'ok  '} ${what}: ${n} (at least ${Math.ceil(min)})`)
if (failed.length) process.exit(1)
