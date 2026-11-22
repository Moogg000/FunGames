/*
 * storage.js — tiny, crash-safe wrapper around localStorage.
 *
 * Every key is namespaced with "fungames:" so the site never collides with
 * other data a visitor may have in localStorage. If localStorage is blocked
 * (private mode, restrictive browser settings) we silently fall back to an
 * in-memory map so the games keep working for the current session.
 *
 * Usage:
 *   FunGamesStorage.get("2048:best", 0)
 *   FunGamesStorage.set("2048:best", 2048)
 *   FunGamesStorage.remove("2048:state")
 */
(function (global) {
  'use strict';

  var PREFIX = 'fungames:';

  var memory = new Map();

  var available = (function () {
    try {
      var probe = '__fungames_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  })();

  function namespaced(key) {
    return PREFIX + key;
  }

  function get(key, fallback) {
    var raw = null;
    try {
      raw = available
        ? global.localStorage.getItem(namespaced(key))
        : memory.get(namespaced(key));
    } catch (err) {
      return fallback;
    }
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function set(key, value) {
    var raw;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      return false;
    }
    try {
      if (available) {
        global.localStorage.setItem(namespaced(key), raw);
      } else {
        memory.set(namespaced(key), raw);
      }
      return true;
    } catch (err) {
      // Quota exceeded or storage disabled mid-session: keep the value in
      // memory so the current game does not break.
      memory.set(namespaced(key), raw);
      return false;
    }
  }

  function remove(key) {
    try {
      if (available) global.localStorage.removeItem(namespaced(key));
      memory.delete(namespaced(key));
    } catch (err) {
      /* ignore */
    }
  }

  function clearAll() {
    try {
      if (available) {
        var toRemove = [];
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) toRemove.push(k);
        }
        toRemove.forEach(function (k) {
          global.localStorage.removeItem(k);
        });
      }
      memory.clear();
    } catch (err) {
      /* ignore */
    }
  }

  global.FunGamesStorage = {
    get: get,
    set: set,
    remove: remove,
    clearAll: clearAll,
    isPersistent: function () {
      return available;
    }
  };
})(window);
