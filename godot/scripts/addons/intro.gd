extends Node
## The landing film that opens a mission (a port of js/intro.js). Everything is seen through the astronaut's eyes:
##   1. the descent, watched through the lander window
##   2. the hatch, and the first bootprint
##   3. the walk across the dust
##   4. sitting down on a rock and taking in the view
## It uses the real game world (no video), so the outpost you see is the one you will run. Inside the lander the
## sound is clear; once the hatch opens you hear the place itself, and music joins for the last view.

## when each shot starts (seconds)
const TM := { "descent": 3.4, "land": 17.4, "fade1": 20.6, "step": 23.8, "walk": 33.0, "cut": 44.2, "walk2": 45.4, "sit": 52.0, "vista": 57.4, "title": 69.2, "fade2": 72.6, "end": 73.8 }
const EYE := 1.72
const STEP := 0.75
const SEAT_HIP := 0.15          # sitting, your hips are this far above the rock's top (the suit is padded)
const PRINT_AHEAD := 0.67       # the first print, this far ahead of where the boot stood: past the pad's sloping rim
# the legs: the hips below your eyes, the bones of the leg
const HIP := -0.72
const HIP_SIT := -0.72
const THIGH := 0.42
const SHIN := 0.38
const SOLE_Y := 0.15            # the middle of the boot's sole, below and ahead of the ankle
const SOLE_Z := 0.085
const SIDE := [0.17, -0.17]     # [your left leg, your right leg], across the body
const REACH := { "fwd": 0.26, "drop": 0.43 }      # how far the body leans out and sinks while the boot reaches down
const VO := "res://assets/audio/landing/"

var st = null
var ui := {}
var _hidden: Array = []


static func _clamp(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))


static func _ease(u: float) -> float:
	u = _clamp(u, 0, 1)
	return u * u * (3 - 2 * u)


static func _seg(t: float, a: float, b: float) -> float:
	return _clamp((t - a) / (b - a), 0, 1)


static func _near(a: float, ref: float) -> float:
	return a + TAU * roundf((ref - a) / TAU)


# ---------- what is said, and when ----------
# vo: the recorded line in assets/audio/landing/ (each one fits before the next line starts). Lines without a
# recording fall back to the read-aloud voice.
static func _script(s: Dictionary) -> Array:
	var moon: bool = s.site.id == "moon"
	var dw: String = str(s.site.dayWord).to_lower() + "s"
	var homes := { 5: "13-home-5-days", 8: "14-home-8-days", 10: "15-home-10-days" } if moon else { 5: "21-home-5-sols", 8: "22-home-8-sols", 10: "23-home-10-sols" }
	var home = homes.get(int(s.totalSols))
	return [
		{ "t": 4.6, "who": "Mission Control", "text": "Outpost One, you are GO for landing.", "dur": 3.0, "radio": true, "vo": "01-go-for-landing" },
		{ "t": 8.4, "text": "There it is. The robots finished building it last week.", "dur": 3.4, "vo": "05-there-it-is" },
		{ "t": 12.6, "who": "Mission Control", "text": "Sixty metres… thirty… the engine is kicking up dust!", "dur": 3.6, "radio": true, "vo": "02-sixty-metres" },
		{ "t": TM.land + 0.3, "who": "Mission Control", "text": "Contact! Engines off.", "dur": 2.3, "radio": true, "vo": "03-contact" },
		{ "t": TM.land + 2.8, "text": "We made it.", "dur": 1.9, "vo": "06-we-made-it" },
		{ "t": TM.step + 0.4, "text": "Here goes. My first step on " + str(s.site.name) + ".", "dur": 2.6, "vo": "09-first-step-moon" if moon else "17-first-step-mars" },
		{ "t": TM.step + 3.7, "text": "My first bootprint. With no wind and no rain, it could stay here for a million years." if moon else "My first bootprint. One day the wind will sweep it away. But not today.",
			"dur": 4.2, "vo": "10-bootprint-moon" if moon else "18-bootprint-mars" },
		{ "t": TM.walk + 1.8, "text": "No air. No sound. Only my own breathing." if moon else "Thin, cold air, and a sky the colour of butterscotch.", "dur": 3.4, "vo": "11-no-air-moon" if moon else "19-thin-air-mars" },
		{ "t": TM.walk + 6.0, "text": "And gravity so gentle that every step is a little flight." if moon else "And gravity so gentle that I weigh about a third of what I do on Earth.", "dur": 3.8, "vo": "12-gravity-moon" if moon else "20-gravity-mars" },
		{ "t": TM.walk2 + 1.2, "text": "That rock looks like a good seat.", "dur": 3.0, "vo": "07-good-seat" },
		{ "t": TM.sit + 2.7, "text": "Stop. Sit. Breathe.", "dur": 2.3, "vo": "08-stop-sit-breathe" },
		{ "t": TM.vista + 2.6, "text": "That is the outpost. My home for the next " + str(s.totalSols) + " " + dw + ".", "dur": 3.6, "vo": home },
		{ "t": TM.vista + 6.8, "text": "And that is Earth. Everyone I have ever known is on that small blue ball." if moon else "Somewhere in that sky, Earth is just a pale dot of light.", "dur": 3.9, "vo": "16-earth-moon" if moon else "24-earth-mars" },
		{ "t": TM.vista + 11.0, "who": "Mission Control", "text": "Ready when you are, Commander.", "dur": 2.6, "radio": true, "vo": "04-ready-commander" },
	]


func _say(c: Dictionary) -> void:
	ui.who.text = str(c.get("who", "")).to_upper()
	ui.who.visible = c.has("who")
	ui.line.text = c.text
	ui.line.add_theme_font_override("font", Style.font(500, "lexend") if not c.get("radio", false) else _italic())
	ui.want.line = 1.0
	st.lineOff = c.t + c.dur
	if c.get("radio", false):
		Au.play("radio")
	# the recorded voice plays with sound on (or with read-aloud on, in place of the system voice)
	var vo = c.get("vo")
	if vo and (Au.sound_on() or Au.reading_on()) and ResourceLoader.exists(VO + vo + ".mp3"):
		Au.voice(VO + vo + ".mp3")
	else:
		Au.speak(c.text)


var _ital: FontVariation = null
func _italic() -> Font:
	if _ital == null:
		_ital = FontVariation.new()
		_ital.base_font = Style.font(500, "lexend")
		_ital.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.2, 1), Vector2.ZERO)
	return _ital


func _title(small := "", big := "", sub := "") -> void:
	if small == "" and big == "":
		ui.want.title = 0.0
		return
	ui.small.text = small.to_upper()
	ui.big.text = big
	ui.sub.text = sub.to_upper()
	ui.big.visible = big != ""
	var minor := big == ""
	ui.small.add_theme_font_size_override("font_size", 21 if minor else 14)
	ui.small.add_theme_color_override("font_color", Color.WHITE if minor else Style.POWER)
	var sky: bool = st != null and st.t > TM.vista
	ui.big.add_theme_font_size_override("font_size", 64 if sky else 84)
	ui.title_box.alignment = BoxContainer.ALIGNMENT_BEGIN if sky else BoxContainer.ALIGNMENT_CENTER
	ui.title_pad.custom_minimum_size.y = Ui.root.size.y * 0.15 if sky else 0.0
	ui.want.title = 1.0


