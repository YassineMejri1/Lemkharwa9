/* Astro Outpost — reference missions for the Godot port.
   The web rules (js/sim.js, js/crisis.js, js/spaceweather.js) play a set of robot missions with tools/tests/harness.js;
   their day-by-day logs and final numbers are written to godot/tests/reference_runs.json. The Godot test
   (godot/tests/test_rules.gd) plays the same missions with the GDScript rules and must get exactly the same results.
   Run from the repository root:  node tools/godot/rules_reference.js */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('../tests/harness.js');
const JA = H.JA, sim = H.sim;

const runs = [];
const r2 = (v) => Math.round(v * 100) / 100;
['moon', 'mars'].forEach((site) => {
  ['cadet', 'commander', 'veteran'].forEach((level) => {
    [0, 1, 2].forEach((opt) => {
      for (let seed = 1; seed <= 4; seed++) {
        const pick = {};
        Object.keys(JA.CRISES).forEach((id) => { pick[id] = JA.CRISES[id].options[opt].id; });
        const realSeed = seed * 7919 + opt;
        const r = H.run(site, level, realSeed, { gap: 8, science: true, pick: pick });
        const s = r.s;
        runs.push({
          site, level, seed: realSeed, opt,
          log: r.log,
          over: s.over,
          end: { sol: s.sol, air: r2(s.air), food: r2(s.food), dose: r2(s.dose), water: r2(s.water), filter: r2(s.filter), bags: s.bags,
            finds: s.finds.map((f) => f.key), decisions: s.decisions.map((d) => d.id + '.' + d.opt + ':' + d.later.length),
            weather: s.weather.map((w) => w.date + ':' + w.level), env: s.env.map((e) => e.kind), stats: s.stats,
            badges: sim.badges(s).map((b) => b.name), devil: s.devil ? s.devil.sol + '@' + r2(s.devil.at) : null }
        });
      }
    });
  });
});
const out = path.resolve(__dirname, '../../godot/tests/reference_runs.json');
fs.writeFileSync(out, JSON.stringify(runs, null, 0));
const won = runs.filter((r) => r.over && r.over.type === 'win').length;
console.log('Wrote ' + runs.length + ' reference missions (' + won + ' won) to ' + out);
