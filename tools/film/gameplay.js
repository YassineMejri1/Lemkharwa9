/* Astro Outpost film — the 80-second gameplay film for judges. The recorder puts this script into the running
   game (node tools/film/record.js --film gameplay ...). Unlike the trailer (director.js), the game's own screen
   stays on: the meters, the radio, the prompts, the cards. Every phase of a mission is shown in the order a
   player meets it, with a small chapter label that says what it is.

   The sound is the game's own. While a shot is recorded, every sound effect, voice line, music change, machine
   hum and background bed the game asks for is written down with its film time and loudness (sound-<shot>.json);
   tools/film/gamesound.js mixes those files into the soundtrack, over a score made in code (score.js --plan)
   that follows the chapters. The film is on the Moon. */
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
  // [first shot, number, title, one line, the score's mood from here on]
  var CHAPTERS = [
    ['setup', 1, 'Mission setup', 'the Moon or Mars · 5, 8 or 10 days · the live Sun or May 2024 · classic or Pioneer', 'intro'],
    ['land1', 2, 'The landing', 'every mission opens with the descent to the Moon\'s south pole', 'land'],
    ['brief', 3, 'Your mission', 'keep the crew alive for 8 days on the Moon', 'build'],
    ['power', 4, 'Power is limited', 'the Sun charges a few cells a day: each one goes where you carry it', 'groove'],
    ['visor', 5, 'One-sixth gravity', 'every step is a bound · helmet view and the map', 'groove'],
    ['ice1', 6, 'Ice is treasure', 'dug from a crater that never sees the Sun · electricity splits it into oxygen', 'groove'],
    ['rover', 7, 'The rover', 'four things in the bed, a battery to watch · the ice crater is far', 'groove'],
    ['farm', 8, 'Food and shielding', 'lettuce or potatoes · soil bags block radiation', 'groove'],
    ['core', 9, 'Real science', 'rock cores, holograms and a Field Journal, all with NASA sources', 'groove'],
    ['warn', 10, 'Real solar storms', 'no air to stop them: the particle storms NASA measured near Earth', 'storm'],
    ['crisis', 11, 'No checklist', 'six crises from real missions: you decide, then live with it', 'storm'],
    ['night', 12, 'Night and morning', 'the numbers add up · a new idea every morning', 'calm'],
    ['lookout', 13, 'The lookout', 'sit down and look home: Earth, lit by the real Sun', 'calm'],
    ['pioneer', 14, 'Pioneer mode', 'break rocks, keep the pieces, build a Sun mirror', 'build'],
    ['town', 15, 'A town grows', 'good days bring ships: 4, 12, 30, then 80 people', 'groove'],
    ['launch', 16, 'Going home', 'launch day, then a look at what your outpost could become', 'finale']
  ];
  var chapAt = {}; CHAPTERS.forEach(function (c) { chapAt[c[0]] = c; });
  function drawOverlay() {
    var s = F.shot, c = F.chap, Tf = F.T;
    chap.classList.toggle('low', !!(s && s.low));
    if (c) {
      var k = easeOut(span(Tf, c.from, c.from + 0.22)), a = Math.min(1, k * 1.6) * (1 - span(Tf, c.to - 0.25, c.to));
      chap.style.opacity = a.toFixed(3); chap.style.transform = 'translateX(-50%) scale(' + (1.35 - 0.35 * k).toFixed(3) + ')';
    } else chap.style.opacity = 0;
    // a punch-in on every new chapter: the whole picture zooms in a touch and settles, with a short flash
    var p = c ? 1 - easeOut(span(Tf, c.from, c.from + 0.28)) : 0;
    document.documentElement.style.transform = p > 0.001 ? 'scale(' + (1 + 0.05 * p).toFixed(4) + ')' : '';
    document.documentElement.style.filter = p > 0.001 ? 'blur(' + (5 * p * p).toFixed(2) + 'px) brightness(' + (1 + 0.35 * p * p).toFixed(3) + ')' : '';
    endCard.style.opacity = (Tf >= F.endAt ? span(Tf, F.endAt, F.endAt + 0.4) : 0).toFixed(3);
    veil.style.opacity = Math.max(1 - span(Tf, 0, 0.4), span(Tf, F.len - 0.45, F.len)).toFixed(3);
  }

  // ---- the game's screen is on, except the touch controls
  function showGame() { Array.prototype.forEach.call(document.body.children, function (e) { if (e.style && e.id !== 'gfilm') e.style.visibility = ''; }); }

  // =====================================================================
  //  SHARED STAGING
  // =====================================================================
  function stage(o) {
    var s = G.s, a = A.astro, r = A.rover;
    o = o || {};
    if (G.pov) press('KeyV');
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
  function U() { return JA.ui || {}; }
  function closeCards() { if (U().closeModal && U().modalOpen && U().modalOpen()) U().closeModal(); var x = q('#info-root .modal [data-act="ok"], #info-root .modal .close'); if (x && x.offsetParent) x.click(); }
  function endMini() { G.eHeld = false; if (G.mini) { G.mini = null; if (Au) Au.stopLoop('drill'); if (U().drillUi) U().drillUi(null); if (A.astro.mode === 'busy') A.astro.mode = 'walk'; } }
  // a moving camera around a point (the astronaut by default): it circles and drifts in or out while it films
  function orbit(t, o) {
    var p = o.at ? o.at() : A.astro.pos, u = smooth(t / o.len), ang = o.a0 + o.spin * t, d = lerp(o.d0, o.d1, u), h = lerp(o.h0, o.h1, u);
    var cx = p.x + Math.sin(ang) * d, cz = p.z + Math.cos(ang) * d, cy = Math.max(ground(cx, cz) + 0.7, p.y + h);
    cine(cx, cy, cz, p.x, p.y + (o.look == null ? 1.2 : o.look), p.z, o.fov || 50);
  }
  function behind() { var a = A.astro; return Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw)); }

  var SHOTS = [], byId = {}, AT = 0;
  function shot(o) { o.at = AT / FPS; AT += o.frames; SHOTS.push(o); byId[o.id] = o; }

  // =====================================================================
  //  TITLE AND SETUP
  // =====================================================================
  shot({ id: 'title', frames: 60, begin: async function () { quiet(30); } });
  shot({ id: 'setup', low: true, frames: 120,
    begin: async function () { click('#btn-start'); quiet(10); },
    frame: function (t) {
      function pick(g, v) { var b = q('.modal button[data-g="' + g + '"][data-v="' + v + '"]'); if (b) { b.click(); b.scrollIntoView({ block: 'center' }); } }
      at(t, 0.35, 's1', function () { pick('site', 'moon'); });
      at(t, 0.9, 's2', function () { pick('level', 'commander'); });
      at(t, 1.45, 's3', function () { pick('shift', '300'); });
      at(t, 2.0, 's4', function () { pick('sun', 'archive'); });
      at(t, 2.55, 's5', function () { pick('pioneer', 'on'); });
      at(t, 3.25, 's6', function () { var g = q('.modal button[data-act="go"]'); if (g) g.scrollIntoView({ block: 'center' }); });
    },
    end: function () { click('.modal button[data-act="go"]'); }
  });

  // =====================================================================
  //  THE LANDING (the game's own film)  ·  THE BRIEFING
  // =====================================================================
  async function untilIntro(time) {
    for (var i = 0; i < 6000 && G.mode !== 'intro'; i++) { quiet(2); if (i % 20 === 0) await C.sleep(5); }
    F.skip = true; for (var j = 0; j < 8000 && JA.intro.time() < time && G.mode === 'intro'; j++) C.tick(TICK); F.skip = false;
  }
  shot({ id: 'land1', frames: 90, rate: function () { return 1.15; }, begin: async function () { await untilIntro(4.4); } });
  shot({ id: 'land2', frames: 60, rate: function () { return 1.15; }, begin: async function () { await untilIntro(17.35); } });
  shot({ id: 'brief', low: true, frames: 60,
    begin: async function () {
      if (G.mode === 'intro') JA.intro.skip();
      for (var i = 0; i < 400 && G.mode !== 'brief'; i++) { quiet(2); if (i % 10 === 0) await C.sleep(5); }
      quiet(20);
    },
    frame: function (t) { at(t, 1.25, 'out', function () { var b = btn(/Step outside/); if (b) b.click(); }); }
  });

  // =====================================================================
  //  POWER  ·  ONE-SIXTH GRAVITY
  // =====================================================================
  shot({ id: 'power', frames: 150,
    begin: async function () {
      for (var i = 0; i < 100 && G.mode !== 'play'; i++) quiet(2);
      var sp = B.spots, rack = sp.rack, so = sp.sockets.air;
      stage({ envT: 0.4, air: 52 });
      G.s.m.air.power = 0;
      put(rack.x + 0.2, rack.z + 1.5); face(rack.x, rack.z);
      F.note.so = so; quiet(10);
      F.note.a0 = Math.atan2(A.astro.pos.x - rack.x, A.astro.pos.z - rack.z) + 0.9;
    },
    frame: function (t) {
      var n = F.note;
      hold(0.4);
      at(t, 0.25, 'take', function () { n.p1 = prompt(); press('KeyE'); });
      if (t > 0.7 && !n.arrived) {
        n.arrived = walkTo(n.so.x + 0.5, n.so.z + 0.9, true, 0.9);
        if (n.arrived) { n.arrivedAt = t; face(n.so.x, n.so.z); }
      }
      at(t, 1.5, 'hop1', function () { press('Space'); });
      if (n.arrived) at(t, n.arrivedAt + 0.2, 'plug', function () { n.p2 = prompt(); press('KeyE'); });
    },
    cam: function (t) { orbit(t, { len: 5, a0: F.note.a0, spin: 0.22, d0: 7.5, d1: 6.5, h0: 2.0, h1: 3.2, look: 1.1, fov: 52 }); }
  });
  shot({ id: 'visor', frames: 75,
    begin: async function () {
      stage({ envT: 0.42 });
      var h = B.spots.door; put(h.x + 10, h.z + 44); face(h.x, h.z);
      playCam(0, 0.2, 7); quiet(4);
      press('KeyV'); quiet(20);
      F.note.dir = norm2(-10, -44);
    },
    frame: function (t) {
      var d = F.note.dir; walk(d[0], d[1], true);
      at(t, 0.25, 'j1', function () { press('Space'); });
      at(t, 1.25, 'j2', function () { press('Space'); });
    },
    end: function () { halt(); }
  });
  shot({ id: 'map', frames: 45,
    begin: async function () { if (G.pov) press('KeyV'); quiet(6); playCam(behind(), 0.42, 10); },
    frame: function (t) { var d = F.note.dir; walk(d[0], d[1], true); at(t, 0.05, 'map', function () { press('KeyM'); }); },
    end: function () { halt(); if (G.mapOpen) press('KeyM'); quiet(4); }
  });

  // =====================================================================
  //  ICE, AND A LONG MOON THROW
  // =====================================================================
  shot({ id: 'ice1', frames: 90, rate: function (t) { return t > 0.45 && t < 1.95 ? 4.4 : 1; },
    begin: async function () {
      var q0 = B.spots.ice[0];
      stage({ envT: 0.45 });
      A.items.slice().forEach(function (it) { if (it.type === 'ice' && it.state !== 'bed') A.remove(it); });
      G.rigs.forEach(function (r) { r.state = 'idle'; r.p = 0; });
      put(q0.x + 1.7, q0.z + 1.3); face(q0.x, q0.z);
      F.note.q = q0; quiet(8);
    },
    frame: function (t) {
      var n = F.note; hold(0.45);
      at(t, 0.2, 'drill', function () { n.p1 = prompt(); press('KeyE'); });
    },
    cam: function (t) { var q0 = F.note.q; orbit(t, { at: function () { return V.set(q0.x + 0.8, q0.y, q0.z + 0.6); }, len: 3, a0: 2.2, spin: 0.45, d0: 5.5, d1: 4.2, h0: 0.9, h1: 1.8, look: 1.3, fov: 50 }); }
  });
  // the throw: the arc is worked out with the game's own physics, then the key is held exactly that long
  var PTS = []; for (var pi = 0; pi < 60; pi++) PTS.push(new T.Vector3());
  shot({ id: 'throw', frames: 90,
    begin: async function () {
      var hp = B.spots.hoppers.air, s = G.s;
      stage({ envT: 0.47 });
      s.m.air.queue = 0; s.m.air.power = Math.max(s.m.air.power, 2);
      var dir = norm2(1, 1.25), D = 10.5;
      put(hp.x + dir[0] * D, hp.z + dir[1] * D); face(hp.x, hp.z); W.cam.yaw = Math.atan2(dir[0], dir[1]);
      A.pick(A.spawn('ice', A.handPos(V), null, 'rest'));
      quiet(4);
      var best = null, bd = 1e9, p, n, i, d;
      for (p = 0.05; p <= 1.0; p += 0.005) {
        n = A.trajectory(p, PTS);
        for (i = 0; i < n; i++) { d = PTS[i].distanceTo(hp); if (d < bd) { bd = d; best = p; } }
      }
      F.note.power = best; F.note.miss = +bd.toFixed(2); F.note.hp = hp; F.note.dir = dir;
      F.note.trick0 = s.stats.bestThrow || 0;
    },
    frame: function (t) {
      var n = F.note; hold(0.47);
      at(t, 0.3, 'aim', function () { G.fHeld = true; n.heldAt = G.clock; });
      // the game counts the hold in its own time: let go once that much game time has passed
      if (n.heldAt != null && !n.thrown && G.clock - n.heldAt >= n.power * 1.25 - 1 / 120) { G.fHeld = false; n.thrown = true; }
    },
    cam: function (t) {
      var hp = F.note.hp, d = F.note.dir, a = A.astro.pos, u = smooth(t / 3);
      var mx = lerp(a.x, hp.x, 0.45), mz = lerp(a.z, hp.z, 0.45), side = [d[1], -d[0]];
      cine(mx + side[0] * lerp(9, 8, u), lerp(2.2, 3.4, u), mz + side[1] * lerp(9, 8, u), lerp(a.x, hp.x, lerp(0.35, 0.75, u)), 2.6, lerp(a.z, hp.z, lerp(0.35, 0.75, u)), 52);
    },
    end: function () { F.note.best = G.s.stats.bestThrow; }
  });

  // =====================================================================
  //  THE ROVER (with a crash)
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
      b = Tn.boulders[i]; if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.6 || b.r > 2.6 || Math.hypot(b.x, b.z) > 150) continue;
      for (k = 0; k < 12; k++) { ax = Math.sin(k / 12 * 6.283); az = Math.cos(k / 12 * 6.283); sc = clear(b, ax, az, 40); if (sc < bs) { bs = sc; best = { b: b, ax: ax, az: az }; } }
    }
    return best;
  }
  function flatRun(len) {         // the flattest straight stretch of open ground near the outpost
    var best = null, bs = 1e9, x, z, k, i, ax, az, h0, worst, px, pz, j, o, blocked;
    for (x = -70; x <= 70; x += 7) for (z = -70; z <= 70; z += 7) {
      if (Math.hypot(x, z) < 30) continue;
      for (k = 0; k < 12; k++) {
        ax = Math.sin(k / 12 * 6.283); az = Math.cos(k / 12 * 6.283); h0 = Tn.height(x, z); worst = 0; blocked = false;
        for (i = 0; i <= len && !blocked; i += 2) {
          px = x + ax * i; pz = z + az * i;
          worst = Math.max(worst, Math.abs(Tn.height(px, pz) - h0), i ? Math.abs(Tn.height(px, pz) - Tn.height(px - ax * 2, pz - az * 2)) * 4 : 0);
          if (Math.hypot(px, pz) < 28 || Math.hypot(px - Tn.L.colony[0], pz - Tn.L.colony[1]) < 50 || Math.hypot(px - Tn.L.rocket[0], pz - Tn.L.rocket[1]) < 16) blocked = true;
          for (j = 0; j < Tn.boulders.length && !blocked; j++) { o = Tn.boulders[j]; if (o.mesh && o.mesh.visible && Math.hypot(o.x - px, o.z - pz) < o.r + 3) blocked = true; }
        }
        if (!blocked && worst < bs) { bs = worst; best = { x: x, z: z, ax: ax, az: az, bump: worst }; }
      }
    }
    return best;
  }
  shot({ id: 'rover', frames: 120,
    begin: async function () {
      stage({ envT: 0.5 });
      var run = flatRun(26); if (!run) throw new Error('no flat run for the rover');
      var r = A.rover, b = { x: run.x + run.ax * 30, z: run.z + run.az * 30, r: 0 };
      A.items.slice().forEach(function (it) { if (it.state === 'bed') A.remove(it); });
      r.pos.set(run.x, 0, run.z); r.pos.y = ground(r.pos.x, r.pos.z); r.yaw = Math.atan2(run.ax, run.az); r.speed = 0; r.vy = 0;
      G.s.m.rover.charge = 100; G.s.m.rover.stuck = false;
      A.roverSpot('door', A.astro.pos); A.enterRover();
      ['ice', 'ice', 'crate'].forEach(function (type) { A.toBed(A.spawn(type, V.set(r.pos.x, r.pos.y + 2, r.pos.z), type === 'crate' ? { name: 'Lettuce crate', crop: 'lettuce' } : null, 'rest')); });
      W.cam.yaw = Math.atan2(-run.ax, -run.az);
      F.note.run = { ax: run.ax, az: run.az, bump: +run.bump.toFixed(2) }; F.note.c0 = G.s.stats.crashes || 0; F.note.vmax = 0; G.keys.up = true; playCam(Math.atan2(-run.ax, -run.az) + 0.5, 0.26, 9);
      for (var i = 0; i < 60; i++) { G.keys.up = Math.abs(r.speed) < 5; quiet(1); }
    },
    frame: function (t) { var r = A.rover; hold(0.5); W.cam.yaw = Math.atan2(-F.note.run.ax, -F.note.run.az) + lerp(0.5, 1.1, t / 4); W.cam.pitch = 0.26; G.keys.up = Math.abs(r.speed) < 5; F.note.vmax = Math.max(F.note.vmax, Math.abs(r.speed)); F.note.air = Math.max(F.note.air || 0, +(r.pos.y - ground(r.pos.x, r.pos.z)).toFixed(2)); },
    end: function () { F.note.crashes = (G.s.stats.crashes || 0) - F.note.c0; halt(); if (A.rover.driver) A.exitRover(); A.rover.speed = 0; }
  });

  // =====================================================================
  //  FOOD AND SHIELDING
  // =====================================================================
  shot({ id: 'farm', frames: 60,
    begin: async function () {
      var bed = B.spots.beds[1];
      stage({ envT: 0.52, food: 40 });
      G.s.m.food.beds.forEach(function (b, i) { b.state = i === 3 ? 'growing' : 'ripe'; b.g = i === 3 ? 0.55 : 1; b.crop = i % 2 ? 'potato' : 'lettuce'; });
      G.s.m.food.on = true;
      put(bed.x, bed.z - 1.75); face(bed.x, bed.z);
      F.note.bed = bed; playCam(0.45, 0.42, 7.5); quiet(10);
    },
    frame: function (t) { hold(0.52); W.cam.yaw = 0.45 + t * 0.12; at(t, 0.25, 'pick', function () { F.note.p = prompt(); press('KeyE'); }); },
  });
  shot({ id: 'shield', frames: 75,
    begin: async function () {
      stage({ envT: 0.54 });
      G.s.bags = Math.min(G.s.bags || 0, 4); F.note.bags0 = G.s.bags;
      put(-7, 11); face(0, 0); W.cam.yaw = Math.atan2(-7, 11);
      A.pick(A.spawn('bag', A.handPos(V), { name: 'soil bag' }, 'rest'));
      quiet(4);
      var dome = B.spots.hoppers.dome, best = 0.5, bd = 1e9, p;
      for (p = 0.05; p <= 1.0; p += 0.01) { A.trajectory(p, PTS); var d = Math.hypot(A.landing.x - dome.x, A.landing.z - dome.z); if (d < bd) { bd = d; best = p; } }
      F.note.power = best;
    },
    frame: function (t) {
      var n = F.note; hold(0.54);
      at(t, 0.15, 'aim', function () { G.fHeld = true; n.heldAt = G.clock; });
      if (n.heldAt != null && !n.thrown && G.clock - n.heldAt >= n.power * 1.25 - 1 / 120) { G.fHeld = false; n.thrown = true; }
    },
    cam: function (t) { orbit(t, { len: 2.5, a0: Math.atan2(-7, 11) + 0.5, spin: 0.3, d0: 5, d1: 6.5, h0: 1.2, h1: 2.6, look: 2.2, fov: 54 }); },
    end: function () { F.note.bags = G.s.bags - F.note.bags0; G.fHeld = false; }
  });

  // =====================================================================
  //  SCIENCE
  // =====================================================================
  shot({ id: 'core', frames: 60,
    begin: async function () {
      stage({ envT: 0.56 });
      var d = B.spots.drill[0];
      put(d.x + 1.2, d.z + 1.0); face(d.x, d.z);
      F.note.d = d; quiet(10);
    },
    frame: function (t) { hold(0.56); at(t, 0.15, 'drill', function () { F.note.p = prompt(); press('KeyE'); }); if (t > 0.4) G.eHeld = true; },
    cam: function (t) { orbit(t, { len: 2, a0: Math.atan2(1.2, 1.0) + 1.2, spin: 0.4, d0: 4.6, d1: 3.8, h0: 1.6, h1: 1.2, look: 1.0, fov: 50 }); }
  });
  shot({ id: 'holo', low: true, frames: 60,
    begin: async function () { endMini(); stage({ envT: 0.56 }); playCam(behind() + 0.5, 0.3, 7); quiet(4); },
    frame: function (t) {
      at(t, 0.05, 'open', function () { if (JA.holo) JA.holo.open('electrolysis', {}); });
      at(t, 1.0, 'next', function () { click('#holo-root .holo-next'); });
    },
    end: function () { if (JA.holo && JA.holo.isOpen()) JA.holo.close(); }
  });
  shot({ id: 'journal', low: true, frames: 45,
    begin: async function () { quiet(4); },
    frame: function (t) { at(t, 0.03, 'open', function () { press('KeyJ'); }); },
    end: function () { press('Escape'); closeCards(); quiet(6); if (U().modalOpen && U().modalOpen()) { press('KeyJ'); quiet(6); } F.note.open = !!(U().modalOpen && U().modalOpen()); }
  });

  // =====================================================================
  //  A REAL SOLAR STORM
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
      stage({ envT: 0.6, calm: true });
      put(d.x + 7, d.z + 19); face(d.x, d.z);
      G.s.t = G.s.dayLength * 0.6; G.tutStep = Math.max(G.tutStep || 0, 9); G.lastWarn = 99; G.s.m.comms.on = true;      // the Radio Dish is powered: Earth warns early
      F.note.door = [d.x, d.z]; quiet(4);
    },
    frame: function (t) { var n = F.note; at(t, 0.05, 'storm', function () { setStorm(9.4); }); if (t > 0.7) walkTo(n.door[0], n.door[1] + 1.4, true, 1.0); at(t, 1.4, 'hop', function () { press('Space'); }); },
    cam: function (t) {
      var n = F.note, a = A.astro.pos, f = norm2(n.door[0] - a.x, n.door[1] - a.z), lead = lerp(7, 4.5, t / 2.5), cx = a.x + f[0] * lead - f[1] * 1.2, cz = a.z + f[1] * lead + f[0] * 1.2;
      cine(cx, ground(cx, cz) + 0.9, cz, a.x, a.y + 1.4, a.z, 54);
    }
  });
  shot({ id: 'raging', frames: 60,
    begin: async function () { var s = G.s; if (s.storm) { s.storm.start = s.t - 0.1; } quiet(24); },
    frame: function () { var n = F.note; walkTo(n.door[0], n.door[1] + 1.2, true, 1.0); },
    cam: function (t) {
      var n = F.note, a = A.astro.pos, f = norm2(n.door[0] - a.x, n.door[1] - a.z), rx = f[1], rz = -f[0];
      var cx = a.x + rx * 4.4 - f[0] * 1.5, cz = a.z + rz * 4.4 - f[1] * 1.5;
      cine(cx, ground(cx, cz) + 1.3, cz, a.x + f[0] * 3, a.y + 1.6, a.z + f[1] * 3, 52);
    },
    end: function () { halt(); }
  });
  shot({ id: 'inside', frames: 60,
    begin: async function () { endMini(); var d = B.spots.door; put(d.x, d.z + 1.2); face(d.x, d.z); playCam(0, 0.3, 6); quiet(6); F.note.p = prompt(); },
    frame: function (t) { at(t, 0.05, 'door', function () { press('KeyE'); }); },
    end: function () { F.note.mode = G.mode; }
  });
  shot({ id: 'sunwatch', low: true, frames: 60,
    begin: async function () { quiet(2); },
    frame: function (t) { at(t, 0.03, 'open', function () { if (JA.sunwatch) JA.sunwatch.open(G.s, G.weather); }); },
    end: function () { press('Escape'); closeCards(); quiet(6); F.note.open = !!(U().modalOpen && U().modalOpen()); }
  });

  // =====================================================================
  //  A CRISIS  ·  NIGHT AND MORNING
  // =====================================================================
  shot({ id: 'crisis', low: true, frames: 105,
    begin: async function () {
      closeCards();
      var s = G.s; s.storm = null; W.env.storm = 0;
      if (G.mode === 'inside') { var o = $('btn-out'); if (o) o.click(); quiet(20); }
      stage({ envT: 0.65 }); put(4, 16);
      playCam(0.4, 0.3, 9);
      s.crisis = { id: 'co2', at: s.t + 0.2, until: s.t + 200, state: 'pending' };
      quiet(2);
    },
    frame: function (t) { at(t, 2.2, 'pick', function () { var b = q('.modal button[data-act="pick"][data-v="build"]') || q('.modal button[data-act="pick"]'); if (b) b.click(); }); },
    end: function () { var b = btn(/Carry on/); if (b) b.click(); quiet(6); }
  });
  shot({ id: 'night', low: true, frames: 60,
    begin: async function () {
      var s = G.s; closeCards();
      s.air = Math.max(s.air, 70); s.food = Math.max(s.food, 60); s.today.airMade = Math.max(s.today.airMade, 50); s.today.crates = Math.max(s.today.crates, 1);
      s.t = s.dayLength - 0.1;
      for (var i = 0; i < 30 && G.mode !== 'night'; i++) quiet(2);
      for (var j = 0; j < 200 && !q('.modal h2'); j++) { quiet(2); if (j % 10 === 0) await C.sleep(5); }
    }
  });
  shot({ id: 'morning', low: true, frames: 60,
    begin: async function () {
      var b = btn(/Next sol|Next day/); if (b) b.click();
      for (var j = 0; j < 200; j++) { quiet(2); var h = q('.modal h2'); if (h && !/Night report/.test(h.textContent)) break; if (j % 10 === 0) await C.sleep(5); }
    },
    end: function () { var b = btn(/Start the shift/); if (b) b.click(); quiet(30); }
  });

  // =====================================================================
  //  THE LOOKOUT
  // =====================================================================
  shot({ id: 'lookout', frames: 135, rate: function () { return 1.6; },
    begin: async function () {
      closeCards();
      var seat = Tn.boulders.filter(function (x) { return x.seat; })[0];
      stage({ envT: null }); F.envT = null;
      put(seat.x + seat.r + 0.9, seat.z); face(seat.x, seat.z);
      quiet(10);
      F.note.p = prompt(); press('KeyE');
      quiet(330);
      F.note.active = JA.observe && JA.observe.active();
    },
    end: function () { if (JA.observe && JA.observe.active()) { JA.observe.stand(); for (var i = 0; i < 400 && JA.observe.active(); i++) quiet(1); } F.note.after = G.mode; }
  });

  // =====================================================================
  //  PIONEER MODE  ·  THE TOWN
  // =====================================================================
  shot({ id: 'pioneer', frames: 135,
    begin: async function () {
      stage({ envT: 0.3 });
      var best = null, bd = 1e9;
      Tn.boulders.forEach(function (b) { if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.0 || b.r > 1.45) return; var d = Math.hypot(b.x + 20, b.z - 70); if (Math.hypot(b.x, b.z) > 45 && d < bd) { bd = d; best = b; } });
      if (!best) throw new Error('no boulder for Pioneer');
      var sd = norm2(0.97, 0.24);
      put(best.x + sd[0] * (best.r + 1.0), best.z + sd[1] * (best.r + 1.0)); face(best.x, best.z);
      sim.addMat(G.s, 'metal', 20); sim.addMat(G.s, 'glass', 20); sim.addMat(G.s, 'rock', 10);
      W.cam.yaw = Math.atan2(sd[0], sd[1]);
      F.note.b = [best.x, best.z, best.r]; F.note.rocks0 = G.s.stats.rocks || 0; F.note.a0 = Math.atan2(sd[0], sd[1]) + 0.9; quiet(20);
    },
    frame: function (t) {
      hold(0.3);
      at(t, 0.1, 'h1', function () { press('KeyE'); });
      at(t, 0.65, 'h2', function () { press('KeyE'); });
      at(t, 1.2, 'h3', function () { press('KeyE'); });
      at(t, 1.8, 'menu', function () { JA.pioneer.menu(); });
      at(t, 2.75, 'pick', function () { click('#info-root [data-pio="mirror"]'); });
      at(t, 3.3, 'build', function () { press('KeyE'); });
    },
    cam: function (t) { orbit(t, { len: 4.5, a0: F.note.a0, spin: 0.25, d0: 6, d1: 8.5, h0: 1.4, h1: 3.2, look: 1.6, fov: 52 }); },
    end: function () { F.note.rocks = (G.s.stats.rocks || 0) - F.note.rocks0; F.note.built = JSON.stringify(G.s.built); }
  });
  shot({ id: 'town', frames: 120, rate: function () { return 10; },
    begin: async function () {
      closeCards(); stage({ envT: 0.35 });
      var c = Tn.L.colony, s = G.s;
      F.note.a0 = Math.atan2(-c[0], -c[1]) - 0.35;
      put(c[0] + Math.sin(F.note.a0 + 0.9) * 60, c[1] + Math.cos(F.note.a0 + 0.9) * 60);
      K.setStage(2); s.colony.stage = 2; s.colony.people = 4; F.note.next = 3;
      quiet(10);
    },
    frame: function (t) {
      var n = F.note, s = G.s; hold(0.35);
      if (n.next <= 5 && t >= (n.next - 3) * 1.1 + 0.1) { K.setStage(n.next, { arrive: true }); n.landAt = t + 0.65; n.landing = n.next; n.next++; }
      if (n.landAt && t >= n.landAt) { s.colony.stage = n.landing; s.colony.people = R.townPeople[n.landing]; n.landAt = 0; }
    },
    cam: function (t) {
      var c = Tn.L.colony, u = t / 4, ang = F.note.a0 + lerp(0, 1.1, u), rad = lerp(44, 54, u), hgt = lerp(10, 22, u);
      var px = c[0] + Math.sin(ang) * rad, pz = c[1] + Math.cos(ang) * rad;
      cine(px, ground(px, pz) + hgt, pz, c[0], Tn.height(c[0], c[1]) + 3, c[1], 48);
    }
  });

  // =====================================================================
  //  GOING HOME
  // =====================================================================
  shot({ id: 'launch', frames: 75, rate: function () { return 1.4; },
    begin: async function () {
      closeCards(); stage({ envT: 0.85 }); F.envT = null;
      var s = G.s; s.sol = s.totalSols; s.caseLoaded = true; s.air = 80; s.food = 80; s.dose = 10;
      if (K.stage() < 5) K.setStage(5);
      s.t = s.dayLength - 0.1;
      for (var i = 0; i < 40 && G.mode !== 'launch'; i++) quiet(2);
      for (var j = 0; j < 600 && G.launchT < 1.3; j++) quiet(1);
    }
  });
  shot({ id: 'future', frames: 60,
    begin: async function () {
      for (var i = 0; i < 2000 && G.mode !== 'vision'; i++) { quiet(2); if (i % 30 === 0) await C.sleep(5); }
      for (var j = 0; j < 400 && K.visionTime() < 3.2; j++) quiet(2);
    }
  });
  shot({ id: 'results', frames: 105,
    begin: async function () {
      if (K.skipVision) K.skipVision();
      for (var i = 0; i < 400 && !(q('.modal h2') && G.mode === 'end'); i++) { quiet(2); if (i % 20 === 0) await C.sleep(5); }
      quiet(20); F.endAt = this.at + 1.0;
    }
  });
  function playCam(yaw, pitch, dist) { var c = W.cam; c.mode = 'play'; c.focus = A.focus; if (yaw != null) c.yaw = yaw; if (pitch != null) c.pitch = pitch; if (dist != null) { c.dist = dist; G.zoom = dist; } }

  // =====================================================================
  //  THE RECORDER'S INTERFACE
  // =====================================================================
  F.len = AT / FPS; F.endAt = 1e9;
  function chapEnd(id) { var i = SHOTS.indexOf(byId[id]), j; for (j = i + 1; j < SHOTS.length; j++) if (chapAt[SHOTS[j].id]) return SHOTS[j].at; return F.len; }
  window.__film = {
    info: function () {
      var gl = W.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { fps: FPS, gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', shots: SHOTS.map(function (s) { return { id: s.id, frames: s.frames, world: 'game' }; }) };
    },
    begin: async function (id) {
      var s = byId[id];
      F.shot = s; F.t = 0; F.T = s.at; F.cam = null; F.done = {}; F.note = id === 'raging' || id === 'map' ? F.note : {}; F.dust = null;
      var ci = chapAt[id]; if (ci) { F.chap = { from: s.at, to: chapEnd(id), n: ci[1] }; chap.querySelector('i').textContent = ci[1]; chap.querySelector('b').textContent = ci[2]; chap.querySelector('span').textContent = ci[3]; }
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
    // the score (score.js --plan) follows the chapters: their start times and the mood of each
    soundMeta: function () {
      var sections = [{ at: 0, mood: 'intro' }];
      CHAPTERS.forEach(function (c) { if (byId[c[0]]) sections.push({ at: byId[c[0]].at, mood: c[4] }); });
      sections.push({ at: byId.results.at + 1.0, mood: 'end' });
      return { meta: META, music: JA.MUSIC || {}, len: F.len, fps: FPS, plan: { len: F.len, sections: sections } };
    }
  };
})();
