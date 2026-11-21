// Checks for the judge-readiness fixes (15 Nov): orbit alignment, last-day failures, dust devils, Earth vs local
// radio, the radiation model (flares / SEPs / CMEs), the dish and science trade-offs, and decisions over speed.
// Run: node tools/tests/fixes.test.js
var H = require('./harness.js'), JA = H.JA, sim = H.sim, R = H.R, arch = H.arch;
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); }

// ---- 1. the orbit picture: where are Earth and Mars? (checked against real oppositions and conjunctions)
(function () {
  var W = JA.weather;
  var opp = W.planets('2025-01-16'), conj = W.planets('2026-01-09'), opp2 = W.planets('2027-02-19');
  ok('2025 opposition is a close approach', W.alignment(opp) === 'close approach', opp.sep.toFixed(0) + '°');
  ok('2026 conjunction is the far side of the Sun', W.alignment(conj) === 'far side of the Sun', conj.sep.toFixed(0) + '°');
  ok('2027 opposition is a close approach', W.alignment(opp2) === 'close approach', opp2.sep.toFixed(0) + '°');
  var nov = W.planets('2026-11-15');
  ok('mid-Nov 2026: Mars is drawing closer (opposition is in Feb 2027)', W.alignment(nov) === 'drawing closer', nov.sep.toFixed(0) + '° ' + nov.au.toFixed(2) + ' AU');
  var jun = W.planets('2025-06-01');
  ok('mid-2025: Mars is drawing apart (after the Jan 2025 opposition)', W.alignment(jun) === 'drawing apart');
  var bad = 0;
  for (var t = Date.UTC(2024, 0, 1); t < Date.UTC(2028, 0, 1); t += 7 * 86400000) {
    var p = W.planets(new Date(t).toISOString().slice(0, 10));
    if (!(p.sep >= 0 && p.sep <= 180)) bad++;
  }
  ok('the separation angle always stays between 0 and 180 degrees (2024-2027, weekly)', bad === 0, bad + ' bad weeks');
})();

// ---- 2. launch day can be lost
(function () {
  function lastDay(site) {
    var s = sim.newGame({ site: site, level: 'cadet', seed: 11, weather: arch, dayLength: 300 });
    while (s.sol < s.totalSols) { s.air = 90; s.food = 90; s.dose = 0; sim.endSol(s, {}); sim.startSol(s); }
    s.storm = null; s.glitch = null; s.crisis = null;
    return s;
  }
  var s = lastDay('moon'); s.t = 60; s.air = 3;
  var rep = sim.endSol(s, { launch: true });
  ok('boarding early: the rest of the day does not pass at the outpost', s.t === 60 && rep.fail === null, 't=' + s.t + ' air=' + s.air.toFixed(1));
  var s2 = lastDay('mars'); s2.t = 299; s2.air = R.lateAir - 1;
  var rep2 = sim.endSol(s2, { launch: true, late: true });
  ok('a late dash to the rocket with too little air is a failure', rep2.fail === 'air', rep2.fail);
  var s3 = lastDay('mars'); s3.t = 299; s3.air = 40;
  var rep3 = sim.endSol(s3, { launch: true, late: true });
  ok('a late dash with enough air still launches', rep3.fail === null && Math.abs(s3.air - (40 - R.lateAir)) < 1e-9, s3.air);
  var s4 = lastDay('moon'); s4.t = 120; s4.dose = 100;
  ok('a full radiation badge on launch day is a failure', sim.endSol(s4, { launch: true }).fail === 'dose');
})();

// ---- 3. dust devils: a rare, lucky event on Mars, not a panel wash every 40 seconds
(function () {
  var planned = 0, cleans = 0, missions = 0, maxPerMission = 0, moonCleans = 0, sameAsBefore = true;
  ['cadet', 'commander', 'veteran'].forEach(function (lv) {
    for (var seed = 1; seed <= 40; seed++) {
      var r = H.run('mars', lv, seed * 7919, { gap: 10 }), s = r.s;
      missions++;
      if (s.devil) planned++;
      var n = s.devil && s.devil.state === 'done' ? 1 : 0;
      cleans += n; maxPerMission = Math.max(maxPerMission, n);
      if (s.devil && (s.devil.sol < 2 || s.devil.sol >= s.totalSols)) sameAsBefore = false;
      var m = H.run('moon', lv, seed * 7919, { gap: 10 }).s;
      if (m.devil) moonCleans++;
    }
  });
  ok('at most one dust-devil cleaning per Mars mission', maxPerMission <= 1, cleans + ' cleanings in ' + missions + ' missions');
  ok('about two thirds of Mars missions get one', planned / missions > 0.45 && planned / missions < 0.85, (planned / missions * 100).toFixed(0) + '%');
  ok('never on the first day or on launch day', sameAsBefore);
  ok('no dust devils on the Moon', moonCleans === 0);
  // the cleaning gives back only part of the dust
  var s = sim.newGame({ site: 'mars', level: 'commander', seed: 3, weather: arch, dayLength: 300 });
  s.rack.eff = [0.5, 0.6, 0.95];
  var gain = sim.devilClean(s);
  ok('a devil blows off only part of the dust', s.rack.eff[0] === 0.5 + R.devilClean && s.rack.eff[2] === 1, s.rack.eff.map(function (v) { return v.toFixed(2); }).join(' '));
  ok('and reports the average power it gave back', Math.abs(gain - ((R.devilClean * 2 + 0.05) / 3)) < 1e-9, gain.toFixed(3));
  // the event fires once, warns first, then cleans
  var s2 = null;
  for (var k = 1; k < 200 && !s2; k++) { var g = sim.newGame({ site: 'mars', level: 'commander', seed: k, weather: arch, dayLength: 300 }); if (g.devil) s2 = g; }
  while (s2.sol < s2.devil.sol) { s2.air = 90; s2.food = 90; s2.dose = 0; sim.endSol(s2, {}); sim.startSol(s2); }
  s2.storm = null; s2.glitch = null; s2.crisis = null;
  var evs = [];
  while (!s2.dayDone) { s2.air = 90; s2.dose = 0; evs = evs.concat(sim.tick(s2, 0.25, { outside: false }).filter(function (e) { return e.type === 'devil'; })); }
  ok('the devil is announced, then crosses the panels, once', evs.length === 2 && evs[0].phase === 'coming' && evs[1].phase === 'clean', evs.map(function (e) { return e.phase; }).join(','));
})();

