'use strict';
/* ============================================================
   Deal Pack — DOM wiring. Pure logic lives in js/logic.js (L).
   100% client-side. Imports validated against the real export
   envelopes of the sibling apps before anything renders.
   ============================================================ */
const $ = (id) => document.getElementById(id);
const L0 = window.DealPackLogic;
const esc = L0.esc, fmtInt = L0.fmtInt, fmt1 = L0.fmt1, fmtUSD = L0.fmtUSD;

/* ================= App state ================= */
const APP = {
  imports: { analyzer: null, server: null, storage: null, network: null },
  tco: null, tcoTouched: false,
  checks: {},            // slug(check text) -> true when done
  dealName: 'Untitled deal',
  isDemo: false,
};
let DEAL = null; // last built deal

/* ================= Projects: save / load / export / import ================= */
const LS_AUTO = 'deal-pack:autosave';
const LS_PROJECTS = 'deal-pack:projects';
const PROJECT_VERSION = 1;

function hasDemand(s) {
  const st = s || APP;
  return !!(st.imports && Object.values(st.imports).some(Boolean));
}
function serializeState() {
  return {
    imports: APP.imports, tco: APP.tco, tcoTouched: APP.tcoTouched,
    checks: APP.checks, dealName: APP.dealName, isDemo: APP.isDemo,
  };
}
function projectEnvelope(name, state) {
  return {
    app: 'deal-pack', version: PROJECT_VERSION,
    name: (name || 'Untitled deal').slice(0, 60),
    savedAt: new Date().toISOString(),
    state: state || serializeState(),
  };
}
function validProject(d) {
  return !!(d && d.app === 'deal-pack' && d.state && typeof d.state === 'object' &&
    typeof d.version === 'number' && d.version <= PROJECT_VERSION);
}
function slugify(s) { return String(s || 'deal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deal'; }
function fmtTime(iso) {
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return ''; }
}
function checkSlug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }

let toastT = null;
function showToast(html, ms) {
  const t = $('projToast');
  t.innerHTML = html; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms || 6000);
}
function updateDealName() { $('projName').textContent = APP.dealName || 'Untitled deal'; }
let quotaWarned = false;
function lsSet(key, val) {
  try { localStorage.setItem(key, val); return true; }
  catch (e) {
    if (!quotaWarned) { quotaWarned = true; showToast('Deal too large for browser saves — use <strong>Export</strong> for a portable file instead.'); }
    return false;
  }
}
function applyProject(env) {
  const s = env.state || {};
  const imps = s.imports || {};
  // Re-validate every import envelope — a hand-edited project file shouldn't
  // inject garbage into the proposal.
  const clean = { analyzer: null, server: null, storage: null, network: null };
  for (const slot of Object.keys(clean)) {
    if (imps[slot] && L0.validateImport(slot, imps[slot]).ok) clean[slot] = imps[slot];
  }
  APP.imports = clean;
  APP.tco = (s.tco && typeof s.tco === 'object') ? s.tco : null;
  APP.tcoTouched = !!s.tcoTouched;
  APP.checks = (s.checks && typeof s.checks === 'object') ? s.checks : {};
  APP.dealName = env.name || 'Untitled deal';
  APP.isDemo = !!s.isDemo;
  if (!hasDemand()) { showToast('That deal has no imports — nothing to restore.'); return; }
  $('landing').hidden = true; $('workspace').hidden = false;
  updateDealName();
  rebuild();
  queueAutosave();
}

/* ---- autosave (this browser only) ---- */
let autosaveT = null;
function queueAutosave() { clearTimeout(autosaveT); autosaveT = setTimeout(autosaveNow, 900); }
function autosaveNow() {
  if (!hasDemand()) return;
  try {
    const json = JSON.stringify(projectEnvelope(APP.dealName, serializeState()));
    if (json.length > 4 * 1024 * 1024) return; // too big for localStorage — export instead
    if (!lsSet(LS_AUTO, json)) return;
    $('projSaved').textContent = '· autosaved ' + fmtTime(new Date().toISOString());
  } catch (e) { /* private mode / quota — non-fatal */ }
}
function clearAutosave() { try { localStorage.removeItem(LS_AUTO); } catch (e) {} }

