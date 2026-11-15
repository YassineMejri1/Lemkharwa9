#!/usr/bin/env node
/* Astro Outpost film — the score, made entirely in code (no samples, nothing downloaded).
   An energetic trailer cue at 120 beats a minute in A minor, 29.9 seconds long, written for the cut in
   director.js: every section change and every big hit falls on a cut. Change one, change the other.

     node tools/film/score.js <out.wav>

   The instruments: detuned saw pads and "braam" hits, a plucked arpeggio with a ping-pong echo, a driving
   bass, bells, and drums made from sine sweeps and noise. Pads, bass and arpeggio duck under the kick.
   A hall reverb glues it together. The result is peak-normalised; build.js sets the final loudness. */
'use strict';
const fs = require('fs');
const SR = 48000, LEN = 29.9, N = Math.ceil(LEN * SR);

// ---------------------------------------------------------------- building blocks
let seed = 1977;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dB = (d) => Math.pow(10, d / 20);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const Bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const BUS = { kick: Bus(), drums: Bus(), cym: Bus(), bass: Bus(), pad: Bus(), arp: Bus(), bell: Bus(), braam: Bus(), fx: Bus() };
const KICKS = [];

// one sound: fn(x) gives a sample x seconds after it starts; pan -1 (left) .. 1 (right)
function voice(bus, t0, len, pan, fn) {
  const a = Math.round(t0 * SR), n = Math.round(len * SR), gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  for (let i = 0; i < n; i++) {
    const k = a + i; if (k >= N) break;
    const v = fn(i / SR);
    if (k < 0) continue;
    bus.L[k] += v * gl; bus.R[k] += v * gr;
  }
}
// band-limited oscillators (polyBLEP), so the saws do not fizz
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
function saw() { let ph = rnd(); return (f) => { const dt = f / SR; const v = 2 * ph - 1 - blep(ph, dt); ph += dt; if (ph >= 1) ph -= 1; return v; }; }
function sqr() { let ph = rnd(); return (f) => { const dt = f / SR; let v = ph < 0.5 ? 1 : -1; v += blep(ph, dt); v -= blep((ph + 0.5) % 1, dt); ph += dt; if (ph >= 1) ph -= 1; return v; }; }
function sine(start) { let ph = start == null ? rnd() : start; return (f) => { ph += f / SR; if (ph >= 1) ph -= 1; return Math.sin(2 * Math.PI * ph); }; }
// a state-variable filter (topology-preserving), run once per sample: .lp .bp .hp
function svf() {
  let ic1 = 0, ic2 = 0; const o = { lp: 0, bp: 0, hp: 0 };
  o.run = (x, fc, q) => {
    const g = Math.tan(Math.PI * clamp(fc, 12, SR * 0.45) / SR), k = 1 / q, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; o.lp = v2; o.bp = v1; o.hp = x - k * v1 - v2; return v2;
  };
  return o;
}

