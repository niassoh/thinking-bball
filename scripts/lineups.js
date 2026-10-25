// For every team in the latest season with games:
//   data/lineups/<TEAM>.json: every five-man lineup the team used, as its
//     players' NBA ids with seconds, possessions and plus-minus (pbpstats
//     lineup totals), and (regular season) the box-score counts in
//     lib/footprint.js FIELDS for the team (t) and its opponents (o) while it
//     was on (lineup and lineup-opponent totals), for the footprint module. Regular
//     season files hold the season as `chunks` of dates split where traded players
//     joined or left the team (lib/stints.js); readers sum them for the season.
//   data/stints.json: each traded player's first and last game with each team (pbpstats
//     game logs), which set those splits.
//   data/lineup-players.json: the name of every player in those lineups (pbpstats'
//     player list), for players the site has no bio for.
// pbpstats cuts a lineup list at its most-played LINEUP_CAP rows, so a team's
// season is pulled over date ranges split in half until each comes back under
// the cap, and the pieces are summed per lineup. Every second of a game falls
// in exactly one five-man lineup, so profiles sum these for any player, pair
// or trio (lib/lineups.js) and the minutes floors shown on the site can change
// without a re-pull.
// --playoffs: the same for that season's playoff teams, to data/playoffs/lineups/ and
// data/playoffs/lineup-players.json.
// --season=YYYY-YY: a past regular season, to data/seasons/YYYY-YY/lineups/ and
// data/seasons/YYYY-YY/lineup-players.json (the footprint covers the season before the
// latest one too, so that season is pulled once it's over).
const fs = require('fs')
const path = require('path')
const pbp = require('../lib/pbpstats')
const { writeArtifact } = require('../lib/artifacts')
const { BASE_FIELDS: FIELDS, countsOf, addCounts } = require('../lib/footprint')
const { stintsOf, chunkDates, mergeLineups } = require('../lib/stints')
const { recentWindow } = require('../lib/window')

const DATA_DIR = path.join(__dirname, '..', 'data')

const TYPE = process.argv.includes('--playoffs') ? 'playoffs' : 'regular'
const SEASON = (process.argv.find(a => a.startsWith('--season=')) || '').slice('--season='.length) || null
if (SEASON && (TYPE !== 'regular' || !/^\d{4}-\d{2}$/.test(SEASON))) throw new Error(`--season takes a regular season like 2024-25, not ${SEASON}`)
const PREFIX = TYPE === 'playoffs' ? 'playoffs' : SEASON ? `seasons/${SEASON}` : ''

// Each lineup row as { r, o }: its totals and (regular season) its opponents' over the
// same dates, which must cover the same lineups.
const pullDates = async (teamId, season, dates, calls) => {
  calls.n++
  const [from, to] = [dates[0], dates[dates.length - 1]]
  const rows = await pbp.lineups(teamId, season, from, to, TYPE)
  if (rows.length < pbp.LINEUP_CAP) {
    if (TYPE !== 'regular') return rows.map(r => ({ r }))
    calls.n++
    const opp = new Map((await pbp.lineups(teamId, season, from, to, TYPE, 'LineupOpponent')).map(o => [o.EntityId, o]))
    // A lineup the opponent never had the ball against has no opponent row (all zeros),
    // and one the team never had the ball in has no team row (so it isn't in the lineup
    // list, as before; its opponent row is left out). Any other mismatch is an error.
    const ids = new Set(rows.map(r => r.EntityId))
    const missing = rows.filter(r => !opp.has(r.EntityId))
    const extra = [...opp.values()].filter(o => !ids.has(o.EntityId))
    if (missing.some(r => r.DefPoss) || extra.some(o => o.DefPoss)) throw new Error(`${from}..${to}: ${opp.size} opponent rows for ${rows.length} lineups`)
    if (extra.length) console.log(`  ${from}..${to}: ${extra.length} opponent row(s) for lineups the team never had the ball in, left out`)
    return rows.map(r => ({ r, o: opp.get(r.EntityId) || {} }))
  }
  if (dates.length === 1) throw new Error(`${dates[0]}: ${rows.length} lineups in one day`)
  const mid = Math.ceil(dates.length / 2)
  return [...await pullDates(teamId, season, dates.slice(0, mid), calls), ...await pullDates(teamId, season, dates.slice(mid), calls)]
}

