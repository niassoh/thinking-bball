// Core-stat shift for the profile card: each player's BPM / AuPM per game /
// Load / rTS% / Net On over the last 30 days of the season vs. the rest of it ->
// data/recent-shift.json; and the last 30 days' sheet rows (every profile stat's value
// and the sheet's percentile among the window's players) for the Leaderboard ->
// data/recent-window.json.
//
// The stats sheet only scopes by season (Instructions!A13), so this adds a
// date window to the live sheet:
//   - Instructions!E13 / F13: window start / end (YYYY-MM-DD); blank = off
//   - 'RS PBP'!A2: its pbpstats import gets &FromDate/&ToDate when E13 is set
//   - 'League data'!E1: the minutes floor scales to the window length when set
// With E13:F13 blank the sheet computes exactly what it did before. The patch
// is idempotent; originals are saved to data/sheet-formula-backup.json and
// `--restore` puts them back. Team-level imports ('PBP Team') stay season-wide.
//
// Usage: node scripts/recent-shift.js            (patch if needed, pull both windows)
//        node scripts/recent-shift.js --dry-run  (show the patch, change nothing)
//        node scripts/recent-shift.js --restore  (restore original formulas)
const fs = require('fs')
const path = require('path')
const { google } = require('googleapis')
const { slugify, loadSheet, regularSeasonKeys, num } = require('../lib/players')
const { percentileOf } = require('../lib/percentile')
const { ALL_STATS, LOWER_BETTER, SHIFT_STATS } = require('../lib/stats')
const pbp = require('../lib/pbpstats')
const { recentWindow } = require('../lib/window')
const { sleep } = require('../lib/http')

const SHEET_ID = '10deal7utcC-C3j3w_3lJX-LjOqpEQ6l8KZBxmGT6OVE'
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'sheet-formula-backup.json')
const OUT_FILE = path.join(__dirname, '..', 'data', 'recent-shift.json')
const WINDOW_FILE = path.join(__dirname, '..', 'data', 'recent-window.json')
// A row's own columns kept for the Leaderboard, with every profile stat's value and
// percentile.
const ID_COLUMNS = ['Player', 'Tm', 'Pos', 'Age', 'G', 'GP', 'MP']
const FROM = 'Instructions!$E$13'
const TO = 'Instructions!$F$13'
const STATS = SHIFT_STATS
const POLL_MS = 20000
const TIMEOUT_MS = 20 * 60000

const PATCHES = [
  {
    range: "'RS PBP'!A2",
    patched: f => f.includes('FromDate='),
    apply: f => f.replace(/Instructions!A13\s*,/, `Instructions!A13, IF(${FROM}="","","&FromDate="&${FROM}&"&ToDate="&${TO}),`)
  },
  {
    range: "'League data'!E1",
    patched: f => f.includes(FROM),
    apply: f => `=IF(${FROM}<>"", F1/163*(DATEVALUE(${TO})-DATEVALUE(${FROM})+1), ${f.replace(/^=/, '')})`
  }
]

const sheetsClient = async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, '..', 'privatekey.json'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  return google.sheets({ version: 'v4', auth: await auth.getClient() })
}

const readFormulas = async (sheets, ranges) => {
  const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges, valueRenderOption: 'FORMULA' })
  return r.data.valueRanges.map(v => (v.values && v.values[0] && v.values[0][0]) || '')
}

const writeCells = (sheets, data, valueInputOption = 'USER_ENTERED') =>
  sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption, data } })

const ensurePatched = async (sheets, dryRun) => {
  const current = await readFormulas(sheets, PATCHES.map(p => p.range))
  const todo = PATCHES.map((p, i) => ({ ...p, current: current[i] })).filter(p => !p.patched(p.current))
  for (const p of todo) console.log(`${dryRun ? '[dry-run] would patch' : 'patching'} ${p.range}\n  old: ${p.current}\n  new: ${p.apply(p.current)}`)
  if (dryRun || !todo.length) return
  const backup = fs.existsSync(BACKUP_FILE) ? JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')) : {}
  for (const p of todo) if (!backup[p.range]) backup[p.range] = p.current
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2) + '\n')
  await writeCells(sheets, [
    ...todo.map(p => ({ range: p.range, values: [[p.apply(p.current)]] })),
    { range: 'Instructions!E12:F12', values: [['Window from', 'Window to']] }
  ])
}

const restore = async sheets => {
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'))
  await writeCells(sheets, [
    ...Object.entries(backup).map(([range, f]) => ({ range, values: [[f]] })),
    { range: 'Instructions!E12:F13', values: [['', ''], ['', '']] }
  ])
  console.log(`restored ${Object.keys(backup).join(', ')} and cleared Instructions!E12:F13`)
}

