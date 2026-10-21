// A player's footprint: how his team's play changes with him on the floor vs. off it,
// from the five-man lineup totals (scripts/lineups.js), which keep these box-score
// counts for the team (t) and its opponent (o) per lineup. Any on/off split is a sum
// of lineups, so the team's rim points per 100 with him on is 200 · Σ rim makes /
// Σ possessions over the lineups he's in.
//
// It covers whichever seasons it's given: one, or a span of them (footprintViews builds
// both). Each team-season is its own slice: his on−off there is against that team that
// season, and the slices are combined (pooled), so a player who changed teams is never
// compared with a team he wasn't on.
//
// Each stat's on−off swing is tested against its own noise (z, from its sample size)
// and against how large that swing usually is across the league (only swings bigger
// than most players' count), then explained by checking the teammates who most change
// the picture: the one who takes his minutes when he sits and the one he plays with
// most.
const { percentileOf } = require('./percentile')

// Count fields kept per lineup, in this order (pbpstats get-totals names; a field a
// lineup never recorded is missing from its row and counts as 0). Rate fields (*Pct,
// *Frequency, Pace) are never kept: they don't add up across lineups. BASE_FIELDS are the
// ones the daily pbpstats pull has (scripts/lineups.js); a season built from our
// play-by-play (analysis/footprint/footprint_pbp.py) adds the Footprint's own zones: twos
// under 5 ft (Rim) and from 5 to 14 ft (Paint, paint extended), each with the made free
// throws that go with it (an and-one by its make's zone; a fouled miss's two shots split
// by where the shooter's and-ones were that season); and its runouts (possessions begun by a
// steal whose first shot or shooting foul came within 6 s), each with its rim and paint
// makes and free throws.
const BASE_FIELDS = [
  'Points', 'FG2M', 'FG2A', 'FG3M', 'FG3A', 'AtRimFGM', 'AtRimFGA',
  'ShortMidRangeFGM', 'ShortMidRangeFGA', 'LongMidRangeFGM', 'LongMidRangeFGA',
  'Corner3FGM', 'Corner3FGA', 'FTA', 'Turnovers', 'LiveBallTurnovers',
  'OffRebounds', 'DefRebounds', 'Assists', 'Steals', 'Blocks', 'Fouls'
]
const FIELDS = [...BASE_FIELDS, 'RimFTM', 'RimFGM', 'RimFGA', 'PaintFGM', 'PaintFGA', 'PaintFTM',
  'RunoutPoss', 'RunoutRimFGM', 'RunoutRimFTM', 'RunoutPaintFGM', 'RunoutPaintFTM']
// A built season's lineups also keep each player's own counts (`p`, a row per id in
// `ids`' order, trailing zeros dropped, 0 for none), so his teammates are the team less him.
const OWN = ['Points', 'FG2M', 'FG2A', 'FG3M', 'FG3A', 'FTA', 'RimFGM', 'RimFTM']
const I = Object.fromEntries(FIELDS.map((f, i) => [f, i]))
const countsOf = row => BASE_FIELDS.map(f => row[f] || 0)
const addCounts = (a, b) => (a ? a.map((v, i) => v + b[i]) : [...b])

// Totals over a set of lineups; with `id`, also his own counts in them (`me`).
const sumCounts = (lineups, id = null) => {
  const s = { seconds: 0, offPoss: 0, defPoss: 0, t: FIELDS.map(() => 0), o: FIELDS.map(() => 0), me: OWN.map(() => 0) }
  for (const l of lineups) {
    s.seconds += l.seconds
    s.offPoss += l.offPoss
    s.defPoss += l.defPoss
    for (let i = 0; i < FIELDS.length; i++) {
      s.t[i] += l.t[i] || 0
      s.o[i] += l.o[i] || 0
    }
    const row = id && l.p && l.p[l.ids.indexOf(id)]
    if (row) for (let j = 0; j < row.length; j++) s.me[j] += row[j]
  }
  return s
}

const fga = (c) => c[I.FG2A] + c[I.FG3A]
const fgm = (c) => c[I.FG2M] + c[I.FG3M]
// His teammates' counts: the team's less his own, by OWN field name.
const mates = s => Object.fromEntries(OWN.map((f, j) => [f, s.t[I[f]] - s.me[j]]))
const tsaOf = m => m.FG2A + m.FG3A + 0.44 * m.FTA
// Opponents' points in zones ('Rim', under 5 ft; 'Paint', 5 to 14 ft) with their free
// throws, per 100 of their possessions, runouts left out of both.
const setRate = (s, zones) => {
  const sum = field => zones.reduce((x, z) => x + s.o[I[`${z}${field}`]] - s.o[I[`Runout${z}${field}`]], 0)
  const fg = sum('FGM')
  const ft = sum('FTM')
  return { model: 'rate', pts: 2 * fg + ft, sq: 4 * fg + 2 * ft, n: s.defPoss - s.o[I.RunoutPoss] }
}

// Sampling models: how a stat's value and its variance come from counts.
//   prop: a share of `n` trials (binomial).
//   rating: points per 100 possessions (per-possession variance PPP_VAR).
//   ts: true shooting, points over 2·(FGA + 0.44·FTA); its variance by the delta method,
//     a field goal weighing 1 and a free throw 0.44.
//   ft: free throws per FGA (trips are Poisson, two shots each).
//   pace: possessions per 48 minutes.
//   rate: points of one kind per 100 of `n` (possessions, or shots): `pts` points, `sq` the
//     sum of each scoring play's points squared (plays are Poisson; a free throw trip counts
//     as two shots' worth).
const PPP_VAR = 1.4
const prop = (num, den) => ({ model: 'prop', num, den })
const tsOf = m => ({ model: 'ts', pts: m.Points, fg2m: m.FG2M, fg3m: m.FG3M, fga: m.FG2A + m.FG3A, fta: m.FTA })
const STAT = (key, effect, label, side, good, min, noun, measure, extra = {}) => ({ key, effect, label, side, good, min, noun, measure, unit: 'pct', mates: false, needs: [], ...extra })

