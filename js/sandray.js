/* Astro Outpost — sand rays (made up, Sahrun only).
   Now and then a sand ray glides past under the dunes: a big, gentle animal invented for this game, that moves
   through loose sand the way a manta ray glides through the sea. You see a hump of sand on the move, its wing tips
   cutting the surface and a spray of sand at its nose. Once in each pass it leaps right out and dives back in.
   It is harmless if you stay out of its path. Right next to it the pushed sand flows like water and knocks you
   over, and a rover in its wake sinks to its axles. Sand rays dive deep under anything hard, like the outpost.
   Real science used here (the cards in js/data.js, JA.MECHS 'ray', 'sandswim', 'swave'):
   - Real animals swim through sand: the sandfish lizard of the Sahara wriggles under the surface. Shaken sand
     flows almost like a liquid.
   - Anything that moves in the ground sends out a fast P wave and a slow S wave. The gap between them tells a
     seismometer how far away the shaking is. NASA's InSight lander located marsquakes this way.
   Only a planet whose JA.SITES entry has creature: 'ray' has them. Like the meteorites (js/skyfall.js) the passes
   are invented by the host's game and kept in s.ray, so in crew mode every player sees the same ray.
   No storage, no network. Without this file the planet simply has no rays. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain;
  var Y = JA.ray = {};
  if (!T) return;

  var DAYS = { 5: [2, 4], 8: [2, 5, 7], 10: [2, 5, 7, 9] };   // which days a ray passes (never on day 1, never on launch day)
  var SPEED = 8, LEN = 300;          // MADE UP: metres per second under the sand, and the length of one pass
  var VP = 400, VS = 200;            // REAL (roughly): P and S waves in dry, loose sand, metres per second
  var LEAP = 2.8;                    // seconds out of the sand when it leaps
  var DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  var mesh = null, meshRoot = null, rumble = 0, tossT = 0, felt = {};
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function has(s) { return !!(s && s.site && s.site.creature === 'ray'); }

  function plan(s) {
    var out = {};
    (DAYS[s.totalSols] || [2]).forEach(function (d) { if (d < s.totalSols) out[d] = 0.3 + Math.random() * 0.4; });
    s.ray = { days: out, done: {}, pass: null, seen: 0, warned: 0 };
  }

  // ---------- where it goes ----------
  // A long, gently curved line that passes 24 to 46 m from the player (or from the outpost, if the player is inside).
  // A few tries: the first one whose closest point is open sand, where it can leap (it dives under anything hard).
  function startPass(s, ctx) {
    var c = ctx.outside && ctx.pos ? ctx.pos : { x: 0, z: 0 }, p = null;
    for (var k = 0; k < 12 && !(p && p.leapOk); k++) {
      var a = Math.random() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), side = Math.random() < 0.5 ? -1 : 1, miss = 24 + Math.random() * 22;
      var px = c.x - dz * miss * side, pz = c.z + dx * miss * side;
      var q = { sol: s.sol, t0: s.t, x0: px - dx * LEN / 2, z0: pz - dz * LEN / 2, dx: dx, dz: dz, bend: (Math.random() - 0.5) * 16,
        leap: 0.5, warned: false, seen: false, felt: false, buried: false };
      var lp = at(q, q.leap, {});
      q.leapOk = shallow(lp.x, lp.z) > 0.8;
      if (!p || q.leapOk) p = q;
    }
    s.ray.done[s.sol] = true;
    s.ray.pass = p;
    // the Sandquake Sensor feels it at once: the gap between the P and the S wave gives the distance
    if (s.inst && s.inst.seismo && ctx.say) {
      // the sensor reads the gap to a tenth of a second, and works the distance out from that: gap x 400 m (VP and VS)
      var sen = JA.terrain.L.inst.seismo, d = Math.hypot(p.x0 - sen[0], p.z0 - sen[1]), gap = Math.max(0.1, Math.round((d / VS - d / VP) * 10) / 10);
      p.warned = true; s.ray.warned++;
      ctx.say(sensorName(s) + ': tremors! The fast P wave arrived ' + gap.toFixed(1) + ' seconds before the slow S wave, so something big is moving under the sand about ' +
        Math.round(gap * VP * VS / (VP - VS)) + ' metres from the sensor. A sand ray is coming' + (ctx.outside ? ' from the ' + dirWord(c, { x: p.x0, z: p.z0 }) : '') + '! Stay out of its path.');
      if (JA.sim && JA.sim.note) JA.sim.note(s, 'swave');
    }
  }
  function at(p, u, out) {
    var b = Math.sin(Math.PI * u) * p.bend, db = Math.cos(Math.PI * u) * Math.PI * p.bend / LEN;
    out.x = p.x0 + p.dx * LEN * u - p.dz * b; out.z = p.z0 + p.dz * LEN * u + p.dx * b;
    out.hx = p.dx - p.dz * db; out.hz = p.dz + p.dx * db;            // heading (not normalised)
    return out;
  }
  // How close to the surface it swims here: it dives deep near anything hard (buildings, boulders) and far out
  // where the land rises into the hills. 1 = just under the sand, 0 = out of sight.
  function shallow(x, z) {
    var C = (JA.base && JA.base.colliders) || [], k = 1, i;
    for (i = 0; i < C.length; i++) { var d = Math.hypot(x - C[i].x, z - C[i].z) - C[i].r; if (d < 14) k = Math.min(k, smooth(5, 14, d)); }
    return k * (1 - smooth(Tn.PLAY_R - 30, Tn.PLAY_R - 5, Math.hypot(x, z)));
  }
  function sensorName(s) {
    var list = (JA.INSTRUMENTS && JA.pick(s, JA.INSTRUMENTS)) || [], i;
    for (i = 0; i < list.length; i++) if (list[i].id === 'seismo') return list[i].name;
    return 'Quake sensor';
  }
  function dirWord(from, to) {
    var deg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI + 360) % 360;
    return DIRS[Math.round(deg / 45) % 8];
  }

  // ---------- the animal ----------
  // A flat oval body, two wide wings hinged at its sides, a whip of a tail, sand-coloured with darker dune stripes
  // on its back (camouflage) and a pale belly. About 15 m from wing tip to wing tip.
  function skinTex(rx, ry) {
    var t = W.canvasTex(128, function (ctx, n) {
      ctx.fillStyle = '#c48a48'; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = 'rgba(105, 62, 28, 0.55)'; ctx.lineWidth = 7;
      for (var k = -1; k < 7; k++) {
        ctx.beginPath();
        for (var x = 0; x <= n; x += 8) { var y = k * 22 + Math.sin(x / n * Math.PI * 2) * 6; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      for (var i = 0; i < 80; i++) { ctx.fillStyle = 'rgba(246, 226, 184, ' + (0.2 + (i % 5) * 0.06) + ')'; ctx.beginPath(); ctx.arc((i * 37) % n, (i * 53) % n, 1 + (i % 3), 0, 6.283); ctx.fill(); }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry);
    return t;
  }
  function glowTex(rx, ry) {
    var t = W.canvasTex(128, function (ctx, n) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      for (var k = -1; k < 7; k++) {
        ctx.beginPath();
        for (var x = 0; x <= n; x += 8) { var y = k * 22 + Math.sin(x / n * Math.PI * 2) * 6; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry);
    return t;
  }
  function buildMesh(s) {
    // the wings are mapped in metres (repeat about every 4 m); the body, a sphere, all the way round (2 x 1.5 times)
    // at night its stripes glow a faint blue-green (made up, like the glow of real deep-sea animals)
    var g = new T.Group(), skin = new T.MeshStandardMaterial({ map: skinTex(0.25, 0.25), roughness: 0.85, side: T.DoubleSide, emissive: 0x38e0c8, emissiveMap: glowTex(0.25, 0.25), emissiveIntensity: 0 });
    var hide = new T.MeshStandardMaterial({ map: skinTex(2, 1.5), roughness: 0.85, emissive: 0x38e0c8, emissiveMap: glowTex(2, 1.5), emissiveIntensity: 0 });
    var sand = new T.MeshStandardMaterial({ color: 0xd8a45e, roughness: 1 }), dark = new T.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.4 });
    // under the sand: a moving hump, and the two wing tips cutting the surface
    var hump = new T.Mesh(new T.SphereGeometry(1, 20, 10), sand); hump.scale.set(5.2, 1, 3.8); hump.receiveShadow = true; g.add(hump);
    var tips = [-1, 1].map(function (sx) {
      var f = new T.Mesh(new T.ConeGeometry(0.55, 1.4, 4), skin); f.scale.set(0.22, 1, 1.5); f.position.x = sx * 6.2; f.castShadow = true; g.add(f); return f;
    });
    // out of the sand: the whole animal
    var body = new T.Group(); g.add(body);
    var core = new T.Mesh(new T.SphereGeometry(1, 22, 12), hide); core.scale.set(1.3, 0.48, 2.7); core.castShadow = true; body.add(core);
    var belly = new T.Mesh(new T.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xf0dfc0, roughness: 0.9 }));
    belly.scale.set(1.24, 0.42, 2.6); body.add(belly);
    var wings = [-1, 1].map(function (sx) {
      var sh = new T.Shape();
      sh.moveTo(0, 2.3); sh.quadraticCurveTo(3.6, 2.3, 6.6, -0.3); sh.quadraticCurveTo(3.4, -1.3, 0, -2.4); sh.lineTo(0, 2.3);
      var geo = new T.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.12, bevelSegments: 2, curveSegments: 10 });
      geo.rotateX(Math.PI / 2); geo.translate(0, 0.08, 0);
      var hinge = new T.Group(); hinge.position.x = sx * 1.0; body.add(hinge);
      var m = new T.Mesh(geo, skin); m.scale.x = sx; m.castShadow = true; hinge.add(m);
      return hinge;
    });
    var tail = new T.Mesh(new T.ConeGeometry(0.17, 5.5, 6), hide); tail.geometry.rotateX(-Math.PI / 2); tail.position.z = -5.2; body.add(tail);
    [-1, 1].forEach(function (sx) {
      var horn = new T.Mesh(new T.ConeGeometry(0.2, 1.1, 6), hide); horn.geometry.rotateX(Math.PI / 2); horn.position.set(sx * 0.6, 0.05, 2.9); horn.rotation.y = sx * 0.25; body.add(horn);
      var eye = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), dark); eye.position.set(sx * 0.82, 0.28, 1.9); body.add(eye);
    });
    body.visible = false;
    W.root.add(g);
    mesh = { group: g, hump: hump, tips: tips, body: body, wings: wings, glow: [skin, hide] };
    meshRoot = W.root;
  }
  function dropMesh() { if (mesh && mesh.group.parent) mesh.group.parent.remove(mesh.group); mesh = null; }

  // ---------- each frame ----------
  // ctx: { outside, pos {x,z}, host (this game plans the passes), busy (a crisis or a mini-game is open),
  //        say(text), tip(id, text), drop() (put down what you carry) }
  var P = { x: 0, z: 0, hx: 0, hz: 1 };
  Y.update = function (dt, s, ctx) {
    if (!has(s) || !W.root) { if (mesh) dropMesh(); stopSound(); return; }
    if (!s.ray) { if (!ctx.host) return; plan(s); }
    var r = s.ray, p = r.pass;
    // the host starts a pass on its day, at its time, but never during a solar storm alarm or a crisis
    if (!p && ctx.host) {
      var frac = r.days[s.sol], ph = JA.sim.stormPhase(s);
      if (frac != null && !r.done[s.sol] && !ctx.busy && s.t >= frac * s.dayLength && s.t < s.dayLength * 0.85 && ph !== 'warning' && ph !== 'active') { startPass(s, ctx); p = r.pass; }
    }
    if (!p || p.sol !== s.sol) { if (p && ctx.host) r.pass = null; if (mesh) dropMesh(); stopSound(); return; }
    var u = (s.t - p.t0) * SPEED / LEN;
    if (u > 1) { if (ctx.host) r.pass = null; if (mesh) dropMesh(); stopSound(); return; }
    if (!mesh || meshRoot !== W.root) buildMesh(s);
    at(p, u, P);
    var hl = Math.hypot(P.hx, P.hz) || 1, hx = P.hx / hl, hz = P.hz / hl, yaw = Math.atan2(hx, hz);
    var ground = Tn.height(P.x, P.z), show = shallow(P.x, P.z), t = W.time;
    var me = ctx.pos || { x: 0, z: 0 }, dist = Math.hypot(P.x - me.x, P.z - me.z);
    // the leap: once, where it passes closest, if the sand there is open
    var lu = (u - p.leap) * LEN / SPEED / LEAP + 0.5, leaping = p.leapOk && lu > 0 && lu < 1;
    var g = mesh.group, night = W.skyDark ? W.skyDark() : 0;
    mesh.glow.forEach(function (m) { m.emissiveIntensity = night * 1.4; });
    g.position.set(P.x, ground, P.z); g.rotation.set(0, yaw, 0);
    // the hump and the wing tips
    var under = leaping ? 1 - smooth(0, 0.12, lu) + smooth(0.88, 1, lu) : 1, sh = show * under;
    mesh.hump.visible = sh > 0.02; mesh.hump.position.y = -1 + 1.0 * sh; mesh.hump.scale.y = 0.4 + 0.75 * sh;
    mesh.tips.forEach(function (f, i) { f.visible = sh > 0.25; f.position.y = -0.1 + 0.6 * Math.sin(t * 2.6 + i * Math.PI) * sh + 0.45 * sh; });
    // the whole animal, during the leap: up in an arc, nose first, wings beating
    mesh.body.visible = leaping;
    if (leaping) {
      var hgt = Math.sin(Math.PI * lu) * 3.4;
      mesh.body.position.set(0, hgt + 0.3, 0); mesh.body.rotation.set((lu - 0.5) * 1.3, 0, Math.sin(t * 1.7) * 0.08);
      var flap = Math.sin(t * 5.5) * 0.45;
      mesh.wings[0].rotation.z = -flap; mesh.wings[1].rotation.z = flap;
      if (!p.leapOut && lu > 0.05) { p.leapOut = true; splash(P, s, 1); if (JA.audio) JA.audio.play('swish'); }
      if (!p.leapIn && lu > 0.93) { p.leapIn = true; splash(P, s, 1.3); if (JA.audio) JA.audio.play('thud'); }
      // a close look: the first time each mission, you get the cards (it is made up; the science is real)
      if (ctx.host && ctx.outside && dist < 90 && !p.seen) {
        p.seen = true; r.seen++;
        if (JA.audio) JA.audio.play('discovery');
        if (ctx.say) ctx.say(r.seen === 1 ? 'A sand ray! It leapt right out of the dunes! Sand rays are made up for this game, but real animals do swim through sand.' : 'There goes another sand ray!');
        if (JA.sim && JA.sim.note) { JA.sim.note(s, 'ray'); JA.sim.note(s, 'sandswim'); }
      }
    }
    // sand: a bow wave at its nose, and a trail settling behind it
    if (sh > 0.2 && !leaping) {
      // big enough to spot from 50 m away: a plume of sand thrown up at its nose, and a cloud hanging behind it
      var n = W.rate(0.8 * sh, dt), col = s.site.colors.dust, i;      // W.rate counts per frame
      for (i = 0; i < n; i++) {
        var side = (Math.random() - 0.5) * 8, nx = P.x + hx * 3.8 - hz * side * 0.4, nz = P.z + hz * 3.8 + hx * side * 0.4;
        W.emit(nx, Tn.height(nx, nz) + 0.3, nz, { vx: hx * 4 + (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 3.5, vz: hz * 4 + (Math.random() - 0.5) * 4,
          life: 1.4, size: 1.0, grow: 2.6, color: col, alpha: 0.6, grav: W.gravity * 0.6 });
      }
      n = W.rate(0.25 * sh, dt);
      for (i = 0; i < n; i++) {
        var bx = P.x - hx * 4 + (Math.random() - 0.5) * 8, bz = P.z - hz * 4 + (Math.random() - 0.5) * 8;
        W.emit(bx, Tn.height(bx, bz) + 0.4, bz, { vx: (Math.random() - 0.5), vy: 0.8, vz: (Math.random() - 0.5), life: 3.5, size: 2.2, grow: 3, color: col, alpha: 0.3, grav: 0 });
      }
    }
    // feeling it: the ground shakes, and a low rumble grows as it comes closer
    var near = clamp(1 - dist / 110, 0, 1) * Math.max(sh, leaping ? 1 : 0);
    if (near > 0.02) W.cam.shake = Math.max(W.cam.shake || 0, near * near * (ctx.outside ? 0.55 : 0.3));
    rumble = near;
    if (JA.audio) { if (near > 0.03) JA.audio.loop('ray', { f: 38 + near * 18, v: 0.03 + near * 0.13, type: 'triangle' }); else JA.audio.stopLoop('ray', 0.4); }
    // no sensor: you only notice it when the ground starts to hum
    if (!p.warned && !p.felt && near > 0.12 && ctx.say) {
      p.felt = true;
      ctx.say(ctx.outside ? 'The ground is humming… Something big is moving under the sand! Get out of its way!' : 'The floor is trembling. Something big is passing under the sand outside!');
      if (ctx.tip && !(s.inst && s.inst.seismo)) ctx.tip('raysensor', 'A Sandquake Sensor would have felt it coming from far away. Set it up at the pallet of instruments!');
    }
    // right beside it the sand flows like water: you tumble, and drop what you carry
    tossT -= dt;
    if (ctx.outside && ctx.astro && ctx.astro.mode === 'walk' && sh > 0.5 && dist < 7 && tossT <= 0) {
      tossT = 3;
      var ax = (me.x - P.x) / (dist || 1), az = (me.z - P.z) / (dist || 1);
      ctx.astro.vel.x = ax * 7 + hx * 3; ctx.astro.vel.z = az * 7 + hz * 3; ctx.astro.vy = 4.2; ctx.astro.onGround = false;
      if (ctx.astro.carrying && ctx.drop) ctx.drop();
      if (JA.audio) JA.audio.play('thud');
      if (ctx.say) ctx.say('Whoa! The sand flowed like water under your boots. Keep away from a sand ray\'s path!');
    }
    // a rover in its wake sinks to its axles (the rules keep that until the crew digs it out tonight)
    if (ctx.host && ctx.rover && !p.buried && sh > 0.5 && Math.hypot(P.x - ctx.rover.x, P.z - ctx.rover.z) < 7.5 && s.m && s.m.rover && !s.m.rover.stuck) {
      p.buried = true; s.m.rover.stuck = true;
      if (ctx.say) ctx.say('The sand ray\'s wake swallowed the rover\'s wheels! It is stuck until the crew digs it out tonight.');
    }
  };
  function splash(p, s, k) {
    var col = s.site.colors.dust, y = Tn.height(p.x, p.z);
    W.burst(p.x, y + 0.5, p.z, Math.round(50 * k), 9 * k, col, { life: 2.2, size: 1.3, grow: 2.6, alpha: 0.6, up: 1, lift: 4, grav: W.gravity * 0.5 });
  }
  function stopSound() { if (rumble > 0 && JA.audio) JA.audio.stopLoop('ray', 0.4); rumble = 0; }

  // Where is the ray, for the waypoint marker? Only while the Sandquake Sensor is tracking it.
  Y.marker = function (s, pos, out) {
    var p = has(s) && s.ray && s.ray.pass; if (!p || !p.warned || p.sol !== s.sol) return null;
    var u = (s.t - p.t0) * SPEED / LEN; if (u < 0 || u > 1) return null;
    at(p, u, P);
    if (shallow(P.x, P.z) < 0.2) return null;
    return out.set(P.x, Tn.height(P.x, P.z) + 3, P.z);
  };
  Y.active = function (s) { return !!(has(s) && s.ray && s.ray.pass && s.ray.pass.sol === s.sol); };
  Y.SPEED = SPEED; Y.LEN = LEN; Y.VP = VP; Y.VS = VS;
})(window.JA);
