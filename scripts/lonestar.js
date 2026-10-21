// For the profile's Lonestar tab (lib/lonestar.js): how a player plays when his team's
// stars sit. For the latest regular season with games and the one before, per team:
//   data/lonestar/<season>/<TEAM>.json: each player's own totals (pbpstats) with the team
//     over the season, and in its minutes with sets of its stars off and on. Its stars
//     are its top four by star score (scoreOf: Load x (OBPM + 2), the sheet's, so a star
//     both carries the offense and does it well; box score only, see scoreOf), among
//     players with MIN_MINUTES for the team, those in a lead role (lib/lonestar.js leads:
//     a league-median Load at OBPM >= 0) ahead; the rest only fill in. `loads` holds each
//     of the team's players' sheet Load, for his ball competitors (lib/lonestar.js
//     ballOf). Every player's stars are his top two of
//     those he shared the floor with (lib/lonestar.js), so the sets are each of the four
//     alone and every pair; "off" is the minutes with none of the set on, "on" those with
//     at least one, and for a pair "both" those with both on (the tab compares without
//     both against with both).
//   data/lonestar/league.json: per season, league TS% (the average of the teams'), ORTG
//     and the share of assists at the rim (for rTS%, rORTG and Passer Rating), and the
//     top quarter's sheet Load (topLoad, for ball competitors).
// About 27 calls a team-season, 1 s apart. A past season's team files are kept once
// written (--refresh redoes them). --reuse keeps what a team's file already has (its
// season totals and any set of the same players) and pulls only the sets it lacks: for a
// finished season, when only the star picks change (a season still being played has new
// games in every set).
// --source=pbp: the same files from our own play-by-play (analysis/footprint/wowy.py over
// the possession cache build.py writes) instead of pbpstats, in seconds and with no calls,
// for when pbpstats is down or slow. Its rows sit within one or two of pbpstats' for
// most counts (see wowy.py); a season it covers needs its cache built from a current
// play-by-play archive first. Files record their `source`. --from=YYYY-YY builds every
// season from that one on (Lonestar has them all since 1996-97, from play-by-play).
// Stars are picked on the season's sheet tab from 2004-05, and before it on the historical
// tab's rows of the season (Load and OBPM for about 175 players a season; see sheetRowsOf).
//   node scripts/lonestar.js [--season=YYYY-YY | --from=YYYY-YY] [--team=DEN] [--refresh] [--reuse] [--source=pbp]
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const pbp = require('../lib/pbpstats')
const { writeArtifact, loadBio } = require('../lib/artifacts')
const { loadSheet, regularSeasonKeys, seasonFromKey, slugify, num } = require('../lib/players')
const { fromBrefAbbr } = require('../lib/teams')

const FIELDS = ['Minutes', 'OffPoss', 'DefPoss', 'PlusMinus', 'OpponentPoints', 'Points', 'Assists', 'AtRimAssists', 'FG2A', 'FG3A', 'FG3M', 'FTA', 'FtPoints', 'OffRebounds', 'Turnovers', 'TsPct']
const MIN_MINUTES = 500
// A lead role (lib/lonestar.js, which orders a player's stars by it too).
const { leads } = require('../lib/lonestar')
const STARS = 4

// A sheet row's star score: his offensive role (Load) times his offensive box-score impact
// over replacement (OBPM + 2, floored at 0), so a high-Load scorer with poor impact ranks
// below an efficient second option; null without them. Offense only, as the tab measures
// his offense without them: BPM's defense had ranked Plumlee ahead of Murray among
// Jokic's 2018-19 stars. Box score only: a plus-minus measure (AuPM, on/off) would pick stars partly by how
// the team did with them off, the very minutes the tab's Net and ORTG rows measure.
const scoreOf = r => {
  const load = num(r.Load)
  const obpm = num(r.OBPM)
  return load === null || obpm === null ? null : load * Math.max(0, obpm + 2)
}

