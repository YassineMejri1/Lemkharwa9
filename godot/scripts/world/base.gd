extends Node
## Astro Outpost — the outpost itself: every building, machine, the rocket, the science sites. A port of js/base.js
## (autoload "Base"). spots lists the exact places the astronaut can use (sockets, hoppers, beds, drill spots...).
## update() makes each machine SHOW what the mission rules say is happening inside it.
## Godot adjustment: the Blender models are always there (the web version also drew plain shapes without them).

var colliders: Array = []
var floors: Array = []
var spots: Dictionary = {}
var pos: Dictionary = {}
var repair: Dictionary = {}
var P: Dictionary = {}
var rigs = null            # the ice drill rigs' states, set by the game
var launch = null
var root: Node3D
var site := "mars"
var L: Dictionary

var _models := {}


# ---------- models ----------
## a fresh copy of a model made in Blender (assets/models/<name>.glb)
func model(name: String) -> Node3D:
	if not _models.has(name):
		_models[name] = load("res://assets/models/" + name + ".glb")
	var n: Node3D = _models[name].instantiate()
	_shadows(n)
	return n


## glowing, see-through and label materials cast no shadow (as in the web version)
func _shadows(n: Node) -> void:
	if n is MeshInstance3D and n.mesh:
		var cast := true
		for i in n.mesh.get_surface_count():
			var m = n.mesh.surface_get_material(i)
			if m is BaseMaterial3D and (m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or (m.emission_enabled and not m.albedo_texture) or str(m.resource_name).begins_with("Glow") or m.resource_name == "Decal"):
				if n.mesh.get_surface_count() == 1:
					cast = false
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_shadows(c)


## moves a part of a model under another node (keeping its place relative to its new parent's origin)
static func move(n: Node, to: Node) -> void:
	var stack := [n]
	while stack.size():
		var x: Node = stack.pop_back()
		x.owner = null
		stack.append_array(x.get_children())
	n.get_parent().remove_child(n)
	to.add_child(n)


static func find(n: Node, name: String) -> Node3D:
	return n.find_child(name, true, false) as Node3D


## The material called `name` inside a copy of a model, made unique to that copy (on every part that uses it) so the
## game can recolour it.
static func own_mat(n: Node, name: String) -> BaseMaterial3D:
	var found: BaseMaterial3D = null
	var stack := [n]
	while stack.size():
		var x: Node = stack.pop_back()
		if x is MeshInstance3D and x.mesh:
			for i in x.mesh.get_surface_count():
				var m = x.mesh.surface_get_material(i)
				if m and m.resource_name == name:
					if found == null:
						found = m.duplicate()
					x.set_surface_override_material(i, found)
		stack.append_array(x.get_children())
	return found


## every material of a model node that glows: made unique, so its glow can change
static func own_glow(n: MeshInstance3D) -> BaseMaterial3D:
	for i in n.mesh.get_surface_count():
		var m = n.get_surface_override_material(i)
		if m == null:
			m = n.mesh.surface_get_material(i).duplicate()
			n.set_surface_override_material(i, m)
		if m is BaseMaterial3D and m.emission_enabled:
			return m
	return n.get_surface_override_material(0)


# ---------- helpers ----------
func group(p: Vector2) -> Node3D:
	var g := Node3D.new()
	g.position = Vector3(p.x, Terrain.height(p.x, p.y), p.y)
	root.add_child(g)
	return g


static func wp(g: Node3D, x: float, y: float, z: float) -> Vector3:
	return g.position + Vector3(x, y, z)


## A collider is a circle on the ground that blocks walking, driving and thrown things. h: how tall it is (3.4 m when
## left out); dome: the radius of a round roof (the habitat).
func collide(g: Node3D, x: float, z: float, r: float, h: float = 0.0) -> Dictionary:
	var c := { "x": g.position.x + x, "z": g.position.z + z, "r": r }
	if h:
		c.h = h
	colliders.append(c)
	return c


## A raised floor you can walk on. A disc: flat 'top' metres high out to r0, then a bevel down to 'edge' at r1.
## A box: half sizes hw, hd, flat top.
func floor_disc(g: Node3D, top: float, r0: float, r1: float, edge: float) -> void:
	floors.append({ "x": g.position.x, "z": g.position.z, "y": g.position.y, "top": top, "r0": r0, "r1": r1, "edge": edge })


func floor_box(g: Node3D, top: float, hw: float, hd: float) -> void:
	floors.append({ "x": g.position.x, "z": g.position.z, "y": g.position.y, "top": top, "hw": hw, "hd": hd })


func add(parent: Node3D, mesh: Mesh, m: Material, x: float = 0, y: float = 0, z: float = 0, shadow: bool = true) -> MeshInstance3D:
	return Mats.add(parent, mesh, m, x, y, z, shadow)


## an octahedron or an icosahedron-like gem (Godot has no such primitive: a low sphere is the same shape)
static func gem(r: float, sides: int = 4, rings: int = 2) -> SphereMesh:
	return Mats.ball(r, sides, rings)


# A power socket: a cup on a post. A plugged-in cell glows inside it; green pips show charge left.
func socket(g: Node3D, id: String, x: float, z: float) -> void:
	var s := Node3D.new()
	s.position = Vector3(x, 0, z)
	g.add_child(s)
	s.add_child(model("socket"))
	var ring := add(s, Mats.torus(0.62, 0.09, 24, 8), Mats.glow(0xffd23f, 1.4), 0, 1.46, 0, false)
	var cell := add(s, Mats.cyl(0.33, 0.33, 0.9, 12), Mats.glow(0xffe36a, 1.8), 0, 1.65, 0, false)
	cell.visible = false
	var pips := []
	for i in 3:
		pips.append(add(s, Mats.ball(0.1, 8, 6), Mats.glow(0x46ff8a, 0.1), -0.26 + i * 0.26, 0.85, 0.36, false))
	spots.sockets[id] = wp(g, x, 1.6, z)
	if not P.has(id):
		P[id] = {}
	P[id].sock = { "ring": ring, "cell": cell, "pips": pips }
	collide(g, x, z, 0.45)


func set_socket(id: String, level: float, on: bool) -> void:
	var k: Dictionary = P[id].sock
	k.cell.visible = on
	var rm: StandardMaterial3D = k.ring.material_override
	Mats.set_color(rm, 0x46ff8a if on else 0xffd23f)
	rm.emission_energy_multiplier = 1.6 if on else 0.8 + sin(World.time * 4) * 0.6
	for i in 3:
		(k.pips[i].material_override as StandardMaterial3D).emission_energy_multiplier = 2.2 if i < level else 0.06


