extends Node3D
## Astro Outpost — the 3D world: sky, Sun, ground, rocks, particles, bootprints and the camera.
## A port of js/world.js (autoload "World"). The game calls World.build(site) for each mission and World.update(dt)
## every frame. Godot adjustments: the sky, the stars and the Sun's glow are one sky shader (which also lights the
## scene like the web version's hemisphere light); Earth is painted by a shader instead of on a canvas; particles and
## bootprints are MultiMeshes.

const LOOKS := {
	"moon": { "ground": 0x8b8c96, "ground2": 0x5f606b, "rock": 0x8a8b95, "mountain": 0x4d4e58, "range": 0x7d7e88, "sunColor": 0xffffff, "sunInt": 1.65,
		"hemiSky": 0x9fb2d8, "hemiGround": 0x34353f, "hemiInt": 0.4, "fog": -1, "zenith": 0x000003, "horizon": 0x04050a, "glow": 0xffffff, "sunSize": 330,
		"dust": 0xb8b9c4 },
	"mars": { "ground": 0xc8703f, "ground2": 0x9a4a2a, "rock": 0x9c5536, "mountain": 0x8a4526, "range": 0xa5562f, "sunColor": 0xfff1df, "sunInt": 1.25,
		"hemiSky": 0xf5d1a8, "hemiGround": 0x7a3b22, "hemiInt": 0.66, "fog": 0xdcab78, "zenith": 0xa8734a, "horizon": 0xe6bc8c, "glow": 0xfff0d0, "sunSize": 210,
		"dust": 0xd9a070 },
	# the planets after Mars: only what differs from the world they are built on (Data.PLANET_ORDER)
	"europa": { "ground": 0xbfdcf5, "ground2": 0x7da4cb, "rock": 0xa5c6e2, "mountain": 0x47648a, "range": 0x86acd2, "sunColor": 0xeaf4ff, "sunInt": 1.35,
		"hemiSky": 0xa9ccf5, "hemiGround": 0x3f5876, "sunSize": 150, "dust": 0xe6f2fc, "earth": false },
	"titan": { "ground": 0x8a6b3c, "ground2": 0x5c4526, "rock": 0x7a6a55, "mountain": 0x4f3a1e, "range": 0x6e5229, "sunColor": 0xffc27a, "sunInt": 0.9,
		"hemiSky": 0xd9963f, "hemiGround": 0x4a3414, "hemiInt": 0.62, "fog": 0xb07a2e, "zenith": 0x7a5216, "horizon": 0xc48a35, "glow": 0xffcf8a, "sunSize": 120,
		"dust": 0x9a7a45 },
	"io": { "ground": 0xc9b03c, "ground2": 0xa5672a, "rock": 0x8f7a35, "mountain": 0x4d4420, "range": 0x9a8632,
		"hemiSky": 0xd8c79a, "hemiGround": 0x4a3d18, "sunSize": 150, "dust": 0xd9c45a, "earth": false },
	# Sahrun, the made-up desert planet of the web version: its colours there (js/world.js), on the Mars world
	"sahrun": { "ground": 0xd9a35b, "ground2": 0xb57a3c, "rock": 0xb07a4a, "mountain": 0x9a6438, "range": 0xc89058, "sunColor": 0xffd29a, "sunInt": 1.3,
		"hemiSky": 0x86b0c6, "hemiGround": 0x8a5a30, "hemiInt": 0.55, "fog": 0xe6c894, "zenith": 0x2466a0, "horizon": 0xf2c682, "glow": 0xffcf8a, "sunSize": 280,
		"dust": 0xe8c48a, "volcano": false }
}
const EARTH_DIR := Vector3(-0.5, 0.2, -0.84)
const PN := 2400          # particles
const FN := 500           # bootprints

var site_id := "mars"
var look: Dictionary = LOOKS.mars
var gravity := 3.71
## crew mode (scripts/addons/crew.gd): every burst of sparks is also shown on the crewmates' screens
var relay := Callable()
var time := 0.0
var ready_ok := false
var sun_dir := Vector3(0.4, 0.5, 0.7).normalized()
var env := { "t": 0.25, "dust": 0.0, "dustShown": 0.0, "storm": 0.0, "stormShown": 0.0, "dark": 0.0 }
## the camera: yaw/pitch/dist orbit the target; modes title, play, inside, fixed, cine
var cam := { "yaw": 0.0, "pitch": 0.4, "dist": 11.0, "mode": "title", "pos": Vector3(0, 24, 60), "look": Vector3(0, 3, 0),
	"target": Vector3(0, 2, 8), "shake": 0.0, "focus": Callable(), "fixed": null, "fp": false, "fpPitch": 0.06, "eye": Callable(),
	"cine": { "pos": Vector3.ZERO, "look": Vector3.ZERO, "fov": 52.0, "roll": 0.0 }, "room": null }
var no_draw := false

var root: Node3D
var camera: Camera3D
var environment: Environment
var sky_mat: ShaderMaterial
var sun: DirectionalLight3D
var lamp: SpotLight3D
var earth: MeshInstance3D
var phobos: MeshInstance3D
var seat_rock: Node3D
var boulder_nodes: Array = []
var _ground_mat: ShaderMaterial

# particles
var _pmm: MultiMesh
var _pbuf := PackedFloat32Array()
var _ppos := PackedVector3Array()
var _pvel := PackedVector3Array()
var _pcol := PackedColorArray()
var _plife := PackedFloat32Array()
var _pmax := PackedFloat32Array()
var _pgrav := PackedFloat32Array()
var _ps0 := PackedFloat32Array()
var _ps1 := PackedFloat32Array()
var _pa0 := PackedFloat32Array()
var _pnext := 0
var _plive := 0
# bootprints
var _fmm: MultiMesh
var _fnext := 0
# sky events (meteors on Mars, impact flashes on the Moon)
var _sev := { "next": 8.0, "list": [] }
var _glow_tex: Texture2D


func _ready() -> void:
	camera = Camera3D.new()
	camera.fov = 52
	camera.near = 0.4
	camera.far = 6000
	camera.current = true
	add_child(camera)
	var we := WorldEnvironment.new()
	environment = Environment.new()
	environment.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = load("res://scripts/world/sky.gdshader")
	sky.sky_material = sky_mat
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	environment.glow_enabled = true
	environment.glow_intensity = 0.5
	environment.glow_bloom = 0.04
	environment.glow_hdr_threshold = 1.0
	environment.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	environment.set_glow_level(1, 1.0)
	environment.set_glow_level(3, 1.0)
	environment.set_glow_level(5, 0.6)
	environment.fog_sky_affect = 0.0
	we.environment = environment
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 140
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	add_child(sun)
	lamp = SpotLight3D.new()
	lamp.light_color = Mats.lin(0xdfeeff)
	lamp.light_energy = 0
	lamp.spot_range = 34
	lamp.spot_angle = rad_to_deg(0.62)
	lamp.spot_angle_attenuation = 0.55
	lamp.spot_attenuation = 1.2
	add_child(lamp)
	_glow_tex = _radial_texture(64, [[0.0, Color(1, 1, 1, 1)], [0.2, Color(1, 0.97, 0.9, 0.7)], [1.0, Color(1, 0.94, 0.82, 0)]])
	_build_particles()
	_build_prints()
	ready_ok = true


