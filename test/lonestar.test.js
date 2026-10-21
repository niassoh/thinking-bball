const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const C = require('../lib/creation')
const { scenariosOf, leagueOf, rankIn, pctlIn, lonestar, starsOf } = require('../lib/lonestar')
const { loadSheet, regularSeasonKeys, seasonFromKey, slugify, num } = require('../lib/players')

test('creation: the parts behave as the sheet\'s columns do', () => {
  // No threes: no 3p proficiency. Spacing is never 0.
  assert.strictEqual(C.threeProf(0, 0.4), 0)
  assert.ok(C.threeProf(10, 0.4) > 0.39 && C.threeProf(10, 0.4) < 0.4)
  assert.strictEqual(C.spacing(3, 0, 0), 0.01)
  // Box Creation never goes under 0.3 before the teammates' spacing scales it.
  assert.strictEqual(C.boxCreation({ ast: 0, pts: 0, tov: 0, orb: 10, pctFt: 0.9, prof: 0.4, height: 84, mates: 1.09 }), 0.3)
  // Load: assists less the share Box Creation already counts, shots, trips, creation, turnovers.
  assert.ok(Math.abs(C.load({ ast: 10, bc: 5, fga: 20, fta: 5, tov: 3 }) - ((10 - 1.9) * 0.752 + 20 + 2.2 + 5 + 3)) < 1e-9)
  const pr = C.passerRating({ rimAstRel: 0, load: 40, ast: 8, height: 78, tov: 3, non3: 2 })
  assert.ok(pr > 0 && pr < 11.3)
  assert.strictEqual(C.inches("6'11\""), 83)
  assert.strictEqual(C.inches(null), 0)
})

test('creation: reproduces the sheet\'s season Load, Box Creation and Passer Rating', () => {
  // Jokić's 2025-26 totals with Denver against the sheet's row. The totals are pbpstats'
  // (a fixture), as the sheet's are: the play-by-play source counts 1-2% more possessions,
  // so its per-75 stats sit that much lower and would test the source, not the formulas.
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lonestar-den-2025-26.json'), 'utf8'))
  const row = id => Object.fromEntries(doc.fields.map((f, i) => [f, doc.base[id][i]]))
  const league = doc.league
  const sheet = loadSheet(regularSeasonKeys().find(k => seasonFromKey(k) === '2025-26')).rows
  const bio = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bio.json'), 'utf8'))
  const slugOf = Object.fromEntries(Object.entries(bio).map(([s, b]) => [b.nbaId, s]))
  const pos = id => num((sheet.find(r => slugify(r.Player) === slugOf[id]) || {}).Position) || 0
  const sp = id => {
    const i = C.inputs(row(id))
    return C.spacing(pos(id), i.pctFt, C.threeProf(i.pa3, i.pct3))
  }
  const total = Object.keys(doc.base).reduce((a, id) => a + row(id).Minutes, 0)
  const team = Object.keys(doc.base).reduce((a, id) => a + sp(id) * (row(id).Minutes / total), 0)
  const jokic = '203999'
  const m = C.metrics(row(jokic), { pos: pos(jokic), height: C.inches(bio['nikola-jokic'].height), mates: C.matesSpacing(sp(jokic), row(jokic).Minutes / total, team), league })
  const s = sheet.find(r => slugify(r.Player) === 'nikola-jokic')
  assert.ok(Math.abs(m.load - num(s.Load)) < 0.5, `Load ${m.load} vs ${s.Load}`)
  assert.ok(Math.abs(m.boxCreation - num(s['Box Creation'])) < 0.5, `Box Creation ${m.boxCreation} vs ${s['Box Creation']}`)
  assert.ok(Math.abs(m.passerRating - num(s['Passer Rating'])) < 0.3, `Passer Rating ${m.passerRating} vs ${s['Passer Rating']}`)
  assert.ok(Math.abs(m.pts75 - num(s['Pts 75'])) < 0.3, `Pts/75 ${m.pts75} vs ${s['Pts 75']}`)
})

