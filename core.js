/**
 * FleetIQ Core v0.1.0
 * SRM Labs — Foundation layer for modular architecture
 *
 * Provides:
 *   Core.storage  — localStorage wrapper
 *   Core.events   — lightweight event bus
 *   Core.toast    — notification utility
 *   Core.utils    — shared helpers
 *
 * Does NOT:
 *   - Move any business logic
 *   - Change any UI behavior
 *   - Break existing index.html functions
 *
 * Exposed as window.FleetIQCore for compatibility.
 */

(function (global) {
  'use strict';

  // ── STORAGE ──────────────────────────────────────────────────────────────
  // Thin wrapper around localStorage.
  // Existing code still uses localStorage directly — that's fine.
  // New modules should use Core.storage instead.

  const storage = {
    /**
     * Get a value from localStorage.
     * @param {string} key
     * @param {*} fallback — returned if key is missing or parse fails
     * @returns parsed value or fallback
     */
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw !== null ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn('[FleetIQ Core] storage.get error:', key, e);
        return fallback;
      }
    },

    /**
     * Set a value in localStorage.
     * @param {string} key
     * @param {*} value — will be JSON.stringify'd
     * @returns true on success, false on failure
     */
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('[FleetIQ Core] storage.set error:', key, e);
        return false;
      }
    },

    /**
     * Remove a key from localStorage.
     * @param {string} key
     */
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('[FleetIQ Core] storage.remove error:', key, e);
      }
    },
  };

  // ── EVENTS ───────────────────────────────────────────────────────────────
  // Simple pub/sub event bus.
  // Modules communicate through events, not direct function calls.
  //
  // Usage:
  //   Core.events.on('load:saved', (data) => { ... })
  //   Core.events.emit('load:saved', { loadId: 'ABC123' })

  const _listeners = {};

  const events = {
    /**
     * Register a handler for an event.
     * @param {string} event
     * @param {function} handler
     */
    on(event, handler) {
      if (typeof handler !== 'function') {
        console.warn('[FleetIQ Core] events.on: handler must be a function');
        return;
      }
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(handler);
    },

    /**
     * Remove a previously registered handler.
     * @param {string} event
     * @param {function} handler
     */
    off(event, handler) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(h => h !== handler);
    },

    /**
     * Emit an event, calling all registered handlers.
     * Handlers are called synchronously in registration order.
     * Errors in handlers are caught and logged — one bad handler won't break others.
     * @param {string} event
     * @param {*} payload
     */
    emit(event, payload) {
      if (!_listeners[event]) return;
      _listeners[event].forEach(handler => {
        try {
          handler(payload);
        } catch (e) {
          console.error('[FleetIQ Core] events.emit handler error:', event, e);
        }
      });
    },

    /**
     * Register a one-time handler that auto-removes after first call.
     * @param {string} event
     * @param {function} handler
     */
    once(event, handler) {
      const wrapper = (payload) => {
        handler(payload);
        this.off(event, wrapper);
      };
      this.on(event, wrapper);
    },
  };

  // ── TOAST ─────────────────────────────────────────────────────────────────
  // Delegates to the existing toast() function in index.html.
  // When toast() is eventually extracted to Core fully, callers won't change.

  const toast = function (message, type = '') {
    // Use existing global toast() if available
    if (typeof global.toast === 'function') {
      global.toast(message, type);
    } else {
      // Fallback: basic console log if called before DOM is ready
      console.info('[FleetIQ Toast]', type ? `[${type}]` : '', message);
    }
  };

  // ── UTILS ─────────────────────────────────────────────────────────────────
  // Mirrors of existing utility functions.
  // Existing code still calls fmt(), today(), etc. directly — that's fine.
  // New modules should use Core.utils instead.

  const utils = {
    /**
     * Format a number as USD currency.
     * Mirrors existing fmt() in index.html.
     */
    fmt(n) {
      return '$' + (Number(n) || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },

    /**
     * Today's date as YYYY-MM-DD string.
     * Mirrors existing today() in index.html.
     */
    today() {
      return new Date().toISOString().slice(0, 10);
    },

    /**
     * Today's date as human-readable string (e.g. "Sat, May 16").
     * Mirrors existing todayDisplay() in index.html.
     */
    todayDisplay() {
      return new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    },

    /**
     * Escape HTML special characters to prevent XSS.
     * Mirrors existing escHtml() in index.html.
     */
    escHtml(s) {
      return String(s || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;',
      }[m]));
    },

    /**
     * Generate a simple unique ID with optional prefix.
     * @param {string} prefix
     * @returns {string} e.g. "l_1747392000000"
     */
    uid(prefix = 'id') {
      return `${prefix}_${Date.now()}`;
    },
  };

  // ── CORE OBJECT ───────────────────────────────────────────────────────────

  const Core = {
    version: '0.1.0',
    storage,
    events,
    toast,
    utils,
  };

  // ── EXPOSE GLOBALLY ───────────────────────────────────────────────────────
  // Available as both window.FleetIQCore (explicit) and window.Core (shorthand).
  // index.html can use either.

  global.FleetIQCore = Core;
  global.Core = Core;

  // Emit a ready event so modules loaded after core.js can react
  // (useful for future async module loading)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      Core.events.emit('core:ready', { version: Core.version });
    });
  } else {
    // DOM already loaded
    setTimeout(() => Core.events.emit('core:ready', { version: Core.version }), 0);
  }

  console.info(`[FleetIQ Core] v${Core.version} loaded`);

})(window);
