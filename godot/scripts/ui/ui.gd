extends CanvasLayer
## Astro Outpost — the on-screen interface: top bar and meters, goals, banner, radio, prompts, hands, mini-game gauges,
## discovery cards, in-world tags and markers, the title screen and the pop-up cards. A port of js/ui.js and the
## interface parts of index.html (autoload "Ui"). The game's cards are HTML (see Html) rendered into Godot controls.

signal modal_closed

const RADIO_FROM := { "earth": "Mission Control · Earth", "crew": "🧑‍🚀 Crewmate · in the habitat" }
const METERS := [["air", "air", "Air", Style.AIR], ["food", "food", "Food", Style.FOOD], ["dose", "radiation", "Radiation", Style.DOSE],
	["filter", "filter", "Filter", Color("#8fe8d0")], ["water", "water", "Water", Color("#5aa8ff")], ["town", "", "Town", Color("#ffb84d")]]

var root: Control
var hud: Control
var goals: PanelContainer
var banner_box: PanelContainer
var radio: PanelContainer
var prompt_box: PanelContainer
var hands_box: PanelContainer
var rover_box: PanelContainer
var mini: PanelContainer
var inside: PanelContainer
var card_box: PanelContainer
var title: Control
var fade_rect: ColorRect
var modal_root: Control
var info_root: Control
var storm_rect: ColorRect
var tags_layer: Control
var toasts_layer: Control
var settings_menu: PanelContainer
var fatal_label: Label
var parts := {}

## callbacks the game sets
var title_actions := {}          # start, party, crew, how, science, journal
var settings_actions := {}       # view, pause, sound, read, journal, holo, info, map
var inside_actions := {}         # sun, fast, sleep, out
var on_meter := Callable()
var on_why := Callable()
var on_holo := Callable()
var on_goals_fold := Callable()

var modal_doc: Html.Doc
var info_doc: Html.Doc
var _modal_panel: PanelContainer
var _modal_scroll: ScrollContainer
var _page: Control = null                # a full page shown in place of the card (the star map)
var _info_panel: PanelContainer
var _info_scroll: ScrollContainer
var _meters := {}
var _hud := {}
var _goal := {}
var _radio := {}
var _prompt := {}
var _hands := {}
var _rover := {}
var _mini := {}
var _inside := {}
var _card := {}
var _tag_pool: Array = []
var _mark_pool: Array = []
var _set_items := {}
var _fade_want := 0.0
var _storm_want := 0.0
var _storm_mode := ""
var _banner_k := ""


func _ready() -> void:
	layer = 10
	root = Control.new()
	root.name = "UiRoot"
	root.theme = Style.theme()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	storm_rect = _storm_overlay()
	root.add_child(storm_rect)
	tags_layer = _layer("Tags")
	toasts_layer = _layer("Toasts")
	_build_hud()
	_build_goals()
	_build_banner()
	_build_radio()
	_build_prompt()
	_build_hands()
	_build_mini()
	_build_inside()
	_build_card()
	_build_title()
	fade_rect = ColorRect.new()
	fade_rect.color = Color("#04060e")
	fade_rect.modulate.a = 0
	fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(fade_rect)
	var mr := _overlay(Color(0.016, 0.024, 0.063, 0.6))
	modal_root = mr[0]
	_modal_panel = mr[1]
	_modal_scroll = mr[2]
	var ir := _overlay(Color(0.016, 0.024, 0.063, 0.6))
	info_root = ir[0]
	_info_panel = ir[1]
	_info_scroll = ir[2]
	fatal_label = Label.new()
	fatal_label.visible = false
	fatal_label.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	root.add_child(fatal_label)
	for k in ["hud", "goals", "banner", "radio", "prompt", "hands", "rover-hud", "mini", "inside", "card"]:
		show_part(k, false)
	get_viewport().size_changed.connect(_fit_modals)


func _layer(n: String) -> Control:
	var c := Control.new()
	c.name = n
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(c)
	return c


func show_part(id: String, on: bool) -> void:
	var c: Control = parts.get(id)
	if c:
		c.visible = on


func shown(id: String) -> bool:
	var c: Control = parts.get(id)
	return c != null and c.visible


func label(text: String, size: int = 16, color: Color = Style.INK, weight: int = 400, family: String = "lexend") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_font_override("font", Style.font(weight, family))
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func rich(bb: String, size: int = 16, color: Color = Style.INK) -> RichTextLabel:
	var l := RichTextLabel.new()
	l.bbcode_enabled = true
	l.fit_content = true
	l.scroll_active = false
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("normal_font_size", size)
	l.add_theme_font_size_override("bold_font_size", size)
	l.add_theme_color_override("default_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.text = bb
	return l


func panel(variation: String = "Chip") -> PanelContainer:
	var p := PanelContainer.new()
	p.theme_type_variation = variation
	return p


func bar(color: Color, h: int = 12) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.custom_minimum_size.y = h
	b.max_value = 100
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_theme_stylebox_override("fill", Style.box(color, h / 2.0 + 2, Color(0, 0, 0, 0), 0, Vector4.ZERO))
	b.add_theme_stylebox_override("background", Style.box(Color(1, 1, 1, 0.12), h / 2.0 + 2, Color(0, 0, 0, 0), 0, Vector4.ZERO))
	return b


static func icon_rect(name: String, px: int) -> TextureRect:
	var t := TextureRect.new()
	t.texture = load("res://assets/icons/" + name + ".svg")
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	t.custom_minimum_size = Vector2(px, px)
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return t


func _place(c: Control, preset: int, ofs: Vector4) -> void:
	c.set_anchors_preset(preset)
	c.offset_left = ofs.x
	c.offset_top = ofs.y
	c.offset_right = ofs.z
	c.offset_bottom = ofs.w


## keeps a panel centred horizontally on its anchor as it grows
func _center_x(c: Control) -> void:
	c.resized.connect(func():
		c.position.x = (root.size.x - c.size.x) / 2.0)


# ---------- top bar ----------
func _build_hud() -> void:
	hud = HBoxContainer.new()
	hud.add_theme_constant_override("separation", 10)
	_place(hud, Control.PRESET_TOP_WIDE, Vector4(12, 10, -12, 0))
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(hud)
	parts.hud = hud
	# the day: day number, the place, the shift bar (sun + storm window) and the time left
	var chip := panel("Chip")
	chip.custom_minimum_size.x = 170
	chip.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	chip.add_child(v)
	_hud.sol = rich("", 18)
	_hud.sol.autowrap_mode = TextServer.AUTOWRAP_OFF
	v.add_child(_hud.sol)
	_hud.site = label("", 13, Style.MUTED)
	v.add_child(_hud.site)
	var clock := Control.new()
	clock.custom_minimum_size = Vector2(140, 22)
	clock.draw.connect(_draw_clock.bind(clock))
	v.add_child(clock)
	_hud.clock = clock
	_hud.f = 0.0
	_hud.storm = Vector2(-1, 0)
	_hud.storm_now = false
	_hud.left = label("", 13, Style.MUTED)
	v.add_child(_hud.left)
	hud.add_child(chip)
	# the meters
	var meters := HBoxContainer.new()
	meters.add_theme_constant_override("separation", 8)
	meters.alignment = BoxContainer.ALIGNMENT_CENTER
	meters.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	meters.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	meters.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(meters)
	for m in METERS:
		var id: String = m[0]
		var p := panel("Chip")
		p.custom_minimum_size.x = 168 if id in ["air", "food", "dose"] else 124
		p.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		p.mouse_filter = Control.MOUSE_FILTER_STOP
		p.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		p.pivot_offset = Vector2(70, 30)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 7)
		p.add_child(row)
		if m[1] != "":
			row.add_child(icon_rect(m[1], 30))
		else:
			row.add_child(label("🏘️", 22))
		var body := VBoxContainer.new()
		body.add_theme_constant_override("separation", 1)
		body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(body)
		var top := HBoxContainer.new()
		top.add_child(label(m[2], 14, Style.INK, 600))
		var sp := Control.new()
		sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		top.add_child(sp)
		var val := label("0", 14, Style.INK, 700)
		top.add_child(val)
		body.add_child(top)
		var b := bar(m[3], 11)
		body.add_child(b)
		var note := label("", 11, Style.MUTED)
		note.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		note.clip_text = true
		note.custom_minimum_size.x = 60
		body.add_child(note)
		p.gui_input.connect(func(e):
			if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT and on_meter.is_valid():
				on_meter.call(id))
		meters.add_child(p)
		_meters[id] = { "el": p, "val": val, "bar": b, "note": note, "color": m[3], "last": null, "w": -1.0, "n": null, "low": null, "bad": null, "shown": true }
	(_meters.town.el as Control).visible = false
	# map and settings
	var right := HBoxContainer.new()
	right.add_theme_constant_override("separation", 8)
	right.alignment = BoxContainer.ALIGNMENT_BEGIN
	hud.add_child(right)
	var map_btn := _icon_button("🗺️", "Map (M)", func(): _call(settings_actions, "map"))
	right.add_child(map_btn)
	_hud.map = map_btn
	var set_btn := _icon_button("⚙️", "Settings", func(): settings_menu.visible = not settings_menu.visible)
	right.add_child(set_btn)
	settings_menu = panel("Chip")
	settings_menu.visible = false
	_place(settings_menu, Control.PRESET_TOP_RIGHT, Vector4(-282, 66, -12, 0))
	root.add_child(settings_menu)
	var sv := VBoxContainer.new()
	sv.add_theme_constant_override("separation", 2)
	settings_menu.add_child(sv)
	for it in [["view", "👁️", "Helmet view", "V", true], ["pause", "⏸", "Pause · day length", "P", false], ["sound", "🔊", "Sound", "", true],
			["read", "🗣️", "Read aloud", "", true], ["journal", "📓", "Field Journal", "J", false], ["holo", "💡", "Holo-tablet", "T", false], ["info", "❔", "Help", "H", false]]:
		var b2 := Button.new()
		b2.theme_type_variation = "Link"
		b2.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b2.text = "%s   %s%s" % [it[1], it[2], ("   [" + it[3] + "]") if it[3] != "" else ""]
		b2.add_theme_color_override("font_color", Style.INK)
		b2.custom_minimum_size = Vector2(240, 38)
		var key: String = it[0]
		b2.pressed.connect(func():
			if key != "sound" and key != "read" and key != "view":
				settings_menu.visible = false
			_call(settings_actions, key))
		sv.add_child(b2)
		_set_items[key] = { "btn": b2, "label": it[1] + "   " + it[2], "toggle": it[4], "key": it[3] }


