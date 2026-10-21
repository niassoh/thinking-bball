"""Unit tests for the play-by-play rebuild (lineups and possessions) on hand-made events.

  python3 -m unittest discover analysis/footprint
"""
import os
import sys
import unittest
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from lineups import Names, annotate, _keys  # noqa: E402
from possessions import Game, garbage, zone  # noqa: E402

A = ['a1', 'a2', 'a3', 'a4', 'a5']
B = ['b1', 'b2', 'b3', 'b4', 'b5']


def ev(kind, team, pid, t, period=1, **kw):
    e = {'g': 'G', 'period': period, 't': t, 'kind': kind, 'team': team, 'pid': pid,
         'name': f'X. {pid}' if pid else '', 'sub': kw.pop('sub', ''), 'desc': kw.pop('desc', ''),
         'h': kw.pop('h', None), 'a': kw.pop('a', None)}
    e.update(kw)
    return e


def opening():
    """Period start with every player acting once, so all ten are starters."""
    evs = [ev('start', '', '', 720.0)]
    for i, p in enumerate(A):
        evs.append(ev('foul', 'A', p, 719.0 - i, sub='Personal'))
    for i, p in enumerate(B):
        evs.append(ev('foul', 'B', p, 714.0 - i, sub='Personal'))
    return evs


def shot(team, pid, t, made, value=2, x=0.0, y=10.0, **kw):
    return ev('shot', team, pid, t, made=made, value=value, x=x, y=y, **kw)


def ft(team, pid, t, made, n, of, ftkind='normal'):
    return ev('ft', team, pid, t, made=made, n=n, of=of, ftkind=ftkind)


def run(evs):
    names = Names({'A': {p: f'X. {p}' for p in A + ['a6']}, 'B': {p: f'X. {p}' for p in B + ['b6']}}, {})
    stats = defaultdict(int)
    teams, floor, _ = annotate(evs, names, stats)
    return Game('2025-26', 'G', evs, teams).run(), floor, stats


class Zones(unittest.TestCase):
    def test_zones_match_the_site(self):
        self.assertEqual(zone(0, 50, 2), 'rim')             # 5 ft
        self.assertEqual(zone(0, 120, 2), 'short_mid')      # 12 ft
        self.assertEqual(zone(0, 180, 2), 'long_mid')       # 18 ft
        self.assertEqual(zone(80, -20, 2), 'short_mid')       # behind the basket: 8 ft sideways
        self.assertEqual(zone(-228, 16, 3), 'corner3')
        self.assertEqual(zone(-179, 179, 3), 'above_break3')

    def test_garbage_tiers(self):
        self.assertFalse(garbage(3, 100, 30))
        self.assertTrue(garbage(4, 700, 26))
        self.assertFalse(garbage(4, 700, 22))
        self.assertTrue(garbage(4, 500, 22))
        self.assertTrue(garbage(4, 100, 11))
        self.assertFalse(garbage(4, 130, 11))


class Names_(unittest.TestCase):
    def test_spellings(self):
        self.assertIn('poeltl', _keys('Pöltl'))
        self.assertIn('jemison', _keys('Jemison III'))
        self.assertIn('doncic', _keys('Dončić'))

    def test_exact_before_variants_and_prefix(self):
        roster = {'1': 'J. Smith', '2': 'J. Smith Jr.', '3': 'J. Williams', '4': 'J. Williams'}
        names = Names({}, {'3': 'Jalen Williams', '4': 'Jaylin Williams'})
        self.assertEqual(names.candidates('T', 'Smith', roster), ['1'])
        self.assertEqual(names.candidates('T', 'Jay. Williams', roster), ['4'])
        self.assertEqual(names.resolve('T', 'Williams', roster, {'3'}, []), '4')  # the one not on the floor


