"""Fetch ERA5 daily statistics for the US, one variable-year per request.

Usage: uv run 02_fetch_era5.py
Resumable: files already in raw/era5/us/ are skipped, and a request that's already on
the server (queued, running or finished, e.g. from a run that was stopped) is picked
up instead of submitted again. Requests are strictly sequential and checked against
the CDS size limit before submission (see SPIKE.md). Any refusal (4xx) stops the run
instead of retrying, so we never hammer the service with bad requests.
"""
import time
import zipfile
from pathlib import Path

import cdsapi
import requests

DATASET = "derived-era5-single-levels-daily-statistics"
YEARS = range(2025, 2020, -1)  # newest first, so a usable year lands early
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


MATCH_KEYS = ("year", "variable", "daily_statistic", "time_zone", "area")


def existing_jobs(client):
    """Our jobs already on the server that can still deliver, by request."""
    found = {}
    for rid in client.client.get_jobs(limit=50, sortby="-created").request_ids:
        remote = client.client.get_remote(rid)
        if remote.json["status"] in ("accepted", "running", "successful"):
            key = repr([remote.request.get(k) for k in MATCH_KEYS])
            found.setdefault(key, remote)
    return found


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client(quiet=True, progress=False)
    jobs = [(y, f) for y in YEARS for f in FIELDS]
    todo = [(y, f) for y, f in jobs if not (OUT / f"{y}_{f}.nc").exists()]
    log(f"{len(jobs) - len(todo)} of {len(jobs)} already downloaded, {len(todo)} to go")
    on_server = existing_jobs(client)

    for i, (year, field) in enumerate(todo, 1):
        stat, variable = FIELDS[field]
        req = request(year, stat, variable)
        dest = OUT / f"{year}_{field}.nc"
        part = dest.with_suffix(".part")
        t = time.time()

        remote = on_server.get(repr([req[k] for k in MATCH_KEYS]))
        if remote is not None:
            log(f"[{i}/{len(todo)}] {year} {field}: picking up job {remote.request_id[:8]} ({remote.json['status']})")
            try:
                remote.download(str(part))
            except requests.HTTPError as e:
                log(f"{year} {field}: couldn't fetch job {remote.request_id[:8]} ({e}); submitting a new one")
                remote = None
        if remote is None:
            cost = client.client.estimate_costs(DATASET, req)
            if cost["cost"] > cost["limit"]:
                raise SystemExit(f"{year} {field}: cost {cost['cost']} over limit {cost['limit']}, not submitting")
            log(f"[{i}/{len(todo)}] {year} {field}: submitting (cost {cost['cost']:.0f}/{cost['limit']:.0f})")
            retrieve(client, req, part, year, field)

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


def retrieve(client, req, part, year, field):
    for attempt in (1, 2):
        try:
            client.retrieve(DATASET, req, str(part))
            return
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else None
            if status is not None and 400 <= status < 500:
                raise SystemExit(f"{year} {field}: refused ({status}): {e}")
            if attempt == 2:
                raise
            log(f"{year} {field}: {e}; retrying once in 5 min")
            time.sleep(300)


if __name__ == "__main__":
    main()