// ---------------------------------------------------------------- instruments
const DET = [-0.12, -0.055, 0, 0.055, 0.12];      // supersaw detune, in semitones
function pad(t0, t1, notes, o) {
  o = o || {};
  const att = o.att == null ? 0.05 : o.att, rel = o.rel == null ? 0.3 : o.rel, len = t1 - t0 + rel, hold = t1 - t0;
  notes.forEach((m, ni) => DET.forEach((d, di) => {
    const osc = saw(), f = mtof(m + d), flt = svf(), pan = ((di - 2) / 2) * 0.85 * (ni % 2 ? 1 : -1);
    voice(BUS.pad, t0, len, pan, (x) => {
      const T = t0 + x, e = (x < att ? x / att : 1) * (x > hold ? Math.max(0, 1 - (x - hold) / rel) : 1);
      return flt.run(osc(f), o.cut ? o.cut(T) : 2000, 0.75) * e * 0.05 * (o.gain ? o.gain(T) : 1);
    });
  }));
}
function braam(t, notes, len, vel) {
  notes.forEach((m, ni) => [-0.2, -0.09, 0, 0.09, 0.2].forEach((d, di) => {
    const osc = saw(), f = mtof(m + d), flt = svf(), pan = ((di - 2) / 2) * 0.9 * (ni % 2 ? -1 : 1);
    voice(BUS.braam, t, len, pan, (x) => {
      const open = x < 0.09 ? x / 0.09 : Math.exp(-(x - 0.09) / 0.55), c = 140 + 3200 * open + 380;
      const e = Math.min(1, x / 0.012) * (0.45 + 0.55 * Math.exp(-x / 0.5)) * (x > len - 0.5 ? Math.max(0, (len - x) / 0.5) : 1);
      return Math.tanh(flt.run(osc(f), c, 0.9) * 2.6) * e * 0.07 * vel;
    });
  }));
  const sub = sine(0), f0 = mtof(notes[0]);
  voice(BUS.braam, t, len, 0, (x) => sub(f0) * Math.min(1, x / 0.01) * Math.exp(-x / 0.9) * 0.35 * vel);
}
function stab(t, notes, vel) {
  notes.forEach((m, ni) => [-0.1, 0, 0.1].forEach((d, di) => {
    const osc = saw(), f = mtof(m + d), flt = svf(), pan = (di - 1) * 0.6 * (ni % 2 ? 1 : -1);
    voice(BUS.braam, t, 0.45, pan, (x) => flt.run(osc(f), 300 + 4200 * Math.exp(-x / 0.06), 1.0) * Math.min(1, x / 0.003) * Math.exp(-x / 0.16) * 0.09 * vel);
  }));
}
function bass(t, len, m, vel, bright) {
  const o1 = saw(), o2 = sine(), flt = svf(), f = mtof(m);
  voice(BUS.bass, t, len + 0.04, 0, (x) => {
    const e = Math.min(1, x / 0.004) * (x < len ? 1 : Math.max(0, 1 - (x - len) / 0.04));
    const c = 110 + (bright || 1400) * Math.exp(-x / 0.075) * vel;
    return Math.tanh((flt.run(o1(f), c, 1.15) * 0.85 + o2(f) * 0.75) * 1.9) * e * vel * 0.5;
  });
}
function pluck(t, m, vel, pan, cut) {
  const o1 = saw(), o2 = sqr(), flt = svf(), f = mtof(m);
  voice(BUS.arp, t, 0.34, pan, (x) => flt.run(o1(f) * 0.6 + o2(f * 1.004) * 0.4, (cut || 1) * (650 + 5200 * Math.exp(-x / 0.05)), 1.25) * Math.min(1, x / 0.002) * Math.exp(-x / 0.1) * vel * 0.32);
}
function bell(t, m, vel, pan) {
  const f = mtof(m);
  [[1, 1, 1.5], [2.0, 0.42, 0.85], [3.0, 0.22, 0.5], [4.16, 0.16, 0.32], [5.43, 0.09, 0.22]].forEach((p) => {
    const o = sine(0);
    voice(BUS.bell, t, p[2] * 3.2, pan, (x) => o(f * p[0]) * p[1] * Math.exp(-x / p[2]) * Math.min(1, x / 0.002) * vel * 0.16);
  });
}
// ---- drums
function kick(t, vel) {
  KICKS.push([t, vel]);
  const o = sine(0); let lp = 0;
  voice(BUS.kick, t, 0.45, 0, (x) => {
    lp += (noise() - lp) * 0.5;
    return Math.tanh((o(48 + 190 * Math.exp(-x / 0.028)) * Math.exp(-x / 0.26) + (x < 0.005 ? lp * 0.6 : 0)) * 1.6) * vel * 0.8;
  });
}
function heart(t, vel) { const o = sine(0); voice(BUS.kick, t, 0.35, 0, (x) => o(40 + 40 * Math.exp(-x / 0.04)) * Math.exp(-x / 0.14) * vel * 0.8); }
function snare(t, vel, pan) {
  const o = sine(0), f1 = svf(), f2 = svf();
  voice(BUS.drums, t, 0.4, pan || 0, (x) => {
    const n0 = noise(); f1.run(n0, 2300, 0.7); f2.run(n0, 6500, 0.7);
    return (o(185 * (1 + 0.45 * Math.exp(-x / 0.018))) * Math.exp(-x / 0.07) * 0.6 + f1.bp * Math.exp(-x / 0.14) * 1.2 + f2.hp * Math.exp(-x / 0.06) * 0.5) * vel * 0.55;
  });
}
function clap(t, vel, pan) {
  const f = svf();
  voice(BUS.drums, t, 0.35, pan || 0, (x) => {
    f.run(noise(), 1500, 1.4);
    const e = Math.exp(-x / 0.006) + (x > 0.011 ? Math.exp(-(x - 0.011) / 0.006) : 0) + (x > 0.022 ? Math.exp(-(x - 0.022) / 0.11) * 0.9 : 0);
    return f.bp * e * vel * 0.9;
  });
}
function hat(t, vel, open, pan) {
  const f = svf(), d = open ? 0.2 : 0.028;
  voice(BUS.cym, t, d * 5, pan || 0, (x) => { f.run(noise(), 7000, 0.9); return f.hp * Math.exp(-x / d) * vel * 0.32; });
}
function tom(t, vel, f0, pan) {
  const o = sine(0), f = svf();
  voice(BUS.drums, t, 0.6, pan || 0, (x) => { f.run(noise(), 900, 0.7); return (o(f0 * (1 + 0.55 * Math.exp(-x / 0.05))) * Math.exp(-x / 0.24) + f.lp * Math.exp(-x / 0.03) * 0.8) * vel * 0.75; });
}
function taiko(t, vel, pan) {
  const o = sine(0), f = svf();
  voice(BUS.drums, t, 0.9, pan || 0, (x) => { f.run(noise(), 500, 0.6); return Math.tanh((o(62 * (1 + 0.7 * Math.exp(-x / 0.035))) * Math.exp(-x / 0.38) + f.lp * Math.exp(-x / 0.05) * 1.4) * 1.5) * vel * 0.8; });
}
function crash(t, vel, len) {
  len = len || 2.4;
  [-0.6, 0.6].forEach((pan) => {
    const f = svf(), g = svf(), r1 = sqr(), r2 = sqr();
    voice(BUS.cym, t, len, pan, (x) => {
      f.run(noise(), 4200, 0.6); g.run(r1(587 * 1.01) + r2(845) * 0.8, 6800, 2.5);
      return (f.hp * 0.9 + g.bp * 0.25) * Math.min(1, x / 0.002) * Math.exp(-x / (len * 0.42)) * vel * 0.38;
    });
  });
}
function swell(tEnd, len, vel) {          // a cymbal played backwards, into a hit
  [-0.5, 0.5].forEach((pan) => {
    const f = svf();
    voice(BUS.fx, tEnd - len, len, pan, (x) => { f.run(noise(), 4800, 0.6); return f.hp * Math.pow(x / len, 2.6) * vel * 0.5; });
  });
}
function roll(t0, t1, r0, r1, v0, v1) {      // a snare roll that speeds up and grows
  let t = t0;
  while (t < t1 - 0.004) { const u = (t - t0) / (t1 - t0); snare(t, v0 + (v1 - v0) * u * u, (rnd() - 0.5) * 0.3); t += 1 / (r0 + (r1 - r0) * u); }
}
// ---- effects
function riser(t0, t1, vel) {
  const f = svf(), o = saw(), g = svf(), len = t1 - t0;
  voice(BUS.fx, t0, len, 0, (x) => {
    const u = x / len, fc = 300 * Math.pow(30, u);
    f.run(noise(), fc, 2.2); g.run(o(110 * Math.pow(4, u)), fc * 1.5, 0.8);
    return (f.bp * 1.1 + g.lp * 0.25) * u * u * vel * 0.6;
  });
}
function boom(t, vel) {
  const o = sine(0), f = svf();
  voice(BUS.fx, t, 2.6, 0, (x) => {
    f.run(noise(), 700 * Math.exp(-x / 0.4) + 60, 0.7);
    return Math.tanh((o(30 + 85 * Math.exp(-x / 0.1)) * Math.exp(-x / 0.75) + f.lp * Math.exp(-x / 0.3) * 1.8) * 1.7) * vel * 0.7;
  });
}
function whoosh(t, len, vel, panFrom, panTo) {
  const f = svf();
  // split in short pieces so the sound can travel from one side to the other
  const pieces = 12;
  for (let p = 0; p < pieces; p++) {
    const a = p / pieces, b = (p + 1) / pieces, pan = panFrom + (panTo - panFrom) * (a + b) / 2;
    voice(BUS.fx, t + a * len, len / pieces, pan, (x) => {
      const u = a + x / len, e = Math.sin(Math.PI * clamp(u, 0, 1));
      f.run(noise(), 500 + 5000 * e * e, 1.6);
      return f.bp * e * e * vel * 0.7;
    });
  }
}
function siren(t0, t1, vel) {
  const o = sqr(), f = svf();
  voice(BUS.fx, t0, t1 - t0, 0, (x) => {
    const hi = Math.floor(x / 0.25) % 2 === 0, e = Math.min(1, x / 0.01) * Math.min(1, (t1 - t0 - x) / 0.05);
    return f.run(o(hi ? 932 : 698), 1700, 2.5) * e * vel * 0.2;
  });
}
function glitch(t, len, vel) {
  const o = sqr(), f = svf(); let pitch = 400, gate = 1;
  voice(BUS.fx, t, len, 0, (x) => {
    const step = Math.floor(x / 0.031);
    if (step !== glitch.last) { glitch.last = step; pitch = 200 + rnd() * 2400; gate = rnd() < 0.7 ? 1 : 0; }
    return f.run(o(pitch) * 0.5 + noise() * 0.5, 3000, 0.8) * gate * vel * 0.4;
  });
}