# ---------- building a mission's world ----------
func build(site: String) -> void:
	if root:
		root.queue_free()
	var P: Dictionary = Data.SITES[site]
	site_id = P.id               # the world this planet is built on: "moon" or "mars" (see Data.PLANET_ORDER)
	_deep = null                 # the deep sky lived under the old root
	_e_star = null
	_e_moon = null
	_deimos = null
	_obs_k = 0.0
	_sev.list = []
	look = LOOKS[site_id].merged(LOOKS.get(site, {}), true)
	gravity = P.gravity
	Terrain.set_site(site_id)
	root = Node3D.new()
	root.name = "SiteRoot"
	add_child(root)
	_build_ground()
	_build_sky()
	_reset_particles()
	_reset_prints()
	env.dust = 0.0
	env.dustShown = 0.0
	env.storm = 0.0
	env.stormShown = 0.0


## a colour from the web version's tables, as Godot needs it (see Mats.lin)
static func c(hex: int) -> Color:
	return Mats.lin(hex)


## the same hex as a raw linear value (for shaders that do their own maths, like three.js did)
static func raw(hex: int) -> Vector3:
	var col := Color.hex((hex << 8) | 0xFF)
	return Vector3(col.r, col.g, col.b)


static func _lerp_col(a: Vector3, b: Vector3, t: float) -> Vector3:
	return a + (b - a) * t


# ---------- ground ----------
func _ground_color(x: float, z: float, h: float) -> Vector3:
	var n := clampf(Terrain.noise(x * 0.06 + 9, z * 0.06 + 3) * 0.75 + Terrain.noise(x * 0.33, z * 0.33) * 0.4, 0, 1)
	var out := _lerp_col(raw(look.ground), raw(look.ground2), n)
	var L: Dictionary = Terrain.L
	var r := sqrt(x * x + z * z)
	out *= 1 - (1 - Terrain.smooth(26, 34, r)) * 0.1                      # packed-down base area
	var di := Vector2(x - L.ice.x, z - L.ice.y).length() / Terrain.ice_r
	var d: float
	if site_id == "moon":
		for i in range(1, Terrain.craters.size()):
			var cr: Dictionary = Terrain.craters[i]
			var cdx: float = x - cr.x
			var cdz: float = z - cr.z
			var d2 := cdx * cdx + cdz * cdz
			if d2 > cr.r * cr.r * 2.25:
				continue
			d = sqrt(d2) / cr.r
			if d < 1:
				out *= 0.82 + 0.18 * d
			elif d < 1.5:
				out *= 1 + (1.5 - d) * 0.16
		if di < 1:
			out = _lerp_col(out, raw(0x39445c), (1 - di) * 0.9)
			if di < 0.55:
				out = _lerp_col(out, raw(0xc4dcf2), clampf(Terrain.noise(x * 0.3, z * 0.3) * 1.7 - 0.75, 0, 1) * 0.8)
		d = Vector2(x - L.geo[1].x, z - L.geo[1].y).length()
		if d < 11:
			out = _lerp_col(out, raw(0xd98a3a), (1 - d / 11) * clampf(Terrain.noise(x * 0.5, z * 0.5) * 1.6 - 0.2, 0, 1))
	else:
		d = Vector2(x - L.mesa.x, z - L.mesa.y).length()
		if d < 22 and h > Terrain.height(L.geo[0].x, L.geo[0].y) + 1.2:
			var band := int(floor(h * 1.15 + Terrain.noise(x * 0.1, z * 0.1) * 1.2)) % 3
			out = raw(0xdba878 if band == 0 else 0xa3522c if band == 1 else 0xecd0a8)
		if di < 0.8:
			out = _lerp_col(out, raw(0xd9eef7), clampf(Terrain.noise(x * 0.25, z * 0.25) * 1.8 - 0.6, 0, 1) * (1 - di / 0.8) * 1.2)
		d = Vector2(x - L.geo[1].x, z - L.geo[1].y).length()
		if d < 12:
			out = _lerp_col(out, raw(0xe6c49c), (1 - d / 12) * 0.85)
		var cz := -132 + sin(x * 0.021) * 24
		var dc := absf(z - cz)
		if dc < 14:
			out *= 0.8 + 0.2 * dc / 14
		var dune := Terrain.smooth(40, 110, z) * Terrain.smooth(20, -60, x)
		out = _lerp_col(out, raw(0xdc9258), dune * 0.5)
	return out