// The catalogue. effect: what the stat says about how his team plays with him on (a
// team effect such as spacing, not a rating of his own skill; the swing's sign gives the
// direction). good: +1 when a higher value helps his team, -1 when lower helps, 0 when
// neither (shown grey). min: the sample each side needs (in `noun`). mates: measured on
// his teammates only (the team less his own counts; when he sits, everyone is one), so a
// player who takes the team's twos himself doesn't read as moving its shot mix. needs:
// what a season's lineups must keep for it (zones, the Footprint's rim and paint fields;
// runouts; own, the players' own counts);
// without, the stat is left out of that season.
const STATS = [
  STAT('ortg', 'Offensive rating', 'Pts per 100 poss', 'off', 1, 600, 'poss', s => ({ model: 'rating', pts: s.t[I.Points], poss: s.offPoss }), { unit: 'pts' }),
  STAT('cornerRate', 'Corner share', 'Corner share of 3PA', 'off', 1, 200, '3PA', s => prop(s.t[I.Corner3FGA], s.t[I.FG3A])),
  STAT('tovPct', 'Ball security', 'TOV%', 'off', -1, 600, 'poss', s => prop(s.t[I.Turnovers], s.offPoss)),
  STAT('orebPct', 'Offensive glass', 'OREB%', 'off', 1, 250, 'chances', s => prop(s.t[I.OffRebounds], s.t[I.OffRebounds] + s.o[I.DefRebounds])),
  STAT('pace', 'Pace', 'Pace', 'off', 0, 600, 'poss', s => ({ model: 'pace', poss: (s.offPoss + s.defPoss) / 2, seconds: s.seconds }), { unit: 'pace' }),
  STAT('tmTs', 'Shooting efficiency', "Teammates' TS%", 'off', 1, 500, 'TSA', s => tsOf(mates(s)), { mates: true, needs: ['own'] }),
  // Per 100 of their own shots, not of the team's possessions: beside a high-usage player
  // his teammates shoot less, which would read as less rim scoring.
  STAT('rimPts', 'Rim scoring', "Teammates' pts under 5 ft, with their FTs, per 100 shots", 'off', 1, 500, 'TSA', s => {
    const m = mates(s)
    return { model: 'rate', pts: 2 * m.RimFGM + m.RimFTM, sq: 4 * m.RimFGM + 2 * m.RimFTM, n: tsaOf(m) }
  }, { unit: 'shots', mates: true, needs: ['own', 'zones'] }),
  STAT('tm3Rate', 'Three-point share', "Teammates' 3PA share of FGA", 'off', 1, 500, 'FGA', s => {
    const m = mates(s)
    return prop(m.FG3A, m.FG2A + m.FG3A)
  }, { mates: true, needs: ['own'] }),
  STAT('tm3Pct', 'Three-point accuracy', "Teammates' 3P%", 'off', 1, 300, '3PA', s => {
    const m = mates(s)
    return prop(m.FG3M, m.FG3A)
  }, { mates: true, needs: ['own'] }),
  // Both leave out the opponents' runouts, points and possessions: an undefended break off
  // a steal says nothing about protecting the rim.
  STAT('drtg', 'Defensive rating', 'Opp pts per 100 poss', 'def', -1, 600, 'poss', s => ({ model: 'rating', pts: s.o[I.Points], poss: s.defPoss }), { unit: 'pts' }),
  STAT('oppRimPts', 'Rim protection', 'Opponent points and FT points on shots under 5 ft, excluding runouts', 'def', -1, 600, 'poss',
    s => setRate(s, ['Rim']), { unit: 'pts', needs: ['zones', 'runouts'] }),
  STAT('oppPaintPts', 'Paint extended', 'Opponent points and FT points on shots under 14 ft, excluding runouts', 'def', -1, 600, 'poss',
    s => setRate(s, ['Rim', 'Paint']), { unit: 'pts', needs: ['zones', 'runouts'] }),
  // The band past the rim, where floaters, runners and short pull-ups fall.
  STAT('oppFloaterPts', 'Floater range', 'Opponent points and FT points on shots from 5–14 ft, excluding runouts', 'def', -1, 600, 'poss',
    s => setRate(s, ['Paint']), { unit: 'pts', needs: ['zones', 'runouts'] }),
  STAT('oppCorner3', 'Corner denial', 'Opp corner 3PA share of FGA', 'def', -1, 500, 'opp FGA', s => prop(s.o[I.Corner3FGA], fga(s.o))),
  STAT('forcedTov', 'Turnover pressure', 'Forced TOV%', 'def', 1, 600, 'poss', s => prop(s.o[I.Turnovers], s.defPoss)),
  STAT('drebPct', 'Defensive glass', 'DREB%', 'def', 1, 250, 'chances', s => prop(s.t[I.DefRebounds], s.t[I.DefRebounds] + s.o[I.OffRebounds])),
  STAT('oppFtRate', 'Foul discipline', 'Opp FT rate (FTA/FGA)', 'def', -1, 500, 'opp FGA', s => ({ model: 'ft', fta: s.o[I.FTA], fga: fga(s.o) }))
]

