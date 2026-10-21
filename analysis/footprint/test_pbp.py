"""Unit tests for the archive reader's event fixes.

  python3 -m unittest discover analysis/footprint
"""
import gzip
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import pbp  # noqa: E402
from pbp import era_codes  # noqa: E402


def ev(team, pid):
    return {'team': team, 'pid': pid}


class EraCodes(unittest.TestCase):
    def test_team_rows_take_the_code_of_the_day(self):
        # 2009-10 Nets at Hornets: team rows came out as BKN and NOP by id.
        evs = era_codes([ev('NJN', '1'), ev('NOH', '2'), ev('BKN', ''), ev('NOP', ''), ev('', '')])
        self.assertEqual([e['team'] for e in evs], ['NJN', 'NOH', 'NJN', 'NOH', ''])

    def test_the_charlotte_hornets_id(self):
        evs = era_codes([ev('CHH', '1'), ev('VAN', '2'), ev('NOP', ''), ev('MEM', '')])
        self.assertEqual([e['team'] for e in evs], ['CHH', 'VAN', 'CHH', 'VAN'])

    def test_todays_codes_stay(self):
        evs = era_codes([ev('BKN', '1'), ev('OKC', '2'), ev('BKN', ''), ev('OKC', '')])
        self.assertEqual([e['team'] for e in evs], ['BKN', 'OKC', 'BKN', 'OKC'])


class OwnFiles(unittest.TestCase):
    def test_our_fetch_reads_in_clock_order_with_the_score_carried(self):
        # scripts/pbp-fetch.js's shape, its actions out of clock order; NBA.com leaves the
        # score blank on rows that don't score, and names a team rebound's team by its id.
        fields = ['actionNumber', 'period', 'clock', 'scoreHome', 'scoreAway', 'teamTricode', 'personId', 'playerNameI',
                  'actionType', 'subType', 'shotResult', 'xLegacy', 'yLegacy', 'shotDistance', 'description']
        actions = [[9, 1, 'PT11M20.00S', '', '', '', 1610612738, '', 'Rebound', '', '', 0, 0, 0, 'Celtics Rebound'],
                   [5, 1, 'PT11M40.00S', '2', '0', 'DET', 1631105, 'J. Duren', 'Made Shot', 'DUNK', 'Made', 0, 5, 1, "Duren 1' Dunk (2 PTS)"],
                   [7, 1, 'PT11M30.00S', '', '', 'BOS', 1629011, 'M. Robinson', 'Missed Shot', 'Jump Shot', 'Missed', 100, 200, 22, "MISS Robinson 22' Jump Shot"]]
        with tempfile.TemporaryDirectory() as d, mock.patch.object(pbp, 'OWN', d):
            os.makedirs(os.path.join(d, '2026-27'))
            with gzip.open(os.path.join(d, '2026-27', '0022600001.json.gz'), 'wt', encoding='utf-8') as f:
                json.dump({'gameId': '0022600001', 'starters': [], 'fields': fields, 'actions': actions}, f)
            [(gid, evs)] = list(pbp.games('2026-27'))
        self.assertEqual(gid, '0022600001')
        self.assertEqual([(e['kind'], e['t']) for e in evs], [('shot', 700), ('shot', 690), ('reb', 680)])
        self.assertEqual([(e['h'], e['a']) for e in evs], [(2, 0), (2, 0), (2, 0)])
        self.assertEqual((evs[2]['team'], evs[2]['pid']), ('BOS', ''))


if __name__ == '__main__':
    unittest.main()