func set_setting(key: String, on: bool) -> void:
	var s = _set_items.get(key)
	if s == null:
		return
	s.btn.text = "%s   %s%s" % [s.label, ("[" + s.key + "]  ") if s.key != "" else "", "● on" if on else "○ off"]


func _icon_button(text: String, tip: String, fn: Callable) -> Button:
	var b := Button.new()
	b.theme_type_variation = "IconBtn"
	if Html.ICONS.has(text):
		b.icon = load("res://assets/icons/" + Html.ICONS[text] + ".svg")
		b.expand_icon = true
		b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	else:
		b.text = text
		b.add_theme_font_size_override("font_size", 20)
	b.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	b.tooltip_text = tip
	b.custom_minimum_size = Vector2(44, 44)
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(fn)
	return b


func _call(d: Dictionary, key: String, arg = null) -> void:
	var fn = d.get(key)
	if fn is Callable and fn.is_valid():
		if arg != null:
			fn.call(arg)
		else:
			fn.call()


func _draw_clock(c: Control) -> void:
	var w := c.size.x
	var y := 7.0
	var h := 10.0
	c.draw_style_box(Style.box(Color(1, 1, 1, 0.14), 8, Color(0, 0, 0, 0), 0, Vector4.ZERO), Rect2(0, y, w, h))
	var f: float = _hud.f
	if f > 0:
		c.draw_style_box(Style.box(Color("#ffb347"), 8, Color(0, 0, 0, 0), 0, Vector4.ZERO), Rect2(0, y, maxf(8, w * f), h))
	var st: Vector2 = _hud.storm
	if st.x >= 0:
		var col := Style.DOSE
		if _hud.storm_now:
			col.a = 0.7 + 0.3 * sin(Time.get_ticks_msec() * 0.012)
		c.draw_style_box(Style.box(col, 8, Color(0, 0, 0, 0), 0, Vector4.ZERO), Rect2(w * st.x, y, maxf(4, w * st.y), h))
	var font := Style.font(400)
	c.draw_string(font, Vector2(w * f - 9, y + 13), "☀️", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)


func _pop(c: Control) -> void:
	c.pivot_offset = c.size / 2
	var tw := create_tween()
	tw.tween_property(c, "scale", Vector2(1.1, 1.1), 0.12)
	tw.tween_property(c, "scale", Vector2.ONE, 0.2)


