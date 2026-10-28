"""Give every hex a display name: the most populous place inside it.

Usage: uv run 05_name_hexes.py    (needs build/hexes.geojson)
Output: build/names.json, a list of names in hex order. A hex with no place inside it
is named "near X" after the closest place within NEAR_KM of its center, or else
"N km from X". Places come from GeoNames cities1000 (CC BY 4.0).
"""
import io
import json
import math
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).parent
URL = "https://download.geonames.org/export/dump/cities1000.zip"
COUNTRIES = {"US", "PR", "VI", "AS", "GU", "MP", "UM"}
NEAR_KM = 30


def load_places():
    dest = ROOT / "raw" / "geonames" / "cities1000.zip"
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {URL}")
        urllib.request.urlretrieve(URL, dest)
    places = []
    with zipfile.ZipFile(dest) as z, z.open("cities1000.txt") as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if c[8] not in COUNTRIES:
                continue
            region = c[10] if c[8] == "US" else c[8]
            places.append((f"{c[1]}, {region}", int(c[14] or 0), Point(float(c[5]), float(c[4]))))
    return places


def km(a, b):
    lo1, la1, lo2, la2 = map(math.radians, (a.x, a.y, b.x, b.y))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def main():
    hexes = json.loads((ROOT / "build" / "hexes.geojson").read_text())["features"]
    places = load_places()
    tree = STRtree([p[2] for p in places])
    names, near, far = [], 0, 0
    for f in hexes:
        poly = shape(f["geometry"])
        inside = [places[i] for i in tree.query(poly, predicate="contains")]
        if inside:
            names.append(max(inside, key=lambda p: p[1])[0])
            continue
        c = Point(f["properties"]["lon"], f["properties"]["lat"])
        name, _, pt = places[tree.nearest(c)]
        d = km(c, pt)
        if d <= NEAR_KM:
            names.append(f"near {name}")
            near += 1
        else:
            names.append(f"{round(d, -1):.0f} km from {name}")
            far += 1
    (ROOT / "build" / "names.json").write_text(json.dumps(names))
    print(f"named {len(names)} hexes ({near} 'near', {far} 'km from') from {len(places)} places")


if __name__ == "__main__":
    main()
