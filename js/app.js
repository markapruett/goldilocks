// Preferences live in the URL hash so a view can be shared, e.g.
// #season=6,7,8&feels=65-85&dew=60&sun=60&aqi=50&hot=100x10&cold=10x10&off=aqi&map=6/38.5/-122.1

var DEFAULTS = {
  season: 'all', feels: [65, 85], dew: 60, sun: 60, aqi: 50,
  hot: [100, 10], cold: [10, 10], off: [], map: null
};

function readHash() {
  var state = structuredClone(DEFAULTS);
  var q = new URLSearchParams(location.hash.slice(1));
  var nums = (s, sep) => (s || '').split(sep).map(Number);
  var ok = arr => arr.every(Number.isFinite);
  if (q.has('season')) state.season = q.get('season');
  var feels = nums(q.get('feels'), /-(?=\d)/);
  if (feels.length == 2 && ok(feels)) state.feels = feels;
  for (var key of ['dew', 'sun', 'aqi']) {
    var n = Number(q.get(key));
    if (q.has(key) && Number.isFinite(n)) state[key] = n;
  }
  for (var key of ['hot', 'cold']) {
    var pair = nums(q.get(key), 'x');
    if (pair.length == 2 && ok(pair)) state[key] = pair;
  }
  if (q.has('off')) state.off = q.get('off').split(',');
  var view = nums(q.get('map'), '/');
  if (view.length == 3 && ok(view)) state.map = view;
  return state;
}

var state = readHash();
var narrow = window.matchMedia('(max-width: 640px)').matches;

// US map options
var options = {
  zoomSnap: .1,
  center: state.map ? state.map.slice(1) : narrow ? [41, -100] : [39, -97],
  zoom: state.map ? state.map[0] : narrow ? 3.1 : 4.3,
  minZoom: 2,
  zoomControl: false,
  preferCanvas: true
}

// create map
var map = L.map('mapid', options);

// request tiles and add to map
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// change zoom control position (the preferences panel fills the left side)
L.control.zoom({
  position: 'topright'
}).addTo(map);
// keep the credit at the bottom when the legend moves to the top on phones
map.attributionControl.setPosition('bottomleft');

// controls

var $ = id => document.getElementById(id);

function makeSlider(id, opts) {
  noUiSlider.create($(id), {
    step: 1,
    format: { to: Math.round, from: Number },
    ...opts
  });
  return $(id).noUiSlider;
}

var feelsSlider = makeSlider('feels-slider', { range: { min: 0, max: 110 }, start: state.feels, connect: true });
var dewSlider = makeSlider('dew-slider', { range: { min: 20, max: 80 }, start: state.dew, connect: 'lower' });
var sunSlider = makeSlider('sun-slider', { range: { min: 0, max: 100 }, step: 5, start: state.sun, connect: 'lower' });

var season = $('season');
season.value = state.season;
if (!season.value) season.value = 'all';
$('aqi-max').value = state.aqi;
if (!$('aqi-max').value) $('aqi-max').value = DEFAULTS.aqi;
[$('hot-temp').value, $('hot-days').value] = state.hot;
[$('cold-temp').value, $('cold-days').value] = state.cold;

var CRITERIA = ['feels', 'dew', 'sun', 'aqi', 'hot', 'cold'];
CRITERIA.forEach(name => {
  var box = $(name + '-on');
  box.checked = !state.off.includes(name);
  box.closest('.criterion').classList.toggle('off', !box.checked);
  box.addEventListener('change', () => {
    box.closest('.criterion').classList.toggle('off', !box.checked);
    requestScore();
  });
});
[season, $('aqi-max')].forEach(el => el.addEventListener('change', requestScore));
['hot-temp', 'hot-days', 'cold-temp', 'cold-days'].forEach(id => $(id).addEventListener('input', requestScore));

function readPrefs() {
  var months = season.value == 'all'
    ? Array(12).fill(true)
    : Array.from({ length: 12 }, (_v, m) => season.value.split(',').includes(String(m + 1)));
  var [feelsMin, feelsMax] = feelsSlider.get();
  var num = id => Number($(id).value) || 0;
  var on = name => $(name + '-on').checked;
  return {
    months,
    feels: { on: on('feels'), min: feelsMin, max: feelsMax },
    dew: { on: on('dew'), max: dewSlider.get() },
    sun: { on: on('sun'), min: sunSlider.get() },
    aqi: { on: on('aqi'), max: Number($('aqi-max').value) },
    hot: { on: on('hot'), temp: num('hot-temp'), days: num('hot-days') },
    cold: { on: on('cold'), temp: num('cold-temp'), days: num('cold-days') }
  };
}

