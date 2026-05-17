/**
 * FleetIQ PTI Module v0.1.0
 * SRM Labs — Extracted from index.html
 *
 * Handles all Pre-Trip Inspection logic:
 *   - Default checklist items (daily + weekly)
 *   - PTI blocker screen (show/hide)
 *   - Checklist rendering and state tracking
 *   - Progress bar and status badge updates
 *   - PTI submission → ptiLog entry → syncPTIEntry()
 *   - PTI history page rendering (renderPTIPage)
 *   - Custom PTI items (add/remove from Settings)
 *   - PTI enable/disable toggle (Settings)
 *   - needsPTI() — called by boot()
 *   - forcePTI() — called by HTML button
 *
 * Dependencies (globals from index.html):
 *   driver, ptiLog, ptiCustom, saveAll()
 *   syncPTIEntry()   — from sync.js
 *   showApp()        — from index.html
 *   toast()          — from index.html (also Core.toast)
 *   today(), todayDisplay(), escHtml(), getWeekKey() — from index.html
 *
 * index.html must call once after loadAll():
 *   FleetIQPTI.init({
 *     getDriver:    () => driver,
 *     getPtiLog:    () => ptiLog,
 *     setPtiLog:    (v) => { ptiLog = v; },
 *     getPtiCustom: () => ptiCustom,
 *     setPtiCustom: (v) => { ptiCustom = v; },
 *     saveAll:      saveAll,
 *   });
 */

