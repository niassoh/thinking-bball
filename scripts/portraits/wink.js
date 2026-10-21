// A portrait's wink, shown for a moment when the bio card is hovered (the profile site's
// BioCard). Painted here on the approved portrait itself, since the image tools refuse to
// change a real person's expression (Codex: moderation_blocked, public-figure): his lid
// comes down over the eye as flat lid-coloured planes with a lash line on its edge, and
// smooth warps lower the brow and lift the cheek around it. The overlay keeps only the
// pixels that changed, so it lines up with the site's headshot (jersey/base shares the
// approved head), and stops above the jersey band (jersey/manifest.json `top`), where
// his other jerseys' sprite is drawn.
//
//   node scripts/portraits/wink.js --slug lebron-james [--sheet <out.png>]
//
// Writes assets/players/wink/<slug>.webp: a sprite of the FRAMES side by side, each the
// changed face over a 400px square, transparent elsewhere. The site serves its copy from
// thinking-bball-profile's public/wink/<slug>.webp (beside the logos, which the static
// export leaves alone); copy it there, and add his landmarks there too (Wink.jsx WINKS).
// --sheet lays out the headshot and each frame over it.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const PLAYERS = path.join(__dirname, '..', '..', 'assets', 'players')
const W = 1024
// Fade out this far (a share of the frame) above the jersey band.
const JERSEY_FADE = 0.04
// How far the lid is down in each sprite frame: half closed, then closed.
const FRAMES = [0.5, 1]

// Landmarks on the approved 1024 portrait, in px. eye: the winking eye's corners and the
// top of its opening. warps: { at, d: displacement, s: spread (Gaussian sigma) } squinting
// the face around it.
const FACES = {
  'lebron-james': {
    eye: { inner: [538, 290], outer: [617, 276], top: [588, 261] },
    warps: [
      { at: [600, 365], d: [0, -6], s: 45 },
      { at: [585, 232], d: [0, 6], s: 28 },
      { at: [580, 305], d: [0, -5], s: 22 }
    ]
  }
}

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}

// The approved portrait at 1024: the master if it's here (gitignored), else the committed WebP.
const approvedFile = slug => {
  const master = path.join(PLAYERS, `${slug}.png`)
  return fs.existsSync(master) ? master : path.join(PLAYERS, 'webp', `${slug}-1024.webp`)
}
const raw = { raw: { width: W, height: W, channels: 4 } }

// Mean colour of the 9x9 square at p, as #rrggbb, scaled by k (k < 1 darkens).
const sample = (img, p, k = 1) => {
  const [px, py] = p.map(Math.round)
  const sum = [0, 0, 0]
  for (let y = py - 4; y <= py + 4; y++) for (let x = px - 4; x <= px + 4; x++) for (let c = 0; c < 3; c++) sum[c] += img[(y * W + x) * 4 + c]
  return '#' + sum.map(v => Math.min(255, Math.round((v / 81) * k)).toString(16).padStart(2, '0')).join('')
}
// The quadratic Bézier control point for a curve from a to b through m at its middle.
const through = (a, b, m) => [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2]
const pt = p => p.map(v => v.toFixed(1)).join(' ')

// The lid down over the eye (t: 0 open, 1 closed), as flat planes like the portrait's
// own facets.
const paint = (img, { eye }, t) => {
  const { inner, outer, top } = eye
  const mid = [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2]
  const lash = [mid[0] + 2, mid[1] + 12]
  // Up past the opening's top, so its dark rim is covered and only the lash line reads.
  const lid = through(inner, outer, [top[0], top[1] - 6])
  const sag = through(inner, outer, lash)
  // The lid's edge, t of the way from the opening's top down to the closed lash line.
  const edge = [lid[0] + (sag[0] - lid[0]) * t, lid[1] + (sag[1] - lid[1]) * t]
  const edgeMid = [(inner[0] + 2 * edge[0] + outer[0]) / 4, (inner[1] + 2 * edge[1] + outer[1]) / 4]
  const lidShape = `M ${pt(inner)} Q ${pt(lid)} ${pt(outer)} Q ${pt(edge)} ${pt(inner)} Z`
  // The lid in the skin just below the eye, darkened into the eye socket's shadow.
  const below = [lash[0], lash[1] + 18]
  const lidTone = sample(img, below, 0.72)
  const lidLight = sample(img, below, 0.8)
  const flick = [outer[0] + 12, outer[1] - 8]
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}">
  <defs><clipPath id="lid"><path d="${lidShape}"/></clipPath></defs>
  <path d="${lidShape}" fill="${lidTone}" stroke="${lidTone}" stroke-width="3"/>
  <polygon clip-path="url(#lid)" points="${pt(inner)} ${pt(top)} ${pt(edgeMid)}" fill="${lidLight}"/>
  <path d="M ${pt(inner)} Q ${pt(edge)} ${pt(outer)}" fill="none" stroke="#1b120e" stroke-width="8" stroke-linecap="round"/>
  <path d="M ${pt(outer)} Q ${pt([flick[0] - 2, outer[1] - 1])} ${pt(flick)}" fill="none" stroke="#1b120e" stroke-width="5" stroke-linecap="round"/>
