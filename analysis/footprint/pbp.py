"""Raw NBA play-by-play (the season CSVs in the archive zip) as canonical events.

Each season file holds every game's events in order: gameid, period, clock
(PT11M26.00S), h_pts/a_pts, team, playerid, player ('C. Holmgren'), type, subtype,
result, x/y (tenths of a foot from the basket), dist, desc. Most games use the
NBA.com v3 wording ('Made Shot', 'Substitution' with only the outgoing player's id);
a few use a lowercase variant ('2pt', 'substitution' in/out rows with ids). Both
become the same event dicts here:

  g period t (seconds left in the period) kind team pid name sub desc
  made value x y (shots) n of (free throws) h a (score after the event)

kind is one of: start end jump shot heave ft reb tov foul sub_in sub_out steal block
violation timeout other. Team-level rebounds and turnovers carry the team's
abbreviation and pid ''.

A season our nightly fetch has (data/pbp/<season>/, scripts/pbp-fetch.js: NBA.com's v3
rows, as the Kaggle dataset's are) is read from there instead.
"""
import csv
import gzip
import io
import json
import os
import re
import unicodedata
import zipfile

ZIP = '/Users/pzh/Downloads/archive.zip'
# The Kaggle NBA dataset's folder (its PlayByPlay.parquet), read instead of the archive when
# set: it has every playoff game from 1996-97, which the archive lacks (analysis/playoff_players.py).
KAGGLE = os.environ.get('PBP_KAGGLE')
OWN = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'pbp')

# NBA team ids, for team-level rows that name the team by id with a blank team column.
TEAM_IDS = {
    '1610612737': 'ATL', '1610612738': 'BOS', '1610612739': 'CLE', '1610612740': 'NOP',
    '1610612741': 'CHI', '1610612742': 'DAL', '1610612743': 'DEN', '1610612744': 'GSW',
    '1610612745': 'HOU', '1610612746': 'LAC', '1610612747': 'LAL', '1610612748': 'MIA',
    '1610612749': 'MIL', '1610612750': 'MIN', '1610612751': 'BKN', '1610612752': 'NYK',
    '1610612753': 'ORL', '1610612754': 'IND', '1610612755': 'PHI', '1610612756': 'PHX',
    '1610612757': 'POR', '1610612758': 'SAC', '1610612759': 'SAS', '1610612760': 'OKC',
    '1610612761': 'TOR', '1610612762': 'UTA', '1610612763': 'MEM', '1610612764': 'WAS',
    '1610612765': 'DET', '1610612766': 'CHA',
}

# A franchise's earlier codes. TEAM_IDS gives today's, but the players' rows carry the
# code of the day (NJN until 2012, SEA until 2008, VAN until 2001; the Hornets' id is
# CHH until 2002, then NOH, NOK for the two Oklahoma City seasons, NOH again).
FORMER = {'BKN': {'NJN'}, 'NOP': {'CHH', 'NOH', 'NOK'}, 'OKC': {'SEA'}, 'MEM': {'VAN'}}

CLOCK = re.compile(r'PT(\d+)M([\d.]+)S')
FT_OF = re.compile(r'(\d) of (\d)')
ASSIST = re.compile(r'\(([^()]+?) \d+ AST\)')


def norm(s):
    """Accent-free, lowercase, no dots: 'Dončić' -> 'doncic', 'Jr.' -> 'jr'."""
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().replace('.', '').strip()


def surname(abbr):
    """'C. Holmgren' -> 'Holmgren'; 'Smith Jr.' stays."""
    return abbr.split('. ', 1)[1] if '. ' in abbr else abbr


def season_file(season):
    """'2025-26' -> 'pbp2026.csv' (files are named by the year the season ends)."""
    return f'pbp{int(season[:4]) + 1}.csv'


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _seconds(clock):
    m = CLOCK.match(clock or '')
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


