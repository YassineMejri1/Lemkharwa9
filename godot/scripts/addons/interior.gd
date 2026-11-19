extends Node
## Inside the habitat and inside the rocket. Walk through the airlock and you are really inside: bunks, a galley
## table, plants under pink grow lights, the Mission Control desk, an exercise bike, spare spacesuits, a water
## tank, and windows and a skylight that look out at the real sky. The rocket has a crew cabin with two launch
## couches, a glass cockpit with live screens under its window, life support, stowage bags and a ladder up to the
## docking hatch. Each thing you walk up to tells a real fact about living in space.
## The game decides when you go in or out; this builds the rooms and tells the game where the floor, walls, ceiling
## and furniture are. The rooms sit inside the real buildings, so the windows show the real outpost outside.
## Godot adjustments: the painted wall, floor and deck textures are small shaders (seams, rivets, tiles and the
## window holes are worked out per pixel), the live screens are SubViewports drawn with Paint, the labels are
## Label3D, and the rounded and sculpted parts are built with a small mesh builder. A port of js/interior.js.

const HAB_R := 4.6
const HAB_FLOOR := 1.3                 # inner radius of the dome; floor height above the ground
const RK_R := 2.3
const RK_FLOOR := 9.9
const RK_TOP := 14.6                   # the rocket cabin, in the rocket's own coordinates
const HAB_WINDOWS := [-1.25, -0.55, 0.55, 2.4, 3.6]     # the same angles as the dome's windows

## Real facts, one for each thing you can walk up to.
const FACTS := {
	"bed": "On the Moon and Mars there is gravity, so a bed works. On the Space Station astronauts sleep in sleeping bags tied to the wall, so they do not float around in the night.",
	"plants": "Astronauts on the Space Station have grown lettuce, radishes and even chilli peppers under pink LED lights. Plants only need the red and blue parts of light, so that is all the lamps give them.",
	"bike": "Astronauts exercise about two hours every day. In low gravity muscles and bones get weaker if you do not use them, so exercise is part of the job.",
	"suits": "A spacesuit is like a tiny spaceship you wear. It gives you air, keeps you warm or cool, and protects you from dust and from the Sun's rays.",
	"water": "On the Space Station about 98 out of every 100 drops of water are recycled, even sweat and urine, and cleaned until they are drinking water again. Water is too heavy to ship from Earth every day.",
	"table": "Space food comes in pouches and cans. Astronauts add water to dried food, and they eat tortillas instead of bread because tortillas make no crumbs.",
	"window": "Look up! The skylight and windows show the real sky. On the Moon the sky is black even in daytime, because there is no air to scatter the sunlight.",
	"seat": "Astronauts launch lying on their backs with their knees up, in couches shaped to fit their bodies, so the huge push of the rocket spreads over their whole back.",
	"panel": {
		"moon": "A rocket needs oxygen to burn its fuel. Engineers are studying how to split the ice in the Moon's dark polar craters into hydrogen and oxygen, the same two ingredients that powered the Space Shuttle's main engines.",
		"mars": "A rocket needs oxygen to burn its fuel. NASA's MOXIE experiment on the Perseverance rover showed that oxygen can be made from the carbon dioxide in Mars air, so a future ship home could fill its tanks on Mars.",
	},
	"abort": "NASA's Orion capsule sits under a launch abort tower. If the rocket fails, its powerful little motors pull the crew capsule away from danger in a few seconds.",
	"life": "A spacecraft carries tanks of oxygen and nitrogen and mixes them into air like Earth's: about one part oxygen to four parts nitrogen. A scrubber takes out the carbon dioxide the crew breathes out.",
	"stow": "Rock samples travel home sealed in metal boxes, so Earth's air and water cannot change them before scientists open them. The Apollo crews sealed their sample boxes while still on the Moon.",
	"plush": "Crews often bring a small soft toy. When it starts to float, everyone knows they have reached space! It is called a zero-g indicator.",
	"scrubber": "Every breath out is carbon dioxide. On the Space Station it is pulled out of the air by beds of zeolite that are baked clean and used again. When Apollo 13's scrubbers ran short, the crew built a new one from a sock, a hose and duct tape.",
	"console": "Mission Control on Earth watches every reading you see here, but their advice travels at the speed of light. Out here, the first decision is always yours.",
}

var rooms := {}
var current = null
var site := "moon"
var clock := 0.0
var redraw_at := 0.0
var used := {}
var light: OmniLight3D
var blob: MeshInstance3D
var _built_for: Node = null
var _screens_holder: Node


func fact(id: String) -> String:
	var f = FACTS.get(id)
	if f == null:
		return ""
	return f if f is String else str(f.get(site, ""))


# =====================================================================
#  small helpers
# =====================================================================
static func _c(hex: int) -> Color:
	return Mats.lin(hex)


static func _std(hex: int, rough := 0.65, metal := 0.05) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = _c(hex)
	m.roughness = rough
	m.metallic = metal
	return m


static func _two(m: BaseMaterial3D) -> BaseMaterial3D:
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


## a mesh at a place, turned like three.js (Euler order XYZ)
static func _put(parent: Node3D, mesh: Mesh, m: Material, x := 0.0, y := 0.0, z := 0.0, rx := 0.0, ry := 0.0, rz := 0.0, shadow := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = m
	mi.position = Vector3(x, y, z)
	mi.rotation_order = EULER_ORDER_XYZ
	mi.rotation = Vector3(rx, ry, rz)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


static func _group(parent: Node3D, x := 0.0, y := 0.0, z := 0.0, ry := 0.0) -> Node3D:
	var g := Node3D.new()
	g.position = Vector3(x, y, z)
	g.rotation.y = ry
	parent.add_child(g)
	return g


## many copies of one small part in a single draw call. list: [x, y, z, rx, ry, rz]
static func _inst(parent: Node3D, mesh: Mesh, m: Material, list: Array) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = list.size()
	for i in list.size():
		var p: Array = list[i]
		var r := Vector3(p[3] if p.size() > 3 else 0.0, p[4] if p.size() > 4 else 0.0, p[5] if p.size() > 5 else 0.0)
		mm.set_instance_transform(i, Transform3D(Basis.from_euler(r, EULER_ORDER_XYZ), Vector3(p[0], p[1], p[2])))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


static func _box(w: float, h: float, d: float) -> BoxMesh:
	return Mats.box(w, h, d)


static func _cyl(a: float, b: float, h: float, n := 16) -> CylinderMesh:
	return Mats.cyl(a, b, h, n)


static func _ball(r: float, a := 14, b := 10) -> SphereMesh:
	return Mats.ball(r, a, b)


static func _capsule(r: float, length: float, seg := 10) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = length + 2 * r
	c.radial_segments = seg
	c.rings = 4
	return c


## which way an object at (x, z) must turn to face the middle of the room
static func _face_in(x: float, z: float) -> float:
	return atan2(-x, -z)


## A flat text plate (Label3D) facing +z of its node, h metres tall per line.
static func _label(parent: Node3D, text: String, h: float, color: Color, x := 0.0, y := 0.0, z := 0.0, rx := 0.0, ry := 0.0, rz := 0.0, weight := 700, family := "exo2") -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = Paint.font(weight, family)
	l.font_size = 64
	l.pixel_size = h / 64.0
	l.modulate = color
	l.outline_size = 0
	l.shaded = false
	l.double_sided = false
	l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	l.position = Vector3(x, y, z)
	l.rotation_order = EULER_ORDER_XYZ
	l.rotation = Vector3(rx, ry, rz)
	parent.add_child(l)
	return l


## A coloured plate with a word on it (bag labels, tank labels, placards): a thin quad plus a label just in front.
static func _plate(parent: Node3D, w: float, h: float, bg: int, text: String, fg: Color, x: float, y: float, z: float, rx := 0.0, ry := 0.0, border := false) -> Node3D:
	var g := Node3D.new()
	g.position = Vector3(x, y, z)
	g.rotation_order = EULER_ORDER_XYZ
	g.rotation = Vector3(rx, ry, 0)
	parent.add_child(g)
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	var m := _std(bg, 0.7, 0.0)
	_put(g, q, m)
	if border:
		var e := QuadMesh.new()
		e.size = Vector2(w * 0.94, h * 0.84)
		_put(g, e, _std(0x1e2229, 0.7, 0.0), 0, 0, 0.0005)
		_put(g, _quad(w * 0.9, h * 0.7), m, 0, 0, 0.001)
	_label(g, text, h * 0.5, fg, 0, 0, 0.002)
	return g


static func _quad(w: float, h: float) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	return q


# ---------- a small mesh builder: every triangle is turned so that its front faces along its normals ----------
class MB:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()

	func vert(p: Vector3, nn: Vector3, t := Vector2.ZERO) -> int:
		v.append(p)
		n.append(nn.normalized())
		uv.append(t)
		return v.size() - 1

	func tri(a: int, b: int, c: int) -> void:
		var face := (v[b] - v[a]).cross(v[c] - v[a])
		if face.dot(n[a] + n[b] + n[c]) > 0:       # Godot's front faces wind clockwise
			idx.append_array([a, c, b])
		else:
			idx.append_array([a, b, c])

	func quad(a: int, b: int, c: int, d: int) -> void:
		tri(a, b, c)
		tri(a, c, d)

	func mesh() -> ArrayMesh:
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_NORMAL] = n
		arr[Mesh.ARRAY_TEX_UV] = uv
		arr[Mesh.ARRAY_INDEX] = idx
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		return am


## a flat disc in the XY plane facing +z (three.js CircleGeometry)
static func _disc(r: float, seg := 40) -> ArrayMesh:
	var b := MB.new()
	var c := b.vert(Vector3.ZERO, Vector3.BACK, Vector2(0.5, 0.5))
	var ring := []
	for i in seg:
		var a := float(i) / seg * TAU
		ring.append(b.vert(Vector3(cos(a) * r, sin(a) * r, 0), Vector3.BACK, Vector2(0.5 + cos(a) * 0.5, 0.5 - sin(a) * 0.5)))
	for i in seg:
		b.tri(c, ring[i], ring[(i + 1) % seg])
	return b.mesh()


## a flat ring in the XY plane facing +z; uv.x goes round it, uv.y across it
static func _ring(r0: float, r1: float, seg := 48) -> ArrayMesh:
	var b := MB.new()
	var prev := []
	for i in seg + 1:
		var a := float(i) / seg * TAU
		var d := Vector3(cos(a), sin(a), 0)
		var cur := [b.vert(d * r0, Vector3.BACK, Vector2(float(i) / seg, 0)), b.vert(d * r1, Vector3.BACK, Vector2(float(i) / seg, 1))]
		if i > 0:
			b.quad(prev[0], prev[1], cur[1], cur[0])
		prev = cur
	return b.mesh()


## a torus in the XY plane like three.js TorusGeometry (axis along z), optionally only an arc of it
static func _torus(r: float, tube: float, sides := 8, seg := 32, arc := TAU) -> ArrayMesh:
	var b := MB.new()
	var grid := []
	for j in seg + 1:
		var u := float(j) / seg * arc
		var c := Vector3(cos(u) * r, sin(u) * r, 0)
		var row := []
		for i in sides + 1:
			var a := float(i) / sides * TAU
			var p := Vector3((r + tube * cos(a)) * cos(u), (r + tube * cos(a)) * sin(u), tube * sin(a))
			row.append(b.vert(p, p - c, Vector2(float(j) / seg, float(i) / sides)))
		grid.append(row)
	for j in seg:
		for i in sides:
			b.quad(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1])
	return b.mesh()


## a profile [Vector2(radius, height)] turned round the y axis (three.js LatheGeometry)
static func _lathe(pts: Array, seg := 24) -> ArrayMesh:
	var b := MB.new()
	var grid := []
	for j in seg + 1:
		var a := float(j) / seg * TAU
		var col := []
		for i in pts.size():
			var p: Vector2 = pts[i]
			var t: Vector2 = (pts[mini(i + 1, pts.size() - 1)] as Vector2) - (pts[maxi(i - 1, 0)] as Vector2)
			var n2 := Vector2(t.y, -t.x)                       # outward from the profile
			col.append(b.vert(Vector3(sin(a) * p.x, p.y, cos(a) * p.x), Vector3(sin(a) * n2.x, n2.y, cos(a) * n2.x), Vector2(float(j) / seg, float(i) / maxi(1, pts.size() - 1))))
		grid.append(col)
	for j in seg:
		for i in pts.size() - 1:
			b.quad(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1])
	return b.mesh()


static func _catmull(pts: Array, steps: int) -> Array:
	var out := []
	var n := pts.size()
	for i in n - 1:
		var p0: Vector3 = pts[maxi(i - 1, 0)]
		var p1: Vector3 = pts[i]
		var p2: Vector3 = pts[i + 1]
		var p3: Vector3 = pts[mini(i + 2, n - 1)]
		for k in steps:
			var t := float(k) / steps
			out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
	out.append(pts[n - 1])
	return out


## a pipe or cable through points (a smooth curve, like three.js TubeGeometry on a CatmullRomCurve3)
static func _tube(pts: Array, r: float, steps := 6, sides := 8) -> ArrayMesh:
	var path := _catmull(pts.map(func(p): return p if p is Vector3 else Vector3(p[0], p[1], p[2])), steps)
	var b := MB.new()
	var rings := []
	var nrm := Vector3.UP
	for i in path.size():
		var t: Vector3 = ((path[mini(i + 1, path.size() - 1)] as Vector3) - (path[maxi(i - 1, 0)] as Vector3)).normalized()
		if absf(nrm.dot(t)) > 0.95:
			nrm = Vector3.RIGHT if absf(t.x) < 0.9 else Vector3.FORWARD
		var side := t.cross(nrm).normalized()
		nrm = side.cross(t).normalized()
		var row := []
		for k in sides + 1:
			var a := float(k) / sides * TAU
			var d := nrm * cos(a) + side * sin(a)
			row.append(b.vert(path[i] + d * r, d, Vector2(float(i) / path.size(), float(k) / sides)))
		rings.append(row)
	for i in path.size() - 1:
		for k in sides:
			b.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1])
	return b.mesh()


## the dome wall: a half sphere seen from inside (normals point in); a vertex at angle a sits at (sin a, cos a)
static func _dome(r: float, seg := 64, rings := 24) -> ArrayMesh:
	var b := MB.new()
	var grid := []
	for j in rings + 1:
		var th := float(j) / rings * PI / 2
		var row := []
		for i in seg + 1:
			var a := float(i) / seg * TAU
			var p := Vector3(sin(th) * sin(a), cos(th), sin(th) * cos(a)) * r
			row.append(b.vert(p, -p, Vector2(float(i) / seg, float(j) / rings)))
		grid.append(row)
	for j in rings:
		for i in seg:
			b.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
	return b.mesh()


