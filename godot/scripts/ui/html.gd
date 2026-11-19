class_name Html
## The game writes its cards as small pieces of HTML (the same words and layout as the web version). This turns such a
## piece into Godot controls: text runs become RichTextLabels (BBCode), blocks become containers, <button data-act="x">
## becomes a Button that calls the card's action "x", <input> becomes a LineEdit. Classes from the web stylesheet that
## shape a card (info-row, cards, pick, modal-actions, day-head, find, tagline...) get the same look here.
## Emoji that have a drawn icon (assets/icons) are shown as that icon, like js/icons.js did.

const ICONS := { "💨": "air", "🥬": "food", "☢": "radiation", "☀": "sun", "🛡": "shield", "🔬": "lab", "📡": "dish", "🚙": "rover",
	"🔋": "cell", "🧊": "ice", "🧱": "bag", "🧪": "core", "📦": "inst", "🧳": "case", "🚀": "rocket", "🏠": "home", "💧": "water", "🫧": "filter" }
const VOID := { "br": 1, "img": 1, "input": 1, "hr": 1, "meta": 1, "link": 1, "source": 1, "wbr": 1, "col": 1 }
const BLOCK := { "div": 1, "p": 1, "h1": 1, "h2": 1, "h3": 1, "h4": 1, "h5": 1, "h6": 1, "ul": 1, "ol": 1, "li": 1, "section": 1, "header": 1,
	"footer": 1, "article": 1, "aside": 1, "nav": 1, "figure": 1, "blockquote": 1, "table": 1, "tr": 1, "td": 1, "th": 1, "thead": 1,
	"tbody": 1, "details": 1, "summary": 1, "form": 1, "label": 1, "button": 1, "input": 1, "select": 1, "textarea": 1, "hr": 1, "svg": 1,
	"canvas": 1, "fieldset": 1, "dl": 1, "dt": 1, "dd": 1, "pre": 1, "figcaption": 1, "main": 1 }
const SKIP := { "script": 1, "style": 1, "svg": 1, "template": 1, "noscript": 1 }
## classes laid out in a row (flex in the web stylesheet)
const ROWS := { "info-row": 1, "modal-actions": 1, "swatches": 1, "day-head": 1, "find": 1, "mc-row": 1, "crew-ways": 1, "keepsake-actions": 1,
	"mc-actions": 1, "row": 1, "crew-join": 1, "jr-tabs": 1, "inside-actions": 1, "crisis-foot": 1, "why-row": 1, "crew-code": 1 }
const ENT := { "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "#39": "'", "nbsp": " ", "middot": "·", "times": "×", "rarr": "→",
	"larr": "←", "darr": "↓", "uarr": "↑", "hellip": "…", "mdash": "—", "ndash": "–", "deg": "°", "minus": "−", "copy": "©", "bull": "•",
	"thinsp": " ", "ensp": " ", "emsp": " ", "plusmn": "±", "frac12": "½", "le": "≤", "ge": "≥", "asymp": "≈", "micro": "µ", "check": "✓" }


static func esc(s) -> String:
	return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")


static func decode(s: String) -> String:
	if s.find("&") < 0:
		return s
	var out := ""
	var i := 0
	while i < s.length():
		var c := s[i]
		if c == "&":
			var e := s.find(";", i)
			if e > i and e - i < 10:
				var name := s.substr(i + 1, e - i - 1)
				if ENT.has(name):
					out += ENT[name]
					i = e + 1
					continue
				if name.begins_with("#x"):
					out += String.chr(name.substr(2).hex_to_int())
					i = e + 1
					continue
				if name.begins_with("#") and name.substr(1).is_valid_int():
					out += String.chr(name.substr(1).to_int())
					i = e + 1
					continue
		out += c
		i += 1
	return out


## the words only, without tags (for buttons and read-aloud)
static func plain(html: String) -> String:
	var out := ""
	var depth := 0
	for c in html:
		if c == "<":
			depth += 1
		elif c == ">":
			depth = maxi(0, depth - 1)
		elif depth == 0:
			out += c
	return decode(out).strip_edges()


