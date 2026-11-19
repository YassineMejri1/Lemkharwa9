extends TestBase
## The mission rules: the checks of tools/tests/rules.test.js, plus the same 72 robot missions the web rules played
## (tests/reference_runs.json, made by tools/godot/rules_reference.js). The GDScript rules must get the same results
## day by day: the same weather, the same breakdowns and crises, the same meters, the same discoveries.

var arch: Dictionary


func game(site: String, level: String, seed_value: int, D: float = 300) -> Dictionary:
	return Sim.new_game({ "site": site, "level": level, "seed": seed_value, "weather": arch, "dayLength": D })


func run_to(s: Dictionary, t: float, ctx: Dictionary = { "outside": false }) -> Array:
	var ev := []
	while s.t < t and not s.dayDone:
		ev.append_array(Sim.tick(s, 0.25, ctx))
	return ev


func next_day(s: Dictionary) -> void:
	Sim.end_sol(s, {})
	Sim.start_sol(s)


func keep_alive(s: Dictionary) -> void:
	s.air = 90.0
	s.food = 90.0
	s.dose = 0.0


static func has_type(ev: Array, type: String) -> bool:
	for e in ev:
		if e.type == type:
			return true
	return false


## The robot player of tools/tests/harness.js, line for line: one action every `gap` seconds.
func bot(site: String, level: String, seed_value: int, o: Dictionary = {}) -> Dictionary:
	var gap: float = o.get("gap", 10)
	var D: float = o.get("D", 300)
	var s := Sim.new_game({ "site": site, "level": level, "seed": seed_value, "weather": arch, "dayLength": D, "pioneer": o.get("pioneer", false) })
	var bags_ready := 0
	var log := []
	var pick: Dictionary = o.get("pick", {})
	while not s.over:
		var nxt := 0.0
		var fail = null
		while not s.dayDone and not fail:
			var ph := Sim.storm_phase(s)
			var hiding: bool = o.get("shelter") != false and (ph == "warning" or ph == "active")
			if hiding and o.get("travel") and s.storm and s.t < s.storm.start - Sim.warn_lead(s) + o.travel:
				hiding = false
			var outside := not hiding
			var ev := Sim.tick(s, 0.25, { "outside": outside, "driving": false })
			for e in ev:
				if e.type == "fail":
					fail = e.reason
				if e.type == "bag":
					bags_ready += 1
				if e.type == "crisis":
					var v = Crisis.view(s)
					var r = Crisis.choose(s, pick.get(v.id, v.options[0].id))
					if r.skip:
						var secs: float = r.skip * s.dayLength
						while secs > 0 and not s.dayDone:
							Sim.tick(s, 0.5, { "outside": false })
							secs -= 0.5
				if e.type == "break":
					s._fixAt = s.t + 25
			if s.glitch and s.glitch.state == "broken" and s.t >= s.get("_fixAt", INF):
				Sim.repair_done(s)
			if not outside or s.t < nxt:
				continue
			nxt = s.t + gap
			var m: Dictionary = s.m
			var beds: Array = m.food.beds
			var did := false
			for i in 4:
				if beds[i].state == "ripe":
					var kind := Sim.harvest(s, i)
					Sim.store_crate(s, kind)
					Sim.plant(s, i)
					did = true
					break
			if did:
				continue
			for i in 4:
				if beds[i].state == "empty":
					Sim.plant(s, i)
					did = true
					break
			if did:
				continue
			if bags_ready > 0 and s.bags < 16:
				bags_ready -= 1
				Sim.add_bag(s)
				continue
			if m.air.queue < minf(3, m.air.power if m.air.power else 3.0) and s.air < 86 and s.t < D * 0.9:
				Sim.feed_ice(s, "air")
				continue
			if s.water < float(o.get("waterAt", 20)):
				Sim.feed_ice(s, "food")
				continue
			if s.rack.cells > 0:
				var tgt := ""
				var cores_done := 0
				for f in s.finds:
					if f.kind == "core":
						cores_done += 1
				if m.air.power == 0 and s.air < 80:
					tgt = "air"
				elif o.get("dishFirst") and not m.comms.on and not m.comms.broken and o.get("dish") != false and s.t < D * 0.5:
					tgt = "comms"
				elif o.get("scrub") != false and s.filter < float(o.get("scrubAt", 25)):
					tgt = "scrub"
				elif m.food.lamp < 0.15:
					tgt = "food"
				elif s.bags + m.bag.pending + bags_ready < int(o.get("bags", 16)):
					tgt = "bag"
				elif not m.comms.on and not m.comms.broken and o.get("dish") != false:
					tgt = "comms"
				elif o.get("science") and m.lab.power == 0 and cores_done + m.lab.queue.size() < 8:
					tgt = "lab"
				if tgt != "" and Sim.plug(s, tgt).ok:
					Sim.take_cell(s)
					continue
			if o.get("science"):
				var done := false
				for i in 4:
					if Sim.cores_left(s, i) > 0 and m.lab.queue.size() < 4:
						Sim.submit_core(s, Sim.drill_core(s, i, 2))
						done = true
						break
				if done:
					nxt = s.t + gap * 3
					continue
				for id in ["seismo", "beam", "rad"]:
					if not done and not s.inst.get(id):
						Sim.deploy(s, id)
						done = true
				if done:
					nxt = s.t + gap * 3
					continue
				for k in [0, 1]:
					if not done and not s.photos.get(k):
						Sim.photo(s, k)
						done = true
		if fail:
			s.over = { "type": "fail", "reason": fail }
			break
		var last: bool = s.sol >= s.totalSols
		if last and o.get("science"):
			s.caseLoaded = true
		var rep := Sim.end_sol(s, {})
		var w = Sim.weather(s).cls
		log.append({ "sol": s.sol, "air": Js.mround(s.air), "food": Js.mround(s.food), "dose": Js.mround(s.dose), "water": Js.mround(s.water),
			"filter": Js.mround(s.filter), "kind": Sim.env(s).kind, "whys": ",".join(PackedStringArray(rep.whys)), "bags": s.bags,
			"cells": Js.fixed(s.cellsToday, 1), "w": w if w else "-", "goal": rep.goalDone, "fact": rep.fact.id })
		if rep.fail:
			break
		if last:
			Sim.finish(s)
			break
		Sim.start_sol(s)
	return { "s": s, "log": log }


