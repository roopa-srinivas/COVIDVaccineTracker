// COVID Vaccine Tracker, web edition. Reads the weekly snapshot built by
// scripts/build_data.py and the US state shapes from us-atlas.

const BLUES = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ORANGES = ['#fbe3d6', '#f6c2a5', '#f09d74', '#e57746', '#c95a28', '#9c4219', '#6e2c0d'];

// Fixed thresholds (not quantiles) so colors mean the same thing in every week
// of the timeline.
const METRICS = {
  vaxFull: { label: 'Fully vaccinated', unit: '%', ramp: BLUES, breaks: [10, 25, 40, 55, 65, 75] },
  vaxOne: { label: 'At least one dose', unit: '%', ramp: BLUES, breaks: [10, 25, 40, 55, 70, 80] },
  boosted: { label: 'Booster doses per 100 people', unit: '', ramp: BLUES, breaks: [5, 15, 25, 35, 45, 55] },
  newCases: { label: 'New cases per 100k per day', unit: '', ramp: ORANGES, breaks: [5, 10, 25, 50, 100, 200] },
  deaths: { label: 'Total deaths per 100k', unit: '', ramp: ORANGES, breaks: [25, 75, 150, 250, 350, 450] },
};

// Postal codes for the short direct labels at the end of each line.
const ABBR = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', US: 'US' };

const state = { metric: 'vaxFull', week: 0, region: 'US', playing: null, sort: { key: 'value', dir: -1 } };
let data, weeks, features;
const $ = (id) => document.getElementById(id);
const fmtInt = d3.format(',');
const fmtCompact = (n) => (n >= 1e6 ? d3.format('.3~s')(n).replace('G', 'B') : fmtInt(Math.round(n)));
const fmtDate = d3.timeFormat('%b %-d, %Y');
const fmtMonth = d3.timeFormat('%b %Y');

// ----- values -----------------------------------------------------------------
function value(code, metric, i) {
  const r = data.regions[code];
  if (metric === 'newCases') return (r.newCases[i] / r.pop) * 1e5;
  if (metric === 'deaths') return (r.deaths[i] / r.pop) * 1e5;
  return r[metric][i];
}
const isEstimated = (code, i) => data.regions[code].estimated.includes(i);
function display(metric, v) {
  if (v == null || Number.isNaN(v)) return 'no data';
  const m = METRICS[metric];
  return m.unit === '%' ? `${v.toFixed(1)}%` : v >= 100 ? fmtInt(Math.round(v)) : v.toFixed(1);
}
function color(metric, v) {
  if (v == null) return null;
  const { breaks, ramp } = METRICS[metric];
  let bin = breaks.findIndex((b) => v < b);
  if (bin === -1) bin = breaks.length;
  return ramp[bin];
}

// ----- tooltip -----------------------------------------------------------------
const tip = $('tooltip');
function showTip(event, build) {
  tip.replaceChildren();
  build(tip);
  tip.hidden = false;
  const pad = 14, r = tip.getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + r.width > innerWidth - 8) x = event.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = event.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => (tip.hidden = true);
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function tipRow(parent, valueText, label, stroke, dashed) {
  const row = el('div', 'tt-row');
  if (stroke) {
    const key = el('i', 'tt-key' + (dashed ? ' dashed' : ''));
    key.style.borderColor = stroke;
    row.append(key);
  }
  row.append(el('b', null, valueText), el('span', null, label));
  parent.append(row);
}

// ----- map -----------------------------------------------------------------------
function drawMap() {
  const svg = d3.select('#map');
  const path = d3.geoPath();
  svg.selectAll('path.state')
    .data(features, (f) => f.id)
    .join((enter) =>
      enter.append('path')
        .attr('class', 'state')
        .attr('d', path)
        .attr('tabindex', 0)
        .attr('role', 'button')
        .on('pointermove', (event, f) => showTip(event, (t) => {
          const v = value(f.id, state.metric, state.week);
          t.append(el('div', 'tt-title', data.regions[f.id].name));
          tipRow(t, display(state.metric, v), METRICS[state.metric].label.toLowerCase());
          if (state.metric.startsWith('vax') || state.metric === 'boosted') {
            if (isEstimated(f.id, state.week)) t.append(el('div', 'tt-note', 'estimated: no report this week'));
          }
        }))
        .on('pointerleave', hideTip)
        .on('click', (_, f) => select(f.id))
        .on('keydown', (event, f) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(f.id); } })
    )
    .attr('fill', (f) => color(state.metric, value(f.id, state.metric, state.week)) ?? '#EFE9E0')
    .classed('nodata', (f) => value(f.id, state.metric, state.week) == null)
    .classed('selected', (f) => f.id === state.region)
    .attr('aria-label', (f) => `${data.regions[f.id].name}: ${display(state.metric, value(f.id, state.metric, state.week))}`);
  // Keep the selected outline on top.
  svg.selectAll('path.state.selected').raise();
  $('map-title').textContent = `${METRICS[state.metric].label}, week of ${fmtDate(weeks[state.week])}`;
}

