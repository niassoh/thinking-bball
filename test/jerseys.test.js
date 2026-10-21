const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { eraFor, jerseyId } = require('../lib/jerseys')
const { oklab, shadeTable } = require('../lib/jersey-color')
const { paint, trimPosition } = require('../lib/jersey-paint')
const { TEAMS } = require('../lib/teams')

const palettes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'jersey-palettes.json'), 'utf8')).teams

test('palettes: every team, eras in order from 2013-14 or before with no gaps or overlaps, valid colours', () => {
  // Today's teams, and the old codes the historical players' seasons carry (CHH, NJN, NOH, SEA).
  for (const team of Object.keys(TEAMS)) assert.ok(palettes[team], team)
  const ids = new Set()
  const next = s => `${Number(s.slice(0, 4)) + 1}-${String(Number(s.slice(0, 4)) + 2).slice(-2)}`
  for (const [team, eras] of Object.entries(palettes)) {
    if (TEAMS[team]) assert.ok(eras[0].from <= '2013-14', team)
    assert.strictEqual(!eras[eras.length - 1].to, !!TEAMS[team], `${team}: the last era is still worn by a team today`)
    for (const [i, e] of eras.entries()) {
      assert.ok(!ids.has(e.id), e.id)
      ids.add(e.id)
      assert.match(e.body, /^#[0-9A-F]{6}$/i, e.id)
      assert.ok(e.trim.length >= 1, e.id)
      for (const s of e.trim) assert.match(s.color, /^#[0-9A-F]{6}$/i, e.id)
      if (i > 0) assert.strictEqual(e.from, next(eras[i - 1].to), `${e.id} follows ${eras[i - 1].id}`)
    }
  }
})

test('a team\'s jersey in a season is the era covering it', () => {
  assert.strictEqual(jerseyId('DEN', '2015-16'), 'DEN.2013')
  assert.strictEqual(jerseyId('DEN', '2017-18'), 'DEN.2013')
  assert.strictEqual(jerseyId('DEN', '2018-19'), 'DEN')
  assert.strictEqual(jerseyId('CHA', '2013-14'), 'CHA.2013')
  assert.strictEqual(jerseyId('CHA', '2014-15'), 'CHA')
  assert.strictEqual(jerseyId('SEA', '1996-97'), 'SEA.1995')
  assert.strictEqual(jerseyId('TOR', '2000-01'), 'TOR.1995')
  assert.strictEqual(jerseyId('TOR', '2003-04'), 'TOR')
  // Seasons past the last era (the depth chart's next season) wear the current one.
  assert.strictEqual(jerseyId('DEN', '2026-27'), 'DEN')
  assert.strictEqual(eraFor('GSW', null).id, 'GSW')
  assert.strictEqual(jerseyId('XXX', '2020-21'), null)
})

test('shading: lighter shade bytes paint lighter, the middle is the colour itself', () => {
  for (const color of ['#FFFFFF', '#111111', '#FDB927', '#0E2240', '#CE1141']) {
    const table = shadeTable(color)
    const L = table.map(rgb => oklab(rgb)[0])
    for (let v = 1; v < 256; v++) assert.ok(L[v] >= L[v - 1] - 1e-6, `${color} at ${v}`)
    const mid = oklab(table[128])[0]
    assert.ok(Math.abs(mid - oklab([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)])[0]) < 0.01, color)
    // Even white gets shadows and black gets highlights.
    assert.ok(L[255] - L[0] > 0.1, color)
  }
})

test('painting changes only the jersey, and trim stripes run from the skin edge to the body', () => {
  // 12 wide: skin (x 0–3), trim (x 4–7), body (x 8–11), on every row.
  const w = 12
  const h = 4
  const base = Buffer.alloc(w * h * 4)
  const map = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const x = i % w
    base.set([200, 150, 120, 255], i * 4)
    map[i * 3] = 128
    if (x >= 8) map[i * 3 + 1] = 255
    else if (x >= 4) map[i * 3 + 2] = 255
  }
  const t = trimPosition(map, w, h)
  assert.ok(t[4] < t[7], 'stripe position rises toward the body')
  const era = { body: '#1D428A', trim: [{ color: '#FFC72C', to: 0.5 }, { color: '#FFFFFF' }] }
  const { rgba, cover } = paint(base, map, w, h, era, t)
  for (let x = 0; x < 4; x++) assert.deepStrictEqual([...rgba.slice(x * 4, x * 4 + 4)], [200, 150, 120, 255], 'skin untouched')
  assert.strictEqual(cover[0], 0)
  assert.strictEqual(cover[9], 255)
  // Gold next to the skin, white next to the body.
  assert.ok(rgba[4 * 4 + 2] < 100, 'gold stripe at the skin edge')
  assert.ok(rgba[7 * 4 + 2] > 200, 'white stripe at the body edge')
})
