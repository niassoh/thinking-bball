// A player traded mid-season played for each team over part of its season only. On/off
// against a team covers his time there, not its games before he arrived or after he
// left, so the lineup pull (scripts/lineups.js) splits each team's season into chunks at
// the dates traded players joined or left it, and his slice of a team is the chunks
// inside his stint.
const { addCounts } = require('./footprint')

// His stint with each team from his game log ({ Date, Team } rows): the dates of his
// first and last game there. His first team's stint runs from the season's start and his
// last team's to its end (from/to null), as a player who stays put has all his team's
// games, including the ones he missed.
const stintsOf = rows => {
  const s = {}
  for (const { Date: d, Team: team } of rows) {
    const t = s[team] || (s[team] = { from: d, to: d })
    if (d < t.from) t.from = d
    if (d > t.to) t.to = d
  }
  const teams = Object.keys(s).sort((a, b) => s[a].from.localeCompare(s[b].from))
  if (teams.length) {
    s[teams[0]].from = null
    s[teams[teams.length - 1]].to = null
  }
  return s
}

// A team's game dates (sorted) split into chunks at each traded player's first game for it
// and its first game after his last (stints: { playerId: { TEAM: { from, to } } }).
const chunkDates = (dates, stints, team) => {
  const cuts = new Set()
  for (const s of Object.values(stints)) {
    const st = s[team]
    if (!st) continue
    if (st.from) cuts.add(st.from)
    const after = st.to && dates.find(d => d > st.to)
    if (after) cuts.add(after)
  }
  const chunks = []
  for (const d of dates) {
    if (!chunks.length || cuts.has(d)) chunks.push([])
    chunks[chunks.length - 1].push(d)
  }
  return chunks
}

// Two lineups' own-count rows (`p`, a row per id; a row is trimmed of trailing zeros, or
// 0 for none, and `p` is missing when no one has any), summed.
const addRow = (x, y) => {
  if (!y) return x
  if (!x) return [...y]
  return Array.from({ length: Math.max(x.length, y.length) }, (_, j) => (x[j] || 0) + (y[j] || 0))
}
const addOwn = (a, b) => (!b ? a : !a ? b.map(r => (r ? [...r] : 0)) : a.map((r, i) => addRow(r, b[i]) || 0))

// Lineups summed across chunks (the same five in two chunks is one lineup). Playoff
// lineups have no counts (t, o).
const mergeLineups = lists => {
  const byIds = new Map()
  for (const list of lists) {
    for (const l of list) {
      const key = l.ids.join('-')
      const a = byIds.get(key)
      if (!a) {
        const copy = l.t ? { ...l, t: [...l.t], o: [...l.o] } : { ...l }
        if (l.p) copy.p = addOwn(null, l.p)
        byIds.set(key, copy)
        continue
      }
      a.seconds += l.seconds
      a.offPoss += l.offPoss
      a.defPoss += l.defPoss
      a.plusMinus += l.plusMinus
      if (a.t) {
        a.t = addCounts(a.t, l.t)
        a.o = addCounts(a.o, l.o)
      }
      if (l.p) a.p = addOwn(a.p, l.p)
    }
  }
  return [...byIds.values()].sort((a, b) => b.seconds - a.seconds)
}

// A team-season's lineups over a stint with it (the chunks inside it), or all of them.
const lineupsDuring = (doc, stint) => {
  if (!stint || !doc.chunks) return doc.lineups
  return mergeLineups(doc.chunks.filter(c => (!stint.from || c.from >= stint.from) && (!stint.to || c.to <= stint.to)).map(c => c.lineups))
}

module.exports = { stintsOf, chunkDates, mergeLineups, lineupsDuring }
