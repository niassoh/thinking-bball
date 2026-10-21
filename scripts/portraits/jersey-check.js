// Face guard for jersey edits (codex-queue.js --rejersey): a jersey edit must leave the
// face alone. For every queue folder with an out.png, compares it to portrait.png over
// the head (the top HEAD share of the frame, where both are opaque) and reports the mean
// absolute RGB difference, worst first, flagging those over LIMIT. Writes a review sheet
// of before/after pairs with the score, to check by eye before importing.
//   node scripts/portraits/jersey-check.js <queue dir> [--sheet <file.jpg>]
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const SIZE = 400
const HEAD = 0.45
// Calibrated on the first 38 Codex edits: untouched faces score 2–5; a reframed (zoomed)
// portrait scored 17.
const LIMIT = 8

const rgba = async file => sharp(file).resize(SIZE, SIZE).ensureAlpha().raw().toBuffer()

const headDiff = (a, b) => {
  let sum = 0
  let n = 0
  for (let y = 0; y < Math.floor(SIZE * HEAD); y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      if (a[i + 3] < 200 || b[i + 3] < 200) continue
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      n++
    }
  }
  return n ? sum / (3 * n) : null
}

const main = async () => {
  const dir = process.argv[2]
  const at = process.argv.indexOf('--sheet')
  const sheet = at === -1 ? path.join(dir, 'jersey-check.jpg') : process.argv[at + 1]
  const rows = []
  for (const slug of fs.readdirSync(dir).sort()) {
    const out = path.join(dir, slug, 'out.png')
    const before = path.join(dir, slug, 'portrait.png')
    if (!fs.existsSync(out) || !fs.existsSync(before)) continue
    const { to } = JSON.parse(fs.readFileSync(path.join(dir, slug, 'bundle.json'), 'utf8'))
    const { hasAlpha } = await sharp(out).metadata()
    rows.push({ slug, to, diff: headDiff(await rgba(before), await rgba(out)), alpha: hasAlpha, before, out })
  }
  rows.sort((a, b) => (b.diff ?? 999) - (a.diff ?? 999))
  for (const r of rows) console.log(`${r.diff === null ? '  n/a' : r.diff.toFixed(1).padStart(5)}  ${r.diff === null || r.diff > LIMIT ? 'CHECK' : 'ok   '}  ${r.alpha ? '     ' : 'NO-ALPHA'}  ${r.slug} -> ${r.to}`)
  if (!rows.length) return console.log('no out.png yet')

  // Sheet: before | after per player, labelled, two pairs per row.
  const T = 200
  const pairW = T * 2
  const per = 2
  const H = T + 24
  const tiles = []
  for (const [i, r] of rows.entries()) {
    const left = (i % per) * (pairW + 12)
    const top = Math.floor(i / per) * H
    for (const [j, file] of [r.before, r.out].entries()) {
      tiles.push({ input: await sharp(file).resize(T, T).flatten({ background: '#3a3634' }).png().toBuffer(), left: left + j * T, top })
    }
    const flag = r.diff === null || r.diff > LIMIT ? ' CHECK' : ''
    tiles.push({ input: Buffer.from(`<svg width="${pairW}" height="24"><rect width="100%" height="100%" fill="#111"/><text x="6" y="17" font-family="Helvetica" font-size="14" fill="${flag ? '#fa962a' : '#fff'}">${r.slug} -> ${r.to} · face diff ${r.diff === null ? 'n/a' : r.diff.toFixed(1)}${flag}</text></svg>`), left, top: top + T })
  }
  await sharp({ create: { width: per * (pairW + 12), height: Math.ceil(rows.length / per) * H, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 80 }).toFile(sheet)
  console.log(`sheet: ${sheet}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
