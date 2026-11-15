# The 30-second film

The demo film is not screen-recorded and not drawn by an AI. It is the real game, played by a script and
photographed one frame at a time, so every picture in it is something the game really does.

| File | What it is |
| --- | --- |
| `clock.js` | Put into the page before the game loads. Time, timers and animations stand still until the recorder moves them on |
| `director.js` | The shot list, the captions and the film's light. Each shot starts a real mission through the real menus and moves the astronaut with the keys a player uses |
| `record.js` | Opens the game in headless Chrome and saves the pictures (1920 x 1080, 30 frames a second, two slices a frame for motion blur) |
| `score.js` | The music, made entirely in code: a 120 beats-a-minute trailer cue cut to the film |
| `build.js` | Blends the slices into motion blur, grades the colour, lays the score, the game's sounds and Mission Control under it, and writes the mp4 |

## Making the film

```
node tools/film/record.js --out ../film-frames --blur 2
node tools/film/build.js --frames ../film-frames --out ../astro-outpost-demo.mp4
```

The recording takes about 11 minutes. Handy while changing a shot:

```
node tools/film/record.js --list                                       the shot list with times
node tools/film/record.js --out ../try --size 960 --every 4            a quick, small look at everything
node tools/film/record.js --out ../film-frames --blur 2 --shots city   record only this shot again
node tools/film/build.js --out ../sound.wav --sound-only               only the sound
node tools/film/build.js --frames ../film-frames --out film.mp4 --music track.mp3     another music track
```

Needs Node 22 or newer, Chrome, and `ffmpeg` on the PATH. Nothing is installed.

## The cut (120 beats a minute: every cut is on a beat)

| Time | Shot |
| --- | --- |
| 0 – 1.7 s | The Moon: an astronaut, the outpost and Earth. "384,400 km from home" |
| 1.7 – 4 s | A ship from Earth lands at the Moon colony |
| 4 – 6 s | Title over the outpost and Earth |
| 6 – 8 s | Mars at sunrise. "Can you survive Mars?" |
| 8 – 12 s | Eight half-second cuts: a power cell, ice into the Air Maker, the ice drill, the rover, the harvest, soil bags onto the dome, a boulder smashed, a wind turbine built |
| 12 – 15 s | A solar-storm alarm (the strongest flare in the mission's NASA DONKI record, named on screen) and the sprint to the airlock |
| 15 – 16.5 s | Full speed into a boulder: the crash in slow motion |
| 16.5 – 18 s | The wrist-tablet hologram: how ice becomes air |
| 18 – 24 s | Sunrise to night: four ships land and the town grows to a city of 80 |
| 24 – 29.9 s | The outpost's rocket launches into the night; the title |

`director.js` and `score.js` share the big hits (4, 8, 12, 13, 15.5, 24 and 26 s). Change one, change the other.

## What is staged and what is not

- **Real:** the world, the machines, the astronaut, the rover and its crash, the ice drill, the greenhouse, the storm,
  the hologram, the rock breaking and building, the ships, the growing town, the rocket launch.
- **Staged:** where the camera stands, the time of day, where each shot starts, which of the game's screen parts are
  shown (none, except the hologram), the words on top, and the film's light: a crisper low sun for the day shots and a
  darker night with stars for the ending (the game's own night is a bright dusk). The launch shows fewer smoke puffs
  than the game makes. The ship landing runs 1.6 times faster than in the game, the town's growth 12 times, and the
  crash at 0.35 times.

## The sound

- Music: made in code by `score.js` (no samples).
- Effects and Mission Control's voice: the game's own files in `audio/sfx`, `audio/voice` and `audio/landing`.
- The music ducks under the voices; the mix is set to -14 LUFS.

## For the project page

The game's effects and voices were generated with ElevenLabs, and the film and its music were scripted with Claude.
Both belong in the "Use of AI" section. No one under 18 is heard or shown, and no NASA logo is used.