// ---------------------------------------------------------------- the arrangement
// chords: bass note, pad voicing, arpeggio notes
const CH = {
  Am: { b: 33, p: [57, 60, 64, 69], a: [69, 72, 76, 81], low: [33, 45, 52, 57, 60] },
  F: { b: 29, p: [57, 60, 65, 69], a: [69, 72, 77, 81], low: [29, 41, 48, 57, 60] },
  C: { b: 36, p: [55, 60, 64, 67], a: [67, 72, 76, 79], low: [36, 48, 55, 60, 64] },
  G: { b: 31, p: [55, 59, 62, 67], a: [67, 71, 74, 79], low: [31, 43, 50, 55, 59] },
  Dm: { b: 38, p: [57, 62, 65, 69], a: [69, 74, 77, 81], low: [26, 38, 45, 50, 53] },
  Bb: { b: 34, p: [58, 62, 65, 70], a: [70, 74, 77, 82], low: [34, 46, 53, 58, 62] }
};
const PROG = [[0, 4, 'Am'], [4, 6, 'Am'], [6, 7, 'F'], [7, 8, 'G'], [8, 9, 'Am'], [9, 10, 'F'], [10, 11, 'C'], [11, 12, 'G'], [12, 13, 'Am'],
  [13, 14, 'Am'], [14, 15, 'Bb'], [15, 15.5, 'Am'], [15.5, 16.5, 'Dm'], [16.5, 17.25, 'F'], [17.25, 18, 'G'], [18, 19, 'F'], [19, 20, 'G'],
  [20, 21, 'Am'], [21, 22, 'C'], [22, 23, 'F'], [23, 24, 'G'], [24, 25, 'Am'], [25, 26, 'F'], [26, 29.9, 'C']];
