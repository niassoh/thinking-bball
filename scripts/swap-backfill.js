// Swaps a reviewed backfill (backfill-seasons.js --out=<file>) into data/cached-data.json.
// Only the on/off columns (FRESH) come from the new pull for a player the cache already has;
// his every other column stays cached. A player the cache lacks takes the new pull's whole row.
// Every percentile is then ranked again over the merged rows, as backfill-seasons.js toCache ranks it.
//   node scripts/swap-backfill.js <review file> [--out=<file>]  (default: data/cached-data.json)
const fs = require('fs')
const path = require('path')
const { compress, decompress } = require('compress-json')

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cached-data.json')
const FRESH = ['Net On', 'Net On/Off', 'AuPM', 'AuPM/g', 'ORTG On', 'DRTG On']

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
  const head = doc.values[0]
  // The sheet repeats a row when two players share a name (2007-08's Marcus Williams), so a copy goes.
  doc.values = doc.values.filter((r, i) => i < 2 || doc.values.findIndex(x => x.join() === r.join()) === i)
  const was = new Map(old.values.slice(2).map(r => [r[0], r]))
  const from = head.map(c => (FRESH.includes(c) || c.startsWith('perc') ? -1 : old.values[0].indexOf(c)))
  let kept = 0
  for (const r of doc.values.slice(2)) {
    const o = was.get(r[0])
    if (!o) continue
    from.forEach((j, i) => { if (j >= 0) r[i] = o[j] })
    kept++
  }
  for (const c of head) if (head.includes('perc' + c)) rank(doc, c)
  const names = new Set(doc.values.slice(2).map(r => r[0]))
  return { value: compress(doc), kept, added: doc.values.length - 2 - kept, missing: [...was.keys()].filter(n => !names.has(n)) }
}

const main = () => {
  const [review] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const out = (process.argv.find(a => a.startsWith('--out=')) || '').slice('--out='.length) || CACHE_FILE
  const fresh = JSON.parse(fs.readFileSync(review, 'utf8'))
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  for (const key of Object.keys(fresh).sort()) {
    if (!cache[key]) throw new Error(`${key} isn't in the cache`)
    const { value, kept, added, missing } = merge(fresh[key], cache[key])
    if (missing.length) throw new Error(`${key}: cached players missing from the new pull: ${missing.join(', ')}`)
    cache[key] = value
    console.log(`${key}: new on/off for ${kept} cached players, ${added} players added`)
  }
  fs.writeFileSync(out, JSON.stringify(cache, null, 0))
}

main()
