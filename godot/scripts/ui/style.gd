class_name Style
## The look of the interface: the web version's colours (css/style.css), its fonts (Lexend for text, Exo 2 for titles),
## rounded panels and pill buttons, as a Godot Theme built in code.

const INK := Color("#f5f7ff")
const MUTED := Color("#b3bde0")
const PANEL := Color(15 / 255.0, 21 / 255.0, 46 / 255.0, 0.84)
const PANEL_SOLID := Color("#121a38")
const LINE := Color(1, 1, 1, 0.14)
const AIR := Color("#4fd8ff")
const FOOD := Color("#7be36a")
const DOSE := Color("#ff6fb1")
const POWER := Color("#ffd23f")
const SCI := Color("#ffb84d")
const DANGER := Color("#ff5468")
const OK := Color("#4dff9a")
const SOFT := Color(1, 1, 1, 0.06)

static var _fonts := {}
static var _theme: Theme


## Lexend (or Exo 2 / Figtree / Sora) at a weight from 100 to 900
static func font(weight: int = 400, family: String = "lexend", italic := false) -> Font:
	var key := family + str(weight) + str(italic)
	if _fonts.has(key):
		return _fonts[key]
	var f := FontVariation.new()
	f.base_font = load("res://assets/fonts/" + family + ".woff2")
	var ts := TextServerManager.get_primary_interface()
	f.variation_opentype = { ts.name_to_tag("wght"): weight }
	if italic:
		f.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.2, 1), Vector2.ZERO)
	_fonts[key] = f
	return f


static func box(bg: Color, radius: float = 16, border: Color = Color(0, 0, 0, 0), bw: int = 0, pad := Vector4(12, 8, 12, 8)) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(int(radius))
	if bw > 0:
		s.border_color = border
		s.set_border_width_all(bw)
	s.content_margin_left = pad.x
	s.content_margin_top = pad.y
	s.content_margin_right = pad.z
	s.content_margin_bottom = pad.w
	s.anti_aliasing = true
	s.corner_detail = 10
	return s


static func shadowed(s: StyleBoxFlat, col: Color, size: int, offset := Vector2(0, 5)) -> StyleBoxFlat:
	s.shadow_color = col
	s.shadow_size = size
	s.shadow_offset = offset
	return s


