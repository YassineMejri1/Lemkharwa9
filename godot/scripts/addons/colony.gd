extends Node
## The outpost grows into a settlement (the web version's js/colony.js).
## Keep the outpost going and Earth sends ships. On the flat plain north-east of the habitat (Terrain.L.colony)
## a settlement grows in five stages, each one further out from the middle:
##   1. a cargo lander from Earth, crates, a pressurised garage and a rover
##   2. the first settlers: an inflatable home, a pink greenhouse dome, people walking about
##   3. a small town: linked modules, a solar farm, a landing pad with a shuttle, a welcome sign
##   4. a growing town (18 to 31 m out): a passenger ferry, three more homes, a school, a farm of greenhouse
##      tunnels, water and oxygen tanks, a comms mast, lit streets and parked rovers
##   5. the first city (24 to 35 m out): a spaceport with a launch tower, a park under a clear dome, a tower of
##      homes, a town square, more solar panels and a ring road with a little tram
## The side that faces the outpost (colony +z) stays open, so you can always walk or drive in.
## After a win, vision() flies the camera over an imagined future of the same place, 10, 30 and 100 years later.
## The captions stick to real science and say that the future is imagined.
## Parts are baked into a few meshes per building (one per material) and repeated parts use MultiMesh, so the
## whole town costs few draw calls. There are no lights: windows glow with emissive colour.
##
## API (through Game.ext): build(root, site), set_stage(n, opts), stage(), people(n), update(dt, ctx), town(),
## busy(), focus(), info(n), vision(s, done), skip_vision(), vision_time().

const TOWN := { "moon": "Rimlight", "mars": "New Arcadia" }
const LAST := 5
const PEOPLE := [0, 0, 4, 12, 30, 80]       # how many people live there at each stage
const COLORS := [0xff8a3d, 0x4fd8ff, 0x7be36a, 0xff6fb1, 0xffd23f, 0xb48cff, 0xff5468, 0x46e0c0]
const LAND := 6.2
const END := 9.8
const RING := 33.4
const STOPS := [84.0 * PI / 180.0, 266.0 * PI / 180.0, 347.5 * PI / 180.0]
const VT := { "e1": 9.0, "e2": 21.0, "e3": 34.0, "fin": 47.0, "end": 55.0 }
const WORDS := { 4: "Four", 12: "Twelve", 30: "Thirty", 80: "Eighty" }

var site := "mars"
var grp: Node3D = null
var h0 := 0.0
var CX := 40.0
var CZ := -62.0
var ROT := 0.0
var cosR := 1.0
var sinR := 0.0
var M := {}                 # materials, and the soil colours (soil, soil2, road)
var G := {}                 # the shapes every part is made of
var units: Array = []
var stage_now := 0
var arr = null              # the ship landing now
var tm := 0.0
var men = null              # the settlers
var fields: Array = []      # solar panel fields
var fx := {}
var tram = null
var sign_sc = null          # the welcome sign's painted face
var pop_now := 12
var vis = null              # the future vision while it plays
var VM := {}
var VG := {}
var ROUTES := {}
var _holder: Node = null    # the painted signs' SubViewports


# ---------- little helpers ----------
static func _ease(u: float) -> float:
	u = clampf(u, 0, 1)
	return u * u * (3 - 2 * u)


## overshoots a little, then settles
static func _pop(u: float) -> float:
	u = clampf(u, 0, 1) - 1
	return 1 + u * u * (2.7 * u + 1.7)


static func _seg(t: float, a: float, b: float) -> float:
	return clampf((t - a) / (b - a), 0, 1)


## colony coordinates (x to the right, z toward the outpost) to world coordinates, and back
func wx(x: float, z: float) -> float:
	return CX + x * cosR + z * sinR


func wz(x: float, z: float) -> float:
	return CZ - x * sinR + z * cosR


func lx(x: float, z: float) -> float:
	return (x - CX) * cosR - (z - CZ) * sinR


func lz(x: float, z: float) -> float:
	return (x - CX) * sinR + (z - CZ) * cosR


## a placement: position, rotation (three.js 'YXZ', the same as Godot's default order) and scale.
## sy and sz copy sx when left out.
static func mx(x: float, y: float, z: float, rx := 0.0, ry := 0.0, rz := 0.0, sx := 1.0, sy := -1.0, sz := -1.0) -> Transform3D:
	var s := Vector3(sx, sy if sy >= 0.0 else sx, sz if sz >= 0.0 else sx)
	return Transform3D(Basis.from_euler(Vector3(rx, ry, rz)) * Basis.from_scale(s), Vector3(x, y, z))


static func _hexc(hex: int) -> Color:
	return Color.hex((hex << 8) | 0xFF)          # the raw value: three.js used hex colours as linear values


# ---------- shapes ----------
## A shape is a list of triangles { p, n (smooth normals), f (flat normals), uv }, wound the way Godot draws front
## faces (clockwise), worked out from the normals so no generator has to care about winding.
class GB:
	var p := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()

	func tri(a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, ua: Vector2, ub: Vector2, uc: Vector2) -> void:
		if (b - a).cross(c - a).dot(na + nb + nc) > 0.0:
			p.append(a); p.append(c); p.append(b)
			n.append(na); n.append(nc); n.append(nb)
			uv.append(ua); uv.append(uc); uv.append(ub)
		else:
			p.append(a); p.append(b); p.append(c)
			n.append(na); n.append(nb); n.append(nc)
			uv.append(ua); uv.append(ub); uv.append(uc)

	## rows of points: each four neighbours make two triangles
	func grid(P: Array, N: Array, U: Array) -> void:
		for r in P.size() - 1:
			var p0: PackedVector3Array = P[r]
			var p1: PackedVector3Array = P[r + 1]
			var n0: PackedVector3Array = N[r]
			var n1: PackedVector3Array = N[r + 1]
			var u0: PackedVector2Array = U[r]
			var u1: PackedVector2Array = U[r + 1]
			for i in p0.size() - 1:
				tri(p0[i], p1[i], p0[i + 1], n0[i], n1[i], n0[i + 1], u0[i], u1[i], u0[i + 1])
				tri(p1[i], p1[i + 1], p0[i + 1], n1[i], n1[i + 1], n0[i + 1], u1[i], u1[i + 1], u0[i + 1])

	func done() -> Dictionary:
		return { "p": p, "n": n, "f": GB.flat(p, n), "uv": uv }

	## one normal per triangle (three.js flatShading)
	static func flat(pp: PackedVector3Array, nn: PackedVector3Array) -> PackedVector3Array:
		var f := PackedVector3Array()
		f.resize(pp.size())
		var i := 0
		while i + 2 < pp.size():
			var c := (pp[i + 2] - pp[i]).cross(pp[i + 1] - pp[i])      # Godot winding: this way round points out
			if c.length_squared() < 1e-14:
				c = nn[i] + nn[i + 1] + nn[i + 2]
			c = c.normalized()
			f[i] = c
			f[i + 1] = c
			f[i + 2] = c
			i += 3
		return f


static func _box_geo() -> Dictionary:
	var g := GB.new()
	var faces := [[Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0)], [Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 1, 0)],
		[Vector3(0, 1, 0), Vector3(1, 0, 0), Vector3(0, 0, -1)], [Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(0, 0, 1)],
		[Vector3(0, 0, 1), Vector3(1, 0, 0), Vector3(0, 1, 0)], [Vector3(0, 0, -1), Vector3(-1, 0, 0), Vector3(0, 1, 0)]]
	for f in faces:
		var N: Vector3 = f[0]
		var U: Vector3 = f[1]
		var V: Vector3 = f[2]
		var c00 := N * 0.5 - U * 0.5 - V * 0.5
		var c10 := N * 0.5 + U * 0.5 - V * 0.5
		var c11 := N * 0.5 + U * 0.5 + V * 0.5
		var c01 := N * 0.5 - U * 0.5 + V * 0.5
		g.tri(c00, c10, c11, N, N, N, Vector2(0, 1), Vector2(1, 1), Vector2(1, 0))
		g.tri(c00, c11, c01, N, N, N, Vector2(0, 1), Vector2(1, 0), Vector2(0, 0))
	return g.done()


## three.js SphereGeometry(1, ws, hs, phiStart, phiLength, thetaStart, thetaLength)
static func _sphere_geo(ws: int, hs: int, phi0 := 0.0, phiL := TAU, th0 := 0.0, thL := PI) -> Dictionary:
	var P := []
	var N := []
	var U := []
	for iy in hs + 1:
		var v := float(iy) / hs
		var th := th0 + v * thL
		var rp := PackedVector3Array()
		var rn := PackedVector3Array()
		var ru := PackedVector2Array()
		for ix in ws + 1:
			var u := float(ix) / ws
			var ph := phi0 + u * phiL
			var q := Vector3(-cos(ph) * sin(th), cos(th), sin(ph) * sin(th))
			rp.append(q)
			rn.append(q.normalized() if q.length_squared() > 1e-12 else Vector3.UP)
			ru.append(Vector2(u, 1 - v))
		P.append(rp)
		N.append(rn)
		U.append(ru)
	var g := GB.new()
	g.grid(P, N, U)
	return g.done()


## three.js CylinderGeometry(rt, rb, h, radialSegments, 1, openEnded, thetaStart, thetaLength); ConeGeometry is (0, r)
static func _cyl_geo(rt: float, rb: float, h: float, rs: int, open := false, th0 := 0.0, thL := TAU) -> Dictionary:
	var slope := (rb - rt) / h
	var P := []
	var N := []
	var U := []
	for y in 2:
		var radius := y * (rb - rt) + rt
		var rp := PackedVector3Array()
		var rn := PackedVector3Array()
		var ru := PackedVector2Array()
		for x in rs + 1:
			var u := float(x) / rs
			var th := th0 + u * thL
			rp.append(Vector3(radius * sin(th), -y * h + h / 2, radius * cos(th)))
			rn.append(Vector3(sin(th), slope, cos(th)).normalized())
			ru.append(Vector2(u, 1 - y))
		P.append(rp)
		N.append(rn)
		U.append(ru)
	var g := GB.new()
	g.grid(P, N, U)
	if not open:
		for top in [true, false]:
			var r: float = rt if top else rb
			if r <= 0:
				continue
			var sg := 1.0 if top else -1.0
			var cn := Vector3(0, sg, 0)
			var cc := Vector3(0, h / 2 * sg, 0)
			for x in rs:
				var a := th0 + float(x) / rs * thL
				var b := th0 + float(x + 1) / rs * thL
				g.tri(cc, Vector3(r * sin(a), h / 2 * sg, r * cos(a)), Vector3(r * sin(b), h / 2 * sg, r * cos(b)), cn, cn, cn,
					Vector2(0.5, 0.5), Vector2(cos(a) * 0.5 + 0.5, sin(a) * 0.5 * sg + 0.5), Vector2(cos(b) * 0.5 + 0.5, sin(b) * 0.5 * sg + 0.5))
	return g.done()


## three.js TorusGeometry(R, tube, radialSegments, tubularSegments, arc): a ring in the XY plane
static func _torus_geo(R: float, tube: float, radial: int, tubular: int, arc := TAU) -> Dictionary:
	var P := []
	var N := []
	var U := []
	for j in radial + 1:
		var v := float(j) / radial * TAU
		var rp := PackedVector3Array()
		var rn := PackedVector3Array()
		var ru := PackedVector2Array()
		for i in tubular + 1:
			var u := float(i) / tubular * arc
			var q := Vector3((R + tube * cos(v)) * cos(u), (R + tube * cos(v)) * sin(u), tube * sin(v))
			rp.append(q)
			rn.append((q - Vector3(R * cos(u), R * sin(u), 0)).normalized())
			ru.append(Vector2(float(i) / tubular, float(j) / radial))
		P.append(rp)
		N.append(rn)
		U.append(ru)
	var g := GB.new()
	g.grid(P, N, U)
	return g.done()


## three.js CapsuleGeometry(radius, length, capSegments, radialSegments): a pill standing on the y axis
static func _capsule_geo(r: float, length: float, cs: int, rs: int) -> Dictionary:
	var P := []
	var N := []
	var U := []
	var rows := []
	for k in cs + 1:
		rows.append([PI / 2 * k / cs, length / 2])
	for k in cs + 1:
		rows.append([PI / 2 + PI / 2 * k / cs, -length / 2])
	for ri in rows.size():
		var th: float = rows[ri][0]
		var off: float = rows[ri][1]
		var rp := PackedVector3Array()
		var rn := PackedVector3Array()
		var ru := PackedVector2Array()
		for x in rs + 1:
			var ph := float(x) / rs * TAU
			var q := Vector3(sin(th) * sin(ph), cos(th), sin(th) * cos(ph))
			rp.append(q * r + Vector3(0, off, 0))
			rn.append(q)
			ru.append(Vector2(float(x) / rs, 1.0 - float(ri) / (rows.size() - 1)))
		P.append(rp)
		N.append(rn)
		U.append(ru)
	var g := GB.new()
	g.grid(P, N, U)
	return g.done()


## three.js RingGeometry(inner, outer, segments): a flat ring in the XY plane, facing +z
static func _ring_geo(r0: float, r1: float, segs: int) -> Dictionary:
	var P := []
	var N := []
	var U := []
	for r in [r0, r1]:
		var rp := PackedVector3Array()
		var rn := PackedVector3Array()
		var ru := PackedVector2Array()
		for i in segs + 1:
			var a := float(i) / segs * TAU
			var q := Vector3(r * cos(a), r * sin(a), 0)
			rp.append(q)
			rn.append(Vector3(0, 0, 1))
			ru.append(Vector2(q.x / r1 * 0.5 + 0.5, q.y / r1 * 0.5 + 0.5))
		P.append(rp)
		N.append(rn)
		U.append(ru)
	var g := GB.new()
	g.grid(P, N, U)
	return g.done()


## a shape moved, turned or squashed for good (three.js geometry.translate / rotateX / scale)
static func _geo_xform(geo: Dictionary, t: Transform3D) -> Dictionary:
	var nb := Transform3D(t.basis.inverse().transposed(), Vector3.ZERO)
	var p: PackedVector3Array = t * (geo.p as PackedVector3Array)
	var n: PackedVector3Array = nb * (geo.n as PackedVector3Array)
	for i in n.size():
		n[i] = n[i].normalized()
	return { "p": p, "n": n, "f": GB.flat(p, n), "uv": geo.uv }


var _shapes := {}

func _shape(key: String, make: Callable) -> Dictionary:
	if not _shapes.has(key):
		_shapes[key] = make.call()
	return _shapes[key]


func _make_geos() -> Dictionary:
	return {
		"box": _shape("box", func(): return _box_geo()),
		"cyl": _shape("cyl", func(): return _cyl_geo(1, 1, 1, 20)),
		"cyl8": _shape("cyl8", func(): return _cyl_geo(1, 1, 1, 8)),
		"cyl6": _shape("cyl6", func(): return _cyl_geo(1, 1, 1, 6)),
		"ball": _shape("ball", func(): return _sphere_geo(14, 10)),
		"lump": _shape("lump", func(): return _sphere_geo(7, 5)),
		"dome": _shape("dome", func(): return _sphere_geo(26, 12, 0, TAU, 0, PI / 2)),
		"facet": _shape("facet", func(): return _sphere_geo(10, 5, 0, TAU, 0, PI / 2)),
		"cone": _shape("cone", func(): return _cyl_geo(0, 1, 1, 18)),
		"cone6": _shape("cone6", func(): return _cyl_geo(0, 1, 1, 6)),
		"bell": _shape("bell", func(): return _cyl_geo(0.42, 1, 1, 18, true)),
		"ring": _shape("ring", func(): return _torus_geo(1, 0.06, 6, 30)),
		"arch": _shape("arch", func(): return _torus_geo(1, 0.05, 6, 20, PI)),
		"flame": _shape("flame", func(): return _cyl_geo(0, 1, 1, 14, true)),
		"hoop": _shape("hoop", func(): return _torus_geo(1, 0.02, 5, 40)),       # thin ones, for a big dome
		"rib": _shape("rib", func(): return _torus_geo(1, 0.02, 5, 26, PI)),
		"dot": _shape("dot", func(): return _sphere_geo(12, 6)),                 # cheap ones, for the many small windows, lights and hoops
		"band": _shape("band", func(): return _torus_geo(1, 0.06, 4, 20)),
		"disc": _shape("disc", func(): return _cyl_geo(1, 1, 1, 40)),            # a rounder one, for wide floors
		"tunnel": _shape("tunnel", func(): return _cyl_geo(1, 1, 1, 14, true, 0, PI)),    # half a pipe: a greenhouse roof
	}


## a shape as a mesh of its own (for MultiMesh and single parts). flat: one normal per triangle.
func _geo_mesh(geo: Dictionary, flat := false) -> ArrayMesh:
	var key := "mesh_f" if flat else "mesh"
	if geo.has(key):
		return geo[key]
	var a := []
	a.resize(Mesh.ARRAY_MAX)
	a[Mesh.ARRAY_VERTEX] = geo.p
	a[Mesh.ARRAY_NORMAL] = geo.f if flat else geo.n
	a[Mesh.ARRAY_TEX_UV] = geo.uv
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
	geo[key] = m
	return m


# ---------- baking many parts into one mesh per material ----------
class Kit:
	const FLAT := { "rough": true, "gold": true }
	var by := {}
	var base = null          # an optional placement for a whole group of parts (a lamp post, a parked rover)

	func put(kind: String, geo: Dictionary, m: Transform3D, color: int = 0xffffff) -> Kit:
		if base != null:
			m = (base as Transform3D) * m
		var a = by.get(kind)
		if a == null:
			a = { "p": PackedVector3Array(), "n": PackedVector3Array(), "uv": PackedVector2Array(), "c": PackedColorArray() }
			by[kind] = a
		var cnt: int = (geo.p as PackedVector3Array).size()
		var nb := Transform3D(m.basis.inverse().transposed(), Vector3.ZERO)
		var cc := PackedColorArray()
		cc.resize(cnt)
		cc.fill(Color.hex((color << 8) | 0xFF))
		# packed arrays are values: take each one out of the dictionary, grow it in place, and put it back
		var pp: PackedVector3Array = a.p
		var nn: PackedVector3Array = a.n
		var uu: PackedVector2Array = a.uv
		var co: PackedColorArray = a.c
		a.p = null
		a.n = null
		a.uv = null
		a.c = null
		pp.append_array(m * (geo.p as PackedVector3Array))
		nn.append_array(nb * ((geo.f if FLAT.has(kind) else geo.n) as PackedVector3Array))
		uu.append_array(geo.uv)
		co.append_array(cc)
		a.p = pp
		a.n = nn
		a.uv = uu
		a.c = co
		return self

	func mesh(kind: String) -> ArrayMesh:
		var a = by.get(kind)
		var arrs := []
		arrs.resize(Mesh.ARRAY_MAX)
		arrs[Mesh.ARRAY_VERTEX] = a.p
		arrs[Mesh.ARRAY_NORMAL] = a.n
		arrs[Mesh.ARRAY_COLOR] = a.c
		arrs[Mesh.ARRAY_TEX_UV] = a.uv
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrs)
		return am

	func bake(parent: Node3D, mats: Dictionary) -> Array:
		var out := []
		for kind in by:
			var mat: Material = mats[kind]
			var mi := MeshInstance3D.new()
			mi.mesh = mesh(kind)
			mi.material_override = mat
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if mat.has_meta("no_shadow") else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			parent.add_child(mi)
			out.append(mi)
		by = {}
		return out


# ---------- materials ----------
static func _std(hex: int, rough: float, metal: float, vertex_colors := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Mats.lin(hex)
	m.roughness = rough
	m.metallic = metal
	m.vertex_color_use_as_albedo = vertex_colors
	return m


static func _glow_mat(hex: int, i: float) -> StandardMaterial3D:
	var m := Mats.glow(hex, i)
	m.set_meta("no_shadow", true)
	return m


## additive and see-through: flames and haze
static func _add_mat(hex: int, opacity: float) -> StandardMaterial3D:
	var m := Mats.unlit(hex, opacity, true)
	m.set_meta("no_shadow", true)
	return m


## clear glass with a soft glow of its own
static func _glass(hex: int, opacity: float, rough: float, metal: float, em: int, ei: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Mats.lin(hex, opacity)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = rough
	m.metallic = metal
	m.emission_enabled = true
	m.emission = Mats.lin(em)
	m.emission_energy_multiplier = ei
	m.set_meta("no_shadow", true)
	return m


static func _solar_tex() -> ImageTexture:
	var s := 128
	var img := Image.create(s, s, false, Image.FORMAT_RGBA8)
	img.fill(Color("#14306b"))
	var c := Color("#6fa3ff")
	for i in 5:
		for q in [i * s / 4 - 1, i * s / 4]:
			var k := clampi(q, 0, s - 1)
			img.fill_rect(Rect2i(k, 0, 1, s), c)
			img.fill_rect(Rect2i(0, k, s, 1), c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _glow_tex() -> GradientTexture2D:
	var gr := Gradient.new()
	gr.offsets = PackedFloat32Array([0.0, 0.35, 1.0])
	gr.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.45), Color(1, 1, 1, 0)])
	var t := GradientTexture2D.new()
	t.gradient = gr
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	return t


