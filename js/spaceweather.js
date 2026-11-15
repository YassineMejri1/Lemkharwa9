/* Astro Outpost — real space weather, from NASA DONKI (the Space Weather Database).
   Three different things, and only one of them is the crew's radiation storm:
   - a solar FLARE is a flash of light and X-rays. It reaches the Moon or Mars in minutes: the first sign.
   - a CORONAL MASS EJECTION (CME) is a huge, fast cloud of solar gas. It takes one to three days to cross space.
   - SOLAR ENERGETIC PARTICLES (SEPs) are protons sped up, mostly by the shock wave in front of a fast CME. They race
     along the Sun's spiral magnetic field, so they reach a planet only if the eruption is on the part of the Sun that
     is magnetically connected to it. THEY are the radiation storm.
   Moon: the particle storms NASA's satellites near Earth really measured (DONKI SEP), plus CME shock arrivals at Earth.
   Mars: no particle detector near Mars reports to DONKI, so each fast CME is checked against the real positions of
   Earth and Mars on that date (how well was Mars connected to where it erupted?), plus the WSA-ENLIL model's CME
   arrivals at Mars. Live data covers the last 30 days; the embedded archive covers 22 Apr – 31 May 2024. */
(function (JA) {
  'use strict';

  var BASE = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/';
  var DAY = 86400000;
  var STRENGTH = [0, 6, 12, 24];        // GAME: badge points of a storm of level 0–3, before the site and level scales

  function iso(d) { return d.toISOString().slice(0, 10); }
  function wrap180(d) { return ((d + 180) % 360 + 360) % 360 - 180; }

  // ---------- the data, trimmed to what the game uses ----------
  function slimFlares(list) {
    return (list || []).filter(function (f) { return f && typeof f.classType === 'string' && f.classType && f.peakTime; })
      .map(function (f) { return { t: f.peakTime, c: f.classType, ar: f.activeRegionNum, loc: f.sourceLocation || '', link: f.link }; });
  }
  function slimSep(list) {
    return (list || []).filter(function (e) { return e && e.eventTime; })
      .map(function (e) { return { t: e.eventTime, inst: (e.instruments || []).map(function (i) { return String(i.displayName || ''); }), link: e.link }; });
  }
  // the most accurate analysis of each CME (speed in km/s, direction as Stonyhurst longitude: 0 = toward Earth, west +)
  function slimCme(list) {
    var out = [];
    (list || []).forEach(function (c) {
      var a = (c.cmeAnalyses || []).filter(function (x) { return x.isMostAccurate; })[0];
      if (!c.startTime || !a || a.speed == null || a.longitude == null || a.speed < 600) return;
      out.push({ t: c.startTime, v: Math.round(a.speed), lon: a.longitude, half: a.halfAngle, link: c.link });
    });
    return out;
  }
  // CME arrivals predicted by the WSA-ENLIL model: one per place and day (a direct hit beats a glancing blow)
  function slimArrivals(list) {
    var by = {};
    function put(loc, t, gb, link) { if (!t) return; var k = loc + '|' + t.slice(0, 10); if (!by[k] || (by[k].gb && !gb)) by[k] = { loc: loc, t: t, gb: !!gb, link: link }; }
    (list || []).forEach(function (x) {
      put('earth', x.estimatedShockArrivalTime, x.isEarthGB, x.link);
      (x.impactList || []).forEach(function (i) { if (i.location === 'Mars') put('mars', i.arrivalTime, i.isGlancingBlow, x.link); });
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  // Flare class -> how big the FLASH looked (A, B, C, M, X: each letter 10 times stronger). This is not the crew's dose.
  function classify(cls) {
    if (!cls || typeof cls !== 'string') return { level: 0, strength: 0 };
    var letter = cls.charAt(0).toUpperCase();
    var num = parseFloat(cls.slice(1)) || 1;
    if (letter === 'X') return { level: 3, strength: Math.round(20 + Math.min(10, num)) };
    if (letter === 'M' && num >= 5) return { level: 2, strength: 12 };
    if (letter === 'M') return { level: 1, strength: 6 };
    return { level: 0, strength: 0 };
  }
  function rank(cls) {
    if (!cls || typeof cls !== 'string') return -1;
    var order = 'ABCMX'.indexOf(cls.charAt(0).toUpperCase());
    return order * 100 + (parseFloat(cls.slice(1)) || 0);
  }

  // ---------- where do the particles go? ----------
  // The Sun turns while the solar wind blows out, so its magnetic field lines are spirals (the Parker spiral). A planet
  // is linked to a spot on the Sun that lies west of the planet's own direction: about 58° for Earth, about 88° for Mars
  // (Sun's turn 2.7e-6 rad/s, solar wind 400 km/s). The closer an eruption is to that spot, and the faster its CME,
  // the more particles reach the planet (the fall-off with angle follows studies of many SEP events: about 43° wide).
  var OMEGA_SUN = 2.7e-6, V_WIND = 400, SEP_WIDTH = 43;
  function footpointDeg(rAU) { return OMEGA_SUN * rAU * KM_PER_AU / V_WIND * 180 / Math.PI; }
  function connection(dateStr, lon, speed, siteId) {
    var p = planets(dateStr), obs = siteId === 'mars' ? p.mars : p.earth;
    var obsLon = wrap180((obs.lon - p.earth.lon) * 180 / Math.PI);          // the site's direction seen from the Sun; 0 = Earth
    var foot = obsLon + footpointDeg(obs.r);
    var theta = Math.abs(wrap180(lon - foot));
    var score = Math.max(0, (speed - 600) / 1000) * Math.exp(-theta * theta / (2 * SEP_WIDTH * SEP_WIDTH));
    return { theta: theta, score: score, level: score >= 1.2 ? 3 : score >= 0.6 ? 2 : score >= 0.3 ? 1 : 0 };
  }
  // A measured particle event near Earth: how strong? GOES satellites count protons above 10 MeV; above 100 MeV is the
  // most dangerous kind. Events seen only by STEREO-A (far from Earth) did not reach the Moon.
  function sepLevel(inst) {
    var all = inst.join(' | ');
    if (/GOES[^|]*>\s*100\s*MeV/i.test(all)) return 3;
    if (/GOES/i.test(all)) return 2;
    if (/SOHO|ACE|EPAM|EPHIN|COSTEP/i.test(all)) return 1;
    return 0;
  }

  // ---------- loading ----------
  function archive() {
    var a = window.JA_ARCHIVE_FLARES;
    return { source: 'archive', start: a.start, end: a.end, downloaded: a.downloaded,
      flares: a.flares, sep: a.sep || [], cme: a.cme || [], arrivals: a.arrivals || [], notes: a.notes || [] };
  }
  // Returns a promise of { source: 'live'|'archive', start, end, flares, sep, cme, arrivals, fallback? }.
  // Live needs the flares, the particle events and the CMEs; the ENLIL arrivals are a bonus. If NASA cannot be
  // reached, the archive is used and marked as a fallback (the game must then say clearly it is not live).
  function load(mode) {
    if (mode !== 'live') return Promise.resolve(archive());
    var end = new Date(), start = new Date(end.getTime() - 30 * DAY);
    var key = 'ja-donki2-' + iso(end), q = '?startDate=' + iso(start) + '&endDate=' + iso(end);
    try {
      var cached = sessionStorage.getItem(key);
      if (cached) return Promise.resolve(JSON.parse(cached));
    } catch (e) { /* storage may be blocked */ }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    function get(what) {
      return fetch(BASE + what + q, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (t) { var v = t ? JSON.parse(t) : []; if (!Array.isArray(v)) throw new Error('bad data'); return v; });   // no events = empty reply
    }
    return Promise.all([get('FLR'), get('SEP'), get('CME'), get('WSAEnlilSimulations').catch(function () { return []; })])
      .then(function (r) {
        clearTimeout(timer);
        var data = { source: 'live', start: iso(start), end: iso(end), flares: slimFlares(r[0]), sep: slimSep(r[1]), cme: slimCme(r[2]),
          arrivals: slimArrivals(r[3]), notes: [], fetchedAt: new Date().toISOString() };
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

  // ---------- one entry per real calendar day, for one site ----------
  // level 0–3 is the radiation storm that reached the site that day; cause says what it was:
  //   'sep'   particles measured near Earth (Moon), or a CME well connected to Mars (Mars)
  //   'cme'   a CME's shock wave arriving (a smaller particle storm)
  // cls/time/link/loc describe the day's strongest flare (seen from Earth): the flash, not the dose.
  function byDay(data, siteId) {
    var mars = siteId === 'mars', days = [], index = {};
    var t0 = Date.parse(data.start + 'T00:00:00Z'), t1 = Date.parse(data.end + 'T00:00:00Z');
    for (var t = t0; t <= t1; t += DAY) {
      var d = { date: iso(new Date(t)), cls: null, level: 0, strength: 0, link: null, time: null, count: 0, loc: '',
        cause: null, sep: null, cme: null, arrive: null, note: null };
      index[d.date] = d;
      days.push(d);
    }
    (data.flares || []).forEach(function (f) {
      var d = index[String(f.t).slice(0, 10)];
      if (!d || typeof f.c !== 'string') return;
      d.count++;
      if (!d.cls || rank(f.c) > rank(d.cls)) { d.cls = f.c; d.link = f.link; d.time = String(f.t).slice(11, 16); d.loc = f.loc || ''; }
    });
    function raise(d, level, cause) { if (level > d.level) { d.level = level; d.cause = cause; return true; } return false; }
    if (!mars) {
      (data.sep || []).forEach(function (e) {
        var d = index[String(e.t).slice(0, 10)], lv = sepLevel(e.inst || []);
        if (d && raise(d, lv, 'sep')) d.sep = { time: String(e.t).slice(11, 16), inst: (e.inst || []).join(', '), link: e.link };
      });
    } else {
      (data.cme || []).forEach(function (c) {
        var d = index[String(c.t).slice(0, 10)];
        if (!d) return;
        var k = connection(d.date, c.lon, c.v, 'mars');
        if (raise(d, k.level, 'sep')) d.cme = { time: String(c.t).slice(11, 16), v: c.v, lon: c.lon, theta: Math.round(k.theta), link: c.link };
      });
    }
    (data.arrivals || []).forEach(function (a) {
      var d = index[String(a.t).slice(0, 10)];
      if (!d || a.gb || a.loc !== (mars ? 'mars' : 'earth')) return;
      d.arrive = { time: String(a.t).slice(11, 16), link: a.link };
      raise(d, 1, 'cme');
    });
    (data.notes || []).forEach(function (n) { if (n.site === (mars ? 'mars' : 'moon') && index[n.date]) index[n.date].note = { text: n.text, src: n.src }; });
    days.forEach(function (d) { d.strength = STRENGTH[d.level]; });
    return days;
  }

  // Plain words for what one real day sent to a site (no HTML: callers escape it). Every screen that explains a storm
  // uses this, so they can never disagree. Returns { text, flash, cause }.
  function instWords(inst) {
    if (/GOES[^,]*>\s*100\s*MeV/i.test(inst)) return 'NASA and NOAA\'s GOES satellites counted protons with more than 100 MeV of energy';
    if (/GOES/i.test(inst)) return 'NASA and NOAA\'s GOES satellites counted protons with more than 10 MeV of energy';
    return 'the SOHO and ACE spacecraft counted extra fast protons';
  }
  function describe(d, siteId) {
    var mars = siteId === 'mars', date = d && d.date ? prettyDate(d.date) : 'that day', text;
    if (!d) return { text: 'No space-weather data for this day.', flash: '', cause: null };
    var flash = d.cls ? 'The strongest flare seen from Earth that day was class ' + d.cls + (d.time ? ', at ' + d.time + ' UTC' : '') + '.' : 'Earth saw no big solar flares that day.';
    if (!d.level) {
      text = d.cls ? 'On ' + date + ' the Sun flashed, but no storm of particles reached ' + (mars ? 'Mars' : 'the Moon') + '. A flare is a flash of light and X-rays; the danger for the crew is the fast particles, and none came.'
        : 'On ' + date + ' the Sun was quiet, with no particle storm.';
      return { text: text + ' ' + flash, flash: flash, cause: null };
    }
    if (d.cause === 'sep' && !mars) text = 'On ' + date + ' ' + instWords(d.sep ? d.sep.inst : '') + ' near Earth: a solar particle storm. The Moon travels right next to Earth, so it was hit too.';
    else if (d.cause === 'sep') text = 'On ' + date + ' a cloud of solar gas (a CME) left the Sun at ' + (d.cme ? d.cme.v.toLocaleString('en-US') + ' km/s' : 'high speed') +
      ' from the part of the Sun that is magnetically linked to Mars, so its fast particles could race along the field to Mars.';
    else text = 'On ' + date + ' NASA\'s space-weather model says a cloud of solar gas (a CME) swept past ' + (mars ? 'Mars' : 'Earth and the Moon') +
      '. The shock wave at its front carries extra fast particles: a small radiation storm.';
    if (d.note) text += ' ' + d.note.text;
    return { text: text + ' ' + flash, flash: flash, cause: d.cause };
  }

  // Choose a run of consecutive real days for the mission. The level sets how stormy
  // a window we look for; rng picks among the matching windows so replays differ.
  function pickWindow(data, nSols, levelId, rng, siteId) {
    var days = byDay(data, siteId);
    if (days.length < nSols) return days;
    var lv = JA.LEVELS[levelId] || {};
    var target = (data.source === 'archive' ? lv.stormsArchive : lv.storms) || [2, 6];
    var wins = [];
    for (var i = 0; i + nSols <= days.length; i++) {
      var score = 0;
      for (var j = 0; j < nSols; j++) score += days[i + j].level;
      wins.push({ i: i, score: score });
    }
    // Nobody lands in a storm: the first day (the "living off the land" lesson) must be calm, and the second day
    // (the "shield up" lesson, when the first soil bags go on) may not bring a big one. The days stay real and in order.
    var calmStart = wins.filter(function (w) { return days[w.i].level === 0 && (nSols < 2 || days[w.i + 1].level < 3); });
    if (calmStart.length) wins = calmStart;
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
  // The angle at the Sun between the two planets, 0–180°: 0 = Mars close behind Earth (opposition),
  // 180 = on the far side of the Sun (conjunction). The longitudes keep growing with time (thousands of
  // degrees), so the difference is first wrapped into 0–360 — a plain % keeps the sign in JavaScript.
  function sepDeg(E, Mx) {
    var d = ((Mx.lon - E.lon) * 180 / Math.PI) % 360;
    if (d < 0) d += 360;
    return d > 180 ? 360 - d : d;
  }
  function planets(dateStr) {
    var d = daysSince2000(dateStr), E = planetAt(ORBITS.earth, d), Mx = planetAt(ORBITS.mars, d);
    var au = Math.hypot(E.x - Mx.x, E.y - Mx.y);
    var sep = sepDeg(E, Mx);
    // getting closer or farther? compare with the next day (same model)
    var E1 = planetAt(ORBITS.earth, d + 1), M1 = planetAt(ORBITS.mars, d + 1);
    var closing = Math.hypot(E1.x - M1.x, E1.y - M1.y) < au;
    return { date: dateStr, days: d, earth: E, mars: Mx, au: au, km: au * KM_PER_AU, minutes: au * LIGHT_MIN_PER_AU, sep: sep, closing: closing, orbits: ORBITS };
  }
  // A short label for where the two planets are in their dance around the Sun.
  function alignment(p) {
    if (p.sep < 35) return 'close approach';
    if (p.sep > 145) return 'far side of the Sun';
    return p.closing ? 'drawing closer' : 'drawing apart';
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

  JA.weather = { load: load, pickWindow: pickWindow, classify: classify, describe: describe, connection: connection, sepLevel: sepLevel, STRENGTH: STRENGTH, marsDelayMin: marsDelayMin, planets: planets, alignment: alignment, orbitPath: orbitPath, prettyDate: prettyDate, byDay: byDay };
})(window.JA);
