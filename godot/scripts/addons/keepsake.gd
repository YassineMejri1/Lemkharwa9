extends Node
## Keepsakes: a mission certificate and a photo postcard the player can keep (a port of js/keepsake.js).
## Both are drawn in an off-screen viewport and saved as PNG pictures on this computer (or handed to the browser
## as a download in a web build). Nothing is uploaded: the pictures and the name never leave this device.
## The certificate names NASA's DONKI database as the data source and never draws a NASA logo.

const CW := 1600          # certificate, A4 landscape
const CH := 1131
const PW := 1200          # postcard
const PH := 800
const INK := Color("#f5f7ff")
const MUTED := Color("#b3bde0")
const GOLD := Color("#ffd23f")
const AIR := Color("#4fd8ff")
const STORM := [Color("#b3bde0"), Color("#ffd23f"), Color("#ffa24d"), Color("#ff7f8e")]     # unknown · small · medium · big
const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
## rocks and craters near the horizon: [x, how far below the edge, half width]
const MARKS := [[150, 26, 34], [300, 12, 18], [470, 9, 12], [690, 10, 20], [905, 7, 11], [1120, 11, 22], [1290, 16, 16], [1450, 28, 30]]

var kept_name := ""                 # remembered only until the game is closed
var _cert_vp: SubViewport = null
var _cert_info := {}
var _cert_doc: Html.Doc = null


# ---------- small helpers ----------
static func _tidy(v, mx := 0) -> String:
	var t := "" if v == null else str(v)
	var out := ""
	for ch in t:
		out += " " if ch.unicode_at(0) < 32 or ch.unicode_at(0) == 127 else ch
	while out.contains("  "):
		out = out.replace("  ", " ")
	out = out.strip_edges()
	return out.substr(0, mx) if mx and out.length() > mx else out


static func _num(v) -> int:
	if v is int or v is float:
		return roundi(v)
	return int(v) if v is String and v.is_valid_float() else 0


static func _many(n: int, one: String, more: String) -> String:
	return str(n) + " " + (one if n == 1 else more)


static func _font(weight: int) -> Font:
	return Paint.font(weight, "lexend")


static func _today_text() -> String:
	var d := Time.get_date_dict_from_system()
	return str(d.day) + " " + MONTHS[d.month - 1] + " " + str(d.year)


## a tiny seeded random, so the stars sit in the same places every time a picture is redrawn
class Seeded:
	var s: int
	func _init(seed_value: int) -> void:
		s = seed_value & 0xffffffff
	func next() -> float:
		s = (s * 1664525 + 1013904223) & 0xffffffff
		return s / 4294967296.0