# A hopper: an open funnel you drop or throw things into.
func hopper(g: Node3D, id: String, x: float, y: float, z: float, r: float, color: int) -> MeshInstance3D:
	var hm := model("hopper")
	hm.position = Vector3(x, y, z)
	hm.scale = Vector3(r, 1, r)
	g.add_child(hm)
	var rim := add(g, Mats.torus(r, 0.09, 26, 8), Mats.glow(color, 1.2), x, y + 0.5, z, false)
	spots.hoppers[id] = wp(g, x, y + 0.5, z)
	return rim


func cable(a: Vector3, b: Vector3, id: String) -> void:
	var dx := b.x - a.x
	var dz := b.z - a.z
	var len := Vector2(dx, dz).length()
	var m := Mats.soft(0x3f4458)
	m.emission_enabled = true
	m.emission = Mats.lin(0xffd23f)
	m.emission_energy_multiplier = 0
	var c := add(root, Mats.box(len, 0.1, 0.16), m, a.x + dx / 2, 0.06, a.z + dz / 2, false)
	c.rotation.y = -atan2(dz, dx)
	P.cables[id] = m


# ---------- habitat ----------
func _hab() -> void:
	var g := group(L.hab)
	var mdl := model("habitat")
	g.add_child(mdl)
	# the habitat made in Blender: dome, airlock, windows, beacon, and the pantry chute with its funnel
	var door_light: MeshInstance3D = find(mdl, "hab_doorLight")
	var beacon: MeshInstance3D = find(mdl, "hab_beacon")
	spots.hoppers.pantry = wp(g, 5.9, 2.9, 1.2)
	var windows := []
	var hull := find(mdl, "hab_main")
	if hull:
		windows.append(hull)      # the outer hull and windows: hidden while you are inside, so the room and the view show
	# flag (the cloth swings on Mars)
	var fm := model("flag")
	fm.position = Vector3(4.6, 0, 9.5)
	g.add_child(fm)
	var flag := find(fm, "flag_cloth")
	# a little telescope beside the airlock
	var scope := model("telescope")
	scope.position = Vector3(-4.8, 0, 9.2)
	scope.rotation.y = -0.6
	g.add_child(scope)
	collide(g, -4.8, 9.2, 0.6)
	# sixteen soil bags that pile up around the dome
	var bags := []
	var bm := Mats.mat(0xa9582f if site == "mars" else 0x7b7c87)
	var bm2 := Mats.mat(0x8e4524 if site == "mars" else 0x666772)
	var rows := [[0.8, 6.05, [135, 165, 195, 225, 255, 285, 315]], [1.95, 5.75, [120, 160, 200, 240, 280, 320]], [3.1, 5.2, [35, 150, 265]]]
	var bag_mesh := Mats.ball(1, 7, 5)
	for row in rows:
		for deg in row[2]:
			var a: float = deg * PI / 180.0
			var b := add(g, bag_mesh, bm if bags.size() % 2 else bm2, sin(a) * row[1], row[0], cos(a) * row[1])
			b.rotation.y = a + PI / 2 + (bags.size() % 3 - 1) * 0.12
			b.set_meta("s", 0.0)
			b.visible = false
			bags.append(b)
	P.hab = { "bags": bags, "doorLight": own_glow(door_light), "beacon": own_glow(beacon), "flag": flag, "group": g, "windows": windows }
	# the Air Scrubber on the airlock wall: three filter canisters that fill with the crew's CO2, and a socket to bake them clean
	var sg := Node3D.new()
	sg.position = Vector3(2.15, 0, 7.5)
	g.add_child(sg)
	add(sg, Mats.box(1.1, 1.9, 1.5), Mats.soft(0xc3c7d2), 0, 0.95, 0)
	add(sg, Mats.box(1.16, 0.16, 1.56), Mats.soft(0x3db8a0), 0, 1.95, 0)
	var cans := []
	for i in 3:
		var cm := Mats.soft(0x8fe8d0, { "roughness": 0.5 })
		cm.emission_enabled = true
		cm.emission = Mats.lin(0x3db8a0)
		cm.emission_energy_multiplier = 0.8
		add(sg, Mats.cyl(0.2, 0.2, 1.2, 12), cm, 0.6, 1.0, -0.48 + i * 0.48, false)
		cans.append(cm)
	var vent := add(sg, Mats.cyl(0.16, 0.16, 0.9, 10), Mats.soft(0x8a8fa0), 0.1, 2.4, -0.3)
	P.scrub = { "cans": cans, "vent": vent }
	socket(g, "scrub", 3.5, 9.0)
	pos.scrub = wp(g, 2.6, 4.2, 8.2)
	collide(g, 2.25, 7.5, 0.85)
	spots.door = wp(g, 0, 0, 10.2)
	spots.hoppers.dome = wp(g, 0, 2.4, 0)
	pos.hab = wp(g, 0, 9.8, 0)
	collide(g, 0, 0, 6.5).dome = 5.4
	collide(g, 0, 7.2, 1.9, 3.2)
	# path lights
	for p in [[-3.2, 11.5], [3.2, 11.5], [-3.2, 16], [3.2, 16], [-9, 6], [10, 5]]:
		var lt := model("path_lantern")
		lt.position = Vector3(p[0], Terrain.height(p[0], p[1]), p[1])
		root.add_child(lt)


# ---------- solar field + charging rack ----------
func _solar() -> void:
	var g := group(L.solar)
	P.solar = { "pivots": [], "mats": [] }
	for p in [[-8.0, 1.5], [0.0, -2.5], [8.0, 1.5]]:
		# Blender panel: the tilting part pivots at y = 3.8, its glass is tinted by dust
		var sp := model("solar_panel")
		sp.position = Vector3(p[0], 0, p[1])
		g.add_child(sp)
		var pv := find(sp, "solar_panel")
		P.solar.pivots.append(pv)
		P.solar.mats.append(own_mat(pv, "SolarGlass"))
		spots.panels.append(wp(g, p[0], 0, p[1] + 1.4))
		collide(g, p[0], p[1], 0.6)
	pos.solar = wp(g, 0, 6.4, 0)

	var r := group(L.rack)
	r.add_child(model("charge_rack"))      # louvred cabinet, four charging cradles, breaker box, bus bar, yellow canopy
	for i in int(Data.RULES.rackMax):
		spots.rackSlots.append(wp(r, -1.65 + i * 1.1, 1.18, 0.15))
	# a glass tube that fills as the next cell charges
	add(r, Mats.cyl(0.2, 0.2, 1.9, 10), Mats.transparent(Mats.soft(0xbfe8ff, { "roughness": 0.1 }), 0.3), 2.95, 1.45, 0.2, false)
	var level := Mats.from_bottom(r, Mats.cyl(0.15, 0.15, 1.8, 10), Mats.glow(0xffd23f, 1.6), 2.95, 0.55, 0.2, 1.8)
	P.rack = { "level": level, "lamp": add(r, Mats.box(1.2, 0.2, 0.1), Mats.glow(0x46ff8a, 1.2), 0, 2.3, -0.5, false) }
	pos.rack = wp(r, 0, 3.6, 0)
	spots.rack = wp(r, 0, 1, 1.2)
	collide(r, -1.4, -0.35, 1.45)
	collide(r, 1.4, -0.35, 1.45)
	cable(wp(g, 0, 0, 0), wp(r, 0, 0, 0), "trunk")


