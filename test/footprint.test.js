const test = require('node:test')
const assert = require('node:assert')
const { FIELDS, OWN, sumCounts, STATS, swing, ratings, leagueSwings, footprint, footprintSeasons, footprintViews } = require('../lib/footprint')

// A lineup of five single-letter ids with team (t) and opponent (o) counts by field name,
// and its players' own counts by id (p).
const counts = c => FIELDS.map(f => c[f] || 0)
const L = (ids, min, { t = {}, o = {}, poss = 100, p = null } = {}) => {
  const l = { ids: ids.split(''), seconds: min * 60, offPoss: poss, defPoss: poss, plusMinus: 0, t: counts(t), o: counts(o) }
  if (p) l.p = l.ids.map(id => (p[id] ? OWN.map(f => p[id][f] || 0) : 0))
  return l
}
const stat = key => STATS.find(s => s.key === key)
// A league where every swing is small, so any real swing here is unusual.
const LEAGUE = Object.fromEntries(STATS.map(s => [s.key, { abs: [0.1, 0.2, 0.3, 0.4, 0.5], lg: 50 }]))
const fns = { nameOf: id => ({ name: `Player ${id}`, slug: id.toLowerCase() }), skillOf: () => 95 }
// One team-season of lineups, as footprint() takes them.
const one = (lineups, extra = {}) => [{ season: '2025-26', team: 'T', lineups, ...extra }]
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

test('footprint: a rate is summed counts over summed possessions, not an average of lineups', () => {
  // 20 and 120 opponent rim points per 100 in lineups of 100 and 50 possessions: 53.3 together, not 70.
  const s = sumCounts([L('ABCDE', 10, { o: { RimFGM: 10 }, poss: 100 }), L('ABCDF', 10, { o: { RimFGM: 30 }, poss: 50 })])
  assert.strictEqual(s.o[FIELDS.indexOf('RimFGM')], 40)
  const sw = swing(stat('oppRimPts'), s, sumCounts([L('FGHIJ', 10, { o: { RimFGM: 300 }, poss: 1000 })]))
  assert.strictEqual(Math.round(sw.on * 10) / 10, 53.3)
})

test('footprint: z is the swing over its standard error', () => {
  const on = sumCounts([L('ABCDE', 600, { o: { RimFGM: 120 }, poss: 600 })])
  const off = sumCounts([L('FGHIJ', 600, { o: { RimFGM: 80 }, poss: 600 })])
  const sw = swing(stat('oppRimPts'), on, off)
  // 40 vs 26.7 rim points per 100; makes are Poisson, so SE = 200·√makes / poss on each side.
  const se = Math.hypot((200 * Math.sqrt(120)) / 600, (200 * Math.sqrt(80)) / 600)
  assert.ok(near(sw.diff, 40 / 3))
  assert.ok(near(sw.z, 40 / 3 / se))
  // Under 600 possessions on a side, the swing is too thin to judge.
  assert.strictEqual(swing(stat('oppRimPts'), sumCounts([L('ABCDE', 600, { o: { RimFGM: 100 }, poss: 500 })]), off).thin, true)
})

test('footprint: rim points are makes under 5 ft and their free throws; floater range, 5 to 14 ft; paint extended, both', () => {
  // 100 makes under 5 ft with 40 free throws, 50 from 5-14 ft with 10, against 1,000
  // possessions; pbpstats' 4 ft at-rim makes don't count.
  const s = sumCounts([L('ABCDE', 600, { o: { RimFGM: 100, RimFTM: 40, PaintFGM: 50, PaintFTM: 10, AtRimFGM: 90 }, poss: 1000 })])
  const off = sumCounts([L('FGHIJ', 600, { o: { RimFGM: 100 }, poss: 1000 })])
  assert.ok(near(swing(stat('oppRimPts'), s, off).on, 24))
  assert.ok(near(swing(stat('oppFloaterPts'), s, off).on, 11))
  assert.ok(near(swing(stat('oppPaintPts'), s, off).on, 35))
  // Runouts are left out, points and possessions: 100 of the 1,000 were, with 30 rim makes
  // and 6 rim free throws, so (200 + 40 - 66) per 900.
  const run = sumCounts([L('ABCDE', 600, { o: { RimFGM: 100, RimFTM: 40, RunoutPoss: 100, RunoutRimFGM: 30, RunoutRimFTM: 6 }, poss: 1000 })])
  assert.ok(near(swing(stat('oppRimPts'), run, off).on, (100 * 174) / 900))
  // A free throw trip is two shots' worth of Poisson noise: 4·makes + 2·FTM.
  assert.ok(near(swing(stat('oppRimPts'), s, off).se, Math.hypot((100 * Math.sqrt(480)) / 1000, (100 * Math.sqrt(400)) / 1000)))
})

