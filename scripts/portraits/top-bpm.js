// Picks the portrait POC targets: top 20 players by 3-year weighted BPM.
// Seasons 2023-24, 2024-25, 2025-26 are weighted 1/2/3 (newest heaviest) times
// minutes played; only seasons with 1,000+ MP count, and a player needs at
// least two qualifying seasons. Writes data/portrait-targets.json.
const fs = require('fs')
const path = require('path')
const { slugify, loadSheet, seasonFromKey, num } = require('../../lib/players')

const SEASONS = [['dailycat-24', 1], ['dailycat-25', 2], ['dailycat-26', 3]]
const MIN_MP = 1000
const MIN_SEASONS = 2
const TOP_N = 20
const OUT_FILE = path.join(__dirname, '..', '..', 'data', 'portrait-targets.json')

const players = new Map()
for (const [key, weight] of SEASONS) {
  for (const row of loadSheet(key).rows) {
    const bpm = num(row.BPM)
    const mp = num(row.MP)
    if (!row.Player || bpm === null || mp === null || mp < MIN_MP) continue
    const slug = slugify(row.Player)
    if (!players.has(slug)) players.set(slug, { slug, seasons: [] })
    // Seasons run oldest to newest, so the newest spelling and team win.
    Object.assign(players.get(slug), { name: row.Player, team: row.Tm })
    players.get(slug).seasons.push({ season: seasonFromKey(key), bpm, mp, weight })
  }
}

const ranked = [...players.values()]
  .filter(p => p.seasons.length >= MIN_SEASONS)
  .map(p => {
    const w = p.seasons.reduce((a, s) => a + s.weight * s.mp, 0)
    const bpm = p.seasons.reduce((a, s) => a + s.bpm * s.weight * s.mp, 0) / w
    return { ...p, weightedBpm: Math.round(bpm * 100) / 100 }
  })
  .sort((a, b) => b.weightedBpm - a.weightedBpm)
  .slice(0, TOP_N)

fs.writeFileSync(OUT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: { seasons: SEASONS.map(([k, w]) => ({ season: seasonFromKey(k), weight: w })), weightTimesMP: true, minMP: MIN_MP, minSeasons: MIN_SEASONS },
  targets: ranked.map((p, i) => ({ rank: i + 1, slug: p.slug, name: p.name, team: p.team, weightedBpm: p.weightedBpm, seasons: p.seasons.map(({ season, bpm, mp }) => ({ season, bpm, mp })) }))
}, null, 2) + '\n')

console.log(ranked.map((p, i) => `${i + 1}. ${p.name} (${p.team}) ${p.weightedBpm}`).join('\n'))
