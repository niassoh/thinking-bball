// A three-way merge of data/cached-data.json by its keys, for bringing master's nightly data
// into this branch (scripts/mac-test-refresh.sh): each key takes the side that changed it
// since the merge base (master: the season being played; this branch: the backfilled past
// seasons). A key both sides changed differently stops the merge.
//   node scripts/merge-cache.js <base> <ours> <theirs>   (writes the result over <ours>)
const fs = require('fs')

const [base, ours, theirs] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const out = {}
const clash = []
for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
  const mine = !same(ours[k], base[k])
  const master = !same(theirs[k], base[k])
  if (mine && master && !same(ours[k], theirs[k])) clash.push(k)
  const v = master ? theirs[k] : ours[k]
  if (v !== undefined) out[k] = v
}
if (clash.length) {
  console.error(`both sides changed ${clash.join(', ')}`)
  process.exit(1)
}
fs.writeFileSync(process.argv[3], JSON.stringify(out))