// ---- 4. the radiation model: flares are flashes; particle storms (SEPs) and CME shocks are the dose
(function () {
  var W = JA.weather;
  function day(site, date) { return W.byDay(arch, site).filter(function (d) { return d.date === date; })[0]; }
  var m11 = day('moon', '2024-05-11'), m06 = day('moon', '2024-05-06'), r20 = day('mars', '2024-05-20'), r11 = day('mars', '2024-05-11');
  ok('Moon, 11 May 2024: GOES measured >100 MeV protons, a big particle storm', m11.level === 3 && m11.cause === 'sep' && /GOES/.test(m11.sep.inst), m11.sep && m11.sep.inst);
  ok('Moon, 6 May 2024: an X4.5 flare, but no particles reached Earth or the Moon', m06.cls === 'X4.5' && m06.level === 0, m06.cls + ' level ' + m06.level);
  ok('Mars, 11 May 2024: the X5.8 flare faced Earth, not Mars: no storm at Mars', r11.cls === 'X5.8' && r11.level === 0);
  ok('Mars, 20 May 2024: the far-side eruption Curiosity measured is a big storm at Mars', r20.level === 3 && r20.cause === 'sep' && r20.cme && r20.cme.v === 2678, r20.cme && ('angle ' + r20.cme.theta + '°'));
  ok('Mars, 20 May 2024: Mars was well linked to the eruption (within 20°)', r20.cme.theta < 20);
  ok('Moon, 20 May 2024: the same eruption headed away from Earth: no storm on the Moon', day('moon', '2024-05-20').level === 0);
  var c = W.connection('2024-05-11', 51, 1263, 'moon');
  ok('the 11 May CME (51° west, 1263 km/s) was well connected to Earth', c.level >= 2 && c.theta < 15, 'angle ' + c.theta.toFixed(0) + '°');
  ok('a slow CME sends no particles even when aimed well', W.connection('2024-05-11', 51, 650, 'moon').level === 0);
  ok('GOES >100 MeV is level 3, GOES >10 MeV is level 2, SOHO only is level 1, STEREO-A only is 0',
    W.sepLevel(['GOES-P: SEISS >100 MeV']) === 3 && W.sepLevel(['GOES-P: SEISS >10 MeV']) === 2 && W.sepLevel(['SOHO: COSTEP 15.8-39.8 MeV']) === 1 && W.sepLevel(['STEREO A: IMPACT 13-100 MeV']) === 0);
  var dm = W.describe(r20, 'mars').text, dl = W.describe(m11, 'moon').text, dq = W.describe(m06, 'moon').text;
  ok('the Mars story names Curiosity and the far side', /Curiosity/.test(dm) && /far side/.test(dm));
  ok('the Moon story names the GOES satellites', /GOES/.test(dl));
  ok('a flare-only day says no particles came', /no storm of particles/.test(dq) && /flash of light/.test(dq));
  // the mission's storms now come from the right physics: storm days only where something really arrived
  var flareDays = W.byDay(arch, 'moon').filter(function (d) { return d.cls; }).length;
  var stormDays = { moon: W.byDay(arch, 'moon').filter(function (d) { return d.level; }).length, mars: W.byDay(arch, 'mars').filter(function (d) { return d.level; }).length };
  ok('far fewer storm days than flare days', stormDays.moon < flareDays / 2 && stormDays.mars < flareDays / 2, 'flare days ' + flareDays + ', storm days moon ' + stormDays.moon + ' mars ' + stormDays.mars);
  var s = sim.newGame({ site: 'mars', level: 'veteran', seed: 4, weather: arch, dayLength: 300 });
  var dates = s.weather.map(function (w) { return w.date; });
  ok('a stormy Mars mission window includes the real 20 May storm', dates.indexOf('2024-05-20') >= 0, dates[0] + ' .. ' + dates[dates.length - 1]);
})();

