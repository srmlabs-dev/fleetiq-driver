/**
 * FleetIQ Sync Module v0.1.1
 * SRM Labs — Extracted from index.html
 *
 * FIX v0.1.1: index.html declares driver/loads/ptiLog with `let`,
 * so they are NOT on window.*. Worse — loads and ptiLog are frequently
 * reassigned (loads = loads.map(...)), so a one-time window reference
 * would go stale immediately.
 *
 * Solution: accessor functions passed in via FleetIQSync.init().
 * index.html calls init() once after boot, providing getters/setters
 * and saveAll. sync.js never touches window.* for state.
 *
 * index.html must call once after loadAll():
 *   FleetIQSync.init({
 *     getDriver: () => driver,
 *     getLoads:  () => loads,
 *     setLoads:  (v) => { loads = v; },
 *     getPtiLog: () => ptiLog,
 *     setPtiLog: (v) => { ptiLog = v; },
 *     saveAll:   saveAll,
 *     getTimer:  () => autoSyncTimer,
 *     setTimer:  (v) => { autoSyncTimer = v; },
 *   });
 */

(function (global) {
  'use strict';

  const Core = global.FleetIQCore;

  if (!Core) {
    console.error('[FleetIQ Sync] FleetIQCore not found. Load core.js first.');
    return;
  }

  // ── ACCESSORS ──────────────────────────────────────────────────────────────
  // Filled by init(). All sync functions go through these — never direct refs.

  let _get = {
    driver: null,
    loads:  null,
    ptiLog: null,
    timer:  null,
  };
  let _set = {
    loads:  null,
    ptiLog: null,
    timer:  null,
  };
  let _saveAll = null;
  let _ready = false;

  function init(opts) {
    _get.driver = opts.getDriver;
    _get.loads  = opts.getLoads;
    _set.loads  = opts.setLoads;
    _get.ptiLog = opts.getPtiLog;
    _set.ptiLog = opts.setPtiLog;
    _saveAll    = opts.saveAll;
    _get.timer  = opts.getTimer;
    _set.timer  = opts.setTimer;
    _ready = true;
    console.info('[FleetIQ Sync] init() complete');
  }

  function assertReady() {
    if (!_ready) {
      console.error('[FleetIQ Sync] Not initialized. Call FleetIQSync.init() first.');
      return false;
    }
    return true;
  }

  // ── PAYLOAD BUILDER ────────────────────────────────────────────────────────

  function buildSyncPayload() {
    if (!assertReady()) return null;
    const driver = _get.driver();
    const loads  = _get.loads();
    const ptiLog = _get.ptiLog();
    return {
      type: 'driver_report',
      sentAt: new Date().toISOString(),
      driver: {
        name: driver.name,
        unitNumber: driver.unitNumber,
      },
      loads:  loads.filter(x => !x.synced),
      ptiLog: ptiLog.filter(p => !p.synced).slice(0, 10),
    };
  }

  // ── SYNC UI ────────────────────────────────────────────────────────────────

  function setSyncUI(state, msg) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncStatus');
    if (!dot || !txt) return;
    dot.className = 'sync-dot' +
      (state === 'ok'   ? ' ok'   :
       state === 'err'  ? ' err'  :
       state === 'busy' ? ' busy' : '');
    txt.textContent = msg;
  }

  // ── MAIN SYNC ──────────────────────────────────────────────────────────────

  async function doSync() {
    if (!assertReady()) return;
    const driver = _get.driver();

    if (!(driver && driver.syncUrl)) {
      setSyncUI('idle', 'No sync URL');
      return;
    }

    setSyncUI('busy', 'Syncing...');
    Core.events.emit('sync:start', null);

    try {
      const payload = buildSyncPayload();

      if ((payload.loads.length + payload.ptiLog.length) === 0) {
        setSyncUI('ok', 'Nothing to sync');
        Core.events.emit('sync:skip', { reason: 'nothing_to_sync' });
        return;
      }

      const syncedLoadIds = new Set(payload.loads.map(x => x.id));
      const syncedPtiIds  = new Set(payload.ptiLog.map(x => x.id));

      const resp = await fetch(driver.syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const text = await resp.text();
      let result = {};
      try { result = JSON.parse(text); } catch (e) {}
      if (result.error) throw new Error(result.error);

      // Write back via setters — updates index.html's let variables
      _set.loads(_get.loads().map(x =>
        syncedLoadIds.has(x.id) ? { ...x, synced: true } : x
      ));
      _set.ptiLog(_get.ptiLog().map(p =>
        syncedPtiIds.has(p.id) ? { ...p, synced: true } : p
      ));

      _saveAll();

      const timeStr = new Date().toLocaleTimeString();
      setSyncUI('ok', 'Synced ' + timeStr);
      Core.toast('Synced ✅');
      Core.events.emit('sync:success', {
        loadsCount: syncedLoadIds.size,
        ptiCount:   syncedPtiIds.size,
        time:       timeStr,
      });

    } catch (e) {
      setSyncUI('err', 'Failed: ' + e.message);
      Core.toast('Sync failed: ' + e.message, 'err');
      Core.events.emit('sync:error', { message: e.message });
    }
  }

  // ── PTI SINGLE ENTRY SYNC ─────────────────────────────────────────────────

  async function syncPTIEntry(entry) {
    if (!assertReady()) return;
    const driver = _get.driver();
    if (!(driver && driver.syncUrl)) return;

    try {
      await fetch(driver.syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'pti_report',
          sentAt: new Date().toISOString(),
          driver: {
            name: driver.name,
            unitNumber: driver.unitNumber,
          },
          pti: entry,
        }),
        redirect: 'follow',
      });
      entry.synced = true;
      _saveAll();
      Core.events.emit('sync:pti_sent', { entryId: entry.id });
    } catch (e) {
      console.warn('[FleetIQ Sync] syncPTIEntry silent fail:', e.message);
    }
  }

  // ── AUTO SYNC SCHEDULER ────────────────────────────────────────────────────

  function scheduleAutoSync() {
    if (!assertReady()) return;
    clearInterval(_get.timer());
    _set.timer(setInterval(() => doSync(), 6 * 60 * 60 * 1000));

    const now = new Date();
    const msToMidnight = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + 1
    ) - now;

    setTimeout(() => {
      doSync();
      scheduleAutoSync();
    }, msToMidnight);
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────

  const FleetIQSync = {
    version: '0.1.1',
    init,
    buildSyncPayload,
    doSync,
    syncPTIEntry,
    setSyncUI,
    scheduleAutoSync,
  };

  global.FleetIQSync = FleetIQSync;

  // Backward compat — index.html calls these by name directly
  global.doSync           = doSync;
  global.syncPTIEntry     = syncPTIEntry;
  global.setSyncUI        = setSyncUI;
  global.scheduleAutoSync = scheduleAutoSync;
  global.buildSyncPayload = buildSyncPayload;

  console.info('[FleetIQ Sync] v0.1.1 loaded');

})(window);
