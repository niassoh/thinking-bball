"""Who is on the floor at every event, rebuilt from substitutions.

The play-by-play has no lineup column. A substitution row names the outgoing player by
id and the incoming one by surname ('SUB: Eason FOR Smith Jr.'), and nothing marks who
starts a period. So:
- each period's starters are the players whose first appearance in it (an action, or
  being subbed out) comes before any sub-in; a period short of five is filled from the
  previous period's floor, one with too many keeps the previous period's players and
  then the earliest to appear; a game's first period still short takes the box score's
  starters when they're given (a starter can play a quarter without an event: Sabonis,
  the 1999-00 Blazers' fourth playoff game);
- an incoming surname resolves to a player on that team: the game's roster, then the
  season's, narrowed by a first-name prefix ('Jay. Williams', 'St. Curry') against full
  names, then to one not already on the floor, then to the one who appears soonest.

annotate() adds e['on'] = {team: tuple of player ids} to every event (the floor after
the event, so a substitution row shows the new five) and returns floor seconds per
(team, player) and per ten-man stint, for checking against pbpstats.
"""
from collections import defaultdict

from pbp import norm, surname

# Kinds whose player must be on the floor. Fouls are listed separately: technicals can
# be called on the bench.
ON_FLOOR = ('shot', 'ft', 'reb', 'tov', 'steal', 'block', 'violation', 'jump')
BENCH_FOULS = ('technical', 'double technical', 'delay technical')


SUFFIXES = (' jr', ' sr', ' ii', ' iii', ' iv')
UMLAUTS = {'ö': 'oe', 'ü': 'ue', 'ä': 'ae', 'Ö': 'Oe', 'Ü': 'Ue', 'Ä': 'Ae'}


def _keys(s):
    """The spellings a name may take: accents dropped or umlauts written out ('Pöltl',
    'Poeltl'), with or without a suffix ('Jemison III', 'Jemison')."""
    out = set()
    for v in (s, ''.join(UMLAUTS.get(ch, ch) for ch in s)):
        k = norm(v)
        out.add(k)
        for suf in SUFFIXES:
            if k.endswith(suf):
                out.add(k[:-len(suf)].strip())
    return out


def _on_floor_actor(e):
    if not e['pid'] or not e['team']:
        return False
    if e['kind'] == 'foul':
        return e['sub'].lower() not in BENCH_FOULS
    if e['kind'] == 'ft':
        return e.get('ftkind') != 'technical'
    return e['kind'] in ON_FLOOR


class Names:
    """Resolves an incoming player's name to an id for a team."""

    def __init__(self, season_roster, full_names):
        self.season = season_roster  # team -> {pid: abbr}
        self.full = full_names       # pid -> full name

    def candidates(self, team, name, roster):
        prefix, last = (name.split('. ', 1) if '. ' in name else (None, name))

        def matcher(keys):
            want, whole = keys(last), keys(name)

            def match(pid, abbr):
                full = self.full.get(pid, '')
                full_last = full.split(' ', 1)[1] if ' ' in full else full
                return bool(keys(surname(abbr)) & want or keys(abbr) & whole or (full_last and keys(full_last) & want))
            return match

        # Exact spellings first; umlauts written out or suffixes dropped only if nothing
        # matches ('Smith' must not pick up 'Smith Jr.' when there's a plain Smith).
        found = []
        for keys in (lambda s: {norm(s)}, _keys):
            match = matcher(keys)
            found = [p for p, a in roster.items() if match(p, a)] or [
                p for p, a in self.season.get(team, {}).items() if match(p, a)]
            if found:
                break
        if prefix and len(found) > 1:
            pre = norm(prefix)
            narrowed = [p for p in found if norm(self.full.get(p, '')).startswith(pre)]
            found = narrowed or found
        return found

    def resolve(self, team, name, roster, on_floor, upcoming):
        found = self.candidates(team, name, roster)
        if len(found) > 1:
            off = [p for p in found if p not in on_floor]
            found = off or found
        if len(found) > 1:
            order = {p: i for i, p in reversed(list(enumerate(upcoming)))}
            found.sort(key=lambda p: order.get(p, 10 ** 9))
        return found[0] if found else None