// A stat's value (in display units: percent, points per 100, or possessions per 48), its
// sample size, and its variance per unit of sample (so SE = sqrt(v / n)) or its SE, from
// one side's totals.
const measure = (stat, s) => {
  const m = stat.measure(s)
  if (m.model === 'prop') {
    const p = m.den ? m.num / m.den : null
    return { v: p === null ? null : p * 100, n: m.den, p, model: 'prop' }
  }
  if (m.model === 'rating') {
    if (!m.poss) return { v: null, n: 0 }
    return { v: (100 * m.pts) / m.poss, n: m.poss, var: PPP_VAR * 1e4 }
  }
  if (m.model === 'ts') {
    const tsa = m.fga + 0.44 * m.fta
    if (!tsa) return { v: null, n: 0 }
    const T = m.pts / (2 * tsa)
    const ftm = m.pts - 2 * m.fg2m - 3 * m.fg3m
    // Σ(x − 2T·a)² over attempts: x a shot's points (a free throw's 1), a its weight.
    const sq = 4 * m.fg2m + 9 * m.fg3m + ftm
    const xa = 2 * m.fg2m + 3 * m.fg3m + 0.44 * ftm
    const a2 = m.fga + 0.1936 * m.fta
    const se = (100 * Math.sqrt(Math.max(sq - 4 * T * xa + 4 * T * T * a2, 1e-6))) / (2 * tsa)
    return { v: T * 100, n: tsa, se }
  }
  if (m.model === 'ft') {
    if (!m.fga) return { v: null, n: 0 }
    // FTA/FGA with Poisson trips of two: Var(FTA) = 2·FTA.
    return { v: (m.fta / m.fga) * 100, n: m.fga, se: (Math.sqrt(2 * m.fta) / m.fga) * 100 }
  }
  if (m.model === 'rate') {
    if (!m.n) return { v: null, n: 0 }
    return { v: (100 * m.pts) / m.n, n: m.n, se: (100 * Math.sqrt(m.sq)) / m.n }
  }
  if (m.model === 'pace') {
    if (!m.seconds) return { v: null, n: 0 }
    const v = (m.poss * 2880) / m.seconds
    return { v, n: m.poss, se: v / Math.sqrt(Math.max(m.poss, 1)) }
  }
  throw new Error(`unknown model ${m.model}`)
}

// The on−off swing of a stat: values, difference, and z (difference over its
// standard error; binomial stats pool both sides' rate).
const swing = (stat, on, off) => {
  const a = measure(stat, on)
  const b = measure(stat, off)
  const thin = a.n < stat.min || b.n < stat.min || a.v === null || b.v === null
  if (a.v === null || b.v === null) return { on: a.v, off: b.v, diff: null, z: 0, n: { on: a.n, off: b.n }, thin: true }
  let se
  if (a.model === 'prop') {
    const p = (a.p * a.n + b.p * b.n) / (a.n + b.n)
    se = Math.sqrt(p * (1 - p) * (1 / a.n + 1 / b.n)) * 100
  } else if (a.var !== undefined) {
    const v = (a.var * a.n + b.var * b.n) / (a.n + b.n)
    se = Math.sqrt(v * (1 / a.n + 1 / b.n))
  } else {
    se = Math.sqrt(a.se ** 2 + b.se ** 2)
  }
  const diff = a.v - b.v
  return { on: a.v, off: b.v, diff, se, z: se ? diff / se : 0, n: { on: a.n, off: b.n }, thin }
}

// A swing over several slices ([on, off, lg] per team-season, lg the league's value that
// season): each slice's on−off, averaged with weights 1/(1/n_on + 1/n_off) (its effective
// sample), so on − off is that average and a slice with little time on or off counts for
// little. r: his on value against the league's, slice by slice the same way (so a span
// across eras compares each season with its own league). Thin unless both
// sides have the stat's sample in all.
const pooled = (stat, pairs) => {
  const parts = pairs.map(([on, off, lg]) => ({ ...swing(stat, on, off), lg })).filter(s => s.diff !== null)
  const n = { on: parts.reduce((a, s) => a + s.n.on, 0), off: parts.reduce((a, s) => a + s.n.off, 0) }
  if (!parts.length) return { on: null, off: null, diff: null, z: 0, n, thin: true, r: null }
  const w = parts.map(s => 1 / (1 / s.n.on + 1 / s.n.off))
  const W = w.reduce((a, b) => a + b, 0)
  const avg = f => parts.reduce((a, s, i) => a + w[i] * f(s), 0) / W
  const on = avg(s => s.on)
  const off = avg(s => s.off)
  const se = Math.sqrt(parts.reduce((a, s, i) => a + (w[i] * s.se) ** 2, 0)) / W
  const diff = on - off
  const known = parts.every(s => typeof s.lg === 'number')
  const r = known ? on - avg(s => s.lg) : null
  return { on, off, diff, z: se ? diff / se : 0, n, thin: n.on < stat.min || n.off < stat.min, lg: known ? avg(s => s.lg) : null, r }
}

// Points per 100 possessions for and against, on and off (the header's bottom line),
// pooled over slices like a stat (weighted by possessions on and off), and r, the on
// value against the league's slice by slice ([on, off, lg] per slice, lg the league's
// points per 100 possessions that season, the same scored as allowed).
const ratings = pairs => {
  const r = (pts, poss) => (100 * pts) / poss
  const pool = (pts, poss) => {
    const parts = pairs.filter(([on, off]) => poss(on) && poss(off))
    const w = parts.map(([on, off]) => 1 / (1 / poss(on) + 1 / poss(off)))
    const W = w.reduce((a, b) => a + b, 0)
    const avg = f => (W ? parts.reduce((a, p, i) => a + w[i] * f(p), 0) / W : null)
    const on = avg(p => r(pts(p[0]), poss(p[0])))
    const known = W > 0 && parts.every(p => typeof p[2] === 'number')
    return { on, off: avg(p => r(pts(p[1]), poss(p[1]))), r: known ? on - avg(p => p[2]) : null }
  }
  return {
    ortg: pool(s => s.t[I.Points], s => s.offPoss),
    drtg: pool(s => s.o[I.Points], s => s.defPoss)
  }
}

// Players need this much time on and off the floor for a footprint.
const MIN_ON = 500
const MIN_OFF = 300
const split = (lineups, id) => {
  const on = []
  const off = []
  for (const l of lineups) (l.ids.includes(id) ? on : off).push(l)
  return { on, off }
}

// What a team-season's lineups keep (`has`, from its file): `zones`, `runouts`, and `own`, the
// players' own counts. Without `has`, everything.
const ALL = { zones: true, runouts: true, own: true }
const usable = (stat, slices) => slices.filter(s => stat.needs.every(k => s.has[k]))