// A team-season with stars A, B, C (by star score, all with a lead role) and a role player
// R, everyone sharing the floor with each star. Rows give minutes, possessions and points;
// R scores more with A and B off.
const FIELDS = ['Minutes', 'OffPoss', 'DefPoss', 'PlusMinus', 'OpponentPoints', 'Points', 'Assists', 'AtRimAssists', 'FG2A', 'FG3A', 'FG3M', 'FTA', 'FtPoints', 'OffRebounds', 'Turnovers', 'TsPct']
const row = (min, pts) => ({ Minutes: min, OffPoss: 2 * min, DefPoss: 2 * min, PlusMinus: 0, OpponentPoints: 2 * min, Points: pts, Assists: min / 10, AtRimAssists: min / 30, FG2A: pts / 2, FG3A: 0, FG3M: 0, FTA: 0, FtPoints: 0, OffRebounds: 0, Turnovers: min / 20, TsPct: 0.55 })
const doc = (season, rPtsOff, scores = { A: 300, B: 200, C: 100 }) => ({
  season, team: 'T', top: ['A', 'B', 'C'].sort((a, b) => scores[b] - scores[a]),
  stars: Object.fromEntries(Object.entries(scores).map(([t, score]) => [t, { score, load: 40 }])),
  loads: {},
  base: { A: row(2000, 2000), B: row(2000, 1600), C: row(1500, 900), R: row(1500, 600) },
  sets: {
    A: { off: { R: row(500, rPtsOff), B: row(500, 500) }, on: { R: row(1000, 300), A: row(1000, 1000), B: row(1500, 1100) } },
    B: { off: { A: row(600, 700) }, on: { A: row(1400, 1300), R: row(900, 400) } },
    C: { off: {}, on: { A: row(1100, 1000), B: row(1000, 800), R: row(800, 300) } },
    'A,B': { off: { R: row(300, 300) }, on: { R: row(700, 140) }, both: { R: row(450, 90) } },
    'A,C': { off: { B: row(300, 400), R: row(400, 350) }, on: { B: row(800, 600), R: row(1100, 250) }, both: { B: row(500, 380), R: row(600, 140) } },
    'B,C': { off: { A: row(300, 450) }, on: { A: row(900, 800) }, both: { A: row(600, 540) } }
  }
})
const ctx = { posOf: () => 3, heightOf: () => 78, nameOf: id => ({ name: `Player ${id}`, slug: id.toLowerCase() }) }
const LEAGUE = { ts: 0.57, rimAstShare: 0.35, ortg: 115 }

test('lonestar: his stars are the team\'s top two he played with, never himself', () => {
  const d = doc('2025-26', 400)
  assert.deepStrictEqual(starsOf([d], 'R'), ['A', 'B'])
  assert.deepStrictEqual(starsOf([d], 'A'), ['B', 'C'])
  assert.deepStrictEqual(starsOf([d], 'B'), ['A', 'C'])
  // A teammate outside the league's top 50 that season isn't a star at all (Eric Gordon).
  const deep = doc('2025-26', 400)
  deep.stars.B.star = false
  assert.deepStrictEqual(starsOf([deep], 'R'), ['A', 'C'])
  // A star with less than a median role only fills in, whatever his score.
  const filler = doc('2025-26', 400, { A: 300, B: 200, C: 900 })
  filler.stars.C.load = 20
  assert.deepStrictEqual(starsOf([filler], 'R'), ['A', 'B'])
  // Nor does a big Load at a poor impact lead (BPM below 0: score under twice the Load), so
  // a gunner like Harden's 2015-16 Thornton falls behind a better player with less of it.
  const gunner = doc('2025-26', 400, { A: 300, B: 70, C: 90 })
  gunner.stars.C.load = 20
  assert.deepStrictEqual(starsOf([gunner], 'R'), ['A', 'C'])
  // A star he barely shared the floor with (traded away as he arrived) isn't one of his:
  // the next one is.
  d.sets.B.on.R = row(100, 50)
  assert.deepStrictEqual(starsOf([d], 'R'), ['A', 'C'])
})

test('lonestar: over two seasons his stars are the best across both, each stretch pooling both', () => {
  // B is the second star in 2024-25 and C in 2025-26; across the two (his minutes equal),
  // C's 100 then 280 beats B's 200 then 10.
  const data = { league: { '2024-25': LEAGUE, '2025-26': LEAGUE }, seasons: ['2024-25', '2025-26'], docs: [doc('2024-25', 400), doc('2025-26', 400, { A: 300, B: 10, C: 280 })] }
  assert.deepStrictEqual(starsOf([data.docs[0]], 'R'), ['A', 'B'])
  assert.deepStrictEqual(starsOf([data.docs[1]], 'R'), ['A', 'C'])
  assert.deepStrictEqual(starsOf(data.docs, 'R'), ['A', 'C'])
  const two = scenariosOf(data, 'R', ctx).find(s => s.kind === 'two')
  assert.deepStrictEqual([two.stars, two.seasons], [['A', 'C'], ['2024-25', '2025-26']])
})