func _cls(name: String, on: bool) -> void:
	ui.want[name] = 1.0 if on else 0.0


# ---------- the overlay: lander window, helmet visor, cinema bars, words ----------
const OVERLAY := """
shader_type canvas_item;
uniform float win = 0.0;
uniform float visor = 0.0;
uniform float tt = 0.0;
uniform vec2 res = vec2(1280.0, 720.0);
float rr(vec2 p, vec2 hs, vec2 rad) {
	vec2 q = abs(p) - (hs - rad);
	if (q.x > 0.0 && q.y > 0.0) { return (length(q / rad) - 1.0) * min(rad.x, rad.y); }
	return max(q.x - rad.x, q.y - rad.y);
}
vec4 over(vec4 top, vec4 under) {
	float a = top.a + under.a * (1.0 - top.a);
	return a < 0.0001 ? vec4(0.0) : vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}
void fragment() {
	vec2 p = UV * res;
	vec4 col = vec4(0.0);
	if (visor > 0.001) {
		// the helmet: its rim darkens the edges, a faint glint crosses the glass, your breath fogs the bottom
		float e = length((UV - vec2(0.5, 0.46)) / vec2(0.66, 0.74));
		vec4 rim = e < 0.55 ? vec4(1.0, 0.77, 0.35, 0.03)
			: e < 0.76 ? mix(vec4(1.0, 0.77, 0.35, 0.03), vec4(0.024, 0.031, 0.063, 0.5), (e - 0.55) / 0.21)
			: mix(vec4(0.024, 0.031, 0.063, 0.5), vec4(0.016, 0.024, 0.047, 1.0), clamp((e - 0.76) / 0.21, 0.0, 1.0));
		float g = 0.5 + dot(UV - 0.5, vec2(0.848, 0.53));
		float glint = 0.07 * (smoothstep(0.30, 0.38, g) - smoothstep(0.38, 0.46, g));
		vec2 b = (p - vec2(0.5 * res.x, res.y + 0.08 * res.y - 0.17 * res.y)) / vec2(0.35 * res.x, 0.17 * res.y);
		float ph = fract(tt / 3.6);
		float breath = ph < 0.35 ? 0.2 * smoothstep(0.0, 0.35, ph) : ph < 0.6 ? mix(0.2, 0.05, smoothstep(0.35, 0.6, ph)) : mix(0.05, 0.0, smoothstep(0.6, 1.0, ph));
		float fog = 0.5 * (1.0 - smoothstep(0.0, 0.68, length(b))) * breath;
		col = over(vec4(1.0, 1.0, 1.0, glint), rim);
		col = over(vec4(0.86, 0.92, 1.0, fog), col);
		col.a *= visor;
	}
	if (win > 0.001) {
		// the lander window: dark hull all round a rounded pane, a lit gasket, the faint sheen of the glass
		vec2 hs = 0.5 * vec2(min(0.84 * res.x, 1.5 * res.y), min(0.72 * res.y, 0.58 * res.x));
		vec2 rad = vec2(0.48 * hs.x, 0.72 * hs.y);
		float d = rr(p - vec2(0.5, 0.47) * res, hs, rad);
		vec3 hull = mix(vec3(0.085, 0.095, 0.115), vec3(0.03, 0.035, 0.045), UV.y);
		hull += vec3(0.22, 0.24, 0.27) * (1.0 - smoothstep(2.0, 12.0, d)) * step(0.0, d);
		hull *= 0.85 + 0.15 * smoothstep(12.0, 90.0, d);
		float a = smoothstep(-1.0, 1.0, d);
		vec4 glass = vec4(0.65, 0.78, 0.92, 0.03 + 0.07 * smoothstep(-110.0, 0.0, d));
		vec4 w = mix(glass, vec4(hull, 1.0), a);
		w.a *= win;
		col = over(w, col);
	}
	COLOR = col;
}
"""


func _label(size: int, color: Color, weight := 600, family := "lexend") -> Label:
	var l := Label.new()
	l.add_theme_font_override("font", Paint.font(weight, family))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	l.add_theme_constant_override("outline_size", 8)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	l.add_theme_constant_override("shadow_offset_y", 3)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _build_ui() -> void:
	if ui.get("root") and is_instance_valid(ui.root):
		return
	var root := Control.new()
	root.name = "Cine"
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	Ui.root.add_child(root)
	ui.root = root
	var fx := ColorRect.new()
	fx.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sm := ShaderMaterial.new()
	sm.shader = Shader.new()
	sm.shader.code = OVERLAY
	fx.material = sm
	root.add_child(fx)
	ui.fx = fx
	# the cinema bars
	ui.bars = []
	for top in [true, false]:
		var b := ColorRect.new()
		b.color = Color.BLACK
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.anchor_right = 1
		b.anchor_top = 0.0 if top else 1.0
		b.anchor_bottom = 0.0 if top else 1.0
		root.add_child(b)
		ui.bars.append(b)
	# the suit's read-out at the top
	var data := _label(13, Color("#8dffc0"), 600, "mono")
	data.add_theme_color_override("font_outline_color", Color(0.3, 1, 0.6, 0.25))
	data.add_theme_constant_override("outline_size", 6)
	data.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	data.grow_horizontal = Control.GROW_DIRECTION_BOTH
	root.add_child(data)
	ui.data = data
	# the big titles
	var tb := VBoxContainer.new()
	tb.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tb.alignment = BoxContainer.ALIGNMENT_CENTER
	tb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tb.add_theme_constant_override("separation", 6)
	root.add_child(tb)
	ui.title_box = tb
	ui.title_pad = Control.new()
	ui.title_pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tb.add_child(ui.title_pad)
	ui.small = _label(14, Style.POWER, 600)
	ui.big = _label(84, Color.WHITE, 700)
	ui.big.add_theme_constant_override("outline_size", 14)
	ui.sub = _label(17, Color("#dfe5ff"), 500)
	for l in [ui.small, ui.big, ui.sub]:
		tb.add_child(l)
	# the spoken line
	var lb := VBoxContainer.new()
	lb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lb.anchor_left = 0.5
	lb.anchor_right = 0.5
	lb.anchor_top = 1
	lb.anchor_bottom = 1
	lb.grow_horizontal = Control.GROW_DIRECTION_BOTH
	lb.grow_vertical = Control.GROW_DIRECTION_BEGIN
	lb.alignment = BoxContainer.ALIGNMENT_END
	root.add_child(lb)
	ui.line_box = lb
	ui.who = _label(12, Style.AIR, 700, "mono")
	ui.line = _label(24, Color.WHITE, 500)
	ui.line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lb.add_child(ui.who)
	lb.add_child(ui.line)
	# skip
	var sk := Button.new()
	sk.text = "Skip ▶▶"
	sk.theme_type_variation = "BtnGhost"
	sk.focus_mode = Control.FOCUS_NONE
	sk.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	sk.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	sk.grow_vertical = Control.GROW_DIRECTION_BEGIN
	sk.offset_right = -18
	sk.offset_bottom = -18
	sk.modulate.a = 0.75
	sk.pressed.connect(func(): if Game.mode == "intro": skip())
	root.add_child(sk)
	ui.k = { "win": 0.0, "visor": 0.0, "soft": 0.0, "data": 0.0, "title": 0.0, "line": 0.0, "bars": 0.0 }
	ui.want = ui.k.duplicate()


