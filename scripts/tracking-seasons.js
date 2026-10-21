// Single-season tracking stats the stats sheet only has over rolling windows, for every
// regular season since 2013-14 -> data/tracking-seasons.json, for the Leaderboard's
// multi-season views (a span's seasons can't be added up from rolling values, which
// overlap). Read from the same season files the sheet's tracking tabs import (the
// thinkingbball bucket's <year>/player_tracking/{cs,pullup,close_6,touches}.csv and
// player_shooting/wide_open.csv, season totals), with the sheet's definitions over one
// season:
//   - catch-and-shoot, pull-up and wide-open threes (sheet: 3yr): 3PA / MIN x 36 (MIN
//     from cs.csv) and 3PM / 3PA x 100, a percentage needing MIN_3PA_FOR_PCT attempts;
//   - shots defended within 6 feet (sheet: 2yr, its Inside6 tab): DFGA / MIN x 36 (MIN
//     from touches.csv), and the file's Diff% (opponents' FG% on them minus their usual
//     FG%) when he defended any.
// A player missing from a file took (or defended) none of those shots. Summing these
// files over a window reproduces the sheet's columns (Diff% weighted by attempts).
//   node scripts/tracking-seasons.js
const fs = require('fs')
const path = require('path')
const Papa = require('papaparse')
const { sleep } = require('../lib/http')

const DATA_DIR = path.join(__dirname, '..', 'data')
const OUT_FILE = path.join(DATA_DIR, 'tracking-seasons.json')
const BUCKET = 'https://storage.googleapis.com/thinkingbball'
const FIRST_END_YEAR = 2014
const LAST_END_YEAR = 2027
const MIN_3PA_FOR_PCT = 10
const THREES = [['cs', 'player_tracking/cs.csv', 'C&S'], ['pullup', 'player_tracking/pullup.csv', 'Pullup'], ['wideOpen', 'player_shooting/wide_open.csv', 'Wide Open']]
const FILES = [...THREES, ['close', 'player_tracking/close_6.csv'], ['touches', 'player_tracking/touches.csv']]
const round1 = x => Math.round(x * 10) / 10
const n = v => (v === undefined || v === null || v === '' ? 0 : Number(v))

const load = async (year, file) => {
  const res = await fetch(`${BUCKET}/${year}/${file}`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${year} ${file}: HTTP ${res.status}`)
  const rows = Papa.parse(await res.text(), { header: true, skipEmptyLines: true }).data
  return new Map(rows.map(r => [String(r.PLAYER_ID), r]))
}

const main = async () => {
  const bio = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bio.json'), 'utf8'))
  const seasons = {}
  for (let y = FIRST_END_YEAR; y <= LAST_END_YEAR; y++) {
    const season = `${y - 1}-${String(y).slice(-2)}`
    const files = {}
    for (const [key, file] of FILES) {
      files[key] = await load(y, file)
      await sleep(200)
    }
    const out = {}
    for (const [slug, b] of Object.entries(bio)) {
      const cs = b.nbaId && files.cs.get(String(b.nbaId))
      if (!cs || !n(cs.MIN)) continue
      const s = {}
      for (const [key, , label] of THREES) {
        const r = files[key].get(String(b.nbaId))
        const att = r ? n(r['3PA']) : 0
        s[`${label} 3s/36`] = round1((att / n(cs.MIN)) * 36)
        if (att >= MIN_3PA_FOR_PCT) s[`${label} 3%`] = round1((n(r['3PM']) / att) * 100)
      }
      const d = files.close.get(String(b.nbaId))
      const t = files.touches.get(String(b.nbaId))
      const dfga = d ? n(d.DFGA) : 0
      if (t && n(t.MIN)) s['Def FGA <6ft /36'] = round1((dfga / n(t.MIN)) * 36)
      if (dfga) s['Def FGA Diff%'] = n(d['Diff%'])
      out[slug] = s
    }
    seasons[season] = Object.fromEntries(Object.entries(out).sort(([a], [c]) => a.localeCompare(c)))
    console.log(season, Object.keys(out).length, 'players')
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify({ source: `${BUCKET}/<year>/…`, generatedAt: new Date().toISOString(), seasons }) + '\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
