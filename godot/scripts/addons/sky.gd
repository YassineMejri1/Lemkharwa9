extends Node
## Rocks from the sky. Now and then a meteorite hits the ground near the outpost. Find the fresh crater and you can
## pick up a real rock from space. A seismometer (the quake sensor) pinpoints the crater for you.
## Real science: Mars has thin air, so a meteor glows on the way down and you hear the boom late (sound travels at
## only about 240 m/s there); NASA's InSight lander felt and heard real strikes. The Moon has no air: no fireball and
## no sound, only a flash and a shake of the ground. The strikes are invented for the game; the facts on the cards are
## real. A port of js/skyfall.js.

## on which days a rock falls, for 5, 8 and 10 day missions (never on launch day)
const DAYS := { 5: [1, 3], 8: [1, 4, 6], 10: [1, 4, 6, 8] }
const DIRS := ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
const FINDS := {
	"mars": [
		{ "title": "A rock that fell from space", "src": "insight",
			"text": "On 24 December 2021, NASA's InSight lander felt the ground shake on Mars. A meteorite had hit! An orbiter then photographed the new crater: about 150 metres wide, with chunks of buried ice thrown out around it." },
		{ "title": "An iron meteorite", "src": "mer",
			"text": "In 2005 the Opportunity rover found the first meteorite ever spotted on another planet: a lump of iron and nickel the size of a basketball. The team named it Heat Shield Rock." },
		{ "title": "A chip off an asteroid", "src": "msl",
			"text": "The Curiosity rover has found iron meteorites on Mars too. One, nicknamed Cacao, is about 30 centimetres wide. Most meteorites are chips knocked off asteroids long ago." },
	],
	"moon": [
		{ "title": "A brand-new crater", "src": "lro",
			"text": "The Moon has no air to burn up space rocks, so even small ones hit the ground at full speed. NASA's Lunar Reconnaissance Orbiter has found more than 200 new craters by comparing before-and-after photos." },
		{ "title": "Feeling a space rock land", "src": "apollo",
			"text": "Apollo astronauts left moonquake sensors on the Moon. For years those sensors felt space rocks hitting the ground, which helped scientists work out what the inside of the Moon is like." },
		{ "title": "Crumbs older than the Moon", "src": "moon",
			"text": "Most meteorites are crumbs left over from when the planets formed, about 4.6 billion years ago. Tiny ones hit the Moon all the time and slowly grind its rocks into the grey dust under your boots." },
	],
}
var mesh = null             # { group, rock, ring, rock_mat, ring_mat, smoke }


func _plan(s: Dictionary) -> void:
	var days: Array = DAYS.get(int(s.totalSols), [1])
	var out := {}
	for d in days:
		if d < s.totalSols:
			out[str(d)] = 0.5 + randf() * 0.16
	s.sky = { "days": out, "done": {}, "fall": null, "site": null, "found": 0, "boom": 0.0 }


## A flat, empty patch of ground, away from the buildings and from everything else on the map.
func _pick_spot(from) -> Dictionary:
	var L: Dictionary = Terrain.L
	var keep: Array = [L.hab, L.ice, L.rocket, L.pallet, L.seat, L.hill, L.mesa, L.inst.seismo, L.inst.beam, L.inst.rad]
	keep.append_array(L.geo)
	keep.append_array(L.photo)
	var best = null
	var best_slope := 1e9
	for _i in 60:
		var a := randf() * TAU
		var r := 60 + randf() * 72
		var x := cos(a) * r
		var z := sin(a) * r
		if Vector2(x, z).length() > Terrain.PLAY_R - 24:
			continue
		if from is Vector3 and Vector2(x - from.x, z - from.z).length() < 42:
			continue                                   # never on top of the player
		if Vector2(x - L.colony.x, z - L.colony.y).length() < 44:
			continue                                   # nor on the colony site
		var ok := true
		for k in keep:
			if Vector2(x - k.x, z - k.y).length() < 24:
				ok = false
				break
		if ok:
			for c in Base.colliders:
				if Vector2(x - c.x, z - c.z).length() < c.r + 7:
					ok = false
					break
		if not ok:
			continue
		var slope := absf(Terrain.height(x + 3, z) - Terrain.height(x - 3, z)) + absf(Terrain.height(x, z + 3) - Terrain.height(x, z - 3))
		if slope < best_slope:
			best_slope = slope
			best = { "x": x, "z": z, "y": Terrain.height(x, z) }
		if slope < 0.3:
			break
	return best if best else { "x": 70.0, "z": -30.0, "y": Terrain.height(70, -30) }