func _build_ground() -> void:
	var size := 800.0
	var seg := 250
	var n := seg + 1
	var step := size / seg
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var uvs := PackedVector2Array()
	var norms := PackedVector3Array()
	verts.resize(n * n)
	cols.resize(n * n)
	uvs.resize(n * n)
	norms.resize(n * n)
	var hs := PackedFloat32Array()
	hs.resize(n * n)
	for j in n:
		var z := -size / 2 + j * step
		for i in n:
			var x := -size / 2 + i * step
			var h := Terrain.height(x, z)
			var k := j * n + i
			hs[k] = h
			verts[k] = Vector3(x, h, z)
			var gc := _ground_color(x, z, h)
			cols[k] = Color(gc.x, gc.y, gc.z)          # vertex colours are linear, like the web version's
			uvs[k] = Vector2(float(i) / seg, float(j) / seg)
	for j in n:
		for i in n:
			var hl := hs[j * n + maxi(i - 1, 0)]
			var hr := hs[j * n + mini(i + 1, seg)]
			var hd := hs[maxi(j - 1, 0) * n + i]
			var hu := hs[mini(j + 1, seg) * n + i]
			var sx := step * (mini(i + 1, seg) - maxi(i - 1, 0))
			var sz := step * (mini(j + 1, seg) - maxi(j - 1, 0))
			norms[j * n + i] = Vector3(-(hr - hl) / sx, 1, -(hu - hd) / sz).normalized()
	var idx := PackedInt32Array()
	idx.resize(seg * seg * 6)
	var q := 0
	for j in seg:
		for i in seg:
			var a := j * n + i
			idx[q] = a
			idx[q + 1] = a + 1
			idx[q + 2] = a + n
			idx[q + 3] = a + 1
			idx[q + 4] = a + n + 1
			idx[q + 5] = a + n
			q += 6
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.regen_normal_maps()
	_ground_mat = ShaderMaterial.new()
	_ground_mat.shader = load("res://scripts/world/ground.gdshader")
	var tiles: Dictionary = Data.load_json("res://assets/surface/ground_tiles.json")
	_ground_mat.set_shader_parameter("tile_a", load("res://assets/surface/ground_" + site_id + "_a.png"))
	_ground_mat.set_shader_parameter("tile_n", load("res://assets/surface/ground_" + site_id + "_n.png"))
	_ground_mat.set_shader_parameter("repeat", size / float(tiles[site_id]))
	_ground_mat.set_shader_parameter("psr", Vector3(Terrain.L.ice.x, Terrain.L.ice.y, Terrain.ice_r))
	_ground_mat.set_shader_parameter("use_psr", site_id == "moon")
	var ground := MeshInstance3D.new()
	ground.mesh = mesh
	ground.material_override = _ground_mat
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(ground)
	# the far land beyond the map, out to the horizon
	var skirt := MeshInstance3D.new()
	skirt.mesh = _ring_mesh(392, 3400, 48)
	skirt.material_override = Mats.soft(look.ground2, { "roughness": 1.0 })
	skirt.position.y = 23
	skirt.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(skirt)

	var rnd := Rng32.new(99 if site_id == "mars" else 11)
	# mountain ranges sculpted in Blender, with their hollows shaded (a touch of glow stands in for sunlight bouncing
	# off the ground, so shaded slopes are not pitch black)
	var range_scene: PackedScene = load("res://assets/surface/mountains_" + site_id + ".gltf")
	var range_node := range_scene.instantiate()
	var rmat: Material
	if site_id == "mars":
		rmat = Mats.mat(look.range, { "vertex_colors": true, "roughness": 1.0, "emission": look.range, "emission_energy": 0.05 })
	else:
		var sm := StandardMaterial3D.new()
		sm.albedo_color = c(look.range)
		sm.vertex_color_use_as_albedo = true
		sm.roughness = 1
		sm.emission_enabled = true
		sm.emission = c(look.range)
		sm.emission_energy_multiplier = 0.16
		rmat = sm
	_override_all(range_node, rmat, false)
	root.add_child(range_node)
	if site_id == "mars" and look.get("volcano", true):            # a giant volcano on the horizon
		Mats.add(root, Mats.cone(640, 190, 24), Mats.mat(look.mountain), 300, 100, -1250, false)

	# pebbles and rocks
	var rock_meshes := []
	for i in 8:
		var sc: PackedScene = load("res://assets/surface/rock_" + str(i) + ".gltf")
		rock_meshes.append(_first_mesh(sc))
	var rock_mat := Mats.mat(look.rock, { "vertex_colors": true })
	var rock_mat2 := Mats.mat(0x6e3a26 if site_id == "mars" else 0x9a9ba6, { "vertex_colors": true })
	var count := 900
	var kinds := 4
	var per := count / kinds
	var mms := []
	for i in kinds:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = rock_meshes[i * 2]
		mm.instance_count = per
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = rock_mat
		root.add_child(mmi)
		mms.append(mm)
	var col: Vector2 = Terrain.L.colony
	for i in count:
		var ra := rnd.next() * PI * 2
		var rd := (30 + rnd.next() * 34) if i < 160 else (60 + pow(rnd.next(), 1.3) * 300)
		var rx := cos(ra) * rd
		var rz := sin(ra) * rd
		var cdx := rx - col.x
		var cdz := rz - col.y
		var cdd := sqrt(cdx * cdx + cdz * cdz)
		if cdd < 37:          # the colony site stays clear, out to the city's ring road
			var dd := cdd if cdd != 0 else 1.0
			rx = col.x + cdx / dd * (37 + (37 - cdd) * 0.5)
			rz = col.y + cdz / dd * (37 + (37 - cdd) * 0.5)
		var sc := (0.08 + rnd.next() * 0.22) if i < 160 else (0.15 + pow(rnd.next(), 2.2) * 0.8)
		var r1 := rnd.next()
		var r2 := rnd.next()
		var r3 := rnd.next()
		var r4 := rnd.next()
		var basis := Basis.from_euler(Vector3((r1 - 0.5) * 0.5, r2 * 6.28, (r3 - 0.5) * 0.5), EULER_ORDER_XYZ)
		basis = basis * Basis.from_scale(Vector3(sc, sc * (0.5 + r4 * 0.6) * 1.3, sc))
		mms[i % kinds].set_instance_transform(i / kinds, Transform3D(basis, Vector3(rx, Terrain.height(rx, rz) - sc * 0.12, rz)))
	# boulders (these block your way)
	boulder_nodes = []
	var seat_mesh := _first_mesh(load("res://assets/surface/seat.gltf"))
	for k in Terrain.boulders.size():
		var b: Dictionary = Terrain.boulders[k]
		var gy := Terrain.height(b.x, b.z)
		var m := Mats.add(root, seat_mesh if b.seat else rock_meshes[k % rock_meshes.size()], rock_mat if k % 3 else rock_mat2, b.x, gy - b.r * 0.1, b.z)
		m.rotation_order = EULER_ORDER_XYZ
		if b.seat:
			m.scale = Vector3(b.r * 1.2, b.r * 0.88, b.r * 1.2)
		else:
			m.scale = Vector3(b.r * 1.12, b.r * b.sy * 1.35, b.r * 1.12)
		m.rotation = Vector3(0.0 if b.seat else b.tilt * 0.4, b.rot, 0)
		# the landing film and the lookout both measure this rock to sit on its edge
		if b.seat:
			var box: AABB = m.transform * m.mesh.get_aabb()
			Terrain.seat_top = box.end.y - gy
			seat_rock = m
		boulder_nodes.append(m)        # kept so that a boulder can be broken up and taken away (Pioneer mode)


func _ring_mesh(r0: float, r1: float, seg: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	for i in seg + 1:
		var a := float(i) / seg * TAU
		verts.append(Vector3(cos(a) * r0, 0, sin(a) * r0))
		verts.append(Vector3(cos(a) * r1, 0, sin(a) * r1))
	for i in seg:
		var a := i * 2
		idx.append_array([a, a + 2, a + 1, a + 1, a + 2, a + 3])
	var norms := PackedVector3Array()
	norms.resize(verts.size())
	norms.fill(Vector3.UP)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func _first_mesh(sc: PackedScene) -> Mesh:
	var n := sc.instantiate()
	var found: Mesh = null
	var stack := [n]
	while stack.size() and found == null:
		var x: Node = stack.pop_back()
		if x is MeshInstance3D:
			found = x.mesh
		stack.append_array(x.get_children())
	n.free()
	return found


static func _override_all(n: Node, m: Material, shadow: bool) -> void:
	if n is MeshInstance3D:
		n.material_override = m
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for ch in n.get_children():
		_override_all(ch, m, shadow)


# ---------- sky ----------
func _build_sky() -> void:
	var fog = look.fog
	environment.fog_enabled = fog != -1
	if fog != -1:
		environment.fog_light_color = c(fog)
		environment.fog_density = 0.0026 * 0.8
	sky_mat.set_shader_parameter("zenith", raw(look.zenith))
	sky_mat.set_shader_parameter("horizon", raw(look.horizon))
	sky_mat.set_shader_parameter("glow_col", raw(look.glow))
	sky_mat.set_shader_parameter("sun_size", float(look.sunSize) / 2.0 / 2400.0)
	sky_mat.set_shader_parameter("sky_amb", raw(look.hemiSky))
	sky_mat.set_shader_parameter("ground_amb", raw(look.hemiGround))
	sky_mat.set_shader_parameter("amb_energy", look.hemiInt)
	sky_mat.set_shader_parameter("star_opacity", 0.9 if site_id == "moon" else 0.0)
	sun.light_color = c(look.sunColor)
	sun.light_energy = look.sunInt
	earth = null
	phobos = null
	for e in _sev.list:
		_free_event(e)
	_sev = { "next": 8.0, "list": [] }
	if site_id == "moon":
		if look.get("earth", true):      # from Jupiter's moons the Earth is only a dot
			earth = MeshInstance3D.new()
			var sm := Mats.ball(95, 64, 48)
			earth.mesh = sm
			var em := ShaderMaterial.new()
			em.shader = load("res://scripts/world/earth.gdshader")
			earth.material_override = em
			earth.rotation.z = 0.41
			earth.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			root.add_child(earth)
	else:
		var pm := StandardMaterial3D.new()
		pm.albedo_color = c(0x8d8478)
		pm.roughness = 1
		pm.disable_fog = true
		phobos = Mats.add(root, Mats.ball(16, 10, 6), pm, 0, 0, 0, false)
		phobos.scale = Vector3(1.3, 1, 1.05)


## A soft round dot as a texture: stops = [[offset, Color], ...] from the centre out.
static func _radial_texture(size: int, stops: Array) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5 - size / 2.0, y + 0.5 - size / 2.0).length() / (size / 2.0)
			var col: Color = stops[stops.size() - 1][1]
			for i in range(1, stops.size()):
				if d <= stops[i][0]:
					var t: float = (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])
					col = (stops[i - 1][1] as Color).lerp(stops[i][1], t)
					break
			img.set_pixel(x, y, col)
	return ImageTexture.create_from_image(img)


