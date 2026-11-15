/* Astro Outpost — the outpost grows into a settlement.
   Keep the outpost going and Earth sends ships. On the flat plain north-east of the habitat
   (Tn.L.colony) a settlement grows in five stages, each one further out from the middle:
     1. a cargo lander from Earth, crates, a pressurised garage and a rover
     2. the first settlers: an inflatable home, a pink greenhouse dome, people walking about
     3. a small town: linked modules, a solar farm, a landing pad with a shuttle, a welcome sign
     4. a growing town (18 to 31 m out): a passenger ferry, three more homes, a school, a farm of
        greenhouse tunnels, water and oxygen tanks, a comms mast, lit streets and parked rovers
     5. the first city (24 to 35 m out): a spaceport with a launch tower, a park under a clear dome,
        a tower of homes, a town square, more solar panels and a ring road with a little tram
   The side that faces the outpost (colony +z) stays open, so you can always walk or drive in.
   After a win, JA.colony.vision() flies the camera over an imagined future of the same place,
   10, 30 and 100 years later. The captions stick to real science and say that the future is imagined.
   Parts are baked into a few meshes per building and repeated parts use InstancedMesh, so the
   whole town costs few draw calls. There are no light objects: windows glow with emissive colour. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain;
  var K = JA.colony = {
    build: function () {}, setStage: function () {}, stage: function () { return 0; },
    update: function () {}, info: function () { return null; }, vision: function () { return false; }, people: function () { return 0; }
  };
  if (!T) return;

  var TOWN = { moon: 'Rimlight', mars: 'New Arcadia' };
  var LAST = 5, PEOPLE = [0, 0, 4, 12, 30, 80];      // the last stage, and how many people live there at each stage
  var site = 'mars', grp = null, h0 = 0, CX = 40, CZ = -62, ROT = 0, cosR = 1, sinR = 0;
  var M = null, G = null, units = [], stageNow = 0, arr = null, tm = 0, men = null, fields = [], fx = null, warned = false;
  var tram = null, signT = null, popNow = PEOPLE[3];
  var v1 = new T.Vector3(), p1 = new T.Vector3(), s1 = new T.Vector3(), q1 = new T.Quaternion(), e1 = new T.Euler(), cTmp = new T.Color();

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function pop(u) { u = clamp(u, 0, 1) - 1; return 1 + u * u * (2.7 * u + 1.7); }        // overshoots a little, then settles
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function warn(e) { if (!warned && window.console) { warned = true; console.warn('Astro Outpost colony:', e); } }
  // colony coordinates (x to the right, z toward the outpost) to world coordinates
  function wx(x, z) { return CX + x * cosR + z * sinR; }
  function wz(x, z) { return CZ - x * sinR + z * cosR; }
  function lx(x, z) { return (x - CX) * cosR - (z - CZ) * sinR; }
  function lz(x, z) { return (x - CX) * sinR + (z - CZ) * cosR; }

  // a placement: position, rotation (yaw last) and scale
  function mx(x, y, z, rx, ry, rz, sx, sy, sz) {
    var a = sx == null ? 1 : sx;
    e1.set(rx || 0, ry || 0, rz || 0, 'YXZ'); q1.setFromEuler(e1);
    s1.set(a, sy == null ? a : sy, sz == null ? a : sz);
    return new T.Matrix4().compose(p1.set(x, y, z), q1, s1);
  }

  // ---------- baking many parts into one mesh per material ----------
  function merge(list, withColor) {
    var parts = [], n = 0;
    list.forEach(function (it) {
      var g = it.g.index ? it.g.toNonIndexed() : it.g.clone();
      g.applyMatrix4(it.m); parts.push({ g: g, c: it.c }); n += g.attributes.position.count;
    });
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = withColor ? new Float32Array(n * 3) : null, o = 0;
    parts.forEach(function (p) {
      var a = p.g.attributes, c = a.position.count, i;
      pos.set(a.position.array, o * 3);
      if (a.normal) nor.set(a.normal.array, o * 3);
      if (a.uv) uv.set(a.uv.array, o * 2);
      if (col) { cTmp.set(p.c); for (i = o; i < o + c; i++) { col[i * 3] = cTmp.r; col[i * 3 + 1] = cTmp.g; col[i * 3 + 2] = cTmp.b; } }
      o += c; p.g.dispose();
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
  function Kit() { this.by = {}; this.base = null; }
  // base: an optional placement for a whole group of parts (a lamp post, a parked rover)
  Kit.prototype.put = function (kind, geo, m, color) {
    if (this.base) m = this.base.clone().multiply(m);
    (this.by[kind] || (this.by[kind] = [])).push({ g: geo, m: m, c: color == null ? 0xffffff : color });
    return this;
  };
  Kit.prototype.bake = function (parent, mats) {
    var self = this, out = [];
    mats = mats || M;
    Object.keys(this.by).forEach(function (kind) {
      var m = mats[kind], mesh = new T.Mesh(merge(self.by[kind], !!m.vertexColors), m);
      if (!m.userData.noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
      parent.add(mesh); out.push(mesh);
    });
    this.by = {};
    return out;
  };

  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
    t.userData.redraw = function () { draw(c.getContext('2d'), w, h); t.needsUpdate = true; };
    return t;
  }
  function glowMat(color, i) { var m = W.glow(color, i); m.userData.noShadow = true; return m; }
  function addMat(color, opacity) {
    var m = new T.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, blending: T.AdditiveBlending, depthWrite: false, fog: false, side: T.DoubleSide });
    m.userData.noShadow = true; return m;
  }

  function makeGeos() {
    return {
      box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(1, 1, 1, 20), cyl8: new T.CylinderGeometry(1, 1, 1, 8),
      cyl6: new T.CylinderGeometry(1, 1, 1, 6), ball: new T.SphereGeometry(1, 14, 10), lump: new T.SphereGeometry(1, 7, 5),
      dome: new T.SphereGeometry(1, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), facet: new T.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      cone: new T.ConeGeometry(1, 1, 18), cone6: new T.ConeGeometry(1, 1, 6), bell: new T.CylinderGeometry(0.42, 1, 1, 18, 1, true),
      ring: new T.TorusGeometry(1, 0.06, 6, 30), arch: new T.TorusGeometry(1, 0.05, 6, 20, Math.PI), flame: new T.ConeGeometry(1, 1, 14, 1, true),
      hoop: new T.TorusGeometry(1, 0.02, 5, 40), rib: new T.TorusGeometry(1, 0.02, 5, 26, Math.PI),        // thin ones, for a big dome
      dot: new T.SphereGeometry(1, 12, 6), band: new T.TorusGeometry(1, 0.06, 4, 20),                      // cheap ones, for the many small windows, lights and hoops
      disc: new T.CylinderGeometry(1, 1, 1, 40),                                                           // a rounder one, for wide floors
      tunnel: new T.CylinderGeometry(1, 1, 1, 14, 1, true, 0, Math.PI)                                     // half a pipe: a greenhouse roof
    };
  }
  function makeMats() {
    var solarTex = W.canvasTex(128, function (ctx, s) {
      ctx.fillStyle = '#14306b'; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#6fa3ff'; ctx.lineWidth = 2;
      for (var i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * s / 4, 0); ctx.lineTo(i * s / 4, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s / 4); ctx.lineTo(s, i * s / 4); ctx.stroke(); }
    });
    var glowTex = W.canvasTex(128, function (ctx, s) {
      var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    var m = {
      soft: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.05 }),
      rough: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.02, flatShading: true }),
      metal: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.72, side: T.DoubleSide }),
      gold: new T.MeshStandardMaterial({ color: 0xe3ad42, roughness: 0.34, metalness: 0.85, flatShading: true, emissive: 0x3a2600, emissiveIntensity: 0.45 }),
      white: W.soft(0xf5f6fa), helmet: W.soft(0xffffff, { roughness: 0.4 }),
      visor: new T.MeshStandardMaterial({ color: 0xffc64a, metalness: 0.95, roughness: 0.12, emissive: 0x6b4a08, emissiveIntensity: 0.35 }),
      win: glowMat(0xffd98a, 1.5), pink: glowMat(0xff5fd0, 1.9), cyan: glowMat(0x7fe8ff, 1.5), green: glowMat(0x4dff9a, 1.6),
      amber: glowMat(0xffb84d, 1.6), ring: glowMat(0xffd23f, 1.2), blink: glowMat(0xff4a4a, 2), blink2: glowMat(0x46ff8a, 2),
      glass: new T.MeshStandardMaterial({ color: 0xffd6f4, transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.1, emissive: 0xff5fd0, emissiveIntensity: 0.3, depthWrite: false, side: T.DoubleSide }),
      haze: addMat(0xff4fc8, 0.2),
      // the park dome: clear, a little blue, like a shell of ice
      ice: new T.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.24, roughness: 0.05, metalness: 0.2, emissive: 0x7fc4ff, emissiveIntensity: 0.22, depthWrite: false, side: T.DoubleSide }),
      water: glowMat(0x3aa0ff, 0.6),
      solar: new T.MeshStandardMaterial({ map: solarTex, roughness: 0.25, metalness: 0.5, emissive: 0x1b3f96, emissiveIntensity: 0.3 }),
      groundGlow: new T.MeshBasicMaterial({ map: glowTex, color: 0xffa040, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false })
    };
    m.glass.userData.noShadow = true; m.ice.userData.noShadow = true; m.groundGlow.userData.noShadow = true;
    m.soil = site === 'mars' ? 0xa9582f : 0x7b7c87; m.soil2 = site === 'mars' ? 0x8e4524 : 0x666772;
    m.road = site === 'mars' ? 0x5a3a2a : 0x3d3f4a;      // packed, baked soil: the streets and the ring road
    return m;
  }

  // ---------- buildings ----------
  // A unit is one building (or ship) that appears in one go. Its colliders are kept until it is shown.
  function unit(stage, x, z, ry, delay) {
    var g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry || 0; g.visible = false; grp.add(g);
    var u = { stage: stage, g: g, kit: new Kit(), cols: [], on: false, delay: delay || 0, ship: null, s: 1 };
    units.push(u);
    return u;
  }
  // a collider: a circle on the ground that stops walking, driving and thrown things. h: how tall it is (3.4 m if left out)
  function col(u, x, z, r, h) {
    var c = Math.cos(u.g.rotation.y), s = Math.sin(u.g.rotation.y);
    var gx = u.g.position.x + x * c + z * s, gz = u.g.position.z - x * s + z * c, o = { x: wx(gx, gz), z: wz(gx, gz), r: r };
    if (h) o.h = h;
    u.cols.push(o);
    return o;
  }
  function bake(u) { u.meshes = u.kit.bake(u.g); return u; }
  // four landing legs from the body out to round feet
  function legs(k, top, r0, r1, h, kind, color) {
    var phi = Math.atan2(r1 - r0, h - 0.3), len = Math.hypot(r1 - r0, h - 0.3);
    for (var i = 0; i < 4; i++) {
      var a = Math.PI / 4 + i * Math.PI / 2, sa = Math.sin(a), ca = Math.cos(a), rm = (r0 + r1) / 2;
      k.put(kind, G.box, mx(sa * rm, (h + 0.3) / 2, ca * rm, -phi, a, 0, 0.24, len, 0.24), color);
      k.put('soft', G.cyl, mx(sa * r1, 0.1, ca * r1, 0, 0, 0, 0.55, 0.2, 0.55), 0x3a3e4c);
      k.put('soft', G.box, mx(sa * (r0 + 0.25), top - 0.2, ca * (r0 + 0.25), 0, a, 0, 0.4, 0.4, 0.4), 0x3a3e4c);
    }
  }
  function flame(u, y, r, len) {
    var m = addMat(0xff9a30, 0.9), f = new T.Mesh(G.flame, m);
    f.position.set(0, y - len / 2, 0); f.rotation.x = Math.PI; f.scale.set(r, len, r); f.visible = false;
    u.g.add(f);
    var core = new T.Mesh(G.flame, addMat(0xfff2c0, 0.9));
    core.position.set(0, y - len * 0.28, 0); core.rotation.x = Math.PI; core.scale.set(r * 0.42, len * 0.45, r * 0.42); core.visible = false;
    u.g.add(core);
    u.ship = { flame: f, core: core, len: len, y: y };
  }

  // stage 1: a squat cargo lander wrapped in gold foil, with a big engine bell
  function cargoLander(u) {
    var k = u.kit;
    legs(k, 2.7, 2.0, 3.6, 2.7, 'metal', 0xb8bcc8);
    k.put('metal', G.bell, mx(0, 1.65, 0, 0, 0, 0, 1.3, 1.7, 1.3), 0x3a3e4c);
    k.put('gold', G.cyl8, mx(0, 3.45, 0, 0, Math.PI / 8, 0, 2.3, 1.9, 2.3));
    k.put('soft', G.cyl8, mx(0, 2.5, 0, 0, Math.PI / 8, 0, 2.35, 0.16, 2.35), 0x3a3e4c);
    k.put('soft', G.cyl8, mx(0, 4.52, 0, 0, Math.PI / 8, 0, 2.5, 0.26, 2.5), 0xf2f3f7);
    k.put('soft', G.box, mx(-0.85, 5.2, 0.45, 0, 0.1, 0, 1.4, 1.1, 1.4), 0xf2f3f7);
    k.put('soft', G.box, mx(-0.85, 5.2, 0.45, 0, 0.1, 0, 1.44, 0.22, 1.44), 0x3d7dff);
    k.put('soft', G.box, mx(0.95, 5.05, -0.35, 0, -0.2, 0, 1.2, 0.8, 1.6), 0xff8a3d);
    for (var i = 0; i < 4; i++) { var a = i * Math.PI / 2; k.put('soft', G.box, mx(Math.sin(a) * 2.32, 4.0, Math.cos(a) * 2.32, 0, a, 0, 0.5, 0.36, 0.3), 0x2b3147); }
    k.put('soft', G.cyl, mx(-1.5, 5.3, -1.2, 0, 0, 0, 0.05, 1.4, 0.05), 0xdfe2ea);
    k.put('soft', G.dome, mx(1.2, 4.9, 1.3, -0.9, 0.6, 0, 0.7, 0.25, 0.7), 0xf2f3f7);
    k.put('soft', G.box, mx(0, 1.27, 3.55, 0.775, 0, 0, 1.2, 0.1, 3.5), 0x8a8fa0);              // the unloading ramp
    k.put('blink', G.ball, mx(-1.5, 6.05, -1.2, 0, 0, 0, 0.13));
    k.put('blink', G.ball, mx(2.2, 4.75, 0.9, 0, 0, 0, 0.11)); k.put('blink2', G.ball, mx(-2.2, 4.75, -0.9, 0, 0, 0, 0.11));
    k.put('amber', G.box, mx(0, 3.5, 2.24, 0, 0, 0, 1.0, 0.16, 0.06));
    bake(u); flame(u, 0.8, 1.2, 6);
    col(u, 0, 0, 3.5, 6);
  }
  function crates(u) {
    var k = u.kit, list = [[-1.7, 0, -1.0, 0xf2f3f7, 0], [0, 0, -1.0, 0xff8a3d, 0.05], [1.7, 0, -1.05, 0xf2f3f7, -0.04], [-1.7, 0, 1.0, 0x3d7dff, 0.03], [0.05, 0, 1.0, 0xf2f3f7, -0.06], [-1.7, 1.18, -1.0, 0xffd23f, 0.1]];
    list.forEach(function (c, i) {
      k.put('soft', G.box, mx(c[0], c[1] + 0.58, c[2], 0, c[4], 0, 1.55, 1.15, 1.75), c[3]);
      k.put('soft', G.box, mx(c[0], c[1] + 0.58, c[2], 0, c[4], 0, 1.6, 0.2, 1.8), c[3] === 0xf2f3f7 ? 0x3d7dff : 0xf2f3f7);
      k.put(i % 2 ? 'amber' : 'green', G.box, mx(c[0] + 0.79, c[1] + 0.85, c[2], 0, c[4], 0, 0.04, 0.16, 0.5));
    });
    [[1.9, 1.0], [1.9, 2.3]].forEach(function (p) {
      k.put('soft', G.cyl, mx(p[0], 0.62, p[1], 0, 0, Math.PI / 2, 0.55, 1.9, 0.55), 0xf2f3f7);
      k.put('soft', G.ball, mx(p[0] - 0.95, 0.62, p[1], 0, 0, 0, 0.55, 0.55, 0.55), 0xf2f3f7);
      k.put('soft', G.ball, mx(p[0] + 0.95, 0.62, p[1], 0, 0, 0, 0.55, 0.55, 0.55), 0xf2f3f7);
      k.put('soft', G.ring, mx(p[0], 0.62, p[1], 0, Math.PI / 2, 0, 0.57, 0.57, 0.57), 0x3d7dff);
      k.put('soft', G.box, mx(p[0], 0.12, p[1], 0, 0, 0, 1.6, 0.24, 0.7), 0x3a3e4c);
    });
    bake(u);
    col(u, -1.1, 0, 1.9, 2.4); col(u, 1.0, -0.6, 1.5, 1.3); col(u, 1.9, 1.6, 1.3, 1.2);
  }
  // a pressurised tent: half buried, it holds air like a balloon, with a garage door at the front
  function garage(u) {
    var k = u.kit;
    k.put('soft', new T.CapsuleGeometry(2.3, 2.4, 6, 20), mx(0, 0, 0, Math.PI / 2, 0, 0), 0xf1ece0);
    [-2.2, -0.75, 0.7, 2.1].forEach(function (z) { k.put('soft', G.arch, mx(0, 0, z, 0, 0, 0, 2.36), 0xff8a3d); });
    k.put('soft', G.box, mx(0, 1.15, 3.5, 0, 0, 0, 2.2, 2.3, 1.8), 0xc3c7d2);
    k.put('soft', G.box, mx(0, 2.35, 3.5, 0, 0, 0, 2.4, 0.2, 2.0), 0xff8a3d);
    k.put('soft', G.box, mx(0, 0.95, 4.42, 0, 0, 0, 1.5, 1.8, 0.08), 0x2b3147);
    k.put('green', G.box, mx(0, 2.05, 4.43, 0, 0, 0, 1.4, 0.16, 0.08));
    [-1.2, 1.2].forEach(function (z) { [-1, 1].forEach(function (s) { k.put('cyan', G.ball, mx(s * 1.86, 1.35, z, 0, s * 0.62, 0, 0.36, 0.3, 0.1)); }); });
    bake(u);
    col(u, 0, -2.1, 2.4, 2.4); col(u, 0, 0.4, 2.4, 2.4); col(u, 0, 3.5, 1.5, 2.5);
  }
  function roverParts(k, trim) {
    k.put('soft', new T.CapsuleGeometry(0.95, 2.3, 5, 14), mx(0, 1.4, 0, Math.PI / 2, 0, 0), 0xf2f3f7);
    k.put('soft', G.box, mx(0, 1.15, 0, 0, 0, 0, 2.0, 0.3, 3.8), trim || 0xff8a3d);
    k.put('cyan', G.box, mx(0, 1.75, 1.95, -0.5, 0, 0, 1.3, 0.45, 0.1));
    [-1, 1].forEach(function (s) { k.put('cyan', G.box, mx(s * 0.92, 1.65, 0.2, 0, 0, 0, 0.06, 0.32, 1.5)); });
    [-1.2, 0, 1.2].forEach(function (z) { [-1.02, 1.02].forEach(function (x) {
      k.put('soft', G.cyl, mx(x, 0.45, z, 0, 0, Math.PI / 2, 0.45, 0.36, 0.45), 0x22252f);
      k.put('soft', G.cyl, mx(x * 1.02, 0.45, z, 0, 0, Math.PI / 2, 0.22, 0.4, 0.22), 0xdfe2ea);
    }); });
    k.put('soft', G.cyl, mx(0.5, 2.7, -0.9, 0, 0, 0, 0.03, 1.0, 0.03), 0xdfe2ea);
    k.put('blink', G.ball, mx(0.5, 3.25, -0.9, 0, 0, 0, 0.08));
    k.put('win', G.ball, mx(-0.6, 1.2, 2.3, 0, 0, 0, 0.16)); k.put('win', G.ball, mx(0.6, 1.2, 2.3, 0, 0, 0, 0.16));
  }
  function rover(u) {
    roverParts(u.kit);
    bake(u);
    col(u, 0, -0.9, 1.3, 2.4); col(u, 0, 0.9, 1.3, 2.4);
  }
  // one more rover, parked somewhere inside a bigger unit
  function parkRover(u, x, z, yaw, trim) {
    u.kit.base = mx(x, 0, z, 0, yaw, 0); roverParts(u.kit, trim); u.kit.base = null;
    col(u, x - Math.sin(yaw) * 0.9, z - Math.cos(yaw) * 0.9, 1.3, 2.4); col(u, x + Math.sin(yaw) * 0.9, z + Math.cos(yaw) * 0.9, 1.3, 2.4);
  }
  function pathLights(u) {
    var k = u.kit;
    [6, 10, 14, 18, 21.5].forEach(function (z) { [-2.7, 2.7].forEach(function (x) {
      k.put('soft', G.cyl, mx(x, 0.45, z, 0, 0, 0, 0.05, 0.9, 0.05), 0x8a8fa0);
      k.put('win', G.ball, mx(x, 0.96, z, 0, 0, 0, 0.14));
    }); });
    bake(u);
  }

  // stage 2: a tall crew lander, an inflatable home under soil bags, a glowing greenhouse
  function crewLander(u) {
    var k = u.kit;
    legs(k, 2.5, 1.6, 3.0, 2.5, 'soft', 0xb8bcc8);
    k.put('metal', G.bell, mx(0, 1.4, 0, 0, 0, 0, 1.0, 1.3, 1.0), 0x3a3e4c);
    k.put('soft', G.cyl, mx(0, 4.25, 0, 0, 0, 0, 1.9, 4.2, 1.9), 0xf4f5f9);
    k.put('soft', G.cone, mx(0, 7.65, 0, 0, 0, 0, 1.9, 2.6, 1.9), 0xf4f5f9);
    k.put('soft', G.cyl, mx(0, 2.15, 0, 0, 0, 0, 1.95, 0.12, 1.95), 0x2b3147);
    [3.0, 5.9].forEach(function (y) { k.put('soft', G.ring, mx(0, y, 0, Math.PI / 2, 0, 0, 1.93), 0x3d7dff); });
    [-0.55, 0, 0.55].forEach(function (a) { k.put('win', G.ball, mx(Math.sin(a) * 1.86, 5.2, Math.cos(a) * 1.86, 0, a, 0, 0.3, 0.3, 0.12)); });
    k.put('soft', G.box, mx(0, 3.55, 1.88, 0, 0, 0, 1.0, 1.4, 0.12), 0x2b3147);
    k.put('soft', G.box, mx(0, 1.55, 2.35, -0.18, 0, 0, 0.7, 3.1, 0.08), 0x8a8fa0);
    k.put('blink', G.ball, mx(0, 9.05, 0, 0, 0, 0, 0.14));
    k.put('soft', G.box, mx(-1.95, 4.6, 0, 0, 0, 0, 0.12, 2.2, 0.9), 0x3d7dff); k.put('soft', G.box, mx(1.95, 4.6, 0, 0, 0, 0, 0.12, 2.2, 0.9), 0x3d7dff);
    bake(u); flame(u, 0.75, 1.0, 5);
    col(u, 0, 0, 2.9, 9);
  }
  function hab2(u) {
    var k = u.kit, i, a;
    k.put('soft', new T.CapsuleGeometry(2.5, 3.0, 6, 24), mx(0, 2.45, 0, Math.PI / 2, 0, 0), 0xf4f5f9);
    [-1.5, 0, 1.5].forEach(function (z) { k.put('soft', G.ring, mx(0, 2.45, z, 0, 0, 0, 2.53), 0xc3c7d2); });
    [-2.5, 2.5].forEach(function (z) { k.put('soft', G.box, mx(0, 0.3, z, 0, 0, 0, 4.4, 0.6, 0.7), 0x3a3e4c); });
    [-2.3, -0.75, 0.75, 2.3].forEach(function (z) { k.put('win', G.ball, mx(-2.43, 2.9, z, 0, 0, 0, 0.13, 0.36, 0.5)); });
    [-1.5, 1.5].forEach(function (z) { k.put('win', G.ball, mx(2.43, 2.9, z, 0, 0, 0, 0.13, 0.36, 0.5)); });
    // soil bags on the roof: two metres of dirt stop most space radiation
    for (i = -1; i <= 1; i++) for (var z = -2.7; z <= 2.8; z += 1.1) {
      a = i * 0.5;
      k.put('rough', G.lump, mx(Math.sin(a) * 2.62, 2.45 + Math.cos(a) * 2.62, z + (i ? 0.25 : 0), 0, 0, -a, 0.62, 0.3, 0.52), Math.abs(Math.round(z / 1.1) + i) % 2 ? M.soil : M.soil2);
    }
    k.put('soft', G.box, mx(-2.9, 1.05, 1.5, 0, 0, 0, 1.5, 2.1, 1.5), 0xc3c7d2);
    k.put('soft', G.box, mx(-3.66, 0.95, 1.5, 0, 0, 0, 0.08, 1.7, 1.0), 0x2b3147);
    k.put('green', G.box, mx(-3.67, 2.0, 1.5, 0, 0, 0, 0.08, 0.16, 1.1));
    // the airlock tunnel to the greenhouse
    k.put('soft', G.cyl, mx(0, 1.0, 5.1, Math.PI / 2, 0, 0, 0.85, 3.4, 0.85), 0xdfe2ea);
    [4.1, 5.1, 6.1].forEach(function (z) { k.put('soft', G.ring, mx(0, 1.0, z, 0, 0, 0, 0.88), 0x3d7dff); });
    k.put('cyan', G.box, mx(0, 1.86, 5.1, 0, 0, 0, 0.12, 0.05, 2.8));
    bake(u);
    col(u, 0, -2.6, 2.6, 5.2); col(u, 0, 0, 2.6, 5.2); col(u, 0, 2.6, 2.6, 5.2); col(u, -2.95, 1.5, 0.95, 2.2); col(u, 0, 4.6, 1.0, 1.9); col(u, 0, 6.0, 1.0, 1.9);
  }
  function greenhouse(u) {
    var k = u.kit, i;
    k.put('soft', G.cyl, mx(0, 0.15, 0, 0, 0, 0, 3.15, 0.3, 3.15), 0xd7dae3);
    for (i = 0; i < 3; i++) k.put('soft', G.arch, mx(0, 0.28, 0, 0, i * Math.PI / 3, 0, 3.02), 0xf4f5f9);
    k.put('soft', G.ring, mx(0, 1.4, 0, Math.PI / 2, 0, 0, 2.72), 0xf4f5f9);
    [-1.1, 0, 1.1].forEach(function (z, r) {
      k.put('soft', G.box, mx(0, 0.55, z, 0, 0, 0, 3.4, 0.5, 0.62), 0xf4f5f9);
      k.put('rough', G.box, mx(0, 0.82, z, 0, 0, 0, 3.2, 0.06, 0.5), 0x4a3324);
      for (var x = -1.25; x <= 1.3; x += 0.83) k.put('soft', G.cone, mx(x, 1.15, z, 0, x + r, 0, 0.26, 0.62, 0.26), (r + Math.round(x)) % 2 ? 0x4fd15a : 0x2fa64a);
      k.put('pink', G.box, mx(0, 2.0 - Math.abs(z) * 0.35, z, 0, 0, 0, 2.8, 0.07, 0.12));
    });
    k.put('glass', G.facet, mx(0, 0.28, 0, 0, 0.3, 0, 3.0));
    k.put('haze', G.dome, mx(0, 0.28, 0, 0, 0, 0, 2.75));
    k.put('soft', G.box, mx(-3.0, 0.95, 0, 0, 0, 0, 1.2, 1.9, 1.4), 0xc3c7d2);
    k.put('soft', G.box, mx(-3.62, 0.9, 0, 0, 0, 0, 0.06, 1.6, 0.9), 0x2b3147);
    k.put('pink', G.box, mx(-3.63, 1.95, 0, 0, 0, 0, 0.06, 0.14, 1.0));
    bake(u);
    col(u, 0, 0, 3.25, 3.3); col(u, -3.1, 0, 0.85, 2);
  }

  // stage 3: a two-storey hub, a shielded dome, tubes, a landing pad, a shuttle, a solar farm, a sign
  function hub(u) {
    var k = u.kit, r, a;
    k.put('soft', G.cyl, mx(0, 0.2, 0, 0, 0, 0, 3.3, 0.4, 3.3), 0xd7dae3);
    k.put('soft', G.cyl, mx(0, 3.4, 0, 0, 0, 0, 3.0, 6.0, 3.0), 0xf4f5f9);
    k.put('soft', G.dome, mx(0, 6.4, 0, 0, 0, 0, 3.0), 0xf4f5f9);
    [0.9, 3.4, 6.35].forEach(function (y) { k.put('soft', G.ring, mx(0, y, 0, Math.PI / 2, 0, 0, 3.03), 0x3d7dff); });
    for (r = 0; r < 2; r++) for (a = 0; a < 8; a++) {
      var ang = (a + 0.5 + r * 0.5) * Math.PI / 4;
      if (r === 0 && (a === 7 || a === 0)) continue;               // the door is here
      k.put('win', G.ball, mx(Math.sin(ang) * 2.98, r ? 4.7 : 2.2, Math.cos(ang) * 2.98, 0, ang, 0, 0.42, 0.42, 0.12));
    }
    k.put('soft', G.box, mx(0, 1.15, 3.3, 0, 0, 0, 1.7, 2.3, 1.4), 0xc3c7d2);
    k.put('soft', G.box, mx(0, 2.35, 3.3, 0, 0, 0, 1.9, 0.2, 1.6), 0x3d7dff);
    k.put('soft', G.box, mx(0, 0.95, 4.02, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147);
    k.put('green', G.box, mx(0, 2.0, 4.03, 0, 0, 0, 1.2, 0.15, 0.06));
    k.put('soft', G.cyl, mx(0, 10.6, 0, 0, 0, 0, 0.07, 2.6, 0.07), 0xdfe2ea);
    k.put('blink', G.ball, mx(0, 11.95, 0, 0, 0, 0, 0.16));
    k.put('soft', G.dome, mx(1.3, 9.0, -0.4, -1.0, 0.4, 0, 0.8, 0.3, 0.8), 0xf4f5f9);
    k.put('win', G.cyl, mx(0, 9.42, 0, 0, 0, 0, 0.9, 0.05, 0.9));
    bake(u);
    col(u, 0, 0, 3.35, 9.5); col(u, 0, 3.3, 1.0, 2.5);
  }
  function shieldDome(u) {
    var k = u.kit, rings = [[0.22, 13], [0.68, 10], [1.1, 6]], n = 0;
    k.put('soft', G.dome, mx(0, 0, 0, 0, 0, 0, 3.2, 2.85, 3.2), 0xf4f5f9);
    rings.forEach(function (r) {
      for (var i = 0; i < r[1]; i++) {
        var a = (i + (r[0] > 0.5 ? 0.5 : 0)) / r[1] * Math.PI * 2, e = r[0];
        if (r[0] < 0.3 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.4) continue;     // keep the door clear
        k.put('rough', G.lump, mx(Math.sin(a) * Math.cos(e) * 3.32, Math.sin(e) * 2.95, Math.cos(a) * Math.cos(e) * 3.32, Math.PI / 2 - e, a, 0, 0.95, 0.42, 0.72), n++ % 2 ? M.soil : M.soil2);
      }
    });
    k.put('rough', G.lump, mx(0, 2.95, 0, 0, 0.4, 0, 0.9, 0.4, 0.9), M.soil);
    k.put('soft', G.cyl, mx(0, 1.05, 3.45, Math.PI / 2, 0, 0, 1.0, 2.2, 1.0), 0xc3c7d2);
    k.put('soft', G.ring, mx(0, 1.05, 4.52, 0, 0, 0, 1.02), 0xff8a3d);
    k.put('soft', G.cyl, mx(0, 0.95, 4.55, Math.PI / 2, 0, 0, 0.7, 0.04, 0.85), 0x2b3147);
    k.put('green', G.box, mx(0, 1.95, 4.5, 0, 0, 0, 0.9, 0.12, 0.1));
    k.put('win', G.cyl, mx(0, 3.32, 0, 0, 0, 0, 0.75, 0.06, 0.75));
    bake(u);
    col(u, 0, 0, 3.55, 3.3); col(u, 0, 3.7, 1.1, 2.1);
  }
  function tube(k, cols, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), mxx = (ax + bx) / 2, mzz = (az + bz) / 2;
    k.put('soft', G.cyl, mx(mxx, 1.0, mzz, Math.PI / 2, yaw, 0, 0.75, len, 0.75), 0xdfe2ea);
    [0.15, 0.5, 0.85].forEach(function (t) { k.put('soft', G.ring, mx(ax + dx * t, 1.0, az + dz * t, 0, yaw, 0, 0.79), 0x3d7dff); });
    k.put('cyan', G.box, mx(mxx, 1.76, mzz, 0, yaw, 0, 0.1, 0.05, len * 0.8));
    for (var d = 0.7; d < len; d += 1.4) cols.push([ax + dx * d / len, az + dz * d / len, 0.9]);
  }
  function tubes(u) {
    var cols = [];
    tube(u.kit, cols, 1.9, -6.0, 7.0, -6.0);
    tube(u.kit, cols, -3.05, -3.95, -5.7, -1.3);
    bake(u);
    cols.forEach(function (c) { col(u, c[0], c[1], c[2], 1.8); });
  }
  // a hard landing pad. r: how big (the first one is 4.1 m)
  function pad(u, r) {
    var k = u.kit, i, s = (r || 4.1) / 4.1;
    k.put('soft', G.cyl, mx(0, 0.12, 0, 0, 0, 0, 4.1 * s, 0.24, 4.1 * s), 0x4a4f63);
    k.put('ring', G.ring, mx(0, 0.26, 0, Math.PI / 2, 0, 0, 3.4 * s, 3.4 * s, 1.4));
    for (i = 0; i < 8; i++) k.put('amber', G.dot, mx(Math.sin(i * Math.PI / 4) * 3.9 * s, 0.3, Math.cos(i * Math.PI / 4) * 3.9 * s, 0, 0, 0, 0.13));
    [-0.75, 0.75].forEach(function (x) { k.put('soft', G.box, mx(x * s, 0.25, 0, 0, 0, 0, 0.32 * s, 0.03, 2.1 * s), 0xf2f3f7); });
    k.put('soft', G.box, mx(0, 0.25, 0, 0, 0, 0, 1.5 * s, 0.03, 0.32 * s), 0xf2f3f7);
    bake(u);
  }
  function shuttle(u) {
    var k = u.kit;
    legs(k, 2.0, 1.3, 2.7, 2.0, 'soft', 0xb8bcc8);
    k.put('metal', G.bell, mx(0, 1.15, 0, 0, 0, 0, 0.95, 1.1, 0.95), 0x3a3e4c);
    k.put('soft', G.cyl6, mx(0, 3.7, 0, 0, Math.PI / 6, 0, 1.6, 3.9, 1.6), 0xf4f5f9);
    k.put('soft', G.cone6, mx(0, 7.0, 0, 0, Math.PI / 6, 0, 1.6, 2.7, 1.6), 0xf4f5f9);
    k.put('soft', G.cone6, mx(0, 8.15, 0, 0, Math.PI / 6, 0, 0.55, 0.5, 0.55), 0xff8a3d);
    k.put('soft', G.cyl6, mx(0, 1.8, 0, 0, Math.PI / 6, 0, 1.62, 0.3, 1.62), 0x2b3147);
    [-2.05, 2.05].forEach(function (x) {
      k.put('soft', G.cyl, mx(x, 3.3, 0, 0, 0, 0, 0.55, 3.4, 0.55), 0xff8a3d);
      k.put('soft', G.cone, mx(x, 5.45, 0, 0, 0, 0, 0.55, 0.9, 0.55), 0xff8a3d);
      k.put('metal', G.bell, mx(x, 1.3, 0, 0, 0, 0, 0.42, 0.6, 0.42), 0x3a3e4c);
      k.put('soft', G.box, mx(x * 0.72, 3.9, 0, 0, 0, 0, 0.9, 0.3, 0.5), 0xdfe2ea);
    });
    k.put('cyan', G.box, mx(0, 6.1, 1.3, -0.28, 0, 0, 1.3, 0.42, 0.1));
    k.put('soft', G.box, mx(0, 2.95, 1.42, 0, 0, 0, 0.95, 1.4, 0.1), 0x2b3147);
    k.put('soft', G.box, mx(0, 1.25, 2.1, -0.32, 0, 0, 0.8, 2.6, 0.08), 0x8a8fa0);
    k.put('blink2', G.ball, mx(0, 8.5, 0, 0, 0, 0, 0.12));
    bake(u); flame(u, 0.6, 0.95, 4.6);
    col(u, 0, 0, 2.7, 8.5);
  }
  // a field of solar panels on poles. list: where the poles stand. The panels are two instanced meshes.
  function panelField(u, list) {
    var k = u.kit, moon = site === 'moon', im, fr;
    list.forEach(function (p) {
      k.put('soft', G.cyl, mx(p[0], moon ? 1.6 : 0.7, p[1], 0, 0, 0, 0.09, moon ? 3.2 : 1.4, 0.09), 0xdfe2ea);
      k.put('soft', G.cyl, mx(p[0], 0.1, p[1], 0, 0, 0, 0.4, 0.2, 0.4), 0x8a8fa0);
      col(u, p[0], p[1], moon ? 0.55 : 1.0, moon ? 4.7 : 2.3);
    });
    im = new T.InstancedMesh(G.box, M.solar, list.length); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    fr = new T.InstancedMesh(G.box, M.white, list.length); fr.castShadow = true; fr.frustumCulled = false;
    u.g.add(im); u.g.add(fr);
    fields.push({ im: im, fr: fr, list: list, yaw: null, moon: moon });
  }
  function solarFarm(u) {
    var k = u.kit, list = [];
    [15.5, 19.0].forEach(function (x) { [-5, -2, 1, 4, 7].forEach(function (z) { list.push([x, z]); }); });
    panelField(u, list);
    k.put('soft', G.box, mx(13.9, 0.6, -7.6, 0, 0.3, 0, 1.6, 1.2, 1.0), 0xc3c7d2);
    k.put('green', G.box, mx(13.9, 0.9, -7.08, 0, 0.3, 0, 0.9, 0.12, 0.05));
    bake(u);
    col(u, 13.9, -7.6, 1.0, 1.2);
  }
  function aimPanels(force) {
    var sd = W.sunDir, yaw, pitch, f, n, i;
    for (n = 0; n < fields.length; n++) {
      f = fields[n];
      if (f.moon) { yaw = Math.atan2(sd.x, sd.z) - ROT; pitch = clamp(Math.asin(clamp(sd.y, -1, 1)), 0.05, 0.4); }
      else { yaw = -ROT; pitch = 0.9; }
      if (!force && f.yaw != null && Math.abs(yaw - f.yaw) < 0.004) continue;
      f.yaw = yaw;
      for (i = 0; i < f.list.length; i++) {
        var p = f.list[i], y = f.moon ? 3.3 : 1.55;
        var w = f.moon ? 2.0 : 2.8, h = f.moon ? 2.8 : 1.7;
        f.im.setMatrixAt(i, mx(p[0], y, p[1], -pitch, yaw, 0, w, h, 0.07));
        f.fr.setMatrixAt(i, mx(p[0] - Math.sin(yaw) * 0.06, y, p[1] - Math.cos(yaw) * 0.06, -pitch, yaw, 0, w + 0.14, h + 0.14, 0.05));
      }
      f.im.instanceMatrix.needsUpdate = true; f.fr.instanceMatrix.needsUpdate = true;
    }
  }
  // draw a sign again once the web fonts have loaded
  function fontsThen(tex) {
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { try { tex.userData.redraw(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  }
  function signTex() {
    return canvasTex(512, 192, function (ctx, w, h) {
      var name = TOWN[site] || 'New Town', g = ctx.createLinearGradient(0, 0, 0, h);
      ctx.clearRect(0, 0, w, h);
      g.addColorStop(0, '#24407e'); g.addColorStop(1, '#152452');
      ctx.fillStyle = g; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(4, 4, w - 8, h - 8, 26); else ctx.rect(4, 4, w - 8, h - 8);
      ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffd23f';
      ctx.font = '600 26px "Exo 2", Lexend, "Trebuchet MS", sans-serif';
      ctx.fillText('WELCOME TO', w / 2, 40);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + (name.length > 9 ? 58 : 66) + 'px "Exo 2", Lexend, "Trebuchet MS", sans-serif';
      ctx.fillText(name, w / 2, 96);
      ctx.fillStyle = '#9fe8ff'; ctx.font = '500 26px "Exo 2", Lexend, "Trebuchet MS", sans-serif';
      ctx.fillText('·  population ' + popNow + '  ·', w / 2, 152);
    });
  }
  function sign(u) {
    var k = u.kit, tex = signT = signTex();
    [-2.15, 2.15].forEach(function (x) { k.put('soft', G.cyl, mx(x, 1.35, 0, 0, 0, 0, 0.09, 2.7, 0.09), 0x8a8fa0); });
    k.put('soft', G.box, mx(0, 2.15, -0.02, 0, 0, 0, 4.7, 1.8, 0.12), 0xf2f3f7);
    k.put('amber', G.box, mx(0, 3.13, 0.02, 0, 0, 0, 3.6, 0.1, 0.14));
    bake(u);
    var face = new T.Mesh(new T.PlaneGeometry(4.5, 1.69), new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5, transparent: true }));
    face.position.set(0, 2.15, 0.05); u.g.add(face);
    fontsThen(tex);
    col(u, -2.15, 0, 0.3, 3.1); col(u, 2.15, 0, 0.3, 3.1);
  }
  function plaza(u) {
    var k = u.kit;
    k.put('soft', G.cyl, mx(0, 2.4, 0, 0, 0, 0, 0.06, 4.8, 0.06), 0xf2f3f7);
    k.put('soft', G.box, mx(0.75, 4.25, 0, 0, 0, 0, 1.4, 0.9, 0.04), 0xff8a3d);
    k.put('soft', G.box, mx(0.75, 4.25, 0.01, 0, 0, 0, 1.4, 0.3, 0.04), 0x3d7dff);
    [[-3.6, 9.5], [3.9, 9.5], [-3.6, 12.5], [3.9, 12.2]].forEach(function (p, i) {
      k.put('soft', G.box, mx(p[0], 0.3, p[1], 0, 0, 0, 1.1, 0.6, 1.1), 0xd7dae3);
      k.put('soft', G.ball, mx(p[0], 0.75, p[1], 0, i, 0, 0.5, 0.42, 0.5), i % 2 ? 0x4fd15a : 0x2fa64a);
    });
    k.put('win', G.ball, mx(0, 4.9, 0, 0, 0, 0, 0.1));
    bake(u);
    col(u, 0, 0, 0.25, 4.9);
  }

  // ---------- stage 4: a growing town ----------
  // a wide ferry with two decks of windows: it brings whole families
  function ferry(u) {
    var k = u.kit, r, i, a;
    legs(k, 2.7, 2.3, 3.4, 2.7, 'soft', 0xb8bcc8);
    k.put('metal', G.bell, mx(0, 1.5, 0, 0, 0, 0, 1.15, 1.5, 1.15), 0x3a3e4c);
    k.put('soft', G.cyl, mx(0, 4.0, 0, 0, 0, 0, 2.6, 3.4, 2.6), 0xf4f5f9);
    k.put('soft', G.dome, mx(0, 5.7, 0, 0, 0, 0, 2.6, 1.7, 2.6), 0xf4f5f9);
    k.put('soft', G.cyl, mx(0, 2.3, 0, 0, 0, 0, 2.66, 0.16, 2.66), 0x2b3147);
    k.put('soft', G.cyl, mx(0, 5.5, 0, 0, 0, 0, 2.64, 0.3, 2.64), 0xff8a3d);
    k.put('soft', G.band, mx(0, 2.8, 0, Math.PI / 2, 0, 0, 2.63), 0x3d7dff);
    k.put('soft', G.cyl, mx(0, 7.45, 0, 0, 0, 0, 0.7, 0.4, 0.7), 0xc3c7d2);
    for (r = 0; r < 2; r++) for (i = 0; i < 10; i++) {
      a = (i + r * 0.5) * Math.PI / 5;
      if (r === 0 && i === 0) continue;                             // the door is here
      k.put('win', G.dot, mx(Math.sin(a) * 2.57, r ? 4.7 : 3.4, Math.cos(a) * 2.57, 0, a, 0, 0.32, 0.32, 0.1));
    }
    k.put('soft', G.box, mx(0, 3.35, 2.58, 0, 0, 0, 1.0, 1.5, 0.1), 0x2b3147);
    k.put('soft', G.box, mx(0, 1.32, 4.1, 0.704, 0, 0, 1.1, 0.1, 3.94), 0x8a8fa0);              // the ramp
    [-1, 1].forEach(function (s) { k.put('soft', G.box, mx(s * 2.68, 4.0, 0, 0, 0, 0, 0.12, 2.0, 1.3), 0x3d7dff); });
    k.put('blink', G.dot, mx(0, 7.8, 0, 0, 0, 0, 0.14));
    bake(u); flame(u, 0.8, 1.2, 5.5);
    col(u, 0, 0, 3.6, 7.6);
  }
  // one round home under soil bags. ra: which way its door looks
  function pod(u, x, z, ra) {
    var k = u.kit, n = 0, i, a;
    k.base = mx(x, 0, z, 0, ra, 0);
    k.put('soft', G.cyl, mx(0, 0.15, 0, 0, 0, 0, 2.8, 0.3, 2.8), 0xd7dae3);
    k.put('soft', G.cyl, mx(0, 1.5, 0, 0, 0, 0, 2.6, 2.4, 2.6), 0xf4f5f9);
    k.put('soft', G.dome, mx(0, 2.7, 0, 0, 0, 0, 2.6, 1.5, 2.6), 0xf4f5f9);
    k.put('soft', G.band, mx(0, 2.7, 0, Math.PI / 2, 0, 0, 2.63), 0x3d7dff);
    [[0.3, 9], [0.85, 6]].forEach(function (r) {
      for (i = 0; i < r[1]; i++) {
        a = (i + (r[0] > 0.5 ? 0.5 : 0)) / r[1] * Math.PI * 2;
        k.put('rough', G.lump, mx(Math.sin(a) * Math.cos(r[0]) * 2.6, 2.7 + Math.sin(r[0]) * 1.5, Math.cos(a) * Math.cos(r[0]) * 2.6, Math.PI / 2 - r[0] * 1.25, a, 0, 0.85, 0.36, 0.62), n++ % 2 ? M.soil : M.soil2);
      }
    });
    k.put('rough', G.lump, mx(0, 4.18, 0, 0, 0.4, 0, 0.85, 0.34, 0.85), M.soil);
    [-2.4, -0.75, 0.75, 2.4].forEach(function (w) { k.put('win', G.dot, mx(Math.sin(w) * 2.57, 1.6, Math.cos(w) * 2.57, 0, w, 0, 0.36, 0.36, 0.1)); });
    k.put('soft', G.box, mx(0, 1.0, 2.75, 0, 0, 0, 1.3, 2.0, 1.1), 0xc3c7d2);
    k.put('soft', G.box, mx(0, 2.08, 2.75, 0, 0, 0, 1.46, 0.16, 1.26), 0xff8a3d);
    k.put('soft', G.box, mx(0, 0.9, 3.32, 0, 0, 0, 0.9, 1.6, 0.06), 0x2b3147);
    k.put('cyan', G.box, mx(0, 1.85, 3.33, 0, 0, 0, 1.0, 0.13, 0.06));
    k.base = null;
    col(u, x, z, 2.85, 4.3); col(u, x + Math.sin(ra) * 2.9, z + Math.cos(ra) * 2.9, 0.7, 2.2);
  }
  // three more homes in a row, joined by tubes
  function homes(u) {
    var cols = [], P = [[0.5, 7.5, Math.PI / 2], [0, 0, Math.PI / 2], [1.8, -7.3, 1.0]];
    P.forEach(function (p) { pod(u, p[0], p[1], p[2]); });
    [[0, 1], [1, 2]].forEach(function (l) {
      var a = P[l[0]], b = P[l[1]], d = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / d, uz = (b[1] - a[1]) / d;
      tube(u.kit, cols, a[0] + ux * 2.5, a[1] + uz * 2.5, b[0] - ux * 2.5, b[1] - uz * 2.5);
    });
    bake(u);
    cols.forEach(function (c) { col(u, c[0], c[1], c[2], 1.8); });
  }
  // tall tanks of water and round tanks of oxygen, both made from ice
  function tankFarm(u) {
    var k = u.kit;
    [-2.7, 0, 2.7].forEach(function (x, i) {
      k.put('soft', G.cyl, mx(x, 0.3, -0.6, 0, 0, 0, 1.3, 0.6, 1.3), 0x3a3e4c);
      k.put('soft', G.cyl, mx(x, 3.6, -0.6, 0, 0, 0, 1.15, 6.0, 1.15), 0xf4f5f9);
      k.put('soft', G.dome, mx(x, 6.6, -0.6, 0, 0, 0, 1.15, 0.9, 1.15), 0xf4f5f9);
      [1.6, 5.6].forEach(function (y) { k.put('soft', G.band, mx(x, y, -0.6, Math.PI / 2, 0, 0, 1.17), 0x3d7dff); });
      k.put('cyan', G.box, mx(x, 3.5 - i * 0.3, 0.56, 0, 0, 0, 0.14, 2.8 - i * 0.6, 0.06));       // a glowing gauge: how full the tank is
      col(u, x, -0.6, 1.3, 7.5);
    });
    k.put('soft', G.box, mx(0, 6.3, 0.85, 0, 0, 0, 6.9, 0.08, 0.6), 0x8a8fa0);                    // a walkway with a rail and a ladder
    k.put('soft', G.box, mx(0, 7.2, 1.12, 0, 0, 0, 6.9, 0.05, 0.05), 0x8a8fa0);
    [-3.4, -1.35, 1.35, 3.4].forEach(function (x) { k.put('soft', G.box, mx(x, 6.75, 1.12, 0, 0, 0, 0.05, 0.9, 0.05), 0x8a8fa0); });
    k.put('soft', G.box, mx(3.75, 3.15, 0.95, 0, 0, 0, 0.45, 6.3, 0.07), 0x8a8fa0);
    [-1.5, 1.5].forEach(function (x) {
      k.put('soft', G.cyl8, mx(x, 0.3, 2.6, 0, 0, 0, 0.8, 0.6, 0.8), 0x3a3e4c);
      k.put('soft', G.ball, mx(x, 1.6, 2.6, 0, 0, 0, 1.15), 0xf4f5f9);
      k.put('soft', G.band, mx(x, 1.6, 2.6, Math.PI / 2, 0, 0, 1.17), 0x46e0c0);
      k.put('cyan', G.dot, mx(x, 1.6, 3.74, 0, 0, 0, 0.14, 0.14, 0.06));
      col(u, x, 2.6, 1.25, 2.8);
    });
    k.put('soft', G.cyl8, mx(0, 0.75, 1.0, 0, 0, Math.PI / 2, 0.11, 6.4, 0.11), 0x8a8fa0);         // pipes
    k.put('soft', G.cyl8, mx(0, 0.75, 2.3, Math.PI / 2, 0, 0, 0.11, 2.6, 0.11), 0x8a8fa0);
    k.put('soft', G.box, mx(0, 0.5, 3.7, 0, 0, 0, 0.8, 0.8, 0.7), 0xff8a3d);
    k.put('blink', G.dot, mx(0, 7.68, -0.6, 0, 0, 0, 0.13));
    bake(u);
    col(u, 0, 3.7, 0.55, 1); col(u, 3.75, 0.95, 0.35, 6.3);
  }
  // a comms mast with a dish that looks up at Earth
  function mast(u) {
    var k = u.kit, H = 12, phi = Math.atan2(0.85, H), len = Math.hypot(0.85, H), i, a;
    k.put('soft', G.cyl8, mx(0, 0.2, 0, 0, 0, 0, 1.4, 0.4, 1.4), 0x8a8fa0);
    for (i = 0; i < 3; i++) {
      a = i * Math.PI * 2 / 3;
      k.put('soft', G.box, mx(Math.sin(a) * 0.675, 0.4 + H / 2, Math.cos(a) * 0.675, -phi, a, 0, 0.13, len, 0.13), 0xf4f5f9);
    }
    [2.4, 4.8, 7.2, 9.6].forEach(function (y, n) { var r = 1.14 - 0.85 * y / H; k.put('soft', G.band, mx(0, 0.4 + y, 0, Math.PI / 2, 0, 0, r, r, 1.2), n % 2 ? 0xf4f5f9 : 0xff8a3d); });
    k.put('soft', G.cyl8, mx(0, 12.46, 0, 0, 0, 0, 0.5, 0.12, 0.5), 0x8a8fa0);
    k.put('soft', G.cyl6, mx(0, 13.7, 0, 0, 0, 0, 0.04, 2.4, 0.04), 0xdfe2ea);
    k.put('blink', G.dot, mx(0, 14.95, 0, 0, 0, 0, 0.15));
    k.put('soft', G.dome, mx(0, 10.2, 1.45, -2.44, 0, 0, 1.3, 0.45, 1.3), 0xdfe2ea);             // the big dish: its back, and its face
    k.put('soft', G.cyl, mx(0, 10.2, 1.45, 0.698, 0, 0, 1.3, 0.05, 1.3), 0xf4f5f9);
    k.put('soft', G.box, mx(0, 9.86, 0.78, 0, 0, 0, 0.12, 0.12, 0.8), 0x8a8fa0);
    k.put('soft', G.cyl6, mx(0, 10.35, 1.58, 0.698, 0, 0, 0.03, 0.9, 0.03), 0x8a8fa0);
    k.put('soft', G.dome, mx(1.05, 6.6, -0.77, -2.44, 2.2, 0, 0.7, 0.25, 0.7), 0xdfe2ea);        // a small one
    k.put('soft', G.cyl, mx(1.05, 6.6, -0.77, 0.698, 2.2, 0, 0.7, 0.04, 0.7), 0xf4f5f9);
    k.put('soft', G.box, mx(2.0, 0.7, 0.5, 0, 0, 0, 1.7, 1.4, 1.3), 0xc3c7d2);                   // the radio hut
    k.put('soft', G.box, mx(2.0, 1.45, 0.5, 0, 0, 0, 1.85, 0.14, 1.45), 0xff8a3d);
    k.put('blink', G.dot, mx(2.0, 1.0, 1.17, 0, 0, 0, 0.1));
    bake(u);
    col(u, 0, 0, 1.3, 12.5); col(u, 2.0, 0.5, 1.0, 1.5);
  }
  function labelTex(text) {
    return canvasTex(256, 64, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#1c3270'; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 5; ctx.strokeStyle = '#ffd23f'; ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
      ctx.font = '700 40px "Exo 2", Lexend, "Trebuchet MS", sans-serif';
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
  }
  // a school in a long hall with a round roof. The door, the sign and the flag are at the +x end.
  function school(u) {
    var k = u.kit, tex = labelTex('SCHOOL'), face;
    k.put('soft', G.box, mx(0, 0.85, 0, 0, 0, 0, 8, 1.7, 4.2), 0xf4f5f9);
    k.put('soft', G.cyl, mx(0, 1.7, 0, 0, 0, Math.PI / 2, 2.1, 8, 2.1), 0xf4f5f9);
    k.put('soft', G.box, mx(0, 1.7, 0, 0, 0, 0, 8.1, 0.2, 4.3), 0xffd23f);
    [-2.7, 0, 2.7].forEach(function (x) { k.put('soft', G.arch, mx(x, 1.7, 0, 0, Math.PI / 2, 0, 2.14), 0xffd23f); });
    [-3, -1.5, 0, 1.5, 3].forEach(function (x) { [-1, 1].forEach(function (s) { k.put('win', G.dot, mx(x, 0.95, s * 2.11, 0, 0, 0, 0.42, 0.42, 0.08)); }); });
    k.put('soft', G.box, mx(4.45, 1.05, 0, 0, 0, 0, 0.9, 2.1, 1.7), 0xc3c7d2);
    k.put('soft', G.box, mx(4.5, 2.2, 0, 0, 0, 0, 1.2, 0.18, 2.0), 0xffd23f);
    k.put('soft', G.box, mx(4.92, 0.95, 0, 0, 0, 0, 0.06, 1.7, 1.1), 0x2b3147);
    k.put('green', G.box, mx(4.93, 2.0, 0, 0, 0, 0, 0.06, 0.14, 1.2));
    k.put('soft', G.box, mx(4.05, 3.0, 0, 0, 0, 0, 0.1, 0.72, 2.7), 0xf2f3f7);
    k.put('soft', G.cyl6, mx(5.0, 2.5, 2.6, 0, 0, 0, 0.06, 5, 0.06), 0xf2f3f7);                   // the flag
    k.put('soft', G.box, mx(5.0, 4.5, 3.3, 0, 0, 0, 0.04, 0.8, 1.3), 0x3d7dff);
    k.put('soft', G.box, mx(5.0, 4.5, 3.3, 0, 0, 0, 0.06, 0.26, 1.3), 0xffd23f);
    k.put('win', G.dot, mx(5.0, 5.08, 2.6, 0, 0, 0, 0.1));
    bake(u);
    face = new T.Mesh(new T.PlaneGeometry(2.5, 0.6), new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }));
    face.position.set(4.11, 3.0, 0); face.rotation.y = Math.PI / 2; u.g.add(face);
    fontsThen(tex);
    [-2.3, -0.77, 0.77, 2.3].forEach(function (x) { col(u, x, 0, 2.2, 3.8); });
    col(u, 4.55, 0, 0.85, 2.3); col(u, 5.0, 2.6, 0.2, 5);
  }
  // a farm: two long greenhouse tunnels side by side, with a hall and a water tank on the town side (-z)
  function farm(u) {
    var k = u.kit, L = 9;
    k.put('soft', G.box, mx(0, 0.15, 0, 0, 0, 0, L + 0.5, 0.3, 7.7), 0xd7dae3);
    [-1.9, 1.9].forEach(function (z, r) {
      k.put('soft', G.box, mx(0, 0.52, z, 0, 0, 0, L - 0.8, 0.45, 2.0), 0xf4f5f9);
      k.put('rough', G.box, mx(0, 0.77, z, 0, 0, 0, L - 1.0, 0.06, 1.8), 0x4a3324);
      for (var i = 0; i < 9; i++) [-0.45, 0.45].forEach(function (o, c) {
        k.put('soft', G.cone, mx((i - 4) * 0.9 + o * 0.3, 1.08, z + o, 0, i + r, 0, 0.24, 0.6, 0.24), (i + c + r) % 2 ? 0x2fa64a : 0x1f8a3a);
      });
      k.put('pink', G.box, mx(0, 1.72, z, 0, 0, 0, L - 0.6, 0.07, 0.12));
      k.put('glass', G.tunnel, mx(0, 0.3, z, 0, 0, Math.PI / 2, 1.75, L, 1.75));
      k.put('haze', G.tunnel, mx(0, 0.3, z, 0, 0, Math.PI / 2, 1.5, L - 0.4, 1.5));
      [-L / 2, L / 2].forEach(function (x) {
        k.put('soft', G.cyl, mx(x, 0.3, z, 0, 0, Math.PI / 2, 1.78, 0.12, 1.78), 0xf4f5f9);
        k.put('pink', G.dot, mx(x * 1.014, 1.1, z, 0, 0, 0, 0.06, 0.4, 0.4));
      });
      [-3, -1.5, 0, 1.5, 3].forEach(function (x) { k.put('soft', G.arch, mx(x, 0.3, z, 0, Math.PI / 2, 0, 1.77), 0xf4f5f9); });
      [-3.3, -1.1, 1.1, 3.3].forEach(function (x) { col(u, x, z, 2.0, 2.2); });
    });
    k.put('soft', G.box, mx(0, 1.05, -4.5, 0, 0, 0, 2.4, 2.1, 1.7), 0xc3c7d2);                   // the hall
    k.put('soft', G.box, mx(0, 2.18, -4.5, 0, 0, 0, 2.6, 0.18, 1.9), 0xf4f5f9);
    k.put('soft', G.box, mx(0, 0.95, -5.37, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147);
    k.put('pink', G.box, mx(0, 2.0, -5.38, 0, 0, 0, 1.2, 0.14, 0.06));
    k.put('soft', G.cyl, mx(-3.4, 1.25, -4.6, 0, 0, 0, 0.8, 1.9, 0.8), 0xf4f5f9);                // water for the plants
    k.put('soft', G.dome, mx(-3.4, 2.2, -4.6, 0, 0, 0, 0.8, 0.4, 0.8), 0xf4f5f9);
    k.put('soft', G.band, mx(-3.4, 1.4, -4.6, Math.PI / 2, 0, 0, 0.82), 0x3d7dff);
    bake(u);
    col(u, 0, -4.6, 1.2, 2.3); col(u, -3.4, -4.6, 0.9, 2.6);
  }
  // one street lamp. yaw: which way its arm points
  function lamp(k, x, z, yaw) {
    k.base = mx(x, 0, z, 0, yaw, 0);
    k.put('soft', G.cyl6, mx(0, 0.1, 0, 0, 0, 0, 0.16, 0.2, 0.16), 0x3a3e4c);
    k.put('soft', G.cyl6, mx(0, 1.6, 0, 0, 0, 0, 0.055, 3.2, 0.055), 0x8a8fa0);
    k.put('soft', G.box, mx(0, 3.2, 0.3, 0, 0, 0, 0.08, 0.08, 0.7), 0x8a8fa0);
    k.put('win', G.dot, mx(0, 3.1, 0.6, 0, 0, 0, 0.2, 0.12, 0.2));
    k.base = null;
  }
  // lit streets of packed soil and two parked crew rovers. The lamp posts are thin: you can walk past them.
  function streets(u) {
    var k = u.kit, h = Math.PI / 2;
    function strip(ax, az, bx, bz, w) {
      var dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), n = Math.max(1, Math.round(len / 3)), i, t;
      var ox = Math.cos(yaw) * (w / 2 - 0.12), oz = -Math.sin(yaw) * (w / 2 - 0.12);
      k.put('rough', G.box, mx((ax + bx) / 2, 0.035, (az + bz) / 2, 0, yaw, 0, w, 0.07, len), M.road);
      for (i = 0; i < n; i++) {
        t = (i + 0.5) / n;
        k.put('cyan', G.box, mx(ax + dx * t + ox, 0.075, az + dz * t + oz, 0, yaw, 0, 0.08, 0.03, 0.9));
        k.put('cyan', G.box, mx(ax + dx * t - ox, 0.075, az + dz * t - oz, 0, yaw, 0, 0.08, 0.03, 0.9));
      }
    }
    strip(-20.9, 8.4, 13.5, 8.4, 2.4);            // the main street, across the way in
    strip(13.5, 8.8, 20.9, 8.8, 1.6);             // a footpath on to the school
    strip(-19.7, 7.2, -19.7, -6.5, 2.4);          // past the new homes
    strip(22.1, 9.6, 22.1, -8.5, 2.4);            // past the school
    [[-16.8, 6.95, 0], [-11.5, 6.95, 0], [-6, 6.95, 0], [6.2, 6.95, 0], [12.6, 6.95, 0], [-14.5, 9.85, 2 * h], [9.5, 9.85, 2 * h], [17.2, 9.85, 2 * h],
      [-18.25, 4, -h], [-18.25, -5.5, -h], [-21.15, 1.4, h], [-21.15, -5.9, h],
      [20.65, 5.5, h], [20.65, -0.5, h], [20.65, -6.6, h], [23.55, 2.5, -h], [23.55, -7.5, -h]].forEach(function (l) { lamp(k, l[0], l[1], l[2]); });
    parkRover(u, 26, -4.4, 0, 0x3d7dff);
    parkRover(u, -22.5, -15.8, 0.5, 0xffd23f);
    bake(u);
  }

  // ---------- stage 5: the first city ----------
  // a tall ship with three decks: the first liner to the new city
  function liner(u) {
    var k = u.kit, r, i, a;
    legs(k, 2.4, 1.5, 3.2, 2.4, 'soft', 0xb8bcc8);
    k.put('metal', G.bell, mx(0, 1.35, 0, 0, 0, 0, 1.05, 1.3, 1.05), 0x3a3e4c);
    k.put('soft', G.cyl, mx(0, 6.2, 0, 0, 0, 0, 1.7, 8.4, 1.7), 0xf4f5f9);
    k.put('soft', G.cone, mx(0, 12.1, 0, 0, 0, 0, 1.7, 3.4, 1.7), 0xf4f5f9);
    k.put('soft', G.cone, mx(0, 13.46, 0, 0, 0, 0, 0.42, 0.8, 0.42), 0xff8a3d);
    k.put('soft', G.cyl, mx(0, 2.1, 0, 0, 0, 0, 1.75, 0.3, 1.75), 0x2b3147);
    k.put('soft', G.cyl, mx(0, 9.2, 0, 0, 0, 0, 1.73, 0.35, 1.73), 0xff8a3d);
    [3.1, 9.75].forEach(function (y) { k.put('soft', G.band, mx(0, y, 0, Math.PI / 2, 0, 0, 1.73), 0x3d7dff); });
    for (i = 0; i < 4; i++) { a = Math.PI / 4 + i * Math.PI / 2; k.put('soft', G.box, mx(Math.sin(a) * 2.05, 3.6, Math.cos(a) * 2.05, 0, a, 0, 0.14, 2.6, 0.9), 0x3d7dff); }
    for (r = 0; r < 3; r++) for (i = 0; i < 8; i++) {
      a = (i + r * 0.5) * Math.PI / 4;
      k.put('win', G.dot, mx(Math.sin(a) * 1.68, 5.2 + r * 1.3, Math.cos(a) * 1.68, 0, a, 0, 0.26, 0.3, 0.09));
    }
    k.put('win', G.box, mx(0, 11.2, 1.28, -0.4636, 0, 0, 1.0, 0.4, 0.08));                       // the pilots' window
    k.put('soft', G.box, mx(0, 3.5, 1.72, 0, 0, 0, 0.95, 1.5, 0.1), 0x2b3147);
    k.put('soft', G.box, mx(0, 1.35, 2.3, -0.338, 0, 0, 0.8, 2.86, 0.08), 0x8a8fa0);
    k.put('blink2', G.dot, mx(0, 13.95, 0, 0, 0, 0, 0.12));
    bake(u); flame(u, 0.7, 1.05, 6);
    col(u, 0, 0, 3.2, 13);
  }
  // the launch tower beside the pad: a frame of struts, a covered bridge to the ship (+z) and a control hut
  function gantry(u) {
    var k = u.kit, H = 14, bay = H / 6, tilt = Math.atan2(1.5, bay), len = Math.hypot(1.5, bay), i, y, s;
    k.put('soft', G.box, mx(0, 0.2, 0, 0, 0, 0, 2.4, 0.4, 2.4), 0x4a4f63);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) { k.put('soft', G.box, mx(c[0] * 0.75, 0.4 + H / 2, c[1] * 0.75, 0, 0, 0, 0.16, H, 0.16), 0xff8a3d); });
    for (i = 0; i <= 6; i++) k.put('soft', G.box, mx(0, 0.4 + i * bay, 0, 0, 0, 0, 1.75, 0.1, 1.75), 0xdfe2ea);
    for (i = 0; i < 6; i++) {
      y = 0.4 + (i + 0.5) * bay; s = i % 2 ? 1 : -1;
      k.put('soft', G.box, mx(0, y, 0.75, 0, 0, s * tilt, 0.08, len, 0.08), 0xf4f5f9); k.put('soft', G.box, mx(0, y, -0.75, 0, 0, -s * tilt, 0.08, len, 0.08), 0xf4f5f9);
      k.put('soft', G.box, mx(0.75, y, 0, s * tilt, 0, 0, 0.08, len, 0.08), 0xf4f5f9); k.put('soft', G.box, mx(-0.75, y, 0, -s * tilt, 0, 0, 0.08, len, 0.08), 0xf4f5f9);
    }
    k.put('soft', G.box, mx(0, 8.25, 2.18, 0, 0, 0, 0.9, 1.5, 2.85), 0xf4f5f9);                  // the bridge
    k.put('soft', G.box, mx(0, 8.25, 3.52, 0, 0, 0, 1.1, 1.7, 0.18), 0xff8a3d);
    [-1, 1].forEach(function (e) { k.put('win', G.box, mx(e * 0.46, 8.4, 2.18, 0, 0, 0, 0.04, 0.5, 2.2)); });
    k.put('soft', G.cyl6, mx(0, 15.6, 0, 0, 0, 0, 0.05, 2.4, 0.05), 0xdfe2ea);
    k.put('blink', G.dot, mx(0, 16.9, 0, 0, 0, 0, 0.16));
    [-0.6, 0.6].forEach(function (x) { k.put('win', G.dot, mx(x, 14.25, 0.9, 0, 0, 0, 0.2)); });           // floodlights
    k.put('soft', G.box, mx(-2.5, 0.8, 0, 0, 0, 0, 2.2, 1.6, 1.7), 0xc3c7d2);                    // the control hut
    k.put('soft', G.box, mx(-2.5, 1.68, 0, 0, 0, 0, 2.4, 0.16, 1.9), 0x3d7dff);
    k.put('win', G.box, mx(-2.5, 1.05, 0.86, 0, 0, 0, 1.4, 0.4, 0.05));
    bake(u);
    col(u, 0, 0, 1.3, 14.5); col(u, -2.5, 0, 1.25, 1.8);
  }
  // the landmark: a park with trees and a pond under a clear dome. The door is at +z.
  function biodome(u) {
    var k = u.kit, R = 6.2, greens = [0x2fa64a, 0x4fd15a, 0x3bb85a], i, a;
    function tree(x, z, h, n) {
      k.put('soft', G.cyl8, mx(x, 0.45 + h * 0.2, z, 0, 0, 0, 0.11, h * 0.4, 0.11), 0x7a5230);
      k.put('rough', G.lump, mx(x, 0.45 + h * 0.6, z, 0, n, 0, h * 0.27, h * 0.34, h * 0.27), greens[n % 3]);
      k.put('rough', G.lump, mx(x + 0.1, 0.45 + h * 0.88, z - 0.08, 0, n * 2, 0, h * 0.19, h * 0.22, h * 0.19), greens[(n + 1) % 3]);
    }
    k.put('soft', G.disc, mx(0, 0.18, 0, 0, 0, 0, R + 0.3, 0.36, R + 0.3), 0xd7dae3);
    k.put('soft', G.disc, mx(0, 0.4, 0, 0, 0, 0, R - 0.25, 0.1, R - 0.25), 0x5fbf5a);              // grass
    k.put('soft', G.disc, mx(0, 0.42, 0, 0, 0, 0, 4.3, 0.1, 4.3), 0xe6ddc8);                     // a sandy path in a ring
    k.put('soft', G.disc, mx(0, 0.44, 0, 0, 0, 0, 3.4, 0.1, 3.4), 0x6fcf62);
    k.put('water', G.cyl, mx(0.5, 0.47, -0.3, 0, 0.4, 0, 2.1, 0.08, 1.45));                      // the pond
    [50, 95, 140, 185, 230, 275, 318].forEach(function (d, n) { a = d * Math.PI / 180; tree(Math.sin(a) * 4.75, Math.cos(a) * 4.75, 2.6 + (n % 3) * 0.15, n); });
    tree(-2.3, 1.2, 4.4, 7); tree(2.7, 1.6, 4.0, 8); tree(-0.9, -2.9, 3.6, 9);
    [[2.2, -2.3, 0.9], [-1.6, -1.6, -0.8]].forEach(function (b) { k.put('soft', G.box, mx(b[0], 0.69, b[1], 0, b[2], 0, 1.2, 0.4, 0.42), 0xf4f5f9); });     // benches
    [22, 72, 162, 252].forEach(function (d) {
      a = d * Math.PI / 180;
      k.put('soft', G.cyl6, mx(Math.sin(a) * 4.5, 1.35, Math.cos(a) * 4.5, 0, 0, 0, 0.05, 1.8, 0.05), 0x8a8fa0);
      k.put('win', G.dot, mx(Math.sin(a) * 4.5, 2.3, Math.cos(a) * 4.5, 0, 0, 0, 0.17));
    });
    k.put('ice', G.dome, mx(0, 0.36, 0, 0, 0, 0, R));
    for (i = 0; i < 4; i++) k.put('soft', G.rib, mx(0, 0.36, 0, 0, i * Math.PI / 4, 0, R + 0.02), 0xf4f5f9);
    k.put('soft', G.hoop, mx(0, 0.36 + R * 0.574, 0, Math.PI / 2, 0, 0, R * 0.819 + 0.02), 0xf4f5f9);
    k.put('soft', G.hoop, mx(0, 0.42, 0, Math.PI / 2, 0, 0, R, R, R * 1.4), 0xf4f5f9);
    k.put('soft', G.cyl, mx(0, 0.36 + R, 0, 0, 0, 0, 0.5, 0.14, 0.5), 0xf4f5f9);
    k.put('win', G.dot, mx(0, 0.36 + R + 0.2, 0, 0, 0, 0, 0.16));
    k.put('soft', G.box, mx(0, 1.15, R + 0.1, 0, 0, 0, 1.9, 2.3, 1.0), 0xc3c7d2);                 // the door
    k.put('soft', G.box, mx(0, 2.4, R + 0.1, 0, 0, 0, 2.1, 0.2, 1.2), 0x3d7dff);
    k.put('soft', G.box, mx(0, 1.0, R + 0.62, 0, 0, 0, 1.1, 1.8, 0.06), 0x2b3147);
    k.put('win', G.box, mx(0, 2.1, R + 0.63, 0, 0, 0, 1.2, 0.14, 0.06));
    bake(u);
    col(u, 0, 0, R + 0.25, 6.6); col(u, 0, R + 0.15, 0.95, 2.5);
  }
  // a tower of homes, four floors of lit windows
  function tower(u) {
    var k = u.kit, f, i, a, y;
    k.put('soft', G.cyl, mx(0, 0.2, 0, 0, 0, 0, 2.9, 0.4, 2.9), 0xd7dae3);
    k.put('soft', G.cyl, mx(0, 5.4, 0, 0, 0, 0, 2.6, 10, 2.6), 0xf4f5f9);
    k.put('soft', G.dome, mx(0, 10.4, 0, 0, 0, 0, 2.6, 1.4, 2.6), 0xf4f5f9);
    for (f = 0; f < 4; f++) {
      k.put('soft', G.band, mx(0, 2.9 + f * 2.5, 0, Math.PI / 2, 0, 0, 2.63), f === 3 ? 0xff8a3d : 0x3d7dff);
      for (i = 0; i < 9; i++) {
        if (f === 0 && i === 0) continue;                           // the door is here
        a = (i + f * 0.5) * Math.PI * 2 / 9; y = 1.85 + f * 2.5;
        if ((i * 7 + f * 3) % 5 === 0) k.put('soft', G.dot, mx(Math.sin(a) * 2.56, y, Math.cos(a) * 2.56, 0, a, 0, 0.32, 0.48, 0.09), 0x2b3147);      // nobody home
        else k.put('win', G.dot, mx(Math.sin(a) * 2.57, y, Math.cos(a) * 2.57, 0, a, 0, 0.32, 0.48, 0.1));
      }
    }
    for (i = 1; i < 12; i++) {                                      // a bank of soil bags around the bottom
      a = i * Math.PI / 6;
      k.put('rough', G.lump, mx(Math.sin(a) * 2.7, 0.5, Math.cos(a) * 2.7, Math.PI / 2 - 0.35, a, 0, 0.78, 0.42, 0.7), i % 2 ? M.soil : M.soil2);
    }
    k.put('win', G.cyl, mx(0, 11.82, 0, 0, 0, 0, 0.8, 0.06, 0.8));
    k.put('soft', G.cyl6, mx(0, 12.9, 0, 0, 0, 0, 0.06, 2.2, 0.06), 0xdfe2ea);
    k.put('blink', G.dot, mx(0, 14.05, 0, 0, 0, 0, 0.15));
    k.put('soft', G.box, mx(0, 1.15, 2.9, 0, 0, 0, 1.7, 2.3, 1.4), 0xc3c7d2);
    k.put('soft', G.box, mx(0, 2.35, 2.9, 0, 0, 0, 1.9, 0.2, 1.6), 0x3d7dff);
    k.put('soft', G.box, mx(0, 0.95, 3.62, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147);
    k.put('win', G.box, mx(0, 2.0, 3.63, 0, 0, 0, 1.2, 0.14, 0.06));
    bake(u);
    col(u, 0, 0, 3.1, 11.8); col(u, 0, 3.0, 0.9, 2.5);
  }
  // the ring road around the whole city, with a little tram and three stops
  var RING = 33.4, STOPS = [84, 266, 347.5].map(function (d) { return d * Math.PI / 180; });
  function tramCar(k, a) {
    k.base = mx(Math.sin(a) * RING, 0, Math.cos(a) * RING, 0, a, 0);
    k.put('soft', G.box, mx(0, 0.27, 0, 0, 0, 0, 3.3, 0.38, 1.3), 0x2b3147);
    k.put('soft', G.box, mx(0, 1.25, 0, 0, 0, 0, 3.4, 1.5, 1.5), 0xf4f5f9);
    k.put('soft', G.cyl, mx(0, 2.0, 0, 0, 0, Math.PI / 2, 0.75, 3.4, 0.75), 0xf4f5f9);
    k.put('soft', G.box, mx(0, 0.72, 0, 0, 0, 0, 3.43, 0.24, 1.53), 0xff8a3d);
    [-1.1, 0, 1.1].forEach(function (x) { [-1, 1].forEach(function (s) { k.put('win', G.box, mx(x, 1.5, s * 0.76, 0, 0, 0, 0.8, 0.62, 0.04)); }); });
    [-1, 1].forEach(function (s) { k.put('win', G.box, mx(s * 1.71, 1.5, 0, 0, 0, 0, 0.04, 0.62, 1.0)); });
    k.base = null;
  }
  function tramStop(u, a) {
    var k = u.kit, r = RING - 2.15;
    k.base = mx(Math.sin(a) * r, 0, Math.cos(a) * r, 0, a, 0);
    k.put('soft', G.box, mx(0, 0.08, 0, 0, 0, 0, 3.0, 0.16, 1.3), 0xd7dae3);
    [-1.25, 1.25].forEach(function (x) { k.put('soft', G.cyl6, mx(x, 1.2, -0.45, 0, 0, 0, 0.06, 2.3, 0.06), 0x8a8fa0); });
    k.put('soft', G.box, mx(0, 2.38, -0.1, 0, 0, 0, 3.0, 0.1, 1.4), 0xff8a3d);
    k.put('soft', G.box, mx(0, 0.36, -0.42, 0, 0, 0, 1.6, 0.4, 0.4), 0xf4f5f9);                  // a bench
    k.put('cyan', G.box, mx(0, 2.3, 0.5, 0, 0, 0, 2.6, 0.05, 0.1));
    k.base = null;
    [-1.25, 1.25].forEach(function (x) { col(u, Math.sin(a) * (r - 0.45) + Math.cos(a) * x, Math.cos(a) * (r - 0.45) - Math.sin(a) * x, 0.25, 2.4); });
  }
  function ringRoad(u) {
    var k = u.kit, n = 52, i, a, d = 1.9 / RING, tg, tk, c1, c2;
    k.put('rough', new T.RingGeometry(32, 34.8, 80, 1), mx(0, 0.06, 0, -Math.PI / 2, 0, 0), M.road);
    k.put('soft', new T.RingGeometry(RING - 0.09, RING + 0.09, 80, 1), mx(0, 0.075, 0, -Math.PI / 2, 0, 0), 0xb8bcc8);      // the tram's guide rail
    for (i = 0; i < n; i++) {
      a = i / n * Math.PI * 2;
      k.put('cyan', G.box, mx(Math.sin(a) * 32.12, 0.08, Math.cos(a) * 32.12, 0, a, 0, 0.9, 0.04, 0.1));
      k.put('cyan', G.box, mx(Math.sin(a) * 34.68, 0.08, Math.cos(a) * 34.68, 0, a, 0, 0.9, 0.04, 0.1));
    }
    STOPS.forEach(function (s) { tramStop(u, s); });
    bake(u);
    // the tram: two cars baked around the middle of the ring, so turning the group drives it along the road
    tg = new T.Group(); tk = new Kit();
    tramCar(tk, d); tramCar(tk, -d);
    tk.put('soft', G.box, mx(0, 0.7, RING, 0, 0, 0, 0.6, 0.3, 0.5), 0x2b3147);
    tk.put('win', G.dot, mx(Math.sin(d * 1.93) * RING, 0.95, Math.cos(d * 1.93) * RING, 0, 0, 0, 0.17));
    tk.bake(tg); u.g.add(tg);
    c1 = col(u, 0, RING, 1.25, 2.8); c2 = col(u, 0, RING, 1.25, 2.8);
    tram = { u: u, g: tg, a: STOPS[0] - 0.7, next: 0, wait: 0, gone: 99, d: d, cols: [c1, c2] };
    stepTram(0);
  }
  // the tram rolls from stop to stop, waits a moment at each, and its two colliders ride along with it
  function stepTram(dt) {
    var t = tram, full = Math.PI * 2, i, a, x, z, left, go;
    if (!t) return;
    if (t.wait > 0) t.wait -= dt;
    else {
      left = ((STOPS[t.next] - t.a) % full + full) % full * RING;
      go = 2.6 * clamp(Math.min(left, t.gone) / 4 + 0.1, 0.1, 1) * dt;
      if (go >= left) { t.a = STOPS[t.next]; t.next = (t.next + 1) % STOPS.length; t.wait = 3.5; t.gone = 0; }
      else { t.a += go / RING; t.gone += go; }
    }
    t.g.rotation.y = t.a;
    for (i = 0; i < 2; i++) {
      a = t.a + (i ? -t.d : t.d); x = Math.sin(a) * RING; z = Math.cos(a) * RING;
      t.cols[i].x = wx(x, z); t.cols[i].z = wz(x, z);
    }
  }
  // the town square: a little rocket to remember the first ship, and flags all around
  function square(u) {
    var k = u.kit, i, a, x, z;
    k.put('soft', G.disc, mx(0, 0.04, 0, 0, 0, 0, 4.5, 0.08, 4.5), 0xcfc8ba);
    k.put('soft', G.ring, mx(0, 0.085, 0, Math.PI / 2, 0, 0, 3.0, 3.0, 0.4), 0x3d7dff);
    k.put('soft', G.cyl, mx(0, 0.33, 0, 0, 0, 0, 1.05, 0.5, 1.05), 0xd7dae3);
    k.put('soft', G.cyl, mx(0, 0.83, 0, 0, 0, 0, 0.75, 0.5, 0.75), 0xf4f5f9);
    k.put('soft', G.band, mx(0, 1.08, 0, Math.PI / 2, 0, 0, 0.76), 0x3d7dff);
    k.put('soft', G.cyl8, mx(0, 2.1, 0, 0, 0, 0, 0.3, 1.5, 0.3), 0xffc533);                        // the rocket, in bright paint
    k.put('soft', G.cone, mx(0, 3.25, 0, 0, 0, 0, 0.3, 0.8, 0.3), 0xff8a3d);
    for (i = 0; i < 3; i++) { a = i * Math.PI * 2 / 3; k.put('soft', G.box, mx(Math.sin(a) * 0.4, 1.5, Math.cos(a) * 0.4, -0.25, a, 0, 0.07, 0.75, 0.45), 0x3d7dff); }
    k.put('soft', G.band, mx(0, 2.3, 0, 1.15, 0.5, 0, 0.95), 0xffd23f);
    for (i = 0; i < 6; i++) {
      a = (i + 0.5) * Math.PI / 3; x = Math.sin(a) * 3.9; z = Math.cos(a) * 3.9;
      k.put('soft', G.cyl6, mx(x, 2.2, z, 0, 0, 0, 0.05, 4.4, 0.05), 0xf2f3f7);
      k.put('soft', G.box, mx(x + 0.6, 3.95, z, 0, 0, 0, 1.1, 0.7, 0.04), COLORS[i]);
      k.put('soft', G.box, mx(x + 0.6, 3.95, z, 0, 0, 0, 1.1, 0.22, 0.06), 0xf2f3f7);
      k.put('win', G.dot, mx(x, 4.46, z, 0, 0, 0, 0.09));
      col(u, x, z, 0.2, 4.4);
      k.put('win', G.dot, mx(Math.sin(a) * 1.5, 0.14, Math.cos(a) * 1.5, 0, 0, 0, 0.1));       // little lights around the rocket
    }
    for (i = 0; i < 3; i++) {                                       // benches
      a = i * Math.PI * 2 / 3;
      k.put('soft', G.box, mx(Math.sin(a) * 3.2, 0.28, Math.cos(a) * 3.2, 0, a, 0, 1.3, 0.4, 0.45), 0xf4f5f9);
      col(u, Math.sin(a) * 3.2, Math.cos(a) * 3.2, 0.5, 0.5);
    }
    bake(u);
    col(u, 0, 0, 1.15, 3.6);
  }
  // more solar panels in an arc behind the town, and the box that stores their power
  function sunArc(u) {
    var k = u.kit, list = [], i, a;
    for (i = 0; i < 6; i++) { a = (163 + i * 7) * Math.PI / 180; list.push([Math.sin(a) * 29.6, Math.cos(a) * 29.6]); }
    panelField(u, list);
    k.put('soft', G.box, mx(-11.5, 0.7, -27.2, 0, 0.4, 0, 1.8, 1.4, 1.1), 0xc3c7d2);
    k.put('soft', G.box, mx(-11.5, 1.45, -27.2, 0, 0.4, 0, 1.95, 0.12, 1.25), 0xff8a3d);
    k.put('green', G.box, mx(-11.28, 0.95, -26.69, 0, 0.4, 0, 1.0, 0.12, 0.05));
    bake(u);
    col(u, -11.5, -27.2, 1.05, 1.5);
  }

  // ---------- settlers ----------
  // Little astronauts in white suits with coloured helmets. They walk back and forth between doors,
  // stop for a moment at each end, and wave when you come close. On the Moon they bunny-hop.
  var COLORS = [0xff8a3d, 0x4fd8ff, 0x7be36a, 0xff6fb1, 0xffd23f, 0xb48cff, 0xff5468, 0x46e0c0];
  var ROUTES = {
    2: [[[4.7, -3.5], [3.6, 0.5], [4.7, 4.5]], [[0.8, 3.2], [-6, 6.6], [-15, 7.3]], [[0.2, -12.6], [3.4, -8.0], [4.7, -3.5]], [[-4.2, -6.6], [-1.5, -1.0], [1.2, 2.2]]],
    3: [[[4.7, -3.5], [3.6, 0.5], [4.7, 4.5]], [[0.8, 3.2], [-6, 6.6], [-15, 7.3]], [[0.2, -12.6], [-4.2, -11.0], [-7.6, -12.0]], [[-1.6, 4.8], [-1.0, -1.2]],
      [[13.2, -4.6], [13.2, 7.6]], [[10.3, -10.2], [12.6, -9.0], [17.6, -9.6]], [[-8.0, 6.5], [-4.5, 5.0], [-1.2, 3.4]], [[-1.2, 7.0], [-1.0, 18.5]]]
  };
  // part of a circle, as a path (angles in degrees, from +z round to +x)
  function arc(cx, cz, r, d0, d1, n) {
    var out = [], i, a;
    for (i = 0; i <= n; i++) { a = (d0 + (d1 - d0) * i / n) * Math.PI / 180; out.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
    return out;
  }
  function raised(route, y) { route.y = y; return route; }      // a path on a floor above the ground
  // stage 4, 14 people: along the new streets and between the new doors
  ROUTES[4] = ROUTES[3].concat([
    [[-18.5, 8.4], [-5.5, 8.4]], [[4.5, 8.4], [13.5, 8.6], [16.2, 11.4]], [[-19.7, 6.5], [-19.7, -6]],
    [[-21.7, 5.2], [-20.3, 1.4], [-22.2, -2.3]], [[22.1, 8.6], [22.1, 2], [22.1, -7.5]], [[-3.6, -18.6], [1.8, -20.6], [5.3, -20.3]]
  ]);
  // stage 5, 24 people: in the park under the dome, on the square, at the spaceport, along the ring road, at a tram stop
  ROUTES[5] = ROUTES[4].concat([
    raised(arc(-18, 17.8, 3.85, 10, 115, 5), 0.49), raised(arc(-18, 17.8, 3.85, 130, 235, 5), 0.49), raised(arc(-18, 17.8, 3.85, 250, 350, 5), 0.49),
    arc(-8.5, 25.5, 2.3, -150, 25, 5), [[-3.6, 30.3], [-3.5, 24], [-3.6, 17.5]],
    [[10.9, -18.6], [8.2, -18.2], [5.6, -20.4]], [[22.8, -10.6], [22.1, -7.5], [22.1, -1]],
    arc(0, 0, 31.3, 14, 36, 4), arc(0, 0, 31.2, -88, -66, 4), raised([[31.15, 4.6], [31.4, 2.2]], 0.16)
  ]);
  var mB = new T.Matrix4(), mL = new T.Matrix4(), mO = new T.Matrix4(), UP = new T.Vector3(0, 1, 0);
  function settlerGeos() {
    var body = merge([
      { g: new T.CapsuleGeometry(0.34, 0.42, 4, 12), m: mx(0, 1.12, 0), c: 0xf5f6fa },
      { g: G.box, m: mx(0, 1.2, -0.38, 0, 0, 0, 0.58, 0.72, 0.28), c: 0xcfd3de },
      { g: G.box, m: mx(0, 1.24, 0.33, 0, 0, 0, 0.34, 0.2, 0.08), c: 0x2b3147 },
      { g: new T.TorusGeometry(0.32, 0.07, 6, 16), m: mx(0, 1.5, 0, Math.PI / 2, 0, 0), c: 0xcfd3de }
    ], true);
    var helmet = new T.SphereGeometry(0.44, 16, 12); helmet.translate(0, 1.78, 0);
    var visor = new T.SphereGeometry(0.37, 16, 12); visor.scale(1, 0.78, 0.92); visor.translate(0, 1.76, 0.2);
    var limb = new T.CapsuleGeometry(0.125, 0.34, 3, 6); limb.translate(0, -0.3, 0);      // thin, and there are four for each of up to 24 people: keep them cheap
    return { body: body, helmet: helmet, visor: visor, limb: limb };
  }
  // n instanced figures (the colony uses up to 24, the future vision a crowd)
  function makeCrowd(parent, n, geos) {
    function im(geo, m, count) { var x = new T.InstancedMesh(geo, m, count); x.castShadow = true; x.receiveShadow = true; x.frustumCulled = false; x.count = 0; parent.add(x); return x; }
    var c = { n: n, body: im(geos.body, M.soft, n), helmet: im(geos.helmet, M.helmet, n), visor: im(geos.visor, M.visor, n), limbs: im(geos.limb, M.white, n * 4), people: [] };
    for (var i = 0; i < n; i++) c.helmet.setColorAt(i, cTmp.set(COLORS[i % COLORS.length]));
    if (c.helmet.instanceColor) c.helmet.instanceColor.needsUpdate = true;
    return c;
  }
  function routeOf(pts) {
    var lens = [], total = 0;
    for (var i = 1; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(d); total += d; }
    return { pts: pts, lens: lens, total: total };
  }
  function along(r, s, out) {
    s = clamp(s, 0, r.total);
    for (var i = 0; i < r.lens.length; i++) {
      if (s <= r.lens[i] || i === r.lens.length - 1) {
        var a = r.pts[i], b = r.pts[i + 1], t = r.lens[i] ? clamp(s / r.lens[i], 0, 1) : 0;
        out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; out.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        return out;
      }
      s -= r.lens[i];
    }
    return out;
  }
  function person(route, k, y) {
    var p = { r: routeOf(route), s: 0, dir: k % 2 ? -1 : 1, wait: 0.5 + (k % 3) * 0.9, x: 0, z: 0, y: y || 0, yaw: 0, phase: k * 1.3, wave: 0, appear: 1, speed: 1.0 + (k % 4) * 0.08, walk: 0, at: {} };
    p.s = p.r.total * ((k * 0.37) % 1);
    along(p.r, p.s, p.at); p.x = p.at.x; p.z = p.at.z; p.yaw = p.at.yaw;
    return p;
  }
  function placeMen(n, instant) {
    if (!men) return;
    var list = ROUTES[n] || [], old = men.people;
    men.people = list.map(function (r, k) {
      var p = person(r, k, r.y || 0);
      p.appear = instant || k < old.length ? 1 : 0;
      p.delay = instant ? 0 : (k - old.length) * 0.35;
      return p;
    });
    if (!list.length) men.people = [];
  }
  function angTo(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  // move one figure and write its instance matrices. greet: a point (crowd-local) to wave at, or null.
  function stepPerson(c, i, p, dt, greet, moon) {
    var gd = greet ? Math.hypot(greet.x - p.x, greet.z - p.z) : 99;
    if (p.delay > 0) { p.delay -= dt; p.appear = 0; } else if (p.appear < 1) p.appear = Math.min(1, p.appear + dt * 1.6);
    var waving = gd < 7 && p.appear >= 1;
    p.wave += ((waving ? 1 : 0) - p.wave) * Math.min(1, dt * 5);
    var moving = false;
    if (waving) p.yaw = angTo(p.yaw, Math.atan2(greet.x - p.x, greet.z - p.z), Math.min(1, dt * 5));
    else if (p.wait > 0) p.wait -= dt;
    else {
      p.s += p.dir * p.speed * dt;
      if (p.s >= p.r.total || p.s <= 0) { p.s = clamp(p.s, 0, p.r.total); p.dir = -p.dir; p.wait = 1.4 + Math.random() * 2.4; }
      along(p.r, p.s, p.at); p.x = p.at.x; p.z = p.at.z;
      p.yaw = angTo(p.yaw, p.at.yaw + (p.dir < 0 ? Math.PI : 0), Math.min(1, dt * 7));
      moving = true;
    }
    p.walk += ((moving ? 1 : 0) - p.walk) * Math.min(1, dt * 6);
    p.phase += dt * (moon ? 4.2 : 6.4) * p.walk;
    var sw = Math.sin(p.phase), w = p.walk, sc = Math.max(0.001, pop(p.appear));
    var bob = moon ? Math.abs(sw) * 0.2 * w : Math.abs(sw) * 0.05 * w;
    if (p.ground) p.y = Tn.height(p.x, p.z);
    mB.compose(p1.set(p.x, p.y + bob, p.z), q1.setFromAxisAngle(UP, p.yaw), s1.set(sc, sc, sc));
    c.body.setMatrixAt(i, mB); c.helmet.setMatrixAt(i, mB); c.visor.setMatrixAt(i, mB);
    var legA = moon ? -0.35 * w * Math.abs(sw) : 0.55 * sw * w, legB = moon ? legA : -legA;
    var armA = moon ? -0.5 * w : -0.45 * sw * w;
    limb(c, i * 4, mB, -0.2, 0.66, legA, 0, 1);
    limb(c, i * 4 + 1, mB, 0.2, 0.66, legB, 0, 1);
    limb(c, i * 4 + 2, mB, -0.47, 1.42, armA, -0.12, 0.82);
    limb(c, i * 4 + 3, mB, 0.47, 1.42, lerp(moon ? armA : -armA, -0.2, p.wave), lerp(0.12, 2.6 + Math.sin(tm * 9 + i) * 0.35, p.wave), 0.82);
  }
  function limb(c, j, base, x, y, rx, rz, w) {
    e1.set(rx, 0, rz, 'XYZ'); q1.setFromEuler(e1);
    mL.compose(p1.set(x, y, 0), q1, s1.set(w, 1, w));
    mO.multiplyMatrices(base, mL); c.limbs.setMatrixAt(j, mO);
  }
  function flushCrowd(c, n) {
    c.body.count = c.helmet.count = c.visor.count = n; c.limbs.count = n * 4;
    c.body.instanceMatrix.needsUpdate = c.helmet.instanceMatrix.needsUpdate = c.visor.instanceMatrix.needsUpdate = c.limbs.instanceMatrix.needsUpdate = true;
  }
  function stepMen(dt, ctx) {
    var list = men.people, greet = null, n = Math.min(list.length, men.n);
    if (ctx.pos && ctx.mode === 'play') { v1.set(lx(ctx.pos.x, ctx.pos.z), 0, lz(ctx.pos.x, ctx.pos.z)); greet = v1; }
    for (var i = 0; i < n; i++) stepPerson(men, i, list[i], dt, greet, site === 'moon');
    flushCrowd(men, n);
  }

  // ---------- arrivals ----------
  var LAND = 6.2, END = 9.8;
  function setCols(u, on) {
    var C = JA.base && JA.base.colliders;
    if (C && on && !u.on) u.cols.forEach(function (c) { C.push(c); });
    if (C && !on && u.on) u.cols.forEach(function (c) { var i = C.indexOf(c); if (i >= 0) C.splice(i, 1); });
    u.on = !!on;
  }
  function show(u, on) {
    u.g.visible = !!on; u.g.scale.setScalar(1);
    if (u.ship) { u.g.position.copy(u.home); u.g.rotation.x = 0; u.ship.flame.visible = u.ship.core.visible = false; }
    setCols(u, on);
  }
  function shipOf(n) { for (var i = 0; i < units.length; i++) if (units[i].stage === n && units[i].ship) return units[i]; return null; }
  function near(ctx, x, z, r) { return ctx && ctx.pos && Math.hypot(ctx.pos.x - x, ctx.pos.z - z) < r; }
  function sound(ctx, name, r) { if (JA.audio && ctx && (ctx.mode === 'play' || ctx.mode === 'inside') && near(ctx, CX, CZ, r || 140)) JA.audio.play(name); }
  function dustRing(x, z, n, speed, size) {
    var X = wx(x, z), Z = wz(x, z), col = site === 'mars' ? 0xd9a070 : 0xb8b9c4;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = speed * (0.5 + Math.random() * 0.7), r0 = Math.random() * 2;
      W.emit(X + Math.cos(a) * r0, h0 + 0.4, Z + Math.sin(a) * r0, { vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.6, vz: Math.sin(a) * sp, life: 1.6 + Math.random(), size: size, grow: 3.4, color: col, alpha: 0.4, grav: W.gravity * 0.08 });
    }
  }
  function startArrival(n) {
    var ship = shipOf(n);
    units.forEach(function (u) { if (u.stage === n && u.pre) show(u, true); });
    if (!ship) { units.forEach(function (u) { if (u.stage === n) show(u, true); }); placeMen(n, true); return; }
    arr = { n: n, t: 0, ship: ship, landed: false, men: false, rum: 0,
      list: units.filter(function (u) { return u.stage === n && !u.ship && !u.pre; }) };
    arr.list.forEach(function (u) { u.done = false; });
    var a = -0.35 + (n - 2) * 0.5, d = Math.hypot(a, 1);
    arr.ox = a / d; arr.oz = -1 / d;                       // ships fly in from behind the colony
    ship.g.visible = true; ship.g.scale.setScalar(1);
    fx.beacon.position.set(ship.home.x, 0.14, ship.home.z); fx.beacon.visible = true;
    fx.glow.position.set(ship.home.x, 0.1, ship.home.z); fx.glow.visible = true;
    stepArrival(0, null);
  }
  function stepArrival(dt, ctx) {
    var a = arr, t = a.t += dt, sh = a.ship, h = sh.home, sp = sh.ship, i;
    if (t < LAND) {
      var k = 1 - t / LAND, alt = 125 * Math.pow(k, 2.1), off = 75 * k * k;
      sh.g.position.set(h.x + a.ox * off, alt, h.z + a.oz * off);
      sh.g.rotation.x = -0.32 * k + Math.sin(t * 2.3) * 0.015 * k;
      sp.flame.visible = sp.core.visible = true;
      var fl = 0.75 + Math.random() * 0.45 + (alt < 30 ? 0.3 : 0);
      sp.flame.scale.y = sp.len * fl; sp.flame.position.y = sp.y - sp.len * fl / 2;
      sp.core.scale.y = sp.len * fl * 0.45; sp.core.position.y = sp.y - sp.len * fl * 0.22;
      sp.flame.material.opacity = 0.55 + Math.random() * 0.3;
      fx.glow.material.opacity = 0.85 * clamp(1 - alt / 45, 0, 1) * (0.85 + Math.random() * 0.15);
      fx.glow.scale.setScalar(5 + Math.min(alt, 40) * 0.22);
      fx.beacon.material.emissiveIntensity = 1 + Math.sin(t * 8) * 0.8;
      fx.beacon.rotation.z = t;
      if (alt < 28 && dt > 0) {
        var gx = wx(sh.g.position.x, sh.g.position.z), gz = wz(sh.g.position.x, sh.g.position.z), dc = site === 'mars' ? 0xd9a070 : 0xb8b9c4;
        for (i = W.rate((1 - alt / 28) * 7, dt); i > 0; i--) {
          var an = Math.random() * 6.283, r0 = 1.5 + Math.random() * 3, v = 9 + Math.random() * 16;
          W.emit(gx + Math.cos(an) * r0, h0 + 0.35, gz + Math.sin(an) * r0, { vx: Math.cos(an) * v, vy: 0.3 + Math.random() * 1.4, vz: Math.sin(an) * v, life: 1.3, size: 1.3, grow: 3.4, color: dc, alpha: 0.4, grav: 0 });
        }
      }
      a.rum -= dt;
      if (a.rum <= 0 && dt > 0) { a.rum = 0.45; sound(ctx, 'rumble', 110); }
    } else if (!a.landed) {
      a.landed = true;
      sh.g.position.copy(h); sh.g.rotation.x = 0; sp.flame.visible = sp.core.visible = false;
      fx.beacon.visible = false;
      setCols(sh, true);
      dustRing(h.x, h.z, 70, 15, 1.4);
      sound(ctx, 'touchdown', 120);
      if (near(ctx, CX, CZ, 70) && ctx.mode === 'play') W.cam.shake = Math.max(W.cam.shake, 0.35);
    }
    if (a.landed) fx.glow.material.opacity = Math.max(0, fx.glow.material.opacity - dt * 1.6);
    for (i = 0; i < a.list.length; i++) {
      var u = a.list[i], t0 = LAND + 0.5 + u.delay;
      if (t < t0) { u.g.visible = false; continue; }
      if (!u.done) {
        u.done = true; u.g.visible = true; setCols(u, true);
        dustRing(u.g.position.x, u.g.position.z, 14, 4, 0.9);
        if (i % 2 === 0) sound(ctx, 'pop', 90);
      }
      u.g.scale.setScalar(Math.max(0.001, pop(seg(t, t0, t0 + 0.75))));
    }
    if (!a.men && t > LAND + 1.0) { a.men = true; placeMen(a.n, false); }
    if (t >= END) finishArrival();
  }
  function finishArrival() {
    if (!arr) return;
    var a = arr; arr = null;
    units.forEach(function (u) { if (u.stage === a.n) show(u, true); });
    if (!a.men) placeMen(a.n, true);
    setPop(a.n);
    fx.beacon.visible = false; fx.glow.visible = false; fx.glow.material.opacity = 0;
  }

  // ---------- set-up ----------
  function buildAll(rootGroup, siteId) {
    if (vis) endVision(true);
    site = siteId === 'moon' ? 'moon' : 'mars';
    units = []; stageNow = 0; arr = null; men = null; fields = []; tram = null; signT = null; popNow = K.people(3); tm = 0;
    G = makeGeos(); M = makeMats();
    var L = (Tn.L && Tn.L.colony) || [40, -62];
    CX = L[0]; CZ = L[1]; h0 = Tn.height(CX, CZ);
    ROT = Math.atan2(-CX, -CZ); cosR = Math.cos(ROT); sinR = Math.sin(ROT);
    grp = new T.Group(); grp.name = 'colony'; grp.position.set(CX, h0, CZ); grp.rotation.y = ROT;
    rootGroup.add(grp);
    // stage 1: the supply ship
    cargoLander(unit(1, -14, -12, Math.PI / 2));
    crates(unit(1, -7.5, -7.5, 0, 0));
    garage(unit(1, -15, 2, 0, 0.4));
    rover(unit(1, -10.2, 11.6, 0.95, 0.8));
    pathLights(unit(1, 0, 0, 0, 1.1));
    // stage 2: the first settlers
    crewLander(unit(2, 0, -16, 0));
    hab2(unit(2, 9, -5, 0, 0));
    greenhouse(unit(2, 9, 4.5, 0, 0.55));
    // stage 3: a small town
    var p = unit(3, 14, -13, 0); pad(p); p.pre = true;
    shuttle(unit(3, 14, -13, -0.9));
    hub(unit(3, -1, -6, 0, 0));
    tubes(unit(3, 0, 0, 0, 0.6));
    shieldDome(unit(3, -8, 1, 0, 0.3));
    solarFarm(unit(3, 0, 0, 0, 0.9));
    plaza(unit(3, 0, 1.5, 0, 1.15));
    sign(unit(3, 5.2, 15.5, 0, 1.4));
    // stage 4: a growing town, in a ring around the first one
    p = unit(4, -16, -21.5, 0); pad(p, 4.3); p.pre = true;
    ferry(unit(4, -16, -21.5, 0.64));
    homes(unit(4, -26.1, -2.3, 0, 0));
    streets(unit(4, 0, 0, 0, 0.35));
    tankFarm(unit(4, -6, -24.2, 0.243, 0.7));
    farm(unit(4, 21.5, 15.5, 0.945, 1.05));
    school(unit(4, 27.6, 2.5, -Math.PI / 2, 1.4));
    mast(unit(4, 3.5, -23.5, -0.148, 1.75));
    // stage 5: the first city, out to the ring road
    p = unit(5, 13.3, -23, 0); pad(p, 4.6); p.pre = true;
    liner(unit(5, 13.3, -23, -0.524));
    gantry(unit(5, 18.06, -20.25, -2.095, 0));
    ringRoad(unit(5, 0, 0, 0, 0.4));
    biodome(unit(5, -18, 17.8, -2.937, 0.8));
    tower(unit(5, 26.6, -10.6, -Math.PI / 2, 1.2));
    square(unit(5, -8.5, 25.5, 0, 1.5));
    sunArc(unit(5, 0, 0, 0, 1.8));
    units.forEach(function (u) { u.home = u.g.position.clone(); });
    aimPanels(true);
    // effects shared by every arrival
    fx = {
      beacon: new T.Mesh(G.ring, M.ring),
      glow: new T.Mesh(new T.PlaneGeometry(1, 1), M.groundGlow)
    };
    fx.beacon.rotation.x = Math.PI / 2; fx.beacon.scale.set(3.2, 3.2, 2.5); fx.beacon.visible = false;
    fx.glow.rotation.x = -Math.PI / 2; fx.glow.visible = false; fx.glow.renderOrder = 4;
    grp.add(fx.beacon); grp.add(fx.glow);
    var sg = settlerGeos();
    men = makeCrowd(grp, ROUTES[LAST].length, sg); men.geos = sg;
    placeMen(0, true);
  }

  function animLights() {
    M.blink.emissiveIntensity = tm % 1.6 < 0.22 ? 2.8 : 0.25;
    M.blink2.emissiveIntensity = (tm + 0.8) % 1.6 < 0.22 ? 2.8 : 0.25;
    M.pink.emissiveIntensity = 1.75 + Math.sin(tm * 1.3) * 0.25;
    M.haze.opacity = 0.17 + Math.sin(tm * 1.3) * 0.04;
    M.win.emissiveIntensity = 1.45 + Math.sin(tm * 0.7) * 0.08;
  }

  // the welcome sign counts the people
  function setPop(n) {
    var p = K.people(Math.max(3, n));
    if (p === popNow) return;
    popNow = p;
    if (signT && signT.userData.redraw) signT.userData.redraw();
  }
  var WORDS = { 4: 'Four', 12: 'Twelve', 30: 'Thirty', 80: 'Eighty' };
  function howMany(n) { var p = K.people(n); return WORDS[p] || String(p); }

  K.build = function (rootGroup, siteId) {
    try { buildAll(rootGroup, siteId); } catch (e) { warn(e); grp = null; }
  };
  K.setStage = function (n, opts) {
    if (!grp) return;
    try {
      n = clamp(Math.round(+n || 0), 0, LAST);
      if (arr) finishArrival();
      var animate = !!(opts && opts.arrive) && n > 0 && n > stageNow;
      units.forEach(function (u) { show(u, u.stage < n || (u.stage === n && !animate)); });
      var from = stageNow;
      stageNow = n;
      if (animate) {
        if (n - 1 !== from) placeMen(n - 1, true);
        startArrival(n);
      } else placeMen(n, true);
      if (n >= 3) aimPanels(true);
      setPop(animate ? n - 1 : n);                     // the newcomers are counted once their ship has landed
    } catch (e) { warn(e); }
  };
  K.stage = function () { return stageNow; };
  // how many people the story gives stage n (the stage now if n is left out): 0, 0, 4, 12, 30, 80
  K.people = function (n) {
    try {
      var list = (JA.RULES && JA.RULES.townPeople) || PEOPLE;
      n = clamp(Math.round(n == null ? stageNow : +n || 0), 0, LAST);
      return list[n] != null ? list[n] : PEOPLE[n];
    } catch (e) { warn(e); return 0; }
  };
  K.update = function (dt, ctx) {
    if (!grp) return;
    try {
      dt = clamp(+dt || 0, 0, 0.1); ctx = ctx || {};
      tm += dt;
      if (vis) { vis.last = Date.now(); stepVision(dt); }
      if (arr) stepArrival(dt, ctx);
      if (tram && tram.u.g.visible) stepTram(dt);
      animLights();
      if (stageNow >= 3 || vis) aimPanels(false);
      if (men) stepMen(dt, vis ? {} : ctx);
    } catch (e) { warn(e); }
  };
  K.town = function () { return TOWN[site]; };
  K.busy = function () { return !!arr; };
  // where to look: the ship while one is landing, otherwise the middle of the colony
  K.focus = function (out) {
    out = out || new T.Vector3();
    if (arr && arr.ship) { var g = arr.ship.g.position; return out.set(wx(g.x, g.z), h0 + g.y + 4, wz(g.x, g.z)); }
    return out.set(CX, h0 + 4, CZ);
  };
  K.info = function (n) {
    var moon = site === 'moon', name = TOWN[site];
    if (n === 1) return { icon: '📦', title: 'A supply ship from Earth!',
      text: 'You kept the outpost running, so Earth sent a cargo lander. It came down on the flat plain north-east of the habitat with crates of food, tools and spare parts, a garage that holds air and a new rover. ' +
        (moon ? 'Real Moon plans work like this: robot landers bring supplies first, so everything is ready when more people arrive.'
          : 'The trip from Earth takes about seven months, so real Mars plans send supplies ahead, long before people need them.') };
    if (n === 2) return { icon: '🧑‍🚀', title: 'The first settlers are here!',
      text: 'Four new crew members moved in next door. Their home inflates like a balloon. A real inflatable room called BEAM was added to the International Space Station in 2016. ' +
        'Their greenhouse glows pink because plants grow well under red and blue light, just like the Veggie garden on the Space Station.' };
    if (n === 3) return { icon: '🏘️', title: 'Welcome to ' + name + '!',
      text: 'Twelve people now live in ' + name + ', the first little town on ' + (moon ? 'the Moon' : 'Mars') + '! ' +
        (moon ? 'Its solar panels stand up tall, because near the south pole the Sun always stays low in the sky. '
          : 'Mars gets less than half the sunlight that Earth does, so the town needs a big solar farm. ') +
        'A hard landing pad stops rocket blasts from spraying dust and stones at the houses.' };
    if (n === 4) return { icon: '🏫', title: name + ' is growing!',
      text: howMany(4) + ' people live in ' + name + ' now. A big ferry brought whole families, so the town built more homes, a school, a farm of greenhouse tunnels and tall tanks of water and oxygen. ' +
        'This town is imagined, but the idea is real: on the Space Station, about 98 of every 100 drops of water are cleaned and used again.' };
    if (n === 5) return { icon: '🌆', title: 'The first city on ' + (moon ? 'the Moon' : 'Mars') + '!',
      text: howMany(5) + ' people call ' + name + ' home now. A little tram circles the ring road, a spaceport welcomes big ships, and trees grow around a pond under a clear dome. ' +
        'It is an imagined future built on real ideas: NASA\'s Ice Home design' + (moon ? ', first drawn for Mars,' : ' for Mars') + ' has walls of water ice that let sunlight in and keep space radiation out.' };
    return null;
  };

  // =====================================================================
  //  THE FUTURE VISION: an imagined flyover, 10, 30 and 100 years later
  // =====================================================================
  var vis = null;
  var VT = { e1: 9, e2: 21, e3: 34, fin: 47, end: 55 };
  var VM = null, VG = null;

  function track(o) { vis.trash.push(o); return o; }
  function rnd(seed) { return JA.sim && JA.sim.rng32 ? JA.sim.rng32(seed) : Math.random; }
  function gmin(x, z, r) {
    var h = Tn.height(x, z);
    for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; h = Math.min(h, Tn.height(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
    return h;
  }
  function cw(x, z) { return { x: wx(x, z), z: wz(x, z) }; }
  function P(x, z) { return { x: x, z: z }; }
  function toward(a, b, d) { var dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return P(a.x + dx / l * d, a.z + dz / l * d); }
  function item(x, y, z, ry, sx, sy, sz, d, rx, rz) {
    return { x: x, y: y, z: z, ry: ry || 0, rx: rx || 0, rz: rz || 0, sx: sx, sy: sy == null ? sx : sy, sz: sz == null ? sx : sz, d: d || 0 };
  }
  // repeated parts of one era, growing out of the ground one after another
  function vinst(era, geo, mat, items, shadow) {
    var im = new T.InstancedMesh(geo, mat, Math.max(1, items.length));
    im.frustumCulled = false; im.count = 0;
    if (shadow !== false && !mat.transparent) { im.castShadow = true; im.receiveShadow = true; }
    vis.root.add(im);
    var r = { era: era, im: im, items: items, done: false };
    vis.insts.push(r);
    return r;
  }
  function vgroup(era, g, d, puff) { g.visible = false; g.scale.setScalar(0.001); vis.root.add(g); vis.groups.push({ era: era, g: g, d: d || 0, puff: puff || 0, done: false }); return g; }
  function bakeV(kit, parent) { kit.bake(parent).forEach(function (m) { track(m.geometry); }); }
  function puffAt(x, z, n, size) {
    var col = site === 'mars' ? 0xd9a070 : 0xb8b9c4, y = Tn.height(x, z) + 0.5;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = 3 + Math.random() * 5;
      W.emit(x + Math.cos(a) * size * 0.8, y, z + Math.sin(a) * size * 0.8, { vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.5, vz: Math.sin(a) * sp, life: 2 + Math.random(), size: size * 0.35 + 0.8, grow: 3, color: col, alpha: 0.35, grav: 0 });
    }
  }

  function towerTex(lit) {
    var t = canvasTex(128, 256, function (ctx, w, h) {
      var r = rnd(55), x, y;
      ctx.fillStyle = lit ? '#000000' : '#e4e7ee'; ctx.fillRect(0, 0, w, h);
      for (y = 0; y < 16; y++) for (x = 0; x < 8; x++) {
        var on = r() < 0.62;
        if (lit && !on) continue;
        ctx.fillStyle = lit ? '#ffd98a' : on ? '#ffe9b8' : '#8d96ad';
        ctx.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
      }
      if (!lit) { ctx.fillStyle = '#3d7dff'; for (y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 3); }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 2);
    return track(t);
  }
  function visionStuff() {
    var moon = site === 'moon';
    VG = {
      tower: track(new T.CylinderGeometry(1, 1, 1, 18)), lump: track(new T.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
      band: track(new T.TorusGeometry(1, 0.022, 6, 64)), capsule: track(new T.CapsuleGeometry(1, 2, 6, 16)),
      tunnel: track(new T.CylinderGeometry(1, 1, 1, 16, 1, true, 0, Math.PI))
    };
    VG.tower.translate(0, 0.5, 0); VG.capsule.rotateX(Math.PI / 2); VG.tunnel.rotateZ(Math.PI / 2);
    // a lumpy pile of soil over a dome: nudge each point in or out by a smooth noise
    var p = VG.lump.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + (Tn.noise(x * 3 + 7, z * 3 + y * 2) - 0.5) * 0.12 * Math.min(1, y * 3 + 0.2);
      p.setXYZ(i, x * n, y * n, z * n);
    }
    VG.lump.computeVertexNormals();
    VG.rover = track(merge([
      { g: new T.CapsuleGeometry(1.0, 2.6, 4, 12), m: mx(0, 1.45, 0, Math.PI / 2, 0, 0), c: 0xf2f3f7 },
      { g: G.box, m: mx(0, 1.15, 0, 0, 0, 0, 2.1, 0.32, 4.1), c: 0xff8a3d },
      { g: G.box, m: mx(0, 1.85, 1.9, -0.5, 0, 0, 1.4, 0.45, 0.12), c: 0x2b3147 },
      { g: G.box, m: mx(-1.05, 0.48, 0, 0, 0, 0, 0.42, 0.95, 3.9), c: 0x22252f },
      { g: G.box, m: mx(1.05, 0.48, 0, 0, 0, 0, 0.42, 0.95, 3.9), c: 0x22252f }
    ], true));
    VG.lights = track(merge([{ g: G.ball, m: mx(-0.65, 1.2, 2.55, 0, 0, 0, 0.2) }, { g: G.ball, m: mx(0.65, 1.2, 2.55, 0, 0, 0, 0.2) }], false));
    VM = {
      regolith: track(new T.MeshStandardMaterial({ color: moon ? 0x8a8b95 : 0xb5643a, roughness: 1, metalness: 0, flatShading: true })),
      glass: track(new T.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.27, roughness: 0.05, metalness: 0.2, emissive: 0x7fc4ff, emissiveIntensity: 0.2, depthWrite: false, side: T.DoubleSide })),
      park: track(W.soft(0x5fbf5a)), tree: track(W.mat(0x2f9a4a)), pad: track(W.soft(0x4a4f63)),
      lake: track(glowMat(0x3aa0ff, 0.55)),
      gh: track(new T.MeshStandardMaterial({ color: 0xffc8ee, transparent: true, opacity: 0.5, roughness: 0.1, emissive: 0xff4fc8, emissiveIntensity: 0.85, depthWrite: false, side: T.DoubleSide })),
      road: track(W.soft(moon ? 0x3d3f4a : 0x5a3a2a, { roughness: 0.95 })), roadGlow: track(glowMat(0x7fe8ff, 1.7)),
      tower: track(new T.MeshStandardMaterial({ map: towerTex(false), emissiveMap: towerTex(true), emissive: 0xffd98a, emissiveIntensity: 1.3, roughness: 0.5 }))
    };
  }

  // ---------- where things go (metres, world) ----------
  function layout() {
    var moon = site === 'moon', L = Tn.L, R = Tn.iceR || 25, Z = {};
    Z.C = P(CX, CZ); Z.ice = P(L.ice[0], L.ice[1]); Z.R = R;
    Z.plant = P(Z.ice.x - 0.6 * (R + 12), Z.ice.z - 0.8 * (R + 12));
    Z.plantFront = toward(Z.plant, Z.C, 9);
    Z.react = P(128, -95); Z.farm = P(-4, -108); Z.port = P(128, 26);
    Z.city = moon ? P(-45, -105) : P(-62, -100); Z.cityR = moon ? 26 : 28;
    // the roads start at the city's ring road (35 m out), and everything new stands outside it
    Z.roads = {
      a: [P(-4, -13), P(1, -34), cw(-8, 38), cw(0, 35.4), cw(0, 23)],
      b: [cw(33.9, -9), cw(36, -12), Z.plantFront],
      c: [toward(Z.C, P(7, -89.5), 35.2), P(7, -89.5), P(-9, -89.5)],
      d: [toward(Z.C, P(80, -12), 35.2), P(80, -12), P(102, 10), P(112, 26)],
      f: [toward(Z.C, P(-10, -84), 35.2), P(-10, -84), toward(Z.city, P(-10, -84), Z.cityR + 2)]
    };
    Z.mods = [[-0.6, -69.2, 0.9], [58.3, -24, 0.2], [74, -42.5, 1.2], [47, -104, 0.1]];
    Z.towers2 = [[-0.4, -54.8, 2.8, 16], [56.7, -98.9, 3, 20], [19.9, -98.2, 2.8, 18], [30.9, -22.1, 2.5, 14]];
    Z.domes2 = [[-26, -46, 8], [72, -93, 9], [62, 18, 8], [-56, 8, 9], [31.7, -105.5, 8], [110, 55, 9]];
    Z.domes3 = [[-82, -22, 6], [-98, 12, 6], [-70, 62, 6], [-10, 72, 6], [40, 85, 6], [150, -20, 7], [155, 60, 6], [100, -130, 6], [-110, -60, 6], [-120, -100, 6]];
    Z.pads2 = [P(112, 26), P(128, 42), P(144, 26)]; Z.pads3 = [P(96, 44), P(160, 44)];
    return Z;
  }

  function road(era, pts, d0) {
    var surf = [], lit = [], dist = 0, i, k;
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(L / 5)), l = L / n;
      for (k = 0; k < n; k++) {
        var x0 = lerp(a.x, b.x, k / n), z0 = lerp(a.z, b.z, k / n), x1 = lerp(a.x, b.x, (k + 1) / n), z1 = lerp(a.z, b.z, (k + 1) / n);
        var y0 = Tn.height(x0, z0) + 0.2, y1 = Tn.height(x1, z1) + 0.2, yaw = Math.atan2(x1 - x0, z1 - z0), pitch = -Math.atan2(y1 - y0, l);
        var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, d = d0 + dist / 40, ox = Math.cos(yaw) * 2.05, oz = -Math.sin(yaw) * 2.05;
        surf.push(item(cx, cy, cz, yaw, 4.2, 0.3, l + 0.6, d, pitch));
        lit.push(item(cx + ox, cy + 0.14, cz + oz, yaw, 0.18, 0.1, l * 0.62, d, pitch));
        lit.push(item(cx - ox, cy + 0.14, cz - oz, yaw, 0.18, 0.1, l * 0.62, d, pitch));
        dist += l;
      }
    }
    vinst(era, G.box, VM.road, surf); vinst(era, G.box, VM.roadGlow, lit, false);
    vis.roads.push({ era: era, r: routeOf(pts.map(function (p) { return [p.x, p.z]; })), d0: d0 });
  }
  function vRover(era, route, s0, speed) { vis.rovers.push({ era: era, r: routeOf(route), s: s0, dir: 1, speed: speed, appear: 0, wait: 0, at: {} }); }
  // people strolling along the pavements beside a road, or on a patch of open ground
  function walkers(era, n, seed) {
    var r = rnd(seed), roads = vis.roads.filter(function (q) { return q.era <= era; });
    for (var i = 0; i < n && roads.length; i++) {
      var q = roads[Math.floor(r() * roads.length)].r, s = r() * Math.max(1, q.total - 20), at = along(q, s, {}), bt = along(q, s + 8 + r() * 12, {});
      var side = r() < 0.5 ? -2.9 : 2.9, ox = Math.cos(at.yaw) * side, oz = -Math.sin(at.yaw) * side;
      addWalker(era, [[at.x + ox, at.z + oz], [bt.x + ox, bt.z + oz]], i);
    }
  }
  function addWalker(era, route, k) {
    var p = person(route, k, 0);
    p.ground = true; p.era = era; p.appear = 0; p.delay = 1e9; p.d = 0.6 + (k % 7) * 0.25;
    vis.people.push(p);
  }
  function crowdAt(era, x, z, rad, n, seed) {
    var r = rnd(seed);
    for (var i = 0; i < n; i++) {
      var a = r() * 6.283, b = a + 0.6 + r() * 1.2, ra = rad * (0.3 + r() * 0.7), rb = rad * (0.3 + r() * 0.7);
      addWalker(era, [[x + Math.cos(a) * ra, z + Math.sin(a) * ra], [x + Math.cos(b) * rb, z + Math.sin(b) * rb]], i + seed);
    }
  }
  function vShip(era, pad, off, per, park) {
    var src = shipOf(3), g = new T.Group();
    if (!src || !src.meshes) return;
    src.meshes.forEach(function (m) { var c = new T.Mesh(m.geometry, m.material); c.castShadow = true; c.receiveShadow = true; g.add(c); });
    var f = new T.Mesh(G.flame, track(addMat(0xffb040, 0.85))), core = new T.Mesh(G.flame, track(addMat(0xfff2c0, 0.9)));
    f.rotation.x = core.rotation.x = Math.PI; f.visible = core.visible = false; g.add(f); g.add(core);
    g.scale.setScalar(1.7); g.rotation.y = off * 2.1; g.visible = false;
    vis.root.add(g);
    vis.ships.push({ era: era, g: g, f: f, core: core, x: pad.x, y: pad.y + 0.5, z: pad.z, off: off, per: per, park: !!park });
  }

  // ---------- 10 years later: ice, air, power and more homes ----------
  function era1(Z) {
    var moon = site === 'moon', it = [], wins = [], i, k, y;
    road(1, Z.roads.a, 0); road(1, Z.roads.b, 0.5); road(1, Z.roads.c, 0.8);
    Z.mods.forEach(function (m, n) {
      y = gmin(m[0], m[1], 4);
      it.push(item(m[0], y + 1.6, m[1], m[2], 2, 2, 2, 0.3 + n * 0.3));
      for (k = -1; k <= 1; k++) {
        var c = Math.cos(m[2]), s = Math.sin(m[2]);
        wins.push(item(m[0] + c * 1.93 + s * k * 2.1, y + 2.1, m[1] - s * 1.93 + c * k * 2.1, m[2], 0.12, 0.42, 0.6, 0.3 + n * 0.3));
        wins.push(item(m[0] - c * 1.93 + s * k * 2.1, y + 2.1, m[1] + s * 1.93 + c * k * 2.1, m[2], 0.12, 0.42, 0.6, 0.3 + n * 0.3));
      }
    });
    vinst(1, VG.capsule, M.white, it); vinst(1, G.ball, M.win, wins, false);
    // a farm of greenhouse tunnels
    var tun = [], floor = [], arch = [], hall = [];
    for (i = 0; i < 6; i++) {
      var tz = Z.farm.z + (i - 2.5) * 5.4;
      y = gmin(Z.farm.x, tz, 6.5);
      tun.push(item(Z.farm.x, y, tz, 0, 13, 2.2, 2.2, 0.5 + i * 0.18));
      floor.push(item(Z.farm.x, y + 0.2, tz, 0, 12.4, 0.4, 3.4, 0.5 + i * 0.18));
      arch.push(item(Z.farm.x - 6.5, y, tz, Math.PI / 2, 2.25, 2.25, 2.25, 0.5 + i * 0.18));
      arch.push(item(Z.farm.x + 6.5, y, tz, Math.PI / 2, 2.25, 2.25, 2.25, 0.5 + i * 0.18));
    }
    y = gmin(Z.farm.x + 7.6, Z.farm.z, 8);
    hall.push(item(Z.farm.x + 7.8, y + 1.1, Z.farm.z, 0, 1.3, 30, 1.3, 0.4, Math.PI / 2));
    vinst(1, G.box, VM.park, floor); vinst(1, VG.tunnel, VM.gh, tun); vinst(1, G.arch, M.white, arch); vinst(1, G.cyl, M.white, hall);
    // the ice plant on the crater rim, with a conveyor down to the ice
    var pg = new T.Group(), kt = new Kit(), py = gmin(Z.plant.x, Z.plant.z, 7);
    pg.position.set(Z.plant.x, py, Z.plant.z); pg.rotation.y = Math.atan2(Z.ice.x - Z.plant.x, Z.ice.z - Z.plant.z);
    [-4.2, 0, 4.2].forEach(function (x) {
      kt.put('soft', G.cyl, mx(x, 4.2, -3.5, 0, 0, 0, 1.7, 8, 1.7), 0xf4f5f9);
      kt.put('soft', G.dome, mx(x, 8.2, -3.5, 0, 0, 0, 1.7), 0xf4f5f9);
      kt.put('soft', G.ring, mx(x, 2.6, -3.5, Math.PI / 2, 0, 0, 1.73), 0x3d7dff); kt.put('soft', G.ring, mx(x, 6.2, -3.5, Math.PI / 2, 0, 0, 1.73), 0x3d7dff);
      kt.put('blink', G.ball, mx(x, 10.0, -3.5, 0, 0, 0, 0.2));
    });
    kt.put('soft', G.box, mx(0, 2.3, 2.2, 0, 0, 0, 11, 4.6, 6), 0xd7dae3);
    kt.put('soft', G.box, mx(0, 4.7, 2.2, 0, 0, 0, 11.4, 0.3, 6.4), 0xffb84d);
    kt.put('cyan', G.box, mx(0, 3.1, 5.22, 0, 0, 0, 9, 0.5, 0.1)); kt.put('cyan', G.box, mx(0, 3.1, -0.82, 0, 0, 0, 9, 0.5, 0.1));
    var zE = 0.5 * Z.R + 12, xE = Z.ice.x - 0.6 * Z.R * 0.5, zW = Z.ice.z - 0.8 * Z.R * 0.5, yE = Tn.height(xE, zW) + 1.2 - py, z0 = 5.5, y0 = 4.2;
    var cl = Math.hypot(zE - z0, yE - y0);
    kt.put('soft', G.box, mx(0, (y0 + yE) / 2, (z0 + zE) / 2, -Math.atan2(yE - y0, zE - z0), 0, 0, 1.4, 0.5, cl), 0xffc533);
    for (k = 1; k < 4; k++) {
      var zz = lerp(z0, zE, k / 4), yy = lerp(y0, yE, k / 4), gw = Math.sin(pg.rotation.y), gc = Math.cos(pg.rotation.y);
      var gy = Tn.height(Z.plant.x + gw * zz, Z.plant.z + gc * zz) - py;
      if (yy - gy > 0.6) kt.put('soft', G.cyl, mx(0, (yy + gy) / 2, zz, 0, 0, 0, 0.18, yy - gy, 0.18), 0x8a8fa0);
    }
    bakeV(kt, pg); vgroup(1, pg, 0.6, 7);
    vRover(1, [[Z.ice.x - 0.6 * Z.R * 0.2, Z.ice.z - 0.8 * Z.R * 0.2], [xE, zW]], 2, 2.4);
    // two small nuclear power units, far from the homes, behind a wall of soil
    var rg = new T.Group(), kr = new Kit();
    rg.position.set(Z.react.x, gmin(Z.react.x, Z.react.z, 9), Z.react.z); rg.rotation.y = Math.atan2(CX - Z.react.x, CZ - Z.react.z);
    [-5, 5].forEach(function (x) {
      kr.put('soft', G.cyl, mx(x, 0.6, -2, 0, 0, 0, 1.2, 1.2, 1.2), 0x3a3e4c);
      kr.put('metal', G.cyl, mx(x, 1.9, -2, 0, 0, 0, 0.7, 1.5, 0.7), 0xb8bcc8);
      kr.put('soft', G.cyl, mx(x, 4.2, -2, 0, 0, 0, 0.14, 3.2, 0.14), 0xdfe2ea);
      kr.put('metal', new T.CylinderGeometry(3.2, 0.5, 3.6, 14, 1, true), mx(x, 7.4, -2), 0x9aa0ad);
      kr.put('amber', G.ball, mx(x, 2.85, -2, 0, 0, 0, 0.22));
    });
    for (k = 0; k < 9; k++) kr.put('rough', G.lump, mx((k - 4) * 3.1, 0.2, 5 + Math.abs(k - 4) * -0.35, 0, k * 0.4, 0, 2.4, 1.9 + (k % 2) * 0.3, 1.8), k % 2 ? M.soil : M.soil2);
    bakeV(kr, rg); vgroup(1, rg, 1.2, 6);
    // power: tall solar towers on the sunny hilltop (Moon) or a field of tilted panels (Mars)
    var pan = [], mast = [];
    if (moon) {
      var sy = Math.atan2(W.sunDir.x, W.sunDir.z);
      [[0, 0], [8, -8], [-7, 9]].forEach(function (o, n) {
        var x = Tn.L.hill[0] + o[0], z = Tn.L.hill[1] + o[1], g0 = Tn.height(x, z);
        mast.push(item(x, g0 + 12, z, 0, 0.35, 24, 0.35, 0.8 + n * 0.3));
        pan.push(item(x, g0 + 24, z, sy, 6, 9, 0.18, 0.8 + n * 0.3, -0.15));
      });
    } else {
      for (i = 0; i < 4; i++) for (k = 0; k < 6; k++) {
        var px = -55.5 + k * 3.8, pz = -26 + i * 4.2, gy = Tn.height(px, pz);
        mast.push(item(px, gy + 0.7, pz, 0, 0.08, 1.4, 0.08, 0.8 + (i * 6 + k) * 0.04));
        pan.push(item(px, gy + 1.5, pz, 0, 3, 1.8, 0.07, 0.8 + (i * 6 + k) * 0.04, -0.9));
      }
    }
    vinst(1, G.cyl, M.white, mast); vinst(1, G.box, M.solar, pan);
    vRover(1, Z.roads.a.map(function (p) { return [p.x, p.z]; }), 10, 4.5);
    vRover(1, Z.roads.b.map(function (p) { return [p.x, p.z]; }), 3, 3.5);
    walkers(1, 10, 11);
    crowdAt(1, wx(0, 4), wz(0, 4), 5, 4, 21);
  }

  // ---------- 30 years later: a town with domes, towers and a spaceport ----------
  function domes(era, list, d0) {
    var moon = site === 'moon', main = [], band = [], top = [], disc = [], trees = [], ring = [], house = [], hw = [], arches = [], r = rnd(era * 31);
    list.forEach(function (q, n) {
      var x = q[0], z = q[1], R = q[2], y = gmin(x, z, R * 0.8) - 0.4, d = d0 + n * 0.35, k;
      if (moon) {
        main.push(item(x, y, z, n, R, R * 0.62, R, d));
        band.push(item(x, y + R * 0.1, z, 0, R * 0.985, R * 0.985, R * 0.985, d, Math.PI / 2));
        top.push(item(x, y + R * 0.6, z, 0, R * 0.24, R * 0.05, R * 0.24, d));
      } else {
        main.push(item(x, y, z, 0, R, R * 0.8, R, d));
        ring.push(item(x, y + 0.1, z, 0, R, R, R, d, Math.PI / 2));
        arches.push(item(x, y, z, 0, R, R * 0.8, R, d), item(x, y, z, Math.PI / 2, R, R * 0.8, R, d));
        disc.push(item(x, y + 0.2, z, 0, R * 0.97, 0.5, R * 0.97, d));
        for (k = 0; k < 7; k++) { var a = r() * 6.283, rr = R * (0.25 + r() * 0.5), th = 2 + r() * 2.2; trees.push(item(x + Math.cos(a) * rr, y + 0.4 + th / 2, z + Math.sin(a) * rr, 0, th * 0.32, th, th * 0.32, d + 0.3)); }
        house.push(item(x - R * 0.2, y + 1.6, z + R * 0.15, n, 3.2, 2.8, 3.2, d + 0.2));
        hw.push(item(x - R * 0.2, y + 1.9, z + R * 0.15, n, 1.72, 0.3, 1.72, d + 0.2));
      }
    });
    if (moon) { vinst(era, VG.lump, VM.regolith, main); vinst(era, VG.band, M.win, band, false); vinst(era, G.ball, M.win, top, false); }
    else {
      vinst(era, G.cyl, VM.park, disc); vinst(era, G.cone, VM.tree, trees); vinst(era, G.box, M.white, house); vinst(era, G.box, M.win, hw, false);
      vinst(era, G.ring, M.white, ring); vinst(era, G.arch, M.white, arches); vinst(era, G.dome, VM.glass, main);
    }
  }
  function towers(era, list, d0) {
    var body = [], roof = [], tip = [], base = [], mast = [], band = [];
    list.forEach(function (q, n) {
      var y = gmin(q[0], q[1], q[2]) - 0.3, d = d0 + n * 0.3;
      body.push(item(q[0], y, q[1], n * 0.7, q[2], q[3], q[2], d));
      base.push(item(q[0], y + 1.4, q[1], 0, q[2] * 1.7, 2.8, q[2] * 1.7, d));
      roof.push(item(q[0], y + q[3], q[1], 0, q[2], q[2] * 0.6, q[2], d));
      mast.push(item(q[0], y + q[3] + q[2] * 0.6 + 1.2, q[1], 0, 0.1, 2.6, 0.1, d));
      tip.push(item(q[0], y + q[3] + q[2] * 0.6 + 2.6, q[1], 0, 0.3, 0.3, 0.3, d));
      for (var k = 1; k <= 2; k++) band.push(item(q[0], y + q[3] * k / 3, q[1], 0, q[2] * 1.03, q[2] * 1.03, q[2] * 2.2, d, Math.PI / 2));
    });
    vinst(era, VG.tower, VM.tower, body); vinst(era, G.cyl, M.white, base); vinst(era, G.dome, M.white, roof); vinst(era, G.cyl, M.white, mast);
    vinst(era, G.ring, VM.roadGlow, band, false); vinst(era, G.ball, M.blink, tip, false);
  }
  function pads(era, list, d0) {
    var disc = [], ring = [];
    list.forEach(function (p, n) {
      p.y = gmin(p.x, p.z, 8);
      disc.push(item(p.x, p.y + 0.1, p.z, 0, 8.5, 0.8, 8.5, d0 + n * 0.3));
      ring.push(item(p.x, p.y + 0.55, p.z, 0, 7, 7, 3, d0 + n * 0.3, Math.PI / 2));
    });
    vinst(era, G.cyl, VM.pad, disc); vinst(era, G.ring, M.ring, ring, false);
  }
  function era2(Z) {
    road(2, Z.roads.d, 0); road(2, Z.roads.f, 0.4);
    domes(2, Z.domes2, 0.3);
    towers(2, Z.towers2, 0.6);
    pads(2, Z.pads2, 0.4);
    var tg = new T.Group(), kt = new Kit(), ty = gmin(Z.port.x, Z.port.z - 14, 8);
    tg.position.set(Z.port.x, ty, Z.port.z - 14);
    kt.put('soft', G.box, mx(0, 2.6, 0, 0, 0, 0, 18, 5.2, 8), 0xf4f5f9);
    kt.put('soft', G.box, mx(0, 5.35, 0, 0, 0, 0, 18.6, 0.3, 8.6), 0x3d7dff);
    kt.put('cyan', G.box, mx(0, 3.0, 4.03, 0, 0, 0, 16, 1.2, 0.1));
    kt.put('soft', G.cyl, mx(7, 7.5, 0, 0, 0, 0, 1.3, 15, 1.3), 0xf4f5f9);
    kt.put('soft', G.cyl, mx(7, 15.6, 0, 0, 0, 0, 2.6, 2.2, 2.6), 0xdfe2ea);
    kt.put('cyan', G.cyl, mx(7, 15.6, 0, 0, 0, 0, 2.64, 0.9, 2.64));
    kt.put('blink', G.ball, mx(7, 17.2, 0, 0, 0, 0, 0.3));
    bakeV(kt, tg); vgroup(2, tg, 0.9, 6);
    vShip(2, Z.pads2[0], 0, 16);
    vShip(2, Z.pads2[2], 9, 16);
    vShip(2, Z.pads2[1], 0, 1, true);
    vRover(2, Z.roads.d.map(function (p) { return [p.x, p.z]; }), 20, 5);
    vRover(2, Z.roads.f.map(function (p) { return [p.x, p.z]; }), 6, 4.2);
    vRover(2, Z.roads.c.map(function (p) { return [p.x, p.z]; }), 12, 3.8);
    walkers(2, 16, 12);
    crowdAt(2, Z.farm.x + 9, Z.farm.z + 18, 7, 4, 31);
    crowdAt(2, Z.port.x, Z.port.z - 4, 6, 4, 41);
  }

  // ---------- 100 years later: a city ----------
  function era3(Z) {
    var moon = site === 'moon', c = Z.city, R = Z.cityR, y = gmin(c.x, c.z, R * 0.7) - 0.6, r = rnd(77), i;
    var g = new T.Group(), k = new Kit();
    g.position.set(c.x, y, c.z);
    if (moon) {
      k.put('rough', VG.lump, mx(0, 0, 0, 0, 0.5, 0, R, R * 0.58, R), M.soil);
      [0.08, 0.3].forEach(function (h) { var hr = Math.sqrt(1 - h * h / 0.3364) * R * 0.99; k.put('win', VG.band, mx(0, R * h, 0, Math.PI / 2, 0, 0, hr, hr, hr * 1.6)); });
      k.put('win', G.ball, mx(0, R * 0.565, 0, 0, 0, 0, R * 0.32, R * 0.04, R * 0.32));
      k.put('cyan', VG.band, mx(0, R * 0.55, 0, Math.PI / 2, 0, 0, R * 0.36, R * 0.36, R * 0.6));
      for (i = 0; i < 3; i++) {
        var a = i * 2.094 + 0.4;
        k.put('soft', G.cyl, mx(Math.sin(a) * (R + 1.5), 1.6, Math.cos(a) * (R + 1.5), Math.PI / 2, a, 0, 1.8, 6, 1.8), 0xc3c7d2);
        k.put('green', G.box, mx(Math.sin(a) * (R + 4.5), 3.2, Math.cos(a) * (R + 4.5), 0, a, 0, 2, 0.25, 0.3));
      }
    } else {
      k.put('soft', G.cyl, mx(0, 0.2, 0, 0, 0, 0, R * 0.98, 0.6, R * 0.98), 0x5fbf5a);
      k.put('soft', G.ring, mx(0, 0.2, 0, Math.PI / 2, 0, 0, R), 0xf4f5f9);
      k.put('lake', G.cyl, mx(R * 0.3, 0.55, -R * 0.25, 0, 0.5, 0, R * 0.26, 0.1, R * 0.16));
      k.put('soft', G.box, mx(0, 0.55, 0, 0, 0.6, 0, R * 1.8, 0.08, 1.8), 0xe6ddc8); k.put('soft', G.box, mx(0, 0.56, 0, 0, 2.17, 0, R * 1.8, 0.08, 1.8), 0xe6ddc8);
      for (i = 0; i < 46; i++) {
        var ta = r() * 6.283, tr = R * (0.2 + r() * 0.72), th = 2.5 + r() * 3.5, tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr;
        if (Math.hypot(tx - R * 0.3, tz + R * 0.25) < R * 0.3) continue;
        k.put('tree', G.cone, mx(tx, 0.5 + th / 2, tz, 0, 0, 0, th * 0.34, th, th * 0.34));
      }
      k.put('glass', G.dome, mx(0, 0, 0, 0, 0, 0, R, R * 0.78, R));
      for (i = 0; i < 3; i++) k.put('soft', G.arch, mx(0, 0, 0, 0, i * Math.PI / 3, 0, R, R * 0.78, R), 0xf4f5f9);
      k.put('soft', G.ring, mx(0, R * 0.39, 0, Math.PI / 2, 0, 0, R * 0.866, R * 0.866, R * 0.6), 0xf4f5f9);
    }
    var mats = { rough: M.rough, win: M.win, cyan: M.cyan, soft: M.soft, green: M.green, lake: VM.lake, tree: VM.tree, glass: VM.glass };
    k.bake(g, mats).forEach(function (m) { track(m.geometry); });
    vgroup(3, g, 0.2, 14);
    var tw = [];
    for (i = 0; i < 8; i++) {
      var aa = i / 8 * 6.283 + 0.3, rr = R + 9 + (i % 3) * 4;
      tw.push([c.x + Math.sin(aa) * rr, c.z + Math.cos(aa) * rr, 3 + (i % 3) * 0.8, 18 + ((i * 7) % 5) * 3.5]);
    }
    if (!moon) tw.push([c.x - R * 0.35, c.z + R * 0.2, 3.2, 22]);
    towers(3, tw, 0.6);
    domes(3, Z.domes3, 0.9);
    pads(3, Z.pads3, 0.5);
    vShip(3, Z.pads3[0], 5, 15);
    vShip(3, Z.pads3[1], 0, 1, true);
    vRover(3, Z.roads.f.map(function (p) { return [p.x, p.z]; }).reverse(), 4, 4.6);
    vRover(3, Z.roads.d.map(function (p) { return [p.x, p.z]; }).reverse(), 30, 5.2);
    walkers(3, 12, 13);
    crowdAt(3, c.x, c.z, moon ? R + 6 : R * 0.7, 10, 51);
  }

  // ---------- running it ----------
  function stepVision(dt) {
    var v = vis, t, i;
    if (!v || v.over) return;
    t = v.t += dt;
    while (v.ei < v.ev.length && t >= v.ev[v.ei].t) v.ev[v.ei++].fn();
    var moon = site === 'moon';
    W.env.t = moon ? lerp(0.34, 0.62, t / VT.end) : lerp(0.6, 0.93, ease(t / VT.end));
    W.env.dust = 0; W.env.storm = 0;
    grow(t);
    moveRovers(dt, t);
    for (i = 0; i < v.ships.length; i++) stepShip(v.ships[i], t, dt);
    var n = 0;
    for (i = 0; i < v.people.length; i++) {
      var p = v.people[i];
      if (t < v.eraT[p.era]) break;
      if (p.delay > 1e8) p.delay = v.eraT[p.era] + p.d - t;
      stepPerson(v.crowd, i, p, dt, null, moon); n++;
    }
    flushCrowd(v.crowd, n);
    camera(t);
    if (t >= VT.end) endVision(false);
  }
  function grow(t) {
    var v = vis, i, j;
    for (i = 0; i < v.insts.length; i++) {
      var r = v.insts[i], t0 = v.eraT[r.era];
      if (r.done || t < t0) continue;
      var all = true;
      for (j = 0; j < r.items.length; j++) {
        var it = r.items[j], u = seg(t, t0 + it.d, t0 + it.d + 1.1), f = Math.max(0.001, pop(u));
        if (u < 1) all = false;
        if (u > 0 && !it.puffed && it.sx > 5) { it.puffed = true; puffAt(it.x, it.z, 6, Math.min(it.sx, 10)); }
        e1.set(it.rx, it.ry, it.rz, 'YXZ'); q1.setFromEuler(e1);
        mB.compose(p1.set(it.x, it.y, it.z), q1, s1.set(it.sx * f, it.sy * f, it.sz * f));
        r.im.setMatrixAt(j, mB);
      }
      r.im.count = r.items.length; r.im.instanceMatrix.needsUpdate = true;
      if (all) r.done = true;
    }
    for (i = 0; i < v.groups.length; i++) {
      var g = v.groups[i], s0 = v.eraT[g.era] + g.d;
      if (g.done || t < s0) continue;
      var w = seg(t, s0, s0 + 1.3);
      if (!g.g.visible && g.puff) puffAt(g.g.position.x, g.g.position.z, 10, g.puff);
      g.g.visible = true; g.g.scale.setScalar(Math.max(0.001, pop(w)));
      if (w >= 1) g.done = true;
    }
  }
  function moveRovers(dt, t) {
    var v = vis, n = 0, im = v.roverMesh, lm = v.roverLights;
    for (var i = 0; i < v.rovers.length; i++) {
      var r = v.rovers[i];
      if (t < v.eraT[r.era] + 1.5) continue;
      r.appear = Math.min(1, r.appear + dt * 1.5);
      if (r.wait > 0) r.wait -= dt;
      else {
        r.s += r.dir * r.speed * dt;
        if (r.s >= r.r.total || r.s <= 0) { r.s = clamp(r.s, 0, r.r.total); r.dir = -r.dir; r.wait = 1.5; }
      }
      along(r.r, r.s, r.at);
      var side = r.dir > 0 ? 1 : -1, yaw = r.at.yaw + (r.dir < 0 ? Math.PI : 0), x = r.at.x + Math.cos(r.at.yaw) * side, z = r.at.z - Math.sin(r.at.yaw) * side;
      var sc = Math.max(0.001, pop(r.appear));
      mB.compose(p1.set(x, Tn.height(x, z) + 0.05, z), q1.setFromAxisAngle(UP, yaw), s1.set(sc, sc, sc));
      im.setMatrixAt(n, mB); lm.setMatrixAt(n, mB); n++;
    }
    im.count = lm.count = n; im.instanceMatrix.needsUpdate = lm.instanceMatrix.needsUpdate = true;
  }
  function stepShip(sh, t, dt) {
    var t0 = vis.eraT[sh.era] + 0.8;
    if (t < t0) { sh.g.visible = false; return; }
    var alt = 0, burn = false;
    if (!sh.park) {
      var c = ((t - t0 + sh.off) % sh.per) / sh.per;
      if (c < 0.42) { alt = 170 * Math.pow(1 - c / 0.42, 2.2); burn = true; }
      else if (c > 0.66) { alt = 190 * Math.pow((c - 0.66) / 0.34, 2.2); burn = true; }
    } else if (!sh.shown) { sh.shown = true; puffAt(sh.x, sh.z, 12, 6); }
    sh.g.visible = alt < 165;
    sh.g.position.set(sh.x, sh.y + alt, sh.z);
    sh.f.visible = sh.core.visible = burn && sh.g.visible;
    if (burn) {
      var fl = 0.8 + Math.random() * 0.45;
      sh.f.scale.set(0.95, 4.8 * fl, 0.95); sh.f.position.y = 0.6 - 2.4 * fl;
      sh.core.scale.set(0.5, 2.6 * fl, 0.5); sh.core.position.y = 0.6 - 1.3 * fl;
      if (alt < 30 && dt > 0) {
        var col = site === 'mars' ? 0xd9a070 : 0xb8b9c4;
        for (var i = W.rate((1 - alt / 30) * 5, dt); i > 0; i--) {
          var a = Math.random() * 6.283, sp = 10 + Math.random() * 16;
          W.emit(sh.x + Math.cos(a) * 3, sh.y + 0.6, sh.z + Math.sin(a) * 3, { vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.5, vz: Math.sin(a) * sp, life: 1.6, size: 2, grow: 3.5, color: col, alpha: 0.38, grav: 0 });
        }
      }
    }
  }

  // the camera: slow aerial moves, one per era
  function vlerp(a, b, u) { return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) }; }
  function air(x, z, h) { return { x: x, y: Tn.height(x, z) + h, z: z }; }
  function camera(t) {
    var Z = vis.Z, C = Z.C, moon = site === 'moon', c = W.cam.cine, pos, look, u, fov = 50;
    if (t < VT.e1) {
      u = ease(t / VT.e1);
      pos = vlerp(air(-30, 36, 9), air(-10, 8, 26), u); look = vlerp(air(C.x, C.z, 3), air(C.x + 4, C.z - 6, 6), u);
    } else if (t < VT.e2) {
      u = ease((t - VT.e1) / (VT.e2 - VT.e1));
      var a = lerp(-0.95, 0.35, u), rad = lerp(84, 92, u);
      pos = air(C.x + Math.sin(a) * rad, C.z + Math.cos(a) * rad, lerp(34, 44, u));
      look = air(C.x + 6, C.z - 18, 0);
    } else if (t < VT.e3) {
      u = ease((t - VT.e2) / (VT.e3 - VT.e2));
      pos = vlerp(air(-70, 66, 72), air(Z.port.x - 80, Z.port.z + 70, 40), u);
      look = vlerp(air(30, -40, 0), air(Z.port.x, Z.port.z, 12), ease(seg(t, VT.e2 + 2, VT.e3 - 1)));
      fov = lerp(52, 46, u);
    } else {
      u = ease((t - VT.e3) / (VT.end - VT.e3));
      if (moon) {
        pos = vlerp(air(75, 40, 52), air(48, 8, 38), u);
        look = vlerp(air(Z.city.x + 30, Z.city.z + 10, 0), { x: Z.city.x - 40, y: Tn.height(Z.city.x, Z.city.z) + 16, z: Z.city.z - 80 }, ease(seg(t, VT.e3 + 2, VT.end - 3)));
      } else {
        pos = vlerp(air(90, 55, 58), air(34, -38, 42), u);
        look = vlerp(air(Z.city.x + 34, Z.city.z + 14, 0), air(Z.city.x - 28, Z.city.z - 40, 12), ease(seg(t, VT.e3, VT.end - 4)));
      }
      fov = lerp(50, 56, u);
    }
    W.cam.mode = 'cine';
    c.pos.set(pos.x, pos.y, pos.z); c.look.set(look.x, look.y, look.z); c.fov = fov; c.roll = Math.sin(t * 0.21) * 0.012;
  }

  // ---------- the captions ----------
  function words(s) {
    var moon = site === 'moon', name = TOWN[site], dw = (s && s.site && s.site.dayWord ? s.site.dayWord : moon ? 'Day' : 'Sol').toLowerCase() + 's';
    var days = s && s.totalSols ? s.totalSols : 0;
    return [
      { tag: 'Imagine…', era: 'What could your outpost become?',
        text: (days ? 'You kept your outpost on ' + (moon ? 'the Moon' : 'Mars') + ' going for ' + days + ' ' + dw + '. ' : '') + 'Now picture what might grow here one day.' },
      { tag: 'Imagined future', era: '10 years later',
        text: moon ? 'Machines dig ice in the dark crater and turn it into water, air and rocket fuel. Small nuclear power units, like the Kilopower reactor NASA tested in 2018, keep the lights on when the Sun is hidden.'
          : 'In 2021, MOXIE, an experiment on NASA\'s Perseverance rover, made oxygen from the thin Mars air. Here, much bigger machines make air and rocket fuel, and small nuclear power units keep going through dust storms.' },
      { tag: 'Imagined future', era: '30 years later',
        text: moon ? 'NASA\'s Artemis plans start with a base camp near the Moon\'s south pole. Here it has grown into a town, with homes buried under soil to block radiation and a busy spaceport.'
          : 'Ships from Earth arrive about every 26 months, when the two planets line up for the shortest trip. The town now has glass greenhouses, workshops and a busy spaceport.' },
      { tag: 'Imagined future', era: '100 years later',
        text: moon ? 'A city on the Moon! Families live under huge shielded domes, and Earth hangs above the hills like a blue marble.'
          : 'A city on Mars! Under huge domes of thick, shielding glass, people grow forests and food. Children born here are real Martians.' },
      { tag: 'Imagined future', era: name,
        text: 'Nobody knows exactly what will be built. But every big city starts small, with a few brave explorers. Just like you.' }
    ];
  }
  function caption(i) {
    var el = vis.el, w = vis.words[i], cap = el.querySelector('.colony-cap');
    if (!w) { cap.classList.remove('colony-on'); return; }
    cap.querySelector('.colony-tag').textContent = w.tag;
    cap.querySelector('.colony-era').textContent = w.era;
    cap.querySelector('.colony-text').textContent = w.text;
    cap.classList.add('colony-on');
    var steps = el.querySelectorAll('.colony-steps li');
    for (var k = 0; k < steps.length; k++) steps[k].className = k === Math.min(i, 3) ? 'colony-now' : k < i ? 'colony-past' : '';
    if (JA.audio) { if (i > 0) JA.audio.play('swish'); JA.audio.speak(w.era + '. ' + w.text); }
  }
  function lit(on) { if (vis) vis.el.classList.toggle('colony-lit', !!on); }
  function events() {
    function at(t, fn) { return { t: t, fn: fn }; }
    var off = function () { var c = vis.el.querySelector('.colony-cap'); c.classList.remove('colony-on'); };
    return [
      at(0.25, function () { lit(true); vis.el.classList.add('colony-bars-on'); if (JA.audio) JA.audio.play('pad'); }),
      at(1.0, function () { caption(0); }), at(7.4, off),
      at(VT.e1 - 0.7, function () { lit(false); }), at(VT.e1 + 0.05, function () { lit(true); if (JA.audio) JA.audio.play('pad'); }), at(VT.e1 + 0.7, function () { caption(1); }), at(VT.e2 - 1.1, off),
      at(VT.e2 - 0.7, function () { lit(false); }), at(VT.e2 + 0.05, function () { lit(true); }), at(VT.e2 + 0.7, function () { caption(2); }), at(VT.e3 - 1.1, off),
      at(VT.e3 - 0.7, function () { lit(false); }), at(VT.e3 + 0.05, function () { lit(true); if (JA.audio) JA.audio.play('pad'); }), at(VT.e3 + 0.7, function () { caption(3); }), at(VT.fin - 0.6, off),
      at(VT.fin, function () { vis.el.classList.add('colony-end'); }), at(VT.fin + 0.4, function () { caption(4); }), at(VT.end - 1.6, off),
      at(VT.end - 0.8, function () { lit(false); })
    ];
  }
  function overlay() {
    var el = document.createElement('div');
    el.className = 'colony-vision';
    el.innerHTML = '<div class="colony-fade"></div><div class="colony-bars" aria-hidden="true"><i></i><i></i></div>' +
      '<ol class="colony-steps" aria-hidden="true"><li>Today</li><li>+10 years</li><li>+30 years</li><li>+100 years</li></ol>' +
      '<div class="colony-cap" aria-live="polite"><small class="colony-tag"></small><b class="colony-era"></b><p class="colony-text"></p></div>' +
      '<button class="colony-skip btn ghost" type="button">Skip ▶▶</button>';
    document.body.appendChild(el);
    el.querySelector('.colony-skip').addEventListener('click', function (e) { e.stopPropagation(); skipVision(); });
    return el;
  }

  function startVision(s, done) {
    var fadeEl = document.getElementById('fade');
    vis = { t: 0, done: done, prev: stageNow, trash: [], insts: [], groups: [], roads: [], rovers: [], ships: [], people: [], ei: 0, last: Date.now(),
      env: { t: W.env.t, dust: W.env.dust, storm: W.env.storm }, fadeOn: !!(fadeEl && fadeEl.classList.contains('on')),
      eraT: { 0: 0, 1: VT.e1 + 0.2, 2: VT.e2 + 0.2, 3: VT.e3 + 0.2 } };
    K.setStage(LAST);                                  // the film starts from the full city, so the future is bigger than anything built in the game
    vis.root = new T.Group(); vis.root.name = 'colony-vision'; W.root.add(vis.root);
    visionStuff();
    var Z = vis.Z = layout();
    era1(Z); era2(Z); era3(Z);
    var nr = Math.max(1, vis.rovers.length);
    vis.roverMesh = new T.InstancedMesh(VG.rover, M.soft, nr); vis.roverLights = new T.InstancedMesh(VG.lights, M.win, nr);
    [vis.roverMesh, vis.roverLights].forEach(function (m) { m.frustumCulled = false; m.count = 0; vis.root.add(m); });
    vis.roverMesh.castShadow = true;
    vis.crowd = makeCrowd(vis.root, Math.max(1, vis.people.length), men.geos);
    vis.words = words(s); vis.ev = events();
    vis.el = overlay();
    if (JA.ui && JA.ui.fade) JA.ui.fade(false);
    W.cam.shake = 0;
    vis.timer = setInterval(function () {              // keeps the film going if nobody calls update()
      if (vis && !vis.over && Date.now() - vis.last > 600) { try { stepVision(0.05); } catch (e) { warn(e); } }
    }, 50);
    camera(0);
  }
  function skipVision() {
    if (!vis || vis.skipping || vis.over) return;
    vis.skipping = true; lit(false);
    var me = vis;
    setTimeout(function () { if (vis === me) endVision(false); }, 450);
  }
  function endVision() {
    var v = vis;
    if (!v || v.over) return;
    v.over = true;
    try {
      clearInterval(v.timer);
      if (v.root && v.root.parent) v.root.parent.remove(v.root);
      if (v.root) v.root.traverse(function (o) { if (o.isInstancedMesh && o.dispose) o.dispose(); });
      v.trash.forEach(function (o) { try { o.dispose(); } catch (e) { /* ignore */ } });
      if (v.el && v.el.parentNode) v.el.parentNode.removeChild(v.el);
      W.env.t = v.env.t; W.env.dust = v.env.dust; W.env.storm = v.env.storm;
      W.cam.cine.roll = 0; W.cam.cine.fov = 52; W.cam.shake = 0; W.cam.mode = 'play';
      if (v.fadeOn && JA.ui && JA.ui.fade) JA.ui.fade(true);
    } catch (e) { warn(e); }
    vis = null;
    try { K.setStage(v.prev); } catch (e) { warn(e); }
    if (typeof v.done === 'function') { try { v.done(); } catch (e) { warn(e); } }
  }

  K.vision = function (s, done) {
    if (!grp || vis || !W.ready || !W.root || !men || !document.body) return false;
    try { startVision(s, done); return true; } catch (e) {
      warn(e);
      if (vis) { vis.done = null; endVision(); }
      return false;
    }
  };
  K.skipVision = skipVision;
  K.visionTime = function () { return vis ? vis.t : -1; };
  window.addEventListener('keydown', function (e) {
    if (vis && !vis.over && (e.code === 'Escape' || e.key === 'Escape')) { e.preventDefault(); skipVision(); }
  });
})(window.JA);
