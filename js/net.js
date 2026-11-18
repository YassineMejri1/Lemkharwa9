/* Astro Outpost — the network under crew mode (js/crew.js): up to four players, one of them hosts.

   Two ways to reach each other, both free, with nothing to install and no server of our own:
   - Direct (WebRTC data channels). The free PeerJS service only introduces the players; after that their games
     talk straight to each other. Fastest, and tried first.
   - The relay. Many home routers, phone networks and school networks will not let two computers link directly.
     Then a player's messages go through a public message relay (MQTT over a secure WebSocket: test.mosquitto.org,
     or broker.hivemq.com). They are locked with AES-GCM, with a key made from the crew code, so the relay and
     anyone listening to it see only scrambled bytes. A guest switches to the relay by itself when the direct link
     has not opened after a few seconds.
   With ?net=local in the address, tabs of one browser talk through a BroadcastChannel instead (tests); ?net=relay
   uses the relay only (tests).

   Every guest keeps two direct channels to the host: "r" (reliable and ordered: mission state, actions, events)
   and "f" (fast, unordered: where everyone is, many times a second). Messages are JSON; big ones are cut into
   pieces and put back together on the other side. */
(function (JA) {
  'use strict';
  var N = JA.net = { mode: null, role: null, code: null, cid: null, peers: {}, on: {}, rtt: 0, relayOn: false };
  var PREFIX = 'astro-outpost-crew-';
  var PEERJS = ['https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'];
  var ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  var RELAYS = ['wss://test.mosquitto.org:8081/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';         // no I and O: a code read out loud must not be mistaken
  var CHUNK = 15000, MAX_GUESTS = 3, LOST_AFTER = 20000, DIRECT_WAIT = 6000, JOIN_WAIT = 30000;
  var peer = null, bc = null, hostLink = null, pingTimer = null, chunks = {}, seq = 0;

  N.localMode = function () { return /[?&]net=local\b/.test(location.search); };
  N.directOk = function () { return !!window.RTCPeerConnection && !/[?&]net=relay\b/.test(location.search); };
  N.newCode = function () { var c = ''; for (var i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return c; };
  // a code typed with spaces or lower-case letters, or a whole invite link pasted in, all give the 5 letters
  N.cleanCode = function (c) { c = String(c || ''); var m = /crew=([A-Za-z]{5})/.exec(c); return (m ? m[1] : c).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); };
  function now() { return performance.now(); }
  function emit(name) { var fn = N.on[name]; if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
  function status(text) { emit('status', text); }

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

  // =====================================================================
  //  THE RELAY: a tiny MQTT 3.1.1 client (QoS 0) over a secure WebSocket
  // =====================================================================
  // Topics (made from a hash of the crew code, so the code itself is not in them): <base>/h to the host,
  // <base>/g/<guest> to one guest, <base>/a to every guest at once.
  var R = null;
  var te = window.TextEncoder ? new TextEncoder() : null, td = window.TextDecoder ? new TextDecoder() : null;
  function rlen(n) { var o = []; do { var d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
  function mstr(s) { var b = te.encode(s); return [b.length >> 8, b.length & 255].concat(Array.prototype.slice.call(b)); }
  function packet(type, body) { var h = [type].concat(rlen(body.length)), out = new Uint8Array(h.length + body.length); out.set(h); out.set(body, h.length); return out; }
  function mqConnect() { return packet(0x10, [0, 4, 77, 81, 84, 84, 4, 2, 0, 60].concat(mstr('ja' + Math.random().toString(36).slice(2, 12)))); }
  function mqSubscribe(topics) { var body = [0, 1]; topics.forEach(function (t) { body = body.concat(mstr(t), [0]); }); return packet(0x82, body); }
  function mqPublish(topic, payload) { var t = mstr(topic), body = new Uint8Array(t.length + payload.length); body.set(t); body.set(payload, t.length); return packet(0x30, body); }
  function hex(buf, n) { return Array.prototype.slice.call(new Uint8Array(buf), 0, n).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  N.relayPossible = function () { return !!(window.crypto && crypto.subtle && window.WebSocket && te && td); };

  // subs: the topic ends this player listens to; done(true) once listening, done(false) when no relay can be reached
  function relayStart(code, subs, done) {
    relayStop();
    if (!N.relayPossible()) { done(false); return; }
    var r = R = { subs: subs, q: Promise.resolve(), rq: Promise.resolve(), buf: new Uint8Array(0), ready: false, tries: 0 };
    Promise.all([crypto.subtle.digest('SHA-256', te.encode('astro-outpost crew key ' + code)), crypto.subtle.digest('SHA-256', te.encode('astro-outpost crew topic ' + code))]).then(function (h) {
      return crypto.subtle.importKey('raw', h[0], 'AES-GCM', false, ['encrypt', 'decrypt']).then(function (k) {
        r.key = k; r.base = 'astro-outpost-crew/' + hex(h[1], 12);
        relayConnect(r, RELAYS.slice(), done);
      });
    }).catch(function () { if (R === r) done(false); });
  }
  function relayConnect(r, urls, done) {
    if (R !== r) return;
    if (!urls.length) { done(false); return; }
    var url = urls.shift(), ws, settled = false, to = setTimeout(fail, 7000);
    function fail() { if (settled) return; settled = true; clearTimeout(to); try { ws.close(); } catch (e) { /* closed */ } relayConnect(r, urls, done); }
    try { ws = new WebSocket(url, ['mqtt']); } catch (e) { fail(); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = function () { ws.send(mqConnect()); };
    ws.onerror = function () { if (!settled) fail(); };
    ws.onclose = function () {
      if (!settled) { fail(); return; }
      if (R !== r || r.ws !== ws || r.tries >= 99) return;
      // the relay hung up: dial the same one again (the others must find us on the same relay)
      r.ready = false; clearInterval(r.pingT);
      if (r.tries++ < 5) setTimeout(function () { relayConnect(r, [r.url], function () { /* the links carry on, or time out */ }); }, 1000);
    };
    ws.onmessage = function (e) {
      var b = new Uint8Array(e.data);
      if (!settled) {
        if (R !== r) { settled = true; clearTimeout(to); try { ws.close(); } catch (e2) { /* closed */ } return; }      // closed meanwhile
        if (b[0] !== 0x20 || b[3] !== 0) { fail(); return; }
        settled = true; clearTimeout(to);
        r.ws = ws; r.url = url; r.ready = true; r.buf = new Uint8Array(0);
        ws.send(mqSubscribe(r.subs.map(function (s) { return r.base + s; })));
        r.pingT = setInterval(function () { if (ws.readyState === 1) ws.send(new Uint8Array([0xc0, 0])); }, 20000);
        if (b.length > 4) feed(r, b.subarray(4));
        N.relayOn = true;
        done(true);
        return;
      }
      feed(r, b);
    };
  }
  function relayStop(later) {
    var r = R; R = null; N.relayOn = false; if (!r) return;
    r.tries = 99;                                            // no redialling
    setTimeout(function () { clearInterval(r.pingT); try { if (r.ws) r.ws.close(); } catch (e) { /* closed */ } }, later || 0);
  }
  // bytes from the relay: whole MQTT packets are taken out as they complete
  function feed(r, bytes) {
    var b = new Uint8Array(r.buf.length + bytes.length); b.set(r.buf); b.set(bytes, r.buf.length);
    for (;;) {
      if (b.length < 2) break;
      var len = 0, mul = 1, i = 1, c;
      do { if (i >= b.length) { c = -1; break; } c = b[i++]; len += (c & 127) * mul; mul *= 128; } while (c & 128);
      if (c < 0 || b.length < i + len) break;
      var p = b.subarray(0, i + len), body = p.subarray(i);
      if ((p[0] & 0xf0) === 0x30) {
        var qos = (p[0] >> 1) & 3, tl = (body[0] << 8) | body[1], topic = td.decode(body.subarray(2, 2 + tl)), data = body.slice(2 + tl + (qos ? 2 : 0));
        relayIn(r, topic, data);
      }
      b = b.slice(i + len);
    }
    r.buf = b;
  }
  // unlock in arrival order, then hand over (anything that does not unlock with our key is not for us)
  function relayIn(r, topic, data) {
    if (data.length < 13) return;
    r.rq = r.rq.then(function () { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, r.key, data.subarray(12)); })
      .then(function (pt) { if (R === r) fromRelay(topic.slice(r.base.length), JSON.parse(td.decode(pt))); })
      .catch(function () { /* not ours, or damaged */ });
  }
  function relayOut(end, env) {
    var r = R; if (!r || !r.key) return;
    var data = te.encode(JSON.stringify(env));
    r.q = r.q.then(function () {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, r.key, data).then(function (ct) {
        var b = new Uint8Array(12 + ct.byteLength); b.set(iv); b.set(new Uint8Array(ct), 12);
        if (r.ws && r.ws.readyState === 1) r.ws.send(mqPublish(r.base + end, b));
      });
    }).catch(function () { /* the relay is gone; the heartbeat notices */ });
  }
  function fromRelay(end, env) {
    if (!env || typeof env.d !== 'string') return;
    if (N.role === 'host') {
      if (end !== '/h' || typeof env.f !== 'string' || !/^g[a-z0-9]{4,12}$/.test(env.f)) return;
      var link = N.peers[env.f];
      if (!link) { link = N.peers[env.f] = { cid: env.f, relay: true, last: now(), rtt: 0 }; emit('knock', 'relay'); }
      else if (!link.relay) { link.relay = true; try { if (link.r) link.r.close(); if (link.f) link.f.close(); } catch (e) { /* closed */ } link.r = link.f = null; }
      received(link, env.d);
    } else {
      if (!hostLink || !hostLink.relay) return;
      if (end !== '/a' && end !== '/g/' + N.cid) return;
      if (env.x != null && env.x === N.me) return;
      received(hostLink, env.d);
    }
  }

  // =====================================================================
  //  LINKS: one per other player
  // =====================================================================
  // link: { pid, cid, r, f, relay, local, last, rtt }. The host's link "everyone on the relay" is { relayAll, x }.
  function out(link, s, fast) {
    if (link.local) { bc.postMessage({ to: link.cid, from: N.cid, d: s }); return; }
    if (link.relayAll) { relayOut('/a', { f: 'host', x: link.x, d: s }); return; }
    if (link.relay) { if (N.role === 'host') relayOut('/g/' + link.cid, { f: 'host', d: s }); else relayOut('/h', { f: N.cid, d: s }); return; }
    var ch = fast && link.f && link.f.open ? link.f : link.r;
    if (!ch || !ch.open) return;
    try { ch.send(s); } catch (e) { /* closing */ }
  }
  function sendRaw(link, msg, fast) {
    var str = JSON.stringify(msg);
    if (str.length <= CHUNK) { out(link, str, fast); return; }
    // too big for one message on every browser: send it in pieces, in order, on the reliable path
    var id = ++seq, n = Math.ceil(str.length / CHUNK);
    for (var k = 0; k < n; k++) out(link, JSON.stringify({ t: '_part', id: id, k: k, n: n, d: str.slice(k * CHUNK, (k + 1) * CHUNK) }), false);
  }
  function received(link, str) {
    if (!link || !N.role) return;                    // a late message after leaving the crew
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
      else if ((link.local || link.relay) && !link.told) { link.told = true; sendRaw(link, { t: '_reject', why: 'dropped' }); }      // we had let this player go
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
    if (pingTimer) return;
    tickAt = now();
    pingTimer = setInterval(function () {
      var t = now(), stalled = t - tickAt > 3000;
      tickAt = t;
      Object.keys(N.peers).forEach(function (k) {
        var l = N.peers[k];
        if (stalled) l.last = Math.max(l.last, t);
        if (l.pid == null && !l.relay && !l.local && !(l.r && l.r.open)) return;      // still connecting
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

  // =====================================================================
  //  THE HOST
  // =====================================================================
  function freePid() { var used = {}; Object.keys(N.peers).forEach(function (k) { if (N.peers[k].pid) used[N.peers[k].pid] = 1; }); for (var p = 1; p <= MAX_GUESTS; p++) if (!used[p]) return p; return 0; }
  function hello(link, m) {
    if (link.pid) { sendRaw(link, { t: '_welcome', pid: link.pid }); return; }      // said twice (both ways got through)
    var pid = freePid();                     // players may join at any time, also in the middle of a mission
    if (!pid || m.v !== N.version) {
      sendRaw(link, { t: '_reject', why: m.v !== N.version ? 'version' : 'full' });
      setTimeout(function () { drop(link, 'rejected'); }, 300);
      return;
    }
    link.pid = pid;
    sendRaw(link, { t: '_welcome', pid: pid });
    emit('join', pid, m.hello || {});
  }
  N.version = 5;
  N.host = function (cb) {
    N.close();
    N.role = 'host'; N.me = 0; N.cid = 'host';
    var code = N.newCode(), told = false, relayAsked = false;
    function ready() { if (told) return; told = true; N.code = code; heartbeat(); cb(null, code); }
    function failed(why) { if (told) return; told = true; N.close(); cb(why); }
    if (N.localMode()) {
      N.mode = 'local';
      bc = new BroadcastChannel('ja-crew-' + code);
      bc.onmessage = function (e) {
        var d = e.data; if (!d || d.to !== N.cid) return;
        var link = N.peers[d.from] || (N.peers[d.from] = { cid: d.from, local: true, last: now(), rtt: 1 });
        received(link, d.d);
      };
      setTimeout(ready, 0);
      return;
    }
    // the relay listens too, for guests who cannot reach this computer directly
    function listen(alone) {
      if (relayAsked) return; relayAsked = true;
      relayStart(code, ['/h'], function (ok) { if (alone) { if (ok) { N.mode = 'relay'; ready(); } else failed('load'); } });
    }
    if (!N.directOk()) { listen(true); return; }
    N.mode = 'peer';
    status('Opening a crew…');
    var slow = setTimeout(function () { if (!told) listen(true); }, 9000);      // the PeerJS service did not answer: relay only
    loadPeer().then(function () {
      var tries = 0;
      (function open() {
        if (told && N.mode === 'relay') return;
        var p = peer = new window.Peer(PREFIX + code, { debug: 0, config: { iceServers: ICE } });
        p.on('open', function () { clearTimeout(slow); listen(false); ready(); });
        p.on('error', function (err) {
          var t = err && err.type;
          if (t === 'unavailable-id' && tries++ < 4 && !told && !relayAsked) { p.destroy(); code = N.newCode(); open(); return; }
          if (!told) { clearTimeout(slow); listen(true); return; }
          emit('trouble', t);
        });
        p.on('disconnected', function () { if (!p.destroyed) setTimeout(function () { try { p.reconnect(); } catch (e) { /* gone */ } }, 1000); });
        p.on('connection', function (conn) {
          var cid = conn.metadata && conn.metadata.cid; if (!cid || !/^g[a-z0-9]{4,12}$/.test(cid)) { conn.close(); return; }
          var link = N.peers[cid] || (N.peers[cid] = { cid: cid, last: now(), rtt: 0 });
          if (link.relay) { conn.close(); return; }          // this guest already came in through the relay
          if (conn.label === 'f') link.f = conn; else { link.r = conn; emit('knock', 'direct'); }
          conn.on('data', function (d) { received(link, d); });
          conn.on('open', function () { link.last = now(); });
          conn.on('close', function () { if (conn === link.r && !link.relay) drop(link, 'left'); });
          conn.on('error', function () { if (conn === link.r && !link.relay && link.pid) drop(link, 'error'); });
        });
      })();
    }, function () { clearTimeout(slow); listen(true); });
  };
  N.kick = function (pid) { Object.keys(N.peers).forEach(function (k) { if (N.peers[k].pid === pid) drop(N.peers[k], 'kicked'); }); };

  // =====================================================================
  //  A GUEST
  // =====================================================================
  N.join = function (code, hi, cb) {
    N.close();
    N.role = 'guest'; code = N.cleanCode(code); N.code = code;
    N.cid = 'g' + Math.random().toString(36).slice(2, 10);
    var done = false, viaRelay = false, relayState = 'wait', directGone = false, noHost = false;
    function finish(err) { if (done) return; done = true; clearTimeout(timer); clearTimeout(relayWait); cb(err); }
    var timer = setTimeout(function () { finish(noHost ? 'nohost' : 'timeout'); N.close(); }, JOIN_WAIT), relayWait = null;
    N.on.joined = function () { finish(null); };
    N.on.rejected = function (why) { finish(why || 'rejected'); };
    hostLink = N.peers.host = { cid: 'host', last: now(), rtt: 0 };
    var hi2 = { t: '_hello', v: N.version, hello: hi };
    if (N.localMode()) {
      N.mode = 'local'; hostLink.local = true; hostLink.rtt = 1;
      bc = new BroadcastChannel('ja-crew-' + code);
      bc.onmessage = function (e) { var d = e.data; if (d && d.to === N.cid) received(hostLink, d.d); };
      sendRaw(hostLink, hi2);
      heartbeat();
      return;
    }
    status('Looking for the crew ' + code + '…');
    // the relay gets ready in the background, in case a direct link cannot be made
    relayStart(code, ['/g/' + N.cid, '/a'], function (ok) {
      relayState = ok ? 'ok' : 'no';
      if (ok && directGone) useRelay();
      else if (!ok && directGone) finish(noHost ? 'nohost' : 'blocked');
    });
    function useRelay() {
      if (done || viaRelay || relayState !== 'ok') return;
      viaRelay = true; hostLink.relay = true; N.mode = 'relay';
      try { if (hostLink.r) hostLink.r.close(); } catch (e) { /* closed */ }
      status('A direct link is not possible on this network, so the game goes through the relay. Calling the host…');
      sendRaw(hostLink, hi2);
      heartbeat();
      relayWait = setTimeout(function () { finish(noHost ? 'nohost' : 'timeout'); N.close(); }, 12000);
    }
    function noDirect() {
      if (directGone || done) return;
      directGone = true;
      if (relayState === 'ok') useRelay();
      else if (relayState === 'no') finish(noHost ? 'nohost' : 'blocked');
      else status('Still trying… calling through the relay.');
    }
    setTimeout(noDirect, DIRECT_WAIT);
    if (!N.directOk()) { noDirect(); return; }
    N.mode = 'peer';
    loadPeer().then(function () {
      if (done || viaRelay) return;
      var p = peer = new window.Peer(undefined, { debug: 0, config: { iceServers: ICE } });
      p.on('error', function (err) {
        var t = err && err.type;
        if (!done) { if (t === 'peer-unavailable') noHost = true; noDirect(); return; }
        if (!viaRelay && (t === 'peer-unavailable' || t === 'network')) emit('lost', t);
      });
      p.on('open', function () {
        if (done || viaRelay) return;
        status('Found the crew service. Calling the host…');
        var meta = { cid: N.cid }, link = hostLink;
        var r = link.r = p.connect(PREFIX + code, { label: 'r', reliable: true, serialization: 'raw', metadata: meta });
        r.on('open', function () {
          if (viaRelay) { try { r.close(); } catch (e) { /* closed */ } return; }
          if (hostLink !== link) return;
          link.last = now();
          status('Connected to the host. Saying hello…');
          sendRaw(link, hi2);
          heartbeat();
          var f = p.connect(PREFIX + code, { label: 'f', reliable: false, serialization: 'raw', metadata: meta });
          f.on('open', function () { if (!viaRelay && hostLink === link) link.f = f; });
          f.on('data', function (d) { if (!viaRelay && hostLink === link) received(link, d); });
        });
        r.on('data', function (d) { if (!viaRelay && hostLink === link) received(link, d); });
        r.on('close', function () { if (!viaRelay && done && hostLink === link) drop(link, 'closed'); });
        r.on('error', function () { if (!done) noDirect(); });
      });
    }, function () { noDirect(); });
  };

  // =====================================================================
  //  SENDING
  // =====================================================================
  // to: a player id (0 = the host). fast: may arrive out of order (positions); everything else arrives in order.
  N.send = function (pid, msg, fast) {
    var k, l;
    for (k in N.peers) { l = N.peers[k]; if (l.pid === pid) { sendRaw(l, msg, fast); return true; } }
    return false;
  };
  N.toHost = function (msg, fast) { if (hostLink) sendRaw(hostLink, msg, fast); };
  // to every guest; the ones on the relay get one shared copy
  N.broadcast = function (msg, fast, except) {
    var relays = 0;
    Object.keys(N.peers).forEach(function (k) {
      var l = N.peers[k]; if (!l.pid || l.pid === except) return;
      if (l.relay) { relays++; return; }
      sendRaw(l, msg, fast);
    });
    if (relays) sendRaw({ relayAll: true, cid: '*', x: except == null ? null : except }, msg, fast);
  };
  // About to be busy for a while (building a world can hold up a slow computer for seconds): tell the others to wait.
  N.busy = function (ms) { var t = now() + (ms || 30000); Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; l.grace = Math.max(l.grace || 0, t); sendRaw(l, { t: '_busy', ms: ms || 30000 }); }); };
  N.guests = function () { return Object.keys(N.peers).map(function (k) { return N.peers[k]; }).filter(function (l) { return l.pid; }); };
  N.rttOf = function (pid) { var l = N.guests().filter(function (g) { return g.pid === pid; })[0]; return l ? l.rtt : 0; };
  // how a player is linked: 'direct', 'relay' or 'local' (for a guest's own screen: its link to the host)
  N.linkOf = function (pid) {
    var l = N.role === 'host' ? N.guests().filter(function (g) { return g.pid === pid; })[0] : hostLink;
    return !l ? '' : l.local ? 'local' : l.relay ? 'relay' : 'direct';
  };
  N.close = function () {
    clearInterval(pingTimer); pingTimer = null;
    Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; if (N.role === 'guest' || l.pid) sendRaw(l, { t: '_bye' }); });
    Object.keys(N.peers).forEach(function (k) { var l = N.peers[k]; try { if (l.r && l.r.close) l.r.close(); if (l.f && l.f.close) l.f.close(); } catch (e) { /* closed */ } });
    N.peers = {}; hostLink = null; chunks = {};
    if (peer) { try { peer.destroy(); } catch (e) { /* gone */ } peer = null; }
    if (bc) { bc.close(); bc = null; }
    relayStop(250);                              // the goodbye leaves first
    N.role = null; N.code = null; N.mode = null; N.rtt = 0;
  };
  window.addEventListener('beforeunload', function () { if (N.role) N.close(); });
})(window.JA);
