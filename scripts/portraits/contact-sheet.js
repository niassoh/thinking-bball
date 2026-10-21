// Side-by-side review sheet: source crop | approved master (or latest attempt) |
// 200 px WebP, one row per player.
//   node scripts/portraits/contact-sheet.js --out assets/players/trial-contact-sheet.png nikola-jokic shai-gilgeous-alexander
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const CELL = 512
const GAP = 12
const LABEL = 40

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const out = outIdx === -1 ? 'assets/players/contact-sheet.png' : args[outIdx + 1]
const slugs = args.filter((a, i) => a !== '--out' && i !== outIdx + 1)

const text = (s, w) => Buffer.from(`<svg width="${w}" height="${LABEL}"><text x="8" y="27" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#ece8e3">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`)

const main = async () => {
  const width = 3 * CELL + 4 * GAP
  const rowH = LABEL + CELL + GAP
  const tiles = []
  for (const [r, slug] of slugs.entries()) {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/players/metadata', `${slug}.json`), 'utf8'))
    const c = meta.crop
    const top = GAP + r * rowH
    const latest = meta.attempts[meta.attempts.length - 1]
    const genFile = meta.masterFile || (latest && latest.file)
    const status = meta.approved ? `approved, attempt ${meta.generationAttempt}/3` : `NOT approved (latest attempt ${latest ? latest.attempt : 0})`
    tiles.push({ input: text(`${meta.player}: ${status}; source ${meta.license}, score ${meta.sourceSelectionScore}/16`, width), left: 0, top })
    let src = sharp(path.join(ROOT, meta.sourceFile))
    if (c) src = src.extract({ left: c.x, top: c.y, width: c.size, height: c.size })
    tiles.push({ input: await src.resize(CELL, CELL, { fit: 'cover' }).toBuffer(), left: GAP, top: top + LABEL })
    if (genFile) tiles.push({ input: await sharp(path.join(ROOT, genFile)).resize(CELL, CELL).toBuffer(), left: 2 * GAP + CELL, top: top + LABEL })
    const webp = meta.webp && meta.webp.find(f => f.endsWith('-200.webp'))
    if (webp) {
      // Shown at actual size to check readability at ~200 px.
      tiles.push({ input: await sharp(path.join(ROOT, webp)).png().toBuffer(), left: 3 * GAP + 2 * CELL + (CELL - 200) / 2, top: top + LABEL + (CELL - 200) / 2 })
    }
  }
  const header = text('SOURCE CROP  |  GENERATED MASTER (1024 px, shown at 512)  |  200 px WebP (actual size)', width)
  await sharp({ create: { width, height: LABEL + slugs.length * rowH + GAP, channels: 3, background: '#1f1d1c' } })
    .composite([{ input: header, left: 0, top: 0 }, ...tiles.map(t => ({ ...t, top: t.top + LABEL }))])
    .png()
    .toFile(path.join(ROOT, out))
  console.log(`wrote ${out}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