</svg>`)
}

// out(p) = img(p - D(p)), D the sum of the Gaussian warps, sampled bilinearly.
const warp = (img, warps) => {
  const out = Buffer.alloc(W * W * 4)
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let dx = 0
      let dy = 0
      for (const { at, d, s } of warps) {
        const g = Math.exp(-((x - at[0]) ** 2 + (y - at[1]) ** 2) / (2 * s * s))
        dx += d[0] * g
        dy += d[1] * g
      }
      const sx = Math.min(W - 1.001, Math.max(0, x - dx))
      const sy = Math.min(W - 1.001, Math.max(0, y - dy))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const o = (y * W + x) * 4
      for (let c = 0; c < 4; c++) {
        const p = i => img[i * 4 + c]
        const i = y0 * W + x0
        out[o + c] = Math.round(p(i) * (1 - fx) * (1 - fy) + p(i + 1) * fx * (1 - fy) + p(i + W) * (1 - fx) * fy + p(i + W + 1) * fx * fy)
      }
    }
  }
  return out
}

// Alpha for the overlay: where the edit changed the portrait, softened, and above the
// jersey band.
const changed = async (base, edit, jerseyTop) => {
  const hit = Buffer.alloc(W * W)
  for (let i = 0; i < W * W; i++) {
    const d = Math.abs(base[i * 4] - edit[i * 4]) + Math.abs(base[i * 4 + 1] - edit[i * 4 + 1]) + Math.abs(base[i * 4 + 2] - edit[i * 4 + 2])
    if (d > 6) hit[i] = 255
  }
  const soft = await sharp(hit, { raw: { width: W, height: W, channels: 1 } }).blur(6).linear(3, 0).toColourspace('b-w').raw().toBuffer()
  const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
  return soft.map((a, i) => Math.round(a * smooth((jerseyTop - Math.floor(i / W) / W) / JERSEY_FADE)))
}

const sheet = async (slug, file, frames) => {
  const base = fs.existsSync(path.join(PLAYERS, 'jersey', 'base', `${slug}-400.webp`)) ? path.join(PLAYERS, 'jersey', 'base', `${slug}-400.webp`) : path.join(PLAYERS, 'webp', `${slug}-400.webp`)
  const shots = [await sharp(base).png().toBuffer(), ...(await Promise.all(frames.map(f => sharp(base).composite([{ input: f }]).png().toBuffer())))]
  await sharp({ create: { width: 410 * shots.length, height: 400, channels: 4, background: '#2c2a28' } })
    .composite(shots.map((input, i) => ({ input, left: 410 * i, top: 0 })))
    .png()
    .toFile(file)
}

const main = async () => {
  const slug = arg('--slug')
  const face = FACES[slug]
  if (!face) throw new Error(`usage: --slug <slug> [--sheet <out.png>]; slugs with landmarks: ${Object.keys(FACES).join(', ')}`)
  const manifest = JSON.parse(fs.readFileSync(path.join(PLAYERS, 'jersey', 'manifest.json'), 'utf8')).players[slug]
  const jerseyTop = manifest ? manifest.top : 1
  const base = await sharp(approvedFile(slug)).resize(W, W).ensureAlpha().raw().toBuffer()
  const frames = []
  for (const t of FRAMES) {
    const painted = await sharp(base, raw).composite([{ input: paint(base, face, t) }]).raw().toBuffer()
    const edit = warp(painted, face.warps.map(w => ({ ...w, d: w.d.map(v => v * t) })))
    const alpha = await changed(base, edit, jerseyTop)
    for (let i = 0; i < W * W; i++) edit[i * 4 + 3] = Math.round((edit[i * 4 + 3] * alpha[i]) / 255)
    frames.push(await sharp(edit, raw).resize(400, 400).png().toBuffer())
  }
  const out = path.join(PLAYERS, 'wink', `${slug}.webp`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await sharp({ create: { width: 400 * frames.length, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: 400 * i, top: 0 })))
    .webp({ quality: 85, alphaQuality: 90 })
    .toFile(out)
  console.log(`${slug}: ${frames.length} frames, jersey top ${jerseyTop} → ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes)`)
  if (arg('--sheet')) await sheet(slug, arg('--sheet'), frames)
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
