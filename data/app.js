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
let purchaseCart = {};  // { [nationId]: { [unitId]: qty } } — per-session cart, not persisted
let repairTokens = {};  // { [nationId]: number } — damage points to repair (1 IPC each)
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
    nations,
    territories: {},
    history:    [],
    turnPhases:    {},   // { [nationId]: [phaseId, ...] }  — phases completed this round
    purchaseLogs: [],   // [ { round, nationId, items, totalCost, date } ]
    territoryChanges: [], // [ { territoryId, name, from, to } ] — logged during round
  };
}

function getController(territoryId) {
  return state.territories[territoryId] ?? TERRITORIES.find(t => t.id === territoryId)?.startController ?? 'neutral';
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
  // Round 1: starting treasury is for phase-1 spending this turn, not carry-over
  const carryover = state.round === 1 ? 0 : ns.treasury;
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
        if (!loaded.turnPhases)   loaded.turnPhases   = {};
        if (!loaded.purchaseLogs) loaded.purchaseLogs = [];
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
  toast('Spillstatus eksportert! 💾', 'success');
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const loaded = JSON.parse(e.target.result);
      if (loaded.version === 1) {
        // Run the same migration as loadState so all fields are present
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
          if (!loaded.turnPhases)  loaded.turnPhases  = {};
          if (!loaded.purchaseLogs) loaded.purchaseLogs = [];
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
        toast('Spillstatus importert! ✅', 'success');
      } else {
        toast('Ugyldig filformat.', 'error');
      }
    } catch { toast('Feil ved lesing av fil.', 'error'); }
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
      list.innerHTML = '<div class="ssave-empty">Ingen lagrede spill ennå.</div>';
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
            <button class="btn btn-success btn-sm" onclick="loadFromServer('${safeName}')">📂 Last inn</button>
            <button class="btn btn-danger btn-sm"  onclick="deleteFromServer('${safeName}', this)">🗑️</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="ssave-empty" style="color:var(--red)">Feil: ${e.message}. Er serveren oppe?</div>`;
  }
}

async function saveToServer() {
  const name = document.getElementById('ssaveName').value.trim();
  if (!name) { toast('Skriv inn et lagrenavn.', 'error'); return; }
  if (!/^[\w\- ]{1,64}$/.test(name)) {
    toast('Navn kan bare inneholde bokstaver, tall, mellomrom og bindestrek.', 'error');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    toast(`Lagret som "${name}" ✅`, 'success');
    loadSavesList();
  } catch (e) {
    toast(`Feil ved lagring: ${e.message}`, 'error');
  }
}

async function loadFromServer(encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Laste inn "${name}"? Ulagrede endringer vil gå tapt.`)) return;
  try {
    const res = await fetch(`${API_BASE}/${encodedName}`);
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    const loaded = await res.json();
    if (loaded.version !== 1) { toast('Ugyldig filformat.', 'error'); return; }
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
    toast(`"${name}" lastet inn ✅`, 'success');
  } catch (e) {
    toast(`Feil ved innlasting: ${e.message}`, 'error');
  }
}