# ---------- parsing ----------
## A node is { tag, attrs, kids } or a String (text).
static func parse(src: String) -> Array:
	var root := { "tag": "#root", "attrs": {}, "kids": [] }
	var stack := [root]
	var i := 0
	var n := src.length()
	while i < n:
		var lt := src.find("<", i)
		if lt < 0:
			lt = n
		if lt > i:
			(stack.back().kids as Array).append(decode(src.substr(i, lt - i)))
		if lt >= n:
			break
		if src.substr(lt, 4) == "<!--":
			var ce := src.find("-->", lt)
			i = n if ce < 0 else ce + 3
			continue
		var gt := _tag_end(src, lt)
		if gt < 0:
			(stack.back().kids as Array).append(decode(src.substr(lt)))
			break
		var inner := src.substr(lt + 1, gt - lt - 1).strip_edges()
		i = gt + 1
		if inner.begins_with("/"):
			var name := inner.substr(1).strip_edges().to_lower()
			for k in range(stack.size() - 1, 0, -1):
				if stack[k].tag == name:
					stack.resize(k)
					break
			continue
		if inner.begins_with("!") or inner.begins_with("?"):
			continue
		var self_close := inner.ends_with("/")
		if self_close:
			inner = inner.substr(0, inner.length() - 1)
		var sp := 0
		while sp < inner.length() and not (inner[sp] in [" ", "\t", "\n", "\r"]):
			sp += 1
		var tag := inner.substr(0, sp).to_lower()
		var node := { "tag": tag, "attrs": _attrs(inner.substr(sp)), "kids": [] }
		# a new <p> or <li> closes an open one, as browsers do
		if (tag == "p" or tag == "li") and stack.size() > 1 and stack.back().tag == tag:
			stack.pop_back()
		(stack.back().kids as Array).append(node)
		if SKIP.has(tag) and not self_close:
			var close := src.findn("</" + tag, i)
			if close >= 0:
				node.raw = src.substr(i, close - i)
				var ce2 := src.find(">", close)
				i = n if ce2 < 0 else ce2 + 1
			continue
		if not self_close and not VOID.has(tag):
			stack.append(node)
	return root.kids


static func _tag_end(src: String, from: int) -> int:
	var q := ""
	for k in range(from + 1, src.length()):
		var c := src[k]
		if q != "":
			if c == q:
				q = ""
		elif c == "\"" or c == "'":
			q = c
		elif c == ">":
			return k
	return -1


static func _attrs(s: String) -> Dictionary:
	var out := {}
	var i := 0
	var n := s.length()
	while i < n:
		while i < n and s[i] in [" ", "\t", "\n", "\r"]:
			i += 1
		if i >= n:
			break
		var st := i
		while i < n and not (s[i] in ["=", " ", "\t", "\n", "\r"]):
			i += 1
		var name := s.substr(st, i - st).to_lower()
		while i < n and s[i] in [" ", "\t"]:
			i += 1
		if i < n and s[i] == "=":
			i += 1
			while i < n and s[i] in [" ", "\t"]:
				i += 1
			var val := ""
			if i < n and (s[i] == "\"" or s[i] == "'"):
				var q := s[i]
				var e := s.find(q, i + 1)
				if e < 0:
					e = n
				val = s.substr(i + 1, e - i - 1)
				i = e + 1
			else:
				var vs := i
				while i < n and not (s[i] in [" ", "\t", "\n", "\r"]):
					i += 1
				val = s.substr(vs, i - vs)
			out[name] = decode(val)
		elif name != "":
			out[name] = ""
	return out


static func classes(node: Dictionary) -> Array:
	return str(node.attrs.get("class", "")).split(" ", false)


static func has_class(node: Dictionary, c: String) -> bool:
	return c in classes(node)


## an attribute of a rendered element (data-act, data-v...)
static func attr(el: Node, name: String, def: String = "") -> String:
	if el and el.has_meta("attrs"):
		return str(el.get_meta("attrs").get(name, def))
	return def


