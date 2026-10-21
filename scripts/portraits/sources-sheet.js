// Review grid of the chosen source photos (cropped as they'll be sent to the
// model), labelled with name, energy vs McCain, jersey/season and license.
//   node scripts/portraits/sources-sheet.js [--out assets/players/sources-contact-sheet.png] [--batch <name>]
// --batch limits it to one target batch's players (its `slugs`), those with a source; a pick
// recorded as needing review gets a REVIEW badge (FLAG: a concern the pick was kept with).
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const METADATA = path.join(ROOT, 'assets', 'players', 'metadata')
const TARGETS = path.join(ROOT, 'data', 'portrait-targets.json')
const CELL = 300
const LABEL = 78
const COLS = 5
const GAP = 8

const outIdx = process.argv.indexOf('--out')
const out = outIdx === -1 ? 'assets/players/sources-contact-sheet.png' : process.argv[outIdx + 1]
const batchIdx = process.argv.indexOf('--batch')
const batch = batchIdx === -1 ? null : process.argv[batchIdx + 1]

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const label = m => {
  const lines = [
    [`${m.player}`, 17, '#ece8e3', 700],
    [`Energy ${m.energy ?? '?'}/10 (McCain 7)  ·  score ${m.sourceSelectionScore}/16`, 12, m.energy >= 6 && m.energy <= 8 ? '#8fb0e6' : '#fa962a', 400],
    [fit(m.jersey || '', 44), 12, '#d6d1cb', 400],
    [fit(`License: ${m.license}`, 46), 11, m.license.startsWith('unknown') ? '#e6c27a' : '#a8a29c', 400]
  ]
  const text = lines.map(([t, size, color, weight], i) => `<text x="6" y="${18 + i * 18}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`).join('')
  return Buffer.from(`<svg width="${CELL}" height="${LABEL}"><rect width="${CELL}" height="${LABEL}" fill="#2c2a28"/>${text}</svg>`)
}

const main = async () => {
  const targets = JSON.parse(fs.readFileSync(TARGETS, 'utf8'))
  const order = batch ? (targets.batches.find(b => b.batch === batch) || { slugs: [] }).slugs : targets.targets.map(t => t.slug)
  const metas = order.map(s => path.join(METADATA, `${s}.json`)).filter(f => !batch || fs.existsSync(f))
    .map(f => JSON.parse(fs.readFileSync(f, 'utf8'))).filter(m => !batch || m.sourceFile)
  const rows = Math.ceil(metas.length / COLS)
  const tiles = []
  for (const [i, m] of metas.entries()) {
    const left = GAP + (i % COLS) * (CELL + GAP)
    const top = GAP + Math.floor(i / COLS) * (CELL + LABEL + GAP)
    let img = sharp(path.join(ROOT, m.sourceFile))
    if (m.crop) img = img.extract({ left: m.crop.x, top: m.crop.y, width: m.crop.size, height: m.crop.size })
    tiles.push({ input: await img.resize(CELL, CELL, { fit: 'cover' }).toBuffer(), left, top })
    tiles.push({ input: label(m), left, top: top + CELL })
    if (m.needsReview) {
      tiles.push({ input: Buffer.from(`<svg width="72" height="22"><rect width="72" height="22" fill="#e05a4f"/><text x="6" y="16" font-family="Helvetica, Arial" font-size="13" font-weight="700" fill="#1f1d1c">REVIEW</text></svg>`), left: left + 4, top: top + 4 })
    }
    if (m.concerns && /FLAG/.test(m.concerns)) {
      tiles.push({ input: Buffer.from(`<svg width="54" height="22"><rect width="54" height="22" fill="#fa962a"/><text x="6" y="16" font-family="Helvetica, Arial" font-size="13" font-weight="700" fill="#1f1d1c">FLAG</text></svg>`), left: left + CELL - 58, top: top + 4 })
    }
  }
  await sharp({ create: { width: GAP + COLS * (CELL + GAP), height: GAP + rows * (CELL + LABEL + GAP), channels: 3, background: '#1f1d1c' } })
    .composite(tiles)
    .png()
    .toFile(path.join(ROOT, out))
  console.log(`wrote ${out}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