// Format tab: rows 0-3 are category/glossary/sort/rounding, row 4 the header.
const readFormat = async sheets => {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Format' })
  const values = r.data.values || []
  const header = values[4] || []
  const rows = values.slice(5).filter(row => row[0] && row[0] !== '#N/A')
  return rows.map(row => Object.fromEntries(header.map((h, i) => [h, (row[i] || '').replace('%', '')])))
}

const fingerprint = rows => rows.slice(0, 25).map(r => `${r.Player}:${r.MP}`).join('|')

// Waits until the Format tab reflects a new scope: different from `before`,
// unchanged across two consecutive reads, and with plausible minutes.
const pullScope = async (sheets, from, to, before, maxMinutes) => {
  await writeCells(sheets, [{ range: 'Instructions!E13:F13', values: [[from, to]] }], 'RAW')
  const deadline = Date.now() + TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const rows = await readFormat(sheets)
    const fp = fingerprint(rows)
    const maxMP = Math.max(...rows.map(r => num(r.MP) || 0))
    if (rows.length > 20 && fp !== before && fp === last && maxMP <= maxMinutes) {
      console.log(`${from}..${to}: ${rows.length} players (max MP ${maxMP})`)
      return rows
    }
    last = fp
  }
  throw new Error(`Sheet did not settle for ${from}..${to} within ${TIMEOUT_MS / 60000} minutes`)
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1

const main = async () => {
  const sheets = await sheetsClient()
  if (process.argv.includes('--restore')) return restore(sheets)
  const dryRun = process.argv.includes('--dry-run')
  await ensurePatched(sheets, dryRun)
  if (dryRun) return

  const season = await pbp.latestSeasonWithGames()
  const [scopeSeason] = await readFormulas(sheets, ['Instructions!A13'])
  if (scopeSeason !== season) throw new Error(`Instructions!A13 is ${scopeSeason}, expected ${season}; run the season pull first`)
  const win = recentWindow(await pbp.games(season))
  // Until the season is a window old there's no "rest of season" to compare with (that pull
  // never settles); the nightly run calls this every day regardless.
  if (win.restEnd < win.seasonStart) return console.log(`recent-shift ${season}: under ${win.days} days of games, skipped`)

  let recentRows
  let restRows
  try {
    const seasonFp = fingerprint(await readFormat(sheets))
    recentRows = await pullScope(sheets, win.start, win.end, seasonFp, daysBetween(win.start, win.end) * 48)
    restRows = await pullScope(sheets, win.seasonStart, win.restEnd, fingerprint(recentRows), daysBetween(win.seasonStart, win.restEnd) * 48)
  } finally {
    // Always return the live sheet to season mode.
    await writeCells(sheets, [{ range: 'Instructions!E13:F13', values: [['', '']] }], 'RAW')
    console.log('cleared Instructions!E13:F13 (sheet back in season mode)')
  }

  const keys = regularSeasonKeys()
  const seasonRows = loadSheet(keys[keys.length - 1]).rows
  const bySlug = rows => new Map(rows.map(r => [slugify(r.Player), r]))
  const seasonMap = bySlug(seasonRows)
  const restMap = bySlug(restRows)
  const players = {}
  for (const [slug, recent] of bySlug(recentRows)) {
    const full = seasonMap.get(slug)
    const rest = restMap.get(slug)
    if (!full || !rest) continue
    players[slug] = STATS.map(([label, column]) => {
      const lowerBetter = LOWER_BETTER.has(label)
      const r = num(recent[column])
      const s = num(full[column])
      const rr = num(rest[column])
      if (r === null || s === null || rr === null) return null
      return {
        stat: label,
        season: { value: s, pctl: Math.round(num(full['perc' + column]) * 100) },
        // Where the recent value would land on the full-season distribution.
        recent: { value: r, pctl: percentileOf(r, seasonRows.map(x => num(x[column])), lowerBetter), mp: num(recent.MP) },
        rest: { value: rr }
      }
    }).filter(Boolean)
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ season, window: win, generatedAt: new Date().toISOString(), players }, null, 1) + '\n')
  console.log(`recent-shift ${season}: ${Object.keys(players).length} players, window ${win.start}..${win.end}`)

  const columns = [...ID_COLUMNS, ...ALL_STATS.filter(x => x.column).flatMap(x => [x.column, 'perc' + x.column])].filter(c => c in recentRows[0])
  const rows = recentRows.map(r => Object.fromEntries(columns.map(c => [c, r[c]])))
  fs.writeFileSync(WINDOW_FILE, JSON.stringify({ season, window: win, generatedAt: new Date().toISOString(), columns, rows }) + '\n')
  console.log(`recent-window ${season}: ${rows.length} players, ${columns.length} columns`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
