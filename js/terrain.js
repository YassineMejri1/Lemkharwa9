/* Astro Outpost — the shape of the land. Pure maths (no graphics), so the same height
   function is used for drawing the ground, walking on it, driving and throwing. */
(function (JA) {
  'use strict';
  var Tn = JA.terrain = {};
  var site = 'mars', craters = [], flats = [], rng = null;

  Tn.PLAY_R = 172;
  // Where everything is (x, z) in metres. +z is "south", toward the starting camera.
  var L = Tn.L = {
    hab: [0, 0], door: [0, 8.6], rack: [-18, -3], solar: [-29, -11], air: [-15, 13], food: [20, 12],
    bag: [14, -12], lab: [28, -5], comms: [3, -28], roverPark: [-6, 22], rocket: [-48, 34], pallet: [-33, 26],
    ice: [108, -42], hill: [-64, -54], mesa: [90, 88], seat: [34, 40],
    geo: [[74, 70], [-92, 58], [-84, -100], [115, -47]],
    inst: { seismo: [42, 52], beam: [-22, -64], rad: [64, -14] },
    photo: [[-64, -54], [80, -22]],
    colony: [40, -62]          // the flat, empty plain where the settlement grows (js/colony.js)
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hash(x, z) { var s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vn(x, z) {
    var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
  }
  Tn.noise = vn; Tn.smooth = smooth;

  // The land of each planet, as numbers. A new planet adds its own entry (see Tn.setSite and raw()).
  //   seed                 the random stream that places craters and boulders
  //   hills                three layers of rolling ground: [scale, height] each, from wide and tall to small and low
  //   dunes, channel, mesa how tall the south-west dune field, the old dry channel in the north and the mesa are (0 = none)
  //   ice                  the crater or pit that holds the ice: radius, depth, rim height
  //   farCrater            a second big crater far to the north-west
  //   craters              how many random craters, and their biggest radius, depth and rim (as parts of the radius)
  //   clusters             boulder heaps at two rock sites: [rock site, count, spread, smallest, biggest, empty middle]
  //   boulders             how many boulders in all
  //   erg                  (optional) a sea of dunes over the whole plain: height, spacing (wave) and how much of each
  //                        dune is the gentle windward side (rise); the rest is the steep slip face where sand slides down
  var SHAPES = {
    moon: { seed: 1969, hills: [[0.014, 9], [0.045, 2.6], [0.15, 0.5]], dunes: 0, channel: 0, mesa: 0,
      ice: { r: 30, depth: 8, rim: 0.16 }, farCrater: true, craters: { n: 46, size: 22, depth: 0.24, rim: 0.3 },
      clusters: [[0, 13, 15, 1.1, 3.2, 5], [2, 4, 8, 1, 2, 6]], boulders: 46 },
    mars: { seed: 4242, hills: [[0.016, 10], [0.05, 3], [0.17, 0.6]], dunes: 3.4, channel: 3.6, mesa: 9.5,
      ice: { r: 21, depth: 5, rim: 0.08 }, farCrater: false, craters: { n: 12, size: 13, depth: 0.13, rim: 0.2 },
      clusters: [[0, 5, 8, 1, 2.2, 6], [2, 8, 11, 1.2, 3, 5]], boulders: 40 },
    // Sahrun (made up): a smooth sand plain under a sea of dunes, a deep narrow well for the ice, a sandstone butte
    sahrun: { seed: 2611, hills: [[0.012, 6], [0.04, 1.4], [0.15, 0.2]], dunes: 0, channel: 0, mesa: 11,
      ice: { r: 15, depth: 7, rim: 0.05 }, farCrater: false, craters: { n: 5, size: 8, depth: 0.1, rim: 0.12 },
      clusters: [[0, 6, 9, 1, 2.4, 6], [2, 3, 6, 0.8, 1.6, 5]], boulders: 26,
      erg: { h: 3.2, wave: 54, rise: 0.64, sharp: true } }
  };
  var S = SHAPES.mars;

  // How tall the dunes are at a point, from 0 to about 1.4 (times erg.h). The ridges run across the wind and bend
  // with the noise; each one rises gently on the windward side and drops steeply on its slip face.
  function ergAt(x, z) {
    var E = S.erg; if (!E) return 0;
    var w = x * 0.92 + z * 0.39 + (vn(x * 0.011 + 7, z * 0.011 + 3) - 0.5) * 70;
    var p = w / E.wave, t = p - Math.floor(p);
    var prof = t < E.rise ? t / E.rise : (1 - t) / (1 - E.rise);
    // sharp: a soft foot rising straight to a knife-edge crest, then a steep slip face, like real desert dunes
    if (E.sharp) prof = t < E.rise ? Math.pow(prof, 1.6) : Math.pow(prof, 1.15);
    else prof = prof * prof * (3 - 2 * prof);                             // a rounded crest and a soft foot
    return prof * (0.6 + 0.8 * vn(x * 0.02 + 11, z * 0.02 - 4));          // some dunes are taller than others
  }
  // how much of a dune is here (0 = between dunes), with the flat outpost area left out: js/world.js paints crests by it
  Tn.erg = function (x, z) { return S.erg ? ergAt(x, z) * smooth(36, 66, Math.hypot(x, z)) : 0; };

  function raw(x, z) {
    var r = Math.hypot(x, z), h, i, d, k = S.hills;
    var mask = smooth(36, 66, r);
    h = (vn(x * k[0][0], z * k[0][0]) - 0.5) * k[0][1] + (vn(x * k[1][0], z * k[1][0]) - 0.5) * k[1][1] + (vn(x * k[2][0], z * k[2][0]) - 0.5) * k[2][1];
    if (S.dunes) {
      // dune field to the south-west
      var dune = smooth(40, 110, z) * smooth(20, -60, x);
      h += dune * (Math.sin(x * 0.11 + z * 0.05 + vn(x * 0.02, z * 0.02) * 5) * 0.5 + 0.5) * S.dunes;
    }
    if (S.erg) h += ergAt(x, z) * S.erg.h;
    if (S.channel) {
      // an old dry channel winding across the north
      var cz = -132 + Math.sin(x * 0.021) * 24;
      d = z - cz;
      h -= S.channel * Math.exp(-(d * d) / 170);
    }
    h *= mask;
    for (i = 0; i < craters.length; i++) {
      var c = craters[i];
      d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.7) {
        if (d < 1) h -= Math.min(c.depth * (1 - d * d), c.depth * (c.floor || 1));
        var e = (d - 1) / 0.2;
        h += c.depth * c.rim * Math.exp(-e * e);
      }
    }
    // lookout hill
    d = Math.hypot(x - L.hill[0], z - L.hill[1]);
    h += 13 * Math.exp(-(d * d) / (2 * 17 * 17));
    // mesa (Mars) or butte (Sahrun): a flat-topped table of layered rock
    if (S.mesa) {
      d = Math.hypot(x - L.mesa[0], z - L.mesa[1]) + (vn(x * 0.2, z * 0.2) - 0.5) * 3;
      h += S.mesa * smooth(17, 11, d);
    }
    // far rim: the land rises gently at the edge of the map
    h += smooth(Tn.PLAY_R + 10, Tn.PLAY_R + 120, r) * 26;
    return h;
  }

  Tn.height = function (x, z) {
    var h = raw(x, z);
    for (var i = 0; i < flats.length; i++) {
      var f = flats[i], d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r1) h = lerp(f.h, h, smooth(f.r0, f.r1, d));
    }
    return h;
  };
  Tn.normal = function (x, z, out) {
    var e = 0.6, hx = Tn.height(x + e, z) - Tn.height(x - e, z), hz = Tn.height(x, z + e) - Tn.height(x, z - e);
    var len = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / len; out.y = 2 * e / len; out.z = -hz / len;
    return out;
  };

  Tn.setSite = function (id) {
    site = id; Tn.site = id;
    S = JA.pick(id, SHAPES); Tn.shape = S;
    rng = JA.sim.rng32(S.seed);
    flats = [];
    Tn.iceR = S.ice.r;
    craters = [{ x: L.ice[0], z: L.ice[1], r: Tn.iceR, depth: S.ice.depth, floor: 0.78, rim: S.ice.rim }];
    if (S.farCrater) craters.push({ x: -96, z: -112, r: 18, depth: 5.5, floor: 1, rim: 0.3 });
    // keep-out circles so random craters do not land on important places
    var keep = [[0, 0, 70], [L.ice[0], L.ice[1], Tn.iceR + 16], [L.hill[0], L.hill[1], 34], [L.mesa[0], L.mesa[1], 30],
      [L.rocket[0], L.rocket[1], 24], [-96, -112, 30], [L.photo[1][0], L.photo[1][1], 12]];
    L.geo.forEach(function (g) { keep.push([g[0], g[1], 16]); });
    keep.push([L.colony[0], L.colony[1], 48]);
    Object.keys(L.inst).forEach(function (k) { keep.push([L.inst[k][0], L.inst[k][1], 14]); });
    function free(x, z, pad) {
      for (var i = 0; i < keep.length; i++) if (Math.hypot(x - keep[i][0], z - keep[i][1]) < keep[i][2] + pad) return false;
      return true;
    }
    var C = S.craters, n = C.n + craters.length, tries = 0;      // the random craters come on top of the fixed ones
    while (craters.length < n && tries++ < 900) {
      var a = rng() * Math.PI * 2, rr = 70 + rng() * 270, cr = 3.5 + Math.pow(rng(), 2) * C.size;
      var cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
      if (!free(cx, cz, cr)) continue;
      craters.push({ x: cx, z: cz, r: cr, depth: cr * C.depth, floor: 1, rim: C.rim });
      keep.push([cx, cz, cr * 0.6]);
    }
    Tn.craters = craters;

    // level pads so machines, the rocket and work sites sit flat
    function flat(p, r0, r1) { flats.push({ x: p[0], z: p[1], r0: r0, r1: r1, h: raw(p[0], p[1]) }); }
    flat(L.rocket, 11, 20); flat(L.pallet, 4, 9); flat(L.colony, 36, 48);
    L.geo.forEach(function (g) { flat(g, 3.5, 8); });
    Object.keys(L.inst).forEach(function (k) { if (k !== 'beam') flat(L.inst[k], 3, 7); });

    // ice deposits on the floor of the crater / pit
    Tn.iceNodes = [];
    for (var k = 0; k < 5; k++) {
      var ia = k / 5 * Math.PI * 2 + 0.5, ir = Tn.iceR * (0.16 + 0.14 * (k % 2));
      Tn.iceNodes.push({ x: L.ice[0] + Math.cos(ia) * ir, z: L.ice[1] + Math.sin(ia) * ir });
    }

    // big boulders you have to walk around
    var B = Tn.boulders = [];
    function boulder(x, z, r) { B.push({ x: x, z: z, r: r, sy: 0.6 + rng() * 0.6, rot: rng() * 6, tilt: rng() * 0.6 }); }
    function cluster(p, count, spread, rMin, rMax, hole) {
      for (var i = 0; i < count; i++) {
        var ca = rng() * Math.PI * 2, cd = hole + rng() * spread;
        boulder(p[0] + Math.cos(ca) * cd, p[1] + Math.sin(ca) * cd, rMin + rng() * (rMax - rMin));
      }
    }
    // a low, flat rock with a view of the whole outpost: the seat in the landing film
    B.push({ x: L.seat[0], z: L.seat[1], r: 1.25, sy: 0.42, rot: 0.6, tilt: 0.06, seat: true });
    S.clusters.forEach(function (c) { cluster(L.geo[c[0]], c[1], c[2], c[3], c[4], c[5]); });
    tries = 0;
    while (B.length < S.boulders && tries++ < 600) {
      var ba = rng() * Math.PI * 2, bd = 62 + rng() * 150, bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd;
      if (free(bx, bz, 2)) boulder(bx, bz, 1 + rng() * 2.4);
    }
  };
})(window.JA);
