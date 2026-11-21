class_name StarMap
extends Control
## The star map: the planets as a level map. It is how you pick where to fly, from the title and from the rocket.
## A route of dots winds from planet to planet in the order they unlock (Data.PLANET_ORDER). Each planet floats in a
## glass bubble with its number, its name, and one star for each level of difficulty won there. A locked planet is a
## dark shape with a padlock. Click a planet, or move to it with the arrow keys or a gamepad and press Enter / A.
## Escape (or B) goes back.
## Show it with Ui.modal_page(StarMap.new({...})), so the game treats it like any open card.
##   o: { title, sub, eyebrow?, sel (the planet that starts with the focus), here? (the planet the crew is on: it
##        opens the one after it), back_label, back: func(), pick: func(planet) }
## Everything is drawn here, with shapes and one small shader for the planets: no picture files.
## To add a planet: give it a place in AT, and a look in PLANET (its "kind" is its place in AT).

## where each planet sits, as a share of the screen; the route starts beside the astronaut
const AT := { "moon": Vector2(0.34, 0.6), "mars": Vector2(0.455, 0.33), "europa": Vector2(0.57, 0.585), "titan": Vector2(0.685, 0.3), "io": Vector2(0.8, 0.56),
	"sahrun": Vector2(0.915, 0.31) }
const START := Vector2(0.225, 0.8)
const R := 66.0                          # the glass bubble's radius
const TOP := Color("#16021b")
const MID := Color("#43085c")
const LOW := Color("#6b2d93")
const LEVELS := ["Not flown yet.", "Won as a Cadet.", "Won as a Commander.", "Won as a Veteran: all three stars!"]