const chordAt = (t) => { for (const p of PROG) if (t >= p[0] && t < p[1]) return CH[p[2]]; return CH.C; };

// ---- the pads, darker or brighter by section; a short hole just before the big drop at 24
function padCut(T) {
  if (T < 4) return 260 + 500 * T / 4;
  if (T < 6) return 2400; if (T < 8) return 1500; if (T < 12) return 2600; if (T < 13) return 650;
  if (T < 15.5) return 2000; if (T < 16.5) return 420; if (T < 18) return 2400;
  if (T < 22) return 1500 + (T - 18) * 250; if (T < 24) return 2500 + (T - 22) * 1600;
  if (T < 26) return 3600; return 3200 - Math.min(1, (T - 26) / 3.5) * 2000;
}
function padGain(T) {
  if (T < 4) return 0.55 * Math.min(1, T / 0.8); if (T < 8) return 0.95; if (T < 12) return 1; if (T < 13) return 0.55;
  if (T < 15.5) return 1; if (T < 16.5) return 0.7; if (T < 18) return 0.8; if (T < 23.86) return 0.85 + (T - 18) * 0.04;
  if (T < 24) return 0; return 1.15;
}
PROG.forEach((p) => pad(p[0], p[1], CH[p[2]].p, { cut: padCut, gain: padGain, att: p[0] === 24 || p[0] === 4 || p[0] === 26 ? 0.01 : 0.05 }));
// a low drone under the opening and under the slow motion
[[0, 4.2, 33, 1], [15.5, 16.6, 26, 0.8]].forEach((d) => {
  const o = saw(), s = sine(), f = svf(), len = d[1] - d[0];
  voice(BUS.pad, d[0], len, 0, (x) => f.run(o(mtof(d[2])), 160 + 260 * x / len, 0.9) * 0.22 * d[3] * Math.min(1, x / 0.5) * Math.min(1, (len - x) / 0.15) + s(mtof(d[2] + 12)) * 0.05 * d[3]);
});

