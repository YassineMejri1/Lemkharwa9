extends Node
## Astro Outpost — the game itself (autoload "Game"): controls, what the E key does, throwing, mini-games, storms,
## days and nights, and the rocket ride home. A port of js/game.js. The rules live in Sim and Crisis, the world in
## World, Base and Actors, the interface in Ui, sound in Au. Optional add-ons (helmet view, meteorites, Sun Watch,
## keepsakes, the habitat interior, the holo-tablet, the Field Journal, the town, Pioneer mode, crew mode) register
## themselves in `addons`; if one is missing or goes wrong, the mission carries on without it (see ext()).

const SUITS := [0xff7a3d, 0x3d9bff, 0x4cd97b, 0xff5fa8, 0xb07cff]
const SUIT_NAMES := ["Orange", "Blue", "Green", "Pink", "Purple"]
## Earth is 1.3 light-seconds from the Moon, so there Mission Control can coach you live. On Mars, Earth is 5 to 20
## light-minutes away: only messages that really come from Earth are Earth's. Everything said in the moment is a crewmate's.
const EARTH_LINES := { "storm-spotted": 1, "dish-answer": 1, "forecast-quiet": 1, "forecast-small": 1, "forecast-medium": 1, "forecast-big": 1,
	"bag-storm-day": 1, "welcome-mars": 1 }
const DAY_VOX := { "sun": "bright-sunshine", "lowsun": "long-shadows", "shadow": "in-shadow", "dark": "in-shadow", "clear": "clear-sky",
	"dusty": "dusty-sky", "storm": "dust-storm" }

var R: Dictionary
var opts := { "site": "moon", "level": "cadet", "sun": "live", "suit": 0xff7a3d, "shift": 0, "pioneer": "off" }
var intro_seen := {}
var s = null                    # the mission state (Sim.new_game), null on the title screen
var weather = null
var mode := "title"
var input := { "x": 0.0, "z": 0.0, "jump": false, "sprint": false }
var keys := {}
var stick := Vector2.ZERO
var e_pressed := false
var e_held := false
var f_held := false
var charge = null
var mini = null
var fast := false
var look_idle := 9.0
var zoom := 11.0
var action = null
var zones: Array = []
var tips := {}
var tut := {}
var tut_step := 0
var dt := 0.0
var clock := 0.0
var say_at := 0.0
var hint_at := 0.0
var goal_at := 0.0
var goal = null
var last_warn := -1
var geiger := 0.0
var ending = null
## The planets campaign: a planet opens when the one before it is won (Data.PLANET_ORDER). Kept in settings.cfg.
var done: Dictionary = {}       # the planets won on this computer, each with its stars: 1 Cadet, 2 Commander, 3 Veteran
## TESTING: every planet is open. Set this to false to bring the order back (each win opens the next planet).
var all_open := true
var next_site := ""             # the planet picked on the star map in the rocket, for the next flight
## On the planets after Mars the science add-ons, the recorded voice and the Moon and Mars facts are off.
var fun := false
const SCIENCE := ["intro", "colony", "holo", "sunwatch", "journal", "keepsake", "mission", "sky", "observe"]
var launch_t := 0.0
var launch_n := -1
var banner_until := 0.0
var case_item = null
var say_q: Array = []
var spark_at := 0.0
var topic := ""
var topic_at := 0.0
var pages := 0
var room = null
var cut = null
var cut_cool := 0.0
var rigs: Array = []
var colony_visit := 0
var colony_news = null
var crisis_open := false
var pov := false
var paused := false
var booted := false
var touch := OS.has_feature("mobile")
var addons := {}
var held_keys := {}


func _ready() -> void:
	R = Data.RULES
	opts.shift = int(R.dayLength)
	process_mode = Node.PROCESS_MODE_ALWAYS


# ---------- small helpers ----------
## crew mode (scripts/net/crew.gd): several players in one outpost. Null in a game for one.
func crew():
	var c = addons.get("crew")
	return c if c and c.on else null


func guest() -> bool:
	var c = crew()
	return c != null and c.guest


static func d2(a: Vector3, b: Vector3) -> float:
	return Vector2(a.x - b.x, a.z - b.z).length()


func day_word() -> String:
	return s.site.dayWord


static func dust_for(kind: String) -> float:
	return { "clear": 0.0, "dusty": 0.4, "storm": 1.0, "sun": 0.0, "lowsun": 0.3, "shadow": 0.8, "dark": 1.0 }.get(kind, 0.0)


static func esc(t) -> String:
	return Html.esc(t)


## Add-on modules are optional extras. If one is missing or fails, the mission carries on without it.
func ext(mod: String, fn: String, args: Array = []):
	var m = addons.get(mod)
	if m == null or not is_instance_valid(m) or not m.has_method(fn) or (fun and mod in SCIENCE):
		return null
	return m.callv(fn, args)


## the camera effects' level (2 full, 1 lite, 0 off): a value in the fx add-on, not a function
func fx_level() -> int:
	return int(addons.fx.get("level")) if has_addon("fx") else 0


func has_addon(mod: String) -> bool:
	return addons.has(mod) and is_instance_valid(addons[mod]) and not (fun and mod in SCIENCE)


## A planet is open when it is the first one, when the one before it is won, or when it was won itself (with a crew).
func unlocked(p: String) -> bool:
	var i: int = Data.PLANET_ORDER.find(p)
	return i >= 0 and (all_open or i == 0 or done.has(p) or done.has(Data.PLANET_ORDER[i - 1]))


## Where the rocket flies after a win: the planet picked on the star map, or else the next one in order.
func next_planet() -> String:
	if next_site != "":
		return next_site
	var o: Array = Data.PLANET_ORDER
	return o[mini(o.find(s.site.planet) + 1, o.size() - 1)]


## The star map, from the title: pick a planet, then plan the mission there.
func star_map() -> void:
	Ui.modal_page(StarMap.new({ "title": "Choose your planet", "sub": "Every planet plays its own way.", "sel": opts.site, "back_label": "Back",
		"back": func():
			Ui.close_modal()
			if crew():
				crew().lobby()
			else:
				title_scene(),
		"pick": func(p: String):
			opts.site = p
			setup_modal() }))


func register(mod: String, node: Node) -> void:
	addons[mod] = node
	if node.get_parent() == null:
		add_child(node)


## Mission Control's radio messages. vid: the recorded voice line for these words (found from the words when left out).
## A line that is being spoken is allowed to finish: a forced line waits its turn, a passing hint is dropped.
## Urgent lines (storms, breakdowns) cut in at once. topic: the hologram that explains these words.
func say(text: String, force := false, vid = "?", urgent := false, topic_id := "", from := "") -> void:
	if text == "":
		return
	# shortcut: on the planets after Mars a line that names the Moon or Mars is dropped, not rewritten; write those planets their own lines when they need them
	if fun and (text.contains("Moon") or text.contains("Mars")):
		return
	if vid is String and vid == "?":
		vid = Au.voice_for(text)
	if crew() and crew().route_say([text, force, vid, urgent, topic_id, from]):
		return
	if not force and clock < say_at:
		return
	if not urgent and Au.voice_playing():
		if force and say_q.size() < 3:
			say_q.append({ "text": text, "vid": vid, "until": clock + 14, "topic": topic_id, "from": from })
		return
	if urgent:
		say_q.clear()
	say_at = clock + 3.5
	bubble(text, vid, topic_id, from)


func radio_from(vid, from: String) -> String:
	if from != "":
		return from
	if s == null or s.site.id != "mars":
		return "earth"
	var first = vid[0] if vid is Array and vid.size() else vid
	return "earth" if first is String and EARTH_LINES.has(first) else "crew"


func bubble(text: String, vid, topic_id := "", from := "") -> void:
	topic = topic_id if holo_has(topic_id) else ""
	topic_at = clock
	Ui.say(text, vid, topic != "", radio_from(vid, from))


func say_next() -> void:
	while say_q.size() and not Au.voice_playing():
		var q: Dictionary = say_q.pop_front()
		if clock <= q.until:
			say_at = clock + 3.5
			bubble(q.text, q.vid, q.topic, q.from)


func tip(id: String, text: String, vid = "?", topic_id := "") -> bool:
	if crew() and crew().route_tip(id, text, vid, topic_id):
		return true
	if tips.has(id):
		return false
	tips[id] = 1
	say(text, true, vid, false, topic_id)
	return true


func toast_at(pos: Vector3, text: String, color = "#ffffff") -> void:
	if crew():
		crew().share_toast(pos, text, color)
	var p: Dictionary = World.project(pos)
	if not p.hidden:
		var sz: Vector2 = Ui.root.size
		Ui.toast(text, clampf(p.x, 60, sz.x - 60), clampf(p.y, 120, sz.y - 120), color)


func me() -> Vector3:
	return Actors.rover.pos if Actors.rover.driver else Actors.astro.pos


static func cells_text(n: float) -> String:
	var k := Js.mround(n)
	return str(k) + " power cell" + ("" if k == 1 else "s")


static func clock_text(secs: float) -> String:
	var t := maxi(0, ceili(secs))
	return "%d:%02d" % [t / 60, t % 60]


func src_line(id) -> String:
	var x = Data.SOURCES.get(id) if id != null else null
	return "<small>Source: " + esc(x.name) + "</small>" if x else ""


func open_info(html: String) -> Html.Doc:
	return Ui.info(html)


func close_info() -> void:
	Ui.close_info()


func info_open() -> bool:
	return Ui.info_open()


# =====================================================================
#  WHY DID THAT HAPPEN?  cards, the wrist tablet's holograms (holo), the Field Journal (journal)
# =====================================================================
func holo_has(id) -> bool:
	return id is String and id != "" and has_addon("holo") and ext("holo", "has", [id]) == true


func holo_open() -> bool:
	return has_addon("holo") and ext("holo", "is_open") == true


## The numbers of this very mission that a hologram can show.
func holo_data(id: String) -> Dictionary:
	var C: Dictionary = Data.CROPS
	var d := { "site": s.site.id if s else Data.SITES[opts.site].id }
	if id == "crops":
		d.lettuce = { "days": C.lettuce.growSols, "food": C.lettuce.food }
		d.potato = { "days": C.potato.growSols, "food": C.potato.food }
	if id == "electrolysis":
		d.airPerIce = Sim.air_per_ice(s) if s else R.airPerIce
	if id == "shield":
		d.slots = R.shieldSlots
	if id == "shade":
		d.free = R.bagsFreeShade
		d.bags = R.bagsFreeShade + 1
		d.loss = R.bagShade
	if s == null:
		return d
	match id:
		"scrubber":
			d.filter = Js.mround(s.filter)
		"shield":
			d.bags = s.bags
			d.shield = Sim.shield(s)
		"plant":
			d.lamp = s.m.food.lamp > 0
			d.water = s.water > 0
		"solar":
			d.eff = (s.rack.eff[0] + s.rack.eff[1] + s.rack.eff[2]) / 3.0
		"water":
			d.recycle = s.mods.recycle
			d.water = Js.mround(s.water)
		"radio":
			d.oneWay = Sim.comm_info(s).oneWay
		"storm":
			d.dish = s.m.comms.on
			d.lead = Js.mround(Sim.warn_lead(s))
		"dose":
			d.dose = Js.mround(s.dose)
		"shade":
			if s.bags > R.bagsFreeShade:
				d.bags = s.bags
				d.loss = Sim.shade(s)
		"battery":
			d.cap = 1 - s.wear.rover
	return d


## The tablet on your wrist projects a hologram. The game waits while it plays.
func show_holo(id: String) -> bool:
	if not holo_has(id) or holo_open():
		return false
	keys = {}
	e_held = false
	f_held = false
	if charge != null:
		charge = null
		if Actors.astro:
			Actors.astro.aim = false
		hide_aim()
		Au.stop_loop("aim")
	return ext("holo", "open", [id, holo_data(id), {}]) == true


## What the tablet would explain right here: the machine you are standing next to.
func near_topic() -> String:
	if mode != "play":
		return ""
	if Actors.rover.driver:
		return "battery"
	var p := me()
	var sp: Dictionary = Base.spots
	var P: Dictionary = Base.pos
	var best := [""]
	var bd := [99.0]
	var near := func(pos, id: String, r: float = 11.0):
		if pos == null:
			return
		var d := d2(p, pos)
		if d < r and d < bd[0]:
			bd[0] = d
			best[0] = id
	near.call(P.get("air"), "electrolysis")
	near.call(sp.hoppers.get("water"), "water", 6.0)
	near.call(P.get("food"), "plant")
	near.call(P.get("solar"), "solar", 13.0)
	near.call(sp.get("rack"), "solar", 7.0)
	near.call(P.get("scrub"), "scrubber", 6.0)
	near.call(P.get("hab"), "shield", 13.0)
	near.call(P.get("bag"), "shield", 8.0)
	near.call(P.get("comms"), "storm" if s.storm and s.storm.warned else "radio")
	for q in sp.drill:
		near.call(q, "drill", 7.0)
	for q in sp.ice:
		near.call(q, "drill", 7.0)
	return best[0]


## "Show me why" (the T key, the radio badge, or the chip in the radio panel).
func ask_why() -> void:
	if s == null or not has_addon("holo") or (mode != "play" and mode != "inside") or Ui.modal_open() or info_open() or holo_open():
		return
	var c = Ui.card_now()
	var id := ""
	if c and str(c.get("holo", "")) != "":
		id = c.holo
		Ui.next_card()
	elif topic != "" and Ui.radio_shown():
		id = topic
	else:
		id = near_topic()
	Au.play("tap")
	if id == "" or not show_holo(id):
		holo_menu()


func holo_menu() -> void:
	if not has_addon("holo"):
		return
	var S: Dictionary = ext("holo", "scenes")
	var site: String = s.site.id if s else Data.SITES[opts.site].id
	var html := "<h2>💡 Holo-tablet</h2><p class=\"sub\">The tablet on your wrist can project a moving picture of how each thing works. Pick one. Tip: stand next to a machine and press T, and it shows that machine.</p><div class=\"holo-grid\">"
	for id in S:
		if id == "longdark" and site != "moon":
			continue
		var inf = ext("holo", "info", [id, { "site": site }])
		var t: String = inf.title if inf is Dictionary and inf.get("title") is String else id
		html += "<button class=\"pick\" data-act=\"holo\" data-holo=\"" + id + "\"><em>" + str(S[id].get("icon", "✨")) + "</em><b>" + esc(t) + "</b></button>"
	html += "</div>"
	var doc := open_info(html)
	doc.on("holo", func(b):
		var id := Html.attr(b, "data-holo")
		close_info()
		show_holo(id))


## A new page for the Field Journal. Returns true the first time this page is found.
func journal_add(kind: String, id) -> bool:
	if s == null or not has_addon("journal") or id == null:
		return false
	var fresh: bool = ext("journal", "add", [s.site.id, kind, id]) == true
	if fresh:
		pages += 1
	return fresh


func open_journal() -> void:
	if not has_addon("journal") or holo_open():
		return
	Au.play("tap")
	ext("journal", "open", [s.site.id if s else Data.SITES[opts.site].id, { "holo": func(id): show_holo(id), "sound": func(): Au.play("tap") }])


func journal_find(f) -> void:
	if f is Dictionary and f.get("key") != null:
		journal_add("find" if f.get("kind") == "core" else str(f.kind), f.key)


func find_card(f: Dictionary) -> void:
	Ui.card(f)
	journal_find(f)
	if crew():
		crew().share_card(f)


static func _pc(v: float) -> String:
	return str(Js.mround(v * 100)) + "%"


## One more sentence for a "why" card, with this mission's own numbers in it.
func why_live(id: String) -> String:
	var t: Dictionary = s.today
	match id:
		"electro":
			return "One ice chunk makes " + Js.num(Sim.air_per_ice(s)) + " air."
		"shield":
			return "Your dome now blocks " + _pc(Sim.shield(s)) + " of the radiation indoors."
		"shade":
			return "Right now: " + _pc(Sim.shield(s)) + " shield, and " + _pc(Sim.shade(s)) + " less solar power."
		"panel":
			return "Yours are working at " + _pc((s.rack.eff[0] + s.rack.eff[1] + s.rack.eff[2]) / 3.0) + " right now."
		"stormin":
			if t.get("doseStorm", 0) > 0.05:
				var sf := Sim.shield(s)
				return "This storm added " + Js.fixed(t.doseStorm, 1) + "% to your badge. Outdoors it would have been about " + Js.fixed(t.doseStorm / maxf(0.1, 1 - sf), 1) + "%."
		"scar":
			if t.get("scar"):
				return "This one cost " + Js.fixed(t.scar * 100, 1) + "% of your solar power, for the rest of the mission."
		"jam":
			return "Your drill now heats " + _pc(s.wear.drill) + " faster."
		"flat":
			return "It now holds " + str(Js.mround(Sim.rover_cap(s))) + " seconds of driving, not " + Js.num(R.roverMax) + "."
		"longdark":
			if s.darkSol > s.sol:
				return "It comes " + ("tomorrow." if s.darkSol - s.sol == 1 else "in two days.")
		"filterlow", "stale":
			return "The filter is " + str(Js.mround(s.filter)) + "% clean."
	return ""


## Something just happened that has a reason: say why, right now, and keep the page.
func show_why(id: String) -> void:
	var m = Data.mech_for(id, s.site.id)
	if m == null:
		return
	var live := why_live(id)
	var fresh := journal_add("why", id)
	Au.play("page")
	fx_pulse("glow", 0.35)
	Ui.card({ "kind": "why", "icon": m.icon, "title": m.title, "text": m.text + ((" " + live) if live != "" else ""), "src": m.get("src", ""),
		"holo": m.holo if holo_has(m.get("holo", "")) else "", "fresh": fresh })


# =====================================================================
#  TITLE + SETUP
# =====================================================================
## flow: the actions of the card that, in crew mode, belong to the host. kind: which moment this is, for players who join late
func flow_modal(html: String, o: Dictionary, flow: Array = [], kind: String = "") -> Html.Doc:
	var c = crew()
	return c.modal(html, o, flow, kind) if c else Ui.modal(html, o)


func hide_hud() -> void:
	for id in ["hud", "goals", "banner", "radio", "prompt", "hands", "rover-hud", "mini", "inside"]:
		Ui.show_part(id, false)
	Ui.banner(null)
	Ui.prompt(null)
	Ui.hands(null)
	Ui.tags([])
	Ui.marks([])
	Ui.storm_fx("")
	Ui.clear_cards()
	Ui.settings_menu.visible = false


func title_scene() -> void:
	var c = crew()
	if c and c.host:
		c.to_lobby()
	if room != null:
		leave_room(true)
	mode = "title"
	s = null
	fun = false
	ext("pioneer", "stop")
	if Actors.astro:
		Actors.astro.mode = "hidden"
	World.cam.mode = "title"
	World.env.t = 0.3
	World.env.dust = 0.0
	World.env.storm = 0.0
	hide_hud()
	Ui.show_part("title", true)
	Ui.fade(false)
	Ui.focus_title()
	Au.stop_all()
	Au.music("title")
	Au.scene({ "place": "", "site": "" })
	if c:
		c.lobby()


func setup_modal() -> void:
	var o: Dictionary = opts
	if not unlocked(o.site):         # a crew's host can take you to a planet you have not opened yourself
		o.site = "moon"
	var card := func(g: String, v, emoji: String, t: String, text: String) -> String:
		var sel := str(o[g]) == str(v)
		return "<button class=\"pick" + (" sel" if sel else "") + "\" data-act=\"pick\" data-g=\"" + g + "\" data-v=\"" + str(v) + "\"><em>" + emoji + "</em><b>" + t + "</b><span>" + text + "</span></button>"
	var P: Dictionary = Data.SITES[o.site]
	var lv_icon := { "cadet": "🎒", "commander": "🧑‍🚀", "veteran": "🎖️" }
	var html: String = "<h2>Plan your mission</h2><p class=\"sub\">A few quick choices, Commander.</p><div class=\"info-row good\"><span class=\"ic\">" + P.emoji + "</span><div><b>Destination: " + esc(P.short) + " · " + esc(P.place) + "</b><p>" + esc(P.blurb) + "</p></div></div>" \
		+ "<h3>1 · How long is the mission?</h3><p class=\"sub\">Every day is harder than the one before, and teaches something new.</p><div class=\"cards three\">"
	for k in Data.LEVEL_ORDER:
		var L: Dictionary = Data.LEVELS[k]
		html += card.call("level", k, lv_icon[k], L.name + " · " + Js.num(L.sols) + " days", str(L.ages) + ". " + esc(L.blurb))
	html += "</div><h3>2 · How much time do you want each day?</h3><p class=\"sub\">You can change this at any moment with the ⏸ button.</p><div class=\"cards four\">"
	for sh in Data.SHIFTS:
		html += card.call("shift", int(sh.id), sh.icon, sh.name + " · " + Js.num(sh.id / 60.0) + " min", esc(sh.text))
	html += "</div><h3>3 · Which Sun do you want to face?</h3><div class=\"cards\">" \
		+ card.call("sun", "live", "☀️", "The real Sun, right now", "Flares, solar gas clouds and radiation storms from the last 30 days, fetched live from NASA.") \
		+ card.call("sun", "archive", "🌩️", "The great storms of May 2024", "A famous stormy month from NASA's records. Much harder!") + "</div>"
	if crew():
		var n: int = crew().count()
		html += "<p class=\"sub crew-plan\">🧑‍🚀 Crew mode: " + str(n) + " astronaut" + ("s" if n > 1 else "") + " will launch together. Pioneer mode is for one player.</p>"
	elif has_addon("pioneer"):
		html += "<h3>4 · How do you want to play?</h3><div class=\"cards\">" \
			+ card.call("pioneer", "off", "🧑‍🚀", "Classic", "The outpost as the engineers built it. Best for a first mission.") \
			+ card.call("pioneer", "on", "⛏️", "Pioneer · hard mode", "Fewer supplies. Break rocks into rubble, metal and glass sand, then build your own panels, batteries, walls and more.") + "</div>"
	html += "<h3>Your spacesuit colour</h3><div class=\"swatches\">"
	for i in SUITS.size():
		var c: int = SUITS[i]
		html += "<button class=\"swatch" + (" sel" if o.suit == c else "") + "\" style=\"--c:#" + ("%06x" % c) + "\" data-act=\"suit\" data-v=\"" + str(c) + "\" aria-label=\"" + SUIT_NAMES[i] + " spacesuit\"></button>"
	html += "</div><div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"back\">◀ Star map</button><button class=\"btn primary\" data-act=\"go\">Launch 🚀</button></div>"
	var keep := Ui.modal_open()
	var doc := Ui.modal(html, { "cls": "wide", "noFocus": keep, "actions": {
		"pick": func(el):
			var g := Html.attr(el, "data-g")
			var v := Html.attr(el, "data-v")
			o[g] = int(v) if g == "shift" else v
			Au.play("tap")
			setup_modal()
			_refocus("pick", g, v),
		"suit": func(el):
			o.suit = int(Html.attr(el, "data-v"))
			Au.play("tap")
			setup_modal()
			_refocus("suit", "", str(o.suit)),
		"back": func():
			Au.play("tap")
			star_map(),
		"go": func():
			_save_pref("site", o.site)
			launch(),
	} })


## these cards redraw themselves after each pick: put the keyboard focus back where it was
func _refocus(act: String, g: String, v: String) -> void:
	if Ui.modal_doc == null:
		return
	for b in Ui.modal_doc.buttons:
		if Html.attr(b, "data-act") == act and Html.attr(b, "data-v") == v and (g == "" or Html.attr(b, "data-g") == g):
			b.call_deferred("grab_focus")
			return


func launch() -> void:
	if crew():
		if guest():
			return
		opts.pioneer = "off"
		ext("net", "busy", [60000])
	Au.play("swish")
	Ui.modal("<div class=\"loading\"><h2>Calling NASA…</h2><p class=\"sub\">" + ("Fetching the last 30 days of real space weather." if opts.sun == "live" else "Opening the May 2024 storm records.") + "</p></div>", { "noFocus": true })
	var t0 := Time.get_ticks_msec()
	var data: Dictionary = await Weather.load_data(opts.sun)
	var wait := maxf(0, 0.7 - (Time.get_ticks_msec() - t0) / 1000.0)
	if wait > 0:
		await get_tree().create_timer(wait).timeout
	start_mission(data)


## snap (crew mode, a guest): the host's mission as it is now, instead of a new one
func start_mission(data: Dictionary, snap = null) -> void:
	weather = data
	Actors.room = null
	World.cam.room = null
	room = null
	colony_visit = 0
	fun = Data.SITES[opts.site].id != opts.site
	Au.mute_lines = fun
	next_site = ""
	build_world(opts.site, opts.suit)
	if snap:
		s = snap.s
	else:
		s = Sim.new_game({ "site": opts.site, "level": opts.level, "weather": data, "dayLength": opts.shift, "pioneer": opts.pioneer == "on" and has_addon("pioneer") })
	tips = {}
	tut = {}
	tut_step = 0
	mini = null
	charge = null
	ending = null
	case_item = null
	fast = false
	clock = 0.0
	say_at = 0.0
	say_q = []
	spark_at = 0.0
	hint_at = 0.0
	goal_at = 0.0
	goal = null
	last_warn = -1
	banner_until = 0.0
	geiger = 0.0
	crisis_open = false
	topic = ""
	topic_at = 0.0
	pages = 0
	cut = null
	cut_cool = 0.0
	build_zones()
	build_aim()
	if snap:
		rigs = snap.rigs
	else:
		rigs = []
		for _q in Base.spots.ice:
			rigs.append({ "state": "idle", "p": 0.0, "t": 0.0 })
	Base.rigs = rigs
	if snap:
		tut = snap.get("tut", {}).duplicate()
		tut.moved = false
		tut.jumped = false
	if s.get("pioneer"):
		ext("pioneer", "start", [s, PIONEER])
	else:
		ext("pioneer", "stop")
	if snap == null:
		var defs: Array = Data.INSTRUMENTS[s.site.id]
		for i in defs.size():
			Actors.spawn("inst", Base.spots.pallet[i], { "id": defs[i].id, "name": defs[i].name }, "fixed")
	Actors.rover_charge = func(): return s.m.rover.charge if s else 1.0
	Actors.rover_stuck = func(): return s != null and s.m.rover.stuck
	Actors.knock_loose = snap == null
	if snap:
		crew().guest_started(snap.items)
	elif crew():
		crew().mission_started(data)
	World.cam.fp = pov
	Au.gen.set_site(s.site.id)
	Ui.show_part("title", false)
	Ui.close_modal()
	World.env.t = 0.1
	World.env.dust = dust_for(Sim.env(s).kind)
	# the landing film plays once per place; after that it is skipped automatically
	if snap and snap.get("late"):
		intro_seen[s.site.id] = true
		late_join(snap.late)
	elif has_addon("intro") and not intro_seen.has(s.site.id):
		intro_seen[s.site.id] = true
		mode = "intro"
		ext("intro", "play", [s.site.id, welcome_modal])
	else:
		welcome_modal()