func set_meter(id: String, value: float, low: bool, note: String, bad: bool) -> void:
	var m = _meters.get(id)
	if m == null:
		return
	var v := Js.mround(value)
	if m.last != v:
		if m.last != null and absi(v - int(m.last)) >= 3:
			var good: bool = (v < m.last) if id == "dose" else (v > m.last)
			(m.val as Label).add_theme_color_override("font_color", Style.OK if good else Color("#ff9aa8"))
			_pop(m.el)
			get_tree().create_timer(0.8).timeout.connect(func(): (m.val as Label).add_theme_color_override("font_color", Style.INK))
		m.last = v
		m.val.text = str(v) + ("%" if id == "dose" or id == "filter" else "")
	var w := clampf(value, 0, 100)
	if m.w != w:
		m.w = w
		create_tween().tween_property(m.bar, "value", w, 0.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	if m.low != low:
		if low and m.low == false and has_node("/root/Au"):
			get_node("/root/Au").play("low")
		m.low = low
		var p: PanelContainer = m.el
		if low:
			p.add_theme_stylebox_override("panel", Style.box(Style.PANEL, 16, Style.DANGER, 2, Vector4(14, 8, 14, 8)))
			(m.bar as ProgressBar).add_theme_stylebox_override("fill", Style.box(Style.DANGER, 7, Color(0, 0, 0, 0), 0, Vector4.ZERO))
		else:
			p.remove_theme_stylebox_override("panel")
			(m.bar as ProgressBar).add_theme_stylebox_override("fill", Style.box(m.color, 7, Color(0, 0, 0, 0), 0, Vector4.ZERO))
	if m.n != note:
		m.n = note
		m.note.text = note
		m.note.tooltip_text = note
	if m.bad != bad:
		m.bad = bad
		(m.note as Label).add_theme_color_override("font_color", Color("#ff9aa8") if bad else Style.MUTED)


## the top bar, every frame (each part only changes when what it shows changes)
func set_hud(s: Dictionary) -> void:
	var R: Dictionary = Data.RULES
	var lv: Dictionary = s.level
	var left := maxf(0, 1 - s.t / s.dayLength)
	var last: bool = s.sol >= s.totalSols
	var sol_text := "%s %d of %d" % [s.site.dayWord, s.sol, s.totalSols]
	if _hud.get("sol_k") != sol_text:
		_hud.sol_k = sol_text
		_hud.sol.text = "[font_size=12][color=%s]%s[/color][/font_size] [b]%d[/b] [font_size=13][color=%s]of %d[/color][/font_size]" % [Style.hx(Style.MUTED), s.site.dayWord.to_upper(), s.sol, Style.hx(Style.MUTED), s.totalSols]
		_hud.site.text = s.site.short + " · " + lv.name
	var stale: float = Sim.stale(s)
	var air_need: float = (Sim.air_drain(s) * stale + s.leak) * left
	var air_bad: bool = s.air < air_need
	var dinner: float = Sim.dinner(s)
	var dinner_bad: bool = not last and s.food < dinner
	var air_note := "leaking!" if s.leak > 0 else ("stale air: draining fast" if stale > 1 else ("not enough for today!" if air_bad else "enough for today"))
	set_meter("air", s.air, s.air < 18 or air_bad or s.leak > 0, air_note, air_bad or s.leak > 0 or stale > 1)
	set_meter("food", s.food, dinner_bad, "no dinner: launch day" if last else ("dinner needs %s!" % Js.num(dinner) if dinner_bad else "dinner tonight −%s" % Js.num(dinner)), dinner_bad)
	var secs := maxi(0, ceili(s.dayLength - s.t))
	var tl := "%d:%02d left" % [secs / 60, secs % 60]
	if _hud.get("tl") != tl:
		_hud.tl = tl
		_hud.left.text = tl
		_hud.left.add_theme_color_override("font_color", Style.DANGER if left < 0.15 else Style.MUTED)
	var d: float = s.dose
	var fl: float = s.filter
	var wt: float = s.water
	set_meter("dose", d, d >= 75, "almost full: stay indoors!" if d >= 90 else ("danger: shelter and shield" if d >= 75 else ("half full · never goes down" if d >= 50 else "home shield %d%%" % Js.mround(Sim.shield(s) * 100))), d >= 75)
	set_meter("filter", fl, fl < R.filterWarn, "full: air drains faster" if fl <= 0 else ("nearly full: bake it" if fl < R.filterWarn else ("soaking up CO₂" if fl < 60 else "clean")), fl < R.filterWarn)
	set_meter("water", wt, wt < R.waterWarn, "empty: plants stop" if wt < 1 else ("low: plants thirsty first" if wt < R.waterWarn else "crew and plants"), wt < R.waterWarn)
	var town = s.get("colony")
	var tm: Dictionary = _meters.town
	var live: bool = town != null and town.stage >= 2
	if tm.shown != live:
		tm.shown = live
		(tm.el as Control).visible = live
	if live:
		set_meter("town", town.spirit, town.spirit < R.spiritLow, str(town.people) + " people" + (" · helping" if town.spirit >= R.spiritHelp else (" · need food" if town.spirit < R.spiritLow else "")), town.spirit < R.spiritLow)
	var f := minf(1, s.t / s.dayLength)
	var st = s.storm
	var sk := Vector2(-1, 0)
	if st != null and st.warned:
		sk = Vector2(st.start / s.dayLength, (st.end - st.start) / s.dayLength)
	var now: bool = sk.x >= 0 and s.t >= st.start and s.t < st.end
	if absf(f - _hud.f) > 0.001 or sk != _hud.storm or now != _hud.storm_now or now:
		_hud.f = f
		_hud.storm = sk
		_hud.storm_now = now
		(_hud.clock as Control).queue_redraw()


# ---------- goals ----------
func _build_goals() -> void:
	goals = panel("Chip")
	_place(goals, Control.PRESET_TOP_LEFT, Vector4(12, 116, 292, 0))
	goals.custom_minimum_size.x = 280
	root.add_child(goals)
	parts.goals = goals
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 5)
	goals.add_child(v)
	var head := HBoxContainer.new()
	_goal.title = label("TODAY", 12, Style.POWER, 600)
	head.add_child(_goal.title)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	_goal.count = label("", 12, Style.MUTED, 600)
	head.add_child(_goal.count)
	var fold := Button.new()
	fold.theme_type_variation = "Link"
	fold.text = "◂"
	fold.focus_mode = Control.FOCUS_NONE
	fold.tooltip_text = "Fold the job list"
	fold.pressed.connect(func(): fold_goals(not _goal.get("folded", false)))
	head.add_child(fold)
	_goal.fold = fold
	v.add_child(head)
	_goal.prog = bar(Style.OK, 5)
	v.add_child(_goal.prog)
	_goal.list = rich("", 14, Color("#dfe5ff"))
	_goal.list.custom_minimum_size.x = 250
	v.add_child(_goal.list)
	_goal.key = ""
	_goal.items = []


func fold_goals(on: bool) -> void:
	_goal.folded = on
	_goal.fold.text = "▸" if on else "◂"
	goals.custom_minimum_size.x = 64 if on else 280
	goals.offset_right = goals.offset_left + goals.custom_minimum_size.x
	_goal.list.custom_minimum_size.x = 40 if on else 250
	_goal.title.visible = not on
	_goal.count.visible = not on
	_goal.key = ""
	set_goals(_goal.get("t", "Today"), _goal.items)
	if on_goals_fold.is_valid():
		on_goals_fold.call(on)


## list: [{ icon, text, done, now, optional }]. Must-do jobs first, then the bonus jobs.
func set_goals(t: String, list: Array) -> void:
	var key := t
	for g in list:
		key += "|" + str(g.get("icon", "")) + str(g.text) + str(g.get("done", false)) + str(g.get("now", false)) + str(g.get("optional", false))
	if key == _goal.key:
		return
	_goal.key = key
	_goal.t = t
	_goal.items = list
	_goal.title.text = t.to_upper()
	var must := list.filter(func(g): return not g.get("optional", false))
	var extra := list.filter(func(g): return g.get("optional", false))
	var done := must.filter(func(g): return g.get("done", false)).size()
	_goal.count.text = "%d/%d" % [done, must.size()]
	_goal.prog.value = 100.0 * done / must.size() if must.size() else 0.0
	var folded: bool = _goal.get("folded", false)
	var bb := ""
	var rows := must + extra
	for i in rows.size():
		var g: Dictionary = rows[i]
		if extra.size() and g == extra[0] and must.size() and not folded:
			bb += "[font_size=11][color=%s]BONUS JOBS[/color][/font_size]\n" % Style.hx(Style.MUTED)
		var icon := Html.bb_text(str(g.get("icon", "•")), 14)
		if folded:
			bb += ("[color=%s]✓[/color] " % Style.hx(Style.OK) if g.get("done") else "") + icon + "\n"
			continue
		var box := "[color=%s]✓[/color]" % Style.hx(Style.OK) if g.get("done") else ("[color=%s]▣[/color]" % Style.hx(Style.POWER) if g.get("now") else "[color=#8890aa]☐[/color]")
		var text := Html.bb_text(str(g.text), 14)
		if g.get("done"):
			text = "[s][color=%s]%s[/color][/s]" % [Style.hx(Style.MUTED), text]
		elif g.get("now"):
			text = "[b][color=#ffffff]%s[/color][/b]" % text
		elif g.get("optional"):
			text = "[color=#c8cfe8]%s[/color]" % text
		bb += box + " " + icon + " " + text + "\n"
	_goal.list.text = bb.strip_edges()


