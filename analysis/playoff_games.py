"""The playoff games pbpstats doesn't list (its get-games has none for 1996-97 to 1999-00),
from the user-supplied archive (~/Downloads/archive.zip, dim_games: every game's teams and
score), in the shape of the playoff sheet's 'Game Import' tab: game id, date, team ids,
points, possessions and team codes. scripts/backfill-seasons.js writes them into the sheet
for those seasons, whose opponent averages ('PS Game Results' P:AB, the playoff rTS% and
the ratings built on it) need each game's two teams. Nothing in the sheet reads a game's
possessions, which the archive lacks for these seasons, so they're left empty. Codes are the
archive's (today's franchise codes, PHO for Phoenix); the pull maps them to the season's.

Usage: python3 analysis/playoff_games.py [path/to/archive.zip]
"""
import csv
import io
import json
import os
import sys
import zipfile

SEASONS = {'1997': '1996-97', '1998': '1997-98', '1999': '1998-99', '2000': '1999-00'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'history', 'playoff-games.json')


def main(archive):
    z = zipfile.ZipFile(archive)
    games = {s: [] for s in SEASONS.values()}
    for g in csv.DictReader(io.TextIOWrapper(z.open('csv/public.dim_games.csv'), encoding='utf-8')):
        if g['season_type'] == 'Playoffs' and g['season'] in SEASONS:
            games[SEASONS[g['season']]].append(g)
    out = {}
    for season, gs in games.items():
        out[season] = [[g['game_id'], g['game_date'], g['home_team_id'], g['away_team_id'], int(g['home_pts']), int(g['away_pts']), None, None, g['home_team_abbr'], g['away_team_abbr']]
                       for g in sorted(gs, key=lambda g: (g['game_date'], g['game_id']))]
        print(f'{season}: {len(out[season])} games')
    with open(OUT, 'w') as f:
        json.dump({'source': 'archive.zip dim_games', 'fields': ['Gameid', 'Date', 'Hometeamid', 'Awayteamid', 'Homepoints', 'Awaypoints', 'Homepossessions', 'Awaypossessions', 'Hometeamabbreviation', 'Awayteamabbreviation'], 'seasons': out}, f, separators=(',', ':'))
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/archive.zip'))
