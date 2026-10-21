// A player's Lonestar view: his own stats in his team's minutes with its stars off
// (his best teammates, starsOf), against its minutes with them on (both, for two), in any
// regular season since 1996-97 or span of them (data/lonestar/, scripts/lonestar.js), each
// change ranked among every player's.
//
// Two scenarios: without his top star, and without his top two. Over more than one season
// his stars on a team are its best across them, each season's own as well where they
// differ, and a scenario pools the seasons that have its set. Stats are lib/creation.js's
// (the sheet's Load, Box Creation, Passer Rating, …) on his totals in those minutes, with
// Mates Spacing taken from whoever shared the floor in them; on-court ratings come from
// his plus-minus and the opponents' points while he played.
const fs = require('fs')
const path = require('path')
const { metrics, spacing, inputs, threeProf, matesSpacing } = require('./creation')

const DIR = path.join(__dirname, '..', 'data', 'lonestar')
// Players need this many minutes with the team in a season to count.
const MIN_TEAM = 300
// A change is ranked when both sides have this many minutes.
const MIN_RANK = 250
// A stretch is offered when he has this many minutes with its stars and without them (the
// same floor as for a star he shared the floor with: Harden's 235 with Durant and Irving
// both on show).
const MIN_SAMPLE = 200
// A star is among the league's top STAR_RANK by star score that season, about 1.7 a team
// (of the players in their teams' top four): Maxey's 2022-23 (43rd) is, Eric Gordon's
// 2017-18 (57th), Bosh's 2013-14 (70th) and the 2018-19 Lakers' Kuzma (90th) aren't.
const STAR_RANK = 50
// A player with no height on file (only Passer Rating and Box Creation use it).
const DEFAULT_HEIGHT = 78
const STATS = ['minutes', 'net', 'load', 'pts75', 'rts', 'boxCreation', 'passerRating', 'pa3_75', 'pct3', 'fta75', 'ctov', 'ortg', 'rortg']

// A player's Load from his play-by-play totals alone, where the sheet has no row for the
// season: no position, the default height, and his teammates' spacing taken as the
// league's (Box Creation unscaled). It lands within 0.3 of the sheet's Load at the median
// (2016-17 and 2024-25, docs/data-pull-audit.md #127).
const loadOf = (r, league) => metrics(r, { pos: 0, height: DEFAULT_HEIGHT, mates: 1.09, league }).load

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const decode = (rows, fields) => Object.fromEntries(Object.entries(rows).map(([id, v]) => [id, Object.fromEntries(fields.map((f, i) => [f, v[i]]))]))

// Every team-season on file: { season, team, top, stars, loads, base, sets } (stars: each
// of top's star score, Load, OBPM, and whether he's a star that season, STAR_RANK; loads:
// each of the team's players' sheet Load).
const load = () => {
  if (!fs.existsSync(path.join(DIR, 'league.json'))) return null
  const league = readJson(path.join(DIR, 'league.json')).seasons
  const seasons = Object.keys(league).sort()
  const docs = []
  for (const season of seasons) {
    const dir = path.join(DIR, season)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const d = readJson(path.join(dir, f))
      docs.push({
        season, team: d.team, top: d.top.map(t => t.id),
        stars: Object.fromEntries(d.top.map(t => [t.id, { score: t.score, load: t.load, obpm: t.obpm }])),
        loads: d.loads,
        base: decode(d.base, d.fields),
        sets: Object.fromEntries(Object.entries(d.sets).map(([k, s]) => [k, Object.fromEntries(Object.entries(s).map(([which, rows]) => [which, decode(rows, d.fields)]))]))
      })
    }
  }
  for (const season of seasons) {
    const mine = docs.filter(d => d.season === season)
    const best = new Map()
    for (const d of mine) for (const [id, t] of Object.entries(d.stars)) best.set(id, Math.max(best.get(id) || 0, t.score))
    const scores = [...best.values()].sort((a, b) => b - a)
    const floor = scores[Math.min(STAR_RANK, scores.length) - 1]
    for (const d of mine) for (const t of Object.values(d.stars)) t.star = t.score >= floor
  }
  return { league, seasons, docs }
}

