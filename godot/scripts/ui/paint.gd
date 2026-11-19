class_name Paint
extends RefCounted
## Little drawing helpers for the screens, dials and plates that the web version painted on a 2D canvas:
## rectangles with round corners, ellipses, gradients, text that is centred like canvas text (textBaseline
## "middle"), and live screens in the 3D world (a SubViewport whose picture is drawn by a function and shown on
## a quad). Every helper draws on a CanvasItem from inside its draw callback.

static var _mono_font: SystemFont


## the fonts: "lexend" (body), "exo2" (titles), "mono" (avionics readouts)
static func font(weight := 600, family := "lexend") -> Font:
	if family == "mono":
		if _mono_font == null:
			_mono_font = SystemFont.new()
			_mono_font.font_names = PackedStringArray(["Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Courier New", "monospace"])
			_mono_font.font_weight = 700
		return _mono_font
	return Style.font(weight, family)


static func col(hex: String, alpha := 1.0) -> Color:
	var c := Color(hex)
	c.a *= alpha
	return c


static func rect(c: CanvasItem, x: float, y: float, w: float, h: float, color: Color) -> void:
	c.draw_rect(Rect2(x, y, w, h), color)


static func stroke_rect(c: CanvasItem, x: float, y: float, w: float, h: float, color: Color, width := 2.0) -> void:
	c.draw_rect(Rect2(x, y, w, h), color, false, width)


## a rectangle with round corners, filled (width <= 0) or outlined
static func rrect(c: CanvasItem, x: float, y: float, w: float, h: float, r: float, color: Color, width := 0.0) -> void:
	var sb := StyleBoxFlat.new()
	sb.set_corner_radius_all(int(clampf(r, 0, minf(w, h) / 2)))
	sb.corner_detail = 6
	sb.anti_aliasing = true
	if width > 0:
		sb.draw_center = false
		sb.border_color = color
		sb.set_border_width_all(int(ceil(width)))
	else:
		sb.bg_color = color
	sb.draw(c.get_canvas_item(), Rect2(x, y, w, h))


static func _ellipse_pts(cx: float, cy: float, rx: float, ry: float, n := 40) -> PackedVector2Array:
	var p := PackedVector2Array()
	p.resize(n)
	for i in n:
		var a := float(i) / n * TAU
		p[i] = Vector2(cx + cos(a) * rx, cy + sin(a) * ry)
	return p


static func ellipse(c: CanvasItem, cx: float, cy: float, rx: float, ry: float, color: Color, width := 0.0) -> void:
	var n := clampi(int(maxf(rx, ry) * 0.6), 16, 64)
	var p := _ellipse_pts(cx, cy, rx, ry, n)
	if width > 0:
		p.append(p[0])
		c.draw_polyline(p, color, width, true)
	else:
		c.draw_colored_polygon(p, color)


static func circle(c: CanvasItem, cx: float, cy: float, r: float, color: Color, width := 0.0) -> void:
	ellipse(c, cx, cy, r, r, color, width)


## a soft round glow: colour stops [[t, Color], ...] from the middle (t = 0) to the rim (t = 1)
static func radial(c: CanvasItem, cx: float, cy: float, r: float, stops: Array, n := 32) -> void:
	for k in range(stops.size() - 1):
		var a: Array = stops[k]
		var b: Array = stops[k + 1]
		var r0: float = r * a[0]
		var r1: float = r * b[0]
		for i in n:
			var t0 := float(i) / n * TAU
			var t1 := float(i + 1) / n * TAU
			var d0 := Vector2(cos(t0), sin(t0))
			var d1 := Vector2(cos(t1), sin(t1))
			var o := Vector2(cx, cy)
			c.draw_polygon(PackedVector2Array([o + d0 * r0, o + d0 * r1, o + d1 * r1, o + d1 * r0]), PackedColorArray([a[1], b[1], b[1], a[1]]))