## builds the place: the ground and sky, the outpost, the astronaut and the rover
func build_world(site: String, suit: int) -> void:
	var like: String = Data.SITES[site].id      # the world this planet is built on; the planet sets the look, the gravity and the hazards
	World.build(site)
	Base.build(World.root, like)
	Actors.build(World.root, site, suit)
	ext("interior", "build", [World.root, like])
	ext("colony", "build", [World.root, like])
	ext("crew", "world_built")
	ext("pioneer", "build", [World.root, like])
	ext("observe", "build")
	ext("fx", "build", [like])
	ext("hazards", "build", [World.root, site])


func welcome_modal() -> void:
	var day: Dictionary = s.day
	journal_add("day", day.key)
	mode = "brief"
	World.cam.mode = "title"
	World.env.t = 0.1
	World.env.dust = dust_for(Sim.env(s).kind)
	Ui.fade(false)
	Au.music("title")
	var w0: Array = s.weather
	var d1 := Weather.pretty_date(w0[0].date)
	var dn := Weather.pretty_date(w0[w0.size() - 1].date)
	var wx := ""
	if s.weatherFallback:
		wx = "<div class=\"info-row\"><span class=\"ic\">📼</span><div><b>Using saved NASA records</b><p><span class=\"tagline archive\">NASA archive</span>We could not reach NASA just now, so the solar storms replay the real Sun from " + d1 + " to " + dn + " instead. This is not live data.</p></div></div>"
	else:
		wx = "<div class=\"info-row\"><span class=\"ic\">🛰️</span><div><b>The real Sun is in this game</b><p>" + Ui.data_tag(s) + "Solar storms replay the real Sun from " + d1 + " to " + dn \
			+ (", fetched just now from NASA's space-weather database." if s.weatherSource == "live" else " — one of the most active months on the Sun in 20 years.") + "</p></div></div>"
	var n: int = s.totalSols
	var dw := day_word().to_lower() + "s"
	var c = crew()
	var html: String = "<h2>Welcome to " + esc(s.site.name) + ", Commander!</h2>" \
		+ "<p class=\"sub\">" + esc(s.site.place) + " · This is Mission Control on Earth. We are with you on the radio all the way.</p>" \
		+ "<div class=\"info-row\"><span class=\"ic\">🎯</span><div><b>Your mission</b><p>Keep the crew alive for " + str(n) + " " + dw + (" (a sol is one Mars day)" if s.site.planet == "mars" else "") + ", do real science, then ride the rocket home. " + esc(s.site.why) + "</p></div></div>" \
		+ "<div class=\"info-row\"><span class=\"ic\">🔋</span><div><b>You do everything by hand</b><p>The Sun charges only a few power cells a day. YOU carry each one to the machine that needs it most — air, food, shield, science or radio. There is never enough for all of them.</p></div></div>" \
		+ "<div class=\"info-row\"><span class=\"ic\">📈</span><div><b>Every day is harder, and teaches something new</b><p>The outpost wears down the longer you stay. And " + str(s.level.crisisSols.size()) + " times, something will go wrong that has no checklist: " + ("the host makes the call for the whole crew" if c else "you alone will choose what to do") + ", and live with what follows.</p></div></div>" \
		+ wx \
		+ "<div class=\"info-row\"><span class=\"ic\">📡</span><div><b>Talking to Earth</b><p>" + esc(comm_welcome()) + "</p></div></div>" \
		+ "<div class=\"info-row good\"><span class=\"ic\">" + day.icon + "</span><div><b>" + esc(day_word()) + " 1 · " + esc(day.title) + " · " + esc(day.topic) + "</b><p>" + esc(day.learn) + "</p>" + src_line(day.get("src")) + "</div></div>" \
		+ ("<div class=\"info-row good\"><span class=\"ic\">🧑‍🚀</span><div><b>Your crew: " + str(c.count()) + " astronauts</b><p>You share everything: the air, the food, the Solar Rack, the rover. Split the jobs, call out storms, and get everyone inside in time!</p></div></div>" if c else "") \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"how\">How to play</button><button class=\"btn primary\" data-act=\"ok\">Step outside ▶</button></div>"
	flow_modal(html, { "speak": "Welcome to " + s.site.name + ", Commander! This is Mission Control on Earth. We are with you on the radio all the way. Keep the crew alive for " + str(n) + " " + dw + ", do real science, then ride the rocket home.",
		"line": "welcome-" + s.site.id,
		"actions": { "how": func(): how_info(), "ok": func():
			Au.play("door")
			Ui.close_modal()
			begin_sol() } }, ["ok"], "welcome")


## The radio delay for this mission's real dates, and who talks to you.
func comm_welcome() -> String:
	if fun:
		return s.site.commText + " Earth is too far away to help in time, so a crewmate inside the habitat talks you through your work."
	if s.site.id == "moon":
		return s.site.commText + " That is why Mission Control can talk you through your work live."
	var c := Sim.comm_info(s)
	var date: String = s.weather[0].get("date", "") if s.weather[0].get("date") else Time.get_date_string_from_system()
	return "On these mission days Mars is " + str(Js.mround(Weather.planets(date).km / 1e6)) + " million km from Earth, so a radio message takes " + str(c.oneWay) \
		+ " each way. Earth cannot see what you do right now, so a crewmate inside the habitat talks you through your work. Earth sends storm forecasts and repair help over the Radio Dish."


# =====================================================================
#  MORNING
# =====================================================================
func sync_rack() -> void:
	var have: Array = Actors.items.filter(func(it): return it.tag == "rack")
	while have.size() > int(s.rack.cells):
		Actors.remove(have.pop_back())
	for i in range(have.size(), int(s.rack.cells)):
		var used: Array = Actors.items.filter(func(it): return it.tag == "rack").map(func(it): return it.extra.get("slot2", -1))
		var slot := 0
		while slot in used:
			slot += 1
		var home: Vector3 = Base.spots.rackSlots[slot % int(R.rackMax)]
		var at: Vector3 = home if slot < R.rackMax else Vector3(home.x, home.y + 0.95 * floorf(slot / float(R.rackMax)), home.z)
		var it = Actors.spawn("cell", at, null, "fixed")
		it.tag = "rack"
		it.extra.slot2 = slot
		World.burst(it.pos.x, it.pos.y, it.pos.z, 8, 2, 0xffe36a, { "life": 0.5, "size": 0.25, "grav": 0 })


## Crew mode: you joined a mission that was already under way.
func late_join(ph: Dictionary) -> void:
	var k: String = ph.kind
	if s.get("colony") and s.colony.stage:
		ext("colony", "set_stage", [s.colony.stage])
	if k == "morning":
		begin_sol()
		return
	if k == "night":
		begin_sol("quiet")
		end_day(ph.get("info", {}))
		if ph.get("r"):
			show_night(ph.r)
		return
	begin_sol("hello" if k == "day" else "quiet")
	if k == "crisis":
		crisis_modal()
	elif k == "crisisResult" and ph.get("x"):
		crisis_result(ph.x)


func late_hello() -> void:
	Ui.banner(day_word() + " " + str(s.sol) + " of " + str(s.totalSols) + " · you joined the crew", "info")
	banner_until = clock + 7
	say("Welcome aboard! The crew is already at work: it is " + day_word().to_lower() + " " + str(s.sol) + " of " + str(s.totalSols) + ". Your task list shows what the outpost needs. Grab a job!", true)


## late: crew mode, joining a mission already under way ('hello': say welcome; 'quiet': a card follows)
func begin_sol(late := "") -> void:
	var env := Sim.env(s)
	var look: Dictionary = s.site.env[env.kind]
	var w := Sim.weather(s)
	var last: bool = s.sol >= s.totalSols
	if Actors.rover.driver:
		exit_rover_local(true)
	if room != null:
		leave_room(true)
	Actors.reset_astro()
	crew_spot()
	Au.music(null)
	mode = "play"
	mini = null
	charge = null
	fast = false
	Actors.astro.aim = false
	World.cam.mode = "play"
	World.cam.focus = Actors.focus
	World.cam.yaw = 0.45
	World.cam.pitch = 0.36
	zoom = 11.0
	World.cam.dist = zoom
	World.env.dust = dust_for(env.kind)
	World.env.storm = 0.0
	World.env.t = 0.06
	last_warn = -1
	hint_at = clock + 14
	if not guest():
		sync_rack()
	if last and case_item == null and not guest():
		case_item = Actors.spawn("case", Base.spots.caseSpawn, { "name": "sample case" }, "rest")
	Ui.show_part("hud", true)
	Ui.show_part("goals", true)
	Ui.show_part("inside", false)
	Ui.fade(false)
	Ui.set_hud(s)
	var go := func():
		Ui.banner(day_word() + " " + str(s.sol) + " · " + look.icon + " " + look.label + " · about " + cells_text(s.cellsToday) + " today", "info")
		banner_until = clock + 7
		var line := ""
		var vox
		if s.sol == 1:
			line = "Welcome outside! Walk with W A S D, move the mouse to look around, and press Space to jump."
			vox = "act-welcome"
		else:
			var lbl: String = look.label
			while lbl.ends_with("!") or lbl.ends_with("."):
				lbl = lbl.substr(0, lbl.length() - 1)
			var lv := int(w.get("level", 0))
			line = lbl + " today. " + ((Ui.storm_words(lv) + " is coming today. Stay ready to run home!" if lv else "The Sun is quiet today.") if s.forecast else "The dish was off, so there is no storm forecast. Listen for your suit sensor!") + (" Last day: load the sample case and board the rocket!" if last else "")
			vox = ["day-" + DAY_VOX.get(env.kind, "clear-sky"), ("forecast-" + ("big" if lv >= 3 else ("medium" if lv == 2 else "small")) if lv else "forecast-quiet") if s.forecast else "forecast-none"]
			if last:
				vox.append("day-last")
		say(line, true, vox)
	var arrive: int = int(s.colony.arrive) if has_addon("colony") and s.get("colony") else 0
	if not guest():
		for rig in rigs:
			rig.state = "idle"
			rig.p = 0.0
			rig.t = 0.0
	colony_news = ext("colony", "info", [arrive]) if arrive else null
	var landing := func():
		go.call()
		if not arrive:
			return
		ext("colony", "set_stage", [arrive, { "arrive": true }])
		colony_visit = arrive
		ext("mission", "milestone", [s, "🌍", "A ship from Earth has landed at the settlement."])
		get_tree().create_timer(2.5).timeout.connect(func():
			if mode == "play" or mode == "inside":
				say("Look to the north-east! A ship from Earth is landing at the new settlement. Go and say hello!", true))
	if late != "":
		if late == "hello":
			late_hello()
	elif s.sol == 1:
		go.call()
	else:
		day_card(landing)


## The morning briefing: one new thing to learn, today's challenge, and what got harder.
func day_card(done: Callable) -> void:
	var day: Dictionary = s.day
	var env := Sim.env(s)
	var look: Dictionary = s.site.env[env.kind]
	var w := Sim.weather(s)
	var hard := Sim.harder_list(s)
	var news := ""
	if colony_news:
		news = "<div class=\"info-row good\"><span class=\"ic\">" + colony_news.icon + "</span><div><b>News from Earth: " + esc(colony_news.title) + "</b><p>" + esc(colony_news.text) + "</p></div></div>"
	var dark := ""
	if s.darkSol > s.sol and s.darkSol - s.sol <= 2:
		dark = "<div class=\"info-row alert\"><span class=\"ic\">🌚</span><div><b>The long dark comes " + ("tomorrow" if s.darkSol - s.sol == 1 else "in two days") + "</b><p>A mountain will hide the Sun for a whole day, and the panels will make almost nothing. Leave power cells on the Solar Rack the evening before, and charge the machines that keep the crew alive.</p></div></div>"
	journal_add("day", day.key)
	var town := town_rows()
	Au.play("daystart")
	var g := ""
	if day.get("goal"):
		g = "<div class=\"info-row\"><span class=\"ic\">🎯</span><div><b>Today's challenge</b><p>" + esc(day.goal.text) + "</p></div></div>"
	var harder := ""
	if hard.size():
		harder = "<h3>📈 Harder than yesterday</h3><ul class=\"harder\">"
		for h in hard:
			harder += "<li><span>" + h.icon + "</span>" + esc(h.text) + "</li>"
		harder += "</ul>"
	var html: String = "<div class=\"day-head\"><span class=\"big-icon\">" + day.icon + "</span><div><small>" + esc(day_word()) + " " + str(s.sol) + " of " + str(s.totalSols) + "</small><h2>" + esc(day.title) + "</h2></div></div>" \
		+ news + town + "<div class=\"info-row good\"><span class=\"ic\">💡</span><div><b>New today: " + esc(day.topic) + "</b><p>" + esc(day.learn) + "</p>" + src_line(day.get("src")) + "</div></div>" + g \
		+ "<div class=\"info-row\"><span class=\"ic\">" + look.icon + "</span><div><b>" + esc(look.label) + " · about " + cells_text(s.cellsToday) + "</b><p>" + esc(look.why) + "</p></div></div>" \
		+ Ui.weather_row(s, w, s.forecast, "today") + dark + harder \
		+ "<div class=\"modal-actions\"><button class=\"btn primary\" data-act=\"ok\">Start the shift ▶</button></div>"
	flow_modal(html, { "speak": day_word() + " " + str(s.sol) + ". " + day.title + ". " + day.learn + ((" Today's challenge: " + day.goal.text + ".") if day.get("goal") else ""),
		"line": "day-morning", "actions": { "ok": func():
			Au.play("door")
			Ui.close_modal()
			done.call() } }, ["ok"], "morning")


## crew mode: each astronaut starts the day at their own spot beside the door, not inside each other
func crew_spot() -> void:
	var c = crew()
	if c == null or Actors.astro == null:
		return
	var order: Array = c.players.keys().map(func(k): return int(k))
	order.sort()
	var i := maxi(0, order.find(int(c.me)))
	var a = Actors.astro
	a.pos.x += (i - (order.size() - 1) / 2.0) * 1.7
	a.pos.y = Actors.ground_at(a.pos.x, a.pos.z)


# =====================================================================
#  CAPTURE ZONES: where carried or thrown things can go
# =====================================================================
func build_zones() -> void:
	var sp: Dictionary = Base.spots
	zones = []
	for id in ["air", "food", "bag", "lab", "comms", "scrub"]:
		if sp.sockets.has(id):
			var at: Vector3 = sp.sockets[id]
			zones.append({ "id": "sock-" + id, "pos": at, "r": 1.5, "type": "cell", "name": Data.MACHINES[id].name, "fn": func(_it): return plug_cell(id, at) })
	zones.append({ "id": "sock-rover", "dyn": func(): return Actors.rover_spot("socket"), "r": 1.3, "type": "cell", "name": "rover",
		"fn": func(_it): return plug_cell("rover", Actors.rover_spot("socket")) })
	zones.append({ "id": "hop-air", "pos": sp.hoppers.air, "r": 1.9, "type": "ice", "name": "Air Maker", "fn": func(_it):
		var r := Sim.feed_ice(s, "air")
		if r.ok:
			tut.ice = true
			Au.play("ice", { "at": sp.hoppers.air })
		return r })
	zones.append({ "id": "hop-water", "pos": sp.hoppers.water, "r": 1.7, "type": "ice", "name": "water tank", "fn": func(_it):
		var r := Sim.feed_ice(s, "food")
		if r.ok:
			tut.watered = true
			Au.play("ice", { "at": sp.hoppers.water })
			toast_at(sp.hoppers.water, "+" + str(Js.mround(r.add)) + " 💧", "#5aa8ff")
			tip("tank", "Ice in the tank! The crew drinks from it too, and the recycler gives most of that back.", "?", "water")
		return r })
	zones.append({ "id": "hop-lab", "pos": sp.hoppers.lab, "r": 1.7, "type": "core", "name": "Lab", "fn": func(it):
		var r := Sim.submit_core(s, it.data)
		if r.ok:
			Au.play("score")
			if s.m.lab.power == 0:
				say("Core loaded! The Lab needs a power cell to study it.", true)
		return r })
	zones.append({ "id": "pantry", "pos": sp.hoppers.pantry, "r": 1.9, "type": "crate", "name": "food hatch", "fn": func(it):
		var kind = it.data.get("crop") if it and it.data is Dictionary else null
		var r := Sim.store_crate(s, kind)
		if not r.ok:
			return r
		Au.play("score")
		toast_at(sp.hoppers.pantry, "+" + Js.num(r.food) + " " + Data.CROPS.get(kind, Data.CROPS.lettuce).icon, "#7be36a")
		tip("pantry" + str(s.sol), "Fresh food in the pantry!")
		return r })
	zones.append({ "id": "dome", "pos": sp.hoppers.dome, "r": 7.4, "flat": true, "top": 9.0, "type": "bag", "name": "dome", "fn": func(_it):
		var r := Sim.add_bag(s)
		if r.ok:
			Au.play("thud", { "at": sp.hoppers.dome })
			toast_at(sp.hoppers.dome, "🛡️ " + str(Js.mround(Sim.shield(s) * 100)) + "%", "#c9a6ff")
			if s.bags == R.shieldSlots:
				say("The dome is fully covered. Maximum shielding!", true)
			else:
				tip("radIntro", "This is your radiation badge. When it is full, the mission is over.")
		return r })
	zones.append({ "id": "cargo", "pos": sp.hoppers.cargo, "r": 2.1, "type": "case", "name": "rocket", "fn": func(_it):
		s.caseLoaded = true
		Au.play("swish")
		say("Samples loaded! Scientists on Earth will study them for years.", true)
		return { "ok": true } })
	for id in sp.inst:
		var at2: Vector3 = sp.inst[id]
		zones.append({ "id": "inst-" + id, "pos": at2, "r": 2.8, "flat": true, "top": 5.0, "type": "inst", "name": "marked spot",
			"match": func(it): return it.data.id == id,
			"fn": func(_it):
				var f = Sim.deploy(s, id)
				if f == null:
					return { "ok": false, "msg": "" }
				Au.play("discovery")
				find_card(f)
				World.burst(at2.x, at2.y + 0.5, at2.z, 24, 4, 0x5cf0ff, { "life": 0.9, "size": 0.3, "grav": 0 })
				return { "ok": true } })
	zones.append({ "id": "bed", "dyn": func(): return Actors.rover_spot("bed"), "r": 1.5, "type": "*", "name": "rover", "keep": true, "fn": func(it):
		if not Actors.to_bed(it):
			return { "ok": false, "msg": "The rover bed is full. It holds four things." }
		Au.play("drop")
		return { "ok": true } })


static func zone_pos(z: Dictionary) -> Vector3:
	return z.dyn.call() if z.has("dyn") else z.pos


static func zone_takes(z: Dictionary, it) -> bool:
	return (z.type == "*" or z.type == it.type) and (not z.has("match") or z.match.call(it))


func plug_cell(id: String, at: Vector3) -> Dictionary:
	var r := Sim.plug(s, id)
	if r.ok:
		Au.play("plug", { "at": at })
		World.burst(at.x, at.y, at.z, 16, 3, 0xffe36a, { "life": 0.6, "size": 0.26, "grav": 0 })
		match id:
			"air":
				tut.airCell = true
			"comms":
				tip("comms", "Radio Dish on! Earth will warn us early about solar storms, and can help with repairs today.")
			"bag":
				tip("bagger", "The Soil Bagger is filling bags. Grab them and throw them onto the dome!")
			"scrub":
				toast_at(at, "🫧 Filter 100%", "#8fe8d0")
				say("The filter is baking! The heat pushes the trapped carbon dioxide outside, so it can soak up more.", true, "?", false, "scrubber")
			"rover":
				tip("roverCell", "Rover charged! Walk to its side and press E to drive.", "rover-charged")
	return r


func capture(it, z: Dictionary) -> Dictionary:
	var from = it.from
	var res: Dictionary = z.fn.call(it)
	if not res.ok:
		return res
	var at := zone_pos(z)
	if from != null and z.id != "bed":
		var dist := Vector2(from.x - at.x, from.z - at.z).length()
		if dist > 7:
			Sim.trick(s, dist)
			Au.play("swish")
			toast_at(at, "🎯 " + str(Js.mround(dist)) + " m shot!", "#ffd23f")
			tip("trick", "What a throw! In low gravity things fly much farther than on Earth.")
	if not z.get("keep", false):
		World.burst(it.pos.x, it.pos.y, it.pos.z, 10, 2.5, 0xffffff, { "life": 0.5, "size": 0.22, "grav": 0 })
		if case_item == it:
			case_item = null
		Actors.remove(it)
	return res


func check_zones() -> void:
	for i in range(Actors.items.size() - 1, -1, -1):
		if i >= Actors.items.size():
			continue
		var it = Actors.items[i]
		if it.state != "fly" and it.state != "rest":
			continue
		if it.extra.has("hold") and clock < it.extra.hold:
			continue
		var msg = null
		for z in zones:
			if not zone_takes(z, it):
				continue
			var at := zone_pos(z)
			var inside: bool
			if z.get("flat", false):
				inside = Vector2(it.pos.x - at.x, it.pos.z - at.z).length() < z.r and it.pos.y < at.y + z.top
			else:
				inside = it.pos.distance_to(at) < z.r
			if not inside:
				continue
			var res := capture(it, z)
			if res.ok:
				msg = null
				break
			if msg == null:
				msg = res.get("msg", "")
		if msg != null and i < Actors.items.size() and Actors.items[i] == it:
			it.extra.hold = clock + 3
			if msg != "":
				say(msg, true)
				Au.play("deny")
			if it.state == "fly":
				it.vel.x *= -0.4
				it.vel.z *= -0.4
				it.vel.y = 2


# =====================================================================
#  WHAT "E" DOES RIGHT NOW
# =====================================================================
## Each offer has an id: in crew mode a guest's game sends the id, and the host's game does that offer with the guest's
## astronaut (do_offer). local: on a guest's screen this one runs there (a mini-game, a door, a card).
var offers := {}
var _best = null


func _offer(dist: float, reach: float, o: Dictionary) -> void:
	if dist < reach:
		if o.has("id"):
			offers[o.id] = o
		if _best == null or dist < _best.d:
			o.d = dist
			_best = o


func _tagged(prefix: String, local := false) -> Callable:
	return func(dist: float, reach: float, o: Dictionary):
		if not o.has("id"):
			o.id = prefix + ":" + str(o.get("label", ""))
		if local:
			o.local = true
		_offer(dist, reach, o)


static func name_of(it) -> String:
	return it.data.name if it.data is Dictionary and it.data.has("name") else Data.ITEMS[it.type].name


