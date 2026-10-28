// Counts "perfect days" per hex from the packed daily planes written by
// pipeline/06_pack.py. Shared by the worker and the node tests.

// Month (0-11) of every day in the data.
export function dayMonths(meta) {
  const months = new Uint8Array(meta.days);
  const d = new Date(meta.start + "T00:00:00Z");
  for (let i = 0; i < meta.days; i++) {
    months[i] = d.getUTCMonth();
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return months;
}

// prefs: {
//   months: [12 booleans],
//   feels: {on, min, max},  °F, daytime feels-like range
//   dew:   {on, max},       °F
//   sun:   {on, min},       % of clear-sky sun
//   aqi:   {on, max},       AQI
// }
// Returns perfect days per year for each hex, and the number of selected days per year.
export function score(data, meta, months, prefs) {
  const H = meta.hexes, D = meta.days, N = H * D;
  const high = data.subarray(0, N);
  const dew = data.subarray(2 * N, 3 * N);
  const sunAqi = data.subarray(3 * N, 4 * N);

  const selected = new Uint8Array(D);
  let selectedDays = 0;
  for (let d = 0; d < D; d++) {
    if (prefs.months[months[d]]) {
      selected[d] = 1;
      selectedDays++;
    }
  }

  // Thresholds in the packed byte units.
  const off = meta.tempOffset;
  const feelsOn = prefs.feels.on, feelsMin = prefs.feels.min + off, feelsMax = prefs.feels.max + off;
  const dewOn = prefs.dew.on, dewMax = prefs.dew.max + off;
  const sunOn = prefs.sun.on, sunMin = Math.ceil(prefs.sun.min / 100 * meta.sunSteps - 1e-9);
  const aqiOn = prefs.aqi.on, unknown = meta.aqiUnknown;
  let aqiMaxBucket = meta.aqiEdges.findIndex(edge => prefs.aqi.max <= edge);
  if (aqiMaxBucket < 0) aqiMaxBucket = meta.aqiEdges.length;

  const years = meta.years.length;
  const perfect = new Float32Array(H);
  for (let h = 0; h < H; h++) {
    const base = h * D;
    let n = 0;
    for (let d = 0; d < D; d++) {
      if (!selected[d]) continue;
      const i = base + d;
      if (feelsOn && (high[i] < feelsMin || high[i] > feelsMax)) continue;
      if (dewOn && dew[i] > dewMax) continue;
      const sa = sunAqi[i];
      if (sunOn && (sa >> 4) < sunMin) continue;
      // Unknown AQ counts as passing; the hex info says when there's no nearby monitor.
      if (aqiOn && (sa & 15) !== unknown && (sa & 15) > aqiMaxBucket) continue;
      n++;
    }
    perfect[h] = n / years;
  }
  return { perfect, daysPerYear: selectedDays / years };
}