func _layout_ui() -> void:
	var vs: Vector2 = Ui.root.size
	for i in 2:
		var b: ColorRect = ui.bars[i]
		var h: float = vs.y * 0.11 * _ease(ui.k.bars)
		if i == 0:
			b.offset_top = 0
			b.offset_bottom = h
		else:
			b.offset_top = -h
			b.offset_bottom = 0
	ui.data.offset_top = vs.y * 0.07
	var lw := minf(640.0, vs.x * 0.86)
	ui.line.custom_minimum_size.x = lw
	ui.line_box.offset_left = -lw / 2
	ui.line_box.offset_right = lw / 2
	ui.line_box.offset_bottom = -vs.y * 0.15 + (1 - ui.k.line) * 8
	var sm: ShaderMaterial = ui.fx.material
	sm.set_shader_parameter("res", vs)
	sm.set_shader_parameter("win", ui.k.win)
	sm.set_shader_parameter("visor", ui.k.visor * (1 - 0.45 * ui.k.soft))
	sm.set_shader_parameter("tt", st.t if st else 0.0)
	ui.data.modulate.a = ui.k.data * 0.9
	ui.title_box.modulate.a = ui.k.title
	ui.line_box.modulate.a = ui.k.line


func _process(dt: float) -> void:
	if not ui.get("root") or not is_instance_valid(ui.root) or not ui.root.visible:
		return
	# each part fades at its own pace, as in the web version's transitions
	var rates := { "win": 1 / 0.4, "visor": 1 / 1.2, "soft": 1 / 1.2, "data": 1 / 0.5, "title": 1 / 1.1, "line": 1 / 0.5, "bars": 1 / 1.6 }
	for k in ui.k:
		ui.k[k] = move_toward(ui.k[k], ui.want[k], dt * rates[k])
	_layout_ui()


# ---------- your own body, seen when you look down ----------
# The legs are a real chain (hip, knee, ankle). Each frame every boot is given a spot on the ground and the leg bends
# to put its sole flat on it, so the boots stand on the pad, step down onto the dust and rest in front of the rock.
class MB2:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	func tri(a: Vector3, b: Vector3, c: Vector3, nrm: Vector3) -> void:
		if (b - a).cross(c - a).dot(nrm) > 0:          # Godot's front faces wind clockwise
			var t := b
			b = c
			c = t
		for p in [a, b, c]:
			v.append(p)
			n.append(nrm)
	func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, nrm: Vector3) -> void:
		tri(a, b, c, nrm)
		tri(a, c, d, nrm)
	func mesh() -> ArrayMesh:
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_NORMAL] = n
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		return m


## the outline of the sole seen from above, toe ahead (x across, y ahead): as long and wide as the print it leaves
static func _sole_shape(k: float) -> PackedVector2Array:
	var p := PackedVector2Array()
	for i in 13:
		var a := PI + PI * i / 12.0
		p.append(Vector2(cos(a) * 0.098 * k, -0.115 * k + sin(a) * 0.098 * k))     # the heel
	for i in 13:
		var a := PI * i / 12.0
		p.append(Vector2(cos(a) * 0.12 * k, 0.11 * k + sin(a) * 0.12 * k))         # the wider toe
	return p


## that outline made solid and laid flat, its underside at height y, its middle at z (ahead)
static func _slab(shape: PackedVector2Array, depth: float, grow: float, y: float, z: float) -> ArrayMesh:
	var outl: PackedVector2Array = shape
	if grow > 0:
		var off := Geometry2D.offset_polygon(shape, grow, Geometry2D.JOIN_ROUND)
		if off.size():
			outl = off[0]
	var mn := INF
	var mx := -INF
	for q in outl:
		mn = minf(mn, q.y)
		mx = maxf(mx, q.y)
	var dz := z - (mn + mx) / 2
	var b := MB2.new()
	var top := y + depth
	var tris := Geometry2D.triangulate_polygon(outl)
	for i in range(0, tris.size(), 3):
		var A := outl[tris[i]]
		var B := outl[tris[i + 1]]
		var C := outl[tris[i + 2]]
		b.tri(Vector3(A.x, top, A.y + dz), Vector3(B.x, top, B.y + dz), Vector3(C.x, top, C.y + dz), Vector3.UP)
		b.tri(Vector3(A.x, y, A.y + dz), Vector3(B.x, y, B.y + dz), Vector3(C.x, y, C.y + dz), Vector3.DOWN)
	var n := outl.size()
	var cx := Vector2.ZERO
	for q in outl:
		cx += q
	cx /= n
	for i in n:
		var A := outl[i]
		var B := outl[(i + 1) % n]
		var mid := (A + B) / 2
		var nn := Vector2(B.y - A.y, -(B.x - A.x)).normalized()
		if nn.dot(mid - cx) < 0:
			nn = -nn
		b.quad(Vector3(A.x, y, A.y + dz), Vector3(B.x, y, B.y + dz), Vector3(B.x, top, B.y + dz), Vector3(A.x, top, A.y + dz), Vector3(nn.x, 0, nn.y))
	return b.mesh()


## a part of a torus in the XY plane (like three.js TorusGeometry with an arc)
static func _arc_torus(r: float, tube: float, arc: float, seg := 16, sides := 6) -> ArrayMesh:
	var b := MB2.new()
	for i in seg:
		for j in sides:
			var pts := []
			var nrm := []
			for d in [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]:
				var u: float = arc * d[0] / seg
				var w: float = TAU * d[1] / sides
				var c := Vector3(cos(u) * r, sin(u) * r, 0)
				var o := Vector3(cos(u) * cos(w), sin(u) * cos(w), sin(w))
				pts.append(c + o * tube)
				nrm.append(o)
			var nn: Vector3 = (nrm[0] + nrm[1] + nrm[2] + nrm[3]).normalized()
			b.quad(pts[0], pts[1], pts[2], pts[3], nn)
	return b.mesh()


