extends Node
## The wrist tablet's holograms (a port of js/holo.js).
## When something is hard to understand (press T, tap a meter, a blue card or the "Why?" chip on the radio panel), the
## astronaut's wrist tablet projects a short moving diagram that explains the real science in three or four steps,
## one sentence per step. The game calls open("shield", { bags = 6 }) and pauses itself until it closes.
## Everything is drawn here with lines and circles on a sheet 720 wide and 405 tall: no pictures.
## Colours: cyan line art, amber for the thing the step is about, pink only for "bad".
##
## Godot adjustments: the web version paints on an HTML canvas. Here a small pen (class Pen below) gives the same
## drawing words (paths, arcs, curves, dashes, glow, clipping, outlined text), so every scene is drawn line for line
## as in the original.

const W := 720.0
const HT := 405.0
const CY := Color("#5cf0ff")
const AMB := Color("#ffd23f")
const BAD := Color("#ff5468")
const GREY := Color("#9aa7c7")
const INK := Color("#eaf6ff")
const BG := Color("#06132b")
const LAMP := Color("#ff9df2")       # the pink-purple light of the grow lamps (not the danger pink)

var g: Pen = null           # the pen
var fade := 1.0             # every step fades in over its first moments
var still := false          # true = draw a settled picture, nothing moves (reduced motion)
var SC := {}


# =====================================================================
#  THE PEN: the few canvas drawing words the scenes use
# =====================================================================
class Pen extends RefCounted:
	var ci: CanvasItem
	var font: Font
	var xf := Transform2D.IDENTITY
	var alpha := 1.0
	var stroke_color := Color.WHITE
	var fill_color := Color.WHITE
	var lw := 1.0
	var blur := 0.0
	var dashes: Array = []
	var dash_offset := 0.0
	var clip_poly = null
	var _stack: Array = []
	var _subs: Array = []
	var _cur = null
	var _last := Vector2.ZERO
	var _start := Vector2.ZERO

	func _scale() -> float:
		return xf.x.length()

	func save() -> void:
		_stack.append([xf, alpha, stroke_color, fill_color, lw, blur, dashes.duplicate(), dash_offset, clip_poly])

	func restore() -> void:
		if _stack.is_empty():
			return
		var s: Array = _stack.pop_back()
		xf = s[0]
		alpha = s[1]
		stroke_color = s[2]
		fill_color = s[3]
		lw = s[4]
		blur = s[5]
		dashes = s[6]
		dash_offset = s[7]
		clip_poly = s[8]

	func reset(scale: float) -> void:
		_stack = []
		xf = Transform2D(Vector2(scale, 0), Vector2(0, scale), Vector2.ZERO)
		alpha = 1.0
		blur = 0.0
		dashes = []
		dash_offset = 0.0
		clip_poly = null
		_subs = []
		_cur = null

	func translate(x: float, y: float) -> void:
		xf = xf * Transform2D(0.0, Vector2(x, y))

	func rotate(a: float) -> void:
		xf = xf * Transform2D(a, Vector2.ZERO)

	func set_line_dash(a: Array) -> void:
		dashes = a.duplicate()

	# ---------- building a path ----------
	func begin() -> void:
		_subs = []
		_cur = null

	func _new_sub(p: Vector2) -> void:
		_cur = [xf * p]
		_subs.append([_cur, false])
		_last = p
		_start = p

	func _pt(p: Vector2) -> void:
		if _cur == null:
			_new_sub(p)
			return
		_cur.append(xf * p)
		_last = p

	func move_to(x: float, y: float) -> void:
		_new_sub(Vector2(x, y))

	func line_to(x: float, y: float) -> void:
		_pt(Vector2(x, y))

	func close_path() -> void:
		if _cur != null and _subs.size():
			_subs[_subs.size() - 1][1] = true
			_cur = null
			_last = _start

	func _segs(sweep: float, r: float) -> int:
		return clampi(int(ceil(absf(sweep) * r * _scale() / 3.0)), 4, 160)

	func arc(x: float, y: float, r: float, a0: float, a1: float, ccw := false) -> void:
		var sweep := a1 - a0
		if not ccw:
			if sweep >= TAU:
				sweep = TAU
			elif sweep < 0:
				sweep = fposmod(sweep, TAU)
		else:
			if -sweep >= TAU:
				sweep = -TAU
			elif sweep > 0:
				sweep = fposmod(sweep, TAU) - TAU
		var n := _segs(sweep, r)
		for i in n + 1:
			var a := a0 + sweep * i / n
			_pt(Vector2(x + cos(a) * r, y + sin(a) * r))

	func ellipse(x: float, y: float, rx: float, ry: float, rot: float, a0: float, a1: float, ccw := false) -> void:
		var sweep := a1 - a0
		if not ccw:
			sweep = TAU if sweep >= TAU else (fposmod(sweep, TAU) if sweep < 0 else sweep)
		else:
			sweep = -TAU if -sweep >= TAU else (fposmod(sweep, TAU) - TAU if sweep > 0 else sweep)
		var n := _segs(sweep, maxf(rx, ry))
		var c := cos(rot)
		var s := sin(rot)
		for i in n + 1:
			var a := a0 + sweep * i / n
			var px := cos(a) * rx
			var py := sin(a) * ry
			_pt(Vector2(x + px * c - py * s, y + px * s + py * c))

	func quadratic_curve_to(cx: float, cy: float, x: float, y: float) -> void:
		var p0 := _last
		if _cur == null:
			_new_sub(p0)
		for i in range(1, 17):
			var k := i / 16.0
			var m := 1 - k
			_pt(Vector2(m * m * p0.x + 2 * m * k * cx + k * k * x, m * m * p0.y + 2 * m * k * cy + k * k * y))

	func bezier_curve_to(c1x: float, c1y: float, c2x: float, c2y: float, x: float, y: float) -> void:
		var p0 := _last
		if _cur == null:
			_new_sub(p0)
		for i in range(1, 21):
			var k := i / 20.0
			var m := 1 - k
			_pt(Vector2(m * m * m * p0.x + 3 * m * m * k * c1x + 3 * m * k * k * c2x + k * k * k * x,
				m * m * m * p0.y + 3 * m * m * k * c1y + 3 * m * k * k * c2y + k * k * k * y))

	func arc_to(x1: float, y1: float, x2: float, y2: float, r: float) -> void:
		var p0 := _last
		var p1 := Vector2(x1, y1)
		var p2 := Vector2(x2, y2)
		if _cur == null:
			_new_sub(p0)
		var v1 := p0 - p1
		var v2 := p2 - p1
		if r <= 0 or v1.length() < 1e-6 or v2.length() < 1e-6 or absf(v1.normalized().cross(v2.normalized())) < 1e-6:
			_pt(p1)
			return
		v1 = v1.normalized()
		v2 = v2.normalized()
		var ang := acos(clampf(v1.dot(v2), -1, 1))
		var dist := r / tan(ang / 2)
		var t1 := p1 + v1 * dist
		var t2 := p1 + v2 * dist
		var c := p1 + (v1 + v2).normalized() * (r / sin(ang / 2))
		_pt(t1)
		var b0 := (t1 - c).angle()
		var sweep := wrapf((t2 - c).angle() - b0, -PI, PI)
		var n := _segs(sweep, r)
		for i in range(1, n + 1):
			var a := b0 + sweep * i / n
			_pt(c + Vector2(cos(a), sin(a)) * r)

	# ---------- painting it ----------
	func _clean(pts: Array) -> PackedVector2Array:
		var out := PackedVector2Array()
		for p in pts:
			if out.is_empty() or (p as Vector2).distance_squared_to(out[out.size() - 1]) > 0.0004:
				out.append(p)
		if out.size() > 2 and out[0].distance_squared_to(out[out.size() - 1]) < 0.0004:
			out.remove_at(out.size() - 1)
		return out

	func _dash(line: PackedVector2Array) -> Array:
		var sc := _scale()
		var pat: Array = []
		for v in dashes:
			pat.append(maxf(0.1, float(v) * sc))
		if pat.size() % 2 == 1:
			pat.append_array(pat.duplicate())
		var total := 0.0
		for v in pat:
			total += v
		var out: Array = []
		var phase := fposmod(dash_offset * sc, total)
		var k := 0
		while phase >= pat[k]:
			phase -= pat[k]
			k = (k + 1) % pat.size()
		var left: float = pat[k] - phase
		var on := k % 2 == 0
		var cur := PackedVector2Array()
		if on:
			cur.append(line[0])
		for i in range(1, line.size()):
			var a: Vector2 = line[i - 1]
			var b: Vector2 = line[i]
			var seg := a.distance_to(b)
			var pos := 0.0
			while seg - pos > left:
				pos += left
				var p := a.lerp(b, pos / seg)
				if on:
					cur.append(p)
					out.append(cur)
					cur = PackedVector2Array()
				else:
					cur = PackedVector2Array([p])
				on = not on
				k = (k + 1) % pat.size()
				left = pat[k]
			left -= seg - pos
			if on:
				cur.append(b)
		if on and cur.size() > 1:
			out.append(cur)
		return out

	func stroke() -> void:
		var col := stroke_color
		col.a *= alpha
		if col.a <= 0.003:
			return
		var w := lw * _scale()
		for sub in _subs:
			var pts: Array = sub[0]
			if pts.size() < 2:
				continue
			var line := PackedVector2Array(pts)
			if sub[1]:
				line.append(pts[0])
			var pieces: Array = _dash(line) if dashes.size() > 0 else [line]
			if clip_poly != null:
				var cut: Array = []
				for pc in pieces:
					cut.append_array(Geometry2D.intersect_polyline_with_polygon(pc, clip_poly))
				pieces = cut
			for pc in pieces:
				if pc.size() < 2:
					continue
				if blur > 0.5:
					var b := blur * _scale()
					ci.draw_polyline(pc, Color(col.r, col.g, col.b, col.a * 0.1), w + b * 0.9, true)
					ci.draw_polyline(pc, Color(col.r, col.g, col.b, col.a * 0.18), w + b * 0.4, true)
				ci.draw_polyline(pc, col, maxf(w, 0.6), true)

	func _fill_poly(poly: PackedVector2Array, col: Color) -> void:
		var polys: Array = [poly]
		if clip_poly != null:
			polys = Geometry2D.intersect_polygons(poly, clip_poly)
		for p in polys:
			if p.size() < 3 or Geometry2D.triangulate_polygon(p).is_empty():
				continue
			ci.draw_colored_polygon(p, col)
		if blur > 0.5 and clip_poly == null and poly.size() >= 3:
			var ring := poly.duplicate()
			ring.append(poly[0])
			ci.draw_polyline(ring, Color(col.r, col.g, col.b, col.a * 0.16), blur * _scale() * 0.6, true)

	func fill() -> void:
		var col := fill_color
		col.a *= alpha
		if col.a <= 0.003:
			return
		for sub in _subs:
			var poly := _clean(sub[0])
			if poly.size() >= 3:
				_fill_poly(poly, col)

	func fill_rect(x: float, y: float, w: float, h: float) -> void:
		var col := fill_color
		col.a *= alpha
		if col.a <= 0.003 or w <= 0 or h <= 0:
			return
		_fill_poly(PackedVector2Array([xf * Vector2(x, y), xf * Vector2(x + w, y), xf * Vector2(x + w, y + h), xf * Vector2(x, y + h)]), col)

	func clip() -> void:
		if _subs.is_empty():
			return
		var p := _clean(_subs[0][0])
		if clip_poly != null:
			var r := Geometry2D.intersect_polygons(p, clip_poly)
			clip_poly = r[0] if r.size() else PackedVector2Array()
		else:
			clip_poly = p

	## a soft radial glow over a slice of a circle (the tablet's beam): stops = [[radius, Color], ...]
	func radial_sector(cx: float, cy: float, a0: float, a1: float, stops: Array, n := 24) -> void:
		var c := Vector2(cx, cy)
		for k in stops.size() - 1:
			var r0: float = stops[k][0]
			var r1: float = stops[k + 1][0]
			var c0: Color = stops[k][1]
			var c1: Color = stops[k + 1][1]
			c0.a *= alpha
			c1.a *= alpha
			for i in n:
				var b0 := a0 + (a1 - a0) * i / n
				var b1 := a0 + (a1 - a0) * (i + 1) / n
				var d0 := Vector2(cos(b0), sin(b0))
				var d1 := Vector2(cos(b1), sin(b1))
				ci.draw_polygon(PackedVector2Array([xf * (c + d0 * r0), xf * (c + d1 * r0), xf * (c + d1 * r1), xf * (c + d0 * r1)]), PackedColorArray([c0, c0, c1, c1]))

	func measure(s: String, size: float) -> float:
		return font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, int(roundf(size))).x

	## Text with its middle at height y, outlined with the background so lines behind it do not cross it.
	## It is laid out at the real pixel size on screen (not drawn small and blown up), so it stays sharp.
	func text(s: String, x: float, y: float, size: float, col: Color, align := "center", bg := Color.BLACK) -> void:
		if alpha <= 0.003 or s == "":
			return
		var sc := _scale()
		var fs := maxi(1, int(roundf(size * sc)))
		var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		var px := x * sc
		var ox := px - w / 2 if align == "center" else (px - w if align == "right" else px)
		var by := y * sc + (font.get_ascent(fs) - font.get_descent(fs)) / 2
		ci.draw_set_transform_matrix(xf * Transform2D(0, Vector2(1 / sc, 1 / sc), 0, Vector2.ZERO))
		var ol := int(maxf(4, size * 0.3) * sc)
		ci.draw_string_outline(font, Vector2(ox, by), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, ol, Color(bg.r, bg.g, bg.b, alpha))
		ci.draw_string(font, Vector2(ox, by), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(col.r, col.g, col.b, col.a * alpha))
		ci.draw_set_transform_matrix(Transform2D.IDENTITY)


# =====================================================================
#  small helpers
# =====================================================================
static func cl(v: float) -> float:
	return 0.0 if v < 0 else (1.0 if v > 1 else v)


## 0 to 1 while a part of the step plays
static func ph(t: float, start: float, dur: float) -> float:
	return cl((t - start) / dur)


## start gently, stop gently
static func ez(p: float) -> float:
	return p * p * (3 - 2 * p)


static func mix(a: float, b: float, p: float) -> float:
	return a + (b - a) * p


## the same "random" number every time
static func rnd(i: float) -> float:
	var x := sin(i * 127.1 + 311.7) * 43758.5453
	return x - floorf(x)


## A value that runs 0 to 1 again and again, one lap every 'every' seconds. A still picture stays at 'rest'.
func lap(t: float, every: float, rest = null) -> float:
	if still:
		return 0.6 if rest == null else float(rest)
	return fmod(t / every, 1.0)


func sway(t: float, speed: float, shift := 0.0) -> float:
	return 0.0 if still else sin(t * speed + shift)


static func num(v, def: float, lo: float, hi: float) -> float:
	if v is String and v != "":
		v = float(v)
	if not (v is float or v is int) or is_nan(float(v)) or is_inf(float(v)):
		v = def
	return maxf(lo, minf(hi, float(v)))


## A share of something: 0.46 and 46 both mean 46%.
static func share(v, def: float, lo: float, hi: float) -> float:
	var x := num(v, def, 0, 100)
	return maxf(lo, minf(hi, x / 100 if x > 1 else x))


static func pct(f: float) -> int:
	return roundi(f * 100)


static func place(v, def: String) -> String:
	return v if v is String and (v == "moon" or v == "mars") else def


## Anything but a plain false counts as yes (a missing value too).
static func _yes(v) -> bool:
	return not (v is bool and v == false)


static func _s(v) -> String:
	if v is float and v == floorf(v):
		return str(int(v))
	return str(v)


# ---------- drawing tools ----------
func A(a: float) -> void:
	g.alpha = fade * cl(a)


func pen(col: Color, w := 3.0, glow = null) -> void:
	g.stroke_color = col
	g.fill_color = col
	g.lw = w if w else 3.0
	g.blur = 10.0 if glow == null else float(glow)


func dash(a := 0.0, b := 0.0) -> void:
	g.set_line_dash([a, b if b else a] if a else [])


func line(x1: float, y1: float, x2: float, y2: float) -> void:
	g.begin()
	g.move_to(x1, y1)
	g.line_to(x2, y2)
	g.stroke()


func ring(x: float, y: float, r: float) -> void:
	g.begin()
	g.arc(x, y, maxf(0, r), 0, TAU)
	g.stroke()


func dot(x: float, y: float, r: float) -> void:
	g.begin()
	g.arc(x, y, maxf(0, r), 0, TAU)
	g.fill()


func arcs(x: float, y: float, r: float, a0: float, a1: float) -> void:
	g.begin()
	g.arc(x, y, maxf(0, r), a0, a1)
	g.stroke()


func rr(x: float, y: float, w: float, h: float, r := 0.0) -> void:
	r = maxf(0, minf(r, minf(w / 2, h / 2)))
	g.begin()
	g.move_to(x + r, y)
	g.arc_to(x + w, y, x + w, y + h, r)
	g.arc_to(x + w, y + h, x, y + h, r)
	g.arc_to(x, y + h, x, y, r)
	g.arc_to(x, y, x + w, y, r)
	g.close_path()


func box(x: float, y: float, w: float, h: float, r := 0.0) -> void:
	rr(x, y, w, h, r)
	g.stroke()


func slab(x: float, y: float, w: float, h: float, r := 0.0) -> void:
	rr(x, y, w, h, r)
	g.fill()


func shape(p: Array, close := false) -> void:
	g.begin()
	g.move_to(p[0], p[1])
	for i in range(2, p.size(), 2):
		g.line_to(p[i], p[i + 1])
	if close:
		g.close_path()


func path(p: Array, close := false) -> void:
	shape(p, close)
	g.stroke()


## A soft see-through fill for the outline that was just drawn.
func wash(a: float) -> void:
	var k := g.alpha
	var b := g.blur
	g.alpha = k * a
	g.blur = 0
	g.fill()
	g.alpha = k
	g.blur = b


## Paint the outline that was just drawn with the dark background, so it hides what is behind it.
func hide() -> void:
	var f := g.fill_color
	var b := g.blur
	g.fill_color = BG
	g.blur = 0
	g.fill()
	g.fill_color = f
	g.blur = b


func txt(s, x: float, y: float, size: float, col := INK, align := "center") -> void:
	g.blur = 0
	g.lw = maxf(4, size * 0.3)
	g.stroke_color = BG
	g.dashes = []
	g.text(str(s), x, y, size, col, align, BG)
	g.fill_color = col
	g.blur = 5


func arrow(x1: float, y1: float, x2: float, y2: float, h := 12.0) -> void:
	var a := atan2(y2 - y1, x2 - x1)
	line(x1, y1, x2, y2)
	g.begin()
	g.move_to(x2 - h * cos(a - 0.5), y2 - h * sin(a - 0.5))
	g.line_to(x2, y2)
	g.line_to(x2 - h * cos(a + 0.5), y2 - h * sin(a + 0.5))
	g.stroke()


func zig(x1: float, x2: float, y: float, amp: float, n: int) -> void:
	g.begin()
	g.move_to(x1, y)
	for i in range(1, n + 1):
		g.line_to(x1 + (x2 - x1) * i / n, y + (amp if i % 2 else 0.0))
	g.stroke()


