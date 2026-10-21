"""Builds a season's possession tables from the play-by-play archive.

  python3 analysis/footprint/build.py [--playoffs] 2025-26 [2024-25 ...]

Writes data/cache/pbp/<season>/{possessions,shots,fts,tovs,rebs,fouls,floor,stints}.pkl
(playoffs: data/cache/pbp/<season>-po/; gitignored: hundreds of MB over many seasons)
and prints the reconstruction checks. stints.pkl holds each ten-man stretch's seconds
with both teams and their fives.
"""
import json
import os
import sys
from collections import defaultdict

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import pbp  # noqa: E402
from pbp import games  # noqa: E402
from lineups import Names, annotate  # noqa: E402
from possessions import Game  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(DATA, 'cache', 'pbp')


def full_names():
    """nbaId -> full name, from the bio file and the lineup pulls' player lists."""
    names = {}
    for path in [os.path.join(DATA, 'lineup-players.json'), os.path.join(DATA, 'playoffs', 'lineup-players.json')]:
        if os.path.exists(path):
            names.update({k: v for k, v in json.load(open(path))['players'].items() if v})
    for b in json.load(open(os.path.join(DATA, 'bio.json'))).values():
        if b.get('nbaId') and b.get('sheetName'):
            names.setdefault(b['nbaId'], b['sheetName'])
    return names


def starters(season, kind):
    """{game id: its starters' ids}, for a first period whose fifth starter never shows: from
    our fetch's box scores when the season is ours (pbp.own_games), else the Kaggle box
    scores when the play-by-play is the Kaggle dataset's (pbp.KAGGLE)."""
    own = {d['gameId']: set(d['starters']) for d in pbp.own_games(season)}
    if own or not pbp.KAGGLE:
        return own
    b = pd.read_csv(os.path.join(pbp.KAGGLE, 'PlayerStatistics.csv'), usecols=['gameId', 'personId', 'startingPosition'],
                    dtype={'gameId': str, 'personId': str}, low_memory=False)
    b = b[b['gameId'].str.startswith(pbp.KINDS[kind][2] + season[2:4]) & b['startingPosition'].notna()]
    return {'00' + g: set(x['personId']) for g, x in b.groupby('gameId')}


def build(season, kind='regular'):
    first_fives = starters(season, kind)
    roster = defaultdict(dict)
    all_games = []
    for gid, evs in games(season, kind):
        for e in evs:
            if e['pid'] and e['team'] and e['name']:
                roster[e['team']][e['pid']] = e['name']
        all_games.append((gid, evs))
    if not all_games:
        print(f'{season}{" playoffs" if kind == "playoffs" else ""}: no games in the archive')
        return
    names = Names(roster, full_names())
    stats = defaultdict(int)
    tables = defaultdict(list)
    floor, stints = defaultdict(float), defaultdict(float)
    points_off = 0
    for gid, evs in all_games:
        teams, fl, st = annotate(evs, names, stats, first_fives.get(gid, ()))
        if len(teams) != 2:
            stats['games_skipped'] += 1
            continue
        for k, v in fl.items():
            floor[k] += v
        for k, v in st.items():
            stints[(gid, teams[0], k[0], teams[1], k[1])] += v
        g = Game(season, gid, evs, teams).run()
        for k, v in g.stats.items():
            stats[k] += v
        base = len(tables['possessions'])
        for i, p in enumerate(g.poss):
            p['id'] = base + i
        tables['possessions'].extend(g.poss)
        for name in ('shots', 'fts', 'tovs', 'rebs', 'fouls'):
            for row in getattr(g, name):
                row['poss'] += base
                tables[name].append(row)
        # The possessions' points plus technical free throws must equal the final score.
        # Scores only go up; the highest is the final (a stray last row can carry less).
        final = {g.home: max(e['h'] or 0 for e in evs), g.other(g.home): max(e['a'] or 0 for e in evs)}
        for t in teams:
            got = sum(p['pts'] for p in g.poss if p['off'] == t) + g.tech[t]
            if got != final[t]:
                points_off += 1
        stats['games'] += 1
    out = os.path.join(CACHE, season + ('-po' if kind == 'playoffs' else ''))
    os.makedirs(out, exist_ok=True)
    for name, rows in tables.items():
        pd.DataFrame(rows).to_pickle(os.path.join(out, f'{name}.pkl'))
    pd.DataFrame([{'team': t, 'pid': p, 'seconds': s} for (t, p), s in floor.items()]).to_pickle(os.path.join(out, 'floor.pkl'))
    pd.DataFrame([{'g': k[0], 'team_a': k[1], 'a': k[2], 'team_b': k[3], 'b': k[4], 'seconds': s}
                  for k, s in stints.items()]).to_pickle(os.path.join(out, 'stints.pkl'))
    poss = pd.DataFrame(tables['possessions'])
    full = poss['off5'].map(lambda f: f is not None and len(f) == 5) & poss['def5'].map(lambda f: f is not None and len(f) == 5)
    print(f'{season}{" playoffs" if kind == "playoffs" else ""}: {stats["games"]} games, {len(poss)} possessions '
          f'({100 * full.mean():.2f}% with two full fives, {100 * poss["garbage"].mean():.1f}% garbage, '
          f'{100 * (poss["excluded"] != "").mean():.2f}% excluded)')
    print(f'  actions by a player off the rebuilt floor: {stats["actor_off_floor"]} of {stats["actions"]} '
          f'({100 * stats["actor_off_floor"] / max(stats["actions"], 1):.3f}%)')
    print(f'  period starts: {stats["period_over"]} over five, {stats["period_short"]} short after filling '
          f'({stats["filled_from_previous"]} filled from the previous period, {stats["filled_from_starters"]} from the box score\'s '
          f'starters); unresolved sub-ins {stats["unresolved"]}')
    print(f'  implicit possession switches {stats["implicit_switch"]}, ghost rebounds {stats["ghost_rebound"]}, '
          f'team-games whose possession points miss the final score {points_off}')


if __name__ == '__main__':
    kind = 'playoffs' if '--playoffs' in sys.argv else 'regular'
    for s in sys.argv[1:]:
        if not s.startswith('--'):
            build(s, kind)