# ---------- rendering ----------
class Doc extends RefCounted:
	var root: Control
	var ids := {}
	var acts := {}
	var buttons: Array = []
	var inputs: Array = []
	var on_any := Callable()        # called for every button press: (act, el)

	func el(id: String) -> Control:
		return ids.get(id)

	func on(act: String, fn: Callable) -> void:
		acts[act] = fn

	func click(id: String, fn: Callable) -> void:
		var b = ids.get(id)
		if b is BaseButton:
			b.pressed.connect(func(): fn.call(b))

	func set_text(id: String, text: String) -> void:
		var c = ids.get(id)
		if c is RichTextLabel:
			c.text = Html.bb_text(text)
		elif c is Label or c is Button or c is LineEdit:
			c.text = text
		elif c is Container:
			set_html(id, Html.esc(text))

	## re-renders the inside of an element
	func set_html(id: String, html: String) -> void:
		var c = ids.get(id)
		if c == null:
			return
		var style: Dictionary = c.get_meta("style", Html.base_style())
		if c is RichTextLabel:
			c.text = Html.inline_bb(Html.parse(html), style)
			return
		for k in c.get_children():
			k.queue_free()
		var sub := Html.render(html, acts, style, self)
		for k in sub.root.get_children():
			sub.root.remove_child(k)
			c.add_child(k)
		sub.root.free()

	func act(name: String, b: Control) -> void:
		if on_any.is_valid():
			on_any.call(name, b)
		var fn = acts.get(name)
		if fn is Callable and fn.is_valid():
			if fn.get_argument_count() >= 1:
				fn.call(b)
			else:
				fn.call()

	func first_button() -> Button:
		for b in buttons:
			if is_instance_valid(b) and b.theme_type_variation == "BtnPrimary" and not b.disabled:
				return b
		for b in buttons:
			if is_instance_valid(b) and not b.disabled:
				return b
		return null

	func value(id: String) -> String:
		var c = ids.get(id)
		if c is LineEdit:
			return c.text
		if c is OptionButton:
			return str(c.get_item_metadata(c.selected)) if c.selected >= 0 else ""
		return ""


static func base_style() -> Dictionary:
	return { "size": 16, "color": Style.INK, "weight": 400, "family": "lexend", "align": "left", "upper": false }


## Renders html into a VBoxContainer (doc.root). into: render into an existing doc (its ids and actions are shared).
static func render(html: String, acts: Dictionary = {}, style: Dictionary = {}, into: Doc = null) -> Doc:
	var doc: Doc = into if into else Doc.new()
	if into == null:
		doc.acts = acts
	var st := base_style()
	st.merge(style, true)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_fill(box, parse(html), st, doc, {})
	doc.root = box
	return doc


static func _is_block(n) -> bool:
	if n is String:
		return false
	if BLOCK.has(n.tag):
		return true
	for k in n.kids:
		if _is_block(k):
			return true
	return false


## puts the children of a node into a container: runs of text become one label, blocks their own controls
static func _fill(box: Control, kids: Array, st: Dictionary, doc: Doc, parent: Dictionary) -> void:
	var run: Array = []
	for k in kids:
		if _is_block(k):
			_flush(box, run, st, doc)
			run = []
			var c := _block(k, st, doc, parent)
			if c:
				box.add_child(c)
		else:
			run.append(k)
	_flush(box, run, st, doc)


static func _flush(box: Control, run: Array, st: Dictionary, doc: Doc) -> void:
	if run.is_empty():
		return
	var bb := inline_bb(run, st).strip_edges()
	if bb == "":
		return
	box.add_child(_label(bb, st))