// ---- the big hits
braam(4.0, CH.Am.low, 2.0, 1.0); boom(4.0, 1); crash(4.0, 1); swell(4.0, 1.4, 0.9);
[6.0, 6.5, 7.0, 7.5].forEach((t, i) => { stab(t, (i < 2 ? CH.F : CH.G).p.map((m) => m - 12), 0.9 + i * 0.05); taiko(t, 0.8 + i * 0.05, (i % 2 ? 0.2 : -0.2)); });
boom(8.0, 0.6); crash(8.0, 0.9); swell(8.0, 1.0, 0.7);
boom(12.0, 0.9); glitch(12.0, 0.32, 0.8); siren(12.0, 15.4, 0.75);
braam(13.0, CH.Am.low, 1.0, 0.8); boom(13.0, 0.8); crash(13.0, 0.9); swell(13.0, 0.6, 0.8);
braam(15.5, CH.Dm.low, 1.1, 0.9); boom(15.5, 1); crash(15.5, 0.8, 1.6);
glitch(16.5, 0.16, 0.5); swell(16.5, 0.9, 0.55);
[19, 20, 21, 22].forEach((t, i) => { stab(t, chordAt(t).p, 0.75 + i * 0.08); taiko(t, 0.8, 0); });
braam(24.0, CH.Am.low, 2.0, 1.1); boom(24.0, 1.1); crash(24.0, 1); swell(24.0, 1.6, 1);
braam(26.0, CH.C.low, 3.9, 1.15); boom(26.0, 1.0); crash(26.0, 1, 3.6); swell(26.0, 0.9, 0.7);

// ---- risers
riser(2.0, 4.0, 0.8); riser(7.0, 8.0, 0.55); riser(12.45, 13.0, 0.7); riser(22.0, 23.86, 1.0); riser(25.0, 26.0, 0.55);
whoosh(5.75, 0.55, 0.6, -0.6, 0.6); whoosh(9.45, 0.5, 0.75, -0.9, 0.9); whoosh(14.95, 0.4, 0.5, 0.7, -0.7);

