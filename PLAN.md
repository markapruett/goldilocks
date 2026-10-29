# Plan: multi-factor "perfect days" Goldilocks

Status: **approved 2026-10-28**. Phase 0 done (see `pipeline/SPIKE.md`). Phases 2–4 built
and tested against synthetic weather. Phase 1 is waiting on the ERA5 download, then the
real-data checks.

## Goal

Find the places in the US that best match a personal definition of good weather, using
temperature (as it feels), humidity, sunshine and air quality, and judging places by what
actually happened day to day rather than by smoothed averages.

## Decisions so far

| Topic | Decision |
|---|---|
| Area | US only, on the same 50 km hexes the map uses today (lower 48, AK, HI and territories). |
| Main metric | **Perfect days per year**: the number of real historical days on which *all* enabled conditions held at once, averaged over the years in the data. |
| Temperature | **Feels-like** temperature (heat index / wind chill), plus **extreme-day dealbreakers** (e.g. "no more than 10 days/yr feeling ≥ 100°F"). |
| Humidity | **Dew point**. |
| Sunshine | Daily % of possible sun, with a minimum threshold slider. |
| Air quality | Daily AQI, with a maximum threshold (≤ 50 Good, ≤ 100 Moderate, or ignore). Wildfire smoke shows up through the AQI. |

### Decisions made after approval

| Topic | Decision |
|---|---|
| Upstream | This is your own fork. The old normals mode will be removed, not kept as an option. |
| Weather download | Copernicus CDS (free), run in the background: 70 requests, ~2.5 days. Each request is one variable × one year, under the 400-field size limit. |
| Western Pacific | The 18 hexes east of 0° longitude (Guam, CNMI, Wake, Palau, FSM, Marshall Islands) are left out for now. They can come back later with a second batch of downloads. |
| Feels-like | `max(T, heat index)` for heat and `min(T, wind chill)` for cold: dry air never makes it "feel cooler" than the actual temperature. |

### Why replace the current data

Today's file is built from NOAA's 30-year **daily normals**. A normal is a smoothed average
curve, so even the "Min/Max" mode never shows a real 112°F day in Phoenix or a real -15°F
night in Minneapolis. It also can't tell us whether the nice temperatures and the low
humidity happen *on the same days*. Working from about 10 years of actual daily data fixes both
problems: peaks and valleys are kept, and conditions can be checked together on each day.

## Data sources