test('footprint: offensive rating is points per 100 possessions, its noise from the per-possession variance', () => {
  const on = sumCounts([L('ABCDE', 600, { t: { Points: 1200 }, poss: 1000 })])
  const off = sumCounts([L('FGHIJ', 600, { t: { Points: 1000 }, poss: 1000 })])
  const sw = swing(stat('ortg'), on, off)
  assert.ok(near(sw.diff, 20))
  assert.ok(near(sw.z, 20 / (100 * Math.sqrt(1.4 * (2 / 1000)))))
  // The same swing as the header's ratings.
  const r = ratings([[on, off]])
  assert.ok(near(r.ortg.on - r.ortg.off, sw.diff))
  assert.equal(r.ortg.r, null)
})

test("footprint: the ratings' r is his on value against each season's league, pooled like the on value", () => {
  // Two seasons, 120 and 100 points per 100 with him on, against leagues of 110 and 105,
  // equal possessions: r = (10 + −5) / 2. His opponents score 100 and 110 against him.
  const side = (pts, opp) => sumCounts([L('ABCDE', 600, { t: { Points: pts }, o: { Points: opp }, poss: 1000 })])
  const r = ratings([[side(1200, 1000), side(1000, 1000), 110], [side(1000, 1100), side(1000, 1000), 105]])
  assert.ok(near(r.ortg.r, 2.5))
  assert.ok(near(r.drtg.r, (100 - 110 + 110 - 105) / 2))
})

test("footprint: teammates' stats leave his own shots out; when he sits, everyone is a teammate", () => {
  // With P on, the team takes 400 of 1,000 shots from three, but 300 of the 600 twos are
  // his: his teammates take 400 of 700 from three. With him off, 400 of 1,000.
  const lineups = [
    L('PCDEF', 800, { t: { FG2A: 600, FG3A: 400, FG3M: 140 }, poss: 1000, p: { P: { FG2A: 300 } } }),
    L('GCDEF', 800, { t: { FG2A: 600, FG3A: 400, FG3M: 140 }, poss: 1000, p: { G: { FG2A: 300 } } })
  ]
  const fp = footprint(one(lineups), 'P', LEAGUE, fns)
  const e = fp.effects.find(x => x.key === 'tm3Rate')
  assert.strictEqual(e.on, 57.1)
  assert.strictEqual(e.off, 40)
  assert.strictEqual(e.mates, true)
  assert.strictEqual(e.good, 1)
  // His teammates hit the same 140 of 400 threes either way.
  assert.strictEqual(fp.effects.find(x => x.key === 'tm3Pct').diff, 0)
})

test("footprint: teammates' TS% is their points over twice their true-shot attempts", () => {
  // Teammates: 1,100 points on 300/600 twos, 100/300 threes and 300 free throws (200 made).
  const lineups = [
    L('PCDEF', 800, { t: { Points: 1300, FG2M: 400, FG2A: 800, FG3M: 100, FG3A: 300, FTA: 300 }, poss: 1000, p: { P: { Points: 200, FG2M: 100, FG2A: 200 } } }),
    L('GCDEF', 800, { t: { Points: 1100, FG2M: 300, FG2A: 600, FG3M: 100, FG3A: 300, FTA: 300 }, poss: 1000 })
  ]
  const e = footprint(one(lineups), 'P', LEAGUE, fns).effects.find(x => x.key === 'tmTs')
  assert.strictEqual(e.on, Math.round((1000 * 1100) / (2 * (900 + 0.44 * 300))) / 10)
  assert.strictEqual(e.on, e.off)
})

// P on: opponents score 70 rim points per 100. When P sits, B mostly plays and they score
// 40; with B also off, 70 again, so the swing is B's, not P's.
const rim = (makes, poss) => ({ o: { RimFGM: makes }, poss })
const backupCase = backupRim => [
  L('PCDEF', 400, rim(280, 800)),
  L('PCDEG', 400, rim(280, 800)),
  L('BCDEF', 300, rim(backupRim, 600)),
  L('XCDEF', 100, rim(70, 200)),
  L('XCDEG', 100, rim(70, 200))
]

