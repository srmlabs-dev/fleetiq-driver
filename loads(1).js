/**
 * FleetIQ Loads Module v0.4.0 — FINAL: Export / Reports
 * SRM Labs
 *
 * CHANGELOG v0.4.0:
 *   - getPeriodDates()         — date range for selected period
 *   - getPeriodLabel()         — human-readable period label
 *   - getExportLoads()         — filter loads by selected period
 *   - fmtDateRange()           — format date range string
 *   - fmtDateRangeFromLoads()  — derive date range from load array
 *   - getAccentHex()           — read current accent color for PDF
 *   - csvCell()                — CSV escape helper
 *   - downloadFile()           — trigger browser download
 *   - buildReportText()        — plain text settlement report
 *   - buildReportHTML()        — full HTML/PDF report with logo, KPIs
 *   - exportDriverData(format) — 'csv' or 'pdf'
 *   - shareReport(channel)     — 'whatsapp' | 'email' | 'telegram'
 *
 * All previous functionality (CRUD, Render, Disputes) included unchanged.
 *
 * index.html init (unchanged):
 *   FleetIQLoads.init({
 *     getDriver:  () => driver,
 *     getLoads:   () => loads,
 *     setLoads:   (v) => { loads = v; },
 *     getPtiLog:  () => ptiLog,
 *     saveAll:    saveAll,
 *     doSync:     () => doSync(),
 *     renderAll:  () => renderAll(),
 *     showPage:   (name) => showPage(name),
 *   });
 */

