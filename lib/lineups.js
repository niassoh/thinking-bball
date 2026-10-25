// A player's season in lineups, from a team's five-man lineup totals
// (scripts/lineups.js). Every second of play sits in exactly one five-man
// lineup, so any group's totals are the sum over the lineups that contain it.

// Unit sizes the site offers (2-man pairs up to full five-man lineups).
const SIZES = [2, 3, 4, 5]

// Each unit size's minutes floor is set so about `pool` units in the league clear it:
// the minutes of the pool-th most-played unit, rounded down to a round `step`. That
// keeps each ranking pool near the same size as minutes pile up over a season.
const FLOOR_RULES = { 2: { pool: 300, step: 50 }, 3: { pool: 300, step: 50 }, 4: { pool: 200, step: 25 }, 5: { pool: 100, step: 10 } }
const MATES = 5

// The minutes minimum a reader can pick for each size, in 50-minute steps (the site's
// menu). The lowest is the smallest step that leaves at most POOL_MAX league units, so
// the tooltip's swarm never draws more than that (2025-26: 650 pairs, 400 three-man,
// 150 four-man, 50 five-man); it rises as minutes pile up. The league pool and each
// player's candidate units go down to it. The highest still leaves a few dozen league
// units to rank against (2025-26: 115 pairs, 72 three-man, 74 four-man, 37 five-man).
const STEP = 50
const POOL_MAX = 500
const FLOOR_MAX = { 2: 1200, 3: 800, 4: 400, 5: 150 }
const REGULAR_RULES = { floors: FLOOR_RULES, step: STEP, max: FLOOR_MAX }
// The playoffs are a fraction of a season's minutes (16 teams, 4–28 games each), so
// their floors, menu steps and highest choices are scaled down.
const PLAYOFF_RULES = {
  floors: { 2: { pool: 100, step: 10 }, 3: { pool: 100, step: 10 }, 4: { pool: 60, step: 5 }, 5: { pool: 40, step: 5 } },
  step: 10,
  max: { 2: 400, 3: 300, 4: 150, 5: 80 }
}
const pickRange = (minutes, k, rules = REGULAR_RULES) => {
  const over = [...minutes].sort((a, b) => b - a)[POOL_MAX]
  const lo = over === undefined ? rules.step : (Math.floor(over / rules.step) + 1) * rules.step
  return [lo, Math.max(lo, rules.max[k])]
}

const sum = rows => {
  const t = rows.reduce((a, r) => ({ seconds: a.seconds + r.seconds, poss: a.poss + (r.offPoss + r.defPoss) / 2, plusMinus: a.plusMinus + r.plusMinus }), { seconds: 0, poss: 0, plusMinus: 0 })
  return { minutes: Math.round(t.seconds / 60), poss: Math.round(t.poss), net: t.poss ? Math.round((t.plusMinus / t.poss) * 1000) / 10 : null }
}

// Each player's possessions on the floor (offense and defense averaged, as `sum` counts
// them) over a season's team files, in the chunks `keep` passes (a file without chunks is
// one), keyed by NBA id: the shot map's per-75 rates.
const possessions = (docs, keep = () => true) => {
  const by = new Map()
  for (const d of docs) {
    for (const c of d.chunks || [{ lineups: d.lineups }]) {
      if (!keep(c)) continue
      for (const l of c.lineups) for (const id of l.ids) by.set(id, (by.get(id) || 0) + (l.offPoss + l.defPoss) / 2)
    }
  }
  return by
}

const best = units => units.sort((a, b) => b.net - a.net || b.minutes - a.minutes)[0] || null

// Every k-element subset of ids, in order.
const subsets = (ids, k, start = 0, acc = [], out = []) => {
  if (acc.length === k) {
    out.push(acc)
    return out
  }
  for (let i = start; i < ids.length; i++) subsets(ids, k, i + 1, [...acc, ids[i]], out)
  return out
}

// The lineups a set of groups appears in, keyed by the group's sorted ids.
const groupRows = (lineups, groupsOf) => {
  const groups = new Map()
  for (const l of lineups) {
    for (const g of groupsOf(l)) {
      const key = [...g].sort().join('-')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(l)
    }
  }
  return groups
}

