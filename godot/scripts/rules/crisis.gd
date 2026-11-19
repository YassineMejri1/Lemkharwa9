extends Node
## Astro Outpost — crisis moments. A port of js/crisis.js.
## A crisis is a problem with NO checklist. Mission Control cannot help in time, and there is more than one thing you
## could do. You choose, the game carries on, and the consequences show up later: in a minute, tonight, or tomorrow
## morning. Every crisis is based on something that really happened to a space crew or a rover; the night report tells
## that story. Numbers here are GAME scales, tuned so that every option costs something different.
##
## The web version kept each consequence as a JavaScript closure. Here a consequence is a name (s.after[i].fn) that
## _consequence() carries out, so the mission state stays plain data (it can be saved and sent to a crew).

var R: Dictionary:
	get:
		return Data.RULES

const WARM := { "air": "Air Maker", "food": "Greenhouse", "lab": "Science Lab" }

## The fixed parts of each crisis (the words that depend on the mission are in text_for / science_for / src_for).
const C := {
	"leak": { "icon": "🕳️", "title": "Hiss… the habitat is leaking!", "alarm": "AIR LEAK", "src": "iss",
		"science": "In 2018 the crew of the International Space Station found a hole just 2 millimetres wide that was letting air escape. They sealed it with glue and a cloth patch. The Station is enormous, so Mission Control even let the crew sleep first. A small habitat has far less air to spare.",
		"options": [
			{ "id": "patch", "icon": "🩹", "label": "Stop everything and patch the hole", "text": "Hurry home, hunt for the hole and glue a patch over it. Today's other jobs will have to wait." },
			{ "id": "seal", "icon": "🚪", "label": "Shut the hatch to the leaking room", "text": "Close the inside door so that only one room loses its air. It takes seconds." },
			{ "id": "later", "icon": "⏳", "label": "Keep working and fix it tonight", "text": "It is only a tiny hole. Finish today's jobs first." }
		] },
	"co2": { "icon": "🌫️", "title": "The air filter is clogged!", "alarm": "STALE AIR", "src": "apollo",
		"science": "On Apollo 13 the air filters began to fail far from Earth. Engineers on the ground worked out how to build a new filter holder from plastic bags, cardboard, a sock and sticky tape, then read the steps to the crew over the radio. It worked, and it helped bring them home.",
		"options": [
			{ "id": "build", "icon": "🧦", "label": "Build a new filter from spare parts", "text": "Sticky tape, a plastic bag, a sock and a spare canister. It will take a while, and it might not fit." },
			{ "id": "cell", "icon": "🔋", "label": "Run the backup scrubber on a power cell", "text": "The backup machine cleans the air with electricity. It swallows a whole power cell." },
			{ "id": "flush", "icon": "💨", "label": "Flush the cabin with fresh oxygen", "text": "Open the tanks wide and blow the stale air outside." }
		] },
	"mold": { "icon": "🍄", "title": "Fuzzy white spots on the plants!", "alarm": "SICK PLANTS", "src": "iss",
		"science": "In 2015 mould grew on zinnia flowers in the Space Station's garden. Astronaut Scott Kelly cut off the mouldy leaves, turned the fans up to dry the air, and chose for himself when to water instead of waiting for instructions. The flowers survived and bloomed.",
		"options": [
			{ "id": "cut", "icon": "✂️", "label": "Pull out the sick plants", "text": "Dig up the whole bed that has mould on it and throw it away." },
			{ "id": "fans", "icon": "🌀", "label": "Turn the fans up to dry the air", "text": "Mould loves damp air. The fans run on the Greenhouse's lamp power." },
			{ "id": "wait", "icon": "👀", "label": "Leave it and keep an eye on it", "text": "Maybe it will go away on its own." }
		] },
	"cold": { "icon": "🥶", "title": "Battery fault! A freezing night is coming", "alarm": "POWER FAULT", "at": [0.66, 0.76],
		"options": [
			{ "id": "air", "icon": "💨", "label": "Keep the Air Maker warm", "text": "Its valves and water pipes stay above freezing." },
			{ "id": "food", "icon": "🥬", "label": "Keep the Greenhouse warm", "text": "The plants and their water tank stay above freezing." },
			{ "id": "lab", "icon": "🔬", "label": "Keep the Science Lab warm", "text": "The rock cores and the Lab's delicate parts stay above freezing." }
		] },
	"fuse": { "icon": "⚡", "title": "Power surge! Two machines down, one spare fuse", "alarm": "POWER SURGE", "src": "apollo",
		"science": "When Apollo 13 lost most of its power, the crew switched off almost everything and kept only the systems they needed to stay alive. Deciding what matters most is a real astronaut skill. And a fuse is a safety part: it is built to melt before the wires do.",
		"options": [
			{ "id": "radio", "icon": "📡", "label": "Put the fuse in the Radio Dish", "text": "Earth can reach you again. The Greenhouse pump stays off." },
			{ "id": "pump", "icon": "💧", "label": "Put the fuse in the Greenhouse pump", "text": "The plants keep drinking. The Radio Dish stays off." },
			{ "id": "foil", "icon": "🧻", "label": "Make a second fuse out of kitchen foil", "text": "Wrap foil where the missing fuse should go. Then both machines can run." }
		] },
	"stuck": { "icon": "🚙", "title": "The rover is sinking in soft sand!", "alarm": "ROVER STUCK", "src": "mer", "patience": 0.3,
		"science": "In 2009 NASA's Spirit rover broke through a crust into soft soil on Mars. Engineers on Earth built a sandbox and tested careful moves for months to try to free it. Spinning the wheels hard only dug them in deeper.",
		"options": [
			{ "id": "gun", "icon": "🔥", "label": "Full power! Blast out of it", "text": "Push the throttle all the way and hope the wheels grab." },
			{ "id": "rock", "icon": "↔️", "label": "Rock gently back and forth", "text": "Tiny moves, forward and back, to pack the sand down under the wheels." },
			{ "id": "dig", "icon": "⛏️", "label": "Climb out and dig the wheels free", "text": "Scoop the sand away by hand and wedge flat rocks under the wheels." }
		] }
}
const ORDER := ["leak", "co2", "mold", "cold", "fuse", "stuck"]