test('lonestar: over a span, a star who leads only some of its seasons still gets his stretch', () => {
  // A leads 2024-25 and is gone in 2025-26, where D leads (Paul then Westbrook for Harden):
  // across the two A is the top star, and without D is a stretch of its own.
  const scores = { A: 300, B: 100, C: 50 }
  const swapped = JSON.parse(JSON.stringify(doc('2025-26', 400, { ...scores, A: 280 })).replace(/"A(?=[",])/g, '"D'))
  const data = { league: { '2024-25': LEAGUE, '2025-26': LEAGUE }, seasons: ['2024-25', '2025-26'], docs: [doc('2024-25', 400, scores), swapped] }
  assert.deepStrictEqual(starsOf(data.docs, 'R'), ['A', 'D'])
  const stretches = kind => scenariosOf(data, 'R', ctx).filter(s => s.kind === kind).map(s => `${s.stars} ${s.seasons}`).sort()
  assert.deepStrictEqual(stretches('one'), ['A 2024-25', 'D 2025-26'])
  assert.deepStrictEqual(stretches('two'), ['A,B 2024-25', 'D,B 2025-26'])
  // ALL (a profile's views): each season once, without the star it was assigned, so its
  // minutes are the two stretches' together; the league's field never has it.
  const all = scenariosOf(data, 'R', ctx, { all: true }).find(s => s.all && s.kind === 'one')
  assert.deepStrictEqual(all.parts.map(p => `${p.stars} ${p.seasons}`), ['A 2024-25', 'D 2025-26'])
  assert.strictEqual(all.off.minutes, 1000)
  assert.ok(scenariosOf(data, 'R', ctx).every(s => !s.all))
  // Only stretches it offers go in: with D's too thin to offer, ALL would be A's alone, so
  // there's none.
  assert.ok(scenariosOf(data, 'R', ctx, { all: true, keep: s => !s.stars.includes('D') }).every(s => !s.all))
})

test('lonestar: a star is offered when he led or co-led enough of his minutes, not to fill a gap', () => {
  // Seven equal seasons: A the star throughout, B within 10% of him in two (Durant beside
  // Curry), and in the last A gone and D the lead (Russell in Curry's lost 2019-20): B
  // co-led 2 of 7 (29%) and is offered; D led 1 of 7 (14%, under the 15%) and isn't.
  const seasons = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26']
  const docs = seasons.map((season, i) => {
    const d = i === 6
      ? JSON.parse(JSON.stringify(doc(season, 400)).replace(/"A(?=[",])/g, '"D'))
      : doc(season, 400, i >= 4 ? { A: 300, B: 280, C: 100 } : { A: 300, B: 200, C: 100 })
    // (R plays without B too, so B's stretch has both sides.)
    d.sets.B.off.R = row(500, 450)
    return d
  })
  const data = { league: Object.fromEntries(seasons.map(s => [s, LEAGUE])), seasons, docs }
  assert.deepStrictEqual(scenariosOf(data, 'R', ctx).filter(s => s.kind === 'one').map(s => s.stars.join()).sort(), ['A', 'B'])
})

test('lonestar: a top-quarter Load also goes without the teammates sharing the ball, stars or not', () => {
  // R's Load (40) is in the league's top quarter (30 and up). C, no star of his (A's 300
  // dwarfs his 100), carries 80% of it or more (36) at OBPM 0 or better, as Castle and Fox
  // did for Harper; B, at 30, doesn't.
  const d = doc('2025-26', 400)
  d.loads = { R: 40 }
  Object.assign(d.stars.B, { load: 30, obpm: 2 })
  Object.assign(d.stars.C, { load: 36, obpm: 0.8 })
  d.sets.C.off.R = row(700, 300)
  const ones = data => scenariosOf(data, 'R', ctx).filter(s => s.kind === 'one').map(s => s.stars.join()).sort()
  const data = { league: { '2025-26': { ...LEAGUE, topLoad: 30 } }, seasons: ['2025-26'], docs: [d] }
  assert.deepStrictEqual(ones(data), ['A', 'C'])
  // Not with his own Load under the top quarter, nor at the teammate's OBPM under 0.
  assert.deepStrictEqual(ones({ ...data, league: { '2025-26': { ...LEAGUE, topLoad: 41 } } }), ['A'])
  d.stars.C.obpm = -0.1
  assert.deepStrictEqual(ones(data), ['A'])
})

