/* ============================================================
   Deal Pack — pure logic core (no DOM).
   Ports the sizing math from the sibling apps so the proposal
   is computed from the same numbers, then adds BOM
   consolidation, the quote sanity checklist, TCO modeling,
   import validation, and demo-deal generation.

   Sizing functions below are direct ports from origin:
   - sizeCluster / defaultServerCfg / PLATFORMS: server-sizer
   - sizePoolYear / PROT / defaultStorageCfg: storage-sizer
   - sizeEthernet / sizeFC / TOR / FC presets: network-sizer
   Loaded in node via module.exports for unit tests; in the
   browser it attaches to window.DealPackLogic.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealPackLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ================= Helpers (pure) ================= */
const fmtInt = (n) => Math.round(n || 0).toLocaleString('en-US');
const fmt1 = (n) => (n == null || !isFinite(n)) ? '—' : (Math.round(n * 10) / 10).toLocaleString('en-US');
const fmtUSD = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const clampNum = (v, dflt) => { const n = parseFloat(v); return isFinite(n) ? n : dflt; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// deterministic PRNG for demo data
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ================= server-sizer math (ported) ================= */
const PLATFORMS = {
  'Dell PowerEdge R760': { sockets: 2, cpu: 'Xeon 6745P', ramGB: 1024 },
  'Cisco UCS C240 M7': { sockets: 2, cpu: 'Xeon 6745P', ramGB: 1024 },
  'HPE ProLiant DL380 Gen11': { sockets: 2, cpu: 'Xeon 6527P', ramGB: 768 },
  'Nutanix NX-8155N': { sockets: 2, cpu: 'Xeon 6745P', ramGB: 1024 },
  'Supermicro Hyper (value)': { sockets: 2, cpu: 'Xeon 6730P', ramGB: 512 },
  'Custom': null,
};
const STORAGE_REPL = {
  mirror: { label: 'FTT=1 mirror (2×)', factor: 2.0 },
  raid5: { label: 'FTT=1 RAID-5/6 (1.33×)', factor: 1.33 },
};
function defaultServerCfg() {
  return {
    basis: 'allocated', growth: 0.20, redundancy: 'n1',
    platform: 'Dell PowerEdge R760', sockets: 2, cps: 32, ramGB: 1024,
    cpu: 'Xeon 6745P', ghz: 3.1, ghzPerVcpu: 0.5,
    cpuOC: 4, memOC: 1.25, hci: false, storageTB: 15, storageRepl: 'mirror',
  };
}
function sizeCluster(cluster, cfg) {
  const hasUtil = cluster.avgCpuUtil != null && cluster.avgMemUtil != null;
  const useActual = cfg.basis === 'actual' && hasUtil;
  const demandVCpu = useActual ? cluster.allocVCpu * cluster.avgCpuUtil : cluster.allocVCpu;
  const demandMemGB = useActual ? cluster.allocMemGB * cluster.avgMemUtil : cluster.allocMemGB;
  const demandStoTB = cluster.usedStorageTB;
  const eff = 1 - cfg.growth;

  const perHostVCpu = cfg.sockets * cfg.cps * cfg.cpuOC;
  const perHostMemGB = cfg.ramGB * cfg.memOC;
  const cpuHosts = Math.max(1, Math.ceil(demandVCpu / (perHostVCpu * eff)));
  const memHosts = Math.max(1, Math.ceil(demandMemGB / (perHostMemGB * eff)));

  const demandGHz = demandVCpu * (cfg.ghzPerVcpu || 0.5);
  const perHostGHz = cfg.sockets * cfg.cps * (cfg.ghz || 2.5);
  const ghzHosts = Math.max(1, Math.ceil(demandGHz / (perHostGHz * eff)));

  let stoHosts = 0, perHostUsableTB = 0;
  if (cfg.hci) {
    const repl = STORAGE_REPL[cfg.storageRepl] ? STORAGE_REPL[cfg.storageRepl].factor : 2.0;
    perHostUsableTB = cfg.storageTB / repl;
    stoHosts = demandStoTB > 0 ? Math.max(1, Math.ceil(demandStoTB / (perHostUsableTB * eff))) : 1;
  }

  const rawHosts = Math.max(cpuHosts, ghzHosts, memHosts, stoHosts, 1);
  const binding = rawHosts === stoHosts && cfg.hci ? 'storage'
    : rawHosts === ghzHosts && rawHosts !== cpuHosts && rawHosts !== memHosts ? 'ghz'
    : rawHosts === memHosts && rawHosts !== cpuHosts ? 'memory'
    : rawHosts === cpuHosts && rawHosts !== memHosts ? 'cpu' : 'balanced';
  const spares = cfg.redundancy === 'n1' ? 1 : cfg.redundancy === 'n2' ? 2 : 0;
  const finalHosts = rawHosts + spares;

  const licPerHost = cfg.sockets * Math.max(cfg.cps, 16);
  const phantomPerHost = licPerHost - cfg.sockets * cfg.cps;
  const totalLic = finalHosts * licPerHost;
  const totalPhantom = finalHosts * phantomPerHost;
  const totalPhysCores = finalHosts * cfg.sockets * cfg.cps;

  const capCpuUsed = demandVCpu / (finalHosts * perHostVCpu);
  const capMemUsed = demandMemGB / (finalHosts * perHostMemGB);
  const capGhzUsed = demandGHz / (finalHosts * perHostGHz);

  return {
    useActual, demandVCpu, demandMemGB, demandStoTB, eff,
    perHostVCpu, perHostMemGB, perHostUsableTB,
    demandGHz, perHostGHz, ghzHosts,
    cpuHosts, memHosts, stoHosts, rawHosts, binding, spares, finalHosts,
    licPerHost, phantomPerHost, totalLic, totalPhantom, totalPhysCores,
    capCpuUsed, capMemUsed, capGhzUsed,
    hostLabel: cfg.sockets + '×' + cfg.cps + 'c ' + (cfg.cpu || 'Custom') + ' @ ' + (cfg.ghz || 2.5).toFixed(1) + 'GHz · ' + fmtInt(cfg.ramGB) + ' GB',
  };
}

/* ================= storage-sizer math (ported) ================= */
const PROT = {
  none:    { label: 'None',         factor: 1.0 },
  mirror2: { label: '2-way mirror', factor: 2.0 },
  mirror3: { label: '3-way mirror', factor: 3.0 },
  raid5:   { label: 'RAID-5 / 4+1', factor: 1.33 },
  raid6:   { label: 'RAID-6 / 6+2', factor: 1.5 },
  ec83:    { label: 'EC 8+3',       factor: 1.375 },
};
function defaultStorageCfg() {
  return {
    basis: 'used', reduction: 1.8, protection: 'mirror2',
    remote: 'none', remoteCopies: 1, snapCopies: 1, snapPct: 25,
    overhead: 10, spare: 15, useGlobal: true, ownGrowth: 20,
  };
}
function defaultStorageGlobal() { return { horizon: 3, mode: 'compound', value: 20 }; }
function effGrowth(cfg, G) {
  return cfg.useGlobal ? G.value : (cfg.ownGrowth != null && cfg.ownGrowth !== '' ? clampNum(cfg.ownGrowth, G.value) : G.value);
}
function sizePoolYear(pool, cfg, G, y) {
  const basisTB = cfg.basis === 'provisioned' ? pool.provisionedTB : pool.usedTB;
  const g = effGrowth(cfg, G);
  const logical = G.mode === 'compound'
    ? basisTB * Math.pow(1 + g / 100, y)
    : Math.max(0, basisTB + y * g);
  const reduced = cfg.reduction > 0 ? logical / cfg.reduction : logical;
  const snapFactor = 1 + cfg.snapCopies * (cfg.snapPct / 100);
  const withSnaps = reduced * snapFactor;
  const localF = PROT[cfg.protection] ? PROT[cfg.protection].factor : 1.0;
  const withLocal = withSnaps * localF;
  const remoteF = cfg.remote === 'async' ? (1 + Math.min(Math.max(cfg.remoteCopies, 1), 2)) : 1;
  const withRemote = withLocal * remoteF;
  const withOH = withRemote * (1 + cfg.overhead / 100);
  const raw = withOH / Math.max(1 - cfg.spare / 100, 0.5);
  return { basisTB, g, logical, reduced, snapFactor, withSnaps, localF, withLocal, remoteF, withRemote, withOH, raw };
}

/* ================= network-sizer math (ported) ================= */
const TOR = {
  nx93180:  { label: 'Cisco Nexus 93180YC-FX3', dl: 48, dlSpeed: 25, ul: 6, ulSpeed: 100, note: '48×25G SFP28 + 6×100G QSFP28' },
  arista:   { label: 'Arista 7050SX3-48YC8',     dl: 48, dlSpeed: 25, ul: 8, ulSpeed: 100, note: '48×25G + 8×100G, wire-speed' },
  dell5248: { label: 'Dell PowerSwitch S5248F-ON', dl: 48, dlSpeed: 25, ul: 4, ulSpeed: 100, note: '48×25G + 4×100G (+2×200G not modeled)' },
  nx9364:   { label: 'Cisco Nexus 9364C-GX',     dl: 64, dlSpeed: 100, ul: 0, ulSpeed: 100, sharedPorts: true, note: '64×100G shared pool; uplinks carve from downlinks; 4×25G breakout' },
  custom:   { label: 'Custom switch', custom: true, note: 'Enter your own port counts' },
};
const FC = {
  g720:     { label: 'Brocade G720',    ports: 64,  maxSpeed: 64, note: 'Gen 7 · 16/32/64G auto-sensing · 1RU' },
  g730:     { label: 'Brocade G730',    ports: 128, maxSpeed: 64, note: 'Gen 7 · 128×64G · 2RU' },
  mds9148t: { label: 'Cisco MDS 9148T', ports: 48,  maxSpeed: 32, note: '32G · 24→48 ports via license' },
  mds9396t: { label: 'Cisco MDS 9396T', ports: 96,  maxSpeed: 32, note: '32G · 48→96 ports via license' },
  mds9132t: { label: 'Cisco MDS 9132T', ports: 32,  maxSpeed: 32, note: '32G · 8→32 ports via license' },
  custom:   { label: 'Custom FC switch', custom: true, note: 'Enter your own port count' },
};
function resolveTor(eth) {
  const P = TOR[eth.preset] || TOR.nx93180;
  if (P.custom) return { label: 'Custom', dl: Math.max(1, eth.cDl | 0), dlSpeed: eth.cDlS, ulSpeed: eth.cUlS, sharedPorts: false, note: 'custom' };
  return P;
}
function resolveFc(fc) {
  const P = FC[fc.preset] || FC.g720;
  if (P.custom) return { label: 'Custom', ports: Math.max(1, fc.cPorts | 0), maxSpeed: fc.cSpeed, note: 'custom' };
  return P;
}
function sizeEthernet(hosts, prof, eth) {
  const P = resolveTor(eth);
  const uplinks = Math.max(0, eth.uplinks | 0);
  const usableDl = P.sharedPorts ? Math.max(0, P.dl - uplinks) : P.dl;
  const classes = [
    { n: prof.mgmtN | 0, s: prof.mgmtS },
    { n: prof.dataN | 0, s: prof.dataS },
    { n: prof.storN | 0, s: prof.storS },
  ];
  let servedPorts = 0, servedBW = 0, unserved = 0, subPorts = 0, fullPorts = 0;
  classes.forEach((c) => {
    if (!c.n) return;
    const cnt = hosts * c.n;
    if (P.sharedPorts && P.dlSpeed === 100 && eth.breakout && c.s <= 25) {
      subPorts += cnt; servedPorts += cnt; servedBW += cnt * c.s;
    } else if (c.s <= P.dlSpeed) {
      if (P.sharedPorts && P.dlSpeed === 100) fullPorts += cnt;
      else servedPorts += cnt;
      servedBW += cnt * c.s;
    } else {
      unserved += cnt;
    }
  });
  let switchesRaw;
  if (P.sharedPorts && P.dlSpeed === 100) {
    const portCap = usableDl, subCap = usableDl * 4;
    switchesRaw = Math.max(
      fullPorts ? Math.ceil(fullPorts / Math.max(1, portCap)) : 0,
      subPorts ? Math.ceil(subPorts / Math.max(1, subCap)) : 0
    );
    servedPorts = fullPorts + subPorts;
  } else {
    switchesRaw = servedPorts ? Math.ceil(servedPorts / Math.max(1, usableDl)) : 0;
  }
  let switches = switchesRaw;
  if (eth.dual && switchesRaw > 0) switches = Math.max(2, switchesRaw + (switchesRaw % 2));
  if (eth.spare && switchesRaw > 0) switches += 1;
  const portEquiv = (P.sharedPorts && P.dlSpeed === 100)
    ? fullPorts + (eth.breakout ? subPorts / 4 : subPorts)
    : servedPorts;
  const capPorts = switches * usableDl;
  const util = capPorts > 0 ? portEquiv / capPorts : 0;
  const uplinkBW = switches * uplinks * P.ulSpeed;
  const over = uplinkBW > 0 ? servedBW / uplinkBW : (servedBW > 0 ? Infinity : 0);
  return {
    P, uplinks, usableDl, hosts,
    servedPorts, servedBW, unserved, portEquiv, fullPorts, subPorts,
    switchesRaw, switches, util, uplinkBW, over,
    mgmt1G: (prof.mgmtN | 0) > 0 && prof.mgmtS === 1 && P.dlSpeed >= 25,
  };
}
function sizeFC(hosts, hbaN, hbaSpeed, fc) {
  if (!fc.enabled || !(hbaN > 0)) {
    return { enabled: false, switches: 0, hostPorts: 0, targetPorts: 0, devicePorts: 0 };
  }
  const P = resolveFc(fc);
  const hostPorts = hosts * (hbaN | 0);
  const targetPorts = Math.max(0, fc.arrays | 0) * Math.max(0, fc.targets | 0);
  const devicePorts = hostPorts + targetPorts;
  const usable = Math.max(1, P.ports - Math.max(0, fc.isl | 0));
  const perFabric = fc.dual ? Math.ceil(devicePorts / 2) : devicePorts;
  const perFabricSw = devicePorts > 0 ? Math.max(1, Math.ceil(perFabric / usable)) : 0;
  const switches = fc.dual ? perFabricSw * 2 : perFabricSw;
  const effSpeed = Math.min(hbaSpeed, fc.targetSpeed, P.maxSpeed);
  const islBW = Math.max(0, fc.isl | 0) * effSpeed;
  const ratio = targetPorts > 0 ? hostPorts / targetPorts : null;
  const util = switches > 0 ? perFabric / (perFabricSw * usable || 1) : 0;
  return {
    enabled: true, P, hosts, hostPorts, targetPorts, devicePorts,
    usable, perFabric, perFabricSw, switches, util,
    islBW, ratio, effSpeed,
    hbaCapped: hbaSpeed > P.maxSpeed,
    targetCapped: fc.targetSpeed > P.maxSpeed,
    oddHba: fc.dual && ((hbaN | 0) % 2 === 1),
  };
}
function netNewEthernet(ethRes, eth, ethInv) {
  let reuse = 0;
  (ethInv || []).forEach((r) => {
    const P = TOR[r.preset] || TOR.nx93180;
    reuse += (P.custom ? Math.max(0, r.cDl | 0) : P.dl) * Math.max(0, r.count | 0);
  });
  const remaining = Math.max(0, ethRes.portEquiv - reuse);
  const P = ethRes.P;
  const usableDl = P.sharedPorts ? Math.max(0, P.dl - ethRes.uplinks) : P.dl;
  let raw = remaining > 0 ? Math.ceil(remaining / Math.max(1, usableDl)) : 0;
  let sw = raw;
  if (eth.dual && raw > 0) sw = Math.max(2, raw + (raw % 2));
  if (eth.spare && raw > 0) sw += 1;
  return { reuse, remaining, switches: sw };
}
function netNewFC(fcRes, fc, fcInv) {
  if (!fcRes.enabled) return { reuse: 0, switches: 0 };
  let reuse = 0;
  (fcInv || []).forEach((r) => {
    const P = FC[r.preset] || FC.g720;
    reuse += (P.custom ? Math.max(0, r.cPorts | 0) : P.ports) * Math.max(0, r.count | 0);
  });
  const perFabricNeed = fcRes.perFabric;
  const usable = fcRes.usable;
  const reusePerFabric = fc.dual ? Math.ceil(reuse / 2) : reuse;
  const remaining = Math.max(0, perFabricNeed - reusePerFabric);
  const perFabricSw = remaining > 0 ? Math.max(1, Math.ceil(remaining / Math.max(1, usable))) : 0;
  const switches = fc.dual ? perFabricSw * 2 : perFabricSw;
  return { reuse, switches };
}
function defaultNetProf() { return { hosts: 0, mgmtN: 2, mgmtS: 1, dataN: 2, dataS: 25, storN: 2, storS: 25, hbaN: 2, hbaS: 32 }; }
function defaultNetEth() { return { preset: 'nx93180', cDl: 48, cDlS: 25, cUlS: 100, uplinks: 6, overTarget: 3, dual: true, spare: false, breakout: true }; }
function defaultNetFc() { return { enabled: true, preset: 'g720', cPorts: 64, cSpeed: 64, isl: 8, arrays: 2, targets: 4, targetSpeed: 32, dual: true }; }

/* ================= Import validation ================= */
/* Mirrors each app's validProject() from origin. */
const APP_IDS = {
  analyzer: 'rvtools-analyzer',
  server: 'server-sizer',
  storage: 'storage-sizer',
  network: 'network-sizer',
};
const APP_LABELS = {
  analyzer: 'RVTools Analyzer',
  server: 'Server Sizer',
  storage: 'Storage Sizer',
  network: 'Network Sizer',
};
const PROJECT_VERSION = 1;
function validateImport(slot, d) {
  // slot: 'analyzer' | 'server' | 'storage' | 'network'
  if (!d || typeof d !== 'object') return { ok: false, error: 'That file is not valid JSON.' };
  const want = APP_IDS[slot];
  if (d.app && d.app !== want) {
    const label = Object.keys(APP_IDS).find((k) => APP_IDS[k] === d.app);
    return { ok: false, error: 'This looks like a ' + (label ? APP_LABELS[label] : d.app) + ' export — drop it on the matching import card.' };
  }
  if (d.app !== want) return { ok: false, error: 'Not a ' + APP_LABELS[slot] + ' project file. Export one from that app first (💾 Projects → Export).' };
  if (typeof d.version !== 'number' || d.version > PROJECT_VERSION) {
    return { ok: false, error: 'Exported from a newer ' + APP_LABELS[slot] + ' version — this Deal Pack only reads v' + PROJECT_VERSION + ' files.' };
  }
  const st = d.state || {};
  if (slot === 'analyzer') {
    if (!st.parsed || !Array.isArray(st.parsed.vms) || !st.parsed.vms.length)
      return { ok: false, error: 'That analyzer project has no VM data in it.' };
  } else if (slot === 'server') {
    if (!Array.isArray(st.clusters)) return { ok: false, error: 'That server project has no cluster data in it.' };
  } else if (slot === 'storage') {
    if (!Array.isArray(st.pools)) return { ok: false, error: 'That storage project has no pool data in it.' };
  } else if (slot === 'network') {
    if (!Array.isArray(st.groups)) return { ok: false, error: 'That network project has no host-group data in it.' };
  }
  return { ok: true };
}

/* ================= Analyzer current-state summary ================= */
function summarizeParsed(parsed) {
  const vms = (parsed && parsed.vms) || [];
  const hosts = (parsed && parsed.hosts) || [];
  const datastores = (parsed && parsed.datastores) || [];
  const snapshots = (parsed && parsed.snapshots) || [];
  let poweredOn = 0, templates = 0, snapVMs = 0;
  vms.forEach((v) => {
    if (v.template) templates++;
    else {
      if (v.power === 'on') poweredOn++;
      if ((v.snaps || 0) > 0) snapVMs++;
    }
  });
  const cmap = {};
  hosts.forEach((h) => {
    const k = (h.dc && h.dc !== '—' ? h.dc + ' / ' : '') + (h.cluster || 'Standalone');
    if (!cmap[k]) cmap[k] = { name: k, hosts: 0, sockets: 0, cores: 0, licenseCores: 0 };
    const c = cmap[k];
    c.hosts++;
    const socks = h.sockets || 0, cps = h.coresPerCpu || 0;
    c.sockets += socks; c.cores += h.cores || socks * cps;
    c.licenseCores += socks * Math.max(cps, 16);
  });
  const clusters = Object.values(cmap);
  const totalLic = clusters.reduce((a, c) => a + c.licenseCores, 0);
  const totalCores = clusters.reduce((a, c) => a + c.cores, 0);
  return {
    vms: vms.length, poweredOn, templates, snapVMs,
    hosts: hosts.length, clusters,
    licenseCores: totalLic, phantomCores: totalLic - totalCores,
    datastores: datastores.length, snapshots: snapshots.length,
  };
}

/* ================= Deal assembly ================= */
function getServerCfg(importedCfgs, id) {
  return Object.assign(defaultServerCfg(), (importedCfgs && importedCfgs[id]) || {});
}
function getStorageCfg(importedCfgs, id) {
  return Object.assign(defaultStorageCfg(), (importedCfgs && importedCfgs[id]) || {});
}
function buildDeal(imports) {
  // imports: {analyzer, server, storage, network} — validated project envelopes or null
  const deal = {
    analyzer: null, servers: [], storage: null, network: null,
    sources: {}, bom: [], sanity: [],
  };
  const st = (env) => (env && env.state) || {};

  // --- analyzer: current state ---
  if (imports.analyzer) {
    deal.analyzer = summarizeParsed(st(imports.analyzer).parsed);
    deal.sources.analyzer = imports.analyzer.name || 'Untitled project';
  }

  // --- server sizer: per-cluster builds ---
  if (imports.server) {
    const s = st(imports.server);
    deal.sources.server = imports.server.name || 'Untitled project';
    (s.clusters || []).forEach((c) => {
      const cfg = getServerCfg(s.cfgs, c.id);
      const r = sizeCluster(c, cfg);
      deal.servers.push({
        clusterId: c.id, name: c.name || c.id,
        platform: cfg.platform, hostLabel: r.hostLabel,
        finalHosts: r.finalHosts, rawHosts: r.rawHosts, spares: r.spares,
        binding: r.binding, totalLic: r.totalLic, totalPhantom: r.totalPhantom,
        totalPhysCores: r.totalPhysCores, demandVCpu: Math.round(r.demandVCpu),
        demandMemGB: Math.round(r.demandMemGB),
        vms: c.vms || 0, curHosts: c.curHosts || null,
      });
    });
  }

  // --- storage sizer: per-pool raw TB at horizon ---
  if (imports.storage) {
    const s = st(imports.storage);
    const G = Object.assign(defaultStorageGlobal(), s.global || {});
    deal.sources.storage = imports.storage.name || 'Untitled project';
    const pools = (s.pools || []).map((p) => {
      const cfg = getStorageCfg(s.cfgs, p.id);
      const finalY = sizePoolYear(p, cfg, G, G.horizon);
      const protLabel = (PROT[cfg.protection] || {}).label || cfg.protection;
      return {
        id: p.id, name: p.name || p.id, vms: p.vms || 0,
        basisTB: Math.round(finalY.basisTB * 10) / 10,
        rawTB: Math.round(finalY.raw * 10) / 10,
        detail: protLabel + ' · ' + cfg.reduction + ':1 reduction · ' + effGrowth(cfg, G) + '%/yr ' + G.mode,
      };
    });
    deal.storage = {
      horizon: G.horizon, mode: G.mode,
      pools,
      totalRawTB: Math.round(pools.reduce((a, p) => a + p.rawTB, 0) * 10) / 10,
    };
  }

  // --- network sizer: TOR + FC plan ---
  if (imports.network) {
    const s = st(imports.network);
    deal.sources.network = imports.network.name || 'Untitled project';
    const groups = s.groups || [];
    const prof = Object.assign(defaultNetProf(), s.prof || {});
    const eth = Object.assign(defaultNetEth(), s.eth || {});
    const fc = Object.assign(defaultNetFc(), s.fc || {});
    const hosts = prof.hosts || groups.reduce((a, g) => a + (g.hosts || 0), 0);
    const ethRes = sizeEthernet(hosts, prof, eth);
    const fcRes = sizeFC(hosts, prof.hbaN, prof.hbaS, fc);
    const ethNN = netNewEthernet(ethRes, eth, s.ethInv);
    const fcNN = netNewFC(fcRes, fc, s.fcInv);
    deal.network = {
      hosts, groups: groups.length,
      prof, eth, fc, ethRes, fcRes, ethNN, fcNN,
      hasInventory: (s.ethInv && s.ethInv.length) || (s.fcInv && s.fcInv.length),
    };
  }

  deal.bom = buildBOM(deal);
  deal.sanity = genSanityChecks(deal);
  return deal;
}

/* ================= Consolidated BOM ================= */
function buildBOM(deal) {
  const lines = [];
  // Servers — consolidate identical builds
  const byBuild = {};
  deal.servers.forEach((sv) => {
    const k = sv.platform + '|' + sv.hostLabel;
    if (!byBuild[k]) byBuild[k] = { platform: sv.platform, hostLabel: sv.hostLabel, qty: 0, lic: 0, clusters: [] };
    byBuild[k].qty += sv.finalHosts;
    byBuild[k].lic += sv.totalLic;
    byBuild[k].clusters.push(sv.name + ' (' + sv.finalHosts + ' hosts, ' + sv.binding + '-bound)');
  });
  Object.values(byBuild).forEach((b) => {
    lines.push({
      cat: 'Compute', item: b.platform + ' — ' + b.hostLabel, qty: b.qty, unit: 'hosts',
      detail: b.clusters.join('; ') + ' · ' + fmtInt(b.lic) + ' licensed cores (16-core/socket min)',
    });
  });
  // Network
  if (deal.network) {
    const n = deal.network;
    const torQty = n.hasInventory ? n.ethNN.switches : n.ethRes.switches;
    if (torQty > 0) {
      lines.push({
        cat: 'Network', item: n.ethRes.P.label + ' (TOR)', qty: torQty, unit: 'switches',
        detail: n.ethRes.servedPorts + ' downlink ports served · ' +
          (isFinite(n.ethRes.over) ? fmt1(n.ethRes.over) + ':1 oversubscription' : 'oversubscription n/a (no uplinks)') +
          (n.hasInventory ? ' · net-new after ' + fmtInt(n.ethNN.reuse) + ' reused ports of existing inventory' : ''),
      });
    }
    if (n.fcRes.enabled && n.fcRes.switches > 0) {
      const fcQty = n.hasInventory ? n.fcNN.switches : n.fcRes.switches;
      if (fcQty > 0) {
        lines.push({
          cat: 'Network', item: n.fcRes.P.label + ' (FC SAN)', qty: fcQty, unit: 'switches',
          detail: (n.fc.dual ? 'Fabric A/B pair' : 'single fabric') + ' · ' + n.fcRes.devicePorts +
            ' device ports (' + n.fcRes.hostPorts + ' host + ' + n.fcRes.targetPorts + ' array)' +
            (n.hasInventory ? ' · net-new after existing inventory' : ''),
        });
      }
    }
  }
  // Storage — capacity requirements, labeled honestly (not SKUs)
  if (deal.storage) {
    deal.storage.pools.forEach((p) => {
      lines.push({
        cat: 'Storage', item: 'Raw capacity — pool “' + p.name + '”', qty: p.rawTB, unit: 'TB raw',
        detail: 'by year ' + deal.storage.horizon + ' · ' + p.detail + ' — capacity requirement, not a SKU',
      });
    });
  }
  return lines;
}

/* ================= Quote sanity checklist ================= */
let sanitySeq = 0;
function mkCheck(text, kind) {
  return { id: 'sc' + (++sanitySeq) + '_' + Math.random().toString(36).slice(2, 7), text, kind: kind || 'auto' };
}
function genSanityChecks(deal) {
  sanitySeq = 0;
  const items = [];
  if (deal.network) {
    const n = deal.network;
    const torQty = n.hasInventory ? n.ethNN.switches : n.ethRes.switches;
    if (torQty > 0) {
      items.push(mkCheck('Optics & cabling: ' + torQty + ' × ' + n.ethRes.P.label +
        ' — verify ' + fmtInt(n.ethRes.servedPorts) + '× ' + n.ethRes.P.dlSpeed + 'G downlink DACs/fiber plus ' +
        n.ethRes.uplinks + '× ' + n.ethRes.P.ulSpeed + 'G uplinks per switch.'));
    }
    if (n.fcRes.enabled && n.fcRes.switches > 0) {
      items.push(mkCheck('FC optics: ' + (n.hasInventory ? n.fcNN.switches : n.fcRes.switches) + ' × ' + n.fcRes.P.label +
        ' — ' + n.fcRes.devicePorts + ' device-port SFPs plus ISL optics (' + n.fc.isl + ' ports/switch reserved).'));
    }
    if (isFinite(n.ethRes.over) && n.ethRes.over > (n.eth.overTarget || 3)) {
      items.push(mkCheck('Oversubscription is ' + fmt1(n.ethRes.over) + ':1 vs a ' + (n.eth.overTarget || 3) +
        ':1 target — confirm the customer accepts it or add uplinks/switches.'));
    }
    if (n.ethRes.unserved > 0) {
      items.push(mkCheck(n.ethRes.unserved + ' host ports need speeds above what the TOR switch offers — revisit the port profile or switch choice.'));
    }
    if (n.fcRes.enabled && n.fcRes.oddHba) {
      items.push(mkCheck('Odd HBA count per host with dual fabrics — confirm the A/B cabling split on the quote.'));
    }
    if (n.fcRes.enabled && (n.fcRes.hbaCapped || n.fcRes.targetCapped)) {
      items.push(mkCheck('Port speed capped by the FC switch max (' + n.fcRes.P.maxSpeed + 'G) — confirm SFP speeds match.'));
    }
  }
  const phantom = deal.servers.reduce((a, s) => a + s.totalPhantom, 0);
  const lic = deal.servers.reduce((a, s) => a + s.totalLic, 0);
  if (phantom > 0) {
    items.push(mkCheck('Licensing: ' + fmtInt(phantom) + ' phantom cores from the 16-core/socket minimum — quote ' +
      fmtInt(lic) + ' licensed cores, not physical.'));
  }
  // Standing manual checks — the classics that bite quotes
  [
    'Dual PSUs on every host — confirm, the sizer does not model power supplies.',
    'Rack rails / rack-mount kits on every host and switch line.',
    'Support & warranty SKU on every hardware line (matching term lengths).',
    'Out-of-band / iDRAC / CIMC management cabling and switch ports.',
    'Rack space and power: confirm kW per rack and PDU capacity for the new hosts.',
    'Uplink cabling from TOR to core/aggregation — length, fiber type, and count.',
    'Implementation services scoped (racking, cabling, config, migration).',
    'Growth assumptions in the proposal match what the customer signed off on.',
  ].forEach((t) => items.push(mkCheck(t, 'manual')));
  return items;
}

/* ================= TCO model ================= */
function defaultTcoInputs(deal) {
  const licCores = deal ? deal.servers.reduce((a, s) => a + s.totalLic, 0) : 0;
  const hosts = deal ? deal.servers.reduce((a, s) => a + s.finalHosts, 0) : 0;
  const kw = Math.round(hosts * 0.65 * 10) / 10; // rough: 650W average draw per host
  return {
    years: 3,
    curVmwareAnnual: 0, curSupportAnnual: 0, curKwhPrice: 0.14, curKw: kw,
    newPerCoreAnnual: 0, licCores, newSupportAnnual: 0, newKwhPrice: 0.14, newKw: kw,
    capex: 0, pue: 1.5,
  };
}
function tcoModel(inp) {
  const t = Object.assign(defaultTcoInputs(null), inp || {});
  const years = Math.max(1, Math.min(7, t.years | 0 || 3));
  const powerAnnual = (kw, price, pue) => kw * 8760 * price * pue;
  const curAnnual = clampNum(t.curVmwareAnnual, 0) + clampNum(t.curSupportAnnual, 0) + powerAnnual(clampNum(t.curKw, 0), clampNum(t.curKwhPrice, 0), clampNum(t.pue, 1.5));
  const newLicAnnual = clampNum(t.newPerCoreAnnual, 0) * clampNum(t.licCores, 0);
  const newAnnual = newLicAnnual + clampNum(t.newSupportAnnual, 0) + powerAnnual(clampNum(t.newKw, 0), clampNum(t.newKwhPrice, 0), clampNum(t.pue, 1.5));
  const curTotal = curAnnual * years;
  const newTotal = clampNum(t.capex, 0) + newAnnual * years;
  const rows = [];
  for (let y = 1; y <= years; y++) {
    rows.push({
      year: y,
      cur: curAnnual,
      curCum: curAnnual * y,
      nw: (y === 1 ? clampNum(t.capex, 0) : 0) + newAnnual,
      nwCum: clampNum(t.capex, 0) + newAnnual * y,
    });
  }
  return {
    years, curAnnual, newAnnual, newLicAnnual,
    curPowerAnnual: powerAnnual(clampNum(t.curKw, 0), clampNum(t.curKwhPrice, 0), clampNum(t.pue, 1.5)),
    newPowerAnnual: powerAnnual(clampNum(t.newKw, 0), clampNum(t.newKwhPrice, 0), clampNum(t.pue, 1.5)),
    curTotal, newTotal, savings: curTotal - newTotal, rows,
  };
}

/* ================= Demo deal (synthetic) ================= */
function demoDeal() {
  const rnd = lcg(20260926);
  const iso = new Date().toISOString();
  // --- analyzer parsed: 3 clusters, 21 hosts, ~140 VMs ---
  const clusters = [
    { dc: 'DC-East', cl: 'Prod-General', hosts: 12, vms: 78 },
    { dc: 'DC-East', cl: 'VDI', hosts: 6, vms: 44 },
    { dc: 'DC-West', cl: 'Edge', hosts: 3, vms: 18 },
  ];
  const hosts = [], vms = [];
  clusters.forEach((c, ci) => {
    for (let h = 0; h < c.hosts; h++) {
      const cps = ci === 2 ? 12 : 16;
      hosts.push({
        name: 'esx-' + String(ci * 20 + h + 1).padStart(2, '0') + '.demo.local',
        dc: c.dc, cluster: c.cl, sockets: 2, coresPerCpu: cps, cores: 2 * cps,
        cpuModel: 'Intel Xeon Gold', cpuMHz: 2900, cpuPct: 28 + rnd() * 30,
        memMB: 393216, memPct: 55 + rnd() * 25, vmCount: 0, version: '8.0.2', vendor: 'Dell', model: 'PowerEdge R740',
      });
    }
    for (let v = 0; v < c.vms; v++) {
      const on = rnd() > 0.08;
      vms.push({
        name: 'demo-vm-' + (ci * 200 + v), power: on ? 'on' : 'off', template: false,
        cpus: on ? [2, 4, 4, 8][Math.floor(rnd() * 4)] : 4,
        memMB: on ? [4096, 8192, 16384][Math.floor(rnd() * 3)] : 8192,
        provMB: 81920 + Math.floor(rnd() * 200000), usedMB: 30000 + Math.floor(rnd() * 120000),
        unsharedMB: 0, os: 'Microsoft Windows Server 2022', dc: c.dc, cluster: c.cl,
        host: '', hw: 'vmx-19', created: '', snaps: rnd() > 0.93 ? 1 : 0, uuid: 'demo-' + ci + '-' + v,
      });
    }
  });
  const analyzer = {
    app: 'rvtools-analyzer', version: 1, name: 'Demo deal — analyzer', savedAt: iso,
    state: {
      parsed: {
        vms, hosts,
        datastores: [{ capMB: 50 * 1048576, usedMB: 31 * 1048576 }, { capMB: 20 * 1048576, usedMB: 9 * 1048576 }],
        snapshots: [5120, 8192, 2048],
        disks: [true, true, false, true],
      },
      scenario: { sockets: 2, cores: 32, hosts: 24 },
    },
  };
  // --- server sizer ---
  const server = {
    app: 'server-sizer', version: 1, name: 'Demo deal — servers', savedAt: iso,
    state: {
      clusters: [
        { id: 'c0', name: 'DC-East / Prod-General', vms: 78, poweredOn: 72, allocVCpu: 288, allocMemGB: 1152, usedStorageTB: 8.4, avgCpuUtil: 0.41, avgMemUtil: 0.62, curHosts: 12, curHostCps: 16, curLicenseCores: 384 },
        { id: 'c1', name: 'DC-East / VDI', vms: 44, poweredOn: 40, allocVCpu: 160, allocMemGB: 640, usedStorageTB: 3.1, avgCpuUtil: 0.38, avgMemUtil: 0.58, curHosts: 6, curHostCps: 16, curLicenseCores: 192 },
        { id: 'c2', name: 'DC-West / Edge', vms: 18, poweredOn: 17, allocVCpu: 52, allocMemGB: 208, usedStorageTB: 1.2, avgCpuUtil: 0.35, avgMemUtil: 0.55, curHosts: 3, curHostCps: 12, curLicenseCores: 96 },
      ],
      cfgs: {
        c0: Object.assign(defaultServerCfg(), { platform: 'Dell PowerEdge R760' }),
        c1: Object.assign(defaultServerCfg(), { platform: 'Dell PowerEdge R760' }),
        c2: Object.assign(defaultServerCfg(), { platform: 'HPE ProLiant DL380 Gen11', sockets: 2, cps: 24, ramGB: 768, cpu: 'Xeon 6527P', ghz: 3.0 }),
      },
      source: 'demo', fileName: null,
    },
  };
  // --- storage sizer ---
  const storage = {
    app: 'storage-sizer', version: 1, name: 'Demo deal — storage', savedAt: iso,
    state: {
      pools: [
        { id: 'p0', name: 'DC-East / Prod-General', vms: 78, provisionedTB: 24.6, usedTB: 12.2, usableTB: null, source: 'demo' },
        { id: 'p1', name: 'DC-East / VDI', vms: 44, provisionedTB: 9.8, usedTB: 5.4, usableTB: null, source: 'demo' },
      ],
      cfgs: {
        p0: defaultStorageCfg(),
        p1: Object.assign(defaultStorageCfg(), { protection: 'raid5', reduction: 2.2 }),
      },
      global: { horizon: 3, mode: 'compound', value: 20 },
      source: 'demo', fileName: null,
    },
  };
  // --- network sizer ---
  const network = {
    app: 'network-sizer', version: 1, name: 'Demo deal — network', savedAt: iso,
    state: {
      groups: [
        { id: 'g0', name: 'DC-East / Prod-General', hosts: 12, vms: 78, source: 'demo' },
        { id: 'g1', name: 'DC-East / VDI', hosts: 6, vms: 44, source: 'demo' },
        { id: 'g2', name: 'DC-West / Edge', hosts: 3, vms: 18, source: 'demo' },
      ],
      ethInv: [], fcInv: [],
      // Current estate is 21 hosts, but the refresh target (what the
      // network sizer plans for) is the 7 new hosts the server sizer sized.
      prof: Object.assign(defaultNetProf(), { hosts: 7 }),
      eth: defaultNetEth(),
      fc: defaultNetFc(),
      source: 'demo', fileName: null,
    },
  };
  return { analyzer, server, storage, network };
}

/* ================= Proposal text builders ================= */
function execSummary(deal) {
  const parts = [];
  const hosts = deal.servers.reduce((a, s) => a + s.finalHosts, 0);
  const vms = deal.analyzer ? deal.analyzer.vms : deal.servers.reduce((a, s) => a + s.vms, 0);
  parts.push('This proposal covers a refresh of <strong>' + fmtInt(hosts) + ' hosts</strong>' +
    (deal.servers.length > 1 ? ' across <strong>' + deal.servers.length + ' clusters</strong>' : '') +
    (vms ? ' supporting <strong>' + fmtInt(vms) + ' VMs</strong>' : '') + '.');
  if (deal.analyzer) {
    parts.push('Current state: <strong>' + fmtInt(deal.analyzer.hosts) + ' hosts</strong> carrying ' +
      '<strong>' + fmtInt(deal.analyzer.licenseCores) + ' licensed cores</strong> (16-core/socket minimum).');
  }
  if (deal.network) {
    parts.push('Network: <strong>' + deal.network.ethRes.switches + ' TOR switches</strong>' +
      (deal.network.fcRes.enabled ? ' and <strong>' + deal.network.fcRes.switches + ' FC switches</strong> (Fabric A/B)' : '') +
      ' for ' + fmtInt(deal.network.hosts) + ' hosts.');
  }
  if (deal.storage) {
    parts.push('Storage: <strong>' + fmt1(deal.storage.totalRawTB) + ' TB raw</strong> required by year ' +
      deal.storage.horizon + ' across ' + deal.storage.pools.length + ' pools.');
  }
  return parts.join(' ');
}

return {
  fmtInt, fmt1, fmtUSD, esc, clampNum,
  PLATFORMS, defaultServerCfg, sizeCluster,
  PROT, defaultStorageCfg, defaultStorageGlobal, effGrowth, sizePoolYear,
  TOR, FC, resolveTor, resolveFc, sizeEthernet, sizeFC, netNewEthernet, netNewFC,
  defaultNetProf, defaultNetEth, defaultNetFc,
  APP_IDS, APP_LABELS, PROJECT_VERSION, validateImport,
  summarizeParsed, buildDeal, buildBOM, genSanityChecks,
  defaultTcoInputs, tcoModel, demoDeal, execSummary,
};
});
