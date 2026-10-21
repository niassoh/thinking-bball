const test = require('node:test')
const assert = require('node:assert')
const { lineupProfile, league, poolFloor, pickRange, rankAmong, POOL_MAX } = require('../lib/lineups')

const L = (ids, minutes, poss, plusMinus) => ({ ids: ids.split(''), seconds: minutes * 60, offPoss: poss, defPoss: poss, plusMinus })
const FLOORS = { 2: 100, 3: 250, 4: 100, 5: 100 }
const RANGES = { 2: [50, 1200], 3: [50, 800], 4: [50, 400], 5: [50, 150] }
const LINEUPS = [
  L('ABCDE', 120, 100, 20), // +20.0
  L('ABCFG', 30, 30, -6), // -20.0
  L('AFGHI', 300, 50, 0), // 0.0
  L('BCDEF', 60, 40, -4) // without A: -10.0
]

test('lineups: on/off sum the lineups he is and is not in', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  assert.deepStrictEqual(p.on, { minutes: 450, poss: 180, net: 7.8 })
  assert.deepStrictEqual(p.off, { minutes: 60, poss: 40, net: -10 })
})

test('lineups: most-used five with its share, best five over the minutes floor', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  assert.deepStrictEqual(p.units[5].mostUsed, { ids: ['F', 'G', 'H', 'I'], minutes: 300, poss: 50, net: 0, share: 67 })
  // ABCDE (+20, 120 min) beats AFGHI (0); ABCFG (-20) is under the floor anyway.
  assert.deepStrictEqual(p.units[5].best.ids, ['B', 'C', 'D', 'E'])
  assert.strictEqual(p.units[5].best.net, 20)
})

test('lineups: trios sum every five they appear in and need the minutes floor', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  // A+B+C plays 150 min (under 250); A+F+G plays 330 min across two fives at -7.5;
  // the other trios from AFGHI play 300 min at 0.0, so one of those is best.
  assert.strictEqual(p.units[3].best.minutes, 300)
  assert.strictEqual(p.units[3].best.net, 0)
  assert.ok(!(p.units[3].best.ids.includes('F') && p.units[3].best.ids.includes('G')))
  assert.deepStrictEqual(p.units[3].mostUsed, { ids: ['F', 'G'], minutes: 330, poss: 80, net: -7.5, share: 73 })
})

test('lineups: pairs and four-man units the same way', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  // Pairs: A+D and A+E play only ABCDE (120 min, +20), the best over 100 min; A+F the most.
  assert.deepStrictEqual(p.units[2].best, { ids: ['D'], minutes: 120, poss: 100, net: 20 })
  assert.deepStrictEqual(p.units[2].mostUsed, { ids: ['F'], minutes: 330, poss: 80, net: -7.5, share: 73 })
  // Four-man: the ABCDE ones (+20, 120 min) beat the AFGHI ones (0, 300 min).
  assert.deepStrictEqual(p.units[4].best.ids, ['B', 'C', 'D'])
  assert.deepStrictEqual(p.units[4].mostUsed.ids, ['F', 'G', 'H'])
  assert.strictEqual(p.units[4].mostUsed.share, 67)
})

test('lineups: options are every unit over the lowest pickable minimum, best first', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  // Trios down to 100 min: the ten from ABCDE/ABCFG/AFGHI that clear it, best net first.
  const o = p.units[3].options
  assert.ok(o.every(u => u.minutes >= 100))
  assert.ok(o.every((u, i) => i === 0 || o[i - 1].net >= u.net))
  // At the default floor (250), the first option over it is the best unit.
  assert.deepStrictEqual(o.find(u => u.minutes >= FLOORS[3]), p.units[3].best)
})

test('lineups: teammates by shared minutes, together and apart', () => {
  const p = lineupProfile(LINEUPS, 'A', FLOORS, RANGES)
  assert.deepStrictEqual(p.mates.map(m => m.id), ['F', 'G', 'H', 'I', 'B'])
  const f = p.mates[0]
  assert.deepStrictEqual(f.together, { minutes: 330, poss: 80, net: -7.5 })
  assert.deepStrictEqual(f.apart, { minutes: 120, poss: 100, net: 20 })
})

test('lineups: a player in no lineup has no profile', () => {
  assert.strictEqual(lineupProfile(LINEUPS, 'Z', FLOORS, RANGES), null)
})

test('lineups: the minutes floor lets about the pool size of units through', () => {
  const minutes = [900, 700, 640, 560, 555, 300, 120]
  // The 4th most-played unit has 560 min, rounded down to 550, so 555 clears it too.
  assert.strictEqual(poolFloor(minutes, { pool: 4, step: 50 }), 550)
  assert.strictEqual(minutes.filter(m => m >= poolFloor(minutes, { pool: 4, step: 50 })).length, 5)
  // A finer step: the 6th most-played has 300 min, the 7th 120 → a 10-min step gives 120.
  assert.strictEqual(poolFloor(minutes, { pool: 7, step: 10 }), 120)
  // Fewer units than the pool: the least-played sets it, never under one step.
  assert.strictEqual(poolFloor([30, 10], { pool: 4, step: 50 }), 50)
})

test('lineups: league units over the floors, ranked by net, for every size', () => {
  const lg = league([{ team: 'T', lineups: LINEUPS }])
  // Fewer than 100 fives, so the least-played (ABCFG, 30 min) sets the floor: all four.
  assert.strictEqual(lg.floors[5], 30)
  assert.deepStrictEqual(lg.nets[5], [20, 0, -10, -20])
  for (const k of [2, 3, 4, 5]) assert.ok(lg.nets[k].length > 0 && lg.nets[k].every((n, i) => i === 0 || lg.nets[k][i - 1] >= n), k)
  assert.deepStrictEqual(rankAmong(lg.nets[5], { minutes: 300, net: 0 }, lg.floors[5]), { rank: 2, of: 4 })
  assert.strictEqual(rankAmong(lg.nets[5], { minutes: 20, net: -20 }, lg.floors[5]), null)
  // The pool behind any pickable minimum: every five over 50 min as [minutes, net, ids, team].
  assert.deepStrictEqual(lg.pool[5].map(([m]) => m).sort((a, b) => b - a), [300, 120, 60])
  assert.deepStrictEqual(lg.pool[5].find(([m]) => m === 120).slice(1), [20, ['A', 'B', 'C', 'D', 'E'], 'T'])
  assert.deepStrictEqual(lg.ranges[5], [50, 150])
})

test('lineups: the lowest pickable minimum leaves at most POOL_MAX units, on a 50-minute step', () => {
  // 600 units: 10, 20, ... 6000 minutes. The 501st most-played has 1000, so 1050 is the
  // lowest step over it, which leaves 495.
  const minutes = Array.from({ length: 600 }, (_, i) => (i + 1) * 10)
  const [lo, hi] = pickRange(minutes, 2)
  assert.strictEqual(lo, 1050)
  assert.ok(minutes.filter(m => m >= lo).length <= POOL_MAX && minutes.filter(m => m >= lo - 50).length > POOL_MAX)
  assert.strictEqual(hi, 1200)
  // Few units: the lowest is one step. A lowest above the size's highest lifts the highest.
  assert.deepStrictEqual(pickRange([30, 10], 5), [50, 150])
  assert.deepStrictEqual(pickRange(minutes, 5), [1050, 1050])
})
