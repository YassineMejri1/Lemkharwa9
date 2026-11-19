/* Astro Outpost — inside the habitat and inside the rocket.
   Walk through the airlock and you are really inside: bunks, a galley table, plants under pink
   grow lights, the control console, an exercise bike, spare spacesuits, a water tank, and windows
   and a skylight that look out at the real sky. The rocket has a crew cabin with two reclined launch
   couches, a glass cockpit with live screens under its window, life support, stowage lockers and a
   ladder up to the docking hatch. Each thing you walk up to tells a real fact about living in space.
   game.js decides when you go in or out; this file builds the rooms and tells the game where the
   floor, walls, ceiling and furniture are. The rooms sit inside the real buildings, so the windows
   show the real outpost outside. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, B = JA.base;
  var I = JA.interior = { current: null };
  if (!T) return;

  var HAB_R = 4.6, HAB_FLOOR = 1.3;                  // inner radius of the dome; floor height above the ground
  var RK_R = 2.3, RK_FLOOR = 9.9, RK_TOP = 14.6;      // the rocket cabin, in the rocket's own coordinates
  var HAB_WINDOWS = [-1.25, -0.55, 0.55, 2.4, 3.6];   // the same angles as the dome's windows in base.js
  var rooms = {}, light = null, blob = null, site = 'moon', clock = 0, redrawAt = 0, used = {};
  var v1 = new T.Vector3(), v2 = new T.Vector3();

  // Real facts, one for each thing you can walk up to.
  var FACTS = {
    bed: 'On the Moon and Mars there is gravity, so a bed works. On the Space Station astronauts sleep in sleeping bags tied to the wall, so they do not float around in the night.',
    plants: 'Astronauts on the Space Station have grown lettuce, radishes and even chilli peppers under pink LED lights. Plants only need the red and blue parts of light, so that is all the lamps give them.',
    bike: 'Astronauts exercise about two hours every day. In low gravity muscles and bones get weaker if you do not use them, so exercise is part of the job.',
    suits: 'A spacesuit is like a tiny spaceship you wear. It gives you air, keeps you warm or cool, and protects you from dust and from the Sun\'s rays.',
    water: 'On the Space Station about 98 out of every 100 drops of water are recycled, even sweat and urine, and cleaned until they are drinking water again. Water is too heavy to ship from Earth every day.',
    table: 'Space food comes in pouches and cans. Astronauts add water to dried food, and they eat tortillas instead of bread because tortillas make no crumbs.',
    window: 'Look up! The skylight and windows show the real sky. On the Moon the sky is black even in daytime, because there is no air to scatter the sunlight.',
    seat: 'Astronauts launch lying on their backs with their knees up, in couches shaped to fit their bodies, so the huge push of the rocket spreads over their whole back.',
    panel: {
      moon: 'A rocket needs oxygen to burn its fuel. Engineers are studying how to split the ice in the Moon\'s dark polar craters into hydrogen and oxygen, the same two ingredients that powered the Space Shuttle\'s main engines.',
      mars: 'A rocket needs oxygen to burn its fuel. NASA\'s MOXIE experiment on the Perseverance rover showed that oxygen can be made from the carbon dioxide in Mars air, so a future ship home could fill its tanks on Mars.',
      sahrun: 'A rocket needs oxygen to burn its fuel. Here the crew splits water from the Deep Well into hydrogen and oxygen, the same two ingredients that powered the Space Shuttle\'s main engines.'
    },
    abort: 'NASA\'s Orion capsule sits under a launch abort tower. If the rocket fails, its powerful little motors pull the crew capsule away from danger in a few seconds.',
    life: 'A spacecraft carries tanks of oxygen and nitrogen and mixes them into air like Earth\'s: about one part oxygen to four parts nitrogen. A scrubber takes out the carbon dioxide the crew breathes out.',
    stow: 'Rock samples travel home sealed in metal boxes, so Earth\'s air and water cannot change them before scientists open them. The Apollo crews sealed their sample boxes while still on the Moon.',
    plush: 'Crews often bring a small soft toy. When it starts to float, everyone knows they have reached space! It is called a zero-g indicator.',
    scrubber: 'Every breath out is carbon dioxide. On the Space Station it is pulled out of the air by beds of zeolite that are baked clean and used again. When Apollo 13\'s scrubbers ran short, the crew built a new one from a sock, a hose and duct tape.',
    console: 'Mission Control on Earth watches every reading you see here, but their advice travels at the speed of light. Out here, the first decision is always yours.'
  };
  I.fact = function (id) { var f = FACTS[id]; return !f ? '' : JA.siteText(f, site); };

  // ---------- small helpers ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function tex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); draw(ctx, w, h);
    var t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    t.userData = { canvas: c, ctx: ctx };
    return t;
  }
  function std(color, o) { return new T.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.65, metalness: 0.05 }, o || {})); }
  function add(parent, geo, m, x, y, z) { return W.add(parent, geo, m, x, y, z, true); }
  function box(w, h, d) { return new T.BoxGeometry(w, h, d); }
  function cyl(a, b, h, n) { return new T.CylinderGeometry(a, b, h, n || 16); }
  function ball(r, a, b) { return new T.SphereGeometry(r, a || 14, b || 10); }
  function ellipse(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  var FONT = "'Exo 2', 'Lexend', 'Trebuchet MS', sans-serif";   // the game's title font (assets/fonts)

  // A round window cut out of a wall texture, with a frame around it.
  function porthole(ctx, cx, cy, rx, ry, w) {
    [-w, 0, w].forEach(function (dx) {
      ctx.fillStyle = '#6f7891'; ellipse(ctx, cx + dx, cy, rx + 14, ry + 16); ctx.fill();
      ctx.fillStyle = '#b4bccd'; ellipse(ctx, cx + dx, cy, rx + 6, ry + 7); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ellipse(ctx, cx + dx, cy, rx, ry); ctx.fill(); ctx.restore();
    });
  }

  // ---------- the habitat ----------
  function habWall(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h), k, x;
    g.addColorStop(0, '#f6f8fc'); g.addColorStop(0.75, '#e2e7f0'); g.addColorStop(1, '#cfd5e2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(110, 124, 156, 0.4)'; ctx.lineWidth = 3;
    for (k = 0; k < 24; k++) { x = k / 24 * w; ctx.beginPath(); ctx.moveTo(x, h * 0.12); ctx.lineTo(x, h * 0.88); ctx.stroke(); }
    [0.32, 0.52, 0.74].forEach(function (v) { ctx.beginPath(); ctx.moveTo(0, v * h); ctx.lineTo(w, v * h); ctx.stroke(); });
    ctx.fillStyle = 'rgba(110, 124, 156, 0.5)';                      // little rivets where the seams cross
    for (k = 0; k < 24; k++) [0.32, 0.52, 0.74].forEach(function (v) { ellipse(ctx, k / 24 * w, v * h, 3, 3); ctx.fill(); });
    ctx.fillStyle = '#3d7dff'; ctx.fillRect(0, h * 0.875, w, h * 0.028);
    ctx.fillStyle = '#c0c7d6'; ctx.fillRect(0, h * 0.903, w, h * 0.097);
    ctx.fillStyle = 'rgba(70, 80, 104, 0.35)';                       // vents along the floor
    for (k = 0; k < 12; k++) { x = (k + 0.5) / 12 * w; for (var j = 0; j < 4; j++) ctx.fillRect(x - 22, h * 0.93 + j * 7, 44, 3); }
    HAB_WINDOWS.forEach(function (a) {
      var u = (((a + Math.PI / 2) / (Math.PI * 2)) % 1 + 1) % 1;
      porthole(ctx, u * w, h * 0.6, 34, 56, w);
    });
    // the skylight at the very top
    ctx.fillStyle = '#6f7891'; ctx.fillRect(0, h * 0.075, w, h * 0.04);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, w, h * 0.08); ctx.restore();
  }
  function habFloor(ctx, w) {
    var c = w / 2, k, a;
    ctx.fillStyle = '#394155'; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(120, 136, 172, 0.35)'; ctx.lineWidth = 2;
    for (k = -12; k <= 12; k++) {
      for (var j = -12; j <= 12; j++) {                              // hexagon tiles
        var x = c + k * 44 + (j % 2 ? 22 : 0), y = c + j * 38;
        ctx.beginPath();
        for (a = 0; a < 6; a++) { var t = a / 6 * Math.PI * 2 + Math.PI / 6; ctx.lineTo(x + Math.cos(t) * 24, y + Math.sin(t) * 24); }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 10; ellipse(ctx, c, c, w * 0.17, w * 0.17); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.45)'; ctx.lineWidth = 4; ellipse(ctx, c, c, w * 0.2, w * 0.2); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.font = '700 30px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ASTRO OUTPOST', c, c);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; ctx.fillRect(0, 0, w, 6);
  }
  function patchTex(ctx, w) {
    var c = w / 2;
    ctx.fillStyle = '#1b2350'; ellipse(ctx, c, c, c - 6, c - 6); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 12; ellipse(ctx, c, c, c - 12, c - 12); ctx.stroke();
    ctx.fillStyle = JA.pick(site, { moon: '#b9bac6', mars: '#d9774a', sahrun: '#d9a04a' }); ellipse(ctx, c, w * 0.95, w * 0.62, w * 0.3); ctx.fill();
    ctx.fillStyle = '#4aa3ff'; ellipse(ctx, w * 0.72, w * 0.3, 26, 26); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(c, w * 0.18); ctx.lineTo(c + 28, w * 0.5); ctx.lineTo(c - 28, w * 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff5f6d'; ctx.fillRect(c - 28, w * 0.5, 56, 50);
    ctx.fillStyle = '#ffd23f'; ctx.font = '700 34px ' + FONT; ctx.textAlign = 'center';
    ctx.fillText('ASTRO OUTPOST', c, w * 0.8);
  }
  function screen(parent, w, h, x, y, z, ry, tw, th) {
    var t = tex(tw || 512, th || 320, function () {}), m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t, toneMapped: false }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; parent.add(m);
    add(parent, box(w + 0.08, h + 0.08, 0.04), std(0x1b2133, { metalness: 0.3, roughness: 0.5 }), x - Math.sin(ry || 0) * 0.03, y, z - Math.cos(ry || 0) * 0.03).rotation.y = ry || 0;
    return t;
  }
  // which way an object at (x, z) must turn to face the middle of the room
  function faceIn(x, z) { return Math.atan2(-x, -z); }
  function suit(parent, x, y, z, color) {
    var white = std(0xf2f3f7), g = new T.Group(); g.position.set(x, y, z); parent.add(g);
    add(g, new T.CapsuleGeometry(0.28, 0.5, 4, 10), white, 0, 0.75, 0);
    add(g, ball(0.27), white, 0, 1.38, 0);
    var v = add(g, ball(0.21), std(0xffc64a, { metalness: 0.9, roughness: 0.15 }), 0, 1.38, 0.1); v.scale.set(1, 0.8, 0.8);
    add(g, new T.TorusGeometry(0.24, 0.05, 6, 16), std(color), 0, 1.1, 0).rotation.x = Math.PI / 2;
    [-0.36, 0.36].forEach(function (s) { add(g, new T.CapsuleGeometry(0.09, 0.42, 4, 8), white, s, 0.72, 0); });
    [-0.13, 0.13].forEach(function (s) { add(g, new T.CapsuleGeometry(0.1, 0.4, 4, 8), white, s, 0.12, 0); });
    return g;
  }

  function buildHab(parentG) {
    var g = new T.Group(), F = HAB_FLOOR, room = { id: 'hab', group: g, screens: [], spin: [] };
    g.visible = false; parentG.add(g);
    var wallM = new T.MeshStandardMaterial({ map: tex(1024, 512, habWall), side: T.BackSide, alphaTest: 0.5, roughness: 0.85 });
    add(g, new T.SphereGeometry(HAB_R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), wallM, 0, F, 0);
    var floor = add(g, new T.CircleGeometry(HAB_R, 48), std(0xffffff, { map: tex(512, 512, habFloor), roughness: 0.8 }), 0, F + 0.01, 0);
    floor.rotation.x = -Math.PI / 2;
    // a ring of light under the skylight
    add(g, new T.TorusGeometry(1.35, 0.07, 8, 44), W.glow(0xfff4dc, 1.6), 0, F + 3.95, 0).rotation.x = Math.PI / 2;
    [0, 1, 2, 3].forEach(function (k) { var a = k * Math.PI / 2; add(g, cyl(0.012, 0.012, 0.3, 4), std(0x8a93a8), Math.sin(a) * 1.35, F + 4.1, Math.cos(a) * 1.35); });
    // ---- the airlock door (south)
    var dark = std(0x4c5468), steel = std(0x8d96aa, { metalness: 0.4 }), yellow = std(0xffd23f);
    add(g, box(1.9, 2.6, 0.22), steel, 0, F + 1.3, 3.95);
    add(g, box(1.4, 2.2, 0.12), dark, 0, F + 1.12, 3.86);
    var port = add(g, cyl(0.24, 0.24, 0.05, 20), W.glow(0x9fe8ff, 0.8), 0, F + 1.6, 3.79); port.rotation.x = Math.PI / 2;
    add(g, box(1.6, 0.1, 0.06), yellow, 0, F + 0.2, 3.8); add(g, box(1.6, 0.1, 0.06), yellow, 0, F + 2.1, 3.8);
    room.doorLight = add(g, box(0.9, 0.12, 0.08), W.glow(0x4dff9a, 2), 0, F + 2.3, 3.8);
    var sign = tex(256, 64, function (ctx, w, h) { ctx.fillStyle = '#1c2236'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#4dff9a'; ctx.font = '700 38px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('AIRLOCK', w / 2, h / 2 + 2); });
    var sg = add(g, new T.PlaneGeometry(0.9, 0.22), new T.MeshBasicMaterial({ map: sign, toneMapped: false }), 0, F + 2.55, 3.66); sg.rotation.y = Math.PI;
    // ---- structure: ribs across the dome, a cable tray ring, a pipe ring and ventilation ducts
    var rib = std(0xb9c1d3, { metalness: 0.35, roughness: 0.5 }), k;
    [0, 1, 2].forEach(function (i) { var r = add(g, new T.TorusGeometry(4.5, 0.06, 6, 48, Math.PI), rib, 0, F, 0); r.rotation.y = i * Math.PI / 3; });
    add(g, new T.TorusGeometry(3.58, 0.035, 6, 72), std(0x6f7891, { metalness: 0.5, roughness: 0.4 }), 0, F + 2.75, 0).rotation.x = Math.PI / 2;   // cable tray
    add(g, new T.TorusGeometry(4.42, 0.05, 8, 72), std(0x3d7dff, { metalness: 0.4, roughness: 0.35 }), 0, F + 0.3, 0).rotation.x = Math.PI / 2;     // water line
    add(g, new T.TorusGeometry(4.36, 0.05, 8, 72), std(0x8fd6ff, { metalness: 0.4, roughness: 0.35 }), 0, F + 0.42, 0).rotation.x = Math.PI / 2;    // air line
    [0.9, 2.1, 4.2, 5.4].forEach(function (a) {                                                    // vent ducts dropping from the tray
      var x = Math.sin(a) * 3.55, z = Math.cos(a) * 3.55;
      add(g, cyl(0.1, 0.1, 0.9, 10), std(0xaab2c4, { metalness: 0.4 }), x, F + 2.25, z);
      add(g, box(0.32, 0.18, 0.32), std(0x8d96aa, { metalness: 0.4 }), x, F + 1.75, z);
    });
    // ---- bunk beds (west): the living area
    var frame = std(0xdfe3ec), mattress = std(0x5d6b8c), pillow = std(0xffffff);
    [[-0.55, 0xff8a3d], [0.55, 0x3dd6c4]].forEach(function (b, i) {
      [0.45, 1.55].forEach(function (y, j) {
        add(g, box(0.95, 0.12, 1.0), frame, -3.05, F + y - 0.1, b[0]);
        add(g, box(0.86, 0.14, 0.96), mattress, -3.05, F + y + 0.03, b[0]);
        add(g, box(0.88, 0.08, 0.62), std(j ? b[1] : (i ? 0xff8a3d : 0x3dd6c4)), -3.05, F + y + 0.13, b[0] + 0.15);
        add(g, box(0.5, 0.1, 0.24), pillow, -3.15, F + y + 0.15, b[0] - 0.33);
      });
    });
    [[-3.55, -1.05], [-2.55, -1.05], [-3.55, 1.05], [-2.55, 1.05]].forEach(function (p) { add(g, cyl(0.04, 0.04, 1.9, 6), frame, p[0], F + 0.95, p[1]); });
    add(g, box(0.12, 0.08, 0.12), W.glow(0xffe59a, 2), -2.6, F + 1.95, -0.9);       // a reading light
    // a pinboard with photos from home
    var pbY = faceIn(-3.3, 1.75);
    add(g, box(0.9, 0.6, 0.03), std(0x8a6a4a, { roughness: 0.95 }), -3.3, F + 2.0, 1.75).rotation.y = pbY;
    [[-0.28, 0.12, 0x9fd3ff], [0.02, 0.14, 0xffd9a8], [0.28, 0.08, 0xc9f0b5], [-0.1, -0.14, 0xffb3c7]].forEach(function (ph) {
      var m = add(g, box(0.22, 0.17, 0.01), std(ph[2]), -3.3 + Math.cos(pbY) * ph[0] + Math.sin(pbY) * 0.02, F + 2.0 + ph[1], 1.75 - Math.sin(pbY) * ph[0] + Math.cos(pbY) * 0.02);
      m.rotation.y = pbY;
    });
    // ---- Mission Control (north): a curved desk, the panoramic display, two side displays, a switch panel
    var desk = std(0x2a3148, { roughness: 0.6 }), top = std(0xdfe3ec, { roughness: 0.5 });
    add(g, box(2.4, 0.78, 0.7), desk, 0, F + 0.39, -3.55);
    add(g, box(2.5, 0.06, 0.82), top, 0, F + 0.81, -3.5);
    [[-1.95, -3.05, 0.52], [1.95, -3.05, -0.52]].forEach(function (wng) {
      add(g, box(1.4, 0.78, 0.66), desk, wng[0], F + 0.39, wng[1]).rotation.y = wng[2];
      add(g, box(1.5, 0.06, 0.78), top, wng[0], F + 0.81, wng[1]).rotation.y = wng[2];
    });
    add(g, box(4.6, 0.03, 0.05), W.glow(0x4fd8ff, 1.2), 0, F + 0.1, -3.2);            // the light strip under the desk front
    room.screens.push({ id: 'main', t: screen(g, 2.3, 1.0, 0, F + 1.6, -3.88, 0, 1024, 448), every: 0.12 });
    room.screens.push({ id: 'power', t: screen(g, 1.0, 0.62, -2.05, F + 1.36, -3.3, 0.55), every: 1 });
    room.screens.push({ id: 'life', t: screen(g, 1.0, 0.62, 2.05, F + 1.36, -3.3, -0.55), every: 1 });
    // the switch panel: a toggle and an indicator lamp for every machine on the outpost
    add(g, box(1.3, 0.05, 0.36), std(0x1a2033), 0, F + 0.86, -3.3);
    room.leds = [];
    ['air', 'food', 'lab', 'bag', 'comms', 'rover'].forEach(function (id, i) {
      var x = -0.5 + i * 0.2, c = parseInt(JA.MACHINES[id].color.slice(1), 16);
      add(g, box(0.05, 0.08, 0.05), std(0xc9cfdc, { metalness: 0.5 }), x, F + 0.92, -3.22).rotation.x = 0.4;
      room.leds.push({ id: id, m: add(g, cyl(0.025, 0.025, 0.02, 10), W.glow(c, 0.2), x, F + 0.89, -3.38) });
    });
    add(g, cyl(0.07, 0.07, 0.03, 16), W.glow(0xff3b4d, 0.9), 0.75, F + 0.9, -3.3);        // the big red call button
    var hs = add(g, new T.TorusGeometry(0.11, 0.025, 8, 18), dark, -0.85, F + 0.86, -3.28); hs.rotation.x = Math.PI / 2; hs.rotation.z = 0.3;   // a headset
    add(g, cyl(0.03, 0.03, 0.4, 6), steel, 0.45, F + 1.0, -3.45).rotation.z = 0.5; add(g, ball(0.035, 8, 6), W.glow(0x9fe8ff, 0.8), 0.6, F + 1.2, -3.45);   // gooseneck microphone
    var chair = new T.Group(); chair.position.set(0, F, -2.5); g.add(chair);
    add(chair, cyl(0.05, 0.05, 0.45, 8), steel, 0, 0.22, 0);
    add(chair, cyl(0.3, 0.3, 0.08, 18), std(0x3d7dff), 0, 0.48, 0);
    add(chair, box(0.55, 0.55, 0.08), std(0x3d7dff), 0, 0.8, 0.27);
    room.alarm = add(g, cyl(0.07, 0.09, 0.16, 12), W.glow(0xff3b4d, 0.05), 0, F + 2.62, -3.3);     // the rotating alarm beacon over the station
    add(g, cyl(0.1, 0.1, 0.04, 12), std(0x4c5468), 0, F + 2.52, -3.3);
    // ---- science & environment station (north-east): a tall rack with its display, a drum recorder and sample tubes
    var rackY = faceIn(3.2, -1.9), rk = new T.Group(); rk.position.set(3.2, F, -1.9); rk.rotation.y = rackY; g.add(rk);
    add(rk, box(1.1, 2.1, 0.5), std(0xc9cfdc), 0, 1.05, 0);
    add(rk, box(1.0, 0.04, 0.46), std(0x2a3148), 0, 0.85, 0.02);
    room.screens.push({ id: 'env', t: screen(rk, 0.92, 0.58, 0, 1.6, 0.27, 0), every: 1 });
    room.drum = add(rk, cyl(0.12, 0.12, 0.3, 14), std(0xf4f6fa), -0.25, 0.6, 0.18); room.drum.rotation.z = Math.PI / 2;
    add(rk, box(0.02, 0.02, 0.16), std(0xff3b4d), -0.25, 0.73, 0.2);   // the pen
    for (k = 0; k < 6; k++) add(rk, cyl(0.025, 0.025, 0.18, 8), std([0xd98a3a, 0x9fd3ff, 0xc77b4a, 0x8f8fa0, 0xffd23f, 0x7be36a][k], { roughness: 0.3 }), 0.15 + k * 0.07, 0.54, 0.2);
    add(rk, box(0.5, 0.06, 0.2), dark, 0.32, 0.44, 0.2);
    // ---- life-support wall (east): CO₂ scrubber cabinet with filter cartridges, oxygen tanks, the plant shelves, the water recycler
    var scrY = faceIn(3.55, -0.45), sc = new T.Group(); sc.position.set(3.55, F, -0.45); sc.rotation.y = scrY; g.add(sc);
    add(sc, box(0.9, 1.7, 0.55), std(0xdfe3ec), 0, 0.85, 0);
    add(sc, box(0.8, 0.5, 0.04), std(0x2a3148), 0, 1.35, 0.28);
    room.scrubLed = add(sc, cyl(0.03, 0.03, 0.02, 10), W.glow(0x4dff9a, 1.2), 0.3, 1.35, 0.31);
    for (k = 0; k < 3; k++) { var cart = add(sc, cyl(0.1, 0.1, 0.6, 12), std(k ? 0x9fa8bd : 0xffb347, { metalness: 0.3 }), -0.26 + k * 0.26, 0.55, 0.26); cart.rotation.x = Math.PI / 2; cart.scale.z = 0.4; }
    [[-0.62, 0x4dff9a], [-0.86, 0x4dff9a]].forEach(function (tk) { add(sc, cyl(0.12, 0.12, 1.2, 14), std(tk[1], { metalness: 0.4, roughness: 0.3 }), tk[0], 0.6, -0.05); add(sc, ball(0.12, 10, 8), std(tk[1], { metalness: 0.4, roughness: 0.3 }), tk[0], 1.2, -0.05); });
    var shelf = std(0xeceff5), pot = std(0xc77b4a), leaf = std(0x4fd15a), leaf2 = std(0x2fa84a), PZ = 1.35;
    [0.5, 1.15, 1.8].forEach(function (y, row) {
      add(g, box(0.45, 0.05, 2.0), shelf, 3.6, F + y, PZ);
      add(g, box(0.06, 0.03, 1.8), W.glow(0xff58d8, 1.8), 3.5, F + y + 0.55, PZ);
      for (var p = 0; p < 4; p++) {
        var z = PZ - 0.72 + p * 0.48;
        add(g, cyl(0.13, 0.1, 0.18, 10), pot, 3.6, F + y + 0.12, z);
        var bush = add(g, ball(0.17 + ((p + row) % 3) * 0.03, 8, 6), (p + row) % 2 ? leaf : leaf2, 3.6, F + y + 0.3, z);
        bush.scale.y = 0.8; room.spin.push({ m: bush, k: p + row * 4 });
        if ((p + row) % 3 === 0) add(g, ball(0.045, 6, 5), W.glow(0xff4a3a, 0.4), 3.5, F + y + 0.36, z + 0.08);
      }
    });
    [PZ - 0.95, PZ + 0.95].forEach(function (z) { add(g, box(0.06, 1.9, 0.06), shelf, 3.6, F + 0.95, z); });
    var tank = std(0x3d7dff, { metalness: 0.3, roughness: 0.35 });
    add(g, cyl(0.42, 0.42, 1.9, 20), tank, 2.45, F + 0.95, 2.7);
    add(g, cyl(0.07, 0.07, 1.4, 8), W.glow(0x4fd8ff, 1.4), 2.05, F + 0.9, 2.55);                    // the sight glass
    add(g, cyl(0.05, 0.05, 1.6, 8), std(0x3d7dff, { metalness: 0.4 }), 3.1, F + 0.9, 2.0).rotation.z = Math.PI / 2 - 0.5;   // pipe to the plants
    add(g, box(0.3, 0.25, 0.25), std(0x8d96aa, { metalness: 0.5 }), 2.45, F + 2.05, 2.7);          // the recycler pump on top
    // ---- exercise bike (south-east, by a window)
    var bike = new T.Group(); bike.position.set(1.55, F, 2.85); bike.rotation.y = -Math.PI * 0.75; g.add(bike);
    add(bike, box(0.12, 0.08, 1.1), steel, 0, 0.1, 0);
    add(bike, box(0.08, 0.75, 0.08), steel, 0, 0.45, 0.35);
    add(bike, box(0.32, 0.08, 0.2), std(0x2b3147), 0, 0.85, 0.35);
    add(bike, box(0.08, 0.7, 0.08), steel, 0, 0.45, -0.35);
    add(bike, box(0.5, 0.06, 0.06), std(0x2b3147), 0, 0.82, -0.38);
    var wheel = add(bike, new T.TorusGeometry(0.26, 0.05, 8, 20), std(0xff8a3d), 0, 0.32, -0.15); wheel.rotation.y = Math.PI / 2;
    room.wheel = wheel;
    // ---- the suit-up corner beside the airlock (south-west), lockers (north-west) and the food store
    var lockers = std(0xc9cfdc);
    add(g, box(1.3, 1.9, 0.5), lockers, -2.9, F + 0.95, -1.95).rotation.y = -Math.PI / 4;
    var s1 = suit(g, -1.3, F, 3.2, 0xff7a3d), s2 = suit(g, -2.05, F, 2.75, 0x3d9bff);
    s1.rotation.y = -0.35; s2.rotation.y = -0.1;
    add(g, box(0.8, 1.1, 0.4), shelf, -2.85, F + 0.55, 1.85).rotation.y = 1.0;
    for (k = 0; k < 6; k++) add(g, box(0.16, 0.22, 0.1), std([0xff8a3d, 0x7be36a, 0xffd23f][k % 3]), -2.95 + (k % 3) * 0.17, F + 0.55 + Math.floor(k / 3) * 0.4, 1.6 + (k % 3) * 0.14).rotation.y = 1.0;
    // ---- galley table (west of centre)
    var tg = new T.Group(); tg.position.set(-1.25, F, 0.95); g.add(tg);
    add(tg, cyl(0.65, 0.65, 0.06, 28), top, 0, 0.78, 0);
    add(tg, cyl(0.07, 0.12, 0.76, 10), steel, 0, 0.38, 0);
    [0.5, 2.6, 4.7].forEach(function (a) {
      add(tg, cyl(0.2, 0.2, 0.06, 14), std(0xff8a3d), Math.sin(a) * 0.95, 0.48, Math.cos(a) * 0.95);
      add(tg, cyl(0.04, 0.04, 0.45, 6), steel, Math.sin(a) * 0.95, 0.24, Math.cos(a) * 0.95);
      add(tg, box(0.26, 0.04, 0.2), std(0x8fd6ff), Math.sin(a) * 0.42, 0.83, Math.cos(a) * 0.42);       // food trays
    });
    add(tg, cyl(0.06, 0.05, 0.12, 10), std(0xffffff), 0.1, 0.87, 0.1);
    // ---- floor markings: a painted lane from the airlock to the console, the mission patch, a rug
    var lane = add(g, new T.PlaneGeometry(0.9, 5.2), std(0xffd23f, { transparent: true, opacity: 0.16, roughness: 1 }), 0, F + 0.015, 0.6); lane.rotation.x = -Math.PI / 2;
    var patch = add(g, new T.PlaneGeometry(0.85, 0.85), new T.MeshBasicMaterial({ map: tex(256, 256, patchTex), transparent: true }), -3.62, F + 2.1, -1.0);
    patch.rotation.y = faceIn(-3.62, -1.0);
    var rug = add(g, new T.CircleGeometry(0.9, 36), std(0x6a4fd8, { roughness: 0.95 }), -1.25, F + 0.02, 0.95); rug.rotation.x = -Math.PI / 2;

    room.colliders = [[-3.05, -0.55, 0.62], [-3.05, 0.55, 0.62], [0, -3.55, 1.2], [-1.95, -3.05, 0.75], [1.95, -3.05, 0.75], [0, -2.5, 0.33],
      [3.2, -1.9, 0.65], [3.55, -0.45, 0.6], [3.6, 1.35, 0.95], [2.45, 2.7, 0.5], [1.55, 2.85, 0.55], [-2.9, -1.95, 0.75],
      [-1.3, 3.2, 0.35], [-2.05, 2.75, 0.35], [-2.85, 1.85, 0.45], [-1.25, 0.95, 0.75]];
    room.spots = [
      { id: 'door', label: 'Go outside', x: 0, z: 3.05, reach: 1.3 },
      { id: 'bed', label: 'Go to sleep (end the day)', x: -2.2, z: 0, reach: 1.1 },
      { id: 'console', label: 'Mission Control · Earth link', x: 0, z: -2.2, reach: 1.15 },
      { id: 'power', label: 'Power station', x: -1.45, z: -2.35, reach: 0.85 },
      { id: 'life', label: 'Life-support station', x: 1.45, z: -2.35, reach: 0.85 },
      { id: 'science', label: 'Science & environment station', x: 2.45, z: -1.45, reach: 0.95 },
      { id: 'scrubber', label: 'Check the CO₂ scrubber', x: 2.85, z: -0.35, reach: 0.85 },
      { id: 'plants', label: 'Look at the plants', x: 2.75, z: 1.35, reach: 1.0 },
      { id: 'water', label: 'Check the water recycler', x: 1.85, z: 2.2, reach: 0.9 },
      { id: 'bike', label: 'Ride the exercise bike', x: 1.0, z: 2.3, reach: 0.8 },
      { id: 'suits', label: 'Look at the spacesuits', x: -1.4, z: 2.4, reach: 0.9 },
      { id: 'table', label: 'Look at the space food', x: -0.45, z: 0.5, reach: 0.85 },
      { id: 'window', label: 'Look up at the sky', x: 0.6, z: -0.4, reach: 0.9 }
    ];
    room.spawn = [0, 2.35]; room.face = Math.PI;      // just inside the airlock, facing north into the room
    // where the cutaway camera stands and looks, in room coordinates: high over the right shoulder, so the displays fill the frame
    room.view = { pos: [2.9, F + 3.0, 0.3], look: [-0.2, F + 1.3, -3.9] };
    return room;
  }

  // ---------- the rocket ----------
  // A crew cabin about 4.6 m across, modelled on real capsules, in the rocket's own coordinates:
  // +z is the big window (it faces the habitat), -z is the back wall with the ladder up to the docking hatch.
  //   shell   grey close-out panels on aluminium frames and stringers, cable bundles in clamps, handrails
  //   front   a glass cockpit: three displays with bezel keys (fuel, course home, launch), a caution panel,
  //           a shelf of guarded switches and knobs, a breaker panel and the abort handle
  //   middle  two sculpted launch couches on shock struts (the crew lie on their backs, knees up),
  //           hand controllers on the armrests, and a swing-arm display over the crew's faces
  //   left    (-x) life support: oxygen and nitrogen tanks, plumbing, valves, gauges, the CO2 scrubber
  //   right   (+x) fabric stowage bags behind a cargo net; the sample case appears once it is loaded
  // Materials carry generated bump maps and a small reflection map of the cabin, and the walls cast the
  // sun's shadow, so daylight only falls in through the windows. Moon and Mars differ in the accent colour,
  // the course screen and how the propellant is made.
  function accent() { return JA.pick(site, { moon: '#4fd8ff', mars: '#ff9a4d', sahrun: '#ffb347' }); }
  function accentHex() { return parseInt(accent().slice(1), 16); }
  var RK_PX = 512 / (RK_TOP - RK_FLOOR), RK_PXU = 1024 / (Math.PI * 2 * RK_R);   // wall texture pixels per metre: up, around
  function wallY(m) { return 512 - m * RK_PX; }                                    // canvas y of a height above the cabin floor
  var MONO = "ui-monospace, Consolas, 'Courier New', monospace";
  var AV = { bg: '#04070d', line: '#1b2a40', cyan: '#5fe3ff', green: '#5dff9e', amber: '#ffc04d', red: '#ff5468', white: '#e8eefc', dim: '#7f8db0' };
  var geoCache = {}, rkEnv = null, rkEnvSite = '';

  // ---- bump maps: draw heights in grey, turn them into a normal map ----
  function bumpNormal(w, h, draw, strength) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); draw(ctx, w, h);
    var d = ctx.getImageData(0, 0, w, h).data, out = ctx.createImageData(w, h), o = out.data, x, y;
    function H(px, py) { px = (px + w) % w; py = (py + h) % h; return d[(py * w + px) * 4] / 255; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var gx = (H(x + 1, y) - H(x - 1, y)) * strength, gy = (H(x, y - 1) - H(x, y + 1)) * strength;
      var l = Math.sqrt(gx * gx + gy * gy + 1), i = (y * w + x) * 4;
      o[i] = (-gx / l * 0.5 + 0.5) * 255; o[i + 1] = (-gy / l * 0.5 + 0.5) * 255; o[i + 2] = (0.5 / l + 0.5) * 255; o[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    var t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  function repeat(t, x, y) { t.repeat.set(x, y); return t; }
  var N = {};             // shared normal maps, made once
  function normals() {
    if (N.fabric) return N;
    N.fabric = bumpNormal(128, 128, function (ctx, w) {          // a tight basket weave
      for (var y = 0; y < w; y += 8) for (var x = 0; x < w; x += 8) {
        var a = ((x + y) / 8) % 2; ctx.fillStyle = a ? '#a0a0a0' : '#606060'; ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = a ? '#b8b8b8' : '#787878'; ctx.fillRect(x + (a ? 1 : 0), y + (a ? 0 : 1), a ? 6 : 8, a ? 8 : 6);
      }
    }, 2.5);
    N.quilt = bumpNormal(256, 256, function (ctx, w) {           // stitched quilting on the couch cushions
      var g = ctx.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w * 0.6); g.addColorStop(0, '#c0c0c0'); g.addColorStop(1, '#707070');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = '#303030'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, w, w);
      ctx.fillStyle = '#404040'; for (var k = 8; k < w; k += 16) { ctx.fillRect(k, 1, 6, 2); ctx.fillRect(1, k, 2, 6); }
    }, 4);
    N.carbon = bumpNormal(64, 64, function (ctx, w) {
      for (var y = 0; y < w; y += 8) for (var x = 0; x < w; x += 8) {
        var g = ctx.createLinearGradient(x, y, ((x + y) / 8) % 2 ? x + 8 : x, ((x + y) / 8) % 2 ? y : y + 8);
        g.addColorStop(0, '#6a6a6a'); g.addColorStop(0.5, '#a8a8a8'); g.addColorStop(1, '#6a6a6a'); ctx.fillStyle = g; ctx.fillRect(x, y, 8, 8);
      }
    }, 1.5);
    N.brushed = bumpNormal(128, 128, function (ctx, w) {
      for (var y = 0; y < w; y++) { var v = 118 + Math.round(Math.random() * 20); ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; ctx.fillRect(0, y, w, 1); }
    }, 0.6);
    return N;
  }

  // ---- a small reflection map of the cabin itself, so metal and glass reflect a room, not the sky ----
  function cabinEnv() {
    if (rkEnv && rkEnvSite === site) return rkEnv;
    if (rkEnv) { rkEnv.dispose(); rkEnv = null; }
    var r = W.renderer; if (!r || !T.PMREMGenerator) return null;
    try {
      var sc = new T.Scene(), hdr = function (c, k) { return new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k), side: T.BackSide }); };
      sc.add(new T.Mesh(new T.CylinderGeometry(3, 3, 5, 24, 1, true), hdr(0x6b7180, 1)));
      var fl = new T.Mesh(new T.CircleGeometry(3, 24), hdr(0x2a2e36, 1)); fl.rotation.x = -Math.PI / 2; fl.position.y = -2.5; fl.material.side = T.DoubleSide; sc.add(fl);
      var ce = new T.Mesh(new T.CircleGeometry(3, 24), hdr(0x9aa1ae, 1)); ce.rotation.x = Math.PI / 2; ce.position.y = 2.5; ce.material.side = T.DoubleSide; sc.add(ce);
      [[1.2, 0.7], [-1.2, 0.7], [1.2, -0.9], [-1.2, -0.9]].forEach(function (p) {     // ceiling light panels
        var m = new T.Mesh(new T.PlaneGeometry(0.9, 0.5), new T.MeshBasicMaterial({ color: new T.Color(0xf2f6ff).multiplyScalar(5), side: T.DoubleSide }));
        m.rotation.x = Math.PI / 2; m.position.set(p[0], 2.45, p[1]); sc.add(m);
      });
      var win = new T.Mesh(new T.CircleGeometry(0.8, 20), new T.MeshBasicMaterial({ color: new T.Color(JA.pick(site, { moon: 0x8a8c96, mars: 0xe0a070, sahrun: 0xe8c48a })).multiplyScalar(3), side: T.DoubleSide }));
      win.position.set(0, 0.3, 2.95); sc.add(win);
      var scr = new T.Mesh(new T.PlaneGeometry(2.2, 0.5), new T.MeshBasicMaterial({ color: new T.Color(accentHex()).multiplyScalar(1.2), side: T.DoubleSide }));
      scr.position.set(0, -1.4, 2.7); sc.add(scr);
      var pm = new T.PMREMGenerator(r);
      rkEnv = pm.fromScene(sc, 0.02).texture; rkEnvSite = site;
      pm.dispose();
    } catch (e) { rkEnv = null; }
    return rkEnv;
  }

  // physically based material for the cabin: colour, roughness, metalness, optional normal map and extras
  function pbr(color, rough, metal, nmap, extra, envI) {
    var m = new T.MeshStandardMaterial(Object.assign({ color: color, roughness: rough, metalness: metal }, extra || {}));
    if (nmap) { m.normalMap = nmap; m.normalScale = new T.Vector2(1, 1); }
    var env = cabinEnv(); if (env) { m.envMap = env; m.envMapIntensity = envI == null ? 1 : envI; }
    return m;
  }

  // ---- shapes ----
  // A box with rounded vertical edges and softly bevelled faces (cached by size).
  function rbox(w, h, d, r) {
    var key = [w, h, d, r].join(',');
    if (geoCache[key]) return geoCache[key];
    var b = Math.min(0.008, d / 4, w / 6, h / 6), iw = w - 2 * b, ih = h - 2 * b;
    r = Math.max(0.001, Math.min(r == null ? 0.02 : r, iw / 2 - 0.0005, ih / 2 - 0.0005));
    var s = new T.Shape(), x = -iw / 2, y = -ih / 2;
    s.moveTo(x + r, y); s.lineTo(x + iw - r, y); s.quadraticCurveTo(x + iw, y, x + iw, y + r);
    s.lineTo(x + iw, y + ih - r); s.quadraticCurveTo(x + iw, y + ih, x + iw - r, y + ih);
    s.lineTo(x + r, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    var g = new T.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    geoCache[key] = g;
    return g;
  }
  // put: a mesh at a place, optionally rotated; shadow = it casts and takes shadows (the big pieces do)
  function put(parent, geo, m, x, y, z, rx, ry, rz, shadow) {
    var mesh = new T.Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0); mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    if (shadow) { mesh.castShadow = true; mesh.receiveShadow = true; } else mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  // many copies of one small part in a single draw call. list: [x, y, z, rx, ry, rz]
  function inst(parent, geo, m, list) {
    var im = new T.InstancedMesh(geo, m, list.length), o = new T.Object3D();
    list.forEach(function (p, i) { o.position.set(p[0], p[1], p[2]); o.rotation.set(p[3] || 0, p[4] || 0, p[5] || 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; parent.add(im); return im;
  }
  // a pipe or cable along points (in the parent's coordinates)
  function pipe(parent, pts, r, m, seg) {
    var c = new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], p[1], p[2]); }));
    return put(parent, new T.TubeGeometry(c, seg || Math.max(8, pts.length * 8), r, 8, false), m);
  }
  // a point on the cabin wall: angle a (0 = the window, +x side is positive), radius r, height y above the floor
  function onWall(a, r, y) { return [Math.sin(a) * r, RK_FLOOR + y, Math.cos(a) * r]; }
  // a canvas-drawn plate (label, dial, screen) as a flat plane
  function plate(parent, w, h, cw, ch, draw, x, y, z, rx, ry, glow) {
    var t = tex(cw, ch, draw);
    var m = glow ? new T.MeshBasicMaterial({ map: t, toneMapped: false }) : pbr(0xffffff, 0.6, 0, null, { map: t }, 0.4);
    var mesh = put(parent, new T.PlaneGeometry(w, h), m, x, y, z, rx, ry, 0);
    mesh.userData.tex = t; return mesh;
  }
  // a live display: dark bezel, glowing screen and a thin reflective glass in front
  function display(parent, w, h, x, y, z, cw, ch) {
    var g = new T.Group(); g.position.set(x, y, z); parent.add(g);
    put(g, rbox(w + 0.05, h + 0.05, 0.03, 0.012), pbr(0x15181e, 0.5, 0.3, null, null, 0.6), 0, 0, -0.012);
    var t = tex(cw, ch, function () {});
    put(g, new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t, toneMapped: false }), 0, 0, 0.0045);
    put(g, new T.PlaneGeometry(w, h), pbr(0x0b0f14, 0.22, 0.0, null, { transparent: true, opacity: 0.12, depthWrite: false }, 0.6), 0, 0, 0.006);
    g.userData.tex = t;
    return g;
  }

  // ---- the wall: grey close-out panels with seams and fasteners, the windows cut out ----
  // drawn twice with the same layout: once in colour, once in grey as heights for the bump map
  var WALL_ROWS = [0, 0.32, 1.1, 2.45, 3.85, RK_TOP - RK_FLOOR];
  function wallLayout(ctx, w, h, bump) {
    var k, j, rnd = 7;
    function next() { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; }
    ctx.fillStyle = bump ? '#808080' : '#aeb3bc'; ctx.fillRect(0, 0, w, h);
    var cols = 24, cw = w / cols;
    for (j = 0; j < WALL_ROWS.length - 1; j++) {
      var y0 = wallY(WALL_ROWS[j + 1]), y1 = wallY(WALL_ROWS[j]);
      for (k = 0; k < cols; k++) {
        var x0 = k * cw, shade = next();
        if (bump) { ctx.fillStyle = j === 0 ? '#7a7a7a' : '#8c8c8c'; }
        else if (j === 0) ctx.fillStyle = '#3b4049';                                      // kick plates
        else if (j === WALL_ROWS.length - 2) ctx.fillStyle = 'rgb(' + (168 + shade * 10 | 0) + ',' + (173 + shade * 10 | 0) + ',' + (182 + shade * 10 | 0) + ')';
        else ctx.fillStyle = 'rgb(' + (196 + shade * 14 | 0) + ',' + (200 + shade * 14 | 0) + ',' + (207 + shade * 12 | 0) + ')';
        ctx.fillRect(x0 + 2, y0 + 2, cw - 4, y1 - y0 - 4);
        // seams
        ctx.fillStyle = bump ? '#303030' : 'rgba(40,46,58,0.55)';
        ctx.fillRect(x0, y0, cw, 2); ctx.fillRect(x0, y0, 2, y1 - y0);
        // fasteners at the corners and halfway down long panels
        var fy = [y0 + 7, y1 - 7]; if (y1 - y0 > 110) fy.push((y0 + y1) / 2);
        [x0 + 7, x0 + cw - 7].forEach(function (fx) {
          fy.forEach(function (yy) {
            ctx.fillStyle = bump ? '#505050' : 'rgba(70,76,90,0.8)'; ellipse(ctx, fx, yy, 3.2, 3.2); ctx.fill();
            ctx.fillStyle = bump ? '#a0a0a0' : 'rgba(225,228,234,0.9)'; ellipse(ctx, fx, yy, 1.6, 1.6); ctx.fill();
          });
        });
        // small stencilled panel numbers
        if (!bump && j > 0 && j < 4) { ctx.fillStyle = 'rgba(70,78,96,0.6)'; ctx.font = '600 9px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('ABCD'[j - 1] + (k + 1), x0 + 12, y0 + 12); }
      }
    }
    if (!bump) {
      // scuffs on the kick plates, a caution stripe at the top edge
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; for (k = 0; k < 40; k++) ctx.fillRect(next() * w, wallY(0.3) + next() * 28, 10 + next() * 30, 1.5);
      ctx.fillStyle = accent(); ctx.globalAlpha = 0.9; ctx.fillRect(0, wallY(0.32) - 2, w, 3); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2b3140'; ctx.font = '700 15px ' + FONT;
      // the wall is seen from inside, so its texture is mirrored (see buildRocket): u = 0.75 is the -x side here
      ctx.fillText('LIFE SUPPORT', 0.75 * w, wallY(2.95)); ctx.fillText('STOWAGE', 0.25 * w, wallY(2.95));
      ctx.font = '700 13px ' + FONT; ctx.fillText('OUTPOST ONE  ·  ' + JA.pick(site, { moon: 'LUNAR ASCENT VEHICLE', mars: 'MARS ASCENT VEHICLE', sahrun: 'SAHRUN ASCENT VEHICLE' }), 0.5 * w, wallY(4.2));
      [0, w].forEach(function (bx) { ctx.fillText('↑ DOCKING HATCH', bx + (bx ? -70 : 70), wallY(4.2)); });
      // caution label near the hatch
      ctx.fillStyle = '#ffd23f'; rr(ctx, 0.1 * w - 34, wallY(1.45), 68, 22, 3); ctx.fill();
      ctx.fillStyle = '#1d2336'; ctx.font = '700 11px ' + FONT; ctx.fillText('CAUTION HOT', 0.1 * w, wallY(1.45) + 11);
    }
    // windows: a dark gasket round each hole, then the hole itself
    var wins = [[0.5, 1.78, 0.66], [0.5, 3.5, 0.3], [0.375, 1.7, 0.27], [0.625, 1.7, 0.27]];
    wins.forEach(function (wn) {
      [-w, 0, w].forEach(function (dx) {
        var cx = wn[0] * w + dx, cy = wallY(wn[1]);
        ctx.fillStyle = bump ? '#404040' : '#20242c'; ellipse(ctx, cx, cy, (wn[2] + 0.06) * RK_PXU, (wn[2] + 0.06) * RK_PX); ctx.fill();
        if (!bump) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ellipse(ctx, cx, cy, wn[2] * RK_PXU, wn[2] * RK_PX); ctx.fill(); ctx.restore(); }
      });
    });
  }
  function deckLayout(ctx, w, bump) {
    var c = w / 2, k, j;
    ctx.fillStyle = bump ? '#808080' : '#585d67'; ctx.fillRect(0, 0, w, w);
    for (j = 0; j < w; j += 12) for (k = 0; k < w; k += 12) {           // diamond tread
      ctx.save(); ctx.translate(k + ((j / 12) % 2 ? 6 : 0), j); ctx.rotate(((k + j) / 12) % 2 ? 0.7 : -0.7);
      ctx.fillStyle = bump ? '#b0b0b0' : 'rgba(255,255,255,0.07)'; ctx.fillRect(-3.5, -1, 7, 2); ctx.restore();
    }
    ctx.strokeStyle = bump ? '#303030' : 'rgba(20,24,32,0.7)'; ctx.lineWidth = 2;
    [w * 0.25, w * 0.5, w * 0.75].forEach(function (v) { ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, w); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(w, v); ctx.stroke(); });
    for (j = 0; j <= 4; j++) for (k = 0; k <= 4; k++) { ctx.fillStyle = bump ? '#505050' : 'rgba(30,34,42,0.8)'; ellipse(ctx, k * w / 4 + 6, j * w / 4 + 6, 2.5, 2.5); ctx.fill(); }
    if (!bump) { ctx.strokeStyle = accent(); ctx.globalAlpha = 0.7; ctx.lineWidth = 3; ellipse(ctx, c, c, w * 0.475, w * 0.475); ctx.stroke(); ctx.globalAlpha = 1; }
  }
  function ceilingLayout(ctx, w, bump) {
    var c = w / 2, a;
    ctx.fillStyle = bump ? '#808080' : '#a7aeba'; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = bump ? '#303030' : 'rgba(40,46,58,0.5)'; ctx.lineWidth = 2;
    for (a = 0; a < 12; a++) { ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a / 12 * Math.PI * 2) * w, c + Math.sin(a / 12 * Math.PI * 2) * w); ctx.stroke(); }
    [0.25, 0.4].forEach(function (r) { ellipse(ctx, c, c, w * r, w * r); ctx.stroke(); });
  }

  // ---- the cockpit screens: avionics colours, big enough to read ----
  function avFrame(ctx, w, h, title, right) {
    ctx.fillStyle = AV.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = AV.line; ctx.lineWidth = 1;
    for (var x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 44); ctx.lineTo(x, h); ctx.stroke(); }
    for (var y = 44; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = '#0b1424'; ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = AV.cyan; ctx.font = '700 22px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(title, 16, 21);
    if (right) { ctx.textAlign = 'right'; ctx.fillStyle = AV.dim; ctx.font = '600 16px ' + MONO; ctx.fillText(right, w - 14, 21); }
    ctx.textAlign = 'center';
  }
  // the fuel each planet can make for the trip home: [formula, name, "made from" (two lines)]
  var PROPELLANT = {
    moon: { fuel: ['LH₂', 'hydrogen'], from: ['made from', 'polar ice'] },
    mars: { fuel: ['CH₄', 'methane'], from: ['oxygen made from', 'Mars air'] },
    sahrun: { fuel: ['LH₂', 'hydrogen'], from: ['made from', 'well water'] }
  };
  function drawFuel(ctx, w, h, info) {
    var P = JA.pick(info.site, PROPELLANT), full = info.fuel >= 100;
    avFrame(ctx, w, h, 'PROPELLANT', full ? 'FULL' : 'LOADING');
    [['LOX', 'oxygen'], P.fuel].forEach(function (t, i) {
      var x = 70 + i * 120, top = 70, bh = h - 150;
      ctx.strokeStyle = AV.dim; ctx.lineWidth = 2; rr(ctx, x - 30, top, 60, bh, 10); ctx.stroke();
      var fh = (bh - 8) * info.fuel / 100, g = ctx.createLinearGradient(0, top + bh, 0, top);
      g.addColorStop(0, full ? '#1d8f57' : '#8a6514'); g.addColorStop(1, full ? AV.green : AV.amber);
      ctx.fillStyle = g; rr(ctx, x - 26, top + bh - 4 - fh, 52, Math.max(6, fh), 7); ctx.fill();
      for (var k = 1; k < 4; k++) { ctx.fillStyle = AV.dim; ctx.fillRect(x + 32, top + bh * k / 4, 8, 2); }
      ctx.fillStyle = AV.white; ctx.font = '700 20px ' + MONO; ctx.fillText(t[0], x, top + bh + 22);
      ctx.fillStyle = AV.dim; ctx.font = '600 14px ' + FONT; ctx.fillText(t[1], x, top + bh + 44);
    });
    ctx.fillStyle = full ? AV.green : AV.amber; ctx.font = '700 64px ' + MONO; ctx.fillText(info.fuel + '%', w * 0.73, h * 0.42);
    ctx.fillStyle = AV.white; ctx.font = '600 17px ' + FONT;
    ctx.fillText(P.from[0], w * 0.73, h * 0.62);
    ctx.fillText(P.from[1], w * 0.73, h * 0.62 + 22);
    ctx.fillStyle = AV.dim; ctx.font = '600 15px ' + FONT; ctx.fillText(full ? 'tanks full: go' : 'full on launch day', w * 0.73, h * 0.85);
  }
  // where Earth and Mars are on a real date (mean orbits, as in js/spaceweather.js), for the course map
  function planetsOn(dateStr) {
    var d = (Date.parse(dateStr + 'T12:00:00Z') - Date.UTC(2000, 0, 1, 12)) / 86400000;
    function p(L0, rate, peri, a, e) {
      var M = (L0 + rate * d - peri) * Math.PI / 180, v = M + 2 * e * Math.sin(M), r = a * (1 - e * e) / (1 + e * Math.cos(v));
      return { r: r, lon: v + peri * Math.PI / 180 };
    }
    return { earth: p(100.46, 0.98564736, 102.94, 1, 0.0167), mars: p(355.45, 0.52402075, 336.04, 1.5237, 0.0934) };
  }
  function drawCourse(ctx, w, h, info) {
    avFrame(ctx, w, h, 'COURSE HOME', info.date || '');
    var cx = w * 0.36, cy = h * 0.56;
    if (JA.siteOf(info.site).comms === 'orbit' && info.date) {      // the real positions of Earth and Mars
      var P = planetsOn(info.date), k = 72;
      ctx.strokeStyle = AV.line; ctx.lineWidth = 2; ellipse(ctx, cx, cy, k, k); ctx.stroke(); ellipse(ctx, cx, cy, k * 1.52, k * 1.52); ctx.stroke();
      var sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18); sg.addColorStop(0, '#fff6c8'); sg.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = sg; ellipse(ctx, cx, cy, 18, 18); ctx.fill();
      var ex = cx + Math.cos(P.earth.lon) * k * P.earth.r, ey = cy - Math.sin(P.earth.lon) * k * P.earth.r;
      var mx = cx + Math.cos(P.mars.lon) * k * P.mars.r, my = cy - Math.sin(P.mars.lon) * k * P.mars.r;
      ctx.strokeStyle = AV.amber; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#4aa3ff'; ellipse(ctx, ex, ey, 8, 8); ctx.fill();
      ctx.fillStyle = '#d9774a'; ellipse(ctx, mx, my, 7, 7); ctx.fill();
      ctx.fillStyle = AV.white; ctx.font = '600 14px ' + FONT; ctx.fillText('Earth', ex, ey - 16); ctx.fillText('you', mx, my + 18);
    } else {
      ctx.strokeStyle = AV.amber; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(cx - 90, cy + 40); ctx.quadraticCurveTo(cx, cy - 70, cx + 90, cy - 10); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#b9bac6'; ellipse(ctx, cx - 90, cy + 40, 10, 10); ctx.fill();
      ctx.fillStyle = '#4aa3ff'; ellipse(ctx, cx + 90, cy - 10, 22, 22); ctx.fill();
      ctx.fillStyle = '#5fbf6a'; ellipse(ctx, cx + 84, cy - 16, 9, 6); ctx.fill();
      ctx.fillStyle = AV.white; ctx.font = '600 14px ' + FONT; ctx.fillText('you', cx - 90, cy + 66); ctx.fillText('Earth', cx + 90, cy + 26);
    }
    ctx.textAlign = 'left';
    [['DIST', info.km], ['RADIO', info.oneWay + ' one way'], ['TRIP', info.trip]].forEach(function (r, i) {
      var y = 86 + i * 70;
      ctx.fillStyle = AV.dim; ctx.font = '600 15px ' + MONO; ctx.fillText(r[0], w * 0.64, y);
      ctx.fillStyle = AV.white; ctx.font = '700 21px ' + FONT; ctx.fillText(r[1], w * 0.64, y + 26);
    });
    ctx.textAlign = 'center';
  }
  function drawLaunch(ctx, w, h, info) {
    avFrame(ctx, w, h, 'LAUNCH', info.ready ? 'GO' : 'HOLD');
    if (info.ready) {
      ctx.fillStyle = AV.green; ctx.font = '700 72px ' + MONO; ctx.fillText('GO', w / 2, 112);
      ctx.textAlign = 'left'; ctx.font = '700 22px ' + FONT;
      [['crew aboard', true], ['samples ' + (info.caseLoaded ? 'loaded' : 'NOT loaded'), info.caseLoaded], ['propellant full', true]].forEach(function (r, i) {
        ctx.fillStyle = r[1] ? AV.green : AV.red; ctx.fillText((r[1] ? '✔ ' : '✖ ') + r[0], w * 0.18, 186 + i * 40);
      });
      ctx.textAlign = 'center';
    } else {
      ctx.fillStyle = AV.dim; ctx.font = '600 18px ' + MONO; ctx.fillText('T MINUS', w / 2, 82);
      ctx.fillStyle = AV.amber; ctx.font = '700 70px ' + MONO; ctx.fillText(String(info.left), w / 2, 148);
      ctx.fillStyle = AV.white; ctx.font = '700 24px ' + FONT; ctx.fillText(info.dayWord.toUpperCase() + (info.left === 1 ? '' : 'S'), w / 2, 200);
      ctx.fillStyle = AV.dim; ctx.font = '600 16px ' + FONT; ctx.fillText('keep the crew safe until launch day', w / 2, 262);
    }
  }
  function drawAnnun(ctx, w, h, info) {
    ctx.fillStyle = '#0a0d13'; ctx.fillRect(0, 0, w, h);
    var lamps = [['PROP', info.fuel >= 100 ? 'g' : 'a'], ['MAIN BUS', 'g'], ['CABIN P', 'g'], ['COMM', info.comms ? 'g' : 'a'], ['RAD', info.storm === 'active' ? 'r' : info.storm === 'warning' ? 'a' : 'g'], ['SAMPLES', info.caseLoaded ? 'g' : 'a']];
    var col = { g: AV.green, a: AV.amber, r: AV.red }, lw = w / lamps.length;
    lamps.forEach(function (l, k) {
      var x = k * lw;
      ctx.fillStyle = '#141922'; rr(ctx, x + 4, 4, lw - 8, h - 8, 5); ctx.fill();
      var g = ctx.createLinearGradient(0, 8, 0, h - 8); g.addColorStop(0, col[l[1]]); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.globalAlpha = 0.85; ctx.fillStyle = g; rr(ctx, x + 8, 8, lw - 16, h - 16, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#05070b'; ctx.font = '700 17px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l[0], x + lw / 2, h / 2 + 1);
    });
  }
  function drawCabin(ctx, w, h, s) {
    avFrame(ctx, w, h, 'CABIN AIR', 'SEALED');
    ctx.textAlign = 'left';
    [['O₂', 21, AV.cyan], ['N₂', 78, AV.dim]].forEach(function (r, i) {
      var y = 78 + i * 58;
      ctx.fillStyle = AV.white; ctx.font = '700 20px ' + MONO; ctx.fillText(r[0], 16, y);
      ctx.textAlign = 'right'; ctx.fillText('~' + r[1] + '%', w - 16, y); ctx.textAlign = 'left';
      ctx.fillStyle = '#132036'; ctx.fillRect(16, y + 16, w - 32, 12);
      ctx.fillStyle = r[2]; ctx.fillRect(16, y + 16, (w - 32) * r[1] / 100, 12);
    });
    ctx.fillStyle = AV.white; ctx.font = '700 18px ' + MONO; ctx.fillText('CO₂ SCRUB', 16, 214);
    for (var k = 0; k < 8; k++) { ctx.fillStyle = (Math.floor(clock * 4) % 8) === k ? AV.green : '#123322'; ellipse(ctx, w - 150 + k * 18, 214, 6, 6); ctx.fill(); }
    ctx.fillStyle = AV.dim; ctx.font = '600 15px ' + FONT; ctx.fillText(JA.pick(s, { moon: 'outside: no air at all', mars: 'outside: thin CO₂ air', sahrun: 'outside: hot, dry, thick air' }), 16, 250);
  }
  function ascentPanel(ctx, w, h) {
    avFrame(ctx, w, h, 'ASCENT', 'GUIDANCE x3');
    var cx = w * 0.2, cy = h * 0.58, r = h * 0.33, k;
    ctx.save(); ellipse(ctx, cx, cy, r, r); ctx.clip();
    ctx.fillStyle = '#2f62c8'; ctx.fillRect(cx - r, cy - r, r * 2, r);
    ctx.fillStyle = JA.pick(site, { moon: '#55565f', mars: '#8a4428', sahrun: '#a8763a' }); ctx.fillRect(cx - r, cy, r * 2, r);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for (k = -2; k <= 2; k++) if (k) { ctx.beginPath(); ctx.moveTo(cx - 16, cy + k * 18); ctx.lineTo(cx + 16, cy + k * 18); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = AV.dim; ctx.lineWidth = 3; ellipse(ctx, cx, cy, r, r); ctx.stroke();
    ctx.fillStyle = AV.amber; ctx.fillRect(cx - 36, cy - 3, 26, 6); ctx.fillRect(cx + 10, cy - 3, 26, 6); ctx.fillRect(cx - 3, cy - 3, 6, 6);
    ctx.textAlign = 'left'; ctx.font = '600 17px ' + MONO;
    [['ENGINE', 'READY', AV.green], ['GUIDANCE', '3 COMPUTERS', AV.green], ['TARGET', JA.siteOf(site).short.toUpperCase() + ' ORBIT', AV.white], ['CREW', '2', AV.white]].forEach(function (t, i) {
      ctx.fillStyle = AV.dim; ctx.fillText(t[0], w * 0.42, 74 + i * 34); ctx.fillStyle = t[2]; ctx.fillText(t[1], w * 0.66, 74 + i * 34);
    });
  }
  function gaugeFace(ctx, w, label, val) {
    var c = w / 2;
    ctx.fillStyle = '#f2f3f5'; ellipse(ctx, c, c, c - 2, c - 2); ctx.fill();
    ctx.strokeStyle = '#2a2e36'; ctx.lineWidth = 3;
    for (var k = 0; k <= 10; k++) { var a = Math.PI * 0.75 + k / 10 * Math.PI * 1.5; ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * c * 0.72, c + Math.sin(a) * c * 0.72); ctx.lineTo(c + Math.cos(a) * c * 0.88, c + Math.sin(a) * c * 0.88); ctx.stroke(); }
    ctx.strokeStyle = '#2fbf6a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(c, c, c * 0.8, Math.PI * 1.65, Math.PI * 2.1); ctx.stroke();
    var na = Math.PI * 0.75 + val * Math.PI * 1.5; ctx.strokeStyle = '#d22'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(na) * c * 0.75, c + Math.sin(na) * c * 0.75); ctx.stroke();
    ctx.fillStyle = '#2a2e36'; ellipse(ctx, c, c, 6, 6); ctx.fill();
    ctx.font = '700 16px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, c, c * 1.45);
  }

  // ---- a launch couch: a sculpted shell on shock struts; the crew lie on their backs, knees up ----
  // the top surface, side view: [forward (toward the window), height]; the head is at the back
  var COUCH = [[-1.34, 0.84], [-1.05, 0.77], [-0.6, 0.66], [-0.2, 0.58], [0.0, 0.56], [0.14, 0.6], [0.3, 0.8], [0.45, 0.97], [0.58, 0.9], [0.72, 0.78], [0.84, 0.7]];
  // a strip that follows the couch outline between two heights, extruded across the couch
  function couchStrip(lo, hi, width, from, to) {
    var key = ['couch', lo, hi, width, from, to].join(',');
    if (geoCache[key]) return geoCache[key];
    var pts = COUCH.slice(from || 0, to || COUCH.length), s = new T.Shape();
    s.moveTo(pts[0][0], pts[0][1] + lo);
    s.splineThru(pts.map(function (p) { return new T.Vector2(p[0], p[1] + lo); }).slice(1));
    var back = pts.slice().reverse();
    s.lineTo(back[0][0], back[0][1] + hi);
    s.splineThru(back.map(function (p) { return new T.Vector2(p[0], p[1] + hi); }).slice(1));
    s.closePath();
    var b = 0.012, g = new T.ExtrudeGeometry(s, { depth: width - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 12, steps: 1 });
    g.rotateY(-Math.PI / 2); g.translate((width - 2 * b) / 2, 0, 0);       // shape x -> forward (+z), extruded across x
    geoCache[key] = g;
    return g;
  }
  function couch(g, x, cmdr, M) {
    var s = new T.Group(); s.position.set(x, RK_FLOOR, -0.55); g.add(s);
    var inner = x < 0 ? 1 : -1;
    put(s, couchStrip(-0.075, 0.0, 0.64), M.shell, 0, 0, 0, 0, 0, 0, true);                    // the shell under the cushion
    put(s, couchStrip(0.0, 0.075, 0.5), M.cushion, 0, 0, 0, 0, 0, 0, true);                    // the cushion
    [-0.3, 0.3].forEach(function (bx) { put(s, couchStrip(-0.07, 0.17, 0.05, 0, 9), M.shell, bx, 0, 0, 0, 0, 0, 0, true); });   // raised side rails
    // headrest with wings
    put(s, rbox(0.34, 0.11, 0.3, 0.05), M.cushion, 0, 0.9, -1.2, 0.2, 0, 0, true);
    [-0.2, 0.2].forEach(function (bx) { put(s, rbox(0.06, 0.24, 0.3, 0.025), M.shell, bx, 0.94, -1.2, 0.2, 0, 0, true); });
    // foot plate and heel cups
    put(s, rbox(0.5, 0.26, 0.05, 0.02), M.shell, 0, 0.8, 0.9, -0.15, 0, 0, true);
    [-0.11, 0.11].forEach(function (bx) { put(s, rbox(0.16, 0.06, 0.14, 0.03), M.rubber, bx, 0.72, 0.82, 0.5, 0, 0); });
    // shock struts down to floor brackets, with yellow damper sleeves
    [[-0.85, 0.66, 0.14], [-0.1, 0.5, -0.18], [0.5, 0.82, -0.22]].forEach(function (p) {
      var top = new T.Vector3(0, p[1] - 0.07, p[0]), bot = new T.Vector3(0, 0.04, p[0] + p[2]);
      [-0.2, 0.2].forEach(function (bx) {
        var mid = top.clone().add(bot).multiplyScalar(0.5), len = top.distanceTo(bot), ang = Math.atan2(top.z - bot.z, top.y - bot.y);
        put(s, cyl(0.018, 0.018, len, 10), M.steel, bx, mid.y, mid.z, ang, 0, 0);
        put(s, cyl(0.03, 0.03, len * 0.4, 12), M.damper, bx, mid.y - (top.y - bot.y) * 0.12, mid.z - (top.z - bot.z) * 0.12, ang, 0, 0);
        put(s, rbox(0.07, 0.04, 0.1, 0.01), M.alu, bx, 0.02, bot.z);
      });
    });
    // five-point harness and buckle
    [-0.12, 0.12].forEach(function (bx) {
      var st = put(s, couchStrip(0.077, 0.083, 0.055, 1, 5), M.strap, bx, 0, 0); st.position.x = bx;
    });
    put(s, rbox(0.46, 0.008, 0.06, 0.004), M.strap, 0, 0.66, 0.0, -0.1, 0, 0);
    put(s, rbox(0.06, 0.008, 0.3, 0.004), M.strap, 0, 0.72, 0.16, -0.75, 0, 0);
    put(s, cyl(0.045, 0.045, 0.02, 20), M.alu, 0, 0.67, 0.03, 0, 0, 0);
    // armrests; a hand controller on the inside one
    [inner, -inner].forEach(function (side) { put(s, rbox(0.07, 0.05, 0.46, 0.02), M.shell, side * 0.37, 0.78, -0.25, 0.1, 0, 0, true); });
    var hc = new T.Group(); hc.position.set(inner * 0.37, 0.81, -0.04); s.add(hc);
    put(hc, rbox(0.09, 0.03, 0.11, 0.015), M.dark, 0, 0, 0);
    put(hc, cyl(0.03, 0.04, 0.04, 14), M.rubber, 0, 0.03, 0);
    put(hc, new T.CapsuleGeometry(0.022, 0.07, 4, 10), M.grip, 0, 0.09, 0.01, 0.25, 0, 0);
    put(hc, ball(0.012, 8, 6), cmdr ? W.glow(0xffc04d, 0.6) : M.dark, 0, 0.14, 0.02);
    return s;
  }

  function buildRocket(rk) {
    var g = new T.Group(), F = RK_FLOOR, H = RK_TOP - RK_FLOOR, room = { id: 'rocket', group: g, screens: [], spin: [] }, k;
    g.visible = false; rk.add(g);
    var nm = normals(), acc = accentHex();
    var M = {
      shell: pbr(0x2c3038, 0.42, 0.25, repeat(nm.carbon.clone(), 30, 30), null, 0.8),
      cushion: pbr(0x3a4763, 0.92, 0.0, repeat(nm.quilt.clone(), 6, 6), null, 0.5),
      strap: pbr(0xe0742e, 0.85, 0.0, repeat(nm.fabric.clone(), 20, 20), null, 0.4),
      rubber: pbr(0x16181d, 0.95, 0.0, null, null, 0.3),
      dark: pbr(0x1e2229, 0.55, 0.3, null, null, 0.7),
      console: pbr(0x2a2f38, 0.6, 0.25, null, null, 0.7),
      steel: pbr(0xb7bec9, 0.28, 0.9, repeat(nm.brushed.clone(), 2, 8), null, 1.2),
      alu: pbr(0xc9ced6, 0.35, 0.85, repeat(nm.brushed.clone(), 4, 4), null, 1.1),
      aluD: pbr(0xc9ced6, 0.35, 0.85, null, { side: T.DoubleSide }, 1.1),
      damper: pbr(0xe8b72c, 0.45, 0.4, null, null, 0.8),
      grip: pbr(0x23262c, 0.75, 0.0, repeat(nm.fabric.clone(), 4, 4), null, 0.4),
      rail: pbr(0x3a5b8f, 0.35, 0.3, null, null, 0.9),
      frame: pbr(0x9aa3b1, 0.4, 0.8, repeat(nm.brushed.clone(), 1, 6), null, 1.0),
      fabric: pbr(0xe7e2d3, 0.96, 0.0, repeat(nm.fabric.clone(), 8, 8), null, 0.35),
      web: pbr(0x5b616d, 0.9, 0.0, repeat(nm.fabric.clone(), 10, 10), null, 0.3),
      cableA: pbr(0x23262c, 0.6, 0.0, null, null, 0.5), cableB: pbr(0x8b929e, 0.5, 0.2, null, null, 0.6), cableC: pbr(0xd9dde3, 0.55, 0.0, null, null, 0.5),
      tankO: pbr(0x2f6fd6, 0.32, 0.35, null, null, 1.0), tankN: pbr(0xdcdfe5, 0.3, 0.35, null, null, 1.0),
      key: pbr(0x3b414c, 0.5, 0.2, null, null, 0.6), red: pbr(0xc81e2c, 0.4, 0.1, null, null, 0.8)
    };
    room.M = M;

    // ---- the shell: wall, deck and ceiling, all with bump maps; the wall casts the sun's shadow
    var wallMap = tex(1024, 512, function (ctx, w, h) { wallLayout(ctx, w, h, false); });
    var wallN = bumpNormal(1024, 512, function (ctx, w, h) { wallLayout(ctx, w, h, true); }, 3);
    [wallMap, wallN].forEach(function (t) { t.wrapS = T.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; });   // seen from inside: mirror it so writing reads the right way
    var wall = pbr(0xffffff, 0.62, 0.12, wallN, { map: wallMap, side: T.BackSide, alphaTest: 0.5 }, 0.7);
    var wm = put(g, new T.CylinderGeometry(RK_R, RK_R, H, 64, 1, true, Math.PI), wall, 0, F + H / 2, 0, 0, 0, 0, true);
    wm.castShadow = true;
    var deck = put(g, new T.CircleGeometry(RK_R, 64), pbr(0xffffff, 0.55, 0.55, bumpNormal(512, 512, function (ctx, w) { deckLayout(ctx, w, true); }, 4), { map: tex(512, 512, function (ctx, w) { deckLayout(ctx, w, false); }) }, 0.9), 0, F + 0.01, 0, -Math.PI / 2, 0, 0, true);
    deck.castShadow = true;
    var ceil = put(g, new T.CircleGeometry(RK_R, 64), pbr(0xffffff, 0.7, 0.1, bumpNormal(512, 512, function (ctx, w) { ceilingLayout(ctx, w, true); }, 3), { map: tex(512, 512, function (ctx, w) { ceilingLayout(ctx, w, false); }) }, 0.6), 0, RK_TOP - 0.01, 0, Math.PI / 2, 0, 0, true);
    ceil.castShadow = true;
    // aluminium ring frames and stringers, standing a little off the wall
    [0.33, 2.62, 4.0].forEach(function (y) { put(g, new T.TorusGeometry(RK_R - 0.07, 0.035, 4, 72), M.frame, 0, F + y, 0, Math.PI / 2, 0, Math.PI / 4); });
    [30, 60, 90, 120, 150, 210, 240, 270, 300, 330].forEach(function (deg) {
      var a = deg * Math.PI / 180, p = onWall(a, RK_R - 0.06, H / 2);
      put(g, rbox(0.06, H - 0.1, 0.07, 0.01), M.frame, p[0], p[1], p[2], 0, a, 0);
    });
    // cable bundles in clamps along both sides, just above the upper frame
    [[0.6, 2.6], [-0.6, -2.6]].forEach(function (run) {
      var steps = 14, pts = [[], [], []];
      for (k = 0; k <= steps; k++) {
        var a = run[0] + (run[1] - run[0]) * k / steps;
        [0, 1, 2].forEach(function (j) { var p = onWall(a, RK_R - 0.12 - j * 0.03, 2.78 + j * 0.035); pts[j].push(p); });
      }
      put(g, new T.TubeGeometry(new T.CatmullRomCurve3(pts[0].map(function (p) { return new T.Vector3(p[0], p[1], p[2]); })), 60, 0.022, 8), M.cableA);
      put(g, new T.TubeGeometry(new T.CatmullRomCurve3(pts[1].map(function (p) { return new T.Vector3(p[0], p[1], p[2]); })), 60, 0.016, 8), M.cableB);
      put(g, new T.TubeGeometry(new T.CatmullRomCurve3(pts[2].map(function (p) { return new T.Vector3(p[0], p[1], p[2]); })), 60, 0.012, 8), M.cableC);
      var clamps = [];
      for (k = 1; k < steps; k += 2) { var a2 = run[0] + (run[1] - run[0]) * k / steps, cp = onWall(a2, RK_R - 0.14, 2.82); clamps.push([cp[0], cp[1], cp[2], 0, a2, 0]); }
      inst(g, rbox(0.03, 0.13, 0.1, 0.008), M.alu, clamps);
    });
    // handrails: blue bars on stand-offs, beside the window and by the ladder
    function handrail(a, y, len, vertical) {
      var p = onWall(a, RK_R - 0.16, y), hr = new T.Group(); hr.position.set(p[0], p[1], p[2]); hr.rotation.y = a; g.add(hr);
      put(hr, new T.CapsuleGeometry(0.018, len, 4, 10), M.rail, 0, 0, 0, vertical ? 0 : 0, 0, vertical ? 0 : Math.PI / 2);
      [-len / 2 + 0.03, len / 2 - 0.03].forEach(function (o) { put(hr, rbox(0.035, 0.035, 0.1, 0.01), M.alu, vertical ? 0 : o, vertical ? o : 0, 0.05); });
    }
    handrail(0.5, 2.1, 0.5, true); handrail(-0.5, 2.1, 0.5, true);
    handrail(Math.PI - 0.32, 1.6, 0.7, true); handrail(Math.PI + 0.32, 1.6, 0.7, true);
    // windows: deep frames with bolts, and a faint glass you can see your reflection in
    function windowFrame(a, y, r) {
      var p = onWall(a, RK_R - 0.1, y), wg = new T.Group(); wg.position.set(p[0], p[1], p[2]); wg.rotation.y = a + Math.PI; g.add(wg);
      var prof = [[r + 0.015, -0.1], [r + 0.015, 0.02], [r + 0.04, 0.06], [r + 0.13, 0.07], [r + 0.16, 0.04], [r + 0.16, -0.1]].map(function (q) { return new T.Vector2(q[0], q[1]); });
      put(wg, new T.LatheGeometry(prof, 48), M.aluD, 0, 0, 0, Math.PI / 2, 0, 0);
      var bolts = []; for (var i = 0; i < 16; i++) { var b = i / 16 * Math.PI * 2; bolts.push([Math.cos(b) * (r + 0.1), Math.sin(b) * (r + 0.1), 0.07, Math.PI / 2, 0, 0]); }
      inst(wg, cyl(0.009, 0.009, 0.012, 6), M.steel, bolts);
      put(wg, new T.CircleGeometry(r + 0.02, 40), pbr(0x9fb4c8, 0.03, 0, null, { transparent: true, opacity: 0.1, depthWrite: false }, 1.6), 0, 0, -0.04);
    }
    windowFrame(0, 1.78, 0.66); windowFrame(0, 3.5, 0.3); windowFrame(-Math.PI / 4, 1.7, 0.27); windowFrame(Math.PI / 4, 1.7, 0.27);
    // lights: four LED panels in the ceiling and a soft strip round the deck
    [[0.95, 0.55], [-0.95, 0.55], [0.95, -0.65], [-0.95, -0.65]].forEach(function (p) {
      put(g, rbox(0.62, 0.32, 0.03, 0.03), M.alu, p[0], RK_TOP - 0.03, p[1], Math.PI / 2, 0, 0);
      put(g, new T.PlaneGeometry(0.56, 0.26), W.glow(0xf3f7ff, 0.85), p[0], RK_TOP - 0.048, p[1], Math.PI / 2, 0, 0);
    });
    put(g, new T.TorusGeometry(RK_R - 0.09, 0.012, 4, 96), W.glow(acc, 0.55), 0, F + 0.33, 0, Math.PI / 2, 0, 0);
    // the deck hatch you climbed up through, in a ring with hazard stripes
    var hz = tex(512, 32, function (ctx, w, h) { for (var i = 0; i < 32; i++) { ctx.fillStyle = i % 2 ? '#f2c230' : '#1b1e25'; ctx.beginPath(); ctx.moveTo(i * 16, 0); ctx.lineTo(i * 16 + 16, 0); ctx.lineTo(i * 16 + 8, h); ctx.lineTo(i * 16 - 8, h); ctx.closePath(); ctx.fill(); } });
    put(g, new T.RingGeometry(0.42, 0.56, 48), pbr(0xffffff, 0.6, 0.1, null, { map: hz }, 0.5), 0, F + 0.017, 0, -Math.PI / 2, 0, 0);
    put(g, new T.TorusGeometry(0.42, 0.018, 8, 48), M.alu, 0, F + 0.02, 0, Math.PI / 2, 0, 0);
    put(g, new T.CapsuleGeometry(0.014, 0.22, 4, 8), M.rail, 0, F + 0.035, 0.2, 0, 0, Math.PI / 2);

    // ---- front: the glass cockpit
    put(g, rbox(2.36, 0.62, 0.56, 0.06), M.console, 0, F + 0.31, 1.86, 0, 0, 0, true);
    // seen from the couches, +x is on the left: fuel on the left, course in the middle, launch on the right
    var DSP = [{ id: 'rk-fuel', x: 0.8, z: 1.5, yaw: 0.5 }, { id: 'rk-course', x: 0, z: 1.66, yaw: 0 }, { id: 'rk-launch', x: -0.8, z: 1.5, yaw: -0.5 }];
    DSP.forEach(function (d, i) {
      var fg = new T.Group(); fg.position.set(d.x, F + 0.98, d.z); fg.rotation.order = 'YXZ'; fg.rotation.set(-0.55, Math.PI + d.yaw, 0); g.add(fg);
      put(fg, rbox(0.8, 0.66, 0.09, 0.03), M.console, 0, 0, -0.05, 0, 0, 0, true);
      var dsp = display(fg, 0.6, 0.375, 0, 0.04, 0, 640, 400);
      room.screens.push({ id: d.id, t: dsp.userData.tex });
      // bezel keys round the display, as on a real multi-function display
      var keys = [];
      for (k = 0; k < 6; k++) keys.push([-0.25 + k * 0.1, -0.215, 0.006]);
      for (k = 0; k < 4; k++) { keys.push([-0.355, 0.17 - k * 0.09, 0.006]); keys.push([0.355, 0.17 - k * 0.09, 0.006]); }
      inst(fg, rbox(0.05, 0.034, 0.018, 0.006), M.key, keys);
      inst(fg, new T.PlaneGeometry(0.03, 0.004), W.glow(0x7fe8ff, 0.5), keys.map(function (p) { return [p[0], p[1] + 0.006, 0.0165]; }));
      inst(fg, cyl(0.008, 0.008, 0.008, 6), M.steel, [[-0.37, 0.3, 0.0, Math.PI / 2], [0.37, 0.3, 0.0, Math.PI / 2], [-0.37, -0.3, 0.0, Math.PI / 2], [0.37, -0.3, 0.0, Math.PI / 2]]);
      if (i === 1) {      // the caution and warning panel above the middle display
        var an = put(fg, new T.PlaneGeometry(0.62, 0.07), new T.MeshBasicMaterial({ map: tex(768, 88, function () {}), toneMapped: false }), 0, 0.29, 0.006);
        put(fg, rbox(0.66, 0.1, 0.02, 0.01), M.dark, 0, 0.29, -0.004);
        room.screens.push({ id: 'rk-annun', t: an.material.map });
      }
    });
    // the switch shelf: guarded toggles, knobs, and the abort handle
    var shelf = new T.Group(); shelf.position.set(0, F + 0.62, 1.4); shelf.rotation.x = -0.18; g.add(shelf);
    put(shelf, rbox(2.06, 0.05, 0.26, 0.02), M.console, 0, 0, 0, 0, 0, 0, true);
    var sl = put(shelf, new T.PlaneGeometry(2.0, 0.22), pbr(0xffffff, 0.7, 0.1, null, { map: tex(1024, 112, function (ctx, w, h) {
      ctx.fillStyle = '#2a2f38'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d7dce6'; ctx.font = '700 15px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ['MAIN A', 'MAIN B', 'CAB FAN', 'O₂ FLOW', 'COMM', 'LIGHTS', 'HEATERS', 'PUMPS'].forEach(function (t, i) { ctx.fillText(t, 70 + i * 92, 14); });
      ctx.strokeStyle = '#d7dce6'; ctx.lineWidth = 2; ctx.strokeRect(20, 26, 740, 76);
      ctx.fillText('CABIN', 830, 14); ctx.fillText('VOLUME', 920, 14);
    }) }, 0.4), 0, 0.027, 0, -Math.PI / 2, 0, 0);
    sl.rotation.z = Math.PI;
    var bases = [], bats = [], guards = [];
    for (k = 0; k < 8; k++) {
      var sx = 0.89 - k * 0.18;                 // the label strip is turned round, so switches count from +x
      bases.push([sx, 0.035, 0.0]);
      bats.push([sx, 0.06, 0.0, (k % 3 ? 0.45 : -0.45), 0, 0]);
      if (k < 2) { guards.push([sx - 0.028, 0.06, 0.0]); guards.push([sx + 0.028, 0.06, 0.0]); }
    }
    inst(shelf, rbox(0.045, 0.02, 0.045, 0.006), M.dark, bases);
    inst(shelf, cyl(0.006, 0.004, 0.05, 8), M.steel, bats);
    inst(shelf, rbox(0.006, 0.045, 0.06, 0.002), M.red, guards);
    [[-0.66, 0.0], [-0.84, 0.0]].forEach(function (p) {
      var kn = new T.Group(); kn.position.set(p[0], 0.04, p[1]); shelf.add(kn);
      put(kn, cyl(0.03, 0.034, 0.03, 20), M.dark, 0, 0, 0);
      put(kn, rbox(0.006, 0.006, 0.026, 0.002), W.glow(0xffffff, 0.5), 0, 0.016, 0.01);
    });
    // abort: a striped housing, a red T-handle and a placard
    var ab = new T.Group(); ab.position.set(0.92, F + 0.66, 1.26); g.add(ab);
    var hzT = tex(128, 64, function (ctx, w, h) { for (var i = -4; i < 12; i++) { ctx.fillStyle = i % 2 ? '#f2c230' : '#1b1e25'; ctx.beginPath(); ctx.moveTo(i * 16, 0); ctx.lineTo(i * 16 + 16, 0); ctx.lineTo(i * 16 + 48, h); ctx.lineTo(i * 16 + 32, h); ctx.closePath(); ctx.fill(); } });
    put(ab, rbox(0.24, 0.07, 0.16, 0.02), pbr(0xffffff, 0.5, 0.1, null, { map: hzT }, 0.5), 0, 0, 0, 0, 0, 0, true);
    put(ab, cyl(0.012, 0.012, 0.06, 10), M.steel, 0, 0.06, 0);
    var abortH = put(ab, new T.CapsuleGeometry(0.018, 0.11, 4, 10), W.glow(0xd8202e, 0.45), 0, 0.095, 0, 0, 0, Math.PI / 2);
    room.abort = abortH;
    plate(ab, 0.14, 0.035, 256, 64, function (ctx, w, h) { ctx.fillStyle = '#c81e2c'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = '700 40px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ABORT', w / 2, h / 2 + 2); }, 0, 0.037, 0.06, -Math.PI / 2, 0).rotation.z = Math.PI;
    // a breaker panel on the front of the console, facing the crew
    var bp = new T.Group(); bp.position.set(0, F + 0.4, 1.575); bp.rotation.y = Math.PI; g.add(bp);
    put(bp, rbox(1.5, 0.2, 0.02, 0.01), M.dark, 0, 0, 0);
    var brk = []; for (k = 0; k < 22; k++) brk.push([-0.68 + k * 0.065, -0.02, 0.015, Math.PI / 2, 0, 0]);
    inst(bp, cyl(0.011, 0.011, 0.022, 10), M.dark, brk);
    inst(bp, cyl(0.006, 0.006, 0.026, 8), pbr(0xe8e8e8, 0.4, 0.1, null, null, 0.5), brk.map(function (p) { return [p[0], p[1], p[2] + 0.004, Math.PI / 2, 0, 0]; }));
    plate(bp, 1.46, 0.05, 1024, 36, function (ctx, w, h) { ctx.fillStyle = '#1e2229'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#cfd5e1'; ctx.font = '600 18px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('CIRCUIT BREAKERS  ·  MAIN BUS A / B  ·  DO NOT RESET TWICE', 14, h / 2); }, 0, 0.065, 0.011);

    // ---- middle: two couches and the hand-controller pedestal between them
    couch(g, -0.72, true, M); couch(g, 0.72, false, M);
    put(g, rbox(0.26, 0.5, 0.44, 0.04), M.console, 0, F + 0.25, -0.95, 0, 0, 0, true);
    plate(g, 0.2, 0.3, 128, 192, function (ctx, w, h) {
      ctx.fillStyle = '#14181f'; ctx.fillRect(0, 0, w, h);
      for (var r = 0; r < 4; r++) for (var c = 0; c < 3; c++) { ctx.fillStyle = '#3b414c'; rr(ctx, 14 + c * 36, 50 + r * 34, 28, 26, 5); ctx.fill(); ctx.fillStyle = '#9fe8ff'; ctx.font = '700 14px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('123456789*0#'[r * 3 + c], 28 + c * 36, 63 + r * 34); }
      ctx.fillStyle = '#5dff9e'; ctx.fillRect(14, 16, 100, 22);
    }, 0, F + 0.505, -0.95, -Math.PI / 2, 0, true);
    // the swing-arm display over the couches, angled down at the crew's faces
    pipe(g, [[0, RK_TOP - 0.02, -0.8], [0, RK_TOP - 0.6, -0.8], [0, F + 2.62, -0.78]], 0.025, M.alu, 16);
    put(g, cyl(0.06, 0.06, 0.06, 16), M.dark, 0, RK_TOP - 0.04, -0.8);
    put(g, ball(0.045, 12, 8), M.dark, 0, F + 2.6, -0.78);
    var asc = new T.Group(); asc.position.set(0, F + 2.4, -0.8); g.add(asc);
    put(asc, rbox(1.2, 0.44, 0.06, 0.03), M.console, 0, 0, -0.035, 0, 0, 0, true);
    var ad = display(asc, 1.08, 0.33, 0, 0, 0, 768, 236);
    var au = ad.userData.tex.userData; ascentPanel(au.ctx, au.canvas.width, au.canvas.height); ad.userData.tex.needsUpdate = true;
    faceTo(room, asc, 0, F + 0.85, -1.75);

    // ---- back: the ladder and the docking hatch in the ceiling
    var lad = new T.Group(); lad.position.set(0, F, -2.1); g.add(lad);
    [-0.22, 0.22].forEach(function (x) { put(lad, cyl(0.022, 0.022, H - 0.2, 12), M.alu, x, (H - 0.2) / 2 + 0.05, 0); });
    var rungs = []; for (var y = 1.15; y < H - 0.3; y += 0.3) rungs.push([0, y, 0, 0, 0, Math.PI / 2]);
    inst(lad, cyl(0.016, 0.016, 0.44, 10), M.steel, rungs);
    var dh = new T.Group(); dh.position.set(0, RK_TOP, -1.5); g.add(dh);
    put(dh, new T.CylinderGeometry(0.5, 0.5, 0.3, 40, 1, true), pbr(0x8b929e, 0.45, 0.6, null, { side: T.BackSide }, 1), 0, 0.13, 0);
    put(dh, new T.TorusGeometry(0.5, 0.035, 8, 48), M.alu, 0, -0.02, 0, Math.PI / 2, 0, 0);
    put(dh, new T.CircleGeometry(0.47, 40), pbr(0x6f7786, 0.45, 0.6, repeat(nm.brushed.clone(), 3, 3), null, 1), 0, 0.27, 0, Math.PI / 2, 0, 0);
    put(dh, new T.TorusGeometry(0.17, 0.018, 8, 28), M.rail, 0, 0.22, 0, Math.PI / 2, 0, 0);
    [0, Math.PI / 3, -Math.PI / 3].forEach(function (a) { put(dh, rbox(0.34, 0.015, 0.02, 0.005), M.steel, 0, 0.225, 0, 0, a, 0); });
    var dogs = []; for (k = 0; k < 8; k++) { var da = k / 8 * Math.PI * 2; dogs.push([Math.cos(da) * 0.43, 0.24, Math.sin(da) * 0.43, 0, -da, 0]); }
    inst(dh, rbox(0.06, 0.03, 0.04, 0.008), M.steel, dogs);

    // ---- left wall (-x): life support
    var ls = new T.Group(); ls.position.set(-1.98, F, 0.05); ls.rotation.y = Math.PI / 2; g.add(ls);
    put(ls, rbox(1.24, 1.72, 0.16, 0.03), pbr(0xc9cdd4, 0.55, 0.2, null, null, 0.8), 0, 1.18, 0.02, 0, 0, 0, true);
    var tankProf = [[0, -0.48], [0.07, -0.47], [0.115, -0.42], [0.125, -0.34], [0.125, 0.34], [0.115, 0.42], [0.07, 0.47], [0, 0.48]].map(function (q) { return new T.Vector2(q[0], q[1]); });
    [[-0.42, M.tankO, 'O₂'], [-0.12, M.tankN, 'N₂']].forEach(function (t) {
      put(ls, new T.LatheGeometry(tankProf, 28), t[1], t[0], 1.12, 0.22, 0, 0, 0, true);
      [0.82, 1.42].forEach(function (yy) { put(ls, new T.TorusGeometry(0.128, 0.012, 6, 28), M.alu, t[0], yy, 0.22, Math.PI / 2, 0, 0); });
      put(ls, cyl(0.03, 0.03, 0.08, 12), M.steel, t[0], 1.63, 0.22);
      plate(ls, 0.11, 0.06, 128, 64, function (ctx, w, h) { ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1e2229'; ctx.font = '700 40px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t[2], w / 2, h / 2 + 2); }, t[0], 1.2, 0.347);
      pipe(ls, [[t[0], 1.66, 0.22], [t[0], 1.78, 0.2], [t[0] * 0.3 + 0.12, 1.84, 0.17], [0.18, 1.84, 0.15]], 0.012, M.steel);
    });
    put(ls, rbox(0.34, 0.14, 0.1, 0.02), M.alu, 0.32, 1.84, 0.14, 0, 0, 0, true);
    [0.22, 0.42].forEach(function (vx) {
      var v = new T.Group(); v.position.set(vx, 1.84, 0.21); ls.add(v);
      put(v, cyl(0.012, 0.012, 0.05, 8), M.steel, 0, 0, -0.01, Math.PI / 2, 0, 0);
      put(v, new T.TorusGeometry(0.035, 0.008, 6, 20), M.red, 0, 0, 0.02);
      [0, Math.PI / 2].forEach(function (a) { put(v, rbox(0.07, 0.006, 0.006, 0.002), M.red, 0, 0, 0.02, 0, 0, a); });
    });
    [[0.22, 0.75], [0.42, 0.55]].forEach(function (gp) {
      put(ls, cyl(0.05, 0.05, 0.03, 24), M.alu, gp[0], 1.58, 0.13, Math.PI / 2, 0, 0);
      plate(ls, 0.086, 0.086, 128, 128, function (ctx, w) { gaugeFace(ctx, w, 'PSI', gp[1]); }, gp[0], 1.58, 0.146);
    });
    var cab = display(ls, 0.36, 0.25, 0.32, 1.28, 0.115, 400, 280);
    room.screens.push({ id: 'cabin', t: cab.userData.tex });
    put(ls, rbox(0.44, 0.38, 0.04, 0.02), M.dark, 0.3, 0.72, 0.12, 0, 0, 0, true);
    [[0.3, 0.895, 0.44, 0.03], [0.3, 0.545, 0.44, 0.03]].forEach(function (b) { put(ls, rbox(b[2], b[3], 0.1, 0.008), M.dark, b[0], b[1], 0.16); });
    [[0.095, 0.03], [0.505, 0.03]].forEach(function (b) { put(ls, rbox(b[1], 0.38, 0.1, 0.008), M.dark, b[0], 0.72, 0.16); });
    var slats = []; for (k = 0; k < 7; k++) slats.push([0.3, 0.585 + k * 0.045, 0.2, -0.5, 0, 0]);
    inst(ls, rbox(0.38, 0.008, 0.035, 0.003), M.alu, slats);
    var fan = new T.Group(); fan.position.set(0.3, 0.72, 0.16); ls.add(fan);
    for (k = 0; k < 6; k++) put(fan, rbox(0.03, 0.15, 0.006, 0.004), M.steel, Math.sin(k / 6 * Math.PI * 2) * 0.07, Math.cos(k / 6 * Math.PI * 2) * 0.07, 0, 0, 0.3, -k / 6 * Math.PI * 2);
    room.fan = fan;
    plate(ls, 0.3, 0.05, 256, 44, function (ctx, w, h) { ctx.fillStyle = '#1e2229'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#5dff9e'; ctx.font = '700 22px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CO₂ SCRUBBER', w / 2, h / 2 + 1); }, 0.3, 0.97, 0.181);

    // ---- right wall (+x): fabric stowage bags behind a cargo net; the sample case appears when it is loaded
    var sg = new T.Group(); sg.position.set(1.98, F, 0.05); sg.rotation.y = -Math.PI / 2; g.add(sg);
    put(sg, rbox(1.3, 1.9, 0.08, 0.03), pbr(0xb9bec7, 0.6, 0.2, null, null, 0.7), 0, 1.1, -0.02, 0, 0, 0, true);
    var BAGS = [[-0.33, 0.32, 0.58, 0.44, 'FOOD'], [0.31, 0.3, 0.6, 0.4, 'WATER'], [-0.33, 0.82, 0.58, 0.48, 'MEDICAL'], [0.31, 0.78, 0.6, 0.44, 'TOOLS'], [-0.33, 1.34, 0.58, 0.46, 'SPARES'], [0.31, 1.27, 0.6, 0.44, 'CAMERA'], [0, 1.78, 1.2, 0.36, 'CLOTHES']];
    BAGS.forEach(function (b, i) {
      var depth = 0.26 + (i % 3) * 0.03;
      put(sg, rbox(b[2] - 0.03, b[3] - 0.03, depth, 0.06), M.fabric, b[0], b[1], depth / 2 + 0.02, 0, 0, 0, true);
      [-0.3, 0.3].forEach(function (o) { put(sg, rbox(0.04, b[3] - 0.02, 0.008, 0.003), M.web, b[0] + o * (b[2] - 0.1), b[1], depth + 0.024); });
      plate(sg, 0.2, 0.06, 256, 76, function (ctx, w, h) { ctx.fillStyle = '#f4efe2'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#1e2229'; ctx.lineWidth = 3; ctx.strokeRect(3, 3, w - 6, h - 6); ctx.fillStyle = '#1e2229'; ctx.font = '700 34px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b[4], w / 2, h / 2 + 2); }, b[0], b[1] + 0.05, depth + 0.024);
    });
    var net = put(sg, new T.PlaneGeometry(1.24, 1.5), new T.MeshBasicMaterial({ map: tex(256, 320, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(40,44,52,0.8)'; ctx.lineWidth = 1.6;
      for (var x = -h; x < w; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke(); }
      ctx.strokeStyle = '#e0742e'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    }), transparent: true, side: T.DoubleSide, depthWrite: false }), 0, 0.85, 0.355);
    net.receiveShadow = false;
    var cs = new T.Group(); cs.position.set(1.4, F, 0.1); cs.rotation.y = -Math.PI / 2; g.add(cs);
    put(cs, rbox(0.56, 0.34, 0.4, 0.04), M.alu, 0, 0.17, 0, 0, 0, 0, true);
    [-0.1, 0.1].forEach(function (o) { put(cs, rbox(0.58, 0.022, 0.42, 0.01), M.steel, 0, 0.17 + o, 0); });
    [-0.18, 0.18].forEach(function (o) { put(cs, rbox(0.05, 0.05, 0.02, 0.008), M.dark, o, 0.29, 0.205); });
    put(cs, new T.TorusGeometry(0.06, 0.012, 6, 16, Math.PI), M.dark, 0, 0.34, 0);
    plate(cs, 0.24, 0.07, 256, 76, function (ctx, w, h) { ctx.fillStyle = '#e0742e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = '700 30px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SAMPLES', w / 2, h / 2 + 2); }, 0, 0.15, 0.202);
    cs.visible = false; room.caseMesh = cs;

    // ---- a fire extinguisher by the hatch, the mission patch, the little bear
    var fe = onWall(Math.PI * 0.72, RK_R - 0.2, 1.15);
    var fx = new T.Group(); fx.position.set(fe[0], fe[1], fe[2]); g.add(fx);
    put(fx, new T.LatheGeometry([[0, -0.22], [0.06, -0.22], [0.065, -0.2], [0.065, 0.16], [0.045, 0.21], [0.015, 0.23], [0, 0.23]].map(function (q) { return new T.Vector2(q[0], q[1]); }), 20), M.red, 0, 0, 0, 0, 0, 0, true);
    put(fx, rbox(0.05, 0.03, 0.12, 0.01), M.dark, 0, 0.25, 0.03);
    var patch = plate(g, 0.5, 0.5, 256, 256, patchTex, 1.45, F + 2.35, -1.65, 0, 0);
    patch.material.transparent = true; faceTo(room, patch, 0, F + 2.35, 0);
    var plush = new T.Group(); plush.position.set(0.45, RK_TOP - 1.15, 0.55); g.add(plush);
    var fur = pbr(0xb98656, 0.95, 0, repeat(nm.fabric.clone(), 3, 3), null, 0.3);
    put(plush, cyl(0.004, 0.004, 1.0, 4), pbr(0xffffff, 0.8, 0), 0, 0.5, 0);
    put(plush, ball(0.13, 16, 12), fur, 0, 0, 0); put(plush, ball(0.1, 16, 12), fur, 0, 0.17, 0);
    [-0.07, 0.07].forEach(function (x) { put(plush, ball(0.04, 8, 6), fur, x, 0.26, 0); });
    put(plush, ball(0.07, 12, 8), pbr(0xffc04d, 0.6, 0), 0, 0.01, 0.1);
    room.plush = plush;

    // where you cannot walk: couches, the pedestal, the cockpit, the sample case
    room.colliders = [[-0.72, -1.45, 0.38], [-0.72, -0.75, 0.38], [-0.72, 0, 0.33], [0.72, -1.45, 0.38], [0.72, -0.75, 0.38], [0.72, 0, 0.33],
      [0, -0.95, 0.25], [0, 1.78, 0.6], [1.4, 0.1, 0.3]];
    room.spots = [
      { id: 'hatch', label: 'Climb down the hatch', x: 0, z: 0.1, reach: 0.6 },
      { id: 'seat', label: 'Look at the commander\'s couch', x: -0.72, z: 0.62, reach: 0.6 },
      { id: 'panel', label: 'Read the cockpit screens', x: -0.15, z: 1.0, reach: 0.6 },
      { id: 'abort', label: 'Look at the abort handle', x: 0.7, z: 0.95, reach: 0.45 },
      { id: 'life', label: 'Check the life support', x: -1.2, z: 0.4, reach: 0.55 },
      { id: 'stow', label: 'Look in the stowage bags', x: 1.15, z: 0.55, reach: 0.55 },
      { id: 'plush', label: 'Look at the little bear', x: 0.55, z: 0.45, reach: 0.4 }
    ];
    room.spawn = [0, 0.35]; room.face = 0;          // standing on the hatch, facing the window
    return room;
  }
  // Face an object (whose front is +z) toward a point given in the room's own coordinates.
  function faceTo(room, obj, x, y, z) { room.group.updateMatrixWorld(true); obj.lookAt(room.group.localToWorld(new T.Vector3(x, y, z))); }

  // What the cockpit screens show right now.
  function panelInfo(s) {
    var last = s.sol >= s.totalSols, D = s.dayLength || 1;
    var fuel = last ? 100 : Math.max(0, Math.min(99, Math.round(100 * ((s.sol - 1) + s.t / D) / Math.max(1, s.totalSols - 1))));
    var w = JA.sim.weather(s), date = (w && w.date) || new Date().toISOString().slice(0, 10), km, oneWay, trip;
    if (s.site.comms === 'relay') { km = 'light-years'; oneWay = '2 s to the relay'; trip = 'made up: no real rocket goes so far'; }
    else if (s.site.comms !== 'near') {
      var mins = JA.weather && JA.weather.marsDelayMin ? JA.weather.marsDelayMin(date) : 12;
      km = Math.round(mins * 60 * 299792.458 / 1e6) + ' million km'; oneWay = Math.round(mins) + ' min'; trip = 'about 7 months';
    } else { km = '384,400 km'; oneWay = '1.3 s'; trip = 'about 3 days'; }
    return { site: s.site.id, date: date, fuel: fuel, ready: last, left: s.totalSols - s.sol, dayWord: s.site.dayWord, km: km, oneWay: oneWay, trip: trip,
      caseLoaded: !!s.caseLoaded, comms: !!(s.m && s.m.comms.on), storm: JA.sim.stormPhase(s) };
  }
  var RK_DRAW = { 'rk-fuel': drawFuel, 'rk-course': drawCourse, 'rk-launch': drawLaunch, 'rk-annun': drawAnnun };

  // ---------- build ----------
  I.build = function (root, siteId) {
    site = siteId; rooms = {}; I.current = null; used = {};
    var P = B.P;
    if (!P || !P.hab || !P.hab.group || !P.rocket || !P.rocket.group) return;
    root.updateMatrixWorld(true);
    rooms.hab = buildHab(P.hab.group);
    rooms.rocket = buildRocket(P.rocket.group);
    light = new T.PointLight(0xfff1dd, 0, 11, 1); root.add(light);
    blob = new T.Mesh(new T.CircleGeometry(0.5, 20), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.visible = false; root.add(blob);
  };

  // world position of a point given in a room's own coordinates
  function toWorld(room, x, y, z, out) { return room.group.parent.localToWorld(out.set(x, y, z)); }

  // Go in. Returns everything the game needs: the walking room, the camera room, where to stand, which way to face.
  I.enter = function (id) {
    var room = rooms[id]; if (!room) return null;
    var P = B.P, parent = room.group.parent, i;
    parent.updateMatrixWorld(true);
    I.current = room;
    room.group.visible = true;
    (id === 'hab' ? P.hab.windows : P.rocket.windows).forEach(function (w) { w.visible = false; });
    var F = id === 'hab' ? HAB_FLOOR : RK_FLOOR, R = id === 'hab' ? HAB_R : RK_R;
    var c = toWorld(room, 0, F, 0, new T.Vector3());
    var cols = room.colliders.map(function (k) { toWorld(room, k[0], F, k[1], v1); return { x: v1.x, z: v1.z, r: k[2] }; });
    var walk = { cx: c.x, cz: c.z, r: id === 'hab' ? 4.0 : 1.95, floor: c.y, colliders: cols };
    if (id === 'hab') walk.ceil = function (x, z) { var d = Math.hypot(x - c.x, z - c.z); return c.y + Math.sqrt(Math.max(0, R * R - d * d)) - 2.1; };
    else walk.ceil = function () { return c.y + (RK_TOP - RK_FLOOR) - 2.1; };
    var cam = id === 'hab' ? { type: 'dome', cx: c.x, cy: c.y, cz: c.z, r: R - 0.35, floor: c.y + 0.35 }
      : { type: 'cyl', cx: c.x, cz: c.z, r: RK_R - 0.3, floor: c.y + 0.35, top: c.y + (RK_TOP - RK_FLOOR) - 0.3 };
    var spawn = toWorld(room, room.spawn[0], F, room.spawn[1], new T.Vector3());
    // which way "facing into the room" is, in the world
    var ahead = toWorld(room, room.spawn[0], F, room.spawn[1] + (room.face === Math.PI ? -1 : 1), new T.Vector3()).sub(spawn);
    var yaw = Math.atan2(ahead.x, ahead.z);
    light.position.copy(c); light.position.y += id === 'hab' ? 3.9 : 3.8;
    light.intensity = id === 'hab' ? 1.25 : 0.55; light.distance = id === 'hab' ? 11 : 6;
    light.color.set(id === 'hab' ? 0xfff1dd : 0xeef3ff);   // the cabin has cool white LED light
    if (id === 'rocket') light.position.y -= 1.2;          // a lower, softer cabin light: no glare off the ceiling
    for (i = 0; i < room.screens.length; i++) room.screens[i].drawn = -1;
    redrawAt = 0;
    return { walk: walk, cam: cam, spawn: spawn, yaw: yaw, center: c };
  };
  I.leave = function () {
    var P = B.P;
    Object.keys(rooms).forEach(function (k) { rooms[k].group.visible = false; });
    if (P && P.hab && P.hab.windows) P.hab.windows.forEach(function (w) { w.visible = true; });
    if (P && P.rocket && P.rocket.windows) P.rocket.windows.forEach(function (w) { w.visible = true; });
    if (light) light.intensity = 0;
    if (blob) blob.visible = false;
    I.current = null;
  };

  // The things you can walk up to in the room you are in, in world coordinates.
  I.spots = function () {
    var room = I.current; if (!room) return [];
    var F = room.id === 'hab' ? HAB_FLOOR : RK_FLOOR;
    return room.spots.map(function (s) { toWorld(room, s.x, F, s.z, v1); return { id: s.id, label: s.label, x: v1.x, z: v1.z, reach: s.reach }; });
  };
  // Something to do when you use a spot (the bike pedals, the bear spins).
  I.poke = function (id) {
    var room = I.current; if (!room) return;
    if (id === 'bike') room.pedal = 3;
    if (id === 'plush' && room.plush) room.plushSpin = 2.5;
    used[id] = true;
  };
  // The cutaway camera: where it stands and what it looks at, in world coordinates (habitat only).
  I.consoleView = function () {
    var room = I.current; if (!room || !room.view) return null;
    var v = room.view;
    return { pos: toWorld(room, v.pos[0], v.pos[1], v.pos[2], new T.Vector3()), look: toWorld(room, v.look[0], v.look[1], v.look[2], new T.Vector3()) };
  };

  // ---------- the screens on the console ----------
  function drawStatus(ctx, w, h, s) {
    ctx.fillStyle = '#0b1424'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4fd8ff'; ctx.font = '700 30px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('OUTPOST STATUS', 24, 34);
    ctx.fillStyle = '#b3bde0'; ctx.font = '600 24px ' + FONT; ctx.textAlign = 'right';
    ctx.fillText(s.site.dayWord + ' ' + s.sol + ' of ' + s.totalSols, w - 24, 34);
    [['AIR', s.air, '#4fd8ff'], ['FOOD', s.food, '#7be36a'], ['RADIATION', s.dose, '#ff6fb1']].forEach(function (r, i) {
      var y = 96 + i * 72, v = Math.max(0, Math.min(100, r[1]));
      ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '600 24px ' + FONT; ctx.fillText(r[0], 24, y);
      ctx.textAlign = 'right'; ctx.fillText(Math.round(r[1]) + (i === 2 ? '%' : ''), w - 24, y);
      ctx.fillStyle = '#1e2a44'; rr(ctx, 24, y + 18, w - 48, 18, 9); ctx.fill();
      ctx.fillStyle = r[2]; rr(ctx, 24, y + 18, Math.max(18, (w - 48) * v / 100), 18, 9); ctx.fill();
    });
  }
  function drawEarth(ctx, w, h, s) {
    ctx.fillStyle = '#020611'; ctx.fillRect(0, 0, w, h);
    for (var k = 0; k < 60; k++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + (k * 37 % 7) / 10) + ')'; ctx.fillRect((k * 97) % w, (k * 53) % h, 2, 2); }
    var cx = w * 0.32, cy = h * 0.55, r = h * 0.3;
    var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#7cc4ff'); g.addColorStop(1, '#1d4fa8');
    ctx.fillStyle = g; ellipse(ctx, cx, cy, r, r); ctx.fill();
    ctx.fillStyle = '#5fbf6a'; ellipse(ctx, cx - r * 0.25, cy - r * 0.1, r * 0.35, r * 0.22); ctx.fill(); ellipse(ctx, cx + r * 0.3, cy + r * 0.3, r * 0.25, r * 0.18); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ellipse(ctx, cx + r * 0.1, cy - r * 0.55, r * 0.5, r * 0.12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 30px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('EARTH', w * 0.6, h * 0.36);
    ctx.fillStyle = '#b3bde0'; ctx.font = '600 22px ' + FONT;
    var info = JA.sim && JA.sim.commInfo ? JA.sim.commInfo(s) : null;
    ctx.fillText('radio: ' + (info ? info.oneWay : '?'), w * 0.6, h * 0.52);
    ctx.fillText(s.m.comms.on ? 'dish ON' : 'dish off', w * 0.6, h * 0.66);
  }
  function drawSun(ctx, w, h, s) {
    ctx.fillStyle = '#1a0b16'; ctx.fillRect(0, 0, w, h);
    var cx = w * 0.26, cy = h * 0.55, r = h * 0.24;
    var g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(0.45, '#ffb347'); g.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = g; ellipse(ctx, cx, cy, r * 1.6, r * 1.6); ctx.fill();
    var wx = JA.sim && JA.sim.weather ? JA.sim.weather(s) : null, ph = JA.sim ? JA.sim.stormPhase(s) : 'none';
    ctx.fillStyle = '#ffd23f'; ctx.font = '700 28px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('SPACE WEATHER', w * 0.48, h * 0.24);
    ctx.fillStyle = '#fff'; ctx.font = '600 24px ' + FONT;
    var known = s.forecast || ph !== 'none';
    ctx.fillText(ph === 'active' ? 'STORM NOW!' : ph === 'warning' ? 'STORM COMING' : known ? (wx && wx.level ? (wx.cause === 'cme' ? 'CME shock today' : 'particle storm today') : 'quiet Sun') : 'no forecast', w * 0.48, h * 0.48);
    ctx.fillStyle = '#b3bde0'; ctx.font = '600 20px ' + FONT;
    ctx.fillText('Use me: Sun Watch', w * 0.48, h * 0.72);
  }

  // ---------- every frame ----------
  // ctx: { s, astro }
  I.update = function (dt, ctx) {
    var room = I.current; if (!room) return;
    clock += dt;
    var a = ctx && ctx.astro, s = ctx && ctx.s;
    if (a && blob) {
      var F = room.id === 'hab' ? HAB_FLOOR : RK_FLOOR, floorY = toWorld(room, 0, F, 0, v2).y, up = Math.max(0, a.pos.y - floorY);
      blob.visible = a.mode !== 'hidden';
      blob.position.set(a.pos.x, floorY + 0.025, a.pos.z);
      blob.scale.setScalar(Math.max(0.35, 1 - up * 0.25));
      blob.material.opacity = Math.max(0.08, 0.32 - up * 0.08);
    }
    if (room.wheel) { room.pedal = Math.max(0, (room.pedal || 0) - dt); room.wheel.rotation.x += dt * (room.pedal > 0 ? 9 : 0); }
    room.spin.forEach(function (p) { p.m.rotation.z = Math.sin(clock * 0.8 + p.k) * 0.05; });
    if (room.plush) {
      room.plushSpin = Math.max(0, (room.plushSpin || 0) - dt);
      room.plush.rotation.z = Math.sin(clock * 1.3) * 0.06; room.plush.rotation.y += dt * (room.plushSpin > 0 ? 6 : 0.2);
    }
    if (room.doorLight) room.doorLight.material.emissiveIntensity = 1.6 + Math.sin(clock * 3) * 0.4;
    if (room.fan) room.fan.rotation.z += dt * 7;                               // the CO2 scrubber fan
    if (room.abort) room.abort.material.emissiveIntensity = 0.6 + Math.sin(clock * 2.5) * 0.2;
    if (room.caseMesh && s) room.caseMesh.visible = !!s.caseLoaded;          // the sample case, once it is on board
    if (room.drum) room.drum.rotation.x += dt * 0.6;
    if (!s) return;
    // ---- the habitat answers the state of the outpost: alarm beacon, light level and colour, switch-panel lamps, Mission Control screens
    var Mc = JA.mission;
    if (room.id === 'hab' && Mc) {
      var al = Mc.alert(s), pw = Mc.power(s);
      if (room.alarm) {
        room.alarm.rotation.y += dt * (al.lvl === 2 ? 6 : 0);
        room.alarm.material.emissiveIntensity = al.lvl === 2 ? 1.2 + Math.sin(clock * 9) * 1.0 : al.lvl === 1 ? 0.5 + Math.sin(clock * 2.5) * 0.3 : 0.05;
      }
      if (light) {
        var want = 1.25 * (pw.low ? 0.55 : 1), lc = al.lvl === 2 ? 0xffb0a8 : al.lvl === 1 ? 0xfff0c8 : 0xfff1dd;
        light.intensity += (want - light.intensity) * Math.min(1, dt * 2);
        light.color.lerp(new T.Color(lc), Math.min(1, dt * 2));
      }
      if (clock >= (room.ledAt || 0)) {
        room.ledAt = clock + 0.5;
        (room.leds || []).forEach(function (L) {
          var m = s.m, on = L.id === 'air' ? m.air.power > 0 : L.id === 'food' ? m.food.lamp > 0 : L.id === 'lab' ? m.lab.power > 0 : L.id === 'bag' ? m.bag.pending > 0 : L.id === 'comms' ? m.comms.on : m.rover.charge > 5;
          L.m.material.emissiveIntensity = on ? 1.4 : 0.12;
        });
        if (room.scrubLed) { var stale = (JA.sim.stale ? JA.sim.stale(s) : s.stale) > 1; room.scrubLed.material.emissive.set(stale ? 0xff5468 : 0x4dff9a); room.scrubLed.material.color.set(stale ? 0xff5468 : 0x4dff9a); }
      }
      room.screens.forEach(function (sc) {
        if (clock < (sc.nextAt || 0)) return;
        sc.nextAt = clock + (sc.every || 1);
        var u = sc.t.userData, c = u.canvas;
        Mc.screen(sc.id, u.ctx, c.width, c.height, s, clock);
        sc.t.needsUpdate = true;
      });
      return;
    }
    if (clock < redrawAt) return;
    redrawAt = clock + 1;
    var info = room.id === 'rocket' ? panelInfo(s) : null;
    room.screens.forEach(function (sc) {
      var u = sc.t.userData, c = u.canvas;
      if (RK_DRAW[sc.id]) RK_DRAW[sc.id](u.ctx, c.width, c.height, info);
      else if (sc.id === 'status' || sc.id === 'power' || sc.id === 'life') drawStatus(u.ctx, c.width, c.height, s);      // without js/mission.js the new screens show the plain status
      else if (sc.id === 'main') drawEarth(u.ctx, c.width, c.height, s);
      else if (sc.id === 'earth') { if (sc.drawn === s.sol + (s.m.comms.on ? 0.5 : 0)) return; sc.drawn = s.sol + (s.m.comms.on ? 0.5 : 0); drawEarth(u.ctx, c.width, c.height, s); }
      else if (sc.id === 'cabin') drawCabin(u.ctx, c.width, c.height, s);
      else drawSun(u.ctx, c.width, c.height, s);
      sc.t.needsUpdate = true;
    });
  };
})(window.JA);