# ---------- helpers ----------
func later(s: Dictionary, d: Dictionary, sol: int, t: float, fn: String) -> void:
	s.after.append({ "sol": sol, "t": t, "fn": fn, "d": d, "done": false })


## later today: never past the end of the shift, or it would only show up the next morning
func in_secs(s: Dictionary, d: Dictionary, secs: float, fn: String) -> void:
	later(s, d, s.sol, minf(s.t + secs, s.dayLength - 0.5), fn)


## first thing next morning
func tomorrow(s: Dictionary, d: Dictionary, fn: String) -> void:
	if s.sol < s.totalSols:
		later(s, d, s.sol + 1, 5, fn)


func extra(s: Dictionary, res: String, text: String, v: float) -> void:
	s.today.extra.append({ "res": res, "text": text, "v": v })


static func live(b: Dictionary) -> bool:
	return b.state == "growing" or b.state == "ripe"


## The blown pump fuse and a Greenhouse breakdown are two separate faults. Either one stops the plants, so mending one
## must not quietly mend the other.
func glitch_on(s: Dictionary, id: String) -> bool:
	var g = s.glitch
	return g != null and g.machine == id and (g.state == "broken" or g.state == "asked" or g.state == "advised")


func pump_fuse(s: Dictionary, blown: bool) -> void:
	s.flags.pumpFuse = s.sol if blown else 0
	s.m.food.broken = blown or glitch_on(s, "food")


func text_for(id: String, s: Dictionary) -> String:
	var moon: bool = s.site.id == "moon"
	match id:
		"leak":
			return ("A speck of space rock, smaller than a grain of sand, has just punched a tiny hole in the habitat wall." if moon \
				else "The bitter cold has cracked a seal in the habitat wall.") + " You can hear air hissing out, and the air meter is falling."
		"co2":
			return "The filter that cleans your breath out of the air has clogged. Carbon dioxide is building up inside, so the tanks must pump out twice as much fresh air to keep everyone safe."
		"mold":
			return "The Greenhouse air is too damp, and a fuzzy white mould is growing on one bed of plants. Mould spreads from leaf to leaf."
		"cold":
			return "A battery pack has just failed. Tonight there is only enough stored power to keep ONE machine warm. " + \
				("In the dark, the Moon's surface drops to about −133°C." if moon else "Nights on Mars fall far below −70°C.") + " Anything left unheated will freeze."
		"fuse":
			return "A power surge has blown the fuses in the Radio Dish AND the Greenhouse water pump. The toolbox holds exactly one spare fuse."
		"stuck":
			return "The ground looked solid, but the wheels have broken through a thin crust into soft, powdery soil. They are spinning, and the rover is sinking."
	return ""