func _make_mats() -> Dictionary:
	var m := {
		"soft": _std(0xffffff, 0.6, 0.05),
		"rough": _std(0xffffff, 0.9, 0.02),
		"metal": _std(0xffffff, 0.32, 0.72),
		"gold": _std(0xe3ad42, 0.34, 0.85, false),
		"white": Mats.soft(0xf5f6fa),
		"helmet": Mats.soft(0xffffff, { "roughness": 0.4 }),
		"visor": _std(0xffc64a, 0.12, 0.95, false),
		"win": _glow_mat(0xffd98a, 1.5), "pink": _glow_mat(0xff5fd0, 1.9), "cyan": _glow_mat(0x7fe8ff, 1.5), "green": _glow_mat(0x4dff9a, 1.6),
		"amber": _glow_mat(0xffb84d, 1.6), "ring": _glow_mat(0xffd23f, 1.2), "blink": _glow_mat(0xff4a4a, 2), "blink2": _glow_mat(0x46ff8a, 2),
		"glass": _glass(0xffd6f4, 0.3, 0.08, 0.1, 0xff5fd0, 0.3),
		"haze": _add_mat(0xff4fc8, 0.2),
		# the park dome: clear, a little blue, like a shell of ice
		"ice": _glass(0xdff4ff, 0.24, 0.05, 0.2, 0x7fc4ff, 0.22),
		"water": _glow_mat(0x3aa0ff, 0.6),
	}
	(m.metal as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	var gold: StandardMaterial3D = m.gold
	gold.emission_enabled = true
	gold.emission = Mats.lin(0x3a2600)
	gold.emission_energy_multiplier = 0.45
	var visor: StandardMaterial3D = m.visor
	visor.emission_enabled = true
	visor.emission = Mats.lin(0x6b4a08)
	visor.emission_energy_multiplier = 0.35
	(m.helmet as StandardMaterial3D).vertex_color_use_as_albedo = true      # each helmet has its own colour (MultiMesh colours)
	var solar := _std(0xffffff, 0.25, 0.5, false)
	solar.albedo_texture = _solar_tex()
	solar.emission_enabled = true
	solar.emission = Mats.lin(0x1b3f96)
	solar.emission_energy_multiplier = 0.3
	m.solar = solar
	var gg := Mats.unlit(0xffa040, 0.0, true)
	gg.albedo_texture = _glow_tex()
	gg.set_meta("no_shadow", true)
	m.groundGlow = gg
	m.soil = 0xa9582f if site == "mars" else 0x7b7c87
	m.soil2 = 0x8e4524 if site == "mars" else 0x666772
	m.road = 0x5a3a2a if site == "mars" else 0x3d3f4a      # packed, baked soil: the streets and the ring road
	return m


func _mm(mesh: Mesh, mat: Material, n: int, shadow := true, colors := false) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = maxi(1, n)
	mm.visible_instance_count = 0
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


# ---------- buildings ----------
## A unit is one building (or ship) that appears in one go. Its colliders are kept until it is shown.
func _unit(stage: int, x: float, z: float, ry := 0.0, delay := 0.0) -> Dictionary:
	var g := Node3D.new()
	g.position = Vector3(x, 0, z)
	g.rotation.y = ry
	g.visible = false
	grp.add_child(g)
	var u := { "stage": stage, "g": g, "kit": Kit.new(), "cols": [], "on": false, "delay": delay, "ship": null, "pre": false,
		"meshes": [], "home": Vector3.ZERO, "done": false }
	units.append(u)
	return u


## a collider: a circle on the ground that stops walking, driving and thrown things. h: how tall it is (3.4 m if left out)
func _col(u: Dictionary, x: float, z: float, r: float, h := 0.0) -> Dictionary:
	var g: Node3D = u.g
	var c := cos(g.rotation.y)
	var s := sin(g.rotation.y)
	var gx := g.position.x + x * c + z * s
	var gz := g.position.z - x * s + z * c
	var o := { "x": wx(gx, gz), "z": wz(gx, gz), "r": r }
	if h:
		o.h = h
	(u.cols as Array).append(o)
	return o


func _bake(u: Dictionary) -> Dictionary:
	u.meshes = (u.kit as Kit).bake(u.g, M)
	return u


## four landing legs from the body out to round feet
func _legs(k: Kit, top: float, r0: float, r1: float, h: float, kind: String, color: int) -> void:
	var phi := atan2(r1 - r0, h - 0.3)
	var length := Vector2(r1 - r0, h - 0.3).length()
	for i in 4:
		var a := PI / 4 + i * PI / 2
		var sa := sin(a)
		var ca := cos(a)
		var rm := (r0 + r1) / 2
		k.put(kind, G.box, mx(sa * rm, (h + 0.3) / 2, ca * rm, -phi, a, 0, 0.24, length, 0.24), color)
		k.put("soft", G.cyl, mx(sa * r1, 0.1, ca * r1, 0, 0, 0, 0.55, 0.2, 0.55), 0x3a3e4c)
		k.put("soft", G.box, mx(sa * (r0 + 0.25), top - 0.2, ca * (r0 + 0.25), 0, a, 0, 0.4, 0.4, 0.4), 0x3a3e4c)


func _flame(u: Dictionary, y: float, r: float, length: float) -> void:
	var g: Node3D = u.g
	g.rotation_order = EULER_ORDER_XYZ          # like three.js: the ship leans after it has turned
	var f := MeshInstance3D.new()
	f.mesh = _geo_mesh(G.flame)
	f.material_override = _add_mat(0xff9a30, 0.9)
	f.position = Vector3(0, y - length / 2, 0)
	f.rotation.x = PI
	f.scale = Vector3(r, length, r)
	f.visible = false
	f.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(f)
	var core := MeshInstance3D.new()
	core.mesh = _geo_mesh(G.flame)
	core.material_override = _add_mat(0xfff2c0, 0.9)
	core.position = Vector3(0, y - length * 0.28, 0)
	core.rotation.x = PI
	core.scale = Vector3(r * 0.42, length * 0.45, r * 0.42)
	core.visible = false
	core.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(core)
	u.ship = { "flame": f, "core": core, "len": length, "y": y }


# stage 1: a squat cargo lander wrapped in gold foil, with a big engine bell
func _cargo_lander(u: Dictionary) -> void:
	var k: Kit = u.kit
	_legs(k, 2.7, 2.0, 3.6, 2.7, "metal", 0xb8bcc8)
	k.put("metal", G.bell, mx(0, 1.65, 0, 0, 0, 0, 1.3, 1.7, 1.3), 0x3a3e4c)
	k.put("gold", G.cyl8, mx(0, 3.45, 0, 0, PI / 8, 0, 2.3, 1.9, 2.3))
	k.put("soft", G.cyl8, mx(0, 2.5, 0, 0, PI / 8, 0, 2.35, 0.16, 2.35), 0x3a3e4c)
	k.put("soft", G.cyl8, mx(0, 4.52, 0, 0, PI / 8, 0, 2.5, 0.26, 2.5), 0xf2f3f7)
	k.put("soft", G.box, mx(-0.85, 5.2, 0.45, 0, 0.1, 0, 1.4, 1.1, 1.4), 0xf2f3f7)
	k.put("soft", G.box, mx(-0.85, 5.2, 0.45, 0, 0.1, 0, 1.44, 0.22, 1.44), 0x3d7dff)
	k.put("soft", G.box, mx(0.95, 5.05, -0.35, 0, -0.2, 0, 1.2, 0.8, 1.6), 0xff8a3d)
	for i in 4:
		var a := i * PI / 2
		k.put("soft", G.box, mx(sin(a) * 2.32, 4.0, cos(a) * 2.32, 0, a, 0, 0.5, 0.36, 0.3), 0x2b3147)
	k.put("soft", G.cyl, mx(-1.5, 5.3, -1.2, 0, 0, 0, 0.05, 1.4, 0.05), 0xdfe2ea)
	k.put("soft", G.dome, mx(1.2, 4.9, 1.3, -0.9, 0.6, 0, 0.7, 0.25, 0.7), 0xf2f3f7)
	k.put("soft", G.box, mx(0, 1.27, 3.55, 0.775, 0, 0, 1.2, 0.1, 3.5), 0x8a8fa0)              # the unloading ramp
	k.put("blink", G.ball, mx(-1.5, 6.05, -1.2, 0, 0, 0, 0.13))
	k.put("blink", G.ball, mx(2.2, 4.75, 0.9, 0, 0, 0, 0.11))
	k.put("blink2", G.ball, mx(-2.2, 4.75, -0.9, 0, 0, 0, 0.11))
	k.put("amber", G.box, mx(0, 3.5, 2.24, 0, 0, 0, 1.0, 0.16, 0.06))
	_bake(u)
	_flame(u, 0.8, 1.2, 6)
	_col(u, 0, 0, 3.5, 6)


func _crates(u: Dictionary) -> void:
	var k: Kit = u.kit
	var list := [[-1.7, 0.0, -1.0, 0xf2f3f7, 0.0], [0.0, 0.0, -1.0, 0xff8a3d, 0.05], [1.7, 0.0, -1.05, 0xf2f3f7, -0.04], [-1.7, 0.0, 1.0, 0x3d7dff, 0.03],
		[0.05, 0.0, 1.0, 0xf2f3f7, -0.06], [-1.7, 1.18, -1.0, 0xffd23f, 0.1]]
	for i in list.size():
		var c: Array = list[i]
		var col: int = c[3]
		k.put("soft", G.box, mx(c[0], c[1] + 0.58, c[2], 0, c[4], 0, 1.55, 1.15, 1.75), col)
		k.put("soft", G.box, mx(c[0], c[1] + 0.58, c[2], 0, c[4], 0, 1.6, 0.2, 1.8), 0x3d7dff if col == 0xf2f3f7 else 0xf2f3f7)
		k.put("amber" if i % 2 else "green", G.box, mx(c[0] + 0.79, c[1] + 0.85, c[2], 0, c[4], 0, 0.04, 0.16, 0.5))
	for p in [[1.9, 1.0], [1.9, 2.3]]:
		var x: float = p[0]
		var z: float = p[1]
		k.put("soft", G.cyl, mx(x, 0.62, z, 0, 0, PI / 2, 0.55, 1.9, 0.55), 0xf2f3f7)
		k.put("soft", G.ball, mx(x - 0.95, 0.62, z, 0, 0, 0, 0.55, 0.55, 0.55), 0xf2f3f7)
		k.put("soft", G.ball, mx(x + 0.95, 0.62, z, 0, 0, 0, 0.55, 0.55, 0.55), 0xf2f3f7)
		k.put("soft", G.ring, mx(x, 0.62, z, 0, PI / 2, 0, 0.57, 0.57, 0.57), 0x3d7dff)
		k.put("soft", G.box, mx(x, 0.12, z, 0, 0, 0, 1.6, 0.24, 0.7), 0x3a3e4c)
	_bake(u)
	_col(u, -1.1, 0, 1.9, 2.4)
	_col(u, 1.0, -0.6, 1.5, 1.3)
	_col(u, 1.9, 1.6, 1.3, 1.2)


# a pressurised tent: half buried, it holds air like a balloon, with a garage door at the front
func _garage(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", _shape("cap2.3", func(): return _capsule_geo(2.3, 2.4, 6, 20)), mx(0, 0, 0, PI / 2, 0, 0), 0xf1ece0)
	for z in [-2.2, -0.75, 0.7, 2.1]:
		k.put("soft", G.arch, mx(0, 0, z, 0, 0, 0, 2.36), 0xff8a3d)
	k.put("soft", G.box, mx(0, 1.15, 3.5, 0, 0, 0, 2.2, 2.3, 1.8), 0xc3c7d2)
	k.put("soft", G.box, mx(0, 2.35, 3.5, 0, 0, 0, 2.4, 0.2, 2.0), 0xff8a3d)
	k.put("soft", G.box, mx(0, 0.95, 4.42, 0, 0, 0, 1.5, 1.8, 0.08), 0x2b3147)
	k.put("green", G.box, mx(0, 2.05, 4.43, 0, 0, 0, 1.4, 0.16, 0.08))
	for z in [-1.2, 1.2]:
		for s in [-1.0, 1.0]:
			k.put("cyan", G.ball, mx(s * 1.86, 1.35, z, 0, s * 0.62, 0, 0.36, 0.3, 0.1))
	_bake(u)
	_col(u, 0, -2.1, 2.4, 2.4)
	_col(u, 0, 0.4, 2.4, 2.4)
	_col(u, 0, 3.5, 1.5, 2.5)


func _rover_parts(k: Kit, trim := 0xff8a3d) -> void:
	k.put("soft", _shape("cap0.95", func(): return _capsule_geo(0.95, 2.3, 5, 14)), mx(0, 1.4, 0, PI / 2, 0, 0), 0xf2f3f7)
	k.put("soft", G.box, mx(0, 1.15, 0, 0, 0, 0, 2.0, 0.3, 3.8), trim)
	k.put("cyan", G.box, mx(0, 1.75, 1.95, -0.5, 0, 0, 1.3, 0.45, 0.1))
	for s in [-1.0, 1.0]:
		k.put("cyan", G.box, mx(s * 0.92, 1.65, 0.2, 0, 0, 0, 0.06, 0.32, 1.5))
	for z in [-1.2, 0.0, 1.2]:
		for x in [-1.02, 1.02]:
			k.put("soft", G.cyl, mx(x, 0.45, z, 0, 0, PI / 2, 0.45, 0.36, 0.45), 0x22252f)
			k.put("soft", G.cyl, mx(x * 1.02, 0.45, z, 0, 0, PI / 2, 0.22, 0.4, 0.22), 0xdfe2ea)
	k.put("soft", G.cyl, mx(0.5, 2.7, -0.9, 0, 0, 0, 0.03, 1.0, 0.03), 0xdfe2ea)
	k.put("blink", G.ball, mx(0.5, 3.25, -0.9, 0, 0, 0, 0.08))
	k.put("win", G.ball, mx(-0.6, 1.2, 2.3, 0, 0, 0, 0.16))
	k.put("win", G.ball, mx(0.6, 1.2, 2.3, 0, 0, 0, 0.16))


func _rover(u: Dictionary) -> void:
	_rover_parts(u.kit)
	_bake(u)
	_col(u, 0, -0.9, 1.3, 2.4)
	_col(u, 0, 0.9, 1.3, 2.4)


## one more rover, parked somewhere inside a bigger unit
func _park_rover(u: Dictionary, x: float, z: float, yaw: float, trim: int) -> void:
	var k: Kit = u.kit
	k.base = mx(x, 0, z, 0, yaw, 0)
	_rover_parts(k, trim)
	k.base = null
	_col(u, x - sin(yaw) * 0.9, z - cos(yaw) * 0.9, 1.3, 2.4)
	_col(u, x + sin(yaw) * 0.9, z + cos(yaw) * 0.9, 1.3, 2.4)


func _path_lights(u: Dictionary) -> void:
	var k: Kit = u.kit
	for z in [6.0, 10.0, 14.0, 18.0, 21.5]:
		for x in [-2.7, 2.7]:
			k.put("soft", G.cyl, mx(x, 0.45, z, 0, 0, 0, 0.05, 0.9, 0.05), 0x8a8fa0)
			k.put("win", G.ball, mx(x, 0.96, z, 0, 0, 0, 0.14))
	_bake(u)


# stage 2: a tall crew lander, an inflatable home under soil bags, a glowing greenhouse
func _crew_lander(u: Dictionary) -> void:
	var k: Kit = u.kit
	_legs(k, 2.5, 1.6, 3.0, 2.5, "soft", 0xb8bcc8)
	k.put("metal", G.bell, mx(0, 1.4, 0, 0, 0, 0, 1.0, 1.3, 1.0), 0x3a3e4c)
	k.put("soft", G.cyl, mx(0, 4.25, 0, 0, 0, 0, 1.9, 4.2, 1.9), 0xf4f5f9)
	k.put("soft", G.cone, mx(0, 7.65, 0, 0, 0, 0, 1.9, 2.6, 1.9), 0xf4f5f9)
	k.put("soft", G.cyl, mx(0, 2.15, 0, 0, 0, 0, 1.95, 0.12, 1.95), 0x2b3147)
	for y in [3.0, 5.9]:
		k.put("soft", G.ring, mx(0, y, 0, PI / 2, 0, 0, 1.93), 0x3d7dff)
	for a in [-0.55, 0.0, 0.55]:
		k.put("win", G.ball, mx(sin(a) * 1.86, 5.2, cos(a) * 1.86, 0, a, 0, 0.3, 0.3, 0.12))
	k.put("soft", G.box, mx(0, 3.55, 1.88, 0, 0, 0, 1.0, 1.4, 0.12), 0x2b3147)
	k.put("soft", G.box, mx(0, 1.55, 2.35, -0.18, 0, 0, 0.7, 3.1, 0.08), 0x8a8fa0)
	k.put("blink", G.ball, mx(0, 9.05, 0, 0, 0, 0, 0.14))
	k.put("soft", G.box, mx(-1.95, 4.6, 0, 0, 0, 0, 0.12, 2.2, 0.9), 0x3d7dff)
	k.put("soft", G.box, mx(1.95, 4.6, 0, 0, 0, 0, 0.12, 2.2, 0.9), 0x3d7dff)
	_bake(u)
	_flame(u, 0.75, 1.0, 5)
	_col(u, 0, 0, 2.9, 9)


func _hab2(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", _shape("cap2.5", func(): return _capsule_geo(2.5, 3.0, 6, 24)), mx(0, 2.45, 0, PI / 2, 0, 0), 0xf4f5f9)
	for z in [-1.5, 0.0, 1.5]:
		k.put("soft", G.ring, mx(0, 2.45, z, 0, 0, 0, 2.53), 0xc3c7d2)
	for z in [-2.5, 2.5]:
		k.put("soft", G.box, mx(0, 0.3, z, 0, 0, 0, 4.4, 0.6, 0.7), 0x3a3e4c)
	for z in [-2.3, -0.75, 0.75, 2.3]:
		k.put("win", G.ball, mx(-2.43, 2.9, z, 0, 0, 0, 0.13, 0.36, 0.5))
	for z in [-1.5, 1.5]:
		k.put("win", G.ball, mx(2.43, 2.9, z, 0, 0, 0, 0.13, 0.36, 0.5))
	# soil bags on the roof: two metres of dirt stop most space radiation
	for i in range(-1, 2):
		var z := -2.7
		while z <= 2.8:
			var a := i * 0.5
			var soil: int = M.soil if absi(roundi(z / 1.1) + i) % 2 else M.soil2
			k.put("rough", G.lump, mx(sin(a) * 2.62, 2.45 + cos(a) * 2.62, z + (0.25 if i else 0.0), 0, 0, -a, 0.62, 0.3, 0.52), soil)
			z += 1.1
	k.put("soft", G.box, mx(-2.9, 1.05, 1.5, 0, 0, 0, 1.5, 2.1, 1.5), 0xc3c7d2)
	k.put("soft", G.box, mx(-3.66, 0.95, 1.5, 0, 0, 0, 0.08, 1.7, 1.0), 0x2b3147)
	k.put("green", G.box, mx(-3.67, 2.0, 1.5, 0, 0, 0, 0.08, 0.16, 1.1))
	# the airlock tunnel to the greenhouse
	k.put("soft", G.cyl, mx(0, 1.0, 5.1, PI / 2, 0, 0, 0.85, 3.4, 0.85), 0xdfe2ea)
	for z in [4.1, 5.1, 6.1]:
		k.put("soft", G.ring, mx(0, 1.0, z, 0, 0, 0, 0.88), 0x3d7dff)
	k.put("cyan", G.box, mx(0, 1.86, 5.1, 0, 0, 0, 0.12, 0.05, 2.8))
	_bake(u)
	_col(u, 0, -2.6, 2.6, 5.2)
	_col(u, 0, 0, 2.6, 5.2)
	_col(u, 0, 2.6, 2.6, 5.2)
	_col(u, -2.95, 1.5, 0.95, 2.2)
	_col(u, 0, 4.6, 1.0, 1.9)
	_col(u, 0, 6.0, 1.0, 1.9)


func _greenhouse(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.cyl, mx(0, 0.15, 0, 0, 0, 0, 3.15, 0.3, 3.15), 0xd7dae3)
	for i in 3:
		k.put("soft", G.arch, mx(0, 0.28, 0, 0, i * PI / 3, 0, 3.02), 0xf4f5f9)
	k.put("soft", G.ring, mx(0, 1.4, 0, PI / 2, 0, 0, 2.72), 0xf4f5f9)
	var zs := [-1.1, 0.0, 1.1]
	for r in 3:
		var z: float = zs[r]
		k.put("soft", G.box, mx(0, 0.55, z, 0, 0, 0, 3.4, 0.5, 0.62), 0xf4f5f9)
		k.put("rough", G.box, mx(0, 0.82, z, 0, 0, 0, 3.2, 0.06, 0.5), 0x4a3324)
		var x := -1.25
		while x <= 1.3:
			k.put("soft", G.cone, mx(x, 1.15, z, 0, x + r, 0, 0.26, 0.62, 0.26), 0x4fd15a if (r + roundi(x)) % 2 else 0x2fa64a)
			x += 0.83
		k.put("pink", G.box, mx(0, 2.0 - absf(z) * 0.35, z, 0, 0, 0, 2.8, 0.07, 0.12))
	k.put("glass", G.facet, mx(0, 0.28, 0, 0, 0.3, 0, 3.0))
	k.put("haze", G.dome, mx(0, 0.28, 0, 0, 0, 0, 2.75))
	k.put("soft", G.box, mx(-3.0, 0.95, 0, 0, 0, 0, 1.2, 1.9, 1.4), 0xc3c7d2)
	k.put("soft", G.box, mx(-3.62, 0.9, 0, 0, 0, 0, 0.06, 1.6, 0.9), 0x2b3147)
	k.put("pink", G.box, mx(-3.63, 1.95, 0, 0, 0, 0, 0.06, 0.14, 1.0))
	_bake(u)
	_col(u, 0, 0, 3.25, 3.3)
	_col(u, -3.1, 0, 0.85, 2)


# stage 3: a two-storey hub, a shielded dome, tubes, a landing pad, a shuttle, a solar farm, a sign
func _hub(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.cyl, mx(0, 0.2, 0, 0, 0, 0, 3.3, 0.4, 3.3), 0xd7dae3)
	k.put("soft", G.cyl, mx(0, 3.4, 0, 0, 0, 0, 3.0, 6.0, 3.0), 0xf4f5f9)
	k.put("soft", G.dome, mx(0, 6.4, 0, 0, 0, 0, 3.0), 0xf4f5f9)
	for y in [0.9, 3.4, 6.35]:
		k.put("soft", G.ring, mx(0, y, 0, PI / 2, 0, 0, 3.03), 0x3d7dff)
	for r in 2:
		for a in 8:
			var ang := (a + 0.5 + r * 0.5) * PI / 4
			if r == 0 and (a == 7 or a == 0):
				continue                     # the door is here
			k.put("win", G.ball, mx(sin(ang) * 2.98, 4.7 if r else 2.2, cos(ang) * 2.98, 0, ang, 0, 0.42, 0.42, 0.12))
	k.put("soft", G.box, mx(0, 1.15, 3.3, 0, 0, 0, 1.7, 2.3, 1.4), 0xc3c7d2)
	k.put("soft", G.box, mx(0, 2.35, 3.3, 0, 0, 0, 1.9, 0.2, 1.6), 0x3d7dff)
	k.put("soft", G.box, mx(0, 0.95, 4.02, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147)
	k.put("green", G.box, mx(0, 2.0, 4.03, 0, 0, 0, 1.2, 0.15, 0.06))
	k.put("soft", G.cyl, mx(0, 10.6, 0, 0, 0, 0, 0.07, 2.6, 0.07), 0xdfe2ea)
	k.put("blink", G.ball, mx(0, 11.95, 0, 0, 0, 0, 0.16))
	k.put("soft", G.dome, mx(1.3, 9.0, -0.4, -1.0, 0.4, 0, 0.8, 0.3, 0.8), 0xf4f5f9)
	k.put("win", G.cyl, mx(0, 9.42, 0, 0, 0, 0, 0.9, 0.05, 0.9))
	_bake(u)
	_col(u, 0, 0, 3.35, 9.5)
	_col(u, 0, 3.3, 1.0, 2.5)


func _shield_dome(u: Dictionary) -> void:
	var k: Kit = u.kit
	var n := 0
	k.put("soft", G.dome, mx(0, 0, 0, 0, 0, 0, 3.2, 2.85, 3.2), 0xf4f5f9)
	for r in [[0.22, 13], [0.68, 10], [1.1, 6]]:
		var e: float = r[0]
		var cnt: int = r[1]
		for i in cnt:
			var a := (i + (0.5 if e > 0.5 else 0.0)) / cnt * TAU
			if e < 0.3 and absf(atan2(sin(a), cos(a))) < 0.4:
				continue                     # keep the door clear
			k.put("rough", G.lump, mx(sin(a) * cos(e) * 3.32, sin(e) * 2.95, cos(a) * cos(e) * 3.32, PI / 2 - e, a, 0, 0.95, 0.42, 0.72), M.soil if n % 2 else M.soil2)
			n += 1
	k.put("rough", G.lump, mx(0, 2.95, 0, 0, 0.4, 0, 0.9, 0.4, 0.9), M.soil)
	k.put("soft", G.cyl, mx(0, 1.05, 3.45, PI / 2, 0, 0, 1.0, 2.2, 1.0), 0xc3c7d2)
	k.put("soft", G.ring, mx(0, 1.05, 4.52, 0, 0, 0, 1.02), 0xff8a3d)
	k.put("soft", G.cyl, mx(0, 0.95, 4.55, PI / 2, 0, 0, 0.7, 0.04, 0.85), 0x2b3147)
	k.put("green", G.box, mx(0, 1.95, 4.5, 0, 0, 0, 0.9, 0.12, 0.1))
	k.put("win", G.cyl, mx(0, 3.32, 0, 0, 0, 0, 0.75, 0.06, 0.75))
	_bake(u)
	_col(u, 0, 0, 3.55, 3.3)
	_col(u, 0, 3.7, 1.1, 2.1)


func _tube(k: Kit, cols: Array, ax: float, az: float, bx: float, bz: float) -> void:
	var dx := bx - ax
	var dz := bz - az
	var length := Vector2(dx, dz).length()
	var yaw := atan2(dx, dz)
	k.put("soft", G.cyl, mx((ax + bx) / 2, 1.0, (az + bz) / 2, PI / 2, yaw, 0, 0.75, length, 0.75), 0xdfe2ea)
	for t in [0.15, 0.5, 0.85]:
		k.put("soft", G.ring, mx(ax + dx * t, 1.0, az + dz * t, 0, yaw, 0, 0.79), 0x3d7dff)
	k.put("cyan", G.box, mx((ax + bx) / 2, 1.76, (az + bz) / 2, 0, yaw, 0, 0.1, 0.05, length * 0.8))
	var d := 0.7
	while d < length:
		cols.append([ax + dx * d / length, az + dz * d / length, 0.9])
		d += 1.4


func _tubes(u: Dictionary) -> void:
	var cols := []
	_tube(u.kit, cols, 1.9, -6.0, 7.0, -6.0)
	_tube(u.kit, cols, -3.05, -3.95, -5.7, -1.3)
	_bake(u)
	for c in cols:
		_col(u, c[0], c[1], c[2], 1.8)


## a hard landing pad. r: how big (the first one is 4.1 m)
func _pad(u: Dictionary, r := 4.1) -> void:
	var k: Kit = u.kit
	var s := r / 4.1
	k.put("soft", G.cyl, mx(0, 0.12, 0, 0, 0, 0, 4.1 * s, 0.24, 4.1 * s), 0x4a4f63)
	k.put("ring", G.ring, mx(0, 0.26, 0, PI / 2, 0, 0, 3.4 * s, 3.4 * s, 1.4))
	for i in 8:
		k.put("amber", G.dot, mx(sin(i * PI / 4) * 3.9 * s, 0.3, cos(i * PI / 4) * 3.9 * s, 0, 0, 0, 0.13))
	for x in [-0.75, 0.75]:
		k.put("soft", G.box, mx(x * s, 0.25, 0, 0, 0, 0, 0.32 * s, 0.03, 2.1 * s), 0xf2f3f7)
	k.put("soft", G.box, mx(0, 0.25, 0, 0, 0, 0, 1.5 * s, 0.03, 0.32 * s), 0xf2f3f7)
	_bake(u)


func _shuttle(u: Dictionary) -> void:
	var k: Kit = u.kit
	_legs(k, 2.0, 1.3, 2.7, 2.0, "soft", 0xb8bcc8)
	k.put("metal", G.bell, mx(0, 1.15, 0, 0, 0, 0, 0.95, 1.1, 0.95), 0x3a3e4c)
	k.put("soft", G.cyl6, mx(0, 3.7, 0, 0, PI / 6, 0, 1.6, 3.9, 1.6), 0xf4f5f9)
	k.put("soft", G.cone6, mx(0, 7.0, 0, 0, PI / 6, 0, 1.6, 2.7, 1.6), 0xf4f5f9)
	k.put("soft", G.cone6, mx(0, 8.15, 0, 0, PI / 6, 0, 0.55, 0.5, 0.55), 0xff8a3d)
	k.put("soft", G.cyl6, mx(0, 1.8, 0, 0, PI / 6, 0, 1.62, 0.3, 1.62), 0x2b3147)
	for x in [-2.05, 2.05]:
		k.put("soft", G.cyl, mx(x, 3.3, 0, 0, 0, 0, 0.55, 3.4, 0.55), 0xff8a3d)
		k.put("soft", G.cone, mx(x, 5.45, 0, 0, 0, 0, 0.55, 0.9, 0.55), 0xff8a3d)
		k.put("metal", G.bell, mx(x, 1.3, 0, 0, 0, 0, 0.42, 0.6, 0.42), 0x3a3e4c)
		k.put("soft", G.box, mx(x * 0.72, 3.9, 0, 0, 0, 0, 0.9, 0.3, 0.5), 0xdfe2ea)
	k.put("cyan", G.box, mx(0, 6.1, 1.3, -0.28, 0, 0, 1.3, 0.42, 0.1))
	k.put("soft", G.box, mx(0, 2.95, 1.42, 0, 0, 0, 0.95, 1.4, 0.1), 0x2b3147)
	k.put("soft", G.box, mx(0, 1.25, 2.1, -0.32, 0, 0, 0.8, 2.6, 0.08), 0x8a8fa0)
	k.put("blink2", G.ball, mx(0, 8.5, 0, 0, 0, 0, 0.12))
	_bake(u)
	_flame(u, 0.6, 0.95, 4.6)
	_col(u, 0, 0, 2.7, 8.5)


## a field of solar panels on poles. list: where the poles stand. The panels are two MultiMeshes.
func _panel_field(u: Dictionary, list: Array) -> void:
	var k: Kit = u.kit
	var moon := site == "moon"
	for p in list:
		k.put("soft", G.cyl, mx(p[0], 1.6 if moon else 0.7, p[1], 0, 0, 0, 0.09, 3.2 if moon else 1.4, 0.09), 0xdfe2ea)
		k.put("soft", G.cyl, mx(p[0], 0.1, p[1], 0, 0, 0, 0.4, 0.2, 0.4), 0x8a8fa0)
		_col(u, p[0], p[1], 0.55 if moon else 1.0, 4.7 if moon else 2.3)
	var im := _mm(_geo_mesh(G.box), M.solar, list.size())
	var fr := _mm(_geo_mesh(G.box), M.white, list.size())
	im.multimesh.visible_instance_count = -1
	fr.multimesh.visible_instance_count = -1
	(u.g as Node3D).add_child(im)
	(u.g as Node3D).add_child(fr)
	fields.append({ "im": im, "fr": fr, "list": list, "yaw": null, "moon": moon })


func _solar_farm(u: Dictionary) -> void:
	var k: Kit = u.kit
	var list := []
	for x in [15.5, 19.0]:
		for z in [-5.0, -2.0, 1.0, 4.0, 7.0]:
			list.append([x, z])
	_panel_field(u, list)
	k.put("soft", G.box, mx(13.9, 0.6, -7.6, 0, 0.3, 0, 1.6, 1.2, 1.0), 0xc3c7d2)
	k.put("green", G.box, mx(13.9, 0.9, -7.08, 0, 0.3, 0, 0.9, 0.12, 0.05))
	_bake(u)
	_col(u, 13.9, -7.6, 1.0, 1.2)


## the panels follow the low Sun on the Moon; on Mars they lean back toward the sky
func _aim_panels(force: bool) -> void:
	var sd := World.sun_dir
	for f in fields:
		var yaw: float
		var pitch: float
		if f.moon:
			yaw = atan2(sd.x, sd.z) - ROT
			pitch = clampf(asin(clampf(sd.y, -1, 1)), 0.05, 0.4)
		else:
			yaw = -ROT
			pitch = 0.9
		if not force and f.yaw != null and absf(yaw - float(f.yaw)) < 0.004:
			continue
		f.yaw = yaw
		var im: MultiMesh = (f.im as MultiMeshInstance3D).multimesh
		var fr: MultiMesh = (f.fr as MultiMeshInstance3D).multimesh
		var list: Array = f.list
		for i in list.size():
			var p: Array = list[i]
			var y := 3.3 if f.moon else 1.55
			var w := 2.0 if f.moon else 2.8
			var h := 2.8 if f.moon else 1.7
			im.set_instance_transform(i, mx(p[0], y, p[1], -pitch, yaw, 0, w, h, 0.07))
			fr.set_instance_transform(i, mx(p[0] - sin(yaw) * 0.06, y, p[1] - cos(yaw) * 0.06, -pitch, yaw, 0, w + 0.14, h + 0.14, 0.05))


## a painted face (the welcome sign, the school's name plate)
func _face(parent: Node3D, w: float, h: float, cw: int, ch: int, paint: Callable, pos: Vector3, ry := 0.0, transparent := false) -> Dictionary:
	var sc := Paint.screen(_holder, parent, w, h, cw, ch, false, transparent)
	var mi: MeshInstance3D = sc.mesh
	mi.position = pos
	mi.rotation.y = ry
	var m: StandardMaterial3D = mi.material_override
	m.roughness = 0.5
	m.emission_enabled = true
	m.emission_texture = m.albedo_texture
	m.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY
	m.emission = Color(1, 1, 1)
	m.emission_energy_multiplier = 0.55
	Paint.redraw(sc, paint)
	return sc


func _paint_sign(c: CanvasItem, w: int, h: int) -> void:
	var name: String = TOWN.get(site, "New Town")
	Paint.rrect(c, 4, 4, w - 8, h - 8, 26, Color("#24407e"))
	Paint.vgrad(c, 18, h * 0.5, w - 36, h * 0.5 - 18, Color("#24407e00"), Color("#152452"))
	Paint.rrect(c, 4, 4, w - 8, h - 8, 26, Color("#ffd23f"), 6)
	Paint.text(c, "WELCOME TO", w / 2.0, 40, 26, Color("#ffd23f"), "center", 600, "exo2")
	Paint.text(c, name, w / 2.0, 96, 58 if name.length() > 9 else 66, Color.WHITE, "center", 700, "exo2", w - 40)
	Paint.text(c, "·  population %d  ·" % pop_now, w / 2.0, 152, 26, Color("#9fe8ff"), "center", 500, "exo2")


func _sign(u: Dictionary) -> void:
	var k: Kit = u.kit
	for x in [-2.15, 2.15]:
		k.put("soft", G.cyl, mx(x, 1.35, 0, 0, 0, 0, 0.09, 2.7, 0.09), 0x8a8fa0)
	k.put("soft", G.box, mx(0, 2.15, -0.02, 0, 0, 0, 4.7, 1.8, 0.12), 0xf2f3f7)
	k.put("amber", G.box, mx(0, 3.13, 0.02, 0, 0, 0, 3.6, 0.1, 0.14))
	_bake(u)
	sign_sc = _face(u.g, 4.5, 1.69, 512, 192, _paint_sign, Vector3(0, 2.15, 0.05), 0.0, true)
	_col(u, -2.15, 0, 0.3, 3.1)
	_col(u, 2.15, 0, 0.3, 3.1)


func _plaza(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.cyl, mx(0, 2.4, 0, 0, 0, 0, 0.06, 4.8, 0.06), 0xf2f3f7)
	k.put("soft", G.box, mx(0.75, 4.25, 0, 0, 0, 0, 1.4, 0.9, 0.04), 0xff8a3d)
	k.put("soft", G.box, mx(0.75, 4.25, 0.01, 0, 0, 0, 1.4, 0.3, 0.04), 0x3d7dff)
	var pots := [[-3.6, 9.5], [3.9, 9.5], [-3.6, 12.5], [3.9, 12.2]]
	for i in pots.size():
		var p: Array = pots[i]
		k.put("soft", G.box, mx(p[0], 0.3, p[1], 0, 0, 0, 1.1, 0.6, 1.1), 0xd7dae3)
		k.put("soft", G.ball, mx(p[0], 0.75, p[1], 0, i, 0, 0.5, 0.42, 0.5), 0x4fd15a if i % 2 else 0x2fa64a)
	k.put("win", G.ball, mx(0, 4.9, 0, 0, 0, 0, 0.1))
	_bake(u)
	_col(u, 0, 0, 0.25, 4.9)


# ---------- stage 4: a growing town ----------
# a wide ferry with two decks of windows: it brings whole families
func _ferry(u: Dictionary) -> void:
	var k: Kit = u.kit
	_legs(k, 2.7, 2.3, 3.4, 2.7, "soft", 0xb8bcc8)
	k.put("metal", G.bell, mx(0, 1.5, 0, 0, 0, 0, 1.15, 1.5, 1.15), 0x3a3e4c)
	k.put("soft", G.cyl, mx(0, 4.0, 0, 0, 0, 0, 2.6, 3.4, 2.6), 0xf4f5f9)
	k.put("soft", G.dome, mx(0, 5.7, 0, 0, 0, 0, 2.6, 1.7, 2.6), 0xf4f5f9)
	k.put("soft", G.cyl, mx(0, 2.3, 0, 0, 0, 0, 2.66, 0.16, 2.66), 0x2b3147)
	k.put("soft", G.cyl, mx(0, 5.5, 0, 0, 0, 0, 2.64, 0.3, 2.64), 0xff8a3d)
	k.put("soft", G.band, mx(0, 2.8, 0, PI / 2, 0, 0, 2.63), 0x3d7dff)
	k.put("soft", G.cyl, mx(0, 7.45, 0, 0, 0, 0, 0.7, 0.4, 0.7), 0xc3c7d2)
	for r in 2:
		for i in 10:
			var a := (i + r * 0.5) * PI / 5
			if r == 0 and i == 0:
				continue                     # the door is here
			k.put("win", G.dot, mx(sin(a) * 2.57, 4.7 if r else 3.4, cos(a) * 2.57, 0, a, 0, 0.32, 0.32, 0.1))
	k.put("soft", G.box, mx(0, 3.35, 2.58, 0, 0, 0, 1.0, 1.5, 0.1), 0x2b3147)
	k.put("soft", G.box, mx(0, 1.32, 4.1, 0.704, 0, 0, 1.1, 0.1, 3.94), 0x8a8fa0)              # the ramp
	for s in [-1.0, 1.0]:
		k.put("soft", G.box, mx(s * 2.68, 4.0, 0, 0, 0, 0, 0.12, 2.0, 1.3), 0x3d7dff)
	k.put("blink", G.dot, mx(0, 7.8, 0, 0, 0, 0, 0.14))
	_bake(u)
	_flame(u, 0.8, 1.2, 5.5)
	_col(u, 0, 0, 3.6, 7.6)


## one round home under soil bags. ra: which way its door looks
func _pod(u: Dictionary, x: float, z: float, ra: float) -> void:
	var k: Kit = u.kit
	var n := 0
	k.base = mx(x, 0, z, 0, ra, 0)
	k.put("soft", G.cyl, mx(0, 0.15, 0, 0, 0, 0, 2.8, 0.3, 2.8), 0xd7dae3)
	k.put("soft", G.cyl, mx(0, 1.5, 0, 0, 0, 0, 2.6, 2.4, 2.6), 0xf4f5f9)
	k.put("soft", G.dome, mx(0, 2.7, 0, 0, 0, 0, 2.6, 1.5, 2.6), 0xf4f5f9)
	k.put("soft", G.band, mx(0, 2.7, 0, PI / 2, 0, 0, 2.63), 0x3d7dff)
	for r in [[0.3, 9], [0.85, 6]]:
		var e: float = r[0]
		var cnt: int = r[1]
		for i in cnt:
			var a := (i + (0.5 if e > 0.5 else 0.0)) / cnt * TAU
			k.put("rough", G.lump, mx(sin(a) * cos(e) * 2.6, 2.7 + sin(e) * 1.5, cos(a) * cos(e) * 2.6, PI / 2 - e * 1.25, a, 0, 0.85, 0.36, 0.62), M.soil if n % 2 else M.soil2)
			n += 1
	k.put("rough", G.lump, mx(0, 4.18, 0, 0, 0.4, 0, 0.85, 0.34, 0.85), M.soil)
	for w in [-2.4, -0.75, 0.75, 2.4]:
		k.put("win", G.dot, mx(sin(w) * 2.57, 1.6, cos(w) * 2.57, 0, w, 0, 0.36, 0.36, 0.1))
	k.put("soft", G.box, mx(0, 1.0, 2.75, 0, 0, 0, 1.3, 2.0, 1.1), 0xc3c7d2)
	k.put("soft", G.box, mx(0, 2.08, 2.75, 0, 0, 0, 1.46, 0.16, 1.26), 0xff8a3d)
	k.put("soft", G.box, mx(0, 0.9, 3.32, 0, 0, 0, 0.9, 1.6, 0.06), 0x2b3147)
	k.put("cyan", G.box, mx(0, 1.85, 3.33, 0, 0, 0, 1.0, 0.13, 0.06))
	k.base = null
	_col(u, x, z, 2.85, 4.3)
	_col(u, x + sin(ra) * 2.9, z + cos(ra) * 2.9, 0.7, 2.2)


## three more homes in a row, joined by tubes
func _homes(u: Dictionary) -> void:
	var cols := []
	var P := [[0.5, 7.5, PI / 2], [0.0, 0.0, PI / 2], [1.8, -7.3, 1.0]]
	for p in P:
		_pod(u, p[0], p[1], p[2])
	for l in [[0, 1], [1, 2]]:
		var a: Array = P[l[0]]
		var b: Array = P[l[1]]
		var d := Vector2(b[0] - a[0], b[1] - a[1]).length()
		var ux: float = (b[0] - a[0]) / d
		var uz: float = (b[1] - a[1]) / d
		_tube(u.kit, cols, a[0] + ux * 2.5, a[1] + uz * 2.5, b[0] - ux * 2.5, b[1] - uz * 2.5)
	_bake(u)
	for c in cols:
		_col(u, c[0], c[1], c[2], 1.8)


## tall tanks of water and round tanks of oxygen, both made from ice
func _tank_farm(u: Dictionary) -> void:
	var k: Kit = u.kit
	var xs := [-2.7, 0.0, 2.7]
	for i in 3:
		var x: float = xs[i]
		k.put("soft", G.cyl, mx(x, 0.3, -0.6, 0, 0, 0, 1.3, 0.6, 1.3), 0x3a3e4c)
		k.put("soft", G.cyl, mx(x, 3.6, -0.6, 0, 0, 0, 1.15, 6.0, 1.15), 0xf4f5f9)
		k.put("soft", G.dome, mx(x, 6.6, -0.6, 0, 0, 0, 1.15, 0.9, 1.15), 0xf4f5f9)
		for y in [1.6, 5.6]:
			k.put("soft", G.band, mx(x, y, -0.6, PI / 2, 0, 0, 1.17), 0x3d7dff)
		k.put("cyan", G.box, mx(x, 3.5 - i * 0.3, 0.56, 0, 0, 0, 0.14, 2.8 - i * 0.6, 0.06))       # a glowing gauge: how full the tank is
		_col(u, x, -0.6, 1.3, 7.5)
	k.put("soft", G.box, mx(0, 6.3, 0.85, 0, 0, 0, 6.9, 0.08, 0.6), 0x8a8fa0)                    # a walkway with a rail and a ladder
	k.put("soft", G.box, mx(0, 7.2, 1.12, 0, 0, 0, 6.9, 0.05, 0.05), 0x8a8fa0)
	for x in [-3.4, -1.35, 1.35, 3.4]:
		k.put("soft", G.box, mx(x, 6.75, 1.12, 0, 0, 0, 0.05, 0.9, 0.05), 0x8a8fa0)
	k.put("soft", G.box, mx(3.75, 3.15, 0.95, 0, 0, 0, 0.45, 6.3, 0.07), 0x8a8fa0)
	for x in [-1.5, 1.5]:
		k.put("soft", G.cyl8, mx(x, 0.3, 2.6, 0, 0, 0, 0.8, 0.6, 0.8), 0x3a3e4c)
		k.put("soft", G.ball, mx(x, 1.6, 2.6, 0, 0, 0, 1.15), 0xf4f5f9)
		k.put("soft", G.band, mx(x, 1.6, 2.6, PI / 2, 0, 0, 1.17), 0x46e0c0)
		k.put("cyan", G.dot, mx(x, 1.6, 3.74, 0, 0, 0, 0.14, 0.14, 0.06))
		_col(u, x, 2.6, 1.25, 2.8)
	k.put("soft", G.cyl8, mx(0, 0.75, 1.0, 0, 0, PI / 2, 0.11, 6.4, 0.11), 0x8a8fa0)         # pipes
	k.put("soft", G.cyl8, mx(0, 0.75, 2.3, PI / 2, 0, 0, 0.11, 2.6, 0.11), 0x8a8fa0)
	k.put("soft", G.box, mx(0, 0.5, 3.7, 0, 0, 0, 0.8, 0.8, 0.7), 0xff8a3d)
	k.put("blink", G.dot, mx(0, 7.68, -0.6, 0, 0, 0, 0.13))
	_bake(u)
	_col(u, 0, 3.7, 0.55, 1)
	_col(u, 3.75, 0.95, 0.35, 6.3)


## a comms mast with a dish that looks up at Earth
func _mast(u: Dictionary) -> void:
	var k: Kit = u.kit
	var H := 12.0
	var phi := atan2(0.85, H)
	var length := Vector2(0.85, H).length()
	k.put("soft", G.cyl8, mx(0, 0.2, 0, 0, 0, 0, 1.4, 0.4, 1.4), 0x8a8fa0)
	for i in 3:
		var a := i * TAU / 3
		k.put("soft", G.box, mx(sin(a) * 0.675, 0.4 + H / 2, cos(a) * 0.675, -phi, a, 0, 0.13, length, 0.13), 0xf4f5f9)
	var ys := [2.4, 4.8, 7.2, 9.6]
	for n in 4:
		var y: float = ys[n]
		var r := 1.14 - 0.85 * y / H
		k.put("soft", G.band, mx(0, 0.4 + y, 0, PI / 2, 0, 0, r, r, 1.2), 0xf4f5f9 if n % 2 else 0xff8a3d)
	k.put("soft", G.cyl8, mx(0, 12.46, 0, 0, 0, 0, 0.5, 0.12, 0.5), 0x8a8fa0)
	k.put("soft", G.cyl6, mx(0, 13.7, 0, 0, 0, 0, 0.04, 2.4, 0.04), 0xdfe2ea)
	k.put("blink", G.dot, mx(0, 14.95, 0, 0, 0, 0, 0.15))
	k.put("soft", G.dome, mx(0, 10.2, 1.45, -2.44, 0, 0, 1.3, 0.45, 1.3), 0xdfe2ea)             # the big dish: its back, and its face
	k.put("soft", G.cyl, mx(0, 10.2, 1.45, 0.698, 0, 0, 1.3, 0.05, 1.3), 0xf4f5f9)
	k.put("soft", G.box, mx(0, 9.86, 0.78, 0, 0, 0, 0.12, 0.12, 0.8), 0x8a8fa0)
	k.put("soft", G.cyl6, mx(0, 10.35, 1.58, 0.698, 0, 0, 0.03, 0.9, 0.03), 0x8a8fa0)
	k.put("soft", G.dome, mx(1.05, 6.6, -0.77, -2.44, 2.2, 0, 0.7, 0.25, 0.7), 0xdfe2ea)        # a small one
	k.put("soft", G.cyl, mx(1.05, 6.6, -0.77, 0.698, 2.2, 0, 0.7, 0.04, 0.7), 0xf4f5f9)
	k.put("soft", G.box, mx(2.0, 0.7, 0.5, 0, 0, 0, 1.7, 1.4, 1.3), 0xc3c7d2)                   # the radio hut
	k.put("soft", G.box, mx(2.0, 1.45, 0.5, 0, 0, 0, 1.85, 0.14, 1.45), 0xff8a3d)
	k.put("blink", G.dot, mx(2.0, 1.0, 1.17, 0, 0, 0, 0.1))
	_bake(u)
	_col(u, 0, 0, 1.3, 12.5)
	_col(u, 2.0, 0.5, 1.0, 1.5)


func _paint_label(c: CanvasItem, w: int, h: int, text: String) -> void:
	Paint.rect(c, 0, 0, w, h, Color("#1c3270"))
	Paint.stroke_rect(c, 3, 3, w - 6, h - 6, Color("#ffd23f"), 5)
	Paint.text(c, text, w / 2.0, h / 2.0 + 2, 40, Color.WHITE, "center", 700, "exo2", w - 20)


## a school in a long hall with a round roof. The door, the sign and the flag are at the +x end.
func _school(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.box, mx(0, 0.85, 0, 0, 0, 0, 8, 1.7, 4.2), 0xf4f5f9)
	k.put("soft", G.cyl, mx(0, 1.7, 0, 0, 0, PI / 2, 2.1, 8, 2.1), 0xf4f5f9)
	k.put("soft", G.box, mx(0, 1.7, 0, 0, 0, 0, 8.1, 0.2, 4.3), 0xffd23f)
	for x in [-2.7, 0.0, 2.7]:
		k.put("soft", G.arch, mx(x, 1.7, 0, 0, PI / 2, 0, 2.14), 0xffd23f)
	for x in [-3.0, -1.5, 0.0, 1.5, 3.0]:
		for s in [-1.0, 1.0]:
			k.put("win", G.dot, mx(x, 0.95, s * 2.11, 0, 0, 0, 0.42, 0.42, 0.08))
	k.put("soft", G.box, mx(4.45, 1.05, 0, 0, 0, 0, 0.9, 2.1, 1.7), 0xc3c7d2)
	k.put("soft", G.box, mx(4.5, 2.2, 0, 0, 0, 0, 1.2, 0.18, 2.0), 0xffd23f)
	k.put("soft", G.box, mx(4.92, 0.95, 0, 0, 0, 0, 0.06, 1.7, 1.1), 0x2b3147)
	k.put("green", G.box, mx(4.93, 2.0, 0, 0, 0, 0, 0.06, 0.14, 1.2))
	k.put("soft", G.box, mx(4.05, 3.0, 0, 0, 0, 0, 0.1, 0.72, 2.7), 0xf2f3f7)
	k.put("soft", G.cyl6, mx(5.0, 2.5, 2.6, 0, 0, 0, 0.06, 5, 0.06), 0xf2f3f7)                   # the flag
	k.put("soft", G.box, mx(5.0, 4.5, 3.3, 0, 0, 0, 0.04, 0.8, 1.3), 0x3d7dff)
	k.put("soft", G.box, mx(5.0, 4.5, 3.3, 0, 0, 0, 0.06, 0.26, 1.3), 0xffd23f)
	k.put("win", G.dot, mx(5.0, 5.08, 2.6, 0, 0, 0, 0.1))
	_bake(u)
	_face(u.g, 2.5, 0.6, 256, 64, func(c, w, h): _paint_label(c, w, h, "SCHOOL"), Vector3(4.11, 3.0, 0), PI / 2)
	for x in [-2.3, -0.77, 0.77, 2.3]:
		_col(u, x, 0, 2.2, 3.8)
	_col(u, 4.55, 0, 0.85, 2.3)
	_col(u, 5.0, 2.6, 0.2, 5)


## a farm: two long greenhouse tunnels side by side, with a hall and a water tank on the town side (-z)
func _farm(u: Dictionary) -> void:
	var k: Kit = u.kit
	var L := 9.0
	k.put("soft", G.box, mx(0, 0.15, 0, 0, 0, 0, L + 0.5, 0.3, 7.7), 0xd7dae3)
	var zs := [-1.9, 1.9]
	for r in 2:
		var z: float = zs[r]
		k.put("soft", G.box, mx(0, 0.52, z, 0, 0, 0, L - 0.8, 0.45, 2.0), 0xf4f5f9)
		k.put("rough", G.box, mx(0, 0.77, z, 0, 0, 0, L - 1.0, 0.06, 1.8), 0x4a3324)
		for i in 9:
			var os := [-0.45, 0.45]
			for c in 2:
				var o: float = os[c]
				k.put("soft", G.cone, mx((i - 4) * 0.9 + o * 0.3, 1.08, z + o, 0, i + r, 0, 0.24, 0.6, 0.24), 0x2fa64a if (i + c + r) % 2 else 0x1f8a3a)
		k.put("pink", G.box, mx(0, 1.72, z, 0, 0, 0, L - 0.6, 0.07, 0.12))
		k.put("glass", G.tunnel, mx(0, 0.3, z, 0, 0, PI / 2, 1.75, L, 1.75))
		k.put("haze", G.tunnel, mx(0, 0.3, z, 0, 0, PI / 2, 1.5, L - 0.4, 1.5))
		for x in [-L / 2, L / 2]:
			k.put("soft", G.cyl, mx(x, 0.3, z, 0, 0, PI / 2, 1.78, 0.12, 1.78), 0xf4f5f9)
			k.put("pink", G.dot, mx(x * 1.014, 1.1, z, 0, 0, 0, 0.06, 0.4, 0.4))
		for x in [-3.0, -1.5, 0.0, 1.5, 3.0]:
			k.put("soft", G.arch, mx(x, 0.3, z, 0, PI / 2, 0, 1.77), 0xf4f5f9)
		for x in [-3.3, -1.1, 1.1, 3.3]:
			_col(u, x, z, 2.0, 2.2)
	k.put("soft", G.box, mx(0, 1.05, -4.5, 0, 0, 0, 2.4, 2.1, 1.7), 0xc3c7d2)                   # the hall
	k.put("soft", G.box, mx(0, 2.18, -4.5, 0, 0, 0, 2.6, 0.18, 1.9), 0xf4f5f9)
	k.put("soft", G.box, mx(0, 0.95, -5.37, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147)
	k.put("pink", G.box, mx(0, 2.0, -5.38, 0, 0, 0, 1.2, 0.14, 0.06))
	k.put("soft", G.cyl, mx(-3.4, 1.25, -4.6, 0, 0, 0, 0.8, 1.9, 0.8), 0xf4f5f9)                # water for the plants
	k.put("soft", G.dome, mx(-3.4, 2.2, -4.6, 0, 0, 0, 0.8, 0.4, 0.8), 0xf4f5f9)
	k.put("soft", G.band, mx(-3.4, 1.4, -4.6, PI / 2, 0, 0, 0.82), 0x3d7dff)
	_bake(u)
	_col(u, 0, -4.6, 1.2, 2.3)
	_col(u, -3.4, -4.6, 0.9, 2.6)


## one street lamp. yaw: which way its arm points
func _lamp(k: Kit, x: float, z: float, yaw: float) -> void:
	k.base = mx(x, 0, z, 0, yaw, 0)
	k.put("soft", G.cyl6, mx(0, 0.1, 0, 0, 0, 0, 0.16, 0.2, 0.16), 0x3a3e4c)
	k.put("soft", G.cyl6, mx(0, 1.6, 0, 0, 0, 0, 0.055, 3.2, 0.055), 0x8a8fa0)
	k.put("soft", G.box, mx(0, 3.2, 0.3, 0, 0, 0, 0.08, 0.08, 0.7), 0x8a8fa0)
	k.put("win", G.dot, mx(0, 3.1, 0.6, 0, 0, 0, 0.2, 0.12, 0.2))
	k.base = null


func _strip(k: Kit, ax: float, az: float, bx: float, bz: float, w: float) -> void:
	var dx := bx - ax
	var dz := bz - az
	var length := Vector2(dx, dz).length()
	var yaw := atan2(dx, dz)
	var n := maxi(1, roundi(length / 3))
	var ox := cos(yaw) * (w / 2 - 0.12)
	var oz := -sin(yaw) * (w / 2 - 0.12)
	k.put("rough", G.box, mx((ax + bx) / 2, 0.035, (az + bz) / 2, 0, yaw, 0, w, 0.07, length), M.road)
	for i in n:
		var t := (i + 0.5) / n
		k.put("cyan", G.box, mx(ax + dx * t + ox, 0.075, az + dz * t + oz, 0, yaw, 0, 0.08, 0.03, 0.9))
		k.put("cyan", G.box, mx(ax + dx * t - ox, 0.075, az + dz * t - oz, 0, yaw, 0, 0.08, 0.03, 0.9))


## lit streets of packed soil and two parked crew rovers. The lamp posts are thin: you can walk past them.
func _streets(u: Dictionary) -> void:
	var k: Kit = u.kit
	var h := PI / 2
	_strip(k, -20.9, 8.4, 13.5, 8.4, 2.4)            # the main street, across the way in
	_strip(k, 13.5, 8.8, 20.9, 8.8, 1.6)             # a footpath on to the school
	_strip(k, -19.7, 7.2, -19.7, -6.5, 2.4)          # past the new homes
	_strip(k, 22.1, 9.6, 22.1, -8.5, 2.4)            # past the school
	for l in [[-16.8, 6.95, 0.0], [-11.5, 6.95, 0.0], [-6.0, 6.95, 0.0], [6.2, 6.95, 0.0], [12.6, 6.95, 0.0], [-14.5, 9.85, 2 * h], [9.5, 9.85, 2 * h], [17.2, 9.85, 2 * h],
			[-18.25, 4.0, -h], [-18.25, -5.5, -h], [-21.15, 1.4, h], [-21.15, -5.9, h],
			[20.65, 5.5, h], [20.65, -0.5, h], [20.65, -6.6, h], [23.55, 2.5, -h], [23.55, -7.5, -h]]:
		_lamp(k, l[0], l[1], l[2])
	_park_rover(u, 26, -4.4, 0, 0x3d7dff)
	_park_rover(u, -22.5, -15.8, 0.5, 0xffd23f)
	_bake(u)


# ---------- stage 5: the first city ----------
# a tall ship with three decks: the first liner to the new city
func _liner(u: Dictionary) -> void:
	var k: Kit = u.kit
	_legs(k, 2.4, 1.5, 3.2, 2.4, "soft", 0xb8bcc8)
	k.put("metal", G.bell, mx(0, 1.35, 0, 0, 0, 0, 1.05, 1.3, 1.05), 0x3a3e4c)
	k.put("soft", G.cyl, mx(0, 6.2, 0, 0, 0, 0, 1.7, 8.4, 1.7), 0xf4f5f9)
	k.put("soft", G.cone, mx(0, 12.1, 0, 0, 0, 0, 1.7, 3.4, 1.7), 0xf4f5f9)
	k.put("soft", G.cone, mx(0, 13.46, 0, 0, 0, 0, 0.42, 0.8, 0.42), 0xff8a3d)
	k.put("soft", G.cyl, mx(0, 2.1, 0, 0, 0, 0, 1.75, 0.3, 1.75), 0x2b3147)
	k.put("soft", G.cyl, mx(0, 9.2, 0, 0, 0, 0, 1.73, 0.35, 1.73), 0xff8a3d)
	for y in [3.1, 9.75]:
		k.put("soft", G.band, mx(0, y, 0, PI / 2, 0, 0, 1.73), 0x3d7dff)
	for i in 4:
		var a := PI / 4 + i * PI / 2
		k.put("soft", G.box, mx(sin(a) * 2.05, 3.6, cos(a) * 2.05, 0, a, 0, 0.14, 2.6, 0.9), 0x3d7dff)
	for r in 3:
		for i in 8:
			var a := (i + r * 0.5) * PI / 4
			k.put("win", G.dot, mx(sin(a) * 1.68, 5.2 + r * 1.3, cos(a) * 1.68, 0, a, 0, 0.26, 0.3, 0.09))
	k.put("win", G.box, mx(0, 11.2, 1.28, -0.4636, 0, 0, 1.0, 0.4, 0.08))                       # the pilots' window
	k.put("soft", G.box, mx(0, 3.5, 1.72, 0, 0, 0, 0.95, 1.5, 0.1), 0x2b3147)
	k.put("soft", G.box, mx(0, 1.35, 2.3, -0.338, 0, 0, 0.8, 2.86, 0.08), 0x8a8fa0)
	k.put("blink2", G.dot, mx(0, 13.95, 0, 0, 0, 0, 0.12))
	_bake(u)
	_flame(u, 0.7, 1.05, 6)
	_col(u, 0, 0, 3.2, 13)


## the launch tower beside the pad: a frame of struts, a covered bridge to the ship (+z) and a control hut
func _gantry(u: Dictionary) -> void:
	var k: Kit = u.kit
	var H := 14.0
	var bay := H / 6
	var tilt := atan2(1.5, bay)
	var length := Vector2(1.5, bay).length()
	k.put("soft", G.box, mx(0, 0.2, 0, 0, 0, 0, 2.4, 0.4, 2.4), 0x4a4f63)
	for c in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		k.put("soft", G.box, mx(c[0] * 0.75, 0.4 + H / 2, c[1] * 0.75, 0, 0, 0, 0.16, H, 0.16), 0xff8a3d)
	for i in 7:
		k.put("soft", G.box, mx(0, 0.4 + i * bay, 0, 0, 0, 0, 1.75, 0.1, 1.75), 0xdfe2ea)
	for i in 6:
		var y := 0.4 + (i + 0.5) * bay
		var s := 1.0 if i % 2 else -1.0
		k.put("soft", G.box, mx(0, y, 0.75, 0, 0, s * tilt, 0.08, length, 0.08), 0xf4f5f9)
		k.put("soft", G.box, mx(0, y, -0.75, 0, 0, -s * tilt, 0.08, length, 0.08), 0xf4f5f9)
		k.put("soft", G.box, mx(0.75, y, 0, s * tilt, 0, 0, 0.08, length, 0.08), 0xf4f5f9)
		k.put("soft", G.box, mx(-0.75, y, 0, -s * tilt, 0, 0, 0.08, length, 0.08), 0xf4f5f9)
	k.put("soft", G.box, mx(0, 8.25, 2.18, 0, 0, 0, 0.9, 1.5, 2.85), 0xf4f5f9)                  # the bridge
	k.put("soft", G.box, mx(0, 8.25, 3.52, 0, 0, 0, 1.1, 1.7, 0.18), 0xff8a3d)
	for e in [-1.0, 1.0]:
		k.put("win", G.box, mx(e * 0.46, 8.4, 2.18, 0, 0, 0, 0.04, 0.5, 2.2))
	k.put("soft", G.cyl6, mx(0, 15.6, 0, 0, 0, 0, 0.05, 2.4, 0.05), 0xdfe2ea)
	k.put("blink", G.dot, mx(0, 16.9, 0, 0, 0, 0, 0.16))
	for x in [-0.6, 0.6]:
		k.put("win", G.dot, mx(x, 14.25, 0.9, 0, 0, 0, 0.2))         # floodlights
	k.put("soft", G.box, mx(-2.5, 0.8, 0, 0, 0, 0, 2.2, 1.6, 1.7), 0xc3c7d2)                    # the control hut
	k.put("soft", G.box, mx(-2.5, 1.68, 0, 0, 0, 0, 2.4, 0.16, 1.9), 0x3d7dff)
	k.put("win", G.box, mx(-2.5, 1.05, 0.86, 0, 0, 0, 1.4, 0.4, 0.05))
	_bake(u)
	_col(u, 0, 0, 1.3, 14.5)
	_col(u, -2.5, 0, 1.25, 1.8)


func _tree(k: Kit, x: float, z: float, h: float, n: int) -> void:
	var greens := [0x2fa64a, 0x4fd15a, 0x3bb85a]
	k.put("soft", G.cyl8, mx(x, 0.45 + h * 0.2, z, 0, 0, 0, 0.11, h * 0.4, 0.11), 0x7a5230)
	k.put("rough", G.lump, mx(x, 0.45 + h * 0.6, z, 0, n, 0, h * 0.27, h * 0.34, h * 0.27), greens[n % 3])
	k.put("rough", G.lump, mx(x + 0.1, 0.45 + h * 0.88, z - 0.08, 0, n * 2, 0, h * 0.19, h * 0.22, h * 0.19), greens[(n + 1) % 3])


## the landmark: a park with trees and a pond under a clear dome. The door is at +z.
func _biodome(u: Dictionary) -> void:
	var k: Kit = u.kit
	var R := 6.2
	k.put("soft", G.disc, mx(0, 0.18, 0, 0, 0, 0, R + 0.3, 0.36, R + 0.3), 0xd7dae3)
	k.put("soft", G.disc, mx(0, 0.4, 0, 0, 0, 0, R - 0.25, 0.1, R - 0.25), 0x5fbf5a)              # grass
	k.put("soft", G.disc, mx(0, 0.42, 0, 0, 0, 0, 4.3, 0.1, 4.3), 0xe6ddc8)                     # a sandy path in a ring
	k.put("soft", G.disc, mx(0, 0.44, 0, 0, 0, 0, 3.4, 0.1, 3.4), 0x6fcf62)
	k.put("water", G.cyl, mx(0.5, 0.47, -0.3, 0, 0.4, 0, 2.1, 0.08, 1.45))                      # the pond
	var ds := [50.0, 95.0, 140.0, 185.0, 230.0, 275.0, 318.0]
	for n in ds.size():
		var a := deg_to_rad(ds[n])
		_tree(k, sin(a) * 4.75, cos(a) * 4.75, 2.6 + (n % 3) * 0.15, n)
	_tree(k, -2.3, 1.2, 4.4, 7)
	_tree(k, 2.7, 1.6, 4.0, 8)
	_tree(k, -0.9, -2.9, 3.6, 9)
	for b in [[2.2, -2.3, 0.9], [-1.6, -1.6, -0.8]]:
		k.put("soft", G.box, mx(b[0], 0.69, b[1], 0, b[2], 0, 1.2, 0.4, 0.42), 0xf4f5f9)     # benches
	for d in [22.0, 72.0, 162.0, 252.0]:
		var a := deg_to_rad(d)
		k.put("soft", G.cyl6, mx(sin(a) * 4.5, 1.35, cos(a) * 4.5, 0, 0, 0, 0.05, 1.8, 0.05), 0x8a8fa0)
		k.put("win", G.dot, mx(sin(a) * 4.5, 2.3, cos(a) * 4.5, 0, 0, 0, 0.17))
	k.put("ice", G.dome, mx(0, 0.36, 0, 0, 0, 0, R))
	for i in 4:
		k.put("soft", G.rib, mx(0, 0.36, 0, 0, i * PI / 4, 0, R + 0.02), 0xf4f5f9)
	k.put("soft", G.hoop, mx(0, 0.36 + R * 0.574, 0, PI / 2, 0, 0, R * 0.819 + 0.02), 0xf4f5f9)
	k.put("soft", G.hoop, mx(0, 0.42, 0, PI / 2, 0, 0, R, R, R * 1.4), 0xf4f5f9)
	k.put("soft", G.cyl, mx(0, 0.36 + R, 0, 0, 0, 0, 0.5, 0.14, 0.5), 0xf4f5f9)
	k.put("win", G.dot, mx(0, 0.36 + R + 0.2, 0, 0, 0, 0, 0.16))
	k.put("soft", G.box, mx(0, 1.15, R + 0.1, 0, 0, 0, 1.9, 2.3, 1.0), 0xc3c7d2)                 # the door
	k.put("soft", G.box, mx(0, 2.4, R + 0.1, 0, 0, 0, 2.1, 0.2, 1.2), 0x3d7dff)
	k.put("soft", G.box, mx(0, 1.0, R + 0.62, 0, 0, 0, 1.1, 1.8, 0.06), 0x2b3147)
	k.put("win", G.box, mx(0, 2.1, R + 0.63, 0, 0, 0, 1.2, 0.14, 0.06))
	_bake(u)
	_col(u, 0, 0, R + 0.25, 6.6)
	_col(u, 0, R + 0.15, 0.95, 2.5)


## a tower of homes, four floors of lit windows
func _tower(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.cyl, mx(0, 0.2, 0, 0, 0, 0, 2.9, 0.4, 2.9), 0xd7dae3)
	k.put("soft", G.cyl, mx(0, 5.4, 0, 0, 0, 0, 2.6, 10, 2.6), 0xf4f5f9)
	k.put("soft", G.dome, mx(0, 10.4, 0, 0, 0, 0, 2.6, 1.4, 2.6), 0xf4f5f9)
	for f in 4:
		k.put("soft", G.band, mx(0, 2.9 + f * 2.5, 0, PI / 2, 0, 0, 2.63), 0xff8a3d if f == 3 else 0x3d7dff)
		for i in 9:
			if f == 0 and i == 0:
				continue                     # the door is here
			var a := (i + f * 0.5) * TAU / 9
			var y := 1.85 + f * 2.5
			if (i * 7 + f * 3) % 5 == 0:
				k.put("soft", G.dot, mx(sin(a) * 2.56, y, cos(a) * 2.56, 0, a, 0, 0.32, 0.48, 0.09), 0x2b3147)      # nobody home
			else:
				k.put("win", G.dot, mx(sin(a) * 2.57, y, cos(a) * 2.57, 0, a, 0, 0.32, 0.48, 0.1))
	for i in range(1, 12):                   # a bank of soil bags around the bottom
		var a := i * PI / 6
		k.put("rough", G.lump, mx(sin(a) * 2.7, 0.5, cos(a) * 2.7, PI / 2 - 0.35, a, 0, 0.78, 0.42, 0.7), M.soil if i % 2 else M.soil2)
	k.put("win", G.cyl, mx(0, 11.82, 0, 0, 0, 0, 0.8, 0.06, 0.8))
	k.put("soft", G.cyl6, mx(0, 12.9, 0, 0, 0, 0, 0.06, 2.2, 0.06), 0xdfe2ea)
	k.put("blink", G.dot, mx(0, 14.05, 0, 0, 0, 0, 0.15))
	k.put("soft", G.box, mx(0, 1.15, 2.9, 0, 0, 0, 1.7, 2.3, 1.4), 0xc3c7d2)
	k.put("soft", G.box, mx(0, 2.35, 2.9, 0, 0, 0, 1.9, 0.2, 1.6), 0x3d7dff)
	k.put("soft", G.box, mx(0, 0.95, 3.62, 0, 0, 0, 1.1, 1.7, 0.06), 0x2b3147)
	k.put("win", G.box, mx(0, 2.0, 3.63, 0, 0, 0, 1.2, 0.14, 0.06))
	_bake(u)
	_col(u, 0, 0, 3.1, 11.8)
	_col(u, 0, 3.0, 0.9, 2.5)


# the ring road around the whole city, with a little tram and three stops
func _tram_car(k: Kit, a: float) -> void:
	k.base = mx(sin(a) * RING, 0, cos(a) * RING, 0, a, 0)
	k.put("soft", G.box, mx(0, 0.27, 0, 0, 0, 0, 3.3, 0.38, 1.3), 0x2b3147)
	k.put("soft", G.box, mx(0, 1.25, 0, 0, 0, 0, 3.4, 1.5, 1.5), 0xf4f5f9)
	k.put("soft", G.cyl, mx(0, 2.0, 0, 0, 0, PI / 2, 0.75, 3.4, 0.75), 0xf4f5f9)
	k.put("soft", G.box, mx(0, 0.72, 0, 0, 0, 0, 3.43, 0.24, 1.53), 0xff8a3d)
	for x in [-1.1, 0.0, 1.1]:
		for s in [-1.0, 1.0]:
			k.put("win", G.box, mx(x, 1.5, s * 0.76, 0, 0, 0, 0.8, 0.62, 0.04))
	for s in [-1.0, 1.0]:
		k.put("win", G.box, mx(s * 1.71, 1.5, 0, 0, 0, 0, 0.04, 0.62, 1.0))
	k.base = null


func _tram_stop(u: Dictionary, a: float) -> void:
	var k: Kit = u.kit
	var r := RING - 2.15
	k.base = mx(sin(a) * r, 0, cos(a) * r, 0, a, 0)
	k.put("soft", G.box, mx(0, 0.08, 0, 0, 0, 0, 3.0, 0.16, 1.3), 0xd7dae3)
	for x in [-1.25, 1.25]:
		k.put("soft", G.cyl6, mx(x, 1.2, -0.45, 0, 0, 0, 0.06, 2.3, 0.06), 0x8a8fa0)
	k.put("soft", G.box, mx(0, 2.38, -0.1, 0, 0, 0, 3.0, 0.1, 1.4), 0xff8a3d)
	k.put("soft", G.box, mx(0, 0.36, -0.42, 0, 0, 0, 1.6, 0.4, 0.4), 0xf4f5f9)                  # a bench
	k.put("cyan", G.box, mx(0, 2.3, 0.5, 0, 0, 0, 2.6, 0.05, 0.1))
	k.base = null
	for x in [-1.25, 1.25]:
		_col(u, sin(a) * (r - 0.45) + cos(a) * x, cos(a) * (r - 0.45) - sin(a) * x, 0.25, 2.4)


func _ring_road(u: Dictionary) -> void:
	var k: Kit = u.kit
	var n := 52
	var d := 1.9 / RING
	k.put("rough", _shape("ringroad", func(): return _ring_geo(32, 34.8, 80)), mx(0, 0.06, 0, -PI / 2, 0, 0), M.road)
	k.put("soft", _shape("ringrail", func(): return _ring_geo(RING - 0.09, RING + 0.09, 80)), mx(0, 0.075, 0, -PI / 2, 0, 0), 0xb8bcc8)      # the tram's guide rail
	for i in n:
		var a := float(i) / n * TAU
		k.put("cyan", G.box, mx(sin(a) * 32.12, 0.08, cos(a) * 32.12, 0, a, 0, 0.9, 0.04, 0.1))
		k.put("cyan", G.box, mx(sin(a) * 34.68, 0.08, cos(a) * 34.68, 0, a, 0, 0.9, 0.04, 0.1))
	for s in STOPS:
		_tram_stop(u, s)
	_bake(u)
	# the tram: two cars baked around the middle of the ring, so turning the group drives it along the road
	var tg := Node3D.new()
	var tk := Kit.new()
	_tram_car(tk, d)
	_tram_car(tk, -d)
	tk.put("soft", G.box, mx(0, 0.7, RING, 0, 0, 0, 0.6, 0.3, 0.5), 0x2b3147)
	tk.put("win", G.dot, mx(sin(d * 1.93) * RING, 0.95, cos(d * 1.93) * RING, 0, 0, 0, 0.17))
	tk.bake(tg, M)
	(u.g as Node3D).add_child(tg)
	var c1 := _col(u, 0, RING, 1.25, 2.8)
	var c2 := _col(u, 0, RING, 1.25, 2.8)
	tram = { "u": u, "g": tg, "a": STOPS[0] - 0.7, "next": 0, "wait": 0.0, "gone": 99.0, "d": d, "cols": [c1, c2] }
	_step_tram(0)


## the tram rolls from stop to stop, waits a moment at each, and its two colliders ride along with it
func _step_tram(dt: float) -> void:
	var t = tram
	if t == null:
		return
	if t.wait > 0:
		t.wait -= dt
	else:
		var left: float = fposmod(float(STOPS[t.next]) - t.a, TAU) * RING
		var go: float = 2.6 * clampf(minf(left, t.gone) / 4 + 0.1, 0.1, 1) * dt
		if go >= left:
			t.a = STOPS[t.next]
			t.next = (t.next + 1) % STOPS.size()
			t.wait = 3.5
			t.gone = 0.0
		else:
			t.a += go / RING
			t.gone += go
	(t.g as Node3D).rotation.y = t.a
	for i in 2:
		var a: float = t.a + (-t.d if i else t.d)
		var x := sin(a) * RING
		var z := cos(a) * RING
		t.cols[i].x = wx(x, z)
		t.cols[i].z = wz(x, z)


## the town square: a little rocket to remember the first ship, and flags all around
func _square(u: Dictionary) -> void:
	var k: Kit = u.kit
	k.put("soft", G.disc, mx(0, 0.04, 0, 0, 0, 0, 4.5, 0.08, 4.5), 0xcfc8ba)
	k.put("soft", G.ring, mx(0, 0.085, 0, PI / 2, 0, 0, 3.0, 3.0, 0.4), 0x3d7dff)
	k.put("soft", G.cyl, mx(0, 0.33, 0, 0, 0, 0, 1.05, 0.5, 1.05), 0xd7dae3)
	k.put("soft", G.cyl, mx(0, 0.83, 0, 0, 0, 0, 0.75, 0.5, 0.75), 0xf4f5f9)
	k.put("soft", G.band, mx(0, 1.08, 0, PI / 2, 0, 0, 0.76), 0x3d7dff)
	k.put("soft", G.cyl8, mx(0, 2.1, 0, 0, 0, 0, 0.3, 1.5, 0.3), 0xffc533)                        # the rocket, in bright paint
	k.put("soft", G.cone, mx(0, 3.25, 0, 0, 0, 0, 0.3, 0.8, 0.3), 0xff8a3d)
	for i in 3:
		var a := i * TAU / 3
		k.put("soft", G.box, mx(sin(a) * 0.4, 1.5, cos(a) * 0.4, -0.25, a, 0, 0.07, 0.75, 0.45), 0x3d7dff)
	k.put("soft", G.band, mx(0, 2.3, 0, 1.15, 0.5, 0, 0.95), 0xffd23f)
	for i in 6:
		var a := (i + 0.5) * PI / 3
		var x := sin(a) * 3.9
		var z := cos(a) * 3.9
		k.put("soft", G.cyl6, mx(x, 2.2, z, 0, 0, 0, 0.05, 4.4, 0.05), 0xf2f3f7)
		k.put("soft", G.box, mx(x + 0.6, 3.95, z, 0, 0, 0, 1.1, 0.7, 0.04), COLORS[i])
		k.put("soft", G.box, mx(x + 0.6, 3.95, z, 0, 0, 0, 1.1, 0.22, 0.06), 0xf2f3f7)
		k.put("win", G.dot, mx(x, 4.46, z, 0, 0, 0, 0.09))
		_col(u, x, z, 0.2, 4.4)
		k.put("win", G.dot, mx(sin(a) * 1.5, 0.14, cos(a) * 1.5, 0, 0, 0, 0.1))       # little lights around the rocket
	for i in 3:                              # benches
		var a := i * TAU / 3
		k.put("soft", G.box, mx(sin(a) * 3.2, 0.28, cos(a) * 3.2, 0, a, 0, 1.3, 0.4, 0.45), 0xf4f5f9)
		_col(u, sin(a) * 3.2, cos(a) * 3.2, 0.5, 0.5)
	_bake(u)
	_col(u, 0, 0, 1.15, 3.6)


## more solar panels in an arc behind the town, and the box that stores their power
func _sun_arc(u: Dictionary) -> void:
	var k: Kit = u.kit
	var list := []
	for i in 6:
		var a := deg_to_rad(163.0 + i * 7)
		list.append([sin(a) * 29.6, cos(a) * 29.6])
	_panel_field(u, list)
	k.put("soft", G.box, mx(-11.5, 0.7, -27.2, 0, 0.4, 0, 1.8, 1.4, 1.1), 0xc3c7d2)
	k.put("soft", G.box, mx(-11.5, 1.45, -27.2, 0, 0.4, 0, 1.95, 0.12, 1.25), 0xff8a3d)
	k.put("green", G.box, mx(-11.28, 0.95, -26.69, 0, 0.4, 0, 1.0, 0.12, 0.05))
	_bake(u)
	_col(u, -11.5, -27.2, 1.05, 1.5)


# ---------- settlers ----------
# Little astronauts in white suits with coloured helmets. They walk back and forth between doors,
# stop for a moment at each end, and wave when you come close. On the Moon they bunny-hop.

## part of a circle, as a path (angles in degrees, from +z round to +x)
static func _arc(cx: float, cz: float, r: float, d0: float, d1: float, n: int) -> Array:
	var out := []
	for i in n + 1:
		var a := deg_to_rad(d0 + (d1 - d0) * i / n)
		out.append([cx + sin(a) * r, cz + cos(a) * r])
	return out


## a path on a floor above the ground
static func _raised(route: Array, y: float) -> Dictionary:
	return { "pts": route, "y": y }


static func _make_routes() -> Dictionary:
	var R := {}
	R[2] = [[[4.7, -3.5], [3.6, 0.5], [4.7, 4.5]], [[0.8, 3.2], [-6, 6.6], [-15, 7.3]], [[0.2, -12.6], [3.4, -8.0], [4.7, -3.5]], [[-4.2, -6.6], [-1.5, -1.0], [1.2, 2.2]]]
	R[3] = [[[4.7, -3.5], [3.6, 0.5], [4.7, 4.5]], [[0.8, 3.2], [-6, 6.6], [-15, 7.3]], [[0.2, -12.6], [-4.2, -11.0], [-7.6, -12.0]], [[-1.6, 4.8], [-1.0, -1.2]],
		[[13.2, -4.6], [13.2, 7.6]], [[10.3, -10.2], [12.6, -9.0], [17.6, -9.6]], [[-8.0, 6.5], [-4.5, 5.0], [-1.2, 3.4]], [[-1.2, 7.0], [-1.0, 18.5]]]
	# stage 4, 14 people: along the new streets and between the new doors
	R[4] = R[3] + [
		[[-18.5, 8.4], [-5.5, 8.4]], [[4.5, 8.4], [13.5, 8.6], [16.2, 11.4]], [[-19.7, 6.5], [-19.7, -6]],
		[[-21.7, 5.2], [-20.3, 1.4], [-22.2, -2.3]], [[22.1, 8.6], [22.1, 2], [22.1, -7.5]], [[-3.6, -18.6], [1.8, -20.6], [5.3, -20.3]]]
	# stage 5, 24 people: in the park under the dome, on the square, at the spaceport, along the ring road, at a tram stop
	R[5] = R[4] + [
		_raised(_arc(-18, 17.8, 3.85, 10, 115, 5), 0.49), _raised(_arc(-18, 17.8, 3.85, 130, 235, 5), 0.49), _raised(_arc(-18, 17.8, 3.85, 250, 350, 5), 0.49),
		_arc(-8.5, 25.5, 2.3, -150, 25, 5), [[-3.6, 30.3], [-3.5, 24], [-3.6, 17.5]],
		[[10.9, -18.6], [8.2, -18.2], [5.6, -20.4]], [[22.8, -10.6], [22.1, -7.5], [22.1, -1]],
		_arc(0, 0, 31.3, 14, 36, 4), _arc(0, 0, 31.2, -88, -66, 4), _raised([[31.15, 4.6], [31.4, 2.2]], 0.16)]
	return R


func _settler_geos() -> Dictionary:
	var k := Kit.new()
	k.put("soft", _shape("cap0.34", func(): return _capsule_geo(0.34, 0.42, 4, 12)), mx(0, 1.12, 0), 0xf5f6fa)
	k.put("soft", G.box, mx(0, 1.2, -0.38, 0, 0, 0, 0.58, 0.72, 0.28), 0xcfd3de)
	k.put("soft", G.box, mx(0, 1.24, 0.33, 0, 0, 0, 0.34, 0.2, 0.08), 0x2b3147)
	k.put("soft", _shape("collar", func(): return _torus_geo(0.32, 0.07, 6, 16)), mx(0, 1.5, 0, PI / 2, 0, 0), 0xcfd3de)
	var body := k.mesh("soft")
	k = Kit.new()
	k.put("soft", _shape("ball16", func(): return _sphere_geo(16, 12)), mx(0, 1.78, 0, 0, 0, 0, 0.44))
	var helmet := k.mesh("soft")
	k = Kit.new()
	k.put("soft", _shape("ball16", func(): return _sphere_geo(16, 12)), mx(0, 1.76, 0.2, 0, 0, 0, 0.37, 0.37 * 0.78, 0.37 * 0.92))
	var visor := k.mesh("soft")
	k = Kit.new()
	# thin, and there are four for each of up to 24 people: keep them cheap
	k.put("soft", _shape("cap0.125", func(): return _capsule_geo(0.125, 0.34, 3, 6)), mx(0, -0.3, 0))
	var limb := k.mesh("soft")
	return { "body": body, "helmet": helmet, "visor": visor, "limb": limb }


## n figures, drawn with MultiMeshes (the colony uses up to 24, the future vision a crowd)
func _make_crowd(parent: Node3D, n: int, geos: Dictionary) -> Dictionary:
	var c := { "n": n, "body": _mm(geos.body, M.soft, n), "helmet": _mm(geos.helmet, M.helmet, n, true, true), "visor": _mm(geos.visor, M.visor, n),
		"limbs": _mm(geos.limb, M.white, n * 4), "people": [], "geos": geos }
	for key in ["body", "helmet", "visor", "limbs"]:
		parent.add_child(c[key])
	var hm: MultiMesh = (c.helmet as MultiMeshInstance3D).multimesh
	for i in n:
		hm.set_instance_color(i, _hexc(COLORS[i % COLORS.size()]))
	return c


static func _route_of(pts: Array) -> Dictionary:
	var lens := []
	var total := 0.0
	for i in range(1, pts.size()):
		var d := Vector2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]).length()
		lens.append(d)
		total += d
	return { "pts": pts, "lens": lens, "total": total }


static func _along(r: Dictionary, s: float, out: Dictionary) -> Dictionary:
	s = clampf(s, 0, r.total)
	var lens: Array = r.lens
	for i in lens.size():
		var li: float = lens[i]
		if s <= li or i == lens.size() - 1:
			var a: Array = r.pts[i]
			var b: Array = r.pts[i + 1]
			var t := clampf(s / li, 0, 1) if li else 0.0
			out.x = a[0] + (b[0] - a[0]) * t
			out.z = a[1] + (b[1] - a[1]) * t
			out.yaw = atan2(b[0] - a[0], b[1] - a[1])
			return out
		s -= li
	return out


func _person(route: Array, k: int, y := 0.0) -> Dictionary:
	var p := { "r": _route_of(route), "s": 0.0, "dir": -1 if k % 2 else 1, "wait": 0.5 + (k % 3) * 0.9, "x": 0.0, "z": 0.0, "y": y, "yaw": 0.0,
		"phase": k * 1.3, "wave": 0.0, "appear": 1.0, "speed": 1.0 + (k % 4) * 0.08, "walk": 0.0, "at": { "x": 0.0, "z": 0.0, "yaw": 0.0 },
		"delay": 0.0, "ground": false, "era": 0, "d": 0.0 }
	p.s = p.r.total * fmod(k * 0.37, 1.0)
	_along(p.r, p.s, p.at)
	p.x = p.at.x
	p.z = p.at.z
	p.yaw = p.at.yaw
	return p


func _place_men(n: int, instant: bool) -> void:
	if men == null:
		return
	var list: Array = ROUTES.get(n, [])
	var old: int = (men.people as Array).size()
	var out := []
	for k in list.size():
		var r = list[k]
		var p := _person(r.pts if r is Dictionary else r, k, float(r.y) if r is Dictionary else 0.0)
		p.appear = 1.0 if instant or k < old else 0.0
		p.delay = 0.0 if instant else (k - old) * 0.35
		out.append(p)
	men.people = out


static func _ang_to(a: float, b: float, t: float) -> float:
	return a + wrapf(b - a, -PI, PI) * t


## move one figure and write its instance placements. greet: a point (crowd-local) to wave at, or null.
func _step_person(c: Dictionary, i: int, p: Dictionary, dt: float, greet, moon: bool) -> void:
	var gd := 99.0
	if greet != null:
		gd = Vector2(greet.x - p.x, greet.z - p.z).length()
	if p.delay > 0:
		p.delay -= dt
		p.appear = 0.0
	elif p.appear < 1:
		p.appear = minf(1, p.appear + dt * 1.6)
	var waving: bool = gd < 7 and p.appear >= 1
	p.wave += ((1.0 if waving else 0.0) - p.wave) * minf(1, dt * 5)
	var moving := false
	if waving:
		p.yaw = _ang_to(p.yaw, atan2(greet.x - p.x, greet.z - p.z), minf(1, dt * 5))
	elif p.wait > 0:
		p.wait -= dt
	else:
		p.s += p.dir * p.speed * dt
		if p.s >= p.r.total or p.s <= 0:
			p.s = clampf(p.s, 0, p.r.total)
			p.dir = -p.dir
			p.wait = 1.4 + randf() * 2.4
		_along(p.r, p.s, p.at)
		p.x = p.at.x
		p.z = p.at.z
		p.yaw = _ang_to(p.yaw, p.at.yaw + (PI if p.dir < 0 else 0.0), minf(1, dt * 7))
		moving = true
	p.walk += ((1.0 if moving else 0.0) - p.walk) * minf(1, dt * 6)
	p.phase += dt * (4.2 if moon else 6.4) * p.walk
	var sw := sin(p.phase)
	var w: float = p.walk
	var sc := maxf(0.001, _pop(p.appear))
	var bob := absf(sw) * 0.2 * w if moon else absf(sw) * 0.05 * w
	if p.ground:
		p.y = Terrain.height(p.x, p.z)
	var base := Transform3D(Basis(Vector3.UP, p.yaw).scaled(Vector3(sc, sc, sc)), Vector3(p.x, p.y + bob, p.z))
	(c.body as MultiMeshInstance3D).multimesh.set_instance_transform(i, base)
	(c.helmet as MultiMeshInstance3D).multimesh.set_instance_transform(i, base)
	(c.visor as MultiMeshInstance3D).multimesh.set_instance_transform(i, base)
	var legA := -0.35 * w * absf(sw) if moon else 0.55 * sw * w
	var legB := legA if moon else -legA
	var armA := -0.5 * w if moon else -0.45 * sw * w
	var lm: MultiMesh = (c.limbs as MultiMeshInstance3D).multimesh
	_limb(lm, i * 4, base, -0.2, 0.66, legA, 0, 1)
	_limb(lm, i * 4 + 1, base, 0.2, 0.66, legB, 0, 1)
	_limb(lm, i * 4 + 2, base, -0.47, 1.42, armA, -0.12, 0.82)
	_limb(lm, i * 4 + 3, base, 0.47, 1.42, lerpf(armA if moon else -armA, -0.2, p.wave), lerpf(0.12, 2.6 + sin(tm * 9 + i) * 0.35, p.wave), 0.82)


static func _limb(lm: MultiMesh, j: int, base: Transform3D, x: float, y: float, rx: float, rz: float, w: float) -> void:
	var b := Basis.from_euler(Vector3(rx, 0, rz), EULER_ORDER_XYZ) * Basis.from_scale(Vector3(w, 1, w))
	lm.set_instance_transform(j, base * Transform3D(b, Vector3(x, y, 0)))


static func _flush_crowd(c: Dictionary, n: int) -> void:
	for key in ["body", "helmet", "visor"]:
		(c[key] as MultiMeshInstance3D).multimesh.visible_instance_count = n
	(c.limbs as MultiMeshInstance3D).multimesh.visible_instance_count = n * 4


func _step_men(dt: float, ctx: Dictionary) -> void:
	var list: Array = men.people
	var greet = null
	var n := mini(list.size(), men.n)
	var pos = ctx.get("pos")
	if pos is Vector3 and ctx.get("mode") == "play":
		greet = { "x": lx(pos.x, pos.z), "z": lz(pos.x, pos.z) }
	for i in n:
		_step_person(men, i, list[i], dt, greet, site == "moon")
	_flush_crowd(men, n)


# ---------- arrivals ----------
static func _remove_ref(a: Array, c) -> void:
	for i in range(a.size() - 1, -1, -1):
		if is_same(a[i], c):
			a.remove_at(i)


func _set_cols(u: Dictionary, on: bool) -> void:
	var C: Array = Base.colliders
	if on and not u.on:
		for c in u.cols:
			C.append(c)
	if not on and u.on:
		for c in u.cols:
			_remove_ref(C, c)
	u.on = on


func _show(u: Dictionary, on: bool) -> void:
	var g: Node3D = u.g
	g.visible = on
	g.scale = Vector3.ONE
	if u.ship:
		g.position = u.home
		g.rotation.x = 0
		u.ship.flame.visible = false
		u.ship.core.visible = false
	_set_cols(u, on)


func _ship_of(n: int):
	for u in units:
		if u.stage == n and u.ship:
			return u
	return null


static func _near(ctx, x: float, z: float, r: float) -> bool:
	if not (ctx is Dictionary) or not (ctx.get("pos") is Vector3):
		return false
	var p: Vector3 = ctx.pos
	return Vector2(p.x - x, p.z - z).length() < r


func _sound(ctx, name: String, r := 140.0) -> void:
	if ctx is Dictionary and ctx.get("mode") in ["play", "inside"] and _near(ctx, CX, CZ, r):
		Au.play(name)


func _dust_ring(x: float, z: float, n: int, speed: float, size: float) -> void:
	var X := wx(x, z)
	var Z := wz(x, z)
	var col := 0xd9a070 if site == "mars" else 0xb8b9c4
	for i in n:
		var a := randf() * TAU
		var sp := speed * (0.5 + randf() * 0.7)
		var r0 := randf() * 2
		World.emit(X + cos(a) * r0, h0 + 0.4, Z + sin(a) * r0, { "vx": cos(a) * sp, "vy": 0.4 + randf() * 1.6, "vz": sin(a) * sp, "life": 1.6 + randf(),
			"size": size, "grow": 3.4, "color": col, "alpha": 0.4, "grav": World.gravity * 0.08 })


func _start_arrival(n: int) -> void:
	var ship = _ship_of(n)
	for u in units:
		if u.stage == n and u.pre:
			_show(u, true)
	if ship == null:
		for u in units:
			if u.stage == n:
				_show(u, true)
		_place_men(n, true)
		return
	var list := []
	for u in units:
		if u.stage == n and not u.ship and not u.pre:
			u.done = false
			list.append(u)
	arr = { "n": n, "t": 0.0, "ship": ship, "landed": false, "men": false, "rum": 0.0, "list": list }
	var a := -0.35 + (n - 2) * 0.5
	var d := Vector2(a, 1).length()
	arr.ox = a / d                           # ships fly in from behind the colony
	arr.oz = -1 / d
	var g: Node3D = ship.g
	g.visible = true
	g.scale = Vector3.ONE
	var h: Vector3 = ship.home
	(fx.beacon as Node3D).position = Vector3(h.x, 0.14, h.z)
	(fx.beacon as Node3D).visible = true
	(fx.glow as Node3D).position = Vector3(h.x, 0.1, h.z)
	(fx.glow as Node3D).visible = true
	_step_arrival(0, null)


func _step_arrival(dt: float, ctx) -> void:
	var a: Dictionary = arr
	a.t += dt
	var t: float = a.t
	var sh: Dictionary = a.ship
	var h: Vector3 = sh.home
	var sp: Dictionary = sh.ship
	var g: Node3D = sh.g
	var glow_m: StandardMaterial3D = M.groundGlow
	if t < LAND:
		var k := 1 - t / LAND
		var alt := 125 * pow(k, 2.1)
		var off := 75 * k * k
		g.position = Vector3(h.x + a.ox * off, alt, h.z + a.oz * off)
		g.rotation.x = -0.32 * k + sin(t * 2.3) * 0.015 * k
		sp.flame.visible = true
		sp.core.visible = true
		var fl := 0.75 + randf() * 0.45 + (0.3 if alt < 30 else 0.0)
		var f: MeshInstance3D = sp.flame
		var core: MeshInstance3D = sp.core
		f.scale.y = sp.len * fl
		f.position.y = sp.y - sp.len * fl / 2
		core.scale.y = sp.len * fl * 0.45
		core.position.y = sp.y - sp.len * fl * 0.22
		(f.material_override as StandardMaterial3D).albedo_color.a = 0.55 + randf() * 0.3
		glow_m.albedo_color.a = 0.85 * clampf(1 - alt / 45, 0, 1) * (0.85 + randf() * 0.15)
		(fx.glow as Node3D).scale = Vector3.ONE * (5 + minf(alt, 40) * 0.22)
		Mats.energy(M.ring, 1 + sin(t * 8) * 0.8)
		(fx.beacon as Node3D).rotation.z = t
		if alt < 28 and dt > 0:
			var gx := wx(g.position.x, g.position.z)
			var gz := wz(g.position.x, g.position.z)
			var dc := 0xd9a070 if site == "mars" else 0xb8b9c4
			for i in World.rate((1 - alt / 28) * 7, dt):
				var an := randf() * TAU
				var r0 := 1.5 + randf() * 3
				var v := 9 + randf() * 16
				World.emit(gx + cos(an) * r0, h0 + 0.35, gz + sin(an) * r0, { "vx": cos(an) * v, "vy": 0.3 + randf() * 1.4, "vz": sin(an) * v, "life": 1.3,
					"size": 1.3, "grow": 3.4, "color": dc, "alpha": 0.4, "grav": 0.0 })
		a.rum -= dt
		if a.rum <= 0 and dt > 0:
			a.rum = 0.45
			_sound(ctx, "rumble", 110)
	elif not a.landed:
		a.landed = true
		g.position = h
		g.rotation.x = 0
		sp.flame.visible = false
		sp.core.visible = false
		(fx.beacon as Node3D).visible = false
		Mats.energy(M.ring, 1.2)
		_set_cols(sh, true)
		_dust_ring(h.x, h.z, 70, 15, 1.4)
		_sound(ctx, "touchdown", 120)
		if _near(ctx, CX, CZ, 70) and ctx.get("mode") == "play":
			World.cam.shake = maxf(World.cam.shake, 0.35)
	if a.landed:
		glow_m.albedo_color.a = maxf(0, glow_m.albedo_color.a - dt * 1.6)
	var list: Array = a.list
	for i in list.size():
		var u: Dictionary = list[i]
		var t0: float = LAND + 0.5 + u.delay
		var ug: Node3D = u.g
		if t < t0:
			ug.visible = false
			continue
		if not u.done:
			u.done = true
			ug.visible = true
			_set_cols(u, true)
			_dust_ring(ug.position.x, ug.position.z, 14, 4, 0.9)
			if i % 2 == 0:
				_sound(ctx, "pop", 90)
		ug.scale = Vector3.ONE * maxf(0.001, _pop(_seg(t, t0, t0 + 0.75)))
	if not a.men and t > LAND + 1.0:
		a.men = true
		_place_men(a.n, false)
	if t >= END:
		_finish_arrival()


func _finish_arrival() -> void:
	if arr == null:
		return
	var a: Dictionary = arr
	arr = null
	for u in units:
		if u.stage == a.n:
			_show(u, true)
	if not a.men:
		_place_men(a.n, true)
	_set_pop(a.n)
	(fx.beacon as Node3D).visible = false
	(fx.glow as Node3D).visible = false
	(M.groundGlow as StandardMaterial3D).albedo_color.a = 0.0
	Mats.energy(M.ring, 1.2)


# ---------- set-up ----------
func _build_all(root: Node3D, site_id: String) -> void:
	if vis:
		_end_vision()
	site = "moon" if site_id == "moon" else "mars"
	units = []
	stage_now = 0
	arr = null
	men = null
	fields = []
	tram = null
	sign_sc = null
	tm = 0.0
	if _holder and is_instance_valid(_holder):
		_holder.queue_free()
	_holder = Node.new()
	_holder.name = "ColonySigns"
	add_child(_holder)
	G = _make_geos()
	M = _make_mats()
	pop_now = people(3)
	ROUTES = _make_routes()
	var L: Vector2 = Terrain.L.colony
	CX = L.x
	CZ = L.y
	h0 = Terrain.height(CX, CZ)
	ROT = atan2(-CX, -CZ)
	cosR = cos(ROT)
	sinR = sin(ROT)
	grp = Node3D.new()
	grp.name = "Colony"
	grp.position = Vector3(CX, h0, CZ)
	grp.rotation.y = ROT
	root.add_child(grp)
	# stage 1: the supply ship
	_cargo_lander(_unit(1, -14, -12, PI / 2))
	_crates(_unit(1, -7.5, -7.5, 0, 0))
	_garage(_unit(1, -15, 2, 0, 0.4))
	_rover(_unit(1, -10.2, 11.6, 0.95, 0.8))
	_path_lights(_unit(1, 0, 0, 0, 1.1))
	# stage 2: the first settlers
	_crew_lander(_unit(2, 0, -16, 0))
	_hab2(_unit(2, 9, -5, 0, 0))
	_greenhouse(_unit(2, 9, 4.5, 0, 0.55))
	# stage 3: a small town
	var p := _unit(3, 14, -13, 0)
	_pad(p)
	p.pre = true
	_shuttle(_unit(3, 14, -13, -0.9))
	_hub(_unit(3, -1, -6, 0, 0))
	_tubes(_unit(3, 0, 0, 0, 0.6))
	_shield_dome(_unit(3, -8, 1, 0, 0.3))
	_solar_farm(_unit(3, 0, 0, 0, 0.9))
	_plaza(_unit(3, 0, 1.5, 0, 1.15))
	_sign(_unit(3, 5.2, 15.5, 0, 1.4))
	# stage 4: a growing town, in a ring around the first one
	p = _unit(4, -16, -21.5, 0)
	_pad(p, 4.3)
	p.pre = true
	_ferry(_unit(4, -16, -21.5, 0.64))
	_homes(_unit(4, -26.1, -2.3, 0, 0))
	_streets(_unit(4, 0, 0, 0, 0.35))
	_tank_farm(_unit(4, -6, -24.2, 0.243, 0.7))
	_farm(_unit(4, 21.5, 15.5, 0.945, 1.05))
	_school(_unit(4, 27.6, 2.5, -PI / 2, 1.4))
	_mast(_unit(4, 3.5, -23.5, -0.148, 1.75))
	# stage 5: the first city, out to the ring road
	p = _unit(5, 13.3, -23, 0)
	_pad(p, 4.6)
	p.pre = true
	_liner(_unit(5, 13.3, -23, -0.524))
	_gantry(_unit(5, 18.06, -20.25, -2.095, 0))
	_ring_road(_unit(5, 0, 0, 0, 0.4))
	_biodome(_unit(5, -18, 17.8, -2.937, 0.8))
	_tower(_unit(5, 26.6, -10.6, -PI / 2, 1.2))
	_square(_unit(5, -8.5, 25.5, 0, 1.5))
	_sun_arc(_unit(5, 0, 0, 0, 1.8))
	for u in units:
		u.home = (u.g as Node3D).position
	_aim_panels(true)
	# effects shared by every arrival
	var beacon := MeshInstance3D.new()
	beacon.mesh = _geo_mesh(G.ring)
	beacon.material_override = M.ring
	beacon.rotation_order = EULER_ORDER_XYZ
	beacon.rotation.x = PI / 2
	beacon.scale = Vector3(3.2, 3.2, 2.5)
	beacon.visible = false
	beacon.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var glow := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(1, 1)
	glow.mesh = pm
	glow.material_override = M.groundGlow
	glow.visible = false
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	glow.sorting_offset = 4
	grp.add_child(beacon)
	grp.add_child(glow)
	fx = { "beacon": beacon, "glow": glow }
	men = _make_crowd(grp, (ROUTES[LAST] as Array).size(), _settler_geos())
	_place_men(0, true)


func _anim_lights() -> void:
	Mats.energy(M.blink, 2.8 if fmod(tm, 1.6) < 0.22 else 0.25)
	Mats.energy(M.blink2, 2.8 if fmod(tm + 0.8, 1.6) < 0.22 else 0.25)
	Mats.energy(M.pink, 1.75 + sin(tm * 1.3) * 0.25)
	(M.haze as StandardMaterial3D).albedo_color.a = 0.17 + sin(tm * 1.3) * 0.04
	Mats.energy(M.win, 1.45 + sin(tm * 0.7) * 0.08)


## the welcome sign counts the people
func _set_pop(n: int) -> void:
	var p := people(maxi(3, n))
	if p == pop_now:
		return
	pop_now = p
	if sign_sc:
		Paint.redraw(sign_sc, _paint_sign)


func _how_many(n: int) -> String:
	var p := people(n)
	return WORDS.get(p, str(p))


# ---------- the API ----------
func build(root: Node3D, site_id: String) -> void:
	_build_all(root, site_id)


func set_stage(n, opts := {}) -> void:
	if grp == null:
		return
	var s := clampi(roundi(float(n)), 0, LAST)
	if arr:
		_finish_arrival()
	var animate: bool = bool(opts.get("arrive", false)) and s > 0 and s > stage_now
	for u in units:
		_show(u, u.stage < s or (u.stage == s and not animate))
	var from := stage_now
	stage_now = s
	if animate:
		if s - 1 != from:
			_place_men(s - 1, true)
		_start_arrival(s)
	else:
		_place_men(s, true)
	if s >= 3:
		_aim_panels(true)
	_set_pop(s - 1 if animate else s)        # the newcomers are counted once their ship has landed


func stage() -> int:
	return stage_now


## how many people the story gives stage n (the stage now if n is left out): 0, 0, 4, 12, 30, 80
func people(n = null) -> int:
	var list: Array = Data.RULES.get("townPeople", PEOPLE)
	var k := clampi(stage_now if n == null else roundi(float(n)), 0, LAST)
	return int(list[k]) if k < list.size() and list[k] != null else int(PEOPLE[k])


func update(dt: float, ctx = null) -> void:
	if grp == null or not is_instance_valid(grp):
		return
	dt = clampf(dt, 0, 0.1)
	var c: Dictionary = ctx if ctx is Dictionary else {}
	tm += dt
	if vis:
		vis.last = Time.get_ticks_msec()
		_step_vision(dt)
	if arr:
		_step_arrival(dt, c)
	if tram and (tram.u.g as Node3D).visible:
		_step_tram(dt)
	_anim_lights()
	if stage_now >= 3 or vis:
		_aim_panels(false)
	if men:
		_step_men(dt, {} if vis else c)


func town() -> String:
	return TOWN.get(site, "")


func busy() -> bool:
	return arr != null


## where to look: the ship while one is landing, otherwise the middle of the colony
func focus() -> Vector3:
	if arr and arr.ship:
		var g: Vector3 = (arr.ship.g as Node3D).position
		return Vector3(wx(g.x, g.z), h0 + g.y + 4, wz(g.x, g.z))
	return Vector3(CX, h0 + 4, CZ)


func info(n):
	var moon := site == "moon"
	var name: String = TOWN[site]
	match int(n):
		1:
			return { "icon": "📦", "title": "A supply ship from Earth!",
				"text": "You kept the outpost running, so Earth sent a cargo lander. It came down on the flat plain north-east of the habitat with crates of food, tools and spare parts, a garage that holds air and a new rover. " +
					("Real Moon plans work like this: robot landers bring supplies first, so everything is ready when more people arrive." if moon
					else "The trip from Earth takes about seven months, so real Mars plans send supplies ahead, long before people need them.") }
		2:
			return { "icon": "🧑‍🚀", "title": "The first settlers are here!",
				"text": "Four new crew members moved in next door. Their home inflates like a balloon. A real inflatable room called BEAM was added to the International Space Station in 2016. " +
					"Their greenhouse glows pink because plants grow well under red and blue light, just like the Veggie garden on the Space Station." }
		3:
			return { "icon": "🏘️", "title": "Welcome to " + name + "!",
				"text": "Twelve people now live in " + name + ", the first little town on " + ("the Moon" if moon else "Mars") + "! " +
					("Its solar panels stand up tall, because near the south pole the Sun always stays low in the sky. " if moon
					else "Mars gets less than half the sunlight that Earth does, so the town needs a big solar farm. ") +
					"A hard landing pad stops rocket blasts from spraying dust and stones at the houses." }
		4:
			return { "icon": "🏫", "title": name + " is growing!",
				"text": _how_many(4) + " people live in " + name + " now. A big ferry brought whole families, so the town built more homes, a school, a farm of greenhouse tunnels and tall tanks of water and oxygen. " +
					"This town is imagined, but the idea is real: on the Space Station, about 98 of every 100 drops of water are cleaned and used again." }
		5:
			return { "icon": "🌆", "title": "The first city on " + ("the Moon" if moon else "Mars") + "!",
				"text": _how_many(5) + " people call " + name + " home now. A little tram circles the ring road, a spaceport welcomes big ships, and trees grow around a pond under a clear dome. " +
					"It is an imagined future built on real ideas: NASA's Ice Home design" + (", first drawn for Mars," if moon else " for Mars") + " has walls of water ice that let sunlight in and keep space radiation out." }
	return null


# =====================================================================
#  THE FUTURE VISION: an imagined flyover, 10, 30 and 100 years later
# =====================================================================
func _gmin(x: float, z: float, r: float) -> float:
	var h := Terrain.height(x, z)
	for i in 8:
		var a := i * PI / 4
		h = minf(h, Terrain.height(x + cos(a) * r, z + sin(a) * r))
	return h


func _cw(x: float, z: float) -> Dictionary:
	return { "x": wx(x, z), "z": wz(x, z) }


static func _P(x: float, z: float) -> Dictionary:
	return { "x": x, "z": z }


static func _toward(a: Dictionary, b: Dictionary, d: float) -> Dictionary:
	var dx: float = b.x - a.x
	var dz: float = b.z - a.z
	var l := Vector2(dx, dz).length()
	if l == 0:
		l = 1
	return _P(a.x + dx / l * d, a.z + dz / l * d)


static func _pts(list: Array) -> Array:
	var out := []
	for p in list:
		out.append([p.x, p.z])
	return out


static func _item(x: float, y: float, z: float, ry: float, sx: float, sy: float, sz: float, d: float, rx := 0.0, rz := 0.0) -> Dictionary:
	return { "x": x, "y": y, "z": z, "ry": ry, "rx": rx, "rz": rz, "sx": sx, "sy": sy, "sz": sz, "d": d, "puffed": false }


## repeated parts of one era, growing out of the ground one after another
func _vinst(era: int, geo: Dictionary, mat: Material, items: Array, shadow := true) -> Dictionary:
	var see_through := mat is BaseMaterial3D and (mat as BaseMaterial3D).transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
	var im := _mm(_geo_mesh(geo, mat.has_meta("flat")), mat, items.size(), shadow and not see_through)
	(vis.root as Node3D).add_child(im)
	var r := { "era": era, "im": im, "items": items, "done": false }
	(vis.insts as Array).append(r)
	return r


func _vgroup(era: int, g: Node3D, d := 0.0, puff := 0.0) -> Node3D:
	g.visible = false
	g.scale = Vector3.ONE * 0.001
	(vis.root as Node3D).add_child(g)
	(vis.groups as Array).append({ "era": era, "g": g, "d": d, "puff": puff, "done": false })
	return g


func _puff_at(x: float, z: float, n: int, size: float) -> void:
	var col := 0xd9a070 if site == "mars" else 0xb8b9c4
	var y := Terrain.height(x, z) + 0.5
	for i in n:
		var a := randf() * TAU
		var sp := 3 + randf() * 5
		World.emit(x + cos(a) * size * 0.8, y, z + sin(a) * size * 0.8, { "vx": cos(a) * sp, "vy": 0.6 + randf() * 1.5, "vz": sin(a) * sp, "life": 2 + randf(),
			"size": size * 0.35 + 0.8, "grow": 3.0, "color": col, "alpha": 0.35, "grav": 0.0 })


## the windows of the towers: a plain wall, and (lit) only the windows that glow at night
static func _tower_tex(lit: bool) -> ImageTexture:
	var r := Rng32.new(55)
	var img := Image.create(128, 256, false, Image.FORMAT_RGBA8)
	img.fill(Color.BLACK if lit else Color("#e4e7ee"))
	for y in 16:
		for x in 8:
			var on := r.next() < 0.62
			if lit and not on:
				continue
			img.fill_rect(Rect2i(x * 16 + 3, y * 16 + 4, 10, 8), Color("#ffd98a") if lit else (Color("#ffe9b8") if on else Color("#8d96ad")))
	if not lit:
		for y in range(0, 256, 64):
			img.fill_rect(Rect2i(0, y, 128, 3), Color("#3d7dff"))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _vision_stuff() -> void:
	var moon := site == "moon"
	VG = {
		"tower": _geo_xform(_cyl_geo(1, 1, 1, 18), Transform3D(Basis(), Vector3(0, 0.5, 0))),
		"band": _shape("vband", func(): return _torus_geo(1, 0.022, 6, 64)),
		"capsule": _geo_xform(_capsule_geo(1, 2, 6, 16), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3.ZERO)),
		"tunnel": _geo_xform(_cyl_geo(1, 1, 1, 16, true, 0, PI), Transform3D(Basis(Vector3.BACK, PI / 2), Vector3.ZERO)),
	}
	# a lumpy pile of soil over a dome: nudge each point in or out by a smooth noise
	var lump := _sphere_geo(20, 8, 0, TAU, 0, PI / 2)
	var p: PackedVector3Array = lump.p
	for i in p.size():
		var q := p[i]
		var n := 1 + (Terrain.noise(q.x * 3 + 7, q.z * 3 + q.y * 2) - 0.5) * 0.12 * minf(1, q.y * 3 + 0.2)
		p[i] = q * n
	VG.lump = { "p": p, "n": GB.flat(p, lump.n), "f": GB.flat(p, lump.n), "uv": lump.uv }
	var k := Kit.new()
	k.put("soft", _shape("cap1.0", func(): return _capsule_geo(1.0, 2.6, 4, 12)), mx(0, 1.45, 0, PI / 2, 0, 0), 0xf2f3f7)
	k.put("soft", G.box, mx(0, 1.15, 0, 0, 0, 0, 2.1, 0.32, 4.1), 0xff8a3d)
	k.put("soft", G.box, mx(0, 1.85, 1.9, -0.5, 0, 0, 1.4, 0.45, 0.12), 0x2b3147)
	k.put("soft", G.box, mx(-1.05, 0.48, 0, 0, 0, 0, 0.42, 0.95, 3.9), 0x22252f)
	k.put("soft", G.box, mx(1.05, 0.48, 0, 0, 0, 0, 0.42, 0.95, 3.9), 0x22252f)
	VG.rover = k.mesh("soft")
	k = Kit.new()
	k.put("soft", G.ball, mx(-0.65, 1.2, 2.55, 0, 0, 0, 0.2))
	k.put("soft", G.ball, mx(0.65, 1.2, 2.55, 0, 0, 0, 0.2))
	VG.lights = k.mesh("soft")
	var regolith := _std(0x8a8b95 if moon else 0xb5643a, 1.0, 0.0, false)
	regolith.set_meta("flat", true)
	var tower := _std(0xffffff, 0.5, 0.0, false)
	tower.albedo_texture = _tower_tex(false)
	tower.emission_enabled = true
	tower.emission_texture = _tower_tex(true)
	tower.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY      # only the lit windows glow
	tower.emission = Mats.lin(0xffd98a)
	tower.emission_energy_multiplier = 1.3
	tower.uv1_scale = Vector3(3, 2, 1)
	VM = {
		"regolith": regolith,
		"glass": _glass(0xdff4ff, 0.27, 0.05, 0.2, 0x7fc4ff, 0.2),
		"park": Mats.soft(0x5fbf5a), "tree": Mats.mat(0x2f9a4a), "pad": Mats.soft(0x4a4f63),
		"lake": _glow_mat(0x3aa0ff, 0.55),
		"gh": _glass(0xffc8ee, 0.5, 0.1, 0.0, 0xff4fc8, 0.85),
		"road": Mats.soft(0x3d3f4a if moon else 0x5a3a2a, { "roughness": 0.95 }), "roadGlow": _glow_mat(0x7fe8ff, 1.7),
		"tower": tower,
	}


# ---------- where things go (metres, world) ----------
func _layout() -> Dictionary:
	var moon := site == "moon"
	var L: Dictionary = Terrain.L
	var R: float = Terrain.ice_r if Terrain.ice_r > 0 else 25.0
	var Z := {}
	Z.C = _P(CX, CZ)
	Z.ice = _P(L.ice.x, L.ice.y)
	Z.R = R
	Z.plant = _P(Z.ice.x - 0.6 * (R + 12), Z.ice.z - 0.8 * (R + 12))
	Z.plantFront = _toward(Z.plant, Z.C, 9)
	Z.react = _P(128, -95)
	Z.farm = _P(-4, -108)
	Z.port = _P(128, 26)
	Z.city = _P(-45, -105) if moon else _P(-62, -100)
	Z.cityR = 26.0 if moon else 28.0
	# the roads start at the city's ring road (35 m out), and everything new stands outside it
	Z.roads = {
		"a": [_P(-4, -13), _P(1, -34), _cw(-8, 38), _cw(0, 35.4), _cw(0, 23)],
		"b": [_cw(33.9, -9), _cw(36, -12), Z.plantFront],
		"c": [_toward(Z.C, _P(7, -89.5), 35.2), _P(7, -89.5), _P(-9, -89.5)],
		"d": [_toward(Z.C, _P(80, -12), 35.2), _P(80, -12), _P(102, 10), _P(112, 26)],
		"f": [_toward(Z.C, _P(-10, -84), 35.2), _P(-10, -84), _toward(Z.city, _P(-10, -84), Z.cityR + 2)],
	}
	Z.mods = [[-0.6, -69.2, 0.9], [58.3, -24.0, 0.2], [74.0, -42.5, 1.2], [47.0, -104.0, 0.1]]
	Z.towers2 = [[-0.4, -54.8, 2.8, 16.0], [56.7, -98.9, 3.0, 20.0], [19.9, -98.2, 2.8, 18.0], [30.9, -22.1, 2.5, 14.0]]
	Z.domes2 = [[-26.0, -46.0, 8.0], [72.0, -93.0, 9.0], [62.0, 18.0, 8.0], [-56.0, 8.0, 9.0], [31.7, -105.5, 8.0], [110.0, 55.0, 9.0]]
	Z.domes3 = [[-82.0, -22.0, 6.0], [-98.0, 12.0, 6.0], [-70.0, 62.0, 6.0], [-10.0, 72.0, 6.0], [40.0, 85.0, 6.0], [150.0, -20.0, 7.0], [155.0, 60.0, 6.0],
		[100.0, -130.0, 6.0], [-110.0, -60.0, 6.0], [-120.0, -100.0, 6.0]]
	Z.pads2 = [_P(112, 26), _P(128, 42), _P(144, 26)]
	Z.pads3 = [_P(96, 44), _P(160, 44)]
	return Z


func _road(era: int, pts: Array, d0: float) -> void:
	var surf := []
	var lit := []
	var dist := 0.0
	for i in range(1, pts.size()):
		var a: Dictionary = pts[i - 1]
		var b: Dictionary = pts[i]
		var L := Vector2(b.x - a.x, b.z - a.z).length()
		var n := maxi(1, roundi(L / 5))
		var l := L / n
		for k in n:
			var x0 := lerpf(a.x, b.x, float(k) / n)
			var z0 := lerpf(a.z, b.z, float(k) / n)
			var x1 := lerpf(a.x, b.x, float(k + 1) / n)
			var z1 := lerpf(a.z, b.z, float(k + 1) / n)
			var y0 := Terrain.height(x0, z0) + 0.2
			var y1 := Terrain.height(x1, z1) + 0.2
			var yaw := atan2(x1 - x0, z1 - z0)
			var pitch := -atan2(y1 - y0, l)
			var cx := (x0 + x1) / 2
			var cz := (z0 + z1) / 2
			var cy := (y0 + y1) / 2
			var d := d0 + dist / 40
			var ox := cos(yaw) * 2.05
			var oz := -sin(yaw) * 2.05
			surf.append(_item(cx, cy, cz, yaw, 4.2, 0.3, l + 0.6, d, pitch))
			lit.append(_item(cx + ox, cy + 0.14, cz + oz, yaw, 0.18, 0.1, l * 0.62, d, pitch))
			lit.append(_item(cx - ox, cy + 0.14, cz - oz, yaw, 0.18, 0.1, l * 0.62, d, pitch))
			dist += l
	_vinst(era, G.box, VM.road, surf)
	_vinst(era, G.box, VM.roadGlow, lit, false)
	(vis.roads as Array).append({ "era": era, "r": _route_of(_pts(pts)), "d0": d0 })


func _vrover(era: int, route: Array, s0: float, speed: float) -> void:
	(vis.rovers as Array).append({ "era": era, "r": _route_of(route), "s": s0, "dir": 1, "speed": speed, "appear": 0.0, "wait": 0.0, "at": { "x": 0.0, "z": 0.0, "yaw": 0.0 } })


## people strolling along the pavements beside a road, or on a patch of open ground
func _walkers(era: int, n: int, seed_value: int) -> void:
	var r := Rng32.new(seed_value)
	var roads := []
	for q in vis.roads:
		if q.era <= era:
			roads.append(q)
	if roads.is_empty():
		return
	for i in n:
		var q: Dictionary = roads[int(floor(r.next() * roads.size()))].r
		var s: float = r.next() * maxf(1, q.total - 20)
		var at := _along(q, s, {})
		var bt := _along(q, s + 8 + r.next() * 12, {})
		var side := -2.9 if r.next() < 0.5 else 2.9
		var ox: float = cos(at.yaw) * side
		var oz: float = -sin(at.yaw) * side
		_add_walker(era, [[at.x + ox, at.z + oz], [bt.x + ox, bt.z + oz]], i)


func _add_walker(era: int, route: Array, k: int) -> void:
	var p := _person(route, k, 0)
	p.ground = true
	p.era = era
	p.appear = 0.0
	p.delay = 1e9
	p.d = 0.6 + (k % 7) * 0.25
	(vis.people as Array).append(p)


func _crowd_at(era: int, x: float, z: float, rad: float, n: int, seed_value: int) -> void:
	var r := Rng32.new(seed_value)
	for i in n:
		var a := r.next() * TAU
		var b := a + 0.6 + r.next() * 1.2
		var ra := rad * (0.3 + r.next() * 0.7)
		var rb := rad * (0.3 + r.next() * 0.7)
		_add_walker(era, [[x + cos(a) * ra, z + sin(a) * ra], [x + cos(b) * rb, z + sin(b) * rb]], i + seed_value)


func _vship(era: int, pad: Dictionary, off: float, per: float, park := false) -> void:
	var src = _ship_of(3)
	if src == null:
		return
	var g := Node3D.new()
	for m in src.meshes:
		var c := MeshInstance3D.new()
		c.mesh = (m as MeshInstance3D).mesh
		c.material_override = (m as MeshInstance3D).material_override
		c.cast_shadow = (m as MeshInstance3D).cast_shadow
		g.add_child(c)
	var f := MeshInstance3D.new()
	f.mesh = _geo_mesh(G.flame)
	f.material_override = _add_mat(0xffb040, 0.85)
	var core := MeshInstance3D.new()
	core.mesh = _geo_mesh(G.flame)
	core.material_override = _add_mat(0xfff2c0, 0.9)
	for q in [f, core]:
		q.rotation.x = PI
		q.visible = false
		q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		g.add_child(q)
	g.scale = Vector3.ONE * 1.7
	g.rotation.y = off * 2.1
	g.visible = false
	(vis.root as Node3D).add_child(g)
	(vis.ships as Array).append({ "era": era, "g": g, "f": f, "core": core, "x": pad.x, "y": pad.y + 0.5, "z": pad.z, "off": off, "per": per, "park": park, "shown": false })


# ---------- 10 years later: ice, air, power and more homes ----------
func _era1(Z: Dictionary) -> void:
	var moon := site == "moon"
	var it := []
	var wins := []
	_road(1, Z.roads.a, 0)
	_road(1, Z.roads.b, 0.5)
	_road(1, Z.roads.c, 0.8)
	var mods: Array = Z.mods
	for n in mods.size():
		var m: Array = mods[n]
		var y := _gmin(m[0], m[1], 4)
		it.append(_item(m[0], y + 1.6, m[1], m[2], 2, 2, 2, 0.3 + n * 0.3))
		var c := cos(m[2])
		var s := sin(m[2])
		for k in range(-1, 2):
			wins.append(_item(m[0] + c * 1.93 + s * k * 2.1, y + 2.1, m[1] - s * 1.93 + c * k * 2.1, m[2], 0.12, 0.42, 0.6, 0.3 + n * 0.3))
			wins.append(_item(m[0] - c * 1.93 + s * k * 2.1, y + 2.1, m[1] + s * 1.93 + c * k * 2.1, m[2], 0.12, 0.42, 0.6, 0.3 + n * 0.3))
	_vinst(1, VG.capsule, M.white, it)
	_vinst(1, G.ball, M.win, wins, false)
	# a farm of greenhouse tunnels
	var tun := []
	var floor_ := []
	var arch := []
	var hall := []
	var farm: Dictionary = Z.farm
	for i in 6:
		var tz: float = farm.z + (i - 2.5) * 5.4
		var y := _gmin(farm.x, tz, 6.5)
		tun.append(_item(farm.x, y, tz, 0, 13, 2.2, 2.2, 0.5 + i * 0.18))
		floor_.append(_item(farm.x, y + 0.2, tz, 0, 12.4, 0.4, 3.4, 0.5 + i * 0.18))
		arch.append(_item(farm.x - 6.5, y, tz, PI / 2, 2.25, 2.25, 2.25, 0.5 + i * 0.18))
		arch.append(_item(farm.x + 6.5, y, tz, PI / 2, 2.25, 2.25, 2.25, 0.5 + i * 0.18))
	var hy := _gmin(farm.x + 7.6, farm.z, 8)
	hall.append(_item(farm.x + 7.8, hy + 1.1, farm.z, 0, 1.3, 30, 1.3, 0.4, PI / 2))
	_vinst(1, G.box, VM.park, floor_)
	_vinst(1, VG.tunnel, VM.gh, tun)
	_vinst(1, G.arch, M.white, arch)
	_vinst(1, G.cyl, M.white, hall)
	# the ice plant on the crater rim, with a conveyor down to the ice
	var pg := Node3D.new()
	var kt := Kit.new()
	var plant: Dictionary = Z.plant
	var ice: Dictionary = Z.ice
	var R: float = Z.R
	var py := _gmin(plant.x, plant.z, 7)
	pg.position = Vector3(plant.x, py, plant.z)
	pg.rotation.y = atan2(ice.x - plant.x, ice.z - plant.z)
	for x in [-4.2, 0.0, 4.2]:
		kt.put("soft", G.cyl, mx(x, 4.2, -3.5, 0, 0, 0, 1.7, 8, 1.7), 0xf4f5f9)
		kt.put("soft", G.dome, mx(x, 8.2, -3.5, 0, 0, 0, 1.7), 0xf4f5f9)
		kt.put("soft", G.ring, mx(x, 2.6, -3.5, PI / 2, 0, 0, 1.73), 0x3d7dff)
		kt.put("soft", G.ring, mx(x, 6.2, -3.5, PI / 2, 0, 0, 1.73), 0x3d7dff)
		kt.put("blink", G.ball, mx(x, 10.0, -3.5, 0, 0, 0, 0.2))
	kt.put("soft", G.box, mx(0, 2.3, 2.2, 0, 0, 0, 11, 4.6, 6), 0xd7dae3)
	kt.put("soft", G.box, mx(0, 4.7, 2.2, 0, 0, 0, 11.4, 0.3, 6.4), 0xffb84d)
	kt.put("cyan", G.box, mx(0, 3.1, 5.22, 0, 0, 0, 9, 0.5, 0.1))
	kt.put("cyan", G.box, mx(0, 3.1, -0.82, 0, 0, 0, 9, 0.5, 0.1))
	var zE := 0.5 * R + 12
	var xE: float = ice.x - 0.6 * R * 0.5
	var zW: float = ice.z - 0.8 * R * 0.5
	var yE := Terrain.height(xE, zW) + 1.2 - py
	var z0 := 5.5
	var y0 := 4.2
	var cl := Vector2(zE - z0, yE - y0).length()
	kt.put("soft", G.box, mx(0, (y0 + yE) / 2, (z0 + zE) / 2, -atan2(yE - y0, zE - z0), 0, 0, 1.4, 0.5, cl), 0xffc533)
	for k in range(1, 4):
		var zz := lerpf(z0, zE, k / 4.0)
		var yy := lerpf(y0, yE, k / 4.0)
		var gw := sin(pg.rotation.y)
		var gc := cos(pg.rotation.y)
		var gy := Terrain.height(plant.x + gw * zz, plant.z + gc * zz) - py
		if yy - gy > 0.6:
			kt.put("soft", G.cyl, mx(0, (yy + gy) / 2, zz, 0, 0, 0, 0.18, yy - gy, 0.18), 0x8a8fa0)
	kt.bake(pg, M)
	_vgroup(1, pg, 0.6, 7)
	_vrover(1, [[ice.x - 0.6 * R * 0.2, ice.z - 0.8 * R * 0.2], [xE, zW]], 2, 2.4)
	# two small nuclear power units, far from the homes, behind a wall of soil
	var rg := Node3D.new()
	var kr := Kit.new()
	var react: Dictionary = Z.react
	rg.position = Vector3(react.x, _gmin(react.x, react.z, 9), react.z)
	rg.rotation.y = atan2(CX - react.x, CZ - react.z)
	for x in [-5.0, 5.0]:
		kr.put("soft", G.cyl, mx(x, 0.6, -2, 0, 0, 0, 1.2, 1.2, 1.2), 0x3a3e4c)
		kr.put("metal", G.cyl, mx(x, 1.9, -2, 0, 0, 0, 0.7, 1.5, 0.7), 0xb8bcc8)
		kr.put("soft", G.cyl, mx(x, 4.2, -2, 0, 0, 0, 0.14, 3.2, 0.14), 0xdfe2ea)
		kr.put("metal", _shape("radiator", func(): return _cyl_geo(3.2, 0.5, 3.6, 14, true)), mx(x, 7.4, -2), 0x9aa0ad)
		kr.put("amber", G.ball, mx(x, 2.85, -2, 0, 0, 0, 0.22))
	for k in 9:
		kr.put("rough", G.lump, mx((k - 4) * 3.1, 0.2, 5 + absi(k - 4) * -0.35, 0, k * 0.4, 0, 2.4, 1.9 + (k % 2) * 0.3, 1.8), M.soil if k % 2 else M.soil2)
	kr.bake(rg, M)
	_vgroup(1, rg, 1.2, 6)
	# power: tall solar towers on the sunny hilltop (Moon) or a field of tilted panels (Mars)
	var pan := []
	var mast := []
	if moon:
		var sy := atan2(World.sun_dir.x, World.sun_dir.z)
		var offs := [[0.0, 0.0], [8.0, -8.0], [-7.0, 9.0]]
		var hill: Vector2 = Terrain.L.hill
		for n in 3:
			var x: float = hill.x + offs[n][0]
			var z: float = hill.y + offs[n][1]
			var g0 := Terrain.height(x, z)
			mast.append(_item(x, g0 + 12, z, 0, 0.35, 24, 0.35, 0.8 + n * 0.3))
			pan.append(_item(x, g0 + 24, z, sy, 6, 9, 0.18, 0.8 + n * 0.3, -0.15))
	else:
		for i in 4:
			for k in 6:
				var px := -55.5 + k * 3.8
				var pz := -26.0 + i * 4.2
				var gy := Terrain.height(px, pz)
				mast.append(_item(px, gy + 0.7, pz, 0, 0.08, 1.4, 0.08, 0.8 + (i * 6 + k) * 0.04))
				pan.append(_item(px, gy + 1.5, pz, 0, 3, 1.8, 0.07, 0.8 + (i * 6 + k) * 0.04, -0.9))
	_vinst(1, G.cyl, M.white, mast)
	_vinst(1, G.box, M.solar, pan)
	_vrover(1, _pts(Z.roads.a), 10, 4.5)
	_vrover(1, _pts(Z.roads.b), 3, 3.5)
	_walkers(1, 10, 11)
	_crowd_at(1, wx(0, 4), wz(0, 4), 5, 4, 21)


# ---------- 30 years later: a town with domes, towers and a spaceport ----------
func _domes(era: int, list: Array, d0: float) -> void:
	var moon := site == "moon"
	var main := []
	var band := []
	var top := []
	var disc := []
	var trees := []
	var ring := []
	var house := []
	var hw := []
	var arches := []
	var r := Rng32.new(era * 31)
	for n in list.size():
		var q: Array = list[n]
		var x: float = q[0]
		var z: float = q[1]
		var R: float = q[2]
		var y := _gmin(x, z, R * 0.8) - 0.4
		var d := d0 + n * 0.35
		if moon:
			main.append(_item(x, y, z, n, R, R * 0.62, R, d))
			band.append(_item(x, y + R * 0.1, z, 0, R * 0.985, R * 0.985, R * 0.985, d, PI / 2))
			top.append(_item(x, y + R * 0.6, z, 0, R * 0.24, R * 0.05, R * 0.24, d))
		else:
			main.append(_item(x, y, z, 0, R, R * 0.8, R, d))
			ring.append(_item(x, y + 0.1, z, 0, R, R, R, d, PI / 2))
			arches.append(_item(x, y, z, 0, R, R * 0.8, R, d))
			arches.append(_item(x, y, z, PI / 2, R, R * 0.8, R, d))
			disc.append(_item(x, y + 0.2, z, 0, R * 0.97, 0.5, R * 0.97, d))
			for k in 7:
				var a := r.next() * TAU
				var rr := R * (0.25 + r.next() * 0.5)
				var th := 2 + r.next() * 2.2
				trees.append(_item(x + cos(a) * rr, y + 0.4 + th / 2, z + sin(a) * rr, 0, th * 0.32, th, th * 0.32, d + 0.3))
			house.append(_item(x - R * 0.2, y + 1.6, z + R * 0.15, n, 3.2, 2.8, 3.2, d + 0.2))
			hw.append(_item(x - R * 0.2, y + 1.9, z + R * 0.15, n, 1.72, 0.3, 1.72, d + 0.2))
	if moon:
		_vinst(era, VG.lump, VM.regolith, main)
		_vinst(era, VG.band, M.win, band, false)
		_vinst(era, G.ball, M.win, top, false)
	else:
		_vinst(era, G.cyl, VM.park, disc)
		_vinst(era, G.cone, VM.tree, trees)
		_vinst(era, G.box, M.white, house)
		_vinst(era, G.box, M.win, hw, false)
		_vinst(era, G.ring, M.white, ring)
		_vinst(era, G.arch, M.white, arches)
		_vinst(era, G.dome, VM.glass, main)


func _towers(era: int, list: Array, d0: float) -> void:
	var body := []
	var roof := []
	var tip := []
	var base := []
	var mast := []
	var band := []
	for n in list.size():
		var q: Array = list[n]
		var y := _gmin(q[0], q[1], q[2]) - 0.3
		var d := d0 + n * 0.3
		body.append(_item(q[0], y, q[1], n * 0.7, q[2], q[3], q[2], d))
		base.append(_item(q[0], y + 1.4, q[1], 0, q[2] * 1.7, 2.8, q[2] * 1.7, d))
		roof.append(_item(q[0], y + q[3], q[1], 0, q[2], q[2] * 0.6, q[2], d))
		mast.append(_item(q[0], y + q[3] + q[2] * 0.6 + 1.2, q[1], 0, 0.1, 2.6, 0.1, d))
		tip.append(_item(q[0], y + q[3] + q[2] * 0.6 + 2.6, q[1], 0, 0.3, 0.3, 0.3, d))
		for k in range(1, 3):
			band.append(_item(q[0], y + q[3] * k / 3.0, q[1], 0, q[2] * 1.03, q[2] * 1.03, q[2] * 2.2, d, PI / 2))
	_vinst(era, VG.tower, VM.tower, body)
	_vinst(era, G.cyl, M.white, base)
	_vinst(era, G.dome, M.white, roof)
	_vinst(era, G.cyl, M.white, mast)
	_vinst(era, G.ring, VM.roadGlow, band, false)
	_vinst(era, G.ball, M.blink, tip, false)


func _pads(era: int, list: Array, d0: float) -> void:
	var disc := []
	var ring := []
	for n in list.size():
		var p: Dictionary = list[n]
		p.y = _gmin(p.x, p.z, 8)
		disc.append(_item(p.x, p.y + 0.1, p.z, 0, 8.5, 0.8, 8.5, d0 + n * 0.3))
		ring.append(_item(p.x, p.y + 0.55, p.z, 0, 7, 7, 3, d0 + n * 0.3, PI / 2))
	_vinst(era, G.cyl, VM.pad, disc)
	_vinst(era, G.ring, M.ring, ring, false)


func _era2(Z: Dictionary) -> void:
	_road(2, Z.roads.d, 0)
	_road(2, Z.roads.f, 0.4)
	_domes(2, Z.domes2, 0.3)
	_towers(2, Z.towers2, 0.6)
	_pads(2, Z.pads2, 0.4)
	var port: Dictionary = Z.port
	var tg := Node3D.new()
	var kt := Kit.new()
	var ty := _gmin(port.x, port.z - 14, 8)
	tg.position = Vector3(port.x, ty, port.z - 14)
	kt.put("soft", G.box, mx(0, 2.6, 0, 0, 0, 0, 18, 5.2, 8), 0xf4f5f9)
	kt.put("soft", G.box, mx(0, 5.35, 0, 0, 0, 0, 18.6, 0.3, 8.6), 0x3d7dff)
	kt.put("cyan", G.box, mx(0, 3.0, 4.03, 0, 0, 0, 16, 1.2, 0.1))
	kt.put("soft", G.cyl, mx(7, 7.5, 0, 0, 0, 0, 1.3, 15, 1.3), 0xf4f5f9)
	kt.put("soft", G.cyl, mx(7, 15.6, 0, 0, 0, 0, 2.6, 2.2, 2.6), 0xdfe2ea)
	kt.put("cyan", G.cyl, mx(7, 15.6, 0, 0, 0, 0, 2.64, 0.9, 2.64))
	kt.put("blink", G.ball, mx(7, 17.2, 0, 0, 0, 0, 0.3))
	kt.bake(tg, M)
	_vgroup(2, tg, 0.9, 6)
	_vship(2, Z.pads2[0], 0, 16)
	_vship(2, Z.pads2[2], 9, 16)
	_vship(2, Z.pads2[1], 0, 1, true)
	_vrover(2, _pts(Z.roads.d), 20, 5)
	_vrover(2, _pts(Z.roads.f), 6, 4.2)
	_vrover(2, _pts(Z.roads.c), 12, 3.8)
	_walkers(2, 16, 12)
	_crowd_at(2, Z.farm.x + 9, Z.farm.z + 18, 7, 4, 31)
	_crowd_at(2, port.x, port.z - 4, 6, 4, 41)


# ---------- 100 years later: a city ----------
func _era3(Z: Dictionary) -> void:
	var moon := site == "moon"
	var c: Dictionary = Z.city
	var R: float = Z.cityR
	var y := _gmin(c.x, c.z, R * 0.7) - 0.6
	var r := Rng32.new(77)
	var g := Node3D.new()
	var k := Kit.new()
	g.position = Vector3(c.x, y, c.z)
	if moon:
		k.put("rough", VG.lump, mx(0, 0, 0, 0, 0.5, 0, R, R * 0.58, R), M.soil)
		for h in [0.08, 0.3]:
			var hr := sqrt(1 - h * h / 0.3364) * R * 0.99
			k.put("win", VG.band, mx(0, R * h, 0, PI / 2, 0, 0, hr, hr, hr * 1.6))
		k.put("win", G.ball, mx(0, R * 0.565, 0, 0, 0, 0, R * 0.32, R * 0.04, R * 0.32))
		k.put("cyan", VG.band, mx(0, R * 0.55, 0, PI / 2, 0, 0, R * 0.36, R * 0.36, R * 0.6))
		for i in 3:
			var a := i * 2.094 + 0.4
			k.put("soft", G.cyl, mx(sin(a) * (R + 1.5), 1.6, cos(a) * (R + 1.5), PI / 2, a, 0, 1.8, 6, 1.8), 0xc3c7d2)
			k.put("green", G.box, mx(sin(a) * (R + 4.5), 3.2, cos(a) * (R + 4.5), 0, a, 0, 2, 0.25, 0.3))
	else:
		k.put("soft", G.cyl, mx(0, 0.2, 0, 0, 0, 0, R * 0.98, 0.6, R * 0.98), 0x5fbf5a)
		k.put("soft", G.ring, mx(0, 0.2, 0, PI / 2, 0, 0, R), 0xf4f5f9)
		k.put("lake", G.cyl, mx(R * 0.3, 0.55, -R * 0.25, 0, 0.5, 0, R * 0.26, 0.1, R * 0.16))
		k.put("soft", G.box, mx(0, 0.55, 0, 0, 0.6, 0, R * 1.8, 0.08, 1.8), 0xe6ddc8)
		k.put("soft", G.box, mx(0, 0.56, 0, 0, 2.17, 0, R * 1.8, 0.08, 1.8), 0xe6ddc8)
		for i in 46:
			var ta := r.next() * TAU
			var tr := R * (0.2 + r.next() * 0.72)
			var th := 2.5 + r.next() * 3.5
			var tx := cos(ta) * tr
			var tz := sin(ta) * tr
			if Vector2(tx - R * 0.3, tz + R * 0.25).length() < R * 0.3:
				continue
			k.put("tree", G.cone, mx(tx, 0.5 + th / 2, tz, 0, 0, 0, th * 0.34, th, th * 0.34))
		k.put("glass", G.dome, mx(0, 0, 0, 0, 0, 0, R, R * 0.78, R))
		for i in 3:
			k.put("soft", G.arch, mx(0, 0, 0, 0, i * PI / 3, 0, R, R * 0.78, R), 0xf4f5f9)
		k.put("soft", G.ring, mx(0, R * 0.39, 0, PI / 2, 0, 0, R * 0.866, R * 0.866, R * 0.6), 0xf4f5f9)
	var mats := { "rough": M.rough, "win": M.win, "cyan": M.cyan, "soft": M.soft, "green": M.green, "lake": VM.lake, "tree": VM.tree, "glass": VM.glass }
	k.bake(g, mats)
	_vgroup(3, g, 0.2, 14)
	var tw := []
	for i in 8:
		var aa := i / 8.0 * TAU + 0.3
		var rr := R + 9 + (i % 3) * 4
		tw.append([c.x + sin(aa) * rr, c.z + cos(aa) * rr, 3 + (i % 3) * 0.8, 18 + ((i * 7) % 5) * 3.5])
	if not moon:
		tw.append([c.x - R * 0.35, c.z + R * 0.2, 3.2, 22.0])
	_towers(3, tw, 0.6)
	_domes(3, Z.domes3, 0.9)
	_pads(3, Z.pads3, 0.5)
	_vship(3, Z.pads3[0], 5, 15)
	_vship(3, Z.pads3[1], 0, 1, true)
	var rf := _pts(Z.roads.f)
	rf.reverse()
	_vrover(3, rf, 4, 4.6)
	var rd := _pts(Z.roads.d)
	rd.reverse()
	_vrover(3, rd, 30, 5.2)
	_walkers(3, 12, 13)
	_crowd_at(3, c.x, c.z, R + 6 if moon else R * 0.7, 10, 51)


# ---------- running it ----------
func _step_vision(dt: float) -> void:
	var v = vis
	if v == null or v.over:
		return
	v.t += dt
	var t: float = v.t
	var ev: Array = v.ev
	while v.ei < ev.size() and t >= float(ev[v.ei][0]):
		var e: Array = ev[v.ei]
		v.ei += 1
		_fire(e)
	var moon := site == "moon"
	World.env.t = lerpf(0.34, 0.62, t / VT.end) if moon else lerpf(0.6, 0.93, _ease(t / VT.end))
	World.env.dust = 0.0
	World.env.storm = 0.0
	_grow(t)
	_move_rovers(dt, t)
	for sh in v.ships:
		_step_ship(sh, t, dt)
	var n := 0
	var list: Array = v.people
	for i in list.size():
		var p: Dictionary = list[i]
		if t < float(v.eraT[p.era]):
			break
		if p.delay > 1e8:
			p.delay = v.eraT[p.era] + p.d - t
		_step_person(v.crowd, i, p, dt, null, moon)
		n += 1
	_flush_crowd(v.crowd, n)
	_camera(t)
	if t >= VT.end:
		_end_vision()


func _grow(t: float) -> void:
	var v: Dictionary = vis
	for r in v.insts:
		var t0: float = v.eraT[r.era]
		if r.done or t < t0:
			continue
		var all := true
		var items: Array = r.items
		var mm: MultiMesh = (r.im as MultiMeshInstance3D).multimesh
		for j in items.size():
			var it: Dictionary = items[j]
			var u := _seg(t, t0 + it.d, t0 + it.d + 1.1)
			var f := maxf(0.001, _pop(u))
			if u < 1:
				all = false
			if u > 0 and not it.puffed and it.sx > 5:
				it.puffed = true
				_puff_at(it.x, it.z, 6, minf(it.sx, 10))
			mm.set_instance_transform(j, mx(it.x, it.y, it.z, it.rx, it.ry, it.rz, it.sx * f, it.sy * f, it.sz * f))
		mm.visible_instance_count = items.size()
		if all:
			r.done = true
	for gr in v.groups:
		var s0: float = v.eraT[gr.era] + gr.d
		if gr.done or t < s0:
			continue
		var w := _seg(t, s0, s0 + 1.3)
		var g: Node3D = gr.g
		if not g.visible and gr.puff:
			_puff_at(g.position.x, g.position.z, 10, gr.puff)
		g.visible = true
		g.scale = Vector3.ONE * maxf(0.001, _pop(w))
		if w >= 1:
			gr.done = true


func _move_rovers(dt: float, t: float) -> void:
	var v: Dictionary = vis
	var n := 0
	var im: MultiMesh = (v.roverMesh as MultiMeshInstance3D).multimesh
	var lm: MultiMesh = (v.roverLights as MultiMeshInstance3D).multimesh
	for r in v.rovers:
		if t < float(v.eraT[r.era]) + 1.5:
			continue
		r.appear = minf(1, r.appear + dt * 1.5)
		if r.wait > 0:
			r.wait -= dt
		else:
			r.s += r.dir * r.speed * dt
			if r.s >= r.r.total or r.s <= 0:
				r.s = clampf(r.s, 0, r.r.total)
				r.dir = -r.dir
				r.wait = 1.5
		_along(r.r, r.s, r.at)
		var side := 1.0 if r.dir > 0 else -1.0
		var yaw: float = r.at.yaw + (PI if r.dir < 0 else 0.0)
		var x: float = r.at.x + cos(r.at.yaw) * side
		var z: float = r.at.z - sin(r.at.yaw) * side
		var sc := maxf(0.001, _pop(r.appear))
		var m := Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3(sc, sc, sc)), Vector3(x, Terrain.height(x, z) + 0.05, z))
		im.set_instance_transform(n, m)
		lm.set_instance_transform(n, m)
		n += 1
	im.visible_instance_count = n
	lm.visible_instance_count = n


