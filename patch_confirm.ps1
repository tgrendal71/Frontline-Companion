$f = "data\app.js"
$c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)

$start = $c.IndexOf("function confirmPurchase(tid) {")
# Find the closing brace followed by a blank line
$end = $c.IndexOf("`n}`n`n", $start + 100) + 2
Write-Host "Replacing chars $start to $end (len $($end - $start))"

$newFunc = @"
function confirmPurchase(tid) {
  const cart = purchaseCart[tid] || {};
  const ns   = state.nations[tid];
  const placements = buildPlacements[tid] || {};
  const items = [];
  let totalCost = 0;
  const repairCount = repairTokens[tid] || 0;

  // Validate building placements before anything else
  const buildingUnits = UNITS.filter(u => u.type === 'building');
  for (const unit of buildingUnits) {
    const qty = cart[unit.id] || 0;
    if (qty === 0) continue;
    const terrId = placements[unit.id];
    if (!terrId) {
      toast(`Velg et territorium for ${'${unit.name}'} before du bekrefter.`, 'error');
      return;
    }
    const terr = TERRITORIES.find(t => t.id === terrId);
    if (unit.id === 'minor_ic' || unit.id === 'major_ic') {
      const minIpc = unit.id === 'major_ic' ? 3 : 2;
      if (!terr || terr.ipc < minIpc) {
        toast(`${'${unit.name}'} krever territorium med minst ${'${minIpc}'} IPC.`, 'error');
        return;
      }
      if (getFacility(terrId).ic) {
        toast(`${'${terr?.name ?? terrId}'} har allerede en fabrikk.`, 'error');
        return;
      }
    } else {
      const key = unit.id === 'air_base' ? 'airBase' : 'navalBase';
      if (getFacility(terrId)[key]) {
        toast(`${'${terr?.name ?? terrId}'} har allerede en ${'${unit.name.toLowerCase()}'}.`, 'error');
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
  totalCost += repairCount;
  if (!items.length && repairCount === 0) { toast('Handlekurven er tom!', 'error'); return; }
  if (totalCost > ns.treasury) {
    toast(`Ikke nok IPC! Trenger ${'${totalCost}'} IPC, har ${'${ns.treasury}'} IPC.`, 'error');
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

  state.purchaseLogs.push({
    round: state.round, nationId: tid, items, totalCost,
    date:  new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }),
  });
  purchaseCart[tid] = {};
  buildPlacements[tid] = {};
  repairTokens[tid] = 0;
  // Mark Fase 1 as completed
  if (!state.turnPhases)       state.turnPhases = {};
  if (!state.turnPhases[tid])  state.turnPhases[tid] = [];
  if (!state.turnPhases[tid].includes('p1')) state.turnPhases[tid].push('p1');
  saveState();
  const tVal = document.getElementById(`nc-treasury-${'${tid}'}`);
  if (tVal) tVal.textContent = ns.treasury;
  updateIncomeDisplay(tid);
  updateIncomeAdjVisibility(tid);
  updatePurchaseDisplay(tid);
  renderPhaseTracker();
  renderTurnStrip();
  updateNationPhaseTracker(tid);
  updateNationCardDoneState(tid);
  const pastEl = document.getElementById(`pc-past-${'${tid}'}`);
  if (pastEl) pastEl.innerHTML = buildPastPurchasesHTML(tid);
  const purchaseNames = items.map(it => `${'${it.qty}'}\u00d7 ${'${it.name}'}`).join(', ');
  const repairNote = repairCount > 0 ? `${'${purchaseNames ? \', \' : \'\'}'} reparert ${'${repairCount}'} skade` : '';
  toast(`${'${NATIONS[tid].flag}'} Fase 1 fullfort -- ${'${purchaseNames}'}${'${repairNote}'} for ${'${totalCost}'} IPC. Skattkammer: ${'${ns.treasury}'} IPC.`, 'success');
}
"@

Write-Host "This approach is getting complex. Aborting ps1 patch approach."