# ---------- banner, radio, prompt, hands ----------
func _build_banner() -> void:
	banner_box = panel("Pill")
	_place(banner_box, Control.PRESET_CENTER_TOP, Vector4(-200, 90, 200, 0))
	banner_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var l := label("", 17, Color("#2a1c00"), 700)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_box.add_child(l)
	banner_box.set_meta("label", l)
	root.add_child(banner_box)
	parts.banner = banner_box


func banner(text = null, cls: String = "") -> void:
	if text == null or text == "":
		if _banner_k != "":
			_banner_k = ""
			banner_box.visible = false
		return
	if _banner_k == str(text) + cls:
		return
	_banner_k = str(text) + cls
	banner_box.visible = true
	var l: Label = banner_box.get_meta("label")
	l.text = str(text)
	var bg := Style.POWER
	var fg := Color("#2a1c00")
	var border := Color(0, 0, 0, 0)
	if cls == "active":
		bg = Style.DANGER
		fg = Color.WHITE
	elif cls == "safe":
		bg = Style.OK
		fg = Color("#05301a")
	elif cls == "info":
		bg = Style.PANEL
		fg = Color.WHITE
		border = Style.LINE
	banner_box.add_theme_stylebox_override("panel", Style.shadowed(Style.box(bg, 999, border, 2 if cls == "info" else 0, Vector4(20, 9, 20, 9)), Color(0, 0, 0, 0.4), 12, Vector2(0, 6)))
	l.add_theme_color_override("font_color", fg)
	banner_box.set_meta("flash", cls == "active")
	banner_box.reset_size()
	banner_box.offset_left = -banner_box.get_combined_minimum_size().x / 2
	banner_box.offset_right = banner_box.get_combined_minimum_size().x / 2


func _build_radio() -> void:
	radio = panel("Chip")
	radio.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Style.PANEL, 22, Style.LINE, 2, Vector4(9, 9, 14, 9)), Color(0, 0, 0, 0.4), 14, Vector2(0, 10)))
	_place(radio, Control.PRESET_BOTTOM_LEFT, Vector4(12, -14, 460, -14))
	radio.grow_vertical = Control.GROW_DIRECTION_BEGIN
	root.add_child(radio)
	parts.radio = radio
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	radio.add_child(row)
	var badge := _icon_button("📡", "Wrist tablet: show me why (T)", func(): if on_why.is_valid(): on_why.call())
	row.add_child(badge)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 1)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(v)
	_radio.from = label(RADIO_FROM.earth.to_upper(), 10, Style.AIR, 700)
	v.add_child(_radio.from)
	_radio.text = rich("", 15)
	_radio.text.custom_minimum_size.x = 280
	v.add_child(_radio.text)
	var why := Button.new()
	why.text = "▶ Why?  T"
	why.theme_type_variation = "BtnGhost"
	why.focus_mode = Control.FOCUS_NONE
	why.add_theme_font_size_override("font_size", 13)
	why.pressed.connect(func(): if on_why.is_valid(): on_why.call())
	why.visible = false
	why.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(why)
	_radio.why = why
	_radio.last = ""


## vid: the recorded voice line for these words (a list plays one after the other); without one, read-aloud speaks them
func say(text: String, vid = null, why: bool = false, from: String = "earth") -> void:
	from = "crew" if from == "crew" else "earth"
	if text == "" or text + from == _radio.last:
		return
	_radio.last = text + from
	radio.visible = true
	_radio.why.visible = why
	_radio.from.text = RADIO_FROM[from].to_upper()
	_radio.from.add_theme_color_override("font_color", Color("#9ee6a0") if from == "crew" else Style.AIR)
	_radio.text.text = Html.bb_text(text, 15)
	_pop(radio)
	var au = get_node_or_null("/root/Au")
	if au and not au.line(vid, { "plain": true } if from == "crew" else {}):
		au.speak(text)


func radio_shown() -> bool:
	return radio.visible


func _build_prompt() -> void:
	prompt_box = panel("Pill")
	_place(prompt_box, Control.PRESET_CENTER_BOTTOM, Vector4(-150, -100, 150, -100))
	prompt_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	root.add_child(prompt_box)
	parts.prompt = prompt_box
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	prompt_box.add_child(row)
	var k := label("E", 15, Color("#2a1c00"), 700)
	k.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	k.custom_minimum_size = Vector2(30, 30)
	k.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var kp := PanelContainer.new()
	kp.add_theme_stylebox_override("panel", Style.box(Style.POWER, 8, Color(0, 0, 0, 0), 0, Vector4(6, 0, 6, 0)))
	kp.add_child(k)
	row.add_child(kp)
	_prompt.kbox = kp
	_prompt.key = k
	_prompt.text = label("", 17, Style.INK, 600)
	row.add_child(_prompt.text)
	_prompt.k = null


func prompt(text = null, key: String = "E", info: bool = false) -> void:
	var k = (str(text) + key + str(info)) if text else null
	if k == _prompt.k:
		return
	_prompt.k = k
	if not text:
		prompt_box.visible = false
		return
	prompt_box.visible = true
	_prompt.kbox.visible = not info
	_prompt.key.text = key if key != "" else "E"
	_prompt.text.text = str(text)
	_prompt.text.add_theme_color_override("font_color", Style.MUTED if info else Style.INK)
	prompt_box.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Style.PANEL, 999, Style.LINE if info else Style.POWER, 2, Vector4(9, 8, 18, 8)), Color(0, 0, 0, 0.45), 12, Vector2(0, 8)))
	prompt_box.reset_size()
	var w := prompt_box.get_combined_minimum_size().x
	prompt_box.offset_left = -w / 2
	prompt_box.offset_right = w / 2


func _build_hands() -> void:
	for which in ["hands", "rover-hud"]:
		var p := panel("Chip")
		p.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Style.PANEL, 18, Style.LINE, 2, Vector4(11, 8, 16, 9)), Color(0, 0, 0, 0.4), 12, Vector2(0, 8)))
		_place(p, Control.PRESET_CENTER_BOTTOM, Vector4(-130, -18, 130, -18))
		p.grow_vertical = Control.GROW_DIRECTION_BEGIN
		p.grow_horizontal = Control.GROW_DIRECTION_BOTH
		root.add_child(p)
		parts[which] = p
		var row := HBoxContainer.new()
		p.add_child(row)
		var ic := rich("", 28)
		ic.autowrap_mode = TextServer.AUTOWRAP_OFF
		ic.custom_minimum_size = Vector2(40, 36)
		row.add_child(ic)
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", 1)
		row.add_child(v)
		var nm := label("", 15, Style.INK, 700)
		v.add_child(nm)
		var hint := label("", 12, Style.MUTED)
		v.add_child(hint)
		var pw := bar(Style.POWER, 8)
		pw.custom_minimum_size.x = 170
		v.add_child(pw)
		var d := { "icon": ic, "name": nm, "hint": hint, "power": pw, "k": null }
		if which == "hands":
			_hands = d
		else:
			_rover = d
			ic.text = Html.bb_text("🚙", 28)
			hint.visible = false


func hands(item = null, power: float = 0.0, hint: String = "") -> void:
	if item == null:
		if _hands.k != null:
			_hands.k = null
			parts.hands.visible = false
		return
	var def: Dictionary = Data.ITEMS[item.type]
	var k: String = item.type + hint
	if k != _hands.k:
		_hands.k = k
		parts.hands.visible = true
		_hands.icon.text = Html.bb_text(def.icon, 28)
		var nm: String = item.data.name if item.data is Dictionary and item.data.has("name") else def.name
		_hands.name.text = nm.capitalize() if nm.length() < 3 else nm[0].to_upper() + nm.substr(1)
		_hands.hint.text = hint
	_hands.power.value = power * 100


