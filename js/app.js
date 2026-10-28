// US map options
var options = {
  zoomSnap: .1,
  center: [39, -97],
  zoom: 4.3,
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

// change zoom control position
L.control.zoom({
  position: 'bottomleft'
}).addTo(map);

// controls

function makeSlider(id, opts) {
  var el = document.getElementById(id);
  noUiSlider.create(el, {
    step: 1,
    format: { to: Math.round, from: Number },
    ...opts
  });
  return el.noUiSlider;
}

var feelsSlider = makeSlider('feels-slider', { range: { min: 0, max: 110 }, start: [65, 85], connect: true });
var dewSlider = makeSlider('dew-slider', { range: { min: 20, max: 80 }, start: 60, connect: 'lower' });
var sunSlider = makeSlider('sun-slider', { range: { min: 0, max: 100 }, step: 5, start: 60, connect: 'lower' });

var season = document.getElementById('season');
var aqiMax = document.getElementById('aqi-max');
[season, aqiMax].forEach(el => el.addEventListener('change', requestScore));

['feels', 'dew', 'sun', 'aqi'].forEach(name => {
  var box = document.getElementById(name + '-on');
  box.addEventListener('change', () => {
    box.closest('.criterion').classList.toggle('off', !box.checked);
    requestScore();
  });
});

function readPrefs() {
  var months = season.value == 'all'
    ? Array(12).fill(true)
    : Array.from({ length: 12 }, (_v, m) => season.value.split(',').includes(String(m + 1)));
  var [feelsMin, feelsMax] = feelsSlider.get();
  return {
    months,
    feels: { on: document.getElementById('feels-on').checked, min: feelsMin, max: feelsMax },
    dew: { on: document.getElementById('dew-on').checked, max: dewSlider.get() },
    sun: { on: document.getElementById('sun-on').checked, min: sunSlider.get() },
    aqi: { on: document.getElementById('aqi-on').checked, max: Number(aqiMax.value) }
  };
}

function showValues(prefs) {
  document.getElementById('feels-value').textContent = `${prefs.feels.min}–${prefs.feels.max}°F`;
  document.getElementById('dew-value').textContent = `${prefs.dew.max}°F`;
  document.getElementById('sun-value').textContent = `${prefs.sun.min}%`;
}

// scoring runs in a worker; while it's busy, only the latest prefs are kept

var worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
var status = document.getElementById('status');
var meta = null, busy = false, queued = null;

function requestScore() {
  var prefs = readPrefs();
  showValues(prefs);
  if (!meta || busy) {
    queued = prefs;
    return;
  }
  busy = true;
  worker.postMessage(prefs);
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
    updateMap(msg.perfect, msg.daysPerYear);
    if (queued) {
      queued = null;
      requestScore();
    }
  }
};

// map

var hexGridLayer = L.geoJSON(null, {
  onEachFeature: (feature, layer) => layer.bindTooltip(() => {
    var p = feature.properties;
    var days = p.days == undefined ? '' : `<br>${Math.round(p.days)} perfect days/yr`;
    var aq = p.aqKm == null ? '<br><i>no nearby air quality monitor</i>' : '';
    return `<b>${p.name || 'Unnamed'}</b>${days}${aq}`;
  }, { sticky: true })
}).addTo(map);

fetch('data/hexes.geojson')
  .then(res => res.json())
  .then(hexes => {
    hexGridLayer.addData(hexes);
    if (lastResult) updateMap(...lastResult);
  });

// Class breaks as a share of the selected days, e.g. 0–5% of the year, 5–10%, …
var breakShares = [0, .05, .1, .2, .3, .45, .6, 1];
var lastResult = null;

function updateMap(perfect, daysPerYear) {
  lastResult = [perfect, daysPerYear];
  var breaks = [...new Set(breakShares.map(s => Math.round(s * daysPerYear)))];
  var colorize = chroma.scale('Spectral').domain([0, daysPerYear]).classes(breaks).mode('lab');

  hexGridLayer.eachLayer(layer => {
    layer.feature.properties.days = perfect[layer.feature.properties.i];
  });
  hexGridLayer.setStyle(feature => ({
    fillColor: colorize(feature.properties.days),
    weight: 1.5,
    opacity: 1,
    color: 'grey',
    fillOpacity: 0.7
  }));
  updateLegend(breaks, colorize);
}

// legend

var legendControl = L.control({ position: 'bottomright' });
legendControl.onAdd = () => {
  var div = L.DomUtil.create('div', 'legend');
  div.innerHTML = '<h3>Legend</h3> (perfect days per year)<ul></ul>' +
    '<p>Data: <a href="https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics" target="_blank">ERA5</a>, ' +
    '<a href="https://aqs.epa.gov/aqsweb/airdata/download_files.html" target="_blank">EPA AirData</a>, ' +
    '<a href="https://www.geonames.org/" target="_blank">GeoNames</a></p>';
  return div;
};
legendControl.addTo(map);

function updateLegend(breaks, colorize) {
  let legendList = "";
  for (var i = 0; i < breaks.length - 1; i++) {
    legendList += '<li><span style="background:' + colorize(breaks[i]) + '"></span> ' +
      breaks[i].toLocaleString() + ' &mdash; ' + breaks[i + 1].toLocaleString() + '</li>';
  }
  document.querySelector(".legend ul").innerHTML = legendList;
}

// noUiSlider fires 'update' as soon as it's bound, so bind once everything above exists.
[feelsSlider, dewSlider, sunSlider].forEach(s => s.on('update', requestScore));