## a vertical gradient (top colour to bottom colour)
static func vgrad(c: CanvasItem, x: float, y: float, w: float, h: float, top: Color, bottom: Color) -> void:
	c.draw_polygon(PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)]), PackedColorArray([top, top, bottom, bottom]))


static func line(c: CanvasItem, x0: float, y0: float, x1: float, y1: float, color: Color, width := 2.0) -> void:
	c.draw_line(Vector2(x0, y0), Vector2(x1, y1), color, width, true)


static func dashed(c: CanvasItem, x0: float, y0: float, x1: float, y1: float, color: Color, width := 2.0, dash := 6.0) -> void:
	c.draw_dashed_line(Vector2(x0, y0), Vector2(x1, y1), color, width, dash)


static func arc(c: CanvasItem, cx: float, cy: float, r: float, a0: float, a1: float, color: Color, width := 2.0) -> void:
	c.draw_arc(Vector2(cx, cy), r, a0, a1, 32, color, width, true)


## Text centred on y (like canvas textBaseline "middle"), aligned "left", "center" or "right" on x.
## max_w > 0 shrinks the size until it fits.
static func text(c: CanvasItem, s: String, x: float, y: float, size: int, color: Color, align := "center", weight := 600, family := "lexend", max_w := 0.0) -> void:
	var f := font(weight, family)
	var w := f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	while max_w > 0 and w > max_w and size > 8:
		size -= 1
		w = f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var px := x
	if align == "center":
		px = x - w / 2
	elif align == "right":
		px = x - w
	var base := y + (f.get_ascent(size) - f.get_descent(size)) / 2
	c.draw_string(f, Vector2(px, base), s, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)


static func text_width(s: String, size: int, weight := 600, family := "lexend") -> float:
	return font(weight, family).get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x


## Wrapped text in a box, top-left at (x, y); returns the height used.
static func para(c: CanvasItem, s: String, x: float, y: float, w: float, size: int, color: Color, weight := 400, family := "lexend", line_h := 1.3) -> float:
	var f := font(weight, family)
	var lines := []
	for para_s in s.split("\n"):
		var cur := ""
		for word in para_s.split(" "):
			var t := word if cur == "" else cur + " " + word
			if f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > w and cur != "":
				lines.append(cur)
				cur = word
			else:
				cur = t
		lines.append(cur)
	var lh := size * line_h
	for i in lines.size():
		c.draw_string(f, Vector2(x, y + f.get_ascent(size) + i * lh), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
	return lines.size() * lh


# ---------- live screens in the 3D world ----------
## A quad w x h metres showing a picture cw x ch pixels that paint(ci, cw, ch) draws. The SubViewport is
## parked under holder (any Node). Returns { vp, ci, mesh, fn }: call redraw(screen, fn) to repaint.
static func screen(holder: Node, parent: Node3D, w: float, h: float, cw: int, ch: int, glow := true, transparent := false) -> Dictionary:
	var vp := SubViewport.new()
	vp.size = Vector2i(cw, ch)
	vp.disable_3d = true
	vp.transparent_bg = transparent
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	var ci := Control.new()
	ci.size = Vector2(cw, ch)
	ci.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vp.add_child(ci)
	holder.add_child(vp)
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	var m := StandardMaterial3D.new()
	m.albedo_texture = vp.get_texture()
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if glow:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		m.roughness = 0.6
	if transparent:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.4
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	var sc := { "vp": vp, "ci": ci, "mesh": mi, "fn": Callable(), "w": cw, "h": ch }
	ci.draw.connect(func():
		var fn: Callable = sc.fn
		if fn.is_valid():
			fn.call(ci, cw, ch))
	return sc


static func redraw(sc: Dictionary, fn: Callable) -> void:
	sc.fn = fn
	(sc.ci as Control).queue_redraw()
	(sc.vp as SubViewport).render_target_update_mode = SubViewport.UPDATE_ONCE