function drawLegend() {
  const { breaks, ramp, unit } = METRICS[state.metric];
  const legend = $('legend');
  legend.replaceChildren();
  ramp.forEach((c, i) => {
    const sw = el('div', 'swatch');
    const bar = el('span');
    bar.style.background = c;
    // Each swatch is labeled with where it starts; the last one is open-ended.
    const lo = i === 0 ? 0 : breaks[i - 1];
    const text = i === ramp.length - 1 ? `${lo}${unit}+` : `${lo}${unit}`;
    sw.append(bar, el('span', null, text));
    legend.append(sw);
  });
}

function drawTable() {
  if ($('table-wrap').hidden) return;
  const rows = Object.keys(data.regions)
    .filter((c) => c !== 'US')
    .map((c) => ({ code: c, name: data.regions[c].name, value: value(c, state.metric, state.week) }));
  const { key, dir } = state.sort;
  rows.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name) * dir : ((a.value ?? -1) - (b.value ?? -1)) * dir));
  $('table').querySelector('th:last-child button').textContent = METRICS[state.metric].label;
  const body = $('table').querySelector('tbody');
  body.replaceChildren(...rows.map((r) => {
    const tr = el('tr');
    const name = el('td');
    const link = el('button', 'link-btn', r.name);
    link.onclick = () => select(r.code);
    name.append(link);
    tr.append(name, el('td', null, display(state.metric, r.value) + (isEstimated(r.code, state.week) && state.metric !== 'newCases' && state.metric !== 'deaths' ? ' (est.)' : '')));
    return tr;
  }));
}

// ----- detail tiles -----------------------------------------------------------------
function drawDetail() {
  const code = state.region, r = data.regions[code], i = state.week;
  $('detail-name').textContent = r.name;
  $('detail-when').textContent = `Week of ${fmtDate(weeks[i])}`;
  const est = isEstimated(code, i);
  const perDay = r.newCases[i], lastWeek = i > 0 ? r.newCases[i - 1] : null;
  const tiles = [
    { value: display('vaxFull', r.vaxFull[i]), label: 'fully vaccinated', est: est && r.vaxFull[i] != null },
    { value: display('vaxOne', r.vaxOne[i]), label: 'at least one dose', est: est && r.vaxOne[i] != null },
    { value: r.doses[i] != null ? fmtCompact(r.doses[i]) : 'no data', label: 'doses given in total', est: est && r.doses[i] != null },
    { value: r.boosted[i] != null ? r.boosted[i].toFixed(1) : '—', label: 'booster doses per 100 people', est: est && r.boosted[i] != null },
    { value: fmtInt(Math.round(perDay)), label: 'new cases per day (7-day average)', delta: lastWeek },
    { value: fmtCompact(r.cases[i]), label: 'cases in total' },
    { value: fmtInt(r.deaths[i]), label: 'deaths in total' },
    { value: display('deaths', value(code, 'deaths', i)), label: 'deaths per 100,000 people' },
  ];
  $('tiles').replaceChildren(...tiles.map((t) => {
    const tile = el('div', 'tile');
    tile.append(el('div', 'value', t.value), el('div', 'label', t.label));
    if (t.delta != null) {
      // The original app's headline: are cases up or down since last time?
      const change = t.delta > 0 ? (perDay - t.delta) / t.delta : 0;
      const cls = Math.abs(change) < 0.02 ? 'flat' : change > 0 ? 'up' : 'down';
      const arrow = cls === 'flat' ? '→' : cls === 'up' ? '↑' : '↓';
      tile.append(el('div', `delta ${cls}`, `${arrow} ${Math.abs(change * 100).toFixed(0)}% vs. the week before`));
    }
    if (t.est) tile.append(el('div', 'est', 'estimated'));
    return tile;
  }));
  const notes = [];
  if (r.vaxFull[i] == null) notes.push('Vaccines weren’t available yet this week.');
  if (code === '11') notes.push('DC’s percentages include people who live elsewhere but were vaccinated in DC.');
  if (est) notes.push('“Estimated” fills a gap in this state’s vaccination reports.');
  $('detail-note').textContent = notes.join(' ');
}

