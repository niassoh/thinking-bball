// The historical tab's columns for the players it leaves out. 1996-97..1999-00 come from
// the sheet's historical tab (1historical-24), which keeps about 175 players a season, not
// everyone over the minutes floor: 318 player-seasons of 800+ minutes aren't on it (Kobe's
// 1996-97). Its box columns are the daily sheet's 'All RS' formulas (the Backpicks models,
// data/sources/sheet-backup's formulas: BPM in BJ, Load AM, Box OC AG, Passer Rating BC,
// ScoreVal BL, PlayVal BM) on Basketball-Reference's per-100-possession lines, so they're
// worked out here the same way from data/history/box-stats.json (scripts/box-stats.js), with
// each team's SRS and offensive rating and the league's TS% read off the tab's own rows.
// FILLED are the columns that land on the tab's values for the players it has
// (test/historical.test.js, docs/data-pull-audit.md #209); OBPM and AuPM/g don't, and are
// left out, as are 1998-99's ScoreVal and PlayVal.
const Papa = require('papaparse')
const { slugify, num } = require('./players')
const { spacing, threeProf, matesSpacing, boxCreation, load, passerRating, non3BoxCreation } = require('./creation')

const FILLED = ['BPM', 'rTS%', 'Load', 'Box Creation', 'Passer rating', 'ScoreVal', 'PlayVal']
// The lockout season's two lands 0.24 and 0.12 off the tab's on average (the rest within 0.08).
const SKIP = { '1998-99': ['ScoreVal', 'PlayVal'] }
const filledIn = season => FILLED.filter(c => !(SKIP[season] || []).includes(c))
const FLOOR = 800
const LISTED = { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 }
const DEFAULT_HEIGHT = 78
const RATES = ['ast', 'fga', 'x3pa', 'fta', 'orb', 'drb', 'stl', 'blk', 'pf', 'tov', 'pts']
const COLUMNS = ['player', 'id', 'team', 'pos', 'g', 'mp', ...RATES, 'x3p', 'ft', 'ts']

// data/history/box-stats.json from the archive's public.fact_player_season_stats.csv:
// every regular-season row of these seasons, each team's and a traded player's season
// (team '2TM'), per 100 possessions as Basketball-Reference rounds them (the tab's inputs:
// its 'FTA / 100' is the table's to the tenth). { columns, seasons: { season: [row] } }.
const boxStatsOf = (csv, from = 1997, to = 2000) => {
  const seasons = {}
  for (const r of Papa.parse(csv, { header: true, skipEmptyLines: true }).data) {
    const year = Number(r.season)
    if (r.season_type !== 'Regular Season' || r.lg !== 'NBA' || year < from || year > to) continue
    const season = `${year - 1}-${String(year).slice(2)}`
    ;(seasons[season] = seasons[season] || []).push([
      r.player.replace(/\*$/, ''), r.player_id, r.team, (r.pos || '').split('-')[0], num(r.g), num(r.mp),
      ...RATES.map(k => num(r[`${k}_per_100_poss`])), num(r.x3p_percent), num(r.ft_percent), num(r.ts_percent)
    ])
  }
  return { columns: COLUMNS, seasons }
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1]