func run() -> void:
	arch = Weather.archive()
	arch.source = "archive"
	unit_checks()
	parity()


func unit_checks() -> void:
	# ---- 1. a "later today" consequence opened late on a short day still lands the same day
	var s := game("mars", "commander", 11, 180)
	keep_alive(s)
	s.storm = null
	s.glitch = null
	s.crisis = { "id": "fuse", "at": 150.0, "until": 170.0, "state": "pending" }
	s.m.comms.on = true
	var ev := run_to(s, 151)
	ok("fuse crisis opened at t=150 on a 180 s day", has_type(ev, "crisis"))
	Crisis.choose(s, "foil")
	var a = null
	for x in s.after:
		if x.sol == s.sol:
			a = x
			break
	ok("foil consequence is scheduled inside the day", a != null and a.t <= s.dayLength - 0.5, "t=" + str(a.t if a else null))
	ev = run_to(s, 180)
	ok("foil consequence fired the same day", has_type(ev, "consequence"))
	keep_alive(s)
	next_day(s)
	var ev2 := run_to(s, 10)
	ok("nothing spills into the next morning", not has_type(ev2, "consequence") and not s.m.comms.broken and not s.m.food.broken)

	# ---- 1b. shrinking the day keeps a pending consequence inside the day
	s = game("moon", "commander", 12, 720)
	keep_alive(s)
	s.storm = null
	s.glitch = null
	s.crisis = { "id": "leak", "at": 500.0, "until": 600.0, "state": "pending" }
	run_to(s, 501)
	Crisis.choose(s, "later")
	Sim.set_day_length(s, 180)
	a = null
	for x in s.after:
		if x.sol == s.sol and not x.done:
			a = x
			break
	ok("after shrinking the day the consequence is still inside it", a != null and a.t <= 179.5)

	# ---- 2. the pump fuse and a Greenhouse breakdown do not cancel each other
	s = game("mars", "commander", 21)
	keep_alive(s)
	s.storm = null
	s.glitch = { "machine": "food", "at": 10.0, "state": "pending", "replyAt": 0.0, "misses": 0, "asked": false }
	s.crisis = { "id": "fuse", "at": 20.0, "until": 60.0, "state": "pending" }
	run_to(s, 21)
	ok("greenhouse broke, then the fuse blew", s.glitch.state == "broken" and s.m.food.broken and s.flags.pumpFuse == s.sol)
	Crisis.choose(s, "pump")
	ok("fuse in the pump does NOT mend the breakdown", s.m.food.broken == true)
	Sim.repair_done(s)
	ok("repair then clears it", s.m.food.broken == false)
	var s2 := game("mars", "commander", 22)
	keep_alive(s2)
	s2.storm = null
	s2.glitch = { "machine": "food", "at": 10.0, "state": "pending", "replyAt": 0.0, "misses": 0, "asked": false }
	s2.crisis = { "id": "fuse", "at": 20.0, "until": 60.0, "state": "pending" }
	run_to(s2, 21)
	Crisis.choose(s2, "radio")
	Sim.repair_done(s2)
	ok("repairing the breakdown does NOT replace the blown fuse", s2.m.food.broken == true)
	keep_alive(s2)
	next_day(s2)
	ok("next morning the greenhouse works again", s2.m.food.broken == false)

	# ---- 3. daily challenges cannot become impossible by working ahead
	s = game("moon", "commander", 31)
	keep_alive(s)
	for i in 13:
		Sim.add_bag(s)
	next_day(s)
	keep_alive(s)
	ok("day 2 challenge is the 5-bag one", s.day.goal != null and s.day.goal.id == "bags")
	ok("progress text asks for the 3 that are left", Sim.day_goal_progress(s) == " (0/3)", Sim.day_goal_progress(s))
	for i in 3:
		Sim.add_bag(s)
	ev = run_to(s, 1)
	ok("challenge pays out after the last 3 bags", has_type(ev, "daygoal"))
	s2 = game("moon", "commander", 32)
	keep_alive(s2)
	next_day(s2)
	keep_alive(s2)
	ok("normal case still asks for 5", Sim.day_goal_progress(s2) == " (0/5)", Sim.day_goal_progress(s2))
	for i in 4:
		Sim.add_bag(s2)
	ok("4 bags is not enough", not Sim.day_goal_done(s2))
	Sim.add_bag(s2)
	ok("5 bags is", Sim.day_goal_done(s2))

	# ---- 4. going to bed early does not dodge a crisis
	s = game("moon", "commander", 41)
	while not s.crisisPlan.has(s.sol):
		keep_alive(s)
		next_day(s)
	var id: String = s.crisis.id
	var day: int = s.sol
	keep_alive(s)
	run_to(s, 5)
	Sim.end_sol(s, {})                      # straight to bed
	ok("crisis did not open during sleep", s.crisis.state == "pending")
	keep_alive(s)
	Sim.start_sol(s)
	ok("it is carried to the next day", s.crisis != null and s.crisis.id == id and s.sol == day + 1)
	ok("the day after still has its own planned crisis", s.crisisPlan.has(day + 2) or Js.index_of(s.level.crisisSols, day + 2) < 0)

	# ---- 5. the backup scrubber cannot drive the rack charge below zero
	s = game("moon", "commander", 51)
	keep_alive(s)
	s.storm = null
	s.glitch = null
	s.rack.cells = 0
	s.rack.charge = 0.07
	s.crisis = { "id": "co2", "at": 1.0, "until": 60.0, "state": "pending" }
	s.rack.broken = true
	run_to(s, 2)
	Crisis.choose(s, "cell")
	ok("rack charge stays at 0 or above", s.rack.charge >= 0, "charge=" + str(s.rack.charge))

	# ---- the random numbers match the web version bit for bit (mulberry32)
	var r := Rng32.new(12345)
	var first := [r.next(), r.next(), r.next()]
	ok("mulberry32 matches JavaScript", is_equal_approx(first[0], 0.9797282677609473) and is_equal_approx(first[1], 0.3067522644996643) and is_equal_approx(first[2], 0.484205421525985), str(first))

	# ---- describing a real day
	var days := Weather.by_day(arch, "moon")
	var stormy = null
	for d in days:
		if d.level >= 2:
			stormy = d
			break
	ok("the archive has a strong storm for the Moon", stormy != null)
	if stormy:
		ok("describe() names the satellites", "GOES" in Weather.describe(stormy, "moon").text)
	ok("Mars radio delay is minutes", Weather.mars_delay_min("2024-05-10") > 3 and Weather.mars_delay_min("2024-05-10") < 23)


