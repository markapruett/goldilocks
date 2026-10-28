# Phase 0 spike notes

## EPA daily AQI by county — done (2026-10-28)

Source: `https://aqs.epa.gov/aqsweb/airdata/daily_aqi_by_county_{YEAR}.zip`. One CSV per year,
about 1.6 MB zipped / 27 MB unzipped. Files for 2016 and 2025 both exist (HTTP 200).

Columns: `State Name, county Name, State Code, County Code, Date, AQI, Category,
Defining Parameter, Defining Site, Number of Sites Reporting`.

2024 sample:
- 997 counties report, 808 of them on ≥ 300 days. 54 "states", including AK, HI, PR, VI and
  "Country Of Mexico" (border monitors, drop). No Guam or American Samoa, so those hexes will
  be AQ-unknown.
- AQI p50 = 40, p90 = 61, p99 = 105, max = 1513 (fire smoke). Bucketing in the plan is fine.
- Defining pollutant: ozone 51%, PM2.5 45%, then PM10/NO2/CO.

Hex coverage (hex center → nearest center point of a county reporting ≥ 300 days, using
Census 2024 Gazetteer interior points):

| within | share of 3,331 hexes |
|---|---|
| 50 km | 50% |
| 75 km | 73% |
| 100 km | 85% |
| 150 km | 94% |

This measures to county center points, so it *understates* coverage for big western
counties. Phase 1 should use county polygons. 75 km stays the planned cutoff. Re-check with
polygons, and consider 100 km if the unknown share is high in the Plains/West.

**Gotcha:** Connecticut. EPA still uses the 8 legacy counties (09001…09015), but Census
2022+ uses planning regions (091xx). Phase 1 needs legacy CT county polygons (e.g. 2020
TIGER/cartographic boundary file) instead of current ones.

## ERA5 daily statistics — one month done (2026-10-28)

Setup: `uv` 0.13.6 (prebuilt release binary in `~/.local/bin`; the Homebrew install was
building cmake/Rust from source), with `pipeline/` pinned to Python 3.12. Reads
`~/.cdsapirc`, and the licence has been accepted on the CDS dataset page.

Request: `spike_era5.py 2024 7`, lower 48 `[50, -125, 24, -66]`, `time_zone: utc-06:00`,
`frequency: 1_hourly`, three requests (one statistic each).

| Request | Queue wait | Run | File |
|---|---|---|---|
| `t2m` daily_maximum | ~10 s | ~50 s | 1.4 MB NetCDF |
| `t2m` daily_minimum | ~10 s | ~55 s | 1.4 MB NetCDF |
| `d2m, u10, v10, ssrd, ssrdc` daily_mean | **51 min** | 6 min | 9.0 MB zip of 5 NetCDF files |

Format: dims `valid_time × latitude (105) × longitude (237)`, at 0.25°, with latitude
descending. Units: K for `t2m`/`d2m`, m/s for wind, and J m⁻² *per hour* for `ssrd`/`ssrdc`
(the daily mean of hourly accumulations, so daily total = × 24). We only use the ratio, so
the scale doesn't matter.

July 2024 spot checks (nearest grid cell):

| | Avg high | Hottest | Avg low | Dew pt | Sun | Feels (avg/max) |
|---|---|---|---|---|---|---|
| Phoenix | 109 | 115 | 87 | 58 | 94% | 110 / 115 |
| Seattle | 78 | 90 | 59 | 56 | 83% | 78 / 90 |
| Miami | 87 | 89 | 81 | 76 | 80% | 98 / 102 |
| Denver | 89 | 99 | 60 | 43 | 88% | 86 / 94 |
| Houston | 89 | — | — | 76 | 65% | 100 / 109 |
| San Diego | 73 | — | — | 62 | 97% | 73 / 77 |

