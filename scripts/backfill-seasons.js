// Backfills regular seasons before 2013-14 into data/cached-data.json as
// dailycat-<YY> keys, pulled through the stats sheet the same way
// sheets-catmulti.js builds dailycat-14..26: set Instructions!A13 to the
// season, wait for the Format tab to recalculate, cache it. The profile then
// reads every sheet column (AuPM, Net On, Net On/Off, ...) for those seasons
// instead of the 9-stat 1historical-24 subset.
//
// The league averages in 'PBP Team' (ORTG/DRTG in II52/IL52, TS% in IH60)
// assume 30 teams. In a 29-team season (2000-01..2003-04) the empty ORTG/DRTG
// row errors, which blanks SRS, BPM, OBPM, ScoreVal, PlayVal, Team Net/Off/Def
// and AuPM, and the empty TS% row counts as 0, which inflates rTS%. They are
// swapped for averages that skip the empty row while such a season is pulled,
// and in a new season until every team has played, whose empty rows do the same
// (same values with 30 teams). These cells and Instructions!A13 are always
// restored afterwards, including on failure.
//
// The nightly pipeline pulls the season being played with it too (`node
// scripts/backfill-seasons.js 2026-27`): A13 already holds that season then,
// so the season before it is loaded first, unsaved, to make the imports refetch.
// Once every team has played, A13 is all that run writes: the sheet is otherwise its
// maintainers' (2026-10-21).
//
// Usage: node scripts/backfill-seasons.js [2003-04 2004-05 ...]  (default 2000-01..2012-13)
//        node scripts/backfill-seasons.js --out=<file> [seasons]  (write the keys to <file> for review, not the cache)
//        node scripts/backfill-seasons.js --check  (re-pull the current A13 season, compare with its cached key, write nothing)
//
// --playoffs does the same through the playoff stats sheet into dailycat-playoffs-<YY>
// (default 2013-14..2025-26). Its 'PBP Team' averages are the same cells, patched the same
// way for a 29-team season (1996-97..2003-04; pbpstats has every playoffs from 1996-97).
// Before 2013-14 there's no tracking, so a season counts as loaded without its imports.
//
// Its players' rTS% (and BPM, OBPM, ScoreVal, PlayVal, AuPM on top of it) subtracts the
// opponents' regular-season TS% allowed, averaged over the team's playoff games: 'Game
// Import' (pbpstats' get-games) lists the games, 'PS Game Results' P5:P34 averages them per
// team. Two gaps blank it, and each is patched for the run and restored afterwards:
// - P5:P34 holds today's 30 codes, so a team that used another code that season (the Nets in
//   New Jersey, the Sonics, the first Charlotte Hornets, the New Orleans Hornets, the
//   Vancouver Grizzlies) found no row: Chris Paul's 2008 playoffs. Those cells take the
//   season's codes (pastCodes).
// - pbpstats lists no playoff games before 2000-01, so for 1996-97..1999-00 the games come
//   from the archive (data/history/playoff-games.json, analysis/playoff_games.py), written
//   over the tab's import. Only their teams count; nothing reads a game's possessions.
// A season whose playoff teams still lack an opponent average fails rather than caching.
//
// pbpstats' players and teams miss games in those four postseasons too (the 1996-97 Lakers
// 4 of 9), so their totals come from our play-by-play and box scores
// (data/history/playoff-players.json, analysis/playoff_players.py), written over 'PS PBP''s
// and 'PBP Team''s playoff imports the same way; the tabs' own columns (PS PBP IT:KM, which
// 'All PS' reads; PBP Team IF:JL, the teams' ratings) find each field by name. A playoff
// run also holds the sheet's minutes floor ('League data'!F1) at 50, as the cached seasons
// were pulled.
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const { compress, decompress } = require('compress-json')
const { sleep } = require('../lib/http')

const PLAYOFFS = process.argv.includes('--playoffs')
const SHEET_ID = PLAYOFFS ? '1v8vHxHLw94KgsPCZ5s4BLfYygZFRFQ0Tr4wrThZPq_g' : '10deal7utcC-C3j3w_3lJX-LjOqpEQ6l8KZBxmGT6OVE'
const CACHE_FILE = path.join(__dirname, '..', 'data', 'cached-data.json')
const POLL_MS = 20000
const TIMEOUT_MS = 20 * 60000
// pbpstats, which feeds AuPM and the on/off columns, starts in 2000-01 for the regular
// season's sheet as built.
const DEFAULT_SEASONS = Array.from({ length: 13 }, (_, i) =>
  `${(PLAYOFFS ? 2013 : 2000) + i}-${String((PLAYOFFS ? 14 : 1) + i).padStart(2, '0')}`)
