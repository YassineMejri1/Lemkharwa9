/* Astro Outpost — the Field Journal.
   Every piece of real science you meet (a "why did that happen?" card, a rock discovery, a night-report
   fact, what real crews did in a crisis...) becomes a page in this journal and stays there, mission
   after mission. Pages you have not found yet show a hint about where to look, so there is always
   something left to hunt for. The journal is kept only in this browser (localStorage), one for each place. */
(function (JA) {
  'use strict';
  var J = JA.journal = {};
  var KEY = 'ja-journal', data = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() {
    if (data) return data;
    try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { data = {}; }
    if (!data || typeof data !== 'object') data = {};
    return data;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode: the journal lasts until the page closes */ } }
  function pick(v, site) { return JA.siteText(v, site); }

  var GROUPS = [
    { kind: 'why', icon: '🧠', name: 'Why things happen' },
    { kind: 'find', icon: '🔬', name: 'Rock discoveries' },
    { kind: 'inst', icon: '🛰️', name: 'Instruments' },
    { kind: 'photo', icon: '📸', name: 'Postcards' },
    { kind: 'crisis', icon: '🧭', name: 'What real crews did' },
    { kind: 'day', icon: '💡', name: 'Daily lessons' },
    { kind: 'fact', icon: '🛰️', name: 'Real space facts' }
  ];

  // Every page there is to find in one place, in the order the journal shows them.
  var cache = {};
  J.pages = function (site) {
    if (cache[site]) return cache[site];
    var out = [], word = JA.siteOf(site).dayWord.toLowerCase();
    function add(kind, id, icon, title, text, src, hint, holo) { out.push({ kind: kind, id: String(id), icon: icon, title: title, text: text, src: src, hint: hint, holo: holo || '' }); }
    (JA.MECHS || []).forEach(function (m) { if (!m.site || m.site === site) add('why', m.id, m.icon, pick(m.title, site), pick(m.text, site), pick(m.src, site), pick(m.hint, site), m.holo); });
    (JA.GEO[site] || []).forEach(function (place, i) {
      place.finds.forEach(function (f, n) { add('find', i + '-' + n, place.icon, f.title, f.text, f.src, 'Drill ' + (n ? 'a second' : 'a') + ' rock core at the ' + place.name + ' and study it in the Lab.'); });
    });
    (JA.INSTRUMENTS[site] || []).forEach(function (x) { add('inst', x.id, x.icon, x.name, x.text, x.src, 'Carry the ' + x.name + ' from the rocket pad to its blue ring.'); });
    (JA.PHOTOS[site] || []).forEach(function (x, i) { add('photo', i, '📸', x.name, x.text, x.src, 'Find a photo spot and take a postcard photo.'); });
    Object.keys(JA.CRISES || {}).forEach(function (id) {
      var c = JA.CRISES[id];
      add('crisis', id, c.icon, c.title, pick(c.science, site), pick(c.src, site), 'Live through this crisis: ' + c.alarm.toLowerCase() + '. It does not come on every mission.');
    });
    (JA.DAYS || []).forEach(function (d, i) { add('day', i, d.icon, d.topic, pick(d.learn, site), pick(d.src, site), 'Reach ' + word + ' ' + (i + 1) + ' of a mission.'); });
    if (JA.LAUNCH_DAY) add('day', 'launch', JA.LAUNCH_DAY.icon, JA.LAUNCH_DAY.topic, JA.LAUNCH_DAY.learn, JA.LAUNCH_DAY.src, 'Reach the last ' + word + ' of a mission.');
    (JA.FACTS || []).forEach(function (f) { if (f.site === 'any' || f.site === site) add('fact', f.id, '🛰️', '', f.text, f.src, 'Turns up in a night report.'); });
    cache[site] = out;
    return out;
  };

  J.has = function (site, kind, id) { var d = load()[site]; return !!(d && d[kind + ':' + id]); };
  // Write a page into the journal. Returns true the first time, so the game can celebrate a new page.
  J.add = function (site, kind, id) {
    var d = load(), k = kind + ':' + id;
    if (!JA.SITES[site]) return false;
    if (!J.pages(site).some(function (p) { return p.kind === kind && p.id === String(id); })) return false;
    d[site] = d[site] || {};
    if (d[site][k]) return false;
    d[site][k] = 1; save();
    return true;
  };
  J.count = function (site) {
    var pages = J.pages(site), have = 0;
    pages.forEach(function (p) { if (J.has(site, p.kind, p.id)) have++; });
    return { have: have, total: pages.length };
  };
  J.totals = function () {
    return Object.keys(JA.SITES).reduce(function (t, id) { var c = J.count(id); t.have += c.have; t.total += c.total; return t; }, { have: 0, total: 0 });
  };

  function pageHtml(site, p, canHolo) {
    var src = JA.SOURCES[p.src];
    if (!J.has(site, p.kind, p.id)) return '<div class="jr off"><em>❔</em><div><b>Not found yet</b><p>' + esc(p.hint) + '</p></div></div>';
    return '<div class="jr"><em>' + p.icon + '</em><div>' + (p.title ? '<b>' + esc(p.title) + '</b>' : '') + '<p>' + esc(p.text) + '</p>' +
      (src ? '<small>Source: ' + esc(src.name) + '</small>' : '') +
      (p.holo && canHolo(p.holo) ? '<button class="jr-holo" data-holo="' + p.holo + '">▶ Play the hologram</button>' : '') + '</div></div>';
  }
  J.html = function (site, canHolo) {
    var pages = J.pages(site), c = J.count(site);
    var pct = Math.round(c.have / Math.max(1, c.total) * 100);
    var html = '<h2>📓 Field Journal</h2><p class="sub">Every piece of real science you meet is kept here, mission after mission. Empty pages tell you where to look.</p>' +
      '<div class="jr-tabs" role="tablist">' + Object.keys(JA.SITES).map(function (id) {      // one tab for every planet
        var P = JA.SITES[id], n = J.count(id);
        return '<button class="jr-tab' + (site === id ? ' sel' : '') + '" data-site="' + id + '" role="tab" aria-selected="' + (site === id) + '">' + P.emoji + ' ' + esc(P.short) + ' <b>' + n.have + '/' + n.total + '</b></button>';
      }).join('') + '</div>' +
      '<div class="jr-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
      '<p class="jr-count"><b>' + c.have + '</b> of ' + c.total + ' pages found on ' + esc(JA.SITES[site].name) + (c.have >= c.total ? ' · every single one! 🏆' : '') + '</p>';
    GROUPS.forEach(function (g) {
      var list = pages.filter(function (p) { return p.kind === g.kind; }); if (!list.length) return;
      var got = list.filter(function (p) { return J.has(site, p.kind, p.id); }).length;
      // found pages first, so there is something to read at the top of each chapter
      list = list.filter(function (p) { return J.has(site, p.kind, p.id); }).concat(list.filter(function (p) { return !J.has(site, p.kind, p.id); }));
      html += '<details class="jr-group"' + (got ? ' open' : '') + '><summary><span>' + g.icon + ' ' + g.name + '</span><i>' + got + '/' + list.length + '</i></summary><div class="jr-list">' +
        list.map(function (p) { return pageHtml(site, p, canHolo); }).join('') + '</div></details>';
    });
    return html;
  };
  // Open the journal on top of whatever is showing. hooks.holo(id) plays a hologram; hooks.sound() makes the tap sound.
  J.open = function (site, hooks) {
    hooks = hooks || {};
    if (!JA.game || !JA.game.openInfo) return;
    function canHolo(id) { return !!(hooks.holo && JA.holo && JA.holo.has && JA.holo.has(id)); }
    function draw(st) {
      var root = JA.game.openInfo(J.html(st, canHolo)), box = root.querySelector('.modal');
      if (box) { box.classList.add('journal'); box.scrollTop = 0; }      // the "Got it" button takes the focus: start at the top all the same
      Array.prototype.forEach.call(root.querySelectorAll('.jr-tab'), function (b) {
        b.addEventListener('click', function () { if (hooks.sound) hooks.sound(); draw(b.getAttribute('data-site')); });
      });
      Array.prototype.forEach.call(root.querySelectorAll('.jr-holo'), function (b) {
        b.addEventListener('click', function () { hooks.holo(b.getAttribute('data-holo')); });
      });
    }
    draw(JA.SITES[site] ? site : 'moon');
  };
})(window.JA);