Findings:
- **Peaks run cool.** The ERA5 grid is a few °F below airport readings at the extremes (the
  Phoenix airport averaged ~113°F in July 2024; the grid says 109). Coastal cells mix in
  ocean (Miami). Phase 1: measure the bias against GHCN-Daily stations near the hex
  centers, then decide whether to correct it or just mention it in the legend.
- **Feels-like below actual in dry air.** The NWS heat index drops below the actual temperature
  at low humidity (Denver 86 vs 89). Use `feels = max(T, HI)` for heat and
  `min(T, WC)` for cold.
- **San Diego 97% sun looks too high.** ERA5 is known to underestimate marine-layer
  stratus. Phase 1: validate sun against a few stations with cloud/sunshine records.
- **Compression** (3,169 lower-48 hexes × 31 days, nearest cell, 4 B/day): interleaved
  gzip 64% / xz 48%; **columnar (one plane per field) gzip 54%** / xz 44%; delta coding
  didn't help. Columnar it is. 49 MB raw × 54% ≈ **26 MB** gzip transfer.
- **Throughput is the real risk.** Monthly requests that include radiation would mean
  120 × ~57 min ≈ 114 h for the lower 48 alone. Next test: full-year requests, with
  radiation split from dew point/wind, to see which part waits in the queue.
- Requests stay sequential. The CDS "protection measures" notice (2026-10-06) warns
  against parallel/batch submissions and repeated invalid requests, but gives no numbers.

## ERA5 throughput — done (2026-10-28)

`spike_throughput.py 2023`: full-year requests, one at a time.

| Request | Cost | Result |
|---|---|---|
| `t2m` daily_maximum × 365 days | 365 | ✅ waited 37 min in the queue, ran 16 min, 19.3 MB |
| `d2m, u10, v10` daily_mean × 365 days | 1,095 | ❌ **403 at submit** (no job created) |
| solar | — | not sent (script stopped) |

**Per-request size limit = 400 "fields" (variables × days)**, confirmed with
`Client.estimate_costs()`, which returns `{'id': 'size', 'cost': …, 'limit': 400}` and
creates no job. The cost **does not depend on area**: the lower-48 box and an all-US box
`[72, -180, -15, -64]` both cost 365 for one variable-year. Queue waits so far were 10 s, 10 s,
51 min and 37 min. They track server load, not variable type (the temperature-only request
also waited 37 min), so the "radiation is slow" idea is ruled out.

Rules for the Phase 1 fetcher:
- One variable × one year (cost 365–366) per request, always checked with `estimate_costs`
  before submitting. Never send a request over the limit.
- Strictly sequential, resumable (skip files already present), with one retry and then stop
  on any 4xx, never a retry loop.
- 7 fields (t2m max, t2m min, d2m, u10, v10, ssrd, ssrdc means) × 10 years =
  **70 requests per box**.

Boxes:
- **Main**: `[72, -180, -15, -64]`, `utc-06:00`. Covers the lower 48, AK, HI, PR/VI and
  American Samoa. A 24 h window that's a few hours off local midnight still contains one
  afternoon and one early morning, so max/min are fine. About 6.5× the lower-48 grid, so
  ~125 MB per variable-year and **~9 GB in total**.
- **Western Pacific** (optional): 18 hexes east of 0° longitude: Guam (2), CNMI (2), Wake (1),
  and Palau/FSM/Marshall Islands (13, not US territory but they have NOAA stations). They'd
  need a second box `[20, 130, 4, 172]` at `utc+10:00`, which is **another 70 requests**.

Time: about 70 requests × ~50 min ≈ **2.5 days** of unattended download for the main box,
plus about as much again for the western Pacific. Fallback if this is too slow: a paid
Open-Meteo plan (also ERA5-based), probably a few hours, at the cost of one month's
subscription.

## Phase 0 conclusion

Every source works. Remaining choices for the user: whether to include the western Pacific
hexes, and whether to accept ~2.5 days of download (it can run while the rest of Phase 1
is being built) or pay for Open-Meteo.