# ---------- air maker ----------
func _air_maker() -> void:
	var g := group(L.air)
	var mdl := model("air_maker")      # gold-foil box in a steel frame on a skid, fan grille, valve, caged tank
	g.add_child(mdl)
	var fan := find(mdl, "air_fan")
	var rim := hopper(g, "air", 0, 3.4, 0, 1.25, 0x4fd8ff)
	var ice := []
	var ice_mat := Mats.soft(0xdff7ff)
	ice_mat.emission_enabled = true
	ice_mat.emission = Mats.lin(0x8fe6ff)
	ice_mat.emission_energy_multiplier = 0.8
	for i in int(Data.RULES.hopperMax):
		var c := add(g, gem(0.34), ice_mat, cos(i * 1.7) * 0.45, 3.5 + (i % 2) * 0.2, sin(i * 1.7) * 0.45, false)
		c.visible = false
		ice.append(c)
	# the oxygen tank: the glowing column inside IS the crew's air supply
	add(g, Mats.cyl(1.15, 1.15, 5.0, 20), Mats.transparent(Mats.soft(0xbfe8ff, { "roughness": 0.08 }), 0.22), 3.1, 2.9, 0, false)
	var lm := Mats.soft(0x7fe6ff)
	lm.emission_enabled = true
	lm.emission = Mats.lin(0x4fd8ff)
	lm.emission_energy_multiplier = 0.9
	Mats.transparent(lm, 0.85)
	var level := Mats.from_bottom(g, Mats.cyl(0.95, 0.95, 4.8, 20), lm, 3.1, 0.45, 0, 4.8)
	var lamp := add(g, Mats.box(1.2, 0.3, 0.1), Mats.glow(0x4fd8ff, 0.2), 0.75, 2.2, 1.52, false)
	socket(g, "air", -1.1, 2.7)
	P.air.merge({ "ice": ice, "level": level, "levelMat": lm, "fan": fan, "lamp": lamp, "rim": rim })
	pos.air = wp(g, 0.8, 6.6, 0)
	repair.air = wp(g, 0, 1.4, 2.4)
	collide(g, 0, 0, 2.3)
	collide(g, 3.1, 0, 1.45)


# ---------- greenhouse ----------
func _greenhouse() -> void:
	var g := group(L.food)
	g.add_child(model("greenhouse"))   # paved floor, aluminium ribs over glass, framed ends with a door, trays, tank cage
	var lamp_m: StandardMaterial3D = add(g, Mats.box(10.2, 0.14, 0.3), Mats.glow(0xff5fd0, 0.2), 0, 3.3, -0.3, false).material_override
	var light := OmniLight3D.new()
	light.light_color = Mats.lin(0xff5fd0)
	light.light_energy = 0
	light.omni_range = 13
	light.omni_attenuation = 2
	light.position = Vector3(0, 2.6, 0.2)
	g.add_child(light)
	var beds := []
	var leaf_a := Mats.mat(0x4fd15a)
	var leaf_b := Mats.mat(0x2fa64a)
	var fruit_m := Mats.glow(0xff4a3a, 0.5)
	var bush_a := Mats.mat(0x2f8a4a)
	var bush_b := Mats.mat(0x246e3c)
	var flower_m := Mats.glow(0xe9d9ff, 0.6)
	var spud_m := Mats.mat(0xb98a4f)
	for i in int(Data.RULES.beds):
		var bx := -3.6 + i * 2.4
		var pg := Node3D.new()
		pg.position = Vector3(bx, 1.08, 0.2)
		pg.rotation_order = EULER_ORDER_XYZ
		g.add_child(pg)
		var fruits := []
		for k in 5:
			var px := (k % 3 - 1) * 0.55
			var pz := -0.35 if k < 3 else 0.35
			add(pg, Mats.cone(0.3, 0.9, 6), leaf_a if k % 2 else leaf_b, px, 0.45, pz)
			add(pg, Mats.ball(0.24, 6, 5), leaf_b if k % 2 else leaf_a, px + 0.12, 0.25, pz + 0.1)
			var f := add(pg, Mats.ball(0.13, 8, 6), fruit_m, px - 0.14, 0.62, pz + 0.16, false)
			f.visible = false
			fruits.append(f)
		pg.scale = Vector3.ONE * 0.001
		pg.visible = false
		var pg2 := Node3D.new()
		pg2.position = Vector3(bx, 1.08, 0.2)
		pg2.rotation_order = EULER_ORDER_XYZ
		g.add_child(pg2)
		var spuds := []
		for k in 5:
			var qx := (k % 3 - 1) * 0.55
			var qz := -0.35 if k < 3 else 0.35
			add(pg2, Mats.ball(0.34, 7, 6), bush_a if k % 2 else bush_b, qx, 0.26, qz).scale.y = 0.8
			add(pg2, Mats.ball(0.07, 6, 5), flower_m, qx + 0.1, 0.58, qz + 0.05, false)
			var sp := add(pg2, Mats.ball(0.15, 7, 6), spud_m, qx - 0.2, 0.06, qz + 0.22, false)
			sp.scale = Vector3(1.25, 0.8, 0.9)
			sp.visible = false
			spuds.append(sp)
		pg2.scale = Vector3.ONE * 0.001
		pg2.visible = false
		var mark := Node3D.new()
		mark.position = Vector3(bx, 2.5, 0.2)
		g.add_child(mark)
		add(mark, Mats.torus(0.5, 0.06, 18, 6), Mats.glow(0x7be36a, 1.5), 0, 0, 0, false).rotation.x = PI / 2
		mark.visible = false
		beds.append({ "plants": pg, "fruits": fruits, "potato": pg2, "spuds": spuds, "mark": mark, "s": 0.0 })
		spots.beds.append(wp(g, bx, 1.1, 1.9))
		collide(g, bx, 0.1, 1.15)
	# water tank
	add(g, Mats.cyl(1.0, 1.0, 2.6, 16), Mats.transparent(Mats.soft(0xbfe8ff, { "roughness": 0.1 }), 0.25), -6.6, 1.5, 0.2, false)
	var wm := Mats.soft(0x3aa0ff)
	wm.emission_enabled = true
	wm.emission = Mats.lin(0x1b6fd0)
	wm.emission_energy_multiplier = 0.5
	Mats.transparent(wm, 0.85)
	var water := Mats.from_bottom(g, Mats.cyl(0.85, 0.85, 2.4, 16), wm, -6.6, 0.3, 0.2, 2.4)
	hopper(g, "water", -6.6, 3.3, 0.2, 1.0, 0x3aa0ff)
	collide(g, -6.6, 0.2, 1.2)
	socket(g, "food", 6.3, 1.0)
	P.food.merge({ "beds": beds, "lampM": lamp_m, "light": light, "water": water })
	pos.food = wp(g, 0, 5.4, 0)
	repair.food = wp(g, -4.9, 1.2, 1.9)


