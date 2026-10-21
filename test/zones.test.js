const test = require('node:test')
const assert = require('node:assert')
const { classify, ZONES } = require('../lib/zones')

// [x, y, shotValue, expected] in pbpstats coordinates (tenths of a foot from the basket).
const cases = [
  [0, 10, 2, 'rim'],
  [30, -20, 2, 'rim'],
  [0, 60, 2, 'rim'], // exactly 6 ft
  [0, 61, 2, 'short_mid'],
  [-60, 80, 2, 'short_mid'], // 10 ft in the paint
  [-150, 60, 2, 'long_mid'], // 16.2 ft baseline jumper
  [0, 140, 2, 'short_mid'], // exactly 14 ft
  [0, 170, 2, 'long_mid'],
  [-55, -40, 2, 'rim'], // behind the basket: 5.5 ft sideways (6.8 ft straight-line)
  [135, -45, 2, 'short_mid'], // behind the basket: 13.5 ft sideways (14.2 ft straight-line)
  [-225, 40, 3, 'three'],
  [0, 260, 3, 'three']
]

test('classify buckets shots by distance band', () => {
  for (const [x, y, v, want] of cases) assert.strictEqual(classify(x, y, v), want, `(${x},${y},${v})`)
})

test('every band is reachable', () => {
  const hit = new Set(cases.map(c => c[3]))
  for (const z of ZONES) assert.ok(hit.has(z), z)
})

test('left and right are mirror images', () => {
  for (const [x, y, v] of cases) assert.strictEqual(classify(x, y, v), classify(-x, y, v), `(${x},${y},${v})`)
})
