// Jersey maps from Codex colour-key edits (codex-queue.js --jersey-key): Codex repaints
// a portrait's jersey in key colours (body magenta, collar and armhole binding cyan);
// this lifts that into a jersey map in the APPROVED portrait's pixels, which
// jersey-build.js paints any team's colours through (lib/jersey-paint.js). The site's
// face pixels stay the approved master's; Codex only says where the jersey is and how
// its planes are lit.
//
// A map is a 1024 RGB image: R = shade (128 = the jersey's typical plane, lighter
// above), G = body coverage, B = trim coverage. Extraction:
//   1. align the edit to the approved portrait (best whole-pixel shift, alpha
//      silhouettes over the top 55%);
//   2. classify key pixels by hue (body 280–325°, trim 165–200°);
//   3. keep the key regions that belong to the jersey (reaching the bottom of the
//      frame, or large and in its bottom quarter), close pinholes and fill small holes;
//   4. snap the jersey's edge to the approved portrait's own edge between jersey and
//      skin/beard, then feather it 1px (inside the portrait's alpha);
//   5. shade: the edit's lightness against its median plane (per body and trim), or,
//      when the edit came back flat, the approved portrait's own jersey lightness.
// Metrics (shift, silhouette mismatch, face change, key purity, coverage, strays,
// holes, old jersey colour left at the edge, shading levels) flag attempts to retry;
// --sheet lays out the latest attempts for QA, painted in three loud test palettes.
//
//   node scripts/portraits/jersey-key.js --import <queue folder>   (via codex-queue.js --import)
//   node scripts/portraits/jersey-key.js --extract <slug> [--attempt <n>]
//   node scripts/portraits/jersey-key.js --qa <slug> pass|fail [--failed logos,spill] [--note "..."]
//   node scripts/portraits/jersey-key.js --approve <slug>
//   node scripts/portraits/jersey-key.js --sheet <out.jpg> [--slugs a,b]
//   node scripts/portraits/jersey-key.js --status
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const { oklab } = require('../../lib/jersey-color')
const { paint } = require('../../lib/jersey-paint')

const ROOT = path.join(__dirname, '..', '..')
const PLAYERS = path.join(ROOT, 'assets', 'players')
const METADATA = path.join(PLAYERS, 'metadata')
const ATTEMPTS = path.join(PLAYERS, 'attempts', 'jersey-key')
const MAPS = path.join(PLAYERS, 'jersey', 'maps')

const W = 1024
const BODY_HUE = [280, 325]
const TRIM_HUE = [165, 200]
const MIN_SAT = 0.35
const MIN_VAL = 0.2
const MAX_SHIFT = 6
const FACE_ROWS = 0.6 * W

// Pass marks, calibrated on the pilot's 8 edits and the first batches (silhouette 0.4–1.6%
// from redrawn hair edges; edge ring up to 3.4% where dark skin meets a black jersey,
// bam-adebayo and andrew-wiggins); a miss names the retry fix to queue.
const LIMITS = [
  ['shift', m => Math.max(Math.abs(m.shift.dx), Math.abs(m.shift.dy)) <= 2, 'reframe'],
  ['silhouette', m => m.silhouette <= 0.015, 'reframe'],
  ['face', m => m.face <= 12, 'reframe'],
  ['purity', m => m.purity >= 0.95, 'not-key'],
  ['coverage', m => m.coverage >= 0.04 && m.coverage <= 0.35, 'missed'],
  ['strays', m => m.strays <= 300 && m.faceStrays === 0, 'spill'],
  ['holes', m => m.holes <= 0.0015, 'logos'],
  ['old-edge', m => m.oldEdge <= 0.04, 'missed'],
  ['shading', m => m.shadeSource === 'edit', 'flat']
]

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const readMeta = slug => JSON.parse(fs.readFileSync(path.join(METADATA, `${slug}.json`), 'utf8'))
const writeMeta = (slug, meta) => fs.writeFileSync(path.join(METADATA, `${slug}.json`), JSON.stringify(meta, null, 2) + '\n')

// The approved portrait at 1024: the master if it's here (gitignored), else the committed WebP.
const approvedFile = slug => {
  const master = path.join(PLAYERS, `${slug}.png`)
  return fs.existsSync(master) ? master : path.join(PLAYERS, 'webp', `${slug}-1024.webp`)
}
const rgba = file => sharp(file).resize(W, W, { fit: 'fill' }).ensureAlpha().raw().toBuffer()

