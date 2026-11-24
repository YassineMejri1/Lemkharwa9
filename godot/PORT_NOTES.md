# Astro Outpost: web to Godot 4 port

Engine: **Godot 4.7.2**, **GDScript** (no .NET needed). Renderer: Forward+ (desktop). The web version stays untouched
in the repo root; everything for Godot lives in `godot/`.

## Running it

- Open `godot/project.godot` in the Godot 4.7 editor and press Play (F5), or run
  `Godot_v4.7.2-stable_win64.exe --path godot`.
- Export: Project > Export, add a Windows/Linux/macOS preset (export templates for 4.7.2 are needed once).
- The window starts at 1280x720 and scales (`canvas_items`, `expand`), so any size or aspect ratio works.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Walk | W A S D or arrows | left stick |
| Look | move the mouse (hold Alt to get the pointer back for the HUD) | right stick |
| Jump | Space | A |
| Use (pick up, plug in, drill, enter) | E or Enter (hold for drills) | X (hold for drills) |
| Second action | Q | B |
| Aim and throw | hold F, let go to throw | hold RB |
| Run (costs extra air) | Shift | stick pushed to the edge |
| Helmet view (first person) | V | Y |
| Map | M | Back |
| Ask "why?" | T | LB |
| Pause, settings | Esc or P | Start |
| How to play / journal / postcard | H / J / C | |
| Pioneer build menu | B | |
| Camera effects / colour filter | X / L | |
| Music on/off | N | |
| Fullscreen | F11 | |

## Layout

```
godot/
  project.godot
  assets/models/*.glb      Blender exports, copied from ../assets/models
  assets/models/astronaut.glb  the skinned astronaut, from ../assets/blender/scripts/build_astronaut_skinned.py
  assets/textures, assets/fonts, assets/icons
  audio/{voice,sfx,music,landing}/*.mp3   copied from ../audio
  scripts/rules/           the rules with no graphics, ported one to one (data, sim, crisis, spaceweather, archive data)
  scripts/world/           terrain.gd, world.gd (sky, light, ground, particles), base.gd (outpost), actors.gd (astronauts, rover, things)
  scripts/game/game.gd     the old game.js: input, offers, zones, throws, mini-games, days, nights, endings
  scripts/ui/              ui.gd (HUD, radio, cards, modals, prompt, tags, marks), html.gd (cards are still written as HTML), style.gd,
                           starmap.gd (the level map of planets)
  scripts/audio/           audio.gd (recordings, synth stand-ins, voice lines), synth.gd, music_gen.gd
  scripts/addons/          the optional extras, one file each (see below)
  scripts/party/           the party mode's mini-games, one file each
  scripts/net/net.gd       crew mode's network
  tests/                   headless tests
  tools/                   test bots (play.gd, crew_test.gd), compile check (check.gd)
```

## Mapping (JS -> GDScript)

| JS | GDScript | Notes |
|---|---|---|
| `JA.SOURCES/SITES/LEVELS/...` (data.js) | `Data` autoload | Dictionaries with the same keys |
| `JA.sim` (sim.js) | `Sim` autoload | the state `s` is a Dictionary with the same field names; numbers that count stay ints |
| `JA.crisis` | `Crisis` autoload | option `run` closures are Callables |
| `JA.weather` | `Weather` autoload | NASA DONKI fetch with HTTPRequest; the May 2024 archive in `archive_data.gd` |
| `rng32` (mulberry32) | `Rng32` | matches JavaScript bit for bit (a test checks it) |
| three.js scene | `World`, `Base`, `Actors` autoloads | three.js 'YXZ' rotations = Godot's default order; front faces wind clockwise |
| DOM + CSS | `Ui` (CanvasLayer) + `Html.render` | the same HTML strings become Controls; CSS classes map to theme variations |
| Web Audio | `Au` autoload | buses for UI, FX, world, ambience, synth, voice, music; sounds with no recording use the synth |

## Add-ons (scripts/addons/)

Each is optional: `Game.ADDONS` loads every one that is there and compiles, and the game runs without any of them.
All of them are ported: journal, minimap, pov, sky, observe, fx, interior, mission, sunwatch, keepsake, holo,
colony (the town that grows between missions, and the "what could it become" film), pioneer, intro, crew.
Only in this version: hazards (see Planets) and party (see Party mode).