// The counts must add up: points scored and allowed equal the team's game scores, and
// every field has some total for the season (a misspelled field name would read as
// zeros; checked from a team's 10th game, as a rare count can still be 0 before then).
// pbpstats' lineup plus-minus can be off in a game (CHA's 2025-03-25 game in
// 2024-25 sums to −7 for a 104–107 loss), so a plus-minus that disagrees is only logged.
const checkCounts = (team, teamId, rows, games) => {
  const t = rows.reduce((a, l) => addCounts(a, l.t), null)
  const o = rows.reduce((a, l) => addCounts(a, l.o), null)
  const pm = rows.reduce((a, l) => a + l.plusMinus, 0)
  const points = FIELDS.indexOf('Points')
  const mine = games.filter(g => g.HomeTeamId === teamId || g.AwayTeamId === teamId)
  const scored = mine.reduce((a, g) => a + (g.HomeTeamId === teamId ? g.HomePoints : g.AwayPoints), 0)
  const allowed = mine.reduce((a, g) => a + (g.HomeTeamId === teamId ? g.AwayPoints : g.HomePoints), 0)
  if (t[points] !== scored || o[points] !== allowed) throw new Error(`${team}: points ${t[points]}-${o[points]} != game scores ${scored}-${allowed}`)
  if (t[points] - o[points] !== pm) console.log(`  ${team}: lineup plus-minus ${pm} != points ${t[points] - o[points]} (pbpstats plus-minus; counts match the scores)`)
  const empty = FIELDS.filter((f, i) => !t[i] || !o[i])
  if (empty.length && mine.length >= 10) throw new Error(`${team}: no season total for ${empty.join(', ')}`)
}

// Pulled rows merged per lineup (the pieces of a date range split under the cap).
const mergeRows = pulled => {
  const merged = new Map()
  for (const { r, o } of pulled) {
    const l = merged.get(r.EntityId) || { ids: r.EntityId.split('-'), seconds: 0, offPoss: 0, defPoss: 0, plusMinus: 0 }
    l.seconds += r.SecondsPlayed || 0
    l.offPoss += r.OffPoss || 0
    l.defPoss += r.DefPoss || 0
    l.plusMinus += r.PlusMinus || 0
    if (o) {
      l.t = addCounts(l.t, countsOf(r))
      l.o = addCounts(l.o, countsOf(o))
    }
    merged.set(r.EntityId, l)
  }
  return [...merged.values()].sort((a, b) => b.seconds - a.seconds)
}

// One team's season as chunks of dates with their lineups: in the regular season split
// where traded players joined or left the team (lib/stints.js), so a traded player's
// on/off can cover just his time there, and at the Last 30 Days window's start (`at`);
// one chunk in the playoffs.
const pullTeam = async (team, teamId, season, dates, stints, at) => {
  const calls = { n: 0 }
  const chunks = []
  for (const part of TYPE === 'regular' ? chunkDates(dates, stints, team, at) : [dates]) {
    chunks.push({ from: part[0], to: part[part.length - 1], lineups: mergeRows(await pullDates(teamId, season, part, calls)) })
  }
  return { chunks, calls: calls.n }
}

// Players in two or more teams' lineups (traded during the season), with those teams.
const tradedIn = docs => {
  const teams = new Map()
  for (const d of docs) for (const id of new Set(d.lineups.flatMap(l => l.ids))) teams.set(id, [...(teams.get(id) || []), d.team])
  return [...teams].filter(([, t]) => t.length > 1)
}

