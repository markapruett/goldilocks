// Run with: node --test js/score.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { dayMonths, score } from "./score.js";

const meta = {
  start: "2024-01-30", days: 4, hexes: 2, years: [2024],
  tempOffset: 60, sunSteps: 15, aqiEdges: [50, 75, 100, 150, 200], aqiUnknown: 15,
};

// Two hexes × four days (Jan 30, Jan 31, Feb 1, Feb 2), planes laid out [plane][hex][day].
function pack({ high, low, dew, sun, aqi }) {
  const planes = [high.map(f => f + 60), low.map(f => f + 60), dew.map(f => f + 60),
    sun.map((s, i) => (s << 4) | aqi[i])];
  return Uint8Array.from(planes.flat());
}

const data = pack({
  //     hex 0: four days        hex 1: four days
  high: [70, 90, 75, 80,         60, 72, 72, 72],
  low:  [50, 60, 55, 60,         40, 50, 50, 50],
  dew:  [50, 50, 65, 55,         40, 40, 40, 40],
  sun:  [15, 15, 15, 5,          15, 15, 15, 15],
  aqi:  [0, 0, 0, 0,             0, 3, 15, 1],  // 3 = AQI 101–150, 15 = unknown, 1 = 51–75
});

const allMonths = Array(12).fill(true);
const prefs = (over = {}) => ({
  months: allMonths,
  feels: { on: true, min: 65, max: 85 },
  dew: { on: true, max: 60 },
  sun: { on: true, min: 60 },
  aqi: { on: true, max: 50 },
  ...over,
});

const months = dayMonths(meta);

test("dayMonths", () => {
  assert.deepEqual([...months], [0, 0, 1, 1]);
});

test("all criteria must hold on the same day", () => {
  // hex 0: day 0 passes; day 1 too hot; day 2 too humid; day 3 cloudy.
  // hex 1: day 0 too cool; day 1 bad air; day 2 unknown air passes; day 3 AQI 51–75 fails ≤ 50.
  assert.deepEqual([...score(data, meta, months, prefs()).perfect], [1, 1]);
});

test("criteria can be switched off", () => {
  const r = score(data, meta, months, prefs({ dew: { on: false, max: 60 }, sun: { on: false, min: 60 } }));
  assert.deepEqual([...r.perfect], [3, 1]);
});

test("AQI threshold maps onto buckets", () => {
  const r = score(data, meta, months, prefs({ aqi: { on: true, max: 100 } }));
  assert.deepEqual([...r.perfect], [1, 2]);
});

test("months filter", () => {
  const febOnly = allMonths.map((_, m) => m === 1);
  const r = score(data, meta, months, prefs({ months: febOnly }));
  assert.deepEqual([...r.perfect], [0, 1]);
  assert.equal(r.daysPerYear, 2);
});

test("averages over years", () => {
  const r = score(data, { ...meta, years: [2023, 2024] }, months, prefs());
  assert.deepEqual([...r.perfect], [0.5, 0.5]);
});