// ---- drums, section by section
heart(0.0, 0.8); heart(0.2, 0.55); heart(1.0, 0.85); heart(1.2, 0.6);
for (let t = 0; t < 2; t += 0.125) hat(t, 0.06 + 0.03 * ((t * 8) % 2), false, 0.4);
for (let t = 2; t < 4; t += 0.5) kick(t, 0.6 + (t - 2) * 0.12);
for (let t = 2; t < 4; t += 0.125) hat(t, 0.07 + (t - 2) * 0.04, false, -0.3);
roll(3.0, 3.97, 8, 24, 0.15, 0.85);
kick(4.0, 1); kick(5.0, 0.8); taiko(5.5, 0.7, -0.2); taiko(5.75, 0.6, 0.2);
roll(7.5, 7.97, 12, 20, 0.2, 0.7);
// the montage groove
for (let t = 8; t < 12; t += 0.5) { kick(t, 0.95); if ((t * 2) % 2 === 1) { snare(t, 0.9); clap(t, 0.5, 0.1); } }
for (let t = 8; t < 12; t += 0.125) { const off = Math.abs((t * 4) % 2 - 1) < 1e-6; hat(t, off ? 0.18 : 0.09, off, 0.3); }
[11.75, 11.81, 11.875, 11.94].forEach((t, i) => tom(t, 0.7, 150 - i * 25, i / 2 - 0.75));
// the storm
for (let t = 13; t < 15.5; t += 0.5) kick(t, 0.95);
for (let t = 13.5; t < 15.5; t += 1) { snare(t, 0.9); clap(t, 0.4, -0.1); }
for (let t = 13; t < 15.5; t += 0.25) taiko(t + 0.125, 0.5, (t * 4) % 2 ? 0.3 : -0.3);
for (let t = 13; t < 15.5; t += 0.125) hat(t, 0.1, false, 0.35);
roll(15.0, 15.47, 16, 32, 0.3, 0.8);
// the slow motion: a heartbeat
heart(15.9, 0.7); heart(16.08, 0.5);
// the science: light
kick(16.5, 0.7); kick(17.5, 0.6);
for (let t = 16.5; t < 18; t += 0.25) hat(t, 0.07, false, 0.3);
// the city: a long build
kick(18, 0.85); kick(19, 0.85); for (let t = 18; t < 20; t += 0.25) hat(t, 0.08, false, 0.3);
for (let t = 20; t < 23.86; t += 0.5) { kick(t, 0.9 + (t - 20) * 0.02); if ((t * 2) % 2 === 1) snare(t, 0.8); }
for (let t = 20; t < 23.86; t += 0.125) hat(t, 0.08 + (t - 20) * 0.012, (t * 4) % 2 === 1, -0.3);
for (let t = 22; t < 23; t += 0.25) tom(t, 0.45, 110, (t * 4) % 2 ? 0.4 : -0.4);
roll(23.0, 23.86, 8, 30, 0.25, 1.0);
// the drop: the launch
for (let t = 24; t < 26; t += 0.5) { kick(t, 1); if ((t * 2) % 2 === 1) { snare(t, 1); clap(t, 0.5); } }
for (let t = 24; t < 26; t += 0.125) { const off = Math.abs((t * 4) % 2 - 1) < 1e-6; hat(t, off ? 0.2 : 0.1, off, 0.3); }
for (let t = 24; t < 26; t += 0.25) taiko(t + 0.125, 0.4, (t * 4) % 2 ? 0.3 : -0.3);
[25.75, 25.81, 25.875, 25.94].forEach((t, i) => tom(t, 0.75, 160 - i * 28, i / 2 - 0.75));
kick(26.0, 1);

