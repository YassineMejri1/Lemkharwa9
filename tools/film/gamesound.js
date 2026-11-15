#!/usr/bin/env node
/* Astro Outpost film — the gameplay film's soundtrack, made from the game's own sound.
   While tools/film/gameplay.js is recorded, every sound the game asks for is written down shot by shot
   (sound-<shot>.json in the frames folder): one-shot effects with their loudness and muffling, Mission Control
   and crew lines, the landing film's voices, and, once per picture, how loud each continuous sound is
   (background beds, machine hums, the rover motor, the music). This script plays all of that back from the
   game's own files in audio/, mixes it the way js/audio.js does (voices on top, the rest steps back while
   someone speaks), sets the loudness to -14 LUFS and joins it to the pictures.

     node tools/film/gamesound.js --frames <folder> --out <film.mp4>
     node tools/film/gamesound.js --frames <folder> --out <sound.wav> --sound-only
     --score            lay a score made by score.js under it, following the film's chapters (the game's own music is left out)
     --score-db <n>     how far the score sits under the game's sounds (default 1 dB)

   Needs Node 22 or newer and ffmpeg on the PATH. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'), SR = 48000, FPS = 30;
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

function ffmpeg(args, what, binary) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y'].concat(args), { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(what + ' failed:\n' + String(r.stderr).split('\n').slice(-10).join('\n'));
  return binary ? r.stdout : r.stderr;
}
const cache = {};
function decode(file) {        // the whole file as 48 kHz stereo floats
  if (cache[file] !== undefined) return cache[file];
  if (!fs.existsSync(file)) return (cache[file] = null);
  const buf = ffmpeg(['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], 'decoding ' + file, true);
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), n = f.length / 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[i * 2]; R[i] = f[i * 2 + 1]; }
  return (cache[file] = { L, R, n });
}
function lowpassCoef(fc) { return fc > 0 ? 1 - Math.exp(-2 * Math.PI * fc / SR) : 1; }

function main() {
  const frames = arg('frames', null), out = arg('out', null), soundOnly = !!arg('sound-only', false), withScore = !!arg('score', false), scoreDb = +arg('score-db', 1);
  if (!frames || !out) throw new Error('Use: --frames <folder> --out <file>');
  const meta = JSON.parse(fs.readFileSync(path.join(frames, 'sound-meta.json'), 'utf8'));
  const LEN = meta.len, N = Math.ceil(LEN * SR), NF = Math.ceil(LEN * FPS);
  const files = fs.readdirSync(frames).filter((f) => /^sound-.+\.json$/.test(f) && f !== 'sound-meta.json');
  const events = [], samples = {};
  files.forEach((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(frames, f), 'utf8'));
    j.events.forEach((e) => events.push(e));
    Object.keys(j.samples).forEach((n) => { (samples[n] = samples[n] || []).push.apply(samples[n], j.samples[n]); });
  });
  events.sort((a, b) => a.T - b.T);
  const mk = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
  const fx = mk(), amb = mk(), vox = mk(), mus = mk();
  function add(track, clip, at, g, lp, maxLen) {
    if (!clip) return 0;
    const a = Math.round(at * SR), n = Math.min(clip.n, maxLen == null ? clip.n : Math.round(maxLen * SR)), k = lowpassCoef(lp || 0);
    let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
    for (let i = 0; i < n; i++) {
      const t = a + i; if (t >= N) break;
      let l = clip.L[i], r = clip.R[i];
      if (lp) { l1 += (l - l1) * k; l2 += (l1 - l2) * k; r1 += (r - r1) * k; r2 += (r1 - r2) * k; l = l2; r = r2; }
      const fade = maxLen != null && n - i < 960 ? (n - i) / 960 : 1;      // a cut line ends in 20 ms, not a click
      if (t >= 0) { track.L[t] += l * g * fade; track.R[t] += r * g * fade; }
    }
    return n / SR;
  }
  function tone(track, at, f, len, amp) { const a = Math.round(at * SR); for (let i = 0; i < len * SR; i++) { const t = a + i; if (t < 0 || t >= N) continue; const v = Math.sin(2 * Math.PI * f * i / SR) * amp * Math.min(1, i / 240, (len * SR - i) / 240); track.L[t] += v; track.R[t] += v; } }
  function tick(track, at, amp) { const a = Math.round(at * SR); let s = 7; for (let i = 0; i < 160; i++) { const t = a + i; if (t < 0 || t >= N) continue; s = (s * 1103515245 + 12345) & 0x7fffffff; const v = ((s / 0x7fffffff) * 2 - 1) * amp * Math.exp(-i / 30); track.L[t] += v; track.R[t] += v; } }

  // ---- one-shot effects
  let used = 0, skipped = {};
  events.filter((e) => e.k === 'sfx').forEach((e, i) => {
    if (e.name === 'click') { tick(fx, e.T, 0.35 * e.g / 0.3); used++; return; }                 // the radiation counter is synthesized in the game too
    if (e.name === 'radio') { tone(fx, e.T, 2525, 0.16, 0.05); used++; return; }
    let name = e.name; if (e.n > 1) { const k = i % e.n; if (k) name += '-' + (k + 1); }
    const clip = decode(path.join(ROOT, 'audio', 'sfx', name + '.mp3')) || decode(path.join(ROOT, 'audio', 'sfx', e.name + '.mp3'));
    if (!clip) { skipped[e.name] = (skipped[e.name] || 0) + 1; return; }
    add(fx, clip, e.T, e.g, e.lp); used++;
  });

  // ---- voices: Mission Control and the crew, and the landing film. A new line cuts the one before.
  const vstarts = [];
  events.forEach((e) => {
    if (e.k === 'line') vstarts.push({ T: e.T, ids: e.ids, plain: e.plain });
    else if (e.k === 'voice') vstarts.push({ T: e.T, src: e.src });
    else if (e.k === 'hush') vstarts.push({ T: e.T, hush: true });
  });
  const talk = new Float32Array(NF);
  vstarts.forEach((v, i) => {
    if (v.hush) return;
    const next = vstarts.slice(i + 1).find((w) => w.T > v.T + 0.05), until = next ? next.T : LEN;
    let t = v.T;
    if (v.src) { const c = decode(path.join(ROOT, v.src)); const d = add(vox, c, t, 0.9, 0, until - t); for (let f = Math.floor(t * FPS); f < Math.min(NF, (t + d) * FPS); f++) talk[f] = 1; return; }
    if (!v.plain) { tone(vox, t, 2525, 0.25, 0.05); t += 0.38; }
    for (const id of v.ids) {
      if (t >= until) break;
      const c = decode(path.join(ROOT, 'audio', 'voice', id + '.mp3')); if (!c) continue;
      const d = add(vox, c, t, 0.9, 0, until - t);
      for (let f = Math.floor(t * FPS); f < Math.min(NF, (t + d) * FPS); f++) talk[f] = 1;
      t += d;
    }
    if (!v.plain && t < until - 0.3) tone(vox, t + 0.05, 2475, 0.25, 0.05);
  });

  // ---- continuous sounds, from the loudness written down for every picture
  Object.keys(samples).forEach((name) => {
    const isMusic = name.indexOf('music:') === 0, id = isMusic ? name.slice(6) : name;
    if (isMusic && withScore) return;            // the score takes the music's place
    const file = isMusic ? path.join(ROOT, 'audio', 'music', id + '.mp3') : path.join(ROOT, 'audio', 'sfx', id + '.mp3');
    const clip = decode(file); if (!clip) { skipped[name] = 'no file'; return; }
    const gain = new Float32Array(NF), cut = new Float32Array(NF);
    samples[name].forEach((s) => { if (s[0] >= 0 && s[0] < NF) { gain[s[0]] = s[1]; cut[s[0]] = s[2] || 0; } });
    const track = isMusic ? mus : name.indexOf('amb-') === 0 ? amb : fx, looped = !isMusic || (meta.music[id] && meta.music[id].loop);
    // how fast the loudness may change: music fades like the game's (in 0.45, out 0.6 a second); the rest in about 0.1 s
    const up = isMusic ? 0.45 / SR : 1 / (0.12 * SR), down = isMusic ? 0.6 / SR : 1 / (0.12 * SR);
    let g = 0, pos = 0, active = false, l1 = 0, l2 = 0, r1 = 0, r2 = 0;
    for (let i = 0; i < N; i++) {
      const f = Math.min(NF - 1, Math.floor(i * FPS / SR)), want = gain[f], peak = Math.max(want, isMusic ? want : 0);
      if (want > 0 && !active) { active = true; if (isMusic && g < 0.01) pos = 0; }       // a piece of music starts from its beginning
      if (want === 0 && g < 1e-4) active = false;
      g += Math.max(-down * Math.max(peak, 0.5), Math.min(up * Math.max(peak, 0.5), want - g));
      if (g < 1e-5 && !active) continue;
      if (pos >= clip.n) { if (looped) pos = 0; else continue; }
      let l = clip.L[pos], r = clip.R[pos]; pos++;
      const k = lowpassCoef(cut[f]);
      if (cut[f]) { l1 += (l - l1) * k; l2 += (l1 - l2) * k; r1 += (r - r1) * k; r2 += (r1 - r2) * k; l = l2; r = r2; }
      track.L[i] += l * g; track.R[i] += r * g;
    }
  });

  // ---- the mix: while someone speaks, effects and beds drop to half and the music further, as in js/audio.js
  const mixL = new Float32Array(N), mixR = new Float32Array(N);
  let v = 0, pk = 0;
  for (let i = 0; i < N; i++) {
    const want = talk[Math.min(NF - 1, Math.floor(i * FPS / SR))];
    v += (want - v) * (want > v ? 1 / (0.08 * SR) : 1 / (0.4 * SR));
    const d = 1 - 0.5 * v, dm = 1 - 0.55 * v;
    mixL[i] = (fx.L[i] + amb.L[i]) * d + mus.L[i] * dm + vox.L[i];
    mixR[i] = (fx.R[i] + amb.R[i]) * d + mus.R[i] * dm + vox.R[i];
    pk = Math.max(pk, Math.abs(mixL[i]), Math.abs(mixR[i]));
  }
  const fadeIn = 0.4 * SR, fadeOut = 0.6 * SR;
  for (let i = 0; i < N; i++) { const e = Math.min(1, i / fadeIn, (N - i) / fadeOut); mixL[i] *= e; mixR[i] *= e; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-gamesound-')), raw = path.join(tmp, 'mix.f32'), mixFile = path.join(tmp, 'mix.wav');
  const lufs = (file) => { const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(ffmpeg(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], 'measuring')); return m ? parseFloat(m[1]) : null; };
  if (withScore) {
    // the score sits a little under the game's own sound, and dips under the voices like the game's music does
    const scoreFile = path.join(tmp, 'score.wav'), gameFile = path.join(tmp, 'game.wav');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'score.js'), scoreFile, '--plan', path.join(frames, 'sound-meta.json')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the score failed: ' + r.stderr);
    const g2 = new Float32Array(N * 2); for (let i = 0; i < N; i++) { g2[i * 2] = mixL[i]; g2[i * 2 + 1] = mixR[i]; }
    fs.writeFileSync(raw, Buffer.from(g2.buffer)); ffmpeg(['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw, '-c:a', 'pcm_f32le', gameFile], 'writing the game sound');
    const sc = decode(scoreFile), lg = lufs(gameFile), ls = lufs(scoreFile), gs = Math.pow(10, ((lg - scoreDb) - ls) / 20);
    console.log('score: game sound ' + lg + ' LUFS, score ' + ls + ' LUFS → score gain ' + (20 * Math.log10(gs)).toFixed(1) + ' dB');
    let v2 = 0;
    for (let i = 0; i < N && i < sc.n; i++) {
      const want = talk[Math.min(NF - 1, Math.floor(i * FPS / SR))];
      v2 += (want - v2) * (want > v2 ? 1 / (0.08 * SR) : 1 / (0.4 * SR));
      const d = (1 - 0.5 * v2) * gs; mixL[i] += sc.L[i] * d; mixR[i] += sc.R[i] * d;
    }
  }
  const inter = new Float32Array(N * 2); for (let i = 0; i < N; i++) { inter[i * 2] = mixL[i]; inter[i * 2 + 1] = mixR[i]; }
  fs.writeFileSync(raw, Buffer.from(inter.buffer));
  console.log('sound: ' + used + ' effects, ' + vstarts.filter((x) => !x.hush).length + ' voice lines, ' + Object.keys(samples).length + ' continuous sounds; peak ' + (20 * Math.log10(pk || 1e-9)).toFixed(1) + ' dB');
  if (Object.keys(skipped).length) console.log('not in audio/ (made live by the game): ' + JSON.stringify(skipped));
  ffmpeg(['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw, '-c:a', 'pcm_f32le', mixFile], 'writing the mix');
  // -14 LUFS, as the video sites expect, with a ceiling
  const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(ffmpeg(['-i', mixFile, '-af', 'ebur128', '-f', 'null', '-'], 'measuring'));
  const gain = m ? Math.min(24, -14 - parseFloat(m[1])) : 0;
  const soundFile = soundOnly ? out : path.join(tmp, 'sound.wav');
  ffmpeg(['-i', mixFile, '-af', 'volume=' + gain.toFixed(2) + 'dB,alimiter=limit=0.84:attack=3:release=80:level=disabled', '-ar', String(SR), '-c:a', 'pcm_s16le', soundFile], 'levelling');
  const m2 = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(ffmpeg(['-i', soundFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'measuring'));
  console.log('loudness: ' + (m ? m[1] : '?') + ' LUFS → ' + (m2 ? m2[1] + ' LUFS, peak ' + m2[2] + ' dBFS' : '?'));
  if (soundOnly) { console.log('sound → ' + out); return; }

  const count = fs.readdirSync(frames).filter((n) => /^f\d{5}\.jpg$/.test(n)).length;
  if (count !== NF) throw new Error('expected ' + NF + ' pictures in ' + frames + ', found ' + count);
  ffmpeg(['-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg'), '-i', soundFile, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(arg('crf', 19)), '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-vf', 'eq=contrast=1.03:saturation=1.06,scale=in_range=full:out_range=tv:out_color_matrix=bt709', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(LEN), out], 'making the film');
  console.log('film → ' + out);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the folder can stay */ }
}
try { main(); } catch (e) { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); }
