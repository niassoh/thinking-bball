// Paints a team's jersey into a portrait through the player's jersey map
// (scripts/portraits/jersey-key.js): R = shade (128 = the jersey's typical plane),
// G = body coverage, B = trim coverage, all in the portrait's pixels.
const { shadeTable } = require('./jersey-color')

// Chamfer (3-4) distance from every pixel to the nearest one where `target(i)` holds.
const distanceTo = (w, h, target) => {
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = target(i) ? 0 : 1e9
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  }
  return d
}

// Where each trim pixel sits across its binding: 0 at the skin edge, 1 where it meets
// the jersey body, so a palette's stripes run in order across the band.
const trimPosition = (map, w, h) => {
  const body = i => map[i * 3 + 1] >= 128
  const trim = i => map[i * 3 + 2] >= 128
  const toSkin = distanceTo(w, h, i => !body(i) && !trim(i))
  const toBody = distanceTo(w, h, body)
  const t = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (!map[i * 3 + 2]) continue
    const a = toSkin[i]
    const b = toBody[i]
    t[i] = a + b > 0 ? a / (a + b) : 0.5
  }
  return t
}

// The portrait (RGBA) with `era`'s jersey painted in, and how much of each pixel is
// jersey (0–255). Pixels the map doesn't cover keep the portrait's exactly.
const paint = (base, map, w, h, era, t = trimPosition(map, w, h)) => {
  const body = shadeTable(era.body, { shade: era.shade })
  const stripes = era.trim.map(s => ({ to: s.to ?? 1, table: shadeTable(s.color, { shade: era.shade, scale: 0.6 }) }))
  const rgba = Buffer.from(base)
  const cover = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const ba = map[i * 3 + 1] / 255
    const ta = map[i * 3 + 2] / 255
    if (!ba && !ta) continue
    const shade = map[i * 3]
    const bc = body[shade]
    const tc = (stripes.find(s => t[i] <= s.to) || stripes[stripes.length - 1]).table[shade]
    const sum = ba + ta
    const a = Math.min(1, sum)
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(((bc[k] * ba + tc[k] * ta) / sum) * a + base[i * 4 + k] * (1 - a))
    cover[i] = Math.round(255 * a)
  }
  return { rgba, cover }
}

module.exports = { paint, trimPosition, distanceTo }