# ---------- particles (dust, sparks, exhaust, storm specks) ----------
func _build_particles() -> void:
	_pmm = MultiMesh.new()
	_pmm.transform_format = MultiMesh.TRANSFORM_3D
	_pmm.use_colors = true
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	_pmm.mesh = quad
	_pmm.instance_count = PN
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = _pmm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.albedo_texture = _radial_texture(32, [[0.0, Color(1, 1, 1, 1)], [0.16, Color(1, 1, 1, 1)], [1.0, Color(1, 1, 1, 0)]])
	m.disable_fog = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-5000, -5000, -5000), Vector3(10000, 10000, 10000))
	add_child(mi)
	_ppos.resize(PN)
	_pvel.resize(PN)
	_pcol.resize(PN)
	_plife.resize(PN)
	_pmax.resize(PN)
	_pgrav.resize(PN)
	_ps0.resize(PN)
	_ps1.resize(PN)
	_pa0.resize(PN)
	_pbuf.resize(PN * 16)
	_reset_particles()


func _reset_particles() -> void:
	_pbuf.fill(0.0)
	_plife.fill(0.0)
	_plive = 0
	_pmm.buffer = _pbuf


## How many particles to emit this frame for a stream tuned as `per_frame` at 60 frames a second.
func rate(per_frame: float, dt: float) -> int:
	var n := per_frame * minf(dt, 0.05) * 60
	return int(floor(n)) + (1 if randf() < fmod(n, 1.0) else 0)


## o: { vx, vy, vz, life, size, grow, color (hex), alpha, grav }
func emit(x: float, y: float, z: float, o: Dictionary) -> void:
	var i := _pnext
	_pnext = (_pnext + 1) % PN
	_ppos[i] = Vector3(x, y, z)
	_pvel[i] = Vector3(o.get("vx", 0.0), o.get("vy", 0.0), o.get("vz", 0.0))
	var life: float = o.get("life", 1.0)
	if _plife[i] <= 0:
		_plive += 1
	_plife[i] = life
	_pmax[i] = life
	_pgrav[i] = o.get("grav", 0.0)
	var size: float = o.get("size", 0.4)
	_ps0[i] = size
	_ps1[i] = size * float(o.get("grow", 1.6))
	_pa0[i] = o.get("alpha", 0.8)
	_pcol[i] = c(o.get("color", 0xffffff))


func burst(x: float, y: float, z: float, n: int, speed: float, color: int, o: Dictionary = {}) -> void:
	if relay.is_valid():
		relay.call([x, y, z, n, speed, color, o])
	var up: float = o.get("up", 1.0)
	for i in n:
		var a := randf() * TAU
		var e := randf() * up
		var s := speed * (0.4 + randf() * 0.6)
		emit(x, y, z, { "vx": cos(a) * s * (1 - e * 0.5), "vy": e * s + float(o.get("lift", 0.0)), "vz": sin(a) * s * (1 - e * 0.5),
			"life": float(o.get("life", 0.9)) * (0.6 + randf() * 0.6), "size": o.get("size", 0.4), "grow": o.get("grow", 1.6), "color": color,
			"alpha": o.get("alpha", 0.8), "grav": o.get("grav", gravity * 0.4) })


func dust(x: float, z: float, n: int, speed: float = 1.6, size: float = 0.5) -> void:
	burst(x, Terrain.height(x, z) + 0.15, z, n, speed, look.dust,
		{ "life": 1.3, "size": size, "grow": 2.6, "alpha": 0.45, "up": 0.6, "grav": gravity * 0.12 })


func _update_particles(dt: float) -> void:
	if _plive <= 0:
		return
	var live := 0
	for i in PN:
		if _plife[i] <= 0:
			continue
		_plife[i] -= dt
		var j := i * 16
		if _plife[i] <= 0:
			_pbuf[j] = 0.0
			_pbuf[j + 5] = 0.0
			_pbuf[j + 10] = 0.0
			_pbuf[j + 15] = 0.0
			continue
		live += 1
		var k := 1 - _plife[i] / _pmax[i]
		var v := _pvel[i]
		v.y -= _pgrav[i] * dt
		_pvel[i] = v
		var p := _ppos[i] + v * dt
		_ppos[i] = p
		var s := lerpf(_ps0[i], _ps1[i], k)
		var cc := _pcol[i]
		_pbuf[j] = s
		_pbuf[j + 1] = 0.0
		_pbuf[j + 2] = 0.0
		_pbuf[j + 3] = p.x
		_pbuf[j + 4] = 0.0
		_pbuf[j + 5] = s
		_pbuf[j + 6] = 0.0
		_pbuf[j + 7] = p.y
		_pbuf[j + 8] = 0.0
		_pbuf[j + 9] = 0.0
		_pbuf[j + 10] = s
		_pbuf[j + 11] = p.z
		_pbuf[j + 12] = cc.r
		_pbuf[j + 13] = cc.g
		_pbuf[j + 14] = cc.b
		_pbuf[j + 15] = _pa0[i] * (1 - k) * minf(1, k * 8)
	_plive = live
	_pmm.buffer = _pbuf


# ---------- bootprints and wheel tracks ----------
func _build_prints() -> void:
	_fmm = MultiMesh.new()
	_fmm.transform_format = MultiMesh.TRANSFORM_3D
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	_fmm.mesh = plane
	_fmm.instance_count = FN
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = _fmm
	# a boot sole pressed into the dust: rounded at toe and heel, with tread bars across it
	var s := 64
	var img := Image.create(s, s, false, Image.FORMAT_RGBA8)
	for y in s:
		for x in s:
			var px := x + 0.5
			var py := y + 0.5
			var inside := false
			var e1 := Vector2((px - s / 2.0) / (s * 0.4), (py - s * 0.3) / (s * 0.28))
			var e2 := Vector2((px - s / 2.0) / (s * 0.33), (py - s * 0.74) / (s * 0.23))
			if e1.length() <= 1 or e2.length() <= 1 or (px >= s * 0.2 and px <= s * 0.8 and py >= s * 0.3 and py <= s * 0.74):
				inside = true
			if inside:
				var bar := fmod(py - 4, 9) < 4.5 and py >= 4
				img.set_pixel(x, y, Color(1, 1, 1, 1.0 if bar else 0.55))
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.render_priority = -1
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1000, -200, -1000), Vector3(2000, 400, 2000))
	add_child(mi)
	_reset_prints()


func _reset_prints() -> void:
	if not _fmm:
		return
	for i in FN:
		_fmm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(0.001, 1, 0.001)), Vector3(0, -500, 0)))
	_fnext = 0
	for ch in get_children():
		if ch is MultiMeshInstance3D and ch.multimesh == _fmm:
			var fm: StandardMaterial3D = ch.material_override
			fm.albedo_color = Mats.lin(0x5a2a12 if site_id == "mars" else 0x2c2d36, 0.62)