## an open cylinder seen from inside (the rocket cabin wall)
static func _inner_cyl(r: float, h: float, seg := 64) -> ArrayMesh:
	var b := MB.new()
	var prev := []
	for i in seg + 1:
		var a := float(i) / seg * TAU
		var d := Vector3(sin(a), 0, cos(a))
		var cur := [b.vert(d * r + Vector3(0, -h / 2, 0), -d, Vector2(float(i) / seg, 1)), b.vert(d * r + Vector3(0, h / 2, 0), -d, Vector2(float(i) / seg, 0))]
		if i > 0:
			b.quad(prev[0], cur[0], cur[1], prev[1])
		prev = cur
	return b.mesh()


static func _shader_mat(code: String, params := {}) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = code
	var m := ShaderMaterial.new()
	m.shader = sh
	for k in params:
		m.set_shader_parameter(k, params[k])
	return m


# =====================================================================
#  the habitat
# =====================================================================
## The dome's painted wall: white panels with seams and rivets, a blue stripe, floor vents, five portholes and
## the skylight, worked out from where each pixel sits on the dome (the same layout as the web canvas).
const HAB_WALL := """
shader_type spatial;
render_mode cull_disabled;
uniform float R = 4.6;
uniform float wins[5];
varying vec3 lp;
vec3 sc(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
void vertex() { lp = VERTEX; }
float near_line(float x, float period, float half_w) { float d = abs(x - round(x / period) * period); return step(d, half_w); }
void fragment() {
	float a = atan(lp.x, lp.z);
	float u = fract((a + PI * 0.5) / TAU);
	float v = acos(clamp(lp.y / R, -1.0, 1.0)) / (PI * 0.5);
	float w = 1024.0, h = 512.0;
	vec2 px = vec2(u * w, v * h);
	if (v < 0.08) discard;                                        // the skylight
	vec3 c = mix(sc(vec3(246.0, 248.0, 252.0)), sc(vec3(226.0, 231.0, 240.0)), smoothstep(0.0, 0.75, v));
	c = mix(c, sc(vec3(207.0, 213.0, 226.0)), smoothstep(0.75, 1.0, v));
	vec3 seam = sc(vec3(110.0, 124.0, 156.0));
	float cell = w / 24.0;
	if (v > 0.12 && v < 0.88) c = mix(c, seam, 0.4 * near_line(px.x, cell, 1.5));
	for (int i = 0; i < 3; i++) {
		float hv = i == 0 ? 0.32 : (i == 1 ? 0.52 : 0.74);
		c = mix(c, seam, 0.4 * step(abs(px.y - hv * h), 1.5));
		vec2 rv = vec2(px.x - round(px.x / cell) * cell, px.y - hv * h);
		c = mix(c, seam, 0.5 * step(length(rv), 3.0));          // little rivets where the seams cross
	}
	if (v > 0.875 && v < 0.903) c = sc(vec3(61.0, 125.0, 255.0));
	if (v >= 0.903) {
		c = sc(vec3(192.0, 199.0, 214.0));
		float vx = px.x - (floor(px.x / (w / 12.0)) + 0.5) * (w / 12.0);
		float vy = px.y - h * 0.93;
		if (abs(vx) < 22.0 && vy > 0.0 && vy < 28.0 && mod(vy, 7.0) < 3.0) c = mix(c, sc(vec3(70.0, 80.0, 104.0)), 0.35);
	}
	if (v > 0.075 && v < 0.115) c = sc(vec3(111.0, 120.0, 145.0));   // the skylight's frame
	for (int i = 0; i < 5; i++) {
		float wu = fract((wins[i] + PI * 0.5) / TAU) * w;
		float dx = px.x - wu;
		dx -= round(dx / w) * w;
		vec2 d = vec2(dx, px.y - h * 0.6);
		if (length(d / vec2(48.0, 72.0)) < 1.0) c = sc(vec3(111.0, 120.0, 145.0));
		if (length(d / vec2(40.0, 63.0)) < 1.0) c = sc(vec3(180.0, 188.0, 205.0));
		if (length(d / vec2(34.0, 56.0)) < 1.0) discard;           // the porthole itself: you see the real outside
	}
	ALBEDO = c;
	ROUGHNESS = 0.85;
}
"""

## the floor: hexagon tiles and the yellow ring round the outpost's name
const HAB_FLOOR_SH := """
shader_type spatial;
vec3 sc(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
float hex_d(vec2 p, float r) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x) - r * 0.8660254; }
void fragment() {
	float w = 512.0, c0 = w / 2.0;
	vec2 px = UV * w;
	vec3 c = sc(vec3(57.0, 65.0, 85.0));
	float best = 1e9;
	float j0 = round((px.y - c0) / 38.0);
	for (int dj = -1; dj <= 1; dj++) {
		float j = j0 + float(dj);
		float off = mod(abs(j), 2.0) > 0.5 ? 22.0 : 0.0;
		float k0 = round((px.x - c0 - off) / 44.0);
		for (int dk = -1; dk <= 1; dk++) {
			vec2 ctr = vec2(c0 + (k0 + float(dk)) * 44.0 + off, c0 + j * 38.0);
			vec2 q = (px - ctr).yx;                                // pointy-top hexagons
			best = min(best, abs(hex_d(q, 24.0)));
		}
	}
	c = mix(c, sc(vec3(120.0, 136.0, 172.0)), 0.35 * step(best, 1.0));
	float r = length(px - vec2(c0));
	c = mix(c, sc(vec3(255.0, 210.0, 63.0)), step(abs(r - w * 0.17), 5.0));
	c = mix(c, sc(vec3(255.0, 210.0, 63.0)), 0.45 * step(abs(r - w * 0.2), 2.0));
	ALBEDO = c;
	ROUGHNESS = 0.8;
}
"""


## a mission patch, painted once
func _patch(parent: Node3D, size: float, x: float, y: float, z: float, ry: float) -> Dictionary:
	var sc := Paint.screen(_screens_holder, parent, size, size, 256, 256, false, true)
	var mi: MeshInstance3D = sc.mesh
	mi.position = Vector3(x, y, z)
	mi.rotation.y = ry
	var mars := site == "mars"
	Paint.redraw(sc, func(ci: CanvasItem, w: int, _h: int):
		var c := w / 2.0
		Paint.circle(ci, c, c, c - 6, Color("#1b2350"))
		Paint.circle(ci, c, c, c - 12, Color("#ffd23f"), 12)
		# the planet's curve along the bottom, clipped to the badge
		var pts := PackedVector2Array()
		for i in 33:
			var a := PI * 0.15 + float(i) / 32 * PI * 0.7
			pts.append(Vector2(c + cos(a) * (c - 18), c + sin(a) * (c - 18)))
		ci.draw_colored_polygon(pts, Color("#d9774a") if mars else Color("#b9bac6"))
		Paint.circle(ci, w * 0.72, w * 0.3, 26, Color("#4aa3ff"))
		ci.draw_colored_polygon(PackedVector2Array([Vector2(c, w * 0.18), Vector2(c + 28, w * 0.5), Vector2(c - 28, w * 0.5)]), Color.WHITE)
		Paint.rect(ci, c - 28, w * 0.5, 56, 50, Color("#ff5f6d"))
		Paint.text(ci, "ASTRO OUTPOST", c, w * 0.8, 30, Color("#ffd23f"), "center", 700, "exo2", w * 0.8))
	return sc


## a live screen with a dark bezel behind it
func _screen(parent: Node3D, w: float, h: float, x: float, y: float, z: float, ry := 0.0, cw := 512, ch := 320) -> Dictionary:
	var sc := Paint.screen(_screens_holder, parent, w, h, cw, ch)
	var mi: MeshInstance3D = sc.mesh
	mi.position = Vector3(x, y, z)
	mi.rotation.y = ry
	_put(parent, _box(w + 0.08, h + 0.08, 0.04), _std(0x1b2133, 0.5, 0.3), x - sin(ry) * 0.03, y, z - cos(ry) * 0.03, 0, ry, 0)
	return sc


func _suit(parent: Node3D, x: float, y: float, z: float, color: int) -> Node3D:
	var white := _std(0xf2f3f7)
	var g := _group(parent, x, y, z)
	_put(g, _capsule(0.28, 0.5), white, 0, 0.75, 0)
	_put(g, _ball(0.27), white, 0, 1.38, 0)
	var v := _put(g, _ball(0.21), _std(0xffc64a, 0.15, 0.9), 0, 1.38, 0.1)
	v.scale = Vector3(1, 0.8, 0.8)
	_put(g, _torus(0.24, 0.05, 6, 16), _std(color), 0, 1.1, 0, PI / 2)
	for s in [-0.36, 0.36]:
		_put(g, _capsule(0.09, 0.42, 8), white, s, 0.72, 0)
	for s in [-0.13, 0.13]:
		_put(g, _capsule(0.1, 0.4, 8), white, s, 0.12, 0)
	return g


