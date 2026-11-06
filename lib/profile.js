// Assembles one player's profile document from cached season data, bio.json and
// the per-player artifacts (recent-shift, shotshift, gamelog, wowy, lineups, depth). Built on
// request from data/ so every nightly pull is reflected without a build step.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const { slugify, loadSheet, seasonFromKey, regularSeasonKeys, playoffSeasonKeys, num } = require('./players')
const { percentileOf } = require('./percentile')
const { TABS, HISTORICAL_COLUMNS, RELATIVE, LOWER_BETTER, ALL_STATS, yearsOf, SHIFT_STATS } = require('./stats')
const { TEAMS, fromBrefAbbr } = require('./teams')
const { lineupProfile, league, rankAmong, PLAYOFF_RULES, teamUnits, unitCounts, possessions, SIZES } = require('./lineups')
const { BASE_FIELDS: FOOTPRINT_BASE, FIELDS: FOOTPRINT_FIELDS, OWN: FOOTPRINT_OWN, STATS: FOOTPRINT_STATS, footprint, footprintSeasons, footprintViews, leagueSwings, measure, sumCounts } = require('./footprint')
const { mergeLineups, lineupsDuring } = require('./stints')
const lonestarLib = require('./lonestar')
const { inches, metrics } = require('./creation')
const jerseys = require('./jerseys')
const { seasonValues, filledIn } = require('./historical')

const DATA_DIR = path.join(__dirname, '..', 'data')
// Profiles start with the play-by-play archive's first season: the sheet's season tabs
// from 2000-01, its historical tab before (9 stats). Playoff runs start there too: the
// playoff sheet's pulls of 1996-97..1999-00 take their games from the archive, which
// pbpstats doesn't list, so their opponent averages and rTS% compute
// (scripts/backfill-seasons.js; docs/data-pull-audit.md #146, #150). pbpstats' player
// totals miss some of those games (the 1997 Jazz: 15 of 20), so those runs' rates come
// from the games it has.
const FIRST_SEASON = '1996-97'
const FIRST_PLAYOFF_SEASON = '1996-97'
const FIRST_PLAYOFF_YEAR = Number(FIRST_PLAYOFF_SEASON.slice(0, 4)) + 1
// Season pulls only include players above roughly this many minutes, so
// historical seasons are filtered the same way for percentiles and averages.
const QUALIFYING_MP = 800
const HISTORICAL_LABELS = Object.keys(HISTORICAL_COLUMNS)
const RISER_STATS = [['Pts / 75', 'Pts 75'], ['rTS%', 'rTS%'], ['Load', 'Load'], ['Box Creation', 'Box Creation'], ['Passer Rating', 'Passer Rating'], ['BPM', 'BPM']]
const RISER_MIN_PO_MP = 500
// Minutes for a career on/off to join the percentile pool, per season type.
const CAREER_MIN_MP = { regular: 3000, playoffs: 500 }
// Shooting percentages average over shots, not minutes: each player's weight is
// his attempts, i.e. the sheet's per-75 / per-36 rate for that shot times MP.
const SHOT_VOLUME = {
  'Rim FG%': 'Rim FGA', 'Midrange FG%': 'Midrange FGA', 'FT%': 'FTA', 'Drives TS%': 'Drives/36',
  'Wide Open 3%': '3yr Wide Open 3s/36', 'Pullup 3%': '3yr Pullup 3s/36', 'C&S 3%': '3yr C&S 3s/36'
}

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
const decimals = s => (typeof s === 'string' && s.includes('.') ? s.split('.')[1].length : 0)
const seasonLabel = season => season.replace('-', '–')

const weightedMean = pairs => {
  const valid = pairs.filter(([v, w]) => v !== null && w)
  const total = valid.reduce((a, [, w]) => a + w, 0)
  return total ? valid.reduce((a, [v, w]) => a + v * w, 0) / total : null
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

// The sheets' Age column is "age today" as of each pull, not age during that
// season (older season keys were all pulled in 2025). Each key's offset to the
// latest pull is the median age gap of players present in both, so any Age can
// be converted to "age as of the latest pull".
const pullOffsets = seasons => {
  const daily = [...seasons.entries()].filter(([, s]) => s.source === 'daily').sort(([a], [b]) => a.localeCompare(b))
  const [, latest] = daily[daily.length - 1]
  const offsets = new Map()
  for (const [season, s] of daily) {
    const gaps = [...s.rows.entries()]
      .filter(([slug]) => latest.rows.has(slug))
      .map(([slug, r]) => num(latest.rows.get(slug).Age) - num(r.Age))
      .filter(g => !Number.isNaN(g))
    offsets.set(season, median(gaps) || 0)
  }
  return { offsets, latestEndYear: Number(daily[daily.length - 1][0].slice(0, 4)) + 1 }
}

// A player whose listed name changed (Jimmy Butler -> Jimmy Butler III, Juan ->
// Juancho Hernangomez) gets a different slug per spelling. bio.json maps each
// spelling's slug to the player's NBA id, so every slug of one id folds into the
// slug of their most recent season, the one the per-player artifacts use.
const canonicalSlugs = (keys, bio) => {
  const latest = new Map() // nbaId -> slug in the most recent season
  for (const key of keys) {
    for (const r of loadSheet(key).rows) {
      const s = slugify(r.Player)
      if (bio[s] && bio[s].nbaId) latest.set(bio[s].nbaId, s)
    }
  }
  const alias = new Map()
  for (const [s, b] of Object.entries(bio)) if (b.nbaId && latest.has(b.nbaId) && latest.get(b.nbaId) !== s) alias.set(s, latest.get(b.nbaId))
  return alias
}

// Rim points allowed with him on the floor: Footprint's rim protection (opponents' points
// and free throws on shots under 5 ft per 100 possessions, runouts left out) over his
// on-court lineups alone, raw (Rim2FT) and against the league's that season (rRim2FT),
// written into each regular season's rows as the sheet's columns are, for every season
// whose lineups keep the shot zones. The overall rim defense the sheet has no column for;
// the Footprint tile is its on−off swing.
const RIM = FOOTPRINT_STATS.find(st => st.key === 'oppRimPts')
const RIM_GLOSSARY = {
  Rim2FT: "Opponents' points on shots under 5 ft, with their free throws, per 100 possessions with him on the floor (runouts left out)",
  rRim2FT: "Rim2FT against the league's that season: opponents' rim points and free throws per 100 possessions with him on the floor, minus the league's (runouts left out)"
}

// Where the sheet's glossary text describes something other than its column's formula
// (docs/tracking-data-audit.md): FTA:RimFGA's text is Rim+FT TSA%'s, and the two
// turnover columns are per 100 possessions over Load, not shares of his turnovers.
const GLOSSARY_FIXES = {
  'FTA:RimFGA': 'Free throw attempts per field goal attempt at the rim',
  'Handle TOV%': 'Ball-handling (lost ball fumble) turnovers as a percentage of offensive load',
  'Non-Pass TOV%': 'Non-pass turnovers (lost balls, charges, offensive fouls, travels, etc.) as a percentage of offensive load'
}
const rimDefense = (seasons, slugById) => {
  const bySeason = new Map()
  for (const ts of footprintData().teamSeasons) if (RIM.needs.every(k => ts.has[k])) bySeason.set(ts.season, [...(bySeason.get(ts.season) || []), ...ts.lineups])
  for (const [season, lineups] of bySeason) {
    const s = seasons.get(season)
    if (!s) continue
    const lg = measure(RIM, sumCounts(lineups)).v
    const on = new Map()
    for (const l of lineups) for (const id of l.ids) on.has(id) ? on.get(id).push(l) : on.set(id, [l])
    for (const [id, ls] of on) {
      const row = s.rows.get(slugById.get(String(id)))
      const v = row ? measure(RIM, sumCounts(ls)).v : null
      if (v === null) continue
      // One decimal, as the sheet's cells are written.
      row.Rim2FT = v.toFixed(1)
      row.rRim2FT = (v - lg).toFixed(1)
    }
    if (s.source === 'historical') s.filled = new Set([...(s.filled || []), ...Object.keys(RIM_GLOSSARY)])
  }
}

// The sheet's tracking windows (3yr / 2yr) need the shot in their last season, so in the
// season being played a player with none yet (a third of the league after opening night)
// has no window. His comes from its seasons in data/tracking-seasons.json (`one`),
// averaged as a span is: by minutes, a percentage by minutes times that season's attempt
// rate (within 0.1 of the sheet's for most 2025-26 players). The column's percentiles are
// then recounted over every player, as the sheet counts them.
const ONE_YEAR_VOLUME = { 'Wide Open 3%': 'Wide Open 3s/36', 'Pullup 3%': 'Pullup 3s/36', 'C&S 3%': 'C&S 3s/36', 'Def FGA Diff%': 'Def FGA <6ft /36' }
const fillWindows = (seasons, one) => {
  const season = [...seasons.keys()].sort().pop()
  const s = seasons.get(season)
  const y = Number(season.slice(0, 4))
  for (const { label, column } of ALL_STATS.filter(x => ONE_YEAR.includes(x.label))) {
    const window = [...Array(yearsOf(column)).keys()].map(k => `${y - k}-${String(y - k + 1).slice(-2)}`)
    const blank = [...s.rows].filter(([, row]) => num(row[column]) === null)
    for (const [slug, row] of blank) {
      let sum = 0
      let weight = 0
      for (const ws of window) {
        const t = (one[ws] || {})[slug]
        const was = seasons.has(ws) && seasons.get(ws).rows.get(slug)
        if (!t || t[label] === undefined || !was) continue
        const w = num(was.MP) * (ONE_YEAR_VOLUME[label] ? t[ONE_YEAR_VOLUME[label]] || 0 : 1)
        sum += t[label] * w
        weight += w
      }
      if (weight) row[column] = (sum / weight).toFixed(1)
    }
    if (!blank.length) continue
    const pool = [...s.rows.values()].map(r => num(r[column])).filter(v => v !== null)
    for (const row of s.rows.values()) if (num(row[column]) !== null) row['perc' + column] = (percentileOf(num(row[column]), pool, LOWER_BETTER.has(label)) / 100).toFixed(2)
  }
}

let context = null
const buildContext = () => {
  const bio = readJson(path.join(DATA_DIR, 'bio.json')) || {}
  const alias = canonicalSlugs(regularSeasonKeys(), bio)
  const slugOf = name => {
    const s = slugify(name)
    return alias.get(s) || s
  }
  // season -> { source: 'daily'|'historical', rows: Map(slug -> row), lg: {label: avg} }
  const seasons = new Map()
  // The sheet's glossary by column: each pull's text, the newest's first, then the playoff
  // and historical tabs' where the regular season's is blank. GLOSSARY_FIXES goes ahead of
  // them all, for the sheet's few descriptions that don't match its formulas.
  const glossies = [GLOSSARY_FIXES]
  for (const key of regularSeasonKeys()) {
    const { rows, glossy } = loadSheet(key)
    glossies.splice(1, 0, glossy)
    seasons.set(seasonFromKey(key), { source: 'daily', rows: new Map(rows.map(r => [slugOf(r.Player), r])) })
  }
  const firstDaily = [...seasons.keys()].sort()[0]
  const historical = loadSheet('1historical-24')
  for (const row of historical.rows) {
    if (!row.Player || !row['Yr / Tm']) continue
    const [season, tm] = row['Yr / Tm'].split(' ')
    if (!/^\d{4}-\d{2}$/.test(season) || season >= firstDaily) continue
    if (!seasons.has(season)) seasons.set(season, { source: 'historical', rows: new Map() })
    seasons.get(season).rows.set(slugOf(row.Player), { ...row, Tm: fromBrefAbbr(tm) })
  }
  for (const season of [...seasons.keys()]) if (season < FIRST_SEASON) seasons.delete(season)
  // The players over the minutes floor the historical tab leaves out (Kobe's 1996-97), with
  // its box columns worked out from Basketball-Reference's lines (lib/historical.js; a traded
  // player's from his combined line), the ones filled listed in the row's `derived`. His
  // team: the last he played for (bio.json's order), else the one he played most for.
  const box = (readJson(path.join(DATA_DIR, 'history', 'box-stats.json')) || {}).seasons || {}
  const heights = (readJson(path.join(DATA_DIR, 'heights.json')) || {}).players || {}
  for (const [season, doc] of Object.entries(box)) {
    const s = seasons.get(season)
    if (!s || s.source !== 'historical') continue
    const columns = filledIn(season)
    const tabRows = historical.rows.filter(r => r.Player && (r['Yr / Tm'] || '').startsWith(`${season} `))
    for (const p of seasonValues(doc, tabRows, heights).players.values()) {
      const slug = slugOf(p.name)
      if (p.mp < QUALIFYING_MP || s.rows.has(slug)) continue
      const teams = ((bio[slug] || {}).teamsBySeason || {})[season]
      const tm = teams ? teams[teams.length - 1] : fromBrefAbbr([...p.teams].sort((a, b) => b.mp - a.mp)[0].team)
      s.rows.set(slug, { Player: p.name, MP: String(p.mp), G: String(p.g), Tm: tm, ...Object.fromEntries(columns.map(c => [c, p.values[c].toFixed(1)])), derived: columns })
    }
  }
  // The historical tab's seasons take the columns play-by-play gives (pbpStatsOf).
  const filled = (readJson(path.join(DATA_DIR, 'history', 'pbp-stats.json')) || {}).seasons || {}
  const slugById = new Map(Object.entries(bio).filter(([, b]) => b.nbaId).map(([s, b]) => [String(b.nbaId), alias.get(s) || s]))
  // A player with no bio entry (who left before 2000-01, so never on a daily pull) by the
  // play-by-play history's name, where it's one player's.
  const historyNames = Object.entries((readJson(path.join(DATA_DIR, 'history', 'players.json')) || {}).players || {}).filter(([, n]) => n).map(([id, n]) => [id, slugify(n)])
  const nameCount = new Map()
  for (const [, s] of historyNames) nameCount.set(s, (nameCount.get(s) || 0) + 1)
  for (const [id, s] of historyNames) if (!slugById.has(id) && !bio[s] && nameCount.get(s) === 1) slugById.set(id, s)
  for (const [season, doc] of Object.entries(filled)) {
    const s = seasons.get(season)
    if (!s || s.source !== 'historical') continue
    s.filled = new Set(doc.columns)
    for (const [id, vals] of Object.entries(doc.players)) {
      const row = s.rows.get(slugById.get(id))
      if (row) doc.columns.forEach((c, i) => { if (vals[i] !== null) row[c] = vals[i] })
    }
  }
  // The playoff sheet's pulls, one row per player per playoff run, in the same shape.
  const po = new Map()
  for (const key of playoffSeasonKeys()) {
    const season = seasonFromKey(key)
    if (season < FIRST_PLAYOFF_SEASON) continue
    const sheet = loadSheet(key)
    glossies.push(sheet.glossy)
    po.set(season, { source: 'daily', rows: new Map(sheet.rows.filter(r => r.Player).map(r => [slugOf(r.Player), r])) })
  }
  fillWindows(seasons, (readJson(path.join(DATA_DIR, 'tracking-seasons.json')) || {}).seasons || {})
  rimDefense(seasons, slugById)
  glossies.push(historical.glossy, RIM_GLOSSARY)
  const glossary = {}
  for (const g of glossies) for (const [col, text] of Object.entries(g)) if (!glossary[col] && typeof text === 'string' && text.trim()) glossary[col] = text.trim()
  for (const [, s] of [...seasons, ...po]) finishSeason(s)

  // Playoff runs for the rise score, a run a year.
  const playoffs = new Map() // slug -> [{year, tm, mp, gp, row}]
  const addPlayoffRow = (row, year) => {
    if (year < FIRST_PLAYOFF_YEAR) return
    const slug = slugOf(row.Player)
    if (!playoffs.has(slug)) playoffs.set(slug, [])
    playoffs.get(slug).push({ year, tm: row.Tm, mp: num(row.MP), gp: num(row.GP), row })
  }
  for (const [season, s] of po) {
    const year = Number(season.slice(0, 4)) + 1
    for (const row of s.rows.values()) addPlayoffRow(row, year)
  }

  context = {
    seasons, po, playoffs, glossary, ages: pullOffsets(seasons), bio, alias, draft: readJson(path.join(DATA_DIR, 'draft.json')) || {},
    // Birth dates by NBA id (scripts/birthdates.js), for ages the site works out on the day.
    born: (readJson(path.join(DATA_DIR, 'birthdates.json')) || {}).born || {},
    // Listed heights in inches by Basketball-Reference id (scripts/heights.js).
    heights: (readJson(path.join(DATA_DIR, 'heights.json')) || {}).players || {}
  }
  context.riserPool = []
  context.onOffPool = { regular: [], playoffs: [] }
  const allSlugs = new Set([...seasons.values()].flatMap(s => [...s.rows.keys()]))
  for (const slug of allSlugs) {
    const r = riserFor(slug)
    if (r && r.poMP >= RISER_MIN_PO_MP) context.riserPool.push(r.score)
    for (const type of ['regular', 'playoffs']) {
      const c = careerOnOff(slug, type)
      if (c && c.mp >= CAREER_MIN_MP[type]) context.onOffPool[type].push(c.value)
    }
  }
  return context
}

// A stat's column in a season: a season tab's own; for a historical-tab season, the
// column the tab maps it to, else the one play-by-play fills (data/history/pbp-stats.json).
const colOf = (s, label, column) => (s.source === 'daily' ? column : HISTORICAL_COLUMNS[label] || (s.filled && s.filled.has(column) ? column : null))

// A season's percentile pool (a daily pull is already its qualified players) and its
// league averages.
const finishSeason = s => {
  const pool = [...s.rows.values()].filter(r => s.source === 'daily' || num(r.MP) >= QUALIFYING_MP)
  s.pool = pool
  s.lg = {}
  for (const { label, column } of ALL_STATS) {
    const col = colOf(s, label, column)
    if (!col) continue
    const volume = s.source === 'daily' && SHOT_VOLUME[label]
    const weight = r => (volume ? num(r[volume]) * num(r.MP) : num(r.MP))
    s.lg[label] = RELATIVE.has(label) ? 0 : weightedMean(pool.map(r => [num(r[col]), weight(r)]))
  }
}

const ctx = () => context || buildContext()

// His height: bio.json's (ESPN's, for current players), else Basketball-Reference's listed
// one (data/heights.json): as written ("6'8\"") and in inches.
const heightOf = slug => {
  const b = ctx().bio[slug] || {}
  if (b.height) return { text: b.height, inches: inches(b.height) || null }
  const n = b.brefId ? ctx().heights[b.brefId] : undefined
  return n ? { text: `${Math.floor(n / 12)}'${n % 12}"`, inches: n } : { text: null, inches: null }
}

// His NBA awards (data/awards.json, scripts/awards.js), each award's seasons, by his
// Basketball-Reference id: MVP, Finals MVP, Defensive Player, All-NBA and All-Defensive
// teams by tier, Rookie, Sixth Man, Most Improved, Clutch Player, All-Star games, and titles: the seasons he finished on the
// champion (his last team that season, by bio.json's teams for his whole career, else the
// sheet's) and any he was Finals MVP in. Null with none.
const AWARD_KEYS = ['champion', 'fmvp', 'mvp', 'dpoy', 'allnba1', 'allnba2', 'allnba3', 'alldef1', 'alldef2', 'roy', 'smoy', 'mip', 'clutch', 'allstar']
const awardsOf = slug => {
  const c = ctx()
  if (c.awards === undefined) c.awards = readJson(path.join(DATA_DIR, 'awards.json'))
  if (!c.awards) return null
  const bio = c.bio[slug] || {}
  const own = c.awards.players[bio.brefId] || {}
  const titles = new Set(own.fmvp || [])
  const teamsIn = { ...Object.fromEntries(playerSeasons(slug).map(e => [e.season, [e.row.Tm]])), ...(bio.teamsBySeason || {}) }
  for (const [season, teams] of Object.entries(teamsIn)) {
    const champ = c.awards.champions[season]
    if (champ && champ.team && teams[teams.length - 1] === champ.team) titles.add(season)
  }
  const all = { ...own, champion: [...titles].sort() }
  const out = Object.fromEntries(AWARD_KEYS.filter(k => all[k] && all[k].length).map(k => [k, all[k]]))
  return Object.keys(out).length ? out : null
}

// type: 'regular' (the stats sheet's seasons) or 'playoffs' (the playoff sheet's runs).
const TYPES = ['regular', 'playoffs']
const book = type => (type === 'playoffs' ? ctx().po : ctx().seasons)

const playerSeasons = (slug, type = 'regular') =>
  [...book(type).entries()]
    .filter(([, s]) => s.rows.has(slug))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, s]) => ({ season, source: s.source, row: s.rows.get(slug), meta: s }))