func science_for(id: String, s: Dictionary) -> String:
	if id == "cold":
		return "Away from sunlight the Moon's surface falls to about −133°C. Landers and rovers on the Moon carry heaters, and mission teams must decide which parts to keep warm when power runs low." if s.site.id == "moon" \
			else "In 2010 the Spirit rover could not tilt its solar panels toward the low winter Sun on Mars. Without enough power for its heaters it grew too cold, and it never called home again."
	return C[id].science


func src_for(id: String, s: Dictionary) -> String:
	if id == "cold":
		return "moon" if s.site.id == "moon" else "mer"
	return C[id].src


func ok_for(id: String, s: Dictionary, ctx: Dictionary) -> bool:
	match id:
		"mold":
			return s.m.food.beds.filter(func(b): return live(b)).size() >= 2
		"cold":
			return s.sol < s.totalSols
		"stuck":
			return Js.truthy(ctx.get("driving"))
	return true


func start_for(id: String, s: Dictionary) -> void:
	match id:
		"leak":
			s.leak = 28.0
		"co2":
			var lost: float = s.filter - minf(s.filter, 5)
			s.stale = 2.0
			s.filter -= lost
			if lost >= 0.5:
				extra(s, "filter", "The filter clogged", -Js.mround(lost))
		"mold":
			var beds: Array = s.m.food.beds
			for i in beds.size():
				if live(beds[i]):
					s.flags.moldBed = i
					break
		"fuse":
			var m: Dictionary = s.m
			s.flags.dishWasOn = m.comms.on
			m.comms.broken = true
			m.comms.on = false
			pump_fuse(s, true)


func mold_spread(s: Dictionary) -> void:
	var beds: Array = s.m.food.beds
	var mb = s.flags.get("moldBed")
	if mb != null and int(mb) < beds.size():
		var sick: Dictionary = beds[int(mb)]
		sick.state = "empty"
		sick.g = 0.0
	for b in beds:
		if live(b):
			b.state = "growing"
			b.g *= 0.45


