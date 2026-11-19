extends Node
## Astro Outpost — mission rules (no graphics here, so they are easy to read and test). A port of js/sim.js.
## The 3D game calls these functions when the astronaut physically does something: plugs in a power cell, drops ice
## in a hopper, throws a soil bag on the dome...
##
## The mission state `s` is a Dictionary with the same keys as the web version's state object. All its numbers are
## floats unless they count or index something, the same as in JavaScript. s.rng is an Rng32 (the only object in it).

var R: Dictionary:
	get:
		return Data.RULES


func rng32(seed_value: int) -> Rng32:
	return Rng32.new(seed_value)


static func r1(v: float) -> float:
	return Js.mround(v * 10) / 10.0


static func no(msg: String) -> Dictionary:
	return { "ok": false, "msg": msg }


static func ok() -> Dictionary:
	return { "ok": true }


func make_env(site: Dictionary, level: Dictionary, rng: Rng32) -> Array:
	var n := int(level.sols)
	var mars: bool = site.id == "mars"
	var kinds := []
	var calm := "clear" if mars else "sun"
	var mid := "dusty" if mars else "lowsun"
	var bad := "storm" if mars else "shadow"
	for i in n:
		kinds.append(calm)
	# one spell of bad weather early on, and more of them on longer missions
	var bads := [3 + int(floor(rng.next() * 2))]
	if n >= 8:
		bads.append(6 + int(floor(rng.next() * 2)))
	if n >= 10:
		bads.append(9)
	if not mars and n >= 8:
		bads[1] = 7       # on the Moon the second spell is the long dark, the day after the "Sun chaser" lesson
	for b in bads:
		if kinds[b - 2] == calm:
			kinds[b - 2] = mid
		kinds[b - 1] = bad
		if b < n and kinds[b] == calm:
			kinds[b] = mid
	if not mars and n >= 8:
		kinds[bads[1] - 1] = "dark"       # the long dark: a mountain hides the Sun all day
	var out := []
	for k in kinds:
		out.append({ "kind": k, "cells": float(site.env[k].cells) + float(level.cellBonus) })
	return out


# ---------- every day is a little harder than the one before ----------
# The outpost wears down the longer you stay: the crew works harder (more air, more food), the panels and tools wear
# out. k is the level's "ramp". All GAME scales.
func day_mods(s: Dictionary, sol: int = 0) -> Dictionary:
	var d := maxi(0, (sol if sol else int(s.sol)) - 1)
	var k: float = s.level.ramp
	return {
		"breath": 1 + 0.035 * d * k,
		"dinner": Js.mround(0.6 * d * k),
		"cells": -minf(1.5, 0.13 * d * k),
		"dust": 1 + 0.1 * d * k,
		"heat": 1 + 0.04 * d * k,
		"dial": 1 + 0.05 * d * k,
		"recycle": maxf(R.recycleMin, R.recycle - 0.012 * d * k)      # share of the crew's water the recycler gives back
	}


func air_drain(s: Dictionary) -> float:
	return s.level.airDrain * s.mods.breath * (1 + town_load(s))


## What dinner will cost tonight. Dried space food needs water, so with an empty tank the crew opens extra packs.
func dry_dinner(s: Dictionary) -> float:
	return R.dryDinner if s.water < 1 else 0.0


func dinner(s: Dictionary) -> float:
	return s.level.dinner + s.mods.dinner + dry_dinner(s) + float(s.colony.get("asks", 0))


func day_info(s: Dictionary, sol: int = 0) -> Dictionary:
	if not sol:
		sol = int(s.sol)
	var launch: bool = sol >= s.totalSols
	var idx := mini(sol, Data.DAYS.size()) - 1
	var d: Dictionary = Data.LAUNCH_DAY if launch else Data.DAYS[idx]
	var id: String = s.site.id
	return { "key": "launch" if launch else str(idx),      # its page in the Field Journal
		"icon": d.icon, "title": d.title, "topic": d.topic, "goal": d.get("goal"),
		"learn": Js.by_site(d.learn, id), "src": Js.by_site(d.src, id) }


## What got harder since yesterday, in words a player can check against the meters.
func harder_list(s: Dictionary, sol: int = 0) -> Array:
	if not sol:
		sol = int(s.sol)
	if sol <= 1:
		return []
	var a := day_mods(s, sol - 1)
	var b := day_mods(s, sol)
	var out := []
	var L: Dictionary = s.level
	var air0 := Js.mround(L.airDrain * a.breath)
	var air1 := Js.mround(L.airDrain * b.breath)
	if air1 > air0:
		out.append({ "icon": "💨", "text": "The crew is working harder: breathing uses " + str(air1) + " air today (yesterday " + str(air0) + ")." })
	if b.dinner > a.dinner and sol < s.totalSols:
		out.append({ "icon": "🥬", "text": "Bigger appetites: dinner now takes " + Js.num(L.dinner + b.dinner) + " food." })
	if b.cells < a.cells:
		out.append({ "icon": "🔋", "text": "The solar panels are wearing out: a little less power than the same weather gave before." })
	out.append({ "icon": "🔧", "text": "Tools are wearing too: the drill heats up faster and repairs need a steadier hand." })
	var r0 := Js.mround(a.recycle * 100)
	var r1b := Js.mround(b.recycle * 100)
	if r1b < r0:
		out.append({ "icon": "💧", "text": "The water recycler's filters are wearing: it gives back " + str(r1b) + "% of the crew's water now (yesterday " + str(r0) + "%)." })
	if Js.index_of(L.glitchSols, sol) >= 0 and Js.index_of(L.glitchSols, sol - 1) < 0:
		out.append({ "icon": "⚙️", "text": "The machines are tired. Something may break today." })
	return out


## opts: { site, level, seed?, dayLength?, weather (from Weather.load_data), pioneer? }
func new_game(opts: Dictionary) -> Dictionary:
	var site: Dictionary = Data.SITES[opts.site]
	var level: Dictionary = Data.LEVELS[opts.level]
	var seed_value := int(opts.get("seed", 0)) if opts.get("seed") else randi() % 1000000000
	var rng := Rng32.new(seed_value)
	var cadet: bool = level.id == "cadet"
	var s := {
		"seed": seed_value, "rng": rng, "site": site, "level": level, "dayLength": float(Js.orv(opts.get("dayLength"), R.dayLength)),
		"weatherSource": opts.weather.source, "weatherFallback": Js.truthy(opts.weather.get("fallback")),
	}
	s.weather = Weather.pick_window(opts.weather, int(level.sols), level.id, rng, site.id)
	s.env = make_env(site, level, rng)
	s.merge({
		"sol": 0, "totalSols": int(level.sols), "t": 0.0,
		"air": 50.0 if cadet else 60.0, "food": 28.0 if cadet else 45.0, "dose": 0.0, "bags": 0,
		"filter": 100.0,                                  # how clean the CO2 filter is (100 = fresh, 0 = full)
		"water": 35.0 if cadet else 25.0,                 # the water tank, shared by the crew and the plants
		"sow": "lettuce",                                 # the kind of seed in your pocket (see Data.CROPS)
		"wear": { "drill": 0.0, "rover": 0.0, "scar": 0.0 },        # damage from rough handling and from solar storms
		"seen": {}, "whyQ": [], "whyAt": 0.0,             # "why did that happen?" notes: which came up, which wait
		"rack": { "charge": 0.0, "cells": 0, "eff": [1.0, 1.0, 1.0], "broken": false },
		"m": {
			"air": { "power": 0.0, "queue": 0, "prog": 0.0, "broken": false },
			"food": { "lamp": 0.0, "water": 0.0, "broken": false, "beds": [] },
			"bag": { "pending": 0, "timer": 0.0, "broken": false },
			"lab": { "power": 0.0, "queue": [], "prog": 0.0, "broken": false },
			"comms": { "on": false, "broken": false },
			"rover": { "charge": 60.0, "stuck": false }
		},
		"cores": [0, 0, 0, 0], "finds": [], "inst": {}, "photos": {}, "caseLoaded": false,
		"colony": { "days": 0, "stage": 0, "people": 0, "spirit": float(R.spiritStart), "arrive": 0, "gifts": [] },      # the town beside the outpost
		"pioneer": Js.truthy(opts.get("pioneer")), "mats": { "rock": 0, "metal": 0, "glass": 0 }, "built": {}, "broken": {},      # Pioneer mode
		"stats": { "storms": 0, "stormOut": 0.0, "cells": 0, "ice": 0, "crates": 0, "cores": 0, "repairs": 0, "tricks": 0, "bestThrow": 0.0, "drive": 0.0, "dayGoals": 0, "sprint": 0.0, "baked": 0 },
		"glitchPlan": {}, "crisisPlan": {}, "crisis": null, "decisions": [], "after": [], "flags": {}, "leak": 0.0, "stale": 1.0,
		"forecast": true, "night": false, "over": null, "log": [], "seenFacts": {},
		"perks": {}                                       # what the science taught the crew (see discover and Data.GEO perk)
	})
	for i in int(R.beds):
		var growing: bool = i < R.seedlings
		s.m.food.beds.append({ "state": "growing" if growing else "empty", "g": float(R.seedlingGrowth) if growing else 0.0, "crop": "lettuce" })
	s.food += R.extraFood
	s.darkSol = 0
	for k in s.env.size():
		if s.env[k].kind == "dark":
			s.darkSol = k + 1
	var pool := []
	for sol in level.glitchSols:
		if pool.is_empty():
			pool = ["air", "food", "lab", "rack"]
		var pick: String = pool.pop_at(int(floor(rng.next() * pool.size())))
		s.glitchPlan[int(sol)] = { "machine": pick, "at": 0.2 + rng.next() * 0.28 }
	if s.pioneer:                              # the hard start: fewer supplies, and the land has to make up for it
		s.air -= R.pioneerAir
		s.food -= R.pioneerFood
		s.water = maxf(12, s.water - R.pioneerWater)
	Crisis.plan(s)
	s.devil = plan_devil(site, level, seed_value)
	start_sol(s)
	return s