const TEAM_AVERAGES = [
  { range: "'PBP Team'!II52", original: '=AVERAGE(II22:II51)', patched: '=AVERAGE(FILTER(II22:II51, ISNUMBER(II22:II51)))' },
  { range: "'PBP Team'!IL52", original: '=AVERAGE(IL22:IL51)', patched: '=AVERAGE(FILTER(IL22:IL51, ISNUMBER(IL22:IL51)))' },
  // League TS% for rTS%: the missing team's row reads as 0 instead of erroring.
  { range: "'PBP Team'!IH60", original: '=AVERAGE(IH61:IH92)', patched: '=AVERAGEIF(IH61:IH92, ">0")' }
]

// The codes a season's teams used, for the franchises whose code has changed since: today's
// code -> that season's.
const pastCodes = season => {
  const end = Number(season.slice(0, 4)) + 1
  return {
    ...(end <= 2012 ? { BKN: 'NJN' } : {}),
    ...(end <= 2008 ? { OKC: 'SEA' } : {}),
    ...(end <= 2002 ? { CHA: 'CHH' } : {}),
    ...(end <= 2001 ? { MEM: 'VAN' } : {}),
    ...(end >= 2003 && end <= 2013 ? { NOP: end === 2006 || end === 2007 ? 'NOK' : 'NOH' } : {})
  }
}
const TEAM_LIST = "'PS Game Results'!P5:P34"
const GAME_IMPORT = "'Game Import'!A1:J200"
const GAMES = path.join(__dirname, '..', 'data', 'history', 'playoff-games.json')
// The archive writes today's codes, and Phoenix as PHO.
const ARCHIVE_CODES = { PHO: 'PHX', CHO: 'CHA', BRK: 'BKN' }
// 'PS PBP''s import runs from A2 (header) to IS; its own columns start at IT.
const PLAYER_IMPORT = "'PS PBP'!A2:IS800"
// 'All PS' lists only 'PS PBP''s first 172 players (IT3:IT174).
const ALL_PS_ROWS = 172
// 'PBP Team''s playoff import: a header at A2 and the 16 teams to HU18 (a label sits at A20).
const TEAM_IMPORT = "'PBP Team'!A2:HU18"
const PLAYERS = path.join(__dirname, '..', 'data', 'history', 'playoff-players.json')
const MINUTES_FLOOR = "'League data'!F1"

const sheetsClient = async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, '..', 'privatekey.json'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth: await auth.getClient() })
}

const readCell = async (sheets, range) => {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range })
  return (r.data.values && r.data.values[0] && r.data.values[0][0]) || ''
}

const writeYear = (sheets, season) =>
  sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: 'Instructions!A13', valueInputOption: 'RAW', requestBody: { values: [[season]] } })

const writeFormulas = (sheets, key) =>
  sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: TEAM_AVERAGES.map(p => ({ range: p.range, values: [[p[key]]] })) }
  })

const readRange = async (sheets, range, render = 'FORMATTED_VALUE') =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range, valueRenderOption: render })).data.values || []
const writeRange = (sheets, range, values) =>
  sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range, valueInputOption: 'USER_ENTERED', requestBody: { values } })

// The playoff patches for a season: its codes in the team list, and the archive's games
// where pbpstats has none (returns whether it wrote them).
const patchPlayoffs = async (sheets, season, teamList) => {
  const codes = pastCodes(season)
  await writeRange(sheets, TEAM_LIST, teamList.map(t => [codes[t] || t]))
  const games = fs.existsSync(GAMES) && JSON.parse(fs.readFileSync(GAMES, 'utf8')).seasons[season]
  if (!games) return false
  const code = c => { const today = ARCHIVE_CODES[c] || c; return codes[today] || today }
  const header = JSON.parse(fs.readFileSync(GAMES, 'utf8')).fields
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: GAME_IMPORT })
  await writeRange(sheets, `'Game Import'!A1:J${games.length + 1}`, [header, ...games.map(g => [...g.slice(0, 6), '', '', code(g[8]), code(g[9])])])
  return true
}

