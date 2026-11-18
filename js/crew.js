/* Astro Outpost — crew mode: up to four astronauts in one outpost, each on their own screen.

   One player hosts. The host's game runs the mission exactly as in a game for one: the clock, the air and food,
   the storms, the machines, every thing you can carry, the rover and the town. The other players' games show what
   the host's game says, and send it what their astronaut does.

   - Your own astronaut moves on your own screen, at once, with no waiting for the network. Your game tells the
     others where you are twenty times a second, and their games draw you there, smoothed over a tenth of a second.
   - What you DO (pick up, plug in, plant, start a drill, throw) goes to the host, who does it with your astronaut
     in its world. What comes of it (the thing in your hands, the air going up) comes back to everyone.
   - Whoever drives the rover moves it on their own screen; the others see it follow.
   - The mission state goes from the host to everyone ten times a second, as the parts that changed.
   - The day's big moments (the morning card, the night report, a crisis, the launch) open on every screen; the
     host's choice moves everyone on.

   The network is js/net.js. game.js calls in here at the moments that matter (see the "crew" notes in game.js). */
(function (JA) {
  'use strict';
  var T = window.THREE, N = JA.net, A = JA.actors, W = JA.world, B = JA.base, U = JA.ui, Au = JA.audio, sim = JA.sim;
  var C = JA.crew = { on: false, host: false, guest: false, me: 0, players: {}, ctx: 0, acting: 0, rover: null, flowOpen: false, started: false };
  var SUITS = [0xff7a3d, 0x3d9bff, 0x4cd97b, 0xff5fa8, 0xb07cff], SUIT_NAMES = ['Orange', 'Blue', 'Green', 'Pink', 'Purple'];
  var SEND_EVERY = 0.05, STATE_EVERY = 0.1, DELAY = 110, MAX_EXTRA = 160;
  var $ = U.$, esc = U.esc;
  function G() { return JA.game; }
  function I() { return JA.game._; }
  function now() { return performance.now(); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function hex(c) { return '#' + ('00000' + c.toString(16)).slice(-6); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  var v1 = T ? new T.Vector3() : null;

  // ---------- who is in the crew ----------
  function addPlayer(pid, name, suit) {
    var p = C.players[pid] || (C.players[pid] = { pid: pid, buf: [], off: null, puppet: null, st: null, tag: null, rover: [], rtt: 0 });
    p.name = name; p.suit = suit;
    return p;
  }
  function others() { return Object.keys(C.players).map(Number).filter(function (k) { return k !== C.me; }).map(function (k) { return C.players[k]; }); }
  function list() { return Object.keys(C.players).map(Number).sort().map(function (k) { var p = C.players[k]; return { pid: p.pid, name: p.name, suit: p.suit }; }); }
  C.name = function (pid) { var p = C.players[pid]; return p ? p.name : 'Someone'; };
  C.count = function () { return Object.keys(C.players).length; };
  function cleanName(n) { n = String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 14); return n || 'Astronaut'; }
  function savedName() { try { return localStorage.getItem('ja-crew-name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem('ja-crew-name', n); } catch (e) { /* private window */ } }
  function freeSuit(want) {
    var used = {}; Object.keys(C.players).forEach(function (k) { used[C.players[k].suit] = 1; });
    if (!used[want]) return want;
    for (var i = 0; i < SUITS.length; i++) if (!used[SUITS[i]]) return SUITS[i];
    return want;
  }

  // =====================================================================
  //  THE MENUS: host or join, then the crew room
  // =====================================================================
  var menuCode = '';
  C.openMenu = function (code) {
    if (C.on) { lobby(); return; }
    menuCode = N.cleanCode(code || menuCode);
    var o = G().opts, name = savedName();
    U.show($('title'), false);
    U.modal('<div class="big-icon">🧑‍🚀🧑‍🚀</div><h2>Play with friends</h2>' +
      '<p class="sub">Up to 4 astronauts share one outpost: the same air, the same power cells, the same storms. It is free and there is nothing to install. One of you hosts, the others join with the host\'s crew code.</p>' +
      '<label class="crew-field"><span>Your name</span><input id="crew-name" maxlength="14" autocomplete="nickname" value="' + esc(name) + '" placeholder="Astronaut"></label>' +
      '<h3>Your spacesuit colour</h3><div class="swatches">' +
      SUITS.map(function (c, i) { return '<button class="swatch' + (o.suit === c ? ' sel' : '') + '" style="--c:' + hex(c) + '" data-act="suit" data-v="' + c + '" aria-label="' + SUIT_NAMES[i] + ' spacesuit" aria-pressed="' + (o.suit === c) + '"></button>'; }).join('') + '</div>' +
      '<div class="crew-ways">' +
      '<div class="crew-way"><b>🚀 Host a mission</b><span>You plan the mission and your friends join you.</span><button class="btn primary" data-act="host">Host</button></div>' +
      '<div class="crew-way"><b>🔑 Join a friend</b><span>Type the 5-letter crew code your host sees.</span><div class="crew-join"><input id="crew-code" maxlength="5" autocomplete="off" spellcheck="false" placeholder="CODE" value="' + esc(menuCode) + '"><button class="btn primary" data-act="join">Join</button></div></div>' +
      '</div><p class="crew-status" id="crew-status" role="status"></p>' +
      '<div class="modal-actions"><button class="btn ghost" data-act="back">Back</button></div>',
      { cls: 'crew-menu', noFocus: true, actions: {
        suit: function (el) { o.suit = parseInt(el.getAttribute('data-v'), 10); Au.play('tap'); keepTyped(); C.openMenu(); },
        host: function () { Au.unlock(); Au.play('tap'); startHost(); },
        join: function () { Au.unlock(); Au.play('tap'); startJoin(); },
        back: function () { Au.play('tap'); keepTyped(); U.closeModal(); U.show($('title'), true); }
      } });
    var ci = $('crew-code'), ni = $('crew-name');
    ci.addEventListener('input', function () { ci.value = N.cleanCode(ci.value); });
    ci.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); startJoin(); } });
    ni.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    (menuCode ? ci : ni).focus();
  };
  function keepTyped() { var n = $('crew-name'), c = $('crew-code'); if (n) saveName(cleanName(n.value)); if (c) menuCode = N.cleanCode(c.value); }
  function status(text, bad) { var el = $('crew-status'); if (el) { el.textContent = text; el.classList.toggle('bad', !!bad); } }
  function busy(on) { Array.prototype.forEach.call(document.querySelectorAll('#modal-root .crew-menu button'), function (b) { if (b.getAttribute('data-act') !== 'back') b.disabled = on; }); }
  var WHY = { full: 'That crew is full: four astronauts already.', started: 'That crew has already launched its mission. Ask the host to start a new one.',
    version: 'Your friend has a different version of the game. Both of you, reload the page.', dropped: 'The host lost touch with your game. Join again!', nohost: 'No crew with that code. Check the letters, and that the host is still on the crew screen.',
    timeout: 'The host did not answer. Check the code, or try another network: some school and phone networks block games like this.',
    load: 'Could not reach the free connection service. Check your internet connection.', network: 'No connection to the internet.', error: 'Something went wrong with the connection. Try again.' };

  function startHost() {
    keepTyped();
    var name = cleanName($('crew-name').value); saveName(name);
    busy(true); status('Opening a crew…');
    N.on = {};
    N.host(function (err, code) {
      if (err) { busy(false); status(WHY[err] || WHY.error, true); return; }
      begin(true, 0);
      addPlayer(0, name, G().opts.suit);
      lobby();
    });
  }
  function startJoin() {
    keepTyped();
    var name = cleanName($('crew-name').value), code = N.cleanCode($('crew-code').value);
    saveName(name);
    if (code.length !== 5) { status('A crew code has 5 letters.', true); return; }
    busy(true); status('Calling the host…');
    N.on = { msg: onMessage, lost: lost };
    N.join(code, { name: name, suit: G().opts.suit }, function (err) {
      if (err) { busy(false); status(WHY[err] || WHY.error, true); N.close(); return; }
      begin(false, N.me);
      status('Joined! Waiting for the crew list…');
    });
  }
  function begin(host, me) {
    C.on = true; C.host = host; C.guest = !host; C.me = me; C.players = {}; C.rover = null; C.started = false; C.flowOpen = false;
    document.body.classList.add('crew-on'); document.body.classList.toggle('crew-guest', !host);
    if (host) N.on = { join: onJoin, leave: onLeave, msg: onMessage, trouble: function () { /* the broker may hiccup; the links stay */ } };
    patchFeedback();
    keepAwake(true);
  }
  // A hidden tab gets no animation frames, and its timers slow to one a second. A tiny worker's clock is not slowed
  // like that: thirty times a second it asks the game for a frame whenever the screen has not drawn one lately. So the
  // host can look at a chat window while the outpost keeps running for the crew, and a guest stays in step.
  var ticker = null;
  function keepAwake(on) {
    if (!on) { if (ticker) { ticker.terminate(); ticker = null; } return; }
    if (ticker || !window.Worker || !window.Blob) return;
    try {
      var url = URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 33);'], { type: 'text/javascript' }));
      ticker = new Worker(url);
      // a slow computer gets fewer frames, never a queue of them
      ticker.onmessage = function () { var g = G(), t = performance.now(); if (C.on && g && g.step && t - (g.frameAt || 0) > 120 && t - (g.stepEnd || 0) > 25) g.step(); };
    } catch (e) { ticker = null; }
  }
  C.leave = function (quiet) {
    if (!C.on) return;
    if (C.host) N.broadcast({ t: 'bye' });
    var wasHost = C.host;
    setTimeout(function () { N.close(); }, wasHost ? 150 : 0);
    others().forEach(function (p) { dropPuppet(p); });
    C.on = C.host = C.guest = false; C.players = {}; C.rover = null; C.started = false; C.flowOpen = false; C.pending = null; C.queued = [];
    document.body.classList.remove('crew-on', 'crew-guest');
    unpatchFeedback(); keepAwake(false);
    tags.forEach(function (t) { t.remove(); }); tags = [];
    if (hud) hud.classList.add('hidden');
    if (A.rover) { A.rover.remote = false; A.rover.manned = false; }
    if (!quiet) I().titleScene();
  };

  // The crew room: the code to share, who is here, and (for the host) the way on to planning the mission.
  function lobby() {
    if (!C.on) return;
    var g = G();
    if (g.mode !== 'title' && C.started) return;          // in a mission: the crew list is in the corner of the screen
    U.show($('title'), false);
    var rows = list().map(function (p) {
      var rtt = p.pid === C.me ? '' : C.host ? N.rttOf(p.pid) : p.pid === 0 ? N.rtt : 0;
      return '<li><i style="--c:' + hex(p.suit) + '"></i><b>' + esc(p.name) + '</b>' + (p.pid === 0 ? '<span class="crew-badge">host</span>' : '') +
        (p.pid === C.me ? '<span class="crew-you">you</span>' : rtt ? '<span class="crew-ping">' + Math.round(rtt) + ' ms</span>' : '') + '</li>';
    }).join('');
    var empty = C.count() < 2 ? '<li class="crew-empty">' + (C.host ? 'Nobody else yet. Send your friends the code!' : '') + '</li>' : '';
    var link = location.origin + location.pathname + '?crew=' + N.code + (N.mode === 'local' ? '&net=local' : '');
    var keep = document.querySelector('#modal-root .crew-room');
    U.modal('<h2>' + (C.host ? 'Your crew' : esc(C.name(0)) + '\'s crew') + '</h2>' +
      '<div class="crew-code"><small>Crew code</small><b>' + esc(N.code) + '</b>' + (C.host ? '<button class="btn ghost" data-act="copy">📋 Copy invite link</button>' : '') + '</div>' +
      (C.host ? '<p class="sub">Your friends open this game, pick <b>Play with friends</b> and type the code, or open the invite link. Up to 3 can join.</p>' : '<p class="sub">You are in! The host plans the mission and launches it for everyone.</p>') +
      '<ul class="crew-list">' + rows + empty + '</ul>' +
      (C.host ? '<p class="sub">Everyone shares the outpost: one air supply, one Solar Rack, one rover. Split the jobs and talk to each other!</p>' : '<p class="crew-waiting">⏳ Waiting for ' + esc(C.name(0)) + ' to launch the mission…</p>') +
      '<div class="modal-actions"><button class="btn ghost" data-act="leave">Leave the crew</button>' + (C.host ? '<button class="btn primary" data-act="plan">Plan the mission ▶</button>' : '') + '</div>',
      { cls: 'crew-room', noFocus: !!keep, actions: {
        copy: function () { Au.play('tap'); copy(link); },
        leave: function () { Au.play('tap'); U.closeModal(); C.leave(); },
        plan: function () { Au.play('tap'); U.closeModal(); I().setupModal(); }
      } });
  }
  C.lobby = lobby;
  function copy(text) {
    function done() { status2('Invite link copied! Paste it to your friends.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this link:', text); });
    else prompt('Copy this link:', text);
  }
  function status2(t) { var b = document.querySelector('#modal-root .crew-code'); if (b) { var p = b.querySelector('.crew-note') || b.appendChild(document.createElement('span')); p.className = 'crew-note'; p.textContent = t; } }

  // ---------- the host hears the crew come and go ----------
  function onJoin(pid, hi) {
    var p = addPlayer(pid, cleanName(hi.name), freeSuit(+hi.suit || SUITS[pid % SUITS.length]));
    Au.play('ding');
    sendCrew();
    if (!C.started) lobby();
    else U.toast('👋 ' + p.name + ' joined', W.w / 2, W.h * 0.25, '#7be36a');
  }
  function onLeave(pid, why) {
    var p = C.players[pid]; if (!p) return;
    if (C.started && G().s) {
      // whatever they carried falls where they stood; the rover stops where it is
      if (p.puppet && p.puppet.carrying) A.withAstro(p.puppet, function () { A.setDown(); });
      if (C.rover === pid) setDriver(null);
      U.toast('📡 ' + p.name + (why === 'left' || why === 'closed' ? ' left the outpost' : ' lost the connection'), W.w / 2, W.h * 0.25, '#ffd23f');
    }
    dropPuppet(p);
    delete C.players[pid];
    sendCrew();
    if (!C.started) lobby();
  }
  function sendCrew() { N.broadcast({ t: 'crew', list: list(), code: N.code, started: C.started }); }
  function lost() {
    if (!C.on) return;
    var mid = C.started && G().mode !== 'title';
    C.leave(true);
    I().titleScene();
    U.show($('title'), false);
    U.modal('<div class="big-icon">📡</div><h2>' + (mid ? 'The connection to the host was lost' : 'The crew has closed') + '</h2>' +
      '<p>' + (mid ? 'Your game could no longer hear the host\'s game, so this mission is over for you. You can join again when the host starts a new mission.' : 'The host left the crew.') + '</p>' +
      '<div class="modal-actions"><button class="btn primary" data-act="ok">OK</button></div>',
      { actions: { ok: function () { U.closeModal(); U.show($('title'), true); } } });
  }

  // =====================================================================
  //  MESSAGES
  // =====================================================================
  var own = Object.prototype.hasOwnProperty;
  function onMessage(pid, m) {
    var table = C.host ? HOST : GUEST;
    if (typeof m.t === 'string' && own.call(table, m.t)) table[m.t](pid, m);
  }
  var HOST = {}, GUEST = {};

  // ---------- the guest's side ----------
  GUEST.crew = function (pid, m) {
    var keep = {};
    m.list.forEach(function (p) { keep[p.pid] = 1; addPlayer(p.pid, p.name, p.suit); });
    Object.keys(C.players).forEach(function (k) { if (!keep[k]) { dropPuppet(C.players[k]); delete C.players[k]; } });
    var mine = C.players[C.me]; if (mine) G().opts.suit = mine.suit;
    if (!C.started || G().mode === 'title') lobby();
    else makePuppets();
  };
  GUEST.bye = function () { lost(); };
  GUEST.lobby = function () { C.started = false; I().titleScene(); lobby(); };
  GUEST.start = function (pid, m) {
    N.busy(60000);
    C.started = true; C.pending = null; C.queued = [];
    var g = G();
    g.opts.site = m.opts.site; g.opts.level = m.opts.level; g.opts.sun = m.opts.sun; g.opts.shift = m.opts.shift; g.opts.pioneer = 'off';
    m.list.forEach(function (p) { addPlayer(p.pid, p.name, p.suit); });
    var mine = C.players[C.me]; if (mine) g.opts.suit = mine.suit;
    U.closeModal();
    C.rover = m.rover;
    var s = m.snap.s; s.site = JA.SITES[m.snap.site]; s.level = JA.LEVELS[m.snap.level];
    I().startMission(m.data, { s: s, rigs: m.snap.rigs, tut: m.snap.tut, items: m.items });
    lastState = m.snap;
  };
  GUEST.st = function (pid, m) {
    var g = G(); if (!g.s || !lastState) return;
    var mirror = { s: g.s, rigs: g.rigs, tut: lastState.tut, tutStep: lastState.tutStep };
    m.d.forEach(function (e) { setPath(mirror, e[0], e[1], e.length < 2); });
    lastState.tut = mirror.tut; lastState.tutStep = mirror.tutStep;
    if (mirror.rigs !== g.rigs) g.rigs = mirror.rigs;
    // the crew's tutorial is shared (the first cell in the Air Maker counts for all); walking and jumping are your own,
    // and each screen says the tutorial's lines itself when its step moves on
    var t = g.tut, ht = mirror.tut || {};
    Object.keys(ht).forEach(function (k) { if (k !== 'moved' && k !== 'jumped') t[k] = ht[k]; });
    B.rigs = g.rigs;
  };
  GUEST.items = function (pid, m) { applyItems(m); };
  // D: for each crewmate, how long before this packet the host heard their state (so a relayed state keeps its own time)
  GUEST.w = function (pid, m) {
    var t = now(), off = C.hostOff = offset(C.hostOff, t - m.ts), at = m.ts + off, late = t - at;
    Object.keys(m.P).forEach(function (k) {
      var p = C.players[k]; if (!p || +k === C.me) return;
      push(p.buf, { t: at + ((m.D && m.D[k]) || 0), a: m.P[k] }, late);
    });
    if (m.R && C.rover !== C.me) push(roverBuf, { t: at + (m.RD || 0), r: m.R }, late);
    if (m.I) flyingFromHost(m.I, (late + (N.rtt || 0) / 2) / 1000);      // a flying thing is shown where it is now
  };
  GUEST.ev = function (pid, m) { if (G().s) I().mirrorEvents(m.ev); };
  GUEST.say = function (pid, m) { I().say.apply(null, m.a); };
  GUEST.tip = function (pid, m) { I().tip(m.id, m.text, m.vid, m.topic); };
  GUEST.toast = function (pid, m) { I().toastAt(v1.set(m.p[0], m.p[1], m.p[2]), m.text, m.c); };
  GUEST.snd = function (pid, m) { if (orig.play) orig.play.call(Au, m.n, m.at ? Object.assign({}, m.o || {}, { at: v1.set(m.at[0], m.at[1], m.at[2]).clone() }) : m.o); };
  GUEST.line = function (pid, m) { if (orig.line) orig.line.call(Au, m.id, m.o); };
  GUEST.fx = function (pid, m) { if (orig.burst) orig.burst.apply(W, m.a); };
  GUEST.card = function (pid, m) { I().findCard(m.f); };
  GUEST.deny = function (pid, m) { Au.play('deny'); if (m.msg) I().say(m.msg, true); };
  GUEST.drive = function (pid, m) { driverChanged(m.pid); };
  GUEST.flow = function (pid, m) { flowFromHost(m); };
  GUEST.night = function (pid, m) { I().endDay(m.info || {}); };
  GUEST.report = function (pid, m) { I().showNight(m.r); };
  GUEST.launch = function (pid, m) { G().ending = m.ending; I().startLaunchScene(m.text, m.vid); };
  GUEST.reply = function (pid, m) { I().earthReply(m.m); };
  GUEST.pos = function (pid, m) {                       // the host put you somewhere (morning, the end of a crisis job)
    var a = A.astro; if (!a) return;
    a.pos.set(m.p[0], m.p[1], m.p[2]); a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; if (m.yaw != null) a.yaw = m.yaw;
  };

  // ---------- the host's side ----------
  HOST.p = function (pid, m) {
    var p = C.players[pid]; if (!p) return;
    var t = now(); p.off = offset(p.off, t - m.ts);
    var at = m.ts + p.off;
    if (m.k < (p.k || 0) && p.k - m.k < 1000) return;      // an older one arriving late on the fast channel
    p.k = m.k;
    push(p.buf, { t: at, a: m.a }, t - at);
    p.st = m.a; p.stAt = t; p.stT = at;
    if (m.r && C.rover === pid) { p.rov = m.r; push(roverBuf, { t: at, r: m.r }, t - at); }
  };
  HOST.act = function (pid, m) {
    var p = C.players[pid]; if (!p || !p.puppet || !G().s) return;
    place(p, m.p);
    var ok = C.runAs(pid, function () { return I().doOffer(m.id, m.alt); });
    if (!ok) N.send(pid, { t: 'deny' });
  };
  HOST.drop = function (pid, m) {
    var p = C.players[pid]; if (!p || !p.puppet) return;
    place(p, m.p);
    C.runAs(pid, function () {
      if (!A.astro.carrying) return;
      A.setDown();
      var at = A.astro.pos;          // the one who dropped it heard it already on their own screen
      N.broadcast({ t: 'snd', n: 'drop', at: [r2(at.x), r2(at.y), r2(at.z)] }, false, pid); orig.play.call(Au, 'drop', { at: at.clone() });
    });
  };
  HOST.throw = function (pid, m) {
    var p = C.players[pid]; if (!p || !p.puppet) return;
    place(p, m.p);
    p.puppet.vel.set(m.v[0], 0, m.v[1]);
    C.runAs(pid, function () { var it = A.throwHeld(m.power, { x: m.f[0], z: m.f[1] }); if (it) it.hold = G().clock + 0.12; });
  };
  HOST.sim = function (pid, m) {
    if (!own.call(SIM_OK, m.fn) || !G().s) return;
    C.runAs(pid, function () { sim[m.fn].apply(sim, [G().s].concat(m.args || [])); });
  };
  HOST.op = function (pid, m) {
    var ops = I().ops, p = C.players[pid], fn = own.call(ops, m.fn) ? ops[m.fn] : null; if (!p || !fn || !G().s) return;
    if (m.p) place(p, m.p);
    C.runAs(pid, function () { fn.apply(null, m.args || []); });
  };
  HOST.drive = function (pid, m) {
    var p = C.players[pid]; if (!p) return;
    if (m.on) {
      if (C.rover != null && C.rover !== pid) { N.send(pid, { t: 'deny', msg: C.name(C.rover) + ' is driving the rover.' }); return; }
      setDriver(pid);
    } else if (C.rover === pid) setDriver(null);
  };
  var SIM_OK = { jam: 1, note: 1, repairMiss: 1, repairDone: 1 };

  // put a crewmate's body where their own game says it is, before doing something with it
  function place(p, a) {
    if (!a || !p.puppet) return;
    var b = p.puppet; b.pos.set(a[0], a[1], a[2]); b.yaw = a[3];
  }
  // Do fn with a crewmate's astronaut, as that crewmate (what they hear and see comes back to them).
  C.runAs = function (pid, fn) {
    var p = C.players[pid];
    if (!pid || !p || !p.puppet) { C.acting++; try { return fn(); } finally { C.acting--; } }
    var keep = C.ctx; C.ctx = pid; C.acting++;
    try { return A.withAstro(p.puppet, fn); } finally { C.ctx = keep; C.acting--; }
  };
  // The host's own action: its sounds and sparks in the world reach everyone.
  C.mine = function (fn) { C.acting++; try { return fn(); } finally { C.acting--; } };

  // ---------- the rover ----------
  var roverBuf = [];
  function setDriver(pid) {
    C.rover = pid;
    var r = A.rover;
    r.remote = pid != null && pid !== 0; r.manned = pid != null;
    if (pid !== 0 && r.driver) I().exitRoverLocal(true);
    roverBuf.length = 0;
    N.broadcast({ t: 'drive', pid: pid });
  }
  C.setDriver = setDriver;
  C.canDrive = function () { return C.rover == null || C.rover === C.me; };
  C.askDrive = function (on) { N.toHost({ t: 'drive', on: !!on }); };
  function driverChanged(pid) {
    C.rover = pid;
    var r = A.rover; if (!r) return;
    roverBuf.length = 0;
    if (pid === C.me) { r.remote = false; r.manned = true; if (!r.driver) I().enterRoverLocal(); return; }
    if (r.driver) I().exitRoverLocal(true);
    r.remote = true; r.manned = pid != null;
  }
  function roverPose() { var r = A.rover; return [r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r3(r.yaw), r2(r.speed), r3(r.pitch), r3(r.roll), r2(r.steer || 0)]; }
  function followRover() {
    var r = A.rover; if (!r || !r.remote) return;
    var e = sample(roverBuf, now() - delayOf(roverBuf), 'r'); if (!e) return;
    var a = e.a, b = e.b, k = e.k;
    r.pos.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
    if (e.x > 0) { r.pos.x += Math.sin(b[3]) * b[4] * e.x; r.pos.z += Math.cos(b[3]) * b[4] * e.x; }
    r.yaw = angLerp(a[3], b[3], k); r.speed = lerp(a[4], b[4], k); r.pitch = lerp(a[5], b[5], k); r.roll = lerp(a[6], b[6], k); r.steer = b[7];
  }

  // =====================================================================
  //  MOVEMENT: what you send, and how the others are drawn
  // =====================================================================
  // a state: [x, y, z, yaw, vx, vy, vz, flags, mode, room]   flags: 1 on the ground, 2 moving, 4 running, 8 aiming,
  // 16 throwing, 32 out in the open (for the radiation), 64 carrying
  function myState() {
    var g = G(), a = A.astro, inp = g.input, moving = Math.hypot(inp.x, inp.z) > 0.2 && (g.mode === 'play' || g.mode === 'inside');
    var out = (g.mode === 'play' || g.mode === 'observe') && !g.room;
    var f = (a.onGround ? 1 : 0) | (moving ? 2 : 0) | (inp.puff && moving ? 4 : 0) | (a.aim ? 8 : 0) | (a.throwT > 0 ? 16 : 0) | (out ? 32 : 0) | (a.carrying ? 64 : 0);
    var mode = g.mode === 'night' || g.mode === 'launch' || g.mode === 'end' || g.mode === 'brief' || g.mode === 'intro' ? 'hidden' : a.mode;
    return [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r3(a.yaw), r2(a.vel.x), r2(a.vy), r2(a.vel.z), f, mode, g.room || ''];
  }
  var seq = 0;
  // clock offsets: how much later than the sender's clock a message arrives, at the quickest. It follows a slow drift up.
  function offset(off, sample) { if (off == null || sample < off) return sample; return off + (sample - off) * 0.01; }
  // A buffer of states, in time order. It also learns how far apart they come (gap) and how late they arrive (late),
  // so the drawing waits just long enough to always have the next state in hand (see delayOf). The same state relayed
  // twice by the host is kept once.
  function push(buf, e, late) {
    if (buf.lastT != null && e.t <= buf.lastT + 0.5) { if (buf.length && Math.abs(e.t - buf.lastT) <= 0.5) return; }
    var i = buf.length;
    while (i > 0 && buf[i - 1].t > e.t) i--;
    buf.splice(i, 0, e);
    if (buf.lastT != null && e.t > buf.lastT) { var g = e.t - buf.lastT; if (g < 1000) buf.gap = buf.gap ? buf.gap * 0.9 + g * 0.1 : g; }
    if (late != null && late >= 0 && late < 2000) buf.late = buf.late ? Math.max(late, buf.late * 0.97) : late;      // quick to rise, slow to fall
    if (buf.lastT == null || e.t > buf.lastT) buf.lastT = e.t;
    while (buf.length > 2 && buf[1].t < now() - 2000) buf.shift();
  }
  // how far behind real time to draw from this buffer: one and a half gaps plus the usual lateness, at least DELAY
  function delayOf(buf) { return Math.min(420, Math.max(DELAY, (buf.gap || 50) * 1.5 + (buf.late || 0) + 15)); }
  // The two states around time t, and how far between them (k); x = seconds past the last one (to run ahead a little).
  var SMP = { a: null, b: null, k: 0, x: 0 };
  function sample(buf, t, key) {
    if (!buf.length) return null;
    key = key || 'a';
    var i = buf.length - 1;
    if (t >= buf[i].t) { SMP.a = SMP.b = buf[i][key]; SMP.k = 0; SMP.x = Math.min(MAX_EXTRA, t - buf[i].t) / 1000; return SMP; }
    while (i > 0 && buf[i - 1].t > t) i--;
    if (i === 0) { SMP.a = SMP.b = buf[0][key]; SMP.k = 0; SMP.x = 0; return SMP; }
    var e0 = buf[i - 1], e1 = buf[i];
    SMP.a = e0[key]; SMP.b = e1[key]; SMP.k = (t - e0.t) / Math.max(1, e1.t - e0.t); SMP.x = 0;
    return SMP;
  }
  function makePuppets() {
    if (!A.astro || !G().s) return;
    others().forEach(function (p) {
      if (p.puppet && A.crew.indexOf(p.puppet) >= 0) return;
      p.puppet = A.addCrewmate(p.suit);
      p.puppet.mode = 'hidden';
      var d = B.spots.door; p.puppet.pos.set(d.x, A.groundAt(d.x, d.z + 2.4), d.z + 2.4);
      p.buf.length = 0;
    });
  }
  C.worldBuilt = function () { if (!C.on) return; others().forEach(function (p) { p.puppet = null; }); makePuppets(); };
  function dropPuppet(p) { if (p.puppet) { A.removeCrewmate(p.puppet); p.puppet = null; } if (p.tag) { p.tag.remove(); p.tag = null; } }
  var vT = T ? new T.Vector3() : null;
  function posePuppets(dt) {
    var t = now();
    others().forEach(function (p) {
      var b = p.puppet; if (!b) return;
      var e = sample(p.buf, t - delayOf(p.buf));
      if (!e) { b.mode = 'hidden'; A.poseCrewmate(b, dt, false, false); return; }
      var s0 = e.a, s1 = e.b, k = e.k;
      vT.set(lerp(s0[0], s1[0], k), lerp(s0[1], s1[1], k), lerp(s0[2], s1[2], k));
      b.vel.set(lerp(s0[4], s1[4], k), 0, lerp(s0[6], s1[6], k));
      if (e.x > 0 && s1[8] === 'walk') { vT.x += s1[4] * e.x; vT.z += s1[6] * e.x; if (!(s1[7] & 1)) vT.y += s1[5] * e.x; }
      // a correction is eased in over a few frames instead of a jump; a long way (a new morning) is a jump
      if (!p.shown || b.pos.distanceTo(vT) > 3 || s1[8] !== 'walk') { b.pos.copy(vT); p.shown = true; }
      else b.pos.lerp(vT, 1 - Math.exp(-dt / 0.05));
      b.yaw = angLerp(s0[3], s1[3], k);
      b.vy = lerp(s0[5], s1[5], k);
      var f = s1[7], mode = s1[8], room = s1[9];
      b.onGround = !!(f & 1); b.aim = !!(f & 8);
      if ((f & 16) && b.throwT <= 0) b.throwT = 0.35;
      // in a room you are only seen by those in the same room; out in the open by those out in the open
      var mine = G().room || '';
      b.mode = room !== mine ? 'hidden' : mode;
      b.room = room ? A.room : null;
      if (mode === 'drive' && C.rover !== p.pid) b.mode = 'walk';
      b.solid = b.mode === 'walk' || b.mode === 'busy';
      A.poseCrewmate(b, dt, !!(f & 2), !!(f & 4));
      p.mode = mode; p.room = room; p.out = !!(f & 32); p.run = !!(f & 4) && !!(f & 2);
    });
  }

  // ---------- names over heads, and the crew in the corner ----------
  var tags = [], hud = null;
  function nameTags() {
    var g = G(), show = g.mode === 'play' || g.mode === 'inside';
    others().forEach(function (p) {
      var b = p.puppet;
      if (!p.tag) {
        p.tag = document.createElement('div'); p.tag.className = 'crew-tag';
        p.tag.style.setProperty('--c', hex(p.suit)); p.tag.textContent = p.name;
        document.body.appendChild(p.tag); tags.push(p.tag);
      }
      var vis = show && b && b.group.visible && b.mode !== 'hidden';
      if (vis) {
        v1.set(b.pos.x, b.pos.y + (b.mode === 'drive' ? 2.6 : 2.55), b.pos.z);
        var pr = W.project(v1), d = v1.distanceTo(W.camera.position);
        vis = !pr.hidden && d < 120;
        if (vis) { p.tag.style.transform = 'translate(-50%, -100%) translate(' + Math.round(pr.x) + 'px,' + Math.round(pr.y) + 'px)'; p.tag.style.opacity = d > 60 ? 0.55 : 1; }
      }
      p.tag.style.display = vis ? '' : 'none';
    });
  }
  var hudKey = '';
  function crewHud() {
    var g = G(), show = !!g.s && (g.mode === 'play' || g.mode === 'inside' || g.mode === 'observe');
    if (!hud) { hud = document.createElement('div'); hud.id = 'crew-hud'; hud.setAttribute('aria-label', 'Your crew'); document.body.appendChild(hud); }
    hud.classList.toggle('hidden', !show);
    if (!show) return;
    var storm = sim.stormPhase(g.s) === 'active';
    var rows = list().map(function (q) {
      var p = C.players[q.pid], where;
      if (q.pid === C.me) where = g.room ? 'inside' : A.rover && A.rover.driver ? 'rover' : g.mode === 'observe' ? 'sit' : 'out';
      else where = p.room ? 'inside' : p.mode === 'drive' ? 'rover' : p.mode === 'sit' ? 'sit' : p.mode === 'hidden' ? 'gone' : 'out';
      var ic = { inside: '🏠', rover: '🚙', sit: '🪨', out: storm ? '☢️' : '🧑‍🚀', gone: '…' }[where];
      var rtt = q.pid === C.me ? 0 : C.host ? N.rttOf(q.pid) : q.pid === 0 ? N.rtt : 0;
      return '<li class="' + (where === 'out' && storm ? 'danger' : '') + '"><i style="--c:' + hex(q.suit) + '"></i><b>' + esc(q.name) + '</b><em>' + ic + '</em>' + (rtt > 250 ? '<small>slow link</small>' : '') + '</li>';
    }).join('');
    if (rows !== hudKey) { hudKey = rows; hud.innerHTML = '<ul>' + rows + '</ul>'; }
  }

  // =====================================================================
  //  THINGS: the host says where each one is; the others draw it there
  // =====================================================================
  var lastItems = {};
  function holderPid(it) {
    if (!it.holder) return -1;
    if (it.holder === C.local) return C.me;
    for (var k in C.players) if (C.players[k].puppet === it.holder) return +k;
    return -1;
  }
  function holderBody(pid) { if (pid === C.me) return A.astro; var p = C.players[pid]; return p ? p.puppet : null; }
  function itemKey(it, hp) {
    var k = it.state + '|' + hp + '|' + it.slot + '|' + (it.tag || '');
    if (it.state === 'rest' || it.state === 'fixed') k += '|' + r2(it.pos.x) + ',' + r2(it.pos.y) + ',' + r2(it.pos.z);
    return k;
  }
  function itemsFull() {
    return A.items.map(function (it) {
      return { id: it.id, type: it.type, data: it.data, st: it.state, p: [r2(it.pos.x), r2(it.pos.y), r2(it.pos.z)], v: [r2(it.vel.x), r2(it.vel.y), r2(it.vel.z)], h: holderPid(it), sl: it.slot, tag: it.tag || '' };
    });
  }
  function itemsDiff() {
    var add = [], up = [], del = [], seen = {};
    A.items.forEach(function (it) {
      var hp = holderPid(it), k = itemKey(it, hp);
      seen[it.id] = 1;
      if (lastItems[it.id] == null) {
        add.push({ id: it.id, type: it.type, data: it.data, st: it.state, p: [r2(it.pos.x), r2(it.pos.y), r2(it.pos.z)], v: [r2(it.vel.x), r2(it.vel.y), r2(it.vel.z)], h: hp, sl: it.slot, tag: it.tag || '' });
      } else if (lastItems[it.id] !== k) {
        up.push([it.id, it.state, hp, it.slot, it.tag || '', r2(it.pos.x), r2(it.pos.y), r2(it.pos.z), r2(it.vel.x), r2(it.vel.y), r2(it.vel.z)]);
      }
      lastItems[it.id] = k;
    });
    Object.keys(lastItems).forEach(function (id) { if (!seen[id]) { del.push(+id); delete lastItems[id]; } });
    if (add.length || up.length || del.length) N.broadcast({ t: 'items', add: add, up: up, del: del });
  }
  function setItem(it, st, hp, sl, tag) {
    var rv = A.rover;
    if (it.state === 'bed' && it.slot >= 0 && rv.bed[it.slot] === it) rv.bed[it.slot] = null;
    if (it.holder && it.holder.carrying === it) it.holder.carrying = null;
    it.holder = null;
    it.state = st; it.slot = sl; it.tag = tag || null;
    if (st === 'held') { var h = holderBody(hp); if (h) { if (h.carrying && h.carrying !== it && h.carrying.holder === h) h.carrying.holder = null; it.holder = h; h.carrying = it; } }
    if (st === 'bed' && sl >= 0) rv.bed[sl] = it;
    if (st !== 'fly') it.vel.set(0, 0, 0);
  }
  C.loadItems = function (items) { A.items.slice().forEach(function (it) { A.remove(it); }); applyItems({ add: items, up: [], del: [] }); };
  function applyItems(m) {
    var t = now();
    (m.add || []).forEach(function (r) {
      var it = A.byId(r.id) || A.spawn(r.type, v1.set(r.p[0], r.p[1], r.p[2]), r.data, r.st, r.id);
      it.pos.set(r.p[0], r.p[1], r.p[2]); it.vel.set(r.v[0], r.v[1], r.v[2]);
      setItem(it, r.st, r.h, r.sl, r.tag);
      it.vel.set(r.v[0], r.v[1], r.v[2]);
    });
    (m.up || []).forEach(function (u) {
      var it = A.byId(u[0]); if (!it) return;
      // you just threw or put this down yourself: the host has not heard yet, so do not take it back into your hands
      if (it.predUntil > t && u[1] === 'held' && u[2] === C.me) return;
      setItem(it, u[1], u[2], u[3], u[4]);
      if (u[1] !== 'held' && u[1] !== 'bed') { it.pos.set(u[5], u[6], u[7]); it.vel.set(u[8], u[9], u[10]); }
    });
    (m.del || []).forEach(function (id) { var it = A.byId(id); if (it) A.remove(it); });
  }
  function flyingNow() {
    var out = [];
    A.items.forEach(function (it) { if (it.state === 'fly') out.push([it.id, r2(it.pos.x), r2(it.pos.y), r2(it.pos.z), r2(it.vel.x), r2(it.vel.y), r2(it.vel.z)]); });
    return out.length ? out : null;
  }
  // a guest's own copy of a flying thing falls by itself between the host's reports; each report nudges it back on course
  function flyingFromHost(list2, late) {
    var t = now();
    list2.forEach(function (f) {
      var it = A.byId(f[0]); if (!it || it.state === 'held' || it.state === 'bed' || it.state === 'fixed') return;
      if (it.predUntil > t) return;
      var g = W.gravity || 1.6;
      v1.set(f[1] + f[4] * late, f[2] + f[5] * late - 0.5 * g * late * late, f[3] + f[6] * late);
      if (it.state !== 'fly') { it.state = 'fly'; it.from = null; }
      if (it.pos.distanceTo(v1) > 1.2) it.pos.copy(v1); else it.pos.lerp(v1, 0.3);
      it.vel.set(f[4], f[5] - g * late, f[6]);
    });
  }

  // =====================================================================
  //  THE MISSION STATE: the parts that changed, ten times a second
  // =====================================================================
  var lastState = null;
  function stateNow() {
    var g = G(), s = {}, k;
    for (k in g.s) if (k !== 'site' && k !== 'level' && k !== 'rng') s[k] = g.s[k];
    var o = JSON.parse(JSON.stringify({ s: s, rigs: g.rigs, tut: g.tut, tutStep: g.tutStep }));
    o.site = g.s.site.id; o.level = g.s.level.id;
    return o;
  }
  function diff(a, b, path, out) {
    if (a === b) return;
    var oa = a !== null && typeof a === 'object', ob = b !== null && typeof b === 'object';
    if (!oa || !ob || Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) { out.push([path, b]); return; }
    var k;
    for (k in b) diff(a[k], b[k], path.concat(k), out);
    for (k in a) if (!(k in b)) out.push([path.concat(k)]);
  }
  function setPath(root, path, value, del) {
    var o = root;
    for (var i = 0; i < path.length - 1; i++) {
      if (o[path[i]] === null || typeof o[path[i]] !== 'object') o[path[i]] = /^\d+$/.test(path[i + 1]) ? [] : {};
      o = o[path[i]];
    }
    var last = path[path.length - 1];
    if (path.length === 0) return;
    if (del) delete o[last]; else o[last] = value;
  }
  C.syncNow = function () {
    if (!C.host || !C.started || !G().s) return;
    var cur = stateNow(), d = [];
    if (lastState) diff({ s: lastState.s, rigs: lastState.rigs, tut: lastState.tut, tutStep: lastState.tutStep }, { s: cur.s, rigs: cur.rigs, tut: cur.tut, tutStep: cur.tutStep }, [], d);
    lastState = cur;
    if (d.length) N.broadcast({ t: 'st', d: d });
    itemsDiff();
  };

  // =====================================================================
  //  STARTING A MISSION, AND EVERY FRAME
  // =====================================================================
  // The host's game has just started the mission: send it to the crew. Nobody can join after this.
  C.missionStarted = function (data) {
    if (!C.host) return;
    C.started = true; N.locked = true;
    C.local = A.astro; C.rover = null; A.rover.remote = false; A.rover.manned = false;
    lastItems = {}; lastState = stateNow();
    var items = itemsFull();
    items.forEach(function (r) { var it = A.byId(r.id); lastItems[r.id] = itemKey(it, r.h); });
    N.broadcast({ t: 'start', opts: G().opts, data: data, snap: lastState, items: items, list: list(), rover: null });
    makePuppets();
  };
  // a guest's game has built the same mission from the host's snapshot
  C.guestStarted = function (items) { C.local = A.astro; C.loadItems(items || []); makePuppets(); A.rover.remote = true; A.rover.manned = false; roverBuf.length = 0; };

  var sendT = 0, stateT = 0;
  C.frame = function (dt) {
    if (!C.on) return;
    var g = G();
    if (!g.s || !C.started || !A.astro) { if (hud) hud.classList.add('hidden'); return; }
    C.local = A.astro;
    sendT += dt; stateT += dt;
    if (sendT >= SEND_EVERY) {
      sendT = 0;
      var t = now(), mine = myState();
      if (C.guest) {
        var msg = { t: 'p', k: ++seq, ts: t, a: mine };
        if (A.rover.driver && C.rover === C.me) msg.r = roverPose();
        N.toHost(msg, true);
      } else {
        var P = {}, D = {}; P[0] = mine;
        others().forEach(function (p) { if (p.st && t - p.stAt < 3000) { P[p.pid] = p.st; D[p.pid] = Math.round(p.stT - t); } });
        var dr = C.rover && C.rover !== 0 ? C.players[C.rover] : null;
        N.broadcast({ t: 'w', ts: t, P: P, D: D, R: dr && dr.rov ? dr.rov : roverPose(), RD: dr && dr.rov ? Math.round(dr.stT - t) : 0, I: flyingNow() }, true);
        itemsDiff();
      }
    }
    if (C.host && stateT >= STATE_EVERY) { stateT = 0; C.syncNow(); }
    followRover();
    posePuppets(dt);
  };
  C.afterFrame = function () { if (!C.on || !C.started) return; nameTags(); crewHud(); };

  // How much of the crew is out in the open, and running (the mission rules use these for air and radiation).
  C.crewCtx = function (hostOut, hostRun) {
    var n = 1, out = hostOut ? 1 : 0, run = hostRun ? 1 : 0, t = now();
    others().forEach(function (p) {
      if (!p.st || t - p.stAt > 5000) return;
      n++;
      if (p.st[7] & 32) out++;
      if ((p.st[7] & 4) && (p.st[7] & 32)) run++;
    });
    return { outside: out / n, sprint: run / n, driving: C.rover != null && Math.abs(A.rover.speed) > 0.6 };
  };

  // ---------- a guest asks the host to do things ----------
  function here() { var a = A.astro; return [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r3(a.yaw)]; }
  C.act = function (id, alt) { N.toHost({ t: 'act', id: id, alt: !!alt, p: here() }); };
  C.drop = function () {
    var it = A.astro.carrying; if (!it) return;
    A.setDown(); it.predUntil = now() + 900;
    N.toHost({ t: 'drop', p: here() });
  };
  C.throwHeld = function (power) {
    var a = A.astro, it = a.carrying; if (!it) return null;
    W.forward(v1);
    var f = [r3(v1.x), r3(v1.z)], vel = [r2(a.vel.x), r2(a.vel.z)];
    var thrown = A.throwHeld(power);
    if (thrown) thrown.predUntil = now() + 900;
    N.toHost({ t: 'throw', power: power, f: f, v: vel, p: here() });
    return thrown;
  };
  // a rule change the guest's game also makes on its own copy at once (so the screen answers straight away)
  C.sim = function (fn, args) { N.toHost({ t: 'sim', fn: fn, args: args || [] }); };
  C.op = function (fn, args) { N.toHost({ t: 'op', fn: fn, args: args || [], p: here() }); };

  // ---------- the host tells everyone ----------
  C.events = function (ev) {
    if (!C.host || !ev.length) return;
    C.syncNow();
    N.broadcast({ t: 'ev', ev: JSON.parse(JSON.stringify(ev)) });
  };
  C.send = function (pid, msg) { N.send(pid, msg); };
  C.broadcast = function (msg) { if (C.host) N.broadcast(msg); };
  C.night = function (info) { if (C.host) { C.syncNow(); N.broadcast({ t: 'night', info: info }); } };
  C.report = function (r) { if (C.host) { C.syncNow(); N.broadcast({ t: 'report', r: JSON.parse(JSON.stringify(r)) }); } };
  C.launch = function (text, vid, ending) { if (C.host) { C.syncNow(); N.broadcast({ t: 'launch', text: text || null, vid: vid || null, ending: ending }); } };
  C.toLobby = function () { if (C.host && C.started) { C.started = false; N.locked = false; N.broadcast({ t: 'lobby' }); } };

  // ---------- the big moments: a card that opens on every screen, and the host's choice moves everyone on ----------
  // flow: the names of the card's actions that belong to the host. On a guest's screen those buttons wait.
  C.queued = [];
  C.modal = function (html, opts, flow) {
    opts = opts || {};
    var acts = Object.assign({}, opts.actions || {});
    if (C.host) {
      flow.forEach(function (k) {
        var fn = acts[k]; if (!fn) return;
        acts[k] = function (el) {
          var v = el && el.getAttribute ? el.getAttribute('data-v') : null;
          C.flowOpen = false; C.flowData = null;
          fn(el);
          C.syncNow();
          N.broadcast({ t: 'flow', act: k, v: v, x: C.flowData || null });
          C.flowData = null;
        };
      });
      C.flowOpen = true;
      return U.modal(html, Object.assign({}, opts, { actions: acts }));
    }
    var waiting = {};
    flow.forEach(function (k) { waiting[k] = acts[k]; delete acts[k]; });
    var el = U.modal(html, Object.assign({}, opts, { actions: acts }));
    flow.forEach(function (k) { Array.prototype.forEach.call(el.querySelectorAll('[data-act="' + k + '"]'), function (b) { b.disabled = true; b.classList.add('crew-wait'); }); });
    var wait = document.createElement('p'); wait.className = 'crew-waiting'; wait.innerHTML = '⏳ Waiting for <b>' + esc(C.name(0)) + '</b> (the host) to choose…';
    var bar = el.querySelector('.modal-actions'); if (bar) bar.parentNode.insertBefore(wait, bar); else el.appendChild(wait);
    C.pending = { acts: waiting, el: el };
    var q = C.queued.shift(); if (q) setTimeout(function () { flowFromHost(q); }, 0);
    return el;
  };
  C.flowPaused = function () { return C.host && C.flowOpen && U.modalOpen(); };
  function flowFromHost(m) {
    if (m.act === 'pick' && m.x) { C.pending = null; I().crisisResult(m.x); return; }
    var p = C.pending;
    if (!p || !p.acts[m.act] || !document.body.contains(p.el)) { C.queued.push(m); if (C.queued.length > 4) C.queued.shift(); return; }
    C.pending = null;
    p.acts[m.act]({ getAttribute: function () { return m.v; } });
  }

  // =====================================================================
  //  WHAT YOU HEAR AND SEE WHEN SOMEBODY ELSE DOES SOMETHING
  // =====================================================================
  // While the host does a crewmate's action, what that action says is for the crewmate (sent to them), and the sounds
  // and sparks it makes out in the world are for everyone. The host's own actions share their sounds and sparks too.
  var orig = {};
  function patchFeedback() {
    if (orig.play) return;
    orig.play = Au.play; orig.line = Au.line; orig.burst = W.burst;
    Au.play = function (name, o) {
      if (C.on && C.host && C.acting) {
        var at = o && o.at;
        if (at) { N.broadcast({ t: 'snd', n: name, at: [r2(at.x), r2(at.y), r2(at.z)], o: o.vol ? { vol: o.vol } : null }); return orig.play.call(Au, name, o); }
        if (C.ctx) { N.send(C.ctx, { t: 'snd', n: name, o: o || null }); return; }
      }
      return orig.play.call(Au, name, o);
    };
    Au.line = function (id, o) {
      if (C.on && C.host && C.ctx) { N.send(C.ctx, { t: 'line', id: id, o: o || null }); return false; }
      return orig.line.call(Au, id, o);
    };
    W.burst = function () {
      if (C.on && C.host && C.acting) N.broadcast({ t: 'fx', a: Array.prototype.map.call(arguments, function (x) { return typeof x === 'number' ? r2(x) : x; }) });
      return orig.burst.apply(W, arguments);
    };
  }
  function unpatchFeedback() {
    if (!orig.play) return;
    Au.play = orig.play; Au.line = orig.line; W.burst = orig.burst;
    orig = {};
  }
  // game.js asks: should this message go to a crewmate instead of this screen?
  C.routeSay = function (args) { if (C.on && C.host && C.ctx) { N.send(C.ctx, { t: 'say', a: Array.prototype.slice.call(args) }); return true; } return false; };
  C.routeTip = function (id, text, vid, topic) { if (C.on && C.host && C.ctx) { N.send(C.ctx, { t: 'tip', id: id, text: text, vid: vid, topic: topic }); return true; } return false; };
  C.shareToast = function (pos, text, color) { if (C.on && C.host && C.acting) N.broadcast({ t: 'toast', p: [r2(pos.x), r2(pos.y), r2(pos.z)], text: text, c: color }); };
  C.shareCard = function (f) { if (C.on && C.host && C.acting) N.broadcast({ t: 'card', f: JSON.parse(JSON.stringify(f)) }); };
  C.remote = function () { return C.on && C.host && !!C.ctx; };

  // ---------- the title screen's button, and invite links ----------
  function init() {
    var b = $('btn-crew');
    if (b) b.addEventListener('click', function () { Au.unlock(); Au.play('tap'); C.openMenu(); });
    var m = /[?&]crew=([A-Za-z]{5})/.exec(location.search);
    if (m) setTimeout(function () { if (G() && G().mode === 'title' && !U.modalOpen()) C.openMenu(m[1]); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else window.addEventListener('load', init);
})(window.JA);
