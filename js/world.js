/* Astro Outpost — the 3D world: ground, sky, light, dust, camera. Built from simple
   shapes in code, so there are no model or texture files to download. */
(function (JA) {
  'use strict';
  var T = window.THREE, Tn = JA.terrain;
  var W = JA.world = { ready: false, T: T };
  if (!T) return;

  var renderer, scene, camera, root = null, look = null, siteId = 'mars';
  var sun, hemi, sunSprite, skyMesh, skyU, stars = null, earth = null, earthGlow = null, phobos = null, lamp = null;
  var time = 0;
  var sunDir = W.sunDir = new T.Vector3(0.4, 0.5, 0.7).normalize();
  var env = W.env = { t: 0.25, dust: 0, dustShown: 0, storm: 0, stormShown: 0, dark: 0 };
  var cam = W.cam = { yaw: 0, pitch: 0.4, dist: 11, mode: 'title', pos: new T.Vector3(0, 24, 60), look: new T.Vector3(0, 3, 0),
    target: new T.Vector3(0, 2, 8), shake: 0, focus: null, fixed: null,
    fp: false, fpPitch: 0.06, eye: null,        // first person: look out of the astronaut's own helmet
    cine: { pos: new T.Vector3(), look: new T.Vector3(), fov: 52, roll: 0 } };
  var v1 = new T.Vector3(), v2 = new T.Vector3(), c1 = new T.Color(), c2 = new T.Color(), c3 = new T.Color();

  var LOOKS = {
    moon: { ground: 0x8b8c96, ground2: 0x5f606b, rock: 0x8a8b95, mountain: 0x4d4e58, range: 0x7d7e88, sunColor: 0xffffff, sunInt: 1.65,
      hemiSky: 0x9fb2d8, hemiGround: 0x34353f, hemiInt: 0.4, fog: null, zenith: 0x000003, horizon: 0x04050a, glow: 0xffffff, sunSize: 330 },
    mars: { ground: 0xc8703f, ground2: 0x9a4a2a, rock: 0x9c5536, mountain: 0x8a4526, range: 0xa5562f, sunColor: 0xfff1df, sunInt: 1.25,
      hemiSky: 0xf5d1a8, hemiGround: 0x7a3b22, hemiInt: 0.66, fog: 0xdcab78, zenith: 0xa8734a, horizon: 0xe6bc8c, glow: 0xfff0d0, sunSize: 210 }
  };

  // ---------- helpers shared with the other 3D files ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  var smooth = Tn.smooth;
  W.mat = function (color, o) { return new T.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.85, metalness: 0.05, flatShading: true }, o || {})); };
  W.soft = function (color, o) { return new T.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.6, metalness: 0.05 }, o || {})); };
  W.glow = function (color, i) { return new T.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: i == null ? 1 : i, roughness: 0.4 }); };
  W.add = function (parent, geo, material, x, y, z, noShadow) {
    var m = new T.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    if (!noShadow) { m.castShadow = true; m.receiveShadow = true; }
    parent.add(m);
    return m;
  };
  W.canvasTex = function (size, draw) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
    return t;
  };

  // ---------- surface detail made in Blender (js/assets.js). Everything falls back to plain shapes without it. ----------
  var AS = window.JA_ASSETS || null;
  function b64(s, Type) {
    var bin = atob(s), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    return new Type(u8.buffer);
  }
  // d: { p: Int16 positions * s, c: baked shade per vertex, i: triangle indices }. lo = how dark the deepest shade may get.
  function assetGeo(d, lo) {
    var p = b64(d.p, Int16Array), pos = new Float32Array(p.length), c8 = b64(d.c, Uint8Array), col = new Float32Array(c8.length * 3), i;
    for (i = 0; i < p.length; i++) pos[i] = p[i] * d.s;
    for (i = 0; i < c8.length; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = lo + (1 - lo) * c8[i] / 255;
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setIndex(new T.BufferAttribute(b64(d.i, d.w === 4 ? Uint32Array : Uint16Array), 1));
    g.computeVertexNormals();
    return g;
  }
  function tileTex(url, repeat, srgb) {
    var t = new T.TextureLoader().load(url);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (srgb) t.encoding = T.sRGBEncoding;
    return t;
  }

  // ---------- ground ----------
  function groundColor(x, z, h, out) {
    var n = clamp(Tn.noise(x * 0.06 + 9, z * 0.06 + 3) * 0.75 + Tn.noise(x * 0.33, z * 0.33) * 0.4, 0, 1);
    out.set(look.ground).lerp(c2.set(look.ground2), n);
    var L = Tn.L, d, i;
    var r = Math.hypot(x, z);
    out.multiplyScalar(1 - (1 - smooth(26, 34, r)) * 0.1);                      // packed-down base area
    var di = Math.hypot(x - L.ice[0], z - L.ice[1]) / Tn.iceR;
    if (siteId === 'moon') {
      for (i = 1; i < Tn.craters.length; i++) {
        var c = Tn.craters[i]; d = Math.hypot(x - c.x, z - c.z) / c.r;
        if (d < 1) out.multiplyScalar(0.82 + 0.18 * d); else if (d < 1.5) out.multiplyScalar(1 + (1.5 - d) * 0.16);
      }
      if (di < 1) {
        out.lerp(c2.set(0x39445c), (1 - di) * 0.9);
        if (di < 0.55) out.lerp(c2.set(0xc4dcf2), clamp(Tn.noise(x * 0.3, z * 0.3) * 1.7 - 0.75, 0, 1) * 0.8);
      }
      d = Math.hypot(x - L.geo[1][0], z - L.geo[1][1]);
      if (d < 11) out.lerp(c2.set(0xd98a3a), (1 - d / 11) * clamp(Tn.noise(x * 0.5, z * 0.5) * 1.6 - 0.2, 0, 1));
    } else {
      d = Math.hypot(x - L.mesa[0], z - L.mesa[1]);
      if (d < 22 && h > Tn.height(L.geo[0][0], L.geo[0][1]) + 1.2) {
        var band = Math.floor(h * 1.15 + Tn.noise(x * 0.1, z * 0.1) * 1.2) % 3;
        out.set(band === 0 ? 0xdba878 : band === 1 ? 0xa3522c : 0xecd0a8);
      }
      if (di < 0.8) out.lerp(c2.set(0xd9eef7), clamp(Tn.noise(x * 0.25, z * 0.25) * 1.8 - 0.6, 0, 1) * (1 - di / 0.8) * 1.2);
      d = Math.hypot(x - L.geo[1][0], z - L.geo[1][1]);
      if (d < 12) out.lerp(c2.set(0xe6c49c), (1 - d / 12) * 0.85);
      var cz = -132 + Math.sin(x * 0.021) * 24, dc = Math.abs(z - cz);
      if (dc < 14) out.multiplyScalar(0.8 + 0.2 * dc / 14);
      var dune = smooth(40, 110, z) * smooth(20, -60, x);
      out.lerp(c2.set(0xdc9258), dune * 0.5);
    }
    return out;
  }

  function buildGround() {
    var size = 800, seg = 250;
    var g = new T.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    var p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (var k = 0; k < p.count; k++) {
      var x = p.getX(k), z = p.getZ(k), h = Tn.height(x, z);
      p.setY(k, h);
      groundColor(x, z, h, c1);
      col[k * 3] = c1.r; col[k * 3 + 1] = c1.g; col[k * 3 + 2] = c1.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    var gm, tile = AS && AS.ground && AS.ground[siteId];
    if (tile) {
      // smooth slopes, plus a tiling patch of real regolith (grain, craterlets, pebbles) baked in Blender
      g.computeVertexNormals();
      gm = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0,
        normalMap: tileTex(tile.n, size / tile.tile, false), normalScale: new T.Vector2(1.5, 1.5), map: tileTex(tile.a, size / tile.tile, true) });
    } else gm = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
    var ground = new T.Mesh(g, gm);
    ground.receiveShadow = true;
    root.add(ground);
    var skirt = W.add(root, new T.RingGeometry(392, 3400, 48, 1), new T.MeshStandardMaterial({ color: look.ground2, roughness: 1 }), 0, 23, 0, true);
    skirt.rotation.x = -Math.PI / 2;

    var rnd = JA.sim.rng32(siteId === 'mars' ? 99 : 11), mm = W.mat(look.mountain), i;
    if (AS && AS.mountains && AS.mountains[siteId]) {
      // mountain ranges sculpted in Blender, with their hollows shaded
      // (a touch of glow stands in for sunlight bouncing off the ground, so shaded slopes are not pitch black)
      var range = new T.Mesh(assetGeo(AS.mountains[siteId], 0.35), new T.MeshStandardMaterial({ color: look.range, vertexColors: true, roughness: 1, metalness: 0,
        flatShading: siteId === 'mars', emissive: look.range, emissiveIntensity: siteId === 'moon' ? 0.16 : 0.05 }));
      root.add(range);
    } else for (i = 0; i < 34; i++) {
      var a = (i / 34) * Math.PI * 2 + rnd() * 0.15, mr = 470 + rnd() * 160, mh = 45 + rnd() * 110;
      var cone = W.add(root, new T.ConeGeometry(mh * (1 + rnd() * 1.1), mh, 5 + Math.floor(rnd() * 4)), mm, Math.cos(a) * mr, 20 + mh * 0.42, Math.sin(a) * mr, true);
      cone.rotation.y = rnd() * 3;
    }
    if (siteId === 'mars') W.add(root, new T.ConeGeometry(640, 190, 24), mm, 300, 100, -1250, true);   // a giant volcano on the horizon

    // pebbles and rocks
    var count = 900, dummy = new T.Object3D(), rockGeos = AS && AS.rocks ? AS.rocks.map(function (d) { return assetGeo(d, 0.42); }) : null;
    var rockMat = W.mat(look.rock, rockGeos ? { vertexColors: true } : null), rockMat2 = W.mat(siteId === 'mars' ? 0x6e3a26 : 0x9a9ba6, rockGeos ? { vertexColors: true } : null);
    var kinds = rockGeos ? 4 : 1, per = count / kinds, insts = [];
    for (i = 0; i < kinds; i++) {
      var im = new T.InstancedMesh(rockGeos ? rockGeos[i * 2] : new T.DodecahedronGeometry(1, 0), rockMat, per);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; root.add(im); insts.push(im);
    }
    for (i = 0; i < count; i++) {
      var ra = rnd() * Math.PI * 2, rd = i < 160 ? 30 + rnd() * 34 : 60 + Math.pow(rnd(), 1.3) * 300;
      var rx = Math.cos(ra) * rd, rz = Math.sin(ra) * rd;
      var cdx = rx - Tn.L.colony[0], cdz = rz - Tn.L.colony[1], cdd = Math.hypot(cdx, cdz);
      if (cdd < 37) { rx = Tn.L.colony[0] + cdx / (cdd || 1) * (37 + (37 - cdd) * 0.5); rz = Tn.L.colony[1] + cdz / (cdd || 1) * (37 + (37 - cdd) * 0.5); }      // the colony site stays clear, out to the city's ring road
      var sc = i < 160 ? 0.08 + rnd() * 0.22 : 0.15 + Math.pow(rnd(), 2.2) * 0.8;
      var r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      if (rockGeos) { dummy.position.set(rx, Tn.height(rx, rz) - sc * 0.12, rz); dummy.rotation.set((r1 - 0.5) * 0.5, r2 * 6.28, (r3 - 0.5) * 0.5); }
      else { dummy.position.set(rx, Tn.height(rx, rz) + sc * 0.2, rz); dummy.rotation.set(r1 * 3, r2 * 3, r3 * 3); }
      dummy.scale.set(sc, sc * (0.5 + r4 * 0.6) * (rockGeos ? 1.3 : 1), sc);
      dummy.updateMatrix(); insts[i % kinds].setMatrixAt(Math.floor(i / kinds), dummy.matrix);
    }
    // boulders (these block your way)
    Tn.boulders.forEach(function (b, k) {
      var m, gy = Tn.height(b.x, b.z);
      if (rockGeos) {
        m = W.add(root, b.seat ? assetGeo(AS.seat, 0.42) : rockGeos[k % rockGeos.length], k % 3 ? rockMat : rockMat2, b.x, gy - b.r * 0.1, b.z);
        if (b.seat) m.scale.set(b.r * 1.2, b.r * 0.88, b.r * 1.2); else m.scale.set(b.r * 1.12, b.r * b.sy * 1.35, b.r * 1.12);
        m.rotation.set(b.seat ? 0 : b.tilt * 0.4, b.rot, 0);
      } else {
        m = W.add(root, new T.DodecahedronGeometry(b.r * 1.08, 0), k % 3 ? rockMat : rockMat2, b.x, gy + b.r * b.sy * 0.45, b.z);
        m.scale.y = b.sy; m.rotation.set(b.tilt, b.rot, b.tilt * 0.5);
      }
      if (b.seat) { m.updateMatrixWorld(true); Tn.seatTop = new T.Box3().setFromObject(m).max.y - gy; Tn.seatRock = m; }   // the landing film measures this rock to sit on its edge
      b.mesh = m;          // kept so that a boulder can be broken up and taken away (js/pioneer.js)
    });
  }

  // ---------- sky ----------
  function buildSky() {
    scene.fog = look.fog ? new T.FogExp2(look.fog, 0.0026) : null;
    skyU = { uZenith: { value: new T.Color(look.zenith) }, uHorizon: { value: new T.Color(look.horizon) },
      uGlow: { value: new T.Color(look.glow) }, uSun: { value: sunDir }, uGlowAmt: { value: 1 } };
    skyMesh = new T.Mesh(new T.SphereGeometry(2600, 32, 16), new T.ShaderMaterial({
      uniforms: skyU, side: T.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSun; uniform float uGlowAmt; varying vec3 vDir;' +
        'void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));' +
        ' float s = max(dot(d, normalize(uSun)), 0.0); c += uGlow * (pow(s, 40.0) * 0.5 + pow(s, 5.0) * 0.14) * uGlowAmt;' +
        ' gl_FragColor = vec4(c, 1.0);\n #include <encodings_fragment>\n }'
    }));
    skyMesh.renderOrder = -10; skyMesh.frustumCulled = false;
    root.add(skyMesh);

    hemi = new T.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiInt);
    root.add(hemi);
    sun = new T.DirectionalLight(look.sunColor, look.sunInt);
    sun.castShadow = true;
    sun.shadow.mapSize.set(W.lite ? 1024 : 2048, W.lite ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 20; sc.far = 700;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
    root.add(sun); root.add(sun.target);

    var tex = W.canvasTex(256, function (ctx, s) {
      var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.1, 'rgba(255,252,235,1)');
      g.addColorStop(0.2, 'rgba(255,230,170,0.45)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    sunSprite = new T.Sprite(new T.SpriteMaterial({ map: tex, blending: T.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    sunSprite.scale.set(look.sunSize, look.sunSize, 1);
    root.add(sunSprite);

    var n = 1800, pos = new Float32Array(n * 3), rnd = JA.sim.rng32(77);
    for (var i = 0; i < n; i++) {
      var u = rnd() * 0.98 + 0.02, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(a) * 2300; pos[i * 3 + 1] = u * 2300; pos[i * 3 + 2] = r * Math.sin(a) * 2300;
    }
    var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
    stars.frustumCulled = false; stars.renderOrder = -9;
    root.add(stars);

    // a scattering of brighter stars, some warm and some cool, so the sky has depth
    var bn = 150, bpos = new Float32Array(bn * 3), bcol = new Float32Array(bn * 3);
    for (i = 0; i < bn; i++) {
      var bu = rnd() * 0.97 + 0.03, ba = rnd() * Math.PI * 2, br = Math.sqrt(1 - bu * bu), tint = rnd();
      bpos[i * 3] = br * Math.cos(ba) * 2290; bpos[i * 3 + 1] = bu * 2290; bpos[i * 3 + 2] = br * Math.sin(ba) * 2290;
      bcol[i * 3] = tint < 0.3 ? 1 : 0.8; bcol[i * 3 + 1] = tint < 0.3 ? 0.86 : 0.9; bcol[i * 3 + 2] = tint < 0.3 ? 0.7 : 1;
    }
    var bg = new T.BufferGeometry(); bg.setAttribute('position', new T.BufferAttribute(bpos, 3)); bg.setAttribute('color', new T.BufferAttribute(bcol, 3));
    var bright = new T.Points(bg, new T.PointsMaterial({ size: 3.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, fog: false, depthWrite: false }));
    bright.frustumCulled = false; bright.renderOrder = -9;
    stars.add(bright); stars.userData.bright = bright;

    earth = null; earthGlow = null; phobos = null;
    if (siteId === 'moon') {
      // Earth: oceans, continents, ice caps and swirls of cloud, painted from noise wrapped around a globe
      var et = W.canvasTex(512, function (ctx, s) {
        var img = ctx.createImageData(s, s), d = img.data, nz = Tn.noise, x, y;
        function fb(px, py, pz, f) {
          var a = px * f + py * 3.1 * f + 11, b = pz * f - py * 2.3 * f + 5;
          return nz(a, b) * 0.5 + nz(a * 2.1, b * 2.1) * 0.27 + nz(a * 4.3, b * 4.3) * 0.15 + nz(a * 8.7, b * 8.7) * 0.08;
        }
        for (y = 0; y < s; y++) {
          var lat = (0.5 - y / s) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
          for (x = 0; x < s; x++) {
            var lon = x / s * Math.PI * 2, px = cl * Math.cos(lon), pz = cl * Math.sin(lon), k = (y * s + x) * 4;
            var land = fb(px, sl, pz, 1.7), dry = fb(px + 4, sl, pz + 2, 2.6), cloud = fb(px + 9, sl * 1.8, pz - 6, 3.4), r, g, b;
            if (land > 0.53) {
              var hgt = Math.min(1, (land - 0.53) * 9);
              r = 46 + dry * 150 + hgt * 20; g = 112 + dry * 40 - hgt * 18; b = 50 + dry * 30;
            } else { var dp = Math.max(0, 0.53 - land) * 4; r = 22 - dp * 10; g = 84 - dp * 34; b = 190 - dp * 60; }
            var ice = Tn.smooth(1.12, 1.3, Math.abs(lat) + (dry - 0.5) * 0.25);
            r += (245 - r) * ice; g += (248 - g) * ice; b += (255 - b) * ice;
            var cw = Tn.smooth(0.52, 0.68, cloud) * 0.92;
            d[k] = r + (255 - r) * cw; d[k + 1] = g + (255 - g) * cw; d[k + 2] = b + (255 - b) * cw; d[k + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      });
      earth = W.add(root, new T.SphereGeometry(95, 48, 32), new T.MeshStandardMaterial({ map: et, roughness: 0.8, emissive: 0x0d2a55, emissiveIntensity: 0.35, fog: false }), 0, 0, 0, true);
      earth.rotation.z = 0.41;
      // the thin blue glow of the air around it
      var halo = W.canvasTex(128, function (ctx, s) {
        var gr = ctx.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
        gr.addColorStop(0, 'rgba(120,180,255,0)'); gr.addColorStop(0.12, 'rgba(120,180,255,0.55)'); gr.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, s, s);
      });
      earthGlow = new T.Sprite(new T.SpriteMaterial({ map: halo, blending: T.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      earthGlow.scale.set(262, 262, 1); earthGlow.renderOrder = -8;
      root.add(earthGlow);
    } else {
      phobos = W.add(root, new T.DodecahedronGeometry(16, 1), new T.MeshStandardMaterial({ color: 0x8d8478, roughness: 1, flatShading: true, fog: false }), 0, 0, 0, true);
      phobos.scale.set(1.3, 1, 1.05);
    }
    // the astronaut's helmet lamp
    lamp = new T.SpotLight(0xdfeeff, 0, 34, 0.62, 0.55, 1.2);
    root.add(lamp); root.add(lamp.target);
  }

  // ---------- particles (dust, sparks, exhaust, storm specks) ----------
  var PN = 2400, pGeo, pPos, pCol, pAlpha, pSize, pMesh, pUni, pNext = 0;
  var pv = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN), pGrav = new Float32Array(PN),
    pS0 = new Float32Array(PN), pS1 = new Float32Array(PN), pA0 = new Float32Array(PN);
  // Particle sizes are in metres. gl_PointSize is in device pixels, so the scale needs the pixel ratio too.
  function pointScale() { return W.h * 0.5 / Math.tan(camera.fov * Math.PI / 360) * (renderer ? renderer.getPixelRatio() : 1); }
  // How many particles to emit this frame for a stream tuned as `perFrame` at 60 frames a second.
  W.rate = function (perFrame, dt) { var n = perFrame * Math.min(dt, 0.05) * 60; return Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); };
  function buildParticles() {
    pGeo = new T.BufferGeometry();
    pPos = new T.BufferAttribute(new Float32Array(PN * 3), 3); pCol = new T.BufferAttribute(new Float32Array(PN * 3), 3);
    pAlpha = new T.BufferAttribute(new Float32Array(PN), 1); pSize = new T.BufferAttribute(new Float32Array(PN), 1);
    pGeo.setAttribute('position', pPos); pGeo.setAttribute('aColor', pCol); pGeo.setAttribute('aAlpha', pAlpha); pGeo.setAttribute('aSize', pSize);
    pUni = { uScale: { value: pointScale() } };
    pMesh = new T.Points(pGeo, new T.ShaderMaterial({
      uniforms: pUni, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'attribute vec3 aColor; attribute float aAlpha; attribute float aSize; varying vec3 vC; varying float vA; uniform float uScale;' +
        'void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard;' +
        ' gl_FragColor = vec4(vC, vA * smoothstep(0.25, 0.04, r));\n #include <encodings_fragment>\n }'
    }));
    pMesh.frustumCulled = false; pMesh.renderOrder = 5;
    for (var i = 0; i < PN; i++) pLife[i] = 0;
    root.add(pMesh);
  }
  // o: { vx, vy, vz, life, size, grow, color (hex), alpha, grav }
  W.emit = function (x, y, z, o) {
    var i = pNext; pNext = (pNext + 1) % PN;
    pPos.setXYZ(i, x, y, z);
    pv[i * 3] = o.vx || 0; pv[i * 3 + 1] = o.vy || 0; pv[i * 3 + 2] = o.vz || 0;
    pLife[i] = pMax[i] = o.life || 1; pGrav[i] = o.grav == null ? 0 : o.grav;
    pS0[i] = o.size || 0.4; pS1[i] = (o.size || 0.4) * (o.grow == null ? 1.6 : o.grow); pA0[i] = o.alpha == null ? 0.8 : o.alpha;
    c3.set(o.color == null ? 0xffffff : o.color);
    pCol.setXYZ(i, c3.r, c3.g, c3.b);
  };
  W.burst = function (x, y, z, n, speed, color, o) {
    o = o || {};
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, e = Math.random() * (o.up == null ? 1 : o.up), s = speed * (0.4 + Math.random() * 0.6);
      W.emit(x, y, z, { vx: Math.cos(a) * s * (1 - e * 0.5), vy: e * s + (o.lift || 0), vz: Math.sin(a) * s * (1 - e * 0.5),
        life: (o.life || 0.9) * (0.6 + Math.random() * 0.6), size: o.size || 0.4, grow: o.grow, color: color, alpha: o.alpha, grav: o.grav == null ? W.gravity * 0.4 : o.grav });
    }
  };
  W.dust = function (x, z, n, speed, size) {
    W.burst(x, Tn.height(x, z) + 0.15, z, n, speed || 1.6, siteId === 'mars' ? 0xd9a070 : 0xb8b9c4, { life: 1.3, size: size || 0.5, grow: 2.6, alpha: 0.45, up: 0.6, grav: W.gravity * 0.12 });
  };
  function updateParticles(dt) {
    var changed = false;
    for (var i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      changed = true;
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pAlpha.array[i] = 0; pSize.array[i] = 0; continue; }
      var k = 1 - pLife[i] / pMax[i], j = i * 3;
      pv[j + 1] -= pGrav[i] * dt;
      pPos.array[j] += pv[j] * dt; pPos.array[j + 1] += pv[j + 1] * dt; pPos.array[j + 2] += pv[j + 2] * dt;
      pAlpha.array[i] = pA0[i] * (1 - k) * Math.min(1, k * 8);
      pSize.array[i] = lerp(pS0[i], pS1[i], k);
    }
    if (changed) { pPos.needsUpdate = true; pAlpha.needsUpdate = true; pSize.needsUpdate = true; pCol.needsUpdate = true; }
  }

  // ---------- bootprints and wheel tracks ----------
  var FN = 500, fMesh, fNext = 0, fDummy = new T.Object3D();
  function buildPrints() {
    var g = new T.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI);     // the toe (the wide end) points the way you face
    // a boot sole pressed into the dust: rounded at toe and heel, with tread bars across it
    var tread = W.canvasTex(64, function (ctx, s) {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(s / 2, s * 0.3, s * 0.4, s * 0.28, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s / 2, s * 0.74, s * 0.33, s * 0.23, 0, 0, 7); ctx.fill();
      ctx.fillRect(s * 0.2, s * 0.3, s * 0.6, s * 0.44);
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255,255,255,1)';
      for (var y = 4; y < s; y += 9) ctx.fillRect(0, y, s, 4.5);
    });
    fMesh = new T.InstancedMesh(g, new T.MeshBasicMaterial({ color: siteId === 'mars' ? 0x5a2a12 : 0x2c2d36, map: tread, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), FN);
    fDummy.position.set(0, -500, 0); fDummy.updateMatrix();
    for (var i = 0; i < FN; i++) fMesh.setMatrixAt(i, fDummy.matrix);
    fMesh.frustumCulled = false;
    root.add(fMesh);
  }
  W.print = function (x, z, yaw, w, l) {
    fDummy.position.set(x, Tn.height(x, z) + 0.04, z);
    fDummy.rotation.set(0, yaw, 0); fDummy.scale.set(w, 1, l); fDummy.updateMatrix();
    fMesh.setMatrixAt(fNext, fDummy.matrix); fNext = (fNext + 1) % FN;
    fMesh.instanceMatrix.needsUpdate = true;
  };

  // ---------- set-up ----------
  W.init = function (canvas) {
    try { renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return false; }
    W.renderer = renderer;
    W.lite = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);      // phones and tablets
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, W.lite ? 1.5 : 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = W.scene = new T.Scene();
    scene.background = new T.Color(0x000000);
    camera = W.camera = new T.PerspectiveCamera(52, 16 / 9, 0.4, 6000);
    W.w = 1280; W.h = 720;
    W.resize();
    window.addEventListener('resize', W.resize);
    W.ready = true;
    return true;
  };
  W.resize = function () {
    if (!renderer) return;
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;                    // hidden or minimised window: keep the last good size
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    W.w = w; W.h = h;
    if (pUni) pUni.uScale.value = pointScale();
  };

  W.build = function (site, suitColor) {
    if (root) {
      scene.remove(root);
      root.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(function (m) {
          if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose();
          m.dispose();
        });
        if (o.isLight && o.shadow && o.shadow.dispose) o.shadow.dispose();
      });
    }
    siteId = W.site = site; look = LOOKS[site]; W.gravity = JA.SITES[site].gravity;
    Tn.setSite(site);
    root = W.root = new T.Group(); scene.add(root);
    buildGround(); buildSky(); buildParticles(); buildPrints();
    if (JA.models.prepare) JA.models.prepare(renderer, look);   // reflections for the Blender models (js/models.js)
    JA.base.build(root, site);
    JA.actors.build(root, site, suitColor);
    ['interior', 'colony', 'pioneer'].forEach(function (k) {         // optional extras: the world still works without them
      var m = JA[k];
      if (m && typeof m.build === 'function') { try { m.build(root, site); } catch (e) { if (window.console) console.warn('Astro Outpost add-on ' + k + '.build failed:', e); } }
    });
    env.dust = env.dustShown = env.storm = env.stormShown = 0;
    W.resize();
  };

  W.project = function (v) {
    v1.copy(v).project(camera);
    return { x: (v1.x * 0.5 + 0.5) * W.w, y: (-v1.y * 0.5 + 0.5) * W.h, hidden: v1.z > 1, dist: camera.position.distanceTo(v) };
  };
  // direction vectors on the ground for "forward" and "right" as seen by the camera
  W.forward = function (out) { return out.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)); };
  W.lookBy = function (dx, dy) {
    cam.yaw -= dx;
    if (cam.fp) cam.fpPitch = clamp(cam.fpPitch + dy * 1.3, -1.45, 1.2);       // positive = looking down; nearly straight up is allowed
    else cam.pitch = clamp(cam.pitch + dy, -0.55, 1.25);                        // below zero the camera crouches and tilts up at the sky
  };
  W.zoomBy = function (d) { cam.dist = clamp(cam.dist * (1 + d), 5.5, 26); };

  // ---------- every frame ----------
  function updateSky(dt) {
    var t = clamp(env.t, 0, 1), az, el;
    if (siteId === 'moon') { az = lerp(1.05, -1.05, t); el = 0.15 + Math.sin(Math.PI * t) * 0.06; }
    else { az = lerp(1.75, -1.75, t); el = 0.13 + Math.sin(Math.PI * t) * 0.9; }
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    var f = cam.target;
    sun.target.position.set(f.x, f.y, f.z);
    sun.position.set(f.x + sunDir.x * 260, f.y + sunDir.y * 260, f.z + sunDir.z * 260);
    sunSprite.position.copy(camera.position).addScaledVector(sunDir, 2400); W.sunSprite = sunSprite;
    skyMesh.position.copy(camera.position); stars.position.copy(camera.position);

    env.dustShown = lerp(env.dustShown, env.dust, Math.min(1, dt * 0.8));
    env.stormShown = lerp(env.stormShown, env.storm, Math.min(1, dt * 3));
    var d = env.dustShown;
    var day = siteId === 'moon' ? 1 : smooth(0, 0.14, t) * (1 - smooth(0.86, 1, t));
    if (siteId === 'mars') {
      skyU.uHorizon.value.set(look.horizon).lerp(c1.set(0x5b6f92), (1 - day) * 0.8).lerp(c1.set(0x7d4a2a), d * 0.8);
      skyU.uZenith.value.set(look.zenith).lerp(c1.set(0x2c3246), (1 - day) * 0.85).lerp(c1.set(0x6a3d22), d * 0.85);
      skyU.uGlow.value.set(look.glow).lerp(c1.set(0x86bcff), 1 - day);
      skyU.uGlowAmt.value = (1 + (1 - day) * 1.6) * (1 - d * 0.8);
      scene.fog.color.copy(skyU.uHorizon.value);
      scene.fog.density = 0.0026 + d * 0.02;
      sun.intensity = look.sunInt * (0.4 + 0.6 * day) * (1 - d * 0.66);
      hemi.intensity = look.hemiInt * (0.62 + 0.38 * day) * (1 - d * 0.3);
      sun.color.set(look.sunColor).lerp(c1.set(0xa5c8ff), (1 - day) * 0.6);
      sunSprite.material.color.set(0xffffff).lerp(c1.set(0x9fc8ff), (1 - day) * 0.8);
      sunSprite.material.opacity = 1 - d * 0.8;
      stars.material.opacity = (1 - day) * 0.7 * (1 - d);
      stars.userData.bright.material.opacity = stars.material.opacity;
      var pt = (time * 0.006 + 0.2) % 1, pa = lerp(-1.9, 1.9, pt), pe = 0.25 + Math.sin(Math.PI * pt) * 0.7;
      phobos.position.copy(camera.position).add(v1.set(Math.sin(pa) * Math.cos(pe), Math.sin(pe), -Math.cos(pa) * Math.cos(pe) * 0.6 - 0.3).normalize().multiplyScalar(2300));
      phobos.rotation.y += dt * 0.05;
      env.dark = clamp((1 - day) * 0.8 + d * 0.5, 0, 1);
    } else {
      sun.intensity = look.sunInt * (1 - d * 0.86);
      hemi.intensity = look.hemiInt * (1 - d * 0.3);
      sunSprite.material.opacity = 1 - d;
      earth.position.copy(camera.position).add(v1.set(-0.5, 0.2, -0.84).normalize().multiplyScalar(2350));
      earth.rotation.y += dt * 0.008;
      if (earthGlow) earthGlow.position.copy(earth.position);
      var inIce = 1 - smooth(0.55, 1.0, Math.hypot(f.x - Tn.L.ice[0], f.z - Tn.L.ice[1]) / Tn.iceR);
      env.dark = clamp(d * 0.9 + inIce * 0.8 + 0.25, 0, 1);
    }
    lamp.intensity = lerp(lamp.intensity, cam.mode === 'play' ? env.dark * 2.4 : 0, Math.min(1, dt * 3));
  }

  function ambientParticles(dt) {
    var f = cam.target, i, n;
    if (env.stormShown > 0.03) {
      n = W.rate(env.stormShown * 26, dt);
      for (i = 0; i < n; i++) {
        W.emit(f.x + (Math.random() - 0.5) * 70 + sunDir.x * 20, f.y + Math.random() * 26 + 6, f.z + (Math.random() - 0.5) * 70 + sunDir.z * 20,
          { vx: -sunDir.x * 46, vy: -sunDir.y * 46 - 10, vz: -sunDir.z * 46, life: 0.9, size: 0.34, grow: 0.6, color: 0xff48c8, alpha: 0.9 });
      }
    }
    if (siteId === 'mars' && env.dustShown > 0.03) {
      n = W.rate(env.dustShown * 12, dt);
      for (i = 0; i < n; i++) {
        W.emit(f.x - 40 + Math.random() * 30, f.y + Math.random() * 14 - 1, f.z + (Math.random() - 0.5) * 80,
          { vx: 16 + Math.random() * 14, vy: (Math.random() - 0.5) * 2, vz: 3, life: 3, size: 0.9, grow: 2.4, color: 0xe2b98c, alpha: 0.28 });
      }
    }
  }

  function updateCamera(dt) {
    var want = v1, lookAt = v2, sp;
    if (cam.mode === 'title') {
      var a = time * 0.05 + 0.5, rad = camera.aspect < 1 ? 92 : 64;
      want.set(Math.sin(a) * rad, 15 + Math.sin(time * 0.11) * 4, Math.cos(a) * rad);
      lookAt.set(-6, 5, 4); sp = Math.min(1, dt * 1.5);
    } else if (cam.mode === 'inside') {
      var b = time * 0.09;
      want.set(Math.sin(b) * 30, 13, Math.cos(b) * 30 + 2);
      lookAt.set(0, 3.5, 0); sp = Math.min(1, dt * 1.6);
    } else if (cam.mode === 'fixed' && cam.fixed) {
      want.copy(cam.fixed.pos); lookAt.copy(cam.fixed.look); sp = Math.min(1, dt * 2.2);
    } else if (cam.mode === 'cine' && cam.cine) {
      // the landing film drives the camera directly (no smoothing: the film does its own)
      want.copy(cam.cine.pos); lookAt.copy(cam.cine.look); sp = 1;
      cam.target.set(want.x, Tn.height(want.x, want.z) + 2, want.z);
    } else if (cam.fp && cam.eye) {
      // first person: the camera IS the astronaut's eyes (cam.yaw is the way you face)
      cam.eye(cam.target);
      want.copy(cam.target);
      var cq = Math.cos(cam.fpPitch);
      lookAt.set(want.x - Math.sin(cam.yaw) * cq * 20, want.y - Math.sin(cam.fpPitch) * 20, want.z - Math.cos(cam.yaw) * cq * 20);
      sp = 1;
    } else {
      if (cam.focus) cam.focus(cam.target);
      var pitch = cam.pitch, up = 0;
      if (pitch < 0.06) { up = 0.06 - pitch; pitch = 0.06 - up * 0.35; }
      var cp = Math.cos(pitch), dist = cam.dist * (camera.aspect < 1 ? 1.25 : 1);
      want.set(cam.target.x + Math.sin(cam.yaw) * cp * dist, cam.target.y + Math.sin(pitch) * dist, cam.target.z + Math.cos(cam.yaw) * cp * dist);
      lookAt.copy(cam.target); lookAt.y += up * Math.max(dist, 4) * 1.8; sp = Math.min(1, dt * 12);
      if (cam.room) keepInRoom(want, cam.target, cam.room);
    }
    var floor = Tn.height(want.x, want.z) + 0.7;
    if (want.y < floor) want.y = floor;
    cam.pos.lerp(want, sp); cam.look.lerp(lookAt, Math.min(1, sp * 1.4));
    if (isNaN(cam.pos.x + cam.pos.y + cam.pos.z)) cam.pos.copy(want);
    if (isNaN(cam.look.x + cam.look.y + cam.look.z)) cam.look.copy(lookAt);
    camera.position.copy(cam.pos);
    if (cam.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; camera.position.z += (Math.random() - 0.5) * cam.shake;
      cam.shake *= Math.max(0, 1 - dt * 4);
    }
    camera.lookAt(cam.look);
    var cine = cam.mode === 'cine' && cam.cine, fov = cine ? cam.cine.fov || 52 : (cam.mode === 'play' && cam.fp && cam.eye ? 66 : 52);
    if (cine && cam.cine.roll) camera.rotateZ(cam.cine.roll);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    var near = cam.room ? (cam.fp ? 0.25 : 0.06) : 0.4;    // in a small room close things must not be cut off (helmet view still hides your own shoulders)
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  }
  // Inside a room the camera must not go through the walls: slide it toward the astronaut until it fits.
  function keepInRoom(want, from, R) {
    var dx = want.x - from.x, dy = want.y - from.y, dz = want.z - from.z, t = 1;
    var ox = from.x - R.cx, oz = from.z - R.cz, oy = R.type === 'dome' ? from.y - R.cy : 0;
    var a = dx * dx + dz * dz + (R.type === 'dome' ? dy * dy : 0), b = 2 * (ox * dx + oz * dz + (R.type === 'dome' ? oy * dy : 0));
    var c = ox * ox + oz * oz + oy * oy - R.r * R.r, disc = b * b - 4 * a * c;
    if (a > 1e-6 && disc >= 0) { var hit = (-b + Math.sqrt(disc)) / (2 * a); if (hit < 1) t = Math.max(0, hit * 0.94); }
    want.set(from.x + dx * t, from.y + dy * t, from.z + dz * t);
    if (want.y < R.floor) want.y = R.floor;
    if (R.top != null && want.y > R.top) want.y = R.top;
  }
  W.snapCamera = function () { updateCamera(100); };
  W.setLamp = function (x, y, z, dx, dz) { if (!lamp) return; lamp.position.set(x, y, z); lamp.target.position.set(x + dx * 8, y - 2.4, z + dz * 8); };

  W.update = function (dt) {
    if (!W.ready || !root) return;
    if (window.innerWidth !== W.w || window.innerHeight !== W.h) W.resize();
    time += dt; W.time = time;
    updateCamera(dt);
    if (pUni) pUni.uScale.value = pointScale();      // the film changes the lens, so keep particles the right size
    updateSky(dt);
    ambientParticles(dt);
    updateParticles(dt);
    if (!(window.innerWidth && window.innerHeight)) return;
    // the picture goes through the camera (js/fx.js) when it is on and working; otherwise it is drawn plainly
    if (!(JA.fx && JA.fx.render && JA.fx.render(renderer, scene, camera, dt))) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  };
})(window.JA);