// ---- bass
for (let t = 2; t < 4; t += 0.25) bass(t, 0.2, 33, 0.45 + (t - 2) * 0.2, 500);
bass(4.0, 1.7, 33, 1, 1800);
[6.0, 6.5, 7.0, 7.5].forEach((t, i) => bass(t, 0.38, (i < 2 ? CH.F : CH.G).b, 0.95));
const pat16 = [[0, 1], [12, 0.55], [0, 0.75], [12, 0.6]];
function groove(t0, t1, vel, bright) { for (let t = t0; t < t1 - 0.01; t += 0.125) { const c = chordAt(t), p = pat16[Math.round((t - t0) / 0.125) % 4]; bass(t, 0.11, c.b + p[0], p[1] * vel, bright); } }
groove(8, 12, 1, 1500); groove(13, 15.5, 1, 1100);
bass(15.5, 0.95, 38, 0.9, 300);
for (let t = 16.5; t < 18; t += 0.5) bass(t, 0.4, chordAt(t).b, 0.7, 900);
for (let t = 18; t < 20; t += 0.5) bass(t, 0.42, chordAt(t).b, 0.85, 1000);
groove(20, 23.86, 0.95, 1300); groove(24, 26, 1.05, 1700);
bass(26.0, 2.6, 36, 1, 1600);

// ---- arpeggio (16ths, up and down the chord), bells
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
function arp(t0, t1, step, vel, cut) { let k = 0; for (let t = t0; t < t1 - 0.01; t += step, k++) { const c = chordAt(t); pluck(t, c.a[ARP[k % 8]], vel * (k % 4 === 0 ? 1 : 0.7), k % 2 ? 0.45 : -0.45, cut); } }
arp(4.5, 6, 0.25, 0.6, 0.8); arp(6, 8, 0.25, 0.7, 0.9); arp(8, 12, 0.125, 0.8, 1); arp(13, 15.5, 0.125, 0.7, 0.7);
arp(16.5, 18, 0.25, 0.6, 1); arp(19, 20, 0.25, 0.6, 0.9); arp(20, 23.86, 0.125, 0.75, 1.1); arp(24, 26, 0.125, 0.85, 1.2);
[[16.5, 72], [16.75, 76], [17.0, 79], [17.25, 74], [17.5, 79], [17.75, 83]].forEach((b, i) => bell(b[0], b[1], 0.8, i % 2 ? 0.35 : -0.35));
[[19, 76], [20, 79], [21, 84], [22, 88]].forEach((b) => bell(b[0], b[1], 0.75, 0));
[[26.5, 84], [27.0, 79], [27.5, 76], [28.0, 72], [28.5, 67]].forEach((b, i) => bell(b[0], b[1], 0.75 - i * 0.08, i % 2 ? 0.4 : -0.4));

