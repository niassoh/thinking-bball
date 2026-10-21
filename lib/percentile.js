// Tie-aware percentile rank, matching the sheet pull scripts: a value's
// percentile is the share of the pool strictly worse than it, so tied values
// share the lowest rank.
const percentileOf = (value, pool, lowerBetter = false) => {
  const nums = pool.filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (!nums.length || value === null || value === undefined) return null
  const worse = nums.filter(v => (lowerBetter ? v > value : v < value)).length
  return Math.round((worse / nums.length) * 100)
}

module.exports = { percentileOf }
