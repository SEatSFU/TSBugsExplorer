import { loadDataset, toLegacyRecords, toLegacyCsv } from './scripts/data-loader.mjs';
import { createAnalysisCharts } from './scripts/analysis-charts.mjs';
import { createBenchmarkFacet } from './scripts/benchmark-facet.mjs';

function initializeApplication(dataset) {
const {bugs, projects, dependencies} = dataset;
const projectMap = new Map(projects.map(p => [p.project,p]));
const types = dataset.bugCategories.map(c=>c.label).sort();
const projectNames = projects.map(p=>p.name).sort();
const domains = dataset.domains.map(d=>d.id).sort((a,b)=>dataset.domainById.get(a).label.localeCompare(dataset.domainById.get(b).label));
const color = d3.scaleOrdinal(types, d3.schemeTableau10.concat(['#9333ea','#0f766e','#c2410c','#be123c']));
const fmt = d3.format(',');
const state={project:'',type:'',domain:'',search:'',page:0,pageSize:15,selectedBug:null};
const view={categoryMode:'count',heatmapLabels:'none'};
const facets={};
const defs=Object.fromEntries(dataset.bugCategories.map(c=>[c.label,c]));
function qs(s){return document.querySelector(s)} function qsa(s){return [...document.querySelectorAll(s)]}
const charts=createAnalysisCharts(dataset,{
  onCategorySelect:label=>setFilter('type',state.type===label?'':label),
  onCellSelect:cell=>{state.project=cell.r;state.type=cell.c;state.page=0;syncGlobals();renderAll();switchView('explorer')},
  showTip,hideTip
});
function setFilter(key,value){
  state[key]=value;state.page=0;
  syncGlobals();renderAll();
}
function renderFilterStatus(data){
  qs('#matchingCount').textContent=`${fmt(data.length)} / ${fmt(bugs.length)} Bug samples`;
  const chips=qs('#activeFilters');chips.innerHTML='';
  const names={project:'Project',type:'Category',domain:'Domain',search:'Search'};
  for(const key of Object.keys(names))if(state[key]){
    const value=key==='domain'?dataset.domainById.get(state.domain).label:state[key];
    const chip=document.createElement('button');chip.className='filter-chip';chip.textContent=`${names[key]}: ${value} ×`;
    chip.setAttribute('aria-label',`Clear ${names[key].toLowerCase()} filter`);chip.addEventListener('click',()=>setFilter(key,''));chips.append(chip);
  }
  qs('#allDomains').disabled=!state.domain;
  qs('#domainChip').hidden=!state.domain;
  const domainLabel=state.domain?dataset.domainById.get(state.domain).label:'';
  qs('#domainChip').textContent=`Selected: ${domainLabel} ×`;
  qs('#domainChip').setAttribute('aria-label',`Clear domain filter: ${domainLabel}`);
  qs('#projectChip').hidden=!state.project;
  qs('#projectChip').textContent=`Selected: ${state.project} ×`;
  qs('#projectChip').setAttribute('aria-label',`Clear project filter: ${state.project}`);
}
function fillSelect(sel, items, placeholder,label=x=>x){const el=qs(sel); const cur=el.value; el.innerHTML=placeholder?`<option value="">${placeholder}</option>`:''; items.forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=label(x);el.appendChild(o)}); if([...el.options].some(o=>o.value===cur))el.value=cur}
['#globalProject','#explorerProject'].forEach(s=>fillSelect(s,projectNames,'All projects'));
['#globalType','#explorerType'].forEach(s=>fillSelect(s,types,'All categories'));
['#globalDomain','#explorerDomain'].forEach(s=>fillSelect(s,domains,'All domains',id=>dataset.domainById.get(id).label));
fillSelect('#projectA',projectNames);fillSelect('#projectB',projectNames);qs('#projectA').value=projectNames[0]||'';qs('#projectB').value=projectNames[1]||projectNames[0]||'';
fillMulti('#benchProjects',projectNames);fillMulti('#benchTypes',types);fillMulti('#benchDomains',domains,id=>dataset.domainById.get(id).label);
function fillMulti(sel,items,label=x=>x){const el=qs(sel);el.innerHTML='';items.forEach(x=>{const o=document.createElement('button');o.type='button';o.className='criterion-option';o.dataset.value=x;o.textContent=label(x);o.setAttribute('role','option');o.setAttribute('aria-selected','true');el.appendChild(o)})}
function filtered(ignoreCategory=false){return bugs.filter(b=>(!state.project||b.project===state.project)&&(ignoreCategory||!state.type||b.type===state.type)&&(!state.domain||b.domainId===state.domain)&&(!state.search||[b.id,b.project,b.type,b.domain,...b.filePaths].join(' ').toLowerCase().includes(state.search.toLowerCase())))}
function countBy(data,key){return d3.rollups(data,v=>v.length,d=>d[key]).sort((a,b)=>b[1]-a[1])}
function clearChart(sel){qs(sel).innerHTML=''}
function tooltip(){let t=qs('.tooltip');if(!t){t=document.createElement('div');t.className='tooltip';document.body.appendChild(t)}return t}
function showTip(e,html){const t=tooltip();t.innerHTML=html;t.style.left=(e.clientX+12)+'px';t.style.top=(e.clientY+12)+'px';t.style.opacity=1}function hideTip(){tooltip().style.opacity=0}
function metrics(data){const ps=new Set(data.map(d=>d.project));const ts=new Set(data.map(d=>d.type));const files=d3.sum(data,d=>d.filesChanged);const avg=data.length?files/data.length:0;qs('#metricCards').innerHTML=[['Bugs',fmt(data.length),'Current selection'],['Projects',fmt(ps.size),`of ${projects.length}`],['Categories',fmt(ts.size),`of ${types.length}`],['Files changed',fmt(files),`${avg.toFixed(1)} per bug`]].map(x=>`<div class="metric"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join('')}
function horizontalBars(sel,data,clickKey,opts={}){clearChart(sel);const wrap=qs(sel), margin={top:10,right:45,bottom:30,left:opts.left||155},w=Math.max(520,wrap.clientWidth||700),h=Math.max(260,data.length*27+40);const svg=d3.select(sel).append('svg').attr('viewBox',`0 0 ${w} ${h}`);const x=d3.scaleLinear().domain([0,d3.max(data,d=>d[1])||1]).nice().range([margin.left,w-margin.right]);const y=d3.scaleBand().domain(data.map(d=>d[0])).range([margin.top,h-margin.bottom]).padding(.2);svg.append('g').attr('transform',`translate(0,${h-margin.bottom})`).call(d3.axisBottom(x).ticks(5)).call(g=>g.select('.domain').remove());svg.append('g').attr('transform',`translate(${margin.left},0)`).call(d3.axisLeft(y).tickSize(0)).call(g=>g.select('.domain').remove());svg.selectAll('rect').data(data).join('rect').attr('x',margin.left).attr('y',d=>y(d[0])).attr('height',y.bandwidth()).attr('width',d=>x(d[1])-margin.left).attr('rx',5).attr('class',d=>opts.selectedLabel===d[0]?'selected-bar':null).attr('fill',d=>opts.color?opts.color(d[0]):color(d[0])).style('cursor',clickKey||opts.onClick?'pointer':'default').on('mousemove',(e,d)=>showTip(e,`<b>${escapeHtml(d[0])}</b><br>${fmt(d[1])} Bug samples`)).on('mouseleave',hideTip).on('click',(_,d)=>{if(opts.onClick)opts.onClick(d[0]);else if(clickKey)setFilter(clickKey,state[clickKey]===d[0]?'':d[0])});svg.selectAll('.value').data(data).join('text').attr('x',d=>x(d[1])+5).attr('y',d=>y(d[0])+y.bandwidth()/2+4).attr('font-size',11).text(d=>fmt(d[1]))}
function domainChart(data){horizontalBars('#domainChart',countBy(data,'domain'),null,{left:220,selectedLabel:state.domain?dataset.domainById.get(state.domain).label:'',color:()=> '#0891b2',onClick:label=>{const domain=dataset.domains.find(d=>d.label===label);setFilter('domain',state.domain===domain.id?'':domain.id)}})}
function scatter(){clearChart('#scatterChart');const bugCount=new Map(countBy(bugs,'project'));const data=projects.map(p=>({...p,bugs:bugCount.get(p.project)||0})).filter(d=>Number.isFinite(d.loc)&&d.loc>0&&Number.isFinite(d.stars)&&d.stars>0);if(!data.length){qs('#scatterChart').innerHTML='<p class="empty-state">No projects with positive LOC and stars.</p>';return}const wrap=qs('#scatterChart'),w=Math.max(520,wrap.clientWidth||700),h=310,m={top:15,right:25,bottom:48,left:65};const svg=d3.select('#scatterChart').append('svg').attr('viewBox',`0 0 ${w} ${h}`);const x=d3.scaleLog().domain(d3.extent(data,d=>d.loc)).nice().range([m.left,w-m.right]),y=d3.scaleLog().domain(d3.extent(data,d=>d.stars)).nice().range([h-m.bottom,m.top]),r=d3.scaleSqrt().domain([0,d3.max(data,d=>d.bugs)||1]).range([4,16]);svg.append('g').attr('transform',`translate(0,${h-m.bottom})`).call(d3.axisBottom(x).ticks(5,'~s'));svg.append('g').attr('transform',`translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5,'~s'));svg.append('text').attr('x',w/2).attr('y',h-8).attr('text-anchor','middle').attr('font-size',11).text('Project size (LOC, log scale)');svg.append('text').attr('transform','rotate(-90)').attr('x',-h/2).attr('y',14).attr('text-anchor','middle').attr('font-size',11).text('GitHub stars (log scale)');svg.selectAll('circle').data(data).join('circle').attr('cx',d=>x(d.loc)).attr('cy',d=>y(d.stars)).attr('r',d=>r(d.bugs)).attr('fill','#4f46e5').attr('opacity',.72).style('cursor','pointer').on('mousemove',(e,d)=>showTip(e,`<b>${escapeHtml(d.project)}</b><br>${fmt(d.loc)} LOC<br>${fmt(d.stars)} stars<br>${d.bugs} bugs`)).on('mouseleave',hideTip).on('click',(_,d)=>{setFilter('project',d.project)})}
function renderHeatmap(data=filtered(),context=filtered(true)){charts.heatmap(data,context,{projectId:projectMap.get(state.project)?.id||'',categoryId:defs[state.type]?.id||'',domainId:state.domain},view.heatmapLabels)}
function renderDashboard(){const data=filtered(),context=filtered(true);metrics(data);renderFilterStatus(data);charts.category(context,state.type,view.categoryMode);horizontalBars('#projectChart',countBy(data,'project'),'project',{left:110,selectedLabel:state.project,color:()=> '#0f766e'});renderHeatmap(data,context);domainChart(data);scatter()}
function syncGlobals(){qs('#globalProject').value=state.project;qs('#globalType').value=state.type;qs('#globalDomain').value=state.domain;qs('#globalSearch').value=state.search;qs('#explorerProject').value=state.project;qs('#explorerType').value=state.type;qs('#explorerDomain').value=state.domain;qs('#explorerSearch').value=state.search}
function explorerData(){const min=+qs('#minFiles').value||1;return filtered().filter(b=>b.filesChanged>=min)}
function renderExplorer(){const data=explorerData();state.page=Math.min(state.page,Math.max(0,Math.ceil(data.length/state.pageSize)-1));const slice=data.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);qs('#bugTableSummary').textContent=`${fmt(data.length)} matching bugs`;qs('#pageInfo').textContent=`Page ${state.page+1} of ${Math.max(1,Math.ceil(data.length/state.pageSize))}`;qs('#prevPage').disabled=state.page===0;qs('#nextPage').disabled=(state.page+1)*state.pageSize>=data.length;qs('#bugTable tbody').innerHTML=slice.map(b=>`<tr data-record-id="${escapeHtml(b.recordId)}" class="${state.selectedBug?.recordId===b.recordId?'selected':''}"><td><strong>${b.id}</strong></td><td>${escapeHtml(b.project)}</td><td><span class="pill">${escapeHtml(b.type)}</span></td><td>${escapeHtml(b.domain)}</td><td>${b.filesChanged}</td></tr>`).join('');qsa('#bugTable tbody tr').forEach(tr=>tr.addEventListener('click',()=>{state.selectedBug=dataset.bugByRecordId.get(tr.dataset.recordId);renderExplorer();renderBugDetail()}));if(state.selectedBug)renderBugDetail()}
function renderBugDetail(){const b=state.selectedBug;if(!b)return;const p=dataset.projectById.get(b.projectId)||{};const related=bugs.filter(x=>x.recordId!==b.recordId&&(x.categoryId===b.categoryId||x.projectId===b.projectId)).slice(0,6);qs('#bugDetail').classList.remove('empty-state');qs('#bugDetail').innerHTML=`<div class="panel-header"><div><h2>${escapeHtml(b.project)} / ${b.id}</h2><p>${escapeHtml(b.type)}</p></div><a class="button-link secondary" href="${b.link}" target="_blank">Open commit ↗</a></div><div class="detail-grid"><div class="detail-item"><span>Domain</span>${escapeHtml(b.domain)}</div><div class="detail-item"><span>Files changed</span>${b.filesChanged}</div><div class="detail-item"><span>Project size</span>${p.loc?fmt(p.loc)+' LOC':'—'}</div><div class="detail-item"><span>Stars</span>${p.stars?fmt(p.stars):'—'}</div><div class="detail-item"><span>Testing</span>${escapeHtml(p.testingFramework||'Not recorded')}</div><div class="detail-item"><span>Started</span>${escapeHtml(p.startDate||'—')}</div></div><h3>Changed files</h3><div class="files">${b.filePaths.map(f=>`<code>${escapeHtml(f)}</code>`).join('')}</div><h3>Related records</h3><div class="example-list">${related.map(x=>`<div class="example-card" data-record-id="${escapeHtml(x.recordId)}"><strong>${x.id}</strong><br><span class="small-note">${escapeHtml(x.project)} · ${escapeHtml(x.type)}</span><br><a href="${x.link}" target="_blank">Open commit</a></div>`).join('')}</div>`}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function projectCard(p){const count=bugs.filter(b=>b.projectId===p.id).length;return `<div class="project-card"><h2>${escapeHtml(p.project)}</h2><p>${escapeHtml(p.domain||'—')} · ${count} bugs</p><div class="project-meta"><div><span>LOC</span>${p.loc?fmt(p.loc):'—'}</div><div><span>Stars</span>${p.stars?fmt(p.stars):'—'}</div><div><span>Commits</span>${p.commits?fmt(p.commits):'—'}</div><div><span>Files</span>${p.files?fmt(p.files):'—'}</div><div><span>Pull requests</span>${p.pullRequests?fmt(p.pullRequests):'—'}</div><div><span>Testing</span>${escapeHtml(p.testingFramework||'—')}</div></div></div>`}
function renderCompare(){const a=projectMap.get(qs('#projectA').value),b=projectMap.get(qs('#projectB').value);charts.difference(a,b);if(!a||!b){qs('#comparisonCards').innerHTML='<p class="empty-state">No projects available.</p>';['#compareBars','#metricCompare','#dependencyCompare'].forEach(clearChart);return}qs('#comparisonCards').innerHTML=projectCard(a)+projectCard(b);const counts=p=>new Map(countBy(bugs.filter(x=>x.projectId===p.id),'type'));const ca=counts(a),cb=counts(b),ta=d3.sum([...ca.values()]),tb=d3.sum([...cb.values()]);groupedBars('#compareBars',types.map(t=>({label:t,a:ta?100*(ca.get(t)||0)/ta:null,b:tb?100*(cb.get(t)||0)/tb:null})),a.project,b.project,'%');if(!ta||!tb){const note=document.createElement('p');note.className='small-note';note.textContent=[!ta?a.project:null,!tb?b.project:null].filter(Boolean).join(', ')+': N/A — no bug samples; category percentages are undefined.';qs('#compareBars').prepend(note)}const metrics=['loc','stars','commits','recentCommits','issues','pullRequests'];const max={};metrics.forEach(k=>max[k]=Math.max(a[k]||0,b[k]||0));groupedBars('#metricCompare',metrics.map(k=>({label:k.replace(/([A-Z])/g,' $1'),a:100*(a[k]||0)/(max[k]||1),b:100*(b[k]||0)/(max[k]||1)})),a.project,b.project,'% of pair maximum');const depCats=dataset.dependencyCategories;const depCount=(p,c)=>dependencies.filter(d=>d.dependencyCategoryId===c.id&&d.projectIds.includes(p.id)).length;groupedBars('#dependencyCompare',depCats.map(c=>({label:c.label,a:depCount(a,c),b:depCount(b,c)})),a.project,b.project,' dependencies')}
function groupedBars(sel,data,nameA,nameB,suffix=''){clearChart(sel);const wrap=qs(sel),w=Math.max(600,wrap.clientWidth||700),h=Math.max(300,data.length*34+60),m={top:25,right:40,bottom:35,left:210};const svg=d3.select(sel).append('svg').attr('viewBox',`0 0 ${w} ${h}`);const x=d3.scaleLinear().domain([0,d3.max(data,d=>Math.max(d.a??0,d.b??0))||1]).nice().range([m.left,w-m.right]),y=d3.scaleBand().domain(data.map(d=>d.label)).range([m.top,h-m.bottom]).padding(.25),sub=d3.scaleBand().domain(['a','b']).range([0,y.bandwidth()]).padding(.08);svg.append('g').attr('transform',`translate(0,${h-m.bottom})`).call(d3.axisBottom(x).ticks(5));svg.append('g').attr('transform',`translate(${m.left},0)`).call(d3.axisLeft(y).tickSize(0)).call(g=>g.select('.domain').remove());['a','b'].forEach((k,i)=>svg.selectAll(`.${k}`).data(data.filter(d=>d[k]!==null)).join('rect').attr('class',k).attr('x',m.left).attr('y',d=>y(d.label)+sub(k)).attr('height',sub.bandwidth()).attr('width',d=>x(d[k])-m.left).attr('fill',i===0?'#4f46e5':'#0891b2').attr('rx',3).on('mousemove',(e,d)=>showTip(e,`<b>${escapeHtml(d.label)}</b><br>${escapeHtml(i===0?nameA:nameB)}: ${d[k].toFixed(1)}${suffix}`)).on('mouseleave',hideTip));svg.append('text').attr('x',m.left).attr('y',14).attr('fill','#4f46e5').attr('font-size',11).text(`■ ${nameA}`);svg.append('text').attr('x',m.left+150).attr('y',14).attr('fill','#0891b2').attr('font-size',11).text(`■ ${nameB}`)}
function selectedValues(sel){return facets[sel]?facets[sel].values():qsa(`${sel} .criterion-option[aria-selected="true"]`).map(option=>option.dataset.value)}
function benchmarkData(){const ps=selectedValues('#benchProjects'),ts=selectedValues('#benchTypes'),ds=selectedValues('#benchDomains'),min=+qs('#benchMinFiles').value||1;return bugs.filter(b=>ps.includes(b.project)&&ts.includes(b.type)&&ds.includes(b.domainId)&&b.filesChanged>=min)}
function renderBenchmark(){const data=benchmarkData(),ps=new Set(data.map(d=>d.project)),ts=new Set(data.map(d=>d.type));qs('#benchmarkMetrics').innerHTML=[['Selected bugs',fmt(data.length),data.length?'Ready for export':'No matching Bug samples'],['Projects',ps.size,`${projects.length} available`],['Categories',ts.size,`${types.length} available`],['Changed files',fmt(d3.sum(data,d=>d.filesChanged)),'Across selected fixes']].map(x=>`<div class="metric"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join('');if(data.length){horizontalBars('#benchmarkCategory',countBy(data,'type'),null);horizontalBars('#benchmarkProject',countBy(data,'project'),null,{left:110,color:()=> '#0f766e'})}else{['#benchmarkCategory','#benchmarkProject'].forEach(sel=>{qs(sel).innerHTML='<p class="empty-state">No matching Bug samples. Select options in every criterion group to build a benchmark.</p>'})}qs('#benchmarkSummary').textContent=`TSBugs custom benchmark\nBugs: ${data.length}\nProjects: ${[...ps].join(', ')||'none'}\nCategories: ${[...ts].join(', ')||'none'}\nMinimum files changed: ${qs('#benchMinFiles').value}`}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function taxonomy(){const list=qs('#taxonomyList');list.innerHTML='<h2>Bug taxonomy</h2>'+types.map((t,i)=>`<div class="taxonomy-item ${i===0?'active':''}" data-category-id="${escapeHtml(defs[t].id)}"><span>${escapeHtml(t)}</span><strong>${bugs.filter(b=>b.categoryId===defs[t].id).length}</strong></div>`).join('');qsa('.taxonomy-item').forEach(el=>el.addEventListener('click',()=>{qsa('.taxonomy-item').forEach(x=>x.classList.remove('active'));el.classList.add('active');renderTaxonomyDetail(dataset.categoryById.get(el.dataset.categoryId).label)}));if(types.length)renderTaxonomyDetail(types[0]);else qs('#taxonomyDetail').innerHTML='<p class="empty-state">No bug categories available.</p>'}
function renderTaxonomyDetail(t){const d=defs[t],examples=d.representatives;qs('#taxonomyDetail').innerHTML=`<h2>${escapeHtml(t)}</h2><p class="definition">${escapeHtml(d.definition)}</p><div class="taxonomy-section"><h3>Decision guidance</h3><ul>${d.rules.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div><div class="taxonomy-section"><h3>Commonly neighbouring categories</h3>${d.confusions.map(x=>`<span class="pill">${escapeHtml(x)}</span>`).join(' ')||'—'}</div><div class="taxonomy-section"><h3>Representative records</h3><div class="example-list">${examples.map(x=>`<div class="example-card" data-record-id="${escapeHtml(x.recordId)}"><strong>${escapeHtml(x.project)} / ${x.id}</strong><br><span class="small-note">${escapeHtml(x.domain)} · ${x.filesChanged} files</span><br><a href="${x.link}" target="_blank">Inspect commit ↗</a></div>`).join('')||'<p class="small-note">No representative records configured.</p>'}</div></div>`}
function renderAll(){renderDashboard();renderExplorer();renderCompare();renderBenchmark()}
function switchView(id){qsa('.view').forEach(v=>v.classList.toggle('active',v.id===id));qsa('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===id));if(id==='compare')renderCompare();if(id==='benchmark')renderBenchmark();if(id==='taxonomy')taxonomy()}
// Render successfully before attaching shared handlers, so a failed startup can retry safely.
syncGlobals();taxonomy();renderAll();
['#benchProjects','#benchTypes','#benchDomains'].forEach(sel=>{facets[sel]=createBenchmarkFacet(qs(sel),renderBenchmark)});
qsa('[data-category-mode]').forEach(button=>button.addEventListener('click',()=>{view.categoryMode=button.dataset.categoryMode;hideTip();charts.category(filtered(true),state.type,view.categoryMode)}));
qsa('[data-heatmap-labels]').forEach(button=>button.addEventListener('click',()=>{view.heatmapLabels=button.dataset.heatmapLabels;hideTip();renderHeatmap()}));
qs('#categoryChip').addEventListener('click',()=>setFilter('type',''));
qs('#domainChip').addEventListener('click',()=>setFilter('domain',''));
qs('#projectChip').addEventListener('click',()=>setFilter('project',''));
qs('#allDomains').addEventListener('click',()=>setFilter('domain',''));
qsa('.tab').forEach(t=>t.addEventListener('click',()=>switchView(t.dataset.view)));
[['#globalProject','project'],['#globalType','type'],['#globalDomain','domain'],['#globalSearch','search'],['#explorerProject','project'],['#explorerType','type'],['#explorerDomain','domain'],['#explorerSearch','search']].forEach(([sel,k])=>qs(sel).addEventListener(sel.includes('Search')?'input':'change',e=>{setFilter(k,e.target.value)}));
qs('#minFiles').addEventListener('input',()=>{state.page=0;renderExplorer()});qs('#prevPage').addEventListener('click',()=>{state.page--;renderExplorer()});qs('#nextPage').addEventListener('click',()=>{state.page++;renderExplorer()});
qs('#clearExplorer').addEventListener('click',()=>{state.project=state.type=state.domain=state.search='';qs('#minFiles').value=1;syncGlobals();renderAll()});qs('#resetAll').addEventListener('click',()=>{state.project=state.type=state.domain=state.search='';state.selectedBug=null;state.page=0;qs('#minFiles').value=1;syncGlobals();renderAll()});
['#projectA','#projectB'].forEach(s=>qs(s).addEventListener('change',renderCompare));qs('#benchMinFiles').addEventListener('change',renderBenchmark);
qs('#benchSelectAll').addEventListener('click',()=>{Object.values(facets).forEach(f=>f.selectAll(false));renderBenchmark()});qs('#benchClear').addEventListener('click',()=>{Object.values(facets).forEach(f=>f.clear(false));renderBenchmark()});
qs('#exportCsv').addEventListener('click',()=>download('tsbugs-benchmark.csv',toLegacyCsv(benchmarkData()),'text/csv'));qs('#exportJson').addEventListener('click',()=>download('tsbugs-benchmark.json',JSON.stringify(toLegacyRecords(benchmarkData()),null,2),'application/json'));qs('#downloadCurrentCsv').addEventListener('click',()=>download('tsbugs-current-view.csv',toLegacyCsv(explorerData()),'text/csv'));
qs('#copySummary').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(qs('#benchmarkSummary').textContent);toast('Benchmark summary copied')}catch{toast('Copy unavailable; select the summary manually')}});
function toast(msg){const el=qs('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}
window.addEventListener('resize',()=>{renderDashboard();if(qs('#compare').classList.contains('active'))renderCompare();if(qs('#benchmark').classList.contains('active'))renderBenchmark()});
}

const status = document.querySelector('#dataStatus');
const message = document.querySelector('#dataMessage');
const retry = document.querySelector('#retryLoad');
const main = document.querySelector('main');
const navigation = document.querySelector('nav');
const reset = document.querySelector('#resetAll');
let loading = false;
let initialized = false;

async function start() {
  if (loading || initialized) return;
  loading = true;
  retry.hidden = true;
  message.textContent = 'Loading benchmark data…';
  try {
    const dataset = await loadDataset();
    if (!globalThis.d3) throw new Error('D3 could not load. Check your connection and reload the page.');
    main.hidden = false;
    initializeApplication(dataset);
    initialized = true;
    status.hidden = true;
    navigation.inert = false;
    reset.disabled = false;
  } catch (error) {
    main.hidden = true;
    message.textContent = `Unable to load benchmark data. ${error.message}`;
    retry.hidden = false;
  } finally {
    loading = false;
  }
}

retry.addEventListener('click', start);
start();
