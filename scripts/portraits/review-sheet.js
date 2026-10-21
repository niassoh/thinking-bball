// Batch QA sheet: McCain reference on top, then one row per player:
// source crop | attempt (full) | face zoom at full resolution | 170 px.
//   node scripts/portraits/review-sheet.js --out /tmp/review-1.jpg <slug>[:attempt] ...
// Without :attempt, the latest attempt is shown.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const MCCAIN = path.join(ROOT, 'basketball-player-portrait-reference-pack/references/style-primary-mccain.png')
const W = 360

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const out = args[outIdx + 1]
const items = args.filter((a, i) => i !== outIdx && i !== outIdx + 1)

const text = (s, w, h = 26) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/><text x="6" y="19" font-family="Helvetica, Arial" font-size="16" fill="#ff0">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`)

const main = async () => {
  const tiles = [{ input: await sharp(MCCAIN).resize(W, W).toBuffer(), left: 0, top: 0 }, { input: text('McCain reference (style target)', W), left: 0, top: 0 }]
  for (const [r, item] of items.entries()) {
    const [slug, n] = item.split(':')
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/players/metadata', `${slug}.json`), 'utf8'))
    const a = n ? m.attempts.find(x => x.attempt === Number(n)) : m.attempts[m.attempts.length - 1]
    const top = (r + 1) * W
    const c = m.crop
    let src = sharp(path.join(ROOT, m.sourceFile))
    if (c) src = src.extract({ left: c.x, top: c.y, width: c.size, height: c.size })
    tiles.push({ input: await src.resize(W, W).toBuffer(), left: 0, top })
    tiles.push({ input: await sharp(path.join(ROOT, a.file)).resize(W, W).toBuffer(), left: W, top })
    tiles.push({ input: await sharp(path.join(ROOT, a.file)).extract({ left: 312, top: 160, width: 400, height: 400 }).resize(W, W).toBuffer(), left: 2 * W, top })
    tiles.push({ input: await sharp(path.join(ROOT, a.file)).resize(170, 170).toBuffer(), left: 3 * W + 10, top })
    tiles.push({ input: text(`${slug}  attempt ${a.attempt}`, W), left: 0, top })
  }
  await sharp({ create: { width: 3 * W + 190, height: (items.length + 1) * W, channels: 3, background: '#111' } })
    .composite(tiles).jpeg({ quality: 85 }).toFile(out)
  console.log(out)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