test('footprint: a swing his backup explains is tagged as the backup effect', () => {
  const fp = footprint(one(backupCase(120)), 'P', LEAGUE, fns)
  const s = fp.effects.find(x => x.key === 'oppRimPts')
  assert.ok(s, 'opp rim points are shown')
  assert.strictEqual(s.effect, 'Rim protection')
  assert.ok(s.status === 'notable' && s.diff > 0 && s.good < 0, 'notable and worse with him on: a cost')
  assert.strictEqual(s.context.kind, 'replacement')
  assert.deepStrictEqual(s.context.mate, { name: 'Player B', slug: 'b' })
  assert.strictEqual(s.context.check.gap, 0)
  assert.match(s.context.text, /^When he sits, Player B plays 60% of those minutes, a 95th-percentile rim protector\. With Player B also off, the gap is \+0\.0\.$/)
})

test('footprint: a swing that survives every check holds up as his own', () => {
  // Opponents score 40 rim points per 100 whenever P sits, backup or not.
  const lineups = backupCase(120).map(l => (l.ids.includes('X') ? { ...l, o: counts({ RimFGM: 40 }) } : l))
  const s = footprint(one(lineups), 'P', LEAGUE, fns).effects.find(x => x.key === 'oppRimPts')
  assert.strictEqual(s.context.kind, 'own')
  // Every teammate who takes his minutes is checked; the text names the two who take most.
  assert.match(s.context.text, /^Holds .*with Player B, a 95th-percentile rim protector, also off \(\+30\.0\).*\.$/)
})

// P shares 75% of his minutes with Q; the team scores 120 points per 100 only when Q
// plays, 100 otherwise.
const pts = (points, poss) => ({ t: { Points: points }, poss })
const partnerCase = [
  L('PQCDE', 900, pts(2160, 1800)),
  L('PCDEF', 300, pts(600, 600)),
  L('GCDEF', 400, pts(800, 800))
]

test('footprint: a swing driven by the teammate he plays with most is a partner effect', () => {
  const s = footprint(one(partnerCase), 'P', LEAGUE, fns).effects.find(x => x.key === 'ortg')
  assert.strictEqual(s.status, 'notable')
  assert.strictEqual(s.context.kind, 'partner')
  assert.strictEqual(s.context.mate.name, 'Player Q')
  assert.match(s.context.text, /^Most of it comes alongside Player Q, a 95th-percentile offensive player, who shares 75% of his minutes: with Player Q off the floor, the gap is \+0\.0\.$/)
})

test('footprint: only a teammate who stands out in the skill behind the stat, the right way, is a suspect', () => {
  // Nobody is a standout offensive player (50th): the swing is P's, with nobody to check.
  const mid = footprint(one(partnerCase), 'P', LEAGUE, { ...fns, skillOf: () => 50 }).effects.find(x => x.key === 'ortg')
  assert.strictEqual(mid.context.kind, 'own')
  assert.strictEqual(mid.context.mate, null)
  assert.match(mid.context.text, /^No teammate whose minutes move with his is an outlier offensive player, good or bad/)
  // Everyone is a poor one (5th): Q beside him can't lift the rating, but G, who plays
  // all of his minutes off, could sink it; G is never off when P sits, so it's unchecked.
  const poor = footprint(one(partnerCase), 'P', LEAGUE, { ...fns, skillOf: () => 5 }).effects.find(x => x.key === 'ortg')
  assert.strictEqual(poor.context.kind, 'thin')
  assert.strictEqual(poor.context.mate.name, 'Player G')
  assert.match(poor.context.text, /^Too few minutes apart from Player G, a 5th-percentile offensive player, to check/)
  // The skill is asked for the season they played together.
  const asked = []
  footprint(one(partnerCase), 'P', LEAGUE, { ...fns, skillOf: (id, col, season) => asked.push([id, col, season]) && 95 })
  assert.ok(asked.some(([id, col, season]) => id === 'Q' && col === 'OBPM' && season === '2025-26'))
})

