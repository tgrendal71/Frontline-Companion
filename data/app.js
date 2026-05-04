/* ============================================================
   A&A Global 1940 — Game Tracker  |  app.js
   State management, rendering, event handling
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY = 'aa1940_tracker_v1';
const AXIS_WIN_VC  = 13;
const ALLIES_WIN_VC = 8;  // Allies win by holding fewer Axis VCs (keep Axis below 13)

// ── State ─────────────────────────────────────────────────────
let state = null;
let purchaseCart = {};   // { [nationId]: { [unitId]: qty } } — per-session cart, not persisted
let buildPlacements = {}; // { [nationId]: { [unitId]: territoryId } } — building territory selections
let repairTokens = {};  // { [nationId]: { [terrId|type]: marksToRepair } } — per-facility repair selection
const objShowAll = {};  // { [nationId]: bool } — per-session, not persisted

function defaultState() {
  const nations = {};
  for (const id of TURN_ORDER) {
    nations[id] = {
      treasury:         NATIONS[id].startTreasury,
      technologies:     [],
      objectives:       Object.fromEntries(
        (NATIONAL_OBJECTIVES[id] ?? []).filter(o => o.peaceOnly).map(o => [o.id, true])
      ),
      objectivesClaimed:{},  // { [objectiveId]: true } — for oneTime objectives already collected
      notes:            '',
      convoyLoss:       0,
      warBonds:         0,
      manualAdjust:     0,
      researchDice:     0,
      conquests:        '',  // land conquered this round (free text)
      losses:           '',  // land lost this round (free text)
      unitLosses:       '',  // unit losses this round (free text)
      atWar:            false,  // starts at peace; declare war manually (auto-locked true after round 3)
    };
  }
  return {
    version:    1,
    round:      1,
    turnIndex:  0,
    lang:       'no',
    nations,
    territories: {},
    facilities:     {},  // { [territoryId]: { ic: 'minor'|'major'|null, airBase: bool, navalBase: bool } }
    facilityDamage: {},  // { [territoryId]: { ic: number, airBase: number, navalBase: number } }
    history:    [],
    turnPhases:    {},   // { [nationId]: [phaseId, ...] }  — phases completed this round
    purchaseLogs: [],   // [ { round, nationId, items, totalCost, date } ]
    territoryChanges: [], // [ { territoryId, name, from, to } ] — logged during round
    bombingEvents:    [], // [ { attackerId, terrId, terrName, facLabel, damage } ] — logged during round
  };
}

function getController(territoryId) {
  return state.territories[territoryId] ?? TERRITORIES.find(t => t.id === territoryId)?.startController ?? 'neutral';
}

// ── Facility helpers ──────────────────────────────────────────

/** Max damage caps per facility type */
const FACILITY_MAX = { ic_minor: 6, ic_major: 20, airBase: 6, navalBase: 6 };

/** Get the facility record for a territory (with safe defaults). */
function getFacility(terrId) {
  return state.facilities[terrId] ?? { ic: null, airBase: false, navalBase: false };
}

/** Get the damage record for a territory (with safe defaults). */
function getFacilityDamage(terrId) {
  return state.facilityDamage[terrId] ?? { ic: 0, airBase: 0, navalBase: 0 };
}

/** Apply damage to a facility, capped at the appropriate maximum. */
function applyFacilityDamage(terrId, type, dmg) {
  const fac = getFacility(terrId);
  if (type === 'ic' && !fac.ic) return;
  if (type === 'airBase'  && !fac.airBase)   return;
  if (type === 'navalBase' && !fac.navalBase) return;
  const maxKey = type === 'ic' ? (fac.ic === 'major' ? 'ic_major' : 'ic_minor') : type;
  if (!state.facilityDamage[terrId]) state.facilityDamage[terrId] = { ic: 0, airBase: 0, navalBase: 0 };
  const d = state.facilityDamage[terrId];
  d[type] = Math.min((d[type] || 0) + dmg, FACILITY_MAX[maxKey]);
}

/** Repair damage marks for a facility, clamped to 0. Returns actual marks repaired. */
function repairFacilityDamage(terrId, type, marksAmount) {
  if (!state.facilityDamage[terrId]) return 0;
  const d = state.facilityDamage[terrId];
  const before = d[type] || 0;
  const repaired = Math.min(before, marksAmount);
  d[type] = before - repaired;
  return repaired;
}

/** True when an air base exists and has < 6 damage (operative). */
function isOperativeAirBase(terrId) {
  return getFacility(terrId).airBase && (getFacilityDamage(terrId).airBase || 0) < 6;
}

/** True when a naval base exists and has < 6 damage (operative). */
function isOperativeNavalBase(terrId) {
  return getFacility(terrId).navalBase && (getFacilityDamage(terrId).navalBase || 0) < 6;
}

/**
 * Returns all territories controlled by nationId that have at least one
 * damaged facility (ic | airBase | navalBase).
 */
function getDamagedFacilitiesForNation(nationId) {
  const result = [];
  const controlledTerrIds = TERRITORIES
    .filter(t => getController(t.id) === nationId)
    .map(t => t.id);
  for (const terrId of controlledTerrIds) {
    const fac = getFacility(terrId);
    const dmg = getFacilityDamage(terrId);
    const terr = TERRITORIES.find(t => t.id === terrId);
    const terrName = terr?.name ?? terrId;
    if (fac.ic && dmg.ic > 0) {
      const maxKey = fac.ic === 'major' ? 'ic_major' : 'ic_minor';
      result.push({ terrId, terrName, type: 'ic', label: fac.ic === 'major' ? t('fac.major_ic') + ' (IC)' : t('fac.minor_ic') + ' (IC)', damage: dmg.ic, maxDamage: FACILITY_MAX[maxKey] });
    }
    if (fac.airBase && dmg.airBase > 0) {
      result.push({ terrId, terrName, type: 'airBase', label: t('fac.airbase'), damage: dmg.airBase, maxDamage: FACILITY_MAX.airBase });
    }
    if (fac.navalBase && dmg.navalBase > 0) {
      result.push({ terrId, terrName, type: 'navalBase', label: t('fac.navalbase'), damage: dmg.navalBase, maxDamage: FACILITY_MAX.navalBase });
    }
  }
  return result;
}

/**
 * Returns all territories controlled by nationId that have operative air bases
 * (airBase present, damage < 6).
 */
function getOperativeAirBasesForNation(nationId) {
  return TERRITORIES
    .filter(t => getController(t.id) === nationId && isOperativeAirBase(t.id))
    .map(t => ({ terrId: t.id, terrName: t.name }));
}

// ── Side helpers ──────────────────────────────────────────────
const AXIS_SET   = new Set(['germany','italy','japan']);
const ALLIED_SET = new Set(['soviet','usa','china','uk_europe','uk_pacific','anzac','france']);
function isAxis(nid)   { return AXIS_SET.has(nid); }
function isAllied(nid) { return ALLIED_SET.has(nid); }
function ctrl(tid)     { return getController(tid); }

function getSovAxisTerritories() {
  return TERRITORIES.filter(t =>
    (t.startController === 'germany' || t.startController === 'italy') &&
    ctrl(t.id) === 'soviet'
  );
}

// ── Objective auto-evaluation rules ──────────────────────────
// Each entry: objId → () => boolean  (return true = objective met)
const OBJECTIVE_RULES = {
  // ── Germany ────────────────────────────────────────────────
  ger_leningrad:   () => ctrl('leningrad') === 'germany',
  ger_volgograd:   () => ctrl('volgograd') === 'germany',
  ger_moscow:      () => ctrl('moscow')    === 'germany',
  ger_caucasus:    () => isAxis(ctrl('caucasus')),
  ger_scandinavia: () => ctrl('denmark') === 'germany'
                      && ctrl('norway')  === 'germany'
                      && !isAllied(ctrl('sweden')),
  ger_iraq:        () => ctrl('iraq')     === 'germany',
  ger_persia:      () => ctrl('persia')   === 'germany',
  ger_nw_persia:   () => ctrl('nw_persia') === 'germany',

  // ── Soviet ─────────────────────────────────────────────────
  sov_berlin:           () => ctrl('germany') === 'soviet',
  sov_axis_territories: () => true,  // alltid aktiv i krig; IPC beregnes dynamisk (3 × antall territorier)

  // ── Japan ───────────────────────────────────────────────────
  jap_perimeter: () => ['guam','midway','wake','gilbert','solomon_islands'].every(t => isAxis(ctrl(t))),
  jap_india:     () => isAxis(ctrl('india')),
  jap_sydney:    () => isAxis(ctrl('new_south_wales')),
  jap_hawaii:    () => isAxis(ctrl('hawaii')),
  jap_west_us:   () => isAxis(ctrl('western_us')),
  jap_resources: () => ['sumatra','java','borneo','celebes'].every(t => isAxis(ctrl(t))),

  // ── USA ─────────────────────────────────────────────────────
  usa_homeland:    () => ['eastern_us','central_us','western_us'].every(t => ctrl(t) === 'usa'),
  usa_pacific:     () => ['alaska','aleutian','hawaii','johnston','line_islands'].every(t => ctrl(t) === 'usa'),
  usa_caribbean:   () => ['mexico','se_mexico','central_america','west_indies'].every(t => ctrl(t) === 'usa'),
  usa_philippines: () => ctrl('philippines') === 'usa',

  // ── China ───────────────────────────────────────────────────
  chi_burma_road: () => !isAxis(ctrl('india')) && !isAxis(ctrl('burma'))
                     && !isAxis(ctrl('yunnan')) && !isAxis(ctrl('szechwan')),

  // ── UK Europe ───────────────────────────────────────────────
  uke_empire: () => TERRITORIES.filter(t => t.startController === 'uk_europe').every(t => ctrl(t.id) === 'uk_europe'),

  // ── UK Pacific ──────────────────────────────────────────────
  ukp_far_east: () => ctrl('kwangtung') === 'uk_pacific' && ctrl('malaya') === 'uk_pacific',

  // ── Italy ───────────────────────────────────────────────────
  ita_mediterranean_land: () => ['gibraltar','southern_france','greece','egypt'].filter(t => isAxis(ctrl(t))).length >= 3,
  ita_north_africa: () => ['morocco','algeria','tunisia','libya','tobruk','alexandria'].every(t => isAxis(ctrl(t))),
  ita_iraq:      () => ctrl('iraq')     === 'italy',
  ita_persia:    () => ctrl('persia')   === 'italy',
  ita_nw_persia: () => ctrl('nw_persia') === 'italy',

  // ── ANZAC ────────────────────────────────────────────────────
  anz_malaya:    () => !isAxis(ctrl('malaya'))
                    && TERRITORIES.filter(t => t.startController === 'anzac').every(t => ctrl(t.id) === 'anzac'),
  anz_perimeter: () => ['dutch_new_guinea','new_guinea','new_britain','solomon_islands'].every(t => !isAxis(ctrl(t))),
};

function evalObjectivesForNation(tid) {
  const ns = state.nations[tid];
  if (!ns) return;
  if (!ns.objectives)        ns.objectives        = {};
  if (!ns.objectivesClaimed) ns.objectivesClaimed = {};
  const objs = NATIONAL_OBJECTIVES[tid] ?? [];
  const atWar = getEffectiveAtWar(tid);
  objs.forEach(o => {
    // Uncheck peace objectives when at war, and war objectives when at peace
    if (o.peaceOnly && atWar)  { ns.objectives[o.id] = false; return; }
    if (o.warOnly  && !atWar) { ns.objectives[o.id] = false; return; }
    const rule = OBJECTIVE_RULES[o.id];
    if (!rule) return;                                    // no auto rule → keep manual
    if (o.oneTime && ns.objectivesClaimed[o.id]) return; // already claimed → don't re-check
    ns.objectives[o.id] = rule();
  });
}

function setController(territoryId, nationId) {
  const t = TERRITORIES.find(t => t.id === territoryId);
  if (!t) return;
  if (nationId === t.startController) {
    delete state.territories[territoryId];
  } else {
    state.territories[territoryId] = nationId;
  }
}

function calcIncome(nationId) {
  // A&A Global 1940: income = official starting income
  //   + IPC from territories captured (originally belonging to others)
  //   − IPC from originally-owned territories now lost to others
  const startIncome = NATIONS[nationId]?.startIncome ?? 0;
  let delta = 0;
  for (const t of TERRITORIES) {
    if (t.ipc === 0) continue;
    const current  = getController(t.id);
    const original = t.startController;
    if (current === nationId && original !== nationId) {
      delta += t.ipc;   // captured from someone else
    } else if (original === nationId && current !== nationId) {
      delta -= t.ipc;   // originally ours, now lost
    }
  }
  return Math.max(0, startIncome + delta);
}

function getObjIpc(o) {
  if (!o.dynamicIpc) return o.ipc;
  if (o.id === 'sov_axis_territories') return getSovAxisTerritories().length * (o.ipcPerTerritory || 0);
  return 0;
}

function calcBonusIncome(nationId) {
  evalObjectivesForNation(nationId);
  const objs   = NATIONAL_OBJECTIVES[nationId] ?? [];
  const ns     = state.nations[nationId];
  return objs
    .filter(o => ns.objectives?.[o.id] === true && !o.freeUnits)
    .reduce((sum, o) => sum + getObjIpc(o), 0);
}

// Returns true if the nation controls its main capital (or has no main capital, e.g. China)
function ownsMainCapital(nationId) {
  const capTerr = TERRITORIES.find(t => t.isMainCapital && t.startController === nationId);
  if (!capTerr) return true; // no main capital (China, neutral) → always allowed
  return getController(capTerr.id) === nationId;
}

function calcTotalToSpend(nationId) {
  const ns      = state.nations[nationId];
  const income  = calcIncome(nationId);
  const bonus   = calcBonusIncome(nationId);
  // Always include current treasury — remaining IPC after purchases carries forward
  const carryover = ns.treasury;
  // capturedTreasury: IPC taken from captured capitals — carries over to next purchase
  const captured = ns.capturedTreasury || 0;
  return carryover + captured + income + (ns.warBonds || 0) + bonus - (ns.convoyLoss || 0) + (ns.manualAdjust || 0);
}

// Returns effective cost of a unit for a given nation (respects Improved Shipbuilding)
function getUnitCost(unit, tid) {
  if (unit.shipbuildingCost !== undefined && state.nations[tid].technologies.includes('shipbuilding')) {
    return unit.shipbuildingCost;
  }
  return unit.cost;
}

function getVCCounts() {
  const counts = {};
  VICTORY_CITIES.forEach(t => {
    const c = getController(t.id);
    counts[c] = (counts[c] || 0) + 1;
  });
  return counts;
}

function getAxisVC() {
  const counts = getVCCounts();
  const axisList = Object.keys(NATIONS).filter(n => NATIONS[n].side === 'axis');
  return axisList.reduce((s, n) => s + (counts[n] || 0), 0);
}

function getAlliesVC() {
  const counts = getVCCounts();
  const alliesList = Object.keys(NATIONS).filter(n => NATIONS[n].side === 'allies');
  return alliesList.reduce((s, n) => s + (counts[n] || 0), 0);
}

function totalVCs() { return VICTORY_CITIES.length; }