# ---------- soil bagger ----------
func _bagger() -> void:
	var g := group(L.bag)
	var dirt := Mats.mat(0xa9582f if site == "mars" else 0x7b7c87)
	add(g, Mats.cone(3.2, 2.6, 9), dirt, 0.4, 1.3, -3.6)
	add(g, Mats.box(2.8, 2.2, 2.4), Mats.soft(0xffc533), 0, 1.4, -0.4)
	add(g, Mats.box(3.2, 0.3, 2.8), Mats.soft(0x3a4058), 0, 0.15, -0.4)
	add(g, Mats.box(1.2, 0.2, 3.6), Mats.soft(0x2b3147), 0.4, 2.3, -2.2).rotation.x = -0.45
	var gear := add(g, Mats.cyl(0.5, 0.5, 0.3, 8), Mats.mat(0x8a8fa0), -1.5, 1.6, -0.4)
	gear.rotation_order = EULER_ORDER_XYZ
	gear.rotation.z = PI / 2
	add(g, Mats.box(4.0, 0.2, 1.4), Mats.soft(0x8a8fa0), 0, 0.8, 1.5)
	for i in 4:
		spots.bagTray.append(wp(g, -1.35 + i * 0.9, 1.25, 1.5))
	socket(g, "bag", 2.6, 0.2)
	P.bag.merge({ "gear": gear, "lamp": add(g, Mats.box(1.0, 0.26, 0.1), Mats.glow(0xc9a6ff, 0.2), 0, 1.9, 0.82, false) })
	pos.bag = wp(g, 0, 4.4, -0.4)
	collide(g, 0, -0.6, 1.9)
	collide(g, 0.4, -3.6, 2.6)


# ---------- science lab ----------
func _lab() -> void:
	var g := group(L.lab)
	var mdl := model("lab")       # panelled hull with orange rings, landing legs, observatory dome, radiator, workbench
	g.add_child(mdl)
	var arm := find(mdl, "lab_arm")
	var screen := add(g, Mats.box(1.9, 1.1, 0.1), Mats.glow(0x9fe8ff, 0.3), 1.2, 2.9, 1.62, false)
	hopper(g, "lab", -1.6, 1.7, 2.5, 0.95, 0xffb84d)
	var tubes := []
	for i in int(Data.RULES.labQueue):
		var t := add(g, Mats.cyl(0.1, 0.1, 0.6, 8), Mats.glow(0xffb84d, 1.2), -2.1 + i * 0.33, 1.4, 1.75, false)
		t.visible = false
		tubes.append(t)
	socket(g, "lab", 2.6, 2.6)
	P.lab.merge({ "screen": screen, "tubes": tubes, "arm": arm })
	pos.lab = wp(g, 0, 7, -0.6)
	spots.caseSpawn = wp(g, 0.4, 0.6, 3.6)
	repair.lab = wp(g, 0.4, 1.4, 2.4)
	collide(g, -1.9, -0.7, 2.3)
	collide(g, 1.9, -0.7, 2.3)
	collide(g, -1.6, 2.5, 0.9)


# ---------- radio dish ----------
func _comms() -> void:
	var g := group(L.comms)
	var head := Node3D.new()
	head.position = Vector3(0, 8.0, 0)
	head.rotation_order = EULER_ORDER_XYZ
	g.add_child(head)
	# concrete footing, braced lattice tower with a caged ladder, equipment cabinet; the reflector with its back frame
	# and feed horn (dish_head) moves into the head node so the game can aim it
	var mdl := model("radio_dish")
	g.add_child(mdl)
	var dh := find(mdl, "dish_head")
	if dh:
		move(dh, head)
		dh.position = Vector3.ZERO
	collide(g, -2.25, 0.7, 0.65)
	var tip := add(head, Mats.ball(0.2, 10, 8), Mats.glow(0xff8fb8, 0.3), 0, 2.2, 0, false)
	var waves := []
	for k in 3:
		var w := add(head, Mats.torus(0.7, 0.07, 26, 6), Mats.unlit(0xff8fb8, 0.0, false), 0, 2.4, 0, false)
		w.set_meta("o", k / 3.0)
		waves.append(w)
	socket(g, "comms", 0.4, 2.6)
	P.comms.merge({ "head": head, "tip": tip, "waves": waves })
	pos.comms = wp(g, 0, 11.6, 0)
	collide(g, 0, 0, 1.9)


# ---------- rocket ----------
func _rocket() -> void:
	var pad := group(L.rocket)
	var ang := atan2(-L.rocket.x, -L.rocket.y)                 # face the habitat
	var dir := Vector3(sin(ang), 0, cos(ang))
	var rk := Node3D.new()
	rk.rotation.y = ang
	pad.add_child(rk)
	var tw := Node3D.new()
	tw.rotation.y = ang
	pad.add_child(tw)
	# the rocket made in Blender: the ship (lifts off), the pad, and the gantry tower beside it
	var mdl := model("rocket")
	var ship := find(mdl, "rocket_ship")
	var pad_m := find(mdl, "rocket_pad")
	var gantry := find(mdl, "rocket_gantry")
	for pair in [[pad_m, pad], [ship, rk], [gantry, tw]]:
		move(pair[0], pair[1])
	var tl: MeshInstance3D = find(gantry, "rocket_towerLight")
	if tl == null:
		tl = find(mdl, "rocket_towerLight")
		move(tl, tw)
	mdl.free()
	var flame_m := Mats.unlit(0xffb040, 0.9, false)
	var flame := add(rk, Mats.cone(1.7, 8, 16), flame_m, 0, -2.6, 0, false)
	flame.rotation.x = PI
	flame.visible = false
	var fl := OmniLight3D.new()
	fl.light_color = Mats.lin(0xffa040)
	fl.light_energy = 0
	fl.omni_range = 90
	fl.omni_attenuation = 1.6
	rk.add_child(fl)
	var tw_x := -dir.z * 5.6 - dir.x * 1.5
	var tw_z := dir.x * 5.6 - dir.z * 1.5          # where the gantry stands
	P.rocket = { "group": rk, "flame": flame, "light": fl, "towerLight": own_glow(tl), "y": 0.0, "v": 0.0, "base": wp(pad, 0, 0, 0), "pad": pad, "windows": [ship], "dir": dir }
	spots.hoppers.cargo = wp(pad, dir.x * 4.9, 1.6, dir.z * 4.9)
	spots.rocketDoor = wp(pad, dir.x * 6.8 + dir.z * 2, 0, dir.z * 6.8 - dir.x * 2)
	pos.rocket = wp(pad, 0, 23.5, 0)
	collide(pad, 0, 0, 4.2, 24)
	collide(pad, dir.x * 4.9, dir.z * 4.9, 1.1)
	collide(pad, tw_x, tw_z, 1.1, 12)
	floor_disc(pad, 0.3, 11.6, 12.05, -0.15)          # the concrete launch pad: 0.3 m high, its rim bevels into the ground

	var pal := group(L.pallet)
	add(pal, Mats.box(5.0, 0.35, 2.6), Mats.soft(0x8a8fa0), 0, 0.18, 0)
	floor_box(pal, 0.35, 2.5, 1.3)
	add(pal, Mats.box(5.2, 0.1, 0.2), Mats.glow(0xffd23f, 0.5), 0, 0.38, 1.3, false)
	for i in 3:
		spots.pallet.append(wp(pal, -1.6 + i * 1.6, 0.8, 0))


