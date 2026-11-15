/* Astro Outpost film — the director. The recorder (record.js) puts this script into the running game.
   Every shot is the real game: a real mission is started through the real menus, the astronaut is moved
   with the same keys a player uses, and only the camera, the time of day and the words on top are staged.

   A shot is { id, secs, world, begin(), frame(t, f), cam(t), ui: [...], caps: [...] }:
     begin   sets the scene up (async: it may start a mission and let things settle)
     frame   is called before every film frame with the time since the shot began
     cam     places the camera, right after the game has moved everything for that frame
     ui      which of the game's own screen parts are shown (the rest are hidden)
     caps    the words on top: { a: start, b: end, cls, html } */
(function () {
  'use strict';
  var JA = window.JA, G = JA.game, W = JA.world, A = JA.actors, B = JA.base, Tn = JA.terrain, sim = JA.sim, K = JA.colony, C = window.__clock, T = window.THREE;
  var FPS = 30, STEP = 1000 / 60;
  var F = { t: 0, shot: null, envT: null, dust: null, cam: null, ui: {}, skip: false, note: {} };
  var V = new T.Vector3();
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(x) { return clamp(x, 0, 1); }
  function smooth(x) { x = sat(x); return x * x * (3 - 2 * x); }
  function easeOut(x) { x = sat(x); return 1 - Math.pow(1 - x, 3); }
  function span(t, a, b) { return sat((t - a) / (b - a)); }
  function pump(n) { for (var i = 0; i < (n || 1); i++) C.tick(STEP); }
  function key(code, up) { window.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { code: code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); }
  function press(code) { key(code); key(code, true); }
  function ground(x, z) { return A.groundAt ? A.groundAt(x, z) : Tn.height(x, z); }

  // ---- the game draws only when the film wants a picture, and the film owns the sky and the camera
  var realRender = W.renderer.render.bind(W.renderer);
  W.renderer.render = function (a, b) { if (!F.skip) realRender(a, b); };
  if (JA.fx && JA.fx.render) { var fxRender = JA.fx.render; JA.fx.render = function (r, s, c, dt) { return F.skip ? true : fxRender.call(JA.fx, r, s, c, dt); }; }
  if (JA.fx && JA.fx.setLevel) JA.fx.setLevel(2);          // full camera look, and it must not step down by itself
  var realUpdate = W.update;
  W.update = function (dt) {
    if (F.envT != null) W.env.t = F.envT;
    if (F.dust != null) W.env.dust = F.dust;
    if (F.cam) F.cam(F.t);
    realUpdate(dt);
  };
  function cine(px, py, pz, lx, ly, lz, fov, roll) {
    var c = W.cam; c.mode = 'cine';
    c.cine.pos.set(px, py, pz); c.cine.look.set(lx, ly, lz); c.cine.fov = fov || 52; c.cine.roll = roll || 0;
  }

  // ---- words and fades on top of the picture
  var css = document.createElement('style');
  css.textContent = [
    '#film{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;color:#fff;font-family:"Sora","Figtree","Lexend",sans-serif;}',
    '#film .cap{position:absolute;left:0;right:0;text-align:center;will-change:transform,opacity;}',
    '#film .big{bottom:11.5%;font-weight:800;font-size:58px;line-height:1.04;letter-spacing:.01em;text-transform:uppercase;text-shadow:0 3px 0 rgba(0,0,0,.28),0 10px 34px rgba(0,0,0,.55);}',
    '#film .big em{font-style:normal;color:#ffd23f;}',
    '#film .sub{bottom:6.2%;font-family:"Figtree","Sora",sans-serif;font-weight:700;font-size:19px;letter-spacing:.3em;text-transform:uppercase;color:#ffe9a8;text-shadow:0 2px 12px rgba(0,0,0,.75);}',
    '#film .tag{top:13.5%;font-family:"Figtree","Sora",sans-serif;font-weight:700;font-size:17px;letter-spacing:.42em;text-transform:uppercase;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.8);}',
    '#film .tag b{display:inline-block;padding:7px 18px 7px 22px;border-radius:99px;background:rgba(8,12,24,.55);border:1px solid rgba(255,255,255,.22);font-weight:700;}',
    '#film .title{top:9%;white-space:nowrap;font-weight:800;font-size:112px;line-height:.95;letter-spacing:.02em;text-transform:uppercase;text-shadow:0 4px 0 rgba(0,0,0,.25),0 0 60px rgba(255,170,70,.55),0 14px 50px rgba(0,0,0,.6);}',
    '#film .title i{font-style:normal;color:#ffd23f;}',
    '#film .under{top:28.5%;font-family:"Figtree","Sora",sans-serif;font-weight:700;font-size:24px;letter-spacing:.46em;text-transform:uppercase;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.85);}',
    '#film .line{font-family:"Figtree","Sora",sans-serif;font-weight:700;font-size:25px;letter-spacing:.06em;color:#e9eefc;text-shadow:0 2px 12px rgba(0,0,0,.85);}',
    '#film .small{bottom:4%;font-family:"Figtree",sans-serif;font-weight:700;font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.9);}',
    '#film .small b{display:inline-block;padding:7px 20px;border-radius:99px;background:rgba(6,9,20,.62);font-weight:700;}',
    '#film .count{top:9%;font-weight:800;font-size:92px;line-height:1;text-shadow:0 4px 0 rgba(0,0,0,.25),0 12px 40px rgba(0,0,0,.6);font-variant-numeric:tabular-nums;}',
    '#film .count small{display:block;margin-top:8px;font-family:"Figtree",sans-serif;font-weight:700;font-size:18px;letter-spacing:.44em;text-transform:uppercase;color:#ffe9a8;}',
    '#film .veil{position:absolute;inset:0;background:#000;opacity:0;}',
    '#film .flash{position:absolute;inset:0;background:#fff;opacity:0;}',
    '#film .shade{position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0));opacity:0;}',
    '#film .scrim{position:absolute;inset:0;background:radial-gradient(ellipse 75% 60% at 50% 34%,rgba(4,7,18,.72),rgba(4,7,18,.28) 70%,rgba(4,7,18,.12));opacity:0;}',
    '#film .side{left:auto;right:2.5%;top:27%;width:32.5%;text-align:left;font-weight:800;font-size:60px;line-height:1.06;text-transform:uppercase;text-shadow:0 3px 0 rgba(0,0,0,.3),0 10px 34px rgba(0,0,0,.6);}',
    '#film .side em{font-style:normal;color:#ffd23f;}',
    '#film .side small{display:block;margin-top:22px;font-family:"Figtree",sans-serif;font-weight:700;font-size:17px;line-height:1.5;letter-spacing:.2em;color:#bfe9ff;}',
    'body.film-holo #holo-root{place-items:center start;padding-left:3.5%;background:rgba(3,7,18,.62);}',
    'body.film-holo #holo-root .holo-panel{transform:scale(0.98);transform-origin:left center;}',
    '#film .bar{position:absolute;left:0;right:0;height:0;background:#000;}',
    '#cine-skip,#cine-line{display:none!important;}'
  ].join('\n');
  document.head.appendChild(css);
  var film = document.createElement('div'); film.id = 'film';
  film.innerHTML = '<div class="shade"></div><div class="scrim"></div><div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div><div class="veil"></div><div class="flash"></div>';
  document.body.appendChild(film);
  var shade = film.querySelector('.shade'), scrim = film.querySelector('.scrim'), veil = film.querySelector('.veil'), flash = film.querySelector('.flash'), bars = film.querySelectorAll('.bar'), capEls = [];

  function setCaps(s) {
    capEls.forEach(function (e) { e.remove(); }); capEls = [];
    (s.caps || []).forEach(function (c) {
      var e = document.createElement('div'); e.className = 'cap ' + c.cls; e.innerHTML = c.html; e.style.opacity = 0;
      if (c.style) e.style.cssText += ';' + c.style;
      film.insertBefore(e, veil); capEls.push(e);
    });
  }
  function drawOverlay(s, t) {
    var any = 0;
    (s.caps || []).forEach(function (c, i) {
      var e = capEls[i], inT = c.inT || 0.26, outT = c.outT == null ? 0.2 : c.outT;
      var a = span(t, c.a, c.a + inT) * (outT ? 1 - span(t, c.b - outT, c.b) : (t < c.b ? 1 : 0)), k = easeOut(span(t, c.a, c.a + inT));
      if (typeof c.html === 'function') e.innerHTML = c.html(t);
      e.style.opacity = a.toFixed(3);
      if (c.punch) e.style.transform = 'scale(' + (1 + (1 - k) * 0.22).toFixed(4) + ')';
      else if (c.wide) e.style.letterSpacing = lerp(c.wide[0], c.wide[1], smooth(span(t, c.a, c.b))).toFixed(4) + 'em';
      else e.style.transform = 'translateY(' + ((1 - k) * 16).toFixed(2) + 'px)';
      if (c.cls.indexOf('big') >= 0 || c.cls.indexOf('sub') >= 0) any = Math.max(any, a);
    });
    shade.style.opacity = (any * (s.shade == null ? 1 : s.shade)).toFixed(3);
    scrim.style.opacity = (s.scrim ? s.scrim(t) : 0).toFixed(3);
    var fin = s.fadeIn ? 1 - span(t, 0, s.fadeIn) : 0, fout = s.fadeOut ? span(t, s.secs - s.fadeOut, s.secs) : 0;
    veil.style.opacity = Math.max(fin, fout).toFixed(3);
    flash.style.opacity = (s.flash ? (1 - span(t, 0, s.flash)) * 0.9 : 0).toFixed(3);
    var bh = typeof s.bars === 'function' ? s.bars(t) : (s.bars || 0);
    bars[0].style.height = bars[1].style.height = (bh * 100).toFixed(2) + '%';
  }

  // ---- which of the game's own screen parts are on show
  var ALWAYS = { scene: 1, film: 1 };
  function applyUi() {
    var k = document.body.children, i, e;
    for (i = 0; i < k.length; i++) { e = k[i]; if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || ALWAYS[e.id]) continue; e.style.visibility = F.ui[e.id] ? '' : 'hidden'; }
  }
  function showOnly(ids) { F.ui = {}; (ids || []).forEach(function (i) { F.ui[i] = 1; }); applyUi(); }

  // ---- starting a real mission through the real menus
  async function mission(o) {
    if (G.mode === 'film') { G.mode = 'play'; if (A.astro.mode === 'hidden') A.astro.mode = 'walk'; beams(true); }
    if (JA.holo && JA.holo.isOpen && JA.holo.isOpen()) JA.holo.close();
    if (!(G.s && G.s.site.id === o.site && G.mode !== 'title' && G.mode !== 'end')) {
      $('btn-start').click(); pump(6);
      var pick = function (g, v) { var b = q('.modal button[data-g="' + g + '"][data-v="' + v + '"]'); if (!b) throw new Error('no choice ' + g + '=' + v); b.click(); pump(2); };
      pick('site', o.site); pick('level', o.level || 'veteran'); pick('sun', 'archive'); pick('pioneer', o.pioneer ? 'on' : 'off');
      q('.modal button[data-act="go"]').click();
      for (var i = 0; i < 800 && G.mode !== 'intro' && G.mode !== 'brief' && G.mode !== 'play'; i++) { pump(2); await C.sleep(8); }
    }
    if (!o.intro) await toPlay();
  }
  async function toPlay() {
    for (var i = 0; i < 900 && G.mode !== 'play'; i++) {
      if (G.mode === 'intro') JA.intro.skip();
      var b = Array.prototype.filter.call(document.querySelectorAll('.modal button.primary'), function (x) { return /Step outside/.test(x.textContent); })[0];
      if (b) b.click();
      pump(2); await C.sleep(4);
    }
    if (G.mode !== 'play') throw new Error('could not start playing (mode ' + G.mode + ')');
    pump(30);
    G.tips = G.tips || {};
  }
  // common starting state for a staged shot in play mode
  function stage(o) {
    var s = G.s, a = A.astro, r = A.rover;
    G.mode = 'play'; G.mini = null; G.sayQ.length = 0;
    if (r.driver) A.exitRover();
    if (a.carrying) { var it = a.carrying; A.setDown(); A.remove(it); }
    a.mode = 'walk'; a.vel.set(0, 0, 0); a.vy = 0;
    G.keys.up = G.keys.down = G.keys.left = G.keys.right = G.keys.shift = false;
    s.storm = null; s.glitch = null; W.env.storm = 0;
    s.air = o.air == null ? 74 : o.air; s.food = o.food == null ? 63 : o.food; s.dose = o.dose || 6; s.water = o.water == null ? 58 : o.water; s.filter = o.filter == null ? 81 : o.filter;
    s.t = s.dayLength * (o.day == null ? 0.3 : o.day);
    F.envT = o.envT == null ? null : o.envT; F.dust = o.dust == null ? 0 : o.dust;
    if (o.at) put(o.at[0], o.at[1], o.at[2]);
    document.querySelectorAll('#toasts > *').forEach(function (e) { e.remove(); });
  }
  function put(x, z, yaw) { var a = A.astro; a.pos.set(x, ground(x, z), z); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; if (yaw != null) a.yaw = yaw; }
  // walk the way a player does: the "up" key moves you away from the camera, so the camera heading is turned to the way we want to go
  function walk(dx, dz, sprint) { W.cam.yaw = Math.atan2(-dx, -dz); G.keys.up = true; G.keys.shift = !!sprint; }
  function halt() { G.keys.up = false; G.keys.shift = false; }
  function hold(freeze) { var s = G.s; if (s && freeze != null) s.t = freeze; }

  var SHOTS = [], byId = {};
  function shot(o) { SHOTS.push(o); byId[o.id] = o; }

  // =====================================================================
  //  1 · LANDING ON THE MOON (the game's own landing film, seen through the lander window)
  // =====================================================================
  shot({ id: 'landing', secs: 3.0, world: 'moon', note: 'the descent, three times faster, and the touchdown', fadeIn: 0.5, ui: ['cine'], shade: 0,
    caps: [{ a: 0.35, b: 2.75, cls: 'tag', html: '<b>The Moon · 384,400 km from home</b>', style: 'top:auto;bottom:7%' }],
    speed: function (t) { return t < 2.5 ? 6 : 2; },
    begin: async function () {
      await mission({ site: 'moon', level: 'veteran', intro: true });
      // the film touches down at 17.4 s: 2.5 s at triple speed, then normal speed, puts that 2.8 s into the shot
      F.skip = true;
      for (var i = 0; i < 4000 && JA.intro.time() < 17.4 - 2.5 * 3 - 0.3 && G.mode === 'intro'; i++) C.tick(STEP);
      F.skip = false;
      F.note.introAt = JA.intro.time();
    },
    frame: function () {},
    end: function () { F.note.introEnd = JA.intro.time(); }
  });

  // =====================================================================
  //  2 · TITLE (the Moon: the outpost, and Earth above it)
  // =====================================================================
  shot({ id: 'title', secs: 3.0, world: 'moon', note: 'low-gravity hop toward the outpost, Earth in the sky', flash: 0.35, ui: [], shade: 0,
    caps: [
      { a: 0.4, b: 3.0, cls: 'title', html: 'Astro <i>Outpost</i>', inT: 0.5, outT: 0, wide: [0.16, 0.02] },
      { a: 0.95, b: 3.0, cls: 'under', html: 'Junior Astronaut Mission Trainer', inT: 0.45, outT: 0 }
    ],
    begin: async function () {
      await mission({ site: 'moon', level: 'veteran' });
      stage({ at: [33, 40, 0], envT: 0.86 });
      var hx = -33, hz = -40, d = Math.hypot(hx, hz); F.note.dir = [hx / d, hz / d];
      A.astro.yaw = Math.atan2(hx, hz);
      pump(20);
    },
    frame: function (t, f) {
      var d = F.note.dir; hold(G.s.dayLength * 0.3);
      walk(d[0], d[1], false);
      if (f === 20 || f === 54) press('Space');
    },
    cam: function (t) {
      var a = A.astro.pos, d = F.note.dir, u = smooth(t / 3.0), rx = -d[1], rz = d[0];        // right of the walking direction
      var back = lerp(5.5, 12.5, u), side = lerp(3.4, 1.0, u), up = lerp(1.25, 4.6, u);
      cine(a.x - d[0] * back + rx * side, a.y + up, a.z - d[1] * back + rz * side,
        lerp(a.x + d[0] * 6, 4, u), lerp(a.y + 2.6, 19, u), lerp(a.z + d[1] * 6, -6, u), lerp(46, 42, u));
    }
  });

  // =====================================================================
  //  3 · MARS: MAKE AIR, FIND WATER, GROW FOOD (three quick cuts, the game's own screen showing)
  // =====================================================================
  var HUD = ['hud', 'toasts'];
  shot({ id: 'air', secs: 1.0, world: 'mars', note: 'a power cell goes into the Air Maker', ui: HUD, flash: 0.25,
    caps: [{ a: 0.02, b: 1.0, cls: 'tag', html: '<b>Mars · seven months from home</b>', inT: 0.2, outT: 0 }, { a: 0.3, b: 1.0, cls: 'big', html: 'Make <em>air</em>', punch: 1, inT: 0.16, outT: 0 }],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var so = B.spots.sockets.air;
      stage({ at: [so.x + 1.5, so.z + 3.2, 0], envT: 0.32, air: 38 });
      A.pick(A.spawn('cell', A.handPos(V), null, 'rest'));
      F.note.so = so; F.note.done = false;
      pump(6);
    },
    frame: function (t, f) {
      var so = F.note.so, a = A.astro.pos, dx = so.x - a.x, dz = so.z - a.z, d = Math.hypot(dx, dz);
      hold(G.s.dayLength * 0.3);
      if (!F.note.done && d > 1.25) walk(dx / d, dz / d); else halt();
      if (!F.note.done && A.astro.carrying && /plug|power|cell/i.test($('prompt-text').textContent) && !$('prompt').classList.contains('hidden') && f >= 8) { press('KeyE'); F.note.done = f; }
    },
    cam: function (t) {
      var so = F.note.so, m = B.pos.air, u = smooth(t / 1.0);
      cine(so.x + 6.4 - u * 0.8, 1.5 + u * 0.25, so.z + 5.6 - u * 0.6, lerp(so.x, m.x, 0.45), 2.5, lerp(so.z, m.z, 0.45), 40);
    }
  });

  shot({ id: 'ice', secs: 1.0, world: 'mars', note: 'the ice drill lifts a chunk', ui: HUD,
    caps: [{ a: 0.12, b: 1.0, cls: 'big', html: 'Find <em>water</em>', punch: 1, inT: 0.16, outT: 0 }],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var q0 = B.spots.ice[0];
      stage({ at: [q0.x + 2.6, q0.z + 1.6, 0], envT: 0.4, water: 22 });
      A.astro.yaw = Math.atan2(-2.6, -1.6);
      G.rigs.forEach(function (r) { r.state = 'idle'; r.p = 0; });
      A.items.slice().forEach(function (it) { if (it.type === 'ice') A.remove(it); });
      G.rigs[0].state = 'drill'; G.rigs[0].p = 0.45;
      F.note.q = q0;
      for (var i = 0; i < 400 && G.rigs[0].p < 0.955 && G.rigs[0].state === 'drill'; i++) pump(1);
    },
    frame: function () { hold(G.s.dayLength * 0.4); },
    cam: function (t) {
      var p = F.note.q, u = smooth(t / 1.0);
      cine(p.x - 3.4 + u * 0.5, p.y + 0.75, p.z + 4.6 - u * 0.4, p.x + 0.4, p.y + 1.7, p.z, 44);
    }
  });

  shot({ id: 'food', secs: 1.0, world: 'mars', note: 'a ripe crop is picked in the greenhouse', ui: HUD,
    caps: [{ a: 0.12, b: 1.0, cls: 'big', html: 'Grow <em>food</em>', punch: 1, inT: 0.16, outT: 0 }],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var bed = B.spots.beds[1];
      stage({ at: [bed.x, bed.z - 1.75, 0], envT: 0.5, food: 31 });
      G.s.m.food.beds.forEach(function (b, i) { b.state = i === 3 ? 'growing' : 'ripe'; b.g = i === 3 ? 0.55 : 1; b.crop = i % 2 ? 'potato' : 'lettuce'; });
      G.s.m.food.on = true;
      F.note.bed = bed; F.note.done = false;
      pump(20);
    },
    frame: function (t, f) {
      hold(G.s.dayLength * 0.5);
      if (!F.note.done && f >= 9 && !$('prompt').classList.contains('hidden')) { press('KeyE'); F.note.done = f; }
    },
    cam: function (t) {
      var b = F.note.bed, u = smooth(t / 1.0);
      cine(b.x - 3.7 + u * 0.5, 2.05, b.z - 3.5, b.x + 0.9, 1.2, b.z - 0.5, 52);
    }
  });

  // =====================================================================
  //  4 · THE ROVER: full speed, then a real crash (the cargo flies out, Mission Control explains why)
  // =====================================================================
  function clearRun(b, ax, az, len) {      // how bumpy, and how blocked, is a straight run of len metres that ends at boulder b
    var h0 = Tn.height(b.x, b.z), worst = 0, i, j, x, z, o;
    for (i = 3; i <= len; i += 3) {
      x = b.x - ax * i; z = b.z - az * i;
      worst = Math.max(worst, Math.abs(Tn.height(x, z) - h0));
      for (j = 0; j < Tn.boulders.length; j++) { o = Tn.boulders[j]; if (o !== b && Math.hypot(o.x - x, o.z - z) < o.r + 3.2) return 99; }
      if (Math.hypot(x, z) < 34 || Math.hypot(x - Tn.L.colony[0], z - Tn.L.colony[1]) < 56 || Math.hypot(x - Tn.L.rocket[0], z - Tn.L.rocket[1]) < 16) return 99;
    }
    return worst;
  }
  shot({ id: 'rover', secs: 3.0, world: 'mars', note: 'a fast drive that ends against a boulder, in slow motion', ui: ['hud'], flash: 0.2,
    caps: [{ a: 0.15, b: 1.5, cls: 'big', html: 'Real <em>physics</em>', punch: 1, inT: 0.16, outT: 0.1 }, { a: 2.0, b: 3.0, cls: 'big', html: 'Real <em>consequences</em>', punch: 1, inT: 0.16, outT: 0, style: 'bottom:auto;top:14%' }],
    speed: function () { var n = F.note; return n.slow ? 1 : 2; },
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.42 });
      var best = null, bs = 9, i, k, b, ax, az, sc, r = A.rover, len = 64;
      for (i = 0; i < Tn.boulders.length; i++) {
        b = Tn.boulders[i]; if (b.seat || b.r < 1.25 || b.r > 2.4 || Math.hypot(b.x, b.z) > 150) continue;
        for (k = 0; k < 12; k++) { ax = Math.sin(k / 12 * 6.283); az = Math.cos(k / 12 * 6.283); sc = clearRun(b, ax, az, len); if (sc < bs) { bs = sc; best = { b: b, ax: ax, az: az }; } }
      }
      if (!best) throw new Error('no boulder with a clear run');
      F.note.b = { x: best.b.x, z: best.b.z, r: best.b.r }; F.note.ax = best.ax; F.note.az = best.az; F.note.bump = bs;
      r.pos.set(best.b.x - best.ax * len, 0, best.b.z - best.az * len); r.pos.y = ground(r.pos.x, r.pos.z); r.yaw = Math.atan2(best.ax, best.az); r.speed = 0; r.vy = 0;
      G.s.m.rover.charge = 100; G.s.m.rover.stuck = false;
      A.roverSpot('door', A.astro.pos); A.enterRover();
      ['ice', 'crate', 'ice', 'cell'].forEach(function (type) { var it = A.spawn(type, V.set(r.pos.x, r.pos.y + 2, r.pos.z), type === 'crate' ? { name: 'Lettuce crate', crop: 'lettuce' } : null, 'rest'); A.toBed(it); });
      var crash = A.onCrash; F.note.crashAt = null;
      A.onCrash = function (into, hit, before) { if (F.note.crashAt == null) { F.note.crashAt = F.t; F.note.into = into; } if (crash) crash(into, hit, before); };
      F.restore = function () { A.onCrash = crash; };
      G.keys.up = true; F.skip = true;
      for (i = 0; i < 1500; i++) {      // run up until the boulder is 1.75 s away
        C.tick(STEP);
        var d = Math.hypot(r.pos.x - best.b.x, r.pos.z - best.b.z) - best.b.r - 1.5;
        if (d < Math.max(0.5, Math.abs(r.speed)) * 1.75) break;
      }
      F.skip = false; F.note.v = r.speed;
    },
    frame: function (t) {
      var n = F.note, r = A.rover, d = Math.hypot(r.pos.x - n.b.x, r.pos.z - n.b.z) - n.b.r - 1.5;
      G.keys.up = n.crashAt == null;
      n.slow = (n.crashAt == null && d < Math.abs(r.speed) * 0.16) || (n.crashAt != null && t - n.crashAt < 1.25);
      if (n.crashAt != null && !F.ui.radio) { F.ui.radio = 1; }
    },
    cam: function (t) {
      var n = F.note, r = A.rover.pos, fx = n.ax, fz = n.az, rx = fz, rz = -fx;
      if (t < 1.42) {      // racing beside it, low, a little ahead
        var u = t / 1.42;
        cine(r.x + fx * (8.5 - u * 2) + rx * (4.6 - u * 0.8), ground(r.x + fx * 8, r.z + fz * 8) + 1.05, r.z + fz * (8.5 - u * 2) + rz * (4.6 - u * 0.8), r.x + fx * 0.6, r.y + 1.25, r.z + fz * 0.6, 54);
      } else {             // waiting by the boulder
        var v = smooth((t - 1.42) / 1.58), gx = n.b.x - fx * (2.6 - v * 1.2) - rx * (8.6 - v * 1.2), gz = n.b.z - fz * (2.6 - v * 1.2) - rz * (8.6 - v * 1.2);
        cine(gx, ground(gx, gz) + 0.9 + v * 0.7, gz, n.b.x - fx * (3.4 - v * 0.9), Tn.height(n.b.x, n.b.z) + 1.4 + v * 1.0, n.b.z - fz * (3.4 - v * 0.9), 56 - v * 3);
      }
    },
    end: function () { if (F.restore) F.restore(); if (A.rover.driver) A.exitRover(); }
  });

  // =====================================================================
  //  5 · SOLAR STORM: a real storm from the NASA record, and a sprint for the airlock
  // =====================================================================
  shot({ id: 'storm', secs: 4.0, world: 'mars', note: 'the alarm, the pink rain of radiation, the run home', ui: ['hud', 'banner', 'storm-fx'], flash: 0.25,
    caps: [
      { a: 0.95, b: 4.0, cls: 'big', html: 'Real <em>solar storms</em>', punch: 1, inT: 0.18, outT: 0 },
      { a: 1.3, b: 4.0, cls: 'sub', html: function () { return F.note.line || 'from NASA DONKI space-weather data'; }, inT: 0.3, outT: 0 }
    ],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var d = B.spots.door;
      stage({ at: [d.x + 10, d.z + 34, 0], envT: 0.55, dose: 12 });
      var s = G.s, w = null, MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      (s.weather || []).forEach(function (x) { if (x && x.level > 0 && (!w || x.strength > w.strength)) w = x; });      // the strongest flare in this mission's record
      if (!w) throw new Error('this mission has no storm on record');
      var dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(w.date || '');
      F.note.w = w.cls + ' ' + w.date;
      F.note.line = 'NASA DONKI record · ' + w.cls + ' solar flare' + (dm ? ' · ' + (+dm[3]) + ' ' + MONTHS[+dm[2] - 1] + ' ' + dm[1] : '');
      s.storm = { start: s.t + 0.8, end: s.t + 90, level: w.level, cls: w.cls, warned: true, active: false, over: false, strength: w.strength * 3 * s.site.stormMult * s.level.stormScale };
      F.note.door = [d.x, d.z];
      walk(-10 / 35.4, -34 / 35.4, true); F.skip = true; pump(40); F.skip = false;
    },
    frame: function () {
      var n = F.note, a = A.astro.pos, dx = n.door[0] - a.x, dz = n.door[1] + 1.2 - a.z, d = Math.hypot(dx, dz);
      if (d > 1.5) walk(dx / d, dz / d, true); else halt();
    },
    cam: function (t) {
      var n = F.note, a = A.astro.pos, dx = n.door[0] - a.x, dz = n.door[1] - a.z, d = Math.hypot(dx, dz) || 1, fx = dx / d, fz = dz / d, rx = fz, rz = -fx;
      var u = smooth(t / 4.0), ahead = lerp(7.5, -6.5, u), side = lerp(2.2, 3.4, Math.sin(u * Math.PI)), cx = a.x + fx * ahead + rx * side, cz = a.z + fz * ahead + rz * side;
      cine(cx, ground(cx, cz) + lerp(0.85, 2.3, u), cz, a.x + fx * lerp(0, 5, u), a.y + lerp(1.9, 2.6, u), a.z + fz * lerp(0, 5, u), lerp(50, 44, u), Math.sin(t * 9) * 0.006);
    }
  });

  // =====================================================================
  //  6 · WHY? (the wrist-tablet hologram)
  // =====================================================================
  shot({ id: 'why', secs: 3.0, world: 'mars', note: 'a why-card, then the hologram that explains it', ui: ['holo-root'], flash: 0.2, shade: 0,
    caps: [{ a: 0.25, b: 3.0, cls: 'side', html: 'Every <em>“why?”</em><br>gets an<br>answer<small>15 holograms · an 80-page<br>Field Journal · real sources</small>', inT: 0.25, outT: 0 }],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var so = B.spots.sockets.air;
      stage({ at: [so.x + 2.2, so.z + 3.4, 0], envT: 0.36 });
      A.astro.yaw = Math.atan2(-2.2, -3.4);
      F.note.so = so;
      pump(10);
      document.body.classList.add('film-holo');
      F.note.opened = JA.holo.open('electrolysis', {});
      pump(8);
      F.note.kids = Array.prototype.map.call(document.body.children, function (e) { return e.id; }).filter(function (i) { return i && !/^(scene|film)$/.test(i); }).join(' ').slice(0, 300);
    },
    frame: function (t, f) { if (f === 32 || f === 60) { var nx = q('#holo-root .holo-next'); if (nx) nx.click(); } },
    cam: function (t) {
      var so = F.note.so, m = B.pos.air, u = smooth(t / 3.0);
      cine(so.x + 7.5 - u, 2.0, so.z + 7.2 - u * 0.6, lerp(so.x, m.x, 0.5), 2.6, lerp(so.z, m.z, 0.5), 42);
    },
    end: function () { JA.holo.close(); document.body.classList.remove('film-holo'); pump(4); }
  });

  // =====================================================================
  //  7 · PIONEER MODE: break a boulder, keep the pieces, build with them
  // =====================================================================
  shot({ id: 'pioneer', secs: 3.0, world: 'mars', note: 'two swings break a boulder; a wind turbine goes up', ui: ['hud', 'pio-chip', 'pio-ring', 'toasts'], flash: 0.2,
    caps: [{ a: 0.2, b: 3.0, cls: 'big', html: 'Break. Gather. <em>Build.</em>', punch: 1, inT: 0.16, outT: 0 }, { a: 0.5, b: 3.0, cls: 'sub', html: 'Pioneer mode', inT: 0.3, outT: 0 }],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.3 });
      var best = null, bd = 1e9, i, b, d;
      for (i = 0; i < Tn.boulders.length; i++) {      // a middle-sized boulder on open ground, away from the buildings
        b = Tn.boulders[i]; if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.25 || b.r > 1.6) continue;
        d = Math.hypot(b.x + 20, b.z - 70);
        if (Math.hypot(b.x, b.z) > 45 && Math.hypot(b.x - Tn.L.colony[0], b.z - Tn.L.colony[1]) > 60 && d < bd) { bd = d; best = b; }
      }
      if (!best) throw new Error('no boulder to break');
      var sun = 0.6, ax = Math.sin(sun), az = Math.cos(sun);
      put(best.x + ax * (best.r + 1.15), best.z + az * (best.r + 1.15), Math.atan2(-ax, -az));
      F.note.b = { x: best.x, z: best.z, r: best.r }; F.note.ax = ax; F.note.az = az;
      sim.addMat(G.s, 'rock', 30); sim.addMat(G.s, 'metal', 24); sim.addMat(G.s, 'glass', 24);
      pump(40);
      F.note.prompt = $('prompt-text').textContent;
    },
    frame: function (t, f) {
      var n = F.note;
      hold(G.s.dayLength * 0.3);
      if (f === 5 || f === 24 || f === 40) press('KeyE');
      if (f === 47) {                    // the workshop is opened and the turbine chosen between two frames
        n.menu = JA.pioneer.menu();
        var b = q('#info-root [data-pio="turbine"]'); n.btn = !!b; if (b) b.click();
      }
      if (f === 56) press('KeyE');
      n.built = JSON.stringify(G.s.built); n.mats = JSON.stringify(G.s.mats);
    },
    cam: function (t) {
      var n = F.note, b = n.b, a = A.astro.pos, rx = n.az, rz = -n.ax;
      if (t < 1.55) {
        var u = smooth(t / 1.55);
        cine(b.x + n.ax * (5.4 - u * 0.7) + rx * (3.9 - u * 0.5), Tn.height(b.x, b.z) + 1.0, b.z + n.az * (5.4 - u * 0.7) + rz * (3.9 - u * 0.5), b.x + n.ax * 0.9, Tn.height(b.x, b.z) + 1.15, b.z + n.az * 0.9, 46);
      } else {
        var v = smooth((t - 1.55) / 1.45);
        cine(a.x + n.ax * (7.4 - v) - rx * 4.6, a.y + 1.1 + v * 0.3, a.z + n.az * (7.4 - v) - rz * 4.6, a.x - n.ax * 2.6, a.y + 3.3 + v * 0.5, a.z - n.az * 2.6, 52);
      }
    }
  });

  // =====================================================================
  //  8 · THE CITY: days fly by, ships land, and the outpost grows from 4 people to 80
  // =====================================================================
  var POP = [0, 0, 4, 12, 30, 80], WORD = ['', '', 'First settlers', 'A village', 'A town', 'A city'];
  function cityCam(u) {      // one long crane move around the town, shared by the last two shots
    var c = Tn.L.colony, a0 = F.note.a0, ang = a0 + lerp(0, 1.5, u), e = smooth((u - 0.62) / 0.3);      // e: the end card's part of the move
    var rad = lerp(lerp(31, 52, smooth(u / 0.66)), 70, e), hgt = lerp(lerp(3.4, 23, smooth(u / 0.66)), 8.5, e);
    var px = c[0] + Math.sin(ang) * rad, pz = c[1] + Math.cos(ang) * rad;
    cine(px, ground(px, pz) + hgt, pz, c[0], Tn.height(c[0], c[1]) + lerp(lerp(4.2, 2.0, u), 19, e), c[1], lerp(52, 46, u));
  }
  function beams(on) {
    if (!F.beams) { F.beams = []; W.root.traverse(function (o) { var g = o.geometry, m = o.material; if (o.isMesh && g && g.type === 'CylinderGeometry' && g.parameters.height >= 12 && m && m.transparent && m.blending === T.AdditiveBlending) F.beams.push({ m: m, o: m.opacity }); }); }
    F.beams.forEach(function (b) { b.m.opacity = on ? b.o : 0; });
  }
  function cityStart() {
    beams(false);
    var c = Tn.L.colony, dx = -c[0], dz = -c[1], d = Math.hypot(dx, dz);
    F.note.a0 = Math.atan2(dx, dz) - 0.35;
    put(c[0] + Math.sin(F.note.a0 + 0.9) * 75, c[1] + Math.cos(F.note.a0 + 0.9) * 75, F.note.a0 + Math.PI);
    A.astro.mode = 'hidden';
    G.mode = 'film';                 // the mission clock rests; the town and the sky keep moving
  }
  shot({ id: 'city', secs: 5.0, world: 'mars', note: 'time-lapse: four ships, four stages, the sun crossing the sky', ui: [], flash: 0.25,
    caps: [
      { a: 0.2, b: 2.2, cls: 'big', html: 'Keep your outpost alive…', inT: 0.3, outT: 0.2 },
      { a: 2.4, b: 5.0, cls: 'big', html: '…and it grows into a <em>city</em>', inT: 0.3, outT: 0.25 },
      { a: 0.5, b: 5.0, cls: 'count', inT: 0.3, outT: 0.25, html: function (t) { var st = F.note.shown || 1; return (POP[st] || 0) + '<small>' + (st >= 2 ? WORD[st] + ' · people living beside your outpost' : 'A supply ship from Earth') + '</small>'; } }
    ],
    speed: function () { return 12; },
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.035 });
      K.setStage(1);
      cityStart();
      F.note.shown = 1; F.note.next = 2;
      F.skip = true; pump(20); F.skip = false;
    },
    frame: function (t) {
      var n = F.note, at = [0, 0, 0.05, 1.15, 2.25, 3.35];      // each ship touches down one second later
      if (n.next <= 5 && t >= at[n.next]) { K.setStage(n.next, { arrive: true }); n.land = t + 1.0; n.next++; }
      if (n.land != null && t >= n.land) { n.shown = n.next - 1; n.land = null; }
      F.envT = lerp(0.035, 0.84, Math.pow(t / 5.0, 0.8));
    },
    cam: function (t) { cityCam(t / 7.9); }
  });

  // =====================================================================
  //  9 · END CARD (the city at dusk)
  // =====================================================================
  shot({ id: 'end', secs: 2.9, world: 'mars', note: 'the city at dusk, the name, where to play', ui: [], fadeOut: 0.45, shade: 0,
    scrim: function (t) { return smooth(t / 0.7) * 0.55; },
    caps: [
      { a: 0.15, b: 2.9, cls: 'title', html: 'Astro <i>Outpost</i>', inT: 0.4, outT: 0, wide: [0.1, 0.02], style: 'top:12%' },
      { a: 0.5, b: 2.9, cls: 'under', html: 'Junior Astronaut Mission Trainer', inT: 0.4, outT: 0, style: 'top:31.5%' },
      { a: 0.85, b: 2.9, cls: 'line', html: 'The Moon and Mars &nbsp;·&nbsp; real NASA space-weather data &nbsp;·&nbsp; free in your browser', inT: 0.4, outT: 0, style: 'top:40.5%' },
      { a: 1.2, b: 2.9, cls: 'small', html: '<b>NASA Space Apps Challenge 2026 · Tunis &nbsp;·&nbsp; real in-game footage &nbsp;·&nbsp; AI-assisted</b>', inT: 0.4, outT: 0 }
    ],
    speed: function () { return 4; },
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.84 }); cityStart();
      if (K.stage() < 5 || K.busy()) K.setStage(5);
      F.skip = true; pump(10); F.skip = false;
    },
    frame: function (t) { F.envT = lerp(0.84, 0.975, smooth(t / 2.2)); },
    cam: function (t) { cityCam((5.0 + t) / 7.9); }
  });

  window.__film = {
    info: function () {
      var gl = W.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { fps: FPS, gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
        shots: SHOTS.map(function (s) { return { id: s.id, frames: Math.round(s.secs * FPS), world: s.world, note: s.note }; }) };
    },
    begin: async function (id) {
      var s = byId[id]; F.shot = s; F.t = 0; F.cam = null; F.envT = null; F.dust = null; F.note = {};
      W.cam.shake = 0;
      await s.begin();
      showOnly(s.ui); setCaps(s);
      F.cam = s.cam || null;
      return true;
    },
    frame: function (id, f) {
      var s = byId[id], t = f / FPS, n = s.speed ? s.speed(t) : 2, i;
      F.t = t;
      if (s.frame) s.frame(t, f);
      for (i = 0; i < n; i++) { F.skip = i < n - 1 && n > 2; C.tick(STEP); }
      F.skip = false;
      applyUi(); drawOverlay(s, t);
      return true;
    },
    finish: function (id) {
      var s = byId[id];
      if (s.end) s.end();
      halt(); F.cam = null;
      return JSON.stringify(F.note).slice(0, 600);
    },
    probe: function () { return { mode: G.mode, prompt: $('prompt-text').textContent, astro: [A.astro.pos.x, A.astro.pos.y, A.astro.pos.z], errors: C.errors.slice(0, 8) }; }
  };
})();
