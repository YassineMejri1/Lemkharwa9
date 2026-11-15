/* Astro Outpost film — the 80-second gameplay film for judges. The recorder puts this script into the running
   game (node tools/film/record.js --film gameplay ...). Unlike the trailer (director.js), the game's own screen
   stays on: the meters, the radio, the prompts, the cards. Every phase of a mission is shown in the order a
   player meets it, with a small chapter label that says what it is.

   The sound is the game's own. While a shot is recorded, every sound effect, voice line, music change, machine
   hum and background bed the game asks for is written down with its film time and loudness (sound-<shot>.json);
   tools/film/gamesound.js mixes those files into the soundtrack. */
(function () {
  'use strict';
  var JA = window.JA, G = JA.game, W = JA.world, A = JA.actors, B = JA.base, Tn = JA.terrain, sim = JA.sim, K = JA.colony, C = window.__clock, T = window.THREE, R = JA.RULES, Au = JA.audio;
  var FPS = 30, TICK = 1000 / 60;
  var F = { t: 0, T: 0, shot: null, envT: null, cam: null, skip: false, note: {}, done: {}, rec: false, rate: 1, scene: null, loops: {}, fi: 0 };
  var V = new T.Vector3();
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(x) { return clamp(x, 0, 1); }
  function smooth(x) { x = sat(x); return x * x * (3 - 2 * x); }
  function easeOut(x) { x = sat(x); return 1 - Math.pow(1 - x, 3); }
  function span(t, a, b) { return sat((t - a) / (b - a)); }
  function pump(n) { for (var i = 0; i < (n || 1); i++) C.tick(TICK); }
  function quiet(n) { F.skip = true; pump(n); F.skip = false; }
  function key(code, up) { window.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { code: code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); }
  function press(code) { key(code); key(code, true); }
  function once(name, fn) { if (!F.done[name]) { F.done[name] = true; fn(); } }
  function at(t, s, name, fn) { if (t >= s) once(name, fn); }
  function ground(x, z) { return A.groundAt ? A.groundAt(x, z) : Tn.height(x, z); }
  function norm2(x, z) { var d = Math.hypot(x, z) || 1; return [x / d, z / d]; }
  function click(sel) { var b = typeof sel === 'string' ? q(sel) : sel; if (b) b.click(); return !!b; }
  function btn(re) { return Array.prototype.filter.call(document.querySelectorAll('button'), function (b) { return b.offsetParent && re.test(b.textContent); })[0]; }
  function prompt() { var p = $('prompt'); return p && !p.classList.contains('hidden') ? $('prompt-text').textContent : ''; }

  // ---- drawing only when the film wants a picture; the film may set the time of day
  var realRender = W.renderer.render.bind(W.renderer);
  W.renderer.render = function (a, b) { if (!F.skip) realRender(a, b); };
  if (JA.fx && JA.fx.render) { var fxRender = JA.fx.render; JA.fx.render = function (r, s, c, dt) { return F.skip ? true : fxRender.call(JA.fx, r, s, c, dt); }; }
  if (JA.fx && JA.fx.setLevel) JA.fx.setLevel(2);
  var realUpdate = W.update;
  W.update = function (dt) { if (F.envT != null) W.env.t = F.envT; if (F.dust != null) W.env.dust = F.dust; if (F.cam) F.cam(F.t); realUpdate(dt); };
  function cine(px, py, pz, lx, ly, lz, fov) { var c = W.cam; c.mode = 'cine'; c.cine.pos.set(px, py, pz); c.cine.look.set(lx, ly, lz); c.cine.fov = fov || 50; c.cine.roll = 0; }
  function playCam(yaw, pitch, dist) { var c = W.cam; c.mode = 'play'; c.focus = A.focus; if (yaw != null) c.yaw = yaw; if (pitch != null) c.pitch = pitch; if (dist != null) { c.dist = dist; G.zoom = dist; } }

  // =====================================================================
  //  THE GAME'S OWN SOUND, written down as it happens
  // =====================================================================
  var META = (Au && Au.debug && Au.debug.meta) || {}, SND = [], SAMPLES = {};
  var BEDS = ['amb-suit', 'amb-mars-wind', 'amb-mars-dust', 'amb-hab', 'amb-storm'];
  function envOf(sc) { var out = sc && sc.place === 'out', inn = sc && sc.place === 'in'; return out ? (sc.site === 'moon' ? { lp: 1250, gain: 0.9, range: 0.6 } : { lp: 3800, gain: 0.95, range: 0.85 }) : inn ? { lp: 700, gain: 0.3, range: 1 } : { lp: 0, gain: 1, range: 1 }; }
  function ear() { var a = A.astro; if (A.rover && A.rover.driver) return A.rover.pos; if (a && a.mode !== 'hidden' && (G.mode === 'play' || G.mode === 'inside' || G.mode === 'observe')) return a.pos; return W.camera.position; }
  function place(pos, range) {
    if (!pos) return 1;
    var e = ear(), d = Math.hypot(pos.x - e.x, pos.z - e.z), q2 = d / ((range || 12) * envOf(F.scene).range), g = 1 / (1 + q2 * q2);
    if (q2 > 5) g *= Math.max(0, 1 - (q2 - 5) / 2);
    return g;
  }
  function busGain(bus) { var e = envOf(F.scene); return bus === 'ui' ? 0.55 : bus === 'world' ? 0.55 * e.gain : bus === 'amb' ? 0.55 : 0.55; }
  function busLp(bus) { return bus === 'world' ? envOf(F.scene).lp : 0; }
  if (Au) {
    var orig = { play: Au.play, line: Au.line, voice: Au.voice, music: Au.music, scene: Au.scene, loop: Au.loop, stopLoop: Au.stopLoop, hum: Au.hum, stopAll: Au.stopAll };
    Au.play = function (name, o) {
      if (F.rec && F.rate <= 2.5) { var m = META[name] || {}; o = o || {}; SND.push({ T: F.T + (o.delay || 0), k: 'sfx', name: name, n: m.n || 1, rate: o.rate || 1, g: (m.vol == null ? 0.5 : m.vol) * (o.vol == null ? 1 : o.vol) * place(o.at, m.range) * busGain(m.bus), lp: busLp(m.bus) }); }
      return orig.play.apply(Au, arguments);
    };
    Au.line = function (ids, o) {
      var L = JA.VOICE || {}; var list = (typeof ids === 'string' ? [ids] : ids || []).filter(function (id) { return id && L[id]; });
      if (F.rec && list.length && F.rate <= 2.5) SND.push({ T: F.T, k: 'line', ids: list, plain: !!(o && o.plain) });
      return orig.line.apply(Au, arguments);
    };
    Au.voice = function (src) { if (F.rec) SND.push({ T: F.T, k: 'voice', src: src }); return orig.voice.apply(Au, arguments); };
    Au.stopVoice = (function (sv) { return function () { if (F.rec) SND.push({ T: F.T, k: 'hush' }); return sv.apply(Au, arguments); }; })(Au.stopVoice);
    Au.music = function (name) { F.music = name && JA.MUSIC && JA.MUSIC[name] ? name : null; return orig.music.apply(Au, arguments); };
    Au.scene = function (o) { F.scene = o; return orig.scene.apply(Au, arguments); };
    Au.loop = function (name, p) { var m = META[name] || {}; p = p || {}; F.loops[name] = { v: (m.vol == null ? 0.5 : m.vol) * (p.vol == null ? 1 : p.vol), at: p.at ? { x: p.at.x, z: p.at.z } : null, range: m.range, bus: m.bus, keep: !!p.keep }; return orig.loop.apply(Au, arguments); };
    Au.stopLoop = function (name) { delete F.loops[name]; return orig.stopLoop.apply(Au, arguments); };
    Au.hum = function (name, want, pos, vol) { var m = META[name] || {}; if (want) F.loops[name] = { v: (m.vol == null ? 0.5 : m.vol) * (vol == null ? 1 : vol), at: pos ? { x: pos.x, z: pos.z } : null, range: m.range, bus: m.bus, keep: true }; else delete F.loops[name]; return orig.hum.apply(Au, arguments); };
    Au.stopAll = function () { Object.keys(F.loops).forEach(function (n) { if (!F.loops[n].keep) delete F.loops[n]; }); return orig.stopAll.apply(Au, arguments); };
  }
  // once per picture: how loud every continuous sound is right now (beds, hums, motors, music)
  function sampleSound() {
    var sc = F.scene, out = sc && sc.place === 'out', inn = sc && sc.place === 'in', mars = sc && sc.site === 'mars', dust = sc ? (sc.dust > 0.7 ? 2 : sc.dust > 0.2 ? 1 : 0) : 0, storm = sc ? sc.storm | 0 : 0;
    var beds = { 'amb-suit': out ? (mars ? 0.8 : 1) : 0, 'amb-mars-wind': out && mars ? [1, 0.7, 0.4][dust] : 0, 'amb-mars-dust': out && mars ? [0, 0.5, 1][dust] : 0, 'amb-hab': inn ? 1 : 0,
      'amb-storm': storm === 2 ? (out ? 1 : inn ? 0.4 : 0) : storm === 1 ? (out ? 0.35 : inn ? 0.15 : 0) : 0 };
    function put(name, g, lp) { if (g < 0.002) return; (SAMPLES[name] = SAMPLES[name] || []).push([F.fi, +g.toFixed(4), lp || 0]); }
    BEDS.forEach(function (b) { var m = META[b] || {}; put(b, beds[b] * (m.vol == null ? 0.5 : m.vol) * 0.55); });
    if (F.rate <= 2.5) Object.keys(F.loops).forEach(function (n) { if (BEDS.indexOf(n) >= 0) return; var L = F.loops[n]; put(n, L.v * place(L.at, L.range) * busGain(L.bus), busLp(L.bus)); });
    if (F.music) put('music:' + F.music, (JA.MUSIC[F.music].v == null ? 0.5 : JA.MUSIC[F.music].v));
    if (F.bed) put('music:' + F.bed.name, F.bed.v);         // a quiet music bed under play (the game's own mood music is made live and cannot be recorded)
  }

  // =====================================================================
  //  CHAPTER LABELS
  // =====================================================================
  var css = document.createElement('style');
  css.textContent = [
    '#gfilm{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:"Sora","Figtree",sans-serif;color:#fff;}',
    '#gfilm .chap.low{top:auto;bottom:4.5%;}',
    '#gfilm .chap{position:absolute;left:50%;top:15.2%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:10px 22px 10px 10px;border-radius:99px;background:rgba(8,12,26,.72);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px rgba(0,0,0,.35);white-space:nowrap;opacity:0;}',
    '#gfilm .chap i{font-style:normal;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#ffd23f;color:#1a1300;font-weight:800;font-size:19px;}',
    '#gfilm .chap b{font-weight:800;font-size:19px;letter-spacing:.08em;text-transform:uppercase;}',
    '#gfilm .chap span{font-family:"Figtree",sans-serif;font-weight:600;font-size:16px;color:#cfe3ff;}',
    '#gfilm .end{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:14px;background:radial-gradient(ellipse at 50% 50%,rgba(4,7,16,.82),rgba(4,7,16,.6));opacity:0;}',
    '#gfilm .end h1{margin:0;font-family:"Exo 2","Sora",sans-serif;font-weight:900;font-size:96px;letter-spacing:.03em;text-transform:uppercase;text-shadow:0 8px 40px rgba(0,0,0,.6);}',
    '#gfilm .end h1 em{font-style:normal;color:#ffd23f;}',
    '#gfilm .end p{margin:0;font-family:"Figtree",sans-serif;font-weight:700;font-size:24px;letter-spacing:.08em;color:#e8eeff;}',
    '#gfilm .end p b{color:#ffd23f;}',
    '#gfilm .end small{font-family:"Figtree",sans-serif;font-weight:700;font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.75);}',
    '#gfilm .veil{position:absolute;inset:0;background:#000;opacity:0;}',
    '#stick,#touch-btns,#cine-skip{display:none!important;}'
  ].join('\n');
  document.head.appendChild(css);
  var box = document.createElement('div'); box.id = 'gfilm';
  box.innerHTML = '<div class="chap"><i></i><b></b><span></span></div><div class="end"><h1>Astro <em>Outpost</em></h1><p>Junior Astronaut Mission Trainer</p><p>Play it free in your browser: <b>lemkharwa9.vercel.app</b></p><small>NASA Space Apps Challenge 2026 · Tunis · real gameplay · not affiliated with NASA</small></div><div class="veil"></div>';
  document.body.appendChild(box);
  var chap = box.querySelector('.chap'), endCard = box.querySelector('.end'), veil = box.querySelector('.veil');
  // [first shot, number, title, one line]
  var CHAPTERS = [
    ['setup', 1, 'Mission setup', 'the Moon or Mars · 5, 8 or 10 days · the live Sun or May 2024 · classic or Pioneer'],
    ['land1', 2, 'The landing', 'every mission opens with the descent (it can be skipped)'],
    ['brief', 3, 'Your mission', 'keep the crew alive for 8 sols on Mars'],
    ['power', 4, 'Power is limited', 'the Sun charges a few cells a day: each one goes where you carry it'],
    ['ice1', 5, 'Ice is treasure', 'drills dig it out; electricity splits it into oxygen'],
    ['rover', 6, 'The rover', 'four things in the bed · drive too fast and the cargo flies'],
    ['farm', 7, 'Food and shielding', 'lettuce or potatoes · soil bags block radiation'],
    ['core', 8, 'Real science', 'rock cores, holograms and a Field Journal, all with NASA sources'],
    ['warn', 9, 'Real solar storms', 'every storm happened on a real day: NASA DONKI data'],
    ['crisis', 10, 'No checklist', 'six crises from real missions: you decide, then live with it'],
    ['night', 11, 'Night and morning', 'the numbers add up · a new idea every morning'],
    ['lookout', 12, 'The lookout', 'sit and watch Mars turn to night, Earth as the evening star'],
    ['pioneer', 13, 'Pioneer mode', 'break rocks, keep the pieces, build'],
    ['town', 14, 'A town grows', 'good days bring ships: 4, 12, 30, then 80 people'],
    ['launch', 15, 'Going home', 'launch day, then a look at what your outpost could become']
  ];
  var chapAt = {}; CHAPTERS.forEach(function (c) { chapAt[c[0]] = c; });
  function drawOverlay() {
    var s = F.shot, c = F.chap, Tf = F.T;
    chap.classList.toggle('low', !!(s && s.low));
    if (c) {
      var a = span(Tf, c.from, c.from + 0.35) * (1 - span(Tf, c.to - 0.3, c.to));
      chap.style.opacity = a.toFixed(3); chap.style.transform = 'translateX(-50%) translateY(' + ((1 - easeOut(span(Tf, c.from, c.from + 0.35))) * -14).toFixed(1) + 'px)';
    } else chap.style.opacity = 0;
    endCard.style.opacity = (Tf >= F.endAt ? span(Tf, F.endAt, F.endAt + 0.5) : 0).toFixed(3);
    veil.style.opacity = Math.max(1 - span(Tf, 0, 0.5), span(Tf, F.len - 0.5, F.len)).toFixed(3);
  }

  // ---- the game's screen is on, except the touch controls
  function showGame() { Array.prototype.forEach.call(document.body.children, function (e) { if (e.style && e.id !== 'gfilm') e.style.visibility = ''; }); }

  // =====================================================================
  //  SHARED STAGING
  // =====================================================================
  function stage(o) {
    var s = G.s, a = A.astro, r = A.rover;
    o = o || {};
    if (r.driver) A.exitRover();
    if (a.carrying) { var it = a.carrying; A.setDown(); A.remove(it); }
    a.mode = 'walk'; a.vel.set(0, 0, 0); a.vy = 0;
    G.keys.up = G.keys.down = G.keys.left = G.keys.right = G.keys.shift = false; G.fHeld = false;
    if (o.calm !== false) { s.storm = null; s.glitch = null; W.env.storm = 0; }
    s.air = o.air == null ? Math.max(s.air, 70) : o.air; s.food = o.food == null ? Math.max(s.food, 60) : o.food; s.dose = o.dose == null ? Math.min(s.dose, 12) : o.dose;
    F.envT = o.envT == null ? null : o.envT;
    if (o.at) put(o.at[0], o.at[1]);
    document.querySelectorAll('#toasts > *').forEach(function (e) { e.remove(); });
  }
  function put(x, z) { var a = A.astro; a.pos.set(x, ground(x, z), z); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; }
  function face(x, z) { var a = A.astro; a.yaw = Math.atan2(x - a.pos.x, z - a.pos.z); }
  function walk(dx, dz, sprint) { W.cam.yaw = Math.atan2(-dx, -dz); G.keys.up = true; G.keys.shift = !!sprint; }
  function walkTo(x, z, sprint, stopAt) { var a = A.astro.pos, dx = x - a.x, dz = z - a.z, d = Math.hypot(dx, dz); if (d > (stopAt || 0.8)) { walk(dx / d, dz / d, sprint); return false; } halt(); return true; }
  function halt() { G.keys.up = false; G.keys.shift = false; }
  function hold(frac) { if (G.s) G.s.t = G.s.dayLength * frac; }
  function closeCards() { if (U().closeModal && U().modalOpen && U().modalOpen()) U().closeModal(); var x = q('#info-root .modal [data-act="ok"], #info-root .modal .close'); if (x && x.offsetParent) x.click(); }
  function U() { return JA.ui || {}; }
  function endMini() { G.eHeld = false; if (G.mini) { G.mini = null; if (Au) Au.stopLoop('drill'); if (U().drillUi) U().drillUi(null); if (A.astro.mode === 'busy') A.astro.mode = 'walk'; } }

  var SHOTS = [], byId = {}, AT = 0;
  function shot(o) { o.at = AT / FPS; AT += o.frames; SHOTS.push(o); byId[o.id] = o; }

  // =====================================================================
  //  0 · TITLE  ·  1 · SETUP
  // =====================================================================
  shot({ id: 'title', frames: 90,
    begin: async function () { F.bed = null; quiet(30); },
    frame: function (t) { at(t, 0.2, 'music', function () { Au.music('title'); }); }
  });
  shot({ id: 'setup', low: true, frames: 135,
    begin: async function () { click('#btn-start'); quiet(10); },
    frame: function (t) {
      function pick(g, v) { var b = q('.modal button[data-g="' + g + '"][data-v="' + v + '"]'); if (b) { b.click(); var m = q('.modal'); if (m) b.scrollIntoView({ block: 'center' }); } }
      at(t, 0.5, 's1', function () { pick('site', 'mars'); });
      at(t, 1.2, 's2', function () { pick('level', 'commander'); });
      at(t, 1.9, 's3', function () { pick('shift', '300'); });
      at(t, 2.6, 's4', function () { pick('sun', 'archive'); });
      at(t, 3.3, 's5', function () { pick('pioneer', 'on'); });
      at(t, 4.1, 's6', function () { var g = q('.modal button[data-act="go"]'); if (g) g.scrollIntoView({ block: 'center' }); });
    },
    end: function () { click('.modal button[data-act="go"]'); }
  });

  // =====================================================================
  //  2 · THE LANDING (the game's own film)  ·  3 · THE BRIEFING
  // =====================================================================
  async function untilIntro(time) {
    for (var i = 0; i < 6000 && G.mode !== 'intro'; i++) { quiet(2); if (i % 20 === 0) await C.sleep(5); }
    F.skip = true; for (var j = 0; j < 8000 && JA.intro.time() < time && G.mode === 'intro'; j++) C.tick(TICK); F.skip = false;
  }
  shot({ id: 'land1', frames: 108, begin: async function () { await untilIntro(4.3); } });
  shot({ id: 'land2', frames: 72, begin: async function () { await untilIntro(17.25); } });
  shot({ id: 'brief', low: true, frames: 84,
    begin: async function () {
      if (G.mode === 'intro') JA.intro.skip();
      for (var i = 0; i < 400 && G.mode !== 'brief'; i++) { quiet(2); if (i % 10 === 0) await C.sleep(5); }
      quiet(20);
    },
    frame: function (t) { at(t, 1.6, 'out', function () { var b = btn(/Step outside/); if (b) b.click(); }); }
  });

  // =====================================================================
  //  4 · POWER
  // =====================================================================
  shot({ id: 'power', frames: 180,
    begin: async function () {
      for (var i = 0; i < 100 && G.mode !== 'play'; i++) quiet(2);
      var sp = B.spots, rack = sp.rack, so = sp.sockets.air;
      stage({ envT: 0.2, air: 52 });
      G.s.m.air.power = 0;
      put(rack.x + 0.2, rack.z + 1.6); face(rack.x, rack.z);
      playCam(Math.PI * 0.05, 0.32, 8.5);
      F.note.so = so; F.note.rack = rack;
      F.bed = { name: 'title', v: 0.16 };
      quiet(10);
    },
    frame: function (t) {
      var n = F.note, a = A.astro;
      hold(0.2);
      at(t, 0.35, 'take', function () { n.p1 = prompt(); press('KeyE'); });
      if (t > 0.9 && !n.arrived) { n.arrived = walkTo(n.so.x + 0.5, n.so.z + 0.9, true, 0.9); if (n.arrived) { n.arrivedAt = t; face(n.so.x, n.so.z); } }
      if (n.arrived) at(t, n.arrivedAt + 0.35, 'plug', function () { n.p2 = prompt(); press('KeyE'); });
    }
  });

  // =====================================================================
  //  5 · ICE
  // =====================================================================
  shot({ id: 'ice1', frames: 105, rate: function (t) { return t > 0.7 && t < 2.6 ? 2.4 : 1; },
    begin: async function () {
      var q0 = B.spots.ice[0];
      stage({ envT: 0.24 });
      A.items.slice().forEach(function (it) { if (it.type === 'ice' && it.state !== 'bed') A.remove(it); });
      G.rigs.forEach(function (r) { r.state = 'idle'; r.p = 0; });
      put(q0.x + 1.7, q0.z + 1.3); face(q0.x, q0.z);
      playCam(Math.atan2(1.7, 1.3) + 0.6, 0.3, 7.5);
      F.note.q = q0;
      quiet(8);
    },
    frame: function (t) {
      var n = F.note; hold(0.24);
      at(t, 0.3, 'drill', function () { n.p1 = prompt(); press('KeyE'); });
      at(t, 3.0, 'pick', function () { n.p2 = prompt(); press('KeyE'); });
    }
  });
  shot({ id: 'ice2', frames: 75,
    begin: async function () {
      var hp = B.spots.hoppers.air;
      stage({ envT: 0.26 });
      G.s.m.air.queue = 0; G.s.m.air.power = Math.max(G.s.m.air.power, 2);
      put(hp.x + 1.2, hp.z + 1.6); face(hp.x, hp.z);
      if (!A.astro.carrying) A.pick(A.spawn('ice', A.handPos(V), null, 'rest'));
      playCam(Math.atan2(1.2, 1.6) + 0.5, 0.3, 7);
      F.note.hp = hp; quiet(8);
    },
    frame: function (t) { hold(0.26); at(t, 0.3, 'feed', function () { F.note.p = prompt(); press('KeyE'); }); }
  });

  // =====================================================================
  //  6 · THE ROVER (with a crash)
  // =====================================================================
  function findRun() {
    var best = null, bs = 9, i, k, b, ax, az, sc;
    function clear(b, ax, az, len) {
      var h0 = Tn.height(b.x, b.z), worst = 0, i2, j, x, z, o;
      for (i2 = 3; i2 <= len; i2 += 3) {
        x = b.x - ax * i2; z = b.z - az * i2; worst = Math.max(worst, Math.abs(Tn.height(x, z) - h0));
        for (j = 0; j < Tn.boulders.length; j++) { o = Tn.boulders[j]; if (o !== b && o.mesh && o.mesh.visible && Math.hypot(o.x - x, o.z - z) < o.r + 3.2) return 99; }
        if (Math.hypot(x, z) < 34 || Math.hypot(x - Tn.L.colony[0], z - Tn.L.colony[1]) < 56 || Math.hypot(x - Tn.L.rocket[0], z - Tn.L.rocket[1]) < 16) return 99;
      }
      return worst;
    }
    for (i = 0; i < Tn.boulders.length; i++) {
      b = Tn.boulders[i]; if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.25 || b.r > 2.4 || Math.hypot(b.x, b.z) > 150) continue;
      for (k = 0; k < 12; k++) { ax = Math.sin(k / 12 * 6.283); az = Math.cos(k / 12 * 6.283); sc = clear(b, ax, az, 40); if (sc < bs) { bs = sc; best = { b: b, ax: ax, az: az }; } }
    }
    return best;
  }
  shot({ id: 'rover', frames: 120,
    begin: async function () {
      stage({ envT: 0.28 });
      var run = findRun(); if (!run) throw new Error('no clear run for the rover');
      var r = A.rover, b = run.b;
      A.items.slice().forEach(function (it) { if (it.state === 'bed') A.remove(it); });
      r.pos.set(b.x - run.ax * 30, 0, b.z - run.az * 30); r.pos.y = ground(r.pos.x, r.pos.z); r.yaw = Math.atan2(run.ax, run.az); r.speed = 0; r.vy = 0;
      G.s.m.rover.charge = 100; G.s.m.rover.stuck = false;
      A.roverSpot('door', A.astro.pos); A.enterRover();
      ['ice', 'ice', 'crate'].forEach(function (type) { A.toBed(A.spawn(type, V.set(r.pos.x, r.pos.y + 2, r.pos.z), type === 'crate' ? { name: 'Lettuce crate', crop: 'lettuce' } : null, 'rest')); });
      playCam(Math.atan2(-run.ax, -run.az) + 0.35, 0.28, 11);
      F.note.run = { ax: run.ax, az: run.az }; F.note.c0 = G.s.stats.crashes || 0; G.keys.up = true; quiet(110);
    },
    frame: function () { hold(0.28); W.cam.yaw = Math.atan2(-F.note.run.ax, -F.note.run.az) + 0.35; G.keys.up = (G.s.stats.crashes || 0) === F.note.c0; },
    end: function () { F.note.crashes = (G.s.stats.crashes || 0) - F.note.c0; halt(); if (A.rover.driver) A.exitRover(); A.rover.speed = 0; }
  });

  // =====================================================================
  //  7 · FOOD AND SHIELDING
  // =====================================================================
  shot({ id: 'farm', frames: 66,
    begin: async function () {
      var bed = B.spots.beds[1];
      stage({ envT: 0.3, food: 40 });
      G.s.m.food.beds.forEach(function (b, i) { b.state = i === 3 ? 'growing' : 'ripe'; b.g = i === 3 ? 0.55 : 1; b.crop = i % 2 ? 'potato' : 'lettuce'; });
      G.s.m.food.on = true;
      put(bed.x, bed.z - 1.75); face(bed.x, bed.z);
      playCam(0.45, 0.42, 7.5);
      quiet(10);
    },
    frame: function (t) { hold(0.3); at(t, 0.3, 'pick', function () { F.note.p = prompt(); press('KeyE'); }); }
  });
  shot({ id: 'shield', frames: 66,
    begin: async function () {
      stage({ envT: 0.3 });
      G.s.bags = Math.min(G.s.bags || 0, 4); F.note.bags0 = G.s.bags;
      put(-6.5, 10.5); face(0, 0);
      A.pick(A.spawn('bag', A.handPos(V), { name: 'soil bag' }, 'rest'));
      playCam(Math.atan2(-6.5, 10.5) + 0.25, 0.22, 7);
      quiet(8);
    },
    frame: function (t) {
      hold(0.3);
      at(t, 0.15, 'aim', function () { G.fHeld = true; });
      at(t, 0.15 + (F.note.holdFor || 0.9), 'throw', function () { G.fHeld = false; });
      at(t, 1.4, 'bag2', function () { A.pick(A.spawn('bag', A.handPos(V), { name: 'soil bag' }, 'rest')); G.fHeld = true; });
      at(t, 1.4 + (F.note.holdFor || 0.9), 'throw2', function () { G.fHeld = false; });
    },
    end: function () { F.note.bags = G.s.bags - F.note.bags0; G.fHeld = false; }
  });

  // =====================================================================
  //  8 · SCIENCE
  // =====================================================================
  shot({ id: 'core', frames: 66,
    begin: async function () {
      stage({ envT: 0.32 });
      var d = B.spots.drill[0];
      put(d.x + 1.2, d.z + 1.0); face(d.x, d.z);
      playCam(Math.atan2(1.2, 1.0) + 0.5, 0.32, 7);
      F.note.d = d; quiet(10);
    },
    frame: function (t) { hold(0.32); at(t, 0.2, 'drill', function () { F.note.p = prompt(); press('KeyE'); }); if (t > 0.5) G.eHeld = true; }
  });
  shot({ id: 'holo', low: true, frames: 75,
    begin: async function () { endMini(); stage({ envT: 0.32 }); quiet(4); },
    frame: function (t) {
      at(t, 0.1, 'open', function () { if (JA.holo) JA.holo.open('electrolysis', {}); });
      at(t, 1.25, 'next', function () { click('#holo-root .holo-next'); });
    },
    end: function () { if (JA.holo && JA.holo.isOpen()) JA.holo.close(); }
  });
  shot({ id: 'journal', low: true, frames: 54,
    begin: async function () { quiet(4); },
    frame: function (t) { at(t, 0.05, 'open', function () { press('KeyJ'); }); },
    end: function () { press('Escape'); closeCards(); quiet(6); }
  });

  // =====================================================================
  //  9 · A REAL SOLAR STORM
  // =====================================================================
  function stormDay() {
    var s = G.s, w = null;
    (s.weather || []).forEach(function (x) { if (x && x.level > 0 && (!w || x.strength > w.strength)) w = x; });
    return w || { level: 2, cls: '', cause: 'sep', strength: 12 };
  }
  function setStorm(startIn) {
    var s = G.s, w = stormDay();
    s.storm = { start: s.t + startIn, end: s.t + startIn + R.stormDuration, level: w.level, cls: w.cls, cause: w.cause || 'sep', warned: false, active: false, over: false, strength: w.strength * 3 * s.site.stormMult * s.level.stormScale };
  }
  shot({ id: 'warn', frames: 75,
    begin: async function () {
      var d = B.spots.door;
      stage({ envT: 0.4, calm: true });
      put(d.x + 6, d.z + 17); face(d.x, d.z);
      playCam(Math.atan2(6, 17), 0.25, 8);
      G.s.t = G.s.dayLength * 0.4; G.tutStep = Math.max(G.tutStep || 0, 9); G.lastWarn = 99; G.s.m.comms.on = true;      // the Radio Dish is powered: Earth warns early
      F.note.door = [d.x, d.z]; quiet(4);
    },
    frame: function (t) { var n = F.note; at(t, 0.05, 'storm', function () { setStorm(9.4); }); if (t > 0.9) walkTo(n.door[0], n.door[1] + 1.4, true, 1.0); },
    end: function () { var st = G.s.storm; F.note.phase = sim.stormPhase(G.s); F.note.left = st ? +(st.start - G.s.t).toFixed(1) : null; F.note.paused = !!(U().modalOpen && U().modalOpen()); F.note.banner = ($('banner') || {}).textContent; F.note.sol = G.s.sol + ' ' + G.s.dayDone + ' ' + G.s.night; }
  });
  shot({ id: 'raging', frames: 60,
    begin: async function () {
      var s = G.s; if (s.storm) { s.storm.start = s.t - 0.1; }
      quiet(30);
    },
    frame: function (t) { var n = F.note; walkTo(n.door[0], n.door[1] + 1.2, true, 1.0); },
    end: function () { halt(); }
  });
  shot({ id: 'inside', frames: 66,
    begin: async function () {
      endMini(); var d = B.spots.door; put(d.x, d.z + 1.2); face(d.x, d.z); quiet(6);
      F.note.p = prompt();
    },
    frame: function (t) { at(t, 0.05, 'door', function () { press('KeyE'); }); },
    end: function () { F.note.mode = G.mode; }
  });
  shot({ id: 'sunwatch', low: true, frames: 66,
    begin: async function () { quiet(2); },
    frame: function (t) { at(t, 0.05, 'open', function () { if (JA.sunwatch) JA.sunwatch.open(G.s, G.weather); }); },
    end: function () { closeCards(); press('Escape'); quiet(6); }
  });

  // =====================================================================
  //  10 · A CRISIS  ·  11 · NIGHT AND MORNING
  // =====================================================================
  shot({ id: 'crisis', low: true, frames: 135,
    begin: async function () {
      closeCards();
      var s = G.s; s.storm = null; W.env.storm = 0;
      if (G.mode === 'inside') { var o = $('btn-out'); if (o) o.click(); quiet(20); }
      stage({ envT: 0.45 }); put(4, 16);
      playCam(0.4, 0.3, 9);
      s.crisis = { id: 'co2', at: s.t + 0.25, until: s.t + 200, state: 'pending' };
      quiet(2);
    },
    frame: function (t) {
      at(t, 2.6, 'pick', function () { var b = q('.modal button[data-act="pick"][data-v="build"]') || q('.modal button[data-act="pick"]'); if (b) b.click(); });
    },
    end: function () { var b = btn(/Carry on/); if (b) b.click(); quiet(6); }
  });
  shot({ id: 'night', low: true, frames: 66,
    begin: async function () {
      var s = G.s; closeCards();
      s.air = Math.max(s.air, 70); s.food = Math.max(s.food, 60); s.today.airMade = Math.max(s.today.airMade, 50); s.today.crates = Math.max(s.today.crates, 1);
      s.t = s.dayLength - 0.1;
      for (var i = 0; i < 30 && G.mode !== 'night'; i++) quiet(2);
      for (var j = 0; j < 200 && !q('.modal h2'); j++) { quiet(2); if (j % 10 === 0) await C.sleep(5); }
    }
  });
  shot({ id: 'morning', low: true, frames: 66,
    begin: async function () {
      var b = btn(/Next sol|Next day/); if (b) b.click();
      for (var j = 0; j < 200; j++) { quiet(2); var h = q('.modal h2'); if (h && !/Night report/.test(h.textContent)) break; if (j % 10 === 0) await C.sleep(5); }
    },
    end: function () { var b = btn(/Start the shift/); if (b) b.click(); quiet(30); }
  });

  // =====================================================================
  //  12 · THE LOOKOUT
  // =====================================================================
  shot({ id: 'lookout', frames: 105, rate: function (t) { return t < 0.4 ? 2 : 8; },
    begin: async function () {
      closeCards();
      var seat = Tn.boulders.filter(function (x) { return x.seat; })[0];
      stage({ envT: null }); F.envT = null; F.dust = 0;
      put(seat.x + seat.r + 0.9, seat.z); face(seat.x, seat.z);
      quiet(10);
      F.note.p = prompt(); press('KeyE');
      quiet(300);
      F.note.active = JA.observe && JA.observe.active();
    },
    end: function () { if (JA.observe && JA.observe.active()) { JA.observe.stand(); for (var i = 0; i < 400 && JA.observe.active(); i++) quiet(1); } F.note.after = G.mode; }
  });

  // =====================================================================
  //  13 · PIONEER MODE  ·  14 · THE TOWN
  // =====================================================================
  shot({ id: 'pioneer', frames: 120,
    begin: async function () {
      stage({ envT: 0.3 });
      var best = null, bd = 1e9;
      Tn.boulders.forEach(function (b) { if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.0 || b.r > 1.45) return; var d = Math.hypot(b.x + 20, b.z - 70); if (Math.hypot(b.x, b.z) > 45 && d < bd) { bd = d; best = b; } });
      if (!best) throw new Error('no boulder for Pioneer');
      var sd = norm2(0.97, 0.24);
      put(best.x + sd[0] * (best.r + 1.0), best.z + sd[1] * (best.r + 1.0)); face(best.x, best.z);
      sim.addMat(G.s, 'metal', 20); sim.addMat(G.s, 'glass', 20); sim.addMat(G.s, 'rock', 10);
      playCam(Math.atan2(sd[0], sd[1]) + 0.7, 0.3, 7.5);
      F.note.b = [best.x, best.z, best.r]; F.note.rocks0 = G.s.stats.rocks || 0; quiet(20);
    },
    frame: function (t) {
      hold(0.3);
      at(t, 0.15, 'h1', function () { press('KeyE'); });
      at(t, 0.75, 'h2', function () { press('KeyE'); });
      at(t, 1.35, 'h3', function () { press('KeyE'); });
      at(t, 2.0, 'menu', function () { JA.pioneer.menu(); });
      at(t, 3.0, 'pick', function () { click('#info-root [data-pio="turbine"]'); });
      at(t, 3.55, 'build', function () { press('KeyE'); });
    },
    end: function () { F.note.rocks = (G.s.stats.rocks || 0) - F.note.rocks0; F.note.built = JSON.stringify(G.s.built); }
  });
  shot({ id: 'town', frames: 105, rate: function () { return 10; },
    begin: async function () {
      closeCards(); stage({ envT: 0.35 }); F.dust = 0;
      var c = Tn.L.colony, s = G.s;
      F.note.a0 = Math.atan2(-c[0], -c[1]) - 0.35;
      put(c[0] + Math.sin(F.note.a0 + 0.9) * 60, c[1] + Math.cos(F.note.a0 + 0.9) * 60);
      K.setStage(2); s.colony.stage = 2; s.colony.people = 4; F.note.next = 3;
      quiet(10);
    },
    frame: function (t) {
      var n = F.note, s = G.s; hold(0.35);
      if (n.next <= 5 && t >= (n.next - 3) * 1.05 + 0.1) { K.setStage(n.next, { arrive: true }); n.landAt = t + 0.65; n.landing = n.next; n.next++; }
      if (n.landAt && t >= n.landAt) { s.colony.stage = n.landing; s.colony.people = R.townPeople[n.landing]; n.landAt = 0; }
      F.envT = 0.35 + t * 0.12;
    },
    cam: function (t) {
      var c = Tn.L.colony, u = t / 3.5, ang = F.note.a0 + lerp(0, 0.9, u), rad = lerp(46, 54, u), hgt = lerp(13, 22, u);
      var px = c[0] + Math.sin(ang) * rad, pz = c[1] + Math.cos(ang) * rad;
      cine(px, ground(px, pz) + hgt, pz, c[0], Tn.height(c[0], c[1]) + 3, c[1], 48);
    }
  });

  // =====================================================================
  //  15 · GOING HOME
  // =====================================================================
  shot({ id: 'launch', frames: 75, rate: function () { return 1.4; },
    begin: async function () {
      closeCards(); stage({ envT: 0.85 }); F.envT = null;
      var s = G.s; s.sol = s.totalSols; s.caseLoaded = true; s.air = 80; s.food = 80; s.dose = 10;
      if (K.stage() < 5) K.setStage(5);
      s.t = s.dayLength - 0.1;
      for (var i = 0; i < 40 && G.mode !== 'launch'; i++) quiet(2);
      for (var j = 0; j < 600 && G.launchT < 1.3; j++) quiet(1);
      F.bed = null;
    }
  });
  shot({ id: 'future', frames: 60,
    begin: async function () {
      for (var i = 0; i < 2000 && G.mode !== 'vision'; i++) { quiet(2); if (i % 30 === 0) await C.sleep(5); }
      for (var j = 0; j < 400 && K.visionTime() < 3.2; j++) quiet(2);
    }
  });
  shot({ id: 'results', frames: 90,
    begin: async function () {
      if (K.skipVision) K.skipVision();
      for (var i = 0; i < 400 && !(q('.modal h2') && G.mode === 'end'); i++) { quiet(2); if (i % 20 === 0) await C.sleep(5); }
      quiet(20); F.endAt = this.at + 1.0;
    }
  });

  // =====================================================================
  //  THE RECORDER'S INTERFACE
  // =====================================================================
  F.len = AT / FPS; F.endAt = 1e9;
  window.__film = {
    info: function () {
      var gl = W.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { fps: FPS, gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', shots: SHOTS.map(function (s) { return { id: s.id, frames: s.frames, world: 'game' }; }) };
    },
    begin: async function (id) {
      var s = byId[id];
      F.shot = s; F.t = 0; F.T = s.at; F.cam = null; F.done = {}; F.note = id === 'raging' || id === 'ice2' ? F.note : {};
      var ci = chapAt[id]; if (ci) F.chap = { from: s.at, to: chapEnd(id), n: ci[1] };
      if (ci) { chap.querySelector('i').textContent = ci[1]; chap.querySelector('b').textContent = ci[2]; chap.querySelector('span').textContent = ci[3]; }
      SND = []; SAMPLES = {};
      await s.begin.call(s);
      showGame(); F.cam = s.cam || null;
      return true;
    },
    frame: function (id, f, sub, subs) {
      var s = byId[id], t = (f + (sub || 0) / (subs || 1)) / FPS, i;
      F.t = t; F.T = s.at + t; F.fi = Math.round(s.at * FPS) + f; F.rate = s.rate ? s.rate(t) : 1;
      F.rec = true;
      if (s.frame) s.frame(t);
      var secs = F.rate / FPS / (subs || 1), n = Math.max(1, Math.ceil(secs * 1000 / TICK - 1e-6)), ms = secs * 1000 / n;
      for (i = 0; i < n; i++) { F.skip = i < n - 1; C.tick(ms); }
      F.skip = false; F.rec = false;
      sampleSound(); drawOverlay();
      return true;
    },
    finish: function (id) {
      var s = byId[id];
      if (s.end) s.end.call(s);
      F.cam = null;
      return JSON.stringify(F.note, function (k, v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : v && v.isVector3 ? undefined : v; }).slice(0, 400) + ' | mode ' + G.mode;
    },
    sound: function (id) { return { shot: id, events: SND, samples: SAMPLES }; },
    soundMeta: function () { return { meta: META, music: JA.MUSIC || {}, len: F.len, fps: FPS }; }
  };
  function chapEnd(id) { var i = SHOTS.indexOf(byId[id]), j; for (j = i + 1; j < SHOTS.length; j++) if (chapAt[SHOTS[j].id]) return SHOTS[j].at; return F.len; }
})();