const opt = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || null
const REFRESH = process.argv.includes('--refresh')
const REUSE = process.argv.includes('--reuse')
const SOURCE = opt('source') || 'pbpstats'
// --out: write under data/<out> instead of data/lonestar (a trial run beside the real files).
const OUT = opt('out') || 'lonestar'
const DATA = path.join(__dirname, '..', 'data', OUT)
// --source=pbp: the play-by-play helper, in the footprint pipeline's Python (its
// requirements.txt), over the possession cache its build.py writes.
const PYTHON = process.env.PBP_PYTHON || path.join(__dirname, '..', 'analysis', 'footprint', '.venv', 'bin', 'python')
const WOWY_PY = path.join(__dirname, '..', 'analysis', 'footprint', 'wowy.py')
const PBP_CACHE = path.join(__dirname, '..', 'data', 'cache', 'pbp')

// Compact rows: { nbaId: [FIELDS…] } (TS% null for a player with no shots).
const keep = rows => Object.fromEntries(rows.map(r => [String(r.EntityId), FIELDS.map(f => (r[f] === undefined || r[f] === null ? (f === 'TsPct' ? null : 0) : r[f]))]))
const minutesOf = base => new Map(Object.entries(base).map(([id, v]) => [id, v[FIELDS.indexOf('Minutes')] || 0]))

const priorSeason = s => `${Number(s.slice(0, 4)) - 1}-${s.slice(2, 4)}`

// A season's sheet rows: before HISTORICAL_UNTIL the historical tab's rows of it (one per
// team a player played for, `teamRow`, its team from 'Yr / Tm' in today's codes),
// with the season tab's rows of players it lacks (it keeps about 170 a season, the tab
// about 280); else the season tab's; null with neither. The season tabs begin in 2000-01
// (with pbpstats), and their backfill of 2000-01..2003-04 misses the historical tab's BPM
// by more than 1.5 for 15-31 players a season (Jordan's 2001-02: -1.5 against +1.4); from
// 2004-05 the two agree (90% within 0.4; docs/data-pull-audit.md #127).
const HISTORICAL_UNTIL = '2004-05'
const sheetRowsOf = season => {
  const key = regularSeasonKeys().find(k => seasonFromKey(k) === season)
  if (key && season >= HISTORICAL_UNTIL) return loadSheet(key).rows
  const rows = loadSheet('1historical-24').rows
    .filter(r => r.Player && (r['Yr / Tm'] || '').split(' ')[0] === season)
    .map(r => {
      const tm = r['Yr / Tm'].split(' ')[1]
      return { ...r, Tm: fromBrefAbbr(tm), teamRow: true }
    })
  const had = new Set(rows.map(r => slugify(r.Player)))
  const rest = key ? loadSheet(key).rows.filter(r => !had.has(slugify(r.Player))) : []
  return rows.length + rest.length ? [...rows, ...rest] : null
}

// A sheet name's nbaId: bio's, else the lineup history's names (data/history/players.json:
// players who left before 2000-01, whom bio doesn't have).
const HISTORY_PLAYERS = path.join(__dirname, '..', 'data', 'history', 'players.json')
let historyIds = null
const historyIdOf = slug => {
  if (!historyIds) {
    const named = fs.existsSync(HISTORY_PLAYERS) ? JSON.parse(fs.readFileSync(HISTORY_PLAYERS, 'utf8')).players : {}
    historyIds = new Map(Object.entries(named).filter(([, n]) => n).map(([id, n]) => [slugify(n), id]))
  }
  return historyIds.get(slug)
}