static func _capsule(r: float, length: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = length + 2 * r
	c.radial_segments = 12
	c.rings = 4
	return c


static func _part(parent: Node3D, mesh: Mesh, m: Material, x := 0.0, y := 0.0, z := 0.0) -> MeshInstance3D:
	var o := Mats.add(parent, mesh, m, x, y, z, true)
	o.rotation_order = EULER_ORDER_XYZ
	return o


func _build_rig(color: int) -> Dictionary:
	var g := Node3D.new()
	g.name = "LandingRig"
	var white := Mats.soft(0xf5f6fa)
	var accent := Mats.soft(color)
	var grey := Mats.soft(0xcfd3de)
	var boot_m := Mats.soft(0x4f545c)        # the same grey boots the astronaut wears in the game
	var sole_m := Mats.soft(0x262b3d)
	var cap_m := Mats.soft(0xc2c7d2)
	var sole := _slab(_sole_shape(1), 0.03 + 0.024, 0.012, -SOLE_Y, SOLE_Z)
	var upper := _slab(_sole_shape(0.8), 0.02 + 0.06, 0.022, -SOLE_Y + 0.05, SOLE_Z + 0.006)
	var strap := _arc_torus(0.125, 0.018, PI)
	# a chunky moon boot, built round the ankle: a thick tread sole, a padded upper, a rubber toe cap, a strap over
	# the instep and a padded cuff in the suit's colour
	var boot := func(ankle: Node3D) -> void:
		_part(ankle, sole, sole_m)
		_part(ankle, upper, boot_m)
		_part(ankle, Mats.ball(1, 18, 12), boot_m, 0, -0.045, 0.035).scale = Vector3(0.1, 0.08, 0.135)            # the instep
		_part(ankle, Mats.half_ball(1, 18, 8), cap_m, 0, -0.097, 0.2).scale = Vector3(0.112, 0.072, 0.115)        # toe cap
		_part(ankle, Mats.cyl(0.122, 0.132, 0.2, 18), boot_m, 0, 0, -0.02)                                         # the shaft round your ankle
		_part(ankle, Mats.torus(0.124, 0.028, 24, 8), accent, 0, 0.1, -0.02)                                        # the padded cuff
		_part(ankle, strap, accent, 0, -0.125, 0.15)                                                                # the strap over the forefoot
		_part(ankle, Mats.box(0.035, 0.03, 0.05), cap_m, 0.105, -0.06, 0.15).rotation.z = 0.5                      # its buckle
	var legs := []
	for x in SIDE:
		var hip := Node3D.new()
		hip.position = Vector3(x, HIP, 0.06)
		g.add_child(hip)
		_part(hip, _capsule(0.125, 0.2), white, 0, -THIGH / 2, 0)
		var knee := Node3D.new()
		knee.position = Vector3(0, -THIGH, 0)
		hip.add_child(knee)
		_part(knee, Mats.ball(0.135, 14, 10), grey)
		_part(knee, _capsule(0.115, 0.18), white, 0, -SHIN / 2, 0)
		var ankle := Node3D.new()
		ankle.position = Vector3(0, -SHIN, 0)
		knee.add_child(ankle)
		boot.call(ankle)
		legs.append({ "hip": hip, "knee": knee, "ankle": ankle, "a": 0.0 })
	# sitting, your gloved hands rest on your thighs, the forearms coming back from them to your elbows
	var hands := Node3D.new()
	g.add_child(hands)
	var hand := []
	for x in SIDE:
		var h := Node3D.new()
		h.rotation_order = EULER_ORDER_XYZ
		hands.add_child(h)
		var sg := signf(x)
		_part(h, Mats.ball(1, 14, 10), accent).scale = Vector3(0.068, 0.045, 0.085)                               # the glove
		_part(h, _capsule(0.022, 0.05), accent, -sg * 0.06, 0.005, 0.01).rotation = Vector3(1.3, 0, sg * 0.5)     # its thumb
		_part(h, Mats.torus(0.066, 0.016, 16, 6), grey, 0, 0.004, -0.075).rotation.x = PI / 2                       # the cuff ring
		var arm := _part(h, _capsule(0.07, 0.26), white, 0, 0, -0.22)                                               # the forearm
		h.set_meta("arm", arm)
		hand.append(h)
	World.root.add_child(g)
	# an unseen body that still throws your shadow across the ground
	var sh := Node3D.new()
	for p in [[_capsule(0.34, 0.9), 0.0, -0.85, -0.05], [Mats.ball(0.4, 10, 8), 0.0, 0.02, -0.05], [Mats.box(0.6, 0.8, 0.34), 0.0, -0.6, -0.4]]:
		var m := MeshInstance3D.new()
		m.mesh = p[0]
		m.position = Vector3(p[1], p[2], p[3])
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		sh.add_child(m)
	World.root.add_child(sh)
	return { "group": g, "legs": legs, "hands": hands, "hand": hand, "shadow": sh }


## where boot i stands when the body is at (x, z) facing yaw: under its hip, plus `ahead` metres; on the ground
## (the launch pad counts as ground: Actors.ground_at knows its height)
static func _spot(i: int, x: float, z: float, yaw: float, ahead := 0.0) -> Dictionary:
	var s: float = SIDE[i]
	var f := 0.06 + SOLE_Z + ahead
	var c := cos(yaw)
	var n := sin(yaw)
	var px := x + c * s + n * f
	var pz := z - n * s + c * f
	return { "x": px, "z": pz, "y": Actors.ground_at(px, pz), "toe": 0.0 }


## a boot swinging from spot a to spot b (u: 0 → 1): it lifts first, travels, and comes down last, clearing edges
static func _swing(a: Dictionary, b: Dictionary, u: float, lift := 0.12) -> Dictionary:
	var h := _ease(_seg(u, 0.12, 0.92))
	var v := _ease(_seg(u, 0.4, 1))
	var arc := sin(PI * _clamp(u, 0, 1))
	return { "x": lerpf(a.x, b.x, h), "z": lerpf(a.z, b.z, h), "y": lerpf(a.y, b.y, v) + lift * arc, "toe": 0.28 * arc * (1.0 if b.y < a.y else -0.4) }


## bend leg l so the sole of its boot lies flat on point p (in the world): two bones, the knee bending forward
func _reach(l: Dictionary, p: Dictionary) -> void:
	var g: Vector3 = st.rig.group.position
	var c := cos(st.bodyYaw)
	var n := sin(st.bodyYaw)
	var wx: float = p.x - g.x
	var wz: float = p.z - g.z
	var tz := wx * n + wz * c                  # the point in the body's own frame (z ahead)
	var ty: float = p.y - g.y
	var hip: Node3D = l.hip
	var dy := ty + SOLE_Y - hip.position.y
	var dz := tz - SOLE_Z - hip.position.z
	var d := _clamp(Vector2(dy, dz).length(), 0.12, THIGH + SHIN - 0.002)
	var a := atan2(dz, -dy) + acos(_clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1))
	var bend := PI - acos(_clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1))
	hip.rotation.x = -a
	(l.knee as Node3D).rotation.x = bend
	(l.ankle as Node3D).rotation.x = a - bend + float(p.get("toe", 0.0))     # keep the boot level (or tip its toe)
	l.a = a