func find_action():
	var a = Actors.astro
	var p: Vector3 = a.pos
	var sp: Dictionary = Base.spots
	offers = {}
	_best = null
	var team = crew()
	if a.mode == "drive":
		return { "id": "exit", "local": true, "label": "Get out of the rover", "run": func(): exit_rover_local() }
	# Pioneer mode: while a structure is being placed, E builds it, even with your hands full
	if has_addon("pioneer") and ext("pioneer", "placing") == true:
		ext("pioneer", "offer", [s, p, _tagged("pioneer", true)])
		if _best:
			return _best
	var c = a.carrying
	if c:
		for z in zones:
			if not zone_takes(z, c):
				continue
			var at := zone_pos(z)
			var flat: bool = z.get("flat", false)
			var dist: float = d2(p, Actors.rover.pos) - 1.6 if z.id == "bed" else d2(p, at) - (z.r - 1 if flat else 0.0)
			var lbl: String = ("Plug into the " if z.type == "cell" else ("Load into the " if z.id == "bed" else ("Set up here" if z.type == "inst" else ("Put on the " if z.id == "dome" else "Put in the ")))) + ("" if z.type == "inst" else z.name)
			var zz: Dictionary = z
			_offer(dist, 2.6 if flat else 3.6, { "id": "zone:" + z.id, "label": lbl, "run": func():
				var res := capture(c, zz)
				if not res.ok:
					if res.get("msg", "") != "":
						say(res.msg, true)
					Au.play("deny") })
		return _best if _best else { "id": "drop", "local": true, "label": "Put down", "run": func(): put_down() }
	# loose things, and the cargo in the rover's bed: that is within reach from anywhere beside the bed
	var bed_item = null
	var bed_d := 9.0
	for it in Actors.items:
		if it.state == "held":
			continue
		var in_bed: bool = it.state == "bed"
		var dd: float = d2(p, it.pos) - (1.1 if in_bed else 0.0)
		if in_bed and dd < bed_d:
			bed_d = dd
			bed_item = it
		var item = it
		_offer(dd, 2.7 if in_bed else 3.3, { "id": "item:" + str(it.id), "label": ("Take the " + name_of(it) + " from the rover") if in_bed else "Pick up the " + name_of(it), "bed": in_bed,
			"run": func(): pick_up(item) })
	# the ice drills: one press starts a drill, and it works by itself (see step_rigs)
	for i in sp.ice.size():
		var rig: Dictionary = rigs[i]
		var dd2: float = d2(p, sp.ice[i]) - 0.9
		var k: int = i
		if rig.state == "idle":
			_offer(dd2, 2.6, { "id": "rig:" + str(i), "label": "Start the ice drill", "altLabel": "drill by hand", "altLocal": true, "alt": func(): start_drill("ice", k), "run": func(): start_rig(k) })
		else:
			_offer(dd2 + 1.6, 3.8, { "label": ("Drilling… " + str(Js.mround(rig.p * 100)) + "%") if rig.state == "drill" else "The drill is cooling… " + str(ceili(rig.t)) + " s" })
	for i in sp.drill.size():
		if Sim.cores_left(s, i) > 0:
			var k2: int = i
			_offer(d2(p, sp.drill[i]) - 0.6, 2.4, { "id": "geo:" + str(i), "local": true, "label": "Drill a rock core (hold)", "hold": true, "run": func(): start_drill("geo", k2) })
	for i in sp.beds.size():
		var bed: Dictionary = s.m.food.beds[i]
		var d := d2(p, sp.beds[i])
		var seed: Dictionary = Data.CROPS[s.sow]
		var swap := "potato" if s.sow == "lettuce" else "lettuce"
		var grown: Dictionary = Data.CROPS.get(bed.get("crop"), Data.CROPS.lettuce) if bed.get("crop") != null else Data.CROPS.lettuce
		var k3: int = i
		if bed.state == "empty":
			_offer(d, 2.3, { "id": "plant:" + str(i), "label": "Plant " + seed.name + " " + seed.icon + " (" + seed.line + ")", "altLabel": Data.CROPS[swap].name + " instead",
				"alt": func():
					Sim.set_seed(s, swap)
					Au.play("tap"),
				"run": func():
					Sim.plant(s, k3)
					tut.planted = true
					Au.play("pop")
					World.dust(sp.beds[k3].x, sp.beds[k3].z - 1.7, 4, 1, 0.3)
					check_grow()
					if s.sol == 1:
						tip("foodIntro", "This is our food. Every night, dinner comes out of it.") })
		elif bed.state == "ripe":
			_offer(d, 2.3, { "id": "harvest:" + str(i), "label": "Pick the " + grown.name + " " + grown.icon, "run": func():
				var kind = Sim.harvest(s, k3)
				if kind:
					var cr = Actors.spawn("crate", Actors.hand_pos(), { "name": Data.CROPS[kind].crate, "crop": kind }, "rest")
					Actors.pick(cr)
					Au.play("harvest")
					tip("crate", "Fresh veggies! Carry the crate to the green food hatch on the dome — or throw it in.") })
		else:
			var gname: String = grown.name
			_offer(d, 2.0, { "label": gname[0].to_upper() + gname.substr(1) + " growing… " + str(Js.mround(bed.g * 100)) + "%" + (" · needs light" if s.m.food.lamp <= 0 else (" · needs water" if s.water <= 0 else "")) })
	for i in sp.panels.size():
		if s.rack.eff[i] < 0.86:
			var k4: int = i
			_offer(d2(p, sp.panels[i]), 2.8, { "id": "panel:" + str(i), "label": "Brush the dust off" if s.site.id == "mars" else "Turn the panel to the Sun", "run": func():
				Sim.service_panel(s, k4)
				Au.play("brush")
				World.dust(sp.panels[k4].x, sp.panels[k4].z - 1.4, 10, 2.5, 0.5)
				toast_at(sp.panels[k4], "☀️ 100%", "#ffd23f") })
	var g = s.get("glitch")
	if g and (g.state == "broken" or g.state == "asked" or g.state == "advised"):
		var d3 := d2(p, Base.repair[g.machine])
		if g.state == "asked":
			_offer(d3, 4, { "label": "Waiting for Earth's answer… " + str(ceili(g.replyAt - s.t)) + " s" })
		else:
			_offer(d3, 4, { "id": "repair", "local": true, "label": "Fix it with Earth's instructions" if g.state == "advised" else "Fix the " + Data.MACHINES[g.machine].name, "run": func():
				if g.state == "advised":
					start_repair(true)
				else:
					repair_modal() })
	# with cargo in the bed, "drive" is only offered at the driver's door, so that taking the cargo is never hidden behind it
	var door := Actors.rover_spot("door")
	var dr: float = d2(p, door) if bed_item else minf(d2(p, door), d2(p, Actors.rover.pos) - 1.4)
	var drive := { "id": "drive", "local": true, "label": "Drive the rover", "run": func(): drive_rover() }
	if team == null or team.can_drive():
		_offer(dr, 2.6, drive)
	else:
		_offer(dr + 1, 2.6, { "label": team.name(team.rover) + " is driving the rover" })
	_offer(d2(p, sp.door), 2.4, { "id": "door", "local": true, "label": "Go inside the habitat", "run": func(): enter_hab() })
	# the rocket can be entered from anywhere close to it
	var rd := minf(d2(p, sp.rocketDoor), d2(p, Base.P.rocket.base) - 4.2)
	if s.sol >= s.totalSols:
		_offer(rd, 4, { "id": "rocket", "local": true, "label": "Board the rocket and fly home", "run": (func(): go_inside("rocket")) if has_addon("interior") else (func(): board_modal()) })
	elif has_addon("interior"):
		_offer(rd, 3.4, { "id": "rocket", "local": true, "label": "Climb into the rocket", "run": func(): go_inside("rocket") })
	for i in sp.photo.size():
		if not s.photos.has(str(i)) and not s.photos.has(i):
			var k5: int = i
			_offer(d2(p, sp.photo[i]), 2.6, { "id": "photo:" + str(i), "local": true, "label": "Take a postcard photo", "run": func():
				if guest():
					team.op("photo", [k5])
					_flash()
					return
				var f = Sim.photo(s, k5)
				if f:
					_flash()
					find_card(f) })
	ext("sky", "offer", [s, p, _tagged("sky"), collect_rock])
	if team == null:
		ext("pioneer", "offer", [s, p, _tagged("pioneer", true)])
	ext("observe", "offer", [s, p, _tagged("observe", true), start_observe])
	# beside the rover both are one key away: E does the nearer one, Q the other
	if _best == drive and bed_item and bed_d < 3.6:
		var bi = bed_item
		drive.alt = func(): pick_up(bi)
		drive.altLabel = "take the " + name_of(bed_item)
		drive.altId = "item:" + str(bed_item.id)
	elif _best and _best.get("bed", false) and dr < 3.2 and (team == null or team.can_drive()):
		_best.alt = drive.run
		_best.altLabel = "drive the rover"
		_best.altLocal = true
	return _best


func _flash() -> void:
	Au.play("photo")
	ext("fx", "snap")
	Ui.fade(true)
	get_tree().create_timer(0.14).timeout.connect(func(): Ui.fade(false))


## E (or Q, alt) on this screen. A guest's game asks the host to do the offer, unless it is one of the local ones.
func run_offer(o: Dictionary, alt := false) -> void:
	var fn = o.get("alt") if alt else o.get("run")
	var c = crew()
	if fn == null:
		return
	if c and c.guest and not (o.get("altLocal", false) if alt else o.get("local", false)):
		if alt and o.has("altId"):
			c.act(o.altId, false)
		else:
			c.act(o.id, alt)
		return
	if c and c.host:
		c.mine(fn)
	else:
		fn.call()


## crew mode, on the host: do offer id with the astronaut Actors.astro stands for right now
func do_offer(id: String, alt := false) -> bool:
	if s == null or (mode != "play" and mode != "inside" and mode != "observe"):
		return false
	find_action()
	var o = offers.get(id)
	var fn = (o.get("alt") if alt else o.get("run")) if o else null
	if fn == null:
		return false
	fn.call()
	return true


func put_down() -> void:
	if Actors.astro.carrying == null:
		return
	if guest():
		crew().drop()
		Au.play("drop")
		return
	Actors.set_down()
	Au.play("drop")


# ---------- the rover: one driver at a time in crew mode (the host says who) ----------
func enter_rover_local() -> void:
	Actors.enter_rover()
	if pov:
		World.cam.fpPitch = 0.2
	Au.play("rover-start")
	tip("drive", "Buckle up! The battery only drains while the rover is moving. W drives forward, S brakes, A and D steer. Press E to get out.", "rover-drive")


func drive_rover() -> void:
	var c = crew()
	if c and not c.can_drive():
		say(c.name(c.rover) + " is driving the rover right now.", true)
		return
	if c and c.guest:
		c.ask_drive(true)
		return
	if c and c.host:
		c.set_driver(0)
	enter_rover_local()


## from_net: the crew's host said so; otherwise this screen gets out and tells the crew
func exit_rover_local(from_net := false) -> void:
	if not Actors.rover.driver:
		return
	Actors.exit_rover()
	Au.stop_loop("rover")
	var c = crew()
	if from_net:
		return
	Au.play("drop")
	if c and c.host:
		c.set_driver(null)
	elif c:
		c.ask_drive(false)


func pick_up(it) -> void:
	if it.state == "held" and it.holder and it.holder != Actors.astro:
		return
	if it.tag == "rack":
		if not Sim.take_cell(s):
			return
	it.tag = null
	Actors.pick(it)
	Au.play("grab")
	tip("throw", "Got it! Press E next to a machine to use it — or hold F to aim a throw, and let go to throw.", "act-grab")


## the first-day Greenhouse lesson is done once the lamps are lit, ice has gone into the tank and a bed is planted
func check_grow() -> void:
	if s.m.food.lamp > 0 and tut.get("watered") and tut.get("planted"):
		tut.grow = true


# =====================================================================
#  THROWING
# =====================================================================
var aim := {}


func build_aim() -> void:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.no_depth_test = true
	m.albedo_color = Color(1, 1, 1, 0.9)
	m.disable_fog = true
	m.render_priority = 8
	aim = { "dots": [], "ring": null, "mat": m }
	var sm := SphereMesh.new()
	sm.radius = 0.11
	sm.height = 0.22
	sm.radial_segments = 6
	sm.rings = 4
	for i in 36:
		var dot := MeshInstance3D.new()
		dot.mesh = sm
		dot.material_override = m
		dot.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		dot.visible = false
		World.root.add_child(dot)
		aim.dots.append(dot)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.81
	tm.outer_radius = 0.99
	tm.rings = 22
	tm.ring_segments = 6
	ring.mesh = tm
	ring.material_override = m
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ring.visible = false
	World.root.add_child(ring)
	aim.ring = ring


func hide_aim() -> void:
	if aim.is_empty() or not is_instance_valid(aim.ring):
		return
	for d in aim.dots:
		d.visible = false
	aim.ring.visible = false


func update_throw(delta: float) -> void:
	var a = Actors.astro
	var c = a.carrying
	if c == null or Actors.rover.driver:
		if charge != null:
			charge = null
			a.aim = false
			hide_aim()
			Au.stop_loop("aim")
		return
	if f_held and charge == null:
		charge = { "t": 0.0, "power": 0.0 }
		a.aim = true
	if charge == null:
		return
	var ch: Dictionary = charge
	if f_held:
		ch.t += delta
		ch.power = 1 - absf(fmod(ch.t / 1.25, 2.0) - 1)
		var pts := Actors.trajectory(ch.power, 36)
		var n := pts.size()
		var ok := false
		for z in zones:
			if ok:
				break
			if not zone_takes(z, c):
				continue
			var at := zone_pos(z)
			if z.get("flat", false):
				ok = Vector2(Actors.landing.x - at.x, Actors.landing.z - at.z).length() < z.r
			else:
				for i in n:
					if pts[i].distance_to(at) < z.r * 0.9:
						ok = true
						break
		(aim.mat as StandardMaterial3D).albedo_color = Color(Mats.lin(0x4dff9a if ok else 0xffffff), 0.9)
		for i in aim.dots.size():
			aim.dots[i].visible = i < n
			if i < n:
				aim.dots[i].position = pts[i]
		aim.ring.visible = true
		aim.ring.position = Vector3(Actors.landing.x, Actors.ground_at(Actors.landing.x, Actors.landing.z) + 0.15, Actors.landing.z)
		Au.loop("aim", { "f": 200 + ch.power * 500, "v": 0.03, "type": "sine" })
	else:
		Au.stop_loop("aim")
		hide_aim()
		var it = crew().throw_held(maxf(0.05, ch.power)) if guest() else Actors.throw_held(maxf(0.05, ch.power))
		if it:
			Au.play("throw")
			it.extra.hold = clock + 0.12
		charge = null
		a.aim = false


# =====================================================================
#  MINI-GAMES: drilling (steer + heat) and repairs (timing)
# =====================================================================
# ---------- the ice drills: one press starts a drill, it works by itself, and the ice pops out ----------
func ice_near(i: int) -> int:
	var n := 0
	var q: Vector3 = Base.spots.ice[i]
	for it in Actors.items:
		if it.type == "ice" and it.state != "held" and it.state != "bed" and d2(it.pos, q) < 3.4:
			n += 1
	return n


func start_rig(i: int) -> void:
	var rig: Dictionary = rigs[i]
	var q: Vector3 = Base.spots.ice[i]
	if ice_near(i) >= 2:
		say("Two ice chunks are already waiting at this drill. Pick them up first!", true)
		Au.play("deny")
		return
	rig.state = "drill"
	rig.p = 0.0
	Au.play("plug", { "at": q })
	World.burst(q.x, q.y + 0.6, q.z, 10, 2.5, 0xbff4ff, { "life": 0.5, "size": 0.22, "grav": 0 })
	Sim.note(s, "icedrill")
	tip("icerig", "The drill does the work by itself. Start the other drills too, then come back for the ice!")


func step_rigs(delta: float) -> void:
	var need: float = R.iceDrillTime / sqrt(s.level.ease)
	for i in rigs.size():
		var rig: Dictionary = rigs[i]
		var q: Vector3 = Base.spots.ice[i]
		if rig.state == "drill":
			rig.p += delta / need
			if rig.p < 1:
				continue
			rig.state = "rest"
			rig.t = float(R.iceDrillRest)
			rig.p = 0.0
			var chunk = Actors.spawn("ice", Vector3(q.x, q.y + 1.2, q.z), null, "fly")
			var ang := randf() * 6.28
			var up := sqrt(2.4 * World.gravity)             # a hop about 1.2 m high, whatever the gravity, so it lands beside the drill
			chunk.vel = Vector3(cos(ang) * 1.1, up, sin(ang) * 1.1)
			chunk.spin = 4.0
			Au.play("ice", { "at": q })
			World.burst(q.x, q.y + 0.9, q.z, 14, 3, 0xbff4ff, { "life": 0.6, "size": 0.24 })
			if mode == "play":
				toast_at(q, "🧊 Ice is ready!", "#4fd8ff")
		elif rig.state == "rest":
			rig.t -= delta
			if rig.t <= 0:
				rig.state = "idle"


## The town's morning news: who lives there now, and what the settlers did for you (or need from you).
func town_rows() -> String:
	var c = s.get("colony")
	if c == null or c.stage < 2:
		return ""
	var gifts: Array = c.gifts
	var gl := ""
	for i in gifts.size():
		gl += ("" if i == 0 else (" and " if i == gifts.size() - 1 else ", ")) + str(gifts[i])
	var town_name = ext("colony", "town")
	var cls := " good" if gifts.size() else (" alert" if c.get("asks") else "")
	var text := "They share your air plant, so breathing takes " + str(Js.mround(Sim.town_load(s) * 100)) + "% more air. " \
		+ ("In good spirits, the settlers brought you " + gl + "." if gifts.size() else ("The town is short of food: tonight you share " + Js.num(c.asks) + " of your dinner with them." if c.get("asks") else "Keep the outpost looking after itself and they will lend a hand."))
	return "<div class=\"info-row" + cls + "\"><span class=\"ic\">🏘️</span><div><b>" + esc(town_name if town_name else "The town") + " · " + Js.num(c.people) + " people · town spirit " + str(Js.mround(c.spirit)) + "%</b><p>" + esc(text) + "</p></div></div>"


func town_info() -> void:
	var c: Dictionary = s.colony
	var D: Array = R.townDays
	var nxt := 0
	for i in range(1, D.size()):
		if c.days < D[i]:
			nxt = int(D[i])
			break
	var town_name = ext("colony", "town")
	open_info("<h2>🏘️ " + esc(town_name if town_name else "The town") + "</h2><p class=\"sub\">A town grows beside an outpost that can look after itself.</p>" + town_rows() \
		+ "<div class=\"info-row\"><span class=\"ic\">🌍</span><div><b>" + Js.num(c.days) + " self-sustaining " + day_word().to_lower() + ("" if c.days == 1 else "s") + "</b><p>" \
		+ esc("A day counts when the Air Maker makes most of the air the crew breathes and there is food for tomorrow. " + ((str(nxt - int(c.days)) + " more and another ship will come.") if nxt else "No town has ever grown this big!")) + "</p></div></div>" \
		+ "<div class=\"info-row\"><span class=\"ic\">😊</span><div><b>Town spirit</b><p>It rises after a self-sustaining day and falls after a day that was not. Above " + Js.num(R.spiritHelp) + "% the settlers bring ice and water each morning, above " + Js.num(R.spiritGift) + "% a charged power cell too. Under " + Js.num(R.spiritLow) + "% they need part of your dinner.</p></div></div>")


## Drilling: hold E to drill, and keep the drill bit in the green zone, the layer of good ice or rock. The spinning drill
## keeps kicking the bit sideways, mostly away from the zone; steer it back with A / D. The drill only goes deeper inside
## the zone. Grinding outside fills the red Slip bar, and when it is full the sample breaks. A hot drill kicks harder,
## so short bursts (let go, it cools and calms down) are the way, just like real space drills.
func start_drill(kind: String, idx: int) -> void:
	var ease: float = s.level.ease
	var ice := kind == "ice"
	var zc := randf_range(-1, 1) * 0.42
	mini = { "type": "drill", "kind": kind, "idx": idx, "depth": 0.0, "heat": 0.0, "jams": 0, "lock": 0.0,
		"rate": 0.42 if ice else 0.24, "heatRate": (0.36 if ice else 0.38) / ease * s.mods.heat * (1 + s.wear.drill) * Sim.drill_heat(s), "cool": 0.65,
		"x": zc, "v": 0.0, "zc": zc, "zw": minf(0.46, (0.33 if ice else 0.32) * sqrt(ease)),
		"kick": (1.8 if ice else 2.0) / sqrt(ease), "push": 0.0, "pushT": 0.5,
		"slip": 0.0, "slipTime": (2.2 if ice else 2.6) * sqrt(ease), "out": 0.0, "inside": true, "on": false,
		"bumpT": 1.5 + randf() * 2, "bumpWarn": 0.0, "bumpDir": 0, "flash": 0.0,
		"icon": "🧊" if ice else "🧪", "title": "Mining ice" if ice else "Drilling a rock core at " + Data.GEO[s.site.id][idx].name, "hint": "" }
	Actors.astro.mode = "busy"
	Actors.astro.vel = Vector3.ZERO
	var t: Vector3 = Base.spots.ice[idx] if ice else Base.spots.drill[idx]
	Actors.astro.yaw = atan2(t.x - Actors.astro.pos.x, t.z - Actors.astro.pos.z)
	if pov:
		World.cam.yaw = Actors.astro.yaw + PI
		World.cam.fpPitch = 0.55
	tip("drill", "Drills get hot! Drill in bursts and let it cool, just like real space drills do.")


func end_mini() -> void:
	mini = null
	Au.stop_loop("drill")
	Ui.drill_ui(null)
	if Actors.astro.mode == "busy":
		Actors.astro.mode = "walk"


func step_mini(delta: float) -> void:
	var m: Dictionary = mini
	var a = Actors.astro
	if m.type == "drill":
		if input.jump:
			end_mini()
			return
		var hp := Actors.hand_pos()
		var ice: bool = m.kind == "ice"
		var spot: Vector3 = Base.spots.ice[m.idx] if ice else Base.spots.drill[m.idx]
		var dust := 0xbff4ff if ice else (0xd9a070 if s.site.id == "mars" else 0xc8c9d4)
		m.lock = maxf(0, m.lock - delta)
		m.flash = maxf(0, m.flash - delta)
		var on: bool = e_held and m.lock <= 0
		m.on = on
		m.v += clampf(input.x, -1, 1) * 7 * delta
		if on:
			m.pushT -= delta
			if m.pushT <= 0:
				var away := 1.0 if m.x >= m.zc else -1.0
				m.push = (away if randf() < 0.7 else -away) * m.kick * (0.6 + randf() * 0.6)
				m.pushT = 0.35 + randf() * 0.55
			m.v += m.push * (1 + 0.9 * m.heat) * (1 + 0.35 * m.depth) * delta
			# now and then a hard pebble jolts the drill; a ⚡ shows which way, a moment before
			if m.bumpWarn > 0:
				m.bumpWarn -= delta
				if m.bumpWarn <= 0:
					m.v += m.bumpDir * 2.3
					m.flash = 0.25
					World.cam.shake = maxf(World.cam.shake, 0.18)
					Au.play("thud")
					World.burst(hp.x, a.pos.y + 0.3, hp.z, 8, 3, dust, { "life": 0.4, "size": 0.18 })
			else:
				m.bumpT -= delta
				if m.bumpT <= 0:
					m.bumpWarn = 0.45
					m.bumpDir = -1 if randf() < 0.5 else 1
					m.bumpT = (3.0 if ice else 2.0) + randf() * 2.5
			m.heat += m.heatRate * delta
		else:
			m.heat = maxf(0, m.heat - m.cool * delta)
			m.bumpWarn = 0.0
		m.v *= exp(-(2.6 if on else 5.0) * delta)
		m.x += m.v * delta
		if m.x < -1:
			m.x = -1.0
			m.v = maxf(0, m.v)
		elif m.x > 1:
			m.x = 1.0
			m.v = minf(0, m.v)
		var inside: bool = absf(m.x - m.zc) <= m.zw
		if inside:
			m.slip = maxf(0, m.slip - 0.8 * delta)
		if on:
			if inside:
				m.depth += m.rate * delta
			else:
				m.slip += delta / m.slipTime
				m.out += delta
			Au.loop("drill", { "f": 90 + m.heat * 160, "v": 0.07, "rate": 0.9 + m.heat * 0.35 } if inside else { "f": 60 + m.heat * 90, "v": 0.08, "rate": 0.62 + m.heat * 0.2 })
			if randf() < delta * (30 if inside else 14):
				World.emit(hp.x, a.pos.y + 0.3, hp.z, { "vx": (randf() - 0.5) * 4, "vy": 1 + randf() * 3, "vz": (randf() - 0.5) * 4, "life": 0.6, "size": 0.2, "grow": 1.5,
					"color": dust if inside else 0x8a8f9c, "alpha": 0.8, "grav": World.gravity * 0.5 })
			World.cam.shake = maxf(World.cam.shake, 0.03 + m.heat * 0.05 + (0.0 if inside else 0.04))
			if not inside and m.inside:
				tip("drill-steer", "The drill kicks the bit out of the good layer! Steer it back into the green zone, or the sample breaks.")
		else:
			Au.stop_loop("drill")
		m.inside = inside
		if m.heat >= 1:
			m.jams += 1
			m.heat = 0.4
			m.depth = maxf(0, m.depth - 0.15)
			m.lock = 0.9
			m.v += (-1 if randf() < 0.5 else 1) * 2.0
			Au.stop_loop("drill")
			Au.play("jam")
			Au.play("bad")
			World.cam.shake = 0.35
			World.burst(hp.x, a.pos.y + 0.5, hp.z, 14, 4, 0xff7a4d, { "life": 0.5, "size": 0.22 })
			var worn: float = s.wear.drill
			sim_op("jam")
			m.heatRate *= (1 + s.wear.drill) / (1 + worn)
			say("Too hot — the drill jammed! Let it cool between bursts.", true, "act-drill-jam", true, "drill")
		if m.slip >= 1:
			end_mini()
			Au.play("bad")
			World.cam.shake = 0.3
			World.burst(hp.x, a.pos.y + 0.4, hp.z, 18, 4, dust, { "life": 0.7, "size": 0.26 })
			toast_at(spot, "The ice shattered!" if ice else "The core crumbled!", "#ff5468")
			say("The drill slipped out of the ice and smashed it to powder. Try again, and keep the bit in the green!" if ice else "The drill slipped out of the rock layer and the core crumbled. Try again, and keep the bit in the green!", true)
			sim_op("note", ["crumble"])
			return
		if not inside:
			m.hint = "Steer right ▶ back into the green!" if m.x < m.zc else "◀ Steer left, back into the green!"
		elif m.lock > 0:
			m.hint = "Jammed! Wait for it to cool…"
		elif m.heat > 0.75:
			m.hint = "Too hot, it is shaking! Let go to cool it."
		elif on:
			m.hint = "Keep the bit in the green! Steer with A / D."
		else:
			m.hint = "Hold E to drill · steer with A / D (Space = stop)"
		if m.depth >= 1:
			# a clean core: no jams and hardly any time outside the layer
			var q := 2 if m.jams == 0 and m.out < 1 else (1 if m.jams <= 1 and m.out < 3 else 0)
			var kind: String = m.kind
			var idx: int = m.idx
			end_mini()
			if guest():
				crew().op("mini", [kind, idx, q])
			elif crew():
				crew().mine(func(): mini_reward(kind, idx, q))
			else:
				mini_reward(kind, idx, q)
			return
		Ui.drill_ui(m)
	else:
		if input.jump:
			end_mini()
			Ui.dial_ui(null)
			return
		m.lock = maxf(0, m.lock - delta)
		if m.lock <= 0:
			m.needle += m.dir * m.speed * delta
			if m.needle > 1:
				m.needle = 1.0
				m.dir = -1
			if m.needle < 0:
				m.needle = 0.0
				m.dir = 1
		if e_pressed and m.lock <= 0:
			if absf(m.needle - m.c) <= m.w / 2:
				m.hits += 1
				Au.play("hit")
				m.lock = 0.25
				m.c = 0.15 + randf() * 0.7
				if m.hits >= m.need:
					sim_op("repair_done")
					Au.play("good")
					Ui.dial_ui(null)
					mini = null
					a.mode = "walk"
					var still_off: bool = Sim.machine(s, m.machine).broken
					say("Repaired! But the pump fuse is still blown, so the Greenhouse stays off until tonight." if still_off else "Fixed! The " + Data.MACHINES[m.machine].name + " is running again.", true, null if still_off else m.machine + "-fixed")
					return
			else:
				sim_op("repair_miss")
				Au.play("spark", { "at": Base.repair[m.machine] })
				m.lock = 0.7
				World.cam.shake = 0.25
				var rp: Vector3 = Base.repair[m.machine]
				World.burst(rp.x, rp.y + 0.6, rp.z, 16, 5, 0xffe36a, { "life": 0.5, "size": 0.2 })
				say("Zap! A short circuit wasted some solar charge.", true)
		Ui.dial_ui(m)