test('footprint: each season is against his team that season, then pooled', () => {
  // Season A (team X): his team scores 60 points per 100 with him, 40 without. Season B
  // (team Y, a worse team): 50 with him, 30 without. +20 each season. Summing both
  // seasons' minutes instead would read +25, from the team change.
  const seasons = [
    { season: '2024-25', team: 'X', lineups: [L('PCDEF', 1200, pts(1440, 2400)), L('GCDEF', 400, pts(320, 800))] },
    { season: '2025-26', team: 'Y', lineups: [L('PHIJK', 400, pts(400, 800)), L('MHIJK', 1200, pts(720, 2400))] }
  ]
  const fp = footprint(seasons, 'P', LEAGUE, fns)
  assert.strictEqual(fp.effects.find(x => x.key === 'ortg').diff, 20)
  assert.deepStrictEqual(fp.spans.map(x => [x.season, x.team, x.minutes.on, x.minutes.off]), [['2024-25', 'X', 1200, 400], ['2025-26', 'Y', 400, 1200]])
  assert.deepStrictEqual(fp.minutes, { on: 1600, off: 1600 })
})

test("footprint: his on value against the league is each season's against that season's league", () => {
  // 110 with him in a 100 league, 130 in a 120 league, equal samples: +10 against the league.
  const seasons = [
    { season: '2024-25', team: 'X', lineups: [L('PCDEF', 800, pts(1100, 1000)), L('GCDEF', 800, pts(1000, 1000))] },
    { season: '2025-26', team: 'X', lineups: [L('PCDEF', 800, pts(1300, 1000)), L('GCDEF', 800, pts(1200, 1000))] }
  ]
  const league = { ...LEAGUE, ortg: { abs: [1, 2, 3], on: [-5, 0, 5, 8, 20], lg: 110, bySeason: { '2024-25': 100, '2025-26': 120 } } }
  const e = footprint(seasons, 'P', league, fns).effects.find(x => x.key === 'ortg')
  assert.strictEqual(e.on, 120)
  assert.strictEqual(e.lg, 110)
  assert.strictEqual(e.r, 10)
  // +10 tops four of the five league values: 80th.
  assert.strictEqual(e.onPctl, 80)
})

test('footprint: a cost stat reads lower as better; a lit swing is placed from its nearer end', () => {
  // Opponents' rim points: 20 per 100 with him on, 60 off, in a league allowing more.
  const lineups = [L('PCDEF', 800, { o: { RimFGM: 100 }, poss: 1000 }), L('GCDEF', 800, { o: { RimFGM: 300 }, poss: 1000 })]
  const league = { ...LEAGUE, oppRimPts: { abs: [1, 2, 3], swing: [-50, -30, -10, 0, 10, 30], on: [-10, 0, 10, 20], lg: 50, bySeason: { '2025-26': 50 } } }
  const e = footprint(one(lineups), 'P', league, fns).effects.find(x => x.key === 'oppRimPts')
  assert.strictEqual(e.diff, -40)
  assert.strictEqual(e.status, 'notable')
  // 30 under the league allows fewer than all four: the 100th percentile, not the 0th.
  assert.strictEqual(e.onPctl, 100)
  // −40 is beaten only by −50: 2nd best of 6.
  assert.deepStrictEqual(e.rank, [2, 6, 'best'])
  // A cost is placed from the other end: +40 tops all six, the worst.
  const worse = [L('PCDEF', 800, { o: { RimFGM: 300 }, poss: 1000 }), L('GCDEF', 800, { o: { RimFGM: 100 }, poss: 1000 })]
  assert.deepStrictEqual(footprint(one(worse), 'P', league, fns).effects.find(x => x.key === 'oppRimPts').rank, [1, 6, 'worst'])
})

test('footprint: every effect is listed in catalogue order, each with how it fared', () => {
  // All shots at the rim, so teammates' rim points and TS% move together; both are notable.
  const shots = (m, a) => ({ t: { Points: 2 * m, RimFGM: m, RimFGA: a, FG2M: m, FG2A: a }, poss: 1000 })
  const lineups = [L('PCDEF', 800, shots(480, 600)), L('GCDEF', 400, shots(300, 600))]
  const fp = footprint(one(lineups), 'P', LEAGUE, fns)
  assert.deepStrictEqual(fp.effects.map(e => e.key), STATS.map(s => s.key))
  assert.deepStrictEqual(fp.effects.map(e => e.num), STATS.map((s, i) => i + 1))
  for (const key of ['rimPts', 'tmTs']) assert.strictEqual(fp.effects.find(e => e.key === key).status, 'notable')
  // Only notable effects are checked against teammates; no 3PA, so 3PA-based stats are thin.
  for (const e of fp.effects) assert.strictEqual(!!e.context, e.status === 'notable', e.key)
  assert.strictEqual(fp.effects.find(e => e.key === 'cornerRate').status, 'thin')
})

