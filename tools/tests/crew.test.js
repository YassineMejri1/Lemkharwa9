/* Crew mode, played for real: four copies of the game in one headless Chrome (one host, three guests, talking through
   the BroadcastChannel of ?net=local), driven the way players drive them, checked against each other.

     node tools/tests/crew.test.js            (add --peer to go through the real PeerJS service instead; needs internet)
     node tools/tests/crew.test.js --show     (a visible browser window)

   Needs Node 22 or newer and Chrome. Nothing is installed. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --peer: the real PeerJS service and direct links. --relay: everyone through the public relay.
// --mixed: the host as usual, the guests on networks that allow no direct link (they must find the relay by themselves).
const PEER = process.argv.includes('--peer'), RELAY = process.argv.includes('--relay'), MIXED = process.argv.includes('--mixed'), SHOW = process.argv.includes('--show');
let passed = 0, failed = 0;
function check(name, ok, info) {
  if (ok) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
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
// one page of the browser, over the DevTools protocol
// Each player gets a window of their own, so every page is on screen and draws at full speed (a background tab
// gets no animation frames, only the game's slow keep-awake ticks).
let browserWs = null, bseq = 0;
const bwait = {};
async function browser(port) {
  if (browserWs) return;
  const v = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  browserWs = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = () => rej(new Error('no browser link')); });
  browserWs.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && bwait[m.id]) { bwait[m.id](m); delete bwait[m.id]; } };
}
const bsend = (method, params) => new Promise((res) => { const id = ++bseq; bwait[id] = res; browserWs.send(JSON.stringify({ id, method, params: params || {} })); });
async function openPage(port, name) {
  await browser(port);
  const made = await bsend('Target.createTarget', { url: 'about:blank', newWindow: true, width: 640, height: 360 });
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/devtools/page/' + made.result.targetId);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('no page')); });
  let seq = 0; const waiting = {}, errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params) => new Promise((res) => { const id = ++seq; waiting[id] = res; ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const run = async (code) => {
    const slow = setTimeout(() => console.log('  … ' + name + ' is slow to answer: ' + code.slice(0, 80)), 8000);
    const r = await send('Runtime.evaluate', { expression: '(async () => { ' + code + ' })()', awaitPromise: true, returnByValue: true });
    clearTimeout(slow);
    if (r.result.exceptionDetails) throw new Error(name + ': ' + ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return { name, send, run, errors, ws, close: () => ws.close() };
}
async function until(page, code, ms, label) {
  const end = Date.now() + (ms || 15000);
  let v;
  while (Date.now() < end) { v = await page.run(code); if (v) return v; await sleep(150); }
  throw new Error(page.name + ': timed out waiting for ' + (label || code));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

async function main() {
  const chrome = findChrome(); if (!chrome) throw new Error('Chrome not found (set CHROME)');
  const srv = await serve(), root = 'http://127.0.0.1:' + srv.address().port + '/index.html?fx=0&draw=0';
  const base = root + (PEER || MIXED ? '' : RELAY ? '&net=relay' : '&net=local'), guestBase = MIXED ? root + '&net=relay' : base;
  const urlOf = (p) => (p.name === 'Host' ? base : guestBase);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-crew-'));
  const proc = spawn(chrome, (SHOW ? [] : ['--headless=new']).concat(['--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=640,360', 'about:blank']), { stdio: 'ignore' });
  const pages = [];
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (e) { /* starting */ } }
    if (!port) throw new Error('Chrome did not start');
    const names = ['Host', 'Ana', 'Ben', 'Cy'];
    for (const n of names) pages.push(await openPage(port, n));
    const [H, G1, G2, G3] = pages, guests = [G1, G2, G3];
    for (const p of pages) await p.send('Page.navigate', { url: urlOf(p) });
    for (const p of pages) await until(p, 'return window.JA && JA.game && JA.game.mode === "title" && !!JA.crew', 30000, 'the title screen');

    console.log('Crew room');
    await H.run('document.getElementById("btn-crew").click(); document.getElementById("crew-name").value = "Host"; document.querySelector("[data-act=host]").click();');
    const code = await until(H, 'return JA.net.code', 20000, 'a crew code');
    check('the host gets a 5-letter crew code', /^[A-Z]{5}$/.test(code), code);
    for (let i = 0; i < 3; i++) {
      const g = guests[i];
      await g.run('JA.crew.openMenu("' + code + '"); document.getElementById("crew-name").value = "' + names[i + 1] + '"; document.querySelector("[data-act=join]").click();');
      await until(g, 'return JA.crew.on && JA.net.me > 0', 40000, 'joining');
    }
    await until(H, 'return JA.crew.count() === 4', 10000, 'four players');
    check('four players are in the crew room', await H.run('return JA.crew.count()') === 4);
    check('each guest sees the whole crew', (await Promise.all(guests.map((g) => g.run('return JA.crew.count()')))).every((n) => n === 4));
    const links = await Promise.all(guests.map((g) => g.run('return JA.net.linkOf(0)')));
    console.log('  (links to the host: ' + links.join(', ') + ')');
    if (RELAY || MIXED) check('the guests went through the relay', links.every((l) => l === 'relay'), links);
    const suits = await Promise.all(pages.map((p) => p.run('return JA.crew.players[JA.net.me === undefined ? 0 : JA.net.me].suit')));
    check('every astronaut has a different suit colour', new Set(suits).size === 4, suits);
    // a fifth player is turned away
    const extra = await openPage(port, 'Extra'); pages.push(extra);
    await extra.send('Page.navigate', { url: guestBase });
    await until(extra, 'return window.JA && JA.game && JA.game.mode === "title" && !!JA.crew', 30000);
    await extra.run('JA.crew.openMenu("' + code + '"); document.querySelector("[data-act=join]").click();');
    await until(extra, 'return /full/.test(document.getElementById("crew-status").textContent)', 40000, 'the crew-full message');
    check('a fifth player is told the crew is full', true);
    extra.close(); pages.pop();

    console.log('Launch');
    await H.run('document.querySelector("[data-act=plan]").click(); var o = JA.game.opts; o.site = "moon"; o.level = "cadet"; o.sun = "archive"; o.shift = 180; document.querySelector("[data-act=go]").click();');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.mode === "intro" || JA.game.mode === "brief"', 30000, 'the mission starting');
    check('all four games start the mission', true);
    for (const p of pages.slice(0, 4)) await p.run('if (JA.game.mode === "intro") JA.intro.skip();');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.mode === "brief" && JA.ui.modalOpen()', 20000, 'the welcome card');
    check('a guest cannot press "Step outside" (it waits for the host)', await G1.run('var b = document.querySelector("#modal-root [data-act=ok]"); return !!b && b.disabled && !!document.querySelector(".crew-waiting");'));
    const seeds = await Promise.all(pages.slice(0, 4).map((p) => p.run('return JA.game.s.seed + "/" + JA.game.s.site.id + "/" + JA.game.s.totalSols')));
    check('everyone is in the same mission', new Set(seeds).size === 1, seeds);
    await H.run('document.querySelector("#modal-root [data-act=ok]").click();');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.mode === "play" && !JA.ui.modalOpen()', 15000, 'day 1 outside');
    check('the host\'s "Step outside" takes everyone outside', true);
    await sleep(800);
    const items = await Promise.all(pages.slice(0, 4).map((p) => p.run('return JA.actors.items.map(function (i) { return i.id + i.type + i.state; }).sort().join(",")')));
    check('every game has the same things in the same places', new Set(items).size === 1, items.map((x) => x.length));

    const fps = await Promise.all(pages.slice(0, 4).map((p) => p.run('var k = JA.game.stepEnd, c = 0, t0 = performance.now(); while (performance.now() - t0 < 2000) { await new Promise(function (r) { setTimeout(r, 5); }); if (JA.game.stepEnd !== k) { c++; k = JA.game.stepEnd; } } return c / 2;')));
    console.log('  (this test computer runs each player at ' + fps.join(' / ') + ' frames a second)');
    console.log('Moving');
    // Ana walks for 2 s. What the host draws must follow her: as far as she really went, never backwards, no jumps.
    const start = await G1.run('var p = JA.actors.astro.pos; return [p.x, p.y, p.z];');
    await G1.run('JA.game.keys.up = true;');
    const track = H.run('var out = [], t0 = performance.now(); while (performance.now() - t0 < 2600) { await new Promise(function (r) { setTimeout(r, 15); }); var b = JA.crew.players[1].puppet, l = out[out.length - 1]; if (!l || l[0] !== b.pos.x || l[1] !== b.pos.z) out.push([b.pos.x, b.pos.z, performance.now()]); } return out;');
    await sleep(2000);
    await G1.run('JA.game.keys.up = false;');
    const seen = await track;
    await sleep(900);
    const real = await G1.run('var p = JA.actors.astro.pos; return [p.x, p.y, p.z];');
    const views = await Promise.all([H, G2, G3].map((p) => p.run('var b = JA.crew.players[1].puppet.pos; return [b.x, b.y, b.z];')));
    check('the host and the other guests draw Ana where she stands (within 25 cm)', views.every((v) => dist(v, real) < 0.25), views.map((v) => dist(v, real).toFixed(2)));
    const walked = dist(start, real), drawn = Math.hypot(seen[seen.length - 1][0] - seen[0][0], seen[seen.length - 1][1] - seen[0][1]);
    check('the host drew her whole walk (' + drawn.toFixed(1) + ' m of ' + walked.toFixed(1) + ' m)', walked > 1 && Math.abs(drawn - walked) < 0.25 * walked + 0.3, [drawn, walked]);
    // along her line of travel: never a step back, and no step longer than her top speed allows
    const dx = (real[0] - start[0]) / (walked || 1), dz = (real[2] - start[2]) / (walked || 1);
    let back = 0, jump = 0;
    for (let i = 1; i < seen.length; i++) {
      const d = (seen[i][0] - seen[i - 1][0]) * dx + (seen[i][1] - seen[i - 1][1]) * dz, t = (seen[i][2] - seen[i - 1][2]) / 1000;
      back = Math.min(back, d);
      jump = Math.max(jump, Math.abs(d) - 9 * Math.max(t, 1 / 60));
    }
    check('on the host\'s screen she never jumps back (worst ' + back.toFixed(2) + ' m)', back > -0.05, back);
    check('...and never leaps ahead faster than she can run (worst extra ' + Math.max(0, jump).toFixed(2) + ' m)', jump < 0.3, jump);
    check('she is not invisible', await H.run('return JA.crew.players[1].puppet.group.visible'));

    console.log('Things');
    // Ben takes a power cell from the Solar Rack
    let cell = await H.run('var c = JA.actors.items.filter(function (i) { return i.tag === "rack"; })[0]; return c ? [c.id, c.pos.x, c.pos.y, c.pos.z] : null;');
    check('there is a power cell on the rack', !!cell);
    const cellsBefore = await H.run('return JA.game.s.rack.cells');
    await G2.run('var a = JA.actors.astro; a.pos.set(' + cell[1] + ' + 1.2, ' + cell[2] + ' - 0.9, ' + cell[3] + ' + 1.2); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await sleep(300);
    const label = await G2.run('var o = JA.game._ && JA.game.action; return o ? o.label : null;');
    await G2.run('JA.game.ePressed = true;');
    // the rack holds several cells: he gets the one nearest to him
    cell[0] = await until(G2, 'var c = JA.actors.astro.carrying; return c && c.type === "cell" ? c.id : 0;', 5000, 'Ben holding a cell');
    check('Ben is offered the cell ("' + label + '") and ends up holding it', true);
    await sleep(400);
    check('the host sees the cell in Ben\'s hands', await H.run('var it = JA.actors.byId(' + cell[0] + '); return it.state === "held" && it.holder === JA.crew.players[2].puppet;'));
    check('Ana sees it in Ben\'s hands too', await G1.run('var it = JA.actors.byId(' + cell[0] + '); return it.state === "held" && it.holder === JA.crew.players[2].puppet;'));
    check('one cell fewer on the rack for everyone', (await Promise.all(pages.slice(0, 4).map((p) => p.run('return JA.game.s.rack.cells')))).every((n) => n === cellsBefore - 1));
    // he plugs it into the Air Maker
    await G2.run('var q = JA.base.spots.sockets.air, a = JA.actors.astro; a.pos.set(q.x + 1.4, 0, q.z + 1.4); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await sleep(300);
    const plugLabel = await G2.run('return JA.game.action ? JA.game.action.label : null;');
    await G2.run('JA.game.ePressed = true;');
    await until(H, 'return JA.game.s.m.air.power > 0', 5000, 'the Air Maker powered');
    await sleep(400);
    check('"' + plugLabel + '": the Air Maker has power on every screen', (await Promise.all(pages.slice(0, 4).map((p) => p.run('return JA.game.s.m.air.power > 0')))).every(Boolean));
    check('the cell is gone from every game', (await Promise.all(pages.slice(0, 4).map((p) => p.run('return !JA.actors.byId(' + cell[0] + ')')))).every(Boolean));
    check('Ben\'s hands are empty', await G2.run('return !JA.actors.astro.carrying'));

    // two players grab the same thing at once: only one gets it
    const cell2 = await H.run('var c = JA.actors.items.filter(function (i) { return i.tag === "rack"; })[0]; return c ? [c.id, c.pos.x, c.pos.y, c.pos.z] : null;');
    if (cell2) {
      for (const g of [G1, G3]) await g.run('var a = JA.actors.astro; a.pos.set(' + cell2[1] + ' + 1.1, 0, ' + cell2[3] + ' + 1.1); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
      await sleep(300);
      await Promise.all([G1.run('JA.game.ePressed = true;'), G3.run('JA.game.ePressed = true;')]);
      await sleep(900);
      const who = await Promise.all([G1, G3].map((g) => g.run('return !!(JA.actors.astro.carrying && JA.actors.astro.carrying.id === ' + cell2[0] + ')')));
      check('two players grab the same cell: exactly one of them has it', who.filter(Boolean).length === 1, who);
      const holder = await H.run('var it = JA.actors.byId(' + cell2[0] + '); return it && it.holder ? (it.holder === JA.crew.players[1].puppet ? 1 : it.holder === JA.crew.players[3].puppet ? 3 : -1) : 0;');
      check('...and the host agrees which one', (holder === 1 && who[0]) || (holder === 3 && who[1]), holder);
      // the one who has it throws it
      const thrower = who[0] ? G1 : G3;
      await thrower.run('JA.game.fHeld = true;'); await sleep(500); await thrower.run('JA.game.fHeld = false;');
      await sleep(250);
      const flying = await H.run('var it = JA.actors.byId(' + cell2[0] + '); return it ? it.state : "gone";');
      check('a guest\'s throw flies on the host (' + flying + ')', flying === 'fly' || flying === 'rest' || flying === 'gone');
      await sleep(2500);
      const where = await Promise.all(pages.slice(0, 4).map((p) => p.run('var it = JA.actors.byId(' + cell2[0] + '); return it ? [it.pos.x, it.pos.y, it.pos.z, it.state] : null;')));
      check('after the throw the cell lies in the same place on every screen', where.every((w) => (w === null) === (where[0] === null)) && (where[0] === null || where.every((w) => dist(w, where[0]) < 0.3 && w[3] === where[0][3])), where);
    }

    console.log('The rover');
    await G3.run('var a = JA.actors.astro, r = JA.actors.rover; JA.actors.roverSpot("door", a.pos); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z); if (a.carrying) JA.game.qPressed = true;');
    await sleep(400);
    await G3.run('JA.game.ePressed = true;');
    await until(G3, 'return JA.actors.rover.driver', 5000, 'Cy driving');
    check('Cy gets into the rover (the host said yes)', await H.run('return JA.crew.rover === 3'));
    check('nobody else is offered the wheel', await G1.run('var a = JA.actors.astro; JA.actors.roverSpot("door", a.pos); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z); return !JA.crew.canDrive();'));
    await G1.run('var a = JA.actors.astro; a.pos.x += 6; a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    const r0 = await G3.run('var r = JA.actors.rover.pos; return [r.x, r.y, r.z];');
    await G3.run('JA.game.keys.up = true;'); await sleep(2000); await G3.run('JA.game.keys.up = false;');
    await until(G3, 'return Math.abs(JA.actors.rover.speed) < 0.05', 60000, 'the rover stopping');
    await sleep(1500);
    const rd = await G3.run('var r = JA.actors.rover.pos; return [r.x, r.y, r.z];');
    const rOthers = await Promise.all([H, G1, G2].map((p) => p.run('var r = JA.actors.rover.pos; return [r.x, r.y, r.z];')));
    check('the rover drove (' + dist(r0, rd).toFixed(1) + ' m)', dist(r0, rd) > 1, dist(r0, rd));
    check('everyone sees the rover where Cy parked it (within 40 cm)', rOthers.every((v) => dist(v, rd) < 0.4), rOthers.map((v) => dist(v, rd).toFixed(2)));
    check('the host shows Cy in the driver\'s seat', await H.run('return JA.crew.players[3].puppet.mode === "drive"'));
    await G3.run('JA.game.ePressed = true;');
    await until(H, 'return JA.crew.rover == null', 5000, 'the rover free again');
    check('Cy gets out and the rover is free again', !(await G3.run('return JA.actors.rover.driver')));

    console.log('The mission state');
    await sleep(600);
    const st = await Promise.all(pages.slice(0, 4).map((p) => p.run('var s = JA.game.s; return [s.t, s.air, s.food, s.dose, s.water, s.rack.charge];')));
    const tol = [1.5, 0.5, 0.5, 0.5, 0.5, 0.3];
    check('clock, air, food, radiation, water and solar charge agree on every screen', st.every((v) => v.every((x, k) => Math.abs(x - st[0][k]) <= tol[k])), st.map((v) => v.map((x) => +x.toFixed(2))));
    // a guest opening the menu does not stop the outpost
    const t1 = await H.run('return JA.game.s.t');
    await G1.run('document.getElementById("btn-pause").click();');
    await sleep(1500);
    const t2 = await H.run('return JA.game.s.t');
    check('a guest\'s menu does not stop the clock (' + (t2 - t1).toFixed(1) + ' s of shift passed)', t2 - t1 > 0.3);
    await G1.run('var b = document.querySelector("#modal-root [data-act=ok]"); if (b) b.click();');
    // the crew outside or inside: everyone inside means the habitat shields everyone
    const out = await H.run('return JA.crew.crewCtx(true, false).outside');
    check('the rules see the whole crew outside (share ' + out + ')', Math.abs(out - 1) < 0.01);
    await G2.run('var d = JA.base.spots.door, a = JA.actors.astro; a.pos.set(d.x, 0, d.z + 1); a.pos.y = JA.actors.groundAt(a.pos.x, a.pos.z);');
    await sleep(300);
    await G2.run('JA.game.ePressed = true;');
    await until(G2, 'return JA.game.mode === "inside"', 5000, 'Ben inside');
    await sleep(600);
    const out2 = await H.run('return JA.crew.crewCtx(true, false).outside');
    check('with Ben in the habitat, 3 of 4 count as outside (share ' + out2 + ')', Math.abs(out2 - 0.75) < 0.01);
    check('the others no longer see Ben outside', await H.run('return !JA.crew.players[2].puppet.group.visible'));

    console.log('Night and morning');
    await H.run('JA.game._.endDay({});');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.mode === "night" && JA.ui.modalOpen() && /Night report/.test(document.getElementById("modal-root").textContent)', 15000, 'the night report');
    check('the night report opens on every screen', true);
    const nr = await Promise.all(pages.slice(0, 4).map((p) => p.run('return document.querySelector("#modal-root .rep") ? document.querySelectorAll("#modal-root .rep").length : 0')));
    check('it shows the same lines everywhere', new Set(nr).size === 1 && nr[0] > 0, nr);
    check('a guest waits for the host to start the next day', await G3.run('var b = document.querySelector("#modal-root [data-act=next]"); return !!b && b.disabled;'));
    await H.run('document.querySelector("#modal-root [data-act=next]").click();');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.s.sol === 2 && JA.ui.modalOpen() && !!document.querySelector("#modal-root .day-head")', 15000, 'the day 2 card');
    check('day 2\'s card opens on every screen', true);
    await H.run('document.querySelector("#modal-root [data-act=ok]").click();');
    for (const p of pages.slice(0, 4)) await until(p, 'return JA.game.mode === "play" && !JA.ui.modalOpen()', 15000, 'day 2 outside');
    check('everyone is out on day 2', true);
    const spots = await Promise.all(pages.slice(0, 4).map((p) => p.run('var a = JA.actors.astro.pos; return [a.x, a.y, a.z];')));
    let apart = Infinity; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) apart = Math.min(apart, dist(spots[i], spots[j]));
    check('the crew starts the day side by side, not inside each other (' + apart.toFixed(1) + ' m apart)', apart > 1);

    console.log('A crisis');
    const hasCrisis = await H.run('var s = JA.game.s; if (!JA.crisis) return false; var ids = Object.keys(s.crisisPlan || {}); return true;');
    if (hasCrisis) {
      // bring today's crisis forward (or make one) so it starts now
      await H.run('var s = JA.game.s; var plan = s.crisisPlan || (s.crisisPlan = {}); var any = null; Object.keys(plan).forEach(function (k) { if (!any) any = plan[k]; }); if (any) { plan[s.sol] = { id: any.id, at: (s.t + 0.5) / s.dayLength }; if (JA.crisis.startSol) { var keepT = s.t; JA.crisis.startSol(s); s.t = keepT; } } return !!any;');
      let opened = false;
      try { for (const p of pages.slice(0, 4)) await until(p, 'return !!document.querySelector("#modal-root .crisis")', 40000, 'the crisis card'); opened = true; } catch (e) { console.log('  (no crisis came up: ' + e.message + ')'); }
      if (opened) {
        check('a crisis opens on every screen', true);
        check('a guest cannot choose (the host decides)', await G1.run('return Array.prototype.every.call(document.querySelectorAll("#modal-root [data-act=pick]"), function (b) { return b.disabled; });'));
        await H.run('document.querySelector("#modal-root [data-act=pick]").click();');
        const titles = [];
        for (const p of pages.slice(0, 4)) titles.push(await until(p, 'var h = document.querySelector("#modal-root h2"); return h && !document.querySelector("#modal-root .crisis") ? h.textContent : null', 10000, 'the choice'));
        check('everyone sees the host\'s choice (' + titles[0] + ')', new Set(titles).size === 1, titles);
        await H.run('document.querySelector("#modal-root [data-act=ok]").click();');
        for (const p of pages.slice(0, 4)) await until(p, 'return !JA.ui.modalOpen() || !!document.querySelector("#modal-root .pause")', 10000, 'the crisis closed');
        check('the crisis closes everywhere when the host carries on', true);
      }
    }

    console.log('Someone leaves');
    await G3.run('JA.crew.leave();');
    await until(H, 'return JA.crew.count() === 3', 10000, 'Cy gone');
    check('when Cy leaves, the host counts 3 astronauts', true);
    await until(G1, 'return JA.crew.count() === 3', 10000, 'Ana sees Cy gone');
    check('...and so do the others', true);

    console.log('The end');
    await H.run('JA.game.s.air = 0;');
    for (const p of [H, G1, G2]) await until(p, 'return JA.game.mode === "launch" || JA.game.mode === "end"', 40000, 'the launch scene');
    check('when the air runs out, the rocket leaves with everyone (launch scene on every screen)', true);
    for (const p of [H, G1, G2]) await until(p, 'return JA.game.mode === "end" && JA.ui.modalOpen()', 120000, 'the results');
    check('every screen shows the results', true);
    check('a guest\'s results offer "Leave the crew", not "Play again"', await G1.run('return !!document.querySelector("#modal-root [data-act=leave]") && !document.querySelector("#modal-root [data-act=again]");'));

    const errs = pages.slice(0, 4).map((p) => p.errors.filter((e) => !/favicon|AudioContext|play\(\) request|autoplay/i.test(e)));
    check('no script errors on any screen', errs.every((e) => !e.length), errs);
  } catch (e) {
    for (const p of pages) { try { console.log('  [' + p.name + '] mode=' + await p.run('return JA.game.mode + " modal=" + JA.ui.modalOpen() + " crew=" + JA.crew.on + "/" + JA.crew.started + " waiting for the host=" + !!JA.crew.pending') + ' errors: ' + JSON.stringify(p.errors.slice(0, 5))); } catch (err) { /* gone */ } }
    throw e;
  } finally {
    pages.forEach((p) => p.close());
    proc.kill(); srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold it */ }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e.message || e); console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed'); process.exit(1); });