## A rule a mini-game changes. A guest's game makes the change on its own copy at once (so the screen answers
## straight away) and asks the host's game to make it for real; the host's copy is the one that counts.
func sim_op(fn: String, args: Array = []):
	var r = Sim.callv(fn, [s] + args)
	if guest():
		crew().sim(fn, args)
	return r


## a finished drill: the ice chunk or the rock core goes into the driller's hands (on the host, for a guest too)
func mini_reward(kind: String, idx: int, q: int) -> void:
	if kind == "ice":
		Actors.pick(Actors.spawn("ice", Actors.hand_pos(), null, "rest"))
		Au.play("ice")
		tip("ice", "A chunk of ice! The Air Maker can split it into oxygen. The rover bed carries four at a time.")
		return
	if Sim.cores_left(s, idx) <= 0:
		return
	var core := Sim.drill_core(s, idx, q)
	Actors.pick(Actors.spawn("core", Actors.hand_pos(), core, "rest"))
	Au.play("core")
	toast_at(Base.spots.drill[idx], ["Rough core", "Good core!", "Perfect core! ✨"][q], "#ffd23f")
	Au.line(["act-core-rough", "act-core-good", "act-core-perfect"][q])
	tip("core", "A rock core! Take it to the Science Lab to find out what it is made of.")


func ask_earth() -> Dictionary:
	var r := Sim.ask_earth(s)
	if r.ok:
		ext("mission", "repair_sent", [s])
	return r


func start_repair(advised: bool) -> void:
	var g: Dictionary = s.glitch
	var ease: float = s.level.ease
	var wear: float = s.mods.dial
	mini = { "type": "dial", "machine": g.machine, "needle": 0.0, "dir": 1, "hits": 0, "need": 3, "lock": 0.0, "c": 0.3 + randf() * 0.4,
		"speed": (0.75 if advised else 1.5 / sqrt(ease)) * wear, "w": 0.34 if advised else 0.13 * ease / sqrt(wear),
		"title": ("📡 Earth's instructions: " if advised else "🔧 ") + "Fixing the " + Data.MACHINES[g.machine].name,
		"hint": "Press E when the white line is in the green zone. Three times! (Space = stop)" }
	Actors.astro.mode = "busy"
	Actors.astro.vel = Vector3.ZERO
	if pov:
		var rp0: Vector3 = Base.repair[g.machine]
		World.cam.yaw = atan2(rp0.x - Actors.astro.pos.x, rp0.z - Actors.astro.pos.z) + PI
		World.cam.fpPitch = 0.02


func repair_modal() -> void:
	var g: Dictionary = s.glitch
	var def: Dictionary = Data.REPAIRS[g.machine]
	var info := Sim.comm_info(s)
	var dish: bool = s.m.comms.on
	var ask_text := ""
	if dish:
		ask_text = "With their instructions the fix is easy. But a radio message takes " + esc(info.oneWay) + " each way" \
			+ ((" — " + esc(info.round) + " there and back. The machine stays broken while you wait (" + str(Js.mround(info.wait)) + " seconds of game time).") if info.get("minutes") else " — almost no wait at all!")
	else:
		ask_text = "The Radio Dish has no power today, so you cannot call Earth."
	Ui.modal("<div class=\"big-icon\">🔧</div><h2>" + esc(def.title) + "</h2><p>" + esc(def.text) + "</p>" \
		+ "<button class=\"opt\" data-act=\"self\"><b>🔧 Fix it myself, right now</b><span>Tricky without instructions: the green zone is small. Every slip wastes half a power cell of charge.</span></button>" \
		+ "<button class=\"opt\" data-act=\"ask\"" + ("" if dish else " disabled") + "><b>📡 Ask Mission Control for the steps</b><span>" + ask_text + "</span></button>" \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"later\">Later</button></div>",
		{ "noFocus": true, "speak": def.title + " " + def.text, "actions": {
			"self": func():
				Au.play("tap")
				Ui.close_modal()
				start_repair(false),
			"later": func():
				Au.play("tap")
				Ui.close_modal(),
			"ask": func():
				var r: Dictionary = Sim.ask_earth(s) if guest() else ask_earth()
				if r.ok and guest():
					crew().op("ask_earth")
				if not r.ok:
					Au.play("deny")
					return
				ext("mission", "repair_sent", [s])
				Au.play("page")
				Ui.close_modal()
				if s.site.id == "moon" and not fun:
					say("We got your question! The Moon is only 1.3 light-seconds from Earth, so our answer is on its way.", true, "dish-sent-moon")
				else:
					say("Your question is on its way to Earth. It takes " + str(r.info.oneWay) + " to get there, and the answer takes just as long to come back. Keep working — I will call you when it arrives.", true, null),
		} })


# =====================================================================
#  EVENTS FROM THE MISSION RULES
# =====================================================================
func spawn_bag() -> void:
	var n: int = Actors.items.filter(func(it): return it.tag == "tray").size()
	var sl: Vector3 = Base.spots.bagTray[n % 4]
	var it = Actors.spawn("bag", Vector3(sl.x, sl.y + floorf(n / 4.0) * 0.45, sl.z), { "name": "soil bag" }, "fixed")
	it.tag = "tray"
	Au.play("bag", { "at": Base.pos.bag })


func handle_events(ev: Array) -> void:
	for e in ev:
		# Mission Control logs the event; the big ones become a cutaway when the crew is at home
		var cutaway = ext("mission", "event", [e, s])
		if cutaway:
			start_cut(cutaway.kind, cutaway)
		match str(e.type):
			"cell":
				if not guest():
					sync_rack()
				Au.play("ding", { "at": Base.spots.rack })
			"air":
				Au.play("air", { "at": Base.pos.air })
				toast_at(Base.pos.air, "+" + Js.num(e.amount) + " 💨", "#4fd8ff")
				if s.sol == 1:
					tip("airIntro", "This is our air. The crew breathes it all day, so keep the Air Maker busy.")
			"bag":
				if guest():
					Au.play("bag", { "at": Base.pos.bag })
				else:
					spawn_bag()
			"ripe":
				tip("ripe" + str(s.sol), "The veggies are ripe! Pick them at the Greenhouse.")
				Au.play("good")
			"empty":
				if e.machine == "air" and s.m.air.queue > 0:
					say("The Air Maker used up its power cell, and there is still ice waiting.", true)
				elif e.machine == "lab" and s.m.lab.queue.size():
					say("The Lab used up its power cell, and cores are still waiting.", true)
				elif e.machine == "food":
					say("The grow lamps ran out of power. Plants stop growing in the dark.", true, "?", false, "plant")
			"discovery":
				fx_pulse("glow", 0.8)
				Au.play("discovery")
				find_card(e.find)
			"why":
				show_why(e.id)
			"break":
				var bl = Au.VOICE.get(e.machine + "-broken")
				Au.play("bad")
				Au.play("spark", { "at": Base.repair[e.machine] })
				say((bl.t if bl else Data.REPAIRS[e.machine].title) + " Look for the sparks.", true, e.machine + "-broken", true)
			"advice":
				Au.play("page")
				say("Mission Control's answer has arrived! Go back to the " + Data.MACHINES[e.machine].name + " to finish the repair.", true, "dish-answer")
			"storm":
				var inside := mode == "inside"
				if e.phase == "warning":
					fx_pulse("glitch", 0.7)
					Au.play("storm-alert")
					var cme_day: bool = s.storm != null and s.storm.get("cause") == "cme"
					var text := ""
					var vid := ""
					if inside:
						text = "A solar storm is on its way. Good thing you are inside!"
						vid = "storm-inside"
					elif s.m.comms.on:
						text = "Earth says a cloud of solar gas is about to sweep past. Its shock wave carries fast particles. Head for the airlock!" if cme_day else "We just spotted a solar flare! A radiation storm is coming. Head for the airlock!"
						vid = "storm-countdown" if cme_day else "storm-spotted"
					else:
						text = "Your suit sensor just caught a solar storm! The dish is off, so we could not warn you early. RUN for the airlock!"
						vid = "storm-no-warning"
					say(text, true, vid, true)
				elif e.phase == "active":
					if not inside:
						say("Radiation storm! You cannot see it or feel it, but your suit sensor can. Get inside!", true, "storm-active", true)
					tip("clicks", "That clicking is your suit's radiation sensor. More clicks mean more radiation.")
				else:
					Au.play("good")
					say("The storm has passed. All clear!", true)
			"devil":
				# the one lucky dust devil of the mission: it comes in from the plain and crosses the panels
				if e.phase == "coming":
					Actors.send_devil(e.get("lead", 9.0))
				elif e.get("gain", 0) > 0.01:
					Au.play("good", { "at": Base.pos.solar })
					toast_at(Base.pos.solar, "🌪️ +" + str(Js.mround(e.gain * 100)) + "% solar power", "#ffd23f")
					say("Lucky break! A dust devil just crossed the solar panels and blew some of the dust off. That happened to the Spirit and Opportunity rovers too — but only now and then.", true)
			"daygoal":
				fx_pulse("glow", 1)
				Au.play("discovery")
				Ui.toast("🎯 Challenge done!", Ui.root.size.x / 2, Ui.root.size.y * 0.3, "#ffd23f")
				say("Today's challenge is done: " + s.day.goal.text.to_lower() + ". Nice work!", true, "hud-challenge-done")
			"crisis":
				fx_pulse("glitch", 1)
				crisis_modal()
			"consequence":
				show_consequence(e)
			"fail":
				if not guest():
					fail_now(e.reason)
				return
			"dayEnd":
				if not guest():
					on_day_end()
				return


# =====================================================================
#  CRISIS MOMENTS: no checklist, more than one way out, consequences later
# =====================================================================
func crisis_modal() -> void:
	var v = Crisis.view(s)
	if v == null:
		return
	crisis_open = true
	if mini != null:
		end_mini()
		Ui.dial_ui(null)
	charge = null
	Actors.astro.aim = false
	hide_aim()
	Au.stop_all()
	Au.play("alarm")
	World.cam.shake = maxf(World.cam.shake, 0.3)
	# On Mars the call comes from the crewmate inside: Earth would hear about this crisis only minutes from now.
	var mars: bool = s.site.id == "mars"
	var far := (" Earth is " + str(Sim.comm_info(s).oneWay) + " away by radio, far too slow to help in time.") if mars else " There is no time to talk it through."
	var opts_html := ""
	var speak: String = v.title + " " + v.text + " You decide."
	for i in v.options.size():
		var o: Dictionary = v.options[i]
		opts_html += "<button class=\"opt\" data-act=\"pick\" data-v=\"" + o.id + "\"><b>" + o.icon + " " + esc(o.label) + "</b><span>" + esc(o.text) + "</span></button>"
		speak += " Choice " + str(i + 1) + ": " + o.label + ". " + o.text
	flow_modal("<div class=\"day-head crisis-head\"><span class=\"big-icon\">" + v.icon + "</span><div><small>⚠ " + esc(v.alarm) + " · YOUR CALL</small><h2>" + esc(v.title) + "</h2></div></div>" \
		+ "<p>" + esc(v.text) + "</p>" \
		+ "<div class=\"info-row\"><span class=\"ic\">📡</span><div><small>" + esc(Ui.RADIO_FROM["crew" if mars else "earth"]) + "</small><p>We have no checklist for this one, Commander." + esc(far) + " There is more than one thing you could do. You decide.</p></div></div>" \
		+ opts_html \
		+ "<p class=\"sub crisis-foot\">⏸ The clock is stopped while you think. Nobody will tell you which choice is best. You will see what yours leads to.</p>",
		{ "cls": "crisis", "noFocus": true, "speak": speak, "line": "crisis-your-call", "actions": { "pick": func(el): crisis_pick(Html.attr(el, "data-v")) } }, ["pick"], "crisis")


func crisis_pick(id: String) -> void:
	var r = Crisis.choose(s, id)
	if r == null:
		return
	if crew():
		crew().flow_data = { "d": { "id": r.d.id, "optIcon": r.d.optIcon, "label": r.d.label, "now": r.d.now }, "sync": r.get("sync", false), "skip": r.get("skip", 0), "home": r.get("home", false) }
	crisis_result({ "d": r.d, "sync": r.get("sync", false), "skip": r.get("skip", 0), "home": r.get("home", false) })


## what the choice did right now (on a guest's screen: the host's choice)
func crisis_result(x: Dictionary) -> void:
	var d: Dictionary = x.d
	journal_add("crisis", d.id)
	Au.play("plug")
	flow_modal("<div class=\"big-icon\">" + d.optIcon + "</div><h2>" + esc(d.label) + "</h2><p>" + esc(d.now) + "</p>" \
		+ "<p class=\"sub\">" + ((esc(crew().name(0)) + " made the call for the crew. ") if guest() else "") + "Was it the right call? Keep going. What happens next will show you.</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn primary\" data-act=\"ok\">Carry on ▶</button></div>",
		{ "speak": d.now, "actions": { "ok": func():
			Au.play("page")
			Ui.close_modal()
			crisis_open = false
			if x.get("sync") and not guest():
				sync_rack()
			if x.get("skip"):
				skip_time(x.skip, x.get("home", false)) } }, ["ok"], "crisisResult")


## A choice that takes time: the shift clock jumps forward while you work on it indoors.
func skip_time(frac: float, home := false) -> void:
	var secs: float = frac * s.dayLength
	var total := secs
	var ev: Array = []
	var guard := 0
	if home and mode == "play":
		if Actors.rover.driver:
			exit_rover_local()
		if Actors.astro.carrying:
			put_down()
		Actors.reset_astro()
		crew_spot()
		World.cam.yaw = 0.45
	Ui.fade(true)
	get_tree().create_timer(0.45).timeout.connect(func():
		if mode == "play" or mode == "inside":
			Ui.fade(false))
	Ui.banner("⏩ " + clock_text(total) + " of the shift went into the job", "info")
	banner_until = clock + 5
	if guest():
		return
	while secs > 0 and not s.get("dayDone", false) and not s.get("over", false) and guard < 4000:
		guard += 1
		var st := minf(0.5, secs)
		secs -= st
		ev.append_array(Sim.tick(s, st, { "outside": false }))
	var rest := ev.filter(func(e): return e.type != "dayEnd")
	if crew():
		crew().events(rest)
	var ended := ev.any(func(e): return e.type == "dayEnd")
	handle_events(rest)
	if ended and (mode == "play" or mode == "inside"):
		if s.sol >= s.totalSols:
			on_day_end()
		else:
			end_day({})


func show_consequence(e: Dictionary) -> void:
	var r: Dictionary = e.res
	var d: Dictionary = e.d
	Au.play("good" if r.tone == "good" else ("bad" if r.tone == "bad" else "page"))
	Ui.card({ "kind": "conseq", "tone": r.tone, "icon": "✅" if r.tone == "good" else ("⚠️" if r.tone == "bad" else "⚖️"), "title": "You chose: " + d.label, "text": r.text })
	if r.get("spark"):
		for p in [Base.pos.comms, Base.pos.food]:
			World.burst(p.x, p.y - 2, p.z, 26, 6, 0xffe36a, { "life": 0.7, "size": 0.26 })
		Au.play("spark")
		World.cam.shake = maxf(World.cam.shake, 0.3)
	sync_rack()


func decision_html(d: Dictionary, more: bool) -> String:
	var later := ""
	for l in d.later:
		later += "<li class=\"" + l.tone + "\">" + ("✅" if l.tone == "good" else ("⚠️" if l.tone == "bad" else "⚖️")) + " " + esc(l.text) + "</li>"
	return "<div class=\"decision\"><b>" + d.icon + " " + esc(d.title) + "</b>" \
		+ "<p><span class=\"tagline choice\">You chose</span>" + d.optIcon + " " + esc(d.label) + "</p>" \
		+ "<ul><li>" + esc(d.now) + "</li>" + later + "</ul>" \
		+ ("<p class=\"sub\">Some consequences only show up tomorrow morning.</p>" if more else "") \
		+ "<div class=\"fact\"><b>🛰️ What real crews did</b><p>" + esc(d.science) + "</p>" + src_line(d.get("src")) + "</div></div>"


# =====================================================================
#  EXTRAS: helmet view, postcards, music, certificate
# =====================================================================
var pov_auto := false


func set_pov(on: bool, quiet := false) -> void:
	pov = on
	tips.pov = 1
	if not quiet:
		pov_auto = false
	World.cam.fp = pov
	World.cam.fpPitch = 0.06
	Actors.set_first_person(pov)
	if pov:
		World.cam.eye = Actors.eye
	Ui.set_setting("view", pov)
	if quiet:
		return
	Au.play("swish")
	if mode == "play" or mode == "inside":
		say("Helmet view! You are looking through your own visor now." if pov else "Back to the outside view.", true)


# ---------- the camera: effects and filters (fx) ----------
func fx_pulse(kind: String, amount: float) -> void:
	ext("fx", "pulse", [kind, amount])


func next_fx() -> void:
	ext("fx", "next_level")


func next_filter() -> void:
	if not has_addon("fx") or ext("fx", "available") != true:
		return
	var f = ext("fx", "next_filter")
	Au.play("photo")
	fx_pulse("flash", 0.18)
	if f:
		say(f.note, true)


## A postcard of exactly what you see. The picture is made on this computer and never sent anywhere.
func snap_postcard() -> void:
	if s == null or (mode != "play" and mode != "inside" and mode != "observe") or not has_addon("keepsake") or Ui.modal_open() or info_open():
		return
	var card = ext("keepsake", "postcard", ["Greetings from " + s.site.name + "!", day_word() + " " + str(s.sol) + " · " + s.site.place + " · Astro Outpost"])
	if card == null:
		return
	Au.play("photo")
	Ui.fade(true)
	get_tree().create_timer(0.14).timeout.connect(func(): Ui.fade(false))
	ext("keepsake", "open_postcard", [card])


func music_on() -> bool:
	return opts.get("music", true) != false


func set_music(on: bool) -> void:
	opts.music = on
	_save_pref("music", on)
	Au.gen.set_on(on and Au.sound_on())


func music_mood() -> String:
	if Au.music_on():
		return "off"                     # a recorded piece is playing (title, night, film): the generated music waits
	match mode:
		"title", "end":
			return "title"
		"intro":
			return "off"
		"observe":
			return "night"
		"vision", "launch":
			return "launch"
		"night", "brief":
			return "night"
	if crisis_open:
		return "crisis"
	var ph := Sim.storm_phase(s) if s else "none"
	return "storm" if ph == "warning" or ph == "active" else "work"


func certificate_info() -> Dictionary:
	var rank := Sim.rank_for(s)
	var storms: Array = []
	for i in s.weather.size():
		var w = s.weather[i]
		if w and w.get("level", 0) > 0 and i < s.sol:
			storms.append({ "date": Weather.pretty_date(w.date), "cls": "CME" if w.get("cause") == "cme" else "SEP", "level": w.level })
	var badges: Array = Sim.badges(s).map(func(b): return { "icon": b.icon, "name": b.name })
	return { "name": "", "won": true, "rank": { "icon": rank.icon, "name": rank.name }, "site": { "id": s.site.id, "name": s.site.name, "place": s.site.place },
		"level": s.level.name, "days": s.totalSols, "dayWord": day_word().to_lower() + "s", "badges": badges, "storms": storms,
		"source": "archive" if s.weatherFallback else s.weatherSource, "from": Weather.pretty_date(s.weather[0].date), "to": Weather.pretty_date(s.weather[s.weather.size() - 1].date),
		"decisions": s.decisions.size(), "finds": s.finds.size(), "today": _today_long() }


static func _today_long() -> String:
	var d := Time.get_date_dict_from_system()
	var months := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
	return "%d %s %d" % [d.day, months[d.month - 1], d.year]


func collect_rock() -> void:
	var f = ext("sky", "collect", [s])
	if f == null:
		return
	Au.play("discovery")
	if crew():
		find_card(f)
	else:
		Ui.card(f)
	tip("rock", "A real rock from space! Scientists study meteorites to learn how the planets were made.")


## what the Pioneer mode module may ask the game to do
var PIONEER := {
	"say": func(text, topic_id = ""): say(text, true, "?", false, topic_id if topic_id else ""),
	"toast": func(text, pos, color = "#ffffff"): toast_at(pos, text, color),
	"why": func(id): if s: Sim.note(s, id),
	"openInfo": func(html): return open_info(html),
	"closeInfo": func(): if info_open(): close_info(),
	"sound": func(name, o = {}): Au.play(name, o),
	"sync": func(): if s: sync_rack(),
}
var SKY := { "outside": true, "pos": null, "say": func(t): say(t, true), "tip": func(id, t): return tip(id, t) }
var POV := { "yaw": 0.0, "pos": null, "home": null, "goal": null, "goalIcon": "", "air": 0.0, "moving": false, "effort": false }


func pause_modal() -> void:
	if s == null or (mode != "play" and mode != "inside") or Ui.modal_open():
		return
	Au.play("tap")
	_pause_draw()


func _extra(act: String, icon: String, t: String, text: String, sel = null) -> String:
	return "<button class=\"pick" + (" sel" if sel == true else "") + "\" data-act=\"" + act + "\"><em>" + icon + "</em><b>" + t + "</b><span>" + esc(text) + "</span></button>"


func _pause_draw() -> void:
	var left: float = 1 - s.t / s.dayLength
	var team = crew()
	var shifts := not guest()
	var html := "<div class=\"big-icon\">⏸</div><h2>" + ("Menu" if team else "Paused") + "</h2><p class=\"sub\">" \
		+ ("The outpost keeps running while this card is open: your crewmates are still out there!" if team else "Nothing moves while this card is open. Take all the time you need.") + "</p>"
	if shifts:
		html += "<h3>⏱️ How long should a working day be?</h3><div class=\"cards four\">"
		for sh in Data.SHIFTS:
			var sel: bool = int(s.dayLength) == int(sh.id)
			html += "<button class=\"pick" + (" sel" if sel else "") + "\" data-act=\"shift\" data-v=\"" + str(int(sh.id)) + "\"><em>" + sh.icon + "</em><b>" + sh.name + " · " + Js.num(sh.id / 60.0) + " min</b><span>" + esc(sh.text) + "</span></button>"
		html += "</div>"
	html += "<p>Time left in today's shift: <b>" + clock_text(left * s.dayLength) + "</b>." + (" Changing the day length keeps your place in the day, so the time left stretches or shrinks with it. Air, food and power per day stay the same." if shifts else "") + "</p>"
	html += "<h3>🎒 Extras</h3><div class=\"cards four\">" + _extra("pov", "👁️", "Helmet view", "See through your own visor. Key: V", pov)
	if has_addon("keepsake"):
		html += _extra("snap", "📷", "Postcard", "Save a picture of what you see. Key: C")
	if has_addon("sunwatch"):
		html += _extra("sun", "☀️", "Sun Watch", "The real NASA space weather behind your mission.")
	html += _extra("music", "🎵", "Music", "On. Pick to switch it off." if music_on() else "Off. Pick to switch it on.", music_on())
	if has_addon("journal"):
		var cnt = ext("journal", "count", [s.site.id])
		html += _extra("journal", "📓", "Field Journal", str(cnt.have) + " of " + str(cnt.total) + " pages found. Key: J")
	if has_addon("holo"):
		html += _extra("ask", "💡", "Holo-tablet", "Holograms that show how things work. Key: T")
	if has_addon("fx") and ext("fx", "available") == true:
		var cur = ext("fx", "current")
		var lvl: int = fx_level()
		html += _extra("filter", cur.icon, "Camera: " + cur.name, "See like a real space camera. Key: L") \
			+ _extra("fx", "✨", "Camera effects: " + str(ext("fx", "level_name")), ("Glow, lens flare, film grain." if lvl == 2 else ("A lighter version for slower computers." if lvl == 1 else "The plain picture.")) + " Key: X", lvl > 0)
	html += "</div><div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"quit\">" + ("Leave the crew" if guest() else ("End the mission for everyone" if team else "Quit mission")) \
		+ "</button><button class=\"btn ghost\" data-act=\"how\">How to play</button><button class=\"btn primary\" data-act=\"ok\">Back to work ▶</button></div>"
	var keep := Ui.modal_open()
	Ui.modal(html, { "cls": "wide pause", "noFocus": keep, "actions": {
		"shift": func(el):
			var v := int(Html.attr(el, "data-v"))
			Sim.set_day_length(s, v)
			opts.shift = v
			Au.play("tap")
			_pause_draw()
			_refocus("shift", "", str(v)),
		"pov": func():
			set_pov(not pov)
			_pause_draw()
			_refocus("pov", "", ""),
		"snap": func():
			Ui.close_modal()
			snap_postcard(),
		"sun": func():
			Au.play("tap")
			ext("sunwatch", "open", [s, weather]),
		"music": func():
			set_music(not music_on())
			Au.play("tap")
			_pause_draw(),
		"journal": func(): open_journal(),
		"ask": func():
			Au.play("tap")
			Ui.close_modal()
			holo_menu(),
		"filter": func():
			next_filter()
			_pause_draw(),
		"fx": func():
			next_fx()
			Au.play("tap")
			_pause_draw(),
		"how": func():
			Au.play("tap")
			how_info(),
		"quit": func():
			Au.play("tap")
			Ui.close_modal()
			if guest():
				crew().leave()
			else:
				title_scene(),
		"ok": func():
			Au.play("tap")
			Ui.close_modal(),
	} })


func storm_frame(outside: bool) -> void:
	var st = s.storm
	var ph := Sim.storm_phase(s)
	if ph == "warning":
		var secs := ceili(st.start - s.t)
		if outside:
			Ui.storm_fx("warn")
			Ui.banner("⚠️ Solar storm in " + str(secs) + " s — get to the airlock!", "")
			if secs != last_warn:
				if secs == 10 and last_warn > 10:
					say("Solar storm coming. Get to the airlock!", true, "storm-countdown", true)
				last_warn = secs
				Au.play("warn")
		else:
			Ui.banner("⚠️ A solar storm is coming — you are safe inside", "")
		banner_until = clock + 1
	elif ph == "active":
		World.env.storm = 1.0
		Ui.storm_fx("active" if outside else "inside")
		if outside and has_addon("fx") and fx_level() > 0 and s.t > st.start + 2:
			tip("flashes", "See those tiny streaks of light? Astronauts really see flashes like that when space radiation zips through their eyes!")
		Ui.banner("☢️ RADIATION STORM! Get inside!" if outside else "☢️ Storm outside — home shield blocks " + str(Js.mround(Sim.shield(s) * 100)) + "%", "active" if outside else "")
		banner_until = clock + 1
		geiger -= dt
		if geiger <= 0:
			Au.play("click")
			geiger = (0.03 + randf() * 0.09) if outside else (0.15 + randf() * 0.3)
	else:
		if World.env.storm:
			World.env.storm = 0.0
			Ui.banner("✅ The storm has passed", "safe")
			banner_until = clock + 4
		Ui.storm_fx("")
		if clock > banner_until:
			Ui.banner(null)


