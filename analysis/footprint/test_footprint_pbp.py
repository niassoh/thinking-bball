"""Unit tests for footprint_pbp.py's counts on a hand-made game: rim free throws, rebounds
as pbpstats counts them, and each player's own counts per lineup.

  python3 -m unittest discover analysis/footprint
"""
import os
import sys
import unittest

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from footprint_pbp import FIELDS, OWN, own_rows, rebounds, runouts, team_docs, zone_fts  # noqa: E402

A = ('a1', 'a2', 'a3', 'a4', 'a5')
B = ('b1', 'b2', 'b3', 'b4', 'b5')


def game():
    """Six possessions, A on offense in the even ones:
    0  a1 makes a layup, and-one made (a rim and-one)
    1  b1 is fouled on a two, makes both (a two-shot trip)
    2  a2 makes a three, and-one made (not a rim and-one)
    3  b2 makes two bonus free throws (not a shooting foul)
    4  a3 misses; team offensive rebound as the period ends (dropped)
    5  a4 misses; team offensive rebound mid-period (kept), a5 then scores at the rim
    """
    poss = pd.DataFrame({
        'id': range(6), 'g': 'G', 'off': ['A', 'B', 'A', 'B', 'A', 'A'], 'def': ['B', 'A', 'B', 'A', 'B', 'B'],
        'off5': [A, B, A, B, A, A], 'def5': [B, A, B, A, B, B], 'pts': [3, 2, 4, 2, 0, 2],
        'end': [700.0, 690.0, 680.0, 670.0, 0.0, 600.0]})
    # None of them a runout: each begins 10 s before it ends, after a rebound.
    poss = poss.assign(start=poss['end'] + 10, start_reason='dreb', first_act=poss['end'])
    shots = pd.DataFrame({
        'poss': [0, 2, 4, 5, 5], 'shooter': ['a1', 'a2', 'a3', 'a4', 'a5'], 'team': 'A',
        'zone': ['rim', 'above_break3', 'short_mid', 'long_mid', 'rim'], 'value': [2, 3, 2, 2, 2],
        'made': [True, True, False, False, True], 'pts': [2, 3, 0, 0, 2], 'assister': None, 'blocker': None,
        't': [705.0, 685.0, 1.0, 610.0, 605.0], 'x': [0.0, 0.0, 0.0, 0.0, 5.0], 'y': [10.0, 250.0, 80.0, 180.0, 10.0]})
    fts = pd.DataFrame({
        'poss': [0, 1, 2, 3], 'shooter': ['a1', 'b1', 'a2', 'b2'], 'team': ['A', 'B', 'A', 'B'],
        'fta': [1, 2, 1, 2], 'ftm': [1, 2, 1, 2], 'kind': ['and1', 'shooting', 'and1', 'bonus']})
    rebs = pd.DataFrame({'poss': [4, 5], 'miss': 'fg', 'oreb': [1, 1], 'rebounder': ['', ''], 'team': 'A'})
    return {
        'possessions': poss, 'shots': shots, 'fts': fts, 'rebs': rebs,
        'tovs': pd.DataFrame({'poss': pd.Series(dtype='int64'), 'pid': pd.Series(dtype='str'), 'team': pd.Series(dtype='str'),
                              'sub': pd.Series(dtype='str'), 'live': pd.Series(dtype='int64'), 'stealer': pd.Series(dtype='str')}),
        'fouls': pd.DataFrame({'poss': pd.Series(dtype='int64'), 'fouler': pd.Series(dtype='str'), 'team': pd.Series(dtype='str'),
                               'sub': pd.Series(dtype='str')}),
        'stints': pd.DataFrame({'g': ['G'], 'team_a': ['A'], 'a': [A], 'team_b': ['B'], 'b': [B], 'seconds': [720.0]}),
        'date': {'G': '2025-01-01'},
    }


