extends Node
## Astro Outpost — the shape of the land. Pure maths (no graphics), so the same height function is used for drawing
## the ground, walking on it, driving and throwing. A port of js/terrain.js (autoload "Terrain").
## Godot adjustment: craters are kept in a coarse grid, so a height lookup only visits the craters near the point
## (GDScript is slower than a browser's JavaScript, and the ground mesh asks for 63,000 heights).

const PLAY_R := 172.0
## Where everything is (x, z) in metres. +z is "south", toward the starting camera.
const L := {
	"hab": Vector2(0, 0), "door": Vector2(0, 8.6), "rack": Vector2(-18, -3), "solar": Vector2(-29, -11), "air": Vector2(-15, 13), "food": Vector2(20, 12),
	"bag": Vector2(14, -12), "lab": Vector2(28, -5), "comms": Vector2(3, -28), "roverPark": Vector2(-6, 22), "rocket": Vector2(-48, 34), "pallet": Vector2(-33, 26),
	"ice": Vector2(108, -42), "hill": Vector2(-64, -54), "mesa": Vector2(90, 88), "seat": Vector2(34, 40),
	"geo": [Vector2(74, 70), Vector2(-92, 58), Vector2(-84, -100), Vector2(115, -47)],
	"inst": { "seismo": Vector2(42, 52), "beam": Vector2(-22, -64), "rad": Vector2(64, -14) },
	"photo": [Vector2(-64, -54), Vector2(80, -22)],
	"colony": Vector2(40, -62)          # the flat, empty plain where the settlement grows (colony add-on)
}
const CELL := 24.0

var site := "mars"
var craters: Array = []
var flats: Array = []
var ice_r := 21.0
var ice_nodes: Array = []
var boulders: Array = []
var seat_top := 0.0
var _grid := {}          # Vector2i cell -> crater indexes whose reach (1.7 r) touches the cell


static func smooth(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)


static func hash2(x: float, z: float) -> float:
	var s := sin(x * 127.1 + z * 311.7) * 43758.5453
	return s - floor(s)


## value noise, 0..1
static func noise(x: float, z: float) -> float:
	var xi := floorf(x)
	var zi := floorf(z)
	var xf := x - xi
	var zf := z - zi
	var u := xf * xf * (3 - 2 * xf)
	var v := zf * zf * (3 - 2 * zf)
	var a := hash2(xi, zi)
	var b := hash2(xi + 1, zi)
	var c := hash2(xi, zi + 1)
	var d := hash2(xi + 1, zi + 1)
	var top := a + (b - a) * u
	var bot := c + (d - c) * u
	return top + (bot - top) * v


func raw(x: float, z: float) -> float:
	var r := sqrt(x * x + z * z)
	var h: float
	var d: float
	var mask := smooth(36, 66, r)
	if site == "mars":
		h = (noise(x * 0.016, z * 0.016) - 0.5) * 10 + (noise(x * 0.05, z * 0.05) - 0.5) * 3 + (noise(x * 0.17, z * 0.17) - 0.5) * 0.6
		# dune field to the south-west
		var dune := smooth(40, 110, z) * smooth(20, -60, x)
		if dune > 0:
			h += dune * (sin(x * 0.11 + z * 0.05 + noise(x * 0.02, z * 0.02) * 5) * 0.5 + 0.5) * 3.4
		# an old dry channel winding across the north
		var cz := -132 + sin(x * 0.021) * 24
		d = z - cz
		h -= 3.6 * exp(-(d * d) / 170)
	else:
		h = (noise(x * 0.014, z * 0.014) - 0.5) * 9 + (noise(x * 0.045, z * 0.045) - 0.5) * 2.6 + (noise(x * 0.15, z * 0.15) - 0.5) * 0.5
	h *= mask
	var cell = _grid.get(Vector2i(floori(x / CELL), floori(z / CELL)))
	if cell:
		for i in cell:
			var c: Dictionary = craters[i]
			var dx: float = x - c.x
			var dz: float = z - c.z
			d = sqrt(dx * dx + dz * dz) / c.r
			if d < 1.7:
				if d < 1:
					h -= minf(c.depth * (1 - d * d), c.depth * c.floor)
				var e := (d - 1) / 0.2
				h += c.depth * c.rim * exp(-e * e)
	# lookout hill
	var hx: float = x - L.hill.x
	var hz: float = z - L.hill.y
	h += 13 * exp(-(hx * hx + hz * hz) / (2 * 17 * 17))
	# mesa (Mars only): a flat-topped table of layered rock
	if site == "mars":
		var mx: float = x - L.mesa.x
		var mz: float = z - L.mesa.y
		var md := mx * mx + mz * mz
		if md < 22 * 22:
			d = sqrt(md) + (noise(x * 0.2, z * 0.2) - 0.5) * 3
			h += 9.5 * smooth(17, 11, d)
	# far rim: the land rises gently at the edge of the map
	h += smooth(PLAY_R + 10, PLAY_R + 120, r) * 26
	return h


func height(x: float, z: float) -> float:
	var h := raw(x, z)
	for f in flats:
		var dx: float = x - f.x
		var dz: float = z - f.z
		var d2 := dx * dx + dz * dz
		if d2 < f.r1 * f.r1:
			h = lerpf(f.h, h, smooth(f.r0, f.r1, sqrt(d2)))
	return h


func normal(x: float, z: float) -> Vector3:
	var e := 0.6
	var hx := height(x + e, z) - height(x - e, z)
	var hz := height(x, z + e) - height(x, z - e)
	return Vector3(-hx, 2 * e, -hz).normalized()