func _build_hab(parent: Node3D) -> Dictionary:
	var F := HAB_FLOOR
	var g := Node3D.new()
	g.name = "HabInterior"
	g.visible = false
	parent.add_child(g)
	var room := { "id": "hab", "group": g, "screens": [], "spin": [] }
	var wall := _shader_mat(HAB_WALL, { "R": HAB_R, "wins": PackedFloat32Array(HAB_WINDOWS) })
	_put(g, _dome(HAB_R), wall, 0, F, 0, 0, 0, 0, true)
	_put(g, _disc(HAB_R, 48), _shader_mat(HAB_FLOOR_SH), 0, F + 0.01, 0, -PI / 2)
	_label(g, "ASTRO OUTPOST", 0.17, _c(0xffd23f), 0, F + 0.016, 0, -PI / 2, 0, 0)
	# a ring of light under the skylight
	_put(g, _torus(1.35, 0.07, 8, 44), Mats.glow(0xfff4dc, 1.6), 0, F + 3.95, 0, PI / 2)
	for k in 4:
		var a := k * PI / 2
		_put(g, _cyl(0.012, 0.012, 0.3, 4), _std(0x8a93a8), sin(a) * 1.35, F + 4.1, cos(a) * 1.35)
	# ---- the airlock door (south)
	var dark := _std(0x4c5468)
	var steel := _std(0x8d96aa, 0.65, 0.4)
	var yellow := _std(0xffd23f)
	_put(g, _box(1.9, 2.6, 0.22), steel, 0, F + 1.3, 3.95)
	_put(g, _box(1.4, 2.2, 0.12), dark, 0, F + 1.12, 3.86)
	_put(g, _cyl(0.24, 0.24, 0.05, 20), Mats.glow(0x9fe8ff, 0.8), 0, F + 1.6, 3.79, PI / 2)
	_put(g, _box(1.6, 0.1, 0.06), yellow, 0, F + 0.2, 3.8)
	_put(g, _box(1.6, 0.1, 0.06), yellow, 0, F + 2.1, 3.8)
	room.doorLight = _put(g, _box(0.9, 0.12, 0.08), Mats.glow(0x4dff9a, 2), 0, F + 2.3, 3.8)
	_put(g, _quad(0.9, 0.22), _std(0x1c2236, 0.8, 0.0), 0, F + 2.55, 3.66, 0, PI)
	_label(g, "AIRLOCK", 0.12, _c(0x4dff9a), 0, F + 2.55, 3.655, 0, PI, 0)
	# ---- structure: ribs across the dome, a cable tray ring, a pipe ring and ventilation ducts
	var rib := _std(0xb9c1d3, 0.5, 0.35)
	for i in 3:
		_put(g, _torus(4.5, 0.06, 6, 48, PI), rib, 0, F, 0, 0, i * PI / 3)
	_put(g, _torus(3.58, 0.035, 6, 72), _std(0x6f7891, 0.4, 0.5), 0, F + 2.75, 0, PI / 2)       # cable tray
	_put(g, _torus(4.42, 0.05, 8, 72), _std(0x3d7dff, 0.35, 0.4), 0, F + 0.3, 0, PI / 2)        # water line
	_put(g, _torus(4.36, 0.05, 8, 72), _std(0x8fd6ff, 0.35, 0.4), 0, F + 0.42, 0, PI / 2)       # air line
	for a in [0.9, 2.1, 4.2, 5.4]:                                                                # vent ducts dropping from the tray
		var x := sin(a) * 3.55
		var z := cos(a) * 3.55
		_put(g, _cyl(0.1, 0.1, 0.9, 10), _std(0xaab2c4, 0.65, 0.4), x, F + 2.25, z)
		_put(g, _box(0.32, 0.18, 0.32), _std(0x8d96aa, 0.65, 0.4), x, F + 1.75, z)
	# ---- bunk beds (west): the living area
	var frame := _std(0xdfe3ec)
	var mattress := _std(0x5d6b8c)
	var pillow := _std(0xffffff)
	var beds := [[-0.55, 0xff8a3d], [0.55, 0x3dd6c4]]
	for i in beds.size():
		var bz: float = beds[i][0]
		for j in 2:
			var y: float = [0.45, 1.55][j]
			_put(g, _box(0.95, 0.12, 1.0), frame, -3.05, F + y - 0.1, bz, 0, 0, 0, true)
			_put(g, _box(0.86, 0.14, 0.96), mattress, -3.05, F + y + 0.03, bz)
			_put(g, _box(0.88, 0.08, 0.62), _std(beds[i][1] if j else (0xff8a3d if i else 0x3dd6c4)), -3.05, F + y + 0.13, bz + 0.15)
			_put(g, _box(0.5, 0.1, 0.24), pillow, -3.15, F + y + 0.15, bz - 0.33)
	for p in [[-3.55, -1.05], [-2.55, -1.05], [-3.55, 1.05], [-2.55, 1.05]]:
		_put(g, _cyl(0.04, 0.04, 1.9, 6), frame, p[0], F + 0.95, p[1])
	_put(g, _box(0.12, 0.08, 0.12), Mats.glow(0xffe59a, 2), -2.6, F + 1.95, -0.9)                # a reading light
	# a pinboard with photos from home
	var pb_y := _face_in(-3.3, 1.75)
	_put(g, _box(0.9, 0.6, 0.03), _std(0x8a6a4a, 0.95), -3.3, F + 2.0, 1.75, 0, pb_y)
	for ph in [[-0.28, 0.12, 0x9fd3ff], [0.02, 0.14, 0xffd9a8], [0.28, 0.08, 0xc9f0b5], [-0.1, -0.14, 0xffb3c7]]:
		_put(g, _box(0.22, 0.17, 0.01), _std(ph[2]), -3.3 + cos(pb_y) * ph[0] + sin(pb_y) * 0.02, F + 2.0 + ph[1], 1.75 - sin(pb_y) * ph[0] + cos(pb_y) * 0.02, 0, pb_y)
	# ---- Mission Control (north): a curved desk, the panoramic display, two side displays, a switch panel
	var desk := _std(0x2a3148, 0.6)
	var top := _std(0xdfe3ec, 0.5)
	_put(g, _box(2.4, 0.78, 0.7), desk, 0, F + 0.39, -3.55, 0, 0, 0, true)
	_put(g, _box(2.5, 0.06, 0.82), top, 0, F + 0.81, -3.5)
	for wng in [[-1.95, -3.05, 0.52], [1.95, -3.05, -0.52]]:
		_put(g, _box(1.4, 0.78, 0.66), desk, wng[0], F + 0.39, wng[1], 0, wng[2], 0, true)
		_put(g, _box(1.5, 0.06, 0.78), top, wng[0], F + 0.81, wng[1], 0, wng[2])
	_put(g, _box(4.6, 0.03, 0.05), Mats.glow(0x4fd8ff, 1.2), 0, F + 0.1, -3.2)                    # the light strip under the desk front
	room.screens.append({ "id": "main", "sc": _screen(g, 2.3, 1.0, 0, F + 1.6, -3.88, 0, 1024, 448), "every": 0.12 })
	room.screens.append({ "id": "power", "sc": _screen(g, 1.0, 0.62, -2.05, F + 1.36, -3.3, 0.55), "every": 1.0 })
	room.screens.append({ "id": "life", "sc": _screen(g, 1.0, 0.62, 2.05, F + 1.36, -3.3, -0.55), "every": 1.0 })
	# the switch panel: a toggle and an indicator lamp for every machine on the outpost
	_put(g, _box(1.3, 0.05, 0.36), _std(0x1a2033), 0, F + 0.86, -3.3)
	room.leds = []
	var ids := ["air", "food", "lab", "bag", "comms", "rover"]
	for i in ids.size():
		var x := -0.5 + i * 0.2
		var hexs: String = str(Data.MACHINES.get(ids[i], {}).get("color", "#4fd8ff")).substr(1)
		var cc := hexs.hex_to_int()
		_put(g, _box(0.05, 0.08, 0.05), _std(0xc9cfdc, 0.65, 0.5), x, F + 0.92, -3.22, 0.4)
		room.leds.append({ "id": ids[i], "m": _put(g, _cyl(0.025, 0.025, 0.02, 10), Mats.glow(cc, 0.2), x, F + 0.89, -3.38) })
	_put(g, _cyl(0.07, 0.07, 0.03, 16), Mats.glow(0xff3b4d, 0.9), 0.75, F + 0.9, -3.3)          # the big red call button
	_put(g, _torus(0.11, 0.025, 8, 18), dark, -0.85, F + 0.86, -3.28, PI / 2, 0, 0.3)           # a headset
	_put(g, _cyl(0.03, 0.03, 0.4, 6), steel, 0.45, F + 1.0, -3.45, 0, 0, 0.5)                    # gooseneck microphone
	_put(g, _ball(0.035, 8, 6), Mats.glow(0x9fe8ff, 0.8), 0.6, F + 1.2, -3.45)
	var chair := _group(g, 0, F, -2.5)
	_put(chair, _cyl(0.05, 0.05, 0.45, 8), steel, 0, 0.22, 0)
	_put(chair, _cyl(0.3, 0.3, 0.08, 18), _std(0x3d7dff), 0, 0.48, 0)
	_put(chair, _box(0.55, 0.55, 0.08), _std(0x3d7dff), 0, 0.8, 0.27)
	room.alarm = _put(g, _cyl(0.07, 0.09, 0.16, 12), Mats.glow(0xff3b4d, 0.05), 0, F + 2.62, -3.3)   # the rotating alarm beacon
	_put(g, _cyl(0.1, 0.1, 0.04, 12), _std(0x4c5468), 0, F + 2.52, -3.3)
	# ---- science & environment station (north-east): a tall rack with its display, a drum recorder and sample tubes
	var rk := _group(g, 3.2, F, -1.9, _face_in(3.2, -1.9))
	_put(rk, _box(1.1, 2.1, 0.5), _std(0xc9cfdc), 0, 1.05, 0, 0, 0, 0, true)
	_put(rk, _box(1.0, 0.04, 0.46), _std(0x2a3148), 0, 0.85, 0.02)
	room.screens.append({ "id": "env", "sc": _screen(rk, 0.92, 0.58, 0, 1.6, 0.27, 0), "every": 1.0 })
	room.drum = _put(rk, _cyl(0.12, 0.12, 0.3, 14), _std(0xf4f6fa), -0.25, 0.6, 0.18, 0, 0, PI / 2)
	_put(rk, _box(0.02, 0.02, 0.16), _std(0xff3b4d), -0.25, 0.73, 0.2)                            # the pen
	var tubes := [0xd98a3a, 0x9fd3ff, 0xc77b4a, 0x8f8fa0, 0xffd23f, 0x7be36a]
	for k in 6:
		_put(rk, _cyl(0.025, 0.025, 0.18, 8), _std(tubes[k], 0.3), 0.15 + k * 0.07, 0.54, 0.2)
	_put(rk, _box(0.5, 0.06, 0.2), dark, 0.32, 0.44, 0.2)
	# ---- life-support wall (east): CO2 scrubber cabinet, oxygen tanks, the plant shelves, the water recycler
	var sc := _group(g, 3.55, F, -0.45, _face_in(3.55, -0.45))
	_put(sc, _box(0.9, 1.7, 0.55), _std(0xdfe3ec), 0, 0.85, 0, 0, 0, 0, true)
	_put(sc, _box(0.8, 0.5, 0.04), _std(0x2a3148), 0, 1.35, 0.28)
	room.scrubLed = _put(sc, _cyl(0.03, 0.03, 0.02, 10), Mats.glow(0x4dff9a, 1.2), 0.3, 1.35, 0.31)
	for k in 3:
		var cart := _put(sc, _cyl(0.1, 0.1, 0.6, 12), _std(0x9fa8bd if k else 0xffb347, 0.65, 0.3), -0.26 + k * 0.26, 0.55, 0.26, PI / 2)
		cart.scale.z = 0.4
	for tx in [-0.62, -0.86]:
		var tm := _std(0x4dff9a, 0.3, 0.4)
		_put(sc, _cyl(0.12, 0.12, 1.2, 14), tm, tx, 0.6, -0.05)
		_put(sc, _ball(0.12, 10, 8), tm, tx, 1.2, -0.05)
	var shelf := _std(0xeceff5)
	var pot := _std(0xc77b4a)
	var leaf := _std(0x4fd15a)
	var leaf2 := _std(0x2fa84a)
	var PZ := 1.35
	var ys := [0.5, 1.15, 1.8]
	for row in 3:
		var y: float = ys[row]
		_put(g, _box(0.45, 0.05, 2.0), shelf, 3.6, F + y, PZ)
		_put(g, _box(0.06, 0.03, 1.8), Mats.glow(0xff58d8, 1.8), 3.5, F + y + 0.55, PZ)
		for p in 4:
			var z := PZ - 0.72 + p * 0.48
			_put(g, _cyl(0.13, 0.1, 0.18, 10), pot, 3.6, F + y + 0.12, z)
			var bush := _put(g, _ball(0.17 + ((p + row) % 3) * 0.03, 8, 6), leaf if (p + row) % 2 else leaf2, 3.6, F + y + 0.3, z)
			bush.scale.y = 0.8
			room.spin.append({ "m": bush, "k": p + row * 4 })
			if (p + row) % 3 == 0:
				_put(g, _ball(0.045, 6, 5), Mats.glow(0xff4a3a, 0.4), 3.5, F + y + 0.36, z + 0.08)
	for z in [PZ - 0.95, PZ + 0.95]:
		_put(g, _box(0.06, 1.9, 0.06), shelf, 3.6, F + 0.95, z)
	var tank := _std(0x3d7dff, 0.35, 0.3)
	_put(g, _cyl(0.42, 0.42, 1.9, 20), tank, 2.45, F + 0.95, 2.7, 0, 0, 0, true)
	_put(g, _cyl(0.07, 0.07, 1.4, 8), Mats.glow(0x4fd8ff, 1.4), 2.05, F + 0.9, 2.55)              # the sight glass
	_put(g, _cyl(0.05, 0.05, 1.6, 8), _std(0x3d7dff, 0.65, 0.4), 3.1, F + 0.9, 2.0, 0, 0, PI / 2 - 0.5)   # pipe to the plants
	_put(g, _box(0.3, 0.25, 0.25), _std(0x8d96aa, 0.65, 0.5), 2.45, F + 2.05, 2.7)                # the recycler pump on top
	# ---- exercise bike (south-east, by a window)
	var bike := _group(g, 1.55, F, 2.85, -PI * 0.75)
	_put(bike, _box(0.12, 0.08, 1.1), steel, 0, 0.1, 0)
	_put(bike, _box(0.08, 0.75, 0.08), steel, 0, 0.45, 0.35)
	_put(bike, _box(0.32, 0.08, 0.2), _std(0x2b3147), 0, 0.85, 0.35)
	_put(bike, _box(0.08, 0.7, 0.08), steel, 0, 0.45, -0.35)
	_put(bike, _box(0.5, 0.06, 0.06), _std(0x2b3147), 0, 0.82, -0.38)
	room.wheel = _put(bike, _torus(0.26, 0.05, 8, 20), _std(0xff8a3d), 0, 0.32, -0.15, 0, PI / 2)
	# ---- the suit-up corner beside the airlock (south-west), lockers (north-west) and the food store
	_put(g, _box(1.3, 1.9, 0.5), _std(0xc9cfdc), -2.9, F + 0.95, -1.95, 0, -PI / 4, 0, true)
	_suit(g, -1.3, F, 3.2, 0xff7a3d).rotation.y = -0.35
	_suit(g, -2.05, F, 2.75, 0x3d9bff).rotation.y = -0.1
	_put(g, _box(0.8, 1.1, 0.4), shelf, -2.85, F + 0.55, 1.85, 0, 1.0)
	var foods := [0xff8a3d, 0x7be36a, 0xffd23f]
	for k in 6:
		_put(g, _box(0.16, 0.22, 0.1), _std(foods[k % 3]), -2.95 + (k % 3) * 0.17, F + 0.55 + floorf(k / 3.0) * 0.4, 1.6 + (k % 3) * 0.14, 0, 1.0)
	# ---- galley table (west of centre)
	var tg := _group(g, -1.25, F, 0.95)
	_put(tg, _cyl(0.65, 0.65, 0.06, 28), top, 0, 0.78, 0, 0, 0, 0, true)
	_put(tg, _cyl(0.07, 0.12, 0.76, 10), steel, 0, 0.38, 0)
	for a in [0.5, 2.6, 4.7]:
		_put(tg, _cyl(0.2, 0.2, 0.06, 14), _std(0xff8a3d), sin(a) * 0.95, 0.48, cos(a) * 0.95)
		_put(tg, _cyl(0.04, 0.04, 0.45, 6), steel, sin(a) * 0.95, 0.24, cos(a) * 0.95)
		_put(tg, _box(0.26, 0.04, 0.2), _std(0x8fd6ff), sin(a) * 0.42, 0.83, cos(a) * 0.42)        # food trays
	_put(tg, _cyl(0.06, 0.05, 0.12, 10), _std(0xffffff), 0.1, 0.87, 0.1)
	# ---- floor markings: a painted lane from the airlock to the console, the mission patch, a rug
	var lane_m := _std(0xffd23f, 1.0, 0.0)
	lane_m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	lane_m.albedo_color.a = 0.16
	_put(g, _quad(0.9, 5.2), lane_m, 0, F + 0.015, 0.6, -PI / 2)
	_patch(g, 0.85, -3.62, F + 2.1, -1.0, _face_in(-3.62, -1.0))
	_put(g, _disc(0.9, 36), _std(0x6a4fd8, 0.95), -1.25, F + 0.02, 0.95, -PI / 2)

	room.colliders = [[-3.05, -0.55, 0.62], [-3.05, 0.55, 0.62], [0, -3.55, 1.2], [-1.95, -3.05, 0.75], [1.95, -3.05, 0.75], [0, -2.5, 0.33],
		[3.2, -1.9, 0.65], [3.55, -0.45, 0.6], [3.6, 1.35, 0.95], [2.45, 2.7, 0.5], [1.55, 2.85, 0.55], [-2.9, -1.95, 0.75],
		[-1.3, 3.2, 0.35], [-2.05, 2.75, 0.35], [-2.85, 1.85, 0.45], [-1.25, 0.95, 0.75]]
	room.spots = [
		{ "id": "door", "label": "Go outside", "x": 0.0, "z": 3.05, "reach": 1.3 },
		{ "id": "bed", "label": "Go to sleep (end the day)", "x": -2.2, "z": 0.0, "reach": 1.1 },
		{ "id": "console", "label": "Mission Control · Earth link", "x": 0.0, "z": -2.2, "reach": 1.15 },
		{ "id": "power", "label": "Power station", "x": -1.45, "z": -2.35, "reach": 0.85 },
		{ "id": "life", "label": "Life-support station", "x": 1.45, "z": -2.35, "reach": 0.85 },
		{ "id": "science", "label": "Science & environment station", "x": 2.45, "z": -1.45, "reach": 0.95 },
		{ "id": "scrubber", "label": "Check the CO₂ scrubber", "x": 2.85, "z": -0.35, "reach": 0.85 },
		{ "id": "plants", "label": "Look at the plants", "x": 2.75, "z": 1.35, "reach": 1.0 },
		{ "id": "water", "label": "Check the water recycler", "x": 1.85, "z": 2.2, "reach": 0.9 },
		{ "id": "bike", "label": "Ride the exercise bike", "x": 1.0, "z": 2.3, "reach": 0.8 },
		{ "id": "suits", "label": "Look at the spacesuits", "x": -1.4, "z": 2.4, "reach": 0.9 },
		{ "id": "table", "label": "Look at the space food", "x": -0.45, "z": 0.5, "reach": 0.85 },
		{ "id": "window", "label": "Look up at the sky", "x": 0.6, "z": -0.4, "reach": 0.9 },
	]
	room.spawn = [0.0, 2.35]
	room.face = PI          # just inside the airlock, facing north into the room
	# where the cutaway camera stands and looks, in room coordinates: high over the right shoulder
	room.view = { "pos": [2.9, F + 3.0, 0.3], "look": [-0.2, F + 1.3, -3.9] }
	return room