// ── Persistence ───────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      if (loaded.version === 1) {
        // migrate: ensure all fields exist
        if (!loaded.lang)           loaded.lang           = 'no';
        if (!loaded.turnPhases)     loaded.turnPhases     = {};
        if (!loaded.purchaseLogs)   loaded.purchaseLogs   = [];
        if (!loaded.facilities)     loaded.facilities     = {};
        if (!loaded.facilityDamage) loaded.facilityDamage = {};
        for (const id of TURN_ORDER) {
          const ns = loaded.nations[id];
          if (!ns) continue;
          if (!ns.technologies)      ns.technologies      = [];
          if (!ns.objectives)        ns.objectives        = {};
          if (!ns.objectivesClaimed) ns.objectivesClaimed = {};
          if (ns.researchDice  === undefined) ns.researchDice  = 0;
          if (ns.conquests     === undefined) ns.conquests     = '';
          if (ns.losses        === undefined) ns.losses        = '';
          if (ns.unitLosses    === undefined) ns.unitLosses    = '';
          if (ns.manualAdjust  === undefined) ns.manualAdjust  = 0;
          // always reset atWar to false (peace) on load — user sets war status manually each session
          ns.atWar = false;
          // ensure peaceOnly objectives are checked by default if not already set
          (NATIONAL_OBJECTIVES[id] ?? []).filter(o => o.peaceOnly).forEach(o => {
            if (ns.objectives[o.id] === undefined) ns.objectives[o.id] = true;
          });
        }
        return loaded;
      }
    }
  } catch(e) {}
  return null;
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `aa1940-round${state.round}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t('toast.exported'), 'success');
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const loaded = JSON.parse(e.target.result);
      if (loaded.version === 1) {
        // Run the same migration as loadState so all fields are present
        if (!loaded.facilities)     loaded.facilities     = {};
        if (!loaded.facilityDamage) loaded.facilityDamage = {};
        if (!loaded.turnPhases)     loaded.turnPhases     = {};
        if (!loaded.purchaseLogs)   loaded.purchaseLogs   = [];
        for (const id of TURN_ORDER) {
          const ns = loaded.nations[id];
          if (!ns) continue;
          if (!ns.technologies)      ns.technologies      = [];
          if (!ns.objectives)        ns.objectives        = {};
          if (!ns.objectivesClaimed) ns.objectivesClaimed = {};
          if (ns.researchDice    === undefined) ns.researchDice    = 0;
          if (ns.conquests       === undefined) ns.conquests       = '';
          if (ns.losses          === undefined) ns.losses          = '';
          if (ns.unitLosses      === undefined) ns.unitLosses      = '';
          if (ns.manualAdjust    === undefined) ns.manualAdjust    = 0;
          ns.atWar = false;
          (NATIONAL_OBJECTIVES[id] ?? []).filter(o => o.peaceOnly).forEach(o => {
            if (ns.objectives[o.id] === undefined) ns.objectives[o.id] = true;
          });
        }
        state = loaded;
        // Force nation cards to be fully rebuilt (not just updated)
        const grid = document.getElementById('nationsGrid');
        if (grid) grid.dataset.built = '';
        saveState();
        renderAll();
        toast(t('toast.imported'), 'success');
      } else {
        toast(t('toast.invalid_format'), 'error');
      }
    } catch { toast(t('toast.file_read_error'), 'error'); }
  };
  reader.readAsText(file);
}

// ── Server Save/Load ──────────────────────────────────────────
const API_BASE = '/api/saves';

function openServerSaveModal() {
  // Pre-fill with a suggested name based on round
  const input = document.getElementById('ssaveName');
  if (!input.value) input.value = `Runde ${state.round}`;
  document.getElementById('serverSaveModal').classList.remove('hidden');
  loadSavesList();
}

function closeServerSaveModal() {
  document.getElementById('serverSaveModal').classList.add('hidden');
}

async function loadSavesList() {
  const list = document.getElementById('ssaveList');
  list.innerHTML = '<div class="ssave-empty">Laster…</div>';
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saves = await res.json();
    if (!saves.length) {
      list.innerHTML = '<div class="ssave-empty">' + t('modal.save.empty') + '</div>';
      return;
    }
    list.innerHTML = saves.map(s => {
      const d = new Date(s.modified * 1000);
      const when = d.toLocaleString('nb-NO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const safeName = encodeURIComponent(s.name);
      return `
        <div class="ssave-item">
          <div class="ssave-item-info">
            <div class="ssave-item-name">${escHtml(s.name)}</div>
            <div class="ssave-item-meta">${when}</div>
          </div>
          <div class="ssave-item-actions">
            <button class="btn btn-success btn-sm" onclick="loadFromServer('${safeName}')">${t('saves.load_btn')}</button>
            <button class="btn btn-danger btn-sm"  onclick="deleteFromServer('${safeName}', this)">🗑️</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="ssave-empty" style="color:var(--red)">${t('toast.save_error', { msg: e.message })}</div>`;
  }
}

async function saveToServer() {
  const name = document.getElementById('ssaveName').value.trim();
  if (!name) { toast(t('toast.save_name_empty'), 'error'); return; }
  if (!/^[\w\- ]{1,64}$/.test(name)) {
    toast(t('toast.save_name_invalid'), 'error');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    toast(t('toast.saved', { name }), 'success');
    loadSavesList();
  } catch (e) {
    toast(t('toast.save_error', { msg: e.message }), 'error');
  }
}

async function loadFromServer(encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(t('saves.load_confirm', { name }))) return;
  try {
    const res = await fetch(`${API_BASE}/${encodedName}`);
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    const loaded = await res.json();
    if (loaded.version !== 1) { toast(t('toast.invalid_format'), 'error'); return; }
    // Run full migration
    for (const id of TURN_ORDER) {
      const ns = loaded.nations[id];
      if (!ns) continue;
      if (!ns.technologies)      ns.technologies      = [];
      if (!ns.objectives)        ns.objectives        = {};
      if (!ns.objectivesClaimed) ns.objectivesClaimed = {};
      if (ns.researchDice    === undefined) ns.researchDice    = 0;
      if (ns.conquests       === undefined) ns.conquests       = '';
      if (ns.losses          === undefined) ns.losses          = '';
      if (ns.unitLosses      === undefined) ns.unitLosses      = '';
      if (ns.manualAdjust    === undefined) ns.manualAdjust    = 0;
      if (!loaded.turnPhases)   loaded.turnPhases   = {};
      if (!loaded.purchaseLogs) loaded.purchaseLogs = [];
      ns.atWar = false;
      (NATIONAL_OBJECTIVES[id] ?? []).filter(o => o.peaceOnly).forEach(o => {
        if (ns.objectives[o.id] === undefined) ns.objectives[o.id] = true;
      });
    }
    state = loaded;
    const grid = document.getElementById('nationsGrid');
    if (grid) grid.dataset.built = '';
    saveState();
    renderAll();
    closeServerSaveModal();
    toast(t('toast.loaded', { name }), 'success');
  } catch (e) {
    toast(t('toast.load_error', { msg: e.message }), 'error');
  }
}

async function deleteFromServer(encodedName, btn) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(t('saves.load_confirm', { name }))) return;
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/${encodedName}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    toast(t('toast.deleted', { name }));
    loadSavesList();
  } catch (e) {
    toast(t('toast.delete_error', { msg: e.message }), 'error');
    btn.disabled = false;
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Tab system ────────────────────────────────────────────────
let activeTab = 'overview';

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabId));
  document.documentElement.scrollTop = 0; // instant, bypasses scroll-behavior: smooth
  renderActive();
}

// ── Render dispatcher ─────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderActive();
}

function renderActive() {
  renderHeader();
  if (activeTab === 'overview')    renderOverview();
  if (activeTab === 'nations')     renderNations();
  if (activeTab === 'territories') renderTerritories();
  if (activeTab === 'history')     renderHistory();
  if (activeTab === 'battle')      renderBattle();
}

// ── Nation icon helper ────────────────────────────────────────
function nationIconHTML(nat, cls = '') {
  if (nat && nat.icon) {
    return `<img class="nation-icon${cls ? ' ' + cls : ''}" src="${nat.icon}" alt="${nat.shortName}">`;
  }
  return `<span class="nation-icon-fallback">${nat ? nat.flag : '⚪'}</span>`;
}

// ── Header ────────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('roundBadge').textContent = `Runde ${state.round}`;

  const tid = TURN_ORDER[state.turnIndex];
  const nat = NATIONS[tid];

  document.getElementById('turnFlag').innerHTML = nationIconHTML(nat, 'nation-icon--md');
  document.getElementById('turnName').textContent = nat.name;

  const pill = document.getElementById('turnPill');
  pill.style.color       = `var(--c-${tid})`;
  pill.style.borderColor = `var(--c-${tid})`;
}

// ── Overview tab ──────────────────────────────────────────────
function renderOverview() {
  renderTurnStrip();
  renderVictoryMeter();
  renderFocusCard();
  renderNationMiniGrid();
  renderChronicle();
  renderVictoryCities();
}

function renderTurnStrip() {
  const container = document.getElementById('turnStrip');
  container.innerHTML = TURN_ORDER.map((tid, i) => {
    const nat       = NATIONS[tid];
    const ns        = state.nations[tid];
    const completed = state.turnPhases?.[tid] ?? [];
    const visible   = PHASES.filter(p => !p.techRequired || ns.technologies.includes(p.techRequired));
    const doneCount = visible.filter(p => completed.includes(p.id)).length;
    const allDone   = doneCount === visible.length;

    const cls = i === state.turnIndex ? 'active-turn' : (i < state.turnIndex ? 'done-turn' : '');

    let badge = '';
    if (i === state.turnIndex) {
      badge = `<span class="tn-phases">${doneCount}/${visible.length}</span>`;
    } else if (i < state.turnIndex) {
      badge = allDone
        ? `<span class="tn-check">✓</span>`
        : `<span class="tn-phases dimmed">${doneCount}/${visible.length}</span>`;
    }

    return `<div class="turn-node ${cls}" data-nation="${tid}" data-index="${i}" title="${nat.name}"
      onclick="switchTab('nations');scrollToNation('${tid}')">
      <span class="tn-flag">${nationIconHTML(nat, 'nation-icon--sm')}</span>
      <span class="tn-name">${nat.shortName}</span>
      ${badge}
    </div>`;
  }).join('');
}

// ── Phase tracker ─────────────────────────────────────────────
function getVisiblePhases(tid) {
  const ns = state.nations[tid];
  return PHASES.filter(p => {
    if (p.techRequired && !ns.technologies.includes(p.techRequired)) return false;
    if (p.chinaExcluded && tid === 'china') return false;
    return true;
  });
}

function renderPhaseTracker() {
  const wrap = document.getElementById('phaseTrackerWrap');
  if (!wrap) return;

  const tid       = TURN_ORDER[state.turnIndex];
  const nat       = NATIONS[tid];
  const completed = state.turnPhases?.[tid] ?? [];
  const visible   = getVisiblePhases(tid);
  const doneCount = visible.filter(p => completed.includes(p.id)).length;
  const allDone   = doneCount === visible.length;

  const nameEl = document.getElementById('phaseNationName');
  if (nameEl) {
    nameEl.innerHTML = `${nationIconHTML(nat, 'nation-icon--sm')} ${nat.name}`;
    nameEl.style.color = `var(--c-${tid})`;
  }

  const progEl = document.getElementById('phaseProgress');
  if (progEl) {
    progEl.textContent = t('phase.done_count', { n: `${doneCount}/${visible.length}` });
    progEl.className   = `phase-progress${allDone ? ' all-done' : ''}`;
  }

  const listEl = document.getElementById('phaseList');
  if (listEl) {
    listEl.innerHTML = visible.map(p => {
      const done   = completed.includes(p.id);
      const warTag = p.warOnly ? `<span class="phase-war-tag">${t('phase.war_only')}</span>` : '';
      return `<label class="phase-item${done ? ' done' : ''}${p.indent ? ' indent' : ''}${p.warOnly ? ' war-only' : ''}">
        <input type="checkbox" ${done ? 'checked' : ''} ${p.id === 'p6' ? 'disabled' : ''} title="${p.id === 'p6' ? 'Markeres automatisk av Samle inn inntekt' : ''}" onchange="togglePhase('${tid}','${p.id}',this.checked)">
        <span class="phase-label">${t('phase.' + p.id)}</span>
        ${warTag}
      </label>`;
    }).join('');
  }

  const btn = document.getElementById('btnCompletePhases');
  if (btn) {
    btn.className = `btn btn-sm btn-complete-turn${allDone ? ' btn-primary' : ' btn-ghost'}`;
    btn.textContent = allDone ? t('header.finish_turn_done') : t('header.finish_turn');
  }
}

function togglePhase(tid, phaseId, checked) {
  // Phase 6 can only be completed automatically by collectIncome().
  if (phaseId === 'p6') {
    renderPhaseTracker();
    updateNationPhaseTracker(tid);
    return;
  }

  if (!state.turnPhases)       state.turnPhases = {};
  if (!state.turnPhases[tid])  state.turnPhases[tid] = [];

  if (checked) {
    if (!state.turnPhases[tid].includes(phaseId)) state.turnPhases[tid].push(phaseId);
  } else {
    state.turnPhases[tid] = state.turnPhases[tid].filter(p => p !== phaseId);
  }

  saveState();
  renderPhaseTracker();
  renderTurnStrip();
  updateNationPhaseTracker(tid);
  updateNationCardDoneState(tid);
  updateIncomeAdjVisibility(tid);
  if (checked) checkAllNationsDone();
}

function renderSidePanels() {
  const axisContainer   = document.getElementById('axisNations');
  const alliesContainer = document.getElementById('alliesNations');
  if (!axisContainer || !alliesContainer) return;

  const vcCounts = getVCCounts();

  ['axis','allies'].forEach(side => {
    const nationIds = Object.keys(NATIONS).filter(n => NATIONS[n].side === side);
    const container = document.getElementById(`${side}Nations`);
    const vcTotal = nationIds.reduce((s, n) => s + (vcCounts[n] || 0), 0);

    document.getElementById(`${side}VcCount`).textContent =
      `${vcTotal} / ${totalVCs()} seiersbyer`;

    container.innerHTML = nationIds.map(tid => {
      const nat    = NATIONS[tid];
      const ns     = state.nations[tid];
      const income = calcIncome(tid);
      const mainCap = nat.mainCapital
        ? TERRITORIES.find(t => t.name === nat.mainCapital)
        : null;
      const capHeld = mainCap ? getController(mainCap.id) === tid : true;
      const dotCls  = mainCap ? (capHeld ? 'dot-held' : 'dot-lost') : 'dot-neutral';

      return `<div class="overview-nation-row" data-nation="${tid}" onclick="switchTab('nations');scrollToNation('${tid}')"
        style="border-left: 3px solid var(--c-${tid}); background: linear-gradient(90deg, color-mix(in srgb, var(--c-${tid}) 12%, transparent) 0%, transparent 60%);">
        <span class="nation-flag">${nationIconHTML(nat, 'nation-icon--sm')}</span>
        <span class="nation-name">${nat.name}</span>
        ${mainCap ? `<span class="nation-capital-dot ${dotCls}" title="${mainCap.name}"></span>` : ''}
        <span class="nation-ipc-badge">💰 ${ns.treasury} IPC</span>
        <span class="nation-ipc-badge" style="color:var(--text-dim)">📈 ${income}/r</span>
      </div>`;
    }).join('');
  });
}

// ── Overview: Active nation focus card ───────────────────────
function renderFocusCard() {
  const el = document.getElementById('ovFocusCard');
  if (!el) return;

  const tid    = TURN_ORDER[state.turnIndex];
  const nat    = NATIONS[tid];
  const ns     = state.nations[tid];
  const income = calcIncome(tid);
  const bonus  = calcBonusIncome(tid);
  const capHeld = ownsMainCapital(tid);

  const terrCount = TERRITORIES.filter(t => getController(t.id) === tid).length;

  const techLabels = { heavyBombers:'🎯 Heavy Bombers', longRangePlanes:'✈️ Long Range Air', advancedArtillery:'💣 Adv Artillery',
    superSubs:'🌊 Super Subs', jetFighters:'⚡ Jet Fighters', rockets:'🚀 Raketter', radar:'📡 Radar',
    warBonds:'💰 War Bonds', mobilization:'🏭 Mobilization', shipbuilding:'⚓ Shipbuilding' };
  const techs = (ns.technologies ?? []).map(t => techLabels[t] ?? t);

  const objs      = NATIONAL_OBJECTIVES[tid] ?? [];
  const metObjs   = objs.filter(o => ns.objectives?.[o.id] === true);
  const totalObjs = objs.length;

  const changes   = state.territoryChanges ?? [];
  const conquered = changes.filter(c => c.to   === tid).map(c => c.name);
  const lost      = changes.filter(c => c.from === tid).map(c => c.name);

  const purchases    = ns.purchases ?? [];
  const lastPurchase = purchases.length
    ? purchases[purchases.length - 1].items.map(it => `${it.qty}×${it.name}`).join(', ')
    : null;

  const capLabel = nat.mainCapital
    ? ((nat.mainCapital.match(/\(([^)]+)\)/)?.[1]) || nat.mainCapital.replace(/ \(.*?\)/, ''))
    : '';

  const capStatus = nat.mainCapital
    ? (capHeld
        ? `<span class="ofc-cap-held">🏛️ ${capLabel} ✓</span>`
        : `<span class="ofc-cap-lost">🏛️ ${capLabel} TAPT</span>`)
    : '';

  const bonusHtml      = bonus > 0 ? `<span class="ofc-bonus">+${bonus} bonus</span>` : '';
  const techHtml       = techs.length
    ? `<div class="ofc-row"><div class="ofc-tag-list">${techs.map(t => `<span class="ofc-tag ofc-tag-tech">${t}</span>`).join('')}</div></div>`
    : '';
  const conqueredHtml  = conquered.length
    ? `<div class="ofc-row"><span class="ofc-row-label">${t('ov.conquered_label')}</span><div class="ofc-tag-list">${conquered.map(n => `<span class="ofc-tag ofc-tag-gain">${escHtml(n)}</span>`).join('')}</div></div>`
    : '';
  const lostHtml       = lost.length
    ? `<div class="ofc-row"><span class="ofc-row-label">${t('ov.lost_label')}</span><div class="ofc-tag-list">${lost.map(n => `<span class="ofc-tag ofc-tag-loss">${escHtml(n)}</span>`).join('')}</div></div>`
    : '';
  const purchaseHtml   = lastPurchase
    ? `<div class="ofc-row"><span class="ofc-row-label">${t('ov.purchased_label')}</span><span class="ofc-val">${escHtml(lastPurchase)}</span></div>`
    : '';
  const objHtml        = totalObjs > 0
    ? `<div class="ofc-row"><span class="ofc-row-label">${t('ov.objectives_label')}</span><span class="ofc-val">${t('ov.fulfilled', { met: metObjs.length, total: totalObjs })}</span></div>`
    : '';

  el.innerHTML = `
    <div class="ofc-card" style="--nat-color: var(--c-${tid})">
      <div class="ofc-header">
        <span class="ofc-flag">${nationIconHTML(nat, 'nation-icon--lg')}</span>
        <div class="ofc-title-block">
          <div class="ofc-nation-name">${escHtml(nat.name)}</div>
          <div class="ofc-subtitle">${t('ov.active_turn', { n: state.round })}</div>
        </div>
        ${capStatus}
      </div>
      <div class="ofc-stats">
        <div class="ofc-stat">
          <div class="ofc-stat-val">📈 ${income} IPC ${bonusHtml}</div>
          <div class="ofc-stat-label">${t('ov.income_label')}</div>
        </div>
        <div class="ofc-stat">
          <div class="ofc-stat-val">💰 ${ns.treasury} IPC</div>
          <div class="ofc-stat-label">${t('ov.in_treasury')}</div>
        </div>
        <div class="ofc-stat">
          <div class="ofc-stat-val">🗺️ ${terrCount}</div>
          <div class="ofc-stat-label">${t('ov.territories_label')}</div>
        </div>
      </div>
      ${conqueredHtml}${lostHtml}${purchaseHtml}${objHtml}${techHtml}
    </div>`;
}

// ── Overview: Compact nation mini-grid ────────────────────────
function renderNationMiniGrid() {
  const el = document.getElementById('ovNationGrid');
  if (!el) return;

  const axisTids   = TURN_ORDER.filter(tid => NATIONS[tid].side === 'axis');
  const alliesTids = TURN_ORDER.filter(tid => NATIONS[tid].side === 'allies');

  const renderGroup = (label, cls, tids) => {
    const rows = tids.map(tid => {
      const nat       = NATIONS[tid];
      const ns        = state.nations[tid];
      const income    = calcIncome(tid);
      const capHeld   = ownsMainCapital(tid);
      const isActive  = TURN_ORDER[state.turnIndex] === tid;
      const completed = state.turnPhases?.[tid] ?? [];
      const visible   = getVisiblePhases(tid);
      const allDone   = visible.length > 0 && visible.every(p => completed.includes(p.id));
      const dotCls    = capHeld ? 'dot-held' : 'dot-lost';

      return `<div class="ong-row${isActive ? ' ong-active' : ''}"
        onclick="switchTab('nations');scrollToNation('${tid}')"
        style="border-left: 3px solid var(--c-${tid})">
        <span class="ong-flag">${nationIconHTML(nat, 'nation-icon--sm')}</span>
        <span class="ong-name">${nat.shortName}</span>
        <span class="nation-capital-dot ${dotCls}" title="${escHtml(nat.mainCapital ?? '')}"></span>
        <span class="ong-income">${income} IPC</span>
        <span class="ong-treasury">${ns.treasury}💰</span>
        ${allDone ? '<span class="ong-done">✓</span>' : ''}
      </div>`;
    }).join('');
    return `<div class="ong-group">
      <div class="ong-group-header ${cls}">${label}</div>
      ${rows}
    </div>`;
  };

  el.innerHTML = `<div class="ong-wrap">
    ${renderGroup('⚔️ Aksen', 'axis', axisTids)}
    ${renderGroup('🏳️ Allierte', 'allies', alliesTids)}
  </div>`;
}

// ── Overview: Chronicle log (last completed round) ────────────
function renderChronicle() {
  const el = document.getElementById('ovChronicle');
  if (!el) return;

  const lastRound = state.history.length ? state.history[state.history.length - 1] : null;

  if (!lastRound) {
    const changes = state.territoryChanges ?? [];
    const bombing = state.bombingEvents ?? [];
    if (!changes.length && !bombing.length) {
      el.innerHTML = `<div class="oc-panel">
        <div class="oc-header">${t('ov.chronicle_curr', { n: state.round })}</div>
        <div class="oc-empty">${t('ov.no_events')}</div>
      </div>`;
      return;
    }
    const terrHtmlCurr = changes.length ? `
      <div class="oc-terr-section">
        ${changes.map(tc => {
          const fromNat = NATIONS[tc.from];
          const toNat   = NATIONS[tc.to];
          return `<div class="oc-terr-row">
            <span class="oc-terr-name">${escHtml(tc.name)}</span>
            <span class="oc-terr-arrow">${fromNat ? nationIconHTML(fromNat, 'nation-icon--xs') : '⚪'} → ${toNat ? nationIconHTML(toNat, 'nation-icon--xs') : '⚪'}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    const bombHtmlCurr = bombing.length ? buildOCBombingHTML(bombing) : '';
    el.innerHTML = `<div class="oc-panel">
      <div class="oc-header">${t('ov.chronicle_curr', { n: state.round })}</div>
      ${terrHtmlCurr}${bombHtmlCurr}
    </div>`;
    return;
  }

  const nationRows = TURN_ORDER.map(tid => {
    const nat = NATIONS[tid];
    const nd  = lastRound.nations?.[tid];
    if (!nd) return '';
    const delta       = nd.collected ?? 0;
    const deltaCls    = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
    const purchases   = nd.purchases ?? [];
    const purchaseStr = purchases.length
      ? purchases.map(p => p.items.map(it => `${it.qty}×${it.name}`).join(', ')).join(' / ')
      : null;
    const terrChanges = lastRound.territoryChanges ?? [];
    const gained      = terrChanges.filter(c => c.to   === tid).map(c => c.name);
    const lostT       = terrChanges.filter(c => c.from === tid).map(c => c.name);
    return `<div class="oc-nat-row" onclick="switchTab('nations');scrollToNation('${tid}')">
      <div class="oc-nat-header">
        <span class="oc-nat-flag">${nationIconHTML(nat, 'nation-icon--sm')}</span>
        <span class="oc-nat-name">${nat.shortName}</span>
        <span class="oc-delta ${deltaCls}">${delta >= 0 ? '+' : ''}${delta} IPC</span>
        <span class="oc-treasury">→ ${nd.endTreasury ?? '?'} IPC</span>
      </div>
      ${purchaseStr ? `<div class="oc-purchases">🛒 ${escHtml(purchaseStr)}</div>` : ''}
      ${gained.length ? `<div class="oc-terr-gained">${gained.map(n => `<span class="ofc-tag ofc-tag-gain">${escHtml(n)}</span>`).join('')}</div>` : ''}
      ${lostT.length  ? `<div class="oc-terr-lost">${lostT.map(n => `<span class="ofc-tag ofc-tag-loss">${escHtml(n)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  const lastBombing = lastRound.bombingEvents ?? [];
  const lastBombHtml = lastBombing.length ? buildOCBombingHTML(lastBombing) : '';

  el.innerHTML = `<div class="oc-panel">
    <div class="oc-header">
      ${t('ov.chronicle_round', { n: lastRound.round })}
      <span class="oc-vc-summary">${t('ov.vc_summary', { axis: lastRound.axisVC ?? '?', allies: lastRound.alliesVC ?? '?' })}</span>
    </div>
    <div class="oc-nations">${nationRows}</div>
    ${lastBombHtml}
  </div>`;
}

function buildOCBombingHTML(events) {
  return `<div class="oc-bombing-section">
    <div class="oc-bombing-title">💣 ${t('hist.bombing_section')}</div>
    ${events.map(b => {
      const atkNat = NATIONS[b.attackerId];
      const atkIcon = atkNat ? nationIconHTML(atkNat, 'nation-icon--xs') : '✈️';
      return `<div class="oc-bombing-row">
        <span class="oc-bombing-atk">${atkIcon} ${atkNat?.shortName ?? b.attackerId}</span>
        <span class="oc-bombing-sep">→</span>
        <span class="oc-bombing-target">${escHtml(b.terrName)}</span>
        <span class="oc-bombing-fac">${escHtml(b.facLabel)}</span>
        <span class="oc-bombing-dmg">${b.damage} ${t('hist.bombing_dmg')}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function renderVictoryMeter() {
  const axisVC   = getAxisVC();
  const alliesVC = getAlliesVC();
  const total    = totalVCs();
  const axisPct  = Math.round((axisVC / total) * 100);

  document.getElementById('victoryBarAxis').style.width   = axisPct + '%';
  document.getElementById('victoryBarAxis').textContent   = axisVC > 1 ? axisVC : '';
  document.getElementById('victoryBarAllies').textContent = alliesVC > 1 ? alliesVC : '';
  document.getElementById('victoryLabelAxis').textContent   = `Axis: ${axisVC}`;
  document.getElementById('victoryLabelAllies').textContent = `Allies: ${alliesVC}`;

  let winMsg = '';
  if (axisVC >= AXIS_WIN_VC) {
    winMsg = `<span class="win-axis">⚔️ AKSEN VINNER! (${axisVC} seiersbyer)</span>`;
  } else if (axisVC < totalVCs() - AXIS_WIN_VC + 1) {
    winMsg = `<span class="win-allies">🏳️ DE ALLIERTE VINNER!</span>`;
  }
  document.getElementById('winIndicator').innerHTML = winMsg;
}

// ── Nations tab ───────────────────────────────────────────────
function renderNations() {
  const container = document.getElementById('nationsGrid');
  if (container.dataset.built === '1') { updateNationCards(); return; }
  container.innerHTML = TURN_ORDER.map(tid => buildNationCard(tid)).join('');
  container.dataset.built = '1';
  addNationCardListeners();
  TURN_ORDER.forEach(tid => updateNationCardDoneState(tid));
}

function buildNationPhaseTrackerHTML(tid) {
  const completed = state.turnPhases?.[tid] ?? [];
  const visible   = getVisiblePhases(tid);
  const doneCount = visible.filter(p => completed.includes(p.id)).length;
  const allDone   = doneCount === visible.length;

  const phasesHTML = visible.map(p => {
    const done   = completed.includes(p.id);
    const warTag = p.warOnly ? `<span class="phase-war-tag">${t('phase.war_only')}</span>` : '';
    return `<label class="phase-item${done ? ' done' : ''}${p.indent ? ' indent' : ''}${p.warOnly ? ' war-only' : ''}">
      <input type="checkbox" ${done ? 'checked' : ''} ${p.id === 'p6' ? 'disabled' : ''} title="${p.id === 'p6' ? 'Markeres automatisk av Samle inn inntekt' : ''}" onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-label">${t('phase.' + p.id)}</span>
      ${warTag}
    </label>`;
  }).join('');

  const progressCls = `phase-progress${allDone ? ' all-done' : ''}`;
  return `<div class="nc-phase-progress"><span class="${progressCls}">${t('phase.done_count', { n: `${doneCount}/${visible.length}` })}</span></div>
<div class="phase-list nc-phase-list">${phasesHTML}</div>`;
}

function updateNationPhaseTracker(tid) {
  const completed = state.turnPhases?.[tid] ?? [];

  // Phase-blocks (collapsible)
  for (const phaseId of ['rd', 'p1', 'p3', 'p6']) {
    const block = document.getElementById(`pb-${phaseId}-${tid}`);
    if (!block) continue;
    const done = completed.includes(phaseId);
    block.classList.toggle('phase-done', done);
    const cb = block.querySelector(':scope > .phase-block-hdr .phase-cb input');
    if (cb) cb.checked = done;
    // Auto-collapse rd, p1, p3 when marked done
    if (done && phaseId !== 'p6') {
      const body = document.getElementById(`pbb-${phaseId}-${tid}`);
      const chev = document.getElementById(`pbchev-${phaseId}-${tid}`);
      if (body) body.classList.remove('open');
      if (chev) chev.textContent = '▸';
    }
  }

  // Phase-rows (simple checkboxes)
  for (const phaseId of ['p2', 'p4', 'p5', 'rockets', 'convoy']) {
    const row = document.getElementById(`pb-${phaseId}-${tid}`);
    if (!row) continue;
    const done = completed.includes(phaseId);
    row.classList.toggle('phase-done', done);
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = done;
  }

  // Update Fase 6 IPC preview
  const toUse   = calcTotalToSpend(tid);
  const preview = document.getElementById(`nc-p6-preview-${tid}`);
  if (preview) preview.textContent = `${toUse} IPC`;
}

function updateNationCardDoneState(tid) {
  const card  = document.getElementById(`nc-${tid}`);
  if (!card) return;
  const isDone = state.turnPhases?.[tid]?.includes('p6') ?? false;
  card.classList.toggle('round-done', isDone);
}

function onNationFieldChange(tid, field, val) {
  state.nations[tid][field] = val;
  saveState();
}

function buildNationHeaderFieldsInner(tid) {
  const nat         = NATIONS[tid];
  const income      = calcIncome(tid);
  const startIncome = nat.startIncome ?? 0;
  const delta       = income - startIncome;
  const deltaSign   = delta >= 0 ? '+' : '';
  const deltaCls    = delta > 0 ? 'nchf-delta-pos' : delta < 0 ? 'nchf-delta-neg' : 'nchf-delta-zero';

  // Territories conquered/lost this round from territoryChanges log
  const changes   = state.territoryChanges ?? [];
  const conquered = changes.filter(c => c.to   === tid).map(c => c.name);
  const lost      = changes.filter(c => c.from === tid).map(c => c.name);

  const terrList = (arr) => arr.length
    ? arr.map(n => `<span class="nchf-terr-tag">${n}</span>`).join('')
    : `<span class="nchf-empty">—</span>`;

  return `
    <div class="nc-hfield nchf-ipc-block">
      <div class="nc-hfield-label">Start IPC</div>
      <div class="nchf-start-val">${startIncome} <span class="nchf-ipc-unit">IPC</span></div>
      <div class="nchf-curr-row">
        <span class="nchf-curr-label">${t('nc.now')}</span>
        <span class="nchf-curr-val" id="nchf-curr-${tid}">${income}</span>
        <span class="nchf-ipc-unit">IPC</span>
        <span class="nchf-delta ${deltaCls}" id="nchf-delta-${tid}">${deltaSign}${delta}</span>
      </div>
    </div>
    <div class="nc-hfield nchf-terr-block">
      <div class="nc-hfield-label">⚔️ Erobret denne runden</div>
      <div class="nchf-terr-list" id="nchf-conquered-${tid}">${terrList(conquered)}</div>
    </div>
    <div class="nc-hfield nchf-terr-block">
      <div class="nc-hfield-label">💀 Mistet denne runden</div>
      <div class="nchf-terr-list" id="nchf-lost-${tid}">${terrList(lost)}</div>
    </div>`;
}

function buildNationCard(tid) {
  const nat      = NATIONS[tid];
  const ns       = state.nations[tid];
  const income   = calcIncome(tid);
  const toUse    = calcTotalToSpend(tid);
  const bonusSum = calcBonusIncome(tid);
  const completed = state.turnPhases?.[tid] ?? [];

  const isDone = (id) => completed.includes(id);
  const openIf = (_cond) => '';  // all blocks start collapsed

  // ── Teknologi ─────────────────────────────────────────────
  const makeTechCol = (chart) => TECHNOLOGIES.filter(t => t.chart === chart).map(t => {
    const ch  = ns.technologies.includes(t.id) ? 'checked' : '';
    const cls = ns.technologies.includes(t.id) ? 'researched' : '';
    return `<label class="tech-item ${cls}">
      <input type="checkbox" data-nation="${tid}" data-tech="${t.id}" ${ch}>
      <span class="tech-num">${t.dieRoll}</span>${t.name}
    </label>`;
  }).join('');
  const techsHTML = `
    <div class="tech-chart-grid">
      <div class="tech-chart"><div class="tech-chart-title">Breakthrough Chart 1</div>${makeTechCol(1)}</div>
      <div class="tech-chart"><div class="tech-chart-title">Breakthrough Chart 2</div>${makeTechCol(2)}</div>
    </div>`;

  // ── Fase 0: Forskning & Utvikling ─────────────────────────
  const rdDone = isDone('rd');
  const fase0Block = tid === 'china' ? '' : `
  <div class="phase-block${rdDone ? ' phase-done' : ''}" id="pb-rd-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','rd')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${rdDone ? 'checked' : ''} onchange="togglePhase('${tid}','rd',this.checked)">
      </label>
      <span class="phase-block-title">🔬 ${t('phase.rd_title')}</span>
      <span class="phase-opt-badge">${t('phase.optional')}</span>
      <span class="phase-chevron" id="pbchev-rd-${tid}">${rdDone ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!rdDone)}" id="pbb-rd-${tid}">
      ${buildRDSectionHTML(tid)}
      <div class="phase-sub-hdr">🧬 Teknologi</div>
      <div id="tech-${tid}">${techsHTML}</div>
    </div>
  </div>`;

  // ── Fase 1: Kjøp & Reparer ────────────────────────────────
  const p1Done = isDone('p1');
  const fase1Block = `
  <div class="phase-block${p1Done ? ' phase-done' : ''}" id="pb-p1-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','p1')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${p1Done ? 'checked' : ''} onchange="togglePhase('${tid}','p1',this.checked)">
      </label>
      <span class="phase-block-title">${t('phase.p1')}</span>
      <span class="phase-chevron" id="pbchev-p1-${tid}">${p1Done ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!p1Done)}" id="pbb-p1-${tid}">
      <div class="pc-budget-bar">
        <div class="pc-bitem"><span class="pc-blabel">${t('pc.available')}</span><span class="pc-bval" id="pc-avail-${tid}">${ns.treasury}</span><span class="pc-bunit">IPC</span></div>
        <div class="pc-bitem"><span class="pc-blabel">${t('pc.cart')}</span><span class="pc-bval" id="pc-cart-cost-${tid}">0</span><span class="pc-bunit">IPC</span></div>
        <div class="pc-bitem"><span class="pc-blabel">${t('pc.remaining')}</span><span class="pc-bval" id="pc-remaining-${tid}">${ns.treasury}</span><span class="pc-bunit">IPC</span></div>
      </div>
      <div id="pc-groups-${tid}">${buildPurchaseUnitRows(tid)}</div>
      <div class="pc-group">
        <div class="pc-group-label">${t('nc.repairs_label')}</div>
        <div id="pc-repair-detail-${tid}">${buildRepairDetailHTML(tid)}</div>
        <div class="pc-unit-row pc-repair-total-row">
          <span class="pc-unit-name">${t('nc.repair_total')}</span>
          <span class="pc-unit-cost"><span class="pc-cost-now">${ns.technologies.includes('comb_bombardment') ? t('pc.comb_cost') : t('pc.normal_cost')}</span></span>
          <div class="pc-qty-ctrl">
            <span class="pc-qty" id="pc-repair-marks-${tid}">0</span>
          </div>
          <span class="pc-subtotal" id="pc-repair-sub-${tid}">—</span>
        </div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-ghost btn-sm" onclick="clearCart('${tid}')">${t('nc.empty_cart')}</button>
        <button class="btn btn-success btn-sm" id="pc-confirm-${tid}" onclick="confirmPurchase('${tid}')">${t('nc.confirm_purchase')}</button>
      </div>
      <div id="pc-past-${tid}">${buildPastPurchasesHTML(tid)}</div>
    </div>
  </div>`;

  // ── Rockets sub-fase (kun hvis teknologi er forsket) ──────
  const hasRockets  = ns.technologies.includes('rockets');
  const rocketsDone = isDone('rockets');
  const operativeAirBases = hasRockets ? getOperativeAirBasesForNation(tid) : [];
  const enemyTerrWithFacs = hasRockets ? TERRITORIES.filter(t => {
    const c = getController(t.id);
    return c !== tid && c !== 'neutral' && c !== 'dutch' && hasFacility(t.id);
  }) : [];
  const rocketTargetOptions = enemyTerrWithFacs.map(terr => {
    const fac = getFacility(terr.id);
    const facs = [fac.ic ? (fac.ic === 'major' ? t('repair.major_ic') : t('repair.minor_ic')) : null, fac.airBase ? t('repair.airbase') : null, fac.navalBase ? t('repair.navalbase') : null].filter(Boolean).join(', ');
    return `<option value="${terr.id}">${terr.name} [${facs}]</option>`;
  }).join('');
  let rocketsBodyHTML = '';
  if (hasRockets) {
    if (operativeAirBases.length === 0) {
      rocketsBodyHTML = '<div class="rockets-section" id="rockets-body-' + tid + '">' +
        '<div class="rockets-no-bases">' + t('rocket.no_bases') + '</div>' +
        '</div>';
    } else {
      const baseRows = operativeAirBases.map(ab => {
        const abDmg = getFacilityDamage(ab.terrId).airBase || 0;
        const dmgSpan = abDmg > 0 ? '<span class="facility-dmg-badge">' + t('fac.badge.damage', { n: abDmg + '/6' }) + '</span>' : '';
        return '<div class="rocket-base-row">' +
          '<span class="rocket-base-name">✈️ ' + ab.terrName + '</span>' +
          dmgSpan +
          '<select class="rocket-target-sel" id="rocket-target-' + tid + '-' + ab.terrId + '">' +
          '<option value="">' + t('bomb.target_ph') + '</option>' +
          rocketTargetOptions +
          '</select>' +
          '<select class="rocket-factype-sel" id="rocket-factype-' + tid + '-' + ab.terrId + '">' +
          '<option value="ic">' + t('bomb.fac_ic') + '</option>' +
          '<option value="airBase">' + t('bomb.fac_airbase') + '</option>' +
          '<option value="navalBase">' + t('bomb.fac_navalbase') + '</option>' +
          '</select>' +
          '<label class="rocket-dmg-label">' + t('rocket.damage_label') + '</label>' +
          '<input type="number" class="rocket-dmg-input" id="rocket-dmg-' + tid + '-' + ab.terrId + '" min="1" max="6" placeholder="' + t('rocket.damage_ph') + '" title="' + t('rocket.damage_label') + '">' +
          '<button type="button" class="btn btn-sm btn-danger" onclick="launchRocket(\'' + tid + '\',\'' + ab.terrId + '\')">' + t('rocket.launch_btn') + '</button>' +
          '</div>';
      }).join('');
      rocketsBodyHTML = '<div class="rockets-section" id="rockets-body-' + tid + '">' + baseRows + '</div>';
    }
  }
  const rocketsRow  = !hasRockets ? '' : `
  <div class="phase-block${rocketsDone ? ' phase-done' : ''} phase-indent" id="pb-rockets-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','rockets')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${rocketsDone ? 'checked' : ''} onchange="togglePhase('${tid}','rockets',this.checked)">
      </label>
      <span class="phase-block-title">↳ 🚀 Rockets Launch</span>
      <span class="phase-chevron" id="pbchev-rockets-${tid}">${rocketsDone ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!rocketsDone)}" id="pbb-rockets-${tid}">
      ${rocketsBodyHTML}
    </div>
  </div>`;

  // ── Fase 2–5: enkle avhakingsrader ───────────────────────
  const simpleRows = [
    { id:'p2', warOnly:true  },
  ].map(p => {
    const done = isDone(p.id);
    return `
  <div class="phase-row${done ? ' phase-done' : ''}" id="pb-${p.id}-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-row-name">${t('phase.' + p.id)}</span>
      ${p.warOnly ? `<span class="phase-war-tag">${t('phase.war_only')}</span>` : ''}
    </label>
  </div>`;
  }).join('');

  const simpleRows45 = [
    { id:'p4', warOnly:false },
    { id:'p5', warOnly:false },
  ].map(p => {
    const done = isDone(p.id);
    return `
  <div class="phase-row${done ? ' phase-done' : ''}" id="pb-${p.id}-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-row-name">${t('phase.' + p.id)}</span>
      ${p.warOnly ? `<span class="phase-war-tag">${t('phase.war_only')}</span>` : ''}
    </label>
  </div>`;
  }).join('');

  // ── Fase 3: Gjennomfør kamp (kollapser med territorier) ───
  const p3Done = isDone('p3');
  // Build enemy territory + facility options for bombing
  const bombTargetTerrs = TERRITORIES.filter(t => {
    const c = getController(t.id);
    return c !== tid && c !== 'neutral' && c !== 'dutch' && hasFacility(t.id);
  });
  const bombTerrOptions = bombTargetTerrs.map(terr => {
    const fac = getFacility(terr.id);
    const owner = NATIONS[getController(terr.id)]?.shortName ?? '?';
    const facs = [fac.ic ? (fac.ic === 'major' ? t('repair.major_ic') : t('repair.minor_ic')) : null, fac.airBase ? t('repair.airbase') : null, fac.navalBase ? t('repair.navalbase') : null].filter(Boolean).join(', ');
    return `<option value="${terr.id}">${terr.name} [${owner}] — ${facs}</option>`;
  }).join('');
  ensureBombingMissions(tid);
  const bombTerrOptsWithBlank = `<option value="">${t('bomb.target_ph')}</option>` + bombTerrOptions;
  const initialMissionsHTML = bombingMissions[tid].map((m, idx) => buildMissionRowHTML(tid, m, idx, bombTerrOptsWithBlank)).join('');
  const bombingHasAnyDamage = bombingMissions[tid].some(m => m.damage > 0 && m.survivors > 0);
  const bombingTotalAllokert = bombingMissions[tid].reduce((s, m) => s + (m.assigned || 1), 0);
  const fase3Block = `
  <div class="phase-block${p3Done ? ' phase-done' : ''}" id="pb-p3-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','p3')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${p3Done ? 'checked' : ''} onchange="togglePhase('${tid}','p3',this.checked)">
      </label>
      <span class="phase-block-title">💥 ${t('phase.p3')} <span class="phase-war-tag">${t('phase.war_only')}</span></span>
      <span class="phase-chevron" id="pbchev-p3-${tid}">${p3Done ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!p3Done)}" id="pbb-p3-${tid}">
      <button class="nc-terr-link-btn" onclick="goToTerritories('${tid}')">
        🗺️ ${nat.name} →
      </button>
      <div class="bombing-section">
        <div class="phase-sub-hdr">${t('bomb.section_title')}</div>
        <div class="bomb-total-bar">${t('bomb.total_bar')} <span id="bomb-total-${tid}">${bombingTotalAllokert}</span> ${t('bomb.planes')}</div>
        <div id="bomb-missions-${tid}">${initialMissionsHTML}</div>
        <div class="bombing-row">
          <button type="button" class="btn btn-sm btn-ghost" onclick="addBombingMission('${tid}')">${t('bomb.add_mission')}</button>
        </div>
        <div class="bombing-row" id="bomb-apply-all-${tid}" style="${bombingHasAnyDamage ? '' : 'display:none'}">
          <button type="button" class="btn btn-sm btn-success" onclick="applyAllBombingDamage('${tid}')">${t('bomb.apply_all')}</button>
        </div>
      </div>
    </div>
  </div>`;

  // ── Fase 6: Samle inn inntekt ─────────────────────────────
  const p6Done   = isDone('p6');
  const fase6Block = `
  <div class="phase-block${p6Done ? ' phase-done' : ''}" id="pb-p6-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','p6')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${p6Done ? 'checked' : ''} onchange="togglePhase('${tid}','p6',this.checked)" disabled title="Markeres automatisk av Samle inn inntekt">
      </label>
      <span class="phase-block-title">💰 ${t('phase.p6')}</span>
      <span class="phase-ipc-preview" id="nc-p6-preview-${tid}">${toUse}\xa0IPC</span>
      <span class="phase-chevron" id="pbchev-p6-${tid}">▾</span>
    </div>
    <div class="phase-block-body" id="pbb-p6-${tid}">
      <div class="income-row">
        <span class="income-label">${t('nc.income_label')}</span>
        <span class="income-val" id="nc-income-${tid}">${income}\xa0IPC</span>
      </div>
      <div class="income-row">
        <span class="income-label">${t('nc.bonus_label')}</span>
        <span class="income-val text-green" id="nc-bonus-${tid}">${bonusSum > 0 ? '+' + bonusSum : bonusSum}\xa0IPC</span>
      </div>
      <div class="phase-sub-hdr">${t('nc.objectives')}</div>
      <div class="obj-section-header">
        <div class="obj-war-controls">
          <label class="obj-war-label${getEffectiveAtWar(tid) ? ' active' : ''}${state.round > 3 ? ' obj-war-locked' : ''}" title="${state.round > 3 ? t('nc.war_auto_locked') : (getEffectiveAtWar(tid) ? t('nc.set_peacetime') : t('nc.set_war'))}">
            <input type="checkbox" id="obj-atwar-${tid}" ${getEffectiveAtWar(tid) ? 'checked' : ''} ${state.round > 3 ? 'disabled' : ''} onchange="toggleAtWar('${tid}', this.checked)">
            ${t('nc.at_war')}${state.round > 3 ? ' 🔒' : ''}
          </label>
          <label class="obj-showall-label" title="${t('nc.show_all_bonuses')}">
            <input type="checkbox" id="obj-showall-${tid}" onchange="toggleObjShowAll('${tid}', this.checked)">
            ${t('nc.show_all')}
          </label>
        </div>
      </div>
      <div id="obj-list-${tid}">${buildObjectivesHTML(tid)}</div>
      <div class="phase-sub-hdr" style="margin-top:.5rem">${t('nc.adjustments')}</div>
      <div class="pc-unit-row income-stepper-row">
        <span class="pc-unit-name">${t('nc.convoy_loss')}</span>
        <span class="pc-unit-cost text-red">− ${t('ui.ipc')}</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="stepConvoy('${tid}', -1)">−</button>
          <span class="pc-qty" id="convoy-${tid}">${ns.convoyLoss || 0}</span>
          <button class="btn btn-ghost btn-sm" onclick="stepConvoy('${tid}', 1)">+</button>
        </div>
      </div>
      <div class="pc-unit-row income-stepper-row">
        <span class="pc-unit-name">${t('nc.war_bonds')}</span>
        <span class="pc-unit-cost text-green">+ ${t('ui.ipc')}</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="stepWarBonds('${tid}', -1)">−</button>
          <span class="pc-qty" id="warbonds-${tid}">${ns.warBonds || 0}</span>
          <button class="btn btn-ghost btn-sm" onclick="stepWarBonds('${tid}', 1)">+</button>
        </div>
      </div>
      <div class="pc-unit-row income-stepper-row adj-treasury-row">
        <span class="pc-unit-name">${t('nc.manual_adj')}</span>
        <span class="pc-unit-cost" style="color:var(--text-dim)">± IPC</span>
        <div class="pc-qty-ctrl" style="gap:.15rem">
          <button class="btn btn-ghost btn-sm" onclick="stepManualAdjust('${tid}', -5)" title="Trekk fra 5 IPC">−5</button>
          <button class="btn btn-ghost btn-sm" onclick="stepManualAdjust('${tid}', -1)" title="Trekk fra 1 IPC">−1</button>
          <span class="pc-qty" id="manualadjust-${tid}">${ns.manualAdjust || 0}</span>
          <button class="btn btn-ghost btn-sm" onclick="stepManualAdjust('${tid}', +1)" title="Legg til 1 IPC">+1</button>
          <button class="btn btn-ghost btn-sm" onclick="stepManualAdjust('${tid}', +5)" title="Legg til 5 IPC">+5</button>
        </div>
      </div>
      <div class="nc-income-hero">
        <span class="nc-income-hero-label">${t('nc.next_purchase')}</span>
        <span class="nc-income-hero-val" id="nc-tospend-${tid}">${toUse}</span>
        <span class="nc-income-hero-unit">IPC</span>
      </div>
      <div class="nc-formula" id="nc-formula-${tid}">${ns.treasury > 0 ? ns.treasury + ' (' + t('nc.formula.treasury') + ') + ' : ''}${(ns.capturedTreasury || 0) > 0 ? ns.capturedTreasury + ' (' + t('nc.formula.captured') + ') + ' : ''}${income} (${t('nc.formula.terr')}) + ${bonusSum} (${t('nc.formula.bonus')}) + ${ns.warBonds || 0} (${t('nc.formula.bonds')}) − ${ns.convoyLoss || 0} (${t('nc.formula.convoy')})${(ns.manualAdjust || 0) !== 0 ? ' ' + (ns.manualAdjust > 0 ? '+' : '') + ns.manualAdjust + ' (' + t('nc.formula.adjust') + ')' : ''} = <strong>${toUse} IPC</strong></div>
      <button class="nc-collect-btn" id="nc-collect-${tid}"
        onclick="collectIncome('${tid}')"
        ${ownsMainCapital(tid) ? '' : 'disabled'}
      >${ownsMainCapital(tid) ? t('nc.collect') : t('nc.capital_locked')}</button>
    </div>
  </div>`;

  // ── Konvoidisrupsjon (sub-fase etter Fase 6) ─────────────
  const convDone = isDone('convoy');
  const convoyRow = `
  <div class="phase-row${convDone ? ' phase-done' : ''} phase-indent" id="pb-convoy-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${convDone ? 'checked' : ''} onchange="togglePhase('${tid}','convoy',this.checked)">
      <span class="phase-row-name">${t('phase.convoy')}</span>
    </label>
  </div>`;

  // ── Notater (kollapset som standard) ─────────────────────
  const notesBlock = `
  <div class="phase-block phase-block-misc" id="pb-misc-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','misc')">
      <span class="phase-block-title" style="color:var(--text-dim);font-size:.78rem">${t('nc.notes_title')}</span>
      <span class="phase-chevron" id="pbchev-misc-${tid}">▸</span>
    </div>
    <div class="phase-block-body" id="pbb-misc-${tid}">
      <textarea class="notes-area" placeholder="${t('nc.notes_ph', { name: nat.name })}" id="notes-${tid}"
        onchange="onNotesChange('${tid}', this.value)">${ns.notes}</textarea>
    </div>
  </div>`;

  return `<div class="nation-card" data-nation="${tid}" id="nc-${tid}">
    <div class="nation-card-header" onclick="toggleNationCard('${tid}')">
      <div class="nc-header-left">
          <span class="nc-flag">${nationIconHTML(nat, 'nation-icon--md')}</span>
          <div class="nc-info">
            <div class="nc-name">${nat.shortName}</div>
          <div class="nc-side ${nat.side}">${nat.side === 'axis' ? t('nc.side.axis') : t('nc.side.allies')}</div>
        </div>
      </div>
      <div class="nc-header-fields" id="nc-hf-${tid}" onclick="event.stopPropagation()">
        ${buildNationHeaderFieldsInner(tid)}
      </div>
      <div class="nc-header-right">
        <span class="nc-done-badge" id="nc-done-badge-${tid}">${t('nc.round_done')}</span>
        <div class="nc-treasury">
          <div class="nc-treasury-label">${t('nc.treasury')}</div>
          <div class="nc-treasury-val" id="nc-treasury-${tid}">${ns.treasury}</div>
          <div class="nc-treasury-unit">IPC</div>
        </div>
        <span class="nc-toggle-icon">▾</span>
      </div>
    </div>
    <div class="nation-card-body" id="ncb-${tid}">
      <div class="ncb-col ncb-col1">
        ${fase0Block}
        ${fase1Block}
        ${simpleRows}
        ${fase3Block}
        ${rocketsRow}
        ${simpleRows45}
        ${fase6Block}
        ${convoyRow}
        ${notesBlock}
      </div>
    </div>
  </div>`;
}

function togglePhaseBlock(tid, blockId) {
  const body = document.getElementById(`pbb-${blockId}-${tid}`);
  const chev = document.getElementById(`pbchev-${blockId}-${tid}`);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (chev) chev.textContent = isOpen ? '▾' : '▸';
}

function toggleNationCard(tid) {
  const body = document.getElementById(`ncb-${tid}`);
  body.classList.toggle('open');
  const icon = document.querySelector(`#nc-${tid} .nc-toggle-icon`);
  if (icon) icon.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
}

function scrollToNation(tid) {
  const el = document.getElementById(`nc-${tid}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const body = document.getElementById(`ncb-${tid}`);
    body.classList.add('open');
  }
}

// ── Purchase calculator ─────────────────────────────────────────
const PC_GROUPS = [
  { labelKey: 'pc.group.land',  filter: u => u.type === 'land'     },
  { labelKey: 'pc.group.air',   filter: u => u.type === 'air'      },
  { labelKey: 'pc.group.sea',   filter: u => u.type === 'sea'      },
  { labelKey: 'pc.group.build', filter: u => u.type === 'building' },
];

function buildPurchaseUnitRows(tid) {
  const cart            = purchaseCart[tid] || {};
  const placements      = buildPlacements[tid] || {};
  const hasShipbuilding = state.nations[tid].technologies.includes('shipbuilding');
  // Territories controlled by this nation with IPC ≥ 1 (eligible for building placement)
  const ownedTerrs = TERRITORIES
    .filter(t => getController(t.id) === tid && t.ipc > 0)
    .sort((a, b) => b.ipc - a.ipc || a.name.localeCompare(b.name));
  const terrOptions = ownedTerrs.map(t =>
    `<option value="${t.id}">${t.name} (${t.ipc})</option>`
  ).join('');

  return PC_GROUPS.map(g => {
    const rows = UNITS.filter(g.filter).map(u => {
      const cost       = getUnitCost(u, tid);
      const discounted = u.shipbuildingCost !== undefined && hasShipbuilding;
      const costHtml   = discounted
        ? `<span class="pc-cost-orig">${u.cost}</span>&thinsp;<span class="pc-cost-now">${cost}</span>`
        : `<span class="pc-cost-now">${cost}</span>`;
      const qty = cart[u.id] || 0;
      const sub = qty * cost;
      const isBuilding = u.type === 'building';
      const selectedTerr = placements[u.id] || '';
      const placementRow = isBuilding && qty > 0 ? `
        <div class="pc-building-placement" id="pc-place-row-${tid}-${u.id}">
          <label class="pc-place-label">${t('pc.placement')}</label>
          <select class="pc-place-select" id="pc-place-${tid}-${u.id}"
            onchange="setBuildingPlacement('${tid}','${u.id}',this.value)">
            <option value="">${t('bomb.target_ph')}</option>
            ${terrOptions}
          </select>
        </div>` : (isBuilding ? `<div class="pc-building-placement" id="pc-place-row-${tid}-${u.id}" style="display:none">
          <label class="pc-place-label">${t('pc.placement')}</label>
          <select class="pc-place-select" id="pc-place-${tid}-${u.id}"
            onchange="setBuildingPlacement('${tid}','${u.id}',this.value)">
            <option value="">${t('bomb.target_ph')}</option>
            ${terrOptions}
          </select>
        </div>` : '');
      return `<div class="pc-unit-row${isBuilding ? ' pc-unit-building' : ''}">
        <span class="pc-unit-name">${u.name}</span>
        <span class="pc-unit-cost">${costHtml}&thinsp;IPC</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="addToCart('${tid}','${u.id}',-1)">−</button>
          <span class="pc-qty" id="pc-qty-${tid}-${u.id}">${qty}</span>
          <button class="btn btn-ghost btn-sm" onclick="addToCart('${tid}','${u.id}',+1)">+</button>
        </div>
        <span class="pc-subtotal" id="pc-sub-${tid}-${u.id}">${sub > 0 ? sub + ' IPC' : '—'}</span>
      </div>${placementRow}`;
    }).join('');
    return `<div class="pc-group"><div class="pc-group-label">${t(g.labelKey)}</div>${rows}</div>`;
  }).join('');
}

function buildPastPurchasesHTML(tid) {
  const logs = (state.purchaseLogs || []).filter(l => l.nationId === tid && l.round === state.round);
  if (!logs.length) return '';
  const entries = logs.map(l => {
    const tags = l.items.map(it =>
      `<span class="pc-hist-tag">${it.qty}× ${it.name} (${it.qty * it.costEach} IPC)</span>`
    ).join('');
    return `<div class="pc-hist-entry"><span class="pc-hist-time">${l.date}</span><div class="pc-hist-tags">${tags}</div><span class="pc-hist-total">= ${l.totalCost} IPC</span></div>`;
  }).join('');
  return `<div class="pc-hist-header">${t('pc.history_hdr')}</div>${entries}`;
}

// ── Facility helper ───────────────────────────────────────────
/** True if territory has at least one facility (any type). */
function hasFacility(terrId) {
  const f = getFacility(terrId);
  return !!(f.ic || f.airBase || f.navalBase);
}

/** Build the detailed repair rows HTML for fase1Block. */
function buildRepairDetailHTML(tid) {
  const damaged = getDamagedFacilitiesForNation(tid);
  if (!damaged.length) {
    if (tid === 'uk_pacific') {
      const ukeDamaged = getDamagedFacilitiesForNation('uk_europe');
      if (ukeDamaged.length) {
        return '<div class="repair-empty">Ingen skadede fasiliteter for UK Pacific.</div>' +
          '<div class="repair-empty">Skade i London/UK Europe vises under UKE-kortet. ' +
          '<button class="btn btn-ghost btn-sm" onclick="switchTab(\'nations\');scrollToNation(\'uk_europe\')">G\u00E5 til UKE</button></div>';
      }
    }
    if (tid === 'uk_europe') {
      const ukpDamaged = getDamagedFacilitiesForNation('uk_pacific');
      if (ukpDamaged.length) {
        return '<div class="repair-empty">Ingen skadede fasiliteter for UK Europe.</div>' +
          '<div class="repair-empty">Skade i India/UK Pacific vises under UKP-kortet. ' +
          '<button class="btn btn-ghost btn-sm" onclick="switchTab(\'nations\');scrollToNation(\'uk_pacific\')">G\u00E5 til UKP</button></div>';
      }
    }
    return '<div class="repair-empty">Ingen skadede fasiliteter.</div>';
  }
  const hasIFP = state.nations[tid].technologies.includes('comb_bombardment');
  const plan = getRepairPlan(tid);
  return damaged.map(d => {
    const key = repairKey(d.terrId, d.type);
    const selected = Math.min(plan[key] || 0, d.damage);
    const repairCost = hasIFP ? Math.ceil(selected / 2) : selected;
    const operative = (d.type !== 'ic' && d.damage >= 6) ? ' <span class="inoperative-badge">Inoperativ</span>' : '';
    return `<div class="repair-fac-row">
      <span class="repair-fac-name">${d.label} \u2014 ${d.terrName}${operative}</span>
      <span class="repair-fac-dmg">${d.damage}/${d.maxDamage} skade</span>
      <div class="pc-qty-ctrl repair-qty-ctrl">
        <button class="btn btn-ghost btn-sm" onclick="stepRepairTarget('${tid}','${d.terrId}','${d.type}',-1)">−</button>
        <span class="pc-qty">${selected}</span>
        <button class="btn btn-ghost btn-sm" onclick="stepRepairTarget('${tid}','${d.terrId}','${d.type}',1)">+</button>
      </div>
      <span class="repair-fac-cost">${repairCost > 0 ? repairCost + ' IPC' : '—'}</span>
    </div>`;
  }).join('');
}

function repairKey(terrId, type) {
  return terrId + '|' + type;
}

function getRepairPlan(tid) {
  if (!repairTokens[tid] || typeof repairTokens[tid] !== 'object') repairTokens[tid] = {};
  return repairTokens[tid];
}

function calcRepairIpcForMarks(tid, marks) {
  const hasIFP = state.nations[tid].technologies.includes('comb_bombardment');
  return hasIFP ? Math.ceil(marks / 2) : marks;
}

function getRepairTotals(tid) {
  const damaged = getDamagedFacilitiesForNation(tid);
  const plan = getRepairPlan(tid);
  let marks = 0;
  let ipc = 0;
  damaged.forEach(d => {
    const key = repairKey(d.terrId, d.type);
    const selected = Math.min(plan[key] || 0, d.damage);
    if (selected > 0) {
      marks += selected;
      ipc += calcRepairIpcForMarks(tid, selected);
    }
  });
  return { marks, ipc };
}

function stepRepairTarget(tid, terrId, type, delta) {
  const damaged = getDamagedFacilitiesForNation(tid);
  const row = damaged.find(d => d.terrId === terrId && d.type === type);
  if (!row) return;
  const key = repairKey(terrId, type);
  const plan = getRepairPlan(tid);
  const next = Math.max(0, Math.min(row.damage, (plan[key] || 0) + delta));
  if (next > 0) plan[key] = next;
  else delete plan[key];
  const repairEl = document.getElementById('pc-repair-detail-' + tid);
  if (repairEl) repairEl.innerHTML = buildRepairDetailHTML(tid);
  updatePurchaseDisplay(tid);
}

// ── Bombing / Rockets session state ──────────────────────────
// Mission shape: { id, terrId, facType, flyType, assigned, aaHits, survivors, damage }
let bombingMissions = {}; // { [nationId]: Mission[] }
let _missionIdCounter = 0;

function _newMission() {
  return { id: ++_missionIdCounter, terrId: '', facType: 'ic', flyType: 'strategic', assigned: 1,
           aaHits: null, survivors: null, damage: null };
}

function ensureBombingMissions(tid) {
  if (!bombingMissions[tid] || bombingMissions[tid].length === 0) {
    bombingMissions[tid] = [_newMission()];
  }
}

function addBombingMission(tid) {
  ensureBombingMissions(tid);
  bombingMissions[tid].push(_newMission());
  renderBombingMissions(tid);
}

function removeBombingMission(tid, mid) {
  if (!bombingMissions[tid]) return;
  bombingMissions[tid] = bombingMissions[tid].filter(m => m.id !== mid);
  if (bombingMissions[tid].length === 0) bombingMissions[tid] = [_newMission()];
  renderBombingMissions(tid);
}

function stepMission(tid, mid, delta) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  m.assigned = Math.max(1, m.assigned + delta);
  // Reset AA/damage when count changes
  m.aaHits = null; m.survivors = null; m.damage = null;
  const el = document.getElementById('bomb-count-' + tid + '-' + mid);
  if (el) el.textContent = m.assigned;
  const aaInput = document.getElementById('bomb-aa-hits-' + tid + '-' + mid);
  if (aaInput) { aaInput.value = ''; aaInput.max = m.assigned; }
  updateMissionSurvivors(tid, mid);
  updateBombingTotal(tid);
  updateApplyAllBtn(tid);
}

function updateBombingTotal(tid) {
  const total = (bombingMissions[tid] || []).reduce((s, m) => s + (m.assigned || 1), 0);
  const el = document.getElementById('bomb-total-' + tid);
  if (el) el.textContent = total;
}

function updateMissionTerr(tid, mid, terrId) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  m.terrId = terrId;
  m.aaHits = null; m.survivors = null; m.damage = null;
  const facSel = document.getElementById('bomb-factype-' + tid + '-' + mid);
  if (facSel && terrId) {
    const fac = getFacility(terrId);
    const opts = [];
    if (fac.ic)        opts.push('<option value="ic">Fabrikk (IC)</option>');
    if (fac.airBase)   opts.push('<option value="airBase">Luftbase</option>');
    if (fac.navalBase) opts.push('<option value="navalBase">Marinebase</option>');
    if (opts.length) { facSel.innerHTML = opts.join(''); m.facType = facSel.value; }
  }
  const aaEl  = document.getElementById('bomb-aa-'  + tid + '-' + mid);
  const dmgEl = document.getElementById('bomb-dmg-' + tid + '-' + mid);
  if (aaEl)  aaEl.innerHTML  = '';
  if (dmgEl) dmgEl.innerHTML = '';
  updateApplyAllBtn(tid);
}

function updateMissionFacType(tid, mid, facType) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  m.facType = facType; m.damage = null;
  const dmgInput = document.getElementById('bomb-dmg-input-' + tid + '-' + mid);
  if (dmgInput) dmgInput.value = '';
  updateMissionFacBar(tid, mid);
  updateApplyAllBtn(tid);
}

function updateMissionFlyType(tid, mid, flyType) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  m.flyType = flyType; m.damage = null;
  const dmgInput = document.getElementById('bomb-dmg-input-' + tid + '-' + mid);
  if (dmgInput) dmgInput.value = '';
  // Update hint text
  const hintEl = document.getElementById('bomb-dmg-hint-' + tid + '-' + mid);
  if (hintEl) hintEl.textContent = flyType === 'strategic' ? t('bomb.damage_hint_strat') : t('bomb.damage_hint_tact');
  updateApplyAllBtn(tid);
}

function updateApplyAllBtn(tid) {
  const hasAny = (bombingMissions[tid] || []).some(m => m.damage > 0 && m.survivors > 0);
  const btn = document.getElementById('bomb-apply-all-' + tid);
  if (btn) btn.style.display = hasAny ? '' : 'none';
}

/** Called when player enters the AA hits count from their physical dice roll. */
function onMissionAAInput(tid, mid, rawVal) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  const hits = Math.min(Math.max(parseInt(rawVal) || 0, 0), m.assigned);
  m.aaHits = hits;
  m.survivors = m.assigned - hits;
  m.damage = null;
  updateMissionSurvivors(tid, mid);
  // Reset damage input when AA changes
  const dmgInput = document.getElementById('bomb-dmg-input-' + tid + '-' + mid);
  if (dmgInput) dmgInput.value = '';
  updateMissionFacBar(tid, mid);
  updateApplyAllBtn(tid);
}

/** Called when player enters the total damage from their physical dice roll. */
function onMissionDamageInput(tid, mid, rawVal) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  const maxDmg = getMissionMaxDamage(m);
  m.damage = Math.min(Math.max(parseInt(rawVal) || 0, 0), maxDmg > 0 ? maxDmg : 9999);
  updateMissionFacBar(tid, mid);
  updateApplyAllBtn(tid);
}

/** Returns the max possible damage for this mission (based on current facility state). */
function getMissionMaxDamage(m) {
  if (!m.terrId) return 9999;
  const fac = getFacility(m.terrId);
  const maxKey = m.facType === 'ic' ? (fac.ic === 'major' ? 'ic_major' : 'ic_minor') : m.facType;
  const maxTotal = FACILITY_MAX[maxKey] ?? 9999;
  const curDmg = getFacilityDamage(m.terrId)[m.facType] || 0;
  return Math.max(0, maxTotal - curDmg);
}

/** Updates the survivors badge display. */
function updateMissionSurvivors(tid, mid) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m) return;
  const badge = document.getElementById('bomb-survivors-' + tid + '-' + mid);
  if (!badge) return;
  if (m.survivors === null) {
    badge.textContent = t('bomb.survivors_label') + ' \u2014';
    badge.className = 'bomb-survivors-badge';
  } else {
    badge.textContent = t('bomb.survivors_label') + ' ' + m.survivors;
    badge.className = 'bomb-survivors-badge' + (m.survivors === 0 ? ' bomb-survivors-zero' : '');
  }
  // Disable damage input if no survivors
  const dmgWrap = document.getElementById('bomb-dmg-wrap-' + tid + '-' + mid);
  if (dmgWrap) dmgWrap.classList.toggle('bomb-input-disabled', m.survivors === 0);
  const dmgInput = document.getElementById('bomb-dmg-input-' + tid + '-' + mid);
  if (dmgInput) dmgInput.disabled = m.survivors === 0;
}

/** Updates the facility HP bar and production capacity note. */
function updateMissionFacBar(tid, mid) {
  const m = (bombingMissions[tid] || []).find(m => m.id === mid);
  if (!m || !m.terrId) return;
  const fac = getFacility(m.terrId);
  const maxKey = m.facType === 'ic' ? (fac.ic === 'major' ? 'ic_major' : 'ic_minor') : m.facType;
  const maxTotal = FACILITY_MAX[maxKey] ?? 0;
  const committed = getFacilityDamage(m.terrId)[m.facType] || 0;
  const pending = m.damage || 0;
  const displayDmg = Math.min(committed + pending, maxTotal);
  const pct = maxTotal > 0 ? Math.round((displayDmg / maxTotal) * 100) : 0;

  const fill = document.getElementById('bomb-hp-fill-' + tid + '-' + mid);
  if (fill) fill.style.width = pct + '%';
  const text = document.getElementById('bomb-hp-text-' + tid + '-' + mid);
  if (text) text.textContent = t('bomb.hp_current', { cur: displayDmg, max: maxTotal });

  if (m.facType === 'ic' && fac.ic) {
    const maxProd = fac.ic === 'major' ? 10 : 3;
    const prodCap = Math.max(0, maxProd - displayDmg);
    const capEl = document.getElementById('bomb-prod-cap-' + tid + '-' + mid);
    if (capEl) {
      capEl.textContent = t('bomb.production_cap', { cur: prodCap, max: maxProd });
      capEl.style.display = '';
    }
  }
}

function applyAllBombingDamage(tid) {
  const missions = (bombingMissions[tid] || []).filter(m => m.damage > 0 && m.survivors > 0);
  if (!missions.length) { toast(t('toast.no_damage'), 'error'); return; }
  const affectedControllers = new Set();
  const summary = [];
  for (const m of missions) {
    const fac = getFacility(m.terrId);
    const facLabel = m.facType === 'ic' ? (fac.ic === 'major' ? t('repair.major_ic') : t('repair.minor_ic'))
      : (m.facType === 'airBase' ? t('repair.airbase') : t('repair.navalbase'));
    const terr = TERRITORIES.find(t => t.id === m.terrId);
    applyFacilityDamage(m.terrId, m.facType, m.damage);
    affectedControllers.add(getController(m.terrId));
    summary.push((terr ? terr.name : m.terrId) + ' ' + facLabel + ': ' + m.damage);
    if (!state.bombingEvents) state.bombingEvents = [];
    state.bombingEvents.push({ attackerId: tid, terrId: m.terrId, terrName: terr?.name ?? m.terrId, facLabel, damage: m.damage });
    m.aaHits = null; m.survivors = null; m.damage = null;
  }
  saveState();
  for (const ctrl of affectedControllers) {
    const repairEl = document.getElementById('pc-repair-detail-' + ctrl);
    if (repairEl) repairEl.innerHTML = buildRepairDetailHTML(ctrl);
  }
  renderBombingMissions(tid);
  toast(t('toast.bombing_applied', { summary: summary.join(' | ') }), 'warning');
}

function buildMissionRowHTML(tid, m, idx, bombTerrOpts) {
  const mid = m.id;
  let facOpts = '<option value="ic">' + t('bomb.fac_ic') + '</option>'
    + '<option value="airBase">' + t('bomb.fac_airbase') + '</option>'
    + '<option value="navalBase">' + t('bomb.fac_navalbase') + '</option>';
  if (m.terrId) {
    const fac = getFacility(m.terrId);
    const opts = [];
    if (fac.ic)        opts.push('<option value="ic"'        + (m.facType === 'ic'        ? ' selected' : '') + '>' + t('bomb.fac_ic')       + '</option>');
    if (fac.airBase)   opts.push('<option value="airBase"'   + (m.facType === 'airBase'   ? ' selected' : '') + '>' + t('bomb.fac_airbase')  + '</option>');
    if (fac.navalBase) opts.push('<option value="navalBase"' + (m.facType === 'navalBase' ? ' selected' : '') + '>' + t('bomb.fac_navalbase')+ '</option>');
    if (opts.length) facOpts = opts.join('');
  }
  const terrOptsSel = m.terrId ? bombTerrOpts.replace('value="' + m.terrId + '"', 'value="' + m.terrId + '" selected') : bombTerrOpts;
  const survivorsText = m.survivors === null ? '\u2014' : String(m.survivors);
  const survivorsZero = m.survivors === 0;
  const dmgDisabledAttr = survivorsZero ? ' disabled' : '';
  const dmgWrapClass = 'bomb-input-group' + (survivorsZero ? ' bomb-input-disabled' : '');
  const dmgHint = m.flyType === 'strategic' ? t('bomb.damage_hint_strat') : t('bomb.damage_hint_tact');

  // Facility HP bar (shown when territory and facility are selected)
  let facBarHTML = '';
  if (m.terrId) {
    const fac = getFacility(m.terrId);
    const maxKey = m.facType === 'ic' ? (fac.ic === 'major' ? 'ic_major' : 'ic_minor') : m.facType;
    const maxTotal = FACILITY_MAX[maxKey] ?? 0;
    const committed = getFacilityDamage(m.terrId)[m.facType] || 0;
    const pending = m.damage || 0;
    const displayDmg = maxTotal > 0 ? Math.min(committed + pending, maxTotal) : 0;
    const pct = maxTotal > 0 ? Math.round((displayDmg / maxTotal) * 100) : 0;
    const facKeyMap = { ic: fac.ic === 'major' ? 'bomb.fac_label.major_ic' : 'bomb.fac_label.minor_ic', airBase: 'bomb.fac_label.airbase', navalBase: 'bomb.fac_label.navalbase' };
    const facLabelStr = t(facKeyMap[m.facType] ?? 'bomb.fac_ic');

    let prodCapHTML = '';
    if (m.facType === 'ic' && fac.ic) {
      const maxProd = fac.ic === 'major' ? 10 : 3;
      const prodCap = Math.max(0, maxProd - displayDmg);
      prodCapHTML = '<div class="bomb-prod-cap" id="bomb-prod-cap-' + tid + '-' + mid + '">'
        + t('bomb.production_cap', { cur: prodCap, max: maxProd }) + '</div>';
    }

    facBarHTML = '<div class="bomb-facility-status">'
      + '<div class="bomb-hp-bar-wrap">'
      + '<span class="bomb-hp-label">' + facLabelStr + '</span>'
      + '<div class="bomb-hp-track"><div class="bomb-hp-fill" id="bomb-hp-fill-' + tid + '-' + mid + '" style="width:' + pct + '%"></div></div>'
      + '<span class="bomb-hp-text" id="bomb-hp-text-' + tid + '-' + mid + '">' + t('bomb.hp_current', { cur: displayDmg, max: maxTotal }) + '</span>'
      + '</div>'
      + prodCapHTML
      + '</div>';
  }

  return '<div class="bomb-mission" id="bomb-mission-' + tid + '-' + mid + '">'
    + '<div class="bomb-mission-hdr">'
    + '<span class="bomb-mission-title">' + t('bomb.mission_title') + ' ' + (idx + 1) + '</span>'
    + '<button type="button" class="btn btn-ghost btn-xs" onclick="removeBombingMission(\'' + tid + '\',' + mid + ')" title="' + t('bomb.remove_title') + '">\uD83D\uDDD1</button>'
    + '</div>'
    // Target
    + '<div class="bombing-row"><label class="bombing-label">' + t('bomb.target') + '</label>'
    + '<select class="bombing-select" id="bomb-terr-' + tid + '-' + mid + '" onchange="updateMissionTerr(\'' + tid + '\',' + mid + ',this.value)">'
    + terrOptsSel + '</select></div>'
    // Facility
    + '<div class="bombing-row"><label class="bombing-label">' + t('bomb.facility') + '</label>'
    + '<select class="bombing-select" id="bomb-factype-' + tid + '-' + mid + '" onchange="updateMissionFacType(\'' + tid + '\',' + mid + ',this.value)">'
    + facOpts + '</select></div>'
    // Aircraft type
    + '<div class="bombing-row"><label class="bombing-label">' + t('bomb.fly_type') + '</label>'
    + '<select class="bombing-select" id="bomb-flytype-' + tid + '-' + mid + '" onchange="updateMissionFlyType(\'' + tid + '\',' + mid + ',this.value)">'
    + '<option value="strategic"' + (m.flyType === 'strategic' ? ' selected' : '') + '>' + t('bomb.strategic') + '</option>'
    + '<option value="tactical"'  + (m.flyType === 'tactical'  ? ' selected' : '') + '>' + t('bomb.tactical')  + '</option>'
    + '</select></div>'
    // Bomber count
    + '<div class="bombing-row"><label class="bombing-label">' + t('bomb.bomber_count') + '</label>'
    + '<div class="pc-qty-ctrl">'
    + '<button type="button" class="btn btn-ghost btn-sm" onclick="stepMission(\'' + tid + '\',' + mid + ',-1)">\u2212</button>'
    + '<span class="pc-qty" id="bomb-count-' + tid + '-' + mid + '">' + m.assigned + '</span>'
    + '<button type="button" class="btn btn-ghost btn-sm" onclick="stepMission(\'' + tid + '\',' + mid + ',+1)">+</button>'
    + '</div></div>'
    // Manual inputs section
    + '<div class="bomb-manual-inputs">'
    // AA hits
    + '<div class="bomb-input-group">'
    + '<label class="bomb-input-label" for="bomb-aa-hits-' + tid + '-' + mid + '">'
    + t('bomb.aa_hits_label')
    + '<span class="bomb-hint">' + t('bomb.aa_hint') + '</span></label>'
    + '<input type="number" class="bomb-number-input" id="bomb-aa-hits-' + tid + '-' + mid + '"'
    + ' min="0" max="' + m.assigned + '" value="' + (m.aaHits !== null ? m.aaHits : '') + '"'
    + ' placeholder="0" title="' + t('bomb.aa_hits_label') + '"'
    + ' oninput="onMissionAAInput(\'' + tid + '\',' + mid + ',this.value)">'
    + '<span class="bomb-survivors-badge' + (survivorsZero ? ' bomb-survivors-zero' : '') + '" id="bomb-survivors-' + tid + '-' + mid + '">'
    + t('bomb.survivors_label') + ' ' + survivorsText + '</span>'
    + '</div>'
    // Damage
    + '<div class="' + dmgWrapClass + '" id="bomb-dmg-wrap-' + tid + '-' + mid + '">'
    + '<label class="bomb-input-label" for="bomb-dmg-input-' + tid + '-' + mid + '">'
    + t('bomb.damage_label')
    + '<span class="bomb-hint" id="bomb-dmg-hint-' + tid + '-' + mid + '">' + dmgHint + '</span></label>'
    + '<input type="number" class="bomb-number-input" id="bomb-dmg-input-' + tid + '-' + mid + '"'
    + ' min="0" value="' + (m.damage !== null ? m.damage : '') + '"'
    + ' placeholder="0" title="' + t('bomb.damage_label') + '"'
    + dmgDisabledAttr
    + ' oninput="onMissionDamageInput(\'' + tid + '\',' + mid + ',this.value)">'
    + '</div>'
    + '</div>'
    // Facility HP bar
    + facBarHTML
    + '</div>';
}

function renderBombingMissions(tid) {
  const container = document.getElementById('bomb-missions-' + tid);
  if (!container) return;
  ensureBombingMissions(tid);
  const targets = TERRITORIES.filter(terr => {
    const c = getController(terr.id);
    return c !== tid && c !== 'neutral' && c !== 'dutch' && hasFacility(terr.id);
  });
  const opts = '<option value="">' + t('bomb.target_ph') + '</option>' + targets.map(terr => {
    const fac = getFacility(terr.id);
    const owner = NATIONS[getController(terr.id)]?.shortName ?? '?';
    const facs = [fac.ic ? (fac.ic === 'major' ? t('repair.major_ic') : t('repair.minor_ic')) : null, fac.airBase ? t('repair.airbase') : null, fac.navalBase ? t('repair.navalbase') : null].filter(Boolean).join(', ');
    return '<option value="' + terr.id + '">' + terr.name + ' [' + owner + '] \u2014 ' + facs + '</option>';
  }).join('');
  container.innerHTML = bombingMissions[tid].map((m, idx) => buildMissionRowHTML(tid, m, idx, opts)).join('');
  updateBombingTotal(tid);
  updateApplyAllBtn(tid);
}

function launchRocket(tid, sourceTerrId) {
  const targetSel  = document.getElementById('rocket-target-'  + tid + '-' + sourceTerrId);
  const factypeSel = document.getElementById('rocket-factype-' + tid + '-' + sourceTerrId);
  const dmgInput   = document.getElementById('rocket-dmg-' + tid + '-' + sourceTerrId);
  if (!targetSel || !targetSel.value) { toast(t('toast.no_target'), 'error'); return; }
  if (!isOperativeAirBase(sourceTerrId)) {
    toast(t('toast.airbase_damaged'), 'error'); return;
  }
  const targetTerrId = targetSel.value;
  const facType = factypeSel ? factypeSel.value : 'ic';
  const fac = getFacility(targetTerrId);
  if (facType === 'ic'        && !fac.ic)       { toast(t('toast.no_factory'),   'error'); return; }
  if (facType === 'airBase'   && !fac.airBase)   { toast(t('toast.no_airbase'),  'error'); return; }
  if (facType === 'navalBase' && !fac.navalBase) { toast(t('toast.no_navalbase'),'error'); return; }
  const roll = Math.min(Math.max(parseInt(dmgInput?.value) || 1, 1), 6);
  const terrObj = TERRITORIES.find(terr => terr.id === targetTerrId);
  const facLabelKey = facType === 'ic' ? 'fac.major_ic' : facType === 'airBase' ? 'fac.airbase' : 'fac.navalbase';
  applyFacilityDamage(targetTerrId, facType, roll);
  saveState();
  const controller = getController(targetTerrId);
  const repairEl = document.getElementById('pc-repair-detail-' + controller);
  if (repairEl) repairEl.innerHTML = buildRepairDetailHTML(controller);
  if (dmgInput) dmgInput.value = '';
  const curDmg = getFacilityDamage(targetTerrId)[facType] || 0;
  const maxKey = facType === 'ic' ? (fac.ic === 'major' ? 'ic_major' : 'ic_minor') : facType;
  toast(t('toast.rocket_hit', { terr: terrObj ? terrObj.name : targetTerrId, fac: t(facLabelKey), roll, cur: curDmg, max: FACILITY_MAX[maxKey] }), 'warning');
}

function addToCart(tid, unitId, delta) {
  if (!purchaseCart[tid]) purchaseCart[tid] = {};
  purchaseCart[tid][unitId] = Math.max(0, (purchaseCart[tid][unitId] || 0) + delta);
  // Show/hide building placement row
  const unit = UNITS.find(u => u.id === unitId);
  if (unit?.type === 'building') {
    const placeRow = document.getElementById(`pc-place-row-${tid}-${unitId}`);
    if (placeRow) placeRow.style.display = purchaseCart[tid][unitId] > 0 ? '' : 'none';
    if (purchaseCart[tid][unitId] === 0 && buildPlacements[tid]) {
      delete buildPlacements[tid][unitId];
    }
  }
  updatePurchaseDisplay(tid);
}

function setBuildingPlacement(tid, unitId, terrId) {
  if (!buildPlacements[tid]) buildPlacements[tid] = {};
  if (terrId) buildPlacements[tid][unitId] = terrId;
  else delete buildPlacements[tid][unitId];
}

function clearCart(tid) {
  purchaseCart[tid] = {};
  buildPlacements[tid] = {};
  repairTokens[tid] = {};
  updatePurchaseDisplay(tid);
}

function confirmPurchase(tid) {
  const cart = purchaseCart[tid] || {};
  const ns   = state.nations[tid];
  const placements = buildPlacements[tid] || {};
  const items = [];
  let totalCost = 0;
  const repairTotals = getRepairTotals(tid);
  const repairCost = repairTotals.ipc;

  // Validate building placements before anything else
  const buildingUnits = UNITS.filter(u => u.type === 'building');
  for (const unit of buildingUnits) {
    const qty = cart[unit.id] || 0;
    if (qty === 0) continue;
    const terrId = placements[unit.id];
    if (!terrId) {
      toast(t('pc.pick_territory', { name: unit.name }), 'error');
      return;
    }
    const terr = TERRITORIES.find(terr => terr.id === terrId);
    if (unit.id === 'minor_ic' || unit.id === 'major_ic') {
      const minIpc = unit.id === 'major_ic' ? 3 : 2;
      if (!terr || terr.ipc < minIpc) {
        toast(t('pc.min_ipc_required', { name: unit.name, ipc: minIpc }), 'error');
        return;
      }
      if (getFacility(terrId).ic) {
        toast(t('pc.already_has_factory', { terr: terr ? terr.name : terrId }), 'error');
        return;
      }
    } else {
      const key = unit.id === 'air_base' ? 'airBase' : 'navalBase';
      if (getFacility(terrId)[key]) {
        toast(t('pc.already_has_building', { terr: terr ? terr.name : terrId, name: unit.name.toLowerCase() }), 'error');
        return;
      }
    }
  }

  for (const [unitId, qty] of Object.entries(cart)) {
    if (qty <= 0) continue;
    const unit     = UNITS.find(u => u.id === unitId);
    if (!unit) continue;
    const costEach = getUnitCost(unit, tid);
    items.push({ unitId, name: unit.name, qty, costEach });
    totalCost += qty * costEach;
  }
  totalCost += repairCost;
  if (!items.length && repairCost === 0) { toast(t('pc.cart_empty'), 'error'); return; }
  if (totalCost > ns.treasury) {
    toast(t('pc.not_enough_ipc', { need: totalCost, have: ns.treasury }), 'error');
    return;
  }
  ns.treasury -= totalCost;

  // Apply building placements to state.facilities
  for (const unit of buildingUnits) {
    const qty = cart[unit.id] || 0;
    if (qty === 0) continue;
    const terrId = placements[unit.id];
    if (!terrId) continue;
    if (!state.facilities[terrId]) state.facilities[terrId] = { ic: null, airBase: false, navalBase: false };
    if (!state.facilityDamage[terrId]) state.facilityDamage[terrId] = { ic: 0, airBase: 0, navalBase: 0 };
    const fac = state.facilities[terrId];
    if (unit.id === 'minor_ic') fac.ic = 'minor';
    else if (unit.id === 'major_ic') fac.ic = 'major';
    else if (unit.id === 'air_base') fac.airBase = true;
    else if (unit.id === 'naval_base') fac.navalBase = true;
  }

  // Apply selected repairs per facility row
  const repairPlan = getRepairPlan(tid);
  getDamagedFacilitiesForNation(tid).forEach(d => {
    const key = repairKey(d.terrId, d.type);
    const marks = Math.min(repairPlan[key] || 0, d.damage);
    if (marks > 0) repairFacilityDamage(d.terrId, d.type, marks);
  });

  state.purchaseLogs.push({
    round: state.round, nationId: tid, items, totalCost,
    date:  new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }),
  });
  purchaseCart[tid] = {};
  buildPlacements[tid] = {};
  repairTokens[tid] = {};
  // Mark Fase 1 as completed
  if (!state.turnPhases)       state.turnPhases = {};
  if (!state.turnPhases[tid])  state.turnPhases[tid] = [];
  if (!state.turnPhases[tid].includes('p1')) state.turnPhases[tid].push('p1');
  saveState();
  const tVal = document.getElementById(`nc-treasury-${tid}`);
  if (tVal) tVal.textContent = ns.treasury;
  updateIncomeDisplay(tid);
  updateIncomeAdjVisibility(tid);
  updatePurchaseDisplay(tid);
  renderPhaseTracker();
  renderTurnStrip();
  updateNationPhaseTracker(tid);
  updateNationCardDoneState(tid);
  const pastEl = document.getElementById(`pc-past-${tid}`);
  if (pastEl) pastEl.innerHTML = buildPastPurchasesHTML(tid);
  const purchaseNames = items.map(it => `${it.qty}× ${it.name}`).join(', ');
  const repairNote = repairTotals.marks > 0 ? `${purchaseNames ? ', ' : ''}${t('toast.phase1_repair', { marks: repairTotals.marks })}` : '';
  toast(t('toast.phase1_done', { flag: NATIONS[tid].flag, items: purchaseNames, repair: repairNote, cost: totalCost, treasury: ns.treasury }), 'success');
}

function updatePurchaseDisplay(tid) {
  const cart  = purchaseCart[tid] || {};
  const avail = state.nations[tid].treasury;
  let cartTotal = 0;
  UNITS.forEach(u => {
    const qty  = cart[u.id] || 0;
    const cost = getUnitCost(u, tid);
    const sub  = qty * cost;
    cartTotal += sub;
    const qtyEl = document.getElementById(`pc-qty-${tid}-${u.id}`);
    if (qtyEl) qtyEl.textContent = qty;
    const subEl = document.getElementById(`pc-sub-${tid}-${u.id}`);
    if (subEl) subEl.textContent = sub > 0 ? sub + ' IPC' : '—';
  });
  const repairTotals = getRepairTotals(tid);
  cartTotal += repairTotals.ipc;
  const repairQtyEl = document.getElementById(`pc-repair-marks-${tid}`);
  if (repairQtyEl) repairQtyEl.textContent = repairTotals.marks;
  const repairSubEl = document.getElementById(`pc-repair-sub-${tid}`);
  if (repairSubEl) repairSubEl.textContent = repairTotals.ipc > 0 ? repairTotals.ipc + ' IPC' : '—';
  const availEl = document.getElementById(`pc-avail-${tid}`);
  if (availEl) availEl.textContent = avail;
  const cartEl = document.getElementById(`pc-cart-cost-${tid}`);
  if (cartEl) { cartEl.textContent = cartTotal; cartEl.style.color = cartTotal > 0 ? 'var(--gold)' : ''; }
  const remEl = document.getElementById(`pc-remaining-${tid}`);
  if (remEl) {
    const rem = avail - cartTotal;
    remEl.textContent = rem;
    remEl.style.color = rem < 0 ? 'var(--red)' : cartTotal > 0 ? 'var(--green)' : '';
  }
  const btn = document.getElementById(`pc-confirm-${tid}`);
  if (btn) btn.disabled = cartTotal === 0 || cartTotal > avail;
}

// Updates all live income-section elements for one nation
function updateIncomeDisplay(tid) {
  const ns     = state.nations[tid];
  const income = calcIncome(tid);
  const bonus  = calcBonusIncome(tid);
  const toUse  = calcTotalToSpend(tid);

  const bonusEl = document.getElementById(`nc-bonus-${tid}`);
  if (bonusEl) bonusEl.textContent = (bonus > 0 ? '+' : '') + bonus + ' IPC';

  const spendEl = document.getElementById(`nc-tospend-${tid}`);
  if (spendEl) spendEl.textContent = String(toUse);

  const fmtEl = document.getElementById(`nc-formula-${tid}`);
  if (fmtEl) {
    const treasuryPart = ns.treasury > 0 ? `${ns.treasury} (${t('nc.formula.treasury')}) + ` : '';
    const capturedPart = (ns.capturedTreasury || 0) > 0 ? `${ns.capturedTreasury} (${t('nc.formula.captured')}) + ` : '';
    const adjustPart2 = (ns.manualAdjust || 0) !== 0 ? ` ${ns.manualAdjust > 0 ? '+' : ''}${ns.manualAdjust} (${t('nc.formula.adjust')})` : '';
    fmtEl.innerHTML = `= ${treasuryPart}${capturedPart}${income} (${t('nc.formula.terr')}) + ${bonus} (${t('nc.formula.bonus')}) + ${ns.warBonds || 0} (${t('nc.formula.bonds')}) − ${ns.convoyLoss || 0} (${t('nc.formula.convoy')})${adjustPart2} = <strong>${toUse} IPC</strong>`;
  }

  const collectBtn = document.getElementById(`nc-collect-${tid}`);
  if (collectBtn) {
    const hasCapital = ownsMainCapital(tid);
    const alreadyCollected = state.turnPhases?.[tid]?.includes('p6') ?? false;
    if (alreadyCollected) {
      collectBtn.disabled = true;
      collectBtn.style.opacity = '0.5';
      collectBtn.style.cursor  = 'not-allowed';
      collectBtn.title = t('nc.already_coll_title');
      collectBtn.textContent = t('nc.already_collected');
    } else {
      collectBtn.disabled = !hasCapital;
      collectBtn.style.opacity = hasCapital ? '' : '0.4';
      collectBtn.style.cursor  = hasCapital ? '' : 'not-allowed';
      collectBtn.title = hasCapital ? '' : t('nc.capital_locked_tip');
      collectBtn.textContent = hasCapital ? t('nc.collect') : t('nc.capital_locked');
    }
  }
}

function updateIncomeAdjVisibility(tid) {
  const el = document.getElementById(`nc-income-adj-${tid}`);
  if (!el) return;
  const completed = state.turnPhases?.[tid] ?? [];
  el.style.display = (completed.includes('p1') && !completed.includes('p6')) ? '' : 'none';
}

function updateNationCards() {
  TURN_ORDER.forEach(tid => {
    const ns     = state.nations[tid];
    const income = calcIncome(tid);
    const tVal   = document.getElementById(`nc-treasury-${tid}`);
    if (tVal) tVal.textContent = ns.treasury;
    const incEl  = document.getElementById(`nc-income-${tid}`);
    if (incEl) incEl.textContent = income + ' IPC';

    // Update dynamic header fields (IPC + territory changes)
    const hfEl = document.getElementById(`nc-hf-${tid}`);
    if (hfEl) hfEl.innerHTML = buildNationHeaderFieldsInner(tid);

    updateIncomeDisplay(tid);
    updatePurchaseDisplay(tid);
    updateRDPanel(tid);
    updateNationCardDoneState(tid);
    refreshObjectivesSection(tid);
  });
}

// ── UK Helpers ────────────────────────────────────────────────
function isUK(tid) { return tid === 'uk_europe' || tid === 'uk_pacific'; }
function ukPartner(tid) { return tid === 'uk_europe' ? 'uk_pacific' : 'uk_europe'; }
// Shared dice are stored on uk_europe
function getUKSharedDice() { return state.nations['uk_europe'].researchDice || 0; }
function setUKSharedDice(v) { state.nations['uk_europe'].researchDice = Math.max(0, v); state.nations['uk_pacific'].researchDice = state.nations['uk_europe'].researchDice; }

// ── Research & Development ────────────────────────────────────
function buildRDSectionHTML(tid) {
  const ns    = state.nations[tid];
  if (tid === 'china') return `
    <div class="nc-section nc-s-rd">
      <div class="nc-section-title">🎲 Forskning & Utvikling</div>
      <div class="rd-china-note">Kina kan ikke forske (regelbok).</div>
    </div>`;

  // UK shared R&D section
  if (isUK(tid)) {
    const count    = getUKSharedDice();
    const ukeNs    = state.nations['uk_europe'];
    const ukpNs    = state.nations['uk_pacific'];
    return `
    <div class="nc-section nc-s-rd" id="rd-section-${tid}">
      <div class="nc-section-title">${t('rd.title_uk')}</div>
      <div class="rd-info">${t('rd.uk_info')}</div>
      <div class="rd-counter-row">
        <div class="rd-dice-display">
          <span class="rd-dice-icon">🎲</span>
          <span class="rd-dice-count" id="rd-count-${tid}">${count}</span>
          <span class="rd-dice-label" id="rd-label-${tid}">${count !== 1 ? t('rd.dice_plural') : t('rd.dice_singular')} ${t('rd.dice_shared')}</span>
        </div>
      </div>
      <div class="rd-uk-treasuries">
        <span class="rd-uk-treas">🇬🇧 UKE: <strong id="rd-uke-treas-${tid}">${ukeNs.treasury}</strong> IPC</span>
        <span class="rd-uk-treas">🏴 UKP: <strong id="rd-ukp-treas-${tid}">${ukpNs.treasury}</strong> IPC</span>
      </div>
      <div class="rd-buy-btns" style="flex-wrap:wrap;gap:.3rem;margin-top:.3rem">
        <button class="btn btn-primary btn-sm" onclick="buyResearchDice('uk_europe', 1)" title="${t('rd.uk_buy_uke_title')}">${t('rd.uk_buy_uke')}</button>
        <button class="btn btn-primary btn-sm" onclick="buyResearchDice('uk_pacific', 1)" title="${t('rd.uk_buy_ukp_title')}">${t('rd.uk_buy_ukp')}</button>
        <button class="btn btn-accent btn-sm" onclick="showUKSplitBuy('${tid}')" title="${t('rd.uk_split_title')}">${t('rd.uk_split_btn')}</button>
        <button class="btn btn-ghost btn-sm" onclick="buyResearchDiceUKRemove('${tid}')" title="${t('rd.remove_title')}">−</button>
      </div>
      <div id="rd-split-ui-${tid}" style="display:none"></div>
      <div class="rd-actions">
        <button class="btn btn-ghost btn-sm" onclick="resetResearchDice('${tid}')">${t('rd.reset_btn')}</button>
      </div>
      <div id="rd-result-${tid}"></div>
    </div>`;
  }

  // Non-UK nations: standard R&D section
  const count = ns.researchDice || 0;
  return `
    <div class="nc-section nc-s-rd" id="rd-section-${tid}">
      <div class="nc-section-title">${t('rd.title')} <span class="rd-phase-badge">${t('rd.phase_badge')}</span></div>
      <div class="rd-cost-hint">${t('rd.cost_hint')}</div>
      <div class="rd-stepper">
        <button class="rd-step-btn" onclick="buyResearchDice('${tid}', -1)">−</button>
        <div class="rd-step-display">
          <span class="rd-step-icon">🎲</span>
          <span class="rd-step-count" id="rd-count-${tid}">${count}</span>
          <span class="rd-step-label" id="rd-label-${tid}">${count !== 1 ? t('rd.dice_plural') : t('rd.dice_singular')}</span>
        </div>
        <button class="rd-step-btn rd-step-add" onclick="buyResearchDice('${tid}', 1)">+ 5 IPC</button>
      </div>
      <button class="btn btn-ghost btn-sm rd-reset-btn" onclick="resetResearchDice('${tid}')">${t('rd.reset_btn')}</button>
      <div id="rd-result-${tid}"></div>
    </div>`;
}

function buyResearchDice(tid, delta) {
  if (tid === 'china') { toast(t('nc.china_no_rd'), 'error'); return; }
  const ns = state.nations[tid];

  // UK shared dice handling
  if (isUK(tid)) {
    if (delta > 0 && ns.treasury < 5) { toast(`${t('toast.not_enough_ipc_nation', { name: NATIONS[tid].name })}`, 'error'); return; }
    if (delta > 0) ns.treasury -= 5;
    if (delta < 0) {
      // Refund to this economy
      if (getUKSharedDice() <= 0) return;
      ns.treasury += 5;
    }
    setUKSharedDice(getUKSharedDice() + delta);
    saveState();
    // Update both UK panels
    updateRDPanel('uk_europe');
    updateRDPanel('uk_pacific');
    for (const uid of ['uk_europe','uk_pacific']) {
      const tVal = document.getElementById(`nc-treasury-${uid}`);
      if (tVal) tVal.textContent = state.nations[uid].treasury;
      updateIncomeDisplay(uid);
      updatePurchaseDisplay(uid);
    }
    return;
  }

  // Standard (non-UK) handling
  if (delta > 0 && ns.treasury < 5) { toast(t('toast.not_enough_ipc'), 'error'); return; }
  if (delta < 0 && (ns.researchDice || 0) <= 0) return;
  if (delta > 0) ns.treasury -= 5;
  if (delta < 0) ns.treasury += 5;
  ns.researchDice = Math.max(0, (ns.researchDice || 0) + delta);
  saveState();
  updateRDPanel(tid);
  const tVal = document.getElementById(`nc-treasury-${tid}`);
  if (tVal) tVal.textContent = ns.treasury;
  updateIncomeDisplay(tid);
  updatePurchaseDisplay(tid);
}

// UK: Remove one shared die (refund to the requesting economy)
function buyResearchDiceUKRemove(tid) {
  if (!isUK(tid)) return;
  if (getUKSharedDice() <= 0) return;
  // Refund 5 IPC to the current nation's treasury
  state.nations[tid].treasury += 5;
  setUKSharedDice(getUKSharedDice() - 1);
  saveState();
  updateRDPanel('uk_europe');
  updateRDPanel('uk_pacific');
  for (const uid of ['uk_europe','uk_pacific']) {
    const tVal = document.getElementById(`nc-treasury-${uid}`);
    if (tVal) tVal.textContent = state.nations[uid].treasury;
    updateIncomeDisplay(uid);
    updatePurchaseDisplay(uid);
  }
}

// UK: Show split-payment UI
function showUKSplitBuy(tid) {
  const ukeNs = state.nations['uk_europe'];
  const ukpNs = state.nations['uk_pacific'];
  const el = document.getElementById(`rd-split-ui-${tid}`);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="rd-split-box">
      <div class="rd-split-title">Del 5 IPC mellom UKE og UKP:</div>
      <div class="rd-split-inputs">
        <label>🇬🇧 UKE: <input type="number" id="rd-split-uke-${tid}" value="3" min="0" max="5" style="width:50px" onchange="onUKSplitChange('${tid}','uke',this.value)"> IPC (har ${ukeNs.treasury})</label>
        <label>🏴 UKP: <input type="number" id="rd-split-ukp-${tid}" value="2" min="0" max="5" style="width:50px" onchange="onUKSplitChange('${tid}','ukp',this.value)"> IPC (har ${ukpNs.treasury})</label>
      </div>
      <div id="rd-split-err-${tid}" style="color:var(--red);font-size:.75rem"></div>
      <button class="btn btn-success btn-sm" onclick="confirmUKSplitBuy('${tid}')">✅ Bekreft spleis</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('rd-split-ui-${tid}').style.display='none'">Avbryt</button>
    </div>`;
}

function onUKSplitChange(tid, side, val) {
  const v = Math.max(0, Math.min(5, parseInt(val) || 0));
  const other = side === 'uke' ? 'ukp' : 'uke';
  const otherInput = document.getElementById(`rd-split-${other}-${tid}`);
  if (otherInput) otherInput.value = 5 - v;
}

function confirmUKSplitBuy(tid) {
  const ukeVal = parseInt(document.getElementById(`rd-split-uke-${tid}`)?.value) || 0;
  const ukpVal = parseInt(document.getElementById(`rd-split-ukp-${tid}`)?.value) || 0;
  const errEl  = document.getElementById(`rd-split-err-${tid}`);
  if (ukeVal + ukpVal !== 5) { if (errEl) errEl.textContent = t('uk.split_sum_error'); return; }
  if (ukeVal < 0 || ukpVal < 0) { if (errEl) errEl.textContent = t('uk.split_neg_error'); return; }
  if (state.nations['uk_europe'].treasury < ukeVal) { if (errEl) errEl.textContent = t('uk.split_uke_low', { ipc: state.nations['uk_europe'].treasury }); return; }
  if (state.nations['uk_pacific'].treasury < ukpVal) { if (errEl) errEl.textContent = t('uk.split_ukp_low', { ipc: state.nations['uk_pacific'].treasury }); return; }
  state.nations['uk_europe'].treasury -= ukeVal;
  state.nations['uk_pacific'].treasury -= ukpVal;
  setUKSharedDice(getUKSharedDice() + 1);
  saveState();
  toast(t('toast.uk_split', { uke: ukeVal, ukp: ukpVal }), 'success');
  document.getElementById(`rd-split-ui-${tid}`).style.display = 'none';
  updateRDPanel('uk_europe');
  updateRDPanel('uk_pacific');
  for (const uid of ['uk_europe','uk_pacific']) {
    const tVal = document.getElementById(`nc-treasury-${uid}`);
    if (tVal) tVal.textContent = state.nations[uid].treasury;
    updateIncomeDisplay(uid);
    updatePurchaseDisplay(uid);
  }
}

function resetResearchDice(tid) {
  if (isUK(tid)) {
    setUKSharedDice(0);
    saveState();
    updateRDPanel('uk_europe');
    updateRDPanel('uk_pacific');
    const rdR1 = document.getElementById('rd-result-uk_europe');
    const rdR2 = document.getElementById('rd-result-uk_pacific');
    if (rdR1) rdR1.innerHTML = '';
    if (rdR2) rdR2.innerHTML = '';
  } else {
    state.nations[tid].researchDice = 0;
    saveState();
    updateRDPanel(tid);
    const rdResult = document.getElementById(`rd-result-${tid}`);
    if (rdResult) rdResult.innerHTML = '';
  }
}

function rollResearchDice(tid) {
  const ns    = state.nations[tid];
  const count = isUK(tid) ? getUKSharedDice() : (ns.researchDice || 0);
  if (!count) return;
  const rolls           = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  const hasBreakthrough = rolls.some(r => r === 6);
  const diceHtml = rolls.map(r =>
    `<span class="rd-die${r === 6 ? ' rd-die-hit' : ''}">${r}</span>`
  ).join('');
  const rdResult = document.getElementById(`rd-result-${tid}`);
  if (!rdResult) return;

  if (hasBreakthrough) {
    rdResult.innerHTML = `
      <div class="rd-roll-result">
        <div class="rd-rolls">${diceHtml}</div>
        <div class="rd-breakthrough">${t('rd.breakthrough')}</div>
        <div class="rd-chart-choice">
          <div class="rd-chart-hint">${t('rd.chart_hint')}</div>
          <div class="rd-chart-btns">
            <div class="rd-chart-col">
              <div class="rd-chart-header">${t('rd.chart1_header')}</div>
              <div class="rd-chart-list">
                <div class="rd-chart-entry"><span class="rd-chart-num">1</span>Advanced Artillery</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">2</span>Rockets</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">3</span>Paratroopers</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">4</span>Increased Factory Prod.</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">5</span>War Bonds</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">6</span>Impr. Mech. Infantry</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', 1)">${t('rd.roll_chart1')}</button>
            </div>
            <div class="rd-chart-col">
              <div class="rd-chart-header">${t('rd.chart2_header')}</div>
              <div class="rd-chart-list">
                <div class="rd-chart-entry"><span class="rd-chart-num">1</span>Super Submarines</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">2</span>Jet Fighters</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">3</span>Improved Shipyards</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">4</span>Radar</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">5</span>Long-Range Aircraft</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">6</span>Heavy Bombers</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', 2)">${t('rd.roll_chart2')}</button>
            </div>
          </div>
          <div id="rd-chart-result-${tid}"></div>
        </div>
      </div>`;
  } else {
    rdResult.innerHTML = `
      <div class="rd-roll-result">
        <div class="rd-rolls">${diceHtml}</div>
        <div class="rd-no-breakthrough">${t('rd.no_breakthrough')}</div>
      </div>`;
  }
}

function showChartRoll(tid, chart) {
  const roll = Math.floor(Math.random() * 6) + 1;
  const ns   = state.nations[tid];
  const tech = TECHNOLOGIES.find(t => t.chart === chart && t.dieRoll === roll);
  const alreadyHas = tech && ns.technologies.includes(tech.id);
  const chartResultEl = document.getElementById(`rd-chart-result-${tid}`);
  if (!chartResultEl) return;

  let html = `<div class="rd-chart-outcome">
    <span class="rd-die rd-die-roll">${roll}</span>
    <strong>${tech ? tech.name : '?'}</strong>
    ${alreadyHas ? `<span class="rd-already-has">${t('rd.already_has')}</span>` : ''}
  </div>`;

  if (tech && !alreadyHas) {
    html += `<button class="btn btn-success btn-sm rd-confirm-btn" onclick="assignResearchTech('${tid}','${tech.id}')">${t('rd.confirm_tech', {name: tech.name})}</button>`;
  } else {
    html += `<div class="rd-chart-btns" style="margin-top:.4rem">
      <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', ${chart})">${t('rd.reroll')}</button>
    </div>`;
  }
  chartResultEl.innerHTML = html;
}

function assignResearchTech(tid, techId) {
  const ns = state.nations[tid];
  if (!ns.technologies.includes(techId)) ns.technologies.push(techId);

  // UK: share technology with partner economy
  if (isUK(tid)) {
    const partner = ukPartner(tid);
    const partnerNs = state.nations[partner];
    if (!partnerNs.technologies.includes(techId)) partnerNs.technologies.push(techId);
    setUKSharedDice(0);
  } else {
    ns.researchDice = 0;
  }

  saveState();
  const tech = TECHNOLOGIES.find(t => t.id === techId);

  if (isUK(tid)) {
    toast(t('toast.tech_developed_uk', { name: tech?.name }), 'success');
  } else {
    toast(t('toast.tech_developed', { flag: NATIONS[tid].flag, nation: NATIONS[tid].name, name: tech?.name }), 'success');
  }

  // Update tech grid checkboxes
  const nationsToUpdate = isUK(tid) ? ['uk_europe','uk_pacific'] : [tid];
  for (const uid of nationsToUpdate) {
    const techCb = document.querySelector(`#tech-${uid} input[data-tech="${techId}"]`);
    if (techCb) { techCb.checked = true; techCb.closest('.tech-item')?.classList.add('researched'); }
    // If shipbuilding, rebuild purchase rows
    if (techId === 'shipbuilding') {
      const grpEl = document.getElementById(`pc-groups-${uid}`);
      if (grpEl) grpEl.innerHTML = buildPurchaseUnitRows(uid);
      updatePurchaseDisplay(uid);
    }
    updateRDPanel(uid);
    const rdResult = document.getElementById(`rd-result-${uid}`);
    if (rdResult) rdResult.innerHTML = `<div class="rd-tech-acquired">${t('rd.tech_unlocked', { name: tech?.name })}</div>`;
  }
  renderPhaseTracker();
  renderTurnStrip();
}

function updateRDPanel(tid) {
  const ns    = state.nations[tid];
  const count = isUK(tid) ? getUKSharedDice() : (ns.researchDice || 0);
  const countEl = document.getElementById(`rd-count-${tid}`);
  if (countEl) countEl.textContent = count;
  const labelEl = document.getElementById(`rd-label-${tid}`);
  if (labelEl) {
    labelEl.textContent = isUK(tid)
      ? `terning${count !== 1 ? 'er' : ''} (delt)`
      : `terning${count !== 1 ? 'er' : ''}`;
  }
  const rollBtn = document.getElementById(`rd-roll-${tid}`);
  if (rollBtn) rollBtn.disabled = count === 0;
  // Update UK treasury displays in R&D section
  if (isUK(tid)) {
    const ukeTreas = document.getElementById(`rd-uke-treas-${tid}`);
    const ukpTreas = document.getElementById(`rd-ukp-treas-${tid}`);
    if (ukeTreas) ukeTreas.textContent = state.nations['uk_europe'].treasury;
    if (ukpTreas) ukpTreas.textContent = state.nations['uk_pacific'].treasury;
  }
}

function buildObjectivesHTML(tid) {
  evalObjectivesForNation(tid);
  const objs = NATIONAL_OBJECTIVES[tid] ?? [];
  if (!objs.length) return `<span style="color:var(--text-muted);font-size:.8rem">${t('obj.no_objectives')}</span>`;
  const ns      = state.nations[tid] ?? {};
  const atWar   = getEffectiveAtWar(tid);
  const showAll = objShowAll[tid] ?? false;

  const visible = showAll ? objs : objs.filter(o => {
    if (o.warOnly   && !atWar) return false;
    if (o.peaceOnly &&  atWar) return false;
    return true;
  });

  if (!visible.length) {
    return `<span class="obj-empty-msg">${atWar ? t('obj.no_active_war') : t('obj.no_active_peace')}</span>`;
  }

  return visible.map(o => {
    const hasRule     = !!OBJECTIVE_RULES[o.id];
    const checked     = ns.objectives?.[o.id] ? 'checked' : '';
    const claimed     = ns.objectivesClaimed?.[o.id];
    const disabled    = (o.oneTime && claimed) || hasRule ? 'disabled' : '';
    const claimedNote = (o.oneTime && claimed)
      ? ` <span style="color:var(--text-muted);font-size:.7rem">${t('obj.claimed')}</span>` : '';
    let ipcTag, detailTag = '';
    if (o.dynamicIpc && o.id === 'sov_axis_territories') {
      const axisTerms = getSovAxisTerritories();
      const total     = axisTerms.length * (o.ipcPerTerritory || 0);
      const terrList  = axisTerms.length ? axisTerms.map(terr => terr.name).join(', ') : t('obj.no_territories');
      ipcTag    = `<span style="color:var(--gold);font-weight:700;margin-left:.3rem">+${total} IPC (${axisTerms.length}×${o.ipcPerTerritory})</span>`;
      detailTag = `<br><span style="font-size:.75rem;color:var(--text-muted);margin-left:1.3rem">${t('obj.territories_label')} ${terrList}</span>`;
    } else {
      ipcTag = `<span style="color:var(--gold);font-weight:700;margin-left:.3rem">+${o.ipc} IPC</span>`;
    }
    const warBadge    = showAll && o.warOnly   ? `<span class="obj-badge obj-badge-war">${t('obj.badge.war')}</span>`   : '';
    const peaceBadge  = showAll && o.peaceOnly ? `<span class="obj-badge obj-badge-peace">${t('obj.badge.peace')}</span>` : '';
    const autoBadge   = hasRule ? `<span class="obj-badge obj-badge-auto" title="${t('obj.auto_title')}">⚙ auto</span>` : '';
    const titleAttr   = hasRule ? t('obj.auto_full_title', { hint: o.hint }) : o.hint;
    return `<label class="tech-item${checked ? ' researched' : ''}" title="${titleAttr}" style="grid-column:1/-1;align-items:flex-start">
      <input type="checkbox" data-nation="${tid}" data-obj="${o.id}" ${checked} ${disabled}
        style="margin-top:.15rem;flex-shrink:0" onchange="onObjectiveChange('${tid}','${o.id}',this.checked)">
      <span>${autoBadge}${warBadge}${peaceBadge}${o.desc}${ipcTag}${claimedNote}${detailTag}</span>
    </label>`;
  }).join('');
}

function addNationCardListeners() {
  // Only tech checkboxes — objectives use inline onchange
  document.querySelectorAll('.tech-item input[data-tech]').forEach(cb => {
    cb.addEventListener('change', () => {
      const { nation, tech } = cb.dataset;
      const nationsToSync = isUK(nation) ? ['uk_europe','uk_pacific'] : [nation];
      for (const uid of nationsToSync) {
        const ns = state.nations[uid];
        if (cb.checked) {
          if (!ns.technologies.includes(tech)) ns.technologies.push(tech);
        } else {
          ns.technologies = ns.technologies.filter(t => t !== tech);
        }
        // Sync checkbox UI for partner
        const partnerCb = document.querySelector(`#tech-${uid} input[data-tech="${tech}"]`);
        if (partnerCb && partnerCb !== cb) {
          partnerCb.checked = cb.checked;
          partnerCb.closest('.tech-item')?.classList.toggle('researched', cb.checked);
        }
        // If Improved Shipbuilding toggled, rebuild purchase cost rows
        if (tech === 'shipbuilding') {
          const grpEl = document.getElementById(`pc-groups-${uid}`);
          if (grpEl) grpEl.innerHTML = buildPurchaseUnitRows(uid);
          updatePurchaseDisplay(uid);
        }
      }
      cb.closest('.tech-item').classList.toggle('researched', cb.checked);
      saveState();
    });
  });
}

function onTreasuryChange(tid, val) {
  const v = parseInt(val);
  if (!isNaN(v) && v >= 0) {
    state.nations[tid].treasury = v;
    const tVal = document.getElementById(`nc-treasury-${tid}`);
    if (tVal) tVal.textContent = v;
    updateIncomeDisplay(tid);
    saveState();
  }
}

function adjustTreasury(tid, delta) {
  const newVal = Math.max(0, (state.nations[tid].treasury || 0) + delta);
  state.nations[tid].treasury = newVal;
  const input = document.getElementById(`treasury-${tid}`);
  if (input) input.value = newVal;
  onTreasuryChange(tid, newVal);
  updatePurchaseDisplay(tid);
}

function onConvoyChange(tid, val) {
  state.nations[tid].convoyLoss = Math.max(0, parseInt(val) || 0);
  updateIncomeDisplay(tid);
  saveState();
}

function onWarBondsChange(tid, val) {
  state.nations[tid].warBonds = Math.max(0, parseInt(val) || 0);
  updateIncomeDisplay(tid);
  saveState();
}

function stepConvoy(tid, delta) {
  const el = document.getElementById(`convoy-${tid}`);
  if (!el) return;
  const newVal = Math.max(0, (parseInt(el.textContent) || 0) + delta);
  el.textContent = newVal;
  onConvoyChange(tid, newVal);
}

function stepWarBonds(tid, delta) {
  const el = document.getElementById(`warbonds-${tid}`);
  if (!el) return;
  const newVal = Math.max(0, Math.min(6, (parseInt(el.textContent) || 0) + delta));
  el.textContent = newVal;
  onWarBondsChange(tid, newVal);
}

function stepManualAdjust(tid, delta) {
  const ns     = state.nations[tid];
  const newVal = (ns.manualAdjust || 0) + delta;
  ns.manualAdjust = newVal;
  const el = document.getElementById(`manualadjust-${tid}`);
  if (el) el.textContent = newVal;
  saveState();
  updateIncomeDisplay(tid);
  updatePurchaseDisplay(tid);
}

// ── War status helpers ─────────────────────────────────────────
function getEffectiveAtWar(tid) {
  return state.round > 3 || (state.nations[tid]?.atWar ?? false);
}

function toggleAtWar(tid, checked) {
  if (state.round > 3) return; // auto-locked after round 3
  state.nations[tid].atWar = checked;
  const ns = state.nations[tid];
  if (checked) {
    // switching to war: uncheck all peaceOnly objectives
    (NATIONAL_OBJECTIVES[tid] ?? []).filter(o => o.peaceOnly).forEach(o => {
      ns.objectives[o.id] = false;
    });
  } else {
    // switching to peace: auto-check all peaceOnly objectives
    (NATIONAL_OBJECTIVES[tid] ?? []).filter(o => o.peaceOnly).forEach(o => {
      if (!ns.objectivesClaimed?.[o.id]) ns.objectives[o.id] = true;
    });
  }
  saveState();
  refreshObjectivesSection(tid);
}

function toggleObjShowAll(tid, checked) {
  objShowAll[tid] = checked;
  refreshObjectivesSection(tid);
}

function refreshObjectivesSection(tid) {
  const listEl = document.getElementById(`obj-list-${tid}`);
  if (listEl) listEl.innerHTML = buildObjectivesHTML(tid);
  const cbWar = document.getElementById(`obj-atwar-${tid}`);
  if (cbWar) {
    const isWar = getEffectiveAtWar(tid);
    cbWar.checked  = isWar;
    cbWar.disabled = state.round > 3;
    const lbl = cbWar.closest('label');
    if (lbl) {
      lbl.classList.toggle('obj-war-locked', state.round > 3);
      lbl.classList.toggle('active', isWar);
      const textEl = lbl.querySelector('.obj-war-text');
      if (textEl) textEl.textContent = `${isWar ? '\u2694\ufe0f Krig' : '\u2618\ufe0f Fred'}${state.round > 3 ? ' \ud83d\udd12' : ''}`;
    }
  }
}

function onNotesChange(tid, val) {
  state.nations[tid].notes = val;
  saveState();
}

function onObjectiveChange(tid, objId, isChecked) {
  if (!state.nations[tid].objectives) state.nations[tid].objectives = {};
  state.nations[tid].objectives[objId] = isChecked;
  saveState();
  updateNationCards();
  renderSidePanels();
}

function collectIncome(tid) {
  if (!ownsMainCapital(tid)) {
    toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} ${t('toast.capital_locked_income', { flag: NATIONS[tid].flag, name: NATIONS[tid].name })}`, 'error');
    return;
  }
  if (state.turnPhases?.[tid]?.includes('p6')) {
    toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} ${t('toast.income_already_collected', { flag: NATIONS[tid].flag, name: NATIONS[tid].name })}`, 'error');
    return;
  }
  const ns       = state.nations[tid];
  const income   = calcIncome(tid);
  const bonus    = calcBonusIncome(tid);
  const warBonds = (ns.warBonds || 0);
  const loss     = (ns.convoyLoss || 0);
  const adjust   = (ns.manualAdjust || 0);
  const net      = income + bonus + warBonds - loss + adjust;

  // Flush any IPC captured from enemy capitals into treasury
  ns.treasury += (ns.capturedTreasury || 0);
  ns.capturedTreasury = 0;
  ns.treasury += net;
  ns.convoyLoss    = 0;
  ns.warBonds      = 0;
  ns.manualAdjust  = 0;

  // Mark oneTime objectives as claimed and uncheck them; keep recurring objectives checked
  const objs = NATIONAL_OBJECTIVES[tid] ?? [];
  if (!ns.objectives) ns.objectives = {};
  objs.forEach(o => {
    if (ns.objectives[o.id] === true) {
      if (o.oneTime) {
        if (!ns.objectivesClaimed) ns.objectivesClaimed = {};
        ns.objectivesClaimed[o.id] = true;
        ns.objectives[o.id] = false; // uncheck claimed oneTime objectives
      }
      // recurring objectives: keep as true (checked) for next round
    }
  });

  const input = document.getElementById(`treasury-${tid}`);
  if (input) { input.value = ns.treasury; }
  onTreasuryChange(tid, ns.treasury);
  const convoyInput = document.getElementById(`convoy-${tid}`);
  if (convoyInput) convoyInput.textContent = 0;
  const wbInput = document.getElementById(`warbonds-${tid}`);
  if (wbInput) wbInput.textContent = 0;
  const adjEl = document.getElementById(`manualadjust-${tid}`);
  if (adjEl) adjEl.textContent = 0;

  // Rebuild the objectives section to reflect cleared checkboxes
  const objSection = document.querySelector(`#ncb-${tid} .nc-section:has(input[data-obj])`);
  if (objSection) {
    const inner = objSection.querySelector('.objectives-inner');
    if (inner) inner.innerHTML = buildObjectivesHTML(tid);
  } else {
    // fallback: rebuild entire card on next render
    const ng = document.getElementById('nationsGrid');
    if (ng) ng.dataset.built = '';
    if (activeTab === 'nations') renderNations();
  }

  // Mark phase 6 as completed
  if (!state.turnPhases)      state.turnPhases = {};
  if (!state.turnPhases[tid]) state.turnPhases[tid] = [];
  if (!state.turnPhases[tid].includes('p6')) state.turnPhases[tid].push('p6');

  saveState();
  renderPhaseTracker();
  renderTurnStrip();
  renderSidePanels();
  updatePurchaseDisplay(tid);
  const adjStr = adjust !== 0 ? t('toast.income_adj', { sign: adjust > 0 ? '+' : '', adj: adjust }) : '';
  const details = (bonus > 0 || adjust !== 0) ? t('toast.income_details', { income, bonus, bonds: warBonds, loss, adj: adjStr }) : '';
  updateIncomeDisplay(tid);
  updateIncomeAdjVisibility(tid);
  updateNationPhaseTracker(tid);
  updateNationCardDoneState(tid);
  toast(t('toast.income_done', { flag: NATIONS[tid].flag, name: NATIONS[tid].name, net, details, treasury: ns.treasury }), 'success');
  checkAllNationsDone();

  // ── Auto-advance: collapse current card, next turn, open next card ──
  const currentBody = document.getElementById(`ncb-${tid}`);
  if (currentBody) {
    currentBody.classList.remove('open');
    const icon = document.querySelector(`#nc-${tid} .nc-toggle-icon`);
    if (icon) icon.style.transform = '';
  }

  const nextIndex = state.turnIndex + 1;
  if (nextIndex < TURN_ORDER.length) {
    // Still within this round — advance turn and open next nation
    state.turnIndex = nextIndex;
    saveState();
    renderAll();
    const nextTid = TURN_ORDER[nextIndex];
    // Small delay so renderAll() finishes before we scroll/open
    setTimeout(() => {
      const nextBody = document.getElementById(`ncb-${nextTid}`);
      if (nextBody) {
        nextBody.classList.add('open');
        const nextIcon = document.querySelector(`#nc-${nextTid} .nc-toggle-icon`);
        if (nextIcon) nextIcon.style.transform = 'rotate(180deg)';
      }
      const nextCard = document.getElementById(`nc-${nextTid}`);
      if (nextCard) nextCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  } else {
    // Last nation in round — just end the round normally
    state.turnIndex = nextIndex;
    saveState();
    renderAll();
  }
}

// ── Territories tab ───────────────────────────────────────────
let terSearch = '';
let terFilterContinent = '';
let terFilterNation = '';
let terFilterNation2 = '';
let continentCollapsed = {};

function goToTerritories(tid) {
  const sel = document.getElementById('terFilterNation');
  if (sel) sel.value = tid;
  const sel2 = document.getElementById('terFilterNation2');
  if (sel2) sel2.value = '';
  terFilterNation = tid;
  switchTab('territories');
}

function renderTerritories() {
  const container = document.getElementById('territoryGroups');
  const search    = (document.getElementById('terSearch')?.value ?? '').toLowerCase();
  const filterC   = document.getElementById('terFilterContinent')?.value ?? '';
  const filterN1  = document.getElementById('terFilterNation')?.value ?? '';
  const filterN2  = document.getElementById('terFilterNation2')?.value ?? '';

  // ── Nation-grouped mode (1 or 2 nations selected) ──────────
  if (filterN1 || filterN2) {
    const nationsToShow = [...new Set([filterN1, filterN2].filter(Boolean))];
    const allFiltered = TERRITORIES.filter(t => {
      if (search && !t.name.toLowerCase().includes(search)) return false;
      if (filterC && t.continent !== filterC) return false;
      return nationsToShow.includes(getController(t.id));
    });

    let html = '';
    for (const nid of nationsToShow) {
      const nat    = NATIONS[nid] ?? NATIONS.neutral;
      const rows   = allFiltered.filter(t => getController(t.id) === nid);
      const ipcSum = rows.reduce((s, t) => s + t.ipc, 0);
      const other  = nationsToShow.length === 2 ? nationsToShow.find(n => n !== nid) : '';
      const otherN = other ? (NATIONS[other] ?? null) : null;

      const transferAllBtn = otherN
        ? `<button class="btn btn-ghost btn-sm ng-transfer-all" onclick="confirmTransferAll('${nid}','${other}')" title="${t('ter.transfer_all_tip', { name: otherN.name })}">
            ${t('ter.transfer_all_btn')} ${nationIconHTML(otherN, 'nation-icon--xs')} ${otherN.shortName}
          </button>`
        : '';

      const thAction = otherN
        ? `→ ${nationIconHTML(otherN, 'nation-icon--xs')} ${otherN.name}`
        : t('ter.change_owner');

      html += `<div class="nation-group" style="--ng-accent:${nat.accent ?? '#9ca3af'}">
        <div class="nation-group-header">
          <span class="ng-flag">${nationIconHTML(nat, 'nation-icon--sm')}</span>
          <span class="ng-name">${nat.name}</span>
          <span class="ng-stats">${t('ter.ng_stats', {n: rows.length, ipc: ipcSum})}</span>
          ${transferAllBtn}
        </div>
        ${
          rows.length
            ? `<table class="territory-table">
                <colgroup>
                  <col class="col-name">
                  <col class="col-ipc">
                  <col class="col-owner">
                  <col class="col-action">
                  <col class="col-origin">
                </colgroup>
                <thead><tr>
                  <th>${t('ter.col_territory')}</th>
                  <th style="text-align:center">${t('ter.col_ipc')}</th>
                  <th>${t('ter.col_controlled_by')}</th>
                  <th>${thAction}</th>
                  <th>${t('ter.col_captured_from')}</th>
                </tr></thead>
                <tbody>${rows.map(terr => buildTerritoryRowNation(terr, other)).join('')}</tbody>
              </table>`
            : `<div class="ng-empty">${t('ter.no_results')}</div>`
        }
      </div>`;
    }

    container.innerHTML = html || `<div class="empty-state"><div class="es-icon">🔍</div>${t('ter.no_results')}</div>`;
    updateTerritoryCountBar(allFiltered);
    return;
  }

  // ── Default: continent-grouped view ────────────────────────
  let filtered = TERRITORIES.filter(t => {
    if (search && !t.name.toLowerCase().includes(search)) return false;
    if (filterC && t.continent !== filterC) return false;
    return true;
  });

  // Group by continent
  const continents = [...new Set(TERRITORIES.map(t => t.continent))];
  let html = '';
  for (const cont of continents) {
    const rows = filtered.filter(t => t.continent === cont);
    if (!rows.length) continue;
    const collapsed = continentCollapsed[cont] ? 'collapsed' : '';
    html += `<div class="continent-group" data-continent="${cont}">
      <div class="continent-header ${collapsed}" onclick="toggleContinent('${cont}')">
        <span class="cg-toggle">▼</span>
        <span>${cont}</span>
        <span style="margin-left:.4rem;color:var(--text-muted);font-weight:400">(${rows.length})</span>
      </div>
      <div class="continent-body" id="cg-${sanitize(cont)}" ${collapsed ? 'style="display:none"' : ''}>
        <table class="territory-table">
          <colgroup>
            <col class="col-name">
            <col class="col-ipc">
            <col class="col-owner">
            <col class="col-action">
            <col class="col-origin">
          </colgroup>
          <thead><tr>
            <th>${t('ter.col_territory')}</th>
            <th style="text-align:center">${t('ter.col_ipc')}</th>
            <th>${t('ter.col_controlled_by')}</th>
            <th>${t('ter.change_owner')}</th>
            <th>${t('ter.col_captured_from')}</th>
          </tr></thead>
          <tbody>
            ${rows.map(t => buildTerritoryRow(t)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  container.innerHTML = html || `<div class="empty-state"><div class="es-icon">🔍</div>${t('ter.no_results')}</div>`;
  updateTerritoryCountBar(filtered);
}

function getNeutralTypeBadge(terr, ctrl) {
  if (ctrl !== 'neutral' || !terr.neutralType || terr.neutralType === 'neutral') return '';
  const labels = { strict: t('ter.neutral.strict'), pro_allied: t('ter.neutral.pro_allied'), pro_axis: t('ter.neutral.pro_axis'), mongolia: t('ter.neutral.mongolia') };
  const label = labels[terr.neutralType] ?? terr.neutralType;
  return `<span style="font-size:.65rem;color:var(--text-muted);margin-left:.25rem;font-style:italic">(${label})</span>`;
}

function buildFacilityBadges(terrId) {
  const fac = getFacility(terrId);
  const dmg = getFacilityDamage(terrId);
  if (!fac.ic && !fac.airBase && !fac.navalBase) return '';
  const parts = [];
  if (fac.ic) {
    const icon = fac.ic === 'major' ? '\uD83C\uDFED' : '\uD83D\uDD27';
    const d = dmg.ic || 0;
    parts.push(`<span class="fac-badge${d > 0 ? ' fac-badge--dmg' : ''}" title="${fac.ic === 'major' ? t('fac.badge.major') : t('fac.badge.minor')}${d > 0 ? ' \u2014 ' + t('fac.badge.damage', { n: d }) : ''}">${icon}${d > 0 ? '<sup>' + d + '</sup>' : ''}</span>`);
  }
  if (fac.airBase) {
    const d = dmg.airBase || 0;
    const inop = d >= 6;
    parts.push(`<span class="fac-badge${d > 0 ? ' fac-badge--dmg' : ''}${inop ? ' fac-badge--inop' : ''}" title="${t('fac.badge.airbase')}${d > 0 ? ' \u2014 ' + t('fac.badge.damage', { n: d + '/6' }) : ''}${inop ? t('fac.badge.inop') : ''}">\u2708\uFE0F${d > 0 ? '<sup>' + d + '</sup>' : ''}</span>`);
  }
  if (fac.navalBase) {
    const d = dmg.navalBase || 0;
    const inop = d >= 6;
    parts.push(`<span class="fac-badge${d > 0 ? ' fac-badge--dmg' : ''}${inop ? ' fac-badge--inop' : ''}" title="${t('fac.navalbase')}${d > 0 ? ' \u2014 ' + t('fac.badge.damage', { n: d + '/6' }) : ''}${inop ? t('fac.badge.inop') : ''}">\u2693${d > 0 ? '<sup>' + d + '</sup>' : ''}</span>`);
  }
  return ' ' + parts.join('');
}

function buildTerritoryRow(terr) {
  const ctrl    = getController(terr.id);
  const nat     = NATIONS[ctrl] ?? NATIONS.neutral;
  const capital = terr.isCapital ? 'is-capital' : '';
  const ipcCls  = terr.ipc === 0 ? 'zero' : '';
  const origNat = (terr.startController && terr.startController !== ctrl)
    ? (NATIONS[terr.startController] ?? null) : null;

  return `<tr>
    <td class="t-name ${capital}">${terr.name}${terr.isMainCapital ? ' \uD83C\uDFDB\uFE0F' : ''}${getNeutralTypeBadge(terr, ctrl)}${buildFacilityBadges(terr.id)}</td>
    <td class="t-ipc ${ipcCls}">${terr.ipc || '—'}</td>
    <td><span class="owner-badge" data-nation="${ctrl}">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.shortName}</span></td>
    <td><button class="owner-change-btn" onclick="openOwnerPicker('${terr.id}')">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.shortName} <span class="ocb-arrow">▼</span></button></td>
    <td>${origNat ? `<span class="owner-badge conquered-from" data-nation="${terr.startController}">${nationIconHTML(origNat, 'nation-icon--xs')} ${origNat.shortName}</span>` : ''}</td>
  </tr>`;
}

function buildTerritoryRowNation(terr, quickTransferTo) {
  const ctrl    = getController(terr.id);
  const nat     = NATIONS[ctrl] ?? NATIONS.neutral;
  const capital = terr.isCapital ? 'is-capital' : '';
  const ipcCls  = terr.ipc === 0 ? 'zero' : '';
  const toNat   = quickTransferTo ? (NATIONS[quickTransferTo] ?? null) : null;
  const origNat = (terr.startController && terr.startController !== ctrl)
    ? (NATIONS[terr.startController] ?? null) : null;

  const actionCell = toNat
    ? `<div class="quick-transfer-cell">
        <button class="quick-transfer-btn" onclick="onOwnerChange('${terr.id}','${quickTransferTo}')" title="${t('ter.transfer_to', { name: toNat.name })}">
          ${nationIconHTML(toNat, 'nation-icon--xs')} ${toNat.shortName}
        </button>
        <button class="owner-change-btn-sm" onclick="openOwnerPicker('${terr.id}')" title="${t('ter.pick_owner')}">⋯</button>
      </div>`
    : `<button class="owner-change-btn" onclick="openOwnerPicker('${terr.id}')">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.shortName} <span class="ocb-arrow">▼</span></button>`;

  return `<tr>
    <td class="t-name ${capital}">${terr.name}${terr.isMainCapital ? ' 🏛️' : ''}${getNeutralTypeBadge(terr, ctrl)}</td>
    <td class="t-ipc ${ipcCls}">${terr.ipc || '—'}</td>
    <td><span class="owner-badge" data-nation="${ctrl}">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.shortName}</span></td>
    <td>${actionCell}</td>
    <td>${origNat ? `<span class="owner-badge conquered-from" data-nation="${terr.startController}">${nationIconHTML(origNat, 'nation-icon--xs')} ${origNat.shortName}</span>` : ''}</td>
  </tr>`;
}

function confirmTransferAll(fromNation, toNation) {
  const territories = TERRITORIES.filter(t => getController(t.id) === fromNation);
  const fromN = NATIONS[fromNation];
  const toN   = NATIONS[toNation];
  if (!territories.length) {
    toast(t('ter.no_territories_err', { name: fromN?.name ?? fromNation }), 'error');
    return;
  }
  if (!confirm(t('ter.transfer_all_confirm', { count: territories.length, fromShort: fromN?.shortName, fromName: fromN?.name, toShort: toN?.shortName, toName: toN?.name }))) return;
  territories.forEach(terr => setController(terr.id, toNation));
  saveState();
  renderTerritories();
  updateNationCards();
  if (activeTab === 'overview') renderOverview();
  toast(t('ter.transferred_done', { count: territories.length, toShort: toN?.shortName, toName: toN?.name }), 'success');
}

function updateTerritoryCountBar(filtered) {
  const axisIds   = Object.keys(NATIONS).filter(n => NATIONS[n].side === 'axis');
  const allieIds  = Object.keys(NATIONS).filter(n => NATIONS[n].side === 'allies');
  const axisCount = filtered.filter(t => axisIds.includes(getController(t.id))).length;
  const allyCount = filtered.filter(t => allieIds.includes(getController(t.id))).length;
  const neutCount = filtered.length - axisCount - allyCount;
  const ipcAxis   = filtered.filter(t => axisIds.includes(getController(t.id))).reduce((s,t) => s+t.ipc, 0);
  const ipcAlly   = filtered.filter(t => allieIds.includes(getController(t.id))).reduce((s,t) => s+t.ipc, 0);

  document.getElementById('tcbTotal').textContent  = filtered.length;
  document.getElementById('tcbAxis').textContent   = `${axisCount} (${ipcAxis} IPC)`;
  document.getElementById('tcbAllies').textContent = `${allyCount} (${ipcAlly} IPC)`;
  document.getElementById('tcbNeutral').textContent = neutCount;
}

function onOwnerChange(tid, nationId) {
  // ── Capital capture: transfer treasury ──────────────────────
  const capTerr = TERRITORIES.find(t => t.id === tid);
  if (capTerr && capTerr.isMainCapital) {
    const prevController = getController(tid);
    const originalOwner  = capTerr.startController;
    // Only transfer when the ORIGINAL owner is losing their capital to an enemy
    if (prevController === originalOwner && nationId !== originalOwner) {
      const stolen = state.nations[originalOwner]?.treasury ?? 0;
      if (stolen > 0) {
        if (!state.nations[nationId]) state.nations[nationId] = {};
        // Add to capturedTreasury — carries over to next purchase phase, not current spendable
        state.nations[nationId].capturedTreasury = (state.nations[nationId].capturedTreasury || 0) + stolen;
        state.nations[originalOwner].treasury = 0;
        const capFlag  = NATIONS[nationId]?.flag ?? '';
        const capName  = NATIONS[nationId]?.name ?? nationId;
        const ownFlag  = NATIONS[originalOwner]?.flag ?? '';
        const ownName  = NATIONS[originalOwner]?.name ?? originalOwner;
        toast(`${capFlag} ${capName} tok ${stolen} IPC fra ${ownFlag} ${ownName}s skattkiste!`, 'error');
      }
    }
  }
  // ────────────────────────────────────────────────────────────
  // Log territory change for history
  const prevCtrl = getController(tid);
  if (prevCtrl !== nationId) {
    if (!state.territoryChanges) state.territoryChanges = [];
    const terrName = capTerr ? capTerr.name : TERRITORIES.find(t => t.id === tid)?.name ?? tid;
    state.territoryChanges.push({ territoryId: tid, name: terrName, from: prevCtrl, to: nationId });
  }
  setController(tid, nationId);
  // Auto-evaluate objectives for all nations (territory ownership changed)
  TURN_ORDER.forEach(nid => evalObjectivesForNation(nid));
  saveState();
  // Re-render just the badge in the same row (find via select)
  renderTerritories(); // simplest: re-render the whole table
  updateNationCards();  // update collect-button & income for affected nations
  if (activeTab === 'overview') renderOverview();
}

// ── Owner Picker Modal ────────────────────────────────────────
let _ownerPickerTid = null;

function openOwnerPicker(tid) {
  _ownerPickerTid = tid;
  const terr = TERRITORIES.find(t => t.id === tid);
  const ctrl = getController(tid);

  document.getElementById('ownerPickerTitle').textContent = t('ter.owner_picker_title', { name: terr?.name ?? tid });

  const grid = document.getElementById('ownerPickerGrid');
  grid.innerHTML = Object.keys(NATIONS).map(nid => {
    const n      = NATIONS[nid];
    const active = nid === ctrl ? ' active' : '';
    return `<button class="owner-picker-btn${active}" onclick="selectOwnerFromPicker('${nid}')">
      <span class="opb-flag">${nationIconHTML(n, 'nation-icon--md')}</span>
      <span class="opb-name">${n.shortName}</span>
    </button>`;
  }).join('');

  document.getElementById('ownerPickerModal').classList.remove('hidden');
}

function closeOwnerPicker() {
  _ownerPickerTid = null;
  document.getElementById('ownerPickerModal').classList.add('hidden');
}

function selectOwnerFromPicker(nationId) {
  if (!_ownerPickerTid) return;
  const tid = _ownerPickerTid;
  closeOwnerPicker();
  onOwnerChange(tid, nationId);
}

function toggleContinent(cont) {
  continentCollapsed[cont] = !continentCollapsed[cont];
  const body = document.getElementById(`cg-${sanitize(cont)}`);
  const hdr  = document.querySelector(`.continent-header[onclick*="${cont}"]`);
  if (body) body.style.display = continentCollapsed[cont] ? 'none' : '';
  if (hdr)  hdr.classList.toggle('collapsed', !!continentCollapsed[cont]);
}

// ── Victory Cities (embedded in overview) ────────────────────
function renderVictoryCities() {
  const container = document.getElementById('vcGrid');
  if (!container) return;

  // Split victory cities by which side currently controls them
  const axisCities = VICTORY_CITIES.filter(t => {
    const ctrl = getController(t.id);
    return NATIONS[ctrl] && NATIONS[ctrl].side === 'axis';
  });
  const alliesCities = VICTORY_CITIES.filter(t => {
    const ctrl = getController(t.id);
    return NATIONS[ctrl] && NATIONS[ctrl].side === 'allies';
  });
  const neutralCities = VICTORY_CITIES.filter(t => {
    const ctrl = getController(t.id);
    return !NATIONS[ctrl] || NATIONS[ctrl].side === 'neutral';
  });

  const renderCard = t => {
    const ctrl = getController(t.id);
    const nat  = NATIONS[ctrl] ?? NATIONS.neutral;
    const isMain = t.isMainCapital;
    return `<div class="vc-card ${isMain ? 'main-capital' : ''}">
      <span class="vc-icon">${isMain ? '🏛️' : '⭐'}</span>
      <div class="vc-card-info">
        <div class="vc-city-name">${t.name}</div>
        <span class="owner-badge" data-nation="${ctrl}">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.name}</span>
      </div>
    </div>`;
  };

  const cols = [];
  cols.push(`
    <div class="vc-col vc-axis">
      <div class="vc-col-header">${t('vc.axis_header', { n: axisCities.length })}</div>
      <div class="vc-list">${axisCities.map(renderCard).join('')}${axisCities.length===0?`<div class="empty-state">${t('vc.axis_none')}</div>`:''}</div>
    </div>
  `);

  if (neutralCities.length > 0) {
    cols.push(`
      <div class="vc-col vc-neutral">
        <div class="vc-col-header">${t('vc.neutral_header', { n: neutralCities.length })}</div>
        <div class="vc-list">${neutralCities.map(renderCard).join('')}</div>
      </div>
    `);
  }

  cols.push(`
    <div class="vc-col vc-allies">
      <div class="vc-col-header">${t('vc.allies_header', { n: alliesCities.length })}</div>
      <div class="vc-list">${alliesCities.map(renderCard).join('')}${alliesCities.length===0?`<div class="empty-state">${t('vc.allies_none')}</div>`:''}</div>
    </div>
  `);

  container.innerHTML = cols.join('');
}

// ── History tab ───────────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById('historyList');
  if (!state.history.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">📜</div>${t('hist.empty').replace('\n', '<br>')}</div>`;
    return;
  }
  container.innerHTML = [...state.history].reverse().map((h, i) => {
    const id = `hist-${h.round}`;
    const rows = Object.entries(h.nations).map(([tid, nd]) => {
      const nat   = NATIONS[tid];
      const delta = nd.collected ?? 0;
      const cls   = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
      const purchases = nd.purchases ?? [];
      const purchaseHtml = purchases.length
        ? `<div class="hist-purchases">${purchases.map(p =>
            `<span class="hist-purchase-entry">🛒 ${p.items.map(it => `${it.qty}×${it.name}`).join(', ')} — ${p.totalCost} IPC</span>`
          ).join('')}</div>`
        : '';
      return `<div class="history-nation-row">
        <span>${nationIconHTML(nat, 'nation-icon--xs')} ${nat.name}</span>
        <span style="color:var(--text-dim);flex:1;margin-left:.5rem">${t('hist.income_label')}</span>
        <span class="history-delta ${cls}">${delta >= 0 ? '+' : ''}${delta} IPC</span>
        <span style="color:var(--text-muted);margin-left:.5rem;font-size:.75rem">→ ${nd.endTreasury} IPC</span>
        ${purchaseHtml}
      </div>`;
    }).join('');

    // Territory changes this round
    const terrChanges = h.territoryChanges ?? [];
    const terrHtml = terrChanges.length ? `
      <div class="hist-terr-section">
        <div class="hist-terr-title">${t('hist.terr_section')}</div>
        ${terrChanges.map(tc => {
          const fromNat  = NATIONS[tc.from];
          const toNat    = NATIONS[tc.to];
          const fromFlag = fromNat ? nationIconHTML(fromNat, 'nation-icon--xs') : '⚪';
          const toFlag   = toNat   ? nationIconHTML(toNat,   'nation-icon--xs') : '⚪';
          const fromName = fromNat ? fromNat.shortName : tc.from;
          const toName   = toNat   ? toNat.shortName   : tc.to;
          const isCapture = toNat && fromNat && toNat.side !== fromNat.side;
          return `<div class="hist-terr-row">
            <span class="hist-terr-name">${tc.name}</span>
            <span class="hist-terr-arrow">${fromFlag} ${fromName} ${isCapture ? '⚔️' : '→'} ${toFlag} ${toName}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    const bombingEvs = h.bombingEvents ?? [];
    const bombHtml = bombingEvs.length ? `
      <div class="hist-bombing-section">
        <div class="hist-section-title">💣 ${t('hist.bombing_section')}</div>
        ${bombingEvs.map(b => {
          const atkNat = NATIONS[b.attackerId];
          const atkIcon = atkNat ? nationIconHTML(atkNat, 'nation-icon--xs') : '✈️';
          return `<div class="hist-bombing-row">
            <span class="hist-bombing-atk">${atkIcon} ${atkNat?.shortName ?? b.attackerId}</span>
            <span class="hist-bombing-sep">→</span>
            <span class="hist-bombing-detail">${escHtml(b.terrName)}</span>
            <span class="hist-bombing-fac">${escHtml(b.facLabel)}</span>
            <span class="hist-bombing-dmg">${b.damage} ${t('hist.bombing_dmg')}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    return `<div class="history-entry">
      <div class="history-entry-header" onclick="toggleHistory('${id}')">
        <span class="history-round-badge">${t('hist.round_badge', { n: h.round })}</span>
        <span style="color:var(--text-dim);font-size:.82rem">
          Axis ${h.axisVC} VC · Allies ${h.alliesVC} VC
          ${(h.territoryChanges ?? []).length ? `· ${h.territoryChanges.length} terr.` : ''}
          ${bombingEvs.length ? `· ${bombingEvs.length} 💣` : ''}
        </span>
        <span class="history-date">${h.date}</span>
      </div>
      <div class="history-entry-body" id="${id}">${rows}${terrHtml}${bombHtml}</div>
    </div>`;
  }).join('');
}

function toggleHistory(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── Round management ──────────────────────────────────────────
function checkAllNationsDone() {
  const allDone = TURN_ORDER.every(tid => {
    const completed = state.turnPhases?.[tid] ?? [];
    const visible   = getVisiblePhases(tid);
    return visible.length > 0 && visible.every(p => completed.includes(p.id));
  });
  if (allDone) {
    endRound();
    saveState();
    renderAll();
  }
}

function nextTurn() {
  state.turnIndex++;
  if (state.turnIndex >= TURN_ORDER.length) {
    endRound();
  }
  saveState();
  renderAll();
}

function endRound() {
  // Snapshot history
  const snapshot = {
    round:    state.round,
    date:     new Date().toLocaleString('no-NO'),
    axisVC:   getAxisVC(),
    alliesVC: getAlliesVC(),
    nations:  {},
  };
  TURN_ORDER.forEach(tid => {
    const ns = state.nations[tid];
    snapshot.nations[tid] = {
      endTreasury: ns.treasury,
      collected:   calcIncome(tid),
      purchases:   (state.purchaseLogs || []).filter(l => l.nationId === tid && l.round === state.round),
    };
  });
  snapshot.territoryChanges = state.territoryChanges ? [...state.territoryChanges] : [];
  state.territoryChanges = [];
  snapshot.bombingEvents = state.bombingEvents ? [...state.bombingEvents] : [];
  state.bombingEvents = [];
  state.history.push(snapshot);

  // Advance round
  state.round++;
  state.turnIndex = 0;

  // Reset per-round fields
  TURN_ORDER.forEach(tid => {
    state.nations[tid].convoyLoss = 0;
    state.nations[tid].warBonds   = 0;
  });

  // Reset phase tracking for new round
  state.turnPhases = {};

  // Force nation cards to fully rebuild so phase checkboxes are cleared
  const ng = document.getElementById('nationsGrid');
  if (ng) ng.dataset.built = '';

  toast(t('toast.round_start', { n: state.round }), 'success');
}

function prevTurn() {
  if (state.turnIndex > 0) {
    state.turnIndex--;
    saveState();
    renderAll();
  }
}

// ── New Game ──────────────────────────────────────────────────
function confirmNewGame() {
  document.getElementById('newGameModal').classList.remove('hidden');
}
function closeNewGameModal() {
  document.getElementById('newGameModal').classList.add('hidden');
}
function startNewGame() {
  state = defaultState();
  saveState();
  // Reset built flag so nation cards are rebuilt
  const ng = document.getElementById('nationsGrid');
  if (ng) ng.dataset.built = '';
  closeNewGameModal();
  renderAll();
  toast(t('toast.new_game'), 'success');
}

// ── Utilities ─────────────────────────────────────────────────
function sanitize(s) {
  return s.replace(/[^a-zA-Z0-9_]/g, '_');
}

function ownerBadge(nationId) {
  const nat = NATIONS[nationId] ?? NATIONS.neutral;
  return `<span class="owner-badge" data-nation="${nationId}">${nationIconHTML(nat, 'nation-icon--xs')} ${nat.shortName}</span>`;
}

// ── Battle Board ────────────────────────────────────────────────────────────
const BATTLE_UNITS = [
  { id:'infantry',   nameKey:'unit.infantry',    icon:'🪖', type:'land', attack:1, defense:2 },
  { id:'mech_inf',   nameKey:'unit.mech_inf',    icon:'🚛', type:'land', attack:1, defense:2 },
  { id:'artillery',  nameKey:'unit.artillery',   icon:'💣', type:'land', attack:2, defense:2 },
  { id:'tank',       nameKey:'unit.tank',        icon:'🏎️', type:'land', attack:3, defense:3 },
  { id:'aaa',        nameKey:'unit.aaa',         icon:'🔫', type:'land', attack:0, defense:0, aaOnly:true },
  { id:'fighter',    nameKey:'unit.fighter',     icon:'✈️', type:'air',  attack:3, defense:4 },
  { id:'tac_bomber', nameKey:'unit.tactical_bomb',icon:'💥', type:'air',  attack:3, defense:3 },
  { id:'str_bomber', nameKey:'unit.strat_bomb',  icon:'🛩️', type:'air',  attack:4, defense:1 },
  { id:'submarine',  nameKey:'unit.submarine',   icon:'🌊', type:'sea',  attack:2, defense:1 },
  { id:'destroyer',  nameKey:'unit.destroyer',   icon:'⚓', type:'sea',  attack:2, defense:2 },
  { id:'cruiser',    nameKey:'unit.cruiser',     icon:'🚢', type:'sea',  attack:3, defense:3 },
  { id:'carrier',    nameKey:'unit.carrier',     icon:'🛳️', type:'sea',  attack:0, defense:2 },
  { id:'battleship', nameKey:'unit.battleship',  icon:'⛵', type:'sea',  attack:4, defense:4 },
  { id:'transport',  nameKey:'unit.transport',   icon:'🚤', type:'sea',  attack:0, defense:0 },
];

const BATTLE_GROUPS = [
  { labelKey:'battle.group.land', filter: u => u.type === 'land' },
  { labelKey:'battle.group.air',  filter: u => u.type === 'air'  },
  { labelKey:'battle.group.sea',  filter: u => u.type === 'sea'  },
];

let battleUnits = { atk: {}, def: {} };

function hitColor(val) {
  if (val <= 0) return '#4b5563';
  if (val === 1) return '#9ca3af';
  if (val === 2) return '#d97706';
  if (val === 3) return '#ea580c';
  return '#dc2626';
}

function getBattleNation(side) {
  const sel = document.getElementById(`battle-nation-${side}`);
  return sel ? sel.value : '';
}

function hasAdvArtillery() {
  // Check if attacking nation has Advanced Artillery tech
  const tid = getBattleNation('atk');
  return tid ? (state.nations[tid]?.technologies?.includes('adv_artillery') ?? false) : false;
}

function populateBattleNationSelects() {
  ['atk','def'].forEach(side => {
    const sel = document.getElementById(`battle-nation-${side}`);
    if (!sel || sel.dataset.built === '1') return;
    sel.innerHTML = `<option value="">${t('battle.select_ph')}</option>`;
    TURN_ORDER.forEach(tid => {
      const n = NATIONS[tid];
      const opt = document.createElement('option');
      opt.value = tid;
      opt.textContent = `${n.shortName} ${n.name}`;
      sel.appendChild(opt);
    });
    sel.dataset.built = '1';
  });
}

function onBattleNationChange() {
  // Show/hide Advanced Artillery badge on attacker
  const advArt = hasAdvArtillery();
  const badge = document.getElementById('adv-art-badge');
  if (badge) badge.classList.toggle('hidden', !advArt);
  updateBattleSummary();
}

function renderBattle() {
  const atkEl = document.getElementById('atk-units');
  const defEl = document.getElementById('def-units');
  if (!atkEl || !defEl) return;
  populateBattleNationSelects();
  if (atkEl.dataset.built === '1') { updateBattleSummary(); return; }
  atkEl.innerHTML = buildBattleUnitRows('atk');
  defEl.innerHTML = buildBattleUnitRows('def');
  atkEl.dataset.built = '1';
  defEl.dataset.built = '1';
  updateBattleSummary();
}

function buildBattleUnitRows(side) {
  return BATTLE_GROUPS.map(g => {
    const rows = BATTLE_UNITS.filter(g.filter).map(u => {
      const val  = side === 'atk' ? u.attack : u.defense;
      const qty  = (battleUnits[side][u.id] || 0);
      const dot  = `<div class="bu-hit-dot" style="background:${hitColor(val)}"></div>`;
      const note = u.aaOnly ? 'AA' : (val === 0 ? '—' : `≤${val}`);
      const aaNote = u.aaOnly
        ? `<div style="font-size:.7rem;color:var(--text-muted)">${t('battle.unit.aa_note')}</div>`
        : '';
      return `<div class="bu-row">
        ${dot}
        <div><div class="bu-name">${u.icon} ${t(u.nameKey)}</div>${aaNote}</div>
        <div class="bu-val">${note}</div>
        <div class="bu-ctrl">
          <button class="bu-btn" onclick="changeBattleUnit('${side}','${u.id}',-1)">−</button>
          <span class="bu-count${qty === 0 ? ' zero' : ''}" id="bu-qty-${side}-${u.id}">${qty}</span>
          <button class="bu-btn" onclick="changeBattleUnit('${side}','${u.id}',+1)">+</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="bu-group-label">${t(g.labelKey)}</div>${rows}`;
  }).join('');
}

function changeBattleUnit(side, unitId, delta) {
  if (!battleUnits[side]) battleUnits[side] = {};
  battleUnits[side][unitId] = Math.max(0, (battleUnits[side][unitId] || 0) + delta);
  const qtyEl = document.getElementById(`bu-qty-${side}-${unitId}`);
  if (qtyEl) {
    qtyEl.textContent = battleUnits[side][unitId];
    qtyEl.className   = `bu-count${battleUnits[side][unitId] === 0 ? ' zero' : ''}`;
  }
  updateBattleSummary();
}

// Returns array of {label, val, qty} considering Artillery/Infantry pairing rules
function calcBattleDice(side) {
  const dice = [];

  if (side === 'atk') {
    const inf  = battleUnits.atk['infantry']  || 0;
    const art  = battleUnits.atk['artillery'] || 0;
    const mech = battleUnits.atk['mech_inf']  || 0;
    const advArt = hasAdvArtillery();

    // Pair infantry with artillery
    const infPaired   = Math.min(inf, art);
    const infUnpaired = inf - infPaired;
    const artRemaining = art - infPaired;

    // If Advanced Artillery: pair remaining artillery with mech infantry
    const mechPaired   = advArt ? Math.min(mech, artRemaining) : 0;
    const mechUnpaired = mech - mechPaired;

    if (infPaired > 0)   dice.push({ label:`Infanteri (paret m/artilleri)`, val:2, qty:infPaired });
    if (infUnpaired > 0) dice.push({ label:`Infanteri`,                      val:1, qty:infUnpaired });
    if (mechPaired > 0)  dice.push({ label:`Mek.Inf. (Adv.Art. boost)`,     val:2, qty:mechPaired });
    if (mechUnpaired > 0) dice.push({ label:`Mek. Infanteri`,                val:1, qty:mechUnpaired });
    if (art > 0)         dice.push({ label:`Artilleri`,                      val:2, qty:art });

    // All other units (not infantry/mech/artillery/aaa/transport)
    BATTLE_UNITS.forEach(u => {
      if (['infantry','mech_inf','artillery','aaa','transport'].includes(u.id)) return;
      const qty = (battleUnits.atk[u.id] || 0);
      if (qty <= 0 || u.attack <= 0) return;
      dice.push({ label: t(u.nameKey), val: u.attack, qty });
    });

  } else {
    // Defense — no pairing
    BATTLE_UNITS.forEach(u => {
      if (u.aaOnly || u.id === 'transport') return;
      const qty = (battleUnits.def[u.id] || 0);
      if (qty <= 0 || u.defense <= 0) return;
      dice.push({ label: t(u.nameKey), val: u.defense, qty });
    });
  }

  return dice;
}

function updateBattleSummary() {
  const atkDice     = calcBattleDice('atk');
  const defDice     = calcBattleDice('def');
  const atkTotal    = atkDice.reduce((s, d) => s + d.qty, 0);
  const defTotal    = defDice.reduce((s, d) => s + d.qty, 0);
  const atkExpected = atkDice.reduce((s, d) => s + d.qty * (d.val / 6), 0);
  const defExpected = defDice.reduce((s, d) => s + d.qty * (d.val / 6), 0);

  const atkDiceEl = document.getElementById('atk-total-dice');
  if (atkDiceEl) atkDiceEl.textContent = `${atkTotal} ${atkTotal === 1 ? t('battle.dice_singular') : t('battle.dice_plural')}`;
  const defDiceEl = document.getElementById('def-total-dice');
  if (defDiceEl) defDiceEl.textContent = `${defTotal} ${defTotal === 1 ? t('battle.dice_singular') : t('battle.dice_plural')}`;
  const atkExpEl = document.getElementById('atk-expected');
  if (atkExpEl) atkExpEl.textContent = atkExpected.toFixed(1);
  const defExpEl = document.getElementById('def-expected');
  if (defExpEl) defExpEl.textContent = defExpected.toFixed(1);
  const applyBtn = document.getElementById('btnBattleApply');
  if (applyBtn) {
    const atkHitsEl = document.getElementById('battle-atk-hits');
    const defHitsEl = document.getElementById('battle-def-hits');
    const a = parseInt(atkHitsEl?.value) || 0;
    const d = parseInt(defHitsEl?.value) || 0;
    applyBtn.disabled = (a === 0 && d === 0);
  }

  // Pairing info panel
  const pairingEl = document.getElementById('battle-pairing-info');
  if (pairingEl) {
    const inf  = battleUnits.atk['infantry']  || 0;
    const art  = battleUnits.atk['artillery'] || 0;
    const mech = battleUnits.atk['mech_inf']  || 0;
    const advArt = hasAdvArtillery();

    if ((inf > 0 || mech > 0) && art > 0) {
      const infPaired    = Math.min(inf, art);
      const infUnpaired  = inf - infPaired;
      const artRem       = art - infPaired;
      const mechPaired   = advArt ? Math.min(mech, artRem) : 0;
      const mechUnpaired = mech - mechPaired;

      // Only show pairing box if something is actually being paired/boosted
      const showInfPairing  = inf > 0 && infPaired > 0;
      const showMechPairing = advArt && mech > 0 && artRem > 0;

      if (showInfPairing || showMechPairing) {
        let rows = '';
        if (showInfPairing) rows += `<div class="bp-row"><span class="bp-icon">🪖</span><span class="bp-text">${infPaired}× paret <b>≤2</b>${infUnpaired > 0 ? `, ${infUnpaired}× uparet <b>≤1</b>` : ''}</span></div>`;
        if (showMechPairing) rows += `<div class="bp-row"><span class="bp-icon">🚛</span><span class="bp-text">${mechPaired > 0 ? `${mechPaired}× boosted <b>≤2</b>` : ''}${mechPaired > 0 && mechUnpaired > 0 ? `, ${mechUnpaired}× normal <b>≤1</b>` : ''}</span></div>`;
        pairingEl.innerHTML = `<div class="battle-pairing-box"><div class="bp-title">🔗 Paring</div>${rows}</div>`;
      } else {
        pairingEl.innerHTML = '';
      }
    } else {
      pairingEl.innerHTML = '';
    }
  }
}

function onBattleHitsChange() {
  const applyBtn = document.getElementById('btnBattleApply');
  if (!applyBtn) return;
  const a = parseInt(document.getElementById('battle-atk-hits')?.value) || 0;
  const d = parseInt(document.getElementById('battle-def-hits')?.value) || 0;
  applyBtn.disabled = (a === 0 && d === 0);
}

function applyBattleHits() {
  const atkHits = Math.max(0, parseInt(document.getElementById('battle-atk-hits')?.value) || 0);
  const defHits = Math.max(0, parseInt(document.getElementById('battle-def-hits')?.value) || 0);
  const atkNat  = getBattleNation('atk');
  const defNat  = getBattleNation('def');
  const atkName = atkNat ? `${NATIONS[atkNat].flag} ${NATIONS[atkNat].name}` : t('battle.attacker_default');
  const defName = defNat ? `${NATIONS[defNat].flag} ${NATIONS[defNat].name}` : t('battle.defender_default');

  const atkLossKey = atkHits === 1 ? 'battle.result.loses' : 'battle.result.loses_pl';
  const defLossKey = defHits === 1 ? 'battle.result.loses' : 'battle.result.loses_pl';

  const el = document.getElementById('battle-result');
  if (!el) return;
  el.innerHTML = `
    <div class="br-round">
      <div class="br-round-title">${t('battle.result.round')}</div>
      <div class="br-hits-text">
        ⚔️ ${atkName}: <span class="hit-count">${atkHits}</span>
        ${atkHits > 0
          ? ` — ${defName} ${t(atkLossKey, { n: atkHits })}`
          : ` — ${t('battle.result.no_hits')}`}
      </div>
      <div class="br-hits-text">
        🛡️ ${defName}: <span class="hit-count def">${defHits}</span>
        ${defHits > 0
          ? ` — ${atkName} ${t(defLossKey, { n: defHits })}`
          : ` — ${t('battle.result.no_hits')}`}
      </div>
    </div>`;
}

function resetBattle() {
  battleUnits = { atk: {}, def: {} };
  ['atk-units','def-units'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.built = '';
  });
  const resultEl = document.getElementById('battle-result');
  if (resultEl) resultEl.innerHTML = '';
  const pairingEl = document.getElementById('battle-pairing-info');
  if (pairingEl) pairingEl.innerHTML = '';
  const atkHitsEl = document.getElementById('battle-atk-hits');
  if (atkHitsEl) atkHitsEl.value = '0';
  const defHitsEl = document.getElementById('battle-def-hits');
  if (defHitsEl) defHitsEl.value = '0';
  const applyBtn = document.getElementById('btnBattleApply');
  if (applyBtn) applyBtn.disabled = true;
  renderBattle();
}

// ── CSV Territory Loader ───────────────────────────────────────
// Controller display-name → internal nation ID
const _CSV_CTRL = {
  'Germany':      'germany',    'Italy':        'italy',
  'Japan':        'japan',      'Soviet Union': 'soviet',
  'USA':          'usa',        'UK (Europe)':  'uk_europe',
  'UK (Pacific)': 'uk_pacific', 'ANZAC':        'anzac',
  'China':        'china',      'France':       'france',
  'Neutral':      'neutral',    'Dutch':        'dutch',
  'Monglia':      'neutral',    'Pro Allies':   'neutral',
  'Canada':       'uk_europe',  'Russia':       'soviet',
};

// Continent name normalisation (CSV uses abbreviations/typos)
const _CSV_CONT = {
  'America':       'North America',
  'South Amerika': 'South America',
  'Russia':        'Europe',
};

function _parseTerritoriesCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;

  // Build header-name → column-index map (case-insensitive)
  const hdrs = lines[0].split(';').map(h => h.trim().toLowerCase());
  const H = Object.fromEntries(hdrs.map((h, i) => [h, i]));

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (!c[0]?.trim()) continue;
    if ((c[H['type']] ?? '').trim() === 'Sea Zone') continue;  // skip sea zones

    const rawCtrl    = (c[H['controller']] ?? '').trim();
    const rawCont    = (c[H['continent']]  ?? '').trim();
    const neutralArmy = parseInt(c[H['army (nutrales)']] ?? '');
    const ntRaw      = (c[H['neutraltype']] ?? '').trim();

    result.push({
      id:              c[H['territoryid']].trim(),
      name:            (c[H['name']] ?? '').trim(),
      ipc:             parseInt(c[H['ipc']]) || 0,
      continent:       _CSV_CONT[rawCont] ?? rawCont,
      startController: _CSV_CTRL[rawCtrl] ?? rawCtrl.toLowerCase().replace(/[\s()]+/g, '_'),
      isCapital:       (c[H['iscapital']] ?? '').trim().toLowerCase() === 'yes',
      isMainCapital:   (c[H['maincapital']] ?? '').trim().toLowerCase() === 'yes',
      neutralArmy:     neutralArmy > 0 ? neutralArmy : undefined,
      neutralType:     (ntRaw && ntRaw !== 'none') ? ntRaw : undefined,
    });
  }
  return result.length > 0 ? result : null;
}

async function _loadTerritoriesCSV() {
  const paths = ['./territories.csv', '../src/territories.csv'];
  for (const p of paths) {
    try {
      const res = await fetch(p);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = _parseTerritoriesCSV(text);
      if (parsed?.length) return parsed;
    } catch (_) {
      // Try next location
    }
  }
  console.warn('[FC] territories.csv not loaded from data/ or src/, using static data');
  return null;
}

// ── Internationalisation helpers ──────────────────────────────

/** Apply translations to all [data-i18n] and [data-i18n-attr-*] elements. */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-attr-ATTRNAME="key" → el.setAttribute(ATTRNAME, t(key))
  document.querySelectorAll('[data-i18n-attr-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nAttrPlaceholder));
  });
  document.querySelectorAll('[data-i18n-attr-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nAttrTitle));
  });
  // Sync lang toggle button label
  const langBtn = document.getElementById('btnLang');
  if (langBtn) langBtn.textContent = (state?.lang ?? 'no').toUpperCase();
  // Sync html lang attribute
  document.documentElement.lang = state?.lang ?? 'no';
}