func _step_ship(sh: Dictionary, t: float, dt: float) -> void:
	var t0: float = vis.eraT[sh.era] + 0.8
	var g: Node3D = sh.g
	if t < t0:
		g.visible = false
		return
	var alt := 0.0
	var burn := false
	if not sh.park:
		var c: float = fmod(t - t0 + sh.off, sh.per) / sh.per
		if c < 0.42:
			alt = 170 * pow(1 - c / 0.42, 2.2)
			burn = true
		elif c > 0.66:
			alt = 190 * pow((c - 0.66) / 0.34, 2.2)
			burn = true
	elif not sh.shown:
		sh.shown = true
		_puff_at(sh.x, sh.z, 12, 6)
	g.visible = alt < 165
	g.position = Vector3(sh.x, sh.y + alt, sh.z)
	var f: MeshInstance3D = sh.f
	var core: MeshInstance3D = sh.core
	f.visible = burn and g.visible
	core.visible = f.visible
	if burn:
		var fl := 0.8 + randf() * 0.45
		f.scale = Vector3(0.95, 4.8 * fl, 0.95)
		f.position.y = 0.6 - 2.4 * fl
		core.scale = Vector3(0.5, 2.6 * fl, 0.5)
		core.position.y = 0.6 - 1.3 * fl
		if alt < 30 and dt > 0:
			var col := 0xd9a070 if site == "mars" else 0xb8b9c4
			for i in World.rate((1 - alt / 30) * 5, dt):
				var a := randf() * TAU
				var sp := 10 + randf() * 16
				World.emit(sh.x + cos(a) * 3, sh.y + 0.6, sh.z + sin(a) * 3, { "vx": cos(a) * sp, "vy": 0.4 + randf() * 1.5, "vz": sin(a) * sp, "life": 1.6,
					"size": 2.0, "grow": 3.5, "color": col, "alpha": 0.38, "grav": 0.0 })