static func _label(bb: String, st: Dictionary) -> RichTextLabel:
	var l := RichTextLabel.new()
	l.bbcode_enabled = true
	l.fit_content = true
	l.scroll_active = false
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.mouse_filter = Control.MOUSE_FILTER_PASS
	l.selection_enabled = false
	l.add_theme_font_size_override("normal_font_size", st.size)
	l.add_theme_font_size_override("bold_font_size", st.size)
	l.add_theme_font_size_override("italics_font_size", st.size)
	l.add_theme_font_size_override("mono_font_size", st.size)
	l.add_theme_color_override("default_color", st.color)
	l.add_theme_font_override("normal_font", Style.font(st.weight, st.family))
	l.add_theme_font_override("bold_font", Style.font(maxi(700, st.weight), st.family))
	if st.align == "center":
		bb = "[center]" + bb + "[/center]"
	elif st.align == "right":
		bb = "[right]" + bb + "[/right]"
	l.text = bb
	l.meta_clicked.connect(func(meta): OS.shell_open(str(meta)))
	l.set_meta("style", st)
	return l


static func bb_text(text: String, size: int = 16) -> String:
	return _icons(text.replace("[", "[lb]"), size)


static func _icons(t: String, size: int) -> String:
	for e in ICONS:
		if t.find(e) >= 0:
			var px := int(size * 1.25)
			# a part of a joined emoji (🧑‍🚀 is 🧑 + a joiner + 🚀) stays as it is, so the whole one is drawn
			t = t.replace("‍" + e, "‍").replace(e + "️", e).replace(e, "[img=%dx%d]res://assets/icons/%s.svg[/img]" % [px, px, ICONS[e]]).replace("‍", "‍" + e)
	return t


static func _style_color(n: Dictionary):
	var s := str(n.attrs.get("style", ""))
	var k := s.find("color:")
	if k < 0 or (k > 0 and s[k - 1] == "-"):
		return null
	var v := s.substr(k + 6).split(";")[0].strip_edges()
	return Color.from_string(v, Color.WHITE) if v.begins_with("#") or v.begins_with("rgb") else null


## inline nodes as BBCode
static func inline_bb(nodes: Array, st: Dictionary) -> String:
	var out := ""
	for n in nodes:
		if n is String:
			var t: String = n
			t = t.replace("\n", " ").replace("\t", " ").replace("\r", " ")
			while t.find("  ") >= 0:
				t = t.replace("  ", " ")
			if st.get("upper"):
				t = t.to_upper()
			out += _icons(t.replace("[", "[lb]"), st.size)
			continue
		var tag: String = n.tag
		var cl := classes(n)
		var inner_st: Dictionary = st.duplicate()
		var pre := ""
		var post := ""
		match tag:
			"b", "strong":
				pre = "[b]"
				post = "[/b]"
			"i", "em":
				if not ("ic" in cl):
					pre = "[i]"
					post = "[/i]"
			"small", "sub", "sup":
				inner_st.size = int(st.size * 0.8)
				pre = "[font_size=%d][color=%s]" % [inner_st.size, Style.hx(Style.MUTED)]
				post = "[/color][/font_size]"
			"kbd":
				pre = "[bgcolor=%s][color=#2a1c00][b] " % Style.hx(Style.POWER)
				post = " [/b][/color][/bgcolor]"
			"code":
				pre = "[code]"
				post = "[/code]"
			"u":
				pre = "[u]"
				post = "[/u]"
			"s", "del":
				pre = "[s]"
				post = "[/s]"
			"a":
				pre = "[url=%s][color=%s]" % [n.attrs.get("href", ""), Style.hx(Style.AIR)]
				post = "[/color][/url]"
			"br":
				out += "\n"
				continue
			"img":
				var src := str(n.attrs.get("src", ""))
				if src.find("icons/") >= 0:
					var px := int(st.size * 1.25)
					out += "[img=%dx%d]res://%s[/img]" % [px, px, src.trim_prefix("res://")]
				continue
			"span", "i", "em", "mark":
				pass
		if "tagline" in cl:
			var bg := Style.AIR
			var fg := Color("#05263a")
			if "archive" in cl:
				bg = Style.SCI
				fg = Color("#3a2200")
			elif "choice" in cl:
				bg = Style.POWER
				fg = Color("#2a1c00")
			inner_st.upper = true
			inner_st.size = int(st.size * 0.72)
			pre = "[font_size=%d][bgcolor=%s][color=%s][b] " % [inner_st.size, Style.hx(bg), Style.hx(fg)]
			post = " [/b][/color][/bgcolor][/font_size]  "
		elif "sub" in cl or "muted" in cl:
			pre += "[color=%s]" % Style.hx(Style.MUTED)
			post = "[/color]" + post
		elif "bad" in cl or "warn" in cl:
			pre += "[color=#ff9aa8]"
			post = "[/color]" + post
		elif "good" in cl:
			pre += "[color=%s]" % Style.hx(Style.OK)
			post = "[/color]" + post
		var sc = _style_color(n)
		if sc != null:
			pre += "[color=%s]" % Style.hx(sc)
			post = "[/color]" + post
		out += pre + inline_bb(n.kids, inner_st) + post
	return out


