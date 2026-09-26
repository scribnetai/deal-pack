/* Deal Pack unit tests — pure logic only (js/logic.js). Run: node tests/run.js */
'use strict';
const assert = require('node:assert');
const L = require('../js/logic.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + e.message); }
}
const approx = (a, b, tol) => { if (Math.abs(a - b) > (tol || 1e-6)) throw new Error(a + ' !~= ' + b); };

console.log('== import validation ==');
const demo = L.demoDeal();
t('demo envelopes validate for their slots', () => {
  for (const slot of ['analyzer', 'server', 'storage', 'network']) {
    const r = L.validateImport(slot, demo[slot]);
    assert.strictEqual(r.ok, true, slot + ': ' + r.error);
  }
});
t('wrong-app file is rejected with a helpful pointer', () => {
  const r = L.validateImport('server', demo.analyzer);
  assert.strictEqual(r.ok, false);
  assert.ok(/Server Sizer/i.test(r.error) === false, 'should not claim to be a server file');
  assert.ok(/RVTools Analyzer/i.test(r.error), 'should name the actual app: ' + r.error);
});
t('unknown app id is rejected', () => {
  const r = L.validateImport('network', { app: 'mystery-app', version: 1, state: {} });
  assert.strictEqual(r.ok, false);
});
t('newer version is rejected', () => {
  const d = JSON.parse(JSON.stringify(demo.server)); d.version = 99;
  const r = L.validateImport('server', d);
  assert.strictEqual(r.ok, false);
  assert.ok(/newer/i.test(r.error));
});
t('missing state data is rejected', () => {
  assert.strictEqual(L.validateImport('analyzer', { app: 'rvtools-analyzer', version: 1, state: {} }).ok, false);
  assert.strictEqual(L.validateImport('storage', { app: 'storage-sizer', version: 1, state: { pools: 'nope' } }).ok, false);
});
t('non-object input is rejected', () => {
  assert.strictEqual(L.validateImport('server', null).ok, false);
  assert.strictEqual(L.validateImport('server', 'hello').ok, false);
});

console.log('== ported sizing math ==');
t('sizeCluster: hand-computed refresh build', () => {
  const c = { allocVCpu: 288, allocMemGB: 1152, usedStorageTB: 8.4 };
  const r = L.sizeCluster(c, L.defaultServerCfg());
  assert.strictEqual(r.finalHosts, 3);
  assert.strictEqual(r.binding, 'balanced');
  assert.strictEqual(r.totalLic, 192);
  assert.strictEqual(r.totalPhantom, 0);
});
t('sizePoolYear: hand-computed chain', () => {
  const p = { usedTB: 10, provisionedTB: 20 };
  const r = L.sizePoolYear(p, L.defaultStorageCfg(), L.defaultStorageGlobal(), 0);
  approx(r.raw, 17.9739, 0.01);
  assert.strictEqual(r.localF, 2.0);
});
t('sizeEthernet: hand-computed TOR plan', () => {
  const r = L.sizeEthernet(12, L.defaultNetProf(), L.defaultNetEth());
  assert.strictEqual(r.switches, 2);
  approx(r.over, 1.02, 0.001);
  assert.strictEqual(r.servedPorts, 72);
});
t('sizeFC: dual-fabric math', () => {
  const r = L.sizeFC(12, 2, 32, L.defaultNetFc());
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.devicePorts, 12 * 2 + 2 * 4);
  assert.strictEqual(r.switches, 2);
});

console.log('== deal assembly ==');
const deal = L.buildDeal(demo);
t('demo deal assembles all four sections', () => {
  assert.strictEqual(deal.servers.length, 3);
  assert.strictEqual(deal.storage.pools.length, 2);
  assert.ok(deal.network.hosts > 0);
  assert.ok(deal.analyzer.vms > 0);
  assert.ok(deal.bom.length > 0);
  assert.ok(deal.sanity.length > 0);
});
t('analyzer summary counts are sane', () => {
  assert.strictEqual(deal.analyzer.hosts, 21);
  assert.strictEqual(deal.analyzer.clusters.length, 3);
  assert.ok(deal.analyzer.licenseCores > 0);
});
t('execSummary mentions the key numbers', () => {
  const s = L.execSummary(deal);
  assert.ok(/hosts/.test(s) && /TB raw/.test(s), s.slice(0, 120));
});
t('partial imports degrade gracefully (server only)', () => {
  const d2 = L.buildDeal({ analyzer: null, server: demo.server, storage: null, network: null });
  assert.strictEqual(d2.servers.length, 3);
  assert.strictEqual(d2.analyzer, null);
  assert.strictEqual(d2.network, null);
  assert.ok(d2.bom.length > 0 && d2.sanity.length > 0);
  assert.ok(/hosts/.test(L.execSummary(d2)));
});

