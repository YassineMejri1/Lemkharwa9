extends Node
## Pioneer mode: living off the land (a port of js/pioneer.js).
## A hard mode with a gather-and-build loop. Break the boulders on the map with your rock hammer, pick up the pieces
## (rubble, metal, glass sand), then build new machines anywhere on the ground.
##
## Real science used here:
## - "In-situ resource use": Moon and Mars rock is mostly oxygen, silicon, iron and aluminium, so a crew can make
##   things from the ground instead of flying everything from Earth.
## - Soil can be baked into bricks, and silicon makes solar cells and glass.
## What a rock gives and what a structure costs are invented for the game (Data.MATS, Data.BUILDS).
##
## This file only does the hands-on part: the swing, the flying pieces, the bag, the build menu, the see-through
## "ghost" you place, and the shapes of the structures. The rules live in Sim. Every hook is safe to call at any time.

const REACH := 2.2            # how close (metres from its side) you must be to hit a boulder
const WINDUP := 0.2           # seconds from the key press to the hammer landing
const HOLD := 0.09            # seconds the hammer stays on the rock when it lands
const RECOVER := 0.35         # seconds before you can swing again
const RING_T := 0.9           # seconds the timing ring takes to close
const SWEET := 0.66           # from this part of the ring's closing on, a hit counts double
const MAX_PIECES := 8         # pieces you see fly out of one boulder (extra units ride on them)
const PULL_R := 2.6           # pieces closer than this fly into your bag
const AHEAD := 3.2            # how far in front of you the ghost floats
const DOOR := Vector2(0, 10)
const DOOR_R := 12.0          # keep the way to the habitat door clear
const CLEAR := 0.6            # room to leave around other things
const BUMPY := 0.8            # how uneven the ground may be
const RIG_EVERY := 45.0       # a drill rig: seconds per ice chunk
const RIG_MAX := 2            # how many may wait beside it
const RIG_NEAR := 3.0
const TINT := { "rock": "#f0c9a6", "metal": "#cfd9ff", "glass": "#b8fff0" }
const SPARK := { "rock": 0xe0a070, "metal": 0xaebcff, "glass": 0x9ffff0 }

## How much ground each structure takes: rad = the footprint you place, cols = the circles that block walking
## (x, z, radius; in the structure's own directions), h = how tall it stands.
const SPEC := {
	"panel": { "rad": 1.7, "cols": [[0, 0, 1.0]], "h": 2.6 },
	"battery": { "rad": 1.75, "cols": [[-0.74, 0, 0.8], [0.74, 0, 0.8]], "h": 1.6 },
	"cistern": { "rad": 1.8, "cols": [[0, 0, 1.6]], "h": 2.3 },
	"berm": { "rad": 2.2, "cols": [[-1.52, -0.2, 0.52], [-0.5, -0.03, 0.52], [0.5, -0.03, 0.52], [1.52, -0.2, 0.52]], "h": 1.2, "thin": true },
	"rig": { "rad": 1.9, "cols": [[0, 0, 1.25]], "h": 3.4 },
	"turbine": { "rad": 1.3, "cols": [[0, 0, 0.85]], "h": 5.6 },
	"mirror": { "rad": 1.4, "cols": [[0, 0, 0.75]], "h": 7 },
	"filter": { "rad": 1.65, "cols": [[-0.52, 0, 0.72], [0.52, 0, 0.72]], "h": 2.2 },
	"other": { "rad": 1.2, "cols": [[0, 0, 0.95]], "h": 1.3 },
}

var root: Node3D = null
var site := "mars"
var S = null
var api := {}
var on := false
var M := {}                   # materials shared by everything drawn here
var GEO := {}
var rocks := {}
var live: Array = []
var swing = null
var cool := 0.0
var hold := 0.0
var hammer: Node3D = null
var ham_t := 0.0
var pieces: Array = []
var structs: Array = []
var place = null
var flags := {}
var synced = null
var last_s = null
var last_t = null
var stack := 0
var last_mode := ""
var _last_tick := 0
var _faces := {}              # mesh → its triangles, for the crack rays

# the bag chip and the timing ring (drawn over the 3D view)
var chip: PanelContainer = null
var chip_mats := {}
var chip_btn: Button = null
var chip_on := false
var chip_in = null
var chip_sig := ""
var ring: Control = null
var ring_on := false
var ring_k := -1
var ring_u := 0.0
var ring_sweet := false
var ring_hits := 0
var ring_need := 0
var _menu_doc = null


static func _clamp(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))


static func _ease(u: float) -> float:
	u = _clamp(u, 0, 1)
	return u * u * (3 - 2 * u)


## overshoots a little, then settles
static func _pop(u: float) -> float:
	u = _clamp(u, 0, 1) - 1
	return 1 + u * u * (2.7 * u + 1.7)


static func _rnd(a: float, b: float) -> float:
	return a + randf() * (b - a)


static func _wrap(a: float) -> float:
	return wrapf(a, -PI, PI)


static func _esc(t) -> String:
	return Html.esc(str(t if t != null else ""))


static func _lower_first(t: String) -> String:
	return t.substr(0, 1).to_lower() + t.substr(1) if t != "" else t


# the game's helpers (given to start) may be missing, so ask politely
func _tell(name: String, a = null, b = null, c = null):
	var f = api.get(name)
	if not (f is Callable) or not (f as Callable).is_valid():
		return null
	var args := []
	for x in [a, b, c]:
		if x == null:
			break
		args.append(x)
	return (f as Callable).callv(args)


func _sound(name: String, at = null, vol := 1.0) -> void:
	var o := { "vol": vol }
	if at != null:
		o.at = at
	_tell("sound", name, o)


func _astro():
	return Actors.astro


## How high the ground is where something rests (the game knows about floors)
static func _ground(x: float, z: float) -> float:
	return Actors.ground_at(x, z)


static func _driving() -> bool:
	return Actors.rover != null and Actors.rover.driver


func _rock_color() -> int:
	return 0x8a4a30 if site == "mars" else 0x8a8b95


func _dust_color() -> int:
	return 0xd9a070 if site == "mars" else 0xb8b9c4


# ---------- shapes and materials (made again for every new world) ----------
## a flat-shaded convex solid from its corners and faces (scaled to radius r)
static func _poly(verts: Array, faces: Array, r: float) -> ArrayMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	for f in faces:
		var a: Vector3 = (verts[f[0]] as Vector3).normalized() * r
		var b: Vector3 = (verts[f[1]] as Vector3).normalized() * r
		var c: Vector3 = (verts[f[2]] as Vector3).normalized() * r
		var nrm := (b - a).cross(c - a).normalized()
		if nrm.dot(a + b + c) < 0:
			nrm = -nrm
		if (b - a).cross(c - a).dot(nrm) > 0:         # Godot's front faces wind clockwise
			var t := b
			b = c
			c = t
		for p in [a, b, c]:
			v.append(p)
			n.append(nrm)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


static func _icosa(r: float) -> ArrayMesh:
	var t := (1 + sqrt(5.0)) / 2
	var V := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	var F := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	return _poly(V, F, r)


static func _octa(r: float) -> ArrayMesh:
	var V := [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0), Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]
	var F := [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2]]
	return _poly(V, F, r)