// A player's slices: each team-season (`{ season, team, lineups, lineupsFor?, has? }`) he
// played in, split into his on and off lineups with their totals (his own counts in the
// on side's). lineupsFor(id), when given, is the team's lineups over his time there (a
// player traded during the season). Each is worked out once per team-season object and
// player: the views over every season and span share them.
const sliceCache = new WeakMap()
const playersOf = ts => {
  if (!sliceCache.has(ts)) sliceCache.set(ts, { ids: new Set(ts.lineups.flatMap(l => l.ids)), slices: new Map() })
  return sliceCache.get(ts)
}
const slicesOf = (teamSeasons, id) => teamSeasons
  .filter(ts => playersOf(ts).ids.has(id))
  .map(ts => {
    const { slices } = playersOf(ts)
    if (!slices.has(id)) {
      const { on, off } = split(ts.lineupsFor ? ts.lineupsFor(id) : ts.lineups, id)
      slices.set(id, { season: ts.season, team: ts.team, has: ts.has || ALL, on, off, ON: sumCounts(on, id), OFF: sumCounts(off) })
    }
    return slices.get(id)
  })
const enough = sl => sl.reduce((a, s) => a + s.ON.seconds, 0) >= MIN_ON * 60 && sl.reduce((a, s) => a + s.OFF.seconds, 0) >= MIN_OFF * 60
// A stat's pairs over his slices that keep what it needs: [on, off, the league's value].
const pairsOf = (stat, slices, ref) => usable(stat, slices).map(s => [s.ON, s.OFF, ref.bySeason ? ref.bySeason[s.season] : undefined])

// The league reference per stat over the team-seasons: the league's value each season
// (bySeason, for r) and over them all (lg, a meter's tick), and every regular player's
// pooled swing: the sorted |swings| (a swing's percentile), the sorted swings (`swing`, for
// a swing's place) and sorted on values against the league (`on`: r, for where his on
// value ranks). A regular player is one over the
// minutes gates; over several seasons, also in the top half of those by minutes on the
// floor across them (at or above their median), so a span's league isn't made of short
// stints.
const onSeconds = sl => sl.reduce((a, s) => a + s.ON.seconds, 0)
const leagueSwings = teamSeasons => {
  const abs = Object.fromEntries(STATS.map(s => [s.key, []]))
  const on = Object.fromEntries(STATS.map(s => [s.key, []]))
  const swings = Object.fromEntries(STATS.map(s => [s.key, []]))
  const bySeason = {}
  const lg = {}
  // Totals of the team-seasons keeping what a stat needs, in a season or (null) all.
  const sums = new Map()
  const kept = needs => teamSeasons.filter(ts => needs.every(k => (ts.has || ALL)[k]))
  const sumOf = (needs, season) => {
    const key = `${needs.join()}|${season}`
    if (!sums.has(key)) sums.set(key, sumCounts(kept(needs).filter(ts => season === null || ts.season === season).flatMap(ts => ts.lineups)))
    return sums.get(key)
  }
  for (const stat of STATS) {
    bySeason[stat.key] = {}
    for (const season of new Set(kept(stat.needs).map(ts => ts.season))) bySeason[stat.key][season] = measure(stat, sumOf(stat.needs, season)).v
    lg[stat.key] = kept(stat.needs).length ? measure(stat, sumOf(stat.needs, null)).v : null
  }
  const where = new Map()
  for (const ts of teamSeasons) for (const id of playersOf(ts).ids) where.set(id, [...(where.get(id) || []), ts])
  let regulars = [...where].map(([id, mine]) => slicesOf(mine, id)).filter(enough)
  if (new Set(teamSeasons.map(ts => ts.season)).size > 1 && regulars.length) {
    const mins = regulars.map(onSeconds).sort((a, b) => a - b)
    const mid = mins.length / 2
    const median = mins.length % 2 ? mins[Math.floor(mid)] : (mins[mid - 1] + mins[mid]) / 2
    regulars = regulars.filter(sl => onSeconds(sl) >= median)
  }
  for (const sl of regulars) {
    for (const stat of STATS) {
      const sw = pooled(stat, pairsOf(stat, sl, { bySeason: bySeason[stat.key] }))
      if (sw.thin) continue
      abs[stat.key].push(Math.abs(sw.diff))
      swings[stat.key].push(sw.diff)
      if (sw.r !== null) on[stat.key].push(sw.r)
    }
  }
  const sorted = xs => [...xs].sort((a, b) => a - b)
  return Object.fromEntries(STATS.map(stat => [stat.key, { abs: sorted(abs[stat.key]), swing: sorted(swings[stat.key]), on: sorted(on[stat.key]), lg: lg[stat.key], bySeason: bySeason[stat.key] }]))
}

// The bar a swing must clear: |z| and the share of the league's swings it must exceed.
const Z_MIN = 2.5
const PCTL_MIN = 75

// The teammate skill that can move each stat: `skill` is a sheet percentile column or a
// pbpstats player rate (data/player-totals.json, scripts/player-totals.js), `noun` what
// to call a player by it, and `dir` the way a player strong in it moves his team's stat
// (+1 up, −1 down). Pace and corner denial have no individual measure, so any
// teammate whose minutes move with his is checked for those.
const SKILLS = {
  ortg: { skill: 'OBPM', noun: 'offensive player', dir: 1 },
  cornerRate: { skill: 'corner3PAPer36', noun: 'corner shooter', dir: 1 },
  tovPct: { skill: 'cTOV%', noun: 'ball-secure creator', dir: -1 },
  orebPct: { skill: 'orebPct', noun: 'offensive rebounder', dir: 1 },
  tmTs: { skill: 'rTS%', noun: 'efficient scorer', dir: 1 },
  rimPts: { skill: 'Rim FGA', noun: 'rim attacker', dir: 1 },
  tm3Rate: { skill: '3yr C&S 3s/36', noun: 'spot-up shooter', dir: 1 },
  tm3Pct: { skill: '3yr C&S 3%', noun: 'catch-and-shoot shooter', dir: 1 },
  oppRimPts: { skill: '2yr Def FGA Diff%', noun: 'rim protector', dir: -1 },
  oppPaintPts: { skill: '2yr Def FGA Diff%', noun: 'rim protector', dir: -1 },
  oppFloaterPts: { skill: '2yr Def FGA Diff%', noun: 'interior defender', dir: -1 },
  oppFtRate: { skill: 'shootingFoulsPer100', noun: 'shooting fouler', dir: 1 },
  forcedTov: { skill: 'FTOV', noun: 'turnover-forcer', dir: 1 },
  drebPct: { skill: 'drebPct', noun: 'defensive rebounder', dir: 1 }
}