class Lineups(unittest.TestCase):
    def test_starters_and_substitution(self):
        evs = opening() + [ev('sub_out', 'A', 'a5', 600.0, incoming='a6'), shot('A', 'a6', 590.0, True),
                           ev('end', '', '', 0.0)]
        g, floor, stats = run(evs)
        self.assertEqual(stats['period_short'], 0)
        self.assertEqual(evs[-2]['on']['A'], ('a1', 'a2', 'a3', 'a4', 'a6'))
        self.assertAlmostEqual(floor[('A', 'a5')], 120.0)
        self.assertAlmostEqual(floor[('A', 'a6')], 600.0)


class Possessions(unittest.TestCase):
    def poss(self, *plays):
        g, _, _ = run(opening() + list(plays) + [ev('end', '', '', 0.0)])
        return g, [p for p in g.poss if p['excluded'] != 'empty']

    def test_made_shot_dreb_turnover(self):
        g, ps = self.poss(shot('A', 'a1', 700, True),                 # A: 2 pts
                          shot('B', 'b1', 690, False), ev('reb', 'A', 'a2', 688),  # B: miss, A rebound
                          ev('tov', 'A', 'a3', 680), ev('steal', 'B', 'b2', 680),  # A: live turnover
                          shot('B', 'b3', 676, True, value=3, x=-228, y=16))      # B: corner three
        self.assertEqual([(p['off'], p['pts']) for p in ps], [('A', 2), ('B', 0), ('A', 0), ('B', 3)])
        self.assertEqual(ps[3]['start_reason'], 'steal')
        self.assertEqual(g.tovs[0]['live'], 1)
        self.assertEqual(g.shots[-1]['zone'], 'corner3')
        self.assertEqual(g.rebs[0]['oreb'], 0)

    def test_and_one_stays_one_possession(self):
        g, ps = self.poss(shot('A', 'a1', 700, True), ev('foul', 'B', 'b1', 700, sub='Shooting'),
                          ft('A', 'a1', 700, True, 1, 1), shot('B', 'b1', 690, True))
        self.assertEqual([(p['off'], p['pts']) for p in ps], [('A', 3), ('B', 2)])
        self.assertEqual(g.fts[0]['kind'], 'and1')

    def test_offensive_rebound_continues_and_ft_trip_ends(self):
        g, ps = self.poss(shot('A', 'a1', 700, False), ev('reb', 'A', 'a2', 698),
                          ev('foul', 'B', 'b1', 695, sub='Shooting'),
                          ft('A', 'a2', 695, False, 1, 2), ev('reb', 'A', '', 695),  # dead-ball team rebound
                          ft('A', 'a2', 695, True, 2, 2), shot('B', 'b1', 680, True))
        self.assertEqual([(p['off'], p['pts']) for p in ps], [('A', 1), ('B', 2)])
        self.assertEqual(sum(r['oreb'] for r in g.rebs), 1)
        self.assertEqual(g.stats['ghost_rebound'], 1)
        self.assertEqual(g.fts[0]['kind'], 'shooting')

    def test_flagrant_keeps_ball_and_technical_is_outside(self):
        g, ps = self.poss(ev('foul', 'B', 'b1', 700, sub='Flagrant Type 1'),
                          ft('A', 'a1', 700, True, 1, 2, 'flagrant'), ft('A', 'a1', 700, True, 2, 2, 'flagrant'),
                          ft('B', 'b2', 699, True, 1, 1, 'technical'),
                          shot('A', 'a3', 690, True), shot('B', 'b1', 680, True))
        self.assertEqual([(p['off'], p['pts']) for p in ps], [('A', 4), ('B', 2)])
        self.assertEqual(g.tech['B'], 1)

    def test_lineup_is_the_floor_at_the_first_action(self):
        g, ps = self.poss(shot('A', 'a1', 700, True), ev('sub_out', 'B', 'b5', 700, incoming='b6'),
                          shot('B', 'b1', 690, True))
        self.assertEqual(ps[1]['off5'], ('b1', 'b2', 'b3', 'b4', 'b6'))

    def test_empty_possession_is_excluded(self):
        g, _ = self.poss(shot('A', 'a1', 1.0, True))
        self.assertEqual(g.poss[-1]['excluded'], 'empty')


if __name__ == '__main__':
    unittest.main()
