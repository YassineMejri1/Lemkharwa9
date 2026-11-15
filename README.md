# Astro Outpost — Junior Astronaut Mission Trainer

**NASA Space Apps Challenge 2026 · Challenge: _Build a Junior Astronaut Mission Trainer_**

Be the astronaut. Run a small outpost on **the Moon** (Shackleton crater rim, south pole) or **Mars** (Arcadia Planitia) for 5, 8 or 10 days, with the **real Sun** from NASA's space-weather database. You carry every power cell by hand. There are never enough for air, food, shielding, radio and science all at once, so every choice costs something.

▶ **Play in the browser:** https://lemkharwa9.vercel.app. No download and no account. It works on a laptop, tablet or phone.

> Astro Outpost is a student project. It is **not affiliated with or endorsed by NASA**. It uses NASA's public data and cites it.

---

## What the player learns by doing

The challenge asks for real decisions about **life support, radiation shielding, power budgeting, food production and communication delay**, where *no choice is free*. Here is how each one shows up in play:

| Decision | The trade-off | What it teaches |
|---|---|---|
| **Where does each power cell go?** Air Maker, grow lamps, soil bagger, lab, radio dish, CO₂ scrubber, rover | The Sun charges only a few cells a day, and the rack holds 4 | Power budgeting: a cell for science today is a cell not making air |
| **Soil bags on the dome** | Each bag blocks radiation. Past 8 bags they cover the skylights, so the lamps need some of your solar power | Mass stops particles; nothing in space is free |
| **Power the Radio Dish?** | It costs a cell every day. Without it there is no storm warning from Earth (your suit sensor notices only when the particles arrive), no forecast for tomorrow, and no repair help | Forecasting has a price. On Mars, where storms are rarer, it is not always worth it |
| **Do science?** | Drilling and lab time cost cells and time. The first core studied at each site teaches something useful for good: denser bags from crushed breccia or hematite, extra water from gypsum, more oxygen from ice or glass beads | Science is how a crew learns to live off the land |
| **Shelter or keep working** when a storm is coming | Outdoors, only your suit stands between you and the particles | Radiation adds up and never goes down |
| **Lettuce or potatoes** | Lettuce is fast and small. Potatoes are slow, bigger, and need less water per bite | Plants need light *and* water; growing food takes planning |
| **Fix it yourself or ask Earth** | On Mars the answer takes minutes, set by where Mars really is today | The speed of light is a real limit |
| **Six crises with no checklist** (air leak, CO₂ clog, mould, cold night, blown fuse, stuck rover) | Three options each, with consequences later | Each ends with what real crews did (ISS, Apollo 13, Spirit) |
| **Drive fast or drive safe** | The rover is solid and so is everything else. A crash at speed throws the cargo out of the bed and shakes charge out of the battery | Momentum: light in low gravity, but just as hard to stop |
| **Help the town grow?** | Keep the outpost looking after itself and ships come from Earth after 2, 3, 4, 6 and 8 good days: supplies, then 4, 12, 30 and 80 people. Every settler breathes your air. A town in good spirits brings ice, water and power; a struggling one shares your dinner | A settlement is one shared life-support system: more hands, more mouths |
| **Pioneer mode** (a harder way to play) | You land with less. Breaking boulders gives rubble, metal and glass sand, and each structure you build (solar panel, battery bank, cistern, brick wall, ice rig, wind turbine on Mars, Sun mirror on the Moon, spare filter) costs what another one needed | Living off the land: building from the ground you stand on |

**We checked that the choices really matter.** A test robot plays hundreds of missions (`tools/tests/fixes.test.js`):
- A careful Commander on the Moon brings the crew home every time.
- The same robot loses every mission if it ignores storm warnings or never shields the dome.
- On Veteran, skipping the Radio Dish drops the Moon win rate from 38% to 0%, and skipping science drops it to 21%.
- A slow young Cadet (one action every 35 seconds) still wins.

---

## NASA data we use, and why

### 1. Real space weather — NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information)

Every storm in a mission happened on a real day. The game reads four DONKI services (`js/spaceweather.js`):

| DONKI service | What we use it for |
|---|---|
| `FLR`: solar flares | The **flash**: the first sign, shown in Sun Watch. A flare alone never makes a radiation storm |
| `SEP`: solar energetic particle events | **The radiation storm on the Moon.** These are particle storms that NASA's satellites really measured near Earth. GOES above 100 MeV is a big storm, above 10 MeV a medium one, SOHO/ACE only a small one |
| `CME`: coronal mass ejections (speed, direction) | **The radiation storm on Mars** (see below) |
| `WSAEnlilSimulations`: CME arrivals predicted by the WSA-ENLIL model | A CME's shock wave reaching Earth/Moon or Mars brings a **small** particle storm |