static func _dir_word(from: Vector3, to: Dictionary) -> String:
	var deg := fposmod(rad_to_deg(atan2(to.x - from.x, -(to.z - from.z))), 360.0)       # north is -z
	return DIRS[roundi(deg / 45.0) % 8]


static func _sensor_name(s: Dictionary) -> String:
	for x in Data.INSTRUMENTS.get(s.site.id, []):
		if x.id == "seismo":
			return x.name
	return "quake sensor"


# ---------- the crater ----------
func _build_mesh(s: Dictionary) -> void:
	var st: Dictionary = s.sky.site
	var mars: bool = s.site.id == "mars"
	var g := Node3D.new()
	g.position = Vector3(st.x, st.y, st.z)
	# a scorch mark that follows the shape of the ground and fades out at its edge
	var rings := 5
	var segs := 28
	var R := 4.6
	var st_mesh := SurfaceTool.new()
	st_mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	var verts: Array = []
	for i in rings + 1:
		for k in segs:
			var rr := R * i / rings
			var a := float(k) / segs * TAU
			var x := cos(a) * rr
			var z := sin(a) * rr
			verts.append([Vector3(x, Terrain.height(st.x + x, st.z + z) - st.y + 0.2, z), Color(0.05, 0.04, 0.04, 0.0 if i == rings else 0.8 * (1 - float(i) / rings * 0.6))])
	for i in rings:
		for k in segs:
			var a0 := i * segs + k
			var a1 := i * segs + (k + 1) % segs
			for idx in [a0, a1, a0 + segs, a1, a1 + segs, a0 + segs]:
				st_mesh.set_color(verts[idx][1])
				st_mesh.add_vertex(verts[idx][0])
	var scorch_mat := StandardMaterial3D.new()
	scorch_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	scorch_mat.vertex_color_use_as_albedo = true
	scorch_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	scorch_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	scorch_mat.render_priority = 1
	Mats.add(g, st_mesh.commit(), scorch_mat, 0, 0, 0, false)
	# the raised rim
	var rim_mat := Mats.mat(0x6a3420 if mars else 0x4a4b56)
	var rim := Mats.add(g, Mats.torus(2.25, 0.6, 15, 5), rim_mat, 0, 0.05, 0)
	rim.scale = Vector3(1, 0.42, 1)
	# the dark bowl inside it
	Mats.add(g, Mats.cyl(2.05, 2.05, 0.02, 15), Mats.mat(0x24120c if mars else 0x15161b), 0, 0.14, 0)
	# chunks thrown out by the blast
	for i in 9:
		var ca := i * 0.7 + randf() * 0.5
		var cr := 3.2 + randf() * 2.6
		var cs := 0.16 + randf() * 0.26
		var chunk := Mats.add(g, Mats.ball(cs, 5, 3), rim_mat, cos(ca) * cr, Terrain.height(st.x + cos(ca) * cr, st.z + sin(ca) * cr) - st.y + cs * 0.5, sin(ca) * cr)
		chunk.rotation = Vector3(randf() * 3, randf() * 3, 0)
	# the meteorite itself: dark, and still glowing hot
	var rock_mat := StandardMaterial3D.new()
	rock_mat.albedo_color = Mats.lin(0x2a2320)
	rock_mat.roughness = 0.55
	rock_mat.metallic = 0.55
	rock_mat.emission_enabled = true
	rock_mat.emission = Mats.lin(0xff4a10)
	rock_mat.emission_energy_multiplier = 1.1
	var rock := Mats.add(g, Mats.ball(0.4, 6, 4), rock_mat, 0, 0.48, 0)
	rock.rotation = Vector3(0.5, 0.3, 0.2)
	# a slow beacon ring, so the crater can be spotted from far away
	var ring_mat := Mats.unlit(0xffb347, 0.9)
	ring_mat.disable_fog = true
	var ring := Mats.add(g, Mats.torus(1.25, 0.07, 30, 6), ring_mat, 0, 0.62, 0, false)
	World.root.add_child(g)
	mesh = { "group": g, "rock": rock, "ring": ring, "rock_mat": rock_mat, "ring_mat": ring_mat, "smoke": 0.0 }