func rover_hud(charge: float, on: bool, cap: float = 0.0) -> void:
	parts["rover-hud"].visible = on
	if not on:
		return
	_rover.name.text = ("Rover battery · %d s" % ceili(charge)) if charge > 0 else "Battery empty — crawling!"
	_rover.power.value = minf(1, charge / (cap if cap > 0 else float(Data.RULES.roverMax))) * 100


# ---------- mini-games ----------
func _build_mini() -> void:
	mini = panel("Chip")
	mini.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Style.PANEL, 22, Style.POWER, 2, Vector4(18, 14, 18, 14)), Color(0, 0, 0, 0.5), 16, Vector2(0, 12)))
	mini.anchor_left = 0.5
	mini.anchor_right = 0.5
	mini.anchor_top = 0.56
	mini.anchor_bottom = 0.56
	mini.offset_left = -190
	mini.offset_right = 190
	root.add_child(mini)
	parts.mini = mini
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	mini.add_child(v)
	_mini.title = label("Drilling", 18, Style.INK, 700)
	_mini.title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_mini.title)
	var gauge := Control.new()
	gauge.custom_minimum_size = Vector2(340, 58)
	gauge.draw.connect(_draw_drill.bind(gauge))
	v.add_child(gauge)
	_mini.gauge = gauge
	var dial := Control.new()
	dial.custom_minimum_size = Vector2(340, 34)
	dial.draw.connect(_draw_dial.bind(dial))
	v.add_child(dial)
	_mini.dial = dial
	for r in [["depth", "Depth", Style.OK], ["heat", "Heat", Color("#ff8a5a")], ["slip", "Slip", Color("#ff7a5a")]]:
		var row := HBoxContainer.new()
		var l := label(r[1], 13, Style.MUTED)
		l.custom_minimum_size.x = 54
		row.add_child(l)
		var b := bar(r[2], 16)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(b)
		v.add_child(row)
		_mini[r[0]] = b
		_mini[r[0] + "_row"] = row
	var pips := HBoxContainer.new()
	pips.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(pips)
	_mini.pips = pips
	_mini.hint = label("", 14, Color("#dfe5ff"))
	_mini.hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_mini.hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_mini.hint.custom_minimum_size.x = 340
	v.add_child(_mini.hint)
	_mini.m = null
	_mini.kind = ""


static func _heat_colour(h: float) -> Color:
	var t := clampf(h, 0, 1)
	if t < 0.5:
		return Color.WHITE.lerp(Color("#ffd23f"), t * 2)
	return Color("#ffd23f").lerp(Color("#ff5468"), (t - 0.5) * 2)


func _draw_drill(c: Control) -> void:
	var m = _mini.m
	if m == null or _mini.kind != "drill":
		return
	var w := c.size.x
	var h := c.size.y
	# the ground in layers, scrolling while the bit bites
	var off := fmod(Time.get_ticks_msec() * 0.06, 14.0) if m.on else 0.0
	c.draw_style_box(Style.box(Color("#5a3a2a"), 12, Style.DANGER if not m.inside else Color(0, 0, 0, 0), 2 if not m.inside else 0, Vector4.ZERO), Rect2(0, 0, w, h))
	var y := -off
	var k := 0
	while y < h:
		c.draw_rect(Rect2(4, maxf(2, y), w - 8, 5), Color(0.55, 0.36, 0.25, 0.5) if k % 2 else Color(0.42, 0.27, 0.19, 0.5))
		y += 7
		k += 1
	var zx: float = (3 + (m.zc - m.zw + 1) * 47) / 100.0 * w
	var zw: float = m.zw * 94 / 100.0 * w
	var zc := Style.OK
	zc.a = 0.35 + (0.25 * sin(Time.get_ticks_msec() * 0.015) if not m.inside else 0.0)
	c.draw_rect(Rect2(zx, 0, zw, h), zc)
	var font := Style.font(400)
	c.draw_string(font, Vector2(zx + zw / 2 - 9, h - 6), str(m.icon), HORIZONTAL_ALIGNMENT_LEFT, -1, 15)
	var bx: float = (3 + (m.x + 1) * 47) / 100.0 * w
	if m.on:
		bx += (randf() - 0.5) * (2 + m.heat * 5)
	var col := _heat_colour(m.heat)
	c.draw_rect(Rect2(bx - 4, 0, 8, h - 23), col)
	c.draw_colored_polygon(PackedVector2Array([Vector2(bx - 7, h - 23), Vector2(bx + 7, h - 23), Vector2(bx, h - 13)]), col)
	if m.bumpWarn > 0:
		var tx := clampf(bx + m.bumpDir * w * 0.1, w * 0.08, w * 0.92)
		c.draw_string(font, Vector2(tx - 12, 18), "⚡▶" if m.bumpDir > 0 else "◀⚡", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Style.POWER)
	if m.flash > 0:
		c.draw_rect(Rect2(0, 0, w, h), Color(1, 1, 1, 0.25))


func _draw_dial(c: Control) -> void:
	var m = _mini.m
	if m == null or _mini.kind != "dial":
		return
	var w := c.size.x
	var h := c.size.y
	c.draw_style_box(Style.box(Color(1, 1, 1, 0.12), 12, Color(0, 0, 0, 0), 0, Vector4.ZERO), Rect2(0, 0, w, h))
	c.draw_rect(Rect2((m.c - m.w / 2) * w, 0, m.w * w, h), Color(Style.OK, 0.45))
	c.draw_rect(Rect2(m.needle * w - 3, 0, 6, h), Color.WHITE)


func drill_ui(m = null) -> void:
	if m == null:
		mini.visible = false
		_mini.m = null
		return
	mini.visible = true
	_mini.m = m
	_mini.kind = "drill"
	_mini.gauge.visible = true
	_mini.dial.visible = false
	_mini.pips.visible = false
	_mini.depth_row.visible = true
	_mini.heat_row.visible = true
	_mini.slip_row.visible = true
	_mini.title.text = m.title
	_mini.hint.text = m.hint
	_mini.hint.add_theme_color_override("font_color", Color("#ff8e9c") if not m.inside else Color("#dfe5ff"))
	_mini.depth.value = minf(1, m.depth) * 100
	_mini.heat.value = minf(1, m.heat) * 100
	_mini.slip.value = minf(1, m.slip) * 100
	_mini.gauge.queue_redraw()


func dial_ui(m = null) -> void:
	if m == null:
		mini.visible = false
		_mini.m = null
		return
	mini.visible = true
	_mini.m = m
	_mini.kind = "dial"
	_mini.gauge.visible = false
	_mini.dial.visible = true
	_mini.pips.visible = true
	_mini.depth_row.visible = false
	_mini.heat_row.visible = false
	_mini.slip_row.visible = false
	_mini.title.text = m.title
	_mini.hint.text = m.hint
	_mini.hint.add_theme_color_override("font_color", Color("#dfe5ff"))
	var key := "%d/%d" % [m.hits, m.need]
	if _mini.pips.get_meta("k", "") != key:
		_mini.pips.set_meta("k", key)
		for k in _mini.pips.get_children():
			k.queue_free()
		for i in m.need:
			var p := Panel.new()
			p.custom_minimum_size = Vector2(18, 18)
			p.add_theme_stylebox_override("panel", Style.box(Style.OK if i < m.hits else Color(0, 0, 0, 0), 9, Color(1, 1, 1, 0.4), 0 if i < m.hits else 2, Vector4.ZERO))
			_mini.pips.add_child(p)
	_mini.dial.queue_redraw()