def _assister(e, roster, names, on):
    """The assister's id (a teammate on the floor, by surname)."""
    if not e.get('assist'):
        return None
    found = names.candidates(e['team'], e['assist'], roster)
    on_floor = [p for p in found if p in on]
    return (on_floor or found or [None])[0]


def annotate(evs, names, stats, starters=()):
    """Adds e['on'] and e['assister'] to a game's events; returns (floor, stints)
    seconds. stats counts diagnostics (short/long periods, unresolved names). starters:
    the game's starting player ids, if known."""
    roster = defaultdict(dict)
    for e in evs:
        if e['pid'] and e['team'] and e['name']:
            roster[e['team']][e['pid']] = e['name']
    teams = sorted(roster)
    floor = defaultdict(float)
    stints = defaultdict(float)
    by_period = defaultdict(list)
    for e in evs:
        by_period[e['period']].append(e)
    prev_end = {t: set() for t in teams}
    for period in sorted(by_period):
        pe = by_period[period]
        upcoming = [e['pid'] for e in pe if e['pid']]
        # First appearances: who acts (or leaves) before being subbed in.
        first, subbed_in = {}, set()
        for i, e in enumerate(pe):
            t = e['team']
            if e['kind'] == 'sub_out' and e['pid']:
                if e['pid'] not in subbed_in:
                    first.setdefault(e['pid'], (i, t))
                if e.get('incoming'):
                    pin = names.resolve(t, e['incoming'], roster[t], set(), upcoming[i:])
                    if pin and pin not in first:
                        subbed_in.add(pin)
            elif e['kind'] == 'sub_in' and e['pid']:
                if e['pid'] not in first:
                    subbed_in.add(e['pid'])
            elif _on_floor_actor(e) and e['pid'] not in subbed_in:
                first.setdefault(e['pid'], (i, t))
        on = {t: set() for t in teams}
        for pid, (i, t) in sorted(first.items(), key=lambda kv: kv[1][0]):
            if t in on:
                on[t].add(pid)
        for t in teams:
            if len(on[t]) > 5:
                stats['period_over'] += 1
                keep = sorted(on[t], key=lambda p: (p not in prev_end[t], first[p][0]))[:5]
                on[t] = set(keep)
            if len(on[t]) < 5:
                for pid in sorted(prev_end[t]):
                    if len(on[t]) >= 5:
                        break
                    if pid not in subbed_in and pid not in on[t]:
                        on[t].add(pid)
                        stats['filled_from_previous'] += 1
            if len(on[t]) < 5 and period == min(by_period):
                for pid in sorted(starters):
                    if len(on[t]) >= 5:
                        break
                    if pid in roster[t] and pid not in subbed_in and pid not in on[t]:
                        on[t].add(pid)
                        stats['filled_from_starters'] += 1
            if len(on[t]) != 5:
                stats['period_short'] += 1
        # Walk the period: floor seconds between events, then apply substitutions.
        last = pe[0]['t'] if pe and pe[0]['kind'] == 'start' else (720.0 if period <= 4 else 300.0)
        for i, e in enumerate(pe):
            dt = last - e['t']
            if dt > 0:
                key = tuple(tuple(sorted(on[t])) for t in teams)
                stints[key] += dt
                for t in teams:
                    for pid in on[t]:
                        floor[(t, pid)] += dt
            last = min(last, e['t'])
            t = e['team']
            if e['kind'] == 'sub_out' and t in on:
                on[t].discard(e['pid'])
                if e.get('incoming') is not None:
                    pin = names.resolve(t, e['incoming'], roster[t], on[t], upcoming[i:])
                    if pin:
                        on[t].add(pin)
                    else:
                        stats['unresolved'] += 1
            elif e['kind'] == 'sub_in' and t in on:
                on[t].add(e['pid'])
            e['on'] = {tt: tuple(sorted(on[tt])) for tt in teams}
            if e['kind'] == 'shot':
                e['assister'] = _assister(e, roster[t], names, on.get(t, ()))
            if _on_floor_actor(e) and t in on:
                stats['actions'] += 1
                if e['pid'] not in on[t]:
                    stats['actor_off_floor'] += 1
        prev_end = {t: set(on[t]) for t in teams}
    return teams, floor, stints