const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const pct = x => Math.round(x * 100)
// "an 83rd", "an 11th", "an 8th"; "a 95th".
const article = n => (n === 8 || n === 11 || n === 18 || (n >= 80 && n < 90) ? 'an' : 'a')

// Teammates whose minutes move with his, over all his slices: a partner's share of the
// floor is SHIFT higher with him on than off, a replacement's SHIFT higher when he sits
// (each with SHIFT_MIN minutes in that state). Only these can tilt his on−off; one who
// plays the same share either way can't. Those whose minutes move most come first.
const SHIFT = 0.15
const SHIFT_MIN = 150
const mateShifts = (slices, id) => {
  const on = slices.flatMap(s => s.on)
  const off = slices.flatMap(s => s.off)
  const secOn = on.reduce((a, l) => a + l.seconds, 0)
  const secOff = off.reduce((a, l) => a + l.seconds, 0)
  const withOn = new Map()
  const withOff = new Map()
  for (const l of on) for (const m of l.ids) if (m !== id) withOn.set(m, (withOn.get(m) || 0) + l.seconds)
  for (const l of off) for (const m of l.ids) withOff.set(m, (withOff.get(m) || 0) + l.seconds)
  return [...new Set([...withOn.keys(), ...withOff.keys()])]
    .map(m => {
      const a = withOn.get(m) || 0
      const b = withOff.get(m) || 0
      const shift = a / secOn - b / secOff
      if (shift >= SHIFT && a >= SHIFT_MIN * 60) return { id: m, kind: 'partner', share: a / secOn, shift }
      if (-shift >= SHIFT && b >= SHIFT_MIN * 60) return { id: m, kind: 'replacement', share: b / secOff, shift: -shift }
      return null
    })
    .filter(Boolean)
    .sort((x, y) => y.shift - x.shift)
}

// The teammates who could explain a swing: those whose minutes move with his and who
// stand out (OUTLIER percentile points from either end) in the skill behind the stat,
// in the direction of the swing. A strong shot blocker beside him can make his team's
// block rate rise with him on; a strong one in his minutes when he sits can make it
// fall. A weak one works the other way round.
const OUTLIER = 30
const suspectsOf = (stat, diff, slices, mates, skillOf) => {
  const s = SKILLS[stat.key]
  if (!s) return mates.map(m => ({ ...m, p: null }))
  // His skill in the latest of these seasons they played together.
  const seasonWith = m => [...slices].reverse().find(x => x.on.some(l => l.ids.includes(m)) || x.off.some(l => l.ids.includes(m))).season
  return mates
    .map(m => ({ ...m, p: skillOf(m.id, s.skill, seasonWith(m.id)) }))
    .filter(m => {
      if (m.p === null || m.p === undefined) return false
      const push = s.dir * (m.p >= 100 - OUTLIER ? 1 : m.p <= OUTLIER ? -1 : 0)
      return push * Math.sign(diff) * (m.kind === 'partner' ? 1 : -1) > 0
    })
}

// Why a swing looks the way it does. A check explains it when the gap left without the
// teammate is under half the swing (or flips): his on value against the off minutes
// without his replacement (replacement), or on against off with his partner off on both
// sides, so the partner is held constant (partner); each pooled over his slices like the
// swing (in a season the teammate wasn't there, the check is the plain on−off). Otherwise
// it holds (own: no suspect explains it, or there's no suspect), or no suspect could be
// checked (thin).
const EXPLAINS = 0.5
// A slice's lineups' totals without a teammate, kept per lineup list (a slice's on or off)
// for the views that share the slice.
const withoutCache = new WeakMap()
const contextOf = (stat, sw, slices, mates, { nameOf, skillOf }, id) => {
  const skill = SKILLS[stat.key]
  const suspects = suspectsOf(stat, sw.diff, slices, mates, skillOf)
  const without = (lineups, m) => {
    if (!withoutCache.has(lineups)) withoutCache.set(lineups, new Map())
    const sums = withoutCache.get(lineups)
    if (!sums.has(m)) sums.set(m, sumCounts(lineups.filter(l => !l.ids.includes(m)), id))
    return sums.get(m)
  }
  const checks = []
  for (const m of suspects) {
    if (m.kind === 'replacement') {
      const a = pooled(stat, slices.map(s => [s.ON, without(s.off, m.id)]))
      if (a.n.off < stat.min / 2 || a.diff === null) continue
      checks.push({ ...m, on: a.on, off: a.off, gap: a.diff, keep: a.diff / sw.diff })
    } else {
      const b = pooled(stat, slices.map(s => [without(s.on, m.id), without(s.off, m.id)]))
      if (b.n.on < stat.min / 2 || b.n.off < stat.min / 2 || b.diff === null) continue
      checks.push({ ...m, on: b.on, off: b.off, gap: b.diff, keep: b.diff / sw.diff })
    }
  }
  const name = m => nameOf(m.id).name || 'a teammate'
  const desc = m => (m.p === null ? '' : `, ${article(m.p)} ${ordinal(m.p)}-percentile ${skill.noun}`)
  const checkOf = c => ({ kind: c.kind, on: c.on, off: c.off, gap: c.gap })
  const explaining = checks.filter(c => c.keep < EXPLAINS).sort((a, b) => a.keep - b.keep)[0]
  if (explaining) {
    const c = explaining
    if (c.kind === 'replacement') {
      return {
        kind: 'replacement', mate: c.id, check: checkOf(c),
        text: `When he sits, ${name(c)} plays ${pct(c.share)}% of those minutes${desc(c)}. With ${name(c)} also off, the gap is ${signed(c.gap)}.`
      }
    }
    return {
      kind: 'partner', mate: c.id, check: checkOf(c),
      text: `Most of it comes alongside ${name(c)}${desc(c)}, who shares ${pct(c.share)}% of his minutes: with ${name(c)} off the floor, the gap is ${signed(c.gap)}.`
    }
  }
  if (checks.length) {
    const named = checks.slice(0, 2)
    const parts = named.map(c => (c.kind === 'partner'
      ? `without ${name(c)}${desc(c)} (${signed(c.gap)})`
      : `with ${name(c)}${desc(c) && `${desc(c)},`} also off (${signed(c.gap)})`))
    return { kind: 'own', mate: named[0].id, check: checkOf(named[0]), text: `Holds ${parts.join(', and ')}.` }
  }
  if (suspects.length) {
    const m = suspects[0]
    return { kind: 'thin', mate: m.id, check: null, text: `Too few minutes apart from ${name(m)}${desc(m) && `${desc(m)},`} to check whether it's his.` }
  }
  return {
    kind: 'own', mate: null, check: null,
    text: skill ? `No teammate whose minutes move with his is an outlier ${skill.noun}, good or bad, so none explains it.` : `No teammate's minutes move with his enough to explain it.`
  }
}

