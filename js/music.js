/* Astro Outpost — quiet background music, made live with the Web Audio API (no audio files).
   Slow, soft chords that fade in and out, now and then a single bell note, and a low hum in a storm.
   The game picks a mood (title, work, storm, crisis, night, launch) and a site (Moon or Mars);
   this file does the rest. It has its own AudioContext, stays well below the sound effects in
   audio.js, and does nothing at all until unlock() is called from a tap or a key press. */
(function (JA) {
  'use strict';
  var MASTER = 0.35;   // loudness of the whole music bus: the one number to change if it is too loud or too quiet (keep it at or under 0.5)
  var CAP = 16;        // most oscillators that may be alive at once
  var TICK = 250;      // ms between scheduler runs
  var AHEAD = 0.6;     // s of music that is scheduled ahead of the audio clock
  var XFADE = 2.5;     // s for the old mood to fade away when the mood changes
  var GAINS = [0.034, 0.03, 0.028, 0.024, 0.02];   // pad voices from low to high (the film's pad uses 0.06)
  var SHIMMER = 0.007, BELL = 0.016, HUM = 0.03;

  // Notes are MIDI numbers (60 = middle C, 69 = the A at 440 Hz) and all of them are white keys.
  //   n: pad notes from low to high     s: very quiet notes high above them
  //   c: a bell may also play C here    to: the chords that may come next
  // One chord fades in while the last one fades out, so notes a half step apart (E and F, B and C)
  // are never put next to each other in chords that can follow one another.
  var CALM = {
    C: { n: [48, 55, 60, 64, 71], s: [79, 76], to: ['Am', 'Em', 'F', 'G'] },   // Cmaj7, the landing film chord
    Am: { n: [45, 55, 60, 64, 71], s: [76, 81], to: ['C', 'F', 'Em', 'G'] },   // Am7(9)
    F: { n: [53, 57, 60, 64, 69], s: [76, 81], c: true, to: ['C', 'Am'] },     // Fmaj7
    G: { n: [43, 50, 55, 64, 71], s: [74, 79], to: ['C', 'Em', 'Am'] },        // G6
    Em: { n: [52, 62, 67, 71, 76], s: [79, 83], to: ['C', 'G', 'Am'] }         // Em7
  };
  var NIGHT = {
    C: { n: [48, 55, 64], to: ['Am', 'F', 'G'] },
    Am: { n: [45, 60, 64], to: ['C', 'F', 'G'] },
    F: { n: [45, 53, 60], to: ['C', 'Am'] },          // F over A
    G: { n: [43, 50, 62], to: ['C', 'Am'] }           // a bare G and D
  };
  var STORM = {
    Am: { n: [45, 57, 60, 64], to: ['F', 'Dm', 'Em'] },
    F: { n: [53, 57, 60, 64], to: ['Am', 'Dm'] },     // Fmaj7
    Dm: { n: [45, 53, 57, 62], to: ['Am', 'F'] },     // Dm over A
    Em: { n: [52, 64, 67, 71], to: ['Am'] }
  };
  var CRISIS = {
    sus: { n: [45, 57, 62, 71, 76], to: ['sus'] }     // A A D B E: open and unresolved, held with a slow pulse
  };
  var LAUNCH = {
    C: { n: [48, 55, 60, 64, 71], s: [79, 76], to: ['F'] },
    F: { n: [53, 60, 64, 69, 76], s: [81, 88], c: true, to: ['G'] },
    G: { n: [55, 62, 71, 76, 79], s: [83, 86], to: ['C'] }
  };
  var BELLS = [74, 76, 79, 81, 86, 88], BELLS_C = [72, 84];   // D E G A, and C over an F chord

  // every: s from one chord to the next   atk, rel: fade in and fade out
  // lead: the fade out starts this long before the next chord   stag: delay between the voices of a chord
  // lv: loudness   shim: how many of the quiet high notes   bell: s from one bell note to the next
  // lock: tune each note to a whole number of waves per chord, so the repeats stay in step (a steady pulse)
  var MOODS = {
    title: { set: CALM, first: 'C', every: [10, 13], atk: 3.5, rel: 4, lead: 1.5, stag: 0.35, lv: 1.05, shim: 2, bell: [5, 8] },
    work: { set: CALM, first: 'C', every: [10, 14], atk: 3.5, rel: 4, lead: 1.5, stag: 0.35, lv: 1, shim: 1, bell: [5, 9] },
    night: { set: NIGHT, first: 'Am', every: [14, 18], atk: 4, rel: 4, lead: 1.5, stag: 0.6, lv: 1, shim: 0 },
    storm: { set: STORM, first: 'Am', every: [10, 13], atk: 3.5, rel: 4, lead: 1.5, stag: 0.35, lv: 0.95, shim: 0, drone: true },
    crisis: { set: CRISIS, first: 'sus', every: [5, 5], atk: 2, rel: 2.6, lead: 1.3, stag: 0, lv: 0.95, shim: 0, lock: true },
    launch: { set: LAUNCH, first: 'C', every: [7, 8], atk: 3, rel: 3.5, lead: 1.5, stag: 0.3, lv: 1.05, shim: 2, bell: [3, 5] }
  };
  // st: key change in half steps   cut: low-pass in Hz   shim: how much of the quiet high notes
  // hum: a soft low hum under the calm music too (the storm hum, quieter), for a wide empty place
  var PLAIN = { st: 0, cut: 2500, shim: 1 };
  var SITES = {
    moon: { st: 2, cut: 2800, shim: 1.3 },    // a little higher and colder
    mars: { st: -5, cut: 2000, shim: 0.6 },   // a fifth below the Moon, and warmer
    sahrun: { st: -3, cut: 2300, shim: 0.8, hum: 0.45 }    // between the two, warm, over the hum of the open desert
  };

  var ctx = null, lp = null, out = null, timer = null, fails = 0;
  var on = true, hushed = false, busOpen = false, mood = 'off', site = PLAIN;
  var seq = null;        // the mood that is playing now: its chords, its timings and its own fader
  var voices = [];       // every oscillator that has not finished yet
  var dying = [];        // faders of moods that are fading away
  var quietUntil = 0;    // after the music is switched off, nothing new starts before this time

  function wake() {
    // 'interrupted' is what iOS Safari reports after a phone call or an app switch
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      try { var p = ctx.resume(); if (p && p.then) p.then(null, function () { /* ignore */ }); } catch (e) { /* ignore */ }
    }
  }
  function ensure() {
    if (ctx) { wake(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext, c = null;
    if (!AC) return false;
    try {
      c = new AC();
      lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = site.cut; lp.Q.value = 0.7;
      out = c.createGain(); busOpen = on && !hushed; out.gain.value = busOpen ? MASTER : 0;
      lp.connect(out); out.connect(c.destination);
      ctx = c;
    } catch (e) {
      try { if (c && c.close) c.close(); } catch (e2) { /* ignore */ }
      ctx = null; return false;
    }
    wake();
    return true;
  }

  function hz(m) { return 440 * Math.pow(2, (m + site.st - 69) / 12); }
  function soft(f) { return f > 440 ? Math.sqrt(440 / f) : 1; }   // high notes are played more softly
  function between(a, b) { return a + Math.random() * (b - a); }
  function cents(c) { return Math.pow(2, (Math.random() * 2 - 1) * c / 1200); }   // a tiny random detune
  function liveAt(t) {
    var n = 0, i;
    for (i = 0; i < voices.length; i++) if (voices[i].end > t) n++;
    return n;
  }

  // One oscillator with its own loudness (and place between left and right). It is given its stop time
  // straight away, so nothing can be left running; sweep() unplugs it once that time has passed.
  function voice(type, f, t0, tEnd, width, drift, into) {
    var o = ctx.createOscillator(), g = ctx.createGain(), p = null, v;
    o.type = type; o.frequency.value = f; g.gain.value = 0;
    o.connect(g);
    if (width && ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.setValueAtTime((Math.random() * 2 - 1) * width, t0);
      if (drift) p.pan.linearRampToValueAtTime((Math.random() * 2 - 1) * width, tEnd);
      g.connect(p); p.connect(into || seq.layer.g);
    } else g.connect(into || seq.layer.g);
    o.start(t0); o.stop(tEnd);
    v = { o: o, g: g, p: p, x: null, end: tEnd, layer: seq.layer };
    voices.push(v);
    return v;
  }
  // slow rise from silence, hold, slow fall back to silence
  function swell(param, peak, t0, atk, tRel, rel) {
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(peak, Math.min(t0 + atk, tRel));
    param.setValueAtTime(peak, tRel);
    param.linearRampToValueAtTime(0, tRel + rel);
  }

  // The next chord: one of the allowed followers, never the same chord twice in a row,
  // and not straight back to the one before if there is another choice.
  function follow(set, last, prev) {
    var to = set[last].to, pick = [], i;
    for (i = 0; i < to.length; i++) if (to[i] !== last && to[i] !== prev) pick.push(to[i]);
    if (!pick.length) for (i = 0; i < to.length; i++) if (to[i] !== last) pick.push(to[i]);
    if (!pick.length) return last;   // a mood with only one chord (crisis)
    return pick[Math.floor(Math.random() * pick.length)];
  }
  function chord(t0) {
    var cfg = seq.cfg, name = seq.last === null ? cfg.first : follow(cfg.set, seq.last, seq.prev);
    var c = cfg.set[name], n = c.n.length, every = between(cfg.every[0], cfg.every[1]);
    var tRel = t0 + every - cfg.lead, atk = seq.quick && seq.last === null ? Math.min(cfg.atk, XFADE) : cfg.atk, i, f, t, v;
    if (liveAt(t0) + n > CAP) return false;   // no room yet: try again on the next run
    for (i = 0; i < n; i++) {
      f = hz(c.n[i]);
      if (cfg.lock) f = Math.round(f * every) / every; else f *= cents(4);
      t = t0 + i * cfg.stag;
      v = voice('sine', f, t, tRel + cfg.rel + 0.05, 0.12 + 0.09 * i, true);
      swell(v.g.gain, GAINS[i] * cfg.lv * soft(f), t, atk, tRel, cfg.rel);
    }
    for (i = 0; i < cfg.shim && i < c.s.length; i++) {
      if (liveAt(t0) + 1 > CAP) break;
      f = hz(c.s[i]) * 1.0025 * cents(2);
      t = t0 + (n + i) * cfg.stag;
      v = voice('triangle', f, t, tRel + cfg.rel + 0.05, 0.5, true);
      swell(v.g.gain, SHIMMER * site.shim * cfg.lv * soft(f), t, atk, tRel, cfg.rel);
    }
    if (seq.last === null) seq.nextBell = t0 + between(4, 7);
    seq.prev = seq.last; seq.last = name; seq.chord = c; seq.chordAt = t0; seq.nextChord = t0 + every;
    return true;
  }
  // a single soft sine note that rings out
  function bell(t) {
    var c = seq.chord, list = BELLS, pick = [], i, f, peak, dec, v;
    if (c.c && t > seq.chordAt + 3 && t < seq.nextChord - 1.5) list = BELLS.concat(BELLS_C);
    for (i = 0; i < list.length; i++) if (list[i] !== seq.lastBell) pick.push(list[i]);
    seq.lastBell = pick[Math.floor(Math.random() * pick.length)];
    if (liveAt(t) + 1 > CAP) return;
    f = hz(seq.lastBell) * cents(2); peak = BELL * soft(f); dec = between(2, 3);
    v = voice('sine', f, t, t + dec + 0.1, 0.5, false);
    v.g.gain.setValueAtTime(0, t);
    v.g.gain.linearRampToValueAtTime(peak, t + 0.03);
    v.g.gain.exponentialRampToValueAtTime(peak * 0.004, t + dec);
    v.g.gain.linearRampToValueAtTime(0, t + dec + 0.08);
  }
  // The storm hum: a low A (in the key of the site) and the A above it, with the loudness swaying slowly.
  // It is played in long pieces that hand over to each other; each piece holds a whole number of waves,
  // so the hand-over is seamless.
  function drone(t0, k) {
    var len = 20, fade = 4, f = hz(33), tEnd = t0 + len + fade + 0.05, trem, v, i;
    k = k || 1;
    if (liveAt(t0) + 3 > CAP) return false;
    while (f < 50) f *= 2;
    f = Math.round(f * len) / len;
    trem = ctx.createGain(); trem.gain.value = 1; trem.connect(seq.layer.g);
    for (i = 0; i < 2; i++) {
      v = voice('sine', f * (i + 1), t0, tEnd, 0, false, trem);
      swell(v.g.gain, HUM * k * (1 - i * 0.4), t0, fade, t0 + len, fade);
    }
    v = voice('sine', 0.5, t0, tEnd, 0, false, trem.gain);   // sways the hum up and down by 30%
    v.g.gain.value = 0.3; v.x = trem;
    seq.nextDrone = t0 + len;
    return true;
  }

  function cut(v, at) {
    if (at < v.end) { try { v.o.stop(at); v.end = at; } catch (e) { /* it ends at its own time instead */ } }
  }
  function unplug(node) { if (node) { try { node.disconnect(); } catch (e) { /* ignore */ } } }
  // unplug everything that has finished
  function sweep(now) {
    var i, v;
    for (i = voices.length - 1; i >= 0; i--) {
      v = voices[i];
      if (v.end <= now) { unplug(v.o); unplug(v.g); unplug(v.p); unplug(v.x); voices.splice(i, 1); }
    }
    for (i = dying.length - 1; i >= 0; i--) {
      if (dying[i].end <= now) { unplug(dying[i].g); dying.splice(i, 1); }
    }
  }
  function run() {
    var now = ctx.currentTime, cfg, t;
    sweep(now);
    if (!seq) {
      if (!voices.length && !dying.length) { clearInterval(timer); timer = null; }
      return;
    }
    cfg = seq.cfg;
    // anything that is due soon is scheduled once; a late timer skips ahead instead of catching up
    if (seq.nextChord <= now + AHEAD) {
      t = Math.max(seq.nextChord, now + 0.05);
      if (!chord(t)) seq.nextChord = now + 0.3;
    }
    var hum = cfg.drone ? 1 : seq.cfg !== MOODS.crisis && site.hum ? site.hum : 0;      // the storm hum, or a planet's own quiet one
    if (hum && seq.nextDrone <= now + AHEAD) {
      t = Math.max(seq.nextDrone, now + 0.05);
      if (!drone(t, hum)) seq.nextDrone = now + 0.3;
    }
    if (cfg.bell && seq.chord && seq.nextBell <= now + AHEAD) {
      t = Math.max(seq.nextBell, now + 0.05);
      seq.nextBell = t + between(cfg.bell[0], cfg.bell[1]);
      bell(t);
    }
  }
  function tick() {
    try { run(); fails = 0; } catch (e) {
      // something is badly wrong with audio on this device: give up quietly
      if (++fails > 3) { seq = null; if (timer) { clearInterval(timer); timer = null; } }
    }
  }

  // quick: this mood takes over from another one, so its first chord fades in as fast as the old one fades out
  function begin(delay, quick) {
    var t = Math.max(ctx.currentTime, quietUntil) + (delay || 0.05), g = ctx.createGain();
    g.gain.value = 1; g.connect(lp);
    seq = { mood: mood, cfg: MOODS[mood], layer: { g: g, end: 0 }, quick: quick, last: null, prev: null, chord: null, chordAt: 0,
      nextChord: t, nextDrone: t, nextBell: Infinity, lastBell: 0 };
    fails = 0;
    if (!timer) timer = setInterval(tick, TICK);
  }
  // fade the playing mood away; its notes stop when the fade is done
  function retire(fade) {
    var now = ctx.currentTime, L = seq.layer, i;
    L.end = now + fade + 0.1;
    L.g.gain.setValueAtTime(1, now);
    L.g.gain.linearRampToValueAtTime(0, now + fade);
    for (i = 0; i < voices.length; i++) if (voices[i].layer === L) cut(voices[i], L.end);
    dying.push(L); seq = null;
  }
  // stop every note at this time (the bus has faded to silence by then)
  function silence(at) {
    var i;
    if (seq) { seq.layer.end = at; dying.push(seq.layer); seq = null; }
    for (i = 0; i < dying.length; i++) if (dying[i].end > at) dying[i].end = at;
    for (i = 0; i < voices.length; i++) cut(voices[i], at);
    quietUntil = at;
  }
  // make what is playing match what is wanted (sound on or off, hushed or not, mood, site)
  function apply(restart, delay) {
    if (!ctx) return;
    var now = ctx.currentTime, want = on && !hushed, quick = false;
    if (want !== busOpen) {
      busOpen = want;
      out.gain.cancelScheduledValues(now);
      if (want) out.gain.setTargetAtTime(MASTER, Math.max(now, quietUntil), 0.25);
      else if (hushed) { out.gain.setTargetAtTime(0, now, 0.04); silence(now + 0.3); }
      else { out.gain.setTargetAtTime(0, now, 0.08); silence(now + 0.5); }
    }
    if (!busOpen) return;
    if (seq && (restart || seq.mood !== mood)) { retire(XFADE); quick = !delay; }
    if (!seq && mood !== 'off') { begin(delay, quick); tick(); }
  }

  function setMood(name) {
    name = MOODS.hasOwnProperty(name) ? name : 'off';
    if (name === mood && !hushed) return;
    mood = name; hushed = false;
    apply();
  }
  function setSite(id) {
    // a planet without a key of its own plays in the key of the planet it is "like" (JA.SITES); anything else is the title key
    var s = SITES.hasOwnProperty(id) ? SITES[id] : JA.SITES && JA.SITES[id] ? JA.pick(id, SITES) : PLAIN, moved = s.st !== site.st;
    if (s === site) return;
    site = s;
    if (!ctx) return;
    lp.frequency.setTargetAtTime(s.cut, ctx.currentTime, 0.5);
    // a new key: let the old one fade almost away before the new one comes in
    if (moved && seq) apply(true, 2.2);
  }
  function safe(fn) {
    return function (a) { try { return fn(a); } catch (e) { return false; } };
  }

  JA.music = {
    // call from a tap or a key press; safe to call again and again
    unlock: safe(function () { if (!ensure()) return false; apply(); return true; }),
    setOn: safe(function (v) { on = !!v; apply(); }),
    isOn: function () { return on; },
    // 'off', 'title', 'work', 'storm', 'crisis', 'night' or 'launch'; anything else counts as 'off'
    setMood: safe(setMood),
    // 'moon' or 'mars'; anything else is the plain key of the title screen
    setSite: safe(setSite),
    // quick fade to silence that keeps the mood (the tab was hidden); resume() or the next setMood() undoes it
    hush: safe(function () { hushed = true; apply(); }),
    resume: safe(function () { if (ctx) wake(); if (hushed) { hushed = false; apply(); } })
  };
})(window.JA);
