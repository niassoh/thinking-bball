// Player-tracking stats for every season, computed from gabriel1200/site_Data's
// per-season NBA tracking files -> data/tracking.json. lib/profile.js uses these
// instead of the stats sheet's tracking columns, which docs/tracking-data-audit.md
// found broken (pull-up import holding catch-and-shoot data, fixed/shifted
// prior-season windows, Drives blank before 2024-25, stale defense files).
//
// Definitions (sheet's intent, bugs fixed):
//   Time of Poss %       = TIME_OF_POSS / MIN x 2 x 100   (team has the ball ~half the time)
//   Drives/36            = DRIVES / MIN x 36
//   Touches per drive    = front-court touches / DRIVES
//   Drives TS%           = drive PTS / (2 x (drive FGA + 0.44 x drive FTA)) x 100
//                          (the sheet used 2xFGM + FTM, which dropped 3s on drives)
//   3yr * 3s/36, 3%      = this season and up to two prior seasons, summed:
//                          3PA / MIN x 36 and 3PM / 3PA x 100 (MIN from cs.csv)
//   2yr Def FGA < 6      = this and the prior season: DFGA / MIN x 36
//   2yr Def FGA Diff%    = (DFGM / DFGA - DFGA-weighted normal FG%) x 100
// Files are joined on PLAYER_ID via data/bio.json; close_6.csv has no id, so it
// joins on the name slug. A season whose source file is incomplete (fewer than
// MIN_COMPLETE_GP games for the league leader) is skipped for that stat rather
// than shown with wrong numbers. Rates need MIN_3PA_FOR_PCT attempts or
// MIN_DRIVES_FOR_RATES drives.
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const { slugify, regularSeasonKeys, seasonFromKey } = require('../lib/players')
const { sleep } = require('../lib/http')

const RAW = 'https://raw.githubusercontent.com/gabriel1200/site_Data'
// NBA.com reprocessed 2024-25 and 2025-26 tracking data after the fact (league
// drives +36-38%, 2024-25 drive FTs and possession time broken); site_Data's
// daily scraper would pick that up. These seasons are read at the commits that
// hold the values NBA.com published at season end
// (docs/tracking-source-investigation.md). Other seasons read master.
const PINS = {
  2025: { player_tracking: '8dd487dc8027614d5a656207b71572987060b65a', player_shooting: '070a59ba94ac99aa6007936d6b374edcf81495bd' },
  2026: { player_tracking: '8dd487dc8027614d5a656207b71572987060b65a', player_shooting: '070a59ba94ac99aa6007936d6b374edcf81495bd' }
}
const refFor = (year, file) => (PINS[year] && PINS[year][file.split('/')[0]]) || 'master'
const DATA_DIR = path.join(__dirname, '..', 'data')
const SOURCE_DIR = path.join(DATA_DIR, 'sources', 'site_Data')
const OUT_FILE = path.join(DATA_DIR, 'tracking.json')
const MIN_COMPLETE_GP = 60
// Below these samples a rate is noise (0% on one attempt, 90 touches per drive).
const MIN_3PA_FOR_PCT = 10
const MIN_DRIVES_FOR_RATES = 20
const FILES = {
  drives: 'player_tracking/drives.csv',
  touches: 'player_tracking/touches.csv',
  cs: 'player_tracking/cs.csv',
  pullup: 'player_tracking/pullup.csv',
  wideOpen: 'player_shooting/wide_open.csv',
  close6: 'player_tracking/close_6.csv'
}

const n = v => {
  const x = parseFloat(v)
  return Number.isNaN(x) ? 0 : x
}
const round1 = x => Math.round(x * 10) / 10
const baseSlug = name => slugify(name).replace(/-(jr|sr|ii|iii|iv)$/, '')