const restoreGameImport = async (sheets, formula) => {
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: GAME_IMPORT })
  await writeRange(sheets, "'Game Import'!A1", [[formula]])
}

// Our players and teams over 'PS PBP''s and 'PBP Team''s imports where pbpstats misses
// games (returns whether it wrote them).
const patchPlayers = async (sheets, season) => {
  const doc = fs.existsSync(PLAYERS) && JSON.parse(fs.readFileSync(PLAYERS, 'utf8'))
  const rows = doc && doc.seasons[season]
  if (!rows) return false
  const blank = r => r.map(v => (v === null ? '' : v))
  // Most minutes first, so the players past 'All PS''s rows are ones the floor drops anyway.
  const minutes = doc.fields.indexOf('Minutes')
  const sorted = [...rows].sort((a, b) => b[minutes] - a[minutes])
  const over = sorted.filter(r => r[minutes] >= 50).length
  if (over > ALL_PS_ROWS) throw new Error(`${season}: ${over} players over 50 minutes, but 'All PS' lists ${ALL_PS_ROWS}`)
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: PLAYER_IMPORT })
  await writeRange(sheets, "'PS PBP'!A2", [doc.fields, ...sorted.map(blank)])
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: TEAM_IMPORT })
  await writeRange(sheets, "'PBP Team'!A2", [doc.teamFields, ...doc.teams[season].map(blank)])
  return true
}

const restorePlayerImport = async (sheets, formulas) => {
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: PLAYER_IMPORT })
  await writeRange(sheets, "'PS PBP'!A2", [[formulas.players]])
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: TEAM_IMPORT })
  await writeRange(sheets, "'PBP Team'!A2", [[formulas.teams]])
}

// Every playoff team in 'PBP Team' (IF3:IF18) has its opponents' TS% (JL, col 33).
const checkOpponents = async (sheets, season) => {
  const rows = await readRange(sheets, "'PBP Team'!IF3:JL18")
  const missing = rows.filter(r => r[0] && !(r[32] && /^[\d.]+%?$/.test(r[32]))).map(r => r[0])
  if (missing.length) throw new Error(`${season}: no opponent averages for ${missing.join(', ')}`)
}

const readFormat = async sheets =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Format' })).data

// Format rows 0-3 are category/glossary/sort/rounding, row 4 the header.
const fingerprint = data => (data.values || []).slice(5, 30).map(r => `${r[0]}:${r[2]}`).join('|')

// The tracking tabs IMPORTDATA their season's CSVs and finish after the rest
// of the sheet, so a season counts as loaded only once each import has data.
const TRACKING_CELLS = ['Touches!B3', 'Drives!B3', "'CS3'!B3", "'PU3'!B3", "'WO3'!B3", 'Inside6!B3']

// Counts named players rather than reading a fixed row: early in a season Format's first
// rows are blank ('All RS' has 375 formula rows, and its empty ones pass Sort's minutes
// filter and sort first).
const loaded = async (sheets, data, season) => {
  const v = data.values || []
  const named = v.slice(5).filter(r => r[0] && r[0] !== '#N/A').length
  if (named < 11 || /Loading/i.test(JSON.stringify(v))) return false
  if (season < '2013-14') return true
  const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: TRACKING_CELLS })
  return r.data.valueRanges.every(c => { const x = c.values && c.values[0] && c.values[0][0]; return x && !/Loading|#/.test(x) })
}

// Waits until Format differs from `before`, every tracking import has loaded,
// and the whole of Format is unchanged across two reads.
const settle = async (sheets, season, before) => {
  const deadline = Date.now() + TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const data = await readFormat(sheets)
    const ready = (await loaded(sheets, data, season)) && fingerprint(data) !== before
    const all = ready ? JSON.stringify(data.values) : null
    if (all && all === last) return data
    last = all
  }
  throw new Error(`Sheet did not settle for ${season} within ${TIMEOUT_MS / 60000} minutes`)
}

// Waits until Format differs from `before`, loaded or not, and returns its fingerprint
// then; `before` if it never does (a sheet erroring for both seasons looks the same).
const changed = async (sheets, before) => {
  for (let i = 0; i < 9; i++) {
    await sleep(POLL_MS)
    const now = fingerprint(await readFormat(sheets))
    if (now !== before) return now
  }
  return before
}

