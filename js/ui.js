/* Astro Outpost — on-screen interface: meters, goals, prompts, waypoints, mini-game gauges, pop-up cards. */
(function (JA) {
  'use strict';
  var R = JA.RULES, sim = JA.sim;
  var U = JA.ui = {};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  U.$ = $; U.esc = esc; U.show = show;

  // ---------- pop-up cards (these pause the game) ----------
  var root = $('modal-root');
  U.modal = function (html, opts) {
    opts = opts || {};
    root.innerHTML = '<div class="modal ' + (opts.cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    root.className = 'open';
    var acts = opts.actions || {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-act]'), function (el) {
      el.addEventListener('click', function () { var fn = acts[el.getAttribute('data-act')]; if (fn) fn(el); });
    });
    var first = root.querySelector('.btn.primary') || root.querySelector('button');
    if (first && !opts.noFocus) { try { first.focus({ preventScroll: true }); } catch (e) { /* older browsers */ } }
    // a recorded greeting when there is one; with read-aloud on, the whole card is read instead
    if (!(opts.line && !JA.audio.readingOn() && JA.audio.line(opts.line)) && opts.speak) JA.audio.speak(opts.speak);
    return root.firstChild;
  };
  U.closeModal = function () { root.className = ''; root.innerHTML = ''; };
  // Tab stays inside the open card instead of wandering to the buttons behind it
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var info = $('info-root'), box = info && info.classList.contains('open') ? info : U.modalOpen() ? root : null;
    if (!box) return;
    var f = box.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]'), a = document.activeElement;
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1], inside = box.contains(a);
    if (e.shiftKey && (!inside || a === first)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (!inside || a === last)) { first.focus(); e.preventDefault(); }
  });
  U.modalOpen = function () { return root.classList.contains('open'); };
  U.fade = function (on) { $('fade').classList.toggle('on', !!on); };

  // ---------- top bar ----------
  // Everything here runs every frame, so each part remembers what it shows and only
  // touches the page when that changes.
  // A one-shot CSS animation is restarted by swapping between two copies of it (pop-a / pop-b),
  // which does not force the browser to lay the page out again.
  function pop(o, el) { o.flip = !o.flip; el.classList.toggle('pop-a', o.flip); el.classList.toggle('pop-b', !o.flip); }
  var meters = {};
  Array.prototype.forEach.call(document.querySelectorAll('.meter'), function (m) {
    meters[m.getAttribute('data-res')] = { el: m, val: m.querySelector('.m-val'), bar: m.querySelector('.m-bar i'), note: m.querySelector('.m-note'),
      last: null, w: null, n: null, low: null, bad: null, dir: '', flip: false, wasLow: null };
  });
  function setMeter(id, value, low, note, bad) {
    var m = meters[id], v = Math.round(value);
    if (!m) return;
    if (m.last !== v) {
      if (m.last !== null && Math.abs(v - m.last) >= 3) {
        // the number pops green when things get better, pink when worse (more radiation is worse)
        var dir = (id === 'dose' ? v < m.last : v > m.last) ? 'good' : 'bad';
        if (m.dir !== dir) { m.dir = dir; m.el.setAttribute('data-dir', dir); }
        pop(m, m.el);
      }
      m.last = v; m.val.textContent = v + (id === 'dose' ? '%' : '');      // the filter's % sign is added by css/learn.css, where there is room
    }
    var w = Math.round(Math.max(0, Math.min(100, value)));
    if (m.w !== w) { m.w = w; m.bar.style.width = w + '%'; }
    low = !!low; bad = !!bad;
    if (m.low !== low) { if (low && m.low === false) JA.audio.play('low'); m.low = low;   // a soft ping the moment a meter turns red
      m.el.classList.toggle('low', low); }
    if (m.n !== note) { m.n = note; m.note.textContent = note || ''; }
    if (m.bad !== bad) { m.bad = bad; m.note.classList.toggle('bad', bad); }
  }
  var hud = { sol: $('sol-text'), site: $('site-text'), fill: $('clock-fill'), sun: $('clock-sun'), storm: $('clock-storm'), left: $('time-left') };
  var lastSol = '', lastTime = '', lastF = -1, lastStorm = '', stormNow = false;
  U.setHud = function (s) {
    var L = s.level, left = Math.max(0, 1 - s.t / s.dayLength), last = s.sol >= s.totalSols;
    var solText = s.site.dayWord + ' ' + s.sol + ' of ' + s.totalSols;
    if (solText !== lastSol) {
      lastSol = solText;
      hud.sol.innerHTML = '<small>' + esc(s.site.dayWord) + '</small> <span class="n">' + s.sol + '</span> <span class="of">of ' + s.totalSols + '</span>';
      hud.site.textContent = s.site.short + ' · ' + L.name;
    }
    var stale = sim.stale(s), airNeed = (sim.airDrain(s) * stale + s.leak) * left, airBad = s.air < airNeed, dinner = sim.dinner(s);
    var dinnerBad = !last && s.food < dinner;
    var airNote = s.leak > 0 ? 'leaking!' : stale > 1 ? 'stale air: draining fast' : airBad ? 'not enough for today!' : 'enough for today';
    setMeter('air', s.air, s.air < 18 || airBad || s.leak > 0, airNote, airBad || s.leak > 0 || stale > 1);
    setMeter('food', s.food, dinnerBad, last ? 'no dinner: launch day' : (dinnerBad ? 'dinner needs ' + dinner + '!' : 'dinner tonight −' + dinner), dinnerBad);
    var secs = Math.max(0, Math.ceil(s.dayLength - s.t)), tl = Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2) + ' left';
    if (tl !== lastTime) { lastTime = tl; hud.left.textContent = tl; hud.left.classList.toggle('low', left < 0.15); }
    // the notes get sharper as things get worse, and say what it means
    var d = s.dose, fl = s.filter, wt = s.water;
    setMeter('dose', d, d >= 75, d >= 90 ? 'almost full: stay indoors!' : d >= 75 ? 'danger: shelter and shield' : d >= 50 ? 'half full · never goes down' : 'home shield ' + Math.round(sim.shield(s) * 100) + '%', d >= 75);
    setMeter('filter', fl, fl < R.filterWarn, fl <= 0 ? 'full: air drains faster' : fl < R.filterWarn ? 'nearly full: bake it' : fl < 60 ? 'soaking up CO₂' : 'clean', fl < R.filterWarn);
    setMeter('water', wt, wt < R.waterWarn, wt < 1 ? 'empty: plants stop' : wt < R.waterWarn ? 'low: plants thirsty first' : 'crew and plants', wt < R.waterWarn);
    // the town's spirit: a meter that only appears once settlers have arrived
    var town = s.colony, tm = meters.town;
    if (tm) {
      var live = !!town && town.stage >= 2;
      if (tm.shown !== live) { tm.shown = live; show(tm.el, live); }
      if (live) setMeter('town', town.spirit, town.spirit < R.spiritLow, town.people + ' people' + (town.spirit >= R.spiritHelp ? ' · helping' : town.spirit < R.spiritLow ? ' · need food' : ''), town.spirit < R.spiritLow);
    }
    // the shift bar moves in steps of 0.1%, so it is written a few times a second, not every frame
    var f = Math.round(Math.min(1, s.t / s.dayLength) * 1000) / 10;
    if (f !== lastF) { lastF = f; hud.fill.style.width = f + '%'; hud.sun.style.left = f + '%'; }
    var st = s.storm, sk = st && st.warned ? (st.start / s.dayLength * 100).toFixed(2) + '|' + ((st.end - st.start) / s.dayLength * 100).toFixed(2) : '';
    if (sk !== lastStorm) {
      lastStorm = sk;
      hud.storm.classList.toggle('show', !!sk);
      if (sk) { hud.storm.style.left = sk.split('|')[0] + '%'; hud.storm.style.width = sk.split('|')[1] + '%'; }
    }
    var inStorm = !!sk && s.t >= st.start && s.t < st.end;
    if (inStorm !== stormNow) { stormNow = inStorm; hud.storm.classList.toggle('now', inStorm); }
  };

  // ---------- goals ----------
  // Must-do jobs first, then the bonus jobs (optional: the challenge, shield, science...).
  // Rows are kept and updated in place (found again by their emoji), so when a job gets done
  // its tick can animate instead of the whole list being redrawn.
  var goalKey = '', goalTitle = null, goalRows = {}, goalBox = $('goals'), goalUl = $('goal-list');
  var goalCount = goalBox.querySelector('.g-count'), goalProg = goalBox.querySelector('.g-prog i'), goalSep = document.createElement('li');
  goalSep.className = 'g-sep'; goalSep.textContent = 'Bonus jobs';
  function goalRow() {
    var li = document.createElement('li');
    li.innerHTML = '<span class="g-ic"></span><span class="g-tx"><span></span></span><em class="g-now">Now</em>';
    return { el: li, ic: li.firstChild, tx: li.childNodes[1].firstChild, cls: null, icon: null, text: null };
  }
  U.setGoals = function (title, list) {
    var key = title + '|' + list.map(function (g) { return g.icon + g.text + (g.done ? 1 : 0) + (g.now ? 2 : 0) + (g.optional ? 4 : 0); }).join('|');
    if (key === goalKey) return;
    goalKey = key;
    if (title !== goalTitle) { goalTitle = title; $('goals-title').textContent = title; }
    var must = list.filter(function (g) { return !g.optional; }), extra = list.filter(function (g) { return g.optional; });
    var done = must.filter(function (g) { return g.done; }).length, seen = {}, rows = [], i;
    goalCount.textContent = done + '/' + must.length;
    goalProg.style.width = (must.length ? Math.round(done / must.length * 100) : 0) + '%';
    goalBox.classList.toggle('empty', !list.some(function (g) { return g.now; }));
    must.concat(extra).forEach(function (g) {
      if (g === extra[0] && must.length) rows.push(goalSep);
      var id = g.icon || '•', n = 1;
      while (seen[id + n]) n++;
      id += n; seen[id] = true;
      var r = goalRows[id] || (goalRows[id] = goalRow());
      var cls = 'goal' + (g.optional ? ' g-opt' : '') + (g.done ? ' done' : g.now ? ' now' : '');
      if (r.cls !== cls) { r.cls = cls; r.el.className = cls; }
      if (r.icon !== g.icon) { r.icon = g.icon; r.ic.textContent = g.icon || '•'; }
      if (r.text !== g.text) { r.text = g.text; r.tx.textContent = g.text; r.ic.title = g.text; }   // the icon's tooltip says the job when the list is folded
      rows.push(r.el);
    });
    // put the rows in order, moving only the ones that are out of place
    for (i = 0; i < rows.length; i++) if (goalUl.children[i] !== rows[i]) goalUl.insertBefore(rows[i], goalUl.children[i] || null);
    while (goalUl.children.length > rows.length) goalUl.removeChild(goalUl.lastChild);
    Object.keys(goalRows).forEach(function (id) { if (!seen[id]) delete goalRows[id]; });
  };
  // ---------- windows you scroll ----------
  // They have no scroll bar. A soft fade at the top or bottom edge (windows.css) shows there is more to read that way.
  function edgeHints(el) {
    var up = el.scrollTop > 2, down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    if (el.classList.contains('more-up') !== up) el.classList.toggle('more-up', up);
    if (el.classList.contains('more-down') !== down) el.classList.toggle('more-down', down);
  }
  function isWindow(el) { return !!(el && el.classList && (el.classList.contains('modal') || el.classList.contains('holo-panel'))); }
  function scanEdges() { document.querySelectorAll('.modal, .holo-panel').forEach(edgeHints); }
  document.addEventListener('scroll', function (e) { if (isWindow(e.target)) edgeHints(e.target); }, true);
  // a window opens, redraws or opens a section: look again (the observer gathers each burst of changes into one call)
  if (window.MutationObserver) new MutationObserver(scanEdges).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
  window.addEventListener('resize', scanEdges);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', scanEdges);   // a font arriving changes the height

  // The fold button: the list folds into a narrow strip with only the icons, and opens again.
  // The choice is remembered in this browser.
  var goalFold = $('goals-fold'), FOLD_KEY = 'ja-goals-folded', calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function foldGoals(on, byUser) {
    goalBox.classList.toggle('folded', on);
    goalFold.setAttribute('aria-expanded', String(!on));
    goalFold.setAttribute('aria-label', on ? 'Open the job list' : 'Fold the job list into a strip of icons');
    goalFold.title = on ? 'Open the job list' : 'Fold the job list';
    if (!byUser) return;
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch (e) { /* private mode: it lasts until the page closes */ }
    // the rows fade in at their new size, so the change reads as one quick move
    if (goalUl.animate && !(calm && calm.matches)) goalUl.animate([{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  }
  var foldSaved = null;
  try { foldSaved = localStorage.getItem(FOLD_KEY); } catch (e) { foldSaved = null; }
  foldGoals(foldSaved === '1', false);
  goalFold.addEventListener('click', function (e) {
    foldGoals(!goalBox.classList.contains('folded'), true);
    JA.audio.play('tap');
    if (e.detail) goalFold.blur();      // after a mouse click, Space must jump again instead of pressing the button
  });

  // ---------- banner, radio, prompt, hands ----------
  var bannerText = null;
  U.banner = function (text, cls) {
    var b = $('banner');
    if (!text) { if (bannerText !== null) { bannerText = null; b.classList.add('hidden'); document.body.classList.remove('has-banner'); } return; }
    if (bannerText === text + cls) return;
    document.body.classList.add('has-banner');
    bannerText = text + cls; b.className = cls || ''; b.textContent = text;
  };
  var lastSay = '';
  // Mission Control on Earth, over the radio.
  // vid: the recorded voice line for these words (a list plays one after the other); without one, read-aloud speaks them
  U.say = function (text, vid, why) {
    if (!text || text === lastSay) return;
    lastSay = text;
    var b = $('radio');
    b.classList.remove('hidden');
    b.classList.toggle('can-why', !!why);
    $('radio-text').textContent = text;
    b.classList.remove('say'); void b.offsetWidth; b.classList.add('say');
    if (!JA.audio.line(vid)) JA.audio.speak(text);
  };
  var promptKey = null;
  U.prompt = function (text, key, info) {
    var p = $('prompt'), k = text ? text + key + (info ? 1 : 0) : null;
    if (k === promptKey) return;
    promptKey = k;
    if (!text) { p.classList.add('hidden'); return; }
    p.className = info ? 'info' : '';
    $('prompt-key').textContent = key || 'E'; $('prompt-text').textContent = text;
  };
  var handsKey = null;
  U.hands = function (item, power, hint) {
    var h = $('hands');
    if (!item) { if (handsKey !== null) { handsKey = null; h.classList.add('hidden'); } return; }
    var def = JA.ITEMS[item.type], k = item.type + hint;
    if (k !== handsKey) {
      handsKey = k; h.classList.remove('hidden');
      $('hands-icon').textContent = def.icon; $('hands-name').textContent = item.data && item.data.name ? item.data.name : def.name; $('hands-hint').textContent = hint;
    }
    $('power-fill').style.width = Math.round((power || 0) * 100) + '%';
  };
  U.roverHud = function (charge, on, cap) {
    var h = $('rover-hud');
    show(h, !!on); if (!on) return;
    $('rover-text').textContent = charge > 0 ? 'Rover battery · ' + Math.ceil(charge) + ' s' : 'Battery empty — crawling!';
    $('rover-fill').style.width = Math.round(Math.min(1, charge / (cap || R.roverMax)) * 100) + '%';
  };

  // ---------- mini-games ----------
  // Drilling: a gauge with the good layer (green zone) and the drill bit, which the player steers.
  // Texts are only written when they change, so the emoji-to-icon swapper is not run every frame.
  var drillK = {};
  function drillText(id, t) { if (drillK[id] !== t) { drillK[id] = t; $(id).textContent = t; } }
  function heatColour(h) {                               // white -> yellow -> red as the drill heats up
    var a = [255, 255, 255], b = [255, 210, 63], c = [255, 84, 104], t = Math.min(1, Math.max(0, h)), p, q, k;
    if (t < 0.5) { p = a; q = b; k = t * 2; } else { p = b; q = c; k = (t - 0.5) * 2; }
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(p[i] + (q[i] - p[i]) * k); }).join(',') + ')';
  }
  U.drillUi = function (m) {
    var el = $('mini');
    if (!m) { el.classList.add('hidden'); el.classList.remove('drill-out'); drillK = {}; return; }
    el.classList.remove('hidden');
    show($('mini-heat-row'), true); show($('mini-dial'), false); show($('mini-pips'), false);
    show($('drill-gauge'), true); show($('mini-slip-row'), true);
    $('mini-depth').parentNode.parentNode.classList.remove('hidden');
    drillText('mini-title', m.title); drillText('mini-hint', m.hint);
    if (drillK.icon !== m.icon) { drillK.icon = m.icon; $('drill-ic').innerHTML = JA.iconHTML ? JA.iconHTML(m.icon) : m.icon; }
    // the track (-1..1) maps to 3..97% of the gauge, so the bit stays in sight against either wall
    var g = $('drill-gauge'), out = !m.inside, bit = $('drill-bit'), bx = 3 + (m.x + 1) * 47;
    $('drill-zone').style.left = (3 + (m.zc - m.zw + 1) * 47) + '%'; $('drill-zone').style.width = (m.zw * 94) + '%';
    bit.style.left = bx + '%';
    bit.style.transform = m.on ? 'translateX(' + ((Math.random() - 0.5) * (2 + m.heat * 5)).toFixed(1) + 'px)' : '';   // the bit shakes while it spins
    bit.style.setProperty('--bit', heatColour(m.heat));
    g.classList.toggle('out', out); g.classList.toggle('bite', m.on); g.classList.toggle('jolt', m.flash > 0);
    el.classList.toggle('drill-out', out);
    var bump = $('drill-bump');                          // a hard pebble is about to jolt the bit this way
    show(bump, m.bumpWarn > 0);
    if (m.bumpWarn > 0) { bump.style.left = Math.min(92, Math.max(8, bx + m.bumpDir * 10)) + '%'; drillText('drill-bump', m.bumpDir > 0 ? '⚡▶' : '◀⚡'); }
    $('mini-depth').style.width = Math.round(Math.min(1, m.depth) * 100) + '%';
    $('mini-heat').style.width = Math.round(Math.min(1, m.heat) * 100) + '%';
    $('mini-heat').parentNode.classList.toggle('hot', m.heat > 0.75);
    $('mini-slip').style.width = Math.round(Math.min(1, m.slip) * 100) + '%';
    $('mini-slip').parentNode.classList.toggle('hot', m.slip > 0.6);
  };
  U.dialUi = function (m) {
    var el = $('mini');
    if (!m) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden', 'drill-out');
    show($('drill-gauge'), false); show($('mini-slip-row'), false);
    show($('mini-heat-row'), false); $('mini-depth').parentNode.parentNode.classList.add('hidden');
    show($('mini-dial'), true); show($('mini-pips'), true);
    $('mini-title').textContent = m.title; $('mini-hint').textContent = m.hint;
    $('dial-zone').style.left = ((m.c - m.w / 2) * 100) + '%'; $('dial-zone').style.width = (m.w * 100) + '%';
    $('dial-needle').style.left = (m.needle * 100) + '%';
    var p = '';
    for (var i = 0; i < m.need; i++) p += '<i class="' + (i < m.hits ? 'on' : '') + '"></i>';
    if ($('mini-pips').getAttribute('data-k') !== p) { $('mini-pips').innerHTML = p; $('mini-pips').setAttribute('data-k', p); }
  };

  // ---------- discovery cards (do not pause the game) ----------
  // The card's time on screen is counted in game time (see tickCards), so a card is never
  // used up behind a pause, a crisis or a hidden tab.
  // A "why" card explains something that just happened. When the wrist tablet has a hologram for it, tapping the
  // card (or pressing T) plays it: U.onHolo is set by the game.
  var cardQ = [], cardOn = false, cardLeft = 0, cardNow = null;
  var coarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  function nextCard() {
    var c = $('card');
    cardOn = false; cardLeft = 0; cardNow = null;
    if (!cardQ.length) { c.classList.add('hidden'); return; }
    var f = cardQ.shift(), src = JA.SOURCES[f.src], why = f.kind === 'why';
    c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    c.className = f.kind === 'conseq' ? 'conseq ' + (f.tone || 'mixed') : why ? 'why' + (f.holo ? ' has-holo' : '') : '';
    $('card-icon').textContent = f.icon || '🧪';
    $('card-kicker').textContent = f.kind === 'conseq' ? 'What your choice led to' : why ? 'Why did that happen?' + (f.fresh ? ' · 📓 new page' : '')
      : (f.kind === 'core' ? 'Discovery at ' + f.place : f.kind === 'inst' ? 'Instrument online' : f.kind === 'meteor' ? 'A rock from space' : 'Postcard');
    $('card-title').textContent = f.title;
    $('card-text').textContent = f.text + (f.perk ? ' ' + f.perk : '');
    $('card-src').textContent = why && f.holo ? (coarse ? '▶ Tap to see how it works' : '▶ Tap, or press T, to see how it works')
      : src ? 'Source: ' + src.name : f.kind === 'conseq' ? 'Tap to close' : '';
    JA.audio.speak(f.kind === 'conseq' ? f.text : f.title + '. ' + f.text);
    cardOn = true; cardNow = f; cardLeft = f.kind === 'conseq' ? 14 : why ? 13 : 11;
  }
  U.card = function (find) { cardQ.push(find); if (!cardOn) nextCard(); };
  U.clearCards = function () { cardQ = []; cardOn = false; cardLeft = 0; cardNow = null; $('card').classList.add('hidden'); };
  U.tickCards = function (dt) { if (cardOn && (cardLeft -= dt) <= 0) nextCard(); };
  U.cardNow = function () { return cardOn ? cardNow : null; };
  U.nextCard = nextCard;
  $('card').addEventListener('click', function () {
    var f = cardNow;
    nextCard();
    if (f && f.holo && U.onHolo) U.onHolo(f.holo);
  });

  // ---------- in-world tags and waypoint markers (re-used DOM nodes) ----------
  var tagPool = [], markPool = [];
  function pooled(pool, i, cls) {
    if (!pool[i]) { var el = document.createElement('div'); el.className = cls; $('tags').appendChild(el); pool[i] = { el: el, k: '' }; }
    return pool[i];
  }
  U.tags = function (list) {
    var i;
    for (i = 0; i < list.length; i++) {
      var t = list[i], p = pooled(tagPool, i, 'tag'), k = t.text + '|' + (t.cls || '');
      if (p.k !== k) { p.k = k; p.el.textContent = t.text; p.el.className = 'tag ' + (t.cls || ''); }
      p.el.style.display = '';
      p.el.style.transform = 'translate(-50%, -100%) translate(' + Math.round(t.x) + 'px,' + Math.round(t.y) + 'px)';
    }
    for (; i < tagPool.length; i++) tagPool[i].el.style.display = 'none';
  };
  U.marks = function (list) {
    var i;
    for (i = 0; i < list.length; i++) {
      var m = list[i], p = pooled(markPool, i, 'mark'), k = m.icon + '|' + m.label + '|' + (m.cls || '') + '|' + m.color;
      if (p.k !== k) { p.k = k; p.el.className = 'mark ' + (m.cls || ''); p.el.style.setProperty('--c', m.color || '#fff'); p.el.innerHTML = '<i>' + m.icon + '</i><span>' + esc(m.label) + '</span>'; }
      else if (m.label) p.el.lastChild.textContent = m.label;
      p.el.style.display = '';
      p.el.style.transform = 'translate(-50%, -50%) translate(' + Math.round(m.x) + 'px,' + Math.round(m.y) + 'px)';
    }
    for (; i < markPool.length; i++) markPool[i].el.style.display = 'none';
  };
  U.stormFx = function (mode) { var e = $('storm-fx'); if (e.className !== (mode || '')) e.className = mode || ''; };
  // floating "+12 💨" pills over the world; --c tints the pill's ring and glow
  U.toast = function (text, x, y, color) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.color = color || '#fff'; t.style.setProperty('--c', color || '#fff');
    $('toasts').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1350);
  };

  // ---------- text helpers shared by the cards ----------
  U.dataTag = function (s) { return s.weatherSource === 'live' ? '<span class="tagline">Live NASA data</span>' : '<span class="tagline archive">NASA archive</span>'; };
  U.stormWords = function (level) { return level >= 3 ? 'A BIG solar storm' : level === 2 ? 'A medium solar storm' : 'A small solar storm'; };
  U.weatherRow = function (s, w, known, when) {
    var date = w && w.date ? JA.weather.prettyDate(w.date) : '';
    if (!known) {
      return '<div class="info-row"><span class="ic">❓</span><div><b>No space-weather forecast</b>' +
        '<p>The Radio Dish was off, so Earth could not send a forecast. Your suit\'s small sensor only gives a few seconds of warning.</p></div></div>';
    }
    if (!w || w.level === 0) {
      var what = w && w.cls ? 'only small flares (the strongest was class ' + esc(w.cls) + ')' : 'no solar flares at all';
      return '<div class="info-row good"><span class="ic">😎</span><div><b>Quiet Sun ' + when + '</b>' +
        '<p>' + U.dataTag(s) + 'On ' + date + ' NASA recorded ' + what + '. No radiation storm.</p></div></div>';
    }
    return '<div class="info-row alert"><span class="ic">🌩️</span><div><b>' + U.stormWords(w.level) + ' ' + when + '!</b>' +
      '<p>' + U.dataTag(s) + 'On ' + date + ' the real Sun fired a class <b>' + esc(w.cls) + '</b> flare' + (w.time ? ' at ' + esc(w.time) + ' UTC' : '') +
      '. Soil bags on the dome help — and do not get caught far from home!</p></div></div>';
  };
  U.findRow = function (f) {
    return '<div class="find"><em>' + (f.icon || '🧪') + '</em><div><b>' + esc(f.title) + '</b><span>' + esc(f.text) + '</span></div></div>';
  };
})(window.JA);