/* ---- named deals (this browser only) ---- */
function getProjects() { try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]'); } catch (e) { return []; } }
function setProjects(list) { lsSet(LS_PROJECTS, JSON.stringify(list.slice(0, 30))); }
function renderProjList() {
  const list = getProjects();
  const box = $('projList');
  if (!list.length) { box.innerHTML = '<p class="muted" style="font-size:.85rem">No saved deals yet — name it above and hit <strong>Save deal</strong>.</p>'; return; }
  box.innerHTML = list.map((p) => {
    const n = p.state && p.state.imports ? Object.values(p.state.imports).filter(Boolean).length : 0;
    return '<div class="proj-item"><div><div class="nm">' + esc(p.name || 'Untitled deal') + '</div>' +
      '<div class="meta">saved ' + esc(fmtTime(p.savedAt)) + ' · ' + n + ' import' + (n === 1 ? '' : 's') + '</div></div>' +
      '<div class="ops"><button class="btn ghost" data-load="' + p.id + '">Load</button>' +
      '<button class="btn danger-ghost" data-delp="' + p.id + '">Delete</button></div></div>';
  }).join('');
  box.querySelectorAll('[data-load]').forEach((b) => { b.onclick = () => {
    const p = getProjects().find((x) => x.id === b.dataset.load);
    if (p && validProject(p)) { $('projPanel').hidden = true; applyProject(p); showToast('Loaded deal <strong>' + esc(p.name || '') + '</strong>.'); }
    else showToast('Could not load that deal — the saved data looks invalid.');
  }; });
  box.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = () => {
    setProjects(getProjects().filter((x) => x.id !== b.dataset.delp));
    renderProjList();
  }; });
}
function saveNamedProject() {
  if (!hasDemand()) { showToast('Import something first — there is nothing to save yet.'); return; }
  const input = $('projNameInput').value.trim();
  const name = (input || APP.dealName || 'Untitled deal').slice(0, 60);
  const env = projectEnvelope(name, serializeState());
  if (JSON.stringify(env).length > 4 * 1024 * 1024) {
    showToast('Deal too large for browser saves — use <strong>Export</strong> for a portable file instead.');
    return;
  }
  env.id = 'p' + Date.now().toString(36);
  const list = getProjects();
  const ix = list.findIndex((p) => (p.name || '') === name);
  if (ix >= 0) { env.id = list[ix].id; list[ix] = env; } else list.unshift(env);
  setProjects(list);
  APP.dealName = name; updateDealName();
  $('projNameInput').value = '';
  renderProjList();
  showToast('Deal <strong>' + esc(name) + '</strong> saved in this browser.');
  queueAutosave();
}

/* ---- export / import (.json) ---- */
function exportProject() {
  if (!hasDemand()) { showToast('Import something first — there is nothing to export yet.'); return; }
  const env = projectEnvelope(APP.dealName, serializeState());
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deal-pack-' + slugify(env.name) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast('Exported <strong>' + esc(a.download) + '</strong> — keep it with the engagement files.');
}
function importProjectFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!validProject(d)) { showToast('<strong>Not a Deal Pack project file.</strong> Pick a JSON exported from this app.'); return; }
      $('projPanel').hidden = true;
      applyProject(d);
      showToast('Imported deal <strong>' + esc(d.name || 'Untitled') + '</strong>.');
    } catch (e) { showToast('<strong>Could not read that file.</strong> ' + esc(e.message || '')); }
  };
  rd.readAsText(file);
}