function toggleLang() {
  state.lang = state.lang === 'no' ? 'en' : 'no';
  saveState();
  // Force full rebuild of dynamically-built panels that cache their DOM
  const ng = document.getElementById('nationsGrid');
  if (ng) ng.dataset.built = '';
  ['atk-units', 'def-units'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.built = '';
  });
  applyStaticI18n();
  renderAll();
  // Sync rules and setup iframes
  ['tab-rules', 'tab-setup'].forEach(tabId => {
    const iframe = document.querySelector(`#${tabId} iframe`);
    if (iframe?.contentWindow) {
      try { iframe.contentWindow.postMessage({ lang: state.lang }, '*'); } catch(_) {}
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load territories from CSV (canonical source); fall back to static data on error
  const csvTerrs = await _loadTerritoriesCSV();
  if (csvTerrs) {
    TERRITORIES   = csvTerrs;
    VICTORY_CITIES = TERRITORIES.filter(t => t.isCapital);
    console.log(`[FC] territories.csv loaded: ${TERRITORIES.length} territories, ${VICTORY_CITIES.length} VCs`);
  } else {
    console.log('[FC] Using static territory data (CSV unavailable)');
  }

  state = loadState() || defaultState();

  // Seed starting facilities from STARTING_FACILITIES if state.facilities is empty
  if (Object.keys(state.facilities).length === 0) {
    for (const [terrId, fac] of Object.entries(STARTING_FACILITIES)) {
      state.facilities[terrId] = { ic: fac.ic, airBase: fac.airBase, navalBase: fac.navalBase };
    }
  }
  // Ensure facilityDamage exists for each territory that has facilities
  for (const terrId of Object.keys(state.facilities)) {
    if (!state.facilityDamage[terrId]) {
      state.facilityDamage[terrId] = { ic: 0, airBase: 0, navalBase: 0 };
    }
  }
  saveState();

  // Keep header and tab-bar fixed; push main content down accordingly
  const syncHeaderHeight = () => {
    const hdr = document.querySelector('header');
    const tab = document.querySelector('.tab-bar');
    const hh = hdr?.offsetHeight ?? 60;
    const th = tab?.offsetHeight ?? 44;
    document.documentElement.style.setProperty('--header-h', hh + 'px');
    document.documentElement.style.setProperty('--top-h', (hh + th) + 'px');
  };
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Round controls
  document.getElementById('btnNextTurn').addEventListener('click', nextTurn);
  document.getElementById('btnPrevTurn').addEventListener('click', prevTurn);
  document.getElementById('btnCompletePhases')?.addEventListener('click', nextTurn);

  // New game
  document.getElementById('btnNewGame').addEventListener('click', () => {
    document.getElementById('actionMenu').removeAttribute('open');
    confirmNewGame();
  });
  document.getElementById('btnNewGameConfirm').addEventListener('click', startNewGame);
  document.getElementById('btnNewGameCancel').addEventListener('click', closeNewGameModal);

  // Server save/load
  document.getElementById('btnServerSave').addEventListener('click', () => {
    document.getElementById('actionMenu').removeAttribute('open');
    openServerSaveModal();
  });

  // Export / import
  document.getElementById('btnExport').addEventListener('click', () => {
    document.getElementById('actionMenu').removeAttribute('open');
    exportState();
  });
  document.getElementById('importFile').addEventListener('change', e => {
    document.getElementById('actionMenu').removeAttribute('open');
    if (e.target.files[0]) importState(e.target.files[0]);
    e.target.value = '';
  });

  // Close action menu on outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('actionMenu');
    if (menu && menu.open && !menu.contains(e.target)) menu.removeAttribute('open');
  });

  // Territory search / filter
  ['terSearch','terFilterContinent','terFilterNation','terFilterNation2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { if (activeTab === 'territories') renderTerritories(); });
    if (el) el.addEventListener('change', () => { if (activeTab === 'territories') renderTerritories(); });
  });

  // Initial render
  renderAll();
  switchTab('overview');
  applyStaticI18n();
  // Re-measure after render (turn pill text can change header height)
  requestAnimationFrame(syncHeaderHeight);
});