const idOf = (name, bio) => {
  const id = (bio[slugify(name)] || {}).nbaId || historyIdOf(slugify(name))
  return id && String(id)
}
// A team's stars: its top STARS by star score among players with MIN_MINUTES for it,
// those in a lead role first; `minutes` his minutes for the team.
const pick = (sheetRows, minutes, bio) => {
  const ranked = sheetRows
    .map(r => ({ id: idOf(r.Player, bio), load: num(r.Load), obpm: num(r.OBPM), score: scoreOf(r) }))
    .filter(r => r.id && r.score !== null && (minutes.get(r.id) || 0) >= MIN_MINUTES)
    .sort((a, b) => b.score - a.score)
  return [...ranked.filter(leads), ...ranked.filter(r => !leads(r))]
    .slice(0, STARS)
    .map(r => ({ ...r, score: Math.round(r.score), minutes: minutes.get(r.id) }))
}
// Each of a team's players' sheet Load: { nbaId: Load }.
const loadsOf = (sheetRows, bio) => Object.fromEntries(sheetRows.filter(r => idOf(r.Player, bio) && num(r.Load) !== null).map(r => [idOf(r.Player, bio), num(r.Load)]))
// The season's top-quarter Load: the 75th percentile of its rows' with MIN_MINUTES (a
// player's row with the most minutes, where the historical tab has one per team).
const topLoadOf = rows => {
  const best = new Map()
  for (const r of rows) {
    const v = { mp: num(r.MP) || 0, load: num(r.Load) }
    if (!best.has(slugify(r.Player)) || v.mp > best.get(slugify(r.Player)).mp) best.set(slugify(r.Player), v)
  }
  const loads = [...best.values()].filter(v => v.mp >= MIN_MINUTES && v.load !== null).map(v => v.load).sort((a, b) => a - b)
  return loads[Math.floor(loads.length * 0.75)]
}
// The sets stored for a team's stars: each alone and every pair.
const setsOf = top => {
  const ids = top.map(t => t.id)
  return [...ids.map(id => [id]), ...ids.flatMap((a, i) => ids.slice(i + 1).map(b => [a, b]))]
}

// The play-by-play helper's rows for a season: every team's season totals, and the sets
// asked for in `spec` ({ TEAM: [[id…]…] }), plus the league's values.
const local = (season, spec) => {
  const out = JSON.parse(execFileSync(PYTHON, [WOWY_PY, season], { input: JSON.stringify(spec), encoding: 'utf8', maxBuffer: 1 << 30 }))
  if (out.fields.join() !== FIELDS.join()) throw new Error(`${WOWY_PY}: its fields aren't the pull's`)
  return out
}

// `prev`: the team-season's file on disk with --reuse, whose season totals and sets are
// kept (a set by its players, whatever their order), so only sets it lacks are pulled;
// else null and everything is pulled.
const team = async (season, abbr, teamId, sheetRows, bio, prev) => {
  const base = prev ? prev.base : keep(await pbp.playersWith(teamId, season))
  const top = pick(sheetRows, minutesOf(base), bio)
  const had = prev ? Object.fromEntries(Object.entries(prev.sets).map(([k, s]) => [k.split(',').sort().join(), s])) : {}
  const out = {}
  let kept = 0
  for (const ids of setsOf(top)) {
    const key = ids.join(',')
    const old = had[[...ids].sort().join()]
    const pull = async filter => keep(await pbp.playersWith(teamId, season, { [filter]: key }))
    const set = { off: old ? old.off : await pull('0Exactly0OnFloor'), on: old ? old.on : await pull('0GreaterThan0OnFloor') }
    // A pair also has his minutes with both on (for one star that's "on").
    if (ids.length === 2) set.both = old && old.both ? old.both : await pull('0Exactly2OnFloor')
    if (old && (ids.length === 1 || old.both)) kept++
    out[key] = set
  }
  return { doc: { season, team: abbr, generatedAt: new Date().toISOString(), source: 'pbpstats', fields: FIELDS, top, loads: loadsOf(sheetRows, bio), base, sets: out }, kept }
}

