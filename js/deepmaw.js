/* Astro Outpost — the deepmaw (made up, Sahrun only).
   A colossal worm that hunts under Sahrun's open sand, inspired by the giant desert worms of science fiction but
   its own design: a ringed, ridged body eleven metres thick and about a hundred metres long, and a round mouth lined
   with rings of hooked teeth, like a real lamprey's.
   Stay out on the open sand too long and it comes for you:
     1. the ground shakes harder and harder, and a ring of sand starts to swirl and sink where you stand
        (with the Sandquake Sensor set up you get the warning sooner, by radio)
     2. it bursts straight up out of that ring, rears high into the air, and arcs over
     3. it dives back into the sand forty or fifty metres away, and is gone
   Inside the ring when it bursts out, and it swallows you. It does not like the taste of a spacesuit: it spits you
   out, and you wake up at the airlock without what you were carrying, short of air and time (js/game.js does that).
   It cannot burrow through hard ground: rocks, the buildings and the rover are safe. So is the habitat.
   Real science used here (the cards in js/data.js, JA.MECHS 'worm' and 'shakealert'): strong shaking is often led
   by smaller, faster waves, and earthquake warning systems such as USGS ShakeAlert use them to warn people seconds
   ahead. The animal itself is made up, and its card says so.
   Only a planet whose JA.SITES entry has worm: true has one. The host's game decides when it comes and keeps it in
   s.worm, so in crew mode every player sees the same worm. No storage, no network. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain;
  var Y = JA.worm = {};
  if (!T) return;

  var DAYS = { 5: [3], 8: [3, 6], 10: [3, 6, 8] };       // the days it hunts (a day you stay safe carries the hunt over)
  var OPEN = 4;                    // seconds on open sand before it comes for you
  var WARN = 5, WARN_SENSOR = 7.5; // seconds of shaking before it bursts out (the Sandquake Sensor hears it sooner)
  var HOME = 0.4;                  // for this share of the warning it still steers towards you, then it is committed
  var CATCH = 6.5;                 // metres: inside this ring when it bursts out, you are swallowed
  var SPIT = 3.4;                  // seconds inside it before it spits you out
  var SPEED = 30;                  // MADE UP: metres per second along its path
  var SEGS = 34, SEG = 3.0, R0 = 5.4;      // MADE UP: body rings, metres between them, radius at the head (11 m thick, 100 m long)
  var mesh = null, meshRoot = null, path = null, fx = { id: -1 }, veil = null, rumbling = false, openT = 0;
  var m4 = new T.Matrix4(), q = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), sc = new T.Vector3(), HIDE = new T.Matrix4().makeScale(0, 0, 0);
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function has(s) { return !!(s && s.site && s.site.worm); }

  function plan(s) {
    var out = {};
    (DAYS[s.totalSols] || [3]).forEach(function (d) { if (d < s.totalSols) out[d] = true; });
    s.worm = { days: out, done: {}, ev: null, seq: 0, escaped: 0, eaten: 0, last: 0 };
  }
  function armed(r, sol) { for (var d in r.days) if (+d <= sol && !r.done[d]) return +d; return 0; }

  // Open sand: away from the outpost, from every building and boulder, from the butte and the edge of the map.
  function openSand(x, z) {
    var rr = Math.hypot(x, z), C = (JA.base && JA.base.colliders) || [], M = Tn.L.mesa, i;
    if (rr < 48 || rr > Tn.PLAY_R - 15) return false;
    if (M && Math.hypot(x - M[0], z - M[1]) < 30) return false;
    for (i = 0; i < C.length; i++) if (Math.hypot(x - C[i].x, z - C[i].z) - C[i].r < 10) return false;
    return true;
  }

  // ---------- the hunt ----------
  function begin(s, ctx, day) {
    var r = s.worm, p = ctx.pos, best = null, k;
    // where it dives back in: 36 to 52 m away, on open sand, never towards the outpost
    for (k = 0; k < 16 && !best; k++) {
      var a = Math.random() * Math.PI * 2, d = 36 + Math.random() * 16, bx = p.x + Math.cos(a) * d, bz = p.z + Math.sin(a) * d;
      if (Math.hypot(bx, bz) > Math.hypot(p.x, p.z) - 5 && openSand(bx, bz)) best = { dx: Math.cos(a), dz: Math.sin(a), dist: d };
    }
    if (!best) { var aw = Math.atan2(p.z, p.x); best = { dx: Math.cos(aw), dz: Math.sin(aw), dist: 40 }; }
    r.done[day] = true; r.last = s.sol;
    r.ev = { id: ++r.seq, sol: s.sol, t0: s.t, warn: s.inst && s.inst.seismo ? WARN_SENSOR : WARN, tx: p.x, tz: p.z,
      dx: best.dx, dz: best.dz, dist: best.dist, high: 24 + Math.random() * 8, out: false, over: false };
    if (ctx.say) {
      ctx.say(s.inst && s.inst.seismo ? sensorName(s) + ': huge tremors right under you, and they are getting stronger! Get off the open sand: run for rocks, a building or the rover!'
        : 'The ground is shaking! Something HUGE is coming up under you. Run for the rocks or the rover!');
    }
  }
  function sensorName(s) {
    var list = (JA.INSTRUMENTS && JA.pick(s, JA.INSTRUMENTS)) || [], i;
    for (i = 0; i < list.length; i++) if (list[i].id === 'seismo') return list[i].name;
    return 'Quake sensor';
  }

  // Its path through the air: up out of the ring, over the top, down into the sand at the dive point.
  // The same numbers give the same path in every player's game.
  function pathOf(ev) {
    if (path && path.id === ev.id) return path;
    var y0 = Tn.height(ev.tx, ev.tz), bx = ev.tx + ev.dx * ev.dist, bz = ev.tz + ev.dz * ev.dist, y1 = Tn.height(bx, bz);
    var mx = (ev.tx + bx) / 2, mz = (ev.tz + bz) / 2, top = Math.max(y0, y1) + ev.high;
    var pts = [[ev.tx - ev.dx * 6, y0 - 40, ev.tz - ev.dz * 6], [ev.tx, y0 - 7, ev.tz], [ev.tx + ev.dx * 5, y0 + 17, ev.tz + ev.dz * 5],
      [mx, top, mz], [bx - ev.dx * 5, y1 + 15, bz - ev.dz * 5], [bx, y1 - 7, bz], [bx + ev.dx * 8, y1 - 40, bz + ev.dz * 8]]
      .map(function (a) { return new T.Vector3(a[0], a[1], a[2]); });
    var c = new T.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 360;
    var L = c.getLength(), lens = c.getLengths(360);
    path = { id: ev.id, c: c, L: L, s0: lens[60], s1: lens[300], y0: y0, y1: y1, bx: bx, bz: bz };      // s0, s1: where it breaks the surface, and dives
    return path;
  }

  // ---------- the animal ----------
  // the skin: across each ring a fold that is dark at both ends and pale in the middle; along the body fine ridges
  // and scuffs, as if blowing sand had scoured it for a thousand years (u goes round the body, v along one ring)
  function skinTex(rx) {
    var t = W.canvasTex(256, function (ctx, n) {
      var g = ctx.createLinearGradient(0, 0, 0, n), i;
      g.addColorStop(0, '#3e3024'); g.addColorStop(0.18, '#6e5a46'); g.addColorStop(0.5, '#9a8468'); g.addColorStop(0.82, '#6e5a46'); g.addColorStop(1, '#3e3024');
      ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
      for (i = 0; i < 46; i++) {                                  // ridges along the body
        var x = (i * 97) % n, w = 1 + (i % 3);
        ctx.fillStyle = 'rgba(40, 30, 20, ' + (0.18 + (i % 4) * 0.06) + ')'; ctx.fillRect(x, 0, w, n);
        ctx.fillStyle = 'rgba(200, 175, 140, 0.12)'; ctx.fillRect(x + w, 0, 1, n);
      }
      for (i = 0; i < 160; i++) {                                 // scuffs and pits
        ctx.fillStyle = i % 2 ? 'rgba(30, 22, 14, 0.25)' : 'rgba(210, 190, 160, 0.18)';
        ctx.beginPath(); ctx.ellipse((i * 53) % n, (i * 131) % n, 1 + (i % 5), 0.6 + (i % 3) * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 4, 1);
    return t;
  }
  function buildMesh() {
    var g = new T.Group(), skin = new T.MeshStandardMaterial({ map: skinTex(4), roughness: 0.9, metalness: 0.02 });
    // one ring of the body: a barrel a little longer than the gap between rings, so they overlap like folds
    var prof = [[0.86, -1.95], [0.96, -1.45], [1.0, -0.6], [1.0, 0.6], [0.98, 1.3], [0.9, 1.95]].map(function (a) { return new T.Vector2(a[0], a[1] * SEG / 3.0); });
    var body = new T.InstancedMesh(new T.LatheGeometry(prof, 26), skin, SEGS);
    body.castShadow = true; body.frustumCulled = false; g.add(body);
    // the head: a flared collar, a thick lip, and a throat that glows dull red far down
    var head = new T.Group(); g.add(head);
    var collar = new T.Mesh(new T.CylinderGeometry(R0 * 1.36, R0 * 1.0, 4.2, 32, 1, true), new T.MeshStandardMaterial({ map: skinTex(6), roughness: 0.85, side: T.DoubleSide }));
    collar.castShadow = true; head.add(collar);
    var lip = new T.Mesh(new T.TorusGeometry(R0 * 1.34, 0.75, 12, 36), new T.MeshStandardMaterial({ color: 0x4a2e22, roughness: 0.55 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 2.1; head.add(lip);
    // the throat: a long, dark tunnel, black near the teeth and glowing red-orange only far down
    var glowTex = W.canvasTex(64, function (ctx, n) {
      var gr = ctx.createLinearGradient(0, 0, 0, n);              // top of the picture = the mouth end of the tunnel
      gr.addColorStop(0, '#000000'); gr.addColorStop(0.45, '#1a0200'); gr.addColorStop(0.8, '#7a1404'); gr.addColorStop(1, '#ff6a1a');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, n, n);
      for (var i = 0; i < 10; i++) { ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; ctx.fillRect(i * n / 10, 0, 2, n); }      // folds down the throat
    });
    var throat = new T.Mesh(new T.CylinderGeometry(R0 * 1.12, 0.5, 11, 30, 1, true), new T.MeshStandardMaterial({ color: 0x1a0604, emissive: 0xffffff, emissiveMap: glowTex, emissiveIntensity: 1.2, roughness: 0.5, side: T.DoubleSide }));
    throat.position.y = -3.4; head.add(throat);
    // the teeth: three rings of hooked teeth, the outer ones biggest, all pointing in and down the throat (a lamprey's mouth)
    var rings = [[R0 * 1.22, 28, 1.8, 1.9], [R0 * 0.94, 22, 1.4, 1.1], [R0 * 0.66, 16, 1.05, 0.35]], n = 0, i, k;
    rings.forEach(function (rg) { n += rg[1]; });
    var teeth = new T.InstancedMesh(new T.ConeGeometry(0.3, 1, 7), new T.MeshStandardMaterial({ color: 0xeee0c2, roughness: 0.35, emissive: 0x3a2a18, emissiveIntensity: 0.25 }), n);
    var e = new T.Euler(), p = new T.Vector3(), dir = new T.Vector3(); n = 0;
    rings.forEach(function (rg) {
      for (k = 0; k < rg[1]; k++) {
        var a = k / rg[1] * Math.PI * 2 + rg[0];
        p.set(Math.cos(a) * rg[0], rg[3], Math.sin(a) * rg[0]);
        dir.set(-Math.cos(a) * 0.85, -0.45, -Math.sin(a) * 0.85).normalize();      // in towards the middle, and down the throat
        q.setFromUnitVectors(UP, dir);
        m4.compose(p.clone().add(dir.clone().multiplyScalar(rg[2] * 0.5)), q, sc.set(1, rg[2], 1));
        teeth.setMatrixAt(n++, m4);
      }
    });
    head.add(teeth);
    // a warning on the ground: a ring of darker sand that swirls and sinks where it will come up
    var ring = new T.Mesh(new T.RingGeometry(CATCH - 1.6, CATCH + 0.8, 48), new T.MeshBasicMaterial({ color: 0x4a301a, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; g.add(ring);
    var pit = new T.Mesh(new T.CircleGeometry(CATCH - 1.6, 40), new T.MeshBasicMaterial({ color: 0x2e1c0e, transparent: true, opacity: 0, depthWrite: false }));
    pit.rotation.x = -Math.PI / 2; g.add(pit);
    W.root.add(g);
    mesh = { group: g, body: body, head: head, ring: ring, pit: pit };
    meshRoot = W.root;
  }
  function dropMesh() { if (mesh && mesh.group.parent) mesh.group.parent.remove(mesh.group); mesh = null; }

  // the inside of the worm: dark red, then black, with words on top
  function showVeil(on, text) {
    if (!veil) {
      veil = document.createElement('div'); veil.id = 'worm-veil';
      veil.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0;transition:opacity 0.5s;display:flex;align-items:center;justify-content:center;' +
        'background:radial-gradient(circle at 50% 45%, rgba(110, 18, 8, 0.85), rgba(20, 2, 0, 0.97) 55%, #000 80%);font:700 clamp(28px, 6vw, 64px) "Fredoka", sans-serif;color:#ffd9c2;text-align:center;text-shadow:0 2px 12px #000;';
      document.body.appendChild(veil);
    }
    if (text != null) veil.textContent = text;
    veil.style.opacity = on ? '1' : '0';
  }

  // ---------- each frame ----------
  // ctx: { outside (on foot, out on the surface), driving, pos, host, busy, astro, say(text), tip(id, text),
  //        gulp() (it has you: hide the astronaut, drop the cargo), spit() (wake up at the airlock) }
  Y.update = function (dt, s, ctx) {
    if (!has(s) || !W.root) { if (mesh) dropMesh(); stopSound(); return; }
    if (!s.worm) { if (!ctx.host) return; plan(s); }
    var r = s.worm, ev = r.ev, me = ctx.pos || { x: 0, z: 0 };
    // the host: on a hunting day, a player who lingers on open sand on foot gets hunted
    if (!ev && ctx.host) {
      var day = armed(r, s.sol), ph = JA.sim.stormPhase(s);
      var exposed = ctx.outside && !ctx.driving && ctx.astro && ctx.astro.mode === 'walk' && openSand(me.x, me.z);
      openT = exposed && day && r.last !== s.sol && !ctx.busy && s.t > s.dayLength * 0.2 && s.t < s.dayLength * 0.88 && ph !== 'warning' && ph !== 'active' ? openT + dt : 0;
      if (openT > OPEN) { openT = 0; begin(s, ctx, day); ev = r.ev; }
    }
    if (!ev || ev.sol !== s.sol) { if (ev && ctx.host) r.ev = null; if (mesh) dropMesh(); stopSound(); showVeil(false); return; }
    if (fx.id !== ev.id) fx = { id: ev.id, out: false, dive: false, gulped: false, spat: false, judged: false };
    if (!mesh || meshRoot !== W.root) buildMesh();
    var tw = s.t - ev.t0, t = W.time, P = pathOf(ev), near;

    // 1. the warning: it steers towards you for a moment, then the ground swirls and sinks where it will come up
    if (tw < ev.warn) {
      if (ctx.host && tw < ev.warn * HOME && ctx.outside) { ev.tx += (me.x - ev.tx) * Math.min(1, dt * 2.2); ev.tz += (me.z - ev.tz) * Math.min(1, dt * 2.2); path = null; }
      var k = tw / ev.warn, gy = Tn.height(ev.tx, ev.tz) + 0.12;
      mesh.body.visible = false; mesh.head.visible = false;
      mesh.ring.visible = mesh.pit.visible = true;
      mesh.ring.position.set(ev.tx, gy + 0.03, ev.tz); mesh.pit.position.set(ev.tx, gy, ev.tz);
      mesh.ring.rotation.z = t * (0.6 + k * 2.5);
      mesh.ring.material.opacity = clamp(k * 1.8, 0, 0.75); mesh.pit.material.opacity = clamp((k - 0.25) * 1.3, 0, 0.7);
      var nPart = W.rate(0.6 + 1.4 * k, dt), col = s.site.colors.soil;      // W.rate counts per frame
      for (var i = 0; i < nPart; i++) {                           // grains of sand running round and round, low over the ground, sinking towards the middle
        var a = Math.random() * Math.PI * 2, rr = CATCH * (0.6 + Math.random() * 0.5), x = ev.tx + Math.cos(a) * rr, z = ev.tz + Math.sin(a) * rr;
        W.emit(x, Tn.height(x, z) + 0.15, z, { vx: -Math.sin(a) * 6 - Math.cos(a) * 1.8, vy: 0.3 + k * 1.2, vz: Math.cos(a) * 6 - Math.sin(a) * 1.8, life: 0.7, size: 0.3 + k * 0.25, grow: 1.1, color: col, alpha: 0.5, grav: W.gravity * 0.6 });
      }
      near = clamp(1 - Math.hypot(me.x - ev.tx, me.z - ev.tz) / 140, 0, 1);
      W.cam.shake = Math.max(W.cam.shake || 0, (0.08 + 0.6 * k * k) * near * (ctx.outside ? 1 : 0.5));
      sound(0.04 + 0.16 * k * near, 30 + 25 * k);
      return;
    }

    // 2. out of the sand, over the top and back in
    mesh.ring.visible = mesh.pit.visible = false;
    var sh = P.s0 + (tw - ev.warn) * SPEED;
    if (sh - SEGS * SEG > P.L) {                                  // the tail is back under the sand: it is gone
      if (ctx.host) { ev.over = true; r.ev = null; }
      dropMesh(); stopSound(); return;
    }
    if (!fx.out) {
      fx.out = true; ev.out = true;
      W.burst(ev.tx, P.y0 + 1, ev.tz, 170, 16, s.site.colors.dust, { life: 3.2, size: 3, grow: 3, alpha: 0.75, up: 1, lift: 14, grav: W.gravity * 0.6 });
      W.burst(ev.tx, P.y0 + 0.5, ev.tz, 60, 26, s.site.colors.soil, { life: 2.2, size: 1.2, grow: 1.5, alpha: 0.85, up: 0.6, lift: 6, grav: W.gravity });
      if (JA.audio) { JA.audio.play('launch'); JA.audio.play('touchdown'); }
      if (JA.fx && JA.fx.pulse && ctx.outside) JA.fx.pulse('shock', 1);
      // were you still inside the ring?
      var caught = ctx.outside && !ctx.driving && ctx.astro && (ctx.astro.mode === 'walk' || ctx.astro.mode === 'busy') && Math.hypot(me.x - ev.tx, me.z - ev.tz) < CATCH;
      if (caught) { fx.gulped = true; showVeil(true, 'GULP!'); if (ctx.gulp) ctx.gulp(); if (ctx.host) r.eaten++; }
      else if (ctx.host) {
        var d = Math.hypot(me.x - ev.tx, me.z - ev.tz);
        if (ctx.outside && d < 60) { r.escaped++; if (ctx.say) ctx.say('That was close! A deepmaw, a giant sand worm! It cannot burrow through rock, so rocks, buildings and the rover are safe places.'); }
        if (d < 140 && JA.sim && JA.sim.note) { JA.sim.note(s, 'worm'); JA.sim.note(s, 'shakealert'); }
      }
    }
    if (fx.gulped && !fx.spat && tw > ev.warn + SPIT) {
      fx.spat = true; showVeil(false);
      if (ctx.spit) ctx.spit();
      if (ctx.host && JA.sim && JA.sim.note) { JA.sim.note(s, 'worm'); JA.sim.note(s, 'shakealert'); }
    }
    if (!fx.dive && sh > P.s1 - 6) {
      fx.dive = true;
      W.burst(P.bx, P.y1 + 1, P.bz, 140, 14, s.site.colors.dust, { life: 3, size: 2.6, grow: 3, alpha: 0.7, up: 1, lift: 10, grav: W.gravity * 0.6 });
      if (JA.audio) JA.audio.play('thud');
    }
    // fountains of sand where the body comes out of the ground, and where it goes back in
    var tail = sh - SEGS * SEG, cd = s.site.colors.dust;
    function fountain(x, y, z, rate) {
      var nn = W.rate(rate, dt);
      for (var u = 0; u < nn; u++) {
        var aa = Math.random() * Math.PI * 2, rr = R0 * (0.95 + Math.random() * 0.4), sp = 2 + Math.random() * 4;
        W.emit(x + Math.cos(aa) * rr, y + 0.3, z + Math.sin(aa) * rr, { vx: Math.cos(aa) * sp, vy: 9 + Math.random() * 12, vz: Math.sin(aa) * sp, life: 2, size: 0.9 + Math.random() * 0.7, grow: 1.6, color: cd, alpha: 0.75, grav: W.gravity }); 
      }
    }
    if (sh > P.s0 && tail < P.s0 + 4) fountain(ev.tx, P.y0, ev.tz, 4);
    if (sh > P.s1 - 6 && tail < P.s1) fountain(P.bx, P.y1, P.bz, 4);
    // the body: every ring follows the head along the same path
    var pos = new T.Vector3(), tan = new T.Vector3(), above = [];
    mesh.body.visible = true;
    for (var j = 0; j < SEGS; j++) {
      var sj = sh - 1.4 - j * SEG;
      if (sj < 0 || sj > P.L) { mesh.body.setMatrixAt(j, HIDE); continue; }
      P.c.getPointAt(sj / P.L, pos); P.c.getTangentAt(sj / P.L, tan);
      var rad = R0 * (1 - 0.35 * j / SEGS);
      q.setFromUnitVectors(UP, tan);
      m4.compose(pos, q, sc.set(rad, 1, rad));
      mesh.body.setMatrixAt(j, m4);
      if (pos.y > Tn.height(pos.x, pos.z) + rad) above.push([pos.x, pos.y, pos.z, rad]);
    }
    mesh.body.instanceMatrix.needsUpdate = true;
    // the head, mouth first
    var shd = Math.min(sh, P.L);
    P.c.getPointAt(shd / P.L, pos); P.c.getTangentAt(shd / P.L, tan);
    mesh.head.visible = sh < P.L + 4;
    mesh.head.position.copy(pos); mesh.head.quaternion.setFromUnitVectors(UP, tan);
    var open = 0.9 + 0.1 * Math.sin(t * 7);                       // the mouth flexes
    mesh.head.scale.set(open, 1, open);
    // sand pouring off it while it is up in the air
    if (above.length) {
      var nf = W.rate(1.5, dt), cs = s.site.colors.dust;
      for (var f = 0; f < nf; f++) {
        var b = above[Math.floor(Math.random() * above.length)], aa = Math.random() * Math.PI * 2;
        W.emit(b[0] + Math.cos(aa) * b[3] * 0.8, b[1] - b[3] * 0.3, b[2] + Math.sin(aa) * b[3] * 0.8, { vx: (Math.random() - 0.5) * 2, vy: -1, vz: (Math.random() - 0.5) * 2, life: 1.8, size: 1.1, grow: 1.4, color: cs, alpha: 0.6, grav: W.gravity });
      }
    }
    near = clamp(1 - Math.hypot(me.x - pos.x, me.z - pos.z) / 160, 0, 1);
    W.cam.shake = Math.max(W.cam.shake || 0, (tw - ev.warn < 1.2 ? 1.1 : 0.45) * near * (ctx.outside ? 1 : 0.4));
    sound(tw - ev.warn < 2.5 ? 0.2 * near + 0.04 : 0.06 * near, 34);
  };
  function sound(v, f) { if (!JA.audio) return; rumbling = true; JA.audio.loop('worm', { f: f, v: v, type: 'sawtooth' }); }
  function stopSound() { if (rumbling && JA.audio) JA.audio.stopLoop('worm', 0.6); rumbling = false; }

  // Where it is coming up, for the waypoint marker: during the warning, so you know where to run from.
  Y.marker = function (s, pos, out) {
    var ev = has(s) && s.worm && s.worm.ev; if (!ev || ev.sol !== s.sol || s.t - ev.t0 >= ev.warn) return null;
    return out.set(ev.tx, Tn.height(ev.tx, ev.tz) + 3, ev.tz);
  };
  Y.active = function (s) { return !!(has(s) && s.worm && s.worm.ev && s.worm.ev.sol === s.sol); };
  Y.openSand = openSand;
  Y.CATCH = CATCH;
})(window.JA);
