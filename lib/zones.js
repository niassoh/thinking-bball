// Buckets a shot by distance from the basket into the four bands the profile's
// shot map draws: rim (within 6 ft), short midrange (6-14 ft), long midrange
// (beyond 14 ft, inside the 3pt line) and threes. pbpstats coordinates are
// tenths of a foot from the basket, y growing toward half court.
//
// Each band edge is shaped like the 3pt line: an arc in front of the basket and
// straight sides from basket level to the baseline, so behind the basket only
// the sideways distance counts. Must match thinking-bball-profile src/lib/court.js.

const ZONES = ['rim', 'short_mid', 'long_mid', 'three']
const RIM_FT = 6
const SHORT_MID_FT = 14

const classify = (x, y, shotValue) => {
  if (shotValue === 3) return 'three'
  const ft = (y < 0 ? Math.abs(x) : Math.hypot(x, y)) / 10
  if (ft <= RIM_FT) return 'rim'
  return ft <= SHORT_MID_FT ? 'short_mid' : 'long_mid'
}

module.exports = { ZONES, classify, RIM_FT, SHORT_MID_FT }