## a bootprint (or a wheel mark) at x, z facing yaw; w, l: its width and length
func print_at(x: float, z: float, yaw: float, w: float, l: float) -> void:
	var b := Basis(Vector3.UP, yaw + PI) * Basis.from_scale(Vector3(w, 1, l))      # the toe (the wide end) points the way you face
	_fmm.set_instance_transform(_fnext, Transform3D(b, Vector3(x, Terrain.height(x, z) + 0.04, z)))
	_fnext = (_fnext + 1) % FN


# ---------- helpers for the rest of the game ----------
## where a point shows on screen: { x, y, hidden, dist }
func project(v: Vector3) -> Dictionary:
	var p := camera.unproject_position(v)
	return { "x": p.x, "y": p.y, "hidden": camera.is_position_behind(v), "dist": camera.global_position.distance_to(v) }


## "forward" on the ground as the camera sees it
func forward() -> Vector3:
	return Vector3(-sin(cam.yaw), 0, -cos(cam.yaw))


func look_by(dx: float, dy: float) -> void:
	cam.yaw -= dx
	if cam.fp:
		cam.fpPitch = clampf(cam.fpPitch + dy * 1.3, -1.45, 1.2)       # positive = looking down; nearly straight up is allowed
	else:
		cam.pitch = clampf(cam.pitch + dy, -0.55, 1.25)                # below zero the camera crouches and tilts up at the sky


func zoom_by(d: float) -> void:
	cam.dist = clampf(cam.dist * (1 + d), 5.5, 26)


func set_lamp(x: float, y: float, z: float, dx: float, dz: float) -> void:
	lamp.position = Vector3(x, y, z)
	var tgt := Vector3(x + dx * 8, y - 2.4, z + dz * 8)
	if tgt.distance_to(lamp.position) > 0.01:
		lamp.look_at(tgt, Vector3.UP)


func sky_dark() -> float:
	return 1.0 if site_id == "moon" else minf(1, float(sky_mat.get_shader_parameter("star_opacity")) / 0.7)


func aspect() -> float:
	var vs := get_viewport().get_visible_rect().size
	return vs.x / maxf(1, vs.y)


# ---------- every frame ----------
func _update_sky(dt: float) -> void:
	# on Mars the lookout's sunset time-lapse runs the day on past sunset into the night (t > 1)
	var t: float = clampf(env.t, 0, 1.25 if site_id == "mars" else 1.0)
	var az: float
	var el: float
	if site_id == "moon":
		az = lerpf(1.05, -1.05, t)
		el = 0.15 + sin(PI * t) * 0.06
	else:
		az = lerpf(1.75, -1.75, t)
		el = 0.13 + sin(PI * t) * 0.9
	sun_dir = Vector3(sin(az) * cos(el), sin(el), cos(az) * cos(el)).normalized()
	var f: Vector3 = cam.target
	sun.global_transform = Transform3D(Basis.looking_at(-sun_dir, Vector3.UP if absf(sun_dir.y) < 0.99 else Vector3.FORWARD), f + sun_dir * 260)
	sky_mat.set_shader_parameter("sun_dir", sun_dir)
	_deep_sky(t)

	env.dustShown = lerpf(env.dustShown, env.dust, minf(1, dt * 0.8))
	env.stormShown = lerpf(env.stormShown, env.storm, minf(1, dt * 3))
	var d: float = env.dustShown
	var day := 1.0 if site_id == "moon" else Terrain.smooth(0, 0.14, t) * (1 - Terrain.smooth(0.86, 1, t))
	var night := Terrain.smooth(1.0, 1.2, t)
	var up := Terrain.smooth(-0.1, 0.04, el)      # after sunset: how deep the night is; is the Sun still up
	if site_id == "mars":
		var hz := raw(look.horizon).lerp(raw(0x5b6f92), (1 - day) * 0.8).lerp(raw(0x030508), night * 0.92).lerp(raw(0x7d4a2a), d * 0.8)
		var zn := raw(look.zenith).lerp(raw(0x2c3246), (1 - day) * 0.85).lerp(raw(0x000103), night * 0.97).lerp(raw(0x6a3d22), d * 0.85)
		sky_mat.set_shader_parameter("horizon", hz)
		sky_mat.set_shader_parameter("zenith", zn)
		sky_mat.set_shader_parameter("glow_col", raw(look.glow).lerp(raw(0x86bcff), 1 - day))
		sky_mat.set_shader_parameter("glow_amt", (1 + (1 - day) * 1.6) * (1 - d * 0.8) * Terrain.smooth(-0.32, 0.02, el))      # the blue glow fades as the Sun sinks further
		environment.fog_light_color = Color(hz.x, hz.y, hz.z).linear_to_srgb()
		environment.fog_density = (0.0026 + d * 0.02) * 0.8
		sun.light_energy = look.sunInt * (0.4 + 0.6 * day) * (1 - d * 0.66) * up
		sky_mat.set_shader_parameter("amb_energy", look.hemiInt * (0.62 + 0.38 * day) * (1 - d * 0.3) * (1 - night * 0.5))
		var sc := raw(look.sunColor).lerp(raw(0xa5c8ff), (1 - day) * 0.6)
		sun.light_color = Color(sc.x, sc.y, sc.z).linear_to_srgb()
		sky_mat.set_shader_parameter("sun_tint", Vector3(1, 1, 1).lerp(raw(0x9fc8ff), (1 - day) * 0.8))
		sky_mat.set_shader_parameter("sun_opacity", (1 - d * 0.8) * up)
		sky_mat.set_shader_parameter("star_opacity", ((1 - day) * 0.7 + night * 0.25) * (1 - d))
		var pt := fmod(time * 0.006 + 0.2, 1.0)
		var pa := lerpf(-1.9, 1.9, pt)
		var pe := 0.25 + sin(PI * pt) * 0.7
		if phobos:
			phobos.position = camera.position + Vector3(sin(pa) * cos(pe), sin(pe), -cos(pa) * cos(pe) * 0.6 - 0.3).normalized() * 2300
			phobos.rotation.y += dt * 0.05
		env.dark = clampf((1 - day) * 0.8 + d * 0.5, 0, 1)
	else:
		# down in the ice crater no sunlight ever reaches you (see the ground shader): only the helmet lamp and starlight
		var ice: Vector2 = Terrain.L.ice
		var dist_ice := Vector2(f.x - ice.x, f.z - ice.y).length() / Terrain.ice_r
		var in_psr := 1 - Terrain.smooth(0.55, 0.9, dist_ice)
		sun.light_energy = look.sunInt * (1 - d * 0.86) * (1 - 0.85 * in_psr)
		sky_mat.set_shader_parameter("amb_energy", look.hemiInt * (1 - d * 0.3) * (1 - 0.6 * in_psr))
		sky_mat.set_shader_parameter("sun_opacity", 1 - d)
		sky_mat.set_shader_parameter("glow_amt", 1.0)
		if earth:
			earth.position = camera.position + EARTH_DIR.normalized() * 2350
			earth.rotation.y += dt * 0.004                       # a slow turn (the real one takes a day)
			var em: ShaderMaterial = earth.material_override
			em.set_shader_parameter("sun_dir", sun_dir)
			em.set_shader_parameter("cloud_shift", time * 0.0012)
		var in_ice := 1 - Terrain.smooth(0.55, 1.0, dist_ice)
		env.dark = clampf(d * 0.9 + in_ice * 0.8 + 0.25, 0, 1)
	lamp.light_energy = lerpf(lamp.light_energy, env.dark * 2.4 * 4.0 if cam.mode == "play" else 0.0, minf(1, dt * 3))