# ---------- the fall ----------
func _start_fall(s: Dictionary, ctx: Dictionary) -> void:
	var k: Dictionary = s.sky
	var spot := _pick_spot(ctx.pos)
	var a := randf() * TAU
	var mars: bool = s.site.id == "mars"
	k.done[str(s.sol)] = true
	k.fall = { "t": 0.0, "dur": 1.6 if mars and ctx.outside else 0.05, "spot": spot,
		"sx": spot.x + cos(a) * 210, "sy": spot.y + 190, "sz": spot.z + sin(a) * 210, "streak": mars and ctx.outside }


func _step_fall(dt: float, s: Dictionary, ctx: Dictionary) -> void:
	var f: Dictionary = s.sky.fall
	f.t += dt
	var u := clampf(f.t / f.dur, 0, 1)
	var e := u * u                                  # it speeds up as it comes down
	if f.streak and u < 1:
		var x: float = lerpf(f.sx, f.spot.x, e)
		var y: float = lerpf(f.sy, f.spot.y, e)
		var z: float = lerpf(f.sz, f.spot.z, e)
		World.emit(x, y, z, { "life": 0.22, "size": 7, "grow": 0.5, "color": 0xfff6d8, "alpha": 1, "grav": 0 })
		for _i in World.rate(7, dt):
			World.emit(x + randf() - 0.5, y + randf() - 0.5, z + randf() - 0.5,
				{ "vx": (randf() - 0.5) * 3, "vy": (randf() - 0.5) * 3, "vz": (randf() - 0.5) * 3, "life": 0.9 + randf() * 0.6, "size": 3.4, "grow": 0.3,
					"color": 0xffc27a if randf() < 0.5 else 0xff7a3a, "alpha": 0.85, "grav": 0 })
	if u >= 1:
		_impact(s, ctx)


func _impact(s: Dictionary, ctx: Dictionary) -> void:
	var k: Dictionary = s.sky
	var sp: Dictionary = k.fall.spot
	var mars: bool = s.site.id == "mars"
	var me: Vector3 = ctx.pos
	var dist := Vector2(sp.x - me.x, sp.z - me.z).length()
	k.fall = null
	k.site = { "x": sp.x, "y": sp.y, "z": sp.z, "sol": s.sol, "exact": bool(s.inst.get("seismo", false)), "age": 0.0 }
	_build_mesh(s)
	# flash, then a fountain of dust
	World.burst(sp.x, sp.y + 0.8, sp.z, 46, 18, 0xfff3c4, { "life": 0.55, "size": 3, "grow": 2.2, "alpha": 0.95, "grav": 0, "up": 0.9 })
	World.burst(sp.x, sp.y + 0.4, sp.z, 80, 12, 0xd9a070 if mars else 0xb8b9c4, { "life": 3.4, "size": 1.7, "grow": 3, "alpha": 0.5, "up": 1, "lift": 5, "grav": World.gravity * 0.4 })
	World.cam.shake = maxf(World.cam.shake, clampf(1.1 - dist / 170, 0.18, 0.85))
	if ctx.outside:
		Game.fx_pulse("flash", clampf(0.9 - dist / 260, 0.15, 0.7))
		Game.fx_pulse("shock", clampf(1.1 - dist / 200, 0.2, 0.9))
	if mars:
		k.boom = maxf(0.05, dist / 240)              # the boom arrives late: sound is slow in thin air
	var rough := maxi(10, roundi(dist / 10) * 10)
	var dir := _dir_word(me, sp)
	var sensor := _sensor_name(s)
	var line := ""
	if not ctx.outside:
		line = "Thump! The floor just shook. A meteorite has hit the ground outside, about " + str(rough) + " metres to the " + dir + "!"
	elif mars:
		line = "Whoa, a fireball! A meteorite just hit Mars, about " + str(rough) + " metres to the " + dir + "!"
	else:
		line = "Did you see that flash? A space rock just hit the Moon, about " + str(rough) + " metres to the " + dir + ". No air here, so no fireball and no sound!"
	line += (" Your " + sensor + " felt it and pinpointed the crater. Follow the ☄️ marker!") if k.site.exact else (" Look for the glowing crater. A " + sensor + " would have pinpointed it for you.")
	Au.play("page")
	ctx.say.call(line)


