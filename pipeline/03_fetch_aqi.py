"""Fetch EPA daily county AQI and assign a daily AQI to every hex.

Usage: uv run 03_fetch_aqi.py    (needs build/hexes.geojson from 01)
Output: build/aqi.npz with
  aqi      int16 [hex, day], -1 where unknown
  source   int32 [hex], FIPS of the county that supplied most of the hex's days (0 = none)
  dist_km  float32 [hex], distance to that county (0 = hex center is inside it)
Each day a hex takes the AQI of the county containing its center, or else the
nearest county within MAX_KM that reported that day. County polygons are the 2020
Census cartographic boundaries, which still have the legacy Connecticut counties
that EPA uses.
"""
import csv
import io
import json
import math
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import shapefile
from shapely.geometry import Point, shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
YEARS = range(2016, 2026)
START, DAYS = date(2016, 1, 1), (date(2026, 1, 1) - date(2016, 1, 1)).days
MAX_KM = 75
EPA_URL = "https://aqs.epa.gov/aqsweb/airdata/daily_aqi_by_county_{}.zip"
COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip"


def download(url, dest):
    if not dest.exists():
        print(f"downloading {url}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(dest)
    return dest


def km(a, b):
    """Great-circle distance between two shapely points (lon, lat)."""
    lo1, la1, lo2, la2 = map(math.radians, (a.x, a.y, b.x, b.y))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def load_counties():
    z = zipfile.ZipFile(download(COUNTY_URL, RAW / "census" / "cb_2020_us_county_500k.zip"))
    base = "cb_2020_us_county_500k"
    r = shapefile.Reader(**{ext: io.BytesIO(z.read(f"{base}.{ext}")) for ext in ("shp", "shx", "dbf")})
    fips = [int(rec["GEOID"]) for rec in r.records()]
    return fips, [shape(s.__geo_interface__) for s in r.shapes()]


def load_aqi(fips_index):
    """County × day matrix of AQI, NaN where the county didn't report."""
    a = np.full((len(fips_index), DAYS), np.nan, dtype=np.float32)
    skipped = set()
    for y in YEARS:
        z = zipfile.ZipFile(download(EPA_URL.format(y), RAW / "epa" / f"daily_aqi_by_county_{y}.zip"))
        with z.open(f"daily_aqi_by_county_{y}.csv") as f:
            for row in csv.DictReader(io.TextIOWrapper(f)):
                code = row["State Code"] + row["County Code"]
                i = fips_index.get(int(code)) if code.isdigit() else None
                if i is None:
                    skipped.add(f'{row["State Name"]}/{row["county Name"]}')
                    continue
                a[i, (date.fromisoformat(row["Date"]) - START).days] = int(row["AQI"])
    print(f"EPA counties not matched to a 2020 county (dropped): {sorted(skipped)}")
    return a


def main():
    hexes = json.loads((ROOT / "build" / "hexes.geojson").read_text())["features"]
    fips, polys = load_counties()
    aqi = load_aqi({f: i for i, f in enumerate(fips)})
    reporting = np.flatnonzero(~np.isnan(aqi).all(axis=1))
    tree = STRtree([polys[i] for i in reporting])
    deg = MAX_KM / 111 * 1.5  # generous search radius in degrees, filtered by km below

    out = np.full((len(hexes), DAYS), -1, dtype=np.int16)
    source = np.zeros(len(hexes), dtype=np.int32)
    dist = np.full(len(hexes), np.nan, dtype=np.float32)
    for h, f in enumerate(hexes):
        p = Point(f["properties"]["lon"], f["properties"]["lat"])
        lat_scale = max(math.cos(math.radians(p.y)), 0.2)
        near = []
        for j in tree.query(p.buffer(deg / lat_scale)):
            c = reporting[j]
            d = 0.0 if polys[c].contains(p) else km(p, nearest_points(p, polys[c])[1])
            if d <= MAX_KM:
                near.append((d, c))
        near.sort()
        used = np.zeros(len(near), dtype=int)
        for k, (d, c) in enumerate(near):
            fill = (out[h] < 0) & ~np.isnan(aqi[c])
            out[h, fill] = aqi[c, fill]
            used[k] = fill.sum()
        if near and used.max() > 0:
            d, c = near[int(used.argmax())]
            source[h], dist[h] = fips[c], d

    known = (out >= 0).mean(axis=1)
    print(f"hexes with any AQ data: {(known > 0).mean():.0%}; "
          f"with ≥ 80% of days known: {(known >= .8).mean():.0%}; overall days known: {known.mean():.0%}")
    np.savez_compressed(ROOT / "build" / "aqi.npz", aqi=out, source=source, dist_km=dist)
    print("wrote build/aqi.npz")


if __name__ == "__main__":
    main()
