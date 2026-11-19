/* Astro Outpost — rocks from the sky.
   Now and then a meteorite hits the ground near the outpost. Find the fresh crater and you can
   pick up a real rock from space. A seismometer (the quake sensor) pinpoints the crater for you.

   Real science used here:
   - Mars has thin air, so a meteor glows on the way down and you hear the boom late
     (sound travels at only about 240 m/s there). NASA's InSight lander felt and heard real strikes.
   - The Moon has no air: no fireball and no sound, only a flash and a shake of the ground.
   The strikes themselves are invented for the game. The facts on the cards are real. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain;
  var K = JA.sky = {};
  if (!T) return;

  // on which days a rock falls, for 5, 8 and 10 day missions (never on launch day)
  var DAYS = { 5: [1, 3], 8: [1, 4, 6], 10: [1, 4, 6, 8] };
  var DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  var FINDS = {
    mars: [
      { title: 'A rock that fell from space', src: 'insight',
        text: 'On 24 December 2021, NASA\'s InSight lander felt the ground shake on Mars. A meteorite had hit! An orbiter then photographed the new crater: about 150 metres wide, with chunks of buried ice thrown out around it.' },
      { title: 'An iron meteorite', src: 'mer',
        text: 'In 2005 the Opportunity rover found the first meteorite ever spotted on another planet: a lump of iron and nickel the size of a basketball. The team named it Heat Shield Rock.' },
      { title: 'A chip off an asteroid', src: 'msl',
        text: 'The Curiosity rover has found iron meteorites on Mars too. One, nicknamed Cacao, is about 30 centimetres wide. Most meteorites are chips knocked off asteroids long ago.' }
    ],
    moon: [
      { title: 'A brand-new crater', src: 'lro',
        text: 'The Moon has no air to burn up space rocks, so even small ones hit the ground at full speed. NASA\'s Lunar Reconnaissance Orbiter has found more than 200 new craters by comparing before-and-after photos.' },
      { title: 'Feeling a space rock land', src: 'apollo',
        text: 'Apollo astronauts left moonquake sensors on the Moon. For years those sensors felt space rocks hitting the ground, which helped scientists work out what the inside of the Moon is like.' },
      { title: 'Crumbs older than the Moon', src: 'moon',
        text: 'Most meteorites are crumbs left over from when the planets formed, about 4.6 billion years ago. Tiny ones hit the Moon all the time and slowly grind its rocks into the grey dust under your boots.' }
    ],
    // Sahrun is made up: these cards tell what real deserts and real planets show about falling space rocks
    sahrun: [
      { title: 'Space rocks love deserts', src: 'earthobs',
        text: 'Most meteorites ever found on Earth were picked up in deserts and in Antarctica. On bare sand or ice a dark space rock is easy to spot, and dry air keeps it from rusting away.' },
      { title: 'A fireball in thick air', src: 'insight',
        text: 'Thick air slows a falling space rock and heats it until it glows: a fireball. Even Mars\'s thin air does this, and NASA\'s InSight lander felt the ground shake and picked up the boom when meteorites hit.' },
      { title: 'A chip off an asteroid', src: 'msl',
        text: 'Most meteorites are chips knocked off asteroids long ago. NASA\'s Curiosity rover has found iron meteorites on Mars: one, nicknamed Cacao, is about 30 centimetres wide.' }
    ]
  };

  var mesh = null, meshRoot = null, v = new T.Vector3();
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function plan(s) {
    var days = DAYS[s.totalSols] || [1], out = {};
    days.forEach(function (d) { if (d < s.totalSols) out[d] = 0.5 + Math.random() * 0.16; });
    s.sky = { days: out, done: {}, fall: null, site: null, found: 0, boom: 0 };
  }

  // A flat, empty patch of ground, away from the buildings and from everything else on the map.
  function pickSpot(from) {
    var C = (JA.base && JA.base.colliders) || [], L = Tn.L, best = null, bestSlope = 1e9, i, k;
    var keep = [L.hab, L.ice, L.rocket, L.pallet, L.seat, L.hill, L.mesa, L.inst.seismo, L.inst.beam, L.inst.rad].concat(L.geo, L.photo);
    for (i = 0; i < 60; i++) {
      var a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 72, x = Math.cos(a) * r, z = Math.sin(a) * r, ok = true;
      if (Math.hypot(x, z) > Tn.PLAY_R - 24) continue;
      if (from && Math.hypot(x - from.x, z - from.z) < 42) continue;         // never on top of the player
      if (L.colony && Math.hypot(x - L.colony[0], z - L.colony[1]) < 44) continue;      // nor on the colony site
      for (k = 0; k < keep.length && ok; k++) if (Math.hypot(x - keep[k][0], z - keep[k][1]) < 24) ok = false;
      for (k = 0; k < C.length && ok; k++) if (Math.hypot(x - C[k].x, z - C[k].z) < C[k].r + 7) ok = false;
      if (!ok) continue;
      var slope = Math.abs(Tn.height(x + 3, z) - Tn.height(x - 3, z)) + Math.abs(Tn.height(x, z + 3) - Tn.height(x, z - 3));
      if (slope < bestSlope) { bestSlope = slope; best = { x: x, z: z, y: Tn.height(x, z) }; }
      if (slope < 0.3) break;
    }
    return best || { x: 70, z: -30, y: Tn.height(70, -30) };
  }
  function dirWord(from, to) {
    var deg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI + 360) % 360;       // north is -z
    return DIRS[Math.round(deg / 45) % 8];
  }
  function sensorName(s) {
    var list = (JA.INSTRUMENTS && JA.pick(s, JA.INSTRUMENTS)) || [], i;
    for (i = 0; i < list.length; i++) if (list[i].id === 'seismo') return list[i].name;
    return 'quake sensor';
  }
  function dustColor(s) { return s.site.colors.dust; }

  // ---------- the crater ----------
  function buildMesh(s) {
    var st = s.sky.site, g = new T.Group(), i, k;
    g.position.set(st.x, st.y, st.z);
    // a scorch mark that follows the shape of the ground and fades out at its edge
    var rings = 5, segs = 28, R = 4.6, pos = [], col = [], idx = [];
    for (i = 0; i <= rings; i++) for (k = 0; k < segs; k++) {
      var rr = R * i / rings, a = k / segs * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos.push(x, Tn.height(st.x + x, st.z + z) - st.y + 0.2, z);
      col.push(0.05, 0.04, 0.04, i === rings ? 0 : 0.8 * (1 - i / rings * 0.6));
    }
    for (i = 0; i < rings; i++) for (k = 0; k < segs; k++) {
      var a0 = i * segs + k, a1 = i * segs + (k + 1) % segs, b0 = a0 + segs, b1 = a1 + segs;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    var sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    sg.setAttribute('color', new T.Float32BufferAttribute(col, 4));
    sg.setIndex(idx);
    var scorch = new T.Mesh(sg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
    scorch.renderOrder = 1; g.add(scorch);
    // the raised rim
    var rimMat = W.mat(JA.pick(s, { moon: 0x4a4b56, mars: 0x6a3420, sahrun: 0x8a6a40 }));
    var rim = new T.Mesh(new T.TorusGeometry(2.25, 0.6, 5, 15), rimMat);
    rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1, 0.42); rim.position.y = 0.05; rim.castShadow = true; rim.receiveShadow = true; g.add(rim);
    // the dark bowl inside it
    var bowl = new T.Mesh(new T.CircleGeometry(2.05, 15), W.mat(JA.pick(s, { moon: 0x15161b, mars: 0x24120c, sahrun: 0x3a2a18 })));
    bowl.rotation.x = -Math.PI / 2; bowl.position.y = 0.14; bowl.receiveShadow = true; g.add(bowl);
    // chunks thrown out by the blast
    for (i = 0; i < 9; i++) {
      var ca = i * 0.7 + Math.random() * 0.5, cr = 3.2 + Math.random() * 2.6, cs = 0.16 + Math.random() * 0.26;
      var chunk = new T.Mesh(new T.DodecahedronGeometry(cs, 0), rimMat);
      chunk.position.set(Math.cos(ca) * cr, Tn.height(st.x + Math.cos(ca) * cr, st.z + Math.sin(ca) * cr) - st.y + cs * 0.5, Math.sin(ca) * cr);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, 0); chunk.castShadow = true; g.add(chunk);
    }
    // the meteorite itself: dark, and still glowing hot
    var rock = new T.Mesh(new T.IcosahedronGeometry(0.4, 0), new T.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.55, metalness: 0.55, emissive: 0xff4a10, emissiveIntensity: 1.1, flatShading: true }));
    rock.position.y = 0.48; rock.rotation.set(0.5, 0.3, 0.2); rock.castShadow = true; g.add(rock);
    // a slow beacon ring, so the crater can be spotted from far away
    var ring = new T.Mesh(new T.TorusGeometry(1.25, 0.07, 6, 30), new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, fog: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.62; g.add(ring);
    W.root.add(g);
    mesh = { group: g, rock: rock, ring: ring, age: st.age || 0, smoke: 0 };
    meshRoot = W.root;
  }

  // ---------- the fall ----------
  function startFall(s, ctx) {
    var k = s.sky, spot = pickSpot(ctx.pos), a = Math.random() * Math.PI * 2, air = JA.hasAir(s);      // only air makes a fireball
    k.done[s.sol] = true;
    k.fall = { t: 0, dur: air && ctx.outside ? 1.6 : 0.05, spot: spot,
      sx: spot.x + Math.cos(a) * 210, sy: spot.y + 190, sz: spot.z + Math.sin(a) * 210, streak: air && ctx.outside };
  }
  function stepFall(dt, s, ctx) {
    var k = s.sky, f = k.fall;
    f.t += dt;
    var u = clamp(f.t / f.dur, 0, 1), e = u * u;                   // it speeds up as it comes down
    if (f.streak && u < 1) {
      var x = lerp(f.sx, f.spot.x, e), y = lerp(f.sy, f.spot.y, e), z = lerp(f.sz, f.spot.z, e), n = W.rate(7, dt), i;
      W.emit(x, y, z, { life: 0.22, size: 7, grow: 0.5, color: 0xfff6d8, alpha: 1, grav: 0 });
      for (i = 0; i < n; i++) {
        W.emit(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2,
          { vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, life: 0.9 + Math.random() * 0.6, size: 3.4, grow: 0.3,
            color: Math.random() < 0.5 ? 0xffc27a : 0xff7a3a, alpha: 0.85, grav: 0 });
      }
    }
    if (u >= 1) impact(s, ctx);
  }
  function impact(s, ctx) {
    var k = s.sky, sp = k.fall.spot, air = JA.hasAir(s), me = ctx.pos, dist = Math.hypot(sp.x - me.x, sp.z - me.z);
    k.fall = null;
    k.site = { x: sp.x, y: sp.y, z: sp.z, sol: s.sol, exact: !!s.inst.seismo, age: 0 };
    buildMesh(s);
    // flash, then a fountain of dust
    W.burst(sp.x, sp.y + 0.8, sp.z, 46, 18, 0xfff3c4, { life: 0.55, size: 3, grow: 2.2, alpha: 0.95, grav: 0, up: 0.9 });
    W.burst(sp.x, sp.y + 0.4, sp.z, 80, 12, dustColor(s), { life: 3.4, size: 1.7, grow: 3, alpha: 0.5, up: 1, lift: 5, grav: W.gravity * 0.4 });
    W.cam.shake = Math.max(W.cam.shake, clamp(1.1 - dist / 170, 0.18, 0.85));
    if (JA.fx && JA.fx.pulse && ctx.outside) { JA.fx.pulse('flash', clamp(0.9 - dist / 260, 0.15, 0.7)); JA.fx.pulse('shock', clamp(1.1 - dist / 200, 0.2, 0.9)); }
    if (air) k.boom = Math.max(0.05, dist / JA.pick(s, { mars: 240, sahrun: 340 }));      // the boom arrives late: sound travels at about 240 m/s in Mars's thin air (Sahrun: about 340, as on Earth)
    var rough = Math.max(10, Math.round(dist / 10) * 10), dir = dirWord(me, sp), sensor = sensorName(s), line;
    if (!ctx.outside) line = 'Thump! The floor just shook. A meteorite has hit the ground outside, about ' + rough + ' metres to the ' + dir + '!';
    else if (air) line = 'Whoa, a fireball! A meteorite just hit ' + s.site.name + ', about ' + rough + ' metres to the ' + dir + '!';
    else line = 'Did you see that flash? A space rock just hit ' + s.site.name + ', about ' + rough + ' metres to the ' + dir + '. No air here, so no fireball and no sound!';
    line += k.site.exact ? ' Your ' + sensor + ' felt it and pinpointed the crater. Follow the ☄️ marker!'
      : ' Look for the glowing crater. A ' + sensor + ' would have pinpointed it for you.';
    if (JA.audio) JA.audio.play('page');
    if (ctx.say) ctx.say(line);
  }

  // ---------- called by the game ----------
  // ctx: { outside: bool, pos: {x,z}, say: fn(text), tip: fn(id, text) }
  K.update = function (dt, s, ctx) {
    if (!s || !W.root) return;
    if (!s.sky) plan(s);
    var k = s.sky, frac = k.days[s.sol];
    if (frac != null && !k.done[s.sol] && !k.fall && !k.site && s.t >= frac * s.dayLength && s.t < s.dayLength * 0.92) {
      var ph = JA.sim.stormPhase(s);
      if (ph !== 'warning' && ph !== 'active') startFall(s, ctx);
    }
    if (k.fall) stepFall(dt, s, ctx);
    if (k.boom > 0) {
      k.boom -= dt;
      if (k.boom <= 0) {
        k.boom = 0;
        if (JA.audio) JA.audio.play('touchdown');
        if (ctx.tip) ctx.tip('skyboom', 'Hear that? The boom arrived late. Sound travels slowly in the thin air of Mars: only about 240 metres every second.');
      }
    }
    var st = k.site;
    if (!st) { if (mesh && meshRoot !== W.root) mesh = null; return; }
    if (!mesh || meshRoot !== W.root) buildMesh(s);          // a crater from an earlier day, in a world that was rebuilt
    st.age += dt; mesh.age = st.age;
    var pulse = (st.age * 0.55) % 1;
    mesh.ring.scale.setScalar(1 + pulse * 1.6); mesh.ring.material.opacity = 0.9 * (1 - pulse);
    mesh.rock.material.emissiveIntensity = 0.3 + 0.8 * Math.exp(-st.age / 70) + Math.sin(st.age * 3) * 0.08;      // it slowly cools
    if (JA.hasAir(s) && st.age < 60) {               // smoke hangs in the air on Mars; on the Moon there is no air to hold it
      mesh.smoke -= dt;
      if (mesh.smoke <= 0) {
        mesh.smoke = 0.16;
        W.emit(st.x + (Math.random() - 0.5), st.y + 0.8, st.z + (Math.random() - 0.5), { vx: 0.6 + Math.random() * 0.8, vy: 2.4 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 0.6, life: 5, size: 1.1, grow: 3.4, color: 0x8a6a58, alpha: 0.3, grav: 0 });
      }
    }
    if (!st.exact && s.inst.seismo) {
      st.exact = true;
      if (ctx.say) ctx.say('Your ' + sensorName(s) + ' is working! It has pinpointed the fresh crater. Follow the ☄️ marker.');
    }
  };

  // The game asks: is there something to pick up near p? offer(distance, reach, action) is the game's own helper.
  K.offer = function (s, p, offer, run) {
    var st = s && s.sky && s.sky.site; if (!st) return;
    offer(Math.hypot(p.x - st.x, p.z - st.z) - 1.2, 2.6, { label: 'Pick up the space rock', run: run });
  };
  // Where is the crater, for the waypoint marker? Known exactly with a seismometer, otherwise only when you are close.
  K.marker = function (s, p, out) {
    var st = s && s.sky && s.sky.site; if (!st) return null;
    var d = Math.hypot(p.x - st.x, p.z - st.z);
    if (!st.exact && d > 75) return null;
    if (d < 5) return null;
    return out.set(st.x, st.y + 3.2, st.z);
  };
  K.goal = function (s, out) {
    var st = s && s.sky && s.sky.site; if (!st) return null;
    return { text: 'Find the fresh crater and pick up the space rock', target: st.exact ? out.set(st.x, st.y, st.z) : null };
  };
  // Pick the meteorite up. Returns the discovery (the game shows its card).
  K.collect = function (s) {
    var k = s && s.sky, st = k && k.site; if (!st) return null;
    var defs = JA.pick(s, FINDS), d = defs[k.found % defs.length];
    var find = { title: d.title, text: d.text, src: d.src, icon: '☄️', sol: s.sol, kind: 'meteor', place: 'the fresh crater' };
    s.finds.push(find);
    JA.sim.didScience(s);
    k.found++; k.site = null;
    if (mesh) {                                               // the crater stays as a landmark; the rock and the beacon go
      mesh.group.remove(mesh.rock); mesh.group.remove(mesh.ring);
      W.burst(st.x, st.y + 0.6, st.z, 22, 4, 0xffb347, { life: 0.9, size: 0.3, grav: 0 });
      mesh = null;
    }
    return find;
  };
})(window.JA);
