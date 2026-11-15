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

  function raw(x, z) {
    var r = Math.hypot(x, z), h, i, d;
    var mask = smooth(36, 66, r);
    if (site === 'mars') {
      h = (vn(x * 0.016, z * 0.016) - 0.5) * 10 + (vn(x * 0.05, z * 0.05) - 0.5) * 3 + (vn(x * 0.17, z * 0.17) - 0.5) * 0.6;
      // dune field to the south-west
      var dune = smooth(40, 110, z) * smooth(20, -60, x);
      h += dune * (Math.sin(x * 0.11 + z * 0.05 + vn(x * 0.02, z * 0.02) * 5) * 0.5 + 0.5) * 3.4;
      // an old dry channel winding across the north
      var cz = -132 + Math.sin(x * 0.021) * 24;
      d = z - cz;
      h -= 3.6 * Math.exp(-(d * d) / 170);
    } else {
      h = (vn(x * 0.014, z * 0.014) - 0.5) * 9 + (vn(x * 0.045, z * 0.045) - 0.5) * 2.6 + (vn(x * 0.15, z * 0.15) - 0.5) * 0.5;
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
    // mesa (Mars only): a flat-topped table of layered rock
    if (site === 'mars') {
      d = Math.hypot(x - L.mesa[0], z - L.mesa[1]) + (vn(x * 0.2, z * 0.2) - 0.5) * 3;
      h += 9.5 * smooth(17, 11, d);
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
    rng = JA.sim.rng32(id === 'mars' ? 4242 : 1969);
    flats = [];
    var moon = id === 'moon';
    Tn.iceR = moon ? 30 : 21;
    craters = [{ x: L.ice[0], z: L.ice[1], r: Tn.iceR, depth: moon ? 8 : 5, floor: 0.78, rim: moon ? 0.16 : 0.08 }];
    if (moon) craters.push({ x: -96, z: -112, r: 18, depth: 5.5, floor: 1, rim: 0.3 });
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
    var n = moon ? 46 : 12, tries = 0;
    while (craters.length < n + (moon ? 2 : 1) && tries++ < 900) {
      var a = rng() * Math.PI * 2, rr = 70 + rng() * 270, cr = 3.5 + Math.pow(rng(), 2) * (moon ? 22 : 13);
      var cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
      if (!free(cx, cz, cr)) continue;
      craters.push({ x: cx, z: cz, r: cr, depth: cr * (moon ? 0.24 : 0.13), floor: 1, rim: moon ? 0.3 : 0.2 });
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
    if (moon) { cluster(L.geo[0], 13, 15, 1.1, 3.2, 5); cluster(L.geo[2], 4, 8, 1, 2, 6); }
    else { cluster(L.geo[0], 5, 8, 1, 2.2, 6); cluster(L.geo[2], 8, 11, 1.2, 3, 5); }
    tries = 0;
    while (B.length < (moon ? 46 : 40) && tries++ < 600) {
      var ba = rng() * Math.PI * 2, bd = 62 + rng() * 150, bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd;
      if (free(bx, bz, 2)) boulder(bx, bz, 1 + rng() * 2.4);
    }
  };
})(window.JA);