const round1 = v => (v === null || v === undefined ? null : Math.round(v * 10) / 10)
// Each stat's league range of on values against the league, [1st, 50th, 99th percentile]
// of the regulars' (catalogue order; null where none), for the tab's chart of a tile's off
// and on values about the league's. A view's depends on its seasons alone.
const SCALE_QS = [0.01, 0.5, 0.99]
const scaleOf = league => STATS.map(st => {
  const xs = league[st.key].on
  return xs && xs.length ? SCALE_QS.map(q => round1(xs[Math.min(xs.length - 1, Math.floor(q * xs.length))])) : null
})

// REMOVE BEST (LONE in the code): each stat measured again over only the minutes some of
// his teammates sit (loneOf), an option apiece, each a Map(slice -> the ids that sit there).
// The offense and teammate stats' options are the stretches Lonestar offers him over the
// same seasons (starOptionsOf), each over the team-seasons it covers. The defense stats'
// are a defensive monster per slice (anchorOf with defValueOf: Duncan beside Parker in
// 2005-06), each one over the seasons he anchors, and all of them combined, each season
// without its own, when there are several.
// A slice's defensive anchor: the teammate valued most that season (valueOf(nbaId, season),
// a number or null for none) among those on the floor for ANCHOR_SHARE of the slice's
// minutes, ties to minutes.
const ANCHOR_SHARE = 0.25
const anchorOf = (s, id, valueOf) => {
  const secs = new Map()
  for (const l of [...s.on, ...s.off]) for (const m of l.ids) if (m !== id) secs.set(m, (secs.get(m) || 0) + l.seconds)
  const total = s.ON.seconds + s.OFF.seconds
  let best = null
  for (const [m, sec] of secs) {
    if (sec < ANCHOR_SHARE * total) continue
    const v = valueOf(m, s.season)
    if (typeof v !== 'number') continue
    if (!best || v > best.v || (v === best.v && sec > best.sec)) best = { id: m, v, sec }
  }
  return best ? best.id : null
}
// The defense stats' anchor's value in a season: a teammate's defensive EPM (depmOf(nbaId,
// season) -> { v, monster } or null) when he's a defensive monster; for a player who is
// one himself, any teammate's, so his anchor is his next-best defender.
const defValueOf = (id, season, depmOf) => {
  const self = depmOf(id, season)
  return (m, s) => {
    const d = depmOf(m, s)
    return d && (d.monster || (self && self.monster)) ? d.v : null
  }
}
// A team-season's lineups with none of a set of teammates on the floor: his on side's (his
// own counts in it) and his off side's totals, kept per set for the views that share the
// slice.
const sitsOf = (s, set, id) => {
  const key = [...set].sort().join()
  s.sits = s.sits || new Map()
  const out = l => !set.some(a => l.ids.includes(a))
  if (!s.sits.has(key)) s.sits.set(key, [sumCounts(s.on.filter(out), id), sumCounts(s.off.filter(out))])
  return s.sits.get(key)
}
// LONE: a stat over only the minutes an option's teammates sit (`sets`; off the floor on
// both sides), pooled over the team-seasons it covers, measured as the effect is: its
// status (thin when a side is under half the stat's sample), his team's value on and off,
// the swing, the on value against the league and its percentile, and the swing's z and
// percentile. `mate`: a lit swing that keeps under EXPLAINS of itself there (or turns
// round), against his whole on−off over the same team-seasons: most of it is those
// teammates' minutes, a teammate effect.
const loneOf = (stat, slices, sets, id, ref, lit) => {
  const kept = slices.filter(s => sets.get(s))
  if (!kept.length) return null
  const lg = s => (ref.bySeason ? ref.bySeason[s.season] : undefined)
  const pairs = kept.map(s => [...sitsOf(s, sets.get(s), id), lg(s)])
  const x = pooled(stat, pairs)
  const pctl = x.diff === null ? null : percentileOf(Math.abs(x.diff), ref.abs)
  const thin = x.n.on < stat.min / 2 || x.n.off < stat.min / 2
  const status = x.diff === null ? 'na' : thin ? 'thin' : Math.abs(x.z) < Z_MIN ? 'noise' : pctl < PCTL_MIN ? 'typical' : 'notable'
  const shown = status !== 'na' && status !== 'thin'
  const raw = pooled(stat, kept.map(s => [s.ON, s.OFF, lg(s)]))
  return {
    lone: {
      status,
      on: round1(x.on),
      off: round1(x.off),
      diff: round1(x.diff),
      lg: round1(x.lg),
      r: round1(x.r),
      onPctl: shown ? onPctlOf(stat, x.r, ref.on) : null,
      z: round1(x.z),
      pctl: shown ? pctl : null,
      swingPctl: shown ? swingPctlOf(stat, x.diff, ref.swing) : null
    },
    mate: !!lit && shown && !!raw.diff && x.diff / raw.diff < EXPLAINS
  }
}

