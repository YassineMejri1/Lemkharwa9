#!/usr/bin/env node
/* Astro Outpost film — sound and final film. It joins the pictures from record.js into an mp4 and lays the
   sound under them:
     - the game's own title music (audio/music/title.mp3)
     - the game's own sound effects and Mission Control lines, placed where the things happen on screen
     - a drum pulse, hits and risers made here in code (no notes, only drums and noise, so nothing can
       clash with the music). The film is cut at 120 beats a minute: every cut is on a whole second.

     node tools/film/build.js --frames <folder> --out <film.mp4>
     node tools/film/build.js --out <sound.wav> --sound-only

   Needs Node 22 or newer and ffmpeg on the PATH. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const LEN = 29.9, FPS = 30, SR = 48000;

// ---------------------------------------------------------------- the drums, made from sine sweeps and noise
function drums() {
  const N = Math.ceil(LEN * SR), L = new Float32Array(N), R = new Float32Array(N);
  let seed = 20261115;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const noise = () => rnd() * 2 - 1;
  const put = (t0, len, pan, fn) => {      // fn(t, i) gives one sample; pan -1 left .. 1 right
    const a = Math.round(t0 * SR), n = Math.round(len * SR), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < n; i++) { const k = a + i; if (k < 0 || k >= N) continue; const v = fn(i / SR, i); L[k] += v * gl * 1.414; R[k] += v * gr * 1.414; }
  };
  const kick = (t, g) => { let ph = 0; put(t, 0.4, 0, (x) => { ph += 2 * Math.PI * (44 + 120 * Math.exp(-x / 0.028)) / SR; return g * (Math.sin(ph) * Math.exp(-x / 0.12) + (x < 0.004 ? noise() * 0.25 : 0)); }); };
  const boom = (t, g) => {                  // a deep hit with a long tail, for the big cuts
    let ph = 0, lp = 0;
    put(t, 2.6, 0, (x) => { ph += 2 * Math.PI * (30 + 75 * Math.exp(-x / 0.1)) / SR; lp += (noise() - lp) * 0.035; return g * Math.tanh(1.6 * (Math.sin(ph) * Math.exp(-x / 0.65) + lp * 2.2 * Math.exp(-x / 0.3))); });
  };
  const tom = (t, g, f0, pan) => { let ph = 0; put(t, 0.35, pan || 0, (x) => { ph += 2 * Math.PI * f0 * (1 + 0.7 * Math.exp(-x / 0.035)) / SR; return g * Math.sin(ph) * Math.exp(-x / 0.13); }); };
  const hat = (t, g, pan) => { let last = 0; put(t, 0.07, pan || 0, (x) => { const n0 = noise(), v = n0 - last; last = n0; return g * v * Math.exp(-x / 0.018); }); };
  const clap = (t, g, pan) => {             // three quick bursts of mid-range noise
    let b1 = 0, b2 = 0;
    put(t, 0.22, pan || 0, (x) => { const n0 = noise(); b1 += (n0 - b1) * 0.32; b2 += (b1 - b2) * 0.06; const band = b1 - b2; const e = Math.exp(-x / 0.07) + (x > 0.012 ? Math.exp(-(x - 0.012) / 0.05) : 0) * 0.8 + (x > 0.026 ? Math.exp(-(x - 0.026) / 0.09) : 0) * 0.7; return g * band * e * 1.6; });
  };
  const riser = (t0, t1, g) => {            // noise that opens up and swells, and stops dead on the cut
    let lo = 0, bd = 0; const len = t1 - t0;
    put(t0, len, 0, (x) => { const u = x / len, f = 2 * Math.sin(Math.PI * (250 * Math.pow(26, u)) / SR), q = 0.5; const hi = noise() - lo - q * bd; bd += f * hi; lo += f * bd; return g * bd * u * u * 1.4; });
  };
  const fall = (t0, len, g) => {            // the opposite, after the crash: noise that closes down
    let lp = 0;
    put(t0, len, 0, (x) => { const u = x / len; lp += (noise() - lp) * (0.4 * Math.pow(0.02, u) + 0.004); return g * lp * (1 - u) * (1 - u) * 2.2; });
  };
  const sub = (t0, t1, g) => { let ph = 0; const len = t1 - t0; put(t0, len, 0, (x) => { const u = x / len; ph += 2 * Math.PI * (36 + 30 * u * u) / SR; return g * Math.sin(ph) * u * u * (1 + 0.25 * Math.sin(x * 38)); }); };
  const tick = (t, g, pan) => put(t, 0.004, pan, (x) => g * noise() * Math.exp(-x / 0.001));

  // --- the Moon: the engine's push grows until touchdown, then the title lands
  sub(0.15, 2.8, 0.42);
  boom(3.0, 0.95);
  riser(5.1, 6.0, 0.22);
  // --- three cuts: air, water, food
  [6, 7, 8].forEach((t) => { kick(t, 0.9); clap(t, 0.38, 0.1); });
  for (let t = 6; t < 9; t += 0.5) hat(t + 0.25, 0.1, -0.3);
  riser(8.45, 9.0, 0.16);
  // --- the rover: a driving pulse, then the crash and the quiet after it
  [9, 9.5, 10, 10.5].forEach((t) => kick(t, 0.85));
  for (let t = 9; t < 10.7; t += 0.25) hat(t, t % 0.5 ? 0.07 : 0.12, 0.3);
  [9.75, 10.25].forEach((t) => tom(t, 0.4, 95, -0.25));
  boom(10.74, 1.0); clap(10.74, 0.55, 0);
  fall(10.8, 1.1, 0.3);
  riser(11.25, 12.0, 0.2);
  // --- the storm: urgent, low drums, and a radiation counter that clicks faster and faster
  boom(12.0, 0.8);
  for (let t = 12; t < 16; t += 0.5) { kick(t, 0.78); tom(t + 0.25, 0.42, 82, 0.2); tom(t + 0.375, 0.3, 110, -0.2); }
  for (let t = 12; t < 16; t += 0.125) hat(t, 0.045 + 0.02 * ((t * 8) % 2), 0.4);
  for (let t = 12.7; t < 15.95;) { tick(t, 0.5, rnd() * 1.6 - 0.8); t += (0.02 + rnd() * 0.16) * (1.6 - (t - 12.7) / 4); }
  // --- the hologram: the drums step back
  boom(16.0, 0.35);
  riser(18.35, 19.0, 0.17);
  // --- Pioneer mode: back in, with a clap on the off-beats
  for (let t = 19; t < 22; t += 0.5) kick(t, 0.82);
  [19.5, 20.5, 21.5].forEach((t) => clap(t, 0.36, -0.1));
  for (let t = 19; t < 22; t += 0.25) hat(t, t % 0.5 ? 0.06 : 0.1, 0.3);
  // --- the city: a long build that breaks on the end card
  boom(22.0, 0.7);
  for (let t = 22; t < 27; t += 0.5) kick(t, 0.8 + (t - 22) * 0.035);
  for (let t = 22; t < 27; t += 0.25) hat(t, (t % 0.5 ? 0.06 : 0.1) + (t - 22) * 0.008, -0.3);
  for (let t = 22.5; t < 25; t += 1) clap(t, 0.3, 0.1);
  for (let t = 25; t < 26; t += 0.25) clap(t, 0.2 + (t - 25) * 0.14, 0.15);
  for (let t = 26; t < 27; t += 0.125) clap(t, 0.3 + (t - 26) * 0.4, -0.15 + (t - 26) * 0.3);
  [26.5, 26.625, 26.75, 26.875].forEach((t, i) => tom(t, 0.5, 70 + i * 12, i / 2 - 0.75));
  riser(24.4, 27.0, 0.3);
  boom(27.0, 1.0);

  // a gentle top cut and a soft limit, then to 16-bit
  let lpL = 0, lpR = 0, peak = 0;
  for (let i = 0; i < N; i++) { lpL += (L[i] - lpL) * 0.55; lpR += (R[i] - lpR) * 0.55; L[i] = Math.tanh(lpL * 0.9); R[i] = Math.tanh(lpR * 0.9); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const out = Buffer.alloc(44 + N * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40);
  const k = 0.7 / (peak || 1);
  for (let i = 0; i < N; i++) { out.writeInt16LE(Math.round(L[i] * k * 32767), 44 + i * 4); out.writeInt16LE(Math.round(R[i] * k * 32767), 46 + i * 4); }
  return out;
}

// ---------------------------------------------------------------- the game's own sounds, and when they are heard
// { f: file under audio/, at: seconds into the film, db: louder or quieter, from/len: use only a part, in/out: fades }
const CUES = [
  { f: 'music/title.mp3', at: 0, from: 8.1, len: 29.9, db: 6, in: 0.6, out: 0.7, music: true },
  // the Moon landing
  { f: 'sfx/descent.mp3', at: 0, len: 2.85, db: 9, in: 0.5, out: 0.12 },
  { f: 'landing/01-go-for-landing.mp3', at: 0.2, db: 0, voice: true },
  { f: 'sfx/touchdown.mp3', at: 2.78, db: 4 },
  // air, water, food
  { f: 'sfx/plug.mp3', at: 6.27, db: -2 },
  { f: 'sfx/drill.mp3', at: 7.0, len: 0.42, db: -7, out: 0.08 },
  { f: 'sfx/ice.mp3', at: 7.38, db: 0 },
  { f: 'sfx/harvest.mp3', at: 8.3, db: -2 },
  // the rover and the crash
  { f: 'sfx/rover.mp3', at: 9.0, len: 1.74, db: 8, in: 0.1, out: 0.05 },
  { f: 'sfx/hit.mp3', at: 10.73, db: 3 },
  { f: 'sfx/thud.mp3', at: 10.74, db: 11 },
  // the storm
  { f: 'sfx/storm-alert.mp3', at: 12.0, db: -2 },
  { f: 'sfx/amb-storm.mp3', at: 12.0, len: 4.0, db: 5, in: 0.3, out: 0.3 },
  { f: 'voice/storm-countdown.mp3', at: 12.3, db: 6, voice: true },
  // the hologram
  { f: 'sfx/discovery.mp3', at: 16.0, db: -4 },
  { f: 'sfx/page.mp3', at: 17.07, db: -9 },
  { f: 'sfx/page.mp3', at: 18.0, db: -9 },
  // Pioneer mode: two swings, the pieces, the turbine
  { f: 'sfx/swish.mp3', at: 19.17, db: -1 },
  { f: 'sfx/thud.mp3', at: 19.37, db: 9 },
  { f: 'sfx/swish.mp3', at: 19.8, db: -1 },
  { f: 'sfx/thud.mp3', at: 20.0, db: 10 },
  { f: 'sfx/ice.mp3', at: 20.02, db: -3 },
  { f: 'sfx/pop.mp3', at: 20.35, db: -8 },
  { f: 'sfx/pop.mp3', at: 20.55, db: -8 },
  { f: 'sfx/plug.mp3', at: 20.87, db: -3 },
  { f: 'sfx/good.mp3', at: 20.95, db: -2 },
  // the city: every ship lands, every count rings
  { f: 'sfx/touchdown.mp3', at: 23.0, db: -3 }, { f: 'sfx/score.mp3', at: 23.08, db: 0 },
  { f: 'sfx/touchdown.mp3', at: 24.1, db: -3 }, { f: 'sfx/score.mp3', at: 24.18, db: 1 },
  { f: 'sfx/touchdown.mp3', at: 25.2, db: -3 }, { f: 'sfx/score.mp3', at: 25.28, db: 2 },
  { f: 'sfx/touchdown.mp3', at: 26.3, db: -3 }, { f: 'sfx/score.mp3', at: 26.38, db: 3 },
  // the end card
  { f: 'sfx/win.mp3', at: 27.0, len: 2.9, db: -4, out: 0.6 },
  { f: 'landing/04-ready-commander.mp3', at: 26.95, db: 8, voice: true }
];

function ffmpeg(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(what + ' failed:\n' + String(r.stderr).split('\n').slice(-12).join('\n'));
  return r.stderr;
}

function main() {
  const out = arg('out', null), frames = arg('frames', null), soundOnly = !!arg('sound-only', false), drumDb = +arg('drums', -1);
  if (!out) throw new Error('Say where the result goes: --out <file>');
  if (!soundOnly && !frames) throw new Error('Say where the pictures are: --frames <folder>');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-film-sound-'));
  const drumFile = path.join(tmp, 'drums.wav'), mixFile = path.join(tmp, 'mix.wav'), soundFile = soundOnly ? out : path.join(tmp, 'sound.wav');
  fs.writeFileSync(drumFile, drums());

  // every sound is cut, faded, made louder or quieter and moved to its place; then they are added up
  // the music steps back a little whenever Mission Control speaks
  const inputs = ['-i', drumFile], parts = ['[0:a]volume=' + drumDb + 'dB[a0]'], names = ['[a0]'], voices = [], music = [];
  CUES.forEach((c, i) => {
    const file = path.join(ROOT, 'audio', c.f);
    if (!fs.existsSync(file)) throw new Error('missing sound: audio/' + c.f);
    inputs.push('-i', file);
    const f = ['aresample=' + SR, 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
    if (c.from || c.len) f.push('atrim=start=' + (c.from || 0) + (c.len ? ':duration=' + c.len : ''), 'asetpts=PTS-STARTPTS');
    if (c.in) f.push('afade=t=in:st=0:d=' + c.in);
    if (c.out && c.len) f.push('afade=t=out:st=' + (c.len - c.out).toFixed(3) + ':d=' + c.out);
    f.push('volume=' + (c.db || 0) + 'dB');
    if (c.at > 0) f.push('adelay=delays=' + Math.round(c.at * 1000) + ':all=1');
    parts.push('[' + (i + 1) + ':a]' + f.join(',') + '[a' + (i + 1) + ']'); (c.voice ? voices : c.music ? music : names).push('[a' + (i + 1) + ']');
  });
  parts.push(voices.join('') + 'amix=inputs=' + voices.length + ':normalize=0:dropout_transition=0,asplit=2[vox][key]');
  parts.push(music.join('') + '[key]sidechaincompress=threshold=0.015:ratio=3.5:attack=60:release=450[bed]');
  names.push('[vox]', '[bed]');
  parts.push(names.join('') + 'amix=inputs=' + names.length + ':normalize=0:dropout_transition=0,atrim=0:' + LEN + ',afade=t=out:st=' + (LEN - 0.45) + ':d=0.45[mix]');
  ffmpeg(inputs.concat(['-filter_complex', parts.join(';'), '-map', '[mix]', '-ar', String(SR), '-c:a', 'pcm_s24le', mixFile]), 'mixing the sound');

  // bring the whole mix to the loudness the video sites expect (-14 LUFS), with a ceiling so nothing clips
  const log = ffmpeg(['-i', mixFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'measuring the loudness');
  const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(log);
  const gain = m ? Math.min(14, -14 - parseFloat(m[1])) : 0;
  console.log('mix: ' + (m ? m[1] + ' LUFS, peak ' + m[2] + ' dBFS' : 'not measured') + ' → gain ' + gain.toFixed(1) + ' dB');
  ffmpeg(['-i', mixFile, '-af', 'volume=' + gain.toFixed(2) + 'dB,alimiter=limit=0.8:attack=3:release=60:level=disabled', '-ar', String(SR), '-c:a', 'pcm_s16le', soundFile], 'levelling the sound');
  const log2 = ffmpeg(['-i', soundFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'measuring the result');
  const m2 = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(log2);
  console.log('sound: ' + (m2 ? m2[1] + ' LUFS, peak ' + m2[2] + ' dBFS' : 'not measured'));
  if (soundOnly) { console.log('sound → ' + out); return; }

  const count = fs.readdirSync(frames).filter((n) => /^f\d{5}\.jpg$/.test(n)).length;
  if (count !== Math.round(LEN * FPS)) throw new Error('expected ' + Math.round(LEN * FPS) + ' pictures in ' + frames + ', found ' + count);
  ffmpeg(['-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'), '-i', soundFile, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(arg('crf', 20)), '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(LEN), out], 'making the film');
  console.log('film → ' + out);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the folder can stay */ }
}
try { main(); } catch (e) { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); }
