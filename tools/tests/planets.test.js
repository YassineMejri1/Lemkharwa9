/* Astro Outpost — every planet is complete.
   A planet is described by its entry in JA.SITES (js/data.js) and by its own entry in the per-planet tables.
   The rest of the code never asks "is this the Moon or Mars?": it reads these. This test checks that every
   planet describes itself fully, and that the Moon and Mars never have to borrow from another planet.
   A new planet may still borrow (through its "like" field) while it is being built: the test lists what it
   borrows as a to-do list instead of failing.
   Run from the game folder:   node tools/tests/planets.test.js */
var H = require('./harness.js'), JA = H.JA, sim = H.sim, arch = H.arch;
var pass = 0, fail = 0;
function ok(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL  ' + name + (info ? '  (' + info + ')' : '')); } }
var IDS = Object.keys(JA.SITES), BUILT = ['moon', 'mars'];      // the planets that must be complete on their own

// ---- 1. every planet describes itself
IDS.forEach(function (id) {
  var P = JA.SITES[id], n = 'planet ' + id + ': ';
  ok(n + 'its id matches its key', P.id === id);
  ['short', 'name', 'title', 'emoji', 'place', 'dayWord', 'iceName', 'commText', 'blurb', 'why'].forEach(function (k) {
    ok(n + k + ' is set', typeof P[k] === 'string' && P[k].length > 0);
  });
  ok(n + 'gravity is a real number of m/s²', P.gravity > 0 && P.gravity < 30);
  ok(n + 'radiation numbers are set', P.doseDay > 0 && P.doseNight >= 0 && P.stormMult >= 0);
  ok(n + 'atmosphere is none, thin or thick', ['none', 'thin', 'thick'].indexOf(P.atmosphere) >= 0, P.atmosphere);
  ok(n + 'dusty is true or false', typeof P.dusty === 'boolean');
  ok(n + 'comms is near, orbit or relay', ['near', 'orbit', 'relay'].indexOf(P.comms) >= 0, P.comms);
  ok(n + 'spaceWeather is earth, mars or star', ['earth', 'mars', 'star'].indexOf(P.spaceWeather) >= 0, P.spaceWeather);
  if (P.spaceWeather === 'star') ok(n + 'its made-up star has a name, a distance and a turn', !!(P.star && P.star.name && P.star.au > 0 && P.star.turn > 0));
  ok(n + 'only a made-up planet has a made-up star', P.spaceWeather !== 'star' || !!P.fictional);
  ok(n + 'colors has soil, soil2 and dust', P.colors && ['soil', 'soil2', 'dust'].every(function (k) { return typeof P.colors[k] === 'number'; }));
  var wk = P.weatherKinds || {};
  ['calm', 'mid', 'bad'].forEach(function (k) { ok(n + 'weather "' + k + '" is one of its weathers', !!(wk[k] && P.env && P.env[wk[k]]), wk[k]); });
  ok(n + 'its dark day (if any) is one of its weathers', !wk.dark || !!P.env[wk.dark], wk.dark);
  Object.keys(P.env || {}).forEach(function (k) {
    var e = P.env[k];
    ok(n + 'weather ' + k + ' has power, an icon, a name and a reason', e.cells > 0 && !!e.icon && !!e.label && !!e.why);
  });
  if (BUILT.indexOf(id) >= 0) ok(n + 'a finished planet borrows from nobody', !P.like);
  else ok(n + 'a new planet is "like" an existing one', !!P.like && P.like !== id && !!JA.SITES[P.like], P.like);
  // honesty: a made-up planet says so on its setup card, and the night report says so too
  if (P.fictional) {
    ok(n + 'its setup card says it is made up', /made-up/i.test(P.blurb), P.blurb);
    ok(n + 'a night-report fact says it is made up (source: fiction)', JA.FACTS.some(function (f) { return f.site === id && f.src === 'fiction' && /made-up/i.test(f.text); }));
  } else ok(n + 'a real planet is not marked made up', !P.fictional);
});
// ---- a made-up star: its own storms, never NASA's, and honest about it
IDS.filter(function (id) { return JA.SITES[id].spaceWeather === 'star'; }).forEach(function (id) {
  var W = JA.weather, n = 'star of ' + id + ': ', a = W.star(id, 42, false), b = W.star(id, 42, false), storm = W.star(id, 42, true);
  ok(n + 'the same seed makes the same record', JSON.stringify(a) === JSON.stringify(b));
  ok(n + 'its record is marked made up', a.source === 'star' && a.star === JA.SITES[id].star.name);
  ok(n + 'it links to no web page', a.flares.concat(a.cme, a.arrivals).every(function (x) { return !x.link; }));
  var lv = [0, 0, 0, 0], lvS = [0, 0, 0, 0];
  for (var seed = 1; seed <= 60; seed++) {
    W.byDay(W.star(id, seed, false), id).forEach(function (d) { lv[d.level]++; });
    W.byDay(W.star(id, seed, true), id).forEach(function (d) { lvS[d.level]++; });
  }
  ok(n + 'it has quiet days and storms of every size', lv[0] > 0 && lv[1] > 0 && lv[2] > 0 && lv[3] > 0, lv.join('/'));
  ok(n + 'the stormy choice is stormier', lvS[1] + lvS[2] * 2 + lvS[3] * 3 > (lv[1] + lv[2] * 2 + lv[3] * 3) * 1.4, lv.join('/') + ' vs ' + lvS.join('/'));
  ok(n + 'its storm days are described without NASA or a date', W.byDay(storm, id).every(function (d) {
    var t = W.describe(d, id).text; return !/NASA|GOES|SOHO|20\d\d/.test(t) && t.indexOf(JA.SITES[id].star.name) >= 0;
  }));
  // a mission there never replays NASA's records, whatever it is handed
  var s = sim.newGame({ site: id, level: 'commander', seed: 7, weather: arch });
  ok(n + 'a mission handed NASA records still uses the made-up star', s.weatherSource === 'star' && s.weather.every(function (d) { return !d.link && !d.sep; }));
  var s2 = sim.newGame({ site: id, level: 'commander', seed: 7, weather: arch });
  ok(n + 'the same seed gives the same storms', s.weather.map(function (d) { return d.level; }).join() === s2.weather.map(function (d) { return d.level; }).join());
});
// ---- dew and heat (a planet with a dew catcher, and hot days)
IDS.forEach(function (id) {
  var P = JA.SITES[id], s = sim.newGame({ site: id, level: 'veteran', seed: 11, weather: arch });
  var hot = s.env.some(function (e) { return e.heat > 1; }), dewy = s.env.some(function (e) { return e.dew != null; });
  if (!P.dew) { ok(id + ' has no dew catcher', s.dew === undefined && !dewy); ok(id + ' has no hot days', !hot); return; }
  ok(id + ': every kind of weather says how much dew its night brings', Object.keys(P.env).every(function (k) { return typeof P.env[k].dew === 'number'; }));
  ok(id + ': the dew catcher starts empty', s.dew === 0);
  // play the first day through, then look at the morning after
  while (!s.dayDone) sim.tick(s, 0.5, { outside: false });
  sim.endSol(s, {}); sim.startSol(s);
  var want = JA.RULES.dewWater * (s.env[0].dew || 0);
  ok(id + ': the night fills the catcher by its weather', Math.abs(s.dew - Math.min(JA.RULES.dewWater, want)) < 1e-9, s.dew + ' vs ' + want);
  var r = sim.takeDew(s);
  ok(id + ': the can can be taken, and the catcher is then empty', r.ok && r.water > 0 && s.dew === 0);
  ok(id + ': an empty catcher gives nothing', !sim.takeDew(s).ok);
  s.water = 10; var f = sim.feedDew(s, r.water);
  ok(id + ': the dew goes into the water tank', f.ok && s.water === 10 + r.water && s.today.water.dew === r.water);
  s.water = sim.waterCap(s); ok(id + ': not into a full tank', !sim.feedDew(s, 16).ok);
  // a sandstorm night gives no dew
  var stormK = P.weatherKinds.bad;
  ok(id + ': a sandstorm night gives no dew', P.env[stormK].dew === 0);
  // a hot day drains more water than a mild one, and the sweat is not recycled
  function used(heat) {
    var t = sim.newGame({ site: id, level: 'veteran', seed: 11, weather: arch });
    t.env[0].heat = heat; if (!heat) delete t.env[0].heat;
    t.water = 80; var w0 = t.water;
    for (var k = 0; k < 200 && !t.dayDone; k++) sim.tick(t, 0.25, { outside: false });
    return w0 - t.water;
  }
  ok(id + ': a hot day costs more water', used(1.6) > used(0) * 1.5, used(1.6).toFixed(2) + ' vs ' + used(0).toFixed(2));
});

// ---- a made-up animal lives only on a made-up planet, and its cards say so
IDS.forEach(function (id) {
  var P = JA.SITES[id];
  if (!P.creature) return;
  ok(id + ': only a made-up planet has a made-up animal', !!P.fictional);
  var cards = JA.MECHS.filter(function (m) { return m.site === id; }).map(function (m) { return m.id; });
  ['ray', 'sandswim', 'swave'].forEach(function (c) { ok(id + ': the animal has its card "' + c + '"', cards.indexOf(c) >= 0); });
  var honest = JA.mechFor('ray', id);
  ok(id + ': its own card says it is made up (source: fiction)', honest && honest.src === 'fiction' && /invented|made up/i.test(honest.text));
  ok(id + ': the real science beside it has a real source', !!JA.SOURCES[JA.mechFor('sandswim', id).src].url && !!JA.SOURCES[JA.mechFor('swave', id).src].url);
});
['moon', 'mars'].forEach(function (id) { ok(id + ' has no made-up animal', !JA.SITES[id].creature); });

// ---- a planet whose water comes from a well (waterWords) never talks about ice
IDS.filter(function (id) { return JA.iceWell(id); }).forEach(function (id) {
  var BAD = /ice|frost|frozen|freez/i, hits = [], P = JA.SITES[id];
  function chk(where, t) { if (typeof t === 'string' && BAD.test(t.replace(/not frozen/gi, ''))) hits.push(where); }
  ['iceName', 'why', 'blurb'].forEach(function (k) { chk('site.' + k, P[k]); });
  JA.MECHS.forEach(function (m) { if (m.site && m.site !== id) return; var x = JA.mechFor(m.id, id); chk('card ' + m.id, x.title + ' ' + x.text + ' ' + x.hint); });
  JA.GEO[id].forEach(function (g) { chk('rock site ' + g.name, g.name + ' ' + (g.perk ? g.perk.text : '') + g.finds.map(function (f) { return f.title + ' ' + f.text; }).join(' ')); });
  JA.FACTS.forEach(function (f) { if (f.site === id || f.site === 'any') chk('fact ' + f.id, f.text); });
  ['cadet', 'veteran'].forEach(function (lv) {
    var s = H.run(id, lv, 77, { gap: 10 }).s;
    (s.log || []).forEach(function (r) { (r.lines || []).forEach(function (l) { (l.parts || []).forEach(function (p) { chk('night report', p.text); }); }); });
    for (var sol = 1; sol <= s.totalSols; sol++) { var di = sim.dayInfo(s, sol); chk('day ' + sol, di.learn + ' ' + (di.goal ? di.goal.text : '')); }
  });
  var s = sim.newGame({ site: id, level: 'commander', seed: 3, weather: arch });
  [[0, 0], [0, 1], [1, 0]].forEach(function (c) { s.m.air.power = c[0]; s.m.air.queue = c[1]; s.air = 5; var h = sim.hintInfo(s); if (h) chk('hint', h.text + ' ' + h.why); });
  ok(id + ': nothing it says mentions ice (its water comes from a well)', !hits.length, hits.join(', '));
  ok(id + ': its carried water is a can, not an ice chunk', JA.itemDef('ice', id).name !== JA.ITEMS.ice.name);
});
['moon', 'mars'].forEach(function (id) { ok(id + ' still mines ice', !JA.iceWell(id) && JA.itemDef('ice', id) === JA.ITEMS.ice); });

// the Moon and Mars never get a made-up star
['moon', 'mars'].forEach(function (id) {
  var s = sim.newGame({ site: id, level: 'commander', seed: 7, weather: arch });
  ok(id + ' replays NASA records', s.weatherSource === 'archive');
});

// every source a card cites exists; only the made-up planet's own source has no web page
(function () {
  var cited = {};
  JA.FACTS.forEach(function (f) { cited[f.src] = 1; });
  IDS.forEach(function (id) {
    (JA.GEO[id] || []).forEach(function (g) { g.finds.forEach(function (f) { cited[f.src] = 1; }); });
    (JA.INSTRUMENTS[id] || []).forEach(function (x) { cited[x.src] = 1; });
    (JA.PHOTOS[id] || []).forEach(function (x) { cited[x.src] = 1; });
  });
  JA.MECHS.forEach(function (m) { if (typeof m.src === 'string') cited[m.src] = 1; else Object.keys(m.src).forEach(function (k) { cited[m.src[k]] = 1; }); });
  Object.keys(cited).forEach(function (k) { ok('source "' + k + '" exists', !!JA.SOURCES[k]); });
  Object.keys(JA.SOURCES).forEach(function (k) { ok('source "' + k + '" has a web page, or is the made-up one', !!JA.SOURCES[k].url || k === 'fiction'); });
})();
// every explanation card that differs per planet has words for every planet
JA.MECHS.forEach(function (m) {
  if (typeof m.text === 'object') IDS.forEach(function (id) {
    if (m.site && m.site !== id) return;
    ok('card "' + m.id + '" has its own words for ' + id, typeof m.text[id] === 'string' && m.text[id].length > 20);
  });
});

// ---- 2. every per-planet table has the planet
IDS.forEach(function (id) {
  var n = 'planet ' + id + ': ';
  ok(n + 'four rock sites (JA.GEO)', (JA.GEO[id] || []).length === 4);
  ok(n + 'the three instruments (JA.INSTRUMENTS)', (JA.INSTRUMENTS[id] || []).map(function (x) { return x.id; }).sort().join() === 'beam,rad,seismo');
  ok(n + 'postcard spots (JA.PHOTOS)', (JA.PHOTOS[id] || []).length >= 1);
  ok(n + 'real facts of its own (JA.FACTS)', JA.FACTS.some(function (f) { return f.site === id; }));
});

// ---- 3. the helpers
(function () {
  var t = { moon: 1, mars: 2 };
  ok('JA.pick reads a planet id', JA.pick('moon', t) === 1 && JA.pick('mars', t) === 2);
  ok('JA.pick reads a mission state', JA.pick(sim.newGame({ site: 'moon', level: 'cadet', seed: 1, weather: arch, dayLength: 300 }), t) === 1);
  ok('JA.pick keeps a falsy value', JA.pick('moon', { moon: 0, mars: 5 }) === 0);
  ok('JA.siteText: the same text everywhere', JA.siteText('hello', 'mars') === 'hello');
  ok('JA.siteText: a text per planet', JA.siteText({ moon: 'a', mars: 'b' }, 'mars') === 'b');
  ok('JA.siteText: a worked-out text', JA.siteText(function (s) { return s.site.id; }, 'moon') === 'moon');
  ok('JA.hasAir: no air on the Moon, air on Mars', !JA.hasAir('moon') && JA.hasAir('mars'));
})();

// ---- 4. whole missions: the finished planets never borrow, new planets show what they still borrow
JA.pick.missing = {};
IDS.forEach(function (id) {
  ['cadet', 'commander', 'veteran'].forEach(function (lv) {
    var r = H.run(id, lv, 4242, { gap: 8, science: true }), s = r.s;
    ok('planet ' + id + ', ' + lv + ': a whole mission plays to the end', !!s.over, s.over && s.over.type);
  });
});
BUILT.forEach(function (id) { ok('planet ' + id + ' never borrows from another planet', !JA.pick.missing[id], JA.pick.missing[id] + ' lookups'); });
IDS.filter(function (id) { return BUILT.indexOf(id) < 0; }).forEach(function (id) {
  if (JA.pick.missing[id]) console.log('TO DO  planet ' + id + ' still borrows from "' + JA.SITES[id].like + '" in ' + JA.pick.missing[id] + ' lookups');
});

// ---- 5. a made-up third planet (only inside this test) plays whole missions through the rules
(function () {
  var M = JA.SITES.mars, T = JA.SITES.testworld = {};
  Object.keys(M).forEach(function (k) { T[k] = M[k]; });
  T.id = 'testworld'; T.short = 'Testworld'; T.name = 'Testworld'; T.title = 'Testworld'; T.like = 'mars';
  T.atmosphere = 'thick'; T.comms = 'relay';
  JA.pick.missing = {};
  var done = 0, crashed = '';
  ['cadet', 'commander', 'veteran'].forEach(function (lv) {
    [1, 2, 3].forEach(function (seed) {
      try { if (H.run('testworld', lv, seed, { gap: 8, science: true }).s.over) done++; } catch (e) { crashed = crashed || lv + '/' + seed + ': ' + e.message; }
    });
  });
  ok('a third planet plays 9 whole missions through the rules without a crash', done === 9 && !crashed, crashed || done + '/9');
  ok('a third planet that has no table entries borrows from the planet it is like', JA.pick.missing.testworld > 0);
  ok('...and that borrowing is remembered for nothing else', !JA.pick.missing.moon && !JA.pick.missing.mars);
  delete JA.SITES.testworld;
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
