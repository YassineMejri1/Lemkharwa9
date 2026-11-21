extends Node
## Astro Outpost — things that move: the astronaut, the rover, dust devils, and every object you can pick up, carry and
## throw (with real Moon / Mars gravity). A port of js/actors.js (autoload "Actors").

## the astronaut (yours, or a crewmate in crew mode)
class Astro:
	var group: Node3D
	var hips: Node3D
	var body: Node3D
	var arm_l: Node3D
	var arm_r: Node3D
	var fore_l: Node3D
	var fore_r: Node3D
	var hand_l: Node3D
	var hand_r: Node3D
	var leg_l: Node3D
	var leg_r: Node3D
	var shin_l: Node3D
	var shin_r: Node3D
	var foot_l: Node3D
	var foot_r: Node3D
	var tip: MeshInstance3D
	var tip_mat: BaseMaterial3D
	var drill: Node3D
	var bit: Node3D
	var accent: BaseMaterial3D
	# the suit is one skinned mesh: the joints above are empties, copied onto its skeleton by _skin()
	var torso: MeshInstance3D           # hips, chest, helmet and pack (helmet view draws them as a shadow only)
	var antenna: MeshInstance3D
	var skel: Skeleton3D
	var joints: Array[Node3D] = []      # in SKIN order
	var bone := PackedInt32Array()
	var bind: Array[Transform3D] = []   # from each joint's frame to its bone's, at rest
	var base := Transform3D.IDENTITY    # the hips' parent, in the model
	var sk_inv := Transform3D.IDENTITY  # the model, in the skeleton's frame
	var jm: Array[Transform3D] = []     # this frame: each joint in the model
	var bm: Array[Transform3D] = []     # this frame: each bone in the skeleton
	var pos := Vector3(0, 0, 13)
	var vel := Vector3.ZERO
	var vy := 0.0
	var yaw := PI
	var on_ground := true
	var mode := "walk"          # walk, busy, drive, sit, hidden
	var carrying = null
	var aim := false
	var throw_t := 0.0
	var spin := 0.0
	var moved := 0.0
	var fp := false
	# for pose(): stride cycle, gait (0 walk .. 2 sprint), speed, how much he is moving, in the air, landing, leaning
	var cyc := 0.0
	var gait := 0.0
	var spd := 0.0
	var move := 0.0
	var accel := 0.0
	var bank := 0.0
	var last_yaw := PI
	var air_t := 0.0
	var air := 0.0
	var run_jump := 0
	var lead := 1
	var land_t := 9.0
	var land_k := 0.0
	var head_y := 0.0
	var leg_ph := [0.0, 0.5]
	# sitting on the lookout rock (observe add-on)
	var sit_k := 0.0
	var relax_k := 0.0
	var look := 0.0
	var sit_walk := 0.0
	# crew mode
	var solid := false
	var puppet := false
	var room = null
	var color := 0xff7a3d
	var peer := ""
	var name := ""


class Rover:
	var group: Node3D
	var body: Node3D
	var wheels: Array = []
	var ring: MeshInstance3D
	var ring_mat: BaseMaterial3D
	var light: SpotLight3D
	var pos := Vector3.ZERO
	var yaw := PI / 2
	var speed := 0.0
	var vy := 0.0
	var last_gnd := 0.0
	var on_ground := true
	var pitch := 0.0
	var roll := 0.0
	var bed := [null, null, null, null]
	var track_d := 0.0
	var driver := false
	var remote := false          # crew mode: somebody else drives
	var manned := false
	var sink := 0.0
	var crash_t := 0.0
	var steer := 0.0


class Item:
	var type := ""
	var mesh: Node3D
	var pos := Vector3.ZERO
	var vel := Vector3.ZERO
	var state := "rest"          # rest, held, fly, bed, fixed
	var r := 0.35
	var data = null
	var spin := 0.0
	var from = null
	var slot := -1
	var tag = null
	var age := 0.0
	var id := 0
	var holder = null
	var small := false
	var extra := {}


class Devil:
	var group: Node3D
	var pos := Vector3.ZERO
	var dir := 0.0
	var target := Vector3.ZERO
	var timer := 0.0
	var sent := 0.0


var items: Array = []
var devils: Array = []
var crew: Array = []
var astro: Astro
var rover: Rover
var last_id := 0
var landing := Vector3.ZERO
var room = null              # inside the habitat or the rocket: { cx, cz, r, floor, ceil: Callable, colliders }
var fp := false

# hooks the game sets
var on_devil := Callable()
var on_edge := Callable()
var on_jump := Callable()
var on_land := Callable()
var on_bonk := Callable()
var on_step := Callable()
var on_bounce := Callable()
var on_crash := Callable()
var rover_stuck := Callable()
var rover_charge := Callable()
var skip_hit := Callable()
var knock_loose := false

var root: Node3D
var site := "mars"
var grav := 3.71
var grip := 1.0          # how well boots hold the ground outside (Europa's ice: 0.2)
var fall := 0.0          # the fastest you can fall in thick air, in m/s (Titan); 0 = no limit
var _hit_n := Vector2.ZERO

const THROW_ANGLE := 0.72
const THROW_MIN := 3.2
const THROW_MAX := 9.5
## the astronaut's skeleton: the same pivots as assets/blender/scripts/build_astronaut_skinned.py, in the model's own
## units (he is drawn at 1.07 scale, about 1.9 m tall). toe: the ball of the foot in front of the ankle; heel: the back
## of the heel.
const RIG := { "scale": 1.07, "hipX": 0.156, "hipY": 0.86, "kneeY": 0.496, "ankleY": 0.142, "waistY": 0.993, "shX": 0.301, "shY": 1.321, "elbowY": 1.12, "wristY": 0.944, "toe": 0.15, "heel": -0.105 }
const L1 := 0.86 - 0.496
const L2 := 0.496 - 0.142
const ANK := 0.142
## the skeleton's bones, a parent before its children, and the joint empty (astro_<bone>) that drives each
const SKIN := ["hips", "body", "legL", "shinL", "footL", "legR", "shinR", "footR", "armL", "foreL", "handL", "armR", "foreR", "handR"]
const SKIN_PARENT := [-1, 0, 0, 2, 3, 0, 5, 6, 1, 8, 9, 1, 11, 12]
const BED := [[-0.5, 1.6, -0.85], [0.5, 1.6, -0.85], [-0.5, 1.6, -1.7], [0.5, 1.6, -1.7]]
const RADIUS := { "cell": 0.4, "ice": 0.4, "bag": 0.32, "core": 0.34, "crate": 0.3, "inst": 0.38, "case": 0.28 }
const ITEM_MODEL := { "cell": "power_cell", "bag": "soil_bag", "core": "core_sample", "crate": "food_crate", "inst": "instrument", "case": "supply_case" }
const ROVER_W := 1.25
const ROVER_L := 2.4


static func angle_lerp(a: float, b: float, t: float) -> float:
	var d := b - a
	while d > PI:
		d -= TAU
	while d < -PI:
		d += TAU
	return a + d * t


static func smooth01(t: float) -> float:
	t = clampf(t, 0, 1)
	return t * t * (3 - 2 * t)


## The ground you stand on: the terrain, or the top of a raised floor such as the rocket's concrete pad (Base.floors).
## Feet, wheels and dropped things all use it, so nothing sinks into the pad.
func ground_at(x: float, z: float) -> float:
	var h := Terrain.height(x, z)
	for f in Base.floors:
		var dx: float = x - f.x
		var dz: float = z - f.z
		if f.has("hw"):
			if absf(dx) < f.hw and absf(dz) < f.hd and f.y + f.top > h:
				h = f.y + f.top
			continue
		var d := dx * dx + dz * dz
		if d >= f.r1 * f.r1:
			continue
		d = sqrt(d)
		var top: float = f.y + (f.top if d <= f.r0 else f.top + (f.edge - f.top) * (d - f.r0) / (f.r1 - f.r0))
		if top > h:
			h = top
	return h


# ---------- the astronaut ----------
func build_astronaut(color: int) -> Astro:
	var a := Astro.new()
	var g := Base.model("astronaut")
	var n := func(s: String) -> Node3D: return Base.find(g, "astro_" + s)
	a.group = g
	a.hips = n.call("hips")
	a.body = n.call("body")
	a.arm_l = n.call("armL")
	a.arm_r = n.call("armR")
	a.fore_l = n.call("foreL")
	a.fore_r = n.call("foreR")
	a.hand_l = n.call("handL")
	a.hand_r = n.call("handR")
	a.leg_l = n.call("legL")
	a.leg_r = n.call("legR")
	a.shin_l = n.call("shinL")
	a.shin_r = n.call("shinR")
	a.foot_l = n.call("footL")
	a.foot_r = n.call("footR")
	a.tip = n.call("antennaTip")
	a.antenna = n.call("antenna")
	a.torso = n.call("torso")
	a.drill = n.call("drill")
	a.bit = n.call("drillBit")
	for j in [a.hips, a.body, a.arm_l, a.arm_r, a.fore_l, a.fore_r, a.hand_l, a.hand_r, a.leg_l, a.leg_r, a.shin_l, a.shin_r, a.foot_l, a.foot_r]:
		j.rotation_order = EULER_ORDER_XYZ
	_bind_skin(a, g)
	a.tip_mat = Base.own_glow(a.tip)
	a.accent = Base.own_mat(g, "SuitAccent")
	set_suit_color(a, color)
	a.drill.visible = false
	g.scale = Vector3.ONE * RIG.scale
	root.add_child(g)
	return a