func _ambient_particles(dt: float) -> void:
	var f: Vector3 = cam.target
	if env.stormShown > 0.03:
		for i in rate(env.stormShown * 26, dt):
			emit(f.x + (randf() - 0.5) * 70 + sun_dir.x * 20, f.y + randf() * 26 + 6, f.z + (randf() - 0.5) * 70 + sun_dir.z * 20,
				{ "vx": -sun_dir.x * 46, "vy": -sun_dir.y * 46 - 10, "vz": -sun_dir.z * 46, "life": 0.9, "size": 0.34, "grow": 0.6, "color": 0xff48c8, "alpha": 0.9 })
	if site_id == "mars" and env.dustShown > 0.03:
		for i in rate(env.dustShown * 12, dt):
			emit(f.x - 40 + randf() * 30, f.y + randf() * 14 - 1, f.z + (randf() - 0.5) * 80,
				{ "vx": 16 + randf() * 14, "vy": (randf() - 0.5) * 2, "vz": 3, "life": 3, "size": 0.9, "grow": 2.4, "color": 0xe2b98c, "alpha": 0.28 })


# ---------- sky events: meteors on Mars, the flash of a tiny impact on the Moon ----------
func _sky_dir(az: float, el: float) -> Vector3:
	return Vector3(sin(az) * cos(el), sin(el), cos(az) * cos(el))


func _view_az() -> float:
	var v := -camera.global_transform.basis.z
	return atan2(v.x, v.z)


func _sprite(size: float, hex: int) -> MeshInstance3D:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_texture = _glow_tex
	m.albedo_color = c(hex)
	m.albedo_color.a = 0
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.disable_fog = true
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	return mi


func _free_event(e: Dictionary) -> void:
	for k in ["line", "head", "sp"]:
		if e.get(k) and is_instance_valid(e[k]):
			e[k].queue_free()


func _spawn_meteor() -> void:
	var fire := randf() < 0.12
	var az := _view_az() + (randf() - 0.5) * 1.1
	var el := 0.3 + randf() * 0.55
	var turn := (-1.0 if randf() < 0.5 else 1.0) * (0.18 + randf() * 0.3)
	var drop := 0.1 + randf() * 0.22
	var line := MeshInstance3D.new()
	line.mesh = ImmediateMesh.new()
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.vertex_color_use_as_albedo = true
	lm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	lm.disable_fog = true
	lm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	line.material_override = lm
	line.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(line)
	_sev.list.append({ "kind": "meteor", "t": 0.0, "life": 1.5 if fire else 0.45 + randf() * 0.5, "az": az, "el": el, "turn": turn, "drop": drop * (1.4 if fire else 1.0),
		"trail": 0.5 if fire else 0.32, "line": line, "head": _sprite(36 if fire else 14, 0xd8ffd0 if fire else 0xfff2d8), "bright": 1.0 if fire else 0.55 + randf() * 0.4 })


func _spawn_flash() -> void:
	var az := _view_az() + (randf() - 0.5) * 0.9
	var dist := 70 + randf() * 110
	var x := camera.position.x + sin(az) * dist
	var z := camera.position.z + cos(az) * dist
	if Vector2(x, z).length() > Terrain.PLAY_R + 40:
		return
	var sp := _sprite(5 + randf() * 4, 0xfff6e8)
	sp.position = Vector3(x, Terrain.height(x, z) + 0.4, z)
	_sev.list.append({ "kind": "flash", "t": 0.0, "life": 0.55, "sp": sp, "x": x, "z": z })


func _sky_events(dt: float) -> void:
	if not root:
		return
	var dark := sky_dark()
	var watching := _obs_k > 0.5
	if watching and _sev.next > 10:
		_sev.next = 2 + randf() * 3              # just sat down: the sky soon gives something to see
	_sev.next -= dt
	if _sev.next <= 0:
		_sev.next = 4 + randf() * 6 if watching else 22 + randf() * 30
		if site_id == "mars":
			if dark > 0.3 and cam.mode != "inside":
				_spawn_meteor()
			else:
				_sev.next = 5.0                 # too bright: look again soon
		elif cam.mode != "inside" and cam.room == null:
			if randf() < 0.6:
				_spawn_flash()
			elif watching and not _sev.list.any(func(e): return e.kind == "orbiter"):
				_spawn_orbiter()
	for i in range(_sev.list.size() - 1, -1, -1):
		var e: Dictionary = _sev.list[i]
		e.t += dt
		var u: float = e.t / e.life
		if e.kind == "meteor":
			var im: ImmediateMesh = e.line.mesh
			im.clear_surfaces()
			var fade: float = minf(1, u * 8) * (1 - maxf(0, (u - 0.75) / 0.25)) * e.bright * dark
			im.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
			var n := 12
			for k in n:
				var q := maxf(0, u - e.trail * k / (n - 1))                  # the tail lags behind the head
				var b := fade * pow(1 - float(k) / (n - 1), 1.6)
				im.surface_set_color(Color(b, b * 0.97, b * 0.9))
				im.surface_add_vertex(_sky_dir(e.az + e.turn * q, e.el - e.drop * q) * 2150 + camera.position)
			im.surface_end()
			e.head.position = _sky_dir(e.az + e.turn * u, e.el - e.drop * u) * 2140 + camera.position
			(e.head.material_override as StandardMaterial3D).albedo_color.a = fade
		elif e.kind == "flash":
			(e.sp.material_override as StandardMaterial3D).albedo_color.a = u / 0.12 if u < 0.12 else pow(1 - (u - 0.12) / 0.88, 2.5)
			if not e.get("dust") and u > 0.1:
				e.dust = true
				dust(e.x, e.z, 6, 2.2, 0.6)
		elif e.kind == "orbiter":
			e.sp.position = _sky_dir(e.az + e.span * u, e.el + sin(u * PI) * 0.08) * 2150 + camera.position
			(e.sp.material_override as StandardMaterial3D).albedo_color.a = minf(1, minf(u * 6, (1 - u) * 6)) * 0.85
		if u >= 1:
			_free_event(e)
			_sev.list.remove_at(i)


