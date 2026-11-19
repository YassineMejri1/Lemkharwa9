/* Astro Outpost — mission rules (no graphics here, so they are easy to read and test).
   The 3D game calls these functions when the astronaut physically does something:
   plugs in a power cell, drops ice in a hopper, throws a soil bag on the dome... */
(function (JA) {
  'use strict';
  var R = JA.RULES;

  function rng32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function no(msg) { return { ok: false, msg: msg }; }
  var OK = { ok: true };

  function makeEnv(site, level, rng) {
    var n = level.sols, wk = site.weatherKinds, kinds = [];
    var calm = wk.calm, mid = wk.mid, bad = wk.bad;
    for (var i = 0; i < n; i++) kinds.push(calm);
    // one spell of bad weather early on, and more of them on longer missions
    var bads = [3 + Math.floor(rng() * 2)];
    if (n >= 8) bads.push(6 + Math.floor(rng() * 2));
    if (n >= 10) bads.push(9);
    if (wk.dark && n >= 8) bads[1] = 7;       // with a long dark (the Moon) the second spell is the dark day, the day after the "Sun chaser" lesson
    bads.forEach(function (b) {
      if (kinds[b - 2] === calm) kinds[b - 2] = mid;
      kinds[b - 1] = bad;
      if (b < n && kinds[b] === calm) kinds[b] = mid;
    });
    if (wk.dark && n >= 8) kinds[bads[1] - 1] = wk.dark;       // the long dark: a mountain hides the Sun all day
    return kinds.map(function (k) {
      var e = { kind: k, cells: site.env[k].cells + level.cellBonus }, w = site.env[k];
      if (w.heat) e.heat = w.heat;                 // a hot day: the crew sweats and drinks more (Sahrun)
      if (w.dew != null) e.dew = w.dew;            // how much dew the night after brings (a planet with a dew catcher)
      return e;
    });
  }

  // ---------- every day is a little harder than the one before ----------
  // The outpost wears down the longer you stay: the crew works harder (more air, more food),
  // the panels and tools wear out. k is the level's "ramp". All GAME scales.
  function dayMods(s, sol) {
    var d = Math.max(0, (sol || s.sol) - 1), k = s.level.ramp;
    return {
      breath: 1 + 0.035 * d * k,
      dinner: Math.round(0.6 * d * k),
      cells: -Math.min(1.5, 0.13 * d * k),
      dust: 1 + 0.1 * d * k,
      heat: 1 + 0.04 * d * k,
      dial: 1 + 0.05 * d * k,
      recycle: Math.max(R.recycleMin, R.recycle - 0.012 * d * k)      // share of the crew's water the recycler gives back
    };
  }
  function airDrain(s) { return s.level.airDrain * s.mods.breath * (1 + townLoad(s)); }
  // What dinner will cost tonight. Dried space food needs water, so with an empty tank the crew opens extra ready-made packs.
  function dryDinner(s) { return s.water < 1 ? R.dryDinner : 0; }
  function dinner(s) { return s.level.dinner + s.mods.dinner + dryDinner(s) + ((s.colony && s.colony.asks) || 0); }
  function dayInfo(s, sol) {
    sol = sol || s.sol;
    var d = sol >= s.totalSols ? JA.LAUNCH_DAY : JA.DAYS[Math.min(sol, JA.DAYS.length) - 1], id = s.site.id;
    return { key: sol >= s.totalSols ? 'launch' : String(Math.min(sol, JA.DAYS.length) - 1),      // its page in the Field Journal
      icon: d.icon, title: d.title, topic: d.topic, goal: d.goal ? Object.assign({}, d.goal, { text: JA.siteText(d.goal.text, id) }) : null,
      learn: JA.siteText(d.learn, id), src: JA.siteText(d.src, id) };
  }
  // What got harder since yesterday, in words a player can check against the meters.
  function harderList(s, sol) {
    sol = sol || s.sol;
    if (sol <= 1) return [];
    var a = dayMods(s, sol - 1), b = dayMods(s, sol), out = [], L = s.level;
    var air0 = Math.round(L.airDrain * a.breath), air1 = Math.round(L.airDrain * b.breath);
    if (air1 > air0) out.push({ icon: '💨', text: 'The crew is working harder: breathing uses ' + air1 + ' air today (yesterday ' + air0 + ').' });
    if (b.dinner > a.dinner && sol < s.totalSols) out.push({ icon: '🥬', text: 'Bigger appetites: dinner now takes ' + (L.dinner + b.dinner) + ' food.' });
    if (b.cells < a.cells) out.push({ icon: '🔋', text: 'The solar panels are wearing out: a little less power than the same weather gave before.' });
    out.push({ icon: '🔧', text: 'Tools are wearing too: the drill heats up faster and repairs need a steadier hand.' });
    var r0 = Math.round(a.recycle * 100), r1b = Math.round(b.recycle * 100);
    if (r1b < r0) out.push({ icon: '💧', text: 'The water recycler\'s filters are wearing: it gives back ' + r1b + '% of the crew\'s water now (yesterday ' + r0 + '%).' });
    if (L.glitchSols.indexOf(sol) >= 0 && L.glitchSols.indexOf(sol - 1) < 0) out.push({ icon: '⚙️', text: 'The machines are tired. Something may break today.' });
    return out;
  }

  function newGame(opts) {
    var site = JA.SITES[opts.site], level = JA.LEVELS[opts.level];
    var seed = opts.seed || Math.floor(Math.random() * 1e9), rng = rng32(seed);
    var wx = site.spaceWeather === 'star' && opts.weather.source !== 'star' ? JA.weather.star(site.id, seed, opts.weather.source === 'archive') : opts.weather;
    var s = {
      seed: seed, rng: rng, site: site, level: level, dayLength: opts.dayLength || R.dayLength,
      weatherSource: wx.source, weatherFallback: !!wx.fallback,
      weather: JA.weather.pickWindow(wx, level.sols, level.id, rng, site.id),
      env: makeEnv(site, level, rng),
      sol: 0, totalSols: level.sols, t: 0,
      air: level.id === 'cadet' ? 50 : 60, food: level.id === 'cadet' ? 28 : 45, dose: 0, bags: 0,
      filter: 100,                                  // how clean the CO2 filter is (100 = fresh, 0 = full)
      water: level.id === 'cadet' ? 35 : 25,        // the water tank, shared by the crew and the plants
      sow: 'lettuce',                               // the kind of seed in your pocket (see JA.CROPS)
      wear: { drill: 0, rover: 0, scar: 0 },        // damage from rough handling and from solar storms
      seen: {}, whyQ: [], whyAt: 0,                 // "why did that happen?" notes: which ones came up, and which wait to be shown
      rack: { charge: 0, cells: 0, eff: [1, 1, 1], broken: false },
      m: {
        air: { power: 0, queue: 0, prog: 0, broken: false },
        food: { lamp: 0, water: 0, broken: false, beds: [] },
        bag: { pending: 0, timer: 0, broken: false },
        lab: { power: 0, queue: [], prog: 0, broken: false },
        comms: { on: false, broken: false },
        rover: { charge: 60, stuck: false }
      },
      cores: [0, 0, 0, 0], finds: [], inst: {}, photos: {}, caseLoaded: false,
      colony: { days: 0, stage: 0, people: 0, spirit: R.spiritStart, arrive: 0, gifts: [] },      // the town beside the outpost
      pioneer: !!opts.pioneer, mats: { rock: 0, metal: 0, glass: 0 }, built: {}, broken: {},      // Pioneer mode: your bag, what you built, which rocks are gone
      stats: { storms: 0, stormOut: 0, cells: 0, ice: 0, crates: 0, cores: 0, repairs: 0, tricks: 0, bestThrow: 0, drive: 0, dayGoals: 0, sprint: 0, baked: 0 },
      glitchPlan: {}, crisisPlan: {}, crisis: null, decisions: [], after: [], flags: {}, leak: 0, stale: 1,
      forecast: true, night: false, over: null, log: [], seenFacts: {},
      perks: {}                                     // what the science taught the crew (see discover and JA.GEO perk)
    };
    for (var i = 0; i < R.beds; i++) s.m.food.beds.push({ state: i < R.seedlings ? 'growing' : 'empty', g: i < R.seedlings ? R.seedlingGrowth : 0, crop: 'lettuce' });
    s.food += R.extraFood;
    s.darkSol = 0;
    s.env.forEach(function (e, k) { if (e.kind === 'dark') s.darkSol = k + 1; });
    var pool = [];
    level.glitchSols.forEach(function (sol) {
      if (!pool.length) pool = ['air', 'food', 'lab', 'rack'];
      s.glitchPlan[sol] = { machine: pool.splice(Math.floor(rng() * pool.length), 1)[0], at: 0.2 + rng() * 0.28 };
    });
    if (s.pioneer) {                              // the hard start: fewer supplies, and the land has to make up for it
      s.air -= R.pioneerAir; s.food -= R.pioneerFood; s.water = Math.max(12, s.water - R.pioneerWater);
    }
    if (site.dew) s.dew = 0;                      // water in the dew catcher's can (a planet with a dew catcher)
    if (JA.crisis) JA.crisis.plan(s);
    s.devil = planDevil(site, level, seed);
    startSol(s);
    return s;
  }

  // At most one lucky dust devil per mission on a dusty planet (Mars) crosses the solar panels (never on the first or the last day).
  // It has its own random stream, so it does not shift the breakdowns and crises planned from the same seed.
  function planDevil(site, level, seed) {
    if (!site.dusty || level.sols < 4) return null;
    var r = rng32((seed ^ 0x5eed0de1) >>> 0);
    if (r() >= R.devilChance) return null;
    return { sol: 2 + Math.floor(r() * (level.sols - 2)), at: 0.3 + r() * 0.4, state: 'pending', gain: 0 };
  }
  // The devil blows part of the dust off every panel. Returns how much power came back, on average (0–1).
  function devilClean(s) {
    var before = 0, after = 0;
    for (var i = 0; i < s.rack.eff.length; i++) { before += s.rack.eff[i]; s.rack.eff[i] = Math.min(1, s.rack.eff[i] + R.devilClean); after += s.rack.eff[i]; }
    return (after - before) / s.rack.eff.length;
  }

  function startSol(s) {
    s.sol++; s.t = 0; s.night = false; s.dayDone = false;
    var env = s.env[s.sol - 1];
    s.mods = dayMods(s);
    townMorning(s);
    s.cellsToday = Math.max(1, Math.max(env.kind === 'dark' ? 1 : 2.5, env.cells + s.mods.cells) - (s.pioneer ? R.pioneerCells : 0)) + extraCells(s, env.kind);
    s.effDecay = { clear: 0.25, dusty: 0.5, storm: 0.9, sun: 0.4, lowsun: 0.4, shadow: 0.4, dark: 0.4 }[env.kind] * s.mods.dust;
    s.rack.charge += Math.min(R.morningCells, s.cellsToday); s.rack.broken = false;
    s.m.comms.on = false; s.m.comms.broken = false; s.m.air.broken = s.m.food.broken = s.m.lab.broken = false;
    s.m.rover.stuck = false; s.leak = 0; s.stale = 1;
    var w = s.weather[s.sol - 1];
    s.storm = null;
    if (w && w.level > 0) {
      var start = s.dayLength * (0.3 + s.rng() * 0.36);
      s.storm = { start: start, end: start + R.stormDuration, level: w.level, cls: w.cls, cause: w.cause || 'sep', warned: false, active: false, over: false,
        strength: w.strength * 3 * s.site.stormMult * s.level.stormScale };
      s.stats.storms++;
    }
    var gp = s.glitchPlan[s.sol];
    s.glitch = gp ? { machine: gp.machine, at: gp.at * s.dayLength, state: 'pending', replyAt: 0, misses: 0, asked: false } : null;
    s.today = { breath: 0, airMade: 0, ice: 0, crates: 0, doseBase: 0, doseStorm: 0, science: 0, cells: {}, bags: 0, late: false, repair: null,
      panels: {}, dishEarly: false, leaked: 0, goalDone: false, extra: [],
      cratesFood: 0, staleAir: 0, filterUsed: 0, baked: 0, water: { ice: 0, crew: 0, back: 0, plants: 0 }, noWater: 0,
      stormOut: 0, dryBeds: 0, darkBeds: 0, fullT: 0, scar: 0, whys: [],
      bagRoom: R.shieldSlots - s.bags, coreRoom: s.cores.length * 2 - s.finds.filter(function (f) { return f.kind === 'core'; }).length };
    s.day = dayInfo(s);
    s.morning = { air: s.air, food: s.food, dose: s.dose, water: s.water, filter: s.filter };
    s.whyQ = []; s.whyAt = 14;                    // yesterday's unshown notes are in the night report already
    // the dew catcher: dew forms on the night before, and a clear, still night gives the most (a sandstorm gives none)
    if (s.site.dew && s.sol > 1) {
      var night = R.dewWater * (s.env[s.sol - 2].dew || 0);
      s.today.dewNight = night;
      if (night > 0) s.dew = Math.min(R.dewWater, (s.dew || 0) + night);
    }
    if (env.heat > 1 && s.sol > 1) note(s, 'heat');          // not on day 1: that day has enough to learn
    if (s.colony.fresh) { s.colony.fresh = false; note(s, 'town'); }
    if (s.darkSol > s.sol && s.darkSol - s.sol <= 2) note(s, 'longdark');
    if (JA.crisis) JA.crisis.startSol(s);
  }

  // Has today's challenge been met? (checked every tick; pays out once)
  // How many the challenge really asks for. It never asks for more than is left to do: a player who
  // covered the dome or studied the cores early must not lose the challenge for working ahead.
  function goalNeed(s) {
    var g = s.day.goal, t = s.today; if (!g || !g.n) return 0;
    if (g.id === 'bags') return Math.max(0, Math.min(g.n, t.bagRoom));
    if (g.id === 'cores') return Math.max(0, Math.min(g.n, t.coreRoom));
    return g.n;
  }
  function dayGoalDone(s) {
    var g = s.day.goal, t = s.today; if (!g) return false;
    if (g.id === 'bags') return t.bags >= goalNeed(s);
    if (g.id === 'cores') return s.finds.filter(function (f) { return f.kind === 'core' && f.sol === s.sol; }).length >= goalNeed(s);
    if (g.id === 'dish') return t.dishEarly;
    if (g.id === 'crates') return t.crates >= g.n;
    if (g.id === 'panels') return Object.keys(t.panels).length >= g.n;
    if (g.id === 'inst') return !!(s.inst.seismo && s.inst.beam && s.inst.rad);
    if (g.id === 'ice') return t.ice >= g.n;
    if (g.id === 'studied') return s.finds.filter(function (f) { return f.kind === 'core'; }).length >= g.n;
    return false;
  }
  function dayGoalProgress(s) {
    var g = s.day.goal, t = s.today; if (!g || !g.n) return '';
    var v = g.id === 'bags' ? t.bags : g.id === 'cores' ? s.finds.filter(function (f) { return f.kind === 'core' && f.sol === s.sol; }).length
      : g.id === 'crates' ? t.crates : g.id === 'panels' ? Object.keys(t.panels).length
      : g.id === 'inst' ? Object.keys(s.inst).length : g.id === 'ice' ? t.ice : s.finds.filter(function (f) { return f.kind === 'core'; }).length;
    var need = goalNeed(s);
    return ' (' + Math.min(v, need) + '/' + need + ')';
  }

  // The player changed how long a working day lasts. Keep the same point in the day.
  function setDayLength(s, D2) {
    var D = s.dayLength; if (D2 === D) return;
    var t2 = s.t / D * D2, shift = t2 - s.t, st = s.storm, g = s.glitch, c = s.crisis;
    if (st && !st.over) {
      if (st.warned) { st.start += shift; st.end += shift; }
      else { st.start = st.start / D * D2; st.end = st.start + R.stormDuration; }
    }
    if (g) { if (g.state === 'pending') g.at = g.at / D * D2; g.replyAt += shift; }
    if (c && c.state === 'pending') { c.at = c.at / D * D2; c.until = c.until / D * D2; }
    s.after.forEach(function (a) { if (a.sol === s.sol && !a.done) a.t = Math.min(a.t + shift, D2 - 0.5); });
    s.whyAt += shift;
    s.t = t2; s.dayLength = D2;
  }

  function env(s) { return s.env[s.sol - 1]; }
  function weather(s) { return s.weather[s.sol - 1] || { level: 0, cls: null, date: null }; }
  // what the science taught: each perk is unlocked by the first core studied at one geology site (JA.GEO)
  function perk(s, kind) { return !!(s.perks && s.perks[kind]); }
  function airPerIce(s) { return R.airPerIce + (perk(s, 'air') ? R.perkAir : 0); }
  function waterPerIce(s) { return R.waterPerIce + (perk(s, 'water') ? R.perkWater : 0); }
  function bagBlock(s) { return R.bagBlock + (perk(s, 'bags') ? R.perkBag : 0); }
  function drillHeat(s) { return perk(s, 'drill') ? R.perkDrill : 1; }
  function shield(s) { return Math.min(0.9, R.wallBlock + s.bags * bagBlock(s) + 0.05 * built(s, 'berm')); }
  // Seconds of warning before a storm. Dish on: Earth's forecasters warn you. Dish off: only the suit sensor, as the
  // particles arrive. The Radiation Watcher, once set up, catches the first and fastest particles a little sooner.
  function warnLead(s) { return Math.max(0, (s.m.comms.on ? R.warnDish : R.warnNoDish) + (s.inst.rad ? R.radWarn : 0) + s.level.warnBonus); }
  function stormPhase(s) {
    var st = s.storm; if (!st) return 'none';
    if (st.over) return 'over'; if (st.active) return 'active'; if (st.warned) return 'warning';
    return 'none';
  }
  function machine(s, id) { return id === 'rack' ? s.rack : s.m[id]; }
  // ---------- Pioneer mode: break rocks, keep the pieces, build ----------
  function built(s, id) { return (s.built && s.built[id]) || 0; }
  function rackMax(s) { return R.rackMax + 2 * built(s, 'battery'); }
  function waterCap(s) { return 100 + 50 * built(s, 'cistern'); }
  // Power cells a day from what you built and from the town's spare solar array.
  function extraCells(s, kind) {
    var n = 0.7 * built(s, 'panel');
    if (built(s, 'turbine') && (kind === 'dusty' || kind === 'storm')) n += 1.2;
    if (built(s, 'mirror')) n += kind === 'dark' ? 1.5 : kind === 'shadow' || kind === 'lowsun' ? 1 : 0;
    if (s.colony && s.colony.stage >= 1) n += 1;
    return n;
  }
  // What one boulder gives when it is broken up. The same boulder always gives the same on one mission.
  function rockYield(s, k, r) {
    var h = Math.abs(Math.sin(((s.seed || 1) % 997 + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453) % 1, metalOdds = JA.pick(s, { moon: 0.4, mars: 0.5, sahrun: 0.45 });
    return { rock: 2 + Math.round(Math.min(3, r || 1)), metal: h < metalOdds ? (h < 0.15 ? 2 : 1) : 0, glass: h > 0.55 ? (h > 0.88 ? 2 : 1) : 0 };
  }
  function breakRock(s, k) { if (s.broken[k]) return false; s.broken[k] = 1; s.stats.rocks = (s.stats.rocks || 0) + 1; note(s, 'isru'); return true; }
  function addMat(s, kind, n) { if (!JA.MATS[kind]) return 0; s.mats[kind] = (s.mats[kind] || 0) + (n || 1); return s.mats[kind]; }
  function canBuild(s, id) {
    var def = JA.BUILDS[id], k;
    if (!def) return no('Nobody knows how to build that.');
    if (!s.pioneer) return no('Building belongs to Pioneer mode.');
    if (def.site && def.site !== s.site.id) return no('That only works on ' + JA.SITES[def.site].name + '.');
    if (built(s, id) >= def.max) return no('You already built ' + (def.max > 1 ? 'all ' + def.max + ' of them.' : 'it.'));
    for (k in def.cost) if ((s.mats[k] || 0) < def.cost[k]) return no('You need ' + (def.cost[k] - (s.mats[k] || 0)) + ' more ' + JA.MATS[k].name + '.');
    return OK;
  }
  function build(s, id) {
    var r = canBuild(s, id), def = JA.BUILDS[id], k;
    if (!r.ok) return r;
    var before = extraCells(s, env(s).kind);
    for (k in def.cost) s.mats[k] -= def.cost[k];
    s.built[id] = built(s, id) + 1; s.stats.built = (s.stats.built || 0) + 1;
    s.cellsToday += extraCells(s, env(s).kind) - before;          // a new panel, turbine or mirror starts charging today
    note(s, 'built');
    return OK;
  }

  // ---------- the town beside the outpost ----------
  // Settlers share your air plant: each stage with people in it adds a little to the breathing.
  function townLoad(s) { var c = s.colony; return c && c.stage >= 2 ? R.townAir * (c.stage - 1) : 0; }
  // Evening: was the outpost self-sustaining today? That is what brings ships, and what keeps the town's spirit up.
  function townNight(s) {
    var c = s.colony, t = s.today, D = R.townDays, i, next = 0;
    var nextDinner = s.level.dinner + dayMods(s, s.sol + 1).dinner;
    var air = t.airMade >= t.breath * 0.6, food = s.food >= nextDinner || t.crates >= 1, ok = air && food;
    if (ok) c.days++;
    if (c.stage >= 2) c.spirit = clamp(c.spirit + (ok ? R.spiritUp : -R.spiritDown), 0, 100);
    for (i = 1; i < D.length; i++) if (c.days < D[i]) { next = D[i]; break; }
    return { ok: ok, air: air, food: food, days: c.days, next: next, coming: D.indexOf(c.days) > c.stage, stage: c.stage, people: c.people, spirit: c.spirit };
  }
  // Morning: a new ship may have come, and a town in good spirits lends a hand.
  function townMorning(s) {
    var c = s.colony, D = R.townDays, want = 0, i, m = s.m;
    for (i = 1; i < D.length; i++) if (c.days >= D[i]) want = i;
    c.arrive = 0; c.gifts = []; c.asks = 0;
    if (want > c.stage) { c.stage = want; c.arrive = want; c.people = R.townPeople[want] || 0; c.fresh = want >= 2; }
    if (c.stage < 2) return;
    if (c.spirit >= R.spiritHelp) {
      if (m.air.queue < R.hopperMax) { m.air.queue++; c.gifts.push(JA.waterWords(s).a + ' for the Air Maker'); }
      if (s.water < waterCap(s) - 15) { s.water += 15; c.gifts.push('water for the tank'); }
    }
    if (c.spirit >= R.spiritGift && c.stage >= 3 && s.rack.cells < rackMax(s)) { s.rack.cells++; c.gifts.push('a charged power cell'); }
    if (c.spirit < R.spiritLow) c.asks = R.townDinner;          // a town in trouble shares your dinner tonight
  }

  // How much faster the tanks empty because the air indoors is stale: a clogged filter (a crisis) or a full one.
  function stale(s) { return Math.max(s.stale, s.filter <= 0 ? R.staleRate : 1); }
  // Soil bags past the free ones cover the skylights, so the lamps indoors stay on: a share of solar power.
  function shade(s) { return Math.max(0, s.bags - R.bagsFreeShade) * R.bagShade; }
  // The share of the panels' power that reaches the rack, after the indoor lamps and the storm scars.
  function sunPower(s) { return (1 - shade(s)) * (1 - s.wear.scar); }
  function roverCap(s) { return R.roverMax * (1 - s.wear.rover); }
  function crop(id) { return JA.CROPS[id] || JA.CROPS.lettuce; }
  // A "why did that happen?" moment. Each one comes up once per mission; the card is shown when there is room.
  function note(s, id) {
    var m = JA.mech(id);
    if (!m || s.seen[id] || (m.site && m.site !== s.site.id)) return false;
    s.seen[id] = s.sol;
    if (s.today) s.today.whys.push(id);
    if (!s.sleeping) s.whyQ.push(id);
    return true;
  }
  // some science was done today (tonight's space fact can be about science)
  function didScience(s) { s.today.science++; }

  // ---------- one slice of time ----------
  // ctx: { outside, sprint, driving }. Returns a list of things that just happened.
  // In crew mode (js/crew.js) outside and sprint are shares of the crew (0..1): how many of the astronauts are out
  // in the open, and how many of them are running. One player is true / false, the same as 1 / 0.
  function tick(s, dt, ctx) {
    var ev = [];
    if (s.over || s.night || s.dayDone) return ev;
    var D = s.dayLength, m = s.m, t0 = s.t, td = s.today;
    s.t = Math.min(D, s.t + dt); dt = s.t - t0;

    // breathing empties the tanks and fills the CO2 filter; with stale air the tanks must give even more
    var out = ctx.outside === true ? 1 : +ctx.outside || 0, run = ctx.sprint === true ? out : Math.min(out, +ctx.sprint || 0);
    var puff = airDrain(s) / D * dt * (1 + (R.sprintAir - 1) * run), breath = puff * stale(s);
    s.air = Math.max(0, s.air - breath); td.breath += breath; td.staleAir += breath - puff;
    var soaked = Math.min(s.filter, puff * R.filterPerAir * (built(s, 'filter') ? 0.67 : 1));
    s.filter -= soaked; td.filterUsed += soaked;
    if (s.filter <= 0) td.wasStale = true;
    if (run > 0) s.stats.sprint += dt * run;
    // the crew drinks and washes; the recycler gives most of it back
    if (s.water > 0) {
      var sip = R.crewWater / D * dt, hot = s.env[s.sol - 1].heat, back = sip * s.mods.recycle;
      // a hot day: the suits cool the crew by letting water evaporate away, so that extra water never reaches the recycler
      if (hot) { var sweat = sip * (hot - 1); td.water.sweat = (td.water.sweat || 0) + sweat; sip += sweat; }
      td.water.crew += sip; td.water.back += back;
      s.water = Math.max(0, s.water - (sip - back));
    } else td.noWater += dt;
    if (s.leak > 0) { var lost = s.leak / D * dt; s.air = Math.max(0, s.air - lost); s.today.leaked += lost; }

    var sf = shield(s);
    var bare = out + (1 - out) * (1 - sf);         // the share of the crew's dose that the walls and bags do not block
    var base = s.site.doseDay * s.level.doseScale / D * dt * bare;
    s.dose += base; s.today.doseBase += base;

    var st = s.storm;
    if (st) {
      if (!st.warned && s.t >= st.start - warnLead(s)) { st.warned = true; ev.push({ type: 'storm', phase: 'warning' }); }
      var o = Math.max(0, Math.min(s.t, st.end) - Math.max(t0, st.start));
      if (o > 0) {
        if (!st.active) { st.active = true; ev.push({ type: 'storm', phase: 'active' }); }
        var got = st.strength / R.stormDuration * o * bare;
        s.dose += got; s.today.doseStorm += got;
        if (out > 0) { s.stats.stormOut += o * out; td.stormOut += o * out; if (td.stormOut > 2) note(s, 'stormout'); }
      }
      if (!st.over && s.t >= st.end) {
        st.over = true; st.active = false; ev.push({ type: 'storm', phase: 'over' });
        if (td.stormOut < 1) note(s, 'stormin');
        note(s, 'warn');
        // a medium or big storm leaves the solar cells a little weaker for good
        var scar = st.level >= 2 ? Math.min(R.scarMax - s.wear.scar, R.scarPerLevel * st.level * s.site.stormMult) : 0;
        if (scar > 0.0005) { s.wear.scar += scar; td.scar = scar; note(s, 'scar'); }
      }
    }

    // solar rack: the panels fill one power cell after another
    var rk = s.rack, i;
    if (!rk.broken && s.t <= D * R.chargeSpan) {
      rk.charge += Math.max(0, s.cellsToday - R.morningCells) / (D * R.chargeSpan) * ((rk.eff[0] + rk.eff[1] + rk.eff[2]) / 3) * sunPower(s) * dt;
    }
    while (rk.charge >= 1 && rk.cells < rackMax(s)) { rk.charge -= 1; rk.cells++; ev.push({ type: 'cell' }); }
    if (rk.cells >= rackMax(s)) rk.charge = Math.min(rk.charge, 0.98);
    for (i = 0; i < 3; i++) rk.eff[i] = Math.max(R.effMin, rk.eff[i] - s.effDecay / D * dt);

    // air maker: electricity splits melted ice into oxygen
    var a = m.air;
    if (!a.broken && a.queue > 0 && a.power > 0) {
      a.prog += dt / R.iceTime;
      if (a.prog >= 1) {
        a.prog = 0; a.queue--; a.power--;
        var made = airPerIce(s);
        s.air = Math.min(100, s.air + made); s.today.airMade += made;
        ev.push({ type: 'air', amount: made });
        note(s, 'electro');
        if (a.power === 0) ev.push({ type: 'empty', machine: 'air' });
      }
    }

    // greenhouse: plants need light AND water
    var f = m.food, growing = 0, drink = 0;
    var lit = f.lamp > 0;
    f.lamp = Math.max(0, f.lamp - dt / D);
    if (lit && f.lamp === 0) ev.push({ type: 'empty', machine: 'food' });
    for (i = 0; i < f.beds.length; i++) if (f.beds[i].state === 'growing') growing++;
    if (!f.broken && lit && s.water > 0) {
      for (i = 0; i < f.beds.length; i++) {
        var b = f.beds[i], cr = crop(b.crop);
        if (b.state !== 'growing') continue;
        b.g += dt / (cr.growSols * D); drink += cr.drink / D * dt;
        if (b.g >= 1) { b.g = 1; b.state = 'ripe'; ev.push({ type: 'ripe', bed: i }); }
      }
      s.water = Math.max(0, s.water - drink); td.water.plants += drink;
    }

    var bg = m.bag;
    if (!bg.broken && bg.pending > 0) {
      bg.timer -= dt;
      if (bg.timer <= 0) { bg.timer = R.bagInterval; bg.pending--; ev.push({ type: 'bag' }); }
    }

    var lab = m.lab;
    if (!lab.broken && lab.queue.length && lab.power > 0) {
      lab.prog += dt / R.analyzeTime;
      if (lab.prog >= 1) {
        lab.prog = 0; lab.power--;
        ev.push({ type: 'discovery', find: discover(s, lab.queue.shift()) });
        if (lab.power === 0) ev.push({ type: 'empty', machine: 'lab' });
      }
    }

    if (ctx.driving) {
      var c0 = m.rover.charge;
      m.rover.charge = Math.max(0, c0 - dt); s.stats.drive += dt;
      // running the battery right down hurts it: from now on it holds a little less
      if (c0 > 0 && m.rover.charge <= 0) { s.wear.rover = Math.min(R.flatWearMax, s.wear.rover + R.flatWear); note(s, 'flat'); }
    }

    // the one lucky dust devil of the mission: it shows up on the horizon, then crosses the panels
    var dv = s.devil;
    if (dv && dv.sol === s.sol) {
      if (dv.state === 'pending' && s.t >= dv.at * D - R.devilLead) { dv.state = 'coming'; ev.push({ type: 'devil', phase: 'coming', lead: Math.max(0, dv.at * D - s.t) }); }
      if (dv.state === 'coming' && s.t >= dv.at * D) { dv.state = 'done'; dv.gain = devilClean(s); ev.push({ type: 'devil', phase: 'clean', gain: dv.gain }); }
    }

    var g = s.glitch;
    if (g && g.state === 'pending' && s.t >= g.at) { g.state = 'broken'; machine(s, g.machine).broken = true; ev.push({ type: 'break', machine: g.machine }); }
    if (g && g.state === 'asked' && s.t >= g.replyAt) { g.state = 'advised'; ev.push({ type: 'advice', machine: g.machine }); }

    if (JA.crisis) JA.crisis.tick(s, ctx, ev);

    // why did that happen? Each of these is noticed once, at the moment it starts to matter.
    if (!s.sleeping) {
      if (growing && !f.broken) {
        if (lit && s.water <= 0) { if ((td.dryBeds += dt) > 6) note(s, 'dry'); }
        else if (!lit && s.water > 0) { if ((td.darkBeds += dt) > 12) note(s, 'dark'); }
      }
      if (s.filter <= 0) note(s, 'stale'); else if (s.filter < R.filterWarn) note(s, 'filterlow');
      // on the first day the lesson comes first: only the two cards that belong to it are shown, the rest wait
      if (s.whyQ.length && s.t >= s.whyAt) {
        var qi = 0;
        if (ctx.calm) { qi = -1; for (i = 0; i < s.whyQ.length; i++) if (s.whyQ[i] === 'electro' || s.whyQ[i] === 'crop') { qi = i; break; } }
        if (qi >= 0) { ev.push({ type: 'why', id: s.whyQ.splice(qi, 1)[0] }); s.whyAt = s.t + R.whyGap * (ctx.fast || 1); }
      }
      if (s.water < R.waterWarn && growing) note(s, 'waterlow');
      if (s.dose >= 25) note(s, 'dose25');
      if (s.stats.sprint > 8) note(s, 'sprint');
      if ((rk.eff[0] + rk.eff[1] + rk.eff[2]) / 3 < 0.8 && env(s).kind !== 'dark') note(s, 'panel');
      if (rk.cells >= rackMax(s) && !rk.broken && s.t <= D * R.chargeSpan && s.cellsToday > R.morningCells) { if ((td.fullT += dt) > 15) note(s, 'rackfull'); }
    }
    if (!s.today.goalDone && dayGoalDone(s)) {
      s.today.goalDone = true; s.stats.dayGoals++;
      ev.push({ type: 'daygoal' });
    }

    if (s.air <= 0) ev.push({ type: 'fail', reason: 'air' });
    else if (s.dose >= 100) ev.push({ type: 'fail', reason: 'dose' });
    else if (s.t >= D) { s.dayDone = true; ev.push({ type: 'dayEnd' }); }
    return ev;
  }

  // ---------- things the astronaut does ----------
  function takeCell(s) { if (s.rack.cells <= 0) return false; s.rack.cells--; return true; }
  function plug(s, id) {
    var m = s.m;
    if (id === 'air') { if (m.air.power > R.airCharges) return no('The Air Maker is already charged up.'); m.air.power += R.airCharges; }
    else if (id === 'food') { if (m.food.lamp > 1) return no('The grow lamps are already charged up.'); m.food.lamp += 1; }
    else if (id === 'bag') {
      if (s.bags + m.bag.pending >= R.shieldSlots) return no('The dome is fully covered. No more bags needed!');
      m.bag.pending += R.bagsPerCell; m.bag.timer = 0.8;
    }
    else if (id === 'lab') { if (m.lab.power > R.labCharges) return no('The Lab is already charged up.'); m.lab.power += R.labCharges; }
    else if (id === 'comms') {
      if (m.comms.broken) return no('The Radio Dish fuse is blown. It cannot be switched on today.');
      if (m.comms.on) return no('The Radio Dish is already on today.');
      m.comms.on = true; if (s.t < s.dayLength * 0.5) s.today.dishEarly = true;
    }
    else if (id === 'rover') {
      if (m.rover.stuck) return no('The rover is buried up to its axles. The crew will dig it out tonight.');
      if (m.rover.charge > roverCap(s) - 30) return no('The rover battery is full.'); m.rover.charge = Math.min(roverCap(s), m.rover.charge + R.roverPerCell);
    }
    else if (id === 'scrub') {
      if (s.filter > R.filterFull) return no('The CO₂ filter is still clean. It does not need baking yet.');
      s.today.baked += 100 - s.filter; s.stats.baked++; s.filter = 100;
    }
    else return no('That does not fit there.');
    s.today.cells[id] = (s.today.cells[id] || 0) + 1; s.stats.cells++;
    return OK;
  }
  function feedIce(s, id) {
    if (id === 'air') { if (s.m.air.queue >= R.hopperMax) return no('The Air Maker hopper is full. Give it a power cell so it can work!'); s.m.air.queue++; }
    else {
      if (s.water > waterCap(s) - waterPerIce(s) / 2) return no('The water tank is full.');
      var add = Math.min(waterPerIce(s), waterCap(s) - s.water);
      s.water += add; s.today.water.ice += add;
      s.today.ice++; s.stats.ice++;
      return { ok: true, add: add };
    }
    s.today.ice++; s.stats.ice++;
    return OK;
  }
  // Swallowed by a deepmaw (a made-up planet's giant worm, js/deepmaw.js): it spits you out, and refilling your suit
  // takes air from the tanks. The game also moves the clock on (R.wormTime) and sends you to the airlock.
  function wormBite(s) {
    s.air = Math.max(0, s.air - R.wormAir);
    s.stats.eaten = (s.stats.eaten || 0) + 1;
    if (s.today) s.today.extra.push({ res: 'air', text: 'Refilling your suit after the deepmaw spat you out', v: -R.wormAir });
    note(s, 'worm');
    return { ok: true, air: R.wormAir };
  }
  // The dew catcher (a planet with one): take its can of water, then pour it into the water tank.
  function takeDew(s) {
    if (!s.site.dew) return no('There is no dew catcher here.');
    if (!(s.dew >= 1)) return no('The dew catcher is empty. Dew forms on clear, still nights.');
    var w = Math.round(s.dew); s.dew = 0;
    return { ok: true, water: w };
  }
  function feedDew(s, water) {
    water = Math.max(0, +water || 0);
    if (s.water > waterCap(s) - water / 2) return no('The water tank is full.');
    var add = Math.min(water, waterCap(s) - s.water);
    s.water += add; s.today.water.dew = (s.today.water.dew || 0) + add;
    s.stats.dew = (s.stats.dew || 0) + add;
    note(s, 'dew');
    return { ok: true, add: add };
  }
  function addBag(s) {
    if (s.bags >= R.shieldSlots) return no('The dome is fully covered!');
    s.bags++; s.today.bags++;
    note(s, 'shield');
    if (s.bags > R.bagsFreeShade) note(s, 'shade');
    return OK;
  }
  // Plant a bed with the seeds in your pocket (or the kind named). Returns the kind that was planted.
  function plant(s, i, kind) {
    var b = s.m.food.beds[i]; if (b.state !== 'empty') return false;
    if (JA.CROPS[kind]) s.sow = kind;
    b.state = 'growing'; b.g = 0; b.crop = s.sow;
    note(s, 'crop');
    return b.crop;
  }
  function setSeed(s, kind) { if (JA.CROPS[kind]) s.sow = kind; return s.sow; }
  // Pick a ripe bed. Returns the kind of crop, so the crate knows what is in it.
  function harvest(s, i) { var b = s.m.food.beds[i]; if (b.state !== 'ripe') return false; b.state = 'empty'; b.g = 0; return b.crop || 'lettuce'; }
  function storeCrate(s, kind) {
    if (s.flags.pantryShut === s.sol) return no('The food store is sealed off because of the leak. The crew will open it again tonight.');
    var food = crop(kind).food;
    s.food = Math.min(100, s.food + food); s.today.crates++; s.today.cratesFood += food; s.stats.crates++;
    return { ok: true, food: food };
  }
  function coresLeft(s, i) { return 2 - s.cores[i]; }
  function drillCore(s, i, quality) { var core = { site: i, n: s.cores[i], quality: quality }; s.cores[i]++; s.stats.cores++; return core; }
  function submitCore(s, core) { if (s.m.lab.queue.length >= R.labQueue) return no('The Lab tray is full. It needs a power cell to study the cores.'); s.m.lab.queue.push(core); return OK; }
  function discover(s, core) {
    var site = JA.pick(s, JA.GEO)[core.site], f = site.finds[core.n] || site.finds[0];
    var find = { title: f.title, text: f.text, src: f.src, quality: core.quality, place: site.name, icon: site.icon, sol: s.sol, kind: 'core',
      key: core.site + '-' + (site.finds[core.n] ? core.n : 0) };
    // the first core studied from each site teaches something useful for good
    if (site.perk && !perk(s, site.perk.kind)) { s.perks[site.perk.kind] = s.sol; find.perk = site.perk.text; find.perkKind = site.perk.kind; }
    s.finds.push(find);
    didScience(s);
    return find;
  }
  function deploy(s, id) {
    if (s.inst[id]) return null;
    var def = JA.pick(s, JA.INSTRUMENTS).filter(function (x) { return x.id === id; })[0];
    s.inst[id] = true;
    didScience(s);
    var find = { title: def.name + ' is working!', text: def.text, src: def.src, perk: def.perk, icon: def.icon, sol: s.sol, kind: 'inst', key: id };
    s.finds.push(find);
    return find;
  }
  function photo(s, i) {
    if (s.photos[i]) return null;
    var def = JA.pick(s, JA.PHOTOS)[i];
    s.photos[i] = true;
    didScience(s);
    var find = { title: 'Postcard: ' + def.name, text: def.text, src: def.src, icon: '📸', sol: s.sol, kind: 'photo', key: String(i) };
    s.finds.push(find);
    return find;
  }
  function trick(s, dist) { s.stats.tricks++; s.stats.bestThrow = Math.max(s.stats.bestThrow, dist); note(s, 'throw'); }
  // The rover hit something. A real crash shakes some charge out of the battery.
  function crash(s, impact) {
    var hard = impact >= R.crashHard;
    s.stats.crashes = (s.stats.crashes || 0) + 1;
    if (hard) { s.m.rover.charge = Math.max(0, s.m.rover.charge - R.crashCharge); s.stats.hardCrashes = (s.stats.hardCrashes || 0) + 1; note(s, 'crash'); }
    return { hard: hard };
  }
  // The drill overheated: the bit is a little more worn, and heats faster from now on.
  function jam(s) { s.wear.drill = Math.min(R.jamWearMax, s.wear.drill + R.jamWear); note(s, 'jam'); return s.wear.drill; }
  function servicePanel(s, i) { s.rack.eff[i] = 1; s.today.panels[i] = 1; }
  function cleanAllPanels(s) { s.rack.eff = [1, 1, 1]; }

  // ---------- repairs and the radio delay ----------
  function commInfo(s) {
    if (s.site.comms === 'near') return { oneWay: '1.3 seconds', round: 'about 3 seconds', wait: 3, minutes: 0 };
    // a relay ship in orbit answers in seconds; Earth itself is out of reach (a made-up planet far beyond the solar system)
    if (s.site.comms === 'relay') return { oneWay: 'about 2 seconds', round: 'about 4 seconds', wait: 4, minutes: 0, relay: true };
    var date = weather(s).date || new Date().toISOString().slice(0, 10);
    var one = JA.weather.marsDelayMin(date), round = one * 2;
    return { oneWay: 'about ' + Math.round(one) + ' minutes', round: 'about ' + Math.round(round) + ' minutes', wait: clamp(round * 1.4, 14, 60), minutes: Math.round(round) };
  }
  function askEarth(s) {
    var g = s.glitch;
    if (!g || g.state !== 'broken') return no('');
    if (!s.m.comms.on) return no('The Radio Dish has no power today, so you cannot call ' + JA.homeName(s) + '.');
    var info = commInfo(s);
    g.state = 'asked'; g.asked = true; g.replyAt = s.t + info.wait;
    note(s, 'delay');
    return { ok: true, info: info };
  }
  function repairMiss(s) { s.glitch.misses++; s.rack.charge = Math.max(0, s.rack.charge - 0.5); }
  function repairDone(s) {
    var g = s.glitch;
    // a Greenhouse repair does not replace a blown pump fuse (that is a crisis, see crisis.js)
    machine(s, g.machine).broken = g.machine === 'food' && s.flags.pumpFuse === s.sol;
    g.state = 'fixed'; s.stats.repairs++;
    s.today.repair = { machine: g.machine, misses: g.misses, asked: g.asked };
  }

  // ---------- night ----------
  function endSol(s, info) {
    info = info || {};
    var L = s.level, t = s.today, ev = [], last = s.sol >= s.totalSols;
    if (info.late) { s.air = Math.max(0, s.air - R.lateAir); t.late = true; }
    // if you turned in early, the rest of the day still passes (safely indoors).
    // info.launch: the crew has lifted off, so the rest of the day does not pass at the outpost.
    var guard = 0;
    s.sleeping = true;
    while (!info.launch && s.t < s.dayLength && !s.dayDone && guard++ < 4000) ev = ev.concat(tick(s, 0.5, { outside: false }));
    s.sleeping = false;
    s.dayDone = true;
    var sf = shield(s), dinnerV = 0, night = 0, dry = 0, picked = 0, pickedFood = 0;
    if (!last) {
      // After the shift the crew inside picks whatever is ripe, stores it and plants the same crop again. Food then
      // depends on what you decided (power for the lamps, ice for the water, which crop) more than on how fast you run:
      // picking during the day still gets a bed growing again sooner. (Not while the leak has the food store sealed.)
      if (s.flags.pantryShut !== s.sol) s.m.food.beds.forEach(function (b) {
        if (b.state !== 'ripe') return;
        picked++; pickedFood += crop(b.crop).food; b.state = 'growing'; b.g = 0;
      });
      s.food = Math.min(100, s.food + pickedFood); t.crewCrates = picked; t.crewFood = pickedFood;
      // dried space food needs water: with an empty tank the crew opens extra ready-made packs (see dinner)
      var shared = (s.colony && s.colony.asks) || 0;
      dry = dryDinner(s); dinnerV = dinner(s) - dry - shared;
      if (dry && !s.seen.thirst) { s.seen.thirst = s.sol; t.whys.push('thirst'); }
      s.food -= dinnerV + dry + shared;
      night = s.site.doseNight * L.doseScale * (1 - sf); s.dose += night;
      if (s.glitch && s.glitch.state !== 'fixed' && s.glitch.state !== 'pending') { machine(s, s.glitch.machine).broken = false; s.glitch.state = 'fixed'; t.repair = { machine: s.glitch.machine, overnight: true }; }
      if (JA.crisis) JA.crisis.night(s);
    }
    // life support was looked after today: the filter never filled up and the tank never ran dry
    t.care = !t.wasStale && t.noWater < 1 && s.water >= 1;
    function extra(res) { return t.extra.filter(function (x) { return x.res === res; }).map(function (x) { return { text: x.text, v: x.v }; }); }
    var lines = [];
    lines.push({ res: 'air', icon: '💨', parts: [
      t.airMade ? { text: 'Air Maker turned ' + JA.waterWords(s).stuff + ' into oxygen', v: t.airMade } : { text: 'Air Maker made nothing', v: 0 },
      { text: 'Crew breathing', v: -Math.round(t.breath - t.staleAir) },
      t.staleAir >= 0.5 ? { text: 'Extra air to push out the stale air', v: -Math.round(t.staleAir) } : null,
      t.leaked >= 0.5 ? { text: 'Leaked out through the hole', v: -Math.round(t.leaked) } : null,
      t.late ? { text: 'Late rush home', v: -R.lateAir } : null
    ].filter(Boolean).concat(extra('air')) });
    lines.push({ res: 'food', icon: '🥬', parts: [
      t.crates ? { text: t.crates + ' veggie crate' + (t.crates > 1 ? 's' : '') + ' stored', v: t.cratesFood } : picked ? null : { text: 'No harvest today', v: 0 },
      picked ? { text: 'The crew picked ' + picked + ' ripe bed' + (picked > 1 ? 's' : '') + ' after your shift', v: pickedFood } : null,
      dinnerV ? { text: 'Crew dinner', v: -dinnerV } : null,
      dry ? { text: 'Extra packs: no water to cook dried food', v: -dry } : null,
      shared ? { text: 'Shared with the town, which is short of food', v: -shared } : null
    ].filter(Boolean).concat(extra('food')) });
    lines.push({ res: 'water', icon: '💧', parts: [
      t.water.ice ? { text: JA.iceWell(s) ? 'Well water poured into the tank' : 'Ice melted into the tank', v: Math.round(t.water.ice) } : null,
      t.water.dew ? { text: 'Dew from the dew catcher', v: Math.round(t.water.dew) } : null,
      t.water.crew >= 0.5 ? { text: t.water.sweat >= 0.5 ? 'The crew drank and washed (more in the heat)' : 'The crew drank and washed', v: -Math.round(t.water.crew) } : { text: 'The tank was empty', v: 0 },
      t.water.back >= 0.5 ? { text: 'The recycler gave back', v: Math.round(t.water.back) } : null,
      t.water.plants >= 0.5 ? { text: 'Kept by the growing plants', v: -Math.round(t.water.plants) } : null
    ].filter(Boolean).concat(extra('water')) });
    lines.push({ res: 'filter', icon: '🫧', parts: [
      { text: 'CO₂ soaked up from the crew\'s breath', v: -Math.round(t.filterUsed) },
      t.baked ? { text: 'Baked clean with a power cell', v: Math.round(t.baked) } : null
    ].filter(Boolean).concat(extra('filter')) });
    lines.push({ res: 'dose', icon: '☢️', parts: [
      { text: 'Everyday radiation', v: r1(t.doseBase) },
      t.doseStorm >= 0.05 ? { text: 'Solar storm', v: r1(t.doseStorm) } : null,
      night ? { text: 'Night (shield blocked ' + Math.round(sf * 100) + '%)', v: r1(night) } : null
    ].filter(Boolean) });

    var fail = null;
    if (s.air <= 0) fail = 'air'; else if (s.food < 0) fail = 'food'; else if (s.dose >= 100) fail = 'dose';
    s.food = clamp(s.food, 0, 100);
    var report = {
      sol: s.sol, lines: lines, before: s.morning, after: { air: s.air, food: s.food, dose: s.dose, water: s.water, filter: s.filter },
      fail: fail, last: last, events: ev, repair: t.repair,
      whys: t.whys.slice(), scar: t.scar, care: t.care,                                           // what today explained, for the night report
      dark: s.darkSol > s.sol && s.darkSol - s.sol <= 2 ? s.darkSol - s.sol : 0,     // days until the long dark, when it is near
      finds: s.finds.filter(function (f) { return f.sol === s.sol; }), forecast: null, shield: sf,
      day: s.day, goalDone: t.goalDone,
      decision: s.decisions.filter(function (d) { return d.sol === s.sol; })[0] || null,
      harder: last ? [] : harderList(s, s.sol + 1), nextDay: last ? null : dayInfo(s, s.sol + 1)
    };
    report.facts = pickFacts(s, t.whys.length > 1 ? 1 : 2);
    report.fact = report.facts[0];
    if (!fail && !last) {
      var e2 = s.env[s.sol], w2 = s.weather[s.sol] || null;
      if (s.m.comms.on) report.forecast = { env: e2, weather: w2, full: true };
      else if (s.inst.beam && s.site.dusty) report.forecast = { env: e2, weather: null, full: false };      // the Weather Station forecasts sunlight where dust changes it
    }
    s.forecast = s.m.comms.on;
    s.night = true;
    s.log.push(report);
    if (fail) s.over = { type: 'fail', reason: fail };
    return report;
  }

  // The crew lifts off.
  function finish(s) { s.over = { type: 'win' }; }

  function pickFacts(s, n) {
    var tags = [], t = s.today, e = env(s).kind, out = [], i;
    if (t.baked || s.filter < R.filterWarn) tags.push('filter');
    if (e === 'dark') tags.push('dark');
    if (t.water.ice) tags.push('water');
    if (t.repair) tags.push('repair');
    if (weather(s).level > 0) tags.push('storm');
    if (e === 'storm' || e === 'dusty') tags.push('dust');
    if (e === 'shadow' || e === 'lowsun' || e === 'dark') tags.push('power');
    if (t.ice) tags.push('ice');
    if (t.bags) tags.push('shield');
    if (t.cells.rover) tags.push('rover');
    if (t.science) tags.push('science');
    if (t.cells.comms) tags.push('comms');
    if (t.crates) tags.push('crop');
    if (t.crates || t.cells.food) tags.push('food');
    if (t.airMade) tags.push('air');
    tags.push('dose', 'any');
    for (i = 0; i < tags.length && out.length < n; i++) {
      var list = JA.FACTS.filter(function (f) { return !s.seenFacts[f.id] && (f.site === 'any' || f.site === s.site.id) && f.tags.indexOf(tags[i]) >= 0; });
      if (list.length) { var f = list[Math.floor(s.rng() * list.length)]; s.seenFacts[f.id] = 1; out.push(f); }
    }
    if (!out.length) {
      var rest = JA.FACTS.filter(function (f) { return f.site === 'any' || f.site === s.site.id; });
      out.push(rest[Math.floor(s.rng() * rest.length)] || JA.FACTS[0]);
    }
    return out;
  }

  function rankFor(s) { return JA.RANKS[s.level.id] || JA.RANKS.cadet; }
  function badges(s) {
    var b = [];
    if (s.stats.storms && s.stats.stormOut < 1) b.push({ icon: '⚡', name: 'Storm Dodger', text: 'Never caught outside in a solar storm' });
    if (s.bags >= R.shieldSlots) b.push({ icon: '🛡️', name: 'Shield Master', text: 'Covered the whole dome in soil bags' });
    if (s.stats.crates >= 4) b.push({ icon: '🥕', name: 'Space Farmer', text: 'Harvested ' + s.stats.crates + ' veggie crates' });
    if (s.stats.cores >= 6) b.push({ icon: '🪨', name: 'Rock Hound', text: 'Drilled ' + s.stats.cores + ' rock cores' });
    if (s.inst.seismo && s.inst.beam && s.inst.rad) b.push({ icon: '🛰️', name: 'Science Station', text: 'Set up all three instruments' });
    if (s.stats.bestThrow >= 15) b.push({ icon: '🎯', name: 'Sharpshooter', text: 'Landed a throw from ' + Math.round(s.stats.bestThrow) + ' m away' });
    if (s.stats.drive >= 150) b.push({ icon: '🚙', name: 'Road Tripper', text: 'Drove the rover for ' + Math.round(s.stats.drive) + ' seconds' });
    if (s.sky && s.sky.found) b.push({ icon: '☄️', name: 'Space Rock Hunter', text: 'Picked up ' + s.sky.found + ' meteorite' + (s.sky.found > 1 ? 's' : '') + ' from a fresh crater' });
    if (s.ray && s.ray.seen) b.push({ icon: '🪁', name: 'Ray Spotter', text: 'Saw a sand ray leap out of the dunes (sand rays are made up)' });
    if (s.worm && s.worm.escaped) b.push({ icon: '🪱', name: 'Worm Dodger', text: 'Ran from a deepmaw and got away (deepmaws are made up)' });
    if (s.colony && s.colony.stage) b.push({ icon: '🏘️', name: 'Town Founder', text: 'Your outpost looked after itself so well that ' + (s.colony.stage > 1 ? 'settlers came' : 'a supply ship came') + ' from Earth' });
    if (s.stats.cores >= 3 && !s.wear.drill && !s.wear.rover) b.push({ icon: '🔧', name: 'Gentle Hands', text: 'Never overheated the drill or ran the rover battery flat' });
    if (s.stats.drive >= 60 && !s.stats.hardCrashes) b.push({ icon: '🛞', name: 'Safe Driver', text: 'Drove the rover without one real crash' });
    if (s.pioneer && s.stats.rocks >= 8) b.push({ icon: '⛏️', name: 'Rock Breaker', text: 'Broke up ' + s.stats.rocks + ' boulders for their materials' });
    if (s.pioneer && s.stats.built >= 4) b.push({ icon: '🏗️', name: 'Master Builder', text: 'Built ' + s.stats.built + ' things from local rock' });
    if (s.colony && s.colony.stage >= 4) b.push({ icon: '🌆', name: 'City Founder', text: s.colony.people + ' people live beside your outpost' });
    if (s.dose < 40) b.push({ icon: '💚', name: 'Healthy Crew', text: 'Kept radiation under 40%' });
    if (s.stats.dayGoals >= s.totalSols - 2) b.push({ icon: '🎓', name: 'Star Student', text: 'Finished every daily challenge' });
    if (s.decisions.length) b.push({ icon: '🧭', name: 'Decision Maker', text: 'Made ' + s.decisions.length + ' big call' + (s.decisions.length > 1 ? 's' : '') + ' with no checklist' });
    return b;
  }

  // Mission Control's advice: the most urgent thing right now, the reason behind it, and the hologram that explains it.
  function hintInfo(s) {
    var m = s.m, L = s.level, left = (s.dayLength - s.t) / s.dayLength, dusty = s.site.dusty;
    function say(text, why, topic) { return { text: text, why: why || '', topic: topic || '' }; }
    var airNeed = airDrain(s) * stale(s) * left + s.leak * left;
    if (s.glitch && s.glitch.state === 'broken') return say('Something is broken! Look for the sparks and fix it.');
    if (s.filter <= 0 && s.stale <= 1) return say('The CO₂ filter is full, so the air is draining fast. Plug a power cell into the Air Scrubber by the airlock!', 'The heat pushes the trapped gas out, and the filter can soak up more.', 'scrubber');
    if (s.air < airNeed + 8) {
      var Wd = JA.waterWords(s), well = JA.iceWell(s);      // ice, or water cans from a well (Sahrun)
      if (m.air.queue > 0 && m.air.power === 0) return say('The Air Maker has ' + Wd.stuff + ' but no power. Bring it a power cell!', 'It takes electricity to pull the oxygen out of water.', 'electrolysis');
      // (a well planet's line starts differently: "powered but hungry" is matched to a recording that says "ice")
      if (m.air.power > 0 && m.air.queue === 0) return well ? say('The Air Maker is powered, but it has no water. Bring a can from the ' + s.site.iceName + '!', 'Water is where the oxygen comes from: every drop holds some.', 'electrolysis')
        : say('The Air Maker is powered but hungry. Bring ice from the ' + s.site.iceName + '!', 'Ice is frozen water, and water is where the oxygen comes from.', 'electrolysis');
      if (m.air.power === 0) return say('Air is running low. The Air Maker needs a power cell and ' + Wd.stuff + '.', well ? 'Water holds the oxygen. Electricity sets it free.' : 'Ice holds the oxygen. Electricity sets it free.', 'electrolysis');
    }
    var beds = m.food.beds, planted = beds.filter(function (b) { return b.state !== 'empty'; }).length;
    var ripe = beds.filter(function (b) { return b.state === 'ripe'; }).length;
    if (ripe) return say('Veggies are ripe! Pick them and carry the crate to the food hatch on the dome.');
    if (s.food < dinner(s) * 2 && s.sol < s.totalSols) {
      if (!planted) return say('Food is getting low. Plant seeds in the Greenhouse beds.', 'Lettuce is ready fastest. Potatoes fill the pantry more.', 'crops');
      if (m.food.lamp <= 0) return say('The plants are in the dark. The Greenhouse needs a power cell for its lamps.', 'Light is the energy a plant uses to grow.', 'plant');
      if (s.water <= 0) return say('The plants are thirsty. Drop ' + JA.waterWords(s).a + ' in the Greenhouse water tank.', 'A dry plant closes its pores and stops growing.', 'plant');
    }
    if (s.dew >= 1 && s.water < R.waterWarn + 20) return say('The dew catcher caught water last night. Carry its can to the Greenhouse water tank!', 'On a clear night the cold net turns water vapour from the air into drops.', 'water');
    if (s.water < R.waterWarn && planted) return say('The water tank is nearly empty. Bring it ' + JA.waterWords(s).a + ' before the plants go thirsty.', 'The recycler gives back what the crew drinks, but plants keep their water.', 'water');
    if (s.filter < R.filterWarn && s.filter > 0) return say('The CO₂ filter is nearly full. A power cell at the Air Scrubber will bake it clean.', 'It soaks up the gas the crew breathes out, like a sponge.', 'scrubber');
    if (s.storm && !s.storm.warned && s.forecast && s.bags < 8 && s.storm.level >= 2) return say('A solar storm is forecast today. Soil bags on the dome will protect the crew!', 'Soil stops the storm\'s particles before they reach anyone.', 'shield');
    if (s.dose > 55 && s.bags < R.shieldSlots) return say('The radiation badge is filling up. More soil bags on the dome would slow it down.', 'Radiation adds up, and the badge never goes back down.', 'dose');
    if (s.darkSol === s.sol + 1 && left < 0.5 && s.rack.cells < 3) return say('Tomorrow is the long dark, with almost no Sun. Leave power cells on the rack tonight!', 'Saved cells are the only power you will have.', 'longdark');
    var charging = !s.rack.broken && s.t <= s.dayLength * R.chargeSpan && s.cellsToday > R.morningCells;      // only then is sunshine being wasted
    if (s.rack.cells >= rackMax(s) && charging) return say('The Solar Rack is full, so the panels are wasting sunshine. Use those power cells!', 'A full rack cannot store any more electricity.');
    if (Math.min(s.rack.eff[0], s.rack.eff[1], s.rack.eff[2]) < 0.7 && env(s).kind !== 'dark') return dusty ? say('Dust is covering the solar panels. Brush them off to charge faster.', 'Dust blocks the sunlight before it reaches the cells.', 'solar')
      : say('The Sun has moved. Turn the solar panels to face it again.', 'A panel that faces away catches less light.', 'solar');
    if (left < 0.14) return say('The shift is almost over. Head back to the airlock!');
    return null;
  }
  function hint(s) { var h = hintInfo(s); return h ? h.text : ''; }

  JA.sim = {
    rng32: rng32, newGame: newGame, startSol: startSol, env: env, weather: weather, shield: shield, warnLead: warnLead, stormPhase: stormPhase,
    tick: tick, takeCell: takeCell, plug: plug, feedIce: feedIce, takeDew: takeDew, feedDew: feedDew, wormBite: wormBite, addBag: addBag, plant: plant, harvest: harvest, storeCrate: storeCrate,
    coresLeft: coresLeft, drillCore: drillCore, submitCore: submitCore, deploy: deploy, photo: photo, trick: trick,
    servicePanel: servicePanel, cleanAllPanels: cleanAllPanels, devilClean: devilClean, commInfo: commInfo, askEarth: askEarth, repairMiss: repairMiss, repairDone: repairDone,
    endSol: endSol, finish: finish, rankFor: rankFor, badges: badges, hint: hint, didScience: didScience,
    dayMods: dayMods, airDrain: airDrain, dinner: dinner, dayInfo: dayInfo, harderList: harderList,
    dayGoalDone: dayGoalDone, dayGoalProgress: dayGoalProgress, setDayLength: setDayLength, machine: machine,
    stale: stale, shade: shade, sunPower: sunPower, perk: perk, airPerIce: airPerIce, waterPerIce: waterPerIce, bagBlock: bagBlock, drillHeat: drillHeat, roverCap: roverCap, note: note, jam: jam, setSeed: setSeed, hintInfo: hintInfo, pickFacts: pickFacts,
    built: built, rackMax: rackMax, waterCap: waterCap, extraCells: extraCells, rockYield: rockYield, breakRock: breakRock, addMat: addMat, canBuild: canBuild, build: build,
    townLoad: townLoad, townNight: townNight, townMorning: townMorning, crash: crash
  };
})(window.JA);