# ---------- text ----------
## One line of text on a baseline, made smaller until it fits in max_w (and cut with … if even the smallest size
## is too wide). Returns how wide it came out.
static func _put(c: CanvasItem, text: String, x: float, y: float, size: int, color: Color, weight := 500, max_w := 1380.0, mn := 0, align := "center") -> float:
	if text == "":
		return 0.0
	if mn <= 0:
		mn = mini(size, 14)
	var f := _font(weight)
	var w := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	if w > max_w:
		size = maxi(mn, int(floor(size * max_w / w)))
		w = f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		while size > mn and w > max_w:
			size -= 1
			w = f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		if w > max_w:
			while text.length() > 1 and f.get_string_size(text + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > max_w:
				text = text.substr(0, text.length() - 1)
			text += "…"
			w = f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var px := x - w / 2 if align == "center" else (x - w if align == "right" else x)
	c.draw_string(f, Vector2(px, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
	return minf(w, max_w)


## One centred line built from pieces with their own colour, weight or size:
## parts = [{ t, c, w, k }]. Shrinks to fit max_w. A piece { dot: colour } is a round dot as tall as a small letter.
static func _runs(c: CanvasItem, parts: Array, cx: float, y: float, size: int, max_w: float, mn := 12) -> int:
	var s := size
	var width := func() -> float:
		var sum := 0.0
		for p in parts:
			if p.has("dot"):
				p.px = float(s)
			else:
				p.px = _font(p.get("w", 500)).get_string_size(p.t, HORIZONTAL_ALIGNMENT_LEFT, -1, roundi(s * p.get("k", 1.0))).x
			sum += p.px
		return sum
	var w: float = width.call()
	if w > max_w:
		s = maxi(mn, int(floor(s * max_w / w)))
		w = width.call()
		while s > mn and w > max_w:
			s -= 1
			w = width.call()
	var squeeze := max_w / w if w > max_w else 1.0      # still too wide at the smallest size: press it together sideways
	c.draw_set_transform(Vector2(cx, y), 0, Vector2(squeeze, 1))
	var x := -w / 2
	for p in parts:
		if p.has("dot"):
			Paint.circle(c, x + s * 0.3, -s * 0.33, s * 0.3, p.dot)
		else:
			c.draw_string(_font(p.get("w", 500)), Vector2(x, 0), p.t, HORIZONTAL_ALIGNMENT_LEFT, -1, roundi(s * p.get("k", 1.0)), p.get("c", INK))
		x += p.px
	c.draw_set_transform(Vector2.ZERO)
	return s


## capital letters with air between them; returns the width
static func _spaced(c: CanvasItem, text: String, cx: float, y: float, size: int, gap: float, color: Color) -> float:
	var f := _font(600)
	var ws := []
	var w := 0.0
	for i in text.length():
		ws.append(f.get_string_size(text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
		w += ws[i] + (gap if i else 0.0)
	var x := cx - w / 2
	for i in text.length():
		c.draw_string(f, Vector2(x, y), text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
		x += ws[i] + gap
	return w


## one emoji with its middle on (x, y)
static func _emoji(c: CanvasItem, icon: String, x: float, y: float, size: float, max_w := 0.0) -> void:
	var sz := roundi(size)
	var f := _font(500)
	var w := f.get_string_size(icon, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x
	if max_w > 0 and w > max_w:
		sz = maxi(8, int(floor(sz * max_w / w)))
		w = f.get_string_size(icon, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x
	c.draw_string(f, Vector2(x - w / 2, y + (f.get_ascent(sz) - f.get_descent(sz)) / 2), icon, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, Color.WHITE)


# ---------- shapes ----------
static func _glow(c: CanvasItem, x: float, y: float, r: float, rgb: Color, alpha: float) -> void:
	Paint.radial(c, x, y, r, [[0.0, Color(rgb, alpha)], [1.0, Color(rgb, 0)]])


## a little four-pointed twinkle
static func _sparkle(c: CanvasItem, x: float, y: float, r: float, color: Color) -> void:
	var pts := PackedVector2Array()
	var corners := [Vector2(0, -r), Vector2(r, 0), Vector2(0, r), Vector2(-r, 0)]
	for q in 4:
		var a: Vector2 = corners[q]
		var b: Vector2 = corners[(q + 1) % 4]
		for i in 6:
			var t := i / 6.0
			pts.append(Vector2(x, y) + a * (1 - t) * (1 - t) + b * t * t)      # a quadratic curve with its control point in the middle
	c.draw_colored_polygon(pts, color)


## a thin gold line that fades out at both ends
static func _rule(c: CanvasItem, cx: float, y: float, w: float, twinkle: bool) -> void:
	var g0 := Color(GOLD, 0)
	var g1 := Color(GOLD, 0.9)
	c.draw_polygon(PackedVector2Array([Vector2(cx - w / 2, y - 1), Vector2(cx, y - 1), Vector2(cx, y + 1), Vector2(cx - w / 2, y + 1)]), PackedColorArray([g0, g1, g1, g0]))
	c.draw_polygon(PackedVector2Array([Vector2(cx, y - 1), Vector2(cx + w / 2, y - 1), Vector2(cx + w / 2, y + 1), Vector2(cx, y + 1)]), PackedColorArray([g1, g0, g0, g1]))
	if twinkle:
		_sparkle(c, cx, y, 9, GOLD)


static func _stars(c: CanvasItem, x: float, y: float, w: float, h: float, n: int, seed_value: int) -> void:
	var r := Seeded.new(seed_value)
	for i in n:
		var px := x + r.next() * w
		var py := y + r.next() * h
		var tint := r.next()
		var a := 0.2 + r.next() * 0.5
		var col := Color("#ffe7ad") if tint < 0.14 else (Color("#bfe6ff") if tint < 0.3 else Color.WHITE)
		var rr := 0.6 + r.next() * r.next() * 1.6
		Paint.circle(c, px, py, rr, Color(col, a))
	for i in roundi(n / 30.0):
		var px := x + r.next() * w
		var py := y + r.next() * h
		var a := 0.25 + r.next() * 0.25
		_sparkle(c, px, py, 4 + r.next() * 4, Color(1, 1, 1, a))


## a band of a huge circle between radii r0 and r1, only where it shows on the page
static func _arc_band(c: CanvasItem, cx: float, cy: float, r0: float, r1: float, c0: Color, c1: Color, half_w: float) -> void:
	var a := asin(clampf(half_w / r1, -1, 1))
	var n := 96
	for i in n:
		var t0 := -a + 2 * a * i / n
		var t1 := -a + 2 * a * (i + 1) / n
		var d0 := Vector2(sin(t0), -cos(t0))
		var d1 := Vector2(sin(t1), -cos(t1))
		var o := Vector2(cx, cy)
		c.draw_polygon(PackedVector2Array([o + d0 * r0, o + d0 * r1, o + d1 * r1, o + d1 * r0]), PackedColorArray([c0, c1, c1, c0]))


# =====================================================================
#  CERTIFICATE
# =====================================================================
static func _backdrop(c: CanvasItem, mars: bool) -> void:
	c.draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(CW, 0), Vector2(CW, CH * 0.6), Vector2(0, CH * 0.6)]), PackedColorArray([Color("#050816"), Color("#050816"), Color("#0b1232"), Color("#0b1232")]))
	c.draw_polygon(PackedVector2Array([Vector2(0, CH * 0.6), Vector2(CW, CH * 0.6), Vector2(CW, CH), Vector2(0, CH)]), PackedColorArray([Color("#0b1232"), Color("#0b1232"), Color("#131d47"), Color("#131d47")]))
	_glow(c, 250, 210, 560, Color8(255, 150, 110) if mars else Color8(79, 216, 255), 0.1)
	_glow(c, 1390, 380, 600, Color8(176, 124, 255), 0.1)
	_stars(c, 0, 0, CW, 1060, 240, 4177 if mars else 1969)
	_horizon(c, mars)


## the world you lived on, seen from above: grey for the Moon, rust for Mars
static func _horizon(c: CanvasItem, mars: bool) -> void:
	var R := 6000.0
	var cx := CW / 2.0
	var cy := 1006.0 + R
	if mars:        # Mars has thin, dusty air that glows at the edge. The Moon has no air, so its edge stays sharp.
		_arc_band(c, cx, cy, R, R + 30, Color8(255, 160, 110, 102), Color8(255, 160, 110, 0), CW)
	var stops := [[0.0, "#12080b"], [0.7, "#3a1811"], [0.9, "#8f4326"], [0.97, "#dd8452"], [1.0, "#ffc59a"]] if mars else \
		[[0.0, "#0a0d19"], [0.7, "#1c2130"], [0.9, "#4c5364"], [0.97, "#a3aaba"], [1.0, "#e6e9f1"]]
	var r0 := R - 130
	_arc_band(c, cx, cy, 0, r0, Color(stops[0][1]), Color(stops[0][1]), CW)
	for i in stops.size() - 1:
		_arc_band(c, cx, cy, r0 + 130 * stops[i][0], r0 + 130 * stops[i + 1][0], Color(stops[i][1]), Color(stops[i + 1][1]), CW)
	for m in MARKS:
		var x: float = m[0]
		var y: float = cy - sqrt(R * R - (x - cx) * (x - cx)) + m[1]
		Paint.ellipse(c, x, y, m[2], m[2] * 0.2, Color8(40, 10, 4, 102) if mars else Color(0, 0, 0, 0.32))
		var pts := PackedVector2Array()
		for i in 13:
			var a := PI * (0.15 + 0.7 * i / 12.0)
			pts.append(Vector2(x + cos(a) * m[2], y + sin(a) * m[2] * 0.2))
		c.draw_polyline(pts, Color8(255, 200, 160, 64) if mars else Color(1, 1, 1, 0.25), 1.5, true)


static func _frame(c: CanvasItem) -> void:
	Paint.rrect(c, 26, 26, CW - 52, CH - 52, 24, GOLD, 5)
	Paint.rrect(c, 40, 40, CW - 80, CH - 80, 13, Color(GOLD, 0.6), 2)
	for p in [[68, 68], [CW - 68, 68], [68, CH - 68], [CW - 68, CH - 68]]:
		_sparkle(c, p[0], p[1], 10, GOLD)


static func _header(c: CanvasItem) -> void:
	var w := _spaced(c, "ASTRO OUTPOST", CW / 2.0, 88, 22, 7, AIR)
	_sparkle(c, CW / 2.0 - w / 2 - 26, 80, 8, AIR)
	_sparkle(c, CW / 2.0 + w / 2 + 26, 80, 8, AIR)
	_put(c, "Junior Astronaut Mission Certificate", CW / 2.0, 158, 68, GOLD, 700, 1400, 36)
	_rule(c, CW / 2.0, 182, 460, true)


## "This certifies that … kept a crew alive for N days on …" (178 px tall)
static func _certify(c: CanvasItem, info: Dictionary, y: float) -> void:
	var site: Dictionary = info.get("site", {})
	var name := _tidy(info.get("name"), 40)
	if name == "":
		name = "this astronaut"
	var level := _tidy(info.get("level"), 30)
	var place := _tidy(site.get("place"), 90)
	_put(c, "This certifies that", CW / 2.0, y + 24, 24, MUTED, 500)
	var w := _put(c, name, CW / 2.0, y + 80, 58, INK, 700, 1240, 28)
	_rule(c, CW / 2.0, y + 97, clampf(w + 160, 480, 1320), false)
	var dword := _tidy(info.get("dayWord"), 12)
	_runs(c, [{ "t": "led an outpost crew for " if info.get("won") == false else "kept a crew alive for " },
		{ "t": str(_num(info.get("days"))) + " " + (dword if dword else "days"), "c": GOLD, "w": 700 }, { "t": " on " },
		{ "t": _tidy(site.get("name"), 40) if site.get("name") else "another world", "c": GOLD, "w": 700 }], CW / 2.0, y + 136, 32, 1340, 16)
	if level:
		place = (place + "   ·   " if place else "") + level + " mission"
	_put(c, place, CW / 2.0, y + 170, 22, MUTED, 400, 1340, 14)


## the rank block grows or shrinks (s from 0.6 to 1.2) to use the room the badges and storms leave
static func _rank_layout(s: float) -> Dictionary:
	var L := { "r": 78 * s, "cy": 98 * s, "nameSize": maxi(38, roundi(66 * s)), "statSize": maxi(24, roundi(28 * s)) }
	L.nameY = roundi(196 * s) + 8 + roundi(L.nameSize * 0.74)
	L.statY = L.nameY + 14 + L.statSize
	L.h = L.statY + 8
	return L


## a gold seal with the rank's own emoji in the middle (a plain rosette: not anybody's logo)
static func _seal(c: CanvasItem, x: float, y: float, r: float, icon: String) -> void:
	_glow(c, x, y, r * 2.6, GOLD, 0.2)
	var pts := PackedVector2Array()
	for i in 48:
		var a := i * TAU / 48 - PI / 2
		var d := r * (1.1 if i % 2 else 1.22)
		pts.append(Vector2(x + cos(a) * d, y + sin(a) * d))
	c.draw_colored_polygon(pts, GOLD)
	Paint.circle(c, x, y, r * 0.97, Color("#c98d0d"))
	Paint.radial(c, x, y, r * 0.9, [[0.0, Color("#2b3d85")], [1.0, Color("#0f1736")]], 48)
	Paint.circle(c, x, y, r * 0.8, Color(GOLD, 0.55), maxf(1.5, r * 0.03))
	_emoji(c, icon, x, y, r * 0.95, r * 1.3)


static func _rank_block(c: CanvasItem, info: Dictionary, y: float, L: Dictionary) -> void:
	var rank: Dictionary = info.get("rank", {})
	var cx := CW / 2.0
	var parts := []
	var finds := _num(info.get("finds"))
	var decisions := _num(info.get("decisions"))
	var stat := func(icon: String, text: String, strong: bool) -> void:
		if parts.size():
			parts.append({ "t": "      " })
		parts.append({ "t": icon })
		parts.append({ "t": " " + text, "c": GOLD if strong else INK, "w": 700 if strong else 600 })
	var icon := _tidy(rank.get("icon"), 16)
	_seal(c, cx, y + L.cy, L.r, icon if icon else "🚀")
	var rname := _tidy(rank.get("name"), 40)
	_put(c, rname if rname else "Astronaut", cx, y + L.nameY, L.nameSize, GOLD, 700, 1300, 24)
	var dword := str(info.get("dayWord", "days")) if info.get("dayWord") else "days"
	stat.call("📅", _many(_num(info.get("days")), dword.trim_suffix("s"), dword), true)
	if finds > 0:
		stat.call("🔬", _many(finds, "discovery", "discoveries"), false)
	if decisions > 0:
		stat.call("🧭", _many(decisions, "big decision", "big decisions"), false)
	_runs(c, parts, cx, y + L.statY, L.statSize, 1340, 14)


static func _badge_height(n: int) -> int:
	return 0 if not n else (112 if n > 5 else 56)


## badges: a round medallion with the emoji, and the badge name beside it; five to a row
static func _badge_rows(c: CanvasItem, badges: Array, y: float) -> void:
	var n := badges.size()
	var two := n > 5
	var h := 50.0 if two else 56.0
	var first := int(ceil(n / 2.0)) if two else n
	_badge_row(c, badges.slice(0, first), y + h / 2, h)
	if two:
		_badge_row(c, badges.slice(first), y + h + 12 + h / 2, h)


static func _badge_row(c: CanvasItem, row: Array, cy: float, h: float) -> void:
	var max_w := 1380.0
	var gap := 14.0
	var size := roundi(h * 0.4)
	var names := []
	var widths := []
	var total := gap * (row.size() - 1)
	var f := _font(600)
	for b in row:
		var nm := _tidy(b.get("name") if b is Dictionary else "", 28)
		names.append(nm)
		var wd := h + 2 + f.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + h * 0.42
		widths.append(wd)
		total += wd
	var k := max_w / total if total > max_w else 1.0      # very long names: make the whole row a little smaller
	c.draw_set_transform(Vector2(CW / 2.0, cy), 0, Vector2(k, k))
	var x := -total / 2
	for i in row.size():
		Paint.rrect(c, x, -h / 2, widths[i], h, h / 2, Color8(18, 26, 56, 219))
		Paint.rrect(c, x, -h / 2, widths[i], h, h / 2, Color(GOLD, 0.5), 1.5)
		Paint.circle(c, x + h / 2, 0, h / 2 - 5, GOLD)
		Paint.circle(c, x + h / 2, 0, h / 2 - 7.5, Color("#17224f"))
		var ic := _tidy(row[i].get("icon") if row[i] is Dictionary else "", 16)
		_emoji(c, ic if ic else "🏅", x + h / 2, 0, h * 0.5, h * 0.62)
		c.draw_string(f, Vector2(x + h + 2, size * 0.35), names[i], HORIZONTAL_ALIGNMENT_LEFT, -1, size, INK)
		x += widths[i] + gap
	c.draw_set_transform(Vector2.ZERO)


static func _storm_cols(n: int) -> int:
	return n if n <= 5 else int(ceil(n / 2.0))


static func _storm_height(n: int) -> int:
	return 96 if not n else (154 if n > 5 else 110)


static func _storm_level(st: Dictionary) -> int:
	var lv := _num(st.get("level"))
	var cl := str(st.get("cls", "")).to_upper()
	if lv >= 1 and lv <= 3:
		return lv
	if cl.begins_with("X"):
		return 3
	if cl.begins_with("M"):
		return 2 if float(cl.substr(1)) >= 5 else 1
	return 0


static func _short_month(d: String) -> String:
	for m in MONTHS:
		if d.contains(m):
			return d.replace(m, m.substr(0, 3))
	return d


## "Real solar storms you lived through": one chip for each real storm, date and kind
static func _storm_panel(c: CanvasItem, info: Dictionary, storms: Array, y: float) -> void:
	var x := 110.0
	var w := CW - 220.0
	var cx := CW / 2.0
	var n := storms.size()
	var from := _tidy(info.get("from"), 24)
	var to := _tidy(info.get("to"), 24)
	var parts := [{ "t": "☀️" }, { "t": " Real solar storms you lived through", "w": 700 }]
	var cols := _storm_cols(n)
	var gap := 10.0
	var cw := minf(280, (w - 56 - gap * (cols - 1)) / cols) if n else 0.0
	var ch := 36.0
	var size := 20
	Paint.rrect(c, x, y, w, _storm_height(n), 22, Color8(8, 12, 30, 214))
	Paint.rrect(c, x, y, w, _storm_height(n), 22, Color(AIR, 0.45), 2)
	if from and to:
		parts.append({ "t": "     " + ("the real Sun on " + from if from == to else "the real Sun, " + from + " to " + to), "c": MUTED, "w": 400, "k": 0.8 })
	_runs(c, parts, cx, y + 40, 26, w - 56, 14)
	if not n:
		_put(c, "The real Sun stayed calm for your mission. Astronauts get lucky sometimes too!", cx, y + 78, 24, INK, 500, w - 56, 14)
		return
	# every chip gets the same text size; month names are shortened (Sep) only if the long ones do not fit
	var widest := func(cut_month: bool) -> float:
		var most := 0.0
		for st in storms:
			var d := _tidy(st.get("date"), 24)
			if cut_month:
				d = _short_month(d)
			var cl := _tidy(st.get("cls"), 8)
			var wd := _font(500).get_string_size(d, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x + (_font(700).get_string_size("  " + cl, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x if cl else 0.0) + 20
			most = maxf(most, wd)
		return most
	var brief: bool = widest.call(false) > cw - 30
	var big: float = widest.call(brief)
	if big > cw - 30:
		size = maxi(12, int(floor(20 * (cw - 30) / big)))
	for i in n:
		var row := 0 if i < cols else 1
		var in_row := n - cols if row else cols
		var px := cx - (in_row * cw + (in_row - 1) * gap) / 2 + ((i - cols) if row else i) * (cw + gap)
		var py := y + 58 + row * (ch + 8)
		var st: Dictionary = storms[i] if storms[i] is Dictionary else {}
		var lv := _storm_level(st)
		Paint.rrect(c, px, py, cw, ch, ch / 2, Color(1, 1, 1, 0.08))
		var d := _tidy(st.get("date"), 24)
		var cl := _tidy(st.get("cls"), 8)
		_runs(c, [{ "dot": STORM[lv] }, { "t": _short_month(d) if brief else d }, { "t": ("  " + cl) if cl else "", "c": STORM[lv], "w": 700 }], px + cw / 2, py + ch / 2 + size * 0.35, size, cw - 30, 11)


static func _footer(c: CanvasItem, info: Dictionary) -> void:
	var src := " (live)" if info.get("source") == "live" else (" (saved archive)" if info.get("source") == "archive" else "")
	var today := _tidy(info.get("today"), 40)
	if today == "":
		today = _today_text()
	var col := Color(INK, 0.92)
	for pass_i in 2:          # a soft dark copy underneath, so the words read over the bright horizon
		var dy := 2.0 if pass_i == 0 else 0.0
		var cc := Color(0, 0, 0, 0.7) if pass_i == 0 else col
		_put(c, "Solar storm dates: NASA DONKI space-weather database" + src + ". SEP = solar particle event, CME = coronal mass ejection shock.", CW / 2.0, 1052 + dy, 18, cc, 500, 1380, 12)
		_put(c, "Astro Outpost is a student project and is not affiliated with or endorsed by NASA.   ·   " + today, CW / 2.0, 1076 + dy, 18, cc, 500, 1380, 12)


static func draw_certificate(c: CanvasItem, info: Dictionary) -> void:
	var site: Dictionary = info.get("site", {})
	var badges: Array = (info.get("badges", []) as Array).slice(0, 10)
	var storms: Array = (info.get("storms", []) as Array).slice(0, 10)
	var top := 194.0
	var bottom := 990.0
	var hB := 178.0
	var hD := _badge_height(badges.size())
	var hE := _storm_height(storms.size())
	var gaps := 4 if hD else 3
	var room := bottom - top - hB - hD - hE
	# the biggest rank block (size from/50 down to to/50) that still leaves "air" px between the blocks
	var biggest := func(from: int, to: int, air: float):
		for i in range(from, to - 1, -1):
			var l := _rank_layout(i / 50.0)
			if l.h <= room - gaps * air:
				return l
		return null
	_backdrop(c, site.get("id") == "mars")
	_frame(c)
	_header(c)
	var L = biggest.call(60, 39, 36)
	if L == null:
		L = biggest.call(39, 30, 26)
	if L == null:
		L = _rank_layout(0.6)
	var gap := maxf(12, (room - L.h) / gaps)
	var y := top + gap
	_certify(c, info, y)
	y += hB + gap
	_rank_block(c, info, y, L)
	y += L.h + gap
	if hD:
		_badge_rows(c, badges, y)
	_storm_panel(c, info, storms, bottom - hE)
	_footer(c, info)


# =====================================================================
#  POSTCARD
# =====================================================================
static func _cover(c: CanvasItem, tex: Texture2D, x: float, y: float, w: float, h: float) -> bool:
	if tex == null:
		return false
	var sw := float(tex.get_width())
	var sh := float(tex.get_height())
	if sw < 2 or sh < 2:
		return false
	var k := maxf(w / sw, h / sh)
	var cw := w / k
	var ch := h / k
	c.draw_texture_rect_region(tex, Rect2(x, y, w, h), Rect2((sw - cw) / 2, (sh - ch) / 2, cw, ch))
	return true


## the corners outside a rounded rectangle, painted in the paper colour (a clip for the photo)
static func _round_corners(c: CanvasItem, x: float, y: float, w: float, h: float, r: float, paper: Color) -> void:
	for cn in [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]:
		var ox: float = cn[0]
		var oy: float = cn[1]
		var pts := PackedVector2Array([Vector2(ox, oy)])
		for i in 9:
			var a := PI / 2 * i / 8.0
			pts.append(Vector2(ox + cn[2] * (r - cos(a) * r), oy + cn[3] * (r - sin(a) * r)))
		c.draw_colored_polygon(pts, paper)


static func draw_postcard(c: CanvasItem, photo: Texture2D, caption: String, sub: String) -> void:
	var x := 44.0
	var y := 44.0
	var w := PW - 88.0
	var h := 556.0
	var paper := Color("#fffdf6")
	Paint.rect(c, 0, 0, PW, PH, paper)
	Paint.rect(c, x, y, w, h, Color("#060914"))
	if not _cover(c, photo, x, y, w, h):
		c.draw_polygon(PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)]), PackedColorArray([Color("#050816"), Color("#050816"), Color("#18245a"), Color("#18245a")]))
		_stars(c, x, y, w, h, 150, 2024)
	_round_corners(c, x, y, w, h, 28, paper)
	Paint.rrect(c, x, y, w, h, 28, Color8(18, 26, 56, 71), 2)
	Paint.stroke_rect(c, 1, 1, PW - 2, PH - 2, Color8(18, 26, 56, 41), 2)
	_put(c, caption, PW / 2.0, 688, 60, Color("#18224a"), 700, 1080, 24)
	_put(c, sub, PW / 2.0, 742, 26, Color("#5b6488"), 500, 1080, 14)


# =====================================================================
#  off-screen pictures
# =====================================================================
## a viewport w x h that paints with fn(canvas); kept until freed
func _canvas_vp(w: int, h: int, fn: Callable) -> SubViewport:
	var vp := SubViewport.new()
	vp.size = Vector2i(w, h)
	vp.disable_3d = true
	vp.transparent_bg = false
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	var ci := Control.new()
	ci.size = Vector2(w, h)
	ci.draw.connect(func(): fn.call(ci))
	vp.add_child(ci)
	add_child(vp)
	vp.set_meta("ci", ci)
	return vp


func _repaint(vp: SubViewport) -> void:
	(vp.get_meta("ci") as Control).queue_redraw()
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE


## Save a picture as a PNG: into the Pictures folder (or a browser download on the web). Returns where it went.
func save_png(img: Image, name: String) -> String:
	if img == null or img.is_empty():
		return ""
	if OS.has_feature("web"):
		JavaScriptBridge.download_buffer(img.save_png_to_buffer(), name, "image/png")
		return "your downloads"
	var dir := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES)
	if dir == "" or not DirAccess.dir_exists_absolute(dir):
		dir = OS.get_user_data_dir()
	var base := name.get_basename()
	var path := dir.path_join(name)
	var k := 2
	while FileAccess.file_exists(path):
		path = dir.path_join(base + "-" + str(k) + ".png")
		k += 1
	return path if img.save_png(path) == OK else ""


# ---------- the postcard: a photo of exactly what you see, without the game's panels ----------
## Starts the photo now and returns the card at once; the picture fills in a frame later.
func postcard(caption := "", sub := ""):
	var card := { "kind": "postcard", "caption": _tidy(caption, 70), "sub": _tidy(sub, 110), "image": null, "tex": null, "ready": false, "waiters": [] }
	if card.caption == "":
		var words := _guess_words()
		card.caption = words.caption
		card.sub = words.sub
	_shoot(card)
	return card


func _guess_words() -> Dictionary:
	var out := { "caption": "Greetings from space!", "sub": "Astro Outpost" }
	var s = Game.s
	if s is Dictionary and s.get("site"):
		out.caption = "Greetings from " + str(s.site.name) + "!"
		out.sub = str(s.site.dayWord) + " " + str(s.sol) + " · " + str(s.site.place) + " · Astro Outpost"
	return out


func _shoot(card: Dictionary) -> void:
	var was: bool = Ui.visible
	Ui.visible = false                       # the panels step aside for one frame
	await RenderingServer.frame_post_draw
	var shot: Image = get_viewport().get_texture().get_image()
	Ui.visible = was
	var photo: Texture2D = ImageTexture.create_from_image(shot) if shot and not shot.is_empty() else null
	var vp := _canvas_vp(PW, PH, func(ci: Control): draw_postcard(ci, photo, card.caption, card.sub))
	await RenderingServer.frame_post_draw
	card.image = vp.get_texture().get_image()
	vp.queue_free()
	card.tex = ImageTexture.create_from_image(card.image) if card.image and not card.image.is_empty() else null
	card.ready = true
	for fn in card.waiters:
		if fn is Callable and fn.is_valid():
			fn.call()


func _save_row() -> String:
	return "<div class=\"keepsake-actions\"><span id=\"ks-status\"> </span><button class=\"btn primary\" data-act=\"save\">⬇ Save picture</button></div>"


## a picture inside a card, as wide as the card and with the picture's own shape
static func _preview(c: Control, tex: Texture2D, aspect: float) -> void:
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.custom_minimum_size = Vector2(0, 300)
	var tr := TextureRect.new()
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tr.texture = tex
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.add_child(tr)
	c.resized.connect(func():
		var want := roundf(c.size.x / aspect)
		if absf(c.custom_minimum_size.y - want) > 1:
			c.custom_minimum_size.y = want)


func open_postcard(card = null, caption := "", sub := "") -> void:
	if not (card is Dictionary) or card.get("kind") != "postcard":
		card = postcard(caption, sub)
	var doc: Html.Doc = Game.open_info("<h2>📸 Your postcard</h2><p class=\"sub\">Print it or keep it. Nothing leaves this computer.</p><canvas id=\"ks-preview\" width=\"600\" height=\"400\"></canvas>" + _save_row())
	if doc == null:
		return
	var holder: Control = doc.el("ks-preview")
	var show := func():
		if holder and is_instance_valid(holder):
			_preview(holder, card.tex, float(PW) / PH)
	if card.ready:
		show.call()
	else:
		card.waiters.append(show)
	doc.on("save", func():
		Au.play("tap")
		var where := save_png(card.image, "astro-outpost-postcard.png") if card.ready else ""
		doc.set_text("ks-status", ("Done! Saved in " + where.get_base_dir().get_file() + ": " + where.get_file()) if where.contains("/") else ("Done! Look in your downloads." if where else "Sorry, the picture could not be saved.")))


# ---------- the certificate ----------
func certificate(info: Dictionary) -> SubViewport:
	return _canvas_vp(CW, CH, func(ci: Control): draw_certificate(ci, info))


func open_certificate(info = null) -> void:
	if not (info is Dictionary):
		info = {}
	_cert_info = info.duplicate()
	if _tidy(_cert_info.get("name"), 20) == "":
		_cert_info.name = kept_name
	if _cert_vp and is_instance_valid(_cert_vp):
		_cert_vp.queue_free()
	var me := self
	_cert_vp = _canvas_vp(CW, CH, func(ci: Control): me.draw_certificate(ci, me._cert_info))
	var rank: Dictionary = info.get("rank", {})
	var doc: Html.Doc = Game.open_info("<h2>🎓 Your mission certificate</h2><p class=\"sub\">Print it or keep it. Nothing leaves this computer.</p>" +
		"<p>Your first name (optional)</p><input id=\"ks-name\" type=\"text\" maxlength=\"20\" placeholder=\"" + Html.esc(str(rank.get("name", "Astronaut"))) + "\" value=\"" + Html.esc(_tidy(_cert_info.get("name"), 20)) + "\">" +
		"<canvas id=\"ks-preview\" width=\"640\" height=\"452\"></canvas>" + _save_row())
	_cert_doc = doc
	if doc == null:
		return
	var holder: Control = doc.el("ks-preview")
	if holder:
		_preview(holder, _cert_vp.get_texture(), float(CW) / CH)
	var field = doc.el("ks-name")
	if field is LineEdit:
		field.text_changed.connect(func(t: String):
			kept_name = _tidy(t, 20)
			_cert_info.name = kept_name
			if _cert_vp and is_instance_valid(_cert_vp):
				_repaint(_cert_vp))
	doc.on("save", func():
		Au.play("tap")
		if not (_cert_vp and is_instance_valid(_cert_vp)):
			return
		_repaint(_cert_vp)
		await RenderingServer.frame_post_draw
		var where := save_png(_cert_vp.get_texture().get_image(), "astro-outpost-certificate.png")
		doc.set_text("ks-status", ("Done! Saved in " + where.get_base_dir().get_file() + ": " + where.get_file()) if where.contains("/") else ("Done! Look in your downloads." if where else "Sorry, the picture could not be saved.")))
