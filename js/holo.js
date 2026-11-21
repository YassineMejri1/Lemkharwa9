/* Astro Outpost — the wrist tablet's holograms.
   When something is hard to understand (press T, tap a meter, a blue card or the "Why?" chip
   on the radio panel), the astronaut's wrist tablet projects a short moving diagram that
   explains the real science in three or four steps, one sentence per step.
   The game calls JA.holo.open('shield', { bags: 6 }) and pauses itself until it closes.
   Everything is drawn here with canvas lines and circles: no pictures, no libraries, no network.
   The sentences are real text under the picture, so screen readers and read-aloud get them.
   Each scene below has a title, its sentences, and a draw function that paints one step at
   time t (seconds since the step began) on a sheet 720 wide and 405 tall.
   Colours: cyan line art, amber for the thing the step is about, pink only for "bad". */
(function (JA) {
  'use strict';
  var H = JA.holo = {};
  var W = 720, HT = 405;
  var CY = '#5cf0ff', AMB = '#ffd23f', BAD = '#ff5468', GREY = '#9aa7c7', INK = '#eaf6ff', BG = '#06132b';
  var LAMP = '#ff9df2';       // the pink-purple light of the grow lamps (not the danger pink)
  var TAU = Math.PI * 2;
  var g = null;               // the canvas pen
  var S = 1;                  // how many canvas pixels make one unit of the sheet
  var fade = 1;               // every step fades in over its first moments
  var still = false;          // true = draw a settled picture, nothing moves (reduced motion)
  var FONT = '"Exo 2", "Segoe UI", system-ui, sans-serif';      // for the labels and numbers inside the picture

  // ---------- small helpers ----------
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ph(t, start, dur) { return cl((t - start) / dur); }      // 0 to 1 while a part of the step plays
  function ez(p) { return p * p * (3 - 2 * p); }                    // start gently, stop gently
  function mix(a, b, p) { return a + (b - a) * p; }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }      // the same "random" number every time
  // A value that runs 0 to 1 again and again, one lap every 'every' seconds. A still picture stays at 'rest'.
  function lap(t, every, rest) { return still ? (rest == null ? 0.6 : rest) : (t / every) % 1; }
  function sway(t, speed, shift) { return still ? 0 : Math.sin(t * speed + (shift || 0)); }
  function num(v, def, lo, hi) {
    if (typeof v === 'string' && v !== '') v = +v;
    if (typeof v !== 'number' || !isFinite(v)) v = def;
    return Math.max(lo, Math.min(hi, v));
  }
  // A share of something: 0.46 and 46 both mean 46%.
  function share(v, def, lo, hi) { v = num(v, def, 0, 100); return Math.max(lo, Math.min(hi, v > 1 ? v / 100 : v)); }
  function pct(f) { return Math.round(f * 100); }
  // Each hologram has a drawing for the Moon and one for Mars; a scene that also draws Sahrun passes ALL as 'has'.
  // Any other planet uses the drawing of the planet it is "like" (JA.SITES).
  var ALL = ['moon', 'mars', 'sahrun'];
  function place(v, def, has) {
    has = has || ['moon', 'mars'];
    if (has.indexOf(v) >= 0) return v;
    var P = JA.SITES && JA.SITES[v];
    return P && P.like && P.like !== v ? place(P.like, def, has) : def;
  }
  function placeName(v) { return v === 'mars' ? 'Mars' : v === 'sahrun' ? 'Sahrun' : 'Moon'; }

  // ---------- drawing tools ----------
  function A(a) { g.globalAlpha = fade * cl(a); }
  function pen(col, w, glow) {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w || 3;
    g.shadowColor = col; g.shadowBlur = (glow == null ? 10 : glow) * S;
  }
  function dash(a, b) { g.setLineDash(a ? [a, b || a] : []); }
  function line(x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function ring(x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); g.stroke(); }
  function dot(x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); g.fill(); }
  function arc(x, y, r, a0, a1) { g.beginPath(); g.arc(x, y, Math.max(0, r), a0, a1); g.stroke(); }
  function rr(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function box(x, y, w, h, r) { rr(x, y, w, h, r); g.stroke(); }
  function slab(x, y, w, h, r) { rr(x, y, w, h, r); g.fill(); }
  function shape(p, close) {
    g.beginPath(); g.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    if (close) g.closePath();
  }
  function path(p, close) { shape(p, close); g.stroke(); }
  // A soft see-through fill for the outline that was just drawn.
  function wash(a) { var k = g.globalAlpha, b = g.shadowBlur; g.globalAlpha = k * a; g.shadowBlur = 0; g.fill(); g.globalAlpha = k; g.shadowBlur = b; }
  // Paint the outline that was just drawn with the dark background, so it hides what is behind it.
  function hide() { var f = g.fillStyle, b = g.shadowBlur; g.fillStyle = BG; g.shadowBlur = 0; g.fill(); g.fillStyle = f; g.shadowBlur = b; }
  function txt(s, x, y, size, col, align) {
    g.font = '700 ' + size + 'px ' + FONT; g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.shadowBlur = 0; g.lineJoin = 'round'; g.lineWidth = Math.max(4, size * 0.3); g.strokeStyle = BG; g.setLineDash([]);
    g.strokeText(s, x, y);
    g.fillStyle = col || INK; g.shadowColor = col || INK; g.shadowBlur = 5 * S;
    g.fillText(s, x, y);
  }
  function arrow(x1, y1, x2, y2, h) {
    var a = Math.atan2(y2 - y1, x2 - x1);
    h = h || 12;
    line(x1, y1, x2, y2);
    g.beginPath();
    g.moveTo(x2 - h * Math.cos(a - 0.5), y2 - h * Math.sin(a - 0.5)); g.lineTo(x2, y2); g.lineTo(x2 - h * Math.cos(a + 0.5), y2 - h * Math.sin(a + 0.5));
    g.stroke();
  }
  function zig(x1, x2, y, amp, n) {
    g.beginPath(); g.moveTo(x1, y);
    for (var i = 1; i <= n; i++) g.lineTo(x1 + (x2 - x1) * i / n, y + (i % 2 ? amp : 0));
    g.stroke();
  }
  // A wobbly line going up, for heat and damp air.
  function wavy(x, y1, y2, amp, shift) {
    g.beginPath();
    for (var i = 0; i <= 14; i++) g.lineTo(x + Math.sin(i * 0.9 + shift) * amp * Math.min(1, i / 3), mix(y1, y2, i / 14));
    g.stroke();
  }
  function spark(x, y, r, col) {
    pen(col, 2.5, 10);
    for (var i = 0; i < 6; i++) line(x + Math.cos(i * 1.047 + 0.3) * r * 0.45, y + Math.sin(i * 1.047 + 0.3) * r * 0.45, x + Math.cos(i * 1.047 + 0.3) * r, y + Math.sin(i * 1.047 + 0.3) * r);
  }
  // The point a share f (0 to 1) of the way along a bent line [x0, y0, x1, y1, ...].
  function along(p, f) {
    var i, n = p.length / 2 - 1, len = [], tot = 0, d, k;
    for (i = 0; i < n; i++) { d = Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]); len.push(d); tot += d; }
    d = cl(f) * tot;
    for (i = 0; i < n; i++) {
      if (d <= len[i] || i === n - 1) { k = len[i] ? Math.min(1, d / len[i]) : 0; return { x: mix(p[i * 2], p[i * 2 + 2], k), y: mix(p[i * 2 + 1], p[i * 2 + 3], k) }; }
      d -= len[i];
    }
    return { x: p[0], y: p[1] };
  }
  // The point a share k of the way along a curve from (x0, y0) to (x1, y1) that bends towards (cx, cy).
  function bend(x0, y0, cx, cy, x1, y1, k) {
    var m = 1 - k;
    return { x: m * m * x0 + 2 * m * k * cx + k * k * x1, y: m * m * y0 + 2 * m * k * cy + k * k * y1 };
  }
  // One fast particle flying in a straight line to (x, y) along the direction (dx, dy), starting 'far' away.
  // p runs 0 to 1 over the flight. Returns true once it has arrived (and then draws nothing).
  function fly(x, y, dx, dy, far, p, col, w) {
    if (p >= 1) return true;
    if (p < 0) return false;
    var hx = x - dx * far * (1 - p), hy = y - dy * far * (1 - p), a = g.globalAlpha, len = 46, i;
    pen(col, w || 3, 8);
    for (i = 0; i < 4; i++) {
      g.globalAlpha = a * (i + 1) / 4;
      line(hx - dx * len * (1 - i / 4), hy - dy * len * (1 - i / 4), hx - dx * len * (1 - (i + 1) / 4), hy - dy * len * (1 - (i + 1) / 4));
    }
    g.globalAlpha = a; dot(hx, hy, (w || 3) * 0.9);
    return false;
  }

  // ---------- things that appear in more than one scene ----------
  function stars(n, seed) {
    pen(INK, 1, 0);
    for (var i = 0; i < n; i++) { A(0.25 + 0.4 * rnd(seed + i)); dot(20 + rnd(seed + i * 3 + 1) * 680, 14 + rnd(seed + i * 3 + 2) * 300, 1 + rnd(seed + i * 7) * 1.2); }
    A(1);
  }
  function ground(y, x0, x1) { A(0.75); pen(CY, 2.5, 6); line(x0 == null ? 30 : x0, y, x1 == null ? 690 : x1, y); A(1); }
  function sun(x, y, r, t) {
    var i, a;
    pen(AMB, 3, 16); ring(x, y, r); hide(); g.stroke(); wash(0.22);
    for (i = 0; i < 10; i++) { a = i * 0.6283 + (still ? 0 : t * 0.15); line(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8), x + Math.cos(a) * (r + 19), y + Math.sin(a) * (r + 19)); }
  }
  // A little world: 'earth' (with land), 'moon' (with craters), 'mars' (an ice cap and a long canyon) or 'sahrun' (bands of dunes).
  function globe(x, y, r, kind) {
    var a = g.globalAlpha;
    pen(kind === 'earth' ? CY : INK, 3); ring(x, y, r); hide(); g.stroke(); wash(kind === 'earth' ? 0.16 : 0.1);
    g.save(); g.beginPath(); g.arc(x, y, r - 1.5, 0, TAU); g.clip();
    g.shadowBlur = 0;
    if (kind === 'earth') {
      g.globalAlpha = a * 0.5;
      g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.28, r * 0.42, r * 0.3, -0.5, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x + r * 0.42, y + r * 0.3, r * 0.3, r * 0.42, 0.4, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(x - r * 0.5, y + r * 0.62, r * 0.25, r * 0.16, 0.2, 0, TAU); g.fill();
    } else if (kind === 'moon') {
      g.globalAlpha = a * 0.55; g.lineWidth = 2;
      ring(x - r * 0.34, y - r * 0.22, r * 0.22); ring(x + r * 0.3, y + r * 0.32, r * 0.28); ring(x + r * 0.28, y - r * 0.48, r * 0.13); ring(x - r * 0.3, y + r * 0.5, r * 0.1);
    } else if (kind === 'sahrun') {
      g.globalAlpha = a * 0.55; g.lineWidth = 2;
      for (var k = -2; k <= 2; k++) {
        g.beginPath();
        for (var j = 0; j <= 12; j++) { var px = x - r + j * r / 6, py = y + k * r * 0.32 + Math.sin(j * 1.3 + k) * r * 0.06; if (j) g.lineTo(px, py); else g.moveTo(px, py); }
        g.stroke();
      }
    } else {
      g.globalAlpha = a * 0.55; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y - r * 0.92, r * 0.5, r * 0.22, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(x - r * 0.6, y + r * 0.1); g.quadraticCurveTo(x, y - r * 0.12, x + r * 0.55, y + r * 0.18); g.stroke();
      ring(x - r * 0.25, y + r * 0.5, r * 0.14); ring(x + r * 0.4, y - r * 0.3, r * 0.1);
    }
    g.restore(); g.globalAlpha = a;
  }
  // An astronaut standing with the feet at (x, y). s = 1 is about 64 tall.
  function astro(x, y, s, col) {
    col = col || INK;
    pen(col, Math.max(2, 3 * s), 6);
    line(x - 6 * s, y - 18 * s, x - 6 * s, y); line(x + 6 * s, y - 18 * s, x + 6 * s, y);
    line(x - 13 * s, y - 37 * s, x - 21 * s, y - 22 * s); line(x + 13 * s, y - 37 * s, x + 21 * s, y - 22 * s);
    box(x - 13 * s, y - 43 * s, 26 * s, 27 * s, 7 * s); hide(); g.stroke(); wash(0.14);
    ring(x, y - 53 * s, 12 * s); hide(); g.stroke(); wash(0.14);
    A0(0.55); slab(x - 6 * s, y - 58 * s, 14 * s, 9 * s, 4 * s); A0(1 / 0.55);
  }
  // Multiply the see-through level without losing the fade (used inside the things above).
  function A0(k) { g.globalAlpha = Math.min(1, g.globalAlpha * k); }
  // A dome home standing on the ground at height y, r wide on each side.
  function dome(x, y, r, col) {
    pen(col || CY, 3.5);
    g.beginPath(); g.arc(x, y, r, Math.PI, 0); g.closePath(); hide(); g.stroke(); wash(0.07);
  }
  // Soil bags lie on the dome in n places, counted from the ground on the left (0) over the top to the ground on the right.
  // They are added from the bottom up, one side then the other: bag number j goes in the place bagPlace(j, n).
  function bagPlace(j, n) { return j % 2 ? n - 1 - (j - 1) / 2 : j / 2; }
  function bag(x, y, r, n, k, col, empty) {
    var a = Math.PI - (k + 0.5) * Math.PI / n, w = Math.min(50, Math.PI * (r + 11) / n - 4), h = Math.min(20, Math.max(13, w * 0.62));
    g.save();
    g.translate(x + Math.cos(a) * (r + h / 2 + 4), y - Math.sin(a) * (r + h / 2 + 4)); g.rotate(Math.PI / 2 - a);
    if (empty) { A0(0.3); pen(col, 1.5, 0); dash(4, 4); box(-w / 2, -h / 2, w, h, 5); dash(); A0(1 / 0.3); }
    else { pen(col, 2.5, 8); box(-w / 2, -h / 2, w, h, 6); hide(); g.stroke(); wash(0.4); }
    g.restore();
  }
  // The outline of a water drop, pointed at the top, about 2.8 s tall. Follow with g.stroke() or g.fill().
  function drop(x, y, s) {
    g.beginPath(); g.moveTo(x, y - 1.4 * s);
    g.bezierCurveTo(x + 0.15 * s, y - 0.7 * s, x + s, y - 0.2 * s, x + s, y + 0.4 * s);
    g.arc(x, y + 0.4 * s, s, 0, Math.PI);
    g.bezierCurveTo(x - s, y - 0.2 * s, x - 0.15 * s, y - 0.7 * s, x, y - 1.4 * s);
    g.closePath();
  }
  function water(x, y, s, col) { pen(col || CY, Math.max(2, s * 0.14), 8); drop(x, y, s); g.stroke(); wash(0.35); }
  // An ice cube seen from one corner. s is half its width.
  function ice(x, y, s) {
    var h = s * 0.58, v = s * 1.15;
    pen(CY, Math.max(2, s * 0.07));
    shape([x, y - v, x + s, y - h, x + s, y + h, x, y + v, x - s, y + h, x - s, y - h], true); hide(); g.stroke(); wash(0.14);
    shape([x, y - v, x + s, y - h, x, y, x - s, y - h], true); wash(0.2);
    path([x - s, y - h, x, y, x + s, y - h]); line(x, y, x, y + v);
    A0(0.6); line(x - s * 0.72, y - h * 0.1, x - s * 0.72, y + h * 0.5); A0(1 / 0.6);
  }
  // The outline of a flash of lightning (the sign for electricity), 2 s tall. Follow with g.fill().
  function zap(x, y, s) {
    shape([x + 0.18 * s, y - s, x - 0.55 * s, y + 0.14 * s, x - 0.05 * s, y + 0.14 * s, x - 0.2 * s, y + s, x + 0.55 * s, y - 0.2 * s, x + 0.05 * s, y - 0.2 * s], true);
  }
  // A power cell standing up, with its middle at (x, y). level 0 to 1 is how full it is.
  function cell(x, y, w, h, level, col) {
    col = col || AMB;
    pen(col, 3); box(x - w / 2, y - h / 2, w, h, w * 0.2); hide(); g.stroke();
    slab(x - w * 0.2, y - h / 2 - 7, w * 0.4, 7, 2);
    level = cl(level);
    if (level > 0.01) { A0(0.8); slab(x - w / 2 + 5, y + h / 2 - 5 - (h - 10) * level, w - 10, (h - 10) * level, w * 0.12); A0(1 / 0.8); }
  }
  // A small label in a rounded frame. Give it the time t and it blinks.
  function tag(s, x, y, col, t) {
    var a = g.globalAlpha, w;
    g.font = '700 20px ' + FONT; w = g.measureText(s).width + 26;
    if (t != null && !still && t % 0.9 > 0.58) g.globalAlpha = a * 0.3;
    pen(col, 2.5, 8); box(x - w / 2, y - 17, w, 34, 17); hide(); g.stroke();
    txt(s, x, y + 1, 20, col);
    g.globalAlpha = a;
  }
  // One atom: a ball with its letter. Later atoms cover earlier ones, so they can overlap neatly.
  function atom(x, y, r, col, name) {
    pen(col, Math.max(2, r * 0.13), 8); ring(x, y, r); hide(); g.stroke(); wash(0.28);
    if (name && r >= 11) txt(name, x, y + 1, Math.round(r * 1.15), col);
  }
  // One water molecule: a big oxygen with two small hydrogens, 104 degrees apart, like ears.
  function h2o(x, y, s, named, turn) {
    var d = s * 1.5, k, a;
    for (k = -1; k <= 1; k += 2) {
      a = -Math.PI / 2 + k * 0.91 + (turn || 0);
      atom(x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.56, INK, named ? 'H' : '');
    }
    atom(x, y, s, CY, named ? 'O' : '');
  }
  // Two atoms of the same kind holding on to each other (O₂ or H₂).
  function pair(x, y, r, col) { atom(x - r * 0.85, y, r, col); atom(x + r * 0.85, y, r, col); }
  // A leaf growing out of (x, y), to the left (side -1) or right (side 1). ang is how far it points up.
  function leaf(x, y, side, len, ang) {
    var tx = x + Math.cos(ang) * len * side, ty = y - Math.sin(ang) * len, mx = (x + tx) / 2, my = (y + ty) / 2;
    var nx = -(ty - y) / len * len * 0.3, ny = (tx - x) / len * len * 0.3;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx + nx, my + ny, tx, ty); g.quadraticCurveTo(mx - nx, my - ny, x, y);
    hide(); g.stroke(); wash(0.3);
  }
  // A plant growing out of (x, y). grow 0 to 1 is how big it is, droop 0 to 1 makes it hang its leaves.
  function plant(x, y, grow, droop, t, col) {
    var hgt = 38 + 120 * grow, pairs = 1 + Math.round(grow * 3), lean = sway(t, 1.2) * 4 * (1 - droop) + droop * hgt * 0.3;
    var cx = x + lean * 0.2, cy = y - hgt * 0.65, tx = x + lean, ty = y - hgt + droop * hgt * 0.22, i, k, p, len;
    pen(col || CY, 4, 8);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, tx, ty); g.stroke();
    g.lineWidth = 3;
    for (i = 0; i < pairs; i++) {
      k = (i + 1) / (pairs + 0.35); p = bend(x, y, cx, cy, tx, ty, k); len = (20 + 26 * grow) * (1 - 0.35 * k);
      leaf(p.x, p.y, -1, len, 0.5 - droop * 1.5 + sway(t, 1.5, i) * 0.06); leaf(p.x, p.y, 1, len, 0.5 - droop * 1.5 - sway(t, 1.5, i + 2) * 0.06);
    }
    leaf(tx, ty, droop > 0.4 ? 1 : -1, 16 + 12 * grow, 1.15 - droop * 2); leaf(tx, ty, 1, 16 + 12 * grow, 1.15 - droop * 2.2);
  }
  // A radio dish on a stand at (x, y), looking up and to the right.
  function dish(x, y, s, col) {
    pen(col || CY, 3);
    line(x, y, x, y - 30 * s); line(x - 14 * s, y, x + 14 * s, y);
    g.save(); g.translate(x, y - 34 * s); g.rotate(-0.7);
    g.beginPath(); g.arc(26 * s, 0, 26 * s, Math.PI - 1.15, Math.PI + 1.15); g.closePath(); hide(); g.stroke(); wash(0.25);
    line(0, 0, 17 * s, 0); dot(17 * s, 0, 3.5 * s);
    g.restore();
  }
  // A little rocket flying along the direction a, with its middle at (x, y).
  function rocket(x, y, a, flame) {
    g.save(); g.translate(x, y); g.rotate(a);
    pen(AMB, 2.5, 12); path([-22, -5, -34 - flame * 8, 0, -22, 5]);
    pen(INK, 2.5, 6);
    shape([-22, -9, 12, -9, 30, 0, 12, 9, -22, 9], true); hide(); g.stroke(); wash(0.15);
    path([-22, -9, -32, -17, -12, -9]); path([-22, 9, -32, 17, -12, 9]); ring(6, 0, 3.5);
    g.restore();
  }
  // A growing bed (a trough of soil) with its top edge at height y.
  function bed(x, y, w) {
    pen(CY, 3); box(x - w / 2, y, w, 34, 9); hide(); g.stroke(); wash(0.1);
    A0(0.5); g.lineWidth = 2; dash(3, 7); line(x - w / 2 + 12, y + 12, x + w / 2 - 12, y + 12); line(x - w / 2 + 18, y + 22, x + w / 2 - 18, y + 22); dash(); A0(2);
  }

  // What is behind every scene: the dark glass, the tablet's beam fanning out from its corner, and a faint grid.
  function backdrop(t) {
    var i, a, gr, flick = still ? 0 : Math.sin(t * 2.3) * 0.015;
    g.setTransform(S, 0, 0, S, 0, 0);
    g.globalAlpha = 1; g.shadowBlur = 0; g.setLineDash([]); g.lineCap = 'round'; g.lineJoin = 'round';
    g.fillStyle = BG; g.fillRect(0, 0, W, HT);
    gr = g.createRadialGradient(14, 396, 6, 14, 396, 640);
    gr.addColorStop(0, 'rgba(92, 240, 255, ' + (0.15 + flick) + ')'); gr.addColorStop(0.45, 'rgba(92, 240, 255, 0.04)'); gr.addColorStop(1, 'rgba(92, 240, 255, 0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(14, 396); g.arc(14, 396, 700, -1.5, -0.1); g.closePath(); g.fill();
    for (i = 0; i < 3; i++) {
      a = -1.2 + i * 0.42 + (still ? 0 : Math.sin(t * 0.4 + i * 2) * 0.03);
      g.beginPath(); g.moveTo(14, 396); g.arc(14, 396, 700, a - 0.05, a + 0.05); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(92, 240, 255, 0.05)'; g.lineWidth = 1;
    for (i = 1; i < 16; i++) line(i * 45, 0, i * 45, HT);
    for (i = 1; i < 9; i++) line(0, i * 45, W, i * 45);
  }

  // =====================================================================
  //  THE SCENES
  //  fix(d)   fills in every number the game did not send
  //  steps(d) gives the sentences, one per step
  //  draw(d, s, t) paints step s at time t
  // =====================================================================
  var SC = {};

  // ---------- 1. how ice becomes air ----------
  SC.electrolysis = {
    icon: '🧊', title: function (d) { return d.site === 'sahrun' ? 'How water becomes air' : 'How ice becomes air'; }, src: 'iss',
    fix: function (d) { return { airPerIce: Math.round(num(d.airPerIce, 14, 0, 999)), site: place(d.site, 'moon', ALL) }; },
    steps: function (d) {
      var well = d.site === 'sahrun';      // Sahrun's water comes up from a well, not as ice
      return [well ? 'Water from the Deep Well is poured into the Air Maker.' : 'Ice is frozen water. The Air Maker melts it.',
        'Every drop of water is made of tiny pieces: two hydrogen and one oxygen. Scientists write H₂O.',
        'Electricity pulls the pieces apart. That is why the Air Maker needs a power cell.',
        'The oxygen fills the tanks for the crew to breathe. One ' + (well ? 'water can' : 'ice chunk') + ' makes ' + d.airPerIce + ' air.'];
    },
    draw: function (d, s, t) {
      var i, p, q, m, x, y, o;
      var well = d.site === 'sahrun';
      if (s === 0) {
        m = well ? 1 : ez(ph(t, 0.8, 3.4));                        // 0 = solid ice, 1 = all melted (well water: already water)
        A(0.4); pen(CY, 2, 4); box(70, 52, 580, 310, 28);          // the machine around it
        A(0.9); txt('AIR MAKER', 164, 52, 18, CY);
        A(0.65 + 0.35 * sway(t, 3)); pen(AMB, 3.5, 16); zig(136, 304, 288, 12, 14);      // the heater glows
        A(1); pen(AMB, 3, 8); line(126, 278, 314, 278);
        if (m > 0.02) { A(0.8); pen(CY, 3); g.beginPath(); g.ellipse(220, 274, 34 + 54 * m, 4, 0, 0, TAU); g.stroke(); }
        q = 60 * (1 - 0.68 * m);
        if (well) { A(1); pen(CY, 3, 8); box(184, 160, 72, 104, 10); hide(); g.stroke(); wash(0.1); pen(CY, 0, 10); slab(190, 200, 60, 58, 6); }      // the can
        else { A(1); ice(220, 274 - q * 1.15, q); }
        A(0.8); pen(CY, 3); arrow(338, 214, 412, 214, 14);
        for (i = 0; i < 3; i++) {                                  // drips run across
          p = (lap(t, 1.8, 0.4) + i / 3) % 1;
          if (m < 1 || still || well) { A(0.9 * Math.sin(p * Math.PI) * (m > 0.02 ? 1 : 0)); pen(CY, 2); dot(mix(330, 420, p), 232 + Math.sin(p * Math.PI) * -8, 4); }
        }
        if (m > 0.02) { A(1); water(520, 214 + sway(t, 1.6) * 3, 52 * ez(m)); }
        A(1); txt(well ? 'well water' : 'ice', 220, 328, 24, INK);
        A(0.35 + 0.65 * m); txt('water', 520, 328, 24, CY);
      } else if (s === 1) {
        o = [190, 170, 156, 236, 226, 230, 164, 296, 224, 290];    // where the small molecules float
        A(0.85); pen(CY, 3.5); drop(190, 215, 84); g.stroke(); wash(0.08);
        for (i = 0; i < 5; i++) {
          p = ez(ph(t, 0.2 + i * 0.2, 0.5));
          if (p > 0) { A(p); h2o(o[i * 2] + sway(t, 1.1, i * 2) * 3, o[i * 2 + 1] + sway(t, 0.9, i) * 3, 12 * p, false, sway(t, 0.7, i) * 0.3); }
        }
        q = ez(ph(t, 1.3, 0.9));                                   // the magnifying glass opens
        if (q > 0) {
          A(q); pen(AMB, 2.5, 8); ring(226, 230, 27);
          A(0.5 * q); dash(7, 7); line(226, 203, 473, 88); line(226, 257, 473, 292); dash();
          A(q); pen(AMB, 3.5, 14); ring(510, 190, 108 * q); hide(); g.stroke();
          p = ez(ph(t, 1.9, 0.6));
          if (p > 0) { A(p); h2o(510, 208, 44, true, sway(t, 0.8) * 0.05); }
          p = ph(t, 2.6, 0.5);
          if (p > 0) { A(p); txt('H₂O', 510, 348, 44, AMB); }
        }
      } else if (s === 2) {
        A(0.9); pen(CY, 3); path([190, 120, 190, 342, 530, 342, 530, 120]);      // a tank of water
        A(0.45); g.beginPath(); for (i = 0; i <= 34; i++) g.lineTo(190 + i * 10, 150 + Math.sin(i * 0.9 + (still ? 0 : t * 2)) * 3); g.stroke();
        A(1); pen(AMB, 3, 10); path([338, 62, 244, 62, 244, 100]); path([382, 62, 476, 62, 476, 100]);      // wires
        cell(360, 62, 44, 60, 1); g.fillStyle = BG; g.shadowBlur = 0; zap(360, 62, 17); g.fill();
        for (i = 0; i < 2; i++) {                                  // electricity runs down both wires
          p = (lap(t, 1.1, 0.5) + i / 2) % 1; pen(AMB, 2, 12);
          q = along([338, 62, 244, 62, 244, 100], p); dot(q.x, q.y, 5);
          q = along([382, 62, 476, 62, 476, 100], p); dot(q.x, q.y, 5);
        }
        pen(CY, 3); box(238, 100, 12, 206, 4); wash(0.5); box(470, 100, 12, 206, 4); wash(0.5);
        txt('−', 220, 104, 28, INK); txt('+', 500, 104, 28, INK);
        o = [348, 200, 384, 258, 342, 312];
        for (i = 0; i < 3; i++) {
          p = ez(ph(t, 1.1 + i * 0.9, 1.3));                       // 0 = one molecule, 1 = pulled apart
          x = o[i * 2] + sway(t, 1.3, i) * 3 * (1 - p); y = o[i * 2 + 1] + sway(t, 1.1, i * 3) * 3 * (1 - p);
          if (p <= 0) h2o(x, y, 20, true, 0);
          else {
            atom(mix(x - 21, 272, p), mix(y - 16, 190 + i * 56 - 12, p), 11.2, INK, 'H');
            atom(mix(x + 21, 272, p), mix(y - 16, 190 + i * 56 + 12, p), 11.2, INK, 'H');
            atom(mix(x, 446, p), mix(y, 190 + i * 56, p), 20, CY, 'O');
            if (p < 1) { A(Math.sin(p * Math.PI)); pen(AMB, 0, 0); zap(x, y, 16); g.fill(); A(1); }
          }
        }
        p = ph(t, 2.4, 0.6);
        if (p > 0) { A(p); txt('hydrogen', 100, 246, 20, INK); txt('oxygen', 622, 246, 20, CY); }
      } else {
        p = ez(ph(t, 0.6, 3.8));                                   // how far the tank has filled
        A(1); ice(106, 262, 30);
        A(0.7); pen(CY, 3); arrow(148, 262, 184, 262, 10);
        A(1); pen(CY, 3); box(194, 216, 92, 92, 16); wash(0.08);   // the Air Maker
        pen(AMB, 0, 12); zap(240, 262, 26); g.fill();
        for (i = 0; i < 3; i++) {                                  // hydrogen floats away
          q = (lap(t, 4.2, 0.5) + i / 3) % 1;
          A(0.85 * Math.sin(q * Math.PI)); pair(mix(236, 196, q) + sway(t, 1.4, i) * 5, mix(206, 34, q), 7, INK);
        }
        A(0.75); txt('H₂', 276, 110, 22, INK);
        for (i = 0; i < 4; i++) {                                  // oxygen goes into the tank
          q = (lap(t, 3.2, 0.5) + i / 4) % 1;
          A(Math.min(1, q * 6, (1 - q) * 5)); pair(mix(300, 492, q), 262 + sway(t, 1.7, i * 2) * 4, 11, CY);
        }
        A(1); txt('O₂', 384, 222, 24, CY);
        pen(CY, 3.5); rr(476, 74, 124, 270, 44); hide(); g.stroke();
        g.save(); rr(476, 74, 124, 270, 44); g.clip();
        y = 344 - 270 * (0.1 + 0.72 * p);
        A(0.4); pen(CY, 0, 0); g.fillRect(476, y, 124, 344 - y);
        A(0.9); pen(CY, 2.5, 8); g.beginPath(); for (i = 0; i <= 13; i++) g.lineTo(476 + i * 10, y + Math.sin(i * 1.1 + (still ? 0 : t * 2.2)) * 2.5); g.stroke();
        g.restore();
        A(1); pen(CY, 3.5); box(476, 74, 124, 270, 44);
        txt('+' + Math.round(d.airPerIce * p), 658, 190, 40, AMB); txt('air', 658, 228, 24, AMB);
      }
    }
  };

  // ---------- 2. where your breath goes ----------
  // The filter, drawn as a sponge of 8 x 5 holes. full(j) says how full hole j is (0 to 1).
  // The holes are numbered so that they fill from the left, unevenly, like a real sponge.
  function sponge(x0, y0, full) {
    var c, r, k, x, y;
    A(0.9); pen(CY, 3); box(x0 - 12, y0 - 12, 299, 194, 20); hide(); g.stroke(); wash(0.06);
    for (c = 0; c < 8; c++) {
      for (r = 0; r < 5; r++) {
        x = x0 + c * 35; y = y0 + r * 35; k = cl(full(c * 5 + (r * 3 + c * 2) % 5));
        A(0.45); pen(CY, 2, 3); box(x, y, 30, 30, 10);
        if (k > 0) { A(k); pen(GREY, 2, 6); slab(x + 4, y + 4, 22, 22, 8); }
      }
    }
    A(1);
  }
  SC.scrubber = {
    icon: '🫧', title: 'Where your breath goes', src: 'apollo',
    fix: function (d) { return { filter: Math.round(num(d.filter, 100, 0, 100)) }; },
    steps: function (d) {
      return ['You breathe in oxygen. You breathe out a gas called carbon dioxide: CO₂.',
        'In a sealed home it has nowhere to go. Too much of it makes people sleepy and sick.',
        'The filter soaks it up like a sponge. Yours is ' + d.filter + '% clean right now.',
        'A full sponge soaks up nothing more. A power cell heats it and pushes the CO₂ outside, so it can be used again.'];
    },
    draw: function (d, s, t) {
      var i, p, q, n, x, y, b;
      if (s === 0) {
        b = lap(t, 4.6, 0.25);                                     // first half of a breath is in, second half is out
        A(0.9); pen(CY, 4); arc(238, 206, 122, 0.6, TAU - 0.6);    // the helmet, open at the front
        A(1); pen(INK, 3.5, 6);                                    // a head seen from the side, looking right
        g.beginPath(); g.arc(232, 190, 62, -0.7, 2.5, true);
        g.lineTo(196, 262); g.lineTo(200, 300); g.lineTo(252, 300); g.lineTo(254, 268);
        g.quadraticCurveTo(282, 270, 290, 250);
        g.lineTo(297, 238); g.lineTo(291, 231); g.lineTo(299, 222); g.lineTo(296, 212); g.lineTo(315, 205); g.lineTo(297, 172);
        g.closePath(); hide(); g.stroke(); wash(0.1);
        dot(272, 184, 4.5); g.lineWidth = 3; arc(224, 200, 11, 0.9, TAU - 0.9); line(262, 170, 282, 168);
        for (i = 0; i < 7; i++) {                                  // oxygen in, along the top
          p = (lap(t, 2.3, 0.4) + i / 7) % 1; q = bend(690, 104, 470, 104, 306, 222, p);
          A((still || b < 0.5 ? 1 : 0.25) * Math.min(1, p * 6, (1 - p) * 6)); pen(CY, 2, 8); dot(q.x, q.y, 7);
        }
        for (i = 0; i < 7; i++) {                                  // carbon dioxide out, along the bottom
          p = (lap(t, 2.3, 0.4) + i / 7) % 1; q = bend(306, 238, 470, 352, 690, 330, p);
          A((still || b >= 0.5 ? 1 : 0.25) * Math.min(1, p * 6, (1 - p) * 6)); pen(GREY, 2, 6); dot(q.x, q.y, 7);
        }
        A(1); txt('O₂', 600, 68, 28, CY); txt('CO₂', 590, 376, 28, AMB);
        A(0.85); pen(CY, 3); arrow(566, 68, 530, 68, 11); pen(GREY, 3); arrow(632, 376, 668, 376, 11);
      } else if (s === 1) {
        p = ez(ph(t, 0.3, 5));                                     // how stuffy the room has become
        A(1); pen(CY, 3.5); box(120, 66, 420, 280, 30); wash(0.05);
        n = 6 + Math.floor(58 * p);
        for (i = 0; i < n; i++) {
          x = 144 + rnd(i * 2 + 1) * 372; y = 88 + rnd(i * 2 + 2) * 236;
          A(0.85); pen(GREY, 2, 5); dot(x + sway(t, 0.7, i) * 7, y + sway(t, 0.5, i * 2) * 7, 6);
        }
        A(1); astro(330, 340, 1.25, INK);
        if (p > 0.45) {                                            // getting sleepy
          for (i = 0; i < 3; i++) { q = (lap(t, 3, 0.5) + i / 3) % 1; A(Math.sin(q * Math.PI) * cl((p - 0.45) * 4)); txt('z', 364 + q * 44 + i * 4, 262 - q * 70, 20 + q * 16, AMB); }
        }
        A(1); pen(GREY, 3, 4); box(600, 96, 36, 236, 12);          // a meter that climbs into the pink
        g.save(); rr(600, 96, 36, 236, 12); g.clip();
        y = 332 - 236 * (0.08 + 0.84 * p);
        A(0.85); pen(GREY, 0, 0); g.fillRect(600, Math.max(y, 167), 36, 332 - Math.max(y, 167));
        if (y < 167) { pen(BAD, 0, 0); g.fillRect(600, y, 36, 167 - y); }
        g.restore();
        A(1); pen(BAD, 2.5, 6); line(590, 167, 646, 167);
        txt('CO₂', 618, 70, 22, GREY);
      } else if (s === 2) {
        n = Math.round(40 * (100 - d.filter) / 100);               // how many holes are already full
        p = ez(ph(t, 0.4, 2.2));
        sponge(350, 84, function (j) { return j < n ? cl(p * n - j) : 0; });
        for (i = 0; i < 9; i++) {                                  // more CO₂ drifts in from the left
          q = (lap(t, 3.4, 0.5) + rnd(i) + i / 9) % 1; y = 100 + rnd(i + 20) * 150;
          x = d.filter > 0 ? mix(40, 338, q) : Math.min(mix(40, 338, q), 300 + rnd(i + 5) * 24);
          A(d.filter > 0 ? Math.min(1, q * 5, (1 - q) * 6) : Math.min(1, q * 5)); pen(GREY, 2, 5); dot(x, y + sway(t, 1.3, i) * 5, 6);
        }
        A(0.9); txt('CO₂', 180, 300, 24, GREY);
        A(1); txt(d.filter + '% clean', 487, 330, 36, d.filter <= 15 ? BAD : AMB);
      } else {
        p = ez(ph(t, 1.2, 4.6));                                   // how far it has been cleaned out
        A((0.55 + 0.25 * sway(t, 3)) * (1 - 0.6 * p)); pen(AMB, 3, 26); box(98, 68, 319, 214, 26);      // heat all around
        A(1); sponge(120, 90, function (j) { return cl((40 - j) - p * 40); });
        A(0.7 + 0.3 * sway(t, 3)); pen(AMB, 3.5, 14); zig(128, 388, 296, 11, 20);
        A(1); pen(AMB, 3, 8); line(258, 308, 258, 322); cell(258, 348, 34, 46, 1); g.fillStyle = BG; g.shadowBlur = 0; zap(258, 348, 13); g.fill();
        A(0.9); pen(CY, 5, 8); line(560, 28, 560, 150); line(560, 200, 560, 382);      // the wall of the home
        A(0.85); pen(CY, 3); line(420, 158, 668, 158); line(420, 192, 668, 192);     // the pipe through it
        pen(INK, 1, 0);
        for (i = 0; i < 9; i++) { A(0.3 + 0.4 * rnd(i + 40)); dot(580 + rnd(i + 41) * 124, 90 + rnd(i * 3 + 42) * 280, 1.6); }
        for (i = 0; i < 8; i++) {                                  // the CO₂ leaves
          q = (lap(t, 2.6, 0.5) + i / 8) % 1;
          if (p < 1 || q > 0.45) {
            x = mix(424, 760, q); y = 175 + (q > 0.72 ? (rnd(i) - 0.5) * (q - 0.72) * 520 : sway(t, 2, i) * 4);
            A(Math.min(1, q * 8, (1 - q) * 3.4)); pen(GREY, 2, 5); dot(x, y, 6);
          }
        }
        A(1); txt('CO₂', 490, 224, 22, GREY); txt('outside', 640, 60, 22, INK);
      }
    }
  };

  // ---------- 3. how soil stops radiation ----------
  SC.shield = {
    icon: '🛡️', title: 'How soil stops radiation', src: 'artemis',
    fix: function (d) {
      var slots = Math.round(num(d.slots, 16, 1, 40));
      return { slots: slots, bags: Math.round(num(d.bags, 0, 0, slots)), shield: share(d.shield, 0.25, 0, 1), site: place(d.site, 'moon', ALL) };
    },
    steps: function (d) {
      return ['Radiation is tiny, very fast particles from the Sun and from deep space. You cannot see or feel them.',
        'On Earth, thick air and a magnetic field stop most of them. ' + (d.site === 'mars' ? 'Mars has only very thin air.' : d.site === 'sahrun' ? 'Sahrun (made up) has thick air that stops many of them, but no magnetic field.' : 'The Moon has neither.'),
        'Mass stops them. A particle that hits soil gives up its energy there instead of in you.',
        'Your dome has ' + d.bags + ' of ' + d.slots + ' soil bags. Indoors, ' + pct(d.shield) + '% is blocked. Outdoors, only your suit protects you.'];
    },
    draw: function (d, s, t) {
      var i, k, p, q, a, u, x, y, b, r, n, has, list, hit;
      if (s === 0) {
        stars(22, 7);
        A(1); sun(34, 34, 50, t); txt('Sun', 126, 30, 22, AMB);
        A(0.85); txt('deep space', 606, 30, 22, INK);
        ground(344);
        A(1); astro(390, 344, 1.15, INK);
        A(0.9); txt('?', 428, 262 + sway(t, 2) * 3, 30, INK);
        for (i = 0; i < 13; i++) {                                 // particles from the Sun
          u = (lap(t, 1.5 + rnd(i) * 0.9, 0.5) + rnd(i + 30)) % 1;
          A(0.95); fly(120 + rnd(i + 9) * 720, 420, 0.64, 0.77, 640, u, BAD, 3);
        }
        for (i = 0; i < 5; i++) {                                  // and a few from far away
          u = (lap(t, 2.4 + rnd(i + 3), 0.4) + rnd(i + 50)) % 1;
          A(0.7); fly(60 + rnd(i + 70) * 420, 420, -0.5, 0.866, 620, u, BAD, 2.2);
        }
      } else if (s === 1) {
        stars(14, 3);
        // Earth: a blanket of air and a magnetic field
        for (k = 1; k <= 2; k++) {
          A(0.75); pen(AMB, 2.5, 8);
          g.beginPath(); g.ellipse(190 - 31 * k, 206, 31 * k, 42 + 20 * k, 0, 0, TAU); g.stroke();
          g.beginPath(); g.ellipse(190 + 31 * k, 206, 31 * k, 42 + 20 * k, 0, 0, TAU); g.stroke();
        }
        A(0.3); pen(CY, 12, 14); ring(190, 206, 60);
        A(1); globe(190, 206, 50, 'earth');
        // the Moon or Mars: nothing in the way
        r = d.site === 'mars' || d.site === 'sahrun' ? 56 : 48;
        if (d.site === 'mars') { A(0.3); pen(INK, 2, 6); ring(540, 206, r + 9); }
        if (d.site === 'sahrun') { A(0.55); pen(AMB, 3, 8); ring(540, 206, r + 13); }      // thick air
        A(1); globe(540, 206, r, d.site);
        for (i = 0; i < 5; i++) {
          b = -60 + i * 30; u = (lap(t, 2.4, 0.55) + i * 0.23) % 1;
          // on Earth each one is stopped high above the ground
          q = i % 2 ? 64 : 100; a = Math.sqrt(Math.max(0, q * q - b * b));
          x = 190 + 0.77 * b - 0.64 * a; y = 206 - 0.64 * b - 0.77 * a;
          A(1);
          if (fly(x, y, 0.64, 0.77, 250, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); spark(x, y, 12, i % 2 ? CY : AMB); }
          // on the other world it reaches the ground (Sahrun's thick air stops every other one)
          if (d.site === 'sahrun' && i % 2) {
            q = r + 13; a = Math.sqrt(Math.max(0, q * q - b * b)); x = 540 + 0.77 * b - 0.64 * a; y = 206 - 0.64 * b - 0.77 * a;
            A(1);
            if (fly(x, y, 0.64, 0.77, 250, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); spark(x, y, 12, AMB); }
          } else if (Math.abs(b) < r) {
            a = Math.sqrt(r * r - b * b); x = 540 + 0.77 * b - 0.64 * a; y = 206 - 0.64 * b - 0.77 * a;
            A(1);
            if (fly(x, y, 0.64, 0.77, 250, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); pen(BAD, 3, 10); ring(x, y, 5 + (u - 0.6) * 34); }
          }
        }
        A(1); txt('Earth', 190, 352, 24, CY); txt(placeName(d.site), 540, 352, 24, INK);
      } else if (s === 2) {
        ground(326);
        A(1); dome(360, 326, 112);
        for (k = 0; k < 11; k++) bag(360, 326, 112, 11, k, AMB);
        astro(360, 324, 1.05, INK);
        for (i = 0; i < 6; i++) {                                  // every particle is stopped in the soil
          a = (64 + i * 21) * Math.PI / 180; u = (lap(t, 2.5, 0.5) + i * 0.29) % 1;
          x = 360 + Math.cos(a) * 126; y = 326 - Math.sin(a) * 126;
          A(1);
          if (fly(x, y, 0.5, 0.866, 300, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); spark(x, y, 15, AMB); }
        }
        A(0.9); pen(AMB, 2, 6); line(520, 148, 468, 200); txt('soil', 540, 132, 24, AMB);
      } else {
        n = d.slots; has = []; list = [];
        for (i = 0; i < d.bags; i++) has[bagPlace(i, n)] = true;
        ground(318);
        A(1); dome(285, 318, 128);
        for (k = 0; k < n; k++) { A(1); bag(285, 318, 128, n, k, AMB, !has[k]); }
        A(0.95); astro(262, 316, 0.9, INK);
        // ten particles aimed at the dome: the right share is stopped, the ones that meet a bag first
        for (i = 0; i < 10; i++) {
          a = (70 + i * 11.3) * Math.PI / 180; k = Math.min(n - 1, Math.floor((Math.PI - a) / Math.PI * n));
          list.push({ i: i, a: a, bag: !!has[k], key: (has[k] ? 0 : 10) + rnd(i + 3) });
        }
        list.sort(function (m1, m2) { return m1.key - m2.key; });
        hit = Math.round(d.shield * 10);
        for (i = 0; i < 10; i++) {
          q = list[i]; u = (lap(t, 2.8, 0.45) + rnd(q.i + 11)) % 1;
          x = 285 + Math.cos(q.a) * 128; y = 318 - Math.sin(q.a) * 128;
          A(1);
          if (i < hit) {
            x += Math.cos(q.a) * (q.bag ? 16 : 3); y -= Math.sin(q.a) * (q.bag ? 16 : 3);
            if (fly(x, y, 0.5, 0.866, 300, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); spark(x, y, 13, q.bag ? AMB : CY); }
          } else {
            b = (318 - y) / 0.866;                                 // it goes on, down to the floor
            if (fly(x + 0.5 * b, 318, 0.5, 0.866, 300 + b, u / 0.75, BAD, 3)) { A(1 - (u - 0.75) / 0.25); pen(BAD, 3, 10); ring(x + 0.5 * b, 316, 4 + (u - 0.75) * 40); }
          }
        }
        A(1); astro(600, 318, 1, INK);                             // outside, nothing is in the way
        for (i = 0; i < 3; i++) {
          u = (lap(t, 2.2, 0.7) + i * 0.33) % 1; x = 596 + i * 6; y = 318 - 50 + i * 16;
          A(1);
          if (fly(x, y, 0.5, 0.866, 280, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); pen(BAD, 3, 10); ring(x, y, 5 + (u - 0.6) * 34); }
        }
        A(1); txt(d.bags + ' of ' + d.slots + ' bags', 285, 346, 22, AMB); txt(pct(d.shield) + '% blocked', 285, 378, 24, CY);
        txt('suit only', 600, 346, 22, BAD);
      }
    }
  };

  // ---------- 4. what a plant needs ----------
  SC.plant = {
    icon: '🌱', title: 'What a plant needs', src: 'iss',
    fix: function (d) { return { lamp: d.lamp !== false, water: d.water !== false }; },
    steps: function () {
      return ['A plant builds itself out of air and water. Light is the energy it uses to do it.',
        'Light: the pink grow lamps need a power cell. In the dark, a plant stops growing.',
        'Water: the roots drink from the tank. A dry plant closes its pores and waits.',
        'With both, it grows new leaves. It even gives back fresh oxygen.'];
    },
    draw: function (d, s, t) {
      var i, p, q, x, y, ok, o;
      // The grow lamp: lit and pink when it has power, a dashed danger outline when it has none.
      function lamp(x0, w, y0, len, on) {
        var j, k;
        if (on) {
          for (j = 0; j < 5; j++) { k = x0 - w / 2 + 14 + j * (w - 28) / 4; A(0.3 + 0.12 * sway(t, 2, j)); pen(LAMP, 3, 10); line(k, y0 + 22, mix(k, x0, 0.25), y0 + len); }
          A(1); pen(LAMP, 3, 16); box(x0 - w / 2, y0, w, 20, 10); wash(0.55);
        } else { A(0.9); pen(BAD, 3, 6); dash(8, 7); box(x0 - w / 2, y0, w, 20, 10); dash(); }
      }
      if (s === 0) {
        A(1); bed(360, 318, 190); plant(360, 318, 0.3, 0, t, CY);
        for (i = 0; i < 3; i++) { A(0.4 + 0.2 * sway(t, 2, i)); pen(AMB, 3, 12); dash(10, 9); g.lineDashOffset = still ? 0 : -t * 26; line(330 + i * 30, 66, 345 + i * 15, 206); dash(); g.lineDashOffset = 0; }
        A(1); txt('light', 360, 42, 24, AMB);
        for (i = 0; i < 5; i++) {                                  // air drifts in from the left
          q = (lap(t, 3.6, 0.5) + i / 5) % 1;
          A(Math.min(1, q * 5, (1 - q) * 5)); pen(GREY, 2, 5); dot(mix(96, 322, q), 250 - 34 * Math.sin(q * 2) + sway(t, 1.4, i) * 5, 6);
        }
        A(1); txt('air', 122, 196, 24, INK);
        for (i = 0; i < 3; i++) {                                  // water comes in from the right
          q = (lap(t, 3.2, 0.5) + i / 3) % 1;
          A(Math.min(1, q * 5, (1 - q) * 5)); water(mix(640, 462, q), 330, 8);
        }
        A(1); txt('water', 596, 290, 24, CY);
      } else if (s === 1) {
        A(d.lamp ? 1 : 0.55); bed(330, 322, 190); plant(330, 322, 0.42, d.lamp ? 0 : 0.5, t, CY);
        lamp(330, 250, 58, 196, d.lamp);
        // the power cell that feeds the lamp
        A(1); pen(d.lamp ? AMB : BAD, 3, 8); if (!d.lamp) dash(8, 7);
        path([455, 68, 560, 68, 560, 132, 584, 132]); dash();
        cell(612, 132, 52, 80, d.lamp ? 1 : 0, d.lamp ? AMB : BAD);
        if (d.lamp) {
          g.fillStyle = BG; g.shadowBlur = 0; zap(612, 132, 20); g.fill();
          for (i = 0; i < 2; i++) { q = along([584, 132, 560, 132, 560, 68, 455, 68], (lap(t, 1.4, 0.3) + i / 2) % 1); pen(AMB, 2, 12); dot(q.x, q.y, 5); }
        } else tag('missing!', 612, 214, BAD, t);
      } else if (s === 2) {
        A(1); pen(CY, 2.5, 6); line(120, 214, 470, 214);           // the top of the soil
        pen(CY, 3); box(150, 292, 290, 52, 12); wash(0.05);        // a tray under the roots
        pen(d.water ? CY : BAD, 3.5, 8); if (!d.water) dash(8, 7);
        box(530, 150, 120, 180, 18); dash();                       // the tank
        pen(d.water ? CY : GREY, 3); line(530, 318, 440, 318);
        if (d.water) {
          g.save(); rr(530, 150, 120, 180, 18); g.clip(); A(0.4); pen(CY, 0, 0); g.fillRect(530, 204 + sway(t, 1.5) * 2, 120, 130); g.restore();
          A(0.35); pen(CY, 0, 0); slab(154, 310, 282, 30, 9);
        } else { A(1); tag('missing!', 590, 240, BAD, t); }
        // the roots, and water climbing up them
        o = [[296, 214, 270, 250, 236, 268, 214, 318], [296, 214, 290, 262, 276, 290, 270, 324], [296, 214, 302, 260, 322, 286, 326, 326], [296, 214, 330, 246, 364, 270, 384, 318]];
        for (i = 0; i < 4; i++) {
          A(0.9); pen(d.water ? CY : GREY, 3, 6); path(o[i]);
          if (d.water) for (p = 0; p < 2; p++) {
            q = along([o[i][6], o[i][7], o[i][4], o[i][5], o[i][2], o[i][3], 296, 214, 296, 150], (lap(t, 2.6, 0.5) + i * 0.21 + p / 2) % 1);
            A(1); pen(CY, 2, 10); dot(q.x, q.y, 5);
          }
        }
        if (d.water) for (i = 0; i < 3; i++) { q = (lap(t, 2.4, 0.4) + i / 3) % 1; A(Math.min(1, q * 5, (1 - q) * 5)); pen(CY, 2, 10); dot(mix(526, 444, q), 318, 5); }
        A(d.water ? 1 : 0.7); plant(296, 214, 0.42, d.water ? 0 : 0.75, t, CY);
      } else {
        ok = d.lamp && d.water;
        p = ok ? ez(ph(t, 0.5, 3.6)) : 0;
        lamp(360, 200, 30, 130, d.lamp);
        if (!d.lamp) { A(1); tag('missing!', 360, 78, BAD, t); }
        A(1); water(132, 268, 22, d.water ? CY : BAD);
        if (!d.water) { g.fillStyle = BG; g.shadowBlur = 0; drop(132, 268, 19); g.fill(); tag('missing!', 132, 334, BAD, t); }
        else { A(0.8); pen(CY, 3); arrow(170, 290, 250, 318, 11); }
        A(ok ? 1 : 0.7); bed(360, 334, 200); plant(360, 334, ok ? 0.3 + 0.7 * p : 0.3, ok ? 0 : 0.8, t, CY);
        if (ok) for (i = 0; i < 6; i++) {                          // fresh oxygen bubbles up
          q = (lap(t, 4, 0.55) + i / 6) % 1; x = 420 + rnd(i) * 170 + sway(t, 1.3, i) * 8; y = mix(290, 60, q);
          A(Math.min(1, q * 5, (1 - q) * 4) * cl(p * 3 - 0.6)); pen(CY, 2.5, 10); ring(x, y, i % 3 ? 9 : 19);
          if (i % 3 === 0) txt('O₂', x, y + 1, 17, CY);
        }
      }
    }
  };

  // ---------- 5. solar panels: dust on Mars, the sliding Sun on the Moon ----------
  SC.solar = {
    icon: '☀️',
    title: function (d) { return d.site === 'moon' ? 'Why panels must face the Sun' : 'Why dusty panels make less power'; },
    src: function (d) { return d.site === 'moon' ? 'artemis' : 'insight'; },
    fix: function (d) { return { site: place(d.site, 'mars', ALL), eff: share(d.eff, 1, 0, 1) }; },
    steps: function (d) {
      var live = 'Your panels are working at ' + pct(d.eff) + '% right now.';
      if (d.site === 'moon') {
        return ['A solar panel turns sunlight into electricity.',
          'At the Moon\'s south pole the Sun never climbs high. It slides slowly around the horizon.',
          'A panel that has not turned with it catches less light. ' + live,
          'Turn it back to face the Sun and it charges at full speed again.'];
      }
      return ['A solar panel turns sunlight into electricity.',
        d.site === 'sahrun' ? 'On Sahrun, blowing sand settles on the glass a little more every day.' : 'On Mars, dust settles on the glass a little more every day.',
        'Dust blocks the light, so fewer power cells get charged. ' + live,
        'Brush the dust off and the light gets through again. NASA\'s InSight lander ran out of power this way.'];
    },
    draw: function (d, s, t) {
      var i, k, q, x, y, n, f, a, b, c, e, lit, sweep = -1;
      // A wire to a power cell, with electricity running along it (faster when speed is nearer 1).
      function charge(wire, cx, cy, level, speed) {
        var j, m;
        A(1); pen(AMB, 3, 8); path(wire);
        if (speed > 0.02) for (j = 0; j < 3; j++) { m = along(wire, (lap(t, 1.5 / Math.max(0.3, speed), 0.4) + j / 3) % 1); pen(AMB, 2, 12); dot(m.x, m.y, 5); }
        cell(cx, cy, 64, 116, level);
      }
      if (d.site !== 'moon' || s === 0) {
        // seen from the side: the Sun, a tilted panel on a post, and a power cell
        n = s === 1 ? (still ? 46 : Math.floor(ph(t, 0.6, 4.8) * 46)) : s >= 2 ? Math.round(4 + 42 * cl((1 - d.eff) / 0.5)) : 0;      // specks of dust on the glass
        f = s === 1 ? 1 - 0.5 * n / 46 : s === 2 ? d.eff : 1;      // the share of the light that gets through
        if (s === 3) { n = Math.max(n, 18); sweep = ez(ph(t, 0.9, 2.6)); f = mix(Math.min(d.eff, 0.6), 1, sweep); }
        ground(334);
        A(1); sun(104, 92, 40, t);
        pen(CY, 4); line(320, 240, 320, 334);
        g.save(); g.translate(320, 236); g.rotate(-0.5);
        pen(CY, 3); box(-104, -8, 208, 16, 4); hide(); g.stroke(); wash(0.3);
        g.lineWidth = 2; for (i = -2; i <= 2; i++) line(i * 35, -8, i * 35, 8);
        g.restore();
        lit = Math.round(f * 5);
        for (i = 0; i < 5; i++) {                                  // five sunbeams; dust stops some of them
          k = [2, 0, 4, 1, 3][i] < lit;
          x = 320 + 0.878 * (-78 + i * 39) - 0.479 * 13; y = 236 - 0.479 * (-78 + i * 39) - 0.878 * 13;
          A(k ? 0.9 : 0.25); pen(AMB, 3, 12); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40;
          line(x - 0.832 * 200, y - 0.555 * 200, x - (k ? 0 : 0.832 * 16), y - (k ? 0 : 0.555 * 16));
          dash(); g.lineDashOffset = 0;
        }
        for (i = 0; i < (s === 1 ? 46 : n); i++) {
          b = -98 + rnd(i + 5) * 196; c = 11 + rnd(i + 90) * 5;      // where this speck lies on the glass
          k = s === 1 ? ph(t, 0.6 + 4.8 * i / 46 - 1.4, 1.4) : 1;    // in step 2 it drifts down first
          if (k <= 0 || (sweep >= 0 && b < -112 + 224 * sweep)) continue;
          A(Math.min(1, k * 3)); pen(GREY, 1, 3);
          dot(320 + 0.878 * b - 0.479 * c + (1 - k) * (150 + rnd(i + 7) * 160), 236 - 0.479 * b - 0.878 * c - (1 - k) * (130 + rnd(i + 8) * 60), 3.2);
        }
        if (sweep >= 0) {                                          // the brush
          g.save(); g.translate(320, 236); g.rotate(-0.5); x = -112 + 224 * sweep;
          A(1); pen(AMB, 3, 10); box(x - 14, -42, 28, 13, 4); wash(0.45);
          for (i = -2; i <= 2; i++) line(x + i * 5.5, -29, x + i * 5.5 - (sweep < 1 ? 4 : 0), -12);
          line(x, -42, x + 18, -80);
          g.restore();
        }
        if (s !== 1) {
          e = s === 0 ? ez(ph(t, 0.8, 3)) : s === 2 ? d.eff * ez(ph(t, 0.6, 3.2)) : 0.3 + 0.7 * ez(ph(t, 1.8, 2.6));
          charge([320, 320, 592, 320, 592, 282], 592, 222, e, f);
          if (s === 2) txt(pct(d.eff) + '%', 592, 122, 38, AMB);
        }
      } else {
        // a map seen from above: the panel in the middle, the horizon all around, the Sun sliding along it
        f = -2.3; a = Math.acos(cl(d.eff));                        // the panel faces f; the Sun has slid on by the angle a
        if (s === 1) q = -2.6 + lap(t, 20, 0.12) * TAU;
        else if (s === 2) q = f + a;
        else { a = Math.max(a, 0.95); q = f + a; f = mix(f, q, ez(ph(t, 0.9, 2.4))); }
        e = cl(Math.cos(q - f));                                   // the share of the light it catches
        x = 290 + 150 * Math.cos(q); y = 208 + 150 * Math.sin(q);  // where the Sun is
        A(0.5); pen(CY, 2.5, 6); dash(5, 9); ring(290, 208, 150); dash(); wash(0.1);
        A(0.75); txt('seen from above', 96, 26, 18, INK); txt('horizon', 290, 376, 18, CY);
        if (s === 1) for (i = 5; i >= 1; i--) { A(0.42 - i * 0.07); pen(AMB, 2, 4); ring(290 + 150 * Math.cos(q - i * 0.2), 208 + 150 * Math.sin(q - i * 0.2), 22 - i * 2); }
        if (s >= 2 && a > 0.25) { A(0.6); pen(AMB, 2, 4); dash(5, 6); ring(290 + 150 * Math.cos(-2.3), 208 + 150 * Math.sin(-2.3), 22); dash(); }
        if (s >= 2) {
          for (i = 0; i < 5; i++) {                                // five sunbeams: the panel only catches some
            b = (i - 2) * 17; k = Math.abs(b) <= e * 46;
            A(k ? 0.9 : 0.25); pen(AMB, 3, 12); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40;
            c = k ? 143 - b * Math.tan(q - f) : 236;               // how far this beam gets: to the panel, or past it
            line(x - Math.cos(q) * 30 - Math.sin(q) * b, y - Math.sin(q) * 30 + Math.cos(q) * b, x - Math.cos(q) * c - Math.sin(q) * b, y - Math.sin(q) * c + Math.cos(q) * b);
          }
          dash(); g.lineDashOffset = 0;
          k = s === 2 ? d.eff * ez(ph(t, 0.6, 3.2)) : 0.3 + 0.7 * ez(ph(t, 1.8, 2.6));
          charge([290, 208, 290, 306, 640, 306, 640, 214], 640, 154, k, e);
          if (s === 2) txt(pct(d.eff) + '%', 640, 58, 36, AMB);
        }
        A(1); sun(x, y, 22, t);
        // the panel is a bar; the short arrow shows which way its glass looks
        A(1); pen(CY, 3); arrow(290, 208, 290 + Math.cos(f) * 44, 208 + Math.sin(f) * 44, 11);
        pen(CY, 11, 10); line(290 + Math.sin(f) * 50, 208 - Math.cos(f) * 50, 290 - Math.sin(f) * 50, 208 + Math.cos(f) * 50);
        if (s === 3) {                                             // an arrow: turn it round
          x = 290 + 74 * Math.cos(q); y = 208 + 74 * Math.sin(q); b = q + Math.PI / 2;
          A(1 - 0.6 * ph(t, 3.4, 0.6)); pen(AMB, 3, 10); arc(290, 208, 74, -2.3, q);
          path([x - 13 * Math.cos(b - 0.5), y - 13 * Math.sin(b - 0.5), x, y, x - 13 * Math.cos(b + 0.5), y - 13 * Math.sin(b + 0.5)]);
        }
      }
    }
  };

  // ---------- 6. every drop, again and again ----------
  SC.water = {
    icon: '💧', title: 'Every drop, again and again', src: 'iss',
    fix: function (d) { return { recycle: share(d.recycle, 0.9, 0, 1), site: place(d.site, 'moon', ALL) }; },
    steps: function (d) {
      return ['Water is heavy, and bringing it from Earth costs a fortune. So nothing is thrown away.',
        'The crew drinks and washes. Their breath and sweat make the air damp. Even pee is collected.',
        'The recycler cleans all of it and gives back about ' + Math.round(d.recycle * 10) + ' cups out of every 10.',
        d.site === 'sahrun' ? 'Plants keep some in their leaves, hot days sweat some away, and a little is always lost. Well water and dew top the tank up.' : 'Plants keep some in their leaves, and a little is always lost. Fresh ice tops the tank up.'];
    },
    draw: function (d, s, t) {
      var i, p, q, m, x, y, n, u, top, back;
      // The recycler: a box with three arrows going round inside.
      function recycler(x0, y0, w, h, col) {
        var j, a0 = still ? 0.4 : t * 1.2, r0 = Math.min(w, h) * 0.27;
        A(1); pen(CY, 3.5); box(x0, y0, w, h, 18); hide(); g.stroke(); wash(0.08);
        pen(col, 3.5, 10);
        for (j = 0; j < 3; j++) {
          arc(x0 + w / 2, y0 + h / 2, r0, a0 + j * 2.094, a0 + j * 2.094 + 1.45);
          dot(x0 + w / 2 + Math.cos(a0 + j * 2.094 + 1.45) * r0, y0 + h / 2 + Math.sin(a0 + j * 2.094 + 1.45) * r0, 4.5);
        }
      }
      if (s === 0) {
        stars(16, 21);
        A(1); globe(124, 252, 58, 'earth'); txt('Earth', 124, 338, 22, CY);
        ground(318, 520, 694); A(1); dome(606, 318, 50);
        A(0.5); pen(CY, 2.5, 4); dash(3, 11); g.beginPath(); g.moveTo(176, 214); g.quadraticCurveTo(380, 6, 580, 256); g.stroke(); dash();
        p = lap(t, 11, 0.5);                                       // the long, slow climb
        q = bend(176, 214, 380, 6, 580, 256, p); m = bend(176, 214, 380, 6, 580, 256, Math.max(0, p - 0.14)); u = bend(176, 214, 380, 6, 580, 256, p + 0.01);
        A(Math.min(1, p * 9, (1 - p) * 9));
        pen(INK, 2, 4); line(q.x, q.y, m.x, m.y);
        pen(AMB, 3, 12); box(m.x - 19, m.y - 19, 38, 38, 8); hide(); g.stroke();      // the precious cargo
        water(m.x, m.y + 1, 9);
        rocket(q.x, q.y, Math.atan2(u.y - q.y, u.x - q.x), 0.5 + 0.5 * sway(t, 14));
      } else if (s === 1) {
        A(1); astro(360, 334, 1.75, INK);
        // drinking and washing
        pen(CY, 3); path([144, 190, 153, 250, 201, 250, 210, 190]); A(0.4); pen(CY, 0, 0); shape([148, 214, 153, 250, 201, 250, 206, 214], true); g.fill();
        u = lap(t, 1.8, 0.4); A(Math.min(1, (1 - u) * 4)); water(177, 120 + u * 70, 10);
        A(0.85); pen(CY, 3); arrow(226, 222, 300, 236, 11);
        A(1); txt('drink, wash', 178, 284, 20, CY);
        // breath and sweat make the air damp
        for (i = 0; i < 3; i++) { A(0.4 + 0.3 * sway(t, 1.5, i)); pen(CY, 2.5, 8); wavy(332 + i * 28, 208, 104, 6, (still ? 0 : -t * 3) + i); }
        A(1); pen(CY, 3); box(292, 70, 136, 24, 9); wash(0.12); g.lineWidth = 2; for (i = 0; i < 5; i++) line(312 + i * 24, 76, 312 + i * 24, 88);
        txt('damp air', 516, 82, 22, CY);
        // and pee goes down a pipe to its own tank
        A(0.7); pen(AMB, 2.5, 6); path([394, 286, 470, 286, 470, 312, 520, 312]);
        A(1); pen(AMB, 3, 8); box(520, 268, 92, 74, 14); wash(0.12);
        for (i = 0; i < 3; i++) { q = along([394, 286, 470, 286, 470, 312, 520, 312], (lap(t, 2.2, 0.4) + i / 3) % 1); pen(AMB, 2, 10); dot(q.x, q.y, 5); }
        txt('pee', 566, 244, 22, AMB);
      } else if (s === 2) {
        n = Math.round(d.recycle * 10);
        A(0.8); pen(CY, 3); line(52, 104, 276, 104); line(444, 104, 668, 104);
        for (i = 0; i < 4; i++) {                                  // dirty water in, clean water out
          u = (lap(t, 3, 0.5) + i / 4) % 1;
          A(Math.min(1, u * 6, (1 - u) * 6)); water(mix(60, 268, u), 104, 9, i % 2 ? GREY : AMB);
          A(Math.min(1, u * 6, (1 - u) * 6)); water(mix(452, 660, u), 104, 9, CY);
        }
        recycler(276, 46, 168, 118, AMB);
        for (i = 0; i < 10; i++) {                                 // ten cups went in: this many come back
          x = 98 + i * 54; p = ez(ph(t, 0.8 + i * 0.22, 0.5));
          if (i < n) {
            A(1); pen(CY, 3); path([x, 232, x + 5, 292, x + 33, 292, x + 38, 232]);
            if (p > 0) { y = 289 - 44 * p; A(0.55); pen(CY, 0, 6); shape([x + 6 - (289 - y) * 0.075, y, x + 6, 289, x + 32, 289, x + 32 + (289 - y) * 0.075, y], true); g.fill(); }
          } else { A(0.5); pen(GREY, 2.5, 0); dash(5, 6); path([x, 232, x + 5, 292, x + 33, 292, x + 38, 232]); dash(); }
        }
        A(1); txt(n + ' of 10', 360, 344, 32, AMB);
      } else {
        top = [152, 152, 152, 86, 590, 86, 590, 170]; back = [590, 262, 590, 306, 130, 306, 130, 284];
        A(0.5); pen(CY, 2.5, 4); path(top); path(back);
        u = lap(t, 4, 0.8);                                        // fresh ice drops in now and then
        A(1); pen(CY, 3.5); rr(86, 152, 88, 132, 14); hide(); g.stroke();
        g.save(); rr(86, 152, 88, 132, 14); g.clip(); A(0.4); pen(CY, 0, 0); g.fillRect(86, 212 - (u > 0.5 ? 10 * Math.sin((u - 0.5) * TAU) : 0), 88, 90); g.restore();
        if (u < 0.5) { A(Math.min(1, u * 8)); ice(112, 30 + u * 2 * 150, 15); txt('+', 80, 30 + u * 2 * 150, 26, AMB); }
        else { A(1 - (u - 0.5) * 2); pen(CY, 2.5, 8); g.beginPath(); g.ellipse(112, 206, 10 + (u - 0.5) * 60, 4, 0, 0, TAU); g.stroke(); txt('+', 80, 180, 26, AMB); }
        A(1); astro(360, 84, 0.85, INK);
        recycler(546, 170, 88, 92, CY);
        plant(360, 306, 0.24, 0, t, CY);
        for (i = 0; i < 5; i++) {                                  // round and round
          q = along(top, (lap(t, 5, 0.5) + i / 5) % 1); A(1); water(q.x, q.y, 7);
          p = (lap(t, 5, 0.5) + i / 5) % 1; q = along(back, p);
          if (i % 2 && p > 0.5) continue;                          // the plant keeps this one
          A(i % 2 ? cl((0.5 - p) * 12) : 1); water(q.x, q.y, 7);
        }
        u = lap(t, 5, 0.4);                                        // and one drop gets away
        A(0.8 * Math.sin(u * Math.PI)); water(640 + u * 60, 196 - u * 70, 6, GREY);
      }
    }
  };

  // ---------- 7. why Earth answers late ----------
  SC.radio = {
    icon: '📡', title: function (d) { return d.site === 'sahrun' ? 'Why Mission Control lives in orbit' : 'Why Earth answers late'; },
    src: function (d) { return d.site === 'moon' ? 'moon' : d.site === 'sahrun' ? 'iss' : 'mars'; },
    fix: function (d) {
      var site = place(d.site, 'mars', ALL), one = site === 'moon' ? '1.3 seconds' : site === 'sahrun' ? 'about 2 seconds' : typeof d.oneWay === 'number' && isFinite(d.oneWay) ? 'about ' + d.oneWay + ' minutes' : d.oneWay && typeof d.oneWay === 'string' ? d.oneWay : 'about 12 minutes';
      var m = /(\d+(?:[.,]\d+)?)\s*([a-z]*)/i.exec(one), u = m ? m[2].charAt(0).toLowerCase() : '';
      // n and unit are the same time as a number, for the running clock in the picture
      return { site: site, oneWay: one, n: m ? parseFloat(m[1].replace(',', '.')) : NaN, unit: u === 's' ? ' s' : u === 'm' ? ' min' : u === 'h' ? ' h' : '' };
    },
    steps: function (d) {
      var moon = d.site === 'moon';
      if (d.site === 'sahrun') return ['Radio waves travel at the speed of light: 300,000 km every second. Nothing is faster.',
        'Earth is so far from Sahrun that a message would take years. So Mission Control lives on a relay ship in orbit, about 600,000 km up.',
        'A question and its answer make two trips of about 2 seconds each. Quick enough to talk you through a repair. (Sahrun and its relay ship are made up.)'];
      return ['Radio waves travel at the speed of light: 300,000 km every second. Nothing is faster.',
        moon ? 'The Moon is 384,000 km from Earth, so a message takes 1.3 seconds.' : 'Mars is hundreds of millions of km away. Today a message takes ' + d.oneWay + '.',
        'A question and its answer make two trips. ' + (moon ? 'That is still quick, almost like a phone call.' : 'So crews on Mars must often decide for themselves.')];
    },
    draw: function (d, s, t) {
      var i, p, q, u, x, r, moon = d.site === 'moon', relay = d.site === 'sahrun';
      // The clock: k trips done so far (0 to 2).
      function clock(k, y) {
        var v = d.n * k, text = isNaN(d.n) || !d.unit ? (k >= 2 ? '2 × ' : '') + d.oneWay.replace(/^about\s+/i, '') : (d.n % 1 || (d.n < 10 && d.unit === ' s') ? v.toFixed(1) : Math.round(v)) + d.unit;
        A(1); pen(AMB, 3, 10); box(360 - 92, y - 28, 184, 56, 28); hide(); g.stroke();
        txt(text, 360, y + 1, 30, AMB);
      }
      // Earth on the left, the Moon or Mars on the right.
      function worlds() {
        r = moon ? 26 : 34;
        stars(14, 5);
        A(0.4); pen(CY, 2, 0); dash(3, 9); line(170, 215, 586, 215); dash();
        A(1);
        if (relay) { ship(104, 215); txt('Relay ship', 104, 302, 22, CY); A(0.8); txt('Earth: years away', 104, 120, 18, GREY); A(1); }
        else { globe(104, 215, 54, 'earth'); txt('Earth', 104, 302, 22, CY); }
        globe(624, 215, r, d.site); txt(placeName(d.site), 624, 302, 22, INK);
      }
      // the relay ship: a body with a dish and two wings of solar panels
      function ship(x0, y0) {
        pen(CY, 3, 8); box(x0 - 22, y0 - 13, 44, 26, 7); hide(); g.stroke(); wash(0.14);
        pen(AMB, 2.5, 8); box(x0 - 66, y0 - 8, 36, 16, 3); box(x0 + 30, y0 - 8, 36, 16, 3); line(x0 - 30, y0, x0 - 22, y0); line(x0 + 22, y0, x0 + 30, y0);
        pen(CY, 3, 8); arc(x0, y0 - 13, 12, Math.PI, 0); line(x0, y0 - 25, x0, y0 - 32);
      }
      // A radio signal: three curved lines, flying right (dir 1) or left (dir -1).
      function signal(x0, y0, dir, col) {
        var j;
        pen(col, 3.5, 12);
        for (j = 0; j < 3; j++) { g.beginPath(); g.arc(x0 - dir * 34, y0, 14 + j * 11, dir > 0 ? -0.75 : Math.PI - 0.75, dir > 0 ? 0.75 : Math.PI + 0.75); g.stroke(); }
      }
      if (s === 0) {
        A(1); dish(126, 318, 1.7, CY);
        for (i = 0; i < 6; i++) {                                  // waves race away from the dish
          u = (lap(t, 2.6, 0.5) + i / 6) % 1;
          A(0.9 * (1 - u)); pen(AMB, 3.5, 12); arc(150, 250, 40 + u * 520, -0.95, 0.25);
        }
        A(1); txt('300,000 km', 470, 70, 34, AMB); txt('in 1 second', 470, 110, 24, AMB);
      } else if (s === 1) {
        worlds();
        u = lap(t, 6, 0.8); p = cl(u / 0.55);
        if (moon) { A(0.85); txt('384,000 km', 372, 246, 20, INK); }
        if (relay) { A(0.85); txt('600,000 km', 372, 246, 20, INK); }
        if (p < 1) { A(1); signal(mix(184, 584, p), 215, 1, AMB); }
        else { A(1 - (u - 0.55) / 0.45); pen(AMB, 3, 12); ring(624, 215, r + 8 + (u - 0.55) * 70); }
        clock(p, 112);
      } else {
        worlds();
        u = lap(t, 8, 0.95); p = cl(u / 0.4); q = cl((u - 0.47) / 0.4);
        if (p < 1) { A(1); x = mix(190, 578, p); signal(x, 190, 1, AMB); txt('?', x + 22, 190, 30, AMB); }
        else if (q <= 0) { A(1); pen(AMB, 3, 12); ring(624, 215, r + 10); }
        if (q > 0 && q < 1) { A(1); x = mix(578, 190, q); signal(x, 240, -1, CY); txt('!', x - 22, 240, 30, CY); }
        if (q >= 1) { A(1); pen(CY, 3, 12); ring(104, 215, 66); }
        clock(p + q, 100);
      }
    }
  };

  // ---------- 8. what a solar storm is ----------
  SC.storm = {
    icon: '🌩️', title: 'What a solar storm is', src: 'donki',
    fix: function (d) { return { dish: d.dish !== false, lead: Math.round(num(d.lead, 45, 0, 999)), site: place(d.site, 'moon', ALL) }; },
    steps: function (d) {
      return [d.site === 'sahrun' ? 'Sometimes a star flashes (a flare) and throws out a giant cloud of gas (a CME). Sahrun\'s star, Aster, is made up, but it works like our Sun.' : 'Sometimes the Sun flashes (a solar flare) and throws out a giant cloud of gas (a CME).',
        'The flash of light arrives in minutes. Telescopes that watch the Sun see it, and the cloud leaving.',
        'The dangerous particles, sped up by the cloud\'s shock wave, come later. That gap is your warning time.',
        d.dish ? 'Your Radio Dish is on, so ' + (d.site === 'sahrun' ? 'the forecasters on the relay ship' : 'Earth\'s forecasters') + ' can warn you early: about ' + d.lead + ' seconds in this game.' :
          'Your Radio Dish is off, so only your suit\'s sensor notices, when the particles are already here: ' + (d.lead > 0 ? 'about ' + d.lead + ' seconds of warning.' : 'no warning at all.')];
    },
    draw: function (d, s, t) {
      var i, p, q, u, x, y;
      // The edge of the Sun, peeking in from the left.
      function bigSun(cx, cy, r) {
        A(1); pen(AMB, 4, 18); ring(cx, cy, r); wash(0.2);
        A(0.5); g.lineWidth = 2.5; arc(cx, cy, r * 0.8, -0.5, -0.1); arc(cx, cy, r * 0.62, 0.2, 0.7); arc(cx, cy, r * 0.88, 0.5, 0.75);
      }
      // A cloud of dangerous particles around (x0, y0).
      function cloud(x0, y0, a) {
        var j;
        for (j = 0; j < 16; j++) { A(a * (0.6 + 0.4 * rnd(j))); fly(x0 + (rnd(j + 1) - 0.5) * 110, y0 + (rnd(j + 20) - 0.5) * 104, 1, 0, 1, 0, BAD, 2.6); }
      }
      if (s === 0) {
        stars(14, 9);
        bigSun(24, 205, 150);
        A(1); txt('Sun', 84, 212, 28, AMB);
        u = lap(t, 4.4, 0.4); p = cl(u / 0.75);                    // the flare bursts out, again and again
        q = ez(Math.min(1, p * 2.2));
        A(1); pen(AMB, 5, 20); g.beginPath(); g.moveTo(160, 132); g.bezierCurveTo(160 + 190 * q, 60, 170 + 190 * q, 250, 172, 204); g.stroke();
        for (i = 0; i < 9; i++) {
          y = -0.75 + i * 0.19;
          A(1 - p); pen(AMB, 3, 12); line(172 + Math.cos(y) * (40 + p * 330), 168 + Math.sin(y) * (40 + p * 330), 172 + Math.cos(y) * (86 + p * 330), 168 + Math.sin(y) * (86 + p * 330));
        }
        for (i = 0; i < 3; i++) { A((1 - p) * 0.8); pen(AMB, 3, 14); arc(172, 168, Math.max(0, 30 + p * 360 - i * 46), -0.7, 0.7); }
        A(1); txt('solar flare', 520, 66, 28, AMB);
      } else if (s === 1) {
        stars(14, 9);
        bigSun(-10, 190, 110);
        // a telescope in space, watching the Sun
        A(1); pen(CY, 3); box(584, 170, 46, 40, 8); wash(0.15); box(538, 180, 40, 20, 3); wash(0.3); box(636, 180, 40, 20, 3); wash(0.3);
        line(578, 190, 584, 190); line(630, 190, 636, 190); arc(584, 190, 12, 1.57, 4.71);
        u = lap(t, 5, 0.75); p = cl(u / 0.3);
        if (p < 1) for (i = 0; i < 3; i++) { A(1); pen(AMB, 3.5, 14); arc(-10, 190, mix(124, 576, p) - i * 15, -0.3, 0.3); }
        else { A(1 - (u - 0.3) / 0.7); pen(AMB, 3, 14); ring(607, 190, 36 + (u - 0.3) * 50); A(1); txt('!', 607, 128, 40, AMB); }
        A(0.9); pen(AMB, 2.5, 6); line(118, 296, 584, 296); line(118, 286, 118, 306); line(584, 286, 584, 306);
        A(1); txt('8 minutes', 351, 330, 26, AMB);
      } else if (s === 2) {
        bigSun(-20, 150, 104);
        ground(262, 556, 700); A(1); dome(628, 262, 40);
        u = lap(t, 8, 0.6); p = cl(u / 0.15); q = cl(u / 0.85);
        if (p < 1) for (i = 0; i < 3; i++) { A(1); pen(AMB, 3.5, 14); arc(-20, 150, mix(118, 610, p) - i * 15, -0.1, 0.42); }
        if (q < 1) cloud(mix(130, 600, q), 196, 1);
        else { A(1 - (u - 0.85) / 0.15); pen(BAD, 3, 12); ring(628, 240, 30 + (u - 0.85) * 200); }
        // the timeline underneath: the flash is seen early, the particles arrive late
        A(0.7); pen(CY, 2.5, 4); line(150, 344, 600, 344);
        A(1); pen(AMB, 9, 12); line(218, 344, 532, 344);
        pen(AMB, 3, 8); line(218, 330, 218, 358); pen(BAD, 3, 8); line(532, 330, 532, 358);
        pen(INK, 0, 8); dot(150 + 450 * u, 344, 6);
        txt('warning time', 375, 316, 22, AMB); txt('flash', 218, 380, 20, AMB); txt('particles', 532, 380, 20, BAD);
      } else {
        ground(314);
        A(1); dome(560, 314, 76);
        u = lap(t, 6, 0.55);
        if (d.dish) {
          A(1); astro(560, 312, 0.85, INK);
          globe(668, 62, 28, 'earth');
          for (i = 0; i < 3; i++) { q = (lap(t, 1.8, 0.5) + i / 3) % 1; A(1 - q); pen(AMB, 3, 12); arc(668, 62, 44 + q * 120, 1.85, 2.5); }
          A(1); dish(614, 262, 0.95, AMB);
        } else {
          A(0.8); dish(614, 262, 0.95, GREY);
          A(1); pen(BAD, 4, 8); line(596, 196, 656, 252);
          // only the small sensor on the suit keeps watch
          astro(430, 314, 0.95, INK); pen(CY, 0, 12); dot(430, 284, 4.5);
          for (i = 0; i < 2; i++) { q = (lap(t, 1.6, 0.5) + i / 2) % 1; A(1 - q); pen(CY, 3, 10); arc(416, 284, 10 + q * 44, 2.4, 3.9); }
        }
        cloud(mix(-30, 250, u), 246, 0.95);
        // a stopwatch with the warning time
        A(1); pen(AMB, 4, 12); ring(250, 124, 70); hide(); g.stroke(); slab(240, 40, 20, 14, 4);
        pen(AMB, 3, 8); line(250, 124, 250 + Math.sin(u * TAU) * 56, 124 - Math.cos(u * TAU) * 56);
        txt(d.lead + ' s', 250, 126, 40, AMB);
      }
    }
  };

  // ---------- 9. why everything flies so far ----------
  SC.gravity = {
    icon: '🪐', title: 'Why everything flies so far',
    src: function (d) { return d.site === 'mars' ? 'mars' : d.site === 'sahrun' ? 'fiction' : 'moon'; },
    fix: function (d) { return { site: place(d.site, 'moon', ALL) }; },
    steps: function (d) {
      var mars = d.site === 'mars', sah = d.site === 'sahrun';
      return ['Gravity is the pull of a planet or moon. The more massive it is, the harder it pulls.',
        mars ? 'Mars is smaller than Earth. It pulls with about 38% of Earth\'s strength.' : sah ? 'Sahrun is made up. In this game it pulls with half of Earth\'s strength.' : 'The Moon is much smaller than Earth. It pulls with only one-sixth of Earth\'s strength.',
        'So the same throw stays up longer and lands about ' + (mars ? '2.6' : sah ? '2' : '6') + ' times farther away.'];
    },
    draw: function (d, s, t) {
      var p, u, a, mars = d.site === 'mars', sah = d.site === 'sahrun', name = placeName(d.site), times = mars ? 2.63 : sah ? 2 : 6, secs = mars ? 3.2 : sah ? 3 : 4.2;
      // A world that pulls everything towards its middle: longer, thicker arrows mean a harder pull.
      // A ball dropped from the same height lands sooner where the pull is harder.
      function pull(cx, cy, r, len, w, fallSecs) {
        var j, b, m = still ? 0 : (t * 0.6) % 1 * 8, f = Math.min(1, lap(t, 3.4, 0.95) * 3.4 / fallSecs);
        A(1); globe(cx, cy, r, 'moon');
        for (j = 0; j < 8; j++) {
          if (j === 6) continue;                                   // the top is left free for the falling ball
          b = j * Math.PI / 4;
          A(0.9); pen(AMB, w, 10);
          arrow(cx + Math.cos(b) * (r + 14 + len - m), cy + Math.sin(b) * (r + 14 + len - m), cx + Math.cos(b) * (r + 14 - m * 0.3), cy + Math.sin(b) * (r + 14 - m * 0.3), 5 + w * 2);
        }
        A(1); pen(INK, 0, 10); dot(cx, cy - r - 8 - 62 * (1 - f * f), 7);
      }
      // One throw: the astronaut, the ground, and the ball's curved path. reach = how far it lands, fly = how long it is in the air.
      function lane(gy, reach, flySecs, who, col, mark) {
        var f = cl(u / flySecs), j;
        ground(gy, 60, 680);
        A(1); astro(108, gy, 0.8, INK); txt(who, 108, gy - 74, 22, col);
        for (j = 0; j <= 40 && j / 40 <= f; j++) { A(0.55); pen(col, 0, 4); dot(132 + reach * j / 40, gy - 8 - reach * (j / 40) * (1 - j / 40), 2.4); }
        A(1); pen(INK, 0, 12); dot(132 + reach * f, gy - 8 - reach * f * (1 - f), 7);      // a real throw at 45 degrees: 4 times as far as it is high
        if (f >= 1) {
          A(1); pen(AMB, 3, 8); line(132, gy + 14, 132 + reach, gy + 14); line(132, gy + 8, 132, gy + 20); line(132 + reach, gy + 8, 132 + reach, gy + 20);
          txt(mark, 132 + reach / 2, gy + 36, 24, AMB);
        }
      }
      if (s === 0) {
        stars(12, 31);
        pull(196, 206, 72, 40, 4.5, 0.75); pull(548, 206, 36, 16, 2.5, 1.9);
        A(1); txt('strong pull', 196, 374, 22, AMB); txt('weak pull', 548, 374, 22, AMB);
      } else if (s === 1) {
        stars(12, 31);
        A(1); globe(190, 150, 74, 'earth'); globe(520, 150, 74 * (mars ? 0.53 : sah ? 0.5 : 0.27), d.site);      // their real sizes, side by side (Sahrun's is made up)
        txt('Earth', 190, 254, 24, CY); txt(name, 520, 254, 24, INK);
        p = ez(ph(t, 0.6, 1)); u = ez(ph(t, 1.7, 1)); a = 86 / times;      // the pull of each, as an arrow
        A(1); pen(AMB, 7, 12);
        if (p > 0.05) arrow(150, 286, 150, 286 + 86 * p, 16);
        g.lineWidth = Math.max(3.5, Math.min(7, a * 0.22));
        if (u > 0.05) arrow(480, 286, 480, 286 + a * u, Math.min(16, a * 0.6));
        A(p); txt('Earth\'s pull', 176, 328, 22, AMB, 'left');
        A(u); txt(mars ? '38% of it' : sah ? 'half of it' : '1/6 of it', 506, 298, 22, AMB, 'left');
      } else {
        u = lap(t, secs + 3.3, 0.97) * (secs + 3.3) - 0.7;         // seconds since both let go of the ball
        lane(138, 500 / times, secs / times, 'Earth', CY, '1×');
        lane(330, 500, secs, name, INK, mars ? '2.6×' : sah ? '2×' : '6×');
      }
    }
  };

  // ---------- 10. lettuce or potatoes? ----------
  SC.crops = {
    icon: '🥔', title: 'Lettuce or potatoes?', src: 'iss',
    fix: function (d) {
      var l = d.lettuce && typeof d.lettuce === 'object' ? d.lettuce : {}, p = d.potato && typeof d.potato === 'object' ? d.potato : {};
      return { lettuce: { days: num(l.days, 0.8, 0.1, 6), food: Math.round(num(l.food, 9, 0, 999)) }, potato: { days: num(p.days, 1.7, 0.1, 6), food: Math.round(num(p.food, 22, 0, 999)) } };
    },
    steps: function (d) {
      return ['Lettuce is all leaves. It is ready in under a day, but one crate is only ' + d.lettuce.food + ' food.',
        'Potatoes store their energy underground. They take almost two days, and one crate is ' + d.potato.food + ' food.',
        'Fast and small, or slow and big? Space farmers have to plan days ahead.'];
    },
    draw: function (d, s, t) {
      var i, x, span = Math.max(2, Math.ceil(Math.max(d.lettuce.days, d.potato.days))), ppd = 372 / span, now = span * ph(t, 0.7, 5.4);
      // One crop: its picture, a bar that fills while it grows, and the crate of food it gives at the end.
      function row(y, c, who, on, roots) {
        var k = on ? 1 : 0.22, grown = cl(now / c.days), w = c.days * ppd, side = (15 + 6.5 * Math.sqrt(c.food)) * ez(ph(now, c.days - 0.1, 0.1)), cx = 236 + w + 40, j;
        A(k * 0.8); pen(CY, 2.5, 6); line(84, y + 16, 164, y + 16);      // the soil
        A(k);
        if (roots) {
          plant(124, y + 16, 0.04 + 0.12 * grown, 0, t, CY);
          for (j = 0; j < 3; j++) { pen(INK, 2.5, 6); g.beginPath(); g.ellipse(102 + j * 22, y + 32 + (j % 2) * 5, 4 + 8 * grown, 3 + 5 * grown, 0.3 - j * 0.3, 0, TAU); hide(); g.stroke(); wash(0.35); }
        } else {
          pen(CY, 3, 8);
          for (j = 0; j < 2; j++) { leaf(124, y + 16, -1, 14 + 26 * grown, 0.25 + j * 0.6); leaf(124, y + 16, 1, 14 + 26 * grown, 0.25 + j * 0.6); }
          leaf(124, y + 16, 1, 12 + 22 * grown, 1.57);
        }
        txt(who, 124, y + (roots ? 62 : 44), 20, INK);
        A(k * 0.55); pen(CY, 2, 0); box(236, y - 15, w, 30, 10);
        if (w * grown > 6) { A(k * 0.75); pen(CY, 0, 8); slab(236, y - 15, w * grown, 30, 10); }
        if (side > 6) {                                            // the crate: bigger for more food
          A(k); pen(AMB, 3, 10); box(cx - side / 2, y - side / 2, side, side, 7); hide(); g.stroke(); wash(0.14);
          txt(String(c.food), cx, y + 1, Math.round(side * 0.5), AMB);
        }
      }
      for (i = 0; i < span; i++) {                                 // the days along the bottom: a bright half for day, a dim half for night
        x = 236 + i * ppd;
        A(0.9); pen(AMB, 7, 8); line(x + 6, 322, x + ppd / 2 - 4, 322);
        A(0.4); pen(CY, 7, 0); line(x + ppd / 2 + 6, 322, x + ppd - 6, 322);
        A(0.9); txt('day ' + (i + 1), x + ppd / 2, 352, 20, INK);
      }
      A(0.6); pen(INK, 2, 4); dash(4, 7); line(236 + now * ppd, 62, 236 + now * ppd, 322); dash();      // now
      row(98, d.lettuce, 'lettuce', s !== 1, false);
      row(226, d.potato, 'potatoes', s !== 0, true);
    }
  };

  // ---------- 11. why the drill gets hot ----------
  SC.drill = {
    icon: '🔩', title: 'Why the drill gets hot',
    src: function (d) { return d.site === 'mars' || d.site === 'sahrun' ? 'msl' : 'apollo'; },
    fix: function (d) { return { site: place(d.site, 'moon', ALL) }; },
    steps: function (d) {
      return ['Rubbing makes heat. Rub your hands together fast and feel it. A drill rubs rock much faster.',
        'On Earth, air and water carry the heat away. ' + (d.site === 'sahrun' ? 'The desert air on Sahrun is already hot, so it carries much less heat away and the drill heats up fast.' : d.site === 'mars' ? 'The air on Mars is about 100 times thinner, so the heat stays in the drill.' : 'The Moon has no air at all, so the heat stays in the drill.'),
        'So drill in short bursts and let it cool. An overheated drill bit wears out, and a worn bit heats up even faster.'];
    },
    draw: function (d, s, t) {
      var i, k, p, u, y, hot, on, mars = d.site === 'mars', sah = d.site === 'sahrun';
      // A drill standing in a hole in the rock. turn = is it spinning; heat 0 to 1 colours the bit cyan, amber, then pink.
      function rig(x0, gy, turn, heat) {
        var j, yy, col = heat < 0.4 ? CY : heat < 0.78 ? AMB : BAD, sp = turn && !still ? (t * 5) % 1 : 0.3;
        A(0.85); pen(CY, 3, 6); path([x0 - 104, gy, x0 - 15, gy, x0 - 15, gy + 74, x0 + 15, gy + 74, x0 + 15, gy, x0 + 104, gy]);
        A(0.3); g.lineWidth = 2;
        for (j = 0; j < 6; j++) { if (j !== 2 && j !== 3) { line(x0 - 86 + j * 36, gy + 14, x0 - 98 + j * 36, gy + 32); line(x0 - 74 + j * 36, gy + 44, x0 - 86 + j * 36, gy + 62); } }
        if (heat > 0.05) { A(0.55 * heat); pen(col, 0, 34); dot(x0, gy + 42, 14 + 14 * heat); }      // the heat in the hole
        A(1); pen(col, 3.5, 10); line(x0, gy - 84, x0, gy + 56);    // the bit: a twisted rod
        g.lineWidth = 3; for (j = 0; j < 8; j++) { yy = gy - 82 + ((j + sp) % 8) * 17; line(x0 - 9, yy, x0 + 9, yy + 9); }
        path([x0 - 9, gy + 54, x0, gy + 70, x0 + 9, gy + 54]);
        pen(CY, 3.5); box(x0 - 13, gy - 104, 26, 20, 5); hide(); g.stroke();      // the motor on top
        box(x0 - 36, gy - 168, 72, 64, 14); hide(); g.stroke(); wash(0.12);
        line(x0 - 56, gy - 146, x0 - 36, gy - 146); line(x0 + 36, gy - 146, x0 + 56, gy - 146);
        if (turn) { A(0.75); pen(CY, 2.5, 6); arc(x0, gy - 136, 17, sp * TAU, sp * TAU + 4.2); }
      }
      // Air around a drill: it comes in cool (cyan) and leaves warm (amber), taking the heat with it.
      function air(x0, gy, n) {
        var j, f, side, px, py;
        for (j = 0; j < n; j++) {
          f = (lap(t, 2.8, 0.5) + j / n) % 1; side = j % 2 ? 1 : -1;
          if (f < 0.5) { px = x0 + side * mix(100, 26, f * 2); py = gy - 14 - (j % 3) * 5; A(Math.min(1, f * 8)); pen(CY, 0, 8); }
          else { px = x0 + side * mix(26, 86, f * 2 - 1); py = gy - 14 - (f * 2 - 1) * 110; A(Math.min(1, (1 - f) * 6)); pen(AMB, 0, 10); }
          dot(px, py, 5.5);
        }
      }
      function steam(x0, y0, col, a) {
        for (var j = -1; j <= 1; j += 2) { A(a * (0.6 + 0.3 * sway(t, 2, j))); pen(col, 2.5, 10); wavy(x0 + j * 44, y0, y0 - 64, 5, (still ? 0 : -t * 3) + j); }
      }
      if (s === 0) {
        u = sway(t, 9) * 13;                                       // two hands rubbing up and down
        A(0.5 + 0.3 * sway(t, 3)); pen(AMB, 5, 24); line(176, 180, 176, 274);
        for (k = -1; k <= 1; k += 2) {
          g.save(); g.translate(176 + k * 23, 228 + k * u); g.rotate(k * 0.1);
          A(1); pen(INK, 3.5, 8);
          g.beginPath(); g.ellipse(k * 25, 2, 9, 18, k * 0.5, 0, TAU); hide(); g.stroke(); wash(0.14);      // the thumb
          rr(-22, -62, 44, 108, 20); hide(); g.stroke(); wash(0.14);                                   // the palm
          rr(-25, 40, 50, 24, 7); hide(); g.stroke(); wash(0.3);                                       // the cuff
          g.restore();
        }
        for (i = -1; i <= 1; i++) { A(0.55 + 0.3 * sway(t, 2, i)); pen(AMB, 2.5, 10); wavy(176 + i * 26, 146, 84, 5, (still ? 0 : -t * 3) + i); }
        A(0.7); pen(CY, 3); arrow(276, 228, 378, 228, 13);
        rig(520, 244, true, 0.6); steam(520, 232, AMB, 1);
      } else if (s === 1) {
        p = ez(ph(t, 0.6, 4.5));                                   // the heat building up where the air is missing
        A(1); txt('Earth', 190, 44, 24, CY); txt(placeName(d.site), 530, 44, 24, INK);
        rig(190, 250, true, 0.15); air(190, 250, 10);
        rig(530, 250, true, 0.25 + 0.75 * p);
        if (mars) air(530, 250, 2);
        if (sah) air(530, 250, 4);                                 // hot air: it moves, but takes little heat
        steam(530, 238, p > 0.7 ? BAD : AMB, 0.3 + 0.7 * p);
        A(1); txt('air cools it', 190, 374, 20, CY);
        A(0.3 + 0.7 * p); txt('heat stays', 530, 374, 20, BAD);
      } else {
        u = lap(t, 5, 0.22); on = u < 0.4;                         // a short burst, then a long rest
        hot = on ? mix(0.25, 0.7, u / 0.4) : mix(0.7, 0.25, ez((u - 0.4) / 0.6));
        rig(220, 250, on, hot);
        if (on) steam(220, 238, AMB, 0.8);
        else { A(1); pen(CY, 0, 8); slab(204, 28, 11, 36, 4); slab(225, 28, 11, 36, 4); }      // the pause sign
        // a thermometer: keep it out of the pink
        A(1); pen(INK, 3.5, 6); rr(500, 60, 36, 240, 18); hide(); g.stroke();
        A(0.3); pen(BAD, 0, 0); slab(504, 64, 28, 60, 14);
        A(1); pen(INK, 3.5, 6); ring(518, 318, 28); hide(); g.stroke();
        y = 292 - 210 * hot;
        pen(AMB, 0, 10); dot(518, 318, 19); slab(509, y, 18, 318 - y, 9);
        pen(BAD, 3, 8); line(486, 126, 550, 126); txt('too hot', 614, 96, 20, BAD);
      }
    }
  };

  // ---------- 12. why the badge only goes up ----------
  SC.dose = {
    icon: '☢️', title: 'Why the badge only goes up', src: 'rad',
    fix: function (d) { return { dose: Math.round(num(d.dose, 0, 0, 100)) }; },
    steps: function (d) {
      return ['Each particle of radiation that passes through you can damage a few of your body\'s tiny cells.',
        'Your body repairs most of the damage. But doctors add up every bit an astronaut ever receives.',
        'That total is your badge: ' + d.dose + '% now. It never goes down. So fill it as slowly as you can: shield the dome and shelter from storms.'];
    },
    draw: function (d, s, t) {
      var i, p, u, n, x, y, col;
      // Seven cells under a magnifying glass. hurt(j) says how damaged cell j is (0 to 1).
      // Cell 0 is in the middle; cells 5, 0 and 2 lie in one slanting line.
      function lens(cx, cy, hurt) {
        var j, a, px, py, h;
        A(1); pen(AMB, 3.5, 14); ring(cx, cy, 128); hide(); g.stroke();
        for (j = 0; j < 7; j++) {
          a = (j - 1) * Math.PI / 3; px = cx + (j ? Math.cos(a) * 66 : 0); py = cy + (j ? Math.sin(a) * 66 : 0); h = cl(hurt(j)) > 0.5;
          A(1); pen(h ? BAD : CY, 3, 8); ring(px, py, 28); wash(0.16); dot(px, py, 8);
          if (h) { g.lineWidth = 2.5; path([px - 14, py - 21, px - 3, py - 8, px - 13, py + 2, px + 2, py + 20]); }      // a crack
        }
      }
      if (s === 0) {
        // a person, and a close look at a tiny piece of them
        A(1); pen(INK, 3.5, 6); ring(150, 92, 30); wash(0.1); box(110, 130, 80, 124, 28); wash(0.1);
        line(110, 152, 84, 226); line(190, 152, 216, 226); line(132, 254, 128, 338); line(168, 254, 172, 338);
        pen(AMB, 2.5, 8); ring(150, 190, 15);
        A(0.5); dash(7, 7); line(150, 175, 420, 100); line(150, 205, 420, 312); dash();
        u = lap(t, 5, 0.7); p = cl(u / 0.36);                      // one particle goes straight through
        lens(486, 206, function (j) { return j === 5 ? +(p > 0.33) : j === 0 ? +(p > 0.5) : j === 2 ? +(p > 0.67) : 0; });
        g.save(); g.beginPath(); g.arc(486, 206, 125, 0, TAU); g.clip();
        A(1); fly(486 + 0.5 * 190, 206 + 0.866 * 190, 0.5, 0.866, 380, p, BAD, 4);
        g.restore();
      } else if (s === 1) {
        lens(206, 206, function (j) { return j === 0 ? 1 : j === 5 ? 1 - ph(t, 1, 0.8) : j === 2 ? 1 - ph(t, 2.2, 0.8) : 0; });
        for (i = 0; i < 2; i++) {                                  // a sparkle where a cell is being mended
          p = ph(t, 0.9 + i * 1.2, 1.2);
          if (p > 0 && p < 1) { A(Math.sin(p * Math.PI)); spark(206 + (i ? 33 : -33), 206 + (i ? 57 : -57), 40, AMB); }
        }
        // the doctor's record: every bit is added to the total
        A(1); pen(INK, 3.5, 6); box(452, 66, 196, 262, 16); hide(); g.stroke(); wash(0.06); pen(INK, 0, 6); slab(516, 54, 68, 22, 8);
        n = still ? 15 : Math.floor(ph(t, 0.8, 5.5) * 15 + 0.001);
        for (i = 0; i < n; i++) { x = 484 + (i % 5) * 33; y = 104 + Math.floor(i / 5) * 58; A(1); pen(AMB, 4, 8); line(x, y, x, y + 38); }
        A(1); txt('total', 550, 300, 22, AMB);
      } else {
        p = ez(ph(t, 0.5, 2.8)); col = d.dose >= 75 ? BAD : AMB;
        A(1); pen(INK, 3.5, 8); box(246, 52, 228, 300, 28); hide(); g.stroke(); wash(0.07); pen(INK, 0, 6); slab(326, 38, 68, 24, 9);      // the badge
        pen(AMB, 0, 12);                                           // the radiation sign
        for (i = 0; i < 3; i++) { u = Math.PI / 2 + i * 2.0944; g.beginPath(); g.arc(360, 136, 44, u - 0.5236, u + 0.5236); g.arc(360, 136, 14, u + 0.5236, u - 0.5236, true); g.closePath(); g.fill(); }
        dot(360, 136, 7.5);
        pen(INK, 3, 4); rr(280, 212, 160, 34, 17); hide(); g.stroke();      // the bar that only ever fills
        if (d.dose > 0) { g.save(); rr(280, 212, 160, 34, 17); g.clip(); A(0.9); pen(col, 0, 0); g.fillRect(280, 212, 160 * d.dose / 100 * p, 34); g.restore(); }
        A(1); txt(Math.round(d.dose * p) + '%', 360, 298, 46, col);
        pen(AMB, 6, 12); arrow(560, 262, 560, 150, 18);            // up is the only way it goes
        A(0.8); pen(GREY, 6, 0); arrow(160, 150, 160, 262, 18);
        A(1); pen(BAD, 5, 10); line(132, 176, 188, 236); line(188, 176, 132, 236);
      }
    }
  };

  // ---------- 13. soil blocks sunlight too ----------
  SC.shade = {
    icon: '🧱', title: 'Soil blocks sunlight too', src: 'artemis',
    fix: function (d) {
      var slots = Math.round(num(d.slots, 16, 2, 40)), free = Math.round(num(d.free, 8, 0, slots));
      return { slots: slots, free: free, bags: Math.round(num(d.bags, 9, 0, slots)), loss: num(d.loss, 0.015, 0, 1) };
    },
    steps: function (d) {
      return ['Soil bags stop radiation. They stop sunlight just as well.',
        'The first ' + d.free + ' bags sit low on the walls. After that, they start to cover the skylights.',
        'With the skylights covered, the lamps inside must stay on all day. Right now that takes ' + Math.round(d.loss * 1000) / 10 + '% of your solar power.',
        'More shield, or more power? Real habitat designers face exactly this choice.'];
    },
    draw: function (d, s, t) {
      var i, k, p, q, u, x, y, a, n = d.slots, has = [], dark;
      // A dome with three skylights high up. count bags are on it (the first d.free in cyan, low on the walls).
      // Sunlight falls in through every skylight that is not covered. Returns how much of the skylights is covered (0 to 1).
      // only = a list of places: put bags in just those places instead (for the first step).
      function skydome(cx, cy, r, count, only) {
        var j, m, a0 = d.free / 2 * Math.PI / n, wide = Math.PI - 2 * a0, half = Math.min(0.13, wide * 0.1), mid, lo, hi, cov, sum = 0;
        for (j = 0; j < n; j++) has[j] = false;
        for (j = 0; j < count; j++) has[bagPlace(j, n)] = true;
        if (only) for (j = 0; j < only.length; j++) has[only[j]] = true;
        A(1); dome(cx, cy, r);
        for (j = -1; j <= 1; j++) {
          mid = Math.PI / 2 + j * wide * 0.3; cov = 0;
          for (m = 0; m < n; m++) {
            if (!has[m]) continue;
            lo = Math.max(mid - half, Math.PI - (m + 1) * Math.PI / n); hi = Math.min(mid + half, Math.PI - m * Math.PI / n);
            if (hi > lo) cov += (hi - lo) / (2 * half);
          }
          cov = cl(cov); sum += cov / 3;
          if (cov < 1) {                                           // daylight comes in
            A(0.2 * (1 - cov)); pen(AMB, 0, 0);
            shape([cx + Math.cos(mid + half) * r, cy - Math.sin(mid + half) * r, cx + Math.cos(mid - half) * r, cy - Math.sin(mid - half) * r, cx + Math.cos(mid - half) * r + 10, cy - 2, cx + Math.cos(mid + half) * r - 10, cy - 2], true); g.fill();
          }
          A(1); pen(cov < 1 ? INK : GREY, 7, cov < 1 ? 12 : 0); g.beginPath(); g.arc(cx, cy, r - 1, -(mid + half), -(mid - half)); g.stroke();
        }
        for (j = 0; j < n; j++) {
          m = bagPlace(j, n);
          A(1);
          if (!only) bag(cx, cy, r, n, m, j < d.free ? CY : AMB, j >= count);
          else if (has[j]) bag(cx, cy, r, n, j, AMB);
        }
        return sum;
      }
      if (s === 0) {
        ground(332);
        A(1); sun(84, 76, 36, t);
        d = { slots: 16, free: 8, bags: 0, loss: 0 }; n = 16;      // this step always shows the same simple dome
        skydome(390, 332, 120, 0, [4, 5, 6, 7]);
        for (i = 0; i < 4; i++) {                                  // light and radiation both stop in the soil
          a = Math.PI - (4.5 + i) * Math.PI / 16; x = 390 + Math.cos(a) * 140; y = 332 - Math.sin(a) * 140;
          u = (lap(t, 2.4, 0.5) + i * 0.27) % 1;
          if (i % 2) {
            A(1);
            if (fly(x, y, 0.75, 0.66, 260, u / 0.6, BAD, 3)) { A(1 - (u - 0.6) / 0.4); spark(x, y, 13, BAD); }
          } else {
            A(0.9); pen(AMB, 3, 12); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40; line(x - 0.75 * 250, y - 0.66 * 250, x, y); dash(); g.lineDashOffset = 0;
            A(0.6 + 0.4 * sway(t, 4, i)); spark(x, y, 11, AMB);
          }
        }
        a = Math.PI / 2 - 0.47; x = 390 + Math.cos(a) * 120; y = 332 - Math.sin(a) * 120;      // but a bare skylight lets the light in
        A(0.9); pen(AMB, 3, 12); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40; line(x - 0.75 * 250, y - 0.66 * 250, x + 0.75 * 56, y + 0.66 * 56); dash(); g.lineDashOffset = 0;
      } else if (s === 1) {
        ground(336);
        A(1); sun(84, 70, 34, t);
        k = still ? n : Math.floor(ph(t, 0.7, 0.42 * n) * n + 0.001);      // bags go on one by one
        skydome(360, 336, 124, k);
        A(1); txt(k + (k === 1 ? ' bag' : ' bags'), 596, 70, 30, k > d.free ? AMB : CY);
      } else if (s === 2) {
        ground(330, 30, 500);
        A(1); sun(70, 62, 30, t);
        dark = skydome(280, 330, 122, d.bags);
        // the lamp inside: on when the skylights are covered
        A(1); pen(dark > 0 ? AMB : GREY, 3, dark > 0 ? 16 : 0); line(280, 212, 280, 232); ring(280, 244, 12); if (dark > 0) wash(0.6);
        if (dark > 0) for (i = 0; i < 7; i++) { a = 0.2 + i * 0.46; A(0.5 + 0.3 * sway(t, 3, i)); line(280 + Math.cos(a) * 20, 244 + Math.sin(a) * 20, 280 + Math.cos(a) * 32, 244 + Math.sin(a) * 32); }
        A(0.95); astro(280, 328, 0.8, INK);
        // the solar power, and the slice the lamps take
        y = d.loss > 0 ? Math.max(7, 224 * d.loss) : 0;
        A(1); pen(AMB, 3.5, 10); rr(566, 84, 64, 224, 14); hide(); g.stroke();
        g.save(); rr(566, 84, 64, 224, 14); g.clip(); A(0.75); pen(AMB, 0, 0); g.fillRect(566, 84 + y, 64, 224 - y); g.restore();
        if (y > 0) { A(1); pen(AMB, 2.5, 6); line(552, 84 + y, 644, 84 + y); }
        if (dark > 0 && d.loss > 0) {
          A(0.7); pen(AMB, 2.5, 6); dash(6, 7); path([566, 150, 470, 150, 470, 200, 300, 200, 292, 232]); dash();
          for (i = 0; i < 3; i++) { q = along([566, 150, 470, 150, 470, 200, 300, 200, 292, 232], (lap(t, 2.4, 0.4) + i / 3) % 1); A(1); pen(AMB, 2, 12); dot(q.x, q.y, 5); }
        }
        A(1); txt('solar power', 598, 56, 20, AMB); txt('−' + Math.round(d.loss * 1000) / 10 + '%', 598, 340, 30, AMB);
      } else {
        a = still ? 0 : Math.sin(t * 0.9) * 0.13;                  // the scales tip one way, then the other
        A(1); pen(CY, 4); line(360, 136, 360, 322); path([300, 322, 420, 322]); dot(360, 136, 7);
        x = 190 * Math.cos(a); y = 190 * Math.sin(a);
        line(360 - x, 136 + y, 360 + x, 136 - y);
        for (k = -1; k <= 1; k += 2) {
          p = 360 + k * x; q = 136 - k * y;                         // the end of the beam on this side
          A(0.8); pen(CY, 2.5, 6); line(p, q, p - 62, q + 104); line(p, q, p + 62, q + 104);
          A(1); pen(CY, 4); line(p - 70, q + 104, p + 70, q + 104);
          if (k < 0) {
            pen(CY, 2.5, 8);
            box(p - 46, q + 82, 44, 20, 6); wash(0.4); box(p + 2, q + 82, 44, 20, 6); wash(0.4); box(p - 22, q + 60, 44, 20, 6); wash(0.4);
            txt('shield', p, q + 132, 24, CY);
          } else {
            cell(p, q + 68, 40, 60, 1); g.fillStyle = BG; g.shadowBlur = 0; zap(p, q + 68, 16); g.fill();
            txt('power', p, q + 132, 24, AMB);
          }
        }
        A(1); txt('?', 360, 78 + sway(t, 2) * 3, 50, INK);
      }
    }
  };

  // ---------- 14. the long dark ----------
  SC.longdark = {
    icon: '🌑', title: 'The long dark', src: 'lro',
    fix: function () { return {}; },
    steps: function () {
      return ['On most of the Moon, day lasts two weeks. Then comes two weeks of night, at about −130°C.',
        'Your outpost sits on a crater rim near the south pole, where the Sun almost never sets.',
        'But sometimes a mountain hides the Sun for a whole day, and the panels make almost nothing.',
        'So save power cells on the rack the day before, and spend them only on what keeps the crew alive.'];
    },
    draw: function (d, s, t) {
      var i, p, u, x, y, a;
      // The crater rim with the outpost and its solar panel on top, and the dark crater behind it.
      function rim() {
        A(0.6); pen('#020611', 0, 0); shape([440, 232, 500, 292, 566, 340, 720, 354, 720, 405, 440, 405], true); g.fill();
        A(0.9); pen(CY, 3, 6); path([0, 318, 150, 306, 280, 262, 340, 232, 440, 232, 500, 292, 566, 340, 720, 354]);
        A(1); dome(396, 232, 32);
        pen(CY, 3); line(326, 236, 326, 206);
        g.save(); g.translate(326, 198); g.rotate(1.25); box(-22, -5, 44, 10, 3); hide(); g.stroke(); wash(0.35); g.restore();
      }
      // Sunbeams from the Sun at (sx, 240) to the solar panel.
      function beams(sx, k) {
        for (var j = 0; j < 3; j++) { A(k); pen(AMB, 3, 10); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40; line(sx + 52, 230 - j * 11, 310, 210 - j * 10); }
        dash(); g.lineDashOffset = 0;
      }
      if (s === 0) {
        A(0.75); txt('seen from above', 100, 26, 18, INK);
        A(1); pen(AMB, 4, 18); ring(-46, 205, 96); wash(0.2);      // the Sun, far away to the left
        for (i = 0; i < 5; i++) { A(0.7); pen(AMB, 3, 10); dash(12, 10); g.lineDashOffset = still ? 0 : -t * 40; line(70, 125 + i * 40, 230, 125 + i * 40); }
        dash(); g.lineDashOffset = 0;
        g.save(); g.beginPath(); g.arc(390, 205, 124, 0, TAU); g.clip();      // the Moon: one half in sunlight, one half in the dark
        A(0.2); pen(AMB, 0, 0); g.fillRect(260, 75, 130, 260);
        A(0.85); pen('#020611', 0, 0); g.fillRect(390, 75, 130, 260);
        g.restore();
        A(1); pen(INK, 3.5, 10); ring(390, 205, 124);
        A(0.5); pen(INK, 2, 0); dash(4, 8); line(390, 84, 390, 326); dash();
        A(1); txt('day', 326, 182, 26, AMB); txt('2 weeks', 326, 216, 20, AMB);
        txt('night', 454, 168, 26, CY); txt('2 weeks', 454, 202, 20, CY); txt('−130°C', 454, 238, 22, CY);
        // one place on the Moon, carried from day into night as the Moon slowly turns
        a = Math.PI + lap(t, 12, 0.1) * TAU; x = 390 + Math.cos(a) * 124; y = 205 + Math.sin(a) * 124;
        A(1); pen(Math.cos(a) < 0 ? AMB : CY, 3, 12); ring(x, y, 10); hide(); g.stroke(); wash(0.6);
      } else if (s === 1) {
        stars(18, 61);
        x = 150 + sway(t, 0.45) * 56;                              // the Sun slides to and fro, low over the horizon
        A(0.45); pen(AMB, 2, 0); dash(3, 9); line(40, 240, 330, 240); dash();
        A(1); sun(x, 240, 28, t);
        beams(x, 0.75);
        rim();
        A(1); txt('south pole', 396, 170, 22, INK);
        A(0.7); txt('crater', 610, 384, 20, CY);
      } else if (s === 2) {
        stars(18, 61);
        p = ez(ph(t, 0.8, 3.2));                                   // the Sun slips behind the mountain
        A(1 - ph(p, 0.7, 0.3)); sun(mix(96, 236, p), 240, 28, t);
        if (p < 0.5) beams(mix(96, 236, p), 0.75 * (1 - p * 2));
        A(1); pen(BG, 0, 0); shape([150, 306, 236, 126, 322, 242, 280, 262], true); g.fill();
        pen(CY, 3, 6); path([150, 306, 236, 126, 322, 242]);
        A(0.4 * p); pen('#020611', 0, 0); g.fillRect(0, 0, W, HT);  // everything goes dim
        rim();
        A(1); cell(628, 118, 52, 90, mix(1, 0.06, p), p > 0.7 ? BAD : AMB); txt('power', 628, 192, 20, p > 0.7 ? BAD : AMB);
      } else {
        stars(26, 77);
        A(1); pen(CY, 3.5); box(86, 122, 272, 150, 16); wash(0.06);      // the rack: four cells put aside the day before
        for (i = 0; i < 4; i++) { A(1); cell(132 + i * 60, 202, 42, 86, ez(ph(t, 0.4 + i * 0.5, 0.7))); }
        A(1); txt('rack', 222, 302, 22, CY);
        A(0.9); pen(AMB, 3.5, 10); arrow(376, 204, 456, 236, 13);   // they go to what keeps the crew alive
        ground(326, 440, 700); A(1); dome(574, 326, 90); astro(574, 324, 0.9, INK);
        u = 1 + 0.1 * sway(t, 4);                                  // a beating heart, and air to breathe
        pen(AMB, 3, 12); g.beginPath(); g.moveTo(628, 280 + 14 * u);
        g.bezierCurveTo(628 - 26 * u, 280 - 4 * u, 628 - 12 * u, 280 - 24 * u, 628, 280 - 9 * u);
        g.bezierCurveTo(628 + 12 * u, 280 - 24 * u, 628 + 26 * u, 280 - 4 * u, 628, 280 + 14 * u); g.stroke(); wash(0.4);
        pen(CY, 2.5, 10); ring(520, 280, 17); txt('O₂', 520, 281, 16, CY);
      }
    }
  };

  // ---------- 15. why batteries hate being empty ----------
  SC.battery = {
    icon: '🔋', title: 'Why batteries hate being empty', src: 'mer',
    fix: function (d) { return { cap: share(d.cap, 1, 0, 1) }; },
    steps: function (d) {
      return ['A battery stores energy in thin layers of chemicals.',
        'Draining it all the way to zero damages those layers a little.',
        'Each time, it can hold a bit less: yours holds ' + pct(d.cap) + '% of what it did. Rover drivers always keep some charge in reserve.'];
    },
    draw: function (d, s, t) {
      var p, u, x, lim, lvl;
      // The battery cut open: a case with seven thin layers inside. bad(k) = how cracked layer k is (0 to 1).
      function body(bad) {
        var k, px, c;
        A(1); pen(CY, 3.5); box(150, 92, 400, 196, 24); wash(0.05); pen(CY, 0, 8); slab(550, 154, 16, 72, 5);
        for (k = 0; k < 7; k++) {
          px = 190 + k * 53; c = bad ? cl(bad(k)) : 0;
          A(0.85); pen(k % 2 ? INK : CY, 2.5, 6); box(px, 114, 12, 152, 5); wash(0.4);
          if (c > 0) { A(c); pen(BAD, 3, 10); path([px + 2, 120, px + 10, 146, px + 2, 170, px + 10, 196, px + 2, 222, px + 10, 248, px + 4, 262]); }
        }
        A(1); txt('−', 120, 190, 32, INK); txt('+', 598, 190, 30, INK);
      }
      // Energy moving between the layers: more dots when there is more charge.
      function energy(full) {
        var k, m, f, n = Math.round(full * 3);
        for (k = 0; k < 6; k++) {
          for (m = 0; m < n; m++) {
            f = (lap(t, 1.8, 0.5) + m / 3 + k * 0.19) % 1;
            A(Math.sin(f * Math.PI)); pen(AMB, 0, 10); dot(mix(208, 237, f) + k * 53, 140 + m * 50, 5);
          }
        }
      }
      if (s === 0) {
        body(null); energy(1);
      } else if (s === 1) {
        p = ez(ph(t, 0.7, 3.2)); u = ph(t, 4, 0.6);                // the charge runs out, then a layer cracks
        body(function (k) { return k === 3 ? u : 0; });
        energy(1 - p);
        if (u > 0 && u < 1) { A(Math.sin(u * Math.PI)); spark(355, 190, 46, BAD); }
        A(1); pen(INK, 3, 4); rr(150, 318, 400, 28, 14); hide(); g.stroke();      // the charge gauge
        if (p < 1) { g.save(); rr(150, 318, 400, 28, 14); g.clip(); A(0.9); pen(p > 0.85 ? BAD : AMB, 0, 0); g.fillRect(150, 318, 400 * (1 - p), 28); g.restore(); }
        A(1); txt(Math.round(100 * (1 - p)) + '%', 606, 333, 26, p > 0.85 ? BAD : AMB);
      } else {
        lim = 156 + 388 * d.cap;                                   // how far it can still fill
        lvl = still ? 1 : 0.6 + 0.4 * Math.cos(t * 0.9);           // charging and using, but never down to empty
        body(function (k) { return 196 + k * 53 > lim ? 1 : 0; });
        g.save(); rr(150, 92, 400, 196, 24); g.clip();
        A(0.32); pen(AMB, 0, 0); g.fillRect(150, 92, (lim - 150) * lvl, 196);
        if (d.cap < 0.995) { A(0.22); pen(BAD, 0, 0); g.fillRect(lim, 92, 550 - lim, 196); }      // the part that is gone for good
        g.restore();
        A(1); pen(AMB, 3.5, 10); line(lim, 80, lim, 300); txt(pct(d.cap) + '%', Math.min(lim, 560), 52, 34, AMB);
        if (d.cap < 0.9) { A(0.7); pen(INK, 2, 0); dash(5, 6); line(544, 80, 544, 300); dash(); txt('new', 544, 322, 20, INK); }
        x = 150 + (lim - 150) * 0.2;                               // always keep this much
        A(0.9); pen(CY, 2.5, 6); dash(5, 6); line(x, 96, x, 300); dash(); txt('reserve', x, 322, 20, CY);
      }
    }
  };

  // ---------- the panel (built once, the first time a hologram opens) ----------
  var root = null, panel, canvas, capEl, titleEl, iconEl, srcEl, dotsEl, prevBtn, nextBtn, replayBtn, closeBtn;
  var cur = null;             // what is on show: { id, sc, d, caps, step, onClose, back }
  var raf = 0, stepAt = 0, lastT = 0, frozen = false;
  var calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function now() { return (window.performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function val(v, d) { return typeof v === 'function' ? v(d) : v; }
  function sound(name) { try { if (JA.audio && JA.audio.play) JA.audio.play(name); } catch (e) { /* no sound: carry on */ } }
  function say(text) { try { if (JA.audio && JA.audio.speak) JA.audio.speak(text); } catch (e) { /* no voice: carry on */ } }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text, label) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function build() {
    var head = el('div', 'holo-head'), names = el('div', 'holo-names'), view = el('div', 'holo-view'), stage = el('div', 'holo-stage');
    var tab = el('div', 'holo-tab'), screen = el('b'), foot = el('div', 'holo-foot');
    root = el('div', 'holo-hidden'); root.id = 'holo-root';
    panel = el('div', 'holo-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    iconEl = el('span', 'holo-icon'); iconEl.setAttribute('aria-hidden', 'true');
    titleEl = el('h2', 'holo-title');
    names.appendChild(el('small', 'holo-kicker', 'HOLO-TABLET')); names.appendChild(titleEl);
    closeBtn = button('holo-x', '✕', 'Close the hologram');
    head.appendChild(iconEl); head.appendChild(names); head.appendChild(closeBtn);
    canvas = el('canvas', 'holo-canvas'); canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas); stage.appendChild(el('div', 'holo-scan'));
    // the wrist tablet the beam comes out of: a strap, a small screen, and two lights on the screen
    tab.setAttribute('aria-hidden', 'true'); screen.appendChild(el('i')); screen.appendChild(el('i')); tab.appendChild(screen);
    view.appendChild(stage); view.appendChild(tab);
    capEl = el('p', 'holo-cap'); capEl.setAttribute('aria-live', 'polite');
    prevBtn = button('holo-btn holo-prev', '◀', 'Previous step');
    dotsEl = el('div', 'holo-dots'); dotsEl.setAttribute('role', 'img');
    replayBtn = button('holo-btn holo-replay', '↻', 'Replay this step'); replayBtn.appendChild(el('span', '', ' Replay'));
    nextBtn = button('holo-btn holo-next', 'Next ▶');
    foot.appendChild(prevBtn); foot.appendChild(dotsEl); foot.appendChild(replayBtn); foot.appendChild(nextBtn);
    srcEl = el('small', 'holo-src');
    panel.appendChild(head); panel.appendChild(view); panel.appendChild(capEl); panel.appendChild(foot); panel.appendChild(srcEl);
    root.appendChild(panel); document.body.appendChild(root);
    closeBtn.addEventListener('click', function () { H.close(); });
    prevBtn.addEventListener('click', function () { go(-1); });
    nextBtn.addEventListener('click', function () { go(1); });
    replayBtn.addEventListener('click', function () { if (cur) { sound('tap'); say(cur.caps[cur.step]); play(); } });
    window.addEventListener('resize', function () { if (cur && (still || frozen)) render(cur.step, lastT); });
    // labels in the picture use the game's title font (Exo 2), then whatever the title falls back to
    try { FONT = '"Exo 2", ' + (window.getComputedStyle(titleEl).fontFamily || '"Segoe UI", system-ui, sans-serif'); } catch (e) { /* keep the fallback */ }
  }

  // Give the canvas as many pixels as it covers on the screen (at most 2 per point, so phones stay fast).
  function fit() {
    var w = canvas.clientWidth || W, px = Math.round(w * Math.min(2, window.devicePixelRatio || 1));
    if (canvas.width !== px) { canvas.width = px; canvas.height = Math.round(px * HT / W); }
    S = canvas.width / W;
  }
  function render(step, t) {
    if (!cur) return;
    fit();
    g = canvas.getContext('2d');
    lastT = t;
    fade = 1; backdrop(t);
    fade = still ? 1 : ph(t, 0, 0.35);
    g.save();
    try { cur.sc.draw(cur.d, step, t); }
    catch (e) { if (window.console) console.warn('Astro Outpost hologram ' + cur.id + ' could not be drawn:', e); }
    g.restore();
  }
  function tick() {
    raf = 0;
    if (!cur || frozen) return;
    render(cur.step, now() - stepAt);
    raf = window.requestAnimationFrame(tick);
  }
  // Start (or restart) the moving picture for the step on show.
  function play() {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    if (!cur) return;
    frozen = false; stepAt = now();
    still = !!(calm && calm.matches);
    if (still) { render(cur.step, 99); return; }
    render(cur.step, 0);
    raf = window.requestAnimationFrame(tick);
  }
  // Put step i on show: its sentence, the dots and the buttons.
  function show(i, quiet) {
    var n = cur.caps.length, k, dotEl;
    cur.step = i;
    capEl.textContent = cur.caps[i];
    while (dotsEl.firstChild) dotsEl.removeChild(dotsEl.firstChild);
    for (k = 0; k < n; k++) { dotEl = el('span', 'holo-dot' + (k < i ? ' holo-done' : k === i ? ' holo-now' : '')); dotsEl.appendChild(dotEl); }
    dotsEl.setAttribute('aria-label', 'Step ' + (i + 1) + ' of ' + n);
    nextBtn.textContent = i === n - 1 ? 'Got it ✓' : 'Next ▶';
    if (i === 0 && document.activeElement === prevBtn) nextBtn.focus();
    prevBtn.disabled = i === 0;
    if (!quiet) say(cur.caps[i]);
  }
  function go(by) {
    if (!cur) return;
    var i = cur.step + by;
    if (i >= cur.caps.length) { H.close(); return; }
    if (i < 0) return;
    sound('tap'); show(i); play();
  }
  // Fill the panel with one scene. quiet = no sound and no voice (the test hook uses it).
  function mount(id, data, opts, quiet) {
    var sc = SC[id], d = sc.fix(data && typeof data === 'object' ? data : {}), src = (JA.SOURCES || {})[val(sc.src, d)];
    if (!root) build();
    if (!cur) cur = { back: document.activeElement, onClose: opts && typeof opts.onClose === 'function' ? opts.onClose : null };
    cur.id = id; cur.sc = sc; cur.d = d; cur.caps = sc.steps(d); cur.step = 0;
    iconEl.textContent = sc.icon;
    titleEl.textContent = val(sc.title, d);
    panel.setAttribute('aria-label', val(sc.title, d));
    srcEl.textContent = src && src.name ? 'Source: ' + src.name : '';
    if (root.className !== 'holo-on') { root.className = ''; void root.offsetWidth; root.className = 'holo-on'; }
    document.body.classList.add('holo-open');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    if (!quiet) sound('page');
  }

  // ---------- keys ----------
  // Tab walks round our four buttons and never leaves the panel.
  function trap(e) {
    var f = [closeBtn, prevBtn, replayBtn, nextBtn].filter(function (b) { return !b.disabled; }), i = f.indexOf(document.activeElement);
    e.preventDefault();
    if (i < 0) nextBtn.focus();
    else f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
  }
  function ownButton() { var a = document.activeElement; return a && a.tagName === 'BUTTON' && panel.contains(a) && !a.disabled ? a : null; }
  // The keys are caught before the game sees them, so the astronaut does not jump when you press Space.
  function onKey(e) {
    if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
    var c = e.code || '', k = e.key || '', act = '', b;
    if (k === 'Tab') { e.stopPropagation(); trap(e); return; }
    if (c === 'ArrowRight' || k === 'ArrowRight' || k === 'Right' || c === 'KeyE' || (!c && (k === 'e' || k === 'E'))) act = 'next';
    else if (c === 'Space' || k === ' ' || k === 'Spacebar' || c === 'Enter' || c === 'NumpadEnter' || k === 'Enter') act = 'press';
    else if (c === 'ArrowLeft' || k === 'ArrowLeft' || k === 'Left') act = 'prev';
    else if (c === 'Escape' || k === 'Escape' || k === 'Esc' || c === 'KeyT' || (!c && (k === 't' || k === 'T'))) act = 'close';
    if (!act) return;
    e.stopPropagation(); e.preventDefault();
    if (e.repeat) return;                                          // a key held down counts once
    if (act === 'prev') go(-1);
    else if (act === 'close') H.close();
    else if (act === 'press' && (b = ownButton())) b.click();      // Space or Enter presses the button you are on
    else go(1);
  }
  // Firefox presses a button again when Space comes back up: stop that, we already pressed it.
  function onKeyUp(e) {
    var c = e.code || '', k = e.key || '';
    if (cur && (c === 'Space' || k === ' ' || k === 'Spacebar' || c === 'Enter' || k === 'Enter') && ownButton()) e.preventDefault();
  }

  // ---------- dew: water out of thin air (Sahrun's dew catcher) ----------
  SC.dew = {
    icon: '💧', title: 'How dew forms', src: 'earthobs',
    fix: function (d) { return { water: Math.round(num(d.water, 16, 1, 99)) }; },
    steps: function (d) {
      return ['On a clear night, the sand and the net send their heat up into the open sky, and get cold.',
        'Air always holds some invisible water vapour. Touching the cold net, it cools until the vapour turns into drops: dew.',
        'The drops run down into the can: about ' + d.water + ' water after a clear, still night. Wind and blowing sand keep the net too warm for dew.'];
    },
    draw: function (d, s, t) {
      var i, k, u, x, y;
      // the net between two posts; cold = it glows cyan
      function net(cold) {
        A(1); pen(INK, 3, 6); line(250, 350, 250, 110); line(470, 350, 470, 110);
        A(0.55); pen(cold ? CY : INK, 1.5, cold ? 8 : 0);
        for (k = 0; k <= 8; k++) line(250 + 220 * k / 8, 120, 250 + 220 * k / 8, 270);
        for (k = 0; k <= 5; k++) line(250, 120 + 150 * k / 5, 470, 120 + 150 * k / 5);
        A(1);
      }
      stars(24, 12);
      ground(350);
      if (s === 0) {
        net(false);
        for (i = 0; i < 9; i++) {                                  // heat rising out of the sand and the net into the clear sky
          u = (lap(t, 2.6, 0.5) + i / 9) % 1; x = 70 + i * 72;
          A(0.85 * (1 - u)); pen(AMB, 2.5, 10); wavy(x, 340 - u * 60, 300 - u * 260, 5, (still ? 0 : -t * 3) + i);
        }
        A(1); txt('clear sky', 600, 46, 22, INK); txt('heat escapes', 120, 46, 22, AMB);
      } else if (s === 1) {
        net(true);
        for (i = 0; i < 14; i++) {                                 // vapour drifting in from the air
          u = (lap(t, 3.2, 0.6) + rnd(i)) % 1;
          x = mix(40 + rnd(i + 5) * 120, 260 + rnd(i + 9) * 200, u); y = 130 + rnd(i + 2) * 140;
          A(0.85 * (1 - u)); pen(CY, 0, 6); dot(x, y, 2.5);
        }
        for (i = 0; i < 12; i++) { A(1); pen(CY, 0, 10); dot(256 + 208 * rnd(i + 20), 126 + 138 * rnd(i + 40), 2 + 4.5 * ez(ph(t, rnd(i) * 1.6, 1.4))); }      // drops growing on the net
        A(1); txt('water vapour', 120, 96, 22, CY); txt('dew', 360, 92, 26, CY);
      } else {
        net(true);
        for (i = 0; i < 8; i++) { u = (lap(t, 2, 0.7) + i / 8) % 1; A(1); pen(CY, 0, 10); dot(264 + i * 27, 124 + u * 148, 5); }      // drops running down
        A(1); pen(INK, 3, 6); line(240, 280, 480, 280); line(480, 280, 516, 300);      // the gutter and the spout
        k = still ? 0.7 : ez((t / 5) % 1);
        A(1); pen(CY, 3.5, 6); box(512, 292, 70, 58, 8); hide(); g.stroke();
        pen(CY, 0, 10); slab(516, 346 - 50 * k, 62, 50 * k, 5);
        A(1); txt('+' + d.water + ' water', 600, 250, 24, CY);
      }
    }
  };

  // ---------- two waves tell the distance (the Sandquake Sensor) ----------
  SC.swave = {
    icon: '〰️', title: 'Two waves tell the distance', src: 'insight',
    fix: function (d) { return { vp: Math.round(num(d.vp, 400, 50, 9000)), vs: Math.round(num(d.vs, 200, 20, 5000)) }; },
    steps: function (d) {
      var per = Math.round(d.vp * d.vs / (d.vp - d.vs) / 10);
      return ['Something shakes the ground, and two kinds of waves spread out from it.',
        'The P wave pushes and pulls. It is fast, so it arrives first. The S wave shakes from side to side. It is slower, so it arrives later.',
        'The farther away the shaking, the bigger the gap between them. In this sand, every tenth of a second of gap means about ' + per + ' metres.'];
    },
    draw: function (d, s, t) {
      var i, u, r1, r2, prog;
      // a sensor's trace: a flat line with a small wiggle (P) and a big one (S), drawn from left to right as time passes
      function trace(y, xp, xs, label, col) {
        A(0.6); pen(GREY, 2, 0); line(60, y, 660, y);
        g.save(); g.beginPath(); g.rect(0, 0, 60 + 600 * prog, HT); g.clip();
        A(1); pen(CY, 3, 8); zig(xp, xp + 40, y - 8, 16, 6);
        pen(AMB, 3.5, 10); zig(xs, xs + 80, y - 18, 36, 8);
        g.restore();
        if (label) { A(1); txt(label, 60, y - 40, 20, col || INK, 'left'); }
      }
      if (s === 0) {
        ground(110);
        A(1); txt('ground', 650, 92, 20, CY, 'right');
        u = lap(t, 3.4, 0.6); r1 = 20 + u * 420; r2 = 20 + u * 210;
        A(1 - u * 0.6); pen(CY, 3, 10); arc(170, 280, r1, -Math.PI * 0.55, Math.PI * 0.45);
        A(1 - u * 0.6); pen(AMB, 3.5, 10); dash(10, 8); arc(170, 280, r2, -Math.PI * 0.55, Math.PI * 0.45); dash();
        A(1); spark(170, 280, 18, BAD);
        txt('P wave: fast', 470, 160, 22, CY); txt('S wave: slow', 470, 200, 22, AMB);
      } else if (s === 1) {
        prog = still ? 1 : Math.min(1, (t % 6) / 4.5);
        A(1); txt('the sensor feels', 360, 60, 22, INK);
        trace(220, 200, 420, '', INK);
        if (prog > 0.25) { A(1); txt('P', 220, 150, 26, CY); }
        if (prog > 0.62) { A(1); txt('S', 460, 140, 26, AMB); pen(AMB, 2.5, 6); arrow(220, 300, 420, 300, 10); arrow(420, 300, 220, 300, 10); txt('the gap', 320, 330, 22, AMB); }
      } else {
        prog = still ? 1 : Math.min(1, (t % 7) / 5);
        trace(150, 160, 240, 'near: a short gap', INK);
        trace(320, 160, 480, 'far: a long gap', INK);
      }
    }
  };

  // ---------- what the game can call ----------
  H.SCENES = {};
  Object.keys(SC).forEach(function (id) {
    var d = SC[id].fix({});
    H.SCENES[id] = { title: val(SC[id].title, d), icon: SC[id].icon, src: val(SC[id].src, d) };
  });
  H.has = function (id) { return typeof id === 'string' && SC.hasOwnProperty(id); };
  H.isOpen = function () { return !!cur; };
  // The title, icon, source and sentences of a scene for these numbers (some change with the place: Moon or Mars).
  H.info = function (id, data) {
    if (!H.has(id)) return null;
    var d = SC[id].fix(data && typeof data === 'object' ? data : {});
    return { title: val(SC[id].title, d), icon: SC[id].icon, src: val(SC[id].src, d), steps: SC[id].steps(d) };
  };
  // Show a scene. data = the live numbers (all optional). opts = { onClose: fn }. Returns true if it opened.
  H.open = function (id, data, opts) {
    if (!H.has(id) || !document.body) return false;
    if (cur) H.close();
    mount(id, data, opts, false);
    show(0); play();
    try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    return true;
  };
  H.close = function () {
    if (!cur) return;
    var was = cur;
    cur = null; frozen = false;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    root.className = 'holo-hidden';
    document.body.classList.remove('holo-open');
    sound('tap');
    try { if (was.back && was.back.focus && document.body.contains(was.back)) was.back.focus({ preventScroll: true }); } catch (e) { /* nothing to go back to */ }
    if (was.onClose) {
      try { was.onClose(); }
      catch (e2) { if (window.console) console.warn('Astro Outpost hologram onClose failed:', e2); }
    }
  };
  // TEST HOOK: draw one step of a scene exactly t seconds in, right now, with the clock stopped.
  // It opens the panel if needed and returns the canvas, so a test can take a picture of it.
  H.draw = function (id, data, step, t) {
    if (!H.has(id) || !document.body) return null;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    mount(id, data, null, true);
    frozen = true; still = false;
    show(Math.max(0, Math.min(cur.caps.length - 1, Math.round(+step) || 0)), true);
    render(cur.step, typeof t === 'number' && isFinite(t) ? t : 99);
    return canvas;
  };
})(window.JA);
