/* Astro Outpost — things that move: the astronaut, the rover, dust devils,
   and every object you can pick up, carry and throw (with real Moon / Mars gravity). */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain, B = JA.base, MD = JA.models, R = JA.RULES;
  var A = JA.actors = { items: [], devils: [] };
  if (!T) return;
  // models made in Blender (js/models.js); without them the plain shapes below are drawn
  function hasModel(name) { return !!(MD && MD.has(name)); }
  // The ground you stand on: the terrain, or the top of a raised floor such as the rocket's concrete pad
  // (base.js lists them in B.floors). Feet, wheels and dropped things all use it, so nothing sinks into the pad.
  function groundAt(x, z) {
    var h = Tn.height(x, z), F = B && B.floors, i, f, dx, dz, d, top;
    if (!F) return h;
    for (i = 0; i < F.length; i++) {
      f = F[i]; dx = x - f.x; dz = z - f.z;
      if (f.hw) { if (Math.abs(dx) < f.hw && Math.abs(dz) < f.hd && f.y + f.top > h) h = f.y + f.top; continue; }
      d = dx * dx + dz * dz;
      if (d >= f.r1 * f.r1) continue;
      d = Math.sqrt(d);
      top = f.y + (d <= f.r0 ? f.top : f.top + (f.edge - f.top) * (d - f.r0) / (f.r1 - f.r0));
      if (top > h) h = top;
    }
    return h;
  }
  A.groundAt = groundAt;
  var root, site, grav = 3.71, add, mat, soft, glow;
  var astro, rover;
  var v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), UP = new T.Vector3(0, 1, 0), q1 = new T.Quaternion();
  var THROW_ANGLE = 0.72, THROW_MIN = 3.2, THROW_MAX = 9.5;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function angLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

  // ---------- astronaut ----------
  // His skeleton: the same pivots as assets/blender/scripts/build_astronaut.py, in the model's own units (the game draws
  // him at 0.84 scale). toe: the ball of the foot in front of the ankle; heel: the back of the heel.
  var RIG = { scale: 0.84, hipX: 0.2, hipY: 0.86, kneeY: 0.5, ankleY: 0.15, waistY: 0.98, shX: 0.58, shY: 1.48, elbowY: 1.2, wristY: 0.97, toe: 0.26, heel: -0.13 };
  var L1 = RIG.hipY - RIG.kneeY, L2 = RIG.kneeY - RIG.ankleY, ANK = RIG.ankleY;
  function buildAstronaut(color) {
    var a = (hasModel('astronaut') && astronautModel(color)) || astronautShapes(color);
    a.group.scale.setScalar(RIG.scale);
    root.add(a.group);
    return Object.assign(a, { pos: new T.Vector3(0, 0, 13), vel: new T.Vector3(), vy: 0, yaw: Math.PI, onGround: true, mode: 'walk', carrying: null,
      aim: false, throwT: 0, spin: 0, moved: 0,
      // for poseAstro(): stride cycle, gait (0 walk .. 2 sprint), speed, how much he is moving, in the air, landing, leaning
      cyc: 0, gait: 0, spd: 0, move: 0, accel: 0, bank: 0, lastYaw: Math.PI, airT: 0, air: 0, runJump: 0, lead: 1, landT: 9, landK: 0, headY: 0, legPh: [0, 0.5] });
  }
  // the Blender astronaut; cuffs, bands, knee pads and gauntlets take the chosen suit colour
  function astronautModel(color) {
    var g = MD.make('astronaut'), accent = MD.mat(g, 'SuitAccent');
    function n(s) { return g.getObjectByName('astro_' + s); }
    if (!n('hips') || !n('shinL')) return null;             // an older model without knees: use the plain one
    if (accent) accent.color.setHex(color).convertSRGBToLinear();
    var a = { group: g, hips: n('hips'), body: n('body'), armL: n('armL'), armR: n('armR'), foreL: n('foreL'), foreR: n('foreR'), handL: n('handL'), handR: n('handR'),
      legL: n('legL'), legR: n('legR'), shinL: n('shinL'), shinR: n('shinR'), footL: n('footL'), footR: n('footR'), tip: n('antennaTip'), drill: n('drill'), bit: n('drillBit') };
    a.drill.visible = false;
    return a;
  }
  // the plain astronaut (when models-data.js is missing): the same joints, drawn with simple shapes
  function astronautShapes(color) {
    var g = new T.Group(), white = soft(0xf5f6fa), accent = soft(color), grey = soft(0xcfd3de), boot = soft(0x4f545c);
    g.userData.o = [0, 0, 0];
    // a joint at model position (x, y, z) inside parent, and a shape at a model position inside a joint
    function joint(parent, x, y, z) { var j = new T.Group(), o = parent.userData.o; j.position.set(x - o[0], y - o[1], z - o[2]); j.userData.o = [x, y, z]; parent.add(j); return j; }
    function put(j, geo, m, x, y, z, noShadow) { var o = j.userData.o; return add(j, geo, m, x - o[0], y - o[1], z - o[2], noShadow); }
    var hips = joint(g, 0, RIG.hipY, 0), body = joint(hips, 0, RIG.waistY, 0);
    put(hips, new T.SphereGeometry(0.45, 16, 12), white, 0, 0.82, 0).scale.set(1, 0.5, 0.86);
    put(hips, new T.TorusGeometry(0.45, 0.05, 6, 20), grey, 0, 0.86, 0).rotation.x = Math.PI / 2;
    put(body, new T.CapsuleGeometry(0.44, 0.36, 6, 14), white, 0, 1.28, 0);
    put(body, new T.BoxGeometry(0.7, 0.9, 0.38), grey, 0, 1.22, -0.46);
    put(body, new T.BoxGeometry(0.2, 0.14, 0.06), glow(0x4dff9a, 1.5), 0.18, 1.5, -0.66, true);
    put(body, new T.BoxGeometry(0.42, 0.26, 0.12), accent, 0, 1.22, 0.41);
    put(body, new T.TorusGeometry(0.4, 0.08, 8, 20), accent, 0, 1.6, 0).rotation.x = Math.PI / 2;
    put(body, new T.SphereGeometry(0.52, 22, 18), white, 0, 2.02, 0);
    put(body, new T.SphereGeometry(0.47, 22, 18), new T.MeshStandardMaterial({ color: 0xffc64a, metalness: 0.95, roughness: 0.12, emissive: 0x6b4a08, emissiveIntensity: 0.35 }), 0, 2.05, 0.15).scale.set(1, 0.72, 0.88);
    [-1, 1].forEach(function (sx) { put(body, new T.BoxGeometry(0.12, 0.1, 0.16), glow(0xdfeeff, 2), sx * 0.37, 2.34, 0.22, true); });      // helmet lamps
    put(body, new T.CylinderGeometry(0.02, 0.02, 0.5, 5), grey, 0.26, 1.9, -0.5);
    var tip = put(body, new T.SphereGeometry(0.06, 8, 8), glow(0xff5a5a, 2), 0.26, 2.17, -0.5, true);
    var a = { group: g, hips: hips, body: body, tip: tip };
    [-1, 1].forEach(function (sx) {
      var s = sx < 0 ? 'L' : 'R', x = sx * RIG.shX, lx = sx * RIG.hipX;
      var arm = joint(body, x, RIG.shY, 0), fore = joint(arm, x, RIG.elbowY, 0), hand = joint(fore, x, RIG.wristY, 0);
      put(arm, new T.CapsuleGeometry(0.15, 0.16, 4, 10), white, x, 1.34, 0);
      put(fore, new T.CapsuleGeometry(0.135, 0.12, 4, 10), white, x, 1.09, 0);
      put(hand, new T.SphereGeometry(0.15, 10, 10), accent, x, 0.88, 0);
      var leg = joint(hips, lx, RIG.hipY, 0), shin = joint(leg, lx, RIG.kneeY, 0), foot = joint(shin, lx, RIG.ankleY, 0);
      put(leg, new T.CapsuleGeometry(0.18, 0.2, 4, 10), white, lx, 0.68, 0);
      put(shin, new T.CapsuleGeometry(0.15, 0.2, 4, 10), white, lx, 0.33, 0);
      put(foot, new T.BoxGeometry(0.32, 0.18, 0.48), boot, lx, 0.09, 0.08);
      a['arm' + s] = arm; a['fore' + s] = fore; a['hand' + s] = hand; a['leg' + s] = leg; a['shin' + s] = shin; a['foot' + s] = foot;
    });
    // the drill (only shown while drilling)
    var drill = joint(body, 0, 0.95, 0.7); drill.visible = false;
    put(drill, new T.BoxGeometry(0.3, 0.5, 0.3), soft(0xffc533), 0, 1.15, 0.7);
    var bit = put(drill, new T.ConeGeometry(0.09, 0.9, 6), new T.MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.8, roughness: 0.3 }), 0, 0.5, 0.7); bit.rotation.x = Math.PI;
    a.drill = drill; a.bit = bit;
    return a;
  }

  // ---------- rover ----------
  function buildRover() {
    var g = new T.Group(), body = new T.Group(); g.add(body);
    var wheels = [], ring;
    if (hasModel('rover')) {
      // the Blender rover: the body tilts with the ground, the six wheels spin on their own (same order as below)
      var m = MD.make('rover');
      body.add(m.getObjectByName('rover_body'));
      ring = m.getObjectByName('rover_socketRing'); body.add(ring);
      for (var i = 0; i < 6; i++) { var mw = m.getObjectByName('rover_wheel_' + i); g.add(mw); wheels.push(mw); }
    } else roverShapes(g, body, wheels, function (r) { ring = r; });
    var lightL = new T.SpotLight(0xfff2cc, 0, 40, 0.7, 0.5, 1.3); lightL.position.set(0, 1.4, 2.2); body.add(lightL);
    lightL.target.position.set(0, 0, 14); body.add(lightL.target);
    root.add(g);
    var p = Tn.L.roverPark;
    return { group: g, body: body, wheels: wheels, ring: ring, light: lightL, pos: new T.Vector3(p[0], Tn.height(p[0], p[1]), p[1]),
      yaw: Math.PI / 2, speed: 0, vy: 0, lastGnd: 0, onGround: true, pitch: 0, roll: 0, bed: [null, null, null, null], trackD: 0, driver: false };
  }
  function roverShapes(g, body, wheels, setRing) {
    var white = soft(0xf2f3f7), dark = soft(0x2b3147), orange = soft(0xff8a3d);
    add(body, new T.BoxGeometry(2.3, 0.4, 4.6), white, 0, 0.95, 0);
    add(body, new T.BoxGeometry(2.1, 0.5, 1.5), orange, 0, 1.3, 1.3);
    add(body, new T.BoxGeometry(1.5, 0.12, 0.9), dark, 0, 1.25, 0.25);                      // seat
    add(body, new T.BoxGeometry(1.5, 0.9, 0.14), dark, 0, 1.7, -0.2);
    var wheel = add(body, new T.TorusGeometry(0.3, 0.05, 6, 16), dark, 0, 1.85, 1.0); wheel.rotation.x = -0.6;
    // roll bar + antenna + lights
    [-1.05, 1.05].forEach(function (x) { add(body, new T.CylinderGeometry(0.06, 0.06, 1.7, 6), white, x, 2.0, -0.3); });
    add(body, new T.BoxGeometry(2.2, 0.1, 0.12), white, 0, 2.85, -0.3);
    add(body, new T.CylinderGeometry(0.02, 0.02, 1.6, 5), white, 0.95, 3.6, -0.3);
    add(body, new T.SphereGeometry(0.07, 8, 8), glow(0xff5a5a, 2), 0.95, 4.42, -0.3, true);
    var hlM = glow(0xfff6d8, 2.2);
    [-0.75, 0.75].forEach(function (x) { add(body, new T.SphereGeometry(0.17, 10, 8), hlM, x, 1.3, 2.1, true); });
    // cargo bed
    add(body, new T.BoxGeometry(2.1, 0.12, 1.9), soft(0x8a8fa0), 0, 1.2, -1.3);
    [[-1.05, -1.3, 0.1, 1.9], [1.05, -1.3, 0.1, 1.9], [0, -2.25, 2.2, 0.1]].forEach(function (r) { add(body, new T.BoxGeometry(r[2], 0.5, r[3]), soft(0xffc533), r[0], 1.5, r[1]); });
    // power socket on the back
    add(body, new T.CylinderGeometry(0.45, 0.4, 0.4, 14), dark, 0, 1.25, -2.55);
    var ring = add(body, new T.TorusGeometry(0.46, 0.07, 8, 20), glow(0xffd23f, 1.4), 0, 1.46, -2.55, true); ring.rotation.x = Math.PI / 2;
    setRing(ring);
    [-1.6, 0, 1.6].forEach(function (z) { [-1.25, 1.25].forEach(function (x) {
      var w = new T.Group(); w.position.set(x, 0.62, z); g.add(w);
      var tire = add(w, new T.CylinderGeometry(0.62, 0.62, 0.42, 12), mat(0x22252f), 0, 0, 0); tire.rotation.z = Math.PI / 2;
      add(w, new T.CylinderGeometry(0.3, 0.3, 0.46, 8), soft(0xdfe2ea), 0, 0, 0).rotation.z = Math.PI / 2;
      add(w, new T.BoxGeometry(0.46, 0.14, 1.0), mat(0x3a3e4c), 0, 0, 0);
      wheels.push(w);
    }); });
  }
  var BED = [[-0.5, 1.6, -0.85], [0.5, 1.6, -0.85], [-0.5, 1.6, -1.7], [0.5, 1.6, -1.7]];
  function roverLocal(x, y, z, out) {
    var s = Math.sin(rover.yaw), c = Math.cos(rover.yaw);
    return out.set(rover.pos.x + x * c + z * s, rover.pos.y + y, rover.pos.z - x * s + z * c);
  }
  A.roverSpot = function (name, out) {
    if (name === 'bed') return roverLocal(0, 1.7, -1.3, out);
    if (name === 'socket') return roverLocal(0, 1.7, -2.55, out);
    if (name === 'door') return roverLocal(-2.1, 0, 0.5, out);
    return roverLocal(0, 0, 0, out);
  };
  A.bedFree = function () { for (var i = 0; i < 4; i++) if (!rover.bed[i]) return i; return -1; };
  A.toBed = function (it) {
    var i = A.bedFree(); if (i < 0) return false;
    if (astro.carrying === it) astro.carrying = null;
    rover.bed[i] = it; it.state = 'bed'; it.slot = i; it.vel.set(0, 0, 0);
    return true;
  };

  // ---------- things you can carry ----------
  var ITEM_MODEL = { cell: 'power_cell', bag: 'soil_bag', core: 'core_sample', crate: 'food_crate', inst: 'instrument', 'case': 'supply_case' };
  function itemModel(type, data) {
    var name = type === 'ice' ? null : ITEM_MODEL[type] || 'supply_case', m, c;
    if (!name || !hasModel(name)) return null;
    m = MD.make(name);
    if (type === 'bag') MD.mat(m, 'Sack').color.setHex(site === 'mars' ? 0xa9582f : 0x7b7c87).convertSRGBToLinear();
    else if (type === 'core') { c = MD.mat(m, 'Glow_Core'); c.color.setHex([0xc9824a, 0xdfe2ea, 0xffd23f][data ? data.quality : 1]); c.emissive.copy(c.color); }
    else if (type === 'inst') { c = MD.mat(m, 'Glow_Inst'); c.color.setHex({ seismo: 0x5cf0ff, beam: 0xffd23f, rad: 0xff6fb1 }[data && data.id] || 0xffffff); c.emissive.copy(c.color); }
    return m;
  }
  function itemMesh(type, data) {
    var mm = itemModel(type, data);
    if (mm) return mm;
    var g = new T.Group(), k;
    if (type === 'cell') {
      add(g, new T.CylinderGeometry(0.3, 0.3, 0.8, 14), glow(0xffe36a, 1.5), 0, 0, 0);
      add(g, new T.CylinderGeometry(0.32, 0.32, 0.14, 14), soft(0x2b3147), 0, 0.37, 0); add(g, new T.CylinderGeometry(0.32, 0.32, 0.14, 14), soft(0x2b3147), 0, -0.37, 0);
      add(g, new T.CylinderGeometry(0.12, 0.12, 0.1, 8), soft(0xdfe2ea), 0, 0.48, 0);
    } else if (type === 'ice') {
      add(g, new T.IcosahedronGeometry(0.42, 0), new T.MeshStandardMaterial({ color: 0xdff7ff, emissive: 0x58c8ff, emissiveIntensity: 0.9, roughness: 0.15, flatShading: true, transparent: true, opacity: 0.92 }), 0, 0, 0);
    } else if (type === 'bag') {
      var b = add(g, new T.SphereGeometry(0.5, 8, 6), mat(site === 'mars' ? 0xa9582f : 0x7b7c87), 0, 0, 0); b.scale.set(1.15, 0.6, 0.8);
      add(g, new T.TorusGeometry(0.3, 0.035, 5, 12), soft(0xf2e6c8), 0, 0, 0).rotation.y = Math.PI / 2;
    } else if (type === 'core') {
      add(g, new T.CylinderGeometry(0.13, 0.13, 0.7, 10), new T.MeshStandardMaterial({ color: 0xcfd3de, metalness: 0.8, roughness: 0.25 }), 0, 0, 0);
      add(g, new T.CylinderGeometry(0.15, 0.15, 0.16, 10), glow([0xc9824a, 0xdfe2ea, 0xffd23f][data ? data.quality : 1], 1.3), 0, 0.36, 0);
    } else if (type === 'crate') {
      add(g, new T.BoxGeometry(0.85, 0.5, 0.62), soft(0xc9965a), 0, 0, 0);
      for (k = 0; k < 5; k++) add(g, new T.SphereGeometry(0.16, 8, 6), k % 2 ? soft(0x4fd15a) : glow(0xff4a3a, 0.35), -0.27 + (k % 3) * 0.27, 0.3, k < 3 ? -0.13 : 0.14);
    } else if (type === 'inst') {
      var col = { seismo: 0x5cf0ff, beam: 0xffd23f, rad: 0xff6fb1 }[data.id] || 0xffffff;
      add(g, new T.BoxGeometry(0.8, 0.7, 0.8), soft(0xf2f3f7), 0, 0, 0);
      add(g, new T.BoxGeometry(0.84, 0.18, 0.84), glow(col, 0.9), 0, 0.05, 0);
      add(g, new T.TorusGeometry(0.2, 0.04, 6, 12), soft(0x2b3147), 0, 0.42, 0);
    } else {
      add(g, new T.BoxGeometry(1.0, 0.5, 0.7), soft(0xff8a3d), 0, 0, 0);
      add(g, new T.BoxGeometry(1.04, 0.1, 0.74), soft(0x2b3147), 0, 0.02, 0);
      add(g, new T.TorusGeometry(0.2, 0.04, 6, 12), soft(0x2b3147), 0, 0.3, 0);
    }
    return g;
  }
  var RADIUS = { cell: 0.4, ice: 0.4, bag: 0.32, core: 0.34, crate: 0.3, inst: 0.38, 'case': 0.28 };
  A.spawn = function (type, pos, data, state) {
    var it = { type: type, mesh: itemMesh(type, data), pos: pos.clone(), vel: new T.Vector3(), state: state || 'rest', r: RADIUS[type] || 0.35,
      data: data || null, spin: 0, from: null, slot: -1, tag: null, age: 0 };
    it.mesh.position.copy(it.pos);
    root.add(it.mesh);
    A.items.push(it);
    return it;
  };
  A.remove = function (it) {
    var i = A.items.indexOf(it); if (i >= 0) A.items.splice(i, 1);
    if (astro.carrying === it) astro.carrying = null;
    if (it.state === 'bed' && it.slot >= 0) rover.bed[it.slot] = null;
    root.remove(it.mesh);
  };
  A.pick = function (it) {
    if (it.state === 'bed' && it.slot >= 0) { rover.bed[it.slot] = null; it.slot = -1; }
    it.state = 'held'; it.vel.set(0, 0, 0); it.from = null; astro.carrying = it;
  };
  A.handPos = function (out) {
    var s = Math.sin(astro.yaw), c = Math.cos(astro.yaw);
    var f = astro.fp ? 0.95 : 0.72;      // in first person, hold things a little higher and further out so you can see them
    return out.set(astro.pos.x + s * f, astro.pos.y + (astro.fp ? 1.25 : 1.15), astro.pos.z + c * f);
  };
  A.setDown = function () {
    var it = astro.carrying; if (!it) return null;
    astro.carrying = null; it.state = 'fly'; it.from = null;
    it.vel.set(Math.sin(astro.yaw) * 1.2 + astro.vel.x, 0.6, Math.cos(astro.yaw) * 1.2 + astro.vel.z);
    return it;
  };
  function throwVel(power, out) {
    var v = lerp(THROW_MIN, THROW_MAX, power);
    W.forward(v1);
    return out.set(v1.x * Math.cos(THROW_ANGLE) * v, Math.sin(THROW_ANGLE) * v, v1.z * Math.cos(THROW_ANGLE) * v);
  }
  A.throwHeld = function (power) {
    var it = astro.carrying; if (!it) return null;
    A.handPos(it.pos); it.pos.y += 0.5;
    throwVel(power, it.vel); it.vel.x += astro.vel.x * 0.5; it.vel.z += astro.vel.z * 0.5;
    it.state = 'fly'; it.from = astro.pos.clone(); it.spin = 3 + power * 5;
    astro.carrying = null; astro.throwT = 0.35;
    return it;
  };
  // The arc a throw would follow — the same physics the real throw uses.
  A.trajectory = function (power, pts) {
    A.handPos(v2); v2.y += 0.5; throwVel(power, v3);
    var n = 0, dt = 0.09, x = v2.x, y = v2.y, z = v2.z, vy = v3.y;
    for (var i = 0; i < 110 && n < pts.length; i++) {
      x += v3.x * dt; z += v3.z * dt; vy -= grav * dt; y += vy * dt;
      if (i % 2 === 0) pts[n++].set(x, y, z);
      if (y <= groundAt(x, z) + 0.2) break;
    }
    A.landing = v2.set(x, y, z);
    return n;
  };

  // ---------- dust devils (Mars) ----------
  function buildDevils() {
    A.devils = [];
    if (site !== 'mars') return;
    for (var i = 0; i < 2; i++) {
      var g = new T.Group(), m = new T.MeshBasicMaterial({ color: 0xe2b98c, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false, fog: false });
      for (var k = 0; k < 6; k++) { var c = add(g, new T.CylinderGeometry(1.2 + k * 0.75, 0.6 + k * 0.6, 3.4, 10, 1, true), m, 0, 1.7 + k * 3.3, 0, true); c.userData.k = k; }
      root.add(g);
      A.devils.push({ group: g, pos: new T.Vector3(i ? 90 : -70, 0, i ? 60 : -40), dir: i * 2.5, target: new T.Vector3(), timer: 0, sent: 0 });
    }
  }
  // Somewhere out on the plain, well away from the solar panels (the panels are only crossed when the mission
  // rules send a devil there: see A.sendDevil and sim.planDevil).
  function wanderTarget(d) {
    for (var k = 0; k < 8; k++) {
      var a = Math.random() * 6.28, r = 70 + Math.random() * 60;
      d.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (Math.hypot(d.target.x - Tn.L.solar[0], d.target.z - Tn.L.solar[1]) > 45) return;
    }
  }
  // The mission rules say a dust devil will cross the solar panels in `lead` seconds: bring the nearer devil in
  // from the open plain on a straight line through the panels, so the player sees it happen.
  A.sendDevil = function (lead) {
    if (!A.devils.length) return false;
    var c = Tn.L.solar, d = A.devils[0], a = Math.random() * 6.28, run = Math.max(18, (lead || 9) * 6.5);
    d.pos.set(c[0] + Math.sin(a) * run, 0, c[1] + Math.cos(a) * run);
    d.target.set(c[0] - Math.sin(a) * 40, 0, c[1] - Math.cos(a) * 40);      // straight through the panels and out the other side
    d.dir = Math.atan2(d.target.x - d.pos.x, d.target.z - d.pos.z);
    d.timer = (run + 40) / 6.5; d.sent = d.timer;
    return true;
  };
  function updateDevils(dt) {
    for (var i = 0; i < A.devils.length; i++) {
      var d = A.devils[i];
      d.timer -= dt; d.sent = Math.max(0, d.sent - dt);
      if (d.timer <= 0) { d.timer = 16 + Math.random() * 14; wanderTarget(d); }
      var want = Math.atan2(d.target.x - d.pos.x, d.target.z - d.pos.z);
      d.dir = angLerp(d.dir, want + Math.sin(W.time * 0.7 + i) * (d.sent > 0 ? 0.08 : 0.8), Math.min(1, dt * (d.sent > 0 ? 3 : 0.8)));
      d.pos.x += Math.sin(d.dir) * 6.5 * dt; d.pos.z += Math.cos(d.dir) * 6.5 * dt;
      d.pos.y = Tn.height(d.pos.x, d.pos.z);
      d.group.position.copy(d.pos);
      d.group.children.forEach(function (c) { c.rotation.y += dt * (5 - c.userData.k * 0.5); c.position.x = Math.sin(W.time * 2 + c.userData.k) * 0.3 * c.userData.k; });
      if (Math.random() < dt * 20) W.emit(d.pos.x + (Math.random() - 0.5) * 2, d.pos.y + 0.3, d.pos.z + (Math.random() - 0.5) * 2, { vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 5, vz: (Math.random() - 0.5) * 6, life: 2, size: 0.7, grow: 2.5, color: 0xdba878, alpha: 0.4 });
      if (astro.mode === 'walk' && Math.hypot(d.pos.x - astro.pos.x, d.pos.z - astro.pos.z) < 3) { astro.spin = 1.2; if (A.onDevil) A.onDevil('astro'); }
    }
  }

  // ---------- build ----------
  A.build = function (rootGroup, siteId, suitColor) {
    root = rootGroup; site = siteId; grav = JA.SITES[site].gravity;
    add = W.add; mat = W.mat; soft = W.soft; glow = W.glow;
    A.items = [];
    astro = A.astro = buildAstronaut(suitColor || 0xff7a3d);
    rover = A.rover = buildRover();
    buildDevils();
    A.resetAstro();
    if (A.fp) A.setFirstPerson(true);        // a new world keeps the view you chose
  };
  A.resetAstro = function () {
    var d = B.spots.door;
    astro.pos.set(d.x, groundAt(d.x, d.z + 2.4), d.z + 2.4); astro.vel.set(0, 0, 0); astro.vy = 0; astro.onGround = true; astro.yaw = 0; astro.mode = 'walk';
  };

  // ---------- movement ----------
  // Colliders are circles on the ground with a height: { x, z, r, h } (see js/base.js). After a hit,
  // hitNx / hitNz point the way out of the thing that was hit.
  var hitNx = 0, hitNz = 0;
  function collideCircle(p, r) {
    var C = B.colliders;
    for (var i = 0; i < C.length; i++) {
      var c = C[i], dx = p.x - c.x, dz = p.z - c.z, min = c.r + r;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      var d = Math.hypot(dx, dz);
      if (d < min && d > 0.0001) { hitNx = dx / d; hitNz = dz / d; p.x = c.x + hitNx * min; p.z = c.z + hitNz * min; return c; }
    }
    return null;
  }
  // How high a collider reaches at this spot.
  function topOf(c) {
    if (c.gy == null) c.gy = Tn.height(c.x, c.z);
    return c.gy + (c.h != null ? c.h : 3.4);
  }
  // The rover is a box 2.5 m wide and 4.8 m long. Push a circle out of it; true when it was inside.
  var ROVER_W = 1.25, ROVER_L = 2.4;
  function roverPush(p, rad) {
    var s = Math.sin(rover.yaw), c = Math.cos(rover.yaw), dx = p.x - rover.pos.x, dz = p.z - rover.pos.z;
    var lx = dx * c - dz * s, lz = dx * s + dz * c;          // the same spot in the rover's own left-right and back-front
    var ox = ROVER_W + rad - Math.abs(lx), oz = ROVER_L + rad - Math.abs(lz);
    if (ox <= 0 || oz <= 0) return false;
    if (ox < oz) { var sx = lx < 0 ? -1 : 1; lx += sx * ox; hitNx = sx * c; hitNz = -sx * s; }
    else { var sz = lz < 0 ? -1 : 1; lz += sz * oz; hitNx = sz * s; hitNz = sz * c; }
    p.x = rover.pos.x + lx * c + lz * s; p.z = rover.pos.z - lx * s + lz * c;
    return true;
  }
  // A thing in the air meets what stands in its way: machines, rocks, the round roof of the habitat, the rover,
  // and loose things lying about. px, py, pz: where it was a moment ago.
  function hitThings(it, py) {
    var C = B.colliders, i, c, dx, dz, d, min, top, nx, nz, vn, hit;
    for (i = 0; i < C.length; i++) {
      c = C[i]; dx = it.pos.x - c.x; dz = it.pos.z - c.z; min = c.r + it.r;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      d = Math.hypot(dx, dz); if (d >= min) continue;
      top = topOf(c);
      if (c.dome) {                                   // the habitat: a low ring wall with a round roof on it
        var cy = c.gy + 1.3, ddy = it.pos.y - cy, d3 = Math.hypot(d, Math.max(0, ddy)), R3 = c.dome + it.r;
        if (ddy > 0) {
          if (d3 >= R3 || d3 < 0.001) continue;
          var ax = dx / d3, ay = ddy / d3, az = dz / d3, v3 = it.vel.x * ax + it.vel.y * ay + it.vel.z * az;
          it.pos.x = c.x + ax * R3; it.pos.y = cy + ay * R3; it.pos.z = c.z + az * R3;
          if (v3 < 0) { it.vel.x -= 1.4 * v3 * ax; it.vel.y -= 1.4 * v3 * ay; it.vel.z -= 1.4 * v3 * az; it.spin *= 0.7; if (-v3 > 1.5 && A.onBounce) A.onBounce(it, -v3); }
          return c;
        }
        top = cy;
      }
      if (it.pos.y - it.r >= top) continue;           // it is flying over the top
      nx = d > 0.001 ? dx / d : 1; nz = d > 0.001 ? dz / d : 0;
      if (py - it.r >= top - 0.15) {                  // it came down on top: a small bounce, then it rolls off the edge
        hit = Math.abs(it.vel.y);
        it.pos.y = top + it.r;
        it.vel.y = hit > 1.4 ? hit * 0.3 : 0;
        it.vel.x = it.vel.x * 0.6 + nx * 1.7 - nz * 0.8; it.vel.z = it.vel.z * 0.6 + nz * 1.7 + nx * 0.8;      // outward, and a little sideways so it cannot get caught between two things
        if (hit > 1.4 && A.onBounce) A.onBounce(it, hit);
      } else {                                        // it hit the side: it bounces back
        it.pos.x = c.x + nx * min; it.pos.z = c.z + nz * min;
        vn = it.vel.x * nx + it.vel.z * nz;
        if (vn < 0) { it.vel.x -= 1.45 * vn * nx; it.vel.z -= 1.45 * vn * nz; it.spin *= 0.6; if (-vn > 1.5 && A.onBounce) A.onBounce(it, -vn); }
      }
      return c;
    }
    // the rover: the cab is taller than the cargo bed
    dx = it.pos.x - rover.pos.x; dz = it.pos.z - rover.pos.z;
    if (Math.abs(dx) < 4 && Math.abs(dz) < 4) {
      var front = dx * Math.sin(rover.yaw) + dz * Math.cos(rover.yaw) > 0.2;
      top = rover.pos.y + (front ? 2.3 : 1.3);
      if (it.pos.y - it.r < top) {
        if (py - it.r >= top - 0.15) {
          v1.copy(it.pos);
          if (roverPush(v1, it.r * 0.5)) {
            hit = Math.abs(it.vel.y);
            it.pos.y = top + it.r; it.vel.y = hit > 1.4 ? hit * 0.3 : 0;
            it.vel.x = it.vel.x * 0.6 + hitNx * 1.7; it.vel.z = it.vel.z * 0.6 + hitNz * 1.7;
            if (hit > 1.4 && A.onBounce) A.onBounce(it, hit);
            return rover;
          }
        } else if (roverPush(it.pos, it.r)) {
          vn = it.vel.x * hitNx + it.vel.z * hitNz;
          if (vn < 0) { it.vel.x -= 1.45 * vn * hitNx; it.vel.z -= 1.45 * vn * hitNz; it.spin *= 0.6; if (-vn > 1.5 && A.onBounce) A.onBounce(it, -vn); }
          return rover;
        }
      }
    }
    // a fast throw knocks away a loose thing it lands on
    if (it.vel.lengthSq() > 9) for (i = 0; i < A.items.length; i++) {
      var o = A.items[i];
      if (o === it || o.state !== 'rest') continue;
      if (Math.abs(o.pos.x - it.pos.x) > 1 || Math.abs(o.pos.z - it.pos.z) > 1 || it.pos.distanceTo(o.pos) > it.r + o.r) continue;
      o.state = 'fly'; o.from = null; o.spin = 3;
      o.vel.copy(it.vel).multiplyScalar(0.5); o.vel.y = Math.max(1.4, o.vel.y);
      it.vel.multiplyScalar(0.45);
      if (A.onBounce) A.onBounce(it, 3);
      return o;
    }
    return null;
  }
  // Stay inside a round room and out of its furniture. room: { cx, cz, r, colliders: [{x, z, r}] }
  function roomKeep(p, room, r) {
    var dx = p.x - room.cx, dz = p.z - room.cz, d = Math.hypot(dx, dz), max = room.r - r, i;
    if (d > max) { p.x = room.cx + dx / d * max; p.z = room.cz + dz / d * max; }
    for (i = 0; room.colliders && i < room.colliders.length; i++) {
      var c = room.colliders[i], cx = p.x - c.x, cz = p.z - c.z, cd = Math.hypot(cx, cz), min = c.r + r;
      if (cd < min && cd > 0.0001) { p.x = c.x + cx / cd * min; p.z = c.z + cz / cd * min; }
    }
  }
  function inBounds(p) {
    var r = Math.hypot(p.x, p.z);
    if (r > Tn.PLAY_R) { p.x *= Tn.PLAY_R / r; p.z *= Tn.PLAY_R / r; return false; }
    return true;
  }

  function updateAstro(dt, input) {
    var a = astro, ix = 0, iz = 0, jump = false, sprint = false;
    a.group.visible = a.mode !== 'hidden';
    if (a.mode === 'hidden') return;
    if (a.mode === 'sit') {
      // on the lookout rock (js/observe.js moves him and sets sitK / relaxK / look); while he walks up to the rock
      // the normal walking body is used, so his feet step instead of sliding
      a.group.position.copy(a.pos); a.group.rotation.set(0, a.yaw, 0);
      a.drill.visible = false;
      if (a.sitWalk) poseAstro(a, dt, a.sitWalk > 0.05, false, null); else poseRock(a, dt);
      a.tip.material.emissiveIntensity = 1.2 + Math.sin(W.time * 6);
      return;
    }
    if (a.mode === 'drive') {
      roverLocal(0, 1.3, 0.25, a.pos); a.yaw = a.lastYaw = rover.yaw;
      a.group.position.copy(a.pos); a.group.rotation.set(0, a.yaw, 0);
      a.drill.visible = false;
      poseSeated(a);
      return;
    }
    if (a.mode === 'walk' && input) { ix = input.x; iz = input.z; jump = input.jump; sprint = input.sprint; }
    var len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; len = 1; }
    W.forward(v1);
    var mx = -v1.z * ix - v1.x * iz, mz = v1.x * ix - v1.z * iz;         // camera-relative: right*ix + back*iz
    var speed = (sprint ? 8.8 : 5.8) * (a.carrying ? 0.93 : 1);
    var k = Math.min(1, dt * (a.onGround ? 11 : 1.6));
    a.vel.x += (mx * speed - a.vel.x) * k; a.vel.z += (mz * speed - a.vel.z) * k;
    a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    a.moved += Math.hypot(a.vel.x, a.vel.z) * dt;
    var room = A.room;      // inside the habitat or the rocket: a flat floor, round walls, a ceiling
    if (room) roomKeep(a.pos, room, 0.42);
    else {
      if (!inBounds(a.pos) && A.onEdge) A.onEdge();
      if (collideCircle(a.pos, 0.5)) collideCircle(a.pos, 0.5);
      if (!rover.driver) roverPush(a.pos, 0.42);
    }
    var ground = room ? room.floor : groundAt(a.pos.x, a.pos.z), landed = false;
    if (a.onGround) {
      if (a.pos.y - ground > 0.35) a.onGround = false; else a.pos.y = ground;
      if (jump) {
        a.vy = 3.7; a.onGround = false; a.airT = 0;
        a.runJump = Math.hypot(a.vel.x, a.vel.z) > 2.5 ? 1 : 0;
        a.lead = (a.cyc % 1) >= 0.5 ? -1 : 1;            // the leg that was swinging forward leads the leap
        if (A.onJump) A.onJump();
      }
    }
    if (!a.onGround) {
      a.vy -= grav * dt; a.pos.y += a.vy * dt;
      if (a.pos.y <= ground) {
        var hit = -a.vy; landed = hit > 1.2; a.pos.y = ground; a.vy = 0; a.onGround = true;
        if (landed) { a.landT = 0; a.landK = clamp(hit / 4.5, 0.3, 1) * (a.runJump ? 0.7 : 1); }
      }
      if (room && room.ceil) {                  // a low-gravity jump indoors ends at the ceiling
        var top = room.ceil(a.pos.x, a.pos.z);
        if (a.pos.y > top) { a.pos.y = top; if (a.vy > 0) { a.vy = -0.4; if (A.onBonk) A.onBonk(); } }
      }
    }
    if (landed && A.onLand) A.onLand();
    if (a.aim || a.fp) a.yaw = angLerp(a.yaw, Math.atan2(v1.x, v1.z), Math.min(1, dt * 14));      // in first person the body faces where you look
    else if (len > 0.1) a.yaw = angLerp(a.yaw, Math.atan2(mx, mz), Math.min(1, dt * 12));
    if (a.spin > 0) { a.spin -= dt; a.yaw += dt * 9; }
    a.throwT = Math.max(0, a.throwT - dt);
    a.drill.visible = a.mode === 'busy';
    if (a.mode === 'busy') a.bit.rotation.y += dt * 30;
    poseAstro(a, dt, len > 0.1 && a.mode === 'walk', sprint, room);
    a.group.position.copy(a.pos);
    a.tip.material.emissiveIntensity = 1.2 + Math.sin(W.time * 6);
  }

  // ---------- how the astronaut moves his body ----------
  // All in the model's own units. Each foot has a target: planted on the ground while it carries him (it rolls from heel
  // or forefoot to toes), or lifted on an arc while it swings forward. The hip and knee angles that reach the target come
  // from two-bone IK, so the feet do not skate, the knees bend by themselves and the hips rise and fall like a real
  // walker's. How long a foot stays down follows from his speed and how far a leg can reach; the rest of each step is a
  // free flight that lasts as long as the real Moon or Mars gravity makes it. The arms swing against the legs, the
  // shoulders turn against the hips, and the body leans into speed, into turns and after a landing.
  var GAIT = [      // 0: walk, 1: lope (his normal pace on the Moon and Mars), 2: sprint
    { cad: 0, duty: 0.62, crouch: 0.015, bob: 0.022, lift: 0.07, kick: 0, reach: 0.02, strike: -0.28, roll: 0.55, push: 0.75, zOff: 0, lean: 0.035,
      arm: 0.3, elbow: -0.3, pump: 0.1, yaw: 0.07, sway: 0.022, tilt: 0.035 },
    { cad: 1.7, duty: 0.36, crouch: 0.05, bob: 0, lift: 0.15, kick: 0.12, reach: 0.06, strike: -0.06, roll: 0.35, push: 0.95, zOff: -0.03, lean: 0.09,
      arm: 0.5, elbow: -0.95, pump: 0.25, yaw: 0.09, sway: 0.012, tilt: 0.02 },
    { cad: 1.55, duty: 0.3, crouch: 0.085, bob: 0, lift: 0.24, kick: 0.26, reach: 0.1, strike: 0.08, roll: 0.3, push: 1.05, zOff: -0.05, lean: 0.24,
      arm: 0.95, elbow: -1.45, pump: 0.3, yaw: 0.12, sway: 0.008, tilt: 0.015 }
  ];
  var G = {}, f0 = {}, f1 = {}, ik = {}, vF = new T.Vector3(), FT = [{}, {}];
  function gaitAt(s) {
    var i = s >= 1 ? 1 : 0, t = clamp(s - i, 0, 1), A0 = GAIT[i], A1 = GAIT[i + 1];
    for (var k in A0) G[k] = lerp(A0[k], A1[k], t);
    return G;
  }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // a planted foot at roll stage u (0 = touch-down, 1 = push-off) whose ankle would be at z when flat:
  // out.z, out.y = the ankle (forward of the hip, above the ground), out.p = foot pitch (+ = toes down)
  function plantedFoot(z, u, out) {
    var p = u < 0.15 ? G.strike * (1 - u / 0.15) : u > G.roll ? G.push * Math.pow((u - G.roll) / (1 - G.roll), 1.6) : 0;
    var px = p < 0 ? RIG.heel : RIG.toe, c = Math.cos(p), s = Math.sin(p), dz = -px;      // it rocks on the heel or on the toes
    out.z = z + px + ANK * s + dz * c; out.y = ANK * c - dz * s; out.p = p;
    return out;
  }
  // one foot at leg phase ph of the stride cycle (stance first, then swing); D = how far the foot travels while planted
  function footAt(ph, D, duty, out) {
    if (ph < duty) { var u = ph / duty; plantedFoot(D * (0.5 - u) + G.zOff, u, out); out.down = true; return out; }
    var s = (ph - duty) / (1 - duty), e = smooth(s), kickT = Math.sin(Math.PI * Math.min(1, s / 0.6));
    plantedFoot(-D * 0.5 + G.zOff, 1, f0); plantedFoot(D * 0.5 + G.zOff, 0, f1);
    out.z = lerp(f0.z, f1.z, e) - G.kick * 0.5 * kickT + G.reach * Math.sin(Math.PI * clamp((s - 0.35) / 0.65, 0, 1));
    out.y = lerp(f0.y, f1.y, s) + G.lift * Math.pow(Math.sin(Math.PI * s), 0.8) + G.kick * kickT;      // the heel kicks up behind, then the knee drives forward
    out.p = lerp(f0.p, f1.p, e) + G.kick * 1.4 * Math.sin(Math.PI * Math.min(1, s / 0.5));
    out.down = false;
    return out;
  }
  // two-bone IK in the leg's side plane: the ankle target (z forward, y up) seen from the hip joint.
  // Angles are rotation.x values: 0 = straight down, negative = forward. The knee always bends forward.
  function legIK(z, y, out) {
    var d = Math.hypot(z, y), max = (L1 + L2) * 0.999, min = 0.2;
    if (d > max) { z *= max / d; y *= max / d; d = max; } else if (d < min) { z *= min / d; y *= min / d; d = min; }
    var phi = Math.atan2(-z, -y);
    var a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), b = Math.acos(clamp((L2 * L2 + d * d - L1 * L1) / (2 * L2 * d), -1, 1));
    out.hip = phi - a; out.knee = a + b;
    return out;
  }
  function poseAstro(a, dt, moving, sprint, room) {
    var S = RIG.scale, t = W.time, gm = grav / S, k6 = Math.min(1, dt * 6), i, f;
    var busy = a.mode === 'busy', v = Math.hypot(a.vel.x, a.vel.z) / S;
    if (dt > 0) a.accel = lerp(a.accel, (v - a.spd) / dt, k6);
    a.spd = v;
    // which gait: walk when slow, a light low-gravity lope at the normal pace, a long bounding run when sprinting
    var want = clamp((v - 1.2) / 5.7, 0, 1) * 0.6;
    if (sprint && moving) want = Math.max(want, 0.6 + clamp((v - 6.9) / 3.6, 0, 1) * 1.4);
    a.gait = lerp(a.gait, want, Math.min(1, dt * 4));
    gaitAt(a.gait);
    var mv = smooth((v - 0.12) / 0.9);
    if (mv > 0.02 && a.move <= 0.02 && a.onGround) a.cyc = G.duty + 0.02;       // set off with the left foot
    a.move = busy ? 0 : mv;
    var gf = clamp(Math.sqrt(grav / 3.71), 0.62, 1.2);                          // lower gravity: slower, floatier strides
    var cad = (1 - Math.min(a.gait, 1)) * clamp(v / 0.95, 0.6, 1.6) + G.cad * gf;
    var D = Math.min(0.62, v * G.duty / cad), duty = v > 0.05 ? clamp(D * cad / v, 0.12, G.duty) : G.duty;
    if (a.onGround && a.move > 0.01) a.cyc = (a.cyc + cad * dt) % 1;
    // ---- in the air
    if (!a.onGround) a.airT += dt; else a.airT = 0;
    a.air = lerp(a.air, !a.onGround && (a.vy > 0 || a.airT > 0.08) ? 1 : 0, Math.min(1, dt * 14));
    var kv = clamp(a.vy / 3.7, -1.2, 1), up = clamp(kv, 0, 1), down = clamp(-kv / 0.7, 0, 1);
    var tuck = clamp(1 - Math.abs(kv - 0.25) / 0.85, 0, 1), push = clamp((kv - 0.8) / 0.2, 0, 1);
    // ---- the hips: height above the ground
    var cyc2 = Math.PI * 2 * a.cyc, mw = a.move * (1 - a.air);
    var bobW = G.bob * Math.cos(2 * cyc2 - Math.PI * duty);                      // walking: highest over the planted foot
    var sig = Math.min(0.98, 2 * duty), Ts = 0.5 / cad, psi = (2 * a.cyc) % 1, Tf = (1 - sig) * Ts, vz = gm * Tf / 2, bobR;
    if (psi < sig) bobR = -Math.max(vz * sig * Ts / Math.PI, 0.012 + 0.02 * a.gait) * Math.sin(Math.PI * psi / sig);   // running: a spring...
    else { var tt = (psi - sig) * Ts; bobR = vz * tt - gm * tt * tt / 2; }                                              // ...then a free flight
    var hipH = lerp(RIG.hipY - 0.018 + 0.004 * Math.sin(t * 1.7), RIG.hipY - G.crouch + lerp(bobW, bobR, clamp((0.55 - duty) / 0.13, 0, 1)), a.move);
    if (busy) hipH = RIG.hipY - 0.07;
    a.landT += dt;
    var dip = a.landT < 1 ? a.landK * 0.17 * (a.landT < 0.1 ? Math.sin(a.landT / 0.1 * Math.PI / 2) : Math.exp(-(a.landT - 0.1) * 7)) : 0;
    hipH -= dip;
    // ---- the feet on the ground (standing feet sit a little apart; a drilling stance is wider and staggered)
    var sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    for (i = 0; i < 2; i++) {
      f = footAt((a.cyc + i * 0.5) % 1, D, duty, FT[i]);
      var iz = busy ? (i ? -0.12 : 0.1) : (i ? -0.02 : 0.02);
      f.z = lerp(iz, f.z, a.move); f.y = lerp(ANK, f.y, a.move); f.p = lerp(0, f.p, a.move); f.down = f.down || a.move < 0.6;
      // follow the ground under each foot
      var side = (i ? 1 : -1) * RIG.hipX * S, fx = a.pos.x + sy * f.z * S + cy * side, fz = a.pos.z + cy * f.z * S - sy * side;
      f.g = room || !a.onGround ? 0 : clamp((groundAt(fx, fz) - a.pos.y) / S, -0.3, 0.3);
      if (f.down && a.onGround) hipH = Math.min(hipH, f.y + f.g + Math.sqrt(Math.max(0, 0.7 * 0.7 - f.z * f.z)));      // a planted foot must stay reachable
      // a footstep the moment a foot comes down
      var ph = (a.cyc + i * 0.5) % 1;
      if (ph < a.legPh[i] && a.onGround && a.move > 0.4 && A.onStep) {
        var fs = (D * 0.5 + G.zOff) * S;
        A.onStep(vF.set(a.pos.x + sy * fs, a.pos.y, a.pos.z + cy * fs), a.yaw, i ? 1 : -1, sprint);
      }
      a.legPh[i] = ph;
    }
    hipH = lerp(hipH, RIG.hipY - 0.03, a.air);
    // ---- hips and body: twist, sway, tilt, lean, bank into turns
    var pYaw = G.yaw * Math.cos(cyc2) * mw;
    var sway = -G.sway * Math.cos(cyc2 - Math.PI * duty) * mw + 0.01 * Math.sin(t * 0.45) * (1 - a.move);
    var tilt = -G.tilt * Math.cos(cyc2 - Math.PI * duty) * mw;
    a.hips.position.set(sway, hipH, 0); a.hips.rotation.set(0, pYaw, tilt);
    a.headY = (hipH - RIG.hipY) * S;
    var turn = dt > 0 ? angLerp(0, a.yaw - a.lastYaw, 1) / dt : 0; a.lastYaw = a.yaw;
    a.bank = lerp(a.bank, a.spin > 0 || a.fp ? 0 : clamp(-turn * v * S * 0.03, -0.22, 0.22) * (1 - a.air), k6);
    a.group.rotation.set(0, a.yaw, a.bank);
    var lean = lerp(0.015 + 0.01 * Math.sin(t * 1.7), G.lean, a.move) + clamp(a.accel * 0.012, -0.1, 0.14) * (1 - a.air) + dip * 1.1;
    lean += a.air * (a.runJump ? 0.12 - 0.1 * up : -0.06 * up + 0.1 * down);
    // ---- the legs: planted/swinging targets, or the shapes of a jump, then IK
    var legs = [[a.legL, a.shinL, a.footL], [a.legR, a.shinR, a.footR]];
    for (i = 0; i < 2; i++) {
      f = FT[i];
      var sx = i ? 1 : -1, hx = sx * RIG.hipX;
      var pz = f.z + hx * Math.sin(pYaw), py = f.y + f.g - hipH, pp = f.p;
      if (a.air > 0.001) {
        var az, ay, ap;
        if (a.runJump) {
          var lead = sx === a.lead;
          az = lead ? 0.3 - down * 0.2 : -0.3 + down * 0.42; ay = lead ? -0.6 - down * 0.18 : -0.62 - down * 0.16; ap = lead ? -0.05 : 0.7 - down * 0.72;
        } else {
          az = 0.04 + tuck * (i ? 0.08 : 0.15) + down * 0.06; ay = -0.8 + tuck * 0.28 - push * 0.05; ap = 0.3 + push * 0.4 - down * 0.45;
        }
        pz = lerp(pz, az, a.air); py = lerp(py, ay, a.air); pp = lerp(pp, ap, a.air);
      }
      legIK(pz, py, ik);
      var spl = sx * (busy ? 0.08 : 0.03) - tilt - sway / 0.72;
      legs[i][0].rotation.set(ik.hip, -pYaw, spl);
      legs[i][1].rotation.set(ik.knee, 0, 0);
      legs[i][2].rotation.set(pp - ik.hip - ik.knee, 0, -spl * 0.8);
    }
    // ---- the arms: swing against the legs (elbows bend more the faster he goes), or hold, aim, throw, drill
    var sw = Math.cos(cyc2) * G.arm * mw, arms = [[a.armL, a.foreL, a.handL], [a.armR, a.foreR, a.handR]];
    for (i = 0; i < 2; i++) {
      var sg = i ? -1 : 1, out = i ? 1 : -1;                                    // sg: + = this arm swings back when the left foot is forward
      var ax = -0.06 + sg * sw, el = lerp(-0.2, G.elbow, a.move) - G.pump * mw * (1 - sg * Math.cos(cyc2)) / 2, azr = out * (0.2 + 0.06 * a.gait), hand = -0.15;
      ax += 0.015 * Math.sin(t * 1.7) * (1 - a.move);
      if (a.air > 0.001) {
        var bx, bz, be;
        if (a.runJump) { var fwd = (i ? 1 : -1) !== a.lead; bx = fwd ? -1.5 + down * 0.6 : 0.55 - down * 0.4; be = -0.9; bz = out * (0.3 + 0.4 * down); }
        else { bx = lerp(-0.35, -2.15, up) * (1 - down) + down * -0.55; be = -0.35 - 0.35 * tuck; bz = out * (0.3 + 0.85 * down); }
        ax = lerp(ax, bx, a.air); el = lerp(el, be, a.air); azr = lerp(azr, bz, a.air);
      }
      ax -= dip * 1.6; el -= dip * 0.8;
      if (busy) { ax = -0.95 + Math.sin(t * 40) * 0.04; el = -0.7; azr = -out * 0.3; hand = -0.3; }
      else if (a.throwT > 0) { var kk = a.throwT / 0.35; ax = -0.35 - 2.3 * kk; el = -0.9 * kk; azr = -out * 0.2; hand = -0.4 * kk; }
      else if (a.carrying) { ax = a.aim ? -2.05 : -1.0; el = a.aim ? -0.5 : -0.55; azr = -out * 0.28; hand = -0.35; }
      arms[i][0].rotation.set(ax, 0, azr); arms[i][1].rotation.set(el, 0, 0); arms[i][2].rotation.set(hand, 0, 0);
    }
    if (busy) lean = 0.2;
    else if (a.throwT > 0) lean = 0.22 * Math.sin(Math.PI * (1 - a.throwT / 0.35)) + 0.05;
    else if (a.carrying && a.aim) lean = -0.12;
    a.body.rotation.set(lean, -pYaw * 1.6, -tilt * 0.85);
  }
  // sitting in the rover: thighs on the seat, shins down, hands toward the wheel
  function poseSeated(a) {
    a.hips.position.set(0, RIG.hipY - 0.12, 0); a.hips.rotation.set(0, 0, 0); a.headY = 0; a.air = 0; a.move = 0; a.bank = 0;
    a.legL.rotation.set(-1.5, 0, -0.06); a.legR.rotation.set(-1.5, 0, 0.06);
    a.shinL.rotation.set(1.42, 0, 0); a.shinR.rotation.set(1.42, 0, 0); a.footL.rotation.set(0.08, 0, 0); a.footR.rotation.set(0.08, 0, 0);
    a.body.rotation.set(0.04, 0, 0);
    a.armL.rotation.set(-1.05, 0, 0.12); a.armR.rotation.set(-1.05, 0, -0.12);
    a.foreL.rotation.set(-0.45, 0, 0); a.foreR.rotation.set(-0.45, 0, 0); a.handL.rotation.set(-0.2, 0, 0); a.handR.rotation.set(-0.2, 0, 0);
  }

  // sitting on a rock: sitK 0 = standing, 1 = seated (thighs forward, shins hanging); relaxK leans him back on his
  // hands; look (radians) turns his shoulders and helmet a little toward where the player is looking. He breathes.
  function poseRock(a, dt) {
    var k = a.sitK || 0, r = a.relaxK || 0, br = Math.sin(W.time * 1.45) * (0.4 + 0.6 * k), look = Math.max(-0.5, Math.min(0.5, a.look || 0));
    a.headY = 0; a.air = 0; a.move = 0; a.bank = 0;
    a.hips.position.set(0, RIG.hipY, 0); a.hips.rotation.set(0, 0, 0);
    a.legL.rotation.set(lerp(0, -1.32, k), 0, -0.1 * k); a.legR.rotation.set(lerp(0, -1.26, k), 0, 0.12 * k);
    a.shinL.rotation.set(lerp(0, 1.22, k), 0, 0); a.shinR.rotation.set(lerp(0, 1.08, k), 0, 0);
    a.footL.rotation.set(0.12 * k, 0, 0.05 * k); a.footR.rotation.set(0.2 * k, 0, -0.05 * k);
    a.body.rotation.set(lerp(0.06 * k, -0.15, r) + br * 0.012, look * 0.55, 0);
    for (var i = 0; i < 2; i++) {
      var out = i ? 1 : -1, arm = i ? a.armR : a.armL, fore = i ? a.foreR : a.foreL, hand = i ? a.handR : a.handL;
      // standing: arms down; sitting: hands on the knees; relaxed: leaning back on the hands, palms on the rock
      var ax = lerp(lerp(-0.06, -0.62, k), 0.62, r), el = lerp(lerp(-0.2, -0.55, k), -0.12, r), az = out * lerp(lerp(0.2, 0.12, k), 0.34, r);
      arm.rotation.set(ax + br * 0.01, 0, az); fore.rotation.set(el, 0, 0); hand.rotation.set(lerp(-0.15, 0.7, r), 0, 0);
    }
  }

  function updateRover(dt, input) {
    var r = rover, thr = 0, steer = 0;
    if (r.driver && input) { thr = -input.z; steer = input.x; }
    var stuck = !!(A.roverStuck && A.roverStuck());
    if (stuck) { thr = 0; r.speed *= Math.max(0, 1 - dt * 6); }
    r.sink = lerp(r.sink || 0, stuck ? 0.5 : 0, Math.min(1, dt * 2));
    var charged = !A.roverCharge || A.roverCharge() > 0;
    var max = thr >= 0 ? (charged ? 13.5 : 3) : 5;
    if (thr !== 0 && Math.abs(r.speed) < max) r.speed += thr * 9 * dt * (r.onGround ? 1 : 0.2);
    r.speed -= r.speed * (thr === 0 ? 1.6 : 0.25) * dt;
    if (Math.abs(r.speed) > max) r.speed = lerp(r.speed, Math.sign(r.speed) * max, Math.min(1, dt * 3));
    if (r.onGround) r.yaw -= steer * 1.7 * dt * clamp(r.speed / 4.5, -1, 1);
    var s = Math.sin(r.yaw), c = Math.cos(r.yaw);
    r.pos.x += s * r.speed * dt; r.pos.z += c * r.speed * dt;
    if (!inBounds(r.pos)) r.speed *= 0.5;
    // What the rover hits stops it, and a fast hit throws it back. The rover is two circles, front and back.
    var hit = null, into = 0, e;
    for (e = -1; e <= 1; e += 2) {
      v1.set(r.pos.x + s * 1.1 * e, 0, r.pos.z + c * 1.1 * e); v2.copy(v1);
      var col = collideCircle(v1, 1.4);
      if (!col) continue;
      r.pos.x += v1.x - v2.x; r.pos.z += v1.z - v2.z;
      var vin = -(s * hitNx + c * hitNz) * r.speed;           // how fast it was going INTO the thing
      if (!hit || vin > into) { hit = col; into = vin; }
    }
    r.crashT = Math.max(0, (r.crashT || 0) - dt);
    if (hit && into > 0) {
      var share = clamp(into / Math.max(0.01, Math.abs(r.speed)), 0, 1);      // 1 = straight into it, 0 = sliding along it
      if (into > R.crashSoft && r.crashT <= 0) {
        var before = r.speed;
        r.speed = -before * 0.35 * share + before * (1 - share) * 0.6;       // head-on it bounces back; at an angle it scrapes past
        r.crashT = 0.7; r.pitch += 0.2 * (before > 0 ? 1 : -1) * Math.min(1, into / 9);
        if (A.onCrash) A.onCrash(into, hit, before);
      } else r.speed *= 1 - Math.min(0.9, share * dt * 9);
    }
    // loose things lying in its way are knocked aside
    if (Math.abs(r.speed) > 1.5) for (e = 0; e < A.items.length; e++) {
      var loose = A.items[e];
      if (loose.state !== 'rest' || Math.abs(loose.pos.x - r.pos.x) > 4 || Math.abs(loose.pos.z - r.pos.z) > 4 || loose.pos.y - r.pos.y > 2) continue;
      if (!roverPush(loose.pos, loose.r)) continue;
      loose.state = 'fly'; loose.from = null; loose.spin = 4;
      loose.vel.set(s * r.speed * 0.9 + hitNx * 2, 2.2, c * r.speed * 0.9 + hitNz * 2);
      if (A.onBounce) A.onBounce(loose, 3);
    }
    var gnd = groundAt(r.pos.x, r.pos.z);
    r.vy -= grav * dt; r.pos.y += r.vy * dt;
    if (r.pos.y <= gnd) {
      if (!r.onGround && r.vy < -3) { W.dust(r.pos.x, r.pos.z, 14, 3.5, 0.8); if (A.onLand) A.onLand(true); }
      r.vy = clamp((gnd - r.lastGnd) / Math.max(dt, 0.001), 0, 8);
      r.pos.y = gnd; r.onGround = true;
    } else r.onGround = r.pos.y - gnd < 0.12;
    r.lastGnd = gnd;
    var hf = groundAt(r.pos.x + s * 1.8, r.pos.z + c * 1.8), hb = groundAt(r.pos.x - s * 1.8, r.pos.z - c * 1.8);
    var hl = groundAt(r.pos.x - c * 1.2, r.pos.z + s * 1.2), hr = groundAt(r.pos.x + c * 1.2, r.pos.z - s * 1.2);
    var k = Math.min(1, dt * (r.onGround ? 8 : 1.5));
    r.pitch = lerp(r.pitch, r.onGround ? Math.atan2(hb - hf, 3.6) : r.pitch, k);
    r.roll = lerp(r.roll, r.onGround ? Math.atan2(hr - hl, 2.4) : r.roll, k);
    r.group.position.copy(r.pos); r.group.position.y -= r.sink;
    r.group.rotation.set(0, 0, 0); r.group.rotateY(r.yaw); r.group.rotateX(r.pitch + r.sink * 0.16); r.group.rotateZ(r.roll);
    for (var i = 0; i < r.wheels.length; i++) { r.wheels[i].rotation.x += r.speed * dt / 0.62; if (i >= 4) r.wheels[i].rotation.y = -steer * 0.35; }
    var mv = Math.abs(r.speed);
    if (r.onGround && mv > 2) {
      if (Math.random() < dt * mv * 2.2) W.dust(r.pos.x - s * 2 + (Math.random() - 0.5) * 2, r.pos.z - c * 2 + (Math.random() - 0.5) * 2, 1, 1.5, 0.7);
      r.trackD += mv * dt;
      if (r.trackD > 1.1) { r.trackD = 0; W.print(r.pos.x - c * 1.25, r.pos.z + s * 1.25, r.yaw, 0.42, 1.2); W.print(r.pos.x + c * 1.25, r.pos.z - s * 1.25, r.yaw, 0.42, 1.2); }
    }
    r.light.intensity = lerp(r.light.intensity, r.driver ? 0.6 + W.env.dark * 2.4 : 0, Math.min(1, dt * 4));
    r.ring.material.emissiveIntensity = charged ? 0.6 : 1 + Math.sin(W.time * 6);
    r.ring.material.color.set(charged ? 0x46ff8a : 0xffd23f); r.ring.material.emissive.copy(r.ring.material.color);
  }

  function updateItems(dt) {
    for (var i = 0; i < A.items.length; i++) {
      var it = A.items[i];
      it.age += dt;
      if (it.state === 'held') {
        A.handPos(it.pos);
        if (astro.aim) it.pos.y += astro.fp ? 0.12 : 0.5;
        it.mesh.rotation.set(0, astro.yaw, 0);
      } else if (it.state === 'bed') {
        var b = BED[it.slot]; roverLocal(b[0], b[1], b[2], it.pos);
        it.mesh.rotation.set(0, rover.yaw, 0);
      } else if (it.state === 'fly') {
        var py = it.pos.y;
        it.vel.y -= grav * dt;
        it.pos.addScaledVector(it.vel, dt);
        it.mesh.rotation.x += it.spin * dt; it.mesh.rotation.z += it.spin * 0.6 * dt;
        // it bounces off whatever stands in its way, unless it is dropping into the very place that takes it (A.skipHit, set by the game)
        if (!(A.skipHit && A.skipHit(it))) hitThings(it, py);
        var gnd = groundAt(it.pos.x, it.pos.z) + it.r;
        if (it.pos.y <= gnd) {
          it.pos.y = gnd;
          var hit = Math.abs(it.vel.y);
          if (hit > 1.1) { it.vel.y = hit * 0.3; it.vel.x *= 0.55; it.vel.z *= 0.55; it.spin *= 0.5; if (A.onBounce) A.onBounce(it, hit); }
          else { it.state = 'rest'; it.vel.set(0, 0, 0); it.from = null; it.mesh.rotation.set(0, it.mesh.rotation.y, 0); }
        }
        if (Math.hypot(it.pos.x, it.pos.z) > Tn.PLAY_R + 6) { it.vel.x *= -0.4; it.vel.z *= -0.4; inBounds(it.pos); }
      } else if (it.state === 'fixed') {
        it.mesh.rotation.y += dt * 0.8;
      }
      it.mesh.position.copy(it.pos);
      // helmet view: what you carry sits small in the corner of your eye instead of filling the visor
      if (it.state === 'held' && astro.fp) {
        it.mesh.position.x -= Math.cos(astro.yaw) * 0.4; it.mesh.position.z += Math.sin(astro.yaw) * 0.4; it.mesh.position.y -= 0.14;
        if (!it.small) { it.small = true; it.mesh.scale.setScalar(0.5); }
      } else if (it.small) { it.small = false; it.mesh.scale.setScalar(1); }
    }
  }

  A.update = function (dt, input) {
    if (!astro) return;
    updateRover(dt, input);
    updateAstro(dt, rover.driver ? null : input);
    updateItems(dt);
    updateDevils(dt);
    // the helmet lamp
    var f = astro.mode === 'hidden' ? null : astro.pos;
    if (f) W.setLamp(f.x, f.y + 2.1, f.z, Math.sin(astro.yaw), Math.cos(astro.yaw));
  };

  A.enterRover = function () { rover.driver = true; astro.mode = 'drive'; astro.vel.set(0, 0, 0); };
  A.exitRover = function () {
    rover.driver = false; astro.mode = 'walk';
    A.roverSpot('door', astro.pos); astro.pos.y = groundAt(astro.pos.x, astro.pos.z); astro.vy = 0; astro.onGround = true;
  };
  // ---------- first-person view ----------
  A.eye = function (out) {
    var p = astro.group.position, s = Math.sin(astro.yaw), c = Math.cos(astro.yaw);
    // lower when sitting in the rover; walking, the head rises and falls with the hips
    return out.set(p.x + s * 0.12, p.y + (astro.mode === 'drive' ? 1.2 : 1.7 + astro.headY), p.z + c * 0.12);
  };
  // In first person your own helmet, chest and hips must not block the view, but they still have to throw a shadow.
  // So they swap to a material that draws nothing and still casts shadows. Arms and legs stay visible.
  var ghost = null;
  A.setFirstPerson = function (on) {
    A.fp = !!on;
    if (!astro) return;
    astro.fp = A.fp;
    if (!ghost) ghost = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    var keep = [astro.armL, astro.armR, astro.legL, astro.legR, astro.drill, astro.body];
    astro.body.children.concat(astro.hips.children).forEach(function (part) {
      if (keep.indexOf(part) >= 0) return;
      part.traverse(function (o) {
        if (!o.isMesh) return;
        if (A.fp) { if (!o.userData.seen) o.userData.seen = o.material; o.material = ghost; }
        else if (o.userData.seen) { o.material = o.userData.seen; o.userData.seen = null; }
      });
    });
  };
  A.focus = function (out) {
    if (rover.driver) return out.set(rover.pos.x, rover.pos.y + 2.4, rover.pos.z);
    return out.set(astro.pos.x, astro.pos.y + 1.7, astro.pos.z);
  };
})(window.JA);
