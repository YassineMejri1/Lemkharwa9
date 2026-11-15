/* Astro Outpost — Mission Control: the operational heart of the habitat.
   This file owns everything the dome's workstations show and do:
     - the Earth–Mars orbit instrument, drawn from the SAME model that gives the radio delay
       (JA.weather.planets, in spaceweather.js), so the picture and the number always agree
     - a radio queue that respects the light-time delay in BOTH directions: a message to Earth
       arrives after one trip, the answer after another; nothing from Earth is ever instant
     - the mission log (storms, breakdowns, calls, milestones) that the screens and cards show
     - the four station cards (Mission Control, life support, power, science) built from live
       simulation state, never from stored numbers
     - the cutaway overlay that js/game.js shows while the camera moves to the workstation
   The screens in the 3D room (js/interior.js) call screen() to draw themselves.
   Without this file the habitat still works; the console just shows less. */
(function (JA) {
  'use strict';
  var M = JA.mission = {};
  var R = JA.RULES;
  var FONT = "'Fredoka', 'Trebuchet MS', sans-serif", MONO = "Consolas, Menlo, 'SFMono-Regular', 'Roboto Mono', monospace";
  var INK = '#eaf0ff', MUTED = '#8c99c4', AIR = '#4fd8ff', FOOD = '#7be36a', DOSE = '#ff6fb1', POWER = '#ffd23f', OK = '#4dff9a', BAD = '#ff5468', AMBER = '#ffb347';
  var EARTH = '#5db2ff', MARS = '#ff7a4a', SUN = '#ffe08a';
  var paths = null;      // the two orbit paths, computed once from the shared model

  function esc(v) { return JA.ui && JA.ui.esc ? JA.ui.esc(v) : String(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pct(v) { return Math.round(clamp(v, 0, 100)); }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function dot(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function mmss(min) { var s = Math.round(min * 60), m = Math.floor(s / 60); return m + 'm ' + ('0' + (s % 60)).slice(-2) + 's'; }
  function todayDate(s) { var w = s.weather[s.sol - 1]; return w && w.date ? w.date : new Date().toISOString().slice(0, 10); }
  function dw(s) { return s.site.dayWord; }
  function box(s) { return s.comms || (s.comms = { log: [], events: [], seq: 0, flash: null, outlookSeen: false }); }

  // ---------- the model behind every screen ----------
  // One call gathers what the link needs: planet positions, real light-time and the game's
  // compressed wait (sim.commInfo keeps those consistent with the repair radio calls).
  M.model = function (s) {
    var sim = JA.sim, info = sim.commInfo(s), moon = s.site.id === 'moon';
    var p = JA.weather.planets(todayDate(s));
    var oneWaySec = moon ? 1.5 : info.wait / 2;                      // game seconds for one trip
    var inflight = box(s).log.filter(function (m) { return m.state === 'transit'; });
    var cur = inflight.length ? inflight[inflight.length - 1] : null, prog = 0;
    if (cur) prog = clamp((s.t - cur.t0) / Math.max(0.1, cur.t1 - cur.t0), 0, 1);
    var align = JA.weather.alignment(p);
    return { moon: moon, p: p, minutes: moon ? 1.28 / 60 : p.minutes, oneWaySec: oneWaySec, dish: !!s.m.comms.on, dishBroken: !!s.m.comms.broken,
      cur: cur, prog: prog, pending: inflight.length, align: align, info: info };
  };

  // ---------- the orbit instrument ----------
  function orbitPaths() {
    if (!paths) paths = { earth: JA.weather.orbitPath('earth', 140), mars: JA.weather.orbitPath('mars', 180) };
    return paths;
  }
  // Draws the inner solar system seen from above, centred on (cx, cy) with Mars' orbit fitting in R.
  // mdl: from M.model; t: seconds, for the slow dash crawl and the signal pulse.
  M.drawOrbit = function (ctx, cx, cy, Rr, mdl, t, o) {
    o = o || {};
    var k = Rr / 1.72, P = orbitPaths(), p = mdl.p, ex = cx + p.earth.x * k, ey = cy - p.earth.y * k, mx = cx + p.mars.x * k, my = cy - p.mars.y * k;
    function path(pts, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      pts.forEach(function (q, i) { var x = cx + q.x * k, y = cy - q.y * k; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    // faint range rings every 0.5 AU, so distances can be read off the picture
    ctx.strokeStyle = 'rgba(140, 160, 210, 0.1)'; ctx.lineWidth = 1;
    [0.5, 1, 1.5].forEach(function (au) { ctx.beginPath(); ctx.arc(cx, cy, au * k, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(cx - Rr, cy); ctx.lineTo(cx + Rr, cy); ctx.moveTo(cx, cy - Rr); ctx.lineTo(cx, cy + Rr); ctx.stroke();
    path(P.earth, 'rgba(93, 178, 255, 0.45)', 1.2); path(P.mars, 'rgba(255, 122, 74, 0.45)', 1.2);
    // the Sun
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rr * 0.09);
    g.addColorStop(0, '#fff8d6'); g.addColorStop(0.5, SUN); g.addColorStop(1, 'rgba(255, 224, 138, 0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Rr * 0.09, 0, Math.PI * 2); ctx.fill();
    // the link line, with a pulse travelling along it while a message is in flight
    var live = mdl.dish && !mdl.dishBroken;
    ctx.save(); ctx.setLineDash([4, 5]); ctx.lineDashOffset = -t * 6;
    ctx.strokeStyle = live ? 'rgba(234, 240, 255, 0.5)' : 'rgba(234, 240, 255, 0.14)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(mx, my); ctx.stroke(); ctx.restore();
    if (mdl.cur && !mdl.moon) {
      var up = mdl.cur.dir === 'up', ax = up ? mx : ex, ay = up ? my : ey, bx = up ? ex : mx, by = up ? ey : my;
      for (var i = 0; i < 4; i++) {
        var q = clamp(mdl.prog - i * 0.035, 0, 1), px = ax + (bx - ax) * q, py = ay + (by - ay) * q;
        dot(ctx, px, py, (i ? 2.2 : 3.6) * (o.scale || 1), i ? 'rgba(255, 255, 255, ' + (0.45 - i * 0.1) + ')' : '#ffffff');
      }
    }
    // planets (Mars drawn a touch bigger than true scale so it reads at a distance)
    var pr = Rr * 0.055 * (o.scale || 1);
    ctx.fillStyle = 'rgba(93, 178, 255, 0.22)'; ctx.beginPath(); ctx.arc(ex, ey, pr * 1.9, 0, Math.PI * 2); ctx.fill();
    dot(ctx, ex, ey, pr, EARTH); dot(ctx, mx, my, pr * 0.8, MARS);
    if (mdl.moon) { dot(ctx, ex + pr * 1.6, ey - pr * 1.1, pr * 0.3, '#d8dbe6'); }
    ctx.font = '600 ' + Math.round(Rr * 0.11) + 'px ' + FONT; ctx.textBaseline = 'middle';
    ctx.fillStyle = EARTH; ctx.textAlign = ex < cx ? 'right' : 'left'; ctx.fillText('Earth', ex + (ex < cx ? -pr * 1.6 : pr * 1.6), ey);
    ctx.fillStyle = MARS; ctx.textAlign = mx < cx ? 'right' : 'left'; ctx.fillText('Mars', mx + (mx < cx ? -pr * 1.5 : pr * 1.5), my);
    // "you are here"
    var hx = mdl.moon ? ex : mx, hy = mdl.moon ? ey : my;
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 + Math.sin(t * 3) * 0.25) + ')'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(hx, hy, pr * 2.4, 0, Math.PI * 2); ctx.stroke();
  };

  // ---------- the radio queue ----------
  // kind: 'status' | 'help' | 'repair' | 'storm'. Every message to Earth takes one light-trip; the
  // answer takes another. The real minutes are shown; the clock runs in the game's compressed seconds.
  function arrival(s, t1) {
    if (t1 <= s.dayLength - 0.5) return { sol: s.sol, t: t1 };
    return { sol: s.sol + 1, t: 6 };                                  // still travelling when the crew sleeps: it is there in the morning
  }
  M.canSend = function (s) {
    if (!s.m.comms.on) return { ok: false, msg: s.m.comms.broken ? 'The Radio Dish is broken. No link to Earth until it is fixed.' : 'The Radio Dish has no power. Plug a power cell into its socket to open the link.' };
    return { ok: true };
  };
  M.send = function (s, kind, text, opts) {
    opts = opts || {};
    var can = M.canSend(s); if (!can.ok) return can;
    var b = box(s), mdl = M.model(s), ow = mdl.oneWaySec, a1 = arrival(s, s.t + ow);
    var up = { id: ++b.seq, kind: kind, dir: 'up', from: 'OUTPOST-01', text: text, sol: s.sol, t0: s.t, sol1: a1.sol, t1: a1.t, state: 'transit', minutes: mdl.minutes };
    b.log.push(up);
    // the answer starts back the moment the message lands on Earth
    var t2 = opts.replyAt != null ? opts.replyAt : a1.t + ow, a2 = a1.sol === s.sol ? arrival(s, t2) : { sol: a1.sol, t: a1.t + ow };
    var down = { id: ++b.seq, kind: kind, dir: 'down', from: 'HOUSTON', text: null, sol: a1.sol, t0: a1.t, sol1: a2.sol, t1: a2.t, state: 'queued', silent: !!opts.silent, minutes: mdl.minutes, re: up.id };
    b.log.push(down);
    M.logEvent(s, '📡', 'Sent to Earth: ' + text, 0);
    if (b.log.length > 24) b.log.splice(0, b.log.length - 24);
    return { ok: true, msg: up, reply: down, oneWay: mdl.minutes, oneWaySec: ow };
  };
  // Houston's answer is written when it arrives, from the state of the outpost at that moment.
  function staleNow(s) { return (JA.sim.stale ? JA.sim.stale(s) : s.stale) > 1; }
  function outlookOf(s) { return s.forecast && JA.sim.outlook ? JA.sim.outlook(s) : null; }
  function replyText(s, kind) {
    var sim = JA.sim, low = [];
    if (s.leak > 0) low.push('seal that leak first');
    if (staleNow(s)) low.push('bake the CO₂ filter clean at the Air Scrubber');
    if (s.water != null && s.water < R.waterWarn) low.push('water is low: an ice chunk in the tank');
    if (s.air < 30) low.push('air is your priority: cell plus ice in the Air Maker');
    if (!(s.sol >= s.totalSols) && s.food < sim.dinner(s)) low.push('tonight\'s dinner is not covered: harvest or plant now');
    if (s.dose >= 60) low.push('badge is high: more soil bags on the dome before the next storm');
    var ph = sim.stormPhase(s);
    if (kind === 'storm') return 'Houston copies. Stay inside until the all-clear' + (ph === 'over' ? ' — and we see it has passed, good work' : '') + '. Your shielding is at ' + Math.round(sim.shield(s) * 100) + '%; every bag on the dome counts for the next one.';
    if (kind === 'help') return low.length ? 'Houston copies your request. Our recommendation, in order: ' + low.join('; ') + '. You are the one on site, Commander: your call.' : 'Houston copies. From here every system reads nominal. Keep the dish powered and we will keep watching the Sun for you.';
    return 'Houston copies your status: air ' + pct(s.air) + '%, food ' + pct(s.food) + '%, badge ' + pct(s.dose) + '%' + (low.length ? '. One note: ' + low[0] + '.' : '. Looking good from here.');
  }
  // Called every frame by the game (only while a mission runs). ctx: { s, inside, say, onReply }
  M.update = function (dt, ctx) {
    var s = ctx && ctx.s; if (!s) return;
    var b = box(s), now = { sol: s.sol, t: s.t };
    function due(m) { return m.sol1 < now.sol || (m.sol1 === now.sol && now.t >= m.t1); }
    b.log.forEach(function (m) {
      if (m.state === 'queued' && (m.sol < now.sol || (m.sol === now.sol && now.t >= m.t0))) m.state = 'transit';
      if (m.state === 'transit' && due(m)) {
        m.state = 'received';
        if (m.dir === 'up') M.logEvent(s, '🌍', 'Earth received your message (' + mmss(m.minutes) + ' later).', 0);
        else {
          m.text = m.text || replyText(s, m.kind);
          M.logEvent(s, '📻', 'Houston: ' + m.text, 0);
          if (!m.silent && ctx.onReply) ctx.onReply(m);
        }
      }
    });
    if (b.flash && (b.flash.sol < s.sol || s.t > b.flash.until)) b.flash = null;
  };

  // ---------- the mission log ----------
  M.logEvent = function (s, icon, text, lvl) {
    var b = box(s);
    b.events.push({ sol: s.sol, t: s.t, icon: icon, text: text, lvl: lvl || 0 });
    if (b.events.length > 40) b.events.shift();
  };
  M.flash = function (s, icon, text, secs) { box(s).flash = { icon: icon, text: text, sol: s.sol, until: s.t + (secs || 25) }; };
  // Events from the rules (game.js handleEvents). Returns a cutaway request for the big ones, or null.
  M.event = function (e, s) {
    var sim = JA.sim, MACH = JA.MACHINES;
    if (e.type === 'storm') {
      if (e.phase === 'warning') {
        var msg = s.m.comms.on ? 'Solar storm warning received. Crew moving to shelter.' : 'Increased radiation detected on suit sensor. Requesting guidance.';
        M.logEvent(s, '🌩️', s.m.comms.on ? 'Earth: solar flare detected. Radiation storm inbound.' : 'Suit sensor: radiation rising. No warning from Earth (dish off).', 2);
        var r = M.send(s, 'storm', msg);
        return { kind: 'alert', title: 'RADIATION STORM INBOUND', text: msg, sent: r.ok, dur: 7.5 };
      }
      if (e.phase === 'active') { M.logEvent(s, '☢️', 'Radiation storm hitting the outpost.', 2); return null; }
      M.logEvent(s, '✅', 'Storm passed. All clear.', 0); M.flash(s, '✅', 'ALL CLEAR · storm has passed', 20); return null;
    }
    if (e.type === 'break') { M.logEvent(s, '⚠️', MACH[e.machine].name + ' failure: ' + JA.REPAIRS[e.machine].title, 1); return { kind: 'fault', title: 'SYSTEM FAULT · ' + MACH[e.machine].name.toUpperCase(), text: JA.REPAIRS[e.machine].title + ' Repair on site, or request the procedure from Earth.', dur: 6 }; }
    if (e.type === 'advice') { M.logEvent(s, '📻', 'Houston: repair procedure for the ' + MACH[e.machine].name + ' received.', 0); return { kind: 'reply', title: 'EARTH REPLY RECEIVED', text: 'HOUSTON: Procedure for the ' + MACH[e.machine].name + ' attached. Go back to the machine to finish the repair.', dur: 6 }; }
    if (e.type === 'daygoal') { M.logEvent(s, '🎯', 'Daily challenge complete: ' + s.day.goal.text, 0); M.flash(s, '🎯', 'MILESTONE · ' + s.day.goal.text, 25); return null; }
    if (e.type === 'discovery') { M.logEvent(s, '🔬', 'Lab result: ' + e.find.title, 0); return null; }
    if (e.type === 'crisis') { M.logEvent(s, '🚨', 'Crisis: ' + (JA.crisis.view(s) || {}).title, 2); return null; }
    if (e.type === 'consequence') { M.logEvent(s, e.tone === 'bad' ? '🟥' : e.tone === 'good' ? '🟩' : '🟨', e.text, e.tone === 'bad' ? 1 : 0); return null; }
    if (e.type === 'fail') { M.logEvent(s, '🛑', 'ABORT: ' + JA.FAIL[e.reason].title, 2); return null; }
    if (e.type === 'devil' && e.phase === 'clean' && e.gain > 0.01) { M.logEvent(s, '🌪️', 'Dust devil crossed the solar field: +' + Math.round(e.gain * 100) + '% panel power.', 0); return null; }
    return null;
  };
  // The repair call from the toolbox (sim.askEarth) goes through the same radio so the screens show it.
  M.repairSent = function (s) {
    var g = s.glitch; if (!g) return;
    M.send(s, 'repair', 'Requesting repair procedure for the ' + JA.MACHINES[g.machine].name + '.', { silent: true, replyAt: g.replyAt });
  };
  M.milestone = function (s, icon, text) { M.logEvent(s, icon, text, 0); M.flash(s, icon, text, 25); };

  // ---------- what the room reacts to ----------
  // lvl 0 nominal · 1 caution (a fault, stale air, a thin margin) · 2 alarm (storm, leak, near-abort)
  M.alert = function (s) {
    var sim = JA.sim, ph = sim.stormPhase(s), m = s.m;
    if (ph === 'warning' || ph === 'active') return { lvl: 2, text: ph === 'active' ? 'RADIATION STORM · STAY INSIDE' : 'STORM INBOUND · SHELTER' };
    if (s.leak > 0) return { lvl: 2, text: 'HULL LEAK · AIR ESCAPING' };
    if (s.air < 15 || s.dose >= 85) return { lvl: 2, text: s.air < 15 ? 'AIR CRITICAL' : 'RADIATION LIMIT NEAR' };
    var broken = ['air', 'food', 'lab'].filter(function (k) { return m[k].broken; }).concat(s.rack.broken ? ['rack'] : []);
    if (broken.length) return { lvl: 1, text: 'FAULT · ' + JA.MACHINES[broken[0]].name.toUpperCase() };
    if (staleNow(s)) return { lvl: 1, text: 'CO₂ HIGH · FILTER FULL' };
    if (s.water != null && s.water <= 0) return { lvl: 1, text: 'WATER TANK EMPTY' };
    if (s.air < 30) return { lvl: 1, text: 'AIR LOW' };
    if (s.sol < s.totalSols && s.food < sim.dinner(s)) return { lvl: 1, text: 'FOOD SHORT FOR DINNER' };
    return { lvl: 0, text: 'ALL SYSTEMS NOMINAL' };
  };
  M.power = function (s) {
    var m = s.m, loads = (m.air.power > 0 ? 1 : 0) + (m.food.lamp > 0 ? 1 : 0) + (m.lab.power > 0 ? 1 : 0) + (m.comms.on ? 1 : 0);
    var reserve = s.rack.cells + s.rack.charge;
    return { reserve: reserve, cells: s.rack.cells, charge: s.rack.charge, loads: loads, low: reserve < 0.35 && loads === 0, eff: s.rack.eff, sun: s.cellsToday };
  };

  // ---------- the screens in the 3D room ----------
  function header(ctx, w, title, right, lvl) {
    ctx.fillStyle = lvl === 2 ? 'rgba(255, 84, 104, 0.9)' : lvl === 1 ? 'rgba(255, 179, 71, 0.85)' : 'rgba(79, 216, 255, 0.18)';
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = lvl ? '#140a10' : AIR; ctx.font = '700 22px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(title, 18, 22);
    if (right) { ctx.fillStyle = lvl ? '#140a10' : MUTED; ctx.font = '600 18px ' + MONO; ctx.textAlign = 'right'; ctx.fillText(right, w - 18, 22); }
  }
  function bar(ctx, x, y, w, v, color, label, value) {
    ctx.textBaseline = 'middle'; ctx.font = '600 19px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.fillText(label, x, y);
    ctx.textAlign = 'right'; ctx.font = '700 19px ' + MONO; ctx.fillText(value, x + w, y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; rr(ctx, x, y + 14, w, 10, 5); ctx.fill();
    ctx.fillStyle = color; rr(ctx, x, y + 14, Math.max(10, w * clamp(v, 0, 1)), 10, 5); ctx.fill();
  }
  function led(ctx, x, y, on, color, label) {
    dot(ctx, x, y, 6, on ? color : 'rgba(255,255,255,0.12)');
    ctx.fillStyle = INK; ctx.font = '600 17px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 14, y);
  }
  function wrapText(ctx, text, x, y, w, lh, max) {
    var words = String(text).split(' '), line = '', n = 0;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > w && line) { ctx.fillText(line, x, y + n * lh); line = words[i]; n++; if (max && n >= max) { return n; } }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, y + n * lh); n++; }
    return n;
  }
  function bg(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0a1222'); g.addColorStop(1, '#060b17');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.025)'; for (var y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);     // a faint scan texture
  }

  // the panoramic Mission Control display: orbit link · comms · log
  function drawMain(ctx, w, h, s, t) {
    var mdl = M.model(s), al = M.alert(s), b = box(s);
    bg(ctx, w, h);
    header(ctx, w, 'MISSION CONTROL · OUTPOST-01 · ' + (mdl.moon ? 'MOON' : 'MARS'), dw(s) + ' ' + s.sol + ' · ' + todayDate(s), al.lvl);
    // left: the instrument
    var ox = w * 0.2, oy = 44 + (h - 44) * 0.47, orad = Math.min(w * 0.17, (h - 44) * 0.4);
    ctx.fillStyle = MUTED; ctx.font = '600 15px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mdl.moon ? 'EARTH–MOON LINK · 384,400 KM' : 'EARTH–MARS LINK · ' + Math.round(mdl.p.km / 1e6) + ' MILLION KM', ox, 62);
    M.drawOrbit(ctx, ox, oy + 8, orad, mdl, t, { scale: 1 });
    ctx.fillStyle = MUTED; ctx.font = '500 13px ' + MONO;
    ctx.fillText('mean orbits · about ±3%', ox, h - 14);
    // middle: the link
    var lx = w * 0.42, lw = w * 0.3, up = mdl.cur && mdl.cur.dir === 'up';
    ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = '600 15px ' + MONO;
    ctx.fillText(mdl.moon ? 'MOON → EARTH' : up ? 'MARS → EARTH' : mdl.cur ? 'EARTH → MARS' : 'ONE-WAY LIGHT TIME', lx, 66);
    ctx.fillStyle = INK; ctx.font = '700 48px ' + MONO;
    ctx.fillText(mdl.moon ? '1.3 s' : mmss(mdl.minutes), lx, 106);
    var status, sc;
    if (!mdl.dish) { status = mdl.dishBroken ? 'DISH FAULT · NO LINK' : 'DISH UNPOWERED · NO LINK'; sc = BAD; }
    else if (mdl.cur) { status = 'SIGNAL IN TRANSIT · ' + Math.round(mdl.prog * 100) + '%'; sc = POWER; }
    else { status = 'LINK OPEN · LISTENING'; sc = OK; }
    dot(ctx, lx + 7, 148, 6, sc); ctx.fillStyle = sc; ctx.font = '700 17px ' + MONO; ctx.fillText(status, lx + 20, 148);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, lx, 164, lw, 8, 4); ctx.fill();
    if (mdl.cur) { ctx.fillStyle = POWER; rr(ctx, lx, 164, Math.max(8, lw * mdl.prog), 8, 4); ctx.fill(); }
    var last = null; for (var i = b.log.length - 1; i >= 0 && !last; i--) if (b.log[i].state !== 'queued') last = b.log[i];
    ctx.fillStyle = MUTED; ctx.font = '600 14px ' + MONO; ctx.fillText('LAST TRANSMISSION', lx, 196);
    ctx.fillStyle = INK; ctx.font = '500 16px ' + FONT;
    wrapText(ctx, last ? (last.dir === 'up' ? 'OUTPOST-01: ' : 'HOUSTON: ') + (last.text || '…') : 'No transmissions yet this mission.', lx, 218, lw, 20, 3);
    ctx.fillStyle = MUTED; ctx.font = '600 14px ' + MONO; ctx.fillText('PENDING ' + mdl.pending + '  ·  ' + (mdl.moon ? 'NEAR-INSTANT LINK' :'MARS–EARTH: ' + mdl.align.toUpperCase()), lx, h - 22);
    // right: the log
    var rx = w * 0.75, rw = w * 0.23;
    ctx.fillStyle = MUTED; ctx.font = '600 15px ' + MONO; ctx.fillText('MISSION LOG', rx, 66);
    var ev = b.events.slice(-6).reverse(), y = 92;
    if (!ev.length) { ctx.fillStyle = MUTED; ctx.font = '500 15px ' + FONT; ctx.fillText('Quiet so far.', rx, y); }
    ev.forEach(function (e) {
      ctx.fillStyle = e.lvl === 2 ? BAD : e.lvl === 1 ? AMBER : INK; ctx.font = '500 15px ' + FONT;
      var n = wrapText(ctx, e.icon + ' ' + e.text, rx, y, rw, 18, 2); y += n * 18 + 6;
    });
    // a milestone or an alert banner across the bottom
    if (b.flash || al.lvl) {
      var fl = b.flash && !al.lvl, text = fl ? b.flash.icon + ' ' + b.flash.text : al.text, col = fl ? OK : al.lvl === 2 ? BAD : AMBER;
      var pulse = al.lvl === 2 ? 0.6 + Math.sin(t * 6) * 0.3 : 0.85;
      ctx.fillStyle = hexA(col, 0.18 * pulse); ctx.fillRect(w * 0.4, h - 48, w * 0.6, 48);
      ctx.fillStyle = col; ctx.font = '700 20px ' + MONO; ctx.textAlign = 'right'; ctx.fillText(text, w - 18, h - 24);
    }
  }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

  function drawLife(ctx, w, h, s) {
    var sim = JA.sim, m = s.m, al = M.alert(s), beds = m.food.beds, growing = beds.filter(function (b) { return b.state === 'growing' || b.state === 'ripe'; }).length;
    bg(ctx, w, h); header(ctx, w, 'LIFE SUPPORT', al.lvl && /AIR|LEAK|CO/.test(al.text) ? al.text : 'ECLSS', al.lvl && /AIR|LEAK|CO/.test(al.text) ? al.lvl : 0);
    var x = 22, bw = w - 44, st = sim.stale ? sim.stale(s) : s.stale, need = sim.airDrain(s) * st + s.leak, stale = st > 1;
    bar(ctx, x, 78, bw, s.air / 100, AIR, 'AIR', pct(s.air) + '%');
    ctx.fillStyle = MUTED; ctx.font = '500 14px ' + MONO; ctx.textAlign = 'left'; ctx.fillText('crew draws ' + Math.round(need) + ' per shift' + (s.leak > 0 ? ' · LEAK' : ''), x, 114);
    var filt = s.filter == null ? null : clamp(s.filter, 0, 100);
    led(ctx, x + 6, 146, true, stale ? BAD : filt != null && filt < R.filterWarn ? AMBER : OK, 'CO₂ filter · ' + (stale ? 'FULL — air going stale' : filt != null ? Math.round(filt) + '% clean' : 'nominal'));
    var water = s.water != null ? clamp(s.water / 100, 0, 1) : clamp(m.food.water / R.waterSols, 0, 1);
    bar(ctx, x, 184, bw, water, '#6fb9ff', 'WATER TANK (crew + plants)', Math.round(water * 100) + '%');
    led(ctx, x + 6, 234, growing > 0, FOOD, 'Greenhouse · ' + growing + ' of ' + beds.length + ' beds growing' + (m.food.lamp <= 0 && growing ? ' · lamps off' : water <= 0 && growing ? ' · no water' : ''));
    led(ctx, x + 6, 262, true, m.air.broken ? BAD : m.air.power > 0 ? OK : AMBER, 'Air Maker · ' + (m.air.broken ? 'FAULT' : m.air.power > 0 ? 'running · ' + m.air.queue + ' ice queued' : 'unpowered'));
    ctx.fillStyle = MUTED; ctx.font = '500 13px ' + MONO; ctx.fillText('FOOD STORE ' + pct(s.food) + '% · dinner −' + sim.dinner(s), x, h - 16);
  }
  function drawPower(ctx, w, h, s) {
    var m = s.m, pw = M.power(s), al = pw.low ? { lvl: 1, text: 'REDUCED POWER' } : { lvl: 0, text: '' };
    bg(ctx, w, h); header(ctx, w, 'POWER', pw.low ? 'REDUCED POWER' : 'NOMINAL', al.lvl);
    var x = 22, bw = w - 44;
    bar(ctx, x, 78, bw, clamp(pw.sun / 8, 0, 1), POWER, 'SUNLIGHT TODAY', '≈' + Math.round(pw.sun) + ' cells');
    bar(ctx, x, 124, bw, pw.charge, POWER, 'RACK · charging cell', Math.round(pw.charge * 100) + '%');
    ctx.fillStyle = MUTED; ctx.font = '500 14px ' + MONO; ctx.textAlign = 'left'; ctx.fillText('CELLS READY', x, 162);
    for (var i = 0; i < R.rackMax; i++) { ctx.fillStyle = i < pw.cells ? POWER : 'rgba(255,255,255,0.1)'; rr(ctx, x + 110 + i * 34, 154, 26, 16, 4); ctx.fill(); }
    ctx.fillStyle = MUTED; ctx.fillText('PANELS', x, 188);
    pw.eff.forEach(function (e, k) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, x + 110 + k * 90, 182, 80, 12, 6); ctx.fill(); ctx.fillStyle = e > 0.85 ? OK : e > 0.65 ? AMBER : BAD; rr(ctx, x + 110 + k * 90, 182, Math.max(8, 80 * e), 12, 6); ctx.fill(); });
    var loads = [['Air Maker', m.air.power > 0, m.air.broken], ['Greenhouse lamps', m.food.lamp > 0, m.food.broken], ['Science Lab', m.lab.power > 0, m.lab.broken], ['Soil Bagger', m.bag.pending > 0, m.bag.broken], ['Radio Dish', m.comms.on, m.comms.broken]];
    loads.forEach(function (L, k) { var cx = x + (k % 2) * (bw / 2), cy = 222 + Math.floor(k / 2) * 26; led(ctx, cx + 6, cy, L[1] || L[2], L[2] ? BAD : OK, L[0] + (L[2] ? ' · FAULT' : L[1] ? '' : ' · off')); });
    ctx.fillStyle = MUTED; ctx.font = '500 13px ' + MONO; ctx.fillText('ROVER BATTERY ' + Math.round(m.rover.charge / roverCap(s) * 100) + '%', x, h - 16);
  }
  function roverCap(s) { return JA.sim.roverCap ? JA.sim.roverCap(s) : R.roverMax; }
  function drawEnv(ctx, w, h, s, t) {
    var sim = JA.sim, ph = sim.stormPhase(s), env = sim.env(s), look = s.site.env[env.kind], o = outlookOf(s), wx = sim.weather(s);
    var lvl = ph === 'active' || ph === 'warning' ? 2 : s.dose >= 75 ? 1 : 0;
    // without a probabilistic forecast module, the forecast is the plain one the rules give (storm expected or quiet)
    var fcText = o ? 'Storm odds today ' + o.chance + '% · ' + o.words : s.forecast ? (wx && wx.level ? ['', 'Small', 'Medium', 'BIG'][wx.level] + ' solar storm expected today' : 'Quiet Sun today') : 'No forecast (dish was off)';
    bg(ctx, w, h); header(ctx, w, 'SCIENCE · ENVIRONMENT', ph === 'active' ? 'STORM NOW' : ph === 'warning' ? 'STORM INBOUND' : look.label.toUpperCase(), lvl);
    var x = 22, bw = w - 44;
    bar(ctx, x, 78, bw, s.dose / 100, DOSE, 'RADIATION BADGE', pct(s.dose) + '%');
    bar(ctx, x, 124, bw, sim.shield(s), '#c9a6ff', 'DOME SHIELDING', Math.round(sim.shield(s) * 100) + '% · ' + s.bags + '/' + R.shieldSlots + ' bags');
    ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = '600 14px ' + MONO; ctx.fillText('SPACE WEATHER', x, 168);
    ctx.fillStyle = ph === 'active' || ph === 'warning' ? BAD : INK; ctx.font = '700 20px ' + FONT;
    ctx.fillText(ph === 'active' ? 'Radiation storm in progress' : ph === 'warning' ? 'Storm arriving · get inside' : ph === 'over' ? 'Storm passed · all clear' : fcText, x, 190);
    if (o && ph === 'none') { ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, x, 206, bw, 8, 4); ctx.fill(); ctx.fillStyle = o.chance >= 60 ? BAD : o.chance >= 40 ? AMBER : OK; rr(ctx, x, 206, Math.max(8, bw * o.chance / 100), 8, 4); ctx.fill(); }
    ctx.fillStyle = MUTED; ctx.font = '600 14px ' + MONO; ctx.fillText('SURFACE', x, 236);
    ctx.fillStyle = INK; ctx.font = '600 18px ' + FONT; ctx.fillText(look.icon + ' ' + look.label + ' · ≈' + Math.round(s.cellsToday) + ' cells of sun', x, 256);
    var inst = JA.INSTRUMENTS[s.site.id].map(function (d) { return (s.inst[d.id] ? '● ' : '○ ') + d.name; }).join('   ');
    ctx.fillStyle = MUTED; ctx.font = '500 13px ' + MONO; ctx.fillText('INSTRUMENTS  ' + inst, x, h - 16);
  }
  M.screen = function (id, ctx, w, h, s, t) {
    if (id === 'main') drawMain(ctx, w, h, s, t);
    else if (id === 'life') drawLife(ctx, w, h, s);
    else if (id === 'power') drawPower(ctx, w, h, s);
    else if (id === 'env') drawEnv(ctx, w, h, s, t);
  };

  // ---------- the station cards ----------
  var orbitRaf = 0;
  function row(icon, title, text, cls) { return '<div class="info-row' + (cls ? ' ' + cls : '') + '"><span class="ic">' + icon + '</span><div><b>' + title + '</b><p>' + text + '</p></div></div>'; }
  function meter(label, v, color, value) { return '<div class="mc-meter"><span>' + label + '</span><div class="mc-bar"><i style="width:' + pct(v * 100) + '%;background:' + color + '"></i></div><b>' + value + '</b></div>'; }
  function logHtml(s, n) {
    var ev = box(s).events.slice(-n).reverse();
    if (!ev.length) return '<p class="sub">Nothing logged yet. Storms, faults, calls to Earth and milestones will appear here.</p>';
    return '<ul class="mc-log">' + ev.map(function (e) { return '<li class="l' + e.lvl + '"><em>' + dw(s).slice(0, 1) + e.sol + ' ' + clockText(e.t) + '</em><span>' + e.icon + ' ' + esc(e.text) + '</span></li>'; }).join('') + '</ul>';
  }
  function clockText(t) { var m = Math.floor(t / 60), sec = Math.floor(t % 60); return m + ':' + ('0' + sec).slice(-2); }
  function commsHtml(s, mdl) {
    var last = null, b = box(s); for (var i = b.log.length - 1; i >= 0 && !last; i--) if (b.log[i].state !== 'queued') last = b.log[i];
    var status = !mdl.dish ? '<span class="mc-bad">NO LINK · ' + (mdl.dishBroken ? 'dish fault' : 'dish unpowered') + '</span>'
      : mdl.cur ? '<span class="mc-warn">SIGNAL IN TRANSIT · ' + (mdl.cur.dir === 'up' ? 'to Earth' : 'from Earth') + ' · ' + Math.round(mdl.prog * 100) + '%</span>' : '<span class="mc-ok">LINK OPEN · listening</span>';
    return '<div class="mc-link"><div><small>' + (mdl.moon ? 'MOON → EARTH' : 'ONE-WAY LIGHT TIME') + '</small><b>' + (mdl.moon ? '1.3 s' : mmss(mdl.minutes)) + '</b><small>' + (mdl.moon ? '384,400 km' : Math.round(mdl.p.km / 1e6) + ' million km · ' + mdl.align) + '</small></div>' +
      '<div><small>STATUS</small>' + status + '<small>pending ' + mdl.pending + ' · last: ' + (last ? esc((last.dir === 'up' ? 'you → Earth: ' : 'Earth → you: ') + (last.text || '…')).slice(0, 90) : 'none') + '</small></div></div>';
  }
  // ctx: { s, onSend(result, kind, text), close }
  M.open = function (id, ctx) {
    var s = ctx.s, U = JA.ui, sim = JA.sim, html, actions = {}, mdl = M.model(s);
    function closeBtn() { return '<div class="modal-actions">' + (id === 'console' && JA.sunwatch ? '<button class="btn ghost" data-act="sun">☀️ Sun Watch</button>' : '') + '<button class="btn primary" data-act="ok">Back to the room</button></div>'; }
    actions.ok = function () { JA.audio.play('tap'); U.closeModal(); };
    if (id === 'console') {
      var can = M.canSend(s);
      html = '<div class="mc-card"><div class="mc-head"><small>📻 Mission Control workstation</small><h2>Earth link</h2></div>' +
        '<canvas class="mc-orbit" width="640" height="360" aria-label="Diagram of the Sun, Earth and Mars with the radio link between Earth and ' + (mdl.moon ? 'the Moon' : 'Mars') + '"></canvas>' +
        commsHtml(s, mdl) +
        '<p class="sub">Radio travels at the speed of light, and light still needs ' + (mdl.moon ? '1.3 seconds to reach the Moon' : mmss(mdl.minutes) + ' to cross ' + Math.round(mdl.p.km / 1e6) + ' million km') + '. Every message waits that long each way. Positions come from the mean orbits of the planets for today\'s real date, about ±3%.</p>' +
        '<h3>Transmit</h3><div class="mc-actions">' +
        '<button class="opt" data-act="status"' + (can.ok ? '' : ' disabled') + '><b>📨 Send status report</b><span>Air, food and radiation readings. Houston answers after a full round trip.</span></button>' +
        '<button class="opt" data-act="help"' + (can.ok ? '' : ' disabled') + '><b>🆘 Request guidance</b><span>' + (s.glitch && s.glitch.state === 'broken' ? 'A machine is broken: Earth will send the repair procedure.' : 'Ask Earth what to fix first. The answer takes two light-trips.') + '</span></button></div>' +
        (can.ok ? '' : '<p class="sub mc-bad">' + esc(can.msg) + '</p>') +
        '<h3>Mission log</h3>' + logHtml(s, 8) + closeBtn() + '</div>';
      actions.sun = function () { JA.audio.play('tap'); U.closeModal(); if (JA.sunwatch) JA.sunwatch.open(s, ctx.weather); };
      actions.status = function () { var r = M.send(s, 'status', 'Status report: air ' + pct(s.air) + '%, food ' + pct(s.food) + '%, radiation badge ' + pct(s.dose) + '%. Crew nominal.'); if (!r.ok) { JA.audio.play('deny'); return; } U.closeModal(); if (ctx.onSend) ctx.onSend(r, 'status'); };
      actions.help = function () {
        var r;
        if (s.glitch && s.glitch.state === 'broken') { var a = sim.askEarth(s); if (!a.ok) { JA.audio.play('deny'); return; } M.repairSent(s); r = { ok: true, msg: box(s).log[box(s).log.length - 2], oneWay: mdl.minutes }; }
        else { r = M.send(s, 'help', 'Requesting guidance: which system should the crew prioritise?'); if (!r.ok) { JA.audio.play('deny'); return; } }
        U.closeModal(); if (ctx.onSend) ctx.onSend(r, 'help');
      };
    } else if (id === 'life') {
      var m = s.m, st = sim.stale ? sim.stale(s) : s.stale, stale = st > 1, need = sim.airDrain(s) * st + s.leak, left = Math.max(0, 1 - s.t / s.dayLength), growing = m.food.beds.filter(function (b) { return b.state === 'growing' || b.state === 'ripe'; }).length;
      var water = s.water != null ? clamp(s.water, 0, 100) : clamp(m.food.water / R.waterSols, 0, 1) * 100, filt = s.filter == null ? null : clamp(s.filter, 0, 100);
      var recycle = s.mods && s.mods.recycle != null ? Math.round(s.mods.recycle * 100) : null;
      html = '<div class="mc-card"><div class="mc-head"><small>🫁 Life-support station</small><h2>Air, water, food</h2></div>' +
        meter('Air', s.air / 100, AIR, pct(s.air) + '%') + (filt != null ? meter('CO₂ filter', filt / 100, stale ? BAD : filt < R.filterWarn ? AMBER : OK, Math.round(filt) + '% clean') : '') +
        meter('Water tank', water / 100, '#6fb9ff', Math.round(water) + '%') + meter('Food store', s.food / 100, FOOD, pct(s.food) + '%') +
        row('💨', 'Crew breathing · ' + Math.round(need * left) + ' air still needed today', 'The crew draws about ' + Math.round(need) + ' air per shift' + (stale ? ', more while the air is stale' : '') + '. The Air Maker turns one ice chunk into ' + R.airPerIce + ' air, but only with a power cell plugged in.', s.air < need * left ? 'alert' : 'good') +
        row('🧪', 'CO₂ filter · ' + (stale ? 'FULL' : filt != null ? Math.round(filt) + '% clean' : 'nominal'), stale ? 'The filter is saturated, carbon dioxide is building up and the tanks must push out extra air. A power cell at the Air Scrubber bakes it clean.' : 'Every breath out is CO₂. On the Space Station it is soaked up by beds of zeolite that are baked clean and used again; a failed scrubber is one of the fastest ways a cabin becomes dangerous.', stale ? 'alert' : '') +
        row('💧', 'Water tank · ' + Math.round(water) + '%' + (recycle != null ? ' · recycler returns ' + recycle + '%' : ''), 'One tank serves the crew and the plants, and only ice adds new water. Plants need light AND water, so every ice chunk is a choice between the Air Maker and this tank. On the Space Station about 98% of water is recycled, even sweat and breath.', water <= 0 ? 'alert' : '') +
        row('🥬', 'Greenhouse · ' + growing + ' of ' + m.food.beds.length + ' beds growing', 'Dinner tonight costs ' + sim.dinner(s) + ' food. A bed needs about a full ' + dw(s).toLowerCase() + ' to ripen, so what you plant now is tomorrow\'s meal, not tonight\'s.', s.sol < s.totalSols && s.food < sim.dinner(s) ? 'alert' : '') +
        closeBtn() + '</div>';
    } else if (id === 'power') {
      var pw = M.power(s), mm = s.m;
      html = '<div class="mc-card"><div class="mc-head"><small>⚡ Power station</small><h2>Generation and loads</h2></div>' +
        meter('Sunlight today', pw.sun / 8, POWER, '≈' + Math.round(pw.sun) + ' cells') + meter('Cell on the rack', pw.charge, POWER, Math.round(pw.charge * 100) + '%') + meter('Cells ready', pw.cells / R.rackMax, POWER, pw.cells + ' / ' + R.rackMax) +
        pw.eff.map(function (e, k) { return meter('Panel ' + (k + 1), e, e > 0.85 ? OK : e > 0.65 ? AMBER : BAD, Math.round(e * 100) + '%'); }).join('') +
        row(pw.low ? '🟠' : '🟢', pw.low ? 'Reduced power: no reserve and nothing running' : 'Power ' + (pw.loads ? pw.loads + ' load' + (pw.loads > 1 ? 's' : '') + ' running' : 'nominal · no loads yet'),
          'Every power cell is one choice. Air Maker, Greenhouse lamps, Lab, Soil Bagger, Radio Dish and the rover all drink from the same rack, and panels stop charging after ' + Math.round(R.chargeSpan * 100) + '% of the shift when the Sun gets low.', pw.low ? 'alert' : 'good') +
        row('☀️', 'Panels at ' + Math.round(pw.eff.reduce(function (a, b) { return a + b; }, 0) / 3 * 100) + '% average', s.site.id === 'mars' ? 'Dust settles on the glass all day; brush a panel and it is back to 100%. The real Opportunity rover lived 14 years longer than planned because wind gusts cleaned its panels.' : 'The Sun moves across the sky, so a fixed panel slowly loses output. Turn it to face the Sun again and it is back to 100%.', '') +
        row('🚙', 'Rover battery ' + Math.round(mm.rover.charge / roverCap(s) * 100) + '%', 'The battery only drains while driving. One cell gives ' + R.roverPerCell + ' seconds of driving.', '') +
        closeBtn() + '</div>';
    } else {
      var ph = sim.stormPhase(s), env = sim.env(s), look = s.site.env[env.kind], o = outlookOf(s), sf = sim.shield(s), wx = sim.weather(s);
      var fc = o ? 'Storm odds today: ' + o.chance + '% (' + o.words + ')' : s.forecast ? (wx && wx.level ? ['', 'Small', 'Medium', 'BIG'][wx.level] + ' solar storm expected today' : 'Quiet Sun today (forecast from Earth)') : 'No forecast today (the dish was off)';
      html = '<div class="mc-card"><div class="mc-head"><small>🔭 Science · environment station</small><h2>Radiation and the Sun</h2></div>' +
        meter('Radiation badge', s.dose / 100, DOSE, pct(s.dose) + '%') + meter('Dome shielding', sf, '#c9a6ff', Math.round(sf * 100) + '%') +
        (o && ph === 'none' ? meter('Storm odds today', o.chance / 100, o.chance >= 60 ? BAD : o.chance >= 40 ? AMBER : OK, o.chance + '% · ' + o.words) : '') +
        row(ph === 'active' ? '☢️' : ph === 'warning' ? '🌩️' : ph === 'over' ? '✅' : '🌤️', ph === 'active' ? 'Radiation storm in progress' : ph === 'warning' ? 'Storm arriving: stay inside' : ph === 'over' ? 'Storm passed: all clear' : fc,
          ph === 'none' ? 'If a storm comes, the Radio Dish gives ' + R.warnDish + ' s of warning; without it the suit sensor gives only ' + R.warnNoDish + ' s. Inside, the walls and ' + s.bags + ' soil bags block ' + Math.round(sf * 100) + '% of the radiation.' : 'A radiation storm is a flood of fast particles from a solar flare. Inside, the walls and ' + s.bags + ' soil bags block ' + Math.round(sf * 100) + '% of it.', ph === 'active' || ph === 'warning' ? 'alert' : '') +
        row(look.icon, look.label + ' · about ' + Math.round(s.cellsToday) + ' power cells of sunlight', look.why, '') +
        row('📡', 'Instruments deployed: ' + Object.keys(s.inst).length + ' of ' + JA.INSTRUMENTS[s.site.id].length, JA.INSTRUMENTS[s.site.id].map(function (d) { return (s.inst[d.id] ? '✓ ' : '○ ') + d.name; }).join(' · ') + '. Each one adds a perk: the radiation sensor lengthens storm warnings; the weather station adds tomorrow\'s sunlight forecast.', '') +
        '<h3>Mission log</h3>' + logHtml(s, 6) + closeBtn() + '</div>';
    }
    U.modal(html, { cls: 'wide', actions: actions });
    // the diagram in the card keeps moving while it is open
    cancelAnimationFrame(orbitRaf);
    var cv = document.querySelector('#modal-root .mc-orbit');
    if (cv) {
      var c2 = cv.getContext('2d'), t0 = performance.now();
      (function loop() {
        if (!cv.isConnected) return;
        var t = (performance.now() - t0) / 1000, m2 = M.model(s);
        c2.clearRect(0, 0, cv.width, cv.height);
        M.drawOrbit(c2, cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.46, m2, t, { scale: 1.1 });
        orbitRaf = requestAnimationFrame(loop);
      })();
    }
  };

  // ---------- the cutaway overlay (the camera move itself is in game.js) ----------
  var mc = null;
  function el() { return mc || (mc = document.getElementById('mc')); }
  // data: { kind: 'alert'|'fault'|'reply'|'send'|'console', title, text, msg (a radio entry, optional) }
  M.overlay = function (data, s) {
    var e = el(); if (!e) return;
    if (!data) { e.classList.add('hidden'); e.className = 'hidden'; return; }
    var mdl = s ? M.model(s) : null, msg = data.msg || (mdl && mdl.cur) || null;
    e.className = 'kind-' + data.kind;
    e.querySelector('.mc-title').textContent = data.title || '';
    e.querySelector('.mc-msg').textContent = data.text || '';
    e.querySelector('.mc-delay').textContent = mdl ? (mdl.moon ? 'ONE-WAY DELAY 1.3 s' : 'ESTIMATED ONE-WAY DELAY ' + mmss(mdl.minutes)) : '';
    e.querySelector('.mc-dir').textContent = msg ? (msg.dir === 'up' ? (mdl.moon ? 'MOON → EARTH' : 'MARS → EARTH') : (mdl.moon ? 'EARTH → MOON' : 'EARTH → MARS')) : (mdl && !mdl.dish ? 'NO LINK · DISH UNPOWERED' : 'LINK OPEN');
    M.overlayFrame(s);
  };
  M.overlayFrame = function (s) {
    var e = el(); if (!e || e.classList.contains('hidden') || !s) return;
    var mdl = M.model(s), fill = e.querySelector('.mc-fill'), st = e.querySelector('.mc-status');
    if (mdl.cur) { fill.style.width = Math.round(mdl.prog * 100) + '%'; st.textContent = 'SIGNAL IN TRANSIT · ' + Math.round(mdl.prog * 100) + '%'; }
    else { fill.style.width = mdl.dish ? '100%' : '0%'; st.textContent = mdl.dish ? 'SIGNAL ' + (box(s).log.length ? 'DELIVERED' : 'READY') : 'NO LINK'; }
  };
})(window.JA);