# =====================================================================
#  the rocket
# =====================================================================
# A crew cabin about 4.6 m across, modelled on real capsules, in the rocket's own coordinates: +z is the big window
# (it faces the habitat), -z is the back wall with the ladder up to the docking hatch.
#   front   a glass cockpit: three displays with bezel keys (fuel, course home, launch), a caution panel,
#           a shelf of guarded switches and knobs, a breaker panel and the abort handle
#   middle  two sculpted launch couches on shock struts, hand controllers, and a swing-arm display
#   left    (-x) life support: oxygen and nitrogen tanks, plumbing, valves, gauges, the CO2 scrubber
#   right   (+x) fabric stowage bags behind a cargo net; the sample case appears once it is loaded

## The cabin wall: grey close-out panels with seams and fasteners, dark kick plates, an accent stripe, and the four
## windows cut out with a dark gasket round each. u = 0.5 is the big window; the -x side is u = 0.75.
const RK_WALL := """
shader_type spatial;
render_mode cull_disabled;
uniform float H = 4.7;
uniform float R = 2.3;
uniform vec3 accent = vec3(0.3, 0.85, 1.0);
varying vec3 lp;
vec3 sc(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void vertex() { lp = VERTEX; }
float row_y(int i, float h) { return i == 0 ? 0.0 : (i == 1 ? 0.32 : (i == 2 ? 1.1 : (i == 3 ? 2.45 : (i == 4 ? 3.85 : h)))); }
vec3 win(int i) { return i == 0 ? vec3(0.5, 1.78, 0.66) : (i == 1 ? vec3(0.5, 3.5, 0.3) : (i == 2 ? vec3(0.375, 1.7, 0.27) : vec3(0.625, 1.7, 0.27))); }
void fragment() {
	float a = atan(lp.x, lp.z);
	float u = fract(0.5 - a / TAU);
	float m = lp.y + H * 0.5;                     // height above the cabin floor
	float w = 1024.0, PX = 512.0 / H, PXU = w / (TAU * R);
	vec2 px = vec2(u * w, 512.0 - m * PX);
	// the windows: a hole with a dark gasket
	vec3 c = vec3(0.0);
	bool gasket = false;
	for (int i = 0; i < 4; i++) {
		vec3 wn = win(i);
		float dx = px.x - wn.x * w; dx -= round(dx / w) * w;
		vec2 d = vec2(dx / PXU, (512.0 - wn.y * PX - px.y) / PX);
		float r = length(d);
		if (r < wn.z) discard;
		if (r < wn.z + 0.06) gasket = true;
	}
	int j = 0;
	for (int i = 0; i < 5; i++) { if (m >= row_y(i, H)) j = i; }
	float cw = w / 24.0, k = floor(px.x / cw);
	float shade = hash(vec2(k, float(j)));
	if (j == 0) c = sc(vec3(59.0, 64.0, 73.0));                                         // kick plates
	else if (j == 4) c = sc(vec3(168.0, 173.0, 182.0) + shade * 10.0);
	else c = sc(vec3(196.0, 200.0, 207.0) + shade * vec3(14.0, 14.0, 12.0));
	float y0 = 512.0 - row_y(j + 1, H) * PX, y1 = 512.0 - row_y(j, H) * PX, x0 = k * cw;
	vec2 q = px - vec2(x0, y0);
	if (q.y < 2.0 || q.x < 2.0) c = mix(c, sc(vec3(40.0, 46.0, 58.0)), 0.55);           // seams
	// fasteners at the corners and halfway down long panels
	for (int fi = 0; fi < 2; fi++) {
		float fx = fi == 0 ? x0 + 7.0 : x0 + cw - 7.0;
		for (int fj = 0; fj < 3; fj++) {
			float fy = fj == 0 ? y0 + 7.0 : (fj == 1 ? y1 - 7.0 : (y1 - y0 > 110.0 ? (y0 + y1) * 0.5 : -100.0));
			float d = length(px - vec2(fx, fy));
			if (d < 3.2) c = mix(c, sc(vec3(70.0, 76.0, 90.0)), 0.8);
			if (d < 1.6) c = mix(c, sc(vec3(225.0, 228.0, 234.0)), 0.9);
		}
	}
	float sy = 512.0 - 0.32 * PX;
	if (px.y > sy - 2.0 && px.y < sy + 1.0) c = mix(c, accent, 0.9);                    // the accent stripe
	if (gasket) c = sc(vec3(32.0, 36.0, 44.0));
	ALBEDO = c;
	ROUGHNESS = 0.62;
	METALLIC = 0.12;
}
"""

const RK_DECK := """
shader_type spatial;
uniform vec3 accent = vec3(0.3, 0.85, 1.0);
vec3 sc(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
void fragment() {
	float w = 512.0, c0 = w / 2.0;
	vec2 px = UV * w;
	vec3 c = sc(vec3(88.0, 93.0, 103.0));
	// diamond tread
	vec2 cell = floor(px / 12.0);
	float off = mod(cell.y, 2.0) > 0.5 ? 6.0 : 0.0;
	vec2 lq = px - vec2(cell.x * 12.0 + off, cell.y * 12.0);
	if (lq.x > 9.0) lq.x -= 12.0;
	float ang = mod(cell.x + cell.y, 2.0) > 0.5 ? 0.7 : -0.7;
	vec2 rq = vec2(cos(ang) * lq.x + sin(ang) * lq.y, -sin(ang) * lq.x + cos(ang) * lq.y);
	if (abs(rq.x) < 3.5 && abs(rq.y) < 1.0) c = mix(c, vec3(1.0), 0.07);
	// plate seams and bolts
	vec2 g = abs(px - round(px / (w / 4.0)) * (w / 4.0));
	if (min(g.x, g.y) < 1.0 && px.x > 2.0 && px.y > 2.0 && px.x < w - 2.0 && px.y < w - 2.0) c = mix(c, sc(vec3(20.0, 24.0, 32.0)), 0.7);
	vec2 b = px - (round((px - 6.0) / (w / 4.0)) * (w / 4.0) + 6.0);
	if (length(b) < 2.5) c = mix(c, sc(vec3(30.0, 34.0, 42.0)), 0.8);
	float r = length(px - vec2(c0));
	if (abs(r - w * 0.475) < 1.5) c = mix(c, accent, 0.7);
	ALBEDO = c;
	ROUGHNESS = 0.55;
	METALLIC = 0.55;
}
"""

const RK_CEIL := """
shader_type spatial;
vec3 sc(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
void fragment() {
	float w = 512.0, c0 = w / 2.0;
	vec2 p = UV * w - vec2(c0);
	vec3 c = sc(vec3(167.0, 174.0, 186.0));
	float a = atan(p.y, p.x), r = length(p);
	float sector = TAU / 12.0;
	float da = abs(a - round(a / sector) * sector) * r;
	vec3 line = sc(vec3(40.0, 46.0, 58.0));
	if (da < 1.0) c = mix(c, line, 0.5);
	if (abs(r - w * 0.25) < 1.0 || abs(r - w * 0.4) < 1.0) c = mix(c, line, 0.5);
	ALBEDO = c;
	ROUGHNESS = 0.7;
	METALLIC = 0.1;
}
"""

const HAZARD := """
shader_type spatial;
uniform float stripes = 32.0;
void fragment() {
	float s = fract(UV.x * stripes + UV.y * 0.5);
	ALBEDO = s < 0.5 ? vec3(0.89, 0.54, 0.03) : vec3(0.011, 0.013, 0.018);
	ROUGHNESS = 0.6;
}
"""

func _accent() -> int:
	return 0xff9a4d if site == "mars" else 0x4fd8ff


## the top of a launch couch, side view: [forward (toward the window), height]; the head is at the back
const COUCH := [[-1.34, 0.84], [-1.05, 0.77], [-0.6, 0.66], [-0.2, 0.58], [0.0, 0.56], [0.14, 0.6], [0.3, 0.8], [0.45, 0.97], [0.58, 0.9], [0.72, 0.78], [0.84, 0.7]]
var _geo := {}


## A strip that follows the couch outline between two heights, as wide as width (centred on x), forward along +z.
func _couch_strip(lo: float, hi: float, width: float, from := 0, to := -1) -> ArrayMesh:
	var key := "%s,%s,%s,%s,%s" % [lo, hi, width, from, to]
	if _geo.has(key):
		return _geo[key]
	var raw: Array = COUCH.slice(from, COUCH.size() if to < 0 else to)
	var pts: Array = _catmull(raw.map(func(p): return Vector3(0, p[1], p[0])), 4)      # (_, height, forward)
	var n := pts.size()
	var b := MB.new()
	var hw := width / 2
	var up := []                      # the outward (upward) normal in (forward, height) at each point
	for i in n:
		var t: Vector3 = (pts[mini(i + 1, n - 1)] as Vector3) - (pts[maxi(i - 1, 0)] as Vector3)
		up.append(Vector3(0, t.z, -t.y).normalized())
	for layer in [[hi, 1.0], [lo, -1.0]]:
		var rows := []
		for i in n:
			var p: Vector3 = pts[i]
			var nn: Vector3 = up[i] * layer[1]
			rows.append([b.vert(Vector3(-hw, p.y + layer[0], p.z), nn), b.vert(Vector3(hw, p.y + layer[0], p.z), nn)])
		for i in n - 1:
			b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0])
	for end in [[0, -1.0], [n - 1, 1.0]]:
		var p: Vector3 = pts[end[0]]
		var t2: Vector3 = ((pts[mini(end[0] + 1, n - 1)] as Vector3) - (pts[maxi(end[0] - 1, 0)] as Vector3)).normalized() * end[1]
		b.quad(b.vert(Vector3(-hw, p.y + lo, p.z), t2), b.vert(Vector3(hw, p.y + lo, p.z), t2), b.vert(Vector3(hw, p.y + hi, p.z), t2), b.vert(Vector3(-hw, p.y + hi, p.z), t2))
	var poly := PackedVector2Array()
	for i in n:
		poly.append(Vector2(pts[i].z, pts[i].y + lo))
	for i in range(n - 1, -1, -1):
		poly.append(Vector2(pts[i].z, pts[i].y + hi))
	var tris := Geometry2D.triangulate_polygon(poly)
	for side in [-1.0, 1.0]:
		var ids := []
		for q in poly:
			ids.append(b.vert(Vector3(hw * side, q.y, q.x), Vector3(side, 0, 0)))
		for i in range(0, tris.size(), 3):
			b.tri(ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]])
	var m := b.mesh()
	_geo[key] = m
	return m


func _couch(g: Node3D, x: float, cmdr: bool, M: Dictionary) -> Node3D:
	var s := _group(g, x, RK_FLOOR, -0.55)
	var inner := 1.0 if x < 0 else -1.0
	_put(s, _couch_strip(-0.075, 0.0, 0.64), M.shell, 0, 0, 0, 0, 0, 0, true)              # the shell under the cushion
	_put(s, _couch_strip(0.0, 0.075, 0.5), M.cushion, 0, 0, 0, 0, 0, 0, true)             # the cushion
	for bx in [-0.3, 0.3]:
		_put(s, _couch_strip(-0.07, 0.17, 0.05, 0, 9), M.shell, bx, 0, 0, 0, 0, 0, true)  # raised side rails
	# headrest with wings
	_put(s, _box(0.34, 0.11, 0.3), M.cushion, 0, 0.9, -1.2, 0.2, 0, 0, true)
	for bx in [-0.2, 0.2]:
		_put(s, _box(0.06, 0.24, 0.3), M.shell, bx, 0.94, -1.2, 0.2)
	# foot plate and heel cups
	_put(s, _box(0.5, 0.26, 0.05), M.shell, 0, 0.8, 0.9, -0.15, 0, 0, true)
	for bx in [-0.11, 0.11]:
		_put(s, _box(0.16, 0.06, 0.14), M.rubber, bx, 0.72, 0.82, 0.5)
	# shock struts down to floor brackets, with yellow damper sleeves
	for p in [[-0.85, 0.66, 0.14], [-0.1, 0.5, -0.18], [0.5, 0.82, -0.22]]:
		var tp := Vector3(0, p[1] - 0.07, p[0])
		var bt := Vector3(0, 0.04, p[0] + p[2])
		for bx in [-0.2, 0.2]:
			var mid := (tp + bt) * 0.5
			var ln := tp.distance_to(bt)
			var ang := atan2(tp.z - bt.z, tp.y - bt.y)
			_put(s, _cyl(0.018, 0.018, ln, 10), M.steel, bx, mid.y, mid.z, ang)
			_put(s, _cyl(0.03, 0.03, ln * 0.4, 12), M.damper, bx, mid.y - (tp.y - bt.y) * 0.12, mid.z - (tp.z - bt.z) * 0.12, ang)
			_put(s, _box(0.07, 0.04, 0.1), M.alu, bx, 0.02, bt.z)
	# five-point harness and buckle
	for bx in [-0.12, 0.12]:
		_put(s, _couch_strip(0.077, 0.083, 0.055, 1, 5), M.strap, bx, 0, 0)
	_put(s, _box(0.46, 0.008, 0.06), M.strap, 0, 0.66, 0.0, -0.1)
	_put(s, _box(0.06, 0.008, 0.3), M.strap, 0, 0.72, 0.16, -0.75)
	_put(s, _cyl(0.045, 0.045, 0.02, 20), M.alu, 0, 0.67, 0.03)
	# armrests; a hand controller on the inside one
	for side in [inner, -inner]:
		_put(s, _box(0.07, 0.05, 0.46), M.shell, side * 0.37, 0.78, -0.25, 0.1, 0, 0, true)
	var hc := _group(s, inner * 0.37, 0.81, -0.04)
	_put(hc, _box(0.09, 0.03, 0.11), M.dark)
	_put(hc, _cyl(0.03, 0.04, 0.04, 14), M.rubber, 0, 0.03, 0)
	_put(hc, _capsule(0.022, 0.07), M.grip, 0, 0.09, 0.01, 0.25)
	_put(hc, _ball(0.012, 8, 6), Mats.glow(0xffc04d, 0.6) if cmdr else M.dark, 0, 0.14, 0.02)
	return s


func _pbr(hex: int, rough: float, metal: float) -> StandardMaterial3D:
	return _std(hex, rough, metal)


## a point on the cabin wall: angle a (0 = the window, +x side positive), radius r, height y above the floor
static func _on_wall(a: float, r: float, y: float) -> Vector3:
	return Vector3(sin(a) * r, RK_FLOOR + y, cos(a) * r)