def canonical(r):
    """One CSV row as an event dict (None for rows that carry nothing we use)."""
    typ, sub, desc = r['type'], r['subtype'] or '', r['desc'] or ''
    team, pid = r['team'] or '', r['playerid'] or ''
    if pid in TEAM_IDS:  # team-level row: the team is named by id
        team, pid = TEAM_IDS[pid], ''
    if pid == '0':
        pid = ''
    e = {
        'g': r['gameid'], 'period': int(r['period']) if r['period'].isdigit() else None,
        't': _seconds(r['clock']), 'team': team, 'pid': pid, 'name': r['player'] or '',
        'sub': sub, 'desc': desc, 'h': _num(r['h_pts']), 'a': _num(r['a_pts']),
    }
    low = bool(typ) and not typ[:1].isupper()  # '2pt', 'rebound': the lowercase wording
    if typ == 'period':
        e['kind'] = 'start' if sub == 'start' else 'end'
    elif typ in ('Made Shot', 'Missed Shot', '2pt', '3pt'):
        e['kind'] = 'shot'
        e['made'] = (typ == 'Made Shot') if not low else (r['result'] == 'Made')
        e['value'] = 3 if (typ == '3pt' or '3PT' in desc) else 2
        e['x'], e['y'] = _num(r['x']), _num(r['y'])
        m = ASSIST.search(desc)
        e['assist'] = m.group(1).strip() if m else None
    elif typ in ('Heave', 'heave'):
        e['kind'] = 'heave'
    elif typ in ('Free Throw', 'freethrow'):
        e['kind'] = 'ft'
        e['made'] = (not desc.startswith('MISS')) if not low else (r['result'] == 'Made')
        m = FT_OF.search(sub)
        e['n'], e['of'] = (int(m.group(1)), int(m.group(2))) if m else (1, 1)
        s = sub.lower()
        e['ftkind'] = ('technical' if 'technical' in s else 'flagrant' if 'flagrant' in s
                       else 'clear path' if 'clear path' in s else 'normal')
    elif typ in ('Rebound', 'rebound'):
        e['kind'] = 'reb'
    elif typ in ('Turnover', 'turnover'):
        e['kind'] = 'tov'
    elif typ in ('Foul', 'foul'):
        e['kind'] = 'foul'
        if low:  # lowercase wording: 'shooting personal FOUL', 'offensive FOUL', 'technical'
            d = desc.lower()
            e['sub'] = ('Technical' if 'technical' in d else 'Offensive' if 'offensive' in d
                        else 'Shooting' if 'shooting' in d else 'Personal')
    elif typ == 'Substitution':
        m = re.match(r'SUB: (.+) FOR (.+)', desc)
        e['kind'] = 'sub_out'  # the row's player leaves; the incoming one is named in desc
        e['incoming'] = m.group(1).strip() if m else None
    elif typ == 'substitution':
        e['kind'] = 'sub_in' if sub == 'in' else 'sub_out'
        e['incoming'] = None
    elif typ == '' and ' STEAL ' in f' {desc} ' or typ == 'steal':
        e['kind'] = 'steal'
    elif typ == '' and ' BLOCK ' in f' {desc} ' or typ == 'block':
        e['kind'] = 'block'
    elif typ in ('Jump Ball', 'jumpball'):
        e['kind'] = 'jump'
    elif typ in ('Violation', 'violation'):
        e['kind'] = 'violation'
    elif typ in ('Timeout', 'timeout'):
        e['kind'] = 'timeout'
    else:
        e['kind'] = 'other'
    return e


def era_codes(evs):
    """A game's team-level rows (team rebounds and turnovers) relabelled with the code
    its players' rows carry, where TEAM_IDS gave the franchise's later one."""
    teams = {e['team'] for e in evs if e['pid'] and e['team']}
    for e in evs:
        if not e['pid'] and e['team'] and e['team'] not in teams:
            then = FORMER.get(e['team'], set()) & teams
            if len(then) == 1:
                e['team'] = then.pop()
    return evs


KINDS = {'regular': '002', 'playoffs': '004'}


