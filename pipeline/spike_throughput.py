"""Phase 0 spike: time full-year ERA5 daily-stat requests, with radiation split out.

Usage: uv run spike_throughput.py [YEAR]
Runs requests one at a time and logs queue wait / run time / size for each.
"""
import sys
import time
from pathlib import Path

import cdsapi

from spike_era5 import CONUS, DATASET, TZ

GROUPS = {
    "tmax": ("daily_maximum", ["2m_temperature"]),
    "dew_wind": ("daily_mean", ["2m_dewpoint_temperature", "10m_u_component_of_wind", "10m_v_component_of_wind"]),
    "solar": ("daily_mean", ["surface_solar_radiation_downwards", "surface_solar_radiation_downward_clear_sky"]),
}


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2023
    raw = Path(__file__).parent / "raw" / "era5"
    raw.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for name, (stat, variables) in GROUPS.items():
        out = raw / f"conus_{year}_{name}.download"
        if out.exists():
            print(f"{name}: cached")
            continue
        t = time.time()
        client.retrieve(DATASET, {
            "product_type": "reanalysis",
            "variable": variables,
            "year": str(year),
            "month": [f"{m:02d}" for m in range(1, 13)],
            "day": [f"{d:02d}" for d in range(1, 32)],
            "daily_statistic": stat,
            "time_zone": TZ,
            "frequency": "1_hourly",
            "area": CONUS,
        }, str(out))
        print(f"RESULT {name}: {out.stat().st_size / 1e6:.1f} MB, {(time.time() - t) / 60:.1f} min total", flush=True)


if __name__ == "__main__":
    main()