## a live display: dark bezel, glowing screen and a faint glass in front
func _display(parent: Node3D, w: float, h: float, x: float, y: float, z: float, cw: int, ch: int, M: Dictionary) -> Dictionary:
	var g := _group(parent, x, y, z)
	_put(g, _box(w + 0.05, h + 0.05, 0.03), M.bezel, 0, 0, -0.012)
	var sc := Paint.screen(_screens_holder, g, w, h, cw, ch)
	(sc.mesh as MeshInstance3D).position.z = 0.0045
	var glass := _std(0x0b0f14, 0.22, 0.0)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.albedo_color.a = 0.12
	_put(g, _quad(w, h), glass, 0, 0, 0.006)
	sc.group = g
	return sc


## a picture painted once (labels, dials, keypads): a quad showing what paint(ci, w, h) draws
func _painted(parent: Node3D, w: float, h: float, cw: int, ch: int, paint: Callable, x: float, y: float, z: float, rx := 0.0, ry := 0.0, glow := false, transparent := false) -> MeshInstance3D:
	var sc := Paint.screen(_screens_holder, parent, w, h, cw, ch, glow, transparent)
	var mi: MeshInstance3D = sc.mesh
	mi.position = Vector3(x, y, z)
	mi.rotation_order = EULER_ORDER_XYZ
	mi.rotation = Vector3(rx, ry, 0)
	Paint.redraw(sc, paint)
	return mi