// His stars on a team over the seasons in play (its docs): its stars each season (the
// pull's top four by star score, those in a lead role ahead), ranked over the seasons by star score averaged with each season weighted by his
// own minutes in it (0 in a season one wasn't among its four), and his top two that he
// shared the floor with for MIN_SHARED minutes over them, so a star traded away as he
// arrived isn't one of his. Over one season it's that season's order.
const MIN_SHARED = 200
const MIN_STAR_LOAD = 25
// A lead role: at least a median Load, carried at break-even impact or better (OBPM >= 0,
// so star score Load x (OBPM + 2) at least twice the Load). A gunner with a big Load and a
// poor OBPM only fills in, as a low-Load player does (Lawson and Thornton had led Harden's
// 2015-16 Rockets ahead of Beverley and Howard).
const leads = star => star.load >= MIN_STAR_LOAD && star.score >= 2 * star.load
const sharedWith = (doc, star, id) => {
  const r = doc.sets[star] && doc.sets[star].on[id]
  return r ? r.Minutes || 0 : 0
}
const rankedStars = (docs, id) => {
  const total = docs.reduce((a, d) => a + d.base[id].Minutes, 0)
  const score = new Map()
  const shared = new Map()
  const lead = new Set()
  for (const d of docs) {
    for (const t of d.top) {
      if (t === id || d.stars[t].star === false) continue
      score.set(t, (score.get(t) || 0) + (d.stars[t].score * d.base[id].Minutes) / total)
      shared.set(t, (shared.get(t) || 0) + sharedWith(d, t, id))
      if (leads(d.stars[t])) lead.add(t)
    }
  }
  return [...score.keys()]
    .filter(t => shared.get(t) >= MIN_SHARED)
    .sort((a, b) => lead.has(b) - lead.has(a) || score.get(b) - score.get(a))
}
const starsOf = (docs, id) => rankedStars(docs, id).slice(0, 2)
// His ball competitors in a season: for a player in the league's top quarter by the sheet's
// Load (topLoad), those of the team's four he shared MIN_SHARED minutes with who carry
// BALL_SHARE of his Load or more, are in the top quarter too, and do it at OBPM 0 or
// better, stars or not (Castle and Fox for Harper's 2025-26, Westbrook for LeBron's 2021-22).
const BALL_SHARE = 0.8
const ballOf = (doc, id, league) => {
  const line = league[doc.season].topLoad
  const mine = doc.loads[id]
  if (mine === undefined || mine < line) return []
  return doc.top.filter(t => {
    const s = doc.stars[t]
    return t !== id && s.load >= BALL_SHARE * mine && s.load >= line && s.obpm >= 0 && sharedWith(doc, t, id) >= MIN_SHARED
  })
}

// Every player's counts in a season, his teams' summed: Map(nbaId -> counts).
const seasonTotals = (data, season) => {
  const sum = new Map()
  for (const d of data.docs.filter(x => x.season === season)) {
    for (const [id, r] of Object.entries(d.base)) {
      const s = sum.get(id) || {}
      for (const f of COUNTS) s[f] = (s[f] || 0) + (r[f] || 0)
      sum.set(id, s)
    }
  }
  return sum
}

const COUNTS = ['Minutes', 'OffPoss', 'DefPoss', 'PlusMinus', 'OpponentPoints', 'Points', 'Assists', 'AtRimAssists', 'FG2A', 'FG3A', 'FG3M', 'FTA', 'FtPoints', 'OffRebounds', 'Turnovers']
const tsa = r => (r.FG2A || 0) + (r.FG3A || 0) + 0.44 * (r.FTA || 0)