async function deleteFromServer(encodedName, btn) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Slette "${name}"?`)) return;
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/${encodedName}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
    toast(`"${name}" slettet.`);
    loadSavesList();
  } catch (e) {
    toast(`Feil ved sletting: ${e.message}`, 'error');
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

// ── Header ────────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('roundBadge').textContent = `Runde ${state.round}`;

  const tid = TURN_ORDER[state.turnIndex];
  const nat = NATIONS[tid];

  document.getElementById('turnFlag').textContent = nat.flag;
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
      <span class="tn-flag">${nat.flag}</span>
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
    nameEl.textContent = `${nat.flag} ${nat.name}`;
    nameEl.style.color = `var(--c-${tid})`;
  }

  const progEl = document.getElementById('phaseProgress');
  if (progEl) {
    progEl.textContent = `${doneCount}/${visible.length} faser`;
    progEl.className   = `phase-progress${allDone ? ' all-done' : ''}`;
  }

  const listEl = document.getElementById('phaseList');
  if (listEl) {
    listEl.innerHTML = visible.map(p => {
      const done   = completed.includes(p.id);
      const warTag = p.warOnly ? '<span class="phase-war-tag">Kun ved krig</span>' : '';
      return `<label class="phase-item${done ? ' done' : ''}${p.indent ? ' indent' : ''}${p.warOnly ? ' war-only' : ''}">
        <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
        <span class="phase-label">${p.label}</span>
        ${warTag}
      </label>`;
    }).join('');
  }

  const btn = document.getElementById('btnCompletePhases');
  if (btn) {
    btn.className = `btn btn-sm btn-complete-turn${allDone ? ' btn-primary' : ' btn-ghost'}`;
    btn.textContent = allDone ? '✅ Fullfør tur ▶' : 'Fullfør tur ▶';
  }
}

function togglePhase(tid, phaseId, checked) {
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
        <span class="nation-flag">${nat.flag}</span>
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

  const capStatus = nat.mainCapital
    ? (capHeld
        ? `<span class="ofc-cap-held">🏛️ ${nat.mainCapital.replace(/ \(.*?\)/, '')} ✓</span>`
        : `<span class="ofc-cap-lost">🏛️ ${nat.mainCapital.replace(/ \(.*?\)/, '')} TAPT</span>`)
    : '';

  const bonusHtml      = bonus > 0 ? `<span class="ofc-bonus">+${bonus} bonus</span>` : '';
  const techHtml       = techs.length
    ? `<div class="ofc-row"><div class="ofc-tag-list">${techs.map(t => `<span class="ofc-tag ofc-tag-tech">${t}</span>`).join('')}</div></div>`
    : '';
  const conqueredHtml  = conquered.length
    ? `<div class="ofc-row"><span class="ofc-row-label">⚔️ Erobret</span><div class="ofc-tag-list">${conquered.map(n => `<span class="ofc-tag ofc-tag-gain">${escHtml(n)}</span>`).join('')}</div></div>`
    : '';
  const lostHtml       = lost.length
    ? `<div class="ofc-row"><span class="ofc-row-label">💀 Mistet</span><div class="ofc-tag-list">${lost.map(n => `<span class="ofc-tag ofc-tag-loss">${escHtml(n)}</span>`).join('')}</div></div>`
    : '';
  const purchaseHtml   = lastPurchase
    ? `<div class="ofc-row"><span class="ofc-row-label">🛒 Kjøpt</span><span class="ofc-val">${escHtml(lastPurchase)}</span></div>`
    : '';
  const objHtml        = totalObjs > 0
    ? `<div class="ofc-row"><span class="ofc-row-label">🎯 Mål</span><span class="ofc-val">${metObjs.length}/${totalObjs} oppfylt</span></div>`
    : '';

  el.innerHTML = `
    <div class="ofc-card" style="--nat-color: var(--c-${tid})">
      <div class="ofc-header">
        <span class="ofc-flag">${nat.flag}</span>
        <div class="ofc-title-block">
          <div class="ofc-nation-name">${escHtml(nat.name)}</div>
          <div class="ofc-subtitle">Aktiv tur · Runde ${state.round}</div>
        </div>
        ${capStatus}
      </div>
      <div class="ofc-stats">
        <div class="ofc-stat">
          <div class="ofc-stat-val">📈 ${income} IPC ${bonusHtml}</div>
          <div class="ofc-stat-label">Inntekt / runde</div>
        </div>
        <div class="ofc-stat">
          <div class="ofc-stat-val">💰 ${ns.treasury} IPC</div>
          <div class="ofc-stat-label">I kassen</div>
        </div>
        <div class="ofc-stat">
          <div class="ofc-stat-val">🗺️ ${terrCount}</div>
          <div class="ofc-stat-label">Territorier</div>
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
        <span class="ong-flag">${nat.flag}</span>
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
    if (!changes.length) {
      el.innerHTML = `<div class="oc-panel">
        <div class="oc-header">📜 Logg — Runde ${state.round}</div>
        <div class="oc-empty">Ingen hendelser logget enda.</div>
      </div>`;
      return;
    }
    el.innerHTML = `<div class="oc-panel">
      <div class="oc-header">📜 Denne runden — territorieendringer</div>
      <div class="oc-terr-section">
        ${changes.map(tc => {
          const fromNat = NATIONS[tc.from];
          const toNat   = NATIONS[tc.to];
          return `<div class="oc-terr-row">
            <span class="oc-terr-name">${escHtml(tc.name)}</span>
            <span class="oc-terr-arrow">${fromNat ? fromNat.flag : '⚪'} → ${toNat ? toNat.flag : '⚪'}</span>
          </div>`;
        }).join('')}
      </div>
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
        <span class="oc-nat-flag">${nat.flag}</span>
        <span class="oc-nat-name">${nat.shortName}</span>
        <span class="oc-delta ${deltaCls}">${delta >= 0 ? '+' : ''}${delta} IPC</span>
        <span class="oc-treasury">→ ${nd.endTreasury ?? '?'} IPC</span>
      </div>
      ${purchaseStr ? `<div class="oc-purchases">🛒 ${escHtml(purchaseStr)}</div>` : ''}
      ${gained.length ? `<div class="oc-terr-gained">${gained.map(n => `<span class="ofc-tag ofc-tag-gain">${escHtml(n)}</span>`).join('')}</div>` : ''}
      ${lostT.length  ? `<div class="oc-terr-lost">${lostT.map(n => `<span class="ofc-tag ofc-tag-loss">${escHtml(n)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `<div class="oc-panel">
    <div class="oc-header">
      📜 Runde ${lastRound.round} — logg
      <span class="oc-vc-summary">Akse ${lastRound.axisVC ?? '?'} / Allierte ${lastRound.alliesVC ?? '?'} VC</span>
    </div>
    <div class="oc-nations">${nationRows}</div>
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
    const warTag = p.warOnly ? '<span class="phase-war-tag">Kun ved krig</span>' : '';
    return `<label class="phase-item${done ? ' done' : ''}${p.indent ? ' indent' : ''}${p.warOnly ? ' war-only' : ''}">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-label">${p.label}</span>
      ${warTag}
    </label>`;
  }).join('');

  const progressCls = `phase-progress${allDone ? ' all-done' : ''}`;
  return `<div class="nc-phase-progress"><span class="${progressCls}">${doneCount}/${visible.length} faser fullført</span></div>
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
        <span class="nchf-curr-label">Nå:</span>
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
      <span class="phase-block-title">🔬 Fase 0: Forskning &amp; Utvikling</span>
      <span class="phase-opt-badge">valgfritt</span>
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
      <span class="phase-block-title">🛒 Fase 1: Kjøp &amp; Reparer enheter</span>
      <span class="phase-chevron" id="pbchev-p1-${tid}">${p1Done ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!p1Done)}" id="pbb-p1-${tid}">
      <div class="pc-budget-bar">
        <div class="pc-bitem"><span class="pc-blabel">I kassen</span><span class="pc-bval" id="pc-avail-${tid}">${ns.treasury}</span><span class="pc-bunit">IPC</span></div>
        <div class="pc-bitem"><span class="pc-blabel">Handlekurv</span><span class="pc-bval" id="pc-cart-cost-${tid}">0</span><span class="pc-bunit">IPC</span></div>
        <div class="pc-bitem"><span class="pc-blabel">Gjenstår</span><span class="pc-bval" id="pc-remaining-${tid}">${ns.treasury}</span><span class="pc-bunit">IPC</span></div>
      </div>
      <div id="pc-groups-${tid}">${buildPurchaseUnitRows(tid)}</div>
      <div class="pc-group">
        <div class="pc-group-label">🔧 Reparasjoner</div>
        <div class="pc-unit-row">
          <span class="pc-unit-name">Skademarkører (fasiliteter)</span>
          <span class="pc-unit-cost"><span class="pc-cost-now">1</span>&thinsp;IPC</span>
          <div class="pc-qty-ctrl">
            <button class="btn btn-ghost btn-sm" onclick="stepRepair('${tid}',-1)">−</button>
            <span class="pc-qty" id="pc-repair-${tid}">${repairTokens[tid] || 0}</span>
            <button class="btn btn-ghost btn-sm" onclick="stepRepair('${tid}',1)">+</button>
          </div>
          <span class="pc-subtotal" id="pc-repair-sub-${tid}">${(repairTokens[tid] || 0) > 0 ? (repairTokens[tid] || 0) + ' IPC' : '—'}</span>
        </div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-ghost btn-sm" onclick="clearCart('${tid}')">🗑 Tøm</button>
        <button class="btn btn-success btn-sm" id="pc-confirm-${tid}" onclick="confirmPurchase('${tid}')">✅ Bekreft kjøp</button>
      </div>
      <div id="pc-past-${tid}">${buildPastPurchasesHTML(tid)}</div>
    </div>
  </div>`;

  // ── Rockets sub-fase (kun hvis teknologi er forsket) ──────
  const hasRockets  = ns.technologies.includes('rockets');
  const rocketsDone = isDone('rockets');
  const rocketsRow  = !hasRockets ? '' : `
  <div class="phase-row${rocketsDone ? ' phase-done' : ''} phase-indent" id="pb-rockets-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${rocketsDone ? 'checked' : ''} onchange="togglePhase('${tid}','rockets',this.checked)">
      <span>↳ Rockets Launch</span>
    </label>
  </div>`;

  // ── Fase 2–5: enkle avhakingsrader ───────────────────────
  const simpleRows = [
    { id:'p2', label:'Fase 2: Kampbevegelse',         warOnly:true  },
  ].map(p => {
    const done = isDone(p.id);
    return `
  <div class="phase-row${done ? ' phase-done' : ''}" id="pb-${p.id}-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-row-name">${p.label}</span>
      ${p.warOnly ? '<span class="phase-war-tag">Kun ved krig</span>' : ''}
    </label>
  </div>`;
  }).join('');

  const simpleRows45 = [
    { id:'p4', label:'Fase 4: Ikke-kampbevegelse',    warOnly:false },
    { id:'p5', label:'Fase 5: Mobiliser nye enheter', warOnly:false },
  ].map(p => {
    const done = isDone(p.id);
    return `
  <div class="phase-row${done ? ' phase-done' : ''}" id="pb-${p.id}-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="togglePhase('${tid}','${p.id}',this.checked)">
      <span class="phase-row-name">${p.label}</span>
      ${p.warOnly ? '<span class="phase-war-tag">Kun ved krig</span>' : ''}
    </label>
  </div>`;
  }).join('');

  // ── Fase 3: Gjennomfør kamp (kollapser med territorier) ───
  const p3Done = isDone('p3');
  const fase3Block = `
  <div class="phase-block${p3Done ? ' phase-done' : ''}" id="pb-p3-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','p3')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${p3Done ? 'checked' : ''} onchange="togglePhase('${tid}','p3',this.checked)">
      </label>
      <span class="phase-block-title">💥 Fase 3: Gjennomfør kamp <span class="phase-war-tag">Kun ved krig</span></span>
      <span class="phase-chevron" id="pbchev-p3-${tid}">${p3Done ? '▸' : '▾'}</span>
    </div>
    <div class="phase-block-body${openIf(!p3Done)}" id="pbb-p3-${tid}">
      <button class="nc-terr-link-btn" onclick="goToTerritories('${tid}')">
        🗺️ Vis territorier for ${nat.name} →
      </button>
    </div>
  </div>`;

  // ── Fase 6: Samle inn inntekt ─────────────────────────────
  const p6Done   = isDone('p6');
  const fase6Block = `
  <div class="phase-block${p6Done ? ' phase-done' : ''}" id="pb-p6-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','p6')">
      <label class="phase-cb" onclick="event.stopPropagation()">
        <input type="checkbox" ${p6Done ? 'checked' : ''} onchange="togglePhase('${tid}','p6',this.checked)" ${p6Done ? 'disabled' : ''}>
      </label>
      <span class="phase-block-title">💰 Fase 6: Samle inn inntekt</span>
      <span class="phase-ipc-preview" id="nc-p6-preview-${tid}">${toUse}\xa0IPC</span>
      <span class="phase-chevron" id="pbchev-p6-${tid}">▾</span>
    </div>
    <div class="phase-block-body" id="pbb-p6-${tid}">
      <div class="income-row">
        <span class="income-label">Territorieinntekt</span>
        <span class="income-val" id="nc-income-${tid}">${income}\xa0IPC</span>
      </div>
      <div class="income-row">
        <span class="income-label">Nasjonale mål (bonus)</span>
        <span class="income-val text-green" id="nc-bonus-${tid}">${bonusSum > 0 ? '+' + bonusSum : bonusSum}\xa0IPC</span>
      </div>
      <div class="phase-sub-hdr">🎯 Nasjonale mål</div>
      <div class="obj-section-header">
        <div class="obj-war-controls">
          <label class="obj-war-label${getEffectiveAtWar(tid) ? ' active' : ''}${state.round > 3 ? ' obj-war-locked' : ''}" title="${state.round > 3 ? 'Alle nasjoner er automatisk i krig etter runde 3' : (getEffectiveAtWar(tid) ? 'Klikk for å sette fredstid' : 'Klikk for å sette krig')}">
            <input type="checkbox" id="obj-atwar-${tid}" ${getEffectiveAtWar(tid) ? 'checked' : ''} ${state.round > 3 ? 'disabled' : ''} onchange="toggleAtWar('${tid}', this.checked)">
            ⚔️ Krig${state.round > 3 ? ' 🔒' : ''}
          </label>
          <label class="obj-showall-label" title="Vis alle bonuser (både krig og fred)">
            <input type="checkbox" id="obj-showall-${tid}" onchange="toggleObjShowAll('${tid}', this.checked)">
            👁 Vis alle
          </label>
        </div>
      </div>
      <div id="obj-list-${tid}">${buildObjectivesHTML(tid)}</div>
      <div class="phase-sub-hdr" style="margin-top:.5rem">📥 Justeringer</div>
      <div class="pc-unit-row income-stepper-row">
        <span class="pc-unit-name">Konvoi-tap</span>
        <span class="pc-unit-cost text-red">− IPC</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="stepConvoy('${tid}', -1)">−</button>
          <span class="pc-qty" id="convoy-${tid}">${ns.convoyLoss || 0}</span>
          <button class="btn btn-ghost btn-sm" onclick="stepConvoy('${tid}', 1)">+</button>
        </div>
      </div>
      <div class="pc-unit-row income-stepper-row">
        <span class="pc-unit-name">Krigsobligasjoner</span>
        <span class="pc-unit-cost text-green">+ IPC</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="stepWarBonds('${tid}', -1)">−</button>
          <span class="pc-qty" id="warbonds-${tid}">${ns.warBonds || 0}</span>
          <button class="btn btn-ghost btn-sm" onclick="stepWarBonds('${tid}', 1)">+</button>
        </div>
      </div>
      <div class="pc-unit-row income-stepper-row adj-treasury-row">
        <span class="pc-unit-name">🔧 Manuell justering</span>
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
        <span class="nc-income-hero-label">🏦 Neste kjøp</span>
        <span class="nc-income-hero-val" id="nc-tospend-${tid}">${toUse}</span>
        <span class="nc-income-hero-unit">IPC</span>
      </div>
      <div class="nc-formula" id="nc-formula-${tid}">= ${state.round === 1 ? '' : ns.treasury + ' (skattkammer) + '}${(ns.capturedTreasury || 0) > 0 ? ns.capturedTreasury + ' (kapturet) + ' : ''}${income} (terr.) + ${bonusSum} (bonus) + ${ns.warBonds || 0} (obligasjoner) − ${ns.convoyLoss || 0} (konvoi)</div>
      <button class="nc-collect-btn" id="nc-collect-${tid}"
        onclick="collectIncome('${tid}')"
        ${ownsMainCapital(tid) ? '' : 'disabled'}
      >${ownsMainCapital(tid) ? '✅ Samle inn inntekt' : '🔒 Kapital okkupert'}</button>
    </div>
  </div>`;

  // ── Konvoidisrupsjon (sub-fase etter Fase 6) ─────────────
  const convDone = isDone('convoy');
  const convoyRow = `
  <div class="phase-row${convDone ? ' phase-done' : ''} phase-indent" id="pb-convoy-${tid}">
    <label class="phase-row-lbl">
      <input type="checkbox" ${convDone ? 'checked' : ''} onchange="togglePhase('${tid}','convoy',this.checked)">
      <span class="phase-row-name">↳ Gjennomfør konvoidisrupsjon</span>
    </label>
  </div>`;

  // ── Notater (kollapset som standard) ─────────────────────
  const notesBlock = `
  <div class="phase-block phase-block-misc" id="pb-misc-${tid}">
    <div class="phase-block-hdr" onclick="togglePhaseBlock('${tid}','misc')">
      <span class="phase-block-title" style="color:var(--text-dim);font-size:.78rem">📝 Notater</span>
      <span class="phase-chevron" id="pbchev-misc-${tid}">▸</span>
    </div>
    <div class="phase-block-body" id="pbb-misc-${tid}">
      <textarea class="notes-area" placeholder="Notater for ${nat.name}..." id="notes-${tid}"
        onchange="onNotesChange('${tid}', this.value)">${ns.notes}</textarea>
    </div>
  </div>`;

  return `<div class="nation-card" data-nation="${tid}" id="nc-${tid}">
    <div class="nation-card-header" onclick="toggleNationCard('${tid}')">
      <div class="nc-header-left">
          <span class="nc-flag">${nat.icon ? `<img class="nc-icon" src="${nat.icon}" alt="${nat.name}">` : nat.flag}</span>
          <div class="nc-info">
            <div class="nc-name"><span class="nc-abbr">${nat.abbr ? nat.abbr : (nat.shortName || tid).slice(0,2).toUpperCase()}</span> ${nat.name}</div>
          <div class="nc-side ${nat.side}">${nat.side === 'axis' ? 'Akse' : 'Alliert'}</div>
        </div>
      </div>
      <div class="nc-header-fields" id="nc-hf-${tid}" onclick="event.stopPropagation()">
        ${buildNationHeaderFieldsInner(tid)}
      </div>
      <div class="nc-header-right">
        <span class="nc-done-badge" id="nc-done-badge-${tid}">✅ Runde ferdig</span>
        <div class="nc-treasury">
          <div class="nc-treasury-label">Skattkammer</div>
          <div class="nc-treasury-val" id="nc-treasury-${tid}">${ns.treasury}</div>
          <div class="nc-treasury-unit">IPC</div>
        </div>
        <span class="nc-toggle-icon">▾</span>
      </div>
    </div>
    <div class="nation-card-body" id="ncb-${tid}">
      ${fase0Block}
      ${fase1Block}
      ${rocketsRow}
      ${simpleRows}
      ${fase3Block}
      ${simpleRows45}
      ${fase6Block}
      ${convoyRow}
      ${notesBlock}
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
  { label: '🪖 Land', filter: u => u.type === 'land'     },
  { label: '✈️ Luft',  filter: u => u.type === 'air'      },
  { label: '⚓ Sjø',   filter: u => u.type === 'sea'      },
  { label: '🏗️ Bygg',  filter: u => u.type === 'building' },
];

function buildPurchaseUnitRows(tid) {
  const cart            = purchaseCart[tid] || {};
  const hasShipbuilding = state.nations[tid].technologies.includes('shipbuilding');
  return PC_GROUPS.map(g => {
    const rows = UNITS.filter(g.filter).map(u => {
      const cost       = getUnitCost(u, tid);
      const discounted = u.shipbuildingCost !== undefined && hasShipbuilding;
      const costHtml   = discounted
        ? `<span class="pc-cost-orig">${u.cost}</span>&thinsp;<span class="pc-cost-now">${cost}</span>`
        : `<span class="pc-cost-now">${cost}</span>`;
      const qty = cart[u.id] || 0;
      const sub = qty * cost;
      return `<div class="pc-unit-row">
        <span class="pc-unit-name">${u.name}</span>
        <span class="pc-unit-cost">${costHtml}&thinsp;IPC</span>
        <div class="pc-qty-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="addToCart('${tid}','${u.id}',-1)">−</button>
          <span class="pc-qty" id="pc-qty-${tid}-${u.id}">${qty}</span>
          <button class="btn btn-ghost btn-sm" onclick="addToCart('${tid}','${u.id}',+1)">+</button>
        </div>
        <span class="pc-subtotal" id="pc-sub-${tid}-${u.id}">${sub > 0 ? sub + ' IPC' : '—'}</span>
      </div>`;
    }).join('');
    return `<div class="pc-group"><div class="pc-group-label">${g.label}</div>${rows}</div>`;
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
  return `<div class="pc-hist-header">📦 Kjøpt denne runden:</div>${entries}`;
}

function stepRepair(tid, delta) {
  repairTokens[tid] = Math.max(0, (repairTokens[tid] || 0) + delta);
  updatePurchaseDisplay(tid);
}

function addToCart(tid, unitId, delta) {
  if (!purchaseCart[tid]) purchaseCart[tid] = {};
  purchaseCart[tid][unitId] = Math.max(0, (purchaseCart[tid][unitId] || 0) + delta);
  updatePurchaseDisplay(tid);
}

function clearCart(tid) {
  purchaseCart[tid] = {};
  repairTokens[tid] = 0;
  updatePurchaseDisplay(tid);
}

function confirmPurchase(tid) {
  const cart = purchaseCart[tid] || {};
  const ns   = state.nations[tid];
  const items = [];
  let totalCost = 0;
  const repairCount = repairTokens[tid] || 0;
  for (const [unitId, qty] of Object.entries(cart)) {
    if (qty <= 0) continue;
    const unit     = UNITS.find(u => u.id === unitId);
    if (!unit) continue;
    const costEach = getUnitCost(unit, tid);
    items.push({ unitId, name: unit.name, qty, costEach });
    totalCost += qty * costEach;
  }
  totalCost += repairCount;
  if (!items.length && repairCount === 0) { toast('Handlekurven er tom!', 'error'); return; }
  if (totalCost > ns.treasury) {
    toast(`Ikke nok IPC! Trenger ${totalCost} IPC, har ${ns.treasury} IPC.`, 'error');
    return;
  }
  ns.treasury -= totalCost;
  state.purchaseLogs.push({
    round: state.round, nationId: tid, items, totalCost,
    date:  new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }),
  });
  purchaseCart[tid] = {};
  repairTokens[tid] = 0;
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
  const repairNote = repairCount > 0 ? `${purchaseNames ? ', ' : ''}reparert ${repairCount} skade` : '';
  toast(`${NATIONS[tid].flag} Fase 1 fullført — ${purchaseNames}${repairNote} for ${totalCost} IPC. Skattkammer: ${ns.treasury} IPC.`, 'success');
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
  const repairCount = repairTokens[tid] || 0;
  cartTotal += repairCount;
  const repairQtyEl = document.getElementById(`pc-repair-${tid}`);
  if (repairQtyEl) repairQtyEl.textContent = repairCount;
  const repairSubEl = document.getElementById(`pc-repair-sub-${tid}`);
  if (repairSubEl) repairSubEl.textContent = repairCount > 0 ? repairCount + ' IPC' : '—';
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
    const treasuryPart = state.round === 1 ? '' : `${ns.treasury} (skattkammer) + `;
    const capturedPart = (ns.capturedTreasury || 0) > 0 ? `${ns.capturedTreasury} (kapturet) + ` : '';
    const adjPart = (ns.manualAdjust || 0) !== 0 ? ` ${ns.manualAdjust > 0 ? '+' : ''}${ns.manualAdjust} (justering)` : '';
    fmtEl.textContent = `= ${treasuryPart}${capturedPart}${income} (terr.) + ${bonus} (bonus) + ${ns.warBonds || 0} (obligasjoner) − ${ns.convoyLoss || 0} (konvoi)${adjPart}`;
  }

  const collectBtn = document.getElementById(`nc-collect-${tid}`);
  if (collectBtn) {
    const hasCapital = ownsMainCapital(tid);
    const alreadyCollected = state.turnPhases?.[tid]?.includes('p6') ?? false;
    if (alreadyCollected) {
      collectBtn.disabled = true;
      collectBtn.style.opacity = '0.5';
      collectBtn.style.cursor  = 'not-allowed';
      collectBtn.title = 'Allerede innsamlet denne runden';
      collectBtn.textContent = '🔒 Allerede innsamlet';
    } else {
      collectBtn.disabled = !hasCapital;
      collectBtn.style.opacity = hasCapital ? '' : '0.4';
      collectBtn.style.cursor  = hasCapital ? '' : 'not-allowed';
      collectBtn.title = hasCapital ? '' : 'Kan ikke samle inn inntekt — kapitalen er okkupert!';
      collectBtn.textContent = hasCapital ? '✅ Samle inn inntekt' : '🔒 Kapital okkupert';
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
      <div class="nc-section-title">🎲 Forskning & Utvikling — Fase 0 (valgfritt)</div>
      <div class="rd-info">UK Europe og UK Pacific deler forskning. Begge økonomier kan betale helt eller delvis. Teknologier gjelder begge.</div>
      <div class="rd-counter-row">
        <div class="rd-dice-display">
          <span class="rd-dice-icon">🎲</span>
          <span class="rd-dice-count" id="rd-count-${tid}">${count}</span>
          <span class="rd-dice-label" id="rd-label-${tid}">terning${count !== 1 ? 'er' : ''} (delt)</span>
        </div>
      </div>
      <div class="rd-uk-treasuries">
        <span class="rd-uk-treas">🇬🇧 UKE: <strong id="rd-uke-treas-${tid}">${ukeNs.treasury}</strong> IPC</span>
        <span class="rd-uk-treas">🏴 UKP: <strong id="rd-ukp-treas-${tid}">${ukpNs.treasury}</strong> IPC</span>
      </div>
      <div class="rd-buy-btns" style="flex-wrap:wrap;gap:.3rem;margin-top:.3rem">
        <button class="btn btn-primary btn-sm" onclick="buyResearchDice('uk_europe', 1)" title="Betal 5 IPC fra UK Europe">+ Kjøp fra UKE (5 IPC)</button>
        <button class="btn btn-primary btn-sm" onclick="buyResearchDice('uk_pacific', 1)" title="Betal 5 IPC fra UK Pacific">+ Kjøp fra UKP (5 IPC)</button>
        <button class="btn btn-accent btn-sm" onclick="showUKSplitBuy('${tid}')" title="Del kostnaden mellom UKE og UKP">✂️ Spleis (5 IPC)</button>
        <button class="btn btn-ghost btn-sm" onclick="buyResearchDiceUKRemove('${tid}')" title="Fjern 1 terning (5 IPC refunderes til sist betalende)">−</button>
      </div>
      <div id="rd-split-ui-${tid}" style="display:none"></div>
      <div class="rd-actions">
        <button class="btn btn-ghost btn-sm" onclick="resetResearchDice('${tid}')">&#128465; Nullstill</button>
      </div>
      <div id="rd-result-${tid}"></div>
    </div>`;
  }

  // Non-UK nations: standard R&D section
  const count = ns.researchDice || 0;
  return `
    <div class="nc-section nc-s-rd" id="rd-section-${tid}">
      <div class="nc-section-title">🎲 Forskning &amp; Utvikling <span class="rd-phase-badge">Fase 0</span></div>
      <div class="rd-cost-hint">5 IPC per terning — minst én 6 = gjennombrudd</div>
      <div class="rd-stepper">
        <button class="rd-step-btn" onclick="buyResearchDice('${tid}', -1)">−</button>
        <div class="rd-step-display">
          <span class="rd-step-icon">🎲</span>
          <span class="rd-step-count" id="rd-count-${tid}">${count}</span>
          <span class="rd-step-label" id="rd-label-${tid}">terning${count !== 1 ? 'er' : ''}</span>
        </div>
        <button class="rd-step-btn rd-step-add" onclick="buyResearchDice('${tid}', 1)">+ 5 IPC</button>
      </div>
      <button class="btn btn-ghost btn-sm rd-reset-btn" onclick="resetResearchDice('${tid}')">&#128465; Nullstill</button>
      <div id="rd-result-${tid}"></div>
    </div>`;
}