const statValue = (entry, label, column) => {
  const col = colOf(entry.meta, label, column)
  if (!col) return null
  const n = num(entry.row[col])
  if (n === null) return null
  // A daily pull's own percentile column; a historical season's, or a column written in
  // (rim defense, which has none), ranked among the season's pool.
  const p = entry.source === 'daily' && !(col in RIM_GLOSSARY)
    ? (num(entry.row['perc' + col]) === null ? null : Math.round(num(entry.row['perc' + col]) * 100))
    : percentileOf(n, entry.meta.pool.map(r => num(r[col])), LOWER_BETTER.has(label))
  return { n, p, raw: entry.row[col] }
}

const riserFor = slug => {
  const po = ctx().playoffs.get(slug)
  if (!po) return null
  const entries = playerSeasons(slug)
  const byYear = new Map(entries.map(e => [Number(e.season.slice(0, 4)) + 1, e]))
  const rows = RISER_STATS.map(([label, column]) => {
    const rs = []
    const pos = []
    for (const year of new Set(po.map(p => p.year))) {
      const e = byYear.get(year)
      const v = e && statValue(e, label, column)
      const runs = po.filter(p => p.year === year)
      const poVal = weightedMean(runs.map(p => [num(p.row[column]), p.mp]))
      if (!v || poVal === null) continue
      rs.push([v.n, num(e.row.MP)])
      pos.push([poVal, runs.reduce((a, p) => a + (p.mp || 0), 0)])
    }
    const rsV = weightedMean(rs)
    const poV = weightedMean(pos)
    return rsV === null || poV === null ? null : { l: label, rs: rsV, po: poV, d: poV - rsV }
  }).filter(Boolean)
  if (!rows.length) return null
  const bpm = rows.find(r => r.l === 'BPM')
  const years = [...new Set(po.map(p => p.year))].sort()
  return {
    rows,
    // Rise score = playoff BPM minus regular-season BPM over the same seasons.
    score: bpm ? bpm.d : null,
    poMP: po.reduce((a, p) => a + (p.mp || 0), 0),
    poGP: po.reduce((a, p) => a + (p.gp || 0), 0),
    runs: years.length,
    span: [years[0], years[years.length - 1]],
    teams: [...new Set(po.map(p => p.tm))]
  }
}

const careerOnOff = (slug, type = 'regular') => {
  const pairs = playerSeasons(slug, type)
    .filter(e => e.source === 'daily')
    .map(e => [num(e.row['Net On/Off']), num(e.row.MP)])
  const value = weightedMean(pairs)
  return value === null ? null : { value, mp: pairs.reduce((a, [, w]) => a + (w || 0), 0) }
}

const artifact = (dir, name) => readJson(path.join(DATA_DIR, dir, `${name}.json`))
// Per-player pulls of the playoffs live under data/playoffs/ with the same layout.
const typed = (type, dir) => (type === 'playoffs' ? path.join('playoffs', dir) : dir)

// The WOWY artifact with each row typed (on / off / without / neither) and the teammate
// it names linked to his profile. The pull names teammates by last name in the label;
// they're the season's players on that team (as in scripts/gamelog-wowy.js), so a last
// name maps back to one of them (null if it's ambiguous).
const WOWY_LAST = name => name.split(' ').slice(1).join(' ') || name
const wowyFor = (slug, type = 'regular') => {
  const doc = artifact(typed(type, 'wowy'), slug)
  if (!doc) return null
  const season = book(type).get(doc.season)
  const roster = season ? [...season.rows.entries()].filter(([, r]) => r.Tm === doc.team) : []
  const mate = last => {
    const hits = roster.filter(([, r]) => WOWY_LAST(r.Player) === last)
    return hits.length === 1 ? { name: hits[0][1].Player, slug: hits[0][0] } : null
  }
  return {
    ...doc,
    rows: doc.rows.map(r => {
      const without = r.label.match(/^On, w\/o (.+)$/)
      if (without) return { ...r, kind: 'without', mate: mate(without[1]) }
      const neither = r.label.match(/^Neither .+ nor (.+)$/)
      if (neither) return { ...r, kind: 'neither', mate: mate(neither[1]) }
      return { ...r, kind: /on$/.test(r.label) ? 'on' : 'off', mate: null }
    })
  }
}

// A player's latest season in lineups (lib/lineups.js), on the team he finished it
// with (the WOWY pull's) or, without one, the team he played most for. He and his
// teammates come back as { name, slug, headshot, headshotVersion }, slug null when they
// have no profile. Each unit carries its rank by net among the league's units of its
// size over the minutes floor (null under it). units[k].options lists his units over the
// lowest pickable minimum (floorRange) as [teammate ids, minutes, net], best first, with
// the ids resolved in `people`, so the site can pick the best at any minimum.
const lineupDocs = {}
const lineupLeagueCache = {}
// A directory of team lineup files; the daily pull's regular-season files hold the season
// in chunks of dates (scripts/lineups.js), summed here into its lineups.
const readDocs = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f))) : [])
  .map(d => (d.chunks && !d.lineups ? { ...d, lineups: mergeLineups(d.chunks.map(c => c.lineups)) } : d))