func set_site(id: String) -> void:
	site = id
	var rng := Rng32.new(4242 if id == "mars" else 1969)
	flats = []
	var moon := id == "moon"
	ice_r = 30.0 if moon else 21.0
	craters = [{ "x": L.ice.x, "z": L.ice.y, "r": ice_r, "depth": 8.0 if moon else 5.0, "floor": 0.78, "rim": 0.16 if moon else 0.08 }]
	if moon:
		craters.append({ "x": -96.0, "z": -112.0, "r": 18.0, "depth": 5.5, "floor": 1.0, "rim": 0.3 })
	# keep-out circles so random craters do not land on important places
	var keep := [[0.0, 0.0, 70.0], [L.ice.x, L.ice.y, ice_r + 16], [L.hill.x, L.hill.y, 34.0], [L.mesa.x, L.mesa.y, 30.0],
		[L.rocket.x, L.rocket.y, 24.0], [-96.0, -112.0, 30.0], [L.photo[1].x, L.photo[1].y, 12.0]]
	for g in L.geo:
		keep.append([g.x, g.y, 16.0])
	keep.append([L.colony.x, L.colony.y, 48.0])
	for k in L.inst:
		keep.append([L.inst[k].x, L.inst[k].y, 14.0])
	var free := func(x: float, z: float, pad: float) -> bool:
		for kp in keep:
			var ddx: float = x - kp[0]
			var ddz: float = z - kp[1]
			if sqrt(ddx * ddx + ddz * ddz) < kp[2] + pad:
				return false
		return true
	var n := 46 if moon else 12
	var tries := 0
	while craters.size() < n + (2 if moon else 1) and tries < 900:
		tries += 1
		var a := rng.next() * PI * 2
		var rr := 70 + rng.next() * 270
		var cr := 3.5 + pow(rng.next(), 2) * (22 if moon else 13)
		var cx := cos(a) * rr
		var cz := sin(a) * rr
		if not free.call(cx, cz, cr):
			continue
		craters.append({ "x": cx, "z": cz, "r": cr, "depth": cr * (0.24 if moon else 0.13), "floor": 1.0, "rim": 0.3 if moon else 0.2 })
		keep.append([cx, cz, cr * 0.6])
	_build_grid()

	# level pads so machines, the rocket and work sites sit flat
	var flat := func(p: Vector2, r0: float, r1: float) -> void:
		flats.append({ "x": p.x, "z": p.y, "r0": r0, "r1": r1, "h": raw(p.x, p.y) })
	flat.call(L.rocket, 11, 20)
	flat.call(L.pallet, 4, 9)
	flat.call(L.colony, 36, 48)
	for g in L.geo:
		flat.call(g, 3.5, 8)
	for k in L.inst:
		if k != "beam":
			flat.call(L.inst[k], 3, 7)

	# ice deposits on the floor of the crater / pit
	ice_nodes = []
	for k in 5:
		var ia := k / 5.0 * PI * 2 + 0.5
		var ir := ice_r * (0.16 + 0.14 * (k % 2))
		ice_nodes.append(Vector2(L.ice.x + cos(ia) * ir, L.ice.y + sin(ia) * ir))

	# big boulders you have to walk around
	boulders = []
	var boulder := func(x: float, z: float, r: float) -> void:
		boulders.append({ "x": x, "z": z, "r": r, "sy": 0.6 + rng.next() * 0.6, "rot": rng.next() * 6, "tilt": rng.next() * 0.6, "seat": false })
	var cluster := func(p: Vector2, count: int, spread: float, r_min: float, r_max: float, hole: float) -> void:
		for i in count:
			var ca := rng.next() * PI * 2
			var cd := hole + rng.next() * spread
			boulder.call(p.x + cos(ca) * cd, p.y + sin(ca) * cd, r_min + rng.next() * (r_max - r_min))
	# a low, flat rock with a view of the whole outpost: the seat in the landing film
	boulders.append({ "x": L.seat.x, "z": L.seat.y, "r": 1.25, "sy": 0.42, "rot": 0.6, "tilt": 0.06, "seat": true })
	if moon:
		cluster.call(L.geo[0], 13, 15, 1.1, 3.2, 5)
		cluster.call(L.geo[2], 4, 8, 1, 2, 6)
	else:
		cluster.call(L.geo[0], 5, 8, 1, 2.2, 6)
		cluster.call(L.geo[2], 8, 11, 1.2, 3, 5)
	tries = 0
	while boulders.size() < (46 if moon else 40) and tries < 600:
		tries += 1
		var ba := rng.next() * PI * 2
		var bd := 62 + rng.next() * 150
		var bx := cos(ba) * bd
		var bz := sin(ba) * bd
		if free.call(bx, bz, 2):
			boulder.call(bx, bz, 1 + rng.next() * 2.4)


func _build_grid() -> void:
	_grid = {}
	for i in craters.size():
		var c: Dictionary = craters[i]
		var reach: float = c.r * 1.7
		for gx in range(floori((c.x - reach) / CELL), floori((c.x + reach) / CELL) + 1):
			for gz in range(floori((c.z - reach) / CELL), floori((c.z + reach) / CELL) + 1):
				var k := Vector2i(gx, gz)
				if not _grid.has(k):
					_grid[k] = []
				_grid[k].append(i)


## A place by name, as a Vector3 on the ground.
func at(name: String, lift: float = 0.0) -> Vector3:
	var p: Vector2 = L[name]
	return Vector3(p.x, height(p.x, p.y) + lift, p.y)