const main = async () => {
  const season = SEASON || await pbp.latestSeasonWithGames()
  const games = [...(await pbp.games(season, TYPE)).values()]
  const teamIds = await pbp.teamIds(season, TYPE)
  const datesOf = teamId => [...new Set(games.filter(g => g.HomeTeamId === teamId || g.AwayTeamId === teamId).map(g => g.Date))].sort()
  // The season being played also splits where the shot map's Last 30 Days begin
  // (scripts/shotshift.js), for possessions on either side of it.
  const at = TYPE === 'regular' && !SEASON ? [recentWindow(await pbp.games(season, TYPE)).start] : []
  const dir = PREFIX ? `${PREFIX}/lineups` : 'lineups'

  // Traded players' stints (from their game logs), kept in stints.json and fetched only
  // for a player whose teams aren't all in it yet. The last pull's files name the traded
  // players before this one, so its chunks are split right the first time.
  const stintsFile = path.join(DATA_DIR, PREFIX, 'stints.json')
  const saved = TYPE === 'regular' && fs.existsSync(stintsFile) ? JSON.parse(fs.readFileSync(stintsFile, 'utf8')) : null
  const stints = saved && saved.season === season ? saved.players : {}
  let logCalls = 0
  const learn = async docs => {
    for (const [id, teams] of tradedIn(docs)) {
      if (stints[id] && teams.every(t => stints[id][t])) continue
      stints[id] = stintsOf(await pbp.gameLogs(id, season))
      logCalls++
      const missing = teams.filter(t => !stints[id][t])
      if (missing.length) console.log(`  ${id}: in ${missing.join(', ')} lineups but not in his game log there (that team's season is used whole)`)
    }
  }
  if (TYPE === 'regular') {
    const lastDir = path.join(DATA_DIR, dir)
    const last = fs.existsSync(lastDir) ? fs.readdirSync(lastDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(lastDir, f), 'utf8'))) : []
    await learn(last.filter(d => d.season === season).map(d => ({ team: d.team, lineups: d.lineups || mergeLineups(d.chunks.map(c => c.lineups)) })))
  }

  const pulled = {}
  for (const [team, teamId] of Object.entries(teamIds).sort()) {
    pulled[team] = { cuts: JSON.stringify(chunkDates(datesOf(teamId), stints, team, at)), ...await pullTeam(team, teamId, season, datesOf(teamId), stints, at) }
  }
  // Trades this pull is the first to see split their teams' seasons anew.
  if (TYPE === 'regular') {
    await learn(Object.entries(pulled).map(([team, p]) => ({ team, lineups: mergeLineups(p.chunks.map(c => c.lineups)) })))
    for (const [team, teamId] of Object.entries(teamIds).sort()) {
      if (JSON.stringify(chunkDates(datesOf(teamId), stints, team, at)) === pulled[team].cuts) continue
      console.log(`  ${team}: new trade dates, pulled again`)
      pulled[team] = await pullTeam(team, teamId, season, datesOf(teamId), stints, at)
    }
  }

  let changed = 0
  const ids = new Set()
  for (const [team, teamId] of Object.entries(teamIds).sort()) {
    const { chunks, calls } = pulled[team]
    const rows = mergeLineups(chunks.map(c => c.lineups))
    if (TYPE === 'regular') checkCounts(team, teamId, rows, games)
    for (const l of rows) for (const id of l.ids) ids.add(id)
    const minutes = Math.round(rows.reduce((a, l) => a + l.seconds, 0) / 60)
    console.log(`${team}: ${datesOf(teamId).length} games, ${chunks.length} chunk(s), ${calls} calls, ${rows.length} lineups, ${minutes} min`)
    const doc = TYPE === 'regular' ? { season, team, generatedAt: new Date().toISOString(), fields: FIELDS, chunks } : { season, team, generatedAt: new Date().toISOString(), lineups: rows }
    if (writeArtifact(dir, team, doc, { inlineNumberArrays: TYPE === 'regular' })) changed++
  }
  console.log(`lineups ${season}${TYPE === 'playoffs' ? ' playoffs' : ''}: ${changed} of ${Object.keys(teamIds).length} team files changed`)
  if (TYPE === 'regular') {
    const players = Object.fromEntries(Object.entries(stints).sort(([a], [b]) => a.localeCompare(b)))
    writeArtifact(PREFIX, 'stints', { season, generatedAt: new Date().toISOString(), players })
    console.log(`stints: ${Object.keys(players).length} traded players (${logCalls} game logs fetched)`)
  }
  const all = await pbp.players()
  const players = Object.fromEntries([...ids].sort().map(id => [id, all[id] || null]))
  const unnamed = Object.values(players).filter(n => !n).length
  writeArtifact(PREFIX, 'lineup-players', { season, generatedAt: new Date().toISOString(), players })
  console.log(`lineup players: ${ids.size} (${unnamed} without a name)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