static func theme() -> Theme:
	if _theme:
		return _theme
	var t := Theme.new()
	t.default_font = font(400)
	t.default_font_size = 16
	for type in ["Label", "Button", "LineEdit", "RichTextLabel", "OptionButton", "CheckBox", "TextEdit"]:
		t.set_color("font_color", type, INK)
	t.set_color("default_color", "RichTextLabel", INK)
	t.set_font("normal_font", "RichTextLabel", font(400))
	t.set_font("bold_font", "RichTextLabel", font(700))
	t.set_font("italics_font", "RichTextLabel", font(400, "lexend", true))
	t.set_font("bold_italics_font", "RichTextLabel", font(700, "lexend", true))
	t.set_font("mono_font", "RichTextLabel", font(600))
	t.set_constant("line_separation", "RichTextLabel", 3)
	t.set_font("font", "Button", font(600))
	t.set_font_size("font_size", "Button", 17)

	# panels
	t.set_stylebox("panel", "PanelContainer", box(PANEL, 16, LINE, 2))
	t.set_type_variation("Modal", "PanelContainer")
	t.set_stylebox("panel", "Modal", shadowed(box(PANEL_SOLID, 28, LINE, 2, Vector4(24, 22, 24, 20)), Color(0, 0, 0, 0.6), 30, Vector2(0, 12)))
	t.set_type_variation("ModalCrisis", "PanelContainer")
	t.set_stylebox("panel", "ModalCrisis", shadowed(box(PANEL_SOLID, 28, DANGER, 3, Vector4(24, 22, 24, 20)), Color(0, 0, 0, 0.7), 30, Vector2(0, 12)))
	t.set_type_variation("InfoRow", "PanelContainer")
	t.set_stylebox("panel", "InfoRow", box(SOFT, 16, Color(0, 0, 0, 0), 0, Vector4(13, 11, 13, 11)))
	t.set_type_variation("InfoRowGood", "PanelContainer")
	t.set_stylebox("panel", "InfoRowGood", box(SOFT, 16, OK, 2, Vector4(13, 11, 13, 11)))
	t.set_type_variation("InfoRowAlert", "PanelContainer")
	t.set_stylebox("panel", "InfoRowAlert", box(SOFT, 16, DOSE, 2, Vector4(13, 11, 13, 11)))
	t.set_type_variation("Soft", "PanelContainer")
	t.set_stylebox("panel", "Soft", box(SOFT, 14, Color(0, 0, 0, 0), 0, Vector4(12, 9, 12, 9)))
	t.set_type_variation("Chip", "PanelContainer")
	t.set_stylebox("panel", "Chip", box(PANEL, 16, LINE, 2, Vector4(14, 8, 14, 8)))
	t.set_type_variation("Pill", "PanelContainer")
	t.set_stylebox("panel", "Pill", box(PANEL, 999, LINE, 2, Vector4(16, 8, 18, 8)))
	t.set_type_variation("Card", "PanelContainer")
	var card := box(Color("#1d2c5e"), 20, AIR, 2, Vector4(14, 12, 14, 12))
	t.set_stylebox("panel", "Card", shadowed(card, Color(0, 0, 0, 0.55), 20, Vector2(0, 10)))

	# buttons: the pill buttons (primary yellow, ghost glass), links, round icon buttons, pick cards
	_button(t, "Button", box(Color(1, 1, 1, 0.1), 999, LINE, 2, Vector4(20, 10, 20, 10)), Color(1, 1, 1, 0.17), INK)
	t.set_type_variation("BtnPrimary", "Button")
	var prim := shadowed(box(POWER, 999, Color(0, 0, 0, 0), 0, Vector4(20, 10, 20, 10)), Color("#b98a00"), 0, Vector2(0, 5))
	_button(t, "BtnPrimary", prim, POWER.lightened(0.08), Color("#2a1c00"))
	t.set_type_variation("BtnGhost", "Button")
	_button(t, "BtnGhost", shadowed(box(Color(1, 1, 1, 0.1), 999, LINE, 2, Vector4(20, 10, 20, 10)), Color(0, 0, 0, 0.35), 0, Vector2(0, 5)), Color(1, 1, 1, 0.17), INK)
	t.set_type_variation("BtnOn", "Button")
	_button(t, "BtnOn", shadowed(box(Color(1, 1, 1, 0.1), 999, POWER, 2, Vector4(20, 10, 20, 10)), Color(0, 0, 0, 0.35), 0, Vector2(0, 5)), Color(1, 1, 1, 0.17), INK)
	t.set_type_variation("Link", "Button")
	var none := StyleBoxEmpty.new()
	for st in ["normal", "hover", "pressed", "focus", "disabled", "hover_pressed"]:
		t.set_stylebox(st, "Link", none)
	t.set_color("font_color", "Link", MUTED)
	t.set_color("font_hover_color", "Link", Color.WHITE)
	t.set_color("font_pressed_color", "Link", Color.WHITE)
	t.set_color("font_focus_color", "Link", Color.WHITE)
	t.set_font("font", "Link", font(400))
	t.set_type_variation("IconBtn", "Button")
	_button(t, "IconBtn", box(PANEL, 999, LINE, 2, Vector4(8, 6, 8, 6)), Color(0.15, 0.2, 0.4, 0.95), INK)
	t.set_type_variation("Pick", "Button")
	_button(t, "Pick", box(SOFT, 18, LINE, 2, Vector4(14, 12, 14, 12)), Color(1, 1, 1, 0.11), INK)
	t.set_type_variation("PickSel", "Button")
	_button(t, "PickSel", box(Color(1, 0.82, 0.25, 0.16), 18, POWER, 3, Vector4(14, 12, 14, 12)), Color(1, 0.82, 0.25, 0.22), INK)
	t.set_type_variation("Opt", "Button")
	_button(t, "Opt", shadowed(box(Color(1, 1, 1, 0.08), 16, LINE, 2, Vector4(14, 11, 14, 11)), Color(0, 0, 0, 0.35), 0, Vector2(0, 4)), Color(1, 1, 1, 0.14), INK)

	# inputs
	t.set_stylebox("normal", "LineEdit", box(Color(1, 1, 1, 0.08), 14, LINE, 2, Vector4(14, 9, 14, 9)))
	t.set_stylebox("focus", "LineEdit", box(Color(1, 1, 1, 0.1), 14, POWER, 2, Vector4(14, 9, 14, 9)))
	t.set_font("font", "LineEdit", font(600))
	t.set_font_size("font_size", "LineEdit", 18)

	# progress bars (meters)
	t.set_stylebox("background", "ProgressBar", box(Color(1, 1, 1, 0.12), 8, Color(0, 0, 0, 0), 0, Vector4.ZERO))
	t.set_stylebox("fill", "ProgressBar", box(AIR, 8, Color(0, 0, 0, 0), 0, Vector4.ZERO))
	t.set_constant("separation", "VBoxContainer", 6)
	t.set_constant("separation", "HBoxContainer", 10)

	# scroll bars: thin
	var grab := box(Color(1, 1, 1, 0.25), 4, Color(0, 0, 0, 0), 0, Vector4(3, 3, 3, 3))
	t.set_stylebox("grabber", "VScrollBar", grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", grab)
	t.set_stylebox("grabber_pressed", "VScrollBar", grab)
	t.set_stylebox("scroll", "VScrollBar", box(Color(0, 0, 0, 0), 4, Color(0, 0, 0, 0), 0, Vector4(3, 3, 3, 3)))
	t.set_type_variation("TooltipPanel", "PanelContainer")
	t.set_stylebox("panel", "TooltipPanel", box(PANEL_SOLID, 10, LINE, 1, Vector4(8, 5, 8, 5)))
	_theme = t
	return t


static func _button(t: Theme, type: String, normal: StyleBoxFlat, hover_bg: Color, fg: Color) -> void:
	var hover: StyleBoxFlat = normal.duplicate()
	hover.bg_color = hover_bg
	var pressed: StyleBoxFlat = normal.duplicate()
	pressed.bg_color = hover_bg
	pressed.shadow_offset = Vector2(0, 2)
	var focus: StyleBoxFlat = normal.duplicate()
	focus.bg_color = Color(0, 0, 0, 0)
	focus.border_color = Color.WHITE
	focus.set_border_width_all(3)
	focus.shadow_size = 0
	focus.shadow_offset = Vector2.ZERO
	var disabled: StyleBoxFlat = normal.duplicate()
	disabled.bg_color.a *= 0.45
	t.set_stylebox("normal", type, normal)
	t.set_stylebox("hover", type, hover)
	t.set_stylebox("pressed", type, pressed)
	t.set_stylebox("hover_pressed", type, pressed)
	t.set_stylebox("focus", type, focus)
	t.set_stylebox("disabled", type, disabled)
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		t.set_color(k, type, fg)
	t.set_color("font_disabled_color", type, Color(fg, 0.5))


## a colour as BBCode wants it
static func hx(c: Color) -> String:
	return "#" + c.to_html(c.a < 1.0)
