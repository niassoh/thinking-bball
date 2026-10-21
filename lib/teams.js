// abbreviation (as used in the stats sheets) -> ESPN team id and nickname
const TEAMS = {
  ATL: { espnId: 1, name: 'Hawks' },
  BKN: { espnId: 17, name: 'Nets' },
  BOS: { espnId: 2, name: 'Celtics' },
  CHA: { espnId: 30, name: 'Hornets' },
  CHI: { espnId: 4, name: 'Bulls' },
  CLE: { espnId: 5, name: 'Cavaliers' },
  DAL: { espnId: 6, name: 'Mavericks' },
  DEN: { espnId: 7, name: 'Nuggets' },
  DET: { espnId: 8, name: 'Pistons' },
  GSW: { espnId: 9, name: 'Warriors' },
  HOU: { espnId: 10, name: 'Rockets' },
  IND: { espnId: 11, name: 'Pacers' },
  LAC: { espnId: 12, name: 'Clippers' },
  LAL: { espnId: 13, name: 'Lakers' },
  MEM: { espnId: 29, name: 'Grizzlies' },
  MIA: { espnId: 14, name: 'Heat' },
  MIL: { espnId: 15, name: 'Bucks' },
  MIN: { espnId: 16, name: 'Timberwolves' },
  NOP: { espnId: 3, name: 'Pelicans' },
  NYK: { espnId: 18, name: 'Knicks' },
  OKC: { espnId: 25, name: 'Thunder' },
  ORL: { espnId: 19, name: 'Magic' },
  PHI: { espnId: 20, name: '76ers' },
  PHX: { espnId: 21, name: 'Suns' },
  POR: { espnId: 22, name: 'Trail Blazers' },
  SAC: { espnId: 23, name: 'Kings' },
  SAS: { espnId: 24, name: 'Spurs' },
  TOR: { espnId: 28, name: 'Raptors' },
  UTA: { espnId: 26, name: 'Jazz' },
  WAS: { espnId: 27, name: 'Wizards' }
}

const ESPN_ABBR = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' }
const fromEspnAbbr = abbr => (abbr ? ESPN_ABBR[abbr] || abbr : null)

// Basketball-Reference codes (site_Data index_master) that differ from the sheets'.
const BREF_ABBR = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX', WSB: 'WAS' }
const fromBrefAbbr = abbr => BREF_ABBR[abbr] || abbr

module.exports = { TEAMS, fromEspnAbbr, fromBrefAbbr }