# the camera: slow aerial moves, one per era
func _air(x: float, z: float, h: float) -> Vector3:
	return Vector3(x, Terrain.height(x, z) + h, z)


func _camera(t: float) -> void:
	var Z: Dictionary = vis.Z
	var C: Dictionary = Z.C
	var moon := site == "moon"
	var pos: Vector3
	var look: Vector3
	var fov := 50.0
	var u: float
	if t < VT.e1:
		u = _ease(t / VT.e1)
		pos = _air(-30, 36, 9).lerp(_air(-10, 8, 26), u)
		look = _air(C.x, C.z, 3).lerp(_air(C.x + 4, C.z - 6, 6), u)
	elif t < VT.e2:
		u = _ease((t - VT.e1) / (VT.e2 - VT.e1))
		var a := lerpf(-0.95, 0.35, u)
		var rad := lerpf(84, 92, u)
		pos = _air(C.x + sin(a) * rad, C.z + cos(a) * rad, lerpf(34, 44, u))
		look = _air(C.x + 6, C.z - 18, 0)
	elif t < VT.e3:
		u = _ease((t - VT.e2) / (VT.e3 - VT.e2))
		pos = _air(-70, 66, 72).lerp(_air(Z.port.x - 80, Z.port.z + 70, 40), u)
		look = _air(30, -40, 0).lerp(_air(Z.port.x, Z.port.z, 12), _ease(_seg(t, VT.e2 + 2, VT.e3 - 1)))
		fov = lerpf(52, 46, u)
	else:
		u = _ease((t - VT.e3) / (VT.end - VT.e3))
		var city: Dictionary = Z.city
		if moon:
			pos = _air(75, 40, 52).lerp(_air(48, 8, 38), u)
			look = _air(city.x + 30, city.z + 10, 0).lerp(Vector3(city.x - 40, Terrain.height(city.x, city.z) + 16, city.z - 80), _ease(_seg(t, VT.e3 + 2, VT.end - 3)))
		else:
			pos = _air(90, 55, 58).lerp(_air(34, -38, 42), u)
			look = _air(city.x + 34, city.z + 14, 0).lerp(_air(city.x - 28, city.z - 40, 12), _ease(_seg(t, VT.e3, VT.end - 4)))
		fov = lerpf(50, 56, u)
	World.cam.mode = "cine"
	var cine: Dictionary = World.cam.cine
	cine.pos = pos
	cine.look = look
	cine.fov = fov
	cine.roll = sin(t * 0.21) * 0.012