function buyResearchDice(tid, delta) {
  if (tid === 'china') { toast('Kina kan ikke forske!', 'error'); return; }
  const ns = state.nations[tid];

  // UK shared dice handling
  if (isUK(tid)) {
    if (delta > 0 && ns.treasury < 5) { toast(`Ikke nok IPC i ${NATIONS[tid].name} — 5 IPC per terning.`, 'error'); return; }
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
  if (delta > 0 && ns.treasury < 5) { toast('Ikke nok IPC — 5 IPC per terning.', 'error'); return; }
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
  if (ukeVal + ukpVal !== 5) { if (errEl) errEl.textContent = 'Summen må være 5 IPC!'; return; }
  if (ukeVal < 0 || ukpVal < 0) { if (errEl) errEl.textContent = 'Kan ikke være negativt!'; return; }
  if (state.nations['uk_europe'].treasury < ukeVal) { if (errEl) errEl.textContent = `UK Europe har bare ${state.nations['uk_europe'].treasury} IPC!`; return; }
  if (state.nations['uk_pacific'].treasury < ukpVal) { if (errEl) errEl.textContent = `UK Pacific har bare ${state.nations['uk_pacific'].treasury} IPC!`; return; }
  state.nations['uk_europe'].treasury -= ukeVal;
  state.nations['uk_pacific'].treasury -= ukpVal;
  setUKSharedDice(getUKSharedDice() + 1);
  saveState();
  toast(`Spleis: UKE betalte ${ukeVal} + UKP betalte ${ukpVal} = 1 terning kjøpt!`, 'success');
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
        <div class="rd-breakthrough">🎉 GJENNOMBRUDD!</div>
        <div class="rd-chart-choice">
          <div class="rd-chart-hint">Velg gjennombruddsdiagram og rull:</div>
          <div class="rd-chart-btns">
            <div class="rd-chart-col">
              <div class="rd-chart-header">📋 Diagram 1 — Land &amp; Industri</div>
              <div class="rd-chart-list">
                <div class="rd-chart-entry"><span class="rd-chart-num">1</span>Advanced Artillery</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">2</span>Rockets</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">3</span>Paratroopers</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">4</span>Increased Factory Prod.</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">5</span>War Bonds</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">6</span>Impr. Mech. Infantry</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', 1)">🎲 Rull Diagram 1</button>
            </div>
            <div class="rd-chart-col">
              <div class="rd-chart-header">📋 Diagram 2 — Hav &amp; Luft</div>
              <div class="rd-chart-list">
                <div class="rd-chart-entry"><span class="rd-chart-num">1</span>Super Submarines</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">2</span>Jet Fighters</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">3</span>Improved Shipyards</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">4</span>Radar</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">5</span>Long-Range Aircraft</div>
                <div class="rd-chart-entry"><span class="rd-chart-num">6</span>Heavy Bombers</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', 2)">🎲 Rull Diagram 2</button>
            </div>
          </div>
          <div id="rd-chart-result-${tid}"></div>
        </div>
      </div>`;
  } else {
    rdResult.innerHTML = `
      <div class="rd-roll-result">
        <div class="rd-rolls">${diceHtml}</div>
        <div class="rd-no-breakthrough">Ingen gjennombrudd — terninger beholdes til neste runde.</div>
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
    ${alreadyHas ? '<span class="rd-already-has">(har allerede — rull igjen)</span>' : ''}
  </div>`;

  if (tech && !alreadyHas) {
    html += `<button class="btn btn-success btn-sm rd-confirm-btn" onclick="assignResearchTech('${tid}','${tech.id}')">&#9989; Bekreft: ${tech.name}</button>`;
  } else {
    html += `<div class="rd-chart-btns" style="margin-top:.4rem">
      <button class="btn btn-primary btn-sm" onclick="showChartRoll('${tid}', ${chart})">🎲 Rull igjen</button>
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
    toast(`🇬🇧 United Kingdom utviklet: ${tech?.name}! 🔬 Gjelder begge økonomier. Terninger nullstilt.`, 'success');
  } else {
    toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} utviklet: ${tech?.name}! 🔬 Terninger nullstilt.`, 'success');
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
    if (rdResult) rdResult.innerHTML = `<div class="rd-tech-acquired">✅ ${tech?.name} låst opp! Terninger nullstilt.</div>`;
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
  if (!objs.length) return '<span style="color:var(--text-muted);font-size:.8rem">Ingen spesifikke mål.</span>';
  const ns      = state.nations[tid] ?? {};
  const atWar   = getEffectiveAtWar(tid);
  const showAll = objShowAll[tid] ?? false;

  const visible = showAll ? objs : objs.filter(o => {
    if (o.warOnly   && !atWar) return false;
    if (o.peaceOnly &&  atWar) return false;
    return true;
  });

  if (!visible.length) {
    return `<span class="obj-empty-msg">${atWar
      ? 'Ingen bonus-IPC-mål aktive i krig for denne nasjonen.'
      : 'Ingen bonus-IPC-mål i fredstid for denne nasjonen.'}</span>`;
  }

  return visible.map(o => {
    const hasRule     = !!OBJECTIVE_RULES[o.id];
    const checked     = ns.objectives?.[o.id] ? 'checked' : '';
    const claimed     = ns.objectivesClaimed?.[o.id];
    const disabled    = (o.oneTime && claimed) || hasRule ? 'disabled' : '';
    const claimedNote = (o.oneTime && claimed)
      ? ' <span style="color:var(--text-muted);font-size:.7rem">(allerede hentet)</span>' : '';
    let ipcTag, detailTag = '';
    if (o.dynamicIpc && o.id === 'sov_axis_territories') {
      const axisTerms = getSovAxisTerritories();
      const total     = axisTerms.length * (o.ipcPerTerritory || 0);
      const terrList  = axisTerms.length ? axisTerms.map(t => t.name).join(', ') : 'Ingen ennå';
      ipcTag    = `<span style="color:var(--gold);font-weight:700;margin-left:.3rem">+${total} IPC (${axisTerms.length}×${o.ipcPerTerritory})</span>`;
      detailTag = `<br><span style="font-size:.75rem;color:var(--text-muted);margin-left:1.3rem">Territorier: ${terrList}</span>`;
    } else {
      ipcTag = `<span style="color:var(--gold);font-weight:700;margin-left:.3rem">+${o.ipc} IPC</span>`;
    }
    const warBadge    = showAll && o.warOnly   ? '<span class="obj-badge obj-badge-war">⚔️ krig</span>'  : '';
    const peaceBadge  = showAll && o.peaceOnly ? '<span class="obj-badge obj-badge-peace">☘ fred</span>' : '';
    const autoBadge   = hasRule ? '<span class="obj-badge obj-badge-auto" title="Evalueres automatisk basert på territorier">⚙ auto</span>' : '';
    const titleAttr   = hasRule ? `Automatisk evaluert basert på territorier. ${o.hint}` : o.hint;
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
    toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} kan ikke samle inn inntekt — kapitalen er okkupert!`, 'error');
    return;
  }
  if (state.turnPhases?.[tid]?.includes('p6')) {
    toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} har allerede samlet inn inntekt denne runden!`, 'error');
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
  const details = (bonus > 0 || adjust !== 0) ? ` (terr: ${income} + bonus: ${bonus} + obl: ${warBonds} − konvoi: ${loss}${adjust !== 0 ? ` ${adjust > 0 ? '+' : ''}${adjust} justering` : ''})` : '';
  updateIncomeDisplay(tid);
  updateIncomeAdjVisibility(tid);
  updateNationPhaseTracker(tid);
  updateNationCardDoneState(tid);
  toast(`${NATIONS[tid].flag} ${NATIONS[tid].name} samlet inn ${net} IPC${details}. Ny sum: ${ns.treasury} IPC`, 'success');
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
        ? `<button class="btn btn-ghost btn-sm ng-transfer-all" onclick="confirmTransferAll('${nid}','${other}')" title="Overfør alle viste territorier til ${otherN.name}">
            Overfør alle → ${otherN.flag} ${otherN.shortName}
          </button>`
        : '';

      const thAction = otherN
        ? `→ ${otherN.flag} ${otherN.name}`
        : 'Endre eier';

      html += `<div class="nation-group" style="--ng-accent:${nat.accent ?? '#9ca3af'}">
        <div class="nation-group-header">
          <span class="ng-flag">${nat.flag}</span>
          <span class="ng-name">${nat.name}</span>
          <span class="ng-stats">${rows.length} territorier · ${ipcSum} IPC</span>
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
                  <th>Territorium</th>
                  <th style="text-align:center">IPC</th>
                  <th>Kontrollert av</th>
                  <th>${thAction}</th>
                  <th>Erobret fra</th>
                </tr></thead>
                <tbody>${rows.map(t => buildTerritoryRowNation(t, other)).join('')}</tbody>
              </table>`
            : `<div class="ng-empty">Ingen territorier funnet</div>`
        }
      </div>`;
    }

    container.innerHTML = html || '<div class="empty-state"><div class="es-icon">🔍</div>Ingen territorier funnet.</div>';
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
            <th>Territorium</th>
            <th style="text-align:center">IPC</th>
            <th>Kontrollert av</th>
            <th>Endre eier</th>
            <th>Erobret fra</th>
          </tr></thead>
          <tbody>
            ${rows.map(t => buildTerritoryRow(t)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  container.innerHTML = html || '<div class="empty-state"><div class="es-icon">🔍</div>Ingen territorier funnet.</div>';
  updateTerritoryCountBar(filtered);
}

function getNeutralTypeBadge(t, ctrl) {
  if (ctrl !== 'neutral' || !t.neutralType || t.neutralType === 'neutral') return '';
  const labels = { strict: 'Strengt nøytral', pro_allied: 'Pro-Alliert', pro_axis: 'Pro-Akse', mongolia: 'Mongolia' };
  const label = labels[t.neutralType] ?? t.neutralType;
  return `<span style="font-size:.65rem;color:var(--text-muted);margin-left:.25rem;font-style:italic">(${label})</span>`;
}

function buildTerritoryRow(t) {
  const ctrl    = getController(t.id);
  const nat     = NATIONS[ctrl] ?? NATIONS.neutral;
  const capital = t.isCapital ? 'is-capital' : '';
  const ipcCls  = t.ipc === 0 ? 'zero' : '';
  const origNat = (t.startController && t.startController !== ctrl)
    ? (NATIONS[t.startController] ?? null) : null;

  return `<tr>
    <td class="t-name ${capital}">${t.name}${t.isMainCapital ? ' 🏛️' : ''}${getNeutralTypeBadge(t, ctrl)}</td>
    <td class="t-ipc ${ipcCls}">${t.ipc || '—'}</td>
    <td><span class="owner-badge" data-nation="${ctrl}">${nat.flag} ${nat.shortName}</span></td>
    <td><button class="owner-change-btn" onclick="openOwnerPicker('${t.id}')">${nat.flag} ${nat.shortName} <span class="ocb-arrow">▼</span></button></td>
    <td>${origNat ? `<span class="owner-badge conquered-from" data-nation="${t.startController}">${origNat.flag} ${origNat.shortName}</span>` : ''}</td>
  </tr>`;
}

function buildTerritoryRowNation(t, quickTransferTo) {
  const ctrl    = getController(t.id);
  const nat     = NATIONS[ctrl] ?? NATIONS.neutral;
  const capital = t.isCapital ? 'is-capital' : '';
  const ipcCls  = t.ipc === 0 ? 'zero' : '';
  const toNat   = quickTransferTo ? (NATIONS[quickTransferTo] ?? null) : null;
  const origNat = (t.startController && t.startController !== ctrl)
    ? (NATIONS[t.startController] ?? null) : null;

  const actionCell = toNat
    ? `<div class="quick-transfer-cell">
        <button class="quick-transfer-btn" onclick="onOwnerChange('${t.id}','${quickTransferTo}')" title="Overfør til ${toNat.name}">
          ${toNat.flag} ${toNat.shortName}
        </button>
        <button class="owner-change-btn-sm" onclick="openOwnerPicker('${t.id}')" title="Velg annen eier">⋯</button>
      </div>`
    : `<button class="owner-change-btn" onclick="openOwnerPicker('${t.id}')">${nat.flag} ${nat.shortName} <span class="ocb-arrow">▼</span></button>`;

  return `<tr>
    <td class="t-name ${capital}">${t.name}${t.isMainCapital ? ' 🏛️' : ''}${getNeutralTypeBadge(t, ctrl)}</td>
    <td class="t-ipc ${ipcCls}">${t.ipc || '—'}</td>
    <td><span class="owner-badge" data-nation="${ctrl}">${nat.flag} ${nat.shortName}</span></td>
    <td>${actionCell}</td>
    <td>${origNat ? `<span class="owner-badge conquered-from" data-nation="${t.startController}">${origNat.flag} ${origNat.shortName}</span>` : ''}</td>
  </tr>`;
}

function confirmTransferAll(fromNation, toNation) {
  const territories = TERRITORIES.filter(t => getController(t.id) === fromNation);
  const fromN = NATIONS[fromNation];
  const toN   = NATIONS[toNation];
  if (!territories.length) {
    toast(`${fromN?.name ?? fromNation} har ingen territorier å overføre.`, 'error');
    return;
  }
  if (!confirm(`Overfør ALLE ${territories.length} territorier fra ${fromN?.flag} ${fromN?.name} til ${toN?.flag} ${toN?.name}?\n\nDette inkluderer alle territorier, ikke bare de som vises nå.`)) return;
  territories.forEach(t => setController(t.id, toNation));
  saveState();
  renderTerritories();
  updateNationCards();
  if (activeTab === 'overview') renderOverview();
  toast(`${territories.length} territorier overført til ${toN?.flag} ${toN?.name}!`, 'success');
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
  const t    = TERRITORIES.find(t => t.id === tid);
  const ctrl = getController(tid);

  document.getElementById('ownerPickerTitle').textContent = `${t?.name ?? tid} — Endre eier`;

  const grid = document.getElementById('ownerPickerGrid');
  grid.innerHTML = Object.keys(NATIONS).map(nid => {
    const n      = NATIONS[nid];
    const active = nid === ctrl ? ' active' : '';
    return `<button class="owner-picker-btn${active}" onclick="selectOwnerFromPicker('${nid}')">
      <span class="opb-flag">${n.flag}</span>
      <span class="opb-name">${n.name}</span>
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
        <span class="owner-badge" data-nation="${ctrl}">${nat.flag} ${nat.name}</span>
      </div>
    </div>`;
  };

  const cols = [];
  cols.push(`
    <div class="vc-col vc-axis">
      <div class="vc-col-header">⚔️ Aksen — ${axisCities.length} byer</div>
      <div class="vc-list">${axisCities.map(renderCard).join('')}${axisCities.length===0?'<div class="empty-state">Ingen</div>':''}</div>
    </div>
  `);

  if (neutralCities.length > 0) {
    cols.push(`
      <div class="vc-col vc-neutral">
        <div class="vc-col-header">📍 Nøytrale / annet — ${neutralCities.length} byer</div>
        <div class="vc-list">${neutralCities.map(renderCard).join('')}</div>
      </div>
    `);
  }

  cols.push(`
    <div class="vc-col vc-allies">
      <div class="vc-col-header">🏳️ Allierte — ${alliesCities.length} byer</div>
      <div class="vc-list">${alliesCities.map(renderCard).join('')}${alliesCities.length===0?'<div class="empty-state">Ingen</div>':''}</div>
    </div>
  `);

  container.innerHTML = cols.join('');
}

// ── History tab ───────────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById('historyList');
  if (!state.history.length) {
    container.innerHTML = '<div class="empty-state"><div class="es-icon">📜</div>Ingen rundehistorikk ennå.<br>Avslutt en runde for å logge data.</div>';
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
        <span>${nat.flag} ${nat.name}</span>
        <span style="color:var(--text-dim);flex:1;margin-left:.5rem">Samlet inn</span>
        <span class="history-delta ${cls}">${delta >= 0 ? '+' : ''}${delta} IPC</span>
        <span style="color:var(--text-muted);margin-left:.5rem;font-size:.75rem">→ ${nd.endTreasury} IPC</span>
        ${purchaseHtml}
      </div>`;
    }).join('');

    // Territory changes this round
    const terrChanges = h.territoryChanges ?? [];
    const terrHtml = terrChanges.length ? `
      <div class="hist-terr-section">
        <div class="hist-terr-title">🗺️ Territorier erobret / mistet</div>
        ${terrChanges.map(tc => {
          const fromNat  = NATIONS[tc.from];
          const toNat    = NATIONS[tc.to];
          const fromFlag = fromNat ? fromNat.flag : '⚪';
          const toFlag   = toNat   ? toNat.flag   : '⚪';
          const fromName = fromNat ? fromNat.shortName : tc.from;
          const toName   = toNat   ? toNat.shortName   : tc.to;
          const isCapture = toNat && fromNat && toNat.side !== fromNat.side;
          return `<div class="hist-terr-row">
            <span class="hist-terr-name">${tc.name}</span>
            <span class="hist-terr-arrow">${fromFlag} ${fromName} ${isCapture ? '⚔️' : '→'} ${toFlag} ${toName}</span>
          </div>`;
        }).join('')}
      </div>` : '';
    return `<div class="history-entry">
      <div class="history-entry-header" onclick="toggleHistory('${id}')">
        <span class="history-round-badge">Runde ${h.round}</span>
        <span style="color:var(--text-dim);font-size:.82rem">
          Axis ${h.axisVC} VC · Allies ${h.alliesVC} VC
          ${(h.territoryChanges ?? []).length ? `· ${h.territoryChanges.length} terr.` : ''}
        </span>
        <span class="history-date">${h.date}</span>
      </div>
      <div class="history-entry-body" id="${id}">${rows}${terrHtml}</div>
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

  toast(`Runde ${state.round} starter! ▶️`, 'success');
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
  toast('Nytt spill startet! ⚔️', 'success');
}

// ── Utilities ─────────────────────────────────────────────────
function sanitize(s) {
  return s.replace(/[^a-zA-Z0-9_]/g, '_');
}

function ownerBadge(nationId) {
  const nat = NATIONS[nationId] ?? NATIONS.neutral;
  return `<span class="owner-badge" data-nation="${nationId}">${nat.flag} ${nat.shortName}</span>`;
}

// ── Battle Board ────────────────────────────────────────────────────────────
const BATTLE_UNITS = [
  { id:'infantry',   name:'Infanteri',           icon:'🪖', type:'land', attack:1, defense:2 },
  { id:'mech_inf',   name:'Mek. Infanteri',       icon:'🚛', type:'land', attack:1, defense:2 },
  { id:'artillery',  name:'Artilleri',            icon:'💣', type:'land', attack:2, defense:2 },
  { id:'tank',       name:'Tank',                 icon:'🏎️', type:'land', attack:3, defense:3 },
  { id:'aaa',        name:'Anti-Luft (AAA)',       icon:'🔫', type:'land', attack:0, defense:0, aaOnly:true },
  { id:'fighter',    name:'Jagerfly',             icon:'✈️', type:'air',  attack:3, defense:4 },
  { id:'tac_bomber', name:'Taktisk Bomber',       icon:'💥', type:'air',  attack:3, defense:3 },
  { id:'str_bomber', name:'Strategisk Bomber',    icon:'🛩️', type:'air',  attack:4, defense:1 },
  { id:'submarine',  name:'Ubåt',                icon:'🌊', type:'sea',  attack:2, defense:1 },
  { id:'destroyer',  name:'Destroyer',            icon:'⚓', type:'sea',  attack:2, defense:2 },
  { id:'cruiser',    name:'Krysser',              icon:'🚢', type:'sea',  attack:3, defense:3 },
  { id:'carrier',    name:'Hangarskip',           icon:'🛳️', type:'sea',  attack:0, defense:2 },
  { id:'battleship', name:'Slagskip',             icon:'⛵', type:'sea',  attack:4, defense:4 },
  { id:'transport',  name:'Transport',            icon:'🚤', type:'sea',  attack:0, defense:0 },
];

const BATTLE_GROUPS = [
  { label:'🪖 Land', filter: u => u.type === 'land' },
  { label:'✈️ Luft', filter: u => u.type === 'air'  },
  { label:'⚓ Sjø',  filter: u => u.type === 'sea'  },
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
    sel.innerHTML = '<option value="">— Velg nasjon —</option>';
    TURN_ORDER.forEach(tid => {
      const n = NATIONS[tid];
      const opt = document.createElement('option');
      opt.value = tid;
      opt.textContent = `${n.flag} ${n.name}`;
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
        ? `<div style="font-size:.7rem;color:var(--text-muted)">(skyter på fly)</div>`
        : '';
      return `<div class="bu-row">
        ${dot}
        <div><div class="bu-name">${u.icon} ${u.name}</div>${aaNote}</div>
        <div class="bu-val">${note}</div>
        <div class="bu-ctrl">
          <button class="bu-btn" onclick="changeBattleUnit('${side}','${u.id}',-1)">−</button>
          <span class="bu-count${qty === 0 ? ' zero' : ''}" id="bu-qty-${side}-${u.id}">${qty}</span>
          <button class="bu-btn" onclick="changeBattleUnit('${side}','${u.id}',+1)">+</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="bu-group-label">${g.label}</div>${rows}`;
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
      dice.push({ label: u.name, val: u.attack, qty });
    });

  } else {
    // Defense — no pairing
    BATTLE_UNITS.forEach(u => {
      if (u.aaOnly || u.id === 'transport') return;
      const qty = (battleUnits.def[u.id] || 0);
      if (qty <= 0 || u.defense <= 0) return;
      dice.push({ label: u.name, val: u.defense, qty });
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
  if (atkDiceEl) atkDiceEl.textContent = `${atkTotal} terning${atkTotal !== 1 ? 'er' : ''}`;
  const defDiceEl = document.getElementById('def-total-dice');
  if (defDiceEl) defDiceEl.textContent = `${defTotal} terning${defTotal !== 1 ? 'er' : ''}`;
  const atkExpEl = document.getElementById('atk-expected');
  if (atkExpEl) atkExpEl.textContent = atkExpected.toFixed(1);
  const defExpEl = document.getElementById('def-expected');
  if (defExpEl) defExpEl.textContent = defExpected.toFixed(1);
  const rollBtn = document.getElementById('btnBattleRoll');
  if (rollBtn) rollBtn.disabled = atkTotal === 0 && defTotal === 0;

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

function rollBattle() {
  function rollSide(dice) {
    const rolls = [];
    dice.forEach(d => {
      for (let i = 0; i < d.qty; i++) {
        const r = Math.floor(Math.random() * 6) + 1;
        rolls.push({ roll: r, val: d.val, hit: r <= d.val, label: d.label });
      }
    });
    return rolls;
  }
  const atkRolls = rollSide(calcBattleDice('atk'));
  const defRolls = rollSide(calcBattleDice('def'));
  const atkHits  = atkRolls.filter(r => r.hit).length;
  const defHits  = defRolls.filter(r => r.hit).length;

  function diceHTML(rolls) {
    if (!rolls.length) return '<span style="color:var(--text-muted);font-size:.8rem">Ingen terninger</span>';
    return rolls.map(r =>
      `<div class="br-die${r.hit ? ' hit' : ''}" title="${r.label} ≤${r.val}: ${r.hit ? 'Treff!' : 'Bom'}">${r.roll}</div>`
    ).join('');
  }

  const atkNat  = getBattleNation('atk');
  const defNat  = getBattleNation('def');
  const atkName = atkNat ? `${NATIONS[atkNat].flag} ${NATIONS[atkNat].name}` : 'Angriper';
  const defName = defNat ? `${NATIONS[defNat].flag} ${NATIONS[defNat].name}` : 'Forsvarer';

  const el = document.getElementById('battle-result');
  if (!el) return;
  el.innerHTML = `
    <div class="br-round">
      <div class="br-round-title">🎲 Terningkast</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.3rem">⚔️ ${atkName} (${atkRolls.length} terninger)</div>
      <div class="br-dice-row">${diceHTML(atkRolls)}</div>
      <div class="br-hits-text">Treff: <span class="hit-count">${atkHits}</span>${atkHits > 0 ? ` — ${defName} mister ${atkHits} enhet${atkHits > 1 ? 'er' : ''}` : ' — Ingen treff'}</div>
      <div style="margin-top:.6rem;font-size:.75rem;color:var(--text-muted);margin-bottom:.3rem">🛡️ ${defName} (${defRolls.length} terninger)</div>
      <div class="br-dice-row">${diceHTML(defRolls)}</div>
      <div class="br-hits-text">Treff: <span class="hit-count def">${defHits}</span>${defHits > 0 ? ` — ${atkName} mister ${defHits} enhet${defHits > 1 ? 'er' : ''}` : ' — Ingen treff'}</div>
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
  renderBattle();
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  state = loadState() || defaultState();
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
  // Re-measure after render (turn pill text can change header height)
  requestAnimationFrame(syncHeaderHeight);
});
