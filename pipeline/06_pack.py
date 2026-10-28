"""Pack the build outputs into the files the web app loads.

Usage: uv run 06_pack.py    (needs build/hexes.geojson, days.npz, aqi.npz, names.json)
Writes to ../data/:
  hexes.geojson  geometry + {i, name, aqKm} per hex (i = row in days.bin)
  days.bin       4 uint8 planes, each [hex][day] row-major:
                   0 feels-like high °F + OFFSET
                   1 feels-like low  °F + OFFSET
                   2 dew point       °F + OFFSET
                   3 sun (high nibble, 0–15 = 0–100%) | AQI bucket (low nibble)
  meta.json      dates, encodings and AQI bucket edges
"""
import json
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent
BUILD, DATA = ROOT / "build", ROOT.parent / "data"
OFFSET = 60
SUN_STEPS = 15
AQI_EDGES = [50, 75, 100, 150, 200]  # bucket k holds AQI <= AQI_EDGES[k]; 5 = above 200
AQI_UNKNOWN = 15


def temp_byte(f):
    return np.clip(np.round(f) + OFFSET, 0, 255).astype(np.uint8)


def round_coords(geom):
    return {"type": geom["type"],
            "coordinates": [[[round(x, 4), round(y, 4)] for x, y in ring] for ring in geom["coordinates"]]}


def main():
    hexes = json.loads((BUILD / "hexes.geojson").read_text())["features"]
    names = json.loads((BUILD / "names.json").read_text())
    days = np.load(BUILD / "days.npz")
    aq = np.load(BUILD / "aqi.npz")

    dates = [date.fromisoformat(d) for d in days["dates"]]
    if any((b - a).days != 1 for a, b in zip(dates, dates[1:])):
        raise SystemExit("days.npz dates are not contiguous; download the missing years first")
    first = (dates[0] - date(2016, 1, 1)).days
    aqi = aq["aqi"][:, first:first + len(dates)]

    bucket = np.searchsorted(AQI_EDGES, aqi, side="left").astype(np.uint8)
    bucket[aqi < 0] = AQI_UNKNOWN
    sun = np.clip(np.round(days["sun"] * SUN_STEPS), 0, SUN_STEPS).astype(np.uint8)
    planes = np.stack([
        temp_byte(days["feels_high"]),
        temp_byte(days["feels_low"]),
        temp_byte(days["dewpt"]),
        (sun << 4) | bucket,
    ])
    (DATA / "days.bin").write_bytes(planes.tobytes())

    features = []
    for i, (f, name) in enumerate(zip(hexes, names)):
        km = aq["dist_km"][i]
        features.append({"type": "Feature", "geometry": round_coords(f["geometry"]),
                         "properties": {"i": i, "name": name, "aqKm": None if np.isnan(km) else round(float(km))}})
    (DATA / "hexes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                                   separators=(",", ":")))

    meta = {
        "start": dates[0].isoformat(), "days": len(dates), "hexes": len(hexes),
        "years": sorted({d.year for d in dates}),
        "planes": ["feelsHigh", "feelsLow", "dewPoint", "sunAqi"],
        "tempOffset": OFFSET, "sunSteps": SUN_STEPS, "aqiEdges": AQI_EDGES, "aqiUnknown": AQI_UNKNOWN,
        "sources": "ERA5 daily statistics (Copernicus CDS), EPA AirData daily AQI, GeoNames",
    }
    (DATA / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote data/days.bin ({planes.nbytes / 1e6:.1f} MB), hexes.geojson, meta.json "
          f"for {len(hexes)} hexes × {len(dates)} days ({meta['years']})")


if __name__ == "__main__":
    main()