(function (global) {
  'use strict';

  const Core = global.FleetIQCore;
  if (!Core) {
    console.error('[FleetIQ PTI] FleetIQCore not found. Load core.js first.');
    return;
  }

  // ── DEFAULT CHECKLIST ITEMS ───────────────────────────────────────────────
  // Moved here from index.html — these are PTI domain data.

  const DEFAULT_DAILY = [
    { id:'tires',    name:'Tires & Wheels',        desc:'Check pressure, condition, lug nuts' },
    { id:'lights',   name:'Lights',                desc:'Headlights, brake, turn, marker lights' },
    { id:'brakes',   name:'Brakes',                desc:'Air pressure, brake lines, no leaks' },
    { id:'mirrors',  name:'Mirrors & Windows',     desc:'Clean, properly adjusted' },
    { id:'coupling', name:'Coupling & 5th Wheel',  desc:'Kingpin locked, safety latch' },
    { id:'cargo',    name:'Cargo Securement',      desc:'Doors sealed, load secure' },
    { id:'gauges',   name:'Gauges & Warning Lights',desc:'Air pressure, oil, temp normal' },
    { id:'horn',     name:'Horn & Wipers',         desc:'Functional' },
  ];

  const DEFAULT_WEEKLY = [
    { id:'oil',     name:'Engine Oil Level',       desc:'Check and top off if needed' },
    { id:'coolant', name:'Coolant Level',          desc:'Radiator and overflow reservoir' },
    { id:'def',     name:'DEF Level',              desc:'Diesel exhaust fluid' },
    { id:'washer',  name:'Washer Fluid',           desc:'Windshield washer reservoir' },
    { id:'belts',   name:'Belts & Hoses',          desc:'Visual check for wear or cracks' },
    { id:'battery', name:'Battery & Connections',  desc:'Clean terminals, no corrosion' },
  ];

  // ── ACCESSORS ──────────────────────────────────────────────────────────────

  let _get = { driver: null, ptiLog: null, ptiCustom: null };
  let _set = { ptiLog: null, ptiCustom: null };
  let _saveAll = null;
  let _ready = false;

  // Session-only state — does NOT need to persist, reset each PTI session
  let ptiState = {};

  function init(opts) {
    _get.driver    = opts.getDriver;
    _get.ptiLog    = opts.getPtiLog;
    _set.ptiLog    = opts.setPtiLog;
    _get.ptiCustom = opts.getPtiCustom;
    _set.ptiCustom = opts.setPtiCustom;
    _saveAll       = opts.saveAll;
    _ready = true;
    console.info('[FleetIQ PTI] init() complete');
  }

  function assertReady() {
    if (!_ready) {
      console.error('[FleetIQ PTI] Not initialized. Call FleetIQPTI.init() first.');
      return false;
    }
    return true;
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  // Delegate to existing index.html utils (not moved yet)

  function _today()       { return global.today ? global.today() : new Date().toISOString().slice(0,10); }
  function _todayDisplay(){ return global.todayDisplay ? global.todayDisplay() : new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
  function _escHtml(s)    { return global.escHtml ? global.escHtml(s) : String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function _getWeekKey(d) { return global.getWeekKey ? global.getWeekKey(d) : d; }
  function _toast(m,t)    { Core.toast(m, t); }

  // ── CHECKLIST DATA ─────────────────────────────────────────────────────────

  function getAllPtiItems() {
    const custom = _get.ptiCustom().map(x => ({ ...x, custom: true }));
    return {
      daily:  [...DEFAULT_DAILY, ...custom],
      weekly: DEFAULT_WEEKLY,
    };
  }

  // ── NEEDS PTI CHECK ────────────────────────────────────────────────────────
  // Called by boot() in index.html to decide whether to show the blocker.

  function needsPTI() {
    if (!assertReady()) return false;
    const driver = _get.driver();
    const ptiLog = _get.ptiLog();
    if (!driver) return false;
    if (driver.ptiEnabled === false) return false;
    const t = _today();
    if (driver.ptiSchedule === 'daily') {
      return !ptiLog.find(p => p.date === t);
    } else {
      const monKey = _getWeekKey(t);
      return !ptiLog.find(p => _getWeekKey(p.date) === monKey);
    }
  }

  // ── PTI BLOCKER ────────────────────────────────────────────────────────────

  function showPTIBlocker() {
    if (!assertReady()) return;
    const driver = _get.driver();
    document.getElementById('ptiBlocker').classList.add('show');
    document.getElementById('app').classList.remove('show');

    ptiState = {};  // reset session state

    const isMonday   = new Date().getDay() === 1;
    const showWeekly = isMonday || driver.ptiSchedule === 'weekly';

    document.getElementById('ptiDate').textContent = _todayDisplay();
    document.getElementById('ptiWeeklySection').style.display = showWeekly ? '' : 'none';
    document.getElementById('ptiHeaderSub').textContent =
      driver.ptiSchedule === 'daily' ? 'Complete before driving today' :
      (isMonday ? 'Weekly Monday inspection required' : 'Complete before driving');

    const { daily, weekly } = getAllPtiItems();
    renderPTIItems('ptiDailyItems', daily);
    if (showWeekly) renderPTIItems('ptiWeeklyItems', weekly);
    updatePTIProgress(showWeekly);

    Core.events.emit('pti:blocker_shown', { date: _today() });
  }

  // ── CHECKLIST RENDERING ────────────────────────────────────────────────────

  function renderPTIItems(containerId, items) {
    document.getElementById(containerId).innerHTML = items.map(item => `
      <div class="pti-item" id="pti_${item.id}" onclick="togglePTIItem('${item.id}')">
        <div class="pti-check" id="pticheck_${item.id}">○</div>
        <div class="pti-item-text">
          <div class="pti-item-name">${_escHtml(item.name)}</div>
          <div class="pti-item-desc">${_escHtml(item.desc || '')}</div>
        </div>
        <button class="pti-fail-btn" onclick="event.stopPropagation();markFail('${item.id}')">⚠️ Issue</button>
      </div>
    `).join('');
  }

  function togglePTIItem(id) {
    if (ptiState[id] === 'ok') { delete ptiState[id]; }
    else { ptiState[id] = 'ok'; }
    updatePTIItemUI(id);
    updatePTIProgress();
  }

  function markFail(id) {
    ptiState[id] = ptiState[id] === 'fail' ? undefined : 'fail';
    if (!ptiState[id]) delete ptiState[id];
    updatePTIItemUI(id);
    updatePTIProgress();
  }

  function updatePTIItemUI(id) {
    const el  = document.getElementById('pti_' + id);
    const chk = document.getElementById('pticheck_' + id);
    if (!el) return;
    el.classList.remove('checked', 'failed');
    if (ptiState[id] === 'ok')   { el.classList.add('checked'); chk.textContent = '✓'; }
    else if (ptiState[id] === 'fail') { el.classList.add('failed'); chk.textContent = '✕'; }
    else { chk.textContent = '○'; }
  }

  function updatePTIProgress(showWeekly) {
    if (!assertReady()) return;
    const driver   = _get.driver();
    const isMonday = new Date().getDay() === 1;
    const useWeekly = showWeekly !== undefined
      ? showWeekly
      : (isMonday || (driver && driver.ptiSchedule === 'weekly'));

    const { daily, weekly } = getAllPtiItems();
    const allItems = useWeekly ? [...daily, ...weekly] : daily;
    const total   = allItems.length;
    const checked = allItems.filter(x => ptiState[x.id] === 'ok' || ptiState[x.id] === 'fail').length;
    const failed  = allItems.filter(x => ptiState[x.id] === 'fail').length;

    document.getElementById('ptiProgressBar').style.width = total ? (checked / total * 100) + '%' : '0%';
    document.getElementById('ptiProgressText').textContent = `${checked} / ${total} checked`;

    const issueCard = document.getElementById('ptiIssueCard');
    issueCard.classList.toggle('show', failed > 0);

    const badge = document.getElementById('ptiStatusBadge');
    if (checked === total && total > 0) {
      badge.className = 'pti-status-badge ' + (failed > 0 ? 'badge-warn' : 'badge-ok');
      badge.textContent = failed > 0 ? `⚠️ ${failed} Issue(s) Found` : '✅ All Clear';
    } else {
      badge.className = 'pti-status-badge badge-warn';
      badge.textContent = '⏳ In Progress';
    }

    const odoVal = (document.getElementById('ptiOdometer') || { value: '' }).value || '';
    document.getElementById('ptiSubmitBtn').disabled = !(checked === total && total > 0 && odoVal.trim().length > 0);
  }

  // ── SUBMIT PTI ─────────────────────────────────────────────────────────────

  function submitPTI() {
    if (!assertReady()) return;
    const odo = parseInt(document.getElementById('ptiOdometer').value) || 0;
    if (!odo) return _toast('Odometer reading required', 'err');

    const driver    = _get.driver();
    const isMonday  = new Date().getDay() === 1;
    const useWeekly = isMonday || driver.ptiSchedule === 'weekly';
    const { daily, weekly } = getAllPtiItems();
    const allItems  = useWeekly ? [...daily, ...weekly] : daily;
    const failed    = allItems.filter(x => ptiState[x.id] === 'fail');
    const issues    = document.getElementById('ptiIssueText').value.trim();

    const entry = {
      id:        'pti_' + Date.now(),
      date:      _today(),
      odometer:  odo,
      items:     allItems.map(x => ({ id: x.id, name: x.name, state: ptiState[x.id] || 'ok' })),
      issues:    failed.length > 0 ? issues : '',
      passed:    failed.length === 0,
      failCount: failed.length,
      type:      useWeekly ? 'weekly' : 'daily',
    };

    // Write back via setter — updates index.html's let ptiLog
    const ptiLog = _get.ptiLog();
    ptiLog.unshift(entry);
    _set.ptiLog(ptiLog);
    _saveAll();

    _toast(failed.length > 0
      ? `PTI done — ${failed.length} issue(s) reported`
      : 'PTI completed ✅'
    );

    // Fire-and-forget sync
    if (typeof global.syncPTIEntry === 'function') {
      global.syncPTIEntry(entry);
    }

    document.getElementById('ptiBlocker').classList.remove('show');

    Core.events.emit('pti:submitted', {
      date:      entry.date,
      passed:    entry.passed,
      failCount: entry.failCount,
      odometer:  entry.odometer,
    });

    if (typeof global.showApp === 'function') global.showApp();
  }

  // ── FORCE PTI ─────────────────────────────────────────────────────────────
  // Called by "Run PTI Now" button on home page.

  function forcePTI() {
    showPTIBlocker();
  }

  // ── RENDER PTI HISTORY PAGE ────────────────────────────────────────────────
  // Called by showPage('pti') in index.html.

  function renderPTIPage() {
    if (!assertReady()) return;
    const ptiLog = _get.ptiLog();

    document.getElementById('ptiHistory').innerHTML = ptiLog.slice(0, 20).map(p => `
      <div class="pti-history-item">
        <div>
          <div style="font-weight:600">${p.date} <span class="muted">(${p.type || 'daily'})</span></div>
          <div class="muted">${p.failCount ? `⚠️ ${p.failCount} issue(s)` : '✅ All clear'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${(p.odometer || 0).toLocaleString()} mi</div>
          <div class="muted" style="font-size:10px">${p.passed ? 'Passed' : 'Issues'}</div>
        </div>
      </div>
    `).join('') || '<div class="empty">No PTI records</div>';

    // Odometer log
    const odoEntries = ptiLog.filter(p => p.odometer).slice(0, 10);
    document.getElementById('odoLog').innerHTML = odoEntries.length
      ? odoEntries.map((p, i) => {
          const prev = odoEntries[i + 1];
          const diff = prev ? p.odometer - prev.odometer : null;
          return `<div class="line">
            <span>${p.date}</span>
            <span>${p.odometer.toLocaleString()} mi${diff ? ' <span class="muted">(+' + diff.toLocaleString() + ')</span>' : ''}</span>
          </div>`;
        }).join('')
      : '<div class="muted" style="padding:10px">No odometer data</div>';
  }

  // ── CUSTOM PTI ITEMS (Settings) ────────────────────────────────────────────

  function addCustomPtiItem() {
    if (!assertReady()) return;
    const name = document.getElementById('newPtiItem').value.trim();
    if (!name) return _toast('Enter item name', 'err');
    const custom = _get.ptiCustom();
    custom.push({ id: 'c_' + Date.now(), name, desc: 'Custom check' });
    _set.ptiCustom(custom);
    document.getElementById('newPtiItem').value = '';
    _saveAll();
    if (typeof global.renderSettingsPage === 'function') global.renderSettingsPage();
    _toast('Item added');
  }

  function removeCustomPtiItem(i) {
    if (!assertReady()) return;
    const custom = _get.ptiCustom();
    custom.splice(i, 1);
    _set.ptiCustom(custom);
    _saveAll();
    if (typeof global.renderSettingsPage === 'function') global.renderSettingsPage();
    _toast('Removed');
  }

  // ── PTI ENABLE/DISABLE TOGGLE (Settings) ───────────────────────────────────

  function togglePtiSetting() {
    if (!assertReady()) return;
    const driver  = _get.driver();
    const enabled = document.getElementById('setPtiEnabled').checked;
    driver.ptiEnabled = enabled;
    _saveAll();
    updatePtiToggleUI();
    _toast(enabled ? 'PTI enabled' : 'PTI disabled');
  }

  function updatePtiToggleUI() {
    const driver  = _get.driver ? _get.driver() : null;
    const enabled = driver ? driver.ptiEnabled !== false : true;
    const cb      = document.getElementById('setPtiEnabled');
    const slider  = document.getElementById('ptiToggleSlider');
    const knob    = document.getElementById('ptiToggleKnob');
    if (!cb) return;
    cb.checked = enabled;
    if (slider) slider.style.background = enabled ? 'var(--bl)' : 'var(--bd)';
    if (knob)   knob.style.transform    = enabled ? 'translateX(22px)' : 'translateX(0)';
  }

  // ── ODOMETER INPUT LISTENER ────────────────────────────────────────────────
  // Attach after DOM ready — mirrors the inline listener in index.html.

  Core.events.on('core:ready', () => {
    const odoEl = document.getElementById('ptiOdometer');
    if (odoEl) {
      odoEl.addEventListener('input', () => updatePTIProgress());
    }
  });

  // ── PUBLIC API ─────────────────────────────────────────────────────────────

  const FleetIQPTI = {
    version: '0.1.0',
    init,
    // Core lifecycle
    needsPTI,
    showPTIBlocker,
    forcePTI,
    submitPTI,
    // Checklist interaction (called from HTML onclick)
    togglePTIItem,
    markFail,
    updatePTIProgress,
    // Rendering
    renderPTIPage,
    // Settings
    addCustomPtiItem,
    removeCustomPtiItem,
    togglePtiSetting,
    updatePtiToggleUI,
    // Data
    getAllPtiItems,
    DEFAULT_DAILY,
    DEFAULT_WEEKLY,
  };

  global.FleetIQPTI = FleetIQPTI;

  // ── BACKWARD COMPATIBILITY ─────────────────────────────────────────────────
  // All functions called by name from HTML onclicks or index.html
  // continue to work without any changes.

  global.needsPTI           = needsPTI;
  global.showPTIBlocker     = showPTIBlocker;
  global.forcePTI           = forcePTI;
  global.submitPTI          = submitPTI;
  global.togglePTIItem      = togglePTIItem;
  global.markFail           = markFail;
  global.updatePTIProgress  = updatePTIProgress;
  global.updatePTIItemUI    = updatePTIItemUI;
  global.renderPTIPage      = renderPTIPage;
  global.addCustomPtiItem   = addCustomPtiItem;
  global.removeCustomPtiItem = removeCustomPtiItem;
  global.togglePtiSetting   = togglePtiSetting;
  global.updatePtiToggleUI  = updatePtiToggleUI;
  global.getAllPtiItems      = getAllPtiItems;

  console.info('[FleetIQ PTI] v0.1.0 loaded');

})(window);