## Carry out one option. Returns { now, skip?, home?, sync? }.
func run_option(id: String, opt: String, s: Dictionary, d: Dictionary) -> Dictionary:
	var m: Dictionary = s.m
	match id + "." + opt:
		"leak.patch":
			s.leak = 0.0
			tomorrow(s, d, "leak.patch")
			return { "skip": 0.1, "home": true, "now": "It took a long time to find the hole. It was thinner than a pencil lead! The patch is on and the hissing has stopped." }
		"leak.seal":
			s.leak = 0.0
			s.flags.pantryShut = s.sol
			in_secs(s, d, 22, "leak.seal.soon")
			tomorrow(s, d, "leak.seal")
			return { "now": "The hatch is shut and the air meter is steady again. One room of your home is now as empty as space." }
		"leak.later":
			s.flags.leakLate = s.sol
			in_secs(s, d, s.dayLength * 0.22, "leak.later.soon")
			tomorrow(s, d, "leak.later")
			return { "now": "You turn back to your work. Behind the wall, the faint hiss goes on." }
		"co2.build":
			var made: float = maxf(s.filter, 60) - s.filter
			s.stale = 1.0
			s.filter += made
			if made >= 0.5:
				extra(s, "filter", "Home-made filter fitted", Js.mround(made))
			tomorrow(s, d, "co2.build")
			return { "skip": 0.08, "home": true, "now": "It looks ridiculous. But the carbon dioxide reading is dropping back to normal." }
		"co2.cell":
			var cleaned: float = 100 - s.filter
			s.stale = 1.0
			s.filter = 100.0
			if cleaned >= 0.5:
				extra(s, "filter", "Backup scrubber cleaned the air", Js.mround(cleaned))
			if s.rack.cells > 0:
				s.rack.cells -= 1
			else:
				s.rack.charge = maxf(0, s.rack.charge - 1)
			in_secs(s, d, 25, "co2.cell.soon")
			return { "sync": true, "now": "The backup scrubber whirrs and the air clears. The Solar Rack is one power cell poorer." }
		"co2.flush":
			s.stale = 1.0
			s.air = maxf(0, s.air - 12)
			extra(s, "air", "Oxygen used to flush the cabin", -12)
			tomorrow(s, d, "co2.flush")
			return { "now": "Whoosh! Everyone can breathe easily again. The air meter took a hit, and the clogged filter is still clogged." }
		"mold.cut":
			var mb = s.flags.get("moldBed")
			if mb != null and int(mb) < m.food.beds.size():
				var b: Dictionary = m.food.beds[int(mb)]
				b.state = "empty"
				b.g = 0.0
			tomorrow(s, d, "mold.cut")
			return { "now": "The sick bed is bare soil again. The rest of the garden looks clean." }
		"mold.fans":
			var f: Dictionary = m.food
			if f.lamp > 0.25 and not f.broken:
				f.lamp = maxf(0.02, f.lamp - 0.35)
				tomorrow(s, d, "mold.fans")
				return { "now": "The fans roar. The leaves tremble in the dry breeze, and the grow lamps dim a little." }
			tomorrow(s, d, "mold.fans.dark")
			return { "now": "You flip the switch. Nothing happens. The Greenhouse has no power, so the fans cannot spin!" }
		"mold.wait":
			tomorrow(s, d, "mold.wait")
			return { "now": "You leave the plants alone. The fuzzy patch looks a tiny bit bigger than before." }
		"cold.air", "cold.food", "cold.lab":
			tomorrow(s, d, "cold." + opt)
			if opt != "air":
				s.flags.freezeAir = s.sol + 1
			return { "now": "The " + WARM[opt] + " heater glows orange. One by one, the lights on the other machines go dark." }
		"fuse.radio":
			m.comms.broken = false
			m.comms.on = Js.truthy(s.flags.get("dishWasOn"))
			in_secs(s, d, 35, "fuse.radio.soon")
			return { "now": "The Radio Dish hums back to life" + ("." if s.flags.get("dishWasOn") else ", ready for a power cell.") + " The Greenhouse pump stays dead." }
		"fuse.pump":
			pump_fuse(s, false)
			in_secs(s, d, 35, "fuse.pump.soon")
			return { "now": "Water gurgles through the Greenhouse pipes again. The Radio Dish stays dead." }
		"fuse.foil":
			m.comms.broken = false
			m.comms.on = Js.truthy(s.flags.get("dishWasOn"))
			pump_fuse(s, false)
			in_secs(s, d, 45, "fuse.foil.soon")
			return { "now": "Both machines hum back to life. The foil is getting warm…" }
		"stuck.gun":
			m.rover.charge = 0.0
			m.rover.stuck = true
			in_secs(s, d, 12, "stuck.gun.soon")
			tomorrow(s, d, "stuck.gun")
			return { "now": "The wheels spin faster and dig deeper. The rover is buried up to its axles and the battery is flat." }
		"stuck.rock":
			m.rover.charge = maxf(0, m.rover.charge - 40)
			in_secs(s, d, 12, "stuck.rock.soon")
			return { "now": "Forward a little. Back a little. Again. Slowly the wheels climb onto firmer ground." }
		"stuck.dig":
			s.air = maxf(0, s.air - 6)
			extra(s, "air", "Hard digging in the spacesuit", -6)
			in_secs(s, d, 12, "stuck.dig.soon")
			return { "now": "Digging in a spacesuit is exhausting. You are puffing hard, but the wheels have grip again." }
	return {}