function showValues(prefs) {
  $('feels-value').textContent = `${prefs.feels.min}–${prefs.feels.max}°F`;
  $('dew-value').textContent = `${prefs.dew.max}°F`;
  $('sun-value').textContent = `${prefs.sun.min}%`;
}

function writeHash(prefs) {
  var c = map.getCenter();
  var q = new URLSearchParams({
    season: season.value,
    feels: `${prefs.feels.min}-${prefs.feels.max}`,
    dew: prefs.dew.max,
    sun: prefs.sun.min,
    aqi: prefs.aqi.max,
    hot: `${prefs.hot.temp}x${prefs.hot.days}`,
    cold: `${prefs.cold.temp}x${prefs.cold.days}`,
    map: `${map.getZoom().toFixed(1)}/${c.lat.toFixed(2)}/${c.lng.toFixed(2)}`
  });
  var off = CRITERIA.filter(name => !prefs[name].on);
  if (off.length) q.set('off', off.join(','));
  history.replaceState(null, '', '#' + q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/'));
}

map.on('moveend', () => writeHash(readPrefs()));

// mobile: the panel folds away behind a button
$('panel-toggle').addEventListener('click', () => {
  var collapsed = $('ui-controls').classList.toggle('collapsed');
  $('panel-toggle').setAttribute('aria-expanded', String(!collapsed));
});

// scoring runs in a worker; while it's busy, only the latest prefs are kept

var worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
var status = $('status');
var meta = null, busy = false, queued = false;
var result = null;    // latest score result
var openHex = null;   // hex index shown in the popup

function requestScore() {
  var prefs = readPrefs();
  showValues(prefs);
  writeHash(prefs);
  if (!meta || busy) {
    queued = true;
    return;
  }
  busy = true;
  worker.postMessage({ type: 'score', prefs });
}

function requestDetail(i) {
  worker.postMessage({ type: 'detail', prefs: readPrefs(), hex: i });
}

worker.onmessage = e => {
  var msg = e.data;
  if (msg.type == 'progress') {
    status.textContent = `Loading data… ${(msg.loaded / 1e6).toFixed(0)} of ${(msg.total / 1e6).toFixed(0)} MB`;
  } else if (msg.type == 'ready') {
    meta = msg.meta;
    var first = meta.years[0], last = meta.years[meta.years.length - 1];
    status.textContent = `Daily data, ${first == last ? first : `${first}–${last}`}`;
    requestScore();
  } else if (msg.type == 'error') {
    status.textContent = `Couldn't load data: ${msg.message}`;
  } else if (msg.type == 'result') {
    busy = false;
    result = msg;
    updateMap();
    if (openHex != null) requestDetail(openHex);
    if (queued) {
      queued = false;
      requestScore();
    }
  } else if (msg.type == 'detail' && msg.hex == openHex) {
    popup.setContent(popupHTML(msg));
  }
};

// map

// Sequential blue ramp (light = few perfect days, dark = many); grey = ruled out.
var RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
var EXCLUDED = '#898781';
// Class breaks as a share of the selected days, e.g. 0–5% of the year, 5–10%, …
var breakShares = [0, .05, .1, .2, .3, .45, .6, 1];

var layers = [];  // by hex index
var hexGridLayer = L.geoJSON(null, {
  onEachFeature: (feature, layer) => {
    layers[feature.properties.i] = layer;
    layer.bindTooltip(() => tooltipHTML(feature.properties), { sticky: true });
    layer.on('click', () => openPopup(feature.properties.i));
  }
}).addTo(map);

fetch('data/hexes.geojson')
  .then(res => res.json())
  .then(hexes => {
    hexGridLayer.addData(hexes);
    updateMap();
  });

function classes() {
  var breaks = [...new Set(breakShares.map(s => Math.round(s * result.daysPerYear)))];
  var n = breaks.length - 1;
  var colors = Array.from({ length: n }, (_v, k) => RAMP[n == 1 ? 0 : Math.round(k * (RAMP.length - 1) / (n - 1))]);
  var colorize = days => {
    var k = breaks.findIndex((b, j) => j > 0 && days < b);
    return colors[k < 0 ? n - 1 : k - 1];
  };
  return { breaks, colors, colorize };
}

function updateMap() {
  if (!result || !layers.length) return;
  var { breaks, colors, colorize } = classes();
  hexGridLayer.setStyle(feature => {
    var i = feature.properties.i;
    return {
      fillColor: result.excluded[i] ? EXCLUDED : colorize(result.perfect[i]),
      fillOpacity: result.excluded[i] ? 0.45 : 0.75,
      weight: 1,
      opacity: 1,
      color: '#fcfcfb'
    };
  });
  updateLegend(breaks, colors);
  updateTopPlaces();
}

function seasonLabel() {
  return season.value == 'all' ? 'a year' : `a year in ${season.options[season.selectedIndex].text.replace(/ \(.*\)/, '')}`;
}

function dealbreakerText(i) {
  var prefs = readPrefs(), why = [];
  if (prefs.hot.on && result.hot[i] > prefs.hot.days) why.push(`${Math.round(result.hot[i])} days/yr feel ≥ ${prefs.hot.temp}°F`);
  if (prefs.cold.on && result.cold[i] > prefs.cold.days) why.push(`${Math.round(result.cold[i])} days/yr feel ≤ ${prefs.cold.temp}°F`);
  return why.join(', ');
}

function tooltipHTML(p) {
  var html = `<b>${p.name || 'Unnamed'}</b>`;
  if (result) {
    html += `<br>${Math.round(result.perfect[p.i])} perfect days ${seasonLabel()}`;
    if (result.excluded[p.i]) html += `<br>Ruled out: ${dealbreakerText(p.i)}`;
  }
  if (p.aqKm == null) html += '<br><i>no nearby air quality monitor</i>';
  return html;
}

// popup

var popup = L.popup({ maxWidth: 300, minWidth: 260, autoPanPaddingTopLeft: [300, 20] });
map.on('popupclose', () => { openHex = null; });

function openPopup(i) {
  openHex = i;
  popup.setLatLng(layers[i].getBounds().getCenter())
    .setContent(`<div class="hex-popup"><h3>${layers[i].feature.properties.name || 'Unnamed'}</h3>Loading…</div>`)
    .openOn(map);
  requestDetail(i);
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthBars(d, prefs) {
  // 12 bars on a fixed 0–31 day scale, so a full bar means every day was perfect.
  var W = 260, H = 64, gap = 2, bw = (W - gap * 11) / 12, top = 31;
  var bars = MONTHS.map((name, m) => {
    var v = d.perMonth[m], h = Math.max(v / top * H, v > 0 ? 1 : 0), x = m * (bw + gap), y = H - h;
    var r = Math.min(4, h, bw / 2);
    var path = h > 0
      ? `M${x},${H} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H} Z`
      : '';
    var inSeason = prefs.months[m];
    var title = `${name}: ${v.toFixed(1)} of ${Math.round(d.daysInMonth[m])} days perfect` + (inSeason ? '' : ' (outside selected season)');
    return `<g class="bar${inSeason ? '' : ' out'}"><title>${title}</title>` +
      `<rect x="${x}" y="0" width="${bw + gap}" height="${H + 14}" fill="transparent"/>` +
      `<path d="${path}"/>` +
      `<text x="${x + bw / 2}" y="${H + 12}">${name[0]}</text></g>`;
  }).join('');
  var label = MONTHS.map((name, m) => `${name} ${d.perMonth[m].toFixed(0)}`).join(', ');
  return `<svg class="month-bars" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Perfect days per month: ${label}">` +
    `<line x1="0" x2="${W}" y1="${H}" y2="${H}"/>${bars}</svg>`;
}

function failRows(d, prefs) {
  var rows = [
    [prefs.feels.on, d.fails.tooHot, `Too hot (feels > ${prefs.feels.max}°F)`],
    [prefs.feels.on, d.fails.tooCool, `Too cool (feels < ${prefs.feels.min}°F)`],
    [prefs.dew.on, d.fails.humid, `Too humid (dew point > ${prefs.dew.max}°F)`],
    [prefs.sun.on, d.fails.cloudy, `Too cloudy (sun < ${prefs.sun.min}%)`],
    [prefs.aqi.on, d.fails.badAir, `Bad air (AQI > ${prefs.aqi.max})`]
  ].filter(r => r[0]).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="small">No criteria switched on.</p>';
  return '<ul class="fails">' + rows.map(([, share, label]) =>
    `<li><span class="label">${label}</span>` +
    `<span class="track"><span class="fill" style="width:${(share * 100).toFixed(1)}%"></span></span>` +
    `<span class="pct">${Math.round(share * 100)}%</span></li>`).join('') + '</ul>';
}

function popupHTML(d) {
  var prefs = readPrefs(), i = d.hex, p = layers[i].feature.properties;
  var html = `<div class="hex-popup"><h3>${p.name || 'Unnamed'}</h3>` +
    `<p class="hero">${Math.round(d.perfect)} <span>perfect days ${seasonLabel()}</span></p>`;
  if (result && result.excluded[i]) html += `<p class="ruled-out">Ruled out: ${dealbreakerText(i)}</p>`;
  html += `<h4>Perfect days by month</h4>${monthBars(d, prefs)}`;
  html += `<h4>What ruins days here</h4>${failRows(d, prefs)}`;
  html += `<p class="small">Feels ≥ ${prefs.hot.temp}°F: ${Math.round(d.hot)} days/yr · ` +
    `feels ≤ ${prefs.cold.temp}°F: ${Math.round(d.cold)} days/yr</p>`;
  html += p.aqKm == null
    ? '<p class="small">Air quality: no monitor within 75 km, so it isn\'t judged here.</p>'
    : `<p class="small">Air quality: nearest monitored county ${p.aqKm} km away` +
      (d.aqUnknown > .05 ? `; ${Math.round(d.aqUnknown * 100)}% of days have no reading.` : '.') + '</p>';
  return html + '</div>';
}

// top places

function updateTopPlaces() {
  var order = [...result.perfect.keys()]
    .filter(i => !result.excluded[i] && layers[i])
    .sort((a, b) => result.perfect[b] - result.perfect[a])
    .slice(0, 10);
  var list = $('top-places');
  if (!order.length) {
    list.innerHTML = '<li class="none">Every place is ruled out by a dealbreaker.</li>';
    return;
  }
  if (result.perfect[order[0]] < 0.5) {
    list.innerHTML = '<li class="none">No place has a perfect day with these settings.</li>';
    return;
  }
  list.innerHTML = order.map(i =>
    `<li><button type="button" data-i="${i}">${layers[i].feature.properties.name || 'Unnamed'}</button>` +
    `<span>${Math.round(result.perfect[i])}</span></li>`).join('');
}

$('top-places').addEventListener('click', e => {
  var button = e.target.closest('button[data-i]');
  if (!button) return;
  var i = Number(button.dataset.i);
  var target = layers[i].getBounds().getCenter(), zoom = Math.max(map.getZoom(), 7);
  if (map.getCenter().distanceTo(target) < 1000 && map.getZoom() == zoom) {
    openPopup(i);  // already there, so flyTo wouldn't fire moveend
  } else {
    map.once('moveend', () => openPopup(i));
    map.flyTo(target, zoom, { duration: 0.8 });
  }
  if (narrow) $('panel-toggle').click();
});

// legend

var legendControl = L.control({ position: 'bottomright' });
legendControl.onAdd = () => {
  var div = L.DomUtil.create('div', 'legend');
  div.innerHTML = '<h3>Perfect days</h3><span class="legend-sub"></span><ul></ul>' +
    '<p>Data: <a href="https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics" target="_blank">ERA5</a>, ' +
    '<a href="https://aqs.epa.gov/aqsweb/airdata/download_files.html" target="_blank">EPA AirData</a>, ' +
    '<a href="https://www.geonames.org/" target="_blank">GeoNames</a></p>';
  return div;
};
legendControl.addTo(map);

function updateLegend(breaks, colors) {
  var rows = colors.map((color, k) =>
    `<li><span style="background:${color}"></span> ${breaks[k].toLocaleString()} &mdash; ${breaks[k + 1].toLocaleString()}</li>`);
  if (result.excluded.some(Boolean)) rows.push(`<li><span style="background:${EXCLUDED}"></span> ruled out</li>`);
  document.querySelector('.legend ul').innerHTML = rows.join('');
  document.querySelector('.legend-sub').textContent = `(per ${seasonLabel().replace(/^a /, '')})`;
}

// noUiSlider fires 'update' as soon as it's bound, so bind once everything above exists.
[feelsSlider, dewSlider, sunSlider].forEach(s => s.on('update', requestScore));