func _build_rocket(parent: Node3D) -> Dictionary:
	var F := RK_FLOOR
	var H := RK_TOP - RK_FLOOR
	var g := Node3D.new()
	g.name = "RocketInterior"
	g.visible = false
	parent.add_child(g)
	var room := { "id": "rocket", "group": g, "screens": [], "spin": [] }
	var acc := _accent()
	var M := {
		"shell": _pbr(0x2c3038, 0.42, 0.25), "cushion": _pbr(0x3a4763, 0.92, 0.0), "strap": _pbr(0xe0742e, 0.85, 0.0),
		"rubber": _pbr(0x16181d, 0.95, 0.0), "dark": _pbr(0x1e2229, 0.55, 0.3), "console": _pbr(0x2a2f38, 0.6, 0.25),
		"steel": _pbr(0xb7bec9, 0.28, 0.75), "alu": _pbr(0xc9ced6, 0.35, 0.7), "aluD": _two(_pbr(0xc9ced6, 0.35, 0.7)),
		"damper": _pbr(0xe8b72c, 0.45, 0.4), "grip": _pbr(0x23262c, 0.75, 0.0), "rail": _pbr(0x3a5b8f, 0.35, 0.3),
		"frame": _pbr(0x9aa3b1, 0.4, 0.7), "fabric": _pbr(0xe7e2d3, 0.96, 0.0), "web": _pbr(0x5b616d, 0.9, 0.0),
		"cableA": _pbr(0x23262c, 0.6, 0.0), "cableB": _pbr(0x8b929e, 0.5, 0.2), "cableC": _pbr(0xd9dde3, 0.55, 0.0),
		"tankO": _pbr(0x2f6fd6, 0.32, 0.35), "tankN": _pbr(0xdcdfe5, 0.3, 0.35), "key": _pbr(0x3b414c, 0.5, 0.2),
		"red": _pbr(0xc81e2c, 0.4, 0.1), "bezel": _pbr(0x15181e, 0.5, 0.3),
	}
	room.M = M
	var accent_v := Vector3(_c(acc).r, _c(acc).g, _c(acc).b)
	# ---- the shell: wall, deck and ceiling; the wall casts the sun's shadow, so daylight only falls in through the windows
	_put(g, _inner_cyl(RK_R, H), _shader_mat(RK_WALL, { "H": H, "R": RK_R, "accent": accent_v }), 0, F + H / 2, 0, 0, 0, 0, true)
	_put(g, _disc(RK_R, 64), _shader_mat(RK_DECK, { "accent": accent_v }), 0, F + 0.01, 0, -PI / 2, 0, 0, true)
	_put(g, _disc(RK_R, 64), _shader_mat(RK_CEIL), 0, RK_TOP - 0.01, 0, PI / 2, 0, 0, true)
	# the words on the wall
	var ink := _c(0x2b3140)
	_label(g, "LIFE SUPPORT", 0.14, ink, _on_wall(-PI / 2, RK_R - 0.02, 2.95).x, F + 2.95, 0, 0, -PI / 2 + PI)
	_label(g, "STOWAGE", 0.14, ink, _on_wall(PI / 2, RK_R - 0.02, 2.95).x, F + 2.95, 0, 0, PI / 2 + PI)
	var top_txt := "OUTPOST ONE  ·  " + ("MARS ASCENT VEHICLE" if site == "mars" else "LUNAR ASCENT VEHICLE")
	var tp := _on_wall(0, RK_R - 0.02, 4.2)
	_label(g, top_txt, 0.12, ink, tp.x, tp.y, tp.z, 0, PI)
	for a in [2.71, -2.71]:
		var dp := _on_wall(a, RK_R - 0.02, 4.2)
		_label(g, "↑ DOCKING HATCH", 0.12, ink, dp.x, dp.y, dp.z, 0, a + PI)
	var cp := _on_wall(0.4 * TAU, RK_R - 0.05, 1.36)
	_plate(g, 0.46, 0.13, 0xffd23f, "CAUTION HOT", _c(0x1d2336), cp.x, cp.y, cp.z, 0, 0.4 * TAU + PI)
	# aluminium ring frames and stringers, standing a little off the wall
	for y in [0.33, 2.62, 4.0]:
		_put(g, _torus(RK_R - 0.07, 0.035, 4, 72), M.frame, 0, F + y, 0, PI / 2, 0, PI / 4)
	for deg in [30, 60, 90, 120, 150, 210, 240, 270, 300, 330]:
		var a: float = deg * PI / 180
		var p := _on_wall(a, RK_R - 0.06, H / 2)
		_put(g, _box(0.06, H - 0.1, 0.07), M.frame, p.x, p.y, p.z, 0, a)
	# cable bundles in clamps along both sides, just above the upper frame
	for run in [[0.6, 2.6], [-0.6, -2.6]]:
		var steps := 14
		var lines := [[], [], []]
		for k in steps + 1:
			var a: float = run[0] + (run[1] - run[0]) * k / steps
			for j in 3:
				lines[j].append(_on_wall(a, RK_R - 0.12 - j * 0.03, 2.78 + j * 0.035))
		_put(g, _tube(lines[0], 0.022, 4), M.cableA)
		_put(g, _tube(lines[1], 0.016, 4), M.cableB)
		_put(g, _tube(lines[2], 0.012, 4), M.cableC)
		var clamps := []
		for k in range(1, steps, 2):
			var a2: float = run[0] + (run[1] - run[0]) * k / steps
			var c2 := _on_wall(a2, RK_R - 0.14, 2.82)
			clamps.append([c2.x, c2.y, c2.z, 0, a2, 0])
		_inst(g, _box(0.03, 0.13, 0.1), M.alu, clamps)
	# handrails: blue bars on stand-offs, beside the window and by the ladder
	for hr_d in [[0.5, 2.1, 0.5], [-0.5, 2.1, 0.5], [PI - 0.32, 1.6, 0.7], [PI + 0.32, 1.6, 0.7]]:
		var hp := _on_wall(hr_d[0], RK_R - 0.16, hr_d[1])
		var hr := _group(g, hp.x, hp.y, hp.z, hr_d[0])
		_put(hr, _capsule(0.018, hr_d[2]), M.rail)
		for o in [-hr_d[2] / 2 + 0.03, hr_d[2] / 2 - 0.03]:
			_put(hr, _box(0.035, 0.035, 0.1), M.alu, 0, o, 0.05)
	# windows: deep frames with bolts, and a faint glass
	for wd in [[0.0, 1.78, 0.66], [0.0, 3.5, 0.3], [-PI / 4, 1.7, 0.27], [PI / 4, 1.7, 0.27]]:
		var r: float = wd[2]
		var wp := _on_wall(wd[0], RK_R - 0.1, wd[1])
		var wg := _group(g, wp.x, wp.y, wp.z, wd[0] + PI)
		var prof := [Vector2(r + 0.015, -0.1), Vector2(r + 0.015, 0.02), Vector2(r + 0.04, 0.06), Vector2(r + 0.13, 0.07), Vector2(r + 0.16, 0.04), Vector2(r + 0.16, -0.1)]
		_put(wg, _lathe(prof, 48), M.aluD, 0, 0, 0, PI / 2)
		var bolts := []
		for i in 16:
			var bb := i / 16.0 * TAU
			bolts.append([cos(bb) * (r + 0.1), sin(bb) * (r + 0.1), 0.07, PI / 2, 0, 0])
		_inst(wg, _cyl(0.009, 0.009, 0.012, 6), M.steel, bolts)
		var gl := _std(0x9fb4c8, 0.03, 0.0)
		gl.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		gl.albedo_color.a = 0.1
		_put(wg, _disc(r + 0.02, 40), _two(gl), 0, 0, -0.04)
	# lights: four LED panels in the ceiling and a soft strip round the deck
	for p in [[0.95, 0.55], [-0.95, 0.55], [0.95, -0.65], [-0.95, -0.65]]:
		_put(g, _box(0.62, 0.32, 0.03), M.alu, p[0], RK_TOP - 0.03, p[1], PI / 2)
		_put(g, _quad(0.56, 0.26), Mats.glow(0xf3f7ff, 0.85), p[0], RK_TOP - 0.048, p[1], PI / 2)
	_put(g, _torus(RK_R - 0.09, 0.012, 4, 96), Mats.glow(acc, 0.55), 0, F + 0.33, 0, PI / 2)
	# the deck hatch you climbed up through, in a ring with hazard stripes
	_put(g, _ring(0.42, 0.56, 48), _shader_mat(HAZARD), 0, F + 0.017, 0, -PI / 2)
	_put(g, _torus(0.42, 0.018, 8, 48), M.alu, 0, F + 0.02, 0, PI / 2)
	_put(g, _capsule(0.014, 0.22), M.rail, 0, F + 0.035, 0.2, 0, 0, PI / 2)

	# ---- front: the glass cockpit
	_put(g, _box(2.36, 0.62, 0.56), M.console, 0, F + 0.31, 1.86, 0, 0, 0, true)
	# seen from the couches, +x is on the left: fuel on the left, course in the middle, launch on the right
	var dsp := [{ "id": "rk-fuel", "x": 0.8, "z": 1.5, "yaw": 0.5 }, { "id": "rk-course", "x": 0.0, "z": 1.66, "yaw": 0.0 }, { "id": "rk-launch", "x": -0.8, "z": 1.5, "yaw": -0.5 }]
	for i in dsp.size():
		var d: Dictionary = dsp[i]
		var fg := Node3D.new()
		fg.position = Vector3(d.x, F + 0.98, d.z)
		fg.rotation = Vector3(-0.55, PI + d.yaw, 0)          # YXZ, as in the original
		g.add_child(fg)
		_put(fg, _box(0.8, 0.66, 0.09), M.console, 0, 0, -0.05, 0, 0, 0, true)
		var ds := _display(fg, 0.6, 0.375, 0, 0.04, 0, 640, 400, M)
		room.screens.append({ "id": d.id, "sc": ds })
		# bezel keys round the display, as on a real multi-function display
		var keys := []
		for k in 6:
			keys.append([-0.25 + k * 0.1, -0.215, 0.006])
		for k in 4:
			keys.append([-0.355, 0.17 - k * 0.09, 0.006])
			keys.append([0.355, 0.17 - k * 0.09, 0.006])
		_inst(fg, _box(0.05, 0.034, 0.018), M.key, keys)
		_inst(fg, _quad(0.03, 0.004), Mats.glow(0x7fe8ff, 0.5), keys.map(func(p): return [p[0], p[1] + 0.006, 0.0165]))
		_inst(fg, _cyl(0.008, 0.008, 0.008, 6), M.steel, [[-0.37, 0.3, 0.0, PI / 2], [0.37, 0.3, 0.0, PI / 2], [-0.37, -0.3, 0.0, PI / 2], [0.37, -0.3, 0.0, PI / 2]])
		if i == 1:      # the caution and warning panel above the middle display
			var an := Paint.screen(_screens_holder, fg, 0.62, 0.07, 768, 88)
			(an.mesh as MeshInstance3D).position = Vector3(0, 0.29, 0.006)
			_put(fg, _box(0.66, 0.1, 0.02), M.dark, 0, 0.29, -0.004)
			room.screens.append({ "id": "rk-annun", "sc": an })
	# the switch shelf: guarded toggles, knobs and labels
	var shelf := Node3D.new()
	shelf.position = Vector3(0, F + 0.62, 1.4)
	shelf.rotation.x = -0.18
	g.add_child(shelf)
	_put(shelf, _box(2.06, 0.05, 0.26), M.console, 0, 0, 0, 0, 0, 0, true)
	var sl := _painted(shelf, 2.0, 0.22, 1024, 112, func(ci: CanvasItem, w: int, h: int):
		Paint.rect(ci, 0, 0, w, h, Color("#2a2f38"))
		var names := ["MAIN A", "MAIN B", "CAB FAN", "O₂ FLOW", "COMM", "LIGHTS", "HEATERS", "PUMPS"]
		for i in names.size():
			Paint.text(ci, names[i], 70 + i * 92, 14, 15, Color("#d7dce6"), "center", 700, "mono")
		Paint.stroke_rect(ci, 20, 26, 740, 76, Color("#d7dce6"), 2)
		Paint.text(ci, "CABIN", 830, 14, 15, Color("#d7dce6"), "center", 700, "mono")
		Paint.text(ci, "VOLUME", 920, 14, 15, Color("#d7dce6"), "center", 700, "mono"), 0, 0.027, 0, -PI / 2)
	sl.rotation.z = PI
	var bases := []
	var bats := []
	var guards := []
	for k in 8:
		var sx := 0.89 - k * 0.18                 # the label strip is turned round, so switches count from +x
		bases.append([sx, 0.035, 0.0])
		bats.append([sx, 0.06, 0.0, 0.45 if k % 3 else -0.45, 0, 0])
		if k < 2:
			guards.append([sx - 0.028, 0.06, 0.0])
			guards.append([sx + 0.028, 0.06, 0.0])
	_inst(shelf, _box(0.045, 0.02, 0.045), M.dark, bases)
	_inst(shelf, _cyl(0.006, 0.004, 0.05, 8), M.steel, bats)
	_inst(shelf, _box(0.006, 0.045, 0.06), M.red, guards)
	for p in [[-0.66, 0.0], [-0.84, 0.0]]:
		var kn := _group(shelf, p[0], 0.04, p[1])
		_put(kn, _cyl(0.03, 0.034, 0.03, 20), M.dark)
		_put(kn, _box(0.006, 0.006, 0.026), Mats.glow(0xffffff, 0.5), 0, 0.016, 0.01)
	# abort: a striped housing, a red T-handle and a placard
	var ab := _group(g, 0.92, F + 0.66, 1.26)
	_put(ab, _box(0.24, 0.07, 0.16), _shader_mat(HAZARD, { "stripes": 4.0 }), 0, 0, 0, 0, 0, 0, true)
	_put(ab, _cyl(0.012, 0.012, 0.06, 10), M.steel, 0, 0.06, 0)
	room.abort = _put(ab, _capsule(0.018, 0.11), Mats.glow(0xd8202e, 0.45), 0, 0.095, 0, 0, 0, PI / 2)
	var abp := _plate(ab, 0.14, 0.035, 0xc81e2c, "ABORT", Color.WHITE, 0, 0.037, 0.06, -PI / 2)
	abp.rotation.z = PI
	# a breaker panel on the front of the console, facing the crew
	var bp := _group(g, 0, F + 0.4, 1.575, PI)
	_put(bp, _box(1.5, 0.2, 0.02), M.dark)
	var brk := []
	for k in 22:
		brk.append([-0.68 + k * 0.065, -0.02, 0.015, PI / 2, 0, 0])
	_inst(bp, _cyl(0.011, 0.011, 0.022, 10), M.dark, brk)
	_inst(bp, _cyl(0.006, 0.006, 0.026, 8), _std(0xe8e8e8, 0.4, 0.1), brk.map(func(p): return [p[0], p[1], p[2] + 0.004, PI / 2, 0, 0]))
	_label(bp, "CIRCUIT BREAKERS  ·  MAIN BUS A / B  ·  DO NOT RESET TWICE", 0.028, _c(0xcfd5e1), 0, 0.065, 0.012, 0, 0, 0, 600, "mono")

	# ---- middle: two couches and the hand-controller pedestal between them
	_couch(g, -0.72, true, M)
	_couch(g, 0.72, false, M)
	_put(g, _box(0.26, 0.5, 0.44), M.console, 0, F + 0.25, -0.95, 0, 0, 0, true)
	_painted(g, 0.2, 0.3, 128, 192, func(ci: CanvasItem, w: int, h: int):
		Paint.rect(ci, 0, 0, w, h, Color("#14181f"))
		for r in 4:
			for c in 3:
				Paint.rrect(ci, 14 + c * 36, 50 + r * 34, 28, 26, 5, Color("#3b414c"))
				Paint.text(ci, "123456789*0#"[r * 3 + c], 28 + c * 36, 63 + r * 34, 14, Color("#9fe8ff"), "center", 700, "mono")
		Paint.rect(ci, 14, 16, 100, 22, Color("#5dff9e")), 0, F + 0.505, -0.95, -PI / 2, 0, true)
	# the swing-arm display over the couches, angled down at the crew's faces
	_put(g, _tube([Vector3(0, RK_TOP - 0.02, -0.8), Vector3(0, RK_TOP - 0.6, -0.8), Vector3(0, F + 2.62, -0.78)], 0.025, 8), M.alu)
	_put(g, _cyl(0.06, 0.06, 0.06, 16), M.dark, 0, RK_TOP - 0.04, -0.8)
	_put(g, _ball(0.045, 12, 8), M.dark, 0, F + 2.6, -0.78)
	var asc := _group(g, 0, F + 2.4, -0.8)
	_put(asc, _box(1.2, 0.44, 0.06), M.console, 0, 0, -0.035, 0, 0, 0, true)
	var ad := _display(asc, 1.08, 0.33, 0, 0, 0, 768, 236, M)
	Paint.redraw(ad, _ascent_panel)
	room.face_later = [[asc, Vector3(0, F + 0.85, -1.75)]]

	# ---- back: the ladder and the docking hatch in the ceiling
	var lad := _group(g, 0, F, -2.1)
	for x in [-0.22, 0.22]:
		_put(lad, _cyl(0.022, 0.022, H - 0.2, 12), M.alu, x, (H - 0.2) / 2 + 0.05, 0)
	var rungs := []
	var ry := 1.15
	while ry < H - 0.3:
		rungs.append([0, ry, 0, 0, 0, PI / 2])
		ry += 0.3
	_inst(lad, _cyl(0.016, 0.016, 0.44, 10), M.steel, rungs)
	var dh := _group(g, 0, RK_TOP, -1.5)
	_put(dh, Mats.cyl(0.5, 0.5, 0.3, 40, true), _two(_std(0x8b929e, 0.45, 0.6)), 0, 0.13, 0)
	_put(dh, _torus(0.5, 0.035, 8, 48), M.alu, 0, -0.02, 0, PI / 2)
	_put(dh, _disc(0.47, 40), _std(0x6f7786, 0.45, 0.6), 0, 0.27, 0, PI / 2)
	_put(dh, _torus(0.17, 0.018, 8, 28), M.rail, 0, 0.22, 0, PI / 2)
	for a in [0.0, PI / 3, -PI / 3]:
		_put(dh, _box(0.34, 0.015, 0.02), M.steel, 0, 0.225, 0, 0, a)
	var dogs := []
	for k in 8:
		var da := k / 8.0 * TAU
		dogs.append([cos(da) * 0.43, 0.24, sin(da) * 0.43, 0, -da, 0])
	_inst(dh, _box(0.06, 0.03, 0.04), M.steel, dogs)

	# ---- left wall (-x): life support
	var ls := _group(g, -1.98, F, 0.05, PI / 2)
	_put(ls, _box(1.24, 1.72, 0.16), _std(0xc9cdd4, 0.55, 0.2), 0, 1.18, 0.02, 0, 0, 0, true)
	var tank_prof := [Vector2(0, -0.48), Vector2(0.07, -0.47), Vector2(0.115, -0.42), Vector2(0.125, -0.34), Vector2(0.125, 0.34), Vector2(0.115, 0.42), Vector2(0.07, 0.47), Vector2(0, 0.48)]
	for t in [[-0.42, M.tankO, "O₂"], [-0.12, M.tankN, "N₂"]]:
		_put(ls, _lathe(tank_prof, 28), t[1], t[0], 1.12, 0.22, 0, 0, 0, true)
		for yy in [0.82, 1.42]:
			_put(ls, _torus(0.128, 0.012, 6, 28), M.alu, t[0], yy, 0.22, PI / 2)
		_put(ls, _cyl(0.03, 0.03, 0.08, 12), M.steel, t[0], 1.63, 0.22)
		_plate(ls, 0.11, 0.06, 0xf4f5f7, t[2], _c(0x1e2229), t[0], 1.2, 0.347)
		_put(ls, _tube([Vector3(t[0], 1.66, 0.22), Vector3(t[0], 1.78, 0.2), Vector3(t[0] * 0.3 + 0.12, 1.84, 0.17), Vector3(0.18, 1.84, 0.15)], 0.012), M.steel)
	_put(ls, _box(0.34, 0.14, 0.1), M.alu, 0.32, 1.84, 0.14, 0, 0, 0, true)
	for vx in [0.22, 0.42]:
		var v := _group(ls, vx, 1.84, 0.21)
		_put(v, _cyl(0.012, 0.012, 0.05, 8), M.steel, 0, 0, -0.01, PI / 2)
		_put(v, _torus(0.035, 0.008, 6, 20), M.red, 0, 0, 0.02)
		for a in [0.0, PI / 2]:
			_put(v, _box(0.07, 0.006, 0.006), M.red, 0, 0, 0.02, 0, 0, a)
	for gp in [[0.22, 0.75], [0.42, 0.55]]:
		_put(ls, _cyl(0.05, 0.05, 0.03, 24), M.alu, gp[0], 1.58, 0.13, PI / 2)
		var gv: float = gp[1]
		_painted(ls, 0.086, 0.086, 128, 128, func(ci: CanvasItem, w: int, _h: int): _gauge_face(ci, w, "PSI", gv), gp[0], 1.58, 0.146, 0, 0, false, true)
	var cab := _display(ls, 0.36, 0.25, 0.32, 1.28, 0.115, 400, 280, M)
	room.screens.append({ "id": "cabin", "sc": cab })
	_put(ls, _box(0.44, 0.38, 0.04), M.dark, 0.3, 0.72, 0.12, 0, 0, 0, true)
	for bb in [[0.3, 0.895, 0.44, 0.03], [0.3, 0.545, 0.44, 0.03]]:
		_put(ls, _box(bb[2], bb[3], 0.1), M.dark, bb[0], bb[1], 0.16)
	for bb in [[0.095, 0.03], [0.505, 0.03]]:
		_put(ls, _box(bb[1], 0.38, 0.1), M.dark, bb[0], 0.72, 0.16)
	var slats := []
	for k in 7:
		slats.append([0.3, 0.585 + k * 0.045, 0.2, -0.5, 0, 0])
	_inst(ls, _box(0.38, 0.008, 0.035), M.alu, slats)
	var fan := _group(ls, 0.3, 0.72, 0.16)
	for k in 6:
		_put(fan, _box(0.03, 0.15, 0.006), M.steel, sin(k / 6.0 * TAU) * 0.07, cos(k / 6.0 * TAU) * 0.07, 0, 0, 0.3, -k / 6.0 * TAU)
	room.fan = fan
	_plate(ls, 0.3, 0.05, 0x1e2229, "CO₂ SCRUBBER", _c(0x5dff9e), 0.3, 0.97, 0.181)

	# ---- right wall (+x): fabric stowage bags behind a cargo net; the sample case appears when it is loaded
	var sg := _group(g, 1.98, F, 0.05, -PI / 2)
	_put(sg, _box(1.3, 1.9, 0.08), _std(0xb9bec7, 0.6, 0.2), 0, 1.1, -0.02, 0, 0, 0, true)
	var BAGS := [[-0.33, 0.32, 0.58, 0.44, "FOOD"], [0.31, 0.3, 0.6, 0.4, "WATER"], [-0.33, 0.82, 0.58, 0.48, "MEDICAL"], [0.31, 0.78, 0.6, 0.44, "TOOLS"], [-0.33, 1.34, 0.58, 0.46, "SPARES"], [0.31, 1.27, 0.6, 0.44, "CAMERA"], [0, 1.78, 1.2, 0.36, "CLOTHES"]]
	for i in BAGS.size():
		var bg: Array = BAGS[i]
		var depth := 0.26 + (i % 3) * 0.03
		_put(sg, _box(bg[2] - 0.03, bg[3] - 0.03, depth), M.fabric, bg[0], bg[1], depth / 2 + 0.02, 0, 0, 0, true)
		for o in [-0.3, 0.3]:
			_put(sg, _box(0.04, bg[3] - 0.02, 0.008), M.web, bg[0] + o * (bg[2] - 0.1), bg[1], depth + 0.024)
		_plate(sg, 0.2, 0.06, 0xf4efe2, bg[4], _c(0x1e2229), bg[0], bg[1] + 0.05, depth + 0.026, 0, 0, true)
	_painted(sg, 1.24, 1.5, 256, 320, func(ci: CanvasItem, w: int, h: int):
		var x := -h
		while x < w:
			Paint.line(ci, x, 0, x + h, h, Color(0.16, 0.17, 0.2, 0.8), 1.6)
			Paint.line(ci, x + h, 0, x, h, Color(0.16, 0.17, 0.2, 0.8), 1.6)
			x += 38
		Paint.stroke_rect(ci, 4, 4, w - 8, h - 8, Color("#e0742e"), 8), 0, 0.85, 0.355, 0, 0, true, true)
	var cs := _group(g, 1.4, F, 0.1, -PI / 2)
	_put(cs, _box(0.56, 0.34, 0.4), M.alu, 0, 0.17, 0, 0, 0, 0, true)
	for o in [-0.1, 0.1]:
		_put(cs, _box(0.58, 0.022, 0.42), M.steel, 0, 0.17 + o, 0)
	for o in [-0.18, 0.18]:
		_put(cs, _box(0.05, 0.05, 0.02), M.dark, o, 0.29, 0.205)
	_put(cs, _torus(0.06, 0.012, 6, 16, PI), M.dark, 0, 0.34, 0)
	_plate(cs, 0.24, 0.07, 0xe0742e, "SAMPLES", Color.WHITE, 0, 0.15, 0.202)
	cs.visible = false
	room.caseMesh = cs

	# ---- a fire extinguisher by the hatch, the mission patch, the little bear
	var fe := _on_wall(PI * 0.72, RK_R - 0.2, 1.15)
	var fxg := _group(g, fe.x, fe.y, fe.z)
	_put(fxg, _lathe([Vector2(0, -0.22), Vector2(0.06, -0.22), Vector2(0.065, -0.2), Vector2(0.065, 0.16), Vector2(0.045, 0.21), Vector2(0.015, 0.23), Vector2(0, 0.23)], 20), M.red, 0, 0, 0, 0, 0, 0, true)
	_put(fxg, _box(0.05, 0.03, 0.12), M.dark, 0, 0.25, 0.03)
	var patch := _patch(g, 0.5, 1.45, F + 2.35, -1.65, 0)
	room.face_later.append([patch.mesh, Vector3(0, F + 2.35, 0)])
	var plush := _group(g, 0.45, RK_TOP - 1.15, 0.55)
	var fur := _std(0xb98656, 0.95, 0.0)
	_put(plush, _cyl(0.004, 0.004, 1.0, 4), _std(0xffffff, 0.8, 0.0), 0, 0.5, 0)
	_put(plush, _ball(0.13, 16, 12), fur)
	_put(plush, _ball(0.1, 16, 12), fur, 0, 0.17, 0)
	for x in [-0.07, 0.07]:
		_put(plush, _ball(0.04, 8, 6), fur, x, 0.26, 0)
	_put(plush, _ball(0.07, 12, 8), _std(0xffc04d, 0.6, 0.0), 0, 0.01, 0.1)
	room.plush = plush

	# where you cannot walk: couches, the pedestal, the cockpit, the sample case
	room.colliders = [[-0.72, -1.45, 0.38], [-0.72, -0.75, 0.38], [-0.72, 0, 0.33], [0.72, -1.45, 0.38], [0.72, -0.75, 0.38], [0.72, 0, 0.33],
		[0, -0.95, 0.25], [0, 1.78, 0.6], [1.4, 0.1, 0.3]]
	room.spots = [
		{ "id": "hatch", "label": "Climb down the hatch", "x": 0.0, "z": 0.1, "reach": 0.6 },
		{ "id": "seat", "label": "Look at the commander's couch", "x": -0.72, "z": 0.62, "reach": 0.6 },
		{ "id": "panel", "label": "Read the cockpit screens", "x": -0.15, "z": 1.0, "reach": 0.6 },
		{ "id": "abort", "label": "Look at the abort handle", "x": 0.7, "z": 0.95, "reach": 0.45 },
		{ "id": "life", "label": "Check the life support", "x": -1.2, "z": 0.4, "reach": 0.55 },
		{ "id": "stow", "label": "Look in the stowage bags", "x": 1.15, "z": 0.55, "reach": 0.55 },
		{ "id": "plush", "label": "Look at the little bear", "x": 0.55, "z": 0.45, "reach": 0.4 },
	]
	room.spawn = [0.0, 0.35]
	room.face = 0.0          # standing on the hatch, facing the window
	return room