test("footprint: a season whose lineups don't keep a stat's counts leaves it out", () => {
  // The daily pull's lineups: no Footprint zones, no players' own counts.
  const shots = (m, a) => ({ t: { Points: 2 * m, RimFGM: m, RimFGA: a, FG2M: m, FG2A: a }, poss: 1000 })
  const fp = footprint(one([L('PCDEF', 800, shots(480, 600)), L('GCDEF', 400, shots(300, 600))], { has: { zones: false, own: false } }), 'P', LEAGUE, fns)
  for (const key of ['tmTs', 'rimPts', 'tm3Rate', 'tm3Pct', 'oppRimPts', 'oppPaintPts', 'oppFloaterPts']) {
    const e = fp.effects.find(x => x.key === key)
    assert.strictEqual(e.status, 'na', key)
    assert.strictEqual(e.diff, null, key)
  }
  assert.strictEqual(fp.effects.find(x => x.key === 'ortg').status, 'notable')
})

test('footprint: a swing common across the league is real but typical', () => {
  const common = { ...LEAGUE, oppRimPts: { abs: Array.from({ length: 100 }, (_, i) => i), lg: 60 } }
  const fp = footprint(one(backupCase(120)), 'P', common, fns)
  const e = fp.effects.find(x => x.key === 'oppRimPts')
  assert.strictEqual(e.status, 'typical')
  assert.strictEqual(e.context, null)
})

test('footprint: none without enough minutes on and off the floor', () => {
  assert.strictEqual(footprint(one([L('PCDEF', 400, {}), L('GCDEF', 400, {})]), 'P', LEAGUE, fns), null)
})

test("footprint: corner denial is the share of opponents' shots from the corner", () => {
  // Opponents take 200 of 1,000 shots from the corner with P on, 100 with him off.
  const corner = n => ({ o: { Corner3FGA: n, FG3A: 400, FG2A: 600 }, poss: 1000 })
  const fp = footprint(one([L('PCDEF', 800, corner(200)), L('GCDEF', 800, corner(100))]), 'P', LEAGUE, fns)
  const s = fp.effects.find(x => x.key === 'oppCorner3')
  assert.strictEqual(s.effect, 'Corner denial')
  assert.strictEqual(s.diff, 10)
  assert.strictEqual(s.status, 'notable')
})

test('footprint: a traded player is measured against a team over his time there only', () => {
  // Team X's season: P played its first half; after he left, X scored 30 points per 100
  // with B, who arrived for him. Over P's stint, X scored 60 with him and 40 without.
  const before = [L('PCDEF', 1200, pts(1440, 2400)), L('GCDEF', 400, pts(320, 800))]
  const after = [L('BCDEF', 1600, pts(960, 3200))]
  const x = { season: '2024-25', team: 'X', lineups: [...before, ...after], lineupsFor: id => (id === 'P' ? before : [...before, ...after]) }
  const fp = footprint([x], 'P', LEAGUE, fns)
  assert.strictEqual(fp.effects.find(s => s.key === 'ortg').diff, 20)
  assert.deepStrictEqual(fp.minutes, { on: 1200, off: 400 })
  // B never shared the floor with P's team while P was there, so he isn't a suspect.
  assert.ok(fp.effects.every(s => !s.context || !s.context.mate || s.context.mate.name !== 'Player B'))
})

