/* Astro Outpost — the lookout rock: sit down, and simply look.
   The flat rock where the landing film ends (Tn.L.seat) is the crew's lookout. Walk up to it and press E:
   the astronaut steps in front of it, turns, sits down and leans back on his hands, and the camera settles
   behind his shoulder with a long lens, so the helmet stays in the foreground and a distant world looks big
   without being drawn bigger than it is. Then a slow reveal, and the player can look around, zoom, switch
   to the view through the visor (V), and stand up again (E) whenever they like.
     Moon  Earth hangs low over the lit outpost, in a black sky full of stars and the Milky Way.
     Mars  the real Martian sky: butterscotch by day, blue around a sunset at the end of the shift; once it is
           dark enough, the stars, the Milky Way and Earth as a bright blue-white evening star near the Sun.
   Sound stays inside the suit: breathing, the suit's hum, the outpost far away, and quiet music.
   The mission clock waits while you sit (game.js does not run the rules in this mode).
   This file only drives the astronaut, the camera, the overlay and the deeper sky (world.js W.observe);
   game.js decides when it starts and passes input in. */
(function (JA) {
  'use strict';
  var T = window.THREE;
  function noop() {}
  var O = JA.observe = { active: function () { return false; }, build: noop, offer: noop, start: noop, step: noop, look: noop, zoom: noop, stand: noop, toggleView: noop, near: function () { return 1e9; } };
  if (!T) return;
  var W = JA.world, Tn = JA.terrain, A = JA.actors, Au = JA.audio;
  var st = null, site = 'moon', seat = null, ui = null;
  var v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3();
  var S = 0.84, HIP = 0.86;          // the astronaut's scale and hip height in model units (js/actors.js RIG)

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function angLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

  // ---------- the rock, and which way the seat faces ----------
  O.build = function (root, siteId) {
    site = siteId; st = null;
    var L = Tn.L, R = { x: L.seat[0], z: L.seat[1] }, g0 = Tn.height(R.x, R.z), top = g0 + (Tn.seatTop || 0.62);
    // Moon: face Earth, which hangs above the outpost from here. Mars: face between the outpost and the west, so the
    // sunset at the end of the shift (and Earth, the evening star beside it) is in the picture.
    var yaw = siteId === 'moon' ? Math.atan2(W.EARTH_DIR.x, W.EARTH_DIR.z) : Math.atan2(-R.x, -R.z) + 0.44;
    var fx = Math.sin(yaw), fz = Math.cos(yaw);
    // the real height of the rock's surface at a point (a ray straight down onto the rock mesh)
    var ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
    function surface(x, z) {
      if (!W.seatRock) return top;
      W.seatRock.updateMatrixWorld(true); ray.set(new T.Vector3(x, top + 3, z), down);
      var hit = ray.intersectObject(W.seatRock, true)[0];
      return hit ? hit.point.y : top;
    }
    var edge = 1.0, sx = R.x + fx * edge, sz = R.z + fz * edge;
    seat = {
      R: R, yaw: yaw, fx: fx, fz: fz, top: top,
      hip: { x: sx, y: surface(sx, sz) + 0.02, z: sz },                                // where the hips rest, near the front edge
      front: { x: R.x + fx * 1.85, z: R.z + fz * 1.85 }                                // where he stands before he sits
    };
    // a folded gold thermal blanket on the rock: the crew's sit-pad, so the rock reads as a seat
    var px = R.x + fx * 0.82, pz = R.z + fz * 0.82;
    var pad = new T.Group(); pad.position.set(px, surface(px, pz) + 0.008, pz); pad.rotation.y = yaw; root.add(pad);
    var foil = new T.MeshStandardMaterial({ color: 0xd9a845, metalness: 0.85, roughness: 0.38, emissive: 0x2a1a00, emissiveIntensity: 0.25 });
    var m = new T.Mesh(new T.BoxGeometry(0.66, 0.035, 0.5), foil); m.castShadow = true; m.receiveShadow = true; pad.add(m);
    var m2 = new T.Mesh(new T.BoxGeometry(0.62, 0.02, 0.22), foil); m2.position.set(0, 0.026, -0.12); m2.rotation.x = 0.06; m2.castShadow = true; pad.add(m2);
    var strap = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 0.52), new T.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.8 }));
    strap.position.set(0.22, 0.012, 0); pad.add(strap);
    seat.pad = pad;
  };
  O.near = function (p) { return seat ? Math.hypot(p.x - seat.R.x, p.z - seat.R.z) : 1e9; };
  // what E does next to the rock (called from game.js findAction)
  O.offer = function (s, p, offer, run) {
    if (!seat || st) return;
    offer(O.near(p) - 1.55, 1.9, { label: 'Sit and observe', run: run });
  };

  // ---------- the little overlay: two thin cinema bars, a few quiet lines, one hint ----------
  function buildUi() {
    if (ui) return ui;
    var el = document.createElement('div'); el.id = 'observe'; el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<i class="ob-bar top"></i><i class="ob-bar bottom"></i>' +
      '<div class="ob-info"><b></b><span class="l1"></span><span class="l2"></span><span class="l3"></span><small></small></div>' +
      '<div class="ob-lapse"><i></i>Time-lapse · sunset on Mars</div><i class="ob-fade"></i>' +
      '<button class="ob-hint" type="button"><kbd>E</kbd> Stand up <em>· drag to look around · wheel to zoom · <kbd>V</kbd> visor</em></button>';
    document.body.appendChild(el);
    ui = { el: el, info: el.querySelector('.ob-info'), hint: el.querySelector('.ob-hint') };
    ui.hint.addEventListener('click', function () { O.stand(); });        // touch screens: tap to stand up (bound once)
    return ui;
  }
  function infoText(s, darkNow) {
    var moon = site === 'moon', place = s && s.site ? s.site.place : '';
    if (moon) return { b: place + ' · The Moon', l1: 'Earth is 384,400 km away. Its light takes 1.3 seconds to get here.', l2: 'The sky is black even at noon: there is no air to scatter sunlight.',
      l3: 'No air means no shooting stars. Watch instead for tiny flashes where space dust hits the ground.' };
    var date = s && JA.sim.weather(s).date, mins = date && JA.weather ? JA.weather.marsDelayMin(date) : 0;
    var dist = mins ? Math.round(mins * 60 * 299792.458 / 1e6) + ' million km away' : 'many millions of km away';
    var dark = darkNow != null ? darkNow : (W.skyDark && W.skyDark() > 0.35);
    return { b: place + ' · Mars', l1: 'Earth is ' + dist + (mins ? '. A radio call takes ' + Math.round(mins) + ' minutes.' : '.'),
      l2: dark ? 'The bright blue-white star low in the west is Earth. The faint dot beside it is our Moon.' : 'By day the dusty sky glows butterscotch. Sunsets here are blue.',
      l3: dark ? 'Shooting stars here are grains of space dust burning up in the thin air.' : 'Stay a while: the Sun is about to set.' };
  }
  function setInfo(t) {
    var i = ui.info;
    i.querySelector('b').textContent = t.b; i.querySelector('.l1').textContent = t.l1; i.querySelector('.l2').textContent = t.l2; i.querySelector('.l3').textContent = t.l3 || '';
  }

  // ---------- start ----------
  // ctx: { s, pov (helmet view on?), done: function () {} called once he is standing again }
  O.active = function () { return !!st; };
  O.start = function (ctx) {
    if (st || !seat) return false;
    var a = A.astro, c = W.camera, u = buildUi(), t = infoText(ctx.s);
    st = { t: 0, phase: 'walk', done: ctx.done, s: ctx.s, visor: 0, wantVisor: !!ctx.pov, yawU: 0, pitchU: 0, zoom: 1, fov: c.fov,
      c0: c.position.clone(), l0: W.cam.look.clone(), from: { x: a.pos.x, z: a.pos.z, yaw: a.yaw }, standT: 0, music: false, breath: 0, info: 0 };
    a.mode = 'sit'; a.sitK = 0; a.relaxK = 0; a.look = 0; a.sitWalk = 1; a.vel.set(0, 0, 0);
    if (a.fp && A.setFirstPerson) A.setFirstPerson(false);         // the body must be seen from behind the shoulder
    W.cam.mode = 'cine'; W.cam.cine.roll = 0;
    setInfo(t);
    // Mars: the time-lapse runs the sky on from now to a starry night (the mission clock stays where it was)
    st.lapse = site === 'mars'; st.sky0 = W.env.t; st.darkInfo = W.skyDark && W.skyDark() > 0.35;
    u.info.querySelector('small').textContent = 'The mission clock waits while you rest.';
    u.el.className = 'on'; document.body.classList.add('observing');
    return true;
  };

  // ---------- the shot ----------
  // Behind the right shoulder, low, with a long lens. ψ (yaw) and θ (pitch) are where the view points.
  function shot(out, look, H, yaw, pitch, dist, side, up) {
    var cp = Math.cos(pitch), fx = Math.sin(yaw), fz = Math.cos(yaw);
    out.set(H.x - fx * dist - fz * side, H.y + up, H.z - fz * dist + fx * side);
    var gy = Tn.height(out.x, out.z) + 0.35; if (out.y < gy) out.y = gy;
    look.set(out.x + fx * cp * 60, out.y + Math.sin(pitch) * 60, out.z + fz * cp * 60);
  }
  function headPoint(out) {                          // the middle of the helmet when seated
    return out.set(seat.hip.x - seat.fx * 0.08, seat.hip.y + 0.86, seat.hip.z - seat.fz * 0.08);
  }

  // input: { x, z } from the keys or stick (looks around slowly), stand: true to stand up
  O.step = function (dt, input) {
    if (!st) return;
    var a = A.astro, t = st.t += dt, moon = site === 'moon', ph = st.phase;
    // ---- the astronaut ----
    if (ph === 'walk') {
      // step to the front of the rock, then turn your back to it
      var fx = seat.front.x - a.pos.x, fz = seat.front.z - a.pos.z, d = Math.hypot(fx, fz);
      if (d > 0.08 && t < 3) {
        var sp = Math.min(2.4, d * 3);
        a.vel.set(fx / d * sp, 0, fz / d * sp); a.sitWalk = sp;
        a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
        a.yaw = angLerp(a.yaw, Math.atan2(fx, fz), Math.min(1, dt * 8));
      } else { a.vel.set(0, 0, 0); a.sitWalk = 0.01; a.yaw = angLerp(a.yaw, seat.yaw, Math.min(1, dt * 5)); }
      a.pos.y = Tn.height(a.pos.x, a.pos.z);
      if ((d <= 0.08 || t >= 3) && Math.abs(angLerp(a.yaw, seat.yaw, 1) - a.yaw) < 0.06) { st.phase = 'sit'; st.t0 = t; st.p0 = { x: a.pos.x, y: a.pos.y, z: a.pos.z }; a.sitWalk = 0; }
    } else if (ph === 'sit' || ph === 'view') {
      var k = ease(seg(t - st.t0, 0, 1.5)), r = ease(seg(t - st.t0, 1.7, 3.0));
      var sy = seat.hip.y - HIP * S;                                   // where his feet-level origin goes when the hips rest on the rock
      a.sitK = k; a.relaxK = r; a.yaw = angLerp(a.yaw, seat.yaw, Math.min(1, dt * 4));
      a.pos.x = lerp(st.p0.x, seat.hip.x, ease(seg(t - st.t0, 0.25, 1.4)));
      a.pos.z = lerp(st.p0.z, seat.hip.z, ease(seg(t - st.t0, 0.25, 1.4)));
      a.pos.y = lerp(st.p0.y, sy, ease(seg(t - st.t0, 0.3, 1.5))) - Math.sin(Math.PI * seg(t - st.t0, 1.2, 1.7)) * 0.025;
      a.look = lerp(a.look, clamp(st.yawU, -0.5, 0.5), Math.min(1, dt * 2));
      if (ph === 'sit' && t - st.t0 >= 1.5) {
        st.phase = 'view'; st.tv = t;
        Au.play('land', { vol: 0.35 }); W.dust(a.pos.x - seat.fx * 0.3, a.pos.z - seat.fz * 0.3, 5, 0.8, 0.3);
      }
    } else if (ph === 'stand') {
      var u = t - st.standT, rk = 1 - ease(seg(u, 0, 0.7)), kk = 1 - ease(seg(u, 0.5, 1.6));
      a.relaxK = Math.min(a.relaxK, rk); a.sitK = Math.min(a.sitK, kk); a.look = lerp(a.look, 0, Math.min(1, dt * 3));
      var m = ease(seg(u, 0.6, 1.7));
      a.pos.x = lerp(seat.hip.x, seat.front.x, m); a.pos.z = lerp(seat.hip.z, seat.front.z, m);
      a.pos.y = lerp(seat.hip.y - HIP * S, Tn.height(seat.front.x, seat.front.z), ease(seg(u, 0.6, 1.6)));
    }

    // ---- looking around: keys and stick turn the view slowly (drag and wheel come through O.look / O.zoom) ----
    if (ph === 'view' && input) {
      st.yawU = clamp(st.yawU - (input.x || 0) * dt * 0.7, -2.4, 2.4);
      st.pitchU = clamp(st.pitchU - (input.z || 0) * dt * 0.45, -0.32, 0.62);
    }
    st.visor = lerp(st.visor, st.wantVisor && ph === 'view' ? 1 : 0, Math.min(1, dt * 2.6));
    if (A.setFirstPerson) { var fp = st.visor > 0.5; if (fp !== !!a.fp) A.setFirstPerson(fp); }

    // ---- the camera ----
    var H = headPoint(v3), tv = ph === 'view' ? t - st.tv : (ph === 'stand' ? 99 : 0);
    var rev = ease(seg(tv, 0.8, 9));                                   // the slow reveal after he has settled
    var yaw = seat.yaw + 0.14 + st.yawU, pitch = lerp(0.02, moon ? 0.11 : 0.07, rev) + st.pitchU;
    var breathe = Math.sin(W.time * 1.45) * 0.006;
    // a tall phone screen sees less from side to side: a wider lens, and the astronaut nearer the middle
    var asp = W.camera.aspect || 1.6, narrow = clamp(asp / 1.35, 0.4, 1);
    shot(v1, v2, H, yaw, pitch, lerp(2.6, 4.1, rev), lerp(0.8, 1.05, rev) * narrow, lerp(0.14, 0.42, rev) + breathe);
    var fov = Math.min(78, lerp(46, 36, rev) / Math.sqrt(narrow)) * st.zoom;
    if (st.visor > 0.001) {                                            // through the visor: eyes in the helmet, legs below
      var ex = H.x + Math.sin(yaw) * 0.14, ey = H.y + 0.04 + breathe, ez = H.z + Math.cos(yaw) * 0.14, cp = Math.cos(pitch);
      v1.lerp(v3.set(ex, ey, ez), st.visor);
      v2.lerp(v3.set(ex + Math.sin(yaw) * cp * 60, ey + Math.sin(pitch) * 60, ez + Math.cos(yaw) * cp * 60), st.visor);
      fov = lerp(fov, 60 * st.zoom, st.visor);
    }
    // from the gameplay camera into the shot (and back out again when standing)
    var into = ph === 'stand' ? 1 - ease(seg(t - st.standT, 0.2, 2.0)) : ease(seg(t, 0, 3.4));
    var c = W.cam.cine;
    if (ph === 'stand') {
      if (!st.back) { st.back = { pos: new T.Vector3(), look: new T.Vector3() }; }
      // where the normal camera will be: behind him, looking the way he faced
      var by = yaw + Math.PI, bp = 0.36, bd = W.cam.dist || 11, fo = v3.set(a.pos.x, a.pos.y + 1.7, a.pos.z);
      if (st.pov) { st.back.pos.set(a.pos.x, a.pos.y + 1.7, a.pos.z); st.back.look.set(a.pos.x - Math.sin(by) * 20, a.pos.y + 1.6, a.pos.z - Math.cos(by) * 20); }
      else { st.back.pos.set(fo.x + Math.sin(by) * Math.cos(bp) * bd, fo.y + Math.sin(bp) * bd, fo.z + Math.cos(by) * Math.cos(bp) * bd); st.back.look.copy(fo); }
      c.pos.copy(st.back.pos).lerp(v1, into); c.look.copy(st.back.look).lerp(v2, into);
      c.fov = lerp(st.pov ? 66 : 52, fov, into);
    } else {
      c.pos.copy(st.c0).lerp(v1, into); c.look.copy(st.l0).lerp(v2, into);
      c.fov = lerp(st.fov, fov, into);
    }
    c.roll = 0;

    // ---- the sky, the sound, the overlay ----
    var sky = ph === 'stand' ? 1 - ease(seg(t - st.standT, 0, 1.6)) : ease(seg(tv, 0.5, 7));
    W.observe(sky);
    // Mars: a time-lapse of the sunset, on into the night. Only the sky moves on; the mission clock does not.
    if (st.lapse) {
      if (ph === 'view') W.env.t = lerp(st.sky0, 1.22, ease(seg(tv, 2, 30)));
      else if (ph === 'stand' && !st.restored && t - st.standT > 0.7) { st.restored = true; W.env.t = st.sky0; }   // back to now, behind the fade
      var dk = W.skyDark() > 0.35;
      if (ph === 'view' && dk !== st.darkInfo) { st.darkInfo = dk; setInfo(infoText(st.s, dk)); }
    }
    st.breath -= dt; Au.breathe(dt, false);
    if (!st.music && tv > 1.2 && ph === 'view') { st.music = true; Au.music('vista'); }
    if (ui) {
      ui.el.classList.toggle('bars', ph !== 'stand' && t > 1.2);
      ui.el.classList.toggle('info', ph === 'view' && (st.lapse ? (tv > 5 && tv < 19) || (tv > 31 && tv < 52) : tv > 5 && tv < 26));
      ui.el.classList.toggle('lapse', !!st.lapse && ph === 'view' && tv > 2 && tv < 31);
      ui.el.classList.toggle('fade', !!st.lapse && ph === 'stand' && t - st.standT < 0.85);
      ui.el.classList.toggle('hint', ph === 'view' && tv > 2.5);
      ui.el.classList.toggle('quiet', ph === 'view' && tv > 11);
    }
    if (ph === 'stand' && t - st.standT >= 2.0) finish();
  };

  O.look = function (dx, dy) { if (!st || st.phase !== 'view') return; st.yawU = clamp(st.yawU - dx * 0.0042, -2.4, 2.4); st.pitchU = clamp(st.pitchU - dy * 0.0032, -0.32, 0.62); };
  O.zoom = function (dir) { if (!st) return; st.zoom = clamp(st.zoom * (dir > 0 ? 1.08 : 1 / 1.08), 0.55, 1.5); };
  O.toggleView = function () { if (!st || st.phase !== 'view') return; st.wantVisor = !st.wantVisor; Au.play('swish'); };
  // stand up (E, Escape, or the hint button); returns true when that started it
  O.stand = function (pov) {
    if (!st || st.phase === 'stand') return false;
    if (st.phase === 'walk') { finish(); return true; }               // not sat down yet: just stop
    st.phase = 'stand'; st.standT = st.t; st.pov = pov == null ? st.wantVisor : !!pov;
    Au.music(null); Au.play('swish', { vol: 0.5 });
    return true;
  };
  function finish() {
    if (!st) return;
    var a = A.astro, done = st.done, yaw = seat.yaw + 0.14 + st.yawU, pov = !!st.pov;
    if (st.lapse && !st.restored) W.env.t = st.sky0;
    a.sitK = 0; a.relaxK = 0; a.look = 0; a.sitWalk = 0; a.mode = 'walk'; a.vel.set(0, 0, 0);
    a.pos.y = Tn.height(a.pos.x, a.pos.z); a.onGround = true; a.vy = 0; a.yaw = yaw;
    W.observe(0);
    if (ui) ui.el.className = '';
    document.body.classList.remove('observing');
    st = null;
    if (done) done({ yaw: yaw, pov: pov });
  }
  // the game is leaving the surface (a modal, the night, a quit): drop out at once
  O.cancel = function () { if (st) { Au.music(null); finish(); } };
})(window.JA);