func _pose_rig() -> void:
	var r: Dictionary = st.rig
	var e: Dictionary = st.eye
	var q: float = st.sitQ
	r.group.visible = st.body
	r.shadow.visible = st.body
	if not st.body:
		return
	# when you bend to look at your feet, your eyes move ahead of your body (and to one side, to see past a leg)
	var fs := sin(st.bodyYaw)
	var fc := cos(st.bodyYaw)
	r.group.position = Vector3(e.x - fs * st.lean - fc * st.headSide, e.y + st.duck, e.z - fc * st.lean + fs * st.headSide)
	r.group.rotation.y = st.bodyYaw
	r.shadow.position = r.group.position
	r.shadow.rotation.y = st.bodyYaw
	r.shadow.scale.y = lerpf(1, 0.72, q)
	for i in 2:
		var l: Dictionary = r.legs[i]
		(l.hip as Node3D).position.y = lerpf(HIP, HIP_SIT, q)
		_reach(l, st.feet[i])
		# sitting, your hands rest on the outside of your thighs, not over the knees, so the boots still show past them
		var h: Node3D = r.hand[i]
		var k := 0.55
		var hp: Vector3 = (l.hip as Node3D).position
		var hy: float = hp.y - cos(l.a) * THIGH * k + 0.12
		var hz: float = hp.z + sin(l.a) * THIGH * k
		var sx: float = SIDE[i]
		h.position = Vector3(sx * 1.55, hy, hz)
		h.rotation = Vector3(PI / 2 - l.a, 0, -signf(sx) * 0.35)       # lying along the thigh, turned a little inward
		# the forearm points back toward the elbow, beside your body
		var to := Vector3(sx * 1.95 - h.position.x, -0.56 - hy, -0.1 - hz).normalized()
		var local := h.quaternion.inverse() * to
		var arm: MeshInstance3D = h.get_meta("arm")
		arm.quaternion = Quaternion(Vector3.UP, local)
		arm.position = local * 0.22
	r.hands.visible = q > 0.55


func _set_cam() -> void:
	var c: Dictionary = World.cam.cine
	var e: Dictionary = st.eye
	var cp := cos(e.pitch)
	c.pos = Vector3(e.x, e.y, e.z)
	c.look = Vector3(e.x + sin(e.yaw) * cp * 10, e.y + sin(e.pitch) * 10, e.z + cos(e.yaw) * cp * 10)
	c.fov = e.fov
	c.roll = e.roll


func _footfall(x: float, z: float, yaw: float, big: bool) -> void:
	World.print_at(x, z, yaw, 0.26, 0.5)
	World.dust(x, z, 16 if big else 3, 1.8 if big else 0.9, 0.5 if big else 0.3)
	Au.play("land" if big else "step")


# ---------- shot 1: the descent, through the lander window ----------
func _shot_descent(t: float, dt: float) -> void:
	var e: Dictionary = st.eye
	var p: Dictionary = st.pad
	var d: Dictionary = st.dir
	var rk: Dictionary = Base.P.rocket
	var landed: bool = t >= TM.land
	var u := _seg(t, TM.descent, TM.land)
	var k := 1 - u
	var T1: float = TM.land - TM.descent
	var alt := 0.0 if landed else 250 * pow(k, 1.8)
	var vel := 0.0 if landed else 250 * 1.8 * pow(k, 0.8) / T1
	var back := 150 * k * k
	var side := 24 * k * k
	var ox: float = -d.x * back + d.z * side
	var oz: float = -d.z * back - d.x * side
	(rk.group as Node3D).position = Vector3(ox, alt, oz)
	(rk.flame as Node3D).visible = not landed
	(rk.flame as Node3D).scale = Vector3(1, 0.7 + randf() * 0.8, 1)
	(rk.light as OmniLight3D).light_energy = 0.0 if landed else 4 + randf() * 2
	e.x = p.x + ox + d.x * 2.95
	e.z = p.z + oz + d.z * 2.95
	e.y = p.y + alt + 12.4
	e.yaw = st.dirYaw + 0.3 * k * k + sin(t * 0.5) * 0.04 * k
	e.pitch = lerpf(-1.0, -0.3, _ease(u)) + _ease(_seg(t, TM.land + 0.2, TM.land + 2.6)) * 0.17
	e.roll = sin(t * 0.9) * 0.035 * k
	e.fov = 58.0
	if not landed:
		World.cam.shake = maxf(World.cam.shake, 0.04 + 0.22 * u * u)
		Au.loop("descent", { "rate": 0.85 + u * 0.3, "vol": 0.55 + 0.45 * u })
		st.rum -= dt
		if st.rum <= 0:
			st.rum = 0.24
			Au.play("rumble")
		if alt < 60:
			var n := World.rate((1 - alt / 60) * 9, dt)
			var gy := Terrain.height(p.x + ox, p.z + oz) + 0.4
			for i in n:
				var a := randf() * TAU
				var r0 := 2 + randf() * 4
				var sp := 12 + randf() * 22
				World.emit(p.x + ox + cos(a) * r0, gy, p.z + oz + sin(a) * r0, { "vx": cos(a) * sp, "vy": 0.4 + randf() * 1.6, "vz": sin(a) * sp, "life": 1.25, "size": 1.5, "grow": 3.6, "color": st.dustCol, "alpha": 0.42, "grav": 0.0 })
	ui.data.text = ("ALT 000 m   ·   ENGINE OFF   ·   " + ("MOON" if st.moon else "MARS") + " SURFACE") if landed else \
		("ALT %03d m   ·   DESCENT %.1f m/s   ·   FUEL %d%%" % [roundi(alt), vel, roundi(11 - 6 * u)])


func _touchdown() -> void:
	var p: Dictionary = st.pad
	Au.stop_loop("descent")
	Au.play("touchdown")
	World.cam.shake = 0.75
	for i in 90:
		var a := randf() * TAU
		var sp := 6 + randf() * 16
		World.emit(p.x + cos(a) * 4, p.y + 0.5, p.z + sin(a) * 4, { "vx": cos(a) * sp, "vy": 1 + randf() * 3, "vz": sin(a) * sp, "life": 2.2 + randf(), "size": 1.3, "grow": 3.6, "color": st.dustCol, "alpha": 0.34, "grav": World.gravity * 0.1 })


# ---------- shot 2: off the landing pad, the first bootprint ----------
# You stand at the edge of the launch pad (0.3 m above the dust, with a sloping rim). To touch the dust you bend your
# left knee and lean out, and your right boot reaches past the rim; then you pull it back to look at the print,
# and step down for real.
func _shot_step(t: float) -> void:
	var e: Dictionary = st.eye
	var tau: float = t - TM.step
	var S: Dictionary = st.S
	var f: Dictionary = st.e
	var yaw: float = st.yawE
	var r := _ease(_seg(tau, 1.3, 2.3)) * (1 - _ease(_seg(tau, 3.2, 4.1))) + _ease(_seg(tau, 6.0, 6.9))
	var b := _ease(_seg(tau, 6.9, 8.0))
	var up := _ease(_seg(tau, 7.6, 9.2))
	var go := lerpf(REACH.fwd * r, STEP, b)
	var drop: float = REACH.drop * r * (1 - b)
	st.lean = 0.34 * (1 - up)                 # bending over to see your boots: your head goes out ahead of them
	# and while the right boot goes out, you lean over to its outer side to watch it (your own leg would hide it)
	st.headSide = -0.2 * _ease(_seg(tau, 0.8, 1.8)) * (1 - _ease(_seg(tau, 6.6, 8.2)))
	var lx := cos(yaw)
	var lz := -sin(yaw)                   # your left
	e.x = S.x + f.x * (go + st.lean) + lx * st.headSide
	e.z = S.z + f.z * (go + st.lean) + lz * st.headSide
	e.y = lerpf(st.padTop, st.groundP1, b) - drop + EYE - 0.06 * (1 - up) + sin(t * 1.3) * 0.006
	e.yaw = yaw + sin(t * 0.6) * 0.02
	st.bodyYaw = yaw
	e.pitch = lerpf(-1.34, -0.05, up)
	e.roll = 0.0
	e.fov = 54.0
	# the right boot goes out to the print and back (and out again); the left one follows it down at the end
	st.feet[1] = _swing(st.home[1], st.print[1], r, 0.14)
	st.feet[0] = _swing(st.home[0], st.print[0], b, 0.14)
	if not st.fx.has("r") and tau >= 2.3:
		st.fx.r = 1
		_footfall(st.print[1].x, st.print[1].z, yaw, true)
		World.cam.shake = 0.07
	if not st.fx.has("r2") and tau >= 6.9:
		st.fx.r2 = 1
		Au.play("land")
		World.cam.shake = 0.05
	if not st.fx.has("l") and tau >= 8.0:
		st.fx.l = 1
		_footfall(st.print[0].x, st.print[0].z, yaw, true)
		World.cam.shake = 0.05