// His stats on one side (off, on or both) of a scenario, pooled over the slices (one per
// season): counts summed, pbpstats' TS% weighted by true shooting attempts, Mates
// Spacing and the league's values weighted by his minutes.
const side = (slices, id, which, ctx, league) => {
  const parts = slices.map(s => {
    const rows = s.doc.sets[s.key][which]
    const r = rows[id]
    if (!r || !r.Minutes) return null
    // Everyone's season spacing, shared by their minutes in these minutes.
    const total = Object.values(rows).reduce((a, x) => a + (x.Minutes || 0), 0)
    const sp = pid => {
      const b = s.doc.base[pid] || rows[pid]
      const i = inputs(b)
      return spacing(ctx.posOf(pid, s.doc.season), i.pctFt, threeProf(i.pa3, i.pct3))
    }
    const team = Object.entries(rows).reduce((a, [pid, x]) => a + sp(pid) * ((x.Minutes || 0) / total), 0)
    return { r, mates: matesSpacing(sp(id), r.Minutes / total, team), league: league[s.doc.season], season: s.doc.season }
  }).filter(Boolean)
  if (!parts.length) return null
  const sum = Object.fromEntries(COUNTS.map(f => [f, parts.reduce((a, p) => a + (p.r[f] || 0), 0)]))
  const shots = parts.reduce((a, p) => a + tsa(p.r), 0)
  sum.TsPct = shots ? parts.reduce((a, p) => a + (p.r.TsPct || 0) * tsa(p.r), 0) / shots : null
  const w = parts.map(p => p.r.Minutes / sum.Minutes)
  const avg = f => parts.reduce((a, p, i) => a + f(p) * w[i], 0)
  const lg = { ts: avg(p => p.league.ts), rimAstShare: avg(p => p.league.rimAstShare), ortg: avg(p => p.league.ortg) }
  const m = metrics(sum, { pos: ctx.posOf(id, parts[parts.length - 1].season), height: ctx.heightOf(id) || DEFAULT_HEIGHT, mates: avg(p => p.mates), league: lg })
  // Net is ORTG less DRTG (as pbpstats' WOWY has it), not plus-minus per possession: in a
  // short stretch the team can defend many more times than it attacks (Hart without
  // Brunson and Towns: 840 to 789), and plus-minus then overstates the gap (-10.8 vs -4.0).
  const ortg = sum.OffPoss ? (100 * (sum.PlusMinus + sum.OpponentPoints)) / sum.OffPoss : null
  const drtg = sum.DefPoss ? (100 * sum.OpponentPoints) / sum.DefPoss : null
  return {
    minutes: sum.Minutes,
    net: ortg === null || drtg === null ? null : ortg - drtg,
    load: m.load, pts75: m.pts75, rts: m.rts, boxCreation: m.boxCreation, passerRating: m.passerRating,
    pa3_75: m.pa3_75, pct3: m.pct3, fta75: m.fta75, ctov: m.ctov,
    ortg, rortg: ortg === null ? null : ortg - lg.ortg
  }
}