static func _text_style(n: Dictionary, st: Dictionary, parent: Dictionary) -> Dictionary:
	var s: Dictionary = st.duplicate()
	var cl := classes(n)
	match n.tag:
		"h1":
			s.size = 40
			s.weight = 700
			s.family = "exo2"
		"h2":
			s.size = 27
			s.weight = 700
			s.family = "exo2"
		"h3":
			s.size = 17
			s.weight = 600
			s.color = Style.POWER
		"h4":
			s.size = 13
			s.weight = 600
			s.color = Style.POWER
			s.upper = true
		"small":
			s.size = int(st.size * 0.82)
			s.color = Style.MUTED
		"th":
			s.weight = 700
	if "sub" in cl or "muted" in cl or "note" in cl:
		s.color = Style.MUTED
	if "big-icon" in cl:
		s.size = 46
	if "center" in cl or str(n.attrs.get("style", "")).find("text-align:center") >= 0 or str(n.attrs.get("style", "")).find("text-align: center") >= 0:
		s.align = "center"
	var sc = _style_color(n)
	if sc != null:
		s.color = sc
	if parent.get("tag") == "info-row" and n.tag == "p":
		s.size = 15
		s.color = Color("#dfe5ff")
	return s


static func _block(n: Dictionary, st: Dictionary, doc: Doc, parent: Dictionary) -> Control:
	var tag: String = n.tag
	var cl := classes(n)
	var s := _text_style(n, st, parent)
	var c: Control = null
	if SKIP.has(tag):
		return null
	if "hidden" in cl:
		c = VBoxContainer.new()
		c.visible = false
	elif tag == "button":
		c = _button(n, s, doc)
	elif tag == "input" or tag == "textarea":
		c = _input(n, s, doc)
	elif tag == "select":
		c = _select(n, s, doc)
	elif tag == "hr":
		c = HSeparator.new()
	elif tag == "canvas":
		c = Control.new()
		c.custom_minimum_size = Vector2(float(n.attrs.get("width", "200")), float(n.attrs.get("height", "120")))
	elif "info-row" in cl:
		var p := PanelContainer.new()
		p.theme_type_variation = "InfoRowGood" if "good" in cl else ("InfoRowAlert" if "alert" in cl else "InfoRow")
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		p.add_child(row)
		for k in n.kids:
			if k is String and k.strip_edges() == "":
				continue
			if not (k is String) and "ic" in classes(k):
				var ic := _label(inline_bb(k.kids, s).strip_edges(), _with(s, { "size": 30, "align": "center" }))
				ic.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
				ic.custom_minimum_size.x = 42
				ic.fit_content = true
				ic.autowrap_mode = TextServer.AUTOWRAP_OFF
				row.add_child(ic)
				continue
			var inner := VBoxContainer.new()
			inner.add_theme_constant_override("separation", 3)
			inner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			if k is String:
				_fill(inner, [k], s, doc, { "tag": "info-row" })
			else:
				_fill(inner, k.kids, _with(s, { "size": 17 }) if k.tag == "b" else s, doc, { "tag": "info-row" })
				_attach(inner, k, doc)
			row.add_child(inner)
		c = p
	elif "find" in cl or "fact" in cl:
		var p2 := PanelContainer.new()
		p2.theme_type_variation = "Soft"
		var row2 := HBoxContainer.new()
		p2.add_child(row2)
		var rest := []
		for k in n.kids:
			if not (k is String) and k.tag == "em" and row2.get_child_count() == 0:
				var ic2 := _label(inline_bb(k.kids, s).strip_edges(), _with(s, { "size": 24 }))
				ic2.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
				ic2.autowrap_mode = TextServer.AUTOWRAP_OFF
				row2.add_child(ic2)
			else:
				rest.append(k)
		var body := VBoxContainer.new()
		body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		body.add_theme_constant_override("separation", 2)
		_fill(body, rest, _with(s, { "size": 15 }), doc, { "tag": "find" })
		row2.add_child(body)
		c = p2
	elif "cards" in cl or "holo-grid" in cl:
		var g := GridContainer.new()
		g.columns = 4 if "four" in cl else (3 if ("three" in cl or "holo-grid" in cl) else 2)
		g.add_theme_constant_override("h_separation", 10)
		g.add_theme_constant_override("v_separation", 10)
		g.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_fill(g, n.kids, s, doc, n)
		c = g
	elif tag == "ul" or tag == "ol":
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", 4)
		var num := 0
		for k in n.kids:
			if k is String:
				continue
			num += 1
			var li := HBoxContainer.new()
			li.add_theme_constant_override("separation", 8)
			var mark := ""
			if tag == "ol":
				mark = str(num) + "."
			elif not ("harder" in cl):
				mark = "•"
			var kids: Array = k.kids
			var mark_col = null
			if "harder" in cl and kids.size() and not (kids[0] is String) and kids[0].tag == "span":
				mark = Html.plain_nodes(kids[0].kids)
				mark_col = _style_color(kids[0])
				kids = kids.slice(1)
			if mark != "":
				var b := _label(bb_text(mark, s.size), _with(s, { "color": mark_col if mark_col != null else (Style.POWER if tag == "ol" else s.color) }))
				b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
				b.autowrap_mode = TextServer.AUTOWRAP_OFF
				li.add_child(b)
			var body2 := VBoxContainer.new()
			body2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			body2.add_theme_constant_override("separation", 3)
			_fill(body2, kids, _text_style(k, s, n), doc, k)
			_attach(li, k, doc)
			li.add_child(body2)
			v.add_child(li)
		c = v
	elif tag == "table":
		var rows := []
		_collect(n, "tr", rows)
		var cols := 1
		for r in rows:
			var nc := 0
			for k in r.kids:
				if not (k is String):
					nc += 1
			cols = maxi(cols, nc)
		var gt := GridContainer.new()
		gt.columns = cols
		gt.add_theme_constant_override("h_separation", 14)
		for r in rows:
			for k in r.kids:
				if k is String:
					continue
				var cell := VBoxContainer.new()
				cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				_fill(cell, k.kids, _text_style(k, s, r), doc, k)
				_attach(cell, k, doc)
				gt.add_child(cell)
		c = gt
	else:
		var row_like := tag != "p" and not tag.begins_with("h") and _row(cl)
		var box: Container
		if "modal-actions" in cl or "inside-actions" in cl or "keepsake-actions" in cl or "mc-actions" in cl:
			var fl := HFlowContainer.new()
			fl.alignment = FlowContainer.ALIGNMENT_END if not ("center" in cl) else FlowContainer.ALIGNMENT_CENTER
			fl.add_theme_constant_override("h_separation", 12)
			fl.add_theme_constant_override("v_separation", 10)
			box = fl
		elif "swatches" in cl or "jr-tabs" in cl:
			var fl2 := HFlowContainer.new()
			fl2.add_theme_constant_override("h_separation", 10)
			box = fl2
		elif row_like:
			var h := HBoxContainer.new()
			h.add_theme_constant_override("separation", 12)
			box = h
		else:
			var v2 := VBoxContainer.new()
			v2.add_theme_constant_override("separation", 6)
			box = v2
		box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if row_like and not ("modal-actions" in cl):
			# in a row, every part but the icon shares the width
			for k in n.kids:
				if k is String:
					if k.strip_edges() != "":
						box.add_child(_label(bb_text(k.strip_edges(), s.size), s))
					continue
				if "big-icon" in classes(k) or (k.tag == "span" and not _is_block(k)) or k.tag == "em":
					var lab := _label(inline_bb([k], _text_style(k, s, n)).strip_edges(), _text_style(k, s, n))
					lab.autowrap_mode = TextServer.AUTOWRAP_OFF
					lab.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
					_attach(lab, k, doc)
					box.add_child(lab)
				elif _is_block(k):
					var cc := _block(k, s, doc, n)
					if cc:
						cc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
						box.add_child(cc)
				else:
					box.add_child(_label(inline_bb([k], s), s))
		else:
			_fill(box, n.kids, s, doc, n)
			# a block with only text in it is just its label
			if box.get_child_count() == 1 and box.get_child(0) is RichTextLabel and box is VBoxContainer:
				var only := box.get_child(0)
				box.remove_child(only)
				box.free()
				c = only
		if c == null:
			c = box
	_attach(c, n, doc)
	if c is Control:
		c.set_meta("style", s)
	return c