// Same cleaning and percentile ranking as sheets-catmulti.js pullSheet, so the
// backfilled keys are indistinguishable from the ones it writes.
const toCache = data => {
  const json = { ...data, values: data.values.filter(j => (j[0] || '').length) }
  for (let i = 0; i < json.values.length; i++) {
    for (let j = 0; j < json.values[i].length; j++) {
      const v = json.values[i][j]
      if (v === '#N/A' || v.includes('!') || (isNaN(parseInt(v)) && !v.length)) json.values[i][j] = ''
      if (i !== 4 && json.values[i][j].includes('%') && json.values[i][j] !== '-') {
        json.values[i][j] = json.values[i][j].replace('%', '')
      }
    }
  }
  const col = json.values[4]
  const cat = json.values[0]
  const len = col.length
  let newR = json.values.slice(1)
  const gloss = newR.shift()
  const sorty = newR.shift()
  const roundy = newR.shift()
  newR.shift()
  const glossO = {}
  const roundO = {}
  const sortO = {}
  for (let i = 0; i < col.length; i++) {
    glossO[col[i]] = gloss[i]
    roundO[col[i]] = roundy[i] ? roundy[i] : ''
    sortO[col[i]] = sorty[i] ? sorty[i] : ''
  }
  for (const row of newR) while (row.length < col.length) row.push('-')

  for (let i = 1; i < len; i++) {
    col.push('perc' + col[i])
    const rows = newR.filter(s => !isNaN(parseFloat(s[i])))
    const rows2 = newR.filter(s => isNaN(parseFloat(s[i])))
    rows.sort((a, b) => a[i] - b[i])
    if (col[i].includes('Team Def') || col[i].includes('DRTG') || col[i].includes('cTOV') ||
        col[i].includes('Diff%') || sortO[col[i]] === 'ASC') {
      rows.sort((a, b) => b[i] - a[i])
    }
    let last = 0
    for (let j = 0; j < rows.length; j++) {
      if (rows[j][i] != rows[last][i]) last = j // eslint-disable-line eqeqeq
      rows[j].push((last / rows.length).toFixed(2).toString())
    }
    for (const row of rows2) row.push('-')
    newR = rows.concat(rows2)
  }
  json.values = [col, cat, ...newR]
  json.glossy = glossO
  json.roundy = roundO
  json.sorty = sortO
  return compress(json)
}

const keyFor = season => (PLAYOFFS ? 'dailycat-playoffs-' : 'dailycat-') + season.split('-')[1]

const readCache = () => JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))

const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice('--out='.length)

const saveKey = (key, value) => {
  const file = OUT || CACHE_FILE
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  cache[key] = value
  fs.writeFileSync(file, JSON.stringify(cache, null, 0))
}

// Compares a fresh pull of the current season with its cached key.
const check = async sheets => {
  const season = await readCell(sheets, 'Instructions!A13')
  const fresh = decompress(toCache(await readFormat(sheets)))
  const cached = decompress(readCache()[keyFor(season)])
  const header = fresh.values[0]
  const cachedRows = new Map(cached.values.slice(2).map(r => [r[0], r]))
  const diffs = {}
  for (const row of fresh.values.slice(2)) {
    const old = cachedRows.get(row[0])
    if (!old) continue
    header.forEach((h, i) => {
      if (row[i] !== old[i]) (diffs[h] = diffs[h] || []).push(`${row[0]} ${old[i]} -> ${row[i]}`)
    })
  }
  console.log(`${season}: header ${header.join() === cached.values[0].join() ? 'same' : 'DIFFERENT'}, ` +
    `${fresh.values.length - 2} fresh vs ${cached.values.length - 2} cached players`)
  for (const [h, d] of Object.entries(diffs)) console.log(`  ${h}: ${d.length} differ, e.g. ${d[0]}`)
}

