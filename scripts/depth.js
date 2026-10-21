// Depth charts + injury flags for all 30 teams -> data/depth/<TEAM>.json, plus
// data/depth/_index.json (player slug -> current team) so profiles can follow
// offseason moves. Source: ESPN team depth charts, current rosters (for names)
// and the league injury report. Injured players not found on a depth chart are
// listed in data/depth/_review.json rather than dropped.
const fs = require('fs')
const path = require('path')
const { fetchJson, sleep } = require('../lib/http')
const { slugify } = require('../lib/players')
const { TEAMS, fromEspnAbbr } = require('../lib/teams')
const { writeArtifact } = require('../lib/artifacts')

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba'
const DEPTH_DIR = path.join(__dirname, '..', 'data', 'depth')
const POSITIONS = ['pg', 'sg', 'sf', 'pf', 'c']
const MAX_PER_POSITION = 4
// Out -> OUT; every lesser designation (Day-To-Day, Questionable, ...) -> DTD.
const injuryStatus = status => (status === 'Out' ? 'OUT' : 'DTD')

const athleteId = ref => ref.match(/athletes\/(\d+)/)[1]

const main = async () => {
  const report = await fetchJson(`${ESPN_SITE}/injuries`)
  const injuries = new Map()
  for (const team of report.injuries || []) {
    for (const i of team.injuries) injuries.set(slugify(i.athlete.displayName), { status: injuryStatus(i.status), team: team.displayName })
  }

  const index = {}
  const placed = new Set()
  for (const [abbr, { espnId }] of Object.entries(TEAMS)) {
    const roster = await fetchJson(`${ESPN_SITE}/teams/${espnId}/roster`)
    await sleep(150)
    const names = Object.fromEntries((roster.athletes || []).map(a => [a.id, a.displayName]))
    const season = roster.season.year
    const charts = await fetchJson(`${ESPN_CORE}/seasons/${season}/teams/${espnId}/depthcharts`)
    await sleep(150)
    const positions = (charts.items && charts.items[0] && charts.items[0].positions) || {}

    const rows = POSITIONS.map(pos => {
      const ranked = ((positions[pos] && positions[pos].athletes) || []).sort((a, b) => a.rank - b.rank)
      // Depth charts can reference players no longer on the roster; skip them.
      const onRoster = ranked.filter(a => names[athleteId(a.athlete.$ref)])
      const players = onRoster.slice(0, MAX_PER_POSITION).map(a => {
        const id = athleteId(a.athlete.$ref)
        const name = names[id]
        const slug = slugify(name)
        index[slug] = abbr
        placed.add(slug)
        const inj = injuries.get(slug)
        return { name, slug, espnId: id, status: inj ? inj.status : null }
      })
      return { pos: pos.toUpperCase(), players }
    })
    for (const a of roster.athletes || []) index[slugify(a.displayName)] = index[slugify(a.displayName)] || abbr
    writeArtifact('depth', abbr, { team: abbr, season: roster.season.displayName, generatedAt: new Date().toISOString(), rows })
  }

  fs.writeFileSync(path.join(DEPTH_DIR, '_index.json'), JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 1) + '\n')
  const review = [...injuries.entries()].filter(([slug]) => !placed.has(slug)).map(([slug, i]) => ({ slug, ...i, reason: 'injured but not on a depth chart' }))
  fs.writeFileSync(path.join(DEPTH_DIR, '_review.json'), JSON.stringify(review, null, 2) + '\n')
  console.log(`depth: 30 teams, ${Object.keys(index).length} rostered players, ${injuries.size} injuries (${review.length} not on a depth chart)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