// P on and off, each half the time with A and half with B. Teammates' 3PA share is 62.5%
// with P on and 40% with him off when A plays; when B plays it's `woOn` with P on.
const anchorCase = woOn => [
  L('PACDE', 600, { t: { FG2A: 500, FG3A: 500 }, poss: 1000, p: { P: { FG2A: 200 } } }),
  L('PBCDE', 600, { t: { FG2A: 1000 - woOn * 8, FG3A: woOn * 8 }, poss: 1000, p: { P: { FG2A: 200 } } }),
  L('GACDE', 600, { t: { FG2A: 600, FG3A: 400 }, poss: 1000 }),
  L('GBCDE', 600, { t: { FG2A: 600, FG3A: 400 }, poss: 1000 })
]
// REMOVE BEST's offense options as Lonestar offers them (starOptionsOf).
const stretch = stars => ({ kind: stars.length === 1 ? 'one' : 'two', team: 'T', stars, seasons: ['2025-26'] })
const withStars = options => ({ ...fns, starOptionsOf: () => options })

test('footprint: REMOVE BEST measures the offense and teammate stats again without each stretch Lonestar offers', () => {
  // Without A, P's swing is the same 22.5: 62.5% of his teammates' shots threes with him
  // on, 40% with him off.
  const fp = footprint(one(anchorCase(62.5)), 'P', LEAGUE, withStars([stretch(['A'])]))
  const o = fp.remove.off[0]
  // Who sits, and P's minutes on and off with him sitting (B's 600 with him, G and B's 600
  // without).
  assert.deepStrictEqual([o.kind, o.team, o.seasons, o.stars, o.min], ['one', 'T', ['2025-26'], [{ id: 'A', name: 'Player A', slug: 'a' }], [600, 600]])
  const t = o.tiles.tm3Rate
  assert.deepStrictEqual([t.on, t.off, t.diff], [62.5, 40, 22.5])
  // Measured as the tile is: lit, its size against the league's swings (bigger than all
  // five here).
  assert.strictEqual(t.status, 'notable')
  assert.strictEqual(t.pctl, 100)
  assert.strictEqual(fp.effects.find(x => x.key === 'tm3Rate').mate, false)
  // A swing that's gone without A is a teammate effect.
  const withA = footprint(one(anchorCase(40)), 'P', LEAGUE, withStars([stretch(['A'])]))
  assert.strictEqual(withA.effects.find(x => x.key === 'tm3Rate').status, 'notable')
  assert.deepStrictEqual([withA.remove.off[0].tiles.tm3Rate.diff, withA.remove.off[0].tiles.tm3Rate.status], [0, 'noise'])
  assert.strictEqual(withA.effects.find(x => x.key === 'tm3Rate').mate, true)
  // An offense option carries the offense and teammate stats only.
  assert.ok(o.tiles.ortg)
  assert.strictEqual(o.tiles.oppRimPts, undefined)
  // ALL (each part over its seasons) is the first pick, the teammate effect read against
  // it; a pair goes without both at once (here one of A and B is always on).
  const all = { kind: 'one', all: true, team: 'T', stars: ['A'], seasons: ['2025-26'], parts: [{ team: 'T', stars: ['A'], seasons: ['2025-26'] }] }
  const three = footprint(one(anchorCase(40)), 'P', LEAGUE, withStars([stretch(['A', 'B']), stretch(['A']), all]))
  assert.deepStrictEqual(three.remove.off.map(x => x.min), [[0, 0], [600, 600], [600, 600]])
  assert.deepStrictEqual(three.remove.off[2].parts, [{ team: 'T', seasons: ['2025-26'], stars: [{ id: 'A', name: 'Player A', slug: 'a' }] }])
  assert.strictEqual(three.effects.find(x => x.key === 'tm3Rate').mate, true)
  // Without Lonestar's stretches, none.
  assert.deepStrictEqual(footprint(one(anchorCase(62.5)), 'P', LEAGUE, fns).remove.off, [])
})

test("footprint: each stat's league range of on values, for the chart", () => {
  // The league's on values against it: a hundred regulars at -4.9 to +5.0; 1st, 50th and 99th
  // percentiles. A stat with none has no range.
  const on = Array.from({ length: 100 }, (_, i) => (i - 49) / 10)
  const league = { ...LEAGUE, drtg: { ...LEAGUE.drtg, on } }
  const fp = footprint(one(anchorCase(62.5)), 'P', league, fns)
  assert.strictEqual(fp.scale.length, STATS.length)
  assert.deepStrictEqual(fp.scale[STATS.findIndex(s => s.key === 'drtg')], [-4.8, 0.1, 5])
  assert.strictEqual(fp.scale[0], null)
})

