"""data/footprint/<season>/games.json for the seasons pbpstats doesn't have (1996-97 to
1999-00): each regular-season game's date, from ESPN's team schedules, matched to the
archive's game ids by home team, away team and final score.

  python3 analysis/footprint/espn_games.py 1996-97 1997-98 1998-99 1999-00

One call per team-season (about 29 a season), each saved under data/cache/espn/schedules/
so a rerun calls nothing. ESPN gives tip-off in UTC; the date is the day in US Eastern.
A game the score can't place (no score in the archive, or the same pairing ending the same
way twice) takes the pairing's dates left over, in game-id order. A game ESPN lacks (the
last two days of 1999-00) keeps the date already in the file (docs/data-pull-audit.md #126:
from Basketball-Reference's schedule).
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(__file__))
from pbp import games  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(DATA, 'cache', 'espn', 'schedules')
URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{}/schedule?season={}&seasontype=2'
EASTERN = ZoneInfo('America/New_York')
# ESPN's codes where the archive's differ.
CODES = {'GS': 'GSW', 'NY': 'NYK', 'SA': 'SAS', 'UTAH': 'UTA', 'WSH': 'WAS', 'NJ': 'NJN', 'PHO': 'PHX'}


def schedule(team_id, year):
    path = os.path.join(CACHE, str(year), f'{team_id}.json')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(URL.format(team_id, year), headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        open(path, 'wb').write(body)
        time.sleep(0.5)
    return json.load(open(path))


def espn_games(year):
    """{(home, away, home pts, away pts): [Eastern date, ...]} over every team's schedule."""
    seen, out = set(), {}
    for team_id in range(1, 31):
        for e in schedule(team_id, year).get('events', []):
            if e['id'] in seen:
                continue
            seen.add(e['id'])
            side = {c['homeAway']: c for c in e['competitions'][0]['competitors']}
            if any('abbreviation' not in c['team'] for c in side.values()):  # a lockout-cancelled date
                continue
            # ESPN calls the Charlotte Hornets of 1988-2002 CHA, the archive CHH.
            code = lambda c: 'CHH' if year <= 2002 and c['team']['abbreviation'] == 'CHA' else CODES.get(c['team']['abbreviation'], c['team']['abbreviation'])  # noqa: E731
            pts = lambda c: int((c.get('score') or {}).get('value') or 0)  # noqa: E731
            day = datetime.strptime(e['date'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=timezone.utc).astimezone(EASTERN).date().isoformat()
            out.setdefault((code(side['home']), code(side['away']), pts(side['home']), pts(side['away'])), []).append(day)
    return out


def archive_games(season):
    """{game id: (home, away, home pts, away pts)}: the home side is the team whose
    scores move h_pts."""
    out = {}
    for gid, evs in games(season):
        teams = {e['team'] for e in evs if e['pid'] and e['team']}
        home, h, a = None, 0, 0
        for e in evs:
            if e['h'] is None or e['a'] is None:
                continue
            if home is None and e['team'] in teams and e['h'] > h:
                home = e['team']
            h, a = e['h'], e['a']
        away = next(iter(teams - {home}), None) if home else None
        out[gid] = (home, away, int(h), int(a))
    return out


def main(seasons):
    for season in seasons:
        year = int(season[:4]) + 1
        espn = espn_games(year)
        archive = archive_games(season)
        found, left = {}, {}
        for gid, key in sorted(archive.items()):
            days = espn.get(key, [])
            if len(days) == 1:
                found[gid] = days[0]
            else:
                left.setdefault(key[:2], []).append(gid)
        missing = []
        for pair, gids in left.items():
            taken = {d for g, d in found.items() if archive[g][:2] == pair}
            spare = sorted({d for k, ds in espn.items() if k[:2] == pair for d in ds} - taken)
            if len(spare) == len(gids):
                found.update(zip(gids, spare))
            else:
                missing.extend((g, pair, spare) for g in gids)
        path = os.path.join(DATA, 'footprint', season, 'games.json')
        had = json.load(open(path))['games'] if os.path.exists(path) else {}
        kept = {g: had[g] for g, _, _ in missing if g in had}
        found = dict(sorted({**found, **kept}.items()))
        missing = [m for m in missing if m[0] not in kept]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        doc = {'season': season, 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
               'source': 'espn', 'games': found}
        open(path, 'w').write(json.dumps(doc, indent=2) + '\n')
        print(f'games {season}: {len(found)} dated ({len(kept)} kept from the file), {len(missing)} not matched {missing[:5]}')


if __name__ == '__main__':
    main(sys.argv[1:])