test('lonestar: each scenario is his stats with the stars off against on, pooled over seasons', () => {
  const data = { league: { '2024-25': LEAGUE, '2025-26': LEAGUE }, seasons: ['2024-25', '2025-26'], docs: [doc('2024-25', 400), doc('2025-26', 400)] }
  const [one, two] = scenariosOf(data, 'R', ctx)
  assert.deepStrictEqual([one.kind, one.stars, one.seasons], ['one', ['A'], ['2024-25', '2025-26']])
  assert.deepStrictEqual([two.kind, two.stars], ['two', ['A', 'B']])
  // Without both against with both: his 450 minutes a season with the pair on, not the
  // 700 with either of them on.
  assert.strictEqual(two.on.minutes, 900)
  assert.strictEqual(two.off.minutes, 600)
  // Two seasons of 500 minutes off, 1,000 on.
  assert.strictEqual(one.off.minutes, 1000)
  assert.strictEqual(one.on.minutes, 2000)
  // 400 points in 1,000 possessions off vs 300 in 2,000 on, per 75: 30 vs 11.25.
  assert.ok(Math.abs(one.off.pts75 - 30) < 1e-9 && Math.abs(one.on.pts75 - 11.25) < 1e-9)
  assert.ok(Math.abs(one.change.pts75 - 18.75) < 1e-9)
  // ORTG while he plays: (plus-minus + opponents' points) per 100 of his offensive possessions.
  assert.ok(Math.abs(one.off.ortg - 100) < 1e-9)
  assert.ok(Math.abs(one.off.rortg + 15) < 1e-9)
  assert.strictEqual(one.ranked, true)
})

test('lonestar: a teammate on for a second, with no possessions, leaves his Load and the rest whole', () => {
  // The 2005-06 Rockets had one (2668): 0.02 minutes all season, in McGrady's minutes
  // without Yao, which left those minutes with no Load, Box Creation or Passer Rating.
  const d = doc('2025-26', 400)
  d.base.Z = { ...row(0.02, 0), OffPoss: 0, DefPoss: 0 }
  d.sets.A.off.Z = d.base.Z
  const data = { league: { '2025-26': LEAGUE }, seasons: ['2025-26'], docs: [d] }
  const one = scenariosOf(data, 'R', ctx).find(s => s.kind === 'one')
  for (const k of ['load', 'boxCreation', 'passerRating', 'ctov']) assert.ok(Number.isFinite(one.off[k]), k)
})

test('lonestar: net is ORTG less DRTG, even when the team defends more often than it attacks', () => {
  // Hart's 408 minutes without Brunson and Towns over two seasons: pbpstats' WOWY has
  // OffRtg 106.0 and NetRtg -3.9; plus-minus per possession would say -10.8.
  const data = { league: { '2024-25': LEAGUE, '2025-26': LEAGUE }, seasons: ['2024-25', '2025-26'], docs: [doc('2024-25', 400), doc('2025-26', 400)] }
  data.docs[0].sets.A.off.R = { ...row(314, 114), OffPoss: 610, DefPoss: 642, PlusMinus: -13, OpponentPoints: 698 }
  data.docs[1].sets.A.off.R = { ...row(94, 36), OffPoss: 179, DefPoss: 198, PlusMinus: -75, OpponentPoints: 228 }
  const one = scenariosOf(data, 'R', ctx).find(s => s.kind === 'one')
  assert.ok(Math.abs(one.off.ortg - 106.21) < 0.01, `ORTG ${one.off.ortg}`)
  assert.ok(Math.abs(one.off.net + 4.03) < 0.01, `Net ${one.off.net}`)
})