## A consequence comes due. Returns { tone, text, spark? } or null.
func _consequence(fn: String, s2: Dictionary):
	var m2: Dictionary = s2.m
	match fn:
		"leak.patch":
			return { "tone": "good", "text": "Your patch held all night. Not one puff of air was lost while the crew slept." }
		"leak.seal.soon":
			return { "tone": "mixed", "text": "The room you sealed was the food store. It is airless now, so no veggie crates can go in until the crew patches the hole tonight." }
		"leak.seal":
			return { "tone": "bad", "text": "With no air in the food store, a shelf of food packets swelled up and burst overnight. 9 food was ruined before the crew could patch the wall." }
		"leak.later.soon":
			return { "tone": "bad", "text": "The hole is still hissing. About " + str(maxi(1, Js.mround(s2.today.leaked))) + " air has escaped through it so far today." }
		"leak.later":
			return { "tone": "bad", "text": "The crew found and patched the hole in the night. In all, the leak cost about " + Js.num(s2.flags.get("leakTotal", 0)) + " air. For a small habitat, that is a big bite out of a day of breathing." }
		"co2.build":
			return { "tone": "good", "text": "Your home-made filter is still cleaning the air this morning. It is ugly, but it works!" }
		"co2.cell.soon":
			return { "tone": "mixed", "text": "The backup scrubber used up a whole power cell. That is one machine that will stay dark today." }
		"co2.flush":
			# a player who baked the filter clean after the flush has really solved it
			if s2.filter >= R.filterWarn:
				return { "tone": "good", "text": "You baked the filter clean after the flush, so the stale air never came back." }
			var fitted: float = maxf(s2.filter, 60) - s2.filter
			s2.air = maxf(0, s2.air - 8)
			extra(s2, "air", "Second flush: the filter was still clogged", -8)
			s2.filter += fitted
			if fitted >= 0.5:
				extra(s2, "filter", "The crew fitted a new filter", Js.mround(fitted))
			return { "tone": "bad", "text": "The filter was still clogged, so the stale air came back overnight. The cabin had to be flushed again: 8 more air gone before the crew could mend it." }
		"mold.cut":
			return { "tone": "good", "text": "No more mould. The other beds are green and healthy. One bed had to start again from seeds." }
		"mold.fans":
			return { "tone": "good", "text": "The air dried out and the mould stopped growing. Every bed survived. The fans used up about a third of a power cell of lamp light." }
		"mold.fans.dark":
			mold_spread(s2)
			return { "tone": "bad", "text": "With no power the fans never turned, and the mould spread to every bed overnight. One bed is dead and the others lost more than half their growth." }
		"mold.wait":
			mold_spread(s2)
			return { "tone": "bad", "text": "The mould spread to every bed overnight. One bed is dead and the others lost more than half their growth." }
		"cold.air", "cold.food", "cold.lab":
			var id := fn.substr(5)
			var out := ["The " + WARM[id] + " stayed warm and came through the night perfectly."]
			if id != "air":
				out.append("The Air Maker froze solid: a valve has jammed and must be repaired before it can make any air.")
			if id != "food":
				for b in m2.food.beds:
					if live(b):
						b.state = "growing"
						b.g *= 0.5
				var froze: float = s2.water - minf(s2.water, 8)
				s2.water -= froze
				if froze >= 0.5:
					extra(s2, "water", "Froze solid in the night", -Js.mround(froze))
				out.append("Frost got into the Greenhouse: the plants lost half their growth and most of the water tank froze solid.")
			if id != "lab":
				var n: int = m2.lab.queue.size()
				m2.lab.power = 0.0
				for c in m2.lab.queue:
					c.quality = 0
				out.append("The Science Lab froze: its battery is flat" + (" and the " + str(n) + " waiting rock core" + ("s" if n > 1 else "") + " cracked, so they will only make rough samples." if n else "."))
			return { "tone": "mixed", "text": " ".join(PackedStringArray(out)) }
		"fuse.radio.soon":
			return { "tone": "mixed", "text": "The Greenhouse pump is silent. Until the crew makes a new fuse tonight, the plants cannot drink, so they have stopped growing." }
		"fuse.pump.soon":
			return { "tone": "mixed", "text": "The Radio Dish is dark. There will be no forecast tonight, only a few seconds of warning if a solar storm comes, and Earth cannot help with repairs today." }
		"fuse.foil.soon":
			m2.comms.broken = true
			m2.comms.on = false
			pump_fuse(s2, true)
			s2.rack.charge = maxf(0, s2.rack.charge - 1)
			return { "tone": "bad", "spark": true, "text": "A real fuse melts to protect the wires. The foil did not, so the wires overheated instead. Both machines are dead until tonight, and the Solar Rack lost a whole cell of charge." }
		"stuck.gun.soon":
			return { "tone": "bad", "text": "The rover will not move again today. Everything you need now, you carry on foot." }
		"stuck.gun":
			return { "tone": "mixed", "text": "The crew spent the whole evening digging the rover out. It is free again, with a flat battery." }
		"stuck.rock.soon":
			return { "tone": "good", "text": "The rover is free. All that careful rocking used about 40 seconds of battery." }
		"stuck.dig.soon":
			return { "tone": "good", "text": "The rover is free and its battery is untouched. All that digging in a stiff spacesuit made you breathe 6 extra air." }
	return null


