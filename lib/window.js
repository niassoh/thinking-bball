// The "recent" window shared by the shot-shift and core-stat-shift pulls:
// the last WINDOW_DAYS days of the season (ending on its latest game date)
// versus everything before it. One window for every player keeps the sheet
// pull to two recalculations.
const WINDOW_DAYS = 30

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// games: Map of pbpstats games for the season (each has a Date).
const recentWindow = games => {
  const dates = [...games.values()].map(g => g.Date).sort()
  const end = dates[dates.length - 1]
  const start = addDays(end, -(WINDOW_DAYS - 1))
  return { days: WINDOW_DAYS, seasonStart: dates[0], restEnd: addDays(start, -1), start, end }
}

module.exports = { WINDOW_DAYS, recentWindow, addDays }
