/* Astro Outpost — the game itself: controls, what the E key does, throwing, mini-games,
   storms, days and nights, and the rocket ride home. */
(function (JA) {
  'use strict';
  var sim = JA.sim, W = JA.world, B = JA.base, A = JA.actors, U = JA.ui, Au = JA.audio, R = JA.RULES, Tn = JA.terrain, T = window.THREE;
  var $ = U.$, esc = U.esc;

  var G = JA.game = {
    opts: { site: 'moon', level: 'cadet', sun: 'live', suit: 0xff7a3d, shift: R.dayLength, pioneer: 'off' },
    introSeen: {},
    s: null, weather: null, mode: 'title',
    input: { x: 0, z: 0, jump: false, sprint: false }, keys: {}, stick: { x: 0, z: 0 },
    ePressed: false, eHeld: false, fHeld: false, charge: null, mini: null, fast: false, lookIdle: 9, zoom: 11,
    action: null, zones: [], tips: {}, tut: {}, tutStep: 0, dt: 0, clock: 0, sayAt: 0, hintAt: 0, goalAt: 0, goal: null,
    lastWarn: -1, geiger: 0, ending: null, launchT: 0, launchN: -1, bannerUntil: 0, caseItem: null, sayQ: [], sparkAt: 0
  };
  var SUITS = [0xff7a3d, 0x3d9bff, 0x4cd97b, 0xff5fa8, 0xb07cff], SUIT_NAMES = ['Orange', 'Blue', 'Green', 'Pink', 'Purple'];
  var touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  var v1 = T ? new T.Vector3() : null, v2 = T ? new T.Vector3() : null, v3 = T ? new T.Vector3() : null;

  function fatal(msg) { var f = $('fatal'); f.textContent = msg; f.classList.remove('hidden'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function dayWord() { return G.s.site.dayWord; }
  function dustFor(kind) { return { clear: 0, dusty: 0.4, storm: 1, sun: 0, lowsun: 0.3, shadow: 0.8, dark: 1 }[kind] || 0; }
  // Mission Control's radio messages from Earth. vid: the recorded voice line for these words (found from the words when left out).
  // A line that is being spoken is allowed to finish: a forced line waits its turn, a passing hint is dropped.
  // Urgent lines (storms, breakdowns) cut in at once.
  // topic: the hologram that explains these words, when the wrist tablet has one. The radio panel then shows a "Why?" chip.
  // from: who speaks ('earth' or 'crew'; left out = decided by radioFrom).
  function say(text, force, vid, urgent, topic, from) {
    if (!text) return;
    if (!force && G.clock < G.sayAt) return;
    if (vid === undefined) vid = JA.voiceFor(text);
    if (!urgent && Au.voicePlaying()) {
      if (force && G.sayQ.length < 3) G.sayQ.push({ text: text, vid: vid, until: G.clock + 14, topic: topic, from: from });
      return;
    }
    if (urgent) G.sayQ.length = 0;
    G.sayAt = G.clock + 3.5; bubble(text, vid, topic, from);
  }
  // Earth is 1.3 light-seconds from the Moon, so there Mission Control can coach you live. On Mars, Earth is 5 to 20
  // light-minutes away and cannot react to what you do right now: only messages that really come from Earth
  // (storm forecasts, answers to your questions) are Earth's. Everything said in the moment is a crewmate's.
  var EARTH_LINES = { 'storm-spotted': 1, 'dish-answer': 1, 'forecast-quiet': 1, 'forecast-small': 1, 'forecast-medium': 1, 'forecast-big': 1, 'bag-storm-day': 1, 'welcome-mars': 1 };
  function radioFrom(vid, from) {
    if (from) return from;
    if (!G.s || G.s.site.id !== 'mars') return 'earth';
    return EARTH_LINES[vid] ? 'earth' : 'crew';
  }
  function bubble(text, vid, topic, from) { G.topic = holoHas(topic) ? topic : ''; G.topicAt = G.clock; U.say(text, vid, !!G.topic, radioFrom(vid, from)); }
  function sayNext() {
    while (G.sayQ.length && !Au.voicePlaying()) { var q = G.sayQ.shift(); if (G.clock <= q.until) { G.sayAt = G.clock + 3.5; bubble(q.text, q.vid, q.topic, q.from); } }
  }
  function tip(id, text, vid, topic) { if (G.tips[id]) return false; G.tips[id] = 1; say(text, true, vid, false, topic); return true; }
  function toastAt(pos, text, color) { var p = W.project(pos); if (!p.hidden) U.toast(text, clamp(p.x, 60, W.w - 60), clamp(p.y, 120, W.h - 120), color); }
  function me() { return A.rover.driver ? A.rover.pos : A.astro.pos; }
  function cellsText(n) { n = Math.round(n); return n + ' power cell' + (n === 1 ? '' : 's'); }
  function clockText(secs) { secs = Math.max(0, Math.ceil(secs)); return Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2); }
  function srcLine(id) { var x = JA.SOURCES[id]; return x ? '<small>Source: ' + esc(x.name) + '</small>' : ''; }

  // ---------- info overlay (opens on top of anything) ----------
  var infoRoot = document.createElement('div');
  infoRoot.id = 'info-root';
  document.body.appendChild(infoRoot);
  function infoOpen() { return infoRoot.classList.contains('open'); }
  function openInfo(html) {
    infoRoot.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true">' + html + '<div class="modal-actions"><button class="btn primary" id="info-close">Got it</button></div></div>';
    infoRoot.className = 'open';
    $('info-close').addEventListener('click', closeInfo);
    $('info-close').focus();
  }
  function closeInfo() { infoRoot.className = ''; infoRoot.innerHTML = ''; Au.play('tap'); }
  G.openInfo = function (html) { openInfo(html); return infoRoot; };      // lets the add-on modules show a card of their own
  // Add-on modules (helmet view, meteorites, music, Sun Watch, keepsakes) are optional extras.
  // If one is missing or goes wrong, the mission carries on without it.
  function ext(mod, fn) {
    var m = JA[mod];
    if (!m || typeof m[fn] !== 'function') return undefined;
    try { return m[fn].apply(m, Array.prototype.slice.call(arguments, 2)); }
    catch (e) { if (window.console) console.warn('Astro Outpost add-on ' + mod + '.' + fn + ' failed:', e); return undefined; }
  }

  // =====================================================================
  //  WHY DID THAT HAPPEN?  cards, the wrist tablet's holograms (js/holo.js), the Field Journal (js/journal.js)
  // =====================================================================
  function holoHas(id) { return !!(id && JA.holo && JA.holo.has && JA.holo.has(id)); }
  function holoOpen() { return !!(JA.holo && JA.holo.isOpen && JA.holo.isOpen()); }
  // The numbers of this very mission that a hologram can show.
  function holoData(id) {
    var s = G.s, d = { site: s ? s.site.id : G.opts.site }, C = JA.CROPS;
    if (id === 'crops') { d.lettuce = { days: C.lettuce.growSols, food: C.lettuce.food }; d.potato = { days: C.potato.growSols, food: C.potato.food }; }
    if (id === 'electrolysis') d.airPerIce = s ? sim.airPerIce(s) : R.airPerIce;      // the hologram can also open from the title menu
    if (id === 'shield') d.slots = R.shieldSlots;
    if (id === 'shade') { d.free = R.bagsFreeShade; d.bags = R.bagsFreeShade + 1; d.loss = R.bagShade; }
    if (!s) return d;
    if (id === 'scrubber') d.filter = Math.round(s.filter);
    else if (id === 'shield') { d.bags = s.bags; d.shield = sim.shield(s); }
    else if (id === 'plant') { d.lamp = s.m.food.lamp > 0; d.water = s.water > 0; }
    else if (id === 'solar') d.eff = (s.rack.eff[0] + s.rack.eff[1] + s.rack.eff[2]) / 3;
    else if (id === 'water') { d.recycle = s.mods.recycle; d.water = Math.round(s.water); }
    else if (id === 'radio') d.oneWay = sim.commInfo(s).oneWay;
    else if (id === 'storm') { d.dish = s.m.comms.on; d.lead = Math.round(sim.warnLead(s)); }
    else if (id === 'dose') d.dose = Math.round(s.dose);
    else if (id === 'shade' && s.bags > R.bagsFreeShade) { d.bags = s.bags; d.loss = sim.shade(s); }
    else if (id === 'battery') d.cap = 1 - s.wear.rover;
    return d;
  }
  // The tablet on your wrist projects a hologram. The game waits while it plays (see advance).
  function showHolo(id) {
    if (!holoHas(id) || holoOpen()) return false;
    G.keys = {}; G.eHeld = false; G.fHeld = false;
    if (G.charge) { G.charge = null; if (A.astro) A.astro.aim = false; hideAim(); Au.stopLoop('aim'); }      // an aimed throw is cancelled, not thrown
    // a meter, the radio chip or a card that was clicked must not keep the keyboard: Space would open the hologram again instead of jumping
    var held = document.activeElement;
    if (held && held.closest && held.closest('#hud, #radio, #card')) held.blur();
    return !!ext('holo', 'open', id, holoData(id), {});
  }
  // What the tablet would explain right here: the machine you are standing next to.
  function nearTopic() {
    var s = G.s, p = me(), sp = B.spots, best = '', bd = 99;
    function near(pos, id, r) { if (!pos) return; var d = d2(p, pos); if (d < (r || 11) && d < bd) { bd = d; best = id; } }
    if (G.mode !== 'play') return '';
    if (A.rover.driver) return 'battery';
    near(B.pos.air, 'electrolysis'); near(sp.hoppers.water, 'water', 6); near(B.pos.food, 'plant'); near(B.pos.solar, 'solar', 13); near(sp.rack, 'solar', 7);
    near(B.pos.scrub, 'scrubber', 6); near(B.pos.hab, 'shield', 13); near(B.pos.bag, 'shield', 8); near(B.pos.comms, s.storm && s.storm.warned ? 'storm' : 'radio');
    sp.drill.forEach(function (q) { near(q, 'drill', 7); }); sp.ice.forEach(function (q) { near(q, 'drill', 7); });
    return best;
  }
  // "Show me why" (the T key, the radio badge, or the chip in the radio panel). The tablet plays the hologram that fits
  // what just happened, what Mission Control just said, or the machine you are standing at. With none of those, it lists them all.
  function askWhy() {
    var s = G.s;
    if (!s || !JA.holo || (G.mode !== 'play' && G.mode !== 'inside') || U.modalOpen() || infoOpen() || holoOpen()) return;
    var c = U.cardNow(), id = '';
    if (c && c.holo) { id = c.holo; U.nextCard(); }
    else if (G.topic && !$('radio').classList.contains('hidden')) id = G.topic;
    else id = nearTopic();
    Au.play('tap');
    if (!id || !showHolo(id)) holoMenu();
  }
  function holoMenu() {
    if (!JA.holo) return;
    var S = JA.holo.SCENES || {}, site = G.s ? G.s.site.id : G.opts.site;
    var ids = Object.keys(S).filter(function (id) { return id !== 'longdark' || site === 'moon'; });
    var root = G.openInfo('<h2>💡 Holo-tablet</h2><p class="sub">The tablet on your wrist can project a moving picture of how each thing works. Pick one. Tip: stand next to a machine and ' + (touch ? 'tap the round radio badge' : 'press T') + ', and it shows that machine.</p>' +
      '<div class="holo-grid">' + ids.map(function (id) {
        var inf = JA.holo.info ? JA.holo.info(id, { site: site }) : S[id], t = inf && typeof inf.title === 'string' ? inf.title : id;      // some titles differ between the Moon and Mars
        return '<button class="pick" data-holo="' + id + '"><em>' + (S[id].icon || '✨') + '</em><b>' + esc(t) + '</b></button>';
      }).join('') + '</div>');
    Array.prototype.forEach.call(root.querySelectorAll('[data-holo]'), function (b) {
      b.addEventListener('click', function () { var id = b.getAttribute('data-holo'); closeInfo(); showHolo(id); });
    });
  }
  // A new page for the Field Journal. Returns true the first time this page is found.
  function journalAdd(kind, id) {
    var s = G.s;
    if (!s || !JA.journal || id == null) return false;
    var fresh = !!ext('journal', 'add', s.site.id, kind, id);
    if (fresh) G.pages = (G.pages || 0) + 1;
    return fresh;
  }
  function openJournal() {
    if (!JA.journal || holoOpen()) return;
    Au.play('tap');
    ext('journal', 'open', G.s ? G.s.site.id : G.opts.site, { holo: function (id) { showHolo(id); }, sound: function () { Au.play('tap'); } });
  }
  // A discovery card that also goes into the journal.
  function journalFind(f) { if (f && f.key != null) journalAdd(f.kind === 'core' ? 'find' : f.kind, f.key); }
  function findCard(f) { U.card(f); journalFind(f); }
  // One more sentence for a "why" card, with this mission's own numbers in it.
  function whyLive(id) {
    var s = G.s, t = s.today, pc = function (v) { return Math.round(v * 100) + '%'; };
    if (id === 'electro') return 'One ice chunk makes ' + sim.airPerIce(s) + ' air.';
    if (id === 'shield') return 'Your dome now blocks ' + pc(sim.shield(s)) + ' of the radiation indoors.';
    if (id === 'shade') return 'Right now: ' + pc(sim.shield(s)) + ' shield, and ' + pc(sim.shade(s)) + ' less solar power.';
    if (id === 'panel') return 'Yours are working at ' + pc((s.rack.eff[0] + s.rack.eff[1] + s.rack.eff[2]) / 3) + ' right now.';
    if (id === 'stormin' && t.doseStorm > 0.05) { var sf = sim.shield(s); return 'This storm added ' + t.doseStorm.toFixed(1) + '% to your badge. Outdoors it would have been about ' + (t.doseStorm / Math.max(0.1, 1 - sf)).toFixed(1) + '%.'; }
    if (id === 'scar' && t.scar) return 'This one cost ' + (t.scar * 100).toFixed(1) + '% of your solar power, for the rest of the mission.';
    if (id === 'jam') return 'Your drill now heats ' + pc(s.wear.drill) + ' faster.';
    if (id === 'flat') return 'It now holds ' + Math.round(sim.roverCap(s)) + ' seconds of driving, not ' + R.roverMax + '.';
    if (id === 'longdark' && s.darkSol > s.sol) return 'It comes ' + (s.darkSol - s.sol === 1 ? 'tomorrow.' : 'in two days.');
    if (id === 'filterlow' || id === 'stale') return 'The filter is ' + Math.round(s.filter) + '% clean.';
    return '';
  }
  // Something just happened that has a reason: say why, right now, and keep the page.
  function showWhy(id) {
    var s = G.s, m = JA.mechFor(id, s.site.id);
    if (!m) return;
    var live = whyLive(id), fresh = journalAdd('why', id);
    Au.play('page'); fxPulse('glow', 0.35);
    U.card({ kind: 'why', icon: m.icon, title: m.title, text: m.text + (live ? ' ' + live : ''), src: m.src, holo: holoHas(m.holo) ? m.holo : '', fresh: fresh });
  }


  // =====================================================================
  //  TITLE + SETUP
  // =====================================================================
  function hideHud() {
    ['hud', 'goals', 'banner', 'radio', 'prompt', 'hands', 'rover-hud', 'mini', 'inside', 'stick', 'touch-btns'].forEach(function (id) { U.show($(id), false); });
    U.tags([]); U.marks([]); U.stormFx(''); U.clearCards();
  }
  function titleScene() {
    if (G.room) leaveRoom(true);
    G.mode = 'title'; G.s = null;
    ext('pioneer', 'stop');
    if (A.astro) A.astro.mode = 'hidden';
    W.cam.mode = 'title'; W.env.t = 0.3; W.env.dust = 0; W.env.storm = 0;
    hideHud(); U.show($('title'), true); U.fade(false);
    Au.stopAll(); Au.music('title');
  }

  // these cards redraw themselves after each pick: put the keyboard focus back where it was
  function refocus(sel) { var el = document.querySelector('#modal-root ' + sel); if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* older browsers */ } } }
  function setupModal() {
    var o = G.opts;
    function card(g, v, emoji, title, text) {
      return '<button class="pick' + (String(o[g]) === String(v) ? ' sel' : '') + '" data-act="pick" data-g="' + g + '" data-v="' + v + '" aria-pressed="' + (String(o[g]) === String(v)) + '">' +
        '<em>' + emoji + '</em><b>' + title + '</b><span>' + text + '</span></button>';
    }
    var lvIcon = { cadet: '🎒', commander: '🧑‍🚀', veteran: '🎖️' };
    var html = '<h2>Plan your mission</h2><p class="sub">A few quick choices, Commander.</p>' +
      '<h3>1 · Where will you build your outpost?</h3><div class="cards">' +
      card('site', 'moon', '🌙', 'The Moon', esc(JA.SITES.moon.blurb)) + card('site', 'mars', '🔴', 'Mars', esc(JA.SITES.mars.blurb)) + '</div>' +
      '<h3>2 · How long is the mission?</h3><p class="sub">Every day is harder than the one before, and teaches something new.</p><div class="cards three">' +
      Object.keys(JA.LEVELS).map(function (k) { var L = JA.LEVELS[k]; return card('level', k, lvIcon[k], L.name + ' · ' + L.sols + ' days', L.ages + '. ' + esc(L.blurb)); }).join('') + '</div>' +
      '<h3>3 · How much time do you want each day?</h3><p class="sub">You can change this at any moment with the ⏸ button.</p><div class="cards four">' +
      JA.SHIFTS.map(function (sh) { return card('shift', sh.id, sh.icon, sh.name + ' · ' + (sh.id / 60) + ' min', esc(sh.text)); }).join('') + '</div>' +
      '<h3>4 · Which Sun do you want to face?</h3><div class="cards">' +
      card('sun', 'live', '☀️', 'The real Sun, right now', 'Flares, solar gas clouds and radiation storms from the last 30 days, fetched live from NASA.') +
      card('sun', 'archive', '🌩️', 'The great storms of May 2024', 'A famous stormy month from NASA\'s records. Much harder!') + '</div>' +
      (JA.pioneer ? '<h3>5 · How do you want to play?</h3><div class="cards">' +
        card('pioneer', 'off', '🧑‍🚀', 'Classic', 'The outpost as the engineers built it. Best for a first mission.') +
        card('pioneer', 'on', '⛏️', 'Pioneer · hard mode', 'Fewer supplies. Break rocks into rubble, metal and glass sand, then build your own panels, batteries, walls and more.') + '</div>' : '') +
      '<h3>Your spacesuit colour</h3><div class="swatches">' +
      SUITS.map(function (c, i) { return '<button class="swatch' + (o.suit === c ? ' sel' : '') + '" style="--c:#' + ('00000' + c.toString(16)).slice(-6) + '" data-act="suit" data-v="' + c + '" aria-label="' + SUIT_NAMES[i] + ' spacesuit" aria-pressed="' + (o.suit === c) + '"></button>'; }).join('') +
      '</div><div class="modal-actions"><button class="btn ghost" data-act="back">Back</button><button class="btn primary" data-act="go">Launch 🚀</button></div>';
    var keep = document.querySelector('#modal-root .modal'), scroll = keep ? keep.scrollTop : 0;
    var m = U.modal(html, { cls: 'wide', noFocus: !!keep, actions: {
      pick: function (el) { var g = el.getAttribute('data-g'), v = el.getAttribute('data-v'); o[g] = g === 'shift' ? parseInt(v, 10) : v; Au.play('tap'); setupModal(); refocus('[data-g="' + g + '"][data-v="' + v + '"]'); },
      suit: function (el) { o.suit = parseInt(el.getAttribute('data-v'), 10); Au.play('tap'); setupModal(); refocus('[data-act="suit"][data-v="' + o.suit + '"]'); },
      back: function () { Au.play('tap'); U.closeModal(); titleScene(); },
      go: launch
    } });
    m.scrollTop = scroll; m.style.animation = keep ? 'none' : '';
  }

  function launch() {
    Au.play('swish');
    U.modal('<div class="loading"><div class="spinner"></div><h2>Calling NASA…</h2><p class="sub">' +
      (G.opts.sun === 'live' ? 'Fetching the last 30 days of real space weather.' : 'Opening the May 2024 storm records.') + '</p></div>');
    var t0 = Date.now();
    JA.weather.load(G.opts.sun).then(function (data) { setTimeout(function () { startMission(data); }, Math.max(0, 700 - (Date.now() - t0))); });
  }

  function startMission(data) {
    G.weather = data;
    A.room = null; W.cam.room = null; G.room = null; G.colonyVisit = 0;
    W.build(G.opts.site, G.opts.suit);
    var s = G.s = sim.newGame({ site: G.opts.site, level: G.opts.level, weather: data, dayLength: G.opts.shift, pioneer: G.opts.pioneer === 'on' && !!JA.pioneer });
    G.tips = {}; G.tut = {}; G.tutStep = 0; G.mini = null; G.charge = null; G.ending = null; G.caseItem = null; G.fast = false; G.clock = 0; G.sayAt = 0; G.sayQ = []; G.sparkAt = 0;
    G.hintAt = 0; G.goalAt = 0; G.goal = null; G.lastWarn = -1; G.bannerUntil = 0; G.geiger = 0; G.crisisOpen = false;   // or a second mission inherits the first one's timers
    G.topic = ''; G.topicAt = 0; G.pages = 0; G.cut = null; G.cutCool = 0;
    buildZones(); buildAim();
    G.rigs = B.spots.ice.map(function () { return { state: 'idle', p: 0, t: 0 }; }); B.rigs = G.rigs;      // the ice drills (see stepRigs)
    if (s.pioneer) ext('pioneer', 'start', s, PIONEER); else ext('pioneer', 'stop');
    JA.INSTRUMENTS[s.site.id].forEach(function (def, i) { A.spawn('inst', B.spots.pallet[i], { id: def.id, name: def.name }, 'fixed'); });
    A.roverCharge = function () { return G.s ? G.s.m.rover.charge : 1; };
    A.roverStuck = function () { return !!(G.s && G.s.m.rover.stuck); };
    W.cam.fp = !!G.pov; ext('music', 'setSite', G.opts.site);
    U.show($('title'), false); U.closeModal();
    W.env.t = 0.1; W.env.dust = dustFor(sim.env(s).kind);
    // the landing film plays once per place; after that it is skipped automatically
    if (JA.intro && !G.introSeen[s.site.id]) {
      G.introSeen[s.site.id] = true;
      G.mode = 'intro';
      JA.intro.play(s.site.id, welcomeModal);
    } else welcomeModal();
  }

  function welcomeModal() {
    var s = G.s, day = s.day;
    journalAdd('day', day.key);
    G.mode = 'brief'; W.cam.mode = 'title'; W.env.t = 0.1; W.env.dust = dustFor(sim.env(s).kind);
    U.fade(false);
    Au.music('title');          // after the landing film, the view's music fades into the theme
    var d1 = JA.weather.prettyDate(s.weather[0].date), dN = JA.weather.prettyDate(s.weather[s.weather.length - 1].date), wx;
    if (s.weatherFallback) wx = '<div class="info-row"><span class="ic">📼</span><div><b>Using saved NASA records</b><p><span class="tagline archive">NASA archive</span>We could not reach NASA just now, so the solar storms replay the real Sun from ' + d1 + ' to ' + dN + ' instead. This is not live data.</p></div></div>';
    else wx = '<div class="info-row"><span class="ic">🛰️</span><div><b>The real Sun is in this game</b><p>' + U.dataTag(s) + 'Solar storms replay the real Sun from ' + d1 + ' to ' + dN + (s.weatherSource === 'live' ? ', fetched just now from NASA\'s space-weather database.' : ' — one of the most active months on the Sun in 20 years.') + '</p></div></div>';
    var n = s.totalSols, dw = dayWord().toLowerCase() + 's';
    U.modal('<h2>Welcome to ' + esc(s.site.name) + ', Commander!</h2>' +
      '<p class="sub">' + esc(s.site.place) + ' · This is Mission Control on Earth. We are with you on the radio all the way.</p>' +
      '<div class="info-row"><span class="ic">🎯</span><div><b>Your mission</b><p>Keep the crew alive for ' + n + ' ' + dw + (s.site.id === 'mars' ? ' (a sol is one Mars day)' : '') + ', do real science, then ride the rocket home. ' + esc(s.site.why) + '</p></div></div>' +
      '<div class="info-row"><span class="ic">🔋</span><div><b>You do everything by hand</b><p>The Sun charges only a few power cells a day. YOU carry each one to the machine that needs it most — air, food, shield, science or radio. There is never enough for all of them.</p></div></div>' +
      '<div class="info-row"><span class="ic">📈</span><div><b>Every day is harder, and teaches something new</b><p>The outpost wears down the longer you stay. And ' + s.level.crisisSols.length + ' times, something will go wrong that has no checklist: you alone will choose what to do, and live with what follows.</p></div></div>' +
      wx +
      '<div class="info-row"><span class="ic">📡</span><div><b>Talking to Earth</b><p>' + esc(commWelcome(s)) + '</p></div></div>' +
      '<div class="info-row good"><span class="ic">' + day.icon + '</span><div><b>' + esc(dayWord()) + ' 1 · ' + esc(day.title) + ' · ' + esc(day.topic) + '</b><p>' + esc(day.learn) + '</p>' + srcLine(day.src) + '</div></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="how">How to play</button><button class="btn primary" data-act="ok">Step outside ▶</button></div>',
      { speak: 'Welcome to ' + s.site.name + ', Commander! This is Mission Control on Earth. We are with you on the radio all the way. Keep the crew alive for ' + n + ' ' + dw + ', do real science, then ride the rocket home.', line: 'welcome-' + s.site.id,
        actions: { how: howInfo, ok: function () { Au.play('door'); U.closeModal(); beginSol(); } } });
  }

  // The radio delay for this mission's real dates (the same model as the Mission Control screens), and who talks to you.
  function commWelcome(s) {
    if (s.site.id === 'moon') return s.site.commText + ' That is why Mission Control can talk you through your work live.';
    var c = sim.commInfo(s);
    return 'On these mission days Mars is ' + Math.round(JA.weather.planets(s.weather[0].date || new Date().toISOString().slice(0, 10)).km / 1e6) +
      ' million km from Earth, so a radio message takes ' + c.oneWay + ' each way. Earth cannot see what you do right now, so a crewmate inside the habitat talks you through your work. Earth sends storm forecasts and repair help over the Radio Dish.';
  }

  // =====================================================================
  //  MORNING
  // =====================================================================
  function syncRack() {
    var s = G.s, have = A.items.filter(function (it) { return it.tag === 'rack'; }), i;
    while (have.length > s.rack.cells) A.remove(have.pop());
    for (i = have.length; i < s.rack.cells; i++) {
      var used = A.items.filter(function (it) { return it.tag === 'rack'; }).map(function (it) { return it.slot2; });
      var slot = 0; while (used.indexOf(slot) >= 0) slot++;
      var home = B.spots.rackSlots[slot % R.rackMax];
      var it = A.spawn('cell', slot < R.rackMax ? home : v1.set(home.x, home.y + 0.95 * Math.floor(slot / R.rackMax), home.z), null, 'fixed');
      it.tag = 'rack'; it.slot2 = slot;
      W.burst(it.pos.x, it.pos.y, it.pos.z, 8, 2, 0xffe36a, { life: 0.5, size: 0.25, grav: 0 });
    }
  }

  var DAY_VOX = { sun: 'bright-sunshine', lowsun: 'long-shadows', shadow: 'in-shadow', dark: 'in-shadow', clear: 'clear-sky', dusty: 'dusty-sky', storm: 'dust-storm' };
  // the on-screen stick and buttons, for touch screens only
  function touchUi(on) {
    if (!touch) return;
    document.body.classList.add('touch');
    U.show($('stick'), on); U.show($('touch-btns'), on);
    if (!on) { G.stick.x = G.stick.z = 0; G.eHeld = false; G.fHeld = false; var nub = $('stick').querySelector('i'); if (nub) nub.style.transform = ''; }
  }
  function beginSol() {
    var s = G.s, env = sim.env(s), look = s.site.env[env.kind], w = sim.weather(s), last = s.sol >= s.totalSols;
    if (A.rover.driver) A.exitRover();
    if (G.room) leaveRoom(true);
    A.resetAstro(); Au.music(null);
    G.mode = 'play'; G.mini = null; G.charge = null; G.fast = false; A.astro.aim = false;
    W.cam.mode = 'play'; W.cam.focus = A.focus; W.cam.yaw = 0.45; W.cam.pitch = 0.36; G.zoom = 11;
    W.env.dust = dustFor(env.kind); W.env.storm = 0; W.env.t = 0.06;
    G.lastWarn = -1; G.hintAt = G.clock + 14;
    syncRack();
    if (last && !G.caseItem) { G.caseItem = A.spawn('case', B.spots.caseSpawn, { name: 'sample case' }, 'rest'); }
    U.show($('hud'), true); U.show($('goals'), true); U.show($('inside'), false); U.fade(false);
    touchUi(true);
    U.setHud(s);
    function go() {
      U.banner(dayWord() + ' ' + s.sol + ' · ' + look.icon + ' ' + look.label + ' · about ' + cellsText(s.cellsToday) + ' today', 'info');
      G.bannerUntil = G.clock + 7;
      var line, vox;
      if (s.sol === 1) { line = touch ? 'Welcome outside! Use the stick to walk and drag the screen to look around.' : 'Welcome outside! Walk with W A S D, drag the mouse to look around, and press Space to jump.'; vox = 'act-welcome'; }
      else {
        line = look.label.replace(/[!.]+$/, '') + ' today. ' + (s.forecast ? (w.level ? U.stormWords(w.level) + ' is coming today. Stay ready to run home!' : 'The Sun is quiet today.') : 'The dish was off, so there is no storm forecast. Listen for your suit sensor!') + (last ? ' Last day: load the sample case and board the rocket!' : '');
        // the morning report is spoken as up to three recorded lines in a row: the weather, the storm forecast, the last-day reminder
        vox = ['day-' + DAY_VOX[env.kind], s.forecast ? (w.level ? 'forecast-' + (w.level >= 3 ? 'big' : w.level === 2 ? 'medium' : 'small') : 'forecast-quiet') : 'forecast-none'];
        if (last) vox.push('day-last');
      }
      say(line, true, vox);
    }
    var arrive = JA.colony && s.colony ? s.colony.arrive : 0;      // sim.townMorning has already counted the self-sustaining days
    G.rigs.forEach(function (rig) { rig.state = 'idle'; rig.p = 0; rig.t = 0; });
    G.colonyNews = arrive ? ext('colony', 'info', arrive) : null;
    function landing() {
      go();
      if (!arrive) return;
      ext('colony', 'setStage', arrive, { arrive: true });
      G.colonyVisit = arrive;
      ext('mission', 'milestone', s, '🌍', 'A ship from Earth has landed at the settlement.');
      setTimeout(function () { if (G.mode === 'play' || G.mode === 'inside') say('Look to the north-east! A ship from Earth is landing at the new settlement. Go and say hello!', true); }, 2500);
    }
    if (s.sol === 1) go(); else dayCard(landing);
  }

  // The morning briefing: one new thing to learn, today's challenge, and what got harder.
  function dayCard(done) {
    var s = G.s, day = s.day, env = sim.env(s), look = s.site.env[env.kind], w = sim.weather(s), hard = sim.harderList(s);
    var news = G.colonyNews ? '<div class="info-row good"><span class="ic">' + G.colonyNews.icon + '</span><div><b>News from Earth: ' + esc(G.colonyNews.title) + '</b><p>' + esc(G.colonyNews.text) + '</p></div></div>' : '';
    var dark = s.darkSol > s.sol && s.darkSol - s.sol <= 2 ? '<div class="info-row alert"><span class="ic">🌚</span><div><b>The long dark comes ' + (s.darkSol - s.sol === 1 ? 'tomorrow' : 'in two days') + '</b><p>A mountain will hide the Sun for a whole day, and the panels will make almost nothing. Leave power cells on the Solar Rack the evening before, and charge the machines that keep the crew alive.</p></div></div>' : '';
    journalAdd('day', day.key);
    var town = townRows(s);
    Au.play('daystart');
    var goal = day.goal ? '<div class="info-row"><span class="ic">🎯</span><div><b>Today\'s challenge</b><p>' + esc(day.goal.text) + '</p></div></div>' : '';
    U.modal('<div class="day-head"><span class="big-icon">' + day.icon + '</span><div><small>' + esc(dayWord()) + ' ' + s.sol + ' of ' + s.totalSols + '</small><h2>' + esc(day.title) + '</h2></div></div>' +
      news + town + '<div class="info-row good"><span class="ic">💡</span><div><b>New today: ' + esc(day.topic) + '</b><p>' + esc(day.learn) + '</p>' + srcLine(day.src) + '</div></div>' + goal +
      '<div class="info-row"><span class="ic">' + look.icon + '</span><div><b>' + esc(look.label) + ' · about ' + cellsText(s.cellsToday) + '</b><p>' + esc(look.why) + '</p></div></div>' +
      U.weatherRow(s, w, s.forecast, 'today') + dark +
      (hard.length ? '<h3>📈 Harder than yesterday</h3><ul class="harder">' + hard.map(function (h) { return '<li><span>' + h.icon + '</span>' + esc(h.text) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="modal-actions"><button class="btn primary" data-act="ok">Start the shift ▶</button></div>',
      { speak: dayWord() + ' ' + s.sol + '. ' + day.title + '. ' + day.learn + (day.goal ? ' Today\'s challenge: ' + day.goal.text + '.' : ''), line: 'day-morning',
        actions: { ok: function () { Au.play('door'); U.closeModal(); done(); } } });
  }

  // =====================================================================
  //  CAPTURE ZONES: where carried or thrown things can go
  // =====================================================================
  function buildZones() {
    var sp = B.spots, Z = G.zones = [];
    function zone(o) { Z.push(o); }
    ['air', 'food', 'bag', 'lab', 'comms', 'scrub'].forEach(function (id) {
      if (sp.sockets[id]) zone({ id: 'sock-' + id, pos: sp.sockets[id], r: 1.5, type: 'cell', name: JA.MACHINES[id].name, fn: function () { return plugCell(id, sp.sockets[id]); } });
    });
    zone({ id: 'sock-rover', dyn: function (o) { return A.roverSpot('socket', o); }, r: 1.3, type: 'cell', name: 'rover', fn: function () { return plugCell('rover', A.roverSpot('socket', v3)); } });
    zone({ id: 'hop-air', pos: sp.hoppers.air, r: 1.9, type: 'ice', name: 'Air Maker', fn: function () { var r = sim.feedIce(G.s, 'air'); if (r.ok) { G.tut.ice = true; Au.play('ice', { at: sp.hoppers.air }); } return r; } });
    zone({ id: 'hop-water', pos: sp.hoppers.water, r: 1.7, type: 'ice', name: 'water tank', fn: function () {
      var r = sim.feedIce(G.s, 'food');
      if (r.ok) { G.tut.watered = true; Au.play('ice', { at: sp.hoppers.water }); toastAt(sp.hoppers.water, '+' + Math.round(r.add) + ' 💧', '#5aa8ff'); tip('tank', 'Ice in the tank! The crew drinks from it too, and the recycler gives most of that back.', undefined, 'water'); }
      return r;
    } });
    zone({ id: 'hop-lab', pos: sp.hoppers.lab, r: 1.7, type: 'core', name: 'Lab', fn: function (it) { var r = sim.submitCore(G.s, it.data); if (r.ok) { Au.play('score'); if (G.s.m.lab.power === 0) say('Core loaded! The Lab needs a power cell to study it.', true); } return r; } });
    zone({ id: 'pantry', pos: sp.hoppers.pantry, r: 1.9, type: 'crate', name: 'food hatch', fn: function (it) {
      var kind = it && it.data && it.data.crop, r = sim.storeCrate(G.s, kind); if (!r.ok) return r;
      Au.play('score'); toastAt(sp.hoppers.pantry, '+' + r.food + ' ' + (JA.CROPS[kind] || JA.CROPS.lettuce).icon, '#7be36a'); tip('pantry' + G.s.sol, 'Fresh food in the pantry!'); return r;
    } });
    zone({ id: 'dome', pos: sp.hoppers.dome, r: 7.4, flat: true, top: 9, type: 'bag', name: 'dome', fn: function () {
      var r = sim.addBag(G.s);
      if (r.ok) {
        Au.play('thud', { at: sp.hoppers.dome }); toastAt(sp.hoppers.dome, '🛡️ ' + Math.round(sim.shield(G.s) * 100) + '%', '#c9a6ff');
        if (G.s.bags === R.shieldSlots) say('The dome is fully covered. Maximum shielding!', true);
        else tip('radIntro', 'This is your radiation badge. When it is full, the mission is over.');
      }
      return r;
    } });
    zone({ id: 'cargo', pos: sp.hoppers.cargo, r: 2.1, type: 'case', name: 'rocket', fn: function () { G.s.caseLoaded = true; Au.play('swish'); say('Samples loaded! Scientists on Earth will study them for years.', true); return { ok: true }; } });
    Object.keys(sp.inst).forEach(function (id) {
      zone({ id: 'inst-' + id, pos: sp.inst[id], r: 2.8, flat: true, top: 5, type: 'inst', name: 'marked spot', match: function (it) { return it.data.id === id; }, fn: function () {
        var f = sim.deploy(G.s, id); if (!f) return { ok: false, msg: '' };
        Au.play('discovery'); findCard(f); W.burst(sp.inst[id].x, sp.inst[id].y + 0.5, sp.inst[id].z, 24, 4, 0x5cf0ff, { life: 0.9, size: 0.3, grav: 0 });
        return { ok: true };
      } });
    });
    zone({ id: 'bed', dyn: function (o) { return A.roverSpot('bed', o); }, r: 1.5, type: '*', name: 'rover', keep: true, fn: function (it) {
      if (!A.toBed(it)) return { ok: false, msg: 'The rover bed is full. It holds four things.' };
      Au.play('drop'); return { ok: true };
    } });
  }
  function zonePos(z, out) { return z.dyn ? z.dyn(out) : out.copy(z.pos); }
  function zoneTakes(z, it) { return (z.type === '*' || z.type === it.type) && (!z.match || z.match(it)); }
  function plugCell(id, pos) {
    var r = sim.plug(G.s, id);
    if (r.ok) {
      Au.play('plug', { at: pos }); W.burst(pos.x, pos.y, pos.z, 16, 3, 0xffe36a, { life: 0.6, size: 0.26, grav: 0 });
      if (id === 'air') G.tut.airCell = true;
      if (id === 'comms') tip('comms', 'Radio Dish on! Earth will warn us early about solar storms, and can help with repairs today.');
      if (id === 'bag') tip('bagger', 'The Soil Bagger is filling bags. Grab them and throw them onto the dome!');
      if (id === 'scrub') { toastAt(pos, '🫧 Filter 100%', '#8fe8d0'); say('The filter is baking! The heat pushes the trapped carbon dioxide outside, so it can soak up more.', true, undefined, false, 'scrubber'); }
      if (id === 'rover') tip('roverCell', touch ? 'Rover charged! Walk to its side and tap ✋ to drive.' : 'Rover charged! Walk to its side and press E to drive.', 'rover-charged');
    }
    return r;
  }
  function capture(it, z) {
    var from = it.from, res = z.fn(it);
    if (!res.ok) return res;
    zonePos(z, v1);
    if (from && z.id !== 'bed') {
      var dist = Math.hypot(from.x - v1.x, from.z - v1.z);
      if (dist > 7) { sim.trick(G.s, dist); Au.play('swish'); toastAt(v1, '🎯 ' + Math.round(dist) + ' m shot!', '#ffd23f'); tip('trick', 'What a throw! In low gravity things fly much farther than on Earth.'); }
    }
    if (!z.keep) { W.burst(it.pos.x, it.pos.y, it.pos.z, 10, 2.5, 0xffffff, { life: 0.5, size: 0.22, grav: 0 }); if (G.caseItem === it) G.caseItem = null; A.remove(it); }
    return res;
  }
  function checkZones() {
    for (var i = A.items.length - 1; i >= 0; i--) {
      var it = A.items[i];
      if (it.state !== 'fly' && it.state !== 'rest') continue;
      if (it.hold && G.clock < it.hold) continue;
      var msg = null;
      for (var k = 0; k < G.zones.length; k++) {
        var z = G.zones[k];
        if (!zoneTakes(z, it)) continue;
        zonePos(z, v1);
        var inside = z.flat ? (Math.hypot(it.pos.x - v1.x, it.pos.z - v1.z) < z.r && it.pos.y < v1.y + z.top) : it.pos.distanceTo(v1) < z.r;
        if (!inside) continue;
        var res = capture(it, z);
        if (res.ok) { msg = null; break; }
        if (!msg) msg = res.msg;
      }
      if (msg !== null && A.items[i] === it) { it.hold = G.clock + 3; if (msg) { say(msg, true); Au.play('deny'); } if (it.state === 'fly') { it.vel.x *= -0.4; it.vel.z *= -0.4; it.vel.y = 2; } }
    }
  }

  // =====================================================================
  //  WHAT "E" DOES RIGHT NOW
  // =====================================================================
  function findAction() {
    var s = G.s, a = A.astro, p = a.pos, sp = B.spots, best = null, i, d;
    function offer(dist, reach, o) { if (dist < reach && (!best || dist < best.d)) { o.d = dist; best = o; } }
    if (A.rover.driver) return { label: 'Get out of the rover', run: function () { A.exitRover(); Au.stopLoop('rover'); Au.play('drop'); } };
    // Pioneer mode: while a structure is being placed, E builds it, even with your hands full
    if (JA.pioneer && JA.pioneer.placing && JA.pioneer.placing()) { ext('pioneer', 'offer', s, p, offer); if (best) return best; }
    var c = a.carrying;
    if (c) {
      for (i = 0; i < G.zones.length; i++) {
        var z = G.zones[i]; if (!zoneTakes(z, c)) continue;
        zonePos(z, v1);
        (function (z) {
          offer(z.id === 'bed' ? d2(p, A.rover.pos) - 1.6 : d2(p, v1) - (z.flat ? z.r - 1 : 0), z.flat ? 2.6 : 3.6, { label: (z.type === 'cell' ? 'Plug into the ' : z.id === 'bed' ? 'Load into the ' : z.type === 'inst' ? 'Set up here' : z.id === 'dome' ? 'Put on the ' : 'Put in the ') + (z.type === 'inst' ? '' : z.name), run: function () {
            var res = capture(c, z);
            if (!res.ok) { if (res.msg) say(res.msg, true); Au.play('deny'); }
          } });
        })(z);
      }
      return best || { label: 'Put down', run: function () { A.setDown(); Au.play('drop'); } };
    }
    // loose things, and the cargo in the rover's bed: that is within reach from anywhere beside the bed
    var bedItem = null, bedD = 9;
    function nameOf(it) { return it.data && it.data.name ? it.data.name : JA.ITEMS[it.type].name; }
    for (i = 0; i < A.items.length; i++) {
      var it = A.items[i]; if (it.state === 'held') continue;
      (function (it) {
        var inBed = it.state === 'bed', dd = d2(p, it.pos) - (inBed ? 1.1 : 0);
        if (inBed && dd < bedD) { bedD = dd; bedItem = it; }
        offer(dd, inBed ? 2.7 : 3.3, { label: inBed ? 'Take the ' + nameOf(it) + ' from the rover' : 'Pick up the ' + nameOf(it), bed: inBed, run: function () { pickUp(it); } });
      })(it);
    }
    // the ice drills: one press starts a drill, and it works by itself (see stepRigs)
    for (i = 0; i < sp.ice.length; i++) (function (i) {
      var rig = G.rigs[i], dd = d2(p, sp.ice[i]) - 0.9;
      // the rig works by itself; a player who likes the skill game can still drill a chunk by hand (Q)
      if (rig.state === 'idle') offer(dd, 2.6, { label: 'Start the ice drill', altLabel: 'drill by hand', alt: function () { startDrill('ice', i); }, run: function () { startRig(i); } });
      else offer(dd + 1.6, 3.8, { label: rig.state === 'drill' ? 'Drilling… ' + Math.round(rig.p * 100) + '%' : 'The drill is cooling… ' + Math.ceil(rig.t) + ' s' });
    })(i);
    for (i = 0; i < sp.drill.length; i++) (function (i) {
      if (sim.coresLeft(s, i) > 0) offer(d2(p, sp.drill[i]) - 0.6, 2.4, { label: 'Drill a rock core (hold)', hold: true, run: function () { startDrill('geo', i); } });
    })(i);
    for (i = 0; i < sp.beds.length; i++) (function (i) {
      var bed = s.m.food.beds[i]; d = d2(p, sp.beds[i]);
      // the seeds in your pocket are lettuce or potatoes; Q (or the throw button) swaps them
      var seed = JA.CROPS[s.sow], swap = s.sow === 'lettuce' ? 'potato' : 'lettuce', grown = JA.CROPS[bed.crop] || JA.CROPS.lettuce;
      if (bed.state === 'empty') offer(d, 2.3, { label: 'Plant ' + seed.name + ' ' + seed.icon + ' (' + seed.line + ')', altLabel: JA.CROPS[swap].name + ' instead',
        alt: function () { sim.setSeed(s, swap); Au.play('tap'); },
        run: function () { sim.plant(s, i); G.tut.planted = true; Au.play('pop'); W.dust(sp.beds[i].x, sp.beds[i].z - 1.7, 4, 1, 0.3); checkGrow(); if (s.sol === 1) tip('foodIntro', 'This is our food. Every night, dinner comes out of it.'); } });
      else if (bed.state === 'ripe') offer(d, 2.3, { label: 'Pick the ' + grown.name + ' ' + grown.icon, run: function () {
        var kind = sim.harvest(s, i);
        if (kind) { var cr = A.spawn('crate', A.handPos(v1), { name: JA.CROPS[kind].crate, crop: kind }, 'rest'); A.pick(cr); Au.play('harvest'); tip('crate', 'Fresh veggies! Carry the crate to the green food hatch on the dome — or throw it in.'); }
      } });
      else offer(d, 2.0, { label: grown.name.charAt(0).toUpperCase() + grown.name.slice(1) + ' growing… ' + Math.round(bed.g * 100) + '%' + (s.m.food.lamp <= 0 ? ' · needs light' : s.water <= 0 ? ' · needs water' : '') });
    })(i);
    for (i = 0; i < sp.panels.length; i++) (function (i) {
      if (s.rack.eff[i] < 0.86) offer(d2(p, sp.panels[i]), 2.8, { label: s.site.id === 'mars' ? 'Brush the dust off' : 'Turn the panel to the Sun', run: function () { sim.servicePanel(s, i); Au.play('brush'); W.dust(sp.panels[i].x, sp.panels[i].z - 1.4, 10, 2.5, 0.5); toastAt(sp.panels[i], '☀️ 100%', '#ffd23f'); } });
    })(i);
    var g = s.glitch;
    if (g && (g.state === 'broken' || g.state === 'asked' || g.state === 'advised')) {
      d = d2(p, B.repair[g.machine]);
      if (g.state === 'asked') offer(d, 4, { label: 'Waiting for Earth\'s answer… ' + Math.ceil(g.replyAt - s.t) + ' s' });
      else offer(d, 4, { label: g.state === 'advised' ? 'Fix it with Earth\'s instructions' : 'Fix the ' + JA.MACHINES[g.machine].name, run: function () { if (g.state === 'advised') startRepair(true); else repairModal(); } });
    }
    // with cargo in the bed, "drive" is only offered at the driver's door, so that taking the cargo is never hidden behind it
    A.roverSpot('door', v1); var dr = bedItem ? d2(p, v1) : Math.min(d2(p, v1), d2(p, A.rover.pos) - 1.4);
    var drive = { label: 'Drive the rover', run: function () { A.enterRover(); if (G.pov) W.cam.fpPitch = 0.2; Au.play('rover-start'); tip('drive', 'Buckle up! The battery only drains while the rover is moving. ' + (touch ? 'Push the stick up to drive and sideways to steer. Tap ✋ to get out.' : 'W drives forward, S brakes, A and D steer. Press E to get out.'), 'rover-drive'); } };
    offer(dr, 2.6, drive);
    offer(d2(p, sp.door), 2.4, { label: 'Go inside the habitat', run: enterHab });
    // the rocket can be entered from anywhere close to it: its body keeps you about 4.7 m from its centre,
    // so measuring only to the door spot (7 m out, to one side) left most of the rocket with no prompt
    var rd = Math.min(d2(p, sp.rocketDoor), d2(p, B.P.rocket.base) - 4.2);
    if (s.sol >= s.totalSols) offer(rd, 4, { label: 'Board the rocket and fly home', run: JA.interior ? function () { goInside('rocket'); } : boardModal });
    else if (JA.interior) offer(rd, 3.4, { label: 'Climb into the rocket', run: function () { goInside('rocket'); } });
    for (i = 0; i < sp.photo.length; i++) (function (i) {
      if (!s.photos[i]) offer(d2(p, sp.photo[i]), 2.6, { label: 'Take a postcard photo', run: function () { var f = sim.photo(s, i); if (f) { Au.play('photo'); if (JA.fx) JA.fx.snap(); U.fade(true); setTimeout(function () { U.fade(false); }, 140); findCard(f); } } });
    })(i);
    ext('sky', 'offer', s, p, offer, collectRock);
    ext('pioneer', 'offer', s, p, offer);
    ext('observe', 'offer', s, p, offer, startObserve);
    // beside the rover both are one key away: E does the nearer one, Q the other
    if (best === drive && bedItem && bedD < 3.6) { drive.alt = function () { pickUp(bedItem); }; drive.altLabel = 'take the ' + nameOf(bedItem); }
    else if (best && best.bed && dr < 3.2) { best.alt = drive.run; best.altLabel = 'drive the rover'; }
    return best;
  }
  function pickUp(it) {
    if (it.tag === 'rack') { if (!sim.takeCell(G.s)) return; it.tag = null; }
    it.tag = null;
    A.pick(it); Au.play('grab');
    tip('throw', touch ? 'Got it! Tap ✋ next to a machine to use it, or hold 🎯 to aim a throw and let go.' : 'Got it! Press E next to a machine to use it — or hold F to aim a throw, and let go to throw.', 'act-grab');
  }
  // the first-day Greenhouse lesson is done once the lamps are lit, ice has gone into the tank and a bed is planted, in any order
  function checkGrow() { var f = G.s.m.food; if (f.lamp > 0 && G.tut.watered && G.tut.planted) G.tut.grow = true; }

  // =====================================================================
  //  THROWING
  // =====================================================================
  var aim = null, PTS = [];
  function buildAim() {
    aim = { dots: [], ring: null, n: 0 };
    var m = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false, depthTest: false });
    aim.mat = m; PTS = [];
    for (var i = 0; i < 36; i++) { var dot = W.add(W.root, new T.SphereGeometry(0.11, 6, 6), m, 0, -99, 0, true); dot.visible = false; dot.renderOrder = 8; aim.dots.push(dot); PTS.push(new T.Vector3()); }
    aim.ring = W.add(W.root, new T.TorusGeometry(0.9, 0.09, 6, 22), m, 0, -99, 0, true); aim.ring.rotation.x = Math.PI / 2; aim.ring.visible = false; aim.ring.renderOrder = 8;
  }
  function hideAim() { if (!aim) return; aim.dots.forEach(function (d) { d.visible = false; }); aim.ring.visible = false; }
  function updateThrow(dt) {
    var a = A.astro, c = a.carrying;
    if (!c || A.rover.driver) { if (G.charge) { G.charge = null; a.aim = false; hideAim(); } return; }
    if (G.fHeld && !G.charge) { G.charge = { t: 0, power: 0 }; a.aim = true; }
    if (!G.charge) return;
    var ch = G.charge;
    if (G.fHeld) {
      ch.t += dt;
      ch.power = 1 - Math.abs(((ch.t / 1.25) % 2) - 1);
      var n = A.trajectory(ch.power, PTS), ok = false, i, k;
      for (k = 0; k < G.zones.length && !ok; k++) {
        var z = G.zones[k]; if (!zoneTakes(z, c)) continue;
        zonePos(z, v1);
        if (z.flat) ok = Math.hypot(A.landing.x - v1.x, A.landing.z - v1.z) < z.r;
        else for (i = 0; i < n && !ok; i++) ok = PTS[i].distanceTo(v1) < z.r * 0.9;
      }
      aim.mat.color.set(ok ? 0x4dff9a : 0xffffff);
      for (i = 0; i < aim.dots.length; i++) { aim.dots[i].visible = i < n; if (i < n) aim.dots[i].position.copy(PTS[i]); }
      aim.ring.visible = true; aim.ring.position.set(A.landing.x, A.groundAt(A.landing.x, A.landing.z) + 0.15, A.landing.z);
      Au.loop('aim', { f: 200 + ch.power * 500, v: 0.03, type: 'sine' });
    } else {
      Au.stopLoop('aim'); hideAim();
      var it = A.throwHeld(Math.max(0.05, ch.power));
      if (it) { Au.play('throw'); it.hold = G.clock + 0.12; }
      G.charge = null; a.aim = false;
    }
  }

  // =====================================================================
  //  MINI-GAMES: drilling (steer + heat) and repairs (timing)
  // =====================================================================
  // ---------- the ice drills: one press starts a drill, it works by itself, and the ice pops out ----------
  function iceNear(i) {
    var n = 0, q = B.spots.ice[i];
    A.items.forEach(function (it) { if (it.type === 'ice' && it.state !== 'held' && it.state !== 'bed' && d2(it.pos, q) < 3.4) n++; });
    return n;
  }
  function startRig(i) {
    var rig = G.rigs[i], q = B.spots.ice[i];
    if (iceNear(i) >= 2) { say('Two ice chunks are already waiting at this drill. Pick them up first!', true); Au.play('deny'); return; }
    rig.state = 'drill'; rig.p = 0;
    Au.play('plug', { at: q }); W.burst(q.x, q.y + 0.6, q.z, 10, 2.5, 0xbff4ff, { life: 0.5, size: 0.22, grav: 0 });
    sim.note(G.s, 'icedrill');
    tip('icerig', 'The drill does the work by itself. Start the other drills too, then come back for the ice!');
  }
  function stepRigs(dt) {
    var need = R.iceDrillTime / Math.sqrt(G.s.level.ease), i, rig, q;
    for (i = 0; i < G.rigs.length; i++) {
      rig = G.rigs[i]; q = B.spots.ice[i];
      if (rig.state === 'drill') {
        rig.p += dt / need;
        if (rig.p < 1) continue;
        rig.state = 'rest'; rig.t = R.iceDrillRest; rig.p = 0;
        var chunk = A.spawn('ice', v1.set(q.x, q.y + 1.2, q.z), null, 'fly'), ang = Math.random() * 6.28;
        var up = Math.sqrt(2.4 * W.gravity);                  // a hop about 1.2 m high, whatever the gravity, so it lands beside the drill
        chunk.vel.set(Math.cos(ang) * 1.1, up, Math.sin(ang) * 1.1); chunk.spin = 4;
        Au.play('ice', { at: q }); W.burst(q.x, q.y + 0.9, q.z, 14, 3, 0xbff4ff, { life: 0.6, size: 0.24 });
        if (G.mode === 'play') toastAt(q, '🧊 Ice is ready!', '#4fd8ff');
      } else if (rig.state === 'rest') { rig.t -= dt; if (rig.t <= 0) rig.state = 'idle'; }
    }
  }
  // The town's morning news: who lives there now, and what the settlers did for you (or need from you).
  function townRows(s) {
    var c = s.colony;
    if (!c || c.stage < 2) return '';
    var gifts = c.gifts.join(', ').replace(/, ([^,]*)$/, ' and $1');
    return '<div class="info-row' + (c.gifts.length ? ' good' : c.asks ? ' alert' : '') + '"><span class="ic">🏘️</span><div><b>' + esc(ext('colony', 'town') || 'The town') + ' · ' + c.people + ' people · town spirit ' + Math.round(c.spirit) + '%</b><p>' +
      esc('They share your air plant, so breathing takes ' + Math.round(sim.townLoad(s) * 100) + '% more air. ' +
        (c.gifts.length ? 'In good spirits, the settlers brought you ' + gifts + '.' : c.asks ? 'The town is short of food: tonight you share ' + c.asks + ' of your dinner with them.' : 'Keep the outpost looking after itself and they will lend a hand.')) + '</p></div></div>';
  }
  function townInfo() {
    var s = G.s, c = s.colony, D = R.townDays, next = 0, i;
    for (i = 1; i < D.length; i++) if (c.days < D[i]) { next = D[i]; break; }
    openInfo('<h2>🏘️ ' + esc(ext('colony', 'town') || 'The town') + '</h2><p class="sub">A town grows beside an outpost that can look after itself.</p>' + townRows(s) +
      '<div class="info-row"><span class="ic">🌍</span><div><b>' + c.days + ' self-sustaining ' + dayWord().toLowerCase() + (c.days === 1 ? '' : 's') + '</b><p>' +
      esc('A day counts when the Air Maker makes most of the air the crew breathes and there is food for tomorrow. ' + (next ? (next - c.days) + ' more and another ship will come.' : 'No town has ever grown this big!')) + '</p></div></div>' +
      '<div class="info-row"><span class="ic">😊</span><div><b>Town spirit</b><p>It rises after a self-sustaining day and falls after a day that was not. Above ' + R.spiritHelp + '% the settlers bring ice and water each morning, above ' + R.spiritGift + '% a charged power cell too. Under ' + R.spiritLow + '% they need part of your dinner.</p></div></div>');
  }

  // Drilling: hold E (✋) to drill, and keep the drill bit in the green zone, the layer of good ice or rock.
  // The spinning drill keeps kicking the bit sideways, mostly away from the zone; steer it back with A / D,
  // the arrow keys or the stick. The drill only goes deeper inside the zone. Grinding outside fills the red
  // Slip bar, and when it is full the sample breaks and you get nothing. A hot drill kicks harder, so short
  // bursts (let go, it cools and calms down) are the way, just like real space drills.
  function startDrill(kind, idx) {
    var ease = G.s.level.ease, ice = kind === 'ice', zc = (Math.random() * 2 - 1) * 0.42;
    G.mini = { type: 'drill', kind: kind, idx: idx, depth: 0, heat: 0, jams: 0, lock: 0,
      rate: ice ? 0.42 : 0.24, heatRate: (ice ? 0.36 : 0.38) / ease * G.s.mods.heat * (1 + G.s.wear.drill) * sim.drillHeat(G.s), cool: 0.65,
      x: zc, v: 0, zc: zc, zw: Math.min(0.46, (ice ? 0.33 : 0.32) * Math.sqrt(ease)),      // bit position and the zone, on a -1..1 track
      kick: (ice ? 1.8 : 2.0) / Math.sqrt(ease), push: 0, pushT: 0.5,
      slip: 0, slipTime: (ice ? 2.2 : 2.6) * Math.sqrt(ease), out: 0, inside: true, on: false,
      bumpT: 1.5 + Math.random() * 2, bumpWarn: 0, bumpDir: 0, flash: 0,
      icon: ice ? '🧊' : '🧪', title: ice ? 'Mining ice' : 'Drilling a rock core at ' + JA.GEO[G.s.site.id][idx].name, hint: '' };
    A.astro.mode = 'busy'; A.astro.vel.set(0, 0, 0);
    var t = ice ? B.spots.ice[idx] : B.spots.drill[idx];
    A.astro.yaw = Math.atan2(t.x - A.astro.pos.x, t.z - A.astro.pos.z);
    if (G.pov) { W.cam.yaw = A.astro.yaw + Math.PI; W.cam.fpPitch = 0.55; }      // helmet view: look down at the drill
    tip('drill', 'Drills get hot! Drill in bursts and let it cool, just like real space drills do.');
  }
  function endMini() {
    G.mini = null; Au.stopLoop('drill'); U.drillUi(null);
    if (A.astro.mode === 'busy') A.astro.mode = 'walk';
  }
  function stepMini(dt) {
    var m = G.mini, s = G.s, a = A.astro;
    if (m.type === 'drill') {
      if (G.input.jump) { endMini(); return; }
      var hp = A.handPos(v1), ice = m.kind === 'ice', spot = ice ? B.spots.ice[m.idx] : B.spots.drill[m.idx];
      var dust = ice ? 0xbff4ff : (s.site.id === 'mars' ? 0xd9a070 : 0xc8c9d4);
      m.lock = Math.max(0, m.lock - dt); m.flash = Math.max(0, m.flash - dt);
      var on = m.on = G.eHeld && m.lock <= 0;
      m.v += clamp(G.input.x, -1, 1) * 7 * dt;                        // steering: A / D, the arrow keys or the stick
      if (on) {
        // the bit bites and kicks sideways, more often away from the good layer; a hot drill kicks harder
        if ((m.pushT -= dt) <= 0) {
          var away = m.x >= m.zc ? 1 : -1;
          m.push = (Math.random() < 0.7 ? away : -away) * m.kick * (0.6 + Math.random() * 0.6);
          m.pushT = 0.35 + Math.random() * 0.55;
        }
        m.v += m.push * (1 + 0.9 * m.heat) * (1 + 0.35 * m.depth) * dt;
        // now and then a hard pebble jolts the drill; a ⚡ shows which way, a moment before
        if (m.bumpWarn > 0) {
          if ((m.bumpWarn -= dt) <= 0) {
            m.v += m.bumpDir * 2.3; m.flash = 0.25; W.cam.shake = Math.max(W.cam.shake, 0.18); Au.play('thud');
            W.burst(hp.x, a.pos.y + 0.3, hp.z, 8, 3, dust, { life: 0.4, size: 0.18 });
          }
        } else if ((m.bumpT -= dt) <= 0) { m.bumpWarn = 0.45; m.bumpDir = Math.random() < 0.5 ? -1 : 1; m.bumpT = (ice ? 3 : 2) + Math.random() * 2.5; }
        m.heat += m.heatRate * dt;
      } else { m.heat = Math.max(0, m.heat - m.cool * dt); m.bumpWarn = 0; }
      m.v *= Math.exp(-(on ? 2.6 : 5) * dt);
      m.x += m.v * dt;
      if (m.x < -1) { m.x = -1; m.v = Math.max(0, m.v); } else if (m.x > 1) { m.x = 1; m.v = Math.min(0, m.v); }
      var inside = Math.abs(m.x - m.zc) <= m.zw;
      if (inside) m.slip = Math.max(0, m.slip - 0.8 * dt);
      if (on) {
        if (inside) m.depth += m.rate * dt;
        else { m.slip += dt / m.slipTime; m.out += dt; }               // grinding the wrong rock: the sample starts to break
        Au.loop('drill', inside ? { f: 90 + m.heat * 160, v: 0.07, rate: 0.9 + m.heat * 0.35 } : { f: 60 + m.heat * 90, v: 0.08, rate: 0.62 + m.heat * 0.2 });
        if (Math.random() < dt * (inside ? 30 : 14)) W.emit(hp.x, a.pos.y + 0.3, hp.z, { vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.6, size: 0.2, grow: 1.5, color: inside ? dust : 0x8a8f9c, alpha: 0.8, grav: W.gravity * 0.5 });
        W.cam.shake = Math.max(W.cam.shake, 0.03 + m.heat * 0.05 + (inside ? 0 : 0.04));
        if (!inside && m.inside) tip('drill-steer', 'The drill kicks the bit out of the good layer! Steer it back into the green zone, or the sample breaks.');
      } else Au.stopLoop('drill');
      m.inside = inside;
      if (m.heat >= 1) {
        m.jams++; m.heat = 0.4; m.depth = Math.max(0, m.depth - 0.15); m.lock = 0.9;
        m.v += (Math.random() < 0.5 ? -1 : 1) * 2;                     // the jammed drill jerks the bit
        Au.stopLoop('drill'); Au.play('jam'); Au.play('bad'); W.cam.shake = 0.35;
        W.burst(hp.x, a.pos.y + 0.5, hp.z, 14, 4, 0xff7a4d, { life: 0.5, size: 0.22 });
        var worn = s.wear.drill; sim.jam(s); m.heatRate *= (1 + s.wear.drill) / (1 + worn);      // the bit is a little more worn now
        say('Too hot — the drill jammed! Let it cool between bursts.', true, 'act-drill-jam', true, 'drill');
      }
      if (m.slip >= 1) {                                                // out of the zone too long: the sample is lost
        endMini();
        Au.play('bad'); W.cam.shake = 0.3;
        W.burst(hp.x, a.pos.y + 0.4, hp.z, 18, 4, dust, { life: 0.7, size: 0.26 });
        toastAt(spot, ice ? 'The ice shattered!' : 'The core crumbled!', '#ff5468');
        say(ice ? 'The drill slipped out of the ice and smashed it to powder. Try again, and keep the bit in the green!'
          : 'The drill slipped out of the rock layer and the core crumbled. Try again, and keep the bit in the green!', true);
        sim.note(s, 'crumble');
        return;
      }
      var keys = touch ? 'the stick' : 'A / D';
      m.hint = !inside ? (m.x < m.zc ? 'Steer right ▶ back into the green!' : '◀ Steer left, back into the green!')
        : m.lock > 0 ? 'Jammed! Wait for it to cool…'
        : m.heat > 0.75 ? 'Too hot, it is shaking! Let go to cool it.'
        : on ? 'Keep the bit in the green! Steer with ' + keys + '.'
        : (touch ? 'Hold ✋ to drill · steer with the stick (⤴ = stop)' : 'Hold E to drill · steer with A / D (Space = stop)');
      if (m.depth >= 1) {
        // a clean core: no jams and hardly any time outside the layer
        var q = m.jams === 0 && m.out < 1 ? 2 : m.jams <= 1 && m.out < 3 ? 1 : 0, kind = m.kind, idx = m.idx;
        endMini();
        if (kind === 'ice') { A.pick(A.spawn('ice', A.handPos(v1), null, 'rest')); Au.play('ice'); tip('ice', 'A chunk of ice! The Air Maker can split it into oxygen. The rover bed carries four at a time.'); }
        else {
          var core = sim.drillCore(s, idx, q);
          A.pick(A.spawn('core', A.handPos(v1), core, 'rest')); Au.play('core');
          toastAt(B.spots.drill[idx], ['Rough core', 'Good core!', 'Perfect core! ✨'][q], '#ffd23f');
          Au.line(['act-core-rough', 'act-core-good', 'act-core-perfect'][q]);
          tip('core', 'A rock core! Take it to the Science Lab to find out what it is made of.');
        }
        return;
      }
      U.drillUi(m);
    } else {
      if (G.input.jump) { endMini(); U.dialUi(null); return; }
      m.lock = Math.max(0, m.lock - dt);
      if (m.lock <= 0) { m.needle += m.dir * m.speed * dt; if (m.needle > 1) { m.needle = 1; m.dir = -1; } if (m.needle < 0) { m.needle = 0; m.dir = 1; } }
      if (G.ePressed && m.lock <= 0) {
        if (Math.abs(m.needle - m.c) <= m.w / 2) {
          m.hits++; Au.play('hit'); m.lock = 0.25;
          m.c = 0.15 + Math.random() * 0.7;
          if (m.hits >= m.need) {
            sim.repairDone(s); Au.play('good'); U.dialUi(null); G.mini = null; a.mode = 'walk';
            var stillOff = sim.machine(s, m.machine).broken;
            say(stillOff ? 'Repaired! But the pump fuse is still blown, so the Greenhouse stays off until tonight.' : 'Fixed! The ' + JA.MACHINES[m.machine].name + ' is running again.', true, stillOff ? null : m.machine + '-fixed');
            return;
          }
        } else {
          sim.repairMiss(s); Au.play('spark', { at: B.repair[m.machine] }); m.lock = 0.7; W.cam.shake = 0.25;
          var rp = B.repair[m.machine]; W.burst(rp.x, rp.y + 0.6, rp.z, 16, 5, 0xffe36a, { life: 0.5, size: 0.2 });
          say('Zap! A short circuit wasted some solar charge.', true);
        }
      }
      U.dialUi(m);
    }
  }
  function startRepair(advised) {
    var s = G.s, g = s.glitch, ease = s.level.ease, wear = s.mods.dial;
    G.mini = { type: 'dial', machine: g.machine, needle: 0, dir: 1, hits: 0, need: 3, lock: 0, c: 0.3 + Math.random() * 0.4,
      speed: (advised ? 0.75 : 1.5 / Math.sqrt(ease)) * wear, w: advised ? 0.34 : 0.13 * ease / Math.sqrt(wear),
      title: (advised ? '📡 Earth\'s instructions: ' : '🔧 ') + 'Fixing the ' + JA.MACHINES[g.machine].name,
      hint: (touch ? 'Tap ✋' : 'Press E') + ' when the white line is in the green zone. Three times! (' + (touch ? '⤴' : 'Space') + ' = stop)' };
    A.astro.mode = 'busy'; A.astro.vel.set(0, 0, 0);
    if (G.pov) { var rp0 = B.repair[g.machine]; W.cam.yaw = Math.atan2(rp0.x - A.astro.pos.x, rp0.z - A.astro.pos.z) + Math.PI; W.cam.fpPitch = 0.02; }
  }
  function repairModal() {
    var s = G.s, g = s.glitch, def = JA.REPAIRS[g.machine], info = sim.commInfo(s), dish = s.m.comms.on;
    U.modal('<div class="big-icon">🔧</div><h2>' + esc(def.title) + '</h2><p>' + esc(def.text) + '</p>' +
      '<button class="opt" data-act="self"><b>🔧 Fix it myself, right now</b><span>Tricky without instructions: the green zone is small. Every slip wastes half a power cell of charge.</span></button>' +
      '<button class="opt" data-act="ask"' + (dish ? '' : ' disabled') + '><b>📡 Ask Mission Control for the steps</b><span>' +
      (dish ? 'With their instructions the fix is easy. But a radio message takes ' + esc(info.oneWay) + ' each way' + (info.minutes ? ' — ' + esc(info.round) + ' there and back. The machine stays broken while you wait (' + Math.round(info.wait) + ' seconds of game time).' : ' — almost no wait at all!')
        : 'The Radio Dish has no power today, so you cannot call Earth.') + '</span></button>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="later">Later</button></div>',
      { noFocus: true, speak: def.title + ' ' + def.text, actions: {
        self: function () { Au.play('tap'); U.closeModal(); startRepair(false); },
        later: function () { Au.play('tap'); U.closeModal(); },
        ask: function () {
          var r = sim.askEarth(s);
          if (!r.ok) { Au.play('deny'); return; }
          ext('mission', 'repairSent', s);
          Au.play('page'); U.closeModal();
          say(s.site.id === 'moon' ? 'We got your question! The Moon is only 1.3 light-seconds from Earth, so our answer is on its way.'
            : 'Your question is on its way to Earth. It takes ' + r.info.oneWay + ' to get there, and the answer takes just as long to come back. Keep working — I will call you when it arrives.', true, s.site.id === 'moon' ? 'dish-sent-moon' : null);
        }
      } });
  }

  // =====================================================================
  //  EVENTS FROM THE MISSION RULES
  // =====================================================================
  function spawnBag() {
    var n = A.items.filter(function (it) { return it.tag === 'tray'; }).length, sl = B.spots.bagTray[n % 4];
    var it = A.spawn('bag', v1.set(sl.x, sl.y + Math.floor(n / 4) * 0.45, sl.z), { name: 'soil bag' }, 'fixed');
    it.tag = 'tray'; Au.play('bag', { at: B.pos.bag });
  }
  function handleEvents(ev) {
    var s = G.s;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      // Mission Control logs the event; the big ones become a cutaway when the crew is at home
      var cut = ext('mission', 'event', e, s);
      if (cut) startCut(cut.kind, cut);
      if (e.type === 'cell') { syncRack(); Au.play('ding', { at: B.spots.rack }); }
      else if (e.type === 'air') { Au.play('air', { at: B.pos.air }); toastAt(B.pos.air, '+' + e.amount + ' 💨', '#4fd8ff'); if (s.sol === 1) tip('airIntro', 'This is our air. The crew breathes it all day, so keep the Air Maker busy.'); }
      else if (e.type === 'bag') spawnBag();
      else if (e.type === 'ripe') { tip('ripe' + s.sol, 'The veggies are ripe! Pick them at the Greenhouse.'); Au.play('good'); }
      else if (e.type === 'empty') {
        if (e.machine === 'air' && s.m.air.queue > 0) say('The Air Maker used up its power cell, and there is still ice waiting.', true);
        else if (e.machine === 'lab' && s.m.lab.queue.length) say('The Lab used up its power cell, and cores are still waiting.', true);
        else if (e.machine === 'food') say('The grow lamps ran out of power. Plants stop growing in the dark.', true, undefined, false, 'plant');
      }
      else if (e.type === 'discovery') { fxPulse('glow', 0.8); Au.play('discovery'); findCard(e.find); }
      else if (e.type === 'why') showWhy(e.id);
      else if (e.type === 'break') {
        var bl = (JA.VOICE || {})[e.machine + '-broken'];      // the bubble shows what the recorded line says, plus where to look
        Au.play('bad'); Au.play('spark', { at: B.repair[e.machine] });
        say((bl ? bl.t : JA.REPAIRS[e.machine].title) + ' Look for the sparks.', true, e.machine + '-broken', true);
      }
      else if (e.type === 'advice') { Au.play('page'); say('Mission Control\'s answer has arrived! Go back to the ' + JA.MACHINES[e.machine].name + ' to finish the repair.', true, 'dish-answer'); }
      else if (e.type === 'storm') {
        var inside = G.mode === 'inside';
        if (e.phase === 'warning') {
          fxPulse('glitch', 0.7); Au.play('storm-alert');
          // what the warning says depends on what is coming: particles after an eruption, or a CME's shock wave arriving
          var cmeDay = s.storm && s.storm.cause === 'cme';
          say(inside ? 'A solar storm is on its way. Good thing you are inside!'
            : s.m.comms.on ? (cmeDay ? 'Earth says a cloud of solar gas is about to sweep past. Its shock wave carries fast particles. Head for the airlock!' : 'We just spotted a solar flare! A radiation storm is coming. Head for the airlock!')
              : 'Your suit sensor just caught a solar storm! The dish is off, so we could not warn you early. RUN for the airlock!',
            true, inside ? 'storm-inside' : s.m.comms.on ? (cmeDay ? 'storm-countdown' : 'storm-spotted') : 'storm-no-warning', true);
        }
        else if (e.phase === 'active') {
          if (!inside) say('Radiation storm! You cannot see it or feel it, but your suit sensor can. Get inside!', true, 'storm-active', true);
          tip('clicks', 'That clicking is your suit\'s radiation sensor. More clicks mean more radiation.');
        }
        else { Au.play('good'); say('The storm has passed. All clear!', true); }
      }
      else if (e.type === 'devil') {
        // the one lucky dust devil of the mission (sim.planDevil): it comes in from the plain and crosses the panels
        if (e.phase === 'coming') { if (A.sendDevil) A.sendDevil(e.lead); }
        else if (e.gain > 0.01) {
          Au.play('good', { at: B.pos.solar });
          toastAt(B.pos.solar, '🌪️ +' + Math.round(e.gain * 100) + '% solar power', '#ffd23f');
          say('Lucky break! A dust devil just crossed the solar panels and blew some of the dust off. That happened to the Spirit and Opportunity rovers too — but only now and then.', true);
        }
      }
      else if (e.type === 'daygoal') { fxPulse('glow', 1); Au.play('discovery'); U.toast('🎯 Challenge done!', W.w / 2, W.h * 0.3, '#ffd23f'); say('Today\'s challenge is done: ' + s.day.goal.text.toLowerCase() + '. Nice work!', true, 'hud-challenge-done'); }
      else if (e.type === 'crisis') { fxPulse('glitch', 1); crisisModal(); }
      else if (e.type === 'consequence') showConsequence(e);
      else if (e.type === 'fail') { failNow(e.reason); return; }
      else if (e.type === 'dayEnd') { onDayEnd(); return; }
    }
  }

  // =====================================================================
  //  CRISIS MOMENTS: no checklist, more than one way out, consequences later
  // =====================================================================
  function crisisModal() {
    var s = G.s, v = JA.crisis.view(s);
    if (!v) return;
    G.crisisOpen = true;
    if (G.mini) { endMini(); U.dialUi(null); }
    G.charge = null; A.astro.aim = false; hideAim(); Au.stopAll(); Au.play('alarm');
    W.cam.shake = Math.max(W.cam.shake, 0.3);
    // On Mars the call comes from the crewmate inside: Earth would hear about this crisis only minutes from now.
    var mars = s.site.id === 'mars';
    var far = mars ? ' Earth is ' + sim.commInfo(s).oneWay + ' away by radio, far too slow to help in time.' : ' There is no time to talk it through.';
    U.modal('<div class="day-head crisis-head"><span class="big-icon">' + v.icon + '</span><div><small>⚠ ' + esc(v.alarm) + ' · YOUR CALL</small><h2>' + esc(v.title) + '</h2></div></div>' +
      '<p>' + esc(v.text) + '</p>' +
      '<div class="crisis-radio"><div class="radio-badge" aria-hidden="true">📡<i></i><i></i></div><p><small>' + esc(U.RADIO_FROM[mars ? 'crew' : 'earth']) + '</small>We have no checklist for this one, Commander.' + esc(far) + ' There is more than one thing you could do. You decide.</p></div>' +
      v.options.map(function (o) { return '<button class="opt" data-act="pick" data-v="' + o.id + '"><b>' + o.icon + ' ' + esc(o.label) + '</b><span>' + esc(o.text) + '</span></button>'; }).join('') +
      '<p class="sub crisis-foot">⏸ The clock is stopped while you think. Nobody will tell you which choice is best. You will see what yours leads to.</p>',
      { cls: 'crisis', noFocus: true, speak: v.title + ' ' + v.text + ' You decide.' + v.options.map(function (o, i) { return ' Choice ' + (i + 1) + ': ' + o.label + '. ' + o.text; }).join(''), line: 'crisis-your-call', actions: { pick: function (el) { crisisPick(el.getAttribute('data-v')); } } });
  }
  function crisisPick(id) {
    var s = G.s, r = JA.crisis.choose(s, id);
    if (!r) return;
    journalAdd('crisis', r.d.id);
    Au.play('plug');
    U.modal('<div class="big-icon">' + r.d.optIcon + '</div><h2>' + esc(r.d.label) + '</h2><p>' + esc(r.d.now) + '</p>' +
      '<p class="sub">Was it the right call? Keep going. What happens next will show you.</p>' +
      '<div class="modal-actions"><button class="btn primary" data-act="ok">Carry on ▶</button></div>',
      { speak: r.d.now, actions: { ok: function () {
        Au.play('page'); U.closeModal(); G.crisisOpen = false;
        if (r.sync) syncRack();
        if (r.skip) skipTime(r.skip, r.home);
      } } });
  }
  // A choice that takes time: the shift clock jumps forward while you work on it indoors.
  function skipTime(frac, home) {
    var s = G.s, secs = frac * s.dayLength, total = secs, ev = [], guard = 0;
    if (home && G.mode === 'play') {
      if (A.rover.driver) { A.exitRover(); Au.stopLoop('rover'); }
      if (A.astro.carrying) A.setDown();
      A.resetAstro(); W.cam.yaw = 0.45;
    }
    U.fade(true); setTimeout(function () { if (G.mode === 'play' || G.mode === 'inside') U.fade(false); }, 450);
    while (secs > 0 && !s.dayDone && !s.over && guard++ < 4000) { var st = Math.min(0.5, secs); secs -= st; ev = ev.concat(sim.tick(s, st, { outside: false })); }
    U.banner('⏩ ' + clockText(total) + ' of the shift went into the job', 'info'); G.bannerUntil = G.clock + 5;
    var ended = ev.some(function (e) { return e.type === 'dayEnd'; });
    handleEvents(ev.filter(function (e) { return e.type !== 'dayEnd'; }));
    if (ended && (G.mode === 'play' || G.mode === 'inside')) { if (s.sol >= s.totalSols) onDayEnd(); else endDay({}); }
  }
  function showConsequence(e) {
    var r = e.res, d = e.d;
    Au.play(r.tone === 'good' ? 'good' : r.tone === 'bad' ? 'bad' : 'page');
    U.card({ kind: 'conseq', tone: r.tone, icon: r.tone === 'good' ? '✅' : r.tone === 'bad' ? '⚠️' : '⚖️', title: 'You chose: ' + d.label, text: r.text });
    if (r.spark) {
      [B.pos.comms, B.pos.food].forEach(function (p) { W.burst(p.x, p.y - 2, p.z, 26, 6, 0xffe36a, { life: 0.7, size: 0.26 }); });
      Au.play('spark'); W.cam.shake = Math.max(W.cam.shake, 0.3);
    }
    syncRack();
  }
  function decisionHtml(d, more) {
    var later = d.later.map(function (l) { return '<li class="' + l.tone + '">' + (l.tone === 'good' ? '✅' : l.tone === 'bad' ? '⚠️' : '⚖️') + ' ' + esc(l.text) + '</li>'; }).join('');
    return '<div class="decision"><b>' + d.icon + ' ' + esc(d.title) + '</b>' +
      '<p><span class="tagline choice">You chose</span>' + d.optIcon + ' ' + esc(d.label) + '</p>' +
      '<ul><li>' + esc(d.now) + '</li>' + later + '</ul>' +
      (more ? '<p class="sub">Some consequences only show up tomorrow morning.</p>' : '') +
      '<div class="fact"><b>🛰️ What real crews did</b><p>' + esc(d.science) + '</p>' + srcLine(d.src) + '</div></div>';
  }

  // =====================================================================
  //  PAUSE + TIME: the player decides how long a working day lasts
  // =====================================================================
  // =====================================================================
  //  EXTRAS: helmet view, postcards, music, certificate
  // =====================================================================
  function settingsMenu(on) {
    U.show($('settings-menu'), on);
    $('btn-settings').setAttribute('aria-expanded', String(on));
    $('btn-settings').classList.toggle('on', on);
  }
  function setPov(on, quiet) {
    G.pov = !!on; G.tips.pov = 1;
    if (!quiet) G.povAuto = false;
    W.cam.fp = G.pov; W.cam.fpPitch = 0.06;
    if (A.setFirstPerson) A.setFirstPerson(G.pov);
    var b = $('btn-view'), t = $('t-view');
    if (b) { b.classList.toggle('on', G.pov); b.setAttribute('aria-pressed', String(G.pov)); }
    if (t) { t.classList.toggle('on', G.pov); t.setAttribute('aria-pressed', String(G.pov)); }
    if (quiet) return;
    Au.play('swish');
    if (G.mode === 'play' || G.mode === 'inside') say(G.pov ? 'Helmet view! You are looking through your own visor now.' : 'Back to the outside view.', true);
  }
  // A postcard of exactly what you see. The picture is made in this browser and never sent anywhere.
  // ---------- the camera: effects and filters (js/fx.js) ----------
  function fxPulse(kind, amount) { if (JA.fx && JA.fx.pulse) JA.fx.pulse(kind, amount); }
  function fxTag() {
    var el = $('fx-tag'), f = JA.fx && JA.fx.on && !JA.fx.failed ? JA.fx.current() : null, show = !!f && f.id !== 'natural';
    if (!el) return;
    U.show(el, show);
    if (show) el.textContent = f.icon + ' ' + f.name;
  }
  function nextFx() { if (JA.fx) JA.fx.nextLevel(); fxTag(); }          // full, lite, off
  function nextFilter() {
    if (!JA.fx || !JA.fx.available()) return;
    if (!JA.fx.on) JA.fx.setOn(true);
    var f = JA.fx.nextFilter();
    Au.play('photo'); fxPulse('flash', 0.18); fxTag();
    say(f.note, true);
  }
  function snapPostcard() {
    var s = G.s;
    if (!s || (G.mode !== 'play' && G.mode !== 'inside' && G.mode !== 'observe') || !JA.keepsake || U.modalOpen() || infoOpen()) return;
    W.update(0);                                   // draw a fresh picture, then copy it straight away
    var card = ext('keepsake', 'postcard', $('scene'), 'Greetings from ' + s.site.name + '!', dayWord() + ' ' + s.sol + ' \u00b7 ' + s.site.place + ' \u00b7 Astro Outpost');
    if (!card) return;
    Au.play('photo'); U.fade(true); setTimeout(function () { U.fade(false); }, 140);
    ext('keepsake', 'openPostcard', card);
  }
  function musicOn() { return G.opts.music !== false; }
  function setMusic(on) { G.opts.music = !!on; ext('music', 'setOn', G.opts.music && Au.soundOn()); }
  function musicMood() {
    if (Au.musicOn && Au.musicOn()) return 'off';             // a recorded piece is playing (title, night, film): the generated music waits
    if (G.mode === 'title' || G.mode === 'end') return 'title';
    if (G.mode === 'intro') return 'off';     // the landing film has its own sound
    if (G.mode === 'observe') return 'night'; // the lookout: only the quietest music
    if (G.mode === 'vision') return 'launch';
    if (G.mode === 'night' || G.mode === 'brief') return 'night';
    if (G.mode === 'launch') return 'launch';
    if (G.crisisOpen) return 'crisis';
    var ph = G.s ? sim.stormPhase(G.s) : 'none';
    return ph === 'warning' || ph === 'active' ? 'storm' : 'work';
  }
  function certificateInfo() {
    var s = G.s, rank = sim.rankFor(s), storms = [];
    s.weather.forEach(function (w, i) { if (w && w.level > 0 && i < s.sol) storms.push({ date: JA.weather.prettyDate(w.date), cls: w.cause === 'cme' ? 'CME' : 'SEP', level: w.level }); });
    return { name: '', won: true, rank: { icon: rank.icon, name: rank.name }, site: { id: s.site.id, name: s.site.name, place: s.site.place },
      level: s.level.name, days: s.totalSols, dayWord: dayWord().toLowerCase() + 's',
      badges: sim.badges(s).map(function (b) { return { icon: b.icon, name: b.name }; }), storms: storms,
      source: s.weatherFallback ? 'archive' : s.weatherSource, from: JA.weather.prettyDate(s.weather[0].date), to: JA.weather.prettyDate(s.weather[s.weather.length - 1].date),
      decisions: s.decisions.length, finds: s.finds.length,
      today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  function collectRock() {
    var f = ext('sky', 'collect', G.s);
    if (!f) return;
    Au.play('discovery'); U.card(f);
    tip('rock', 'A real rock from space! Scientists study meteorites to learn how the planets were made.');
  }
  // what the Pioneer mode module (js/pioneer.js) may ask the game to do
  var vHit = T ? new T.Vector3() : null;
  var PIONEER = { say: function (text, topic) { say(text, true, undefined, false, topic); }, toast: function (text, pos, color) { toastAt(pos, text, color); },
    why: function (id) { if (G.s) sim.note(G.s, id); }, openInfo: function (html) { return G.openInfo(html); }, closeInfo: function () { if (infoOpen()) closeInfo(); },
    sound: function (name, o) { Au.play(name, o); }, sync: function () { if (G.s) syncRack(); } };
  var SKY = { outside: true, pos: null, say: function (t) { say(t, true); }, tip: function (id, t) { return tip(id, t); } };
  var POV = { yaw: 0, pos: null, home: null, goal: null, goalIcon: '', air: 0, moving: false, effort: false };

  function pauseModal() {
    var s = G.s;
    if (!s || (G.mode !== 'play' && G.mode !== 'inside') || U.modalOpen()) return;
    Au.play('tap');
    function extra(act, icon, title, text, sel) {
      return '<button class="pick' + (sel ? ' sel' : '') + '" data-act="' + act + '"' + (sel == null ? '' : ' aria-pressed="' + !!sel + '"') + '><em>' + icon + '</em><b>' + title + '</b><span>' + esc(text) + '</span></button>';
    }
    function draw() {
      var left = (1 - s.t / s.dayLength);
      var keep = document.querySelector('#modal-root .modal.pause'), scroll = keep ? keep.scrollTop : 0;
      var card = U.modal('<div class="big-icon">⏸</div><h2>Paused</h2><p class="sub">Nothing moves while this card is open. Take all the time you need.</p>' +
        '<h3>⏱️ How long should a working day be?</h3><div class="cards four">' +
        JA.SHIFTS.map(function (sh) {
          return '<button class="pick' + (s.dayLength === sh.id ? ' sel' : '') + '" data-act="shift" data-v="' + sh.id + '" aria-pressed="' + (s.dayLength === sh.id) + '"><em>' + sh.icon + '</em><b>' + sh.name + ' · ' + (sh.id / 60) + ' min</b><span>' + esc(sh.text) + '</span></button>';
        }).join('') + '</div>' +
        '<p>Time left in today\'s shift: <b>' + clockText(left * s.dayLength) + '</b>. Changing the day length keeps your place in the day, so the time left stretches or shrinks with it. Air, food and power per day stay the same.</p>' +
        '<h3>🎒 Extras</h3><div class="cards four">' +
        extra('pov', '👁️', 'Helmet view', touch ? 'See through your own visor.' : 'See through your own visor. Key: V', !!G.pov) +
        (JA.keepsake ? extra('snap', '📷', 'Postcard', touch ? 'Save a picture of what you see.' : 'Save a picture of what you see. Key: C') : '') +
        (JA.sunwatch ? extra('sun', '☀️', 'Sun Watch', 'The real NASA space weather behind your mission.') : '') +
        (JA.music ? extra('music', '🎵', 'Music', musicOn() ? 'On. Pick to switch it off.' : 'Off. Pick to switch it on.', musicOn()) : '') +
        (JA.journal ? extra('journal', '📓', 'Field Journal', JA.journal.count(s.site.id).have + ' of ' + JA.journal.count(s.site.id).total + ' pages found.' + (touch ? '' : ' Key: J')) : '') +
        (JA.holo ? extra('ask', '💡', 'Holo-tablet', touch ? 'Holograms that show how things work.' : 'Holograms that show how things work. Key: T') : '') +
        (JA.fx && JA.fx.available() ? extra('filter', JA.fx.current().icon, 'Camera: ' + JA.fx.current().name, touch ? 'See like a real space camera. Pick to change.' : 'See like a real space camera. Key: L') +
          extra('fx', '✨', 'Camera effects: ' + JA.fx.LEVELS[JA.fx.level], (JA.fx.level === 2 ? 'Glow, lens flare, film grain.' : JA.fx.level === 1 ? 'A lighter version for slower devices.' : 'The plain picture.') + (touch ? ' Pick to change.' : ' Key: X'), JA.fx.level > 0) : '') + '</div>' +
        '<div class="modal-actions"><button class="btn ghost" data-act="quit">Quit mission</button><button class="btn ghost" data-act="how">How to play</button><button class="btn primary" data-act="ok">Back to work ▶</button></div>',
        { cls: 'wide pause', noFocus: true, actions: {
          shift: function (el) { var v = parseInt(el.getAttribute('data-v'), 10); sim.setDayLength(s, v); G.opts.shift = v; Au.play('tap'); draw(); refocus('[data-act="shift"][data-v="' + v + '"]'); },
          pov: function () { setPov(!G.pov); draw(); refocus('[data-act="pov"]'); },
          snap: function () { U.closeModal(); snapPostcard(); },
          sun: function () { Au.play('tap'); ext('sunwatch', 'open', s, G.weather); },
          music: function () { setMusic(!musicOn()); Au.play('tap'); draw(); refocus('[data-act="music"]'); },
          journal: function () { openJournal(); },
          ask: function () { Au.play('tap'); U.closeModal(); holoMenu(); },
          filter: function () { nextFilter(); draw(); refocus('[data-act="filter"]'); },
          fx: function () { nextFx(); Au.play('tap'); draw(); refocus('[data-act="fx"]'); },
          how: function () { Au.play('tap'); howInfo(); },
          quit: function () { Au.play('tap'); U.closeModal(); titleScene(); },
          ok: function () { Au.play('tap'); U.closeModal(); }
        } });
      card.scrollTop = scroll; if (keep) card.style.animation = 'none';
    }
    draw();
  }
  function stormFrame(outside) {
    var s = G.s, st = s.storm, ph = sim.stormPhase(s);
    if (ph === 'warning') {
      var secs = Math.ceil(st.start - s.t);
      if (outside) { U.stormFx('warn'); U.banner('⚠️ Solar storm in ' + secs + ' s — get to the airlock!', ''); if (secs !== G.lastWarn) { if (secs === 10 && G.lastWarn > 10) say('Solar storm coming. Get to the airlock!', true, 'storm-countdown', true); G.lastWarn = secs; Au.play('warn'); } }
      else U.banner('⚠️ A solar storm is coming — you are safe inside', '');
      G.bannerUntil = G.clock + 1;
    } else if (ph === 'active') {
      W.env.storm = 1; U.stormFx(outside ? 'active' : 'inside');
      if (outside && JA.fx && JA.fx.level && s.t > st.start + 2) tip('flashes', 'See those tiny streaks of light? Astronauts really see flashes like that when space radiation zips through their eyes!');
      U.banner(outside ? '☢️ RADIATION STORM! Get inside!' : '☢️ Storm outside — home shield blocks ' + Math.round(sim.shield(s) * 100) + '%', outside ? 'active' : '');
      G.bannerUntil = G.clock + 1;
      G.geiger -= G.dt;
      if (G.geiger <= 0) { Au.play('click'); G.geiger = outside ? 0.03 + Math.random() * 0.09 : 0.15 + Math.random() * 0.3; }
    } else {
      if (W.env.storm) { W.env.storm = 0; U.banner('✅ The storm has passed', 'safe'); G.bannerUntil = G.clock + 4; }
      U.stormFx('');
      if (G.clock > G.bannerUntil) U.banner(null);
    }
  }

  // =====================================================================
  //  PLAYING OUTSIDE
  // =====================================================================
  function stepPlay(dt) {
    var s = G.s, a = A.astro, r = A.rover;
    W.env.t = 0.06 + 0.88 * (s.t / s.dayLength);
    var moving = Math.hypot(G.input.x, G.input.z) > 0.2;
    var ev = sim.tick(s, dt, { outside: true, sprint: G.input.puff && moving && !r.driver, driving: r.driver && Math.abs(r.speed) > 0.6, calm: s.sol === 1 && G.tutStep < 4 });
    handleEvents(ev);
    if (G.mode !== 'play') return;
    stepRigs(dt);
    G.lookIdle += dt;
    if (r.driver) {
      if (G.lookIdle > (G.pov ? 0.6 : 1.2)) { var want = r.yaw + Math.PI, df = want - W.cam.yaw; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2; W.cam.yaw += df * Math.min(1, dt * (G.pov ? 7 : 2.4)); }
      Au.loop('rover', { f: 46 + Math.abs(r.speed) * 9, v: 0.035 + Math.abs(r.speed) * 0.003, type: 'sawtooth', rate: 0.7 + Math.abs(r.speed) * 0.045, vol: 0.45 + Math.abs(r.speed) * 0.04 });
      if (s.m.rover.charge <= 0) tip('roverEmpty' + s.sol, 'The rover battery is empty, so it can only crawl. Plug in a fresh power cell!');
    } else if (G.lookIdle > 0.7 && !G.charge && !G.mini) W.cam.yaw -= G.input.x * 1.0 * dt;
    W.cam.dist += ((r.driver ? G.zoom * 1.45 : G.zoom) - W.cam.dist) * Math.min(1, dt * 3);
    if (!G.tut.moved && a.moved > 10 && G.tut.jumped) G.tut.moved = true;
    if (G.mini) { G.action = null; stepMini(dt); }
    else {
      updateThrow(dt);
      G.action = G.charge ? null : findAction();
      if (G.ePressed && G.action && G.action.run) G.action.run();
      if (G.qPressed && a.carrying && !G.charge) { A.setDown(); Au.play('drop'); }
      else if (G.qPressed && G.action && G.action.alt) G.action.alt();
    }
    stormFrame(true);
    // things Mission Control points out once, when they matter
    Au.breathe(dt, G.input.sprint && moving && !r.driver);
    if (JA.observe && !s.lookout && !r.driver && JA.observe.near(a.pos) < 14) tip('lookout', 'That flat rock with the gold blanket is the lookout. Sit down for a moment and look at the sky.');
    if (s.leak > 0) tip('leak' + s.sol, 'Air leak! The tanks are losing air.');
    else if (s.stale > 1) tip('stale' + s.sol, 'The air is going stale. It is draining fast!');
    if (s.sol < s.totalSols && s.t > s.dayLength * 0.7 && s.food < sim.dinner(s)) tip('short' + s.sol, 'There is not enough food for tonight\'s dinner!');
    if (s.sol === 2 && s.t > 20 && !G.mini) tip('hear', s.site.id === 'moon' ? 'Hear how quiet it is? The Moon has no air to carry sound. You only hear what travels through your suit.'
      : 'Everything sounds faint and muffled out here. The thin Mars air carries sound poorly. The Perseverance rover\'s microphones heard the same thing.');
  }

  // =====================================================================
  //  WHAT THE OUTPOST SOUNDS LIKE RIGHT NOW
  // =====================================================================
  var HUMS = { air: 'loop-air-maker', food: 'loop-greenhouse', rack: 'loop-solar-rack', bag: 'loop-soil-bagger', lab: 'loop-lab', comms: 'loop-radio-dish' };
  function soundFrame(dt, paused) {
    var s = G.s, mode = G.mode, live = !!s && (mode === 'play' || mode === 'inside' || mode === 'observe'), m = live ? s.m : null, on = {}, p = null, id;
    if (mode !== 'intro') {                               // the landing film sets its own scene
      var ph = live ? sim.stormPhase(s) : '';
      Au.scene({ place: mode === 'play' || mode === 'launch' || mode === 'observe' ? 'out' : mode === 'inside' ? 'in' : 'menu', site: s ? s.site.id : '', dust: W.env.dust, storm: ph === 'active' ? 2 : ph === 'warning' ? 1 : 0 });
    }
    Au.hush(paused && live);
    if (live) {
      p = me(); Au.ears(p.x, p.z, W.camera);
      // a machine hums while it is really working, and you hear it from where it stands
      on.air = !m.air.broken && m.air.power > 0 && m.air.queue > 0;
      on.food = m.food.lamp > 0 && !m.food.broken;
      on.rack = !s.rack.broken && s.rack.cells < sim.rackMax(s) && s.t <= s.dayLength * R.chargeSpan;
      on.bag = m.bag.pending > 0 && !m.bag.broken;
      on.lab = !m.lab.broken && m.lab.power > 0 && m.lab.queue.length > 0;
      on.comms = m.comms.on;
    }
    for (id in HUMS) Au.hum(HUMS[id], !!on[id], B.pos[id]);
    // anything broken spits sparks; a dust devil hisses as it passes
    var devil = null;
    if (mode === 'play' && !paused) {
      G.sparkAt -= dt;
      if (G.sparkAt <= 0) {
        G.sparkAt = 0.7 + Math.random() * 1.6;
        ['air', 'food', 'lab', 'rack'].forEach(function (k) { if ((k === 'rack' ? s.rack : m[k]).broken) Au.play('spark', { at: B.repair[k], vol: 0.7 }); });
      }
      var best = 45;
      A.devils.forEach(function (d) { var dd = d2(p, d.pos); if (dd < best) { best = dd; devil = d; } });
    }
    if (devil) Au.loop('devil', { at: devil.pos, keep: true, fade: 0.3 }); else Au.stopLoop('devil', 0.3);
    Au.frame(dt);
  }

  // =====================================================================
  //  INSIDE THE HABITAT
  // =====================================================================
  // You walk in through the door and really are inside: the habitat (bunks, plants, console...) or the rocket's cockpit.
  // Being in either one counts as indoors for the solar storms.
  function goInside(id) {
    var s = G.s;
    if (!s || G.room) return;
    if (A.rover.driver) { A.exitRover(); Au.stopLoop('rover'); }
    if (A.astro.carrying) A.setDown();
    var r = ext('interior', 'enter', id);
    Au.play('door'); Au.stopAll();
    G.mode = 'inside'; G.fast = false; G.charge = null; G.mini = null; hideAim(); A.astro.aim = false;
    U.show($('inside'), true); U.show($('prompt'), false); U.hands(null); U.roverHud(0, false); U.drillUi(null);
    $('btn-fast').classList.remove('on');
    if (r) {
      G.room = id; document.body.classList.add('in-room'); document.body.classList.toggle('in-rocket', id === 'rocket');
      A.room = r.walk; W.cam.room = r.cam;
      var a = A.astro;
      a.mode = 'walk'; a.pos.copy(r.spawn); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; a.yaw = r.yaw;
      W.cam.mode = 'play'; W.cam.yaw = r.yaw + Math.PI; W.cam.pitch = 0.28; W.cam.fpPitch = 0.05; W.cam.dist = id === 'rocket' ? 2 : 4.2;
      if (!G.pov) { G.povAuto = true; setPov(true, true); }        // rooms are small: you see them through your own visor (V switches back)
      W.snapCamera();
      U.fade(true); setTimeout(function () { if (G.room === id) U.fade(false); }, 260);
    } else {                                           // no interior module: the old way, a view of the dome from outside
      A.astro.mode = 'hidden'; W.cam.mode = 'inside';
    }
    $('inside-title').textContent = id === 'rocket' ? '🚀 Inside the rocket' : '🏠 Inside the habitat';
    U.show($('btn-sleep'), id === 'hab' && s.sol < s.totalSols);
    U.show($('btn-sun'), !!JA.sunwatch && id === 'hab');
    touchUi(!!r);
    var ph = sim.stormPhase(s);
    if (id === 'rocket') say(s.sol >= s.totalSols ? 'Welcome aboard! Take the commander\'s seat when you are ready to fly home.' : 'This is the cockpit that will fly you home. Have a look around!', true);
    else say(ph === 'warning' || ph === 'active' ? 'Phew — inside! The walls and the soil bags are soaking up the storm.' : 'Back inside. Take a breather — the machines keep working.', true, ph === 'warning' || ph === 'active' ? 'storm-safe' : 'inside-rest', true);
    if (id === 'rocket') tip('inside-rocket', (touch ? 'Drag the screen to look around the cabin.' : 'Look around the cabin with the mouse.') + ' The couches, the screens, the life support and the lockers each have something to tell you.');
    else tip('inside', touch ? 'Drag the screen to look around, even up at the skylight!' : 'Look around with the mouse — drag down to look up at the skylight!');
  }
  // Back outside (or, with quiet, just forget the room: the day ended, the rocket launched...)
  function leaveRoom(quiet) {
    var id = G.room;
    if (G.cut) endCut(true);
    ext('interior', 'leave');
    A.room = null; W.cam.room = null; G.room = null; document.body.classList.remove('in-room', 'in-rocket');
    if (G.povAuto) { G.povAuto = false; setPov(false, true); }
    U.show($('inside'), false);
    if (quiet) return;
    var a = A.astro;
    if (id === 'rocket') {
      var d = B.spots.rocketDoor, pr = B.P.rocket.base;
      a.pos.set(d.x, A.groundAt(d.x, d.z), d.z); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; a.mode = 'walk';
      a.yaw = Math.atan2(d.x - pr.x, d.z - pr.z); W.cam.yaw = a.yaw + Math.PI;
    } else { A.resetAstro(); W.cam.yaw = 0.45; }
    G.mode = 'play'; G.fast = false; W.cam.mode = 'play'; W.cam.pitch = 0.36;
    Au.play('door'); W.snapCamera();
    U.fade(true); setTimeout(function () { if (G.mode === 'play') U.fade(false); }, 260);
    touchUi(true);
    if (sim.stormPhase(G.s) === 'active') say('Careful! The storm is still going.', true);
  }
  function enterHab() { goInside('hab'); }

  // =====================================================================
  //  THE LOOKOUT ROCK: sit down and watch the sky (js/observe.js)
  // =====================================================================
  // While you sit, the mission rules do not run: the clock waits, and nothing interrupts the view.
  function startObserve() {
    var s = G.s;
    if (!s || G.mode !== 'play' || !JA.observe || JA.observe.active() || A.rover.driver || A.astro.carrying) return;
    G.charge = null; G.mini = null; hideAim(); A.astro.aim = false; G.sayQ.length = 0;
    var ok = JA.observe.start({ s: s, pov: !!G.pov, done: endObserve });
    if (!ok) return;
    G.mode = 'observe'; s.lookout = true;
    U.prompt(null); U.hands(null); U.roverHud(0, false); U.banner(null); U.tags([]); U.marks([]); U.stormFx('');
    touchUi(false);
  }
  function stepObserve(dt) {
    JA.observe.step(dt, { x: G.input.x, z: G.input.z });
    if (G.ePressed) standObserve();
  }
  function standObserve() { ext('observe', 'stand', !!G.pov); }
  // he is standing again: back to the normal camera, facing the way he was looking
  function endObserve(r) {
    G.mode = 'play'; W.cam.mode = 'play'; W.cam.yaw = r.yaw + Math.PI; W.cam.pitch = 0.36; W.cam.fpPitch = 0.06; G.lookIdle = 0;
    if (A.setFirstPerson) A.setFirstPerson(!!G.pov);
    touchUi(true);
  }
  function exitHab() { if (G.room) leaveRoom(); else { G.mode = 'play'; A.resetAstro(); W.cam.mode = 'play'; U.show($('inside'), false); touchUi(true); } }
  // What E does inside: each thing in the room has its own action and a real fact.
  function findRoomAction() {
    var s = G.s, p = A.astro.pos, best = null, last = s.sol >= s.totalSols;
    (ext('interior', 'spots') || []).forEach(function (sp) {
      if (sp.id === 'bed' && last) return;
      var d = Math.hypot(p.x - sp.x, p.z - sp.z);
      if (d < sp.reach && (!best || d < best.d)) best = { d: d, id: sp.id, label: sp.id === 'seat' && last ? 'Take your seat and fly home 🚀' : sp.label };
    });
    if (best) best.run = roomAction(best.id);
    return best;
  }
  function roomAction(id) {
    return function () {
      var s = G.s, fact = ext('interior', 'fact', id) || '';
      ext('interior', 'poke', id);
      if (id === 'door' || id === 'hatch') { leaveRoom(); return; }
      if (id === 'bed') { Au.play('tap'); sleepAsk(); return; }
      if (id === 'seat' && s.sol >= s.totalSols) { Au.play('tap'); boardModal(); return; }
      if (id === 'console' || id === 'power' || id === 'life' || id === 'science') {
        Au.play('tap');
        if (!JA.mission) { if (JA.sunwatch) ext('sunwatch', 'open', s, G.weather); return; }
        // the camera settles on the workstation first, then the station card opens over it
        if (!startCut('console', { hold: true, then: function () { ext('mission', 'open', id, MCTX); } })) ext('mission', 'open', id, MCTX);
        return;
      }
      if (id === 'window') { if (G.pov) W.cam.fpPitch = -1.3; else W.cam.pitch = -0.5; G.lookIdle = 0; }
      Au.play(id === 'bike' ? 'jump' : 'page');
      // the water tank reads out the real numbers of this mission
      if (id === 'water') fact = 'This tank is ' + Math.round(s.water) + '% full. The recycler gives back about ' + Math.round(s.mods.recycle * 100) + '% of what the crew drinks. Yes, even the pee!';
      if (fact) { G.tips['room-' + id] = 1; say(fact, true, undefined, false, id === 'water' ? 'water' : id === 'plants' ? 'plant' : ''); }
    };
  }
  // =====================================================================
  //  THE MISSION CONTROL CUTAWAY: the camera glides to the workstation while the game keeps running
  // =====================================================================
  // Only inside the habitat, never over a card, never twice at once. data: { title, text, msg, dur, hold, then, kind }
  function startCut(kind, data) {
    var s = G.s;
    if (!s || G.mode !== 'inside' || G.room !== 'hab') return false;
    if (G.cut) {
      // a station visit whose card has just closed is over; an alert may take over any other cutaway
      if (G.cut.hold && G.cut.opened && !U.modalOpen() && !infoOpen() && !holoOpen()) endCut();
      else if (!G.cut.hold && kind === 'alert' && G.cut.kind !== 'alert') return swapCut(kind, data);
      else return false;
    }
    if (U.modalOpen() || infoOpen() || holoOpen()) return false;
    var view = ext('interior', 'consoleView'); if (!view) return false;
    data = data || {};
    G.cut = { kind: kind, t: 0, dur: data.dur || 7, hold: !!data.hold, then: data.then || null, opened: false,
      yaw: W.cam.yaw, pitch: W.cam.pitch, fpPitch: W.cam.fpPitch, fp: !!G.pov };
    if (G.pov) A.setFirstPerson(false);                      // the body is ghosted in helmet view; the cutaway must see a whole astronaut
    A.astro.vel.set(0, 0, 0);
    W.cam.mode = 'fixed'; W.cam.fixed = { pos: view.pos, look: view.look };
    ['prompt', 'hands', 'inside', 'goals', 'card'].forEach(function (id) { U.show($(id), false); });
    document.body.classList.add('in-cut');
    G.action = null;
    if (!data.hold) {
      ext('mission', 'overlay', { kind: data.kind || kind, title: data.title, text: data.text, msg: data.msg }, s);
      Au.play(kind === 'alert' ? 'warn' : kind === 'fault' ? 'bad' : 'page');
    }
    return true;
  }
  function endCut(quiet) {
    var c = G.cut; if (!c) return;
    G.cut = null;
    ext('mission', 'overlay', null);
    document.body.classList.remove('in-cut');
    if (c.fp) { A.setFirstPerson(true); }
    if (quiet) return;
    W.cam.mode = 'play'; W.cam.yaw = c.yaw; W.cam.pitch = c.pitch; W.cam.fpPitch = c.fpPitch;
    if (G.mode === 'inside' && G.room) { U.show($('inside'), true); U.show($('goals'), true); }
  }
  // A station visit (a held cutaway) that turns into a transmission: keep the camera where it is and show the overlay.
  function swapCut(kind, data) {
    var c = G.cut;
    if (!c) return startCut(kind, data);
    c.hold = false; c.opened = false; c.kind = kind; c.t = 0; c.dur = data.dur || 7;
    ext('mission', 'overlay', { kind: data.kind || kind, title: data.title, text: data.text, msg: data.msg }, G.s);
    Au.play(kind === 'alert' ? 'warn' : 'page');
    return true;
  }
  function stepCut(dt) {
    var c = G.cut, s = G.s; if (!c) return;
    c.t += dt;
    ext('mission', 'overlayFrame', s);
    if (c.hold) {
      // a station visit: once the camera has settled, open the card; when the card closes, come back
      if (!c.opened && c.t > 0.75) { c.opened = true; if (c.then) c.then(); }
      else if (c.opened && !U.modalOpen() && !infoOpen() && !holoOpen()) endCut();
      return;
    }
    if (c.t > c.dur || G.ePressed) { endCut(); G.cutCool = G.clock + 0.8; }     // the same E must not reopen the station you are standing at
  }
  // the radio context the Mission Control module works with
  var MCTX = { s: null, weather: null,
    onSend: function (r) {
      var s = G.s, mdl = JA.mission.model(s);
      say(s.site.id === 'moon' ? 'We got your message! The Moon is only 1.3 light-seconds from Earth, so our answer is on its way.'
        : 'Your message is on its way to Earth. It takes ' + mdl.info.oneWay + ' to get there, and the answer takes just as long to come back. Keep working — I will call you when it arrives.', true, s.site.id === 'moon' ? 'dish-sent-moon' : null);
      swapCut('send', { kind: 'send', title: 'SIGNAL TRANSMITTED', text: 'OUTPOST-01: ' + (r.msg ? r.msg.text : ''), msg: r.msg, dur: 7 });
    },
    onReply: function (m) {
      say(m.text, true, null);
      Au.play('page');
      startCut('reply', { kind: 'reply', title: 'EARTH REPLY RECEIVED', text: 'HOUSTON: ' + m.text, msg: m, dur: 8 });
    } };
  function stepInside(dt) {
    var s = G.s;
    var ev = sim.tick(s, dt * (G.fast ? 8 : 1), { outside: false, calm: s.sol === 1 && G.tutStep < 4, fast: G.fast ? 8 : 1 });
    W.env.t = 0.06 + 0.88 * (s.t / s.dayLength);
    handleEvents(ev);
    if (G.mode !== 'inside') return;
    stepRigs(dt * (G.fast ? 8 : 1));
    if (G.room) {
      G.lookIdle += dt;
      if (G.cut) stepCut(dt);
      else {
        if (G.lookIdle > 0.7 && !G.pov) W.cam.yaw -= G.input.x * 1.0 * dt;
        W.cam.dist += (Math.min(G.zoom, G.room === 'rocket' ? 2.2 : 4.6) - W.cam.dist) * Math.min(1, dt * 3);
        G.action = findRoomAction();
        if (G.ePressed && G.action && G.action.run && !(G.cutCool > G.clock)) G.action.run();
      }
      ROOM.s = s; ROOM.astro = A.astro;
      ext('interior', 'update', dt, ROOM);
    }
    stormFrame(false);
    var left = Math.max(0, Math.ceil(s.dayLength - s.t)), ph = sim.stormPhase(s), wall = G.room === 'rocket' ? 'The rocket\'s walls shield you too.' : 'The home shield blocks ' + Math.round(sim.shield(s) * 100) + '% of radiation.';
    $('inside-text').textContent = (ph === 'active' ? 'A solar storm is raging outside. ' + wall
      : ph === 'warning' ? 'A solar storm is about to hit. Stay in!' : 'Safe inside. ' + wall) +
      ' Shift time left: ' + clockText(left) + '.' + (s.sol >= s.totalSols ? ' Launch day — board the rocket before time runs out!' : '');
  }
  var ROOM = { s: null, astro: null };
  function sleepAsk() {
    var s = G.s;
    if (s.t > s.dayLength * 0.6) { endDay({}); return; }
    U.modal('<div class="big-icon">😴</div><h2>End the day now?</h2><p>There are still ' + clockText(s.dayLength - s.t) + ' minutes of working time left. The machines will keep running, but you will not be able to do anything else today.</p>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="no">Keep working</button><button class="btn primary" data-act="yes">Go to sleep</button></div>',
      { actions: { no: function () { Au.play('tap'); U.closeModal(); }, yes: function () { Au.play('tap'); U.closeModal(); endDay({ sleep: true }); } } });
  }

  // =====================================================================
  //  NIGHT
  // =====================================================================
  function onDayEnd() {
    var s = G.s;
    // still outdoors when the launch window closes: the dash to the rocket costs air, like any late rush home
    if (s.sol >= s.totalSols) { launchHome('Time is up, Commander! It is launch time. We are bringing you home!', 'launch-time-up', G.mode === 'play'); return; }
    if (G.mode === 'play') { say('The shift is over! We are calling you home. That rush used extra air.', true, null, true); endDay({ late: true }); }
    else endDay({});
  }
  function endDay(info) {
    var s = G.s;
    if (G.mode === 'night') return;
    G.mode = 'night'; G.mini = null; G.charge = null; hideAim(); Au.stopAll(); G.sayQ.length = 0;
    if (G.room) leaveRoom(true);
    // the bubble is put away for the night, so these two are heard, not shown
    if (!Au.readingOn()) Au.line(info.late ? 'hud-clock-over' : info.sleep ? 'day-sleep' : null);
    if (A.rover.driver) A.exitRover();
    if (A.astro.carrying) A.setDown();
    A.astro.mode = 'hidden';
    U.fade(true);
    ['goals', 'prompt', 'hands', 'rover-hud', 'mini', 'inside', 'radio'].forEach(function (id) { U.show($(id), false); });
    touchUi(false);
    U.banner(null); U.stormFx(''); U.tags([]); U.marks([]); U.clearCards(); W.env.storm = 0;
    setTimeout(function () {
      var report = sim.endSol(s, info);
      colonyNight(report);
      syncRack();
      W.cam.mode = 'inside'; W.env.t = 0.99;
      U.setHud(s);
      nightModal(report);
    }, 650);
  }
  // The town beside the outpost: the rules are in sim.js (townNight, townMorning), js/colony.js draws it.
  function colonyNight(r) { if (JA.colony && !r.fail && !r.last) r.colony = sim.townNight(G.s); }
  function colonyRow(r) {
    var c = r.colony; if (!c) return '';
    var why = c.ok ? 'Your outpost made enough air and food to look after itself today.'
      : 'Not self-sustaining today: ' + (!c.air ? 'the Air Maker made less than half of the air the crew breathed' : '') + (!c.air && !c.food ? ', and ' : '') + (!c.food ? 'there is not enough food for tomorrow\'s dinner' : '') + '.';
    var more = c.coming ? ' Earth has seen it: a ship is on its way! Look out tomorrow morning.' : c.next ? ' ' + (c.next - c.days) + ' more self-sustaining ' + dayWord().toLowerCase() + (c.next - c.days > 1 ? 's' : '') + ' and Earth will send ' + (c.next === R.townDays[1] ? 'its first supply ship.' : c.next === R.townDays[2] ? 'the first settlers.' : 'more settlers.') : ' Your outpost has grown into a city!';
    if (c.stage >= 2) more += ' Town spirit: ' + Math.round(c.spirit) + '%' + (c.spirit >= R.spiritHelp ? ', so the settlers will lend a hand in the morning.' : c.spirit < R.spiritLow ? '. The town is struggling and will need part of your dinner tomorrow.' : '.');
    return '<div class="info-row' + (c.ok ? ' good' : '') + '"><span class="ic">🌍</span><div><b>Earth is watching · ' + c.days + ' self-sustaining ' + dayWord().toLowerCase() + (c.days === 1 ? '' : 's') + '</b><p>' + esc(why + more) + '</p></div></div>';
  }
  function nightModal(r) {
    var s = G.s, dw = dayWord();
    var names = { air: 'Air', food: 'Food', dose: 'Radiation badge', water: 'Water tank', filter: 'Air filter' };
    var rows = r.lines.map(function (l) {
      var b = r.before[l.res], a = r.after[l.res], unit = l.res === 'dose' || l.res === 'filter' ? '%' : '';
      var better = l.res === 'dose' ? a < b : a > b, same = Math.round(a) === Math.round(b);
      return '<div class="rep"><span class="ic">' + l.icon + '</span><span class="nm">' + names[l.res] + '</span>' +
        '<span class="chg"><small>' + Math.round(b) + unit + ' → </small><span class="' + (same ? '' : better ? 'up' : 'down') + '">' + Math.round(a) + unit + '</span></span>' +
        '<ul>' + l.parts.map(function (p) {
          var good = l.res === 'dose' ? p.v < 0 : p.v > 0;
          return '<li><span>' + esc(p.text) + '</span>' + (p.v ? '<b class="' + (good ? 'up' : 'down') + '">' + (p.v > 0 ? '+' : '') + p.v + unit + '</b>' : '') + '</li>';
        }).join('') + '</ul></div>';
    }).join('');
    r.finds.forEach(journalFind);      // also the ones the Lab finished after you went to bed
    var finds = r.finds.length ? '<h3>🔬 What you discovered today</h3>' + r.finds.map(U.findRow).join('') : '';
    var rep = '';
    if (r.repair) rep = '<p class="sub">🔧 ' + (r.repair.overnight ? 'The crew fixed the ' + JA.MACHINES[r.repair.machine].name + ' overnight, but it was out of action for the rest of the day.'
      : 'You fixed the ' + JA.MACHINES[r.repair.machine].name + (r.repair.asked ? ' with help from Earth' : ' on your own') + (r.repair.misses ? ' (' + r.repair.misses + ' slip' + (r.repair.misses > 1 ? 's' : '') + ').' : ' without a single slip!')) + '</p>';
    var fc = '';
    if (!r.fail) {
      if (r.forecast) {
        var e = s.site.env[r.forecast.env.kind];
        fc = '<h3>📡 Tomorrow\'s forecast</h3><div class="info-row"><span class="ic">' + e.icon + '</span><div><b>' + esc(e.label) + ' · about ' + cellsText(r.forecast.env.cells) + '</b><p>' + esc(e.why) + '</p></div></div>' +
          (r.forecast.full ? U.weatherRow(s, r.forecast.weather, true, 'tomorrow') : '');
      } else fc = '<div class="info-row"><span class="ic">📡</span><div><b>No forecast for tomorrow</b><p>The Radio Dish had no power today, so Earth could not tell you what is coming.</p></div></div>';
    }
    // the science of the day: first why things happened (each one is something you did or met today), then real space facts
    var whys = (r.whys || []).map(function (id) { return JA.mechFor(id, s.site.id); }).filter(Boolean);
    var why = whys.length ? '<h3>🧠 Why things happened today</h3><div class="whys">' + whys.slice(0, 4).map(function (m) {
      var fresh = journalAdd('why', m.id);
      return '<div class="why-row"><em>' + m.icon + '</em><div><b>' + esc(m.title) + (fresh ? '<i class="new-page">new page</i>' : '') + '</b><span>' + esc(m.text) + '</span>' +
        (holoHas(m.holo) ? '<button class="holo-btn" data-act="holo" data-v="' + m.holo + '">▶ Play the hologram</button>' : '') + '</div></div>';
    }).join('') + '</div>' + (whys.length > 4 ? '<p class="sub">And ' + (whys.length - 4) + ' more. They are all in your 📓 Field Journal.</p>' : '') : '';
    whys.slice(4).forEach(function (m) { journalAdd('why', m.id); });
    var fact = (r.facts || [r.fact]).map(function (f) {
      var src = JA.SOURCES[f.src];
      journalAdd('fact', f.id);
      return '<div class="fact"><b>🛰️ Real space fact</b><p>' + esc(f.text) + '</p><small>Source: ' + esc(src.name) + '</small></div>';
    }).join('');
    if (!r.fail && r.dark) fc += '<div class="info-row alert"><span class="ic">🌚</span><div><b>The long dark comes ' + (r.dark === 1 ? 'tomorrow' : 'the day after tomorrow') + '</b><p>A mountain will hide the Sun for a whole day, and the panels will make almost nothing. Mission planners know the Sun\'s path years ahead, so this is no surprise. Leave power cells on the Solar Rack the evening before.</p></div></div>';
    var care = r.care && !r.fail ? '<div class="info-row good"><span class="ic">🫧</span><div><b>Life support looked after</b><p>The air filter never filled up and the water tank never ran dry today.</p></div></div>' : '';
    var chal = r.day.goal ? '<div class="info-row' + (r.goalDone ? ' good' : '') + '"><span class="ic">🎯</span><div><b>Today\'s challenge: ' + (r.goalDone ? 'done!' : 'not finished') + '</b><p>' + esc(r.day.goal.text) + '</p></div></div>' : '';
    var decs = s.decisions.filter(function (d) { return d.sol === r.sol; });
    var dec = decs.length ? '<h3>🧭 Your big decision today</h3>' + decs.map(function (d) { return decisionHtml(d, !r.fail && !r.last); }).join('') : '';
    if (!r.fail && r.nextDay) {
      fc += '<h3>📈 Tomorrow: ' + esc(dw) + ' ' + (r.sol + 1) + ' · ' + r.nextDay.icon + ' ' + esc(r.nextDay.title) + '</h3>' +
        (r.harder.length ? '<ul class="harder">' + r.harder.map(function (h) { return '<li><span>' + h.icon + '</span>' + esc(h.text) + '</li>'; }).join('') + '</ul>' : '');
    }
    Au.play(r.fail ? 'bad' : 'night'); if (!r.fail) Au.music('night');
    U.modal('<h2>🌙 Night report · ' + dw + ' ' + r.sol + '</h2><p class="sub">Here is how the day added up.</p>' + rows + care + chal + colonyRow(r) + rep + dec + why + finds + fc + fact +
      '<div class="modal-actions"><button class="btn primary" data-act="next">' + (r.fail ? 'See what happened' : 'Next ' + dw.toLowerCase() + ' ▶') + '</button></div>',
      { speak: 'Night report. ' + r.fact.text, line: r.fail || Au.voicePlaying() ? null : 'night-report', actions: { holo: function (el) { Au.play('tap'); showHolo(el.getAttribute('data-v')); }, next: function () {
        Au.play('page'); U.closeModal();
        if (r.fail) { G.ending = { fail: r.fail }; startLaunchScene(); }
        else { sim.startSol(s); beginSol(); }
      } } });
  }

  // =====================================================================
  //  THE ROCKET
  // =====================================================================
  function boardModal() {
    var s = G.s;
    U.modal('<div class="big-icon">🚀</div><h2>Ready to fly home?</h2><p>' + (s.caseLoaded ? 'The sample case is on board.' : 'The sample case is NOT on board yet. Scientists on Earth are waiting for those rocks.') +
      ' Anything left undone stays undone!</p><div class="modal-actions"><button class="btn ghost" data-act="no">Not yet</button><button class="btn primary" data-act="yes">Launch! 🚀</button></div>',
      { actions: { no: function () { Au.play('tap'); U.closeModal(); }, yes: function () { Au.play('tap'); U.closeModal(); launchHome(); } } });
  }
  // The crew lifts off now. The mission is judged at this moment (the crew is aboard, so the rest of the day does not
  // pass at the outpost). It can still be lost: a late dash to the rocket costs air, and a fail the rules report counts.
  function launchHome(text, vid, late) {
    var s = G.s;
    if (G.mode === 'launch') return;
    var rep = sim.endSol(s, { launch: true, late: !!late });
    if (rep.fail) {
      G.ending = { fail: rep.fail };
      startLaunchScene(rep.fail === 'air' ? 'The air tanks are empty! Everyone to the rocket!' : 'The radiation badges are full! Everyone to the rocket!',
        rep.fail === 'air' ? 'hud-air-empty' : 'hud-rad-full');
      return;
    }
    sim.finish(s);
    G.ending = { win: true };
    startLaunchScene(text, vid);
  }
  function failNow(reason) {
    var s = G.s;
    s.over = { type: 'fail', reason: reason };
    U.closeModal(); G.crisisOpen = false;
    G.ending = { fail: reason };
    startLaunchScene(reason === 'air' ? 'The air tanks are empty! Everyone to the rocket!' : 'The radiation badges are full! Everyone to the rocket!', reason === 'air' ? 'hud-air-empty' : 'hud-rad-full');
  }
  // text, vid: Mission Control's last words before the countdown, when there are any
  function startLaunchScene(text, vid) {
    if (G.room) leaveRoom(true);
    G.mode = 'launch'; G.launchT = 0; G.launchN = -1; G.mini = null; G.charge = null; hideAim(); Au.stopAll(); Au.music(null); G.sayQ.length = 0;
    if (A.rover.driver) A.exitRover();
    A.astro.mode = 'hidden';
    ['goals', 'prompt', 'hands', 'rover-hud', 'mini', 'inside'].forEach(function (id) { U.show($(id), false); });
    touchUi(false);
    U.tags([]); U.marks([]); U.stormFx(''); U.clearCards(); U.fade(false);
    W.env.storm = 0;
    var p = B.rocketPos(v1);
    W.cam.mode = 'fixed';
    W.cam.fixed = { pos: new T.Vector3(p.x + 34, Tn.height(p.x + 34, p.z + 30) + 4, p.z + 30), look: p.clone() };
    U.banner(null);
    if (text) { U.say(text, vid, false, radioFrom(vid)); if (Au.voicePlaying()) G.launchT = -3.6; }      // when the line is spoken, the countdown waits for it
  }
  function stepLaunch(dt) {
    var t0 = G.launchT, t = G.launchT += dt;
    if (t <= 0) return;
    if (t0 <= 0) { B.startLaunch(); Au.play('launch'); fxPulse('flash', 0.5); fxPulse('shock', 0.6); }
    B.rocketPos(W.cam.fixed.look);
    U.banner(t < 0.8 ? '3…' : t < 1.6 ? '2…' : t < 2.4 ? '1…' : t < 6 ? '🚀 LIFTOFF!' : null, 'safe');
    var n = t < 0.8 ? 0 : t < 1.6 ? 1 : t < 2.4 ? 2 : 3;
    if (n !== G.launchN) { G.launchN = n; Au.line(['launch-3', 'launch-2', 'launch-1', 'launch-liftoff'][n], { plain: true }); }   // Mission Control counts with the banner
    if (t > 9.5 && G.ending) {
      var e = G.ending; G.ending = null; G.mode = 'end';
      U.fade(true);
      // A win goes straight from the launch to the future of the outpost (js/colony.js), and the results follow it.
      // Without the colony add-on, or after a failed mission, the results come at once.
      setTimeout(function () { if (!e.win) failModal(e.fail); else if (JA.colony) playVision(true); else winModal(); }, 700);
    }
  }

  function learned(s) {
    var out = [];
    out.push('Power is limited: every cell you carried to one machine was a cell another machine did not get.');
    if (s.site.id === 'mars') out.push('Mars is so far away that Earth cannot help quickly. Crews there must often decide for themselves.');
    else out.push('The Moon has no air to block solar storms, so thick soil shielding really matters.');
    out.push(s.stats.storms ? 'You lived through ' + s.stats.storms + ' solar storm' + (s.stats.storms > 1 ? 's' : '') + ' that really happened on the Sun.' : 'The real Sun stayed calm for your mission. Astronauts get lucky sometimes too!');
    out.push('Ice is treasure: with electricity it becomes oxygen to breathe, and water for plants.');
    if (s.stats.bestThrow > 7) out.push('Your longest throw flew ' + Math.round(s.stats.bestThrow) + ' m. On Earth the same throw would only go about ' + Math.max(1, Math.round(s.stats.bestThrow * s.site.gravity / 9.81)) + ' m.');
    for (var i = 1; i <= Math.min(s.sol, s.totalSols - 1); i++) { var di = sim.dayInfo(s, i); out.push(dayWord() + ' ' + i + ', ' + di.topic.toLowerCase() + ': ' + di.learn.split('. ')[0] + '.'); }
    if (s.decisions.length) out.push('Some problems have no checklist. You made ' + s.decisions.length + ' big decision' + (s.decisions.length > 1 ? 's' : '') + ' on your own, and saw what each one led to.');
    if (s.stats.baked) out.push('The crew\'s own breath fills the air filter with carbon dioxide. You baked it clean ' + s.stats.baked + ' time' + (s.stats.baked > 1 ? 's' : '') + ', and each time cost a power cell that another machine did not get.');
    if (s.bags > R.bagsFreeShade) out.push('Nothing is free: soil that blocks radiation blocks sunlight too. Your ' + s.bags + ' bags gave a ' + Math.round(sim.shield(s) * 100) + '% shield and cost ' + Math.round(sim.shade(s) * 100) + '% of your solar power.');
    out.push('Water goes round and round: the recycler gave back most of what the crew drank, and only ice added more.');
    return '<ul class="learned">' + out.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  }
  function decisionsBlock(s) {
    return s.decisions.length ? '<h3>🧭 Your big decisions (' + s.decisions.length + ')</h3>' + s.decisions.map(function (d) { return decisionHtml(d, false); }).join('') : '';
  }
  function endButtons(win) {
    return '<div class="modal-actions">' + (win && JA.colony ? '<button class="btn ghost" data-act="future">🔭 See the future again</button>' : '') + (win && JA.keepsake ? '<button class="btn ghost" data-act="cert">🎓 Certificate</button>' : '') +
      (JA.sunwatch ? '<button class="btn ghost" data-act="sun">☀️ Sun Watch</button>' : '') + (JA.journal ? '<button class="btn ghost" data-act="journal">📓 Field Journal</button>' : '') + '<button class="btn ghost" data-act="science">📚 The real science</button><button class="btn ghost" data-act="change">Change mission</button><button class="btn primary" data-act="again">Play again ▶</button></div>';
  }
  function endActions() {
    return { science: function () { Au.play('tap'); scienceInfo(); },
      journal: function () { openJournal(); },
      cert: function () { Au.play('tap'); ext('keepsake', 'openCertificate', certificateInfo()); },
      future: function () { Au.play('tap'); U.closeModal(); playVision(); },
      sun: function () { Au.play('tap'); ext('sunwatch', 'open', G.s, G.weather); },
      change: function () { Au.play('tap'); U.closeModal(); titleScene(); U.show($('title'), false); setupModal(); },
      again: function () { U.fade(false); launch(); } };
  }
  // The outpost decades from now: a flyover made by js/colony.js. Then the results.
  // It plays by itself right after a winning launch (first = true), and again from the button on the results.
  function playVision(first) {
    var s = G.s;
    hideHud(); U.fade(false); G.mode = 'vision';
    if (first) Au.music('title');      // the theme carries the crew's flight home into the future
    var ok = ext('colony', 'vision', s, function () {
      if (G.mode !== 'vision') return;
      G.mode = 'end'; W.cam.mode = 'title'; winModal();
    });
    if (!ok) { G.mode = 'end'; winModal(); }
  }
  // after the jingle: the last recorded line, then the theme
  function endSound(vid) {
    setTimeout(function () { if (G.mode === 'end' && !Au.readingOn()) Au.line(vid); }, 1700);
    setTimeout(function () { if (G.mode === 'end') Au.music('title'); }, 3600);
  }
  // How the Field Journal grew on this mission.
  function journalLine() {
    if (!JA.journal || !G.s) return '';
    var c = JA.journal.count(G.s.site.id);
    return '<p class="sub">📓 Field Journal: ' + (G.pages ? '<b>' + G.pages + ' new page' + (G.pages > 1 ? 's' : '') + '</b> on this mission · ' : '') + c.have + ' of ' + c.total + ' found on ' + esc(G.s.site.name) + '. ' + (c.have < c.total ? 'The empty pages say where to look next time.' : 'Every single one!') + '</p>';
  }
  function winModal() {
    var s = G.s, rank = sim.rankFor(s), badges = sim.badges(s);
    s.finds.forEach(journalFind);
    if (G.pages >= 12) badges.push({ icon: '📓', name: 'Field Scientist', text: 'Added ' + G.pages + ' new pages to the Field Journal' });
    hideHud(); Au.play('win'); endSound('win-home');
    var finds = s.finds.length ? '<h3>🔬 Your discoveries (' + s.finds.length + ')</h3>' + s.finds.map(U.findRow).join('') : '';
    U.modal('<div class="rank"><span class="big-icon">' + rank.icon + '</span><h2>' + esc(rank.name) + '</h2>' +
      '<p>Mission complete! The crew is on the way home after ' + s.totalSols + ' ' + dayWord().toLowerCase() + 's on ' + esc(s.site.name) + '.</p>' +
      '<p class="sub">' + (s.caseLoaded ? 'The rock samples are on their way to Earth. ' : '') + esc(rank.line) + '</p></div>' +
      (badges.length ? '<div class="badges">' + badges.map(function (b) { return '<div class="badge"><em>' + b.icon + '</em><div><b>' + esc(b.name) + '</b><span>' + esc(b.text) + '</span></div></div>'; }).join('') + '</div>' : '') +
      journalLine() + '<h3>What you just practised</h3>' + learned(s) + decisionsBlock(s) + finds + endButtons(true),
      { cls: 'wide', actions: endActions(), speak: 'Mission complete! You are a ' + rank.name + '. ' + rank.line });
  }
  function failModal(reason) {
    var s = G.s, f = JA.FAIL[reason];
    s.finds.forEach(journalFind);
    hideHud(); Au.play('lose'); endSound('fail-safe');
    U.modal('<div class="rank"><span class="big-icon">' + f.icon + '</span><h2>' + esc(f.title) + '</h2></div>' +
      '<p>' + esc(f.text) + ' You made it to ' + dayWord().toLowerCase() + ' ' + s.sol + ' of ' + s.totalSols + '.</p>' +
      '<div class="fact"><b>💡 Mission Control\'s tip</b><p>' + esc(f.tip) + '</p><small>Real astronauts practise in simulators for years — and they fail there a lot. That is how they learn.</small></div>' +
      journalLine() + decisionsBlock(s) +
      (s.finds.length ? '<h3>🔬 Your discoveries (' + s.finds.length + ')</h3>' + s.finds.map(U.findRow).join('') : '') + endButtons(),
      { cls: s.decisions.length ? 'wide' : '', actions: endActions(), speak: f.title + '. ' + f.text + ' ' + f.tip });
  }

  // =====================================================================
  //  INFO CARDS
  // =====================================================================
  function howInfo() {
    var keys = touch
      ? '<div class="keys"><span>🕹️</span><div>Left stick: walk (push all the way to run) · drive the rover</div><span>⏸</span><div>Pause · change how long a day lasts</div><span>👆</span><div>Drag anywhere to look around</div><span>✋</span><div>Use, pick up, plug in, drill (hold)</div><span>🎯</span><div>Hold to aim a throw, let go to throw</div><span>⤴</span><div>Jump</div><span>👁</span><div>Helmet view: see through your own visor</div><span>💡</span><div>Tap a meter, a blue card or the round radio badge: your wrist tablet projects a hologram that shows why</div><span>📓</span><div>Field Journal: every piece of science you have found</div></div>'
      : '<div class="keys"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><div>Walk · drive the rover (arrow keys work too)</div><span><kbd>Mouse</kbd></span><div>Drag to look around · wheel to zoom</div><span><kbd>E</kbd></span><div>Use, pick up, plug in, drill (hold)</div><span><kbd>F</kbd></span><div>Hold to aim a throw, let go to throw</div><span><kbd>Space</kbd></span><div>Jump</div><span><kbd>Shift</kbd></span><div>Run (uses more air)</div><span><kbd>Q</kbd></span><div>Put down what you are holding</div><span><kbd>V</kbd></span><div>Helmet view: see through your own visor (A and D turn you)</div><span><kbd>C</kbd></span><div>Save a postcard picture</div><span><kbd>L</kbd></span><div>Camera filter: see like a real space camera</div><span><kbd>X</kbd></span><div>Camera effects: full, lite or off</div><span><kbd>T</kbd></span><div>Wrist tablet: a hologram that shows why, about what just happened or the machine next to you</div><span><kbd>J</kbd></span><div>Field Journal: every piece of science you have found</div><span><kbd>M</kbd></span><div>Mini map: the buildings, your jobs and where you are</div><span><kbd>N</kbd></span><div>Music on or off</div></div>';
    openInfo('<h2>How to play</h2>' + keys +
      '<div class="info-row"><span class="ic">🔋</span><div><b>Power cells</b><p>The Solar Rack charges a few cells each day. Carry or throw each one into a machine\'s socket: Air Maker, Greenhouse, Soil Bagger, Lab, Radio Dish or Rover.</p></div></div>' +
      '<div class="info-row"><span class="ic">🧊</span><div><b>Ice = air and water</b><p>Start the ice drills at the far crater: each one digs out a chunk by itself while you start the next. Drop it in the Air Maker to make oxygen, or in the Greenhouse tank to water the plants. The rover bed carries four things.</p></div></div>' +
      '<div class="info-row"><span class="ic">🫧</span><div><b>Life support: the filter and the water</b><p>The crew\'s breath slowly fills the CO₂ filter. A power cell at the Air Scrubber, beside the airlock, bakes it clean. One water tank serves the crew and the plants: the recycler gives back most of what the crew drinks, plants keep theirs, and only ice adds more.</p></div></div>' +
      '<div class="info-row"><span class="ic">🥔</span><div><b>Two crops</b><p>Lettuce is ready in under a day but fills little. Potatoes take almost two days and fill a lot. At an empty bed, ' + (touch ? 'the 🎯 button' : 'Q') + ' swaps the seeds in your pocket.</p></div></div>' +
      '<div class="info-row"><span class="ic">💡</span><div><b>Why did that happen?</b><p>When something goes right or wrong, a blue card says why. ' + (touch ? 'Tap it, or tap the round radio badge,' : 'Press T, or tap it,') + ' and the tablet on your wrist projects a hologram that shows how it works. Everything you find is kept in the 📓 Field Journal.</p></div></div>' +
      '<div class="info-row"><span class="ic">🚙</span><div><b>The rover</b><p>It carries four things in its bed: stand beside the bed to take one out. Drive carefully! A fast crash throws the cargo out and shakes charge out of the battery.</p></div></div>' +
      '<div class="info-row"><span class="ic">🏘️</span><div><b>The town</b><p>Keep the outpost looking after itself and ships come from Earth: first supplies, then settlers, in the end a city. The people share your air, and a town in good spirits brings you ice, water and power.</p></div></div>' +
      (JA.pioneer ? '<div class="info-row"><span class="ic">⛏️</span><div><b>Pioneer mode</b><p>A hard mode you pick before launch. Supplies are short, but you can break rocks into rubble, metal and glass sand and build with them' + (touch ? '' : ' (key B)') + ': solar panels, a battery bank, a water cistern, brick walls, an ice rig and more.</p></div></div>' : '') +
      '<div class="info-row"><span class="ic">🛡️</span><div><b>Shield and storms</b><p>Throw soil bags onto the dome to block radiation. The solar storms are real ones from NASA records — when the alarm sounds, get inside!</p></div></div>' +
      '<div class="info-row"><span class="ic">🧪</span><div><b>Science</b><p>Drill rock cores at the glowing orange sites and study them in the Lab. Carry the instruments from the rocket pad to the blue rings. On the last day, load the sample case and board the rocket.</p></div></div>' +
      '<div class="info-row"><span class="ic">☄️</span><div><b>Rocks from the sky</b><p>Now and then a meteorite lands near the outpost. Find the fresh crater and pick up the space rock. A quake sensor pinpoints it for you.</p></div></div>' +
      '<div class="info-row"><span class="ic">📈</span><div><b>Every day is harder</b><p>Each morning brings one new thing to learn, a challenge to try, and an outpost that is a little more worn than yesterday.</p></div></div>' +
      '<div class="info-row"><span class="ic">🧭</span><div><b>Crisis moments</b><p>Sometimes something goes wrong that has no checklist, and Earth cannot help in time. You pick one of several actions, and you find out later what it led to.</p></div></div>' +
      '<div class="info-row"><span class="ic">⏸</span><div><b>Your time</b><p>Press ⏸ (or ' + (touch ? 'tap it' : 'the P key') + ') to pause, and to make the working day longer or shorter whenever you like.</p></div></div>');
  }
  function scienceInfo() {
    var s = G.s, mission = '';
    if (s && s.weather.length) mission = '<p><b>This mission:</b> ' + (s.weatherSource === 'live' ? 'live data' : 'archived data' + (s.weatherFallback ? ' (NASA could not be reached, so this is not live)' : '')) + ', real dates ' + JA.weather.prettyDate(s.weather[0].date) + ' to ' + JA.weather.prettyDate(s.weather[s.weather.length - 1].date) + '.</p>';
    var links = Object.keys(JA.SOURCES).map(function (k) { var x = JA.SOURCES[k]; return '<li><a href="' + x.url + '" target="_blank" rel="noopener">' + esc(x.name) + '</a></li>'; }).join('');
    openInfo('<h2>The real science</h2><p class="sub">For curious kids, parents, teachers and judges.</p>' +
      '<h3>Real data inside the game</h3><ul class="src-list">' +
      '<li><b>Space weather — NASA DONKI.</b> Every storm is a real event from NASA\'s Space Weather Database of Notifications, Knowledge, Information: solar flares (the flash), coronal mass ejections (CMEs, clouds of solar gas) and solar energetic particle events (SEPs, the radiation). “Live” mode downloads the last 30 days when the mission starts. “May 2024” mode uses records saved inside the game (22 April – 31 May 2024) and is labelled as an archive. Each mission day replays one real calendar day.</li>' +
      '<li><b>What reaches you.</b> On the Moon, a storm is a particle event that NASA\'s satellites really measured near Earth (GOES above 100 MeV = big, above 10 MeV = medium), or a CME shock arriving (small). On Mars, no particle detector reports to DONKI, so the game checks every fast CME against the real positions of Earth and Mars on that date: how well was Mars linked by the Sun\'s spiral magnetic field to where it erupted? This simple rule picks out the 20 May 2024 far-side storm that NASA\'s Curiosity rover measured. CME arrivals at Mars come from NASA\'s WSA-ENLIL model. A flare alone never makes a storm.</li>' +
      '<li><b>Gravity.</b> Jumps, throws and the rover use the real surface gravity: 1.62 m/s² on the Moon, 3.71 m/s² on Mars. The dotted throwing arc is the real parabola.</li>' +
      '<li><b>Everyday radiation.</b> Mars: about 0.67 mSv per day (RAD instrument on NASA\'s Curiosity rover). Moon: about 1.4 mSv per day (LND instrument, Zhang et al. 2020). The Moon value is about twice the Mars value, and the game keeps that ratio.</li>' +
      '<li><b>Radio delay.</b> Moon: 1.3 seconds. Mars: worked out from where Earth and Mars were on the mission\'s real dates (an estimate, good to a few percent).</li>' +
      '<li><b>Discoveries and facts</b> describe real findings from NASA missions (Apollo, LCROSS, LRO, Curiosity, Opportunity, Phoenix, InSight, Perseverance) and NASA\'s Open Science Data Repository.</li></ul>' + mission +
      '<h3>What is simplified</h3><ul class="src-list">' +
      '<li>Time is squeezed: a working day lasts a few minutes (you choose how many), plants grow in a day, and a 20-minute radio wait becomes about half a minute.</li>' +
      '<li>Mission Control talks to you live over the radio. On the Moon that is close to real: a message takes 1.3 seconds, like a phone call with a tiny pause. From Mars every message takes minutes, so real Mars crews will mostly hear recorded messages from Earth and solve problems on their own.</li>' +
      '<li>Each day is made a little harder than the one before (more air and food used, a little less power, tools that wear). Real outposts do wear down, but these amounts are game numbers.</li>' +
      '<li>The crisis moments are invented for your outpost, but each one is modelled on something that really happened: the 2018 Space Station air leak, Apollo 13\'s air filter and power-down, the mould in the Station\'s garden in 2015, and the Spirit rover stuck in soft soil in 2009.</li>' +
      '<li>The radiation badge (0–100%) is a game scale, not a medical dose. How many badge points a storm of each size costs is a game number. The timing is squeezed: the warning and the storm last seconds here, minutes to hours in real life.</li>' +
      '<li>Dust storms (Mars) and shadow days (Moon) are simulated, inspired by the 2018 global dust storm and the low Sun at the lunar south pole.</li>' +
      '<li>The rock sites are invented places. Each discovery describes what a real mission found somewhere on the Moon or Mars, not at this exact spot.</li>' +
      '<li>The meteorite strikes are invented events. The facts on their cards are real: the InSight lander felt a real strike on Mars in 2021, and NASA\'s Lunar Reconnaissance Orbiter has found new craters on the Moon.</li>' +
      '<li>The picture is styled like a film camera (glow, lens flare, grain). The sparkles and streaks during a solar storm copy what charged particles really do to camera sensors in space. The Heat view filter is pretend: it colours the picture by brightness, not by real temperature.</li>' +
      '<li>Life support is squeezed too. Real air scrubbers and water recyclers run all the time on a station\'s own power; here one power cell bakes the CO₂ filter clean, so that you feel what it costs. The Space Station gets back about 98% of its water. The game uses 90%, wearing down a little each day.</li>' +
      '<li>Crops: real lettuce takes about a month and potatoes three or more. The game keeps only the trade-off: leaves are fast and small, tubers are slow and big and use less water for each bite.</li>' +
      '<li>Soil bags that cover the skylights and cost solar power stand for a real design problem: shielding always costs something somewhere else (weight, light, room). The 1.5% for each bag is a game number.</li>' +
      '<li>Wear is real, the numbers are not: an overheated drill bit that heats faster, a battery that holds less after being run flat, and solar cells that lose a little power after a strong solar storm.</li>' +
      '<li>The long dark (the Moon, on longer missions) is one simulated day with almost no Sun. Real south-pole crater rims are sunlit most of the year, but not all of it.</li>' +
      '<li>Running uses one and a half times the air: a game number for a real effect.</li>' +
      '<li>Rover crashes: it is true that low gravity makes a rover lighter but no easier to stop. The lost battery charge and the flying cargo are game rules.</li>' +
      '<li>The ice drills are simplified: one press, a few seconds, one clean chunk. Real ice there is mixed into the soil, and no one has mined it yet.</li>' +
      '<li>The town is imagined, built on real ideas. Its people, the air they share and the "town spirit" meter are game rules, not predictions.</li>' +
      '<li>Pioneer mode: making bricks, metal and glass from local soil is real research ("in-situ resource use"). Getting them by breaking a rock with a hammer, and every cost and benefit, are game rules.</li>' +
      '<li>Power cells, air and food are game units, tuned so that no choice is free.</li>' +
      '<li>Radiation is invisible. The pink glow is your suit\'s “sensor view” so you can tell a storm is happening.</li></ul>' +
      '<h3>Sources</h3><ul class="src-list">' + links + '</ul>');
  }

  // =====================================================================
  //  GOALS, WAYPOINTS, TAGS
  // =====================================================================
  function goalsFor(s) {
    var g = [], a = A.astro, c = a.carrying, sp = B.spots, m = s.m, L = s.level, last = s.sol >= s.totalSols, left = Math.max(0, 1 - s.t / s.dayLength);
    function has(type) { return c && c.type === type; }
    function add(text, done, target, icon, optional) { g.push({ text: text, done: !!done, target: target || null, icon: icon, optional: optional }); }
    var roverIce = A.rover.bed.some(function (it) { return it && it.type === 'ice'; });
    var rackOrCell = has('cell') ? null : sp.rack;
    var airT = has('ice') || roverIce ? sp.hoppers.air : has('cell') ? sp.sockets.air : (m.air.power === 0 && m.air.queue > 0 ? sp.rack : sp.ice[0]);
    if (s.sol === 1) {
      add(touch ? 'Walk with the stick, drag to look, and try a jump' : 'Walk (W A S D), drag the mouse to look, jump (Space)', G.tut.moved, null, '👟');
      add('Carry a power cell from the Solar Rack to the Air Maker', G.tut.airCell, has('cell') ? sp.sockets.air : sp.rack, '🔋');
      add('Fetch ice from the ' + s.site.iceName + ' for the Air Maker (the rover is faster!)', G.tut.ice, airT, '🧊');
      add('Greenhouse: a power cell, ice for water, then plant seeds', G.tut.grow, has('cell') ? sp.sockets.food : has('ice') ? sp.hoppers.water : sp.beds[1], '🥬');
    } else {
      var dinner = sim.dinner(s);
      add('Air for today: feed the Air Maker ice and power', s.air >= (sim.airDrain(s) * sim.stale(s) + s.leak) * left + 3, airT, '💨');
      if (!last) {
        var ripe = -1; m.food.beds.forEach(function (b, i) { if (b.state === 'ripe' && ripe < 0) ripe = i; });
        add('Dinner tonight needs ' + dinner + ' food', s.food >= dinner, has('crate') ? sp.hoppers.pantry : ripe >= 0 ? sp.beds[ripe] : sp.beds[1], '🥬');
      }
    }
    // life support only joins the list when it needs you (on the first day, once the lesson is done)
    if (s.sol > 1 || G.tutStep >= 4) {
      if (s.filter < R.filterWarn && sp.sockets.scrub) add('Bake the CO₂ filter: a power cell for the Air Scrubber', false, has('cell') ? sp.sockets.scrub : sp.rack, '🫧');
      if (s.water < R.waterWarn && m.food.beds.some(function (b) { return b.state === 'growing'; })) add('Water for the plants: ice for the Greenhouse tank', false, has('ice') || roverIce ? sp.hoppers.water : sp.ice[0], '💧');
    }
    if (s.day.goal) add('Challenge: ' + s.day.goal.text + sim.dayGoalProgress(s), s.today.goalDone, null, '🎯', true);
    var trayBag = A.items.filter(function (it) { return it.tag === 'tray'; })[0];
    add('Shield: throw soil bags onto the dome (' + s.bags + '/' + R.shieldSlots + ')', s.bags >= R.shieldSlots, has('bag') ? sp.hoppers.dome : trayBag ? trayBag.pos : has('cell') ? sp.sockets.bag : rackOrCell, '🛡️', true);
    var studied = s.finds.filter(function (f) { return f.kind === 'core'; }).length, geoT = null, bd = 1e9;
    sp.drill.forEach(function (p, i) { if (sim.coresLeft(s, i) > 0) { var d = d2(me(), p); if (d < bd) { bd = d; geoT = p; } } });
    var coreOnMe = has('core') || A.rover.bed.some(function (it) { return it && it.type === 'core'; });
    add('Science: drill rock cores and study them in the Lab (' + studied + '/8)', studied >= 8, coreOnMe ? sp.hoppers.lab : (m.lab.queue.length && m.lab.power === 0 ? (has('cell') ? sp.sockets.lab : sp.rack) : geoT), '🧪', true);
    var ni = Object.keys(sp.inst).filter(function (id) { return s.inst[id]; }).length;
    var instItem = A.items.filter(function (it) { return it.type === 'inst' && it.state !== 'held'; })[0];
    add('Set up the science instruments (' + ni + '/3)', ni >= 3, has('inst') ? sp.inst[c.data.id] : instItem ? instItem.pos : null, '📦', true);
    if (!s.lookout && JA.observe && s.sol >= 2) add('Optional: sit on the lookout rock and watch the sky', false, v2.set(Tn.L.seat[0], Tn.height(Tn.L.seat[0], Tn.L.seat[1]) + 1.2, Tn.L.seat[1]).clone(), '🌄', true);
    if (G.colonyVisit) add('Visit the new settlement: people from Earth!', false, v2.set(Tn.L.colony[0], Tn.height(Tn.L.colony[0], Tn.L.colony[1]), Tn.L.colony[1]).clone(), '🏘️', true);
    var rock = ext('sky', 'goal', s, v3);
    if (rock) add(rock.text, false, rock.target ? rock.target.clone() : null, '☄️', true);
    if (last) {
      add('Load the sample case into the rocket', s.caseLoaded, has('case') ? sp.hoppers.cargo : G.caseItem ? G.caseItem.pos : null, '🧳');
      add('Board the rocket before the shift ends', false, sp.rocketDoor, '🚀');
    } else add('Be inside before the shift ends', false, left < 0.2 ? sp.door : null, '🏠');
    // which one is "now": on day 1 the lesson steps come first; later, survival first, then whatever you are carrying for
    var now = -1, i;
    for (i = 0; i < g.length; i++) if (!g[i].done && !g[i].optional && (g[i].target || g[i].icon === '👟')) { now = i; break; }
    if (c) for (i = 0; i < g.length; i++) if (!g[i].done && g[i].target && ((c.type === 'bag' && g[i].icon === '🛡️') || (c.type === 'core' && g[i].icon === '🧪') || (c.type === 'inst' && g[i].icon === '📦') || (c.type === 'case' && g[i].icon === '🧳') || (c.type === 'crate' && g[i].icon === '🥬'))) { now = i; break; }
    if (now < 0 || (g[now].icon === '🏠' || g[now].icon === '🚀') && left > 0.25) for (i = 0; i < g.length; i++) if (!g[i].done && g[i].optional && g[i].target) { now = i; break; }
    if (now >= 0) g[now].now = true;
    return { list: g, now: now >= 0 ? g[now] : null };
  }
  var TUT_LINES = [null,
    'Power cells charge on the Solar Rack. Walk up to one and grab it, then carry it to the Air Maker\'s socket.',
    'Now the Air Maker needs ice to turn into oxygen. The ice is far away — plug a cell into the back of the rover and drive there!',
    'Next: food. The Greenhouse needs light from a power cell, water from ice, and seeds in the beds.',
    'You have got the basics! Now you choose: soil bags for the shield, rock cores for science, or the instruments by the rocket. There is not enough power for everything!'];
  var TUT_VOX = [null, 'rack-intro', 'air-intro', 'food-intro', 'act-basics-done'];
  function tutorialTalk() {
    var t = G.tut, step = !t.moved ? 0 : !t.airCell ? 1 : !t.ice ? 2 : !t.grow ? 3 : 4;
    if (step > G.tutStep) { G.tutStep = step; if (TUT_LINES[step]) { say(TUT_LINES[step], true, TUT_VOX[step]); Au.play('good'); } }
  }

  function placeMark(list, pos, icon, label, cls, color) {
    var p = W.project(pos), cx = W.w / 2, cy = W.h / 2, x = p.x, y = p.y - 26, mx = 44, top = 150, bot = 130;
    var dx = x - cx, dy = y - cy;
    if (p.hidden) { dx = -dx; dy = -dy; if (Math.abs(dy) < 40) dy = 200; }
    var off = p.hidden || x < mx || x > W.w - mx || y < top || y > W.h - bot;
    if (off) {
      var sx = dx === 0 ? 1e9 : (dx > 0 ? (W.w - mx - cx) : (cx - mx)) / Math.abs(dx);
      var sy = dy === 0 ? 1e9 : (dy > 0 ? (W.h - bot - cy) : (cy - top)) / Math.abs(dy);
      var k = Math.min(sx, sy); if (p.hidden) k = Math.min(sx, sy);
      x = cx + dx * k; y = cy + dy * k;
    }
    list.push({ x: x, y: y, icon: icon, label: label, cls: cls, color: color });
  }
  // ---------- the mini map (M or the 🗺️ button) ----------
  // Open only while you are out on the surface; what it draws comes from here each frame.
  function toggleMap(on) {
    G.mapOpen = on === undefined ? !G.mapOpen : !!on;
    try { localStorage.setItem('ja-map-open', G.mapOpen ? '1' : '0'); } catch (e) { /* private mode */ }
    var b = $('btn-map');
    if (b) { b.classList.toggle('on', G.mapOpen); b.setAttribute('aria-pressed', String(G.mapOpen)); b.title = G.mapOpen ? 'Hide the map (M)' : 'Map (M)'; }
  }
  var MAP_BUILD = ['hab', 'scrub', 'rack', 'air', 'food', 'bag', 'lab', 'comms', 'rocket'];
  function mapFrame() {
    if (!JA.minimap) return;
    var on = !!(G.mapOpen && G.s && G.mode === 'play' && !G.room);
    JA.minimap.show(on);
    if (!on) return;
    var s = G.s, sp = B.spots, drive = A.rover.driver, i;
    W.forward(v1);
    var goals = [], spots = [];
    (G.goalList || []).forEach(function (gl) { if (!gl.done && gl.target) goals.push({ x: gl.target.x, z: gl.target.z, icon: gl.icon, now: !!gl.now }); });
    for (i = 0; i < sp.drill.length; i++) if (sim.coresLeft(s, i) > 0) spots.push({ x: sp.drill[i].x, z: sp.drill[i].z, icon: JA.GEO[s.site.id][i].icon, color: '#ffb84d' });
    Object.keys(sp.inst).forEach(function (id) { if (!s.inst[id]) spots.push({ x: sp.inst[id].x, z: sp.inst[id].z, icon: '📍', color: '#5cf0ff' }); });
    for (i = 0; i < sp.photo.length; i++) if (!s.photos[i]) spots.push({ x: sp.photo[i].x, z: sp.photo[i].z, icon: '📸', color: '#ffd23f' });
    var rk = B.P && B.P.rocket && B.P.rocket.base;
    JA.minimap.draw({
      me: me(), yaw: drive ? A.rover.yaw : A.astro.yaw, fx: v1.x, fz: v1.z, t: G.clock,
      buildings: MAP_BUILD.filter(function (k) { return B.pos[k]; }).map(function (k) { return { key: k, x: B.pos[k].x, z: B.pos[k].z }; }),
      goals: goals, spots: spots, rover: drive ? null : A.rover.pos,
      ice: { x: Tn.L.ice[0], z: Tn.L.ice[1], r: Tn.iceR }, pad: rk ? { x: rk.x, z: rk.z, r: 12 } : null,
      craters: Tn.craters, playR: Tn.PLAY_R
    });
  }
  function hudFrame() {
    mapFrame();
    var s = G.s, a = A.astro, sp = B.spots, pos = me(), i;
    var live = Au.voicePlaying();       // the radio waves pulse while Mission Control is talking
    if (live !== G.radioLive) { G.radioLive = live; $('radio').classList.toggle('live', live); }
    if (!s || G.mode === 'title' || G.mode === 'brief' || G.mode === 'end' || G.mode === 'night' || G.mode === 'intro' || G.mode === 'vision') return;
    U.setHud(s);
    if (G.mode !== 'play' && G.mode !== 'inside') { U.tags([]); U.marks([]); U.prompt(null); return; }
    // prompt + hands
    var keyLabel = touch ? '✋' : 'E';
    if (G.mini || G.charge) U.prompt(null);
    else if (G.action) U.prompt(G.action.label + (G.action.alt ? '  ·  ' + (touch ? '🎯' : 'Q') + ': ' + G.action.altLabel : ''), keyLabel, !G.action.run);
    else U.prompt(null);
    if (a.carrying && !A.rover.driver && G.mode === 'play') U.hands(a.carrying, G.charge ? G.charge.power : 0, G.charge ? 'Let go to throw!' : touch ? 'Hold 🎯 to aim a throw' : 'Hold F to aim a throw · Q puts it down');
    else U.hands(null);
    U.roverHud(s.m.rover.charge, A.rover.driver && G.mode === 'play', sim.roverCap(s));
    // goals + Mission Control
    if (G.clock > G.goalAt) {
      G.goalAt = G.clock + 0.3;
      document.documentElement.style.setProperty('--hud-b', Math.round($('hud').getBoundingClientRect().bottom) + 'px');   // lets the CSS stack things under the top bar
      var gl = goalsFor(s);
      G.goal = gl.now; G.goalList = gl.list;
      U.setGoals(s.sol === 1 ? 'First day' : s.sol >= s.totalSols ? 'Launch day' : 'Today', gl.list);
      if (s.sol === 1) { if (!G.tut.grow) checkGrow(); tutorialTalk(); }
      // Mission Control's advice now comes with its reason, and with a hologram when the tablet has one
      if (G.clock > G.hintAt && (s.sol > 1 || G.tutStep >= 4)) { G.hintAt = G.clock + 9; var h = sim.hintInfo(s); if (h) say(h.text + (h.why ? ' ' + h.why : ''), false, JA.voiceFor(h.text), false, h.topic); }
      if (G.colonyVisit && G.mode === 'play' && d2(pos, { x: Tn.L.colony[0], z: Tn.L.colony[1] }) < 30) { G.colonyVisit = 0; Au.play('discovery'); say('Welcome to the new settlement! People came all the way from Earth because your outpost could look after itself.', true); }
      if (G.mode === 'play' && !G.tips.pov && !G.pov && G.clock > (s.sol === 1 ? 80 : 15) && G.clock > G.sayAt + 4) tip('pov', touch ? 'Tap 👁 to look through your own visor!' : 'Press V to look through your own visor. Press V again to come back.');
    }
    if (G.mode !== 'play') { U.tags([]); U.marks([]); return; }
    // tags over machines
    var tags = [], m = s.m;
    function tag(p, text, cls) { if (d2(pos, p) > 62) return; var q = W.project(p); if (q.hidden || q.x < 40 || q.x > W.w - 40 || q.y < 110 || q.y > W.h - 60) return; tags.push({ x: q.x, y: q.y, text: text, cls: cls }); }
    var br = function (o) { return o.broken ? 'bad' : ''; };
    tag(B.pos.rack, '☀️ Solar Rack · ' + s.rack.cells + ' 🔋' + (s.rack.broken ? ' · BROKEN' : ''), br(s.rack) || (s.rack.cells >= sim.rackMax(s) ? 'warn' : ''));
    tag(B.pos.air, '💨 Air Maker · ⚡' + m.air.power + ' 🧊' + m.air.queue + (m.air.broken ? ' · BROKEN' : ''), br(m.air) || (m.air.power === 0 || m.air.queue === 0 ? 'warn' : ''));
    tag(B.pos.food, '🥬 Greenhouse · 💡' + (m.food.lamp > 0 ? 'on' : 'off') + ' 💧' + (s.water >= 1 ? Math.round(s.water) : 'dry') + (m.food.broken ? ' · BROKEN' : ''), br(m.food) || (s.water < R.waterWarn ? 'warn' : ''));
    tag(B.pos.bag, '🛡️ Soil Bagger' + (m.bag.pending ? ' · making ' + m.bag.pending : ''), '');
    tag(B.pos.lab, '🔬 Lab · ⚡' + m.lab.power + ' 🧪' + m.lab.queue.length + (m.lab.broken ? ' · BROKEN' : ''), br(m.lab) || (m.lab.queue.length && !m.lab.power ? 'warn' : ''));
    tag(B.pos.comms, '📡 Radio Dish · ' + (m.comms.on ? 'on' : 'off'), '');
    tag(B.pos.hab, '🏠 Shield ' + Math.round(sim.shield(s) * 100) + '% · ' + s.bags + '/' + R.shieldSlots + ' bags' + (sim.shade(s) > 0 ? ' · lamps −' + Math.round(sim.shade(s) * 100) + '% ☀️' : ''), '');
    if (B.pos.scrub) tag(B.pos.scrub, '🫧 Air Scrubber · filter ' + Math.round(s.filter) + '%', s.filter < R.filterWarn ? 'warn' : '');
    G.rigs.forEach(function (rig, k) { if (rig.state !== 'idle') { v2.copy(sp.ice[k]); v2.y += 2.8; tag(v2, rig.state === 'drill' ? '🧊 Drilling ' + Math.round(rig.p * 100) + '%' : '🧊 Cooling ' + Math.ceil(rig.t) + ' s', ''); } });
    if (!A.rover.driver) { v2.copy(A.rover.pos); v2.y += 5; tag(v2, '🚙 Rover · ' + Math.ceil(m.rover.charge) + ' s', m.rover.charge <= 0 ? 'warn' : ''); }
    if (s.sol >= s.totalSols) tag(B.pos.rocket, '🚀 Rocket' + (s.caseLoaded ? ' · samples on board' : ''), '');
    U.tags(tags);
    // waypoints
    var marks = [], ph = sim.stormPhase(s), alarm = ph === 'warning' || ph === 'active', gt = G.goal && G.goal.target;
    function far(p, min) { return d2(pos, p) > min && (!gt || d2(gt, p) > 5); }
    function label(p) { return Math.round(d2(pos, p)) + ' m'; }
    if (gt && d2(pos, gt) > 4) { v2.copy(gt); v2.y += 2.2; placeMark(marks, v2, G.goal.icon || '🎯', label(gt), 'goal', '#ffd23f'); }
    if (alarm || far(sp.door, 34)) { v2.copy(sp.door); v2.y += 6; placeMark(marks, v2, '🏠', label(sp.door), alarm ? 'alarm' : '', '#4dff9a'); }
    if (!A.rover.driver && far(A.rover.pos, 22)) { v2.copy(A.rover.pos); v2.y += 4; placeMark(marks, v2, '🚙', label(A.rover.pos), '', '#9fe8ff'); }
    v3.set(Tn.L.ice[0], Tn.height(Tn.L.ice[0], Tn.L.ice[1]) + 6, Tn.L.ice[1]);
    if (far(v3, 36)) placeMark(marks, v3, '🧊', label(v3), 'small', '#4fd8ff');
    for (i = 0; i < sp.drill.length; i++) if (sim.coresLeft(s, i) > 0 && far(sp.drill[i], 14)) { v2.copy(sp.drill[i]); v2.y += 4; placeMark(marks, v2, JA.GEO[s.site.id][i].icon, '', 'small', '#ffb84d'); }
    Object.keys(sp.inst).forEach(function (id) { if (!s.inst[id] && far(sp.inst[id], 14)) { v2.copy(sp.inst[id]); v2.y += 4; placeMark(marks, v2, '📍', '', 'small', '#5cf0ff'); } });
    for (i = 0; i < sp.photo.length; i++) if (!s.photos[i] && far(sp.photo[i], 14)) { v2.copy(sp.photo[i]); v2.y += 4; placeMark(marks, v2, '📸', '', 'small', '#ffd23f'); }
    var crater = ext('sky', 'marker', s, pos, v2);
    if (crater) placeMark(marks, crater, '☄️', label(crater), '', '#ffb347');
    U.marks(marks);
  }

  // =====================================================================
  //  INPUT + MAIN LOOP
  // =====================================================================
  var KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  function bind() {
    window.addEventListener('keydown', function (e) {
      if (holoOpen()) return;                    // the hologram has the keyboard while it plays
      if (e.code === 'Escape' && !$('settings-menu').classList.contains('hidden')) { settingsMenu(false); $('btn-settings').focus(); return; }
      if (U.modalOpen() || infoOpen()) {
        if (e.code === 'Escape' && infoOpen()) closeInfo();
        else if ((e.code === 'Escape' || e.code === 'KeyP') && !infoOpen() && !e.repeat && document.querySelector('#modal-root .modal.pause')) { Au.play('tap'); U.closeModal(); }
        return;
      }
      var k = KEYMAP[e.code];
      if (k) { G.keys[k] = true; e.preventDefault(); }
      if (e.code === 'Space') { if (!e.repeat) G.input.jump = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter') { if (!e.repeat) G.ePressed = true; G.eHeld = true; e.preventDefault(); }
      if (e.code === 'KeyF') { G.fHeld = true; e.preventDefault(); }
      if (e.code === 'KeyQ' && !e.repeat) G.qPressed = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') G.keys.shift = true;
      if (e.code === 'KeyH') { if (G.mode === 'play' || G.mode === 'inside') howInfo(); }
      if (e.code === 'KeyV' && !e.repeat && (G.mode === 'play' || G.mode === 'inside')) setPov(!G.pov);
      if (e.code === 'KeyV' && !e.repeat && G.mode === 'observe') ext('observe', 'toggleView');
      if (e.code === 'KeyC' && !e.repeat) snapPostcard();
      if (e.code === 'KeyT' && !e.repeat) askWhy();
      if (e.code === 'KeyJ' && !e.repeat && (G.mode === 'play' || G.mode === 'inside')) openJournal();
      if (e.code === 'KeyB' && !e.repeat && (G.mode === 'play' || G.mode === 'inside')) ext('pioneer', 'menu');
      if (e.code === 'KeyL' && !e.repeat && (G.mode === 'play' || G.mode === 'inside')) nextFilter();
      if (e.code === 'KeyX' && !e.repeat && JA.fx && JA.fx.available()) { nextFx(); U.toast('Camera effects: ' + JA.fx.LEVELS[JA.fx.level].toLowerCase(), W.w / 2, W.h * 0.3, '#ffd23f'); }
      if (e.code === 'KeyM' && !e.repeat && (G.mode === 'play' || G.mode === 'inside')) { Au.play('tap'); toggleMap(); }
      if (e.code === 'KeyN' && !e.repeat && JA.music) { setMusic(!musicOn()); if (G.mode === 'play') say(musicOn() ? 'Music on.' : 'Music off.', true); }
      if (e.code === 'Escape' || e.code === 'KeyP') { if (G.mode === 'intro') JA.intro.skip(); else if (G.mode === 'observe') { if (e.code === 'Escape') standObserve(); } else pauseModal(); }
    });
    window.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.code]; if (k) G.keys[k] = false;
      if (e.code === 'KeyE' || e.code === 'Enter') G.eHeld = false;
      if (e.code === 'KeyF') G.fHeld = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') G.keys.shift = false;
    });
    // leaving the window lets go of every key. A throw that was being aimed is cancelled, not thrown.
    function letGo() {
      G.keys = {}; G.eHeld = false;
      if (G.charge) { G.charge = null; if (A.astro) A.astro.aim = false; hideAim(); Au.stopLoop('aim'); }
      G.fHeld = false;
    }
    window.addEventListener('blur', letGo);
    // a hidden tab stops drawing, so stop the engine drone and the read-aloud voice with it
    document.addEventListener('visibilitychange', function () { if (document.hidden) { letGo(); Au.hush(); ext('music', 'hush'); } else ext('music', 'resume'); });
    // after a mouse click on a HUD button, give the keyboard back to the game (in Firefox, Space would press the button again)
    document.addEventListener('click', function (e) {
      var b = e.detail && e.target && e.target.closest ? e.target.closest('#hud button, #hud .meter, #radio button, #inside button, #card') : null;
      if (b) b.blur();
    });
    document.addEventListener('pointerdown', function () { Au.unlock(); ext('music', 'unlock'); }, { once: true });

    // drag to look, wheel to zoom
    var canvas = $('scene'), drag = null;
    canvas.addEventListener('pointerdown', function (e) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      if (G.mode === 'observe') { ext('observe', 'look', e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; return; }
      // outdoors, and inside the habitat or the rocket (but not while the camera is busy with a Mission Control cutaway)
      if (G.mode !== 'play' && !(G.mode === 'inside' && !G.cut)) return;
      W.lookBy((e.clientX - drag.x) * 0.0055, (e.clientY - drag.y) * 0.004);
      drag.x = e.clientX; drag.y = e.clientY; G.lookIdle = 0;
    });
    function endDrag(e) { if (drag && drag.id === e.pointerId) drag = null; }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) { if (G.mode === 'observe') { ext('observe', 'zoom', e.deltaY); e.preventDefault(); return; } G.zoom = clamp(G.zoom * (1 + (e.deltaY > 0 ? 0.1 : -0.1)), 6, 22); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // touch controls
    var stick = $('stick'), nub = stick.querySelector('i'), sid = null;
    function moveStick(e) {
      var r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      var len = Math.hypot(dx, dy), max = r.width / 2;
      if (len > max) { dx *= max / len; dy *= max / len; }
      G.stick.x = dx / max; G.stick.z = dy / max;
      nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    stick.addEventListener('pointerdown', function (e) { sid = e.pointerId; stick.setPointerCapture(sid); moveStick(e); e.preventDefault(); });
    stick.addEventListener('pointermove', function (e) { if (e.pointerId === sid) moveStick(e); });
    function endStick(e) { if (e.pointerId !== sid) return; sid = null; G.stick.x = G.stick.z = 0; nub.style.transform = ''; }
    stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
    function hold(id, down, up) {
      var el = $(id);
      el.addEventListener('pointerdown', function (e) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } down(); e.preventDefault(); });
      el.addEventListener('pointerup', function () { if (up) up(); }); el.addEventListener('pointercancel', function () { if (up) up(); });
    }
    hold('t-jump', function () { G.input.jump = true; });
    hold('t-use', function () { G.ePressed = true; G.eHeld = true; }, function () { G.eHeld = false; });
    hold('t-throw', function () { if (A.astro && !A.astro.carrying && G.action && G.action.alt) { G.action.alt(); return; } G.fHeld = true; }, function () { G.fHeld = false; });

    $('btn-start').addEventListener('click', function () { Au.unlock(); ext('music', 'unlock'); Au.play('tap'); U.show($('title'), false); setupModal(); });
    $('btn-how').addEventListener('click', function () { Au.play('tap'); howInfo(); });
    $('btn-science').addEventListener('click', function () { Au.play('tap'); scienceInfo(); });
    $('btn-info').addEventListener('click', function () { Au.play('tap'); howInfo(); });
    if (JA.minimap && $('btn-map')) {
      JA.minimap.init();
      var mapSaved = null; try { mapSaved = localStorage.getItem('ja-map-open'); } catch (err) { mapSaved = null; }
      toggleMap(mapSaved === '1');
      $('btn-map').addEventListener('click', function () { Au.play('tap'); toggleMap(); });
    }
    $('btn-pause').addEventListener('click', pauseModal);
    // the Settings button opens a small menu with the helmet view, pause, sound, read aloud and help
    $('btn-settings').addEventListener('click', function (e) { e.stopPropagation(); Au.play('tap'); settingsMenu($('settings-menu').classList.contains('hidden')); });
    document.addEventListener('pointerdown', function (e) {
      var menu = $('settings-menu');
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !$('btn-settings').contains(e.target)) settingsMenu(false);
    }, true);
    ['btn-pause', 'btn-info', 'btn-journal', 'btn-holo'].forEach(function (id) { $(id).addEventListener('click', function () { settingsMenu(false); }); });
    // the learning layer: every meter, the radio badge and each blue card can play a hologram; the journal keeps what you found
    var METER_HOLO = { air: 'electrolysis', food: 'plant', dose: 'dose', filter: 'scrubber', water: 'water' };
    Array.prototype.forEach.call(document.querySelectorAll('#hud .meter'), function (el) {
      function go() {
        if (!G.s || (G.mode !== 'play' && G.mode !== 'inside') || U.modalOpen() || infoOpen()) return;
        Au.play('tap');
        if (el.getAttribute('data-res') === 'town') townInfo(); else showHolo(METER_HOLO[el.getAttribute('data-res')]);
      }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(); } });
    });
    if ($('radio-ask')) $('radio-ask').addEventListener('click', askWhy);
    if ($('radio-why')) $('radio-why').addEventListener('click', askWhy);
    if ($('btn-journal')) { if (!JA.journal) $('btn-journal').classList.add('hidden'); $('btn-journal').addEventListener('click', openJournal); }
    if ($('btn-journal-title')) { if (!JA.journal) $('btn-journal-title').classList.add('hidden'); $('btn-journal-title').addEventListener('click', openJournal); }
    U.onHolo = function (id) { showHolo(id); };
    if ($('btn-holo')) { if (!JA.holo) $('btn-holo').classList.add('hidden'); $('btn-holo').addEventListener('click', function () { Au.play('tap'); holoMenu(); }); }
    if ($('btn-view')) $('btn-view').addEventListener('click', function () { setPov(!G.pov); });
    if ($('t-view')) $('t-view').addEventListener('click', function () { setPov(!G.pov); });
    if ($('btn-sun')) {
      if (!JA.sunwatch) $('btn-sun').classList.add('hidden');
      $('btn-sun').addEventListener('click', function () { Au.play('tap'); ext('sunwatch', 'open', G.s, G.weather); });
    }
    $('cine-skip').addEventListener('click', function () { if (G.mode === 'intro') JA.intro.skip(); });
    $('btn-out').addEventListener('click', exitHab);
    $('btn-sleep').addEventListener('click', sleepAsk);
    $('btn-fast').addEventListener('click', function () { G.fast = !G.fast; this.classList.toggle('on', G.fast); Au.play('tap'); });
    $('btn-sound').addEventListener('click', function () { Au.setSound(!Au.soundOn()); this.querySelector('.set-ic').textContent = Au.soundOn() ? '🔊' : '🔇'; this.classList.toggle('off', !Au.soundOn()); ext('music', 'setOn', Au.soundOn() && musicOn()); Au.play('tap'); });
    var read = $('btn-read');
    if (!Au.canRead()) read.classList.add('hidden');
    read.classList.add('off');
    read.addEventListener('click', function () { Au.setReading(!Au.readingOn()); this.classList.toggle('off', !Au.readingOn()); this.classList.toggle('on', Au.readingOn()); if (Au.readingOn()) Au.speak('Read aloud is on. I will read the messages to you.'); });

    // little moments from the physics
    A.onJump = function () { Au.play('jump'); G.tut.jumped = true; if (G.s) tip('jump', G.s.site.id === 'moon' ? 'Wheee! The Moon\'s gravity is only one-sixth of Earth\'s, so you jump six times higher.' : 'Boing! Mars gravity is about 38% of Earth\'s, so you jump more than twice as high.'); };
    A.onLand = function (rover) { Au.play(rover ? 'thud' : 'land'); if (!rover && !G.room) W.dust(A.astro.pos.x, A.astro.pos.z, 8, 2, 0.45); };
    A.onBonk = function () { fxPulse('shock', 0.45); Au.play('thud'); W.cam.shake = Math.max(W.cam.shake, 0.12); tip('bonk', 'Bonk! In low gravity even a small jump reaches the ceiling indoors. Mind your helmet!'); };
    A.onStep = function (p, yaw, side, sprint) {
      if (G.room) { Au.play('step'); return; }
      var c = Math.cos(yaw), sn = Math.sin(yaw);
      W.print(p.x + c * 0.2 * side, p.z - sn * 0.2 * side, yaw, 0.24, 0.46);
      if (sprint || Math.random() < 0.5) W.dust(p.x, p.z, sprint ? 3 : 1, 0.9, 0.3);
      Au.play('step', sprint ? { vol: 1.25 } : null);
    };
    A.onBounce = function (it, hit) { if (hit > 2) Au.play('thud', { at: it.pos, vol: Math.min(1, hit / 6) }); W.dust(it.pos.x, it.pos.z, 4, 1.4, 0.35); };
    // A thing in the air does not bounce off the very place that is about to take it (a socket, a funnel, the dome, the rover bed).
    A.skipHit = function (it) {
      for (var k = 0; k < G.zones.length; k++) {
        var z = G.zones[k]; if (!zoneTakes(z, it)) continue;
        zonePos(z, vHit);
        if (z.flat ? (Math.hypot(it.pos.x - vHit.x, it.pos.z - vHit.z) < z.r && it.pos.y < vHit.y + z.top) : it.pos.distanceTo(vHit) < z.r) return true;
      }
      return false;
    };
    // The rover hit something. A bump shakes you; a real crash throws the cargo out and shakes charge out of the battery.
    A.onCrash = function (impact, col, before) {
      var s = G.s, r = A.rover, hard = impact >= R.crashHard, dir = before > 0 ? 1 : -1;
      var fx = r.pos.x + Math.sin(r.yaw) * 2.3 * dir, fz = r.pos.z + Math.cos(r.yaw) * 2.3 * dir, spilled = 0;
      Au.play('thud', { at: r.pos, vol: Math.min(1, 0.5 + impact / 12) });
      W.cam.shake = Math.max(W.cam.shake, hard ? 0.55 : 0.22); fxPulse('shock', hard ? 0.8 : 0.35);
      W.dust(fx, fz, hard ? 16 : 8, 3, 0.7);
      if (!s || G.mode !== 'play') return;
      sim.crash(s, impact);
      if (!hard) { tip('bump', 'Bump! Mind the rocks: out here the rover needs a long way to stop.', undefined, 'gravity'); return; }
      Au.play('bad'); Au.play('spark', { at: r.pos });
      W.burst(fx, r.pos.y + 1.1, fz, 22, 6, 0xffe36a, { life: 0.6, size: 0.22 });
      r.bed.forEach(function (it, k) {
        if (!it) return;
        r.bed[k] = null; it.slot = -1; it.state = 'fly'; it.from = null; it.spin = 6; it.hold = G.clock + 1.5; spilled++;
        it.vel.set(Math.sin(r.yaw) * before * 0.5 + (Math.random() - 0.5) * 5, 3 + Math.random() * 2.5, Math.cos(r.yaw) * before * 0.5 + (Math.random() - 0.5) * 5);
      });
      say('Crash! ' + (spilled ? 'The cargo flew out of the bed, and the' : 'The') + ' jolt shook ' + R.crashCharge + ' seconds of charge out of the battery. Slow down near rocks and machines!', true, undefined, true, 'gravity');
    };
    A.onEdge = function () { say('That is as far as the outpost radio can reach. Turn back, Commander!'); };
    A.onDevil = function (kind) {
      if (!G.s || (G.mode !== 'play' && G.mode !== 'inside')) return;
      // (cleaning the panels is decided by the mission rules: see the 'devil' event in handleEvents)
      if (kind === 'astro') tip('devil2', 'Whee! A dust devil! Mars air is so thin that it feels like a gentle breeze.');
    };
  }

  var last = 0, wasPaused = false, lastMood = '';
  var WORLD = { mode: '', pos: null, s: null, say: function (t) { say(t, true); }, tip: function (id, t) { return tip(id, t); } };
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    advance(dt);
  }
  function advance(dt) {
    G.dt = dt;
    var paused = U.modalOpen() || infoOpen() || holoOpen(), k = G.keys;
    G.input.x = clamp((k.right ? 1 : 0) - (k.left ? 1 : 0) + G.stick.x, -1, 1);
    G.input.z = clamp((k.down ? 1 : 0) - (k.up ? 1 : 0) + G.stick.z, -1, 1);
    G.input.sprint = !!k.shift || Math.hypot(G.stick.x, G.stick.z) > 0.93;
    G.input.puff = !!k.shift;      // a thumb always pushes the stick to the edge, so only the Shift key costs extra air
    if (G.pov && (G.mode === 'play' || G.mode === 'inside') && A.rover && !A.rover.driver && !G.mini) {      // helmet view: A and D turn you; the touch stick still side-steps
      var turn = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      if (turn && !paused) { W.cam.yaw -= turn * 2.2 * dt; G.lookIdle = 0; }
      G.input.x = clamp(G.stick.x, -1, 1);
    }
    if (paused && !wasPaused) Au.stopAll();      // a card just opened: no motor or drill drone behind it
    wasPaused = paused;
    if (!paused) {
      G.clock += dt;
      U.tickCards(dt);
      if (G.mode === 'play') stepPlay(dt);
      else if (G.mode === 'inside') stepInside(dt);
      else if (G.mode === 'launch') stepLaunch(dt);
      else if (G.mode === 'observe') stepObserve(dt);
      if (A.astro) A.update(dt, (G.mode === 'play' || G.mode === 'inside') && !G.mini && !G.cut ? G.input : null);
      if (G.s && (G.mode === 'play' || G.mode === 'inside')) { MCTX.s = G.s; MCTX.weather = G.weather; ext('mission', 'update', dt, MCTX); }
      if (G.mode === 'intro') JA.intro.step(dt);
      if (G.s && (G.mode === 'play' || G.mode === 'inside')) {
        checkZones();
        SKY.outside = G.mode === 'play'; SKY.pos = me();
        ext('sky', 'update', dt, G.s, SKY);
      }
      if (G.s) {
        WORLD.mode = G.mode; WORLD.pos = me(); WORLD.s = G.s;
        ext('colony', 'update', dt, WORLD);
        ext('pioneer', 'update', dt, G.s, G.mode, WORLD.pos);
      }
    }
    B.update(dt, G.mode === 'title' ? null : G.s);
    W.update(dt);
    if (!paused) { hudFrame(); if (G.s && (G.mode === 'play' || G.mode === 'inside')) sayNext(); }
    soundFrame(dt, paused);
    var povOn = !!G.pov && (G.mode === 'play' || G.mode === 'inside') && !!G.s && !G.cut;
    if (povOn) {
      POV.yaw = W.cam.yaw; POV.pos = me(); POV.home = B.spots.door; POV.goal = G.goal && G.goal.target; POV.goalIcon = G.goal ? G.goal.icon : '';
      POV.air = G.s.air; POV.moving = Math.hypot(G.input.x, G.input.z) > 0.2; POV.effort = POV.moving && G.input.sprint;
    }
    ext('pov', 'frame', dt, povOn, povOn ? POV : null);
    if (JA.fx) {
      var fs = JA.fx.state;
      fs.mode = G.mode; fs.site = G.s ? G.s.site.id : W.site; fs.room = G.room || ''; fs.pov = povOn;
      fs.air = G.s && (G.mode === 'play' || G.mode === 'inside') ? G.s.air : 100;
    }
    var mood = musicMood(); if (mood !== lastMood) { lastMood = mood; ext('music', 'setMood', mood); }
    G.input.jump = false; G.ePressed = false; G.qPressed = false;
  }
  G.advance = advance;   // lets tests step the game without waiting for the screen

  function boot() {
    if (!window.THREE) { fatal('The 3D engine could not load. Please check your internet connection and reload the page.'); return; }
    if (!W.init($('scene'))) { fatal('Sorry — this browser cannot show 3D graphics (WebGL is turned off).'); return; }
    W.build('mars', G.opts.suit);
    A.astro.mode = 'hidden';
    titleScene();
    W.snapCamera();
    W.cam.eye = A.eye;            // where the helmet view looks from
    if (W.prewarmEarth) W.prewarmEarth();
    bind();
    requestAnimationFrame(frame);
  }
  boot();
})(window.JA);
