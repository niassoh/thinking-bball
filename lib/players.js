const fs = require('fs')
const path = require('path')
const { decompress } = require('compress-json')

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cached-data.json')

// Names carry diacritics inconsistently across sources (Jokic vs Jokić), so
// every join goes through the slug.
const slugify = name =>
  name
    .replace(/\./g, '')
    // Letters with no Unicode decomposition (Aşık, Łukasz, Ørsted).
    .replace(/ı/g, 'i').replace(/ł/gi, 'l').replace(/ø/gi, 'o').replace(/đ/gi, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

let cache = null
const loadCache = () => {
  if (!cache) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  return cache
}

// NBA.com's 2024-25 possession time was broken when the sheet imported it, and still is
// (2026-11-04: teams' summed time of possession comes to 30-39 of 48 minutes, Trae Young
// 75%). data/tracking.json (scripts/tracking.js) keeps what it published at season end, so
// that season's Time of Poss % comes from there; a player it lacks gets none.
const TRACKING_FIX = { 'dailycat-25': ['2024-25', ['Time of Poss %']] }
let tracking = null
const fixTracking = (key, rows) => {
  if (!TRACKING_FIX[key]) return rows
  const [season, labels] = TRACKING_FIX[key]
  if (!tracking) tracking = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tracking.json'), 'utf8')).seasons
  const of = tracking[season] || {}
  return rows.map(r => ({ ...r, ...Object.fromEntries(labels.map(l => [l, (of[slugify(r.Player)] || {})[l] ?? ''])) }))
}

// Cached sheet pulls are [header, category, ...players]; returns rows as objects, with the
// sheet's glossary (`glossy`: column -> what it means, its Format tab's second row).
const loadSheet = key => {
  const raw = loadCache()[key]
  if (!raw) throw new Error(`No cached data for ${key}`)
  const sheet = decompress(raw)
  const [header, , ...rows] = sheet.values
  return {
    header,
    sorty: sheet.sorty || {},
    glossy: sheet.glossy || {},
    rows: fixTracking(key, rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]]))))
  }
}

// dailycat-26 holds the 2025-26 regular season.
// A key's season from its last part, a season's end year in two digits (97 is 1996-97,
// 00 is 1999-00, 26 is 2025-26).
const seasonFromKey = key => {
  const end = Number(key.split('-').pop())
  const year = end > 50 ? 1900 + end : 2000 + end
  return `${year - 1}-${String(year).slice(2)}`
}

const regularSeasonKeys = () =>
  Object.keys(loadCache())
    .filter(k => /^dailycat-\d+$/.test(k))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))

// dailycat-playoffs-26 holds the 2025-26 playoffs (playoff sheet, same columns).
const playoffSeasonKeys = () =>
  Object.keys(loadCache())
    .filter(k => /^dailycat-playoffs-\d+$/.test(k))
    .sort((a, b) => seasonFromKey(a).localeCompare(seasonFromKey(b)))

const num = v => {
  if (v === undefined || v === null || v === '' || v === '-') return null
  const n = parseFloat(v)
  return Number.isNaN(n) ? null : n
}

module.exports = { slugify, loadCache, loadSheet, seasonFromKey, regularSeasonKeys, playoffSeasonKeys, num }