# ---------- the camera ----------
func _update_camera(dt: float) -> void:
	var want: Vector3
	var look_at_p: Vector3
	var sp: float
	var portrait := aspect() < 1
	if cam.mode == "title":
		var a := time * 0.05 + 0.5
		var rad := 92.0 if portrait else 64.0
		want = Vector3(sin(a) * rad, 15 + sin(time * 0.11) * 4, cos(a) * rad)
		look_at_p = Vector3(-6, 5, 4)
		sp = minf(1, dt * 1.5)
	elif cam.mode == "inside":
		var b := time * 0.09
		want = Vector3(sin(b) * 30, 13, cos(b) * 30 + 2)
		look_at_p = Vector3(0, 3.5, 0)
		sp = minf(1, dt * 1.6)
	elif cam.mode == "fixed" and cam.fixed:
		want = cam.fixed.pos
		look_at_p = cam.fixed.look
		sp = minf(1, dt * 2.2)
	elif cam.mode == "cine":
		# the landing film drives the camera directly (no smoothing: the film does its own)
		want = cam.cine.pos
		look_at_p = cam.cine.look
		sp = 1
		cam.target = Vector3(want.x, Terrain.height(want.x, want.z) + 2, want.z)
	elif cam.fp and cam.eye.is_valid():
		# first person: the camera IS the astronaut's eyes (cam.yaw is the way you face)
		cam.target = cam.eye.call()
		want = cam.target
		var cq := cos(cam.fpPitch)
		look_at_p = Vector3(want.x - sin(cam.yaw) * cq * 20, want.y - sin(cam.fpPitch) * 20, want.z - cos(cam.yaw) * cq * 20)
		sp = 1
	else:
		if cam.focus.is_valid():
			cam.target = cam.focus.call()
		var pitch: float = cam.pitch
		var up := 0.0
		if pitch < 0.06:
			up = 0.06 - pitch
			pitch = 0.06 - up * 0.35
		var cp := cos(pitch)
		var dist: float = cam.dist * (1.25 if portrait else 1.0)
		var tg: Vector3 = cam.target
		want = Vector3(tg.x + sin(cam.yaw) * cp * dist, tg.y + sin(pitch) * dist, tg.z + cos(cam.yaw) * cp * dist)
		look_at_p = tg
		look_at_p.y += up * maxf(dist, 4) * 1.8
		sp = minf(1, dt * 12)
		if cam.room != null:
			want = _keep_in_room(want, tg, cam.room)
	var floor_y := Terrain.height(want.x, want.z) + 0.7
	if want.y < floor_y:
		want.y = floor_y
	cam.pos = (cam.pos as Vector3).lerp(want, sp)
	cam.look = (cam.look as Vector3).lerp(look_at_p, minf(1, sp * 1.4))
	if not (cam.pos as Vector3).is_finite():
		cam.pos = want
	if not (cam.look as Vector3).is_finite():
		cam.look = look_at_p
	var pos: Vector3 = cam.pos
	if cam.shake > 0.001:
		pos += Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * cam.shake
		cam.shake *= maxf(0, 1 - dt * 4)
	camera.position = pos
	if pos.distance_to(cam.look) > 0.001:
		var upv := Vector3.UP
		var dir: Vector3 = (cam.look - pos).normalized()
		if absf(dir.dot(upv)) > 0.999:
			upv = Vector3.FORWARD
		camera.look_at(cam.look, upv)
	var cine: bool = cam.mode == "cine"
	if cine and cam.cine.roll:
		camera.rotate_object_local(Vector3(0, 0, 1), cam.cine.roll)
	var fov: float = cam.cine.get("fov", 52.0) if cine else (66.0 if cam.mode == "play" and cam.fp and cam.eye.is_valid() else 52.0)
	camera.fov = fov
	camera.near = (0.25 if cam.fp else 0.06) if cam.room != null else 0.4     # in a small room close things must not be cut off


## Inside a room the camera must not go through the walls: slide it toward the astronaut until it fits.
func _keep_in_room(want: Vector3, from: Vector3, R: Dictionary) -> Vector3:
	var dome: bool = R.type == "dome"
	var dx := want.x - from.x
	var dy := want.y - from.y
	var dz := want.z - from.z
	var t := 1.0
	var ox: float = from.x - R.cx
	var oz: float = from.z - R.cz
	var oy: float = (from.y - R.cy) if dome else 0.0
	var a := dx * dx + dz * dz + (dy * dy if dome else 0.0)
	var b := 2 * (ox * dx + oz * dz + (oy * dy if dome else 0.0))
	var cc: float = ox * ox + oz * oz + oy * oy - R.r * R.r
	var disc := b * b - 4 * a * cc
	if a > 1e-6 and disc >= 0:
		var hit := (-b + sqrt(disc)) / (2 * a)
		if hit < 1:
			t = maxf(0, hit * 0.94)
	var out := Vector3(from.x + dx * t, from.y + dy * t, from.z + dz * t)
	if out.y < R.floor:
		out.y = R.floor
	if R.get("top") != null and out.y > R.top:
		out.y = R.top
	return out


func snap_camera() -> void:
	_update_camera(100)


func update(dt: float) -> void:
	if not ready_ok or not root:
		return
	time += dt
	_update_camera(dt)
	_update_sky(dt)
	_sky_events(dt)
	_ambient_particles(dt)
	_update_particles(dt)


# ---------- the observation sky (the observe add-on) ----------
# While you sit on the lookout rock, a much deeper sky fades in: thousands of faint stars and the band of the
# Milky Way, tilted across the sky. On the airless Moon the sky is black all day, so it shows at any time; on Mars
# only once the butterscotch daylight fades. On Mars, Earth is the bright blue-white "evening star": seen from Mars
# it always stays fairly close to the Sun, so it is placed a little above and beside it.
var _obs_k := 0.0
var _deep: Node3D = null
var _deep_parts: Array = []          # [material, opacity]
var _e_star: MeshInstance3D = null
var _e_moon: MeshInstance3D = null
var _deimos: MeshInstance3D = null


func observe(k: float) -> void:
	_obs_k = clampf(k, 0, 1)
	if _obs_k > 0 and (_deep == null or not is_instance_valid(_deep)) and root:
		_build_deep_sky()


func _star_layer(rnd: Rng32, n: int, in_band: bool, spread: float, size: float, op: float, warm: float, a1: Vector3, a2: Vector3, pole: Vector3) -> MeshInstance3D:
	var gauss := func() -> float: return (rnd.next() + rnd.next() + rnd.next() + rnd.next() - 2) / 2
	var pos := PackedVector3Array()
	var col := PackedColorArray()
	pos.resize(n)
	col.resize(n)
	for i in n:
		var d: Vector3
		if in_band or rnd.next() < 0.55:
			var ang: float = gauss.call() * 0.9 if rnd.next() < 0.4 else rnd.next() * TAU         # denser toward the galactic centre
			var lat: float = gauss.call() * spread * (1 + 0.8 * exp(-ang * ang * 2))                # and thicker there: the bulge
			d = a1 * (cos(ang) * cos(lat)) + a2 * (sin(ang) * cos(lat)) + pole * sin(lat)
		else:
			var u := rnd.next() * 2 - 1
			var a := rnd.next() * TAU
			var r := sqrt(1 - u * u)
			d = Vector3(r * cos(a), u, r * sin(a))
		pos[i] = d.normalized() * 2270
		var b := 0.35 + pow(rnd.next(), 3) * 0.65
		var w := rnd.next() < warm
		col[i] = Color(b * (1.0 if w else 0.84), b * 0.9, b * (0.78 if w else 1.0))
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pos
	arr[Mesh.ARRAY_COLOR] = col
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arr)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.use_point_size = true
	m.point_size = size
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.disable_fog = true
	m.albedo_color = Color(1, 1, 1, 0)
	var mi := MeshInstance3D.new()
	mi.mesh = am
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 16384
	_deep_parts.append([m, op])
	return mi


