const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { exportStatic } = require('../scripts/export-static')
const { buildProfile, playerIndex, aliasSlugs } = require('../lib/profile')
const { ALL_STATS, statKey } = require('../lib/stats')

test('statKey: labels become plain file names', () => {
  assert.strictEqual(statKey('Pts / 75'), 'pts-75')
  assert.strictEqual(statKey('rTS%'), 'rts')
  assert.strictEqual(statKey('Net On/Off'), 'net-on-off')
  assert.strictEqual(statKey('Def FGA <6ft /36'), 'def-fga-6ft-36')
  const keys = ALL_STATS.map(s => statKey(s.label))
  assert.strictEqual(new Set(keys).size, keys.length)
})

test('static export: every profile, index, teams, distributions and headshots', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-export-'))
  try {
    const r = exportStatic(out)
    const index = playerIndex()
    assert.ok(r.profiles.regular >= index.length)
    // Playoffs mode: a playoff profile for every player (empty without runs).
    assert.strictEqual(r.profiles.playoffs, r.profiles.regular)
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, 'api', 'playoffs', 'profile', 'nikola-jokic.json'), 'utf8')), JSON.parse(JSON.stringify(buildProfile('nikola-jokic', { type: 'playoffs' }))))
    assert.ok(fs.existsSync(path.join(out, 'api', 'playoffs', 'distribution', 'bpm.json')))
    for (const p of index) assert.ok(fs.existsSync(path.join(out, 'api', 'profile', `${p.slug}.json`)), p.slug)
    for (const slug of aliasSlugs().filter(s => buildProfile(s))) assert.ok(fs.existsSync(path.join(out, 'api', 'profile', `${slug}.json`)), slug)
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, 'api', 'profile', 'nikola-jokic.json'), 'utf8')), JSON.parse(JSON.stringify(buildProfile('nikola-jokic'))))
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'api', 'profiles.json'), 'utf8')).length, index.length)
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'api', 'teams.json'), 'utf8')).length, 30)
    // A lineup pool per season, the history's included, in both modes.
    for (const [pre, season] of [['', '2025-26'], ['', '2013-14'], ['playoffs', '2016-17']]) {
      const pool = JSON.parse(fs.readFileSync(path.join(out, 'api', pre, `lineups-league-${season}.json`), 'utf8'))
      assert.strictEqual(pool.season, season)
      assert.ok(pool.nets[3].length > 0, `${pre} ${season}`)
    }
    // Stats with no column (no data) have no file, as the API 404s them.
    assert.ok(fs.existsSync(path.join(out, 'api', 'distribution', 'bpm.json')))
    assert.ok(!fs.existsSync(path.join(out, 'api', 'distribution', `${statKey('Pts / 100 Allowed')}.json`)))
    // Only the sizes the site loads.
    const portraits = fs.readdirSync(path.join(out, 'assets', 'players', 'webp'))
    assert.ok(portraits.length > 0 && portraits.every(f => /-(100|400)\.webp$/.test(f)))
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})