# =====================================================================
#  the cockpit screens: avionics colours, big enough to read
# =====================================================================
const AV := { "bg": "#04070d", "line": "#1b2a40", "cyan": "#5fe3ff", "green": "#5dff9e", "amber": "#ffc04d", "red": "#ff5468", "white": "#e8eefc", "dim": "#7f8db0" }


static func _av(k: String) -> Color:
	return Color(AV[k])


static func _av_frame(ci: CanvasItem, w: float, h: float, title: String, right := "") -> void:
	Paint.rect(ci, 0, 0, w, h, _av("bg"))
	var x := 0.0
	while x < w:
		Paint.line(ci, x, 44, x, h, _av("line"), 1)
		x += 32
	var y := 44.0
	while y < h:
		Paint.line(ci, 0, y, w, y, _av("line"), 1)
		y += 32
	Paint.rect(ci, 0, 0, w, 40, Color("#0b1424"))
	Paint.text(ci, title, 16, 21, 22, _av("cyan"), "left", 700, "exo2")
	if right != "":
		Paint.text(ci, right, w - 14, 21, 16, _av("dim"), "right", 600, "mono")


func _draw_fuel(ci: CanvasItem, w: float, h: float, info: Dictionary) -> void:
	var mars: bool = info.site == "mars"
	var full: bool = info.fuel >= 100
	_av_frame(ci, w, h, "PROPELLANT", "FULL" if full else "LOADING")
	var tanks := [["LOX", "oxygen"], ["CH₄" if mars else "LH₂", "methane" if mars else "hydrogen"]]
	for i in 2:
		var x := 70.0 + i * 120
		var top := 70.0
		var bh := h - 150
		Paint.rrect(ci, x - 30, top, 60, bh, 10, _av("dim"), 2)
		var fh: float = (bh - 8) * info.fuel / 100.0
		Paint.vgrad(ci, x - 26, top + bh - 4 - maxf(6, fh), 52, maxf(6, fh), _av("green") if full else _av("amber"), Color("#1d8f57") if full else Color("#8a6514"))
		for k in range(1, 4):
			Paint.rect(ci, x + 32, top + bh * k / 4, 8, 2, _av("dim"))
		Paint.text(ci, tanks[i][0], x, top + bh + 22, 20, _av("white"), "center", 700, "mono")
		Paint.text(ci, tanks[i][1], x, top + bh + 44, 14, _av("dim"), "center", 600)
	Paint.text(ci, str(info.fuel) + "%", w * 0.73, h * 0.42, 64, _av("green") if full else _av("amber"), "center", 700, "mono")
	Paint.text(ci, "oxygen made from" if mars else "made from", w * 0.73, h * 0.62, 17, _av("white"))
	Paint.text(ci, "Mars air" if mars else "polar ice", w * 0.73, h * 0.62 + 22, 17, _av("white"))
	Paint.text(ci, "tanks full: go" if full else "full on launch day", w * 0.73, h * 0.85, 15, _av("dim"))


## where Earth and Mars are on a real date (mean orbits), for the course map
static func _planets_on(date: String) -> Dictionary:
	var unix := Time.get_unix_time_from_datetime_string(date + "T12:00:00")
	var d := (unix - 946728000.0) / 86400.0
	var p := func(L0: float, rate: float, peri: float, a: float, e: float) -> Dictionary:
		var M := deg_to_rad(L0 + rate * d - peri)
		var v := M + 2 * e * sin(M)
		return { "r": a * (1 - e * e) / (1 + e * cos(v)), "lon": v + deg_to_rad(peri) }
	return { "earth": p.call(100.46, 0.98564736, 102.94, 1.0, 0.0167), "mars": p.call(355.45, 0.52402075, 336.04, 1.5237, 0.0934) }


func _draw_course(ci: CanvasItem, w: float, h: float, info: Dictionary) -> void:
	_av_frame(ci, w, h, "COURSE HOME", str(info.get("date", "")))
	var cx := w * 0.36
	var cy := h * 0.56
	if info.site == "mars" and info.get("date"):
		var P := _planets_on(info.date)
		var k := 72.0
		Paint.circle(ci, cx, cy, k, _av("line"), 2)
		Paint.circle(ci, cx, cy, k * 1.52, _av("line"), 2)
		Paint.radial(ci, cx, cy, 18, [[0.0, Color("#fff6c8")], [1.0, Color(1, 0.67, 0.24, 0)]])
		var ex: float = cx + cos(P.earth.lon) * k * P.earth.r
		var ey: float = cy - sin(P.earth.lon) * k * P.earth.r
		var mx: float = cx + cos(P.mars.lon) * k * P.mars.r
		var my: float = cy - sin(P.mars.lon) * k * P.mars.r
		Paint.dashed(ci, mx, my, ex, ey, _av("amber"), 2)
		Paint.circle(ci, ex, ey, 8, Color("#4aa3ff"))
		Paint.circle(ci, mx, my, 7, Color("#d9774a"))
		Paint.text(ci, "Earth", ex, ey - 16, 14, _av("white"))
		Paint.text(ci, "you", mx, my + 18, 14, _av("white"))
	else:
		var pts := PackedVector2Array()
		for i in 21:
			var t := i / 20.0
			var a := Vector2(cx - 90, cy + 40)
			var b := Vector2(cx, cy - 70)
			var c := Vector2(cx + 90, cy - 10)
			pts.append(a.lerp(b, t).lerp(b.lerp(c, t), t))
		for i in range(0, 20, 2):
			Paint.line(ci, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, _av("amber"), 2)
		Paint.circle(ci, cx - 90, cy + 40, 10, Color("#b9bac6"))
		Paint.circle(ci, cx + 90, cy - 10, 22, Color("#4aa3ff"))
		Paint.ellipse(ci, cx + 84, cy - 16, 9, 6, Color("#5fbf6a"))
		Paint.text(ci, "you", cx - 90, cy + 66, 14, _av("white"))
		Paint.text(ci, "Earth", cx + 90, cy + 26, 14, _av("white"))
	var rows := [["DIST", info.km], ["RADIO", str(info.oneWay) + " one way"], ["TRIP", info.trip]]
	for i in rows.size():
		var y := 86.0 + i * 70
		Paint.text(ci, rows[i][0], w * 0.64, y, 15, _av("dim"), "left", 600, "mono")
		Paint.text(ci, str(rows[i][1]), w * 0.64, y + 26, 21, _av("white"), "left", 700, "lexend", w * 0.34)


func _draw_launch(ci: CanvasItem, w: float, h: float, info: Dictionary) -> void:
	_av_frame(ci, w, h, "LAUNCH", "GO" if info.ready else "HOLD")
	if info.ready:
		Paint.text(ci, "GO", w / 2, 112, 72, _av("green"), "center", 700, "mono")
		var rows := [["crew aboard", true], ["samples " + ("loaded" if info.caseLoaded else "NOT loaded"), info.caseLoaded], ["propellant full", true]]
		for i in rows.size():
			Paint.text(ci, ("✔ " if rows[i][1] else "✖ ") + rows[i][0], w * 0.18, 186 + i * 40, 22, _av("green") if rows[i][1] else _av("red"), "left", 700)
	else:
		Paint.text(ci, "T MINUS", w / 2, 82, 18, _av("dim"), "center", 600, "mono")
		Paint.text(ci, str(info.left), w / 2, 148, 70, _av("amber"), "center", 700, "mono")
		Paint.text(ci, (str(info.dayWord) + ("" if info.left == 1 else "s")).to_upper(), w / 2, 200, 24, _av("white"), "center", 700)
		Paint.text(ci, "keep the crew safe until launch day", w / 2, 262, 16, _av("dim"))


func _draw_annun(ci: CanvasItem, w: float, h: float, info: Dictionary) -> void:
	Paint.rect(ci, 0, 0, w, h, Color("#0a0d13"))
	var storm: String = info.storm
	var lamps := [["PROP", "g" if info.fuel >= 100 else "a"], ["MAIN BUS", "g"], ["CABIN P", "g"], ["COMM", "g" if info.comms else "a"],
		["RAD", "r" if storm == "active" else ("a" if storm == "warning" else "g")], ["SAMPLES", "g" if info.caseLoaded else "a"]]
	var cols := { "g": _av("green"), "a": _av("amber"), "r": _av("red") }
	var lw := w / lamps.size()
	for k in lamps.size():
		var x := k * lw
		Paint.rrect(ci, x + 4, 4, lw - 8, h - 8, 5, Color("#141922"))
		var cc: Color = cols[lamps[k][1]]
		Paint.vgrad(ci, x + 8, 8, lw - 16, h - 16, Color(cc, 0.85), Color(cc.darkened(0.6), 0.85))
		Paint.text(ci, lamps[k][0], x + lw / 2, h / 2 + 1, 17, Color("#05070b"), "center", 700, "mono", lw - 20)


