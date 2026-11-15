#!/usr/bin/env node
/* Astro Outpost film — the recorder. It opens the real game in headless Chrome, freezes the clock
   (clock.js), lets director.js stage each shot, and saves one picture for every frame of the film.

     node tools/film/record.js --out <folder>                    every shot, full size (1920 x 1080)
     node tools/film/record.js --out <folder> --shots city,end   only these shots
     node tools/film/record.js --out <folder> --every 15         one frame in 15 (a quick look at the whole film)
     node tools/film/record.js --out <folder> --size 960         smaller pictures, faster
     node tools/film/record.js --out <folder> --blur 2           two slices per frame, blended by build.js into motion blur
     node tools/film/record.js --film gameplay --out <folder>    the 80-second gameplay film (tools/film/gameplay.js)
     node tools/film/record.js --list                            print the shot list and stop

   Needs Node 22 or newer (for its built-in WebSocket) and Chrome. Nothing is installed.
   The pictures are joined into a film, with sound, by tools/film/build.js. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

function findChrome() {
  const c = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => p && fs.existsSync(p));
}
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }); res.end(buf);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  const out = arg('out', null), only = arg('shots', null), every = +arg('every', 1), width = +arg('size', 1920), listOnly = !!arg('list', false);
  const soft = !!arg('soft', false), from = +arg('from', 0), jpeg = +arg('quality', 95), subs = Math.max(1, +arg('blur', 1));
  const film = String(arg('film', 'director')).replace(/[^a-z0-9_-]/gi, ''), script = path.join(__dirname, film + '.js');
  if (!fs.existsSync(script)) throw new Error('no film script ' + script);
  if (!out && !listOnly) throw new Error('Say where the pictures go: --out <folder>');
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found. Set the CHROME environment variable to its path.');
  if (typeof WebSocket === 'undefined') throw new Error('The recorder needs Node 22 or newer.');
  if (out) fs.mkdirSync(out, { recursive: true });
  const srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-film-'));
  // the page is laid out at 1280 x 720 and drawn 1.5 times larger, so the game's own screens stay readable at 1080p
  const scale = width / 1280;
  const gpu = soft ? ['--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--no-first-run', '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1280,720', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'].concat(gpu, ['about:blank']), { stdio: 'ignore' });
  let ws = null, failed = false;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (e) { /* not up yet */ } }
    if (!port) throw new Error('Chrome did not start.');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not connect to Chrome')); });
    let seq = 0; const waiting = {}, errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; return; }
      if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description).join(' '));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push(m.params.response.status + ' ' + m.params.response.url.replace(base, ''));
    };
    const send = (method, params) => new Promise((res) => { const id = ++seq; waiting[id] = res; ws.send(JSON.stringify({ id, method, params: params || {} })); });
    const run = async (code) => {
      const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error('in the page: ' + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
      return r.result.result.value;
    };
    await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: scale, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(__dirname, 'clock.js'), 'utf8') });
    // open the game afresh (each world gets a clean page) and hand it to the director
    let loads = 0;
    const load = async () => {
      await send('Page.navigate', { url: base + 'index.html?fx=2&take=' + (++loads) });
      // the game starts itself; the clock is frozen, so give it time steps until it is ready
      let ready = false;
      for (let i = 0; i < 600 && !ready; i++) {
        await sleep(50);
        try { ready = await run('(function(){ if (!window.__clock || window.__film) return false; __clock.tick(1000 / 60); return !!(window.JA && JA.game && JA.game.advance && JA.world && JA.world.ready && JA.actors && JA.actors.astro); })()'); } catch (e) { /* the page is still changing */ }
      }
      if (!ready) throw new Error('The game did not start. ' + errors.join(' | '));
      await run(fs.readFileSync(script, 'utf8') + '\n;true');
    };
    await load();
    let world = null;
    const info = await run('__film.info()');
    if (out && await run('!!(window.__film && __film.soundMeta)')) fs.writeFileSync(path.join(out, 'sound-meta.json'), JSON.stringify(await run('__film.soundMeta()')));
    console.log('graphics: ' + info.gl);
    const shots = info.shots;
    let at = 0; shots.forEach((s) => { s.first = at; at += s.frames; });
    console.log('film: ' + at + ' frames, ' + (at / info.fps).toFixed(2) + ' s at ' + info.fps + ' frames a second');
    shots.forEach((s) => console.log('  ' + String(s.first).padStart(4) + '  ' + (s.first / info.fps).toFixed(2).padStart(6) + ' s  ' + s.id.padEnd(12) + s.frames + ' frames'));
    if (listOnly) return;
    const pick = only && only !== true ? String(only).split(',') : null;
    const t0 = Date.now(); let made = 0;
    for (const s of shots) {
      if (pick && pick.indexOf(s.id) < 0) continue;
      if (s.first + s.frames <= from) continue;
      const tb = Date.now();
      if (world !== null && s.world !== world) await load();
      world = s.world;
      await run('__film.begin(' + JSON.stringify(s.id) + ')');
      for (let f = 0; f < s.frames; f++) {
        const keep = (s.first + f) % every === 0 && s.first + f >= from;
        for (let k = 0; k < subs; k++) {
          await run('__film.frame(' + JSON.stringify(s.id) + ',' + f + ',' + k + ',' + subs + ')');
          if (!keep) continue;
          const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: jpeg, fromSurface: true, captureBeyondViewport: false });
          if (!shot.result || !shot.result.data) throw new Error('no picture for frame ' + (s.first + f) + ': ' + JSON.stringify(shot.error || {}));
          const name = subs > 1 ? 'g' + String((s.first + f) * subs + k).padStart(6, '0') : 'f' + String(s.first + f).padStart(5, '0');
          fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(shot.result.data, 'base64'));
          made++;
        }
      }
      const note = await run('__film.finish(' + JSON.stringify(s.id) + ')');
      // the gameplay film writes down the game's own sounds, shot by shot (mixed by gamesound.js)
      if (await run('!!__film.sound')) fs.writeFileSync(path.join(out, 'sound-' + s.id + '.json'), JSON.stringify(await run('__film.sound(' + JSON.stringify(s.id) + ')')));
      console.log('shot ' + s.id + ': ' + ((Date.now() - tb) / 1000).toFixed(1) + ' s  ' + note);
    }
    const pageErrors = await run('__clock.errors.slice(0, 20)');
    errors.concat(pageErrors).filter((e, i, a) => a.indexOf(e) === i).slice(0, 30).forEach((e) => console.log('note from the page: ' + String(e).slice(0, 300)));
    console.log(made + ' pictures in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s → ' + out);
  } catch (e) { failed = true; console.error('FAILED: ' + (e && e.message || e)); }
  finally {
    try { if (ws) ws.close(); } catch (e) { /* closing */ }
    chrome.kill(); srv.close();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold a file */ }
  }
  process.exit(failed ? 1 : 0);
}
main();