# =====================================================================
#  PLAYING OUTSIDE
# =====================================================================
var q_pressed := false


func step_play(delta: float) -> void:
	var a = Actors.astro
	var r = Actors.rover
	World.env.t = 0.06 + 0.88 * (s.t / s.dayLength)
	var moving := Vector2(input.x, input.z).length() > 0.2
	if not crew():
		var ev := Sim.tick(s, delta, { "outside": true, "sprint": input.get("puff", false) and moving and not r.driver, "driving": r.driver and absf(r.speed) > 0.6, "calm": s.sol == 1 and tut_step < 4 })
		handle_events(ev)
		if mode != "play":
			return
		step_rigs(delta)
	look_idle += delta
	if r.driver:
		if look_idle > (0.6 if pov else 1.2):
			var want: float = r.yaw + PI
			var df := wrapf(want - World.cam.yaw, -PI, PI)
			World.cam.yaw += df * minf(1, delta * (7.0 if pov else 2.4))
		Au.loop("rover", { "rate": 0.7 + absf(r.speed) * 0.045, "vol": 0.45 + absf(r.speed) * 0.04 })
		if s.m.rover.charge <= 0:
			tip("roverEmpty" + str(s.sol), "The rover battery is empty, so it can only crawl. Plug in a fresh power cell!")
	elif look_idle > 0.7 and charge == null and mini == null:
		World.cam.yaw -= input.x * 1.0 * delta
	World.cam.dist += ((zoom * 1.45 if r.driver else zoom) - World.cam.dist) * minf(1, delta * 3)
	if not tut.get("moved") and a.moved > 10 and tut.get("jumped"):
		tut.moved = true
	if mini != null:
		action = null
		step_mini(delta)
	else:
		update_throw(delta)
		action = null if charge != null else find_action()
		if e_pressed and action and action.has("run"):
			run_offer(action, false)
		if q_pressed and a.carrying and charge == null:
			put_down()
		elif q_pressed and action and action.has("alt"):
			run_offer(action, true)
	storm_frame(true)
	# things Mission Control points out once, when they matter
	Au.breathe(delta, input.sprint and moving and not r.driver)
	if has_addon("observe") and not s.get("lookout") and not r.driver and float(ext("observe", "near", [a.pos])) < 14:
		tip("lookout", "That flat rock with the gold blanket is the lookout. Sit down for a moment and look at the sky.")
	if s.leak > 0:
		tip("leak" + str(s.sol), "Air leak! The tanks are losing air.")
	elif s.get("stale", 0) > 1:
		tip("stale" + str(s.sol), "The air is going stale. It is draining fast!")
	if s.sol < s.totalSols and s.t > s.dayLength * 0.7 and s.food < Sim.dinner(s):
		tip("short" + str(s.sol), "There is not enough food for tonight's dinner!")
	if s.sol == 2 and s.t > 20 and mini == null:
		tip("hear", "Hear how quiet it is? The Moon has no air to carry sound. You only hear what travels through your suit." if s.site.id == "moon" \
			else "Everything sounds faint and muffled out here. The thin Mars air carries sound poorly. The Perseverance rover's microphones heard the same thing.")


## Crew mode, on the host: the mission rules run for the whole crew, whoever is where.
func world_step(delta: float) -> void:
	var c = crew()
	var out := (mode == "play" or mode == "observe") and room == null
	var moving := Vector2(input.x, input.z).length() > 0.2
	var ctx: Dictionary = c.crew_ctx(out, out and input.get("puff", false) and moving and not Actors.rover.driver)
	ctx.calm = s.sol == 1 and tut_step < 4
	var ev := Sim.tick(s, delta, ctx)
	World.env.t = 0.06 + 0.88 * (s.t / s.dayLength)
	c.events(ev)
	handle_events(ev)
	if mode != "play" and mode != "inside" and mode != "observe":
		return
	c.mine(func():
		step_rigs(delta)
		check_zones())
	MCTX.s = s
	MCTX.weather = weather
	ext("mission", "update", [delta, MCTX])


# =====================================================================
#  WHAT THE OUTPOST SOUNDS LIKE RIGHT NOW
# =====================================================================
const HUMS := { "air": "loop-air-maker", "food": "loop-greenhouse", "rack": "loop-solar-rack", "bag": "loop-soil-bagger", "lab": "loop-lab", "comms": "loop-radio-dish" }


func sound_frame(delta: float, is_paused: bool) -> void:
	var live: bool = s != null and (mode == "play" or mode == "inside" or mode == "observe")
	var on := {}
	var p := Vector3.ZERO
	if mode != "intro":
		var ph := Sim.storm_phase(s) if live else ""
		Au.scene({ "place": "out" if mode in ["play", "launch", "observe"] else ("in" if mode == "inside" else "menu"), "site": s.site.id if s else "",
			"dust": World.env.dust, "storm": 2 if ph == "active" else (1 if ph == "warning" else 0) })
	Au.hush(is_paused and live)
	if live:
		var m: Dictionary = s.m
		p = me()
		Au.ears(p.x, p.z, World.camera)
		# a machine hums while it is really working, and you hear it from where it stands
		on.air = not m.air.broken and m.air.power > 0 and m.air.queue > 0
		on.food = m.food.lamp > 0 and not m.food.broken
		on.rack = not s.rack.broken and s.rack.cells < Sim.rack_max(s) and s.t <= s.dayLength * R.chargeSpan
		on.bag = m.bag.pending > 0 and not m.bag.broken
		on.lab = not m.lab.broken and m.lab.power > 0 and m.lab.queue.size() > 0
		on.comms = m.comms.on
	for id in HUMS:
		Au.hum(HUMS[id], on.get(id, false), Base.pos.get(id))
	# anything broken spits sparks; a dust devil hisses as it passes
	var devil = null
	if mode == "play" and not is_paused:
		spark_at -= delta
		if spark_at <= 0:
			spark_at = 0.7 + randf() * 1.6
			for k in ["air", "food", "lab", "rack"]:
				if (s.rack if k == "rack" else s.m[k]).broken:
					Au.play("spark", { "at": Base.repair[k], "vol": 0.7 })
		var best := 45.0
		for d in Actors.devils:
			var dd := d2(p, d.pos)
			if dd < best:
				best = dd
				devil = d
	if devil:
		Au.loop("devil", { "at": devil.pos, "keep": true, "fade": 0.3 })
	else:
		Au.stop_loop("devil", 0.3)


# =====================================================================
#  INSIDE THE HABITAT
# =====================================================================
## You walk in through the door and really are inside: the habitat or the rocket's cockpit.
## Being in either one counts as indoors for the solar storms.
func go_inside(id: String) -> void:
	if s == null or room != null:
		return
	if Actors.rover.driver:
		exit_rover_local()
	if Actors.astro.carrying:
		put_down()
	var r = ext("interior", "enter", [id])
	Au.play("door")
	Au.stop_all()
	mode = "inside"
	fast = false
	charge = null
	mini = null
	hide_aim()
	Actors.astro.aim = false
	Ui.show_part("inside", true)
	Ui.prompt(null)
	Ui.hands(null)
	Ui.rover_hud(0, false)
	Ui.drill_ui(null)
	Ui.inside_button("fast").theme_type_variation = "BtnGhost"
	if r:
		room = id
		Actors.room = r.walk
		World.cam.room = r.cam
		var a = Actors.astro
		a.mode = "walk"
		a.pos = r.spawn
		a.vel = Vector3.ZERO
		a.vy = 0.0
		a.on_ground = true
		a.yaw = r.yaw
		World.cam.mode = "play"
		World.cam.yaw = r.yaw + PI
		World.cam.pitch = 0.28
		World.cam.fpPitch = 0.05
		World.cam.dist = 2.0 if id == "rocket" else 4.2
		if not pov:
			pov_auto = true
			set_pov(true, true)
		World.snap_camera()
		Ui.fade(true)
		get_tree().create_timer(0.26).timeout.connect(func():
			if room == id:
				Ui.fade(false))
	else:
		# no interior module: the old way, a view of the dome from outside
		Actors.astro.mode = "hidden"
		World.cam.mode = "inside"
	Ui.set_inside("🚀 Inside the rocket" if id == "rocket" else "🏠 Inside the habitat", "Safe and cosy. The machines keep working.")
	Ui.inside_button("sleep").visible = id == "hab" and s.sol < s.totalSols
	Ui.inside_button("sun").visible = has_addon("sunwatch") and id == "hab"
	var ph := Sim.storm_phase(s)
	if id == "rocket":
		say("Welcome aboard! Take the commander's seat when you are ready to fly home." if s.sol >= s.totalSols else "This is the cockpit that will fly you home. Have a look around!", true)
	else:
		var stormy := ph == "warning" or ph == "active"
		say("Phew — inside! The walls and the soil bags are soaking up the storm." if stormy else "Back inside. Take a breather — the machines keep working.", true, "storm-safe" if stormy else "inside-rest", true)
	if id == "rocket":
		tip("inside-rocket", "Look around the cabin with the mouse. The couches, the screens, the life support and the lockers each have something to tell you.")
	else:
		tip("inside", "Look around with the mouse — look up at the skylight! Hold Alt to click the buttons.")


## Back outside (or, with quiet, just forget the room: the day ended, the rocket launched...)
func leave_room(quiet := false) -> void:
	var id = room
	if cut != null:
		end_cut(true)
	ext("interior", "leave")
	Actors.room = null
	World.cam.room = null
	room = null
	if pov_auto:
		pov_auto = false
		set_pov(false, true)
	Ui.show_part("inside", false)
	if quiet:
		return
	var a = Actors.astro
	if id == "rocket":
		var d: Vector3 = Base.spots.rocketDoor
		var pr: Vector3 = Base.P.rocket.base
		a.pos = Vector3(d.x, Actors.ground_at(d.x, d.z), d.z)
		a.vel = Vector3.ZERO
		a.vy = 0.0
		a.on_ground = true
		a.mode = "walk"
		a.yaw = atan2(d.x - pr.x, d.z - pr.z)
		World.cam.yaw = a.yaw + PI
	else:
		Actors.reset_astro()
		crew_spot()
		World.cam.yaw = 0.45
	mode = "play"
	fast = false
	World.cam.mode = "play"
	World.cam.pitch = 0.36
	Au.play("door")
	World.snap_camera()
	Ui.fade(true)
	get_tree().create_timer(0.26).timeout.connect(func():
		if mode == "play":
			Ui.fade(false))
	if Sim.storm_phase(s) == "active":
		say("Careful! The storm is still going.", true)


func enter_hab() -> void:
	go_inside("hab")


# =====================================================================
#  THE LOOKOUT ROCK: sit down and watch the sky (observe)
# =====================================================================
## While you sit, the mission rules do not run: the clock waits, and nothing interrupts the view.
func start_observe() -> void:
	if s == null or mode != "play" or not has_addon("observe") or ext("observe", "active") == true or Actors.rover.driver or Actors.astro.carrying:
		return
	charge = null
	mini = null
	hide_aim()
	Actors.astro.aim = false
	say_q.clear()
	var ok = ext("observe", "start", [{ "s": s, "pov": pov, "done": end_observe }])
	if not ok:
		return
	mode = "observe"
	s.lookout = true
	Ui.prompt(null)
	Ui.hands(null)
	Ui.rover_hud(0, false)
	Ui.banner(null)
	Ui.tags([])
	Ui.marks([])
	Ui.storm_fx("")


func step_observe(delta: float) -> void:
	ext("observe", "step", [delta, { "x": input.x, "z": input.z }])
	if e_pressed:
		ext("observe", "stand", [pov])


## standing again: back to the normal camera, facing the way the astronaut was looking
func end_observe(r: Dictionary) -> void:
	mode = "play"
	World.cam.mode = "play"
	World.cam.yaw = r.yaw + PI
	World.cam.pitch = 0.36
	World.cam.fpPitch = 0.06
	look_idle = 0.0
	Actors.set_first_person(pov)


func exit_hab() -> void:
	if room != null:
		leave_room()
	else:
		mode = "play"
		Actors.reset_astro()
		World.cam.mode = "play"
		Ui.show_part("inside", false)


## What E does inside: each thing in the room has its own action and a real fact.
func find_room_action():
	var p: Vector3 = Actors.astro.pos
	var best = null
	var last: bool = s.sol >= s.totalSols
	var spots = ext("interior", "spots")
	for sp in (spots if spots else []):
		if sp.id == "bed" and last:
			continue
		var d := Vector2(p.x - sp.x, p.z - sp.z).length()
		if d < sp.reach and (best == null or d < best.d):
			best = { "d": d, "id": sp.id, "label": "Take your seat and fly home 🚀" if sp.id == "seat" and last else sp.label }
	if best:
		best.run = room_action(best.id)
	return best


func room_action(id: String) -> Callable:
	return func():
		var fact = ext("interior", "fact", [id])
		fact = fact if fact else ""
		if fun and (fact.contains("Moon") or fact.contains("Mars")):
			fact = ""
		ext("interior", "poke", [id])
		if id == "door" or id == "hatch":
			leave_room()
			return
		if id == "bed":
			Au.play("tap")
			sleep_ask()
			return
		if id == "seat" and s.sol >= s.totalSols:
			Au.play("tap")
			board_modal()
			return
		if id in ["console", "power", "life", "science"]:
			Au.play("tap")
			if not has_addon("mission"):
				if has_addon("sunwatch"):
					ext("sunwatch", "open", [s, weather])
				return
			# the camera settles on the workstation first, then the station card opens over it
			if not start_cut("console", { "hold": true, "then": func(): ext("mission", "open", [id, MCTX]) }):
				ext("mission", "open", [id, MCTX])
			return
		if id == "window":
			if pov:
				World.cam.fpPitch = -1.3
			else:
				World.cam.pitch = -0.5
			look_idle = 0.0
		Au.play("jump" if id == "bike" else "page")
		if id == "water":
			fact = "This tank is " + str(Js.mround(s.water)) + "% full. The recycler gives back about " + str(Js.mround(s.mods.recycle * 100)) + "% of what the crew drinks. Yes, even the pee!"
		if fact != "":
			tips["room-" + id] = 1
			say(fact, true, "?", false, "water" if id == "water" else ("plant" if id == "plants" else ""))


# =====================================================================
#  THE MISSION CONTROL CUTAWAY: the camera glides to the workstation while the game keeps running
# =====================================================================
## Only inside the habitat, never over a card, never twice at once. data: { title, text, msg, dur, hold, then, kind }
func start_cut(kind: String, data: Dictionary = {}) -> bool:
	if s == null or mode != "inside" or room != "hab":
		return false
	if cut != null:
		if cut.hold and cut.opened and not Ui.modal_open() and not info_open() and not holo_open():
			end_cut()
		elif not cut.hold and kind == "alert" and cut.kind != "alert":
			return swap_cut(kind, data)
		else:
			return false
	if Ui.modal_open() or info_open() or holo_open():
		return false
	var view = ext("interior", "console_view")
	if view == null:
		return false
	cut = { "kind": kind, "t": 0.0, "dur": data.get("dur", 7.0), "hold": data.get("hold", false), "then": data.get("then"), "opened": false,
		"yaw": World.cam.yaw, "pitch": World.cam.pitch, "fpPitch": World.cam.fpPitch, "fp": pov }
	if pov:
		Actors.set_first_person(false)            # the body is ghosted in helmet view; the cutaway must see a whole astronaut
	Actors.astro.vel = Vector3.ZERO
	World.cam.mode = "fixed"
	World.cam.fixed = { "pos": view.pos, "look": view.look }
	for id in ["prompt", "hands", "inside", "goals", "card"]:
		Ui.show_part(id, false)
	action = null
	if not data.get("hold", false):
		ext("mission", "overlay", [{ "kind": data.get("kind", kind), "title": data.get("title"), "text": data.get("text"), "msg": data.get("msg") }, s])
		Au.play("warn" if kind == "alert" else ("bad" if kind == "fault" else "page"))
	return true


func end_cut(quiet := false) -> void:
	var c = cut
	if c == null:
		return
	cut = null
	ext("mission", "overlay", [null])
	if c.fp:
		Actors.set_first_person(true)
	if quiet:
		return
	World.cam.mode = "play"
	World.cam.yaw = c.yaw
	World.cam.pitch = c.pitch
	World.cam.fpPitch = c.fpPitch
	if mode == "inside" and room != null:
		Ui.show_part("inside", true)
		Ui.show_part("goals", true)


## A station visit (a held cutaway) that turns into a transmission: keep the camera where it is and show the overlay.
func swap_cut(kind: String, data: Dictionary) -> bool:
	var c = cut
	if c == null:
		return start_cut(kind, data)
	c.hold = false
	c.opened = false
	c.kind = kind
	c.t = 0.0
	c.dur = data.get("dur", 7.0)
	ext("mission", "overlay", [{ "kind": data.get("kind", kind), "title": data.get("title"), "text": data.get("text"), "msg": data.get("msg") }, s])
	Au.play("warn" if kind == "alert" else "page")
	return true


func step_cut(delta: float) -> void:
	var c = cut
	if c == null:
		return
	c.t += delta
	ext("mission", "overlay_frame", [s])
	if c.hold:
		# a station visit: once the camera has settled, open the card; when the card closes, come back
		if not c.opened and c.t > 0.75:
			c.opened = true
			if c.then is Callable:
				c.then.call()
		elif c.opened and not Ui.modal_open() and not info_open() and not holo_open():
			end_cut()
		return
	if c.t > c.dur or e_pressed:
		end_cut()
		cut_cool = clock + 0.8


## the radio context the Mission Control module works with
var MCTX := { "s": null, "weather": null,
	"onSend": func(r, kind = ""):
		var mdl = ext("mission", "model", [s])
		var c = crew()
		if c and c.guest and r and r.get("msg"):
			c.op("mission_send", [kind if kind else r.msg.kind, r.msg.text])
		if s.site.id == "moon":
			say("We got your message! The Moon is only 1.3 light-seconds from Earth, so our answer is on its way.", true, "dish-sent-moon")
		else:
			say("Your message is on its way to Earth. It takes " + str(mdl.info.oneWay) + " to get there, and the answer takes just as long to come back. Keep working — I will call you when it arrives.", true, null)
		swap_cut("send", { "kind": "send", "title": "SIGNAL TRANSMITTED", "text": "OUTPOST-01: " + (str(r.msg.text) if r and r.get("msg") else ""), "msg": r.get("msg") if r else null, "dur": 7.0 }),
	"onReply": func(m):
		var c = crew()
		if c and c.host:
			c.broadcast({ "t": "reply", "m": { "text": m.text, "kind": m.kind, "icon": m.icon } })
		say(m.text, true, null)
		Au.play("page")
		start_cut("reply", { "kind": "reply", "title": "EARTH REPLY RECEIVED", "text": "HOUSTON: " + m.text, "msg": m, "dur": 8.0 }),
}
var ROOM := { "s": null, "astro": null }


func step_inside(delta: float) -> void:
	if not crew():
		var k := 8.0 if fast else 1.0
		var ev := Sim.tick(s, delta * k, { "outside": false, "calm": s.sol == 1 and tut_step < 4, "fast": k })
		World.env.t = 0.06 + 0.88 * (s.t / s.dayLength)
		handle_events(ev)
		if mode != "inside":
			return
		step_rigs(delta * k)
	else:
		World.env.t = 0.06 + 0.88 * (s.t / s.dayLength)
	if room != null:
		look_idle += delta
		if cut != null:
			step_cut(delta)
		else:
			if look_idle > 0.7 and not pov:
				World.cam.yaw -= input.x * 1.0 * delta
			World.cam.dist += (minf(zoom, 2.2 if room == "rocket" else 4.6) - World.cam.dist) * minf(1, delta * 3)
			action = find_room_action()
			if e_pressed and action and action.has("run") and not (cut_cool > clock):
				action.run.call()
		ROOM.s = s
		ROOM.astro = Actors.astro
		ext("interior", "update", [delta, ROOM])
	storm_frame(false)
	var left := maxi(0, ceili(s.dayLength - s.t))
	var ph := Sim.storm_phase(s)
	var wall := "The rocket's walls shield you too." if room == "rocket" else "The home shield blocks " + str(Js.mround(Sim.shield(s) * 100)) + "% of radiation."
	var text := ("A solar storm is raging outside. " + wall) if ph == "active" else ("A solar storm is about to hit. Stay in!" if ph == "warning" else "Safe inside. " + wall)
	text += " Shift time left: " + clock_text(left) + "." + (" Launch day — board the rocket before time runs out!" if s.sol >= s.totalSols else "")
	Ui.set_inside("🚀 Inside the rocket" if room == "rocket" else "🏠 Inside the habitat", text)


func sleep_ask() -> void:
	var c = crew()
	if guest():
		say("Only " + c.name(0) + ", the host, can end the day for the crew. Ask them when everyone is home!", true)
		return
	if s.t > s.dayLength * 0.6 and not c:
		end_day({})
		return
	Ui.modal("<div class=\"big-icon\">😴</div><h2>End the day " + ("for the whole crew" if c else "now") + "?</h2><p>There are still " + clock_text(s.dayLength - s.t) \
		+ " minutes of working time left. The machines will keep running, but " + ("nobody in the crew" if c else "you") + " will be able to do anything else today." \
		+ (" Anyone still outside is called home, and the late rush costs air." if c else "") + "</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"no\">Keep working</button><button class=\"btn primary\" data-act=\"yes\">Go to sleep</button></div>",
		{ "actions": { "no": func():
			Au.play("tap")
			Ui.close_modal(),
		"yes": func():
			Au.play("tap")
			Ui.close_modal()
			end_day({ "sleep": true }) } })


# =====================================================================
#  NIGHT
# =====================================================================
var night_at := 0


func on_day_end() -> void:
	# still outdoors when the launch window closes: the dash to the rocket costs air, like any late rush home
	if s.sol >= s.totalSols:
		launch_home("Time is up, Commander! It is launch time. We are bringing you home!", "launch-time-up", mode == "play")
		return
	if mode == "play":
		say("The shift is over! We are calling you home. That rush used extra air.", true, null, true)
		end_day({ "late": true })
	else:
		end_day({})


func end_day(info: Dictionary) -> void:
	var c = crew()
	if mode == "night":
		return
	if c and c.host:
		c.night(info)
		# what the crewmates carry is put down where they stand, and the rover parks
		for b in Actors.crew:
			if b.carrying:
				Actors.with_astro(b, func(): Actors.set_down())
		if c.rover != null and c.rover != 0:
			c.set_driver(null)
	mode = "night"
	mini = null
	charge = null
	hide_aim()
	Au.stop_all()
	say_q.clear()
	if room != null:
		leave_room(true)
	# the bubble is put away for the night, so these two are heard, not shown
	if not Au.reading_on():
		var vid = "hud-clock-over" if info.get("late") else ("day-sleep" if info.get("sleep") else null)
		if vid:
			Au.line(vid)
	if Actors.rover.driver:
		exit_rover_local(true)
	if Actors.astro.carrying and not guest():
		Actors.set_down()
	Actors.astro.mode = "hidden"
	Ui.fade(true)
	for id in ["goals", "prompt", "hands", "rover-hud", "mini", "inside", "radio"]:
		Ui.show_part(id, false)
	Ui.prompt(null)
	Ui.hands(null)
	Ui.banner(null)
	Ui.storm_fx("")
	Ui.tags([])
	Ui.marks([])
	Ui.clear_cards()
	World.env.storm = 0.0
	if guest():
		night_at = Time.get_ticks_msec()
		return
	await get_tree().create_timer(0.65).timeout
	if s == null:
		return
	var report := Sim.end_sol(s, info)
	colony_night(report)
	sync_rack()
	if c:
		c.report(report)
	World.cam.mode = "inside"
	World.env.t = 0.99
	Ui.set_hud(s)
	night_modal(report)


## crew mode, a guest: the host's night report has arrived
func show_night(r: Dictionary) -> void:
	var wait := maxf(0, 0.65 - (Time.get_ticks_msec() - night_at) / 1000.0) if night_at else 0.0
	if wait > 0:
		await get_tree().create_timer(wait).timeout
	if mode != "night":
		return
	World.cam.mode = "inside"
	World.env.t = 0.99
	Ui.set_hud(s)
	night_modal(r)


## The town beside the outpost: the rules are in Sim (town_night, town_morning), the colony add-on draws it.
func colony_night(r: Dictionary) -> void:
	if has_addon("colony") and not r.get("fail") and not r.get("last"):
		r.colony = Sim.town_night(s)


func colony_row(r: Dictionary) -> String:
	var c = r.get("colony")
	if c == null:
		return ""
	var why := ""
	if c.ok:
		why = "Your outpost made enough air and food to look after itself today."
	else:
		why = "Not self-sustaining today: " + ("the Air Maker made less than half of the air the crew breathed" if not c.air else "") + (", and " if not c.air and not c.food else "") + ("there is not enough food for tomorrow's dinner" if not c.food else "") + "."
	var more := ""
	if c.get("coming"):
		more = " Earth has seen it: a ship is on its way! Look out tomorrow morning."
	elif c.get("next"):
		var left: int = int(c.next - c.days)
		more = " " + str(left) + " more self-sustaining " + day_word().to_lower() + ("s" if left > 1 else "") + " and Earth will send " + ("its first supply ship." if c.next == R.townDays[1] else ("the first settlers." if c.next == R.townDays[2] else "more settlers."))
	else:
		more = " Your outpost has grown into a city!"
	if c.stage >= 2:
		more += " Town spirit: " + str(Js.mround(c.spirit)) + "%" + (", so the settlers will lend a hand in the morning." if c.spirit >= R.spiritHelp else (". The town is struggling and will need part of your dinner tomorrow." if c.spirit < R.spiritLow else "."))
	return "<div class=\"info-row" + (" good" if c.ok else "") + "\"><span class=\"ic\">🌍</span><div><b>Earth is watching · " + Js.num(c.days) + " self-sustaining " + day_word().to_lower() + ("" if c.days == 1 else "s") + "</b><p>" + esc(why + more) + "</p></div></div>"


