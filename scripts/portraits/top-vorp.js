// Adds the next portrait targets to data/portrait-targets.json, ranked by value over
// replacement, (BPM + 2) x MP (VORP up to a constant), skipping players already
// targeted.
//
//   --seasons 1 (default): 2025-26 only (the first VORP batch).
//   --seasons 3: 2023-24 / 2024-25 / 2025-26 weighted 1 / 2 / 3, the value the profile
//     index orders by (lib/profile.js playerIndex), so players who missed 2025-26 hurt
//     (Kyrie, Lillard) still rank; only players seen in 2024-25 or 2025-26 count.
//
// Usage: node scripts/portraits/top-vorp.js [--count 150] [--seasons 1|3] [--batch <name>]
const fs = require('fs')
const path = require('path')
const { slugify, loadSheet, num } = require('../../lib/players')

const OUT_FILE = path.join(__dirname, '..', '..', 'data', 'portrait-targets.json')
const BIO_FILE = path.join(__dirname, '..', '..', 'data', 'bio.json')
const opt = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const COUNT = Number(opt('--count', 150))
const SEASONS = opt('--seasons', '1') === '3' ? [['dailycat-24', 1], ['dailycat-25', 2], ['dailycat-26', 3]] : [['dailycat-26', 1]]
const BATCH = opt('--batch', SEASONS.length === 3 ? 'vorp3' : 'vorp-2025-26')

const doc = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'))
const bio = fs.existsSync(BIO_FILE) ? JSON.parse(fs.readFileSync(BIO_FILE, 'utf8')) : {}
const have = new Set(doc.targets.map(t => t.slug))

// One entry per player: a name change (Jimmy Butler -> Jimmy Butler III) is folded by
// NBA id onto the latest spelling's slug, as the profiles do.
const byId = new Map()
const players = new Map()
for (const [key, weight] of SEASONS) {
  for (const r of loadSheet(key).rows) {
    let slug = slugify(r.Player)
    const id = bio[slug] && bio[slug].nbaId
    if (id && byId.has(id)) slug = byId.get(id)
    else if (id) byId.set(id, slug)
    const p = players.get(slug) || { slug, value: 0, recent: false }
    const bpm = num(r.BPM)
    const mp = num(r.MP)
    if (bpm !== null && mp !== null) p.value += weight * (bpm + 2) * mp
    if (key !== 'dailycat-24') p.recent = true
    Object.assign(p, { name: r.Player, team: r.Tm, bpm, mp })
    players.set(slug, p)
  }
}
// Re-key folded players to their latest slug (the one portraits use).
for (const [slug, p] of players) {
  const latest = slugify(p.name)
  if (latest !== slug && !players.has(latest)) { players.delete(slug); players.set(latest, { ...p, slug: latest }) }
}

const added = [...players.values()]
  .filter(p => p.recent && !have.has(p.slug))
  .sort((a, b) => b.value - a.value)
  .slice(0, COUNT)
  .map((p, k) => ({ rank: doc.targets.length + k + 1, slug: p.slug, name: p.name, team: p.team, bpm: p.bpm, mp: p.mp, value: Math.round(p.value), batch: BATCH }))

doc.targets.push(...added)
doc.batches = [...(doc.batches || []), { batch: BATCH, addedAt: new Date().toISOString(), method: `next ${added.length} by (BPM + 2) x MP${SEASONS.length === 3 ? ', 2023-24..2025-26 weighted 1/2/3' : ', 2025-26'}` }]
fs.writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2) + '\n')
console.log(`added ${added.length} targets (ranks ${added[0].rank}-${added[added.length - 1].rank}): ${added.slice(0, 5).map(p => p.name).join(', ')} ... ${added[added.length - 1].name}`)