// ----- line charts -----------------------------------------------------------------
// A simple trend: a straight line through log(cases) over the last three
// weeks, carried two weeks forward. Shown next to what actually happened.
function forecast(series, i) {
  if (i < 2 || i + 2 >= series.length) return null;
  const pts = [i - 2, i - 1, i].map((k) => [k, series[k]]);
  if (pts.some(([, v]) => !(v > 0))) return null;
  const xs = pts.map(([k]) => k), ys = pts.map(([, v]) => Math.log(v));
  const mx = d3.mean(xs), my = d3.mean(ys);
  const slope = d3.sum(xs.map((x, j) => (x - mx) * (ys[j] - my))) / d3.sum(xs.map((x) => (x - mx) ** 2));
  return [0, 1, 2].map((step) => ({ i: i + step, v: Math.exp(my + slope * (i + step - mx)) }));
}
// How far off that trend line is two weeks out, across the whole series:
// the median absolute error, for honesty about what a trend can't see.
function forecastError(series) {
  const errors = [];
  for (let i = 2; i + 2 < series.length; i++) {
    const f = forecast(series, i);
    const actual = series[i + 2];
    if (f && actual > 0) errors.push(Math.abs(f[2].v - actual) / actual);
  }
  return d3.median(errors);
}

function lineChart(container, { series, yFormat, yMax, forecastPts, marker }) {
  const box = container.getBoundingClientRect();
  const width = Math.max(280, box.width), height = box.height;
  const m = { top: 12, right: 36, bottom: 26, left: 44 };
  const x = d3.scaleLinear().domain([0, weeks.length - 1]).range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - m.bottom, m.top]);
  const svg = d3.select(container).selectAll('svg').data([null]).join('svg').attr('viewBox', `0 0 ${width} ${height}`);
  svg.selectAll('*').remove();

  const yTicks = y.ticks(4);
  svg.append('g').selectAll('line').data(yTicks.slice(1)).join('line')
    .attr('class', 'gridline').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y).attr('y2', y);
  svg.append('line').attr('class', 'baseline').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(0)).attr('y2', y(0));
  svg.append('g').attr('class', 'axis').selectAll('text').data(yTicks).join('text')
    .attr('x', m.left - 8).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end').text(yFormat);
  const years = weeks.map((w, i) => [w, i]).filter(([w], i) => i === 0 || w.getFullYear() !== weeks[i - 1].getFullYear());
  svg.append('g').attr('class', 'axis').selectAll('text').data(years).join('text')
    .attr('x', ([, i]) => x(i)).attr('y', height - 6).attr('text-anchor', ([, i]) => (i === 0 ? 'start' : 'middle')).text(([w]) => w.getFullYear());

  if (marker != null) svg.append('line').attr('class', 'marker').attr('x1', x(marker)).attr('x2', x(marker)).attr('y1', m.top).attr('y2', y(0));

  const line = d3.line().defined((d) => d != null).x((_, i) => x(i)).y((d) => y(d));
  const labels = [];
  for (const s of series) {
    svg.append('path').attr('class', 'line').attr('stroke', s.color).attr('d', line(s.values));
    const last = s.values.findLastIndex((v) => v != null);
    if (last >= 0) labels.push({ text: s.short, x: x(last) + 8, y: y(s.values[last]) });
  }
  // Direct labels at each line's end, nudged apart so they never overlap.
  labels.sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 14);
  svg.append('g').selectAll('text').data(labels).join('text').attr('class', 'label').attr('fill', 'var(--ink2)')
    .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('dy', '0.32em').text((d) => d.text);
  if (forecastPts) {
    svg.append('path').attr('class', 'forecast-line').attr('stroke', series[0].color)
      .attr('d', d3.line().x((d) => x(d.i)).y((d) => y(Math.min(d.v, yMax * 1.15)))(forecastPts));
    const end = forecastPts[2];
    svg.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', series[0].color).attr('cx', x(end.i)).attr('cy', y(Math.min(end.v, yMax * 1.15)));
  }

  // Crosshair: snaps to the nearest week; one tooltip lists every series.
  const cross = svg.append('line').attr('class', 'crosshair').attr('y1', m.top).attr('y2', y(0)).style('display', 'none');
  const dots = series.map((s) => svg.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', s.color).style('display', 'none'));
  svg.append('rect').attr('x', m.left).attr('y', 0).attr('width', width - m.left - m.right).attr('height', height - m.bottom).attr('fill', 'transparent')
    .on('pointermove', (event) => {
      const [px] = d3.pointer(event);
      const i = Math.max(0, Math.min(weeks.length - 1, Math.round(x.invert(px))));
      cross.style('display', null).attr('x1', x(i)).attr('x2', x(i));
      series.forEach((s, k) => {
        const v = s.values[i];
        dots[k].style('display', v == null ? 'none' : null).attr('cx', x(i)).attr('cy', v == null ? 0 : y(v));
      });
      showTip(event, (t) => {
        t.append(el('div', 'tt-title', `Week of ${fmtDate(weeks[i])}`));
        series.forEach((s) => tipRow(t, s.values[i] == null ? '—' : yFormat(s.values[i]), s.name, s.color));
        const f = forecastPts?.find((p) => p.i === i && p.i !== forecastPts[0].i);
        if (f) tipRow(t, yFormat(f.v), 'trend forecast', series[0].color, true);
      });
    })
    .on('pointerleave', () => { cross.style('display', 'none'); dots.forEach((d) => d.style('display', 'none')); hideTip(); })
    .on('click', (event) => { const [px] = d3.pointer(event); setWeek(Math.round(x.invert(px))); });
}