class ZoneFreeThrows(unittest.TestCase):
    def test_and_ones_go_with_their_make_and_two_shot_trips_are_split(self):
        rim, paint, (tied, and1s), league = zone_fts(game())
        # a1's and-one after a layup is the rim's; a2's after a three, and b2's bonus, neither's.
        # The game's only fouled two we can place is a1's, at the rim, so the league's split is
        # all rim, and b1's two-shot trip (no and-ones of his own) goes to the rim whole.
        self.assertEqual(rim.tolist(), [1, 2, 0, 0])
        self.assertEqual(paint.tolist(), [0, 0, 0, 0])
        self.assertEqual((tied, and1s), (2, 2))
        self.assertEqual(league['rim'], 1.0)

    def test_a_shooters_own_and_ones_split_his_fouled_misses(self):
        g = game()
        # b1 had two and-ones on 8 ft floaters before: his split leans to paint extended.
        g['possessions'] = pd.concat([g['possessions'], pd.DataFrame({
            'id': [6, 7], 'g': 'G', 'off': 'B', 'def': 'A', 'off5': [B, B], 'def5': [A, A], 'pts': [3, 3], 'end': [500.0, 490.0]})], ignore_index=True)
        g['shots'] = pd.concat([g['shots'], pd.DataFrame({
            'poss': [6, 7], 'shooter': 'b1', 'team': 'B', 'zone': 'short_mid', 'value': 2, 'made': True, 'pts': 2,
            'assister': None, 'blocker': None, 't': [505.0, 495.0], 'x': 0.0, 'y': 80.0})], ignore_index=True)
        g['fts'] = pd.concat([g['fts'], pd.DataFrame({
            'poss': [6, 7], 'shooter': 'b1', 'team': 'B', 'fta': 1, 'ftm': 1, 'kind': 'and1'})], ignore_index=True)
        rim, paint, _, league = zone_fts(g)
        # League: 1 rim and-one, 2 paint. b1: (0 + 10/3) rim and (2 + 20/3) paint over 12.
        self.assertAlmostEqual(league['paint'], 2 / 3, places=3)
        self.assertAlmostEqual(rim[1], 2 * (10 / 3) / 12, places=6)
        self.assertAlmostEqual(paint[1], 2 * (2 + 20 / 3) / 12, places=6)
        self.assertEqual(paint.tolist()[4:], [1, 1])


class Runouts(unittest.TestCase):
    def runout_game(self):
        # Two more possessions after steals: b3's layup 3 s in (a runout), b4's 8 s in (not).
        g = game()
        g['possessions'] = pd.concat([g['possessions'], pd.DataFrame({
            'id': [6, 7], 'g': 'G', 'off': 'B', 'def': 'A', 'off5': [B, B], 'def5': [A, A], 'pts': [2, 2],
            'end': [497.0, 482.0], 'start': [500.0, 490.0], 'start_reason': 'steal', 'first_act': [497.0, 482.0]})], ignore_index=True)
        g['shots'] = pd.concat([g['shots'], pd.DataFrame({
            'poss': [6, 7], 'shooter': ['b3', 'b4'], 'team': 'B', 'zone': 'rim', 'value': 2, 'made': True, 'pts': 2,
            'assister': None, 'blocker': None, 't': [497.0, 482.0], 'x': 0.0, 'y': 10.0})], ignore_index=True)
        return g

    def test_a_steal_and_a_shot_within_six_seconds(self):
        self.assertEqual(runouts(self.runout_game()), {6})

    def test_counted_against_the_defense(self):
        docs, _ = team_docs('2024-25', self.runout_game())
        a = docs['A']['chunks'][0]['lineups'][0]
        self.assertEqual(a['o'][FIELDS.index('RunoutPoss')], 1)
        self.assertEqual(a['o'][FIELDS.index('RunoutRimFGM')], 1)
        self.assertEqual(a['o'][FIELDS.index('RimFGM')], 2)


class Rebounds(unittest.TestCase):
    def test_end_of_period_team_rebound_dropped(self):
        self.assertEqual(rebounds(game())['poss'].tolist(), [5])


class OwnCounts(unittest.TestCase):
    def setUp(self):
        docs, _ = team_docs('2024-25', game())
        self.a = docs['A']['chunks'][0]['lineups'][0]
        self.b = docs['B']['chunks'][0]['lineups'][0]
        self.own = docs['A']['own']

    def test_fields(self):
        self.assertEqual(self.own, OWN)
        self.assertEqual(self.a['t'][FIELDS.index('RimFTM')], 1)
        self.assertEqual(self.a['o'][FIELDS.index('RimFTM')], 2)
        # a1's layup and a5's putback are under 5 ft; a3's 8 ft miss is paint extended.
        self.assertEqual(self.a['t'][FIELDS.index('RimFGA')], 2)
        self.assertEqual(self.a['t'][FIELDS.index('PaintFGA')], 1)
        self.assertEqual(self.a['t'][FIELDS.index('OffRebounds')], 1)

    def test_rows_follow_ids(self):
        a1 = self.a['p'][self.a['ids'].index('a1')]
        # a1: 3 points, a made two of one attempt, no threes or free throws besides the and-one, a rim make, a rim FT.
        self.assertEqual(a1, [3, 1, 1, 0, 0, 1, 1, 1])
        self.assertEqual(self.a['p'][self.a['ids'].index('a2')], [4, 0, 0, 1, 1, 1])

    def test_own_adds_up_to_team(self):
        for l in (self.a, self.b):
            rows = [r or [] for r in l['p']]
            for i, name in enumerate(OWN):
                self.assertEqual(sum(r[i] if i < len(r) else 0 for r in rows), l['t'][FIELDS.index(name)], name)

    def test_compact_rows(self):
        self.assertEqual(own_rows([[1, 0, 0], [0, 0, 0], [0, 2, 0]]), [[1], 0, [0, 2]])
        self.assertIsNone(own_rows([[0, 0], [0, 0]]))


if __name__ == '__main__':
    unittest.main()
