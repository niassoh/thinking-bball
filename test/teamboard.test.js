const test = require('node:test')
const assert = require('node:assert')
const { boardOf } = require('../lib/teamboard')

const sheet = {
  values: [
    ['Tm', 'ORTG', 'DRTG', 'Pace', 'ORTG last month', 'Opp 3p', 'percORTG'],
    ['Category', 'Overview', 'Overview', 'Offense', 'Last Month', 'Defense', ''],
    ['OKC', '118.9', '107.0', '99.6', '', '36', '0.97'],
    ['DET', '117.0', '109.5', '101.2', '', '34', '0.90'],
    ['WAS', '108.1', '121.0', '102.0', '', '38', '0.00'],
    ['League Average', '116.0', '116.0', '99.5', '', '35', '']
  ],
  glossy: { ORTG: 'Points scored per 100 possessions' }
}

test('teamboard: the sheet as a board, by its categories, ranked among the teams', () => {
  const b = boardOf(sheet, '2025-26')
  // A column no team has (last month) and the perc* copies are left out.
  assert.deepStrictEqual(b.labels, ['ORTG', 'DRTG', 'Pace', 'Opp 3p'])
  assert.deepStrictEqual(b.groups, [{ id: 'overview', name: 'Overview', stats: ['ORTG', 'DRTG'] }, { id: 'offense', name: 'Offense', stats: ['Pace'] }, { id: 'defense', name: 'Defense', stats: ['Opp 3p'] }])
  assert.deepStrictEqual(b.stats.DRTG, { dec: 1, lowerBetter: true, neutral: false, desc: null })
  assert.strictEqual(b.stats.Pace.neutral, true)
  assert.strictEqual(b.stats.ORTG.desc, 'Points scored per 100 possessions')
  assert.deepStrictEqual(b.league, { ORTG: 116, DRTG: 116, Pace: 99.5, 'Opp 3p': 35 })
  const okc = b.teams.find(t => t.team === 'OKC')
  assert.deepStrictEqual(okc.v, [118.9, 107, 99.6, 36])
  // Best of three in ORTG and (lower) DRTG; Opp 3p lower is better too.
  assert.deepStrictEqual(okc.p, [67, 67, 0, 33])
  assert.strictEqual(okc.name, 'Thunder')
  assert.strictEqual(b.teams.length, 3)
})
