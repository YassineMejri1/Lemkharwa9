/* Astro Outpost film — the director. The recorder (record.js) puts this script into the running game.
   Every shot is the real game: a real mission is started through the real menus, the astronaut is moved
   with the keys a player uses, and things happen through the game's own rules. What is staged: the camera,
   the time of day, where each shot starts, a little extra rocket smoke, and the words on top.

   The cut follows the score (score.js, 120 beats a minute): every shot starts on a beat, and the big hits
   (4, 8, 12, 13, 15.5, 24 and 26 seconds) are the same in both files. Change one, change the other.

   A shot is { id, frames, world, rate(t), begin(), frame(t), cam(t), ui, hand, shake(t) }:
     frames  how long it is, in film frames (30 a second)
     rate    game seconds per film second (1 = real time, 0.35 = slow motion, 12 = time-lapse)
     begin   sets the scene up (async: it may start a mission and let things settle off camera)
     frame   is called before every picture with the time since the shot began
     cam     places the camera, right after the game has moved everything
     ui      which of the game's own screen parts are shown (normally none)
     hand    how much the camera shakes in the hand, in metres */
(function () {
  'use strict';
  var JA = window.JA, G = JA.game, W = JA.world, A = JA.actors, B = JA.base, Tn = JA.terrain, sim = JA.sim, K = JA.colony, C = window.__clock, T = window.THREE, R = JA.RULES;
  var FPS = 30, TICK = 1000 / 60, LEN = 29.9;
  var F = { t: 0, T: 0, prevT: -1, shot: null, envT: null, dust: null, cam: null, ui: {}, skip: false, note: {}, hand: 0, shakeMul: null, done: {} };
  var V = new T.Vector3(), V2 = new T.Vector3();
  function $(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(x) { return clamp(x, 0, 1); }
  function smooth(x) { x = sat(x); return x * x * (3 - 2 * x); }
  function easeOut(x) { x = sat(x); return 1 - Math.pow(1 - x, 3); }
  function span(t, a, b) { return sat((t - a) / (b - a)); }
  function pump(n) { for (var i = 0; i < (n || 1); i++) C.tick(TICK); }
  function quiet(n) { F.skip = true; pump(n); F.skip = false; }          // let time pass without drawing
  function key(code, up) { window.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { code: code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true })); }
  function press(code) { key(code); key(code, true); }
  function once(name, fn) { if (!F.done[name]) { F.done[name] = true; fn(); } }
  function ground(x, z) { return A.groundAt ? A.groundAt(x, z) : Tn.height(x, z); }
  function norm2(x, z) { var d = Math.hypot(x, z) || 1; return [x / d, z / d]; }

  // ---- the game draws only when the film wants a picture, and the film owns the sky and the camera
  var realRender = W.renderer.render.bind(W.renderer);
  W.renderer.render = function (a, b) { if (F.skip) return; applyLook(); realRender(a, b); };
  // fewer smoke puffs where the film asks for it (the launch would otherwise fill the screen)
  var realEmit = W.emit;
  W.emit = function () { if (F.emitKeep != null && Math.random() > F.emitKeep) return; return realEmit.apply(W, arguments); };

  // ---- the film's own light. The game sets its sky every frame; just before the picture is drawn the film
  //      deepens it: a crisp, low sunrise for the day shots, and a real dark night with stars for the ending.
  var LK = { root: null }, C1 = new T.Color();
  var GOLD = { sun: 1.3, hemi: 0.72, fogD: 0.0013, glow: 1.25 };
  var NIGHT = { sun: 0.22, sunColor: 0x9ab4ff, hemi: 0.42, hemiSky: 0x33446c, hemiGround: 0x18130f, zenith: 0x010309, horizon: 0x0a1530, fog: 0x08101f, fogD: 0.0028, stars: 1, glow: 0.1, sunSprite: 0 };
  function findLook() {
    if (LK.root === W.root) return LK;
    LK = { root: W.root, sun: null, hemi: null, sky: null, stars: [] };
    W.root.traverse(function (o) {
      if (o.isDirectionalLight && o.castShadow && !LK.sun) LK.sun = o;
      else if (o.isHemisphereLight && !LK.hemi) LK.hemi = o;
      else if (o.isMesh && o.material && o.material.uniforms && o.material.uniforms.uZenith) LK.sky = o.material.uniforms;
      else if (o.isPoints && o.material && o.material.sizeAttenuation === false) LK.stars.push(o.material);
    });
    return LK;
  }
  function mixNum(a, b, w) { return a + (b - a) * w; }
  function applyLook() {
    var k = F.look, w; if (!k || F.lookDone) return; F.lookDone = true;
    var L = findLook(); w = k.mix == null ? 1 : k.mix; var cw = k.colorMix == null ? w : k.colorMix;
    if (L.sun) { if (k.sun != null) L.sun.intensity *= mixNum(1, k.sun, w); if (k.sunColor) L.sun.color.lerp(C1.set(k.sunColor), cw); }
    if (L.hemi) { if (k.hemi != null) L.hemi.intensity *= mixNum(1, k.hemi, w); if (k.hemiSky) { L.hemi.color.lerp(C1.set(k.hemiSky), cw); L.hemi.groundColor.lerp(C1.set(k.hemiGround), cw); } }
    if (L.sky) { if (k.zenith) L.sky.uZenith.value.lerp(C1.set(k.zenith), cw); if (k.horizon) L.sky.uHorizon.value.lerp(C1.set(k.horizon), cw); if (k.glow != null) L.sky.uGlowAmt.value *= mixNum(1, k.glow, w); }
    if (W.scene.fog) { if (k.fog) W.scene.fog.color.lerp(C1.set(k.fog), cw); if (k.fogD != null) W.scene.fog.density = mixNum(W.scene.fog.density, k.fogD, w); }
    if (k.stars != null) L.stars.forEach(function (m) { m.opacity = mixNum(m.opacity, k.stars, w); });
    if (k.sunSprite != null && W.sunSprite) W.sunSprite.material.opacity = mixNum(W.sunSprite.material.opacity, k.sunSprite, w);
  }
  if (JA.fx && JA.fx.render) { var fxRender = JA.fx.render; JA.fx.render = function (r, s, c, dt) { return F.skip ? true : fxRender.call(JA.fx, r, s, c, dt); }; }
  if (JA.fx && JA.fx.setLevel) JA.fx.setLevel(2);          // the full camera look, and it must not step down by itself
  var realUpdate = W.update;
  W.update = function (dt) {
    if (F.envT != null) W.env.t = F.envT;
    if (F.dust != null) W.env.dust = F.dust;
    if (F.shakeMul != null) W.cam.shake *= F.shakeMul;
    if (F.cam) F.cam(F.t);
    F.lookDone = false;
    realUpdate(dt);
  };

  // ---- the camera: a zoom punch on the beat, and a hand-held drift
  var HITS = [[3.83, 0.6], [4, 1], [8, 0.8], [9, 0.55], [10, 0.55], [10.5, 0.5], [11, 0.55], [11.5, 0.55], [12, 0.8], [13, 0.9], [15.52, 1], [19, 0.5], [20, 0.5], [21, 0.5], [22, 0.5], [24, 1], [26, 1]];
  [[8.5, 12, 0.28], [13.5, 15.5, 0.28], [20, 24, 0.24], [24.5, 26, 0.3]].forEach(function (r) { for (var t = r[0]; t < r[1] - 1e-6; t += 0.5) HITS.push([t, r[2]]); });
  function punch(Tf) { var k = 0; for (var i = 0; i < HITS.length; i++) { var d = Tf - HITS[i][0]; if (d >= 0 && d < 0.45) k += HITS[i][1] * Math.exp(-d / 0.085); } return 1 - 0.07 * Math.min(k, 1.4); }
  function cine(px, py, pz, lx, ly, lz, fov, roll) {
    var c = W.cam, h = F.hand || 0, t = F.T;
    if (h) {
      px += h * (Math.sin(t * 1.9) * 0.6 + Math.sin(t * 4.7 + 1) * 0.4); py += h * (Math.sin(t * 2.3 + 2) * 0.5 + Math.sin(t * 5.3) * 0.3); pz += h * (Math.sin(t * 1.4 + 4) * 0.6 + Math.sin(t * 3.9 + 3) * 0.4);
      lx += h * 0.6 * Math.sin(t * 2.9 + 5); ly += h * 0.5 * Math.sin(t * 3.3 + 1);
    }
    c.mode = 'cine'; c.cine.pos.set(px, py, pz); c.cine.look.set(lx, ly, lz); c.cine.fov = (fov || 52) * punch(t); c.cine.roll = roll || 0;
  }
  // flashes and in-camera jolts, at film times
  var ACCENTS = [[3.83, 'shake', 0.5], [4, 'shock', 0.6], [12, 'glitch', 1], [13, 'shock', 0.4], [15.52, 'shock', 1], [15.52, 'shake', 0.45], [16.5, 'glitch', 0.7], [24, 'shock', 0.9]];
  var WHITE = [[4, 0.6], [13, 0.3], [15.52, 0.45], [24, 0.6], [26, 0.45]];
  function accents(a, b) {
    ACCENTS.forEach(function (e) {
      if (e[0] <= a || e[0] > b) return;
      if (e[1] === 'shake') W.cam.shake = Math.max(W.cam.shake, e[2]);
      else if (JA.fx && JA.fx.pulse) JA.fx.pulse(e[1], e[2]);
    });
  }

  // ---- words on top: they slam in on the beat
  var SHADOW = '0 4px 0 rgba(0,0,0,.22),0 10px 36px rgba(0,0,0,.55)';
  var css = document.createElement('style');
  css.textContent = [
    '#film{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;color:#fff;font-family:"Sora","Figtree",sans-serif;}',
    '#film .cap{position:absolute;left:0;right:0;text-align:center;white-space:nowrap;opacity:0;will-change:transform,opacity,filter;}',
    '#film .slam{font-weight:800;font-size:92px;line-height:1;letter-spacing:.01em;text-transform:uppercase;}',
    '#film .slam em,#film .words em,#film .logo i{font-style:normal;color:#ffd23f;}',
    '#film .mid{top:50%;margin-top:-46px;}',
    '#film .low{bottom:15.5%;}',
    '#film .top{top:15.5%;}',
    '#film .words{font-weight:800;font-size:76px;line-height:1;text-transform:uppercase;top:50%;margin-top:-38px;}',
    '#film .words span{display:inline-block;margin:0 .14em;opacity:0;}',
    '#film .type{bottom:16.5%;font-family:"Figtree",sans-serif;font-weight:800;font-size:27px;letter-spacing:.42em;text-transform:uppercase;text-shadow:0 2px 14px rgba(0,0,0,.9);}',
    '#film .type u{text-decoration:none;display:inline-block;width:.6em;height:1em;margin-left:.1em;background:#ffd23f;vertical-align:-.12em;}',
    '#film .data{font-family:"Figtree",sans-serif;font-weight:800;font-size:21px;letter-spacing:.32em;text-transform:uppercase;color:#ffe08a;text-shadow:0 2px 14px rgba(0,0,0,.9);}',
    '#film .alert{top:30%;}',
    '#film .alert b{display:inline-block;padding:14px 34px;border-radius:10px;background:#ff2d6f;color:#fff;font-weight:800;font-size:44px;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 0 60px rgba(255,45,111,.75),0 10px 30px rgba(0,0,0,.5);}',
    '#film .logo{font-family:"Exo 2","Sora",sans-serif;font-weight:900;font-size:128px;line-height:1;letter-spacing:.03em;text-transform:uppercase;}',
    '#film .under{font-family:"Figtree",sans-serif;font-weight:800;font-size:24px;letter-spacing:.5em;text-transform:uppercase;text-shadow:0 2px 14px rgba(0,0,0,.9);}',
    '#film .line{font-family:"Figtree",sans-serif;font-weight:700;font-size:25px;letter-spacing:.06em;color:#eef2ff;text-shadow:0 2px 14px rgba(0,0,0,.9);}',
    '#film .small{bottom:3.6%;font-family:"Figtree",sans-serif;font-weight:700;font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:rgba(255,255,255,.82);}',
    '#film .count{top:15%;font-family:"Exo 2","Sora",sans-serif;font-weight:900;font-size:120px;line-height:1;font-variant-numeric:tabular-nums;}',
    '#film .count small{display:block;margin-top:6px;font-family:"Figtree",sans-serif;font-weight:800;font-size:20px;letter-spacing:.46em;color:#ffe08a;}',
    '#film .side{left:auto;right:3%;top:31%;width:31%;text-align:left;white-space:normal;font-weight:800;font-size:66px;line-height:1.04;text-transform:uppercase;}',
    '#film .side em{font-style:normal;color:#5ce1ff;}',
    '#film .side small{display:block;margin-top:20px;font-family:"Figtree",sans-serif;font-weight:800;font-size:17px;line-height:1.6;letter-spacing:.24em;color:#bfe9ff;}',
    '#film .veil{position:absolute;inset:0;background:#000;opacity:0;}',
    '#film .flash{position:absolute;inset:0;background:#fff;opacity:0;mix-blend-mode:screen;}',
    '#film .scrim{position:absolute;inset:0;background:radial-gradient(ellipse 80% 55% at 50% 42%,rgba(3,5,14,.62),rgba(3,5,14,.2) 72%,rgba(3,5,14,0));opacity:0;}',
    '#film .bar{position:absolute;left:0;right:0;height:11.5%;background:#000;}',
    '#film .redalert{position:absolute;inset:0;background:radial-gradient(ellipse 70% 62% at 50% 50%,rgba(255,30,80,0) 45%,rgba(255,30,80,.6));opacity:0;}',
    'body.film-holo #holo-root{place-items:center start;padding-left:5%;background:rgba(3,7,18,.5);}',
    '#cine-skip,#cine-line,#cine-title{display:none!important;}'
  ].join('\n');
  document.head.appendChild(css);
  var film = document.createElement('div'); film.id = 'film';
  film.innerHTML = '<div class="scrim"></div><div class="redalert"></div><div class="caps"></div><div class="flash"></div><div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div><div class="veil"></div>';
  document.body.appendChild(film);
  var scrim = film.querySelector('.scrim'), redalert = film.querySelector('.redalert'), capBox = film.querySelector('.caps'), flash = film.querySelector('.flash'), veil = film.querySelector('.veil');

  // every caption of the film, in film time: a (in) and b (out)
  var DATA = { line: 'NASA DONKI record', flare: '' };
  var CAPS = [
    { kind: 'type', a: 0.3, b: 1.7, text: '384,400 km from home', cps: 26 },
    { kind: 'slam', a: 4.0, b: 5.97, cls: 'logo top', html: 'Astro <i>Outpost</i>', grow: 0.04 },
    { kind: 'slam', a: 4.3, b: 5.97, cls: 'under top', html: 'Junior Astronaut Mission Trainer', soft: true, style: 'top:34%' },
    { kind: 'words', a: 6.0, b: 7.97, words: [[6.0, 'Can'], [6.5, 'you'], [7.0, '<em>survive</em>'], [7.5, 'Mars?']] },
    { kind: 'slam', a: 8.0, b: 8.97, cls: 'slam low', html: 'Make <em>air</em>' },
    { kind: 'slam', a: 9.0, b: 9.97, cls: 'slam low', html: 'Mine <em>ice</em>' },
    { kind: 'slam', a: 10.0, b: 10.48, cls: 'slam low', html: 'Grow <em>food</em>' },
    { kind: 'slam', a: 10.5, b: 10.98, cls: 'slam low', html: 'Shield <em>up</em>' },
    { kind: 'slam', a: 11.0, b: 11.48, cls: 'slam low', html: 'Break <em>rocks</em>' },
    { kind: 'slam', a: 11.5, b: 11.98, cls: 'slam low', html: '<em>Build!</em>' },
    { kind: 'slam', a: 12.0, b: 12.97, cls: 'alert cap', html: '<b>⚠ Solar storm detected</b>', blink: true },
    { kind: 'type', a: 12.15, b: 12.97, text: function () { return DATA.line; }, cps: 60, cls: 'data', style: 'bottom:auto;top:47%' },
    { kind: 'slam', a: 13.0, b: 14.97, cls: 'slam low', html: 'Real <em>solar storms</em>' },
    { kind: 'type', a: 13.25, b: 14.97, text: function () { return DATA.line; }, cps: 70, cls: 'data', style: 'bottom:10.8%' },
    { kind: 'slam', a: 15.53, b: 16.47, cls: 'slam low', html: 'Real <em>consequences</em>' },
    { kind: 'slam', a: 16.55, b: 17.97, cls: 'side', html: 'Learn the <em>real</em> science<small>15 holograms · 80-page Field Journal · real NASA sources</small>', soft: true },
    { kind: 'slam', a: 18.0, b: 20.92, cls: 'slam low', html: 'Keep them <em>alive</em>…' },
    { kind: 'count', a: 19.0, b: 23.95, at: [[19, 4], [20, 12], [21, 30], [22, 80]], label: 'people living on Mars' },
    { kind: 'slam', a: 21.0, b: 23.92, cls: 'slam low', html: '…and build a <em>city</em>' },
    { kind: 'slam', a: 26.0, b: LEN + 1, cls: 'logo mid', html: 'Astro <i>Outpost</i>', grow: 0.025, style: 'margin-top:-150px' },
    { kind: 'slam', a: 26.3, b: LEN + 1, cls: 'under mid', html: 'Junior Astronaut Mission Trainer', soft: true, style: 'margin-top:-6px' },
    { kind: 'slam', a: 26.75, b: LEN + 1, cls: 'line mid', html: 'Survive the Moon and Mars &nbsp;·&nbsp; real NASA space-weather data', soft: true, style: 'margin-top:52px' },
    { kind: 'slam', a: 27.2, b: LEN + 1, cls: 'small', html: 'Play free in your browser &nbsp;·&nbsp; NASA Space Apps Challenge 2026 · Tunis &nbsp;·&nbsp; real in-game footage &nbsp;·&nbsp; AI-assisted', soft: true }
  ];
  CAPS.forEach(function (c) {
    var e = document.createElement('div');
    e.className = 'cap ' + (c.cls || (c.kind === 'type' ? 'type' : c.kind === 'words' ? 'words' : c.kind === 'count' ? 'count' : 'slam mid'));
    if (c.style) e.style.cssText += ';' + c.style;
    if (c.kind === 'slam') e.innerHTML = c.html;
    if (c.kind === 'words') { e.innerHTML = c.words.map(function (w) { return '<span>' + w[1] + '</span>'; }).join(''); c.spans = e.querySelectorAll('span'); }
    capBox.appendChild(e); c.el = e;
  });
  // one element slamming in: big and blurred with split colours, then sharp; a soft one only fades and rises
  function slam(el, Tf, a, b, o) {
    o = o || {};
    if (Tf < a || Tf >= b) { el.style.opacity = 0; return; }
    var inT = o.soft ? 0.3 : 0.15, k = easeOut(span(Tf, a, a + inT)), out = span(Tf, b - 0.08, b), hold = Math.max(0, Tf - a - inT);
    if (o.soft) {
      el.style.opacity = (k * (1 - out)).toFixed(3);
      el.style.transform = 'translateY(' + ((1 - k) * 18).toFixed(1) + 'px)';
      el.style.filter = 'none'; el.style.textShadow = SHADOW;
      return;
    }
    var sc = (1.6 - 0.6 * k) * (1 + (o.grow == null ? 0.03 : o.grow) * hold) * (1 + out * 0.12), bl = (1 - k) * 16 + out * 10, rgb = (1 - k) * 14;
    var blink = o.blink && Tf - a < 0.36 ? (Math.floor((Tf - a) / 0.09) % 2 ? 0.25 : 1) : 1;
    el.style.opacity = (Math.min(1, k * 1.8) * (1 - out) * blink).toFixed(3);
    el.style.transform = 'scale(' + sc.toFixed(4) + ')';
    el.style.filter = bl > 0.05 ? 'blur(' + bl.toFixed(2) + 'px)' : 'none';
    el.style.textShadow = rgb > 0.15 ? rgb.toFixed(1) + 'px 0 rgba(255,40,90,.85),' + (-rgb).toFixed(1) + 'px 0 rgba(40,220,255,.85),' + SHADOW : SHADOW;
  }
  function drawCaps(Tf) {
    CAPS.forEach(function (c) {
      var e = c.el;
      if (c.kind === 'slam') slam(e, Tf, c.a, c.b, c);
      else if (c.kind === 'words') {
        e.style.opacity = Tf >= c.a && Tf < c.b ? 1 : 0;
        c.words.forEach(function (w, i) { slam(c.spans[i], Tf, w[0], c.b, {}); });
      } else if (c.kind === 'type') {
        var txt = typeof c.text === 'function' ? c.text() : c.text, n = Math.floor((Tf - c.a) * c.cps);
        if (Tf < c.a || Tf >= c.b) { e.style.opacity = 0; return; }
        n = clamp(n, 0, txt.length);       // the untyped rest is there but invisible, so the line never shifts while it types
        e.innerHTML = txt.slice(0, n) + '<span style="opacity:0">' + txt.slice(n) + '</span>';
        e.style.opacity = (1 - span(Tf, c.b - 0.12, c.b)).toFixed(3); e.style.textShadow = '0 2px 14px rgba(0,0,0,.9)';
      } else if (c.kind === 'count') {
        var cur = null; c.at.forEach(function (p) { if (Tf >= p[0]) cur = p; });
        if (!cur || Tf >= c.b) { e.style.opacity = 0; return; }
        e.innerHTML = cur[1] + '<small>' + c.label + '</small>';
        slam(e, Tf, cur[0], c.b, { grow: 0.01 });
        if (cur !== c.at[0]) { e.style.opacity = (1 - span(Tf, c.b - 0.08, c.b)).toFixed(3); e.style.filter = 'none'; }
      }
    });
    var w = 0; WHITE.forEach(function (f) { var d = Tf - f[0]; if (d >= 0 && d < 0.5) w = Math.max(w, f[1] * Math.exp(-d / 0.055)); });
    flash.style.opacity = w.toFixed(3);
    veil.style.opacity = Math.max(1 - span(Tf, 0, 0.4), span(Tf, LEN - 0.5, LEN)).toFixed(3);
    scrim.style.opacity = (0.85 * span(Tf, 26.0, 26.5)).toFixed(3);
    redalert.style.opacity = (Tf >= 12 && Tf < 13.4 ? (0.55 + 0.45 * Math.cos((Tf - 12) * Math.PI * 8)) * (1 - span(Tf, 12.9, 13.4)) : 0).toFixed(3);
  }

  // ---- which of the game's own screen parts are on show (normally none: this is a film, not a screen recording)
  var ALWAYS = { scene: 1, film: 1 };
  function applyUi() {
    var k = document.body.children, i, e;
    for (i = 0; i < k.length; i++) { e = k[i]; if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || ALWAYS[e.id]) continue; e.style.visibility = F.ui[e.id] ? '' : 'hidden'; }
  }
  function showOnly(ids) { F.ui = {}; (ids || []).forEach(function (i) { F.ui[i] = 1; }); applyUi(); }

  // ---- starting a real mission through the real menus
  async function mission(o) {
    if (G.mode === 'film') { G.mode = 'play'; if (A.astro.mode === 'hidden') A.astro.mode = 'walk'; beams(true); devils(true); }
    if (JA.holo && JA.holo.isOpen && JA.holo.isOpen()) JA.holo.close();
    if (!(G.s && G.s.site.id === o.site && G.mode !== 'title' && G.mode !== 'end')) {
      $('btn-start').click(); pump(6);
      var pick = function (g, v) { var b = q('.modal button[data-g="' + g + '"][data-v="' + v + '"]'); if (!b) throw new Error('no choice ' + g + '=' + v); b.click(); pump(2); };
      pick('site', o.site); pick('level', o.level || 'veteran'); pick('sun', 'archive'); pick('pioneer', o.pioneer ? 'on' : 'off');
      q('.modal button[data-act="go"]').click();
      for (var i = 0; i < 800 && G.mode !== 'intro' && G.mode !== 'brief' && G.mode !== 'play'; i++) { pump(2); await C.sleep(8); }
    }
    for (var j = 0; j < 900 && G.mode !== 'play'; j++) {
      if (G.mode === 'intro') JA.intro.skip();
      var b = Array.prototype.filter.call(document.querySelectorAll('.modal button.primary'), function (x) { return /Step outside/.test(x.textContent); })[0];
      if (b) b.click();
      pump(2); await C.sleep(4);
    }
    if (G.mode !== 'play') throw new Error('could not start playing (mode ' + G.mode + ')');
    if (!F.settled) { quiet(30); F.settled = true; }
  }
  // common starting state for a staged shot
  function stage(o) {
    var s = G.s, a = A.astro, r = A.rover;
    G.mode = 'play'; G.mini = null; G.sayQ.length = 0;
    if (r.driver) A.exitRover();
    if (a.carrying) { var it = a.carrying; A.setDown(); A.remove(it); }
    a.mode = 'walk'; a.vel.set(0, 0, 0); a.vy = 0;
    G.keys.up = G.keys.down = G.keys.left = G.keys.right = G.keys.shift = false;
    s.storm = null; s.glitch = null; W.env.storm = 0;
    s.air = o.air == null ? 74 : o.air; s.food = o.food == null ? 63 : o.food; s.dose = o.dose || 6; s.water = o.water == null ? 58 : o.water; s.filter = o.filter == null ? 81 : o.filter;
    s.t = s.dayLength * 0.3;
    F.envT = o.envT == null ? null : o.envT; F.dust = o.dust == null ? 0 : o.dust;
    if (o.at) put(o.at[0], o.at[1], o.at[2]);
    document.querySelectorAll('#toasts > *').forEach(function (e) { e.remove(); });
  }
  function put(x, z, yaw) { var a = A.astro; a.pos.set(x, ground(x, z), z); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; if (yaw != null) a.yaw = yaw; }
  function face(x, z) { var a = A.astro; a.yaw = Math.atan2(x - a.pos.x, z - a.pos.z); }
  // walk the way a player does: the "up" key moves you away from the camera heading, so that heading is turned the way we want to go
  function walk(dx, dz, sprint) { W.cam.yaw = Math.atan2(-dx, -dz); G.keys.up = true; G.keys.shift = !!sprint; }
  function halt() { G.keys.up = false; G.keys.shift = false; }
  function freeze() { if (G.s) G.s.t = G.s.dayLength * 0.3; }       // the mission clock stands still, so no shift ever ends on camera
  function beams(on) {      // the tall light beams over the drill and instrument sites
    if (!F.beams) { F.beams = []; W.root.traverse(function (o) { var g = o.geometry, m = o.material; if (o.isMesh && g && g.type === 'CylinderGeometry' && g.parameters.height >= 12 && m && m.transparent && m.blending === T.AdditiveBlending) F.beams.push({ m: m, o: m.opacity }); }); }
    F.beams.forEach(function (b) { b.m.opacity = on ? b.o : 0; });
  }
  function devils(on) { (A.devils || []).forEach(function (d) { d.group.visible = on; }); }
  function sunDir(t) {      // the same sun path as world.js
    var az, el;
    if (W.site === 'moon') { az = lerp(1.05, -1.05, t); el = 0.15 + Math.sin(Math.PI * t) * 0.06; } else { az = lerp(1.75, -1.75, t); el = 0.13 + Math.sin(Math.PI * t) * 0.9; }
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  }
  function fly(type, from, to, secs, data) {     // something thrown: it flies from a point and lands on another after secs, under the world's own gravity
    var g = W.gravity, it = A.spawn(type, V.set(from[0], from[1], from[2]), data || null, 'fly');
    it.vel.set((to[0] - from[0]) / secs, (to[1] - from[1] + 0.5 * g * secs * secs) / secs, (to[2] - from[2]) / secs); it.spin = 5;
    return it;
  }
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
  function findRun() {
    if (F.run) return F.run;
    var best = null, bs = 9, i, k, b, ax, az, sc;
    for (i = 0; i < Tn.boulders.length; i++) {
      b = Tn.boulders[i]; if (b.seat || b.r < 1.25 || b.r > 2.4 || Math.hypot(b.x, b.z) > 150) continue;
      for (k = 0; k < 12; k++) { ax = Math.sin(k / 12 * 6.283); az = Math.cos(k / 12 * 6.283); sc = clearRun(b, ax, az, 66); if (sc < bs) { bs = sc; best = { b: b, ax: ax, az: az }; } }
    }
    if (!best) throw new Error('no boulder with a clear run');
    return (F.run = best);
  }
  function drive(start, ax, az, cargo) {   // the rover, at the start of a run, loaded, with the astronaut at the wheel
    var r = A.rover;
    A.items.slice().forEach(function (it) { if (it.state === 'bed') A.remove(it); });
    r.pos.set(start[0], 0, start[1]); r.pos.y = ground(r.pos.x, r.pos.z); r.yaw = Math.atan2(ax, az); r.speed = 0; r.vy = 0;
    G.s.m.rover.charge = 100; G.s.m.rover.stuck = false;
    A.roverSpot('door', A.astro.pos); A.enterRover();
    (cargo || []).forEach(function (type) { A.toBed(A.spawn(type, V.set(r.pos.x, r.pos.y + 2, r.pos.z), type === 'crate' ? { name: 'Lettuce crate', crop: 'lettuce' } : null, 'rest')); });
  }

  var SHOTS = [], byId = {}, AT = 0;
  function shot(o) { o.at = AT / FPS; AT += o.frames; SHOTS.push(o); byId[o.id] = o; }

  // =====================================================================
  //  THE MOON · the hook: Earth, very far away
  // =====================================================================
  shot({ id: 'hook', frames: 52, world: 'moon',
    begin: async function () {
      await mission({ site: 'moon', level: 'veteran' });
      stage({ envT: 0.5 });
      var d = norm2(-0.5, -0.84);
      put(24, 30, Math.atan2(d[0], d[1])); F.note.d = d;
      quiet(20);
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var a = A.astro.pos, d = F.note.d, rx = -d[1], rz = d[0], u = smooth(t / 1.73), back = lerp(7.2, 6.0, u), L = 60;
      var cx = a.x - d[0] * back + rx * 1.6, cz = a.z - d[1] * back + rz * 1.6, cy = a.y + 1.0;
      cine(cx, cy, cz, a.x + d[0] * L - rx * L * 0.06, cy + Math.tan(9.3 * Math.PI / 180) * L, a.z + d[1] * L - rz * L * 0.06, 27);
    }
  });

  // =====================================================================
  //  THE MOON · a ship from Earth lands (the colony's own arrival, seen from the ground)
  // =====================================================================
  shot({ id: 'arrive', frames: 68, world: 'moon', rate: function () { return 1.6; }, hand: 0.05,
    begin: async function () {
      await mission({ site: 'moon', level: 'veteran' });
      stage({ envT: 0.5 });
      var path = [], i;
      F.skip = true;
      K.setStage(4); pump(4);
      K.setStage(5, { arrive: true });                // a first landing, off camera, to learn where the ship comes down
      for (i = 0; i < 900 && K.busy(); i++) { C.tick(TICK); path.push(K.focus(new T.Vector3())); }
      if (path.length < 400) throw new Error('the ship did not land (' + path.length + ' steps)');
      var home = path[path.length - 2].clone(); home.y -= 4;
      var from = path[0];
      K.setStage(4); pump(2);
      K.setStage(5, { arrive: true });
      // touchdown is 6.2 s into the arrival; it should come 2.1 s into this shot, which runs at 1.6 times real speed
      for (i = 0; i < Math.round((6.2 - 2.1 * 1.6) * 60); i++) C.tick(TICK);
      F.skip = false;
      var d = norm2(-0.5, -0.84), side = norm2(from.x - home.x, from.z - home.z);
      F.note.home = [home.x, home.y, home.z]; F.note.d = d; F.note.side = side;
      A.astro.mode = 'hidden';
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var h = F.note.home, d = F.note.d, cx = h[0] - d[0] * 40, cz = h[2] - d[1] * 40, f = K.busy() ? K.focus(V) : V.set(h[0], h[1] + 4, h[2]);
      var u = smooth(t / 2.27), ly = lerp(f.y - 2, h[1] + 7, span(t, 1.7, 2.27));
      cine(cx, ground(cx, cz) + 4.5, cz, lerp(f.x, h[0], 0.25), ly, lerp(f.z, h[2], 0.25), lerp(50, 44, u));
    },
    end: function () { A.astro.mode = 'walk'; }
  });

  // =====================================================================
  //  THE MOON · title: the outpost, Earth in the sky
  // =====================================================================
  shot({ id: 'title', frames: 60, world: 'moon',
    begin: async function () {
      await mission({ site: 'moon', level: 'veteran' });
      stage({ at: [30, 37, 0], envT: 0.86 });
      F.note.dir = norm2(-30, -37);
      A.astro.yaw = Math.atan2(F.note.dir[0], F.note.dir[1]);
      quiet(10);
    },
    frame: function (t) {
      var d = F.note.dir; freeze(); walk(d[0], d[1], false);
      if (t >= 0.5) once('hop', function () { press('Space'); });
    },
    cam: function (t) {
      var a = A.astro.pos, d = F.note.dir, rx = -d[1], rz = d[0], z = easeOut(t / 0.35);
      cine(a.x - d[0] * 12.5 + rx * 1.0, a.y + 4.6, a.z - d[1] * 12.5 + rz * 1.0, 4, 19, -6, lerp(66, 43, z) - t * 0.6);
    }
  });

  // =====================================================================
  //  MARS · the outpost at sunrise
  // =====================================================================
  shot({ id: 'reveal', look: GOLD, frames: 60, world: 'mars',
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.085, at: [7, 13, 0] }); face(0, 0);
      quiet(10);
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var u = smooth(t / 2), cx = lerp(16, 6, u), cz = lerp(84, 32, u);
      cine(cx, ground(cx, cz) + lerp(1.3, 12, u * u), cz, lerp(-2, 0, u), lerp(7, 2.5, u), lerp(0, 2, u), lerp(52, 44, u));
    }
  });

  // =====================================================================
  //  MARS · the montage: eight half-second cuts
  // =====================================================================
  shot({ id: 'plug', look: GOLD, frames: 15, world: 'mars', hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var so = B.spots.sockets.air;
      stage({ envT: 0.1, air: 38 });
      G.s.m.air.power = 0;
      put(so.x + 0.6, so.z + 1.05); face(so.x, so.z);
      A.pick(A.spawn('cell', A.handPos(V), null, 'rest'));
      quiet(12);
      F.note.so = so; F.note.prompt = $('prompt-text').textContent;
    },
    frame: function (t) {
      freeze();
      if (t >= 0.04) once('plug', function () {
        if (/plug|power/i.test(F.note.prompt)) press('KeyE');
        else { var c = A.astro.carrying, so = F.note.so; if (c) { A.setDown(); c.pos.set(so.x, so.y, so.z); c.state = 'fly'; c.vel.set(0, 0, 0); } }
      });
    },
    cam: function (t) {
      var so = F.note.so, u = t / 0.5;
      cine(so.x + 3.3 - u * 0.5, 1.35, so.z + 2.9 - u * 0.4, so.x - 0.2, 1.75, so.z - 0.5, 40);
    }
  });

  shot({ id: 'hopper', look: GOLD, frames: 15, world: 'mars', hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var hp = B.spots.hoppers.air;
      stage({ envT: 0.1 });
      G.s.m.air.queue = 0;
      put(hp.x + 3.6, hp.z + 3.2); face(hp.x, hp.z);
      A.items.slice().forEach(function (it) { if (it.type === 'ice' && it.state !== 'bed') A.remove(it); });
      quiet(6);
      A.astro.throwT = 0.35;
      var g0 = ground(hp.x + 3.0, hp.z + 2.7);
      fly('ice', [hp.x + 3.0, g0 + 1.7, hp.z + 2.7], [hp.x, hp.y + 0.35, hp.z], 0.42);
      F.note.hp = hp;
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var hp = F.note.hp, u = t / 0.5;
      cine(hp.x - 2.4 + u * 0.3, hp.y - 0.9, hp.z + 5.4 - u * 0.4, hp.x + 0.9, hp.y + 0.3, hp.z + 0.4, 50);
    }
  });

  shot({ id: 'drill', look: GOLD, frames: 15, world: 'mars', hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var q0 = B.spots.ice[0];
      stage({ envT: 0.12 });
      put(q0.x + 2.5, q0.z + 1.7); face(q0.x, q0.z);
      A.items.slice().forEach(function (it) { if (it.type === 'ice' && it.state !== 'bed') A.remove(it); });
      G.rigs.forEach(function (r) { r.state = 'idle'; r.p = 0; });
      quiet(4);
      var need = R.iceDrillTime / Math.sqrt(G.s.level.ease);
      G.rigs[0].state = 'drill'; G.rigs[0].p = 1 - 0.14 / need;
      F.note.q = q0;
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var p = F.note.q, u = t / 0.5;
      cine(p.x - 3.0 + u * 0.4, p.y + 0.6, p.z + 4.0 - u * 0.4, p.x + 0.3, p.y + 1.8, p.z, 44);
    }
  });

  shot({ id: 'flyby', look: GOLD, frames: 15, world: 'mars', hand: 0.03,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.12 });
      var run = findRun(), b = run.b, r = A.rover;
      drive([b.x - run.ax * 66, b.z - run.az * 66], run.ax, run.az, ['ice', 'ice', 'crate']);
      G.keys.up = true; quiet(300);                     // five seconds to get up to full speed
      var v = Math.max(5, Math.abs(r.speed)), rx = run.az, rz = -run.ax, pass = 0.3 * v;
      F.note.cx = r.pos.x + run.ax * pass + rx * 2.6; F.note.cz = r.pos.z + run.az * pass + rz * 2.6; F.note.v = v; F.note.ax = run.ax; F.note.az = run.az;
    },
    frame: function () { freeze(); G.keys.up = true; },
    cam: function () {
      var n = F.note, p = A.rover.pos;
      cine(n.cx, ground(n.cx, n.cz) + 0.75, n.cz, p.x + n.ax * 1.2, p.y + 1.0, p.z + n.az * 1.2, 64);
    },
    end: function () { halt(); if (A.rover.driver) A.exitRover(); A.rover.speed = 0; }
  });

  shot({ id: 'harvest', look: GOLD, frames: 15, world: 'mars', hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var bed = B.spots.beds[1];
      stage({ envT: 0.5, food: 31, at: [bed.x, bed.z - 1.75, 0] });
      G.s.m.food.beds.forEach(function (b, i) { b.state = i === 3 ? 'growing' : 'ripe'; b.g = i === 3 ? 0.55 : 1; b.crop = i % 2 ? 'potato' : 'lettuce'; });
      G.s.m.food.on = true;
      F.note.bed = bed;
      quiet(14);
    },
    frame: function (t) { freeze(); if (t >= 0.05) once('pick', function () { press('KeyE'); }); },
    cam: function (t) {
      var b = F.note.bed, u = t / 0.5;
      cine(b.x - 2.9 + u * 0.4, 1.75, b.z - 3.1, b.x + 0.6, 1.35, b.z - 0.6, 50);
    }
  });

  shot({ id: 'bags', look: GOLD, frames: 15, world: 'mars', hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.12, at: [-7.2, 11.5, 0] }); face(0, 0);
      G.s.bags = Math.min(G.s.bags || 0, 5);
      quiet(6);
      A.astro.throwT = 0.35;
      var g0 = ground(-7.2, 11.5);
      [[-6.6, 10.8, -1.5, 8.0, 1.0, 0.62], [-7.5, 11.0, 0.8, 7.6, -1.8, 0.66], [-6.9, 11.9, -2.6, 7.2, -0.4, 0.7]].forEach(function (b) {
        fly('bag', [b[0], g0 + 1.7, b[1]], [b[2], b[3], b[4]], b[5], { name: 'soil bag' });
      });
    },
    frame: function () { freeze(); },
    cam: function (t) { var u = t / 0.5; cine(-11.2 + u * 0.4, 1.0, 16.0 - u * 0.4, 0, 6.2, 0, 50); }
  });

  shot({ id: 'smash', look: GOLD, frames: 15, world: 'mars', hand: 0.03,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.12 });
      var best = null, bd = 1e9, i, b, d;
      for (i = 0; i < Tn.boulders.length; i++) {        // a big boulder on open ground, away from the buildings
        b = Tn.boulders[i]; if (b.seat || !b.mesh || !b.mesh.visible || b.r < 1.8 || b.r > 2.7) continue;
        d = Math.hypot(b.x + 20, b.z - 70);
        if (Math.hypot(b.x, b.z) > 45 && Math.hypot(b.x - Tn.L.colony[0], b.z - Tn.L.colony[1]) > 60 && d < bd) { bd = d; best = b; }
      }
      if (!best) throw new Error('no boulder to break');
      var s = sunDir(0.12), sd = norm2(s[0], s[2]);
      put(best.x + sd[0] * (best.r + 1.0), best.z + sd[1] * (best.r + 1.0)); face(best.x, best.z);
      sim.addMat(G.s, 'rock', 30); sim.addMat(G.s, 'metal', 30); sim.addMat(G.s, 'glass', 30);
      var gy0 = Tn.height(best.x, best.z);
      cine(best.x + sd[0] * 3.2 - sd[1] * 4.3, gy0 + 0.95, best.z + sd[1] * 3.2 + sd[0] * 4.3, best.x, gy0 + 1.3, best.z, 52);
      quiet(30);
      F.skip = true;                                      // crack it off camera until one more swing breaks it
      for (i = 0; i < 12; i++) {
        var all = document.querySelectorAll('#pio-ring .pio-pips b').length, lit = document.querySelectorAll('#pio-ring .pio-pips b.on').length;
        F.note.pips = lit + '/' + all;
        if (all && lit >= all - 1) break;
        press('KeyE'); pump(36);
      }
      pump(20); F.skip = false;
      F.note.b = { x: best.x, z: best.z, r: best.r }; F.note.sd = sd; F.smashSd = sd; F.note.prompt = $('prompt-text').textContent;
    },
    frame: function (t) { freeze(); once('swing', function () { press('KeyE'); }); },
    cam: function (t) {
      var b = F.note.b, sd = F.note.sd, rx = -sd[1], rz = sd[0], gy = Tn.height(b.x, b.z), u = t / 0.5;
      cine(b.x + sd[0] * 3.2 + rx * (4.3 - u * 0.5), gy + 0.95, b.z + sd[1] * 3.2 + rz * (4.3 - u * 0.5), b.x, gy + 1.3, b.z, 52);
    }
  });

  shot({ id: 'turbine', look: GOLD, frames: 15, world: 'mars', rate: function () { return 1.8; }, hand: 0.02,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var a = A.astro.pos, sd = F.smashSd || [0.6, 0.8];
      stage({ envT: 0.12 });
      var dir = [-sd[1], sd[0]];                          // build sideways from where the boulder stood
      W.cam.yaw = Math.atan2(-dir[0], -dir[1]);
      sim.addMat(G.s, 'rock', 30); sim.addMat(G.s, 'metal', 30); sim.addMat(G.s, 'glass', 30);
      quiet(4);
      F.note.menu = JA.pioneer.menu();
      var btn = q('#info-root [data-pio="turbine"]'); F.note.btn = !!btn; if (btn) btn.click();
      quiet(8);
      F.note.placing = JA.pioneer.placing(); F.note.prompt = $('prompt-text').textContent;
      press('KeyE'); quiet(24);
      F.note.spot = [a.x + dir[0] * 4.2, a.z + dir[1] * 4.2]; F.note.dir = dir;
    },
    frame: function () { },
    cam: function (t) {
      var s = F.note.spot, d = F.note.dir, gy = ground(s[0], s[1]), u = t / 0.5;
      cine(s[0] - d[0] * 9.5 + d[1] * 4.0, gy + 0.8, s[1] - d[1] * 9.5 - d[0] * 4.0, s[0], gy + 5.2 + u * 0.6, s[1], 56);
    }
  });

  // =====================================================================
  //  MARS · a real solar storm, from the mission's NASA DONKI record
  // =====================================================================
  function startStorm(ahead) {
    var s = G.s, w = F.flare, MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (!w) {
      (s.weather || []).forEach(function (x) { if (x && x.level > 0 && (!w || x.strength > w.strength)) w = x; });      // the strongest flare in this mission's record
      if (!w) throw new Error('this mission has no storm on record');
      F.flare = w;
      var dm = /^(\d{4})-(\d\d)-(\d\d)$/.exec(w.date || '');
      DATA.line = 'NASA DONKI data · ' + w.cls + ' solar flare' + (dm ? ' · ' + (+dm[3]) + ' ' + MONTHS[+dm[2] - 1] + ' ' + dm[1] : '');
    }
    s.storm = { start: s.t + ahead, end: s.t + 120, level: w.level, cls: w.cls, warned: true, active: false, over: false, strength: w.strength * 3 * s.site.stormMult * s.level.stormScale };
  }
  shot({ id: 'alarm', look: GOLD, frames: 30, world: 'mars', hand: 0.04,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.13, dose: 12, at: [9, 40, 0] });
      var s = sunDir(0.13), sd = norm2(s[0], s[2]); F.note.s = s; F.note.sd = sd;
      A.astro.yaw = Math.atan2(sd[0], sd[1]);
      quiet(6);
      startStorm(0.02);
    },
    frame: function () { freeze(); },
    cam: function (t) {
      var a = A.astro.pos, s = F.note.s, sd = F.note.sd, u = t / 1.0, back = 2.9 - u * 0.5, cy = a.y + 0.75;
      cine(a.x - sd[0] * back + sd[1] * 0.7, cy, a.z - sd[1] * back - sd[0] * 0.7, a.x + s[0] * 40, cy + s[1] * 40 * 0.82, a.z + s[2] * 40, 52, 0.04);
    }
  });

  shot({ id: 'run1', look: GOLD, frames: 30, world: 'mars', hand: 0.07,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var d = B.spots.door;
      stage({ envT: 0.13, dose: 14, at: [d.x + 9, d.z + 33, 0] });
      startStorm(-0.2); W.env.storm = 1; W.env.stormShown = 1;
      F.note.door = [d.x, d.z];
      walk(-9 / 34.2, -33 / 34.2, true); quiet(36);
    },
    frame: function () {
      var n = F.note, a = A.astro.pos, dx = n.door[0] - a.x, dz = n.door[1] + 1.2 - a.z, d = Math.hypot(dx, dz);
      freeze(); if (d > 1.5) walk(dx / d, dz / d, true); else halt();
    },
    cam: function (t) {
      var n = F.note, a = A.astro.pos, f = norm2(n.door[0] - a.x, n.door[1] - a.z), lead = lerp(6.5, 3.0, t), cx = a.x + f[0] * lead - f[1] * 0.6, cz = a.z + f[1] * lead + f[0] * 0.6;
      cine(cx, ground(cx, cz) + 0.85, cz, a.x, a.y + 1.35, a.z, 56, 0.035 * Math.sin(t * 3));
    },
    end: function () { }
  });
  shot({ id: 'run2', look: GOLD, frames: 30, world: 'mars', hand: 0.06,
    begin: async function () { F.note.door = [B.spots.door.x, B.spots.door.z]; },
    frame: function () {
      var n = F.note, a = A.astro.pos, dx = n.door[0] - a.x, dz = n.door[1] + 1.2 - a.z, d = Math.hypot(dx, dz);
      freeze(); if (d > 1.5) walk(dx / d, dz / d, true); else halt();
    },
    cam: function (t) {
      var n = F.note, a = A.astro.pos, f = norm2(n.door[0] - a.x, n.door[1] - a.z), rx = f[1], rz = -f[0];
      var cx = a.x + rx * 4.6 - f[0] * 1.2, cz = a.z + rz * 4.6 - f[1] * 1.2;
      cine(cx, ground(cx, cz) + 1.25, cz, a.x + f[0] * 3.5, a.y + 1.5, a.z + f[1] * 3.5, 52);
    }
  });

  // =====================================================================
  //  MARS · full speed, then a real crash (the cargo flies out; slow motion)
  // =====================================================================
  shot({ id: 'race', look: GOLD, frames: 15, world: 'mars', hand: 0.05,
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.14 });
      var run = findRun(), b = run.b, r = A.rover, i;
      drive([b.x - run.ax * 66, b.z - run.az * 66], run.ax, run.az, ['ice', 'crate', 'ice', 'cell']);
      var crash = A.onCrash; F.note.crashAt = null;
      A.onCrash = function (into, hit, before) { if (F.note.crashAt == null) { F.note.crashAt = F.T; F.note.into = into; } if (crash) crash(into, hit, before); };
      F.restore = function () { A.onCrash = crash; };
      G.keys.up = true; F.skip = true;
      for (i = 0; i < 2000; i++) {              // run up until the boulder is half a second plus one frame away
        C.tick(TICK);
        var d = Math.hypot(r.pos.x - b.x, r.pos.z - b.z) - b.r - 2.4;
        if (d < Math.max(0.5, Math.abs(r.speed)) * (0.5 + 0.02)) break;
      }
      F.skip = false;
      F.note.b = { x: b.x, z: b.z, r: b.r }; F.note.ax = run.ax; F.note.az = run.az; F.note.v = r.speed;
    },
    frame: function () { freeze(); G.keys.up = F.note.crashAt == null; },
    cam: function (t) {
      var n = F.note, p = A.rover.pos, rx = n.az, rz = -n.ax;
      var cx = p.x + rx * 2.4 + n.ax * 1.6, cz = p.z + rz * 2.4 + n.az * 1.6;
      cine(cx, ground(cx, cz) + 0.8, cz, p.x + n.ax * 6, p.y + 0.9, p.z + n.az * 6, 62, -0.03);
    }
  });
  shot({ id: 'impact', look: GOLD, frames: 30, world: 'mars', rate: function () { return 0.35; },
    begin: async function () { },
    frame: function () { freeze(); G.keys.up = F.note.crashAt == null; },
    cam: function (t) {
      var n = F.note, fx = n.ax, fz = n.az, rx = fz, rz = -fx, v = smooth(t / 1.0);
      var gx = n.b.x - fx * (2.6 - v * 1.0) - rx * (8.4 - v * 1.0), gz = n.b.z - fz * (2.6 - v * 1.0) - rz * (8.4 - v * 1.0);
      cine(gx, ground(gx, gz) + 0.9 + v * 0.6, gz, n.b.x - fx * (3.4 - v * 0.9), Tn.height(n.b.x, n.b.z) + 1.4 + v * 1.0, n.b.z - fz * (3.4 - v * 0.9), 54 - v * 3);
    },
    end: function () { if (F.restore) F.restore(); halt(); if (A.rover.driver) A.exitRover(); }
  });

  // =====================================================================
  //  THE SCIENCE · the wrist-tablet hologram swings in
  // =====================================================================
  shot({ id: 'science', look: GOLD, frames: 45, world: 'mars', ui: ['holo-root'],
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      var so = B.spots.sockets.air;
      stage({ envT: 0.3, at: [so.x + 2.2, so.z + 3.4, 0] }); face(so.x, so.z);
      F.note.so = so;
      quiet(6);
      document.body.classList.add('film-holo');
      F.note.opened = JA.holo.open('electrolysis', {});
      quiet(4);
      [1, 2].forEach(function () { var nx = q('#holo-root .holo-next'); if (nx) nx.click(); quiet(3); });
    },
    frame: function (t) {
      freeze();
      var p = q('#holo-root .holo-panel'); if (!p) return;
      var k = easeOut(t / 0.45), ry = lerp(42, 9, k) - t * 2, tz = lerp(-380, 0, k), fl = t < 0.25 ? (Math.floor(t / 0.04) % 2 ? 0.45 : 1) : 1;
      p.style.transform = 'perspective(1500px) rotateY(' + ry.toFixed(2) + 'deg) translateZ(' + tz.toFixed(1) + 'px) scale(' + (0.96 + 0.03 * k).toFixed(3) + ')';
      p.style.transformOrigin = 'left center'; p.style.opacity = (Math.min(1, t / 0.12) * fl).toFixed(3);
    },
    cam: function (t) {
      var so = F.note.so, m = B.pos.air, u = t / 1.5;
      cine(so.x + 7.5 - u, 2.0, so.z + 7.2 - u * 0.6, lerp(so.x, m.x, 0.5), 2.6, lerp(so.z, m.z, 0.5), 42);
    },
    end: function () { JA.holo.close(); document.body.classList.remove('film-holo'); quiet(4); }
  });

  // =====================================================================
  //  THE CITY · days fly by, four ships land, sunrise to night
  // =====================================================================
  shot({ id: 'city', frames: 180, world: 'mars', rate: function () { return 12; },
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.12 });
      K.setStage(1);
      var c = Tn.L.colony;
      F.note.a0 = Math.atan2(-c[0], -c[1]) - 0.35;
      put(c[0] + Math.sin(F.note.a0 + 0.9) * 75, c[1] + Math.cos(F.note.a0 + 0.9) * 75);
      A.astro.mode = 'hidden'; beams(false); devils(false);
      G.mode = 'film';                                // the mission rests; the town, the ships and the sky keep moving
      F.note.next = 2;
      quiet(20);
    },
    frame: function (t) {
      var n = F.note;
      // ships land one second apart: each one starts 0.52 s before (6.2 game seconds at twelve times speed)
      if (n.next <= 5 && t >= (n.next - 2) + 0.48) { K.setStage(n.next, { arrive: true }); n.next++; }
      F.envT = lerp(0.12, 0.995, smooth(t / 5.4));
      var w = smooth((t - 2.6) / 2.2);
      F.look = { mix: 1, sun: lerp(GOLD.sun, NIGHT.sun, w), hemi: lerp(GOLD.hemi, NIGHT.hemi, w), fogD: lerp(GOLD.fogD, NIGHT.fogD, w), glow: lerp(GOLD.glow, NIGHT.glow, w),
        sunColor: w > 0.01 ? NIGHT.sunColor : null, hemiSky: null, zenith: null, horizon: null, fog: null, stars: w, sunSprite: 1 - w };
      if (w > 0.01) { F.look.zenith = NIGHT.zenith; F.look.horizon = NIGHT.horizon; F.look.fog = NIGHT.fog; F.look.hemiSky = NIGHT.hemiSky; F.look.hemiGround = NIGHT.hemiGround; F.look.colorMix = w; }
    },
    cam: function (t) {
      var c = Tn.L.colony, u = t / 6, ang = F.note.a0 + lerp(0, 1.45, u), rad = lerp(30, 58, smooth(u)), hgt = lerp(3.2, 30, smooth(u * 1.1));
      var px = c[0] + Math.sin(ang) * rad, pz = c[1] + Math.cos(ang) * rad;
      cine(px, ground(px, pz) + hgt, pz, c[0], Tn.height(c[0], c[1]) + lerp(5, 1.5, u), c[1], lerp(54, 46, u));
    }
  });

  // =====================================================================
  //  LAUNCH · the outpost's rocket lifts off into the night, and the title comes up
  // =====================================================================
  shot({ id: 'launch', look: NIGHT, frames: 177, world: 'mars', rate: function (t) { return t < 2.2 ? 1 : 1.5; },
    shake: function (t) { return t < 0.7 ? 0.45 : t < 2 ? 0.2 : 0.04; },
    begin: async function () {
      await mission({ site: 'mars', level: 'veteran', pioneer: true });
      stage({ envT: 0.995 });
      A.astro.mode = 'hidden'; beams(false); devils(false); G.mode = 'film';
      K.setStage(5);
      B.startLaunch(); B.launch.t = 1.72; F.emitKeep = 0.35;
      var base = B.rocketPos(V).clone(); base.y -= 10;
      var n = norm2(base.x, base.z);
      F.note.base = [base.x, base.y, base.z]; F.note.n = n;
      quiet(1);
    },
    frame: function (t) {
      var b = F.note.base, i;
      F.envT = 0.995;
    },
    cam: function (t) {
      var b = F.note.base, n = F.note.n, rp = B.rocketPos(V2), back = lerp(42, 76, smooth((t - 2) / 3.9)), up = lerp(1.6, 12, smooth((t - 2) / 3.9));
      var cx = b[0] + n[0] * back + n[1] * 6, cz = b[2] + n[1] * back - n[0] * 6, cy = ground(cx, cz) + up;
      var dist = Math.hypot(rp.x - cx, rp.z - cz), want = Math.atan2(rp.y - cy, dist) - (t > 2 ? 0.2 : 0.05), el = Math.min(want, 1.0);
      var sh = 0.36 * smooth((t - 1.6) / 1.2) * dist, lx = lerp(b[0], rp.x, 0.95) - n[1] * sh, lz = lerp(b[2], rp.z, 0.95) + n[0] * sh;      // the rocket moves to the right third, for the title
      cine(cx, cy, cz, lx, cy + Math.tan(el) * Math.hypot(lx - cx, lz - cz), lz, lerp(42, 40, smooth(t / 5.9)));
    },
    end: function () { F.emitKeep = null; }
  });

  window.__film = {
    info: function () {
      var gl = W.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { fps: FPS, gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
        shots: SHOTS.map(function (s) { return { id: s.id, frames: s.frames, world: s.world, note: '' }; }) };
    },
    begin: async function (id) {
      var s = byId[id]; F.shot = s; F.t = 0; F.T = s.at; F.prevT = s.at - 1e-6; F.cam = null; F.done = {}; F.hand = s.hand || 0; F.shakeMul = null; F.look = s.look || null; F.emitKeep = null;
      if (id !== 'run2' && id !== 'impact') { F.note = {}; F.envT = null; }
      W.cam.shake = 0;
      await s.begin();
      showOnly(s.ui); F.cam = s.cam || null;
      return true;
    },
    // one picture: sub (0..subs-1) splits a film frame into slices for motion blur
    frame: function (id, f, sub, subs) {
      var s = byId[id], t = (f + (sub || 0) / (subs || 1)) / FPS, i;
      F.t = t; F.T = s.at + t;
      if (s.shake) F.shakeMul = s.shake(t);
      if (s.frame) s.frame(t);
      accents(F.prevT, F.T); F.prevT = F.T;
      var secs = (s.rate ? s.rate(t) : 1) / FPS / (subs || 1), n = Math.max(1, Math.ceil(secs * 1000 / TICK - 1e-6)), ms = secs * 1000 / n;
      for (i = 0; i < n; i++) { F.skip = i < n - 1; C.tick(ms); }
      F.skip = false;
      applyUi(); drawCaps(F.T);
      return true;
    },
    finish: function (id) {
      var s = byId[id];
      if (s.end) s.end();
      if (id !== 'run1' && id !== 'race') halt();
      F.cam = null;
      return JSON.stringify(F.note, function (k, v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : v; }).slice(0, 500);
    }
  };
})();
