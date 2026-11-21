/* Astro Outpost — sound.
   - Recorded sound effects, loops and background beds, packed in js/sfx-data.js (made by tools/audio/).
     Any sound whose recording is missing falls back to a synthesized version, so the game is never silent.
   - The place decides how the world sounds: the Moon has no air, so outside you only hear what travels
     through your suit (muffled); thin Mars air dulls sounds a little; inside the lander everything is clear.
   - Sounds that have a place (machines, sparks, the rack) get quieter with distance and move left and right.
   - Voice lines are mp3 files: audio/landing/ (the film) and audio/voice/ (Mission Control on Earth).
     The Earth voices are recorded through a radio filter (tools/audio/build.js), so they sound the same from disk.
     Everything else dips a little while someone speaks.
   - Music is streamed from audio/music/.
   - Read-aloud for younger players uses the browser's speech voice. */
(function (JA) {
  'use strict';
  var PACK = JA.SFX || {}, META = PACK.meta || {}, DATA = PACK.data || {};
  var AC = window.AudioContext || window.webkitAudioContext, OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  var ctx = null, master = null, synthOut = null, duck = null, hushG = null, worldLP = null, bus = {};
  var on = true, reading = false, loops = {}, BUF = {}, waiting = {}, lastAt = {}, lastPick = {};
  var log = [];                                  // what was played lately ('tap', 'synth:tap', 'loop:rover', 'voice:rack-intro'): for tests
  function note(s) { log.push(s); if (log.length > 600) log.shift(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- the recordings ----------
  // Decoding does not need the sound to be switched on yet, so the short sounds are ready before the first click.
  var dec = null;
  try { if (OC) dec = new OC(1, 1, 44100); } catch (e) { dec = null; }
  function base(key) { return META[key] ? key : key.replace(/-\d+$/, ''); }
  function bytes(b64) { var bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  // A loop must not click where its end meets its start: cut the silence an mp3 carries at both ends,
  // then fade the tail into the head.
  function seamless(b) {
    var sr = b.sampleRate, d0 = b.getChannelData(0), n = b.length, a = 0, z = n - 1, th = 0.003;
    while (a < n && Math.abs(d0[a]) < th) a++;
    while (z > a && Math.abs(d0[z]) < th) z--;
    var len = z - a + 1, xf = Math.floor(Math.min(0.7 * sr, len * 0.2)), outLen = len - xf;
    if (outLen < sr * 0.5) return b;
    var out = dec.createBuffer(b.numberOfChannels, outLen, sr);
    for (var c = 0; c < b.numberOfChannels; c++) {
      var src = b.getChannelData(c), dst = out.getChannelData(c), i;
      for (i = 0; i < outLen; i++) dst[i] = src[a + i];
      for (i = 0; i < xf; i++) { var u = i / xf * 1.5708; dst[i] = src[a + i] * Math.sin(u) + src[a + outLen + i] * Math.cos(u); }
    }
    return out;
  }
  function decode(key, then) {
    if (BUF[key]) { if (then) then(BUF[key]); return; }
    if (!dec || !DATA[key]) return;
    if (waiting[key]) { if (then) waiting[key].push(then); return; }
    waiting[key] = then ? [then] : [];
    function bad() { delete waiting[key]; DATA[key] = null; }
    function ok(b) {
      try { BUF[key] = (META[base(key)] || {}).loop ? seamless(b) : b; } catch (e) { BUF[key] = b; }
      DATA[key] = null;                           // the packed text is no longer needed
      var w = waiting[key] || []; delete waiting[key];
      w.forEach(function (fn) { fn(BUF[key]); });
    }
    try { var p = dec.decodeAudioData(bytes(DATA[key]), ok, bad); if (p && p.catch) p.catch(function () { /* reported through bad() */ }); } catch (e) { bad(); }
  }
  Object.keys(DATA).forEach(function (key) { if (!(META[base(key)] || {}).loop) decode(key); });   // loops are decoded when first needed

  // ---------- the mixer ----------
  //  ui ───────────────────────────────────────────────┐
  //  fx ─────────────────────────────────┐             │
  //  world → place filter ┐              ├→ duck ──────┼→ master → limiter → speakers
  //  amb ─────────────────┴→ hush ───────┘             │
  //  synthesized stand-ins ────────────────────────────┘
  function ensure() {
    // 'interrupted' is what iOS Safari reports after a phone call or an app switch
    if (ctx) { if ((ctx.state === 'suspended' || ctx.state === 'interrupted') && !document.hidden) { try { ctx.resume(); } catch (e) { /* ignore */ } } return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      var lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(lim); lim.connect(ctx.destination);
      synthOut = ctx.createGain(); synthOut.gain.value = 0.62; synthOut.connect(master);
      duck = ctx.createGain(); duck.connect(master);
      hushG = ctx.createGain(); hushG.connect(duck);
      worldLP = ctx.createBiquadFilter(); worldLP.type = 'lowpass'; worldLP.frequency.value = 20000; worldLP.Q.value = 0.5; worldLP.connect(hushG);
      bus.ui = ctx.createGain(); bus.ui.connect(master);
      bus.fx = ctx.createGain(); bus.fx.connect(duck);
      bus.world = ctx.createGain(); bus.world.connect(worldLP);
      bus.amb = ctx.createGain(); bus.amb.connect(hushG);
      sceneDirty = true;
    } catch (e) { ctx = null; return false; }
    return true;
  }

  // ---------- synthesized sounds: the stand-ins, and the few that are meant to be pure tones ----------
  function tone(freq, dur, type, vol, delay, slide) {
    if (!on || !ensure()) return;
    var t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(synthOut);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, vol, delay, freq) {
    if (!on || !ensure()) return;
    var t = ctx.currentTime + (delay || 0), n = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = ctx.createBufferSource(); s.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1800;
    var g = ctx.createGain(); g.gain.value = vol || 0.2;
    s.connect(f); f.connect(g); g.connect(synthOut); s.start(t);
  }

  var S = {
    tap: function () { tone(520, 0.07, 'triangle', 0.14); },
    grab: function () { tone(330, 0.07, 'triangle', 0.16); tone(495, 0.09, 'triangle', 0.16, 0.05); },
    drop: function () { tone(300, 0.08, 'triangle', 0.12, 0, 200); },
    deny: function () { tone(160, 0.16, 'sawtooth', 0.12); },
    jump: function () { tone(300, 0.2, 'sine', 0.14, 0, 620); },
    land: function () { noise(0.12, 0.18, 0, 300); },
    thud: function () { noise(0.1, 0.22, 0, 220); tone(90, 0.12, 'sine', 0.2, 0, 50); },
    step: function () { noise(0.05, 0.05, 0, 500); },
    throw: function () { noise(0.22, 0.14, 0, 900); tone(420, 0.2, 'sine', 0.08, 0, 760); },
    plug: function () { tone(220, 0.08, 'square', 0.12); tone(440, 0.1, 'square', 0.12, 0.07); tone(880, 0.22, 'triangle', 0.16, 0.14); },
    score: function () { tone(880, 0.09, 'triangle', 0.2); tone(1320, 0.16, 'triangle', 0.2, 0.07); },
    swish: function () { [660, 880, 1100, 1320, 1760].forEach(function (f, i) { tone(f, 0.14, 'triangle', 0.2, i * 0.06); }); },
    ice: function () { tone(1400, 0.1, 'sine', 0.18); tone(2100, 0.2, 'sine', 0.14, 0.06); },
    ding: function () { tone(1046, 0.25, 'sine', 0.18); },
    air: function () { noise(0.5, 0.12, 0, 2400); tone(600, 0.4, 'sine', 0.1, 0, 900); },
    pop: function () { tone(500, 0.08, 'sine', 0.16, 0, 900); },
    warn: function () { tone(740, 0.16, 'square', 0.14); tone(560, 0.16, 'square', 0.14, 0.18); },
    click: function () { noise(0.03, 0.3, 0, 3200); },                       // the radiation counter: a click is a burst of noise
    spark: function () { noise(0.08, 0.2, 0, 4200); tone(1800, 0.05, 'square', 0.06); },
    door: function () { tone(220, 0.25, 'sine', 0.2, 0, 110); noise(0.25, 0.1, 0.05, 500); },
    page: function () { tone(660, 0.08, 'sine', 0.12); tone(880, 0.12, 'sine', 0.12, 0.07); },
    good: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.14, 'triangle', 0.18, i * 0.09); }); },
    hit: function () { tone(784, 0.1, 'triangle', 0.2); tone(1175, 0.16, 'triangle', 0.2, 0.08); },
    bad: function () { tone(330, 0.22, 'sawtooth', 0.1); tone(247, 0.34, 'sawtooth', 0.1, 0.18); },
    photo: function () { noise(0.05, 0.3, 0, 5000); noise(0.08, 0.2, 0.09, 2500); },
    discovery: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.2, i * 0.1); }); },
    win: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.2, 'triangle', 0.2, i * 0.12); }); },
    launch: function () { tone(60, 6, 'sawtooth', 0.22, 0, 240); noise(6, 0.3, 0, 400); },
    beep: function () { tone(880, 0.12, 'square', 0.12); },
    alarm: function () { [0, 0.3, 0.6].forEach(function (d) { tone(880, 0.2, 'square', 0.16, d); tone(660, 0.1, 'square', 0.12, d + 0.14); }); },
    // stand-ins for the newer sounds
    core: function () { S.hit(); },
    jam: function () { noise(0.3, 0.2, 0, 700); tone(140, 0.25, 'sawtooth', 0.12, 0, 70); },
    bag: function () { S.pop(); },
    brush: function () { S.pop(); },
    harvest: function () { S.grab(); },
    'rover-start': function () { S.grab(); },
    lose: function () { S.bad(); },
    low: function () { tone(520, 0.12, 'sine', 0.1); tone(390, 0.2, 'sine', 0.1, 0.14); },
    daystart: function () { S.good(); },
    night: function () { S.good(); },
    'storm-alert': function () { S.warn(); },
    // the landing film
    breath: function () { noise(1.5, 0.045, 0, 420); },
    hiss: function () { noise(1.6, 0.16, 0, 3200); tone(140, 0.5, 'sine', 0.16, 0.2, 70); },
    rumble: function () { noise(0.5, 0.2, 0, 170); },                        // a low shake under the engine
    touchdown: function () { noise(0.6, 0.4, 0, 150); tone(70, 0.5, 'sine', 0.3, 0, 36); noise(1.8, 0.1, 0.2, 900); },
    radio: function () { tone(2525, 0.16, 'sine', 0.05); noise(0.12, 0.05, 0.16, 2600); },
    pad: function () { [130.8, 196, 261.6, 329.6, 493.9].forEach(function (f, i) { tone(f, 9, 'sine', 0.06, i * 0.7); tone(f * 2.005, 9, 'sine', 0.018, i * 0.7 + 0.3); }); }
  };
  // Every message from Earth opens and closes with the two beeps real NASA radio used (Quindar tones),
  // and a short hiss as the radio opens and shuts.
  function radioKey(opening) { tone(opening ? 2525 : 2475, 0.25, 'sine', 0.05); noise(opening ? 0.16 : 0.12, 0.05, opening ? 0.22 : 0.18, 2600); }

  // ---------- where you are, and where things are ----------
  // lp: how much treble the place lets through; range: how far sounds carry (1 = normal)
  // sahrun: thick air carries sound clearly and far, as on Earth
  var ENV = { open: { lp: 20000, gain: 1, range: 1 }, moon: { lp: 1250, gain: 0.9, range: 0.6 }, mars: { lp: 3800, gain: 0.95, range: 0.85 }, sahrun: { lp: 9000, gain: 1, range: 1 }, 'in': { lp: 700, gain: 0.3, range: 1 } };
  // A planet's own wind, from the same recordings (no entry: Mars's): how loud the wind and the blowing sand are for
  // clear, dusty and stormy air, and how fast they play (slower = deeper). Sahrun: a deeper wind, and sand always skipping.
  var BEDTONE = { sahrun: { wind: [0.9, 0.8, 0.5], sand: [0.35, 0.65, 1], rate: 0.82 } };
  var env = ENV.open, ear = { x: 0, z: 0, rx: 1, rz: 0, on: false }, HERE = { g: 1, p: 0 };
  function ears(x, z, camera) {
    ear.x = x; ear.z = z; ear.on = true;
    if (camera && camera.matrixWorld) { var e = camera.matrixWorld.elements, l = Math.hypot(e[0], e[2]) || 1; ear.rx = e[0] / l; ear.rz = e[2] / l; }
  }
  function place(at, range) {        // how loud (g) and how far left or right (p) a sound at that spot is
    if (!at || !ear.on) return HERE;
    var dx = at.x - ear.x, dz = at.z - ear.z, d = Math.hypot(dx, dz), ref = (range || 12) * env.range, q = d / ref;
    var g = 1 / (1 + q * q);
    if (q > 5) g *= Math.max(0, 1 - (q - 5) / 2);
    return { g: g, p: d < 0.5 ? 0 : clamp((dx * ear.rx + dz * ear.rz) / d, -1, 1) * 0.75 * Math.min(1, d / 4) };
  }
  function panned(node, p) {
    if (!ctx.createStereoPanner || Math.abs(p) < 0.02) return node;
    var sp = ctx.createStereoPanner(); sp.pan.value = p; node.connect(sp); return sp;
  }

  // ---------- one-shot sounds ----------
  // o: { at: a position, vol, rate, delay }
  function sample(name, m, o) {
    var n = m.n || 1, key = name;
    if (n > 1) { var k = Math.floor(Math.random() * n); if (k === lastPick[name]) k = (k + 1) % n; lastPick[name] = k; if (k) key = name + '-' + (k + 1); }
    var b = BUF[key] || BUF[name];
    if (!b || !ensure()) return false;
    var t = ctx.currentTime;
    if (m.gap && lastAt[name] != null && t - lastAt[name] < m.gap) return true;       // too soon after the last one
    lastAt[name] = t;
    var pl = place(o.at, m.range), vol = (m.vol == null ? 0.5 : m.vol) * (o.vol == null ? 1 : o.vol) * pl.g;
    note(name);
    if (vol < 0.004) return true;
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * (m.pitch || 0));
    g.gain.value = vol; src.connect(g); panned(g, pl.p).connect(bus[m.bus] || bus.fx);
    src.start(t + (o.delay || 0));
    return true;
  }
  function play(name, o) {
    if (!on) return;
    var m = META[name];
    if (m && sample(name, m, o || {})) return;
    if (S[name]) { note('synth:' + name); S[name](); }
  }

  // ---------- continuous sounds ----------
  // p steers the sound while it runs: { rate, vol, at, fade } for a recording, { f, v, type } for its synthesized stand-in.
  function loop(name, p) {
    p = p || {};
    if (!on || !ensure()) { stopLoop(name); return; }
    var L = loops[name], m = META[name], t = ctx.currentTime;
    if (!L) {
      L = { g: ctx.createGain(), keep: !!p.keep, rate: p.rate || 1 };
      L.g.gain.value = 0.0001;
      if (m && (BUF[name] || DATA[name])) {
        L.sp = ctx.createStereoPanner && p.at ? ctx.createStereoPanner() : null;
        if (L.sp) { L.g.connect(L.sp); L.sp.connect(bus[m.bus] || bus.fx); } else L.g.connect(bus[m.bus] || bus.fx);
        // registered before decoding: a loop decoded earlier starts at once, inside decode()
        loops[name] = L;
        decode(name, function (b) {
          if (loops[name] !== L || L.src) return;
          L.src = ctx.createBufferSource(); L.src.buffer = b; L.src.loop = true; L.src.playbackRate.value = L.rate;
          L.src.connect(L.g); L.src.start(0, Math.random() * b.duration);
        });
        note('loop:' + name);
      } else if (p.f) {
        L.o = ctx.createOscillator(); L.o.type = p.type || 'sawtooth'; L.o.connect(L.g); L.g.connect(synthOut); L.o.start();
        loops[name] = L;
        note('synth-loop:' + name);
      } else return;
    }
    if (L.o) { L.o.frequency.setTargetAtTime(p.f || 100, t, 0.05); L.g.gain.setTargetAtTime(p.v == null ? 0.05 : p.v, t, 0.05); return; }
    var pl = place(p.at, m.range);
    L.rate = p.rate || 1;
    if (L.src) L.src.playbackRate.setTargetAtTime(L.rate, t, 0.08);
    L.g.gain.setTargetAtTime(Math.max(0.0001, (m.vol == null ? 0.5 : m.vol) * (p.vol == null ? 1 : p.vol) * pl.g), t, p.fade || 0.08);
    if (L.sp) L.sp.pan.setTargetAtTime(pl.p, t, 0.1);
  }
  function stopLoop(name, fade) {
    var L = loops[name]; if (!L) return;
    delete loops[name];
    try {
      var t = ctx.currentTime, f = fade || 0.04, node = L.o || L.src;
      L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0.0001, t, f);
      var off = function () { try { L.g.disconnect(); if (L.sp) L.sp.disconnect(); } catch (e) { /* already gone */ } };
      if (node) { node.onended = off; node.stop(t + f * 6 + 0.05); } else off();
    } catch (e) { /* already stopped */ }
  }
  // hums and beds belong to the place, not to one action: they survive stopAll() and are steered every frame
  function hum(name, want, at, vol) { if (want) loop(name, { at: at, vol: vol, keep: true, fade: 0.25 }); else stopLoop(name, 0.25); }

  // ---------- the scene: how the world is filtered, and which background beds play ----------
  var sceneKey = '', sceneDirty = false, beds = {}, bedTone = null, hushed = false, BEDS = ['amb-suit', 'amb-mars-wind', 'amb-mars-dust', 'amb-hab', 'amb-storm'];
  // o.place: 'out' on the surface, 'in' the habitat; anything else (menus, the lander cabin) is clear and has no bed
  // o.site: a planet id (see JA.SITES); o.dust: 0 to 1; o.storm: 0 none, 1 warning, 2 raging
  function scene(o) {
    var dust = o.dust > 0.7 ? 2 : o.dust > 0.2 ? 1 : 0, storm = o.storm | 0;
    var key = [o.place, o.site, dust, storm].join();
    if (key === sceneKey) return;
    sceneKey = key;
    // outdoors you hear the planet: wind only where there is air, blowing dust only where there is dust
    var out = o.place === 'out', inn = o.place === 'in', P = o.site && JA.SITES[o.site] ? JA.siteOf(o.site) : null;
    var air = !!P && P.atmosphere !== 'none', dusty = !!P && P.dusty;
    env = out ? (P ? JA.pick(P, ENV) : ENV.open) : inn ? ENV['in'] : ENV.open;
    bedTone = P && BEDTONE[P.id] || null;
    beds = {
      'amb-suit': out ? (air ? 0.8 : 1) : 0,
      'amb-mars-wind': out && air ? (bedTone ? bedTone.wind : [1, 0.7, 0.4])[dust] : 0,
      'amb-mars-dust': out && dusty ? (bedTone ? bedTone.sand : [0, 0.5, 1])[dust] : 0,
      'amb-hab': inn ? 1 : 0,
      'amb-storm': storm === 2 ? (out ? 1 : inn ? 0.4 : 0) : storm === 1 ? (out ? 0.35 : inn ? 0.15 : 0) : 0
    };
    sceneDirty = true;
  }
  function applyScene() {
    if (!ctx || !on) return;
    sceneDirty = false;
    var t = ctx.currentTime;
    worldLP.frequency.setTargetAtTime(env.lp, t, 0.25);
    bus.world.gain.setTargetAtTime(env.gain, t, 0.25);
    BEDS.forEach(function (name) {
      var rate = bedTone && (name === 'amb-mars-wind' || name === 'amb-mars-dust') ? bedTone.rate : undefined;
      if (beds[name] > 0) loop(name, { vol: beds[name], keep: true, fade: 0.7, rate: rate }); else stopLoop(name, 0.7);
    });
  }
  // a pop-up card pauses the game: the world drops back, like holding your breath
  function hush(v) {
    v = !!v;
    if (v === hushed || !ctx) return;
    hushed = v; hushG.gain.setTargetAtTime(v ? 0.3 : 1, ctx.currentTime, 0.2);
  }

  // ---------- breathing inside the helmet: slow at rest, quicker after a run ----------
  var breathT = 2.5, effort = 0;
  function breathe(dt, running) {
    effort += ((running ? 1 : 0) - effort) * Math.min(1, dt * (running ? 0.5 : 0.22));
    breathT -= dt * (1 + effort * 1.6);
    if (breathT <= 0) { breathT = 4.2; play('breath', { vol: 0.55 + effort * 0.9, rate: 1 + effort * 0.25 }); }
  }

  // ---------- voices ----------
  // A plain <audio> element, so the lines also play when the game is opened straight from disk.
  // One voice at a time: a new line cuts the one before.
  var voices = {}, voiceEl = null, VOX = 'audio/voice/';
  var lineQ = [], lineOn = false, lineKeyed = false, lineTimer = null, lineAt = 0;
  function preloadVoice(src) {
    if (!voices[src]) { var a = new Audio(); a.preload = 'auto'; a.src = src; voices[src] = a; }
    return voices[src];
  }
  function cut() { if (voiceEl) { var a = voiceEl; voiceEl = null; a.onended = a.onerror = null; try { a.pause(); } catch (e) { /* not started */ } } }
  function stopVoice() { if (lineTimer) { clearTimeout(lineTimer); lineTimer = null; } lineQ = []; lineOn = false; lineKeyed = false; cut(); }
  function startClip(src, then) {
    cut();
    var a = preloadVoice(src), done = false;
    function fin() { if (done) return; done = true; a.onended = a.onerror = null; if (voiceEl === a) { voiceEl = null; if (then) then(); } }
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    a.volume = 0.9; voiceEl = a; a.onended = fin; a.onerror = fin;
    var p = a.play();
    if (p && p.catch) p.catch(fin);              // blocked or missing file: the words are still on screen
    return a;
  }
  // the landing film: one clip, by its path
  function voice(src) { stopVoice(); if (window.speechSynthesis) window.speechSynthesis.cancel(); note('voice:' + src); return startClip(src); }
  function lineNext() {
    lineTimer = null;
    var id = lineQ.shift();
    if (!id) { var keyed = lineKeyed; lineOn = false; lineKeyed = false; if (keyed) radioKey(false); return; }
    lineAt = Date.now(); startClip(VOX + id + '.mp3', lineNext);
  }
  // Mission Control: one line, or several in a row, by id (see js/audio-list.js).
  // Returns true when a recording will be heard. o.plain: no radio beeps around it.
  function line(ids, o) {
    var L = JA.VOICE || {};
    if (typeof ids === 'string') ids = [ids];
    ids = (ids || []).filter(function (id) { return id && L[id]; });
    if (!ids.length || !(on || reading)) return false;
    stopVoice();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    ids.forEach(function (id) { preloadVoice(VOX + id + '.mp3'); });
    lineQ = ids.slice(); lineOn = true; lineAt = Date.now();
    note('voice:' + ids.join('+'));
    if (o && o.plain) { lineNext(); return true; }
    lineKeyed = true; radioKey(true);
    lineTimer = setTimeout(lineNext, 380);
    return true;
  }
  function voicePlaying() { return lineOn || !!(voiceEl && !voiceEl.paused && !voiceEl.ended); }
  // Which recorded line says these words? The exact words first, then the patterns for bubbles whose words change.
  var byText = null;
  function norm(t) { return String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  JA.voiceFor = function (text) {
    var L = JA.VOICE || {}, M = JA.VOICE_MATCH || [], t = norm(text), id, i;
    if (!byText) { byText = {}; for (id in L) byText[norm(L[id].t)] = id; }
    if (byText[t]) return byText[t];
    for (i = 0; i < M.length; i++) if (L[M[i][1]] && t.indexOf(M[i][0]) === 0) return M[i][1];
    return null;
  };

  var speakTimer = null;
  function speak(text) {
    if (!reading || !window.speechSynthesis) return;
    try {
      var synth = window.speechSynthesis;
      var u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, ''));
      u.rate = 0.95; u.pitch = 1.15; u.lang = 'en-US';
      // Safari and Firefox drop a line that is spoken in the same instant as cancel(), so leave a short gap
      if (speakTimer) clearTimeout(speakTimer);
      if (synth.speaking || synth.pending) synth.cancel();
      speakTimer = setTimeout(function () { speakTimer = null; try { if (reading) synth.speak(u); } catch (e) { /* speech not available */ } }, 70);
    } catch (e) { /* speech not available */ }
  }
  function quiet() { if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; } try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }

  // ---------- music ----------
  var MUS = 'audio/music/', mus = { name: null, el: null, vol: 0, top: 0, old: [] };
  function tryPlay(a) { try { var p = a.play(); if (p && p.catch) p.catch(function () { /* waits for the first click */ }); } catch (e) { /* not ready */ } }
  // Fade to a piece of music (by id, see js/audio-list.js), or to silence with music(null).
  // Returns true when that music exists.
  function music(name) {
    var M = JA.MUSIC || {};
    if (name && !M[name]) name = null;
    if (name === mus.name) return !!name;
    if (mus.el) mus.old.push({ el: mus.el, vol: mus.vol });
    mus.name = name; mus.el = null; mus.vol = 0;
    if (name) {
      var a = new Audio(); a.preload = 'auto'; a.src = MUS + name + '.mp3'; a.loop = !!M[name].loop; a.volume = 0;
      a.onended = function () { if (mus.el === a) { mus.el = null; mus.name = null; } };
      mus.el = a; mus.top = M[name].v == null ? 0.5 : M[name].v;
      note('music:' + name);
      if (on && !document.hidden) tryPlay(a);
    }
    return !!name;
  }
  function musicFrame(dt, talking) {
    if (mus.el) {
      var want = on ? mus.top * (talking ? 0.45 : 1) : 0;
      mus.vol += clamp(want - mus.vol, -dt * 0.6, dt * 0.45);
      mus.el.volume = clamp(mus.vol, 0, 1);
    }
    for (var i = mus.old.length - 1; i >= 0; i--) {
      var o = mus.old[i]; o.vol -= dt * 0.5;
      if (o.vol <= 0) { try { o.el.pause(); } catch (e) { /* never started */ } mus.old.splice(i, 1); } else o.el.volume = clamp(o.vol, 0, 1);
    }
  }

  // ---------- once a frame ----------
  var ducked = false;
  function frame(dt) {
    var talking = voicePlaying();
    if (lineOn && Date.now() - lineAt > 25000) stopVoice();          // a clip that never started must not hold the others up
    if (ctx && on) {
      if (sceneDirty) applyScene();
      if (talking !== ducked) { ducked = talking; duck.gain.setTargetAtTime(talking ? 0.5 : 1, ctx.currentTime, talking ? 0.08 : 0.4); }
    }
    musicFrame(dt, talking);
  }

  // the game stops while the tab is hidden, so every sound waits too
  document.addEventListener('visibilitychange', function () {
    var hidden = document.hidden;
    if (ctx) { try { if (hidden) ctx.suspend(); else if (on) ctx.resume(); } catch (e) { /* closed */ } }
    if (voiceEl && !voiceEl.ended) { if (hidden) voiceEl.pause(); else tryPlay(voiceEl); }
    if (mus.el) { if (hidden) mus.el.pause(); else if (on) tryPlay(mus.el); }
  });

  function stopLoops(all) { Object.keys(loops).forEach(function (name) { if (all || !loops[name].keep) stopLoop(name); }); }

  JA.audio = {
    play: play,
    loop: loop, stopLoop: stopLoop, hum: hum,
    stopAll: function () { stopLoops(false); stopVoice(); },      // the action stops; beds, hums and music follow the scene
    unlock: function () { var ok = ensure(); if (mus.el && mus.el.paused && on) tryPlay(mus.el); return ok; },
    setSound: function (v) {
      on = v;
      if (!v) { stopLoops(true); if (!reading) stopVoice(); if (mus.el) mus.el.pause(); }
      else { sceneDirty = true; if (mus.el) tryPlay(mus.el); }
    },
    soundOn: function () { return on; },
    scene: scene, ears: ears, hush: hush, breathe: breathe, frame: frame,
    voice: voice, line: line, stopVoice: stopVoice, voicePlaying: voicePlaying, preloadVoice: preloadVoice,
    music: music, musicOn: function () { return !!mus.name; },
    setReading: function (v) { reading = v; if (!v && window.speechSynthesis) window.speechSynthesis.cancel(); },
    readingOn: function () { return reading; },
    canRead: function () { return !!window.speechSynthesis; },
    speak: speak,
    // for tests and the soundboard
    debug: { log: log, ready: function () { return Object.keys(BUF); }, pending: function () { return Object.keys(waiting); }, loops: function () { return Object.keys(loops); },
      playing: function () { return Object.keys(loops).filter(function (n) { return loops[n].src || loops[n].o; }); }, meta: META, synth: Object.keys(S), scene: function () { return sceneKey; } }
  };
})(window.JA);