const hsv = (r, g, b) => {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max / 255]
}

// Binary masks (Uint8Array 0/1, W×W): square max/min filters, done separably.
const filter = (m, r, take) => {
  const tmp = new Uint8Array(W * W)
  const out = new Uint8Array(W * W)
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let v = take === 'max' ? 0 : 1
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) v = take === 'max' ? v | m[y * W + k] : v & m[y * W + k]
      tmp[y * W + x] = v
    }
  }
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let v = take === 'max' ? 0 : 1
      for (let k = Math.max(0, y - r); k <= Math.min(W - 1, y + r); k++) v = take === 'max' ? v | tmp[k * W + x] : v & tmp[k * W + x]
      out[y * W + x] = v
    }
  }
  return out
}
const dilate = (m, r) => filter(m, r, 'max')
const erode = (m, r) => filter(m, r, 'min')

// Connected regions (8-neighbour) of a mask: a label per pixel and each region's size,
// bottom row and summed y.
const regions = m => {
  const label = new Int32Array(W * W).fill(-1)
  const info = []
  const stack = []
  for (let s = 0; s < W * W; s++) {
    if (!m[s] || label[s] >= 0) continue
    const id = info.length
    const r = { size: 0, maxY: 0, sumY: 0 }
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()
      const x = i % W
      const y = (i - x) / W
      r.size++
      r.sumY += y
      r.maxY = Math.max(r.maxY, y)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue
          const j = ny * W + nx
          if (m[j] && label[j] < 0) {
            label[j] = id
            stack.push(j)
          }
        }
      }
    }
    info.push(r)
  }
  return { label, info }
}

// The edit moved by (dx, dy): out(x, y) = edit(x - dx, y - dy), transparent where it runs off.
const shifted = (img, dx, dy) => {
  const out = Buffer.alloc(W * W * 4)
  for (let y = 0; y < W; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= W) continue
    for (let x = 0; x < W; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= W) continue
      img.copy(out, (y * W + x) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4)
    }
  }
  return out
}

const align = (approved, edit) => {
  const rows = Math.floor(W * 0.55)
  const solid = (img, i) => (img[i * 4 + 3] >= 128 ? 1 : 0)
  let best = { dx: 0, dy: 0, xor: Infinity }
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      let xor = 0
      for (let y = MAX_SHIFT; y < rows - MAX_SHIFT; y += 2) for (let x = MAX_SHIFT; x < W - MAX_SHIFT; x += 2) xor += solid(approved, y * W + x) ^ solid(edit, (y - dy) * W + (x - dx))
      if (xor < best.xor) best = { dx, dy, xor }
    }
  }
  return { dx: best.dx, dy: best.dy }
}

// Mean absolute RGB difference over the head (top 45%) at 400px, where both are solid:
// the scale scripts/portraits/jersey-check.js was calibrated on (untouched faces 2–5).
const faceChange = async (a, b) => {
  const small = img => sharp(img, { raw: { width: W, height: W, channels: 4 } }).resize(400, 400).raw().toBuffer()
  const [x, y] = await Promise.all([small(a), small(b)])
  let sum = 0
  let n = 0
  for (let i = 0; i < 400 * Math.floor(400 * 0.45); i++) {
    if (x[i * 4 + 3] < 200 || y[i * 4 + 3] < 200) continue
    sum += Math.abs(x[i * 4] - y[i * 4]) + Math.abs(x[i * 4 + 1] - y[i * 4 + 1]) + Math.abs(x[i * 4 + 2] - y[i * 4 + 2])
    n++
  }
  return n ? sum / (3 * n) : null
}

// Per-pixel OKLab of an RGBA image (where it's at least faintly opaque).
const labOf = img => {
  const lab = new Float32Array(W * W * 3)
  for (let i = 0; i < W * W; i++) {
    if (img[i * 4 + 3] < 16) continue
    const [L, a, b] = oklab([img[i * 4], img[i * 4 + 1], img[i * 4 + 2]])
    lab[i * 3] = L
    lab[i * 3 + 1] = a
    lab[i * 3 + 2] = b
  }
  return lab
}

