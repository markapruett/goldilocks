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
//   feels: {on, min, max},   °F, daytime feels-like range
//   dew:   {on, max},        °F
//   sun:   {on, min},        % of clear-sky sun
//   aqi:   {on, max},        AQI
//   hot:   {on, temp, days}, dealbreaker: more than `days`/yr feeling >= temp
//   cold:  {on, temp, days}, dealbreaker: more than `days`/yr feeling <= temp
// }

// Everything a scoring pass needs, in the packed byte units.
function prepare(data, meta, months, prefs) {
  const N = meta.hexes * meta.days;
  const off = meta.tempOffset;
  const selected = new Uint8Array(meta.days);
  let selectedDays = 0;
  for (let d = 0; d < meta.days; d++) {
    if (prefs.months[months[d]]) {
      selected[d] = 1;
      selectedDays++;
    }
  }
  let aqiMax = meta.aqiEdges.findIndex(edge => prefs.aqi.max <= edge);
  if (aqiMax < 0) aqiMax = meta.aqiEdges.length;
  return {
    high: data.subarray(0, N),
    low: data.subarray(N, 2 * N),
    dew: data.subarray(2 * N, 3 * N),
    sunAqi: data.subarray(3 * N, 4 * N),
    selected, selectedDays,
    feelsMin: prefs.feels.min + off, feelsMax: prefs.feels.max + off,
    dewMax: prefs.dew.max + off,
    sunMin: Math.ceil(prefs.sun.min / 100 * meta.sunSteps - 1e-9),
    aqiMax, unknown: meta.aqiUnknown,
    hotTemp: prefs.hot.temp + off, coldTemp: prefs.cold.temp + off,
    years: meta.years.length,
  };
}

// Perfect days per year for each hex (within the selected months), hot and cold
// days per year (whole year), and whether a dealbreaker rules the hex out.
export function score(data, meta, months, prefs) {
  const H = meta.hexes, D = meta.days;
  const p = prepare(data, meta, months, prefs);
  const { high, low, dew, sunAqi, selected, unknown } = p;
  const feelsOn = prefs.feels.on, dewOn = prefs.dew.on, sunOn = prefs.sun.on, aqiOn = prefs.aqi.on;

  const perfect = new Float32Array(H), hot = new Float32Array(H), cold = new Float32Array(H);
  const excluded = new Uint8Array(H);
  for (let h = 0; h < H; h++) {
    const base = h * D;
    let n = 0, nHot = 0, nCold = 0;
    for (let d = 0; d < D; d++) {
      const i = base + d;
      if (high[i] >= p.hotTemp) nHot++;
      if (low[i] <= p.coldTemp) nCold++;
      if (!selected[d]) continue;
      if (feelsOn && (high[i] < p.feelsMin || high[i] > p.feelsMax)) continue;
      if (dewOn && dew[i] > p.dewMax) continue;
      const sa = sunAqi[i];
      if (sunOn && (sa >> 4) < p.sunMin) continue;
      // Unknown AQ counts as passing; the hex info says when there's no nearby monitor.
      if (aqiOn && (sa & 15) !== unknown && (sa & 15) > p.aqiMax) continue;
      n++;
    }
    perfect[h] = n / p.years;
    hot[h] = nHot / p.years;
    cold[h] = nCold / p.years;
    excluded[h] = (prefs.hot.on && hot[h] > prefs.hot.days) || (prefs.cold.on && cold[h] > prefs.cold.days) ? 1 : 0;
  }
  return { perfect, hot, cold, excluded, daysPerYear: p.selectedDays / p.years };
}

// One hex in depth: perfect days per month, and how often each enabled
// criterion fails on the selected days (a day can fail several).
export function detail(data, meta, months, prefs, h) {
  const D = meta.days;
  const p = prepare(data, meta, months, prefs);
  const { high, low, dew, sunAqi, selected, unknown } = p;

  const perMonth = new Float32Array(12), daysInMonth = new Float32Array(12);
  const fails = { tooHot: 0, tooCool: 0, humid: 0, cloudy: 0, badAir: 0 };
  let perfect = 0, nHot = 0, nCold = 0, aqUnknown = 0;
  const base = h * D;
  for (let d = 0; d < D; d++) {
    const i = base + d, m = months[d];
    daysInMonth[m]++;
    if (high[i] >= p.hotTemp) nHot++;
    if (low[i] <= p.coldTemp) nCold++;

    const sa = sunAqi[i], bucket = sa & 15;
    const tooHot = prefs.feels.on && high[i] > p.feelsMax;
    const tooCool = prefs.feels.on && high[i] < p.feelsMin;
    const humid = prefs.dew.on && dew[i] > p.dewMax;
    const cloudy = prefs.sun.on && (sa >> 4) < p.sunMin;
    const badAir = prefs.aqi.on && bucket !== unknown && bucket > p.aqiMax;
    const ok = !(tooHot || tooCool || humid || cloudy || badAir);
    if (ok) perMonth[m]++;
    if (!selected[d]) continue;
    if (ok) perfect++;
    if (bucket === unknown) aqUnknown++;
    fails.tooHot += tooHot; fails.tooCool += tooCool; fails.humid += humid;
    fails.cloudy += cloudy; fails.badAir += badAir;
  }
  for (const k in fails) fails[k] = p.selectedDays ? fails[k] / p.selectedDays : 0;
  for (let m = 0; m < 12; m++) {
    perMonth[m] /= p.years;
    daysInMonth[m] /= p.years;
  }
  return {
    perfect: perfect / p.years, perMonth, daysInMonth, fails,
    hot: nHot / p.years, cold: nCold / p.years,
    aqUnknown: p.selectedDays ? aqUnknown / p.selectedDays : 0,
  };
}