## At most one lucky dust devil per Mars mission crosses the solar panels (never on the first or the last day).
## It has its own random stream, so it does not shift the breakdowns and crises planned from the same seed.
func plan_devil(site: Dictionary, level: Dictionary, seed_value: int):
	if site.id != "mars" or level.sols < 4:
		return null
	var r := Rng32.new((seed_value ^ 0x5eed0de1) & 0xFFFFFFFF)
	if r.next() >= R.devilChance:
		return null
	var sol := 2 + int(floor(r.next() * (level.sols - 2)))
	return { "sol": sol, "at": 0.3 + r.next() * 0.4, "state": "pending", "gain": 0.0 }


## The devil blows part of the dust off every panel. Returns how much power came back, on average (0–1).
func devil_clean(s: Dictionary) -> float:
	var before := 0.0
	var after := 0.0
	for i in s.rack.eff.size():
		before += s.rack.eff[i]
		s.rack.eff[i] = minf(1, s.rack.eff[i] + R.devilClean)
		after += s.rack.eff[i]
	return (after - before) / s.rack.eff.size()


const EFF_DECAY := { "clear": 0.25, "dusty": 0.5, "storm": 0.9, "sun": 0.4, "lowsun": 0.4, "shadow": 0.4, "dark": 0.4 }


func start_sol(s: Dictionary) -> void:
	s.sol += 1
	s.t = 0.0
	s.night = false
	s.dayDone = false
	var e: Dictionary = s.env[s.sol - 1]
	s.mods = day_mods(s)
	town_morning(s)
	s.cellsToday = maxf(1, maxf(1.0 if e.kind == "dark" else 2.5, e.cells + s.mods.cells) - (R.pioneerCells if s.pioneer else 0.0)) + extra_cells(s, e.kind)
	s.effDecay = EFF_DECAY[e.kind] * s.mods.dust
	s.rack.charge += minf(R.morningCells, s.cellsToday)
	s.rack.broken = false
	s.m.comms.on = false
	s.m.comms.broken = false
	s.m.air.broken = false
	s.m.food.broken = false
	s.m.lab.broken = false
	s.m.rover.stuck = false
	s.leak = 0.0
	s.stale = 1.0
	var w = s.weather[s.sol - 1] if s.sol - 1 < s.weather.size() else null
	s.storm = null
	if w and w.level > 0:
		var start: float = s.dayLength * (0.3 + s.rng.next() * 0.36)
		s.storm = { "start": start, "end": start + R.stormDuration, "level": int(w.level), "cls": w.cls, "cause": Js.orv(w.get("cause"), "sep"),
			"warned": false, "active": false, "over": false, "strength": w.strength * 3 * s.site.stormMult * s.level.stormScale }
		s.stats.storms += 1
	var gp = s.glitchPlan.get(s.sol)
	s.glitch = { "machine": gp.machine, "at": gp.at * s.dayLength, "state": "pending", "replyAt": 0.0, "misses": 0, "asked": false } if gp else null
	var cores_found := 0
	for f in s.finds:
		if f.kind == "core":
			cores_found += 1
	s.today = { "breath": 0.0, "airMade": 0.0, "ice": 0, "crates": 0, "doseBase": 0.0, "doseStorm": 0.0, "science": 0, "cells": {}, "bags": 0, "late": false, "repair": null,
		"panels": {}, "dishEarly": false, "leaked": 0.0, "goalDone": false, "extra": [],
		"cratesFood": 0.0, "staleAir": 0.0, "filterUsed": 0.0, "baked": 0.0, "water": { "ice": 0.0, "crew": 0.0, "back": 0.0, "plants": 0.0 }, "noWater": 0.0,
		"stormOut": 0.0, "dryBeds": 0.0, "darkBeds": 0.0, "fullT": 0.0, "scar": 0.0, "whys": [], "wasStale": false,
		"bagRoom": R.shieldSlots - s.bags, "coreRoom": s.cores.size() * 2 - cores_found }
	s.day = day_info(s)
	s.morning = { "air": s.air, "food": s.food, "dose": s.dose, "water": s.water, "filter": s.filter }
	s.whyQ = []
	s.whyAt = 14.0                    # yesterday's unshown notes are in the night report already
	if s.colony.get("fresh"):
		s.colony.fresh = false
		note(s, "town")
	if s.darkSol > s.sol and s.darkSol - s.sol <= 2:
		note(s, "longdark")
	Crisis.start_sol(s)


# Has today's challenge been met? (checked every tick; pays out once)
# How many the challenge really asks for. It never asks for more than is left to do: a player who covered the dome or
# studied the cores early must not lose the challenge for working ahead.
func goal_need(s: Dictionary) -> int:
	var g = s.day.goal
	var t: Dictionary = s.today
	if not g or not g.get("n"):
		return 0
	if g.id == "bags":
		return maxi(0, mini(int(g.n), int(t.bagRoom)))
	if g.id == "cores":
		return maxi(0, mini(int(g.n), int(t.coreRoom)))
	return int(g.n)


func _count_finds(s: Dictionary, kind: String, sol: int = 0) -> int:
	var n := 0
	for f in s.finds:
		if f.kind == kind and (not sol or f.sol == sol):
			n += 1
	return n


func day_goal_done(s: Dictionary) -> bool:
	var g = s.day.goal
	var t: Dictionary = s.today
	if not g:
		return false
	match g.id:
		"bags": return t.bags >= goal_need(s)
		"cores": return _count_finds(s, "core", s.sol) >= goal_need(s)
		"dish": return t.dishEarly
		"crates": return t.crates >= g.n
		"panels": return t.panels.size() >= g.n
		"inst": return Js.truthy(s.inst.get("seismo")) and Js.truthy(s.inst.get("beam")) and Js.truthy(s.inst.get("rad"))
		"ice": return t.ice >= g.n
		"studied": return _count_finds(s, "core") >= g.n
	return false


