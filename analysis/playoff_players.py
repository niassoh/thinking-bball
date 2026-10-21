"""The playoff players' totals pbpstats only partly has for 1996-97 to 1999-00 (it lacks some
of their games: the 1996-97 Lakers 4 of 9, the Jazz 15 of 20, the 1999-00 Blazers 13 of 16;
docs/data-pull-audit.md #146, #154), from the Kaggle NBA dataset (the user's, at
~/Desktop/NBAQueryBy/archive (1): every game's box score, PlayerStatisticsExtended.csv, and
play-by-play, PlayByPlay.parquet), in the shape of the playoff sheet's 'PS PBP' tab
(pbpstats get-totals Type=Player). scripts/backfill-seasons.js writes them over that tab for
those seasons, as it writes analysis/playoff_games.py's games over 'Game Import'; the tab's
own columns (IT:KM, which 'All PS' reads) find each field by its name.

From the box scores: games, points, shots, free throws, rebounds, assists, steals, blocks,
turnovers and fouls (the play-by-play has no steals or blocks for these seasons). From the
playoff possession cache (analysis/footprint/build.py --playoffs, run on the same
play-by-play: PBP_KAGGLE=<kaggle dir>): minutes, and the possessions, plus-minus and ratings
with him on the floor, counted as pbpstats counts them (wowy.py); the box scores' own are
per-game rounded minutes and estimated possessions, 2 points off the ratings. From the
play-by-play: shots by zone (the rim a two within 4 ft, as analysis/footprint/shot_zones.py;
corner threes off the line's straight part, as possessions.py), assists on rim shots,
turnovers by kind and rebounds of a player's own misses. Fouls drawn, charges and offensive
fouls drawn aren't recorded for these seasons (the box scores' fouls drawn are mostly empty;
pbpstats leaves all three out).

Usage: PBP_KAGGLE=<kaggle dir> python3 analysis/footprint/build.py --playoffs <seasons...>
       python3 analysis/playoff_players.py [--dir <kaggle dir>] [--out <file>] [seasons...]
       (default 1996-97..1999-00; another season, e.g. 2000-01, checks the rows against pbpstats)
"""
import json
import math
import os
import re
import sys
from collections import defaultdict

import pandas as pd
import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'footprint'))
from wowy import FIELDS as FLOOR_FIELDS, load, rows as floor_rows  # noqa: E402

DIR = os.path.expanduser('~/Desktop/NBAQueryBy/archive (1)')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'history', 'playoff-players.json')
SEASONS = ['1996-97', '1997-98', '1998-99', '1999-00']
RIM_FT = 4
SHORT_MID_FT = 14
ASSIST = re.compile(r'\(([^()]+?) \d+ AST\)')
# pbpstats splits bad passes and lost balls into live ones (stolen) and dead ones (out of
# bounds); this play-by-play has no steals to tell them apart, so each player's are split by
# the season's live share in pbpstats' own rows for it (the games it has): steady at 0.73-0.78
# and 0.77-0.83, and with it 2000-01's bad passes match pbpstats' to 1 at the median.
LIVE_SHARE = {'1996-97': (0.750, 0.816), '1997-98': (0.778, 0.820), '1998-99': (0.748, 0.797),
              '1999-00': (0.733, 0.773), '2000-01': (0.743, 0.825)}
# pbpstats' field names, in the order its rows carry them.
FIELDS = ['EntityId', 'TeamId', 'Name', 'TeamAbbreviation', 'SecondsPlayed', 'GamesPlayed', 'Minutes', 'PlusMinus',
          'OffPoss', 'DefPoss', 'TotalPoss', 'AtRimFGM', 'AtRimFGA', 'ShortMidRangeFGM', 'ShortMidRangeFGA',
          'LongMidRangeFGM', 'LongMidRangeFGA', 'Corner3FGM', 'Corner3FGA', 'Arc3FGM', 'Arc3FGA', 'FG2M', 'FG2A',
          'FG3M', 'FG3A', 'FtPoints', 'Points', 'Assists', 'AtRimAssists', 'DefRebounds', 'OffRebounds', 'Rebounds',
          'SelfOReb', 'Steals', 'BadPassTurnovers', 'BadPassOutOfBoundsTurnovers', 'LostBallTurnovers',
          'LostBallOutOfBoundsTurnovers', 'Turnovers',
          'Fouls', 'FTA', 'Blocks', 'OnOffRtg', 'OnDefRtg', 'Fg3Pct', 'Fg2Pct', 'TsPct', 'AtRimAccuracy']