**Why not just flares?** A flare is light and X-rays. The protons that harm astronauts are mostly accelerated by the shock in front of a fast CME. They follow the Sun's spiral magnetic field, so they only reach a planet that is magnetically connected to the eruption. Many big flares send nothing your way.

**Mars.** No particle detector near Mars reports to DONKI, so the game checks every fast CME against the **real positions of Earth and Mars on that date**:
- It works out where Mars's magnetic field line leaves the Sun (Parker spiral: about 88° west of Mars at 1.5 AU).
- It measures how close the eruption was to that spot.
- It weighs this by the CME's speed.

We tested this simple rule on May 2024:
- It picks out exactly one strong event for Mars: the **20 May 2024** eruption from sunspot AR3664, on the Sun's far side as seen from Earth. NASA's Curiosity rover measured its biggest radiation surge in 12 years from that event (8,100 micrograys, about 30 chest X-rays).
- It gives no storm at Mars for the Earth-facing X5.8 flare of 11 May, which hit Earth and the Moon.

**Live or archive.**
- **Live** (the default) fetches the last 30 days when the mission starts, with a 12-second limit.
- **Archive** replays **22 April – 31 May 2024**, one of the most active months on the Sun in 20 years. It is saved in `js/archive-data.js` so the game also works offline.
- If NASA cannot be reached, the game falls back to the archive and **says so on screen**. Saved data is never presented as live.

**Where the player sees it.**
- The morning briefing and the night report tell the real story of each day (`JA.weather.describe`).
- **Sun Watch** charts the real flares and links to every NASA record.
- The end-of-mission certificate lists the real storm dates the crew lived through.

### 2. Real orbits — the radio delay to Mars

Earth's and Mars's positions are computed from their mean orbits (J2000 elements plus the first-order correction for their oval shape). This gives the **light-time delay for each mission day's real date**, accurate to about 2%:

| Date | Event | Model | Actual |
|---|---|---|---|
| Jan 2025 | Opposition | 0.644 AU | 0.642 AU |
| Jan 2026 | Conjunction | 2.40 AU | 2.40 AU |

The same model draws the orbit screen in the habitat's Mission Control and sets how long Earth's answer to a repair question takes.
- **On Mars**, Earth cannot react to what you do right now. Instant coaching therefore comes from a **crewmate inside the habitat**, as on real spacewalks. Only true Earth messages (forecasts, repair answers) come from Mission Control.
- **On the Moon** (1.3 light-seconds), Mission Control talks to you live.

### 3. Facts from NASA missions, with sources

