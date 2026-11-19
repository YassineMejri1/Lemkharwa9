extends Node
## The mini map (press M, or the 🗺️ button at the top right). A round map in the corner that turns with the
## camera, so "up" on the map is the way you are looking. It shows the buildings, the ice pit, the rocket pad and
## the rover, and the jobs: the one to do now (gold, pulsing, with its distance), the other jobs on today's list and
## the science spots. Anything farther than the map reaches sits on its rim, pointing the way.
## The game hands it what to draw each frame (draw(d)); this file only draws. A port of js/minimap.js.

const RANGES := [45.0, 175.0]          # metres from you to the rim: near (the outpost) and far (the whole area)
const SIZE := 224.0
const BUILD := { "hab": "home", "scrub": "filter", "rack": "sun", "air": "air", "food": "food", "bag": "bag", "lab": "lab", "comms": "dish", "rocket": "rocket" }
var box: Control
var canvas: Control
var foot: Label
var zoom_btn: Button
var zi := 0
var shown := false
var d = null
var imgs := {}


func _ready() -> void:
	box = Control.new()
	box.name = "MiniMap"
	box.custom_minimum_size = Vector2(SIZE, SIZE + 30)
	box.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)       # bottom right, clear of the cards and the radio
	box.offset_left = -SIZE - 16
	box.offset_right = -16
	box.offset_top = -SIZE - 30 - 16
	box.offset_bottom = -16
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.visible = false
	Ui.root.add_child(box)
	canvas = Control.new()
	canvas.size = Vector2(SIZE, SIZE)
	canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.draw.connect(_paint)
	box.add_child(canvas)
	foot = Label.new()
	foot.position = Vector2(0, SIZE + 2)
	foot.size = Vector2(SIZE, 24)
	foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	foot.add_theme_font_override("font", Style.font(700))
	foot.add_theme_font_size_override("font_size", 14)
	foot.add_theme_color_override("font_color", Color("#ffd23f"))
	foot.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	foot.add_theme_constant_override("outline_size", 5)
	box.add_child(foot)
	zoom_btn = Button.new()
	zoom_btn.focus_mode = Control.FOCUS_NONE
	zoom_btn.theme_type_variation = "BtnGhost"
	zoom_btn.custom_minimum_size = Vector2(30, 30)
	zoom_btn.position = Vector2(SIZE - 30, SIZE - 30)
	zoom_btn.pressed.connect(func():
		zi = 1 - zi
		Game._save_pref("map_zoom", zi)
		_zoom_label()
		Au.play("tap"))
	box.add_child(zoom_btn)
	zi = int(Game._load_pref("map_zoom", 0))
	_zoom_label()
	for k in BUILD:
		_icon(BUILD[k])
	_icon("rover")
	_icon("ice")


func _zoom_label() -> void:
	zoom_btn.text = "−" if zi else "+"
	zoom_btn.tooltip_text = "Zoom in: the outpost" if zi else "Zoom out: the whole area"


func _icon(name) -> Texture2D:
	if name == null or name == "":
		return null
	if not imgs.has(name):
		var p := "res://assets/icons/" + str(name) + ".svg"
		imgs[name] = load(p) if ResourceLoader.exists(p) else null
	return imgs[name]


func show(on: bool) -> void:
	if on == shown:
		return
	shown = on
	box.visible = on
	if on:
		box.pivot_offset = Vector2(SIZE / 2, SIZE / 2)
		box.scale = Vector2(0.9, 0.9)
		box.modulate.a = 0.0
		var tw := box.create_tween().set_parallel().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tw.tween_property(box, "scale", Vector2.ONE, 0.2)
		tw.tween_property(box, "modulate:a", 1.0, 0.2)


## d: { me, yaw, fx, fz, buildings: [{key, x, z}], goals: [{x, z, icon, now}], spots: [{x, z, icon, color}],
##      rover, ice: {x, z, r}, pad: {x, z, r}, craters, playR, t }
func draw(data: Dictionary) -> void:
	if not shown:
		return
	d = data
	canvas.queue_redraw()


