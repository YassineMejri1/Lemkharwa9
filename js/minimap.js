/* Astro Outpost — the mini map (press M, or the 🗺️ button at the top right).
   A round map in the corner that turns with the camera, so "up" on the map is the way you are looking.
   It shows the buildings, the ice pit, the rocket pad and the rover, and the jobs: the one to do now
   (gold, pulsing, with its distance), the other jobs on today's list (gold rings) and the science spots.
   Anything farther than the map reaches sits on its rim, pointing the way.
   game.js gives it what to draw each frame (JA.minimap.draw(data)); this file only draws. */
(function (JA) {
  'use strict';
  var MM = JA.minimap = {};
  var RANGES = [45, 175];                    // metres from you to the rim: near (the outpost) and far (the whole area)
  var box, cv, ctx, foot, footIc, footTx, zoomBtn, zi = 0, shown = false, size = 0, dpr = 1, imgs = {};
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var BUILD = { hab: 'home', scrub: 'filter', rack: 'sun', air: 'air', food: 'food', bag: 'bag', lab: 'lab', comms: 'dish', rocket: 'rocket' };

  function $(id) { return document.getElementById(id); }
  function icon(name) {
    if (!imgs[name]) { var im = new Image(); im.src = 'assets/icons/' + name + '.svg'; imgs[name] = im; }
    return imgs[name];
  }
  // a goal's emoji as one of the drawn icons when there is one (icons.js keeps the list)
  function fileFor(emoji) { return JA.iconName ? JA.iconName(emoji) : null; }

  MM.init = function () {
    box = $('minimap'); if (!box) return;
    cv = box.querySelector('canvas'); ctx = cv.getContext('2d');
    foot = box.querySelector('.mm-foot'); footIc = foot.querySelector('.mm-ic'); footTx = foot.querySelector('.mm-tx');
    zoomBtn = box.querySelector('.mm-zoom');
    try { zi = localStorage.getItem('ja-map-zoom') === '1' ? 1 : 0; } catch (e) { zi = 0; }
    setZoomLabel();
    zoomBtn.addEventListener('click', function (e) {
      zi = 1 - zi; setZoomLabel();
      try { localStorage.setItem('ja-map-zoom', String(zi)); } catch (err) { /* private mode */ }
      if (JA.audio) JA.audio.play('tap');
      if (e.detail) zoomBtn.blur();
    });
    Object.keys(BUILD).forEach(function (k) { icon(BUILD[k]); }); icon('rover'); icon('ice');
  };
  function setZoomLabel() {
    zoomBtn.textContent = zi ? '−' : '+';
    zoomBtn.setAttribute('aria-label', zi ? 'Show the outpost up close' : 'Show the whole area');
    zoomBtn.title = zi ? 'Zoom in: the outpost' : 'Zoom out: the whole area';
  }

  MM.show = function (on) {
    if (!box || on === shown) return;
    shown = on;
    box.classList.toggle('hidden', !on);
    if (on && box.animate && !(calm && calm.matches)) box.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .3, 1)' });
  };

  // ---------- drawing ----------
  function fit() {
    var w = cv.clientWidth, r = Math.min(2, window.devicePixelRatio || 1);
    if (w !== size || r !== dpr) { size = w; dpr = r; cv.width = Math.round(w * r); cv.height = Math.round(w * r); }
  }
  function badge(x, y, rad, fill, edge, name, emoji, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (edge) { ctx.lineWidth = 1.5; ctx.strokeStyle = edge; ctx.stroke(); }
    var im = name && icon(name), s = rad * 1.3;
    if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x - s / 2, y - s / 2, s, s);
    else if (emoji) { ctx.font = Math.round(rad * 1.15) + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(emoji, x, y + 1); }
    ctx.globalAlpha = 1;
  }

  // d: { me, yaw, fx, fz, buildings: [{key, x, z}], goals: [{x, z, icon, now}], spots: [{x, z, icon, color}],
  //      rover, ice: {x, z, r}, pad: {x, z, r}, craters, playR, t }
  MM.draw = function (d) {
    if (!box || !shown || !d) return;
    fit();
    var sc = Math.max(0.7, Math.min(1, size / 224));   // smaller maps (small screens) get smaller markers
    var R = size / 2, rim = R - 16 * sc, range = RANGES[zi], k = rim / range;
    var fx = d.fx, fz = d.fz, fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    var mx = d.me.x, mz = d.me.z, pulse = calm && calm.matches ? 0.5 : 0.5 + 0.5 * Math.sin(d.t * 4);
    // world → map: "up" is the way the camera looks, "right" is the camera's right
    function px(x, z) { return R + (-(x - mx) * fz + (z - mz) * fx) * k; }
    function py(x, z) { return R - ((x - mx) * fx + (z - mz) * fz) * k; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    // the ground: a soft glow in the middle, range rings every 25 m (near) or 50 m (far)
    var g = ctx.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, 'rgba(40, 70, 140, 0.35)'); g.addColorStop(1, 'rgba(6, 20, 60, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(160, 190, 255, 0.1)';
    for (var rr = zi ? 50 : 15; rr < range; rr += zi ? 50 : 15) { ctx.beginPath(); ctx.arc(R, R, rr * k, 0, Math.PI * 2); ctx.stroke(); }
    // craters, the edge of the area you can explore, the ice pit, the rocket pad
    ctx.strokeStyle = 'rgba(200, 215, 255, 0.13)';
    (d.craters || []).forEach(function (c) {
      var x = px(c.x, c.z), y = py(c.x, c.z), r = c.r * k;
      if (x + r < 0 || x - r > size || y + r < 0 || y - r > size) return;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r), 0, Math.PI * 2); ctx.stroke();
    });
    if (d.playR) {
      ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255, 120, 140, 0.45)';
      ctx.beginPath(); ctx.arc(px(0, 0), py(0, 0), d.playR * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (d.ice) {
      ctx.beginPath(); ctx.arc(px(d.ice.x, d.ice.z), py(d.ice.x, d.ice.z), Math.max(4, d.ice.r * k), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79, 216, 255, 0.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(79, 216, 255, 0.5)'; ctx.stroke();
    }
    if (d.pad) {
      ctx.beginPath(); ctx.arc(px(d.pad.x, d.pad.z), py(d.pad.x, d.pad.z), Math.max(3, d.pad.r * k), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220, 225, 240, 0.1)'; ctx.fill();
    }
    // buildings: small dark discs with their drawn icon (near), or just light dots (far, where the outpost is tiny)
    // (a building with a job on it shows the job's marker instead; one past the rim is left out, not cut in half)
    var bR = (zi ? 6.5 : 10) * sc;
    d.buildings.forEach(function (b) {
      if (d.goals.some(function (gl) { return Math.hypot(gl.x - b.x, gl.z - b.z) < 7; })) return;
      var x = px(b.x, b.z), y = py(b.x, b.z);
      if (Math.hypot(x - R, y - R) > rim) return;
      if (zi) { ctx.beginPath(); ctx.arc(x, y, 2.6 * sc, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200, 215, 255, 0.75)'; ctx.fill(); return; }
      badge(x, y, bR, 'rgba(10, 22, 58, 0.92)', 'rgba(190, 210, 255, 0.35)', BUILD[b.key], null);
    });
    if (d.ice) badge(px(d.ice.x, d.ice.z), py(d.ice.x, d.ice.z), bR, 'rgba(10, 40, 70, 0.92)', 'rgba(79, 216, 255, 0.7)', d.ice.icon || 'ice', null);      // 'water' on a well planet
    if (d.rover) badge(px(d.rover.x, d.rover.z), py(d.rover.x, d.rover.z), bR, 'rgba(10, 40, 70, 0.92)', 'rgba(159, 232, 255, 0.8)', 'rover', null);
    ctx.restore();

    // science spots and jobs: inside the map where they are, or on the rim pointing the way
    var pins = [];
    d.spots.forEach(function (s) { pins.push({ x: s.x, z: s.z, emoji: s.icon, color: s.color, r: (zi ? 5.5 : 7) * sc, spot: true }); });
    // far away the other jobs are gold dots, so only the job to do now keeps its icon
    d.goals.forEach(function (gl) { pins.push({ x: gl.x, z: gl.z, emoji: gl.icon, color: '#ffd23f', r: (gl.now ? (zi ? 9 : 11) : (zi ? 6.5 : 9)) * sc, now: gl.now, spot: zi && !gl.now }); });
    pins.sort(function (a, b) { return (a.now ? 2 : a.spot ? 0 : 1) - (b.now ? 2 : b.spot ? 0 : 1); });     // the job to do now is drawn last, on top
    var nowPin = null;
    pins.forEach(function (p) {
      var x = px(p.x, p.z), y = py(p.x, p.z), dx = x - R, dy = y - R, dist = Math.hypot(dx, dy), out = dist > rim;
      if (out) { x = R + dx / dist * rim; y = R + dy / dist * rim; }
      if (p.spot) {
        ctx.globalAlpha = out ? 0.75 : 1;
        ctx.beginPath(); ctx.arc(x, y, p.r * 0.55, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(6, 14, 40, 0.9)'; ctx.stroke(); ctx.globalAlpha = 1;
        return;
      }
      if (p.now) {
        nowPin = p;
        ctx.beginPath(); ctx.arc(x, y, p.r + 3 + pulse * 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 210, 63, ' + (0.6 - pulse * 0.45) + ')'; ctx.lineWidth = 2; ctx.stroke();
      }
      if (out) {                                   // a little notch on the rim pointing outward
        var a = Math.atan2(dy, dx), tipR = rim + p.r + 4;
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(a) * tipR, R + Math.sin(a) * tipR);
        ctx.lineTo(R + Math.cos(a + 0.12) * (rim + p.r - 3), R + Math.sin(a + 0.12) * (rim + p.r - 3));
        ctx.lineTo(R + Math.cos(a - 0.12) * (rim + p.r - 3), R + Math.sin(a - 0.12) * (rim + p.r - 3));
        ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill();
      }
      badge(x, y, p.r, p.now ? 'rgba(70, 52, 6, 0.95)' : 'rgba(30, 30, 40, 0.88)', p.now ? '#ffd23f' : 'rgba(255, 210, 63, 0.75)', fileFor(p.emoji), p.emoji);
    });

    // you: an arrow in the middle, turned the way you face
    var hx = Math.sin(d.yaw), hz = Math.cos(d.yaw), ax = -hx * fz + hz * fx, ay = -(hx * fx + hz * fz);
    ctx.save(); ctx.translate(R, R); ctx.rotate(Math.atan2(ax, -ay)); ctx.scale(sc, sc);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'; ctx.shadowBlur = 4; ctx.fill();
    ctx.restore();

    // under the map: the job to do now and how far it is
    var ft = nowPin ? Math.round(Math.hypot(nowPin.x - mx, nowPin.z - mz)) + ' m' : '';
    if (foot.dataset.k !== (nowPin ? nowPin.emoji : '') + ft) {
      foot.dataset.k = (nowPin ? nowPin.emoji : '') + ft;
      foot.classList.toggle('off', !nowPin);
      if (nowPin) { footIc.innerHTML = JA.iconHTML ? JA.iconHTML(nowPin.emoji) : nowPin.emoji; footTx.textContent = ft; }
    }
  };
})(window.JA = window.JA || {});