// ---------------------------------------------------------------- mixing
function rms(bus, t0, t1) { let s = 0, n = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { s += bus.L[i] * bus.L[i] + bus.R[i] * bus.R[i]; n += 2; } return Math.sqrt(s / Math.max(1, n)); }
function peak(bus) { let p = 0; for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(bus.L[i]), Math.abs(bus.R[i])); return p; }
function scale(bus, k) { for (let i = 0; i < N; i++) { bus.L[i] *= k; bus.R[i] *= k; } }
// set each part to its level: loudness in the montage groove (8 to 12 s), or the peak for the hits
const LEVEL = { kick: ['rms', -15], drums: ['rms', -19], cym: ['rms', -28.5], bass: ['rms', -18], pad: ['rms', -20.5], arp: ['rms', -22], bell: ['peak', -11], braam: ['peak', -4.5], fx: ['peak', -6] };
const report = [];
Object.keys(LEVEL).forEach((k) => {
  const [how, want] = LEVEL[k], now = how === 'rms' ? rms(BUS[k], 8, 12) : peak(BUS[k]);
  scale(BUS[k], dB(want) / (now || 1));
  report.push(k + ' ' + how + ' ' + (20 * Math.log10(now || 1e-9)).toFixed(1) + ' → ' + want);
});
// the arpeggio echoes left and right (three sixteenths)
(function echo(bus, time, fb, wet) {
  const d = Math.round(time * SR), bl = new Float32Array(N), br = new Float32Array(N); let lp1 = 0, lp2 = 0;
  for (let i = 0; i < N; i++) {
    const m = (bus.L[i] + bus.R[i]) * 0.5, fromR = i >= d ? br[i - d] : 0, fromL = i >= d ? bl[i - d] : 0;
    lp1 += (fromR - lp1) * 0.45; lp2 += (fromL - lp2) * 0.45;
    bl[i] = m + lp1 * fb; br[i] = lp2 * fb;
    bus.L[i] += bl[i] * wet - m * wet; bus.R[i] += br[i] * wet;
  }
})(BUS.arp, 0.375, 0.42, 0.3);
// everything but the drums ducks under the kick, so the beat pumps
const duck = new Float32Array(N);
KICKS.forEach(([t, v]) => { const a = Math.round(t * SR); for (let i = 0; i < Math.round(0.35 * SR); i++) { const k = a + i; if (k >= N) break; const x = i / SR, e = Math.min(1, x / 0.006) * Math.exp(-x / 0.11) * v; if (e > duck[k]) duck[k] = e; } });
[['bass', 0.75], ['pad', 0.5], ['arp', 0.35], ['bell', 0.15]].forEach(([k, depth]) => { const b = BUS[k]; for (let i = 0; i < N; i++) { const g = 1 - depth * duck[i]; b.L[i] *= g; b.R[i] *= g; } });
// a hall for the pads, arpeggio, bells, hits and snare
function hall(inL, inR, room, damp) {
  const comb = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], allp = [556, 441, 341, 225];
  function side(inp, extra) {
    const out = new Float32Array(N);
    const cs = comb.map((n) => ({ b: new Float32Array(Math.round((n + extra) * SR / 44100)), i: 0, s: 0 }));
    const as = allp.map((n) => ({ b: new Float32Array(Math.round((n + extra) * SR / 44100)), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = inp[n] * 0.015; let y = 0;
      for (const c of cs) { const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; if (++c.i >= c.b.length) c.i = 0; y += o; }
      for (const a of as) { const o = a.b[a.i]; a.b[a.i] = y + o * 0.5; y = o - y; if (++a.i >= a.b.length) a.i = 0; }
      out[n] = y;
    }
    return out;
  }
  return [side(inL, 0), side(inR, 23)];
}
const sendL = new Float32Array(N), sendR = new Float32Array(N);
[['pad', 0.35], ['arp', 0.4], ['bell', 0.6], ['braam', 0.3], ['drums', 0.12], ['cym', 0.08], ['fx', 0.15]].forEach(([k, s]) => { for (let i = 0; i < N; i++) { sendL[i] += BUS[k].L[i] * s; sendR[i] += BUS[k].R[i] * s; } });
// no low end into the hall, or it turns to mud
[sendL, sendR].forEach((b) => { const f = svf(); for (let i = 0; i < N; i++) { f.run(b[i], 260, 0.7); b[i] = f.hp; } });
const [revL, revR] = hall(sendL, sendR, 0.86, 0.3);
// add it all up, glue it with a soft clip, and normalise
const L = new Float32Array(N), R = new Float32Array(N); let pk = 0;
for (let i = 0; i < N; i++) {
  let l = revL[i] * 1.6, r = revR[i] * 1.6;
  for (const k in BUS) { l += BUS[k].L[i]; r += BUS[k].R[i]; }
  L[i] = Math.tanh(l * 1.15); R[i] = Math.tanh(r * 1.15); pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
}
const out = process.argv[2] || 'score.wav', k = dB(-1) / (pk || 1), buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(clamp(L[i] * k, -1, 1) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(clamp(R[i] * k, -1, 1) * 32767), 46 + i * 4); }
fs.writeFileSync(out, buf);
console.log('score: ' + report.join(' | '));
console.log('score → ' + out);