// Box sums of `values` (k channels) over pixels where `mask` is set, via integral images:
// returns mean(i, r) = [count, ...channel means] in the (2r+1)² window around pixel i.
const windowMeans = (values, k, mask) => {
  const S = W + 1
  const sums = Array.from({ length: k + 1 }, () => new Float64Array(S * S))
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const on = mask[i] ? 1 : 0
      for (let c = 0; c <= k; c++) {
        const v = on ? (c === 0 ? 1 : values[i * k + c - 1]) : 0
        sums[c][(y + 1) * S + x + 1] = v + sums[c][y * S + x + 1] + sums[c][(y + 1) * S + x] - sums[c][y * S + x]
      }
    }
  }
  return (i, r) => {
    const x = i % W
    const y = (i - x) / W
    const x0 = Math.max(0, x - r)
    const y0 = Math.max(0, y - r)
    const x1 = Math.min(W, x + r + 1)
    const y1 = Math.min(W, y + r + 1)
    const box = s => s[y1 * S + x1] - s[y0 * S + x1] - s[y1 * S + x0] + s[y0 * S + x0]
    const n = box(sums[0])
    return [n, ...sums.slice(1).map(s => (n ? box(s) / n : 0))]
  }
}

const median = xs => {
  if (!xs.length) return 0
  const s = Float64Array.from(xs).sort()
  return s[Math.floor(s.length / 2)]
}
const quantile = (xs, q) => {
  if (!xs.length) return 0
  const s = Float64Array.from(xs).sort()
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

const extract = async (slug, editFile) => {
  const approved = await rgba(approvedFile(slug))
  const raw = await rgba(editFile)
  const shift = align(approved, raw)
  const edit = shifted(raw, shift.dx, shift.dy)

  // Silhouette mismatch over the top 55% after the shift, as a share of the portrait.
  let xor = 0
  let solid = 0
  for (let i = 0; i < W * Math.floor(W * 0.55); i++) {
    const a = approved[i * 4 + 3] >= 128
    xor += a !== edit[i * 4 + 3] >= 128 ? 1 : 0
    solid += a ? 1 : 0
  }
  const face = await faceChange(approved, edit)

  // 2. Key pixels.
  const cls = new Uint8Array(W * W)
  for (let i = 0; i < W * W; i++) {
    if (edit[i * 4 + 3] < 32) continue
    const [h, s, v] = hsv(edit[i * 4], edit[i * 4 + 1], edit[i * 4 + 2])
    if (s < MIN_SAT || v < MIN_VAL) continue
    if (h >= BODY_HUE[0] && h <= BODY_HUE[1]) cls[i] = 1
    else if (h >= TRIM_HUE[0] && h <= TRIM_HUE[1]) cls[i] = 2
  }

  // 3. The jersey's regions: those reaching the bottom rows, or large and in the bottom
  // quarter (a strap cut off by an arm). The rest are strays.
  const key = Uint8Array.from(cls, c => (c ? 1 : 0))
  const { label, info } = regions(key)
  const keep = info.map(r => r.maxY >= W - 8 || (r.size >= 2000 && r.sumY / r.size >= 0.75 * W))
  let strays = 0
  let faceStrays = 0
  const jersey = new Uint8Array(W * W)
  for (let i = 0; i < W * W; i++) {
    if (label[i] < 0) continue
    if (keep[label[i]]) jersey[i] = 1
    else {
      strays++
      if (i < FACE_ROWS * W && info[label[i]].size >= 50) faceStrays++
    }
  }
  // Close pinholes (2px), drop specks (1px), then fill enclosed holes under 400px.
  let U = erode(dilate(jersey, 2), 2)
  U = dilate(erode(U, 1), 1)
  const outside = new Uint8Array(W * W)
  const stack = []
  for (let x = 0; x < W; x++) for (const y of [0, W - 1]) if (!U[y * W + x]) stack.push(y * W + x)
  for (let y = 0; y < W; y++) for (const x of [0, W - 1]) if (!U[y * W + x]) stack.push(y * W + x)
  for (const i of stack) outside[i] = 1
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
      if (j < 0 || j >= W * W || U[j] || outside[j]) continue
      outside[j] = 1
      stack.push(j)
    }
  }
  const enclosed = Uint8Array.from(outside, (o, i) => (!o && !U[i] ? 1 : 0))
  const holeRegions = regions(enclosed)
  let holes = 0
  for (let i = 0; i < W * W; i++) {
    if (holeRegions.label[i] < 0) continue
    if (holeRegions.info[holeRegions.label[i]].size < 400) U[i] = 1
    else holes++
  }

  // 4. Edge snap: within 3px of the edge, a pixel goes with whichever side's local
  // colour (in the APPROVED portrait) it's closer to, where the two sides differ.
  const lab = labOf(approved)
  const deep = erode(U, 4)
  const away = Uint8Array.from(dilate(U, 4), (v, i) => (!v && approved[i * 4 + 3] >= 200 ? 1 : 0))
  const inside = windowMeans(lab, 3, deep)
  const out = windowMeans(lab, 3, away)
  const band = Uint8Array.from(dilate(U, 3), (v, i) => (v && !deep[i] ? 1 : 0))
  const snapped = Uint8Array.from(U)
  let moved = 0
  for (let i = 0; i < W * W; i++) {
    if (!band[i] || approved[i * 4 + 3] < 16) continue
    const [ni, ...mi] = inside(i, 7)
    const [no, ...mo] = out(i, 7)
    if (ni < 10 || no < 10) continue
    const gap = Math.hypot(mi[0] - mo[0], mi[1] - mo[1], mi[2] - mo[2])
    if (gap < 0.08) continue
    const p = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]
    const toIn = Math.hypot(p[0] - mi[0], p[1] - mi[1], p[2] - mi[2])
    const toOut = Math.hypot(p[0] - mo[0], p[1] - mo[1], p[2] - mo[2])
    const v = toIn < toOut ? 1 : 0
    if (v !== snapped[i]) moved++
    snapped[i] = v
  }

  // Body or trim for every jersey pixel (by the nearest key pixel), grown 1px to cover
  // the old jersey's edge, then feathered 1px and kept inside the portrait's alpha.
  const grown = dilate(snapped, 1)
  const kind = new Uint8Array(W * W)
  for (let i = 0; i < W * W; i++) if (grown[i] && cls[i] && jersey[i]) kind[i] = cls[i]
  for (let pass = 0; pass < 12; pass++) {
    let changed = 0
    for (let i = 0; i < W * W; i++) {
      if (!grown[i] || kind[i]) continue
      const x = i % W
      let b = 0
      let t = 0
      for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
        if (j < 0 || j >= W * W) continue
        if (kind[j] === 1) b++
        else if (kind[j] === 2) t++
      }
      if (b || t) {
        kind[i] = t > b ? 2 : 1
        changed++
      }
    }
    if (!changed) break
  }
  for (let i = 0; i < W * W; i++) if (grown[i] && !kind[i]) kind[i] = 1
  const soft = which => {
    const m = new Float32Array(W * W)
    for (let y = 1; y < W - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let s = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += kind[(y + dy) * W + x + dx] === which ? 1 : 0
        m[y * W + x] = s / 9
      }
    }
    return m
  }
  const bodyA = soft(1)
  const trimA = soft(2)

  // 5. Shade: lightness against the median plane, scaled by its spread (at least 0.08),
  // separately for body and trim; pixels with no key colour (the grown edge, filled
  // holes) take their neighbours'.
  const editLab = labOf(edit)
  const L = new Float32Array(W * W).fill(NaN)
  const lightness = { 1: [], 2: [] }
  for (let i = 0; i < W * W; i++) {
    if (!grown[i] || !cls[i] || !jersey[i]) continue
    L[i] = editLab[i * 3]
    lightness[cls[i]].push(L[i])
  }
  const bodyL = lightness[1]
  const levels = new Set(bodyL.map(v => Math.round(v / 0.04))).size
  let shadeSource = 'edit'
  // A flat edit (no planes to speak of) borrows the approved portrait's own jersey
  // lightness instead. Only then: that lightness carries the old jersey's logos and
  // lettering, so even a low-contrast edit is the better source.
  if (levels < 3) {
    shadeSource = 'portrait'
    lightness[1] = []
    lightness[2] = []
    for (let i = 0; i < W * W; i++) {
      L[i] = NaN
      if (!grown[i]) continue
      L[i] = lab[i * 3]
      lightness[kind[i]].push(L[i])
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < W * W; i++) {
      if (!grown[i] || !Number.isNaN(L[i])) continue
      const x = i % W
      let s = 0
      let n = 0
      for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
        if (j < 0 || j >= W * W || Number.isNaN(L[j]) || !grown[j]) continue
        s += L[j]
        n++
      }
      if (n) L[i] = s / n
    }
  }
  const norm = {}
  for (const c of [1, 2]) {
    const m = median(lightness[c])
    norm[c] = { m, scale: Math.max(0.08, quantile(lightness[c].map(v => Math.abs(v - m)), 0.95)) }
  }
  const map = Buffer.alloc(W * W * 3)
  for (let i = 0; i < W * W; i++) {
    const alpha = approved[i * 4 + 3] / 255
    const b = Math.round(255 * bodyA[i] * alpha)
    const t = Math.round(255 * trimA[i] * alpha)
    map[i * 3] = 128
    map[i * 3 + 1] = b
    map[i * 3 + 2] = t
    if ((b || t) && !Number.isNaN(L[i])) {
      const { m, scale } = norm[kind[i] || 1]
      map[i * 3] = Math.round(128 + 127 * Math.max(-1, Math.min(1, (L[i] - m) / scale)))
    }
  }

  // Old jersey colour left just outside the map: approved pixels 2–6px out whose coarse
  // colour is one of the old jersey's main colours.
  const bin = i => `${Math.round(lab[i * 3] / 0.05)},${Math.round(lab[i * 3 + 1] / 0.03)},${Math.round(lab[i * 3 + 2] / 0.03)}`
  const counts = new Map()
  for (let i = 0; i < W * W; i++) if (deep[i] && approved[i * 4 + 3] >= 200) counts.set(bin(i), (counts.get(bin(i)) || 0) + 1)
  const total = [...counts.values()].reduce((a, v) => a + v, 0)
  const main = new Set()
  let acc = 0
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (acc >= 0.8 * total) break
    main.add(k)
    acc += n
  }
  const wide = dilate(grown, 6)
  const near = dilate(grown, 1)
  let ring = 0
  let old = 0
  for (let i = 0; i < W * W; i++) {
    if (!wide[i] || near[i] || approved[i * 4 + 3] < 200) continue
    ring++
    if (main.has(bin(i))) old++
  }

  let covered = 0
  let keyed = 0
  for (let i = 0; i < W * W; i++) {
    if (!snapped[i]) continue
    covered++
    if (cls[i]) keyed++
  }
  const metrics = {
    shift,
    silhouette: solid ? +(xor / solid).toFixed(4) : null,
    face: face === null ? null : +face.toFixed(1),
    purity: covered ? +(keyed / covered).toFixed(3) : 0,
    coverage: +(covered / (W * W)).toFixed(3),
    strays,
    faceStrays,
    holes: +(holes / (W * W)).toFixed(4),
    edgeMoved: moved,
    oldEdge: ring ? +(old / ring).toFixed(3) : 0,
    shadeLevels: levels,
    shadeSource
  }
  metrics.failed = LIMITS.filter(([, ok]) => !ok(metrics)).map(([name]) => name)
  metrics.fixes = [...new Set(LIMITS.filter(([name]) => metrics.failed.includes(name)).map(([, , fix]) => fix))]
  return { map, metrics, approved, edit, cls, jersey }
}