// Raw files are cached in data/sources/site_Data/ (gitignored) for auditability.
const loadFile = async (year, file) => {
  const local = path.join(SOURCE_DIR, String(year), file)
  let text
  const res = await fetch(`${RAW}/${refFor(year, file)}/${year}/${file}`, { signal: AbortSignal.timeout(60000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${year}/${file}`)
  text = await res.text()
  fs.mkdirSync(path.dirname(local), { recursive: true })
  fs.writeFileSync(local, text)
  await sleep(100)
  const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data
  const maxGP = Math.max(0, ...rows.map(r => n(r.GP)))
  return { rows, complete: maxGP >= MIN_COMPLETE_GP, maxGP }
}

// year (season end) -> { file: Map(key -> row) } keyed by NBA id (or name slug for close_6)
const loadYear = async year => {
  const out = { status: {} }
  for (const [key, file] of Object.entries(FILES)) {
    const f = await loadFile(year, file)
    out.status[key] = f ? (f.complete ? 'ok' : `incomplete (max ${f.maxGP} GP)`) : 'missing'
    if (!f || !f.complete) continue
    out[key] = new Map(f.rows.map(r => [key === 'close6' ? baseSlug(r.PLAYER) : String(parseInt(r.PLAYER_ID, 10)), r]))
  }
  return out
}

const sumWindow = (years, data, file, id, fields) => {
  const tot = Object.fromEntries(fields.map(f => [f, 0]))
  let seasons = 0
  for (const y of years) {
    const row = data[y] && data[y][file] && data[y][file].get(id)
    if (!row) continue
    seasons++
    for (const f of fields) tot[f] += n(row[f])
  }
  return seasons ? tot : null
}

const main = async () => {
  const bio = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bio.json'), 'utf8'))
  const seasonKeys = regularSeasonKeys()
  const endYears = seasonKeys.map(k => Number(seasonFromKey(k).slice(0, 4)) + 1)
  const data = {}
  const coverage = {}
  for (const y of [endYears[0] - 2, endYears[0] - 1, ...endYears]) {
    data[y] = await loadYear(y)
    coverage[y] = data[y].status
  }

  const seasons = {}
  for (const y of endYears) {
    const season = `${y - 1}-${String(y).slice(-2)}`
    const out = {}
    for (const [slug, b] of Object.entries(bio)) {
      const id = b.nbaId
      if (!id) continue
      const s = {}
      const d = data[y]

      const touches = d.touches && d.touches.get(id)
      if (touches && n(touches.MIN)) s['Time of Poss %'] = round1((n(touches['Time OfPoss']) / n(touches.MIN)) * 2 * 100)

      const drives = d.drives && d.drives.get(id)
      if (drives && n(drives.MIN)) {
        s['Drives/36'] = round1((n(drives.DRIVES) / n(drives.MIN)) * 36)
        if (n(drives.DRIVES) >= MIN_DRIVES_FOR_RATES) {
          const tsa = n(drives.FGA) + 0.44 * n(drives.FTA)
          if (tsa) s['Drives TS%'] = round1((n(drives.PTS) / (2 * tsa)) * 100)
          if (touches) s['Touches per drive'] = round1(n(touches['Front CTTouches']) / n(drives.DRIVES))
        }
      }

      // A window only exists if the player has this season's row (he played).
      const window3 = [y, y - 1, y - 2]
      const csNow = d.cs && d.cs.get(id)
      const mins3 = csNow ? sumWindow(window3, data, 'cs', id, ['MIN']) : null
      for (const [file, label] of [['pullup', 'Pullup'], ['cs', 'C&S'], ['wideOpen', 'Wide Open']]) {
        if (!mins3 || !mins3.MIN || !(d[file])) continue
        const t = sumWindow(window3, data, file, id, ['3PM', '3PA'])
        // A player missing from a shooting file had no such attempts that season.
        const att = t ? t['3PA'] : 0
        s[`3yr ${label} 3s/36`] = round1((att / mins3.MIN) * 36)
        if (att >= MIN_3PA_FOR_PCT) s[`3yr ${label} 3%`] = round1((t['3PM'] / att) * 100)
      }

      const window2 = [y, y - 1]
      const defNow = d.close6 && d.close6.get(baseSlug(b.sheetName))
      // The current season's file must be complete; the prior one is used if complete.
      if (defNow && d.touches) {
        let dfga = 0
        let dfgm = 0
        let expected = 0
        let mins = 0
        for (const yy of window2) {
          const r = data[yy] && data[yy].close6 && data[yy].close6.get(baseSlug(b.sheetName))
          const t = data[yy] && data[yy].touches && data[yy].touches.get(id)
          if (!r || !t) continue
          dfga += n(r.DFGA)
          dfgm += n(r.DFGM)
          expected += n(r.DFGA) * n(r['FG%'])
          mins += n(t.MIN)
        }
        if (mins) s['2yr Def FGA < 6 per36'] = round1((dfga / mins) * 36)
        if (dfga) s['2yr Def FGA Diff%'] = round1(((dfgm / dfga) * 100) - expected / dfga)
      }

      if (Object.keys(s).length) out[slug] = s
    }
    seasons[season] = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
  }

  const doc = { source: `${RAW}/<ref>/<year>/…`, pins: PINS, generatedAt: new Date().toISOString(), coverage, seasons }
  fs.writeFileSync(OUT_FILE, JSON.stringify(doc, null, 1) + '\n')
  for (const [season, players] of Object.entries(seasons)) {
    const counts = {}
    for (const p of Object.values(players)) for (const k of Object.keys(p)) counts[k] = (counts[k] || 0) + 1
    console.log(season, Object.keys(players).length, 'players', JSON.stringify(counts))
  }
  console.log('file coverage', JSON.stringify(coverage))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