## Planets (only in this version)

The levels are planets, in the order of `Data.PLANET_ORDER`: Moon, Mars, Europa, Titan, Io, Sahrun. Winning a planet opens the
next one (`Game.done`, kept in `user://settings.cfg`), and gives it stars: 1 for Cadet, 2 for Commander, 3 for Veteran.

**For testing, every planet is open now: `Game.all_open` is `true`. Set it to `false` to bring the order back.**

Planets are picked on the star map (`scripts/ui/starmap.gd`): a level map with a dotted route, each planet in a glass
bubble with its number and stars, a padlock on a locked one. It is drawn in code (no picture files) and shown with
`Ui.modal_page`, so the game treats it like an open card. It opens in two places:
- from the title (`Game.star_map`): pick a planet, then the mission planner opens for that planet;
- on the last day, from the commander's couch in the rocket (`Game.board_modal`): pick the next planet, confirm, lift
  off. In crew mode the host picks for everyone.

The planets after Mars live in `data/planets.json`, because `game_data.json` is written from the web version. Each one
names the world it is built on (`"like": "moon"` or `"mars"`) and lists only what differs. `Data` merges the two: `id`
stays the base world, so every `"moon"` / `"mars"` branch and table still works, and `planet` is the planet itself.

| Planet | Built on | What is different |
|---|---|---|
| Europa | Moon | slippery ice (`grip`), geysers that throw you up, strong radiation, a small Sun |
| Titan | Mars | thick air: you fall slowly (`fall`); little sunlight, almost no radiation |
| Io | Moon | lava pools that knock you back, the strongest radiation |
| Sahrun | Mars | made up; a desert with a deepmaw, a giant sand worm that hunts you on open sand; heavier gravity, a radio answer in seconds |

Sahrun comes from the web version (`js/data.js`, `js/world.js`, `js/deepmaw.js`). Here it has the web's numbers, words
and colours, and a short port of the deepmaw (same hunting days, warning, catch ring and cost). Not ported yet: sand
rays, the dew catcher and hot thirsty days, water cans in place of ice, the desert landmarks, the haboob wall, the
swallowing film, and its science cards.

**Do not run `tools/godot/export_data.js` yet.** Since Sahrun, the web data has a new shape (planet traits, words that
differ for each planet), and the scripts here still read the old one. `data/game_data.json` is the web data from before
Sahrun; the Moon and Mars play the same in both.

- Looks: `World.LOOKS` has one entry per planet with only the colours that differ.
- Hazards: `scripts/addons/hazards.gd` (geysers, lava). The same on every screen of a crew, with no network messages.
- On these planets `Game.fun` is true: the add-ons in `Game.SCIENCE` are off, the recorded voice is off (read-aloud
  still works), and a radio line or room fact that names the Moon or Mars is not shown.
- To add a planet: one entry in `data/planets.json`, its id in `Data.PLANET_ORDER`, its colours in `World.LOOKS`, and
  its place and look on the star map (`AT` and the `PLANET` shader in `scripts/ui/starmap.gd`).

## Party mode (only in this version)

Short mini-games for 1 to 4 astronauts: **Party games** on the title screen (alone), or the host's **Party games**
button in the crew room (with friends, on the same network code as crew mode). Every planet gets four mini-games, one
for each tier. Only the Moon has its four so far; the other planets show as "coming next".

| Tier | Game | Kind | How it plays |
|---|---|---|---|
| Easy | Shooting Star | reflex | Press SPACE when a shooting star crosses the sky. Satellites and flaring stars do not count. 5 rounds. |
| Intermediate | Phase Chase | memory | A hologram shows some of the Moon's phases; run onto the same pads in that order. 3 rounds, each one phase longer. |
| Hard | Eagle Drop | skill | Hold SPACE to fire your lander's engine. Land softly and soon, with little fuel. 3 rounds, each from higher up. |
| Extreme | Meteor Storm | survival | Keep out of the red rings. One hit and you are out; the last astronaut standing wins. |