// A player's scenarios: for each team he played for, without each star who mattered over
// the seasons in play, and without each pair. A season's own order of his stars (starsOf
// over it) credits its top star, any within CO_LEAD of his score (co-stars: Curry and
// Durant) and his ball competitors (ballOf) with the player's minutes that season, and its
// top two as a pair with them; a
// star or pair is offered when his credit reaches LEAD_SHARE of the player's minutes with
// the team over the span (Curry led or co-led 94% of Green's Warriors minutes in '13-'23;
// Durant, the lead only in 2018-19, 10%, and Russell, in Curry's lost 2019-20, 6%), or as
// the team's one option when none does. Each offered set pools every season that has it
// (Durant: '17-'19). Each
// compares his minutes with none of them on against those with all of them on: for two,
// with both (the minutes he played with the pair), not with either.
// With `all` (a profile's views, not the league's field) and more than one kept set of a
// kind (`keep`: the view's own test of a stretch's sample), also ALL of them (`all`,
// `parts`): each team-season once, without the kept set it has whose stars scored most
// that season (no minute counted twice); a season with none is left out.
const CO_LEAD = 0.9
const LEAD_SHARE = 0.15
const scenariosOf = (data, id, ctx, { all = false, keep = () => true } = {}) => {
  const teams = new Map()
  for (const doc of data.docs) {
    if (!doc.base[id] || (doc.base[id].Minutes || 0) < MIN_TEAM) continue
    if (!teams.has(doc.team)) teams.set(doc.team, [])
    teams.get(doc.team).push(doc)
  }
  const holds = (doc, sorted) => Object.keys(doc.sets).some(k => k.split(',').sort().join() === sorted)
  const keyOf = (doc, sorted) => Object.keys(doc.sets).find(k => k.split(',').sort().join() === sorted)
  const groups = []
  const setsOf = []
  for (const [team, docs] of teams) {
    const total = docs.reduce((a, d) => a + d.base[id].Minutes, 0)
    const credit = new Map()
    const sets = new Map()
    const give = (set, minutes) => {
      const sorted = [...set].sort().join()
      if (!sets.has(sorted)) sets.set(sorted, set)
      credit.set(sorted, (credit.get(sorted) || 0) + minutes)
    }
    for (const d of docs) {
      const order = rankedStars([d], id)
      const top = d.stars[order[0]]
      const ones = new Set(order.filter(t => leads(d.stars[t]) === leads(top) && d.stars[t].score >= CO_LEAD * top.score))
      for (const t of ballOf(d, id, data.league)) ones.add(t)
      for (const t of ones) give([t], d.base[id].Minutes)
      if (order.length >= 2) give(order.slice(0, 2), d.base[id].Minutes)
    }
    for (const n of [1, 2]) {
      const mine = [...sets].filter(([, set]) => set.length === n)
      const offered = mine.filter(([sorted]) => credit.get(sorted) >= LEAD_SHARE * total)
      const most = mine.sort((a, b) => credit.get(b[0]) - credit.get(a[0]))[0]
      for (const [sorted, set] of offered.length ? offered : most ? [most] : []) {
        // The pull stores each set under its ids in the team's star order; a season where
        // they weren't all among its stars has no such set and sits it out.
        const slices = docs.filter(doc => holds(doc, sorted)).map(doc => ({ doc, key: keyOf(doc, sorted) }))
        if (slices.length) groups.push({ team, sorted, stars: set, kind: n === 1 ? 'one' : 'two', slices })
      }
    }
    setsOf.push({ team, docs })
  }
  const scenario = g => {
    const off = side(g.slices, id, 'off', ctx, data.league)
    const on = side(g.slices, id, g.kind === 'two' ? 'both' : 'on', ctx, data.league)
    if (!off || !on) return null
    const change = Object.fromEntries(STATS.map(k => [k, off[k] === null || on[k] === null ? null : off[k] - on[k]]))
    const extra = g.all ? { all: true, parts: g.parts } : {}
    return { team: g.team, kind: g.kind, stars: g.stars, seasons: [...new Set(g.slices.map(s => s.doc.season))].sort(), off, on, change, ranked: off.minutes >= MIN_RANK && on.minutes >= MIN_RANK, ...extra }
  }
  const out = groups.map(g => ({ g, s: scenario(g) })).filter(x => x.s && keep(x.s))
  for (const n of all ? [1, 2] : []) {
    const owned = []
    const mine = out.filter(x => x.g && x.g.kind === (n === 1 ? 'one' : 'two'))
    for (const { team, docs } of setsOf) {
      for (const doc of docs) {
        const scored = g => g.stars.reduce((a, t) => a + doc.stars[t].score, 0)
        const owner = mine.map(x => x.g).filter(g => g.team === team && holds(doc, g.sorted)).sort((a, b) => scored(b) - scored(a))[0]
        if (owner) owned.push({ team, set: owner.stars, doc, key: keyOf(doc, owner.sorted) })
      }
    }
    const parts = new Map()
    for (const o of owned) {
      const k = `${o.team}:${[...o.set].sort().join()}`
      if (!parts.has(k)) parts.set(k, { team: o.team, stars: o.set, seasons: [] })
      parts.get(k).seasons.push(o.doc.season)
    }
    if (parts.size < 2) continue
    const s = scenario({
      team: new Set(owned.map(o => o.team)).size === 1 ? owned[0].team : null, stars: [...new Set(owned.flatMap(o => o.set))], kind: n === 1 ? 'one' : 'two',
      slices: owned.map(o => ({ doc: o.doc, key: o.key })), all: true, parts: [...parts.values()].map(p => ({ ...p, seasons: p.seasons.sort() }))
    })
    if (s && keep(s)) out.push({ s })
  }
  // Each kind together, ALL first, then by his minutes without.
  return out.map(x => x.s).sort((a, b) => (a.kind === b.kind ? (b.all ? 1 : 0) - (a.all ? 1 : 0) || b.off.minutes - a.off.minutes : a.kind === 'one' ? -1 : 1))
}