function drawCharts() {
  const code = state.region, r = data.regions[code], us = data.regions.US;
  const per100k = (reg) => reg.newCases.map((v) => (v / reg.pop) * 1e5);
  const local = per100k(r), national = per100k(us);
  const compare = code !== 'US';
  const f = forecast(local, state.week);
  const peak = d3.max(compare ? local.concat(national) : local);
  const casesSeries = [{ name: r.name, short: ABBR[code], values: local, color: 'var(--series-1)' }];
  if (compare) casesSeries.push({ name: 'United States', short: 'US', values: national, color: 'var(--series-2)' });
  lineChart($('cases-chart'), { series: casesSeries, yFormat: (v) => (v === 0 ? '0' : v >= 10 ? d3.format(',.0f')(v) : d3.format('.1f')(v)), yMax: peak, forecastPts: f, marker: state.week });

  const vaxSeries = [{ name: r.name, short: ABBR[code], values: r.vaxFull, color: 'var(--series-1)' }];
  if (compare) vaxSeries.push({ name: 'United States', short: 'US', values: us.vaxFull, color: 'var(--series-2)' });
  lineChart($('vax-chart'), { series: vaxSeries, yFormat: (v) => `${Math.round(v)}%`, yMax: Math.max(100, d3.max(r.vaxFull) ?? 0), marker: state.week });

  // Keys: a legend for two series; one series is named by the title.
  const key = (id, items) => $(id).replaceChildren(...items.map(([label, stroke, dashed]) => {
    const span = el('span');
    const line = el('i', dashed ? 'dashed' : '');
    line.style.borderColor = stroke;
    span.append(line, document.createTextNode(label));
    return span;
  }));
  key('cases-key', [[r.name, 'var(--series-1)'], ...(compare ? [['United States', 'var(--series-2)']] : []), ['trend forecast', 'var(--series-1)', true]]);
  key('vax-key', compare ? [[r.name, 'var(--series-1)'], ['United States', 'var(--series-2)']] : []);

  const text = $('forecast-text');
  if (!f) {
    text.textContent = 'Pick a week with at least three weeks of cases before it and two after to see a forecast.';
    return;
  }
  const predicted = f[2].v, actual = local[state.week + 2];
  const err = (predicted - actual) / actual;
  const typical = forecastError(local);
  text.textContent = `From the week of ${fmtDate(weeks[state.week])}, the 3-week trend pointed to ${predicted.toFixed(1)} new cases per 100k per day two weeks later. ` +
    `It was actually ${actual.toFixed(1)} (${Math.abs(err) < 0.005 ? 'almost exactly right' : `${err >= 0 ? 'over' : 'under'} by ${Math.abs(err * 100).toFixed(0)}%`}). ` +
    `Across the whole pandemic in ${code === 'US' ? 'the US' : r.name}, this simple trend misses by a median ${Math.round(typical * 100)}% two weeks out: waves turn faster than trends can see.`;
}

