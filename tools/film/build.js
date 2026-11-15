#!/usr/bin/env node
/* Astro Outpost film — sound and final film. It joins the pictures from record.js into an mp4 and lays the
   sound under them:
     - the score, made in code by score.js (or another music file, with --music)
     - the game's own sound effects and Mission Control lines, placed where things happen on screen
   The music steps back whenever Mission Control speaks, and the whole mix is set to -14 LUFS.
   Pictures recorded with --blur 2 are blended into motion blur, and every picture gets the same colour grade.

     node tools/film/build.js --frames <folder> --out <film.mp4>
     node tools/film/build.js --out <sound.wav> --sound-only
     node tools/film/build.js --frames <folder> --out <film.mp4> --music <track.mp3>     another music track

   Needs Node 22 or newer and ffmpeg on the PATH. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const LEN = 29.9, FPS = 30, SR = 48000;

// ---------------------------------------------------------------- the game's own sounds, and when they are heard
// { f: file under audio/, at: seconds into the film, db: louder or quieter, from/len: use only a part, in/out: fades, voice: Mission Control }
const CUES = [
  // the Moon: Mission Control, a ship comes down, touchdown
  { f: 'landing/01-go-for-landing.mp3', at: 0.12, len: 3.8, out: 0.12, db: 3, voice: true },
  { f: 'sfx/descent.mp3', at: 1.73, len: 2.12, db: 5, in: 0.3, out: 0.08 },
  { f: 'sfx/touchdown.mp3', at: 3.8, db: 2 },
  // Mars: air, ice, food, shield, rocks, build
  { f: 'sfx/plug.mp3', at: 8.04, db: 0 }, { f: 'sfx/spark.mp3', at: 8.05, db: -6 },
  { f: 'sfx/ice.mp3', at: 8.92, db: -2 },
  { f: 'sfx/drill.mp3', at: 9.0, len: 0.16, db: -8, out: 0.05 }, { f: 'sfx/ice.mp3', at: 9.14, db: 0 },
  { f: 'sfx/rover.mp3', at: 9.5, len: 0.5, db: 6, in: 0.05, out: 0.1 },
  { f: 'sfx/harvest.mp3', at: 10.05, db: -2 },
  { f: 'sfx/throw.mp3', at: 10.5, db: -4 }, { f: 'sfx/bag.mp3', at: 10.82, db: -4 },
  { f: 'sfx/swish.mp3', at: 11.0, db: -2 }, { f: 'sfx/thud.mp3', at: 11.2, db: 9 }, { f: 'sfx/ice.mp3', at: 11.21, db: -3 }, { f: 'sfx/pop.mp3', at: 11.32, db: -8 },
  { f: 'sfx/good.mp3', at: 11.52, db: -6 },
  // the storm
  { f: 'sfx/storm-alert.mp3', at: 12.0, db: -2 },
  { f: 'voice/storm-countdown.mp3', at: 12.2, db: 8, voice: true },
  { f: 'sfx/amb-storm.mp3', at: 12.0, len: 3.0, db: 2, in: 0.2, out: 0.3 },
  // the crash
  { f: 'sfx/rover.mp3', at: 15.0, len: 0.53, db: 7, in: 0.05, out: 0.03 },
  { f: 'sfx/hit.mp3', at: 15.52, db: 3 }, { f: 'sfx/thud.mp3', at: 15.52, db: 11 },
  // the hologram
  { f: 'sfx/discovery.mp3', at: 16.5, db: -7 },
  // the city: every ship touches down
  { f: 'sfx/touchdown.mp3', at: 19.0, db: -4 }, { f: 'sfx/touchdown.mp3', at: 20.0, db: -4 }, { f: 'sfx/touchdown.mp3', at: 21.0, db: -4 }, { f: 'sfx/touchdown.mp3', at: 22.0, db: -4 },
  // the launch: the rocket's own roar from the moment it is lit, "Liftoff!", and a last word from Mission Control
  { f: 'sfx/launch.mp3', at: 24.0, from: 1.72, db: 2 },
  { f: 'voice/launch-liftoff.mp3', at: 24.65, db: 8, voice: true },
  { f: 'landing/04-ready-commander.mp3', at: 27.3, db: 10, voice: true }
];

function ffmpeg(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-y'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(what + ' failed:\n' + String(r.stderr).split('\n').slice(-12).join('\n'));
  return r.stderr;
}
function loudness(file) {
  const log = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'measuring the loudness');
  const m = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/.exec(log);
  return m ? { i: parseFloat(m[1]), peak: parseFloat(m[2]) } : null;
}

function main() {
  const out = arg('out', null), frames = arg('frames', null), soundOnly = !!arg('sound-only', false), musicDb = +arg('music-db', -3);
  if (!out) throw new Error('Say where the result goes: --out <file>');
  if (!soundOnly && !frames) throw new Error('Say where the pictures are: --frames <folder>');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-film-sound-'));
  const mixFile = path.join(tmp, 'mix.wav'), soundFile = soundOnly ? out : path.join(tmp, 'sound.wav');
  let musicFile = arg('music', null);
  if (!musicFile || musicFile === true) {
    musicFile = path.join(tmp, 'score.wav');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'score.js'), musicFile], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('the score failed:\n' + r.stderr);
    process.stdout.write(r.stdout);
  }

  // every sound is cut, faded, made louder or quieter and moved to its place; then they are added up.
  // The music steps back whenever Mission Control speaks.
  const inputs = ['-i', musicFile], parts = ['[0:a]aresample=' + SR + ',aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:' + LEN + ',volume=' + musicDb + 'dB[music]'], names = [], voices = [];
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
    parts.push('[' + (i + 1) + ':a]' + f.join(',') + '[a' + (i + 1) + ']'); (c.voice ? voices : names).push('[a' + (i + 1) + ']');
  });
  parts.push(voices.join('') + 'amix=inputs=' + voices.length + ':normalize=0:dropout_transition=0,asplit=2[vox][key]');
  parts.push('[music][key]sidechaincompress=threshold=0.02:ratio=4:attack=40:release=400[bed]');
  names.push('[vox]', '[bed]');
  // a little more presence, a touch less fizz at the very top, then the end fade
  parts.push(names.join('') + 'amix=inputs=' + names.length + ':normalize=0:dropout_transition=0,equalizer=f=3400:t=q:w=1.1:g=2.5,highshelf=f=11000:g=-1.5,atrim=0:' + LEN + ',afade=t=out:st=' + (LEN - 0.5) + ':d=0.5[mix]');
  ffmpeg(inputs.concat(['-filter_complex', parts.join(';'), '-map', '[mix]', '-ar', String(SR), '-c:a', 'pcm_s24le', mixFile]), 'mixing the sound');

  // bring the whole mix to the loudness the video sites expect (-14 LUFS), with a ceiling so nothing clips
  const m = loudness(mixFile), gain = m ? Math.min(14, -14 - m.i) : 0;
  console.log('mix: ' + (m ? m.i + ' LUFS, peak ' + m.peak + ' dBFS' : 'not measured') + ' → gain ' + gain.toFixed(1) + ' dB');
  ffmpeg(['-i', mixFile, '-af', 'volume=' + gain.toFixed(2) + 'dB,alimiter=limit=0.8:attack=3:release=60:level=disabled', '-ar', String(SR), '-c:a', 'pcm_s16le', soundFile], 'levelling the sound');
  const m2 = loudness(soundFile);
  console.log('sound: ' + (m2 ? m2.i + ' LUFS, peak ' + m2.peak + ' dBFS' : 'not measured'));
  if (soundOnly) { console.log('sound → ' + out); return; }

  // the pictures: plain (f00000.jpg) or in motion-blur slices (g000000.jpg, two or more per frame)
  const names2 = fs.readdirSync(frames), plain = names2.filter((n) => /^f\d{5}\.jpg$/.test(n)).length, slices = names2.filter((n) => /^g\d{6}\.jpg$/.test(n)).length;
  const want = Math.round(LEN * FPS), subs = slices ? Math.round(slices / want) : 1;
  if (slices ? slices !== want * subs : plain !== want) throw new Error('expected ' + want + ' frames in ' + frames + ', found ' + (slices || plain) + (slices ? ' slices' : ''));
  const grade = 'eq=contrast=1.07:saturation=1.16:gamma=0.97,vignette=angle=0.3,unsharp=5:5:0.3:5:5:0';
  const input = slices ? ['-framerate', String(FPS * subs), '-i', path.join(frames, 'g%06d.jpg')] : ['-framerate', String(FPS), '-i', path.join(frames, 'f%05d.jpg')];
  const blend = slices ? 'tmix=frames=' + subs + ",select='eq(mod(n\\," + subs + ')\\,' + (subs - 1) + ")',setpts=N/(" + FPS + '*TB),' : '';
  ffmpeg(input.concat(['-i', soundFile, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(arg('crf', 19)), '-maxrate', '16M', '-bufsize', '32M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-vf', blend + grade + ',scale=in_range=full:out_range=tv:out_color_matrix=bt709', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', String(LEN), out]), 'making the film');
  console.log('film → ' + out + (slices ? ' (motion blur from ' + subs + ' slices a frame)' : ''));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the folder can stay */ }
}
try { main(); } catch (e) { console.error('FAILED: ' + (e && e.message || e)); process.exit(1); }
