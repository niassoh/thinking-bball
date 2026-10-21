# NBA.com player tracking for the playoff stats sheet: the six files its tracking tabs
# read (touches, drives, catch-and-shoot, pull-up, close defence under 6 ft, wide-open
# shooting), per season, with SeasonType=Playoffs.
#
# Layouts are site_data's (github.com/gabriel1200/site_Data), the same as the
# regular-season files in gs://thinkingbball/<yr>/: touches/drives/cs/pullup go through
# site_data's own prep functions, read from its player_level.py (only the function
# definitions; the module runs a pull when imported). wide_open follows its
# stat_scrape.get_playershots and close_6 the leaguedashptdefend layout of audit #71
# (PLAYER_ID as the 13th column). Requests use nba_api's headers: site_data's own get
# stalled by stats.nba.com (audit #67).
#
# Usage: python3 scripts/playoff-tracking-pull.py <site_Data dir> <out dir> [first last] [--regular]
#   writes <out>/<end year>/playoffs/{player_tracking,player_shooting}/*.csv
#   (--regular: the regular season instead, to <out>/<end year>/..., for checking the
#   layouts against the files already in the bucket)
import ast
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from nba_api.stats.library.http import NBAStatsHTTP

site, out = Path(sys.argv[1]), Path(sys.argv[2])
args = [a for a in sys.argv[3:] if not a.startswith('--')]
first, last = (int(args[0]), int(args[1])) if args else (2014, 2026)
regular = '--regular' in sys.argv
stype = 'Regular Season' if regular else 'Playoffs'
trail = '' if regular else 'playoffs'

# site_data's prep functions, without running the module.
tree = ast.parse((site / 'player_level.py').read_text())
keep = {'format_drives', 'prep_touches', 'prep_cs', 'prep_pullup'}
scope = {'pd': pd}
exec(compile(ast.Module([n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in keep], []), 'player_level.py', 'exec'), scope)

HEADERS = NBAStatsHTTP.headers
COMMON = {'College': '', 'Conference': '', 'Country': '', 'DateFrom': '', 'DateTo': '', 'Division': '', 'DraftPick': '', 'DraftYear': '',
          'GameScope': '', 'Height': '', 'LastNGames': 0, 'LeagueID': '00', 'Location': '', 'Month': 0, 'OpponentTeamID': 0, 'Outcome': '',
          'PORound': 0, 'PerMode': 'Totals', 'PlayerExperience': '', 'PlayerPosition': '', 'SeasonSegment': '', 'SeasonType': stype,
          'StarterBench': '', 'TeamID': 0, 'VsConference': '', 'VsDivision': '', 'Weight': ''}


def get(endpoint, params):
    for attempt in range(4):
        try:
            r = requests.get(f'https://stats.nba.com/stats/{endpoint}', params={**COMMON, **params}, headers=HEADERS, timeout=60)
            r.raise_for_status()
            rs = r.json()['resultSets']
            rs = rs[0] if isinstance(rs, list) else rs
            time.sleep(1.5)
            return pd.DataFrame.from_records(rs['rowSet'], columns=rs['headers'])
        except Exception as e:  # stats.nba.com drops connections now and then
            print(f'  retry {endpoint} {params}: {e}')
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'{endpoint} {params} failed')


def tracking(season, measure):
    return get('leaguedashptstats', {'PlayerOrTeam': 'Player', 'PtMeasureType': measure, 'Season': season, 'ISTRound': ''})


def wide_open(season):
    df = get('leaguedashplayerptshot', {'CloseDefDistRange': '6+ Feet - Wide Open', 'Season': season, 'DribbleRange': '', 'GameSegment': '',
                                        'GeneralRange': '', 'Period': 0, 'ShotClockRange': '', 'ShotDistRange': '', 'TouchTimeRange': ''})
    df = df.rename(columns={'FG2A_FREQUENCY': '2FG FREQ%', 'FG2_PCT': '2FG%', 'FG2A': '2FGA', 'FG2M': '2FGM', 'FG3A_FREQUENCY': '3FG FREQ%',
                            'FG3_PCT': '3P%', 'FG3A': '3PA', 'FG3M': '3PM', 'EFG_PCT': 'EFG%', 'FG_PCT': 'FG%', 'FGA_FREQUENCY': 'FREQ%',
                            'PLAYER_NAME': 'PLAYER', 'PLAYER_LAST_TEAM_ABBREVIATION': 'TEAM'})
    df = df[['PLAYER_ID', 'PLAYER', 'TEAM', 'AGE', 'GP', 'G', 'FREQ%', 'FGM', 'FGA', 'FG%', 'EFG%', '2FG FREQ%', '2FGM', '2FGA', '2FG%',
             '3FG FREQ%', '3PM', '3PA', '3P%']]
    for c in df.columns:
        if '%' in c:
            df[c] *= 100
    return df


def close_6(season):
    df = get('leaguedashptdefend', {'DefenseCategory': 'Less Than 6Ft', 'Season': season})
    # Number formats as in #71's files (counts as floats, percentages to 0.1).
    pct = lambda c: (df[c] * 100).round(1)
    return pd.DataFrame({'PLAYER': df['PLAYER_NAME'], 'TEAM': df['PLAYER_LAST_TEAM_ABBREVIATION'], 'AGE': df['AGE'], 'POSITION': df['PLAYER_POSITION'],
                         'GP': df['GP'], 'G': df['G'], 'FREQ%': pct('FREQ'), 'DFGM': df['FGM_LT_06'].astype(float), 'DFGA': df['FGA_LT_06'].astype(float),
                         'DFG%': pct('LT_06_PCT'), 'FG%': pct('NS_LT_06_PCT'), 'Diff%': pct('PLUSMINUS'), 'PLAYER_ID': df['CLOSE_DEF_PERSON_ID']})


for end in range(first, last + 1):
    season = f'{end - 1}-{str(end)[-2:]}'
    base = out / str(end) / trail if trail else out / str(end)
    (base / 'player_tracking').mkdir(parents=True, exist_ok=True)
    (base / 'player_shooting').mkdir(parents=True, exist_ok=True)
    files = {
        'player_tracking/drives.csv': scope['format_drives'](tracking(season, 'Drives')),
        'player_tracking/cs.csv': scope['prep_cs'](tracking(season, 'CatchShoot')),
        'player_tracking/touches.csv': scope['prep_touches'](tracking(season, 'Possessions')),
        'player_tracking/pullup.csv': scope['prep_pullup'](tracking(season, 'PullUpShot')),
        'player_tracking/close_6.csv': close_6(season),
        'player_shooting/wide_open.csv': wide_open(season),
    }
    for name, df in files.items():
        df.to_csv(base / name, index=False)
    print(f'{season} {stype}: ' + ', '.join(f'{Path(n).stem} {len(df)}' for n, df in files.items()), flush=True)