# ---------- places to do science ----------
func _beam_mat(hex: int, opacity: float) -> StandardMaterial3D:
	return Mats.unlit(hex, opacity, true)


func _science_sites() -> void:
	var slab_colors := [0xe6e3da, 0xc98a4a, 0x6b6c78, 0xbfd6ea] if site == "moon" else [0xdba878, 0xe6c49c, 0x4a332b, 0xdff1f8]
	P.geo = []
	for i in L.geo.size():
		var p: Vector2 = L.geo[i]
		var g := group(p)
		var slab := add(g, gem(1.7, 6, 3), Mats.mat(slab_colors[i]), 0, 0.15, 0)
		slab.scale.y = 0.32
		slab.rotation.y = i
		var ring := add(g, Mats.torus(1.25, 0.09, 28, 6), Mats.glow(0xffb84d, 1.6), 0, 0.85, 0, false)
		var beam := add(g, Mats.cyl(0.12, 0.5, 26, 8, true), _beam_mat(0xffb84d, 0.16), 0, 13.5, 0, false)
		var flag := model("flag_marker")                # planted once both cores are drilled
		flag.position = Vector3(1.4, 0, -0.8)
		g.add_child(flag)
		flag.visible = false
		if (site == "mars" or site == "moon") and i == 1:      # Mars: "blueberries"; the Moon: orange glass beads
			var mars := site == "mars"
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = Mats.ball(0.07 if mars else 0.06, 6, 4)
			var n := 220 if mars else 200
			mm.instance_count = n
			for k in n:
				var a := k * 2.4
				var r := (0.6 + sqrt(k) * 0.55) if mars else (0.5 + sqrt(k) * 0.5)
				var y := Terrain.height(p.x + cos(a) * r, p.y + sin(a) * r) - g.position.y + (0.06 if mars else 0.05)
				mm.set_instance_transform(k, Transform3D(Basis(), Vector3(cos(a) * r, y, sin(a) * r)))
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.material_override = Mats.soft(0x4a5a78, { "roughness": 0.5 }) if mars else Mats.glow(0xff9a3a, 0.7)
			g.add_child(mmi)
		if site == "mars" and i == 2:
			var sts := [[-0.5, 0.2], [0.3, -0.3], [0.1, 0.5]]
			for n in 3:
				var st := add(g, Mats.box(2.2, 0.06, 0.14), Mats.glow(0xffffff, 0.35), sts[n][0], 0.68, sts[n][1], false)
				st.rotation.y = 0.5 + n * 0.5
		if i == 3:
			var icm := Mats.soft(0xdff7ff)
			icm.emission_enabled = true
			icm.emission = Mats.lin(0x6fcff5)
			icm.emission_energy_multiplier = 0.5
			for k in 5:
				var ic := add(g, gem(0.5 + (k % 3) * 0.2), icm, cos(k * 1.3) * 2.6, 0.2, sin(k * 1.3) * 2.6)
				ic.rotation_order = EULER_ORDER_XYZ
				ic.rotation = Vector3(k, k * 2, 0)
		P.geo.append({ "ring": ring, "beam": beam, "flag": flag })
		spots.drill.append(wp(g, 0, 0.7, 0))
		collide(g, 0, 0, 0.9)

	# ice deposits
	P.ice = []
	for i in Terrain.ice_nodes.size():
		var n: Vector2 = Terrain.ice_nodes[i]
		var g := group(n)
		var im := Mats.soft(0xdff7ff, { "roughness": 0.15 })
		im.emission_enabled = true
		im.emission = Mats.lin(0x58c8ff)
		im.emission_energy_multiplier = 0.85
		Mats.transparent(im, 0.92)
		im.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_ALWAYS
		add(g, gem(1.1, 5, 3), im, 0, 0.6, 0).scale = Vector3(1, 0.9, 1)
		add(g, gem(0.7, 5, 3), im, 0.9, 0.4, 0.4).rotation.y = i
		add(g, gem(0.6, 5, 3), im, -0.7, 0.35, 0.6).rotation.y = i * 2
		# the ice drill: a tripod with a motor box, a warm auger and a lamp. The game starts it; it works by itself.
		var rg := Node3D.new()
		var leg_m := Mats.soft(0xdfe2ea)
		for k in 3:
			var la := k / 3.0 * PI * 2 + 0.5
			var leg := add(rg, Mats.cyl(0.05, 0.07, 2.9, 6), leg_m, cos(la) * 0.75, 1.3, sin(la) * 0.75)
			leg.rotation_order = EULER_ORDER_XYZ
			leg.rotation = Vector3(sin(la) * 0.5, 0, -cos(la) * 0.5)
		add(rg, Mats.box(0.55, 0.45, 0.55), Mats.soft(0xffc533), 0, 2.55, 0)
		add(rg, Mats.box(0.6, 0.1, 0.6), Mats.soft(0x2b3147), 0, 2.82, 0)
		var am := Mats.soft(0xb8bcc8, { "roughness": 0.3, "metallic": 0.8 })
		am.emission_enabled = true
		am.emission = Mats.lin(0xff7a2d)
		am.emission_energy_multiplier = 0
		var auger := add(rg, Mats.cone(0.16, 1.5, 6), am, 0, 1.6, 0)
		auger.rotation.x = PI
		var lamp := add(rg, Mats.ball(0.09, 8, 6), Mats.glow(0x46ff8a, 0.3), 0.33, 2.62, 0.3, false)
		g.add_child(rg)
		P.ice.append({ "group": g, "mat": im, "auger": auger, "augerMat": am, "lamp": lamp })
		spots.ice.append(wp(g, 0, 0.8, 0))
		collide(g, 0, 0, 1.1)
	var ib := group(L.ice)
	add(ib, Mats.cyl(0.2, 1.2, 60, 8, true), _beam_mat(0x8fe6ff, 0.1), 0, 30, 0, false)

	# instrument targets (a glowing outline until the real thing is set up)
	P.inst = {}
	for id in L.inst:
		var g := group(L.inst[id])
		var steel := Mats.soft(0xdfe2ea)
		var dark := Mats.soft(0x3a4058)
		var ring := add(g, Mats.torus(1.6, 0.08, 30, 6), Mats.glow(0x5cf0ff, 1.6), 0, 0.3, 0, false)
		var ghost := add(g, Mats.cyl(0.1, 0.4, 20, 8, true), _beam_mat(0x5cf0ff, 0.16), 0, 10.3, 0, false)
		var m := Node3D.new()
		g.add_child(m)
		m.visible = false
		m.scale = Vector3.ONE * 0.001
		var spin = null
		var spin_group := false
		if id == "seismo":
			add(m, Mats.half_ball(0.9, 16, 6), Mats.soft(0xe8eaf0, { "roughness": 0.25, "metallic": 0.6 }), 0, 0.25, 0)
			add(m, Mats.cyl(1.0, 1.1, 0.25, 16), dark, 0, 0.13, 0)
			add(m, Mats.box(1.3, 0.06, 0.9), Mats.soft(0x14306b, { "roughness": 0.3, "metallic": 0.5 }), 1.9, 0.5, 0).rotation.z = 0.3
			add(m, Mats.cyl(0.04, 0.04, 0.5, 5), steel, 1.9, 0.25, 0)
		elif id == "rad":
			add(m, Mats.cyl(0.07, 0.09, 1.8, 6), steel, 0, 0.9, 0)
			add(m, Mats.box(0.8, 0.6, 0.6), Mats.soft(0xffc533), 0, 2.0, 0)
			add(m, Mats.cyl(0.16, 0.16, 0.5, 8), dark, 0, 2.5, 0)
			spin = add(m, Mats.ball(0.12, 8, 6), Mats.glow(0xff6fb1, 2), 0.3, 2.35, 0.32, false)
		elif site == "moon":                 # laser mirror
			var pm := Mats.soft(0xcfe6ff, { "roughness": 0.08, "metallic": 0.95 })
			pm.emission_enabled = true
			pm.emission = Mats.lin(0x4a7ac0)
			pm.emission_energy_multiplier = 0.3
			add(m, Mats.box(1.5, 1.5, 0.12), pm, 0, 0.95, 0).rotation.x = -0.75
			add(m, Mats.box(1.7, 0.1, 1.2), dark, 0, 0.1, 0)
			add(m, Mats.cyl(0.05, 0.05, 0.9, 5), steel, 0, 0.5, -0.3)
		else:                                # weather mast
			add(m, Mats.cyl(0.06, 0.09, 3.4, 6), steel, 0, 1.7, 0)
			add(m, Mats.box(0.5, 0.4, 0.4), Mats.soft(0xf2f3f7), 0, 2.4, 0.2)
			spin = Node3D.new()
			spin.position = Vector3(0, 3.5, 0)
			m.add_child(spin)
			spin_group = true
			for cc in 3:
				var cup := add(spin, Mats.ball(0.14, 8, 6), Mats.soft(0xff8a3d), cos(cc * 2.094) * 0.45, 0, sin(cc * 2.094) * 0.45)
				cup.scale.y = 0.8
			add(spin, Mats.box(0.9, 0.04, 0.04), steel, 0, 0, 0)
		P.inst[id] = { "ring": ring, "ghost": ghost, "model": m, "spin": spin, "spinGroup": spin_group, "s": 0.0 }
		spots.inst[id] = wp(g, 0, 0.6, 0)

	P.photo = []
	for p in L.photo:
		var g := group(p)
		add(g, Mats.cyl(0.05, 0.05, 1.5, 5), Mats.soft(0xdfe2ea), 0, 0.75, 0)
		add(g, Mats.box(0.5, 0.36, 0.3), Mats.soft(0x2b3147), 0, 1.6, 0)
		var lens := add(g, Mats.cyl(0.12, 0.12, 0.16, 10), Mats.glow(0xffd23f, 1.6), 0, 1.6, 0.2, false)
		lens.rotation.x = PI / 2
		var ring := add(g, Mats.torus(1.3, 0.07, 26, 6), Mats.glow(0xffd23f, 1.6), 0, 0.25, 0, false)
		P.photo.append({ "ring": ring, "lens": lens })
		spots.photo.append(wp(g, 0, 1, 0))
		collide(g, 0, 0, 0.4)