# ---------- shots 3 and 4: walking, with a head that bobs and a little hop ----------
func _walk(dt: float, speed: float, x0: float, z0: float) -> void:
	var e: Dictionary = st.eye
	var f: Dictionary = st.e
	var w: Dictionary = st.w
	if w.air:                                    # a low-gravity hop, using the real gravity
		w.vy -= World.gravity * dt
		w.hop += w.vy * dt
		if w.hop <= 0:
			w.hop = 0.0
			w.air = false
			_footfall(e.x, e.z, st.yawE, true)
			World.cam.shake = 0.16
	w.dist += speed * dt * (1.25 if w.air else 1.0)
	var m := _clamp(speed / 2.2, 0, 1) * (0.0 if w.air else 1.0)
	var sway := sin(w.phase * 0.5)
	var stride := PI / 4.2 / 2
	if not w.air:
		w.phase += speed * dt * 4.2
		var step := int(floor(w.phase / PI))
		# each half-turn of the phase one boot comes down (the left on odd ones): the print goes where it lands
		if step != w.step:
			w.step = step
			var land := _spot(0 if step % 2 else 1, e.x, e.z, st.yawE, stride * m)
			_footfall(land.x, land.z, st.yawE, false)
	e.x = x0 + f.x * w.dist + cos(st.yawE) * sway * 0.035 * m
	e.z = z0 + f.z * w.dist - sin(st.yawE) * sway * 0.035 * m
	e.y = Terrain.height(e.x, e.z) + EYE + absf(sin(w.phase)) * 0.055 * m + w.hop
	e.roll = sway * 0.012 * m
	st.bodyYaw = st.yawE
	# the boots: each swings ahead while lifted and slides back under you while planted; in a hop both tuck up
	for i in 2:
		var p: float = w.phase + i * PI
		var ft := _spot(i, e.x, e.z, st.yawE, -cos(p) * stride * m)
		ft.y += maxf(0, sin(p)) * 0.13 * m + (minf(0.16, w.hop * 0.5) if w.air else 0.0)
		st.feet[i] = ft


func _shot_walk(t: float, dt: float) -> void:
	var e: Dictionary = st.eye
	var tau: float = t - TM.walk
	var speed := 2.3 * _ease(_seg(tau, 0, 1.4))
	if not st.fx.has("hop") and tau >= 6.4:
		st.fx.hop = 1
		st.w.air = true
		st.w.vy = 1.9 if st.moon else 2.7
		Au.play("jump")
	_walk(dt, speed, st.P1.x, st.P1.z)
	var glance := _ease(_seg(tau, 1.6, 4.2)) * (1 - _ease(_seg(tau, 7.4, 10.4)))
	e.yaw = st.yawE + glance * 0.62 + sin(tau * 0.5) * 0.03
	e.pitch = -0.05 + glance * 0.03 + (0.05 if st.w.air else 0.0) + sin(tau * 0.7) * 0.012
	e.fov = 54.0


static func _speed2(tau: float) -> float:
	var len: float = TM.sit - TM.walk2
	return 2.35 * _ease(_seg(tau, -0.4, 0.8)) * (1 - _ease(_seg(tau, len - 1.5, len)))


## how far that walk covers, so it ends right at the rock
static func _walk2_length() -> float:
	var d := 0.0
	var h := 1.0 / 60
	var x: float = TM.cut + 0.75 - TM.walk2
	while x < TM.sit - TM.walk2:
		d += _speed2(maxf(0, x)) * h
		x += h
	return d


func _shot_walk2(t: float, dt: float) -> void:
	var e: Dictionary = st.eye
	var tau: float = t - TM.walk2
	var len: float = TM.sit - TM.walk2
	_walk(dt, _speed2(tau), st.P2.x, st.P2.z)
	e.yaw = st.yawE + sin(tau * 0.6) * 0.03
	e.pitch = -0.06 - 0.12 * _ease(_seg(tau, 1, len))
	e.fov = 54.0


# ---------- shot 5: turn around and sit down ----------
# You stop just short of the rock, turn round in two small steps so your boots end up where they will rest, then lower
# yourself back onto the rock's front edge: the boots stay planted, the knees bend over the edge.
func _shot_sit(t: float) -> void:
	var e: Dictionary = st.eye
	var tau: float = t - TM.sit
	var C: Dictionary = st.C
	var Q2: Dictionary = st.Q2
	if not st.fx.has("q"):          # start from exactly where the walk ended
		st.fx.q = 1
		st.Q = { "x": e.x, "z": e.z }
		st.ft0 = st.feet.duplicate()
	var Q: Dictionary = st.Q
	var turn := _ease(_seg(tau, 0, 2.5))
	var shuffle := _ease(_seg(tau, 0.2, 2.0))
	var back := _ease(_seg(tau, 1.9, 3.3))
	var down := _ease(_seg(tau, 2.2, 3.5))
	var bx := lerpf(lerpf(Q.x, Q2.x, shuffle), C.x, back)
	var bz := lerpf(lerpf(Q.z, Q2.z, shuffle), C.z, back)
	e.yaw = lerpf(st.yawE, st.yawSit, turn)
	st.bodyYaw = e.yaw
	_bend_over(_ease(_seg(tau, 2.6, 3.9)))            # seated, you bend forward a little to look down past your knees
	e.x = bx + sin(e.yaw) * st.lean
	e.z = bz + cos(e.yaw) * st.lean
	e.y = lerpf(Terrain.height(bx, bz) + EYE, st.seatY, down) - st.duck + (exp(-(tau - 3.5) * 5) * -0.05 * cos((tau - 3.5) * 14) if tau > 3.5 else 0.0)
	e.pitch = lerpf(-0.18, 0.02, _ease(_seg(tau, 0, 1.6))) + lerpf(0, -0.84, _ease(_seg(tau, 2.5, 3.8)))
	e.roll = sin(turn * PI) * -0.03
	e.fov = 54.0
	st.sitQ = down
	st.feet[0] = _swing(st.ft0[0], st.F[0], _seg(tau, 0.25, 1.15), 0.1)
	st.feet[1] = _swing(st.ft0[1], st.F[1], _seg(tau, 1.05, 1.95), 0.1)
	if not st.fx.has("sit") and tau >= 3.4:
		st.fx.sit = 1
		Au.play("land")
		World.cam.shake = 0.08
		World.dust(C.x, C.z, 6, 1, 0.35)


