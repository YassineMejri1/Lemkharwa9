/* Astro Outpost — the landing film that opens a mission.
   Everything is seen through the astronaut's own eyes:
     1. the descent, watched through the lander window
     2. the hatch, and the first bootprint
     3. the walk across the dust
     4. sitting down on a rock and taking in the view
   It uses the real game world (no video), so the outpost you see is the one you will run.
   Sound: inside the lander everything is clear; once the hatch opens you hear the place itself
   (see the scenes in audio.js), and music joins for the last view. */
(function (JA) {
  'use strict';
  var T = window.THREE, W = JA.world, Tn = JA.terrain, B = JA.base, A = JA.actors, Au = JA.audio, U = JA.ui;
  var I = JA.intro = {};
  if (!T) return;
  var st = null;

  // when each shot starts (seconds)
  var TM = { descent: 3.4, land: 17.4, fade1: 20.6, step: 23.8, walk: 33.0, cut: 44.2, walk2: 45.4, sit: 52.0, vista: 57.4, title: 69.2, fade2: 72.6, end: 73.8 };
  var EYE = 1.72, STEP = 0.75;
  var SEAT_HIP = 0.15;          // sitting, your hips are this far above the rock's top (the suit is padded)
  var PRINT_AHEAD = 0.67;       // the first print, this far ahead of where the boot stood: past the pad's sloping rim

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function near(a, ref) { return a + Math.PI * 2 * Math.round((ref - a) / (Math.PI * 2)); }
  function cls(name, on) { $('cine').classList.toggle(name, !!on); }

  // ---------- what is said, and when ----------
  // vo: the recorded line in audio/landing/ (each one fits before the next line starts).
  // Lines without a recording fall back to the read-aloud voice.
  var VO = 'audio/landing/';
  // The lines of the film that belong to one planet: [the words, the recording in audio/landing/]. A line without a
  // recording (null) is read by the read-aloud voice. home: the "my home for the next N days" recording for each mission length.
  var FILM = {
    moon: { first: '09-first-step-moon', home: { 5: '13-home-5-days', 8: '14-home-8-days', 10: '15-home-10-days' },
      bootprint: ['My first bootprint. With no wind and no rain, it could stay here for a million years.', '10-bootprint-moon'],
      air: ['No air. No sound. Only my own breathing.', '11-no-air-moon'],
      gravity: ['And gravity so gentle that every step is a little flight.', '12-gravity-moon'],
      earth: ['And that is Earth. Everyone I have ever known is on that small blue ball.', '16-earth-moon'],
      title: '384,400 km from home', light: 0.12, hop: 1.9, endPitch: 0.1, faceEarth: true },
    mars: { first: '17-first-step-mars', home: { 5: '21-home-5-sols', 8: '22-home-8-sols', 10: '23-home-10-sols' },
      bootprint: ['My first bootprint. One day the wind will sweep it away. But not today.', '18-bootprint-mars'],
      air: ['Thin, cold air, and a sky the colour of butterscotch.', '19-thin-air-mars'],
      gravity: ['And gravity so gentle that I weigh about a third of what I do on Earth.', '20-gravity-mars'],
      earth: ['Somewhere in that sky, Earth is just a pale dot of light.', '24-earth-mars'],
      title: 'Seven months from home', light: 0.2, hop: 2.7, endPitch: 0.07, faceEarth: false },
    // Sahrun (made up): no recordings yet, so the read-aloud voice speaks its lines
    sahrun: { first: null, home: {},
      bootprint: ['My first bootprint. By tonight the wind will have filled it with sand.', null],
      air: ['Hot, dry wind, and sand hissing against my visor.', null],
      gravity: ['Half of Earth\'s gravity. Every step is a little bounce.', null],
      earth: ['Earth is so far away that it is just one faint star among thousands.', null],
      title: 'A made-up world, far from home', light: 0.2, hop: 3.1, endPitch: 0.07, faceEarth: false }
  };
  function script(s) {
    var F = JA.pick(s, FILM), dw = s.site.dayWord.toLowerCase() + 's';
    var home = F.home[s.totalSols];
    return [
      { t: 4.6, who: 'Mission Control', text: 'Outpost One, you are GO for landing.', dur: 3.0, radio: true, vo: '01-go-for-landing' },
      { t: 8.4, text: 'There it is. The robots finished building it last week.', dur: 3.4, vo: '05-there-it-is' },
      { t: 12.6, who: 'Mission Control', text: 'Sixty metres… thirty… the engine is kicking up dust!', dur: 3.6, radio: true, vo: '02-sixty-metres' },
      { t: TM.land + 0.3, who: 'Mission Control', text: 'Contact! Engines off.', dur: 2.3, radio: true, vo: '03-contact' },
      { t: TM.land + 2.8, text: 'We made it.', dur: 1.9, vo: '06-we-made-it' },
      { t: TM.step + 0.4, text: 'Here goes. My first step on ' + s.site.name + '.', dur: 2.6, vo: F.first },
      { t: TM.step + 3.7, text: F.bootprint[0], dur: 4.2, vo: F.bootprint[1] },
      { t: TM.walk + 1.8, text: F.air[0], dur: 3.4, vo: F.air[1] },
      { t: TM.walk + 6.0, text: F.gravity[0], dur: 3.8, vo: F.gravity[1] },
      { t: TM.walk2 + 1.2, text: 'That rock looks like a good seat.', dur: 3.0, vo: '07-good-seat' },
      { t: TM.sit + 2.7, text: 'Stop. Sit. Breathe.', dur: 2.3, vo: '08-stop-sit-breathe' },
      { t: TM.vista + 2.6, text: 'That is the outpost. My home for the next ' + s.totalSols + ' ' + dw + '.', dur: 3.6, vo: home },
      { t: TM.vista + 6.8, text: F.earth[0], dur: 3.9, vo: F.earth[1] },
      { t: TM.vista + 11.0, who: 'Mission Control', text: 'Ready when you are, Commander.', dur: 2.6, radio: true, vo: '04-ready-commander' }
    ];
  }
  function say(c) {
    var el = $('cine-line');
    el.innerHTML = (c.who ? '<b>' + U.esc(c.who) + '</b>' : '') + U.esc(c.text);
    el.className = 'show' + (c.who ? ' radio' : '');
    st.lineOff = c.t + c.dur;
    if (c.radio) Au.play('radio');
    // the recorded voice plays with sound on (or with read-aloud on, in place of the browser voice)
    if (c.vo && (Au.soundOn() || Au.readingOn())) Au.voice(VO + c.vo + '.mp3');
    else Au.speak(c.text);
  }
  function title(small, big, sub) {
    var el = $('cine-title');
    if (!small && !big) { el.className = ''; return; }
    el.children[0].textContent = small || ''; el.children[1].textContent = big || ''; el.children[2].textContent = sub || '';
    el.className = 'show' + (big ? '' : ' minor') + (st && st.t > TM.vista ? ' sky' : '');
  }

  // ---------- your own body, seen when you look down ----------
  // The legs are a real chain (hip, knee, ankle). Each frame every boot is given a spot on the ground and the leg
  // bends to put its sole flat on it, so the boots stand on the pad, step down onto the dust and rest in front
  // of the rock instead of sinking into them.
  var HIP = -0.72, HIP_SIT = -0.72, THIGH = 0.42, SHIN = 0.38;  // the hips, below your eyes; the bones of the leg (standing, nearly straight)
  var SOLE_Y = 0.15, SOLE_Z = 0.085;                          // the middle of the boot's sole, below and ahead of the ankle
  var SIDE = [0.17, -0.17];                                   // [your left leg, your right leg], across the body
  // the outline of the sole seen from above, toe ahead: as long and wide as the print it leaves (k makes it smaller)
  function soleShape(k) {
    var s = new T.Shape();
    s.moveTo(-0.098 * k, -0.115 * k);
    s.absarc(0, -0.115 * k, 0.098 * k, Math.PI, Math.PI * 2, false);    // the heel
    s.lineTo(0.12 * k, 0.11 * k);
    s.absarc(0, 0.11 * k, 0.12 * k, 0, Math.PI, false);                // the wider toe
    s.lineTo(-0.098 * k, -0.115 * k);
    return s;
  }
  // that outline made solid and laid flat, its underside at height y (in the ankle's frame), its middle at z
  function slab(shape, depth, bevel, y, z, round) {
    var g = new T.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: true, bevelThickness: round || bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
    g.rotateX(Math.PI / 2);                  // the outline's "ahead" becomes +z, its thickness goes down
    g.computeBoundingBox();
    var bb = g.boundingBox;
    g.translate(0, y - bb.min.y, z - (bb.min.z + bb.max.z) / 2);
    return g;
  }
  function buildRig(color) {
    var g = new T.Group(), white = W.soft(0xf5f6fa), accent = W.soft(color), grey = W.soft(0xcfd3de);
    var bootM = W.soft(0x4f545c), soleM = W.soft(0x262b3d), capM = W.soft(0xc2c7d2);     // the same grey boots the astronaut wears in the game
    function part(parent, geo, m, x, y, z) { var o = W.add(parent, geo, m, x, y, z, true); o.receiveShadow = true; return o; }
    // a chunky moon boot, built round the ankle: a thick tread sole that shows all round, a padded upper,
    // a rubber toe cap, a strap over the instep and a padded cuff in the suit's colour
    function boot(ankle) {
      part(ankle, slab(soleShape(1), 0.03, 0.012, -SOLE_Y, SOLE_Z), soleM, 0, 0, 0);
      part(ankle, slab(soleShape(0.8), 0.02, 0.022, -SOLE_Y + 0.05, SOLE_Z + 0.006, 0.03), bootM, 0, 0, 0);
      part(ankle, new T.SphereGeometry(1, 18, 12), bootM, 0, -0.045, 0.035).scale.set(0.1, 0.08, 0.135);       // the instep
      part(ankle, new T.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, -0.097, 0.2).scale.set(0.112, 0.072, 0.115);   // toe cap
      part(ankle, new T.CylinderGeometry(0.122, 0.132, 0.2, 18), bootM, 0, 0, -0.02);                            // the shaft round your ankle
      part(ankle, new T.TorusGeometry(0.124, 0.028, 8, 24), accent, 0, 0.1, -0.02).rotation.x = Math.PI / 2;     // the padded cuff
      part(ankle, new T.TorusGeometry(0.125, 0.018, 6, 20, Math.PI), accent, 0, -0.125, 0.15);                   // the strap over the forefoot
      part(ankle, new T.BoxGeometry(0.035, 0.03, 0.05), capM, 0.105, -0.06, 0.15).rotation.z = 0.5;              // its buckle
    }
    function leg(x) {
      var hip = new T.Group(); hip.position.set(x, HIP, 0.06); g.add(hip);
      part(hip, new T.CapsuleGeometry(0.125, 0.2, 4, 12), white, 0, -THIGH / 2, 0);
      var knee = new T.Group(); knee.position.set(0, -THIGH, 0); hip.add(knee);
      part(knee, new T.SphereGeometry(0.135, 14, 10), grey, 0, 0, 0);
      part(knee, new T.CapsuleGeometry(0.115, 0.18, 4, 12), white, 0, -SHIN / 2, 0);
      var ankle = new T.Group(); ankle.position.set(0, -SHIN, 0); knee.add(ankle);
      boot(ankle);
      return { hip: hip, knee: knee, ankle: ankle, a: 0 };
    }
    // sitting, your gloved hands rest on your thighs, the forearms coming back from them to your elbows
    var hands = new T.Group(); g.add(hands);
    var hand = SIDE.map(function (x) {
      var h = new T.Group(); hands.add(h);
      part(h, new T.SphereGeometry(1, 14, 10), accent, 0, 0, 0).scale.set(0.068, 0.045, 0.085);             // the glove
      part(h, new T.CapsuleGeometry(0.022, 0.05, 4, 8), accent, -Math.sign(x) * 0.06, 0.005, 0.01).rotation.set(1.3, 0, Math.sign(x) * 0.5);   // its thumb
      part(h, new T.TorusGeometry(0.066, 0.016, 6, 16), grey, 0, 0.004, -0.075);                           // the cuff ring
      var arm = part(h, new T.CapsuleGeometry(0.07, 0.26, 4, 10), white, 0, 0, -0.22); arm.rotation.x = Math.PI / 2;   // the forearm
      h.userData.arm = arm;
      return h;
    });
    W.root.add(g);
    // an unseen body that still throws your shadow across the ground
    var ghost = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    var sh = new T.Group();
    [[new T.CapsuleGeometry(0.34, 0.9, 4, 8), 0, -0.85, -0.05], [new T.SphereGeometry(0.4, 10, 8), 0, 0.02, -0.05], [new T.BoxGeometry(0.6, 0.8, 0.34), 0, -0.6, -0.4]].forEach(function (p) {
      var m = new T.Mesh(p[0], ghost); m.position.set(p[1], p[2], p[3]); m.castShadow = true; sh.add(m);
    });
    W.root.add(sh);
    return { group: g, legs: SIDE.map(leg), hands: hands, hand: hand, shadow: sh };
  }
  // where boot i stands when the body is at (x, z) facing yaw: under its hip, plus `ahead` metres; on the ground
  // (the launch pad counts as ground: A.groundAt knows its height)
  function spot(i, x, z, yaw, ahead) {
    var s = SIDE[i], f = 0.06 + SOLE_Z + (ahead || 0), c = Math.cos(yaw), n = Math.sin(yaw);
    var px = x + c * s + n * f, pz = z - n * s + c * f;
    return { x: px, z: pz, y: A.groundAt(px, pz), toe: 0 };
  }
  // a boot swinging from spot a to spot b (u: 0 → 1): it lifts first, travels, and comes down last, clearing edges
  function swing(a, b, u, lift) {
    var h = ease(seg(u, 0.12, 0.92)), v = ease(seg(u, 0.4, 1)), arc = Math.sin(Math.PI * clamp(u, 0, 1));
    return { x: lerp(a.x, b.x, h), z: lerp(a.z, b.z, h), y: lerp(a.y, b.y, v) + (lift || 0.12) * arc, toe: 0.28 * arc * (b.y < a.y ? 1 : -0.4) };
  }
  var ARM_UP = new T.Vector3(0, 1, 0), armDir = new T.Vector3(), qInv = new T.Quaternion();
  // bend leg l so the sole of its boot lies flat on point p (in the world): two bones, the knee bending forward
  var tmp = { x: 0, y: 0, z: 0 };
  function reach(l, p) {
    var g = st.rig.group.position, c = Math.cos(st.bodyYaw), n = Math.sin(st.bodyYaw), wx = p.x - g.x, wz = p.z - g.z;
    tmp.z = wx * n + wz * c; tmp.y = p.y - g.y;                      // the point in the body's own frame (z ahead)
    var dy = tmp.y + SOLE_Y - l.hip.position.y, dz = tmp.z - SOLE_Z - l.hip.position.z;
    var d = clamp(Math.hypot(dy, dz), 0.12, THIGH + SHIN - 0.002);
    var a = Math.atan2(dz, -dy) + Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
    var bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
    l.hip.rotation.x = -a; l.knee.rotation.x = bend;
    l.ankle.rotation.x = a - bend + (p.toe || 0);                    // keep the boot level (or tip its toe)
    l.a = a;
  }
  function poseRig(dt) {
    var r = st.rig, e = st.eye, q = st.sitQ;
    r.group.visible = r.shadow.visible = st.body;
    if (!st.body) return;
    // when you bend to look at your feet, your eyes move ahead of your body (and to one side, to see past a leg)
    var fs = Math.sin(st.bodyYaw), fc = Math.cos(st.bodyYaw);
    r.group.position.set(e.x - fs * st.lean - fc * st.headSide, e.y + st.duck, e.z - fc * st.lean + fs * st.headSide); r.group.rotation.y = st.bodyYaw;
    r.shadow.position.copy(r.group.position); r.shadow.rotation.y = st.bodyYaw;
    r.shadow.scale.y = lerp(1, 0.72, q);
    r.legs.forEach(function (l, i) {
      l.hip.position.y = lerp(HIP, HIP_SIT, q);
      reach(l, st.feet[i]);
      // sitting, your hands rest on the outside of your thighs, not over the knees, so the boots still show past them
      var h = r.hand[i], k = 0.55, hy = l.hip.position.y - Math.cos(l.a) * THIGH * k + 0.12, hz = l.hip.position.z + Math.sin(l.a) * THIGH * k;
      h.position.set(SIDE[i] * 1.55, hy, hz);
      h.rotation.set(Math.PI / 2 - l.a, 0, -Math.sign(SIDE[i]) * 0.35);       // lying along the thigh, turned a little inward
      // the forearm points back toward the elbow, beside your body
      var ex = SIDE[i] * 1.95 - h.position.x, ey = -0.56 - hy, ez = -0.1 - hz, el = Math.hypot(ex, ey, ez);
      h.userData.arm.position.set(0, 0, 0);
      h.userData.arm.quaternion.setFromUnitVectors(ARM_UP, armDir.set(ex / el, ey / el, ez / el).applyQuaternion(qInv.copy(h.quaternion).invert()));
      h.userData.arm.position.copy(armDir).multiplyScalar(0.22);
    });
    r.hands.visible = q > 0.55;
  }

  function setCam() {
    var c = W.cam.cine, e = st.eye, cp = Math.cos(e.pitch);
    c.pos.set(e.x, e.y, e.z);
    c.look.set(e.x + Math.sin(e.yaw) * cp * 10, e.y + Math.sin(e.pitch) * 10, e.z + Math.cos(e.yaw) * cp * 10);
    c.fov = e.fov; c.roll = e.roll;
  }
  function footfall(x, z, yaw, big) {
    W.print(x, z, yaw, 0.26, 0.5);
    W.dust(x, z, big ? 16 : 3, big ? 1.8 : 0.9, big ? 0.5 : 0.3);
    Au.play(big ? 'land' : 'step');
  }

  // ---------- shot 1: the descent, through the lander window ----------
  function shotDescent(t, dt) {
    var e = st.eye, p = st.pad, d = st.dir, rk = B.P.rocket, landed = t >= TM.land;
    var u = seg(t, TM.descent, TM.land), k = 1 - u, T1 = TM.land - TM.descent;
    var alt = landed ? 0 : 250 * Math.pow(k, 1.8), vel = landed ? 0 : 250 * 1.8 * Math.pow(k, 0.8) / T1;
    var back = 150 * k * k, side = 24 * k * k;
    var ox = -d.x * back + d.z * side, oz = -d.z * back - d.x * side;
    rk.group.position.set(ox, alt, oz);
    rk.flame.visible = !landed; rk.flame.scale.set(1, 0.7 + Math.random() * 0.8, 1);
    rk.light.intensity = landed ? 0 : 4 + Math.random() * 2;
    e.x = p.x + ox + d.x * 2.95; e.z = p.z + oz + d.z * 2.95; e.y = p.y + alt + 12.4;
    e.yaw = st.dirYaw + 0.3 * k * k + Math.sin(t * 0.5) * 0.04 * k;
    e.pitch = lerp(-1.0, -0.3, ease(u)) + ease(seg(t, TM.land + 0.2, TM.land + 2.6)) * 0.17;
    e.roll = Math.sin(t * 0.9) * 0.035 * k; e.fov = 58;
    if (!landed) {
      W.cam.shake = Math.max(W.cam.shake, 0.04 + 0.22 * u * u);
      Au.loop('descent', { f: 40 + u * 18, v: 0.07 + 0.06 * u, type: 'sawtooth', rate: 0.85 + u * 0.3, vol: 0.55 + 0.45 * u });
      st.rum -= dt; if (st.rum <= 0) { st.rum = 0.24; Au.play('rumble'); }
      if (alt < 60) {
        var n = W.rate((1 - alt / 60) * 9, dt), gy = Tn.height(p.x + ox, p.z + oz) + 0.4;
        for (var i = 0; i < n; i++) {
          var a = Math.random() * 6.283, r0 = 2 + Math.random() * 4, sp = 12 + Math.random() * 22;
          W.emit(p.x + ox + Math.cos(a) * r0, gy, p.z + oz + Math.sin(a) * r0, { vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.6, vz: Math.sin(a) * sp, life: 1.25, size: 1.5, grow: 3.6, color: st.dustCol, alpha: 0.42, grav: 0 });
        }
      }
    }
    $('cine-data').textContent = landed ? 'ALT 000 m   ·   ENGINE OFF   ·   ' + st.F.name + ' SURFACE'
      : 'ALT ' + ('00' + Math.round(alt)).slice(-3) + ' m   ·   DESCENT ' + vel.toFixed(1) + ' m/s   ·   FUEL ' + Math.round(11 - 6 * u) + '%';
  }
  function touchdown() {
    var p = st.pad;
    Au.stopLoop('descent'); Au.play('touchdown'); W.cam.shake = 0.75;
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * 6.283, sp = 6 + Math.random() * 16;
      W.emit(p.x + Math.cos(a) * 4, p.y + 0.5, p.z + Math.sin(a) * 4, { vx: Math.cos(a) * sp, vy: 1 + Math.random() * 3, vz: Math.sin(a) * sp, life: 2.2 + Math.random(), size: 1.3, grow: 3.6, color: st.dustCol, alpha: 0.34, grav: W.gravity * 0.1 });
    }
  }

  // ---------- shot 2: off the landing pad, the first bootprint ----------
  // You stand at the edge of the launch pad (0.3 m above the dust, with a sloping rim). To touch the dust you
  // bend your left knee and lean out, and your right boot reaches past the rim; then you pull it back to look
  // at the print, and step down for real.
  var REACH = { fwd: 0.26, drop: 0.43 };      // how far the body leans out and sinks while the boot reaches down
  function shotStep(t) {
    var e = st.eye, tau = t - TM.step, S = st.S, f = st.e, yaw = st.yawE;
    var r = ease(seg(tau, 1.3, 2.3)) * (1 - ease(seg(tau, 3.2, 4.1))) + ease(seg(tau, 6.0, 6.9)), b = ease(seg(tau, 6.9, 8.0));
    var up = ease(seg(tau, 7.6, 9.2));
    var go = lerp(REACH.fwd * r, STEP, b), drop = REACH.drop * r * (1 - b);
    st.lean = 0.34 * (1 - up);                 // bending over to see your boots: your head goes out ahead of them
    // and while the right boot goes out, you lean over to its outer side to watch it (your own leg would hide it)
    st.headSide = -0.2 * ease(seg(tau, 0.8, 1.8)) * (1 - ease(seg(tau, 6.6, 8.2)));
    var lx = Math.cos(yaw), lz = -Math.sin(yaw);                   // your left
    e.x = S.x + f.x * (go + st.lean) + lx * st.headSide; e.z = S.z + f.z * (go + st.lean) + lz * st.headSide;
    e.y = lerp(st.padTop, st.groundP1, b) - drop + EYE - 0.06 * (1 - up) + Math.sin(t * 1.3) * 0.006;
    e.yaw = yaw + Math.sin(t * 0.6) * 0.02; st.bodyYaw = yaw;
    e.pitch = lerp(-1.34, -0.05, up);
    e.roll = 0; e.fov = 54;
    // the right boot goes out to the print and back (and out again); the left one follows it down at the end
    st.feet[1] = swing(st.home[1], st.print[1], r, 0.14);
    st.feet[0] = swing(st.home[0], st.print[0], b, 0.14);
    if (!st.fx.r && tau >= 2.3) { st.fx.r = 1; footfall(st.print[1].x, st.print[1].z, yaw, true); W.cam.shake = 0.07; }
    if (!st.fx.r2 && tau >= 6.9) { st.fx.r2 = 1; Au.play('land'); W.cam.shake = 0.05; }
    if (!st.fx.l && tau >= 8.0) { st.fx.l = 1; footfall(st.print[0].x, st.print[0].z, yaw, true); W.cam.shake = 0.05; }
  }

  // ---------- shots 3 and 4: walking, with a head that bobs and a little hop ----------
  function walk(dt, speed, x0, z0) {
    var e = st.eye, f = st.e, w = st.w;
    if (w.air) {                                    // a low-gravity hop, using the real gravity
      w.vy -= W.gravity * dt; w.hop += w.vy * dt;
      if (w.hop <= 0) { w.hop = 0; w.air = false; footfall(e.x, e.z, st.yawE, true); W.cam.shake = 0.16; }
    }
    w.dist += speed * dt * (w.air ? 1.25 : 1);
    var m = clamp(speed / 2.2, 0, 1) * (w.air ? 0 : 1), sway = Math.sin(w.phase * 0.5), stride = Math.PI / 4.2 / 2;
    if (!w.air) {
      w.phase += speed * dt * 4.2;
      var step = Math.floor(w.phase / Math.PI);
      // each half-turn of the phase one boot comes down (the left on odd ones): the print goes where it lands
      if (step !== w.step) { w.step = step; var land = spot(step % 2 ? 0 : 1, e.x, e.z, st.yawE, stride * m); footfall(land.x, land.z, st.yawE, false); }
    }
    e.x = x0 + f.x * w.dist + Math.cos(st.yawE) * sway * 0.035 * m;
    e.z = z0 + f.z * w.dist - Math.sin(st.yawE) * sway * 0.035 * m;
    e.y = Tn.height(e.x, e.z) + EYE + Math.abs(Math.sin(w.phase)) * 0.055 * m + w.hop;
    e.roll = sway * 0.012 * m;
    st.bodyYaw = st.yawE;
    // the boots: each swings ahead while lifted and slides back under you while planted; in a hop both tuck up
    for (var i = 0; i < 2; i++) {
      var p = w.phase + i * Math.PI, ft = spot(i, e.x, e.z, st.yawE, -Math.cos(p) * stride * m);
      ft.y += Math.max(0, Math.sin(p)) * 0.13 * m + (w.air ? Math.min(0.16, w.hop * 0.5) : 0);
      st.feet[i] = ft;
    }
  }
  function shotWalk(t, dt) {
    var e = st.eye, tau = t - TM.walk, speed = 2.3 * ease(seg(tau, 0, 1.4));
    if (!st.fx.hop && tau >= 6.4) { st.fx.hop = 1; st.w.air = true; st.w.vy = st.F.hop; Au.play('jump'); }
    walk(dt, speed, st.P1.x, st.P1.z);
    var glance = ease(seg(tau, 1.6, 4.2)) * (1 - ease(seg(tau, 7.4, 10.4)));
    e.yaw = st.yawE + glance * 0.62 + Math.sin(tau * 0.5) * 0.03;
    e.pitch = -0.05 + glance * 0.03 + (st.w.air ? 0.05 : 0) + Math.sin(tau * 0.7) * 0.012;
    e.fov = 54;
  }
  function speed2(tau) { var len = TM.sit - TM.walk2; return 2.35 * ease(seg(tau, -0.4, 0.8)) * (1 - ease(seg(tau, len - 1.5, len))); }
  function walk2Length() {                 // how far that walk covers, so it ends right at the rock
    var d = 0, h = 1 / 60;
    for (var x = TM.cut + 0.75 - TM.walk2; x < TM.sit - TM.walk2; x += h) d += speed2(Math.max(0, x)) * h;
    return d;
  }
  function shotWalk2(t, dt) {
    var e = st.eye, tau = t - TM.walk2, len = TM.sit - TM.walk2;
    var speed = speed2(tau);
    walk(dt, speed, st.P2.x, st.P2.z);
    e.yaw = st.yawE + Math.sin(tau * 0.6) * 0.03;
    e.pitch = -0.06 - 0.12 * ease(seg(tau, 1, len));
    e.fov = 54;
  }

  // ---------- shot 5: turn around and sit down ----------
  // You stop just short of the rock, turn round in two small steps so your boots end up where they will rest,
  // then lower yourself back onto the rock's front edge: the boots stay planted, the knees bend over the edge.
  function shotSit(t) {
    var e = st.eye, tau = t - TM.sit, C = st.C, Q2 = st.Q2;
    if (!st.fx.q) { st.fx.q = 1; st.Q = { x: e.x, z: e.z }; st.ft0 = st.feet.slice(); }   // start from exactly where the walk ended
    var Q = st.Q, turn = ease(seg(tau, 0, 2.5)), shuffle = ease(seg(tau, 0.2, 2.0)), back = ease(seg(tau, 1.9, 3.3)), down = ease(seg(tau, 2.2, 3.5));
    var bx = lerp(lerp(Q.x, Q2.x, shuffle), C.x, back), bz = lerp(lerp(Q.z, Q2.z, shuffle), C.z, back);
    e.yaw = lerp(st.yawE, st.yawSit, turn); st.bodyYaw = e.yaw;
    bendOver(ease(seg(tau, 2.6, 3.9)));            // seated, you bend forward a little to look down past your knees
    e.x = bx + Math.sin(e.yaw) * st.lean; e.z = bz + Math.cos(e.yaw) * st.lean;
    e.y = lerp(Tn.height(bx, bz) + EYE, st.seatY, down) - st.duck + (tau > 3.5 ? Math.exp(-(tau - 3.5) * 5) * -0.05 * Math.cos((tau - 3.5) * 14) : 0);
    e.pitch = lerp(-0.18, 0.02, ease(seg(tau, 0, 1.6))) + lerp(0, -0.84, ease(seg(tau, 2.5, 3.8)));
    e.roll = Math.sin(turn * Math.PI) * -0.03; e.fov = 54;
    st.sitQ = down;
    st.feet[0] = swing(st.ft0[0], st.F[0], seg(tau, 0.25, 1.15), 0.1);
    st.feet[1] = swing(st.ft0[1], st.F[1], seg(tau, 1.05, 1.95), 0.1);
    if (!st.fx.sit && tau >= 3.4) { st.fx.sit = 1; Au.play('land'); W.cam.shake = 0.08; W.dust(C.x, C.z, 6, 1, 0.35); }
  }

  function bendOver(u) { st.lean = 0.16 * u; st.duck = 0.1 * u; }

  // ---------- shot 6: the view ----------
  function shotVista(t) {
    var e = st.eye, tau = t - TM.vista, C = st.C;
    bendOver(1 - ease(seg(tau, 0.2, 3.0)));        // and sit back up as you raise your eyes to the view
    e.x = C.x + Math.sin(st.yawSit) * st.lean; e.z = C.z + Math.cos(st.yawSit) * st.lean;
    e.y = st.seatY - st.duck + Math.sin(t * 1.1) * 0.006;
    e.pitch = lerp(-0.82, st.pitchEnd, ease(seg(tau, 0.3, 3.2)));
    e.yaw = lerp(st.yawSit, st.yawEnd, ease(seg(tau, 1.8, 10.6)));
    e.fov = lerp(54, 44, ease(seg(tau, 2, 14))); e.roll = 0;
    st.bodyYaw = st.yawSit; st.sitQ = 1;
    st.feet[0] = st.F[0]; st.feet[1] = st.F[1];
  }

  // The seat rock as it really is (its model, not a guess): along the way you will face when sitting, how high its
  // top is, where its front edge drops away, and where its foot meets the ground. Looks a little to each side too,
  // so both boots and both legs clear it.
  function measureSeat(R, dir) {
    var rock = Tn.seatRock, gy = Tn.height(R.x, R.z), out = { top: gy + (Tn.seatTop || 0.6), edge: 1.25, clear: 1.45 };
    if (!rock) return out;
    var rc = new T.Raycaster(), o = new T.Vector3(), down = new T.Vector3(0, -1, 0), sx = dir.z, sz = -dir.x;
    rock.updateMatrixWorld(true);
    function h(s, side) {
      o.set(R.x + dir.x * s + sx * side, gy + 6, R.z + dir.z * s + sz * side); rc.set(o, down);
      var hit = rc.intersectObject(rock, false);
      return hit.length ? hit[0].point.y : -1e9;
    }
    function ground(s, side) { return Tn.height(R.x + dir.x * s + sx * side, R.z + dir.z * s + sz * side); }
    var top = -1e9, s;
    for (s = 0; s <= 1; s += 0.05) top = Math.max(top, h(s, 0));
    if (top < gy) return out;
    out.top = top; out.edge = 0; out.clear = 0;
    [-0.3, 0, 0.3].forEach(function (side) {
      var se = 0, sc = 0, y;
      for (s = 0.5; s < 4; s += 0.02) {
        y = h(s, side);
        if (!se && y < top - 0.06) se = s;
        if (y < ground(s, side) + 0.03) { sc = s; break; }
      }
      out.edge = Math.max(out.edge, se || s); out.clear = Math.max(out.clear, sc || s);
    });
    out.top = Math.max(h(out.edge - 0.1, 0), h(out.edge - 0.25, 0), gy + 0.3);   // the top where you actually sit
    return out;
  }

  // ---------- the running order ----------
  function events(s) {
    return [
      { t: 0.05, fn: function () { title(s.site.place, s.site.title, JA.pick(s, FILM).title); } },
      { t: TM.descent - 0.5, fn: function () { title(); cls('win', true); cls('data', true); U.fade(false); } },
      { t: TM.land, fn: touchdown },
      { t: TM.fade1, fn: function () { U.fade(true); } },
      { t: TM.fade1 + 0.9, fn: function () { cls('win', false); cls('data', false); title('Hatch open', '', ''); Au.play('hiss'); } },
      { t: TM.step - 0.7, fn: function () { title(); cls('visor', true); cls('data', true); st.body = true; U.fade(false); Au.scene({ place: 'out', site: s.site.id, dust: W.env.dust }); } },
      { t: TM.cut, fn: function () { U.fade(true); } },
      { t: TM.cut + 0.75, fn: function () { st.w.dist = 0; st.w.hop = 0; st.w.air = false; U.fade(false); } },
      { t: TM.vista + 0.4, fn: function () { cls('bars', true); cls('soft', true); cls('data', false); if (!Au.music('vista')) Au.play('pad'); } },
      { t: TM.title, fn: function () { title(s.site.dayWord + ' 1 · ' + s.site.place, 'Astro Outpost', 'Your mission begins'); } },
      { t: TM.fade2, fn: function () { U.fade(true); } }
    ];
  }

  I.play = function (site, done) {
    var s = JA.game.s, L = Tn.L, pad = { x: L.rocket[0], z: L.rocket[1] }, R = { x: L.seat[0], z: L.seat[1] };
    pad.y = Tn.height(pad.x, pad.z);
    var hl = Math.hypot(pad.x, pad.z), dir = { x: -pad.x / hl, z: -pad.z / hl };          // the rocket faces the habitat
    var el = Math.hypot(R.x - pad.x, R.z - pad.z), e = { x: (R.x - pad.x) / el, z: (R.z - pad.z) / el };   // the way you walk
    var yawE = Math.atan2(e.x, e.z);
    var S = { x: pad.x + e.x * 11.35, z: pad.z + e.z * 11.35 };                     // standing at the very edge of the landing pad
    // sitting: hips just behind the rock's front edge, boots planted on the ground in front of it
    var seat = measureSeat(R, { x: -e.x, z: -e.z });
    // the boots go as far out as the legs comfortably reach from that seat (knees still a little bent), so the
    // toes show past your knees when you look down; never closer than the rock's foot allows
    var sC = seat.edge - 0.11, gF = Tn.height(R.x - e.x * (sC + 0.7), R.z - e.z * (sC + 0.7));
    var drop = seat.top + SEAT_HIP - gF - SOLE_Y, out = Math.sqrt(Math.max(0.04, Math.pow(0.95 * (THIGH + SHIN), 2) - drop * drop));
    var sF = Math.max(sC + 0.06 + Math.min(out, 0.62) + SOLE_Z, seat.clear + 0.27), sQ = Math.max(seat.edge, seat.clear) + 0.44;
    var C = { x: R.x - e.x * sC, z: R.z - e.z * sC };
    var yawRocket = Math.atan2(pad.x - C.x, pad.z - C.z), yawSit = near(yawRocket, yawE + Math.PI);
    var yawHab = near(Math.atan2(-C.x, -C.z), yawSit), F = JA.pick(site, FILM);
    F.name = JA.siteOf(site).short.toUpperCase();
    var yawEarth = near(Math.atan2(-0.5, -0.84), yawSit);
    st = {
      t: 0, done: done, F: F, pad: pad, dir: dir, dirYaw: Math.atan2(dir.x, dir.z), e: e, yawE: yawE, S: S, R: R, C: C,
      P1: { x: S.x + e.x * STEP, z: S.z + e.z * STEP }, P2: { x: R.x - e.x * (sQ + walk2Length()), z: R.z - e.z * (sQ + walk2Length()) }, Q: null,
      Q2: { x: R.x - e.x * (sF - 0.06 - SOLE_Z), z: R.z - e.z * (sF - 0.06 - SOLE_Z) },
      seatY: seat.top + SEAT_HIP - HIP_SIT, seat: seat,
      padTop: A.groundAt(S.x, S.z), groundP1: Tn.height(S.x + e.x * STEP, S.z + e.z * STEP),
      yawSit: yawSit, yawEnd: F.faceEarth ? yawHab * 0.45 + yawEarth * 0.55 : yawHab - 0.42, pitchEnd: F.endPitch,
      eye: { x: pad.x, y: pad.y + 260, z: pad.z, yaw: 0, pitch: -1, roll: 0, fov: 58 },
      w: { phase: 0, step: 0, dist: 0, hop: 0, vy: 0, air: false },
      sitQ: 0, lean: 0, headSide: 0, duck: 0, body: false, bodyYaw: yawE, fx: {}, rum: 0, lineOff: 0,
      dustCol: JA.siteOf(site).colors.dust, cues: script(s), ci: 0, ev: events(s), ei: 0, breath: 2
    };
    // the boots: standing on the pad, the prints out on the dust past its sloping rim, and resting by the rock
    st.home = [spot(0, S.x, S.z, yawE), spot(1, S.x, S.z, yawE)];
    st.print = [spot(0, S.x, S.z, yawE, PRINT_AHEAD), spot(1, S.x, S.z, yawE, PRINT_AHEAD)];
    st.feet = st.home.slice();
    st.F = [spot(0, C.x, C.z, yawSit, sF - sC - 0.06 - SOLE_Z), spot(1, C.x, C.z, yawSit, sF - sC - 0.06 - SOLE_Z)];
    st.F.forEach(function (p) { p.y = Tn.height(p.x, p.z); });
    st.rig = buildRig(JA.game.opts.suit);
    Au.music(null); Au.scene({ place: 'cabin', site: site });
    st.cues.forEach(function (c) { if (c.vo) Au.preloadVoice(VO + c.vo + '.mp3'); });   // this film's lines, ready before they are needed
    A.astro.mode = 'hidden';
    W.env.t = F.light;
    W.cam.mode = 'cine';
    $('cine').className = ''; $('cine-line').className = ''; title();
    document.body.classList.add('cine');
    U.fade(true);
    shotDescent(TM.descent, 0); setCam(); poseRig(0);
  };

  I.step = function (dt) {
    if (!st || st.finished) return;
    var t = st.t += dt;
    while (st.ei < st.ev.length && t >= st.ev[st.ei].t) st.ev[st.ei++].fn();
    while (st.ci < st.cues.length && t >= st.cues[st.ci].t) say(st.cues[st.ci++]);
    if (st.lineOff && t >= st.lineOff && !Au.voicePlaying()) { st.lineOff = 0; $('cine-line').className = ''; }   // keep the words up while they are spoken
    if (t < TM.fade1 + 0.9) shotDescent(Math.max(t, TM.descent), dt);
    else if (t < TM.step - 0.7) { /* darkness, and the hiss of the hatch */ }
    else if (t < TM.walk) shotStep(t);
    else if (t < TM.cut + 0.75) shotWalk(t, dt);
    else if (t < TM.sit) shotWalk2(Math.max(t, TM.walk2), dt);
    else if (t < TM.vista) shotSit(t);
    else shotVista(t);
    if (st.body) { st.breath -= dt; if (st.breath <= 0) { st.breath = 3.6; Au.play('breath'); } }
    setCam(); poseRig(dt);
    if (st.body && t < TM.vista) $('cine-data').textContent = 'O₂ ' + Math.round(100 - (t - TM.step) * 0.05) + '%   ·   SUIT 21°C   ·   ♥ ' + Math.round(88 + Math.sin(t * 0.4) * 6);
    if (t >= TM.end) finish();
  };

  function finish() {
    if (!st || st.finished) return;
    st.finished = true;
    var done = st.done, rk = B.P.rocket;
    rk.group.position.set(0, 0, 0); rk.flame.visible = false; rk.light.intensity = 0;
    W.root.remove(st.rig.group); W.root.remove(st.rig.shadow);
    Au.stopAll();
    $('cine').className = 'hidden'; $('cine-line').className = ''; title();
    document.body.classList.remove('cine');
    W.cam.shake = 0; W.cam.cine.roll = 0;
    st = null;
    done();
  }
  I.time = function () { return st ? st.t : -1; };      // lets tests step through the film
  I.peek = function () { return st ? { C: st.C, F: st.F, feet: st.feet, seatY: st.seatY, print: st.print, home: st.home, seat: st.seat, rig: st.rig } : null; };   // and look at where the boots go
  I.skip = function () {
    if (!st || st.skipping) return;
    st.skipping = true; U.fade(true);
    setTimeout(finish, 420);
  };
})(window.JA);