func build(root_node: Node3D, site_id: String) -> void:
	root = root_node
	site = site_id
	L = Terrain.L
	P = { "cables": {}, "air": {}, "food": {}, "bag": {}, "lab": {}, "comms": {} }
	colliders = []
	floors = []
	pos = {}
	repair = {}
	spots = { "sockets": {}, "hoppers": {}, "rackSlots": [], "bagTray": [], "beds": [], "panels": [], "drill": [], "ice": [], "inst": {}, "photo": [], "pallet": [] }
	# every boulder keeps its own collider (b.col), so one that is broken up can stop blocking the way; h is how tall it stands
	for b in Terrain.boulders:
		b.col = { "x": b.x, "z": b.z, "r": b.r * 0.92, "h": 0.9 if b.seat else b.r * (0.5 + b.sy) }
		colliders.append(b.col)
	_hab()
	_solar()
	_air_maker()
	_greenhouse()
	_bagger()
	_lab()
	_comms()
	_rocket()
	_science_sites()
	repair.rack = spots.rack
	var rack_p := Vector3(L.rack.x, 0, L.rack.y)
	for id in ["air", "food", "bag", "lab", "comms", "scrub"]:
		cable(rack_p, spots.sockets[id], id)
	launch = null


# ---------- show what the mission rules say ----------
const DEMO := { "air": 60.0, "bags": 5, "filter": 80.0, "water": 60.0, "rack": { "charge": 0.5, "eff": [1.0, 1.0, 1.0], "broken": false },
	"m": { "air": { "power": 2, "queue": 2, "prog": 0.1, "broken": false }, "food": { "lamp": 1.0, "water": 1, "broken": false,
		"beds": [{ "state": "ripe", "g": 1.0 }, { "state": "growing", "g": 0.7, "crop": "potato" }, { "state": "growing", "g": 0.4 }, { "state": "ripe", "g": 1.0, "crop": "potato" }] },
		"bag": { "pending": 1, "broken": false }, "lab": { "power": 2, "queue": [1], "prog": 0.2, "broken": false }, "comms": { "on": true } },
	"cores": [0, 0, 0, 0], "inst": {}, "photos": {}, "storm": null }