After each game 1st, 2nd and 3rd place win 3, 2 and 1 stars (equal scores share a place); the stars add up over the
party. Alone there are no stars, only your score. Esc opens a small card to leave or to pick another game.

How it is built (`scripts/addons/party.gd`, and one script per game in `scripts/party/`):
- The host owns `st`, the whole party (the game, the round, every player's result, the stars), and sends it whenever
  it changes. Every screen shows what it says. Alone, your own game is the host.
- Every screen builds the same round from `st.seed` (an `Rng32`), so the meteors or the order of the phases need no
  messages. A game only judges its own player and reports the result to the host (`P.report`). What a guest's game
  reports is checked field by field (`safe`).
- Every screen counts a round from the moment the host announced it (`st.at`, turned into this computer's time with
  the clock offset crew mode already keeps), so a slow link or a slow computer is not behind the others.
- The astronauts are sent and drawn by crew mode as in a mission (`crew._party()` lets that run without a mission).
- The arena is the flat plain where the town grows in a mission (`Terrain.L.colony`), empty here.
- To add a game: an entry in `GAMES` (its planet, and its place there is its tier) and a script with `start()`,
  `round()` and `frame(dt)`. Four entries for a planet and it shows up in the menu.
- Not done yet: a player who joins in the middle of a game waits for the next one (no watching).

## Crew mode (multiplayer, up to 4)

`scripts/addons/crew.gd` (the game side, from js/crew.js) and `scripts/net/net.gd` (from js/net.js).

- One player hosts ("Play with friends" > Host) and gets a 5-letter crew code; friends pick Join and type it.
  `crew=ABCDE` on the command line (after `--`) opens the menu with the code filled in.
- The host's game runs the mission; guests send what their astronaut does and draw what the host says. Players can
  join in the middle of a mission.
- Ways to connect, tried in this order, all free with no server of our own:
  1. **Same network**: the guest's game asks the local network for the code (UDP broadcast on ports 47810-47813) and
     links directly with ENet (the host listens on the first free port from 47820).
  2. **Internet, direct**: the host's game asks the home router to open its ENet port (UPnP) and tells guests its
     address through the relay.
  3. **Relay**: when no direct link opens within 6 s, messages go through a public MQTT broker over a secure
     WebSocket (test.mosquitto.org, else broker.hivemq.com).
- Every message is locked with AES-256 and an HMAC-SHA-256 made from the crew code (the relay only sees scrambled
  bytes; only games that know the code can talk to the crew). Messages are `var_to_bytes` values, never objects.
- The Godot and web versions do not play together (different message format and keys).

## Testing

- All headless tests: `Godot_console.exe --headless --path godot res://tests/run_tests.tscn` (pick with `-- only=rules,ui,crew,party`).
- Compile check of add-ons: `--headless --path . res://tools/check.tscn -- files=colony,crew`.
- Robot player: `--fixed-fps 30 --path . res://tools/play.tscn -- site=moon level=cadet nointro=1` with options
  `shots=1` (screenshots to tools/shots/), `max=N` frames, `shift=S` seconds per day, `pov=1`, `map=1`, `inside=F`
  (go in at frame F, `room=`, `station=`, `send=`), `pio`/`pioneer` (Pioneer mode), `holo=1`/`holoui`/`ht`,
  `shotat=F1,F2`, `colony=F` (with `cstage=N`, `arrive=K`, `vision=1`), `sunwatch=F`, `postcard=F`, `cert=F`.
- Crew mode on one computer: start a host and a guest at once:
  `--path . res://tools/crew_test.tscn -- role=host code=TESTQ net=lan` and
  `... -- role=guest code=TESTQ net=lan` (options: `net=relay` relay only, `solo=1` host starts alone so the guest
  joins late, `shift=S`, `grab=1` the guest picks up a power cell through the host, `shots=1`, `crewlog=1`).
  `net=lan` never uses the relay or the router.
- Party mode with a robot player: `--path . res://tools/party_test.tscn -- games=star,phase,eagle,storm shots=1` alone,
  or a host and a guest at once: `... -- role=host code=TESTP net=lan shots=1` and `... -- role=guest code=TESTP net=lan`
  (the guest's robot is the clumsy one: it jumps early, steps on a wrong pad, crashes a lander and stands in the storm).