func _draw_cabin(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	_av_frame(ci, w, h, "CABIN AIR", "SEALED")
	var gases := [["O₂", 21, _av("cyan")], ["N₂", 78, _av("dim")]]
	for i in 2:
		var y := 78.0 + i * 58
		Paint.text(ci, gases[i][0], 16, y, 20, _av("white"), "left", 700, "mono")
		Paint.text(ci, "~" + str(gases[i][1]) + "%", w - 16, y, 20, _av("white"), "right", 700, "mono")
		Paint.rect(ci, 16, y + 16, w - 32, 12, Color("#132036"))
		Paint.rect(ci, 16, y + 16, (w - 32) * gases[i][1] / 100.0, 12, gases[i][2])
	Paint.text(ci, "CO₂ SCRUB", 16, 214, 18, _av("white"), "left", 700, "mono")
	for k in 8:
		Paint.circle(ci, w - 150 + k * 18, 214, 6, _av("green") if int(floor(clock * 4)) % 8 == k else Color("#123322"))
	Paint.text(ci, "outside: thin CO₂ air" if s.site.id == "mars" else "outside: no air at all", 16, 250, 15, _av("dim"), "left")


func _ascent_panel(ci: CanvasItem, w: float, h: float) -> void:
	_av_frame(ci, w, h, "ASCENT", "GUIDANCE x3")
	var cx := w * 0.2
	var cy := h * 0.58
	var r := h * 0.33
	# the attitude ball: sky above the horizon, ground below
	var sky := PackedVector2Array()
	var ground := PackedVector2Array()
	for i in 25:
		var a: float = PI + float(i) / 24 * PI
		sky.append(Vector2(cx + cos(a) * r, cy + sin(a) * r))
		ground.append(Vector2(cx + cos(a - PI) * r, cy + sin(a - PI) * r))
	ci.draw_colored_polygon(sky, Color("#2f62c8"))
	ci.draw_colored_polygon(ground, Color("#8a4428") if site == "mars" else Color("#55565f"))
	for k in [-2, -1, 1, 2]:
		Paint.line(ci, cx - 16, cy + k * 18, cx + 16, cy + k * 18, Color.WHITE, 2)
	Paint.circle(ci, cx, cy, r, _av("dim"), 3)
	Paint.rect(ci, cx - 36, cy - 3, 26, 6, _av("amber"))
	Paint.rect(ci, cx + 10, cy - 3, 26, 6, _av("amber"))
	Paint.rect(ci, cx - 3, cy - 3, 6, 6, _av("amber"))
	var rows := [["ENGINE", "READY", _av("green")], ["GUIDANCE", "3 COMPUTERS", _av("green")], ["TARGET", ("MARS" if site == "mars" else "MOON") + " ORBIT", _av("white")], ["CREW", "2", _av("white")]]
	for i in rows.size():
		Paint.text(ci, rows[i][0], w * 0.42, 74 + i * 34, 17, _av("dim"), "left", 600, "mono")
		Paint.text(ci, rows[i][1], w * 0.66, 74 + i * 34, 17, rows[i][2], "left", 600, "mono")


static func _gauge_face(ci: CanvasItem, w: float, label: String, val: float) -> void:
	var c := w / 2
	Paint.circle(ci, c, c, c - 2, Color("#f2f3f5"))
	for k in 11:
		var a := PI * 0.75 + k / 10.0 * PI * 1.5
		Paint.line(ci, c + cos(a) * c * 0.72, c + sin(a) * c * 0.72, c + cos(a) * c * 0.88, c + sin(a) * c * 0.88, Color("#2a2e36"), 3)
	Paint.arc(ci, c, c, c * 0.8, PI * 1.65, PI * 2.1, Color("#2fbf6a"), 8)
	var na := PI * 0.75 + val * PI * 1.5
	Paint.line(ci, c, c, c + cos(na) * c * 0.75, c + sin(na) * c * 0.75, Color("#dd2222"), 4)
	Paint.circle(ci, c, c, 6, Color("#2a2e36"))
	Paint.text(ci, label, c, c * 1.45, 16, Color("#2a2e36"), "center", 700, "mono")


## What the cockpit screens show right now.
func _panel_info(s: Dictionary) -> Dictionary:
	var last: bool = s.sol >= s.totalSols
	var D: float = maxf(1, float(s.get("dayLength", 1)))
	var fuel := 100 if last else clampi(roundi(100 * ((s.sol - 1) + s.t / D) / maxf(1, s.totalSols - 1)), 0, 99)
	var wx: Dictionary = Sim.weather(s)
	var date: String = str(wx.get("date")) if wx.get("date") else Time.get_date_string_from_system()
	var km: String
	var one_way: String
	var trip: String
	if s.site.id == "mars":
		var mins: float = Weather.mars_delay_min(date)
		km = str(roundi(mins * 60 * 299792.458 / 1e6)) + " million km"
		one_way = str(roundi(mins)) + " min"
		trip = "about 7 months"
	else:
		km = "384,400 km"
		one_way = "1.3 s"
		trip = "about 3 days"
	var comms = s.get("m", {}).get("comms", {}).get("on", false)
	return { "site": s.site.id, "date": date, "fuel": fuel, "ready": last, "left": s.totalSols - s.sol, "dayWord": s.site.dayWord, "km": km, "oneWay": one_way, "trip": trip,
		"caseLoaded": true if s.get("caseLoaded") else false, "comms": true if comms else false, "storm": Sim.storm_phase(s) }


# ---------- the habitat screens without Mission Control (the mission add-on draws its own) ----------
func _draw_status(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	Paint.rect(ci, 0, 0, w, h, Color("#0b1424"))
	Paint.text(ci, "OUTPOST STATUS", 24, 34, 30, Color("#4fd8ff"), "left", 700, "exo2")
	Paint.text(ci, str(s.site.dayWord) + " " + str(s.sol) + " of " + str(s.totalSols), w - 24, 34, 24, Color("#b3bde0"), "right")
	var rows := [["AIR", s.air, Color("#4fd8ff")], ["FOOD", s.food, Color("#7be36a")], ["RADIATION", s.dose, Color("#ff6fb1")]]
	for i in rows.size():
		var y := 96.0 + i * 72
		var v := clampf(rows[i][1], 0, 100)
		Paint.text(ci, rows[i][0], 24, y, 24, Color.WHITE, "left")
		Paint.text(ci, str(roundi(rows[i][1])) + ("%" if i == 2 else ""), w - 24, y, 24, Color.WHITE, "right")
		Paint.rrect(ci, 24, y + 18, w - 48, 18, 9, Color("#1e2a44"))
		Paint.rrect(ci, 24, y + 18, maxf(18, (w - 48) * v / 100), 18, 9, rows[i][2])


func _draw_earth(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	Paint.rect(ci, 0, 0, w, h, Color("#020611"))
	for k in 60:
		Paint.rect(ci, (k * 97) % int(w), (k * 53) % int(h), 2, 2, Color(1, 1, 1, 0.3 + (k * 37 % 7) / 10.0))
	var cx := w * 0.32
	var cy := h * 0.55
	var r := h * 0.3
	Paint.radial(ci, cx, cy, r, [[0.0, Color("#7cc4ff")], [1.0, Color("#1d4fa8")]])
	Paint.ellipse(ci, cx - r * 0.25, cy - r * 0.1, r * 0.35, r * 0.22, Color("#5fbf6a"))
	Paint.ellipse(ci, cx + r * 0.3, cy + r * 0.3, r * 0.25, r * 0.18, Color("#5fbf6a"))
	Paint.ellipse(ci, cx + r * 0.1, cy - r * 0.55, r * 0.5, r * 0.12, Color(1, 1, 1, 0.8))
	Paint.text(ci, "EARTH", w * 0.6, h * 0.36, 30, Color.WHITE, "left", 700, "exo2")
	var info: Dictionary = Sim.comm_info(s)
	Paint.text(ci, "radio: " + str(info.get("oneWay", "?")), w * 0.6, h * 0.52, 22, Color("#b3bde0"), "left")
	Paint.text(ci, "dish ON" if s.m.comms.on else "dish off", w * 0.6, h * 0.66, 22, Color("#b3bde0"), "left")


func _draw_sun(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	Paint.rect(ci, 0, 0, w, h, Color("#1a0b16"))
	var cx := w * 0.26
	var cy := h * 0.55
	var r := h * 0.24
	Paint.radial(ci, cx, cy, r * 1.6, [[0.0, Color("#fff6c8")], [0.45, Color("#ffb347")], [1.0, Color(1, 0.35, 0.16, 0)]])
	var wx: Dictionary = Sim.weather(s)
	var ph: String = Sim.storm_phase(s)
	Paint.text(ci, "SPACE WEATHER", w * 0.48, h * 0.24, 28, Color("#ffd23f"), "left", 700, "exo2")
	var known: bool = s.get("forecast") or ph != "none"
	var txt := "STORM NOW!" if ph == "active" else ("STORM COMING" if ph == "warning" else (((("CME shock today" if wx.get("cause") == "cme" else "particle storm today") if wx.get("level") else "quiet Sun")) if known else "no forecast"))
	Paint.text(ci, txt, w * 0.48, h * 0.48, 24, Color.WHITE, "left", 600, "lexend", w * 0.5)
	Paint.text(ci, "Use me: Sun Watch", w * 0.48, h * 0.72, 20, Color("#b3bde0"), "left")


# =====================================================================
#  build, enter, leave
# =====================================================================
func build(root: Node3D, site_id: String) -> void:
	site = site_id
	rooms = {}
	current = null
	used = {}
	_geo = {}
	if _screens_holder and is_instance_valid(_screens_holder):
		_screens_holder.queue_free()
	_screens_holder = Node.new()
	_screens_holder.name = "InteriorScreens"
	add_child(_screens_holder)
	var P: Dictionary = Base.P
	if not P.get("hab") or not P.hab.get("group") or not P.get("rocket") or not P.rocket.get("group"):
		return
	rooms.hab = _build_hab(P.hab.group)
	rooms.rocket = _build_rocket(P.rocket.group)
	for fl in rooms.rocket.get("face_later", []):
		var node: Node3D = fl[0]
		if node.is_inside_tree():
			node.look_at(rooms.rocket.group.to_global(fl[1]), Vector3.UP, true)     # +z faces the point, like three.js lookAt
	light = OmniLight3D.new()
	light.light_energy = 0.0
	light.omni_range = 11.0
	light.omni_attenuation = 1.0
	light.shadow_enabled = false
	root.add_child(light)
	blob = MeshInstance3D.new()
	blob.mesh = _disc(0.5, 20)
	var bm := StandardMaterial3D.new()
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.albedo_color = Color(0, 0, 0, 0.32)
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	blob.material_override = bm
	blob.rotation.x = -PI / 2
	blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	blob.visible = false
	root.add_child(blob)
	_built_for = root


func _ensure() -> void:
	if World.root and _built_for != World.root:
		build(World.root, World.site_id)


## world position of a point given in a room's own coordinates
static func _to_world(room: Dictionary, x: float, y: float, z: float) -> Vector3:
	return (room.group as Node3D).get_parent().to_global(Vector3(x, y, z))


## Go in. Returns everything the game needs: the walking room, the camera room, where to stand, which way to face.
func enter(id: String):
	_ensure()
	var room = rooms.get(id)
	if room == null:
		return null
	current = room
	room.group.visible = true
	var P: Dictionary = Base.P
	for w in (P.hab.windows if id == "hab" else P.rocket.windows):
		w.visible = false
	var F := HAB_FLOOR if id == "hab" else RK_FLOOR
	var R := HAB_R if id == "hab" else RK_R
	var c := _to_world(room, 0, F, 0)
	var cols := []
	for k in room.colliders:
		var p := _to_world(room, k[0], F, k[1])
		cols.append({ "x": p.x, "z": p.z, "r": k[2] })
	var walk := { "cx": c.x, "cz": c.z, "r": 4.0 if id == "hab" else 1.95, "floor": c.y, "colliders": cols }
	if id == "hab":
		walk.ceil = func(x: float, z: float) -> float:
			var d := Vector2(x - c.x, z - c.z).length()
			return c.y + sqrt(maxf(0, R * R - d * d)) - 2.1
	else:
		walk.ceil = func(_x: float, _z: float) -> float: return c.y + (RK_TOP - RK_FLOOR) - 2.1
	var cam := { "type": "dome", "cx": c.x, "cy": c.y, "cz": c.z, "r": R - 0.35, "floor": c.y + 0.35 } if id == "hab" \
		else { "type": "cyl", "cx": c.x, "cy": c.y, "cz": c.z, "r": RK_R - 0.3, "floor": c.y + 0.35, "top": c.y + (RK_TOP - RK_FLOOR) - 0.3 }
	var spawn := _to_world(room, room.spawn[0], F, room.spawn[1])
	# which way "facing into the room" is, in the world
	var ahead := _to_world(room, room.spawn[0], F, room.spawn[1] + (-1.0 if room.face == PI else 1.0)) - spawn
	var yaw := atan2(ahead.x, ahead.z)
	light.position = c + Vector3(0, 3.9 if id == "hab" else 3.8 - 1.2, 0)     # the cabin: a lower, softer light, no glare off the ceiling
	light.light_energy = 1.25 if id == "hab" else 0.55
	light.omni_range = 11.0 if id == "hab" else 6.0
	light.light_color = Color("#fff1dd") if id == "hab" else Color("#eef3ff")
	for sc in room.screens:
		sc.nextAt = 0.0
	redraw_at = 0.0
	return { "walk": walk, "cam": cam, "spawn": spawn, "yaw": yaw, "center": c }


func leave() -> void:
	var P: Dictionary = Base.P
	for k in rooms:
		if is_instance_valid(rooms[k].group):
			rooms[k].group.visible = false
	for b in ["hab", "rocket"]:
		if P.get(b) and P[b].get("windows"):
			for w in P[b].windows:
				if is_instance_valid(w):
					w.visible = true
	if light:
		light.light_energy = 0.0
	if blob:
		blob.visible = false
	current = null


## The things you can walk up to in the room you are in, in world coordinates.
func spots() -> Array:
	if current == null:
		return []
	var F := HAB_FLOOR if current.id == "hab" else RK_FLOOR
	var out := []
	for sp in current.spots:
		var p := _to_world(current, sp.x, F, sp.z)
		out.append({ "id": sp.id, "label": sp.label, "x": p.x, "z": p.z, "reach": sp.reach })
	return out


## Something to do when you use a spot (the bike pedals, the bear spins).
func poke(id: String) -> void:
	if current == null:
		return
	if id == "bike":
		current.pedal = 3.0
	if id == "plush" and current.get("plush"):
		current.plushSpin = 2.5
	used[id] = true


## The cutaway camera: where it stands and what it looks at, in world coordinates (habitat only).
func console_view():
	if current == null or not current.get("view"):
		return null
	var v: Dictionary = current.view
	return { "pos": _to_world(current, v.pos[0], v.pos[1], v.pos[2]), "look": _to_world(current, v.look[0], v.look[1], v.look[2]) }


# =====================================================================
#  every frame. ctx: { s, astro }
# =====================================================================
func update(dt: float, ctx: Dictionary) -> void:
	var room = current
	if room == null:
		return
	clock += dt
	var a = ctx.get("astro")
	var s = ctx.get("s")
	if a and blob:
		var F := HAB_FLOOR if room.id == "hab" else RK_FLOOR
		var floor_y := _to_world(room, 0, F, 0).y
		var up := maxf(0, a.pos.y - floor_y)
		blob.visible = a.mode != "hidden"
		blob.position = Vector3(a.pos.x, floor_y + 0.025, a.pos.z)
		blob.scale = Vector3.ONE * maxf(0.35, 1 - up * 0.25)
		(blob.material_override as StandardMaterial3D).albedo_color.a = maxf(0.08, 0.32 - up * 0.08)
	if room.get("wheel"):
		room.pedal = maxf(0, room.get("pedal", 0.0) - dt)
		room.wheel.rotation.z += dt * (9.0 if room.pedal > 0 else 0.0)
	for p in room.spin:
		p.m.rotation.z = sin(clock * 0.8 + p.k) * 0.05
	if room.get("plush"):
		room.plushSpin = maxf(0, room.get("plushSpin", 0.0) - dt)
		room.plush.rotation.z = sin(clock * 1.3) * 0.06
		room.plush.rotation.y += dt * (6.0 if room.plushSpin > 0 else 0.2)
	if room.get("doorLight"):
		(room.doorLight.material_override as StandardMaterial3D).emission_energy_multiplier = 1.6 + sin(clock * 3) * 0.4
	if room.get("fan"):
		room.fan.rotation.z += dt * 7                               # the CO2 scrubber fan
	if room.get("abort"):
		(room.abort.material_override as StandardMaterial3D).emission_energy_multiplier = 0.6 + sin(clock * 2.5) * 0.2
	if room.get("caseMesh") and s:
		room.caseMesh.visible = true if s.get("caseLoaded") else false     # the sample case, once it is on board
	if room.get("drum"):
		room.drum.rotation.x += dt * 0.6
	if s == null:
		return
	# ---- the habitat answers the state of the outpost: alarm beacon, light, switch-panel lamps, the screens
	var mc := Game.has_addon("mission")
	if room.id == "hab":
		var al = Game.ext("mission", "alert", [s]) if mc else null
		var pw = Game.ext("mission", "power", [s]) if mc else null
		var lvl: int = int(al.get("lvl", 0)) if al else 0
		if room.get("alarm"):
			room.alarm.rotation.y += dt * (6.0 if lvl == 2 else 0.0)
			(room.alarm.material_override as StandardMaterial3D).emission_energy_multiplier = (1.2 + sin(clock * 9) * 1.0) if lvl == 2 else ((0.5 + sin(clock * 2.5) * 0.3) if lvl == 1 else 0.05)
		if light:
			var want := 1.25 * (0.55 if pw and pw.get("low") else 1.0)
			var lc := Color("#ffb0a8") if lvl == 2 else (Color("#fff0c8") if lvl == 1 else Color("#fff1dd"))
			light.light_energy += (want - light.light_energy) * minf(1, dt * 2)
			light.light_color = light.light_color.lerp(lc, minf(1, dt * 2))
		if clock >= room.get("ledAt", 0.0):
			room.ledAt = clock + 0.5
			var m: Dictionary = s.m
			for L in room.leds:
				var on := false
				match L.id:
					"air": on = m.air.power > 0
					"food": on = m.food.lamp > 0
					"lab": on = m.lab.power > 0
					"bag": on = m.bag.pending > 0
					"comms": on = true if m.comms.on else false
					_: on = m.rover.charge > 5
				(L.m.material_override as StandardMaterial3D).emission_energy_multiplier = 1.4 if on else 0.12
			if room.get("scrubLed"):
				var stale := Sim.stale(s) > 1
				var sm := room.scrubLed.material_override as StandardMaterial3D
				sm.emission = _c(0xff5468 if stale else 0x4dff9a)
				sm.albedo_color = sm.emission
		for sc in room.screens:
			if clock < sc.get("nextAt", 0.0):
				continue
			sc.nextAt = clock + sc.get("every", 1.0)
			var sid: String = sc.id
			var ss: Dictionary = s
			var t := clock
			if mc:
				Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): Game.ext("mission", "screen", [sid, ci, w, h, ss, t]))
			elif sid == "power" or sid == "life":
				Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_status(ci, w, h, ss))
			elif sid == "main":
				Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_earth(ci, w, h, ss))
			else:
				Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_sun(ci, w, h, ss))
		return
	if clock < redraw_at:
		return
	redraw_at = clock + 1
	var info := _panel_info(s)
	var ss2: Dictionary = s
	for sc in room.screens:
		match sc.id:
			"rk-fuel": Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_fuel(ci, w, h, info))
			"rk-course": Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_course(ci, w, h, info))
			"rk-launch": Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_launch(ci, w, h, info))
			"rk-annun": Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_annun(ci, w, h, info))
			"cabin": Paint.redraw(sc.sc, func(ci: CanvasItem, w: int, h: int): _draw_cabin(ci, w, h, ss2))
