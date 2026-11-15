// Checks for the linked systems added on 14 Nov: CO2 filter, water tank, crops, shade, wear, the long dark, "why" notes.
// Run: node tools/tests/systems.test.js
var H = require('./harness.js'), JA = H.JA, sim = H.sim, R = H.R, arch = H.arch;
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
function game(site, level, seed, D) { return sim.newGame({ site: site, level: level, seed: seed, weather: arch, dayLength: D || 300 }); }
function quiet(s) { s.storm = null; s.glitch = null; s.crisis = null; }
// an empty greenhouse (a new game starts with R.seedlings beds already growing), for the tests about planting
function bare(s) { s.m.food.beds.forEach(function (b) { b.state = 'empty'; b.g = 0; }); }
function run(s, secs, ctx) { var ev = [], end = Math.min(s.dayLength, s.t + secs); while (s.t < end && !s.dayDone) ev = ev.concat(sim.tick(s, 0.25, ctx || { outside: false })); return ev; }
function whys(ev) { return ev.filter(function (e) { return e.type === 'why'; }).map(function (e) { return e.id; }); }

// ---- the CO2 filter
(function () {
  var s = game('mars', 'commander', 5); quiet(s);
  ok('filter starts clean', s.filter === 100);
  ok('a clean filter refuses a power cell', sim.plug(s, 'scrub').ok === false);
  run(s, 150);
  var used = 100 - s.filter, expect = sim.airDrain(s) * 0.5 * R.filterPerAir;
  ok('half a day of breathing fills it by airDrain x filterPerAir / 2', Math.abs(used - expect) < 0.5, used.toFixed(1) + ' vs ' + expect.toFixed(1));
  var s2 = game('mars', 'commander', 5); quiet(s2);
  run(s2, 150, { outside: true, sprint: true });
  ok('running fills it faster', 100 - s2.filter > used * 1.4);
  s.filter = 0;
  ok('a full filter makes the air stale', sim.stale(s) === R.staleRate);
  var a0 = s.air; run(s, 30); var drop = a0 - s.air, normal = sim.airDrain(s) * 30 / 300;
  ok('stale air drains the tanks faster', Math.abs(drop - normal * R.staleRate) < 0.2, drop.toFixed(2) + ' vs ' + (normal * R.staleRate).toFixed(2));
  ok('baking it costs a plug and restores 100%', sim.plug(s, 'scrub').ok === true && s.filter === 100 && sim.stale(s) === 1 && s.stats.baked === 1);
  s.stale = 2; s.filter = 0;
  ok('a crisis clog and a full filter do not multiply', sim.stale(s) === 2);
})();

// ---- the water tank
(function () {
  var s = game('moon', 'commander', 6); quiet(s);
  var w0 = s.water;
  run(s, 300 - s.t - 1);
  var net = w0 - s.water, expect = R.crewWater * (1 - s.mods.recycle);
  ok('with no plants the crew only costs what the recycler loses', Math.abs(net - expect) < 0.3, net.toFixed(2) + ' vs ' + expect.toFixed(2));
  var s2 = game('moon', 'commander', 6); quiet(s2); bare(s2);
  s2.water = 50; ok('ice adds waterPerIce', sim.feedIce(s2, 'food').ok && s2.water === 50 + R.waterPerIce);
  s2.water = 90; ok('a nearly full tank refuses ice', sim.feedIce(s2, 'food').ok === false);
  s2.water = 0; s2.m.food.lamp = 1; sim.plant(s2, 0); run(s2, 60);
  ok('plants do not grow without water', s2.m.food.beds[0].g === 0);
  s2.water = 50; run(s2, 60);
  ok('they grow once the tank has water', s2.m.food.beds[0].g > 0);
  s2.water = 0; s2.food = 60; s2.air = 90;
  var f0 = s2.food, rep = sim.endSol(s2, {});
  var normal = s2.level.dinner + s2.mods.dinner;
  ok('the dinner on the meter already counts the extra packs of an empty tank', sim.dinner(s2) === normal + R.dryDinner, sim.dinner(s2));
  ok('an empty tank costs extra food at dinner', Math.abs((f0 - s2.food) - (normal + R.dryDinner)) < 0.01, f0 - s2.food);
  ok('and the night report says why', rep.whys.indexOf('thirst') >= 0);
  ok('no care bonus that night', !s2.today.care);
})();

// ---- two crops
(function () {
  var s = game('mars', 'commander', 7); quiet(s); bare(s);
  s.m.food.lamp = 2; s.water = 100;
  ok('plant() uses the seeds in your pocket', sim.plant(s, 0) === 'lettuce' && s.m.food.beds[0].crop === 'lettuce');
  ok('and switches when a crop is named', sim.plant(s, 1, 'potato') === 'potato' && s.seed === 'potato');
  run(s, 300 * 0.82);
  ok('lettuce is ripe in under a day, potatoes are not', s.m.food.beds[0].state === 'ripe' && s.m.food.beds[1].state === 'growing', s.m.food.beds[1].g.toFixed(2));
  var kind = sim.harvest(s, 0), f0 = s.food, r = sim.storeCrate(s, kind);
  ok('a lettuce crate adds its own food', kind === 'lettuce' && r.ok && r.food === JA.CROPS.lettuce.food && s.food === f0 + JA.CROPS.lettuce.food);
  f0 = s.food; r = sim.storeCrate(s, 'potato');
  ok('a potato crate adds more', r.food === JA.CROPS.potato.food && s.food === Math.min(100, f0 + JA.CROPS.potato.food));
  ok('an unknown crate counts as lettuce', sim.storeCrate(s).food === JA.CROPS.lettuce.food);
})();