| Factor | Source | Notes |
|---|---|---|
| Temperature, dew point, wind | ERA5 reanalysis, [post-processed daily statistics](https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics) (Copernicus CDS) | Gridded at 0.25° (~28 km), covers every hex including AK/HI/territories, free with a CDS account. Daily max/min/mean are computed on the server, so downloads stay in the low GB. |
| Sunshine | ERA5 surface solar radiation (`ssrd`) ÷ clear-sky solar radiation (`ssrdc`), daily sums | Gives "fraction of clear-sky sun that reached the ground". Close in spirit to NWS "% of possible sunshine". |
| Air quality | [EPA AirData](https://aqs.epa.gov/aqsweb/airdata/FileFormats.html) daily AQI by county | Measured, not modeled. A county's value is its highest-reading monitor that day. Only counties with monitors have data (see "Missing AQ" below). |

Years: **2016–2025** (10 full years). This is a lever if the data turns out too large (see
"Size").

Fallback if ERA5 retrieval is painful: the Open-Meteo historical API (which is also ERA5-based).
It's simpler, but at 3,331 locations × 10 years it would need a paid month to stay inside rate
limits.

### Per-day values computed for each hex

| Field | How |
|---|---|
| `feelsHigh` (°F) | NWS heat index from the daily max temperature and the daily mean dew point. When the heat index doesn't apply (below ~80°F), it's just the max temperature. |
| `feelsLow` (°F) | NWS wind chill from the daily min temperature and the daily mean 10 m wind. It only applies at ≤ 50°F with wind ≥ 3 mph; otherwise it's the min temperature. |
| `dewPoint` (°F) | Daily mean dew point. |
| `sun` (%) | Σ`ssrd` / Σ`ssrdc` for the local day. |
| `aqi` | EPA daily county AQI, bucketed. |

Approximation to note: pairing the daily max temperature with the daily *mean* dew point
assumes the dew point is steady through the day. That's usually true, and it saves pulling
hourly data. If spot checks look off, we can switch to 3-hourly sampling and compute the
feels-like temperature every 3 hours.

Hex aggregation: compute the values per ERA5 grid cell, then average the cells whose centers
fall inside the hex. If no cell center falls inside (small islands, coasts), use the cell
nearest the hex center. Caveat: mountain hexes blend valley and ridge elevations.

Missing AQ: assign each hex to the county that contains its center. On days with no
reading there, borrow the nearest county with a monitor within 75 km. Otherwise mark the day
**unknown**. In the UI, unknown AQ counts as passing, and the hex popup says "no nearby AQ
monitor" so it isn't silently trusted.

## Data shipped to the browser

The app stays a static site. A Python pipeline (below) produces:

- `data/hexes.geojson`: hex geometry plus a display name for each hex (the largest Census
  place in the hex, e.g. "Asheville, NC"). Small.
- `data/days.bin`: packed daily values, 4 bytes per hex-day, stored columnar (one plane per
  field, which gzips better per the Phase 0 test):
  - `feelsHigh` + 60 (°F, clamped)
  - `feelsLow` + 60
  - `dewPoint` + 60
  - high nibble = sun in 16 steps, low nibble = AQI bucket (0–50 / 51–75 / 76–100 /
    101–150 / 151–200 / 201+ / unknown)
- `data/meta.json`: years, day count, day-of-year → month index, encodings.

**Size**: 3,313 hexes × 3,653 days × 4 B ≈ **48 MB raw**, about **26 MB gzipped** (measured in
Phase 0). If it's too big, the options are fewer years (7 years ≈ 18 MB gzipped) or a
two-level load: coarse data first, the rest in the background.

**Speed**: one slider change scans about 12M hex-days. We'll do that in a **Web Worker** over a
`Uint8Array`, which should take tens of ms, so the main thread stays smooth while dragging.

## UI

Replaces the current single slider and the Avg/Min-Max radio buttons. The left panel becomes:

```
┌ Goldilocks Zone Finder ───────────┐
│ Season: [Annual ▾]                │   months / seasons, like today
│                                   │
│ A PERFECT DAY IS…                 │
│ [x] Feels like   ●━━━━━━●   65–85°F│   daytime feels-like range
│ [x] Dew point ≤  ━━━━━●     60°F  │
│ [x] Sun ≥        ━━━━●      60%   │
│ [x] Air quality  [≤ 50 Good ▾]    │
│                                   │
│ DEALBREAKERS                      │
│ [x] > [10] days/yr feeling ≥ [100]°F│
│ [x] > [10] days/yr feeling ≤ [10]°F │
│                                   │
│ Top places                        │
│  1. San Diego, CA      212 d/yr   │   click → zoom + open popup
│  2. …                             │
└───────────────────────────────────┘
```

- **Map color**: perfect days per year (or per month in the selected season), on the
  existing Spectral scale. Hexes that hit a dealbreaker are drawn grey/hatched; hexes with no
  data are light grey.
- **Each criterion has an on/off checkbox**, so you can ask things like "ignore air quality".
- **Hex popup on click**:
  - name
  - perfect days/yr
  - a 12-bar month chart of perfect days
  - **"what ruins days here"**: the % of days failing each criterion (e.g. humidity 41%,
    too hot 18%, cloudy 12%), which explains *why* a place scores low
  - extreme hot and cold day counts
  - AQ source county, or "no nearby monitor"
- **Shareable URL**: preferences are kept in the URL hash.
- Legend updates for the selected season, and its data credit names ERA5 and EPA.

## Code layout

```
pipeline/                 # Python (uv), run offline, outputs into data/
  SPIKE.md                # Phase 0 findings
  01_extract_hexes.py     # pull geometry from the current data file → build/hexes.geojson
  02_fetch_era5.py        # cdsapi, one variable-year per request, resumable
  03_fetch_aqi.py         # EPA daily AQI by county 2016–2025 + county polygons → build/aqi.npz
  04_build_days.py        # grid → hex, feels-like, sun fraction, AQ join
  05_name_hexes.py        # largest Census place per hex
  06_pack.py              # → data/days.bin, data/meta.json
  feelslike.py            # heat index / wind chill (unit-tested)
  tests/
js/
  app.js                  # map, panel, legend, popup, URL state
  worker.js               # loads days.bin, scores hexes on request
  score.js                # pure scoring function (shared by worker, tested under node)
data/
  hexes.geojson, days.bin, meta.json   # replace hex50kmWxStations.js
```

Raw downloads go to `pipeline/raw/` and intermediates to `pipeline/build/` (both
git-ignored).

## Phases

0. **Spike** ✅ (see `pipeline/SPIKE.md`)
1. **Pipeline** (in progress): steps 01–06 above, plus pytest checks of the heat index and wind
   chill formulas against NWS reference tables.
   - Sanity checks on known places: Phoenix hot days, Seattle winter sun, Miami dew point,
     smoke days in the West in 2020, cold days in Fairbanks. Fix anything that looks wrong
     before touching the UI.
   - Measure the ERA5 cool-peak bias against GHCN-Daily stations, and check San Diego's
     sunshine.
2. **App core** ✅: loader plus worker, the perfect-day criteria panel, map coloring and
   legend. Remove the old data file and the Avg/Min-Max mode.
3. **Explain & share** ✅: hex popup with month bars and the "what ruins days here" breakdown,
   dealbreakers, URL hash state.
4. **Polish** ✅: top-places list, mobile layout, top-level README covering data sources and
   method.
   - The map switched from the Spectral rainbow to a single-hue blue ramp (light = few
     perfect days), with dealbreaker hexes in neutral grey. A count needs light-to-dark,
     not a rainbow.

Each phase ends in a working state that you can review before the next one starts.

## Open questions

1. **Overnight lows**: a perfect day is currently judged on the *daytime* feels-like range
   only, with cold nights covered by the cold dealbreaker. Do you also want a "nights at least
   X°F" condition in the perfect-day definition?
2. **Defaults**: the starting values are 65–85°F feels-like, dew point ≤ 60°F, sun ≥ 60%,
   AQI ≤ 50, dealbreakers at 10 days ≥ 100°F and 10 days ≤ 10°F. Change any of them?
3. **Unknown AQ**: should unknown AQ count as passing (the plan) or failing?
4. **Size**: is a ~26 MB first load acceptable, or should we aim smaller from the start
   (fewer years, or two-level loading)?