const attemptFile = (slug, n) => path.join(ATTEMPTS, `${slug}-${n}.png`)
const mapFile = (slug, n) => path.join(ATTEMPTS, `${slug}-${n}-map.png`)

const runExtract = async (slug, n) => {
  const { map, metrics } = await extract(slug, attemptFile(slug, n))
  await sharp(map, { raw: { width: W, height: W, channels: 3 } }).png().toFile(mapFile(slug, n))
  const meta = readMeta(slug)
  const a = meta.jerseyKey.attempts.find(x => x.attempt === n)
  a.metrics = metrics
  a.map = path.relative(ROOT, mapFile(slug, n))
  writeMeta(slug, meta)
  const flag = metrics.failed.length ? `RETRY (${metrics.failed.join(', ')} -> --fix ${metrics.fixes.join(' --fix ')})` : 'ok'
  console.log(`${slug} attempt ${n}: ${flag}  shift ${metrics.shift.dx},${metrics.shift.dy} · silhouette ${metrics.silhouette} · face ${metrics.face} · purity ${metrics.purity} · coverage ${metrics.coverage} · strays ${metrics.strays}/${metrics.faceStrays} · holes ${metrics.holes} · old edge ${metrics.oldEdge} · shade ${metrics.shadeSource} (${metrics.shadeLevels} levels)`)
  return metrics
}