// The lineup files for a season: the daily pull's (data/lineups, data/playoffs/lineups)
// for its season, or, for earlier ones (the bio card's past seasons), those built from
// the play-by-play archive (data/history/[playoffs/]lineups/<season>/,
// analysis/footprint/lineup_history.py; the playoffs before 2013-14 from pbpstats,
// scripts/playoff-lineup-history.js). No season: the pull's.
const lineupTeams = (type = 'regular', season = null) => {
  const pulled = () => {
    if (!lineupDocs[type]) {
      // In a season's first days the folder holds both seasons: a team yet to play keeps
      // last season's file. The pull's season is the newest.
      const docs = readDocs(path.join(DATA_DIR, typed(type, 'lineups')))
      const newest = docs.reduce((s, d) => (d.season > s ? d.season : s), '')
      lineupDocs[type] = docs.filter(d => d.season === newest)
    }
    return lineupDocs[type]
  }
  const docs = pulled()
  if (!season || (docs.length && docs[0].season === season)) return docs
  const key = `${type}|${season}`
  if (!lineupDocs[key]) {
    // A past regular season from the first source whose lineups carry their points (t, o),
    // for ORTG − DRTG (lib/lineups.js sum): pbpstats' season pull (data/seasons/<s>/lineups),
    // else our play-by-play's (data/footprint/<s>/lineups: the history's lineups to the
    // second and the plus-minus, possessions within 2, 1996-97..2024-25). The history's
    // have no points; the playoffs read only them.
    const dirs = type === 'regular' ? [path.join(DATA_DIR, 'seasons', season, 'lineups'), path.join(DATA_DIR, 'footprint', season, 'lineups')] : []
    const dir = [...dirs, path.join(DATA_DIR, 'history', typed(type, 'lineups'), season)].find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.json')))
    lineupDocs[key] = dir ? readDocs(dir) : []
  }
  return lineupDocs[key]
}
// His possessions on the floor in a season's lineups (lib/lineups.js possessions), for the
// shot map's points per 75: all of them, or with `start` the chunks before it (side 'rest')
// or from it on ('recent'); null with no lineup data for the season, none for him, or a
// lineup pull from before its chunks were split at `start` (scripts/lineups.js).
const possCache = new Map()
const possIn = (type, season, nbaId, start = null, side = null) => {
  const docs = lineupTeams(type, season)
  if (!nbaId || !docs.length || docs[0].season !== season) return null
  if (start && docs.some(d => !d.chunks || d.chunks.some(c => c.from < start && c.to >= start))) return null
  const key = [type, season, start, side].join('|')
  if (!possCache.has(key)) possCache.set(key, possessions(docs, start ? c => (side === 'recent' ? c.from >= start : c.to < start) : undefined))
  const v = possCache.get(key).get(nbaId)
  return v ? Math.round(v) : null
}
// Players in the lineups the site has no bio for are named from the lineup pulls' player
// lists (data/lineup-players.json, and the past seasons' under data/seasons/) or the
// lineup history's (data/history/players.json); the history's reach the profile of the
// same name when its bio has no NBA id to say otherwise.
const playerByNbaId = () => {
  const c = ctx()
  if (!c.byNbaId) {
    c.byNbaId = new Map()
    for (const [s, b] of Object.entries(c.bio)) {
      if (!b.nbaId) continue
      const slug = c.alias.get(s) || s
      const row = [...c.seasons.values()].reverse().map(x => x.rows.get(slug)).find(Boolean)
      if (row || !c.byNbaId.has(b.nbaId)) c.byNbaId.set(b.nbaId, { name: row ? row.Player : b.sheetName, slug: row ? slug : null })
    }
    const seasonsDir = path.join(DATA_DIR, 'seasons')
    const pastPulls = fs.existsSync(seasonsDir) ? fs.readdirSync(seasonsDir).map(s => path.join('seasons', s, 'lineup-players.json')) : []
    for (const file of [...TYPES.map(type => typed(type, 'lineup-players.json')), ...pastPulls]) {
      const listed = (readJson(path.join(DATA_DIR, file)) || {}).players || {}
      for (const [mid, name] of Object.entries(listed)) if (!c.byNbaId.has(mid)) c.byNbaId.set(mid, { name, slug: null })
    }
    const past = (readJson(path.join(DATA_DIR, 'history', 'players.json')) || {}).players || {}
    for (const [mid, name] of Object.entries(past)) {
      if (c.byNbaId.has(mid) || !name) continue
      const s = c.alias.get(slugify(name)) || slugify(name)
      const known = !(c.bio[s] || {}).nbaId && [...c.seasons.values()].some(x => x.rows.has(s))
      c.byNbaId.set(mid, { name, slug: known ? s : null })
    }
  }
  return c.byNbaId
}
const leagueLineups = (type = 'regular', season = null) => {
  const key = `${type}|${season || ''}`
  if (!lineupLeagueCache[key]) lineupLeagueCache[key] = league(lineupTeams(type, season), type === 'playoffs' ? PLAYOFF_RULES : undefined)
  return lineupLeagueCache[key]
}
// The league's minutes floors and, per unit size (2–5), the units over them as net
// ratings sorted best first; the pickable minimums; and the pool of units over the
// lowest for the lineup tooltip's swarm, with `people` naming their players by NBA id.
// Null without lineup data. A past season (season given) reads that season's history.
const lineupLeague = (type = 'regular', season = null) => {
  const docs = lineupTeams(type, season)
  if (!docs.length) return null
  const lg = leagueLineups(type, season)
  const people = playerByNbaId()
  const ids = new Set(Object.values(lg.pool).flatMap(units => units.flatMap(u => u[2])))
  return { season: docs[0].season, floors: lg.floors, ranges: lg.ranges, nets: lg.nets, pool: lg.pool, people: Object.fromEntries([...ids].map(mid => [mid, (people.get(mid) || {}).name || null])) }
}
// Each team's most-played and best unit of each size in a regular season (lib/lineups.js
// teamUnits), its players named, and slugged where the site has them, and its rotation
// (rotationFor: the team card's depth chart for a past season). Null without lineup data
// for that season.
const teamUnitsDoc = (season = null) => {
  const docs = lineupTeams('regular', season)
  if (!docs.length || (season && docs[0].season !== season)) return null
  const lg = leagueLineups('regular', season)
  const people = playerByNbaId()
  const named = u => {
    if (!u) return null
    const { ids, ...rest } = u
    return { ...rest, mates: ids.map(id => ({ name: (people.get(id) || {}).name || null, slug: (people.get(id) || {}).slug || null })) }
  }
  const teams = docs.map(d => [d.team, Object.fromEntries(Object.entries(teamUnits(d.lineups, lg.floors, lg.nets)).map(([k, u]) => [k, { mostUsed: named(u.mostUsed), best: named(u.best) }]))])
  return { season: docs[0].season, floors: lg.floors, teams: Object.fromEntries(teams), rotations: Object.fromEntries(docs.map(d => [d.team, rotationFor(d, docs[0].season)])) }
}
// The Team board's units view: a team's regular-season units of each size over
// UNIT_VIEW_FLOORS minutes (its most-played UNIT_VIEW_MAX), as counts, not ratings
// (seconds, possessions, and the box-score counts in `fields` for the unit, t, and its
// opponents, o), so the site sums them over a span of seasons before taking ORTG, DRTG,
// four factors and shot mix; with the team's and the league's season in the same counts
// (rORTG, rDRTG), each unit's league rank by net that season (null under the league's
// floor), and its players. Null without lineup data with counts for that team-season.
const UNIT_VIEW_FLOORS = { 2: 100, 3: 60, 4: 40, 5: 20 }
const UNIT_VIEW_MAX = 50
const unitsDoc = (season, team) => {
  const docs = lineupTeams('regular', season)
  const d = docs.find(x => x.team === team)
  if (!d || d.season !== season || !d.lineups.every(l => l.t && l.o)) return null
  const width = FOOTPRINT_BASE.length
  const lg = leagueLineups('regular', season)
  const counts = lineups => unitCounts(lineups.map(l => ({ ...l, ids: ['all'] })), 1, width)[0]
  const pick = ({ seconds, offPoss, defPoss, t, o }) => ({ seconds: Math.round(seconds), offPoss, defPoss, t, o })
  const units = Object.fromEntries(SIZES.map(k => [k, unitCounts(d.lineups, k, width)
    .filter(u => u.minutes >= UNIT_VIEW_FLOORS[k])
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, UNIT_VIEW_MAX)
    .map(u => ({ ids: u.ids, ...pick(u), rank: rankAmong(lg.nets[k], u, lg.floors[k]) }))]))
  const people = playerByNbaId()
  const jersey = jerseys.jerseyId(team, season)
  const seconds = new Map()
  for (const l of d.lineups) for (const id of l.ids) seconds.set(id, (seconds.get(id) || 0) + l.seconds)
  const inUnits = new Set(Object.values(units).flatMap(us => us.flatMap(u => u.ids)))
  const players = [...inUnits].sort((a, b) => seconds.get(b) - seconds.get(a)).map(id => {
    const p = people.get(id) || { name: null, slug: null }
    const h = p.slug ? headshotOf(p.slug) : { source: null, version: null }
    return { id, ...p, headshot: h.source, headshotVersion: h.version, jersey, minutes: Math.round(seconds.get(id) / 60) }
  })
  return {
    season, team, source: d.source || 'pbpstats', fields: FOOTPRINT_BASE, floors: lg.floors, viewFloors: UNIT_VIEW_FLOORS,
    league: pick(counts(docs.flatMap(x => x.lineups))), total: pick(counts(d.lineups)), players, units
  }
}
// For a past season (season given), the team he played most for that season.
const lineupsFor = (slug, type = 'regular', season = null) => {
  const id = (ctx().bio[slug] || {}).nbaId
  if (!id) return null
  const docs = lineupTeams(type, season)
  if (!docs.length) return null
  const finished = season ? null : (artifact(typed(type, 'wowy'), slug) || {}).team
  const lg = leagueLineups(type, season)
  const views = docs.map(d => ({ d, v: lineupProfile(d.lineups, id, lg.floors, lg.ranges) })).filter(x => x.v)
  if (!views.length) return null
  const { d, v } = views.find(x => x.d.team === finished) || views.sort((a, b) => b.v.on.minutes - a.v.on.minutes)[0]
  const people = playerByNbaId()
  // Each with the jersey he wore on this team that season (lib/jerseys.js).
  const jersey = jerseys.jerseyId(d.team, d.season)
  const who = mid => {
    const p = people.get(mid) || { name: null, slug: null }
    const h = p.slug ? headshotOf(p.slug) : { source: null, version: null }
    return { ...p, headshot: h.source, headshotVersion: h.version, jersey }
  }
  const unit = (u, size) => u && {
    minutes: u.minutes,
    net: u.net,
    ...(u.share === undefined ? {} : { share: u.share }),
    rank: rankAmong(lg.nets[size], u, lg.floors[size]),
    mates: u.ids.map(who)
  }
  return {
    season: d.season,
    team: d.team,
    self: who(id),
    on: v.on,
    off: v.off,
    units: Object.fromEntries(Object.entries(v.units).map(([k, u]) => [k, {
      best: unit(u.best, k),
      mostUsed: unit(u.mostUsed, k),
      // Compact: teammates by NBA id, resolved through `people`.
      options: u.options.map(o => [o.ids, o.minutes, o.net])
    }])),
    people: Object.fromEntries([...new Set(Object.values(v.units).flatMap(u => u.options.flatMap(o => o.ids)))].map(mid => [mid, who(mid)])),
    floorRange: lg.ranges,
    mates: v.mates.map(m => ({ ...who(m.id), together: m.together, apart: m.apart })),
    floors: v.floors
  }
}

// His footprint (lib/footprint.js): how his team's play changes with him on vs. off, for
// each regular season since 1996-97 and each span of them, from the lineup totals with
// team and opponent counts: a finished season's built from our play-by-play
// (data/footprint/<season>/, analysis/footprint/footprint_pbp.py), the season being
// played's from the daily pull (data/lineups/) until it has one. Each team-season he
// played in is against that team (for a player traded during it, over his stint there:
// the season's stints.json, lib/stints.js); a span is against the league over the same
// seasons. Teammates are named through playerByNbaId and rated in the skill behind a
// stat in the season they played together: the sheet's percentile column, or, for the
// rates in the season's player-totals.json, a percentile among players with SKILL_MIN
// minutes. Null in the playoffs and without the minutes.
const SKILL_MIN = 500
const footprintLeague = {}
const footprintData = () => {
  if (!footprintLeague.regular) {
    // A built season keeps every field and the players' own counts; the daily pull, the
    // base fields only (its season's rim and teammate stats are left out until it's built).
    const counted = d => d && d.fields && (d.fields.join() === FOOTPRINT_FIELDS.join() || d.fields.join() === FOOTPRINT_BASE.join())
    const hasOf = d => ({ zones: d.fields.includes('PaintFTM'), runouts: d.fields.includes('RunoutPoss'), own: !!d.own && d.own.join() === FOOTPRINT_OWN.join() })
    const teamSeasons = []
    const rates = {}
    const add = (season, docs, stintsFile, totalsFile) => {
      const st = readJson(stintsFile)
      const traded = (st && st.season === season && st.players) || {}
      for (const d of docs) teamSeasons.push({ season: d.season, team: d.team, has: hasOf(d), lineups: d.lineups, lineupsFor: id => lineupsDuring(d, traded[id] && traded[id][d.team]) })
      const doc = readJson(totalsFile)
      if (!doc || doc.season !== season) return
      const qualified = Object.values(doc.players).filter(p => p.minutes >= SKILL_MIN)
      const pools = {}
      rates[season] = { players: doc.players, fields: new Set(Object.keys(qualified[0] || {})), pool: field => (pools[field] = pools[field] || qualified.map(p => p[field])) }
    }
    const dir = path.join(DATA_DIR, 'footprint')
    const built = fs.existsSync(dir) ? fs.readdirSync(dir).filter(s => /^\d{4}-\d{2}$/.test(s)).sort() : []
    for (const season of built) add(season, readDocs(path.join(dir, season, 'lineups')).filter(counted), path.join(dir, season, 'stints.json'), path.join(dir, season, 'player-totals.json'))
    const pulled = lineupTeams('regular').filter(counted)
    if (pulled.length && !built.includes(pulled[0].season)) add(pulled[0].season, pulled, path.join(DATA_DIR, 'stints.json'), path.join(DATA_DIR, 'player-totals.json'))
    // The season being played, the newest, has no minutes floor (lib/footprint.js).
    const newest = teamSeasons.map(ts => ts.season).sort().pop()
    for (const ts of teamSeasons) ts.current = ts.season === newest
    const leagues = new Map()
    const leagueOf = seasons => {
      const key = seasons.join()
      if (!leagues.has(key)) leagues.set(key, leagueSwings(teamSeasons.filter(ts => seasons.includes(ts.season))))
      return leagues.get(key)
    }
    footprintLeague.regular = { teamSeasons, rates, leagueOf }
  }
  return footprintLeague.regular
}
// Footprint's defensive monsters (the DEFENSE tiles' anchor): a teammate whose defensive
// EPM that season (data/epm.json, Dunks & Threes, 2001-02 on) reaches the line of the
// league's top DEPM_TOP among its rotation players (EPM's estimate of 15+ minutes per 48):
// +1.478 in 2005-06 (Duncan's +2.311 is a monster) and +1.228 in 2015-16, David West's,
// 31st of 318 (Bogut's +2.823 is; Curry's +1.225, 32nd, isn't). A player's: { v: his
// defensive EPM, monster: whether he reaches it } or null.
const DEPM_TOP = 0.1
const ROTATION_MP48 = 15
let epmSeasons = null
const depmOf = (mid, season) => {
  if (!epmSeasons) {
    const doc = readJson(path.join(DATA_DIR, 'epm.json'))
    epmSeasons = Object.fromEntries(Object.entries((doc && doc.seasons) || {}).map(([s, players]) => {
      const rotation = Object.values(players).filter(([, mp48]) => mp48 >= ROTATION_MP48).map(([v]) => v).sort((a, b) => a - b)
      return [s, { players, line: rotation[rotation.length - Math.floor(rotation.length * DEPM_TOP)] }]
    }))
  }
  // The season being played has none until the export is refreshed: last season's stands in.
  const y = Number(season.slice(0, 4))
  const s = epmSeasons[season] || epmSeasons[`${y - 1}-${String(y).slice(-2)}`]
  const p = s && s.players[mid]
  return p ? { v: p[0], monster: p[0] >= s.line } : null
}
// Footprint's hand-picked defense options (data/footprint/defensive-wowy-examples.csv,
// user-supplied): a player, the teammate or two to sit, and the years by the seasons' end
// years ('1997-00' is 1996-97 through 1999-00, '2026-26' 2025-26). A row with no teammate
// names a span of his own, which his views already have. By NBA id: [{ stars, seasons }].
const DEF_EXAMPLES = path.join(DATA_DIR, 'footprint', 'defensive-wowy-examples.csv')
let defExamples = null
const defExamplesOf = mid => {
  if (!defExamples) {
    defExamples = new Map()
    const idOf = name => {
      const b = ctx().bio[ctx().alias.get(slugify(name)) || slugify(name)]
      if (!b || !b.nbaId) throw new Error(`${DEF_EXAMPLES}: no player ${name}`)
      return String(b.nbaId)
    }
    const text = fs.existsSync(DEF_EXAMPLES) ? fs.readFileSync(DEF_EXAMPLES, 'utf8') : ''
    for (const r of Papa.parse(text, { header: true, skipEmptyLines: true }).data) {
      const stars = [r['First teammate control'], r['2nd teammate']].filter(Boolean).map(idOf)
      if (!stars.length) continue
      const [a, b] = r.Years.split('-').map(Number)
      const end = Math.floor(a / 100) * 100 + b + (b < a % 100 ? 100 : 0)
      const seasons = []
      for (let y = a; y <= end; y++) seasons.push(`${y - 1}-${String(y).slice(2)}`)
      const id = idOf(r.Player)
      defExamples.set(id, [...(defExamples.get(id) || []), { stars, seasons }])
    }
  }
  return defExamples.get(String(mid)) || []
}
const footprintFns = rates => {
  const people = playerByNbaId()
  return {
    depmOf,
    defExamplesOf,
    nameOf: mid => {
      const who = people.get(mid) || { name: null, slug: null }
      return who.slug ? who : { ...who, face: castFaceOf(mid) }
    },
    skillOf: (mid, col, season) => {
      const r = rates[season]
      if (r && r.fields.has(col)) return r.players[mid] ? percentileOf(r.players[mid][col], r.pool(col)) : null
      const who = people.get(mid)
      const rows = who && who.slug && ctx().seasons.get(season)
      const row = rows && rows.rows.get(who.slug)
      const v = row ? num(row['perc' + col]) : null
      return v === null ? null : Math.round(v * 100)
    },
    // REMOVE BEST's offense options: the stretches the Lonestar tab offers him over the same
    // seasons.
    starOptionsOf: (mid, seasons) => {
      const { data, ctx: lctx } = lonestarBase()
      return data ? lonestarLib.offered(data, mid, lctx, seasons) : []
    }
  }
}
// The profile carries only the seasons he has a footprint in (the picker's); the tab
// fetches the views (footprintDoc).
const footprintFor = (slug, type = 'regular') => {
  if (type !== 'regular') return null
  const id = (ctx().bio[slug] || {}).nbaId
  if (!id) return null
  const seasons = footprintSeasons(footprintData().teamSeasons, id)
  return seasons.length ? { seasons } : null
}