func _build_deep_sky() -> void:
	# the band is tilted so that it climbs the sky through the part you face from the lookout rock
	# (on the Moon it passes behind Earth; on Mars, across the western sky the lookout faces)
	var ref := Vector3(sin(-1.9), 0.3, cos(-1.9)).normalized() if site_id == "mars" else EARTH_DIR.normalized()
	var rnd := Rng32.new(911)
	var pole := ref.cross(Vector3(0.62, 1, 0.12)).normalized()
	var a1 := Vector3(1, 0, 0).cross(pole).normalized()
	var a2 := pole.cross(a1).normalized()
	_deep_parts = []
	_deep = Node3D.new()
	_deep.add_child(_star_layer(rnd, 7000, false, 0.11, 1.6, 0.95, 0.3, a1, a2, pole))       # faint stars, many crowded into the band
	_deep.add_child(_star_layer(rnd, 9000, true, 0.06, 1.2, 0.5, 0.6, a1, a2, pole))         # and a finer dust of them along its middle
	# the glow of the Milky Way itself: a soft band with darker lanes of dust, painted once and wrapped round the sky
	var w := 512
	var h := 64
	var img := Image.create(w, h, false, Image.FORMAT_RGB8)
	for y in h:
		for x in w:
			var u := float(x) / w
			var v := (float(y) / h - 0.5) * 2
			var ang := u * TAU
			var bulge := 1 + 1.4 * exp(-pow(minf(absf(u - 0.5), 1 - absf(u - 0.5)) * 7, 2))      # brighter and wider toward the centre
			var fall := exp(-v * v / (0.18 * bulge))
			# clumpy star clouds, sampled on a small circle along the band so the clumps come out round
			var cx := cos(ang) * 22
			var cy := sin(ang) * 22
			var acr := v * 3.2
			var cloud := Terrain.noise(cx + 20, cy + acr) * 0.5 + Terrain.noise(cx * 2.3 + 3, cy * 2.3 + acr * 2.3) * 0.3 + Terrain.noise(cx * 5.1 + 9, cy * 5.1 + acr * 5.1) * 0.2
			var lane := 1 - 0.7 * maxf(0, 1 - absf(v + 0.1 * sin(ang * 3) - 0.04) * 7) * Terrain.noise(cx * 1.6 + 7, cy * 1.6 + acr * 1.6)
			var edge := 1 - Terrain.smooth(0.6, 0.98, absf(v))            # no hard rim where the band's cylinder ends
			var b := maxf(0, fall * pow(maxf(0, cloud - 0.15), 1.4) * 1.6 * lane * bulge * 0.7) * edge
			img.set_pixel(x, y, Color(minf(1, b), minf(1, b * 0.95), minf(1, b * 0.9)))
	var cyl := CylinderMesh.new()
	cyl.top_radius = 2250
	cyl.bottom_radius = 2250
	cyl.height = 760
	cyl.radial_segments = 96
	cyl.rings = 1
	cyl.cap_top = false
	cyl.cap_bottom = false
	var bm := StandardMaterial3D.new()
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.albedo_texture = ImageTexture.create_from_image(img)
	bm.texture_repeat = true
	bm.cull_mode = BaseMaterial3D.CULL_FRONT
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	bm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	bm.disable_fog = true
	bm.albedo_color = Color(1, 1, 1, 0)
	var band := MeshInstance3D.new()
	band.mesh = cyl
	band.material_override = bm
	band.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	band.extra_cull_margin = 16384
	band.quaternion = Quaternion(Vector3.UP, pole)      # the band lies across the sky, its axis on the galactic pole
	_deep.add_child(band)
	_deep_parts.append([bm, 0.34])
	_deep.visible = false
	root.add_child(_deep)
	if site_id == "mars":
		_e_star = _sprite(26, 0xc8deff)
		_e_moon = _sprite(9, 0xe8e4dc)       # Earth's Moon, a faint dot right beside it
		_deimos = _sprite(12, 0xfff1dc)      # Deimos: from the ground a bright star that drifts slowly across the sky


func _deep_sky(_t: float) -> void:
	if _deep == null or not is_instance_valid(_deep):
		return
	var dark: float = (1.0 - env.dustShown * 0.6) if site_id == "moon" else minf(1, float(sky_mat.get_shader_parameter("star_opacity")) / 0.7)
	_deep.position = camera.position
	_deep.visible = _obs_k > 0.001
	for p in _deep_parts:
		p[0].albedo_color.a = p[1] * _obs_k * dark
	if _e_star and is_instance_valid(_e_star):
		# Earth can stand up to 47 degrees from the Sun as seen from Mars, so after sunset it stays well up in the west
		var a := atan2(sun_dir.x, sun_dir.z) + 0.42
		var el := maxf(0.24, asin(clampf(sun_dir.y, -1, 1)) + 0.3)
		_e_star.position = camera.position + _sky_dir(a, el) * 2200
		var op: float = dark * (0.35 + 0.65 * _obs_k) * (1 - env.dustShown)
		(_e_star.material_override as StandardMaterial3D).albedo_color.a = op
		_e_star.visible = op > 0.01
		_e_moon.position = camera.position + _sky_dir(a + 0.0055, el + 0.002) * 2200
		(_e_moon.material_override as StandardMaterial3D).albedo_color.a = op * 0.45
		_e_moon.visible = _e_star.visible
		var dp := fmod(time * 0.0011 + 0.45, 1.0)
		var daz := -1.9 + lerpf(0.9, -0.9, dp)
		var de := 0.15 + sin(PI * dp) * 0.12
		_deimos.position = camera.position + _sky_dir(daz, de) * 2200
		var dop: float = dark * 0.85 * (1 - env.dustShown)
		(_deimos.material_override as StandardMaterial3D).albedo_color.a = dop
		_deimos.visible = dop > 0.01


func _spawn_orbiter() -> void:
	var va := _view_az()
	var az := va + (-0.9 if randf() < 0.5 else 0.9)
	var dir := 1.0 if az < va else -1.0
	_sev.list.append({ "kind": "orbiter", "t": 0.0, "life": 20 + randf() * 8, "az": az, "el": 0.55 + randf() * 0.45, "span": 1.8 * dir, "sp": _sprite(9, 0xf2f6ff) })


# ---------- the seat rock, measured from its own mesh (it has no collider) ----------
var _seat_grid := {}
var _seat_for: Node3D = null
const _SG := 0.25


## The height of the seat rock's surface straight above (x, z), or -1e9 off the rock. The landing film and the
## lookout use it to sit on the rock's real top and front edge.
func seat_height(x: float, z: float) -> float:
	if seat_rock == null or not is_instance_valid(seat_rock) or not (seat_rock is MeshInstance3D):
		return -1e9
	if _seat_for != seat_rock:
		_build_seat_grid()
	var best := -1e9
	for tri in _seat_grid.get(Vector2i(floori(x / _SG), floori(z / _SG)), []):
		var hit = Geometry3D.ray_intersects_triangle(Vector3(x, 1e4, z), Vector3.DOWN, tri[0], tri[1], tri[2])
		if hit != null and hit.y > best:
			best = hit.y
	return best


func _build_seat_grid() -> void:
	_seat_for = seat_rock
	_seat_grid = {}
	var mi := seat_rock as MeshInstance3D
	var xf: Transform3D = mi.global_transform if mi.is_inside_tree() else mi.transform
	var f := mi.mesh.get_faces()
	for i in range(0, f.size() - 2, 3):
		var a: Vector3 = xf * f[i]
		var b: Vector3 = xf * f[i + 1]
		var c: Vector3 = xf * f[i + 2]
		var tri := [a, b, c]
		for gx in range(floori(minf(a.x, minf(b.x, c.x)) / _SG), floori(maxf(a.x, maxf(b.x, c.x)) / _SG) + 1):
			for gz in range(floori(minf(a.z, minf(b.z, c.z)) / _SG), floori(maxf(a.z, maxf(b.z, c.z)) / _SG) + 1):
				var k := Vector2i(gx, gz)
				if not _seat_grid.has(k):
					_seat_grid[k] = []
				_seat_grid[k].append(tri)