// Where an on value against the league ranks among the league's (`pool`), read the way the
// stat is: fewest points allowed is the 100th percentile.
const onPctlOf = (stat, r, pool) => (r === null || !pool || !pool.length ? null : percentileOf(r, pool, stat.good < 0))
// His swing's percentile among the league's, by direction (higher is better: a defensive
// rating 5.0 worse on than off is about the 5th, where \`pctl\`, its size either way, is the
// 95th); none for a style, which has no better side.
const swingPctlOf = (stat, diff, pool) => (!stat.good || diff === null || !pool || !pool.length ? null : percentileOf(diff, pool, stat.good < 0))
// A swing's place among the league's (`pool`), counted from the nearer end, as [place, of,
// 'best' | 'worst'] (best: the end that helps his team), for the tile's badge and medal; a
// style stat helps neither way, so has none.
const swingPlaceOf = (stat, diff, pool) => {
  if (!stat.good || diff === null || !pool || !pool.length) return null
  const better = pool.filter(x => (stat.good > 0 ? x > diff : x < diff)).length
  const worse = pool.filter(x => (stat.good > 0 ? x < diff : x > diff)).length
  return better <= worse ? [1 + better, pool.length, 'best'] : [1 + worse, pool.length, 'worst']
}

// The footprint of player `id` over team-seasons (`{ season, team, lineups, has? }`; the
// ones he played in are used), against the league reference.
// nameOf(nbaId) -> { name, slug }; skillOf(nbaId, sheetColumn, season) -> percentile or
// null; starOptionsOf(nbaId, seasons) -> the stretches Lonestar offers him over them ({ kind:
// 'one' | 'two', team, stars, seasons, all?, parts? }; without it, no offense options);
// depmOf(nbaId, season) -> { v: his defensive EPM that season, monster: whether he's a
// defensive monster } or null (without it, no defense options).
const footprint = (teamSeasons, id, league, fns) => {
  const slices = slicesOf(teamSeasons, id).sort((a, b) => a.season.localeCompare(b.season))
  if (!enough(slices)) return null
  const lgRating = league.ortg.bySeason
  const pairs = slices.map(s => [s.ON, s.OFF, lgRating ? lgRating[s.season] : undefined])
  const mates = mateShifts(slices, id)
  // Each option's sets: its parts' (a stretch is its own one part) stars over their
  // team-seasons.
  const setsOf = parts => new Map(slices.flatMap(s => parts.filter(p => p.team === s.team && p.seasons.includes(s.season)).map(p => [s, p.stars])))
  const seasons = [...new Set(teamSeasons.map(ts => ts.season))].sort()
  const offOptions = (fns.starOptionsOf ? fns.starOptionsOf(id, seasons) : []).map(x => ({ ...x, sets: setsOf(x.all ? x.parts : [x]) }))
  const defAnchors = new Map(slices.map(s => [s, fns.depmOf ? anchorOf(s, id, defValueOf(id, s.season, fns.depmOf)) : null]))
  const named = new Map()
  for (const s of slices) {
    const a = defAnchors.get(s)
    if (a) named.set(a, [...(named.get(a) || []), s])
  }
  const teamOf = sl => (new Set(sl.map(s => s.team)).size === 1 ? sl[0].team : null)
  const defOptions = [...named].map(([a, sl]) => ({ kind: 'one', team: teamOf(sl), stars: [a], seasons: [...new Set(sl.map(s => s.season))], sets: new Map(sl.map(s => [s, [a]])) }))
  if (defOptions.length > 1) {
    const each = [...defAnchors].filter(([, a]) => a)
    defOptions.push({ kind: 'one', all: true, team: teamOf(each.map(([s]) => s)), stars: defOptions.flatMap(o => o.stars), seasons: [...new Set(each.map(([s]) => s.season))], parts: defOptions.map(({ team, stars, seasons: ss }) => ({ team, stars, seasons: ss })), sets: new Map(each.map(([s, a]) => [s, [a]])) })
  }
  // Defense options picked by hand (defExamplesOf(nbaId) -> [{ stars, seasons }]), for the
  // seasons EPM doesn't cover or a teammate it doesn't pick: each over the view's slices in
  // its seasons where one of its teammates played (Kemp's 1996-97, Baker's 1997-98: none of
  // them on the floor), folded into the same teammates' EPM pick where there is one. ALL
  // stays the EPM picks'.
  const plays = (s, stars) => [...s.on, ...s.off].some(l => stars.some(m => l.ids.includes(m)))
  for (const ex of fns.defExamplesOf ? fns.defExamplesOf(id) : []) {
    const sl = slices.filter(s => ex.seasons.includes(s.season) && plays(s, ex.stars))
    // Named only if he played in them: Payton's 1997-98 alone is without Baker.
    const stars = ex.stars.filter(m => sl.some(s => plays(s, [m])))
    if (!sl.length) continue
    const key = [...stars].sort().join()
    const same = defOptions.find(o => !o.all && [...o.stars].sort().join() === key)
    if (!same) {
      defOptions.push({ kind: stars.length === 1 ? 'one' : 'two', team: teamOf(sl), stars, seasons: [...new Set(sl.map(s => s.season))], sets: new Map(sl.map(s => [s, stars])) })
      continue
    }
    for (const s of sl) same.sets.set(s, same.stars)
    same.seasons = [...new Set([...same.seasons, ...sl.map(s => s.season)])].sort()
    same.team = teamOf([...same.sets.keys()])
  }
  // The teammate effect is read against each side's first pick: its top stars combined
  // (ALL) where it has them, else its first.
  const firstOf = options => options.find(o => o.all && o.kind === 'one') || options.find(o => o.kind === 'one') || options[0]
  const first = { off: firstOf(offOptions), def: firstOf(defOptions) }
  // Every effect, in catalogue order, with how it fared: notable (clears the noise and
  // stands out against the league's swings; checked against his teammates), noise (under
  // the |z| bar), typical (real, but a common swing league-wide), thin (too few attempts
  // on a side) or na (his seasons' lineups don't keep what it needs).
  const effects = STATS.map((stat, i) => {
    const ref = league[stat.key]
    const mine = usable(stat, slices)
    const sw = pooled(stat, pairsOf(stat, mine, ref))
    const pctl = sw.diff === null ? null : percentileOf(Math.abs(sw.diff), ref.abs)
    const status = !mine.length ? 'na' : sw.thin ? 'thin' : Math.abs(sw.z) < Z_MIN ? 'noise' : pctl < PCTL_MIN ? 'typical' : 'notable'
    const ctx = status === 'notable' ? contextOf(stat, sw, mine, mates, fns, id) : null
    const o = first[stat.side]
    const l = o && status !== 'na' ? loneOf(stat, mine, o.sets, id, ref, status === 'notable') : null
    return {
      key: stat.key,
      num: i + 1,
      effect: stat.effect,
      label: stat.label,
      side: stat.side,
      mates: stat.mates,
      unit: stat.unit,
      good: stat.good,
      status,
      on: round1(sw.on),
      off: round1(sw.off),
      diff: round1(sw.diff),
      lg: round1(sw.lg === null || sw.lg === undefined ? ref.lg : sw.lg),
      r: round1(sw.r),
      onPctl: status === 'na' || status === 'thin' ? null : onPctlOf(stat, sw.r, ref.on),
      // Placed only where the tile lights, so a badge is never on a swing the tab calls noise.
      rank: status === 'notable' ? swingPlaceOf(stat, sw.diff, ref.swing) : null,
      n: { on: Math.round(sw.n.on), off: Math.round(sw.n.off), noun: stat.noun },
      z: round1(sw.z),
      pctl,
      swingPctl: status === 'na' || status === 'thin' ? null : swingPctlOf(stat, sw.diff, ref.swing),
      mate: l ? l.mate : false,
      context: ctx && {
        kind: ctx.kind,
        mate: ctx.mate ? nameOfMate(ctx.mate, fns) : null,
        text: ctx.text,
        check: ctx.check && { kind: ctx.check.kind, on: round1(ctx.check.on), off: round1(ctx.check.off), gap: round1(ctx.check.gap) }
      }
    }
  })
  const r = ratings(pairs)
  const minutes = (ON, OFF) => ({ on: Math.round(ON.seconds / 60), off: Math.round(OFF.seconds / 60) })
  // An option as the tab lists it: who sits (each named, a defensive anchor with his
  // defensive EPM, the mean over the seasons he anchors), its team and seasons (ALL: its
  // parts'), his minutes on and off the floor while they sit, and each of its side's stats
  // over those minutes (`tiles`, by key; none where the stat's lineups don't keep it), each
  // with whether its lit swing is mostly those teammates' minutes (`mate`).
  const who = sl => sl.map(m => ({ id: m, ...nameOfMate(m, fns) }))
  const depmOver = (m, ss) => {
    const vs = ss.map(season => fns.depmOf(m, season)).filter(Boolean).map(d => d.v)
    return vs.length ? Math.round((100 * vs.reduce((a, v) => a + v, 0)) / vs.length) / 100 : null
  }
  const optionOf = (o, side) => {
    const sits = [...o.sets].map(([s, set]) => sitsOf(s, set, id))
    const tiles = {}
    for (const stat of STATS.filter(x => x.side === side)) {
      const ref = league[stat.key]
      const mine = usable(stat, slices)
      const sw = pooled(stat, pairsOf(stat, mine, ref))
      const lit = effects.find(e => e.key === stat.key).status === 'notable'
      const l = sw.diff === null ? null : loneOf(stat, mine, o.sets, id, ref, lit)
      if (l) tiles[stat.key] = { ...l.lone, mate: l.mate }
    }
    return {
      kind: o.kind,
      ...(o.all ? { all: true } : {}),
      team: o.team,
      seasons: o.seasons,
      stars: side === 'def' && !o.all ? o.stars.map(m => ({ id: m, ...nameOfMate(m, fns), depm: depmOver(m, o.seasons) })) : who(o.stars),
      ...(o.parts ? { parts: o.parts.map(p => ({ team: p.team, seasons: p.seasons, stars: who(p.stars) })) } : {}),
      min: [Math.round(sits.reduce((x, [on]) => x + on.seconds, 0) / 60), Math.round(sits.reduce((x, [, off]) => x + off.seconds, 0) / 60)],
      tiles
    }
  }
  return {
    spans: slices.map(s => ({ season: s.season, team: s.team, minutes: minutes(s.ON, s.OFF) })),
    minutes: minutes(sumCounts(slices.flatMap(s => s.on)), sumCounts(slices.flatMap(s => s.off))),
    ortg: { on: round1(r.ortg.on), off: round1(r.ortg.off), r: round1(r.ortg.r) },
    drtg: { on: round1(r.drtg.on), off: round1(r.drtg.off), r: round1(r.drtg.r) },
    remove: { off: offOptions.map(o => optionOf(o, 'off')), def: defOptions.map(o => optionOf(o, 'def')) },
    scale: scaleOf(league),
    effects
  }
}
const nameOfMate = (id, { nameOf }) => {
  const m = nameOf(id)
  return { name: m.name || null, slug: m.slug || null, ...(m.face ? { face: m.face } : {}) }
}

