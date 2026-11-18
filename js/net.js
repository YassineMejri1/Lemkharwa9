/* Astro Outpost — the network under crew mode (js/crew.js): up to four players, one of them hosts.
   The players talk straight to each other (WebRTC data channels). The free PeerJS broker only introduces them,
   so nothing needs a server of our own and nothing costs money. With ?net=local in the address, tabs of one
   browser talk through a BroadcastChannel instead, which is how the tests run four players on one computer.

   Every guest keeps two channels to the host: "r" (reliable and ordered: mission state, actions, events) and
   "f" (fast, unordered: where everyone is, many times a second). Messages are JSON; big ones are cut into
   pieces and put back together on the other side. */
(function (JA) {
  'use strict';
  var N = JA.net = { mode: null, role: null, code: null, cid: null, peers: {}, on: {}, rtt: 0 };
  var PREFIX = 'astro-outpost-crew-';
  var PEERJS = ['https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'];
  var ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';         // no I and O: a code read out loud must not be mistaken
  var CHUNK = 15000, MAX_GUESTS = 3, LOST_AFTER = 20000;
  var peer = null, bc = null, hostLink = null, pingTimer = null, chunks = {}, seq = 0;

  N.localMode = function () { return /[?&]net=local\b/.test(location.search) || !window.RTCPeerConnection; };
  N.newCode = function () { var c = ''; for (var i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return c; };
  N.cleanCode = function (c) { return String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); };
  function now() { return performance.now(); }
  function emit(name) { var fn = N.on[name]; if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1)); }

  // ---------- PeerJS, loaded only when somebody opens crew mode ----------
  var loading = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (ok, fail) {
      var i = 0;
      (function next() {
        if (i >= PEERJS.length) { loading = null; fail(new Error('load')); return; }
        var s = document.createElement('script'); s.src = PEERJS[i++]; s.async = true;
        s.onload = function () { if (window.Peer) ok(); else next(); };
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
    return loading;
  }

  // ---------- one link to one other player (two channels) ----------
  // link: { pid, cid, r, f, open, last, rtt, name }
  function sendRaw(link, msg, fast) {
    var str = JSON.stringify(msg);
    if (link.local) { bc.postMessage({ to: link.cid, from: N.cid, d: str }); return; }
    var ch = fast && link.f && link.f.open ? link.f : link.r;
    if (!ch || !ch.open) return;
    if (str.length <= CHUNK) { try { ch.send(str); } catch (e) { /* closing */ } return; }
    // too big for one message on every browser: send it in pieces over the reliable channel, in order
    var id = ++seq, n = Math.ceil(str.length / CHUNK);
    for (var k = 0; k < n; k++) { try { link.r.send(JSON.stringify({ t: '_part', id: id, k: k, n: n, d: str.slice(k * CHUNK, (k + 1) * CHUNK) })); } catch (e) { return; } }
  }
  function received(link, str) {
    var m; try { m = typeof str === 'string' ? JSON.parse(str) : str; } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    link.last = now();
    if (m.t === '_part') {
      var key = link.cid + ':' + m.id, box = chunks[key] || (chunks[key] = []);
      box[m.k] = m.d;
      for (var k = 0; k < m.n; k++) if (box[k] == null) return;
      delete chunks[key];
      return received(link, box.join(''));
    }
    if (m.t === '_ping') { sendRaw(link, { t: '_pong', ts: m.ts, rtt: link.rtt }, true); return; }
    if (m.t === '_bye') { drop(link, 'left'); return; }                        // they closed the game or left the crew
    if (m.t === '_busy') { link.grace = now() + (m.ms || 30000); return; }      // building a world: silence is not a lost link
    if (m.t === '_pong') { link.rtt = link.rtt ? link.rtt * 0.7 + (now() - m.ts) * 0.3 : now() - m.ts; if (N.role === 'guest') N.rtt = link.rtt; return; }
    if (N.role === 'host') {
      if (m.t === '_hello') return hello(link, m);
      if (link.pid) emit('msg', link.pid, m);
      else if (link.local && !link.told) { link.told = true; sendRaw(link, { t: '_reject', why: 'dropped' }); }      // we had let this player go
    } else {
      if (m.t === '_welcome') { link.pid = 0; N.me = m.pid; emit('joined', m); return; }
      if (m.t === '_reject') { emit('rejected', m.why); N.close(); return; }
      emit('msg', 0, m);
    }
  }
  // Once a second: a ping to each player (for the round trip time), and a check that we still hear from them.
  // When this page itself was frozen (building a world, a hidden tab), the silence is ours: nobody is blamed for it.
  var tickAt = 0;
  function heartbeat() {
    clearInterval(pingTimer);
    tickAt = now();
    pingTimer = setInterval(function () {
      var t = now(), stalled = t - tickAt > 3000;
      tickAt = t;
      Object.keys(N.peers).forEach(function (k) {
        var l = N.peers[k];
        if (stalled) l.last = Math.max(l.last, t);
        sendRaw(l, { t: '_ping', ts: t }, true);
        if (l.pid != null && t - l.last > LOST_AFTER && t > (l.grace || 0)) drop(l, 'lost');
      });
    }, 1000);
  }
  function drop(link, why) {
    if (!N.peers[link.cid]) return;
    delete N.peers[link.cid];
    try { if (link.r) link.r.close(); if (link.f) link.f.close(); } catch (e) { /* already closed */ }
    if (N.role === 'host') { if (link.pid) emit('leave', link.pid, why); }
    else emit('lost', why);
  }

  // ---------- the host ----------
  N.locked = false;        // once the mission starts, nobody new can join
  function freePid() { var used = {}; Object.keys(N.peers).forEach(function (k) { if (N.peers[k].pid) used[N.peers[k].pid] = 1; }); for (var p = 1; p <= MAX_GUESTS; p++) if (!used[p]) return p; return 0; }
  function hello(link, m) {
    if (link.pid) return;
    var pid = N.locked ? 0 : freePid();
    if (!pid || m.v !== N.version) {
      sendRaw(link, { t: '_reject', why: m.v !== N.version ? 'version' : N.locked ? 'started' : 'full' });
      setTimeout(function () { drop(link, 'rejected'); }, 300);
      return;
    }
    link.pid = pid;
    sendRaw(link, { t: '_welcome', pid: pid });
    emit('join', pid, m.hello || {});
  }
  N.version = 3;
  N.host = function (cb) {
    N.close();
    N.role = 'host'; N.me = 0; N.locked = false;
    N.cid = 'host';
    var code = N.newCode();
    if (N.localMode()) {
      N.mode = 'local'; N.code = code;
      bc = new BroadcastChannel('ja-crew-' + code);
      bc.onmessage = function (e) {
        var d = e.data; if (!d || d.to !== N.cid) return;
        var link = N.peers[d.from] || (N.peers[d.from] = { cid: d.from, local: true, last: now(), rtt: 1 });
        received(link, d.d);
      };
      heartbeat();
      setTimeout(function () { cb(null, code); }, 0);
      return;
    }
    N.mode = 'peer';
    loadPeer().then(function () {
      var tries = 0;
      (function open() {
        var p = peer = new window.Peer(PREFIX + code, { debug: 0, config: { iceServers: ICE } });
        p.on('open', function () { N.code = code; heartbeat(); cb(null, code); });
        p.on('error', function (err) {
          if (err && err.type === 'unavailable-id' && tries++ < 4) { p.destroy(); code = N.newCode(); open(); return; }
          if (!N.code) { cb(err && err.type || 'error'); return; }
          emit('trouble', err && err.type);
        });
        p.on('disconnected', function () { if (!p.destroyed) setTimeout(function () { try { p.reconnect(); } catch (e) { /* gone */ } }, 1000); });
        p.on('connection', function (conn) {
          var cid = conn.metadata && conn.metadata.cid; if (!cid) { conn.close(); return; }
          var link = N.peers[cid] || (N.peers[cid] = { cid: cid, last: now(), rtt: 0 });
          if (conn.label === 'f') link.f = conn; else link.r = conn;
          conn.on('data', function (d) { received(link, d); });
          conn.on('open', function () { link.last = now(); });
          conn.on('close', function () { if (conn === link.r) drop(link, 'left'); });
          conn.on('error', function () { if (conn === link.r) drop(link, 'error'); });
        });
      })();
    }, function () { cb('load'); });
  };
  N.kick = function (pid) { Object.keys(N.peers).forEach(function (k) { if (N.peers[k].pid === pid) drop(N.peers[k], 'kicked'); }); };

  // ---------- a guest ----------
  N.join = function (code, hi, cb) {
    N.close();
    N.role = 'guest'; code = N.cleanCode(code); N.code = code;
    N.cid = 'g' + Math.random().toString(36).slice(2, 10);
    var done = false;
    function finish(err) { if (done) return; done = true; clearTimeout(timer); cb(err); }
    var timer = setTimeout(function () { finish('timeout'); N.close(); }, 15000);
    N.on.joined = function () { finish(null); };
    N.on.rejected = function (why) { finish(why || 'rejected'); };
    if (N.localMode()) {
      N.mode = 'local';
      bc = new BroadcastChannel('ja-crew-' + code);
      hostLink = N.peers.host = { cid: 'host', local: true, last: now(), rtt: 1 };
      bc.onmessage = function (e) { var d = e.data; if (d && d.to === N.cid) received(hostLink, d.d); };
      sendRaw(hostLink, { t: '_hello', v: N.version, hello: hi });
      heartbeat();
      return;
    }
    N.mode = 'peer';
    loadPeer().then(function () {
      var p = peer = new window.Peer(undefined, { debug: 0, config: { iceServers: ICE } });
      p.on('error', function (err) {
        var t = err && err.type;
        if (!done) { finish(t === 'peer-unavailable' ? 'nohost' : t || 'error'); N.close(); return; }
        if (t === 'peer-unavailable' || t === 'network') emit('lost', t);
      });
      p.on('open', function () {
        hostLink = N.peers.host = { cid: 'host', last: now(), rtt: 0 };
        var meta = { cid: N.cid };
        var r = hostLink.r = p.connect(PREFIX + code, { label: 'r', reliable: true, serialization: 'raw', metadata: meta });
        r.on('open', function () {
          hostLink.last = now();
          sendRaw(hostLink, { t: '_hello', v: N.version, hello: hi });
          heartbeat();
          var f = p.connect(PREFIX + code, { label: 'f', reliable: false, serialization: 'raw', metadata: meta });
          f.on('open', function () { hostLink.f = f; });
          f.on('data', function (d) { received(hostLink, d); });
        });
        r.on('data', function (d) { received(hostLink, d); });
        r.on('close', function () { drop(hostLink, 'closed'); });
        r.on('error', function () { if (!done) finish('error'); });
      });
    }, function () { finish('load'); });
  };

  // ---------- sending ----------
  // to: a player id (0 = the host). fast: may arrive out of order (positions); everything else arrives in order.
  N.send = function (pid, msg, fast) {
    var k, l;
    for (k in N.peers) { l = N.peers[k]; if (l.pid === pid) { sendRaw(l, msg, fast); return true; } }
    return false;
  };
  N.toHost = function (msg, fast) { if (hostLink) sendRaw(hostLink, msg, fast); };
  N.broadcast = function (msg, fast, except) {
    var str = null;
    Object.keys(N.peers).forEach(function (k) {
      var l = N.peers[k]; if (!l.pid || l.pid === except) return;
      if (!str) str = msg;
      sendRaw(l, str, fast);
    });
  };
  // About to be busy for a while (building a world can hold up a slow computer for seconds): tell the others to wait.
  N.busy = function (ms) { var t = now() + (ms || 30000); Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; l.grace = Math.max(l.grace || 0, t); sendRaw(l, { t: '_busy', ms: ms || 30000 }); }); };
  N.guests = function () { return Object.keys(N.peers).map(function (k) { return N.peers[k]; }).filter(function (l) { return l.pid; }); };
  N.rttOf = function (pid) { var l = N.guests().filter(function (g) { return g.pid === pid; })[0]; return l ? l.rtt : 0; };
  N.close = function () {
    clearInterval(pingTimer); pingTimer = null;
    Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; if (N.role === 'guest' || l.pid) sendRaw(l, { t: '_bye' }); });
    Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; try { if (l.r && l.r.close) l.r.close(); if (l.f && l.f.close) l.f.close(); } catch (e) { /* closed */ } });
    N.peers = {}; hostLink = null; chunks = {};
    if (peer) { try { peer.destroy(); } catch (e) { /* gone */ } peer = null; }
    if (bc) { bc.close(); bc = null; }
    N.role = null; N.code = null; N.mode = null; N.rtt = 0;
  };
  window.addEventListener('beforeunload', function () { if (N.role) N.close(); });
})(window.JA);