# ---------- the captions ----------
func _words(s) -> Array:
	var moon := site == "moon"
	var name: String = TOWN[site]
	var dw := "Day" if moon else "Sol"
	var days := 0
	if s is Dictionary:
		var sd = s.get("site")
		if sd is Dictionary and sd.get("dayWord"):
			dw = str(sd.dayWord)
		days = int(s.get("totalSols", 0))
	dw = dw.to_lower() + "s"
	var world := "the Moon" if moon else "Mars"
	return [
		{ "tag": "Imagine…", "era": "What could your outpost become?",
			"text": ("You kept your outpost on %s going for %d %s. " % [world, days, dw] if days else "") + "Now picture what might grow here one day." },
		{ "tag": "Imagined future", "era": "10 years later",
			"text": "Machines dig ice in the dark crater and turn it into water, air and rocket fuel. Small nuclear power units, like the Kilopower reactor NASA tested in 2018, keep the lights on when the Sun is hidden." if moon
				else "In 2021, MOXIE, an experiment on NASA's Perseverance rover, made oxygen from the thin Mars air. Here, much bigger machines make air and rocket fuel, and small nuclear power units keep going through dust storms." },
		{ "tag": "Imagined future", "era": "30 years later",
			"text": "NASA's Artemis plans start with a base camp near the Moon's south pole. Here it has grown into a town, with homes buried under soil to block radiation and a busy spaceport." if moon
				else "Ships from Earth arrive about every 26 months, when the two planets line up for the shortest trip. The town now has glass greenhouses, workshops and a busy spaceport." },
		{ "tag": "Imagined future", "era": "100 years later",
			"text": "A city on the Moon! Families live under huge shielded domes, and Earth hangs above the hills like a blue marble." if moon
				else "A city on Mars! Under huge domes of thick, shielding glass, people grow forests and food. Children born here are real Martians." },
		{ "tag": "Imagined future", "era": name,
			"text": "Nobody knows exactly what will be built. But every big city starts small, with a few brave explorers. Just like you." },
	]


