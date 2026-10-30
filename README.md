# Goldilocks Zone Finder

Find the places in the US where the weather suits *you*. Describe a perfect day: how
warm it should feel, how muggy it can be, how sunny, how clean the air. The map then
shows how many real days a year each place delivered all of that at once.

It's a fork of [lukechampine/goldilocks](https://github.com/lukechampine/goldilocks),
which mapped days within a temperature range using NOAA's 30-year normals.

## How it works

The US is covered by 3,313 hexagons, each about 50 km across (lower 48, Alaska, Hawaii,
Puerto Rico/USVI, American Samoa). For each hex and each day from 2021 to 2025, the data has:

| Value | What it is |
|---|---|
| Feels-like high | NWS heat index from the day's max temperature and mean dew point; never below the actual temperature |
| Feels-like low | NWS wind chill from the day's min temperature and mean wind; never above the actual temperature |
| Dew point | daily mean, the best single measure of mugginess |
| Sunlight | share of the clear-sky sunlight that reached the ground (see caveats) |
| Air quality | EPA daily AQI for the county, including wildfire smoke |

A day counts as **perfect** when every criterion you've switched on holds that day.
The map colors each hex by perfect days per year, within the season you pick.
**Dealbreakers** grey out places with too many very hot or very cold days over the
whole year, whatever the season. Click a hex to see perfect days by month and
**what ruins days there** (the share of days failing each criterion). Your settings
and map view are kept in the URL, so you can share a link.

### Why real days instead of averages

The original version used 30-year *normals*: smoothed average curves that never show
a real heat wave or cold snap, and can't tell you whether the warm days and the dry
days are the same days. Working from actual daily data keeps the extremes and
checks every condition on the same day.

### Caveats

- ERA5 is a ~28 km reanalysis grid, not a weather station. Peaks run a few °F cooler
  than airport readings: Phoenix's July 2024 grid average was 109°F against ~113°F at
  the airport, and in 2025 the grid had Phoenix feeling ≥ 100°F on 85 days, against
  100+ real days. The "too hot" dealbreaker is therefore a little lenient in desert
  cities, and the app says so next to it.
- Each hex averages only the grid cells centered on US land, so the ocean doesn't drag
  coastal hexes toward sea temperatures. Coastal land cells still feel some ocean in
  the model, though: San Diego's July feels-like high comes out ~70°F against ~75°F
  in reality. Mountain hexes blend valleys and ridges.
- "Sunlight" is the share of clear-sky solar energy reaching the ground, not the
  familiar "% of possible sunshine". Thin cloud still lets much of it through, so it
  runs higher: Seattle's December scores ~40% against ~20–25% possible sunshine.
  ERA5 also underestimates coastal marine-layer clouds, so the California coast is
  probably sunnier here than in life.
- Air quality comes from the county containing the hex center, or the nearest
  monitored county within 75 km. About 6% of hexes have no monitor in range. Their air
  quality isn't judged (it counts as passing), and the hex says so.
- A county's AQI is its *worst* monitor that day, which is conservative for big counties.

## Running it locally

The site is static. Serve the repo root with any web server, because the data loads
through `fetch` and a module worker:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Tests for the scoring logic:

```sh
node --test js/score.test.mjs
```

## Rebuilding the data

The `pipeline/` directory is a Python ([uv](https://docs.astral.sh/uv/)) project that
writes `data/days.bin`, `data/hexes.geojson` and `data/meta.json`.

1. Create a [Copernicus CDS](https://cds.climate.copernicus.eu) account, accept the
   licence on the
   [ERA5 daily statistics](https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics)
   download page, and put your API token in `~/.cdsapirc`:
   ```
   url: https://cds.climate.copernicus.eu/api
   key: <your token>
   ```
2. Run the steps in order from `pipeline/`:
   ```sh
   uv run 01_extract_hexes.py   # hex grid (from the original data file in git history)
   uv run 02_fetch_era5.py      # 35 requests, one at a time: expect several days
   uv run 03_fetch_aqi.py       # EPA daily AQI, about a minute
   uv run 04_build_days.py      # grid → hex daily values
   uv run 05_name_hexes.py      # hex names
   uv run 06_pack.py            # → ../data/
   uv run pytest                # feels-like formula tests
   ```

`02_fetch_era5.py` can be stopped and restarted; it skips years it already has. CDS
caps each request at 400 variable-days and asks for requests one at a time, so the
script sends one variable-year at a time and checks the cost before each request.
`pipeline/SPIKE.md` has the details.

## Data and credits

- Weather: ERA5 post-processed daily statistics. Generated using Copernicus Climate
  Change Service information 2026. Neither the European Commission nor ECMWF is
  responsible for any use of this information.
- Air quality: [EPA AirData](https://aqs.epa.gov/aqsweb/airdata/download_files.html)
  daily AQI by county.
- Place names: [GeoNames](https://www.geonames.org/) (CC BY 4.0).
- County boundaries: US Census Bureau cartographic boundary files (2020).
- Map tiles: © OpenStreetMap contributors.