test('lonestar: changes rank biggest increase first, and thin samples go unranked and unoffered', () => {
  assert.deepStrictEqual(rankIn([9, 5, 2, -1], 5), { rank: 2, of: 4 })
  assert.deepStrictEqual(rankIn([9, 5, 2, -1], 10), { rank: 1, of: 4 })
  assert.deepStrictEqual(rankIn([9, 5, 2, -1], -3), { rank: 5, of: 4 })
  // Under 250 minutes on a side, a scenario isn't ranked (nor in the field), and under 200
  // it isn't offered either. R with 150 minutes with A and B both off.
  const data = { league: { '2025-26': LEAGUE }, seasons: ['2025-26'], docs: [doc('2025-26', 400)] }
  const thin = JSON.parse(JSON.stringify(data))
  thin.docs[0].sets['A,B'].off.R = row(150, 150)
  assert.strictEqual(scenariosOf(thin, 'R', ctx).find(s => s.kind === 'two').ranked, false)
  const view = lonestar(thin, leagueOf(thin, ctx), 'R', ctx)
  // One season on file: one view, no pooled one.
  assert.deepStrictEqual(view.views.map(v => v.id), ['2025-26'])
  const scenarios = view.views[0].scenarios
  assert.deepStrictEqual(scenarios.map(s => s.kind), ['one'])
  assert.deepStrictEqual(scenarios.find(s => s.kind === 'one').stars, [{ id: 'A', name: 'Player A', slug: 'a' }])
  // Percentiles: the share of the league's values below, ties counted half.
  assert.strictEqual(pctlIn([1, 2, 3, 4], 2.5), 50)
  assert.strictEqual(pctlIn([1, 2, 2, 3], 2), 50)
  assert.strictEqual(pctlIn([1, 2, 3, 4], 9), 100)
  assert.strictEqual(pctlIn([], 3), null)
  const one = scenarios.find(s => s.kind === 'one')
  assert.ok(one.pctl.on.load >= 0 && one.pctl.on.load <= 100 && one.pctl.off.load >= 0)
  // Each stat's range to draw on: low ≤ median ≤ high.
  const [lo, mid, hi] = view.scale.load
  assert.ok(lo <= mid && mid <= hi && lo < hi)
})

test('lonestar: a view for every season since 1996-97 and every span, regular season only', () => {
  const { buildProfile, lonestarDoc } = require('../lib/profile')
  const p = buildProfile('nikola-jokic')
  // The profile carries only his seasons; the tab's views are their own document.
  assert.ok(p.lonestar.seasons.includes('2015-16') && p.lonestar.seasons.includes('2025-26'))
  assert.strictEqual(p.lonestar.views, undefined)
  const doc = lonestarDoc('nikola-jokic')
  // His seasons, latest first, then every span of them.
  const n = doc.seasons.length
  assert.strictEqual(doc.views[0].id, doc.seasons[n - 1])
  assert.strictEqual(doc.views.filter(v => v.seasons.length === 1).length, n)
  assert.strictEqual(doc.views.length, (n * (n + 1)) / 2)
  const view = id => doc.views.find(v => v.id === id).scenarios
  const one = view('2024-25..2025-26').find(s => s.kind === 'one' && s.team === 'DEN')
  assert.deepStrictEqual(one.seasons, ['2024-25', '2025-26'])
  assert.deepStrictEqual(view('2025-26').find(s => s.kind === 'one' && s.team === 'DEN').seasons, ['2025-26'])
  assert.strictEqual(one.stars[0].name, 'Jamal Murray')
  // The keys show each star's face.
  assert.strictEqual(one.stars[0].slug, 'jamal-murray')
  assert.ok(one.stars[0].headshot && one.stars[0].headshotVersion)
  // The cast wears the team's jersey of the stretch's latest season, and the stars' jersey
  // layers come with the profile.
  assert.strictEqual(one.jersey, 'DEN')
  const harden = buildProfile('james-harden')
  const hardenDoc = lonestarDoc('james-harden')
  const lac = hardenDoc.views.find(v => v.id === '2025-26').scenarios.find(s => s.team === 'LAC')
  assert.strictEqual(lac.jersey, 'LAC')
  for (const t of lac.stars) if (require('../lib/jerseys').layersOf(t.slug)) assert.ok(harden.jerseys[t.slug], t.slug)
  // Stars carry the offense and do it well: Towns' first in 2025-26 is Brunson, and
  // Clarkson (a high-Load scorer with poor impact) is never one. And they shared the floor
  // with him: Garland, traded for Harden, is never one of Harden's.
  const towns = lonestarDoc('karl-anthony-towns').views.find(v => v.id === '2025-26').scenarios
  assert.strictEqual(towns.find(s => s.kind === 'one').stars[0].slug, 'jalen-brunson')
  assert.ok(towns.every(s => s.stars.every(t => t.slug !== 'jordan-clarkson')))
  assert.ok(hardenDoc.views.filter(v => v.id.startsWith('2025-26') || v.id.endsWith('2025-26')).every(v => v.scenarios.every(s => s.stars.every(t => t.slug !== 'darius-garland'))))
  // Packed: each stretch's per-stat values in the document's `fields` order.
  const minutes = doc.fields.indexOf('minutes')
  assert.ok(one.off[minutes] > 300 && one.on[minutes] > 1000)
  assert.ok(!('change' in one) && one.pctl.length === 2)
  assert.strictEqual(buildProfile('nikola-jokic', { type: 'playoffs' }).lonestar, null)
})
