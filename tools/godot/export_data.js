/* Astro Outpost — export the data tables the Godot version reads as JSON (so there is one source of truth):
   - js/data.js          -> godot/data/game_data.json      (sites, levels, rules, discoveries, facts, explanations...)
   - js/archive-data.js  -> godot/data/archive_2024.json   (NASA DONKI, 22 Apr - 31 May 2024)
   - js/audio-list.js    -> godot/data/voice.json          (recorded voice lines, the bubble-to-line matches, music)
   - js/sfx-data.js meta -> godot/data/sfx.json            (bus, volume, pitch spread, gap, range for each effect)
   Run from the repository root:  node tools/godot/export_data.js */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = { JA: {} };
global.JA = global.window.JA;
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'js/data.js'));
require(path.join(root, 'js/archive-data.js'));
require(path.join(root, 'js/audio-list.js'));
require(path.join(root, 'js/sfx-data.js'));
const OUT = path.join(root, 'godot/data');
fs.mkdirSync(OUT, { recursive: true });

const W = global.window;
// every table in js/data.js (the two helper functions, mech and mechFor, are ported to GDScript in data.gd)
const D = {};
['SOURCES', 'SITES', 'LEVELS', 'SHIFTS', 'RULES', 'MATS', 'BUILDS', 'CROPS', 'MACHINES', 'ITEMS', 'GEO', 'INSTRUMENTS', 'PHOTOS',
  'DAYS', 'LAUNCH_DAY', 'REPAIRS', 'FACTS', 'MECHS', 'RANKS', 'FAIL'].forEach((k) => {
  if (W.JA[k] === undefined) throw new Error('js/data.js has no JA.' + k);
  D[k] = W.JA[k];
});
fs.writeFileSync(path.join(OUT, 'game_data.json'), JSON.stringify(D, null, 1));
fs.writeFileSync(path.join(OUT, 'archive_2024.json'), JSON.stringify(W.JA_ARCHIVE_FLARES));
fs.writeFileSync(path.join(OUT, 'voice.json'), JSON.stringify({ voice: W.JA.VOICE, match: W.JA.VOICE_MATCH || [], music: W.JA.MUSIC || {} }, null, 1));
fs.writeFileSync(path.join(OUT, 'sfx.json'), JSON.stringify(W.JA.SFX.meta, null, 1));
console.log('Wrote game_data.json, archive_2024.json, voice.json and sfx.json to ' + OUT);