test('footprint: REMOVE BEST measures the defense stats again without a defensive monster', () => {
  // A and B are defensive monsters by their defensive EPM, B the bigger; C isn't one.
  const depm = { A: { v: 1.6, monster: true }, B: { v: 3.1, monster: true }, C: { v: 0.9, monster: false } }
  const fp = footprint(one(anchorCase(62.5)), 'P', LEAGUE, { ...withStars([stretch(['A'])]), depmOf: id => depm[id] || null })
  // B, with his defensive EPM, over the seasons he anchors, and P's minutes on and off with
  // him sitting; a defense option carries the defense stats, offense keeps its own.
  assert.deepStrictEqual(fp.remove.def.map(o => [o.stars, o.seasons, o.min]), [[[{ id: 'B', name: 'Player B', slug: 'b', depm: 3.1 }], ['2025-26'], [600, 600]]])
  assert.ok(fp.remove.def[0].tiles.drtg)
  assert.strictEqual(fp.remove.def[0].tiles.ortg, undefined)
  assert.deepStrictEqual(fp.remove.off.map(o => o.stars.map(x => x.id)), [['A']])
  // No monster: no defense option.
  const plain = { C: depm.C, D: { v: 0.4, monster: false } }
  assert.deepStrictEqual(footprint(one(anchorCase(62.5)), 'P', LEAGUE, { ...fns, depmOf: id => plain[id] || null }).remove.def, [])
  // A monster himself goes without his next-best defender, monster or not: C (+0.9) over D.
  const self = footprint(one(anchorCase(62.5)), 'P', LEAGUE, { ...fns, depmOf: id => ({ ...plain, P: { v: 3.5, monster: true } })[id] || null })
  assert.deepStrictEqual(self.remove.def.map(o => o.stars.map(x => [x.id, x.depm])), [[['C', 0.9]]])
  // A monster a season: each over his own, then ALL, each season without its own.
  const two = [{ season: '2024-25', team: 'T', lineups: anchorCase(62.5) }, { season: '2025-26', team: 'T', lineups: anchorCase(62.5) }]
  const byYear = (id, season) => ({ A: season === '2024-25' ? depm.A : null, B: season === '2025-26' ? depm.B : null })[id] || null
  const both = footprint(two, 'P', LEAGUE, { ...fns, depmOf: byYear })
  assert.deepStrictEqual(both.remove.def.map(o => [!!o.all, o.stars.map(x => x.id), o.seasons, o.min]), [
    [false, ['A'], ['2024-25'], [600, 600]], [false, ['B'], ['2025-26'], [600, 600]], [true, ['A', 'B'], ['2024-25', '2025-26'], [1200, 1200]]
  ])
})

test('footprint: REMOVE BEST adds the defense options picked by hand, folded into an EPM pick of the same teammates', () => {
  // B is the EPM pick in 2025-26 only; the hand-picked examples sit B over both seasons, A,
  // A and B together, A in a season P didn't play, Z, who never played with him, and A with
  // Z (just A, then).
  const two = [{ season: '2024-25', team: 'T', lineups: anchorCase(62.5) }, { season: '2025-26', team: 'T', lineups: anchorCase(62.5) }]
  const picked = [{ stars: ['B'], seasons: ['2024-25', '2025-26'] }, { stars: ['A'], seasons: ['2025-26'] }, { stars: ['A', 'B'], seasons: ['2025-26'] }, { stars: ['A'], seasons: ['2023-24'] }, { stars: ['Z'], seasons: ['2025-26'] }, { stars: ['A', 'Z'], seasons: ['2024-25'] }]
  const depmOf = (id, season) => (id === 'B' && season === '2025-26' ? { v: 3.1, monster: true } : null)
  const fp = footprint(two, 'P', LEAGUE, { ...fns, depmOf, defExamplesOf: () => picked })
  // B's option now covers both seasons; A follows; A and B together is a pair (no minutes
  // with both sitting); the rest add nothing.
  assert.deepStrictEqual(fp.remove.def.map(o => [o.kind, o.stars.map(x => x.id), o.seasons, o.min]), [
    ['one', ['B'], ['2024-25', '2025-26'], [1200, 1200]], ['one', ['A'], ['2024-25', '2025-26'], [1200, 1200]], ['two', ['A', 'B'], ['2025-26'], [0, 0]]
  ])
})