// The league's single-season stretches, season by season: every ranked change per
// scenario kind and stat (sorted biggest increase first) and each stat's values (both
// sides of every ranked scenario, ascending). A view is read against the seasons it
// covers (`over(seasons)`: each season's pools, which rankAcross and pctlAcross count
// together), so a 1999-00 stretch is measured against 1999-00's league (threes, pace and
// scoring have moved a long way since) and a rank means the same for a season or a span.
// `scale(seasons)`: each stat's range for the tab to draw values on ([0.1st percentile,
// median, 99.9th percentile] of those seasons' values: linear, so a big change near the
// top still shows as one, and wide enough that stars' own stretches, the tab's usual
// subject, sit inside it).
const leagueOf = (data, ctx) => {
  const bySeason = new Map()
  for (const season of data.seasons) {
    const p = { one: Object.fromEntries(STATS.map(k => [k, []])), two: Object.fromEntries(STATS.map(k => [k, []])), values: Object.fromEntries(STATS.map(k => [k, []])) }
    const one = { ...data, docs: data.docs.filter(d => d.season === season) }
    for (const id of new Set(one.docs.flatMap(d => Object.keys(d.base)))) {
      for (const s of scenariosOf(one, id, ctx)) {
        if (!s.ranked) continue
        for (const k of STATS) {
          if (s.change[k] !== null) p[s.kind][k].push(s.change[k])
          for (const v of [s.on[k], s.off[k]]) if (v !== null) p.values[k].push(v)
        }
      }
    }
    for (const k of STATS) {
      p.one[k].sort((a, b) => b - a)
      p.two[k].sort((a, b) => b - a)
      p.values[k].sort((a, b) => a - b)
    }
    bySeason.set(season, p)
  }
  const of = seasons => seasons.map(s => bySeason.get(s)).filter(Boolean)
  const over = seasons => {
    const ps = of(seasons)
    return { one: k => ps.map(p => p.one[k]), two: k => ps.map(p => p.two[k]), values: k => ps.map(p => p.values[k]) }
  }
  const at = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]
  const scale = seasons => Object.fromEntries(STATS.map(k => {
    const xs = of(seasons).flatMap(p => p.values[k]).sort((a, b) => a - b)
    return [k, xs.length ? [0.001, 0.5, 0.999].map(q => at(xs, q)) : null]
  }))
  return { over, scale }
}

// How many of an ascending pool's values sit below v (strict) or at or below it.
const below = (sorted, v, strict) => {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (strict ? sorted[mid] < v : sorted[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}
// A value's percentile among ascending pools' values together, 0–100: the share below
// it, ties counted half.
const pctlAcross = (pools, v) => {
  const n = pools.reduce((a, p) => a + p.length, 0)
  if (!n) return null
  const lt = pools.reduce((a, p) => a + below(p, v, true), 0)
  const le = pools.reduce((a, p) => a + below(p, v, false), 0)
  return Math.round((100 * (lt + le)) / 2 / n)
}
const pctlIn = (sorted, v) => pctlAcross([sorted], v)

// A change's rank among pools of the league's (each sorted biggest first; 1 = the
// biggest increase), and how many there are.
const rankAcross = (pools, v) => {
  let above = 0
  for (const pool of pools) {
    let lo = 0
    let hi = pool.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pool[mid] > v) lo = mid + 1
      else hi = mid
    }
    above += lo
  }
  return { rank: above + 1, of: pools.reduce((a, p) => a + p.length, 0) }
}
const rankIn = (pool, v) => rankAcross([pool], v)