// His Footprint: a view for every season and span, like Lonestar's (lib/footprint.js),
// each REMOVE BEST option in the jersey its team wore (its latest season; ALL's parts each
// in their own), for the faces, as Lonestar's stretches are.
const footprintOf = slug => {
  const id = (ctx().bio[slug] || {}).nbaId
  if (!id) return null
  const { teamSeasons, rates, leagueOf } = footprintData()
  const doc = footprintViews(teamSeasons, id, leagueOf, footprintFns(rates))
  if (!doc.seasons.length) return null
  const jerseyOf = x => (x.team ? jerseys.jerseyId(x.team, x.seasons[x.seasons.length - 1]) : null)
  const dressed = o => ({ ...o, jersey: jerseyOf(o), ...(o.parts ? { parts: o.parts.map(part => ({ ...part, jersey: jerseyOf(part) })) } : {}) })
  return { ...doc, views: doc.views.map(v => ({ ...v, remove: { off: v.remove.off.map(dressed), def: v.remove.def.map(dressed) } })) }
}
// The Footprint tab's own document (GET /api/footprint/:slug, api/footprint/<slug>.json),
// packed as Lonestar's is, the site's biggest documents with a tile set for every REMOVE
// BEST option (about a sixth the size): the stats' own fields once (`stats`, catalogue
// order); each view's effects, and each option's tiles (in `stats` order, none past its
// side's last), as arrays in `fields` order, a status by its place in `statuses`; and
// without the checks' sentences (`context`), which the tab no longer shows.
const FOOTPRINT_STATUSES = ['notable', 'noise', 'typical', 'thin', 'na']
const FOOTPRINT_PACK = {
  effect: ['status', 'on', 'off', 'diff', 'lg', 'r', 'onPctl', 'rank', 'nOn', 'nOff', 'z', 'pctl', 'swingPctl', 'mate'],
  tile: ['status', 'on', 'off', 'diff', 'lg', 'r', 'onPctl', 'z', 'pctl', 'swingPctl', 'mate']
}
const footprintDoc = slug => {
  const doc = footprintOf(slug)
  if (!doc) return null
  const value = (o, f) => (f === 'status' ? FOOTPRINT_STATUSES.indexOf(o.status) : f === 'nOn' ? o.n.on : f === 'nOff' ? o.n.off : f === 'mate' ? (o.mate ? 1 : 0) : o[f] === undefined ? null : o[f])
  const row = (o, fields) => fields.map(f => value(o, f))
  const tiles = t => {
    const out = FOOTPRINT_STATS.map(st => (t[st.key] ? row(t[st.key], FOOTPRINT_PACK.tile) : null))
    while (out.length && out[out.length - 1] === null) out.pop()
    return out
  }
  const option = o => ({ ...o, tiles: tiles(o.tiles) })
  return {
    seasons: doc.seasons,
    statuses: FOOTPRINT_STATUSES,
    fields: FOOTPRINT_PACK,
    stats: FOOTPRINT_STATS.map((st, i) => ({ key: st.key, num: i + 1, effect: st.effect, label: st.label, side: st.side, mates: st.mates, unit: st.unit, good: st.good, noun: st.noun })),
    views: doc.views.map(({ effects, remove, ...v }) => ({ ...v, effects: effects.map(e => row(e, FOOTPRINT_PACK.effect)), remove: { off: remove.off.map(option), def: remove.def.map(option) } }))
  }
}

// His Lonestar view (lib/lonestar.js): his own stats with his team's stars off vs. on over
// the last two regular seasons, each change ranked among every player's. Regular season
// only. Positions are the sheet's (that season's, else his nearest), heights bio.json's.
const lonestarCache = {}
const lonestarData = () => {
  if (!('data' in lonestarCache)) lonestarCache.data = lonestarLib.load()
  return lonestarCache.data
}
// The sheet's columns that play-by-play gives, for the seasons it has only its historical
// tab for (scripts/pbp-stats.js writes data/history/pbp-stats.json from this): his team's
// ratings with him on and off (the Footprint's lineups), his teams' against the league,
// his points, free throws and turnovers per 75 (Lonestar's totals, lib/creation.js) and
// his shots by zone (analysis/footprint/shot_zones.py), each as the sheet defines it. On
// 2024-25 they land within 0.6 of the sheet's ratings and 0.2 of the rest at the median
// (docs/data-pull-audit.md #129). { columns, players: { nbaId: [values] } }.
const PBP_COLUMNS = ['Net On', 'Net On/Off', 'ORTG On', 'DRTG On', 'Team Net', 'Team Off', 'Team Def', 'Pts 75', 'FTA', 'FT%', 'cTOV%', 'Rim FGA', 'Rim FG%', 'Midrange FGA', 'Midrange FG%', 'Corner 3 Share%', 'Rim+FT TSA%', 'FTA:RimFGA']
const pbpStatsOf = (season, zonesFile = path.join(DATA_DIR, 'history', 'shot-zones', `${season}.json`)) => {
  const { teamSeasons, leagueOf } = footprintData()
  const these = teamSeasons.filter(ts => ts.season === season)
  const league = leagueOf([season])
  const lgOrtg = league.ortg.bySeason[season]
  const PTS = FOOTPRINT_FIELDS.indexOf('Points')
  const team = new Map(these.map(ts => {
    const c = sumCounts(ts.lineups)
    return [ts.team, { ortg: (100 * c.t[PTS]) / c.offPoss - lgOrtg, drtg: (100 * c.o[PTS]) / c.defPoss - lgOrtg }]
  }))
  const data = lonestarData()
  const docs = data.docs.filter(d => d.season === season)
  const totals = lonestarLib.seasonTotals(data, season)
  const zones = (readJson(zonesFile) || {}).players || {}
  const quiet = { nameOf: () => ({}), skillOf: () => null }
  const one = x => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10)
  const players = {}
  for (const [id, t] of totals) {
    const fp = footprint(these, id, league, quiet)
    // His teams' ratings, by his minutes with each.
    const mins = docs.filter(d => d.base[id]).map(d => [team.get(d.team), d.base[id].Minutes || 0]).filter(([r, m]) => r && m)
    const total = mins.reduce((a, [, m]) => a + m, 0)
    const tm = k => (total ? mins.reduce((a, [r, m]) => a + r[k] * m, 0) / total : null)
    const m = metrics({ ...t, TsPct: null }, { pos: 0, height: 78, mates: 1.09, league: data.league[season] })
    const per75 = 75 / ((t.OffPoss + t.DefPoss) / 2)
    const z = zones[id] || null
    const fga = t.FG2A + t.FG3A
    const net = fp ? fp.ortg.on - fp.drtg.on : null
    players[id] = [
      one(net), fp ? one(net - (fp.ortg.off - fp.drtg.off)) : null, fp ? one(fp.ortg.on) : null, fp ? one(fp.drtg.on) : null,
      total ? one(tm('ortg') - tm('drtg')) : null, one(tm('ortg')), one(tm('drtg')),
      one(m.pts75), one(m.fta75), t.FTA ? one((100 * t.FtPoints) / t.FTA) : null, m.ctov === null ? null : one(100 * m.ctov),
      z ? one(z[0] * per75) : null, z && z[0] ? one((100 * z[1]) / z[0]) : null, z ? one(z[2] * per75) : null, z && z[2] ? one((100 * z[3]) / z[2]) : null,
      z && z[5] ? one((100 * z[4]) / z[5]) : null, z && fga + 0.44 * t.FTA ? one((100 * (z[0] + 0.44 * t.FTA)) / (fga + 0.44 * t.FTA)) : null,
      z && z[0] ? Math.round((100 * t.FTA) / z[0]) / 100 : null
    ]
  }
  return { columns: PBP_COLUMNS, players }
}

// Lonestar's team-seasons and the context its stats are worked out in: positions (the
// sheet's, that season's or else his nearest), heights, names and faces.
const lonestarBase = () => {
  if (!lonestarCache.base) {
    const data = lonestarData()
    const people = playerByNbaId()
    const bioById = new Map(Object.values(ctx().bio).filter(b => b.nbaId).map(b => [b.nbaId, b]))
    const posOf = (nbaId, season) => {
      const who = people.get(nbaId)
      if (!who || !who.slug) return 0
      const seasons = [...ctx().seasons.entries()].sort((a, b) => Math.abs(Number(a[0].slice(0, 4)) - Number(season.slice(0, 4))) - Math.abs(Number(b[0].slice(0, 4)) - Number(season.slice(0, 4))))
      const v = seasons.map(([, x]) => x.rows.get(who.slug)).map(r => (r ? num(r.Position) : null)).find(x => x !== null)
      return v === undefined ? 0 : v
    }
    // A star as the keys show him: name, slug and headshot (as lineup teammates carry it).
    const nameOf = nbaId => {
      const who = people.get(nbaId) || { name: null, slug: null }
      if (!who.slug) {
        const f = castFaceOf(nbaId)
        return { ...who, face: f.key, headshot: f.headshot, headshotVersion: f.headshotVersion }
      }
      const h = headshotOf(who.slug)
      return { ...who, headshot: h.source, headshotVersion: h.version }
    }
    lonestarCache.base = { data, ctx: { posOf, heightOf: nbaId => inches((bioById.get(nbaId) || {}).height), nameOf } }
  }
  return lonestarCache.base
}
const lonestarFor = (slug, type = 'regular') => {
  if (type !== 'regular') return null
  const id = (ctx().bio[slug] || {}).nbaId
  if (!id) return null
  if (!lonestarCache.regular) {
    const { data, ctx: lctx } = lonestarBase()
    lonestarCache.regular = data ? { data, ctx: lctx, pools: lonestarLib.leagueOf(data, lctx) } : { data: null }
  }
  const { data, ctx: lctx, pools } = lonestarCache.regular
  const view = data ? lonestarLib.lonestar(data, pools, id, lctx) : null
  if (!view) return null
  // Each stretch in the jersey its team wore (its latest season), for the cast's faces; ALL's
  // parts each in their own.
  const jerseyOf = x => jerseys.jerseyId(x.team, x.seasons[x.seasons.length - 1])
  const dressed = scenarios => scenarios.map(s => ({ ...s, jersey: jerseyOf(s), ...(s.parts ? { parts: s.parts.map(p => ({ ...p, jersey: jerseyOf(p) })) } : {}) }))
  return { ...view, views: view.views.map(v => ({ ...v, scenarios: dressed(v.scenarios) })) }
}