// A queue folder's out.png becomes the next jersey-key attempt (rejecting one with no
// real transparency), then is extracted.
const importFolder = async dir => {
  const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf8'))
  const { slug, attempt, fixes, base } = bundle
  const png = path.join(dir, 'out.png')
  const { hasAlpha } = await sharp(png).metadata()
  const stats = hasAlpha ? await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null
  if (stats) {
    let clear = 0
    for (let i = 3; i < stats.data.length; i += 4) if (stats.data[i] < 16) clear++
    if (clear / (stats.data.length / 4) < 0.15) throw new Error(`${slug}: out.png is under 15% transparent (painted background?)`)
  } else throw new Error(`${slug}: out.png has no alpha channel`)
  fs.mkdirSync(ATTEMPTS, { recursive: true })
  fs.copyFileSync(png, attemptFile(slug, attempt))
  const meta = readMeta(slug)
  meta.jerseyKey = meta.jerseyKey || { attempts: [] }
  meta.jerseyKey.attempts = meta.jerseyKey.attempts.filter(a => a.attempt !== attempt)
  meta.jerseyKey.attempts.push({ attempt, file: path.relative(ROOT, attemptFile(slug, attempt)), importedFrom: path.join(dir, 'out.png'), fixes, base, importedAt: new Date().toISOString() })
  meta.jerseyKey.attempts.sort((a, b) => a.attempt - b.attempt)
  writeMeta(slug, meta)
  await runExtract(slug, attempt)
}