// One season's values: { rows: Map(`${team}|${id}` -> values) for each team's row, players:
// Map(id -> { name, mp, g, teams: [{ team, mp }], values }) for each player's season (a
// traded player's from his combined line, his teams' context by his minutes with each).
// tabRows: the tab's rows of the season; heights: inches by Basketball-Reference id.
const seasonValues = (doc, tabRows, heights) => {
  const all = doc.map(v => Object.fromEntries(COLUMNS.map((c, i) => [c, v[i]])))
  const teamRows = all.filter(r => !/TM$/.test(r.team))
  const tab = new Map(tabRows.map(t => [`${t['Yr / Tm'].split(' ')[1]}|${slugify(t.Player)}`, t]))
  const tabOf = r => tab.get(`${r.team}|${slugify(r.player)}`)
  const ratings = new Map(tabRows.map(t => [t['Yr / Tm'].split(' ')[1], { srs: num(t['Team SRS']), ortg: num(t['Team Ortg']) }]))
  // The tab's league TS%: its players' TS% less their rTS%.
  const lgTs = median(teamRows.filter(tabOf).map(r => r.ts - num(tabOf(r)['rTS%']) / 100))

  const base = r => {
    const i = {
      ast: r.ast || 0, fga: r.fga || 0, pa3: r.x3pa || 0, fta: r.fta || 0, orb: r.orb || 0, drb: r.drb || 0, stl: r.stl || 0,
      blk: r.blk || 0, pf: r.pf || 0, tov: r.tov || 0, pts: r.pts || 0, pct3: r.x3p || 0, pctFt: r.ft || 0, ts: r.ts || 0,
      pos: LISTED[r.pos] || 0, height: heights[r.id] || DEFAULT_HEIGHT, mpg: r.mp / r.g
    }
    i.prof = threeProf(i.pa3, i.pct3)
    i.spacing = spacing(i.pos, i.pctFt, i.prof)
    return i
  }
  // His team's context in a team row: Mates Spacing (AT) and Mates 3Pro (BQ), each the team's
  // minutes-weighted value less his pull on it, and the team's ratings.
  const teams = new Map()
  for (const r of teamRows) teams.set(r.team, [...(teams.get(r.team) || []), r])
  const context = new Map()
  for (const [team, rs] of teams) {
    const total = rs.reduce((a, r) => a + r.mp, 0)
    const bs = rs.map(base)
    const sp = bs.reduce((a, b, k) => a + b.spacing * (rs[k].mp / total), 0)
    const p3 = bs.reduce((a, b, k) => a + b.prof * (rs[k].mp / total), 0)
    rs.forEach((r, k) => {
      const share = r.mp / total
      context.set(r, { mates: matesSpacing(bs[k].spacing, share, sp), mates3: p3 - (bs[k].prof - p3) * share, ...(ratings.get(team) || {}) })
    })
  }
  const box = (r, c) => {
    const i = { ...base(r), ...c }
    i.bc = boxCreation(i)
    i.load = load(i)
    i.non3 = non3BoxCreation(i)
    // The tab's Passer Rating has no rim-assist term (the play-by-play's share puts it 0.47
    // off on average, against 0.15 without).
    i.pr = i.ast ? passerRating({ rimAstRel: 0, load: i.load, ast: i.ast, height: i.height, tov: i.tov, non3: i.non3 }) : 0
    i.ctov = i.load ? i.tov / i.load : 0
    i.pts75 = i.pts * 0.75
    i.tsa = i.fga + 0.44 * i.fta
    i.rts = i.ts - lgTs
    return i
  }
  const firsts = new Map(teamRows.map(r => [r, box(r, context.get(r))]))
  // The league's Pts / 75, cTOV% and Passer Rating (BN–BP), over the floor's team rows.
  const pool = [...firsts].filter(([r]) => r.mp > FLOOR).map(([, i]) => i)
  const lg = { pts75: mean(pool.map(i => i.pts75)), ctov: mean(pool.map(i => i.ctov)), pr: mean(pool.map(i => i.pr)) }
  const values = i => {
    const rPts75 = i.pts75 - lg.pts75
    const rCtov = i.ctov - lg.ctov
    const rPr = i.pr - lg.pr
    const sh = i.tsa / i.load
    const pl = (i.load - i.tsa) / i.load
    return {
      BPM: -3.24 - 7.44 * i.rts + 0.106 * i.tsa + 0.38 * i.pr + 0.12 * i.orb + 1.07 * i.prof - 0.145 * i.load + 0.37 * i.non3 + 0.11 * i.mpg + 0.01 * i.srs -
        0.58 * i.pf - 0.34 * i.stl - 29.78 * i.ctov + 0.23 * i.drb + 0.39 * i.pos + 0.35 * i.blk + 1.03 * (i.rts * i.tsa) + 0.005 * (i.mpg * i.srs) +
        0.24 * (i.stl * i.pf) + 4.05 * (i.pf * i.ctov) - 0.04 * (i.pos * i.drb),
      'rTS%': 100 * i.rts,
      Load: i.load,
      'Box Creation': i.bc,
      'Passer rating': i.pr,
      ScoreVal: -0.64 + 8.92 * i.rts + 0.046 * rPts75 - 10.105 * rCtov * sh - 2.063 * i.mates3 * 0.5 + 0.754 * (i.rts * rPts75) +
        (0.098 * i.ortg + 0.022 * i.mpg) * 0.75 * sh + 0.167 * i.pos * 0.75 * sh,
      PlayVal: -0.64 + 0.252 * rPr - 10.105 * rCtov * pl - 2.063 * i.mates3 * 0.5 + 0.105 * i.bc + (0.098 * i.ortg + 0.022 * i.mpg) * 0.75 * pl +
        0.167 * i.pos * 0.75 * pl
    }
  }

  const rows = new Map([...firsts].map(([r, i]) => [`${r.team}|${r.id}`, values(i)]))
  const players = new Map()
  const traded = new Set(all.filter(r => /TM$/.test(r.team)).map(r => r.id))
  for (const r of all) {
    const combined = /TM$/.test(r.team)
    if (!combined && traded.has(r.id)) continue
    const own = teamRows.filter(x => x.id === r.id)
    const total = own.reduce((a, x) => a + x.mp, 0)
    const c = {}
    if (combined) for (const k of ['mates', 'mates3', 'srs', 'ortg']) c[k] = own.reduce((a, x) => a + context.get(x)[k] * x.mp, 0) / total
    players.set(r.id, { name: r.player, mp: r.mp, g: r.g, teams: own.map(x => ({ team: x.team, mp: x.mp })), values: values(combined ? box(r, c) : firsts.get(r)) })
  }
  return { rows, players }
}

module.exports = { boxStatsOf, seasonValues, filledIn, FILLED }