// ---- soil bags shade the skylights
(function () {
  var s = game('moon', 'commander', 8), i;
  for (i = 0; i < R.bagsFreeShade; i++) sim.addBag(s);
  ok('the first bags are free', sim.shade(s) === 0 && sim.sunPower(s) === 1);
  sim.addBag(s);
  ok('each bag past them costs solar power', Math.abs(sim.shade(s) - R.bagShade) < 1e-9 && s.seen.shade === s.sol);
  for (i = s.bags; i < R.shieldSlots; i++) sim.addBag(s);
  ok('a fully covered dome costs 12%', Math.abs(sim.shade(s) - 0.12) < 1e-9, sim.shade(s));
})();

// ---- wear
(function () {
  var s = game('mars', 'veteran', 9), i;
  for (i = 0; i < 9; i++) sim.jam(s);
  ok('drill wear stops at its cap', Math.abs(s.wear.drill - R.jamWearMax) < 1e-9, s.wear.drill);
  quiet(s); s.m.rover.charge = 2;
  run(s, 5, { outside: true, driving: true });
  ok('running the rover flat wears the battery once', Math.abs(s.wear.rover - R.flatWear) < 1e-9 && sim.roverCap(s) === R.roverMax * (1 - R.flatWear));
  run(s, 5, { outside: true, driving: true });
  ok('crawling on an empty battery does not wear it again', Math.abs(s.wear.rover - R.flatWear) < 1e-9);
  s.m.rover.charge = 0; sim.plug(s, 'rover'); sim.plug(s, 'rover');
  ok('a worn battery fills to its smaller size', s.m.rover.charge <= sim.roverCap(s) + 1e-9, s.m.rover.charge);
})();

// ---- the long dark
(function () {
  var s = game('moon', 'commander', 10), c = game('moon', 'cadet', 10), m = game('mars', 'veteran', 10);
  ok('a long Moon mission has one dark day', s.darkSol >= 6 && s.darkSol <= 7 && s.env.filter(function (e) { return e.kind === 'dark'; }).length === 1, s.darkSol);
  ok('a Cadet mission has none', c.darkSol === 0);
  ok('Mars has none', m.darkSol === 0);
  var seenAt = 0;
  while (s.sol < s.darkSol) { s.air = 90; s.food = 90; s.dose = 0; if (s.seen.longdark && !seenAt) seenAt = s.seen.longdark; var rep = sim.endSol(s, {}); if (s.sol === s.darkSol - 2) ok('the night report two days before gives warning', rep.dark === 2); if (s.sol === s.darkSol - 1) ok('and again the night before', rep.dark === 1); var cells = s.rack.cells; sim.startSol(s); }
  if (s.seen.longdark && !seenAt) seenAt = s.seen.longdark;
  ok('the "long dark" note comes two days ahead', seenAt === s.darkSol - 2, seenAt);
  ok('on the dark day the panels make one cell', s.cellsToday === 1 && sim.env(s).kind === 'dark');
  quiet(s); s.rack.cells = 0; s.rack.charge = 0.3; var c0 = s.rack.cells + s.rack.charge; run(s, 200);
  ok('and nothing charges during the day', Math.abs(s.rack.cells + s.rack.charge - c0) < 1e-6);
})();

// ---- "why did that happen?" notes
(function () {
  var s = game('mars', 'commander', 11); quiet(s);
  s.m.air.power = 3; s.m.air.queue = 1;
  var ev = run(s, 40);
  ok('the first air made explains electrolysis', s.seen.electro === 1 && whys(ev).indexOf('electro') >= 0, whys(ev).join(','));
  s.m.air.queue = 1; ev = run(s, 40);
  ok('only once', whys(ev).indexOf('electro') < 0);
  var s2 = game('mars', 'commander', 12); quiet(s2);
  s2.filter = 20; s2.dose = 30; s2.m.air.power = 3; s2.m.air.queue = 1;
  ev = run(s2, 60, { outside: false, calm: true });
  ok('during the first lesson only the lesson\'s own cards are shown', whys(ev).join(',') === 'electro', whys(ev).join(','));
  ok('the others wait in the queue', s2.whyQ.indexOf('filterlow') >= 0 && s2.whyQ.indexOf('dose25') >= 0, s2.whyQ.join(','));
  ev = run(s2, 60);
  var w = whys(ev);
  ok('then they come out one at a time', w.length >= 2 && w.indexOf('filterlow') >= 0, w.join(','));
  var times = []; var s3 = game('mars', 'commander', 13); quiet(s3); s3.filter = 20; s3.dose = 30; s3.water = 5; sim.plant(s3, 0); s3.m.food.lamp = 1;
  while (s3.t < 200) { sim.tick(s3, 0.25, { outside: false }).forEach(function (e) { if (e.type === 'why') times.push(s3.t); }); }
  var gapOk = times.every(function (t, i) { return i === 0 || t - times[i - 1] >= R.whyGap - 0.3; });
  ok('cards are spaced out', times.length >= 3 && gapOk, times.map(function (t) { return Math.round(t); }).join(','));
  JA.MECHS.forEach(function (m) { if (!m.id || !m.icon || !m.title || !m.hint || !m.src || !m.text) ok('mech ' + m.id + ' is complete', false); ['moon', 'mars'].forEach(function (site) { var x = JA.mechFor(m.id, site); if (!x.text || !JA.SOURCES[x.src]) ok('mech ' + m.id + ' has words and a source on ' + site, false); }); });
  ok('every explanation has words and a real source for both places', true);
  var h = sim.hintInfo(s2);
  ok('Mission Control\'s advice carries a reason', h && h.text && typeof h.why === 'string', h && h.text);
})();