## One ball, shaded like a cartoon: a pattern for each planet, a light from the upper left, a glow around it.
const PLANET := """
shader_type canvas_item;
uniform int kind = 0;
uniform float locked = 0.0;
uniform float spin = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += a * noise(p);
		p = p * 2.03 + 11.7;
		a *= 0.5;
	}
	return s;
}
// round spots, one in about half the squares of a grid: how far from the spot's middle, counted in spot radii
float spot(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 c = vec2(0.3 + 0.4 * hash(i + 1.3), 0.3 + 0.4 * hash(i + 8.1));
	return hash(i + 3.7) > 0.45 ? length(f - c) / (0.12 + 0.16 * hash(i + 5.5)) : 9.0;
}
void fragment() {
	vec2 p = (UV - 0.5) * 2.0 / 0.84;          // the ball fills 84% of the square; the rest is its glow
	float r = length(p);
	vec3 n = vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - r * r)));
	vec2 s = n.xy / (0.55 + 0.45 * n.z) * 1.5 + vec2(spin, 0.0);      // the ground: it bulges like a ball and turns slowly
	vec3 col;
	vec3 halo;
	float halo_a;
	if (kind == 0) {                            // the Moon: grey seas and craters
		col = mix(vec3(0.82, 0.83, 0.88), vec3(0.55, 0.57, 0.67), smoothstep(0.48, 0.6, fbm(s * 1.3 + 4.0)));
		float c = spot(s * 1.7);
		col = mix(col, vec3(0.46, 0.48, 0.59), 1.0 - step(1.0, c));
		col = mix(col, vec3(0.95, 0.96, 1.0), (1.0 - smoothstep(0.0, 0.22, abs(c - 1.0))) * 0.9);
		halo = vec3(0.75, 0.85, 1.0);
		halo_a = 0.3;
	} else if (kind == 1) {                     // Mars: rust, dark plains and two ice caps
		col = mix(vec3(0.9, 0.43, 0.24), vec3(0.62, 0.24, 0.16), smoothstep(0.42, 0.62, fbm(s * 1.6 + 1.0)));
		col = mix(col, vec3(0.98, 0.65, 0.4), smoothstep(0.58, 0.75, fbm(s * 2.4 + 9.0)) * 0.7);
		float cap = n.y + (noise(s * 5.0) - 0.5) * 0.12;
		col = mix(col, vec3(1.0, 0.96, 0.93), smoothstep(0.72, 0.78, cap) + 1.0 - smoothstep(-0.9, -0.84, cap));
		halo = vec3(1.0, 0.5, 0.35);
		halo_a = 0.35;
	} else if (kind == 2) {                     // Europa: pale ice with rusty cracks
		col = mix(vec3(0.92, 0.96, 1.0), vec3(0.6, 0.78, 0.94), smoothstep(0.35, 0.7, fbm(s * 1.4 + 2.0)));
		float l1 = abs(noise(s * 1.7 + 7.0) - 0.5);
		float l2 = abs(noise(s * 2.9 + 21.0) - 0.5);
		col = mix(col, vec3(0.68, 0.35, 0.26), max(1.0 - smoothstep(0.0, 0.04, l1), (1.0 - smoothstep(0.0, 0.035, l2)) * 0.8));
		halo = vec3(0.55, 0.85, 1.0);
		halo_a = 0.45;
	} else if (kind == 3) {                     // Titan: bands of orange haze
		float b = sin(n.y * 9.0 + fbm(s * 1.2) * 4.0);
		col = mix(vec3(0.97, 0.69, 0.25), vec3(0.85, 0.47, 0.16), smoothstep(-0.3, 0.3, b));
		col = mix(col, vec3(1.0, 0.85, 0.5), smoothstep(0.6, 0.95, b) * 0.6);
		halo = vec3(1.0, 0.62, 0.2);
		halo_a = 0.8;
	} else if (kind == 4) {                     // Io: sulfur yellow with volcanoes
		col = mix(vec3(0.97, 0.85, 0.28), vec3(0.95, 0.56, 0.16), smoothstep(0.45, 0.65, fbm(s * 1.5 + 5.0)));
		col = mix(col, vec3(1.0, 0.97, 0.74), smoothstep(0.62, 0.78, fbm(s * 2.2 + 13.0)) * 0.8);
		float v = spot(s * 1.6 + 0.5);
		col = mix(col, vec3(0.88, 0.26, 0.13), 1.0 - smoothstep(0.8, 1.0, v));
		col = mix(col, vec3(0.2, 0.08, 0.08), 1.0 - smoothstep(0.35, 0.5, v));
		halo = vec3(1.0, 0.8, 0.3);
		halo_a = 0.45;
	} else {                                    // Sahrun (made up): golden dunes, rust streaks, a teal sky
		float dn = sin(s.y * 11.0 + sin(s.x * 3.0) * 1.6 + fbm(s * 1.3) * 3.0);
		col = mix(vec3(0.94, 0.71, 0.36), vec3(0.77, 0.5, 0.24), smoothstep(-0.2, 0.6, dn));
		col = mix(col, vec3(0.7, 0.3, 0.18), smoothstep(0.62, 0.8, fbm(s * 2.1 + 17.0)) * 0.7);
		halo = vec3(0.35, 0.78, 0.88);
		halo_a = 0.6;
	}
	if (locked > 0.5) {                         // not open yet: a dark shape with a pink glow
		col = mix(vec3(0.06, 0.05, 0.18), vec3(0.17, 0.11, 0.4), fbm(s * 1.4));
		halo = vec3(1.0, 0.22, 0.62);
		halo_a = 0.75;
	}
	float d = dot(n, normalize(vec3(-0.55, 0.6, 0.6)));
	col *= mix(vec3(0.42, 0.36, 0.62), vec3(1.0), smoothstep(-0.2, 0.3, d));
	col += halo * pow(1.0 - n.z, 3.0) * 0.5;
	col += vec3(1.0 - smoothstep(0.0, 0.34, length((p - vec2(-0.4, -0.45)) * vec2(1.0, 1.7)))) * (locked > 0.5 ? 0.1 : 0.35);
	float disc = 1.0 - smoothstep(0.97, 1.0, r);
	float glow = (1.0 - smoothstep(1.0, 1.19, r)) * halo_a;
	COLOR = vec4(mix(halo, col, disc), max(disc, glow * glow));
}
"""

static var _shader: Shader

var o: Dictionary
var orbs := {}                           # planet -> Orb
var tm := 0.0
var curve := Curve2D.new()
var gold := 0.0                          # the route is gold up to here: a length along the curve
var far := ""                            # the farthest planet you have reached
var sky: Array = []                      # the stars: [x, y, size, colour, speed]
var blob := GradientTexture2D.new()
var astro: TextureRect
var texts: Array[Label] = []             # the small heading, the title, the line under it
var plate: PanelContainer
var p_name: Label
var p_text: Label
var p_note: Label


