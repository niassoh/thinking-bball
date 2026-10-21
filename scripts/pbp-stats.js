// data/history/pbp-stats.json: the stats sheet's columns that play-by-play gives (Net On,
// on-court and team ratings, scoring, free throws, turnovers, shot zones), for the seasons
// the sheet has only its historical tab for (lib/profile.js pbpStatsOf; the profiles and
// the Leaderboard read them where the tab has no column). Needs each season's Footprint
// and Lonestar files and its shot zones (analysis/footprint/shot_zones.py). No calls.
//   node scripts/pbp-stats.js 1996-97 1997-98 1998-99 1999-00
const { pbpStatsOf } = require('../lib/profile')
const { writeArtifact } = require('../lib/artifacts')

const SEASONS = process.argv.slice(2)
if (!SEASONS.length || SEASONS.some(s => !/^\d{4}-\d{2}$/.test(s))) throw new Error('give seasons like 1996-97')

const seasons = {}
for (const season of SEASONS) {
  seasons[season] = pbpStatsOf(season)
  console.log(`${season}: ${Object.keys(seasons[season].players).length} players`)
}
writeArtifact('history', 'pbp-stats', { generatedAt: new Date().toISOString(), seasons })