# pbpstats' Type=Team fields the playoff sheet reads ('PBP Team' A2's import), in its order.
TEAM_FIELDS = ['EntityId', 'TeamId', 'Name', 'ShortName', 'RowId', 'TeamAbbreviation', 'GamesPlayed', 'Points',
               'OpponentPoints', 'OffPoss', 'DefPoss']


def code(season):
    """'1996-97' -> the game id's season digits, '96'."""
    return season[2:4]


def feet(x, y, listed):
    """Distance from the basket; behind it only the sideways distance counts. Older games log
    many shots at (0, 0), where the listed distance stands in."""
    if x == 0 and y == 0:
        return float(listed or 0)
    return (abs(x) if y < 0 else math.hypot(x, y)) / 10


def box_scores(d, seasons):
    cols = ['personId', 'firstName', 'lastName', 'gameId', 'gameType', 'playerteamId', 'numMinutes', 'points', 'assists',
            'reboundsOffensive', 'reboundsDefensive', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade',
            'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'steals', 'blocks', 'turnovers',
            'foulsPersonal', 'foulsAgainst', 'plusMinusPoints', 'possessions', 'offensiveRating', 'defensiveRating']
    b = pd.read_csv(os.path.join(d, 'PlayerStatisticsExtended.csv'), usecols=cols, dtype={'gameId': str}, low_memory=False)
    b = b[(b['gameType'] == 'Playoffs') & b['gameId'].str[:3].isin(['4' + code(s) for s in seasons])].copy()
    b['numMinutes'] = pd.to_numeric(b['numMinutes'], errors='coerce').fillna(0)
    return b[b['numMinutes'] > 0]


def plays(d, season):
    lo = '4' + code(season) + '00000'
    hi = '4' + code(season) + '99999'
    cols = ['gameId', 'actionNumber', 'teamTricode', 'teamId', 'personId', 'actionType', 'subType', 'shotResult',
            'xLegacy', 'yLegacy', 'shotDistance', 'description']
    t = pq.read_table(os.path.join(d, 'PlayByPlay.parquet'), columns=cols,
                      filters=[('gameId', '>=', lo), ('gameId', '<=', hi)]).to_pandas()
    return t.sort_values(['gameId', 'actionNumber'])


def shot_and_play_totals(t, last_names):
    """Per player: zone shots, rim assists, turnovers by kind and own-miss rebounds; and each
    team id's code that season. `last_names` maps (game, team id) to {surname: personId}."""
    out = defaultdict(lambda: defaultdict(int))
    codes = defaultdict(lambda: defaultdict(int))
    unresolved = 0
    for gid, g in t.groupby('gameId', sort=False):
        last_miss = None
        for r in g.itertuples(index=False):
            pid, typ = str(r.personId), r.actionType
            if r.teamTricode and str(r.teamId) != '0':
                codes[str(r.teamId)][r.teamTricode] += 1
            if typ in ('Made Shot', 'Missed Shot'):
                made = typ == 'Made Shot'
                three = '3PT' in (r.description or '')
                x, y = float(r.xLegacy or 0), float(r.yLegacy or 0)
                dist = feet(x, y, r.shotDistance)
                p = out[pid]
                if three:
                    zone = 'Corner3' if abs(x) >= 220 and y <= 87.5 else 'Arc3'
                else:
                    zone = 'AtRim' if dist <= RIM_FT else 'ShortMidRange' if dist <= SHORT_MID_FT else 'LongMidRange'
                p[zone + 'FGA'] += 1
                p[zone + 'FGM'] += made
                if made and zone == 'AtRim':
                    m = ASSIST.search(r.description or '')
                    if m:
                        passer = last_names.get((gid, str(r.teamId)), {}).get(m.group(1).strip())
                        if passer:
                            out[passer]['AtRimAssists'] += 1
                        else:
                            unresolved += 1
                # Rebounds of his own missed field goal, a missed tip aside: closest to pbpstats'
                # (2000-01: 292 against its 237, 70 of 135 players exact; with free throws and
                # tips, 411).
                last_miss = None if made or 'Tip' in (r.subType or '') else pid
            elif typ == 'Free Throw':
                last_miss = None
            elif typ == 'Rebound':
                if last_miss and pid == last_miss:
                    out[pid]['SelfOReb'] += 1
                last_miss = None
            elif typ == 'Turnover' and r.subType in ('Bad Pass', 'Lost Ball', 'Out Of Bounds'):
                out[pid][r.subType] += 1
    team_code = {tid: max(c, key=c.get) for tid, c in codes.items()}
    return out, team_code, unresolved