# ---------- inside the habitat ----------
func _build_inside() -> void:
	inside = panel("Chip")
	inside.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Style.PANEL, 24, Style.LINE, 2, Vector4(14, 12, 14, 14)), Color(0, 0, 0, 0.5), 16, Vector2(0, 12)))
	_place(inside, Control.PRESET_BOTTOM_RIGHT, Vector4(-330, -200, -14, -16))
	inside.grow_vertical = Control.GROW_DIRECTION_BEGIN
	inside.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	root.add_child(inside)
	parts.inside = inside
	var v := VBoxContainer.new()
	inside.add_child(v)
	_inside.title = label("🏠 Inside the habitat", 16, Style.INK, 700)
	v.add_child(_inside.title)
	_inside.text = rich("Safe and cosy.", 13, Color("#dfe5ff"))
	_inside.text.custom_minimum_size.x = 290
	v.add_child(_inside.text)
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 7)
	g.add_theme_constant_override("v_separation", 7)
	v.add_child(g)
	for b in [["sun", "☀️ Sun Watch"], ["fast", "⏩ Fast-forward"], ["sleep", "😴 End the day"]]:
		var bt := Button.new()
		bt.text = b[1]
		bt.theme_type_variation = "BtnGhost"
		bt.add_theme_font_size_override("font_size", 14)
		bt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var key: String = b[0]
		bt.pressed.connect(func(): _call(inside_actions, key))
		g.add_child(bt)
		_inside[key] = bt
	var out := Button.new()
	out.text = "🧑‍🚀 Go outside"
	out.theme_type_variation = "BtnPrimary"
	out.add_theme_font_size_override("font_size", 14)
	out.pressed.connect(func(): _call(inside_actions, "out"))
	v.add_child(out)
	_inside.out = out


func set_inside(t: String, text: String) -> void:
	_inside.title.text = t
	_inside.text.text = Html.bb_text(text, 13)


func inside_button(id: String) -> Button:
	return _inside.get(id)


# ---------- discovery cards (they do not pause the game) ----------
var _card_q: Array = []
var _card_on := false
var _card_left := 0.0
var _card_now = null


func _build_card() -> void:
	card_box = panel("Card")
	_place(card_box, Control.PRESET_TOP_RIGHT, Vector4(-366, 78, -12, 0))
	card_box.mouse_filter = Control.MOUSE_FILTER_STOP
	card_box.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	root.add_child(card_box)
	parts.card = card_box
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card_box.add_child(row)
	_card.icon = rich("", 32)
	_card.icon.autowrap_mode = TextServer.AUTOWRAP_OFF
	_card.icon.custom_minimum_size = Vector2(44, 40)
	row.add_child(_card.icon)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(v)
	_card.kicker = label("", 11, Style.AIR, 700)
	v.add_child(_card.kicker)
	_card.title = label("", 17, Style.INK, 700)
	_card.title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_card.title.custom_minimum_size.x = 270
	v.add_child(_card.title)
	_card.text = rich("", 14, Color("#e6ebff"))
	_card.text.custom_minimum_size.x = 270
	v.add_child(_card.text)
	_card.src = label("", 11, Style.MUTED)
	_card.src.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_card.src.custom_minimum_size.x = 270
	v.add_child(_card.src)
	card_box.gui_input.connect(func(e):
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			var f = _card_now
			next_card()
			if f and str(f.get("holo", "")) != "" and on_holo.is_valid():
				on_holo.call(f.holo))


func next_card() -> void:
	_card_on = false
	_card_left = 0
	_card_now = null
	if _card_q.is_empty():
		card_box.visible = false
		return
	var f: Dictionary = _card_q.pop_front()
	var src = Data.SOURCES.get(f.get("src", ""), null)
	var kind: String = f.get("kind", "")
	var why := kind == "why"
	card_box.visible = true
	var border := Style.AIR
	if kind == "conseq":
		border = { "good": Style.OK, "bad": Style.DANGER }.get(f.get("tone", "mixed"), Style.POWER)
	elif why:
		border = Style.POWER
	card_box.add_theme_stylebox_override("panel", Style.shadowed(Style.box(Color("#1d2c5e"), 20, border, 2, Vector4(14, 12, 14, 12)), Color(0, 0, 0, 0.55), 20, Vector2(0, 10)))
	_card.icon.text = Html.bb_text(str(f.get("icon", "🧪")), 32)
	var kick := ""
	if kind == "conseq":
		kick = "What your choice led to"
	elif why:
		kick = "Why did that happen?" + (" · 📓 new page" if f.get("fresh") else "")
	elif kind == "core":
		kick = "Discovery at " + str(f.get("place", ""))
	elif kind == "inst":
		kick = "Instrument online"
	elif kind == "meteor":
		kick = "A rock from space"
	else:
		kick = "Postcard"
	_card.kicker.text = kick.to_upper()
	_card.title.text = str(f.title)
	_card.text.text = Html.bb_text(str(f.text) + ((" " + str(f.perk)) if f.get("perk") else ""), 14)
	if why and str(f.get("holo", "")) != "":
		_card.src.text = "▶ Click, or press T, to see how it works"
	elif src:
		_card.src.text = "Source: " + str(src.name)
	elif kind == "conseq":
		_card.src.text = "Click to close"
	else:
		_card.src.text = ""
	var au = get_node_or_null("/root/Au")
	if au:
		au.speak(str(f.text) if kind == "conseq" else str(f.title) + ". " + str(f.text))
	_card_on = true
	_card_now = f
	_card_left = 14.0 if kind == "conseq" else (13.0 if why else 11.0)
	card_box.modulate.a = 0
	create_tween().tween_property(card_box, "modulate:a", 1.0, 0.25)


func card(f: Dictionary) -> void:
	_card_q.append(f)
	if not _card_on:
		next_card()


func clear_cards() -> void:
	_card_q = []
	_card_on = false
	_card_left = 0
	_card_now = null
	card_box.visible = false


## the card's time on screen is counted in game time, so a card is never used up behind a pause
func tick_cards(dt: float) -> void:
	if _card_on:
		_card_left -= dt
		if _card_left <= 0:
			next_card()


func card_now():
	return _card_now if _card_on else null


# ---------- in-world tags and waypoint markers ----------
## list: [{ text, x, y, cls }]
func tags(list: Array) -> void:
	var i := 0
	for t in list:
		if i >= _tag_pool.size():
			var p := panel("Chip")
			p.add_theme_stylebox_override("panel", Style.box(Style.PANEL, 12, Style.LINE, 2, Vector4(9, 4, 9, 4)))
			p.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var l := rich("", 13)
			l.autowrap_mode = TextServer.AUTOWRAP_OFF
			p.add_child(l)
			tags_layer.add_child(p)
			_tag_pool.append({ "el": p, "label": l, "k": "" })
		var pd: Dictionary = _tag_pool[i]
		var k := str(t.text) + "|" + str(t.get("cls", ""))
		if pd.k != k:
			pd.k = k
			pd.label.text = "[b]" + Html.bb_text(str(t.text), 13) + "[/b]"
			var cls: String = t.get("cls", "")
			pd.el.add_theme_stylebox_override("panel", Style.box(Style.PANEL, 12, Style.POWER if cls == "warn" else (Style.DANGER if cls == "bad" else Style.LINE), 2, Vector4(9, 4, 9, 4)))
			pd.el.reset_size()
		var el: Control = pd.el
		el.visible = true
		var sz := el.get_combined_minimum_size()
		el.size = sz
		el.position = Vector2(round(t.x - sz.x / 2), round(t.y - sz.y))
		i += 1
	for j in range(i, _tag_pool.size()):
		_tag_pool[j].el.visible = false


