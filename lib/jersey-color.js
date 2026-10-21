// Colour for the portraits' jersey layer (scripts/portraits/jersey-key.js reads shading
// out of a key edit; scripts/portraits/jersey-build.js paints team colours back in).
// Works in OKLab so a lighter or darker plane of a team colour keeps its hue.
//
// A jersey map's shade channel says how much lighter or darker each pixel is than the
// jersey's typical plane: 128 = typical, 255 = as light as it gets, 1 = as dark. A team
// colour is painted through it with an asymmetric lightness range, since white can only
// get darker and black only lighter; chroma follows lightness and is pulled back into
// the sRGB gamut.

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

// [r, g, b] 0–255 -> [L, a, b]
const oklab = ([r, g, b]) => {
  const [lr, lg, lb] = [r, g, b].map(v => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

// [L, a, b] -> linear [r, g, b] (may be out of gamut)
const linearRgb = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}
const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)

// [L, a, b] -> [r, g, b] 0–255, keeping L and hue and reducing chroma until it fits.
const srgb = ([L, a, b]) => {
  let lo = 0
  let hi = 1
  if (!inGamut(linearRgb([L, a, b]))) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(linearRgb([L, a * mid, b * mid]))) lo = mid
      else hi = mid
    }
  } else lo = 1
  return linearRgb([L, a * lo, b * lo]).map(v => Math.round(255 * toGamma(Math.min(1, Math.max(0, v)))))
}

const hex = h => {
  const n = parseInt(h.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// How far a colour's planes may move in OKLab lightness: up toward white and down toward
// black, by default from where the colour sits (a palette entry can set either).
const range = (L0, shade = {}) => {
  let up = clamp(0.97 - L0, 0.04, 0.1)
  if (L0 < 0.3) up = Math.max(up, 0.1)
  let down = clamp(L0 - 0.08, 0.06, 0.16)
  if (L0 > 0.85) down = Math.max(down, 0.14)
  return { up: shade.up ?? up, down: shade.down ?? down }
}

// A 256-entry table: shade byte -> [r, g, b] for one colour. `scale` narrows the range
// (the trim's planes move less than the body's).
const shadeTable = (color, { shade, scale = 1 } = {}) => {
  const [L0, a0, b0] = oklab(hex(color))
  const { up, down } = range(L0, shade)
  const table = []
  for (let v = 0; v < 256; v++) {
    const s = clamp((v - 128) / 127, -1, 1)
    const L = clamp(L0 + scale * (s > 0 ? s * up : s * down), 0, 1)
    // Chroma follows lightness a little, so shadows don't glow and highlights don't grey out.
    const k = L0 > 0 ? Math.sqrt(clamp(L / L0, 0.25, 2)) : 1
    table.push(srgb([L, a0 * k, b0 * k]))
  }
  return table
}

module.exports = { oklab, srgb, hex, range, shadeTable }