function wireProjects() {
  const toggle = () => {
    const p = $('projPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $('projNameInput').value = APP.dealName === 'Untitled deal' ? '' : APP.dealName;
      renderProjList();
      $('projNameInput').focus();
    }
  };
  $('projBtn').onclick = toggle;
  $('projDoSave').onclick = saveNamedProject;
  $('projNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNamedProject(); });
  $('projExportBtn').onclick = exportProject;
  $('projImportBtn').onclick = () => $('projImportFile').click();
  $('projImportFile').addEventListener('change', (e) => { importProjectFile(e.target.files[0]); e.target.value = ''; });
  // restore last session, if any
  try {
    const raw = localStorage.getItem(LS_AUTO);
    if (raw) {
      const d = JSON.parse(raw);
      if (validProject(d) && d.state && d.state.imports && Object.values(d.state.imports).some(Boolean)) {
        $('landing').hidden = true; $('workspace').hidden = false;
        applyProject(d);
        showToast('Restored your last session — <a href="#" id="freshStart" style="color:inherit"><u>start fresh</u></a> instead?');
        const fs = $('freshStart');
        if (fs) fs.onclick = (e) => { e.preventDefault(); startOver(); };
      }
    }
  } catch (e) { /* corrupted autosave — ignore */ }
}

/* ================= Deal build + render ================= */
function rebuild() {
  DEAL = L0.buildDeal(APP.imports);
  if (!APP.tcoTouched || !APP.tco) APP.tco = L0.defaultTcoInputs(DEAL);
  renderAll();
  queueAutosave();
}
function importStats(slot) {
  const env = APP.imports[slot];
  if (!env) return null;
  const st = env.state || {};
  if (slot === 'analyzer') {
    const s = L0.summarizeParsed(st.parsed);
    return fmtInt(s.hosts) + ' hosts · ' + fmtInt(s.vms) + ' VMs';
  }
  if (slot === 'server') return (st.clusters || []).length + ' cluster' + ((st.clusters || []).length === 1 ? '' : 's');
  if (slot === 'storage') return (st.pools || []).length + ' pool' + ((st.pools || []).length === 1 ? '' : 's');
  if (slot === 'network') {
    const g = st.groups || [];
    return g.reduce((a, x) => a + (x.hosts || 0), 0) + ' hosts in ' + g.length + ' groups';
  }
  return 'loaded';
}
function renderImportCards() {
  document.querySelectorAll('.import-card').forEach((card) => {
    const slot = card.dataset.slot;
    const env = APP.imports[slot];
    const stEl = $('st-' + slot);
    const clearBtn = card.querySelector('[data-clear]');
    if (env) {
      card.classList.add('loaded');
      stEl.innerHTML = '✓ <strong>' + esc(env.name || 'Untitled') + '</strong><br><span class="muted">' + esc(importStats(slot) || '') + '</span>';
      clearBtn.hidden = false;
    } else {
      card.classList.remove('loaded');
      stEl.innerHTML = { analyzer: 'No import yet — current-state findings will be empty.', server: 'No import yet — no compute builds.', storage: 'No import yet — no capacity plan.', network: 'No import yet — no switch plan.' }[slot];
      clearBtn.hidden = true;
    }
  });
}
function emptyStateHTML() {
  return '<div class="panel"><h3 style="margin-top:0">Nothing to propose yet 🤷</h3>' +
    '<p class="muted">Import project files from the suite above — or hit <strong>✨ Load demo deal</strong> to see a full proposal in one click.</p></div>';
}
function demoBannerHTML() {
  return APP.isDemo ? '<div class="note-box">🧪 You’re viewing the <strong>synthetic demo deal</strong> — every number on this page is made up. Import your own exports for a real proposal.</div>' : '';
}
/* ================= Tab renderers ================= */
function renderProposal() {
  const el = $('tab-proposal');
  if (!DEAL || !hasDemand()) { el.innerHTML = emptyStateHTML(); return; }
  const d = DEAL;
  let h = demoBannerHTML();
  h += '<div class="panel"><h3 style="margin-top:0">Executive summary</h3><p>' + L0.execSummary(d) + '</p></div>';

  // Current state
  h += '<div class="panel"><h3 style="margin-top:0">Current state</h3>';
  if (d.analyzer) {
    const a = d.analyzer;
    h += '<div class="stat-grid">' +
      stat(a.hosts, 'hosts') + stat(a.vms, 'VMs') + stat(a.clusters.length, 'clusters') +
      stat(a.licenseCores, 'licensed cores') + stat(a.snapVMs, 'VMs w/ snapshots') + stat(a.datastores, 'datastores') + '</div>';
    h += '<table class="data"><thead><tr><th>Cluster</th><th class="num">Hosts</th><th class="num">Sockets</th><th class="num">Licensed cores</th></tr></thead><tbody>' +
      a.clusters.map((c) => '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.hosts + '</td><td class="num">' + c.sockets + '</td><td class="num">' + fmtInt(c.licenseCores) + '</td></tr>').join('') +
      '</tbody></table>';
    if (a.phantomCores > 0) h += '<p class="muted">Includes <strong>' + fmtInt(a.phantomCores) + ' phantom cores</strong> from the 16-core/socket minimum on the current estate.</p>';
  } else h += '<p class="muted">Import the <strong>RVTools Analyzer</strong> export to fill in current-state findings.</p>';
  h += '</div>';

  // Proposed architecture
  h += '<div class="panel"><h3 style="margin-top:0">Proposed architecture</h3>';
  if (d.servers.length) {
    h += '<h4>Compute</h4><table class="data"><thead><tr><th>Cluster</th><th>Platform</th><th class="num">Hosts</th><th>Binding</th><th class="num">Lic. cores</th></tr></thead><tbody>' +
      d.servers.map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.platform) + '<br><span class="muted small">' + esc(s.hostLabel) + '</span></td>' +
        '<td class="num">' + s.finalHosts + (s.spares ? ' <span class="muted small">(+' + s.spares + ' spare)</span>' : '') + '</td>' +
        '<td>' + esc(s.binding) + '</td><td class="num">' + fmtInt(s.totalLic) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  if (d.network) {
    const n = d.network;
    h += '<h4>Network</h4><table class="data"><tbody>' +
      '<tr><td>TOR</td><td>' + n.ethRes.switches + ' × ' + esc(n.ethRes.P.label) + ' <span class="muted">(' + n.ethRes.servedPorts + ' ports, ' +
      (isFinite(n.ethRes.over) ? fmt1(n.ethRes.over) + ':1 oversubscription' : 'no uplinks modeled') + ')</span></td></tr>' +
      (n.fcRes.enabled ? '<tr><td>FC SAN</td><td>' + n.fcRes.switches + ' × ' + esc(n.fcRes.P.label) + ' <span class="muted">(' + (n.fc.dual ? 'Fabric A/B' : 'single fabric') + ', ' + n.fcRes.devicePorts + ' device ports)</span></td></tr>' : '') +
      (n.hasInventory ? '<tr><td>Inventory</td><td><span class="muted">Existing switches accounted — BOM shows net-new.</span></td></tr>' : '') +
      '</tbody></table>';
  }
  if (d.storage) {
    h += '<h4>Storage</h4><table class="data"><thead><tr><th>Pool</th><th class="num">Raw TB by yr ' + d.storage.horizon + '</th><th>Protection</th></tr></thead><tbody>' +
      d.storage.pools.map((p) => '<tr><td>' + esc(p.name) + '</td><td class="num">' + fmt1(p.rawTB) + '</td><td class="muted small">' + esc(p.detail) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  if (!d.servers.length && !d.network && !d.storage) h += '<p class="muted">Import the <strong>Server Sizer</strong>, <strong>Storage Sizer</strong> or <strong>Network Sizer</strong> export to build the proposed architecture.</p>';
  h += '</div>';

  // Next steps
  h += '<div class="panel"><h3 style="margin-top:0">Next steps</h3><ol>' +
    '<li>Walk the customer through the <strong>Checklist</strong> tab — every unchecked item is a question for the technical win.</li>' +
    '<li>Fill in the <strong>TCO</strong> tab with real pricing to build the money slide.</li>' +
    '<li>Download the <strong>Report</strong>, review it, and send it — it\'s standalone HTML that prints cleanly.</li>' +
    '</ol></div>';
  el.innerHTML = h;
}
function stat(v, l) { return '<div class="stat"><div class="v">' + fmtInt(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }

function renderBOM() {
  const el = $('tab-bom');
  if (!DEAL || !hasDemand()) { el.innerHTML = emptyStateHTML(); return; }
  let h = demoBannerHTML();
  const cats = {};
  DEAL.bom.forEach((l) => { (cats[l.cat] = cats[l.cat] || []).push(l); });
  h += '<div class="panel"><h3 style="margin-top:0">Consolidated BOM</h3>' +
    '<p class="muted">One list across compute, network and storage — quantities recomputed from your imports. Storage lines are capacity requirements, not orderable SKUs.</p>';
  Object.keys(cats).forEach((cat) => {
    h += '<h4>' + esc(cat) + '</h4><table class="data"><thead><tr><th>Item</th><th class="num">Qty</th><th>Notes</th></tr></thead><tbody>' +
      cats[cat].map((l) => '<tr><td><strong>' + esc(l.item) + '</strong></td><td class="num">' + (typeof l.qty === 'number' && l.unit === 'TB raw' ? fmt1(l.qty) : fmtInt(l.qty)) + ' ' + esc(l.unit) + '</td><td class="muted small">' + esc(l.detail) + '</td></tr>').join('') +
      '</tbody></table>';
  });
  h += '</div>';
  el.innerHTML = h;
}

function renderChecklist() {
  const el = $('tab-checklist');
  if (!DEAL || !hasDemand()) { el.innerHTML = emptyStateHTML(); return; }
  const items = DEAL.sanity;
  const done = items.filter((i) => APP.checks[checkSlug(i.text)]).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  let h = demoBannerHTML();
  h += '<div class="panel"><h3 style="margin-top:0">Quote sanity checklist</h3>' +
    '<p class="muted">' + done + ' of ' + items.length + ' checked — progress saves with the deal.</p>' +
    '<div class="progress"><div style="width:' + pct + '%"></div></div>';
  const auto = items.filter((i) => i.kind !== 'manual'), manual = items.filter((i) => i.kind === 'manual');
  h += '<h4>Raised by your numbers</h4>' + auto.map(checkHTML).join('');
  h += '<h4 style="margin-top:20px">The classics</h4>' + manual.map(checkHTML).join('');
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll('input[data-check]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) APP.checks[cb.dataset.check] = true; else delete APP.checks[cb.dataset.check];
      queueAutosave();
      renderChecklist(); // refresh progress
    };
  });
}
function checkHTML(i) {
  const slug = checkSlug(i.text), done = !!APP.checks[slug];
  return '<label class="check-item' + (done ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(slug) + '"' + (done ? ' checked' : '') + '>' +
    '<span class="txt">' + esc(i.text) + '</span><span class="kind">' + esc(i.kind) + '</span></label>';
}

/* ---- TCO tab ---- */
const TCO_FIELDS = [
  ['years', 'Horizon (years)', 'select:3,5'],
  ['curVmwareAnnual', 'Current VMware licensing /yr ($)', 'num'],
  ['curSupportAnnual', 'Current support renewals /yr ($)', 'num'],
  ['curKw', 'Current draw (kW, est.)', 'num'],
  ['curKwhPrice', 'Power price ($/kWh)', 'num'],
  ['newPerCoreAnnual', 'New platform, per licensed core /yr ($)', 'num'],
  ['licCores', 'Licensed cores (auto)', 'num'],
  ['newSupportAnnual', 'New support renewals /yr ($)', 'num'],
  ['newKw', 'New draw (kW, est.)', 'num'],
  ['newKwhPrice', 'Power price ($/kWh)', 'num'],
  ['capex', 'Hardware capex ($)', 'num'],
  ['pue', 'PUE', 'num'],
];
function renderTCO() {
  const el = $('tab-tco');
  if (!DEAL || !hasDemand()) { el.innerHTML = emptyStateHTML(); return; }
  const t = APP.tco;
  let h = demoBannerHTML();
  h += '<div class="panel"><h3 style="margin-top:0">TCO — old vs new</h3>' +
    '<div class="note-box">📐 <strong>Planning model, not a quote.</strong> Simple arithmetic on <em>your</em> inputs — no taxes, financing, discount tiers or vendor price lists. Garbage in, garbage out.</div>' +
    '<div class="tco-grid" id="tcoInputs">' +
    TCO_FIELDS.map(([k, label, type]) => {
      let input;
      if (type.startsWith('select:')) {
        const opts = type.slice(7).split(',');
        input = '<select data-tco="' + k + '">' + opts.map((o) => '<option value="' + o + '"' + (String(t[k]) === o ? ' selected' : '') + '>' + o + ' years</option>').join('') + '</select>';
      } else {
        input = '<input data-tco="' + k + '" type="number" min="0" step="any" value="' + esc(t[k]) + '">';
      }
      return '<div><label>' + esc(label) + '</label>' + input + '</div>';
    }).join('') + '</div><div id="tcoResults"></div></div>';
  el.innerHTML = h;
  const render = () => { $('tcoResults').innerHTML = tcoResultsHTML(L0.tcoModel(APP.tco)); };
  render();
  $('tcoInputs').addEventListener('input', (e) => {
    const k = e.target.dataset.tco;
    if (!k) return;
    APP.tco[k] = k === 'years' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
    if (!isFinite(APP.tco[k])) APP.tco[k] = 0;
    APP.tcoTouched = true;
    queueAutosave();
    render();
  });
}
function tcoResultsHTML(m) {
  const max = Math.max(m.curTotal, m.newTotal, 1);
  const bar = (v, cls) => '<div class="bar ' + cls + '" style="width:' + Math.max(2, Math.round(v / max * 320)) + 'px"></div>';
  let h = '<h4>' + m.years + '-year comparison</h4>' +
    '<div class="bar-row"><div class="lbl">Current (' + fmtUSD(m.curTotal) + ')</div>' + bar(m.curTotal, '') + '<div class="val">' + fmtUSD(m.curAnnual) + '/yr</div></div>' +
    '<div class="bar-row"><div class="lbl">Proposed (' + fmtUSD(m.newTotal) + ')</div>' + bar(m.newTotal, 'alt') + '<div class="val">' + fmtUSD(m.newAnnual) + '/yr + capex</div></div>' +
    '<p><strong>' + (m.savings >= 0 ? 'Saves ' : 'Costs an extra ') + fmtUSD(Math.abs(m.savings)) + '</strong> over ' + m.years + ' years ' +
    '<span class="muted">(current ' + fmtUSD(m.curTotal) + ' vs proposed ' + fmtUSD(m.newTotal) + ')</span></p>' +
    '<table class="data"><thead><tr><th>Year</th><th class="num">Current (cum.)</th><th class="num">Proposed (cum.)</th></tr></thead><tbody>' +
    m.rows.map((r) => '<tr><td>' + r.year + '</td><td class="num">' + fmtUSD(r.curCum) + '</td><td class="num">' + fmtUSD(r.nwCum) + '</td></tr>').join('') +
    '</tbody></table>' +
    '<p class="muted small">Power math: kW × 8,760 hrs × $/kWh × PUE. Current power ' + fmtUSD(m.curPowerAnnual) + '/yr · proposed power ' + fmtUSD(m.newPowerAnnual) + '/yr · proposed licensing ' + fmtUSD(m.newLicAnnual) + '/yr.</p>';
  return h;
}

/* ---- Report tab + downloadable HTML ---- */
function renderReportTab() {
  const el = $('tab-report');
  if (!DEAL || !hasDemand()) { el.innerHTML = emptyStateHTML(); return; }
  el.innerHTML = demoBannerHTML() +
    '<div class="panel"><h3 style="margin-top:0">Customer-ready report</h3>' +
    '<p class="muted">The full proposal as a standalone HTML file — executive summary, current state, architecture, BOM, TCO, checklist status. No dependencies, prints cleanly.</p>' +
    '<button class="btn primary" id="dlReport">⬇ Download report (.html)</button>' +
    '<p class="muted small" style="margin-bottom:0">Review it before sending — it\'s generated from your inputs, and you\'re the SE signing off on it.</p></div>';
  $('dlReport').onclick = downloadReport;
}
function buildReportHTML() {
  const d = DEAL, t = APP.tco, m = L0.tcoModel(t);
  const checked = d.sanity.filter((i) => APP.checks[checkSlug(i.text)]).length;
  const css = 'body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:900px;margin:0 auto;padding:32px;line-height:1.55}' +
    'h1{font-size:1.9rem}h2{border-bottom:2px solid #4f8cff;padding-bottom:6px;margin-top:36px}' +
    'table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;font-size:.92rem}' +
    'th{background:#f2f5fa}.num{text-align:right}.muted{color:#666}.small{font-size:.85rem}' +
    '.check{margin:4px 0}.foot{margin-top:48px;border-top:1px solid #ddd;padding-top:12px;color:#666;font-size:.85rem}' +
    '@media print{body{padding:0}h2{break-after:avoid}table{break-inside:avoid}}';
  let h = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>' + esc(APP.dealName) + ' — refresh proposal</title><style>' + css + '</style></head><body>';
  h += '<p class="muted">' + esc(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })) + (APP.isDemo ? ' · <strong>DEMO DATA — synthetic, do not quote</strong>' : '') + '</p>';
  h += '<h1>' + esc(APP.dealName) + ' — infrastructure refresh proposal</h1>';
  h += '<h2>Executive summary</h2><p>' + L0.execSummary(d) + '</p>';
  if (d.analyzer) {
    const a = d.analyzer;
    h += '<h2>Current state</h2><p>' + fmtInt(a.hosts) + ' hosts, ' + fmtInt(a.vms) + ' VMs (' + fmtInt(a.poweredOn) + ' powered on) across ' +
      a.clusters.length + ' clusters · ' + fmtInt(a.licenseCores) + ' licensed cores (16-core/socket minimum) · ' +
      a.snapVMs + ' VMs with snapshots · ' + a.datastores + ' datastores.</p>';
  }
  h += '<h2>Proposed architecture</h2>';
  if (d.servers.length) {
    h += '<h3>Compute</h3><table><thead><tr><th>Cluster</th><th>Platform</th><th class="num">Hosts</th><th>Binding</th><th class="num">Licensed cores</th></tr></thead><tbody>' +
      d.servers.map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.platform) + '<br><span class="muted small">' + esc(s.hostLabel) + '</span></td><td class="num">' + s.finalHosts + '</td><td>' + esc(s.binding) + '</td><td class="num">' + fmtInt(s.totalLic) + '</td></tr>').join('') + '</tbody></table>';
  }
  if (d.network) {
    const n = d.network;
    h += '<h3>Network</h3><p>' + n.ethRes.switches + ' × ' + esc(n.ethRes.P.label) + ' (TOR)' +
      (n.fcRes.enabled ? ' · ' + n.fcRes.switches + ' × ' + esc(n.fcRes.P.label) + ' (FC SAN, ' + (n.fc.dual ? 'Fabric A/B' : 'single fabric') + ')' : '') +
      ' · ' + fmtInt(n.hosts) + ' hosts.</p>';
  }
  if (d.storage) {
    h += '<h3>Storage</h3><table><thead><tr><th>Pool</th><th class="num">Raw TB by year ' + d.storage.horizon + '</th><th>Configuration</th></tr></thead><tbody>' +
      d.storage.pools.map((p) => '<tr><td>' + esc(p.name) + '</td><td class="num">' + fmt1(p.rawTB) + '</td><td class="muted small">' + esc(p.detail) + '</td></tr>').join('') + '</tbody></table>';
  }
  h += '<h2>Bill of materials</h2><table><thead><tr><th>Category</th><th>Item</th><th class="num">Qty</th><th>Notes</th></tr></thead><tbody>' +
    d.bom.map((l) => '<tr><td>' + esc(l.cat) + '</td><td>' + esc(l.item) + '</td><td class="num">' + (l.unit === 'TB raw' ? fmt1(l.qty) : fmtInt(l.qty)) + ' ' + esc(l.unit) + '</td><td class="muted small">' + esc(l.detail) + '</td></tr>').join('') + '</tbody></table>';
  const anyTco = (t.curVmwareAnnual || t.newPerCoreAnnual || t.capex) ? true : false;
  h += '<h2>TCO talking points</h2>';
  if (anyTco) {
    h += '<p>' + m.years + '-year model: current <strong>' + fmtUSD(m.curTotal) + '</strong> vs proposed <strong>' + fmtUSD(m.newTotal) + '</strong> (incl. ' + fmtUSD(t.capex) + ' capex) — <strong>' +
      (m.savings >= 0 ? 'saves ' : 'costs an extra ') + fmtUSD(Math.abs(m.savings)) + '</strong>.</p>' +
      '<p class="muted small">Planning model from SE-supplied inputs — not a quote.</p>';
  } else {
    h += '<ul><li>Refresh consolidates the estate onto current-generation platforms with vendor support.</li>' +
      '<li>Right-sized builds avoid paying for idle capacity — every host in the BOM is bound by a real constraint.</li>' +
      '<li>Fill in the TCO tab in Deal Pack to put customer-specific numbers behind these points.</li></ul>';
  }
  h += '<h2>Quote checklist status</h2><p>' + checked + ' of ' + d.sanity.length + ' sanity checks signed off.</p>' +
    d.sanity.map((i) => '<div class="check">' + (APP.checks[checkSlug(i.text)] ? '☑' : '☐') + ' ' + esc(i.text) + '</div>').join('');
  h += '<h2>Next steps</h2><ol><li>Review the quote sanity checklist together — open items are technical-win questions.</li>' +
    '<li>Confirm growth assumptions and support terms with the customer.</li><li>Translate BOM quantities into vendor configurator SKUs.</li></ol>';
  h += '<div class="foot">Generated by Deal Pack (scribnetai.github.io/deal-pack) — 100% client-side. Verify all numbers before sending; the SE signs off on the proposal, not the tool.' + (APP.isDemo ? ' <strong>Demo data — synthetic.</strong>' : '') + '</div>';
  h += '</body></html>';
  return h;
}
function downloadReport() {
  if (!DEAL) return;
  const blob = new Blob([buildReportHTML()], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deal-pack-' + slugify(APP.dealName) + '-proposal.html';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast('Downloaded <strong>' + esc(a.download) + '</strong>.');
}

/* ================= renderAll / tabs ================= */
function renderAll() {
  renderImportCards();
  renderProposal();
  renderBOM();
  renderChecklist();
  renderTCO();
  renderReportTab();
}
function switchTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= import wiring / demo / start over ================= */
let pendingSlot = null;
function onSlotFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !pendingSlot) return;
  const slot = pendingSlot; pendingSlot = null;
  const rd = new FileReader();
  rd.onload = () => {
    let d;
    try { d = JSON.parse(rd.result); }
    catch (err) { showToast('<strong>Could not read that file.</strong> It is not valid JSON.'); return; }
    const v = L0.validateImport(slot, d);
    if (!v.ok) { showToast('<strong>Import rejected.</strong> ' + esc(v.error)); return; }
    APP.imports[slot] = d;
    APP.isDemo = false;
    rebuild();
    showToast('Imported <strong>' + esc(L0.APP_LABELS[slot]) + '</strong> — ' + esc(importStats(slot) || '') + '.');
  };
  rd.readAsText(file);
}
function loadDemo() {
  APP.imports = L0.demoDeal();
  APP.isDemo = true;
  APP.tcoTouched = false; APP.tco = null; APP.checks = {};
  rebuild();
  showToast('🧪 <strong>Demo deal loaded</strong> — synthetic data, clearly labeled. Import your own exports for a real proposal.');
}
function startOver() {
  APP.imports = { analyzer: null, server: null, storage: null, network: null };
  APP.tco = null; APP.tcoTouched = false; APP.checks = {};
  APP.dealName = 'Untitled deal'; APP.isDemo = false;
  DEAL = null;
  clearAutosave();
  updateDealName();
  $('projSaved').textContent = '';
  renderAll();
  showToast('Started over — imports cleared.');
}

