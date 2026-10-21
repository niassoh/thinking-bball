// Final review sheet for all portrait targets: McCain reference once at the top,
// then per player: source crop | master (or best rejected attempt) | 200 px WebP,
// labelled with name, attempt and verdict. Splits into pages of ROWS_PER_PAGE.
//   node scripts/portraits/v3-contact-sheet.js  -> assets/players/v3-contact-sheet[-N].png
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..', '..')
const MCCAIN = path.join(ROOT, 'basketball-player-portrait-reference-pack/references/style-primary-mccain.png')
const CELL = 300
const LABEL = 34
const GAP = 10
const ROWS_PER_PAGE = 10

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const text = (s, w, color = '#ece8e3', size = 18, h = LABEL) => Buffer.from(`<svg width="${w}" height="${h}"><text x="4" y="${h - 10}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600" fill="${color}">${esc(s)}</text></svg>`)

const row = async m => {
  const tiles = []
  const c = m.crop
  let src = sharp(path.join(ROOT, m.sourceFile))
  if (c) src = src.extract({ left: c.x, top: c.y, width: c.size, height: c.size })
  tiles.push({ input: await src.resize(CELL, CELL).toBuffer(), left: GAP, top: LABEL })
  let verdict, color, file, attempt
  if (m.approved && m.masterFile) {
    const a = m.attempts.find(x => x.attempt === m.generationAttempt)
    attempt = m.generationAttempt
    verdict = a && a.qa && a.qa.override ? 'APPROVED (user override)' : 'PASS'
    color = '#8fb0e6'
    file = m.masterFile
  } else {
    const best = m.attempts.find(x => x.attempt === m.bestRejectedAttempt) || m.attempts[m.attempts.length - 1]
    attempt = best ? best.attempt : 0
    verdict = best ? 'REJECTED' : 'NOT GENERATED'
    color = '#fa962a'
    file = best && best.file
  }
  if (file) tiles.push({ input: await sharp(path.join(ROOT, file)).resize(CELL, CELL).toBuffer(), left: 2 * GAP + CELL, top: LABEL })
  const webp = m.approved && (m.webp || []).find(f => f.endsWith('-200.webp'))
  if (webp) tiles.push({ input: await sharp(path.join(ROOT, webp)).png().toBuffer(), left: 3 * GAP + 2 * CELL + (CELL - 200) / 2, top: LABEL + (CELL - 200) / 2 })
  tiles.push({ input: text(`${m.player}  ·  attempt ${attempt}/3  ·  ${verdict}`, 3 * CELL + 4 * GAP, color), left: GAP, top: 0 })
  return { tiles, height: LABEL + CELL + GAP }
}

const main = async () => {
  const order = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/portrait-targets.json'), 'utf8')).targets.map(t => t.slug)
  const metas = order.map(s => JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/players/metadata', `${s}.json`), 'utf8')))
  const pages = []
  for (let i = 0; i < metas.length; i += ROWS_PER_PAGE) pages.push(metas.slice(i, i + ROWS_PER_PAGE))
  const width = 3 * CELL + 4 * GAP
  for (const [p, page] of pages.entries()) {
    const tiles = [
      { input: text('McCAIN REFERENCE (style anchor)   |   columns: source crop · master · 200 px WebP', width, '#e6c27a', 17), left: GAP, top: 0 },
      { input: await sharp(MCCAIN).resize(CELL, CELL).toBuffer(), left: GAP, top: LABEL }
    ]
    let top = LABEL + CELL + 2 * GAP
    for (const m of page) {
      const r = await row(m)
      tiles.push(...r.tiles.map(t => ({ ...t, top: t.top + top })))
      top += r.height
    }
    const name = pages.length > 1 ? `assets/players/v3-contact-sheet-${p + 1}.png` : 'assets/players/v3-contact-sheet.png'
    await sharp({ create: { width, height: top, channels: 3, background: '#1f1d1c' } }).composite(tiles).png().toFile(path.join(ROOT, name))
    console.log(`wrote ${name}`)
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