// on / off: the team with him on and off the floor.
// units[k] for each size k: his best k-man unit (over floors[k] minutes, by net rating
//   per 100), his most-played one with its share of his minutes, and every unit over
//   the lowest pickable minimum (ranges, see pickRange) as options, best first, so the
//   best at any minimum can be picked from them.
// mates: his MATES most-shared teammates, the team's net with both on
//   (together) and with him on and the teammate off (apart).
// Groups list the other players' ids, not his.
const lineupProfile = (lineups, id, floors, ranges) => {
  const mine = lineups.filter(l => l.ids.includes(id))
  if (!mine.length) return null
  const on = sum(mine)
  const others = l => l.ids.filter(x => x !== id)
  const share = u => u && { ...u, share: on.minutes ? Math.round((u.minutes / on.minutes) * 100) : 0 }

  const units = {}
  for (const k of SIZES) {
    const all = [...groupRows(mine, l => subsets(others(l), k - 1))].map(([key, rows]) => ({ ids: key.split('-'), ...sum(rows) }))
    const mostUsed = all.reduce((a, b) => (b.minutes > a.minutes ? b : a), all[0])
    const options = all.filter(u => u.minutes >= ranges[k][0] && u.net !== null).sort((a, b) => b.net - a.net || b.minutes - a.minutes)
    units[k] = { best: best(all.filter(u => u.minutes >= floors[k])), mostUsed: share(mostUsed) || null, options }
  }

  const shared = new Map()
  for (const l of mine) for (const m of others(l)) shared.set(m, (shared.get(m) || 0) + l.seconds)
  const mates = [...shared].sort((a, b) => b[1] - a[1]).slice(0, MATES).map(([m]) => ({
    id: m,
    together: sum(mine.filter(l => l.ids.includes(m))),
    apart: sum(mine.filter(l => !l.ids.includes(m)))
  }))

  return { on, off: sum(lineups.filter(l => !l.ids.includes(id))), units, mates, floors }
}

// The minutes floor that about `pool` units clear (see FLOOR_RULES), from every unit's
// minutes.
const poolFloor = (minutes, { pool, step }) => {
  const sorted = [...minutes].sort((a, b) => b - a)
  const nth = sorted[Math.min(pool, sorted.length) - 1] || 0
  return Math.max(step, Math.floor(nth / step) * step)
}

// From each team's lineups ({ team, lineups }): the league's floors (see FLOOR_RULES)
// and, for each size, every unit over its floor as net ratings sorted best first, for
// ranking a player's units; the pickable minimums (pickRange); and every unit over the
// lowest of them as [minutes, net, player ids, team], so ranks can be taken, and units
// named, at any minimum.
const league = (teams, rules = REGULAR_RULES) => {
  const units = Object.fromEntries(SIZES.map(k => [k, []]))
  for (const { team, lineups } of teams) {
    for (const k of SIZES) {
      for (const [key, rows] of groupRows(lineups, l => subsets(l.ids, k))) units[k].push({ ids: key.split('-'), team, ...sum(rows) })
    }
  }
  const floors = Object.fromEntries(SIZES.map(k => [k, poolFloor(units[k].map(u => u.minutes), rules.floors[k])]))
  const ranges = Object.fromEntries(SIZES.map(k => [k, pickRange(units[k].map(u => u.minutes), k, rules)]))
  const nets = Object.fromEntries(SIZES.map(k => [k, units[k].filter(u => u.minutes >= floors[k]).map(u => u.net).sort((a, b) => b - a)]))
  const pool = Object.fromEntries(SIZES.map(k => [k, units[k].filter(u => u.minutes >= ranges[k][0] && u.net !== null).map(u => [u.minutes, u.net, u.ids, u.team])]))
  return { floors, ranges, nets, pool }
}

// A team's units of each size k: its most-played one, and its best by net rating over
// floors[k] minutes (null when none clears it yet), each with its place among the
// league's (`nets`, see league; null under the floor).
const teamUnits = (lineups, floors, nets) => Object.fromEntries(SIZES.map(k => {
  const all = [...groupRows(lineups, l => subsets(l.ids, k))].map(([key, rows]) => ({ ids: key.split('-'), ...sum(rows) }))
  const ranked = u => u && { ...u, rank: rankAmong(nets[k], u, floors[k]) }
  const mostUsed = all.reduce((a, u) => (!a || u.minutes > a.minutes ? u : a), null)
  return [k, { mostUsed: ranked(mostUsed), best: ranked(best(all.filter(u => u.minutes >= floors[k] && u.net !== null))) }]
}))

// A unit's place among the league's (1 = best net), or null under the minutes floor.
const rankAmong = (nets, unit, floor) =>
  unit && unit.minutes >= floor ? { rank: nets.filter(n => n > unit.net).length + 1, of: nets.length } : null

module.exports = { lineupProfile, teamUnits, league, poolFloor, pickRange, rankAmong, sum, possessions, SIZES, POOL_MAX, PLAYOFF_RULES }