const main = async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--out=') && a !== '--playoffs')
  const sheets = await sheetsClient()
  if (args.includes('--check')) return check(sheets)

  const seasons = args.length ? args : DEFAULT_SEASONS
  if (!seasons.every(s => /^(19|20)\d{2}-\d{2}$/.test(s))) throw new Error(`Bad season in ${seasons.join(' ')}`)
  const original = await readCell(sheets, 'Instructions!A13')
  if (await readCell(sheets, 'Instructions!E13')) throw new Error('A recent-shift window is set in Instructions!E13; run it to completion first')
  const rated = (await readRange(sheets, "'PBP Team'!II22:II51")).filter(r => /^-?[\d.]+$/.test(r[0] || '')).length
  const patch = seasons.some(s => s < '2004-05') || rated < 30
  console.log(`Instructions!A13 is ${original}; ${rated} of 30 teams rated${patch ? ', so the league averages are patched for the run' : ''}`)
  for (const p of patch ? TEAM_AVERAGES : []) {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: p.range, valueRenderOption: 'FORMULA' })
    const current = r.data.values[0][0]
    if (current !== p.original && current !== p.patched) throw new Error(`${p.range} is ${current}, expected ${p.original}`)
  }

  const teamList = PLAYOFFS ? (await readRange(sheets, TEAM_LIST)).map(r => r[0]) : null
  const importFormula = PLAYOFFS ? (await readRange(sheets, "'Game Import'!A1", 'FORMULA'))[0][0] : null
  if (PLAYOFFS && (teamList.length !== 30 || !/IMPORTJSON/i.test(importFormula))) throw new Error(`Unexpected ${TEAM_LIST} or 'Game Import'!A1: ${teamList.join()} / ${importFormula}`)
  const playerFormula = PLAYOFFS ? {
    players: (await readRange(sheets, "'PS PBP'!A2", 'FORMULA'))[0][0],
    teams: (await readRange(sheets, "'PBP Team'!A2", 'FORMULA'))[0][0]
  } : null
  if (PLAYOFFS && !(/IMPORTJSON/i.test(playerFormula.players) && /SeasonType=Playoffs&Type=Team/.test(playerFormula.teams))) {
    throw new Error(`Unexpected 'PS PBP'!A2 or 'PBP Team'!A2: ${JSON.stringify(playerFormula)}`)
  }
  const floor = PLAYOFFS ? (await readRange(sheets, MINUTES_FLOOR, 'FORMULA'))[0][0] : null
  let gamesWritten = false
  let playersWritten = false
  let before = fingerprint(await readFormat(sheets))
  try {
    if (patch) await writeFormulas(sheets, 'patched')
    if (PLAYOFFS) await writeRange(sheets, MINUTES_FLOOR, [[50]])
    let current = original
    for (const season of seasons) {
      // Format only recalculates when A13 changes, so a season A13 already holds would
      // never settle: show the season before it first (not saved), only until Format
      // reacts, since its imports aren't used and can fail (pbpstats' 502 on 2026-10-21).
      if (season === current) {
        const prior = `${Number(season.slice(0, 4)) - 1}-${season.slice(2, 4)}`
        await writeYear(sheets, prior)
        before = await changed(sheets, before)
      }
      await writeYear(sheets, season)
      current = season
      if (PLAYOFFS) {
        gamesWritten = await patchPlayoffs(sheets, season, teamList)
        playersWritten = await patchPlayers(sheets, season)
      }
      const data = await settle(sheets, season, before)
      if (PLAYOFFS) await checkOpponents(sheets, season)
      before = fingerprint(data)
      saveKey(keyFor(season), toCache(data))
      console.log(`${season}: ${data.values.slice(5).filter(r => r[0]).length} players -> ${keyFor(season)}${gamesWritten ? ' (games from the archive)' : ''}${playersWritten ? ' (players from our play-by-play)' : ''}`)
      if (gamesWritten) { await restoreGameImport(sheets, importFormula); gamesWritten = false }
      if (playersWritten) { await restorePlayerImport(sheets, playerFormula); playersWritten = false }
    }
  } finally {
    await writeYear(sheets, original)
    if (patch) await writeFormulas(sheets, 'original')
    if (PLAYOFFS) {
      if (gamesWritten) await restoreGameImport(sheets, importFormula)
      if (playersWritten) await restorePlayerImport(sheets, playerFormula)
      await writeRange(sheets, TEAM_LIST, teamList.map(t => [t]))
      await writeRange(sheets, MINUTES_FLOOR, [[floor]])
    }
    console.log(`Instructions!A13 restored to ${original}${patch ? `; ${TEAM_AVERAGES.map(p => p.range).join(', ')} restored` : ''}${PLAYOFFS ? `; ${TEAM_LIST}, 'Game Import'!A1, 'PS PBP'!A2, 'PBP Team'!A2 and ${MINUTES_FLOOR} (${floor}) restored` : ''}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
