/* Astro Outpost — Sahrun's surface detail, made in code.
   The Moon and Mars get theirs from Blender (tools/blender_assets.py -> js/assets.js). Sahrun is newer, so this
   file makes the same two things the same way, when the world is built:
     * groundTile()  a 12 m patch of wind-rippled sand that repeats across the ground, as a normal map (the shape
                     of every ripple, for the light) and a shading map (darker in the hollows), like the Blender tile
     * range(look)   a ring of sandstone cliffs and giant dunes 400 m to 1000 m out, with its hollows shaded into
                     vertex colours, like the Blender mountain ranges
   Nothing is downloaded and nothing is stored. Sahrun is a made-up planet; its sand follows real desert physics:
   wind ripples are asymmetric (a gentle side facing the wind, a steep side behind it), and cliffs of layered
   sandstone erode into steps. */
(function (JA) {
  'use strict';
  var T = window.THREE;
  var D = JA.desert = {};
  if (!T) return;

  var TILE = 12;          // metres, the same as the Blender tiles
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // noise that repeats exactly every `period` cells, so the tile has no seams
  function hash(i, j, seed) { var s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); }
  function pnoise(u, v, period, seed) {
    var x = u * period, y = v * period, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var a = ((xi % period) + period) % period, b = ((yi % period) + period) % period, a1 = (a + 1) % period, b1 = (b + 1) % period;
    var sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    var n00 = hash(a, b, seed), n10 = hash(a1, b, seed), n01 = hash(a, b1, seed), n11 = hash(a1, b1, seed);
    return (n00 + (n10 - n00) * sx) + ((n01 + (n11 - n01) * sx) - (n00 + (n10 - n00) * sx)) * sy;
  }

  // ---------- the sand tile ----------
  var tile = null;
  D.groundTile = function () {
    if (tile) return tile;
    var N = 512, h = new Float32Array(N * N), i, j;
    for (j = 0; j < N; j++) {
      for (i = 0; i < N; i++) {
        var u = i / N, v = j / N;
        // the ripples: about 22 across the tile (a little over half a metre apart), bent by the wind's eddies
        var warp = (pnoise(u, v, 3, 1) - 0.5) * 2.2 + (pnoise(u, v, 7, 2) - 0.5) * 0.7;
        var ph = u * 22 + v * 5 + warp, t = ph - Math.floor(ph);
        var prof = t < 0.7 ? t / 0.7 : (1 - t) / 0.3;                   // gentle up the wind side, steep down the lee side
        prof = prof * prof * (3 - 2 * prof);
        var ripple = 0.014 * prof * (0.55 + 0.45 * pnoise(u, v, 4, 3));  // some ripples fade out, as on real dunes
        // a few broad swells, and grain
        h[j * N + i] = ripple + 0.03 * (pnoise(u, v, 2, 4) - 0.5) + 0.003 * (pnoise(u, v, 64, 5) - 0.5) + 0.0015 * (pnoise(u, v, 160, 6) - 0.5);
      }
    }
    // a scattering of tiny dark grains and pebbles, half buried (far fewer than on Mars: this is a sand sea)
    var rnd = JA.sim && JA.sim.rng32 ? JA.sim.rng32(2611) : Math.random;
    for (var k = 0; k < 70; k++) {
      var cx = rnd() * N, cy = rnd() * N, r = 1.5 + Math.pow(rnd(), 3) * 5, r2 = r * r;
      for (j = Math.floor(cy - r); j <= cy + r; j++) for (i = Math.floor(cx - r); i <= cx + r; i++) {
        var dx = i - cx, dy = j - cy, d2 = dx * dx + dy * dy; if (d2 > r2) continue;
        var ii = ((i % N) + N) % N, jj = ((j % N) + N) % N;
        h[jj * N + ii] += 0.006 * Math.sqrt(1 - d2 / r2) * (r / 3);
      }
    }
    // normal map: the slope of the sand in each pixel (red = across, green = up the image)
    var px = TILE / N, strength = 1, nc = document.createElement('canvas'); nc.width = nc.height = N;
    var nctx = nc.getContext('2d'), nimg = nctx.createImageData(N, N), nd = nimg.data;
    // shading map: the hollows of the ripples get a little less light from the sky (ambient occlusion)
    var S = 256, sc = document.createElement('canvas'); sc.width = sc.height = S;
    var sctx = sc.getContext('2d'), simg = sctx.createImageData(S, S), sd = simg.data;
    function H(a, b) { return h[(((b % N) + N) % N) * N + (((a % N) + N) % N)]; }
    for (j = 0; j < N; j++) {
      for (i = 0; i < N; i++) {
        var gx = (H(i + 1, j) - H(i - 1, j)) / (2 * px), gy = (H(i, j - 1) - H(i, j + 1)) / (2 * px);   // image up = +v
        var nx = -gx * strength, ny = -gy * strength, nz = 1, len = Math.sqrt(nx * nx + ny * ny + 1), o = (j * N + i) * 4;
        nd[o] = (nx / len * 0.5 + 0.5) * 255; nd[o + 1] = (ny / len * 0.5 + 0.5) * 255; nd[o + 2] = (nz / len * 0.5 + 0.5) * 255; nd[o + 3] = 255;
      }
    }
    var step = N / S;
    for (j = 0; j < S; j++) {
      for (i = 0; i < S; i++) {
        var a = i * step, b = j * step, here = H(a, b), around = 0;
        for (var q = -6; q <= 6; q += 3) for (var w = -6; w <= 6; w += 3) around += H(a + q, b + w);
        around /= 25;
        var ao = clamp(0.86 + (here - around) * 18, 0.6, 1), o2 = (j * S + i) * 4, g = Math.round(ao * 255);
        sd[o2] = sd[o2 + 1] = sd[o2 + 2] = g; sd[o2 + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0); sctx.putImageData(simg, 0, 0);
    tile = { normal: nc, shade: sc, tile: TILE };
    return tile;
  };

  // ---------- the ring of cliffs and giant dunes ----------
  // Built in three.js coordinates (y is up). Returns a BufferGeometry with a grey 'color' per vertex (the shading),
  // ready to be tinted by the material colour, exactly like the Blender ranges.
  D.range = function () {
    var NA = 220, NR = 24, pos = [], col = [], idx = [], a, ir;
    function n2(x, z, f, s) { return pnoise(x * f / 4000 + 0.5, z * f / 4000 + 0.5, f, s); }      // smooth noise over the whole ring
    for (var ia = 0; ia < NA; ia++) {
      a = ia / NA * Math.PI * 2;
      // around the ring the land changes between stepped sandstone cliffs and huge smooth dunes
      var cliffy = smooth(0.38, 0.62, pnoise(ia / NA, 0.5, 5, 11));
      for (ir = 0; ir < NR; ir++) {
        var u = ir / (NR - 1), r = 400 + 600 * Math.pow(u, 1.25), x = Math.cos(a) * r, z = Math.sin(a) * r;
        var env = smooth(400, 520, r) * (1 - 0.75 * smooth(660, 1000, r));
        // cliffs: a tableland cut into steps, the way layered sandstone wears away
        var base = 30 + 95 * Math.pow(n2(x, z, 6, 12), 1.4) + 18 * n2(x, z, 23, 13), stepH = 22;
        var stepped = base * 0.35 + (Math.floor(base / stepH) + smooth(0.6, 0.92, (base / stepH) % 1)) * stepH * 0.65;
        // giant dunes: long, smooth swells
        var dune = 20 + 70 * Math.pow(Math.sin(a * 9 + n2(x, z, 4, 14) * 6) * 0.5 + 0.5, 1.6) * (0.5 + 0.5 * n2(x, z, 8, 15));
        var hgt = (stepped * cliffy + dune * (1 - cliffy)) * env, y = 22 + Math.max(0, hgt);
        pos.push(x, y, z);
        // shading: the lower layers and the hollows are darker; the sandstone is banded in layers
        var band = Math.sin(y * 0.21 + 2 * n2(x, z, 9, 16)) * cliffy;
        col.push(clamp(0.62 + 0.3 * smooth(22, 110, y) + 0.08 * band, 0, 1));
      }
    }
    for (ia = 0; ia < NA; ia++) {
      var ib = (ia + 1) % NA;
      for (ir = 0; ir < NR - 1; ir++) {
        var p0 = ia * NR + ir, p1 = ib * NR + ir, p2 = ib * NR + ir + 1, p3 = ia * NR + ir + 1;
        idx.push(p0, p2, p1, p0, p3, p2);
      }
    }
    var g = new T.BufferGeometry(), c3 = new Float32Array(col.length * 3);
    for (var k = 0; k < col.length; k++) { var cv = 0.35 + 0.65 * col[k]; c3[k * 3] = c3[k * 3 + 1] = c3[k * 3 + 2] = cv; }      // the same floor as the Blender ranges
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(c3, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
})(window.JA);
