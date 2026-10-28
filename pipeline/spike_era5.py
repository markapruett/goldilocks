"""Phase 0 spike: fetch one month of ERA5 daily statistics for CONUS and inspect it.

Usage: uv run spike_era5.py [YEAR] [MONTH]
"""
import sys
import time
import zipfile
from pathlib import Path

import cdsapi
import xarray as xr

DATASET = "derived-era5-single-levels-daily-statistics"
CONUS = [50, -125, 24, -66]  # N, W, S, E
TZ = "utc-06:00"  # one zone per request; CONUS spans -05..-08

# One statistic per request.
REQUESTS = {
    "max": ["2m_temperature"],
    "min": ["2m_temperature"],
    "mean": [
        "2m_dewpoint_temperature",
        "10m_u_component_of_wind",
        "10m_v_component_of_wind",
        "surface_solar_radiation_downwards",
        "surface_solar_radiation_downward_clear_sky",
    ],
}


def fetch(client, stat, variables, year, month, out):
    if out.exists():
        print(f"{out.name}: cached")
        return
    t = time.time()
    client.retrieve(DATASET, {
        "product_type": "reanalysis",
        "variable": variables,
        "year": str(year),
        "month": [f"{month:02d}"],
        "day": [f"{d:02d}" for d in range(1, 32)],
        "daily_statistic": f"daily_{stat}imum" if stat in ("max", "min") else "daily_mean",
        "time_zone": TZ,
        "frequency": "1_hourly",
        "area": CONUS,
    }, str(out))
    print(f"{out.name}: {out.stat().st_size / 1e6:.1f} MB in {time.time() - t:.0f}s")


def open_any(path):
    # CDS may return a bare NetCDF or a zip of one NetCDF per variable.
    if zipfile.is_zipfile(path):
        d = path.with_suffix("")
        d.mkdir(exist_ok=True)
        zipfile.ZipFile(path).extractall(d)
        return xr.merge([xr.open_dataset(p) for p in sorted(d.glob("*.nc"))], compat="override")
    return xr.open_dataset(path)


def main():
    year, month = (int(a) for a in sys.argv[1:3]) if len(sys.argv) > 2 else (2024, 7)
    raw = Path(__file__).parent / "raw" / "era5"
    raw.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for stat, variables in REQUESTS.items():
        out = raw / f"conus_{year}{month:02d}_{stat}.download"
        fetch(client, stat, variables, year, month, out)
        ds = open_any(out)
        print(f"\n== {stat} ==\n{ds}\n")
        for v in ds.data_vars:
            a = ds[v]
            print(f"  {v}: units={a.attrs.get('units')} min={float(a.min()):.4g} max={float(a.max()):.4g}")


if __name__ == "__main__":
    main()
