/* Astro Outpost — real space weather.
   Loads real solar flares from NASA DONKI (live, last 30 days) or from the embedded
   NASA archive (22 Apr – 20 May 2024), and maps one real day onto each mission day. */
(function (JA) {
  'use strict';

  var DONKI_URL = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR';
  var DAY = 86400000;

  function iso(d) { return d.toISOString().slice(0, 10); }

  function slim(list) {
    return list
      .filter(function (f) { return f.classType && f.peakTime; })
      .map(function (f) { return { t: f.peakTime, c: f.classType, ar: f.activeRegionNum, link: f.link }; });
  }

  // Flare class -> game storm. Level: 0 calm · 1 small (M1–M4.9) · 2 medium (M5–M9.9) · 3 big (X).
  function classify(cls) {
    if (!cls) return { level: 0, strength: 0 };
    var letter = cls.charAt(0).toUpperCase();
    var num = parseFloat(cls.slice(1)) || 1;
    if (letter === 'X') return { level: 3, strength: Math.round(20 + Math.min(10, num)) };
    if (letter === 'M' && num >= 5) return { level: 2, strength: 12 };
    if (letter === 'M') return { level: 1, strength: 6 };
    return { level: 0, strength: 0 };
  }

  function rank(cls) {
    var order = 'ABCMX'.indexOf(cls.charAt(0).toUpperCase());
    return order * 100 + (parseFloat(cls.slice(1)) || 0);
  }

  function archive() {
    var a = window.JA_ARCHIVE_FLARES;
    return { source: 'archive', start: a.start, end: a.end, flares: a.flares, downloaded: a.downloaded };
  }

  // Returns a promise of { source: 'live'|'archive', start, end, flares, fallback? }
  function load(mode) {
    if (mode !== 'live') return Promise.resolve(archive());
    var end = new Date();
    var start = new Date(end.getTime() - 30 * DAY);
    var key = 'ja-donki-' + iso(end);
    try {
      var cached = sessionStorage.getItem(key);
      if (cached) return Promise.resolve(JSON.parse(cached));
    } catch (e) { /* storage may be blocked */ }

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    var url = DONKI_URL + '?startDate=' + iso(start) + '&endDate=' + iso(end);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (list) {
        clearTimeout(timer);
        var data = { source: 'live', start: iso(start), end: iso(end), flares: slim(list || []), fetchedAt: new Date().toISOString() };
        try { sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* ignore */ }
        return data;
      })
      .catch(function () {
        clearTimeout(timer);
        var a = archive();
        a.fallback = true;   // UI must say clearly that this is NOT live data
        return a;
      });
  }

  // One entry per real calendar day in the data range.
  function byDay(data) {
    var days = [];
    var t0 = Date.parse(data.start + 'T00:00:00Z');
    var t1 = Date.parse(data.end + 'T00:00:00Z');
    var index = {};
    for (var t = t0; t <= t1; t += DAY) {
      var d = { date: iso(new Date(t)), cls: null, level: 0, strength: 0, link: null, time: null, count: 0 };
      index[d.date] = d;
      days.push(d);
    }
    data.flares.forEach(function (f) {
      var d = index[f.t.slice(0, 10)];
      if (!d) return;
      d.count++;
      if (!d.cls || rank(f.c) > rank(d.cls)) {
        d.cls = f.c; d.link = f.link; d.time = f.t.slice(11, 16);
        var k = classify(f.c);
        d.level = k.level; d.strength = k.strength;
      }
    });
    return days;
  }

  // Choose a run of consecutive real days for the mission. The level sets how stormy
  // a window we look for; rng picks among the matching windows so replays differ.
  function pickWindow(data, nSols, levelId, rng) {
    var days = byDay(data);
    if (days.length < nSols) return days;
    var lv = JA.LEVELS[levelId] || {};
    var target = (data.source === 'archive' ? lv.stormsArchive : lv.storms) || [2, 6];
    var wins = [];
    for (var i = 0; i + nSols <= days.length; i++) {
      var score = 0;
      for (var j = 0; j < nSols; j++) score += days[i + j].level;
      wins.push({ i: i, score: score });
    }
    var good = wins.filter(function (w) { return w.score >= target[0] && w.score <= target[1]; });
    if (!good.length) {
      var mid = (target[0] + target[1]) / 2, best = Infinity;
      wins.forEach(function (w) { best = Math.min(best, Math.abs(w.score - mid)); });
      good = wins.filter(function (w) { return Math.abs(w.score - mid) === best; });
    }
    var pick = good[Math.floor(rng() * good.length)];
    return days.slice(pick.i, pick.i + nSols);
  }

  // Where Earth and Mars are on a real date, in AU, seen from above the Sun (x toward the
  // vernal equinox). Mean orbits plus a first-order correction for their oval shape: good to a
  // few percent, so everything built on it is shown to players as "about". The same model gives
  // the radio delay and the orbit picture on the habitat's Mission Control screen (js/mission.js),
  // so the number and the picture can never disagree.
  var ORBITS = {
    earth: { L0: 100.46, rate: 0.98564736, peri: 102.94, a: 1.0, e: 0.0167, period: 365.25 },
    mars: { L0: 355.45, rate: 0.52402075, peri: 336.04, a: 1.5237, e: 0.0934, period: 686.98 }
  };
  var LIGHT_MIN_PER_AU = 8.3167, KM_PER_AU = 149597870.7;
  function planetAt(o, days) {
    var L = (o.L0 + o.rate * days) * Math.PI / 180;
    var M = L - o.peri * Math.PI / 180;
    var v = M + 2 * o.e * Math.sin(M);
    var r = o.a * (1 - o.e * o.e) / (1 + o.e * Math.cos(v));
    var lon = v + o.peri * Math.PI / 180;
    return { x: r * Math.cos(lon), y: r * Math.sin(lon), r: r, lon: lon };
  }
  function daysSince2000(dateStr) { return (Date.parse(dateStr + 'T12:00:00Z') - Date.UTC(2000, 0, 1, 12)) / DAY; }
  function planets(dateStr) {
    var d = daysSince2000(dateStr), E = planetAt(ORBITS.earth, d), Mx = planetAt(ORBITS.mars, d);
    var au = Math.hypot(E.x - Mx.x, E.y - Mx.y);
    // the angle at the Sun between the two planets: 0 = Mars close behind Earth (opposition), 180 = far side (conjunction)
    var sep = Math.abs(((Mx.lon - E.lon) * 180 / Math.PI + 540) % 360 - 180);
    return { date: dateStr, days: d, earth: E, mars: Mx, au: au, km: au * KM_PER_AU, minutes: au * LIGHT_MIN_PER_AU, sep: sep, orbits: ORBITS };
  }
  // the whole path of a planet, as n points, for drawing (same formula, so the dot sits on the line)
  function orbitPath(name, n) {
    var o = ORBITS[name], out = [];
    for (var i = 0; i <= n; i++) out.push(planetAt(o, i / n * o.period));
    return out;
  }
  // Estimated one-way radio delay Earth <-> Mars, in minutes, for a real date.
  function marsDelayMin(dateStr) { return planets(dateStr).minutes; }

  function prettyDate(dateStr) {
    var m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var p = dateStr.split('-');
    return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }

  JA.weather = { load: load, pickWindow: pickWindow, classify: classify, marsDelayMin: marsDelayMin, planets: planets, orbitPath: orbitPath, prettyDate: prettyDate, byDay: byDay };
})(window.JA);