## list: [{ icon, label, x, y, cls, color }]
func marks(list: Array) -> void:
	var i := 0
	for m in list:
		if i >= _mark_pool.size():
			var v := VBoxContainer.new()
			v.add_theme_constant_override("separation", 1)
			v.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var disc := PanelContainer.new()
			disc.custom_minimum_size = Vector2(34, 34)
			disc.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			disc.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var ic := rich("", 16)
			ic.autowrap_mode = TextServer.AUTOWRAP_OFF
			ic.custom_minimum_size = Vector2(26, 22)
			disc.add_child(ic)
			v.add_child(disc)
			var lb := label("", 12, Style.INK, 600)
			lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lb.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
			lb.add_theme_constant_override("outline_size", 5)
			v.add_child(lb)
			tags_layer.add_child(v)
			_mark_pool.append({ "el": v, "disc": disc, "icon": ic, "label": lb, "k": "" })
		var pd: Dictionary = _mark_pool[i]
		var cls: String = m.get("cls", "")
		var col: Color = Color.from_string(str(m.get("color", "#ffffff")), Color.WHITE) if m.get("color") is String else (m.get("color") if m.get("color") is Color else Color.WHITE)
		var k := str(m.icon) + "|" + str(m.get("label", "")) + "|" + cls + "|" + str(col)
		if pd.k != k:
			pd.k = k
			var small := cls.find("small") >= 0
			var ring := Style.POWER if cls.find("goal") >= 0 else (Style.DANGER if cls.find("alarm") >= 0 else col)
			var px := 24 if small else 34
			pd.disc.custom_minimum_size = Vector2(px, px)
			pd.disc.add_theme_stylebox_override("panel", Style.box(Style.PANEL, 999, ring, 3 if (cls.find("goal") >= 0 or cls.find("alarm") >= 0) else 2, Vector4(4, 4, 4, 4)))
			pd.icon.text = "[center]" + Html.bb_text(str(m.icon), 12 if small else 15) + "[/center]"
			pd.label.text = str(m.get("label", ""))
			pd.label.visible = not small and str(m.get("label", "")) != ""
			pd.el.modulate.a = 0.85 if small else 1.0
			pd.el.reset_size()
		var el: Control = pd.el
		el.visible = true
		var sz := el.get_combined_minimum_size()
		el.size = sz
		var pulse := 1.0
		if cls.find("goal") >= 0 or cls.find("alarm") >= 0:
			pulse = 1.0 + 0.08 * sin(Time.get_ticks_msec() * (0.016 if cls.find("alarm") >= 0 else 0.006))
		el.scale = Vector2(pulse, pulse)
		el.pivot_offset = Vector2(sz.x / 2, 17)
		el.position = Vector2(round(m.x - sz.x / 2), round(m.y - 17))
		i += 1
	for j in range(i, _mark_pool.size()):
		_mark_pool[j].el.visible = false


func _storm_overlay() -> ColorRect:
	var r := ColorRect.new()
	r.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """
shader_type canvas_item;
uniform float amount = 0.0;
void fragment() {
	vec2 d = (UV - 0.5) * vec2(1.6, 1.0);
	float k = smoothstep(0.32, 0.85, length(d));
	COLOR = vec4(1.0, 0.16, 0.6, k * 0.55 * amount);
}
"""
	var m := ShaderMaterial.new()
	m.shader = sh
	r.material = m
	return r


## '' none, 'warn', 'active' (pulsing), 'inside'
func storm_fx(mode: String) -> void:
	_storm_mode = mode
	_storm_want = { "warn": 0.4, "active": 1.0, "inside": 0.35 }.get(mode, 0.0)


## floating "+12 💨" pills over the world
func toast(text: String, x: float, y: float, color = "#ffffff") -> void:
	var col: Color = Color.from_string(color, Color.WHITE) if color is String else color
	var l := rich("[b]" + Html.bb_text(text, 24) + "[/b]", 24, col)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	l.add_theme_constant_override("outline_size", 6)
	toasts_layer.add_child(l)
	l.reset_size()
	var sz := l.get_combined_minimum_size()
	l.size = Vector2(maxf(sz.x, 40), maxf(sz.y, 30))
	l.position = Vector2(x - l.size.x / 2, y - l.size.y / 2)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(l, "position:y", l.position.y - 60, 1.3).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, 1.3).set_delay(0.5)
	tw.chain().tween_callback(l.queue_free)


# ---------- text helpers shared by the cards ----------
func data_tag(s: Dictionary) -> String:
	return "<span class=\"tagline\">Live NASA data</span>" if s.weatherSource == "live" else "<span class=\"tagline archive\">NASA archive</span>"


func storm_words(level: int) -> String:
	return "A BIG solar storm" if level >= 3 else ("A medium solar storm" if level == 2 else "A small solar storm")


func weather_row(s: Dictionary, w, known: bool, when: String) -> String:
	if not known:
		return "<div class=\"info-row\"><span class=\"ic\">❓</span><div><b>No space-weather forecast</b><p>The Radio Dish was off, so Earth could not send a forecast. Your suit's small sensor only gives a few seconds of warning.</p></div></div>"
	var story := Html.esc(Weather.describe(w, s.site.id).text) if s.site.planet == s.site.id else ""      # the story is told for the Moon or Mars
	if w == null or int(w.level) == 0:
		return "<div class=\"info-row good\"><span class=\"ic\">😎</span><div><b>No radiation storm " + when + "</b><p>" + data_tag(s) + story + "</p></div></div>"
	return "<div class=\"info-row alert\"><span class=\"ic\">🌩️</span><div><b>" + storm_words(int(w.level)) + " " + when + "!</b><p>" + data_tag(s) + story + " Soil bags on the dome help — and do not get caught far from home!</p></div></div>"


func find_row(f: Dictionary) -> String:
	return "<div class=\"find\"><em>" + str(f.get("icon", "🧪")) + "</em><div><b>" + Html.esc(f.title) + "</b><span>" + Html.esc(f.text) + "</span></div></div>"


# ---------- the title screen ----------
func _build_title() -> void:
	title = Control.new()
	title.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(title)
	parts.title = title
	var shade := ColorRect.new()
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = "shader_type canvas_item;\nvoid fragment() { float k = smoothstep(0.1, 0.75, length((UV - vec2(0.5, 0.4)) * vec2(1.3, 1.0))); COLOR = vec4(0.024, 0.035, 0.078, mix(0.1, 0.72, k)); }"
	var sm := ShaderMaterial.new()
	sm.shader = sh
	shade.material = sm
	title.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title.add_child(center)
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 10)
	v.custom_minimum_size.x = 640
	center.add_child(v)
	var kick := label("JUNIOR ASTRONAUT MISSION TRAINER", 14, Style.POWER, 600)
	kick.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(kick)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", -34)
	v.add_child(words)
	for w in [["Astro", Style.INK], ["Outpost", Style.POWER]]:
		var h := label(w[0], 96, w[1], 700, "exo2")
		h.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		h.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.45))
		h.add_theme_constant_override("shadow_offset_y", 6)
		words.add_child(h)
	var tag := label("Be the astronaut. Carry power, mine ice, shield your home, drive the rover — and dodge real solar storms.", 18, Style.INK)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tag.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tag.custom_minimum_size.x = 560
	tag.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	v.add_child(tag)
	var gap := Control.new()
	gap.custom_minimum_size.y = 12
	v.add_child(gap)
	for b in [["start", "▶ Start mission", "BtnPrimary"], ["party", "🎉 Party games", "BtnGhost"], ["crew", "🧑‍🚀 Play with friends", "BtnGhost"]]:
		var bt := Button.new()
		bt.text = b[1]
		bt.theme_type_variation = b[2]
		bt.add_theme_font_size_override("font_size", 22)
		bt.custom_minimum_size = Vector2(300, 58)
		bt.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		var key: String = b[0]
		bt.pressed.connect(func(): _call(title_actions, key))
		v.add_child(bt)
		parts["title-" + key] = bt
	var links := HBoxContainer.new()
	links.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(links)
	for b in [["how", "How to play"], ["science", "The real science"], ["journal", "📓 Field Journal"]]:
		var bt := Button.new()
		bt.text = b[1]
		bt.theme_type_variation = "Link"
		var key: String = b[0]
		bt.pressed.connect(func(): _call(title_actions, key))
		links.add_child(bt)