## A wobbly line going up, for heat and damp air.
func wavy(x: float, y1: float, y2: float, amp: float, shift: float) -> void:
	g.begin()
	for i in 15:
		g.line_to(x + sin(i * 0.9 + shift) * amp * minf(1, i / 3.0), mix(y1, y2, i / 14.0))
	g.stroke()


func spark(x: float, y: float, r: float, col: Color) -> void:
	pen(col, 2.5, 10)
	for i in 6:
		line(x + cos(i * 1.047 + 0.3) * r * 0.45, y + sin(i * 1.047 + 0.3) * r * 0.45, x + cos(i * 1.047 + 0.3) * r, y + sin(i * 1.047 + 0.3) * r)


## The point a share f (0 to 1) of the way along a bent line [x0, y0, x1, y1, ...].
static func along(p: Array, f: float) -> Vector2:
	var n := p.size() / 2 - 1
	var lens := []
	var tot := 0.0
	for i in n:
		var d := Vector2(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]).length()
		lens.append(d)
		tot += d
	var dd := cl(f) * tot
	for i in n:
		if dd <= lens[i] or i == n - 1:
			var k: float = minf(1, dd / lens[i]) if lens[i] else 0.0
			return Vector2(mix(p[i * 2], p[i * 2 + 2], k), mix(p[i * 2 + 1], p[i * 2 + 3], k))
		dd -= lens[i]
	return Vector2(p[0], p[1])


## The point a share k of the way along a curve from (x0, y0) to (x1, y1) that bends towards (cx, cy).
static func bend(x0: float, y0: float, cx: float, cy: float, x1: float, y1: float, k: float) -> Vector2:
	var m := 1 - k
	return Vector2(m * m * x0 + 2 * m * k * cx + k * k * x1, m * m * y0 + 2 * m * k * cy + k * k * y1)


## One fast particle flying in a straight line to (x, y) along the direction (dx, dy), starting 'far' away.
## p runs 0 to 1 over the flight. Returns true once it has arrived (and then draws nothing).
func fly(x: float, y: float, dx: float, dy: float, far: float, p: float, col: Color, w := 3.0) -> bool:
	if p >= 1:
		return true
	if p < 0:
		return false
	var hx := x - dx * far * (1 - p)
	var hy := y - dy * far * (1 - p)
	var a := g.alpha
	var ln := 46.0
	pen(col, w, 8)
	for i in 4:
		g.alpha = a * (i + 1) / 4.0
		line(hx - dx * ln * (1 - i / 4.0), hy - dy * ln * (1 - i / 4.0), hx - dx * ln * (1 - (i + 1) / 4.0), hy - dy * ln * (1 - (i + 1) / 4.0))
	g.alpha = a
	dot(hx, hy, w * 0.9)
	return false


# ---------- things that appear in more than one scene ----------
func stars(n: int, seed: float) -> void:
	pen(INK, 1, 0)
	for i in n:
		A(0.25 + 0.4 * rnd(seed + i))
		dot(20 + rnd(seed + i * 3 + 1) * 680, 14 + rnd(seed + i * 3 + 2) * 300, 1 + rnd(seed + i * 7) * 1.2)
	A(1)


func ground(y: float, x0 = null, x1 = null) -> void:
	A(0.75)
	pen(CY, 2.5, 6)
	line(30.0 if x0 == null else float(x0), y, 690.0 if x1 == null else float(x1), y)
	A(1)


func sun(x: float, y: float, r: float, t: float) -> void:
	pen(AMB, 3, 16)
	ring(x, y, r)
	hide()
	g.stroke()
	wash(0.22)
	for i in 10:
		var a := i * 0.6283 + (0.0 if still else t * 0.15)
		line(x + cos(a) * (r + 8), y + sin(a) * (r + 8), x + cos(a) * (r + 19), y + sin(a) * (r + 19))


## A little world: 'earth' (with land), 'moon' (with craters) or 'mars' (an ice cap and a long canyon).
func globe(x: float, y: float, r: float, kind: String) -> void:
	var a := g.alpha
	pen(CY if kind == "earth" else INK, 3)
	ring(x, y, r)
	hide()
	g.stroke()
	wash(0.16 if kind == "earth" else 0.1)
	g.save()
	g.begin()
	g.arc(x, y, r - 1.5, 0, TAU)
	g.clip()
	g.blur = 0
	if kind == "earth":
		g.alpha = a * 0.5
		for e in [[x - r * 0.3, y - r * 0.28, r * 0.42, r * 0.3, -0.5], [x + r * 0.42, y + r * 0.3, r * 0.3, r * 0.42, 0.4], [x - r * 0.5, y + r * 0.62, r * 0.25, r * 0.16, 0.2]]:
			g.begin()
			g.ellipse(e[0], e[1], e[2], e[3], e[4], 0, TAU)
			g.fill()
	elif kind == "moon":
		g.alpha = a * 0.55
		g.lw = 2
		ring(x - r * 0.34, y - r * 0.22, r * 0.22)
		ring(x + r * 0.3, y + r * 0.32, r * 0.28)
		ring(x + r * 0.28, y - r * 0.48, r * 0.13)
		ring(x - r * 0.3, y + r * 0.5, r * 0.1)
	else:
		g.alpha = a * 0.55
		g.lw = 2
		g.begin()
		g.ellipse(x, y - r * 0.92, r * 0.5, r * 0.22, 0, 0, TAU)
		g.fill()
		g.begin()
		g.move_to(x - r * 0.6, y + r * 0.1)
		g.quadratic_curve_to(x, y - r * 0.12, x + r * 0.55, y + r * 0.18)
		g.stroke()
		ring(x - r * 0.25, y + r * 0.5, r * 0.14)
		ring(x + r * 0.4, y - r * 0.3, r * 0.1)
	g.restore()
	g.alpha = a


## An astronaut standing with the feet at (x, y). s = 1 is about 64 tall.
func astro(x: float, y: float, s: float, col := INK) -> void:
	pen(col, maxf(2, 3 * s), 6)
	line(x - 6 * s, y - 18 * s, x - 6 * s, y)
	line(x + 6 * s, y - 18 * s, x + 6 * s, y)
	line(x - 13 * s, y - 37 * s, x - 21 * s, y - 22 * s)
	line(x + 13 * s, y - 37 * s, x + 21 * s, y - 22 * s)
	box(x - 13 * s, y - 43 * s, 26 * s, 27 * s, 7 * s)
	hide()
	g.stroke()
	wash(0.14)
	ring(x, y - 53 * s, 12 * s)
	hide()
	g.stroke()
	wash(0.14)
	A0(0.55)
	slab(x - 6 * s, y - 58 * s, 14 * s, 9 * s, 4 * s)
	A0(1 / 0.55)


## Multiply the see-through level without losing the fade (used inside the things above).
func A0(k: float) -> void:
	g.alpha = minf(1, g.alpha * k)


## A dome home standing on the ground at height y, r wide on each side.
func dome(x: float, y: float, r: float, col := CY) -> void:
	pen(col, 3.5)
	g.begin()
	g.arc(x, y, r, PI, 0)
	g.close_path()
	hide()
	g.stroke()
	wash(0.07)


## Soil bags lie on the dome in n places, counted from the ground on the left (0) over the top to the ground on the
## right. They are added from the bottom up, one side then the other: bag number j goes in the place bag_place(j, n).
static func bag_place(j: int, n: int) -> int:
	return n - 1 - (j - 1) / 2 if j % 2 else j / 2


func bag(x: float, y: float, r: float, n: int, k: int, col: Color, empty := false) -> void:
	var a := PI - (k + 0.5) * PI / n
	var w := minf(50, PI * (r + 11) / n - 4)
	var h := minf(20, maxf(13, w * 0.62))
	g.save()
	g.translate(x + cos(a) * (r + h / 2 + 4), y - sin(a) * (r + h / 2 + 4))
	g.rotate(PI / 2 - a)
	if empty:
		A0(0.3)
		pen(col, 1.5, 0)
		dash(4, 4)
		box(-w / 2, -h / 2, w, h, 5)
		dash()
		A0(1 / 0.3)
	else:
		pen(col, 2.5, 8)
		box(-w / 2, -h / 2, w, h, 6)
		hide()
		g.stroke()
		wash(0.4)
	g.restore()


## The outline of a water drop, pointed at the top, about 2.8 s tall. Follow with g.stroke() or g.fill().
func drop(x: float, y: float, s: float) -> void:
	g.begin()
	g.move_to(x, y - 1.4 * s)
	g.bezier_curve_to(x + 0.15 * s, y - 0.7 * s, x + s, y - 0.2 * s, x + s, y + 0.4 * s)
	g.arc(x, y + 0.4 * s, s, 0, PI)
	g.bezier_curve_to(x - s, y - 0.2 * s, x - 0.15 * s, y - 0.7 * s, x, y - 1.4 * s)
	g.close_path()


func water(x: float, y: float, s: float, col := CY) -> void:
	pen(col, maxf(2, s * 0.14), 8)
	drop(x, y, s)
	g.stroke()
	wash(0.35)


## An ice cube seen from one corner. s is half its width.
func ice(x: float, y: float, s: float) -> void:
	var h := s * 0.58
	var v := s * 1.15
	pen(CY, maxf(2, s * 0.07))
	shape([x, y - v, x + s, y - h, x + s, y + h, x, y + v, x - s, y + h, x - s, y - h], true)
	hide()
	g.stroke()
	wash(0.14)
	shape([x, y - v, x + s, y - h, x, y, x - s, y - h], true)
	wash(0.2)
	path([x - s, y - h, x, y, x + s, y - h])
	line(x, y, x, y + v)
	A0(0.6)
	line(x - s * 0.72, y - h * 0.1, x - s * 0.72, y + h * 0.5)
	A0(1 / 0.6)


## The outline of a flash of lightning (the sign for electricity), 2 s tall. Follow with g.fill().
func zap(x: float, y: float, s: float) -> void:
	shape([x + 0.18 * s, y - s, x - 0.55 * s, y + 0.14 * s, x - 0.05 * s, y + 0.14 * s, x - 0.2 * s, y + s, x + 0.55 * s, y - 0.2 * s, x + 0.05 * s, y - 0.2 * s], true)


## A power cell standing up, with its middle at (x, y). level 0 to 1 is how full it is.
func cell(x: float, y: float, w: float, h: float, level: float, col := AMB) -> void:
	pen(col, 3)
	box(x - w / 2, y - h / 2, w, h, w * 0.2)
	hide()
	g.stroke()
	slab(x - w * 0.2, y - h / 2 - 7, w * 0.4, 7, 2)
	level = cl(level)
	if level > 0.01:
		A0(0.8)
		slab(x - w / 2 + 5, y + h / 2 - 5 - (h - 10) * level, w - 10, (h - 10) * level, w * 0.12)
		A0(1 / 0.8)


## The lightning sign cut out of a power cell (painted with the dark background)
func zap_bg(x: float, y: float, s: float) -> void:
	g.fill_color = BG
	g.blur = 0
	zap(x, y, s)
	g.fill()


## A small label in a rounded frame. Give it the time t and it blinks.
func tag(s: String, x: float, y: float, col: Color, t = null) -> void:
	var a := g.alpha
	var w := g.measure(s, 20) + 26
	if t != null and not still and fmod(float(t), 0.9) > 0.58:
		g.alpha = a * 0.3
	pen(col, 2.5, 8)
	box(x - w / 2, y - 17, w, 34, 17)
	hide()
	g.stroke()
	txt(s, x, y + 1, 20, col)
	g.alpha = a


## One atom: a ball with its letter. Later atoms cover earlier ones, so they can overlap neatly.
func atom(x: float, y: float, r: float, col: Color, name := "") -> void:
	pen(col, maxf(2, r * 0.13), 8)
	ring(x, y, r)
	hide()
	g.stroke()
	wash(0.28)
	if name != "" and r >= 11:
		txt(name, x, y + 1, roundf(r * 1.15), col)


## One water molecule: a big oxygen with two small hydrogens, 104 degrees apart, like ears.
func h2o(x: float, y: float, s: float, named := false, turn := 0.0) -> void:
	var d := s * 1.5
	for k in [-1, 1]:
		var a: float = -PI / 2 + k * 0.91 + turn
		atom(x + cos(a) * d, y + sin(a) * d, s * 0.56, INK, "H" if named else "")
	atom(x, y, s, CY, "O" if named else "")


## Two atoms of the same kind holding on to each other (O₂ or H₂).
func pair(x: float, y: float, r: float, col: Color) -> void:
	atom(x - r * 0.85, y, r, col)
	atom(x + r * 0.85, y, r, col)


## A leaf growing out of (x, y), to the left (side -1) or right (side 1). ang is how far it points up.
func leaf(x: float, y: float, side: float, len: float, ang: float) -> void:
	var tx := x + cos(ang) * len * side
	var ty := y - sin(ang) * len
	var mx := (x + tx) / 2
	var my := (y + ty) / 2
	var nx := -(ty - y) * 0.3
	var ny := (tx - x) * 0.3
	g.begin()
	g.move_to(x, y)
	g.quadratic_curve_to(mx + nx, my + ny, tx, ty)
	g.quadratic_curve_to(mx - nx, my - ny, x, y)
	hide()
	g.stroke()
	wash(0.3)


## A plant growing out of (x, y). grow 0 to 1 is how big it is, droop 0 to 1 makes it hang its leaves.
func plant(x: float, y: float, grow: float, droop: float, t: float, col := CY) -> void:
	var hgt := 38 + 120 * grow
	var pairs := 1 + roundi(grow * 3)
	var lean := sway(t, 1.2) * 4 * (1 - droop) + droop * hgt * 0.3
	var cx := x + lean * 0.2
	var cy := y - hgt * 0.65
	var tx := x + lean
	var ty := y - hgt + droop * hgt * 0.22
	pen(col, 4, 8)
	g.begin()
	g.move_to(x, y)
	g.quadratic_curve_to(cx, cy, tx, ty)
	g.stroke()
	g.lw = 3
	for i in pairs:
		var k := (i + 1) / (pairs + 0.35)
		var p := bend(x, y, cx, cy, tx, ty, k)
		var ln := (20 + 26 * grow) * (1 - 0.35 * k)
		leaf(p.x, p.y, -1, ln, 0.5 - droop * 1.5 + sway(t, 1.5, i) * 0.06)
		leaf(p.x, p.y, 1, ln, 0.5 - droop * 1.5 - sway(t, 1.5, i + 2) * 0.06)
	leaf(tx, ty, 1 if droop > 0.4 else -1, 16 + 12 * grow, 1.15 - droop * 2)
	leaf(tx, ty, 1, 16 + 12 * grow, 1.15 - droop * 2.2)


## A radio dish on a stand at (x, y), looking up and to the right.
func dish(x: float, y: float, s: float, col := CY) -> void:
	pen(col, 3)
	line(x, y, x, y - 30 * s)
	line(x - 14 * s, y, x + 14 * s, y)
	g.save()
	g.translate(x, y - 34 * s)
	g.rotate(-0.7)
	g.begin()
	g.arc(26 * s, 0, 26 * s, PI - 1.15, PI + 1.15)
	g.close_path()
	hide()
	g.stroke()
	wash(0.25)
	line(0, 0, 17 * s, 0)
	dot(17 * s, 0, 3.5 * s)
	g.restore()


## A little rocket flying along the direction a, with its middle at (x, y).
func rocket(x: float, y: float, a: float, flame: float) -> void:
	g.save()
	g.translate(x, y)
	g.rotate(a)
	pen(AMB, 2.5, 12)
	path([-22, -5, -34 - flame * 8, 0, -22, 5])
	pen(INK, 2.5, 6)
	shape([-22, -9, 12, -9, 30, 0, 12, 9, -22, 9], true)
	hide()
	g.stroke()
	wash(0.15)
	path([-22, -9, -32, -17, -12, -9])
	path([-22, 9, -32, 17, -12, 9])
	ring(6, 0, 3.5)
	g.restore()


## A growing bed (a trough of soil) with its top edge at height y.
func bed(x: float, y: float, w: float) -> void:
	pen(CY, 3)
	box(x - w / 2, y, w, 34, 9)
	hide()
	g.stroke()
	wash(0.1)
	A0(0.5)
	g.lw = 2
	dash(3, 7)
	line(x - w / 2 + 12, y + 12, x + w / 2 - 12, y + 12)
	line(x - w / 2 + 18, y + 22, x + w / 2 - 18, y + 22)
	dash()
	A0(2)


## What is behind every scene: the dark glass, the tablet's beam fanning out from its corner, and a faint grid.
func backdrop(t: float, S: float) -> void:
	var flick := 0.0 if still else sin(t * 2.3) * 0.015
	g.reset(S)
	g.ci.draw_rect(Rect2(0, 0, W * S, HT * S), BG)
	var stops := [[0.0, Color(CY, 0.15 + flick)], [6.0, Color(CY, 0.15 + flick)], [291.3, Color(CY, 0.04)], [640.0, Color(CY, 0.0)]]
	g.radial_sector(14, 396, -1.5, -0.1, stops)
	for i in 3:
		var a := -1.2 + i * 0.42 + (0.0 if still else sin(t * 0.4 + i * 2) * 0.03)
		g.radial_sector(14, 396, a - 0.05, a + 0.05, stops, 2)
	g.stroke_color = Color(CY, 0.05)
	g.lw = 1
	g.blur = 0
	for i in range(1, 16):
		line(i * 45, 0, i * 45, HT)
	for i in range(1, 9):
		line(0, i * 45, W, i * 45)


