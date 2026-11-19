/* Astro Outpost — crisis moments.
   A crisis is a problem with NO checklist. Mission Control cannot help in time, and there
   is more than one thing you could do. You choose, the game carries on, and the consequences show up
   later: in a minute, tonight, or tomorrow morning. Every crisis is based on something that really
   happened to a space crew or a rover; the night report tells that story.
   Numbers here are GAME scales, tuned so that every option costs something different. */
(function (JA) {
  'use strict';
  var C = JA.CRISES = {}, R = JA.RULES;

  // ---------- helpers ----------
  function later(s, d, sol, t, fn) { s.after.push({ sol: sol, t: t, fn: fn, d: d, done: false }); }
  // later today: never past the end of the shift, or it would only show up the next morning
  function inSecs(s, d, secs, fn) { later(s, d, s.sol, Math.min(s.t + secs, s.dayLength - 0.5), fn); }
  function tomorrow(s, d, fn) { if (s.sol < s.totalSols) later(s, d, s.sol + 1, 5, fn); }   // first thing next morning
  function extra(s, res, text, v) { s.today.extra.push({ res: res, text: text, v: v }); }
  function live(b) { return b.state === 'growing' || b.state === 'ripe'; }
  // The blown pump fuse and a Greenhouse breakdown are two separate faults. Either one stops the plants,
  // so mending one must not quietly mend the other.
  function glitchOn(s, id) { var g = s.glitch; return !!g && g.machine === id && (g.state === 'broken' || g.state === 'asked' || g.state === 'advised'); }
  function pumpFuse(s, blown) { s.flags.pumpFuse = blown ? s.sol : 0; s.m.food.broken = blown || glitchOn(s, 'food'); }

  // ---------- 1 · a leak ----------
  C.leak = {
    icon: '🕳️', title: 'Hiss… the habitat is leaking!', alarm: 'AIR LEAK', src: 'iss',
    text: function (s) {
      return JA.pick(s, { moon: 'A speck of space rock, smaller than a grain of sand, has just punched a tiny hole in the habitat wall.',
        mars: 'The bitter cold has cracked a seal in the habitat wall.',
        sahrun: 'Years of wind-blown sand have scoured a seal in the habitat wall until it gave way.' }) + ' You can hear air hissing out, and the air meter is falling.';
    },
    science: 'In 2018 the crew of the International Space Station found a hole just 2 millimetres wide that was letting air escape. They sealed it with glue and a cloth patch. The Station is enormous, so Mission Control even let the crew sleep first. A small habitat has far less air to spare.',
    ok: function () { return true; },
    start: function (s) { s.leak = 28; },
    options: [
      { id: 'patch', icon: '🩹', label: 'Stop everything and patch the hole', text: 'Hurry home, hunt for the hole and glue a patch over it. Today\'s other jobs will have to wait.',
        run: function (s, d) {
          s.leak = 0;
          tomorrow(s, d, function () { return { tone: 'good', text: 'Your patch held all night. Not one puff of air was lost while the crew slept.' }; });
          return { skip: 0.1, home: true, now: 'It took a long time to find the hole. It was thinner than a pencil lead! The patch is on and the hissing has stopped.' };
        } },
      { id: 'seal', icon: '🚪', label: 'Shut the hatch to the leaking room', text: 'Close the inside door so that only one room loses its air. It takes seconds.',
        run: function (s, d) {
          s.leak = 0; s.flags.pantryShut = s.sol;
          inSecs(s, d, 22, function () { return { tone: 'mixed', text: 'The room you sealed was the food store. It is airless now, so no veggie crates can go in until the crew patches the hole tonight.' }; });
          tomorrow(s, d, function () { return { tone: 'bad', text: 'With no air in the food store, a shelf of food packets swelled up and burst overnight. 9 food was ruined before the crew could patch the wall.' }; });
          return { now: 'The hatch is shut and the air meter is steady again. One room of your home is now as empty as space.' };
        } },
      { id: 'later', icon: '⏳', label: 'Keep working and fix it tonight', text: 'It is only a tiny hole. Finish today\'s jobs first.',
        run: function (s, d) {
          s.flags.leakLate = s.sol;
          inSecs(s, d, s.dayLength * 0.22, function (s2) { return { tone: 'bad', text: 'The hole is still hissing. About ' + Math.max(1, Math.round(s2.today.leaked)) + ' air has escaped through it so far today.' }; });
          tomorrow(s, d, function (s2) { return { tone: 'bad', text: 'The crew found and patched the hole in the night. In all, the leak cost about ' + (s2.flags.leakTotal || 0) + ' air. For a small habitat, that is a big bite out of a day of breathing.' }; });
          return { now: 'You turn back to your work. Behind the wall, the faint hiss goes on.' };
        } }
    ]
  };

  // ---------- 2 · stale air ----------
  C.co2 = {
    icon: '🌫️', title: 'The air filter is clogged!', alarm: 'STALE AIR', src: 'apollo',
    text: function () { return 'The filter that cleans your breath out of the air has clogged. Carbon dioxide is building up inside, so the tanks must pump out twice as much fresh air to keep everyone safe.'; },
    science: 'On Apollo 13 the air filters began to fail far from Earth. Engineers on the ground worked out how to build a new filter holder from plastic bags, cardboard, a sock and sticky tape, then read the steps to the crew over the radio. It worked, and it helped bring them home.',
    ok: function () { return true; },
    start: function (s) {
      var lost = s.filter - Math.min(s.filter, 5);
      s.stale = 2; s.filter -= lost;
      if (lost >= 0.5) extra(s, 'filter', 'The filter clogged', -Math.round(lost));
    },
    options: [
      { id: 'build', icon: '🧦', label: 'Build a new filter from spare parts', text: 'Sticky tape, a plastic bag, a sock and a spare canister. It will take a while, and it might not fit.',
        run: function (s, d) {
          var made = Math.max(s.filter, 60) - s.filter;
          s.stale = 1; s.filter += made;
          if (made >= 0.5) extra(s, 'filter', 'Home-made filter fitted', Math.round(made));
          tomorrow(s, d, function () { return { tone: 'good', text: 'Your home-made filter is still cleaning the air this morning. It is ugly, but it works!' }; });
          return { skip: 0.08, home: true, now: 'It looks ridiculous. But the carbon dioxide reading is dropping back to normal.' };
        } },
      { id: 'cell', icon: '🔋', label: 'Run the backup scrubber on a power cell', text: 'The backup machine cleans the air with electricity. It swallows a whole power cell.',
        run: function (s, d) {
          var cleaned = 100 - s.filter;
          s.stale = 1; s.filter = 100;
          if (cleaned >= 0.5) extra(s, 'filter', 'Backup scrubber cleaned the air', Math.round(cleaned));
          if (s.rack.cells > 0) s.rack.cells--; else s.rack.charge = Math.max(0, s.rack.charge - 1);
          inSecs(s, d, 25, function () { return { tone: 'mixed', text: 'The backup scrubber used up a whole power cell. That is one machine that will stay dark today.' }; });
          return { sync: true, now: 'The backup scrubber whirrs and the air clears. The Solar Rack is one power cell poorer.' };
        } },
      { id: 'flush', icon: '💨', label: 'Flush the cabin with fresh oxygen', text: 'Open the tanks wide and blow the stale air outside.',
        run: function (s, d) {
          s.stale = 1; s.air = Math.max(0, s.air - 12); extra(s, 'air', 'Oxygen used to flush the cabin', -12);
          tomorrow(s, d, function (s2) {
            // a player who baked the filter clean after the flush has really solved it
            if (s2.filter >= R.filterWarn) return { tone: 'good', text: 'You baked the filter clean after the flush, so the stale air never came back.' };
            var fitted = Math.max(s2.filter, 60) - s2.filter;
            s2.air = Math.max(0, s2.air - 8); extra(s2, 'air', 'Second flush: the filter was still clogged', -8);
            s2.filter += fitted; if (fitted >= 0.5) extra(s2, 'filter', 'The crew fitted a new filter', Math.round(fitted));
            return { tone: 'bad', text: 'The filter was still clogged, so the stale air came back overnight. The cabin had to be flushed again: 8 more air gone before the crew could mend it.' };
          });
          return { now: 'Whoosh! Everyone can breathe easily again. The air meter took a hit, and the clogged filter is still clogged.' };
        } }
    ]
  };

  // ---------- 3 · mould in the greenhouse ----------
  C.mold = {
    icon: '🍄', title: 'Fuzzy white spots on the plants!', alarm: 'SICK PLANTS', src: 'iss',
    text: function () { return 'The Greenhouse air is too damp, and a fuzzy white mould is growing on one bed of plants. Mould spreads from leaf to leaf.'; },
    science: 'In 2015 mould grew on zinnia flowers in the Space Station\'s garden. Astronaut Scott Kelly cut off the mouldy leaves, turned the fans up to dry the air, and chose for himself when to water instead of waiting for instructions. The flowers survived and bloomed.',
    ok: function (s) { return s.m.food.beds.filter(live).length >= 2; },
    start: function (s) { var beds = s.m.food.beds; for (var i = 0; i < beds.length; i++) if (live(beds[i])) { s.flags.moldBed = i; break; } },
    spread: function (s) {
      var beds = s.m.food.beds, sick = beds[s.flags.moldBed];
      if (sick) { sick.state = 'empty'; sick.g = 0; }
      beds.forEach(function (b) { if (live(b)) { b.state = 'growing'; b.g *= 0.45; } });
    },
    options: [
      { id: 'cut', icon: '✂️', label: 'Pull out the sick plants', text: 'Dig up the whole bed that has mould on it and throw it away.',
        run: function (s, d) {
          var b = s.m.food.beds[s.flags.moldBed]; if (b) { b.state = 'empty'; b.g = 0; }
          tomorrow(s, d, function () { return { tone: 'good', text: 'No more mould. The other beds are green and healthy. One bed had to start again from seeds.' }; });
          return { now: 'The sick bed is bare soil again. The rest of the garden looks clean.' };
        } },
      { id: 'fans', icon: '🌀', label: 'Turn the fans up to dry the air', text: 'Mould loves damp air. The fans run on the Greenhouse\'s lamp power.',
        run: function (s, d) {
          var f = s.m.food;
          if (f.lamp > 0.25 && !f.broken) {
            f.lamp = Math.max(0.02, f.lamp - 0.35);
            tomorrow(s, d, function () { return { tone: 'good', text: 'The air dried out and the mould stopped growing. Every bed survived. The fans used up about a third of a power cell of lamp light.' }; });
            return { now: 'The fans roar. The leaves tremble in the dry breeze, and the grow lamps dim a little.' };
          }
          tomorrow(s, d, function (s2) { C.mold.spread(s2); return { tone: 'bad', text: 'With no power the fans never turned, and the mould spread to every bed overnight. One bed is dead and the others lost more than half their growth.' }; });
          return { now: 'You flip the switch. Nothing happens. The Greenhouse has no power, so the fans cannot spin!' };
        } },
      { id: 'wait', icon: '👀', label: 'Leave it and keep an eye on it', text: 'Maybe it will go away on its own.',
        run: function (s, d) {
          tomorrow(s, d, function (s2) { C.mold.spread(s2); return { tone: 'bad', text: 'The mould spread to every bed overnight. One bed is dead and the others lost more than half their growth.' }; });
          return { now: 'You leave the plants alone. The fuzzy patch looks a tiny bit bigger than before.' };
        } }
    ]
  };

  // ---------- 4 · only one heater ----------
  var WARM = { air: 'Air Maker', food: 'Greenhouse', lab: 'Science Lab' };
  function coldOption(id, icon, text) {
    return { id: id, icon: icon, label: 'Keep the ' + WARM[id] + ' warm', text: text,
      run: function (s, d) {
        tomorrow(s, d, function (s2) {
          var out = ['The ' + WARM[id] + ' stayed warm and came through the night perfectly.'], m = s2.m;
          if (id !== 'air') out.push('The Air Maker froze solid: a valve has jammed and must be repaired before it can make any air.');
          if (id !== 'food') {
            m.food.beds.forEach(function (b) { if (live(b)) { b.state = 'growing'; b.g *= 0.5; } });
            var froze = s2.water - Math.min(s2.water, 8);
            s2.water -= froze; if (froze >= 0.5) extra(s2, 'water', 'Froze solid in the night', -Math.round(froze));
            out.push('Frost got into the Greenhouse: the plants lost half their growth and most of the water tank froze solid.');
          }
          if (id !== 'lab') {
            var n = m.lab.queue.length;
            m.lab.power = 0; m.lab.queue.forEach(function (c) { c.quality = 0; });
            out.push('The Science Lab froze: its battery is flat' + (n ? ' and the ' + n + ' waiting rock core' + (n > 1 ? 's' : '') + ' cracked, so they will only make rough samples.' : '.'));
          }
          return { tone: 'mixed', text: out.join(' ') };
        });
        if (id !== 'air') s.flags.freezeAir = s.sol + 1;
        return { now: 'The ' + WARM[id] + ' heater glows orange. One by one, the lights on the other machines go dark.' };
      } };
  }
  C.cold = {
    icon: '🥶', title: 'Battery fault! A freezing night is coming', alarm: 'POWER FAULT', at: [0.66, 0.76],
    src: function (s) { return JA.pick(s, { moon: 'moon', mars: 'mer', sahrun: 'mer' }); },
    text: function (s) {
      return 'A battery pack has just failed. Tonight there is only enough stored power to keep ONE machine warm. ' +
        JA.pick(s, { moon: 'In the dark, the Moon\'s surface drops to about −133°C.', mars: 'Nights on Mars fall far below −70°C.',
          sahrun: 'The desert is scorching by day, but dry air holds no heat: tonight the sand will fall far below freezing.' }) + ' Anything left unheated will freeze.';
    },
    science: function (s) {
      return JA.pick(s, { moon: 'Away from sunlight the Moon\'s surface falls to about −133°C. Landers and rovers on the Moon carry heaters, and mission teams must decide which parts to keep warm when power runs low.',
        mars: 'In 2010 the Spirit rover could not tilt its solar panels toward the low winter Sun on Mars. Without enough power for its heaters it grew too cold, and it never called home again.',
        sahrun: 'Real deserts can be blazing at noon and freezing before dawn, because dry air holds very little heat. On Mars in 2010, the Spirit rover ran too low on power to keep its heaters on through the cold, and it never called home again.' });
    },
    ok: function (s) { return s.sol < s.totalSols; },
    options: [
      coldOption('air', '💨', 'Its valves and water pipes stay above freezing.'),
      coldOption('food', '🥬', 'The plants and their water tank stay above freezing.'),
      coldOption('lab', '🔬', 'The rock cores and the Lab\'s delicate parts stay above freezing.')
    ]
  };

  // ---------- 5 · one spare fuse ----------
  C.fuse = {
    icon: '⚡', title: 'Power surge! Two machines down, one spare fuse', alarm: 'POWER SURGE', src: 'apollo',
    text: function () { return 'A power surge has blown the fuses in the Radio Dish AND the Greenhouse water pump. The toolbox holds exactly one spare fuse.'; },
    science: 'When Apollo 13 lost most of its power, the crew switched off almost everything and kept only the systems they needed to stay alive. Deciding what matters most is a real astronaut skill. And a fuse is a safety part: it is built to melt before the wires do.',
    ok: function () { return true; },
    start: function (s) { var m = s.m; s.flags.dishWasOn = m.comms.on; m.comms.broken = true; m.comms.on = false; pumpFuse(s, true); },
    options: [
      { id: 'radio', icon: '📡', label: 'Put the fuse in the Radio Dish', text: function (s) { return JA.homeName(s, true) + ' can reach you again. The Greenhouse pump stays off.'; },
        run: function (s, d) {
          s.m.comms.broken = false; s.m.comms.on = !!s.flags.dishWasOn;
          inSecs(s, d, 35, function () { return { tone: 'mixed', text: 'The Greenhouse pump is silent. Until the crew makes a new fuse tonight, the plants cannot drink, so they have stopped growing.' }; });
          return { now: 'The Radio Dish hums back to life' + (s.flags.dishWasOn ? '.' : ', ready for a power cell.') + ' The Greenhouse pump stays dead.' };
        } },
      { id: 'pump', icon: '💧', label: 'Put the fuse in the Greenhouse pump', text: 'The plants keep drinking. The Radio Dish stays off.',
        run: function (s, d) {
          pumpFuse(s, false);
          inSecs(s, d, 35, function () { return { tone: 'mixed', text: 'The Radio Dish is dark. There will be no forecast tonight, only a few seconds of warning if a solar storm comes, and ' + JA.homeName(s) + ' cannot help with repairs today.' }; });
          return { now: 'Water gurgles through the Greenhouse pipes again. The Radio Dish stays dead.' };
        } },
      { id: 'foil', icon: '🧻', label: 'Make a second fuse out of kitchen foil', text: 'Wrap foil where the missing fuse should go. Then both machines can run.',
        run: function (s, d) {
          var m = s.m;
          m.comms.broken = false; m.comms.on = !!s.flags.dishWasOn; pumpFuse(s, false);
          inSecs(s, d, 45, function (s2) {
            var m2 = s2.m;
            m2.comms.broken = true; m2.comms.on = false; pumpFuse(s2, true); s2.rack.charge = Math.max(0, s2.rack.charge - 1);
            return { tone: 'bad', spark: true, text: 'A real fuse melts to protect the wires. The foil did not, so the wires overheated instead. Both machines are dead until tonight, and the Solar Rack lost a whole cell of charge.' };
          });
          return { now: 'Both machines hum back to life. The foil is getting warm…' };
        } }
    ]
  };

  // ---------- 6 · the rover is stuck ----------
  C.stuck = {
    icon: '🚙', title: 'The rover is sinking in soft sand!', alarm: 'ROVER STUCK', src: 'mer', patience: 0.3,
    text: function () { return 'The ground looked solid, but the wheels have broken through a thin crust into soft, powdery soil. They are spinning, and the rover is sinking.'; },
    science: 'In 2009 NASA\'s Spirit rover broke through a crust into soft soil on Mars. Engineers on Earth built a sandbox and tested careful moves for months to try to free it. Spinning the wheels hard only dug them in deeper.',
    ok: function (s, ctx) { return !!ctx.driving; },
    options: [
      { id: 'gun', icon: '🔥', label: 'Full power! Blast out of it', text: 'Push the throttle all the way and hope the wheels grab.',
        run: function (s, d) {
          s.m.rover.charge = 0; s.m.rover.stuck = true;
          inSecs(s, d, 12, function () { return { tone: 'bad', text: 'The rover will not move again today. Everything you need now, you carry on foot.' }; });
          tomorrow(s, d, function () { return { tone: 'mixed', text: 'The crew spent the whole evening digging the rover out. It is free again, with a flat battery.' }; });
          return { now: 'The wheels spin faster and dig deeper. The rover is buried up to its axles and the battery is flat.' };
        } },
      { id: 'rock', icon: '↔️', label: 'Rock gently back and forth', text: 'Tiny moves, forward and back, to pack the sand down under the wheels.',
        run: function (s, d) {
          s.m.rover.charge = Math.max(0, s.m.rover.charge - 40);
          inSecs(s, d, 12, function () { return { tone: 'good', text: 'The rover is free. All that careful rocking used about 40 seconds of battery.' }; });
          return { now: 'Forward a little. Back a little. Again. Slowly the wheels climb onto firmer ground.' };
        } },
      { id: 'dig', icon: '⛏️', label: 'Climb out and dig the wheels free', text: 'Scoop the sand away by hand and wedge flat rocks under the wheels.',
        run: function (s, d) {
          s.air = Math.max(0, s.air - 6); extra(s, 'air', 'Hard digging in the spacesuit', -6);
          inSecs(s, d, 12, function () { return { tone: 'good', text: 'The rover is free and its battery is untouched. All that digging in a stiff spacesuit made you breathe 6 extra air.' }; });
          return { now: 'Digging in a spacesuit is exhausting. You are puffing hard, but the wheels have grip again.' };
        } }
    ]
  };

  // =====================================================================
  //  scheduling and bookkeeping (called from sim.js)
  // =====================================================================
  function plan(s) {
    s.crisisPool = Object.keys(C);
    s.level.crisisSols.forEach(function (sol) {
      var id = s.crisisPool.splice(Math.floor(s.rng() * s.crisisPool.length), 1)[0];
      s.crisisPlan[sol] = { id: id, at: 0.24 + s.rng() * 0.3 };
    });
  }
  function startSol(s) {
    var prev = s.crisis, D = s.dayLength, d;
    // a crisis that never opened (the crew went to bed first, or a storm was in the way) waits for the next free day
    if (prev && prev.state === 'pending') {
      for (d = s.sol; d <= s.totalSols; d++) if (!s.crisisPlan[d]) { s.crisisPlan[d] = { id: prev.id, at: 0.24 + s.rng() * 0.3 }; break; }
    }
    var p = s.crisisPlan[s.sol];
    s.crisis = null;
    if (p) {
      var def = C[p.id], at = (def.at ? def.at[0] + s.rng() * (def.at[1] - def.at[0]) : p.at) * D;
      s.crisis = { id: p.id, at: at, until: at + (def.patience || 0.1) * D, state: 'pending' };
    }
    // the Air Maker froze last night: it starts the day broken
    if (s.flags.freezeAir === s.sol) s.glitch = { machine: 'air', at: 0, state: 'pending', replyAt: 0, misses: 0, asked: false };
  }
  function open(s, c, ev) {
    var def = C[c.id];
    c.state = 'open';
    if (def.start) def.start(s);
    ev.push({ type: 'crisis', id: c.id });
  }
  function tick(s, ctx, ev) {
    var c = s.crisis, i;
    if (c && c.state === 'pending' && s.t >= c.at && !s.sleeping) {
      var ph = JA.sim.stormPhase(s);
      if (ph !== 'warning' && ph !== 'active') {
        if (C[c.id].ok(s, ctx)) open(s, c, ev);
        else if (s.t >= c.until) {
          var alt = s.crisisPool.filter(function (id) { return !C[id].at && C[id].ok(s, ctx); })[0];
          if (alt) { s.crisisPool.splice(s.crisisPool.indexOf(alt), 1); c.id = alt; open(s, c, ev); }
          else c.state = 'skipped';
        }
      }
    }
    for (i = 0; i < s.after.length; i++) {
      var a = s.after[i];
      if (a.done || a.sol > s.sol || (a.sol === s.sol && s.t < a.t)) continue;
      a.done = true;
      var r = a.fn(s);
      if (r) { r.sol = s.sol; a.d.later.push(r); ev.push({ type: 'consequence', res: r, d: a.d }); }
    }
  }
  function view(s) {
    var c = s.crisis; if (!c || c.state !== 'open') return null;
    var def = C[c.id];
    return { id: c.id, icon: def.icon, title: def.title, alarm: def.alarm, text: def.text(s),
      options: def.options.map(function (o) { return { id: o.id, icon: o.icon, label: o.label, text: typeof o.text === 'function' ? o.text(s) : o.text }; }) };      // a text may depend on the planet
  }
  function choose(s, optId) {
    var c = s.crisis; if (!c || c.state !== 'open') return null;
    var def = C[c.id], opt = def.options.filter(function (o) { return o.id === optId; })[0];
    if (!opt) return null;
    var d = { sol: s.sol, id: c.id, icon: def.icon, title: def.title, opt: opt.id, optIcon: opt.icon, label: opt.label, now: '', later: [],
      science: typeof def.science === 'function' ? def.science(s) : def.science, src: typeof def.src === 'function' ? def.src(s) : def.src };
    var r = opt.run(s, d) || {};
    d.now = r.now || '';
    c.state = 'done';
    s.decisions.push(d);
    return { d: d, skip: r.skip || 0, home: !!r.home, sync: !!r.sync };
  }
  // things that happen while the crew sleeps
  function night(s) {
    var f = s.flags;
    if (f.pantryShut === s.sol) { s.food -= 9; extra(s, 'food', 'Food ruined in the airless room', -9); }
    if (f.leakLate === s.sol) {
      s.air = Math.max(0, s.air - 5); extra(s, 'air', 'Lost while the crew hunted for the hole', -5);
      f.leakTotal = Math.round(s.today.leaked + 5);
    }
  }

  JA.crisis = { plan: plan, startSol: startSol, tick: tick, view: view, choose: choose, night: night };
})(window.JA);