Every explanation card, fact and discovery names its source in the game (`JA.SOURCES` in `js/data.js`):
- Curiosity RAD and the lunar-surface dose (Chang'e-4 LND) for the 2:1 Moon-to-Mars radiation ratio;
- ISS water recovery (98%) and the CDRA CO₂ scrubber;
- MOXIE oxygen on Mars;
- LCROSS, Phoenix and LRO for water ice;
- InSight and Opportunity for dust;
- Apollo samples and instruments;
- the NASA Open Science Data Repository (OSDR) for plant and bone research.

### Real vs game numbers

| Real (from NASA or a cited paper) | Game (simplified so a mission fits in an afternoon) |
|---|---|
| Gravity 1.62 m/s² (Moon), 3.71 m/s² (Mars): jumps and throws use it | A "day" is a 3–12 minute shift |
| Every space-weather date, class, speed and time | Badge points per storm, and its 28-second length |
| Earth–Mars light time on each real date | Crop growth (real space lettuce takes about 4 weeks) |
| Moon:Mars daily radiation ratio (about 1.4 vs 0.67 mSv) | The 0–100% radiation badge is a game scale, not a medical dose |
| ISS water recovery 98% | The outpost's recycler starts at 90% and wears down |
| Moon and Mars rock is mostly oxygen, silicon, iron and aluminium (the idea behind Pioneer mode) | What one boulder gives and what each structure costs |
| A crew that can look after itself is the first step to a settlement | The town's sizes (4, 12, 30, 80 people), its spirit meter and its gifts |

The in-game **"The real science"** page lists all of this for players.

---

## How to play

| Action | Keyboard | Touch |
|---|---|---|
| Walk | `W A S D` | joystick |
| Look around | drag the mouse | drag |
| Use, pick up, put down | `E` | ✋ |
| Throw | hold `F` | hold 🎯 |
| Jump | `Space` | ⤴ |
| Run (uses more air) | `Shift` | — |
| Helmet view | `V` | 👁 |
| Map | `M` | — |
| Why did that happen? (hologram) | `T` | 📡 |
| Field Journal | `J` | — |
| Pause and change day length | `P` / `Esc` | ⚙️ |
| Build (Pioneer mode) | `B` | the bag chip |

Before the mission you choose:
- the site (Moon or Mars);
- the mission (Cadet 5 days for ages 7–9, Commander 8 days for 10–12, Veteran 10 days for 12+);
- the length of a day;
- the Sun (live or May 2024).
- classic or Pioneer mode (hard: fewer supplies, but you can break rocks and build).

Ice is mined by drill rigs that work by themselves: start one, go and do something else, and come back for the chunk.
When the crew flies home after a won mission, the game shows what the outpost could become in 10, 30 and 100 years, and then the results.

---

## Run it yourself

It is a static site, so any web server works:

```bash
python -m http.server 8123
```

Then open http://localhost:8123.

**Tests** (Node 18 or newer, no install needed). They cover the mission rules, the linked life-support systems, the space-weather model checked against real May 2024 events, the orbit model, and robot-played balance tests:

```bash
node tools/tests/rules.test.js
```

```bash
node tools/tests/systems.test.js
```

```bash
node tools/tests/fixes.test.js
```

## How the code is organised

- `js/sim.js`, `js/data.js`, `js/crisis.js`, `js/spaceweather.js`: all the **rules**, with no graphics. This is what the tests load.
- `js/game.js`: input, goals, radio, night reports, endings.
- `js/world.js`, `js/base.js`, `js/actors.js`, `js/interior.js`, `js/fx.js`: the three.js world, outpost, astronaut, rover, habitat and rocket interiors, and camera effects.
- `js/mission.js`: the Mission Control workstation (orbit screen, radio link, log).
- `js/holo.js`, `js/journal.js`, `js/sunwatch.js`, `js/keepsake.js`: holograms, Field Journal, Sun Watch, certificate.
- `js/colony.js`, `js/pioneer.js`: the town that grows beside the outpost (and the future film after a win), and Pioneer mode's rock breaking and building.
- `assets/blender/scripts/`, `tools/`: how the models, textures, icons and sounds are built.
- `tools/film/`: how the 30-second demo film is made. The real game is played by a script and photographed frame by frame; see `tools/film/README.md`.

---

## References

| What | Source | Licence / terms |
|---|---|---|
| Space-weather data | NASA DONKI, https://ccmc.gsfc.nasa.gov/tools/DONKI/ (FLR, SEP, CME, WSA-ENLIL) | NASA public data |
| Mission facts | NASA Science and NASA mission pages, cited in-game via `JA.SOURCES` (`js/data.js`); Hassler et al., *Science* (2014); Zhang et al., *Science Advances* (2020); NASA's June 2024 Curiosity/MAVEN release on the 20 May 2024 storm | Cited, paraphrased for children |
| 3D engine | three.js r149, https://threejs.org, loaded from jsDelivr | MIT |
| Fonts | Exo 2, Figtree, Lexend, Sora (`assets/fonts/`) | SIL Open Font License 1.1 (licence files included) |
| 3D models and textures | Made by the team in Blender, from the scripts in `assets/blender/scripts/` | Original work |
| UI icons | Drawn in code by the team (`tools/icons/build.js`) | Original work |
| Voice lines, sound effects, music | Generated with ElevenLabs (prompts in `tools/audio/manifest.js`), processed with ffmpeg | Generated audio, used under the team's ElevenLabs terms |

## Use of SI (AI) tools

As the Space Apps rules require, here is how we used SI tools:
- **Claude (Anthropic), through Claude Code**, helped write and review code throughout the project. Commits it contributed to carry a `Co-Authored-By: Claude` line. It also helped with the scientific audit and these fixes: the flare/CME/SEP model, the orbit check, and the balance tests.
- **ElevenLabs** generated the voice lines, sound effects and music.
- **The demo film** was recorded from the real game by the scripts in `tools/film/`, written with Claude. Its music is made in code (`tools/film/score.js`), not generated by a music model.
- **The team chose the design, the science and the sources.** We checked the facts against the NASA sources listed above, and the tests check the rules.

## Team

Yassine Mejri · Elayed Amin · Dexter
