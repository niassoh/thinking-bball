// Swaps a reviewed backfill (backfill-seasons.js --out=<file>) into data/cached-data.json.
// A player the new pull leaves without rOS% keeps his cached value (the 2026-11-06 sheet copy
// fills it for only 272 rows a season, the rest blank; where both have one they're identical),
// and the column's percentile is ranked again as backfill-seasons.js toCache ranks it.
//   node scripts/swap-backfill.js <review file> [--out=<file>]  (default: data/cached-data.json)
const fs = require('fs')
const path = require('path')
const { compress, decompress } = require('compress-json')

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cached-data.json')
const KEEP = ['rOS%']

// toCache's percentile: ascending (descending for its reversed columns), ties sharing the
// first one's rank, '-' for a row without a number.
const rank = (doc, col) => {
  const i = doc.values[0].indexOf(col)
  const p = doc.values[0].indexOf('perc' + col)
  const rows = doc.values.slice(2)
  const ranked = rows.filter(r => !isNaN(parseFloat(r[i])))
  ranked.sort((a, b) => a[i] - b[i])
  if (col.includes('Team Def') || col.includes('DRTG') || col.includes('cTOV') || col.includes('Diff%') || doc.sorty[col] === 'ASC') ranked.sort((a, b) => b[i] - a[i])
  let last = 0
  ranked.forEach((r, j) => {
    if (r[i] != ranked[last][i]) last = j // eslint-disable-line eqeqeq
    r[p] = (last / ranked.length).toFixed(2)
  })
  for (const r of rows) if (isNaN(parseFloat(r[i]))) r[p] = '-'
}

const merge = (fresh, cached) => {
  const doc = decompress(fresh)
  const old = decompress(cached)
  const filled = {}
  for (const col of KEEP) {
    const i = doc.values[0].indexOf(col)
    const j = old.values[0].indexOf(col)
    const was = new Map(old.values.slice(2).map(r => [r[0], r[j]]))
    filled[col] = 0
    for (const r of doc.values.slice(2)) {
      if (r[i] === '' && was.get(r[0])) { r[i] = was.get(r[0]); filled[col]++ }
    }
    rank(doc, col)
  }
  return { value: compress(doc), filled }
}

const main = () => {
  const [review] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const out = (process.argv.find(a => a.startsWith('--out=')) || '').slice('--out='.length) || CACHE_FILE
  const fresh = JSON.parse(fs.readFileSync(review, 'utf8'))
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  for (const key of Object.keys(fresh).sort()) {
    if (!cache[key]) throw new Error(`${key} isn't in the cache`)
    const { value, filled } = merge(fresh[key], cache[key])
    cache[key] = value
    console.log(`${key}: swapped; kept cached ${Object.entries(filled).map(([c, n]) => `${c} for ${n}`).join(', ')}`)
  }
  fs.writeFileSync(out, JSON.stringify(cache, null, 0))
}

main()