## a lumpy rock: an icosahedron with its corners pushed in and out a little
static func _lump(r: float) -> ArrayMesh:
	var t := (1 + sqrt(5.0)) / 2
	var V := [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	var F := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var k := [1.0, 0.86, 1.08, 0.92, 1.1, 0.88, 1.04, 0.9, 1.12, 0.95, 0.84, 1.06]
	for f in F:
		var p := []
		for i in 3:
			p.append((V[f[i]] as Vector3).normalized() * r * float(k[f[i]]))
		var nrm: Vector3 = (p[1] - p[0]).cross(p[2] - p[0]).normalized()
		if nrm.dot(p[0] + p[1] + p[2]) < 0:
			nrm = -nrm
		if (p[1] - p[0]).cross(p[2] - p[0]).dot(nrm) > 0:
			var tt = p[1]
			p[1] = p[2]
			p[2] = tt
		for q in p:
			v.append(q)
			n.append(nrm)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


static func _ring_mesh(r0: float, r1: float, seg: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	for i in seg:
		var a := TAU * i / seg
		var b := TAU * (i + 1) / seg
		var p := [Vector3(cos(a) * r0, 0, sin(a) * r0), Vector3(cos(a) * r1, 0, sin(a) * r1), Vector3(cos(b) * r1, 0, sin(b) * r1), Vector3(cos(b) * r0, 0, sin(b) * r0)]
		for k in [0, 2, 1, 0, 3, 2]:
			v.append(p[k])
			n.append(Vector3.UP)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


static func _metal(hex: int, metallic: float, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Mats.lin(hex)
	m.metallic = metallic
	m.roughness = rough
	return m


static func _emissive(hex: int, em: int, energy: float, rough := 0.4, metallic := 0.0) -> StandardMaterial3D:
	var m := _metal(hex, metallic, rough)
	m.emission_enabled = true
	m.emission = Mats.lin(em)
	m.emission_energy_multiplier = energy
	return m


func _make_kit() -> void:
	var mars := site == "mars"
	GEO = { "lump": _lump(0.27), "nugget": _icosa(0.24), "shard": _octa(0.26) }
	var brick := StandardMaterial3D.new()
	brick.vertex_color_use_as_albedo = true
	brick.vertex_color_is_srgb = true          # the colours are given like albedo colours (Mats.lin)
	brick.roughness = 0.9
	brick.metallic = 0.02
	var bars := []
	for i in 4:
		bars.append(_emissive(0x3a3214, 0xffd23f, 0.05))
	var sand := _emissive(0xeafff8, 0x7fe8d8, 0.6, 0.12, 0.1)
	sand.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sand.albedo_color.a = 0.92
	var rock := _emissive(0x55392b if mars else 0x4b4741, 0xff9a50, 0.08, 0.85)
	M = {
		"hull": Mats.soft(0xf2f3f7), "grey": Mats.soft(0xc3c7d2), "dark": Mats.soft(0x2b3147), "blue": Mats.soft(0x3d7dff), "teal": Mats.soft(0x3db8a0), "orange": Mats.soft(0xff8a3d),
		"metal": _metal(0xcfd3de, 0.8, 0.25),
		"soil": Mats.mat(0x9a4a2a if mars else 0x666772),
		"brick": brick,
		"solar": _emissive(0x14306b, 0x1b3f96, 0.4, 0.25, 0.5),
		"line": Mats.glow(0x6fa3ff, 0.9), "lamp": Mats.glow(0x46ff8a, 1.6), "red": Mats.glow(0xff5a5a, 2), "water": Mats.glow(0x4fd8ff, 1.3), "ice": Mats.glow(0x7fe8ff, 1.4),
		"mirror": Mats.glow(0xfff1c4, 1.0),
		"can": _emissive(0x8fe8d0, 0x3db8a0, 0.8, 0.5),
		"bars": bars,
		# the pieces a broken boulder leaves: grey-brown rubble, dark metal, pale glass sand
		"rock": rock,
		"ore": _emissive(0x3a4152, 0x3a55a8, 0.5, 0.3, 0.85),
		"sand": sand,
		"crack": Mats.unlit(0x0d0806),
		"ghost": Mats.unlit(0x4dff9a, 0.5),
		"edge": Mats.unlit(0x4dff9a, 0.9),
	}
	for k in ["ghost", "edge"]:
		(M[k] as StandardMaterial3D).render_priority = 3
		(M[k] as StandardMaterial3D).no_depth_test = false
	(M.crack as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED


## The lamps and glowing parts breathe together: one change per frame, however many structures there are.
func _glow_all(s) -> void:
	var t := World.time
	(M.lamp as StandardMaterial3D).emission_energy_multiplier = 1.2 + sin(t * 3) * 0.6
	(M.red as StandardMaterial3D).emission_energy_multiplier = 2.2 if sin(t * 4) > 0.3 else 0.3
	(M.can as StandardMaterial3D).emission_energy_multiplier = 0.7 + sin(t * 1.7) * 0.25
	(M.rock as StandardMaterial3D).emission_energy_multiplier = 0.08 + sin(t * 4) * 0.05
	(M.ore as StandardMaterial3D).emission_energy_multiplier = 0.5 + sin(t * 4 + 1) * 0.3
	(M.sand as StandardMaterial3D).emission_energy_multiplier = 0.6 + sin(t * 4 + 2) * 0.3
	# battery bars show how many charged cells wait on the Solar Rack
	var lit := 2 + sin(t * 0.5) * 1.6
	if s and s.get("rack") and (s.rack.get("cells") is float or s.rack.get("cells") is int):
		lit = _clamp(float(s.rack.cells) / maxf(1, Sim.rack_max(s)), 0, 1) * 4
	for i in 4:
		var m: StandardMaterial3D = M.bars[i]
		m.emission_energy_multiplier = 1.5 if lit >= i + 1 else (0.6 + sin(t * 5) * 0.4 if lit > i else 0.03)


static func _add(parent: Node3D, mesh: Mesh, mat: Material, x := 0.0, y := 0.0, z := 0.0, no_shadow := false) -> MeshInstance3D:
	var m := Mats.add(parent, mesh, mat, x, y, z, not no_shadow)
	m.rotation_order = EULER_ORDER_XYZ          # as three.js turns things
	return m


static func _cyl(rt: float, rb: float, h: float, seg := 12) -> CylinderMesh:
	return Mats.cyl(rt, rb, h, seg)


static func _box(w: float, h: float, d: float) -> BoxMesh:
	return Mats.box(w, h, d)


static func _ball(r: float) -> SphereMesh:
	return Mats.ball(r, 8, 6)


## A rod between two points (the legs of the drill rig).
static func _beam(parent: Node3D, mat: Material, a: Vector3, b: Vector3, r: float) -> MeshInstance3D:
	var d := b - a
	var m := _add(parent, _cyl(r, r, d.length(), 6), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
	m.quaternion = Quaternion(Vector3.UP, d.normalized())
	return m


## Many bricks baked into one mesh. list: [{ x, y, z, ry, color, sy (how tall, 1 = a whole brick) }]
static func _bricks(list: Array) -> ArrayMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var col := PackedColorArray()
	var hw := 0.235
	var hh := 0.14
	var hd := 0.21
	var FACES := [[Vector3.RIGHT, Vector3.UP, Vector3.BACK], [Vector3.LEFT, Vector3.UP, Vector3.FORWARD], [Vector3.UP, Vector3.BACK, Vector3.RIGHT],
		[Vector3.DOWN, Vector3.FORWARD, Vector3.RIGHT], [Vector3.BACK, Vector3.UP, Vector3.LEFT], [Vector3.FORWARD, Vector3.UP, Vector3.RIGHT]]
	for it in list:
		var q := Basis(Vector3.UP, float(it.ry))
		var c := Mats.lin(int(it.color))
		var sy := float(it.get("sy", 1.0))
		var o := Vector3(it.x, it.y, it.z)
		var half := Vector3(hw, hh * sy, hd)
		for f in FACES:
			var nn: Vector3 = f[0]
			var u: Vector3 = f[1]
			var w: Vector3 = f[2]
			var ctr := nn * half
			var du := u * half
			var dw := w * half
			var p := [ctr - du - dw, ctr + du - dw, ctr + du + dw, ctr - du + dw]
			var tris := [[0, 1, 2], [0, 2, 3]]
			for t in tris:
				var a: Vector3 = p[t[0]]
				var b: Vector3 = p[t[1]]
				var cc: Vector3 = p[t[2]]
				if (b - a).cross(cc - a).dot(nn) > 0:
					var tmp := b
					b = cc
					cc = tmp
				for pt in [a, b, cc]:
					v.append(q * pt + o)
					n.append(q * nn)
					col.append(c)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_COLOR] = col
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


# ---------- the structures ----------
# Each one is a few big parts. When it is built the parts rise out of the ground one after the other.
static func _sub(o: Dictionary) -> Node3D:
	var g := Node3D.new()
	g.rotation_order = EULER_ORDER_XYZ
	(o.g as Node3D).add_child(g)
	return g


## how much higher or lower the real ground is at a spot of the structure (used so the wall follows the ground)
static func _lift(o: Dictionary, lx: float, lz: float) -> float:
	var at = o.at
	if at == null:
		return 0.0
	var c := cos(float(at.yaw))
	var s := sin(float(at.yaw))
	return _ground(at.x + lx * c + lz * s, at.z - lx * s + lz * c) - at.y - 0.04


func _draw(id: String, o: Dictionary) -> void:
	match id:
		"panel":
			# a solar panel on a post; the panel turns to face the Sun
			var foot := _sub(o)
			var mast := _sub(o)
			var head := _sub(o)
			_add(foot, _cyl(0.72, 0.88, 0.24, 10), M.dark, 0, 0.12, 0)
			_add(foot, _box(0.5, 0.4, 0.44), M.grey, 0.62, 0.3, 0.3)
			_add(foot, _ball(0.08), M.lamp, 0.62, 0.55, 0.3, true)
			_add(mast, _cyl(0.1, 0.14, 2.1, 8), M.grey, 0, 1.25, 0)
			_add(mast, _cyl(0.2, 0.2, 0.22, 8), M.dark, 0, 2.3, 0)
			head.position.y = 2.42
			head.rotation_order = EULER_ORDER_YXZ
			head.rotation.x = 0.6
			_add(head, _box(3.3, 0.07, 1.9), M.hull, 0, 0, 0)
			_add(head, _box(3.12, 0.05, 1.72), M.solar, 0, 0.045, 0)
			for i in range(-1, 2):
				_add(head, _box(0.035, 0.02, 1.72), M.line, i * 0.78, 0.075, 0, true)
			_add(head, _box(3.12, 0.02, 0.035), M.line, 0, 0.075, 0, true)
			o.head = head
			o.follow = true
		"battery":
			# a battery bank: three cabinets with glowing level bars
			var base := _sub(o)
			var top := _sub(o)
			_add(base, _box(2.95, 0.18, 1.5), M.dark, 0, 0.09, 0)
			for i in 3:
				var c := _sub(o)
				c.position = Vector3(-0.94 + i * 0.94, 0.18, 0)
				_add(c, _box(0.82, 1.25, 1.1), M.hull, 0, 0.625, 0)
				_add(c, _box(0.86, 0.1, 1.14), M.dark, 0, 1.3, 0)
				_add(c, _box(0.6, 0.94, 0.04), M.dark, 0, 0.66, 0.56, true)
				for k in 4:
					_add(c, _box(0.46, 0.14, 0.05), M.bars[k], 0, 0.33 + k * 0.215, 0.585, true)
				_add(c, _cyl(0.07, 0.07, 0.14, 8), M.metal, -0.2, 1.42, 0, true)
				_add(c, _cyl(0.07, 0.07, 0.14, 8), M.metal, 0.2, 1.42, 0, true)
			_add(top, _box(2.5, 0.07, 0.1), M.orange, 0, 1.68, 0)                  # the bar that joins them
			_add(top, _ball(0.08), M.lamp, 1.3, 1.62, 0.5, true)
		"cistern":
			# a round water tank; the blue strip on the front shows how full it is
			var base := _sub(o)
			var tank := _sub(o)
			var lid := _sub(o)
			_add(base, _cyl(1.5, 1.62, 0.26, 16), M.dark, 0, 0.13, 0)
			_add(base, _cyl(0.08, 0.08, 0.9, 6), M.metal, 1.5, 0.45, 0.4, true)
			_add(base, _box(0.34, 0.12, 0.12), M.blue, 1.5, 0.92, 0.4, true)
			_add(tank, _cyl(1.36, 1.36, 1.46, 18), M.hull, 0, 0.99, 0)
			_add(tank, Mats.torus(1.37, 0.06, 24, 6), M.blue, 0, 0.5, 0, true)
			_add(tank, Mats.torus(1.37, 0.06, 24, 6), M.blue, 0, 1.5, 0, true)
			_add(tank, _box(0.4, 1.16, 0.1), M.dark, 0, 1.0, 1.34, true)
			o.level = _add(tank, _box(0.26, 1.04, 0.06), M.water, 0, 1.0, 1.385, true)
			_add(lid, _cyl(0.62, 1.36, 0.36, 18), M.grey, 0, 1.9, 0)
			_add(lid, _cyl(0.26, 0.26, 0.16, 10), M.dark, 0, 2.14, 0)
			_add(lid, _ball(0.08), M.lamp, 0.55, 2.02, 0.55, true)
		"berm":
			# a wall of baked-soil bricks: a gentle arc about 4 m long and 1.2 m high, laid row by row
			var tones := [0x8a4424, 0x6f3519, 0x9c5230] if site == "mars" else [0x6a6b76, 0x565762, 0x7b7c87]
			var row: Node3D = null
			for i in 4:
				var list := []
				var n := 8 - (i % 2)
				for k in n:
					var a := ((k + 0.5 + (i % 2) * 0.5) / 8.0 - 0.5) * 0.667
					var x := sin(a) * 6
					var z := (cos(a) - 1) * 6
					var dy := _lift(o, x, z)
					list.append({ "x": x, "y": 0.15 + i * 0.3 + dy, "z": z, "ry": a + _rnd(-0.03, 0.03), "color": tones[(i * 2 + k + (k % 3)) % 3] })
					if i == 0:
						list.append({ "x": x, "y": -0.15 + dy, "z": z, "ry": a, "color": tones[1] })          # a footing under the first row
					if i == 3:
						list.append({ "x": x, "y": 1.24 + dy, "z": z, "ry": a, "color": 0xdfe2ea, "sy": 0.3 })     # pale capstones on top
				row = _sub(o)
				_add(row, _bricks(list), M.brick, 0, 0, 0)
			_add(row, _ball(0.08), M.lamp, 1.86, 1.36 + _lift(o, 1.86, -0.3), -0.3, true)
		"rig":
			# an ice drill rig: a tripod over a spinning screw, with a tray where the ice comes out
			var feet := _sub(o)
			var legs := _sub(o)
			var motor := _sub(o)
			var drill := _sub(o)
			var tray := _sub(o)
			for i in 3:
				var a := PI / 6 + i * TAU / 3
				var fx := sin(a) * 1.25
				var fz := cos(a) * 1.25
				_add(feet, _cyl(0.26, 0.32, 0.12, 8), M.dark, fx, 0.06, fz)
				_beam(legs, M.grey, Vector3(fx, 0.1, fz), Vector3(sin(a) * 0.2, 3.0, cos(a) * 0.2), 0.065)
			_add(motor, _cyl(0.36, 0.36, 0.5, 10), M.hull, 0, 3.05, 0)
			_add(motor, _cyl(0.4, 0.4, 0.12, 10), M.orange, 0, 2.78, 0)
			_add(motor, _ball(0.09), M.lamp, 0, 3.38, 0, true)
			var auger := Node3D.new()
			drill.add_child(auger)
			o.auger = auger
			_add(auger, _cyl(0.07, 0.07, 2.7, 8), M.metal, 0, 1.4, 0)
			for i in 9:
				var f := _add(auger, _box(0.56, 0.05, 0.17), M.metal, 0, 0.22 + i * 0.26, 0)
				f.rotation = Vector3(0, i * 0.9, 0.26)
			_add(drill, Mats.torus(0.5, 0.07, 18, 6), M.ice, 0, 0.1, 0, true)
			_add(tray, _box(1.1, 0.08, 0.5), M.grey, 1.02, 0.5, 0).rotation.z = -0.42        # the chute
			_add(tray, _box(0.9, 0.1, 1.7), M.dark, 1.95, 0.05, 0)
			_add(tray, _box(0.08, 0.2, 1.7), M.ice, 2.4, 0.12, 0, true)
		"turbine":
			# a wind turbine (Mars): three blades that turn faster when the dust blows
			var base := _sub(o)
			var tower := _sub(o)
			var nac := _sub(o)
			_add(base, _cyl(0.7, 0.9, 0.3, 10), M.dark, 0, 0.15, 0)
			_add(base, _box(0.46, 0.5, 0.4), M.grey, 0.62, 0.42, 0)
			_add(base, _ball(0.08), M.lamp, 0.62, 0.72, 0, true)
			_add(tower, _cyl(0.11, 0.2, 5.0, 8), M.hull, 0, 2.8, 0)
			_add(tower, _cyl(0.21, 0.23, 0.26, 8), M.teal, 0, 1.0, 0)
			nac.position.y = 5.42
			nac.rotation_order = EULER_ORDER_YXZ
			_add(nac, _box(0.42, 0.42, 1.1), M.hull, 0, 0, 0)
			_add(nac, _box(0.44, 0.1, 0.5), M.teal, 0, 0.2, -0.2, true)
			_add(nac, _box(0.04, 0.56, 0.5), M.hull, 0, 0.14, -0.78)
			_add(nac, _ball(0.07), M.red, 0, 0.3, -0.4, true)
			var rotor := Node3D.new()
			rotor.position = Vector3(0, 0, 0.68)
			nac.add_child(rotor)
			o.rotor = rotor
			_add(rotor, Mats.cone(0.2, 0.36, 8), M.dark, 0, 0, 0.06).rotation.x = PI / 2
			for i in 3:
				var bl := Node3D.new()
				bl.rotation.z = i * TAU / 3
				rotor.add_child(bl)
				_add(bl, _box(0.27, 2.3, 0.05), M.hull, 0, 1.26, 0).rotation.y = 0.28
			o.nac = nac
		"mirror":
			# a Sun mirror (Moon): a tall mast that lifts a bright mirror out of the shadow
			var base := _sub(o)
			var mast := _sub(o)
			var head := _sub(o)
			_add(base, _cyl(0.42, 0.56, 0.4, 10), M.dark, 0, 0.2, 0)
			for i in 3:
				var a := i * TAU / 3
				_add(base, _box(0.2, 0.1, 1.2), M.grey, sin(a) * 0.7, 0.07, cos(a) * 0.7).rotation.y = a
			_add(base, _ball(0.08), M.lamp, 0.3, 0.5, 0.3, true)
			_add(mast, _cyl(0.09, 0.15, 6.3, 8), M.grey, 0, 3.5, 0)
			_add(mast, _cyl(0.17, 0.17, 0.16, 8), M.orange, 0, 2.2, 0)
			_add(mast, _cyl(0.15, 0.15, 0.16, 8), M.orange, 0, 4.4, 0)
			head.position.y = 6.75
			head.rotation_order = EULER_ORDER_YXZ
			head.rotation.x = 1.85
			_add(head, _cyl(1.35, 1.35, 0.07, 6), M.mirror, 0, 0.05, 0, true)
			for i in 3:
				_add(head, _box(2.66, 0.02, 0.035), M.dark, 0, 0.09, 0, true).rotation.y = PI / 6 + i * PI / 3     # the joints between its six segments
			_add(head, _cyl(1.46, 1.46, 0.07, 6), M.dark, 0, -0.02, 0)
			_add(head, _box(0.16, 0.3, 0.16), M.dark, 0, -0.18, 0)
			o.head = head
		"filter":
			# a spare CO2 filter bed: a box with three teal canisters, like the Air Scrubber on the airlock
			var skid := _sub(o)
			var body := _sub(o)
			var cans := _sub(o)
			_add(skid, _box(2.3, 0.14, 0.2), M.dark, 0, 0.07, 0.5)
			_add(skid, _box(2.3, 0.14, 0.2), M.dark, 0, 0.07, -0.5)
			_add(body, _box(2.1, 0.9, 1.3), M.grey, 0, 0.6, 0)
			_add(body, _box(2.16, 0.14, 1.36), M.teal, 0, 1.1, 0)
			_add(body, _box(0.6, 0.4, 0.06), M.dark, -0.55, 0.62, 0.66, true)
			_add(body, _ball(0.08), M.lamp, 0.75, 0.72, 0.68, true)
			for i in 3:
				_add(cans, _cyl(0.24, 0.24, 1.0, 12), M.can, -0.62 + i * 0.62, 1.67, 0.1)
				_add(cans, _cyl(0.26, 0.26, 0.1, 12), M.dark, -0.62 + i * 0.62, 2.2, 0.1, true)
			_add(cans, _box(1.7, 0.1, 0.1), M.metal, 0, 1.5, -0.3, true)
		_:
			# anything this file has no drawing for: a crate with an antenna
			var crate := _sub(o)
			var mast := _sub(o)
			_add(crate, _box(1.3, 1.1, 1.3), M.hull, 0, 0.55, 0)
			_add(crate, _box(1.36, 0.16, 1.36), M.orange, 0, 0.55, 0)
			_add(mast, _cyl(0.03, 0.03, 1.6, 6), M.grey, 0.4, 1.9, 0.4)
			_add(mast, _ball(0.1), M.lamp, 0.4, 2.74, 0.4, true)


## at: { x, y, z, yaw } where it will stand (null for the ghost)
func _shape(id: String, at = null) -> Dictionary:
	var g := Node3D.new()
	var o := { "id": id, "g": g, "spec": SPEC.get(id, SPEC.other), "at": at }
	if not o.spec.get("thin", false):
		_add(_sub(o), _cyl(o.spec.rad * 0.78, o.spec.rad * 0.9, 0.5, 14), M.soil, 0, -0.2, 0)      # a pad of packed soil, so it sits well on a slope
	_draw(id if SPEC.has(id) else "other", o)
	return o


## Put up the real thing where the ghost stood.
func _raise(id: String, x: float, z: float, yaw: float) -> Dictionary:
	var y := _ground(x, z)
	var o := _shape(id, { "x": x, "y": y, "z": z, "yaw": yaw })
	var sp: Dictionary = o.spec
	var cs := cos(yaw)
	var sn := sin(yaw)
	var g: Node3D = o.g
	var kids := g.get_children()
	var st := { "id": id, "o": o, "x": x, "y": y, "z": z, "yaw": yaw, "t": 0.0, "T": 0.55 + (kids.size() - 1) * 0.22, "kids": [], "cols": [],
		"spark": 0.0, "dig": 0.0, "puff": 0.0, "slot": 0, "full": false, "done": false }
	g.position = Vector3(x, y, z)
	g.rotation.y = yaw
	root.add_child(g)
	for i in kids.size():
		var k: Node3D = kids[i]
		st.kids.append({ "o": k, "y": k.position.y, "at": i * 0.22 })
		k.visible = false
	for c in sp.cols:
		var col := { "x": x + c[0] * cs + c[1] * sn, "z": z - c[0] * sn + c[1] * cs, "r": float(c[2]), "h": float(sp.h) }
		st.cols.append(col)
		Base.colliders.append(col)
	structs.append(st)
	World.dust(x, z, 14, 2.8, 0.7)
	_sound("plug", Vector3(x, y + 1, z))
	return st


func _step_structs(dt: float, s, pos) -> void:
	var sun: Vector3 = World.sun_dir
	var dusty: float = World.env.get("dustShown", 0.0)
	for st in structs:
		var o: Dictionary = st.o
		var sp: Dictionary = o.spec
		if not st.done:
			# being built: the parts rise and settle, with sparks
			st.t += dt
			for kd in st.kids:
				var u: float = (st.t - kd.at) / 0.55
				var n: Node3D = kd.o
				n.visible = u > 0
				n.position.y = kd.y - (1 - _ease(u)) * 1.5
				n.scale = Vector3.ONE * maxf(0.001, _pop(u))
			st.spark -= dt
			if st.spark <= 0:
				st.spark = 0.08
				World.burst(st.x + _rnd(-1, 1) * sp.rad * 0.6, st.y + _rnd(0.2, minf(sp.h, 2.6)), st.z + _rnd(-1, 1) * sp.rad * 0.6, 4, 3.2, 0xffd27a, { "life": 0.4, "size": 0.13, "grow": 0.5, "alpha": 1.0, "grav": World.gravity * 0.5 })
				if randf() < 0.3:
					World.dust(st.x + _rnd(-1, 1) * sp.rad, st.z + _rnd(-1, 1) * sp.rad, 2, 1.4, 0.5)
			if st.t >= st.T:
				_finish(st)
		if o.get("head"):                              # panels and mirrors follow the Sun
			var head: Node3D = o.head
			head.rotation.y += _wrap(atan2(sun.x, sun.z) - st.yaw - head.rotation.y) * minf(1, dt * 0.8)
			if o.get("follow"):
				head.rotation.x += (_clamp(PI / 2 - asin(_clamp(sun.y, -1, 1)), 0.3, 1.2) - head.rotation.x) * minf(1, dt * 0.8)
		if o.get("rotor"):                             # the wind turbine turns into the wind (it blows from the west) and spins
			(o.rotor as Node3D).rotation.z += dt * (1.3 + 9 * dusty)
			(o.nac as Node3D).rotation.y = -PI / 2 - st.yaw + sin(World.time * 0.25 + st.x) * 0.12
		if o.get("auger"):
			(o.auger as Node3D).rotation.y += dt * (1.0 if st.full else 7.0)
			st.puff -= dt
			if st.puff <= 0 and st.done and not st.full and pos != null and absf(pos.x - st.x) + absf(pos.z - st.z) < 90:
				st.puff = 0.3
				World.emit(st.x + _rnd(-0.3, 0.3), st.y + 0.3, st.z + _rnd(-0.3, 0.3), { "vx": _rnd(-0.3, 0.3), "vy": _rnd(1, 1.9), "vz": _rnd(-0.3, 0.3), "life": 1.7, "size": 0.5, "grow": 2.8, "color": 0xdff4ff, "alpha": 0.32, "grav": 0.0 })
		if o.get("level"):
			var f := 0.6
			if s and (s.get("water") is float or s.get("water") is int):
				f = _clamp(float(s.water) / maxf(1, Sim.water_cap(s)), 0.04, 1)
			var lv: Node3D = o.level
			lv.scale.y = f
			lv.position.y = 0.48 + 0.52 * f


func _finish(st: Dictionary) -> void:
	var def: Dictionary = Data.BUILDS.get(st.id, { "name": "structure", "text": "" })
	st.done = true
	for kd in st.kids:
		var n: Node3D = kd.o
		n.visible = true
		n.position.y = kd.y
		n.scale = Vector3.ONE
	World.burst(st.x, st.y + 0.4, st.z, 26, 5, 0x4dff9a, { "life": 0.7, "size": 0.2, "grow": 0.5, "alpha": 0.9, "up": 0.25, "grav": 0.0 })
	_sound("good")
	_tell("toast", "✔ " + str(def.name) + " built!", Vector3(st.x, st.y + minf(st.o.spec.h, 3) + 0.6, st.z), "#4dff9a")
	_tell("say", str(def.name) + " built! " + str(def.get("text", "")))
	if not flags.has("built"):
		flags.built = true
		_tell("why", "built")


# ---------- breaking boulders ----------
func _node_of(k: int) -> MeshInstance3D:
	if k < 0 or k >= World.boulder_nodes.size():
		return null
	var n = World.boulder_nodes[k]
	return n if is_instance_valid(n) else null


func _breakable(k: int) -> bool:
	if k < 0 or k >= Terrain.boulders.size():
		return false
	var b: Dictionary = Terrain.boulders[k]
	var m := _node_of(k)
	return not b.seat and m != null and m.visible and b.get("col") != null


func _rock_of(k: int) -> Dictionary:
	if rocks.has(k):
		return rocks[k]
	var b: Dictionary = Terrain.boulders[k]
	var m := _node_of(k)
	var r := { "hits": 0, "need": int(_clamp(roundf(1 + (b.r - 0.9) * 2), 2, 6)), "u": randf() * 0.4, "jolt": 0.0, "flash": 0.0, "shrink": 1.0, "dx": 0.0, "dz": 0.0,
		"mat": null, "tint": null, "gy": Terrain.height(b.x, b.z), "p": m.position, "s": m.scale, "rz": m.rotation.z }
	rocks[k] = r
	return r


## The rock hammer: it shows in your hands only while you swing.
func _get_hammer(a) -> Node3D:
	var hand: Node3D = a.hand_r if a else null
	if hand == null or not is_instance_valid(hand):
		return null
	if hammer and is_instance_valid(hammer) and hammer.get_parent() == hand:
		return hammer
	hammer = Node3D.new()
	hammer.rotation_order = EULER_ORDER_XYZ
	_add(hammer, _cyl(0.04, 0.04, 0.78, 6), M.dark, 0, 0, 0.38, true).rotation.x = PI / 2
	_add(hammer, _box(0.46, 0.17, 0.17), M.metal, 0, 0, 0.78, true)
	hammer.position = Vector3(0, -0.09, 0)          # gripped in the fist, head forward when the swing lands
	hammer.rotation.x = 2.0
	hammer.scale = Vector3.ONE * 0.84 / Actors.RIG.scale      # its size in metres, whatever the astronaut's scale
	hammer.visible = false
	hand.add_child(hammer)
	return hammer


func _swing_at(k: int) -> void:
	var a = _astro()
	if a == null or swing != null or cool > 0 or not _breakable(k):
		return
	var b: Dictionary = Terrain.boulders[k]
	var r := _rock_of(k)
	if not World.cam.get("fp", false):
		a.yaw = atan2(b.x - a.pos.x, b.z - a.pos.z)          # face the rock
	a.throw_t = 0.35                                          # the game's own two-arm swing
	swing = { "k": k, "t": 0.0, "power": 2 if r.u >= SWEET else 1 }      # a hit while the ring is tight counts double
	var h := _get_hammer(a)
	if h:
		h.visible = true
	ham_t = WINDUP + HOLD + 0.2
	_sound("swish", a.pos, 0.45)


func _step_swing(dt: float, a) -> void:
	cool = maxf(0, cool - dt)
	if ham_t > 0:
		ham_t -= dt
		if ham_t <= 0 and hammer and is_instance_valid(hammer):
			hammer.visible = false
	if swing != null:
		swing.t += dt
		if swing.t >= WINDUP:
			var sw: Dictionary = swing
			swing = null
			cool = RECOVER
			hold = HOLD
			_impact(sw, a)
	if hold > 0:
		hold -= dt
		if a:
			a.throw_t = 0.39 - WINDUP          # the hammer stops dead on the rock for a moment


func _impact(sw: Dictionary, a) -> void:
	var k: int = sw.k
	if a == null or not _breakable(k):
		return
	var b: Dictionary = Terrain.boulders[k]
	var r := _rock_of(k)
	var m := _node_of(k)
	var dx: float = a.pos.x - b.x
	var dz: float = a.pos.z - b.z
	var d := Vector2(dx, dz).length()
	if d == 0:
		d = 1
	var big: bool = sw.power > 1
	var hx: float = b.x + dx / d * b.r * 0.85
	var hz: float = b.z + dz / d * b.r * 0.85
	var hy: float = r.gy + minf(1.25, b.r * b.sy * 0.7)          # where the hammer lands
	if r.mat == null:                       # its own paint, so only this rock flashes and darkens
		var src: Material = m.material_override if m.material_override else m.get_active_material(0)
		if src:
			r.mat = src.duplicate()
			m.material_override = r.mat
			r.tint = r.mat.get_shader_parameter("albedo") if r.mat is ShaderMaterial else (r.mat as BaseMaterial3D).albedo_color
	r.hits = mini(r.need, r.hits + sw.power)
	r.jolt = 1.0
	r.flash = 1.0 if big else 0.6
	r.u = 0.06
	r.dx = -dx / d
	r.dz = -dz / d
	if not live.has(k):
		live.append(k)
	World.burst(hx, hy, hz, 16 if big else 9, 4.2, _rock_color(), { "life": 0.8, "size": 0.17, "grow": 0.7, "alpha": 1.0, "grav": World.gravity })      # chips
	World.dust(hx, hz, 9 if big else 5, 2, 0.5)
	if big:
		World.burst(hx, hy, hz, 10, 5.5, 0xffd27a, { "life": 0.3, "size": 0.13, "grow": 0.4, "alpha": 1.0, "grav": 0.0 })
	World.cam.shake = maxf(World.cam.shake, 0.2 if big else 0.11)
	_sound("thud", Vector3(hx, hy, hz), 1.3 if big else 0.9)
	if big:
		_sound("ice", Vector3(hx, hy, hz), 0.7)
		_tell("toast", "Great hit! ×2", Vector3(b.x, hy + 1.3, b.z), "#ffd23f")
	if r.hits >= r.need:
		_shatter(k)
		return
	_crack(k, a.pos)
	if big:
		_crack(k, a.pos)


## where a ray from `from` going `dir` first meets the mesh (in the world), or null
func _ray_mesh(mi: MeshInstance3D, from: Vector3, dir: Vector3, far: float):
	var mesh := mi.mesh
	if mesh == null:
		return null
	if not _faces.has(mesh):
		_faces[mesh] = mesh.get_faces()
	var f: PackedVector3Array = _faces[mesh]
	var inv := mi.global_transform.affine_inverse()
	var lo := inv * from
	var ld := (inv.basis * dir)
	var best = null
	var bd := INF
	for i in range(0, f.size() - 2, 3):
		var hit = Geometry3D.ray_intersects_triangle(lo, ld, f[i], f[i + 1], f[i + 2])
		if hit != null:
			var dd: float = (hit - lo).length_squared()
			if dd < bd:
				bd = dd
				best = hit
	if best == null:
		return null
	var w: Vector3 = mi.global_transform * best
	return w if w.distance_to(from) <= far else null


## A dark crack that runs over the rock from where the hammer hit. It is found by pointing rays at the rock.
func _crack(k: int, from: Vector3) -> void:
	var b: Dictionary = Terrain.boulders[k]
	var mesh := _node_of(k)
	if mesh == null or not mesh.is_inside_tree():
		return
	var cy: float = Terrain.height(b.x, b.z) + b.r * b.sy * 0.3
	var pts := []
	var out := []
	var a := atan2(from.x - b.x, from.z - b.z) + _rnd(-0.9, 0.9)
	var el := _rnd(0.25, 0.8)
	var da := _rnd(-0.22, 0.22)
	var de := (-1.0 if randf() < 0.5 else 1.0) * _rnd(0.1, 0.2)
	for i in 6:
		var v1 := Vector3(sin(a) * cos(el), sin(el), cos(a) * cos(el))
		var start: Vector3 = Vector3(b.x, cy, b.z) + v1 * b.r * 3.2
		var hit = _ray_mesh(mesh, start, -v1, b.r * 5)
		if hit == null:
			break
		pts.append(hit + v1 * 0.03)
		out.append(v1)
		a += da + _rnd(-0.16, 0.16)
		el += de + _rnd(-0.1, 0.1)
		if el < 0.08 or el > 1.4:
			break
	var n := pts.size()
	if n < 2:
		return
	# a thin ribbon along those points, stored in the rock's own space so it moves and shrinks with the rock
	var inv := mesh.global_transform.affine_inverse()
	var side := []
	for i in n:
		var t: Vector3 = (pts[mini(n - 1, i + 1)] - pts[maxi(0, i - 1)]).normalized()
		var s2: Vector3 = (out[i] as Vector3).cross(t).normalized()
		var w := (0.008 if i == 0 or i == n - 1 else 0.032) * sqrt(float(b.r))
		side.append([inv * (pts[i] + s2 * w), inv * (pts[i] - s2 * w)])
	var v := PackedVector3Array()
	var nn := PackedVector3Array()
	for i in range(1, n):
		var q := [side[i - 1][0], side[i - 1][1], side[i][0], side[i][1]]
		for idx in [0, 1, 2, 1, 3, 2]:
			v.append(q[idx])
			nn.append(Vector3.UP)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = nn
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var cm := MeshInstance3D.new()
	cm.mesh = am
	cm.material_override = M.crack
	cm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mesh.add_child(cm)


## The jolt, the flash and the slow shrinking of the rocks that were hit.
func _step_rocks(dt: float) -> void:
	for i in range(live.size() - 1, -1, -1):
		var k: int = live[i]
		var r = rocks.get(k)
		if r == null or not _breakable(k):
			live.remove_at(i)
			continue
		r.jolt = maxf(0, r.jolt - dt * 3.4)
		r.flash = maxf(0, r.flash - dt * 4)
		var want: float = 1 - 0.24 * r.hits / r.need
		r.shrink += (want - r.shrink) * minf(1, dt * 12)
		var m := _node_of(k)
		var j: float = r.jolt * r.jolt
		var sc: float = r.shrink * (1 + 0.05 * j)
		var p0: Vector3 = r.p
		var s0: Vector3 = r.s
		m.position = Vector3(p0.x + r.dx * 0.14 * j, r.gy + (p0.y - r.gy) * r.shrink, p0.z + r.dz * 0.14 * j)
		m.rotation.z = r.rz + 0.07 * j * sin(r.jolt * 26)
		m.scale = Vector3(s0.x * sc, s0.y * r.shrink * (1 - 0.05 * j), s0.z * sc)
		if r.mat is ShaderMaterial:
			var sm: ShaderMaterial = r.mat
			sm.set_shader_parameter("emission", Mats.lin(0xffa860))
			sm.set_shader_parameter("emission_energy", r.flash * 0.32)
			var tc: Color = r.tint
			sm.set_shader_parameter("albedo", Color(tc.r, tc.g, tc.b, tc.a) * (1 - 0.2 * r.hits / r.need))
		elif r.mat is BaseMaterial3D:
			var bm: BaseMaterial3D = r.mat
			bm.emission_enabled = true
			bm.emission = Mats.lin(0xffa860)
			bm.emission_energy_multiplier = r.flash * 0.32
			bm.albedo_color = (r.tint as Color) * (1 - 0.2 * r.hits / r.need)
		if r.jolt <= 0 and r.flash <= 0 and absf(r.shrink - want) < 0.002:
			live.remove_at(i)


## Take a boulder off the map: it no longer shows and no longer blocks the way.
func _clear_rock(k: int) -> void:
	var b: Dictionary = Terrain.boulders[k]
	var m := _node_of(k)
	if m:
		m.visible = false
	var i: int = Base.colliders.find(b.get("col"))
	if i >= 0:
		Base.colliders.remove_at(i)


func _shatter(k: int) -> void:
	var b: Dictionary = Terrain.boulders[k]
	var gy: float = Terrain.height(b.x, b.z)
	_clear_rock(k)
	var give: Dictionary = Sim.rock_yield(S, k, b.r) if S else { "rock": 2 }
	if S:
		Sim.break_rock(S, k)
	World.burst(b.x, gy + b.r * 0.5, b.z, 24 + roundi(b.r * 8), 6, _rock_color(), { "life": 1.1, "size": 0.24, "grow": 0.6, "alpha": 1.0, "grav": World.gravity })
	World.burst(b.x, gy + 0.4, b.z, 30, 4, _dust_color(), { "life": 1.8, "size": 1.1, "grow": 3.0, "alpha": 0.5, "up": 0.8, "grav": World.gravity * 0.12 })
	World.cam.shake = maxf(World.cam.shake, _clamp(0.22 + b.r * 0.08, 0.25, 0.5))
	_sound("thud", Vector3(b.x, gy + 0.5, b.z), 1.5)
	_sound("drop", Vector3(b.x, gy + 0.5, b.z), 1.0)
	_throw_pieces(b, gy, give, _astro())
	if not flags.has("isru"):
		flags.isru = true
		_tell("why", "isru")


## Rocks that the mission already counts as broken must not stand in a freshly built world.
func _sync_broken(s: Dictionary) -> void:
	for key in s.get("broken", {}):
		var k := int(key)
		if s.broken[key] and k >= 0 and k < Terrain.boulders.size() and not Terrain.boulders[k].seat:
			var m := _node_of(k)
			if m and m.visible:
				_clear_rock(k)


# ---------- the pieces ----------
func _throw_pieces(b: Dictionary, gy: float, give: Dictionary, who) -> void:
	var list := []
	var count := {}
	var g: float = World.gravity if World.gravity else 3.7
	for k in give:
		count[k] = 0
		for i in int(give[k]):
			list.append({ "kind": k, "n": 1 })
			count[k] += 1
	# too many to show: two pieces of the most common kind become one bigger piece
	while list.size() > MAX_PIECES:
		var most = null
		for k in count:
			if most == null or count[k] > count[most]:
				most = k
		var a := -1
		var lo := -1
		for i in list.size():
			if list[i].kind == most:
				if a < 0 or list[i].n < list[a].n:
					lo = a
					a = i
				elif lo < 0 or list[i].n < list[lo].n:
					lo = i
		if a < 0 or lo < 0:
			break
		list[a].n += list[lo].n
		list.remove_at(lo)
		count[most] -= 1
	var to_me: float = atan2(who.pos.z - b.z, who.pos.x - b.x) if who else 0.0
	var fan: float = 4.4 if who else TAU                 # they fly out on your side of the rock, not far behind it
	for i in list.size():
		var j: Dictionary = list[i]
		var a := to_me + ((i + 0.5) / list.size() - 0.5) * fan + _rnd(-0.25, 0.25)
		var mesh := MeshInstance3D.new()
		mesh.mesh = GEO.nugget if j.kind == "metal" else (GEO.shard if j.kind == "glass" else GEO.lump)
		mesh.material_override = M.ore if j.kind == "metal" else (M.sand if j.kind == "glass" else M.rock)
		var sc := minf(1.7, 1 + 0.2 * (j.n - 1))
		mesh.scale = Vector3(sc * _rnd(0.85, 1.15), sc * (1.4 if j.kind == "glass" else _rnd(0.7, 1)), sc * _rnd(0.85, 1.15))
		mesh.rotation = Vector3(_rnd(0, 3), _rnd(0, 3), _rnd(0, 3))
		var hop := _rnd(1.0, 2.0)
		var vy := sqrt(2 * g * hop)
		var far: float = (b.r * 0.5 + _rnd(1.2, 2.8)) / (2 * vy / g)          # a hop of 1 to 2 m that lands a few metres out, whatever the gravity
		var p := { "kind": j.kind, "n": j.n, "mesh": mesh, "r": 0.26 * sc, "state": "fly", "age": 0.0, "pt": 0.0, "spin": _rnd(3, 8), "glint": _rnd(0, 1),
			"pos": Vector3(b.x + cos(a) * b.r * 0.4, gy + _rnd(0.4, 0.5 + b.r * 0.5), b.z + sin(a) * b.r * 0.4),
			"vel": Vector3(cos(a) * far, vy, sin(a) * far) }
		mesh.position = p.pos
		root.add_child(mesh)
		pieces.append(p)


func _step_pieces(dt: float, pos) -> void:
	var g: float = World.gravity if World.gravity else 3.7
	var pull := PULL_R + 1 if _driving() else PULL_R
	for i in range(pieces.size() - 1, -1, -1):
		var p: Dictionary = pieces[i]
		var mesh: MeshInstance3D = p.mesh
		p.age += dt
		if p.state == "fly":
			p.vel.y -= g * dt
			p.pos += p.vel * dt
			mesh.rotation.x += p.spin * dt
			mesh.rotation.z += p.spin * 0.7 * dt
			var rr := Vector2(p.pos.x, p.pos.z).length()
			if rr > Terrain.PLAY_R - 1:
				var k := (Terrain.PLAY_R - 1) / rr
				p.pos.x *= k
				p.pos.z *= k
				p.vel.x = 0
				p.vel.z = 0
			var gnd: float = _ground(p.pos.x, p.pos.z) + p.r
			if p.pos.y <= gnd:
				p.pos.y = gnd
				var hit := absf(p.vel.y)
				if hit > 1:
					p.vel.y = hit * 0.38
					p.vel.x *= 0.55
					p.vel.z *= 0.55
					p.spin *= 0.5
					if hit > 1.8:
						World.dust(p.pos.x, p.pos.z, 2, 0.8, 0.25)
				else:
					p.state = "rest"
					p.vel = Vector3.ZERO
		elif p.state == "rest":
			# a glint now and then, so a piece left on the ground is easy to find again
			p.glint -= dt
			if p.glint <= 0:
				p.glint = _rnd(0.6, 1.3)
				World.emit(p.pos.x, p.pos.y + 0.2, p.pos.z, { "vy": 1.1, "life": 0.8, "size": 0.2, "grow": 0.3, "color": SPARK.get(p.kind, 0xffffff), "alpha": 1.0, "grav": 0.0 })
		# close enough: it flies into the bag
		if p.state != "pull" and pos != null and p.age > 0.8 and Vector2(pos.x - p.pos.x, pos.z - p.pos.z).length() < pull and absf(pos.y - p.pos.y) < 4:
			p.state = "pull"
			p.pt = 0.0
		if p.state == "pull":
			p.pt += dt
			var to := Vector3(pos.x, pos.y + 1.1, pos.z)
			p.pos = p.pos.lerp(to, minf(1, dt * (5 + p.pt * 22)))
			mesh.rotation.y += dt * 9
			if p.pos.distance_to(to) < 0.4 or p.pt > 0.9:
				_collect(p)
				pieces.remove_at(i)
				continue
		mesh.position = p.pos


func _collect(p: Dictionary) -> void:
	var mat: Dictionary = Data.MATS.get(p.kind, { "icon": "" })
	if S:
		Sim.add_mat(S, p.kind, p.n)
	(p.mesh as Node).queue_free()
	World.burst(p.pos.x, p.pos.y, p.pos.z, 5, 1.6, SPARK.get(p.kind, 0xffffff), { "life": 0.45, "size": 0.14, "grow": 0.5, "alpha": 0.9, "grav": 0.0 })
	_sound("pop", p.pos, 0.8)
	_tell("toast", "+" + str(p.n) + " " + str(mat.icon), Vector3(p.pos.x, p.pos.y + 0.9 + (stack % 3) * 0.5, p.pos.z), TINT.get(p.kind, "#ffffff"))
	stack += 1


# ---------- the drill rig digs by itself ----------
func _step_rigs(_dt: float, s: Dictionary, play: bool, pos) -> void:
	var t := float(s.get("t", 0.0))
	var d: float = 0.0 if last_t == null else t - float(last_t)
	last_t = t
	if not (d > 0 and d < 5):                 # a new day began or the clock jumped: nothing was dug in between
		return
	for st in structs:
		if st.id != "rig" or not st.done:
			continue
		st.dig += d
		if st.dig < RIG_EVERY:
			continue
		var n := 0
		for it in Actors.items:
			if it.type == "ice" and it.state != "held" and it.state != "bed" and Vector2(it.pos.x - st.x, it.pos.z - st.z).length() < RIG_NEAR:
				n += 1
		st.full = n >= RIG_MAX
		if st.full:
			st.dig = RIG_EVERY - 4             # the tray is full: look again in a moment
			continue
		st.dig = 0.0
		var cs := cos(float(st.yaw))
		var sn := sin(float(st.yaw))
		var side := (0.5 if st.slot % 2 else -0.5) + _rnd(-0.12, 0.12)
		st.slot += 1
		var v := Vector3(st.x + 1.95 * cs + side * sn, 0, st.z - 1.95 * sn + side * cs)
		v.y = _ground(v.x, v.z) + 0.42
		Actors.spawn("ice", v, null, "rest")
		if play:
			_sound("ice", v, 0.9)
			World.burst(v.x, v.y, v.z, 8, 2, 0xbfefff, { "life": 0.6, "size": 0.18, "grow": 0.6, "alpha": 0.9, "grav": 0.0 })
			if pos != null and Vector2(pos.x - st.x, pos.z - st.z).length() < 60:
				_tell("toast", "🧊 +1", Vector3(v.x, v.y + 1, v.z), "#7fe8ff")
		if not flags.has("rig"):
			flags.rig = true
			_tell("say", "Your drill rig just dug out an ice chunk, all by itself! It keeps two ready for you beside it.")


# ---------- placing a structure ----------
static func _allowed(s, def) -> bool:
	return def != null and (not def.get("site") or s == null or not s.get("site") or def.site == s.site.id)


func _start_place(id: String) -> bool:
	var s = S
	var def = Data.BUILDS.get(id)
	if not on or s == null or def == null or root == null or M.is_empty():
		return false
	if place != null:
		_cancel_place(true)
	if last_mode != "play":
		_tell("say", "Step outside first. Building happens out on the ground.")
		return false
	if _driving():
		_tell("say", "Climb out of the rover first, then pick what to build.")
		return false
	var can: Dictionary = Sim.can_build(s, id)
	if not can.ok:
		_sound("deny")
		if can.get("msg"):
			_tell("say", can.msg)
		return false
	var o := _shape(id, null)
	_ghost(o.g)
	var edge := _add(o.g, _ring_mesh(o.spec.rad - 0.09, o.spec.rad, 30), M.edge, 0, 0.12, 0, true)     # the ground it will take
	edge.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	(o.g as Node3D).visible = false
	root.add_child(o.g)
	place = { "id": id, "def": def, "o": o, "spec": o.spec, "ok": false, "msg": "", "x": 0.0, "y": 0.0, "z": 0.0, "yaw": 0.0, "shown": null }
	_step_place(_astro())
	if not flags.has("placeTip"):
		flags.placeTip = true
		_tell("say", "Walk and look around to choose a spot. Green means it fits. " + ("Tap ✋ to build it, or 🎯 to cancel." if Game.touch else "Press E to build it, or Q to cancel."))
	chip_sig = ""
	return true


func _ghost(n: Node) -> void:
	if n is MeshInstance3D:
		var mi: MeshInstance3D = n
		mi.material_override = M.ghost
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for k in n.get_children():
		_ghost(k)


func _cancel_place(quiet_ := false) -> void:
	if place == null:
		return
	var g: Node3D = place.o.g
	if is_instance_valid(g):
		g.queue_free()
	place = null
	chip_sig = ""
	if not quiet_:
		_sound("tap")


## Why the ghost cannot stand where it is ('' when the spot is fine).
func _spot_problem(pl: Dictionary) -> String:
	var x: float = pl.x
	var z: float = pl.z
	var sp: Dictionary = pl.spec
	var L: Dictionary = Terrain.L
	var cs := cos(float(pl.yaw))
	var sn := sin(float(pl.yaw))
	if Vector2(x, z).length() + sp.rad > Terrain.PLAY_R - 3:
		return "Not here: too close to the edge of the map"
	if Vector2(x - DOOR.x, z - DOOR.y).length() < DOOR_R:
		return "Not here: keep the way to the door clear"
	if pl.def.get("where") == "ice" and L.has("ice") and Vector2(x - L.ice.x, z - L.ice.y).length() > Terrain.ice_r * 0.8:
		return "Not here: it must stand on the ice field"
	var lo: float = pl.y
	var hi: float = pl.y
	for i in 8:
		var h := _ground(x + cos(i * 0.785) * sp.rad, z + sin(i * 0.785) * sp.rad)
		lo = minf(lo, h)
		hi = maxf(hi, h)
	if hi - lo >= BUMPY:
		return "Not here: the ground is too bumpy"
	# a wall is long and thin, so it is checked by its own small circles; everything else by its round footprint
	var list: Array = sp.cols if sp.get("thin", false) else [[0, 0, sp.rad]]
	var R = Actors.rover
	for q in list:
		var vx: float = x + q[0] * cs + q[1] * sn
		var vz: float = z - q[0] * sn + q[1] * cs
		for c in Base.colliders:
			if Vector2(vx - c.x, vz - c.z).length() < q[2] + c.r + CLEAR:
				return "Not here: something is in the way"
		if R != null and Vector2(vx - R.pos.x, vz - R.pos.z).length() < q[2] + 2.6:
			return "Not here: the rover is in the way"
	if L.has("colony") and Game.has_addon("colony") and Vector2(x - L.colony.x, z - L.colony.y).length() < 40:
		return "Not here: ships from Earth land on this plain"
	return ""


func _step_place(a) -> void:
	if a == null or place == null:
		return
	var pl: Dictionary = place
	var g: Node3D = pl.o.g
	var f := World.forward()
	var d := maxf(AHEAD, pl.spec.rad + 1.5)
	pl.x = a.pos.x + f.x * d
	pl.z = a.pos.z + f.z * d
	pl.y = _ground(pl.x, pl.z)
	pl.yaw = World.cam.yaw
	pl.msg = _spot_problem(pl)
	pl.ok = pl.msg == ""
	g.visible = true
	g.position = Vector3(pl.x, pl.y + 0.06, pl.z)
	g.rotation.y = pl.yaw
	if pl.ok != pl.shown:
		pl.shown = pl.ok
		var col := Mats.lin(0x4dff9a if pl.ok else 0xff5468)
		(M.ghost as StandardMaterial3D).albedo_color = Color(col.r, col.g, col.b, (M.ghost as StandardMaterial3D).albedo_color.a)
		(M.edge as StandardMaterial3D).albedo_color = Color(col.r, col.g, col.b, 0.9)
	var gm: StandardMaterial3D = M.ghost
	gm.albedo_color.a = 0.5 + sin(World.time * 5) * 0.1


func _confirm_place() -> void:
	var pl = place
	var s = S
	if pl == null or s == null:
		return
	if not pl.ok:
		_sound("deny")
		return
	var r: Dictionary = Sim.build(s, pl.id)
	if not r.ok:
		_sound("deny")
		if r.get("msg"):
			_tell("say", r.msg)
		_cancel_place(true)
		return
	_raise(pl.id, pl.x, pl.z, pl.yaw)
	_cancel_place(true)
	_tell("sync")


# ---------- the bag chip and the timing ring (drawn over the 3D view) ----------
func _make_ui() -> void:
	if chip and is_instance_valid(chip):
		return
	chip = PanelContainer.new()
	chip.name = "PioChip"
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.08, 0.17, 0.82)
	sb.set_corner_radius_all(999)
	sb.border_color = Color(1, 1, 1, 0.12)
	sb.set_border_width_all(1)
	sb.content_margin_left = 16
	sb.content_margin_right = 7
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 10
	chip.add_theme_stylebox_override("panel", sb)
	chip.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	chip.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	chip.grow_vertical = Control.GROW_DIRECTION_BEGIN
	chip.mouse_filter = Control.MOUSE_FILTER_STOP
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	chip.add_child(row)
	chip_mats = {}
	for k in Data.MATS:
		var l := Label.new()
		l.text = str(Data.MATS[k].icon) + " 0"
		l.add_theme_font_override("font", Paint.font(700, "lexend"))
		l.add_theme_font_size_override("font_size", 18)
		l.add_theme_color_override("font_color", Style.INK)
		l.tooltip_text = str(Data.MATS[k].name)
		l.mouse_filter = Control.MOUSE_FILTER_PASS
		l.pivot_offset = Vector2(20, 12)
		row.add_child(l)
		chip_mats[k] = l
	chip_btn = Button.new()
	chip_btn.text = "🔨 Build  B"
	chip_btn.theme_type_variation = "BtnPrimary"
	chip_btn.focus_mode = Control.FOCUS_NONE
	chip_btn.pressed.connect(func():
		if place != null:
			_cancel_place()
		else:
			menu())
	row.add_child(chip_btn)
	chip.visible = false
	Ui.root.add_child(chip)
	ring = Control.new()
	ring.name = "PioRing"
	ring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ring.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	ring.size = Vector2(1, 1)
	ring.draw.connect(_draw_ring)
	ring.visible = false
	Ui.root.add_child(ring)
	Ui.root.move_child(ring, 0)               # under the panels, like the web version's low z-index


func _place_chip() -> void:
	var vs: Vector2 = Ui.root.size
	var w := chip.get_combined_minimum_size()
	chip.size = w
	if Game.touch:
		chip.position = Vector2(vs.x - w.x - 18, vs.y - w.y - 246)
	elif chip_in:
		chip.position = Vector2(vs.x - w.x - 14, vs.y * 0.54)      # inside the habitat the room's own panel sits in that corner
	else:
		chip.position = Vector2(vs.x - w.x - 14, vs.y - w.y - (150 if vs.x <= 900 else 16))


func _draw_ring() -> void:
	var gold := Style.POWER
	var c := Vector2.ZERO
	var navy := Color(6 / 255.0, 20 / 255.0, 60 / 255.0, 0.45)
	ring.draw_arc(c, 42 + 0.75, 0, TAU, 64, navy, 1.5, true)
	ring.draw_arc(c, 42 - 1.5, 0, TAU, 64, gold if ring_sweet else Color(1, 1, 1, 0.5), 3, true)
	var pr := 42.0 * (1.95 - 0.95 * ring_u)
	var pw := 7.0 if ring_sweet else 4.0
	ring.draw_arc(c, pr - pw / 2 + 3, 0, TAU, 64, Color(gold.r, gold.g, gold.b, 0.35) if ring_sweet else Color(1, 1, 1, 0.22), pw + 6, true)
	ring.draw_arc(c, pr - pw / 2, 0, TAU, 64, gold if ring_sweet else Color.WHITE, pw, true)
	# how many hits this rock still needs
	var n := ring_need
	if n <= 0:
		return
	var w := n * 11 + (n - 1) * 5 + 18
	var top := 58.0
	var pill := Rect2(-w / 2.0, top, w, 21)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.05, 0.12, 0.7)
	sb.set_corner_radius_all(999)
	ring.draw_style_box(sb, pill)
	for i in n:
		var r := Rect2(-w / 2.0 + 9 + i * 16, top + 5, 11, 11)
		var on_ := i < ring_hits
		var bx := StyleBoxFlat.new()
		bx.bg_color = gold if on_ else Color(1, 1, 1, 0.25)
		bx.set_corner_radius_all(3)
		if on_:
			bx.shadow_color = Color(1, 0.82, 0.25, 0.8)
			bx.shadow_size = 4
		ring.draw_style_box(bx, r)


func _show_chip(show: bool, inside := false) -> void:
	if chip == null or not is_instance_valid(chip):
		return
	if show != chip_on:
		chip_on = show
		chip.visible = show
	if show:
		chip_in = inside
		_place_chip()


func _hide_ring() -> void:
	if ring and is_instance_valid(ring) and ring_on:
		ring_on = false
		ring.visible = false


func _quiet() -> void:
	_show_chip(false)
	_hide_ring()


func _refresh_chip(s: Dictionary) -> void:
	if chip == null or not is_instance_valid(chip):
		return
	var m: Dictionary = s.get("mats", {})
	var sig := "p" if place != null else ""
	for k in Data.MATS:
		sig += str(m.get(k, 0)) + ","
	for k in s.get("built", {}):
		sig += str(s.built[k])
	if sig == chip_sig:
		return
	chip_sig = sig
	for k in Data.MATS:
		var l: Label = chip_mats.get(k)
		if l == null:
			continue
		var t := str(Data.MATS[k].icon) + " " + str(int(m.get(k, 0)))
		if l.text != t:
			l.text = t
			l.scale = Vector2(1.3, 1.3)               # a little jump when the number changes
			var tw := l.create_tween()
			tw.tween_property(l, "scale", Vector2.ONE, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	var can := false
	for k in Data.BUILDS:
		if _allowed(s, Data.BUILDS[k]) and Sim.can_build(s, k).ok:
			can = true
	chip_btn.text = "✖ Cancel" if place != null else ("🔨 Build" if Game.touch else "🔨 Build  B")
	chip_btn.theme_type_variation = "BtnGhost" if place != null else "BtnPrimary"
	chip_btn.set_meta("ready", can and place == null)


## The ring on the rock in front of you: it closes again and again. Swing when it is tight and gold.
func _step_ring(dt: float, a) -> void:
	if ring == null or not is_instance_valid(ring):
		return
	var k := -1
	var best := REACH
	if swing != null:
		k = swing.k
	elif a != null and a.mode == "walk" and a.carrying == null and place == null and not _driving():
		for i in Terrain.boulders.size():
			if not _breakable(i):
				continue
			var b: Dictionary = Terrain.boulders[i]
			var d: float = Vector2(a.pos.x - b.x, a.pos.z - b.z).length() - b.r
			if d < best:
				best = d
				k = i
	if k < 0 or not _breakable(k):
		_hide_ring()
		return
	var b2: Dictionary = Terrain.boulders[k]
	var r := _rock_of(k)
	if swing == null:
		r.u = fmod(r.u + dt / RING_T, 1.0)
	var p: Dictionary = World.project(Vector3(b2.x, r.gy + minf(1.5, b2.r * b2.sy * 0.75), b2.z))
	if p.hidden:
		_hide_ring()
		return
	if not ring_on:
		ring_on = true
		ring.visible = true
	ring.position = Vector2(roundf(p.x), roundf(p.y))
	ring_u = r.u
	ring_sweet = (swing.power > 1) if swing != null else r.u >= SWEET
	ring_hits = r.hits
	ring_need = r.need
	ring.queue_redraw()
	if not flags.has("hint"):
		flags.hint = true
		_tell("say", "Rock hammer ready! " + ("Tap ✋" if Game.touch else "Press E") + " to swing. Wait for the ring to close and turn gold: that hit counts double.")


func _process(_dt: float) -> void:
	# if the game stops calling update (a menu, the title screen), the chip must not stay behind
	if (chip_on or ring_on) and Time.get_ticks_msec() - _last_tick > 900:
		_quiet()
	# the Build button breathes when you can afford something
	if chip_on and chip_btn and is_instance_valid(chip_btn):
		var ready_: bool = chip_btn.get_meta("ready", false)
		chip_btn.modulate = Color(1, 1, 1).lerp(Color(1.25, 1.2, 1.0), (0.5 + 0.5 * sin(Time.get_ticks_msec() / 1000.0 * TAU / 1.3)) if ready_ else 0.0)
		if chip_on and Ui.root:
			_place_chip()


# ---------- the build menu ----------
func _menu_html(s: Dictionary) -> String:
	var m: Dictionary = s.get("mats", {})
	var bag := ""
	for k in Data.MATS:
		bag += "<span>" + str(Data.MATS[k].icon) + " " + _esc(Data.MATS[k].name) + " <b>" + str(int(m.get(k, 0))) + "</b></span>　 "
	var cards := ""
	for id in Data.BUILDS:
		var def: Dictionary = Data.BUILDS[id]
		if not _allowed(s, def):
			continue
		var can: Dictionary = Sim.can_build(s, id)
		var n := int(s.get("built", {}).get(id, 0))
		var cost := ""
		for k in def.get("cost", {}):
			var have := int(m.get(k, 0))
			var need := int(def.cost[k])
			var icon: String = str(Data.MATS[k].icon) if Data.MATS.has(k) else _esc(k)
			cost += ("<span style=\"color:" + Style.hx(Style.DANGER) + "\">" if have < need else "<span>") + icon + " " + str(have) + "/" + str(need) + "</span>　"
		var src = Data.SOURCES.get(def.get("src", ""))
		cards += "<div class=\"info-row" + (" good" if can.ok else "") + "\"><span class=\"ic\">" + str(def.get("icon", "📦")) + "</span><div>" + \
			"<b>" + _esc(def.name) + "</b> <small class=\"muted\">· " + str(n) + "/" + str(int(def.get("max", 1))) + " built</small>" + \
			"<p>" + _esc(def.get("text", "")) + "</p>" + \
			"<p class=\"note\">" + _esc(def.get("why", "")) + ((" <i>" + _esc(src.name) + "</i>") if src else "") + "</p>" + \
			"<p>" + cost + ("" if can.ok else " <small class=\"muted\">" + _esc(can.get("msg", "")) + "</small>") + "</p>" + \
			"<button type=\"button\" class=\"btn primary small\" data-act=\"pio-" + _esc(id) + "\"" + ("" if can.ok else " disabled") + ">Build</button></div></div>"
	return "<h2>⛏ Pioneer workshop</h2>" + \
		"<p class=\"sub\">Living off the land: break boulders with your rock hammer, pick up the pieces, then build with them. Real crews plan to do the same, so they can bring less from Earth.</p>" + \
		"<p><b>In your bag:</b> " + bag + "</p>" + cards


func _choose(id: String) -> void:
	_tell("closeInfo")
	_menu_doc = null
	_start_place(id)


# =====================================================================
#  CALLED BY THE GAME
# =====================================================================
## A new world was built: forget everything from the old one.
func build(root_group: Node3D, site_id: String) -> void:
	root = root_group
	site = site_id if site_id else "mars"
	rocks = {}
	live = []
	swing = null
	cool = 0.0
	hold = 0.0
	hammer = null
	ham_t = 0.0
	pieces = []
	structs = []
	place = null
	flags = {}
	synced = null
	last_t = null
	chip_sig = ""
	_faces = {}
	_make_kit()
	_quiet()


## A mission begins with Pioneer mode on. api: { say, toast, why, openInfo, closeInfo, sound, sync }
func start(s, helpers: Dictionary = {}) -> void:
	if s != last_s:
		last_s = s
		flags = {}
		synced = null
		last_t = null
	S = s
	api = helpers
	on = s != null
	chip_sig = ""
	_make_ui()
	if M.is_empty():
		_make_kit()


## The mission is not in Pioneer mode, or the player left.
func stop() -> void:
	on = false
	swing = null
	if place != null:
		_cancel_place(true)
	if hammer and is_instance_valid(hammer):
		hammer.visible = false
	_quiet()


func active() -> bool:
	return on


func placing() -> bool:
	return place != null


## Every frame. mode: the game's mode; pos: where the astronaut (or the rover being driven) is.
func update(dt: float, s, mode: String, pos = null) -> void:
	var play := mode == "play"
	var inside := mode == "inside"
	var a = _astro()
	_last_tick = Time.get_ticks_msec()
	last_mode = mode
	if not on or s == null or not s.get("pioneer") or root == null or not is_instance_valid(root) or M.is_empty() or (not play and not inside):
		_quiet()
		swing = null
		if place != null and not play and not inside:
			_cancel_place(true)
		return
	S = s
	if synced != s:
		synced = s
		_sync_broken(s)
	dt = minf(dt, 0.1)
	if pos == null and a:
		pos = a.pos
	_show_chip(true, inside)
	_refresh_chip(s)
	_step_rigs(dt, s, play, pos)
	if not play:
		_hide_ring()
		if place != null:
			(place.o.g as Node3D).visible = false
		return
	_glow_all(s)
	_step_swing(dt, a)
	_step_rocks(dt)
	_step_pieces(dt, pos)
	_step_structs(dt, s, pos)
	if place != null:
		_step_place(a)
	_step_ring(dt, a)


## What E does. The game picks the nearest offer; while a ghost is out, placing always wins.
func offer(s, p, offer_: Callable) -> void:
	if not on or s == null or p == null or not offer_.is_valid():
		return
	if place != null:
		offer_.call(-1000.0, 1.0, { "label": ("Build the " + _lower_first(str(place.def.name)) + " here") if place.ok else place.msg, "run": _confirm_place,
			"alt": func(): _cancel_place(), "altLabel": "cancel" })
		return
	var a = _astro()
	if a == null or a.carrying != null or a.mode != "walk" or _driving():
		return
	for i in Terrain.boulders.size():
		if not _breakable(i):
			continue
		var b: Dictionary = Terrain.boulders[i]
		var d: float = Vector2(p.x - b.x, p.z - b.z).length() - b.r
		if d < REACH:
			var k := i
			offer_.call(d, REACH, { "label": "Break the rock ⛏", "run": func(): _swing_at(k) })


## Open the build menu (the B key, the Settings menu and the bag chip all come here).
func menu() -> bool:
	if not on or S == null or not api.has("openInfo") or (last_mode != "play" and last_mode != "inside"):
		return false
	if _menu_doc != null and Ui.info_open() and Ui.info_doc == _menu_doc:       # B again closes it
		_tell("closeInfo")
		_menu_doc = null
		return false
	if place != null:
		_cancel_place(true)
	var doc = (api.openInfo as Callable).call(_menu_html(S))
	if doc == null:
		return false
	_menu_doc = doc
	for id in Data.BUILDS:
		var k: String = id
		doc.on("pio-" + k, func(_el): _choose(k))
	return true
