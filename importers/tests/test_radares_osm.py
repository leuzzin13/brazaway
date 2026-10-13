"""Testes unitários do importador radares_osm (sem PBF, sem rede, sem banco).

  docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_radares_osm -v
"""
from __future__ import annotations
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from sources.radares_osm import bearing, parse_direction, parse_speed, way_bearing_at, way_bearing_towards  # noqa: E402


class Parse(unittest.TestCase):
    def test_speed(self):
        self.assertEqual(parse_speed('60'), 60)
        self.assertEqual(parse_speed('80 km/h'), 80)
        for v in (None, '', 'BR:urban', 'signals', '4', '300', '60 mph'):
            self.assertIsNone(parse_speed(v), v)

    def test_direction(self):
        self.assertEqual(parse_direction('325'), (325.0, 'deg'))
        self.assertEqual(parse_direction('SE'), (135.0, 'deg'))
        self.assertEqual(parse_direction('north'), (0.0, 'deg'))
        self.assertEqual(parse_direction('360'), (0.0, 'deg'))
        self.assertEqual(parse_direction('forward'), (None, 'forward'))
        self.assertEqual(parse_direction('backward'), (None, 'backward'))
        self.assertEqual(parse_direction('both'), (None, 'both'))
        self.assertEqual(parse_direction('abc'), (None, 'none'))
        self.assertEqual(parse_direction('400'), (None, 'none'))
        self.assertEqual(parse_direction(None), (None, 'none'))


class Geometry(unittest.TestCase):
    def test_bearing_cardinals(self):
        o = (-46.0, -23.0)
        self.assertAlmostEqual(bearing(o, (-46.0, -22.9)), 0, delta=0.5)
        self.assertAlmostEqual(bearing(o, (-45.9, -23.0)), 90, delta=0.5)
        self.assertAlmostEqual(bearing(o, (-46.0, -23.1)), 180, delta=0.5)
        self.assertAlmostEqual(bearing(o, (-46.1, -23.0)), 270, delta=0.5)

    def test_way_bearing_at(self):
        coords = [(-46.0, -23.0), (-45.99, -23.0), (-45.98, -23.0)]
        self.assertAlmostEqual(way_bearing_at(coords, 1), 90, delta=0.5)
        self.assertAlmostEqual(way_bearing_at(coords, 0), 90, delta=0.5)

    def test_from_way_towards_device(self):
        # via leste-oeste; device na ponta leste: tráfego vai para leste (90)
        coords = [(-46.0, -23.0), (-45.99, -23.0), (-45.98, -23.0)]
        self.assertAlmostEqual(way_bearing_towards(coords, (-45.98, -23.0)), 90, delta=0.5)
        # device na ponta oeste: a via é percorrida ao contrário (270)
        self.assertAlmostEqual(way_bearing_towards(coords, (-46.0, -23.0)), 270, delta=0.5)


if __name__ == '__main__':
    unittest.main()