static func plain_nodes(nodes: Array) -> String:
	var out := ""
	for k in nodes:
		out += k if k is String else plain_nodes(k.kids)
	return out.strip_edges()


static func _collect(n: Dictionary, tag: String, out: Array) -> void:
	for k in n.kids:
		if k is String:
			continue
		if k.tag == tag:
			out.append(k)
		else:
			_collect(k, tag, out)


static func _row(cl: Array) -> bool:
	for k in cl:
		if ROWS.has(k):
			return true
	return false


static func _with(st: Dictionary, over: Dictionary) -> Dictionary:
	var s: Dictionary = st.duplicate()
	s.merge(over, true)
	return s


static func _attach(c: Control, n: Dictionary, doc: Doc) -> void:
	if c == null:
		return
	c.set_meta("attrs", n.attrs)
	c.set_meta("tag", n.tag)
	if n.attrs.has("id"):
		doc.ids[n.attrs.id] = c
		c.name = str(n.attrs.id).validate_node_name()
	if n.attrs.has("title") and not (c is RichTextLabel):
		c.tooltip_text = n.attrs.title


static func _button(n: Dictionary, s: Dictionary, doc: Doc) -> Button:
	var cl := classes(n)
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var rich := "pick" in cl or "opt" in cl or "holo-btn" in cl or "crew-way" in cl
	for k in n.kids:
		if not (k is String) and _is_block(k):
			rich = true
	if "swatch" in cl:
		var col := Color.WHITE
		var stl := str(n.attrs.get("style", ""))
		var k2 := stl.find("--c:")
		if k2 >= 0:
			col = Color.from_string(stl.substr(k2 + 4).split(";")[0].strip_edges(), Color.WHITE)
		var sel := "sel" in cl
		var sb := Style.box(col, 999, Color.WHITE if sel else Color(1, 1, 1, 0.25), 3, Vector4.ZERO)
		for stn in ["normal", "hover", "pressed", "hover_pressed"]:
			b.add_theme_stylebox_override(stn, sb)
		b.custom_minimum_size = Vector2(42, 42)
		b.tooltip_text = str(n.attrs.get("aria-label", ""))
	elif rich:
		b.theme_type_variation = "PickSel" if ("sel" in cl or "on" in cl) else ("Opt" if "opt" in cl else "Pick")
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var body := VBoxContainer.new()
		body.add_theme_constant_override("separation", 3)
		body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		body.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var icon: Control = null
		for k in n.kids:
			if k is String:
				if k.strip_edges() != "":
					body.add_child(_label(bb_text(k.strip_edges(), s.size), s))
				continue
			if k.tag == "em" and icon == null:
				icon = _label(inline_bb(k.kids, s).strip_edges(), _with(s, { "size": 26 }))
				icon.autowrap_mode = TextServer.AUTOWRAP_OFF
				icon.size_flags_horizontal = Control.SIZE_SHRINK_END
				continue
			if k.tag == "b":
				body.add_child(_label(inline_bb(k.kids, s), _with(s, { "size": 18 if not ("three" in cl) else 16, "weight": 700 })))
			elif k.tag == "span" and not _is_block(k):
				body.add_child(_label(inline_bb(k.kids, s), _with(s, { "size": 14, "color": Style.MUTED })))
			elif _is_block(k):
				var cc := _block(k, s, doc, n)
				if cc:
					body.add_child(cc)
			else:
				body.add_child(_label(inline_bb([k], s), s))
		row.add_child(body)
		if icon:
			row.add_child(icon)
		b.add_child(row)
		row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		var pad := Vector2(28, 24)
		row.offset_left = 14
		row.offset_top = 12
		row.offset_right = -14
		row.offset_bottom = -12
		_ignore_mouse(row)
		b.custom_minimum_size = Vector2(150, 64)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		# the button grows to fit what is inside it
		var fit := func():
			if is_instance_valid(b) and is_instance_valid(row):
				var want := row.get_combined_minimum_size() + pad
				b.custom_minimum_size = Vector2(maxf(150, want.x * 0.0 + 150), maxf(64, want.y))
		row.minimum_size_changed.connect(fit)
		b.resized.connect(fit)
		b.clip_contents = false
	else:
		var text := Html.plain_nodes(n.kids)
		b.text = text
		if "primary" in cl:
			b.theme_type_variation = "BtnPrimary"
		elif "link" in cl:
			b.theme_type_variation = "Link"
		elif "icon-btn" in cl:
			b.theme_type_variation = "IconBtn"
		elif "on" in cl or "sel" in cl:
			b.theme_type_variation = "BtnOn"
		else:
			b.theme_type_variation = "BtnGhost"
		if "big" in cl:
			b.add_theme_font_size_override("font_size", 22)
		if "small" in cl or "mini" in cl:
			b.add_theme_font_size_override("font_size", 14)
	if n.attrs.has("disabled"):
		b.disabled = true
	if n.attrs.has("aria-label") and b.tooltip_text == "":
		b.tooltip_text = n.attrs["aria-label"]
	var act := str(n.attrs.get("data-act", ""))
	b.pressed.connect(func(): doc.act(act, b))
	doc.buttons.append(b)
	return b


