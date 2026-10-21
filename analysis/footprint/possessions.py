"""Possessions, with both fives, from a game's annotated events (lineups.annotate).

A possession ends on a made field goal (after its and-one free throw, if any), a
defensive rebound, a turnover, the last free throw of a trip when it goes in, or the
end of the period. Flagrant and clear-path free throws keep the ball; technical free
throws belong to no possession. The fives are the floor at the possession's first live
action, so a substitution made during a dead ball before it counts, and one made
between free throws doesn't.

Each possession also gets:
- garbage: Cleaning the Glass's tiers (4th quarter or later, margin ≥25 inside 12:00,
  ≥20 inside 9:00, ≥10 inside 2:00);
- excluded: 'heave' (a shot from beyond 40 ft with 3 seconds or less left, or a team
  heave) or 'late_foul' (a non-shooting foul by the trailing team in the last 2:00 of
  the 4th or overtime), which aren't what either team is trying to do.

Detail rows (shots, free-throw trips, turnovers, rebound chances, fouls) carry the
possession's index, so any channel can be rebuilt from them.
"""
import math

RIM_FT = 6
SHORT_MID_FT = 14
ZONES = ('rim', 'short_mid', 'long_mid', 'corner3', 'above_break3')


def zone(x, y, value):
    """lib/zones.js classify, with threes split into corner and above the break. x, y are
    tenths of a foot from the basket; behind the basket only the sideways distance
    counts. A corner three is one from the straight part of the line (|x| ≥ 22 ft,
    within 14 ft of the baseline, i.e. y ≤ 8.75 ft)."""
    if x is None or y is None:
        x, y = 0.0, 0.0
    if value == 3:
        return 'corner3' if abs(x) >= 220 and y <= 87.5 else 'above_break3'
    ft = (abs(x) if y < 0 else math.hypot(x, y)) / 10
    if ft <= RIM_FT:
        return 'rim'
    return 'short_mid' if ft <= SHORT_MID_FT else 'long_mid'


def garbage(period, t, margin):
    if period < 4:
        return False
    m = abs(margin)
    return (m >= 25 and t <= 720) or (m >= 20 and t <= 540) or (m >= 10 and t <= 120)


def home_team(evs, teams):
    """The team whose points move the h_pts column."""
    h = a = 0.0
    for e in evs:
        if e['h'] is None or e['a'] is None:
            continue
        if e['kind'] in ('shot', 'ft') and e.get('made') and e['team'] in teams:
            if e['h'] > h:
                return e['team']
            if e['a'] > a:
                return [t for t in teams if t != e['team']][0]
        h, a = e['h'], e['a']
    return teams[0]


