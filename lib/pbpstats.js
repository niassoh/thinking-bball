// Thin client for api.pbpstats.com (the same source the stats sheet imports).
// Calls are spaced out because it is a free community API.
const { fetchJson, sleep } = require('./http')

const BASE = 'https://api.pbpstats.com'
const PAUSE_MS = 1000
// Games pbpstats has wrong and hasn't fixed, which the nightly's checks stop failing on
// (each is still logged). Remove one once pbpstats corrects it.
const KNOWN_BAD = {
  '0022600101': 'MEM@GSW 2026-10-23: pbpstats has 109-108, the final was 111-108'
}

const call = async (endpoint, params) => {
  const qs = new URLSearchParams(params).toString()
  const data = await fetchJson(`${BASE}/${endpoint}/nba?${qs}`)
  await sleep(PAUSE_MS)
  return data
}

const seasonString = startYear => `${startYear}-${String(startYear + 1).slice(-2)}`

// Season types, as pbpstats names them (playoffs exclude the play-in).
const SEASON_TYPES = { regular: 'Regular Season', playoffs: 'Playoffs' }

const gamesCache = new Map()
const games = async (season, type = 'regular') => {
  const key = `${type}:${season}`
  if (!gamesCache.has(key)) {
    const { results } = await call('get-games', { Season: season, SeasonType: SEASON_TYPES[type] })
    gamesCache.set(key, new Map((results || []).map(g => [g.GameId, g])))
  }
  return gamesCache.get(key)
}

// Preseason/offseason fall back to the last season that has games.
const latestSeasonWithGames = async (today = new Date()) => {
  const start = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1
  for (const year of [start, start - 1]) {
    if ((await games(seasonString(year))).size) return seasonString(year)
  }
  throw new Error('No pbpstats games found for the current or previous season')
}

const teamIds = async (season, type = 'regular') => {
  const ids = {}
  for (const g of (await games(season, type)).values()) {
    ids[g.HomeTeamAbbreviation] = g.HomeTeamId
    ids[g.AwayTeamAbbreviation] = g.AwayTeamId
  }
  return ids
}

const gameLogs = async (nbaId, season, type = 'regular') => {
  const data = await call('get-game-logs', { Season: season, SeasonType: SEASON_TYPES[type], EntityType: 'Player', EntityId: nbaId })
  return (data.multi_row_table_data || []).sort((a, b) => a.Date.localeCompare(b.Date))
}

// The five-man lineups a team used between two dates (YYYY-MM-DD; none for the whole
// season), with their minutes and plus-minus. pbpstats returns at most LINEUP_CAP rows
// (the most-played), so a full result means some were cut.
const LINEUP_CAP = 500
// entity 'LineupOpponent': the opponents' totals while each of those lineups was on.
const lineups = async (teamId, season, from, to, type = 'regular', entity = 'Lineup') => {
  if (!['Lineup', 'LineupOpponent'].includes(entity)) throw new Error(`lineups: unknown entity ${entity}`)
  const dates = from ? { FromDate: from, ToDate: to } : {}
  const data = await call('get-totals', { Season: season, SeasonType: SEASON_TYPES[type], Type: entity, TeamId: teamId, ...dates })
  return data.multi_row_table_data || []
}

// A WOWY query's full totals (entityType 'Team' or 'Opponent'), for checking lineup sums.
const wowyTotals = async (teamId, season, filters, type = 'regular', entityType = 'Team') =>
  (await call('get-wowy-stats', { Season: season, SeasonType: SEASON_TYPES[type], TeamId: teamId, Type: entityType, ...filters })).single_row_table_data || {}

// Every player pbpstats knows, as { nbaId: name }.
const players = async () => (await call('get-all-players-for-league', {})).players || {}

// Each player's season totals. pbpstats returns the LINEUP_CAP rows with the most
// minutes, so players with only a few minutes may be cut.
const playerTotals = async (season, type = 'regular') =>
  (await call('get-totals', { Season: season, SeasonType: SEASON_TYPES[type], Type: 'Player' })).multi_row_table_data || []

// Each player's own totals with a team (get-totals), or in that team's minutes matching
// WOWY `filters` (get-wowy-stats Type=Player), e.g. { '0Exactly0OnFloor': 'id1,id2' } for
// the minutes with both off. One row per player who played in them.
const playersWith = async (teamId, season, filters = {}, type = 'regular') => {
  const endpoint = Object.keys(filters).length ? 'get-wowy-stats' : 'get-totals'
  return (await call(endpoint, { Season: season, SeasonType: SEASON_TYPES[type], TeamId: teamId, Type: 'Player', ...filters })).multi_row_table_data || []
}

// Each team's season totals.
const teamTotals = async (season, type = 'regular') =>
  (await call('get-totals', { Season: season, SeasonType: SEASON_TYPES[type], Type: 'Team' })).multi_row_table_data || []

module.exports = { games, latestSeasonWithGames, teamIds, gameLogs, wowyTotals, lineups, players, playerTotals, playersWith, teamTotals, LINEUP_CAP, KNOWN_BAD }
