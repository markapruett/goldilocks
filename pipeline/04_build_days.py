"""Turn ERA5 grids into daily per-hex values.

Usage: uv run 04_build_days.py    (needs build/hexes.geojson, raw/era5/us/*.nc)
Uses every year for which all fields from 02 are downloaded, so it can run on a
partial download. Output: build/days.npz with float32 [hex, day] arrays
feels_high, feels_low, dewpt (°F) and sun (0–1), plus `dates` (ISO strings).

Values are computed per grid cell, then averaged over the land cells whose centers
fall inside the hex (see hex_cells for coastal and island fallbacks).
"""
import json
import time
from datetime import date, timedelta
from importlib import import_module
from pathlib import Path

import numpy as np
import xarray as xr
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely import points

from feelslike import feels_high, feels_low

ROOT = Path(__file__).parent
fetch = import_module("02_fetch_era5")
ERA5 = fetch.OUT
COAST_DEG = 0.3  # ~30 km: how far a coastal hex may reach for a land cell


def k_to_f(k):
    return (k - 273.15) * 9 / 5 + 32


def complete_years():
    return sorted(y for y in fetch.YEARS if all((ERA5 / f"{y}_{f}.nc").exists() for f in fetch.FIELDS))


def hex_cells(hexes, lat, lon):
    """Per hex, the flat grid indices of the cells to average.

    Only cells centered on US land count, so coastal hexes aren't cooled (or warmed)
    by the ocean. A hex with no land cell inside takes the nearest land cell within
    COAST_DEG of its center, and failing that, every cell inside it.
    """
    glon, glat = np.meshgrid(lon, lat)
    flat_lat, flat_lon = glat.ravel(), glon.ravel()
    tree = STRtree(points(flat_lon, flat_lat))
    inside = [tree.query(shape(f["geometry"]), predicate="contains") for f in hexes]

    # Land test only for cells near a hex, against the county outlines from step 03.
    _, counties = import_module("03_fetch_aqi").load_counties()
    near = np.unique(np.concatenate(inside + [tree.query(shape(f["geometry"]).buffer(COAST_DEG)) for f in hexes]))
    pt_idx, _ = STRtree(counties).query(points(flat_lon[near], flat_lat[near]), predicate="within")
    land = np.zeros(flat_lat.size, dtype=bool)
    land[near[pt_idx]] = True
    land_idx = np.flatnonzero(land)

    cells, stats = [], {"land": 0, "nearby land": 0, "all cells": 0}
    for f, ins in zip(hexes, inside):
        on_land = ins[land[ins]]
        if len(on_land):
            cells.append(on_land)
            stats["land"] += 1
            continue
        p = f["properties"]
        d2 = (flat_lat[land_idx] - p["lat"]) ** 2 + ((flat_lon[land_idx] - p["lon"]) * np.cos(np.radians(p["lat"]))) ** 2
        if len(land_idx) and d2.min() <= COAST_DEG ** 2:
            cells.append(land_idx[[int(d2.argmin())]])
            stats["nearby land"] += 1
        else:
            cells.append(ins if len(ins) else np.array([int(np.argmin((flat_lat - p["lat"]) ** 2 + (flat_lon - p["lon"]) ** 2))]))
            stats["all cells"] += 1
    print("hexes averaged over: " + ", ".join(f"{v} {k}" for k, v in stats.items()))
    return cells


def load(year, field, flat):
    """Daily values for the selected flat cell indices: [cell, day]."""
    with xr.open_dataset(ERA5 / f"{year}_{field}.nc") as ds:
        a = ds[next(iter(ds.data_vars))].values
    return a.reshape(a.shape[0], -1)[:, flat].T


def main():
    years = complete_years()
    if not years:
        raise SystemExit("no complete ERA5 year downloaded yet")
    print(f"years: {years}")
    hexes = json.loads((ROOT / "build" / "hexes.geojson").read_text())["features"]

    with xr.open_dataset(ERA5 / f"{years[0]}_tmax.nc") as ds:
        lat, lon = ds.latitude.values, ds.longitude.values
    cells = hex_cells(hexes, lat, lon)
    print(f"cells per hex: min {min(map(len, cells))}, median {int(np.median(list(map(len, cells))))}, "
          f"max {max(map(len, cells))}; {sum(len(c) == 1 for c in cells)} hexes use a single cell")

    # Average over each hex's cells with reduceat over a hex-sorted flat index.
    flat = np.concatenate(cells)
    starts = np.concatenate([[0], np.cumsum([len(c) for c in cells])[:-1]])
    counts = np.array([len(c) for c in cells], dtype=np.float32)[:, None]
    per_hex = lambda v: np.add.reduceat(v, starts, axis=0) / counts

    out = {k: [] for k in ("feels_high", "feels_low", "dewpt", "sun")}
    dates = []
    for y in years:
        t = time.time()
        v = {f: load(y, f, flat) for f in fetch.FIELDS}
        tmax, tmin, dewpt = k_to_f(v["tmax"]), k_to_f(v["tmin"]), k_to_f(v["dewpt"])
        mph = np.hypot(v["u10"], v["v10"]) * 2.23694
        # Polar night: no clear-sky sun to speak of, so count it as no sun.
        sun = np.where(v["ssrdc"] > 1e3, np.clip(v["ssrd"] / np.maximum(v["ssrdc"], 1e3), 0, 1), 0)
        out["feels_high"].append(per_hex(feels_high(tmax, dewpt)))
        out["feels_low"].append(per_hex(feels_low(tmin, mph)))
        out["dewpt"].append(per_hex(dewpt))
        out["sun"].append(per_hex(sun))
        n = v["tmax"].shape[1]
        dates += [(date(y, 1, 1) + timedelta(d)).isoformat() for d in range(n)]
        print(f"{y}: {n} days in {time.time() - t:.0f}s")

    arrays = {k: np.concatenate(v, axis=1).astype(np.float32) for k, v in out.items()}
    np.savez_compressed(ROOT / "build" / "days.npz", dates=np.array(dates), **arrays)
    print(f"wrote build/days.npz: {arrays['sun'].shape[0]} hexes × {arrays['sun'].shape[1]} days")


if __name__ == "__main__":
    main()