# ---------- called by the game ----------
## ctx: { outside, pos, say(text), tip(id, text) }
func update(dt: float, s: Dictionary, ctx: Dictionary) -> void:
	if World.root == null:
		return
	if not s.get("sky"):
		_plan(s)
	var k: Dictionary = s.sky
	var frac = k.days.get(str(s.sol))
	if frac != null and not k.done.get(str(s.sol)) and k.fall == null and k.site == null and s.t >= frac * s.dayLength and s.t < s.dayLength * 0.92:
		var ph := Sim.storm_phase(s)
		if ph != "warning" and ph != "active":
			_start_fall(s, ctx)
	if k.fall != null:
		_step_fall(dt, s, ctx)
	if k.boom > 0:
		k.boom -= dt
		if k.boom <= 0:
			k.boom = 0.0
			Au.play("touchdown")
			ctx.tip.call("skyboom", "Hear that? The boom arrived late. Sound travels slowly in the thin air of Mars: only about 240 metres every second.")
	var st = k.site
	if st == null:
		if mesh and not is_instance_valid(mesh.group):
			mesh = null
		return
	if mesh == null or not is_instance_valid(mesh.group) or not mesh.group.is_inside_tree():
		_build_mesh(s)                               # a crater from an earlier day, in a world that was rebuilt
	st.age += dt
	var pulse := fmod(st.age * 0.55, 1.0)
	mesh.ring.scale = Vector3.ONE * (1 + pulse * 1.6)
	mesh.ring_mat.albedo_color.a = 0.9 * (1 - pulse)
	mesh.rock_mat.emission_energy_multiplier = 0.3 + 0.8 * exp(-st.age / 70) + sin(st.age * 3) * 0.08     # it slowly cools
	if s.site.id == "mars" and st.age < 60:          # smoke hangs in the air on Mars; on the Moon there is no air to hold it
		mesh.smoke -= dt
		if mesh.smoke <= 0:
			mesh.smoke = 0.16
			World.emit(st.x + randf() - 0.5, st.y + 0.8, st.z + randf() - 0.5, { "vx": 0.6 + randf() * 0.8, "vy": 2.4 + randf() * 1.4, "vz": (randf() - 0.5) * 0.6, "life": 5, "size": 1.1, "grow": 3.4, "color": 0x8a6a58, "alpha": 0.3, "grav": 0 })
	if not st.exact and s.inst.get("seismo"):
		st.exact = true
		ctx.say.call("Your " + _sensor_name(s) + " is working! It has pinpointed the fresh crater. Follow the ☄️ marker.")


## The game asks: is there something to pick up near p? offer(distance, reach, action) is the game's own helper.
func offer(s, p: Vector3, offer_fn: Callable, run: Callable) -> void:
	var st = s.get("sky", {}).get("site") if s else null
	if st == null:
		return
	offer_fn.call(Vector2(p.x - st.x, p.z - st.z).length() - 1.2, 2.6, { "label": "Pick up the space rock", "run": run })


## Where the crater is, for the waypoint marker. Known exactly with a seismometer, otherwise only when you are close.
func marker(s, p: Vector3):
	var st = s.get("sky", {}).get("site") if s else null
	if st == null:
		return null
	var d := Vector2(p.x - st.x, p.z - st.z).length()
	if (not st.exact and d > 75) or d < 5:
		return null
	return Vector3(st.x, st.y + 3.2, st.z)


func goal(s):
	var st = s.get("sky", {}).get("site") if s else null
	if st == null:
		return null
	return { "text": "Find the fresh crater and pick up the space rock", "target": Vector3(st.x, st.y, st.z) if st.exact else null }


## Pick the meteorite up. Returns the discovery (the game shows its card).
func collect(s):
	var k = s.get("sky") if s else null
	var st = k.site if k else null
	if st == null:
		return null
	var defs: Array = FINDS.get(s.site.id, FINDS.mars)
	var d: Dictionary = defs[int(k.found) % defs.size()]
	var find := { "title": d.title, "text": d.text, "src": d.src, "icon": "☄️", "sol": s.sol, "kind": "meteor", "place": "the fresh crater" }
	s.finds.append(find)
	Sim.did_science(s)
	k.found = int(k.found) + 1
	k.site = null
	if mesh and is_instance_valid(mesh.group):        # the crater stays as a landmark; the rock and the beacon go
		mesh.rock.queue_free()
		mesh.ring.queue_free()
		World.burst(st.x, st.y + 0.6, st.z, 22, 4, 0xffb347, { "life": 0.9, "size": 0.3, "grav": 0 })
	mesh = null
	return find