/* ================= changelog ================= */
function renderChangelog() {
  const body = $('changelog-body');
  if (!body) return;
  fetch('CHANGELOG.md', { cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error('bad status'); return res.text(); })
    .then((md) => {
      let html = '', inList = false;
      const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
      for (const line of md.split('\n')) {
        if (line.startsWith('## ')) { closeList(); html += '<h4>' + esc(line.slice(3).trim()) + '</h4>'; }
        else if (line.startsWith('- ')) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + esc(line.slice(2).trim()) + '</li>'; }
        else if (line.trim() === '' || line.startsWith('# ')) { closeList(); }
        else { closeList(); html += '<p>' + esc(line.trim()) + '</p>'; }
      }
      closeList();
      body.innerHTML = html;
    })
    .catch(() => { body.innerHTML = "<p class='muted'>Changelog unavailable.</p>"; });
}

/* ================= wire up ================= */
function wireApp() {
  wireProjects();
  renderChangelog();
  document.querySelector('.cta').addEventListener('click', (e) => {
    e.preventDefault();
    $('landing').hidden = true; $('workspace').hidden = false;
    window.scrollTo({ top: 0 });
  });
  // Nav anchor links (How it works / FAQ) target sections inside #landing.
  // When the deal workspace is open, #landing is hidden and the browser can't
  // scroll to a hidden target — so exit to the landing first, then jump.
  document.querySelectorAll('.nav-links a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      const target = href.length > 1 && document.querySelector(href);
      if (!target) return; // external links (GitHub) behave normally
      e.preventDefault();
      if ($('landing').hidden) { $('workspace').hidden = true; $('landing').hidden = false; }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', href);
    });
  });
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
  document.querySelectorAll('[data-import]').forEach((b) => {
    b.onclick = () => { pendingSlot = b.dataset.import; $('slotFile').click(); };
  });
  document.querySelectorAll('[data-clear]').forEach((b) => {
    b.onclick = () => {
      APP.imports[b.dataset.clear] = null;
      APP.isDemo = false;
      rebuild();
      showToast('Removed the <strong>' + esc(L0.APP_LABELS[b.dataset.clear]) + '</strong> import.');
    };
  });
  $('slotFile').addEventListener('change', onSlotFile);
  $('demoBtn').onclick = loadDemo;
  $('startOverBtn').onclick = startOver;
  updateDealName();
  renderAll();
}
document.addEventListener('DOMContentLoaded', wireApp);