func night_modal(r: Dictionary) -> void:
	var dw := day_word()
	var names := { "air": "Air", "food": "Food", "dose": "Radiation badge", "water": "Water tank", "filter": "Air filter" }
	var rows := ""
	for l in r.lines:
		var b: float = r.before[l.res]
		var a: float = r.after[l.res]
		var unit := "%" if l.res == "dose" or l.res == "filter" else ""
		var better := a < b if l.res == "dose" else a > b
		var same := Js.mround(a) == Js.mround(b)
		var col := "" if same else (" style=\"color:#4dff9a\"" if better else " style=\"color:#ff9aa8\"")
		rows += "<div class=\"rep\"><b>" + l.icon + " " + names[l.res] + "</b>   <small>" + str(Js.mround(b)) + unit + " → </small><b><span" + col + ">" + str(Js.mround(a)) + unit + "</span></b><ul>"
		for p in l.parts:
			var good: bool = p.v < 0 if l.res == "dose" else p.v > 0
			rows += "<li>" + esc(p.text) + ((" <b><span style=\"color:" + ("#4dff9a" if good else "#ff9aa8") + "\">" + ("+" if p.v > 0 else "") + Js.num(p.v) + unit + "</span></b>") if p.v else "") + "</li>"
		rows += "</ul></div>"
	for f in r.finds:
		journal_find(f)
	var finds := ""
	if r.finds.size():
		finds = "<h3>🔬 What you discovered today</h3>"
		for f in r.finds:
			finds += Ui.find_row(f)
	var rep := ""
	if r.get("repair"):
		var rp: Dictionary = r.repair
		var mname: String = Data.MACHINES[rp.machine].name
		if rp.get("overnight"):
			rep = "<p class=\"sub\">🔧 The crew fixed the " + mname + " overnight, but it was out of action for the rest of the day.</p>"
		else:
			var misses: int = int(rp.get("misses", 0))
			rep = "<p class=\"sub\">🔧 You fixed the " + mname + (" with help from Earth" if rp.get("asked") else " on your own") + ((" (" + str(misses) + " slip" + ("s" if misses > 1 else "") + ").") if misses else " without a single slip!") + "</p>"
	var fc := ""
	if not r.get("fail"):
		if r.get("forecast"):
			var e: Dictionary = s.site.env[r.forecast.env.kind]
			fc = "<h3>📡 Tomorrow's forecast</h3><div class=\"info-row\"><span class=\"ic\">" + e.icon + "</span><div><b>" + esc(e.label) + " · about " + cells_text(r.forecast.env.cells) + "</b><p>" + esc(e.why) + "</p></div></div>" \
				+ (Ui.weather_row(s, r.forecast.weather, true, "tomorrow") if r.forecast.get("full") else "")
		else:
			fc = "<div class=\"info-row\"><span class=\"ic\">📡</span><div><b>No forecast for tomorrow</b><p>The Radio Dish had no power today, so Earth could not tell you what is coming.</p></div></div>"
	# the science of the day: first why things happened, then real space facts
	var whys: Array = []
	for id in r.get("whys", []):
		var m = Data.mech_for(id, s.site.id)
		if m:
			whys.append(m)
	var why := ""
	if whys.size():
		why = "<h3>🧠 Why things happened today</h3><div class=\"whys\">"
		for i in mini(4, whys.size()):
			var m: Dictionary = whys[i]
			var fresh := journal_add("why", m.id)
			why += "<div class=\"why-row\"><em>" + m.icon + "</em><div><b>" + esc(m.title) + (" <span class=\"tagline\">new page</span>" if fresh else "") + "</b><span>" + esc(m.text) + "</span>" \
				+ ("<button class=\"btn ghost small\" data-act=\"holo\" data-v=\"" + m.holo + "\">▶ Play the hologram</button>" if holo_has(m.get("holo", "")) else "") + "</div></div>"
		why += "</div>" + ("<p class=\"sub\">And " + str(whys.size() - 4) + " more. They are all in your 📓 Field Journal.</p>" if whys.size() > 4 else "")
	for i in range(4, whys.size()):
		journal_add("why", whys[i].id)
	var fact := ""
	for f in r.get("facts", [r.get("fact")]):
		if f == null:
			continue
		var src = Data.SOURCES.get(f.src)
		journal_add("fact", f.id)
		fact += "<div class=\"fact\"><b>🛰️ Real space fact</b><p>" + esc(f.text) + "</p><small>Source: " + esc(src.name if src else "") + "</small></div>"
	if not r.get("fail") and r.get("dark"):
		fc += "<div class=\"info-row alert\"><span class=\"ic\">🌚</span><div><b>The long dark comes " + ("tomorrow" if r.dark == 1 else "the day after tomorrow") + "</b><p>A mountain will hide the Sun for a whole day, and the panels will make almost nothing. Mission planners know the Sun's path years ahead, so this is no surprise. Leave power cells on the Solar Rack the evening before.</p></div></div>"
	var care := "<div class=\"info-row good\"><span class=\"ic\">🫧</span><div><b>Life support looked after</b><p>The air filter never filled up and the water tank never ran dry today.</p></div></div>" if r.get("care") and not r.get("fail") else ""
	var chal := ""
	if r.day.get("goal"):
		chal = "<div class=\"info-row" + (" good" if r.get("goalDone") else "") + "\"><span class=\"ic\">🎯</span><div><b>Today's challenge: " + ("done!" if r.get("goalDone") else "not finished") + "</b><p>" + esc(r.day.goal.text) + "</p></div></div>"
	var decs: Array = s.decisions.filter(func(d): return d.sol == r.sol)
	var dec := ""
	if decs.size():
		dec = "<h3>🧭 Your big decision today</h3>"
		for d in decs:
			dec += decision_html(d, not r.get("fail") and not r.get("last"))
	if not r.get("fail") and r.get("nextDay"):
		fc += "<h3>📈 Tomorrow: " + esc(dw) + " " + str(r.sol + 1) + " · " + r.nextDay.icon + " " + esc(r.nextDay.title) + "</h3>"
		if r.harder.size():
			fc += "<ul class=\"harder\">"
			for h in r.harder:
				fc += "<li><span>" + h.icon + "</span>" + esc(h.text) + "</li>"
			fc += "</ul>"
	Au.play("bad" if r.get("fail") else "night")
	if not r.get("fail"):
		Au.music("night")
	var fact_text: String = r.fact.text if r.get("fact") else ""
	flow_modal("<h2>🌙 Night report · " + dw + " " + str(r.sol) + "</h2><p class=\"sub\">Here is how the day added up.</p>" + rows + care + chal + colony_row(r) + rep + dec + why + finds + fc + fact \
		+ "<div class=\"modal-actions\"><button class=\"btn primary\" data-act=\"next\">" + ("See what happened" if r.get("fail") else "Next " + dw.to_lower() + " ▶") + "</button></div>",
		{ "cls": "wide", "speak": "Night report. " + fact_text, "line": null if r.get("fail") or Au.voice_playing() else "night-report", "actions": {
			"holo": func(el):
				Au.play("tap")
				show_holo(Html.attr(el, "data-v")),
			"next": func():
				Au.play("page")
				Ui.close_modal()
				if r.get("fail"):
					ending = { "fail": r.fail }
					start_launch_scene()
				else:
					if not guest():
						Sim.start_sol(s)
					begin_sol() } }, ["next"], "night")


# =====================================================================
#  THE ROCKET
# =====================================================================
## The star map in the rocket: the crew picks the next planet, then lifts off. Leaving a planet opens the one after it.
func board_modal() -> void:
	if guest():
		say("When the whole crew is aboard, " + crew().name(0) + " (the host) picks the next planet and launches the rocket for everyone.", true)
		return
	Ui.modal_page(StarMap.new({ "eyebrow": "THE ROCKET · STAR MAP", "title": "Where to next?", "sub": "Pick the next planet for the crew." if crew() else "Pick your next planet.",
		"sel": next_planet(), "here": s.site.planet, "back_label": "Not yet", "back": func(): Ui.close_modal(), "pick": launch_ask }))


func launch_ask(p: String) -> void:
	Ui.modal("<div class=\"big-icon\">🚀</div><h2>Launch to " + esc(Data.SITES[p].short) + "?</h2><p>" + ("The sample case is on board." if s.caseLoaded else "The sample case is NOT on board yet. Scientists on Earth are waiting for those rocks.") \
		+ " Anything left undone stays undone!" + (" The rocket takes off with the whole crew." if crew() else "") + "</p><div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"map\">◀ Star map</button><button class=\"btn primary\" data-act=\"yes\">Launch! 🚀</button></div>",
		{ "actions": { "map": func():
			Au.play("tap")
			board_modal(),
		"yes": func():
			Au.play("tap")
			Ui.close_modal()
			next_site = p
			launch_home() } })


## The crew lifts off now. The mission is judged at this moment. It can still be lost: a late dash to the rocket costs
## air, and a fail the rules report counts.
func launch_home(text := "", vid = null, late := false) -> void:
	if mode == "launch":
		return
	var rep := Sim.end_sol(s, { "launch": true, "late": late })
	if rep.get("fail"):
		ending = { "fail": rep.fail }
		start_launch_scene("The air tanks are empty! Everyone to the rocket!" if rep.fail == "air" else "The radiation badges are full! Everyone to the rocket!", "hud-air-empty" if rep.fail == "air" else "hud-rad-full")
		return
	Sim.finish(s)
	ending = { "win": true }
	start_launch_scene(text, vid)


func fail_now(reason: String) -> void:
	s.over = { "type": "fail", "reason": reason }
	Ui.close_modal()
	crisis_open = false
	ending = { "fail": reason }
	start_launch_scene("The air tanks are empty! Everyone to the rocket!" if reason == "air" else "The radiation badges are full! Everyone to the rocket!", "hud-air-empty" if reason == "air" else "hud-rad-full")


## text, vid: Mission Control's last words before the countdown, when there are any
func start_launch_scene(text := "", vid = null) -> void:
	if ending and ending.get("win") and Data.LEVEL_ORDER.find(s.level.id) + 1 > int(done.get(s.site.planet, 0)):
		done[s.site.planet] = Data.LEVEL_ORDER.find(s.level.id) + 1
		_save_pref("done", done)
	var c = crew()
	if c and c.host:
		c.launch(text, vid, ending)
	if room != null:
		leave_room(true)
	mode = "launch"
	launch_t = 0.0
	launch_n = -1
	mini = null
	charge = null
	hide_aim()
	Au.stop_all()
	Au.music("")
	say_q.clear()
	if Actors.rover.driver:
		exit_rover_local(true)
	Actors.astro.mode = "hidden"
	for id in ["goals", "prompt", "hands", "rover-hud", "mini", "inside"]:
		Ui.show_part(id, false)
	Ui.prompt(null)
	Ui.hands(null)
	Ui.tags([])
	Ui.marks([])
	Ui.storm_fx("")
	Ui.clear_cards()
	Ui.fade(false)
	World.env.storm = 0.0
	var p := Base.rocket_pos()
	World.cam.mode = "fixed"
	World.cam.fixed = { "pos": Vector3(p.x + 34, Terrain.height(p.x + 34, p.z + 30) + 4, p.z + 30), "look": p }
	Ui.banner(null)
	if text != "":
		Ui.say(text, vid, false, radio_from(vid, ""))
		if Au.voice_playing():
			launch_t = -3.6            # when the line is spoken, the countdown waits for it


func step_launch(delta: float) -> void:
	var t0 := launch_t
	launch_t += delta
	var t := launch_t
	if t <= 0:
		return
	if t0 <= 0:
		Base.start_launch()
		Au.play("launch")
		fx_pulse("flash", 0.5)
		fx_pulse("shock", 0.6)
	World.cam.fixed.look = Base.rocket_pos()
	Ui.banner("3…" if t < 0.8 else ("2…" if t < 1.6 else ("1…" if t < 2.4 else ("🚀 LIFTOFF!" if t < 6 else null))), "safe")
	var n := 0 if t < 0.8 else (1 if t < 1.6 else (2 if t < 2.4 else 3))
	if n != launch_n:
		launch_n = n
		Au.line(["launch-3", "launch-2", "launch-1", "launch-liftoff"][n], { "plain": true })     # Mission Control counts with the banner
	if t > 9.5 and ending != null:
		var e: Dictionary = ending
		ending = null
		mode = "end"
		Ui.fade(true)
		# A win goes straight from the launch to the future of the outpost (colony add-on), and the results follow it.
		get_tree().create_timer(0.7).timeout.connect(func():
			if not e.get("win"):
				fail_modal(e.fail)
			elif has_addon("colony"):
				play_vision(true)
			else:
				win_modal())


func learned() -> String:
	var out: Array = []
	out.append("Power is limited: every cell you carried to one machine was a cell another machine did not get.")
	if fun:
		pass
	elif s.site.id == "mars":
		out.append("Mars is so far away that Earth cannot help quickly. Crews there must often decide for themselves.")
	else:
		out.append("The Moon has no air to block solar storms, so thick soil shielding really matters.")
	var storms: int = int(s.stats.get("storms", 0))
	out.append(("You lived through " + str(storms) + " solar storm" + ("s" if storms > 1 else "") + " that really happened on the Sun.") if storms else "The real Sun stayed calm for your mission. Astronauts get lucky sometimes too!")
	out.append("Ice is treasure: with electricity it becomes oxygen to breathe, and water for plants.")
	var best: float = s.stats.get("bestThrow", 0.0)
	if best > 7:
		out.append("Your longest throw flew " + str(Js.mround(best)) + " m. On Earth the same throw would only go about " + str(maxi(1, Js.mround(best * s.site.gravity / 9.81))) + " m.")
	for i in range(1, mini(s.sol, s.totalSols - 1) + 1):
		var di := Sim.day_info(s, i)
		out.append(day_word() + " " + str(i) + ", " + str(di.topic).to_lower() + ": " + str(di.learn).split(". ")[0] + ".")
	var nd: int = s.decisions.size()
	if nd:
		out.append("Some problems have no checklist. You made " + str(nd) + " big decision" + ("s" if nd > 1 else "") + " on your own, and saw what each one led to.")
	var baked: int = int(s.stats.get("baked", 0))
	if baked:
		out.append("The crew's own breath fills the air filter with carbon dioxide. You baked it clean " + str(baked) + " time" + ("s" if baked > 1 else "") + ", and each time cost a power cell that another machine did not get.")
	if s.bags > R.bagsFreeShade:
		out.append("Nothing is free: soil that blocks radiation blocks sunlight too. Your " + str(s.bags) + " bags gave a " + str(Js.mround(Sim.shield(s) * 100)) + "% shield and cost " + str(Js.mround(Sim.shade(s) * 100)) + "% of your solar power.")
	out.append("Water goes round and round: the recycler gave back most of what the crew drank, and only ice added more.")
	var html := "<ul class=\"learned\">"
	for t in out:
		html += "<li>" + esc(t) + "</li>"
	return html + "</ul>"


func decisions_block() -> String:
	if s.decisions.is_empty():
		return ""
	var html := "<h3>🧭 Your big decisions (" + str(s.decisions.size()) + ")</h3>"
	for d in s.decisions:
		html += decision_html(d, false)
	return html


func end_buttons(win: bool) -> String:
	var html := "<div class=\"modal-actions\">"
	if win and has_addon("colony"):
		html += "<button class=\"btn ghost\" data-act=\"future\">🔭 See the future again</button>"
	if win and has_addon("keepsake"):
		html += "<button class=\"btn ghost\" data-act=\"cert\">🎓 Certificate</button>"
	if has_addon("sunwatch"):
		html += "<button class=\"btn ghost\" data-act=\"sun\">☀️ Sun Watch</button>"
	if has_addon("journal"):
		html += "<button class=\"btn ghost\" data-act=\"journal\">📓 Field Journal</button>"
	html += "<button class=\"btn ghost\" data-act=\"science\">📚 The real science</button>"
	if guest():
		html += "<button class=\"btn primary\" data-act=\"leave\">Leave the crew</button></div><p class=\"sub\">The host can start the next mission for the whole crew.</p>"
	else:
		html += "<button class=\"btn ghost\" data-act=\"change\">Change mission</button><button class=\"btn primary\" data-act=\"again\">" \
			+ ("Fly to " + esc(Data.SITES[next_planet()].short) + (" with the crew ▶" if crew() else " ▶") if win and next_planet() != s.site.planet else ("Fly again with the crew ▶" if crew() else "Play again ▶")) + "</button></div>"
	return html


func end_actions() -> Dictionary:
	return {
		"science": func():
			Au.play("tap")
			science_info(),
		"journal": func(): open_journal(),
		"cert": func():
			Au.play("tap")
			ext("keepsake", "open_certificate", [certificate_info()]),
		"future": func():
			Au.play("tap")
			Ui.close_modal()
			play_vision(),
		"sun": func():
			Au.play("tap")
			ext("sunwatch", "open", [s, weather]),
		"change": func():
			Au.play("tap")
			Ui.close_modal()
			title_scene()
			Ui.show_part("title", false)
			star_map(),
		"again": func():
			if s.over and s.over.get("type") == "win":
				opts.site = next_planet()
				_save_pref("site", opts.site)
			Ui.fade(false)
			launch(),
		"leave": func():
			Au.play("tap")
			Ui.close_modal()
			crew().leave(),
	}


## The outpost decades from now: a flyover made by the colony add-on. Then the results.
## It plays by itself right after a winning launch (first = true), and again from the button on the results.
func play_vision(first := false) -> void:
	hide_hud()
	Ui.fade(false)
	mode = "vision"
	if first:
		Au.music("title")      # the theme carries the crew's flight home into the future
	var ok = ext("colony", "vision", [s, func():
		if mode != "vision":
			return
		mode = "end"
		World.cam.mode = "title"
		win_modal()])
	if not ok:
		mode = "end"
		win_modal()


## after the jingle: the last recorded line, then the theme
func end_sound(vid: String) -> void:
	get_tree().create_timer(1.7).timeout.connect(func():
		if mode == "end" and not Au.reading_on():
			Au.line(vid))
	get_tree().create_timer(3.6).timeout.connect(func():
		if mode == "end":
			Au.music("title"))


## How the Field Journal grew on this mission.
func journal_line() -> String:
	if not has_addon("journal") or s == null:
		return ""
	var c = ext("journal", "count", [s.site.id])
	return "<p class=\"sub\">📓 Field Journal: " + (("<b>" + str(pages) + " new page" + ("s" if pages > 1 else "") + "</b> on this mission · ") if pages else "") \
		+ str(c.have) + " of " + str(c.total) + " found on " + esc(s.site.name) + ". " + ("The empty pages say where to look next time." if c.have < c.total else "Every single one!") + "</p>"


func _finds_block() -> String:
	if s.finds.is_empty():
		return ""
	var html := "<h3>🔬 Your discoveries (" + str(s.finds.size()) + ")</h3>"
	for f in s.finds:
		html += Ui.find_row(f)
	return html


func win_modal() -> void:
	var rank := Sim.rank_for(s)
	var badges: Array = Sim.badges(s)
	for f in s.finds:
		journal_find(f)
	if pages >= 12:
		badges.append({ "icon": "📓", "name": "Field Scientist", "text": "Added " + str(pages) + " new pages to the Field Journal" })
	hide_hud()
	Au.play("win")
	end_sound("win-home")
	var bh := ""
	if badges.size():
		bh = "<div class=\"badges\">"
		for b in badges:
			bh += "<div class=\"info-row good\"><span class=\"ic\">" + b.icon + "</span><div><b>" + esc(b.name) + "</b><p>" + esc(b.text) + "</p></div></div>"
		bh += "</div>"
	Ui.modal("<div class=\"rank\"><div class=\"big-icon\">" + rank.icon + "</div><h2>" + esc(rank.name) + "</h2>" \
		+ "<p>Mission complete! The crew lifted off after " + str(s.totalSols) + " " + day_word().to_lower() + "s on " + esc(s.site.name) + ".</p>" \
		+ "<p class=\"sub\">" + ("The rock samples are on their way to Earth. " if s.caseLoaded else "") + esc(rank.line) + "</p></div>" \
		+ bh + journal_line() + "<h3>What you just practised</h3>" + learned() + decisions_block() + _finds_block() + end_buttons(true),
		{ "cls": "wide", "actions": end_actions(), "speak": "Mission complete! You are a " + rank.name + ". " + rank.line })


func fail_modal(reason: String) -> void:
	var f: Dictionary = Data.FAIL[reason]
	for x in s.finds:
		journal_find(x)
	hide_hud()
	Au.play("lose")
	end_sound("fail-safe")
	Ui.modal("<div class=\"rank\"><div class=\"big-icon\">" + f.icon + "</div><h2>" + esc(f.title) + "</h2></div>" \
		+ "<p>" + esc(f.text) + " You made it to " + day_word().to_lower() + " " + str(s.sol) + " of " + str(s.totalSols) + ".</p>" \
		+ "<div class=\"fact\"><b>💡 Mission Control's tip</b><p>" + esc(f.tip) + "</p><small>Real astronauts practise in simulators for years — and they fail there a lot. That is how they learn.</small></div>" \
		+ journal_line() + decisions_block() + _finds_block() + end_buttons(false),
		{ "cls": "wide" if s.decisions.size() else "", "actions": end_actions(), "speak": f.title + ". " + f.text + " " + f.tip })


# =====================================================================
#  INFO CARDS
# =====================================================================
func _row(icon: String, t: String, text: String) -> String:
	return "<div class=\"info-row\"><span class=\"ic\">" + icon + "</span><div><b>" + t + "</b><p>" + text + "</p></div></div>"


func how_info() -> void:
	var keys := ""
	if touch:
		keys = "<div class=\"keys\"><span>🕹️</span><div>Left stick: walk (push all the way to run) · drive the rover</div><span>⏸</span><div>Pause · change how long a day lasts</div><span>👆</span><div>Drag anywhere to look around</div><span>✋</span><div>Use, pick up, plug in, drill (hold)</div><span>🎯</span><div>Hold to aim a throw, let go to throw</div><span>⤴</span><div>Jump</div><span>👁</span><div>Helmet view: see through your own visor</div><span>💡</span><div>Tap a meter, a blue card or the round radio badge: your wrist tablet projects a hologram that shows why</div><span>📓</span><div>Field Journal: every piece of science you have found</div></div>"
	else:
		keys = "<div class=\"keys\"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><div>Walk · drive the rover (arrow keys work too)</div><span><kbd>Mouse</kbd></span><div>Move to look around · wheel to zoom</div><span><kbd>Alt</kbd></span><div>Hold to show the pointer and click the meters, the map or the buttons</div><span><kbd>E</kbd></span><div>Use, pick up, plug in, drill (hold)</div><span><kbd>F</kbd></span><div>Hold to aim a throw, let go to throw</div><span><kbd>Space</kbd></span><div>Jump</div><span><kbd>Shift</kbd></span><div>Run (uses more air)</div><span><kbd>Q</kbd></span><div>Put down what you are holding</div><span><kbd>V</kbd></span><div>Helmet view: see through your own visor (A and D turn you)</div><span><kbd>C</kbd></span><div>Save a postcard picture</div><span><kbd>L</kbd></span><div>Camera filter: see like a real space camera</div><span><kbd>X</kbd></span><div>Camera effects: full, lite or off</div><span><kbd>T</kbd></span><div>Wrist tablet: a hologram that shows why, about what just happened or the machine next to you</div><span><kbd>J</kbd></span><div>Field Journal: every piece of science you have found</div><span><kbd>M</kbd></span><div>Mini map: the buildings, your jobs and where you are</div><span><kbd>N</kbd></span><div>Music on or off</div><span><kbd>F11</kbd></span><div>Full screen on or off</div></div>"
	open_info("<h2>How to play</h2>" + keys \
		+ _row("🔋", "Power cells", "The Solar Rack charges a few cells each day. Carry or throw each one into a machine's socket: Air Maker, Greenhouse, Soil Bagger, Lab, Radio Dish or Rover.") \
		+ _row("🧊", "Ice = air and water", "Start the ice drills at the far crater: each one digs out a chunk by itself while you start the next. Drop it in the Air Maker to make oxygen, or in the Greenhouse tank to water the plants. The rover bed carries four things.") \
		+ _row("🫧", "Life support: the filter and the water", "The crew's breath slowly fills the CO₂ filter. A power cell at the Air Scrubber, beside the airlock, bakes it clean. One water tank serves the crew and the plants: the recycler gives back most of what the crew drinks, plants keep theirs, and only ice adds more.") \
		+ _row("🥔", "Two crops", "Lettuce is ready in under a day but fills little. Potatoes take almost two days and fill a lot. At an empty bed, " + ("the 🎯 button" if touch else "Q") + " swaps the seeds in your pocket.") \
		+ _row("💡", "Why did that happen?", "When something goes right or wrong, a blue card says why. " + ("Tap it, or tap the round radio badge," if touch else "Press T, or tap it,") + " and the tablet on your wrist projects a hologram that shows how it works. Everything you find is kept in the 📓 Field Journal.") \
		+ _row("🚙", "The rover", "It carries four things in its bed: stand beside the bed to take one out. Drive carefully! A fast crash throws the cargo out and shakes charge out of the battery.") \
		+ _row("🏘️", "The town", "Keep the outpost looking after itself and ships come from Earth: first supplies, then settlers, in the end a city. The people share your air, and a town in good spirits brings you ice, water and power.") \
		+ (_row("⛏️", "Pioneer mode", "A hard mode you pick before launch. Supplies are short, but you can break rocks into rubble, metal and glass sand and build with them" + ("" if touch else " (key B)") + ": solar panels, a battery bank, a water cistern, brick walls, an ice rig and more.") if has_addon("pioneer") else "") \
		+ _row("🛡️", "Shield and storms", "Throw soil bags onto the dome to block radiation. The solar storms are real ones from NASA records — when the alarm sounds, get inside!") \
		+ _row("🧪", "Science", "Drill rock cores at the glowing orange sites and study them in the Lab. Carry the instruments from the rocket pad to the blue rings. On the last day, load the sample case and board the rocket.") \
		+ _row("☄️", "Rocks from the sky", "Now and then a meteorite lands near the outpost. Find the fresh crater and pick up the space rock. A quake sensor pinpoints it for you.") \
		+ _row("📈", "Every day is harder", "Each morning brings one new thing to learn, a challenge to try, and an outpost that is a little more worn than yesterday.") \
		+ _row("🧭", "Crisis moments", "Sometimes something goes wrong that has no checklist, and Earth cannot help in time. You pick one of several actions, and you find out later what it led to.") \
		+ _row("⏸", "Your time", "Press ⏸ (or " + ("tap it" if touch else "the P key") + ") to pause, and to make the working day longer or shorter whenever you like."))


