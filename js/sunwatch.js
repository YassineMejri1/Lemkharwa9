/* Astro Outpost — Sun Watch: a console that shows the real Sun behind the mission.
   It draws every real solar flare in the loaded NASA DONKI window on a chart (time goes
   across, strength goes up on a log scale with the bands C, M and X), highlights the real
   days this mission replays, and lists what each of those days meant in the game.
   Two honesty rules: it always says if the data is live or the saved archive, and it never
   shows the flares of a mission day the player has no way of knowing about yet.
   On a made-up planet (Sahrun) it becomes Star Watch: the same card for the made-up star the game invents
   (spaceweather.js star). Then it says so everywhere, and counts days instead of showing dates.
   No network, no storage. If something is missing it shows less; it never throws. */
(function (JA) {
  'use strict';

  var DAY = 86400000;
  var DONKI = 'https://ccmc.gsfc.nasa.gov/tools/DONKI/';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Chart layout. Across is in percent of the chart's width, so it fits a phone or a laptop.
  // Down is in pixels: day numbers on top, the plot between TOP and BOT, dates underneath.
  var GUT = 8, WIDE = 90, STRIP = 24, TOP = 52, BOT = 252, TALL = 280;
  // What the strongest flare of a day means in the game (the levels from spaceweather.js classify).
  var STORMS = [
    { icon: '😎', words: 'Quiet Sun' },
    { icon: '⚡', words: 'Small storm' },
    { icon: '⚡⚡', words: 'Medium storm' },
    { icon: '⚡⚡⚡', words: 'BIG storm' }
  ];

  // ---------- small helpers ----------
  function esc(v) {
    if (JA.ui && typeof JA.ui.esc === 'function') return JA.ui.esc(v);
    return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function list(v) { return Array.isArray(v) ? v : []; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  // '2024-05-10…' -> that day at 00:00 UTC in milliseconds (NaN if it is not a date)
  function dayMs(d) {
    var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof d === 'string' ? d : '');
    return p ? Date.UTC(+p[1], +p[2] - 1, +p[3]) : NaN;
  }
  // '06:54' -> milliseconds since midnight (NaN if there is no time)
  function clockMs(t) {
    var p = /^(\d{2}):(\d{2})/.exec(typeof t === 'string' ? t : '');
    return p && +p[1] < 24 && +p[2] < 60 ? (+p[1] * 60 + +p[2]) * 60000 : NaN;
  }
  // '2024-05-10T06:54Z' -> milliseconds UTC (NaN if it cannot be read)
  function stampMs(t) { return typeof t === 'string' ? dayMs(t) + clockMs(t.slice(11)) : NaN; }
  function longDate(ms) { var d = new Date(ms); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  // a made-up star has no real dates: its days are numbered from the start of its record (★1, ★2 … on the chart,
  // so they are never mixed up with the mission's own day numbers)
  function dayName(m, ms, short) {
    if (!m || !m.star) return short ? shortDate(ms) : longDate(ms);
    return (short ? '★' : 'star day ') + (Math.round((ms - m.t0) / DAY) + 1);
  }
  function shortDate(ms) { var d = new Date(ms); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3); }
  function clock(ms) { var d = new Date(ms); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  // Flare class -> where it sits on the log scale: C1 = 0, M1 = 1, X1 = 2, X10 = 3.
  // Each whole step is 10 times stronger. The band is the letter (anything below C counts as C).
  function strength(cls) {
    if (typeof cls !== 'string' || !cls) return null;
    var i = 'ABCMX'.indexOf(cls.charAt(0).toUpperCase());
    if (i < 0) return null;
    var n = parseFloat(cls.slice(1));
    if (!(n > 0)) n = 1;
    return { log: i - 2 + Math.log(n) / Math.LN10, band: i === 4 ? 'x' : i === 3 ? 'm' : 'c' };
  }
  // Only ever link to a NASA page.
  function nasaLink(url) { return typeof url === 'string' && /^https:\/\/([a-z0-9-]+\.)*nasa\.gov\//i.test(url) ? url : ''; }

  // ---------- the mission days, and which of them may be shown ----------
  // Past days and today are open. Today stays shut if no forecast came in (the Radio Dish was
  // off yesterday) until the storm alarm sounds or the day ends. Tomorrow opens only when
  // tonight's report carried a full forecast. Everything after the first shut day is shut.
  function missionDays(s) {
    var wx = list(s.weather), sol = +s.sol || 0, over = !!s.over, reports = {}, out = [], shut = false;
    list(s.log).forEach(function (r) { if (r && r.sol) reports[r.sol] = r; });
    var st = s.storm, seen = !!(st && (st.warned || st.active || st.over));
    var todayKnown = !!(s.forecast || seen || s.dayDone || s.night);
    var tonight = reports[sol], tomorrowKnown = !!(s.night && tonight && tonight.forecast && tonight.forecast.full);
    wx.forEach(function (w, i) {
      w = w || {};
      var n = i + 1, state;
      if (reports[n] || n < sol) state = 'played';
      else if (over) state = n === sol ? 'ended' : 'missed';
      else if (shut) state = 'later';
      else if (n === sol) state = todayKnown ? 'today' : 'blind';
      else if (n === sol + 1 && tomorrowKnown) state = 'forecast';
      else state = 'later';
      if (state === 'blind' || state === 'later') shut = true;
      out.push({
        n: n, state: state, open: state !== 'blind' && state !== 'later', today: n === sol && !over,
        ms: dayMs(w.date), cls: typeof w.cls === 'string' && w.cls ? w.cls : '', clock: clockMs(w.time),
        level: Math.max(0, Math.min(3, Math.round(+w.level) || 0)), count: Math.round(+w.count) || 0,
        link: nasaLink(w.link), report: reports[n] || null,
        // what really reached the site that day (spaceweather.js describe), and the NASA records behind it
        story: JA.weather && w.date ? JA.weather.describe(w, s.site && s.site.id).text : '',
        sepLink: nasaLink(w.sep && w.sep.link), cmeLink: nasaLink((w.cme && w.cme.link) || (w.arrive && w.arrive.link))
      });
    });
    return out;
  }

  // ---------- everything the card needs, worked out once ----------
  function build(s, data) {
    s = s && typeof s === 'object' ? s : null;
    data = data && typeof data === 'object' ? data : null;
    if (s && s.weatherSource === 'star' && data && data.source !== 'star') data = null;      // never draw real flares for a made-up star
    var m = { s: s, days: s ? missionDays(s) : [], pts: [], total: 0, ok: false, full: !!(data && Array.isArray(data.flares)) };
    m.source = String((s && s.weatherSource) || (data && data.source) || '');
    m.star = m.source === 'star'; m.starName = String((data && data.star) || 'the star');
    m.planet = s && s.site ? (s.site.id === 'mars' ? 'Mars' : s.site.id === 'moon' ? 'the Moon' : String(s.site.name)) : '';
    m.fallback = !!((s && s.weatherFallback) || (data && data.fallback));
    m.fetched = data ? dayMs(data.fetchedAt) : NaN;
    m.saved = data ? dayMs(data.downloaded) : NaN;
    m.dayWord = s && s.site && s.site.dayWord ? String(s.site.dayWord) : 'Day';

    // every flare we may draw: the full NASA list, or (without it) the strongest flare of each open mission day
    var all = [];
    if (m.full) {
      data.flares.forEach(function (f) {
        var k = f ? strength(f.c) : null, ms = f ? stampMs(f.t) : NaN;
        if (k && !isNaN(ms)) all.push({ ms: ms, cls: String(f.c), log: k.log, band: k.band, timed: true });
      });
    } else {
      m.days.forEach(function (d) {
        var k = d.open ? strength(d.cls) : null;
        if (k && !isNaN(d.ms)) all.push({ ms: d.ms + (isNaN(d.clock) ? DAY / 2 : d.clock), cls: d.cls, log: k.log, band: k.band, timed: !isNaN(d.clock) });
      });
    }

    // the run of real days the chart covers
    var t0 = data ? dayMs(data.start) : NaN, t1 = data ? dayMs(data.end) : NaN;
    if (isNaN(t0) || isNaN(t1) || t1 < t0) {
      t0 = Infinity; t1 = -Infinity;
      all.forEach(function (p) { var d = Math.floor(p.ms / DAY) * DAY; t0 = Math.min(t0, d); t1 = Math.max(t1, d); });
    }
    m.days.forEach(function (d) { if (!isNaN(d.ms)) { t0 = Math.min(t0, d.ms); t1 = Math.max(t1, d.ms); } });
    if (!isFinite(t0) || !isFinite(t1)) return m;
    if (t1 - t0 > 92 * DAY) t0 = t1 - 92 * DAY;
    m.t0 = t0; m.t1 = t1; m.span = t1 + DAY - t0; m.nDays = Math.round(m.span / DAY); m.ok = true;

    // never draw the flares of a mission day that is still shut
    var shutDays = m.days.filter(function (d) { return !d.open && !isNaN(d.ms); });
    m.shut0 = shutDays.length ? shutDays[0].ms : NaN;
    m.shut1 = shutDays.length ? shutDays[shutDays.length - 1].ms + DAY : NaN;
    m.top = 3;      // the chart reaches X10 at least
    m.count = { c: 0, m: 0, x: 0 };
    all.forEach(function (p) {
      if (p.ms < t0 || p.ms >= t0 + m.span) return;
      m.total++;
      m.top = Math.max(m.top, p.log + 0.12);
      if (p.ms >= m.shut0 && p.ms < m.shut1) return;
      m.count[p.band]++;
      m.pts.push(p);
    });
    m.pts.sort(function (a, b) { return a.ms - b.ms; });
    return m;
  }

  // ---------- 1. heading and where the data comes from ----------
  function headHtml(m) {
    if (m.star) return starHead(m);
    var range = m.ok ? 'from <b>' + esc(longDate(m.t0)) + '</b> to <b>' + esc(longDate(m.t1)) + '</b>' : '';
    var lead = !m.ok ? 'Sun Watch shows real solar flares, recorded by NASA on real dates.'
      : m.full && !m.total ? 'This is the real Sun. NASA listed no solar flares at all ' + range + '.'
        : m.full ? 'These are real solar flares. NASA recorded all ' + esc(m.total) + ' of them, ' + range + '.'
          : 'These are real solar flares. NASA recorded them ' + range + '.';
    var box = '';
    if (m.fallback) {
      box = '<div class="info-row sunwatch-data"><span class="ic">📼</span><div><b>Saved NASA records (not live)</b>' +
        '<p><span class="tagline archive">NASA archive</span>You asked for live data, but NASA could not be reached. ' +
        'So this mission uses saved NASA records instead. This is not live data.</p></div></div>';
    } else if (m.source === 'live') {
      var when = 'when this mission started';
      if (!isNaN(m.fetched)) when = m.fetched === Math.floor(Date.now() / DAY) * DAY ? 'today' : 'on ' + esc(longDate(m.fetched));
      box = '<div class="info-row sunwatch-data"><span class="ic">🛰️</span><div><b>Live from NASA</b>' +
        '<p><span class="tagline">Live NASA data</span>The game fetched this list from NASA ' + when + '. ' +
        'These are the newest flares NASA has listed.</p></div></div>';
    } else if (m.source === 'archive') {
      // 10 May 2024 was the peak of the strongest storm at Earth in about 20 years
      var may = m.ok && m.t0 <= Date.UTC(2024, 4, 10) && m.t1 >= Date.UTC(2024, 4, 10);
      box = '<div class="info-row sunwatch-data"><span class="ic">📼</span><div><b>Saved NASA records (not live)</b>' +
        '<p><span class="tagline archive">NASA archive</span>This list is saved inside the game. It is not live data.' +
        (may ? ' It covers one of the most active months on the Sun in 20 years.' : '') +
        (isNaN(m.saved) ? '' : ' It was copied from NASA on ' + esc(longDate(m.saved)) + '.') + '</p></div></div>';
    }
    return '<h2>☀️ Sun Watch</h2><p class="sub">The real Sun behind your mission.</p>' +
      '<p class="sunwatch-lead">' + lead + '</p>' + box;
  }

  function starHead(m) {
    var range = m.ok ? 'from <b>' + esc(dayName(m, m.t0)) + '</b> to <b>' + esc(dayName(m, m.t1)) + '</b>' : '';
    var lead = !m.ok ? 'Star Watch shows the flares of ' + esc(m.starName) + ', a made-up star.'
      : !m.total ? 'The game gave ' + esc(m.starName) + ' no flares at all ' + range + '.'
        : 'These flares are made up. The game invented all ' + esc(m.total) + ' of them on ' + esc(m.starName) + ', ' + range + '.';
    return '<h2>⭐ Star Watch</h2><p class="sub">' + esc(m.starName) + ', the made-up star behind your mission.</p>' +
      '<p class="sunwatch-lead">' + lead + '</p>' +
      '<div class="info-row sunwatch-data"><span class="ic">🌞</span><div><b>A made-up star (not real data)</b>' +
      '<p><span class="tagline made">Made-up star</span>' + esc(m.planet) + ' and ' + esc(m.starName) + ' are made up, so NASA has no records of them. ' +
      'The game invents the storms with the same physics as our own Sun: spots that grow and fade while the star turns, flares from those spots, ' +
      'and fast particles that reach ' + esc(m.planet) + ' only from the part of the star linked to it by its spiral magnetic field.</p></div></div>';
  }

  // ---------- 2. the chart ----------
  function xAt(m, ms) { return r2(GUT + WIDE * Math.max(0, Math.min(1, (ms - m.t0) / m.span))); }
  function yAt(m, log) { return r1(BOT - Math.max(0, Math.min(m.top, log)) / m.top * (BOT - TOP)); }
  function tipFor(m, p) { return m.star ? p.cls + ' flare · ' + dayName(m, p.ms) + ' · made up' : p.cls + ' flare · ' + longDate(p.ms) + (p.timed ? ' · peak at ' + clock(p.ms) + ' UTC' : ''); }

  function chartHtml(m) {
    if (!m.ok) return '<p class="sunwatch-note">No flare list is loaded yet. Start a mission to see ' + (m.star ? esc(m.starName) : 'the real Sun') + ' here.</p>';
    var o = [], i, days = m.days.filter(function (d) { return !isNaN(d.ms); });
    var right = GUT + WIDE, dw = m.dayWord, today = days.filter(function (d) { return d.today; })[0] || null;

    // the three bands; each one is 10 times stronger than the band below it
    [['x', 2, m.top, 'X'], ['m', 1, 2, 'M'], ['c', 0, 1, 'C']].forEach(function (b) {
      var y1 = yAt(m, b[2]), y0 = yAt(m, b[1]);
      o.push('<rect class="sunwatch-band sunwatch-b' + b[0] + '" x="' + GUT + '%" width="' + WIDE + '%" y="' + y1 + '" height="' + r1(y0 - y1) + '"/>');
      o.push('<text class="sunwatch-letter" x="' + GUT / 2 + '%" y="' + r1((y0 + y1) / 2) + '" dy="0.35em" text-anchor="middle">' + b[3] + '</text>');
    });
    [1, 2].forEach(function (v) { o.push('<line class="sunwatch-grid" x1="' + GUT + '%" x2="' + right + '%" y1="' + yAt(m, v) + '" y2="' + yAt(m, v) + '"/>'); });
    var y5 = yAt(m, 1 + Math.log(5) / Math.LN10);   // M5: from here up an M flare makes a medium storm
    o.push('<line class="sunwatch-m5" x1="' + GUT + '%" x2="' + right + '%" y1="' + y5 + '" y2="' + y5 + '"/>');
    o.push('<line class="sunwatch-axis" x1="' + GUT + '%" x2="' + right + '%" y1="' + BOT + '" y2="' + BOT + '"/>');

    // dates along the bottom
    var step = m.nDays > 21 ? 7 : m.nDays > 10 ? 3 : m.nDays > 5 ? 2 : 1;
    for (i = 0; i < m.nDays; i += step) {
      var tx = xAt(m, m.t0 + (i + 0.5) * DAY);
      o.push('<line class="sunwatch-axis" x1="' + tx + '%" x2="' + tx + '%" y1="' + BOT + '" y2="' + (BOT + 5) + '"/>');
      o.push('<text x="' + tx + '%" y="' + (BOT + 21) + '" text-anchor="middle">' + esc(dayName(m, m.t0 + i * DAY, true)) + '</text>');
    }

    // the days this mission replays: a band with the mission day numbers on top
    if (days.length) {
      var a = xAt(m, days[0].ms), b2 = xAt(m, days[days.length - 1].ms + DAY), left = (a + b2) / 2 < 50;
      o.push('<rect class="sunwatch-mission" x="' + a + '%" width="' + r2(b2 - a) + '%" y="' + STRIP + '" height="' + (BOT - STRIP) + '" rx="5"/>');
      o.push('<rect class="sunwatch-strip" x="' + a + '%" width="' + r2(b2 - a) + '%" y="' + STRIP + '" height="22" rx="5"/>');
      o.push('<text class="sunwatch-cap" x="' + (left ? a : b2) + '%" y="15" text-anchor="' + (left ? 'start' : 'end') + '">Your mission' +
        (today ? '<tspan class="sunwatch-wide"> · today is ' + esc(dw + ' ' + today.n) + '</tspan>' : '') + '</text>');
      if (today) o.push('<rect class="sunwatch-todaycol" x="' + xAt(m, today.ms) + '%" width="' + r2(xAt(m, today.ms + DAY) - xAt(m, today.ms)) + '%" y="' + TOP + '" height="' + (BOT - TOP) + '"/>');
      days.forEach(function (d, k) {
        var cx = xAt(m, d.ms + DAY / 2);
        var sx = xAt(m, d.ms);
        if (k) {
          o.push('<line class="sunwatch-sep" x1="' + sx + '%" x2="' + sx + '%" y1="' + STRIP + '" y2="' + (STRIP + 22) + '"/>');
          o.push('<line class="sunwatch-sep sunwatch-wide" x1="' + sx + '%" x2="' + sx + '%" y1="' + TOP + '" y2="' + BOT + '"/>');
        }
        if (d.today) o.push('<circle class="sunwatch-todaydot" cx="' + cx + '%" cy="' + (STRIP + 11) + '" r="11"/>');
        // on a phone there is only room for the first, the last and today's number
        var edge = (k === 0 || k === days.length - 1) && (!today || Math.abs(d.n - today.n) > 1);
        o.push('<text class="sunwatch-n' + (d.today ? ' sunwatch-ntoday' : edge ? '' : ' sunwatch-wide') + '" x="' + cx + '%" y="' + (STRIP + 11) + '" dy="0.35em" text-anchor="middle">' + esc(d.n) + '</text>');
      });
    }

    // one mark per real flare: C and M are dots, X is a diamond (so it is not colour alone)
    ['c', 'm', 'x'].forEach(function (band) {
      m.pts.forEach(function (p) {
        if (p.band !== band) return;
        var x = xAt(m, p.ms), y = yAt(m, p.log);
        var at = ' class="sunwatch-f sunwatch-f' + band + '" data-x="' + x + '" data-y="' + y + '" data-tip="' + esc(tipFor(m, p)) + '"';
        if (band === 'x') o.push('<svg' + at + ' x="' + x + '%" y="' + y + '" overflow="visible"><path d="M0-7L6.5 0 0 7-6.5 0z"/></svg>');
        else o.push('<circle' + at + ' cx="' + x + '%" cy="' + y + '" r="4"/>');
      });
    });
    // a white ring around the strongest flare of each open mission day: that flare sets the storm
    days.forEach(function (d) {
      var k = d.open ? strength(d.cls) : null;
      if (k) o.push('<circle class="sunwatch-ring" cx="' + xAt(m, d.ms + (isNaN(d.clock) ? DAY / 2 : d.clock)) + '%" cy="' + yAt(m, k.log) + '" r="8.5"/>');
    });
    // days the player may not know about yet stay covered
    if (!isNaN(m.shut0)) {
      var h0 = xAt(m, m.shut0), h1 = xAt(m, m.shut1);
      o.push('<rect class="sunwatch-cover" x="' + h0 + '%" width="' + r2(h1 - h0) + '%" y="' + TOP + '" height="' + (BOT - TOP) + '"/>');
      o.push('<text class="sunwatch-q" x="' + r2((h0 + h1) / 2) + '%" y="' + (TOP + BOT) / 2 + '" dy="0.35em" text-anchor="middle">?</text>');
    }
    o.push('<circle class="sunwatch-pick" cx="50%" cy="' + TOP + '" r="12"/>');   // shown by open() around the flare you point at

    var label = 'Chart of ' + plural(m.pts.length, m.star ? 'made-up flare' : 'real solar flare') + ' from ' + dayName(m, m.t0) + ' to ' + dayName(m, m.t1) +
      '. Time goes from left to right. Stronger flares are higher up, in three bands: C, M and X. ' +
      plural(m.count.x, 'X flare') + ', ' + plural(m.count.m, 'M flare') + ', ' + plural(m.count.c, 'C flare') + '.';
    var intro = '';
    if (days.length) {
      intro = '<p>The yellow band is your mission: ' + esc(dw + ' 1 to ' + dw + ' ' + days[days.length - 1].n) + ' replay ' +
        esc(dayName(m, days[0].ms)) + ' to ' + esc(dayName(m, days[days.length - 1].ms)) + '.</p>';
    }
    return '<h3>📈 ' + (m.star ? esc(m.starName) + ', flare by flare (made up)' : 'The real Sun, flare by flare') + '</h3><div class="sunwatch-fig">' + intro +
      '<svg class="sunwatch-chart" width="100%" height="' + TALL + '" role="img" aria-label="' + esc(label) + '"' + (m.star ? ' data-made="1"' : '') + '>' + o.join('') + '</svg>' +
      '<p class="sunwatch-read" aria-live="polite"></p>' + keyHtml(m, days, today) + '</div>';
  }

  // The key under the chart: every colour also has a shape or a place, and a label.
  function keyHtml(m, days, today) {
    function ic(inner) { return '<svg class="sunwatch-ic" viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true">' + inner + '</svg>'; }
    var li = [
      '<li>' + ic('<path class="sunwatch-fx" d="M0-7L6.5 0 0 7-6.5 0z"/>') + '<span><b>X flare</b> = BIG storm</span></li>',
      '<li>' + ic('<circle class="sunwatch-fm" r="4.5"/>') + '<span><b>M flare</b> = small storm. Above the dashed line (M5) = medium storm</span></li>',
      '<li>' + ic('<circle class="sunwatch-fc" r="4.5"/>') + '<span><b>C flare</b> = too weak for a storm. A quiet day</span></li>'
    ];
    if (days.length) {
      li.push('<li>' + ic('<circle class="sunwatch-ring" r="7"/>') + '<span><b>White ring</b> = the strongest flare of a mission day. It sets the storm</span></li>');
      if (today) li.push('<li>' + ic('<circle class="sunwatch-todaydot" r="8"/>') + '<span><b>Yellow circle</b> = today, ' + esc(m.dayWord + ' ' + today.n) + '</span></li>');
    }
    if (!isNaN(m.shut0)) li.push('<li>' + ic('<rect class="sunwatch-cover" x="-8" y="-8" width="16" height="16"/><text class="sunwatch-q" y="5" text-anchor="middle">?</text>') + '<span><b>?</b> = days you cannot know yet. Their flares stay hidden</span></li>');
    var notes = '<p class="sunwatch-how">Left to right is time. Higher up is stronger. Each letter is 10 times stronger than the one before: ' +
      'M is 10 times C, and X is 10 times M. So each band of the chart is a 10 times jump.</p>';
    if (!m.full) notes += '<p class="sunwatch-how">The full flare list is not loaded, so this chart shows only the strongest flare of each mission day.</p>';
    else if (!m.count.c && m.source === 'archive') notes += '<p class="sunwatch-how">The saved list keeps only M and X flares. That is why the C band is empty.</p>';
    return '<ul class="sunwatch-key">' + li.join('') + '</ul>' + notes;
  }

  // ---------- 3. one row per mission day ----------
  // What a finished day did to the radiation badge, read from that day's night report.
  function happened(m, d) {
    var r = d.report, storm = NaN;
    if (!r) return '';
    list(r.lines).forEach(function (l) {
      if (l && l.res === 'dose') list(l.parts).forEach(function (p) { if (p && /solar storm/i.test(p.text)) storm = +p.v; });
    });
    var out = d.level > 0 ? (storm > 0 ? 'The storm added <b>' + esc(r1(storm)) + '%</b> to your radiation badge.' : 'The storm added almost nothing to your radiation badge.')
      : 'No storm hit the outpost.';
    var b = r.before ? +r.before.dose : NaN, a = r.after ? +r.after.dose : NaN;
    if (isFinite(b) && isFinite(a)) out += ' Badge that ' + esc(m.dayWord.toLowerCase()) + ': ' + Math.round(b) + '% → ' + Math.round(a) + '%.';
    return out;
  }
  // Today, while the shift is still running.
  function rightNow(m, d) {
    var st = m.s.storm, got = m.s.today ? +m.s.today.doseStorm : NaN;
    if (d.level > 0 && st) {
      if (st.over) return 'The storm has passed.' + (got >= 0.05 ? ' So far it added <b>' + esc(r1(got)) + '%</b> to your radiation badge.' : '');
      if (st.active) return 'The storm is hitting right now. Stay inside!';
      if (st.warned) return 'The storm is on its way. Get home!';
      return 'A storm will hit some time today. Be ready to run home!';
    }
    return d.level > 0 ? 'A storm is forecast for today.' : 'No storm today.';
  }
  function rowHtml(m, d) {
    var low = m.dayWord.toLowerCase();
    var date = isNaN(d.ms) ? 'Date not known' : dayName(m, d.ms), home = m.star ? 'the relay ship' : 'Earth';
    var when = d.today ? 'today' : d.state === 'forecast' ? 'tomorrow' : '';
    var head = '<span class="sunwatch-chip">' + esc(m.dayWord + ' ' + d.n) + '</span><div class="sunwatch-info"><b>' + esc(date) + (when ? ' <em>' + when + '</em>' : '') + '</b>';
    if (!d.open) {
      var blind = d.state === 'blind';
      return '<li class="sunwatch-day sunwatch-wait' + (d.today ? ' sunwatch-now' : '') + '">' + head +
        '<span>' + (blind ? 'No forecast. The Radio Dish was off, so ' + home + ' could not warn you. Look again later today.'
          : 'Not yet. Play this ' + esc(low) + ' to see what ' + (m.star ? esc(m.starName) : 'the Sun') + ' did.') + '</span></div>' +
        '<span class="sunwatch-pill sunwatch-pq">❓ ' + (blind ? 'No forecast' : 'Not yet') + '</span></li>';
    }
    var links = [];
    if (d.sepLink) links.push('<a href="' + esc(d.sepLink) + '" target="_blank" rel="noopener">particle storm record</a>');
    if (d.cmeLink) links.push('<a href="' + esc(d.cmeLink) + '" target="_blank" rel="noopener">CME record</a>');
    if (d.link) links.push('<a href="' + esc(d.link) + '" target="_blank" rel="noopener">flare record</a>');
    var flare = esc(d.story || (d.cls ? 'Strongest flare: class ' + d.cls + '.' : 'No flare listed that day.')) +
      (d.count > 1 ? (m.star ? ' The game made up ' + esc(d.count) + ' flares that day.' : ' NASA listed ' + esc(d.count) + ' flares that day.') : '') +
      (links.length ? ' NASA: ' + links.join(' · ') : '');
    var what = '';
    if (d.state === 'played') what = happened(m, d);
    else if (d.state === 'today') what = rightNow(m, d);
    else if (d.state === 'forecast') what = 'Forecast from ' + home + '. Your Radio Dish was on, so you know what is coming.';
    else if (d.state === 'ended') what = 'The mission ended on this ' + esc(low) + '.';
    else if (d.state === 'missed') what = 'The mission ended before this ' + esc(low) + '.';
    var st = STORMS[d.level] || STORMS[0];
    return '<li class="sunwatch-day sunwatch-l' + d.level + (d.today ? ' sunwatch-now' : '') + '">' + head +
      '<span>' + flare + '</span>' + (what ? '<span class="sunwatch-res">' + what + '</span>' : '') + '</div>' +
      '<span class="sunwatch-pill sunwatch-p' + d.level + '">' + st.icon + ' ' + st.words + '</span></li>';
  }
  function rowsHtml(m) {
    if (!m.days.length) return '';
    var s = m.s, hit = 0, out = s.stats ? +s.stats.stormOut : NaN, sum = '';
    m.days.forEach(function (d) {
      if (d.level > 0 && (d.state === 'played' || (d.state === 'today' && s.storm && (s.storm.active || s.storm.over)))) hit++;
    });
    if (hit && isFinite(out)) {
      var sofar = s.over ? 'In this mission' : 'So far';
      sum = '<p class="sunwatch-sum">' + (out < 1 ? '🏅 ' + sofar + ' you were never caught outside in a solar storm. Nice work!'
        : sofar + ' you were caught outside in a solar storm for about ' + esc(plural(Math.round(out), 'second')) + '.') + '</p>';
    }
    var how = m.star ? 'Each mission ' + esc(m.dayWord.toLowerCase()) + ' replays one day of ' + esc(m.starName) + '\'s made-up record. The chart above shows the flares: flashes of light. Each row says what reached ' + esc(m.planet) + ': a storm of fast particles, or nothing.'
      : 'Each mission ' + esc(m.dayWord.toLowerCase()) + ' replays one real day. The chart above shows the flares: flashes of light. Each row says what really reached ' + esc(m.planet || 'the Moon') + ': a storm of fast particles, or nothing.';
    return '<h3>🗓️ Your mission, day by ' + (m.star ? '' : 'real ') + 'day</h3>' +
      '<p class="sunwatch-how">' + how + '</p>' +
      '<ol class="sunwatch-days">' + m.days.map(function (d) { return rowHtml(m, d); }).join('') + '</ol>' + sum;
  }

  // ---------- 4. how to read this, and the source ----------
  function sourceHtml(m) {
    if (m && m.star) return '<p class="sunwatch-src">Source: none. ' + esc(m.starName) + ' and its storms are made up by the game, from the same physics as our Sun. This is not real data.</p>';
    return '<p class="sunwatch-src">Source: <a href="' + DONKI + '" target="_blank" rel="noopener">NASA DONKI</a>, ' +
      'the Space Weather Database Of Notifications, Knowledge, Information.' +
      (m && m.source === 'live' && !m.fallback ? ' Live list.' : m && (m.source === 'archive' || m.fallback) ? ' Saved list, not live.' : '') + '</p>';
  }
  function factsHtml(m) {
    if (m.star) return starFacts(m);
    return '<h3>🔎 How to read this</h3>' +
      '<div class="info-row"><span class="ic">☀️</span><div><b>What is a solar flare?</b><p>A giant flash on the Sun: light and X-rays. It takes about 8 minutes to reach Earth and the Moon, and about 13 minutes to reach Mars. It is the first sign that something happened.</p></div></div>' +
      '<div class="info-row"><span class="ic">☁️</span><div><b>What is a CME?</b><p>A coronal mass ejection: a giant cloud of solar gas thrown into space. It takes one to three days to cross to Earth or Mars. A fast one pushes a shock wave ahead of it, like a boat’s bow wave.</p></div></div>' +
      '<div class="info-row"><span class="ic">☢️</span><div><b>So what is a radiation storm?</b><p>Protons sped up to huge speeds, mostly by that shock wave. They race along the Sun’s spiral magnetic field, so they only reach a planet that is linked to the right part of the Sun. Big flares often send none your way. That is why the crew watches for particles, not flashes.</p></div></div>' +
      '<div class="info-row"><span class="ic">🔠</span><div><b>What do the letters mean?</b><p>Scientists sort flares by strength: A, B, C, M and X. Each letter is 10 times stronger than the one before. The number counts steps inside a letter: an M2 is twice as strong as an M1.</p></div></div>' +
      '<div class="info-row"><span class="ic">🌙</span><div><b>Why is the Moon hit harder than Mars?</b><p>The Moon has no air at all, so nothing slows a solar storm down. Mars has thin air that soaks up part of it. In this game a storm on Mars is half as strong as on the Moon. That half is a game number.</p></div></div>' +
      '<p class="sunwatch-how"><b>Real:</b> every flare, particle storm, CME, date and time here (NASA DONKI). On the Moon, the particle storms are the ones NASA’s satellites measured near Earth. On Mars, no detector reports to DONKI, so the game checks each fast CME against where Mars really was and how well it was linked to the eruption. <b>Game:</b> how many badge points a storm costs.</p>' +
      sourceHtml(m);
  }

  function starFacts(m) {
    var P = m.s && m.s.site ? m.s.site : null, soak = P && P.stormMult < 1 ? Math.round((1 - P.stormMult) * 100) : 0;
    return '<h3>🔎 How to read this</h3>' +
      '<div class="info-row"><span class="ic">☀️</span><div><b>What is a flare?</b><p>A giant flash on a star: light and X-rays. On our own Sun, scientists see thousands every year. A flash takes minutes to cross to a planet. It is the first sign that something happened.</p></div></div>' +
      '<div class="info-row"><span class="ic">☁️</span><div><b>What is a CME?</b><p>A coronal mass ejection: a giant cloud of hot gas thrown off a star. It takes a few days to reach a planet. A fast one pushes a shock wave ahead of it, like a boat’s bow wave.</p></div></div>' +
      '<div class="info-row"><span class="ic">☢️</span><div><b>So what is a radiation storm?</b><p>Protons sped up to huge speeds, mostly by that shock wave. They race along the star’s spiral magnetic field, so they only reach a planet linked to the right part of the star. That is why ' + esc(m.planet) + ' can miss a big flare and be hit by a smaller one.</p></div></div>' +
      '<div class="info-row"><span class="ic">🔠</span><div><b>What do the letters mean?</b><p>Scientists sort our Sun’s flares by strength: A, B, C, M and X. Each letter is 10 times stronger than the one before. The game sorts ' + esc(m.starName) + '’s made-up flares the same way.</p></div></div>' +
      (soak ? '<div class="info-row"><span class="ic">🌫️</span><div><b>Why does ' + esc(m.planet) + ' get off lightly?</b><p>Its air is thick, and thick air soaks up fast particles, the way Earth’s air protects us. In this game it stops about ' + soak + '% of a storm. That number is a game number.</p></div></div>' : '') +
      '<p class="sunwatch-how"><b>Made up:</b> ' + esc(m.starName) + ', and every flare, CME, particle storm and day here. <b>Real:</b> the physics behind them, which works the same way on our Sun. <b>Game:</b> how many badge points a storm costs.</p>' +
      sourceHtml(m);
  }

  // ---------- public: the card as an HTML string ----------
  function part(fn, m) { try { return fn(m) || ''; } catch (e) { return ''; } }
  function html(s, data) {
    var m = null;
    try { m = build(s, data); } catch (e) { m = null; }
    if (!m) return '<div class="sunwatch"><h2>☀️ Sun Watch</h2><p>Sun Watch could not read the flare list this time.</p>' + sourceHtml(null) + '</div>';
    return '<div class="sunwatch">' + part(headHtml, m) + part(chartHtml, m) + part(rowsHtml, m) + part(factsHtml, m) + '</div>';
  }

  // ---------- public: open the card on top of the game ----------
  // Point at the chart (or tap it, or use the arrow keys) and the nearest flare is read out below it.
  function wire(root) {
    var svg = root.querySelector('.sunwatch-chart'), read = root.querySelector('.sunwatch-read'), ring = root.querySelector('.sunwatch-pick');
    if (!svg || !read || !ring) return;
    var dots = Array.prototype.slice.call(svg.querySelectorAll('[data-tip]')), at = -1;
    if (!dots.length) return;
    dots.sort(function (a, b) { return a.getAttribute('data-x') - b.getAttribute('data-x'); });
    read.textContent = 'Point at a dot, or tap it, to see that ' + (svg.getAttribute('data-made') ? 'made-up' : 'real') + ' flare.';
    function show(i) {
      var d = dots[i];
      if (!d) return;
      at = i;
      ring.setAttribute('cx', d.getAttribute('data-x') + '%');
      ring.setAttribute('cy', d.getAttribute('data-y'));
      ring.setAttribute('class', 'sunwatch-pick sunwatch-on');
      read.textContent = d.getAttribute('data-tip');
    }
    function nearest(e) {
      var box = svg.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top, best = -1, min = 26 * 26;
      dots.forEach(function (d, i) {
        var dx = d.getAttribute('data-x') / 100 * box.width - x, dy = d.getAttribute('data-y') - y, q = dx * dx + dy * dy;
        if (q < min) { min = q; best = i; }
      });
      return best;
    }
    svg.addEventListener('mousemove', function (e) { var i = nearest(e); if (i >= 0 && i !== at) show(i); });
    svg.addEventListener('click', function (e) { show(nearest(e)); });
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' || e.key === 'Right' ? 1 : e.key === 'ArrowLeft' || e.key === 'Left' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      show(at < 0 ? (step > 0 ? 0 : dots.length - 1) : Math.max(0, Math.min(dots.length - 1, at + step)));
    });
  }
  function open(s, data) {
    try {
      if (!JA.game || typeof JA.game.openInfo !== 'function') return null;
      var root = JA.game.openInfo(html(s, data)) || document.getElementById('info-root');
      if (!root) return null;
      // the game puts the focus on "Got it" at the bottom of this long card: scroll back up to the heading
      for (var el = root.querySelector('.sunwatch'); el && el !== root; el = el.parentNode) el.scrollTop = 0;
      try { wire(root); } catch (e) { /* the card still works without the pointer read-out */ }
      return root;
    } catch (e) { return null; }
  }

  JA.sunwatch = { html: html, open: open };
})(window.JA);