func day_goal_progress(s: Dictionary) -> String:
	var g = s.day.goal
	var t: Dictionary = s.today
	if not g or not g.get("n"):
		return ""
	var v: int
	match g.id:
		"bags": v = t.bags
		"cores": v = _count_finds(s, "core", s.sol)
		"crates": v = t.crates
		"panels": v = t.panels.size()
		"inst": v = s.inst.size()
		"ice": v = t.ice
		_: v = _count_finds(s, "core")
	var need := goal_need(s)
	return " (" + str(mini(v, need)) + "/" + str(need) + ")"


## The player changed how long a working day lasts. Keep the same point in the day.
func set_day_length(s: Dictionary, D2: float) -> void:
	var D: float = s.dayLength
	if D2 == D:
		return
	var t2: float = s.t / D * D2
	var shift: float = t2 - s.t
	var st = s.storm
	var g = s.glitch
	var c = s.crisis
	if st and not st.over:
		if st.warned:
			st.start += shift
			st.end += shift
		else:
			st.start = st.start / D * D2
			st.end = st.start + R.stormDuration
	if g:
		if g.state == "pending":
			g.at = g.at / D * D2
		g.replyAt += shift
	if c and c.state == "pending":
		c.at = c.at / D * D2
		c.until = c.until / D * D2
	for a in s.after:
		if a.sol == s.sol and not a.get("done"):
			a.t = minf(a.t + shift, D2 - 0.5)
	s.whyAt += shift
	s.t = t2
	s.dayLength = D2


func env(s: Dictionary) -> Dictionary:
	return s.env[s.sol - 1]


func weather(s: Dictionary) -> Dictionary:
	var i: int = s.sol - 1
	if i >= 0 and i < s.weather.size() and s.weather[i]:
		return s.weather[i]
	return { "level": 0, "cls": null, "date": null }


## what the science taught: each perk is unlocked by the first core studied at one geology site (Data.GEO)
func perk(s: Dictionary, kind: String) -> bool:
	return Js.truthy(s.perks.get(kind)) if s.get("perks") else false


func air_per_ice(s: Dictionary) -> float:
	return R.airPerIce + (R.perkAir if perk(s, "air") else 0.0)


func water_per_ice(s: Dictionary) -> float:
	return R.waterPerIce + (R.perkWater if perk(s, "water") else 0.0)


func bag_block(s: Dictionary) -> float:
	return R.bagBlock + (R.perkBag if perk(s, "bags") else 0.0)


func drill_heat(s: Dictionary) -> float:
	return R.perkDrill if perk(s, "drill") else 1.0


func shield(s: Dictionary) -> float:
	return minf(0.9, R.wallBlock + s.bags * bag_block(s) + 0.05 * built(s, "berm"))


## Seconds of warning before a storm. Dish on: Earth's forecasters warn you. Dish off: only the suit sensor, as the
## particles arrive. The Radiation Watcher, once set up, catches the first and fastest particles a little sooner.
func warn_lead(s: Dictionary) -> float:
	return maxf(0, (R.warnDish if s.m.comms.on else R.warnNoDish) + (R.radWarn if s.inst.get("rad") else 0.0) + s.level.warnBonus)


func storm_phase(s: Dictionary) -> String:
	var st = s.storm
	if not st:
		return "none"
	if st.over:
		return "over"
	if st.active:
		return "active"
	if st.warned:
		return "warning"
	return "none"


func machine(s: Dictionary, id: String) -> Dictionary:
	return s.rack if id == "rack" else s.m[id]


# ---------- Pioneer mode: break rocks, keep the pieces, build ----------
func built(s: Dictionary, id: String) -> int:
	return int(s.built.get(id, 0)) if s.get("built") else 0


func rack_max(s: Dictionary) -> int:
	return int(R.rackMax) + 2 * built(s, "battery")


func water_cap(s: Dictionary) -> float:
	return 100.0 + 50 * built(s, "cistern")


## Power cells a day from what you built and from the town's spare solar array.
func extra_cells(s: Dictionary, kind: String) -> float:
	var n := 0.7 * built(s, "panel")
	if built(s, "turbine") and (kind == "dusty" or kind == "storm"):
		n += 1.2
	if built(s, "mirror"):
		n += 1.5 if kind == "dark" else 1.0 if kind == "shadow" or kind == "lowsun" else 0.0
	if s.get("colony") and s.colony.stage >= 1:
		n += 1
	return n