func science_info() -> void:
	var mission := ""
	if s and s.weather.size():
		mission = "<p><b>This mission:</b> " + ("live data" if s.weatherSource == "live" else "archived data" + (" (NASA could not be reached, so this is not live)" if s.weatherFallback else "")) \
			+ ", real dates " + Weather.pretty_date(s.weather[0].date) + " to " + Weather.pretty_date(s.weather[s.weather.size() - 1].date) + ".</p>"
	var links := ""
	for k in Data.SOURCES:
		var x: Dictionary = Data.SOURCES[k]
		links += "<li><a href=\"" + str(x.url) + "\">" + esc(x.name) + "</a></li>"
	open_info("<h2>The real science</h2><p class=\"sub\">For curious kids, parents, teachers and judges.</p>" \
		+ "<h3>Real data inside the game</h3><ul class=\"src-list\">" \
		+ "<li><b>Space weather — NASA DONKI.</b> Every storm is a real event from NASA's Space Weather Database of Notifications, Knowledge, Information: solar flares (the flash), coronal mass ejections (CMEs, clouds of solar gas) and solar energetic particle events (SEPs, the radiation). “Live” mode downloads the last 30 days when the mission starts. “May 2024” mode uses records saved inside the game (22 April – 31 May 2024) and is labelled as an archive. Each mission day replays one real calendar day.</li>" \
		+ "<li><b>What reaches you.</b> On the Moon, a storm is a particle event that NASA's satellites really measured near Earth (GOES above 100 MeV = big, above 10 MeV = medium), or a CME shock arriving (small). On Mars, no particle detector reports to DONKI, so the game checks every fast CME against the real positions of Earth and Mars on that date: how well was Mars linked by the Sun's spiral magnetic field to where it erupted? This simple rule picks out the 20 May 2024 far-side storm that NASA's Curiosity rover measured. CME arrivals at Mars come from NASA's WSA-ENLIL model. A flare alone never makes a storm.</li>" \
		+ "<li><b>Gravity.</b> Jumps, throws and the rover use the real surface gravity: 1.62 m/s² on the Moon, 3.71 m/s² on Mars. The dotted throwing arc is the real parabola.</li>" \
		+ "<li><b>Everyday radiation.</b> Mars: about 0.67 mSv per day (RAD instrument on NASA's Curiosity rover). Moon: about 1.4 mSv per day (LND instrument, Zhang et al. 2020). The Moon value is about twice the Mars value, and the game keeps that ratio.</li>" \
		+ "<li><b>Radio delay.</b> Moon: 1.3 seconds. Mars: worked out from where Earth and Mars were on the mission's real dates (an estimate, good to a few percent).</li>" \
		+ "<li><b>Discoveries and facts</b> describe real findings from NASA missions (Apollo, LCROSS, LRO, Curiosity, Opportunity, Phoenix, InSight, Perseverance) and NASA's Open Science Data Repository.</li></ul>" + mission \
		+ "<h3>What is simplified</h3><ul class=\"src-list\">" \
		+ "<li>Time is squeezed: a working day lasts a few minutes (you choose how many), plants grow in a day, and a 20-minute radio wait becomes about half a minute.</li>" \
		+ "<li>Mission Control talks to you live over the radio. On the Moon that is close to real: a message takes 1.3 seconds, like a phone call with a tiny pause. From Mars every message takes minutes, so real Mars crews will mostly hear recorded messages from Earth and solve problems on their own.</li>" \
		+ "<li>Each day is made a little harder than the one before (more air and food used, a little less power, tools that wear). Real outposts do wear down, but these amounts are game numbers.</li>" \
		+ "<li>The crisis moments are invented for your outpost, but each one is modelled on something that really happened: the 2018 Space Station air leak, Apollo 13's air filter and power-down, the mould in the Station's garden in 2015, and the Spirit rover stuck in soft soil in 2009.</li>" \
		+ "<li>The radiation badge (0–100%) is a game scale, not a medical dose. How many badge points a storm of each size costs is a game number. The timing is squeezed: the warning and the storm last seconds here, minutes to hours in real life.</li>" \
		+ "<li>Dust storms (Mars) and shadow days (Moon) are simulated, inspired by the 2018 global dust storm and the low Sun at the lunar south pole.</li>" \
		+ "<li>The rock sites are invented places. Each discovery describes what a real mission found somewhere on the Moon or Mars, not at this exact spot.</li>" \
		+ "<li>The meteorite strikes are invented events. The facts on their cards are real: the InSight lander felt a real strike on Mars in 2021, and NASA's Lunar Reconnaissance Orbiter has found new craters on the Moon.</li>" \
		+ "<li>The picture is styled like a film camera (glow, lens flare, grain). The sparkles and streaks during a solar storm copy what charged particles really do to camera sensors in space. The Heat view filter is pretend: it colours the picture by brightness, not by real temperature.</li>" \
		+ "<li>Life support is squeezed too. Real air scrubbers and water recyclers run all the time on a station's own power; here one power cell bakes the CO₂ filter clean, so that you feel what it costs. The Space Station gets back about 98% of its water. The game uses 90%, wearing down a little each day.</li>" \
		+ "<li>Crops: real lettuce takes about a month and potatoes three or more. The game keeps only the trade-off: leaves are fast and small, tubers are slow and big and use less water for each bite.</li>" \
		+ "<li>Soil bags that cover the skylights and cost solar power stand for a real design problem: shielding always costs something somewhere else (weight, light, room). The 1.5% for each bag is a game number.</li>" \
		+ "<li>Wear is real, the numbers are not: an overheated drill bit that heats faster, a battery that holds less after being run flat, and solar cells that lose a little power after a strong solar storm.</li>" \
		+ "<li>The long dark (the Moon, on longer missions) is one simulated day with almost no Sun. Real south-pole crater rims are sunlit most of the year, but not all of it.</li>" \
		+ "<li>Running uses one and a half times the air: a game number for a real effect.</li>" \
		+ "<li>Rover crashes: it is true that low gravity makes a rover lighter but no easier to stop. The lost battery charge and the flying cargo are game rules.</li>" \
		+ "<li>The ice drills are simplified: one press, a few seconds, one clean chunk. Real ice there is mixed into the soil, and no one has mined it yet.</li>" \
		+ "<li>The town is imagined, built on real ideas. Its people, the air they share and the \"town spirit\" meter are game rules, not predictions.</li>" \
		+ "<li>Pioneer mode: making bricks, metal and glass from local soil is real research (\"in-situ resource use\"). Getting them by breaking a rock with a hammer, and every cost and benefit, are game rules.</li>" \
		+ "<li>Power cells, air and food are game units, tuned so that no choice is free.</li>" \
		+ "<li>Radiation is invisible. The pink glow is your suit's “sensor view” so you can tell a storm is happening.</li></ul>" \
		+ "<h3>Sources</h3><ul class=\"src-list\">" + links + "</ul>")


# =====================================================================
#  GOALS, WAYPOINTS, TAGS
# =====================================================================
var goal_list: Array = []


func goals_for() -> Dictionary:
	var g: Array = []
	var a = Actors.astro
	var c = a.carrying
	var sp: Dictionary = Base.spots
	var m: Dictionary = s.m
	var last: bool = s.sol >= s.totalSols
	var left: float = maxf(0, 1 - s.t / s.dayLength)
	var has := func(type: String) -> bool: return c != null and c.type == type
	var add := func(text: String, done, target, icon: String, optional := false):
		g.append({ "text": text, "done": true if done else false, "target": target, "icon": icon, "optional": optional })
	var rover_ice: bool = Actors.rover.bed.any(func(it): return it != null and it.type == "ice")
	var rack_or_cell = null if has.call("cell") else sp.rack
	var air_t = sp.hoppers.air if has.call("ice") or rover_ice else (sp.sockets.air if has.call("cell") else (sp.rack if m.air.power == 0 and m.air.queue > 0 else sp.ice[0]))
	if s.sol == 1:
		add.call("Walk with the stick, drag to look, and try a jump" if touch else "Walk (W A S D), move the mouse to look, jump (Space)", tut.get("moved"), null, "👟")
		add.call("Carry a power cell from the Solar Rack to the Air Maker", tut.get("airCell"), sp.sockets.air if has.call("cell") else sp.rack, "🔋")
		add.call("Fetch ice from the " + s.site.iceName + " for the Air Maker (the rover is faster!)", tut.get("ice"), air_t, "🧊")
		add.call("Greenhouse: a power cell, ice for water, then plant seeds", tut.get("grow"), sp.sockets.food if has.call("cell") else (sp.hoppers.water if has.call("ice") else sp.beds[1]), "🥬")
	else:
		var dinner := Sim.dinner(s)
		add.call("Air for today: feed the Air Maker ice and power", s.air >= (Sim.air_drain(s) * Sim.stale(s) + s.leak) * left + 3, air_t, "💨")
		if not last:
			var ripe := -1
			for i in m.food.beds.size():
				if m.food.beds[i].state == "ripe" and ripe < 0:
					ripe = i
			add.call("Dinner tonight needs " + Js.num(dinner) + " food", s.food >= dinner, sp.hoppers.pantry if has.call("crate") else (sp.beds[ripe] if ripe >= 0 else sp.beds[1]), "🥬")
	# life support only joins the list when it needs you (on the first day, once the lesson is done)
	if s.sol > 1 or tut_step >= 4:
		if s.filter < R.filterWarn and sp.sockets.get("scrub"):
			add.call("Bake the CO₂ filter: a power cell for the Air Scrubber", false, sp.sockets.scrub if has.call("cell") else sp.rack, "🫧")
		if s.water < R.waterWarn and m.food.beds.any(func(b): return b.state == "growing"):
			add.call("Water for the plants: ice for the Greenhouse tank", false, sp.hoppers.water if has.call("ice") or rover_ice else sp.ice[0], "💧")
	if s.day.get("goal"):
		add.call("Challenge: " + s.day.goal.text + Sim.day_goal_progress(s), s.today.get("goalDone"), null, "🎯", true)
	var tray_bag = null
	for it in Actors.items:
		if it.tag == "tray":
			tray_bag = it
			break
	add.call("Shield: throw soil bags onto the dome (" + str(s.bags) + "/" + Js.num(R.shieldSlots) + ")", s.bags >= R.shieldSlots,
		sp.hoppers.dome if has.call("bag") else (tray_bag.pos if tray_bag else (sp.sockets.bag if has.call("cell") else rack_or_cell)), "🛡️", true)
	var studied: int = s.finds.filter(func(f): return f.kind == "core").size()
	var geo_t = null
	var bd := 1e9
	for i in sp.drill.size():
		if Sim.cores_left(s, i) > 0:
			var d := d2(me(), sp.drill[i])
			if d < bd:
				bd = d
				geo_t = sp.drill[i]
	var core_on_me: bool = has.call("core") or Actors.rover.bed.any(func(it): return it != null and it.type == "core")
	add.call("Science: drill rock cores and study them in the Lab (" + str(studied) + "/8)", studied >= 8,
		sp.hoppers.lab if core_on_me else ((sp.sockets.lab if has.call("cell") else sp.rack) if m.lab.queue.size() and m.lab.power == 0 else geo_t), "🧪", true)
	var ni := 0
	for id in sp.inst:
		if s.inst.get(id):
			ni += 1
	var inst_item = null
	for it in Actors.items:
		if it.type == "inst" and it.state != "held":
			inst_item = it
			break
	add.call("Set up the science instruments (" + str(ni) + "/3)", ni >= 3, sp.inst[c.data.id] if has.call("inst") else (inst_item.pos if inst_item else null), "📦", true)
	if not s.get("lookout") and has_addon("observe") and s.sol >= 2:
		add.call("Optional: sit on the lookout rock and watch the sky", false, Terrain.at("seat", 1.2), "🌄", true)
	if colony_visit:
		add.call("Visit the new settlement: people from Earth!", false, Terrain.at("colony"), "🏘️", true)
	var rock = ext("sky", "goal", [s])
	if rock:
		add.call(rock.text, false, rock.get("target"), "☄️", true)
	if last:
		add.call("Load the sample case into the rocket", s.caseLoaded, sp.hoppers.cargo if has.call("case") else (case_item.pos if case_item else null), "🧳")
		add.call("Board the rocket before the shift ends", false, sp.rocketDoor, "🚀")
	else:
		add.call("Be inside before the shift ends", false, sp.door if left < 0.2 else null, "🏠")
	# which one is "now": on day 1 the lesson steps come first; later, survival first, then whatever you are carrying for
	var now := -1
	for i in g.size():
		if not g[i].done and not g[i].optional and (g[i].target != null or g[i].icon == "👟"):
			now = i
			break
	if c:
		var match_icon := { "bag": "🛡️", "core": "🧪", "inst": "📦", "case": "🧳", "crate": "🥬" }
		for i in g.size():
			if not g[i].done and g[i].target != null and match_icon.get(c.type, "") == g[i].icon:
				now = i
				break
	if now < 0 or ((g[now].icon == "🏠" or g[now].icon == "🚀") and left > 0.25):
		for i in g.size():
			if not g[i].done and g[i].optional and g[i].target != null:
				now = i
				break
	if now >= 0:
		g[now].now = true
	return { "list": g, "now": g[now] if now >= 0 else null }


const TUT_LINES := [null,
	"Power cells charge on the Solar Rack. Walk up to one and grab it, then carry it to the Air Maker's socket.",
	"Now the Air Maker needs ice to turn into oxygen. The ice is far away — plug a cell into the back of the rover and drive there!",
	"Next: food. The Greenhouse needs light from a power cell, water from ice, and seeds in the beds.",
	"You have got the basics! Now you choose: soil bags for the shield, rock cores for science, or the instruments by the rocket. There is not enough power for everything!"]
const TUT_VOX := [null, "rack-intro", "air-intro", "food-intro", "act-basics-done"]


func tutorial_talk() -> void:
	var t := tut
	var step := 0 if not t.get("moved") else (1 if not t.get("airCell") else (2 if not t.get("ice") else (3 if not t.get("grow") else 4)))
	if step > tut_step:
		tut_step = step
		if TUT_LINES[step]:
			say(TUT_LINES[step], true, TUT_VOX[step])
			Au.play("good")


func _screen() -> Vector2:
	return Ui.root.size if Ui.root else get_viewport().get_visible_rect().size


func place_mark(list: Array, pos: Vector3, icon: String, lbl: String, cls: String, color: String) -> void:
	var p := World.project(pos)
	var sz := _screen()
	var cx := sz.x / 2
	var cy := sz.y / 2
	var x: float = p.x
	var y: float = p.y - 26
	var mx := 44.0
	var top := 150.0
	var bot := 130.0
	var dx := x - cx
	var dy := y - cy
	if p.hidden:
		dx = -dx
		dy = -dy
		if absf(dy) < 40:
			dy = 200
	var off: bool = p.hidden or x < mx or x > sz.x - mx or y < top or y > sz.y - bot
	if off:
		var sx := 1e9 if dx == 0 else ((sz.x - mx - cx) if dx > 0 else (cx - mx)) / absf(dx)
		var sy := 1e9 if dy == 0 else ((sz.y - bot - cy) if dy > 0 else (cy - top)) / absf(dy)
		var k := minf(sx, sy)
		x = cx + dx * k
		y = cy + dy * k
	list.append({ "x": x, "y": y, "icon": icon, "label": lbl, "cls": cls, "color": color })


# ---------- the mini map (M or the 🗺️ button) ----------
var map_open := false


func toggle_map(on = null) -> void:
	map_open = (not map_open) if on == null else bool(on)
	_save_pref("map", map_open)
	Ui.set_setting("map", map_open)


const MAP_BUILD := ["hab", "scrub", "rack", "air", "food", "bag", "lab", "comms", "rocket"]


func map_frame() -> void:
	if not has_addon("minimap"):
		return
	var on: bool = map_open and s != null and mode == "play" and room == null
	ext("minimap", "show", [on])
	if not on:
		return
	var sp: Dictionary = Base.spots
	var drive: bool = Actors.rover.driver
	var f := World.forward()
	var goals: Array = []
	var spots: Array = []
	for gl in goal_list:
		if not gl.done and gl.target != null:
			goals.append({ "x": gl.target.x, "z": gl.target.z, "icon": gl.icon, "now": gl.get("now", false) })
	for i in sp.drill.size():
		if Sim.cores_left(s, i) > 0:
			spots.append({ "x": sp.drill[i].x, "z": sp.drill[i].z, "icon": Data.GEO[s.site.id][i].icon, "color": "#ffb84d" })
	for id in sp.inst:
		if not s.inst.get(id):
			spots.append({ "x": sp.inst[id].x, "z": sp.inst[id].z, "icon": "📍", "color": "#5cf0ff" })
	for i in sp.photo.size():
		if not s.photos.get(i):
			spots.append({ "x": sp.photo[i].x, "z": sp.photo[i].z, "icon": "📸", "color": "#ffd23f" })
	var rk: Vector3 = Base.P.rocket.base
	var builds: Array = []
	for k in MAP_BUILD:
		if Base.pos.get(k) != null:
			builds.append({ "key": k, "x": Base.pos[k].x, "z": Base.pos[k].z })
	var ice: Vector2 = Terrain.L.ice
	ext("minimap", "draw", [{
		"me": me(), "yaw": Actors.rover.yaw if drive else Actors.astro.yaw, "fx": f.x, "fz": f.z, "t": clock,
		"buildings": builds, "goals": goals, "spots": spots, "rover": null if drive else Actors.rover.pos,
		"ice": { "x": ice.x, "z": ice.y, "r": Terrain.ice_r }, "pad": { "x": rk.x, "z": rk.z, "r": 12 },
		"craters": Terrain.craters, "playR": Terrain.PLAY_R }])


var radio_live := false


func hud_frame() -> void:
	map_frame()
	var a = Actors.astro
	var sp: Dictionary = Base.spots
	var pos := me()
	if s == null or mode in ["title", "brief", "end", "night", "intro", "vision"]:
		return
	Ui.set_hud(s)
	if mode != "play" and mode != "inside":
		Ui.tags([])
		Ui.marks([])
		Ui.prompt(null)
		return
	# prompt + hands
	var key_label := "✋" if touch else "E"
	if mini != null or charge != null or cut != null:
		Ui.prompt(null)
	elif action:
		Ui.prompt(str(action.label) + (("  ·  " + ("🎯" if touch else "Q") + ": " + str(action.altLabel)) if action.has("alt") else ""), key_label, not action.has("run"))
	else:
		Ui.prompt(null)
	if a.carrying and not Actors.rover.driver and mode == "play":
		Ui.hands(a.carrying, charge.power if charge != null else 0.0, "Let go to throw!" if charge != null else ("Hold 🎯 to aim a throw" if touch else "Hold F to aim a throw · Q puts it down"))
	else:
		Ui.hands(null)
	Ui.rover_hud(s.m.rover.charge, Actors.rover.driver and mode == "play", Sim.rover_cap(s))
	# goals + Mission Control
	if clock > goal_at:
		goal_at = clock + 0.3
		var gl := goals_for()
		goal = gl.now
		goal_list = gl.list
		Ui.set_goals("First day" if s.sol == 1 else ("Launch day" if s.sol >= s.totalSols else "Today"), gl.list)
		if s.sol == 1:
			if not tut.get("grow"):
				check_grow()
			tutorial_talk()
		# Mission Control's advice comes with its reason, and with a hologram when the tablet has one
		if clock > hint_at and (s.sol > 1 or tut_step >= 4):
			hint_at = clock + 9
			var h = Sim.hint_info(s)
			if h:
				say(h.text + ((" " + h.why) if h.get("why") else ""), false, Au.voice_for(h.text), false, h.get("topic", ""))
		if colony_visit and mode == "play" and d2(pos, Terrain.at("colony")) < 30:
			colony_visit = 0
			Au.play("discovery")
			say("Welcome to the new settlement! People came all the way from Earth because your outpost could look after itself.", true)
		if mode == "play" and not tips.get("pov") and not pov and clock > (80 if s.sol == 1 else 15) and clock > say_at + 4:
			tip("pov", "Tap 👁 to look through your own visor!" if touch else "Press V to look through your own visor. Press V again to come back.")
	if mode != "play":
		Ui.tags([])
		Ui.marks([])
		return
	# tags over machines
	var sz := _screen()
	var tags: Array = []
	var m: Dictionary = s.m
	var tag := func(p: Vector3, text: String, cls: String):
		if d2(pos, p) > 62:
			return
		var q := World.project(p)
		if q.hidden or q.x < 40 or q.x > sz.x - 40 or q.y < 110 or q.y > sz.y - 60:
			return
		tags.append({ "x": q.x, "y": q.y, "text": text, "cls": cls })
	var br := func(o) -> String: return "bad" if o.broken else ""
	var rmax := Sim.rack_max(s)
	tag.call(Base.pos.rack, "☀️ Solar Rack · " + str(s.rack.cells) + " 🔋" + (" · BROKEN" if s.rack.broken else ""), br.call(s.rack) if s.rack.broken else ("warn" if s.rack.cells >= rmax else ""))
	tag.call(Base.pos.air, "💨 Air Maker · ⚡" + Js.num(m.air.power) + " 🧊" + Js.num(m.air.queue) + (" · BROKEN" if m.air.broken else ""), "bad" if m.air.broken else ("warn" if m.air.power == 0 or m.air.queue == 0 else ""))
	tag.call(Base.pos.food, "🥬 Greenhouse · 💡" + ("on" if m.food.lamp > 0 else "off") + " 💧" + (str(Js.mround(s.water)) if s.water >= 1 else "dry") + (" · BROKEN" if m.food.broken else ""), "bad" if m.food.broken else ("warn" if s.water < R.waterWarn else ""))
	tag.call(Base.pos.bag, "🛡️ Soil Bagger" + ((" · making " + Js.num(m.bag.pending)) if m.bag.pending else ""), "")
	tag.call(Base.pos.lab, "🔬 Lab · ⚡" + Js.num(m.lab.power) + " 🧪" + str(m.lab.queue.size()) + (" · BROKEN" if m.lab.broken else ""), "bad" if m.lab.broken else ("warn" if m.lab.queue.size() and not m.lab.power else ""))
	tag.call(Base.pos.comms, "📡 Radio Dish · " + ("on" if m.comms.on else "off"), "")
	tag.call(Base.pos.hab, "🏠 Shield " + str(Js.mround(Sim.shield(s) * 100)) + "% · " + str(s.bags) + "/" + Js.num(R.shieldSlots) + " bags" + ((" · lamps −" + str(Js.mround(Sim.shade(s) * 100)) + "% ☀️") if Sim.shade(s) > 0 else ""), "")
	if Base.pos.get("scrub") != null:
		tag.call(Base.pos.scrub, "🫧 Air Scrubber · filter " + str(Js.mround(s.filter)) + "%", "warn" if s.filter < R.filterWarn else "")
	for k in rigs.size():
		var rig: Dictionary = rigs[k]
		if rig.state != "idle":
			tag.call(sp.ice[k] + Vector3(0, 2.8, 0), ("🧊 Drilling " + str(Js.mround(rig.p * 100)) + "%") if rig.state == "drill" else ("🧊 Cooling " + str(ceili(rig.t)) + " s"), "")
	if not Actors.rover.driver:
		tag.call(Actors.rover.pos + Vector3(0, 5, 0), "🚙 Rover · " + str(ceili(m.rover.charge)) + " s", "warn" if m.rover.charge <= 0 else "")
	if s.sol >= s.totalSols:
		tag.call(Base.pos.rocket, "🚀 Rocket" + (" · samples on board" if s.caseLoaded else ""), "")
	Ui.tags(tags)
	# waypoints
	var marks: Array = []
	var ph := Sim.storm_phase(s)
	var alarm := ph == "warning" or ph == "active"
	var gt = goal.target if goal else null
	var far := func(p: Vector3, mn: float) -> bool: return d2(pos, p) > mn and (gt == null or d2(gt, p) > 5)
	var lbl := func(p: Vector3) -> String: return str(Js.mround(d2(pos, p))) + " m"
	if gt != null and d2(pos, gt) > 4:
		place_mark(marks, gt + Vector3(0, 2.2, 0), goal.get("icon", "🎯"), lbl.call(gt), "goal", "#ffd23f")
	if alarm or far.call(sp.door, 34):
		place_mark(marks, sp.door + Vector3(0, 6, 0), "🏠", lbl.call(sp.door), "alarm" if alarm else "", "#4dff9a")
	if not Actors.rover.driver and far.call(Actors.rover.pos, 22):
		place_mark(marks, Actors.rover.pos + Vector3(0, 4, 0), "🚙", lbl.call(Actors.rover.pos), "", "#9fe8ff")
	var icep := Terrain.at("ice", 6)
	if far.call(icep, 36):
		place_mark(marks, icep, "🧊", lbl.call(icep), "small", "#4fd8ff")
	for i in sp.drill.size():
		if Sim.cores_left(s, i) > 0 and far.call(sp.drill[i], 14):
			place_mark(marks, sp.drill[i] + Vector3(0, 4, 0), Data.GEO[s.site.id][i].icon, "", "small", "#ffb84d")
	for id in sp.inst:
		if not s.inst.get(id) and far.call(sp.inst[id], 14):
			place_mark(marks, sp.inst[id] + Vector3(0, 4, 0), "📍", "", "small", "#5cf0ff")
	for i in sp.photo.size():
		if not s.photos.get(i) and far.call(sp.photo[i], 14):
			place_mark(marks, sp.photo[i] + Vector3(0, 4, 0), "📸", "", "small", "#ffd23f")
	var crater = ext("sky", "marker", [s, pos])
	if crater is Vector3:
		place_mark(marks, crater, "☄️", lbl.call(crater), "", "#ffb347")
	Ui.marks(marks)


# =====================================================================
#  SAVED PREFERENCES (user://settings.cfg)
# =====================================================================
const PREFS := "user://settings.cfg"