// The Lonestar tab's own document (GET /api/lonestar/:slug, api/lonestar/<slug>.json):
// with a view for every season and span it runs to hundreds of KB for a long career, so
// the profile carries only its seasons and the tab fetches this when opened. Packed, as
// the site's biggest documents (under half the size): each stretch's per-stat values (on,
// off, their percentiles, the change's rank and out of how many) are arrays in `fields`
// order, and its change (off less on) is left for the page to take. Numbers to four
// decimals (the tab shows one).
const lonestarDoc = slug => {
  const doc = lonestarFor(slug, 'regular')
  if (!doc) return null
  const fields = lonestarLib.STATS
  const row = o => fields.map(k => (o[k] === undefined ? null : o[k]))
  const pack = ({ change, on, off, pctl, ranks, ...s }) => ({
    ...s, on: row(on), off: row(off), pctl: [row(pctl.on), row(pctl.off)],
    ranks: ranks && { rank: fields.map(k => (ranks[k] ? ranks[k].rank : null)), of: fields.map(k => (ranks[k] ? ranks[k].of : null)) }
  })
  const packed = { ...doc, fields, views: doc.views.map(v => ({ ...v, scenarios: v.scenarios.map(pack) })) }
  return JSON.parse(JSON.stringify(packed, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v)))
}

// A past season's rotation, standing in for the depth chart (only today's is on file).
// Its first row is the team's most-used five, PG to C in order of each one's position: the
// sheet's 1–5 estimate that season, else his listed position that season
// (Basketball-Reference's, data/history/positions.json: the sheet has no estimate before
// 2000-01 and none for a third of 2000-01's players), else the sheet's estimate from his
// nearest season, else his listed position now. Everyone else with an hour on the floor
// follows by minutes under that position, up to four deep; a full column passes him to a
// neighbouring one with room, else he's left out (everyone above him there played more).
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
const LISTED = { PG: 1, G: 1, SG: 2, GF: 2, SF: 3, F: 3, PF: 4, FC: 4, C: 5 }
let listedCache = null
const listedIn = season => {
  if (!listedCache) {
    const doc = readJson(path.join(DATA_DIR, 'history', 'positions.json')) || {}
    listedCache = new Map(Object.entries(doc.seasons || {}).map(([s, players]) => [s, new Map(Object.entries(players).map(([name, pos]) => [ctx().alias.get(slugify(name)) || slugify(name), pos]))]))
  }
  return listedCache.get(season) || new Map()
}
const rotationFor = (doc, season) => {
  const secs = new Map()
  for (const l of doc.lineups) for (const id of l.ids) secs.set(id, (secs.get(id) || 0) + l.seconds)
  const people = playerByNbaId()
  const year = Number(season.slice(0, 4))
  const gap = k => Math.abs(Number(k.slice(0, 4)) - year)
  const sheets = [...ctx().seasons].sort((a, b) => gap(a[0]) - gap(b[0])).map(([, x]) => x)
  const listed = listedIn(season)
  const posOf = who => {
    // No profile (the deep bench, and many more before 2000-01): his listed position by name.
    if (!who.slug) return LISTED[listed.get(slugify(who.name || ''))] || null
    const own = ctx().seasons.get(season)
    const mine = own && own.rows.get(who.slug) ? num(own.rows.get(who.slug).Position) : null
    if (mine !== null) return mine
    if (LISTED[listed.get(who.slug)]) return LISTED[listed.get(who.slug)]
    const n = sheets.map(x => x.rows.get(who.slug)).map(r => (r ? num(r.Position) : null)).find(v => v !== null)
    if (n !== undefined) return n
    return LISTED[((ctx().bio[who.slug] || {}).position || '').replace(/[-\s]/g, '')] || null
  }
  const entry = id => {
    const who = people.get(id) || { name: null, slug: null }
    return { name: who.name, slug: who.slug, hasProfile: !!who.slug, minutes: Math.round(secs.get(id) / 60), pos: posOf(who) }
  }
  const five = doc.lineups.reduce((a, l) => (l.seconds > a.seconds ? l : a)).ids
  const starters = five.map(entry).sort((a, b) => (a.pos ?? 3) - (b.pos ?? 3))
  const rows = POSITIONS.map((pos, i) => ({ pos, players: [starters[i]] }))
  for (const [id, sec] of [...secs].sort((a, b) => b[1] - a[1])) {
    if (sec < 60 * 60) break
    if (five.includes(id)) continue
    const pl = entry(id)
    if (pl.pos === null) continue
    const want = Math.min(4, Math.max(0, Math.round(pl.pos) - 1))
    const col = [0, -1, 1].map(d => want + d).find(c => c >= 0 && c < 5 && rows[c].players.length < 4)
    if (col !== undefined) rows[col].players.push(pl)
  }
  for (const r of rows) for (const pl of r.players) delete pl.pos
  return { team: doc.team, season, rows }
}

// A season's bio card: his team that season (the one he played most for), its lineup
// view against that season's league, and its rotation. Null without lineup data for
// the season.
const seasonCard = (slug, type, season) => {
  const lineups = lineupsFor(slug, type, season)
  if (!lineups) return null
  const doc = lineupTeams(type, season).find(d => d.team === lineups.team)
  return {
    team: lineups.team,
    teamName: TEAMS[lineups.team] ? TEAMS[lineups.team].name : null,
    lineups,
    rotation: rotationFor(doc, season)
  }
}

// Depth charts list every rostered player, but rookies and deep-bench players
// without season data have no profile, so the page only links the ones that do.
const depthChart = team => {
  const doc = artifact('depth', team)
  if (!doc) return null
  const seasons = [...ctx().seasons.values()]
  const hasProfile = slug => seasons.some(s => s.rows.has(slug))
  return { ...doc, rows: doc.rows.map(r => ({ ...r, players: r.players.map(p => ({ ...p, hasProfile: hasProfile(p.slug) })) })) }
}

// Standard deviation of each stat's season values across the file's players, so
// the card can size a change by the league's spread rather than its raw size.
const seasonSpreads = players => {
  const byStat = {}
  for (const rows of Object.values(players)) for (const r of rows) (byStat[r.stat] = byStat[r.stat] || []).push(r.season.value)
  return Object.fromEntries(Object.entries(byStat).map(([stat, v]) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length
    return [stat, Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)]
  }))
}

// Core-stat shift (last 30 days vs rest of season) comes from one league-wide
// pull, so it lives in a single file keyed by slug.
const recentShift = slug => {
  const doc = readJson(path.join(DATA_DIR, 'recent-shift.json'))
  if (!doc) return null
  // A season under 30 days old has no rest of season to set the window against
  // (scripts/recent-shift.js): every profile carries its window to say so, and the season
  // so far is set against last season instead.
  if (!doc.window.restEnd) return { season: doc.season, window: doc.window, stats: lastSeasonShift(slug, doc.season) }
  if (!doc.players[slug]) return null
  const spread = seasonSpreads(doc.players)
  return { season: doc.season, window: doc.window, stats: doc.players[slug].map(r => ({ ...r, spread: spread[r.stat] })) }
}

// The season being played's first 30 days: its pull so far (`recent`) against last
// season's (`season`), sized by the spread across last season's qualified players.
const lastSeasonShift = (slug, season) => {
  const seasons = [...ctx().seasons.keys()].sort()
  const last = seasons[seasons.indexOf(season) - 1]
  const now = ctx().seasons.get(season)
  const was = ctx().seasons.get(last)
  if (!now || !was || !now.rows.has(slug) || !was.rows.has(slug)) return []
  const spread = careerSpreads(last)
  return SHIFT_STATS.map(([stat, column]) => {
    const s = num(was.rows.get(slug)[colOf(was, stat, column)])
    const v = num(now.rows.get(slug)[column])
    return s === null || v === null || !spread[stat] ? null : { stat, season: { value: s }, recent: { value: v }, spread: spread[stat] }
  }).filter(Boolean)
}

// Playoffs mode's counterpart: a season's playoffs against its regular season, in
// recentShift's shape (season = regular season, recent = playoffs), from the two sheets'
// pulls. The spread is each stat's regular-season spread across the players in both.
const poShift = (slug, season) => {
  const rs = ctx().seasons.get(season)
  const po = ctx().po.get(season)
  if (!rs || !po || !rs.rows.has(slug) || !po.rows.has(slug)) return null
  const c = ctx()
  if (!c.poSpread) c.poSpread = new Map()
  if (!c.poSpread.has(season)) {
    const players = Object.fromEntries([...po.rows.keys()].filter(s => rs.rows.has(s)).map(s => [s, SHIFT_STATS.map(([stat, col]) => ({ stat, season: { value: num(rs.rows.get(s)[col]) } })).filter(r => r.season.value !== null)]))
    c.poSpread.set(season, seasonSpreads(players))
  }
  const r = rs.rows.get(slug)
  const p = po.rows.get(slug)
  const stats = SHIFT_STATS.map(([stat, col]) => {
    const s = num(r[col])
    const v = num(p[col])
    if (s === null || v === null) return null
    return {
      stat,
      season: { value: s, pctl: num(r['perc' + col]) === null ? null : Math.round(num(r['perc' + col]) * 100) },
      // Where the playoff value would land among the regular season's players.
      recent: { value: v, pctl: percentileOf(v, [...rs.rows.values()].map(x => num(x[col])), LOWER_BETTER.has(stat)), mp: num(p.MP) },
      rest: { value: s },
      spread: c.poSpread.get(season)[stat]
    }
  }).filter(Boolean)
  return { season, window: null, compare: 'regular', stats }
}

// The bio card's career view (a past player's every season, an active player's past ones):
// a season against the rest of his career, in recentShift's and shotShift's shapes so the
// card reads them unchanged. Each shift stat as his profile shows it, this season's (`recent`) against his
// other seasons' minutes-weighted (`season`), sized by the spread across that season's
// qualified players; and his shots by the map's bands (data/history/shot-bands,
// analysis/footprint/shot_bands.py) against his other seasons', with that season's league.
const careerSpreads = season => {
  const c = ctx()
  if (!c.careerSpread) c.careerSpread = new Map()
  if (!c.careerSpread.has(season)) {
    const s = c.seasons.get(season)
    c.careerSpread.set(season, Object.fromEntries(SHIFT_STATS.map(([stat, column]) => {
      const col = s && colOf(s, stat, column)
      const v = col ? s.pool.map(r => num(r[col])).filter(x => x !== null) : []
      const mean = v.reduce((a, b) => a + b, 0) / v.length
      return [stat, v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) : null]
    })))
  }
  return c.careerSpread.get(season)
}
const shotBandsCache = new Map()
const shotBandsOf = season => {
  if (!shotBandsCache.has(season)) shotBandsCache.set(season, readJson(path.join(DATA_DIR, 'history', 'shot-bands', `${season}.json`)))
  return shotBandsCache.get(season)
}
const careerShift = (nbaId, seasons, stats, i) => {
  const season = seasons[i].season
  const spread = careerSpreads(season)
  const rows = SHIFT_STATS.map(([stat]) => {
    const vals = stats[stat].vals
    const rest = weightedMean(vals.map((x, j) => [j === i || !x ? null : x.n, seasons[j].mp]))
    return vals[i] && vals[i].n !== null && rest !== null && spread[stat] ? { stat, season: { value: rest }, recent: { value: vals[i].n }, spread: spread[stat] } : null
  }).filter(Boolean)
  const doc = shotBandsOf(season)
  const mine = doc && nbaId && doc.players[nbaId]
  let shots = null
  if (mine) {
    const rest = doc.bands.flatMap(() => [0, 0])
    for (const [j, s] of seasons.entries()) {
      const other = j !== i && !s.empty && shotBandsOf(s.season)
      const theirs = other && other.players[nbaId]
      if (theirs) theirs.forEach((v, k) => { rest[k] += v })
    }
    const pair = (a, k) => ({ fga: a[2 * k], fgm: a[2 * k + 1] })
    // His possessions over the same seasons as the shots, null if one has none.
    const others = seasons.filter((s, j) => j !== i && !s.empty && (shotBandsOf(s.season) || { players: {} }).players[nbaId]).map(s => possIn('regular', s.season, nbaId))
    if (rest.some(Boolean)) {
      shots = {
        season,
        window: null,
        zones: Object.fromEntries(doc.bands.map((b, k) => [b, { recent: pair(mine, k), rest: pair(rest, k) }])),
        poss: { recent: possIn('regular', season, nbaId), rest: others.includes(null) ? null : others.reduce((a, b) => a + b, 0) },
        league: Object.fromEntries(doc.bands.map((b, k) => [b, pair(doc.league, k)])),
        shots: []
      }
    }
  }
  return rows.length || shots ? { stats: rows, shots } : null
}

// A player's every regular-season shot by season, packed three characters a shot
// (data/history/shot-dots, analysis/footprint/shot_bands.py), for the career view's dots;
// the site fetches it only for that card. { seasons: { season: dots } }, null without any.
const shotDotsCache = new Map()
const shotDotsOf = requested => {
  const slug = ctx().alias.get(requested) || requested
  const nbaId = (ctx().bio[slug] || {}).nbaId
  if (!nbaId) return null
  const seasons = {}
  for (const e of playerSeasons(slug)) {
    if (!shotDotsCache.has(e.season)) shotDotsCache.set(e.season, readJson(path.join(DATA_DIR, 'history', 'shot-dots', `${e.season}.json`)))
    const doc = shotDotsCache.get(e.season)
    if (doc && doc.players[nbaId]) seasons[e.season] = doc.players[nbaId]
  }
  return Object.keys(seasons).length ? { seasons } : null
}