// The view for the profile: null without data or anything to offer. `seasons` are every
// season he has a stretch in; `views` holds one per season with a stretch to offer, latest
// first (`id` the season), then one per span of them with one, first to last season (`id`
// 'FIRST..LAST'), whose scenarios pool all his seasons in it (scenariosOf); a view's
// `seasons` are his seasons in it. `scale` is
// each stat's league range [low, median, high] over his seasons; each scenario carries its
// stats' percentiles on both sides (`pctl.on`, `pctl.off`) among every ranked
// single-season stretch of the view's seasons, with or without stars, and its changes'
// ranks among every player's single-season changes in them (leagueOf). ctx: { posOf(nbaId,
// season), heightOf(nbaId) (inches), nameOf(nbaId) -> { name, slug, headshot,
// headshotVersion } }.
// What a view over `seasons` offers him: his scenarios there with ALL, each only with
// MIN_SAMPLE minutes with its stars and without them (Harden's 68 without Embiid and Harris
// in his 21 games of 2021-22 aren't). Footprint's REMOVE BEST offers the same.
const offered = (data, id, ctx, seasons) => scenariosOf({ ...data, docs: data.docs.filter(d => seasons.includes(d.season)) }, id, ctx, {
  all: true, keep: s => s.on.minutes >= MIN_SAMPLE && s.off.minutes >= MIN_SAMPLE
})
const lonestar = (data, league, id, ctx) => {
  const pctlOf = (side, lg) => Object.fromEntries(STATS.map(k => [k, side[k] === null ? null : pctlAcross(lg.values(k), side[k])]))
  const dress = (scenarios, seasons) => {
    const lg = league.over(seasons)
    return scenarios.map(s => ({
      ...s,
      stars: s.stars.map(sid => ({ id: sid, ...ctx.nameOf(sid) })),
      ...(s.parts ? { parts: s.parts.map(p => ({ ...p, stars: p.stars.map(sid => ({ id: sid, ...ctx.nameOf(sid) })) })) } : {}),
      ranks: s.ranked ? Object.fromEntries(STATS.filter(k => s.change[k] !== null).map(k => [k, rankAcross(lg[s.kind](k), s.change[k])])) : null,
      pctl: { on: pctlOf(s.on, lg), off: pctlOf(s.off, lg) }
    }))
  }
  const over = seasons => dress(offered(data, id, ctx, seasons), seasons)
  // His seasons are every season he has a stretch in at all, offered or not, so a span
  // pools them all: Curry barely sat in Green's 2015-16, which offers nothing alone, but its
  // minutes count in every span across it. Only views with something to offer are kept (the
  // tab says so of the rest); a player with none anywhere has no view.
  const his = data.seasons.filter(season => scenariosOf({ ...data, docs: data.docs.filter(d => d.season === season) }, id, ctx).length)
  const seasonal = [...his].reverse().map(season => ({ id: season, seasons: [season], scenarios: over([season]) }))
  const spans = his.flatMap((a, i) => his.slice(i + 1).map(b => {
    const seasons = his.filter(s => s >= a && s <= b)
    return { id: `${a}..${b}`, seasons, scenarios: over(seasons) }
  }))
  const views = [...seasonal, ...spans].filter(v => v.scenarios.length)
  if (!views.length) return null
  return { seasons: his, minRank: MIN_RANK, scale: league.scale(his), views }
}

module.exports = { load, loadOf, seasonTotals, scenariosOf, offered, leagueOf, rankIn, pctlIn, lonestar, starsOf, leads, STATS, MIN_RANK, MIN_TEAM, MIN_STAR_LOAD }