func focus_title() -> void:
	var b: Button = parts.get("title-start")
	if b and b.is_visible_in_tree():
		b.grab_focus()


# ---------- pop-up cards ----------
func _overlay(dim: Color) -> Array:
	var r := Control.new()
	r.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	r.visible = false
	r.mouse_filter = Control.MOUSE_FILTER_STOP
	root.add_child(r)
	var bg := ColorRect.new()
	bg.color = dim
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_child(bg)
	r.set_meta("bg", bg)
	var c := CenterContainer.new()
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_child(c)
	var p := PanelContainer.new()
	p.theme_type_variation = "Modal"
	c.add_child(p)
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	p.add_child(sc)
	return [r, p, sc]


func _fit_modals() -> void:
	for pair in [[modal_root, _modal_panel, _modal_scroll], [info_root, _info_panel, _info_scroll]]:
		var r: Control = pair[0]
		if not r.visible:
			continue
		var sc: ScrollContainer = pair[2]
		if sc.get_child_count() == 0:
			continue
		var content: Control = sc.get_child(0)
		var vs := root.size
		var w: float = pair[1].get_meta("w", 640.0)
		w = minf(w, vs.x - 28 - 48)
		content.custom_minimum_size.x = w
		var h := content.get_combined_minimum_size().y
		sc.custom_minimum_size = Vector2(w, minf(h, vs.y - 28 - 42))


## Opens a card: html, opts { cls ('wide', 'crisis'), actions {act: fn(el)}, noFocus, line (a voice line), speak (read aloud) }.
## Returns the card's Doc.
func modal(html: String, opts: Dictionary = {}) -> Html.Doc:
	var doc := Html.render(html, opts.get("actions", {}))
	modal_doc = doc
	_drop_page()
	_open(modal_root, _modal_panel, _modal_scroll, doc, str(opts.get("cls", "")))
	if not opts.get("noFocus", false):
		var first := doc.first_button()
		if first:
			first.call_deferred("grab_focus")
	var au = get_node_or_null("/root/Au")
	if au:
		var spoke := false
		if opts.get("line") and not au.reading_on():
			spoke = au.line(opts.line)
		if not spoke and opts.get("speak"):
			au.speak(opts.speak)
	return doc


func _open(r: Control, p: PanelContainer, sc: ScrollContainer, doc: Html.Doc, cls: String) -> void:
	var keep_scroll := sc.scroll_vertical if r.visible else 0
	for k in sc.get_children():
		sc.remove_child(k)
		k.queue_free()
	sc.add_child(doc.root)
	p.theme_type_variation = "ModalCrisis" if cls.find("crisis") >= 0 else "Modal"
	p.set_meta("w", 780.0 if cls.find("wide") >= 0 else 640.0)
	(r.get_meta("bg") as ColorRect).color = Color(0.23, 0.02, 0.06, 0.72) if cls.find("crisis") >= 0 else Color(0.016, 0.024, 0.063, 0.6)
	var was := r.visible
	r.visible = true
	_fit_modals()
	doc.root.minimum_size_changed.connect(_fit_modals)
	if was:
		sc.set_deferred("scroll_vertical", keep_scroll)
	else:
		p.pivot_offset = p.size / 2
		p.scale = Vector2(0.94, 0.94)
		p.modulate.a = 0
		var tw := create_tween().set_parallel(true)
		tw.tween_property(p, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_property(p, "modulate:a", 1.0, 0.18)
	call_deferred("_fit_modals")


## A full page in place of the card (the star map). The game treats it like any open card: it waits, and the pointer
## is free. Opening a card, or close_modal(), takes the page away.
func modal_page(page: Control) -> void:
	_drop_page()
	for k in _modal_scroll.get_children():
		k.queue_free()
	modal_doc = null
	_page = page
	_modal_panel.visible = false
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	modal_root.add_child(page)
	modal_root.visible = true


func _drop_page() -> void:
	if _page:
		_page.queue_free()
		_page = null
		_modal_panel.visible = true


func close_modal() -> void:
	if not modal_root.visible:
		return
	_drop_page()
	modal_root.visible = false
	for k in _modal_scroll.get_children():
		k.queue_free()
	modal_doc = null
	modal_closed.emit()


func modal_open() -> bool:
	return modal_root.visible


## a card on top of anything, with a "Got it" button (help pages, science, the journal's pages)
func info(html: String, on_close: Callable = Callable()) -> Html.Doc:
	var doc := Html.render(html + "<div class=\"modal-actions\"><button class=\"btn primary\" data-act=\"info-close\">Got it</button></div>", {})
	doc.on("info-close", func():
		close_info()
		if on_close.is_valid():
			on_close.call())
	info_doc = doc
	_open(info_root, _info_panel, _info_scroll, doc, "wide")
	var first := doc.first_button()
	if first:
		first.call_deferred("grab_focus")
	return doc


func close_info() -> void:
	if not info_root.visible:
		return
	info_root.visible = false
	for k in _info_scroll.get_children():
		k.queue_free()
	info_doc = null
	var au = get_node_or_null("/root/Au")
	if au:
		au.play("tap")


func info_open() -> bool:
	return info_root.visible


func fade(on: bool) -> void:
	_fade_want = 1.0 if on else 0.0


func fatal(msg: String) -> void:
	fatal_label.text = msg
	fatal_label.visible = true


## true while a typed text field has the keyboard (so the game's keys do not fire)
func typing() -> bool:
	var f := root.get_viewport().gui_get_focus_owner()
	return f is LineEdit or f is TextEdit


func _process(dt: float) -> void:
	var real_dt := minf(dt, 0.1)
	fade_rect.modulate.a = move_toward(fade_rect.modulate.a, _fade_want, real_dt * 2)
	fade_rect.mouse_filter = Control.MOUSE_FILTER_STOP if fade_rect.modulate.a > 0.5 else Control.MOUSE_FILTER_IGNORE
	var sm: ShaderMaterial = storm_rect.material
	var cur: float = float(sm.get_shader_parameter("amount")) if sm.get_shader_parameter("amount") != null else 0.0
	var want := _storm_want
	if _storm_mode == "active":
		want *= 0.7 + 0.3 * sin(Time.get_ticks_msec() * 0.009)
	sm.set_shader_parameter("amount", move_toward(cur, want, real_dt * 2.5))
	if banner_box.visible and banner_box.get_meta("flash", false):
		banner_box.modulate.a = 0.75 + 0.25 * sin(Time.get_ticks_msec() * 0.012)
	else:
		banner_box.modulate.a = 1
	for id in _meters:
		var m: Dictionary = _meters[id]
		if m.low and (m.el as Control).visible:
			(m.el as Control).rotation = deg_to_rad(1.2) * sin(Time.get_ticks_msec() * 0.007)
		else:
			(m.el as Control).rotation = 0