def on_floor(season):
    """Each player's minutes, possessions and points for and against with him on the floor,
    from the season's playoff possession cache."""
    sides, stints, ev = load(season + '-po')
    base = floor_rows(sides, stints, ev, lambda fives: fives.map(lambda f: True))
    poss = sides.groupby(['team', 'off']).size()
    return {pid: dict(zip(FLOOR_FIELDS, v)) for pid, v in base.items()}, poss


def team_rows(b, team_code, poss):
    """Each playoff team's totals as pbpstats' Type=Team rows carry them: points for and against
    from the box scores (technical free throws included, as pbpstats counts them), possessions
    from the possession cache."""
    by_game = b.groupby(['gameId', 'playerteamId'])['points'].sum().reset_index()
    rows = []
    for tid, g in by_game.groupby('playerteamId'):
        tid = str(int(tid))
        opp = by_game[by_game['gameId'].isin(g['gameId']) & (by_game['playerteamId'] != g['playerteamId'].iloc[0])]
        abbr = team_code[tid]
        rows.append([tid, tid, abbr, abbr, tid, abbr, len(g), int(g['points'].sum()), int(opp['points'].sum()),
                     int(poss.get((abbr, 1), 0)), int(poss.get((abbr, 0), 0))])
    return rows


def season_rows(d, season, box):
    floor, poss = on_floor(season)
    t = plays(d, season)
    b = box[box['gameId'].str[:3] == '4' + code(season)]
    last_names = defaultdict(dict)
    for r in b.itertuples(index=False):
        last_names[(r.gameId, str(int(r.playerteamId)))][r.lastName] = str(int(r.personId))
    pbp, team_code, unresolved = shot_and_play_totals(t, last_names)
    rows = []
    off_floor = []
    for pid, g in b.groupby('personId'):
        pid = str(int(pid))
        tid = str(int(g['playerteamId'].mode().iloc[0]))
        fga, fg3a, fta, pts = g['fieldGoalsAttempted'].sum(), g['threePointersAttempted'].sum(), g['freeThrowsAttempted'].sum(), g['points'].sum()
        fg3m, fgm = g['threePointersMade'].sum(), g['fieldGoalsMade'].sum()
        p = pbp.get(pid, {})
        fl = floor.get(pid)
        if not fl:  # the rebuilt floor never had him (seconds at a period's end): the box score's
            off_floor.append(pid)
            his = int(g['possessions'].sum())
            fl = {'Minutes': g['numMinutes'].sum(), 'OffPoss': his, 'DefPoss': his, 'PlusMinus': int(g['plusMinusPoints'].sum()),
                  'OpponentPoints': round((g['defensiveRating'] * g['possessions']).sum() / 100)}
        bad, lost = p.get('Bad Pass', 0), p.get('Lost Ball', 0)
        live_bad, live_lost = round(bad * LIVE_SHARE[season][0]), round(lost * LIVE_SHARE[season][1])
        v = {
            'EntityId': pid, 'TeamId': tid, 'Name': f"{g['firstName'].iloc[0]} {g['lastName'].iloc[0]}".strip(),
            'TeamAbbreviation': team_code.get(tid, ''), 'SecondsPlayed': round(fl['Minutes'] * 60),
            # Plus-minus from the box scores, which match pbpstats' (2000-01: 118 of 135 exact; the
            # possession cache leaves technical free throws out).
            'GamesPlayed': len(g), 'Minutes': round(fl['Minutes']), 'PlusMinus': int(g['plusMinusPoints'].sum()),
            'OffPoss': fl['OffPoss'], 'DefPoss': fl['DefPoss'], 'TotalPoss': fl['OffPoss'] + fl['DefPoss'],
            'OnOffRtg': 100 * (fl['PlusMinus'] + fl['OpponentPoints']) / fl['OffPoss'] if fl['OffPoss'] else None,
            'OnDefRtg': 100 * fl['OpponentPoints'] / fl['DefPoss'] if fl['DefPoss'] else None,
            'BadPassTurnovers': live_bad, 'BadPassOutOfBoundsTurnovers': bad - live_bad,
            'LostBallTurnovers': live_lost, 'LostBallOutOfBoundsTurnovers': lost - live_lost + p.get('Out Of Bounds', 0),
            'FG2M': int(fgm - fg3m), 'FG2A': int(fga - fg3a), 'FG3M': int(fg3m), 'FG3A': int(fg3a),
            'FtPoints': int(g['freeThrowsMade'].sum()), 'Points': int(pts), 'Assists': int(g['assists'].sum()),
            'DefRebounds': int(g['reboundsDefensive'].sum()), 'OffRebounds': int(g['reboundsOffensive'].sum()),
            'Rebounds': int(g['reboundsDefensive'].sum() + g['reboundsOffensive'].sum()), 'Steals': int(g['steals'].sum()),
            'Turnovers': int(g['turnovers'].sum()), 'Fouls': int(g['foulsPersonal'].sum()),
            'FTA': int(fta), 'Blocks': int(g['blocks'].sum()),
            'Fg3Pct': float(fg3m / fg3a) if fg3a else None, 'Fg2Pct': float((fgm - fg3m) / (fga - fg3a)) if fga > fg3a else None,
            'TsPct': float(pts / (2 * (fga + 0.44 * fta))) if fga + fta else None,
        }
        for k in ('AtRimFGM', 'AtRimFGA', 'ShortMidRangeFGM', 'ShortMidRangeFGA', 'LongMidRangeFGM', 'LongMidRangeFGA',
                  'Corner3FGM', 'Corner3FGA', 'Arc3FGM', 'Arc3FGA', 'AtRimAssists', 'SelfOReb'):
            v[k] = int(p.get(k, 0))
        v['AtRimAccuracy'] = v['AtRimFGM'] / v['AtRimFGA'] if v['AtRimFGA'] else None
        rows.append([v[f] for f in FIELDS])
    games = b['gameId'].nunique()
    teams = team_rows(b, team_code, poss)
    print(f'{season}: {games} games, {len(rows)} players, {len(teams)} teams; play-by-play {t["gameId"].nunique()} games; '
          f'rim assists without a passer found: {unresolved}; on no rebuilt floor (box score used): {len(off_floor)} {off_floor}')
    return rows, teams


def main(args):
    d, out = DIR, OUT
    if '--dir' in args:
        d = args[args.index('--dir') + 1]
    if '--out' in args:
        out = args[args.index('--out') + 1]
    seasons = [a for a in args if re.fullmatch(r'\d{4}-\d{2}', a)] or SEASONS
    box = box_scores(d, seasons)
    result = {s: season_rows(d, s, box) for s in seasons}
    with open(out, 'w') as f:
        json.dump({'source': 'Kaggle NBA dataset: PlayerStatisticsExtended.csv, PlayByPlay.parquet', 'fields': FIELDS,
                   'seasons': {s: r[0] for s, r in result.items()}, 'teamFields': TEAM_FIELDS,
                   'teams': {s: r[1] for s, r in result.items()}}, f, separators=(',', ':'))
    print('wrote', os.path.normpath(out))


if __name__ == '__main__':
    main(sys.argv[1:])
