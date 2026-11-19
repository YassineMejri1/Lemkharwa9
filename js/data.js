/* Astro Outpost — game data: sites, levels, rules, discoveries, instruments, facts.
   Numbers marked REAL come from NASA (or the cited paper). Numbers marked GAME are
   simplified game scales, and the in-game "Real science" panel says so. */
window.JA = window.JA || {};
(function (JA) {
  'use strict';

  JA.SOURCES = {
    donki: { name: 'NASA DONKI — Space Weather Database', url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/' },
    osdr: { name: 'NASA Open Science Data Repository (OSDR)', url: 'https://osdr.nasa.gov/' },
    mars: { name: 'NASA Science — Mars facts', url: 'https://science.nasa.gov/mars/facts/' },
    moon: { name: 'NASA Science — Moon facts', url: 'https://science.nasa.gov/moon/facts/' },
    rad: { name: 'Curiosity rover RAD instrument (Hassler et al., Science, 2014)', url: 'https://science.nasa.gov/mission/msl-curiosity/' },
    msl: { name: 'NASA Curiosity rover', url: 'https://science.nasa.gov/mission/msl-curiosity/' },
    lnd: { name: 'Lunar surface dose measurement (Zhang et al., Science Advances, 2020)', url: 'https://www.science.org/doi/10.1126/sciadv.aaz1334' },
    m2020: { name: 'NASA Perseverance rover', url: 'https://science.nasa.gov/mission/mars-2020-perseverance/' },
    artemis: { name: 'NASA Artemis', url: 'https://www.nasa.gov/humans-in-space/artemis/' },
    iss: { name: 'NASA International Space Station', url: 'https://www.nasa.gov/international-space-station/' },
    mer: { name: 'NASA Mars Exploration Rovers (Spirit & Opportunity)', url: 'https://science.nasa.gov/mission/mer-opportunity/' },
    apollo: { name: 'NASA Apollo program', url: 'https://www.nasa.gov/the-apollo-program/' },
    insight: { name: 'NASA InSight lander', url: 'https://science.nasa.gov/mission/insight/' },
    phoenix: { name: 'NASA Phoenix Mars lander', url: 'https://science.nasa.gov/mission/phoenix/' },
    lro: { name: 'NASA Lunar Reconnaissance Orbiter', url: 'https://science.nasa.gov/mission/lro/' },
    storm2024: { name: 'NASA Curiosity rover RAD and MAVEN: the solar storm of 20 May 2024 (NASA, June 2024)', url: 'https://science.nasa.gov/mission/msl-curiosity/' },
    earthobs: { name: 'NASA Earth Observatory — deserts, dust storms and lightning on Earth', url: 'https://earthobservatory.nasa.gov/' },
    // Sahrun itself is not real: anything that is only true in the game says so, and cites this
    grace: { name: 'NASA GRACE and GRACE-FO missions (water seen by gravity)', url: 'https://grace.jpl.nasa.gov/' },
    sandfish: { name: 'Maladen et al., "Undulatory swimming in sand", Science, 2009', url: 'https://www.science.org/doi/10.1126/science.1172490' },
    fiction: { name: 'Made up for this game: Sahrun is a science-fiction planet', url: '' }
  };

  JA.SITES = {
    moon: {
      id: 'moon', short: 'Moon', name: 'the Moon', title: 'The Moon', emoji: '🌙',
      place: 'Shackleton Crater rim, South Pole', dayWord: 'Day',
      gravity: 1.62,                 // REAL m/s²
      doseDay: 6, doseNight: 4,      // GAME badge points (real: ~1.4 mSv/day, about twice Mars)
      stormMult: 1.0,                // GAME: no air at all, storms hit at full strength
      iceName: 'Shadow Crater',
      commText: 'A radio message reaches Earth in about 1.3 seconds.',
      blurb: 'Earth answers in seconds. But there is no air, so solar storms hit HARD.',
      why: 'We built here because the crater next door never sees the Sun — and its floor hides frozen water.',
      // what the rest of the code needs to know about this planet (see "Planet traits" below)
      atmosphere: 'none', dusty: false, comms: 'near', spaceWeather: 'earth',
      colors: { soil: 0x7b7c87, soil2: 0x666772, dust: 0xb8b9c4 },     // soil bags and dug ground; kicked-up dust
      weatherKinds: { calm: 'sun', mid: 'lowsun', bad: 'shadow', dark: 'dark' },
      env: {
        sun: { cells: 7, icon: '☀️', label: 'Bright sunshine', why: 'The Sun skims along the crater rim and the solar panels drink it up.' },
        lowsun: { cells: 5, icon: '🌥️', label: 'Long shadows', why: 'At the Moon\'s south pole the Sun stays very low. A mountain is starting to block it.' },
        shadow: { cells: 3, icon: '🌑', label: 'In the shadow', why: 'The Sun is hiding behind a mountain. The panels will charge very slowly today!' },
        // GAME: one whole day with almost no Sun on the longer missions (see sim.makeEnv). REAL: even the
        // best-lit rims at the lunar south pole are in shadow for part of the year.
        dark: { cells: 1, icon: '🌚', label: 'The long dark', why: 'A mountain on the crater rim hides the Sun all day. The panels make almost nothing, so today runs on the power cells you saved.' }
      }
    },
    mars: {
      id: 'mars', short: 'Mars', name: 'Mars', title: 'Mars', emoji: '🔴',
      place: 'Arcadia Planitia', dayWord: 'Sol',
      gravity: 3.71,                 // REAL m/s²
      doseDay: 3, doseNight: 2,      // GAME badge points (real: ~0.67 mSv/day, Curiosity RAD)
      stormMult: 0.5,                // GAME: thin air soaks up part of a solar storm
      iceName: 'Ice Pit',
      commText: 'A radio message takes between 3 and 22 minutes to reach Earth.',
      blurb: 'Earth takes minutes to answer. And dust storms can hide the Sun for days.',
      why: 'We built here because water ice lies just under the soil — water to drink, and oxygen to breathe.',
      atmosphere: 'thin', dusty: true, comms: 'orbit', spaceWeather: 'mars',
      colors: { soil: 0xa9582f, soil2: 0x8e4524, dust: 0xd9a070 },
      weatherKinds: { calm: 'clear', mid: 'dusty', bad: 'storm', dark: null },
      env: {
        clear: { cells: 6, icon: '🌤️', label: 'Clear sky', why: 'Mars gets less than half the sunlight Earth does, but today the sky is clear.' },
        dusty: { cells: 4, icon: '🌫️', label: 'Dusty sky', why: 'Dust floating in the air blocks some of the sunlight.' },
        storm: { cells: 2.5, icon: '🌪️', label: 'Dust storm!', why: 'A dust storm is hiding the Sun. In 2018 a storm like this ended the Opportunity rover\'s mission.' }
      }
    },
    // A MADE-UP planet, inspired by the desert worlds of science fiction. Its numbers are GAME numbers, chosen to
    // play well and to stay believable; the science on its cards is real (deserts on Earth, and Mars).
    sahrun: {
      id: 'sahrun', short: 'Sahrun', name: 'Sahrun', title: 'Sahrun', emoji: '🏜️', fictional: true, like: 'mars',
      place: 'Edge of the Great Erg', dayWord: 'Day',
      gravity: 4.9,                  // GAME: half of Earth's 9.81 m/s², so throws still reach the dome
      doseDay: 2.5, doseNight: 1.5,  // GAME: thick air blocks more radiation than the thin air of Mars
      stormMult: 0.35,               // GAME: thick air soaks up much of a storm
      iceName: 'Deep Well',
      commText: 'Mission Control rides on a relay ship in orbit, and a radio message reaches it in about 2 seconds. Earth itself is so far away that a message would take years.',
      blurb: 'A made-up desert world from science fiction. Water is treasure, and sandstorms bury the Sun.',
      why: 'We built here because a deep well beside the dunes reaches water hidden in the rock under the sand: the only water for many kilometres.',
      atmosphere: 'thick', dusty: true, comms: 'relay', spaceWeather: 'star',
      star: { name: 'Aster', au: 1.3, turn: 24 },
      dew: true,                     // a dew catcher beside the outpost turns cold nights into drinking water (see RULES.dewWater)
      creature: 'ray',               // MADE UP: sand rays glide under its dunes (js/sandray.js)
      // its water is not ice: well pumps lift water from deep in the rock, in sealed cans (JA.waterWords)
      waterWords: { chunk: 'water can', chunks: 'water cans', a: 'a water can', stuff: 'water', Stuff: 'Water', rig: 'well pump', rigs: 'well pumps', at: 'pump', hand: 'pump by hand', icon: '💧' },   // MADE UP: its star, how far Sahrun is from it (AU) and how many days the star takes to turn once
      colors: { soil: 0xc9964f, soil2: 0xa8763a, dust: 0xe8c48a },
      weatherKinds: { calm: 'clear', mid: 'dusty', bad: 'storm', dark: null },
      env: {
        //   heat   GAME: how many times more water the crew sweats and drinks on such a day (1 = normal)
        //   dew    GAME: how full the dew catcher gets the night after (1 = a full can); clear, still nights make the most
        clear: { cells: 7, icon: '☀️', label: 'Blazing sun', why: 'Not a cloud in the sky. Dry desert air lets almost all the sunlight through, so the panels drink it up. The crew will sweat, and drink more.', heat: 1.6, dew: 1 },
        dusty: { cells: 4.5, icon: '🌫️', label: 'Sand haze', why: 'Fine sand hangs in the air and scatters the sunlight before it reaches the panels.', heat: 1.25, dew: 0.5 },
        storm: { cells: 2, icon: '🌪️', label: 'Sandstorm!', why: 'A wall of sand is rolling across the desert and hiding the Sun. On Earth these storms are called haboobs.', dew: 0 }
      }
    }
  };

  // ---------- Planet traits ----------
  // The code never asks "is this the Moon or Mars?". It asks what a planet IS, so a new planet only has
  // to describe itself here and in the per-planet tables:
  //   atmosphere    'none' (sound does not carry, no fog or smoke, black sky) | 'thin' | 'thick'
  //   dusty         wind-blown dust: dust storms, dust on the panels, dust devils, a sunlight forecast
  //   comms         'near' (a fixed delay of about a second) | 'orbit' (worked out from where the planets
  //                 really are today, js/spaceweather.js) | 'relay' (a ship in orbit relays, Earth is far)
  //   spaceWeather  whose real NASA storm records the planet replays: 'earth' (Earth and the Moon) | 'mars', or
  //                 'star' for a made-up star (.star) whose storms the game invents (js/spaceweather.js star)
  //   weatherKinds  the names of this planet's good, middle and bad weather in .env, plus its rare dark day
  //   colors        the colours every 3D file shares: soil (bags, dug ground) and the dust boots and wheels kick up
  //   like          (a new planet) the existing planet it borrows from whenever a table has no entry for it
  //   fictional     a made-up planet: every screen that presents it says so
  //   creature      (a made-up planet) the made-up animal that lives there: 'ray' (js/sandray.js)
  //   waterWords    where its new water comes from, in the words the screens use (see JA.waterWords): left out = ice
  // What the outpost's new water comes out of, in the words every screen uses: ice chunks from ice drills (the Moon,
  // Mars), or a planet's own (Sahrun: sealed cans of underground water from well pumps). Inside, both are the 'ice' item.
  JA.WATER_WORDS = { chunk: 'ice chunk', chunks: 'ice chunks', a: 'an ice chunk', stuff: 'ice', Stuff: 'Ice', rig: 'ice drill', rigs: 'ice drills', at: 'drill', hand: 'drill by hand', icon: '🧊' };
  JA.waterWords = function (x) { return (x && JA.siteOf(x).waterWords) || JA.WATER_WORDS; };
  JA.iceWell = function (x) { return !!(x && JA.siteOf(x).waterWords); };      // true: well water, not ice
  // An item's name and icon on this planet (an 'ice' item is a water can on a well planet)
  JA.itemDef = function (type, x) {
    if (type === 'ice' && JA.iceWell(x)) { var w = JA.waterWords(x); return { name: w.chunk, icon: w.icon }; }
    return JA.ITEMS[type];
  };
  // Who is on the other end of the radio: 'Earth', or (comms 'relay') 'the relay ship' in orbit. cap: to start a sentence.
  JA.homeName = function (x, cap) { return JA.siteOf(x).comms === 'relay' ? (cap ? 'The relay ship' : 'the relay ship') : 'Earth'; };
  JA.siteOf = function (x) {
    var id = typeof x === 'string' ? x : !x ? '' : x.site ? (typeof x.site === 'string' ? x.site : x.site.id) : x.id;
    return JA.SITES[id] || JA.SITES.mars;
  };
  JA.hasAir = function (x) { return JA.siteOf(x).atmosphere !== 'none'; };
  // A per-planet value: JA.pick(s, { moon: 1.62, mars: 3.71 }). x is a state, a planet, or a planet id.
  // A planet missing from the table borrows from the planet it is "like"; JA.pick.missing remembers it,
  // so the tests can list every table a new planet still has to fill in.
  JA.pick = function (x, table) {
    var p = JA.siteOf(x);
    if (Object.prototype.hasOwnProperty.call(table, p.id)) return table[p.id];
    var like = p.like || 'mars';
    if (!JA.pick.missing[p.id]) JA.pick.missing[p.id] = 0;
    JA.pick.missing[p.id]++;
    return Object.prototype.hasOwnProperty.call(table, like) ? table[like] : table.mars;
  };
  JA.pick.missing = {};
  // A text that may be the same everywhere ('...'), differ per planet ({ moon: '...', mars: '...' }) or be worked out (a function of the state).
  JA.siteText = function (v, x) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'function') return v(typeof x === 'object' && x && x.site ? x : { site: JA.siteOf(x) });
    return JA.pick(x, v) || '';
  };

  // ramp: how fast each day gets harder than the one before (see sim.dayMods).
  // doseScale: GAME scale so that a longer stay still fits on the 0–100 radiation badge.
  JA.LEVELS = {
    cadet: {
      id: 'cadet', name: 'Cadet', ages: 'Ages 7–9', sols: 5, airDrain: 30, dinner: 14, cellBonus: 1,
      stormScale: 0.6, warnBonus: 12, ease: 1.5, glitchSols: [2], crisisSols: [3, 4], ramp: 0.6, doseScale: 0.7,
      storms: [1, 4], stormsArchive: [2, 5],
      blurb: 'A 5-day mission with extra power and longer storm warnings.'
    },
    commander: {
      id: 'commander', name: 'Commander', ages: 'Ages 10–12', sols: 8, airDrain: 36, dinner: 18, cellBonus: 0,
      stormScale: 1, warnBonus: 0, ease: 1, glitchSols: [2, 4, 6, 7], crisisSols: [3, 5, 7], ramp: 1, doseScale: 0.55,
      storms: [2, 6], stormsArchive: [5, 9],
      blurb: 'An 8-day mission. Every power cell matters, and every day is tougher.'
    },
    veteran: {
      id: 'veteran', name: 'Veteran', ages: 'Ages 12+', sols: 10, airDrain: 38, dinner: 19, cellBonus: 0,
      stormScale: 1, warnBonus: -4, ease: 0.9, glitchSols: [2, 4, 6, 7, 8, 9], crisisSols: [3, 5, 7, 9], ramp: 1.15, doseScale: 0.45,
      storms: [3, 8], stormsArchive: [7, 11],
      blurb: 'A 10-day expedition. Worn-out machines, thin supplies and four big decisions.'
    }
  };

  // How long one working day lasts in real time. The player picks this, and can change it mid-mission.
  JA.SHIFTS = [
    { id: 180, name: 'Quick', icon: '⚡', text: '3 minutes a day. For players who know the outpost well.' },
    { id: 300, name: 'Standard', icon: '⏱️', text: '5 minutes a day. Enough time for the main jobs.' },
    { id: 480, name: 'Relaxed', icon: '🌤️', text: '8 minutes a day. Time to explore and try everything.' },
    { id: 720, name: 'Explorer', icon: '🧭', text: '12 minutes a day. No rush at all.' }
  ];

  // GAME rules, all in one place so they are easy to tune and to explain.
  JA.RULES = {
    dayLength: 300,                // seconds of play for one working day (the player can change it)
    startAir: 65, startFood: 45,
    morningCells: 2, chargeSpan: 0.72, rackMax: 4, effMin: 0.5,
    airPerIce: 14, iceTime: 6, airCharges: 3, hopperMax: 4,
    beds: 4, growSols: 1.15, foodPerCrate: 13, waterSols: 1.2,
    bagsPerCell: 4, bagInterval: 2.2, shieldSlots: 16, wallBlock: 0.25, bagBlock: 0.035,
    labCharges: 3, analyzeTime: 8, labQueue: 4,
    roverPerCell: 100, roverMax: 200, roverBed: 4,
    // warnNoDish: with the dish off, nobody on Earth can warn you; only the suit sensor notices, when the particles
    // are already arriving (a few seconds to get moving). The Radiation Watcher catches the first, fastest particles.
    stormDuration: 28, warnDish: 45, warnNoDish: 3, radWarn: 10,
    sprintAir: 1.5, lateAir: 6,
    // --- the CO2 filter: it fills as the crew breathes; a power cell at the Air Scrubber bakes it clean ---
    filterPerAir: 0.9,             // filter used up for each point of air breathed (so running fills it faster too)
    filterWarn: 30, filterFull: 85, staleRate: 1.35,    // with a full filter the tanks must push out a third more air
    // --- water: one tank for the crew and the plants; only ice adds new water ---
    waterPerIce: 30, waterWarn: 15, crewWater: 30,      // what the crew uses in a day, before recycling
    dewWater: 16,                                       // REAL: fog nets in Chile's Atacama Desert catch a few litres per square metre on a good night. GAME: a full can of dew
    recycle: 0.9, recycleMin: 0.75,                     // REAL: the Space Station gets back about 98%. GAME: 90%, wearing down a little each day
    dryDinner: 4,                                       // extra food eaten when there is no water to cook dried food with
    // --- soil bags also block the skylights: past the free ones, each bag costs a little solar power ---
    bagsFreeShade: 8, bagShade: 0.015,
    // --- wear that comes from how you treat the tools ---
    jamWear: 0.08, jamWearMax: 0.4,                     // each drill jam makes the drill heat this much faster, for good
    flatWear: 0.1, flatWearMax: 0.3,                    // each time the rover battery runs flat it holds this much less
    scarPerLevel: 0.01, scarMax: 0.08,                  // solar power lost for good after a medium or big solar storm
    // --- dust devils (Mars): most just wander past. REAL: now and then one crossed Spirit's or Opportunity's
    //     panels and blew dust off — a rare gift, not a routine. GAME: at most once a mission, and only part of the dust.
    devilChance: 0.65, devilClean: 0.35, devilLead: 9,
    whyGap: 18,                                         // seconds between two "why did that happen?" cards
    // --- what the science teaches: the first core studied at each geology site unlocks one of these for good (GAME sizes)
    perkAir: 4, perkWater: 10, perkBag: 0.01, perkDrill: 0.75,
    // --- a gentler first day: the crew started two beds of seedlings on the way down, and packed one more dinner.
    //     Food then depends on lamps, water and crop choices more than on how fast a young player can run.
    seedlings: 2, seedlingGrowth: 0.4, extraFood: 10,
    // --- the ice drill: you start it, it works by itself, and the chunk pops out ---
    iceDrillTime: 7, iceDrillRest: 5,                   // seconds of drilling for one chunk, then seconds of cooling before the next
    // --- rover crashes ---
    crashSoft: 3.5, crashHard: 8,                       // metres a second into an obstacle: a bump, and a real crash
    crashCharge: 12,                                    // seconds of battery shaken out of a connector by a real crash
    // --- the town that grows beside the outpost (js/colony.js draws it) ---
    townDays: [0, 2, 3, 4, 6, 8],                       // self-sustaining days that bring each stage
    townPeople: [0, 0, 4, 12, 30, 80],                  // inhabitants at each stage
    townAir: 0.03,                                      // extra breathing for each stage with people in it: they share your air plant
    spiritStart: 60, spiritUp: 12, spiritDown: 18,      // town spirit: up after a self-sustaining day, down after a day that was not
    spiritHelp: 60, spiritGift: 80, spiritLow: 35, townDinner: 3,
    // --- Pioneer mode: fewer supplies, but you can break rocks and build ---
    pioneerCells: 1, pioneerAir: 10, pioneerFood: 8, pioneerWater: 8
  };

  // ---------- Pioneer mode: what rock gives, and what you can build with it ----------
  // Real idea: "in-situ resource use". Moon and Mars rock is mostly oxygen, silicon, iron and aluminium.
  // All costs and effects are GAME numbers.
  JA.MATS = {
    rock: { name: 'rubble', icon: '🪨' },
    metal: { name: 'metal', icon: '🔩' },
    glass: { name: 'glass sand', icon: '💎' }
  };
  JA.BUILDS = {
    panel: { name: 'Solar panel', icon: '☀️', cost: { metal: 2, glass: 3 }, max: 3, src: 'artemis',
      text: 'One more panel for the Solar Rack: about 0.7 more power cells every day.',
      why: 'Solar cells are made of silicon, the most common element in Moon and Mars soil after oxygen.' },
    battery: { name: 'Battery bank', icon: '🔋', cost: { metal: 3, rock: 1 }, max: 2, src: 'artemis',
      text: 'The Solar Rack can hold 2 more power cells.',
      why: 'Saved power is what carries a crew through a dust storm or a day without Sun.' },
    cistern: { name: 'Water cistern', icon: '💧', cost: { rock: 3, metal: 1 }, max: 2, src: 'iss',
      text: 'The water tank holds half as much again.',
      why: 'Stored water is a reserve for dry days. A wall of water is also good shielding against radiation.' },
    berm: { name: 'Brick wall', icon: '🧱', cost: { rock: 5 }, max: 4, src: 'artemis',
      text: 'A wall of baked-soil bricks: 5% more shield for the home, and it covers no skylight.',
      why: 'Engineers have baked copies of Moon soil into hard bricks using nothing but heat. No water, no cement.' },
    rig: { name: 'Ice drill rig', icon: '🧊', cost: { metal: 3, glass: 1 }, max: 2, where: 'ice', src: 'artemis',
      text: 'Built on the ice field, it digs out an ice chunk all by itself every little while.',
      why: 'NASA built a one-metre drill called TRIDENT to look for ice under the soil at the Moon\'s south pole.',
      sahrun: { name: 'Well pump', icon: '💧', src: 'earthobs', text: 'Built at the Deep Well, it pumps up a can of water all by itself every little while.',
        why: 'Real desert farms pump water up from aquifers hundreds of metres down, using pumps that run on sunlight.' } },
    turbine: { name: 'Wind turbine', icon: '🌀', cost: { metal: 4, glass: 1 }, max: 1, site: 'mars', src: 'mars',
      text: 'On dusty and stormy days it adds about 1 power cell: the wind blows when the Sun is hidden.',
      why: 'Mars air is very thin, but studies show its winds could still turn a light turbine when dust hides the Sun.' },
    mirror: { name: 'Sun mirror', icon: '🪞', cost: { metal: 2, glass: 4 }, max: 1, site: 'moon', src: 'artemis',
      text: 'A mirror on a tall mast bounces sunlight onto the panels: about 1 more power cell on shadow days, and more in the long dark.',
      why: 'At the Moon\'s south pole, high ground stays sunlit while low ground is dark. A mirror up high can share the light.' },
    filter: { name: 'Spare filter bed', icon: '🫧', cost: { metal: 1, glass: 2 }, max: 1, src: 'iss',
      text: 'A second CO₂ filter beside the first: together they fill a third more slowly.',
      why: 'The Space Station works the same way: one bed soaks up carbon dioxide while the other is baked clean.' }
  };

  // Two crops with different trade-offs. growSols: days of light and water until ripe. food: what one crate
  // adds to the pantry. drink: water one bed drinks in a day of growing. All GAME numbers.
  JA.CROPS = {
    lettuce: { id: 'lettuce', name: 'lettuce', icon: '🥬', growSols: 0.8, food: 10, drink: 8, crate: 'lettuce crate', line: 'ready fast, small crate' },
    potato: { id: 'potato', name: 'potatoes', icon: '🥔', growSols: 1.6, food: 24, drink: 6, crate: 'potato crate', line: 'slow, big crate' }
  };

  JA.MACHINES = {
    rack: { name: 'Solar Rack', icon: '☀️', color: '#ffd23f' },
    air: { name: 'Air Maker', icon: '💨', color: '#4fd8ff' },
    food: { name: 'Greenhouse', icon: '🥬', color: '#7be36a' },
    bag: { name: 'Soil Bagger', icon: '🛡️', color: '#c9a6ff' },
    lab: { name: 'Science Lab', icon: '🔬', color: '#ffb84d' },
    comms: { name: 'Radio Dish', icon: '📡', color: '#ff8fb8' },
    rover: { name: 'Rover', icon: '🚙', color: '#9fe8ff' },
    scrub: { name: 'Air Scrubber', icon: '🫧', color: '#8fe8d0' }
  };

  JA.ITEMS = {
    cell: { name: 'power cell', icon: '🔋' },
    ice: { name: 'ice chunk', icon: '🧊' },
    dew: { name: 'can of dew', icon: '💧' },
    bag: { name: 'soil bag', icon: '🧱' },
    core: { name: 'rock core', icon: '🧪' },
    crate: { name: 'veggie crate', icon: '🥬' },
    inst: { name: 'instrument', icon: '📦' },
    'case': { name: 'sample case', icon: '🧳' }
  };

  // ---------- Geology sites: two rock cores each, every core reveals a real finding ----------
  JA.GEO = {
    moon: [
      { name: 'Boulder Field', icon: '🪨', perk: { kind: 'bags', text: 'Useful! Crushed breccia packs tight, so the crew now fills soil bags with it: denser bags block a little more radiation.' }, finds: [
        { title: 'A piece of the first Moon crust', src: 'apollo',
          text: 'This pale rock is anorthosite, part of the Moon\'s very first crust. Apollo 15 astronauts found one about 4 billion years old and nicknamed it the Genesis Rock.' },
        { title: 'Smash-up rock', src: 'apollo',
          text: 'This is a breccia: broken bits of rock welded together by the heat of a meteorite crash. Many of the rocks Apollo brought home are breccias.' }] },
      { name: 'Bead Patch', icon: '✨', perk: { kind: 'air', text: 'Useful! Moon soil is almost half oxygen, locked in minerals. These beads give theirs up more easily when heated, so the Air Maker now adds a scoop to each ice chunk: more air every time.' }, finds: [
        { title: 'Volcanic glass beads', src: 'apollo',
          text: 'Tiny orange beads of glass! Apollo 17 found soil like this. The beads sprayed out of fire fountains on the Moon more than 3 billion years ago.' },
        { title: 'Dust as sharp as glass', src: 'apollo',
          text: 'Moon dust is sharp like tiny bits of broken glass, because there is no wind or water to smooth it. It scratched the Apollo astronauts\' suits and visors.' }] },
      { name: 'Crater Wall', icon: '🌑', perk: { kind: 'drill', text: 'Useful! Now you know where the hard layers are, so the drill can start in softer rock: it heats up more slowly.' }, finds: [
        { title: 'Layers of crashes', src: 'moon',
          text: 'This wall shows layers of rock thrown out by older impacts. With no weather on the Moon, craters stay sharp for billions of years.' },
        { title: 'Bootprints that last', src: 'apollo',
          text: 'The bootprints you leave here could last for millions of years. There is no wind or rain on the Moon to wipe them away.' }] },
      { name: 'Deep Freeze', icon: '🧊', perk: { kind: 'water', text: 'Useful! You mapped the ice-rich layer, so every ice chunk you dig now holds more water.' }, finds: [
        { title: 'Water ice in the soil', src: 'moon',
          text: 'Ice mixed into the soil! In 2009 NASA\'s LCROSS mission crashed a rocket stage into a dark polar crater and found water in the cloud it kicked up.' },
        { title: 'One of the coldest places known', src: 'lro',
          text: 'The floors of some polar craters never see the Sun. NASA\'s Lunar Reconnaissance Orbiter measured about −240°C there.' }] }
    ],
    mars: [
      { name: 'Striped Mesa', icon: '🏜️', perk: { kind: 'drill', text: 'Useful! The old lake mud is soft, layered rock. Now you know where it is, so the drill can start there: it heats up more slowly.' }, finds: [
        { title: 'Pebbles from a stream', src: 'msl',
          text: 'Smooth, rounded pebbles stuck in rock. In 2012 the Curiosity rover found ones like these — an ancient stream bed. Water once flowed on Mars!' },
        { title: 'Mud from a lake', src: 'msl',
          text: 'These thin layers are hardened mud, like the layers Curiosity drilled in Gale Crater, which held a lake billions of years ago.' }] },
      { name: 'Blueberry Flats', icon: '🫐', perk: { kind: 'bags', text: 'Useful! Hematite is a heavy iron mineral. Soil bags with it in are denser, so each one blocks a little more radiation.' }, finds: [
        { title: 'Martian "blueberries"', src: 'mer',
          text: 'Tiny grey balls! In 2004 the Opportunity rover found "blueberries" like these, made of a mineral called hematite that usually forms in water.' },
        { title: 'Rusty dust', src: 'mars',
          text: 'Mars looks red because its dust is full of iron that has rusted — a bit like an old bike left out in the rain.' }] },
      { name: 'White Vein Rocks', icon: '🤍', perk: { kind: 'water', text: 'Useful! Gypsum holds water inside its crystals: about a fifth of its weight. Warmed with the ice, it adds more water from every chunk.' }, finds: [
        { title: 'A vein left by water', src: 'mer',
          text: 'A bright white stripe in the rock. Opportunity found a vein like this in 2011: the mineral gypsum, left behind by water trickling through a crack.' },
        { title: 'Cooled lava', src: 'mars',
          text: 'This dark rock is basalt — cooled lava. Mars has the tallest volcano in the solar system, Olympus Mons, about two and a half times as high as Mount Everest.' }] },
      { name: 'Ice Pit', icon: '🧊', perk: { kind: 'air', text: 'Useful! This ice is very pure, with little dust or salt in it, so the Air Maker gets more oxygen out of every chunk.' }, finds: [
        { title: 'Ice under the soil', src: 'phoenix',
          text: 'Bright ice just under the soil! In 2008 NASA\'s Phoenix lander dug a small trench on Mars and found water ice like this.' },
        { title: 'Ice that vanishes', src: 'phoenix',
          text: 'Phoenix watched little chunks of ice disappear over a few days. In Mars\'s thin air, ice turns straight into gas without melting first.' }] }
    ],
    // Sahrun is made up, so its rocks tell what real deserts (on Earth and on Mars) are made of
    sahrun: [
      { name: 'Wind-Carved Rocks', icon: '🪨', perk: { kind: 'drill', text: 'Useful! The wind has worn these rocks soft on one side. Now you know where, so the drill can start there: it heats up more slowly.' }, finds: [
        { title: 'Rocks carved by the wind', src: 'msl',
          text: 'These rocks have sharp, polished faces, sanded flat by wind-blown grit over thousands of years. They are called ventifacts. NASA\'s Curiosity rover photographed rocks just like them on Mars.' },
        { title: 'A coat of desert varnish', src: 'earthobs',
          text: 'The shiny dark skin on this rock is desert varnish: a coat of clay, iron and manganese only a hair thick, built up over thousands of years in the dry deserts of Earth.' }] },
      { name: 'Glass Field', icon: '✨', perk: { kind: 'bags', text: 'Useful! Crushed glassy sand packs tight, so the crew now fills soil bags with it: denser bags block a little more radiation.' }, finds: [
        { title: 'Glass made by lightning', src: 'earthobs',
          text: 'These knobbly glass tubes are fulgurites. A lightning bolt is about five times hotter than the surface of the Sun. When one strikes dry sand, it melts the sand into glass along its path.' },
        { title: 'Sparks inside a sandstorm', src: 'earthobs',
          text: 'Blowing sand can make its own electricity: grains rubbing together build up a charge, like a balloon rubbed on your hair. On Earth, dust storms and volcanic ash clouds can crackle with lightning.' }] },
      { name: 'Salt Flat', icon: '🤍', perk: { kind: 'water', text: 'Useful! These salts hold a little water inside their crystals. Warmed in the tank they let it go, so every can of water goes further.' }, finds: [
        { title: 'A lake that dried up', src: 'mars',
          text: 'This white crust is salt, left behind when an old lake dried up. Salt flats like the Bonneville flats in Utah form this way, and NASA\'s Mars Odyssey orbiter spotted old salt deposits on Mars too.' },
        { title: 'Salt that drinks the air', src: 'msl',
          text: 'Some salts pull water vapour out of the air and dissolve in it. Measurements from NASA\'s Curiosity rover suggest that tiny amounts of salty water may form this way on cold Mars nights.' }] },
      { name: 'Deep Well', icon: '💧', perk: { kind: 'air', text: 'Useful! Water from deep in the rock is filtered by the sand on its way down, so it is very clean, and the Air Maker gets more oxygen out of every can.' }, finds: [
        { title: 'Rain from long ago', src: 'earthobs',
          text: 'Deserts can hide huge stores of water in the rock below them. Under the Sahara lies the Nubian Sandstone Aquifer. Much of its water fell as rain thousands of years ago, when the Sahara was green, and soaked down into the sandstone.' },
        { title: 'Weighing water from space', src: 'grace',
          text: 'NASA\'s GRACE satellites measure tiny changes in how hard the Earth pulls. Where people pump a lot of water out of the ground, the pull there gets a little weaker, so the satellites can tell when an aquifer is running dry.' }] }
    ]
  };

  // ---------- Science instruments to carry out and set up ----------
  JA.INSTRUMENTS = {
    moon: [
      { id: 'seismo', name: 'Moonquake Sensor', icon: '〰️', src: 'apollo',
        text: 'Apollo astronauts left seismometers on the Moon that felt thousands of moonquakes. They showed the Moon is still slowly shrinking as it cools.' },
      { id: 'beam', name: 'Laser Mirror', icon: '🪞', src: 'apollo',
        text: 'Apollo crews left mirrors on the Moon. Scientists still bounce lasers off them, and found the Moon drifts 3.8 cm farther from Earth every year.' },
      { id: 'rad', name: 'Radiation Watcher', icon: '☢️', src: 'lro', perk: 'Solar storm warnings now arrive 10 seconds earlier.',
        text: 'NASA\'s Lunar Reconnaissance Orbiter carries a radiation sensor called CRaTER. Yours works on the ground and spots solar storms sooner.' }
    ],
    mars: [
      { id: 'seismo', name: 'Marsquake Sensor', icon: '〰️', src: 'insight',
        text: 'NASA\'s InSight lander put a seismometer on Mars and felt more than 1,300 marsquakes. They revealed that Mars has a liquid metal core.' },
      { id: 'beam', name: 'Weather Station', icon: '🌡️', src: 'm2020', perk: 'You now get tomorrow\'s sunlight forecast every night.',
        text: 'The Perseverance rover carries a weather station called MEDA that measures wind, temperature and dust.' },
      { id: 'rad', name: 'Radiation Watcher', icon: '☢️', src: 'rad', perk: 'Solar storm warnings now arrive 10 seconds earlier.',
        text: 'The Curiosity rover carries a sensor called RAD. It was the first to measure radiation on the surface of Mars.' }
    ],
    sahrun: [
      { id: 'seismo', name: 'Sandquake Sensor', icon: '〰️', src: 'insight',
        text: 'NASA\'s InSight lander put a seismometer on Mars and felt more than 1,300 marsquakes. A sensor like it can feel the ground shake from far away, even through sand.' },
      { id: 'beam', name: 'Weather Station', icon: '🌡️', src: 'm2020', perk: 'You now get tomorrow\'s sunlight forecast every night.',
        text: 'The Perseverance rover carries a weather station called MEDA that measures wind, temperature and dust. On a desert world, knowing when a sandstorm is coming matters most.' },
      { id: 'rad', name: 'Radiation Watcher', icon: '☢️', src: 'rad', perk: 'Solar storm warnings now arrive 10 seconds earlier.',
        text: 'The Curiosity rover\'s RAD sensor was the first to measure radiation on the ground of another planet. Thick air like Sahrun\'s blocks more of it, but never all.' }
    ]
  };

  JA.PHOTOS = {
    moon: [
      { name: 'Earth View', src: 'moon', text: 'From here Earth hangs low in the black sky. It hardly ever moves, because the Moon always keeps the same face toward Earth.' },
      { name: 'Edge of Darkness', src: 'lro', text: 'The real Shackleton Crater is about 21 km wide and 4 km deep — deeper than the Grand Canyon.' }
    ],
    mars: [
      { name: 'Big Sky', src: 'mars', text: 'On Mars the daytime sky is butterscotch-colored and the sunsets are blue — the opposite of Earth.' },
      { name: 'Moon Spotting', src: 'mars', text: 'Mars has two tiny potato-shaped moons, Phobos and Deimos. Phobos races around Mars about three times a day.' }
    ],
    sahrun: [
      { name: 'Sea of Dunes', src: 'earthobs', text: 'A sea of sand like this is called an erg. The biggest one on Earth, the Rub\' al Khali in Arabia, is larger than the whole of France.' },
      { name: 'Two Moons', src: 'mars', text: 'Made-up Sahrun has two moons, and so does the real Mars. But Mars\'s moons, Phobos and Deimos, are tiny lumps of rock only 22 and 12 km across.' }
    ]
  };

  // ---------- One new thing to learn every day ----------
  // A mission of N days uses the first N-1 entries, then LAUNCH_DAY. Each day has a real-science
  // lesson and a challenge that puts the lesson to work. goal.id is checked in sim.dayGoalDone().
  JA.DAYS = [
    { icon: '👣', title: 'First steps', topic: 'Living off the land', src: 'artemis',
      learn: { moon: 'Astronauts cannot bring everything from Earth. They must use what is already there: sunlight for power, and ice for air and water. Engineers call this "living off the land".',
        mars: 'Astronauts cannot bring everything from Earth. They must use what is already there: sunlight for power, and ice for air and water. Engineers call this "living off the land".',
        sahrun: 'Astronauts cannot bring everything from home. They must use what is already there: sunlight for power, and water from deep underground for air and drinking. Engineers call this "living off the land".' } },
    { icon: '🛡️', title: 'Shield up', topic: 'Invisible radiation', src: 'artemis',
      learn: 'Radiation is invisible energy from the Sun and from deep space. On Earth, thick air and a magnetic field protect us. Out here only mass can stop it: thick walls, or bags of soil piled on the roof.',
      goal: { id: 'bags', n: 5, text: 'Put 5 soil bags on the dome today' } },
    { icon: '🧪', title: 'Rock detective', topic: 'Rocks are history books', src: { mars: 'm2020', moon: 'apollo', sahrun: 'msl' },
      learn: 'A rock core is a thin tube of rock pulled out with a drill. Its layers stay in order, so scientists can read what happened long ago: lava, floods, or giant crashes.',
      goal: { id: 'cores', n: 2, text: 'Get 2 rock cores studied in the Lab today' } },
    { icon: '📡', title: 'Calling home', topic: 'The speed of light', src: { mars: 'mars', moon: 'moon', sahrun: 'iss' },
      learn: 'Radio waves travel at the speed of light, the fastest speed there is, and it is still not instant. The farther you are from Earth, the longer every question and answer takes.',
      goal: { id: 'dish', text: 'Power the Radio Dish before midday' } },
    { icon: '🥬', title: 'Space farmer', topic: 'Plants in space', src: 'iss',
      learn: 'Plants give a crew fresh food, fresh oxygen and a little piece of home. On the Space Station astronauts have grown lettuce, radishes and even chili peppers.',
      goal: { id: 'crates', n: 2, text: 'Store 2 veggie crates today' } },
    { icon: '☀️', title: 'Sun chaser', topic: 'Keeping the power on', src: { mars: 'insight', moon: 'artemis', sahrun: 'insight' },
      learn: { mars: 'Dust slowly settles on solar panels and blocks the light. NASA\'s InSight lander lost its power this way. Clean panels mean more power cells.',
        moon: 'At the Moon\'s south pole the Sun never climbs high. It circles low around the horizon, so solar panels must keep turning to face it.',
        sahrun: 'Blowing sand settles on solar panels and blocks the light. NASA\'s InSight lander on Mars slowly lost its power this way. Clean panels mean more power cells.' },
      goal: { id: 'panels', n: 3, text: 'Look after all 3 solar panels today' } },
    { icon: '🛰️', title: 'Science station', topic: 'Machines that keep watching', src: 'apollo',
      learn: 'Instruments keep working long after astronauts go home. Scientists still bounce lasers off the mirrors that Apollo crews left on the Moon more than 50 years ago.',
      goal: { id: 'inst', n: 3, text: 'Have all 3 science instruments working by tonight' } },
    { icon: '🚙', title: 'Road trip', topic: 'Going farther', src: 'apollo',
      learn: 'A rover lets a crew carry more and explore much farther than on foot. The Apollo 17 astronauts drove their Moon buggy about 36 km.',
      goal: { id: 'ice', n: 4, text: { moon: 'Bring 4 ice chunks to the machines today', mars: 'Bring 4 ice chunks to the machines today', sahrun: 'Bring 4 water cans to the machines today' } } },
    { icon: '🧳', title: 'Pack for home', topic: 'Samples for Earth', src: 'apollo',
      learn: 'The Apollo crews brought home 382 kg of Moon rock, and scientists are still studying it today. Samples carried to Earth can be tested with machines far too big to fly.',
      goal: { id: 'studied', n: 8, text: 'Finish studying all 8 rock cores' } }
  ];
  JA.LAUNCH_DAY = { icon: '🚀', title: 'Launch day', topic: 'The ride home', src: 'artemis',
    learn: 'Leaving is as hard as landing. The rocket must lift off on time to meet the ship that carries the crew back to Earth, so nothing can be left for later.' };

  // ---------- Things that break ----------
  JA.REPAIRS = {
    air: { title: 'The Air Maker jammed!', text: 'A valve froze shut. No new air until it is fixed.' },
    food: { title: 'Greenhouse pump stuck!', text: 'The water pump stopped. Plants cannot grow until it is fixed.' },
    lab: { title: 'The Lab arm is stuck!', text: 'The robot arm that loads rock cores froze. No analysis until it is fixed.' },
    rack: { title: 'Loose solar cable!', text: 'A cable came loose. The Solar Rack cannot charge cells until it is fixed.' }
  };

  // ---------- Facts for the night report ----------
  JA.FACTS = [
    { id: 'sol', site: 'mars', tags: ['any'], src: 'mars', text: 'A day on Mars is called a "sol". It lasts 24 hours and 39 minutes — a little longer than a day on Earth.' },
    { id: 'moxie', site: 'mars', tags: ['air'], src: 'm2020', text: 'A real machine called MOXIE rode on the Perseverance rover and made oxygen out of Mars air: 122 grams in total. That is about what a small dog breathes in 10 hours!' },
    { id: 'rad', site: 'mars', tags: ['dose'], src: 'rad', text: 'The Curiosity rover\'s RAD sensor measured about 0.67 millisieverts of radiation every day on Mars — far more than you get on Earth.' },
    { id: 'sep2017', site: 'mars', tags: ['storm'], src: 'rad', text: 'In September 2017 a solar storm reached Mars. Curiosity\'s sensor saw the radiation on the ground double!' },
    { id: 'oppy', site: 'mars', tags: ['dust'], src: 'mer', text: 'In 2018 a dust storm covered the whole planet of Mars. The solar-powered Opportunity rover could not charge and went silent after almost 15 years of exploring.' },
    { id: 'insight', site: 'mars', tags: ['dust', 'power', 'repair'], src: 'insight', text: 'NASA\'s InSight lander slowly lost power as dust piled up on its solar panels. Its mission ended in 2022.' },
    { id: 'devil', site: 'mars', tags: ['dust', 'power'], src: 'mer', text: 'Whirlwinds called dust devils sometimes blew the dust off the Spirit and Opportunity rovers\' solar panels, giving them a free power boost.' },
    { id: 'marsdelay', site: 'mars', tags: ['comms', 'repair'], src: 'mars', text: 'Radio waves travel at the speed of light, but Mars is so far away that a message takes 3 to 22 minutes to arrive. Astronauts there must solve many problems on their own.' },
    { id: 'marsgrav', site: 'mars', tags: ['any'], src: 'mars', text: 'Gravity on Mars is about 38% of Earth\'s. That is why you can jump and throw more than twice as far here.' },
    { id: 'tubes', site: 'mars', tags: ['science'], src: 'm2020', text: 'The Perseverance rover drills rock cores and seals them in metal tubes, so a future mission can carry them back to Earth.' },
    { id: 'spirit', site: 'mars', tags: ['rover'], src: 'mer', text: 'In 2009 the Spirit rover got stuck in soft Martian soil. Engineers on Earth tried for months to drive it free.' },
    { id: 'moondelay', site: 'moon', tags: ['comms', 'repair'], src: 'moon', text: 'The Moon is about 384,000 km away. A radio message gets there in about 1.3 seconds, so Moon crews can talk with Earth almost like a phone call.' },
    { id: 'moongrav', site: 'moon', tags: ['any'], src: 'moon', text: 'The Moon\'s gravity is one-sixth of Earth\'s. A throw that goes 6 metres on Earth flies about 36 metres here!' },
    { id: 'lcross', site: 'moon', tags: ['ice', 'air'], src: 'moon', text: 'In 2009 NASA\'s LCROSS mission found water ice inside a dark crater near the Moon\'s south pole. Ice can be turned into drinking water and oxygen.' },
    { id: 'moontemp', site: 'moon', tags: ['power'], src: 'moon', text: 'In sunlight the Moon\'s surface can reach 121°C. In darkness it drops to about −133°C. Machines need power just to stay warm.' },
    { id: 'apollo72', site: 'moon', tags: ['storm'], src: 'apollo', text: 'In August 1972 a huge solar storm blasted the Moon — luckily between the Apollo 16 and Apollo 17 missions, so no astronauts were walking on it.' },
    { id: 'lnd', site: 'moon', tags: ['dose'], src: 'lnd', text: 'A sensor on the Moon\'s surface measured about 1.4 millisieverts of radiation every day. The Moon has no air and no magnetic shield to block it.' },
    { id: 'artemis', site: 'moon', tags: ['any'], src: 'artemis', text: 'NASA\'s Artemis program is aiming for the Moon\'s south pole — the same kind of place as your outpost — because of its sunlight and its ice.' },
    { id: 'regolith', site: 'any', tags: ['shield'], src: 'artemis', text: 'Loose space soil is called regolith. Engineers study piling regolith over habitats, because thick soil is a great radiation shield — and it is free!' },
    { id: 'lunarrover', site: 'moon', tags: ['rover'], src: 'apollo', text: 'Apollo 15, 16 and 17 each brought an electric Moon buggy. Apollo 17\'s crew drove theirs about 36 km in total.' },
    { id: 'flareclass', site: 'any', tags: ['storm'], src: 'donki', text: 'Scientists sort solar flares into classes: A, B, C, M and X. Each letter is 10 times stronger than the one before. X is the strongest.' },
    { id: 'sepcme', site: 'any', tags: ['storm', 'dose'], src: 'donki', text: 'A big flare does not always mean danger. The radiation that hurts astronauts is fast protons, mostly pushed by the shock wave of a cloud of solar gas (a CME). They follow the Sun\'s magnetic field, so they only reach places linked to the eruption.' },
    { id: 'mars2024', site: 'mars', tags: ['storm', 'dose'], src: 'storm2024', text: 'On 20 May 2024 a storm from the far side of the Sun, where Earth could not see it, hit Mars. NASA\'s Curiosity rover measured its biggest radiation surge in 12 years: like about 30 chest X-rays at once.' },
    { id: 'invisible', site: 'any', tags: ['storm', 'dose'], src: 'donki', text: 'You cannot see or feel space radiation. Astronauts carry small sensors called dosimeters that count it for them — like your radiation badge.' },
    { id: 'electro', site: 'any', tags: ['air', 'ice'], src: 'iss', text: 'Water is made of hydrogen and oxygen. The Space Station uses electricity to split water apart and give the crew oxygen to breathe.' },
    { id: 'water', site: 'any', tags: ['food', 'any'], src: 'iss', text: 'On the International Space Station, machines recycle about 98% of the water — even sweat and pee — back into clean drinking water.' },
    { id: 'veggie', site: 'any', tags: ['food'], src: 'iss', text: 'Astronauts first ate space-grown lettuce on the Space Station in 2015. The "Veggie" garden glows pink because plants love red and blue light.' },
    { id: 'plants', site: 'any', tags: ['food'], src: 'osdr', text: 'NASA\'s Open Science Data Repository shares data from hundreds of space biology experiments — including how plants grow without normal gravity.' },
    { id: 'bones', site: 'any', tags: ['any'], src: 'osdr', text: 'In low gravity, astronauts can lose 1% of their bone strength every month. They exercise about 2 hours every day to stay strong.' },
    { id: 'apollo13', site: 'any', tags: ['repair', 'air', 'filter'], src: 'apollo', text: 'On Apollo 13 the air filters started to fail. The crew built a new filter holder out of plastic bags, cardboard and duct tape — and it worked.' },
    { id: 'cdra', site: 'any', tags: ['filter'], src: 'iss', text: 'The Space Station cleans its air with beads that trap carbon dioxide. When the beads are full, a heater bakes the gas back out so they can be used again — just like your Air Scrubber.' },
    { id: 'peppers', site: 'any', tags: ['crop', 'food'], src: 'iss', text: 'In 2021 astronauts grew chili peppers on the Space Station. It took 137 days, one of the longest plant experiments ever done in space. Slow crops need patience!' },
    { id: 'lunarnight', site: 'moon', tags: ['dark', 'power'], src: 'apollo', text: 'Every Apollo crew landed in the lunar morning and left long before sunset. Nobody has ever spent a night on the Moon: away from the poles it lasts two weeks.' },
    { id: 'urine', site: 'any', tags: ['water'], src: 'iss', text: 'Astronauts like to say that on the Space Station, yesterday\'s coffee becomes tomorrow\'s coffee. The recycled water is cleaner than most tap water on Earth.' },
    // Sahrun (made up): the facts are real science from Earth's deserts, the Space Station and Mars
    { id: 'sahrun', site: 'sahrun', tags: ['any'], src: 'fiction', text: 'Sahrun is a made-up planet, inspired by the desert worlds of science fiction. But the science you meet here is real: it comes from deserts on Earth and from Mars.' },
    { id: 'fossilwater', site: 'sahrun', tags: ['ice', 'water'], src: 'earthobs', text: 'Wells deep in the Sahara pump up water that fell as rain thousands of years ago. Once it is pumped out, it can take thousands of years for rain to fill the rock again. That is why desert towns treat every drop as treasure.' },
    { id: 'fognets', site: 'sahrun', tags: ['water', 'ice'], src: 'earthobs', text: 'In Chile\'s Atacama Desert, one of the driest places on Earth, people hang fine nets in the morning fog. Tiny drops stick to the mesh and drip into pipes: drinking water caught from thin air.' },
    { id: 'haboob', site: 'sahrun', tags: ['dust', 'storm'], src: 'earthobs', text: 'A haboob is a wall of dust and sand pushed ahead of a thunderstorm. On Earth they can tower more than a kilometre high and swallow a whole city in minutes.' },
    { id: 'desertsun', site: 'sahrun', tags: ['dust', 'power'], src: 'earthobs', text: 'Deserts get more sunshine than anywhere else on Earth, so some of the biggest solar farms are built there. Their worst enemy is the same as yours: sand on the panels.' },
    { id: 'desertnight', site: 'sahrun', tags: ['any'], src: 'earthobs', text: 'Deserts are blazing by day and cold at night, because dry air holds very little heat. After sunset the sand gives its warmth back to the clear sky within hours.' },
    { id: 'tdrs', site: 'sahrun', tags: ['comms', 'repair'], src: 'iss', text: 'The Space Station talks to Earth through relay satellites called TDRS, flying high above the ground. Your relay ship in orbit does the same job for Sahrun.' },
    { id: 'sahrungrav', site: 'sahrun', tags: ['any'], src: 'fiction', text: 'In this game Sahrun pulls with half of Earth\'s gravity. A throw that goes 9 metres on Earth flies about 18 metres here.' },
    { id: 'softsand', site: 'sahrun', tags: ['rover'], src: 'mer', text: 'Soft sand is a trap for wheels. In 2009 NASA\'s Spirit rover sank into soft sand on Mars and never got out. On Sahrun, keep the rover on firm ground.' },
    { id: 'thickair', site: 'sahrun', tags: ['dose', 'storm'], src: 'rad', text: 'Air is a shield too. Even the thin air of Mars blocks part of the Sun\'s radiation, as NASA\'s Curiosity rover measured. Sahrun\'s thick air blocks more, so your badge fills more slowly here.' }
  ];

  // ---------- Why did that happen? ----------
  // One short explanation for each thing that can go right or wrong, shown at the moment it happens
  // (see sim.note). holo: the animated explainer the wrist tablet can project for it (js/holo.js).
  // hint: what the Field Journal says about a page nobody has found yet. site: leave out for both places.
  JA.MECHS = [
    { id: 'electro', icon: '🧊', title: { moon: 'Ice just became air', mars: 'Ice just became air', sahrun: 'Water just became air' }, holo: 'electrolysis', src: 'iss', hint: 'Make air in the Air Maker.',
      text: { moon: 'Water is made of hydrogen and oxygen. The Air Maker used electricity to pull them apart, and kept the oxygen. That is why it needs both ice and a power cell.',
        mars: 'Water is made of hydrogen and oxygen. The Air Maker used electricity to pull them apart, and kept the oxygen. That is why it needs both ice and a power cell.',
        sahrun: 'Water is made of hydrogen and oxygen. The Air Maker used electricity to pull them apart, and kept the oxygen. That is why it needs both water and a power cell.' } },
    { id: 'crop', icon: '🥔', title: 'Two kinds of seeds', holo: 'crops', src: 'iss', hint: 'Plant seeds in the Greenhouse.',
      text: 'Lettuce is all leaves: ready in under a day, but a small meal. Potatoes store energy underground: almost two days, but a big meal, and less water for every bite. You choose for each bed.' },
    { id: 'dark', icon: '💡', title: 'Plants cannot grow in the dark', holo: 'plant', src: 'iss', hint: 'Let the grow lamps run out of power.',
      text: 'Light is the energy a plant uses to turn air and water into leaves. The grow lamps are off, so the growing has stopped. They need a power cell.' },
    { id: 'dry', icon: '💧', title: 'The plants stopped growing', holo: 'plant', src: 'iss', hint: 'Let the water run out while plants are growing.',
      text: { moon: 'A plant is mostly water, and it needs more to build new leaves. With the tank empty it closes its pores and waits. Bring ice to the water tank.',
        mars: 'A plant is mostly water, and it needs more to build new leaves. With the tank empty it closes its pores and waits. Bring ice to the water tank.',
        sahrun: 'A plant is mostly water, and it needs more to build new leaves. With the tank empty it closes its pores and waits. Bring a water can to the tank.' } },
    { id: 'waterlow', icon: '🚰', title: 'The water tank is nearly empty', holo: 'water', src: 'iss', hint: 'Let the water tank run low.',
      text: { moon: 'The recycler gives back most of what the crew drinks. But growing plants keep water inside their leaves, and ice is the only new water here. Plants go thirsty first.',
        mars: 'The recycler gives back most of what the crew drinks. But growing plants keep water inside their leaves, and ice is the only new water here. Plants go thirsty first.',
        sahrun: 'The recycler gives back most of what the crew drinks. But growing plants keep water inside their leaves, and hot days sweat it away. Water from the Deep Well and dew from the catcher are the only new water here.' } },
    { id: 'thirst', icon: '🥫', title: 'Dinner without water', holo: 'water', src: 'iss', hint: 'End a day with an empty water tank.',
      text: 'Most space food is dried to save weight, and needs water to become a meal. With the tank empty, the crew had to open extra ready-made packs instead.' },
    { id: 'heat', site: 'sahrun', icon: '🥵', title: 'A hot day, a thirsty crew', holo: 'water', src: 'iss', hint: 'Work through a blazing hot day.',
      text: 'In desert heat the body cools itself by sweating, and someone working hard can lose a litre of water an hour. Real spacesuits cool their astronaut the same way: they let water evaporate away, and that water is gone for good. So a hot day drains the tank, and the recycler cannot get it back.' },
    { id: 'dew', site: 'sahrun', icon: '💧', title: 'Water out of thin air', holo: 'dew', src: 'earthobs', hint: 'Carry a can of dew to the water tank.',
      text: 'On a clear night the sand loses its heat to the open sky and gets cold. Air touching the cold net cools too, until the water vapour in it turns into drops: dew. Beetles in Africa\'s Namib Desert drink this way, and people in Chile\'s Atacama Desert catch fog with nets. Wind and sandstorms spoil it.' },
    { id: 'ray', site: 'sahrun', icon: '🪁', title: 'Sand rays are made up', src: 'fiction', hint: 'See a sand ray leap out of the dunes.',
      text: 'Sand rays are invented for this game: big, gentle animals that glide under the dunes the way manta rays glide through the sea. No animal like them has ever been found. But the sand they push really would flow: shaken sand behaves almost like a liquid.' },
    { id: 'sandswim', site: 'sahrun', icon: '🦎', title: 'Swimming through sand', src: 'sandfish', hint: 'See a sand ray leap out of the dunes.',
      text: 'Real animals do swim through sand. The sandfish, a small lizard from the Sahara Desert, dives into a dune and wiggles its body from side to side to move under the surface. Scientists filmed it with X-rays to see how.' },
    { id: 'swave', site: 'sahrun', icon: '〰️', title: 'Two waves tell the distance', holo: 'swave', src: 'insight', hint: 'Feel a sand ray coming with the Sandquake Sensor set up.',
      text: 'Shaking ground sends out two kinds of waves. The fast P wave pushes and pulls the ground; the slow S wave shakes it from side to side. The farther away the shaking, the longer the gap between them. NASA\'s InSight lander used this gap to work out how far away marsquakes were.' },
    { id: 'filterlow', icon: '🫧', title: 'The air filter is filling up', holo: 'scrubber', src: 'apollo', hint: 'Let the CO₂ filter get nearly full.',
      text: 'Every breath out adds carbon dioxide to the air indoors. The filter soaks it up like a sponge, and a sponge can only hold so much. A power cell at the Air Scrubber bakes it clean.' },
    { id: 'stale', icon: '😮‍💨', title: 'The air has gone stale', holo: 'scrubber', src: 'apollo', hint: 'Let the CO₂ filter fill up completely.',
      text: 'The filter is full, so carbon dioxide is building up indoors. To keep the crew safe, the tanks are pushing out extra fresh air. That is why the air meter is falling so fast.' },
    { id: 'sprint', icon: '🏃', title: 'Running uses up air', src: 'iss', hint: 'Run for a while (hold Shift on a keyboard).',
      text: 'Hard-working muscles burn oxygen faster. In this game, running uses air one and a half times as fast, and fills the CO₂ filter sooner too. Real spacewalkers pace themselves for the same reason.' },
    { id: 'panel', icon: '☀️', title: 'The panels are making less power', holo: 'solar', src: { mars: 'insight', moon: 'artemis', sahrun: 'insight' }, hint: 'Leave the solar panels alone for a while.',
      text: { mars: 'Dust has settled on the glass and is blocking the sunlight, so the power cells charge more slowly. Brush the panels off to get full power back.',
        moon: 'The Sun has slid along the horizon and the panels no longer face it, so the power cells charge more slowly. Turn them back toward the Sun.',
        sahrun: 'Blowing sand has settled on the glass and is blocking the sunlight, so the power cells charge more slowly. Brush the panels off to get full power back.' } },
    { id: 'rackfull', icon: '🔋', title: 'Sunshine is going to waste', src: 'iss', hint: 'Let the Solar Rack fill right up.',
      text: 'The rack holds only 4 power cells. While it is full, the electricity from the panels has nowhere to go. Take a cell and the charging starts again.' },
    { id: 'shield', icon: '🛡️', title: 'Your first soil bag', holo: 'shield', src: 'artemis', hint: 'Put a soil bag on the dome.',
      text: 'Radiation is made of tiny, fast particles. One that hits a grain of soil stops there instead of reaching the crew. So every bag on the dome blocks a little more.' },
    { id: 'shade', icon: '🧱', title: 'The bags are covering the skylights', holo: 'shade', src: 'artemis', hint: 'Pile more than 8 bags on the dome.',
      text: 'Soil stops sunlight just as well as radiation. With the skylights covered, the lamps indoors must stay on, and that takes a little of your solar power. Nothing in space is free.' },
    { id: 'dose25', icon: '☢️', title: 'Your badge is a quarter full', holo: 'dose', src: 'rad', hint: 'Fill a quarter of the radiation badge.',
      text: 'Radiation damage adds up over a whole mission, so the badge never goes down. All you can do is fill it more slowly: more soil on the dome, and indoors whenever a storm hits.' },
    { id: 'stormout', icon: '🌩️', title: 'Caught outside in the storm', holo: 'shield', src: 'donki', hint: 'Be outdoors when a solar storm hits.',
      text: { moon: 'A solar storm is a burst of fast particles from the Sun. Outdoors, only your thin suit is in their way, so the badge jumps. Indoors, the walls and soil bags stop most of them.',
        mars: 'A solar storm is a burst of fast particles from the Sun. Outdoors, only your thin suit is in their way, so the badge jumps. Indoors, the walls and soil bags stop most of them.',
        sahrun: 'A storm from a star is a burst of fast particles. Outdoors, only your thin suit and the air are in their way, so the badge jumps. Indoors, the walls and soil bags stop most of them.' } },
    { id: 'stormin', icon: '🏠', title: 'The storm you did not feel', holo: 'shield', src: 'donki', hint: 'Sit out a solar storm indoors.',
      text: { moon: 'You stayed indoors, so the walls and the soil on the dome took the hit for you. Mass between you and the Sun is the best protection there is.',
        mars: 'You stayed indoors, so the walls and the soil on the dome took the hit for you. Mass between you and the Sun is the best protection there is.',
        sahrun: 'You stayed indoors, so the walls and the soil on the dome took the hit for you. Mass between you and the star is the best protection there is.' } },
    { id: 'warn', icon: '📡', title: 'Where the warning came from', holo: 'storm', src: 'donki', hint: 'Live through a solar storm.',
      text: { moon: 'A flare\'s light crosses space in minutes. The dangerous particles come after it, sped up by the shock wave of a cloud of solar gas (a CME). Forecasters on Earth watch both and warn you before most of the particles arrive. With the Radio Dish off, only your suit sensor notices, when the particles are already here.',
        mars: 'A flare\'s light crosses space in minutes. The dangerous particles come after it, sped up by the shock wave of a cloud of solar gas (a CME). Forecasters on Earth watch both and warn you before most of the particles arrive. With the Radio Dish off, only your suit sensor notices, when the particles are already here.',
        sahrun: 'A flare\'s light crosses space in minutes. The dangerous particles come after it, sped up by the shock wave of a cloud of hot gas (a CME). Forecasters on the relay ship watch the star and warn you before most of the particles arrive. With the Radio Dish off, only your suit sensor notices, when the particles are already here.' } },
    { id: 'scar', icon: '⚡', title: 'The storm scarred the solar panels', holo: 'storm', src: 'donki', hint: 'Live through a medium or big solar storm.',
      text: 'Storm particles knock tiny flaws into solar cells, and the flaws never heal. After big storms, real satellites make a little less power for the rest of their lives. So will your panels.' },
    { id: 'jam', icon: '🔩', title: 'The drill overheated', holo: 'drill', src: { moon: 'apollo', mars: 'msl', sahrun: 'msl' }, hint: 'Overheat the drill.',
      text: { moon: 'Rubbing rock makes heat, and here there is almost no air to carry it away. Overheating wears the drill bit, and a worn bit heats faster from now on. Short bursts keep it sharp.', mars: 'Rubbing rock makes heat, and here there is almost no air to carry it away. Overheating wears the drill bit, and a worn bit heats faster from now on. Short bursts keep it sharp.',
        sahrun: 'Rubbing rock makes heat, and the hot desert air carries almost none of it away. Overheating wears the drill bit, and a worn bit heats faster from now on. Short bursts keep it sharp.' } },
    { id: 'crumble', icon: '🪨', title: 'The sample crumbled', src: { mars: 'm2020', moon: 'apollo', sahrun: 'm2020' }, hint: 'Let the drill slip out of the green zone for too long.',
      text: { mars: 'Samples break when the drill wanders out of solid rock or ice. It happened for real: in 2021 the Perseverance rover\'s first sample came up empty, because the rock crumbled to powder before it reached the tube.',
        moon: 'Lunar soil is loose and powdery, so a core can slide out of the drill if the bit wobbles. Real drill teams keep the bit straight and steady so the core stays in one piece.',
        sahrun: 'Samples break when the drill wanders out of solid rock into loose sand. It happened for real on Mars: in 2021 the Perseverance rover\'s first sample came up empty, because the rock crumbled to powder before it reached the tube.' } },
    { id: 'flat', icon: '🪫', title: 'The rover battery ran flat', holo: 'battery', src: 'mer', hint: 'Drive the rover until its battery is empty.',
      text: 'Running a battery all the way down damages it a little, so from now on it holds less. Real rover teams always keep some charge in reserve.' },
    { id: 'delay', icon: '⏳', title: { moon: 'Waiting for Earth', mars: 'Waiting for Earth', sahrun: 'Calling the relay ship' }, holo: 'radio', src: { moon: 'moon', mars: 'mars', sahrun: 'iss' }, hint: 'Ask Mission Control to help with a repair.',
      text: { moon: 'Radio waves travel as fast as light, and the Moon is close: 1.3 seconds each way. Out here, help from Earth is almost instant.',
        mars: 'Radio waves travel as fast as light, but Mars is so far away that a question and its answer take many minutes. The machine stays broken while you wait.',
        sahrun: 'Radio waves travel as fast as light. The relay ship in orbit is only about 2 light-seconds away, so Mission Control answers quickly. Earth itself is so far away that a message would take years: out here, the relay ship is your lifeline.' } },
    { id: 'throw', icon: '🎯', title: 'Why that throw flew so far', holo: 'gravity', src: { moon: 'moon', mars: 'mars', sahrun: 'fiction' }, hint: 'Land a long throw.',
      text: { moon: 'The Moon pulls with one-sixth of Earth\'s gravity. The same throw stays in the air much longer, so it lands about six times farther away.',
        mars: 'Mars pulls with about 38% of Earth\'s gravity. The same throw stays in the air longer, so it lands more than twice as far away.',
        sahrun: 'In this game Sahrun pulls with half of Earth\'s gravity. The same throw stays in the air longer, so it lands about twice as far away.' } },
    { id: 'crash', icon: '💥', title: 'Light, but just as hard to stop', holo: 'gravity', src: { moon: 'moon', mars: 'mars', sahrun: 'fiction' }, hint: 'Drive the rover into something.',
      text: { moon: 'Here the rover weighs one-sixth of what it would on Earth, but it has exactly the same mass. So it hits a rock just as hard, and with less grip it needs much longer to stop.',
        mars: 'Here the rover weighs about a third of what it would on Earth, but it has exactly the same mass. So it hits a rock just as hard, and with less grip it needs longer to stop.',
        sahrun: 'Here the rover weighs half of what it would on Earth, but it has exactly the same mass. So it hits a rock just as hard, and on loose sand it needs longer to stop.' } },
    { id: 'icedrill', icon: '🧊', title: { moon: 'Why the ice drill is warm', mars: 'Why the ice drill is warm', sahrun: 'Why the well is so deep' }, src: { moon: 'lro', mars: 'phoenix', sahrun: 'earthobs' },
      hint: { moon: 'Start an ice drill.', mars: 'Start an ice drill.', sahrun: 'Start a well pump.' },
      text: { moon: 'The ice here is frozen into the soil, as hard as concrete. A warm drill loosens it, and the cold outside freezes the chunk solid again the moment it comes out.', mars: 'The ice here is frozen into the soil, as hard as concrete. A warm drill loosens it, and the cold outside freezes the chunk solid again the moment it comes out.',
        sahrun: 'The water here is not frozen. It fills the tiny gaps between sand grains deep down in the rock, like water in a sponge: rain that soaked in long ago. The pump lifts it up, and a sealed can stops the dry desert air from stealing it.' } },
    { id: 'town', icon: '🏘️', title: 'More people, more of everything', src: 'artemis', hint: 'Keep the outpost going until settlers arrive.',
      text: 'Every new person breathes, drinks and eats, so they share your air plant. But more hands can also do more work. Keeping that balance decides how fast a real settlement can grow.' },
    { id: 'isru', icon: '⛏️', title: 'Treasure inside plain rock', src: 'artemis', hint: 'Break a rock in Pioneer mode.',
      text: 'Moon and Mars rock is almost half oxygen, with silicon, iron and aluminium locked inside. Using what is already there, instead of shipping it from Earth, is the only way a big outpost can ever be built.' },
    { id: 'built', icon: '🏗️', title: 'Built from the ground you stand on', src: 'artemis', hint: 'Build something in Pioneer mode.',
      text: 'Launching one kilogram from Earth costs a fortune. Engineers call building with local material "in-situ resource use", and every plan for a lasting base depends on it.' },
    { id: 'longdark', site: 'moon', icon: '🌚', title: 'The long dark is coming', holo: 'longdark', src: 'lro', hint: 'Stay on the Moon long enough to meet a day with no Sun.',
      text: 'On most of the Moon, night lasts two weeks. Your crater rim almost always sees the Sun: that is why the outpost is here. But soon a mountain will hide it for a whole day. Save power cells on the rack before then.' }
  ];
  JA.mech = function (id) { for (var i = 0; i < JA.MECHS.length; i++) if (JA.MECHS[i].id === id) return JA.MECHS[i]; return null; };
  // The words and source of an explanation for one place (some differ between the Moon and Mars).
  JA.mechFor = function (id, site) {
    var m = JA.mech(id); if (!m) return null;
    return { id: m.id, icon: m.icon, title: JA.siteText(m.title, site), holo: m.holo || null, hint: JA.siteText(m.hint, site),
      text: JA.siteText(m.text, site), src: JA.siteText(m.src, site) };
  };

  // the title on the mission-complete screen and the certificate: one per mission length
  JA.RANKS = {
    cadet: { name: 'Space Cadet', icon: '🎒', line: 'You brought the crew home. That is the hardest part!' },
    commander: { name: 'Outpost Commander', icon: '🧑‍🚀', line: 'You juggled power, air, food and radiation like a pro.' },
    veteran: { name: 'Legend of the Outpost', icon: '🏆', line: 'Ten days of worn-out machines and real storms. Mission Control is speechless!' }
  };

  JA.FAIL = {
    air: { icon: '💨', title: 'The air ran out', text: 'The air tanks hit empty, so the crew climbed into the rocket and flew home early. Everyone is safe.',
      tip: { moon: 'Try this: plug a power cell into the Air Maker first thing, then haul ice to it. The rover carries four chunks at once.',
        mars: 'Try this: plug a power cell into the Air Maker first thing, then haul ice to it. The rover carries four chunks at once.',
        sahrun: 'Try this: plug a power cell into the Air Maker first thing, then haul water to it. The rover carries four cans at once.' } },
    food: { icon: '🥬', title: 'The food ran out', text: 'The pantry is empty, so the crew packed up and flew home early. Everyone is safe.',
      tip: 'Try this: plants need light, water and more than a day to grow — so set up the Greenhouse on day one.' },
    dose: { icon: '☢️', title: 'Too much radiation', text: 'The crew\'s radiation badges are full. The mission doctor called everyone home to stay healthy.',
      tip: 'Try this: throw soil bags on the dome early, power the Radio Dish for longer storm warnings, and get inside when a storm is coming.' }
  };
})(window.JA);