func update(dt: float, s) -> void:
	if not P.has("hab"):
		return
	var demo: bool = s == null
	if demo:
		s = DEMO
	var t := World.time
	var m: Dictionary = s.m
	var st = s.get("storm")
	var alarm: bool = st != null and st.warned and not st.over

	# habitat
	for i in P.hab.bags.size():
		var b: MeshInstance3D = P.hab.bags[i]
		var want := 1.0 if i < s.bags else 0.0
		var bs: float = b.get_meta("s")
		bs += (want - bs) * minf(1, dt * 7)
		b.set_meta("s", bs)
		b.visible = bs > 0.02
		b.scale = Vector3(1.45 * bs, 0.62 * bs, 0.85 * bs) if b.visible else Vector3.ONE * 0.001
	var dl: BaseMaterial3D = P.hab.doorLight
	Mats.set_color(dl, 0xff4d6a if alarm else 0x4dff9a)
	dl.emission_energy_multiplier = 2 + sin(t * 12) * 1.5 if alarm else 1.6
	(P.hab.beacon as BaseMaterial3D).emission_energy_multiplier = 1 + sin(t * 3)
	if P.hab.flag:
		P.hab.flag.rotation.y = sin(t * 2) * 0.12 if site == "mars" else 0.0

	# solar panels track the Sun; dust (Mars) or a moved Sun (Moon) makes them less useful
	for i in 3:
		var eff: float = s.rack.eff[i]
		var off := (1 - eff) * 2
		var q := Quaternion(Vector3.UP, World.sun_dir.normalized())
		if site == "moon":
			q = Quaternion(Vector3.UP, off * 1.1) * q
		var pv: Node3D = P.solar.pivots[i]
		pv.quaternion = pv.quaternion.slerp(q, minf(1, dt * 2.5))
		var pm: BaseMaterial3D = P.solar.mats[i]
		if pm:
			pm.albedo_color = Color(1, 1 - off * 0.3, 1 - off * 0.62) if site == "mars" else Color(1, 1, 1)
			pm.emission_energy_multiplier = 0.3 * eff
	P.rack.level.scale.y = maxf(0.02, minf(1, s.rack.charge))
	var rl: StandardMaterial3D = P.rack.lamp.material_override
	Mats.set_color(rl, 0xff4d6a if s.rack.broken else 0x46ff8a)
	rl.emission_energy_multiplier = 1.5 + sin(t * 12) * 1.5 if s.rack.broken else 1.2
	P.cables.trunk.emission_energy_multiplier = 0.0 if s.rack.broken else 0.6 + sin(t * 5) * 0.3

	# air maker
	var a: Dictionary = m.air
	var working: bool = not a.broken and a.power > 0 and a.queue > 0
	set_socket("air", a.power, a.power > 0)
	for i in P.air.ice.size():
		P.air.ice[i].visible = i < a.queue
		P.air.ice[i].rotation.y += dt * (3.0 if working else 0.4)
	var lvl: Node3D = P.air.level
	lvl.scale.y += (maxf(0.02, s.air / 100.0) - lvl.scale.y) * minf(1, dt * 3)
	var lm: StandardMaterial3D = P.air.levelMat
	lm.albedo_color = Mats.lin(0xff6f7f if s.air < 25 else 0x7fe6ff, 0.85)
	lm.emission = Mats.lin(0xff3050 if s.air < 25 else 0x4fd8ff)
	if P.air.fan:
		P.air.fan.rotation.z += dt * (12.0 if working else 0.3)
	(P.air.lamp.material_override as StandardMaterial3D).emission_energy_multiplier = 2.0 if working else 0.15
	if working and randf() < dt * 10:
		var hp: Vector3 = spots.hoppers.air
		World.emit(hp.x + 3.1 + (randf() - 0.5), hp.y - 3 + randf() * 3, hp.z + (randf() - 0.5), { "vy": 1.2, "life": 1.4, "size": 0.3, "grow": 0.3, "color": 0xbff4ff, "alpha": 0.7 })

	# greenhouse
	var f: Dictionary = m.food
	var lit: bool = f.lamp > 0 and not f.broken
	set_socket("food", ceilf(f.lamp * 3) if lit else 0.0, f.lamp > 0)
	(P.food.lampM as StandardMaterial3D).emission_energy_multiplier = 2.4 if lit else 0.12
	P.food.light.light_energy = 1.6 * 4 if lit else 0.0
	var wl: Node3D = P.food.water
	wl.scale.y += (maxf(0.02, minf(1, float(s.get("water", 0)) / 100.0)) - wl.scale.y) * minf(1, dt * 3)
	for i in P.food.beds.size():
		var bed: Dictionary = f.beds[i]
		var pb: Dictionary = P.food.beds[i]
		var spud: bool = bed.get("crop") == "potato"
		var ws: float = 0.0 if bed.state == "empty" else 0.16 + 0.84 * bed.g
		pb.s += (ws - pb.s) * minf(1, dt * 4)
		var grown: Node3D = pb.potato if spud else pb.plants
		var other: Node3D = pb.plants if spud else pb.potato
		other.visible = false
		grown.visible = pb.s > 0.02
		grown.scale = Vector3.ONE * maxf(0.001, pb.s)
		grown.rotation.z = sin(t * 1.4 + i) * 0.03
		for k in pb.fruits.size():
			pb.fruits[k].visible = bed.state == "ripe"
			pb.spuds[k].visible = bed.state == "ripe"
		pb.mark.visible = bed.state == "ripe"
		pb.mark.position.y = 2.6 + sin(t * 3 + i) * 0.15
		pb.mark.rotation.y = t * 2

	# air scrubber
	var fl: float = s.get("filter", 100.0)
	var low: bool = fl < Data.RULES.filterWarn
	set_socket("scrub", ceilf(fl / 34), not low)
	for i in 3:
		var cm: StandardMaterial3D = P.scrub.cans[i]
		var full := fl <= i * 33.4                 # the canisters fill up one after another
		cm.albedo_color = Mats.lin(0x6b7078 if full else 0x8fe8d0)
		cm.emission = Mats.lin(0x30343c if full else 0xffb347 if low else 0x3db8a0)
		cm.emission_energy_multiplier = 0.1 if full else (0.9 + sin(t * 6) * 0.5 if low else 0.8)
	P.cables.scrub.emission_energy_multiplier = 0.0 if low else 0.6

	# soil bagger
	var on: bool = m.bag.pending > 0 and not m.bag.broken
	set_socket("bag", mini(3, m.bag.pending), m.bag.pending > 0)
	if on:
		P.bag.gear.rotation.x += dt * 6
	(P.bag.lamp.material_override as StandardMaterial3D).emission_energy_multiplier = 2.0 if on else 0.15

	# lab
	var lb: Dictionary = m.lab
	var busy: bool = not lb.broken and lb.power > 0 and lb.queue.size() > 0
	set_socket("lab", lb.power, lb.power > 0)
	for i in P.lab.tubes.size():
		P.lab.tubes[i].visible = i < lb.queue.size()
	(P.lab.screen.material_override as StandardMaterial3D).emission_energy_multiplier = 1.4 + sin(t * 9) * 0.8 if busy else 0.25
	if P.lab.arm:
		P.lab.arm.rotation.y = sin(t * 3) * 0.7 if busy else 0.0

	# radio dish
	set_socket("comms", 3.0 if m.comms.on else 0.0, m.comms.on)
	P.comms.head.rotation = Vector3(-0.7, sin(t * 0.1) * 0.3 + 0.4, 0)
	(P.comms.tip.material_override as StandardMaterial3D).emission_energy_multiplier = 2 + sin(t * 8) if m.comms.on else 0.2
	for w in P.comms.waves:
		var wt: float = fmod(t * 0.7 + w.get_meta("o"), 1.0)
		w.position.y = 2.4 + wt * 9
		w.scale = Vector3.ONE * (1 + wt * 4)
		(w.material_override as StandardMaterial3D).albedo_color.a = 0.8 * (1 - wt) if m.comms.on else 0.0
	P.cables.air.emission_energy_multiplier = 1.0 if a.power > 0 else 0.0
	P.cables.food.emission_energy_multiplier = 1.0 if lit else 0.0
	P.cables.bag.emission_energy_multiplier = 1.0 if on else 0.0
	P.cables.lab.emission_energy_multiplier = 1.0 if lb.power > 0 else 0.0
	P.cables.comms.emission_energy_multiplier = 1.0 if m.comms.on else 0.0

	# sparks and smoke on anything broken
	for id in ["air", "food", "lab", "rack"]:
		var mm: Dictionary = s.rack if id == "rack" else m[id]
		if not mm.broken or randf() > dt * 14:
			continue
		var p: Vector3 = repair[id]
		World.emit(p.x, p.y + 0.6, p.z, { "vx": (randf() - 0.5) * 5, "vy": 2 + randf() * 4, "vz": (randf() - 0.5) * 5, "life": 0.5, "size": 0.22, "grow": 0.3, "color": 0xffe36a, "alpha": 1.0, "grav": World.gravity })
		if randf() < 0.4:
			World.emit(p.x, p.y + 1, p.z, { "vy": 1.4, "life": 2, "size": 0.6, "grow": 3, "color": 0x555a66, "alpha": 0.5 })

	# science sites
	for i in P.geo.size():
		var left: int = 2 - int(s.cores[i])
		var gp: Dictionary = P.geo[i]
		gp.ring.visible = left > 0
		gp.beam.visible = left > 0
		gp.flag.visible = left <= 0
		gp.ring.scale = Vector3.ONE * (1 + sin(t * 3 + i) * 0.06)
	for i in P.ice.size():
		var pi2: Dictionary = P.ice[i]
		var rs = rigs[i] if rigs != null and not demo and i < rigs.size() else null
		var drilling: bool = rs != null and rs.state == "drill"
		var resting: bool = rs != null and rs.state == "rest"
		(pi2.mat as StandardMaterial3D).emission_energy_multiplier = 0.75 + sin(t * 2 + i) * 0.2
		# the drill turns and sinks into the ice while it works, glows warm, and puffs a little vapour
		pi2.auger.rotation.y += dt * (18.0 if drilling else 0.0)
		var ay: float = 1.6 - rs.p * 0.55 if drilling else 1.6
		pi2.auger.position.y += (ay - pi2.auger.position.y) * minf(1, dt * 6)
		(pi2.augerMat as StandardMaterial3D).emission_energy_multiplier = (0.5 + rs.p * 0.9) if drilling else (0.5 if resting else 0.0)
		var lpm: StandardMaterial3D = pi2.lamp.material_override
		Mats.set_color(lpm, 0xffd23f if drilling else 0xff8a3d if resting else 0x46ff8a)
		lpm.emission_energy_multiplier = 1.6 + sin(t * 12) if drilling else (0.9 if resting else 0.5)
		if drilling and randf() < dt * 14:
			var gpos: Vector3 = pi2.group.position
			World.emit(gpos.x + (randf() - 0.5) * 0.5, gpos.y + 0.9, gpos.z + (randf() - 0.5) * 0.5, { "vy": 1.3, "life": 1.1, "size": 0.28, "grow": 1.2, "color": 0xdff7ff, "alpha": 0.6 })
	for id in P.inst:
		var pi: Dictionary = P.inst[id]
		var done: bool = Js.truthy(s.inst.get(id))
		pi.ring.visible = not done
		pi.ghost.visible = not done
		pi.ring.rotation.y = t
		pi.s += ((1.0 if done else 0.0) - pi.s) * minf(1, dt * 5)
		pi.model.visible = done or pi.s > 0.02
		pi.model.scale = Vector3.ONE * maxf(0.001, pi.s)
		if pi.spin and done:
			if pi.spinGroup:
				pi.spin.rotation.y += dt * 5
			else:
				(pi.spin.material_override as StandardMaterial3D).emission_energy_multiplier = 1.5 + sin(t * 6) * 1.5
	for i in P.photo.size():
		var took: bool = Js.truthy(s.photos.get(i))
		P.photo[i].ring.visible = not took
		(P.photo[i].lens.material_override as StandardMaterial3D).emission_energy_multiplier = 0.2 if took else 1.6 + sin(t * 4)

	# rocket
	var rk: Dictionary = P.rocket
	(rk.towerLight as BaseMaterial3D).emission_energy_multiplier = 1 + sin(t * 4)
	if launch != null:
		launch.t += dt
		var burn: bool = launch.t > 2.4
		rk.flame.visible = launch.t > 1.2
		rk.flame.scale = Vector3(1, 0.6 + randf() * 0.8 + (0.6 if burn else 0.0), 1)
		rk.light.light_energy = (4 + randf() * 2) * 3 if launch.t > 1.2 else 0.0
		if burn:
			rk.v += (2.2 + launch.t * 1.4) * dt
			rk.y += rk.v * dt
		rk.group.position.y = rk.y
		if launch.t > 1.2:
			var base: Vector3 = rk.base
			for i in World.rate(6, dt):
				var ang := randf() * TAU
				var sp := (9 + randf() * 12) if burn else (3 + randf() * 4)
				var low_r: bool = rk.y < 14
				World.emit(base.x + cos(ang) * 1.2, base.y + maxf(0.4, rk.y * 0.55) + 0.6, base.z + sin(ang) * 1.2,
					{ "vx": cos(ang) * sp * (1.0 if low_r else 0.15), "vy": (1.5 + randf() * 3) if low_r else -6.0, "vz": sin(ang) * sp * (1.0 if low_r else 0.15),
						"life": 2.4, "size": 1.6, "grow": 4, "color": 0xffc27a if randf() < 0.3 else 0xe6e0d8, "alpha": 0.6 })
		World.cam.shake = maxf(World.cam.shake, 0.5 * maxf(0, 1 - rk.y / 160) if burn else 0.12)


func start_launch() -> void:
	launch = { "t": 0.0 }
	P.rocket.y = 0.0
	P.rocket.v = 0.0


func rocket_pos() -> Vector3:
	return P.rocket.base + Vector3(0, P.rocket.y + 10, 0)