// A season's shots as analysis/footprint/shot_bands.py packs them (three base64url
// characters a shot), back to the map's [x, y, made, band] in tenths of feet, as the site's
// src/lib/shot.js unpackDots reads them.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const unpackDots = packed => {
  const out = []
  for (let i = 0; i + 2 < packed.length; i += 3) {
    const v = (B64.indexOf(packed[i]) << 12) | (B64.indexOf(packed[i + 1]) << 6) | B64.indexOf(packed[i + 2])
    out.push([((v >> 11) - 64) * 5, (((v >> 3) & 255) - 10) * 5, (v >> 2) & 1, v & 3])
  }
  return out
}
// A regular season's shots in the shot-shift file's shape: that file while it's the
// season's, else (the pull has moved on to a newer season) the season's history files, all
// in `rest`. The two sources differ by a few shots a zone.
const regularShots = (slug, season) => {
  const a = artifact('shotshift', slug)
  if (a && a.season === season) return a
  const nbaId = (ctx().bio[slug] || {}).nbaId
  const doc = shotBandsOf(season)
  const mine = doc && nbaId && doc.players[nbaId]
  if (!mine) return null
  if (!shotDotsCache.has(season)) shotDotsCache.set(season, readJson(path.join(DATA_DIR, 'history', 'shot-dots', `${season}.json`)))
  const dots = (shotDotsCache.get(season) || { players: {} }).players[nbaId] || ''
  const pair = (xs, k) => ({ fga: xs[2 * k], fgm: xs[2 * k + 1] })
  return {
    season,
    zones: Object.fromEntries(doc.bands.map((b, k) => [b, { rest: pair(mine, k), recent: { fga: 0, fgm: 0 } }])),
    league: Object.fromEntries(doc.bands.map((b, k) => [b, pair(doc.league, k)])),
    shots: unpackDots(dots).map(([x, y, made, band]) => [x, y, made, 0, band])
  }
}

// The season being played's shot-shift file, once the season has a rest to set the last
// 30 days against: the pull rewrites only players with a shot, so one with none this season
// still has last season's file.
const currentShots = slug => {
  const a = artifact('shotshift', slug)
  if (!(a && a.season === [...ctx().seasons.keys()].sort().pop() && a.window.restEnd >= a.window.seasonStart)) return null
  const id = (ctx().bio[slug] || {}).nbaId
  return { ...a, poss: { rest: possIn('regular', a.season, id, a.window.start, 'rest'), recent: possIn('regular', a.season, id, a.window.start, 'recent') } }
}

// The season being played's first 30 days, in shotShift's shape: its shots so far (the
// shot-shift file's, all `recent` until there's a rest of season) against last season's,
// with last season's league.
const youngShots = slug => {
  const seasons = [...ctx().seasons.keys()].sort()
  const a = artifact('shotshift', slug)
  const was = a && a.season === seasons[seasons.length - 1] && !(a.window.restEnd >= a.window.seasonStart) && regularShots(slug, seasons[seasons.length - 2])
  if (!was) return null
  const zones = Object.fromEntries(Object.entries(was.zones).map(([id, z]) => [id, { rest: z.rest, recent: a.zones[id].recent }]))
  const id = (ctx().bio[slug] || {}).nbaId
  const poss = { rest: possIn('regular', was.season, id), recent: possIn('regular', a.season, id) }
  return { season: a.season, window: a.window, zones, poss, league: was.league, shots: [...was.shots, ...a.shots] }
}

// The first three weeks of the season being played, when most of last season's players have
// yet to play in it: last season's count as current for whether a player is active (the
// 2026-10-21 rollover decision), by the season's first game (data/footprint/<season>/games.json).
const GRACE_DAYS = 21
const graceSeason = () => {
  const c = ctx()
  if (c.grace === undefined) {
    const seasons = [...c.seasons.keys()].sort()
    const doc = readJson(path.join(DATA_DIR, 'footprint', seasons[seasons.length - 1], 'games.json'))
    const first = doc ? Object.values(doc.games).sort()[0] : null
    c.grace = first && Date.now() - Date.parse(first) < GRACE_DAYS * 864e5 ? seasons[seasons.length - 2] : null
  }
  return c.grace
}

// The shot map's playoffs counterpart: the regular season's shots (the shot-shift file's
// two windows together) as `rest` and the playoffs' (data/playoffs/shots) as `recent`,
// in shotShift's shape, so the map reads them unchanged.
const poShotShift = slug => {
  const po = artifact(path.join('playoffs', 'shots'), slug)
  const rs = po && regularShots(slug, po.season)
  if (!rs) return null
  const zones = Object.fromEntries(Object.entries(rs.zones).map(([id, z]) => [id, {
    rest: { fga: z.rest.fga + z.recent.fga, fgm: z.rest.fgm + z.recent.fgm },
    recent: po.zones[id] || { fga: 0, fgm: 0 }
  }]))
  const shots = [...(rs.shots || []).map(([x, y, made, , band]) => [x, y, made, 0, band]), ...(po.shots || []).map(([x, y, made, band]) => [x, y, made, 1, band])]
  const id = (ctx().bio[slug] || {}).nbaId
  const poss = { rest: possIn('regular', rs.season, id), recent: possIn('playoffs', rs.season, id) }
  return { season: rs.season, window: null, zones, poss, league: rs.league, shots }
}

const ageAtLatestPull = entries => {
  const e = [...entries].reverse().find(x => x.source === 'daily' && num(x.row.Age) !== null)
  return e ? num(e.row.Age) + ctx().ages.offsets.get(e.season) : null
}

// Draft pick from data/draft.json (NBA.com draft history) by NBA id. A player with
// an id but no pick went undrafted; without an id it's unknown (null).
const draftOf = nbaId => {
  if (!nbaId) return null
  const pick = (ctx().draft.picks || {})[nbaId]
  return pick ? { year: pick.year, round: pick.round, overall: pick.overall, team: pick.team } : { undrafted: true }
}

// A player's profile for a season type: 'regular' (default) or 'playoffs', the same
// document built from the playoff sheet's runs (every player with a regular-season
// profile gets one). Both list the same seasons, his regular seasons and playoff runs
// together, so a picked season carries across a switch; a season with none of the type's
// data is `empty` (no games, minutes or values; its team from the other type's row). In
// the playoffs each run carries its own playoffs against its regular season (`shift`).
// Name, bio, team, headshot and depth chart always come from the regular season.
const buildProfile = (requested, { type = 'regular' } = {}) => {
  // An older spelling's slug (old links) opens the player's merged profile.
  const slug = ctx().alias.get(requested) || requested
  const regular = playerSeasons(slug)
  if (!regular.length) return null
  const runs = playerSeasons(slug, 'playoffs')
  const entries = type === 'playoffs' ? runs : regular
  const own = new Map(entries.map(e => [e.season, e]))
  const rowOf = new Map([...(type === 'playoffs' ? regular : runs), ...entries].map(e => [e.season, e.row]))
  const slots = [...rowOf.keys()].sort().map(season => ({ season, e: own.get(season) || null, row: rowOf.get(season) }))
  const bio = ctx().bio[slug] || {}
  const latest = regular[regular.length - 1]
  // Sheets spell names inconsistently across seasons; the latest spelling wins.
  const name = latest.row.Player
  // Current roster (ESPN depth pull) when known, so offseason moves show up.
  const depthTeam = (readJson(path.join(DATA_DIR, 'depth', '_index.json')) || {})[slug]
  const team = depthTeam || latest.row.Tm
  const age = ageAtLatestPull(regular)
  const round1 = x => Math.round(x * 10) / 10

  const seasons = slots.map(({ season, e, row }) => {
    const teams = (type === 'regular' && (bio.teamsBySeason || {})[season]) || [row.Tm]
    return {
      season,
      label: seasonLabel(season),
      tm: teams.length > 1 ? `${teams.length} TM` : row.Tm,
      teams,
      gp: e ? num(e.row.GP !== undefined ? e.row.GP : e.row.G) : null,
      mp: e ? num(e.row.MP) : null,
      // Age at the same point of each season as the latest pull.
      age: age === null ? null : round1(age - (ctx().ages.latestEndYear - (Number(season.slice(0, 4)) + 1))),
      ...(e ? {} : { empty: true }),
      // The historical tab has about 175 players a season, not everyone over the minutes
      // floor (Kobe's 1,103 minutes in 1996-97 aren't on it), so a season of it without his
      // row says nothing of his minutes (the site's lib/seasons.js emptyNote).
      // A playoffs season with no runs pulled yet has no book.
      ...(!e && (book(type).get(season) || {}).source === 'historical' ? { unsourced: true } : {}),
      // A season the tab has no row for, worked out from his box score (lib/historical.js):
      // the stats that were (`derived`) and the tab's that couldn't be (`unsourced`).
      ...(e && e.row.derived ? { derived: HISTORICAL_LABELS.filter(l => e.row.derived.includes(HISTORICAL_COLUMNS[l])), unsourced: HISTORICAL_LABELS.filter(l => !e.row.derived.includes(HISTORICAL_COLUMNS[l])) } : {})
    }
  })
  if (type === 'playoffs') for (const s of seasons) if (!s.empty) s.shift = poShift(slug, s.season)
  // Every season but the depth chart's own carries its bio card (team, lineups,
  // rotation): in the offseason the depth chart is already next season's roster, so last
  // season shows as it was too. The depth chart's season shows today's.
  const depth = depthChart(team)
  for (const s of seasons) if (!depth || s.season !== depth.season) s.card = seasonCard(slug, type, s.season)
  // The jersey each season's card shows him in: its team's that season (today's team in
  // the depth chart's season; without a card, the team he finished with).
  for (const s of seasons) s.jersey = jerseys.jerseyId(s.card ? s.card.team : depth && s.season === depth.season ? team : s.teams[s.teams.length - 1], s.season)
  // A season he was traded in: each of its teams' jerseys, in the order he played for them,
  // for a portrait split between them.
  for (const s of seasons) if (s.teams.length > 1) s.jerseys = s.teams.map(t => jerseys.jerseyId(t, s.season))
  const lineups = lineupsFor(slug, type)
  const lonestar = lonestarFor(slug, type)
  const careerTeams = new Set(entries.map(e => e.row.Tm))
  const careerMP = seasons.reduce((a, s) => a + (s.mp || 0), 0)

  const stats = {}
  for (const { tab, label, column, isNew } of ALL_STATS) {
    const vals = slots.map(({ e }) => (e ? statValue(e, label, column) : null))
    const lastRaw = [...vals].reverse().find(v => v)
    stats[label] = {
      tab,
      isNew,
      // Seasons in a rolling window (3yr / 2yr tracking stats); in the playoffs these
      // columns cover the run only.
      years: type === 'regular' ? yearsOf(column) : null,
      available: vals.some(Boolean),
      dec: lastRaw ? decimals(lastRaw.raw) : 1,
      relative: RELATIVE.has(label),
      lowerBetter: LOWER_BETTER.has(label),
      vals: vals.map(v => (v ? { n: v.n, p: v.p } : null)),
      lg: slots.map(({ e }) => (!e || e.meta.lg[label] === undefined ? null : e.meta.lg[label])),
      career: weightedMean(vals.map((v, i) => [v ? v.n : null, seasons[i].mp]))
    }
  }

  // Each regular season against the rest of his career (the card shows it for a past
  // player, and for an active player's past seasons).
  const out = latest.season !== [...ctx().seasons.keys()].sort().pop() && latest.season !== graceSeason()
  if (type === 'regular' && seasons.filter(s => !s.empty).length > 1) {
    for (const [i, s] of seasons.entries()) if (!s.empty) s.career = careerShift(bio.nbaId, seasons, stats, i)
  }

  const riser = riserFor(slug)
  const onOff = careerOnOff(slug, type)
  const grav = entries
    .filter(e => num(e.row['ORTG On']) !== null && num(e.row['DRTG On']) !== null)
    .map(e => ({ season: seasonLabel(e.season), on: num(e.row['ORTG On']), off: num(e.row['DRTG On']), mp: num(e.row.MP) }))

  return {
    slug,
    seasonType: type,
    // Playoff runs on file, so either mode can say whether there are any.
    playoffs: { runs: runs.length, latest: runs.length ? runs[runs.length - 1].season : null },
    // In the latest season; otherwise the card shows each season against his others.
    active: !out,
    // Out of the latest season and on no current depth chart (one out injured still has a team).
    retired: out && !depthTeam,
    name,
    team,
    teamName: TEAMS[team] ? TEAMS[team].name : null,
    headshot: headshotOf(slug).source,
    headshotVersion: headshotOf(slug).version,
    bio: {
      position: bio.position || null,
      height: heightOf(slug).text,
      age: age === null ? null : round1(age),
      born: ctx().born[bio.nbaId] || null,
      nbaId: bio.nbaId || null,
      draft: draftOf(bio.nbaId),
      // His teams every season he played, those under the minutes floor (no season row)
      // too, so the season picker's team band runs through them.
      teamsBySeason: bio.teamsBySeason || null
    },
    awards: awardsOf(slug),
    seasons,
    careerTm: careerTeams.size > 1 ? `${careerTeams.size} TM` : (careerTeams.size ? [...careerTeams][0] : team),
    careerMP,
    tabs: TABS.map(([id, tabName, rows]) => ({ id, name: tabName, stats: rows.map(([label]) => label) })),
    stats,
    riser: riser && {
      rows: riser.rows,
      score: riser.score,
      pctl: riser.score === null ? null : percentileOf(riser.score, ctx().riserPool),
      poGP: riser.poGP,
      runs: riser.runs,
      span: riser.span,
      teams: riser.teams
    },
    onOff: onOff && { value: onOff.value, pctl: percentileOf(onOff.value, ctx().onOffPool[type]) },
    grav: grav.length
      ? {
          seasons: grav.slice(-5),
          career: { on: weightedMean(grav.map(g => [g.on, g.mp])), off: weightedMean(grav.map(g => [g.off, g.mp])) }
        }
      : null,
    gameLog: artifact(typed(type, 'gamelog'), slug),
    wowy: wowyFor(slug, type),
    lineups,
    jerseys: jerseysOf(slug, [lineups, ...seasons.map(s => s.card && s.card.lineups)], lonestar),
    footprint: footprintFor(slug, type),
    lonestar: lonestar && { seasons: lonestar.seasons },
    recentShift: type === 'playoffs' ? null : recentShift(slug),
    shotShift: type === 'playoffs' ? poShotShift(slug) : currentShots(slug) || youngShots(slug),
    depth
  }
}