func _init(opts: Dictionary) -> void:
	o = opts


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	if _shader == null:
		_shader = Shader.new()
		_shader.code = PLANET
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 160:
		sky.append([rng.randf(), rng.randf(), rng.randf_range(0.6, 1.9), [Color.WHITE, Color("#ffb3e6"), Color("#9fe0ff"), Color("#ffe9a8")][rng.randi() % 4], rng.randf_range(0.6, 2.4)])
	blob.gradient = Gradient.new()
	blob.gradient.colors = PackedColorArray([Color.WHITE, Color(1, 1, 1, 0)])
	blob.fill = GradientTexture2D.FILL_RADIAL
	blob.fill_from = Vector2(0.5, 0.5)
	blob.fill_to = Vector2(1, 0.5)
	_astronaut()
	texts = [Ui.label(str(o.get("eyebrow", "STAR MAP")), 13, Style.POWER, 700), Ui.label(str(o.title), 38, Style.INK, 800, "exo2"), Ui.label(str(o.sub), 16, Style.MUTED)]
	for t in texts:
		add_child(t)
	var order: Array = Data.PLANET_ORDER
	var here: String = o.get("here", "")
	far = order[0]
	for i in order.size():
		var ob := Orb.new()
		ob.id = order[i]
		ob.num = i + 1
		ob.P = Data.SITES[ob.id]
		ob.open = Game.unlocked(ob.id) or (i > 0 and order[i - 1] == here)
		ob.stars = int(Game.done.get(ob.id, 0))
		ob.here = ob.id == here
		ob.kind = AT.keys().find(ob.id)
		if ob.stars > 0 or ob.here:
			far = ob.id
		ob.focus_entered.connect(_show.bind(ob))
		ob.pressed.connect(func():
			Au.play("tap")
			o.pick.call(ob.id))
		add_child(ob)
		orbs[ob.id] = ob
	plate = PanelContainer.new()
	plate.add_theme_stylebox_override("panel", Style.box(Color(0.07, 0.03, 0.16, 0.86), 18, Color(1, 1, 1, 0.16), 2, Vector4(20, 12, 20, 12)))
	plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	plate.anchor_left = 0.3
	plate.anchor_right = 0.965
	plate.anchor_top = 1
	plate.anchor_bottom = 1
	plate.offset_top = -22
	plate.offset_bottom = -22
	plate.grow_vertical = Control.GROW_DIRECTION_BEGIN
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	p_name = Ui.label("", 19, Style.INK, 700, "exo2")
	p_text = Ui.label("", 15, Style.INK)
	p_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p_note = Ui.label("", 13, Style.POWER, 600)
	for l in [p_name, p_text, p_note]:
		v.add_child(l)
	plate.add_child(v)
	add_child(plate)
	var back := Button.new()
	back.text = str(o.back_label)
	back.theme_type_variation = "BtnGhost"
	back.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	back.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	back.offset_right = -44
	back.offset_top = 34
	back.pressed.connect(_back)
	add_child(back)
	resized.connect(_layout)
	_layout()
	var first: Orb = orbs.get(o.get("sel", ""), orbs[order[0]])
	first.grab_focus.call_deferred()
	Au.speak(str(o.title) + ". " + str(o.sub))


## You, in your own suit colour, looking up at the map from the corner. Only a picture: the map works without it.
func _astronaut() -> void:
	if not is_instance_valid(Actors.root):
		return
	var vp := SubViewport.new()
	vp.size = Vector2i(440, 620)
	vp.transparent_bg = true
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	var a = Actors.build_astronaut(Game.opts.suit)
	a.group.reparent(vp, false)
	a.group.position = Vector3.ZERO
	a.group.rotation.y = PI - 0.55              # his back to you, turned a little toward the planets
	var cam := Camera3D.new()
	cam.fov = 30
	cam.environment = Environment.new()
	cam.environment.background_mode = Environment.BG_CLEAR_COLOR
	cam.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	cam.environment.ambient_light_color = Color("#7a5cc8")
	cam.environment.ambient_light_energy = 0.9
	vp.add_child(cam)
	cam.look_at_from_position(Vector3(-0.35, 1.5, 3.1), Vector3(0.15, 1.18, 0))
	for l in [[Vector3(2.5, 3, -3), Color("#ff9be0"), 2.2], [Vector3(-3, 2, 2.5), Color("#7fd4ff"), 1.1]]:      # pink from the planets, blue from behind
		var lamp := DirectionalLight3D.new()
		lamp.light_color = l[1]
		lamp.light_energy = l[2]
		vp.add_child(lamp)
		lamp.look_at_from_position(l[0], Vector3(0, 1.2, 0))
	astro = TextureRect.new()
	astro.texture = vp.get_texture()
	astro.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	astro.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(astro)