func _caption(i: int) -> void:
	var o: Dictionary = vis.ov
	var words: Array = vis.words
	if i >= words.size():
		o.cap_on = false
		return
	var w: Dictionary = words[i]
	(o.tag_l as Label).text = str(w.tag).to_upper()
	(o.era as Label).text = w.era
	(o.text as Label).text = w.text
	o.cap_on = true
	var now := mini(i, 3)
	var pills: Array = o.pills
	for k in pills.size():
		_pill_style(pills[k], "now" if k == now else ("past" if k < i else ""))
	if i > 0:
		Au.play("swish")
	Au.speak(str(w.era) + ". " + str(w.text))


func _events() -> Array:
	return [[0.25, "open"], [1.0, "cap", 0], [7.4, "off"],
		[VT.e1 - 0.7, "dark"], [VT.e1 + 0.05, "light", true], [VT.e1 + 0.7, "cap", 1], [VT.e2 - 1.1, "off"],
		[VT.e2 - 0.7, "dark"], [VT.e2 + 0.05, "light", false], [VT.e2 + 0.7, "cap", 2], [VT.e3 - 1.1, "off"],
		[VT.e3 - 0.7, "dark"], [VT.e3 + 0.05, "light", true], [VT.e3 + 0.7, "cap", 3], [VT.fin - 0.6, "off"],
		[VT.fin, "end"], [VT.fin + 0.4, "cap", 4], [VT.end - 1.6, "off"],
		[VT.end - 0.8, "dark"]]


