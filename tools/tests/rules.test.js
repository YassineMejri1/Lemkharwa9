// Checks for the mission rules and the crisis moments, plus 144 robot missions that must not crash. Run: node tools/tests/rules.test.js
var H = require('./harness.js'), JA = H.JA, sim = H.sim, R = H.R, arch = H.arch;
var pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); }
function game(site, level, seed, D) { return sim.newGame({ site: site, level: level, seed: seed, weather: arch, dayLength: D || 300 }); }
function runTo(s, t, ctx) { var ev = []; while (s.t < t && !s.dayDone) ev = ev.concat(sim.tick(s, 0.25, ctx || { outside: false })); return ev; }
function nextDay(s) { sim.endSol(s, {}); sim.startSol(s); }
function keepAlive(s) { s.air = 90; s.food = 90; s.dose = 0; }

// ---- 1. a "later today" consequence opened late on a short day still lands the same day
(function () {
  var s = game('mars', 'commander', 11, 180);
  keepAlive(s);
  s.storm = null; s.glitch = null;
  s.crisis = { id: 'fuse', at: 150, until: 170, state: 'pending' };
  s.m.comms.on = true;
  var ev = runTo(s, 151);
  ok('fuse crisis opened at t=150 on a 180 s day', ev.some(function (e) { return e.type === 'crisis'; }));
  JA.crisis.choose(s, 'foil');
  var a = s.after.filter(function (x) { return x.sol === s.sol; })[0];
  ok('foil consequence is scheduled inside the day', a && a.t <= s.dayLength - 0.5, 't=' + (a && a.t));
  ev = runTo(s, 180);
  ok('foil consequence fired the same day', ev.some(function (e) { return e.type === 'consequence'; }));
  keepAlive(s); nextDay(s);
  var ev2 = runTo(s, 10);
  ok('nothing spills into the next morning', !ev2.some(function (e) { return e.type === 'consequence'; }) && !s.m.comms.broken && !s.m.food.broken);
})();

// ---- 1b. shrinking the day keeps a pending consequence inside the day
(function () {
  var s = game('moon', 'commander', 12, 720);
  keepAlive(s); s.storm = null; s.glitch = null;
  s.crisis = { id: 'leak', at: 500, until: 600, state: 'pending' };
  runTo(s, 501); JA.crisis.choose(s, 'later');
  sim.setDayLength(s, 180);
  var a = s.after.filter(function (x) { return x.sol === s.sol && !x.done; })[0];
  ok('after shrinking the day the consequence is still inside it', a && a.t <= 179.5, 't=' + (a && a.t.toFixed(1)) + ' now=' + s.t.toFixed(1));
})();

// ---- 2. the pump fuse and a Greenhouse breakdown do not cancel each other
(function () {
  var s = game('mars', 'commander', 21);
  keepAlive(s); s.storm = null;
  s.glitch = { machine: 'food', at: 10, state: 'pending', replyAt: 0, misses: 0, asked: false };
  s.crisis = { id: 'fuse', at: 20, until: 60, state: 'pending' };
  runTo(s, 21);
  ok('greenhouse broke, then the fuse blew', s.glitch.state === 'broken' && s.m.food.broken && s.flags.pumpFuse === s.sol);
  JA.crisis.choose(s, 'pump');
  ok('fuse in the pump does NOT mend the breakdown', s.m.food.broken === true);
  sim.repairDone(s);
  ok('repair then clears it', s.m.food.broken === false);

  var s2 = game('mars', 'commander', 22);
  keepAlive(s2); s2.storm = null;
  s2.glitch = { machine: 'food', at: 10, state: 'pending', replyAt: 0, misses: 0, asked: false };
  s2.crisis = { id: 'fuse', at: 20, until: 60, state: 'pending' };
  runTo(s2, 21); JA.crisis.choose(s2, 'radio');
  sim.repairDone(s2);
  ok('repairing the breakdown does NOT replace the blown fuse', s2.m.food.broken === true);
  keepAlive(s2); nextDay(s2);
  ok('next morning the greenhouse works again', s2.m.food.broken === false);
})();