def _score(v):
    v = _num(v)
    return int(v) if v is not None and v == v else 0  # v != v: NaN


def v3_rows(gid, rows):
    """One game's NBA.com v3 rows (dicts, in clock order) in the archive's columns, the score
    carried forward (the Kaggle dataset leaves it 0, NBA.com blank, on rows that don't score)."""
    h = a = 0
    for r in rows:
        h, a = max(h, _score(r['scoreHome'])), max(a, _score(r['scoreAway']))
        yield {'gameid': gid, 'period': str(r['period']), 'clock': r['clock'], 'h_pts': h, 'a_pts': a,
               'team': r['teamTricode'] or '', 'playerid': str(r['personId'] or ''), 'player': r['playerNameI'] or '',
               'type': r['actionType'] or '', 'subtype': r['subType'] or '', 'result': r['shotResult'] or '',
               'x': r['xLegacy'], 'y': r['yLegacy'], 'dist': r['shotDistance'], 'desc': r['description'] or ''}


def kaggle_rows(season, kind):
    """The Kaggle play-by-play's rows for a season in the archive's columns: game ids get their
    leading zeros, and each game runs in clock order (action numbers alone sometimes don't: a
    1996-97 Lakers game lists a sub at 1:54 of the second before three at 6:47, which cost
    Shaquille O'Neal the quarter)."""
    import pyarrow.parquet as pq
    prefix = KINDS[kind][2] + season[2:4]
    cols = ['gameId', 'actionNumber', 'period', 'clock', 'scoreHome', 'scoreAway', 'teamTricode', 'personId',
            'playerNameI', 'actionType', 'subType', 'shotResult', 'xLegacy', 'yLegacy', 'shotDistance', 'description']
    t = pq.read_table(os.path.join(KAGGLE, 'PlayByPlay.parquet'), columns=cols,
                      filters=[('gameId', '>=', prefix + '00000'), ('gameId', '<=', prefix + '99999')]).to_pandas()
    t['left'] = t['clock'].map(_seconds)
    for gid, g in t.sort_values(['gameId', 'period', 'left', 'actionNumber'], ascending=[True, True, False, True]).groupby('gameId', sort=True):
        yield from v3_rows('00' + gid, g.to_dict('records'))


def own_games(season):
    """Our fetch's saved games for a season (scripts/pbp-fetch.js), in game id order."""
    folder = os.path.join(OWN, season)
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        with gzip.open(os.path.join(folder, name), 'rt', encoding='utf-8') as f:
            yield json.load(f)


def own_rows(season, kind):
    """Our fetch's rows for a season in the archive's columns, each game in clock order as
    kaggle_rows has it."""
    for d in own_games(season):
        if d['gameId'].startswith(KINDS[kind]):
            rows = [dict(zip(d['fields'], a)) for a in d['actions']]
            rows.sort(key=lambda r: (r['period'], -(_seconds(r['clock']) or 0), r['actionNumber']))
            yield from v3_rows(d['gameId'], rows)


def archive_rows(season, zip_path):
    with zipfile.ZipFile(zip_path) as z, z.open(season_file(season)) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8'))


def games(season, kind='regular', zip_path=ZIP):
    """Yields (gameid, [events]) for a season's regular-season (or playoff) games, in file
    order. Season files hold the play-in and the NBA Cup final too (game ids starting 005
    and 006); those are left out either way."""
    gid, evs = None, []
    rows = (own_rows(season, kind) if os.path.isdir(os.path.join(OWN, season))
            else kaggle_rows(season, kind) if KAGGLE else archive_rows(season, zip_path))
    for r in rows:
        if not r['gameid'].startswith(KINDS[kind]):
            continue
        if r['gameid'] != gid:
            if evs:
                yield gid, era_codes(evs)
            gid, evs = r['gameid'], []
        e = canonical(r)
        if e['period'] is not None and e['t'] is not None:
            evs.append(e)
    if evs:
        yield gid, era_codes(evs)