func _fire(e: Array) -> void:
	var o: Dictionary = vis.ov
	match e[1]:
		"open":
			o.lit = true
			o.bars_on = true
			Au.play("pad")
		"cap":
			_caption(e[2])
		"off":
			o.cap_on = false
		"dark":
			o.lit = false
		"light":
			o.lit = true
			if e[2]:
				Au.play("pad")
		"end":
			o.end = true


func _pill_style(pc: PanelContainer, kind: String) -> void:
	var l: Label = pc.get_child(0)
	var sb: StyleBoxFlat
	if kind == "now":
		sb = Style.shadowed(Style.box(Color("#ffd23f"), 12, Color(0, 0, 0, 0), 0, Vector4(11, 4, 11, 4)), Color(1, 0.82, 0.25, 0.55), 9, Vector2.ZERO)
		l.add_theme_color_override("font_color", Color("#2a1c00"))
	else:
		sb = Style.box(Color(10 / 255.0, 14 / 255.0, 32 / 255.0, 0.55), 12, Color(1, 1, 1, 0.14), 1, Vector4(11, 4, 11, 4))
		l.add_theme_color_override("font_color", Color(1, 1, 1, 0.85 if kind == "past" else 0.55))
	pc.add_theme_stylebox_override("panel", sb)


## the letterbox, the era steps, the captions and the skip button
func _overlay() -> Dictionary:
	var layer := CanvasLayer.new()
	layer.layer = 25
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = Style.theme()
	layer.add_child(root)
	var fade := ColorRect.new()
	fade.color = Color("#04060e")
	fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(fade)
	var bars := []
	for i in 2:
		var b := ColorRect.new()
		b.color = Color.BLACK
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(b)
		bars.append(b)
	var steps := HBoxContainer.new()
	steps.add_theme_constant_override("separation", 6)
	steps.mouse_filter = Control.MOUSE_FILTER_IGNORE
	steps.modulate.a = 0.0
	root.add_child(steps)
	var pills := []
	for s in ["Today", "+10 years", "+30 years", "+100 years"]:
		var pc := PanelContainer.new()
		pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var l := Label.new()
		l.text = s
		l.add_theme_font_override("font", Style.font(600))
		l.add_theme_font_size_override("font_size", 13)
		pc.add_child(l)
		steps.add_child(pc)
		_pill_style(pc, "")
		pills.append(pc)
	var cap := VBoxContainer.new()
	cap.add_theme_constant_override("separation", 6)
	cap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cap.modulate.a = 0.0
	root.add_child(cap)
	var tag := PanelContainer.new()
	tag.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tag.add_theme_stylebox_override("panel", Style.box(Color("#ffd23f"), 11, Color(0, 0, 0, 0), 0, Vector4(11, 3, 11, 3)))
	var tag_l := Label.new()
	var mono := FontVariation.new()
	mono.base_font = Paint.font(700, "mono")
	mono.spacing_glyph = 2
	tag_l.add_theme_font_override("font", mono)
	tag_l.add_theme_font_size_override("font_size", 11)
	tag_l.add_theme_color_override("font_color", Color("#2a1c00"))
	tag.add_child(tag_l)
	cap.add_child(tag)
	var era := Label.new()
	era.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	era.add_theme_font_override("font", Style.font(700))
	era.add_theme_font_size_override("font_size", 52)
	era.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.45))
	era.add_theme_constant_override("shadow_offset_y", 4)
	era.add_theme_constant_override("shadow_offset_x", 0)
	era.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.3))
	era.add_theme_constant_override("outline_size", 10)
	cap.add_child(era)
	var text := Label.new()
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.add_theme_font_override("font", Style.font(500))
	text.add_theme_font_size_override("font_size", 21)
	text.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	text.add_theme_constant_override("outline_size", 7)
	text.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	text.add_theme_constant_override("shadow_offset_y", 2)
	cap.add_child(text)
	var skip := Button.new()
	skip.text = "Skip ▶▶"
	skip.theme_type_variation = "BtnGhost"
	skip.add_theme_font_size_override("font_size", 15)
	skip.focus_mode = Control.FOCUS_NONE
	skip.pressed.connect(skip_vision)
	root.add_child(skip)
	return { "layer": layer, "fade": fade, "bars": bars, "steps": steps, "pills": pills, "cap": cap, "tag_l": tag_l, "era": era, "text": text, "skip": skip,
		"lit": false, "bars_on": false, "end": false, "cap_on": false, "fade_a": 1.0, "bars_k": 0.0, "steps_a": 0.0, "cap_k": 0.0 }


