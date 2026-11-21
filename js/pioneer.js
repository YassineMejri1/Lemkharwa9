/* Astro Outpost — Pioneer mode: living off the land.
   A hard mode with a gather-and-build loop. Break the boulders on the map with your rock hammer,
   pick up the pieces (rubble, metal, glass sand), then build new machines anywhere on the ground.

   Real science used here:
   - "In-situ resource use": Moon and Mars rock is mostly oxygen, silicon, iron and aluminium,
     so a crew can make things from the ground instead of flying everything from Earth.
   - Soil can be baked into bricks, and silicon makes solar cells and glass.
   What a rock gives and what a structure costs are invented for the game (js/data.js: JA.MATS, JA.BUILDS).

   This file only does the hands-on part: the swing, the flying pieces, the bag, the build menu,
   the see-through "ghost" you place, and the shapes of the structures. The rules (what a rock
   gives, what a structure costs and what it does for the outpost) live in js/sim.js.
   The game calls the hooks at the bottom of this file. Every one of them is safe to call at any time. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain;
  function nothing() {}
  var P = JA.pioneer = { build: nothing, start: nothing, stop: nothing, update: nothing, offer: nothing,
    menu: function () { return false; }, active: function () { return false; }, placing: function () { return false; } };
  if (!T || !W || !Tn) return;

  var REACH = 2.2;            // how close (metres from its side) you must be to hit a boulder
  var WINDUP = 0.2;           // seconds from the key press to the hammer landing
  var HOLD = 0.09;            // seconds the hammer stays on the rock when it lands
  var RECOVER = 0.35;         // seconds before you can swing again
  var RING_T = 0.9;           // seconds the timing ring takes to close
  var SWEET = 0.66;           // from this part of the ring's closing on, a hit counts double
  var MAX_PIECES = 8;         // pieces you see fly out of one boulder (extra units ride on them)
  var PULL_R = 2.6;           // pieces closer than this fly into your bag
  var AHEAD = 3.2;            // how far in front of you the ghost floats
  var DOOR = [0, 10], DOOR_R = 12;      // keep the way to the habitat door clear
  var CLEAR = 0.6, BUMPY = 0.8;         // room to leave around other things; how uneven the ground may be
  var RIG_EVERY = 45, RIG_MAX = 2, RIG_NEAR = 3;      // a drill rig: seconds per ice chunk, and how many may wait beside it
  var TINT = { rock: '#f0c9a6', metal: '#cfd9ff', glass: '#b8fff0' };
  var SPARK = { rock: 0xe0a070, metal: 0xaebcff, glass: 0x9ffff0 };

  // How much ground each structure takes: rad = the footprint you place, cols = the circles that block
  // walking (x, z, radius; in the structure's own directions), h = how tall it stands.
  var SPEC = {
    panel: { rad: 1.7, cols: [[0, 0, 1.0]], h: 2.6 },
    battery: { rad: 1.75, cols: [[-0.74, 0, 0.8], [0.74, 0, 0.8]], h: 1.6 },
    cistern: { rad: 1.8, cols: [[0, 0, 1.6]], h: 2.3 },
    berm: { rad: 2.2, cols: [[-1.52, -0.2, 0.52], [-0.5, -0.03, 0.52], [0.5, -0.03, 0.52], [1.52, -0.2, 0.52]], h: 1.2, thin: true },
    rig: { rad: 1.9, cols: [[0, 0, 1.25]], h: 3.4 },
    turbine: { rad: 1.3, cols: [[0, 0, 0.85]], h: 5.6 },
    mirror: { rad: 1.4, cols: [[0, 0, 0.75]], h: 7 },
    filter: { rad: 1.65, cols: [[-0.52, 0, 0.72], [0.52, 0, 0.72]], h: 2.2 },
    other: { rad: 1.2, cols: [[0, 0, 0.95]], h: 1.3 }
  };

  var root = null, site = 'mars', S = null, api = null, on = false, warned = false;
  var M = null, GEO = null;                           // materials and shapes shared by everything drawn here
  var rocks = {}, live = [], swing = null, cool = 0, hold = 0, hammer = null, hamT = 0;
  var pieces = [], structs = [], place = null, flags = {}, synced = null, lastS = null, lastT = null, stack = 0;
  var chip = null, ring = null, pulse = null, pips = null, chipOn = false, chipIn = null, chipSig = '', ringOn = false, ringSweet = null, pipSig = '';
  var lastTick = 0, lastMode = '', watching = false;
  var UP = new T.Vector3(0, 1, 0), v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), v4 = new T.Vector3(), ray = new T.Raycaster();

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function pop(u) { u = clamp(u, 0, 1) - 1; return 1 + u * u * (2.7 * u + 1.7); }        // overshoots a little, then settles
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function warn(e) { if (!warned && window.console) { warned = true; console.warn('Astro Outpost pioneer:', e); } }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lowerFirst(t) { t = String(t || ''); return t.charAt(0).toLowerCase() + t.slice(1); }
  // the game's helpers (given to start) and the rules in sim.js: both may be missing, so ask politely
  function tell(name, a, b, c) { try { if (api && typeof api[name] === 'function') return api[name](a, b, c); } catch (e) { warn(e); } return null; }
  function rule(name, a, b, c) { var f = JA.sim && JA.sim[name]; return typeof f === 'function' ? f(a, b, c) : null; }
  function astro() { return JA.actors && JA.actors.astro; }
  // How high the ground is where something rests: the game's own answer when it has one (it knows about floors), else the bare land.
  function ground(x, z) {
    var A = JA.actors, h;
    if (A && typeof A.groundAt === 'function') { try { h = A.groundAt(x, z); } catch (e) { h = null; } if (typeof h === 'number' && isFinite(h)) return h; }
    return Tn.height(x, z);
  }
  function driving() { return !!(JA.actors && JA.actors.rover && JA.actors.rover.driver); }
  function touch() { return !!document.body && document.body.classList.contains('touch'); }
  function rockColor() { return JA.pick(site, { moon: 0x8a8b95, mars: 0x8a4a30, sahrun: 0x9a7a52 }); }
  function dustColor() { return JA.siteOf(site).colors.dust; }

  // ---------- shapes and materials (made again for every new world: the old ones go with the old world) ----------
  function cyl(rt, rb, h, seg) { return new T.CylinderGeometry(rt, rb, h, seg || 12); }
  function box(w, h, d) { return new T.BoxGeometry(w, h, d); }
  function ball(r) { return new T.SphereGeometry(r, 8, 6); }
  function flat(m) { m.rotation.x = Math.PI / 2; return m; }
  function add(parent, geo, mat, x, y, z, noShadow) { return W.add(parent, geo, mat, x, y, z, noShadow); }
  function makeKit() {
    GEO = { lump: new T.DodecahedronGeometry(0.27, 0), nugget: new T.IcosahedronGeometry(0.24, 0), shard: new T.OctahedronGeometry(0.26, 0),
      brick: box(0.47, 0.28, 0.42).toNonIndexed() };
    M = {
      hull: W.soft(0xf2f3f7), grey: W.soft(0xc3c7d2), dark: W.soft(0x2b3147), blue: W.soft(0x3d7dff), teal: W.soft(0x3db8a0), orange: W.soft(0xff8a3d),
      metal: new T.MeshStandardMaterial({ color: 0xcfd3de, metalness: 0.8, roughness: 0.25 }),
      soil: W.mat(JA.pick(site, { moon: 0x666772, mars: 0x9a4a2a, sahrun: 0xa8763a })),
      brick: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.02, flatShading: true }),
      solar: new T.MeshStandardMaterial({ color: 0x14306b, roughness: 0.25, metalness: 0.5, emissive: 0x1b3f96, emissiveIntensity: 0.4 }),
      line: W.glow(0x6fa3ff, 0.9), lamp: W.glow(0x46ff8a, 1.6), red: W.glow(0xff5a5a, 2), water: W.glow(0x4fd8ff, 1.3), ice: W.glow(0x7fe8ff, 1.4),
      mirror: W.glow(0xfff1c4, 1.0),
      can: new T.MeshStandardMaterial({ color: 0x8fe8d0, emissive: 0x3db8a0, emissiveIntensity: 0.8, roughness: 0.5 }),
      bars: [0, 1, 2, 3].map(function () { return new T.MeshStandardMaterial({ color: 0x3a3214, emissive: 0xffd23f, emissiveIntensity: 0.05, roughness: 0.4 }); }),
      // the pieces a broken boulder leaves: grey-brown rubble, dark metal, pale glass sand
      rock: W.mat(JA.pick(site, { moon: 0x4b4741, mars: 0x55392b, sahrun: 0x6a5238 }), { emissive: 0xff9a50, emissiveIntensity: 0.08 }),
      ore: new T.MeshStandardMaterial({ color: 0x3a4152, metalness: 0.85, roughness: 0.3, flatShading: true, emissive: 0x3a55a8, emissiveIntensity: 0.5 }),
      sand: new T.MeshStandardMaterial({ color: 0xeafff8, roughness: 0.12, metalness: 0.1, flatShading: true, emissive: 0x7fe8d8, emissiveIntensity: 0.6, transparent: true, opacity: 0.92 }),
      crack: new T.MeshBasicMaterial({ color: 0x0d0806, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      ghost: new T.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.5, depthWrite: false, fog: false }),
      edge: new T.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: T.DoubleSide })
    };
  }
  // The lamps and glowing parts breathe together: one change per frame, however many structures there are.
  function glowAll(s) {
    var t = W.time || 0, i, lit = 2;
    M.lamp.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.6;
    M.red.emissiveIntensity = Math.sin(t * 4) > 0.3 ? 2.2 : 0.3;
    M.can.emissiveIntensity = 0.7 + Math.sin(t * 1.7) * 0.25;
    M.rock.emissiveIntensity = 0.08 + Math.sin(t * 4) * 0.05;
    M.ore.emissiveIntensity = 0.5 + Math.sin(t * 4 + 1) * 0.3;
    M.sand.emissiveIntensity = 0.6 + Math.sin(t * 4 + 2) * 0.3;
    // battery bars show how many charged cells wait on the Solar Rack
    if (s && s.rack && typeof s.rack.cells === 'number') lit = clamp(s.rack.cells / (rule('rackMax', s) || 6), 0, 1) * 4;
    else lit = 2 + Math.sin(t * 0.5) * 1.6;
    for (i = 0; i < 4; i++) M.bars[i].emissiveIntensity = lit >= i + 1 ? 1.5 : lit > i ? 0.6 + Math.sin(t * 5) * 0.4 : 0.03;
  }
  // A rod between two points (the legs of the drill rig).
  function beam(parent, mat, a, b, r) {
    var len = v1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).length();
    var m = add(parent, cyl(r, r, len, 6), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(UP, v1.normalize());
    return m;
  }
  // Many bricks baked into one mesh. list: [{ x, y, z, ry, color, sy (how tall, 1 = a whole brick) }]
  function bricks(list) {
    var sp = GEO.brick.attributes.position, sn = GEO.brick.attributes.normal, n = sp.count, size = n * 3 * list.length;
    var pos = new Float32Array(size), nor = new Float32Array(size), col = new Float32Array(size), q = new T.Quaternion(), c = new T.Color(), i, k, o = 0, it;
    for (i = 0; i < list.length; i++) {
      it = list[i]; q.setFromAxisAngle(UP, it.ry); c.set(it.color);
      for (k = 0; k < n; k++, o += 3) {
        v1.fromBufferAttribute(sp, k); v1.y *= it.sy || 1; v1.applyQuaternion(q);
        pos[o] = v1.x + it.x; pos[o + 1] = v1.y + it.y; pos[o + 2] = v1.z + it.z;
        v1.fromBufferAttribute(sn, k).applyQuaternion(q);
        nor[o] = v1.x; nor[o + 1] = v1.y; nor[o + 2] = v1.z;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  }

  // ---------- the structures ----------
  // Each one is a few big parts. When it is built the parts rise out of the ground one after the other.
  function sub(o) { var g = new T.Group(); o.g.add(g); return g; }
  // how much higher or lower the real ground is at a spot of the structure (used so the wall follows the ground)
  function lift(o, lx, lz) {
    var at = o.at; if (!at) return 0;
    var c = Math.cos(at.yaw), s = Math.sin(at.yaw);
    return ground(at.x + lx * c + lz * s, at.z - lx * s + lz * c) - at.y - 0.04;
  }
  var DRAW = {
    // a solar panel on a post; the panel turns to face the Sun
    panel: function (o) {
      var foot = sub(o), mast = sub(o), head = sub(o), i;
      add(foot, cyl(0.72, 0.88, 0.24, 10), M.dark, 0, 0.12, 0);
      add(foot, box(0.5, 0.4, 0.44), M.grey, 0.62, 0.3, 0.3);
      add(foot, ball(0.08), M.lamp, 0.62, 0.55, 0.3, true);
      add(mast, cyl(0.1, 0.14, 2.1, 8), M.grey, 0, 1.25, 0);
      add(mast, cyl(0.2, 0.2, 0.22, 8), M.dark, 0, 2.3, 0);
      head.position.y = 2.42; head.rotation.order = 'YXZ'; head.rotation.x = 0.6;
      add(head, box(3.3, 0.07, 1.9), M.hull, 0, 0, 0);
      add(head, box(3.12, 0.05, 1.72), M.solar, 0, 0.045, 0);
      for (i = -1; i <= 1; i++) add(head, box(0.035, 0.02, 1.72), M.line, i * 0.78, 0.075, 0, true);
      add(head, box(3.12, 0.02, 0.035), M.line, 0, 0.075, 0, true);
      o.head = head; o.follow = true;
    },
    // a battery bank: three cabinets with glowing level bars
    battery: function (o) {
      var base = sub(o), top = sub(o), i, k, c;
      add(base, box(2.95, 0.18, 1.5), M.dark, 0, 0.09, 0);
      for (i = 0; i < 3; i++) {
        c = sub(o); c.position.set(-0.94 + i * 0.94, 0.18, 0);
        add(c, box(0.82, 1.25, 1.1), M.hull, 0, 0.625, 0);
        add(c, box(0.86, 0.1, 1.14), M.dark, 0, 1.3, 0);
        add(c, box(0.6, 0.94, 0.04), M.dark, 0, 0.66, 0.56, true);
        for (k = 0; k < 4; k++) add(c, box(0.46, 0.14, 0.05), M.bars[k], 0, 0.33 + k * 0.215, 0.585, true);
        add(c, cyl(0.07, 0.07, 0.14, 8), M.metal, -0.2, 1.42, 0, true);
        add(c, cyl(0.07, 0.07, 0.14, 8), M.metal, 0.2, 1.42, 0, true);
      }
      add(top, box(2.5, 0.07, 0.1), M.orange, 0, 1.68, 0);                           // the bar that joins them
      add(top, ball(0.08), M.lamp, 1.3, 1.62, 0.5, true);
    },
    // a round water tank; the blue strip on the front shows how full it is
    cistern: function (o) {
      var base = sub(o), tank = sub(o), lid = sub(o);
      add(base, cyl(1.5, 1.62, 0.26, 16), M.dark, 0, 0.13, 0);
      add(base, cyl(0.08, 0.08, 0.9, 6), M.metal, 1.5, 0.45, 0.4, true);
      add(base, box(0.34, 0.12, 0.12), M.blue, 1.5, 0.92, 0.4, true);
      add(tank, cyl(1.36, 1.36, 1.46, 18), M.hull, 0, 0.99, 0);
      flat(add(tank, new T.TorusGeometry(1.37, 0.06, 6, 24), M.blue, 0, 0.5, 0, true));
      flat(add(tank, new T.TorusGeometry(1.37, 0.06, 6, 24), M.blue, 0, 1.5, 0, true));
      add(tank, box(0.4, 1.16, 0.1), M.dark, 0, 1.0, 1.34, true);
      o.level = add(tank, box(0.26, 1.04, 0.06), M.water, 0, 1.0, 1.385, true);
      add(lid, cyl(0.62, 1.36, 0.36, 18), M.grey, 0, 1.9, 0);
      add(lid, cyl(0.26, 0.26, 0.16, 10), M.dark, 0, 2.14, 0);
      add(lid, ball(0.08), M.lamp, 0.55, 2.02, 0.55, true);
    },
    // a wall of baked-soil bricks: a gentle arc about 4 m long and 1.2 m high, laid row by row
    berm: function (o) {
      var tones = JA.pick(site, { moon: [0x6a6b76, 0x565762, 0x7b7c87], mars: [0x8a4424, 0x6f3519, 0x9c5230], sahrun: [0xb08a58, 0x9a7444, 0xc49a62] }), i, k, n, a, x, z, list, dy, row;
      for (i = 0; i < 4; i++) {
        list = []; n = 8 - (i % 2);
        for (k = 0; k < n; k++) {
          a = ((k + 0.5 + (i % 2) * 0.5) / 8 - 0.5) * 0.667; x = Math.sin(a) * 6; z = (Math.cos(a) - 1) * 6; dy = lift(o, x, z);
          list.push({ x: x, y: 0.15 + i * 0.3 + dy, z: z, ry: a + rnd(-0.03, 0.03), color: tones[(i * 2 + k + (k % 3)) % 3] });
          if (!i) list.push({ x: x, y: -0.15 + dy, z: z, ry: a, color: tones[1] });       // a footing under the first row
          if (i === 3) list.push({ x: x, y: 1.24 + dy, z: z, ry: a, color: 0xdfe2ea, sy: 0.3 });      // pale capstones on top
        }
        row = sub(o);
        add(row, bricks(list), M.brick, 0, 0, 0);
      }
      add(row, ball(0.08), M.lamp, 1.86, 1.36 + lift(o, 1.86, -0.3), -0.3, true);
    },
    // an ice drill rig: a tripod over a spinning screw, with a tray where the ice comes out
    rig: function (o) {
      var feet = sub(o), legs = sub(o), motor = sub(o), drill = sub(o), tray = sub(o), i, a, fx, fz, f;
      for (i = 0; i < 3; i++) {
        a = Math.PI / 6 + i * Math.PI * 2 / 3; fx = Math.sin(a) * 1.25; fz = Math.cos(a) * 1.25;
        add(feet, cyl(0.26, 0.32, 0.12, 8), M.dark, fx, 0.06, fz);
        beam(legs, M.grey, [fx, 0.1, fz], [Math.sin(a) * 0.2, 3.0, Math.cos(a) * 0.2], 0.065);
      }
      add(motor, cyl(0.36, 0.36, 0.5, 10), M.hull, 0, 3.05, 0);
      add(motor, cyl(0.4, 0.4, 0.12, 10), M.orange, 0, 2.78, 0);
      add(motor, ball(0.09), M.lamp, 0, 3.38, 0, true);
      o.auger = new T.Group(); drill.add(o.auger);
      add(o.auger, cyl(0.07, 0.07, 2.7, 8), M.metal, 0, 1.4, 0);
      for (i = 0; i < 9; i++) { f = add(o.auger, box(0.56, 0.05, 0.17), M.metal, 0, 0.22 + i * 0.26, 0); f.rotation.set(0, i * 0.9, 0.26); }
      flat(add(drill, new T.TorusGeometry(0.5, 0.07, 6, 18), M.ice, 0, 0.1, 0, true));
      f = add(tray, box(1.1, 0.08, 0.5), M.grey, 1.02, 0.5, 0); f.rotation.z = -0.42;      // the chute
      add(tray, box(0.9, 0.1, 1.7), M.dark, 1.95, 0.05, 0);
      add(tray, box(0.08, 0.2, 1.7), M.ice, 2.4, 0.12, 0, true);
    },
    // a wind turbine (Mars): three blades that turn faster when the dust blows
    turbine: function (o) {
      var base = sub(o), tower = sub(o), nac = sub(o), i, bl, m;
      add(base, cyl(0.7, 0.9, 0.3, 10), M.dark, 0, 0.15, 0);
      add(base, box(0.46, 0.5, 0.4), M.grey, 0.62, 0.42, 0);
      add(base, ball(0.08), M.lamp, 0.62, 0.72, 0, true);
      add(tower, cyl(0.11, 0.2, 5.0, 8), M.hull, 0, 2.8, 0);
      add(tower, cyl(0.21, 0.23, 0.26, 8), M.teal, 0, 1.0, 0);
      nac.position.y = 5.42;
      add(nac, box(0.42, 0.42, 1.1), M.hull, 0, 0, 0);
      add(nac, box(0.44, 0.1, 0.5), M.teal, 0, 0.2, -0.2, true);
      add(nac, box(0.04, 0.56, 0.5), M.hull, 0, 0.14, -0.78);
      add(nac, ball(0.07), M.red, 0, 0.3, -0.4, true);
      o.rotor = new T.Group(); o.rotor.position.set(0, 0, 0.68); nac.add(o.rotor);
      flat(add(o.rotor, new T.ConeGeometry(0.2, 0.36, 8), M.dark, 0, 0, 0.06));
      for (i = 0; i < 3; i++) {
        bl = new T.Group(); bl.rotation.z = i * Math.PI * 2 / 3; o.rotor.add(bl);
        m = add(bl, box(0.27, 2.3, 0.05), M.hull, 0, 1.26, 0); m.rotation.y = 0.28;
      }
      o.nac = nac;
    },
    // a Sun mirror (Moon): a tall mast that lifts a bright mirror out of the shadow
    mirror: function (o) {
      var base = sub(o), mast = sub(o), head = sub(o), i, a, f;
      add(base, cyl(0.42, 0.56, 0.4, 10), M.dark, 0, 0.2, 0);
      for (i = 0; i < 3; i++) { a = i * Math.PI * 2 / 3; f = add(base, box(0.2, 0.1, 1.2), M.grey, Math.sin(a) * 0.7, 0.07, Math.cos(a) * 0.7); f.rotation.y = a; }
      add(base, ball(0.08), M.lamp, 0.3, 0.5, 0.3, true);
      add(mast, cyl(0.09, 0.15, 6.3, 8), M.grey, 0, 3.5, 0);
      add(mast, cyl(0.17, 0.17, 0.16, 8), M.orange, 0, 2.2, 0);
      add(mast, cyl(0.15, 0.15, 0.16, 8), M.orange, 0, 4.4, 0);
      head.position.y = 6.75; head.rotation.order = 'YXZ'; head.rotation.x = 1.85;
      add(head, cyl(1.35, 1.35, 0.07, 6), M.mirror, 0, 0.05, 0, true);
      for (i = 0; i < 3; i++) { f = add(head, box(2.66, 0.02, 0.035), M.dark, 0, 0.09, 0, true); f.rotation.y = Math.PI / 6 + i * Math.PI / 3; }      // the joints between its six segments
      add(head, cyl(1.46, 1.46, 0.07, 6), M.dark, 0, -0.02, 0);
      add(head, box(0.16, 0.3, 0.16), M.dark, 0, -0.18, 0);
      o.head = head;
    },
    // a spare CO2 filter bed: a box with three teal canisters, like the Air Scrubber on the airlock
    filter: function (o) {
      var skid = sub(o), body = sub(o), cans = sub(o), i;
      add(skid, box(2.3, 0.14, 0.2), M.dark, 0, 0.07, 0.5);
      add(skid, box(2.3, 0.14, 0.2), M.dark, 0, 0.07, -0.5);
      add(body, box(2.1, 0.9, 1.3), M.grey, 0, 0.6, 0);
      add(body, box(2.16, 0.14, 1.36), M.teal, 0, 1.1, 0);
      add(body, box(0.6, 0.4, 0.06), M.dark, -0.55, 0.62, 0.66, true);
      add(body, ball(0.08), M.lamp, 0.75, 0.72, 0.68, true);
      for (i = 0; i < 3; i++) {
        add(cans, cyl(0.24, 0.24, 1.0, 12), M.can, -0.62 + i * 0.62, 1.67, 0.1);
        add(cans, cyl(0.26, 0.26, 0.1, 12), M.dark, -0.62 + i * 0.62, 2.2, 0.1, true);
      }
      add(cans, box(1.7, 0.1, 0.1), M.metal, 0, 1.5, -0.3, true);
    },
    // anything this file has no drawing for: a crate with an antenna
    other: function (o) {
      var crate = sub(o), mast = sub(o);
      add(crate, box(1.3, 1.1, 1.3), M.hull, 0, 0.55, 0);
      add(crate, box(1.36, 0.16, 1.36), M.orange, 0, 0.55, 0);
      add(mast, cyl(0.03, 0.03, 1.6, 6), M.grey, 0.4, 1.9, 0.4);
      add(mast, ball(0.1), M.lamp, 0.4, 2.74, 0.4, true);
    }
  };
  // at: { x, y, z, yaw } where it will stand (left out for the ghost)
  function shape(id, at) {
    var o = { id: id, g: new T.Group(), spec: SPEC[id] || SPEC.other, at: at || null };
    if (!o.spec.thin) add(sub(o), cyl(o.spec.rad * 0.78, o.spec.rad * 0.9, 0.5, 14), M.soil, 0, -0.2, 0);     // a pad of packed soil, so it sits well on a slope
    (DRAW[id] || DRAW.other)(o);
    return o;
  }

  // Put up the real thing where the ghost stood.
  function raise(id, x, z, yaw) {
    var y = ground(x, z), o = shape(id, { x: x, y: y, z: z, yaw: yaw }), sp = o.spec, C = JA.base && JA.base.colliders;
    var cs = Math.cos(yaw), sn = Math.sin(yaw), kids = o.g.children, i, c, col;
    var st = { id: id, o: o, x: x, y: y, z: z, yaw: yaw, t: 0, T: 0.55 + (kids.length - 1) * 0.22, kids: [], cols: [], spark: 0, dig: 0, puff: 0, slot: 0, full: false, done: false };
    o.g.position.set(x, y, z); o.g.rotation.y = yaw; root.add(o.g);
    for (i = 0; i < kids.length; i++) { st.kids.push({ o: kids[i], y: kids[i].position.y, at: i * 0.22 }); kids[i].visible = false; }
    for (i = 0; i < sp.cols.length; i++) {
      c = sp.cols[i]; col = { x: x + c[0] * cs + c[1] * sn, z: z - c[0] * sn + c[1] * cs, r: c[2], h: sp.h };
      st.cols.push(col); if (C) C.push(col);
    }
    structs.push(st);
    W.dust(x, z, 14, 2.8, 0.7);
    tell('sound', 'plug', { at: v1.set(x, y + 1, z) });
    return st;
  }
  function stepStructs(dt, s, pos) {
    var sun = W.sunDir, dusty = W.env ? W.env.dustShown || 0 : 0, i, k, st, o, kd, u, sp, f;
    for (i = 0; i < structs.length; i++) {
      st = structs[i]; o = st.o; sp = o.spec;
      if (!st.done) {
        // being built: the parts rise and settle, with sparks
        st.t += dt;
        for (k = 0; k < st.kids.length; k++) {
          kd = st.kids[k]; u = (st.t - kd.at) / 0.55;
          kd.o.visible = u > 0;
          kd.o.position.y = kd.y - (1 - ease(u)) * 1.5;
          kd.o.scale.setScalar(Math.max(0.001, pop(u)));
        }
        st.spark -= dt;
        if (st.spark <= 0) {
          st.spark = 0.08;
          W.burst(st.x + rnd(-1, 1) * sp.rad * 0.6, st.y + rnd(0.2, Math.min(sp.h, 2.6)), st.z + rnd(-1, 1) * sp.rad * 0.6, 4, 3.2, 0xffd27a, { life: 0.4, size: 0.13, grow: 0.5, alpha: 1, grav: W.gravity * 0.5 });
          if (Math.random() < 0.3) W.dust(st.x + rnd(-1, 1) * sp.rad, st.z + rnd(-1, 1) * sp.rad, 2, 1.4, 0.5);
        }
        if (st.t >= st.T) finish(st);
      }
      if (o.head && sun) {                              // panels and mirrors follow the Sun
        o.head.rotation.y += wrap(Math.atan2(sun.x, sun.z) - st.yaw - o.head.rotation.y) * Math.min(1, dt * 0.8);
        if (o.follow) o.head.rotation.x += (clamp(Math.PI / 2 - Math.asin(clamp(sun.y, -1, 1)), 0.3, 1.2) - o.head.rotation.x) * Math.min(1, dt * 0.8);
      }
      if (o.rotor) {                                    // the wind turbine turns into the wind (it blows from the west) and spins
        o.rotor.rotation.z += dt * (1.3 + 9 * dusty);
        o.nac.rotation.y = -Math.PI / 2 - st.yaw + Math.sin((W.time || 0) * 0.25 + st.x) * 0.12;
      }
      if (o.auger) {
        o.auger.rotation.y += dt * (st.full ? 1 : 7);
        st.puff -= dt;
        if (st.puff <= 0 && st.done && !st.full && pos && Math.abs(pos.x - st.x) + Math.abs(pos.z - st.z) < 90) {
          st.puff = 0.3;
          W.emit(st.x + rnd(-0.3, 0.3), st.y + 0.3, st.z + rnd(-0.3, 0.3), { vx: rnd(-0.3, 0.3), vy: rnd(1, 1.9), vz: rnd(-0.3, 0.3), life: 1.7, size: 0.5, grow: 2.8, color: 0xdff4ff, alpha: 0.32, grav: 0 });
        }
      }
      if (o.level) {
        f = s && typeof s.water === 'number' ? clamp(s.water / (rule('waterCap', s) || 100), 0.04, 1) : 0.6;
        o.level.scale.y = f; o.level.position.y = 0.48 + 0.52 * f;
      }
    }
  }
  function finish(st) {
    var def = defOf(st.id, S) || { name: 'structure', text: '' }, k, kd;
    st.done = true;
    for (k = 0; k < st.kids.length; k++) { kd = st.kids[k]; kd.o.visible = true; kd.o.position.y = kd.y; kd.o.scale.setScalar(1); }
    W.burst(st.x, st.y + 0.4, st.z, 26, 5, 0x4dff9a, { life: 0.7, size: 0.2, grow: 0.5, alpha: 0.9, up: 0.25, grav: 0 });
    tell('sound', 'good');
    tell('toast', '✔ ' + def.name + ' built!', v1.set(st.x, st.y + Math.min(st.o.spec.h, 3) + 0.6, st.z), '#4dff9a');
    tell('say', def.name + ' built! ' + (def.text || ''));
    if (!flags.built) { flags.built = true; tell('why', 'built'); }
  }

  // ---------- breaking boulders ----------
  function breakable(b) { return !!(b && !b.seat && b.mesh && b.mesh.visible && b.col); }
  function rockOf(k) {
    var b = Tn.boulders[k], r = rocks[k], m;
    if (!r) {
      m = b.mesh;
      r = rocks[k] = { hits: 0, need: clamp(Math.round(1 + (b.r - 0.9) * 2), 2, 6), u: Math.random() * 0.4, jolt: 0, flash: 0, shrink: 1, dx: 0, dz: 0, mat: null, tint: null,
        gy: Tn.height(b.x, b.z), px: m.position.x, py: m.position.y, pz: m.position.z, sx: m.scale.x, sy: m.scale.y, sz: m.scale.z, rz: m.rotation.z };
    }
    return r;
  }
  // The rock hammer: it shows in your hands only while you swing.
  function getHammer(a) {
    var hand = a && (a.handR || a.armR);
    if (!hand || typeof hand.add !== 'function') return null;
    if (hammer && hammer.parent === hand) return hammer;
    hammer = new T.Group();
    flat(add(hammer, cyl(0.04, 0.04, 0.78, 6), M.dark, 0, 0, 0.38, true));
    add(hammer, box(0.46, 0.17, 0.17), M.metal, 0, 0, 0.78, true);
    if (a.handR) { hammer.position.set(0, -0.09, 0); hammer.rotation.x = 2.0; }      // jointed arm: gripped in the fist, head forward when the swing lands
    else { hammer.position.set(0, -0.6, 0.05); hammer.rotation.x = 0.55; }            // plain arm: at the end of it
    hammer.visible = false;
    hand.add(hammer);
    return hammer;
  }
  function swingAt(k) {
    var a = astro(), b = Tn.boulders[k], r, h;
    if (!a || swing || cool > 0 || !breakable(b)) return;
    r = rockOf(k);
    if (!(W.cam && W.cam.fp)) a.yaw = Math.atan2(b.x - a.pos.x, b.z - a.pos.z);      // face the rock
    a.throwT = 0.35;                                           // the game's own two-arm swing
    swing = { k: k, t: 0, power: r.u >= SWEET ? 2 : 1 };       // a hit while the ring is tight counts double
    h = getHammer(a); if (h) h.visible = true;
    hamT = WINDUP + HOLD + 0.2;
    tell('sound', 'swish', { at: a.pos, vol: 0.45 });
  }
  function stepSwing(dt, a) {
    cool = Math.max(0, cool - dt);
    if (hamT > 0) { hamT -= dt; if (hamT <= 0 && hammer) hammer.visible = false; }
    if (swing) {
      swing.t += dt;
      if (swing.t >= WINDUP) { var sw = swing; swing = null; cool = RECOVER; hold = HOLD; impact(sw, a); }
    }
    if (hold > 0) { hold -= dt; if (a) a.throwT = 0.39 - WINDUP; }      // the hammer stops dead on the rock for a moment (the game takes one frame off this before it draws)
  }
  function impact(sw, a) {
    var b = Tn.boulders[sw.k]; if (!a || !breakable(b)) return;
    var r = rockOf(sw.k), dx = a.pos.x - b.x, dz = a.pos.z - b.z, d = Math.hypot(dx, dz) || 1, big = sw.power > 1;
    var hx = b.x + dx / d * b.r * 0.85, hz = b.z + dz / d * b.r * 0.85, hy = r.gy + Math.min(1.25, b.r * b.sy * 0.7);      // where the hammer lands
    if (!r.mat && b.mesh.material && b.mesh.material.clone) { r.mat = b.mesh.material = b.mesh.material.clone(); r.tint = r.mat.color.clone(); }      // its own paint, so only this rock flashes and darkens
    r.hits = Math.min(r.need, r.hits + sw.power); r.jolt = 1; r.flash = big ? 1 : 0.6; r.u = 0.06; r.dx = -dx / d; r.dz = -dz / d;
    if (live.indexOf(sw.k) < 0) live.push(sw.k);
    W.burst(hx, hy, hz, big ? 16 : 9, 4.2, rockColor(), { life: 0.8, size: 0.17, grow: 0.7, alpha: 1, grav: W.gravity });      // chips
    W.dust(hx, hz, big ? 9 : 5, 2, 0.5);
    if (big) W.burst(hx, hy, hz, 10, 5.5, 0xffd27a, { life: 0.3, size: 0.13, grow: 0.4, alpha: 1, grav: 0 });
    W.cam.shake = Math.max(W.cam.shake, big ? 0.2 : 0.11);
    tell('sound', 'thud', { at: v2.set(hx, hy, hz), vol: big ? 1.3 : 0.9 });
    if (big) { tell('sound', 'ice', { at: v2, vol: 0.7 }); tell('toast', 'Great hit! ×2', v3.set(b.x, hy + 1.3, b.z), '#ffd23f'); }
    if (r.hits >= r.need) { shatter(sw.k); return; }
    try { crack(b, a.pos); if (big) crack(b, a.pos); } catch (e) { warn(e); }
  }
  // A dark crack that runs over the rock from where the hammer hit. It is found by pointing rays at the rock.
  function crack(b, from) {
    var mesh = b.mesh, cy = Tn.height(b.x, b.z) + b.r * b.sy * 0.3, pts = [], out = [], i, hit, w, n;
    var a = Math.atan2(from.x - b.x, from.z - b.z) + rnd(-0.9, 0.9), el = rnd(0.25, 0.8), da = rnd(-0.22, 0.22), de = (Math.random() < 0.5 ? -1 : 1) * rnd(0.1, 0.2);
    mesh.updateMatrixWorld(true);
    ray.far = b.r * 5;
    for (i = 0; i < 6; i++) {
      v1.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
      v2.set(b.x, cy, b.z).addScaledVector(v1, b.r * 3.2);
      ray.set(v2, v3.copy(v1).negate());
      hit = ray.intersectObject(mesh, false)[0];
      if (!hit) break;
      pts.push(hit.point.clone().addScaledVector(v1, 0.03)); out.push(v1.clone());
      a += da + rnd(-0.16, 0.16); el += de + rnd(-0.1, 0.1);
      if (el < 0.08 || el > 1.4) break;
    }
    n = pts.length; if (n < 2) return;
    // a thin ribbon along those points, stored in the rock's own space so it moves and shrinks with the rock
    var pos = new Float32Array(n * 6), idx = [];
    for (i = 0; i < n; i++) {
      v1.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
      v2.crossVectors(out[i], v1).normalize();
      w = (i === 0 || i === n - 1 ? 0.008 : 0.032) * Math.sqrt(b.r);
      mesh.worldToLocal(v3.copy(pts[i]).addScaledVector(v2, w)); pos[i * 6] = v3.x; pos[i * 6 + 1] = v3.y; pos[i * 6 + 2] = v3.z;
      mesh.worldToLocal(v3.copy(pts[i]).addScaledVector(v2, -w)); pos[i * 6 + 3] = v3.x; pos[i * 6 + 4] = v3.y; pos[i * 6 + 5] = v3.z;
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx);
    mesh.add(new T.Mesh(g, M.crack));
  }
  // The jolt, the flash and the slow shrinking of the rocks that were hit.
  function stepRocks(dt) {
    var i, k, b, r, m, want, j, sc;
    for (i = live.length - 1; i >= 0; i--) {
      k = live[i]; b = Tn.boulders[k]; r = rocks[k];
      if (!r || !breakable(b)) { live.splice(i, 1); continue; }
      r.jolt = Math.max(0, r.jolt - dt * 3.4); r.flash = Math.max(0, r.flash - dt * 4);
      want = 1 - 0.24 * r.hits / r.need;
      r.shrink += (want - r.shrink) * Math.min(1, dt * 12);
      m = b.mesh; j = r.jolt * r.jolt; sc = r.shrink * (1 + 0.05 * j);
      m.position.set(r.px + r.dx * 0.14 * j, r.gy + (r.py - r.gy) * r.shrink, r.pz + r.dz * 0.14 * j);
      m.rotation.z = r.rz + 0.07 * j * Math.sin(r.jolt * 26);
      m.scale.set(r.sx * sc, r.sy * r.shrink * (1 - 0.05 * j), r.sz * sc);
      if (r.mat && r.mat.emissive) { r.mat.emissive.setHex(0xffa860); r.mat.emissiveIntensity = r.flash * 0.32; r.mat.color.copy(r.tint).multiplyScalar(1 - 0.2 * r.hits / r.need); }
      if (r.jolt <= 0 && r.flash <= 0 && Math.abs(r.shrink - want) < 0.002) live.splice(i, 1);
    }
  }
  // Take a boulder off the map: it no longer shows and no longer blocks the way.
  function clearRock(b) {
    var C = JA.base && JA.base.colliders, i = C ? C.indexOf(b.col) : -1;
    if (b.mesh) b.mesh.visible = false;
    if (i >= 0) C.splice(i, 1);
  }
  function shatter(k) {
    var b = Tn.boulders[k], s = S, gy = Tn.height(b.x, b.z), give;
    clearRock(b);
    give = rule('rockYield', s, k, b.r) || { rock: 2 };
    rule('breakRock', s, k);
    W.burst(b.x, gy + b.r * 0.5, b.z, 24 + Math.round(b.r * 8), 6, rockColor(), { life: 1.1, size: 0.24, grow: 0.6, alpha: 1, grav: W.gravity });
    W.burst(b.x, gy + 0.4, b.z, 30, 4, dustColor(), { life: 1.8, size: 1.1, grow: 3, alpha: 0.5, up: 0.8, grav: W.gravity * 0.12 });
    W.cam.shake = Math.max(W.cam.shake, clamp(0.22 + b.r * 0.08, 0.25, 0.5));
    tell('sound', 'thud', { at: v2.set(b.x, gy + 0.5, b.z), vol: 1.5 });
    tell('sound', 'drop', { at: v2, vol: 1 });
    throwPieces(b, gy, give, astro());
    if (!flags.isru) { flags.isru = true; tell('why', 'isru'); }
  }
  // Rocks that the mission already counts as broken must not stand in a freshly built world.
  function syncBroken(s) {
    var k, b;
    for (k in (s.broken || {})) { b = Tn.boulders[k]; if (s.broken[k] && b && !b.seat && b.mesh && b.mesh.visible) clearRock(b); }
  }

  // ---------- the pieces ----------
  function throwPieces(b, gy, give, who) {
    var list = [], count = {}, k, i, j, most, a, lo, g = W.gravity || 3.7, p, mesh, hop, vy, far, sc;
    var toMe = who ? Math.atan2(who.pos.z - b.z, who.pos.x - b.x) : 0, fan = who ? 4.4 : Math.PI * 2;      // they fly out on your side of the rock, not far behind it
    for (k in give) { count[k] = 0; for (i = 0; i < give[k]; i++) { list.push({ kind: k, n: 1 }); count[k]++; } }
    // too many to show: two pieces of the most common kind become one bigger piece
    while (list.length > MAX_PIECES) {
      most = null; for (k in count) if (!most || count[k] > count[most]) most = k;
      a = -1; lo = -1;
      for (i = 0; i < list.length; i++) if (list[i].kind === most) { if (a < 0 || list[i].n < list[a].n) { lo = a; a = i; } else if (lo < 0 || list[i].n < list[lo].n) lo = i; }
      if (a < 0 || lo < 0) break;
      list[a].n += list[lo].n; list.splice(lo, 1); count[most]--;
    }
    for (i = 0; i < list.length; i++) {
      j = list[i]; a = toMe + ((i + 0.5) / list.length - 0.5) * fan + rnd(-0.25, 0.25);
      mesh = new T.Mesh(j.kind === 'metal' ? GEO.nugget : j.kind === 'glass' ? GEO.shard : GEO.lump, j.kind === 'metal' ? M.ore : j.kind === 'glass' ? M.sand : M.rock);
      mesh.castShadow = true;
      sc = Math.min(1.7, 1 + 0.2 * (j.n - 1));
      mesh.scale.set(sc * rnd(0.85, 1.15), sc * (j.kind === 'glass' ? 1.4 : rnd(0.7, 1)), sc * rnd(0.85, 1.15));
      mesh.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      hop = rnd(1.0, 2.0); vy = Math.sqrt(2 * g * hop); far = (b.r * 0.5 + rnd(1.2, 2.8)) / (2 * vy / g);        // a hop of 1 to 2 m that lands a few metres out, whatever the gravity
      p = { kind: j.kind, n: j.n, mesh: mesh, r: 0.26 * sc, state: 'fly', age: 0, pt: 0, spin: rnd(3, 8), glint: rnd(0, 1),
        pos: new T.Vector3(b.x + Math.cos(a) * b.r * 0.4, gy + rnd(0.4, 0.5 + b.r * 0.5), b.z + Math.sin(a) * b.r * 0.4),
        vel: new T.Vector3(Math.cos(a) * far, vy, Math.sin(a) * far) };
      mesh.position.copy(p.pos); root.add(mesh);
      pieces.push(p);
    }
  }
  function stepPieces(dt, pos) {
    var g = W.gravity || 3.7, pull = driving() ? PULL_R + 1 : PULL_R, i, p, gnd, hit, rr;
    for (i = pieces.length - 1; i >= 0; i--) {
      p = pieces[i]; p.age += dt;
      if (p.state === 'fly') {
        p.vel.y -= g * dt; p.pos.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt;
        rr = Math.hypot(p.pos.x, p.pos.z);
        if (rr > Tn.PLAY_R - 1) { p.pos.x *= (Tn.PLAY_R - 1) / rr; p.pos.z *= (Tn.PLAY_R - 1) / rr; p.vel.x = p.vel.z = 0; }
        gnd = ground(p.pos.x, p.pos.z) + p.r;
        if (p.pos.y <= gnd) {
          p.pos.y = gnd; hit = Math.abs(p.vel.y);
          if (hit > 1) { p.vel.y = hit * 0.38; p.vel.x *= 0.55; p.vel.z *= 0.55; p.spin *= 0.5; if (hit > 1.8) W.dust(p.pos.x, p.pos.z, 2, 0.8, 0.25); }
          else { p.state = 'rest'; p.vel.set(0, 0, 0); }
        }
      } else if (p.state === 'rest') {
        // a glint now and then, so a piece left on the ground is easy to find again
        p.glint -= dt;
        if (p.glint <= 0) { p.glint = rnd(0.6, 1.3); W.emit(p.pos.x, p.pos.y + 0.2, p.pos.z, { vy: 1.1, life: 0.8, size: 0.2, grow: 0.3, color: SPARK[p.kind] || 0xffffff, alpha: 1, grav: 0 }); }
      }
      // close enough: it flies into the bag
      if (p.state !== 'pull' && pos && p.age > 0.8 && Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z) < pull && Math.abs(pos.y - p.pos.y) < 4) { p.state = 'pull'; p.pt = 0; }
      if (p.state === 'pull') {
        p.pt += dt;
        v1.set(pos.x, pos.y + 1.1, pos.z);
        p.pos.lerp(v1, Math.min(1, dt * (5 + p.pt * 22)));
        p.mesh.rotation.y += dt * 9;
        if (p.pos.distanceTo(v1) < 0.4 || p.pt > 0.9) { collect(p); pieces.splice(i, 1); continue; }
      }
      p.mesh.position.copy(p.pos);
    }
  }
  function collect(p) {
    var mat = (JA.MATS || {})[p.kind] || { icon: '' };
    rule('addMat', S, p.kind, p.n);
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    W.burst(p.pos.x, p.pos.y, p.pos.z, 5, 1.6, SPARK[p.kind] || 0xffffff, { life: 0.45, size: 0.14, grow: 0.5, alpha: 0.9, grav: 0 });
    tell('sound', 'pop', { at: p.pos, vol: 0.8 });
    tell('toast', '+' + p.n + ' ' + mat.icon, v2.set(p.pos.x, p.pos.y + 0.9 + (stack++ % 3) * 0.5, p.pos.z), TINT[p.kind] || '#fff');
  }

  // ---------- the drill rig digs by itself ----------
  function stepRigs(dt, s, play, pos) {
    var A = JA.actors, t = s.t || 0, d = lastT == null ? 0 : t - lastT, i, k, st, it, n, cs, sn, side;
    lastT = t;
    if (!(d > 0 && d < 5)) return;                      // a new day began or the clock jumped: nothing was dug in between
    if (!A || !A.items || !A.spawn) return;
    for (i = 0; i < structs.length; i++) {
      st = structs[i]; if (st.id !== 'rig' || !st.done) continue;
      st.dig += d;
      if (st.dig < RIG_EVERY) continue;
      n = 0;
      for (k = 0; k < A.items.length; k++) { it = A.items[k]; if (it.type === 'ice' && it.state !== 'held' && it.state !== 'bed' && Math.hypot(it.pos.x - st.x, it.pos.z - st.z) < RIG_NEAR) n++; }
      st.full = n >= RIG_MAX;
      if (st.full) { st.dig = RIG_EVERY - 4; continue; }       // the tray is full: look again in a moment
      st.dig = 0;
      cs = Math.cos(st.yaw); sn = Math.sin(st.yaw); side = (st.slot++ % 2 ? 0.5 : -0.5) + rnd(-0.12, 0.12);
      v1.set(st.x + 1.95 * cs + side * sn, 0, st.z - 1.95 * sn + side * cs); v1.y = ground(v1.x, v1.z) + 0.42;
      A.spawn('ice', v1, null, 'rest');
      if (play) {
        tell('sound', 'ice', { at: v1, vol: 0.9 });
        W.burst(v1.x, v1.y, v1.z, 8, 2, 0xbfefff, { life: 0.6, size: 0.18, grow: 0.6, alpha: 0.9, grav: 0 });
        if (pos && Math.hypot(pos.x - st.x, pos.z - st.z) < 60) tell('toast', JA.waterWords(S).icon + ' +1', v2.set(v1.x, v1.y + 1, v1.z), '#7fe8ff');
      }
      if (!flags.rig) { flags.rig = true; tell('say', JA.iceWell(S) ? 'Your well pump just filled a can of water, all by itself! It keeps two ready for you beside it.' : 'Your drill rig just dug out an ice chunk, all by itself! It keeps two ready for you beside it.'); }
    }
  }

  // ---------- placing a structure ----------
  // A building's words on this planet: fields under the planet's id replace the others (Sahrun's drill rig is a well pump)
  function defOf(id, s) {
    var d = (JA.BUILDS || {})[id], sid = s && s.site && s.site.id;
    return d && sid && d[sid] ? Object.assign({}, d, d[sid]) : d;
  }
  function allowed(s, def) { return !!def && (!def.site || !s || !s.site || def.site === s.site.id); }
  function startPlace(id) {
    var s = S, def = defOf(id, S), can, o, edge;
    if (!on || !s || !def || !root || !M) return false;
    if (place) cancelPlace(true);
    if (lastMode !== 'play') { tell('say', 'Step outside first. Building happens out on the ground.'); return false; }
    if (driving()) { tell('say', 'Climb out of the rover first, then pick what to build.'); return false; }
    can = rule('canBuild', s, id);
    if (can && !can.ok) { tell('sound', 'deny'); if (can.msg) tell('say', can.msg); return false; }
    o = shape(id, null);
    o.g.traverse(function (m) { if (m.isMesh) { m.material = M.ghost; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 3; } });
    edge = add(o.g, new T.RingGeometry(o.spec.rad - 0.09, o.spec.rad, 30), M.edge, 0, 0.12, 0, true);       // the ground it will take
    edge.rotation.x = -Math.PI / 2; edge.renderOrder = 3;
    o.g.visible = false; root.add(o.g);
    place = { id: id, def: def, o: o, spec: o.spec, ok: false, msg: '', x: 0, y: 0, z: 0, yaw: 0, shown: null };
    stepPlace(astro());
    if (!flags.placeTip) {
      flags.placeTip = true;
      tell('say', 'Walk and look around to choose a spot. Green means it fits. ' + (touch() ? 'Tap ✋ to build it, or 🎯 to cancel.' : 'Press E to build it, or Q to cancel.'));
    }
    chipSig = '';
    return true;
  }
  function cancelPlace(quiet) {
    if (!place) return;
    if (place.o.g.parent) place.o.g.parent.remove(place.o.g);
    place.o.g.traverse(function (m) { if (m.isMesh && m.geometry) m.geometry.dispose(); });
    place = null; chipSig = '';
    if (!quiet) tell('sound', 'tap');
  }
  // Why the ghost cannot stand where it is ('' when the spot is fine).
  function spotProblem(pl) {
    var x = pl.x, z = pl.z, sp = pl.spec, L = Tn.L, C = (JA.base && JA.base.colliders) || [], R = JA.actors && JA.actors.rover;
    var cs = Math.cos(pl.yaw), sn = Math.sin(pl.yaw), lo = pl.y, hi = pl.y, i, k, h, c, list, q;
    if (Math.hypot(x, z) + sp.rad > Tn.PLAY_R - 3) return 'Not here: too close to the edge of the map';
    if (Math.hypot(x - DOOR[0], z - DOOR[1]) < DOOR_R) return 'Not here: keep the way to the door clear';
    if (pl.def.where === 'ice' && L.ice && Math.hypot(x - L.ice[0], z - L.ice[1]) > (Tn.iceR || 20) * 0.8) return JA.iceWell(S) ? 'Not here: it must stand at the ' + S.site.iceName : 'Not here: it must stand on the ice field';
    for (i = 0; i < 8; i++) { h = ground(x + Math.cos(i * 0.785) * sp.rad, z + Math.sin(i * 0.785) * sp.rad); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo >= BUMPY) return 'Not here: the ground is too bumpy';
    // a wall is long and thin, so it is checked by its own small circles; everything else by its round footprint
    list = sp.thin ? sp.cols : [[0, 0, sp.rad]];
    for (k = 0; k < list.length; k++) {
      q = list[k]; v4.set(x + q[0] * cs + q[1] * sn, 0, z - q[0] * sn + q[1] * cs);
      for (i = 0; i < C.length; i++) { c = C[i]; if (Math.hypot(v4.x - c.x, v4.z - c.z) < q[2] + c.r + CLEAR) return 'Not here: something is in the way'; }
      if (R && R.pos && Math.hypot(v4.x - R.pos.x, v4.z - R.pos.z) < q[2] + 2.6) return 'Not here: the rover is in the way';
    }
    if (L.colony && JA.colony && Math.hypot(x - L.colony[0], z - L.colony[1]) < 40) return 'Not here: ships from Earth land on this plain';
    return '';
  }
  function stepPlace(a) {
    var pl = place, g = pl.o.g, f = W.forward(v1), d = Math.max(AHEAD, pl.spec.rad + 1.5), col;
    if (!a) return;
    pl.x = a.pos.x + f.x * d; pl.z = a.pos.z + f.z * d; pl.y = ground(pl.x, pl.z); pl.yaw = W.cam ? W.cam.yaw : 0;
    pl.msg = spotProblem(pl); pl.ok = !pl.msg;
    g.visible = true; g.position.set(pl.x, pl.y + 0.06, pl.z); g.rotation.y = pl.yaw;
    if (pl.ok !== pl.shown) { pl.shown = pl.ok; col = pl.ok ? 0x4dff9a : 0xff5468; M.ghost.color.setHex(col); M.edge.color.setHex(col); }
    M.ghost.opacity = 0.5 + Math.sin((W.time || 0) * 5) * 0.1;
  }
  function confirmPlace() {
    var pl = place, s = S, r;
    if (!pl || !s) return;
    if (!pl.ok) { tell('sound', 'deny'); return; }
    r = rule('build', s, pl.id);
    if (!r || !r.ok) { tell('sound', 'deny'); if (r && r.msg) tell('say', r.msg); cancelPlace(true); return; }
    raise(pl.id, pl.x, pl.z, pl.yaw);
    cancelPlace(true);
    tell('sync');
  }

  // ---------- the bag chip and the timing ring (plain HTML over the 3D view) ----------
  function makeDom() {
    var mats = JA.MATS || {}, html = '', k, old;
    if (chip || !document.body) return;
    old = document.getElementById('pio-chip'); if (old) old.parentNode.removeChild(old);
    old = document.getElementById('pio-ring'); if (old) old.parentNode.removeChild(old);
    for (k in mats) html += '<span class="pio-mat" data-k="' + esc(k) + '" title="' + esc(mats[k].name) + '"><i>' + mats[k].icon + '</i><b>0</b></span>';
    chip = document.createElement('div');
    chip.id = 'pio-chip'; chip.className = 'hidden';
    chip.setAttribute('aria-label', 'Your bag of building materials');
    chip.innerHTML = '<div class="pio-mats">' + html + '</div><button type="button" class="pio-btn"><span>🔨 Build</span><kbd>B</kbd></button>';
    document.body.appendChild(chip);
    chip.querySelector('.pio-btn').addEventListener('click', function () { this.blur(); if (place) cancelPlace(); else P.menu(); });
    ring = document.createElement('div');
    ring.id = 'pio-ring'; ring.className = 'hidden'; ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<i class="pio-aim"></i><i class="pio-pulse"></i><span class="pio-pips"></span>';
    document.body.appendChild(ring);
    pulse = ring.querySelector('.pio-pulse'); pips = ring.querySelector('.pio-pips');
    // if the game stops calling update (a menu, the title screen), the chip must not stay behind
    if (!watching) { watching = true; setInterval(function () { if ((chipOn || ringOn) && Date.now() - lastTick > 900) quiet(); }, 500); }
  }
  function showChip(show, inside) {
    if (!chip) return;
    if (show !== chipOn) { chipOn = show; chip.classList.toggle('hidden', !show); }
    if (show && inside !== chipIn) { chipIn = inside; chip.classList.toggle('in', !!inside); }
  }
  function hideRing() { if (ring && ringOn) { ringOn = false; ring.classList.add('hidden'); } }
  function quiet() { showChip(false); hideRing(); }
  function refreshChip(s) {
    var m = s.mats || {}, B = JA.BUILDS || {}, sig = place ? 'p' : '', k, el, b, n, can = false, btn;
    if (!chip) return;
    for (k in JA.MATS) sig += (m[k] || 0) + ',';
    for (k in (s.built || {})) sig += s.built[k];
    if (sig === chipSig) return;
    chipSig = sig;
    for (k in JA.MATS) {
      el = chip.querySelector('[data-k="' + k + '"]'); if (!el) continue;
      b = el.querySelector('b'); n = String(m[k] || 0);
      if (b.textContent !== n) { b.textContent = n; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }      // a little jump when the number changes
    }
    for (k in B) if (allowed(s, B[k]) && (rule('canBuild', s, k) || {}).ok) can = true;
    btn = chip.querySelector('.pio-btn');
    btn.classList.toggle('ready', can && !place); btn.classList.toggle('placing', !!place);
    btn.firstChild.textContent = place ? '✖ Cancel' : '🔨 Build';
  }
  // The ring on the rock in front of you: it closes again and again. Swing when it is tight and gold.
  function stepRing(dt, a) {
    var B = Tn.boulders, k = -1, best = REACH, i, b, d, r, p, sweet, sig, html;
    if (!ring) return;
    if (swing) k = swing.k;
    else if (a && a.mode === 'walk' && !a.carrying && !place && !driving()) {
      for (i = 0; i < B.length; i++) { b = B[i]; if (!breakable(b)) continue; d = Math.hypot(a.pos.x - b.x, a.pos.z - b.z) - b.r; if (d < best) { best = d; k = i; } }
    }
    b = B[k];
    if (k < 0 || !breakable(b)) { hideRing(); return; }
    r = rockOf(k);
    if (!swing) r.u = (r.u + dt / RING_T) % 1;
    p = W.project(v1.set(b.x, r.gy + Math.min(1.5, b.r * b.sy * 0.75), b.z));
    if (p.hidden) { hideRing(); return; }
    if (!ringOn) { ringOn = true; ring.classList.remove('hidden'); }
    ring.style.transform = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)';
    pulse.style.transform = 'scale(' + (1.95 - 0.95 * r.u).toFixed(3) + ')';
    sweet = swing ? swing.power > 1 : r.u >= SWEET;
    if (sweet !== ringSweet) { ringSweet = sweet; ring.classList.toggle('sweet', sweet); }
    sig = k + ':' + r.hits + '/' + r.need;
    if (sig !== pipSig) { pipSig = sig; html = ''; for (i = 0; i < r.need; i++) html += '<b' + (i < r.hits ? ' class="on"' : '') + '></b>'; pips.innerHTML = html; }
    if (!flags.hint) {
      flags.hint = true;
      tell('say', 'Rock hammer ready! ' + (touch() ? 'Tap ✋' : 'Press E') + ' to swing. Wait for the ring to close and turn gold: that hit counts double.');
    }
  }

  // ---------- the build menu ----------
  function menuHtml(s) {
    var B = JA.BUILDS || {}, MT = JA.MATS || {}, m = s.mats || {}, bag = '', cards = '', id, def, k, can, n, cost, have, src;
    for (k in MT) bag += '<span>' + MT[k].icon + ' ' + esc(MT[k].name) + ' <b>' + (m[k] || 0) + '</b></span>';
    for (id in B) {
      def = defOf(id, s); if (!allowed(s, def)) continue;
      can = rule('canBuild', s, id) || { ok: false, msg: 'The workshop is not ready yet.' };
      n = (s.built && s.built[id]) || 0; cost = '';
      for (k in (def.cost || {})) {
        have = m[k] || 0;
        cost += '<span' + (have < def.cost[k] ? ' class="short"' : '') + ' title="' + esc(MT[k] ? MT[k].name : k) + '">' + (MT[k] ? MT[k].icon : esc(k)) + ' ' + have + '/' + def.cost[k] + '</span>';
      }
      src = JA.SOURCES && JA.SOURCES[def.src];
      cards += '<div class="pio-card' + (can.ok ? ' can' : '') + '"><em>' + (def.icon || '📦') + '</em>' +
        '<div class="pio-info"><div class="pio-head"><b>' + esc(def.name) + '</b><span>' + n + '/' + (def.max || 1) + ' built</span></div>' +
        '<span class="pio-text">' + esc(def.text) + '</span>' +
        '<small class="pio-why">' + esc(def.why) + (src ? ' <i>' + esc(src.name) + '</i>' : '') + '</small></div>' +
        '<div class="pio-foot"><div class="pio-cost">' + cost + '</div>' + (can.ok ? '' : '<span class="pio-no">' + esc(can.msg) + '</span>') +
        '<button type="button" class="btn primary pio-go" data-pio="' + esc(id) + '"' + (can.ok ? '' : ' disabled') + '>Build</button></div></div>';
    }
    return '<div class="pio-menu"><h2>⛏ Pioneer workshop</h2>' +
      '<p class="sub">Living off the land: break boulders with your rock hammer, pick up the pieces, then build with them. Real crews plan to do the same, so they can bring less from Earth.</p>' +
      '<div class="pio-bag"><em>In your bag</em>' + bag + '</div><div class="pio-list">' + cards + '</div></div>';
  }
  function choose() {
    var id = this.getAttribute('data-pio');
    tell('closeInfo');
    startPlace(id);
  }

  // =====================================================================
  //  CALLED BY THE GAME
  // =====================================================================
  // A new world was built: forget everything from the old one.
  P.build = function (rootGroup, siteId) {
    try {
      root = rootGroup || null; site = siteId || 'mars';
      rocks = {}; live = []; swing = null; cool = 0; hold = 0; hammer = null; hamT = 0;
      pieces = []; structs = []; place = null; flags = {}; synced = null; lastT = null; chipSig = ''; pipSig = '';
      makeKit();
      quiet();
    } catch (e) { warn(e); }
  };
  // A mission begins with Pioneer mode on. api: { say, toast, why, openInfo, closeInfo, sound, sync }
  P.start = function (s, helpers) {
    try {
      if (s !== lastS) { lastS = s; flags = {}; synced = null; lastT = null; }
      S = s || null; api = helpers || {}; on = !!s; chipSig = '';
      makeDom();
    } catch (e) { warn(e); }
  };
  // The mission is not in Pioneer mode, or the player left.
  P.stop = function () {
    try {
      on = false; swing = null;
      if (place) cancelPlace(true);
      if (hammer) hammer.visible = false;
      quiet();
    } catch (e) { warn(e); }
  };
  P.active = function () { return on; };
  P.placing = function () { return !!place; };
  // Every frame. mode: the game's mode; pos: where the astronaut (or the rover being driven) is.
  P.update = function (dt, s, mode, pos) {
    try {
      var play = mode === 'play', inside = mode === 'inside', a = astro();
      lastTick = Date.now(); lastMode = mode;
      if (!on || !s || s.pioneer === false || !root || !M || (!play && !inside)) {
        quiet(); swing = null;
        if (place && !play && !inside) cancelPlace(true);
        return;
      }
      S = s;
      if (synced !== s) { synced = s; syncBroken(s); }
      dt = Math.min(dt || 0, 0.1);
      pos = pos || (a && a.pos) || null;
      showChip(true, inside); refreshChip(s);
      stepRigs(dt, s, play, pos);
      if (!play) { hideRing(); if (place) place.o.g.visible = false; return; }
      glowAll(s);
      stepSwing(dt, a); stepRocks(dt); stepPieces(dt, pos); stepStructs(dt, s, pos);
      if (place) stepPlace(a);
      stepRing(dt, a);
    } catch (e) { warn(e); }
  };
  // What E does. The game picks the nearest offer; while a ghost is out, placing always wins.
  P.offer = function (s, p, offer) {
    try {
      var a = astro(), B = Tn.boulders, i, b, d;
      if (!on || !s || !p || typeof offer !== 'function') return;
      if (place) {
        offer(-1000, 1, { label: place.ok ? 'Build the ' + lowerFirst(place.def.name) + ' here' : place.msg, run: confirmPlace, alt: function () { cancelPlace(); }, altLabel: 'cancel' });
        return;
      }
      if (!a || a.carrying || a.mode !== 'walk' || driving()) return;
      for (i = 0; i < B.length; i++) {
        b = B[i]; if (!breakable(b)) continue;
        d = Math.hypot(p.x - b.x, p.z - b.z) - b.r;
        if (d < REACH) (function (k) { offer(d, REACH, { label: 'Break the rock ⛏', run: function () { swingAt(k); } }); })(i);
      }
    } catch (e) { warn(e); }
  };
  // Open the build menu (the B key, the Settings menu and the bag chip all come here).
  P.menu = function () {
    try {
      var el, btns, box, i;
      if (!on || !S || !api || typeof api.openInfo !== 'function' || (lastMode !== 'play' && lastMode !== 'inside')) return false;
      if (document.querySelector('#info-root.open .pio-menu')) { tell('closeInfo'); return false; }      // B again closes it
      if (place) cancelPlace(true);
      el = api.openInfo(menuHtml(S)) || document.getElementById('info-root');
      btns = el && el.querySelectorAll ? el.querySelectorAll('[data-pio]') : [];
      for (i = 0; i < btns.length; i++) btns[i].addEventListener('click', choose);
      box = el && el.querySelector ? el.querySelector('.modal') : null;
      if (box) box.scrollTop = 0;                       // the list is long: start at its top, not at the close button
      if (el && el.addEventListener && !el.pioKey) {    // B closes the workshop again (the game itself ignores keys while a card is open)
        el.pioKey = true;
        el.addEventListener('keydown', function (e) {
          if (e.code === 'KeyB' && !e.repeat && el.querySelector('.pio-menu')) { e.preventDefault(); e.stopPropagation(); tell('closeInfo'); }
        });
      }
      return true;
    } catch (e) { warn(e); return false; }
  };
})(window.JA);