func _badge(x: float, y: float, rad: float, fill: Color, edge, name, emoji, alpha := 1.0) -> void:
	var c := canvas
	c.draw_circle(Vector2(x, y), rad, Color(fill, fill.a * alpha))
	if edge is Color:
		c.draw_arc(Vector2(x, y), rad, 0, TAU, 32, Color(edge, edge.a * alpha), 1.5, true)
	var tex := _icon(name)
	var s := rad * 1.3
	if tex:
		c.draw_texture_rect(tex, Rect2(x - s / 2, y - s / 2, s, s), false, Color(1, 1, 1, alpha))
	elif emoji:
		var f := Style.font(400)
		var fs := int(rad * 1.15)
		var w := f.get_string_size(str(emoji), HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		c.draw_string(f, Vector2(x - w / 2, y + fs * 0.38), str(emoji), HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, alpha))


func _paint() -> void:
	if d == null:
		return
	var c := canvas
	var sc := 1.0
	var R := SIZE / 2
	var rim := R - 16 * sc
	var rng: float = RANGES[zi]
	var k := rim / rng
	var fx: float = d.fx
	var fz: float = d.fz
	var fl := Vector2(fx, fz).length()
	if fl == 0:
		fl = 1
	fx /= fl
	fz /= fl
	var me: Vector3 = d.me
	var mx := me.x
	var mz := me.z
	var pulse := 0.5 + 0.5 * sin(float(d.t) * 4)
	# world → map: "up" is the way the camera looks, "right" is the camera's right
	var to_map := func(x: float, z: float) -> Vector2:
		return Vector2(R + (-(x - mx) * fz + (z - mz) * fx) * k, R - ((x - mx) * fx + (z - mz) * fz) * k)
	# the disc: dark glass with a soft glow in the middle, range rings every 15 m (near) or 50 m (far)
	c.draw_circle(Vector2(R, R), R - 1, Color(0.02, 0.06, 0.18, 0.82))
	c.draw_circle(Vector2(R, R), R * 0.6, Color(0.16, 0.27, 0.55, 0.18))
	c.draw_arc(Vector2(R, R), R - 1, 0, TAU, 64, Color(0.63, 0.75, 1.0, 0.35), 2, true)
	var step := 50.0 if zi else 15.0
	var rr := step
	while rr < rng:
		c.draw_arc(Vector2(R, R), rr * k, 0, TAU, 48, Color(0.63, 0.75, 1.0, 0.1), 1, true)
		rr += step
	var inside := func(p: Vector2, r: float) -> bool: return p.distance_to(Vector2(R, R)) + r < R - 2
	# craters, the edge of the area you can explore, the ice pit, the rocket pad
	for cr in d.get("craters", []):
		var p: Vector2 = to_map.call(cr.x, cr.z)
		var r: float = maxf(1.5, cr.r * k)
		if inside.call(p, r):
			c.draw_arc(p, r, 0, TAU, 24, Color(0.78, 0.84, 1.0, 0.13), 1, true)
	if d.get("playR"):
		var pc: Vector2 = to_map.call(0.0, 0.0)
		var pr: float = d.playR * k
		var n := 72
		for i in n:
			if i % 2:
				continue
			var a0 := TAU * i / n
			var a1 := TAU * (i + 1) / n
			var p0 := pc + Vector2(cos(a0), sin(a0)) * pr
			var p1 := pc + Vector2(cos(a1), sin(a1)) * pr
			if p0.distance_to(Vector2(R, R)) < R - 2 and p1.distance_to(Vector2(R, R)) < R - 2:
				c.draw_line(p0, p1, Color(1, 0.47, 0.55, 0.45), 1, true)
	if d.get("ice"):
		var p: Vector2 = to_map.call(d.ice.x, d.ice.z)
		var r: float = maxf(4, d.ice.r * k)
		if inside.call(p, -r * 0.5):
			c.draw_circle(p, r, Color(0.31, 0.85, 1.0, 0.16))
			c.draw_arc(p, r, 0, TAU, 32, Color(0.31, 0.85, 1.0, 0.5), 1, true)
	if d.get("pad"):
		var p: Vector2 = to_map.call(d.pad.x, d.pad.z)
		if inside.call(p, 0.0):
			c.draw_circle(p, maxf(3, d.pad.r * k), Color(0.86, 0.88, 0.94, 0.1))
	# buildings: small dark discs with their drawn icon (near), or just light dots (far)
	var bR := 6.5 if zi else 10.0
	for b in d.buildings:
		if d.goals.any(func(gl): return Vector2(gl.x - b.x, gl.z - b.z).length() < 7):
			continue
		var p: Vector2 = to_map.call(b.x, b.z)
		if p.distance_to(Vector2(R, R)) > rim:
			continue
		if zi:
			c.draw_circle(p, 2.6, Color(0.78, 0.84, 1.0, 0.75))
		else:
			_badge(p.x, p.y, bR, Color(0.04, 0.09, 0.23, 0.92), Color(0.75, 0.82, 1.0, 0.35), BUILD.get(b.key), null)
	if d.get("ice"):
		var p: Vector2 = to_map.call(d.ice.x, d.ice.z)
		if p.distance_to(Vector2(R, R)) <= rim:
			_badge(p.x, p.y, bR, Color(0.04, 0.16, 0.27, 0.92), Color(0.31, 0.85, 1.0, 0.7), "ice", null)
	if d.get("rover") != null:
		var p: Vector2 = to_map.call(d.rover.x, d.rover.z)
		if p.distance_to(Vector2(R, R)) <= rim:
			_badge(p.x, p.y, bR, Color(0.04, 0.16, 0.27, 0.92), Color(0.62, 0.91, 1.0, 0.8), "rover", null)
	# science spots and jobs: inside the map where they are, or on the rim pointing the way
	var pins: Array = []
	for sp in d.spots:
		pins.append({ "x": sp.x, "z": sp.z, "emoji": sp.icon, "color": Color(str(sp.color)), "r": 5.5 if zi else 7.0, "spot": true, "now": false })
	for gl in d.goals:
		pins.append({ "x": gl.x, "z": gl.z, "emoji": gl.icon, "color": Color("#ffd23f"), "r": (9.0 if zi else 11.0) if gl.now else (6.5 if zi else 9.0), "now": gl.now, "spot": zi and not gl.now })
	pins.sort_custom(func(a, b): return (2 if a.now else (0 if a.spot else 1)) < (2 if b.now else (0 if b.spot else 1)))
	var now_pin = null
	for p in pins:
		var q: Vector2 = to_map.call(p.x, p.z)
		var dv := q - Vector2(R, R)
		var dist := dv.length()
		var out := dist > rim
		if out:
			q = Vector2(R, R) + dv / dist * rim
		if p.spot:
			var al := 0.75 if out else 1.0
			c.draw_circle(q, p.r * 0.55, Color(p.color, al))
			c.draw_arc(q, p.r * 0.55, 0, TAU, 16, Color(0.02, 0.05, 0.16, 0.9 * al), 1.5, true)
			continue
		if p.now:
			now_pin = p
			c.draw_arc(q, p.r + 3 + pulse * 5, 0, TAU, 32, Color(1, 0.82, 0.25, 0.6 - pulse * 0.45), 2, true)
		if out:                                   # a little notch on the rim pointing outward
			var a := atan2(dv.y, dv.x)
			var tip: float = rim + p.r + 4
			var base: float = rim + p.r - 3
			c.draw_colored_polygon(PackedVector2Array([Vector2(R, R) + Vector2(cos(a), sin(a)) * tip,
				Vector2(R, R) + Vector2(cos(a + 0.12), sin(a + 0.12)) * base, Vector2(R, R) + Vector2(cos(a - 0.12), sin(a - 0.12)) * base]), Color("#ffd23f"))
		_badge(q.x, q.y, p.r, Color(0.27, 0.2, 0.02, 0.95) if p.now else Color(0.12, 0.12, 0.16, 0.88), Color("#ffd23f") if p.now else Color(1, 0.82, 0.25, 0.75), Html.ICONS.get(str(p.emoji).replace("️", ""), null), p.emoji)
	# you: an arrow in the middle, turned the way you face
	var yaw: float = d.yaw
	var hx := sin(yaw)
	var hz := cos(yaw)
	var ax := -hx * fz + hz * fx
	var ay := -(hx * fx + hz * fz)
	var rot := atan2(ax, -ay)
	c.draw_circle(Vector2(R, R), 13, Color(1, 1, 1, 0.1))
	var pts := PackedVector2Array([Vector2(0, -9), Vector2(6.5, 7), Vector2(0, 3.5), Vector2(-6.5, 7)])
	for i in pts.size():
		pts[i] = Vector2(R, R) + pts[i].rotated(rot)
	c.draw_colored_polygon(pts, Color.WHITE)
	# under the map: the job to do now and how far it is
	foot.text = (str(now_pin.emoji) + "  " + str(roundi(Vector2(now_pin.x - mx, now_pin.z - mz).length())) + " m") if now_pin else ""