func _anim_overlay(dt: float) -> void:
	var o: Dictionary = vis.ov
	if not is_instance_valid(o.layer):
		return
	var vs := get_viewport().get_visible_rect().size
	o.fade_a = move_toward(o.fade_a, 0.0 if o.lit else 1.0, dt / 0.6)
	o.bars_k = move_toward(o.bars_k, 1.0 if o.bars_on else 0.0, dt / 1.4)
	o.steps_a = move_toward(o.steps_a, 1.0 if o.bars_on and not o.end else 0.0, dt / 0.8)
	o.cap_k = move_toward(o.cap_k, 1.0 if o.cap_on else 0.0, dt / 0.7)
	(o.fade as ColorRect).color.a = _ease(o.fade_a)
	var bh := vs.y * 0.09 * _ease(o.bars_k)
	var bars: Array = o.bars
	(bars[0] as ColorRect).position = Vector2.ZERO
	(bars[0] as ColorRect).size = Vector2(vs.x, bh)
	(bars[1] as ColorRect).position = Vector2(0, vs.y - bh)
	(bars[1] as ColorRect).size = Vector2(vs.x, bh)
	var steps: Control = o.steps
	steps.modulate.a = o.steps_a
	steps.position = Vector2((vs.x - steps.size.x) / 2, vs.y * 0.09 + 12)
	var w := minf(640, vs.x * 0.88)
	var cap: Control = o.cap
	(o.text as Label).custom_minimum_size.x = w
	cap.size = Vector2(w, 0)
	cap.position = Vector2((vs.x - w) / 2, vs.y - vs.y * 0.09 - 26 - cap.size.y + (1 - _ease(o.cap_k)) * 12)
	cap.modulate.a = _ease(o.cap_k)
	var skip: Button = o.skip
	skip.position = vs - skip.size - Vector2(18, 18)
	skip.modulate.a = 1.0 if skip.is_hovered() else 0.8


func _start_vision(s, done: Callable) -> void:
	vis = { "t": 0.0, "done": done, "prev": stage_now, "insts": [], "groups": [], "roads": [], "rovers": [], "ships": [], "people": [], "ei": 0,
		"last": Time.get_ticks_msec(), "env": { "t": World.env.t, "dust": World.env.dust, "storm": World.env.storm },
		"eraT": { 0: 0.0, 1: VT.e1 + 0.2, 2: VT.e2 + 0.2, 3: VT.e3 + 0.2 }, "over": false, "skipping": false }
	set_stage(LAST)                          # the film starts from the full city, so the future is bigger than anything built in the game
	var root := Node3D.new()
	root.name = "ColonyVision"
	World.root.add_child(root)
	vis.root = root
	_vision_stuff()
	var Z := _layout()
	vis.Z = Z
	_era1(Z)
	_era2(Z)
	_era3(Z)
	var nr := maxi(1, (vis.rovers as Array).size())
	vis.roverMesh = _mm(VG.rover, M.soft, nr, true)
	vis.roverLights = _mm(VG.lights, M.win, nr, false)
	root.add_child(vis.roverMesh)
	root.add_child(vis.roverLights)
	vis.crowd = _make_crowd(root, maxi(1, (vis.people as Array).size()), men.geos)
	vis.words = _words(s)
	vis.ev = _events()
	vis.ov = _overlay()
	Ui.fade(false)
	World.cam.shake = 0.0
	_camera(0)


func _end_vision() -> void:
	var v = vis
	if v == null or v.over:
		return
	v.over = true
	if is_instance_valid(v.root):
		(v.root as Node).queue_free()
	if v.has("ov") and is_instance_valid(v.ov.layer):
		(v.ov.layer as Node).queue_free()
	World.env.t = v.env.t
	World.env.dust = v.env.dust
	World.env.storm = v.env.storm
	World.cam.cine.roll = 0.0
	World.cam.cine.fov = 52.0
	World.cam.shake = 0.0
	World.cam.mode = "play"
	vis = null
	set_stage(v.prev)
	var done: Callable = v.done
	if done.is_valid():
		done.call()


func vision(s = null, done: Callable = Callable()) -> bool:
	if grp == null or not is_instance_valid(grp) or vis != null or not World.ready_ok or World.root == null or men == null:
		return false
	_start_vision(s, done)
	return true


func skip_vision() -> void:
	if vis == null or vis.skipping or vis.over:
		return
	vis.skipping = true
	vis.ov.lit = false
	var me: Dictionary = vis
	get_tree().create_timer(0.45).timeout.connect(func():
		if is_same(vis, me):
			_end_vision())


func vision_time() -> float:
	return vis.t if vis else -1.0


func _process(delta: float) -> void:
	if vis == null:
		return
	if not vis.over and Time.get_ticks_msec() - int(vis.last) > 600:      # keeps the film going if nobody calls update()
		_step_vision(minf(delta, 0.05))
	if vis:
		_anim_overlay(delta)


func _input(event: InputEvent) -> void:
	if vis == null or vis.over:
		return
	var skip := false
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ESCAPE:
		skip = true
	elif event is InputEventJoypadButton and event.pressed and event.button_index in [JOY_BUTTON_B, JOY_BUTTON_START, JOY_BUTTON_BACK]:
		skip = true
	if skip:
		get_viewport().set_input_as_handled()
		skip_vision()