func _bend_over(u: float) -> void:
	st.lean = 0.16 * u
	st.duck = 0.1 * u


# ---------- shot 6: the view ----------
func _shot_vista(t: float) -> void:
	var e: Dictionary = st.eye
	var tau: float = t - TM.vista
	var C: Dictionary = st.C
	_bend_over(1 - _ease(_seg(tau, 0.2, 3.0)))        # and sit back up as you raise your eyes to the view
	e.x = C.x + sin(st.yawSit) * st.lean
	e.z = C.z + cos(st.yawSit) * st.lean
	e.y = st.seatY - st.duck + sin(t * 1.1) * 0.006
	e.pitch = lerpf(-0.82, st.pitchEnd, _ease(_seg(tau, 0.3, 3.2)))
	e.yaw = lerpf(st.yawSit, st.yawEnd, _ease(_seg(tau, 1.8, 10.6)))
	e.fov = lerpf(54, 44, _ease(_seg(tau, 2, 14)))
	e.roll = 0.0
	st.bodyYaw = st.yawSit
	st.sitQ = 1.0
	st.feet[0] = st.F[0]
	st.feet[1] = st.F[1]


## The seat rock as it really is (its mesh, not a guess): along the way you will face when sitting, how high its top
## is, where its front edge drops away, and where its foot meets the ground. Looks a little to each side too, so both
## boots and both legs clear it.
static func _measure_seat(R: Dictionary, dir: Dictionary) -> Dictionary:
	var gy := Terrain.height(R.x, R.z)
	var out := { "top": gy + (Terrain.seat_top if Terrain.seat_top > 0 else 0.6), "edge": 1.25, "clear": 1.45 }
	if World.seat_rock == null:
		return out
	var sx: float = dir.z
	var sz: float = -dir.x
	var h := func(s: float, side: float) -> float: return World.seat_height(R.x + dir.x * s + sx * side, R.z + dir.z * s + sz * side)
	var ground := func(s: float, side: float) -> float: return Terrain.height(R.x + dir.x * s + sx * side, R.z + dir.z * s + sz * side)
	var top := -1e9
	var s := 0.0
	while s <= 1.0:
		top = maxf(top, h.call(s, 0.0))
		s += 0.05
	if top < gy:
		return out
	out.top = top
	out.edge = 0.0
	out.clear = 0.0
	for side in [-0.3, 0.0, 0.3]:
		var se := 0.0
		var sc := 0.0
		s = 0.5
		while s < 4:
			var y: float = h.call(s, side)
			if not se and y < top - 0.06:
				se = s
			if y < ground.call(s, side) + 0.03:
				sc = s
				break
			s += 0.02
		out.edge = maxf(out.edge, se if se else s)
		out.clear = maxf(out.clear, sc if sc else s)
	out.top = maxf(maxf(h.call(out.edge - 0.1, 0.0), h.call(out.edge - 0.25, 0.0)), gy + 0.3)   # the top where you actually sit
	return out


# ---------- the running order ----------
func _events(s: Dictionary) -> Array:
	var moon: bool = s.site.id == "moon"
	return [
		{ "t": 0.05, "fn": func(): _title(str(s.site.place), "The Moon" if moon else "Mars", "384,400 km from home" if moon else "Seven months from home") },
		{ "t": TM.descent - 0.5, "fn": func():
			_title()
			_cls("win", true)
			_cls("data", true)
			Ui.fade(false) },
		{ "t": TM.land, "fn": _touchdown },
		{ "t": TM.fade1, "fn": func(): Ui.fade(true) },
		{ "t": TM.fade1 + 0.9, "fn": func():
			_cls("win", false)
			_cls("data", false)
			_title("Hatch open", "", "")
			Au.play("hiss") },
		{ "t": TM.step - 0.7, "fn": func():
			_title()
			_cls("visor", true)
			_cls("data", true)
			st.body = true
			Ui.fade(false)
			Au.scene({ "place": "out", "site": s.site.id, "dust": World.env.get("dust", 0.0) }) },
		{ "t": TM.cut, "fn": func(): Ui.fade(true) },
		{ "t": TM.cut + 0.75, "fn": func():
			st.w.dist = 0.0
			st.w.hop = 0.0
			st.w.air = false
			Ui.fade(false) },
		{ "t": TM.vista + 0.4, "fn": func():
			_cls("bars", true)
			_cls("soft", true)
			_cls("data", false)
			if not Au.music("vista"):
				Au.play("pad") },
		{ "t": TM.title, "fn": func(): _title(str(s.site.dayWord) + " 1 · " + str(s.site.place), "Astro Outpost", "Your mission begins") },
		{ "t": TM.fade2, "fn": func(): Ui.fade(true) },
	]


