// Adds the next round of portrait targets to data/portrait-targets.json: today's depth
// charts first, then historical players, all without an illustrated portrait and not
// already in the portrait pipeline (a recorded source or an attempt awaiting approval).
//   current: players on the depth charts (data/depth, the coming season), by their best
//     depth slot (a starter at any position first), then the index's 3-season value
//     ((BPM + 2) x MP, weighted 1/2/3); players with no NBA season yet (rookies) come
//     after the others in their slot. team = his depth chart's.
//   historical: players out of the latest season and off the depth charts, by career value
//     (the same (BPM + 2) x MP summed over every regular season), so long-serving starters
//     and role players rank with the stars; team = his best season's (800+ MP, lib/profile.js
//     playerIndex bestSeason), the jersey wanted in the source (the season the library
//     shows him in).
// Players targeted in an earlier round but never sourced keep their entry; the batch
// lists every slug it picks (`slugs`), so codex-queue.js --batch queues them all.
//
// Usage: node scripts/portraits/top-mix.js [--current 75] [--historical 25] [--batch <name>]
const fs = require('fs')
const path = require('path')
const { playerIndex, leaderboard, leaderboardSeasons } = require('../../lib/profile')

const ROOT = path.join(__dirname, '..', '..')
const TARGETS = path.join(ROOT, 'data', 'portrait-targets.json')
const DEPTH = path.join(ROOT, 'data', 'depth')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const args = process.argv.slice(2)
const arg = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d)
const CURRENT = Number(arg('--current', 75))
const HISTORICAL = Number(arg('--historical', 25))
const BATCH = arg('--batch', 'depth-and-career')

const art = p => p.headshot === 'portrait' || p.headshot === 'jersey'
const inPipeline = slug => {
  const file = path.join(METADATA, `${slug}.json`)
  if (!fs.existsSync(file)) return false
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  return !m.approved && !!(m.sourceUrl || (m.attempts || []).length)
}
const depth = new Map()
for (const f of fs.readdirSync(DEPTH).filter(f => /^[A-Z]{3}\.json$/.test(f))) {
  const d = JSON.parse(fs.readFileSync(path.join(DEPTH, f), 'utf8'))
  for (const r of d.rows || []) (r.players || []).forEach((pl, slot) => {
    const had = depth.get(pl.slug)
    if (pl.slug && (!had || slot < had.slot)) depth.set(pl.slug, { slot, team: f.slice(0, 3), name: pl.name })
  })
}
const index = playerIndex()
const order = new Map(index.map((p, i) => [p.slug, i]))
const bySlug = new Map(index.map(p => [p.slug, p]))

const current = [...depth].filter(([slug]) => !(bySlug.has(slug) && art(bySlug.get(slug))) && !inPipeline(slug))
  .sort(([a, x], [b, y]) => x.slot - y.slot || (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
  .slice(0, CURRENT)
  .map(([slug, d]) => ({ slug, name: d.name, team: d.team, depthSlot: d.slot + 1, kind: 'current' }))

const career = new Map()
for (const season of leaderboardSeasons()) {
  const board = leaderboard(season)
  const at = Object.keys(board.stats).indexOf('BPM')
  for (const p of board.players) if (p.v[at] !== null && p.mp) career.set(p.slug, (career.get(p.slug) || 0) + (p.v[at] + 2) * p.mp)
}
const historical = index.filter(p => !p.active && !depth.has(p.slug) && !art(p) && p.bestSeason && !inPipeline(p.slug))
  .sort((a, b) => (career.get(b.slug) || 0) - (career.get(a.slug) || 0)).slice(0, HISTORICAL)
  .map(p => ({ slug: p.slug, name: p.name, team: p.bestSeason.team, bestSeason: p.bestSeason.season, careerValue: Math.round(career.get(p.slug) || 0), kind: 'historical' }))

const doc = JSON.parse(fs.readFileSync(TARGETS, 'utf8'))
if ((doc.batches || []).some(b => b.batch === BATCH)) throw new Error(`Batch ${BATCH} is already in ${TARGETS}`)
const have = new Set(doc.targets.map(t => t.slug))
const picks = [...current, ...historical]
const added = picks.filter(p => !have.has(p.slug))
let rank = Math.max(...doc.targets.map(t => t.rank))
for (const p of added) doc.targets.push({ rank: ++rank, ...p, batch: BATCH })
doc.batches = [...(doc.batches || []), {
  batch: BATCH,
  addedAt: new Date().toISOString(),
  method: `${current.length} on the depth charts by best depth slot, then (BPM + 2) x MP 2023-24..2025-26 weighted 1/2/3 (rookies last in their slot), and ${historical.length} historical by career (BPM + 2) x MP (team = best season's), none with an illustrated portrait or already in the pipeline`,
  slugs: picks.map(p => p.slug)
}]
fs.writeFileSync(TARGETS, JSON.stringify(doc, null, 2) + '\n')
const slots = [1, 2, 3, 4].map(k => `slot ${k} ${current.filter(p => p.depthSlot === k).length}`).join(', ')
console.log(`${BATCH}: ${picks.length} picked (${current.length} current: ${slots}; ${historical.length} historical); ${added.length} new targets, ${picks.length - added.length} already targeted`)