function drawMakers() {
  const total = d3.sum(data.makers, (m) => m.doses);
  $('makers-sub').textContent = `${fmtCompact(total)} doses in total, as of ${fmtDate(new Date(data.makers[0].asOf + 'T00:00'))}`;
  $('makers').replaceChildren(...data.makers.map((m) => {
    const wrap = el('div', 'maker');
    const row = el('div', 'maker-row');
    const name = m.name === 'Johnson&Johnson' ? 'Johnson & Johnson' : m.name;
    const share = m.doses / total;
    row.append(el('span', null, name), el('b', null, `${fmtCompact(m.doses)} · ${share < 0.001 ? '<0.1' : (share * 100).toFixed(1)}%`));
    const bar = el('div', 'maker-bar');
    const fill = el('span');
    fill.style.width = `${Math.max(share * 100, 0.6)}%`;
    bar.append(fill);
    wrap.append(row, bar);
    return wrap;
  }));
}

// ----- interaction ---------------------------------------------------------------
function select(code) {
  state.region = code;
  $('region').value = code;
  render();
}
function setWeek(i) {
  state.week = Math.max(0, Math.min(weeks.length - 1, i));
  $('week').value = state.week;
  render();
}
function render() {
  $('week-label').textContent = fmtDate(weeks[state.week]);
  drawMap();
  drawLegend();
  drawTable();
  drawDetail();
  drawCharts();
}
function togglePlay() {
  const btn = $('play');
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    btn.textContent = '▶';
    btn.setAttribute('aria-label', 'Play the timeline');
    return;
  }
  if (state.week >= weeks.length - 1) state.week = 0;
  btn.textContent = '❚❚';
  btn.setAttribute('aria-label', 'Pause the timeline');
  state.playing = setInterval(() => {
    if (state.week >= weeks.length - 1) return togglePlay();
    setWeek(state.week + 1);
  }, 260);
}

async function init() {
  document.body.classList.add('loading');
  const [covid, topo] = await Promise.all([
    fetch('data/covid.json').then((r) => r.json()),
    fetch('data/states-albers-10m.json').then((r) => r.json()),
  ]);
  data = covid;
  weeks = data.weeks.map((w) => new Date(w + 'T00:00'));
  features = topojson.feature(topo, topo.objects.states).features.filter((f) => data.regions[f.id]);
  d3.select('#map').append('path')
    .attr('d', d3.geoPath()(topojson.mesh(topo, topo.objects.nation)))
    .attr('fill', 'none').attr('stroke', 'var(--axis)').attr('stroke-width', 0.75);

  // Open on the last week of the vaccine rollout's first year.
  state.week = weeks.findIndex((w) => w >= new Date('2021-12-04T00:00'));

  const metricSelect = $('metric');
  for (const [k, m] of Object.entries(METRICS)) metricSelect.append(new Option(m.label, k));
  metricSelect.value = state.metric;
  metricSelect.onchange = () => { state.metric = metricSelect.value; render(); };

  const regionSelect = $('region');
  regionSelect.append(new Option('United States', 'US'));
  Object.keys(data.regions).filter((c) => c !== 'US')
    .sort((a, b) => data.regions[a].name.localeCompare(data.regions[b].name))
    .forEach((c) => regionSelect.append(new Option(data.regions[c].name, c)));
  regionSelect.value = state.region;
  regionSelect.onchange = () => select(regionSelect.value);

  const week = $('week');
  week.max = weeks.length - 1;
  week.value = state.week;
  week.oninput = () => setWeek(+week.value);
  $('play').onclick = togglePlay;

  $('table-toggle').onclick = () => {
    const wrap = $('table-wrap');
    wrap.hidden = !wrap.hidden;
    $('table-toggle').textContent = wrap.hidden ? 'Show as table' : 'Hide table';
    $('table-toggle').setAttribute('aria-expanded', String(!wrap.hidden));
    drawTable();
  };
  $('table').querySelectorAll('th button').forEach((b) => (b.onclick = () => {
    const key = b.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : key === 'name' ? 1 : -1 };
    drawTable();
  }));

  drawMakers();
  render();
  document.body.classList.remove('loading');
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 120); });
}

init().catch((err) => {
  document.body.classList.remove('loading');
  $('detail-name').textContent = 'The data didn’t load.';
  $('detail-note').textContent = String(err);
});