const latest = meta => ((meta.jerseyKey || {}).attempts || []).slice(-1)[0]

const qa = (slug, verdict) => {
  if (!['pass', 'fail'].includes(verdict)) throw new Error('--qa <slug> pass|fail')
  const meta = readMeta(slug)
  const a = latest(meta)
  if (!a) throw new Error(`${slug}: no jersey-key attempt`)
  a.qa = { verdict, failed: (arg('--failed') || '').split(',').filter(Boolean), note: arg('--note') || null, at: new Date().toISOString() }
  writeMeta(slug, meta)
  console.log(`${slug} attempt ${a.attempt}: ${verdict}`)
}

const approve = async slug => {
  const meta = readMeta(slug)
  const a = latest(meta)
  if (!a || !a.qa || a.qa.verdict !== 'pass') throw new Error(`${slug}: the latest attempt hasn't passed QA`)
  fs.mkdirSync(MAPS, { recursive: true })
  const dest = path.join(MAPS, `${slug}.webp`)
  await sharp(mapFile(slug, a.attempt)).webp({ lossless: true }).toFile(dest)
  Object.assign(meta.jerseyKey, { approvedAttempt: a.attempt, map: path.relative(ROOT, dest), base: a.base, shift: a.metrics.shift, shadeSource: a.metrics.shadeSource, approvedAt: new Date().toISOString() })
  writeMeta(slug, meta)
  console.log(`${slug}: map ${path.relative(ROOT, dest)} (attempt ${a.attempt})`)
}

