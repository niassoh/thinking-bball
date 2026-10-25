const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { loadSheet, slugify, num } = require('../lib/players')
const { percentileOf } = require('../lib/percentile')
const { seasonValues, filledIn, FILLED } = require('../lib/historical')

const DATA = path.join(__dirname, '..', 'data')
const box = JSON.parse(fs.readFileSync(path.join(DATA, 'history', 'box-stats.json'), 'utf8'))
const heights = JSON.parse(fs.readFileSync(path.join(DATA, 'heights.json'), 'utf8')).players
const tab = loadSheet('1historical-24').rows
const tabRowsOf = season => tab.filter(t => t.Player && (t['Yr / Tm'] || '').startsWith(`${season} `))

// How far each filled column lands from the tab's own value for the players it has, team
// row by team row: the mean miss, and the mean move of his percentile among the tab's
// players over the floor (the card's number). Bounds a little over each one's worst season.
const MAE = { BPM: 0.12, 'rTS%': 0.01, Load: 0.65, 'Box Creation': 0.12, 'Passer rating': 0.17, ScoreVal: 0.09, PlayVal: 0.09 }
test('the derived box columns reproduce the historical tab\'s values for the players it has', () => {
  for (const [season, doc] of Object.entries(box.seasons)) {
    const tabRows = tabRowsOf(season)
    const { rows } = seasonValues(doc, tabRows, heights)
    const idOf = new Map(doc.map(r => [`${r[2]}|${slugify(r[0])}`, r[1]]))
    for (const c of filledIn(season)) {
      const pool = tabRows.filter(t => num(t.MP) >= 800).map(t => num(t[c]))
      const miss = []
      const moved = []
      for (const t of tabRows) {
        const tm = t['Yr / Tm'].split(' ')[1]
        const v = rows.get(`${tm}|${idOf.get(`${tm}|${slugify(t.Player)}`)}`)[c]
        miss.push(Math.abs(v - num(t[c])))
        if (num(t.MP) >= 800) moved.push(Math.abs(percentileOf(Math.round(v * 10) / 10, pool) - percentileOf(num(t[c]), pool)))
      }
      const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
      assert.strictEqual(miss.length, tabRows.length)
      assert.ok(mean(miss) <= MAE[c], `${season} ${c}: off by ${mean(miss).toFixed(3)} on average`)
      assert.ok(mean(moved) <= 3, `${season} ${c}: percentile off by ${mean(moved).toFixed(1)} on average`)
    }
  }
  // The lockout season's ScoreVal and PlayVal don't (0.24 and 0.12 off), so aren't filled.
  assert.deepStrictEqual(FILLED.filter(c => !filledIn('1998-99').includes(c)), ['ScoreVal', 'PlayVal'])
})

test('Kobe\'s 1996-97, off the tab, by hand from his Basketball-Reference line', () => {
  const kobe = seasonValues(box.seasons['1996-97'], tabRowsOf('1996-97'), heights).players.get('bryanko01')
  assert.deepStrictEqual([kobe.mp, kobe.g, kobe.teams], [1103, 71, [{ team: 'LAL', mp: 1103 }]])
  const v = kobe.values
  // TS% .544 against the tab's league .536 (every one of its 171 rows that season).
  assert.ok(Math.abs(v['rTS%'] - 0.8) < 1e-9)
  // Load: per 100, (4.3 assists − 0.38 × 3.0993 Box Creation) × 0.752 + 20.2 FGA + 0.44 × 7.9
  // FTA + 3.0993 + 5.3 turnovers = 34.42.
  assert.ok(Math.abs(v['Box Creation'] - 3.0993) < 1e-4)
  assert.ok(Math.abs(v.Load - 34.4232) < 1e-3)
  assert.strictEqual(v.BPM.toFixed(1), '-0.7')
})

test('a traded player off the tab gets his combined season, his teams\' context by his minutes', () => {
  // Tim Thomas's 1998-99: 188 minutes for Philadelphia, 624 for Milwaukee.
  const doc = box.seasons['1998-99']
  const { players, rows } = seasonValues(doc, tabRowsOf('1998-99'), heights)
  const tim = players.get('thomati01')
  assert.deepStrictEqual([tim.mp, tim.g, tim.teams.map(t => t.team).sort()], [812, 50, ['MIL', 'PHI']])
  // Near his two teams' rows weighted by his minutes with each (BPM 1.54 and −1.73: 0.78).
  const byMinutes = c => (rows.get('MIL|thomati01')[c] * 624 + rows.get('PHI|thomati01')[c] * 188) / 812
  assert.ok(Math.abs(tim.values.BPM - byMinutes('BPM')) < 0.1)
  assert.ok(Math.abs(tim.values['rTS%'] - byMinutes('rTS%')) < 0.1)
  assert.ok(Math.abs(tim.values.Load - byMinutes('Load')) < 0.2)
})
