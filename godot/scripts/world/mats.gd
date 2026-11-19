class_name Mats
## Materials for the shapes the game builds in code (the old W.mat / W.soft / W.glow), and small mesh helpers.
##
## Colour note: the web version used three.js without colour management, so its hex colours were used as LINEAR values
## and the picture was encoded to sRGB at the end, which makes them look paler than the hex. lin() turns a hex colour
## into the Godot colour that gives the same result, so the outpost keeps its look.

static var _flat_shader: Shader


static func lin(hex: int, alpha: float = 1.0) -> Color:
	var c := Color.hex((hex << 8) | 0xFF).linear_to_srgb()
	c.a = alpha
	return c


## a dull, flat-shaded surface (rocks, soil, dirt)
static func mat(hex: int, opts: Dictionary = {}) -> Material:
	var m := ShaderMaterial.new()
	m.shader = flat_shader()
	m.set_shader_parameter("albedo", lin(hex))
	m.set_shader_parameter("roughness", opts.get("roughness", 0.85))
	m.set_shader_parameter("use_vertex_color", opts.get("vertex_colors", false))
	if opts.has("emission"):
		m.set_shader_parameter("emission", lin(opts.emission))
		m.set_shader_parameter("emission_energy", opts.get("emission_energy", 1.0))
	return m


## a smooth painted surface
static func soft(hex: int, opts: Dictionary = {}) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = lin(hex)
	m.roughness = opts.get("roughness", 0.6)
	m.metallic = opts.get("metallic", 0.05)
	if opts.has("opacity"):
		transparent(m, opts.opacity)
	return m


## something that glows (lamps, rings, screens). Its glow is set with energy().
static func glow(hex: int, intensity: float = 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = lin(hex)
	m.roughness = 0.4
	m.emission_enabled = true
	m.emission = lin(hex)
	m.emission_energy_multiplier = intensity
	return m


## see-through glass or a hologram beam
static func transparent(m: BaseMaterial3D, opacity: float, additive: bool = false, double_sided: bool = false) -> BaseMaterial3D:
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color.a = opacity
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	if double_sided:
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


## an unlit colour (beams, flames, waves)
static func unlit(hex: int, opacity: float = 1.0, additive: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = lin(hex)
	m.disable_fog = true
	if opacity < 1.0 or additive:
		transparent(m, opacity, additive, true)
	return m


static func set_color(m: Material, hex: int) -> void:
	if m is BaseMaterial3D:
		m.albedo_color = lin(hex, m.albedo_color.a)
		if m.emission_enabled:
			m.emission = lin(hex)
	elif m is ShaderMaterial:
		m.set_shader_parameter("albedo", lin(hex))


static func energy(m: Material, v: float) -> void:
	if m is BaseMaterial3D:
		m.emission_energy_multiplier = maxf(0.0, v)


static func flat_shader() -> Shader:
	if _flat_shader == null:
		_flat_shader = Shader.new()
		_flat_shader.code = """
shader_type spatial;
uniform vec4 albedo : source_color = vec4(1.0);
uniform float roughness = 0.85;
uniform bool use_vertex_color = false;
uniform vec4 emission : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float emission_energy = 0.0;
void fragment() {
	// flat shading: one normal per triangle, from the screen-space slope of the surface
	NORMAL = normalize(cross(dFdx(VERTEX), dFdy(VERTEX)));
	ALBEDO = albedo.rgb * (use_vertex_color ? COLOR.rgb : vec3(1.0));
	ROUGHNESS = roughness;
	METALLIC = 0.05;
	EMISSION = emission.rgb * emission_energy;
}
"""
	return _flat_shader


# ---------- meshes ----------
static func cyl(rt: float, rb: float, h: float, seg: int = 14, open_ended: bool = false) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = rt
	c.bottom_radius = rb
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	c.cap_top = not open_ended
	c.cap_bottom = not open_ended
	return c


static func box(w: float, h: float, d: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(w, h, d)
	return b


static func ball(r: float, a: int = 12, b: int = 10) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2
	s.radial_segments = a
	s.rings = b
	return s


static func half_ball(r: float, a: int = 24, b: int = 10) -> SphereMesh:
	var s := ball(r, a, b)
	s.is_hemisphere = true
	s.height = r
	return s


## a ring lying flat (three.js TorusGeometry turned flat with rotation.x = PI/2)
static func torus(r: float, tube: float, seg: int = 26, sides: int = 8) -> TorusMesh:
	var t := TorusMesh.new()
	t.inner_radius = r - tube
	t.outer_radius = r + tube
	t.rings = seg
	t.ring_segments = sides
	return t


static func cone(r: float, h: float, seg: int = 8) -> CylinderMesh:
	return cyl(0.0, r, h, seg)


## A mesh node, placed at (x, y, z) in parent. shadow: casts and receives shadows.
static func add(parent: Node3D, mesh: Mesh, material: Material, x: float = 0, y: float = 0, z: float = 0, shadow: bool = true) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = material
	m.position = Vector3(x, y, z)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(m)
	return m


## a mesh whose origin is at its bottom, so scaling y fills it up from the floor (three.js geometry.translate(0, h/2, 0))
static func from_bottom(parent: Node3D, mesh: Mesh, material: Material, x: float, y: float, z: float, h: float) -> Node3D:
	var pivot := Node3D.new()
	pivot.position = Vector3(x, y, z)
	parent.add_child(pivot)
	add(pivot, mesh, material, 0, h / 2, 0, false)
	return pivot