func _layout() -> void:
	if astro:
		var ah := size.y * 0.76
		astro.size = Vector2(ah * 440 / 620, ah)
		astro.position = Vector2(-astro.size.x * 0.1, size.y - ah + 26)
	var y := size.y * 0.05
	for i in texts.size():
		texts[i].position = Vector2(size.x * 0.045, y)
		y += [22, 50, 0][i]
	var pts: Array = [START * size]
	for p in Data.PLANET_ORDER:
		pts.append(AT[p] * size)
		orbs[p].set_meta("at", AT[p] * size - orbs[p].pivot_offset)
	# a smooth line through the planets that swings a little left and right, like a road on a map
	curve.clear_points()
	for i in pts.size():
		var t: Vector2 = ((pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)]) * 0.3).rotated(0.75 if i % 2 else -0.75)
		curve.add_point(pts[i], -t, t)
	gold = curve.get_closest_offset(AT[far] * size)
	queue_redraw()


func _show(ob: Orb) -> void:
	p_name.text = ob.P.short + "  ·  " + ob.P.place
	p_text.text = ob.P.blurb
	if not ob.open:
		p_note.text = "Locked. Finish " + Data.SITES[Data.PLANET_ORDER[ob.num - 2]].name + " first."
	else:
		p_note.text = ("You are here.  " if ob.here else "") + LEVELS[ob.stars] + "  Click or press Enter to fly here."
	Au.speak(ob.P.short + ". " + p_text.text + " " + p_note.text)


func _back() -> void:
	Au.play("tap")
	o.back.call()


func _input(e: InputEvent) -> void:
	if e.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		_back()


func _process(dt: float) -> void:
	tm += dt
	for p in orbs:
		var ob: Orb = orbs[p]
		ob.position = ob.get_meta("at") + Vector2(0, sin(tm * 0.9 + ob.num * 1.7) * 3)      # the planets float
		(ob.ball.material as ShaderMaterial).set_shader_parameter("spin", tm * 0.025 + ob.num)
	queue_redraw()


func _draw() -> void:
	var w := size.x
	var h := size.y
	draw_polygon([Vector2.ZERO, Vector2(w, 0), Vector2(w, h * 0.62), Vector2(0, h * 0.62)], [TOP, TOP, MID, MID])
	draw_polygon([Vector2(0, h * 0.62), Vector2(w, h * 0.62), Vector2(w, h), Vector2(0, h)], [MID, MID, LOW, LOW])
	# soft clouds of colour, then the stars
	draw_texture_rect(blob, Rect2(w * 0.38, -h * 0.25, w * 0.8, h * 0.9), false, Color(0.9, 0.16, 0.55, 0.2))
	draw_texture_rect(blob, Rect2(-w * 0.2, h * 0.15, w * 0.7, h * 0.9), false, Color(0.25, 0.3, 1.0, 0.2))
	draw_texture_rect(blob, Rect2(w * 0.5, h * 0.45, w * 0.6, h * 0.7), false, Color(0.7, 0.3, 1.0, 0.16))
	for i in sky.size():
		var st: Array = sky[i]
		draw_circle(Vector2(st[0] * w, st[1] * h * 0.86), st[2], Color(st[3], 0.3 + 0.6 * (0.5 + 0.5 * sin(tm * st[4] + i))))
	# far hills, then the dark ground in front
	for layer in [[0.8, 46.0, Color(0.62, 0.42, 0.86, 0.26), 0.0], [0.9, 30.0, Color(0.1, 0.03, 0.2, 0.9), 2.4]]:
		var hill := PackedVector2Array([Vector2(0, h)])
		var x := 0.0
		while x <= w + 40:
			hill.append(Vector2(x, h * layer[0] - absf(sin(x * 0.0043 + layer[3])) * layer[1] - sin(x * 0.013 + layer[3] * 2) * layer[1] * 0.3))
			x += 40
		hill.append(Vector2(w, h))
		draw_colored_polygon(hill, layer[2])
	# the route: gold as far as you have been, pale after that
	var d := 0.0
	while d <= curve.get_baked_length():
		var dot := curve.sample_baked(d)
		if not AT.values().any(func(a: Vector2) -> bool: return (a * size).distance_to(dot) < R + 5):      # the dots stop at each bubble
			draw_circle(dot, 3.6, Color(Style.POWER, 0.75 + 0.25 * sin(tm * 3 - d * 0.03))) if d <= gold else draw_circle(dot, 2.8, Color(1, 1, 1, 0.55))
		d += 17