// A player's headshot: his illustrated portrait in his current team's jersey (a retired
// player's: his main team's) ('jersey', assets/players/jersey/base/,
// scripts/portraits/jersey-build.js) where it's built, else
// the illustrated portrait as approved ('portrait', assets/players/webp/), else the
// styled NBA.com fallback ('nba', assets/players/nba/, from
// scripts/portraits/nba-fallback.js), else none. `version` is the jersey layers' content
// hash, else the file's; pages put it in the image URL so a replaced image gets a new URL
// instead of a cached old one. Not the modified time: every fresh checkout (the nightly
// build) would give every image a new URL.
const HEADSHOT_DIRS = [['portrait', 'webp'], ['nba', 'nba']]
const fileVersions = new Map()
const fileVersion = file => {
  const key = `${file}:${fs.statSync(file).mtimeMs}`
  if (!fileVersions.has(key)) fileVersions.set(key, crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8))
  return fileVersions.get(key)
}
// The face of a teammate with no profile (one who left before 2013-14, an anchor or a
// star in the older seasons): his NBA.com headshot under his NBA id, in its own folder
// (assets/players/cast/, scripts/portraits/nba-fallback.js --cast) so a name shared with a
// current player never borrows his face. `headshot` null until it's been made.
const castFaceOf = nbaId => {
  const file = path.join(__dirname, '..', 'assets', 'players', 'cast', `${nbaId}-100.webp`)
  return fs.existsSync(file) ? { key: String(nbaId), headshot: 'cast', headshotVersion: fileVersion(file) } : { key: String(nbaId), headshot: null, headshotVersion: null }
}
const illustrated = source => source === 'jersey' || source === 'portrait'
const headshotOf = slug => {
  const layers = jerseys.layersOf(slug)
  if (layers && fs.existsSync(path.join(jerseys.JERSEY_DIR, 'base', `${slug}-100.webp`))) return { source: 'jersey', version: layers.v }
  for (const [source, dir] of HEADSHOT_DIRS) {
    const file = path.join(__dirname, '..', 'assets', 'players', dir, `${slug}-100.webp`)
    if (fs.existsSync(file)) return { source, version: fileVersion(file) }
  }
  return { source: null, version: null }
}

// The built jersey layers ({ v, top, ids, current }, lib/jerseys.js) of the player,
// everyone on his lineup cards and his Lonestar stars, by slug, so the site can dress each
// in a season's jersey.
const jerseysOf = (slug, views, lonestar) => {
  const slugs = new Set([slug])
  if (lonestar) for (const v of lonestar.views) for (const s of v.scenarios) for (const t of s.stars) if (t.slug) slugs.add(t.slug)
  for (const L of views) {
    if (!L) continue
    for (const x of [L.self, ...L.mates, ...Object.values(L.people)]) if (x && x.slug) slugs.add(x.slug)
    for (const u of Object.values(L.units)) for (const k of ['best', 'mostUsed']) if (u[k]) for (const m of u[k].mates) if (m.slug) slugs.add(m.slug)
  }
  return Object.fromEntries([...slugs].map(s => [s, jerseys.layersOf(s)]).filter(([, l]) => l))
}

// Every player in the season data. Order: players with a portrait, then players
// in the latest season, then everyone else; within each group by value over
// replacement, (BPM + 2) x minutes (VORP up to a constant), so the top of the
// list is the most valuable players rather than high-BPM players in small
// minutes. It is summed over the last three seasons weighted 1/2/3 (newest
// heaviest, as the first portrait targets were picked), so one breakout or
// injury year doesn't decide the order; players outside those seasons use
// their last season. `bestSeason`: his regular season with the highest BPM among those with
// QUALIFYING_MP or more, and his team in it (the page's own order, and where a past player's
// tile opens), null without one.
const VALUE_WEIGHTS = [1, 2, 3]
const playerIndex = () => {
  const players = new Map()
  const ordered = [...ctx().seasons.entries()].sort(([a], [b]) => a.localeCompare(b))
  const latestSeason = ordered[ordered.length - 1][0]
  const weightOf = new Map(ordered.slice(-VALUE_WEIGHTS.length).map(([season], i) => [season, VALUE_WEIGHTS[i]]))
  for (const [season, s] of ordered) {
    for (const [slug, row] of s.rows) {
      const p = players.get(slug) || { slug, first: season, value: 0, recent: false }
      const bpm = num(row.BPM)
      const mp = num(row.MP)
      const seasonValue = bpm === null || mp === null ? null : (bpm + 2) * mp
      if (bpm !== null && mp >= QUALIFYING_MP && !(p.best && p.best.bpm >= bpm)) p.best = { season, bpm, team: row.Tm }
      // Seasons run oldest first, so older seasons only ever set a fallback value.
      if (!weightOf.has(season)) p.value = seasonValue === null ? -1e9 : seasonValue
      else {
        if (!p.recent) Object.assign(p, { value: 0, recent: true })
        if (seasonValue !== null) p.value += weightOf.get(season) * seasonValue
      }
      players.set(slug, { ...p, name: row.Player, team: row.Tm, last: season })
    }
  }
  const current = readJson(path.join(DATA_DIR, 'depth', '_index.json')) || {}
  return [...players.values()]
    // Back on a depth chart with no season in the window: no recent value to rank him by.
    .map(p => (p.recent || !current[p.slug] ? p : { ...p, value: 0 }))
    .sort((a, b) => (b.value - a.value) || a.name.localeCompare(b.name))
    .map(p => {
      const h = headshotOf(p.slug)
      return {
        slug: p.slug,
        name: p.name,
        team: current[p.slug] || p.team,
        seasons: [seasonLabel(p.first), seasonLabel(p.last)],
        bestSeason: p.best || null,
        // In the latest season (or last season, in the new one's first weeks: graceSeason), or
        // on a current depth chart (back from a season out).
        active: p.last === latestSeason || p.last === graceSeason() || !!current[p.slug],
        headshot: h.source,
        headshotVersion: h.version,
        // Jersey art's layers, so a tile can dress him in another team's jersey.
        layers: h.source === 'jersey' ? jerseys.layersOf(p.slug) : undefined
      }
    })
    .sort((a, b) =>
      (illustrated(b.headshot) - illustrated(a.headshot)) ||
      (b.active - a.active))
}

// Every team with its nickname and depth chart, for the profile's team switcher
// (it lands on the player in the viewed player's depth slot on the chosen team).
const teamList = () => Object.entries(TEAMS).map(([team, t]) => ({ team, name: t.name, depth: depthChart(team) }))

// One stat's values across each season's qualified pool (the players its percentiles
// rank against), sorted, for the season chart's hover histogram. Null for an unknown
// stat; seasons where the stat has no column are left out.
const distribution = (label, { type = 'regular' } = {}) => {
  const stat = ALL_STATS.find(s => s.label === label)
  if (!stat || !stat.column) return null
  const seasons = {}
  for (const [season, s] of book(type)) {
    const col = colOf(s, label, stat.column)
    if (!col) continue
    const values = s.pool.map(r => num(r[col])).filter(v => v !== null).sort((a, b) => a - b)
    if (values.length) seasons[season] = values.map(v => Math.round(v * 100) / 100)
  }
  return { stat: label, lowerBetter: LOWER_BETTER.has(label), seasons }
}

