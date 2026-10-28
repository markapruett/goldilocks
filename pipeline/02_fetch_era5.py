"""Fetch ERA5 daily statistics for the US, one variable-year per request.

Usage: uv run 02_fetch_era5.py
Resumable: files already in raw/era5/us/ are skipped. Requests are strictly sequential
and checked against the CDS size limit before submission (see SPIKE.md). Any refusal
(4xx) stops the run instead of retrying, so we never hammer the service with bad requests.
"""
import time
import zipfile
from pathlib import Path

import cdsapi
import requests

DATASET = "derived-era5-single-levels-daily-statistics"
YEARS = range(2025, 2015, -1)  # newest first, so a usable year lands early
AREA = [72, -180, -15, -64]  # N, W, S, E: CONUS, AK, HI, PR/VI, American Samoa
TZ = "utc-06:00"

# field name -> (daily statistic, CDS variable)
FIELDS = {
    "tmax": ("daily_maximum", "2m_temperature"),
    "tmin": ("daily_minimum", "2m_temperature"),
    "dewpt": ("daily_mean", "2m_dewpoint_temperature"),
    "u10": ("daily_mean", "10m_u_component_of_wind"),
    "v10": ("daily_mean", "10m_v_component_of_wind"),
    "ssrd": ("daily_mean", "surface_solar_radiation_downwards"),
    "ssrdc": ("daily_mean", "surface_solar_radiation_downward_clear_sky"),
}

OUT = Path(__file__).parent / "raw" / "era5" / "us"


def request(year, stat, variable):
    return {
        "product_type": "reanalysis",
        "variable": [variable],
        "year": str(year),
        "month": [f"{m:02d}" for m in range(1, 13)],
        "day": [f"{d:02d}" for d in range(1, 32)],
        "daily_statistic": stat,
        "time_zone": TZ,
        "frequency": "1_hourly",
        "area": AREA,
    }


def log(msg):
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client(quiet=True, progress=False)
    jobs = [(y, f) for y in YEARS for f in FIELDS]
    todo = [(y, f) for y, f in jobs if not (OUT / f"{y}_{f}.nc").exists()]
    log(f"{len(jobs) - len(todo)} of {len(jobs)} already downloaded, {len(todo)} to go")

    for i, (year, field) in enumerate(todo, 1):
        stat, variable = FIELDS[field]
        req = request(year, stat, variable)
        cost = client.client.estimate_costs(DATASET, req)
        if cost["cost"] > cost["limit"]:
            raise SystemExit(f"{year} {field}: cost {cost['cost']} over limit {cost['limit']}, not submitting")

        dest = OUT / f"{year}_{field}.nc"
        part = dest.with_suffix(".part")
        t = time.time()
        log(f"[{i}/{len(todo)}] {year} {field}: submitting (cost {cost['cost']:.0f}/{cost['limit']:.0f})")
        for attempt in (1, 2):
            try:
                client.retrieve(DATASET, req, str(part))
                break
            except requests.HTTPError as e:
                status = e.response.status_code if e.response is not None else None
                if status is not None and 400 <= status < 500:
                    raise SystemExit(f"{year} {field}: refused ({status}): {e}")
                if attempt == 2:
                    raise
                log(f"{year} {field}: {e}; retrying once in 5 min")
                time.sleep(300)

        if zipfile.is_zipfile(part):
            with zipfile.ZipFile(part) as z:
                names = [n for n in z.namelist() if n.endswith(".nc")]
                if len(names) != 1:
                    raise SystemExit(f"{year} {field}: expected one .nc in zip, got {names}")
                dest.write_bytes(z.read(names[0]))
            part.unlink()
        else:
            part.rename(dest)
        log(f"[{i}/{len(todo)}] {year} {field}: {dest.stat().st_size / 1e6:.0f} MB in {(time.time() - t) / 60:.0f} min")

    log("all done")


if __name__ == "__main__":
    main()
