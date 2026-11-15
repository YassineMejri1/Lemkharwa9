/* Astro Outpost — keepsakes: a mission certificate and a photo postcard the player can keep.
   Both are drawn with the Canvas 2D API and saved as PNG pictures by the browser itself.
   Nothing is uploaded and nothing is stored: the pictures and the name never leave this device.
   The certificate names NASA's DONKI database as the data source and never draws a NASA logo. */
(function (JA) {
  'use strict';

  var CW = 1600, CH = 1131;          // certificate, A4 landscape
  var PW = 1200, PH = 800;           // postcard
  var TAU = Math.PI * 2;
  var FONT = "'Lexend', 'Trebuchet MS', sans-serif";   // the game's reading font (assets/fonts)
  var EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  var INK = '#f5f7ff', MUTED = '#b3bde0', GOLD = '#ffd23f', AIR = '#4fd8ff';
  var STORM = [MUTED, '#ffd23f', '#ffa24d', '#ff7f8e'];   // unknown · small · medium · big
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // rocks and craters near the horizon: [x, how far below the edge, half width]
  var MARKS = [[150, 26, 34], [300, 12, 18], [470, 9, 12], [690, 10, 20], [905, 7, 11], [1120, 11, 22], [1290, 16, 16], [1450, 28, 30]];
  var MONTH_RE = new RegExp('\\b(' + MONTHS.join('|') + ')\\b');
  var keptName = '';                 // remembered only until the page is closed

  // ---------- small helpers ----------
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  // never leave half of an emoji at the end of a shortened text
  function cut(t, n) { t = t.slice(0, n); var c = t.charCodeAt(t.length - 1); return c >= 0xd800 && c <= 0xdbff ? t.slice(0, -1) : t; }
  // one clean line of text: no line breaks, no doubled spaces, not longer than max
  function tidy(v, max) {
    var t = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
    return max && t.length > max ? cut(t, max) : t;
  }
  function num(v) { v = Math.round(Number(v)); return isFinite(v) ? v : 0; }
  function many(n, one, more) { return n + ' ' + (n === 1 ? one : more); }
  function list(v, max) { return v && v.length ? Array.prototype.slice.call(v, 0, max) : []; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function font(weight, size) { return weight + ' ' + size + 'px ' + FONT; }
  function esc(s) {
    var U = JA.ui;
    if (U && typeof U.esc === 'function') return U.esc(s);
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // a tiny seeded random, so the stars sit in the same places every time a picture is redrawn
  function seeded(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function todayText() { var d = new Date(); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function makeCanvas(w, h) {
    var c;
    try { c = document.createElement('canvas'); c.width = w; c.height = h; return c; } catch (e) { return null; }
  }
  function context(c) { try { return c.getContext('2d'); } catch (e) { return null; } }

  // ---------- text ----------
  // One line of text, made smaller until it fits in o.maxW (and cut with … if even the smallest
  // size is too wide). Returns how wide it came out.
  function put(ctx, text, x, y, o) {
    var maxW = o.maxW || 1380, weight = o.weight || 500, size = o.size, min = o.min || Math.min(size, 14), w;
    if (!text) return 0;
    ctx.font = font(weight, size);
    w = ctx.measureText(text).width;
    if (w > maxW) {
      size = Math.max(min, Math.floor(size * maxW / w)); ctx.font = font(weight, size);
      while (size > min && ctx.measureText(text).width > maxW) { size -= 1; ctx.font = font(weight, size); }
      if (ctx.measureText(text).width > maxW) {
        while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = cut(text, text.length - 1);
        text += '…';
      }
      w = ctx.measureText(text).width;
    }
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = o.color || INK;
    ctx.fillText(text, x, y, maxW);
    return Math.min(w, maxW);
  }

  // One centred line built from pieces with their own colour, weight or font:
  // parts = [{ t: text, c: colour, w: weight, k: size factor, f: font family }]. Shrinks to fit maxW.
  // A piece { dot: colour } is a round dot as tall as a small letter.
  function runs(ctx, parts, cx, y, size, maxW, min) {
    var s = size, i, w, x, squeeze;
    function setFont(p) { var px = Math.round(s * (p.k || 1)); ctx.font = p.f ? px + 'px ' + p.f : font(p.w || 500, px); }
    function width() {
      var sum = 0;
      for (i = 0; i < parts.length; i++) {
        if (parts[i].dot) parts[i].px = s;
        else { setFont(parts[i]); parts[i].px = ctx.measureText(parts[i].t).width; }
        sum += parts[i].px;
      }
      return sum;
    }
    min = min || 12;
    w = width();
    if (w > maxW) {
      s = Math.max(min, Math.floor(s * maxW / w)); w = width();
      while (s > min && w > maxW) { s -= 1; w = width(); }
    }
    squeeze = w > maxW ? maxW / w : 1;   // still too wide at the smallest size: press it together sideways
    ctx.save();
    ctx.translate(cx, y); ctx.scale(squeeze, 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    x = -w / 2;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].dot) disc(ctx, x + s * 0.3, -s * 0.33, s * 0.3, parts[i].dot);
      else { setFont(parts[i]); ctx.fillStyle = parts[i].c || INK; ctx.fillText(parts[i].t, x, 0); }
      x += parts[i].px;
    }
    ctx.restore();
    return s;
  }

  // Capital letters with air between them. Returns the width.
  function spaced(ctx, text, cx, y, size, gap, color) {
    var i, w = 0, ws = [], x;
    ctx.font = font(600, size); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
    for (i = 0; i < text.length; i++) { ws[i] = ctx.measureText(text.charAt(i)).width; w += ws[i] + (i ? gap : 0); }
    x = cx - w / 2;
    for (i = 0; i < text.length; i++) { ctx.fillText(text.charAt(i), x, y); x += ws[i] + gap; }
    return w;
  }

  // One emoji with its middle on (x, y), drawn by the system emoji font.
  function emoji(ctx, icon, x, y, size, maxW) {
    var m, up, down;
    size = Math.round(size);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ffffff';
    ctx.font = size + 'px ' + EMOJI;
    m = ctx.measureText(icon);
    if (maxW && m.width > maxW) {
      size = Math.max(8, Math.floor(size * maxW / m.width));
      ctx.font = size + 'px ' + EMOJI;
      m = ctx.measureText(icon);
    }
    up = m.actualBoundingBoxAscent; down = m.actualBoundingBoxDescent;
    ctx.fillText(icon, x, y + (typeof up === 'number' && typeof down === 'number' && up + down > 0 ? (up - down) / 2 : size * 0.35));
  }

  // ---------- shapes ----------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function disc(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function glow(ctx, x, y, r, rgb, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ', ' + alpha + ')'); g.addColorStop(1, 'rgba(' + rgb + ', 0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a little four-pointed twinkle
  function sparkle(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }
  function goldFill(ctx, y0, y1) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#fff6cf'); g.addColorStop(0.55, GOLD); g.addColorStop(1, '#f2a91e');
    return g;
  }
  // a thin gold line that fades out at both ends
  function rule(ctx, cx, y, w, twinkle) {
    var g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, 'rgba(255, 210, 63, 0)'); g.addColorStop(0.5, 'rgba(255, 210, 63, 0.9)'); g.addColorStop(1, 'rgba(255, 210, 63, 0)');
    ctx.fillStyle = g; ctx.fillRect(cx - w / 2, y - 1, w, 2);
    if (twinkle) sparkle(ctx, cx, y, 9, GOLD);
  }
  function stars(ctx, x, y, w, h, n, seed) {
    var r = seeded(seed), i, px, py, tint;
    ctx.save();
    for (i = 0; i < n; i++) {
      px = x + r() * w; py = y + r() * h; tint = r();
      ctx.globalAlpha = 0.2 + r() * 0.5;
      ctx.fillStyle = tint < 0.14 ? '#ffe7ad' : tint < 0.3 ? '#bfe6ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(px, py, 0.6 + r() * r() * 1.6, 0, TAU); ctx.fill();
    }
    for (i = 0; i < Math.round(n / 30); i++) {
      px = x + r() * w; py = y + r() * h;
      ctx.globalAlpha = 0.25 + r() * 0.25;
      sparkle(ctx, px, py, 4 + r() * 4, '#ffffff');
    }
    ctx.restore();
  }

  // =====================================================================
  //  CERTIFICATE
  // =====================================================================
  function backdrop(ctx, mars) {
    var g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#050816'); g.addColorStop(0.6, '#0b1232'); g.addColorStop(1, '#131d47');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
    glow(ctx, 250, 210, 560, mars ? '255, 150, 110' : '79, 216, 255', 0.1);
    glow(ctx, 1390, 380, 600, '176, 124, 255', 0.1);
    stars(ctx, 0, 0, CW, 1060, 240, mars ? 4177 : 1969);
    horizon(ctx, mars);
  }

  // The world you lived on, seen from above: grey for the Moon, rust for Mars.
  function horizon(ctx, mars) {
    var R = 6000, cx = CW / 2, cy = 1006 + R, g, i, m, x, y;
    if (mars) {   // Mars has thin, dusty air that glows at the edge. The Moon has no air, so its edge stays sharp.
      g = ctx.createRadialGradient(cx, cy, R, cx, cy, R + 30);
      g.addColorStop(0, 'rgba(255, 160, 110, 0.4)'); g.addColorStop(1, 'rgba(255, 160, 110, 0)');
      disc(ctx, cx, cy, R + 30, g);
    }
    g = ctx.createRadialGradient(cx, cy, R - 130, cx, cy, R);
    if (mars) { g.addColorStop(0, '#12080b'); g.addColorStop(0.7, '#3a1811'); g.addColorStop(0.9, '#8f4326'); g.addColorStop(0.97, '#dd8452'); g.addColorStop(1, '#ffc59a'); }
    else { g.addColorStop(0, '#0a0d19'); g.addColorStop(0.7, '#1c2130'); g.addColorStop(0.9, '#4c5364'); g.addColorStop(0.97, '#a3aaba'); g.addColorStop(1, '#e6e9f1'); }
    disc(ctx, cx, cy, R, g);
    if (!ctx.ellipse) return;
    for (i = 0; i < MARKS.length; i++) {
      m = MARKS[i]; x = m[0]; y = cy - Math.sqrt(R * R - (x - cx) * (x - cx)) + m[1];
      ctx.beginPath(); ctx.ellipse(x, y, m[2], m[2] * 0.2, 0, 0, TAU);
      ctx.fillStyle = mars ? 'rgba(40, 10, 4, 0.4)' : 'rgba(0, 0, 0, 0.32)'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y, m[2], m[2] * 0.2, 0, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = 1.5; ctx.strokeStyle = mars ? 'rgba(255, 200, 160, 0.25)' : 'rgba(255, 255, 255, 0.25)'; ctx.stroke();
    }
  }

  function frame(ctx) {
    ctx.lineJoin = 'round';
    roundRect(ctx, 26, 26, CW - 52, CH - 52, 24); ctx.lineWidth = 5; ctx.strokeStyle = GOLD; ctx.stroke();
    roundRect(ctx, 40, 40, CW - 80, CH - 80, 13); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 210, 63, 0.6)'; ctx.stroke();
    sparkle(ctx, 68, 68, 10, GOLD); sparkle(ctx, CW - 68, 68, 10, GOLD);
    sparkle(ctx, 68, CH - 68, 10, GOLD); sparkle(ctx, CW - 68, CH - 68, 10, GOLD);
  }

  function header(ctx) {
    var w = spaced(ctx, 'ASTRO OUTPOST', CW / 2, 88, 22, 7, AIR);
    sparkle(ctx, CW / 2 - w / 2 - 26, 80, 8, AIR); sparkle(ctx, CW / 2 + w / 2 + 26, 80, 8, AIR);
    put(ctx, 'Junior Astronaut Mission Certificate', CW / 2, 158, { weight: 700, size: 68, min: 36, maxW: 1400, color: goldFill(ctx, 104, 164) });
    rule(ctx, CW / 2, 182, 460, true);
  }

  // "This certifies that … kept a crew alive for N days on …" (178 px tall)
  function certify(ctx, info, y) {
    var site = info.site || {}, name = tidy(info.name, 40) || 'this astronaut', level = tidy(info.level, 30), place = tidy(site.place, 90), w;
    put(ctx, 'This certifies that', CW / 2, y + 24, { weight: 500, size: 24, color: MUTED });
    w = put(ctx, name, CW / 2, y + 80, { weight: 700, size: 58, min: 28, maxW: 1240 });
    rule(ctx, CW / 2, y + 97, clamp(w + 160, 480, 1320), false);
    runs(ctx, [
      { t: info.won === false ? 'led an outpost crew for ' : 'kept a crew alive for ' },
      { t: num(info.days) + ' ' + (tidy(info.dayWord, 12) || 'days'), c: GOLD, w: 700 },
      { t: ' on ' },
      { t: tidy(site.name, 40) || 'another world', c: GOLD, w: 700 }
    ], CW / 2, y + 136, 32, 1340, 16);
    if (level) place = (place ? place + '   ·   ' : '') + level + ' mission';
    put(ctx, place, CW / 2, y + 170, { weight: 400, size: 22, min: 14, maxW: 1340, color: MUTED });
  }

  // The rank block grows or shrinks (s from 0.6 to 1.2) to use the room the badges and storms leave.
  function rankLayout(s) {
    var L = { r: 78 * s, cy: 98 * s, nameSize: Math.max(38, Math.round(66 * s)), statSize: Math.max(24, Math.round(28 * s)) };
    L.nameY = Math.round(196 * s) + 8 + Math.round(L.nameSize * 0.74);
    L.statY = L.nameY + 14 + L.statSize;
    L.h = L.statY + 8;
    return L;
  }
  // a gold seal with the rank's own emoji in the middle (a plain rosette: not anybody's logo)
  function seal(ctx, x, y, r, icon) {
    var i, a, d, g;
    glow(ctx, x, y, r * 2.6, '255, 210, 63', 0.2);
    ctx.beginPath();
    for (i = 0; i < 48; i++) {
      a = i * TAU / 48 - Math.PI / 2; d = r * (i % 2 ? 1.1 : 1.22);
      if (i) ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.closePath();
    ctx.fillStyle = goldFill(ctx, y - r * 1.22, y + r * 1.22); ctx.fill();
    disc(ctx, x, y, r * 0.97, '#c98d0d');
    g = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r * 0.92);
    g.addColorStop(0, '#2b3d85'); g.addColorStop(1, '#0f1736');
    disc(ctx, x, y, r * 0.9, g);
    ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, TAU);
    ctx.lineWidth = Math.max(1.5, r * 0.03); ctx.strokeStyle = 'rgba(255, 210, 63, 0.55)'; ctx.stroke();
    emoji(ctx, icon, x, y, r * 0.95, r * 1.3);
  }
  function rankBlock(ctx, info, y, L) {
    var rank = info.rank || {}, cx = CW / 2, parts = [], finds = num(info.finds), decisions = num(info.decisions);
    function stat(icon, text, strong) {
      if (parts.length) parts.push({ t: '      ' });
      parts.push({ t: icon, f: EMOJI });
      parts.push({ t: ' ' + text, c: strong ? GOLD : INK, w: strong ? 700 : 600 });
    }
    seal(ctx, cx, y + L.cy, L.r, tidy(rank.icon, 16) || '🚀');
    put(ctx, tidy(rank.name, 40) || 'Astronaut', cx, y + L.nameY, { weight: 700, size: L.nameSize, min: 24, maxW: 1300, color: goldFill(ctx, y + L.nameY - L.nameSize * 0.75, y + L.nameY + L.nameSize * 0.1) });
    stat('📅', many(num(info.days), String(info.dayWord || 'days').replace(/s$/, ''), info.dayWord || 'days'), true);
    if (finds > 0) stat('🔬', many(finds, 'discovery', 'discoveries'), false);
    if (decisions > 0) stat('🧭', many(decisions, 'big decision', 'big decisions'), false);
    runs(ctx, parts, cx, y + L.statY, L.statSize, 1340, 14);
  }

  // Badges: a round medallion with the emoji, and the badge name beside it. Five to a row.
  function badgeHeight(n) { return !n ? 0 : n > 5 ? 112 : 56; }
  function badgeRows(ctx, badges, y) {
    var n = badges.length, two = n > 5, h = two ? 50 : 56, first = two ? Math.ceil(n / 2) : n;
    badgeRow(ctx, badges.slice(0, first), y + h / 2, h);
    if (two) badgeRow(ctx, badges.slice(first), y + h + 12 + h / 2, h);
  }
  function badgeRow(ctx, row, cy, h) {
    var maxW = 1380, gap = 14, size = Math.round(h * 0.4), names = [], widths = [], total = gap * (row.length - 1), i, x, k;
    ctx.font = font(600, size);
    for (i = 0; i < row.length; i++) {
      names[i] = tidy(row[i] && row[i].name, 28);
      widths[i] = h + 2 + ctx.measureText(names[i]).width + h * 0.42;
      total += widths[i];
    }
    k = total > maxW ? maxW / total : 1;   // very long names: make the whole row a little smaller
    ctx.save();
    ctx.translate(CW / 2, cy); ctx.scale(k, k);
    x = -total / 2;
    for (i = 0; i < row.length; i++) {
      roundRect(ctx, x, -h / 2, widths[i], h, h / 2);
      ctx.fillStyle = 'rgba(18, 26, 56, 0.86)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255, 210, 63, 0.5)'; ctx.stroke();
      disc(ctx, x + h / 2, 0, h / 2 - 5, GOLD);
      disc(ctx, x + h / 2, 0, h / 2 - 7.5, '#17224f');
      emoji(ctx, tidy(row[i] && row[i].icon, 16) || '🏅', x + h / 2, 0, h * 0.5, h * 0.62);
      ctx.font = font(600, size); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = INK;
      ctx.fillText(names[i], x + h + 2, size * 0.35);
      x += widths[i] + gap;
    }
    ctx.restore();
  }

  // "Real solar storms you lived through": one chip for each real flare, date and class.
  function stormCols(n) { return n <= 5 ? n : Math.ceil(n / 2); }
  function stormHeight(n) { return !n ? 96 : n > 5 ? 154 : 110; }
  function stormLevel(st) {
    var lv = num(st.level), c = str(st.cls).toUpperCase();
    if (lv >= 1 && lv <= 3) return lv;
    if (c.charAt(0) === 'X') return 3;
    if (c.charAt(0) === 'M') return parseFloat(c.slice(1)) >= 5 ? 2 : 1;
    return 0;
  }
  function stormPanel(ctx, info, storms, y) {
    var x = 110, w = CW - 220, cx = CW / 2, n = storms.length, from = tidy(info.from, 24), to = tidy(info.to, 24);
    var parts = [{ t: '☀️', f: EMOJI }, { t: ' Real solar storms you lived through', w: 700 }];
    var cols = stormCols(n), gap = 10, cw = n ? Math.min(280, (w - 56 - gap * (cols - 1)) / cols) : 0, ch = 36, size = 20, brief, big, i, row, inRow, px, py, st, lv;
    function day(s, cutMonth) { var d = tidy(s.date, 24); return cutMonth ? d.replace(MONTH_RE, function (m) { return m.slice(0, 3); }) : d; }
    function flare(s) { var c = tidy(s.cls, 8); return c ? '  ' + c : ''; }
    function widest(cutMonth) {
      var most = 0, j, s, wd;
      for (j = 0; j < n; j++) {
        s = storms[j] || {};
        ctx.font = font(500, 20); wd = ctx.measureText(day(s, cutMonth)).width;
        ctx.font = font(700, 20); wd += ctx.measureText(flare(s)).width + 20;   // + the dot
        most = Math.max(most, wd);
      }
      return most;
    }
    roundRect(ctx, x, y, w, stormHeight(n), 22);
    ctx.fillStyle = 'rgba(8, 12, 30, 0.84)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(79, 216, 255, 0.45)'; ctx.stroke();
    if (from && to) parts.push({ t: '     ' + (from === to ? 'the real Sun on ' + from : 'the real Sun, ' + from + ' to ' + to), c: MUTED, w: 400, k: 0.8 });
    runs(ctx, parts, cx, y + 40, 26, w - 56, 14);
    if (!n) {
      put(ctx, 'The real Sun stayed calm for your mission. Astronauts get lucky sometimes too!', cx, y + 78, { weight: 500, size: 24, min: 14, maxW: w - 56 });
      return;
    }
    // every chip gets the same text size; month names are shortened (Sep) only if the long ones do not fit
    brief = widest(false) > cw - 30; big = widest(brief);
    if (big > cw - 30) size = Math.max(12, Math.floor(20 * (cw - 30) / big));
    for (i = 0; i < n; i++) {
      row = i < cols ? 0 : 1; inRow = row ? n - cols : cols;
      px = cx - (inRow * cw + (inRow - 1) * gap) / 2 + (row ? i - cols : i) * (cw + gap);
      py = y + 58 + row * (ch + 8);
      st = storms[i] || {}; lv = stormLevel(st);
      roundRect(ctx, px, py, cw, ch, ch / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; ctx.fill();
      runs(ctx, [{ dot: STORM[lv] }, { t: day(st, brief) }, { t: flare(st), c: STORM[lv], w: 700 }], px + cw / 2, py + ch / 2 + size * 0.35, size, cw - 30, 11);
    }
  }

  function footer(ctx, info) {
    var src = info.source === 'live' ? ' (live)' : info.source === 'archive' ? ' (saved archive)' : '';
    var today = tidy(info.today, 40) || todayText(), o = { weight: 500, size: 18, min: 12, maxW: 1380, color: 'rgba(245, 247, 255, 0.92)' };
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'; ctx.shadowBlur = 6;
    put(ctx, 'Solar storm dates: NASA DONKI space-weather database' + src + '. SEP = solar particle event, CME = coronal mass ejection shock.', CW / 2, 1052, o);
    put(ctx, 'Astro Outpost is a student project and is not affiliated with or endorsed by NASA.   ·   ' + today, CW / 2, 1076, o);
    ctx.restore();
  }

  function drawCertificate(ctx, info) {
    var site = info.site || {}, badges = list(info.badges, 10), storms = list(info.storms, 10);
    var top = 194, bottom = 990, hB = 178, hD = badgeHeight(badges.length), hE = stormHeight(storms.length);
    var gaps = hD ? 4 : 3, room = bottom - top - hB - hD - hE, L, gap, y;
    // the biggest rank block (size from/50 down to to/50) that still leaves "air" px between the blocks
    function biggest(from, to, air) {
      var i, l;
      for (i = from; i >= to; i--) { l = rankLayout(i / 50); if (l.h <= room - gaps * air) return l; }
      return null;
    }
    backdrop(ctx, site.id === 'mars');
    frame(ctx);
    header(ctx);
    // share out the room that is left: roomy gaps if the seal can stay big, tighter gaps on a full page
    L = biggest(60, 39, 36) || biggest(39, 30, 26) || rankLayout(0.6);
    gap = Math.max(12, (room - L.h) / gaps);
    y = top + gap;
    certify(ctx, info, y); y += hB + gap;
    rankBlock(ctx, info, y, L); y += L.h + gap;
    if (hD) badgeRows(ctx, badges, y);
    stormPanel(ctx, info, storms, bottom - hE);
    footer(ctx, info);
  }
  function paintCertificate(canvas, info) {
    var ctx;
    if (!canvas) return;
    try { canvas.width = CW; canvas.height = CH; } catch (e) { return; }
    ctx = context(canvas);
    if (!ctx) return;
    try { drawCertificate(ctx, info || {}); } catch (e) { /* keep whatever was drawn so far */ }
  }
  function certificate(info) {
    var c = makeCanvas(CW, CH);
    paintCertificate(c, info);
    return c;
  }

  // =====================================================================
  //  POSTCARD
  // =====================================================================
  // fills the frame with the middle of the picture, cutting off whatever sticks out
  function cover(ctx, src, x, y, w, h) {
    var sw = src && (src.width || src.naturalWidth || src.videoWidth), sh = src && (src.height || src.naturalHeight || src.videoHeight), k, cw, ch;
    if (!sw || !sh) return false;
    k = Math.max(w / sw, h / sh); cw = w / k; ch = h / k;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
    return true;
  }
  function placeholder(ctx, x, y, w, h) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#050816'); g.addColorStop(1, '#18245a');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    stars(ctx, x, y, w, h, 150, 2024);
  }
  function drawPostcard(ctx, source, caption, sub) {
    var x = 44, y = 44, w = PW - 88, h = 556, ok = false;
    ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, PW, PH);
    ctx.save();
    roundRect(ctx, x, y, w, h, 28); ctx.clip();
    ctx.fillStyle = '#060914'; ctx.fillRect(x, y, w, h);
    try { ok = cover(ctx, source, x, y, w, h); } catch (e) { ok = false; }
    if (!ok) { try { placeholder(ctx, x, y, w, h); } catch (e2) { /* the dark fill stays */ } }
    ctx.restore();
    roundRect(ctx, x, y, w, h, 28); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(18, 26, 56, 0.28)'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(18, 26, 56, 0.16)'; ctx.strokeRect(1, 1, PW - 2, PH - 2);
    put(ctx, caption, PW / 2, 688, { weight: 700, size: 60, min: 24, maxW: 1080, color: '#18224a' });
    put(ctx, sub, PW / 2, 742, { weight: 500, size: 26, min: 14, maxW: 1080, color: '#5b6488' });
  }
  function postcard(sourceCanvas, caption, sub) {
    var c = makeCanvas(PW, PH), ctx = c ? context(c) : null;
    if (!ctx) return c;
    try { drawPostcard(ctx, sourceCanvas, tidy(caption, 70), tidy(sub, 110)); } catch (e) { /* keep whatever was drawn so far */ }
    try { c.keepsake = 'postcard'; } catch (e3) { /* ignore */ }
    return c;
  }

  // =====================================================================
  //  SAVE AS A PICTURE
  // =====================================================================
  function fileName(name) {
    name = tidy(name, 80).replace(/[\\\/:*?"<>|]+/g, '-') || 'astro-outpost';
    return /\.png$/i.test(name) ? name : name + '.png';
  }
  function clickLink(href, name) {
    var a = document.createElement('a');
    a.href = href; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }
  // done(true) once the browser has been handed the picture, done(false) if it could not be made
  function download(canvas, filename, done) {
    var name = 'astro-outpost.png', told = false;
    function tell(ok) { if (told) return; told = true; if (done) { try { done(ok); } catch (e) { /* ignore */ } } }
    function viaDataUrl() {
      try { clickLink(canvas.toDataURL('image/png'), name); tell(true); } catch (e) { tell(false); }
    }
    try {
      name = fileName(filename);
      if (!canvas) { tell(false); return; }
      if (!canvas.toBlob || !window.URL || !window.URL.createObjectURL) { viaDataUrl(); return; }
      canvas.toBlob(function (blob) {
        var url;
        if (!blob) { viaDataUrl(); return; }
        try {
          url = window.URL.createObjectURL(blob);
          clickLink(url, name);
          setTimeout(function () { try { window.URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 15000);
          tell(true);
        } catch (e) { viaDataUrl(); }
      }, 'image/png');
    } catch (e) { viaDataUrl(); }
  }
  function save(canvas, filename) { download(canvas, filename); }

  // =====================================================================
  //  THE CARDS (shown with the game's own info card)
  // =====================================================================
  // Draw once the game's font is ready. If the browser cannot tell us, draw anyway.
  function whenFont(done) {
    var called = false, timer = 0;
    function go() { if (called) return; called = true; clearTimeout(timer); try { done(); } catch (e) { /* ignore */ } }
    try {
      if (document.fonts && document.fonts.load && typeof Promise !== 'undefined' && !(document.fonts.check && document.fonts.check('700 40px Lexend') && document.fonts.check('400 40px Lexend'))) {
        timer = setTimeout(go, 1500);
        Promise.all([400, 500, 600, 700].map(function (w) { return document.fonts.load(w + ' 40px Lexend'); })).then(go, go);
        return;
      }
    } catch (e) { /* fall through and draw now */ }
    go();
  }
  // The game keeps Tab inside an open card, but it only looks for buttons and links.
  // This card has a text field too, so here Tab walks through all three kinds.
  function keepTab(card) {
    if (!card || !card.addEventListener) return;
    card.addEventListener('keydown', function (e) {
      var items, at, next;
      if (e.key !== 'Tab') return;
      items = card.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])');
      if (!items.length) return;
      at = Array.prototype.indexOf.call(items, document.activeElement);
      if (e.shiftKey) next = at <= 0 ? items.length - 1 : at - 1;
      else next = at < 0 || at === items.length - 1 ? 0 : at + 1;
      try { items[next].focus(); } catch (err) { return; }
      e.preventDefault(); e.stopPropagation();
    });
  }
  function openCard(html) {
    var G = JA.game, root, box;
    if (!G || typeof G.openInfo !== 'function') return null;
    root = G.openInfo('<div class="keepsake">' + html + '</div>');
    if (!root || !root.querySelector) root = document.getElementById('info-root') || document;
    box = root.querySelector('.keepsake');
    if (box) {
      keepTab(box.parentNode);
      // on a short screen the card scrolls: start at its top, where the title is, not at the close button
      try { box.parentNode.scrollTop = 0; } catch (e) { /* ignore */ }
    }
    return box;
  }
  function saveRow() {
    return '<div class="keepsake-actions"><button type="button" class="btn primary keepsake-save">⬇ Save picture</button><span class="keepsake-status" role="status" aria-live="polite"></span></div>';
  }
  function wireSave(box, getCanvas, filename) {
    var btn = box.querySelector('.keepsake-save'), note = box.querySelector('.keepsake-status');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var c = null;
      try { if (JA.audio && JA.audio.play) JA.audio.play('tap'); } catch (e) { /* no sound is fine */ }
      try { c = getCanvas(); } catch (e2) { c = null; }
      download(c, filename, function (ok) {
        if (note) note.textContent = ok ? 'Done! Look in your downloads.' : 'Sorry, this browser could not save the picture.';
      });
    });
  }

  function showCertificate(info) {
    var rank = info.rank || {}, timer = 0, box, field, canvas;
    function current() {
      var d = {}, k;
      for (k in info) if (Object.prototype.hasOwnProperty.call(info, k)) d[k] = info[k];
      d.name = field ? tidy(field.value, 20) : tidy(info.name, 20);
      return d;
    }
    function draw() { paintCertificate(canvas, current()); }
    box = openCard('<h2>🎓 Your mission certificate</h2>' +
      '<p class="sub">Print it or keep it. Nothing leaves this device.</p>' +
      '<label class="keepsake-name"><span>Your first name (optional)</span>' +
      '<input type="text" maxlength="20" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done" value="' + esc(tidy(info.name, 20) || keptName) + '"></label>' +
      '<div class="keepsake-preview"><canvas width="' + CW + '" height="' + CH + '" role="img" aria-label="' + esc('Preview of your mission certificate' + (rank.name ? ': ' + tidy(rank.name, 40) : '')) + '"></canvas></div>' +
      saveRow());
    if (!box) return;
    field = box.querySelector('input'); canvas = box.querySelector('canvas');
    if (field) field.addEventListener('input', function () {
      keptName = tidy(field.value, 20);
      clearTimeout(timer); timer = setTimeout(draw, 150);
    });
    wireSave(box, function () { clearTimeout(timer); draw(); return canvas; }, 'astro-outpost-certificate.png');
    whenFont(draw);
  }
  function openCertificate(info) {
    try { showCertificate(info || {}); } catch (e) { /* a keepsake must never break the game */ }
  }

  // Words for a postcard when the caller gave none: taken from the mission being played.
  function guessWords() {
    var out = { caption: 'Greetings from space!', sub: 'Astro Outpost' }, s;
    try {
      s = JA.game && JA.game.s;
      if (s && s.site) {
        out.caption = 'Greetings from ' + s.site.name + '!';
        out.sub = s.site.dayWord + ' ' + s.sol + ' · ' + s.site.place + ' · Astro Outpost';
      }
    } catch (e) { /* keep the plain words */ }
    return out;
  }
  // canvas: a postcard made by postcard(), or any picture (then it is framed first, with caption and sub if given)
  function showPostcard(canvas, caption, sub) {
    var card = canvas, words, box, holder;
    if (!canvas || canvas.keepsake !== 'postcard') {
      words = guessWords();
      card = postcard(canvas, caption || words.caption, sub || words.sub);
    }
    if (!card) return;
    box = openCard('<h2>📸 Your postcard</h2>' +
      '<p class="sub">Print it or keep it. Nothing leaves this device.</p>' +
      '<div class="keepsake-preview"></div>' + saveRow());
    if (!box) return;
    holder = box.querySelector('.keepsake-preview');
    try { card.setAttribute('role', 'img'); card.setAttribute('aria-label', 'Preview of your postcard'); } catch (e) { /* ignore */ }
    if (holder) holder.appendChild(card);
    wireSave(box, function () { return card; }, 'astro-outpost-postcard.png');
  }
  function openPostcard(canvas, caption, sub) {
    try { showPostcard(canvas, caption, sub); } catch (e) { /* a keepsake must never break the game */ }
  }

  JA.keepsake = { certificate: certificate, postcard: postcard, save: save, openCertificate: openCertificate, openPostcard: openPostcard };
})(window.JA);
