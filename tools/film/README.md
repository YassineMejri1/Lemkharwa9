# The 30-second film

The demo film is not screen-recorded and not drawn by an AI. It is the real game, played by a script and
photographed one frame at a time, so every picture in it is something the game really does.

| File | What it is |
| --- | --- |
| `clock.js` | Put into the page before the game loads. Time, timers and animations stand still until the recorder moves them on by one frame |
| `director.js` | The shot list. Each shot starts a real mission through the real menus, moves the astronaut with the keys a player uses, and places the camera and the words |
| `record.js` | Opens the game in headless Chrome and saves one picture per frame (1920 x 1080, 30 frames a second) |
| `build.js` | Joins the pictures into an mp4 and lays the sound under them |

## Making the film

```
node tools/film/record.js --out ../film-frames
node tools/film/build.js --frames ../film-frames --out ../astro-outpost-demo.mp4
```

Handy while changing a shot:

```
node tools/film/record.js --list                                       the shot list with times
node tools/film/record.js --out ../try --size 960 --every 5            a quick, small look at everything
node tools/film/record.js --out ../film-frames --shots city,end       record only these shots again
node tools/film/build.js --out ../sound.wav --sound-only               only the sound
```

Needs Node 22 or newer, Chrome, and `ffmpeg` on the PATH. Nothing is installed.

## What is staged and what is not

- **Real:** the world, the machines, the astronaut, the rover and its crash, the ice drill, the greenhouse, the storm,
  the hologram, the rock breaking and building, the ships and the growing town, the game's own screen (meters, banner,
  radio line). The solar storm is the strongest flare in that mission's NASA DONKI record, and the film names it.
- **Staged:** where the camera stands, the time of day, where the astronaut starts each shot, which of the game's
  screen parts are shown, and the words on top. The landing and the town's growth are played faster than in the game
  (three times and six times), and the crash is slowed to half speed.

## The sound

- Music: the game's title theme (`audio/music/title.mp3`).
- Effects and Mission Control's voice: the game's own files in `audio/sfx`, `audio/voice` and `audio/landing`.
- The drum pulse, hits and risers are made in `build.js` from sine sweeps and noise. They have no notes, so they
  cannot clash with the music. The film is cut at 120 beats a minute: every cut falls on a whole second.

## For the project page

The music, effects and voices were generated with ElevenLabs, and the film was scripted and assembled with Claude.
Both belong in the "Use of AI" section. No one under 18 is heard or shown, and no NASA logo is used.
