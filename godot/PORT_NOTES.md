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
  scripts/ui/              ui.gd (HUD, radio, cards, modals, prompt, tags, marks), html.gd (cards are still written as HTML), style.gd
  scripts/audio/           audio.gd (recordings, synth stand-ins, voice lines), synth.gd, music_gen.gd
  scripts/addons/          the optional extras, one file each (see below)
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

- All headless tests: `Godot_console.exe --headless --path godot res://tests/run_tests.tscn` (pick with `-- only=rules,ui,crew`).
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