(function (global) {
  'use strict';

  const Core = global.FleetIQCore;
  if (!Core) {
    console.error('[FleetIQ Loads] FleetIQCore not found. Load core.js first.');
    return;
  }

  const K = 'fiqD_';

  // ── ACCESSORS ──────────────────────────────────────────────────────────────

  let _get = { driver: null, loads: null, ptiLog: null };
  let _set = { loads: null };
  let _saveAll   = null;
  let _doSync    = null;
  let _renderAll = null;
  let _showPage  = null;
  let _ready = false;

  function init(opts) {
    _get.driver  = opts.getDriver;
    _get.loads   = opts.getLoads;
    _set.loads   = opts.setLoads;
    _get.ptiLog  = opts.getPtiLog || (() => []);
    _saveAll     = opts.saveAll;
    _doSync      = opts.doSync;
    _renderAll   = opts.renderAll;
    _showPage    = opts.showPage;
    _ready = true;

    Core.events.on('driver:pay_settings_changed', (payload) => {
      const effectiveDate = (payload && payload.effectiveDate) || _today();
      const rates         = (payload && payload.rates) || null;
      const count = recalcLoadsFrom(effectiveDate, rates);
      console.info(`[FleetIQ Loads] Recalculated ${count} load(s) from ${effectiveDate}`);
    });

    Core.events.on('sync:success', () => {
      if (_renderAll) _renderAll();
    });

    document.addEventListener('click', closeAllMenus);
    console.info('[FleetIQ Loads] init() complete');
  }

  function assertReady() {
    if (!_ready) {
      console.error('[FleetIQ Loads] Not initialized. Call FleetIQLoads.init() first.');
      return false;
    }
    return true;
  }

  // ── UTILS ─────────────────────────────────────────────────────────────────

  function _fmt(n)        { return global.fmt       ? global.fmt(n)       : Core.utils.fmt(n); }
  function _today()       { return global.today      ? global.today()      : Core.utils.today(); }
  function _escHtml(s)    { return global.escHtml    ? global.escHtml(s)   : Core.utils.escHtml(s); }
  function _getWeekKey(d) { return global.getWeekKey ? global.getWeekKey(d): d; }
  function _toast(m, t)   { Core.toast(m, t); }

  // ── DISPUTES STORAGE ──────────────────────────────────────────────────────

  function getDriverDisputed() {
    try { return JSON.parse(localStorage.getItem(K + 'disputed') || '[]'); }
    catch(e) { return []; }
  }

  function setDriverDisputed(v) {
    localStorage.setItem(K + 'disputed', JSON.stringify(v));
  }

  // ── PAY CALCULATION ───────────────────────────────────────────────────────

  function calcDriverPay(gross, loadedMiles, totalMiles) {
    const driver = _get.driver ? _get.driver() : null;
    if (!driver) return 0;
    return calcDriverPayWith(gross, loadedMiles, totalMiles, {
      payType: driver.payType, cpmRate: driver.cpmRate,
      grossPercent: driver.grossPercent, cpmBase: driver.cpmBase,
    });
  }

  function calcDriverPayWith(gross, loadedMiles, totalMiles, rates) {
    if (!rates) return 0;
    if (rates.payType === 'gross_percent') return gross * (rates.grossPercent || 0) / 100;
    const miles = rates.cpmBase === 'total' ? totalMiles : loadedMiles;
    return miles * (rates.cpmRate || 0);
  }

  function recalcLoadsFrom(effectiveDate, rates) {
    if (!assertReady()) return 0;
    const driver   = _get.driver();
    const useRates = rates || {
      payType: driver.payType, cpmRate: driver.cpmRate,
      grossPercent: driver.grossPercent, cpmBase: driver.cpmBase,
    };
    let count = 0;
    const updated = _get.loads().map(x => {
      const pickupDate = x.pickup || x.date || '';
      if (pickupDate < effectiveDate) return x;
      count++;
      const newPay = calcDriverPayWith(x.gross, x.loadedMiles, x.totalMiles, useRates)
                   + Number(x.detention || 0) + Number(x.layover || 0);
      return { ...x, driverPay: newPay, synced: false };
    });
    _set.loads(updated);
    _saveAll();
    return count;
  }

  // ── INPUT HELPERS ─────────────────────────────────────────────────────────

  function maskGross(el) {
    const v = el.value.replace(/[^\d]/g, '');
    if (!v) { el.value = ''; return; }
    el.value = (parseInt(v) / 100).toFixed(2);
  }

  function calcPreview() {
    const loaded    = parseFloat(document.getElementById('loadedMiles').value) || 0;
    const dead      = parseFloat(document.getElementById('deadMiles').value)   || 0;
    const gross     = parseFloat(document.getElementById('grossInput').value)  || 0;
    const detention = parseFloat(document.getElementById('detentionPay').value)|| 0;
    const layover   = parseFloat(document.getElementById('layoverPay').value)  || 0;
    const total     = loaded + dead;
    const basePay   = calcDriverPay(gross, loaded, total);
    const pay       = basePay + detention + layover;
    document.getElementById('loadPreview').innerHTML =
      `<div class="line"><span>Total Miles</span><strong>${total.toLocaleString()}</strong></div>
       <div class="line"><span>Base Pay</span><strong>${_fmt(basePay)}</strong></div>
       ${(detention + layover) > 0 ? `<div class="line"><span>Additional Pay</span><strong class="green">+${_fmt(detention + layover)}</strong></div>` : ''}
       <div class="line"><span>My Pay</span><strong class="amber">${_fmt(pay)}</strong></div>
       <div class="line"><span>Pay / total mile</span><strong>${total ? (pay / total).toFixed(3) : '—'}</strong></div>`;
  }

  function getWeekLoads() {
    if (!assertReady()) return [];
    const wk = _getWeekKey(_today());
    return _get.loads().filter(x => _getWeekKey(x.pickup || x.date || '') === wk);
  }

  // ── FORM ──────────────────────────────────────────────────────────────────

  function resetLoadForm() {
    document.getElementById('loadEditId').value        = '';
    document.getElementById('loadId').value            = '';
    document.getElementById('pickupDate').value        = _today();
    document.getElementById('deliveryDate').value      = '';
    document.getElementById('loadedMiles').value       = '';
    document.getElementById('deadMiles').value         = '0';
    document.getElementById('grossInput').value        = '';
    document.getElementById('loadNotes').value         = '';
    document.getElementById('loadPreview').innerHTML   = '';
    document.getElementById('saveLoadBtn').textContent = 'Add Load';
    document.getElementById('cancelEditBtn').style.display = 'none';
    const det = document.getElementById('detentionPay');
    const lay = document.getElementById('layoverPay');
    if (det) det.value = '';
    if (lay) lay.value = '';
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function saveLoad() {
    if (!assertReady()) return;
    const loadId = document.getElementById('loadId').value.trim();
    const loaded = parseFloat(document.getElementById('loadedMiles').value) || 0;
    const gross  = parseFloat(document.getElementById('grossInput').value)  || 0;
    if (!loadId) return _toast('Load ID required', 'err');
    if (!loaded) return _toast('Loaded miles required', 'err');
    if (!gross)  return _toast('Gross required', 'err');
    const dead      = parseFloat(document.getElementById('deadMiles').value)   || 0;
    const detention = parseFloat(document.getElementById('detentionPay').value)|| 0;
    const layover   = parseFloat(document.getElementById('layoverPay').value)  || 0;
    const total     = loaded + dead;
    const pay       = calcDriverPay(gross, loaded, total) + detention + layover;
    const editId    = document.getElementById('loadEditId').value;
    const pickupVal = document.getElementById('pickupDate').value;
    const loads     = _get.loads();
    const driver    = _get.driver();
    if (!editId && loads.find(x => x.loadId === loadId)) return _toast('Load ID already exists', 'err');
    if (!editId) {
      const sameDate = loads.filter(x => x.pickup === pickupVal);
      if (sameDate.length > 0) {
        const ok = confirm(`⚠️ Load(s) already exist for ${pickupVal}:\n` +
          sameDate.map(x => `• ${x.loadId} ($${(x.gross||0).toFixed(2)})`).join('\n') +
          '\n\nAdd another load for this date?');
        if (!ok) return;
      }
    }
    const existingEntry = editId ? loads.find(x => x.id === editId) : null;
    const entry = {
      id: editId || ('l_' + Date.now()), loadId, gross,
      loadedMiles: loaded, deadMiles: dead, totalMiles: total,
      driverPay: pay, detention, layover,
      pickup: pickupVal, delivery: document.getElementById('deliveryDate').value,
      notes: document.getElementById('loadNotes').value.trim(),
      unitNumber: driver.unitNumber, driverName: driver.name,
      status:    (existingEntry && existingEntry.status)    || 'active',
      adjAmount: (existingEntry && existingEntry.adjAmount) || 0,
      synced: false,
    };
    let updated = editId ? loads.map(x => x.id === editId ? entry : x) : [...loads, entry];
    updated.sort((a, b) => {
      const da = a.pickup || '0000', db = b.pickup || '0000';
      return db > da ? 1 : db < da ? -1 : 0;
    });
    _set.loads(updated);
    _saveAll();
    resetLoadForm();
    if (_renderAll) _renderAll();
    _toast('Load saved');
    if (_doSync) _doSync();
    Core.events.emit('load:saved', { id: entry.id, loadId: entry.loadId, isEdit: !!editId });
  }

  function editLoad(id) {
    if (!assertReady()) return;
    const x = _get.loads().find(l => l.id === id);
    if (!x) return;
    document.getElementById('loadEditId').value   = x.id;
    document.getElementById('loadId').value       = x.loadId || '';
    document.getElementById('pickupDate').value   = x.pickup || '';
    document.getElementById('deliveryDate').value = x.delivery || '';
    document.getElementById('loadedMiles').value  = x.loadedMiles || '';
    document.getElementById('deadMiles').value    = x.deadMiles || '0';
    document.getElementById('grossInput').value   = (x.gross || 0).toFixed(2);
    document.getElementById('loadNotes').value    = x.notes || '';
    const det = document.getElementById('detentionPay');
    const lay = document.getElementById('layoverPay');
    if (det) det.value = x.detention ? x.detention.toFixed(2) : '';
    if (lay) lay.value = x.layover   ? x.layover.toFixed(2)   : '';
    document.getElementById('saveLoadBtn').textContent     = 'Save Changes';
    document.getElementById('cancelEditBtn').style.display = 'block';
    calcPreview();
    if (_showPage) _showPage('load');
  }

  function deleteLoad(id) {
    if (!assertReady()) return;
    if (!confirm('Delete this load?')) return;
    _set.loads(_get.loads().filter(x => x.id !== id));
    _saveAll();
    if (_renderAll) _renderAll();
    _toast('Deleted');
    Core.events.emit('load:deleted', { id });
  }

  function setLoadStatus(id, status) {
    if (!assertReady()) return;
    _set.loads(_get.loads().map(x => x.id === id ? { ...x, status, synced: false } : x));
    _saveAll();
    if (_renderAll) _renderAll();
    const labels = { success:'✅ Success', cancel:'❌ Cancelled', active:'🔵 Active', adj:'🔧 Adj' };
    _toast(labels[status] || 'Updated');
    Core.events.emit('load:status_changed', { id, status });
  }

  // ── DISPUTES CRUD ─────────────────────────────────────────────────────────

  function addDriverDisputed() {
    if (!assertReady()) return;
    const loadId = (document.getElementById('dDisputeLoadId').value || '').trim().toUpperCase();
    if (!loadId) return _toast('Load ID required', 'err');
    const amount = parseFloat(document.getElementById('dDisputeAmount').value) || 0;
    const miles  = parseFloat(document.getElementById('dDisputeMiles').value)  || 0;
    const note   = (document.getElementById('dDisputeNote').value || '').trim();
    const existing = getDriverDisputed();
    if (existing.find(d => d.loadId === loadId && d.status === 'pending'))
      return _toast('Dispute already exists for this load', 'err');
    const entry = { id: 'd_' + Date.now(), loadId, amount, miles, note, status: 'pending', createdAt: _today() };
    existing.push(entry);
    setDriverDisputed(existing);
    _set.loads(_get.loads().map(x => x.loadId === loadId ? { ...x, status: 'disputed', synced: false } : x));
    _saveAll();
    document.getElementById('dDisputeLoadId').value = '';
    document.getElementById('dDisputeAmount').value = '';
    document.getElementById('dDisputeMiles').value  = '';
    document.getElementById('dDisputeNote').value   = '';
    if (_renderAll) _renderAll();
    _toast('Dispute added ⚖️');
    Core.events.emit('dispute:added', { loadId, disputeId: entry.id });
  }

  function driverResolveDispute(id, status) {
    if (!assertReady()) return;
    const list    = getDriverDisputed();
    const dispute = list.find(d => d.id === id);
    if (!dispute) return;
    dispute.status     = status;
    dispute.resolvedAt = _today();
    setDriverDisputed(list);
    if (status === 'won') {
      _set.loads(_get.loads().map(x => {
        if (x.loadId !== dispute.loadId) return x;
        const newGross  = dispute.amount || x.gross;
        const newLoaded = dispute.miles  || x.loadedMiles;
        const newTotal  = newLoaded + (x.deadMiles || 0);
        const newPay    = calcDriverPay(newGross, newLoaded, newTotal)
                        + Number(x.detention || 0) + Number(x.layover || 0);
        return { ...x, gross: newGross, loadedMiles: newLoaded, totalMiles: newTotal,
                 driverPay: newPay, adjAmount: newGross, status: 'adj', synced: false };
      }));
      _toast('Dispute won ✅ — load updated');
    } else {
      _set.loads(_get.loads().map(x =>
        x.loadId === dispute.loadId ? { ...x, status: 'cancel', synced: false } : x
      ));
      _toast('Dispute lost ❌ — load cancelled');
    }
    _saveAll();
    if (_renderAll) _renderAll();
    Core.events.emit('dispute:resolved', { id, status, loadId: dispute.loadId });
  }

  function driverReopenDispute(id) {
    const list    = getDriverDisputed();
    const dispute = list.find(d => d.id === id);
    if (!dispute) return;
    dispute.status = 'pending';
    delete dispute.resolvedAt;
    setDriverDisputed(list);
    _set.loads(_get.loads().map(x =>
      x.loadId === dispute.loadId ? { ...x, status: 'disputed', synced: false } : x
    ));
    _saveAll();
    if (_renderAll) _renderAll();
    _toast('Dispute reopened ⚖️');
  }

  function driverDeleteDispute(id) {
    if (!confirm('Delete this dispute?')) return;
    setDriverDisputed(getDriverDisputed().filter(d => d.id !== id));
    if (_renderAll) _renderAll();
    _toast('Dispute deleted');
    Core.events.emit('dispute:deleted', { id });
  }

  function goToDisputeWithLoad(loadId, type) {
    if (_showPage) _showPage('disputes');
    setTimeout(() => {
      const el = document.getElementById('dDisputeLoadId');
      if (el) { el.value = loadId; el.focus(); }
      if (type === 'adj') {
        const load = _get.loads().find(x => x.loadId === loadId);
        if (load) {
          const amtEl  = document.getElementById('dDisputeAmount');
          const noteEl = document.getElementById('dDisputeNote');
          if (amtEl)  amtEl.value  = (load.gross || '').toString();
          if (noteEl) noteEl.value = 'Adjustment';
        }
      }
    }, 50);
  }

  function promptAdj(id) {
    if (!assertReady()) return;
    const load = _get.loads().find(x => x.id === id);
    if (!load) return;
    const input = prompt(`Adjustment amount for ${load.loadId}:\n(actual payment received)`, load.gross || '');
    if (input === null) return;
    const adj = parseFloat(input);
    if (isNaN(adj) || adj < 0) return _toast('Invalid amount', 'err');
    _set.loads(_get.loads().map(x =>
      x.id === id ? { ...x, status: 'adj', adjAmount: adj, synced: false } : x
    ));
    _saveAll();
    if (_renderAll) _renderAll();
    _toast(`Adj set: ${_fmt(adj)}`);
    Core.events.emit('load:status_changed', { id, status: 'adj', adjAmount: adj });
  }

  // ── EXPORT HELPERS ────────────────────────────────────────────────────────

  function getPeriodDates() {
    const t  = _today();
    const p  = (document.getElementById('exportPeriod') || {}).value || 'week';
    const wk = _getWeekKey(t);
    const ym = t.slice(0, 7);
    const yr = t.slice(0, 4);
    if (p === 'custom') {
      return {
        from: (document.getElementById('exportFrom') || {}).value || t,
        to:   (document.getElementById('exportTo')   || {}).value || t,
      };
    }
    if (p === 'week')      return { from: wk, to: t };
    if (p === 'lastweek') {
      const prev = new Date(new Date(wk) - 7 * 86400000);
      const prevKey = prev.toISOString().slice(0, 10);
      const prevEnd = new Date(new Date(wk) - 86400000).toISOString().slice(0, 10);
      return { from: prevKey, to: prevEnd };
    }
    if (p === 'month')     return { from: ym + '-01', to: t };
    if (p === 'lastmonth') {
      const d = new Date(t);
      d.setDate(1); d.setMonth(d.getMonth() - 1);
      const from = d.toISOString().slice(0, 7) + '-01';
      const to   = new Date(new Date(ym + '-01') - 86400000).toISOString().slice(0, 10);
      return { from, to };
    }
    if (p === 'year')      return { from: yr + '-01-01', to: t };
    return { from: '2000-01-01', to: t }; // all
  }

  function getPeriodLabel() {
    const p = (document.getElementById('exportPeriod') || {}).value || 'week';
    const labels = {
      week: 'This Week', lastweek: 'Last Week', month: 'This Month',
      lastmonth: 'Last Month', year: 'This Year', all: 'All Time', custom: 'Custom Range',
    };
    return labels[p] || p;
  }

  function getExportLoads() {
    const { from, to } = getPeriodDates();
    return _get.loads().filter(x => {
      const d = x.pickup || x.date || '';
      return d >= from && d <= to;
    });
  }

  function fmtDateRange(from, to) {
    if (!from && !to) return '';
    const opts = { month: 'short', day: 'numeric' };
    const f = from ? new Date(from + 'T12:00:00').toLocaleDateString('en-US', opts) : '';
    const t = to   ? new Date(to   + 'T12:00:00').toLocaleDateString('en-US', opts) : '';
    return f === t ? f : `${f} – ${t}`;
  }

  function fmtDateRangeFromLoads(rLoads) {
    if (!rLoads.length) return '';
    const dates = rLoads.map(x => x.pickup || x.date || '').filter(Boolean).sort();
    return fmtDateRange(dates[0], dates[dates.length - 1]);
  }

  function getAccentHex() {
    const name = localStorage.getItem('fiqD_accent') || 'blue';
    const map  = { orange:'#f59e0b', blue:'#3b82f6', green:'#10b981', red:'#ef4444', purple:'#8b5cf6', cyan:'#06b6d4' };
    return map[name] || '#3b82f6';
  }

  function csvCell(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadFile(content, type, filename) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── BUILD REPORT TEXT ─────────────────────────────────────────────────────

  function buildReportText() {
    const driver   = _get.driver();
    const rLoads   = getExportLoads();
    const period   = getPeriodLabel();
    const dateRange = fmtDateRangeFromLoads(rLoads);
    const gross    = rLoads.reduce((s, x) => s + Number(x.gross     || 0), 0);
    const pay      = rLoads.reduce((s, x) => s + Number(x.driverPay || 0), 0);
    const lmi      = rLoads.reduce((s, x) => s + Number(x.loadedMiles || 0), 0);
    const dmi      = rLoads.reduce((s, x) => s + Number(x.deadMiles   || 0), 0);
    const det      = rLoads.reduce((s, x) => s + Number(x.detention  || 0), 0);
    const lay      = rLoads.reduce((s, x) => s + Number(x.layover    || 0), 0);
    const tmi      = lmi + dmi;

    let txt = `DRIVER SETTLEMENT REPORT\n`;
    txt += `${'='.repeat(40)}\n`;
    txt += `Driver: ${driver.name || ''}\n`;
    txt += `Truck:  ${driver.truckName || ''} · Unit ${driver.unitNumber || ''}\n`;
    txt += `Period: ${period}${dateRange ? ' (' + dateRange + ')' : ''}\n`;
    txt += `${'='.repeat(40)}\n\n`;
    txt += `SUMMARY\n${'-'.repeat(24)}\n`;
    txt += `Total Loads:    ${rLoads.length}\n`;
    txt += `Gross Revenue:  ${_fmt(gross)}\n`;
    txt += `Driver Pay:     ${_fmt(pay)}\n`;
    txt += `Loaded Miles:   ${lmi.toLocaleString()}\n`;
    txt += `Dead Miles:     ${dmi.toLocaleString()}\n`;
    txt += `Total Miles:    ${tmi.toLocaleString()}\n`;
    if (det > 0) txt += `Detention Pay:  ${_fmt(det)}\n`;
    if (lay > 0) txt += `Layover Pay:    ${_fmt(lay)}\n`;
    if (tmi > 0) {
      txt += `$/Total Mile:   $${(pay / tmi).toFixed(3)}\n`;
      txt += `Gross/Mile:     $${(gross / tmi).toFixed(3)}\n`;
    }
    txt += `\nLOADS\n${'-'.repeat(24)}\n`;
    rLoads.forEach((x, i) => {
      txt += `${i + 1}. ${x.loadId}  ${x.pickup || ''}\n`;
      txt += `   Gross: ${_fmt(x.gross)}  Pay: ${_fmt(x.driverPay)}\n`;
      txt += `   ${(x.loadedMiles || 0).toLocaleString()} loaded + ${(x.deadMiles || 0).toLocaleString()} dead mi\n`;
      if (x.notes) txt += `   Note: ${x.notes}\n`;
    });
    txt += `\n${'='.repeat(40)}\n`;
    txt += `Generated: ${new Date().toLocaleString()}\n`;
    return txt;
  }

  // ── BUILD REPORT HTML (PDF) ───────────────────────────────────────────────

  function buildReportHTML() {
    const driver    = _get.driver();
    const rLoads    = getExportLoads();
    const period    = getPeriodLabel();
    const dateRange = fmtDateRangeFromLoads(rLoads);
    const gross     = rLoads.reduce((s, x) => s + Number(x.gross       || 0), 0);
    const pay       = rLoads.reduce((s, x) => s + Number(x.driverPay   || 0), 0);
    const lmi       = rLoads.reduce((s, x) => s + Number(x.loadedMiles || 0), 0);
    const dmi       = rLoads.reduce((s, x) => s + Number(x.deadMiles   || 0), 0);
    const det       = rLoads.reduce((s, x) => s + Number(x.detention   || 0), 0);
    const lay       = rLoads.reduce((s, x) => s + Number(x.layover     || 0), 0);
    const tmi       = lmi + dmi;
    const acc       = getAccentHex();
    const logo      = localStorage.getItem('fiqD_logo') || '';
    const company   = driver.company || driver.truckName || 'FleetIQ Driver';

    const kpis = [
      { icon: '📦', label: 'Loads',     value: rLoads.length },
      { icon: '💰', label: 'Gross',     value: _fmt(gross) },
      { icon: '💵', label: 'My Pay',    value: _fmt(pay) },
      { icon: '🛣', label: 'Loaded Mi', value: lmi.toLocaleString() },
      { icon: '↩️', label: 'Dead Mi', value: dmi.toLocaleString() },
      { icon: '📊', label: '$/Mi',      value: tmi ? '$' + (pay / tmi).toFixed(3) : '—' },
    ];

    const kpiHTML = kpis.map(k =>
      `<div style="background:#f8fafc;border-radius:8px;padding:10px 12px;text-align:center;flex:1;min-width:80px">
        <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${k.label}</div>
        <div style="font-size:15px;font-weight:800;color:#0f172a">${k.value}</div>
      </div>`
    ).join('');

    const loadsHTML = rLoads.map((x, i) => {
      const statusColor = x.status === 'success' ? '#10b981' : x.status === 'cancel' ? '#ef4444' : x.status === 'adj' ? acc : '#64748b';
      const statusLabel = x.status === 'success' ? '✅ Success' : x.status === 'cancel' ? '❌ Cancelled' : x.status === 'adj' ? `🔧 Adj ${_fmt(x.adjAmount || 0)}` : '🔵 Active';
      const addlPay     = (x.detention || 0) + (x.layover || 0);
      return `<tr style="border-bottom:1px solid #e2e8f0;background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:8px 10px;font-weight:600;font-size:13px">${_escHtml(x.loadId)}<br><span style="font-size:10px;font-weight:400;color:${statusColor}">${statusLabel}</span></td>
        <td style="padding:8px 10px;color:#64748b;font-size:12px">${x.pickup || ''}${x.delivery ? ' → ' + x.delivery : ''}</td>
        <td style="padding:8px 10px;font-size:12px">${(x.loadedMiles || 0).toLocaleString()}<br><span style="color:#94a3b8;font-size:10px">+${(x.deadMiles || 0).toLocaleString()} dead</span></td>
        <td style="padding:8px 10px;font-size:13px;font-weight:600">${_fmt(x.gross)}</td>
        <td style="padding:8px 10px;font-size:13px;font-weight:700;color:${acc}">${_fmt(x.driverPay)}${addlPay > 0 ? `<br><span style="font-size:10px;color:#10b981">+${_fmt(addlPay)}</span>` : ''}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Settlement Report — ${driver.name || ''}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#0f172a;padding:24px;max-width:800px;margin:0 auto}
    @media print{body{padding:0}}
  </style>
</head>
<body>
  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:3px solid ${acc};margin-bottom:20px">
    <div style="display:flex;align-items:center;gap:14px">
      ${logo ? `<img src="${logo}" style="height:52px;width:52px;object-fit:contain;border-radius:8px">` : `<svg viewBox="0 0 160 160" style="width:52px;height:52px;background:${acc};border-radius:8px;padding:6px"><polygon points="80,8 142,44 142,116 80,152 18,116 18,44" fill="none" stroke="white" stroke-width="3"/><line x1="80" y1="8" x2="80" y2="50" stroke="white" stroke-width="2"/><line x1="142" y1="44" x2="110" y2="62" stroke="white" stroke-width="2"/><line x1="18" y1="44" x2="50" y2="62" stroke="white" stroke-width="2"/><line x1="80" y1="152" x2="80" y2="110" stroke="white" stroke-width="2"/><line x1="142" y1="116" x2="110" y2="98" stroke="white" stroke-width="2"/><line x1="18" y1="116" x2="50" y2="98" stroke="white" stroke-width="2"/><polygon points="80,50 110,67 110,101 80,118 50,101 50,67" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/><circle cx="80" cy="84" r="10" fill="white" opacity="0.9"/><line x1="80" y1="94" x2="80" y2="118" stroke="white" stroke-width="2"/></svg>`}
      <div>
        <div style="font-size:20px;font-weight:900;color:#0f172a">${_escHtml(company)}</div>
        <div style="font-size:12px;color:#64748b">Driver Settlement Report</div>
        <div style="font-size:10px;color:${acc};font-weight:700;letter-spacing:1px;margin-top:2px">SRM Labs · FleetIQ</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:13px;font-weight:700;color:${acc}">${period}</div>
      ${dateRange ? `<div style="font-size:11px;color:#64748b">${dateRange}</div>` : ''}
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
    </div>
  </div>

  <!-- SRM gradient line -->
  <div style="height:3px;background:linear-gradient(90deg,transparent,${acc} 20%,#60a5fa 50%,${acc} 80%,transparent);width:100%;margin-bottom:20px"></div>

  <!-- DRIVER INFO -->
  <div style="display:flex;gap:24px;margin-bottom:20px;flex-wrap:wrap">
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Driver</div>
      <div style="font-size:15px;font-weight:700">${_escHtml(driver.name || '')}</div>
    </div>
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Truck</div>
      <div style="font-size:15px;font-weight:700">${_escHtml(driver.truckName || '')} · Unit ${_escHtml(driver.unitNumber || '')}</div>
    </div>
    ${driver.plate ? `<div><div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Plate</div><div style="font-size:15px;font-weight:700">${_escHtml(driver.plate)}</div></div>` : ''}
    <div>
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Pay Type</div>
      <div style="font-size:15px;font-weight:700">${driver.payType === 'gross_percent' ? (driver.grossPercent || 0) + '% Gross' : '$' + (driver.cpmRate || 0) + '/mi CPM'}</div>
    </div>
  </div>

  <!-- KPI PILLS -->
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">${kpiHTML}</div>
  ${det > 0 || lay > 0 ? `
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    ${det > 0 ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 14px;font-size:13px"><span style="color:#64748b">Detention: </span><strong style="color:#10b981">${_fmt(det)}</strong></div>` : ''}
    ${lay > 0 ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 14px;font-size:13px"><span style="color:#64748b">Layover: </span><strong style="color:#10b981">${_fmt(lay)}</strong></div>` : ''}
  </div>` : ''}

  <!-- LOADS TABLE -->
  <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:20px;overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table style="width:100%;border-collapse:collapse;min-width:400px">
      <thead>
        <tr style="background:${acc};color:#fff">
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:700">Load ID</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:700">Dates</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:700">Miles</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:700">Gross</th>
          <th style="padding:10px;text-align:left;font-size:12px;font-weight:700">My Pay</th>
        </tr>
      </thead>
      <tbody>${loadsHTML}</tbody>
      <tfoot>
        <tr style="background:#f1f5f9;font-weight:800">
          <td colspan="3" style="padding:10px;font-size:13px">TOTAL — ${rLoads.length} load${rLoads.length !== 1 ? 's' : ''} · ${tmi.toLocaleString()} mi</td>
          <td style="padding:10px;font-size:14px">${_fmt(gross)}</td>
          <td style="padding:10px;font-size:14px;color:${acc}">${_fmt(pay)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- FOOTER -->
  <div style="text-align:center;font-size:10px;color:#94a3b8;padding-top:12px;border-top:1px solid #e2e8f0">
    Generated by FleetIQ Driver · SRM Labs · ${new Date().toLocaleString()}
  </div>
</body>
</html>`;
  }

  // ── EXPORT & SHARE ────────────────────────────────────────────────────────

  function exportDriverData(format) {
    if (!assertReady()) return;
    const driver  = _get.driver();
    const rLoads  = getExportLoads();
    if (!rLoads.length) return _toast('No loads for selected period', 'err');
    const period  = getPeriodLabel().replace(/\s/g, '_');
    const dateStr = _today();

    if (format === 'csv') {
      const headers = ['Load ID','Pickup','Delivery','Loaded Mi','Dead Mi','Total Mi','Gross','Driver Pay','Detention','Layover','Status','Notes'];
      const rows = rLoads.map(x => [
        x.loadId, x.pickup || '', x.delivery || '',
        x.loadedMiles || 0, x.deadMiles || 0, x.totalMiles || 0,
        (x.gross || 0).toFixed(2), (x.driverPay || 0).toFixed(2),
        (x.detention || 0).toFixed(2), (x.layover || 0).toFixed(2),
        x.status || '', x.notes || '',
      ].map(csvCell).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      downloadFile(csv, 'text/csv', `FleetIQ_${driver.unitNumber || 'driver'}_${period}_${dateStr}.csv`);
      _toast('CSV downloaded 📊');

    } else if (format === 'pdf') {
      const html = buildReportHTML();
      const win  = window.open('', '_blank');
      if (!win) return _toast('Allow popups to generate PDF', 'err');
      win.document.write(html);
      win.document.close();
      setTimeout(() => { win.focus(); win.print(); }, 400);
      _toast('PDF ready — use Print → Save as PDF 📄');
    }
  }

  function shareReport(channel) {
    if (!assertReady()) return;
    const driver  = _get.driver();
    const rLoads  = getExportLoads();
    const period  = getPeriodLabel();
    const gross   = rLoads.reduce((s, x) => s + Number(x.gross     || 0), 0);
    const pay     = rLoads.reduce((s, x) => s + Number(x.driverPay || 0), 0);
    const lmi     = rLoads.reduce((s, x) => s + Number(x.loadedMiles || 0), 0);
    const dateRange = fmtDateRangeFromLoads(rLoads);

    const text = [
      `📋 *Driver Settlement — ${period}*`,
      dateRange ? `📅 ${dateRange}` : '',
      `👤 ${driver.name || ''} · Unit ${driver.unitNumber || ''}`,
      `🚛 ${driver.truckName || ''}`,
      ``,
      `📦 Loads: *${rLoads.length}*`,
      `💰 Gross: *${_fmt(gross)}*`,
      `💵 My Pay: *${_fmt(pay)}*`,
      `🛣 Loaded Miles: *${lmi.toLocaleString()}*`,
      ``,
      `_Generated by FleetIQ Driver_`,
    ].filter(Boolean).join('\n');

    const encoded = encodeURIComponent(text);
    const urls = {
      whatsapp: `https://wa.me/?text=${encoded}`,
      telegram: `https://t.me/share/url?url=&text=${encoded}`,
      email:    `mailto:?subject=${encodeURIComponent('Settlement Report — ' + period)}&body=${encoded}`,
    };

    const url = urls[channel];
    if (url) window.open(url, '_blank');
  }

  // ── STATUS DROPDOWN MENUS ─────────────────────────────────────────────────

  function toggleStatusMenu(e, menuId) {
    e.stopPropagation();
    closeAllMenus();
    const m = document.getElementById(menuId);
    if (!m) return;
    const btn = e.currentTarget, rect = btn.getBoundingClientRect();
    const menuH = 220, spaceBelow = window.innerHeight - rect.bottom, spaceAbove = rect.top;
    m.style.left  = rect.left + 'px';
    m.style.width = Math.max(rect.width, 200) + 'px';
    if (spaceBelow >= menuH || spaceBelow >= spaceAbove) {
      m.style.top = (rect.bottom + 4) + 'px'; m.style.bottom = 'auto';
    } else {
      m.style.top = 'auto'; m.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    }
    m.classList.add('open');
  }

  function closeAllMenus() {
    document.querySelectorAll('.status-menu.open').forEach(m => m.classList.remove('open'));
  }

  // ── RENDER HOME ───────────────────────────────────────────────────────────

  function renderHome() {
    if (!assertReady()) return;
    const loads = _get.loads(), ptiLog = _get.ptiLog(), wkLoads = getWeekLoads();
    const disputedList = getDriverDisputed();
    const pendingIds   = new Set(disputedList.filter(d => d.status === 'pending').map(d => d.loadId));
    const activeLoads   = wkLoads.filter(x => x.status !== 'cancel' && !(x.status === 'disputed' || pendingIds.has(x.loadId)));
    const disputedLoads = wkLoads.filter(x => x.status === 'disputed' || pendingIds.has(x.loadId));
    const gross = activeLoads.reduce((s, x) => s + Number(x.gross     || 0), 0);
    const pay   = activeLoads.reduce((s, x) => s + Number(x.driverPay || 0), 0);
    const lmi   = wkLoads.filter(x => x.status !== 'cancel').reduce((s, x) => s + Number(x.loadedMiles || 0), 0);
    const dmi   = wkLoads.filter(x => x.status !== 'cancel').reduce((s, x) => s + Number(x.deadMiles   || 0), 0);
    const disputedGross = disputedLoads.reduce((s, x) => s + Number(x.gross || 0), 0);
    document.getElementById('homeWeekNet').textContent  = _fmt(pay);
    document.getElementById('homeWeekSub').textContent  = `gross ${_fmt(gross)} · ${(lmi + dmi).toLocaleString()} mi · ${wkLoads.length} loads${disputedGross > 0 ? ' · ⚖️ ' + _fmt(disputedGross) + ' disputed' : ''}`;
    document.getElementById('homeMyPay').textContent    = _fmt(pay);
    document.getElementById('homeGross').textContent    = _fmt(gross);
    document.getElementById('homeLoadedMi').textContent = lmi.toLocaleString();
    document.getElementById('homeDeadMi').textContent   = dmi.toLocaleString();
    document.getElementById('homeLoads').innerHTML = loads.slice(0, 5).map(x => {
      const isDisputed  = x.status === 'disputed' || pendingIds.has(x.loadId);
      const statusColor = x.status === 'success' ? 'var(--gr)' : x.status === 'cancel' ? 'var(--rd)' : x.status === 'adj' ? 'var(--acc)' : isDisputed ? '#f59e0b' : 'var(--mu)';
      const statusLabel = x.status === 'success' ? '✅ Success' : x.status === 'cancel' ? '❌ Cancelled' : x.status === 'adj' ? `🔧 Adj ${_fmt(x.adjAmount || 0)}` : isDisputed ? '⚖️ Disputed' : '🔵 Active';
      const borderColor = isDisputed ? '#f59e0b' : x.status === 'success' ? 'var(--gr)' : x.status === 'cancel' ? 'var(--rd)' : x.status === 'adj' ? 'var(--acc)' : 'var(--bd)';
      const addlPay = (x.detention || 0) + (x.layover || 0);
      return `<div class="item" style="border-left:3px solid ${borderColor}">
        <div class="item-inner">
          <div>
            <div class="item-title">${_escHtml(x.loadId)} <span style="font-size:11px;font-weight:500;color:${statusColor}">${statusLabel}</span></div>
            <div class="muted">${x.pickup || ''}${x.delivery ? ' → ' + x.delivery : ''}</div>
            <div class="muted">${(x.loadedMiles || 0).toLocaleString()} loaded · ${(x.deadMiles || 0).toLocaleString()} dead</div>
            ${addlPay > 0 ? `<div class="muted" style="color:var(--gr);font-size:11px">+${_fmt(addlPay)} additional</div>` : ''}
          </div>
          <div style="text-align:right">
            <div class="item-title" style="color:${isDisputed ? '#f59e0b' : x.status === 'cancel' ? 'var(--rd)' : 'var(--tx)'}">${_fmt(x.gross)}</div>
            <div class="muted amber">${_fmt(x.driverPay)}</div>
            <div class="muted" style="font-size:10px">${x.synced ? '☁️' : '📱'}</div>
          </div>
        </div>
        <div class="item-actions">
          <div class="status-dropdown" style="flex:1">
            <button onclick="toggleStatusMenu(event,'smenu_h_${x.id}')" style="width:100%;color:${statusColor}">⚡ Status ▾</button>
            <div class="status-menu" id="smenu_h_${x.id}">
              <button onclick="setLoadStatus('${x.id}','active');closeAllMenus()">🔵 Active</button>
              <button onclick="setLoadStatus('${x.id}','success');closeAllMenus()" style="color:var(--gr)">✅ Success</button>
              <button onclick="closeAllMenus();goToDisputeWithLoad('${x.loadId}','cancel')" style="color:var(--rd)">❌ Cancel → Dispute</button>
              <button onclick="closeAllMenus();goToDisputeWithLoad('${x.loadId}','adj')" style="color:var(--acc)">🔧 Adj → Dispute</button>
            </div>
          </div>
          <button onclick="editLoad('${x.id}')" style="border-left:1px solid var(--bd)">✏️ Edit</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">No loads this week</div>';
    const todayPTI = ptiLog.find(p => p.date === _today());
    document.getElementById('homePtiStatus').innerHTML = todayPTI
      ? `<div class="line"><span>Today's PTI</span><span class="${todayPTI.passed ? 'green' : 'amber'}">${todayPTI.passed ? '✅ Passed' : '⚠️ Issues noted'}</span></div>
         <div class="line"><span>Odometer</span><span>${(todayPTI.odometer || 0).toLocaleString()} mi</span></div>`
      : `<div style="color:var(--rd);font-weight:700;text-align:center;padding:10px">⚠️ PTI not completed today</div>
         <button onclick="forcePTI()" class="btn primary" style="margin-top:8px;padding:10px">Run PTI Now</button>`;
  }

  // ── RENDER LOAD PAGE ──────────────────────────────────────────────────────

  function renderLoadPage() {
    if (!assertReady()) return;
    const loads = _get.loads();
    const dispIds = new Set(getDriverDisputed().filter(d => d.status === 'pending').map(d => d.loadId));
    document.getElementById('allLoads').innerHTML = loads.map(x => {
      const isDisp = dispIds.has(x.loadId);
      const addlPay = (x.detention || 0) + (x.layover || 0);
      const statusColor = x.status === 'success' ? 'var(--gr)' : x.status === 'cancel' ? 'var(--rd)' : x.status === 'adj' ? 'var(--acc)' : isDisp ? '#f59e0b' : 'var(--bl)';
      const statusBadge = x.status === 'success' ? '<span style="color:var(--gr);font-size:11px">✅ Success</span>'
        : x.status === 'cancel' ? '<span style="color:var(--rd);font-size:11px">❌ Cancelled</span>'
        : x.status === 'adj'    ? `<span style="color:var(--acc);font-size:11px">🔧 Adj ${_fmt(x.adjAmount || 0)}</span>`
        : isDisp                ? '<span style="color:#f59e0b;font-size:11px">⚖️ Disputed</span>'
        :                         '<span style="color:var(--bl);font-size:11px">🔵 Active</span>';
      const borderColor = isDisp ? '#f59e0b' : x.status === 'success' ? 'var(--gr)' : x.status === 'cancel' ? 'var(--rd)' : x.status === 'adj' ? 'var(--acc)' : 'var(--bd)';
      return `<div class="item" style="border-left:3px solid ${borderColor}">
        <div class="item-inner">
          <div>
            <div class="item-title">${_escHtml(x.loadId)} ${statusBadge}</div>
            <div class="muted">${x.pickup || ''} ${x.delivery ? '→ ' + x.delivery : ''}</div>
            <div class="muted">${(x.loadedMiles || 0).toLocaleString()} mi · ${_fmt(x.gross)}</div>
            ${x.detention > 0 ? `<div class="muted" style="font-size:11px;color:var(--gr)">Detention: ${_fmt(x.detention)}</div>` : ''}
            ${x.layover   > 0 ? `<div class="muted" style="font-size:11px;color:var(--gr)">Layover: ${_fmt(x.layover)}</div>`   : ''}
          </div>
          <div style="text-align:right">
            <div class="item-title amber">${_fmt(x.driverPay)}</div>
            ${addlPay > 0 ? `<div class="muted" style="color:var(--gr);font-size:11px">+${_fmt(addlPay)}</div>` : ''}
            <div class="muted">${x.synced ? '☁️ synced' : '📱 local'}</div>
          </div>
        </div>
        <div class="item-actions">
          <div class="status-dropdown" style="flex:1.5">
            <button onclick="toggleStatusMenu(event,'smenu_l_${x.id}')" style="width:100%;color:${statusColor}">⚡ Status ▾</button>
            <div class="status-menu" id="smenu_l_${x.id}">
              <button onclick="setLoadStatus('${x.id}','active');closeAllMenus()">🔵 Active</button>
              <button onclick="setLoadStatus('${x.id}','success');closeAllMenus()" style="color:var(--gr)">✅ Success</button>
              <button onclick="closeAllMenus();goToDisputeWithLoad('${x.loadId}','cancel')" style="color:var(--rd)">❌ Cancel → Dispute</button>
              <button onclick="closeAllMenus();goToDisputeWithLoad('${x.loadId}','adj')" style="color:var(--acc)">🔧 Adj → Dispute</button>
            </div>
          </div>
          <button onclick="editLoad('${x.id}')" style="border-left:1px solid var(--bd)">✏️</button>
          <button onclick="deleteLoad('${x.id}')" style="border-left:1px solid var(--bd);color:var(--rd)">🗑️</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty">No loads yet</div>';
  }

  // ── RENDER STATS ──────────────────────────────────────────────────────────

  function renderStats() {
    if (!assertReady()) return;
    const loads = _get.loads();
    const period = document.getElementById('statsPeriod').value;
    const t = _today();
    let filtered = loads;
    if (period === 'week') {
      const wk = _getWeekKey(t);
      filtered = loads.filter(x => _getWeekKey(x.pickup || x.date || '') === wk);
    } else if (period === 'month') {
      const ym = t.slice(0, 7);
      filtered = loads.filter(x => (x.pickup || '').slice(0, 7) === ym);
    }
    const gross = filtered.reduce((s, x) => s + Number(x.gross       || 0), 0);
    const pay   = filtered.reduce((s, x) => s + Number(x.driverPay   || 0), 0);
    const lmi   = filtered.reduce((s, x) => s + Number(x.loadedMiles || 0), 0);
    const dmi   = filtered.reduce((s, x) => s + Number(x.deadMiles   || 0), 0);
    const tmi   = lmi + dmi;
    document.getElementById('stGross').textContent    = _fmt(gross);
    document.getElementById('stPay').textContent      = _fmt(pay);
    document.getElementById('stLoadedMi').textContent = lmi.toLocaleString();
    document.getElementById('stDeadMi').textContent   = dmi.toLocaleString();
    document.getElementById('stLoads').textContent    = filtered.length;
    document.getElementById('stAvgLoad').textContent  = filtered.length ? _fmt(pay / filtered.length) : '$0';
    document.getElementById('stGpm').textContent      = tmi ? '$' + (gross / tmi).toFixed(2) : '$0';
    document.getElementById('stPpm').textContent      = tmi ? '$' + (pay   / tmi).toFixed(2) : '$0';
    const wkMap = {};
    loads.forEach(x => {
      const wk = _getWeekKey(x.pickup || x.date || '');
      if (!wk) return;
      if (!wkMap[wk]) wkMap[wk] = { gross: 0, pay: 0, loads: 0, lmi: 0 };
      wkMap[wk].gross += Number(x.gross       || 0);
      wkMap[wk].pay   += Number(x.driverPay   || 0);
      wkMap[wk].loads += 1;
      wkMap[wk].lmi   += Number(x.loadedMiles || 0);
    });
    const wks = Object.keys(wkMap).sort().reverse().slice(0, 8);
    document.getElementById('weeklyBreakdown').innerHTML = wks.map(wk => `
      <div class="line">
        <span><strong>Wk ${wk}</strong><br><span class="muted">${wkMap[wk].loads} loads · ${wkMap[wk].lmi.toLocaleString()} mi</span></span>
        <span style="text-align:right"><strong>${_fmt(wkMap[wk].pay)}</strong><br><span class="muted">gross ${_fmt(wkMap[wk].gross)}</span></span>
      </div>`).join('') || '<div class="muted" style="padding:10px">No data</div>';
  }

  // ── RENDER DISPUTES PAGE ──────────────────────────────────────────────────

  function renderDriverDisputedPage() {
    const list = getDriverDisputed();
    const el   = document.getElementById('driverDisputedList');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="empty">No disputes</div>'; return; }
    el.innerHTML = list.slice().reverse().map(d => {
      const isPending   = d.status === 'pending';
      const isWon       = d.status === 'won';
      const statusColor = isPending ? '#f59e0b' : isWon ? 'var(--gr)' : 'var(--rd)';
      const statusLabel = isPending ? '⚖️ Pending' : isWon ? '✅ Won' : '❌ Lost';
      return `<div class="item" style="border-left:3px solid ${statusColor};margin-bottom:8px">
        <div class="item-inner">
          <div>
            <div class="item-title">${_escHtml(d.loadId)} <span style="font-size:11px;color:${statusColor}">${statusLabel}</span></div>
            <div class="muted">${d.createdAt || ''}${d.note ? ' · ' + _escHtml(d.note) : ''}</div>
            ${d.amount ? `<div class="muted">Amount: <strong>${_fmt(d.amount)}</strong></div>` : ''}
            ${d.miles  ? `<div class="muted">Miles: <strong>${d.miles.toLocaleString()}</strong></div>` : ''}
          </div>
          <div style="text-align:right;font-size:11px;color:var(--mu)">${d.resolvedAt ? 'Resolved ' + d.resolvedAt : ''}</div>
        </div>
        <div class="item-actions">
          ${isPending
            ? `<button onclick="driverResolveDispute('${d.id}','won')"  style="color:var(--gr);flex:1">✅ Won</button>
               <button onclick="driverResolveDispute('${d.id}','lost')" style="color:var(--rd);flex:1;border-left:1px solid var(--bd)">❌ Lost</button>`
            : `<button onclick="driverReopenDispute('${d.id}')" style="flex:1">↩️ Reopen</button>`}
          <button onclick="driverDeleteDispute('${d.id}')" style="color:var(--rd);border-left:1px solid var(--bd)">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────

  const FleetIQLoads = {
    version: '0.4.0',
    init,
    calcDriverPay, calcDriverPayWith, recalcLoadsFrom,
    maskGross, calcPreview, getWeekLoads,
    saveLoad, editLoad, deleteLoad, resetLoadForm, setLoadStatus,
    toggleStatusMenu, closeAllMenus,
    getDriverDisputed, setDriverDisputed,
    addDriverDisputed, driverResolveDispute, driverReopenDispute,
    driverDeleteDispute, renderDriverDisputedPage, goToDisputeWithLoad, promptAdj,
    getPeriodDates, getPeriodLabel, getExportLoads,
    fmtDateRange, fmtDateRangeFromLoads, getAccentHex,
    csvCell, downloadFile,
    buildReportText, buildReportHTML,
    exportDriverData, shareReport,
    renderHome, renderLoadPage, renderStats,
  };

  global.FleetIQLoads = FleetIQLoads;

  // ── BACKWARD COMPATIBILITY ─────────────────────────────────────────────────

  global.calcDriverPay            = calcDriverPay;
  global.maskGross                = maskGross;
  global.calcPreview              = calcPreview;
  global.getWeekLoads             = getWeekLoads;
  global.saveLoad                 = saveLoad;
  global.editLoad                 = editLoad;
  global.deleteLoad               = deleteLoad;
  global.resetLoadForm            = resetLoadForm;
  global.setLoadStatus            = setLoadStatus;
  global.toggleStatusMenu         = toggleStatusMenu;
  global.closeAllMenus            = closeAllMenus;
  global.recalcLoadsFrom          = recalcLoadsFrom;
  global.getDriverDisputed        = getDriverDisputed;
  global.setDriverDisputed        = setDriverDisputed;
  global.addDriverDisputed        = addDriverDisputed;
  global.driverResolveDispute     = driverResolveDispute;
  global.driverReopenDispute      = driverReopenDispute;
  global.driverDeleteDispute      = driverDeleteDispute;
  global.renderDriverDisputedPage = renderDriverDisputedPage;
  global.goToDisputeWithLoad      = goToDisputeWithLoad;
  global.promptAdj                = promptAdj;
  global.renderHome               = renderHome;
  global.renderLoadPage           = renderLoadPage;
  global.renderStats              = renderStats;
  global.exportDriverData         = exportDriverData;
  global.shareReport              = shareReport;
  global.buildReportHTML          = buildReportHTML;
  global.buildReportText          = buildReportText;
  global.csvCell                  = csvCell;
  global.downloadFile             = downloadFile;
  global.getAccentHex             = getAccentHex;
  global.getExportLoads           = getExportLoads;
  global.getPeriodLabel           = getPeriodLabel;

  console.info('[FleetIQ Loads] v0.4.0 loaded');

})(window);