## Every reference mission, played again with the GDScript rules.
func parity() -> void:
	var refs: Array = Data.load_json("res://tests/reference_runs.json")
	var same := 0
	var bad := []
	var won := 0
	for ref in refs:
		var pick := {}
		for cid in Crisis.ORDER:
			pick[cid] = Crisis.C[cid].options[int(ref.opt)].id
		var r := bot(ref.site, ref.level, int(ref.seed), { "gap": 8, "science": true, "pick": pick })
		var s: Dictionary = r.s
		var why := _diff(ref, r)
		if why == "":
			same += 1
		else:
			bad.append(ref.site + "/" + ref.level + "/" + str(ref.seed) + ": " + why)
		if s.over and s.over.type == "win":
			won += 1
	for b in bad.slice(0, 8):
		print("  differs: " + b)
	ok("all " + str(refs.size()) + " robot missions play out exactly as in the web version", bad.is_empty(), str(same) + " same, " + str(bad.size()) + " differ")
	print("  bot missions: " + str(won) + " won of " + str(refs.size()))


static func _near(a, b) -> bool:
	return absf(float(a) - float(b)) < 0.011


func _diff(ref: Dictionary, r: Dictionary) -> String:
	var s: Dictionary = r.s
	var log: Array = r.log
	if log.size() != ref.log.size():
		return "played " + str(log.size()) + " days, web " + str(ref.log.size())
	for i in log.size():
		var a: Dictionary = log[i]
		var b: Dictionary = ref.log[i]
		for k in b:
			var va = a.get(k)
			var vb = b[k]
			var same: bool = _near(va, vb) if (vb is float or vb is int) else str(va) == str(vb)
			if not same:
				return "day " + str(i + 1) + " " + k + ": " + str(va) + " vs web " + str(vb)
	var e: Dictionary = ref.end
	var over_a := str(s.over.type) + str(s.over.get("reason", "")) if s.over else "none"
	var over_b := str(ref.over.type) + str(ref.over.get("reason", "")) if ref.over else "none"
	if over_a != over_b:
		return "ended " + over_a + ", web " + over_b
	for k in ["air", "food", "dose", "water", "filter", "bags"]:
		if not _near(s[k], e[k]):
			return "end " + k + ": " + str(s[k]) + " vs web " + str(e[k])
	var finds := []
	for f in s.finds:
		finds.append(f.key)
	if str(finds) != str(e.finds):
		return "finds " + str(finds) + " vs web " + str(e.finds)
	var dec := []
	for d in s.decisions:
		dec.append(d.id + "." + d.opt + ":" + str(d.later.size()))
	if str(dec) != str(e.decisions):
		return "decisions " + str(dec) + " vs web " + str(e.decisions)
	var wx := []
	for w in s.weather:
		wx.append(w.date + ":" + str(int(w.level)))
	if str(wx) != str(e.weather):
		return "weather " + str(wx) + " vs web " + str(e.weather)
	var badges := []
	for b in Sim.badges(s):
		badges.append(b.name)
	if str(badges) != str(e.badges):
		return "badges " + str(badges) + " vs web " + str(e.badges)
	for k in e.stats:
		if not _near(s.stats.get(k, 0), e.stats[k]):
			return "stat " + k + ": " + str(s.stats.get(k)) + " vs web " + str(e.stats[k])
	var dv = (str(s.devil.sol) + "@" + Js.num(Sim.r1(s.devil.at * 10) / 10.0)) if s.devil else null
	if (dv == null) != (e.devil == null):
		return "devil " + str(dv) + " vs web " + str(e.devil)
	return ""