// ---- facts and the night report
(function () {
  var s = game('moon', 'commander', 14); quiet(s);
  s.air = 90; s.food = 90;
  var rep = sim.endSol(s, {});
  ok('a quiet day gives two facts', rep.facts.length === 2 && rep.fact === rep.facts[0] && rep.facts[0].id !== rep.facts[1].id);
  ok('the report has water and filter lines', rep.lines.some(function (l) { return l.res === 'water'; }) && rep.lines.some(function (l) { return l.res === 'filter'; }));
  ok('a day of looked-after life support is noted in the report', s.today.care === true && rep.care === true);
  ['air', 'food', 'dose', 'water', 'filter'].forEach(function (k) { if (typeof rep.before[k] !== 'number' || typeof rep.after[k] !== 'number' || isNaN(rep.after[k])) ok('report number ' + k, false); });
  ok('every number in the report is a number', true);
})();

// ---- things a review found on 15 Nov, kept here so they stay fixed
(function () {
  // the long dark is always the day after the "Sun chaser" lesson
  var days = {};
  for (var seed = 1; seed <= 40; seed++) days[game('moon', seed % 2 ? 'commander' : 'veteran', seed).darkSol] = 1;
  ok('the long dark always falls on day 7', Object.keys(days).join(',') === '7', Object.keys(days).join(','));

  // one ice chunk says how much water it really added
  var s = game('mars', 'commander', 20); quiet(s); s.water = 80;
  var r = sim.feedIce(s, 'food');
  ok('a nearly full tank takes only what fits, and says so', r.ok && r.add === 20 && s.water === 100, r.add);

  // the clogged filter of the crisis is the filter on the meter
  s = game('moon', 'commander', 21); quiet(s); s.air = 90; s.food = 90;
  s.crisis = { id: 'co2', at: 1, until: 60, state: 'pending' };
  run(s, 2);
  ok('the CO2 crisis clogs the real filter', s.filter <= 5 && sim.stale(s) === 2, s.filter);
  JA.crisis.choose(s, 'flush');
  ok('flushing clears the air but not the filter', s.stale === 1 && s.filter <= 5);
  sim.plug(s, 'scrub');
  s.air = 90; s.food = 90; sim.endSol(s, {}); sim.startSol(s); quiet(s);
  var a0 = s.air, ev = run(s, 10), cons = ev.filter(function (e) { return e.type === 'consequence'; })[0];
  ok('baking the filter after a flush stops the second flush', cons && cons.res.tone === 'good' && a0 - s.air < 3, cons && cons.res.tone);

  // every meter in the night report adds up: morning value + the listed parts = evening value
  var worst = 0, where = '';
  ['moon', 'mars'].forEach(function (site) { ['cadet', 'commander', 'veteran'].forEach(function (level) { [0, 1, 2].forEach(function (opt) {
    for (var seed = 1; seed <= 6; seed++) {
      var pick = {}; Object.keys(JA.CRISES).forEach(function (id) { pick[id] = JA.CRISES[id].options[opt].id; });
      var m = H.run(site, level, seed * 104729 + opt, { gap: 8, science: true, pick: pick }).s;
      m.log.forEach(function (rep) { rep.lines.forEach(function (l) {
        if (l.res !== 'water' && l.res !== 'filter') return;
        var sum = rep.before[l.res]; l.parts.forEach(function (p) { sum += p.v; });
        var off = Math.abs(sum - rep.after[l.res]) - 0.5 * l.parts.length;      // every part is rounded to a whole number
        if (off > worst) { worst = off; where = site + ' ' + level + ' day ' + rep.sol + ' ' + l.res + ': ' + rep.before[l.res].toFixed(1) + ' -> ' + rep.after[l.res].toFixed(1) + ' parts ' + l.parts.map(function (p) { return p.v; }).join(','); }
      }); });
    }
  }); }); });
  ok('the water and filter rows of every night report add up', worst <= 1, where);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