func _save_pref(key: String, value) -> void:
	var cf := ConfigFile.new()
	cf.load(PREFS)
	cf.set_value("game", key, value)
	cf.save(PREFS)


func _load_pref(key: String, def = null):
	var cf := ConfigFile.new()
	if cf.load(PREFS) != OK or not cf.has_section_key("game", key):
		return def
	return cf.get_value("game", key, def)


# =====================================================================
#  INPUT
# =====================================================================
## keyboard: the physical key, so W A S D sit in the same place on every layout
const KEYMAP := { KEY_LEFT: "left", KEY_A: "left", KEY_RIGHT: "right", KEY_D: "right", KEY_UP: "up", KEY_W: "up", KEY_DOWN: "down", KEY_S: "down" }
var drag := false
var drag_btn := 0
var pad := { "x": 0.0, "z": 0.0, "lx": 0.0, "ly": 0.0 }
## Mouse look: while you play, the pointer is hidden and moving the mouse turns the camera. The pointer comes back
## whenever a card, a menu, the pause screen or the settings are open, and while you hold Alt (to click the meters,
## the map, the job list or the buttons indoors).
const MOUSE_LOOK := 0.6          # per pixel, mouse look turns this much of what a drag turns
var alt_held := false


func _play_or_inside() -> bool:
	return mode == "play" or mode == "inside"


func _pause_open() -> bool:
	return Ui.modal_open() and Ui.modal_doc != null and str(Ui.modal_doc.get_meta("cls", "")).find("pause") >= 0


func _mouse_look_wanted() -> bool:
	if alt_held or not get_window().has_focus():
		return false
	if mode != "play" and mode != "observe" and not (mode == "inside" and cut == null):
		return false
	return not (Ui.modal_open() or info_open() or holo_open() or Ui.typing() or (Ui.settings_menu != null and Ui.settings_menu.visible))


## every frame: hide and lock the pointer for mouse look, or give it back
func _sync_mouse() -> void:
	var want := Input.MOUSE_MODE_CAPTURED if _mouse_look_wanted() else Input.MOUSE_MODE_VISIBLE
	if Input.mouse_mode != want:
		Input.mouse_mode = want
		drag = false


func _input(e: InputEvent) -> void:
	if e is InputEventKey and e.physical_keycode == KEY_ALT and not e.echo:
		alt_held = e.pressed
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		if e is InputEventMouseMotion:
			_look(e.screen_relative * MOUSE_LOOK)        # screen pixels: the same feel at any window size
			get_viewport().set_input_as_handled()
			return
		if e is InputEventMouseButton and e.button_index != MOUSE_BUTTON_WHEEL_UP and e.button_index != MOUSE_BUTTON_WHEEL_DOWN:
			get_viewport().set_input_as_handled()       # the hidden pointer must not click the HUD under it
			return
	# releases always count, whatever has the focus, so no key is ever left stuck down
	if e is InputEventKey and not e.pressed:
		var k = KEYMAP.get(e.physical_keycode)
		if k:
			keys[k] = false
		match e.physical_keycode:
			KEY_E, KEY_ENTER, KEY_KP_ENTER:
				e_held = false
			KEY_F:
				f_held = false
			KEY_SHIFT:
				keys.shift = false
		return
	if e is InputEventJoypadButton and not e.pressed:
		match e.button_index:
			JOY_BUTTON_X:
				e_held = false
			JOY_BUTTON_RIGHT_SHOULDER:
				f_held = false
		return
	if e is InputEventKey and e.pressed and e.physical_keycode == KEY_F11 and not e.echo:
		var fs := DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fs else DisplayServer.WINDOW_MODE_FULLSCREEN)
		get_viewport().set_input_as_handled()
		return
	if e is InputEventKey and e.pressed:
		_key_down(e)
	elif e is InputEventJoypadButton and e.pressed:
		_pad_down(e)


func _key_down(e: InputEventKey) -> void:
	if holo_open() or Ui.typing():
		return                                   # the hologram has the keyboard while it plays
	var code := e.physical_keycode
	var rep := e.echo
	if code == KEY_ESCAPE and Ui.settings_menu and Ui.settings_menu.visible:
		Ui.settings_menu.visible = false
		get_viewport().set_input_as_handled()
		return
	if Ui.modal_open() or info_open():
		if code == KEY_ESCAPE and info_open():
			close_info()
			get_viewport().set_input_as_handled()
		elif (code == KEY_ESCAPE or code == KEY_P) and not info_open() and not rep and _pause_open():
			Au.play("tap")
			Ui.close_modal()
			get_viewport().set_input_as_handled()
		return
	var handled := true
	var k = KEYMAP.get(code)
	if k:
		keys[k] = true
	match code:
		KEY_SPACE:
			if not rep:
				input.jump = true
		KEY_E, KEY_ENTER, KEY_KP_ENTER:
			if not rep:
				e_pressed = true
			e_held = true
		KEY_F:
			f_held = true
		KEY_Q:
			if not rep:
				q_pressed = true
		KEY_SHIFT:
			keys.shift = true
		KEY_H:
			if _play_or_inside():
				how_info()
		KEY_V:
			if not rep and _play_or_inside():
				set_pov(not pov)
			elif not rep and mode == "observe":
				ext("observe", "toggle_view")
		KEY_C:
			if not rep:
				snap_postcard()
		KEY_T:
			if not rep:
				ask_why()
		KEY_J:
			if not rep and _play_or_inside():
				open_journal()
		KEY_B:
			if not rep and _play_or_inside():
				ext("pioneer", "menu")
		KEY_L:
			if not rep and _play_or_inside():
				next_filter()
		KEY_X:
			if not rep and has_addon("fx") and ext("fx", "available") == true:
				next_fx()
				var sz := _screen()
				Ui.toast("Camera effects: " + str(ext("fx", "level_name")).to_lower(), sz.x / 2, sz.y * 0.3, "#ffd23f")
		KEY_M:
			if not rep and _play_or_inside():
				Au.play("tap")
				toggle_map()
		KEY_N:
			if not rep:
				set_music(not music_on())
				if mode == "play":
					say("Music on." if music_on() else "Music off.", true)
		KEY_ESCAPE, KEY_P:
			if not rep:
				if mode == "intro":
					ext("intro", "skip")
				elif mode == "observe":
					if code == KEY_ESCAPE:
						ext("observe", "stand", [pov])
				else:
					pause_modal()
		_:
			handled = k != null
	if handled and mode != "title":
		get_viewport().set_input_as_handled()


## a game controller: the left stick walks, the right stick looks, A jumps, X uses, the right bumper throws
func _pad_down(e: InputEventJoypadButton) -> void:
	if holo_open():
		return
	if Ui.modal_open() or info_open():
		if e.button_index == JOY_BUTTON_B and info_open():
			close_info()
		elif e.button_index == JOY_BUTTON_START and _pause_open():
			Ui.close_modal()
		return
	match e.button_index:
		JOY_BUTTON_A:
			input.jump = true
		JOY_BUTTON_X:
			e_pressed = true
			e_held = true
		JOY_BUTTON_B:
			q_pressed = true
		JOY_BUTTON_RIGHT_SHOULDER:
			f_held = true
		JOY_BUTTON_Y:
			if _play_or_inside():
				set_pov(not pov)
		JOY_BUTTON_LEFT_SHOULDER:
			ask_why()
		JOY_BUTTON_BACK:
			if _play_or_inside():
				toggle_map()
		JOY_BUTTON_START:
			if mode == "intro":
				ext("intro", "skip")
			elif mode == "observe":
				ext("observe", "stand", [pov])
			else:
				pause_modal()


## wheel to zoom; drag to look while the pointer shows (whatever the HUD did not take). Mouse look is in _input.
func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if not e.pressed:
				return
			var down: bool = e.button_index == MOUSE_BUTTON_WHEEL_DOWN
			if mode == "observe":
				ext("observe", "zoom", [100.0 if down else -100.0])
			else:
				zoom = clampf(zoom * (1.1 if down else 0.9), 6, 22)
			return
		if e.button_index == MOUSE_BUTTON_LEFT or e.button_index == MOUSE_BUTTON_RIGHT:
			if e.pressed and not drag:
				drag = true
				drag_btn = e.button_index
				Au.unlock()
				Au.gen.unlock()
			elif not e.pressed and e.button_index == drag_btn:
				drag = false
	elif e is InputEventMouseMotion and drag:
		_look(e.relative)
	elif e is InputEventScreenDrag:
		_look(e.relative)


func _look(rel: Vector2) -> void:
	if mode == "observe":
		ext("observe", "look", [rel.x, rel.y])
		return
	# outdoors, and inside the habitat or the rocket (but not while the camera is busy with a Mission Control cutaway)
	if mode != "play" and not (mode == "inside" and cut == null):
		return
	World.look_by(rel.x * 0.0055, rel.y * 0.004)
	look_idle = 0.0


## leaving the window lets go of every key. A throw that was being aimed is cancelled, not thrown.
func let_go() -> void:
	keys = {}
	e_held = false
	drag = false
	alt_held = false
	if charge != null:
		charge = null
		if Actors.astro:
			Actors.astro.aim = false
		hide_aim()
		Au.stop_loop("aim")
	f_held = false


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		let_go()
	elif what == NOTIFICATION_APPLICATION_PAUSED:
		let_go()
		Au.hush(true)
		Au.gen.hush()
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		Au.gen.resume()


static func _dead(v: float) -> float:
	return 0.0 if absf(v) < 0.18 else (v - signf(v) * 0.18) / 0.82


func _read_pad() -> void:
	var joys := Input.get_connected_joypads()
	if joys.is_empty():
		pad.x = 0.0
		pad.z = 0.0
		pad.lx = 0.0
		pad.ly = 0.0
		return
	var j: int = joys[0]
	pad.x = _dead(Input.get_joy_axis(j, JOY_AXIS_LEFT_X))
	pad.z = _dead(Input.get_joy_axis(j, JOY_AXIS_LEFT_Y))
	pad.lx = _dead(Input.get_joy_axis(j, JOY_AXIS_RIGHT_X))
	pad.ly = _dead(Input.get_joy_axis(j, JOY_AXIS_RIGHT_Y))


# =====================================================================
#  LITTLE MOMENTS FROM THE PHYSICS
# =====================================================================
func bind_physics() -> void:
	Actors.on_jump = func():
		Au.play("jump")
		tut.jumped = true
		if s:
			tip("jump", "Wheee! The Moon's gravity is only one-sixth of Earth's, so you jump six times higher." if s.site.id == "moon" else "Boing! Mars gravity is about 38% of Earth's, so you jump more than twice as high.")
	Actors.on_land = func(rover):
		Au.play("thud" if rover else "land")
		if not rover and room == null:
			World.dust(Actors.astro.pos.x, Actors.astro.pos.z, 8, 2, 0.45)
	Actors.on_bonk = func():
		fx_pulse("shock", 0.45)
		Au.play("thud")
		World.cam.shake = maxf(World.cam.shake, 0.12)
		tip("bonk", "Bonk! In low gravity even a small jump reaches the ceiling indoors. Mind your helmet!")
	Actors.on_step = func(p: Vector3, yaw: float, side: int, sprint: bool, who):
		if who != null and who != Actors.astro:             # a crewmate's footstep: a print in the dust, heard where it is
			if who.get("room") if who is Dictionary else false:
				return
			World.print_at(p.x + cos(yaw) * 0.2 * side, p.z - sin(yaw) * 0.2 * side, yaw, 0.24, 0.46)
			if sprint or randf() < 0.3:
				World.dust(p.x, p.z, 3 if sprint else 1, 0.9, 0.3)
			Au.play("step", { "at": p, "vol": 0.6 })
			return
		if room != null:
			Au.play("step")
			return
		World.print_at(p.x + cos(yaw) * 0.2 * side, p.z - sin(yaw) * 0.2 * side, yaw, 0.24, 0.46)
		if sprint or randf() < 0.5:
			World.dust(p.x, p.z, 3 if sprint else 1, 0.9, 0.3)
		Au.play("step", { "vol": 1.25 } if sprint else {})
	Actors.on_bounce = func(it, hit: float):
		if hit > 2:
			Au.play("thud", { "at": it.pos, "vol": minf(1, hit / 6) })
		World.dust(it.pos.x, it.pos.z, 4, 1.4, 0.35)
	# A thing in the air does not bounce off the very place that is about to take it (a socket, a funnel, the dome, the rover bed).
	Actors.skip_hit = func(it) -> bool:
		for z in zones:
			if not zone_takes(z, it):
				continue
			var at := zone_pos(z)
			if z.get("flat", false):
				if Vector2(it.pos.x - at.x, it.pos.z - at.z).length() < z.r and it.pos.y < at.y + z.top:
					return true
			elif it.pos.distance_to(at) < z.r:
				return true
		return false
	# The rover hit something. A bump shakes you; a real crash throws the cargo out and shakes charge out of the battery.
	Actors.on_crash = func(impact: float, _col, before: float):
		var r = Actors.rover
		var hard: bool = impact >= R.crashHard
		var dir := 1.0 if before > 0 else -1.0
		Au.play("thud", { "at": r.pos, "vol": minf(1, 0.5 + impact / 12) })
		World.cam.shake = maxf(World.cam.shake, 0.55 if hard else 0.22)
		fx_pulse("shock", 0.8 if hard else 0.35)
		World.dust(r.pos.x + sin(r.yaw) * 2.3 * dir, r.pos.z + cos(r.yaw) * 2.3 * dir, 16 if hard else 8, 3, 0.7)
		if s == null or mode != "play":
			return
		if guest():
			crew().op("crash", [impact, before])        # the host's game spills the cargo
			return
		if crew():
			crew().mine(func(): crash_rules(impact, before))
		else:
			crash_rules(impact, before)
	Actors.on_edge = func(): say("That is as far as the outpost radio can reach. Turn back, Commander!")
	Actors.on_devil = func(kind):
		if s == null or not _play_or_inside():
			return
		# (cleaning the panels is decided by the mission rules: see the 'devil' event in handle_events)
		if kind == "astro":
			tip("devil2", "Whee! A dust devil! Mars air is so thin that it feels like a gentle breeze.")


## what a crash does to the mission (on the host for a guest's crash too: Actors.astro is then the guest's astronaut)
func crash_rules(impact: float, before: float) -> void:
	var r = Actors.rover
	var hard: bool = impact >= R.crashHard
	var dir := 1.0 if before > 0 else -1.0
	var spilled := 0
	var fx_: float = r.pos.x + sin(r.yaw) * 2.3 * dir
	var fz: float = r.pos.z + cos(r.yaw) * 2.3 * dir
	Sim.crash(s, impact)
	if not hard:
		tip("bump", "Bump! Mind the rocks: out here the rover needs a long way to stop.", "?", "gravity")
		return
	Au.play("bad")
	Au.play("spark", { "at": r.pos })
	World.burst(fx_, r.pos.y + 1.1, fz, 22, 6, 0xffe36a, { "life": 0.6, "size": 0.22 })
	for k in r.bed.size():
		var it = r.bed[k]
		if it == null:
			continue
		r.bed[k] = null
		it.slot = -1
		it.state = "fly"
		it.from = null
		it.spin = 6.0
		it.extra.hold = clock + 1.5
		spilled += 1
		it.vel = Vector3(sin(r.yaw) * before * 0.5 + (randf() - 0.5) * 5, 3 + randf() * 2.5, cos(r.yaw) * before * 0.5 + (randf() - 0.5) * 5)
	say("Crash! " + ("The cargo flew out of the bed, and the" if spilled else "The") + " jolt shook " + Js.num(R.crashCharge) + " seconds of charge out of the battery. Slow down near rocks and machines!", true, "?", true, "gravity")


# =====================================================================
#  THE HUD BUTTONS
# =====================================================================
const METER_HOLO := { "air": "electrolysis", "food": "plant", "dose": "dose", "filter": "scrubber", "water": "water" }


func bind_ui() -> void:
	Ui.title_actions = {
		"start": func():
			Au.unlock()
			Au.gen.unlock()
			Au.play("tap")
			Ui.show_part("title", false)
			star_map(),
		"crew": func():
			Au.unlock()
			Au.play("tap")
			if crew() == null and addons.has("crew"):
				addons.crew.open_lobby()
			elif crew() == null:
				Ui.toast("Crew mode is not available in this build.", _screen().x / 2, _screen().y * 0.7, "#ffd23f"),
		"how": func():
			Au.play("tap")
			how_info(),
		"science": func():
			Au.play("tap")
			science_info(),
		"journal": func(): open_journal(),
	}
	Ui.settings_actions = {
		"view": func(): set_pov(not pov),
		"pause": func():
			Ui.settings_menu.visible = false
			pause_modal(),
		"sound": func():
			Au.set_sound(not Au.sound_on())
			Ui.set_setting("sound", Au.sound_on())
			Au.gen.set_on(Au.sound_on() and music_on())
			_save_pref("sound", Au.sound_on())
			Au.play("tap"),
		"read": func():
			Au.set_reading(not Au.reading_on())
			Ui.set_setting("read", Au.reading_on())
			if Au.reading_on():
				Au.speak("Read aloud is on. I will read the messages to you."),
		"journal": func():
			Ui.settings_menu.visible = false
			open_journal(),
		"holo": func():
			Ui.settings_menu.visible = false
			Au.play("tap")
			holo_menu(),
		"info": func():
			Ui.settings_menu.visible = false
			Au.play("tap")
			how_info(),
		"map": func():
			Au.play("tap")
			toggle_map(),
		"sun": func():
			Au.play("tap")
			ext("sunwatch", "open", [s, weather]),
	}
	Ui.inside_actions = {
		"out": func(): exit_hab(),
		"sleep": func(): sleep_ask(),
		"fast": func():
			fast = not fast
			Ui.inside_button("fast").theme_type_variation = "BtnPrimary" if fast else "BtnGhost"
			Au.play("tap"),
		"sun": func():
			Au.play("tap")
			ext("sunwatch", "open", [s, weather]),
	}
	# the learning layer: every meter, the radio badge and each blue card can play a hologram
	Ui.on_meter = func(id: String):
		if s == null or not _play_or_inside() or Ui.modal_open() or info_open():
			return
		Au.play("tap")
		if id == "town":
			town_info()
		elif METER_HOLO.has(id):
			show_holo(METER_HOLO[id])
	Ui.on_why = func(): ask_why()
	Ui.on_holo = func(id): show_holo(id)
	Ui.set_setting("read", false)


# =====================================================================
#  THE MAIN LOOP
# =====================================================================
var was_paused := false
var last_mood := ""
var WORLD := { "mode": "", "pos": null, "s": null, "say": func(t): say(t, true), "tip": func(id, t): return tip(id, t) }


func _process(delta: float) -> void:
	if not booted:
		return
	_sync_mouse()
	advance(minf(0.05, delta))


func advance(step: float) -> void:
	dt = step
	var is_paused: bool = Ui.modal_open() or info_open() or holo_open()
	var k := keys
	_read_pad()
	var sx: float = clampf(stick.x + pad.x, -1, 1)
	var sz: float = clampf(stick.y + pad.z, -1, 1)
	input.x = clampf((1.0 if k.get("right") else 0.0) - (1.0 if k.get("left") else 0.0) + sx, -1, 1)
	input.z = clampf((1.0 if k.get("down") else 0.0) - (1.0 if k.get("up") else 0.0) + sz, -1, 1)
	input.sprint = k.get("shift", false) or Vector2(sx, sz).length() > 0.93
	input.puff = k.get("shift", false)      # a thumb always pushes the stick to the edge, so only the Shift key costs extra air
	if pad.lx != 0.0 or pad.ly != 0.0:
		_look(Vector2(pad.lx, pad.ly) * 520.0 * step)
	if pov and _play_or_inside() and Actors.rover and not Actors.rover.driver and mini == null:    # helmet view: A and D turn you
		var turn := (1.0 if k.get("right") else 0.0) - (1.0 if k.get("left") else 0.0)
		if turn != 0.0 and not is_paused:
			World.cam.yaw -= turn * 2.2 * step
			look_idle = 0.0
		input.x = clampf(sx, -1, 1)
	if is_paused and not was_paused:
		Au.stop_all()      # a card just opened: no motor or drill drone behind it
	was_paused = is_paused
	var c = crew()
	if c:
		crew_frame(step, is_paused, c)
	elif not is_paused:
		clock += step
		Ui.tick_cards(step)
		match mode:
			"play":
				step_play(step)
			"inside":
				step_inside(step)
			"launch":
				step_launch(step)
			"observe":
				step_observe(step)
		if Actors.astro:
			Actors.update(step, input if _play_or_inside() and mini == null and cut == null else null)
		if s and _play_or_inside():
			MCTX.s = s
			MCTX.weather = weather
			ext("mission", "update", [step, MCTX])
		if mode == "intro":
			ext("intro", "step", [step])
		if s and _play_or_inside():
			check_zones()
			SKY.outside = mode == "play"
			SKY.pos = me()
			ext("sky", "update", [step, s, SKY])
		if s:
			WORLD.mode = mode
			WORLD.pos = me()
			WORLD.s = s
			ext("colony", "update", [step, WORLD])
			ext("pioneer", "update", [step, s, mode, WORLD.pos])
			ext("hazards", "update", [step, s, mode])
	Base.update(step, null if mode == "title" else s)
	World.update(step)
	if c:
		c.after_frame()
	if not is_paused:
		hud_frame()
		if s and _play_or_inside():
			say_next()
	sound_frame(step, is_paused)
	var pov_on: bool = pov and _play_or_inside() and s != null and cut == null
	if pov_on:
		POV.yaw = World.cam.yaw
		POV.pos = me()
		POV.home = Base.spots.door
		POV.goal = goal.target if goal else null
		POV.goalIcon = goal.icon if goal else ""
		POV.air = s.air
		POV.moving = Vector2(input.x, input.z).length() > 0.2
		POV.effort = POV.moving and input.sprint
	ext("pov", "frame", [step, pov_on, POV if pov_on else null])
	if has_addon("fx"):
		ext("fx", "set_state", [{ "mode": mode, "site": s.site.id if s else World.site_id, "room": room if room else "", "pov": pov_on,
			"air": s.air if s and _play_or_inside() else 100.0 }])
	var mood := music_mood()
	if mood != last_mood:
		last_mood = mood
		Au.gen.set_mood(mood)
	input.jump = false
	e_pressed = false
	q_pressed = false


## Crew mode: the outpost does not stop for one player's card. Only the host's big moments (the morning card, the
## night report, a crisis) stop it, and they stop it for everyone. Your own astronaut waits while your card is open.
func crew_frame(step: float, is_paused: bool, c) -> void:
	var still: bool = c.flow_paused() if c.host else false
	var day: bool = s != null and (mode == "play" or mode == "inside" or mode == "observe")
	if not still:
		clock += step
	if not is_paused:
		Ui.tick_cards(step)
		match mode:
			"play":
				step_play(step)
			"inside":
				step_inside(step)
			"observe":
				step_observe(step)
		if mode == "intro":
			ext("intro", "step", [step])
	if mode == "launch":
		step_launch(step)
	if c.host and not still and day:
		world_step(step)
	c.frame(step)
	if Actors.astro:
		Actors.update(step, input if not is_paused and _play_or_inside() and mini == null and cut == null else null)
	if s and not still:
		if day and (c.host or s.get("sky")):
			SKY.outside = mode == "play"
			SKY.pos = me()
			ext("sky", "update", [step, s, SKY])
		WORLD.mode = mode
		WORLD.pos = me()
		WORLD.s = s
		ext("colony", "update", [step, WORLD])


## crew mode's way in (scripts/net/crew.gd): what the host's game does for a guest
var OPS := {
	"mini": func(kind, idx, q): mini_reward(str(kind), int(idx), int(q)),
	"ask_earth": func(): return ask_earth(),
	"photo": func(i):
		var f = Sim.photo(s, int(i))
		if f:
			find_card(f),
	"crash": func(impact, before): crash_rules(float(impact), float(before)),
	# a guest's message to Earth, in the host's own words (the same two messages the workstation sends)
	"mission_send": func(kind, _text = ""):
		if not has_addon("mission") or s == null:
			return
		if kind == "status":
			ext("mission", "send", [s, "status", "Status report: air " + str(Js.mround(s.air)) + "%, food " + str(Js.mround(s.food)) + "%, radiation badge " + str(Js.mround(s.dose)) + "%. Crew nominal."])
		elif kind == "help":
			ext("mission", "send", [s, "help", "Requesting guidance: which system should the crew prioritise?"]),
}


# =====================================================================
#  BOOT
# =====================================================================
func _enter_tree() -> void:
	R = Data.RULES


## the optional extras, in scripts/addons/: each one that is there and compiles is switched on
const ADDONS := ["journal", "minimap", "pov", "sky", "observe", "fx", "interior", "mission", "sunwatch", "keepsake", "holo", "colony", "pioneer", "intro", "crew", "hazards"]


func load_addons() -> void:
	for n in ADDONS:
		if has_addon(n):
			continue
		var p: String = "res://scripts/addons/" + n + ".gd"
		if not ResourceLoader.exists(p):
			continue
		var sc = load(p)
		if not (sc is Script) or not sc.can_instantiate():
			push_warning("add-on " + n + " could not load; the game carries on without it")
			continue
		var node: Node = sc.new()
		node.name = n
		register(n, node)


func boot() -> void:
	if booted:
		return
	var snd = _load_pref("sound", true)
	Au.set_sound(bool(snd))
	Ui.set_setting("sound", bool(snd))
	opts.music = bool(_load_pref("music", true))
	map_open = bool(_load_pref("map", false))
	Ui.set_setting("map", map_open)
	var won = _load_pref("done", {})
	if won is Dictionary:           # the settings file is outside input: keep only the planets and the star counts we know
		for p in Data.PLANET_ORDER:
			if won.get(p) is int or won.get(p) is float:
				done[p] = clampi(int(won[p]), 1, 3)
	var site = _load_pref("site", "moon")
	opts.site = site if site is String and unlocked(site) else "moon"       # the settings file is outside input: never trust a planet from it
	load_addons()
	build_world("mars", opts.suit)
	Actors.astro.mode = "hidden"
	bind_physics()
	bind_ui()
	title_scene()
	World.snap_camera()
	World.cam.eye = Actors.eye            # where the helmet view looks from
	booted = true