// The Leaderboard page's seasons (GET /api/leaderboard, api/[playoffs/]leaderboard/
// index.json), and one season (GET /api/leaderboard/:season, .../<season>.json): every
// player on that season's sheet (the regular season's pull keeps those with about 800
// minutes or more; the playoffs', everyone who played), each stat's value and percentile
// as his profile shows them, the stats grouped as the profile's tabs. The regular season
// adds the Footprint group: his team's on−off swing in each effect that season
// (lib/footprint.js; blank when either side's sample is too thin), its percentile among
// the season's swings read the way the effect helps (a style effect, neither: `neutral`),
// and `lit`, the effects whose swing clears the noise; each effect's `side` (off, def). A
// stat's `desc` is what it means: the sheet's glossary for its column, Footprint's own.
// Each stat's label is listed once (`labels`); a player's values (`v`) and percentiles
// (`p`) follow that order.
const leaderboardSeasons = (type = 'regular') => [...book(type).keys()].sort()
// The sheet's rolling-window stats (3yr shooting, 2yr rim defense), which the regular
// season's documents also carry for one season, as hidden columns (`1yr <label>`, in no
// group) from data/tracking-seasons.json (scripts/tracking-seasons.js): the
// Leaderboard's multi-season views use them in the windows' place (rolling windows
// overlap and can't be added up), and the playoffs-minus-regular view sets a run against
// its own season with them.
const ONE_YEAR = ['Wide Open 3s/36', 'Wide Open 3%', 'Pullup 3s/36', 'Pullup 3%', 'C&S 3s/36', 'C&S 3%', 'Def FGA <6ft /36', 'Def FGA Diff%']
const trackingSeasons = () => {
  const c = ctx()
  if (!c.trackingSeasons) c.trackingSeasons = (readJson(path.join(DATA_DIR, 'tracking-seasons.json')) || {}).seasons || {}
  return c.trackingSeasons
}
// The Lonestar groups: each player's stretch without his top star that season (and, its
// switch, without his top two stars together), All combined
// after a trade (lib/lonestar.js offered), else the one stretch it would stand on (his
// team's top-scored star's): each stat's change (off less on) as a column, its two sides
// as columns the table opens beside it (`sub`; over a span each side is weighted by its
// own minutes, `weight`, and the change taken again from them, `diff`: the site's
// lib/board.js), and his minutes each way, added up over a span (`sum`). [key, label,
// which way is better (0: a style), a share shown x100], the tab's stats with Net first.
const LONESTAR_COLUMNS = [['net', 'Net', 1], ['load', 'Load', 0], ['pts75', 'Pts / 75', 0], ['boxCreation', 'Box Creation', 0], ['passerRating', 'Passer Rating', 1], ['pa3_75', '3PA / 75', 0], ['fta75', 'FTA / 75', 0], ['rts', 'rTS%', 1, true], ['pct3', '3P%', 1, true], ['ctov', 'cTOV%', -1, true], ['ortg', 'ORTG', 1], ['rortg', 'rORTG', 1]]
// A Footprint swing to three decimals, so the site's average of seasons over a span comes
// out as the span's own swing to the tenth (one decimal can leave it 0.05 off); nudged a
// thousandth where three would show (toFixed, the site's) a different tenth than the
// tab's (`tenth`).
const thousandths = (x, tenth) => {
  const v = Math.round(x * 1000) / 1000
  return Number(v.toFixed(1)) === tenth ? v : Math.round((v + (x < v ? -0.001 : 0.001)) * 1000) / 1000
}
// `entry`: rows to read in the season sheet's place (the last 30 days', type 'recent').
const leaderboard = (season, { type = 'regular', entry } = {}) => {
  const s = entry || book(type).get(season)
  if (!s) return null
  const c = ctx()
  if (!c.latestNames) {
    c.latestNames = new Map()
    for (const [, x] of [...c.seasons].sort(([a], [b]) => a.localeCompare(b))) for (const [slug, row] of x.rows) c.latestNames.set(slug, row.Player)
  }
  const sheet = ALL_STATS.filter(x => x.column)
  const rows = [...s.rows]
  const stats = {}
  for (const { label, column } of sheet) {
    // Its decimals: the most among its first values (a whole number, a historical tab's
    // "5", would otherwise round the column).
    const col = colOf(s, label, column)
    const raws = col ? rows.map(([, row]) => row[col]).filter(v => num(v) !== null).slice(0, 50) : []
    stats[label] = { dec: raws.length ? Math.max(...raws.map(decimals)) : 1, relative: RELATIVE.has(label), lowerBetter: LOWER_BETTER.has(label), years: type === 'regular' ? yearsOf(column) : null, desc: c.glossary[column] || c.glossary[label] || null }
  }
  const labels = sheet.map(x => x.label)
  const groups = TABS.map(([id, name, tab]) => ({ id, name, stats: tab.map(([label]) => label).filter(l => stats[l]) }))
  const players = rows.map(([slug, row]) => {
    const entry = { source: s.source, row, meta: s }
    const vals = sheet.map(({ label, column }) => statValue(entry, label, column))
    const teams = (type === 'regular' && ((c.bio[slug] || {}).teamsBySeason || {})[season]) || [row.Tm]
    const h = headshotOf(slug)
    // His age at the same point of this season as the latest pull, as his profile has it.
    const now = ageAtLatestPull(playerSeasons(slug))
    return {
      slug,
      name: c.latestNames.get(slug) || row.Player,
      team: teams.length > 1 ? `${teams.length} TM` : row.Tm,
      // A player traded during the season: every team he played for, so a team's list has him.
      ...(teams.length > 1 ? { teams } : {}),
      pos: (c.bio[slug] || {}).position || null,
      age: now === null ? null : Math.round((now - (c.ages.latestEndYear - (Number(season.slice(0, 4)) + 1))) * 10) / 10,
      // His birth date, for the age on the day (the site's), where the sheet's may be missing.
      born: c.born[(c.bio[slug] || {}).nbaId] || null,
      // His height in inches, for the Leaderboard's Player group.
      ht: heightOf(slug).inches,
      gp: num(row.GP !== undefined ? row.GP : row.G),
      mp: num(row.MP),
      headshot: h.source,
      headshotVersion: h.version,
      v: vals.map(v => (v ? v.n : null)),
      p: vals.map(v => (v ? v.p : null))
    }
  })
  if (type === 'regular') {
    const one = trackingSeasons()[season] || {}
    for (const label of ONE_YEAR) {
      labels.push(`1yr ${label}`)
      // The window's text names its span ("3-year Catch & Shoot…"); this column is one season.
      const desc = stats[label].desc && stats[label].desc.replace(/^\d-year /, '')
      stats[`1yr ${label}`] = { ...stats[label], desc, years: null, hidden: true }
      const vals = players.map(pl => (one[pl.slug] && one[pl.slug][label] !== undefined ? one[pl.slug][label] : null))
      players.forEach((pl, i) => {
        pl.v.push(vals[i])
        pl.p.push(vals[i] === null ? null : percentileOf(vals[i], vals, stats[label].lowerBetter))
      })
    }
  }
  const these = type === 'regular' ? footprintData().teamSeasons.filter(ts => ts.season === season) : []
  if (these.length) {
    const league = footprintData().leagueOf([season])
    // No teammate checks: only the swings and whether they clear the bar are kept.
    const quiet = { nameOf: () => ({}), skillOf: () => null }
    const effects = players.map(pl => {
      const id = (c.bio[pl.slug] || {}).nbaId
      const fp = id ? footprint(these, id, league, quiet) : null
      return fp ? new Map(fp.effects.map(e => [e.key, e])) : null
    })
    groups.push({ id: 'footprint', name: 'Footprint', stats: FOOTPRINT_STATS.map(st => st.effect) })
    for (const st of FOOTPRINT_STATS) {
      stats[st.effect] = { key: st.key, dec: 1, relative: true, lowerBetter: st.good < 0, neutral: st.good === 0, swing: st.unit, side: st.side, desc: `His team's swing from him off to on: ${st.label}` }
      const k = labels.push(st.effect) - 1
      // The season being played shows its thin swings too, as the profile does.
      const of = effects.map(m => m && m.get(st.key)).map(e => (e && e.status !== 'na' && (e.status !== 'thin' || these[0].current) ? e : null))
      const pool = of.filter(Boolean).map(e => e.diff)
      players.forEach((pl, i) => {
        const e = of[i]
        pl.v.push(e ? thousandths(e.exact.diff, e.diff) : null)
        pl.p.push(e ? percentileOf(e.diff, pool, st.good < 0) : null)
        if (e && e.status === 'notable') (pl.lit = pl.lit || []).push(k)
      })
    }
    // Each swing's weight over a span (`weight`, a hidden column): its effective sample,
    // the slices' 1/(1/n_on + 1/n_off) summed, as the Footprint tab pools a span's
    // seasons, so the site's average of a player's seasons is his span's swing.
    for (const st of FOOTPRINT_STATS) {
      const label = `${st.effect} weight`
      stats[st.effect].weight = label
      stats[label] = { dec: 1, neutral: true, hidden: true, desc: `How much ${st.effect} counts over a span: its effective sample` }
      const k = labels.indexOf(st.effect)
      labels.push(label)
      players.forEach((pl, i) => {
        const e = pl.v[k] === null ? null : effects[i].get(st.key)
        pl.v.push(e ? Math.round(e.exact.w * 10) / 10 : null)
        pl.p.push(null)
      })
    }
  }
  const ls = type === 'regular' ? lonestarBase() : null
  if (ls && ls.data && ls.data.seasons.includes(season)) {
    const score = x => x.stars.reduce((a, star) => a + ls.data.docs.find(d => d.season === season && d.team === x.team).stars[star].score, 0)
    const offered = players.map(pl => {
      const id = (c.bio[pl.slug] || {}).nbaId
      return id ? lonestarLib.offered(ls.data, id, ls.ctx, [season]) : []
    })
    const add = (stretches, label, stat, of) => {
      stats[label] = stat
      labels.push(label)
      const vals = stretches.map(x => (x ? of(x) : null)).map(v => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100))
      const pool = vals.filter(v => v !== null)
      players.forEach((pl, i) => {
        pl.v.push(vals[i])
        pl.p.push(vals[i] === null ? null : percentileOf(vals[i], pool, stat.lowerBetter))
      })
    }
    // Without his top star (the tab), and without his top two together (`alt`: the same tab
    // switched, its labels led by "Duo"); `mins`: its minutes without them and with.
    for (const [kind, lead, star, group] of [['one', '', "his top star (each team's, after a trade)", { id: 'lonestar' }], ['two', 'Duo ', "his top two stars (each team's, after a trade)", { id: 'lonestar-duo', alt: 'lonestar' }]]) {
      const stretches = offered.map(all => {
        const these = all.filter(x => x.kind === kind && !x.example)
        return these.find(x => x.all) || these.sort((a, b) => score(b) - score(a))[0] || null
      })
      // Who he was without (`stars`, by group: each team's stars and the seasons), for the
      // row's hover.
      const who = ids => ids.map(t => {
        const { name, slug, headshot, headshotVersion, face } = ls.ctx.nameOf(t)
        return { name, slug, headshot, headshotVersion, ...(face ? { face } : {}) }
      })
      stretches.forEach((x, i) => {
        if (!x) return
        const parts = x.parts || [{ team: x.team, stars: x.stars, seasons: x.seasons }]
        players[i].stars = { ...players[i].stars, [group.id]: parts.map(pt => ({ team: pt.team, seasons: pt.seasons, stars: who(pt.stars) })) }
      })
      for (const [key, name, dir, share] of LONESTAR_COLUMNS) {
        const way = { dec: 1, lowerBetter: dir < 0, neutral: dir === 0 }
        const at = (x, v) => (x[v][key] === null ? null : x[v][key] * (share ? 100 : 1))
        const l = `${lead}${name}`
        add(stretches, `${l} Δ`, { ...way, relative: true, sub: [`${l} on`, `${l} off`], diff: [`${l} off`, `${l} on`], desc: `His ${name} with ${star} off the floor, less with him on (Lonestar)` }, x => (x.change[key] === null ? null : x.change[key] * (share ? 100 : 1)))
        add(stretches, `${l} on`, { ...way, head: 'On', weight: `${lead}Min on`, desc: `His ${name} with ${star} on the floor` }, x => at(x, 'on'))
        add(stretches, `${l} off`, { ...way, head: 'Off', weight: `${lead}Min off`, desc: `His ${name} with ${star} off the floor` }, x => at(x, 'off'))
      }
      add(stretches, `${lead}Min off`, { dec: 0, neutral: true, sum: true, desc: `His minutes with ${star} off the floor` }, x => x.off.minutes)
      add(stretches, `${lead}Min on`, { dec: 0, neutral: true, sum: true, desc: `His minutes with ${star} on the floor` }, x => x.on.minutes)
      groups.push({ ...group, name: 'Lonestar', stats: [...LONESTAR_COLUMNS.map(([, name]) => `${lead}${name} Δ`), `${lead}Min off`, `${lead}Min on`], mins: [`${lead}Min off`, `${lead}Min on`] })
    }
  }
  return { season, type, seasons: leaderboardSeasons(type), groups, labels, stats, players }
}

// The Leaderboard's playoffs-minus-regular-season view of a season (GET
// /api/playoffs/leaderboard/delta/:season, api/playoffs/leaderboard/delta/<season>.json):
// every playoff player with a regular-season row that season (the regular sheet keeps
// those with about 800 minutes), each stat his playoff value minus his regular-season one,
// its percentile among those changes read the way the stat helps. A stat the sheet keeps
// over a rolling window sets the run against his single season (the hidden 1yr columns).
// Footprint has no playoffs, so no group here. Team, games and minutes are the
// playoffs'.
const leaderboardDelta = season => {
  const po = leaderboard(season, { type: 'playoffs' })
  const rs = leaderboard(season)
  if (!po || !rs) return null
  const reg = new Map(rs.players.map(pl => [pl.slug, pl]))
  const at = new Map(rs.labels.map((l, i) => [l, i]))
  const regOf = l => (at.has(`1yr ${l}`) ? at.get(`1yr ${l}`) : at.get(l))
  const players = po.players.filter(pl => reg.has(pl.slug)).map(pl => {
    const r = reg.get(pl.slug)
    const v = po.labels.map((l, k) => (pl.v[k] === null || r.v[regOf(l)] === null ? null : Math.round((pl.v[k] - r.v[regOf(l)]) * 1000) / 1000))
    return { ...pl, v, p: po.labels.map(() => null) }
  })
  po.labels.forEach((l, k) => {
    const pool = players.map(pl => pl.v[k]).filter(v => v !== null)
    for (const pl of players) if (pl.v[k] !== null) pl.p[k] = percentileOf(pl.v[k], pool, po.stats[l].lowerBetter)
  })
  const stats = Object.fromEntries(po.labels.map(l => [l, { ...po.stats[l], relative: true, years: at.has(`1yr ${l}`) ? null : rs.stats[l].years }]))
  return { season, type: 'delta', seasons: leaderboardSeasons('playoffs'), groups: po.groups, labels: po.labels, stats, players }
}

// The Leaderboard's last 30 days of the latest season (GET /api/leaderboard/recent,
// api/leaderboard/recent.json): the sheet scoped to the window (data/recent-window.json,
// scripts/recent-shift.js), every player it keeps (its minutes floor scaled to the
// window), each stat's value and its percentile among them (the window's rows carry no
// percentiles). The stats the sheet can't scope to dates are listed but `na`, with no
// values (WINDOW_NA; in a 2025-26 pull, all but Net On/Off and Mates Spacing matched the
// season's value for every player); a group with none left is `na`, as is Footprint
// (built from whole seasons' lineups). Time of Poss %, a season-level import there, comes
// from NBA.com's touches over the window instead (data/recent-touches.json, the Mac's
// scripts/touches-window.js, which can run a night behind the sheet's window); without
// them for the season it's `na` too.
const WINDOW_NA = new Set([
  // Their off-court half comes from the team play-by-play, which stays season-wide.
  'Net On/Off', 'Team Net', 'Team Off', 'Team Def', 'Mates Spacing',
  // Tracking, over whole seasons (the shooting and rim-defense ones over two or three).
  'Drives / 36', 'Drives TS%', 'Touches / Drive', 'Wide Open 3s/36', 'Wide Open 3%', 'Pullup 3s/36', 'Pullup 3%',
  'C&S 3s/36', 'C&S 3%', 'Def FGA <6ft /36', 'Def FGA Diff%',
  // From whole seasons' lineups.
  'rRim2FT', 'Rim2FT'
])
// The window's Offense view leads into OBPM with his impact (Net On, Net On/Off, BPM) and
// has DRTG On beside ORTG On, so the last 30 days read on one table (the 2026-10-14 review
// notes); the other groups are the season's.
const RECENT_OFFENSE = ['Pts / 75', 'rTS%', 'Net On', 'Net On/Off', 'BPM', 'OBPM', 'ScoreVal', 'PlayVal', 'ORTG On', 'DRTG On', 'rOS%', 'Good:Bad Pass', 'Handle TOV%', 'Non-Pass TOV%']
const leaderboardRecent = () => {
  const doc = readJson(path.join(DATA_DIR, 'recent-window.json'))
  if (!doc || !ctx().seasons.has(doc.season)) return null
  const rows = new Map(doc.rows.map(r => [slugify(r.Player), r]))
  const board = leaderboard(doc.season, { type: 'recent', entry: { source: 'daily', rows } })
  const t = readJson(path.join(DATA_DIR, 'recent-touches.json'))
  const touches = t && t.season === doc.season ? t.players : null
  const unscoped = touches ? WINDOW_NA : new Set([...WINDOW_NA, 'Time of Poss %'])
  board.labels.forEach((label, k) => {
    const na = unscoped.has(label)
    if (na) board.stats[label] = { ...board.stats[label], na: true }
    if (touches && label === 'Time of Poss %') for (const pl of board.players) pl.v[k] = num((touches[(ctx().bio[pl.slug] || {}).nbaId] || {}).recent)
    const pool = board.players.map(pl => pl.v[k]).filter(v => v !== null)
    for (const pl of board.players) {
      if (na) pl.v[k] = null
      pl.p[k] = pl.v[k] === null ? null : percentileOf(pl.v[k], pool, board.stats[label].lowerBetter)
    }
  })
  const groups = board.groups.map(g => (g.id === 'offense' ? { ...g, stats: RECENT_OFFENSE.filter(l => board.stats[l]) } : g)).map(g => (g.stats.every(l => unscoped.has(l)) ? { ...g, na: true } : g))
  return { ...board, groups: [...groups, { id: 'footprint', name: 'Footprint', stats: [], na: true }, { id: 'lonestar', name: 'Lonestar', stats: [], na: true }], window: doc.window }
}

// Old spellings of a player's slug (a name change), which buildProfile resolves to
// the current one; the static export writes a copy under each so old links work.
const aliasSlugs = () => [...ctx().alias.keys()]

// Exposed for tests and for build steps that need a fresh read of data/.
const resetContext = () => {
  context = null
  defExamples = null
  for (const cache of [lineupDocs, lineupLeagueCache, footprintLeague, lonestarCache]) for (const key of Object.keys(cache)) delete cache[key]
  jerseys.reset()
}

// Seasons with lineup files: the daily pull's and the archive history's, oldest first.
const lineupSeasons = (type = 'regular') => {
  const dir = path.join(DATA_DIR, 'history', typed(type, 'lineups'))
  const past = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => /^\d{4}-\d{2}$/.test(x)) : []
  const pulled = lineupTeams(type)
  return [...new Set([...past, ...(pulled.length ? [pulled[0].season] : [])])].sort()
}

module.exports = { teamUnitsDoc, unitsDoc, buildProfile, shotDotsOf, footprintOf, footprintDoc, footprintData, lonestarDoc, pbpStatsOf, leaderboard, leaderboardDelta, leaderboardRecent, leaderboardSeasons, playerIndex, teamList, distribution, lineupLeague, lineupSeasons, aliasSlugs, resetContext, weightedMean, pullOffsets, fillWindows }