// QA sheet: per player (latest attempt) the approved portrait, the key edit, the mask
// over the portrait (body magenta, trim cyan, strays red), the shade channel, three loud
// test palettes and the metrics.
const TEST_ERAS = [
  { id: 'lime/red', body: '#7CFC00', trim: [{ color: '#FF2D2D' }] },
  { id: 'white/black', body: '#FFFFFF', trim: [{ color: '#111111', to: 0.5 }, { color: '#FFD100' }] },
  { id: 'black/yellow', body: '#111111', trim: [{ color: '#FFD100' }] }
]
const sheet = async file => {
  const only = arg('--slugs') ? arg('--slugs').split(',') : null
  const slugs = fs.readdirSync(METADATA).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(s => (!only || only.includes(s)) && latest(readMeta(s)))
  const T = 300
  const cols = 7
  const textW = 320
  const H = T + 8
  const tiles = []
  const flatten = (buf, w = W) => sharp(buf, { raw: { width: w, height: w, channels: 4 } }).resize(T, T).flatten({ background: '#3a3634' }).png().toBuffer()
  for (const [row, slug] of slugs.entries()) {
    const a = latest(readMeta(slug))
    const { map, metrics, approved, edit, cls, jersey } = await extract(slug, path.join(ROOT, a.file))
    const overlay = Buffer.from(approved)
    const shade = Buffer.alloc(W * W * 4)
    for (let i = 0; i < W * W; i++) {
      const tint = cls[i] && !jersey[i] ? [255, 40, 40] : map[i * 3 + 2] > 128 ? [0, 255, 255] : map[i * 3 + 1] > 128 ? [255, 0, 255] : null
      if (tint) for (let k = 0; k < 3; k++) overlay[i * 4 + k] = Math.round(0.4 * overlay[i * 4 + k] + 0.6 * tint[k])
      const on = map[i * 3 + 1] + map[i * 3 + 2]
      shade[i * 4] = shade[i * 4 + 1] = shade[i * 4 + 2] = on ? map[i * 3] : 30
      shade[i * 4 + 3] = 255
    }
    const painted = TEST_ERAS.map(era => paint(approved, map, W, W, era).rgba)
    const panels = [approved, edit, overlay, shade, ...painted]
    const top = row * H
    for (const [c, buf] of panels.entries()) tiles.push({ input: await flatten(buf), left: c * T, top })
    const lines = [
      `${slug} · attempt ${a.attempt}${a.qa ? ` · QA ${a.qa.verdict}` : ''}`,
      metrics.failed.length ? `RETRY: ${metrics.failed.join(', ')}` : 'metrics ok',
      `shift ${metrics.shift.dx},${metrics.shift.dy} · silhouette ${metrics.silhouette}`,
      `face change ${metrics.face} · purity ${metrics.purity}`,
      `coverage ${metrics.coverage} · holes ${metrics.holes}`,
      `strays ${metrics.strays} (face ${metrics.faceStrays}) · old edge ${metrics.oldEdge}`,
      `shade ${metrics.shadeSource} · ${metrics.shadeLevels} levels`
    ]
    const svg = `<svg width="${textW}" height="${T}"><rect width="100%" height="100%" fill="#111"/>${lines.map((l, i) => `<text x="10" y="${28 + i * 30}" font-family="Helvetica" font-size="${i ? 15 : 17}" fill="${i === 1 && metrics.failed.length ? '#fa962a' : '#fff'}">${l.replace(/&/g, '&amp;')}</text>`).join('')}</svg>`
    tiles.push({ input: Buffer.from(svg), left: cols * T, top })
  }
  if (!slugs.length) return console.log('no jersey-key attempts')
  const header = ['approved', 'key edit', 'mask (strays red)', 'shade', ...TEST_ERAS.map(e => e.id)]
  const headSvg = `<svg width="${cols * T + textW}" height="28"><rect width="100%" height="100%" fill="#000"/>${header.map((h, i) => `<text x="${i * T + 8}" y="19" font-family="Helvetica" font-size="14" fill="#aaa">${h}</text>`).join('')}</svg>`
  await sharp({ create: { width: cols * T + textW, height: slugs.length * H + 28, channels: 3, background: '#000' } })
    .composite([{ input: Buffer.from(headSvg), left: 0, top: 0 }, ...tiles.map(t => ({ ...t, top: t.top + 28 }))])
    .jpeg({ quality: 82 })
    .toFile(file)
  console.log(`sheet: ${file} (${slugs.length} players)`)
}

const status = () => {
  for (const f of fs.readdirSync(METADATA).filter(x => x.endsWith('.json')).sort()) {
    const k = readMeta(f.slice(0, -5)).jerseyKey
    if (!k) continue
    const a = k.attempts.slice(-1)[0]
    console.log(`${f.slice(0, -5).padEnd(26)} attempts ${k.attempts.length} · latest ${a.qa ? a.qa.verdict : a.metrics ? (a.metrics.failed.length ? 'retry' : 'awaiting QA') : 'not extracted'}${k.approvedAttempt ? ` · approved ${k.approvedAttempt}` : ''}`)
  }
}

const main = async () => {
  if (arg('--import')) return importFolder(arg('--import'))
  if (arg('--extract')) {
    const slug = arg('--extract')
    const n = Number(arg('--attempt')) || latest(readMeta(slug)).attempt
    return runExtract(slug, n)
  }
  if (arg('--qa')) return qa(arg('--qa'), args[args.indexOf('--qa') + 2])
  if (arg('--approve')) return approve(arg('--approve'))
  if (arg('--sheet')) return sheet(arg('--sheet'))
  if (args.includes('--status')) return status()
  throw new Error('usage: --import <dir> | --extract <slug> | --qa <slug> pass|fail | --approve <slug> | --sheet <file> | --status')
}

main().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