class Game:
    def __init__(self, season, gid, evs, teams):
        self.season, self.gid, self.evs, self.teams = season, gid, evs, teams
        self.home = home_team(evs, teams)
        self.poss, self.shots, self.fts, self.tovs, self.rebs, self.fouls = [], [], [], [], [], []
        self.tech = {t: 0 for t in teams}
        self.score = {t: 0 for t in teams}
        self.stats = {'implicit_switch': 0, 'ghost_rebound': 0}

    def other(self, team):
        return [t for t in self.teams if t != team][0]

    # Possession bookkeeping
    def open(self, team, e, reason):
        d = self.other(team)
        margin = self.score[team] - self.score[d]
        self.cur = {
            'g': self.gid, 'season': self.season, 'period': e['period'], 'start': e['t'], 'end': e['t'],
            'off': team, 'def': d, 'home': int(team == self.home), 'margin': margin,
            'garbage': garbage(e['period'], e['t'], margin), 'excluded': '', 'start_reason': reason,
            'off5': None, 'def5': None, 'pts': 0, 'first_act': None,
        }
        self.poss.append(self.cur)
        self.off = team

    def snapshot(self, e):
        c = self.cur
        if c['off5'] is None and 'on' in e:
            c['off5'], c['def5'] = e['on'].get(c['off']), e['on'].get(c['def'])
        if c['first_act'] is None:
            c['first_act'] = e['t']

    def close(self, e):
        if self.cur is not None:
            self.cur['end'] = e['t']
            if self.cur['off5'] is None and 'on' in e:
                self.cur['off5'], self.cur['def5'] = e['on'].get(self.cur['off']), e['on'].get(self.cur['def'])
            # Nothing happened (the period ran out first): not a possession pbpstats or
            # anyone else counts, and nothing to learn from.
            if self.cur['first_act'] is None and not self.cur['excluded']:
                self.cur['excluded'] = 'empty'
        self.cur, self.off = None, None

    def switch(self, team, e, reason):
        self.close(e)
        self.open(team, e, reason)

    def ensure(self, team, e):
        """The acting team should have the ball; if it doesn't (a jump ball, a missing
        event), start its possession here."""
        if self.off != team:
            if self.off is not None:
                self.stats['implicit_switch'] += 1
                self.switch(team, e, 'implicit')
            else:
                self.switch(team, e, 'start')
                self.cur['start'] = self.period_start  # the period's first possession
        self.snapshot(e)

    def run(self):
        by_period = {}
        for e in self.evs:
            by_period.setdefault(e['period'], []).append(e)
        for period in sorted(by_period):
            self.cur, self.off = None, None
            self.period(by_period[period])
        return self

    def period(self, pe):
        pending = None    # a made field goal that may still get an and-one
        live_miss = None  # a missed shot or last free throw: a rebound chance is open
        last_shot = last_tov = last_foul = None
        self.period_start = pe[0]['t'] if pe[0]['kind'] == 'start' else (720.0 if pe[0]['period'] <= 4 else 300.0)
        for e in pe:
            k, team = e['kind'], e['team']
            if pending is not None:
                same = e['t'] == pending['t']
                and_one = k == 'ft' and team == self.off and same and e.get('ftkind') == 'normal' and e['of'] == 1
                if and_one:
                    pending = None
                elif not (same and k in ('foul', 'sub_in', 'sub_out', 'timeout', 'other', 'violation')):
                    self.switch(self.other(pending['team']), pending, 'made')
                    pending = None
            if k == 'shot' and team in self.teams:
                self.ensure(team, e)
                z = zone(e.get('x'), e.get('y'), e['value'])
                dist = math.hypot(e.get('x') or 0, e.get('y') or 0) / 10
                if dist > 40 and e['t'] <= 3:
                    self.cur['excluded'] = 'heave'
                last_shot = {
                    'poss': len(self.poss) - 1, 'shooter': e['pid'], 'team': team, 'zone': z, 'value': e['value'],
                    'made': bool(e['made']), 'pts': e['value'] if e['made'] else 0, 'assister': e.get('assister'),
                    'blocker': None, 'putback': int(any(w in e['sub'] for w in ('Putback', 'Tip'))),
                    't': e['t'], 'x': e.get('x'), 'y': e.get('y'), 'subtype': e['sub'],
                }
                self.shots.append(last_shot)
                if e['made']:
                    self.cur['pts'] += e['value']
                    self.score[team] += e['value']
                    pending, live_miss = e, None
                else:
                    live_miss = 'fg'
            elif k == 'heave':
                if team in self.teams:
                    self.ensure(team, e)
                if self.cur is not None:
                    self.cur['excluded'] = 'heave'
                live_miss = 'fg'
            elif k == 'ft' and team in self.teams:
                if e['ftkind'] == 'technical':
                    if e['made']:
                        self.tech[team] += 1
                        self.score[team] += 1
                    continue
                self.ensure(team, e)
                trip = self.fts[-1] if (self.fts and self.fts[-1]['open'] and self.fts[-1]['shooter'] == e['pid']
                                        and self.fts[-1]['poss'] == len(self.poss) - 1) else None
                if trip is None:
                    kind = ('and1' if (e['of'] == 1 and last_shot and last_shot['made'] and last_shot['t'] == e['t']
                                       and last_shot['team'] == team)
                            else e['ftkind'] if e['ftkind'] != 'normal'
                            else 'shooting' if last_foul and last_foul['sub'].lower().startswith('shooting')
                            else 'bonus')
                    trip = {'poss': len(self.poss) - 1, 'shooter': e['pid'], 'team': team, 'fta': 0, 'ftm': 0,
                            'kind': kind, 'fouler': last_foul['pid'] if last_foul else None, 'open': True}
                    self.fts.append(trip)
                trip['fta'] += 1
                trip['ftm'] += int(e['made'])
                if e['made']:
                    self.cur['pts'] += 1
                    self.score[team] += 1
                if e['n'] >= e['of']:
                    trip['open'] = False
                    if e['ftkind'] in ('flagrant', 'clear path'):
                        live_miss = None  # the fouled team keeps the ball
                    elif e['made']:
                        self.switch(self.other(team), e, 'ft')
                        live_miss = None
                    else:
                        live_miss = 'ft'
            elif k == 'reb':
                if live_miss is None or team not in self.teams:
                    self.stats['ghost_rebound'] += 1
                    continue
                if self.cur is None:
                    self.open(self.other(team), e, 'start')
                oreb = team == self.off
                self.rebs.append({'poss': len(self.poss) - 1, 'miss': live_miss, 'oreb': int(oreb),
                                  'rebounder': e['pid'], 'team': team})
                live_miss = None
                if not oreb:
                    self.switch(team, e, 'dreb')
            elif k == 'tov' and team in self.teams:
                self.ensure(team, e)
                last_tov = {'poss': len(self.poss) - 1, 'pid': e['pid'], 'team': team, 'sub': e['sub'],
                            'live': 0, 'stealer': None}
                self.tovs.append(last_tov)
                self.switch(self.other(team), e, 'tov')
                live_miss = None
            elif k == 'steal':
                if last_tov is not None and last_tov['team'] != team:
                    last_tov['live'], last_tov['stealer'] = 1, e['pid']
                    if self.cur is not None and self.cur['start_reason'] == 'tov':
                        self.cur['start_reason'] = 'steal'
            elif k == 'block':
                if last_shot is not None and last_shot['team'] != team:
                    last_shot['blocker'] = e['pid']
            elif k == 'foul' and team in self.teams:
                last_foul = e
                if self.cur is not None and team == self.cur['def']:
                    self.fouls.append({'poss': len(self.poss) - 1, 'fouler': e['pid'], 'team': team, 'sub': e['sub']})
                    trailing = self.score[team] < self.score[self.other(team)]
                    if (e['period'] >= 4 and e['t'] <= 120 and trailing
                            and not e['sub'].lower().startswith('shooting')):
                        self.cur['excluded'] = self.cur['excluded'] or 'late_foul'
            elif k == 'end':
                if pending is not None:
                    pending = None
                self.close(e)
        if pending is not None:
            self.close(pending)