# =====================================================================
#  THE SCENES
#  fix(d)   fills in every number the game did not send
#  steps(d) gives the sentences, one per step
#  draw(d, s, t) paints step s at time t
# =====================================================================
func _register() -> void:
	SC = {
		"electrolysis": { "icon": "🧊", "title": "How ice becomes air", "src": "iss", "fix": func(d): return { "airPerIce": roundi(num(d.get("airPerIce"), 14, 0, 999)) },
			"steps": func(d): return ["Ice is frozen water. The Air Maker melts it.",
				"Every drop of water is made of tiny pieces: two hydrogen and one oxygen. Scientists write H₂O.",
				"Electricity pulls the pieces apart. That is why the Air Maker needs a power cell.",
				"The oxygen fills the tanks for the crew to breathe. One ice chunk makes " + str(d.airPerIce) + " air."],
			"draw": _draw_electrolysis },
		"scrubber": { "icon": "🫧", "title": "Where your breath goes", "src": "apollo", "fix": func(d): return { "filter": roundi(num(d.get("filter"), 100, 0, 100)) },
			"steps": func(d): return ["You breathe in oxygen. You breathe out a gas called carbon dioxide: CO₂.",
				"In a sealed home it has nowhere to go. Too much of it makes people sleepy and sick.",
				"The filter soaks it up like a sponge. Yours is " + str(d.filter) + "% clean right now.",
				"A full sponge soaks up nothing more. A power cell heats it and pushes the CO₂ outside, so it can be used again."],
			"draw": _draw_scrubber },
		"shield": { "icon": "🛡️", "title": "How soil stops radiation", "src": "artemis", "fix": _fix_shield,
			"steps": func(d): return ["Radiation is tiny, very fast particles from the Sun and from deep space. You cannot see or feel them.",
				"On Earth, thick air and a magnetic field stop most of them. " + ("Mars has only very thin air." if d.site == "mars" else "The Moon has neither."),
				"Mass stops them. A particle that hits soil gives up its energy there instead of in you.",
				"Your dome has " + str(d.bags) + " of " + str(d.slots) + " soil bags. Indoors, " + str(pct(d.shield)) + "% is blocked. Outdoors, only your suit protects you."],
			"draw": _draw_shield },
		"plant": { "icon": "🌱", "title": "What a plant needs", "src": "iss", "fix": func(d): return { "lamp": _yes(d.get("lamp")), "water": _yes(d.get("water")) },
			"steps": func(_d): return ["A plant builds itself out of air and water. Light is the energy it uses to do it.",
				"Light: the pink grow lamps need a power cell. In the dark, a plant stops growing.",
				"Water: the roots drink from the tank. A dry plant closes its pores and waits.",
				"With both, it grows new leaves. It even gives back fresh oxygen."],
			"draw": _draw_plant },
		"solar": { "icon": "☀️", "title": func(d): return "Why panels must face the Sun" if d.site == "moon" else "Why dusty panels make less power",
			"src": func(d): return "artemis" if d.site == "moon" else "insight",
			"fix": func(d): return { "site": place(d.get("site"), "mars"), "eff": share(d.get("eff"), 1, 0, 1) },
			"steps": _steps_solar, "draw": _draw_solar },
		"water": { "icon": "💧", "title": "Every drop, again and again", "src": "iss", "fix": func(d): return { "recycle": share(d.get("recycle"), 0.9, 0, 1) },
			"steps": func(d): return ["Water is heavy, and bringing it from Earth costs a fortune. So nothing is thrown away.",
				"The crew drinks and washes. Their breath and sweat make the air damp. Even pee is collected.",
				"The recycler cleans all of it and gives back about " + str(roundi(d.recycle * 10)) + " cups out of every 10.",
				"Plants keep some in their leaves, and a little is always lost. Fresh ice tops the tank up."],
			"draw": _draw_water },
		"radio": { "icon": "📡", "title": "Why Earth answers late", "src": func(d): return "moon" if d.site == "moon" else "mars", "fix": _fix_radio,
			"steps": func(d):
				var moon: bool = d.site == "moon"
				return ["Radio waves travel at the speed of light: 300,000 km every second. Nothing is faster.",
					"The Moon is 384,000 km from Earth, so a message takes 1.3 seconds." if moon else "Mars is hundreds of millions of km away. Today a message takes " + str(d.oneWay) + ".",
					"A question and its answer make two trips. " + ("That is still quick, almost like a phone call." if moon else "So crews on Mars must often decide for themselves.")],
			"draw": _draw_radio },
	}
	_register2()


