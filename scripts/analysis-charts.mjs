import { categoryDistribution, heatmapModel, maxCellCount, categoryDifferences, shortCategoryLabel } from './visualization-model.mjs';

const escape = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const percent = value => value === null ? 'N/A' : `${value.toFixed(1)}%`;
const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

export function createAnalysisCharts(dataset, { onCategorySelect, onCellSelect, showTip, hideTip }) {
  const d3 = globalThis.d3;
  const qs = selector => document.querySelector(selector);
  const maximum = maxCellCount(dataset.bugs);
  const cellColor = d3.scaleLinear().domain([0, maximum]).range(['#D9EAF5', '#07548D']).clamp(true);
  const categoryColor = d3.scaleOrdinal(dataset.bugCategories.map(c => c.label).sort(), d3.schemeTableau10.concat(['#9333ea', '#0f766e', '#c2410c', '#be123c']));
  const legend = qs('#heatmapLegend');
  legend.dataset.countMaximum = maximum;
  legend.innerHTML = `<span><i class="zero-key"></i>0</span><div class="count-gradient"><div style="background:linear-gradient(to right,${cellColor(1)},${cellColor(maximum)})"></div><span>1</span><span>${maximum}</span></div><strong>Bug Sample Count · fixed linear scale</strong>`;

  function focusTip(element, html) {
    const box = element.getBoundingClientRect();
    showTip({ clientX: box.left, clientY: box.bottom }, html);
  }

  function category(contextBugs, selectedCategoryLabel, mode) {
    const selectedId = dataset.bugCategories.find(c => c.label === selectedCategoryLabel)?.id || '';
    const model = categoryDistribution(contextBugs, dataset.bugCategories, selectedId);
    const weighted = mode === 'weighted';
    qs('#categoryDescription').textContent = weighted ? 'Project-Weighted of matching Bug samples' : 'Number of matching Bug samples';
    qs('#categoryHelp').hidden = !weighted;
    qs('#categoryChip').hidden = !selectedId;
    qs('#categoryChip').textContent = `Selected: ${selectedCategoryLabel} ×`;
    qs('#categoryChip').setAttribute('aria-label', `Clear category filter: ${selectedCategoryLabel}`);
    qs('#categoryMode').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.categoryMode === mode)));
    const wrap = qs('#categoryChart'); wrap.innerHTML = '';
    if (!model.eligibleProjectCount) {
      wrap.innerHTML = '<p class="empty-state">No eligible projects with matching Bug samples.</p>';
      return;
    }
    const value = row => weighted ? row.weightedShare : row.sampleCount;
    const rows = model.rows.filter(row => row.sampleCount || row.id === selectedId).sort((a, b) => value(b) - value(a) || a.label.localeCompare(b.label));
    const w = Math.max(600, wrap.clientWidth || 700), h = Math.max(280, rows.length * 30 + 60);
    const m = { top: 10, left: 210, right: 65, bottom: 48 };
    const x = d3.scaleLinear().domain([0, d3.max(rows, value) || 1]).nice().range([m.left, w - m.right]);
    const y = d3.scaleBand().domain(rows.map(row => row.label)).range([m.top, h - m.bottom]).padding(.22);
    const svg = d3.select(wrap).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'group').attr('aria-label', `Bug Category Distribution — ${weighted ? 'Project-Weighted' : 'Sample Count'}`);
    svg.append('g').attr('transform', `translate(0,${h - m.bottom})`).call(d3.axisBottom(x).ticks(5).tickFormat(weighted ? d => `${d}%` : d3.format('~g')));
    svg.append('g').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).tickSize(0)).call(g => g.select('.domain').remove());
    svg.append('text').attr('class', 'axis-unit').attr('x', (m.left + w - m.right) / 2).attr('y', h - 8).attr('text-anchor', 'middle').text(weighted ? 'Average share (%)' : 'Bug samples (n)');
    const tip = row => `<b>${escape(row.label)}</b><br>${weighted ? `${percent(row.weightedShare)} Project-Weighted<br>${model.eligibleProjectCount} eligible projects<br>` : ''}${row.sampleCount} Bug samples`;
    svg.selectAll('rect.category-bar').data(rows).join('rect').attr('class', row => `category-bar${row.id === selectedId ? ' selected' : ''}`)
      .attr('data-category-id', row => row.id).attr('x', m.left).attr('y', row => y(row.label)).attr('height', y.bandwidth()).attr('width', row => x(value(row)) - m.left)
      .attr('fill', row => categoryColor(row.label)).attr('rx', 4).attr('tabindex', 0).attr('role', 'button').attr('aria-pressed', row => String(row.id === selectedId))
      .attr('aria-label', row => `${row.label}: ${weighted ? percent(row.weightedShare) : `${row.sampleCount} Bug samples`}. Select category filter.`)
      .on('mousemove', (event, row) => showTip(event, tip(row))).on('mouseleave', hideTip)
      .on('focus', function(event, row) { focusTip(this, tip(row)); }).on('blur', hideTip)
      .on('click', (event, row) => { hideTip(); onCategorySelect(row.label); })
      .on('keydown', (event, row) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); hideTip(); onCategorySelect(row.label); } });
    svg.selectAll('.bar-value').data(rows).join('text').attr('class', 'bar-value').attr('x', row => x(value(row)) + 6).attr('y', row => y(row.label) + y.bandwidth() / 2 + 4).text(row => weighted ? percent(row.weightedShare) : row.sampleCount);
  }

  function heatmap(matchingBugs, contextBugs, filters, labelMode) {
    const model = heatmapModel(matchingBugs, contextBugs, dataset.projects, dataset.bugCategories, filters);
    qs('#heatmapFocusState').textContent = [
      filters.domainId ? `Domain focus: ${dataset.domainById.get(filters.domainId)?.label}` : '',
      filters.projectId ? `Project focus: ${dataset.projectById.get(filters.projectId)?.name}` : '',
      filters.categoryId ? `Category focus: ${dataset.categoryById.get(filters.categoryId)?.label}` : ''
    ].filter(Boolean).join(' · ') || 'Overview: all registered projects and categories.';
    qs('#heatmapLabels').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.heatmapLabels === labelMode)));
    const wrap = qs('#heatmap'), scrollLeft = wrap.scrollLeft, scrollTop = wrap.scrollTop;
    wrap.innerHTML = '';
    if (!model.rows.length || !model.columns.length) {
      wrap.innerHTML = '<p class="empty-state">No eligible Projects or Bug Categories for the current filters.</p>';
      return;
    }
    const table = document.createElement('table'); table.className = 'heatmap-table';
    table.setAttribute('aria-label', 'Project by Bug Category. Cell fill is Bug Sample Count; optional labels are Within-Project percentages.');
    const head = table.createTHead().insertRow();
    const corner = document.createElement('th'); corner.scope = 'col'; corner.textContent = 'Project'; head.append(corner);
    for (const item of model.columns) {
      const th = document.createElement('th'); th.scope = 'col'; th.title = item.label; th.setAttribute('aria-label', item.label); th.textContent = shortCategoryLabel(item); head.append(th);
    }
    const body = table.createTBody();
    const cellsByProject = d3.group(model.cells, cell => cell.projectId);
    for (const project of model.rows) {
      const row = body.insertRow();
      const name = document.createElement('th'); name.scope = 'row'; name.textContent = project.name; row.append(name);
      for (const cell of cellsByProject.get(project.id)) {
        const td = row.insertCell(), button = document.createElement('button');
        button.type = 'button'; button.className = 'heatmap-cell';
        button.dataset.projectId = cell.projectId; button.dataset.categoryId = cell.categoryId;
        button.dataset.count = cell.v; button.dataset.denominator = cell.denominator;
        button.style.backgroundColor = cell.v ? cellColor(cell.v) : '#EEF1F4';
        button.style.color = cell.v / maximum > .55 ? '#fff' : '#152033';
        const description = `${cell.r}; ${cell.c}; ${cell.v} Bug samples; Project denominator: ${cell.denominator}; Within-Project: ${percent(cell.share)} (before category filtering)`;
        button.setAttribute('aria-label', description);
        const text = document.createElement('span'); text.className = 'cell-label';
        text.textContent = labelMode === 'project' ? cell.share === null ? 'N/A' : `${cell.share.toFixed(0)}%` : '';
        button.append(text);
        const tip = `<b>${escape(cell.r)}</b><br>${escape(cell.c)}<br>${cell.v} Bug samples<br>Project denominator: ${cell.denominator}<br>Within-Project: ${percent(cell.share)}<br><small>Denominator before category filtering</small>`;
        d3.select(button).datum(cell).on('mousemove', event => showTip(event, tip)).on('mouseleave', hideTip).on('focus', () => focusTip(button, tip)).on('blur', hideTip).on('click', () => { hideTip(); onCellSelect(cell); });
        td.append(button);
      }
    }
    wrap.append(table); wrap.scrollLeft = scrollLeft; wrap.scrollTop = scrollTop;
  }

  function difference(a, b) {
    const wrap = qs('#categoryDifference'); wrap.innerHTML = '';
    if (!a || !b) { wrap.innerHTML = '<p class="empty-state">Insufficient samples / N/A — select two projects.</p>'; return; }
    const model = categoryDifferences(dataset.bugs, dataset.bugCategories, a.id, b.id);
    if (!model.totalA || !model.totalB) {
      const note = document.createElement('p'); note.className = 'empty-state'; note.textContent = `Insufficient samples / N/A — ${a.name}: ${model.totalA} bugs; ${b.name}: ${model.totalB} bugs.`; wrap.append(note); return;
    }
    const legend = document.createElement('div'); legend.className = 'difference-legend';
    const first = document.createElement('span'), second = document.createElement('span');
    first.textContent = `← A: ${a.name} higher (+pp)`; first.className = 'project-a';
    second.textContent = `B: ${b.name} higher (−pp) →`; second.className = 'project-b'; legend.append(first, second); wrap.append(legend);
    const w = Math.max(740, wrap.clientWidth || 900), h = Math.max(300, model.rows.length * 32 + 65), m = { top: 12, left: 235, right: 65, bottom: 45 };
    const limit = d3.max(model.rows, row => Math.abs(row.delta)) || 1;
    // A-B is positive to the LEFT by explicit design; the axis signs make that visible.
    const x = d3.scaleLinear().domain([limit, -limit]).nice().range([m.left, w - m.right]);
    const y = d3.scaleBand().domain(model.rows.map(row => row.label)).range([m.top, h - m.bottom]).padding(.25);
    const svg = d3.select(wrap).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'group').attr('aria-label', 'Category share differences A minus B in percentage points; A higher to the left, B higher to the right');
    svg.append('g').attr('transform', `translate(0,${h - m.bottom})`).call(d3.axisBottom(x).ticks(7).tickFormat(d => `${d > 0 ? '+' : ''}${d}`));
    svg.append('g').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).tickSize(0)).call(g => g.select('.domain').remove());
    svg.append('line').attr('class', 'zero-reference').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.top).attr('y2', h - m.bottom);
    svg.append('text').attr('class', 'axis-unit').attr('x', (m.left + w - m.right) / 2).attr('y', h - 5).attr('text-anchor', 'middle').text('A − B · percentage points (pp)');
    const tip = row => `<b>${escape(row.label)}</b><br>A: ${escape(a.name)} — ${row.countA}/${model.totalA} bugs (${percent(row.shareA)})<br>B: ${escape(b.name)} — ${row.countB}/${model.totalB} bugs (${percent(row.shareB)})<br>Difference A − B: ${signed(row.delta)} pp`;
    const rows = svg.selectAll('.difference-row').data(model.rows).join('g').attr('class', 'difference-row').attr('tabindex', 0).attr('aria-label', row => `${row.label}: ${signed(row.delta)} pp, A minus B`)
      .on('mousemove', (event, row) => showTip(event, tip(row))).on('mouseleave', hideTip).on('focus', function(event, row) { focusTip(this, tip(row)); }).on('blur', hideTip);
    rows.append('rect').attr('class', 'difference-hit').attr('x', m.left).attr('y', row => y(row.label)).attr('width', w - m.right - m.left).attr('height', y.bandwidth()).attr('fill', 'transparent');
    rows.append('rect').attr('class', 'difference-bar').attr('data-category-id', row => row.id).attr('data-delta', row => row.delta).attr('x', row => Math.min(x(0), x(row.delta))).attr('y', row => y(row.label)).attr('width', row => Math.abs(x(row.delta) - x(0))).attr('height', y.bandwidth()).attr('fill', row => row.delta >= 0 ? '#4f46e5' : '#0891b2').attr('rx', 3);
    rows.append('text').attr('class', 'bar-value').attr('x', row => x(row.delta) + (row.delta > 0 ? -6 : 6)).attr('y', row => y(row.label) + y.bandwidth() / 2 + 4).attr('text-anchor', row => row.delta > 0 ? 'end' : 'start').text(row => `${signed(row.delta)} pp`);
  }
  return { category, heatmap, difference };
}