// The seasons in which he has a footprint on his own (enough minutes on and off that
// season).
const footprintSeasons = (teamSeasons, id) => [...new Set(teamSeasons.map(ts => ts.season))].sort()
  .filter(season => enough(slicesOf(teamSeasons.filter(ts => ts.season === season), id)))

// His footprint for each season he has one in, latest first, then for each span of them
// (first..last, every season between, and its id 'first..last'); each against the league
// over the same seasons (leagueOf(seasons) -> leagueSwings of their team-seasons).
const footprintViews = (teamSeasons, id, leagueOf, fns) => {
  const his = footprintSeasons(teamSeasons, id)
  const all = [...new Set(teamSeasons.map(ts => ts.season))].sort()
  const view = (vid, seasons) => ({ id: vid, seasons, ...footprint(teamSeasons.filter(ts => seasons.includes(ts.season)), id, leagueOf(seasons), fns) })
  const seasonal = [...his].reverse().map(s => view(s, [s]))
  const spans = his.flatMap((a, i) => his.slice(i + 1).map(b => view(`${a}..${b}`, all.filter(s => s >= a && s <= b))))
  return { seasons: his, views: [...seasonal, ...spans] }
}

module.exports = { BASE_FIELDS, FIELDS, OWN, countsOf, addCounts, sumCounts, STATS, measure, swing, ratings, leagueSwings, scaleOf, footprint, footprintSeasons, footprintViews, MIN_ON, MIN_OFF, Z_MIN }