## What one boulder gives when it is broken up. The same boulder always gives the same on one mission.
func rock_yield(s: Dictionary, k: int, r = null) -> Dictionary:
	var sd: int = int(s.seed) if s.get("seed") else 1
	var h := fmod(absf(sin((sd % 997 + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453), 1.0)
	var mars: bool = s.site.id == "mars"
	return { "rock": 2 + Js.mround(minf(3, float(Js.orv(r, 1)))),
		"metal": (2 if h < 0.15 else 1) if h < (0.5 if mars else 0.4) else 0,
		"glass": (2 if h > 0.88 else 1) if h > 0.55 else 0 }


func break_rock(s: Dictionary, k: int) -> bool:
	if s.broken.get(k):
		return false
	s.broken[k] = 1
	s.stats.rocks = int(s.stats.get("rocks", 0)) + 1
	note(s, "isru")
	return true


func add_mat(s: Dictionary, kind: String, n: int = 1) -> int:
	if not Data.MATS.has(kind):
		return 0
	s.mats[kind] = int(s.mats.get(kind, 0)) + n
	return s.mats[kind]


func can_build(s: Dictionary, id: String) -> Dictionary:
	var def = Data.BUILDS.get(id)
	if not def:
		return no("Nobody knows how to build that.")
	if not s.pioneer:
		return no("Building belongs to Pioneer mode.")
	if def.get("site") and def.site != s.site.id:
		return no("That only works on " + Data.SITES[def.site].name + ".")
	if built(s, id) >= def.max:
		return no("You already built " + ("all " + Js.num(def.max) + " of them." if def.max > 1 else "it."))
	for k in def.cost:
		var have := int(s.mats.get(k, 0))
		if have < def.cost[k]:
			return no("You need " + Js.num(def.cost[k] - have) + " more " + Data.MATS[k].name + ".")
	return ok()


func build(s: Dictionary, id: String) -> Dictionary:
	var r := can_build(s, id)
	if not r.ok:
		return r
	var def: Dictionary = Data.BUILDS[id]
	var before := extra_cells(s, env(s).kind)
	for k in def.cost:
		s.mats[k] -= int(def.cost[k])
	s.built[id] = built(s, id) + 1
	s.stats.built = int(s.stats.get("built", 0)) + 1
	s.cellsToday += extra_cells(s, env(s).kind) - before          # a new panel, turbine or mirror starts charging today
	note(s, "built")
	return ok()


# ---------- the town beside the outpost ----------
## Settlers share your air plant: each stage with people in it adds a little to the breathing.
func town_load(s: Dictionary) -> float:
	var c = s.get("colony")
	return R.townAir * (c.stage - 1) if c and c.stage >= 2 else 0.0


## Evening: was the outpost self-sustaining today? That is what brings ships, and what keeps the town's spirit up.
func town_night(s: Dictionary) -> Dictionary:
	var c: Dictionary = s.colony
	var t: Dictionary = s.today
	var D: Array = R.townDays
	var nxt := 0
	var next_dinner: float = s.level.dinner + day_mods(s, s.sol + 1).dinner
	var air: bool = t.airMade >= t.breath * 0.6
	var food: bool = s.food >= next_dinner or t.crates >= 1
	var good := air and food
	if good:
		c.days += 1
	if c.stage >= 2:
		c.spirit = clampf(c.spirit + (R.spiritUp if good else -R.spiritDown), 0, 100)
	for i in range(1, D.size()):
		if c.days < D[i]:
			nxt = int(D[i])
			break
	return { "ok": good, "air": air, "food": food, "days": c.days, "next": nxt, "coming": Js.index_of(D, c.days) > c.stage, "stage": c.stage, "people": c.people, "spirit": c.spirit }


## Morning: a new ship may have come, and a town in good spirits lends a hand.
func town_morning(s: Dictionary) -> void:
	var c: Dictionary = s.colony
	var D: Array = R.townDays
	var want := 0
	var m: Dictionary = s.m
	for i in range(1, D.size()):
		if c.days >= D[i]:
			want = i
	c.arrive = 0
	c.gifts = []
	c.asks = 0
	if want > c.stage:
		c.stage = want
		c.arrive = want
		c.people = int(R.townPeople[want]) if want < R.townPeople.size() else 0
		c.fresh = want >= 2
	if c.stage < 2:
		return
	if c.spirit >= R.spiritHelp:
		if m.air.queue < R.hopperMax:
			m.air.queue += 1
			c.gifts.append("an ice chunk for the Air Maker")
		if s.water < water_cap(s) - 15:
			s.water += 15
			c.gifts.append("water for the tank")
	if c.spirit >= R.spiritGift and c.stage >= 3 and s.rack.cells < rack_max(s):
		s.rack.cells += 1
		c.gifts.append("a charged power cell")
	if c.spirit < R.spiritLow:
		c.asks = R.townDinner          # a town in trouble shares your dinner tonight


## How much faster the tanks empty because the air indoors is stale: a clogged filter (a crisis) or a full one.
func stale(s: Dictionary) -> float:
	return maxf(s.stale, R.staleRate if s.filter <= 0 else 1.0)


## Soil bags past the free ones cover the skylights, so the lamps indoors stay on: a share of solar power.
func shade(s: Dictionary) -> float:
	return maxf(0, s.bags - R.bagsFreeShade) * R.bagShade


## The share of the panels' power that reaches the rack, after the indoor lamps and the storm scars.
func sun_power(s: Dictionary) -> float:
	return (1 - shade(s)) * (1 - s.wear.scar)


func rover_cap(s: Dictionary) -> float:
	return R.roverMax * (1 - s.wear.rover)


func crop(id) -> Dictionary:
	return Data.CROPS.get(id, Data.CROPS.lettuce)


## A "why did that happen?" moment. Each one comes up once per mission; the card is shown when there is room.
func note(s: Dictionary, id: String) -> bool:
	var m = Data.mech(id)
	if m == null or s.seen.has(id) or (m.get("site") and m.site != s.site.id):
		return false
	s.seen[id] = s.sol
	if s.get("today"):
		s.today.whys.append(id)
	if not s.get("sleeping"):
		s.whyQ.append(id)
	return true


## some science was done today (tonight's space fact can be about science)
func did_science(s: Dictionary) -> void:
	s.today.science += 1


## ctx.outside / ctx.sprint: true, false, or a share of the crew (0..1)
static func _share(v) -> float:
	if v is bool:
		return 1.0 if v else 0.0
	if v is int or v is float:
		return float(v) if not is_nan(float(v)) else 0.0
	return 0.0


# ---------- one slice of time ----------
## ctx: { outside, sprint, driving, calm, fast }. Returns a list of things that just happened.
## In crew mode outside and sprint are shares of the crew (0..1): how many of the astronauts are out in the open, and
## how many of them are running. One player is true / false, the same as 1 / 0.
func tick(s: Dictionary, dt: float, ctx: Dictionary) -> Array:
	var ev := []
	if s.over or s.night or s.dayDone:
		return ev
	var D: float = s.dayLength
	var m: Dictionary = s.m
	var t0: float = s.t
	var td: Dictionary = s.today
	s.t = minf(D, s.t + dt)
	dt = s.t - t0

	# breathing empties the tanks and fills the CO2 filter; with stale air the tanks must give even more
	var out := _share(ctx.get("outside"))
	var sp = ctx.get("sprint")
	var run := out if (sp is bool and sp) else minf(out, _share(sp))
	var puff: float = air_drain(s) / D * dt * (1 + (R.sprintAir - 1) * run)
	var breath: float = puff * stale(s)
	s.air = maxf(0, s.air - breath)
	td.breath += breath
	td.staleAir += breath - puff
	var soaked := minf(s.filter, puff * R.filterPerAir * (0.67 if built(s, "filter") else 1.0))
	s.filter -= soaked
	td.filterUsed += soaked
	if s.filter <= 0:
		td.wasStale = true
	if run > 0:
		s.stats.sprint += dt * run
	# the crew drinks and washes; the recycler gives most of it back
	if s.water > 0:
		var sip: float = R.crewWater / D * dt
		var back: float = sip * s.mods.recycle
		td.water.crew += sip
		td.water.back += back
		s.water = maxf(0, s.water - (sip - back))
	else:
		td.noWater += dt
	if s.leak > 0:
		var lost: float = s.leak / D * dt
		s.air = maxf(0, s.air - lost)
		td.leaked += lost

	var sf := shield(s)
	var bare := out + (1 - out) * (1 - sf)         # the share of the crew's dose that the walls and bags do not block
	var base: float = s.site.doseDay * s.level.doseScale / D * dt * bare
	s.dose += base
	td.doseBase += base

	var st = s.storm
	if st:
		if not st.warned and s.t >= st.start - warn_lead(s):
			st.warned = true
			ev.append({ "type": "storm", "phase": "warning" })
		var o := maxf(0, minf(s.t, st.end) - maxf(t0, st.start))
		if o > 0:
			if not st.active:
				st.active = true
				ev.append({ "type": "storm", "phase": "active" })
			var got: float = st.strength / R.stormDuration * o * bare
			s.dose += got
			td.doseStorm += got
			if out > 0:
				s.stats.stormOut += o * out
				td.stormOut += o * out
				if td.stormOut > 2:
					note(s, "stormout")
		if not st.over and s.t >= st.end:
			st.over = true
			st.active = false
			ev.append({ "type": "storm", "phase": "over" })
			if td.stormOut < 1:
				note(s, "stormin")
			note(s, "warn")
			# a medium or big storm leaves the solar cells a little weaker for good
			var scar: float = minf(R.scarMax - s.wear.scar, R.scarPerLevel * st.level * s.site.stormMult) if st.level >= 2 else 0.0
			if scar > 0.0005:
				s.wear.scar += scar
				td.scar = scar
				note(s, "scar")

	# solar rack: the panels fill one power cell after another
	var rk: Dictionary = s.rack
	if not rk.broken and s.t <= D * R.chargeSpan:
		rk.charge += maxf(0, s.cellsToday - R.morningCells) / (D * R.chargeSpan) * ((rk.eff[0] + rk.eff[1] + rk.eff[2]) / 3) * sun_power(s) * dt
	while rk.charge >= 1 and rk.cells < rack_max(s):
		rk.charge -= 1
		rk.cells += 1
		ev.append({ "type": "cell" })
	if rk.cells >= rack_max(s):
		rk.charge = minf(rk.charge, 0.98)
	for i in 3:
		rk.eff[i] = maxf(R.effMin, rk.eff[i] - s.effDecay / D * dt)

	# air maker: electricity splits melted ice into oxygen
	var a: Dictionary = m.air
	if not a.broken and a.queue > 0 and a.power > 0:
		a.prog += dt / R.iceTime
		if a.prog >= 1:
			a.prog = 0.0
			a.queue -= 1
			a.power -= 1
			var made := air_per_ice(s)
			s.air = minf(100, s.air + made)
			td.airMade += made
			ev.append({ "type": "air", "amount": made })
			note(s, "electro")
			if a.power == 0:
				ev.append({ "type": "empty", "machine": "air" })

	# greenhouse: plants need light AND water
	var f: Dictionary = m.food
	var growing := 0
	var drink := 0.0
	var lit: bool = f.lamp > 0
	f.lamp = maxf(0, f.lamp - dt / D)
	if lit and f.lamp == 0:
		ev.append({ "type": "empty", "machine": "food" })
	for b in f.beds:
		if b.state == "growing":
			growing += 1
	if not f.broken and lit and s.water > 0:
		for i in f.beds.size():
			var b: Dictionary = f.beds[i]
			var cr := crop(b.crop)
			if b.state != "growing":
				continue
			b.g += dt / (cr.growSols * D)
			drink += cr.drink / D * dt
			if b.g >= 1:
				b.g = 1.0
				b.state = "ripe"
				ev.append({ "type": "ripe", "bed": i })
		s.water = maxf(0, s.water - drink)
		td.water.plants += drink

	var bg: Dictionary = m.bag
	if not bg.broken and bg.pending > 0:
		bg.timer -= dt
		if bg.timer <= 0:
			bg.timer = R.bagInterval
			bg.pending -= 1
			ev.append({ "type": "bag" })

	var lab: Dictionary = m.lab
	if not lab.broken and lab.queue.size() and lab.power > 0:
		lab.prog += dt / R.analyzeTime
		if lab.prog >= 1:
			lab.prog = 0.0
			lab.power -= 1
			ev.append({ "type": "discovery", "find": discover(s, lab.queue.pop_front()) })
			if lab.power == 0:
				ev.append({ "type": "empty", "machine": "lab" })

	if ctx.get("driving"):
		var c0: float = m.rover.charge
		m.rover.charge = maxf(0, c0 - dt)
		s.stats.drive += dt
		# running the battery right down hurts it: from now on it holds a little less
		if c0 > 0 and m.rover.charge <= 0:
			s.wear.rover = minf(R.flatWearMax, s.wear.rover + R.flatWear)
			note(s, "flat")

	# the one lucky dust devil of the mission: it shows up on the horizon, then crosses the panels
	var dv = s.devil
	if dv and dv.sol == s.sol:
		if dv.state == "pending" and s.t >= dv.at * D - R.devilLead:
			dv.state = "coming"
			ev.append({ "type": "devil", "phase": "coming", "lead": maxf(0, dv.at * D - s.t) })
		if dv.state == "coming" and s.t >= dv.at * D:
			dv.state = "done"
			dv.gain = devil_clean(s)
			ev.append({ "type": "devil", "phase": "clean", "gain": dv.gain })

	var g = s.glitch
	if g and g.state == "pending" and s.t >= g.at:
		g.state = "broken"
		machine(s, g.machine).broken = true
		ev.append({ "type": "break", "machine": g.machine })
	if g and g.state == "asked" and s.t >= g.replyAt:
		g.state = "advised"
		ev.append({ "type": "advice", "machine": g.machine })

	Crisis.tick(s, ctx, ev)

	# why did that happen? Each of these is noticed once, at the moment it starts to matter.
	if not s.get("sleeping"):
		if growing and not f.broken:
			if lit and s.water <= 0:
				td.dryBeds += dt
				if td.dryBeds > 6:
					note(s, "dry")
			elif not lit and s.water > 0:
				td.darkBeds += dt
				if td.darkBeds > 12:
					note(s, "dark")
		if s.filter <= 0:
			note(s, "stale")
		elif s.filter < R.filterWarn:
			note(s, "filterlow")
		# on the first day the lesson comes first: only the two cards that belong to it are shown, the rest wait
		if s.whyQ.size() and s.t >= s.whyAt:
			var qi := 0
			if ctx.get("calm"):
				qi = -1
				for i in s.whyQ.size():
					if s.whyQ[i] == "electro" or s.whyQ[i] == "crop":
						qi = i
						break
			if qi >= 0:
				ev.append({ "type": "why", "id": s.whyQ.pop_at(qi) })
				s.whyAt = s.t + R.whyGap * float(Js.orv(ctx.get("fast"), 1))
		if s.water < R.waterWarn and growing:
			note(s, "waterlow")
		if s.dose >= 25:
			note(s, "dose25")
		if s.stats.sprint > 8:
			note(s, "sprint")
		if (rk.eff[0] + rk.eff[1] + rk.eff[2]) / 3 < 0.8 and env(s).kind != "dark":
			note(s, "panel")
		if rk.cells >= rack_max(s) and not rk.broken and s.t <= D * R.chargeSpan and s.cellsToday > R.morningCells:
			td.fullT += dt
			if td.fullT > 15:
				note(s, "rackfull")
	if not td.goalDone and day_goal_done(s):
		td.goalDone = true
		s.stats.dayGoals += 1
		ev.append({ "type": "daygoal" })

	if s.air <= 0:
		ev.append({ "type": "fail", "reason": "air" })
	elif s.dose >= 100:
		ev.append({ "type": "fail", "reason": "dose" })
	elif s.t >= D:
		s.dayDone = true
		ev.append({ "type": "dayEnd" })
	return ev


# ---------- things the astronaut does ----------
func take_cell(s: Dictionary) -> bool:
	if s.rack.cells <= 0:
		return false
	s.rack.cells -= 1
	return true


func plug(s: Dictionary, id: String) -> Dictionary:
	var m: Dictionary = s.m
	match id:
		"air":
			if m.air.power > R.airCharges:
				return no("The Air Maker is already charged up.")
			m.air.power += R.airCharges
		"food":
			if m.food.lamp > 1:
				return no("The grow lamps are already charged up.")
			m.food.lamp += 1
		"bag":
			if s.bags + m.bag.pending >= R.shieldSlots:
				return no("The dome is fully covered. No more bags needed!")
			m.bag.pending += int(R.bagsPerCell)
			m.bag.timer = 0.8
		"lab":
			if m.lab.power > R.labCharges:
				return no("The Lab is already charged up.")
			m.lab.power += R.labCharges
		"comms":
			if m.comms.broken:
				return no("The Radio Dish fuse is blown. It cannot be switched on today.")
			if m.comms.on:
				return no("The Radio Dish is already on today.")
			m.comms.on = true
			if s.t < s.dayLength * 0.5:
				s.today.dishEarly = true
		"rover":
			if m.rover.stuck:
				return no("The rover is buried up to its axles. The crew will dig it out tonight.")
			if m.rover.charge > rover_cap(s) - 30:
				return no("The rover battery is full.")
			m.rover.charge = minf(rover_cap(s), m.rover.charge + R.roverPerCell)
		"scrub":
			if s.filter > R.filterFull:
				return no("The CO₂ filter is still clean. It does not need baking yet.")
			s.today.baked += 100 - s.filter
			s.stats.baked += 1
			s.filter = 100.0
		_:
			return no("That does not fit there.")
	s.today.cells[id] = int(s.today.cells.get(id, 0)) + 1
	s.stats.cells += 1
	return ok()


func feed_ice(s: Dictionary, id: String) -> Dictionary:
	if id == "air":
		if s.m.air.queue >= R.hopperMax:
			return no("The Air Maker hopper is full. Give it a power cell so it can work!")
		s.m.air.queue += 1
	else:
		if s.water > water_cap(s) - water_per_ice(s) / 2:
			return no("The water tank is full.")
		var add := minf(water_per_ice(s), water_cap(s) - s.water)
		s.water += add
		s.today.water.ice += add
		s.today.ice += 1
		s.stats.ice += 1
		return { "ok": true, "add": add }
	s.today.ice += 1
	s.stats.ice += 1
	return ok()


func add_bag(s: Dictionary) -> Dictionary:
	if s.bags >= R.shieldSlots:
		return no("The dome is fully covered!")
	s.bags += 1
	s.today.bags += 1
	note(s, "shield")
	if s.bags > R.bagsFreeShade:
		note(s, "shade")
	return ok()


## Plant a bed with the seeds in your pocket (or the kind named). Returns the kind that was planted, or "".
func plant(s: Dictionary, i: int, kind: String = "") -> String:
	var b: Dictionary = s.m.food.beds[i]
	if b.state != "empty":
		return ""
	if Data.CROPS.has(kind):
		s.sow = kind
	b.state = "growing"
	b.g = 0.0
	b.crop = s.sow
	note(s, "crop")
	return b.crop


func set_seed(s: Dictionary, kind: String) -> String:
	if Data.CROPS.has(kind):
		s.sow = kind
	return s.sow


## Pick a ripe bed. Returns the kind of crop (so the crate knows what is in it), or "" if it was not ripe.
func harvest(s: Dictionary, i: int) -> String:
	var b: Dictionary = s.m.food.beds[i]
	if b.state != "ripe":
		return ""
	b.state = "empty"
	b.g = 0.0
	return b.crop if b.get("crop") else "lettuce"


func store_crate(s: Dictionary, kind) -> Dictionary:
	if s.flags.get("pantryShut") == s.sol:
		return no("The food store is sealed off because of the leak. The crew will open it again tonight.")
	var food: float = crop(kind).food
	s.food = minf(100, s.food + food)
	s.today.crates += 1
	s.today.cratesFood += food
	s.stats.crates += 1
	return { "ok": true, "food": food }


func cores_left(s: Dictionary, i: int) -> int:
	return 2 - int(s.cores[i])


func drill_core(s: Dictionary, i: int, quality) -> Dictionary:
	var core := { "site": i, "n": int(s.cores[i]), "quality": quality }
	s.cores[i] += 1
	s.stats.cores += 1
	return core


func submit_core(s: Dictionary, core: Dictionary) -> Dictionary:
	if s.m.lab.queue.size() >= R.labQueue:
		return no("The Lab tray is full. It needs a power cell to study the cores.")
	s.m.lab.queue.append(core)
	return ok()


func discover(s: Dictionary, core: Dictionary) -> Dictionary:
	var site: Dictionary = Data.GEO[s.site.id][int(core.site)]
	var n := int(core.n)
	var has_n: bool = n < site.finds.size()
	var f: Dictionary = site.finds[n] if has_n else site.finds[0]
	var find := { "title": f.title, "text": f.text, "src": f.src, "quality": core.quality, "place": site.name, "icon": site.icon, "sol": s.sol, "kind": "core",
		"key": str(int(core.site)) + "-" + str(n if has_n else 0) }
	# the first core studied from each site teaches something useful for good
	if site.get("perk") and not perk(s, site.perk.kind):
		s.perks[site.perk.kind] = s.sol
		find.perk = site.perk.text
		find.perkKind = site.perk.kind
	s.finds.append(find)
	did_science(s)
	return find


func deploy(s: Dictionary, id: String):
	if s.inst.get(id):
		return null
	var def = null
	for x in Data.INSTRUMENTS[s.site.id]:
		if x.id == id:
			def = x
			break
	s.inst[id] = true
	did_science(s)
	var find := { "title": def.name + " is working!", "text": def.text, "src": def.src, "perk": def.get("perk"), "icon": def.icon, "sol": s.sol, "kind": "inst", "key": id }
	s.finds.append(find)
	return find


func photo(s: Dictionary, i: int):
	if s.photos.get(i):
		return null
	var def: Dictionary = Data.PHOTOS[s.site.id][i]
	s.photos[i] = true
	did_science(s)
	var find := { "title": "Postcard: " + def.name, "text": def.text, "src": def.src, "icon": "📸", "sol": s.sol, "kind": "photo", "key": str(i) }
	s.finds.append(find)
	return find


func trick(s: Dictionary, dist: float) -> void:
	s.stats.tricks += 1
	s.stats.bestThrow = maxf(s.stats.bestThrow, dist)
	note(s, "throw")


## The rover hit something. A real crash shakes some charge out of the battery.
func crash(s: Dictionary, impact: float) -> Dictionary:
	var hard: bool = impact >= R.crashHard
	s.stats.crashes = int(s.stats.get("crashes", 0)) + 1
	if hard:
		s.m.rover.charge = maxf(0, s.m.rover.charge - R.crashCharge)
		s.stats.hardCrashes = int(s.stats.get("hardCrashes", 0)) + 1
		note(s, "crash")
	return { "hard": hard }


## The drill overheated: the bit is a little more worn, and heats faster from now on.
func jam(s: Dictionary) -> float:
	s.wear.drill = minf(R.jamWearMax, s.wear.drill + R.jamWear)
	note(s, "jam")
	return s.wear.drill


func service_panel(s: Dictionary, i: int) -> void:
	s.rack.eff[i] = 1.0
	s.today.panels[i] = 1


func clean_all_panels(s: Dictionary) -> void:
	s.rack.eff = [1.0, 1.0, 1.0]


# ---------- repairs and the radio delay ----------
func comm_info(s: Dictionary) -> Dictionary:
	if s.site.id == "moon":
		return { "oneWay": "1.3 seconds", "round": "about 3 seconds", "wait": 3.0, "minutes": 0 }
	var date = Js.orv(weather(s).get("date"), Weather.today_iso())
	var one: float = Weather.mars_delay_min(date)
	var rnd := one * 2
	return { "oneWay": "about " + str(Js.mround(one)) + " minutes", "round": "about " + str(Js.mround(rnd)) + " minutes", "wait": clampf(rnd * 1.4, 14, 60), "minutes": Js.mround(rnd) }


func ask_earth(s: Dictionary) -> Dictionary:
	var g = s.glitch
	if not g or g.state != "broken":
		return no("")
	if not s.m.comms.on:
		return no("The Radio Dish has no power today, so you cannot call Earth.")
	var info := comm_info(s)
	g.state = "asked"
	g.asked = true
	g.replyAt = s.t + info.wait
	note(s, "delay")
	return { "ok": true, "info": info }


func repair_miss(s: Dictionary) -> void:
	s.glitch.misses += 1
	s.rack.charge = maxf(0, s.rack.charge - 0.5)


func repair_done(s: Dictionary) -> void:
	var g: Dictionary = s.glitch
	# a Greenhouse repair does not replace a blown pump fuse (that is a crisis, see crisis.gd)
	machine(s, g.machine).broken = g.machine == "food" and s.flags.get("pumpFuse") == s.sol
	g.state = "fixed"
	s.stats.repairs += 1
	s.today.repair = { "machine": g.machine, "misses": g.misses, "asked": g.asked }


# ---------- night ----------
## info: { late?, launch? }
func end_sol(s: Dictionary, info: Dictionary = {}) -> Dictionary:
	var L: Dictionary = s.level
	var t: Dictionary = s.today
	var ev := []
	var last: bool = s.sol >= s.totalSols
	if info.get("late"):
		s.air = maxf(0, s.air - R.lateAir)
		t.late = true
	# if you turned in early, the rest of the day still passes (safely indoors).
	# info.launch: the crew has lifted off, so the rest of the day does not pass at the outpost.
	var guard := 0
	s.sleeping = true
	while not info.get("launch") and s.t < s.dayLength and not s.dayDone and guard < 4000:
		guard += 1
		ev.append_array(tick(s, 0.5, { "outside": false }))
	s.sleeping = false
	s.dayDone = true
	var sf := shield(s)
	var dinner_v := 0.0
	var night := 0.0
	var dry := 0.0
	var picked := 0
	var picked_food := 0.0
	if not last:
		# After the shift the crew inside picks whatever is ripe, stores it and plants the same crop again. Food then
		# depends on what you decided (power for the lamps, ice for the water, which crop) more than on how fast you
		# run: picking during the day still gets a bed growing again sooner. (Not while the leak has the store sealed.)
		if s.flags.get("pantryShut") != s.sol:
			for b in s.m.food.beds:
				if b.state != "ripe":
					continue
				picked += 1
				picked_food += crop(b.crop).food
				b.state = "growing"
				b.g = 0.0
		s.food = minf(100, s.food + picked_food)
		t.crewCrates = picked
		t.crewFood = picked_food
		# dried space food needs water: with an empty tank the crew opens extra ready-made packs (see dinner)
		var shared := float(s.colony.get("asks", 0))
		dry = dry_dinner(s)
		dinner_v = dinner(s) - dry - shared
		if dry and not s.seen.has("thirst"):
			s.seen.thirst = s.sol
			t.whys.append("thirst")
		s.food -= dinner_v + dry + shared
		night = s.site.doseNight * L.doseScale * (1 - sf)
		s.dose += night
		if s.glitch and s.glitch.state != "fixed" and s.glitch.state != "pending":
			machine(s, s.glitch.machine).broken = false
			s.glitch.state = "fixed"
			t.repair = { "machine": s.glitch.machine, "overnight": true }
		Crisis.night(s)
	# life support was looked after today: the filter never filled up and the tank never ran dry
	t.care = not t.wasStale and t.noWater < 1 and s.water >= 1
	var extra := func(res: String) -> Array:
		var o := []
		for x in t.extra:
			if x.res == res:
				o.append({ "text": x.text, "v": x.v })
		return o
	var lines := []
	var shared_food := float(s.colony.get("asks", 0)) if not last else 0.0
	lines.append({ "res": "air", "icon": "💨", "parts": Js.compact([
		{ "text": "Air Maker turned ice into oxygen", "v": t.airMade } if t.airMade else { "text": "Air Maker made nothing", "v": 0 },
		{ "text": "Crew breathing", "v": -Js.mround(t.breath - t.staleAir) },
		{ "text": "Extra air to push out the stale air", "v": -Js.mround(t.staleAir) } if t.staleAir >= 0.5 else null,
		{ "text": "Leaked out through the hole", "v": -Js.mround(t.leaked) } if t.leaked >= 0.5 else null,
		{ "text": "Late rush home", "v": -R.lateAir } if t.late else null
	]) + extra.call("air") })
	lines.append({ "res": "food", "icon": "🥬", "parts": Js.compact([
		({ "text": str(t.crates) + " veggie crate" + ("s" if t.crates > 1 else "") + " stored", "v": t.cratesFood } if t.crates else (null if picked else { "text": "No harvest today", "v": 0 })),
		{ "text": "The crew picked " + str(picked) + " ripe bed" + ("s" if picked > 1 else "") + " after your shift", "v": picked_food } if picked else null,
		{ "text": "Crew dinner", "v": -dinner_v } if dinner_v else null,
		{ "text": "Extra packs: no water to cook dried food", "v": -dry } if dry else null,
		{ "text": "Shared with the town, which is short of food", "v": -shared_food } if shared_food else null
	]) + extra.call("food") })
	lines.append({ "res": "water", "icon": "💧", "parts": Js.compact([
		{ "text": "Ice melted into the tank", "v": Js.mround(t.water.ice) } if t.water.ice else null,
		{ "text": "The crew drank and washed", "v": -Js.mround(t.water.crew) } if t.water.crew >= 0.5 else { "text": "The tank was empty", "v": 0 },
		{ "text": "The recycler gave back", "v": Js.mround(t.water.back) } if t.water.back >= 0.5 else null,
		{ "text": "Kept by the growing plants", "v": -Js.mround(t.water.plants) } if t.water.plants >= 0.5 else null
	]) + extra.call("water") })
	lines.append({ "res": "filter", "icon": "🫧", "parts": Js.compact([
		{ "text": "CO₂ soaked up from the crew's breath", "v": -Js.mround(t.filterUsed) },
		{ "text": "Baked clean with a power cell", "v": Js.mround(t.baked) } if t.baked else null
	]) + extra.call("filter") })
	lines.append({ "res": "dose", "icon": "☢️", "parts": Js.compact([
		{ "text": "Everyday radiation", "v": r1(t.doseBase) },
		{ "text": "Solar storm", "v": r1(t.doseStorm) } if t.doseStorm >= 0.05 else null,
		{ "text": "Night (shield blocked " + str(Js.mround(sf * 100)) + "%)", "v": r1(night) } if night else null
	]) })

	var fail = null
	if s.air <= 0:
		fail = "air"
	elif s.food < 0:
		fail = "food"
	elif s.dose >= 100:
		fail = "dose"
	s.food = clampf(s.food, 0, 100)
	var decision = null
	for d in s.decisions:
		if d.sol == s.sol:
			decision = d
			break
	var finds_today := []
	for f in s.finds:
		if f.sol == s.sol:
			finds_today.append(f)
	var report := {
		"sol": s.sol, "lines": lines, "before": s.morning, "after": { "air": s.air, "food": s.food, "dose": s.dose, "water": s.water, "filter": s.filter },
		"fail": fail, "last": last, "events": ev, "repair": t.repair,
		"whys": t.whys.duplicate(), "scar": t.scar, "care": t.care,                         # what today explained, for the night report
		"dark": s.darkSol - s.sol if s.darkSol > s.sol and s.darkSol - s.sol <= 2 else 0,  # days until the long dark, when it is near
		"finds": finds_today, "forecast": null, "shield": sf,
		"day": s.day, "goalDone": t.goalDone,
		"decision": decision,
		"harder": [] if last else harder_list(s, s.sol + 1), "nextDay": null if last else day_info(s, s.sol + 1)
	}
	report.facts = pick_facts(s, 1 if t.whys.size() > 1 else 2)
	report.fact = report.facts[0]
	if not fail and not last:
		var e2 = s.env[s.sol]
		var w2 = s.weather[s.sol] if s.sol < s.weather.size() else null
		if s.m.comms.on:
			report.forecast = { "env": e2, "weather": w2, "full": true }
		elif s.inst.get("beam") and s.site.id == "mars":
			report.forecast = { "env": e2, "weather": null, "full": false }
	s.forecast = s.m.comms.on
	s.night = true
	s.log.append(report)
	if fail:
		s.over = { "type": "fail", "reason": fail }
	return report


## The crew lifts off.
func finish(s: Dictionary) -> void:
	s.over = { "type": "win" }


func pick_facts(s: Dictionary, n: int) -> Array:
	var tags := []
	var t: Dictionary = s.today
	var e: String = env(s).kind
	var out := []
	if t.baked or s.filter < R.filterWarn:
		tags.append("filter")
	if e == "dark":
		tags.append("dark")
	if t.water.ice:
		tags.append("water")
	if t.repair:
		tags.append("repair")
	if weather(s).level > 0:
		tags.append("storm")
	if e == "storm" or e == "dusty":
		tags.append("dust")
	if e == "shadow" or e == "lowsun" or e == "dark":
		tags.append("power")
	if t.ice:
		tags.append("ice")
	if t.bags:
		tags.append("shield")
	if t.cells.get("rover"):
		tags.append("rover")
	if t.science:
		tags.append("science")
	if t.cells.get("comms"):
		tags.append("comms")
	if t.crates:
		tags.append("crop")
	if t.crates or t.cells.get("food"):
		tags.append("food")
	if t.airMade:
		tags.append("air")
	tags.append_array(["dose", "any"])
	var site_id: String = s.site.id
	for tag in tags:
		if out.size() >= n:
			break
		var list := Data.FACTS.filter(func(f): return not s.seenFacts.has(f.id) and (f.site == "any" or f.site == site_id) and tag in f.tags)
		if list.size():
			var f: Dictionary = list[int(floor(s.rng.next() * list.size()))]
			s.seenFacts[f.id] = 1
			out.append(f)
	if out.is_empty():
		var rest := Data.FACTS.filter(func(f): return f.site == "any" or f.site == site_id)
		out.append(rest[int(floor(s.rng.next() * rest.size()))] if rest.size() else Data.FACTS[0])
	return out


func rank_for(s: Dictionary) -> Dictionary:
	return Data.RANKS.get(s.level.id, Data.RANKS.cadet)


func badges(s: Dictionary) -> Array:
	var b := []
	var st: Dictionary = s.stats
	if st.storms and st.stormOut < 1:
		b.append({ "icon": "⚡", "name": "Storm Dodger", "text": "Never caught outside in a solar storm" })
	if s.bags >= R.shieldSlots:
		b.append({ "icon": "🛡️", "name": "Shield Master", "text": "Covered the whole dome in soil bags" })
	if st.crates >= 4:
		b.append({ "icon": "🥕", "name": "Space Farmer", "text": "Harvested " + str(st.crates) + " veggie crates" })
	if st.cores >= 6:
		b.append({ "icon": "🪨", "name": "Rock Hound", "text": "Drilled " + str(st.cores) + " rock cores" })
	if s.inst.get("seismo") and s.inst.get("beam") and s.inst.get("rad"):
		b.append({ "icon": "🛰️", "name": "Science Station", "text": "Set up all three instruments" })
	if st.bestThrow >= 15:
		b.append({ "icon": "🎯", "name": "Sharpshooter", "text": "Landed a throw from " + str(Js.mround(st.bestThrow)) + " m away" })
	if st.drive >= 150:
		b.append({ "icon": "🚙", "name": "Road Tripper", "text": "Drove the rover for " + str(Js.mround(st.drive)) + " seconds" })
	var sky = s.get("sky")
	if sky and sky.get("found"):
		b.append({ "icon": "☄️", "name": "Space Rock Hunter", "text": "Picked up " + str(sky.found) + " meteorite" + ("s" if sky.found > 1 else "") + " from a fresh crater" })
	if s.get("colony") and s.colony.stage:
		b.append({ "icon": "🏘️", "name": "Town Founder", "text": "Your outpost looked after itself so well that " + ("settlers came" if s.colony.stage > 1 else "a supply ship came") + " from Earth" })
	if st.cores >= 3 and not s.wear.drill and not s.wear.rover:
		b.append({ "icon": "🔧", "name": "Gentle Hands", "text": "Never overheated the drill or ran the rover battery flat" })
	if st.drive >= 60 and not st.get("hardCrashes"):
		b.append({ "icon": "🛞", "name": "Safe Driver", "text": "Drove the rover without one real crash" })
	if s.pioneer and int(st.get("rocks", 0)) >= 8:
		b.append({ "icon": "⛏️", "name": "Rock Breaker", "text": "Broke up " + str(st.rocks) + " boulders for their materials" })
	if s.pioneer and int(st.get("built", 0)) >= 4:
		b.append({ "icon": "🏗️", "name": "Master Builder", "text": "Built " + str(st.built) + " things from local rock" })
	if s.get("colony") and s.colony.stage >= 4:
		b.append({ "icon": "🌆", "name": "City Founder", "text": str(s.colony.people) + " people live beside your outpost" })
	if s.dose < 40:
		b.append({ "icon": "💚", "name": "Healthy Crew", "text": "Kept radiation under 40%" })
	if st.dayGoals >= s.totalSols - 2:
		b.append({ "icon": "🎓", "name": "Star Student", "text": "Finished every daily challenge" })
	if s.decisions.size():
		b.append({ "icon": "🧭", "name": "Decision Maker", "text": "Made " + str(s.decisions.size()) + " big call" + ("s" if s.decisions.size() > 1 else "") + " with no checklist" })
	return b


## Mission Control's advice: the most urgent thing right now, the reason behind it, and the hologram that explains it.
func hint_info(s: Dictionary):
	var m: Dictionary = s.m
	var left: float = (s.dayLength - s.t) / s.dayLength
	var mars: bool = s.site.id == "mars"
	var say := func(text: String, why: String = "", topic: String = "") -> Dictionary:
		return { "text": text, "why": why, "topic": topic }
	var air_need: float = air_drain(s) * stale(s) * left + s.leak * left
	if s.glitch and s.glitch.state == "broken":
		return say.call("Something is broken! Look for the sparks and fix it.")
	if s.filter <= 0 and s.stale <= 1:
		return say.call("The CO₂ filter is full, so the air is draining fast. Plug a power cell into the Air Scrubber by the airlock!", "The heat pushes the trapped gas out, and the filter can soak up more.", "scrubber")
	if s.air < air_need + 8:
		if m.air.queue > 0 and m.air.power == 0:
			return say.call("The Air Maker has ice but no power. Bring it a power cell!", "It takes electricity to pull the oxygen out of water.", "electrolysis")
		if m.air.power > 0 and m.air.queue == 0:
			return say.call("The Air Maker is powered but hungry. Bring ice from the " + s.site.iceName + "!", "Ice is frozen water, and water is where the oxygen comes from.", "electrolysis")
		if m.air.power == 0:
			return say.call("Air is running low. The Air Maker needs a power cell and ice.", "Ice holds the oxygen. Electricity sets it free.", "electrolysis")
	var planted := 0
	var ripe := 0
	for b in m.food.beds:
		if b.state != "empty":
			planted += 1
		if b.state == "ripe":
			ripe += 1
	if ripe:
		return say.call("Veggies are ripe! Pick them and carry the crate to the food hatch on the dome.")
	if s.food < dinner(s) * 2 and s.sol < s.totalSols:
		if not planted:
			return say.call("Food is getting low. Plant seeds in the Greenhouse beds.", "Lettuce is ready fastest. Potatoes fill the pantry more.", "crops")
		if m.food.lamp <= 0:
			return say.call("The plants are in the dark. The Greenhouse needs a power cell for its lamps.", "Light is the energy a plant uses to grow.", "plant")
		if s.water <= 0:
			return say.call("The plants are thirsty. Drop an ice chunk in the Greenhouse water tank.", "A dry plant closes its pores and stops growing.", "plant")
	if s.water < R.waterWarn and planted:
		return say.call("The water tank is nearly empty. Bring it an ice chunk before the plants go thirsty.", "The recycler gives back what the crew drinks, but plants keep their water.", "water")
	if s.filter < R.filterWarn and s.filter > 0:
		return say.call("The CO₂ filter is nearly full. A power cell at the Air Scrubber will bake it clean.", "It soaks up the gas the crew breathes out, like a sponge.", "scrubber")
	if s.storm and not s.storm.warned and s.forecast and s.bags < 8 and s.storm.level >= 2:
		return say.call("A solar storm is forecast today. Soil bags on the dome will protect the crew!", "Soil stops the storm's particles before they reach anyone.", "shield")
	if s.dose > 55 and s.bags < R.shieldSlots:
		return say.call("The radiation badge is filling up. More soil bags on the dome would slow it down.", "Radiation adds up, and the badge never goes back down.", "dose")
	if s.darkSol == s.sol + 1 and left < 0.5 and s.rack.cells < 3:
		return say.call("Tomorrow is the long dark, with almost no Sun. Leave power cells on the rack tonight!", "Saved cells are the only power you will have.", "longdark")
	var charging: bool = not s.rack.broken and s.t <= s.dayLength * R.chargeSpan and s.cellsToday > R.morningCells      # only then is sunshine being wasted
	if s.rack.cells >= rack_max(s) and charging:
		return say.call("The Solar Rack is full, so the panels are wasting sunshine. Use those power cells!", "A full rack cannot store any more electricity.")
	if minf(s.rack.eff[0], minf(s.rack.eff[1], s.rack.eff[2])) < 0.7 and env(s).kind != "dark":
		if mars:
			return say.call("Dust is covering the solar panels. Brush them off to charge faster.", "Dust blocks the sunlight before it reaches the cells.", "solar")
		return say.call("The Sun has moved. Turn the solar panels to face it again.", "A panel that faces away catches less light.", "solar")
	if left < 0.14:
		return say.call("The shift is almost over. Head back to the airlock!")
	return null


func hint(s: Dictionary) -> String:
	var h = hint_info(s)
	return h.text if h else ""
