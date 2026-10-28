"""Extract hex geometry from the legacy data file into build/hexes.geojson.

Usage: uv run 01_extract_hexes.py
Keeps id and geometry, drops the NOAA-normals properties, and adds the hex center.
Hexes east of 0° longitude (western Pacific) are left out for now; see SPIKE.md.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
LEGACY = ROOT.parent / "data" / "hex50kmWxStations.js"
LEGACY_COMMIT = "11db8cf"
OUT = ROOT / "build" / "hexes.geojson"


def legacy_text():
    if LEGACY.exists():
        return LEGACY.read_text()
    # Removed from the tree in phase 2; the last commit that had it is the source.
    return subprocess.run(["git", "show", f"{LEGACY_COMMIT}:data/{LEGACY.name}"], cwd=ROOT,
                          check=True, capture_output=True, text=True).stdout


def main():
    text = legacy_text()
    legacy = json.loads(text[text.index("{"):text.rstrip().rstrip(";").rindex("}") + 1])

    features, skipped = [], 0
    for f in legacy["features"]:
        ring = f["geometry"]["coordinates"][0][:-1]
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        if lon > 0:
            skipped += 1
            continue
        features.append({
            "type": "Feature",
            "properties": {"id": f["properties"]["id"], "lat": round(lat, 4), "lon": round(lon, 4)},
            "geometry": f["geometry"],
        })

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"wrote {len(features)} hexes to {OUT.relative_to(ROOT)} (skipped {skipped} western Pacific)")


if __name__ == "__main__":
    main()