console.log('== BOM consolidation ==');
t('identical server builds merge into one line', () => {
  const lines = deal.bom.filter((l) => l.cat === 'Compute');
  assert.strictEqual(lines.length, 2, 'expected Dell + HPE lines, got ' + lines.length);
  const dell = lines.find((l) => /Dell PowerEdge R760/.test(l.item));
  const c0 = deal.servers.find((s) => s.clusterId === 'c0');
  const c1 = deal.servers.find((s) => s.clusterId === 'c1');
  assert.strictEqual(dell.qty, c0.finalHosts + c1.finalHosts);
  assert.ok(/licensed cores/.test(dell.detail));
});
t('network BOM has TOR and FC lines', () => {
  const net = deal.bom.filter((l) => l.cat === 'Network');
  assert.ok(net.some((l) => /TOR/.test(l.item)), 'TOR line missing');
  assert.ok(net.some((l) => /FC SAN/.test(l.item)), 'FC line missing');
});
t('storage BOM lines are capacity, honestly labeled', () => {
  const st = deal.bom.filter((l) => l.cat === 'Storage');
  assert.strictEqual(st.length, 2);
  assert.ok(st.every((l) => /not a SKU/.test(l.detail)), 'must disclaim non-SKU');
  assert.ok(st.every((l) => l.qty > 0 && l.unit === 'TB raw'));
});

console.log('== sanity checklist ==');
t('phantom cores trigger a licensing check', () => {
  const items = L.genSanityChecks({ network: null, servers: [{ totalPhantom: 96, totalLic: 200 }], storage: null });
  assert.ok(items.some((i) => /phantom cores/i.test(i.text) && /200/.test(i.text)));
});
t('oversubscription over target triggers a check', () => {
  const items = L.genSanityChecks({
    network: {
      ethRes: { P: { label: 'S', dlSpeed: 25 }, switches: 2, servedPorts: 72, uplinks: 6, over: 5.5, unserved: 0 },
      eth: { overTarget: 3, dual: true }, fcRes: { enabled: false }, fc: {},
    },
    servers: [], storage: null,
  });
  assert.ok(items.some((i) => /versubscription/i.test(i.text) && /5\.5/.test(i.text)));
});
t('standing manual checks are always present, ids unique', () => {
  const items = L.genSanityChecks({ network: null, servers: [], storage: null });
  assert.ok(items.some((i) => /Dual PSUs/i.test(i.text)));
  assert.ok(items.some((i) => /rails/i.test(i.text)));
  assert.ok(items.some((i) => /warranty SKU/i.test(i.text)));
  const ids = items.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate check ids');
});

console.log('== TCO math ==');
t('tcoModel: hand-computed 3-year comparison', () => {
  const m = L.tcoModel({
    years: 3, curVmwareAnnual: 100000, curSupportAnnual: 20000, curKwhPrice: 0.14, curKw: 10,
    newPerCoreAnnual: 350, licCores: 100, newSupportAnnual: 15000, newKwhPrice: 0.14, newKw: 8,
    capex: 200000, pue: 1.5,
  });
  approx(m.curAnnual, 138396, 0.01);
  approx(m.newAnnual, 64716.8, 0.01);
  approx(m.newTotal, 394150.4, 0.01);
  approx(m.savings, 21037.6, 0.01);
  assert.strictEqual(m.rows.length, 3);
  approx(m.rows[2].nwCum, 394150.4, 0.01);
});
t('tcoModel defaults are safe with empty input', () => {
  const m = L.tcoModel({});
  assert.strictEqual(m.years, 3);
  assert.ok(isFinite(m.savings));
});
t('defaultTcoInputs pulls licensed cores from the deal', () => {
  const inp = L.defaultTcoInputs(deal);
  const lic = deal.servers.reduce((a, s) => a + s.totalLic, 0);
  assert.strictEqual(inp.licCores, lic);
  assert.ok(inp.newKw > 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