const main = async () => {
  // With play-by-play, the newest season in the possession cache (pbpstats may be down).
  const newestCached = () => fs.readdirSync(PBP_CACHE).filter(d => /^\d{4}-\d{2}$/.test(d)).sort().pop()
  const latest = opt('season') || (SOURCE === 'pbp' ? newestCached() : await pbp.latestSeasonWithGames())
  // --from: every season from that one to the latest (the play-by-play cache reaches
  // back to 2013-14); else the latest and the one before.
  const since = from => Array.from({ length: Number(latest.slice(0, 4)) - Number(from.slice(0, 4)) + 1 }, (_, i) => {
    const y = Number(from.slice(0, 4)) + i
    return `${y}-${String(y + 1).slice(2)}`
  })
  const seasons = opt('season') ? [latest] : opt('from') ? since(opt('from')) : [priorSeason(latest), latest]
  const bio = loadBio()
  const leagueFile = path.join(DATA, 'league.json')
  const league = fs.existsSync(leagueFile) ? JSON.parse(fs.readFileSync(leagueFile, 'utf8')) : { seasons: {} }
  for (const season of seasons) {
    const rows = sheetRowsOf(season)
    if (!rows) throw new Error(`${season}: no sheet rows`)
    const current = season === latest
    const fileOf = abbr => path.join(DATA, season, `${abbr}.json`)
    // A team's file is built when asked (--refresh), when there's none, or for the season
    // being played; but a pbpstats run leaves one built from play-by-play alone (for a
    // finished season it's the more complete: pbpstats' filtered rows run short).
    const wanted = abbr => {
      if (opt('team') && abbr !== opt('team')) return false
      if (REFRESH || !fs.existsSync(fileOf(abbr))) return true
      return current && !(SOURCE === 'pbpstats' && JSON.parse(fs.readFileSync(fileOf(abbr), 'utf8')).source === 'pbp')
    }
    // The team's players that season (a traded player under each team he played for).
    const mineOf = abbr => rows.filter(r => {
      if (r.teamRow) return r.Tm === abbr
      const b = bio[slugify(r.Player)] || {}
      return ((b.teamsBySeason || {})[season] || [r.Tm]).includes(abbr)
    })
    const write = (doc, note = '') => {
      writeArtifact(`${OUT}/${season}`, doc.team, doc, { inlineNumberArrays: true })
      console.log(`${season} ${doc.team}: top ${doc.top.map(t => `${t.id} (${t.load})`).join(', ')} · ${Object.keys(doc.sets).length} sets${note}`)
    }
    let done = 0
    if (SOURCE === 'pbp') {
      // Season totals first (to pick each team's stars on its minutes), then their sets.
      const totals = local(season, {})
      const abbrs = Object.keys(totals.teams).sort().filter(wanted)
      const tops = Object.fromEntries(abbrs.map(a => [a, pick(mineOf(a), minutesOf(totals.teams[a].base), bio)]))
      const got = local(season, Object.fromEntries(abbrs.map(a => [a, setsOf(tops[a])])))
      for (const a of abbrs) {
        write({ season, team: a, generatedAt: new Date().toISOString(), source: 'pbp', fields: FIELDS, top: tops[a], loads: loadsOf(mineOf(a), bio), base: got.teams[a].base, sets: got.teams[a].sets })
        done++
      }
      league.seasons[season] = { ...got.league, topLoad: topLoadOf(rows) }
    } else {
      const ids = await pbp.teamIds(season)
      for (const [abbr, teamId] of Object.entries(ids).sort()) {
        if (!wanted(abbr)) continue
        const prev = REUSE && fs.existsSync(fileOf(abbr)) ? JSON.parse(fs.readFileSync(fileOf(abbr), 'utf8')) : null
        const { doc, kept } = await team(season, abbr, teamId, mineOf(abbr), bio, prev && prev.fields.join() === FIELDS.join() ? prev : null)
        write(doc, kept ? ` (${kept} kept)` : '')
        done++
      }
      // The league's values go with the team files they were pulled alongside.
      if (!done) continue
      const teams = await pbp.teamTotals(season)
      const players = await pbp.playerTotals(season)
      const sum = (xs, f) => xs.reduce((s, r) => s + (r[f] || 0), 0)
      league.seasons[season] = {
        ts: teams.reduce((s, t) => s + t.TsPct, 0) / teams.length,
        ortg: (100 * sum(teams, 'Points')) / sum(teams, 'OffPoss'),
        rimAstShare: sum(players, 'AtRimAssists') / sum(players, 'Assists'),
        topLoad: topLoadOf(rows)
      }
    }
    console.log(`${season}: ${done} teams from ${SOURCE}; league TS ${league.seasons[season].ts.toFixed(4)}, ORTG ${league.seasons[season].ortg.toFixed(1)}`)
  }
  league.generatedAt = new Date().toISOString()
  writeArtifact(OUT, 'league', league)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
