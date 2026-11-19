extends Node
## The helmet view. Press V (or the 👁 button) to see the outpost through your own visor instead of from behind.
## This only draws the inside of the helmet: the dark rim, a glint, a little fog from your breath, a compass and a
## line of suit readings. The camera lives in World and the astronaut's body in Actors. A port of js/pov.js.

const DIRS := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
const PX_PER_RAD := 150.0      # how far a compass letter slides for each radian you turn
const GREEN := Color("#8dffc0")
const RIM_SHADER := """
shader_type canvas_item;
uniform float fog = 0.0;
void fragment() {
	vec2 uv = UV - vec2(0.5, 0.47);
	uv.x *= 1.0 / 0.60;
	uv.y *= 1.0 / 0.68;
	float r = length(uv) * 1.414;
	vec4 c = vec4(1.0, 0.77, 0.35, 0.03);
	c = mix(c, vec4(0.024, 0.031, 0.063, 0.45), smoothstep(0.60, 0.82, r));
	c = mix(c, vec4(0.016, 0.024, 0.047, 1.0), smoothstep(0.82, 0.99, r));
	// a glint of light across the glass
	float g = dot(UV - vec2(0.5), normalize(vec2(0.53, -0.85)));
	c.rgb = mix(c.rgb, vec3(1.0), smoothstep(0.08, 0.0, abs(g + 0.05)) * 0.06 * (1.0 - c.a));
	c.a = max(c.a, smoothstep(0.08, 0.0, abs(g + 0.05)) * 0.06);
	// the fog of your own breath, low on the visor
	vec2 b = (UV - vec2(0.5, 1.05)) / vec2(0.35, 0.18);
	float fogv = (1.0 - smoothstep(0.0, 1.0, length(b))) * 0.45 * fog;
	c.rgb = mix(c.rgb, vec3(0.86, 0.92, 1.0), fogv);
	c.a = max(c.a, fogv);
	COLOR = c;
}
"""
var box: Control
var rim: ColorRect
var compass: Control
var data: Label
var shown := false
var breath := 2.0
var data_at := 0.0
var heart := 78.0
var fog_t := 0.0
var info = null


func _ready() -> void:
	box = Control.new()
	box.name = "Visor"
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.visible = false
	Ui.root.add_child(box)
	Ui.root.move_child(box, 0)          # under the HUD
	rim = ColorRect.new()
	rim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = RIM_SHADER
	var mat := ShaderMaterial.new()
	mat.shader = sh
	rim.material = mat
	box.add_child(rim)
	compass = Control.new()
	compass.mouse_filter = Control.MOUSE_FILTER_IGNORE
	compass.set_anchors_preset(Control.PRESET_CENTER_TOP)
	compass.offset_left = -150
	compass.offset_right = 150
	compass.offset_top = 134
	compass.offset_bottom = 160
	compass.clip_contents = true
	compass.draw.connect(_paint_compass)
	box.add_child(compass)
	data = Label.new()
	data.set_anchors_preset(Control.PRESET_CENTER_TOP)
	data.offset_left = -300
	data.offset_right = 300
	data.offset_top = 168
	data.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	data.add_theme_font_override("font", _mono())
	data.add_theme_font_size_override("font_size", 13)
	data.add_theme_color_override("font_color", GREEN)
	data.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	data.add_theme_constant_override("outline_size", 4)
	box.add_child(data)


static var _mono_font: SystemFont


static func _mono() -> Font:
	if _mono_font:
		return _mono_font
	var f := SystemFont.new()
	_mono_font = f
	f.font_names = PackedStringArray(["Cascadia Mono", "Consolas", "DejaVu Sans Mono", "monospace"])
	f.font_weight = 700
	return f


static func _wrap(a: float) -> float:
	return wrapf(a, -PI, PI)


## north is -z on this map; angles are clockwise from north
static func _bearing(from: Vector3, to: Vector3) -> float:
	return atan2(to.x - from.x, -(to.z - from.z))


## Called every frame by the game. active: the helmet view is on. info: { yaw, pos, home, goal, goalIcon, air, moving, effort }
func frame(dt: float, active: bool, inf) -> void:
	if active != shown:
		shown = active
		box.visible = active
	if not active or inf == null:
		return
	info = inf
	compass.queue_redraw()
	var heading: float = -inf.yaw
	var d_home := Vector2(inf.home.x - inf.pos.x, inf.home.z - inf.pos.z).length()
	# suit readings: your heart beats faster when you run
	heart += ((132.0 if inf.effort else (98.0 if inf.moving else 76.0)) - heart) * minf(1, dt * 0.45)
	data_at -= dt
	if data_at <= 0:
		data_at = 0.5
		var deg := posmod(roundi(rad_to_deg(heading)), 360)
		data.text = "O₂ %d%%   ·   ♥ %d   ·   %03d° %s   ·   HOME %d m" % [roundi(inf.air), roundi(heart), deg, DIRS[roundi(deg / 45.0) % 8], roundi(d_home)]
	# the sound of your own breathing, faster when you run; the visor fogs a little with each breath
	breath -= dt * (1.7 if inf.effort else 1.0)
	if breath <= 0:
		breath = 4.6
		fog_t = 0.0
		Au.play("breath")
	fog_t += dt
	(rim.material as ShaderMaterial).set_shader_parameter("fog", clampf(sin(clampf(fog_t / 2.3, 0, 1) * PI), 0, 1))


func _paint_compass() -> void:
	if info == null:
		return
	var c := compass
	var w := c.size.x
	c.draw_rect(Rect2(Vector2.ZERO, c.size), Color(0.024, 0.04, 0.08, 0.3))
	c.draw_line(Vector2(0, c.size.y - 1), Vector2(w, c.size.y - 1), Color(GREEN, 0.45), 1.5)
	c.draw_rect(Rect2(w / 2 - 1, c.size.y - 8, 2, 8), GREEN)
	var heading: float = -info.yaw
	var f := _mono()
	var mark := func(text: String, ang: float, size: int, alpha_k := 1.0):
		var d := _wrap(ang - heading)
		if absf(d) >= 0.95:
			return
		var x := w / 2 + d * PX_PER_RAD
		var tw := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		c.draw_string_outline(f, Vector2(x - tw / 2, 18), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, Color(0, 0, 0, 0.6 * alpha_k))
		c.draw_string(f, Vector2(x - tw / 2, 18), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(GREEN, (1 - absf(d) / 1.15) * alpha_k))
	for i in DIRS.size():
		mark.call(DIRS[i], i * PI / 4, 12 if i % 2 else 14)
	var d_home := Vector2(info.home.x - info.pos.x, info.home.z - info.pos.z).length()
	if d_home > 8:
		mark.call("⌂", _bearing(info.pos, info.home), 15)
	if info.goal is Vector3:
		mark.call("▼", _bearing(info.pos, info.goal), 13)
