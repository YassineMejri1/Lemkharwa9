/* The game for one player, played through in headless Chrome: the crew-mode changes must leave it as it was.
     node tools/tests/solo.test.js
   Needs Node 22 or newer and Chrome. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, ok, info) { if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } }
function findChrome() {
  return [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
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
  const chrome = findChrome(); if (!chrome) throw new Error('Chrome not found (set CHROME)');
  const srv = await serve(), url = 'http://127.0.0.1:' + srv.address().port + '/index.html?fx=0';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-solo-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--disable-extensions',
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=960,540', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (e) { /* starting */ } }
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res) => { ws.onopen = res; });
    let seq = 0; const waiting = {}, errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; return; }
      if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    };
    const send = (method, params) => new Promise((res) => { const id = ++seq; waiting[id] = res; ws.send(JSON.stringify({ id, method, params: params || {} })); });
    const run = async (code) => { const r = await send('Runtime.evaluate', { expression: '(async () => { ' + code + ' })()', awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); return r.result.result.value; };
    const until = async (code, ms, label) => { const end = Date.now() + (ms || 15000); while (Date.now() < end) { if (await run(code)) return true; await sleep(150); } throw new Error('timed out waiting for ' + (label || code)); };
    // the game is stepped by hand here (a fixed 1/30 s per step), so the result does not depend on this computer's speed
    const steps = (n) => run('for (var i = 0; i < ' + n + '; i++) JA.game.advance(1 / 30);');
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url });
    await until('return window.JA && JA.game && JA.game.mode === "title"', 30000, 'the title');
    check('crew mode is off in a game for one', await run('return !JA.crew.on'));
    await run('document.getElementById("btn-start").click(); var o = JA.game.opts; o.site = "mars"; o.level = "cadet"; o.sun = "archive"; o.shift = 180; document.querySelector("#modal-root [data-act=go]").click();');
    await until('return JA.game.mode === "intro" || JA.game.mode === "brief"', 30000, 'the mission');
    await run('if (JA.game.mode === "intro") JA.intro.skip();');
    await until('return JA.game.mode === "brief" && JA.ui.modalOpen()', 20000, 'the welcome card');
    check('the welcome card\'s button can be pressed', await run('var b = document.querySelector("#modal-root [data-act=ok]"); return !!b && !b.disabled && !document.querySelector(".crew-waiting");'));
    await run('document.querySelector("#modal-root [data-act=ok]").click();');
    check('outside on day 1', await run('return JA.game.mode === "play" && !JA.ui.modalOpen()'));
    // take a cell and plug it into the Air Maker
    await run('var c = JA.actors.items.filter(function (i) { return i.tag === "rack"; })[0], a = JA.actors.astro; a.pos.set(c.pos.x + 1.1, 0, c.pos.z + 1.1); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await steps(2); await run('JA.game.ePressed = true;'); await steps(2);
    check('picking up a power cell', await run('return !!JA.actors.astro.carrying && JA.actors.astro.carrying.type === "cell" && JA.actors.astro.carrying.holder === JA.actors.astro'));
    await run('var q = JA.base.spots.sockets.air, a = JA.actors.astro; a.pos.set(q.x + 1.4, 0, q.z + 1.4); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await steps(2); await run('JA.game.ePressed = true;'); await steps(2);
    check('plugging it into the Air Maker', await run('return JA.game.s.m.air.power > 0 && !JA.actors.astro.carrying'));
    // another cell: put it down with Q, then pick it up and throw it
    await run('var c = JA.actors.items.filter(function (i) { return i.tag === "rack"; })[0], a = JA.actors.astro; a.pos.set(c.pos.x + 1.1, 0, c.pos.z + 1.1); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await steps(2); await run('JA.game.ePressed = true;'); await steps(2);
    await run('JA.game.qPressed = true;'); await steps(40);
    check('putting it down', await run('return !JA.actors.astro.carrying && JA.actors.items.some(function (i) { return i.type === "cell" && i.state === "rest"; })'));
    await steps(2); await run('JA.game.ePressed = true;'); await steps(2);
    await run('JA.game.fHeld = true;'); await steps(20); await run('JA.game.fHeld = false;'); await steps(3);
    check('throwing it', await run('return !JA.actors.astro.carrying && JA.actors.items.some(function (i) { return i.type === "cell" && i.state === "fly"; })'));
    await steps(90);
    // drive the rover and get out
    await run('var a = JA.actors.astro; JA.actors.roverSpot("door", a.pos); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await steps(2); await run('JA.game.ePressed = true;'); await steps(2);
    check('driving the rover', await run('return JA.actors.rover.driver && !JA.actors.rover.remote'));
    const r0 = await run('return [JA.actors.rover.pos.x, JA.actors.rover.pos.z]');
    await run('JA.game.keys.up = true;'); await steps(60); await run('JA.game.keys.up = false;'); await steps(30);
    const r1 = await run('return [JA.actors.rover.pos.x, JA.actors.rover.pos.z]');
    check('the rover moves (' + Math.hypot(r1[0] - r0[0], r1[1] - r0[1]).toFixed(1) + ' m)', Math.hypot(r1[0] - r0[0], r1[1] - r0[1]) > 2);
    await run('JA.game.ePressed = true;'); await steps(2);
    check('getting out of the rover', await run('return !JA.actors.rover.driver && JA.actors.astro.mode === "walk"'));
    // the pause card stops the clock in a game for one
    const t0 = await run('return JA.game.s.t');
    await run('document.getElementById("btn-pause").click();'); await steps(60);
    const t1 = await run('return JA.game.s.t');
    check('the pause card stops the clock', Math.abs(t1 - t0) < 1e-6, [t0, t1]);
    check('it still offers the day length', await run('return !!document.querySelector("#modal-root [data-act=shift]") && /Paused/.test(document.getElementById("modal-root").textContent)'));
    await run('document.querySelector("#modal-root [data-act=ok]").click();');
    // inside and out
    await run('var d = JA.base.spots.door, a = JA.actors.astro; a.pos.set(d.x, 0, d.z + 1); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await steps(2); await run('JA.game.ePressed = true;'); await steps(10);
    check('going into the habitat', await run('return JA.game.mode === "inside"'));
    // the night, the next morning
    await run('JA.game._.endDay({});');
    await until('JA.game.advance(1 / 30); return JA.game.mode === "night" && JA.ui.modalOpen() && /Night report/.test(document.getElementById("modal-root").textContent)', 20000, 'the night report');
    check('the night report', true);
    await run('document.querySelector("#modal-root [data-act=next]").click();');
    await until('return JA.game.s.sol === 2 && JA.ui.modalOpen()', 10000, 'day 2');
    await run('document.querySelector("#modal-root [data-act=ok]").click();');
    check('day 2 begins', await run('return JA.game.mode === "play"'));
    // lose: the launch scene, then the results
    await run('JA.game.s.air = 0;'); await steps(5);
    check('running out of air starts the launch', await run('return JA.game.mode === "launch"'));
    await steps(330);
    await until('JA.game.advance(1 / 30); return JA.game.mode === "end" && JA.ui.modalOpen()', 20000, 'the results');
    check('the results offer "Play again"', await run('return !!document.querySelector("#modal-root [data-act=again]") && !document.querySelector("#modal-root [data-act=leave]")'));
    check('no script errors', !errors.length, errors);
  } finally { if (ws) ws.close(); proc.kill(); srv.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* busy */ } }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e.message || e); console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed'); process.exit(1); });