// ---- 3. daily challenges cannot become impossible by working ahead
(function () {
  var s = game('moon', 'commander', 31), i;
  keepAlive(s);
  for (i = 0; i < 13; i++) sim.addBag(s);
  nextDay(s); keepAlive(s);
  ok('day 2 challenge is the 5-bag one', s.day.goal && s.day.goal.id === 'bags');
  ok('progress text asks for the 3 that are left', sim.dayGoalProgress(s) === ' (0/3)', sim.dayGoalProgress(s));
  for (i = 0; i < 3; i++) sim.addBag(s);
  var ev = runTo(s, 1);
  ok('challenge pays out after the last 3 bags', ev.some(function (e) { return e.type === 'daygoal'; }));

  var s2 = game('moon', 'commander', 32);
  keepAlive(s2);
  nextDay(s2); keepAlive(s2);
  ok('normal case still asks for 5', sim.dayGoalProgress(s2) === ' (0/5)', sim.dayGoalProgress(s2));
  for (i = 0; i < 4; i++) sim.addBag(s2);
  ok('4 bags is not enough', !sim.dayGoalDone(s2));
  sim.addBag(s2);
  ok('5 bags is', sim.dayGoalDone(s2));
})();

// ---- 4. going to bed early does not dodge a crisis
(function () {
  var s = game('moon', 'commander', 41);
  while (!s.crisisPlan[s.sol]) { keepAlive(s); nextDay(s); }
  var id = s.crisis.id, day = s.sol;
  keepAlive(s);
  runTo(s, 5);
  sim.endSol(s, {});                      // straight to bed
  ok('crisis did not open during sleep', s.crisis.state === 'pending');
  keepAlive(s); sim.startSol(s);
  ok('it is carried to the next day', s.crisis && s.crisis.id === id && s.sol === day + 1, s.crisis && s.crisis.id);
  ok('the day after still has its own planned crisis', !!s.crisisPlan[day + 2] || s.level.crisisSols.indexOf(day + 2) < 0);
})();

// ---- 5. the backup scrubber cannot drive the rack charge below zero
(function () {
  var s = game('moon', 'commander', 51);
  keepAlive(s); s.storm = null; s.glitch = null;
  s.rack.cells = 0; s.rack.charge = 0.07;
  s.crisis = { id: 'co2', at: 1, until: 60, state: 'pending' };
  s.rack.broken = true;   // stop charging, to keep the number readable
  runTo(s, 2); JA.crisis.choose(s, 'cell');
  ok('rack charge stays at 0 or above', s.rack.charge >= 0, 'charge=' + s.rack.charge);
})();

// ---- 6. regression: the bot still completes missions on every site and level, every crisis choice
(function () {
  var total = 0, won = 0, errs = 0, lost = {};
  Object.keys(JA.SITES).forEach(function (site) {      // every planet
    ['cadet', 'commander', 'veteran'].forEach(function (level) {
      [0, 1, 2].forEach(function (opt) {
        for (var seed = 1; seed <= 8; seed++) {
          var pick = {};
          Object.keys(JA.CRISES).forEach(function (id) { pick[id] = JA.CRISES[id].options[opt].id; });
          total++;
          try {
            var r = H.run(site, level, seed * 7919 + opt, { gap: 8, science: true, pick: pick });
            if (r.s.over && r.s.over.type === 'win') won++; else { var k = site + '/' + level; lost[k] = (lost[k] || 0) + 1; }
          } catch (e) { errs++; console.log('ERROR', site, level, seed, e.message); }
        }
      });
    });
  });
  console.log('bot missions: ' + won + ' won of ' + total + ', errors ' + errs + ', lost by site/level ' + JSON.stringify(lost));
  ok('no mission threw an error', errs === 0);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