# =====================================================================
#  scheduling and bookkeeping (called from sim.gd)
# =====================================================================
func plan(s: Dictionary) -> void:
	s.crisisPool = ORDER.duplicate()
	for sol in s.level.crisisSols:
		var id: String = s.crisisPool.pop_at(int(floor(s.rng.next() * s.crisisPool.size())))
		s.crisisPlan[int(sol)] = { "id": id, "at": 0.24 + s.rng.next() * 0.3 }


func start_sol(s: Dictionary) -> void:
	var prev = s.crisis
	var D: float = s.dayLength
	# a crisis that never opened (the crew went to bed first, or a storm was in the way) waits for the next free day
	if prev and prev.state == "pending":
		for d in range(s.sol, s.totalSols + 1):
			if not s.crisisPlan.has(d):
				s.crisisPlan[d] = { "id": prev.id, "at": 0.24 + s.rng.next() * 0.3 }
				break
	var p = s.crisisPlan.get(s.sol)
	s.crisis = null
	if p:
		var def: Dictionary = C[p.id]
		var at: float = (def.at[0] + s.rng.next() * (def.at[1] - def.at[0]) if def.has("at") else p.at) * D
		s.crisis = { "id": p.id, "at": at, "until": at + float(def.get("patience", 0.1)) * D, "state": "pending" }
	# the Air Maker froze last night: it starts the day broken
	if s.flags.get("freezeAir") == s.sol:
		s.glitch = { "machine": "air", "at": 0.0, "state": "pending", "replyAt": 0.0, "misses": 0, "asked": false }


func _open(s: Dictionary, c: Dictionary, ev: Array) -> void:
	c.state = "open"
	start_for(c.id, s)
	ev.append({ "type": "crisis", "id": c.id })


func tick(s: Dictionary, ctx: Dictionary, ev: Array) -> void:
	var c = s.crisis
	if c and c.state == "pending" and s.t >= c.at and not s.get("sleeping"):
		var ph: String = Sim.storm_phase(s)
		if ph != "warning" and ph != "active":
			if ok_for(c.id, s, ctx):
				_open(s, c, ev)
			elif s.t >= c.until:
				var alt = null
				for id in s.crisisPool:
					if not C[id].has("at") and ok_for(id, s, ctx):
						alt = id
						break
				if alt:
					s.crisisPool.erase(alt)
					c.id = alt
					_open(s, c, ev)
				else:
					c.state = "skipped"
	for a in s.after:
		if a.done or a.sol > s.sol or (a.sol == s.sol and s.t < a.t):
			continue
		a.done = true
		var r = _consequence(a.fn, s)
		if r:
			r.sol = s.sol
			a.d.later.append(r)
			ev.append({ "type": "consequence", "res": r, "d": a.d })


func view(s: Dictionary):
	var c = s.crisis
	if not c or c.state != "open":
		return null
	var def: Dictionary = C[c.id]
	var opts := []
	for o in def.options:
		opts.append({ "id": o.id, "icon": o.icon, "label": o.label, "text": o.text })
	return { "id": c.id, "icon": def.icon, "title": def.title, "alarm": def.alarm, "text": text_for(c.id, s), "options": opts }


func choose(s: Dictionary, opt_id: String):
	var c = s.crisis
	if not c or c.state != "open":
		return null
	var def: Dictionary = C[c.id]
	var opt = null
	for o in def.options:
		if o.id == opt_id:
			opt = o
			break
	if opt == null:
		return null
	var d := { "sol": s.sol, "id": c.id, "icon": def.icon, "title": def.title, "opt": opt.id, "optIcon": opt.icon, "label": opt.label, "now": "", "later": [],
		"science": science_for(c.id, s), "src": src_for(c.id, s) }
	var r := run_option(c.id, opt_id, s, d)
	d.now = r.get("now", "")
	c.state = "done"
	s.decisions.append(d)
	return { "d": d, "skip": float(r.get("skip", 0)), "home": Js.truthy(r.get("home")), "sync": Js.truthy(r.get("sync")) }


## things that happen while the crew sleeps
func night(s: Dictionary) -> void:
	var f: Dictionary = s.flags
	if f.get("pantryShut") == s.sol:
		s.food -= 9
		extra(s, "food", "Food ruined in the airless room", -9)
	if f.get("leakLate") == s.sol:
		s.air = maxf(0, s.air - 5)
		extra(s, "air", "Lost while the crew hunted for the hole", -5)
		f.leakTotal = Js.mround(s.today.leaked + 5)
