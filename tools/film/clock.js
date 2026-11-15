/* Astro Outpost film — a clock that only moves when the recorder says so.
   This script is put into the page before any of the game's own scripts. It replaces the browser's timers,
   animation frames and clocks with ones that stand still until __clock.tick(ms) is called. The recorder
   then moves time on by exactly one frame, takes a picture, and repeats, so the film is perfectly smooth
   however slow the computer is. CSS animations are stepped the same way. */
(function () {
  'use strict';
  if (window.__clock) return;
  var realSet = window.setTimeout.bind(window), realNow = performance.now.bind(performance);
  var vt = 0, base = Date.now(), timers = {}, tid = 100000, rafs = [], rid = 0, errors = [];
  function fail(e) { errors.push(String(e && e.stack || e).slice(0, 400)); }

  window.setTimeout = function (fn, ms) {
    var id = ++tid; timers[id] = { at: vt + Math.max(0, +ms || 0), fn: fn, args: Array.prototype.slice.call(arguments, 2), every: 0 }; return id;
  };
  window.setInterval = function (fn, ms) {
    var id = ++tid, e = Math.max(1, +ms || 0); timers[id] = { at: vt + e, fn: fn, args: Array.prototype.slice.call(arguments, 2), every: e }; return id;
  };
  window.clearTimeout = window.clearInterval = function (id) { delete timers[id]; };
  window.requestAnimationFrame = function (fn) { var id = ++rid; rafs.push({ id: id, fn: fn }); return id; };
  window.cancelAnimationFrame = function (id) { rafs = rafs.filter(function (r) { return r.id !== id; }); };
  performance.now = function () { return vt; };
  Date.now = function () { return base + vt; };

  function runTimers(end) {
    for (var guard = 0; guard < 5000; guard++) {
      var best = null, k;
      for (k in timers) if (timers[k].at <= end && (!best || timers[k].at < timers[best].at)) best = k;
      if (!best) return;
      var t = timers[best];
      if (t.at > vt) vt = t.at;
      if (t.every) t.at += t.every; else delete timers[best];
      if (typeof t.fn === 'function') { try { t.fn.apply(window, t.args); } catch (e) { fail(e); } }
    }
  }
  function stepAnimations(ms) {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function (a) {
      try {
        if (a.playState === 'finished' || a.playState === 'idle') return;
        a.pause();
        var end = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().endTime : Infinity, t = (a.currentTime || 0) + ms;
        if (t >= end) a.finish(); else a.currentTime = t;
      } catch (e) { /* an animation that went away */ }
    });
  }
  window.__clock = {
    real: { setTimeout: realSet, now: realNow },
    now: function () { return vt; },
    errors: errors,
    // move time on: timers first, then one animation frame, then the CSS animations
    tick: function (ms) {
      var end = vt + ms;
      runTimers(end);
      vt = end;
      var list = rafs; rafs = [];
      for (var i = 0; i < list.length; i++) { try { list[i].fn(vt); } catch (e) { fail(e); } }
      stepAnimations(ms);
    },
    sleep: function (ms) { return new Promise(function (r) { realSet(r, ms); }); }     // real waiting, for loading
  };
  window.addEventListener('error', function (e) { errors.push(String(e.message) + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno); });
})();