static func _ignore_mouse(c: Control) -> void:
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for k in c.get_children():
		if k is Control:
			_ignore_mouse(k)


static func _input(n: Dictionary, s: Dictionary, doc: Doc) -> Control:
	var type := str(n.attrs.get("type", "text"))
	if type == "checkbox":
		var cb := CheckBox.new()
		cb.button_pressed = n.attrs.has("checked")
		doc.inputs.append(cb)
		return cb
	var e := LineEdit.new()
	e.placeholder_text = str(n.attrs.get("placeholder", ""))
	e.text = str(n.attrs.get("value", ""))
	if n.attrs.has("maxlength"):
		e.max_length = int(n.attrs.maxlength)
	e.custom_minimum_size.x = 160
	e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var act := str(n.attrs.get("data-act", ""))
	e.text_submitted.connect(func(_t): doc.act(act if act != "" else "submit", e))
	doc.inputs.append(e)
	return e


static func _select(n: Dictionary, s: Dictionary, doc: Doc) -> Control:
	var o := OptionButton.new()
	for k in n.kids:
		if k is String or k.tag != "option":
			continue
		o.add_item(Html.plain_nodes(k.kids))
		o.set_item_metadata(o.item_count - 1, k.attrs.get("value", Html.plain_nodes(k.kids)))
		if k.attrs.has("selected"):
			o.select(o.item_count - 1)
	var act := str(n.attrs.get("data-act", ""))
	o.item_selected.connect(func(_i): doc.act(act if act != "" else "change", o))
	doc.inputs.append(o)
	return o
