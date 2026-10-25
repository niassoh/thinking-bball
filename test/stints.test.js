const test = require('node:test')
const assert = require('node:assert')
const { FIELDS } = require('../lib/footprint')
const { stintsOf, chunkDates, mergeLineups, lineupsDuring } = require('../lib/stints')

const zeros = () => FIELDS.map(() => 0)
const L = (ids, min, pts = 0) => ({ ids: ids.split(''), seconds: min * 60, offPoss: 10, defPoss: 10, plusMinus: 0, t: zeros().map((v, i) => (i === 0 ? pts : v)), o: zeros() })

test('stints: first and last game per team, open at the season ends', () => {
  const rows = [
    { Date: '2025-01-10', Team: 'DAL' }, { Date: '2024-10-24', Team: 'DAL' },
    { Date: '2025-02-10', Team: 'LAL' }, { Date: '2025-04-11', Team: 'LAL' }
  ]
  assert.deepStrictEqual(stintsOf(rows), { DAL: { from: null, to: '2025-01-10' }, LAL: { from: '2025-02-10', to: null } })
  // A middle stint keeps both of its dates.
  const three = stintsOf([...rows, { Date: '2025-01-20', Team: 'WAS' }, { Date: '2025-02-01', Team: 'WAS' }])
  assert.deepStrictEqual(three.WAS, { from: '2025-01-20', to: '2025-02-01' })
})

test('stints: a team season splits where a traded player arrived or left', () => {
  const dates = ['2024-10-24', '2025-01-08', '2025-01-12', '2025-02-08', '2025-02-12', '2025-04-11']
  const stints = { 1: { DAL: { from: null, to: '2025-01-08' }, LAL: { from: '2025-02-08', to: null } } }
  assert.deepStrictEqual(chunkDates(dates, stints, 'DAL'), [['2024-10-24', '2025-01-08'], ['2025-01-12', '2025-02-08', '2025-02-12', '2025-04-11']])
  assert.deepStrictEqual(chunkDates(dates, stints, 'LAL'), [['2024-10-24', '2025-01-08', '2025-01-12'], ['2025-02-08', '2025-02-12', '2025-04-11']])
  assert.deepStrictEqual(chunkDates(dates, stints, 'BOS'), [dates])
  // The Last 30 Days' start cuts at the team's first game on or after it; one before the
  // season's first game cuts nothing.
  assert.deepStrictEqual(chunkDates(dates, stints, 'BOS', ['2025-02-10']), [['2024-10-24', '2025-01-08', '2025-01-12', '2025-02-08'], ['2025-02-12', '2025-04-11']])
  assert.deepStrictEqual(chunkDates(dates, stints, 'DAL', ['2025-01-12']), chunkDates(dates, stints, 'DAL'))
  assert.deepStrictEqual(chunkDates(dates, stints, 'BOS', ['2024-09-01']), [dates])
})

test('stints: his lineups with a team are the chunks of his stint, summed by lineup', () => {
  const doc = {
    lineups: mergeLineups([[L('ABCDE', 10, 5)], [L('ABCDE', 20, 7), L('FBCDE', 30)]]),
    chunks: [
      { from: '2024-10-24', to: '2025-01-08', lineups: [L('ABCDE', 10, 5)] },
      { from: '2025-01-12', to: '2025-04-11', lineups: [L('ABCDE', 20, 7), L('FBCDE', 30)] }
    ]
  }
  const all = doc.lineups.find(l => l.ids.join('') === 'ABCDE')
  assert.strictEqual(all.seconds, 1800)
  assert.strictEqual(all.t[0], 12)
  assert.deepStrictEqual(lineupsDuring(doc, { from: null, to: '2025-01-08' }).map(l => l.ids.join('')), ['ABCDE'])
  assert.strictEqual(lineupsDuring(doc, { from: '2025-01-12', to: null }).length, 2)
  assert.strictEqual(lineupsDuring(doc, undefined), doc.lineups)
})

test("stints: a lineup's players' own counts are summed across chunks, row by row", () => {
  // Rows are trimmed of trailing zeros, 0 for a player with none; a chunk may have none at all.
  const a = { ...L('ABCDE', 10), p: [[5, 2], 0, [1], 0, 0] }
  const b = { ...L('ABCDE', 20), p: [[3, 1, 1], [2], 0, 0, 0] }
  const c = L('ABCDE', 5)
  const [merged] = mergeLineups([[a], [c], [b]])
  assert.deepStrictEqual(merged.p, [[8, 3, 1], [2], [1], 0, 0])
  // The chunks' own rows are left as they were.
  assert.deepStrictEqual(a.p, [[5, 2], 0, [1], 0, 0])
  assert.strictEqual(mergeLineups([[c]])[0].p, undefined)
})