func play(site: String, done: Callable = Callable()) -> void:
	var s: Dictionary = Game.s
	var L: Dictionary = Terrain.L
	var pad := { "x": L.rocket.x, "z": L.rocket.y }
	pad.y = Terrain.height(pad.x, pad.z)
	var R := { "x": L.seat.x, "z": L.seat.y }
	var hl := Vector2(pad.x, pad.z).length()
	var dir := { "x": -pad.x / hl, "z": -pad.z / hl }          # the rocket faces the habitat
	var el := Vector2(R.x - pad.x, R.z - pad.z).length()
	var e := { "x": (R.x - pad.x) / el, "z": (R.z - pad.z) / el }   # the way you walk
	var yawE := atan2(e.x, e.z)
	var S := { "x": pad.x + e.x * 11.35, "z": pad.z + e.z * 11.35 }      # standing at the very edge of the landing pad
	# sitting: hips just behind the rock's front edge, boots planted on the ground in front of it
	var seat := _measure_seat(R, { "x": -e.x, "z": -e.z })
	# the boots go as far out as the legs comfortably reach from that seat (knees still a little bent), so the toes
	# show past your knees when you look down; never closer than the rock's foot allows
	var sC: float = seat.edge - 0.11
	var gF := Terrain.height(R.x - e.x * (sC + 0.7), R.z - e.z * (sC + 0.7))
	var drop: float = seat.top + SEAT_HIP - gF - SOLE_Y
	var out := sqrt(maxf(0.04, pow(0.95 * (THIGH + SHIN), 2) - drop * drop))
	var sF := maxf(sC + 0.06 + minf(out, 0.62) + SOLE_Z, seat.clear + 0.27)
	var sQ := maxf(seat.edge, seat.clear) + 0.44
	var C := { "x": R.x - e.x * sC, "z": R.z - e.z * sC }
	var yaw_rocket := atan2(pad.x - C.x, pad.z - C.z)
	var yaw_sit := _near(yaw_rocket, yawE + PI)
	var yaw_hab := _near(atan2(-C.x, -C.z), yaw_sit)
	var moon := site == "moon"
	var yaw_earth := _near(atan2(-0.5, -0.84), yaw_sit)
	var w2 := _walk2_length()
	st = {
		"t": 0.0, "done": done, "moon": moon, "pad": pad, "dir": dir, "dirYaw": atan2(dir.x, dir.z), "e": e, "yawE": yawE, "S": S, "R": R, "C": C,
		"P1": { "x": S.x + e.x * STEP, "z": S.z + e.z * STEP }, "P2": { "x": R.x - e.x * (sQ + w2), "z": R.z - e.z * (sQ + w2) }, "Q": null,
		"Q2": { "x": R.x - e.x * (sF - 0.06 - SOLE_Z), "z": R.z - e.z * (sF - 0.06 - SOLE_Z) },
		"seatY": seat.top + SEAT_HIP - HIP_SIT, "seat": seat,
		"padTop": Actors.ground_at(S.x, S.z), "groundP1": Terrain.height(S.x + e.x * STEP, S.z + e.z * STEP),
		"yawSit": yaw_sit, "yawEnd": yaw_hab * 0.45 + yaw_earth * 0.55 if moon else yaw_hab - 0.42, "pitchEnd": 0.1 if moon else 0.07,
		"eye": { "x": pad.x, "y": pad.y + 260, "z": pad.z, "yaw": 0.0, "pitch": -1.0, "roll": 0.0, "fov": 58.0 },
		"w": { "phase": 0.0, "step": 0, "dist": 0.0, "hop": 0.0, "vy": 0.0, "air": false },
		"sitQ": 0.0, "lean": 0.0, "headSide": 0.0, "duck": 0.0, "body": false, "bodyYaw": yawE, "fx": {}, "rum": 0.0, "lineOff": 0.0,
		"dustCol": 0xb8b9c4 if moon else 0xd9a070, "cues": _script(s), "ci": 0, "ev": [], "ei": 0, "breath": 2.0, "finished": false, "skipping": false,
	}
	st.ev = _events(s)
	# the boots: standing on the pad, the prints out on the dust past its sloping rim, and resting by the rock
	st.home = [_spot(0, S.x, S.z, yawE), _spot(1, S.x, S.z, yawE)]
	st.print = [_spot(0, S.x, S.z, yawE, PRINT_AHEAD), _spot(1, S.x, S.z, yawE, PRINT_AHEAD)]
	st.feet = st.home.duplicate()
	var fa: float = sF - sC - 0.06 - SOLE_Z
	st.F = [_spot(0, C.x, C.z, yaw_sit, fa), _spot(1, C.x, C.z, yaw_sit, fa)]
	for p in st.F:
		p.y = Terrain.height(p.x, p.z)
	st.rig = _build_rig(int(Game.opts.get("suit", 0xff7a3d)))
	Au.music(null)
	Au.scene({ "place": "cabin", "site": site })
	for c in st.cues:            # this film's lines, ready before they are needed
		if c.get("vo") and ResourceLoader.exists(VO + c.vo + ".mp3"):
			ResourceLoader.load_threaded_request(VO + c.vo + ".mp3")
	Actors.astro.mode = "hidden"
	World.env.t = 0.12 if moon else 0.2
	World.cam.mode = "cine"
	_build_ui()
	ui.root.visible = true
	for k in ui.k:
		ui.k[k] = 0.0
		ui.want[k] = 0.0
	ui.data.text = ""
	_title()
	# the game's panels step aside for the film
	_hidden = []
	for id in ["hud", "goals", "radio", "prompt", "hands", "card", "rover-hud", "inside"]:
		if Ui.shown(id):
			_hidden.append(id)
			Ui.show_part(id, false)
	if Game.has_addon("minimap"):
		Game.ext("minimap", "show", [false])
	Ui.fade(true)
	_shot_descent(TM.descent, 0)
	_set_cam()
	_pose_rig()
	_layout_ui()


func step(dt: float) -> void:
	if st == null or st.finished:
		return
	st.t += dt
	var t: float = st.t
	while st.ei < st.ev.size() and t >= st.ev[st.ei].t:
		var fn: Callable = st.ev[st.ei].fn
		st.ei += 1
		fn.call()
		if st == null:
			return
	while st.ci < st.cues.size() and t >= st.cues[st.ci].t:
		_say(st.cues[st.ci])
		st.ci += 1
	if st.lineOff and t >= st.lineOff and not Au.voice_playing():       # keep the words up while they are spoken
		st.lineOff = 0.0
		ui.want.line = 0.0
	if t < TM.fade1 + 0.9:
		_shot_descent(maxf(t, TM.descent), dt)
	elif t < TM.step - 0.7:
		pass                                  # darkness, and the hiss of the hatch
	elif t < TM.walk:
		_shot_step(t)
	elif t < TM.cut + 0.75:
		_shot_walk(t, dt)
	elif t < TM.sit:
		_shot_walk2(maxf(t, TM.walk2), dt)
	elif t < TM.vista:
		_shot_sit(t)
	else:
		_shot_vista(t)
	if st.body:
		st.breath -= dt
		if st.breath <= 0:
			st.breath = 3.6
			Au.play("breath")
	_set_cam()
	_pose_rig()
	if st.body and t < TM.vista:
		ui.data.text = "O₂ %d%%   ·   SUIT 21°C   ·   ♥ %d" % [roundi(100 - (t - TM.step) * 0.05), roundi(88 + sin(t * 0.4) * 6)]
	if t >= TM.end:
		_finish()


func _finish() -> void:
	if st == null or st.finished:
		return
	st.finished = true
	var done: Callable = st.done
	var rk: Dictionary = Base.P.rocket
	(rk.group as Node3D).position = Vector3.ZERO
	(rk.flame as Node3D).visible = false
	(rk.light as OmniLight3D).light_energy = 0.0
	for k in ["group", "shadow"]:
		var n: Node3D = st.rig[k]
		if is_instance_valid(n):
			n.queue_free()
	Au.stop_all()
	if ui.get("root") and is_instance_valid(ui.root):
		ui.root.visible = false
	for id in _hidden:
		Ui.show_part(id, true)
	_hidden = []
	if Game.has_addon("minimap"):
		Game.ext("minimap", "show", [true])
	World.cam.shake = 0.0
	World.cam.cine.roll = 0.0
	st = null
	if done.is_valid():
		done.call()


## lets tests step through the film
func time() -> float:
	return st.t if st else -1.0


## and look at where the boots go
func peek():
	return { "C": st.C, "F": st.F, "feet": st.feet, "seatY": st.seatY, "print": st.print, "home": st.home, "seat": st.seat } if st else null


func skip() -> void:
	if st == null or st.skipping:
		return
	st.skipping = true
	Ui.fade(true)
	get_tree().create_timer(0.42).timeout.connect(_finish)