## n's place in the model g (n is inside g)
static func _in_model(g: Node3D, n: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	while n != g:
		t = n.transform * t
		n = n.get_parent() as Node3D
	return t


## Ties each joint empty to its bone: at rest, bone = joint * bind (whatever way the bones were exported to face).
func _bind_skin(a: Astro, g: Node3D) -> void:
	a.skel = g.find_children("*", "Skeleton3D", true, false)[0] as Skeleton3D
	a.joints = [a.hips, a.body, a.leg_l, a.shin_l, a.foot_l, a.leg_r, a.shin_r, a.foot_r, a.arm_l, a.fore_l, a.hand_l, a.arm_r, a.fore_r, a.hand_r]
	a.base = _in_model(g, a.hips.get_parent() as Node3D)
	var sk := _in_model(g, a.skel)
	a.sk_inv = sk.affine_inverse()
	for i in SKIN.size():
		var b := a.skel.find_bone(SKIN[i])
		a.bone.append(b)
		a.bind.append(_in_model(g, a.joints[i]).affine_inverse() * sk * a.skel.get_bone_global_rest(b))
		a.jm.append(Transform3D.IDENTITY)
		a.bm.append(Transform3D.IDENTITY)
	_skin(a)


## Copies the joints' pose onto the skeleton. Every pose function ends with it.
func _skin(a: Astro) -> void:
	for i in SKIN.size():
		var p: int = SKIN_PARENT[i]
		var j: Transform3D = (a.base if p < 0 else a.jm[p]) * a.joints[i].transform
		a.jm[i] = j
		var b: Transform3D = a.sk_inv * j * a.bind[i]
		a.bm[i] = b
		var local: Transform3D = b if p < 0 else a.bm[p].affine_inverse() * b
		a.skel.set_bone_pose_position(a.bone[i], local.origin)
		a.skel.set_bone_pose_rotation(a.bone[i], local.basis.get_rotation_quaternion())


## cuffs, bands, knee pads and gauntlets take the chosen suit colour
func set_suit_color(a: Astro, color: int) -> void:
	a.color = color
	if a.accent:
		a.accent.albedo_color = Color.hex((color << 8) | 0xFF)


# ---------- the rover ----------
func build_rover() -> Rover:
	var r := Rover.new()
	var g := Node3D.new()
	var body := Node3D.new()
	g.add_child(body)
	# the Blender rover: the body tilts with the ground, the six wheels spin on their own
	var m := Base.model("rover")
	Base.move(Base.find(m, "rover_body"), body)
	var ring: MeshInstance3D = Base.find(m, "rover_socketRing")
	Base.move(ring, body)
	for i in 6:
		# Godot's importer makes "*_wheel_*" nodes into vehicle wheels: keep just the mesh, on a plain pivot
		var w: Node3D = Base.find(m, "rover_" + str(i))
		var pivot := Node3D.new()
		pivot.position = w.position
		g.add_child(pivot)
		for c in w.get_children():
			Base.move(c, pivot)
		r.wheels.append(pivot)
	m.free()
	var lt := SpotLight3D.new()
	lt.light_color = Mats.lin(0xfff2cc)
	lt.light_energy = 0
	lt.spot_range = 40
	lt.spot_angle = rad_to_deg(0.7)
	lt.spot_angle_attenuation = 0.5
	lt.spot_attenuation = 1.3
	lt.shadow_enabled = false
	var lp := Vector3(0, 1.4, 2.2)
	lt.transform = Transform3D(Basis.looking_at(Vector3(0, 0, 14) - lp), lp)
	body.add_child(lt)
	root.add_child(g)
	var p: Vector2 = Terrain.L.roverPark
	r.group = g
	r.body = body
	r.ring = ring
	r.ring_mat = Base.own_glow(ring)
	r.light = lt
	r.pos = Vector3(p.x, Terrain.height(p.x, p.y), p.y)
	return r


func rover_local(x: float, y: float, z: float) -> Vector3:
	var s := sin(rover.yaw)
	var c := cos(rover.yaw)
	return Vector3(rover.pos.x + x * c + z * s, rover.pos.y + y, rover.pos.z - x * s + z * c)


func rover_spot(name: String) -> Vector3:
	match name:
		"bed":
			return rover_local(0, 1.7, -1.3)
		"socket":
			return rover_local(0, 1.7, -2.55)
		"door":
			return rover_local(-2.1, 0, 0.5)
	return rover_local(0, 0, 0)


func bed_free() -> int:
	for i in 4:
		if rover.bed[i] == null:
			return i
	return -1


func to_bed(it: Item) -> bool:
	var i := bed_free()
	if i < 0:
		return false
	if astro.carrying == it:
		astro.carrying = null
	if it.holder and it.holder.carrying == it:
		it.holder.carrying = null
	it.holder = null
	rover.bed[i] = it
	it.state = "bed"
	it.slot = i
	it.vel = Vector3.ZERO
	return true


# ---------- things you can carry ----------
func item_mesh(type: String, data) -> Node3D:
	if type == "ice":
		var g := Node3D.new()
		var im := Mats.soft(0xdff7ff, { "roughness": 0.15 })
		im.emission_enabled = true
		im.emission = Mats.lin(0x58c8ff)
		im.emission_energy_multiplier = 0.9
		Mats.transparent(im, 0.92)
		im.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_ALWAYS
		Mats.add(g, Base.gem(0.42, 5, 3), im)
		return g
	var m := Base.model(ITEM_MODEL.get(type, "supply_case"))
	if type == "bag":
		var sack := Base.own_mat(m, "Sack")
		if sack:
			sack.albedo_color = Color.hex(((0xa9582f if site == "mars" else 0x7b7c87) << 8) | 0xFF)
	elif type == "core":
		var c := Base.own_mat(m, "Glow_Core")
		if c:
			var hex: int = [0xc9824a, 0xdfe2ea, 0xffd23f][int(data.quality) if data else 1]
			c.albedo_color = Mats.lin(hex)
			c.emission = Mats.lin(hex)
	elif type == "inst":
		var c := Base.own_mat(m, "Glow_Inst")
		if c:
			var hex: int = { "seismo": 0x5cf0ff, "beam": 0xffd23f, "rad": 0xff6fb1 }.get(data.id if data else "", 0xffffff)
			c.albedo_color = Mats.lin(hex)
			c.emission = Mats.lin(hex)
	var holder := Node3D.new()           # so that tumbling in flight does not fight the model's own transform
	holder.add_child(m)
	return holder


## Every thing has a number (id) so that, in crew mode, all the players' games mean the same thing by it.
## holder: the astronaut carrying it (yours, or a crewmate's).
func spawn(type: String, p: Vector3, data = null, state: String = "rest", id: int = 0) -> Item:
	var it := Item.new()
	it.type = type
	it.mesh = item_mesh(type, data)
	it.pos = p
	it.state = state
	it.r = RADIUS.get(type, 0.35)
	it.data = data
	if id:
		it.id = id
	else:
		last_id += 1
		it.id = last_id
	if id and id > last_id:
		last_id = id
	it.mesh.position = p
	root.add_child(it.mesh)
	items.append(it)
	return it


func remove(it: Item) -> void:
	items.erase(it)
	if astro.carrying == it:
		astro.carrying = null
	if it.holder and it.holder.carrying == it:
		it.holder.carrying = null
	it.holder = null
	if it.state == "bed" and it.slot >= 0 and rover.bed[it.slot] == it:
		rover.bed[it.slot] = null
	if is_instance_valid(it.mesh):
		it.mesh.queue_free()


func by_id(id: int) -> Item:
	for it in items:
		if it.id == id:
			return it
	return null


func pick(it: Item) -> void:
	if it.state == "bed" and it.slot >= 0:
		if rover.bed[it.slot] == it:
			rover.bed[it.slot] = null
		it.slot = -1
	if it.holder and it.holder != astro and it.holder.carrying == it:
		it.holder.carrying = null
	it.state = "held"
	it.vel = Vector3.ZERO
	it.from = null
	astro.carrying = it
	it.holder = astro


func hand_pos(who: Astro = null) -> Vector3:
	var a := who if who else astro
	var s := sin(a.yaw)
	var c := cos(a.yaw)
	var f := 0.95 if a.fp else 0.72        # in first person, hold things a little higher and further out so you can see them
	return Vector3(a.pos.x + s * f, a.pos.y + (1.25 if a.fp else 1.15), a.pos.z + c * f)


func set_down() -> Item:
	var it: Item = astro.carrying
	if it == null:
		return null
	astro.carrying = null
	it.holder = null
	it.state = "fly"
	it.from = null
	it.vel = Vector3(sin(astro.yaw) * 1.2 + astro.vel.x, 0.6, cos(astro.yaw) * 1.2 + astro.vel.z)
	return it


## fwd: the direction the thrower looks (x, z); without it, the way this screen's camera looks
func throw_vel(power: float, fwd = null) -> Vector3:
	var v := lerpf(THROW_MIN, THROW_MAX, power)
	var f: Vector3 = Vector3(fwd.x, 0, fwd.y if fwd is Vector2 else fwd.z).normalized() if fwd != null else World.forward()
	return Vector3(f.x * cos(THROW_ANGLE) * v, sin(THROW_ANGLE) * v, f.z * cos(THROW_ANGLE) * v)


func throw_held(power: float, fwd = null) -> Item:
	var it: Item = astro.carrying
	if it == null:
		return null
	it.pos = hand_pos()
	it.pos.y += 0.5
	it.vel = throw_vel(power, fwd)
	it.vel.x += astro.vel.x * 0.5
	it.vel.z += astro.vel.z * 0.5
	it.state = "fly"
	it.from = astro.pos
	it.spin = 3 + power * 5
	astro.carrying = null
	it.holder = null
	astro.throw_t = 0.35
	return it


## Run fn as if astronaut a were the one playing (crew mode: the host does a crewmate's action with the crewmate's own
## body, position and hands). Everything that reads Actors.astro in there sees a.
func with_astro(a: Astro, fn: Callable):
	if a == null or a == astro:
		return fn.call()
	var keep := astro
	astro = a
	var out = fn.call()
	astro = keep
	return out


## The arc a throw would follow (the same physics the real throw uses). Sets `landing`.
func trajectory(power: float, max_pts: int = 40) -> PackedVector3Array:
	var pts := PackedVector3Array()
	var p := hand_pos()
	p.y += 0.5
	var v := throw_vel(power)
	var dt := 0.09
	var x := p.x
	var y := p.y
	var z := p.z
	var vy := v.y
	for i in 110:
		if pts.size() >= max_pts:
			break
		x += v.x * dt
		z += v.z * dt
		vy -= grav * dt
		y += vy * dt
		if i % 2 == 0:
			pts.append(Vector3(x, y, z))
		if y <= ground_at(x, z) + 0.2:
			break
	landing = Vector3(x, y, z)
	return pts


# ---------- dust devils (Mars) ----------
func _build_devils() -> void:
	devils = []
	if site != "mars":
		return
	for i in 2:
		var g := Node3D.new()
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Mats.lin(0xe2b98c, 0.22)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		m.disable_fog = true
		for k in 6:
			var c := Mats.add(g, Mats.cyl(1.2 + k * 0.75, 0.6 + k * 0.6, 3.4, 10, true), m, 0, 1.7 + k * 3.3, 0, false)
			c.set_meta("k", k)
		root.add_child(g)
		var d := Devil.new()
		d.group = g
		d.pos = Vector3(90 if i else -70, 0, 60 if i else -40)
		d.dir = i * 2.5
		devils.append(d)


## somewhere out on the plain, well away from the solar panels (the panels are only crossed when the mission rules send
## a devil there: see send_devil)
func _wander_target(d: Devil) -> void:
	var sp: Vector2 = Terrain.L.solar
	for k in 8:
		var a := randf() * 6.28
		var r := 70 + randf() * 60
		d.target = Vector3(cos(a) * r, 0, sin(a) * r)
		if Vector2(d.target.x - sp.x, d.target.z - sp.y).length() > 45:
			return


## The mission rules say a dust devil will cross the solar panels in `lead` seconds: bring the nearer devil in from the
## open plain on a straight line through the panels, so the player sees it happen.
func send_devil(lead: float = 9.0) -> bool:
	if devils.is_empty():
		return false
	var c: Vector2 = Terrain.L.solar
	var d: Devil = devils[0]
	var a := randf() * 6.28
	var run := maxf(18, lead * 6.5)
	d.pos = Vector3(c.x + sin(a) * run, 0, c.y + cos(a) * run)
	d.target = Vector3(c.x - sin(a) * 40, 0, c.y - cos(a) * 40)
	d.dir = atan2(d.target.x - d.pos.x, d.target.z - d.pos.z)
	d.timer = (run + 40) / 6.5
	d.sent = d.timer
	return true


func _update_devils(dt: float) -> void:
	for i in devils.size():
		var d: Devil = devils[i]
		d.timer -= dt
		d.sent = maxf(0, d.sent - dt)
		if d.timer <= 0:
			d.timer = 16 + randf() * 14
			_wander_target(d)
		var want := atan2(d.target.x - d.pos.x, d.target.z - d.pos.z)
		d.dir = angle_lerp(d.dir, want + sin(World.time * 0.7 + i) * (0.08 if d.sent > 0 else 0.8), minf(1, dt * (3.0 if d.sent > 0 else 0.8)))
		d.pos.x += sin(d.dir) * 6.5 * dt
		d.pos.z += cos(d.dir) * 6.5 * dt
		d.pos.y = Terrain.height(d.pos.x, d.pos.z)
		d.group.position = d.pos
		for c in d.group.get_children():
			var k: int = c.get_meta("k")
			c.rotation.y += dt * (5 - k * 0.5)
			c.position.x = sin(World.time * 2 + k) * 0.3 * k
		if randf() < dt * 20:
			World.emit(d.pos.x + (randf() - 0.5) * 2, d.pos.y + 0.3, d.pos.z + (randf() - 0.5) * 2,
				{ "vx": (randf() - 0.5) * 6, "vy": 3 + randf() * 5, "vz": (randf() - 0.5) * 6, "life": 2.0, "size": 0.7, "grow": 2.5, "color": 0xdba878, "alpha": 0.4 })
		if astro.mode == "walk" and Vector2(d.pos.x - astro.pos.x, d.pos.z - astro.pos.z).length() < 3:
			astro.spin = 1.2
			if on_devil.is_valid():
				on_devil.call("astro")


# ---------- build ----------
func build(root_node: Node3D, site_id: String, suit_color: int = 0xff7a3d) -> void:
	root = root_node
	var P: Dictionary = Data.SITES[site_id]
	site = P.id              # the world this planet is built on: "moon" or "mars"
	grav = P.gravity
	grip = P.get("grip", 1.0)
	fall = P.get("fall", 0.0)
	items = []
	crew = []
	astro = build_astronaut(suit_color)
	rover = build_rover()
	_build_devils()
	reset_astro()
	if fp:
		set_first_person(true)        # a new world keeps the view you chose


func reset_astro() -> void:
	var d: Vector3 = Base.spots.door
	astro.pos = Vector3(d.x, ground_at(d.x, d.z + 2.4), d.z + 2.4)
	astro.vel = Vector3.ZERO
	astro.vy = 0
	astro.on_ground = true
	astro.yaw = 0
	astro.mode = "walk"


# ---------- movement ----------
## Colliders are circles on the ground with a height: { x, z, r, h } (see base.gd). After a hit, _hit_n points the way
## out of the thing that was hit. Returns the new position, and the collider in _last_hit.
var _last_hit = null


func collide_circle(p: Vector3, r: float) -> Vector3:
	_last_hit = null
	for c in Base.colliders:
		var dx: float = p.x - c.x
		var dz: float = p.z - c.z
		var mn: float = c.r + r
		if absf(dx) > mn or absf(dz) > mn:
			continue
		var d := sqrt(dx * dx + dz * dz)
		if d < mn and d > 0.0001:
			_hit_n = Vector2(dx / d, dz / d)
			p.x = c.x + _hit_n.x * mn
			p.z = c.z + _hit_n.y * mn
			_last_hit = c
			return p
	return p


## how high a collider reaches at this spot
static func top_of(c: Dictionary) -> float:
	if not c.has("gy"):
		c.gy = Terrain.height(c.x, c.z)
	return c.gy + float(c.get("h", 3.4))


## The rover is a box 2.5 m wide and 4.8 m long. Pushes a circle out of it; _pushed is true when it was inside.
var _pushed := false


func rover_push(p: Vector3, rad: float) -> Vector3:
	_pushed = false
	var s := sin(rover.yaw)
	var c := cos(rover.yaw)
	var dx := p.x - rover.pos.x
	var dz := p.z - rover.pos.z
	var lx := dx * c - dz * s
	var lz := dx * s + dz * c          # the same spot in the rover's own left-right and back-front
	var ox := ROVER_W + rad - absf(lx)
	var oz := ROVER_L + rad - absf(lz)
	if ox <= 0 or oz <= 0:
		return p
	if ox < oz:
		var sx := -1.0 if lx < 0 else 1.0
		lx += sx * ox
		_hit_n = Vector2(sx * c, -sx * s)
	else:
		var sz := -1.0 if lz < 0 else 1.0
		lz += sz * oz
		_hit_n = Vector2(sz * s, sz * c)
	p.x = rover.pos.x + lx * c + lz * s
	p.z = rover.pos.z - lx * s + lz * c
	_pushed = true
	return p


func _bounce(it: Item, v: float) -> void:
	if on_bounce.is_valid():
		on_bounce.call(it, v)


## A thing in the air meets what stands in its way: machines, rocks, the round roof of the habitat, the rover, and loose
## things lying about. py: its height a moment ago.
func _hit_things(it: Item, py: float):
	for c in Base.colliders:
		var dx: float = it.pos.x - c.x
		var dz: float = it.pos.z - c.z
		var mn: float = c.r + it.r
		if absf(dx) > mn or absf(dz) > mn:
			continue
		var d := sqrt(dx * dx + dz * dz)
		if d >= mn:
			continue
		var top := top_of(c)
		if c.has("dome"):                         # the habitat: a low ring wall with a round roof on it
			var cy: float = c.gy + 1.3
			var ddy := it.pos.y - cy
			var d3 := sqrt(d * d + maxf(0, ddy) * maxf(0, ddy))
			var r3: float = c.dome + it.r
			if ddy > 0:
				if d3 >= r3 or d3 < 0.001:
					continue
				var ax := dx / d3
				var ay := ddy / d3
				var az := dz / d3
				var v3 := it.vel.x * ax + it.vel.y * ay + it.vel.z * az
				it.pos = Vector3(c.x + ax * r3, cy + ay * r3, c.z + az * r3)
				if v3 < 0:
					it.vel -= Vector3(ax, ay, az) * 1.4 * v3
					it.spin *= 0.7
					if -v3 > 1.5:
						_bounce(it, -v3)
				return c
			top = cy
		if it.pos.y - it.r >= top:
			continue                              # it is flying over the top
		var nx := dx / d if d > 0.001 else 1.0
		var nz := dz / d if d > 0.001 else 0.0
		if py - it.r >= top - 0.15:               # it came down on top: a small bounce, then it rolls off the edge
			var hit := absf(it.vel.y)
			it.pos.y = top + it.r
			it.vel.y = hit * 0.3 if hit > 1.4 else 0.0
			it.vel.x = it.vel.x * 0.6 + nx * 1.7 - nz * 0.8
			it.vel.z = it.vel.z * 0.6 + nz * 1.7 + nx * 0.8      # outward, and a little sideways so it cannot get caught between two things
			if hit > 1.4:
				_bounce(it, hit)
		else:                                     # it hit the side: it bounces back
			it.pos.x = c.x + nx * mn
			it.pos.z = c.z + nz * mn
			var vn := it.vel.x * nx + it.vel.z * nz
			if vn < 0:
				it.vel.x -= 1.45 * vn * nx
				it.vel.z -= 1.45 * vn * nz
				it.spin *= 0.6
				if -vn > 1.5:
					_bounce(it, -vn)
		return c
	# the rover: the cab is taller than the cargo bed
	var rdx := it.pos.x - rover.pos.x
	var rdz := it.pos.z - rover.pos.z
	if absf(rdx) < 4 and absf(rdz) < 4:
		var front := rdx * sin(rover.yaw) + rdz * cos(rover.yaw) > 0.2
		var rtop := rover.pos.y + (2.3 if front else 1.3)
		if it.pos.y - it.r < rtop:
			if py - it.r >= rtop - 0.15:
				rover_push(it.pos, it.r * 0.5)
				if _pushed:
					var hit: float = absf(it.vel.y)
					it.pos.y = rtop + it.r
					it.vel.y = hit * 0.3 if hit > 1.4 else 0.0
					it.vel.x = it.vel.x * 0.6 + _hit_n.x * 1.7
					it.vel.z = it.vel.z * 0.6 + _hit_n.y * 1.7
					if hit > 1.4:
						_bounce(it, hit)
					return rover
			else:
				it.pos = rover_push(it.pos, it.r)
				if _pushed:
					var vn := it.vel.x * _hit_n.x + it.vel.z * _hit_n.y
					if vn < 0:
						it.vel.x -= 1.45 * vn * _hit_n.x
						it.vel.z -= 1.45 * vn * _hit_n.y
						it.spin *= 0.6
						if -vn > 1.5:
							_bounce(it, -vn)
					return rover
	# a fast throw knocks away a loose thing it lands on
	if it.vel.length_squared() > 9:
		for o in items:
			if o == it or o.state != "rest":
				continue
			if absf(o.pos.x - it.pos.x) > 1 or absf(o.pos.z - it.pos.z) > 1 or it.pos.distance_to(o.pos) > it.r + o.r:
				continue
			o.state = "fly"
			o.from = null
			o.spin = 3
			o.vel = it.vel * 0.5
			o.vel.y = maxf(1.4, o.vel.y)
			it.vel *= 0.45
			_bounce(it, 3)
			return o
	return null


## stay inside a round room and out of its furniture. room: { cx, cz, r, colliders: [{x, z, r}] }
static func room_keep(p: Vector3, rm: Dictionary, r: float) -> Vector3:
	var dx: float = p.x - rm.cx
	var dz: float = p.z - rm.cz
	var d := sqrt(dx * dx + dz * dz)
	var mx: float = rm.r - r
	if d > mx:
		p.x = rm.cx + dx / d * mx
		p.z = rm.cz + dz / d * mx
	for c in rm.get("colliders", []):
		var cx: float = p.x - c.x
		var cz: float = p.z - c.z
		var cd := sqrt(cx * cx + cz * cz)
		var mn: float = c.r + r
		if cd < mn and cd > 0.0001:
			p.x = c.x + cx / cd * mn
			p.z = c.z + cz / cd * mn
	return p


## false when p was outside the play area (it is moved back in)
var _in_bounds := true


func in_bounds(p: Vector3) -> Vector3:
	var r := sqrt(p.x * p.x + p.z * p.z)
	_in_bounds = r <= Terrain.PLAY_R
	if not _in_bounds:
		p.x *= Terrain.PLAY_R / r
		p.z *= Terrain.PLAY_R / r
	return p


func _update_astro(dt: float, input) -> void:
	var a := astro
	var ix := 0.0
	var iz := 0.0
	var jump := false
	var sprint := false
	a.group.visible = a.mode != "hidden"
	if a.mode == "hidden":
		return
	if a.mode == "sit":
		# on the lookout rock (the observe add-on moves him and sets sit_k / relax_k / look); while he walks up to the
		# rock the normal walking body is used, so his feet step instead of sliding
		a.group.position = a.pos
		a.group.rotation = Vector3(0, a.yaw, 0)
		a.drill.visible = false
		if a.sit_walk:
			pose(a, dt, a.sit_walk > 0.05, false, null)
		else:
			pose_rock(a, dt)
		a.tip_mat.emission_energy_multiplier = 1.2 + sin(World.time * 6)
		return
	if a.mode == "drive":
		a.pos = rover_local(0, 1.3, 0.25)
		a.yaw = rover.yaw
		a.last_yaw = rover.yaw
		a.group.position = a.pos
		a.group.rotation = Vector3(0, a.yaw, 0)
		a.drill.visible = false
		pose_seated(a)
		return
	if a.mode == "walk" and input:
		ix = input.x
		iz = input.z
		jump = input.jump
		sprint = input.sprint
	var len := sqrt(ix * ix + iz * iz)
	if len > 1:
		ix /= len
		iz /= len
		len = 1
	var v1 := World.forward()
	var mx := -v1.z * ix - v1.x * iz
	var mz := v1.x * ix - v1.z * iz          # camera-relative: right*ix + back*iz
	var speed := (8.8 if sprint else 5.8) * (0.93 if a.carrying else 1.0)
	var k := minf(1, dt * (11.0 * (grip if room == null else 1.0) if a.on_ground else 1.6))
	a.vel.x += (mx * speed - a.vel.x) * k
	a.vel.z += (mz * speed - a.vel.z) * k
	a.pos.x += a.vel.x * dt
	a.pos.z += a.vel.z * dt
	a.moved += Vector2(a.vel.x, a.vel.z).length() * dt
	if room != null:
		a.pos = room_keep(a.pos, room, 0.42)
	else:
		a.pos = in_bounds(a.pos)
		if not _in_bounds and on_edge.is_valid():
			on_edge.call()
		a.pos = collide_circle(a.pos, 0.5)
		if _last_hit != null:
			a.pos = collide_circle(a.pos, 0.5)
		if not rover.driver:
			a.pos = rover_push(a.pos, 0.42)
		for cm in crew:              # crewmates: you cannot walk through each other
			if not cm.solid or (cm.mode != "walk" and cm.mode != "busy"):
				continue
			var cx: float = a.pos.x - cm.pos.x
			var cz: float = a.pos.z - cm.pos.z
			var cd := sqrt(cx * cx + cz * cz)
			if cd < 0.85 and cd > 0.0001 and absf(a.pos.y - cm.pos.y) < 1.6:
				a.pos.x = cm.pos.x + cx / cd * 0.85
				a.pos.z = cm.pos.z + cz / cd * 0.85
	var ground: float = room.floor if room != null else ground_at(a.pos.x, a.pos.z)
	var landed := false
	if a.on_ground:
		if a.pos.y - ground > 0.35:
			a.on_ground = false
		else:
			a.pos.y = ground
		if jump:
			a.vy = 3.7
			a.on_ground = false
			a.air_t = 0
			a.run_jump = 1 if Vector2(a.vel.x, a.vel.z).length() > 2.5 else 0
			a.lead = -1 if fmod(a.cyc, 1.0) >= 0.5 else 1       # the leg that was swinging forward leads the leap
			if on_jump.is_valid():
				on_jump.call()
	if not a.on_ground:
		a.vy -= grav * dt
		if fall > 0 and room == null:
			a.vy = maxf(a.vy, -fall)
		a.pos.y += a.vy * dt
		if a.pos.y <= ground:
			var hit := -a.vy
			landed = hit > 1.2
			a.pos.y = ground
			a.vy = 0
			a.on_ground = true
			if landed:
				a.land_t = 0
				a.land_k = clampf(hit / 4.5, 0.3, 1) * (0.7 if a.run_jump else 1.0)
		if room != null and room.get("ceil") is Callable:     # a low-gravity jump indoors ends at the ceiling
			var top: float = room.ceil.call(a.pos.x, a.pos.z)
			if a.pos.y > top:
				a.pos.y = top
				if a.vy > 0:
					a.vy = -0.4
					if on_bonk.is_valid():
						on_bonk.call()
	if landed and on_land.is_valid():
		on_land.call(false)
	if a.aim or a.fp:
		a.yaw = angle_lerp(a.yaw, atan2(v1.x, v1.z), minf(1, dt * 14))     # in first person the body faces where you look
	elif len > 0.1:
		a.yaw = angle_lerp(a.yaw, atan2(mx, mz), minf(1, dt * 12))
	if a.spin > 0:
		a.spin -= dt
		a.yaw += dt * 9
	a.throw_t = maxf(0, a.throw_t - dt)
	a.drill.visible = a.mode == "busy"
	if a.mode == "busy":
		a.bit.rotation.y += dt * 30
	pose(a, dt, len > 0.1 and a.mode == "walk", sprint, room)
	a.group.position = a.pos
	a.tip_mat.emission_energy_multiplier = 1.2 + sin(World.time * 6)


# ---------- how the astronaut moves his body ----------
# All in the model's own units. Each foot has a target: planted on the ground while it carries him (it rolls from heel or
# forefoot to toes), or lifted on an arc while it swings forward. The hip and knee angles that reach the target come from
# two-bone IK, so the feet do not skate, the knees bend by themselves and the hips rise and fall like a real walker's. How
# long a foot stays down follows from his speed and how far a leg can reach; the rest of each step is a free flight that
# lasts as long as the real Moon or Mars gravity makes it. The arms swing against the legs, the shoulders turn against
# the hips, and the body leans into speed, into turns and after a landing.
const GAIT := [      # 0: walk, 1: lope (his normal pace on the Moon and Mars), 2: sprint
	{ "cad": 0.0, "duty": 0.62, "crouch": 0.015, "bob": 0.022, "lift": 0.07, "kick": 0.0, "reach": 0.02, "strike": -0.28, "roll": 0.55, "push": 0.75, "zOff": 0.0, "lean": 0.035,
		"arm": 0.3, "elbow": -0.3, "pump": 0.1, "yaw": 0.07, "sway": 0.022, "tilt": 0.035 },
	{ "cad": 1.7, "duty": 0.36, "crouch": 0.05, "bob": 0.0, "lift": 0.15, "kick": 0.12, "reach": 0.06, "strike": -0.06, "roll": 0.35, "push": 0.95, "zOff": -0.03, "lean": 0.09,
		"arm": 0.5, "elbow": -0.95, "pump": 0.25, "yaw": 0.09, "sway": 0.012, "tilt": 0.02 },
	{ "cad": 1.55, "duty": 0.3, "crouch": 0.085, "bob": 0.0, "lift": 0.24, "kick": 0.26, "reach": 0.1, "strike": 0.08, "roll": 0.3, "push": 1.05, "zOff": -0.05, "lean": 0.24,
		"arm": 0.95, "elbow": -1.45, "pump": 0.3, "yaw": 0.12, "sway": 0.008, "tilt": 0.015 }
]
var G := {}


func _gait_at(s: float) -> void:
	var i := 1 if s >= 1 else 0
	var t := clampf(s - i, 0, 1)
	var a0: Dictionary = GAIT[i]
	var a1: Dictionary = GAIT[i + 1]
	for k in a0:
		G[k] = lerpf(a0[k], a1[k], t)


## A planted foot at roll stage u (0 = touch-down, 1 = push-off) whose ankle would be at z when flat:
## returns Vector3(z, y, p): the ankle (forward of the hip, above the ground) and the foot's pitch (+ = toes down)
func _planted_foot(z: float, u: float) -> Vector3:
	var p: float = G.strike * (1 - u / 0.15) if u < 0.15 else (G.push * pow((u - G.roll) / (1 - G.roll), 1.6) if u > G.roll else 0.0)
	var px: float = RIG.heel if p < 0 else RIG.toe         # it rocks on the heel or on the toes
	var c := cos(p)
	var s := sin(p)
	var dz := -px
	return Vector3(z + px + ANK * s + dz * c, ANK * c - dz * s, p)


## one foot at leg phase ph of the stride cycle (stance first, then swing); D = how far the foot travels while planted.
## Returns { z, y, p, down }
func _foot_at(ph: float, D: float, duty: float) -> Dictionary:
	if ph < duty:
		var u := ph / duty
		var pf := _planted_foot(D * (0.5 - u) + G.zOff, u)
		return { "z": pf.x, "y": pf.y, "p": pf.z, "down": true }
	var s := (ph - duty) / (1 - duty)
	var e := smooth01(s)
	var kick_t := sin(PI * minf(1, s / 0.6))
	var f0 := _planted_foot(-D * 0.5 + G.zOff, 1)
	var f1 := _planted_foot(D * 0.5 + G.zOff, 0)
	return {
		"z": lerpf(f0.x, f1.x, e) - G.kick * 0.5 * kick_t + G.reach * sin(PI * clampf((s - 0.35) / 0.65, 0, 1)),
		"y": lerpf(f0.y, f1.y, s) + G.lift * pow(sin(PI * s), 0.8) + G.kick * kick_t,     # the heel kicks up behind, then the knee drives forward
		"p": lerpf(f0.z, f1.z, e) + G.kick * 1.4 * sin(PI * minf(1, s / 0.5)),
		"down": false }


## two-bone IK in the leg's side plane: the ankle target (z forward, y up) seen from the hip joint. Angles are rotation.x
## values: 0 = straight down, negative = forward. The knee always bends forward. Returns Vector2(hip, knee).
static func _leg_ik(z: float, y: float) -> Vector2:
	var d := sqrt(z * z + y * y)
	var mx := (L1 + L2) * 0.999
	var mn := 0.2
	if d > mx:
		z *= mx / d
		y *= mx / d
		d = mx
	elif d < mn:
		z *= mn / d
		y *= mn / d
		d = mn
	var phi := atan2(-z, -y)
	var a := acos(clampf((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
	var b := acos(clampf((L2 * L2 + d * d - L1 * L1) / (2 * L2 * d), -1, 1))
	return Vector2(phi - a, a + b)


func pose(a: Astro, dt: float, moving: bool, sprint: bool, rm) -> void:
	var S: float = RIG.scale
	var t := World.time
	var gm := grav / S
	var k6 := minf(1, dt * 6)
	var busy := a.mode == "busy"
	var v := Vector2(a.vel.x, a.vel.z).length() / S
	if dt > 0:
		a.accel = lerpf(a.accel, (v - a.spd) / dt, k6)
	a.spd = v
	# which gait: walk when slow, a light low-gravity lope at the normal pace, a long bounding run when sprinting
	var want := clampf((v - 1.2) / 5.7, 0, 1) * 0.6
	if sprint and moving:
		want = maxf(want, 0.6 + clampf((v - 6.9) / 3.6, 0, 1) * 1.4)
	a.gait = lerpf(a.gait, want, minf(1, dt * 4))
	_gait_at(a.gait)
	var mv := smooth01((v - 0.12) / 0.9)
	if mv > 0.02 and a.move <= 0.02 and a.on_ground:
		a.cyc = G.duty + 0.02          # set off with the left foot
	a.move = 0.0 if busy else mv
	var gf := clampf(sqrt(grav / 3.71), 0.62, 1.2)            # lower gravity: slower, floatier strides
	var cad: float = (1 - minf(a.gait, 1)) * clampf(v / 0.95, 0.6, 1.6) + G.cad * gf
	var D: float = minf(0.62, v * G.duty / cad)
	var duty: float = clampf(D * cad / v, 0.12, G.duty) if v > 0.05 else G.duty
	if a.on_ground and a.move > 0.01:
		a.cyc = fmod(a.cyc + cad * dt, 1.0)
	# ---- in the air
	if not a.on_ground:
		a.air_t += dt
	else:
		a.air_t = 0
	a.air = lerpf(a.air, 1.0 if not a.on_ground and (a.vy > 0 or a.air_t > 0.08) else 0.0, minf(1, dt * 14))
	var kv := clampf(a.vy / 3.7, -1.2, 1)
	var up := clampf(kv, 0, 1)
	var down := clampf(-kv / 0.7, 0, 1)
	var tuck := clampf(1 - absf(kv - 0.25) / 0.85, 0, 1)
	var push := clampf((kv - 0.8) / 0.2, 0, 1)
	# ---- the hips: height above the ground
	var cyc2 := TAU * a.cyc
	var mw := a.move * (1 - a.air)
	var bob_w: float = G.bob * cos(2 * cyc2 - PI * duty)               # walking: highest over the planted foot
	var sig := minf(0.98, 2 * duty)
	var Ts := 0.5 / cad
	var psi := fmod(2 * a.cyc, 1.0)
	var Tf := (1 - sig) * Ts
	var vz := gm * Tf / 2
	var bob_r: float
	if psi < sig:
		bob_r = -maxf(vz * sig * Ts / PI, 0.012 + 0.02 * a.gait) * sin(PI * psi / sig)       # running: a spring...
	else:
		var tt := (psi - sig) * Ts
		bob_r = vz * tt - gm * tt * tt / 2                                             # ...then a free flight
	var hip_h := lerpf(RIG.hipY - 0.018 + 0.004 * sin(t * 1.7), RIG.hipY - G.crouch + lerpf(bob_w, bob_r, clampf((0.55 - duty) / 0.13, 0, 1)), a.move)
	if busy:
		hip_h = RIG.hipY - 0.07
	a.land_t += dt
	var dip := 0.0
	if a.land_t < 1:
		dip = a.land_k * 0.17 * (sin(a.land_t / 0.1 * PI / 2) if a.land_t < 0.1 else exp(-(a.land_t - 0.1) * 7))
	hip_h -= dip
	# ---- the feet on the ground (standing feet sit a little apart; a drilling stance is wider and staggered)
	var sy := sin(a.yaw)
	var cy := cos(a.yaw)
	var FT := []
	for i in 2:
		var f := _foot_at(fmod(a.cyc + i * 0.5, 1.0), D, duty)
		var iz := (-0.12 if i else 0.1) if busy else (-0.02 if i else 0.02)
		f.z = lerpf(iz, f.z, a.move)
		f.y = lerpf(ANK, f.y, a.move)
		f.p = lerpf(0, f.p, a.move)
		f.down = f.down or a.move < 0.6
		# follow the ground under each foot
		var side: float = (1 if i else -1) * RIG.hipX * S
		var fx: float = a.pos.x + sy * f.z * S + cy * side
		var fz: float = a.pos.z + cy * f.z * S - sy * side
		f.g = 0.0 if (rm != null or not a.on_ground) else clampf((ground_at(fx, fz) - a.pos.y) / S, -0.3, 0.3)
		if f.down and a.on_ground:
			hip_h = minf(hip_h, f.y + f.g + sqrt(maxf(0, 0.7 * 0.7 - f.z * f.z)))       # a planted foot must stay reachable
		# a footstep the moment a foot comes down
		var ph := fmod(a.cyc + i * 0.5, 1.0)
		if ph < a.leg_ph[i] and a.on_ground and a.move > 0.4 and on_step.is_valid():
			var fs: float = (D * 0.5 + G.zOff) * S
			on_step.call(Vector3(a.pos.x + sy * fs, a.pos.y, a.pos.z + cy * fs), a.yaw, 1 if i else -1, sprint, a)
		a.leg_ph[i] = ph
		FT.append(f)
	hip_h = lerpf(hip_h, RIG.hipY - 0.03, a.air)
	# ---- hips and body: twist, sway, tilt, lean, bank into turns
	var p_yaw: float = G.yaw * cos(cyc2) * mw
	var sway: float = -G.sway * cos(cyc2 - PI * duty) * mw + 0.01 * sin(t * 0.45) * (1 - a.move)
	var tilt: float = -G.tilt * cos(cyc2 - PI * duty) * mw
	a.hips.position = Vector3(sway, hip_h, 0)
	a.hips.rotation = Vector3(0, p_yaw, tilt)
	a.head_y = (hip_h - RIG.hipY) * S
	var turn := angle_lerp(0, a.yaw - a.last_yaw, 1) / dt if dt > 0 else 0.0
	a.last_yaw = a.yaw
	a.bank = lerpf(a.bank, 0.0 if (a.spin > 0 or a.fp) else clampf(-turn * v * S * 0.03, -0.22, 0.22) * (1 - a.air), k6)
	a.group.rotation = Vector3(0, a.yaw, a.bank)
	var lean: float = lerpf(0.015 + 0.01 * sin(t * 1.7), G.lean, a.move) + clampf(a.accel * 0.012, -0.1, 0.14) * (1 - a.air) + dip * 1.1
	lean += a.air * ((0.12 - 0.1 * up) if a.run_jump else (-0.06 * up + 0.1 * down))
	# ---- the legs: planted/swinging targets, or the shapes of a jump, then IK
	var legs := [[a.leg_l, a.shin_l, a.foot_l], [a.leg_r, a.shin_r, a.foot_r]]
	for i in 2:
		var f: Dictionary = FT[i]
		var sx := 1 if i else -1
		var hx: float = sx * RIG.hipX
		var pz: float = f.z + hx * sin(p_yaw)
		var py: float = f.y + f.g - hip_h
		var pp: float = f.p
		if a.air > 0.001:
			var az: float
			var ay: float
			var ap: float
			if a.run_jump:
				var ld := sx == a.lead
				az = (0.3 - down * 0.2) if ld else (-0.3 + down * 0.42)
				ay = (-0.6 - down * 0.18) if ld else (-0.62 - down * 0.16)
				ap = -0.05 if ld else (0.7 - down * 0.72)
			else:
				az = 0.04 + tuck * (0.08 if i else 0.15) + down * 0.06
				ay = -0.8 + tuck * 0.28 - push * 0.05
				ap = 0.3 + push * 0.4 - down * 0.45
			pz = lerpf(pz, az, a.air)
			py = lerpf(py, ay, a.air)
			pp = lerpf(pp, ap, a.air)
		var ik := _leg_ik(pz, py)
		var spl := sx * (0.08 if busy else 0.03) - tilt - sway / 0.72
		legs[i][0].rotation = Vector3(ik.x, -p_yaw, spl)
		legs[i][1].rotation = Vector3(ik.y, 0, 0)
		legs[i][2].rotation = Vector3(pp - ik.x - ik.y, 0, -spl * 0.8)
	# ---- the arms: swing against the legs (elbows bend more the faster he goes), or hold, aim, throw, drill
	var sw: float = cos(cyc2) * G.arm * mw
	var arms := [[a.arm_l, a.fore_l, a.hand_l], [a.arm_r, a.fore_r, a.hand_r]]
	for i in 2:
		var sg := -1 if i else 1
		var out := 1 if i else -1                 # sg: + = this arm swings back when the left foot is forward
		var ax: float = -0.06 + sg * sw
		var el: float = lerpf(-0.2, G.elbow, a.move) - G.pump * mw * (1 - sg * cos(cyc2)) / 2
		var azr := out * (0.2 + 0.06 * a.gait)
		var hand := -0.15
		ax += 0.015 * sin(t * 1.7) * (1 - a.move)
		if a.air > 0.001:
			var bx: float
			var bz: float
			var be: float
			if a.run_jump:
				var fwd := (1 if i else -1) != a.lead
				bx = (-1.5 + down * 0.6) if fwd else (0.55 - down * 0.4)
				be = -0.9
				bz = out * (0.3 + 0.4 * down)
			else:
				bx = lerpf(-0.35, -2.15, up) * (1 - down) + down * -0.55
				be = -0.35 - 0.35 * tuck
				bz = out * (0.3 + 0.85 * down)
			ax = lerpf(ax, bx, a.air)
			el = lerpf(el, be, a.air)
			azr = lerpf(azr, bz, a.air)
		ax -= dip * 1.6
		el -= dip * 0.8
		if busy:
			ax = -0.95 + sin(t * 40) * 0.04
			el = -0.7
			azr = -out * 0.3
			hand = -0.3
		elif a.throw_t > 0:
			var kk := a.throw_t / 0.35
			ax = -0.35 - 2.3 * kk
			el = -0.9 * kk
			azr = -out * 0.2
			hand = -0.4 * kk
		elif a.carrying:
			ax = -2.05 if a.aim else -1.0
			el = -0.5 if a.aim else -0.55
			azr = -out * 0.28
			hand = -0.35
		arms[i][0].rotation = Vector3(ax, 0, azr)
		arms[i][1].rotation = Vector3(el, 0, 0)
		arms[i][2].rotation = Vector3(hand, 0, 0)
	if busy:
		lean = 0.2
	elif a.throw_t > 0:
		lean = 0.22 * sin(PI * (1 - a.throw_t / 0.35)) + 0.05
	elif a.carrying and a.aim:
		lean = -0.12
	a.body.rotation = Vector3(lean, -p_yaw * 1.6, -tilt * 0.85)
	_skin(a)


## sitting in the rover: thighs on the seat, shins down, hands toward the wheel
func pose_seated(a: Astro) -> void:
	a.hips.position = Vector3(0, 0.49 / RIG.scale, 0)       # the hips 0.49 m above the seat point, on the cushion
	a.hips.rotation = Vector3.ZERO
	a.head_y = 0
	a.air = 0
	a.move = 0
	a.bank = 0
	a.leg_l.rotation = Vector3(-1.5, 0, -0.06)
	a.leg_r.rotation = Vector3(-1.5, 0, 0.06)
	a.shin_l.rotation = Vector3(1.42, 0, 0)
	a.shin_r.rotation = Vector3(1.42, 0, 0)
	a.foot_l.rotation = Vector3(0.08, 0, 0)
	a.foot_r.rotation = Vector3(0.08, 0, 0)
	a.body.rotation = Vector3(0.04, 0, 0)
	a.arm_l.rotation = Vector3(-1.05, 0, 0.12)
	a.arm_r.rotation = Vector3(-1.05, 0, -0.12)
	a.fore_l.rotation = Vector3(-0.45, 0, 0)
	a.fore_r.rotation = Vector3(-0.45, 0, 0)
	a.hand_l.rotation = Vector3(-0.2, 0, 0)
	a.hand_r.rotation = Vector3(-0.2, 0, 0)
	_skin(a)


## Sitting on a rock: sit_k 0 = standing, 1 = seated (thighs forward, shins hanging); relax_k leans him back on his
## hands; look (radians) turns his shoulders and helmet a little toward where the player is looking. He breathes.
func pose_rock(a: Astro, _dt: float) -> void:
	var k := a.sit_k
	var r := a.relax_k
	var br := sin(World.time * 1.45) * (0.4 + 0.6 * k)
	var lk := clampf(a.look, -0.5, 0.5)
	a.head_y = 0
	a.air = 0
	a.move = 0
	a.bank = 0
	a.hips.position = Vector3(0, RIG.hipY, 0)
	a.hips.rotation = Vector3.ZERO
	a.leg_l.rotation = Vector3(lerpf(0, -1.32, k), 0, -0.1 * k)
	a.leg_r.rotation = Vector3(lerpf(0, -1.26, k), 0, 0.12 * k)
	a.shin_l.rotation = Vector3(lerpf(0, 1.22, k), 0, 0)
	a.shin_r.rotation = Vector3(lerpf(0, 1.08, k), 0, 0)
	a.foot_l.rotation = Vector3(0.12 * k, 0, 0.05 * k)
	a.foot_r.rotation = Vector3(0.2 * k, 0, -0.05 * k)
	a.body.rotation = Vector3(lerpf(0.06 * k, -0.15, r) + br * 0.012, lk * 0.55, 0)
	for i in 2:
		var out := 1 if i else -1
		var arm: Node3D = a.arm_r if i else a.arm_l
		var fore: Node3D = a.fore_r if i else a.fore_l
		var hand: Node3D = a.hand_r if i else a.hand_l
		# standing: arms down; sitting: hands on the knees; relaxed: leaning back on the hands, palms on the rock
		var ax := lerpf(lerpf(-0.06, -0.62, k), 0.62, r)
		var el := lerpf(lerpf(-0.2, -0.55, k), -0.12, r)
		var az := out * lerpf(lerpf(0.2, 0.12, k), 0.34, r)
		arm.rotation = Vector3(ax + br * 0.01, 0, az)
		fore.rotation = Vector3(el, 0, 0)
		hand.rotation = Vector3(lerpf(-0.15, 0.7, r), 0, 0)
	_skin(a)


# ---------- the rover ----------
func _rover_knock(r: Rover, s: float, c: float) -> void:
	for loose in items:
		if loose.state != "rest" or absf(loose.pos.x - r.pos.x) > 4 or absf(loose.pos.z - r.pos.z) > 4 or loose.pos.y - r.pos.y > 2:
			continue
		loose.pos = rover_push(loose.pos, loose.r)
		if not _pushed:
			continue
		loose.state = "fly"
		loose.from = null
		loose.spin = 4
		loose.vel = Vector3(s * r.speed * 0.9 + _hit_n.x * 2, 2.2, c * r.speed * 0.9 + _hit_n.y * 2)
		_bounce(loose, 3)


func _rover_show(r: Rover, dt: float, steer: float, lit: bool) -> void:
	var s := sin(r.yaw)
	var c := cos(r.yaw)
	r.group.position = r.pos - Vector3(0, r.sink, 0)
	r.group.rotation = Vector3(r.pitch + r.sink * 0.16, r.yaw, r.roll)      # yaw, then pitch, then roll (Godot's YXZ order)
	for i in r.wheels.size():
		r.wheels[i].rotation.x += r.speed * dt / 0.62
		if i >= 4:
			r.wheels[i].rotation.y = -steer * 0.35
	var mv := absf(r.speed)
	if r.on_ground and mv > 2:
		if randf() < dt * mv * 2.2:
			World.dust(r.pos.x - s * 2 + (randf() - 0.5) * 2, r.pos.z - c * 2 + (randf() - 0.5) * 2, 1, 1.5, 0.7)
		r.track_d += mv * dt
		if r.track_d > 1.1:
			r.track_d = 0
			World.print_at(r.pos.x - c * 1.25, r.pos.z + s * 1.25, r.yaw, 0.42, 1.2)
			World.print_at(r.pos.x + c * 1.25, r.pos.z - s * 1.25, r.yaw, 0.42, 1.2)
	var charged := not rover_charge.is_valid() or float(rover_charge.call()) > 0
	r.light.light_energy = lerpf(r.light.light_energy, (0.6 + World.env.dark * 2.4) * 4 if lit else 0.0, minf(1, dt * 4))
	r.ring_mat.emission_energy_multiplier = 0.6 if charged else 1 + sin(World.time * 6)
	Mats.set_color(r.ring_mat, 0x46ff8a if charged else 0xffd23f)


## Somebody else drives (crew mode): the rover goes where their game says (crew.gd sets pos, yaw, speed, pitch, roll),
## and here it only turns its wheels, kicks up dust, leaves tracks and, on the host, knocks loose things aside.
func _follow_rover(dt: float) -> void:
	var r := rover
	if knock_loose and absf(r.speed) > 1.5:
		_rover_knock(r, sin(r.yaw), cos(r.yaw))
	r.on_ground = true
	_rover_show(r, dt, r.steer, r.manned)


func _update_rover(dt: float, input) -> void:
	var r := rover
	if r.remote:
		_follow_rover(dt)
		return
	var thr := 0.0
	var steer := 0.0
	if r.driver and input:
		thr = -input.z
		steer = input.x
	var stuck: bool = rover_stuck.is_valid() and rover_stuck.call()
	if stuck:
		thr = 0
		r.speed *= maxf(0, 1 - dt * 6)
	r.sink = lerpf(r.sink, 0.5 if stuck else 0.0, minf(1, dt * 2))
	var charged := not rover_charge.is_valid() or float(rover_charge.call()) > 0
	var mx := (13.5 if charged else 3.0) if thr >= 0 else 5.0
	if thr != 0 and absf(r.speed) < mx:
		r.speed += thr * 9 * dt * (1.0 if r.on_ground else 0.2)
	r.speed -= r.speed * (1.6 if thr == 0 else 0.25) * dt
	if absf(r.speed) > mx:
		r.speed = lerpf(r.speed, signf(r.speed) * mx, minf(1, dt * 3))
	if r.on_ground:
		r.yaw -= steer * 1.7 * dt * clampf(r.speed / 4.5, -1, 1)
	var s := sin(r.yaw)
	var c := cos(r.yaw)
	r.pos.x += s * r.speed * dt
	r.pos.z += c * r.speed * dt
	r.pos = in_bounds(r.pos)
	if not _in_bounds:
		r.speed *= 0.5
	# What the rover hits stops it, and a fast hit throws it back. The rover is two circles, front and back.
	var hit = null
	var into := 0.0
	for e in [-1, 1]:
		var p0 := Vector3(r.pos.x + s * 1.1 * e, 0, r.pos.z + c * 1.1 * e)
		var p1 := collide_circle(p0, 1.4)
		if _last_hit == null:
			continue
		r.pos.x += p1.x - p0.x
		r.pos.z += p1.z - p0.z
		var vin := -(s * _hit_n.x + c * _hit_n.y) * r.speed       # how fast it was going INTO the thing
		if hit == null or vin > into:
			hit = _last_hit
			into = vin
	r.crash_t = maxf(0, r.crash_t - dt)
	if hit != null and into > 0:
		var share := clampf(into / maxf(0.01, absf(r.speed)), 0, 1)     # 1 = straight into it, 0 = sliding along it
		if into > Data.RULES.crashSoft and r.crash_t <= 0:
			var before := r.speed
			r.speed = -before * 0.35 * share + before * (1 - share) * 0.6     # head-on it bounces back; at an angle it scrapes past
			r.crash_t = 0.7
			r.pitch += 0.2 * (1.0 if before > 0 else -1.0) * minf(1, into / 9)
			if on_crash.is_valid():
				on_crash.call(into, hit, before)
		else:
			r.speed *= 1 - minf(0.9, share * dt * 9)
	# loose things lying in its way are knocked aside
	if absf(r.speed) > 1.5:
		_rover_knock(r, s, c)
	var gnd := ground_at(r.pos.x, r.pos.z)
	r.vy -= grav * dt
	r.pos.y += r.vy * dt
	if r.pos.y <= gnd:
		if not r.on_ground and r.vy < -3:
			World.dust(r.pos.x, r.pos.z, 14, 3.5, 0.8)
			if on_land.is_valid():
				on_land.call(true)
		r.vy = clampf((gnd - r.last_gnd) / maxf(dt, 0.001), 0, 8)
		r.pos.y = gnd
		r.on_ground = true
	else:
		r.on_ground = r.pos.y - gnd < 0.12
	r.last_gnd = gnd
	var hf := ground_at(r.pos.x + s * 1.8, r.pos.z + c * 1.8)
	var hb := ground_at(r.pos.x - s * 1.8, r.pos.z - c * 1.8)
	var hl := ground_at(r.pos.x - c * 1.2, r.pos.z + s * 1.2)
	var hr := ground_at(r.pos.x + c * 1.2, r.pos.z - s * 1.2)
	var k := minf(1, dt * (8.0 if r.on_ground else 1.5))
	r.pitch = lerpf(r.pitch, atan2(hb - hf, 3.6) if r.on_ground else r.pitch, k)
	r.roll = lerpf(r.roll, atan2(hr - hl, 2.4) if r.on_ground else r.roll, k)
	r.steer = steer
	_rover_show(r, dt, steer, r.driver)


func _update_items(dt: float) -> void:
	for it in items:
		it.age += dt
		if it.state == "held":
			var h: Astro = it.holder if it.holder else astro
			it.pos = hand_pos(h)
			if h.aim:
				it.pos.y += 0.12 if h.fp else 0.5
			it.mesh.rotation = Vector3(0, h.yaw, 0)
		elif it.state == "bed":
			var b: Array = BED[it.slot]
			it.pos = rover_local(b[0], b[1], b[2])
			it.mesh.rotation = Vector3(0, rover.yaw, 0)
		elif it.state == "fly":
			var py: float = it.pos.y
			it.vel.y -= grav * dt
			it.pos += it.vel * dt
			it.mesh.rotation.x += it.spin * dt
			it.mesh.rotation.z += it.spin * 0.6 * dt
			# it bounces off whatever stands in its way, unless it is dropping into the very place that takes it (skip_hit)
			if not (skip_hit.is_valid() and skip_hit.call(it)):
				_hit_things(it, py)
			var gnd: float = ground_at(it.pos.x, it.pos.z) + it.r
			if it.pos.y <= gnd:
				it.pos.y = gnd
				var hit: float = absf(it.vel.y)
				if hit > 1.1:
					it.vel.y = hit * 0.3
					it.vel.x *= 0.55
					it.vel.z *= 0.55
					it.spin *= 0.5
					_bounce(it, hit)
				else:
					it.state = "rest"
					it.vel = Vector3.ZERO
					it.from = null
					it.mesh.rotation = Vector3(0, it.mesh.rotation.y, 0)
			if Vector2(it.pos.x, it.pos.z).length() > Terrain.PLAY_R + 6:
				it.vel.x *= -0.4
				it.vel.z *= -0.4
				it.pos = in_bounds(it.pos)
		elif it.state == "fixed":
			it.mesh.rotation.y += dt * 0.8
		it.mesh.position = it.pos
		# helmet view: what you carry sits small in the corner of your eye instead of filling the visor
		if it.state == "held" and astro.fp and (it.holder if it.holder else astro) == astro:
			it.mesh.position += Vector3(-cos(astro.yaw) * 0.4, -0.14, sin(astro.yaw) * 0.4)
			if not it.small:
				it.small = true
				it.mesh.scale = Vector3.ONE * 0.5
		elif it.small:
			it.small = false
			it.mesh.scale = Vector3.ONE


## input: { x, z, jump, sprint } (or null)
func update(dt: float, input) -> void:
	if astro == null:
		return
	_update_rover(dt, input)
	_update_astro(dt, null if rover.driver else input)
	_update_items(dt)
	_update_devils(dt)
	# the helmet lamp
	if astro.mode != "hidden":
		World.set_lamp(astro.pos.x, astro.pos.y + 2.1, astro.pos.z, sin(astro.yaw), cos(astro.yaw))


# ---------- crewmates (crew mode) ----------
## A crewmate is a second astronaut in your world. Their own game moves them; here they are posed from what it sends:
## position, velocity, heading, on the ground or in the air, and what they are doing.
func add_crewmate(color: int) -> Astro:
	var p := build_astronaut(color)
	p.solid = true
	p.puppet = true
	crew.append(p)
	return p


func remove_crewmate(p: Astro) -> void:
	crew.erase(p)
	if p.carrying and p.carrying.holder == p:
		p.carrying.holder = null
		p.carrying = null
	if is_instance_valid(p.group):
		p.group.queue_free()


## moving: they push the stick; sprint: they run
func pose_crewmate(p: Astro, dt: float, moving: bool, sprint: bool) -> void:
	p.group.visible = p.mode != "hidden"
	if p.mode == "hidden":
		return
	if p.mode == "drive":
		p.pos = rover_local(0, 1.3, 0.25)
		p.yaw = rover.yaw
		p.last_yaw = rover.yaw
		p.group.position = p.pos
		p.group.rotation = Vector3(0, p.yaw, 0)
		p.drill.visible = false
		pose_seated(p)
		return
	if p.mode == "sit":
		p.group.position = p.pos
		p.group.rotation = Vector3(0, p.yaw, 0)
		p.drill.visible = false
		p.sit_k = minf(1, p.sit_k + dt * 2)
		p.relax_k = 0
		pose_rock(p, dt)
		return
	p.sit_k = 0
	if p.spin > 0:
		p.spin -= dt
	p.throw_t = maxf(0, p.throw_t - dt)
	p.drill.visible = p.mode == "busy"
	if p.mode == "busy":
		p.bit.rotation.y += dt * 30
	pose(p, dt, moving and p.mode == "walk", sprint, p.room)
	p.group.position = p.pos
	p.tip_mat.emission_energy_multiplier = 1.2 + sin(World.time * 6)


func enter_rover() -> void:
	rover.driver = true
	astro.mode = "drive"
	astro.vel = Vector3.ZERO


func exit_rover() -> void:
	rover.driver = false
	astro.mode = "walk"
	astro.pos = rover_spot("door")
	astro.pos.y = ground_at(astro.pos.x, astro.pos.z)
	astro.vy = 0
	astro.on_ground = true


# ---------- first-person view ----------
func eye() -> Vector3:
	var p := astro.group.position
	var s := sin(astro.yaw)
	var c := cos(astro.yaw)
	# lower when sitting in the rover; walking, the head rises and falls with the hips
	return Vector3(p.x + s * 0.12, p.y + (1.2 if astro.mode == "drive" else 1.7 + astro.head_y), p.z + c * 0.12)


## In first person your own helmet, chest and hips must not block the view, but they still have to throw a shadow:
## they are drawn as shadows only. Arms and legs stay visible.
func set_first_person(on: bool) -> void:
	fp = on
	if astro == null:
		return
	astro.fp = on
	var mode := GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if on else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for part in [astro.torso, astro.antenna, astro.tip]:
		(part as GeometryInstance3D).cast_shadow = mode


func focus() -> Vector3:
	if rover.driver:
		return Vector3(rover.pos.x, rover.pos.y + 2.4, rover.pos.z)
	return Vector3(astro.pos.x, astro.pos.y + 1.7, astro.pos.z)