# ---------- 1. how ice becomes air ----------
func _draw_electrolysis(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		var m := ez(ph(t, 0.8, 3.4))                                 # 0 = solid ice, 1 = all melted
		A(0.4); pen(CY, 2, 4); box(70, 52, 580, 310, 28)             # the machine around it
		A(0.9); txt("AIR MAKER", 164, 52, 18, CY)
		A(0.65 + 0.35 * sway(t, 3)); pen(AMB, 3.5, 16); zig(136, 304, 288, 12, 14)      # the heater glows
		A(1); pen(AMB, 3, 8); line(126, 278, 314, 278)
		if m > 0.02:
			A(0.8); pen(CY, 3); g.begin(); g.ellipse(220, 274, 34 + 54 * m, 4, 0, 0, TAU); g.stroke()
		var q := 60 * (1 - 0.68 * m)
		A(1); ice(220, 274 - q * 1.15, q)
		A(0.8); pen(CY, 3); arrow(338, 214, 412, 214, 14)
		for i in 3:                                                   # drips run across
			var p := fmod(lap(t, 1.8, 0.4) + i / 3.0, 1.0)
			if m < 1 or still:
				A(0.9 * sin(p * PI) * (1.0 if m > 0.02 else 0.0)); pen(CY, 2); dot(mix(330, 420, p), 232 + sin(p * PI) * -8, 4)
		if m > 0.02:
			A(1); water(520, 214 + sway(t, 1.6) * 3, 52 * ez(m))
		A(1); txt("ice", 220, 328, 24, INK)
		A(0.35 + 0.65 * m); txt("water", 520, 328, 24, CY)
	elif s == 1:
		var o := [190, 170, 156, 236, 226, 230, 164, 296, 224, 290]   # where the small molecules float
		A(0.85); pen(CY, 3.5); drop(190, 215, 84); g.stroke(); wash(0.08)
		for i in 5:
			var p := ez(ph(t, 0.2 + i * 0.2, 0.5))
			if p > 0:
				A(p); h2o(o[i * 2] + sway(t, 1.1, i * 2) * 3, o[i * 2 + 1] + sway(t, 0.9, i) * 3, 12 * p, false, sway(t, 0.7, i) * 0.3)
		var q := ez(ph(t, 1.3, 0.9))                                  # the magnifying glass opens
		if q > 0:
			A(q); pen(AMB, 2.5, 8); ring(226, 230, 27)
			A(0.5 * q); dash(7, 7); line(226, 203, 473, 88); line(226, 257, 473, 292); dash()
			A(q); pen(AMB, 3.5, 14); ring(510, 190, 108 * q); hide(); g.stroke()
			var p := ez(ph(t, 1.9, 0.6))
			if p > 0:
				A(p); h2o(510, 208, 44, true, sway(t, 0.8) * 0.05)
			p = ph(t, 2.6, 0.5)
			if p > 0:
				A(p); txt("H₂O", 510, 348, 44, AMB)
	elif s == 2:
		A(0.9); pen(CY, 3); path([190, 120, 190, 342, 530, 342, 530, 120])     # a tank of water
		A(0.45); g.begin()
		for i in 35:
			g.line_to(190 + i * 10, 150 + sin(i * 0.9 + (0.0 if still else t * 2)) * 3)
		g.stroke()
		A(1); pen(AMB, 3, 10); path([338, 62, 244, 62, 244, 100]); path([382, 62, 476, 62, 476, 100])      # wires
		cell(360, 62, 44, 60, 1); zap_bg(360, 62, 17)
		for i in 2:                                                   # electricity runs down both wires
			var p := fmod(lap(t, 1.1, 0.5) + i / 2.0, 1.0)
			pen(AMB, 2, 12)
			var q := along([338, 62, 244, 62, 244, 100], p); dot(q.x, q.y, 5)
			q = along([382, 62, 476, 62, 476, 100], p); dot(q.x, q.y, 5)
		pen(CY, 3); box(238, 100, 12, 206, 4); wash(0.5); box(470, 100, 12, 206, 4); wash(0.5)
		txt("−", 220, 104, 28, INK); txt("+", 500, 104, 28, INK)
		var o := [348, 200, 384, 258, 342, 312]
		for i in 3:
			var p := ez(ph(t, 1.1 + i * 0.9, 1.3))                     # 0 = one molecule, 1 = pulled apart
			var x: float = o[i * 2] + sway(t, 1.3, i) * 3 * (1 - p)
			var y: float = o[i * 2 + 1] + sway(t, 1.1, i * 3) * 3 * (1 - p)
			if p <= 0:
				h2o(x, y, 20, true, 0)
			else:
				atom(mix(x - 21, 272, p), mix(y - 16, 190 + i * 56 - 12, p), 11.2, INK, "H")
				atom(mix(x + 21, 272, p), mix(y - 16, 190 + i * 56 + 12, p), 11.2, INK, "H")
				atom(mix(x, 446, p), mix(y, 190 + i * 56, p), 20, CY, "O")
				if p < 1:
					A(sin(p * PI)); pen(AMB, 0, 0); zap(x, y, 16); g.fill(); A(1)
		var p2 := ph(t, 2.4, 0.6)
		if p2 > 0:
			A(p2); txt("hydrogen", 100, 246, 20, INK); txt("oxygen", 622, 246, 20, CY)
	else:
		var p := ez(ph(t, 0.6, 3.8))                                  # how far the tank has filled
		A(1); ice(106, 262, 30)
		A(0.7); pen(CY, 3); arrow(148, 262, 184, 262, 10)
		A(1); pen(CY, 3); box(194, 216, 92, 92, 16); wash(0.08)      # the Air Maker
		pen(AMB, 0, 12); zap(240, 262, 26); g.fill()
		for i in 3:                                                   # hydrogen floats away
			var q := fmod(lap(t, 4.2, 0.5) + i / 3.0, 1.0)
			A(0.85 * sin(q * PI)); pair(mix(236, 196, q) + sway(t, 1.4, i) * 5, mix(206, 34, q), 7, INK)
		A(0.75); txt("H₂", 276, 110, 22, INK)
		for i in 4:                                                   # oxygen goes into the tank
			var q := fmod(lap(t, 3.2, 0.5) + i / 4.0, 1.0)
			A(minf(1, minf(q * 6, (1 - q) * 5))); pair(mix(300, 492, q), 262 + sway(t, 1.7, i * 2) * 4, 11, CY)
		A(1); txt("O₂", 384, 222, 24, CY)
		pen(CY, 3.5); rr(476, 74, 124, 270, 44); hide(); g.stroke()
		g.save(); rr(476, 74, 124, 270, 44); g.clip()
		var y := 344 - 270 * (0.1 + 0.72 * p)
		A(0.4); pen(CY, 0, 0); g.fill_rect(476, y, 124, 344 - y)
		A(0.9); pen(CY, 2.5, 8); g.begin()
		for i in 14:
			g.line_to(476 + i * 10, y + sin(i * 1.1 + (0.0 if still else t * 2.2)) * 2.5)
		g.stroke()
		g.restore()
		A(1); pen(CY, 3.5); box(476, 74, 124, 270, 44)
		txt("+" + str(roundi(d.airPerIce * p)), 658, 190, 40, AMB); txt("air", 658, 228, 24, AMB)


# ---------- 2. where your breath goes ----------
## The filter, drawn as a sponge of 8 x 5 holes. full(j) says how full hole j is (0 to 1).
## The holes are numbered so that they fill from the left, unevenly, like a real sponge.
func sponge(x0: float, y0: float, full: Callable) -> void:
	A(0.9); pen(CY, 3); box(x0 - 12, y0 - 12, 299, 194, 20); hide(); g.stroke(); wash(0.06)
	for c in 8:
		for r in 5:
			var x := x0 + c * 35
			var y := y0 + r * 35
			var k := cl(full.call(c * 5 + (r * 3 + c * 2) % 5))
			A(0.45); pen(CY, 2, 3); box(x, y, 30, 30, 10)
			if k > 0:
				A(k); pen(GREY, 2, 6); slab(x + 4, y + 4, 22, 22, 8)
	A(1)


func _draw_scrubber(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		var b := lap(t, 4.6, 0.25)                                    # first half of a breath is in, second half is out
		A(0.9); pen(CY, 4); arcs(238, 206, 122, 0.6, TAU - 0.6)       # the helmet, open at the front
		A(1); pen(INK, 3.5, 6)                                        # a head seen from the side, looking right
		g.begin(); g.arc(232, 190, 62, -0.7, 2.5, true)
		g.line_to(196, 262); g.line_to(200, 300); g.line_to(252, 300); g.line_to(254, 268)
		g.quadratic_curve_to(282, 270, 290, 250)
		g.line_to(297, 238); g.line_to(291, 231); g.line_to(299, 222); g.line_to(296, 212); g.line_to(315, 205); g.line_to(297, 172)
		g.close_path(); hide(); g.stroke(); wash(0.1)
		dot(272, 184, 4.5); g.lw = 3; arcs(224, 200, 11, 0.9, TAU - 0.9); line(262, 170, 282, 168)
		for i in 7:                                                   # oxygen in, along the top
			var p := fmod(lap(t, 2.3, 0.4) + i / 7.0, 1.0)
			var q := bend(690, 104, 470, 104, 306, 222, p)
			A((1.0 if still or b < 0.5 else 0.25) * minf(1, minf(p * 6, (1 - p) * 6))); pen(CY, 2, 8); dot(q.x, q.y, 7)
		for i in 7:                                                   # carbon dioxide out, along the bottom
			var p := fmod(lap(t, 2.3, 0.4) + i / 7.0, 1.0)
			var q := bend(306, 238, 470, 352, 690, 330, p)
			A((1.0 if still or b >= 0.5 else 0.25) * minf(1, minf(p * 6, (1 - p) * 6))); pen(GREY, 2, 6); dot(q.x, q.y, 7)
		A(1); txt("O₂", 600, 68, 28, CY); txt("CO₂", 590, 376, 28, AMB)
		A(0.85); pen(CY, 3); arrow(566, 68, 530, 68, 11); pen(GREY, 3); arrow(632, 376, 668, 376, 11)
	elif s == 1:
		var p := ez(ph(t, 0.3, 5))                                    # how stuffy the room has become
		A(1); pen(CY, 3.5); box(120, 66, 420, 280, 30); wash(0.05)
		var n := 6 + floori(58 * p)
		for i in n:
			var x := 144 + rnd(i * 2 + 1) * 372
			var y := 88 + rnd(i * 2 + 2) * 236
			A(0.85); pen(GREY, 2, 5); dot(x + sway(t, 0.7, i) * 7, y + sway(t, 0.5, i * 2) * 7, 6)
		A(1); astro(330, 340, 1.25, INK)
		if p > 0.45:                                                  # getting sleepy
			for i in 3:
				var q := fmod(lap(t, 3, 0.5) + i / 3.0, 1.0)
				A(sin(q * PI) * cl((p - 0.45) * 4)); txt("z", 364 + q * 44 + i * 4, 262 - q * 70, 20 + q * 16, AMB)
		A(1); pen(GREY, 3, 4); box(600, 96, 36, 236, 12)               # a meter that climbs into the pink
		g.save(); rr(600, 96, 36, 236, 12); g.clip()
		var y := 332 - 236 * (0.08 + 0.84 * p)
		A(0.85); pen(GREY, 0, 0); g.fill_rect(600, maxf(y, 167), 36, 332 - maxf(y, 167))
		if y < 167:
			pen(BAD, 0, 0); g.fill_rect(600, y, 36, 167 - y)
		g.restore()
		A(1); pen(BAD, 2.5, 6); line(590, 167, 646, 167)
		txt("CO₂", 618, 70, 22, GREY)
	elif s == 2:
		var n := roundi(40 * (100 - d.filter) / 100.0)                # how many holes are already full
		var p := ez(ph(t, 0.4, 2.2))
		sponge(350, 84, func(j): return cl(p * n - j) if j < n else 0.0)
		for i in 9:                                                   # more CO₂ drifts in from the left
			var q := fmod(lap(t, 3.4, 0.5) + rnd(i) + i / 9.0, 1.0)
			var y := 100 + rnd(i + 20) * 150
			var x := mix(40, 338, q) if d.filter > 0 else minf(mix(40, 338, q), 300 + rnd(i + 5) * 24)
			A(minf(1, minf(q * 5, (1 - q) * 6)) if d.filter > 0 else minf(1, q * 5)); pen(GREY, 2, 5); dot(x, y + sway(t, 1.3, i) * 5, 6)
		A(0.9); txt("CO₂", 180, 300, 24, GREY)
		A(1); txt(str(d.filter) + "% clean", 487, 330, 36, BAD if d.filter <= 15 else AMB)
	else:
		var p := ez(ph(t, 1.2, 4.6))                                  # how far it has been cleaned out
		A((0.55 + 0.25 * sway(t, 3)) * (1 - 0.6 * p)); pen(AMB, 3, 26); box(98, 68, 319, 214, 26)      # heat all around
		A(1); sponge(120, 90, func(j): return cl((40 - j) - p * 40))
		A(0.7 + 0.3 * sway(t, 3)); pen(AMB, 3.5, 14); zig(128, 388, 296, 11, 20)
		A(1); pen(AMB, 3, 8); line(258, 308, 258, 322); cell(258, 348, 34, 46, 1); zap_bg(258, 348, 13)
		A(0.9); pen(CY, 5, 8); line(560, 28, 560, 150); line(560, 200, 560, 382)      # the wall of the home
		A(0.85); pen(CY, 3); line(420, 158, 668, 158); line(420, 192, 668, 192)       # the pipe through it
		pen(INK, 1, 0)
		for i in 9:
			A(0.3 + 0.4 * rnd(i + 40)); dot(580 + rnd(i + 41) * 124, 90 + rnd(i * 3 + 42) * 280, 1.6)
		for i in 8:                                                   # the CO₂ leaves
			var q := fmod(lap(t, 2.6, 0.5) + i / 8.0, 1.0)
			if p < 1 or q > 0.45:
				var x := mix(424, 760, q)
				var y := 175 + ((rnd(i) - 0.5) * (q - 0.72) * 520 if q > 0.72 else sway(t, 2, i) * 4)
				A(minf(1, minf(q * 8, (1 - q) * 3.4))); pen(GREY, 2, 5); dot(x, y, 6)
		A(1); txt("CO₂", 490, 224, 22, GREY); txt("outside", 640, 60, 22, INK)


# ---------- 3. how soil stops radiation ----------
func _fix_shield(d: Dictionary) -> Dictionary:
	var slots := roundi(num(d.get("slots"), 16, 1, 40))
	return { "slots": slots, "bags": roundi(num(d.get("bags"), 0, 0, slots)), "shield": share(d.get("shield"), 0.25, 0, 1), "site": place(d.get("site"), "moon") }


func _draw_shield(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		stars(22, 7)
		A(1); sun(34, 34, 50, t); txt("Sun", 126, 30, 22, AMB)
		A(0.85); txt("deep space", 606, 30, 22, INK)
		ground(344)
		A(1); astro(390, 344, 1.15, INK)
		A(0.9); txt("?", 428, 262 + sway(t, 2) * 3, 30, INK)
		for i in 13:                                                  # particles from the Sun
			var u := fmod(lap(t, 1.5 + rnd(i) * 0.9, 0.5) + rnd(i + 30), 1.0)
			A(0.95); fly(120 + rnd(i + 9) * 720, 420, 0.64, 0.77, 640, u, BAD, 3)
		for i in 5:                                                   # and a few from far away
			var u := fmod(lap(t, 2.4 + rnd(i + 3), 0.4) + rnd(i + 50), 1.0)
			A(0.7); fly(60 + rnd(i + 70) * 420, 420, -0.5, 0.866, 620, u, BAD, 2.2)
	elif s == 1:
		stars(14, 3)
		# Earth: a blanket of air and a magnetic field
		for k in range(1, 3):
			A(0.75); pen(AMB, 2.5, 8)
			g.begin(); g.ellipse(190 - 31 * k, 206, 31 * k, 42 + 20 * k, 0, 0, TAU); g.stroke()
			g.begin(); g.ellipse(190 + 31 * k, 206, 31 * k, 42 + 20 * k, 0, 0, TAU); g.stroke()
		A(0.3); pen(CY, 12, 14); ring(190, 206, 60)
		A(1); globe(190, 206, 50, "earth")
		# the Moon or Mars: nothing in the way
		var r := 56.0 if d.site == "mars" else 48.0
		if d.site == "mars":
			A(0.3); pen(INK, 2, 6); ring(540, 206, r + 9)
		A(1); globe(540, 206, r, d.site)
		for i in 5:
			var b := -60.0 + i * 30
			var u := fmod(lap(t, 2.4, 0.55) + i * 0.23, 1.0)
			# on Earth each one is stopped high above the ground
			var q := 64.0 if i % 2 else 100.0
			var a := sqrt(maxf(0, q * q - b * b))
			var x := 190 + 0.77 * b - 0.64 * a
			var y := 206 - 0.64 * b - 0.77 * a
			A(1)
			if fly(x, y, 0.64, 0.77, 250, u / 0.6, BAD, 3):
				A(1 - (u - 0.6) / 0.4); spark(x, y, 12, CY if i % 2 else AMB)
			# on the other world it reaches the ground
			if absf(b) < r:
				a = sqrt(r * r - b * b)
				x = 540 + 0.77 * b - 0.64 * a
				y = 206 - 0.64 * b - 0.77 * a
				A(1)
				if fly(x, y, 0.64, 0.77, 250, u / 0.6, BAD, 3):
					A(1 - (u - 0.6) / 0.4); pen(BAD, 3, 10); ring(x, y, 5 + (u - 0.6) * 34)
		A(1); txt("Earth", 190, 352, 24, CY); txt("Mars" if d.site == "mars" else "Moon", 540, 352, 24, INK)
	elif s == 2:
		ground(326)
		A(1); dome(360, 326, 112)
		for k in 11:
			bag(360, 326, 112, 11, k, AMB)
		astro(360, 324, 1.05, INK)
		for i in 6:                                                   # every particle is stopped in the soil
			var a := (64 + i * 21) * PI / 180
			var u := fmod(lap(t, 2.5, 0.5) + i * 0.29, 1.0)
			var x := 360 + cos(a) * 126
			var y := 326 - sin(a) * 126
			A(1)
			if fly(x, y, 0.5, 0.866, 300, u / 0.6, BAD, 3):
				A(1 - (u - 0.6) / 0.4); spark(x, y, 15, AMB)
		A(0.9); pen(AMB, 2, 6); line(520, 148, 468, 200); txt("soil", 540, 132, 24, AMB)
	else:
		var n: int = d.slots
		var has := {}
		var list := []
		for i in int(d.bags):
			has[bag_place(i, n)] = true
		ground(318)
		A(1); dome(285, 318, 128)
		for k in n:
			A(1); bag(285, 318, 128, n, k, AMB, not has.has(k))
		A(0.95); astro(262, 316, 0.9, INK)
		# ten particles aimed at the dome: the right share is stopped, the ones that meet a bag first
		for i in 10:
			var a := (70 + i * 11.3) * PI / 180
			var k := mini(n - 1, floori((PI - a) / PI * n))
			list.append({ "i": i, "a": a, "bag": has.has(k), "key": (0.0 if has.has(k) else 10.0) + rnd(i + 3) })
		list.sort_custom(func(m1, m2): return m1.key < m2.key)
		var hit := roundi(d.shield * 10)
		for i in 10:
			var q: Dictionary = list[i]
			var u := fmod(lap(t, 2.8, 0.45) + rnd(q.i + 11), 1.0)
			var x: float = 285 + cos(q.a) * 128
			var y: float = 318 - sin(q.a) * 128
			A(1)
			if i < hit:
				x += cos(q.a) * (16 if q.bag else 3)
				y -= sin(q.a) * (16 if q.bag else 3)
				if fly(x, y, 0.5, 0.866, 300, u / 0.6, BAD, 3):
					A(1 - (u - 0.6) / 0.4); spark(x, y, 13, AMB if q.bag else CY)
			else:
				var b := (318 - y) / 0.866                             # it goes on, down to the floor
				if fly(x + 0.5 * b, 318, 0.5, 0.866, 300 + b, u / 0.75, BAD, 3):
					A(1 - (u - 0.75) / 0.25); pen(BAD, 3, 10); ring(x + 0.5 * b, 316, 4 + (u - 0.75) * 40)
		A(1); astro(600, 318, 1, INK)                                 # outside, nothing is in the way
		for i in 3:
			var u := fmod(lap(t, 2.2, 0.7) + i * 0.33, 1.0)
			var x := 596.0 + i * 6
			var y := 318.0 - 50 + i * 16
			A(1)
			if fly(x, y, 0.5, 0.866, 280, u / 0.6, BAD, 3):
				A(1 - (u - 0.6) / 0.4); pen(BAD, 3, 10); ring(x, y, 5 + (u - 0.6) * 34)
		A(1); txt(str(d.bags) + " of " + str(d.slots) + " bags", 285, 346, 22, AMB); txt(str(pct(d.shield)) + "% blocked", 285, 378, 24, CY)
		txt("suit only", 600, 346, 22, BAD)


# ---------- 4. what a plant needs ----------
## The grow lamp: lit and pink when it has power, a dashed danger outline when it has none.
func _lamp(t: float, x0: float, w: float, y0: float, len: float, on: bool) -> void:
	if on:
		for j in 5:
			var k := x0 - w / 2 + 14 + j * (w - 28) / 4
			A(0.3 + 0.12 * sway(t, 2, j)); pen(LAMP, 3, 10); line(k, y0 + 22, mix(k, x0, 0.25), y0 + len)
		A(1); pen(LAMP, 3, 16); box(x0 - w / 2, y0, w, 20, 10); wash(0.55)
	else:
		A(0.9); pen(BAD, 3, 6); dash(8, 7); box(x0 - w / 2, y0, w, 20, 10); dash()


func _draw_plant(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		A(1); bed(360, 318, 190); plant(360, 318, 0.3, 0, t, CY)
		for i in 3:
			A(0.4 + 0.2 * sway(t, 2, i)); pen(AMB, 3, 12); dash(10, 9); g.dash_offset = 0.0 if still else -t * 26
			line(330 + i * 30, 66, 345 + i * 15, 206); dash(); g.dash_offset = 0
		A(1); txt("light", 360, 42, 24, AMB)
		for i in 5:                                                   # air drifts in from the left
			var q := fmod(lap(t, 3.6, 0.5) + i / 5.0, 1.0)
			A(minf(1, minf(q * 5, (1 - q) * 5))); pen(GREY, 2, 5); dot(mix(96, 322, q), 250 - 34 * sin(q * 2) + sway(t, 1.4, i) * 5, 6)
		A(1); txt("air", 122, 196, 24, INK)
		for i in 3:                                                   # water comes in from the right
			var q := fmod(lap(t, 3.2, 0.5) + i / 3.0, 1.0)
			A(minf(1, minf(q * 5, (1 - q) * 5))); water(mix(640, 462, q), 330, 8)
		A(1); txt("water", 596, 290, 24, CY)
	elif s == 1:
		A(1.0 if d.lamp else 0.55); bed(330, 322, 190); plant(330, 322, 0.42, 0.0 if d.lamp else 0.5, t, CY)
		_lamp(t, 330, 250, 58, 196, d.lamp)
		# the power cell that feeds the lamp
		A(1); pen(AMB if d.lamp else BAD, 3, 8)
		if not d.lamp:
			dash(8, 7)
		path([455, 68, 560, 68, 560, 132, 584, 132]); dash()
		cell(612, 132, 52, 80, 1.0 if d.lamp else 0.0, AMB if d.lamp else BAD)
		if d.lamp:
			zap_bg(612, 132, 20)
			for i in 2:
				var q := along([584, 132, 560, 132, 560, 68, 455, 68], fmod(lap(t, 1.4, 0.3) + i / 2.0, 1.0)); pen(AMB, 2, 12); dot(q.x, q.y, 5)
		else:
			tag("missing!", 612, 214, BAD, t)
	elif s == 2:
		A(1); pen(CY, 2.5, 6); line(120, 214, 470, 214)               # the top of the soil
		pen(CY, 3); box(150, 292, 290, 52, 12); wash(0.05)            # a tray under the roots
		pen(CY if d.water else BAD, 3.5, 8)
		if not d.water:
			dash(8, 7)
		box(530, 150, 120, 180, 18); dash()                            # the tank
		pen(CY if d.water else GREY, 3); line(530, 318, 440, 318)
		if d.water:
			g.save(); rr(530, 150, 120, 180, 18); g.clip(); A(0.4); pen(CY, 0, 0); g.fill_rect(530, 204 + sway(t, 1.5) * 2, 120, 130); g.restore()
			A(0.35); pen(CY, 0, 0); slab(154, 310, 282, 30, 9)
		else:
			A(1); tag("missing!", 590, 240, BAD, t)
		# the roots, and water climbing up them
		var o := [[296, 214, 270, 250, 236, 268, 214, 318], [296, 214, 290, 262, 276, 290, 270, 324], [296, 214, 302, 260, 322, 286, 326, 326], [296, 214, 330, 246, 364, 270, 384, 318]]
		for i in 4:
			A(0.9); pen(CY if d.water else GREY, 3, 6); path(o[i])
			if d.water:
				for p in 2:
					var q := along([o[i][6], o[i][7], o[i][4], o[i][5], o[i][2], o[i][3], 296, 214, 296, 150], fmod(lap(t, 2.6, 0.5) + i * 0.21 + p / 2.0, 1.0))
					A(1); pen(CY, 2, 10); dot(q.x, q.y, 5)
		if d.water:
			for i in 3:
				var q := fmod(lap(t, 2.4, 0.4) + i / 3.0, 1.0)
				A(minf(1, minf(q * 5, (1 - q) * 5))); pen(CY, 2, 10); dot(mix(526, 444, q), 318, 5)
		A(1.0 if d.water else 0.7); plant(296, 214, 0.42, 0.0 if d.water else 0.75, t, CY)
	else:
		var ok: bool = d.lamp and d.water
		var p := ez(ph(t, 0.5, 3.6)) if ok else 0.0
		_lamp(t, 360, 200, 30, 130, d.lamp)
		if not d.lamp:
			A(1); tag("missing!", 360, 78, BAD, t)
		A(1); water(132, 268, 22, CY if d.water else BAD)
		if not d.water:
			g.fill_color = BG; g.blur = 0; drop(132, 268, 19); g.fill(); tag("missing!", 132, 334, BAD, t)
		else:
			A(0.8); pen(CY, 3); arrow(170, 290, 250, 318, 11)
		A(1.0 if ok else 0.7); bed(360, 334, 200); plant(360, 334, 0.3 + 0.7 * p if ok else 0.3, 0.0 if ok else 0.8, t, CY)
		if ok:
			for i in 6:                                               # fresh oxygen bubbles up
				var q := fmod(lap(t, 4, 0.55) + i / 6.0, 1.0)
				var x := 420 + rnd(i) * 170 + sway(t, 1.3, i) * 8
				var y := mix(290, 60, q)
				A(minf(1, minf(q * 5, (1 - q) * 4)) * cl(p * 3 - 0.6)); pen(CY, 2.5, 10); ring(x, y, 9 if i % 3 else 19)
				if i % 3 == 0:
					txt("O₂", x, y + 1, 17, CY)


# ---------- 5. solar panels: dust on Mars, the sliding Sun on the Moon ----------
func _steps_solar(d: Dictionary) -> Array:
	var live := "Your panels are working at " + str(pct(d.eff)) + "% right now."
	if d.site == "moon":
		return ["A solar panel turns sunlight into electricity.",
			"At the Moon's south pole the Sun never climbs high. It slides slowly around the horizon.",
			"A panel that has not turned with it catches less light. " + live,
			"Turn it back to face the Sun and it charges at full speed again."]
	return ["A solar panel turns sunlight into electricity.",
		"On Mars, dust settles on the glass a little more every day.",
		"Dust blocks the light, so fewer power cells get charged. " + live,
		"Brush the dust off and the light gets through again. NASA's InSight lander ran out of power this way."]


## A wire to a power cell, with electricity running along it (faster when speed is nearer 1).
func _charge(t: float, wire: Array, cx: float, cy: float, level: float, speed: float) -> void:
	A(1); pen(AMB, 3, 8); path(wire)
	if speed > 0.02:
		for j in 3:
			var m := along(wire, fmod(lap(t, 1.5 / maxf(0.3, speed), 0.4) + j / 3.0, 1.0)); pen(AMB, 2, 12); dot(m.x, m.y, 5)
	cell(cx, cy, 64, 116, level)


func _draw_solar(d: Dictionary, s: int, t: float) -> void:
	var sweep := -1.0
	if d.site != "moon" or s == 0:
		# seen from the side: the Sun, a tilted panel on a post, and a power cell
		var n := 0                                                    # specks of dust on the glass
		if s == 1:
			n = 46 if still else floori(ph(t, 0.6, 4.8) * 46)
		elif s >= 2:
			n = roundi(4 + 42 * cl((1 - d.eff) / 0.5))
		var f: float = 1 - 0.5 * n / 46.0 if s == 1 else (d.eff if s == 2 else 1.0)       # the share of the light that gets through
		if s == 3:
			n = maxi(n, 18); sweep = ez(ph(t, 0.9, 2.6)); f = mix(minf(d.eff, 0.6), 1, sweep)
		ground(334)
		A(1); sun(104, 92, 40, t)
		pen(CY, 4); line(320, 240, 320, 334)
		g.save(); g.translate(320, 236); g.rotate(-0.5)
		pen(CY, 3); box(-104, -8, 208, 16, 4); hide(); g.stroke(); wash(0.3)
		g.lw = 2
		for i in range(-2, 3):
			line(i * 35, -8, i * 35, 8)
		g.restore()
		var lit := roundi(f * 5)
		for i in 5:                                                   # five sunbeams; dust stops some of them
			var k: bool = [2, 0, 4, 1, 3][i] < lit
			var x := 320 + 0.878 * (-78 + i * 39) - 0.479 * 13
			var y := 236 - 0.479 * (-78 + i * 39) - 0.878 * 13
			A(0.9 if k else 0.25); pen(AMB, 3, 12); dash(12, 10); g.dash_offset = 0.0 if still else -t * 40
			line(x - 0.832 * 200, y - 0.555 * 200, x - (0.0 if k else 0.832 * 16), y - (0.0 if k else 0.555 * 16))
			dash(); g.dash_offset = 0
		for i in (46 if s == 1 else n):
			var b := -98 + rnd(i + 5) * 196
			var c := 11 + rnd(i + 90) * 5                             # where this speck lies on the glass
			var k := ph(t, 0.6 + 4.8 * i / 46.0 - 1.4, 1.4) if s == 1 else 1.0      # in step 2 it drifts down first
			if k <= 0 or (sweep >= 0 and b < -112 + 224 * sweep):
				continue
			A(minf(1, k * 3)); pen(GREY, 1, 3)
			dot(320 + 0.878 * b - 0.479 * c + (1 - k) * (150 + rnd(i + 7) * 160), 236 - 0.479 * b - 0.878 * c - (1 - k) * (130 + rnd(i + 8) * 60), 3.2)
		if sweep >= 0:                                                # the brush
			g.save(); g.translate(320, 236); g.rotate(-0.5)
			var x := -112 + 224 * sweep
			A(1); pen(AMB, 3, 10); box(x - 14, -42, 28, 13, 4); wash(0.45)
			for i in range(-2, 3):
				line(x + i * 5.5, -29, x + i * 5.5 - (4.0 if sweep < 1 else 0.0), -12)
			line(x, -42, x + 18, -80)
			g.restore()
		if s != 1:
			var e: float
			if s == 0:
				e = ez(ph(t, 0.8, 3))
			elif s == 2:
				e = d.eff * ez(ph(t, 0.6, 3.2))
			else:
				e = 0.3 + 0.7 * ez(ph(t, 1.8, 2.6))
			_charge(t, [320, 320, 592, 320, 592, 282], 592, 222, e, f)
			if s == 2:
				txt(str(pct(d.eff)) + "%", 592, 122, 38, AMB)
	else:
		# a map seen from above: the panel in the middle, the horizon all around, the Sun sliding along it
		var f := -2.3
		var a := acos(cl(d.eff))                                      # the panel faces f; the Sun has slid on by the angle a
		var q: float
		if s == 1:
			q = -2.6 + lap(t, 20, 0.12) * TAU
		elif s == 2:
			q = f + a
		else:
			a = maxf(a, 0.95); q = f + a; f = mix(f, q, ez(ph(t, 0.9, 2.4)))
		var e := cl(cos(q - f))                                       # the share of the light it catches
		var x := 290 + 150 * cos(q)
		var y := 208 + 150 * sin(q)                                   # where the Sun is
		A(0.5); pen(CY, 2.5, 6); dash(5, 9); ring(290, 208, 150); dash(); wash(0.1)
		A(0.75); txt("seen from above", 96, 26, 18, INK); txt("horizon", 290, 376, 18, CY)
		if s == 1:
			for i in range(5, 0, -1):
				A(0.42 - i * 0.07); pen(AMB, 2, 4); ring(290 + 150 * cos(q - i * 0.2), 208 + 150 * sin(q - i * 0.2), 22 - i * 2)
		if s >= 2 and a > 0.25:
			A(0.6); pen(AMB, 2, 4); dash(5, 6); ring(290 + 150 * cos(-2.3), 208 + 150 * sin(-2.3), 22); dash()
		if s >= 2:
			for i in 5:                                               # five sunbeams: the panel only catches some
				var b := (i - 2) * 17.0
				var k := absf(b) <= e * 46
				A(0.9 if k else 0.25); pen(AMB, 3, 12); dash(12, 10); g.dash_offset = 0.0 if still else -t * 40
				var c := 143 - b * tan(q - f) if k else 236.0         # how far this beam gets: to the panel, or past it
				line(x - cos(q) * 30 - sin(q) * b, y - sin(q) * 30 + cos(q) * b, x - cos(q) * c - sin(q) * b, y - sin(q) * c + cos(q) * b)
			dash(); g.dash_offset = 0
			var k2: float = d.eff * ez(ph(t, 0.6, 3.2)) if s == 2 else 0.3 + 0.7 * ez(ph(t, 1.8, 2.6))
			_charge(t, [290, 208, 290, 306, 640, 306, 640, 214], 640, 154, k2, e)
			if s == 2:
				txt(str(pct(d.eff)) + "%", 640, 58, 36, AMB)
		A(1); sun(x, y, 22, t)
		# the panel is a bar; the short arrow shows which way its glass looks
		A(1); pen(CY, 3); arrow(290, 208, 290 + cos(f) * 44, 208 + sin(f) * 44, 11)
		pen(CY, 11, 10); line(290 + sin(f) * 50, 208 - cos(f) * 50, 290 - sin(f) * 50, 208 + cos(f) * 50)
		if s == 3:                                                    # an arrow: turn it round
			x = 290 + 74 * cos(q); y = 208 + 74 * sin(q)
			var b := q + PI / 2
			A(1 - 0.6 * ph(t, 3.4, 0.6)); pen(AMB, 3, 10); arcs(290, 208, 74, -2.3, q)
			path([x - 13 * cos(b - 0.5), y - 13 * sin(b - 0.5), x, y, x - 13 * cos(b + 0.5), y - 13 * sin(b + 0.5)])


# ---------- 6. every drop, again and again ----------
## The recycler: a box with three arrows going round inside.
func _recycler(t: float, x0: float, y0: float, w: float, h: float, col: Color) -> void:
	var a0 := 0.4 if still else t * 1.2
	var r0 := minf(w, h) * 0.27
	A(1); pen(CY, 3.5); box(x0, y0, w, h, 18); hide(); g.stroke(); wash(0.08)
	pen(col, 3.5, 10)
	for j in 3:
		arcs(x0 + w / 2, y0 + h / 2, r0, a0 + j * 2.094, a0 + j * 2.094 + 1.45)
		dot(x0 + w / 2 + cos(a0 + j * 2.094 + 1.45) * r0, y0 + h / 2 + sin(a0 + j * 2.094 + 1.45) * r0, 4.5)


func _draw_water(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		stars(16, 21)
		A(1); globe(124, 252, 58, "earth"); txt("Earth", 124, 338, 22, CY)
		ground(318, 520, 694); A(1); dome(606, 318, 50)
		A(0.5); pen(CY, 2.5, 4); dash(3, 11); g.begin(); g.move_to(176, 214); g.quadratic_curve_to(380, 6, 580, 256); g.stroke(); dash()
		var p := lap(t, 11, 0.5)                                       # the long, slow climb
		var q := bend(176, 214, 380, 6, 580, 256, p)
		var m := bend(176, 214, 380, 6, 580, 256, maxf(0, p - 0.14))
		var u := bend(176, 214, 380, 6, 580, 256, p + 0.01)
		A(minf(1, minf(p * 9, (1 - p) * 9)))
		pen(INK, 2, 4); line(q.x, q.y, m.x, m.y)
		pen(AMB, 3, 12); box(m.x - 19, m.y - 19, 38, 38, 8); hide(); g.stroke()      # the precious cargo
		water(m.x, m.y + 1, 9)
		rocket(q.x, q.y, atan2(u.y - q.y, u.x - q.x), 0.5 + 0.5 * sway(t, 14))
	elif s == 1:
		A(1); astro(360, 334, 1.75, INK)
		# drinking and washing
		pen(CY, 3); path([144, 190, 153, 250, 201, 250, 210, 190]); A(0.4); pen(CY, 0, 0); shape([148, 214, 153, 250, 201, 250, 206, 214], true); g.fill()
		var u := lap(t, 1.8, 0.4)
		A(minf(1, (1 - u) * 4)); water(177, 120 + u * 70, 10)
		A(0.85); pen(CY, 3); arrow(226, 222, 300, 236, 11)
		A(1); txt("drink, wash", 178, 284, 20, CY)
		# breath and sweat make the air damp
		for i in 3:
			A(0.4 + 0.3 * sway(t, 1.5, i)); pen(CY, 2.5, 8); wavy(332 + i * 28, 208, 104, 6, (0.0 if still else -t * 3) + i)
		A(1); pen(CY, 3); box(292, 70, 136, 24, 9); wash(0.12)
		g.lw = 2
		for i in 5:
			line(312 + i * 24, 76, 312 + i * 24, 88)
		txt("damp air", 516, 82, 22, CY)
		# and pee goes down a pipe to its own tank
		A(0.7); pen(AMB, 2.5, 6); path([394, 286, 470, 286, 470, 312, 520, 312])
		A(1); pen(AMB, 3, 8); box(520, 268, 92, 74, 14); wash(0.12)
		for i in 3:
			var q := along([394, 286, 470, 286, 470, 312, 520, 312], fmod(lap(t, 2.2, 0.4) + i / 3.0, 1.0)); pen(AMB, 2, 10); dot(q.x, q.y, 5)
		txt("pee", 566, 244, 22, AMB)
	elif s == 2:
		var n := roundi(d.recycle * 10)
		A(0.8); pen(CY, 3); line(52, 104, 276, 104); line(444, 104, 668, 104)
		for i in 4:                                                   # dirty water in, clean water out
			var u := fmod(lap(t, 3, 0.5) + i / 4.0, 1.0)
			A(minf(1, minf(u * 6, (1 - u) * 6))); water(mix(60, 268, u), 104, 9, GREY if i % 2 else AMB)
			A(minf(1, minf(u * 6, (1 - u) * 6))); water(mix(452, 660, u), 104, 9, CY)
		_recycler(t, 276, 46, 168, 118, AMB)
		for i in 10:                                                  # ten cups went in: this many come back
			var x := 98.0 + i * 54
			var p := ez(ph(t, 0.8 + i * 0.22, 0.5))
			if i < n:
				A(1); pen(CY, 3); path([x, 232, x + 5, 292, x + 33, 292, x + 38, 232])
				if p > 0:
					var y := 289 - 44 * p
					A(0.55); pen(CY, 0, 6); shape([x + 6 - (289 - y) * 0.075, y, x + 6, 289, x + 32, 289, x + 32 + (289 - y) * 0.075, y], true); g.fill()
			else:
				A(0.5); pen(GREY, 2.5, 0); dash(5, 6); path([x, 232, x + 5, 292, x + 33, 292, x + 38, 232]); dash()
		A(1); txt(str(n) + " of 10", 360, 344, 32, AMB)
	else:
		var top := [152, 152, 152, 86, 590, 86, 590, 170]
		var back := [590, 262, 590, 306, 130, 306, 130, 284]
		A(0.5); pen(CY, 2.5, 4); path(top); path(back)
		var u := lap(t, 4, 0.8)                                       # fresh ice drops in now and then
		A(1); pen(CY, 3.5); rr(86, 152, 88, 132, 14); hide(); g.stroke()
		g.save(); rr(86, 152, 88, 132, 14); g.clip(); A(0.4); pen(CY, 0, 0); g.fill_rect(86, 212 - (10 * sin((u - 0.5) * TAU) if u > 0.5 else 0.0), 88, 90); g.restore()
		if u < 0.5:
			A(minf(1, u * 8)); ice(112, 30 + u * 2 * 150, 15); txt("+", 80, 30 + u * 2 * 150, 26, AMB)
		else:
			A(1 - (u - 0.5) * 2); pen(CY, 2.5, 8); g.begin(); g.ellipse(112, 206, 10 + (u - 0.5) * 60, 4, 0, 0, TAU); g.stroke(); txt("+", 80, 180, 26, AMB)
		A(1); astro(360, 84, 0.85, INK)
		_recycler(t, 546, 170, 88, 92, CY)
		plant(360, 306, 0.24, 0, t, CY)
		for i in 5:                                                   # round and round
			var q := along(top, fmod(lap(t, 5, 0.5) + i / 5.0, 1.0)); A(1); water(q.x, q.y, 7)
			var p := fmod(lap(t, 5, 0.5) + i / 5.0, 1.0)
			q = along(back, p)
			if i % 2 and p > 0.5:
				continue                                              # the plant keeps this one
			A(cl((0.5 - p) * 12) if i % 2 else 1.0); water(q.x, q.y, 7)
		u = lap(t, 5, 0.4)                                            # and one drop gets away
		A(0.8 * sin(u * PI)); water(640 + u * 60, 196 - u * 70, 6, GREY)


# ---------- 7. why Earth answers late ----------
func _fix_radio(d: Dictionary) -> Dictionary:
	var site := place(d.get("site"), "mars")
	var ow = d.get("oneWay")
	var one: String
	if site == "moon":
		one = "1.3 seconds"
	elif (ow is float or ow is int) and not is_nan(float(ow)):
		one = "about " + _s(ow) + " minutes"
	elif ow is String and ow != "":
		one = ow
	else:
		one = "about 12 minutes"
	var re := RegEx.create_from_string("(\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z]*)")
	var m := re.search(one)
	var u := m.get_string(2).substr(0, 1).to_lower() if m else ""
	# n and unit are the same time as a number, for the running clock in the picture
	return { "site": site, "oneWay": one, "n": float(m.get_string(1).replace(",", ".")) if m else NAN,
		"unit": " s" if u == "s" else (" min" if u == "m" else (" h" if u == "h" else "")) }


## The clock: k trips done so far (0 to 2).
func _clock(d: Dictionary, k: float, y: float) -> void:
	var v: float = d.n * k
	var text: String
	if is_nan(d.n) or d.unit == "":
		var re := RegEx.create_from_string("^about\\s+")
		text = ("2 × " if k >= 2 else "") + re.sub(str(d.oneWay), "")
	else:
		text = ("%.1f" % v if fmod(d.n, 1.0) != 0 or (d.n < 10 and d.unit == " s") else str(roundi(v))) + d.unit
	A(1); pen(AMB, 3, 10); box(360 - 92, y - 28, 184, 56, 28); hide(); g.stroke()
	txt(text, 360, y + 1, 30, AMB)


## Earth on the left, the Moon or Mars on the right.
func _worlds(d: Dictionary, r: float) -> void:
	var moon: bool = d.site == "moon"
	stars(14, 5)
	A(0.4); pen(CY, 2, 0); dash(3, 9); line(170, 215, 586, 215); dash()
	A(1); globe(104, 215, 54, "earth"); globe(624, 215, r, d.site)
	txt("Earth", 104, 302, 22, CY); txt("Moon" if moon else "Mars", 624, 302, 22, INK)


## A radio signal: three curved lines, flying right (dir 1) or left (dir -1).
func _signal(x0: float, y0: float, dir: float, col: Color) -> void:
	pen(col, 3.5, 12)
	for j in 3:
		g.begin(); g.arc(x0 - dir * 34, y0, 14 + j * 11, -0.75 if dir > 0 else PI - 0.75, 0.75 if dir > 0 else PI + 0.75); g.stroke()


func _draw_radio(d: Dictionary, s: int, t: float) -> void:
	var moon: bool = d.site == "moon"
	var r := 26.0 if moon else 34.0
	if s == 0:
		A(1); dish(126, 318, 1.7, CY)
		for i in 6:                                                   # waves race away from the dish
			var u := fmod(lap(t, 2.6, 0.5) + i / 6.0, 1.0)
			A(0.9 * (1 - u)); pen(AMB, 3.5, 12); arcs(150, 250, 40 + u * 520, -0.95, 0.25)
		A(1); txt("300,000 km", 470, 70, 34, AMB); txt("in 1 second", 470, 110, 24, AMB)
	elif s == 1:
		_worlds(d, r)
		var u := lap(t, 6, 0.8)
		var p := cl(u / 0.55)
		if moon:
			A(0.85); txt("384,000 km", 372, 246, 20, INK)
		if p < 1:
			A(1); _signal(mix(184, 584, p), 215, 1, AMB)
		else:
			A(1 - (u - 0.55) / 0.45); pen(AMB, 3, 12); ring(624, 215, r + 8 + (u - 0.55) * 70)
		_clock(d, p, 112)
	else:
		_worlds(d, r)
		var u := lap(t, 8, 0.95)
		var p := cl(u / 0.4)
		var q := cl((u - 0.47) / 0.4)
		if p < 1:
			A(1)
			var x := mix(190, 578, p)
			_signal(x, 190, 1, AMB); txt("?", x + 22, 190, 30, AMB)
		elif q <= 0:
			A(1); pen(AMB, 3, 12); ring(624, 215, r + 10)
		if q > 0 and q < 1:
			A(1)
			var x := mix(578, 190, q)
			_signal(x, 240, -1, CY); txt("!", x - 22, 240, 30, CY)
		if q >= 1:
			A(1); pen(CY, 3, 12); ring(104, 215, 66)
		_clock(d, p + q, 100)


func _register2() -> void:
	SC["storm"] = { "icon": "🌩️", "title": "What a solar storm is", "src": "donki",
		"fix": func(d): return { "dish": _yes(d.get("dish")), "lead": roundi(num(d.get("lead"), 45, 0, 999)) },
		"steps": func(d): return ["Sometimes the Sun flashes (a solar flare) and throws out a giant cloud of gas (a CME).",
			"The flash of light arrives in minutes. Telescopes that watch the Sun see it, and the cloud leaving.",
			"The dangerous particles, sped up by the cloud's shock wave, come later. That gap is your warning time.",
			("Your Radio Dish is on, so Earth's forecasters can warn you early: about " + str(d.lead) + " seconds in this game.") if d.dish else
				("Your Radio Dish is off, so only your suit's sensor notices, when the particles are already here: " + ("about " + str(d.lead) + " seconds of warning." if d.lead > 0 else "no warning at all."))],
		"draw": _draw_storm }
	SC["gravity"] = { "icon": "🪐", "title": "Why everything flies so far", "src": func(d): return "mars" if d.site == "mars" else "moon",
		"fix": func(d): return { "site": place(d.get("site"), "moon") },
		"steps": func(d):
			var mars: bool = d.site == "mars"
			return ["Gravity is the pull of a planet or moon. The more massive it is, the harder it pulls.",
				"Mars is smaller than Earth. It pulls with about 38% of Earth's strength." if mars else "The Moon is much smaller than Earth. It pulls with only one-sixth of Earth's strength.",
				"So the same throw stays up longer and lands about " + ("2.6" if mars else "6") + " times farther away."],
		"draw": _draw_gravity }
	SC["crops"] = { "icon": "🥔", "title": "Lettuce or potatoes?", "src": "iss", "fix": _fix_crops,
		"steps": func(d): return ["Lettuce is all leaves. It is ready in under a day, but one crate is only " + str(d.lettuce.food) + " food.",
			"Potatoes store their energy underground. They take almost two days, and one crate is " + str(d.potato.food) + " food.",
			"Fast and small, or slow and big? Space farmers have to plan days ahead."],
		"draw": _draw_crops }
	SC["drill"] = { "icon": "🔩", "title": "Why the drill gets hot", "src": func(d): return "msl" if d.site == "mars" else "apollo",
		"fix": func(d): return { "site": place(d.get("site"), "moon") },
		"steps": func(d): return ["Rubbing makes heat. Rub your hands together fast and feel it. A drill rubs rock much faster.",
			"On Earth, air and water carry the heat away. " + ("The air on Mars is about 100 times thinner, so the heat stays in the drill." if d.site == "mars" else "The Moon has no air at all, so the heat stays in the drill."),
			"So drill in short bursts and let it cool. An overheated drill bit wears out, and a worn bit heats up even faster."],
		"draw": _draw_drill }
	SC["dose"] = { "icon": "☢️", "title": "Why the badge only goes up", "src": "rad",
		"fix": func(d): return { "dose": roundi(num(d.get("dose"), 0, 0, 100)) },
		"steps": func(d): return ["Each particle of radiation that passes through you can damage a few of your body's tiny cells.",
			"Your body repairs most of the damage. But doctors add up every bit an astronaut ever receives.",
			"That total is your badge: " + str(d.dose) + "% now. It never goes down. So fill it as slowly as you can: shield the dome and shelter from storms."],
		"draw": _draw_dose }
	SC["shade"] = { "icon": "🧱", "title": "Soil blocks sunlight too", "src": "artemis", "fix": _fix_shade,
		"steps": func(d): return ["Soil bags stop radiation. They stop sunlight just as well.",
			"The first " + str(d.free) + " bags sit low on the walls. After that, they start to cover the skylights.",
			"With the skylights covered, the lamps inside must stay on all day. Right now that takes " + _s(roundf(d.loss * 1000) / 10.0) + "% of your solar power.",
			"More shield, or more power? Real habitat designers face exactly this choice."],
		"draw": _draw_shade }
	SC["longdark"] = { "icon": "🌑", "title": "The long dark", "src": "lro", "fix": func(_d): return {},
		"steps": func(_d): return ["On most of the Moon, day lasts two weeks. Then comes two weeks of night, at about −130°C.",
			"Your outpost sits on a crater rim near the south pole, where the Sun almost never sets.",
			"But sometimes a mountain hides the Sun for a whole day, and the panels make almost nothing.",
			"So save power cells on the rack the day before, and spend them only on what keeps the crew alive."],
		"draw": _draw_longdark }
	SC["battery"] = { "icon": "🔋", "title": "Why batteries hate being empty", "src": "mer",
		"fix": func(d): return { "cap": share(d.get("cap"), 1, 0, 1) },
		"steps": func(d): return ["A battery stores energy in thin layers of chemicals.",
			"Draining it all the way to zero damages those layers a little.",
			"Each time, it can hold a bit less: yours holds " + str(pct(d.cap)) + "% of what it did. Rover drivers always keep some charge in reserve."],
		"draw": _draw_battery }


# ---------- 8. what a solar storm is ----------
## The edge of the Sun, peeking in from the left.
func _big_sun(cx: float, cy: float, r: float) -> void:
	A(1); pen(AMB, 4, 18); ring(cx, cy, r); wash(0.2)
	A(0.5); g.lw = 2.5; arcs(cx, cy, r * 0.8, -0.5, -0.1); arcs(cx, cy, r * 0.62, 0.2, 0.7); arcs(cx, cy, r * 0.88, 0.5, 0.75)


## A cloud of dangerous particles around (x0, y0).
func _cloud(x0: float, y0: float, a: float) -> void:
	for j in 16:
		A(a * (0.6 + 0.4 * rnd(j)))
		fly(x0 + (rnd(j + 1) - 0.5) * 110, y0 + (rnd(j + 20) - 0.5) * 104, 1, 0, 1, 0, BAD, 2.6)


func _draw_storm(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		stars(14, 9)
		_big_sun(24, 205, 150)
		A(1); txt("Sun", 84, 212, 28, AMB)
		var u := lap(t, 4.4, 0.4)
		var p := cl(u / 0.75)                                         # the flare bursts out, again and again
		var q := ez(minf(1, p * 2.2))
		A(1); pen(AMB, 5, 20); g.begin(); g.move_to(160, 132); g.bezier_curve_to(160 + 190 * q, 60, 170 + 190 * q, 250, 172, 204); g.stroke()
		for i in 9:
			var y := -0.75 + i * 0.19
			A(1 - p); pen(AMB, 3, 12); line(172 + cos(y) * (40 + p * 330), 168 + sin(y) * (40 + p * 330), 172 + cos(y) * (86 + p * 330), 168 + sin(y) * (86 + p * 330))
		for i in 3:
			A((1 - p) * 0.8); pen(AMB, 3, 14); arcs(172, 168, maxf(0, 30 + p * 360 - i * 46), -0.7, 0.7)
		A(1); txt("solar flare", 520, 66, 28, AMB)
	elif s == 1:
		stars(14, 9)
		_big_sun(-10, 190, 110)
		# a telescope in space, watching the Sun
		A(1); pen(CY, 3); box(584, 170, 46, 40, 8); wash(0.15); box(538, 180, 40, 20, 3); wash(0.3); box(636, 180, 40, 20, 3); wash(0.3)
		line(578, 190, 584, 190); line(630, 190, 636, 190); arcs(584, 190, 12, 1.57, 4.71)
		var u := lap(t, 5, 0.75)
		var p := cl(u / 0.3)
		if p < 1:
			for i in 3:
				A(1); pen(AMB, 3.5, 14); arcs(-10, 190, mix(124, 576, p) - i * 15, -0.3, 0.3)
		else:
			A(1 - (u - 0.3) / 0.7); pen(AMB, 3, 14); ring(607, 190, 36 + (u - 0.3) * 50); A(1); txt("!", 607, 128, 40, AMB)
		A(0.9); pen(AMB, 2.5, 6); line(118, 296, 584, 296); line(118, 286, 118, 306); line(584, 286, 584, 306)
		A(1); txt("8 minutes", 351, 330, 26, AMB)
	elif s == 2:
		_big_sun(-20, 150, 104)
		ground(262, 556, 700); A(1); dome(628, 262, 40)
		var u := lap(t, 8, 0.6)
		var p := cl(u / 0.15)
		var q := cl(u / 0.85)
		if p < 1:
			for i in 3:
				A(1); pen(AMB, 3.5, 14); arcs(-20, 150, mix(118, 610, p) - i * 15, -0.1, 0.42)
		if q < 1:
			_cloud(mix(130, 600, q), 196, 1)
		else:
			A(1 - (u - 0.85) / 0.15); pen(BAD, 3, 12); ring(628, 240, 30 + (u - 0.85) * 200)
		# the timeline underneath: the flash is seen early, the particles arrive late
		A(0.7); pen(CY, 2.5, 4); line(150, 344, 600, 344)
		A(1); pen(AMB, 9, 12); line(218, 344, 532, 344)
		pen(AMB, 3, 8); line(218, 330, 218, 358); pen(BAD, 3, 8); line(532, 330, 532, 358)
		pen(INK, 0, 8); dot(150 + 450 * u, 344, 6)
		txt("warning time", 375, 316, 22, AMB); txt("flash", 218, 380, 20, AMB); txt("particles", 532, 380, 20, BAD)
	else:
		ground(314)
		A(1); dome(560, 314, 76)
		var u := lap(t, 6, 0.55)
		if d.dish:
			A(1); astro(560, 312, 0.85, INK)
			globe(668, 62, 28, "earth")
			for i in 3:
				var q := fmod(lap(t, 1.8, 0.5) + i / 3.0, 1.0)
				A(1 - q); pen(AMB, 3, 12); arcs(668, 62, 44 + q * 120, 1.85, 2.5)
			A(1); dish(614, 262, 0.95, AMB)
		else:
			A(0.8); dish(614, 262, 0.95, GREY)
			A(1); pen(BAD, 4, 8); line(596, 196, 656, 252)
			# only the small sensor on the suit keeps watch
			astro(430, 314, 0.95, INK); pen(CY, 0, 12); dot(430, 284, 4.5)
			for i in 2:
				var q := fmod(lap(t, 1.6, 0.5) + i / 2.0, 1.0)
				A(1 - q); pen(CY, 3, 10); arcs(416, 284, 10 + q * 44, 2.4, 3.9)
		_cloud(mix(-30, 250, u), 246, 0.95)
		# a stopwatch with the warning time
		A(1); pen(AMB, 4, 12); ring(250, 124, 70); hide(); g.stroke(); slab(240, 40, 20, 14, 4)
		pen(AMB, 3, 8); line(250, 124, 250 + sin(u * TAU) * 56, 124 - cos(u * TAU) * 56)
		txt(str(d.lead) + " s", 250, 126, 40, AMB)


# ---------- 9. why everything flies so far ----------
## A world that pulls everything towards its middle: longer, thicker arrows mean a harder pull.
## A ball dropped from the same height lands sooner where the pull is harder.
func _pull(t: float, cx: float, cy: float, r: float, len: float, w: float, fall_secs: float) -> void:
	var m := 0.0 if still else fmod(t * 0.6, 1.0) * 8
	var f := minf(1, lap(t, 3.4, 0.95) * 3.4 / fall_secs)
	A(1); globe(cx, cy, r, "moon")
	for j in 8:
		if j == 6:
			continue                                                  # the top is left free for the falling ball
		var b := j * PI / 4
		A(0.9); pen(AMB, w, 10)
		arrow(cx + cos(b) * (r + 14 + len - m), cy + sin(b) * (r + 14 + len - m), cx + cos(b) * (r + 14 - m * 0.3), cy + sin(b) * (r + 14 - m * 0.3), 5 + w * 2)
	A(1); pen(INK, 0, 10); dot(cx, cy - r - 8 - 62 * (1 - f * f), 7)


## One throw: the astronaut, the ground, and the ball's curved path. reach = how far it lands, fly_secs = how long it is in the air.
func _lane(u: float, gy: float, reach: float, fly_secs: float, who: String, col: Color, mark: String) -> void:
	var f := cl(u / fly_secs)
	ground(gy, 60, 680)
	A(1); astro(108, gy, 0.8, INK); txt(who, 108, gy - 74, 22, col)
	for j in 41:
		if j / 40.0 > f:
			break
		A(0.55); pen(col, 0, 4); dot(132 + reach * j / 40.0, gy - 8 - reach * (j / 40.0) * (1 - j / 40.0), 2.4)
	A(1); pen(INK, 0, 12); dot(132 + reach * f, gy - 8 - reach * f * (1 - f), 7)      # a real throw at 45 degrees: 4 times as far as it is high
	if f >= 1:
		A(1); pen(AMB, 3, 8); line(132, gy + 14, 132 + reach, gy + 14); line(132, gy + 8, 132, gy + 20); line(132 + reach, gy + 8, 132 + reach, gy + 20)
		txt(mark, 132 + reach / 2, gy + 36, 24, AMB)


func _draw_gravity(d: Dictionary, s: int, t: float) -> void:
	var mars: bool = d.site == "mars"
	var name := "Mars" if mars else "Moon"
	var times := 2.63 if mars else 6.0
	var secs := 3.2 if mars else 4.2
	if s == 0:
		stars(12, 31)
		_pull(t, 196, 206, 72, 40, 4.5, 0.75); _pull(t, 548, 206, 36, 16, 2.5, 1.9)
		A(1); txt("strong pull", 196, 374, 22, AMB); txt("weak pull", 548, 374, 22, AMB)
	elif s == 1:
		stars(12, 31)
		A(1); globe(190, 150, 74, "earth"); globe(520, 150, 74 * (0.53 if mars else 0.27), d.site)      # their real sizes, side by side
		txt("Earth", 190, 254, 24, CY); txt(name, 520, 254, 24, INK)
		var p := ez(ph(t, 0.6, 1))
		var u := ez(ph(t, 1.7, 1))
		var a := 86 / times                                           # the pull of each, as an arrow
		A(1); pen(AMB, 7, 12)
		if p > 0.05:
			arrow(150, 286, 150, 286 + 86 * p, 16)
		g.lw = maxf(3.5, minf(7, a * 0.22))
		if u > 0.05:
			arrow(480, 286, 480, 286 + a * u, minf(16, a * 0.6))
		A(p); txt("Earth's pull", 176, 328, 22, AMB, "left")
		A(u); txt("38% of it" if mars else "1/6 of it", 506, 298, 22, AMB, "left")
	else:
		var u := lap(t, secs + 3.3, 0.97) * (secs + 3.3) - 0.7       # seconds since both let go of the ball
		_lane(u, 138, 500 / times, secs / times, "Earth", CY, "1×")
		_lane(u, 330, 500, secs, name, INK, "2.6×" if mars else "6×")


# ---------- 10. lettuce or potatoes? ----------
func _fix_crops(d: Dictionary) -> Dictionary:
	var l: Dictionary = d.lettuce if d.get("lettuce") is Dictionary else {}
	var p: Dictionary = d.potato if d.get("potato") is Dictionary else {}
	return { "lettuce": { "days": num(l.get("days"), 0.8, 0.1, 6), "food": roundi(num(l.get("food"), 9, 0, 999)) },
		"potato": { "days": num(p.get("days"), 1.7, 0.1, 6), "food": roundi(num(p.get("food"), 22, 0, 999)) } }


## One crop: its picture, a bar that fills while it grows, and the crate of food it gives at the end.
func _crop_row(t: float, now: float, ppd: float, y: float, c: Dictionary, who: String, on: bool, roots: bool) -> void:
	var k := 1.0 if on else 0.22
	var days: float = c.days
	var grown := cl(now / days)
	var w := days * ppd
	var side := (15 + 6.5 * sqrt(float(c.food))) * ez(ph(now, days - 0.1, 0.1))
	var cx := 236 + w + 40
	A(k * 0.8); pen(CY, 2.5, 6); line(84, y + 16, 164, y + 16)      # the soil
	A(k)
	if roots:
		plant(124, y + 16, 0.04 + 0.12 * grown, 0, t, CY)
		for j in 3:
			pen(INK, 2.5, 6); g.begin(); g.ellipse(102 + j * 22, y + 32 + (j % 2) * 5, 4 + 8 * grown, 3 + 5 * grown, 0.3 - j * 0.3, 0, TAU); hide(); g.stroke(); wash(0.35)
	else:
		pen(CY, 3, 8)
		for j in 2:
			leaf(124, y + 16, -1, 14 + 26 * grown, 0.25 + j * 0.6); leaf(124, y + 16, 1, 14 + 26 * grown, 0.25 + j * 0.6)
		leaf(124, y + 16, 1, 12 + 22 * grown, 1.57)
	txt(who, 124, y + (62 if roots else 44), 20, INK)
	A(k * 0.55); pen(CY, 2, 0); box(236, y - 15, w, 30, 10)
	if w * grown > 6:
		A(k * 0.75); pen(CY, 0, 8); slab(236, y - 15, w * grown, 30, 10)
	if side > 6:                                                      # the crate: bigger for more food
		A(k); pen(AMB, 3, 10); box(cx - side / 2, y - side / 2, side, side, 7); hide(); g.stroke(); wash(0.14)
		txt(str(c.food), cx, y + 1, roundf(side * 0.5), AMB)


func _draw_crops(d: Dictionary, s: int, t: float) -> void:
	var span := maxi(2, ceili(maxf(d.lettuce.days, d.potato.days)))
	var ppd := 372.0 / span
	var now := span * ph(t, 0.7, 5.4)
	for i in span:                                                    # the days along the bottom: a bright half for day, a dim half for night
		var x := 236 + i * ppd
		A(0.9); pen(AMB, 7, 8); line(x + 6, 322, x + ppd / 2 - 4, 322)
		A(0.4); pen(CY, 7, 0); line(x + ppd / 2 + 6, 322, x + ppd - 6, 322)
		A(0.9); txt("day " + str(i + 1), x + ppd / 2, 352, 20, INK)
	A(0.6); pen(INK, 2, 4); dash(4, 7); line(236 + now * ppd, 62, 236 + now * ppd, 322); dash()      # now
	_crop_row(t, now, ppd, 98, d.lettuce, "lettuce", s != 1, false)
	_crop_row(t, now, ppd, 226, d.potato, "potatoes", s != 0, true)


# ---------- 11. why the drill gets hot ----------
## A drill standing in a hole in the rock. turn = is it spinning; heat 0 to 1 colours the bit cyan, amber, then pink.
func _rig(t: float, x0: float, gy: float, turn: bool, heat: float) -> void:
	var col := CY if heat < 0.4 else (AMB if heat < 0.78 else BAD)
	var sp := fmod(t * 5, 1.0) if turn and not still else 0.3
	A(0.85); pen(CY, 3, 6); path([x0 - 104, gy, x0 - 15, gy, x0 - 15, gy + 74, x0 + 15, gy + 74, x0 + 15, gy, x0 + 104, gy])
	A(0.3); g.lw = 2
	for j in 6:
		if j != 2 and j != 3:
			line(x0 - 86 + j * 36, gy + 14, x0 - 98 + j * 36, gy + 32); line(x0 - 74 + j * 36, gy + 44, x0 - 86 + j * 36, gy + 62)
	if heat > 0.05:
		A(0.55 * heat); pen(col, 0, 34); dot(x0, gy + 42, 14 + 14 * heat)      # the heat in the hole
	A(1); pen(col, 3.5, 10); line(x0, gy - 84, x0, gy + 56)            # the bit: a twisted rod
	g.lw = 3
	for j in 8:
		var yy := gy - 82 + fmod(j + sp, 8.0) * 17
		line(x0 - 9, yy, x0 + 9, yy + 9)
	path([x0 - 9, gy + 54, x0, gy + 70, x0 + 9, gy + 54])
	pen(CY, 3.5); box(x0 - 13, gy - 104, 26, 20, 5); hide(); g.stroke()      # the motor on top
	box(x0 - 36, gy - 168, 72, 64, 14); hide(); g.stroke(); wash(0.12)
	line(x0 - 56, gy - 146, x0 - 36, gy - 146); line(x0 + 36, gy - 146, x0 + 56, gy - 146)
	if turn:
		A(0.75); pen(CY, 2.5, 6); arcs(x0, gy - 136, 17, sp * TAU, sp * TAU + 4.2)


## Air around a drill: it comes in cool (cyan) and leaves warm (amber), taking the heat with it.
func _air(t: float, x0: float, gy: float, n: int) -> void:
	for j in n:
		var f := fmod(lap(t, 2.8, 0.5) + float(j) / n, 1.0)
		var side := 1.0 if j % 2 else -1.0
		var px: float
		var py: float
		if f < 0.5:
			px = x0 + side * mix(100, 26, f * 2); py = gy - 14 - (j % 3) * 5; A(minf(1, f * 8)); pen(CY, 0, 8)
		else:
			px = x0 + side * mix(26, 86, f * 2 - 1); py = gy - 14 - (f * 2 - 1) * 110; A(minf(1, (1 - f) * 6)); pen(AMB, 0, 10)
		dot(px, py, 5.5)


func _steam(t: float, x0: float, y0: float, col: Color, a: float) -> void:
	for j in [-1, 1]:
		A(a * (0.6 + 0.3 * sway(t, 2, j))); pen(col, 2.5, 10); wavy(x0 + j * 44, y0, y0 - 64, 5, (0.0 if still else -t * 3) + j)


func _draw_drill(d: Dictionary, s: int, t: float) -> void:
	var mars: bool = d.site == "mars"
	if s == 0:
		var u := sway(t, 9) * 13                                      # two hands rubbing up and down
		A(0.5 + 0.3 * sway(t, 3)); pen(AMB, 5, 24); line(176, 180, 176, 274)
		for k in [-1, 1]:
			g.save(); g.translate(176 + k * 23, 228 + k * u); g.rotate(k * 0.1)
			A(1); pen(INK, 3.5, 8)
			g.begin(); g.ellipse(k * 25, 2, 9, 18, k * 0.5, 0, TAU); hide(); g.stroke(); wash(0.14)      # the thumb
			rr(-22, -62, 44, 108, 20); hide(); g.stroke(); wash(0.14)                                     # the palm
			rr(-25, 40, 50, 24, 7); hide(); g.stroke(); wash(0.3)                                         # the cuff
			g.restore()
		for i in [-1, 0, 1]:
			A(0.55 + 0.3 * sway(t, 2, i)); pen(AMB, 2.5, 10); wavy(176 + i * 26, 146, 84, 5, (0.0 if still else -t * 3) + i)
		A(0.7); pen(CY, 3); arrow(276, 228, 378, 228, 13)
		_rig(t, 520, 244, true, 0.6); _steam(t, 520, 232, AMB, 1)
	elif s == 1:
		var p := ez(ph(t, 0.6, 4.5))                                  # the heat building up where the air is missing
		A(1); txt("Earth", 190, 44, 24, CY); txt("Mars" if mars else "Moon", 530, 44, 24, INK)
		_rig(t, 190, 250, true, 0.15); _air(t, 190, 250, 10)
		_rig(t, 530, 250, true, 0.25 + 0.75 * p)
		if mars:
			_air(t, 530, 250, 2)
		_steam(t, 530, 238, BAD if p > 0.7 else AMB, 0.3 + 0.7 * p)
		A(1); txt("air cools it", 190, 374, 20, CY)
		A(0.3 + 0.7 * p); txt("heat stays", 530, 374, 20, BAD)
	else:
		var u := lap(t, 5, 0.22)
		var on := u < 0.4                                             # a short burst, then a long rest
		var hot := mix(0.25, 0.7, u / 0.4) if on else mix(0.7, 0.25, ez((u - 0.4) / 0.6))
		_rig(t, 220, 250, on, hot)
		if on:
			_steam(t, 220, 238, AMB, 0.8)
		else:
			A(1); pen(CY, 0, 8); slab(204, 28, 11, 36, 4); slab(225, 28, 11, 36, 4)      # the pause sign
		# a thermometer: keep it out of the pink
		A(1); pen(INK, 3.5, 6); rr(500, 60, 36, 240, 18); hide(); g.stroke()
		A(0.3); pen(BAD, 0, 0); slab(504, 64, 28, 60, 14)
		A(1); pen(INK, 3.5, 6); ring(518, 318, 28); hide(); g.stroke()
		var y := 292 - 210 * hot
		pen(AMB, 0, 10); dot(518, 318, 19); slab(509, y, 18, 318 - y, 9)
		pen(BAD, 3, 8); line(486, 126, 550, 126); txt("too hot", 614, 96, 20, BAD)


# ---------- 12. why the badge only goes up ----------
## Seven cells under a magnifying glass. hurt(j) says how damaged cell j is (0 to 1).
## Cell 0 is in the middle; cells 5, 0 and 2 lie in one slanting line.
func _lens(cx: float, cy: float, hurt: Callable) -> void:
	A(1); pen(AMB, 3.5, 14); ring(cx, cy, 128); hide(); g.stroke()
	for j in 7:
		var a := (j - 1) * PI / 3
		var px := cx + (cos(a) * 66 if j else 0.0)
		var py := cy + (sin(a) * 66 if j else 0.0)
		var h := cl(float(hurt.call(j))) > 0.5
		A(1); pen(BAD if h else CY, 3, 8); ring(px, py, 28); wash(0.16); dot(px, py, 8)
		if h:
			g.lw = 2.5; path([px - 14, py - 21, px - 3, py - 8, px - 13, py + 2, px + 2, py + 20])      # a crack


func _draw_dose(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		# a person, and a close look at a tiny piece of them
		A(1); pen(INK, 3.5, 6); ring(150, 92, 30); wash(0.1); box(110, 130, 80, 124, 28); wash(0.1)
		line(110, 152, 84, 226); line(190, 152, 216, 226); line(132, 254, 128, 338); line(168, 254, 172, 338)
		pen(AMB, 2.5, 8); ring(150, 190, 15)
		A(0.5); dash(7, 7); line(150, 175, 420, 100); line(150, 205, 420, 312); dash()
		var u := lap(t, 5, 0.7)
		var p := cl(u / 0.36)                                         # one particle goes straight through
		_lens(486, 206, func(j): return (1.0 if p > 0.33 else 0.0) if j == 5 else ((1.0 if p > 0.5 else 0.0) if j == 0 else ((1.0 if p > 0.67 else 0.0) if j == 2 else 0.0)))
		g.save(); g.begin(); g.arc(486, 206, 125, 0, TAU); g.clip()
		A(1); fly(486 + 0.5 * 190, 206 + 0.866 * 190, 0.5, 0.866, 380, p, BAD, 4)
		g.restore()
	elif s == 1:
		_lens(206, 206, func(j): return 1.0 if j == 0 else (1 - ph(t, 1, 0.8) if j == 5 else (1 - ph(t, 2.2, 0.8) if j == 2 else 0.0)))
		for i in 2:                                                   # a sparkle where a cell is being mended
			var p := ph(t, 0.9 + i * 1.2, 1.2)
			if p > 0 and p < 1:
				A(sin(p * PI)); spark(206 + (33 if i else -33), 206 + (57 if i else -57), 40, AMB)
		# the doctor's record: every bit is added to the total
		A(1); pen(INK, 3.5, 6); box(452, 66, 196, 262, 16); hide(); g.stroke(); wash(0.06); pen(INK, 0, 6); slab(516, 54, 68, 22, 8)
		var n := 15 if still else floori(ph(t, 0.8, 5.5) * 15 + 0.001)
		for i in n:
			var x := 484 + (i % 5) * 33.0
			var y := 104 + floorf(i / 5.0) * 58
			A(1); pen(AMB, 4, 8); line(x, y, x, y + 38)
		A(1); txt("total", 550, 300, 22, AMB)
	else:
		var p := ez(ph(t, 0.5, 2.8))
		var col := BAD if d.dose >= 75 else AMB
		A(1); pen(INK, 3.5, 8); box(246, 52, 228, 300, 28); hide(); g.stroke(); wash(0.07); pen(INK, 0, 6); slab(326, 38, 68, 24, 9)      # the badge
		pen(AMB, 0, 12)                                               # the radiation sign
		for i in 3:
			var u := PI / 2 + i * 2.0944
			g.begin(); g.arc(360, 136, 44, u - 0.5236, u + 0.5236); g.arc(360, 136, 14, u + 0.5236, u - 0.5236, true); g.close_path(); g.fill()
		dot(360, 136, 7.5)
		pen(INK, 3, 4); rr(280, 212, 160, 34, 17); hide(); g.stroke()      # the bar that only ever fills
		if d.dose > 0:
			g.save(); rr(280, 212, 160, 34, 17); g.clip(); A(0.9); pen(col, 0, 0); g.fill_rect(280, 212, 160 * d.dose / 100.0 * p, 34); g.restore()
		A(1); txt(str(roundi(d.dose * p)) + "%", 360, 298, 46, col)
		pen(AMB, 6, 12); arrow(560, 262, 560, 150, 18)                # up is the only way it goes
		A(0.8); pen(GREY, 6, 0); arrow(160, 150, 160, 262, 18)
		A(1); pen(BAD, 5, 10); line(132, 176, 188, 236); line(188, 176, 132, 236)


# ---------- 13. soil blocks sunlight too ----------
func _fix_shade(d: Dictionary) -> Dictionary:
	var slots := roundi(num(d.get("slots"), 16, 2, 40))
	var free := roundi(num(d.get("free"), 8, 0, slots))
	return { "slots": slots, "free": free, "bags": roundi(num(d.get("bags"), 9, 0, slots)), "loss": num(d.get("loss"), 0.015, 0, 1) }


## A dome with three skylights high up. count bags are on it (the first d.free in cyan, low on the walls).
## Sunlight falls in through every skylight that is not covered. Returns how much of the skylights is covered (0 to 1).
## only = a list of places: put bags in just those places instead (for the first step).
func _skydome(d: Dictionary, cx: float, cy: float, r: float, count: int, only = null) -> float:
	var n: int = d.slots
	var a0 := float(d.free) / 2 * PI / n
	var wide := PI - 2 * a0
	var half := minf(0.13, wide * 0.1)
	var sum := 0.0
	var has := []
	has.resize(n)
	has.fill(false)
	for j in count:
		has[bag_place(j, n)] = true
	if only != null:
		for j in only:
			has[j] = true
	A(1); dome(cx, cy, r)
	for j in [-1, 0, 1]:
		var mid: float = PI / 2 + j * wide * 0.3
		var cov := 0.0
		for m in n:
			if not has[m]:
				continue
			var lo := maxf(mid - half, PI - (m + 1) * PI / n)
			var hi := minf(mid + half, PI - m * PI / n)
			if hi > lo:
				cov += (hi - lo) / (2 * half)
		cov = cl(cov)
		sum += cov / 3
		if cov < 1:                                                   # daylight comes in
			A(0.2 * (1 - cov)); pen(AMB, 0, 0)
			shape([cx + cos(mid + half) * r, cy - sin(mid + half) * r, cx + cos(mid - half) * r, cy - sin(mid - half) * r, cx + cos(mid - half) * r + 10, cy - 2, cx + cos(mid + half) * r - 10, cy - 2], true); g.fill()
		A(1); pen(INK if cov < 1 else GREY, 7, 12 if cov < 1 else 0); g.begin(); g.arc(cx, cy, r - 1, -(mid + half), -(mid - half)); g.stroke()
	for j in n:
		var m := bag_place(j, n)
		A(1)
		if only == null:
			bag(cx, cy, r, n, m, CY if j < d.free else AMB, j >= count)
		elif has[j]:
			bag(cx, cy, r, n, j, AMB)
	return sum


## A dashed sunbeam that runs along its own line.
func _beam(t: float, x1: float, y1: float, x2: float, y2: float) -> void:
	dash(12, 10); g.dash_offset = 0.0 if still else -t * 40; line(x1, y1, x2, y2); dash(); g.dash_offset = 0


func _draw_shade(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		ground(332)
		A(1); sun(84, 76, 36, t)
		_skydome({ "slots": 16, "free": 8, "bags": 0, "loss": 0 }, 390, 332, 120, 0, [4, 5, 6, 7])      # this step always shows the same simple dome
		for i in 4:                                                   # light and radiation both stop in the soil
			var a := PI - (4.5 + i) * PI / 16
			var x := 390 + cos(a) * 140
			var y := 332 - sin(a) * 140
			var u := fmod(lap(t, 2.4, 0.5) + i * 0.27, 1.0)
			if i % 2:
				A(1)
				if fly(x, y, 0.75, 0.66, 260, u / 0.6, BAD, 3):
					A(1 - (u - 0.6) / 0.4); spark(x, y, 13, BAD)
			else:
				A(0.9); pen(AMB, 3, 12); _beam(t, x - 0.75 * 250, y - 0.66 * 250, x, y)
				A(0.6 + 0.4 * sway(t, 4, i)); spark(x, y, 11, AMB)
		var a2 := PI / 2 - 0.47                                      # but a bare skylight lets the light in
		var x2 := 390 + cos(a2) * 120
		var y2 := 332 - sin(a2) * 120
		A(0.9); pen(AMB, 3, 12); _beam(t, x2 - 0.75 * 250, y2 - 0.66 * 250, x2 + 0.75 * 56, y2 + 0.66 * 56)
	elif s == 1:
		ground(336)
		A(1); sun(84, 70, 34, t)
		var n: int = d.slots
		var k := n if still else floori(ph(t, 0.7, 0.42 * n) * n + 0.001)      # bags go on one by one
		_skydome(d, 360, 336, 124, k)
		A(1); txt(str(k) + (" bag" if k == 1 else " bags"), 596, 70, 30, AMB if k > d.free else CY)
	elif s == 2:
		ground(330, 30, 500)
		A(1); sun(70, 62, 30, t)
		var dark := _skydome(d, 280, 330, 122, d.bags)
		# the lamp inside: on when the skylights are covered
		A(1); pen(AMB if dark > 0 else GREY, 3, 16 if dark > 0 else 0); line(280, 212, 280, 232); ring(280, 244, 12)
		if dark > 0:
			wash(0.6)
			for i in 7:
				var a := 0.2 + i * 0.46
				A(0.5 + 0.3 * sway(t, 3, i)); line(280 + cos(a) * 20, 244 + sin(a) * 20, 280 + cos(a) * 32, 244 + sin(a) * 32)
		A(0.95); astro(280, 328, 0.8, INK)
		# the solar power, and the slice the lamps take
		var y := maxf(7, 224 * d.loss) if d.loss > 0 else 0.0
		A(1); pen(AMB, 3.5, 10); rr(566, 84, 64, 224, 14); hide(); g.stroke()
		g.save(); rr(566, 84, 64, 224, 14); g.clip(); A(0.75); pen(AMB, 0, 0); g.fill_rect(566, 84 + y, 64, 224 - y); g.restore()
		if y > 0:
			A(1); pen(AMB, 2.5, 6); line(552, 84 + y, 644, 84 + y)
		if dark > 0 and d.loss > 0:
			var wire := [566, 150, 470, 150, 470, 200, 300, 200, 292, 232]
			A(0.7); pen(AMB, 2.5, 6); dash(6, 7); path(wire); dash()
			for i in 3:
				var q := along(wire, fmod(lap(t, 2.4, 0.4) + i / 3.0, 1.0)); A(1); pen(AMB, 2, 12); dot(q.x, q.y, 5)
		A(1); txt("solar power", 598, 56, 20, AMB); txt("−" + _s(roundf(d.loss * 1000) / 10.0) + "%", 598, 340, 30, AMB)
	else:
		var a := 0.0 if still else sin(t * 0.9) * 0.13                # the scales tip one way, then the other
		A(1); pen(CY, 4); line(360, 136, 360, 322); path([300, 322, 420, 322]); dot(360, 136, 7)
		var x := 190 * cos(a)
		var y := 190 * sin(a)
		line(360 - x, 136 + y, 360 + x, 136 - y)
		for k in [-1, 1]:
			var p: float = 360 + k * x
			var q: float = 136 - k * y                                      # the end of the beam on this side
			A(0.8); pen(CY, 2.5, 6); line(p, q, p - 62, q + 104); line(p, q, p + 62, q + 104)
			A(1); pen(CY, 4); line(p - 70, q + 104, p + 70, q + 104)
			if k < 0:
				pen(CY, 2.5, 8)
				box(p - 46, q + 82, 44, 20, 6); wash(0.4); box(p + 2, q + 82, 44, 20, 6); wash(0.4); box(p - 22, q + 60, 44, 20, 6); wash(0.4)
				txt("shield", p, q + 132, 24, CY)
			else:
				cell(p, q + 68, 40, 60, 1); zap_bg(p, q + 68, 16)
				txt("power", p, q + 132, 24, AMB)
		A(1); txt("?", 360, 78 + sway(t, 2) * 3, 50, INK)


# ---------- 14. the long dark ----------
const NIGHT := Color("#020611")


## The crater rim with the outpost and its solar panel on top, and the dark crater behind it.
func _rim() -> void:
	A(0.6); pen(NIGHT, 0, 0); shape([440, 232, 500, 292, 566, 340, 720, 354, 720, 405, 440, 405], true); g.fill()
	A(0.9); pen(CY, 3, 6); path([0, 318, 150, 306, 280, 262, 340, 232, 440, 232, 500, 292, 566, 340, 720, 354])
	A(1); dome(396, 232, 32)
	pen(CY, 3); line(326, 236, 326, 206)
	g.save(); g.translate(326, 198); g.rotate(1.25); box(-22, -5, 44, 10, 3); hide(); g.stroke(); wash(0.35); g.restore()


## Sunbeams from the Sun at (sx, 240) to the solar panel.
func _beams(t: float, sx: float, k: float) -> void:
	for j in 3:
		A(k); pen(AMB, 3, 10); _beam(t, sx + 52, 230 - j * 11, 310, 210 - j * 10)


func _draw_longdark(_d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		A(0.75); txt("seen from above", 100, 26, 18, INK)
		A(1); pen(AMB, 4, 18); ring(-46, 205, 96); wash(0.2)          # the Sun, far away to the left
		for i in 5:
			A(0.7); pen(AMB, 3, 10); _beam(t, 70, 125 + i * 40, 230, 125 + i * 40)
		g.save(); g.begin(); g.arc(390, 205, 124, 0, TAU); g.clip()  # the Moon: one half in sunlight, one half in the dark
		A(0.2); pen(AMB, 0, 0); g.fill_rect(260, 75, 130, 260)
		A(0.85); pen(NIGHT, 0, 0); g.fill_rect(390, 75, 130, 260)
		g.restore()
		A(1); pen(INK, 3.5, 10); ring(390, 205, 124)
		A(0.5); pen(INK, 2, 0); dash(4, 8); line(390, 84, 390, 326); dash()
		A(1); txt("day", 326, 182, 26, AMB); txt("2 weeks", 326, 216, 20, AMB)
		txt("night", 454, 168, 26, CY); txt("2 weeks", 454, 202, 20, CY); txt("−130°C", 454, 238, 22, CY)
		# one place on the Moon, carried from day into night as the Moon slowly turns
		var a := PI + lap(t, 12, 0.1) * TAU
		var x := 390 + cos(a) * 124
		var y := 205 + sin(a) * 124
		A(1); pen(AMB if cos(a) < 0 else CY, 3, 12); ring(x, y, 10); hide(); g.stroke(); wash(0.6)
	elif s == 1:
		stars(18, 61)
		var x := 150 + sway(t, 0.45) * 56                             # the Sun slides to and fro, low over the horizon
		A(0.45); pen(AMB, 2, 0); dash(3, 9); line(40, 240, 330, 240); dash()
		A(1); sun(x, 240, 28, t)
		_beams(t, x, 0.75)
		_rim()
		A(1); txt("south pole", 396, 170, 22, INK)
		A(0.7); txt("crater", 610, 384, 20, CY)
	elif s == 2:
		stars(18, 61)
		var p := ez(ph(t, 0.8, 3.2))                                  # the Sun slips behind the mountain
		A(1 - ph(p, 0.7, 0.3)); sun(mix(96, 236, p), 240, 28, t)
		if p < 0.5:
			_beams(t, mix(96, 236, p), 0.75 * (1 - p * 2))
		A(1); pen(BG, 0, 0); shape([150, 306, 236, 126, 322, 242, 280, 262], true); g.fill()
		pen(CY, 3, 6); path([150, 306, 236, 126, 322, 242])
		A(0.4 * p); pen(NIGHT, 0, 0); g.fill_rect(0, 0, W, HT)       # everything goes dim
		_rim()
		A(1); cell(628, 118, 52, 90, mix(1, 0.06, p), BAD if p > 0.7 else AMB); txt("power", 628, 192, 20, BAD if p > 0.7 else AMB)
	else:
		stars(26, 77)
		A(1); pen(CY, 3.5); box(86, 122, 272, 150, 16); wash(0.06)   # the rack: four cells put aside the day before
		for i in 4:
			A(1); cell(132 + i * 60, 202, 42, 86, ez(ph(t, 0.4 + i * 0.5, 0.7)))
		A(1); txt("rack", 222, 302, 22, CY)
		A(0.9); pen(AMB, 3.5, 10); arrow(376, 204, 456, 236, 13)      # they go to what keeps the crew alive
		ground(326, 440, 700); A(1); dome(574, 326, 90); astro(574, 324, 0.9, INK)
		var u := 1 + 0.1 * sway(t, 4)                                 # a beating heart, and air to breathe
		pen(AMB, 3, 12); g.begin(); g.move_to(628, 280 + 14 * u)
		g.bezier_curve_to(628 - 26 * u, 280 - 4 * u, 628 - 12 * u, 280 - 24 * u, 628, 280 - 9 * u)
		g.bezier_curve_to(628 + 12 * u, 280 - 24 * u, 628 + 26 * u, 280 - 4 * u, 628, 280 + 14 * u); g.stroke(); wash(0.4)
		pen(CY, 2.5, 10); ring(520, 280, 17); txt("O₂", 520, 281, 16, CY)


# ---------- 15. why batteries hate being empty ----------
## The battery cut open: a case with seven thin layers inside. bad(k) = how cracked layer k is (0 to 1).
func _battery_body(bad: Callable) -> void:
	A(1); pen(CY, 3.5); box(150, 92, 400, 196, 24); wash(0.05); pen(CY, 0, 8); slab(550, 154, 16, 72, 5)
	for k in 7:
		var px := 190.0 + k * 53
		var c := cl(float(bad.call(k))) if bad.is_valid() else 0.0
		A(0.85); pen(INK if k % 2 else CY, 2.5, 6); box(px, 114, 12, 152, 5); wash(0.4)
		if c > 0:
			A(c); pen(BAD, 3, 10); path([px + 2, 120, px + 10, 146, px + 2, 170, px + 10, 196, px + 2, 222, px + 10, 248, px + 4, 262])
	A(1); txt("−", 120, 190, 32, INK); txt("+", 598, 190, 30, INK)


## Energy moving between the layers: more dots when there is more charge.
func _energy(t: float, full: float) -> void:
	var n := roundi(full * 3)
	for k in 6:
		for m in n:
			var f := fmod(lap(t, 1.8, 0.5) + m / 3.0 + k * 0.19, 1.0)
			A(sin(f * PI)); pen(AMB, 0, 10); dot(mix(208, 237, f) + k * 53, 140 + m * 50, 5)


func _draw_battery(d: Dictionary, s: int, t: float) -> void:
	if s == 0:
		_battery_body(Callable()); _energy(t, 1)
	elif s == 1:
		var p := ez(ph(t, 0.7, 3.2))
		var u := ph(t, 4, 0.6)                                        # the charge runs out, then a layer cracks
		_battery_body(func(k): return u if k == 3 else 0.0)
		_energy(t, 1 - p)
		if u > 0 and u < 1:
			A(sin(u * PI)); spark(355, 190, 46, BAD)
		A(1); pen(INK, 3, 4); rr(150, 318, 400, 28, 14); hide(); g.stroke()      # the charge gauge
		if p < 1:
			g.save(); rr(150, 318, 400, 28, 14); g.clip(); A(0.9); pen(BAD if p > 0.85 else AMB, 0, 0); g.fill_rect(150, 318, 400 * (1 - p), 28); g.restore()
		A(1); txt(str(roundi(100 * (1 - p))) + "%", 606, 333, 26, BAD if p > 0.85 else AMB)
	else:
		var lim: float = 156 + 388 * d.cap                            # how far it can still fill
		var lvl := 1.0 if still else 0.6 + 0.4 * cos(t * 0.9)         # charging and using, but never down to empty
		_battery_body(func(k): return 1.0 if 196 + k * 53 > lim else 0.0)
		g.save(); rr(150, 92, 400, 196, 24); g.clip()
		A(0.32); pen(AMB, 0, 0); g.fill_rect(150, 92, (lim - 150) * lvl, 196)
		if d.cap < 0.995:
			A(0.22); pen(BAD, 0, 0); g.fill_rect(lim, 92, 550 - lim, 196)      # the part that is gone for good
		g.restore()
		A(1); pen(AMB, 3.5, 10); line(lim, 80, lim, 300); txt(str(pct(d.cap)) + "%", minf(lim, 560), 52, 34, AMB)
		if d.cap < 0.9:
			A(0.7); pen(INK, 2, 0); dash(5, 6); line(544, 80, 544, 300); dash(); txt("new", 544, 322, 20, INK)
		var x := 150 + (lim - 150) * 0.2                              # always keep this much
		A(0.9); pen(CY, 2.5, 6); dash(5, 6); line(x, 96, x, 300); dash(); txt("reserve", x, 322, 20, CY)


# =====================================================================
#  THE PANEL (built once, the first time a hologram opens)
#  A dim cover over the game, and on it a glass panel: the icon and title, the moving picture with the wrist
#  tablet projecting it from the corner, the sentence for this step, and the buttons.
# =====================================================================
var layer: CanvasLayer
var root: Control
var panel: PanelContainer
var col: VBoxContainer
var view: Control
var stage: Panel
var canvas: Control
var frame: Panel
var tab: Control
var icon_l: Label
var title_l: Label
var cap_l: Label
var src_l: Label
var dots: Control
var prev_b: Button
var next_b: Button
var replay_b: Button
var close_b: Button
var _dot_sb := {}
var cur = null              # what is on show: { id, sc, d, caps, step, on_close, back }
var step_at := 0.0
var last_t := 0.0
var frozen := false
var opened_at := -10.0
var S := 1.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_process(false)
	_ensure()


func _ensure() -> void:
	if g == null:
		g = Pen.new()
	if SC.is_empty():
		_register()


static func _now() -> float:
	return Time.get_ticks_usec() / 1e6


static func _val(v, d):
	return v.call(d) if v is Callable else v


static func _sb(bg: Color, radius: float, border := Color(0, 0, 0, 0), bw := 0, pad := Vector4.ZERO) -> StyleBoxFlat:
	return Style.box(bg, radius, border, bw, pad)


## A round glass button of the panel: cyan rim, a dark lip underneath.
func _btn(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.custom_minimum_size = Vector2(48, 48)
	b.add_theme_font_override("font", Style.font(600))
	b.add_theme_font_size_override("font_size", 16)
	var n := Style.shadowed(_sb(Color(CY, 0.1), 999, Color(CY, 0.45), 2, Vector4(18, 0, 18, 0)), Color(0, 0, 0, 0.35), 0, Vector2(0, 4))
	var h: StyleBoxFlat = n.duplicate()
	h.bg_color = Color(CY, 0.2)
	var p: StyleBoxFlat = h.duplicate()
	p.shadow_offset = Vector2(0, 1)
	var f: StyleBoxFlat = n.duplicate()
	f.bg_color = Color(0, 0, 0, 0)
	f.border_color = Color.WHITE
	f.set_border_width_all(3)
	f.shadow_size = 0
	var dis: StyleBoxFlat = n.duplicate()
	dis.bg_color = Color(CY, 0.035)
	dis.border_color = Color(CY, 0.16)
	for k in [["normal", n], ["hover", h], ["pressed", p], ["hover_pressed", p], ["focus", f], ["disabled", dis]]:
		b.add_theme_stylebox_override(k[0], k[1])
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(k, INK)
	b.add_theme_color_override("font_disabled_color", Color(INK, 0.35))
	return b


func _build() -> void:
	layer = CanvasLayer.new()
	layer.name = "HoloLayer"
	layer.layer = 30                                # over the HUD and the cards (Ui is layer 10)
	add_child(layer)
	root = Control.new()
	root.name = "Holo"
	root.theme = Style.theme()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.visible = false
	layer.add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(3 / 255.0, 7 / 255.0, 18 / 255.0, 0.76)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	root.add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(center)

	panel = PanelContainer.new()
	var psb := _sb(Color(9 / 255.0, 26 / 255.0, 48 / 255.0, 0.95), 24, Color(CY, 0.5), 2, Vector4(18, 14, 18, 12))
	psb.shadow_color = Color(CY, 0.16)
	psb.shadow_size = 36
	panel.add_theme_stylebox_override("panel", psb)
	center.add_child(panel)
	col = VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	panel.add_child(col)

	# the head: icon, kicker and title, and the close button
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	col.add_child(head)
	var ib := PanelContainer.new()
	ib.custom_minimum_size = Vector2(46, 46)
	ib.add_theme_stylebox_override("panel", _sb(Color(CY, 0.1), 14, Color(CY, 0.35), 2))
	head.add_child(ib)
	icon_l = Label.new()
	icon_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	icon_l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	icon_l.add_theme_font_size_override("font_size", 26)
	ib.add_child(icon_l)
	var names := VBoxContainer.new()
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	names.alignment = BoxContainer.ALIGNMENT_CENTER
	names.add_theme_constant_override("separation", 0)
	head.add_child(names)
	var kicker := Label.new()
	kicker.text = "HOLO-TABLET"
	var kf := FontVariation.new()
	kf.base_font = Style.font(700)
	kf.spacing_glyph = 2
	kicker.add_theme_font_override("font", kf)
	kicker.add_theme_font_size_override("font_size", 12)
	kicker.add_theme_color_override("font_color", CY)
	names.add_child(kicker)
	title_l = Label.new()
	title_l.add_theme_font_override("font", Style.font(700, "exo2"))
	title_l.add_theme_font_size_override("font_size", 24)
	title_l.add_theme_color_override("font_color", Color("#f5fbff"))
	title_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	names.add_child(title_l)
	close_b = Button.new()
	close_b.text = "✕"
	close_b.tooltip_text = "Close the hologram"
	close_b.custom_minimum_size = Vector2(44, 44)
	close_b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close_b.add_theme_font_size_override("font_size", 18)
	var cn := _sb(Color(CY, 0.1), 999, Color(CY, 0.4), 2)
	var ch := _sb(Color(CY, 0.2), 999, Color(CY, 0.4), 2)
	var cf := _sb(Color(0, 0, 0, 0), 999, Color.WHITE, 3)
	for k in [["normal", cn], ["hover", ch], ["pressed", ch], ["hover_pressed", ch], ["focus", cf]]:
		close_b.add_theme_stylebox_override(k[0], k[1])
	head.add_child(close_b)

	# the picture: a rounded glass stage that clips the drawing, its frame, and the wrist tablet in the corner
	view = Control.new()
	view.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.add_child(view)
	stage = Panel.new()
	stage.add_theme_stylebox_override("panel", _sb(BG, 16))
	stage.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	view.add_child(stage)
	canvas = Control.new()
	canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.draw.connect(_paint)
	stage.add_child(canvas)
	frame = Panel.new()
	var fsb := _sb(Color(0, 0, 0, 0), 16, Color(CY, 0.45), 2)
	fsb.shadow_color = Color(CY, 0.14)
	fsb.shadow_size = 22
	frame.add_theme_stylebox_override("panel", fsb)
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	view.add_child(frame)
	tab = Control.new()
	tab.size = Vector2(46, 44)
	tab.pivot_offset = Vector2(0, 44)
	tab.rotation = deg_to_rad(-8)
	tab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tab.draw.connect(_paint_tab)
	view.add_child(tab)

	# the sentence
	cap_l = Label.new()
	cap_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	cap_l.add_theme_font_size_override("font_size", 18)
	cap_l.add_theme_color_override("font_color", Color("#f2f8ff"))
	cap_l.add_theme_constant_override("line_spacing", 3)
	col.add_child(cap_l)

	# the buttons and the step dots
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 10)
	col.add_child(foot)
	prev_b = _btn("◀", "Previous step")
	foot.add_child(prev_b)
	dots = Control.new()
	dots.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dots.custom_minimum_size = Vector2(60, 48)
	dots.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dots.draw.connect(_paint_dots)
	foot.add_child(dots)
	replay_b = _btn("↻ Replay", "Replay this step")
	foot.add_child(replay_b)
	next_b = Button.new()
	next_b.theme_type_variation = "BtnPrimary"
	next_b.custom_minimum_size = Vector2(128, 48)
	next_b.add_theme_font_size_override("font_size", 16)
	foot.add_child(next_b)
	src_l = Label.new()
	src_l.add_theme_font_size_override("font_size", 12)
	src_l.add_theme_color_override("font_color", Color("#a9bbdc"))
	col.add_child(src_l)

	_dot_sb = {
		"done": _sb(CY, 5),
		"now": Style.shadowed(_sb(AMB, 5), Color(AMB, 0.6), 6, Vector2.ZERO),
	}
	close_b.pressed.connect(close)
	prev_b.pressed.connect(func(): _go(-1))
	next_b.pressed.connect(func(): _go(1))
	replay_b.pressed.connect(func():
		if cur != null:
			Au.play("tap")
			Au.speak(cur.caps[cur.step])
			_play())
	get_viewport().size_changed.connect(func():
		if root and root.visible:
			_layout())


## The picture is 16:9 and as wide as fits: at most 720, and no taller than about half the screen.
func _layout() -> void:
	var vp := root.get_viewport_rect().size
	var inner := minf(764.0, vp.x - 16) - 36
	var sw := maxf(240.0, minf(minf(720.0, inner), vp.y * 0.52 * 16 / 9))
	var sh := sw * HT / W
	S = sw / W
	col.custom_minimum_size.x = maxf(sw, inner)
	view.custom_minimum_size = Vector2(sw, sh + 12)
	for c in [stage, canvas, frame]:
		c.position = Vector2.ZERO
		c.size = Vector2(sw, sh)
	tab.position = Vector2(-8, sh + 12 - 44)
	cap_l.custom_minimum_size = Vector2(maxf(sw, inner), 52)
	title_l.custom_minimum_size.x = maxf(sw, inner) - 46 - 44 - 24
	panel.pivot_offset = panel.size / 2


func _process(_dt: float) -> void:
	if cur == null:
		set_process(false)
		return
	# it switches on like a projector: the panel pops up, the picture flickers on
	var k := _now() - opened_at
	var pop := ez(cl(k / 0.3))
	panel.modulate.a = pop
	panel.pivot_offset = panel.size / 2
	panel.scale = Vector2.ONE * mix(0.95, 1, pop)
	stage.modulate.a = _flicker(k / 0.75)
	if not frozen:
		canvas.queue_redraw()
	tab.queue_redraw()


static func _flicker(p: float) -> float:
	var keys := [[0.0, 0.0], [0.12, 0.85], [0.18, 0.3], [0.28, 1.0], [0.36, 0.6], [0.46, 1.0]]
	if p >= 0.46:
		return 1.0
	for i in range(1, keys.size()):
		if p < keys[i][0]:
			return mix(keys[i - 1][1], keys[i][1], (p - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]))
	return 1.0


## Draw the step on show, then the thin scan lines, the slow bright band drifting down, and the dark edge.
func _paint() -> void:
	if cur == null:
		return
	var t := last_t if frozen else _now() - step_at
	last_t = t
	g.ci = canvas
	g.font = Style.font(700, "exo2")
	fade = 1.0
	backdrop(t, S)
	fade = 1.0 if still else ph(t, 0, 0.35)
	g.save()
	(cur.sc.draw as Callable).call(cur.d, cur.step, t)
	g.restore()
	var w := canvas.size.x
	var h := canvas.size.y
	var y := 0.0
	while y < h:
		canvas.draw_line(Vector2(0, y + 0.5), Vector2(w, y + 0.5), Color(CY, 0.05), 1)
		y += 4
	var bh := h * 0.26
	var top := (h - bh) * mix(-0.4, 1.4, fmod((_now() if not frozen else 2.0) / 7.0, 1.0))
	var c0 := Color(CY, 0)
	var c1 := Color(CY, 0.07)
	canvas.draw_polygon(PackedVector2Array([Vector2(0, top), Vector2(w, top), Vector2(w, top + bh / 2), Vector2(0, top + bh / 2)]), PackedColorArray([c0, c0, c1, c1]))
	canvas.draw_polygon(PackedVector2Array([Vector2(0, top + bh / 2), Vector2(w, top + bh / 2), Vector2(w, top + bh), Vector2(0, top + bh)]), PackedColorArray([c1, c1, c0, c0]))
	for i in 8:
		var e := i * 3.0
		canvas.draw_rect(Rect2(e, e, w - 2 * e, h - 2 * e), Color(3 / 255.0, 8 / 255.0, 20 / 255.0, 0.22 * (1 - i / 8.0)), false, 3)


## The wrist tablet the beam comes out of: a strap, a small dark screen, and on the screen a light and a short line.
func _paint_tab() -> void:
	var dark := Color("#071226")
	var strap := _sb(Color("#4d5a86"), 7, dark, 2)
	tab.draw_style_box(strap, Rect2(11, 0, 24, 44))
	var screen := _sb(Color("#0c1a33"), 9, Color("#eaf3ff"), 3)
	screen.shadow_color = Color(CY, 0.65)
	screen.shadow_size = 12
	tab.draw_style_box(screen, Rect2(0, 7, 46, 30))
	var k := _now()
	var a1 := 0.7 + 0.3 * cos(k / 2.4 * TAU)
	var a2 := 0.7 + 0.3 * cos((k + 1.2) / 2.4 * TAU)
	tab.draw_circle(Vector2(13.5, 22), 7, Color(CY, 0.25 * a1))
	tab.draw_circle(Vector2(13.5, 22), 3.5, Color(CY, a1))
	tab.draw_style_box(_sb(Color(CY, a2), 2), Rect2(22, 20, 14, 4))


## One dot per step: filled for the steps seen, a long amber one for this step.
func _paint_dots() -> void:
	if cur == null:
		return
	var n: int = cur.caps.size()
	var total := 8.0 * (n - 1)
	for k in n:
		total += 26.0 if k == cur.step else 10.0
	var x := (dots.size.x - total) / 2
	var y := dots.size.y / 2 - 5
	for k in n:
		var w := 26.0 if k == cur.step else 10.0
		if k < cur.step or k == cur.step:
			dots.draw_style_box(_dot_sb["now" if k == cur.step else "done"], Rect2(x, y, w, 10))
		else:
			dots.draw_circle(Vector2(x + 5, y + 5), 5, Color(CY, 0.16), true, -1, true)
			dots.draw_circle(Vector2(x + 5, y + 5), 4.4, Color(CY, 0.6), false, 1.3, true)
		x += w + 8


# ---------- showing a step ----------
## Start (or restart) the moving picture for the step on show.
func _play() -> void:
	if cur == null:
		return
	frozen = false
	still = false
	step_at = _now()
	canvas.queue_redraw()


## Put step i on show: its sentence, the dots and the buttons.
func _show(i: int, quiet := false) -> void:
	var n: int = cur.caps.size()
	cur.step = i
	cap_l.text = cur.caps[i]
	dots.queue_redraw()
	next_b.text = "Got it ✓" if i == n - 1 else "Next ▶"
	if i == 0 and prev_b.has_focus():
		next_b.grab_focus()
	prev_b.disabled = i == 0
	prev_b.focus_mode = Control.FOCUS_NONE if i == 0 else Control.FOCUS_ALL
	if not quiet:
		Au.speak(cur.caps[i])


func _go(by: int) -> void:
	if cur == null:
		return
	var i: int = cur.step + by
	if i >= cur.caps.size():
		close()
		return
	if i < 0:
		return
	Au.play("tap")
	_show(i)
	_play()


## Fill the panel with one scene. quiet = no sound and no voice (the test hook uses it).
func _mount(id: String, data, opts, quiet: bool) -> void:
	_ensure()
	var sc: Dictionary = SC[id]
	var d: Dictionary = sc.fix.call(data if data is Dictionary else {})
	var src = Data.SOURCES.get(str(_val(sc.src, d)))
	if root == null:
		_build()
	if cur == null:
		var oc = opts.get("onClose") if opts is Dictionary else null
		cur = { "back": get_viewport().gui_get_focus_owner(), "on_close": oc if oc is Callable else Callable() }
	cur.id = id
	cur.sc = sc
	cur.d = d
	cur.caps = sc.steps.call(d)
	cur.step = 0
	icon_l.text = sc.icon
	title_l.text = str(_val(sc.title, d))
	src_l.text = "Source: " + str(src.name) if src is Dictionary and src.get("name", "") != "" else ""
	if not root.visible:
		root.visible = true
		opened_at = _now()
		panel.modulate.a = 0
		stage.modulate.a = 0
		_layout()
	set_process(true)
	if not quiet:
		Au.play("page")


# ---------- keys and the game controller ----------
## The keys are caught before the game sees them, so the astronaut does not jump when you press Space.
func _input(e: InputEvent) -> void:
	if cur == null:
		return
	var act := ""
	if e is InputEventKey:
		if not e.pressed or e.ctrl_pressed or e.alt_pressed or e.meta_pressed:
			return
		match e.physical_keycode:
			KEY_TAB:
				get_viewport().set_input_as_handled()
				_trap(e.shift_pressed)
				return
			KEY_RIGHT, KEY_E:
				act = "next"
			KEY_SPACE, KEY_ENTER, KEY_KP_ENTER:
				act = "press"
			KEY_LEFT:
				act = "prev"
			KEY_ESCAPE, KEY_T:
				act = "close"
		if act == "":
			return
		get_viewport().set_input_as_handled()
		if e.echo:
			return                                  # a key held down counts once
	elif e is InputEventJoypadButton:
		if not e.pressed:
			return
		match e.button_index:
			JOY_BUTTON_A:
				act = "press"
			JOY_BUTTON_B, JOY_BUTTON_BACK:
				act = "close"
			JOY_BUTTON_DPAD_RIGHT, JOY_BUTTON_RIGHT_SHOULDER:
				act = "next"
			JOY_BUTTON_DPAD_LEFT, JOY_BUTTON_LEFT_SHOULDER:
				act = "prev"
			JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN:
				get_viewport().set_input_as_handled()
				_trap(e.button_index == JOY_BUTTON_DPAD_UP)
				return
		if act == "":
			return
		get_viewport().set_input_as_handled()
	else:
		return
	if act == "prev":
		_go(-1)
	elif act == "close":
		close()
	elif act == "press" and _own_button():
		_own_button().pressed.emit()                # Space, Enter or A presses the button you are on
	else:
		_go(1)


func _own_button() -> Button:
	var a := get_viewport().gui_get_focus_owner()
	for b in [close_b, prev_b, replay_b, next_b]:
		if a == b and not b.disabled:
			return b
	return null


## Tab walks round our four buttons and never leaves the panel.
func _trap(back: bool) -> void:
	var f := []
	for b in [close_b, prev_b, replay_b, next_b]:
		if not b.disabled:
			f.append(b)
	var i := f.find(get_viewport().gui_get_focus_owner())
	if i < 0:
		next_b.grab_focus()
	else:
		f[(i + (f.size() - 1 if back else 1)) % f.size()].grab_focus()


# =====================================================================
#  WHAT THE GAME CAN CALL
# =====================================================================
## Every scene: { id: { title, icon, src } }
func scenes() -> Dictionary:
	_ensure()
	var out := {}
	for id in SC:
		var d: Dictionary = SC[id].fix.call({})
		out[id] = { "title": _val(SC[id].title, d), "icon": SC[id].icon, "src": _val(SC[id].src, d) }
	return out


func has(id) -> bool:
	_ensure()
	return id is String and SC.has(id)


func is_open() -> bool:
	return cur != null


## The title, icon, source and sentences of a scene for these numbers (some change with the place: Moon or Mars).
func info(id, data = {}):
	if not has(id):
		return null
	var d: Dictionary = SC[id].fix.call(data if data is Dictionary else {})
	return { "title": _val(SC[id].title, d), "icon": SC[id].icon, "src": _val(SC[id].src, d), "steps": SC[id].steps.call(d) }


## Show a scene. data = the live numbers (all optional). opts = { onClose = Callable }. Returns true if it opened.
func open(id, data = {}, opts = {}) -> bool:
	if not has(id):
		return false
	if cur != null:
		close()
	_mount(id, data, opts, false)
	_show(0)
	_play()
	next_b.grab_focus()
	return true


func close() -> void:
	if cur == null:
		return
	var was: Dictionary = cur
	cur = null
	frozen = false
	root.visible = false
	set_process(false)
	Au.play("tap")
	var b = was.back
	if is_instance_valid(b) and b is Control and (b as Control).is_visible_in_tree():
		(b as Control).grab_focus()
	else:
		var f := get_viewport().gui_get_focus_owner()
		if f:
			f.release_focus()
	if (was.on_close as Callable).is_valid():
		(was.on_close as Callable).call()


## TEST HOOK: draw one step of a scene exactly t seconds in, with the clock stopped. Opens the panel if needed and
## returns the drawing surface, so a test can take a picture of it.
func draw(id, data = {}, step = 0, t = 99.0):
	if not has(id):
		return null
	_mount(id, data, null, true)
	frozen = true
	still = false
	opened_at = -10.0
	_show(clampi(roundi(float(step)), 0, cur.caps.size() - 1), true)
	last_t = float(t) if (t is float or t is int) and is_finite(float(t)) else 99.0
	canvas.queue_redraw()
	return canvas