test("footprint: a lit teammate swing that's his stars' minutes, not his, is a teammate effect", () => {
  // A lifts his teammates' 3PA share to 60% (40% without him) and plays 900 of P's 1,200
  // minutes but only 300 of G's: P's on side is mostly A's minutes. With A on, or off, on
  // both sides, P changes nothing.
  const lineups = [
    L('PACDE', 900, { t: { FG2A: 800, FG3A: 1200 }, poss: 1500 }),
    L('PBCDE', 300, { t: { FG2A: 360, FG3A: 240 }, poss: 500 }),
    L('GACDE', 300, { t: { FG2A: 240, FG3A: 360 }, poss: 500 }),
    L('GBCDE', 900, { t: { FG2A: 1200, FG3A: 800 }, poss: 1500 })
  ]
  const fp = footprint(one(lineups), 'P', LEAGUE, withStars([stretch(['A'])]))
  const e = fp.effects.find(x => x.key === 'tm3Rate')
  assert.strictEqual(e.status, 'notable')
  assert.ok(e.diff > 10, e.diff)
  const t = fp.remove.off[0].tiles.tm3Rate
  assert.deepStrictEqual([t.on, t.off, t.diff], [40, 40, 0])
  assert.deepStrictEqual(fp.remove.off[0].min, [300, 900])
  assert.strictEqual(e.mate, true)
})

test("footprint: over several seasons, the league is the top half of its regulars by minutes", () => {
  // Each season A plays 700 minutes, F 500 and G 400 (B to E play throughout, never off).
  const season = s => ({ season: s, team: 'T', lineups: [L('ABCDE', 700, pts(1540, 1400)), L('FBCDE', 500, pts(1100, 1000)), L('GBCDE', 400, pts(880, 800))] })
  // One season: G's 400 minutes miss the 500-minute gate; A and F are the league.
  assert.strictEqual(leagueSwings([season('2025-26')]).ortg.abs.length, 2)
  // Two: all three clear the gate (1,400, 1,000 and 800), but only A and F reach the
  // median of 1,000.
  assert.strictEqual(leagueSwings([season('2024-25'), season('2025-26')]).ortg.abs.length, 2)
})

test('footprint views: each season he has one in, latest first, then each span of them, each against the league over its seasons', () => {
  // Three seasons on T; in the middle one he plays too little (200 minutes) to stand alone.
  const ts = (season, on) => ({ season, team: 'T', lineups: [L('PCDEF', on, {}), L('GCDEF', 400, {})] })
  const teamSeasons = [ts('2023-24', 600), ts('2024-25', 200), ts('2025-26', 600)]
  assert.deepStrictEqual(footprintSeasons(teamSeasons, 'P'), ['2023-24', '2025-26'])
  const asked = []
  const doc = footprintViews(teamSeasons, 'P', seasons => asked.push(seasons.join()) && LEAGUE, fns)
  assert.deepStrictEqual(doc.seasons, ['2023-24', '2025-26'])
  assert.deepStrictEqual(doc.views.map(v => v.id), ['2025-26', '2023-24', '2023-24..2025-26'])
  // A span takes in every season between its ends, the short one too.
  const span = doc.views[2]
  assert.deepStrictEqual(span.seasons, ['2023-24', '2024-25', '2025-26'])
  assert.deepStrictEqual(span.minutes, { on: 1400, off: 1200 })
  assert.deepStrictEqual(asked, ['2025-26', '2023-24', '2023-24,2024-25,2025-26'])
})

test('footprint: a swing reads by direction, higher better; its size is apart; a style has none', () => {
  // Harden's 2024-26: his team allowed 3.0 more per 100 with him on, a bigger swing than
  // most (its size, 71st) and a worse one than most (17th).
  const { footprintOf } = require('../lib/profile')
  const view = footprintOf('james-harden').views.find(v => v.id === '2024-25..2025-26')
  const drtg = view.effects.find(e => e.key === 'drtg')
  assert.ok(drtg.diff > 0 && drtg.pctl > 50 && drtg.swingPctl < 50, `${drtg.diff} ${drtg.pctl} ${drtg.swingPctl}`)
  const ortg = view.effects.find(e => e.key === 'ortg')
  assert.ok(ortg.diff > 0 && ortg.swingPctl > 50)
  assert.strictEqual(view.effects.find(e => e.key === 'pace').swingPctl, null)
})