## One planet on the map: a button, so the mouse, the keyboard and a gamepad all work the same way.
class Orb extends Button:
	static var PLATE: StyleBoxFlat = Style.box(Color(0.16, 0.18, 0.42, 0.95), 8, Color(0.62, 0.7, 1.0, 0.75), 2)
	static var PIN: StyleBoxFlat = Style.box(Style.POWER, 8)
	var id := ""
	var num := 1
	var P: Dictionary
	var open := true
	var stars := 0
	var here := false
	var kind := 0
	var ball := ColorRect.new()

	func _ready() -> void:
		flat = true
		disabled = not open                  # a locked planet can still take the focus, so you can read why
		for st in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
			add_theme_stylebox_override(st, StyleBoxEmpty.new())
		size = Vector2(150, 226)
		pivot_offset = Vector2(75, R + 34)
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if open else Control.CURSOR_FORBIDDEN
		var m := ShaderMaterial.new()
		m.shader = StarMap._shader
		m.set_shader_parameter("kind", kind)
		m.set_shader_parameter("locked", 0.0 if open else 1.0)
		ball.material = m
		ball.size = Vector2(112, 112)
		ball.position = pivot_offset - ball.size / 2
		ball.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(ball)
		mouse_entered.connect(grab_focus)        # pointing at a planet and moving to it with the keys are the same thing
		focus_entered.connect(_hot.bind(true))
		focus_exited.connect(_hot.bind(false))

	func _hot(on: bool) -> void:
		create_tween().tween_property(self, "scale", Vector2.ONE * (1.08 if on else 1.0), 0.15).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		queue_redraw()

	static func _star(c: Vector2, r: float) -> PackedVector2Array:
		var pts := PackedVector2Array()
		for i in 10:
			pts.append(c + Vector2.UP.rotated(i * PI / 5) * (r if i % 2 == 0 else r * 0.45))
		return pts

	func _badge(c: Vector2, r: float, dark: Color, light: Color) -> void:
		draw_circle(c, r, dark)
		draw_circle(c, r - 2.5, light)
		draw_circle(c + Vector2(0, -r * 0.38), r * 0.42, Color(1, 1, 1, 0.3))
		draw_arc(c, r, 0, TAU, 32, Color(1, 1, 1, 0.85), 1.6, true)

	func _draw() -> void:
		var c := pivot_offset
		var hot := has_focus()
		var tint := Color("#8fd6ff") if open else Color("#ff4fa3")
		# the glass bubble: a faint fill, a thin rim, and two bright strokes where the light catches it
		draw_circle(c, R, Color(tint, 0.14 if hot else 0.07))
		draw_arc(c, R, 0, TAU, 72, Color(tint, 1.0 if hot else 0.55), 3.0 if hot else 2.0, true)
		draw_arc(c, R - 7, PI * 1.08, PI * 1.4, 16, Color(1, 1, 1, 0.55), 3.0, true)
		draw_arc(c, R - 7, PI * 1.45, PI * 1.51, 6, Color(1, 1, 1, 0.45), 3.0, true)
		if hot:
			draw_arc(c, R + 7, 0, TAU, 72, Style.POWER, 2.5, true)          # where the focus is
		var y := c.y + R + 3
		var f := Style.font(800, "exo2")
		if open:
			draw_style_box(PLATE, Rect2(c.x - 26, y - 12, 82, 24))
			for i in 3:
				draw_colored_polygon(_star(Vector2(c.x + 5 + i * 19, y + 0.5), 8), Style.AIR if i < stars else Color(1, 1, 1, 0.22))
			_badge(Vector2(c.x - 36, y), 18, Color("#1b55c4"), Color("#3fb0ff"))
			draw_string(f, Vector2(c.x - 54, y + 7), str(num), HORIZONTAL_ALIGNMENT_CENTER, 36, 20, Color.WHITE)
		else:
			_badge(Vector2(c.x, y), 17, Color("#4e5370"), Color("#a3a8c0"))
			draw_arc(Vector2(c.x, y - 2), 4.5, PI, TAU, 10, Color.WHITE, 2.4, true)
			draw_rect(Rect2(c.x - 6.5, y - 2, 13, 9), Color.WHITE)
		draw_string(Style.font(700, "exo2"), Vector2(0, y + 44), P.short, HORIZONTAL_ALIGNMENT_CENTER, size.x, 19, Style.INK if open else Style.MUTED)
		if here:
			draw_style_box(PIN, Rect2(c.x - 52, c.y - R - 32, 104, 20))
			draw_colored_polygon(PackedVector2Array([Vector2(c.x - 6, c.y - R - 13), Vector2(c.x + 6, c.y - R - 13), Vector2(c.x, c.y - R - 5)]), Style.POWER)
			draw_string(f, Vector2(c.x - 52, c.y - R - 17), "YOU ARE HERE", HORIZONTAL_ALIGNMENT_CENTER, 104, 11, Color("#2a1c00"))