// ---- 5. no free choices, and decisions (not speed) decide the mission
// The bot walks home 15 s after a warning (travel), powers the dish each morning (dishFirst) and does science,
// unless a strategy turns one of those off. gap = seconds between its actions (a slower player has a bigger gap).
(function () {
  var N = 24;
  function rate(site, level, extra) {
    var o = { science: true, dishFirst: true, travel: 15, gap: 20 }, won = 0;
    for (var k in extra) o[k] = extra[k];
    for (var seed = 1; seed <= N; seed++) { var r = H.run(site, level, seed * 104729 + 7, o); if (r.s.over && r.s.over.type === 'win') won++; }
    return Math.round(won / N * 100);
  }
  var careful = rate('moon', 'commander', {});
  ok('a careful Commander on the Moon brings the crew home', careful >= 90, careful + '%');
  var noShelter = rate('moon', 'commander', { shelter: false }), noBags = rate('moon', 'commander', { bags: 0 });
  ok('...but not one who ignores storm warnings', noShelter <= 10, noShelter + '%');
  ok('...or one who never shields the dome', noBags <= 10, noBags + '%');
  var vet = rate('moon', 'veteran', {}), vetNoDish = rate('moon', 'veteran', { dish: false }), vetNoSci = rate('moon', 'veteran', { science: false });
  ok('the Radio Dish is not a free choice: skipping it costs Veterans on the Moon', vetNoDish + 20 <= vet, 'dish ' + vet + '% vs none ' + vetNoDish + '%');
  ok('science is not a free choice: its discoveries help Veterans survive', vetNoSci < vet, 'science ' + vet + '% vs none ' + vetNoSci + '%');
  var cadetSlow = Math.min(rate('moon', 'cadet', { gap: 35 }), rate('mars', 'cadet', { gap: 35 }));
  ok('a slow young Cadet (one action every 35 s) still brings the crew home', cadetSlow >= 90, cadetSlow + '%');
  var marsSlower = rate('mars', 'commander', { gap: 28 });
  ok('a slower Commander on Mars (every 28 s) mostly makes it', marsSlower >= 80, marsSlower + '%');
  // the cold start: seedlings and a spare dinner, and the crew picks what is ripe after the shift
  var s = sim.newGame({ site: 'moon', level: 'commander', seed: 9, weather: arch, dayLength: 300 });
  ok('the crew started two beds of seedlings on the way down', s.m.food.beds.filter(function (b) { return b.state === 'growing'; }).length === R.seedlings);
  s.storm = null; s.glitch = null; s.crisis = null;
  s.m.food.beds[0].state = 'ripe'; s.m.food.beds[0].g = 1; s.m.food.beds[1].state = 'ripe'; s.m.food.beds[1].g = 1; s.m.food.beds[1].crop = 'potato';
  var f0 = s.food, rep = sim.endSol(s, {});
  var crew = rep.lines.filter(function (l) { return l.res === 'food'; })[0].parts.filter(function (p) { return /crew picked/.test(p.text); })[0];
  ok('after the shift the crew picks ripe beds and plants the same crop again', crew && crew.v === JA.CROPS.lettuce.food + JA.CROPS.potato.food && s.m.food.beds[1].state === 'growing' && s.m.food.beds[1].crop === 'potato', crew && crew.text);
  // nobody lands in a storm
  var badStart = 0;
  Object.keys(JA.SITES).forEach(function (site) { ['cadet', 'commander', 'veteran'].forEach(function (lv) {      // every planet
    for (var seed = 1; seed <= 20; seed++) { var g = sim.newGame({ site: site, level: lv, seed: seed, weather: arch, dayLength: 300 }); if (g.weather[0].level > 0 || (g.weather[1] && g.weather[1].level > 2)) badStart++; }
  }); });
  ok('no mission starts on a storm day, or meets a big storm on day 2', badStart === 0, badStart + ' bad starts');
})();

// ---- 4b. loading: live data, empty replies, and the honest fallback
function asyncTests() {
  var W = JA.weather, realFetch = global.fetch;
  global.fetch = function () { return Promise.reject(new Error('offline')); };
  return W.load('live').then(function (d) {
    ok('with NASA unreachable, live falls back to the archive and says so', d.source === 'archive' && d.fallback === true && d.sep.length > 0);
    global.fetch = function () { return Promise.resolve({ ok: true, text: function () { return Promise.resolve(''); } }); };
    return W.load('live');
  }).then(function (d) {
    ok('an empty reply (no events) is still live data, not an error', d.source === 'live' && !d.fallback && d.flares.length === 0 && d.sep.length === 0);
    global.fetch = realFetch;
  });
}

module.exports = { ok: ok };
if (require.main === module) {
  asyncTests().then(function () {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
}
