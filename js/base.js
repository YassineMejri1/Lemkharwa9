/* Astro Outpost — the outpost itself: every building, machine, the rocket, the science sites.
   B.spots lists the exact places the astronaut can use (sockets, hoppers, beds, drill spots...).
   B.update() makes each machine SHOW what the mission rules say is happening inside it. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain, R = JA.RULES, MD = JA.models;
  var B = JA.base = { colliders: [], floors: [], spots: null, pos: {} };
  if (!T) return;
  // a copy of a model made in Blender (js/models.js), or null so the plain shapes below are drawn instead
  function model(name) { return MD && MD.has(name) ? MD.make(name) : null; }
  var add, mat, soft, glow, root, site, L, P = {};
  var UP = new T.Vector3(0, 1, 0), q = new T.Quaternion(), qy = new T.Quaternion();

  function group(p) { var g = new T.Group(); g.position.set(p[0], Tn.height(p[0], p[1]), p[1]); root.add(g); return g; }
  function wp(g, x, y, z) { return new T.Vector3(g.position.x + x, g.position.y + y, g.position.z + z); }
  // A collider is a circle on the ground that blocks walking, driving and thrown things. h: how tall it is
  // (3.4 m when left out); dome: the radius of a round roof (the habitat).
  function collide(g, x, z, r, h) {
    var c = { x: g.position.x + x, z: g.position.z + z, r: r };
    if (h) c.h = h;
    B.colliders.push(c);
    return c;
  }
  // A raised floor you can walk on (actors.js stands the astronaut, the rover and dropped things on top of it).
  // A disc: flat 'top' metres high out to r0, then a bevel down to 'edge' at r1. A box: half sizes hw, hd, flat top.
  function floorDisc(g, top, r0, r1, edge) { B.floors.push({ x: g.position.x, z: g.position.z, y: g.position.y, top: top, r0: r0, r1: r1, edge: edge }); }
  function floorBox(g, top, hw, hd) { B.floors.push({ x: g.position.x, z: g.position.z, y: g.position.y, top: top, hw: hw, hd: hd }); }
  function cyl(rt, rb, h, seg) { return new T.CylinderGeometry(rt, rb, h, seg || 14); }
  function box(w, h, d) { return new T.BoxGeometry(w, h, d); }
  function ball(r, a, b) { return new T.SphereGeometry(r, a || 12, b || 10); }

  // A power socket: a cup on a post. A plugged-in cell glows inside it; green pips show charge left.
  function socket(g, id, x, z) {
    var s = new T.Group(), sm = model('socket'); s.position.set(x, 0, z); g.add(s);
    if (sm) s.add(sm);                                   // Blender socket: bolted post, light box and contact cup
    else {
      add(s, cyl(0.28, 0.4, 1.0, 10), soft(0x8a8fa0), 0, 0.5, 0);
      add(s, cyl(0.62, 0.5, 0.5, 16), soft(0x2b3147), 0, 1.2, 0);
    }
    var ring = add(s, new T.TorusGeometry(0.62, 0.09, 8, 24), glow(0xffd23f, 1.4), 0, 1.46, 0, true); ring.rotation.x = Math.PI / 2;
    var cell = add(s, cyl(0.33, 0.33, 0.9, 12), glow(0xffe36a, 1.8), 0, 1.65, 0, true); cell.visible = false;
    var pips = [];
    for (var i = 0; i < 3; i++) pips.push(add(s, ball(0.1, 8, 8), glow(0x46ff8a, 0.1), -0.26 + i * 0.26, 0.85, 0.36, true));
    B.spots.sockets[id] = wp(g, x, 1.6, z);
    P[id] = P[id] || {}; P[id].sock = { ring: ring, cell: cell, pips: pips };
    collide(g, x, z, 0.45);
  }
  function setSocket(id, level, on) {
    var k = P[id].sock;
    k.cell.visible = on;
    k.ring.material.color.set(on ? 0x46ff8a : 0xffd23f); k.ring.material.emissive.set(on ? 0x46ff8a : 0xffd23f);
    k.ring.material.emissiveIntensity = on ? 1.6 : 0.8 + Math.sin(W.time * 4) * 0.6;
    for (var i = 0; i < 3; i++) k.pips[i].material.emissiveIntensity = i < level ? 2.2 : 0.06;
  }
  // A hopper: an open funnel you drop or throw things into.
  function hopper(g, id, x, y, z, r, color) {
    var hm = model('hopper');
    if (hm) { hm.position.set(x, y, z); hm.scale.set(r, 1, r); g.add(hm); }
    else add(g, new T.CylinderGeometry(r, r * 0.45, 1.0, 16, 1, true), new T.MeshStandardMaterial({ color: 0xc9ccd6, roughness: 0.5, metalness: 0.4, side: T.DoubleSide }), x, y, z);
    var rim = add(g, new T.TorusGeometry(r, 0.09, 8, 26), glow(color, 1.2), x, y + 0.5, z, true); rim.rotation.x = Math.PI / 2;
    B.spots.hoppers[id] = wp(g, x, y + 0.5, z);
    return rim;
  }
  function cable(a, b, id) {
    var dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    var m = new T.MeshStandardMaterial({ color: 0x3f4458, emissive: 0xffd23f, emissiveIntensity: 0, roughness: 0.6 });
    var c = add(root, box(len, 0.1, 0.16), m, a.x + dx / 2, 0.06, a.z + dz / 2, true);
    c.rotation.y = -Math.atan2(dz, dx);
    P.cables[id] = m;
  }

  // ---------- habitat ----------
  function hab() {
    var g = group(L.hab), white = soft(0xf2f3f7), blue = soft(0x3d7dff), i, doorLight, beacon, flag, habWins = [];
    var mdl = model('habitat'), fm = model('flag'), scope = model('telescope');
    if (mdl) {
      // the habitat made in Blender: dome, airlock, windows, beacon, and the pantry chute with its funnel
      g.add(mdl);
      doorLight = mdl.getObjectByName('hab_doorLight'); beacon = mdl.getObjectByName('hab_beacon');
      B.spots.hoppers.pantry = wp(g, 5.9, 2.9, 1.2);
      var hull = mdl.getObjectByName('hab_main'); if (hull) habWins.push(hull);   // the outer hull and windows: hidden while you are inside, so the room and the view show
    } else {
      add(g, cyl(5.4, 5.8, 1.3, 30), soft(0xd7dae3), 0, 0.65, 0);
      add(g, new T.SphereGeometry(5.3, 34, 16, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 1.3, 0);
      add(g, new T.TorusGeometry(5.36, 0.18, 8, 40), blue, 0, 1.36, 0).rotation.x = Math.PI / 2;
      var winM = glow(0xffe59a, 1.3);
      [-1.25, -0.55, 0.55, 2.4, 3.6].forEach(function (a) {
        var w = add(g, ball(0.62, 14, 12), winM, Math.sin(a) * 4.55, 3.9, Math.cos(a) * 4.55, true); habWins.push(w); w.userData.a = a;
        w.scale.set(1, 1, 0.4); w.lookAt(g.position.x + Math.sin(a) * 12, 7, g.position.z + Math.cos(a) * 12);
      });
      add(g, box(3.0, 2.9, 4.2), soft(0xc3c7d2), 0, 1.45, 6.7);
      add(g, box(3.4, 0.28, 4.5), blue, 0, 3.0, 6.7);
      add(g, box(1.6, 2.2, 0.14), soft(0x2b3147), 0, 1.15, 8.83);
      doorLight = add(g, box(2.0, 0.24, 0.16), glow(0x4dff9a, 2), 0, 2.55, 8.83, true);
      add(g, cyl(0.06, 0.06, 2.6, 6), white, 0, 7.8, 0);
      beacon = add(g, ball(0.2, 10, 10), glow(0xff5a5a, 2), 0, 9.2, 0, true);
      // food hatch on the east side
      add(g, box(1.7, 1.5, 1.5), soft(0xc3c7d2), 5.7, 1.2, 1.2);
      add(g, box(1.2, 0.5, 0.1), glow(0x7be36a, 0.9), 5.7, 1.3, 1.98, true);
      hopper(g, 'pantry', 5.9, 2.4, 1.2, 1.0, 0x7be36a);
    }
    // flag (the cloth swings on Mars)
    if (fm) { fm.position.set(4.6, 0, 9.5); g.add(fm); flag = fm.getObjectByName('flag_cloth'); }
    else {
      add(g, cyl(0.06, 0.06, 4.4, 6), white, 4.6, 2.2, 9.5);
      flag = add(g, box(1.6, 1.0, 0.05), new T.MeshStandardMaterial({ color: 0xff5f6d, roughness: 0.7 }), 5.45, 3.85, 9.5);
    }
    // a little telescope beside the airlock (only with the Blender models)
    if (scope && mdl) { scope.position.set(-4.8, 0, 9.2); scope.rotation.y = -0.6; g.add(scope); collide(g, -4.8, 9.2, 0.6); }
    // sixteen soil bags that pile up around the dome
    var bags = [], bm = mat(JA.siteOf(site).colors.soil), bm2 = mat(JA.siteOf(site).colors.soil2);
    var rows = [[0.8, 6.05, [135, 165, 195, 225, 255, 285, 315]], [1.95, 5.75, [120, 160, 200, 240, 280, 320]], [3.1, 5.2, [35, 150, 265]]];
    rows.forEach(function (row) {
      row[2].forEach(function (deg) {
        var a = deg * Math.PI / 180;
        var b = add(g, new T.SphereGeometry(1, 7, 5), bags.length % 2 ? bm : bm2, Math.sin(a) * row[1], row[0], Math.cos(a) * row[1]);
        b.rotation.y = a + Math.PI / 2 + (bags.length % 3 - 1) * 0.12; b.userData.s = 0; b.visible = false;
        bags.push(b);
      });
    });
    P.hab = { bags: bags, doorLight: doorLight, beacon: beacon, flag: flag, group: g, windows: habWins };
    // the Air Scrubber on the airlock wall: three filter canisters that fill with the crew's CO2, and a socket to bake them clean
    var sg = new T.Group(); sg.position.set(2.15, 0, 7.5); g.add(sg);
    add(sg, box(1.1, 1.9, 1.5), soft(0xc3c7d2), 0, 0.95, 0);
    add(sg, box(1.16, 0.16, 1.56), soft(0x3db8a0), 0, 1.95, 0);
    var cans = [], canM;
    for (i = 0; i < 3; i++) {
      canM = new T.MeshStandardMaterial({ color: 0x8fe8d0, emissive: 0x3db8a0, emissiveIntensity: 0.8, roughness: 0.5 });
      add(sg, cyl(0.2, 0.2, 1.2, 12), canM, 0.6, 1.0, -0.48 + i * 0.48, true);
      cans.push(canM);
    }
    var vent = add(sg, cyl(0.16, 0.16, 0.9, 10), soft(0x8a8fa0), 0.1, 2.4, -0.3);
    P.scrub = { cans: cans, vent: vent };
    socket(g, 'scrub', 3.5, 9.0);
    B.pos.scrub = wp(g, 2.6, 4.2, 8.2);
    collide(g, 2.25, 7.5, 0.85);
    B.spots.door = wp(g, 0, 0, 10.2);
    B.spots.hoppers.dome = wp(g, 0, 2.4, 0);
    B.pos.hab = wp(g, 0, 9.8, 0);
    collide(g, 0, 0, 6.5).dome = 5.4; collide(g, 0, 7.2, 1.9, 3.2);
    // path lights
    var lm = glow(0xfff0b0, 1.6), pm = mat(0x8a8fa0);
    [[-3.2, 11.5], [3.2, 11.5], [-3.2, 16], [3.2, 16], [-9, 6], [10, 5]].forEach(function (p) {
      var lt = model('path_lantern');
      if (lt) { lt.position.set(p[0], Tn.height(p[0], p[1]), p[1]); root.add(lt); return; }
      add(root, cyl(0.05, 0.05, 0.9, 5), pm, p[0], 0.45, p[1]);
      add(root, ball(0.14, 8, 8), lm, p[0], 0.95, p[1], true);
    });
  }

  // ---------- solar field + charging rack ----------
  function solar() {
    var g = group(L.solar), frame = soft(0xdfe2ea);
    var tex = W.canvasTex(128, function (ctx, s) {
      ctx.fillStyle = '#14306b'; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#6fa3ff'; ctx.lineWidth = 2;
      for (var i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * s / 4, 0); ctx.lineTo(i * s / 4, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s / 4); ctx.lineTo(s, i * s / 4); ctx.stroke(); }
    });
    P.solar = { pivots: [], mats: [], yaw: [0, 0, 0] };
    [[-8, 1.5], [0, -2.5], [8, 1.5]].forEach(function (p) {
      var sp = model('solar_panel'), pv, m;
      if (sp) {
        // Blender panel: the tilting part pivots at y = 3.8, its glass is tinted by dust like the plain one
        sp.position.set(p[0], 0, p[1]); g.add(sp);
        pv = sp.getObjectByName('solar_panel'); m = MD.mat(pv, 'SolarGlass');
      } else {
        add(g, cyl(0.2, 0.3, 3.6, 8), frame, p[0], 1.8, p[1]);
        pv = new T.Group(); pv.position.set(p[0], 3.8, p[1]); g.add(pv);
        add(pv, box(5.8, 0.14, 3.6), frame, 0, 0, 0);
        m = new T.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.5, emissive: 0x1b3f96, emissiveIntensity: 0.25 });
        add(pv, box(5.6, 0.08, 3.4), m, 0, 0.1, 0);
      }
      P.solar.pivots.push(pv); P.solar.mats.push(m);
      B.spots.panels.push(wp(g, p[0], 0, p[1] + 1.4));
      collide(g, p[0], p[1], 0.6);
    });
    B.pos.solar = wp(g, 0, 6.4, 0);

    var r = group(L.rack), rm = model('charge_rack');
    if (rm) r.add(rm);         // Blender rack: louvred cabinet, four charging cradles, breaker box, bus bar, yellow canopy
    else {
      add(r, box(5.2, 0.5, 1.7), soft(0x2f3550), 0, 0.25, 0);
      add(r, box(5.2, 2.3, 0.3), soft(0x3a4058), 0, 1.4, -0.7);
      add(r, box(5.5, 0.16, 2.1), soft(0xffd23f), 0, 2.62, -0.1);
    }
    for (var i = 0; i < R.rackMax; i++) {
      if (!rm) add(r, cyl(0.42, 0.42, 0.25, 12), soft(0x8a8fa0), -1.65 + i * 1.1, 0.6, 0.15);
      B.spots.rackSlots.push(wp(r, -1.65 + i * 1.1, 1.18, 0.15));
    }
    // a glass tube that fills as the next cell charges
    add(r, cyl(0.2, 0.2, 1.9, 10), new T.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false }), 2.95, 1.45, 0.2, true);
    var lg = cyl(0.15, 0.15, 1.8, 10); lg.translate(0, 0.9, 0);
    P.rack = { level: add(r, lg, glow(0xffd23f, 1.6), 2.95, 0.55, 0.2, true), lamp: add(r, box(1.2, 0.2, 0.1), glow(0x46ff8a, 1.2), 0, 2.3, -0.5, true) };
    B.pos.rack = wp(r, 0, 3.6, 0);
    B.spots.rack = wp(r, 0, 1, 1.2);
    collide(r, -1.4, -0.35, 1.45); collide(r, 1.4, -0.35, 1.45);
    cable(wp(g, 0, 0, 0), wp(r, 0, 0, 0), 'trunk');
  }

  // ---------- air maker ----------
  function airMaker() {
    var g = group(L.air), mdl = model('air_maker'), fan;
    // Blender air maker: gold-foil box in a steel frame on a skid, fan grille, valve, caged tank (the fan spins)
    if (mdl) { g.add(mdl); fan = mdl.getObjectByName('air_fan'); }
    else {
      add(g, box(3.4, 0.3, 3.4), soft(0x3a4058), 0, 0.15, 0);
      add(g, box(3.0, 2.6, 3.0), new T.MeshStandardMaterial({ color: 0xe9b93c, metalness: 0.75, roughness: 0.3 }), 0, 1.6, 0);
    }
    var rim = hopper(g, 'air', 0, 3.4, 0, 1.25, 0x4fd8ff);
    var ice = [];
    for (var i = 0; i < R.hopperMax; i++) {
      var c = add(g, JA.iceWell(site) ? new T.CylinderGeometry(0.2, 0.2, 0.46, 10) : new T.OctahedronGeometry(0.34, 0), JA.iceWell(site) ? new T.MeshStandardMaterial({ color: 0x8fa6c4, emissive: 0x2a6aa0, emissiveIntensity: 0.6 }) : new T.MeshStandardMaterial({ color: 0xdff7ff, emissive: 0x8fe6ff, emissiveIntensity: 0.8, flatShading: true }), Math.cos(i * 1.7) * 0.45, 3.5 + (i % 2) * 0.2, Math.sin(i * 1.7) * 0.45, true);
      c.visible = false; ice.push(c);
    }
    // the oxygen tank: the glowing column inside IS the crew's air supply
    if (!mdl) add(g, cyl(1.25, 1.25, 0.4, 20), soft(0x3a4058), 3.1, 0.2, 0);
    add(g, cyl(1.15, 1.15, 5.0, 20), new T.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, roughness: 0.08, depthWrite: false }), 3.1, 2.9, 0, true);
    var lg = cyl(0.95, 0.95, 4.8, 20); lg.translate(0, 2.4, 0);
    var level = add(g, lg, new T.MeshStandardMaterial({ color: 0x7fe6ff, emissive: 0x4fd8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }), 3.1, 0.45, 0, true);
    if (!fan) {
      add(g, cyl(1.25, 1.25, 0.3, 20), soft(0xf2f3f7), 3.1, 5.5, 0);
      add(g, cyl(0.16, 0.16, 1.6, 8), soft(0xdfe2ea), 1.75, 2.2, 0).rotation.z = Math.PI / 2;
      fan = new T.Group(); fan.position.set(-0.9, 2.2, 1.56); g.add(fan);
      add(fan, box(1.3, 0.24, 0.06), mat(0xdfe2ea), 0, 0, 0); add(fan, box(0.24, 1.3, 0.06), mat(0xdfe2ea), 0, 0, 0);
    }
    var lamp = add(g, box(1.2, 0.3, 0.1), glow(0x4fd8ff, 0.2), 0.75, 2.2, 1.52, true);
    socket(g, 'air', -1.1, 2.7);
    P.air = Object.assign(P.air || {}, { ice: ice, level: level, fan: fan, lamp: lamp, rim: rim });
    B.pos.air = wp(g, 0.8, 6.6, 0);
    B.repair = B.repair || {}; B.repair.air = wp(g, 0, 1.4, 2.4);
    collide(g, 0, 0, 2.3); collide(g, 3.1, 0, 1.45);
  }

  // ---------- greenhouse ----------
  function greenhouse() {
    var g = group(L.food), i, mdl = model('greenhouse');
    // Blender greenhouse: paved floor, aluminium ribs over glass, framed ends with a door, hydroponic trays, tank cage
    if (mdl) g.add(mdl);
    else {
      add(g, box(10.5, 0.3, 4.6), soft(0xdfe2ea), 0, 0.15, -0.6);
      var glass = new T.Mesh(new T.CylinderGeometry(3.3, 3.3, 10.2, 22, 1, true, Math.PI / 2 - 0.25, Math.PI / 2 + 0.25),
        new T.MeshStandardMaterial({ color: 0xc8f0ff, transparent: true, opacity: 0.24, roughness: 0.08, side: T.DoubleSide, depthWrite: false }));
      glass.rotation.z = Math.PI / 2; glass.position.set(0, 0.3, 0.9); g.add(glass);
      var rib = soft(0xf2f3f7);
      for (i = 0; i < 5; i++) {
        var r = add(g, new T.TorusGeometry(3.3, 0.09, 6, 16, Math.PI / 2 + 0.25), rib, -5.1 + i * 2.55, 0.3, 0.9);
        r.rotation.set(0, Math.PI / 2, 0);
      }
    }
    var lampM = add(g, box(10.2, 0.14, 0.3), glow(0xff5fd0, 0.2), 0, 3.3, -0.3, true).material;
    var light = new T.PointLight(0xff5fd0, 0, 13, 2); light.position.set(0, 2.6, 0.2); g.add(light);
    var beds = [], leafA = mat(0x4fd15a), leafB = mat(0x2fa64a), fruitM = glow(0xff4a3a, 0.5), soil = mat(0x4a3324);
    var bushA = mat(0x2f8a4a), bushB = mat(0x246e3c), flowerM = glow(0xe9d9ff, 0.6), spudM = mat(0xb98a4f);
    for (i = 0; i < R.beds; i++) {
      var bx = -3.6 + i * 2.4;
      if (!mdl) { add(g, box(2.0, 0.7, 1.7), soft(0xdfe2ea), bx, 0.65, 0.2); add(g, box(1.8, 0.12, 1.5), soil, bx, 1.02, 0.2); }
      var pg = new T.Group(); pg.position.set(bx, 1.08, 0.2); g.add(pg);
      var fruits = [];
      for (var k = 0; k < 5; k++) {
        var px = (k % 3 - 1) * 0.55, pz = (k < 3 ? -0.35 : 0.35);
        add(pg, new T.ConeGeometry(0.3, 0.9, 6), k % 2 ? leafA : leafB, px, 0.45, pz);
        add(pg, ball(0.24, 6, 5), k % 2 ? leafB : leafA, px + 0.12, 0.25, pz + 0.1);
        var f = add(pg, ball(0.13, 8, 8), fruitM, px - 0.14, 0.62, pz + 0.16, true); f.visible = false; fruits.push(f);
      }
      pg.scale.setScalar(0.001); pg.visible = false;
      var pg2 = new T.Group(), spuds = []; pg2.position.set(bx, 1.08, 0.2); g.add(pg2);
      for (k = 0; k < 5; k++) {
        var qx = (k % 3 - 1) * 0.55, qz = (k < 3 ? -0.35 : 0.35);
        add(pg2, ball(0.34, 7, 6), k % 2 ? bushA : bushB, qx, 0.26, qz).scale.y = 0.8;
        add(pg2, ball(0.07, 6, 5), flowerM, qx + 0.1, 0.58, qz + 0.05, true);
        var sp = add(pg2, ball(0.15, 7, 6), spudM, qx - 0.2, 0.06, qz + 0.22, true); sp.scale.set(1.25, 0.8, 0.9); sp.visible = false; spuds.push(sp);
      }
      pg2.scale.setScalar(0.001); pg2.visible = false;
      var mark = add(g, new T.TorusGeometry(0.5, 0.06, 6, 18), glow(0x7be36a, 1.5), bx, 2.5, 0.2, true); mark.visible = false;
      beds.push({ plants: pg, fruits: fruits, potato: pg2, spuds: spuds, mark: mark, s: 0 });
      B.spots.beds.push(wp(g, bx, 1.1, 1.9));
      collide(g, bx, 0.1, 1.15);
    }
    // water tank
    add(g, cyl(1.0, 1.0, 2.6, 16), new T.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.25, roughness: 0.1, depthWrite: false }), -6.6, 1.5, 0.2, true);
    var wg = cyl(0.85, 0.85, 2.4, 16); wg.translate(0, 1.2, 0);
    var water = add(g, wg, new T.MeshStandardMaterial({ color: 0x3aa0ff, emissive: 0x1b6fd0, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }), -6.6, 0.3, 0.2, true);
    hopper(g, 'water', -6.6, 3.3, 0.2, 1.0, 0x3aa0ff);
    collide(g, -6.6, 0.2, 1.2);
    socket(g, 'food', 6.3, 1.0);
    P.food = Object.assign(P.food || {}, { beds: beds, lampM: lampM, light: light, water: water });
    B.pos.food = wp(g, 0, 5.4, 0);
    B.repair.food = wp(g, -4.9, 1.2, 1.9);
  }

  // ---------- soil bagger ----------
  function bagger() {
    var g = group(L.bag), dirt = mat(JA.siteOf(site).colors.soil);
    add(g, new T.ConeGeometry(3.2, 2.6, 9), dirt, 0.4, 1.3, -3.6);
    add(g, box(2.8, 2.2, 2.4), soft(0xffc533), 0, 1.4, -0.4);
    add(g, box(3.2, 0.3, 2.8), soft(0x3a4058), 0, 0.15, -0.4);
    var belt = add(g, box(1.2, 0.2, 3.6), soft(0x2b3147), 0.4, 2.3, -2.2); belt.rotation.x = -0.45;
    var gear = add(g, cyl(0.5, 0.5, 0.3, 8), mat(0x8a8fa0), -1.5, 1.6, -0.4); gear.rotation.z = Math.PI / 2;
    add(g, box(4.0, 0.2, 1.4), soft(0x8a8fa0), 0, 0.8, 1.5);
    for (var i = 0; i < 4; i++) B.spots.bagTray.push(wp(g, -1.35 + i * 0.9, 1.25, 1.5));
    socket(g, 'bag', 2.6, 0.2);
    P.bag = Object.assign(P.bag || {}, { gear: gear, lamp: add(g, box(1.0, 0.26, 0.1), glow(0xc9a6ff, 0.2), 0, 1.9, 0.82, true) });
    B.pos.bag = wp(g, 0, 4.4, -0.4);
    collide(g, 0, -0.6, 1.9); collide(g, 0.4, -3.6, 2.6);
  }

  // ---------- science lab ----------
  function lab() {
    var g = group(L.lab), white = soft(0xf2f3f7), mdl = model('lab'), arm;
    // Blender lab: panelled hull with orange rings, landing legs, observatory dome, radiator, workbench (the arm swings)
    if (mdl) { g.add(mdl); arm = mdl.getObjectByName('lab_arm'); }
    else {
      var body = add(g, new T.CapsuleGeometry(2.2, 4.2, 8, 20), white, 0, 2.8, -0.6); body.rotation.z = Math.PI / 2;
      [-1.7, 0, 1.7].forEach(function (x) { add(g, new T.TorusGeometry(2.23, 0.12, 6, 26), soft(0xffb84d), x, 2.8, -0.6).rotation.y = Math.PI / 2; });
      [-2.2, 2.2].forEach(function (x) { [-1.6, 0.4].forEach(function (z) { add(g, cyl(0.14, 0.2, 1.2, 6), mat(0x8a8fa0), x, 0.5, z); }); });
      add(g, new T.SphereGeometry(1.0, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), soft(0xdfe2ea), 1.4, 4.9, -0.6);
      var scope = add(g, cyl(0.24, 0.3, 1.9, 10), soft(0x3a4058), 1.4, 5.8, -0.3); scope.rotation.x = 0.6;
      add(g, box(2.2, 0.2, 1.4), soft(0x8a8fa0), -1.6, 1.0, 2.5);
      add(g, cyl(0.12, 0.12, 1.0, 6), mat(0x8a8fa0), -1.6, 0.5, 2.5);
    }
    var screen = add(g, box(1.9, 1.1, 0.1), glow(0x9fe8ff, 0.3), 1.2, 2.9, 1.62, true);
    hopper(g, 'lab', -1.6, 1.7, 2.5, 0.95, 0xffb84d);
    var tubes = [];
    for (var i = 0; i < R.labQueue; i++) { var t = add(g, cyl(0.1, 0.1, 0.6, 8), glow(0xffb84d, 1.2), -2.1 + i * 0.33, 1.4, 1.75, true); t.visible = false; tubes.push(t); }
    if (!arm) {
      arm = new T.Group(); arm.position.set(-0.4, 2.1, 1.5); g.add(arm);
      add(arm, box(0.16, 0.16, 1.5), soft(0x3a4058), 0, 0, 0.7); add(arm, ball(0.18, 8, 8), soft(0xffb84d), 0, 0, 1.45);
    }
    socket(g, 'lab', 2.6, 2.6);
    P.lab = Object.assign(P.lab || {}, { screen: screen, tubes: tubes, arm: arm });
    B.pos.lab = wp(g, 0, 7, -0.6);
    B.spots.caseSpawn = wp(g, 0.4, 0.6, 3.6);
    B.repair.lab = wp(g, 0.4, 1.4, 2.4);
    collide(g, -1.9, -0.7, 2.3); collide(g, 1.9, -0.7, 2.3); collide(g, -1.6, 2.5, 0.9);
  }

  // ---------- radio dish ----------
  function comms() {
    var g = group(L.comms), steel = mat(0xdfe2ea, { flatShading: false }), mdl = model('radio_dish'), i;
    var head = new T.Group(); head.position.set(0, 8.0, 0); g.add(head);
    if (mdl) {
      // Blender dish: concrete footing, braced lattice tower with a caged ladder, equipment cabinet; the reflector
      // with its back frame and feed horn (dish_head) moves into the head group so the game can aim it
      g.add(mdl);
      var dh = mdl.getObjectByName('dish_head');
      if (dh) { head.add(dh); dh.position.set(0, 0, 0); }
      collide(g, -2.25, 0.7, 0.65);
    } else {
      add(g, cyl(1.4, 1.8, 0.7, 10), soft(0x3a4058), 0, 0.35, 0);
      [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].forEach(function (p) { add(g, cyl(0.07, 0.09, 7, 5), steel, p[0], 4.0, p[1]); });
      for (var y = 1.6; y < 7.4; y += 1.45) add(g, box(1.4, 0.08, 1.4), steel, 0, y, 0);
      var pts = [];
      for (i = 0; i <= 10; i++) { var r = (i / 10) * 3.1; pts.push(new T.Vector2(r, r * r * 0.16)); }
      add(head, new T.LatheGeometry(pts, 28), new T.MeshStandardMaterial({ color: 0xf2f3f7, roughness: 0.5, side: T.DoubleSide }), 0, 0, 0);
      add(head, cyl(0.04, 0.04, 2.2, 5), mat(0x8a8fa0), 0, 1.1, 0);
    }
    var tip = add(head, ball(0.2, 10, 10), glow(0xff8fb8, 0.3), 0, 2.2, 0, true);
    var waves = [];
    for (var k = 0; k < 3; k++) {
      var w = add(head, new T.TorusGeometry(0.7, 0.07, 6, 26), new T.MeshBasicMaterial({ color: 0xff8fb8, transparent: true, opacity: 0, depthWrite: false }), 0, 2.4, 0, true);
      w.rotation.x = Math.PI / 2; w.userData.o = k / 3; waves.push(w);
    }
    socket(g, 'comms', 0.4, 2.6);
    P.comms = Object.assign(P.comms || {}, { head: head, tip: tip, waves: waves });
    B.pos.comms = wp(g, 0, 11.6, 0);
    collide(g, 0, 0, 1.9);
  }

  // ---------- rocket ----------
  function rocket() {
    var pad = group(L.rocket), white = soft(0xf4f5f9), red = soft(0xe8483f), dark = soft(0x2b3147), i;
    var ang = Math.atan2(-L.rocket[0], -L.rocket[1]);                 // face the habitat
    var dir = new T.Vector3(Math.sin(ang), 0, Math.cos(ang));
    var rk = new T.Group(); rk.rotation.y = ang; pad.add(rk);
    var tw = new T.Group(), tl, mdl = model('rocket'), rkWins = [];
    if (mdl) {
      // the rocket made in Blender: the ship (lifts off), the pad, and the gantry tower beside it
      var ship = mdl.getObjectByName('rocket_ship'), padM = mdl.getObjectByName('rocket_pad'), gantry = mdl.getObjectByName('rocket_gantry');
      tl = mdl.getObjectByName('rocket_towerLight');
      pad.add(padM); rk.add(ship);
      rkWins.push(ship);     // the hull: hidden while you are inside the cockpit, so its walls do not block the window
      tw.rotation.y = ang; pad.add(tw); tw.add(gantry);             // the gantry sits at (-5.6, 0, -1.5) in the rocket's own frame
    } else {
      var disc = add(pad, cyl(11.5, 12, 0.3, 40), soft(0x4a4f63), 0, 0.15, 0, true); disc.receiveShadow = true;
      add(pad, new T.TorusGeometry(9.2, 0.2, 6, 40), glow(0xffd23f, 0.7), 0, 0.33, 0, true).rotation.x = Math.PI / 2;
      add(rk, cyl(2.5, 2.75, 13, 26), white, 0, 10, 0);
      add(rk, new T.ConeGeometry(2.5, 5.6, 26), red, 0, 19.3, 0);
      [5.2, 14.6].forEach(function (y) { add(rk, new T.TorusGeometry(y < 6 ? 2.72 : 2.56, 0.14, 6, 30), red, 0, y, 0).rotation.x = Math.PI / 2; });
      add(rk, cyl(1.3, 2.1, 2.2, 18), dark, 0, 2.5, 0);
      for (i = 0; i < 4; i++) {
        var a = i * Math.PI / 2 + Math.PI / 4;
        var leg = add(rk, box(0.36, 5.4, 0.36), soft(0x8a8fa0), Math.sin(a) * 3.3, 2.4, Math.cos(a) * 3.3); leg.rotation.set(Math.cos(a) * -0.42, 0, Math.sin(a) * 0.42);
        add(rk, cyl(0.6, 0.7, 0.2, 10), dark, Math.sin(a) * 4.4, 0.42, Math.cos(a) * 4.4);
        var fin = add(rk, box(0.2, 4.2, 2.3), red, Math.sin(a) * 2.9, 5.9, Math.cos(a) * 2.9); fin.rotation.y = a;
      }
      var winM = glow(0x9fe8ff, 1.2);
      [11.4, 13.4].forEach(function (y) { var w = add(rk, ball(0.62, 14, 12), winM, 0, y, 2.36, true); w.scale.z = 0.4; rkWins.push(w); });
      add(rk, box(1.5, 2.0, 0.14), dark, 0, 8.0, 2.66);
      add(rk, box(1.0, 7.4, 0.12), soft(0x8a8fa0), 0, 3.5, 3.05).rotation.x = -0.12;
      // cargo basket at the foot of the ladder
      add(rk, box(1.7, 1.0, 1.7), new T.MeshStandardMaterial({ color: 0xffb84d, roughness: 0.6, transparent: true, opacity: 0.85 }), 0, 0.8, 4.9);
      // gantry tower
      tw.position.set(-dir.z * 5.6 - dir.x * 1.5, 0, dir.x * 5.6 - dir.z * 1.5); pad.add(tw);
      [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].forEach(function (p) { add(tw, cyl(0.08, 0.08, 17, 5), soft(0xff8a3d), p[0], 8.5, p[1]); });
      for (var y = 1.5; y < 17; y += 2.2) add(tw, box(1.4, 0.1, 1.4), soft(0xff8a3d), 0, y, 0);
      tl = add(tw, ball(0.24, 10, 10), glow(0xff5a5a, 2), 0, 17.3, 0, true);
    }
    var flame = add(rk, new T.ConeGeometry(1.7, 8, 16), new T.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, fog: false }), 0, -2.6, 0, true);
    flame.rotation.x = Math.PI; flame.visible = false;
    var fl = new T.PointLight(0xffa040, 0, 90, 1.6); fl.position.set(0, 0, 0); rk.add(fl);
    var twX = -dir.z * 5.6 - dir.x * 1.5, twZ = dir.x * 5.6 - dir.z * 1.5;          // where the gantry stands
    P.rocket = { group: rk, flame: flame, light: fl, towerLight: tl, y: 0, v: 0, base: wp(pad, 0, 0, 0), pad: pad, windows: rkWins, dir: dir };
    B.spots.hoppers.cargo = wp(pad, dir.x * 4.9, 1.6, dir.z * 4.9);
    B.spots.rocketDoor = wp(pad, dir.x * 6.8 + dir.z * 2, 0, dir.z * 6.8 - dir.x * 2);
    B.pos.rocket = wp(pad, 0, 23.5, 0);
    collide(pad, 0, 0, 4.2, 24); collide(pad, dir.x * 4.9, dir.z * 4.9, 1.1); collide(pad, twX, twZ, 1.1, 12);
    floorDisc(pad, 0.3, 11.6, 12.05, -0.15);          // the concrete launch pad: 0.3 m high, its rim bevels down into the ground

    var pal = group(L.pallet);
    add(pal, box(5.0, 0.35, 2.6), soft(0x8a8fa0), 0, 0.18, 0);
    floorBox(pal, 0.35, 2.5, 1.3);
    add(pal, box(5.2, 0.1, 0.2), glow(0xffd23f, 0.5), 0, 0.38, 1.3, true);
    for (i = 0; i < 3; i++) B.spots.pallet.push(wp(pal, -1.6 + i * 1.6, 0.8, 0));
  }

  // ---------- places to do science ----------
  function scienceSites() {
    var slabColors = JA.pick(site, { moon: [0xe6e3da, 0xc98a4a, 0x6b6c78, 0xbfd6ea], mars: [0xdba878, 0xe6c49c, 0x4a332b, 0xdff1f8], sahrun: [0x8a6a4a, 0xe8dcc0, 0xf2eee4, 0xdff1f8] });
    // what lies around each rock site, by site number: real finds of each place (see JA.GEO)
    var extras = JA.pick(site, { moon: { 1: 'beads' }, mars: { 1: 'berries', 2: 'veins' }, sahrun: { 1: 'beads', 2: 'veins' } });
    P.geo = [];
    L.geo.forEach(function (p, i) {
      var g = group(p);
      var slab = add(g, new T.DodecahedronGeometry(1.7, 0), mat(slabColors[i]), 0, 0.15, 0); slab.scale.y = 0.32; slab.rotation.y = i;
      var ring = add(g, new T.TorusGeometry(1.25, 0.09, 6, 28), glow(0xffb84d, 1.6), 0, 0.85, 0, true); ring.rotation.x = Math.PI / 2;
      var beam = add(g, new T.CylinderGeometry(0.12, 0.5, 26, 8, 1, true), new T.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }), 0, 13.5, 0, true);
      var flag = model('flag_marker');                // planted once both cores are drilled
      if (flag) { flag.position.set(1.4, 0, -0.8); g.add(flag); flag.visible = false; }
      else {
        flag = new T.Group(); flag.position.set(1.4, 0, -0.8); g.add(flag); flag.visible = false;
        add(flag, cyl(0.04, 0.04, 2.2, 5), soft(0xf2f3f7), 0, 1.1, 0); add(flag, box(0.8, 0.5, 0.04), soft(0x46d97b), 0.42, 1.9, 0);
      }
      var k;
      if (extras[i] === 'berries') {            // "blueberries"
        var bb = new T.InstancedMesh(ball(0.07, 6, 5), new T.MeshStandardMaterial({ color: 0x4a5a78, roughness: 0.5 }), 220), d = new T.Object3D();
        for (k = 0; k < 220; k++) { var a = k * 2.4, r = 0.6 + Math.sqrt(k) * 0.55; d.position.set(Math.cos(a) * r, Tn.height(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r) - g.position.y + 0.06, Math.sin(a) * r); d.updateMatrix(); bb.setMatrixAt(k, d.matrix); }
        bb.frustumCulled = false; g.add(bb);
      }
      if (extras[i] === 'beads') {            // orange glass beads
        var gb = new T.InstancedMesh(ball(0.06, 6, 5), glow(0xff9a3a, 0.7), 200), d2 = new T.Object3D();
        for (k = 0; k < 200; k++) { var a2 = k * 2.4, r2 = 0.5 + Math.sqrt(k) * 0.5; d2.position.set(Math.cos(a2) * r2, Tn.height(p[0] + Math.cos(a2) * r2, p[1] + Math.sin(a2) * r2) - g.position.y + 0.05, Math.sin(a2) * r2); d2.updateMatrix(); gb.setMatrixAt(k, d2.matrix); }
        gb.frustumCulled = false; g.add(gb);
      }
      if (extras[i] === 'veins') [[-0.5, 0.2], [0.3, -0.3], [0.1, 0.5]].forEach(function (s, n) { var st = add(g, box(2.2, 0.06, 0.14), glow(0xffffff, 0.35), s[0], 0.68, s[1], true); st.rotation.y = 0.5 + n * 0.5; });
      if (i === 3 && JA.iceWell(site)) for (k = 0; k < 5; k++) {      // a well planet: damp, dark stones from deep down, not ice
        var st2 = add(g, new T.DodecahedronGeometry(0.42 + (k % 3) * 0.16, 0), new T.MeshStandardMaterial({ color: 0x4e3a2a, roughness: 0.35, metalness: 0.05, flatShading: true }), Math.cos(k * 1.3) * 2.6, 0.18, Math.sin(k * 1.3) * 2.6);
        st2.rotation.set(k, k * 2, 0);
      }
      else if (i === 3) for (k = 0; k < 5; k++) { var ic = add(g, new T.OctahedronGeometry(0.5 + (k % 3) * 0.2, 0), new T.MeshStandardMaterial({ color: 0xdff7ff, emissive: 0x6fcff5, emissiveIntensity: 0.5, flatShading: true }), Math.cos(k * 1.3) * 2.6, 0.2, Math.sin(k * 1.3) * 2.6); ic.rotation.set(k, k * 2, 0); }
      P.geo.push({ ring: ring, beam: beam, flag: flag });
      B.spots.drill.push(wp(g, 0, 0.7, 0));
      collide(g, 0, 0, 0.9);
    });

    // ice deposits
    P.ice = [];
    var well = JA.iceWell(site);      // a well planet (Sahrun): a stone well head over dark water, instead of ice
    Tn.iceNodes.forEach(function (n, i) {
      var g = group([n.x, n.z]), im;
      if (well) {
        im = new T.MeshStandardMaterial({ color: 0x163246, emissive: 0x1d6890, emissiveIntensity: 0.75, roughness: 0.05, metalness: 0.3 });
        add(g, new T.CylinderGeometry(1.2, 1.3, 0.7, 16, 1, true), new T.MeshStandardMaterial({ color: 0x9a7a55, roughness: 0.95, side: T.DoubleSide }), 0, 0.35, 0);
        add(g, new T.TorusGeometry(1.25, 0.12, 6, 18), soft(0x8a6a48), 0, 0.7, 0).rotation.x = Math.PI / 2;
        add(g, new T.CircleGeometry(1.15, 16), im, 0, 0.42, 0, true).rotation.x = -Math.PI / 2;
      } else {
        im = new T.MeshStandardMaterial({ color: 0xdff7ff, emissive: 0x58c8ff, emissiveIntensity: 0.85, roughness: 0.15, flatShading: true, transparent: true, opacity: 0.92 });
        add(g, new T.IcosahedronGeometry(1.1, 0), im, 0, 0.6, 0).scale.set(1, 0.9, 1);
        add(g, new T.IcosahedronGeometry(0.7, 0), im, 0.9, 0.4, 0.4).rotation.y = i;
        add(g, new T.IcosahedronGeometry(0.6, 0), im, -0.7, 0.35, 0.6).rotation.y = i * 2;
      }
      // the ice drill: a tripod with a motor box, a warm auger and a lamp. The game starts it; it works by itself (B.rigs).
      var rg = new T.Group(), legM = soft(0xdfe2ea), k;
      for (k = 0; k < 3; k++) {
        var la = k / 3 * Math.PI * 2 + 0.5, leg = add(rg, cyl(0.05, 0.07, 2.9, 6), legM, Math.cos(la) * 0.75, 1.3, Math.sin(la) * 0.75);
        leg.rotation.set(Math.sin(la) * 0.5, 0, -Math.cos(la) * 0.5);
      }
      add(rg, box(0.55, 0.45, 0.55), soft(0xffc533), 0, 2.55, 0);
      add(rg, box(0.6, 0.1, 0.6), soft(0x2b3147), 0, 2.82, 0);
      var auger = add(rg, new T.ConeGeometry(0.16, 1.5, 6), new T.MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.8, roughness: 0.3, emissive: 0xff7a2d, emissiveIntensity: 0 }), 0, 1.6, 0);
      auger.rotation.x = Math.PI;
      var lamp = add(rg, ball(0.09, 8, 8), glow(0x46ff8a, 0.3), 0.33, 2.62, 0.3, true);
      g.add(rg);
      P.ice.push({ group: g, mat: im, auger: auger, lamp: lamp });
      B.spots.ice.push(wp(g, 0, 0.8, 0));
      collide(g, 0, 0, 1.1);
    });
    var ib = group(L.ice);
    add(ib, new T.CylinderGeometry(0.2, 1.2, 60, 8, 1, true), new T.MeshBasicMaterial({ color: 0x8fe6ff, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }), 0, 30, 0, true);

    // instrument targets (a glowing outline until the real thing is set up)
    P.inst = {};
    Object.keys(L.inst).forEach(function (id) {
      var g = group(L.inst[id]), steel = soft(0xdfe2ea), dark = soft(0x3a4058);
      var ring = add(g, new T.TorusGeometry(1.6, 0.08, 6, 30), glow(0x5cf0ff, 1.6), 0, 0.3, 0, true); ring.rotation.x = Math.PI / 2;
      var ghost = add(g, new T.CylinderGeometry(0.1, 0.4, 20, 8, 1, true), new T.MeshBasicMaterial({ color: 0x5cf0ff, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }), 0, 10.3, 0, true);
      var m = new T.Group(); g.add(m); m.visible = false; m.scale.setScalar(0.001);
      var spin = null;
      if (id === 'seismo') {
        add(m, new T.SphereGeometry(0.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xe8eaf0, metalness: 0.6, roughness: 0.25 }), 0, 0.25, 0);
        add(m, cyl(1.0, 1.1, 0.25, 16), dark, 0, 0.13, 0);
        add(m, box(1.3, 0.06, 0.9), new T.MeshStandardMaterial({ color: 0x14306b, metalness: 0.5, roughness: 0.3 }), 1.9, 0.5, 0).rotation.z = 0.3;
        add(m, cyl(0.04, 0.04, 0.5, 5), steel, 1.9, 0.25, 0);
      } else if (id === 'rad') {
        add(m, cyl(0.07, 0.09, 1.8, 6), steel, 0, 0.9, 0);
        add(m, box(0.8, 0.6, 0.6), soft(0xffc533), 0, 2.0, 0);
        add(m, cyl(0.16, 0.16, 0.5, 8), dark, 0, 2.5, 0);
        spin = add(m, ball(0.12, 8, 8), glow(0xff6fb1, 2), 0.3, 2.35, 0.32, true);
      } else if (JA.pick(site, { moon: 'mirror', mars: 'mast', sahrun: 'mast' }) === 'mirror') {                 // laser mirror
        var pnl = add(m, box(1.5, 1.5, 0.12), new T.MeshStandardMaterial({ color: 0xcfe6ff, metalness: 0.95, roughness: 0.08, emissive: 0x4a7ac0, emissiveIntensity: 0.3 }), 0, 0.95, 0); pnl.rotation.x = -0.75;
        add(m, box(1.7, 0.1, 1.2), dark, 0, 0.1, 0); add(m, cyl(0.05, 0.05, 0.9, 5), steel, 0, 0.5, -0.3);
      } else {                                      // weather mast
        add(m, cyl(0.06, 0.09, 3.4, 6), steel, 0, 1.7, 0);
        add(m, box(0.5, 0.4, 0.4), soft(0xf2f3f7), 0, 2.4, 0.2);
        spin = new T.Group(); spin.position.set(0, 3.5, 0); m.add(spin);
        for (var c = 0; c < 3; c++) { var cup = add(spin, ball(0.14, 8, 6), soft(0xff8a3d), Math.cos(c * 2.094) * 0.45, 0, Math.sin(c * 2.094) * 0.45); cup.scale.y = 0.8; }
        add(spin, box(0.9, 0.04, 0.04), steel, 0, 0, 0);
      }
      P.inst[id] = { ring: ring, ghost: ghost, model: m, spin: spin, s: 0 };
      B.spots.inst[id] = wp(g, 0, 0.6, 0);
    });

    P.photo = [];
    L.photo.forEach(function (p) {
      var g = group(p);
      add(g, cyl(0.05, 0.05, 1.5, 5), soft(0xdfe2ea), 0, 0.75, 0);
      add(g, box(0.5, 0.36, 0.3), soft(0x2b3147), 0, 1.6, 0);
      var lens = add(g, cyl(0.12, 0.12, 0.16, 10), glow(0xffd23f, 1.6), 0, 1.6, 0.2, true); lens.rotation.x = Math.PI / 2;
      var ring = add(g, new T.TorusGeometry(1.3, 0.07, 6, 26), glow(0xffd23f, 1.6), 0, 0.25, 0, true); ring.rotation.x = Math.PI / 2;
      P.photo.push({ ring: ring, lens: lens });
      B.spots.photo.push(wp(g, 0, 1, 0));
      collide(g, 0, 0, 0.4);
    });
  }

  B.build = function (rootGroup, siteId) {
    root = rootGroup; site = siteId; L = Tn.L;
    add = W.add; mat = W.mat; soft = W.soft; glow = W.glow;
    P = { cables: {} }; B.P = P;
    B.colliders = []; B.floors = []; B.pos = {}; B.repair = {};
    B.spots = { sockets: {}, hoppers: {}, rackSlots: [], bagTray: [], beds: [], panels: [], drill: [], ice: [], inst: {}, photo: [], pallet: [] };
    // every boulder keeps its own collider (b.col), so one that is broken up can stop blocking the way; h is how tall it stands
    Tn.boulders.forEach(function (b) { b.col = { x: b.x, z: b.z, r: b.r * 0.92, h: b.seat ? 0.9 : b.r * (0.5 + b.sy) }; B.colliders.push(b.col); });
    var nRocks = B.colliders.length;      // the colliders after these are the buildings'
    hab(); solar(); airMaker(); greenhouse(); bagger(); lab(); comms(); rocket(); scienceSites();
    if (JA.siteOf(site).dew) dewCatcher();
    if (JA.siteOf(site).landmarks && JA.desert && JA.desert.arch) desertDressing(nRocks);
    B.repair.rack = B.spots.rack.clone();
    var rackP = new T.Vector3(L.rack[0], 0, L.rack[1]);
    ['air', 'food', 'bag', 'lab', 'comms', 'scrub'].forEach(function (id) { cable(rackP, B.spots.sockets[id], id); });
    B.launch = null;
  };

  // ---------- the dew catcher (a planet with one: Sahrun) ----------
  // A fine net between two posts, beside the Greenhouse water tank. On a clear night the net gets cold, the water
  // vapour in the air touching it turns into drops (dew), and the drops run down the gutter into a can (sim.js
  // startSol). Real: fog nets like this catch drinking water in Chile's Atacama Desert.
  var DEW_AT = [9, 19];
  function dewCatcher() {
    var g = group(DEW_AT), steel = mat(0xb9bcc6, { flatShading: false }), dark = soft(0x3a4058);
    [-1.9, 1.9].forEach(function (x) {
      add(g, cyl(0.07, 0.09, 3.4, 8), steel, x, 1.7, 0);
      add(g, cyl(0.22, 0.28, 0.25, 8), dark, x, 0.12, 0);
      collide(g, x, 0, 0.3);
    });
    add(g, box(4, 0.08, 0.08), steel, 0, 3.35, 0);
    var tex = W.canvasTex(128, function (ctx, n) {
      ctx.clearRect(0, 0, n, n); ctx.strokeStyle = 'rgba(235, 242, 255, 0.95)'; ctx.lineWidth = 1.6;
      for (var k = 0; k <= n; k += 8) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, n); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(n, k); ctx.stroke(); }
    });
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(5, 3);
    var net = new T.MeshStandardMaterial({ map: tex, transparent: true, side: T.DoubleSide, depthWrite: false, roughness: 0.6, emissive: 0x58c8ff, emissiveIntensity: 0 });
    add(g, new T.PlaneGeometry(3.7, 2.2), net, 0, 2.2, 0, true);
    add(g, box(3.9, 0.12, 0.26), steel, 0, 1.04, 0);                       // the gutter under the net
    add(g, cyl(0.05, 0.05, 0.7, 6), steel, 2.05, 0.75, 0.2).rotation.z = 0.5;    // the spout down to the can
    add(g, box(0.9, 0.36, 0.9), dark, 2.6, 0.18, 0.4);                     // the can's stand
    collide(g, 2.6, 0.4, 0.5);
    var can = new T.Group(); can.position.set(2.6, 0.36, 0.4); g.add(can);
    add(can, cyl(0.28, 0.28, 0.62, 14), soft(0xdfe7f2), 0, 0.31, 0);
    var water = add(can, cyl(0.25, 0.25, 0.04, 14), glow(0x58c8ff, 1.2), 0, 0.6, 0, true);
    add(can, new T.TorusGeometry(0.16, 0.03, 6, 12), steel, 0, 0.74, 0);
    B.spots.dew = wp(g, 2.6, 0.9, 0.4);
    P.dew = { can: can, water: water, net: net };
  }

  // ---------- a desert planet's dressing (Sahrun): rock landmarks, sand drifted against the buildings, a shade sail ----------
  // The rocks near the outpost are hard ground (colliders): sand rays dive under them and a deepmaw cannot come up there.
  var ROCKS = [      // kind, x, z, size numbers, turn, in the play area (with a collider)
    ['arch', -62, 100, [32, 16, 2.6], 0.3, true], ['arch', 128, 18, [20, 10, 1.9], 1.3, true],
    ['mush', -112, -22, [6.5, 4.2], 0, true], ['mush', -103, -13, [5, 3.2], 1, true], ['mush', -119, -9, [4, 2.6], 2, true],
    ['mush', 28, 108, [5.5, 3.6], 0.5, true], ['mush', 37, 114, [4.2, 2.8], 1.7, true],
    ['tower', -30, -122, [24, 3.2], 0, true], ['tower', -18, -131, [17, 2.6], 0, true], ['tower', -39, -133, [12, 2.2], 0, true],
    // farther out, on the skyline
    ['tower', 230, 70, [55, 7], 0, false], ['tower', 239, 92, [40, 5.5], 0, false], ['tower', -205, 160, [66, 8], 0, false],
    ['arch', 150, -215, [74, 38, 6], 0.6, false], ['tower', -250, -70, [48, 6.5], 0, false], ['mush', 40, 246, [16, 11], 0, false]
  ];
  function desertDressing(nRocks) {
    var D = JA.desert, rockM = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    var sandM = new T.MeshStandardMaterial({ color: 0xd8a25a, roughness: 1 }), seed = 1;
    // sand blown up against the windward (west) side of each building, before the rocks add their own colliders
    var lump = new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    B.colliders.slice(nRocks).forEach(function (c) {
      if (c.r < 1.4) return;
      var m = add(root, lump, sandM, c.x - c.r * 0.95, Tn.height(c.x - c.r * 0.95, c.z) - 0.05, c.z, true);
      m.scale.set(c.r * 0.75, Math.min(0.75, c.r * 0.22), c.r * 1.15); m.receiveShadow = true;
    });
    ROCKS.forEach(function (r) {
      var g = group([r[1], r[2]]), a = r[4], s = r[3], geos, i;
      if (r[0] === 'arch') geos = [D.arch(s[0], s[1], s[2], seed++)];
      else if (r[0] === 'mush') geos = D.mushroom(s[0], s[1], seed++);
      else geos = [D.tower(s[0], s[1], seed++)];
      for (i = 0; i < geos.length; i++) { var m = new T.Mesh(geos[i], rockM); m.rotation.y = a; m.castShadow = m.receiveShadow = true; g.add(m); }
      if (!r[5]) return;
      if (r[0] === 'arch') [-1, 1].forEach(function (sd) { var ox = sd * s[0] / 2; collide(g, ox * Math.cos(a), -ox * Math.sin(a), s[2] * 1.7); });
      else if (r[0] === 'mush') collide(g, 0, 0, s[1] * 0.55);
      else collide(g, 0, 0, s[1] * 0.85);
    });
    // a shade sail over the rover park: four poles and a sagging sheet of cloth that ripples in the wind
    var rp = L.roverPark, sg = group(rp), W2 = 11, H2 = 9, poleM = mat(0xb9bcc6, { flatShading: false });
    var corners = [[-W2 / 2, -H2 / 2, 4.6], [W2 / 2, -H2 / 2, 4.6], [-W2 / 2, H2 / 2, 3.4], [W2 / 2, H2 / 2, 3.4]];
    corners.forEach(function (c) { add(sg, cyl(0.07, 0.09, c[2], 6), poleM, c[0], c[2] / 2, c[1]); });
    var cloth = W.canvasTex(128, function (ctx, n) {
      ctx.fillStyle = '#efe4cc'; ctx.fillRect(0, 0, n, n);
      ctx.strokeStyle = 'rgba(150, 120, 80, 0.35)'; ctx.lineWidth = 2;
      for (var k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(k * n / 4, 0); ctx.lineTo(k * n / 4, n); ctx.stroke(); }     // seams
      var gr = ctx.createLinearGradient(0, n, 0, n * 0.55); gr.addColorStop(0, 'rgba(176, 130, 80, 0.4)'); gr.addColorStop(1, 'rgba(176, 130, 80, 0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, n, n);              // dusty along the low edge
    });
    var sheet = new T.PlaneGeometry(W2, H2, 10, 8); sheet.rotateX(-Math.PI / 2);
    var sp = sheet.attributes.position, base0 = new Float32Array(sp.count);
    for (var i = 0; i < sp.count; i++) {
      var x = sp.getX(i) / (W2 / 2), z = sp.getZ(i) / (H2 / 2);
      base0[i] = lerpY(z) - 0.7 * (1 - x * x) * (1 - z * z);
      sp.setY(i, base0[i]);
    }
    function lerpY(z) { return 4.6 + (3.4 - 4.6) * (z + 1) / 2; }
    var sail = add(sg, sheet, new T.MeshStandardMaterial({ map: cloth, roughness: 0.9, side: T.DoubleSide }), 0, 0, 0);
    sail.castShadow = true;
    P.sail = { geo: sheet, base: base0 };
  }

  // ---------- show what the mission rules say ----------
  var demo = { air: 60, bags: 5, filter: 80, water: 60, rack: { charge: 0.5, eff: [1, 1, 1], broken: false },
    m: { air: { power: 2, queue: 2, prog: 0.1, broken: false }, food: { lamp: 1, water: 1, broken: false, beds: [{ state: 'ripe', g: 1 }, { state: 'growing', g: 0.7, crop: 'potato' }, { state: 'growing', g: 0.4 }, { state: 'ripe', g: 1, crop: 'potato' }] },
      bag: { pending: 1, broken: false }, lab: { power: 2, queue: [1], prog: 0.2, broken: false }, comms: { on: true } },
    cores: [0, 0, 0, 0], inst: {}, photos: {}, storm: null };

  B.update = function (dt, s) {
    if (!P.hab) return;
    s = s || demo;
    var t = W.time, m = s.m, i, on;
    var alarm = s.storm && (s.storm.warned && !s.storm.over);

    // habitat
    for (i = 0; i < P.hab.bags.length; i++) {
      var b = P.hab.bags[i], want = i < s.bags ? 1 : 0;
      b.userData.s += (want - b.userData.s) * Math.min(1, dt * 7);
      b.visible = b.userData.s > 0.02;
      b.scale.set(1.45 * b.userData.s, 0.62 * b.userData.s, 0.85 * b.userData.s);
    }
    var dl = P.hab.doorLight.material;
    dl.color.set(alarm ? 0xff4d6a : 0x4dff9a); dl.emissive.copy(dl.color);
    dl.emissiveIntensity = alarm ? 2 + Math.sin(t * 12) * 1.5 : 1.6;
    P.hab.beacon.material.emissiveIntensity = 1 + Math.sin(t * 3);
    P.hab.flag.rotation.y = JA.hasAir(site) ? Math.sin(t * 2) * 0.12 : 0;      // the flag only moves where there is wind
    if (P.sail) {      // the shade sail ripples in the wind
      var sgp = P.sail.geo.attributes.position, sb = P.sail.base;
      for (var si = 0; si < sgp.count; si++) {
        var fx = sgp.getX(si), fz = sgp.getZ(si), edge = (1 - Math.pow(fx / 5.5, 2)) * (1 - Math.pow(fz / 4.5, 2));
        sgp.setY(si, sb[si] + 0.16 * edge * Math.sin(t * 2.4 + fx * 0.7 + fz * 0.4));
      }
      sgp.needsUpdate = true;
    }
    if (P.dew) {
      // the can is there while it holds water; the net glints with dew in the morning
      var full = Math.max(0, Math.min(1, (s.dew || 0) / R.dewWater));
      P.dew.can.visible = s.dew >= 1;
      P.dew.water.position.y = 0.08 + 0.5 * full;
      P.dew.net.emissiveIntensity = s.dew >= 1 ? 0.15 + 0.35 * full * Math.max(0, 1 - (s.t || 0) / Math.max(1, (s.dayLength || 300) * 0.4)) : 0;
    }

    // solar panels track the Sun; dust (dusty planets) or a moved Sun (the others) makes them less useful
    var dusty = JA.siteOf(site).dusty;
    for (i = 0; i < 3; i++) {
      var eff = s.rack.eff[i], off = (1 - eff) * 2;
      q.setFromUnitVectors(UP, W.sunDir);
      if (!dusty) { qy.setFromAxisAngle(UP, off * 1.1); q.premultiply(qy); }
      P.solar.pivots[i].quaternion.slerp(q, Math.min(1, dt * 2.5));
      var pm = P.solar.mats[i];
      if (dusty) pm.color.setRGB(1, 1 - off * 0.3, 1 - off * 0.62); else pm.color.setRGB(1, 1, 1);
      pm.emissiveIntensity = 0.3 * eff;
    }
    P.rack.level.scale.y = Math.max(0.02, Math.min(1, s.rack.charge));
    P.rack.lamp.material.color.set(s.rack.broken ? 0xff4d6a : 0x46ff8a); P.rack.lamp.material.emissive.copy(P.rack.lamp.material.color);
    P.rack.lamp.material.emissiveIntensity = s.rack.broken ? 1.5 + Math.sin(t * 12) * 1.5 : 1.2;
    P.cables.trunk.emissiveIntensity = s.rack.broken ? 0 : 0.6 + Math.sin(t * 5) * 0.3;

    // air maker
    var a = m.air, working = !a.broken && a.power > 0 && a.queue > 0;
    setSocket('air', a.power, a.power > 0);
    for (i = 0; i < P.air.ice.length; i++) { P.air.ice[i].visible = i < a.queue; P.air.ice[i].rotation.y += dt * (working ? 3 : 0.4); }
    P.air.level.scale.y += (Math.max(0.02, s.air / 100) - P.air.level.scale.y) * Math.min(1, dt * 3);
    P.air.level.material.color.set(s.air < 25 ? 0xff6f7f : 0x7fe6ff); P.air.level.material.emissive.set(s.air < 25 ? 0xff3050 : 0x4fd8ff);
    P.air.fan.rotation.z += dt * (working ? 12 : 0.3);
    P.air.lamp.material.emissiveIntensity = working ? 2 : 0.15;
    if (working && Math.random() < dt * 10) W.emit(B.spots.hoppers.air.x + 3.1 + (Math.random() - 0.5), B.spots.hoppers.air.y - 3 + Math.random() * 3, B.spots.hoppers.air.z + (Math.random() - 0.5), { vy: 1.2, life: 1.4, size: 0.3, grow: 0.3, color: 0xbff4ff, alpha: 0.7 });

    // greenhouse
    var f = m.food, lit = f.lamp > 0 && !f.broken;
    setSocket('food', lit ? Math.ceil(f.lamp * 3) : 0, f.lamp > 0);
    P.food.lampM.emissiveIntensity = lit ? 2.4 : 0.12;
    P.food.light.intensity = lit ? 1.6 : 0;
    P.food.water.scale.y += (Math.max(0.02, Math.min(1, (s.water || 0) / 100)) - P.food.water.scale.y) * Math.min(1, dt * 3);
    for (i = 0; i < P.food.beds.length; i++) {
      var bed = f.beds[i], pb = P.food.beds[i], spud = bed.crop === 'potato';
      var ws = bed.state === 'empty' ? 0 : 0.16 + 0.84 * bed.g;
      pb.s += (ws - pb.s) * Math.min(1, dt * 4);
      var grown = spud ? pb.potato : pb.plants, other = spud ? pb.plants : pb.potato;
      other.visible = false;
      grown.visible = pb.s > 0.02; grown.scale.setScalar(Math.max(0.001, pb.s));
      grown.rotation.z = Math.sin(t * 1.4 + i) * 0.03;
      for (var k = 0; k < pb.fruits.length; k++) { pb.fruits[k].visible = bed.state === 'ripe'; pb.spuds[k].visible = bed.state === 'ripe'; }
      pb.mark.visible = bed.state === 'ripe'; pb.mark.position.y = 2.6 + Math.sin(t * 3 + i) * 0.15; pb.mark.rotation.y = t * 2;
    }

    // air scrubber
    var fl = s.filter == null ? 100 : s.filter, low = fl < R.filterWarn;
    setSocket('scrub', Math.ceil(fl / 34), !low);
    for (i = 0; i < 3; i++) {
      var cm = P.scrub.cans[i], full = fl <= i * 33.4;                 // the canisters fill up one after another
      cm.color.set(full ? 0x6b7078 : 0x8fe8d0); cm.emissive.set(full ? 0x30343c : low ? 0xffb347 : 0x3db8a0);
      cm.emissiveIntensity = full ? 0.1 : low ? 0.9 + Math.sin(t * 6) * 0.5 : 0.8;
    }
    P.cables.scrub.emissiveIntensity = low ? 0 : 0.6;

    // soil bagger
    on = m.bag.pending > 0 && !m.bag.broken;
    setSocket('bag', Math.min(3, m.bag.pending), m.bag.pending > 0);
    if (on) P.bag.gear.rotation.x += dt * 6;
    P.bag.lamp.material.emissiveIntensity = on ? 2 : 0.15;

    // lab
    var lb = m.lab, busy = !lb.broken && lb.power > 0 && lb.queue.length > 0;
    setSocket('lab', lb.power, lb.power > 0);
    for (i = 0; i < P.lab.tubes.length; i++) P.lab.tubes[i].visible = i < lb.queue.length;
    P.lab.screen.material.emissiveIntensity = busy ? 1.4 + Math.sin(t * 9) * 0.8 : 0.25;
    P.lab.arm.rotation.y = busy ? Math.sin(t * 3) * 0.7 : 0;

    // radio dish
    setSocket('comms', m.comms.on ? 3 : 0, m.comms.on);
    P.comms.head.rotation.set(-0.7, Math.sin(t * 0.1) * 0.3 + 0.4, 0);
    P.comms.tip.material.emissiveIntensity = m.comms.on ? 2 + Math.sin(t * 8) : 0.2;
    for (i = 0; i < P.comms.waves.length; i++) {
      var w = P.comms.waves[i], wt = (t * 0.7 + w.userData.o) % 1;
      w.position.y = 2.4 + wt * 9; w.scale.setScalar(1 + wt * 4); w.material.opacity = m.comms.on ? 0.8 * (1 - wt) : 0;
    }
    P.cables.air.emissiveIntensity = a.power > 0 ? 1 : 0; P.cables.food.emissiveIntensity = lit ? 1 : 0;
    P.cables.bag.emissiveIntensity = on ? 1 : 0; P.cables.lab.emissiveIntensity = lb.power > 0 ? 1 : 0; P.cables.comms.emissiveIntensity = m.comms.on ? 1 : 0;

    // sparks and smoke on anything broken
    ['air', 'food', 'lab', 'rack'].forEach(function (id) {
      var mm = id === 'rack' ? s.rack : m[id];
      if (!mm.broken || Math.random() > dt * 14) return;
      var p = B.repair[id];
      W.emit(p.x, p.y + 0.6, p.z, { vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 0.5, size: 0.22, grow: 0.3, color: 0xffe36a, alpha: 1, grav: W.gravity });
      if (Math.random() < 0.4) W.emit(p.x, p.y + 1, p.z, { vy: 1.4, life: 2, size: 0.6, grow: 3, color: 0x555a66, alpha: 0.5 });
    });

    // science sites
    for (i = 0; i < P.geo.length; i++) {
      var left = 2 - s.cores[i], gp = P.geo[i];
      gp.ring.visible = gp.beam.visible = left > 0; gp.flag.visible = left <= 0;
      gp.ring.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.06);
    }
    for (i = 0; i < P.ice.length; i++) {
      var pi2 = P.ice[i], rs = B.rigs && s !== demo ? B.rigs[i] : null, drilling = !!rs && rs.state === 'drill', resting = !!rs && rs.state === 'rest';
      pi2.mat.emissiveIntensity = 0.75 + Math.sin(t * 2 + i) * 0.2;
      // the drill turns and sinks into the ice while it works, glows warm, and puffs a little vapour
      pi2.auger.rotation.y += dt * (drilling ? 18 : 0);
      pi2.auger.position.y += ((drilling ? 1.6 - rs.p * 0.55 : 1.6) - pi2.auger.position.y) * Math.min(1, dt * 6);
      pi2.auger.material.emissiveIntensity = drilling ? 0.5 + rs.p * 0.9 : resting ? 0.5 : 0;
      pi2.lamp.material.color.set(drilling ? 0xffd23f : resting ? 0xff8a3d : 0x46ff8a); pi2.lamp.material.emissive.copy(pi2.lamp.material.color);
      pi2.lamp.material.emissiveIntensity = drilling ? 1.6 + Math.sin(t * 12) : resting ? 0.9 : 0.5;
      if (drilling && Math.random() < dt * 14) W.emit(pi2.group.position.x + (Math.random() - 0.5) * 0.5, pi2.group.position.y + 0.9, pi2.group.position.z + (Math.random() - 0.5) * 0.5, { vy: 1.3, life: 1.1, size: 0.28, grow: 1.2, color: 0xdff7ff, alpha: 0.6 });
    }
    Object.keys(P.inst).forEach(function (id) {
      var pi = P.inst[id], done = !!s.inst[id];
      pi.ring.visible = pi.ghost.visible = !done;
      pi.ring.rotation.z = t; pi.model.visible = done || pi.s > 0.02;
      pi.s += ((done ? 1 : 0) - pi.s) * Math.min(1, dt * 5);
      pi.model.scale.setScalar(Math.max(0.001, pi.s));
      if (pi.spin && done) { if (pi.spin.isGroup) pi.spin.rotation.y += dt * 5; else pi.spin.material.emissiveIntensity = 1.5 + Math.sin(t * 6) * 1.5; }
    });
    for (i = 0; i < P.photo.length; i++) {
      var took = !!s.photos[i];
      P.photo[i].ring.visible = !took; P.photo[i].lens.material.emissiveIntensity = took ? 0.2 : 1.6 + Math.sin(t * 4);
    }

    // rocket
    var rk = P.rocket;
    rk.towerLight.material.emissiveIntensity = 1 + Math.sin(t * 4) * 1;
    if (B.launch) {
      var L2 = B.launch; L2.t += dt;
      var burn = L2.t > 2.4;
      rk.flame.visible = L2.t > 1.2; rk.flame.scale.set(1, 0.6 + Math.random() * 0.8 + (burn ? 0.6 : 0), 1);
      rk.light.intensity = L2.t > 1.2 ? 4 + Math.random() * 2 : 0;
      if (burn) { rk.v += (2.2 + L2.t * 1.4) * dt; rk.y += rk.v * dt; }
      rk.group.position.y = rk.y;
      if (L2.t > 1.2) for (i = W.rate(6, dt); i > 0; i--) {
        var ang = Math.random() * 6.28, sp = burn ? 9 + Math.random() * 12 : 3 + Math.random() * 4;
        W.emit(rk.base.x + Math.cos(ang) * 1.2, rk.base.y + Math.max(0.4, rk.y * 0.55) + 0.6, rk.base.z + Math.sin(ang) * 1.2,
          { vx: Math.cos(ang) * sp * (rk.y < 14 ? 1 : 0.15), vy: rk.y < 14 ? 1.5 + Math.random() * 3 : -6, vz: Math.sin(ang) * sp * (rk.y < 14 ? 1 : 0.15), life: 2.4, size: 1.6, grow: 4, color: Math.random() < 0.3 ? 0xffc27a : 0xe6e0d8, alpha: 0.6 });
      }
      W.cam.shake = Math.max(W.cam.shake, burn ? 0.5 * Math.max(0, 1 - rk.y / 160) : 0.12);
    }
  };
  B.startLaunch = function () { B.launch = { t: 0 }; P.rocket.y = 0; P.rocket.v = 0; };
  B.rocketPos = function (out) { return out.set(P.rocket.base.x, P.rocket.base.y + P.rocket.y + 10, P.rocket.base.z); };
})(window.JA);
