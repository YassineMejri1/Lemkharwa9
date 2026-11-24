## Astro Outpost — crew mode: up to four astronauts in one outpost, each on their own screen (from js/crew.js).
##
## One player hosts. The host's game runs the mission exactly as in a game for one: the clock, the air and food, the
## storms, the machines, every thing you can carry, the rover and the town. The other players' games show what the
## host's game says, and send it what their astronaut does.
## - Your own astronaut moves on your own screen, at once, with no waiting for the network. Your game tells the others
##   where you are twenty times a second, and their games draw you there, smoothed over a tenth of a second.
## - What you DO (pick up, plug in, plant, start a drill, throw) goes to the host, who does it with your astronaut in its
##   world. What comes of it (the thing in your hands, the air going up) comes back to everyone.
## - Whoever drives the rover moves it on their own screen; the others see it follow.
## - The mission state goes from the host to everyone ten times a second, as the parts that changed.
## - The day's big moments (the morning card, the night report, a crisis, the launch) open on every screen; the host's
##   choice moves everyone on.
## The network is scripts/net/net.gd. game.gd calls in here at the moments that matter (look for crew() there).
##
## Command line (after --): crew=ABCDE opens the crew menu with that code filled in.
extends Node

const NET := preload("res://scripts/net/net.gd")
const SUITS := [0xff7a3d, 0x3d9bff, 0x4cd97b, 0xff5fa8, 0xb07cff]
const SUIT_NAMES := ["Orange", "Blue", "Green", "Pink", "Purple"]
const SEND_EVERY := 0.05
const STATE_EVERY := 0.1
const DELAY := 110.0
const MAX_EXTRA := 160.0
const SIM_OK := { "jam": 1, "note": 1, "repair_miss": 1, "repair_done": 1 }
const HIDDEN_MODES := ["night", "launch", "end", "brief", "intro", "vision"]
const WHY := {
	"full": "That crew is full: four astronauts already.",
	"started": "That crew has already launched its mission. Ask the host to start a new one.",
	"version": "Your friend has a different version of the game. Both of you need the same version.",
	"dropped": "The host lost touch with your game. Join again!",
	"nohost": "No crew with that code. Check the letters, and that the host is still on the crew screen.",
	"timeout": "The host did not answer. Check the code, and that the host is still on the crew screen with the game open.",
	"blocked": "Could not reach the host, neither directly nor through the relay. Check the code and your internet connection. Some school and office networks block games like this: a phone hotspot usually works.",
	"load": "Could not open a crew: no network was found. Check your connection.",
	"rejected": "The host's game said no. Try again!",
	"error": "Something went wrong with the connection. Try again.",
}

## a crewmate's states, in time order, and how far apart they come (gap) and how late they arrive (late)
class Buf:
	var e: Array = []
	var gap := 0.0
	var late := 0.0
	var last_t = null

	func clear() -> void:
		e.clear()


var N: Node                     # the network (scripts/net/net.gd)
var on := false
var host := false
var guest := false
var me := 0
var players := {}               # pid -> { pid, name, suit, buf, off, puppet, st, st_at, st_t, tag, k, shown, mode, room, out, run, rov }
var ctx := 0                    # the host is doing something for this crewmate right now (0: for itself)
var acting := 0
var rover = null                # who drives the rover (a player number), or null
var flow_open := false
var flow_kind := ""
var flow_data = null
var started := false
var local = null                # this screen's own astronaut
var pending = null
var queued: Array = []
var night_info := {}
var last_report = null
var last_crisis_x = null
var host_off = null

var _menu_code := ""
var _want_code := ""
var _room_t := 0.0
var _room_html := ""
var _knock_until := 0.0
var _layer: CanvasLayer
var _hud: PanelContainer
var _hud_box: VBoxContainer
var _hud_key := ""
var _rover_buf := Buf.new()
var _last_items := {}
var _last_state = null
var _send_t := 0.0
var _state_t := 0.0
var _seq := 0


func _ready() -> void:
	N = NET.new()
	N.name = "net"
	add_child(N)
	Game.register("net", N)
	_layer = CanvasLayer.new()
	_layer.layer = 9
	add_child(_layer)
	_hud = PanelContainer.new()
	_hud.add_theme_stylebox_override("panel", Style.box(Color(6 / 255.0, 20 / 255.0, 60 / 255.0, 0.68), 16, Color(0, 0, 0, 0), 0, Vector4(8, 6, 8, 6)))
	_hud.anchor_left = 1.0
	_hud.anchor_right = 1.0
	_hud.offset_right = -12
	_hud.offset_top = 94
	_hud.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hud.visible = false
	_hud_box = VBoxContainer.new()
	_hud_box.add_theme_constant_override("separation", 4)
	_hud.add_child(_hud_box)
	_layer.add_child(_hud)
	var invite := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("crew="):
			invite = a.substr(5)
		elif a.begins_with("crewcode="):
			_want_code = a.substr(9)
	if invite != "":
		get_tree().create_timer(0.8).timeout.connect(func():
			if Game.mode == "title" and not Ui.modal_open():
				open_menu(invite))


static func now() -> float:
	return Time.get_ticks_usec() / 1000.0


static func _dbg(t: String) -> void:
	if OS.get_cmdline_user_args().has("crewlog=1"):
		print("[crew %d] %s" % [Time.get_ticks_msec(), t])


static func _r2(v) -> float:
	return snappedf(float(v), 0.01)


static func _r3(v) -> float:
	return snappedf(float(v), 0.001)


static func _hex(c: int) -> String:
	return "#%06x" % c


static func _col(c: int) -> Color:
	return Color.hex((c << 8) | 0xFF)


static func _ang_lerp(a: float, b: float, t: float) -> float:
	return a + wrapf(b - a, -PI, PI) * t


static func esc(t) -> String:
	return Html.esc(t)


func _w() -> Vector2:
	return Game._screen()


## a copy that the network can carry: no objects, no functions
static func _clean(v):
	if v is Dictionary:
		var o := {}
		for k in v:
			var x = v[k]
			if x is Object or x is Callable or x is Signal:
				continue
			o[k] = _clean(x)
		return o
	if v is Array:
		var a := []
		for x in v:
			a.append(null if (x is Object or x is Callable or x is Signal) else _clean(x))
		return a
	return v


static func _call_act(fn: Callable, b) -> void:
	if not fn.is_valid():
		return
	if fn.get_argument_count() >= 1:
		fn.call(b)
	else:
		fn.call()


# ---------- who is in the crew ----------
func add_player(pid: int, nm: String, suit: int) -> Dictionary:
	var p = players.get(pid)
	if p == null:
		p = { "pid": pid, "buf": Buf.new(), "off": null, "puppet": null, "st": null, "st_at": 0.0, "st_t": 0.0, "tag": null,
			"k": 0, "shown": false, "mode": "", "room": "", "out": false, "run": false, "rov": null }
		players[pid] = p
	p.name = nm
	p.suit = suit
	return p


func _others() -> Array:
	var out: Array = []
	for k in players:
		if int(k) != me:
			out.append(players[k])
	return out


func _list() -> Array:
	var ks: Array = players.keys()
	ks.sort()
	var out: Array = []
	for k in ks:
		out.append({ "pid": int(k), "name": players[k].name, "suit": players[k].suit })
	return out


func name(pid) -> String:
	var p = players.get(int(pid)) if pid != null else null
	return p.name if p else "Someone"


func count() -> int:
	return players.size()


static func _clean_name(n) -> String:
	var t := str(n) if n != null else ""
	for ch in ["<", ">", "&", "\""]:
		t = t.replace(ch, "")
	t = t.strip_edges().substr(0, 14)
	return t if t != "" else "Astronaut"


func _saved_name() -> String:
	return str(Game._load_pref("crew-name", ""))


func _save_name(n: String) -> void:
	Game._save_pref("crew-name", n)


func _free_suit(want: int) -> int:
	var used := {}
	for k in players:
		used[players[k].suit] = true
	if not used.has(want):
		return want
	for c in SUITS:
		if not used.has(c):
			return c
	return want


# =====================================================================
#  THE MENUS: host or join, then the crew room
# =====================================================================
## the title screen's "Play with friends"
func open_lobby() -> void:
	if on:
		lobby()
	else:
		open_menu()


func open_menu(c := "") -> void:
	if on:
		lobby()
		return
	_menu_code = NET.clean_code(c if c != "" else _menu_code)
	var o: Dictionary = Game.opts
	var nm := _saved_name()
	Ui.show_part("title", false)
	var sw := ""
	for i in SUITS.size():
		var col: int = SUITS[i]
		sw += "<button class=\"swatch" + (" sel" if int(o.suit) == col else "") + "\" style=\"--c:" + _hex(col) + "\" data-act=\"suit\" data-v=\"" + str(col) + "\" title=\"" + SUIT_NAMES[i] + " spacesuit\"></button>"
	var doc := Ui.modal("<div class=\"big-icon\">🧑‍🚀🧑‍🚀</div><h2>Play with friends</h2>" \
		+ "<p class=\"sub\">Up to 4 astronauts share one outpost: the same air, the same power cells, the same storms. It is free and there is nothing to set up. One of you hosts, the others join with the host's crew code.</p>" \
		+ "<label class=\"crew-field\"><span>Your name</span><input id=\"crew-name\" maxlength=\"14\" value=\"" + esc(nm) + "\" placeholder=\"Astronaut\"></label>" \
		+ "<h3>Your spacesuit colour</h3><div class=\"swatches\">" + sw + "</div>" \
		+ "<div class=\"crew-ways\">" \
		+ "<div class=\"crew-way\"><b>🚀 Host a mission</b><br><span>You plan the mission and your friends join you.</span><button class=\"btn primary\" data-act=\"host\">Host</button></div>" \
		+ "<div class=\"crew-way\"><b>🔑 Join a friend</b><br><span>Type the 5-letter crew code your host sees.</span><div class=\"crew-join\"><input id=\"crew-code\" data-act=\"join\" maxlength=\"40\" placeholder=\"CODE\" value=\"" + esc(_menu_code) + "\"><button class=\"btn primary\" data-act=\"join\">Join</button></div></div>" \
		+ "</div><p class=\"crew-status\" id=\"crew-status\">·</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"back\">Back</button></div>",
		{ "cls": "crew-menu", "noFocus": true, "actions": {
			"suit": func(b):
				o.suit = int(Html.attr(b, "data-v"))
				Au.play("tap")
				_keep_typed()
				open_menu(),
			"host": func():
				Au.unlock()
				Au.play("tap")
				_start_host(),
			"join": func():
				Au.unlock()
				Au.play("tap")
				_start_join(),
			"back": func():
				Au.play("tap")
				_keep_typed()
				Ui.close_modal()
				Ui.show_part("title", true)
				Ui.focus_title(),
		} })
	_status("")
	var ci = doc.el("crew-code")
	var ni = doc.el("crew-name")
	if ci is LineEdit:
		ci.text_changed.connect(func(t: String):
			var cl := NET.clean_code(t)
			if cl != t:
				ci.text = cl
				ci.caret_column = cl.length())
	var first = ci if _menu_code != "" else ni
	if first is Control:
		first.call_deferred("grab_focus")


func _keep_typed() -> void:
	var d = Ui.modal_doc
	if d == null:
		return
	if d.el("crew-name"):
		_save_name(_clean_name(d.value("crew-name")))
	if d.el("crew-code"):
		_menu_code = NET.clean_code(d.value("crew-code"))


func _status(text: String, bad := false) -> void:
	var d = Ui.modal_doc
	if d == null or d.el("crew-status") == null:
		return
	d.set_text("crew-status", text if text != "" else " ")
	(d.el("crew-status") as Control).modulate = Color("#ff9a9a") if bad else Color(1, 1, 1, 0.85)


func _busy(yes: bool) -> void:
	var d = Ui.modal_doc
	if d == null:
		return
	for b in d.buttons:
		if is_instance_valid(b) and Html.attr(b, "data-act") != "back":
			b.disabled = yes


func _start_host() -> void:
	_keep_typed()
	var nm := _clean_name(Ui.modal_doc.value("crew-name") if Ui.modal_doc else "")
	_save_name(nm)
	_busy(true)
	_status("Opening a crew…")
	N.on = { "status": func(t): _status(t) }
	N.host(func(err, _code):
		if err != null:
			_busy(false)
			_status(WHY.get(err, WHY.error), true)
			return
		_begin(true, 0)
		add_player(0, nm, int(Game.opts.suit))
		lobby(), _want_code)


func _start_join() -> void:
	_keep_typed()
	var d = Ui.modal_doc
	var nm := _clean_name(d.value("crew-name") if d else "")
	var c := NET.clean_code(d.value("crew-code") if d else _menu_code)
	_save_name(nm)
	if c.length() != 5:
		_status("A crew code has 5 letters.", true)
		return
	_busy(true)
	_status("Calling the host…")
	N.on = { "msg": _on_message, "lost": _lost, "status": func(t): if not on: _status(t) }
	N.join(c, { "name": nm, "suit": int(Game.opts.suit) }, func(err: String):
		if err != "":
			_busy(false)
			_status(WHY.get(err, WHY.error), true)
			N.close()
			return
		_begin(false, N.me)
		_status("Joined! Waiting for the crew list…"))


## join from code (tests and invites): the same as typing it into the menu
func join_code(c: String, nm := "") -> void:
	open_menu(c)
	if nm != "" and Ui.modal_doc and Ui.modal_doc.el("crew-name"):
		(Ui.modal_doc.el("crew-name") as LineEdit).text = nm
	_start_join()


func host_now(nm := "") -> void:
	open_menu()
	if nm != "" and Ui.modal_doc and Ui.modal_doc.el("crew-name"):
		(Ui.modal_doc.el("crew-name") as LineEdit).text = nm
	_start_host()


func _begin(is_host: bool, my_pid: int) -> void:
	on = true
	host = is_host
	guest = not is_host
	me = my_pid
	players = {}
	rover = null
	started = false
	flow_open = false
	pending = null
	queued = []
	if host:
		N.on = { "join": _on_join, "leave": _on_leave, "msg": _on_message, "knock": _knock, "status": func(_t): pass }
	_room_t = 0.0
	_patch_feedback()


func leave(quiet := false) -> void:
	if not on:
		return
	if host:
		N.broadcast({ "t": "bye" })
	N.close()
	for p in _others():
		_drop_puppet(p)
	for p in players.values():
		if p.tag:
			p.tag.queue_free()
			p.tag = null
	on = false
	host = false
	guest = false
	players = {}
	rover = null
	started = false
	flow_open = false
	pending = null
	queued = []
	_unpatch_feedback()
	_hud.visible = false
	_hud_key = ""
	if Actors.rover:
		Actors.rover.remote = false
		Actors.rover.manned = false
	if not quiet:
		Game.title_scene()


# The crew room: the code to share, who is here, and (for the host) the way on to planning the mission.
# Each crewmate shows how quick their link is, and "relay" when their network would not allow a direct link.
func _room_rows() -> String:
	var rows := ""
	for q in _list():
		var pid: int = q.pid
		var rt := 0.0
		var via := ""
		if pid != me:
			rt = N.rtt_of(pid) if host else (N.rtt if pid == 0 else 0.0)
			via = N.link_of(pid) if host else (N.link_of(0) if pid == 0 else "")
		rows += "<p><span style=\"color:" + _hex(q.suit) + "\">●</span> <b>" + esc(q.name) + "</b>" \
			+ (" <span class=\"crew-badge\">· host</span>" if pid == 0 else "") \
			+ (" <span class=\"crew-relay\">· relay</span>" if via == "relay" else "") \
			+ (" <span class=\"crew-you\">· you</span>" if pid == me else ((" <small>· " + str(roundi(rt)) + " ms</small>") if rt > 0 else "")) + "</p>"
	if count() < 2 and host:
		rows += "<p class=\"sub\">Nobody else yet. Tell your friends the code!</p>"
	return rows


func _reach_text() -> String:
	var r: Dictionary = N.reach()
	var lan := "📶 Same network: " + ("ready" if r.lan else "not available")
	var net := "🌍 Over the internet: " + ("ready" if r.relay or r.open else ("connecting…" if N.R != null else "not available"))
	return lan + " · " + net


func _refresh_room() -> void:
	var d = Ui.modal_doc
	if d == null or not Ui.modal_open() or d.el("crew-list") == null:
		return
	var h := _room_rows()
	if h != _room_html:
		_room_html = h
		d.set_html("crew-list", h)
	if d.el("crew-knock"):
		(d.el("crew-knock") as Control).visible = now() < _knock_until
	if d.el("crew-reach"):
		d.set_text("crew-reach", _reach_text())


## somebody's game has reached this one and is saying hello (shown until they are in, or for a while)
func _knock(_how := "") -> void:
	_knock_until = now() + 9000.0
	_refresh_room()


func lobby() -> void:
	if not on:
		return
	if Game.mode != "title" and started:
		return              # in a mission: the crew list is in the corner of the screen
	Ui.show_part("title", false)
	var keep: bool = Ui.modal_open() and Ui.modal_doc != null and Ui.modal_doc.el("crew-list") != null
	_room_html = _room_rows()
	Ui.modal("<h2>" + ("Your crew" if host else esc(name(0)) + "'s crew") + "</h2>" \
		+ "<div class=\"crew-code\"><small>Crew code</small> <b>" + esc(N.code) + "</b>" + (" <button class=\"btn ghost\" data-act=\"copy\">📋 Copy the code</button>" if host else "") + "</div>" \
		+ ("<p class=\"sub\">Your friends start Astro Outpost, pick <b>Play with friends</b> and type this code. Up to 3 can join.</p><p class=\"sub\" id=\"crew-reach\">" + esc(_reach_text()) + "</p>" if host \
			else "<p class=\"sub\">You are in! The host plans the mission and launches it for everyone.</p>") \
		+ "<div class=\"crew-list\" id=\"crew-list\">" + _room_html + "</div>" \
		+ ("<p class=\"crew-knock\" id=\"crew-knock\">📡 Someone is connecting…</p>" if host else "") \
		+ ("<p class=\"sub\">Everyone shares the outpost: one air supply, one Solar Rack, one rover. Split the jobs and talk to each other!</p>" if host \
			else "<p class=\"crew-waiting\" id=\"crew-waiting\">⏳ Waiting for " + esc(name(0)) + " to launch the mission…</p>") \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"leave\">Leave the crew</button>" 			+ ("<button class=\"btn ghost\" data-act=\"party\">🎉 Party games</button><button class=\"btn primary\" data-act=\"plan\">Plan the mission ▶</button>" if host else "") + "</div>",
		{ "cls": "crew-room", "noFocus": keep, "actions": {
			"copy": func():
				Au.play("tap")
				DisplayServer.clipboard_set(str(N.code))
				Ui.toast("📋 Code copied: " + str(N.code), _w().x / 2, _w().y * 0.3, "#7be36a"),
			"leave": func():
				Au.play("tap")
				Ui.close_modal()
				leave(),
			"plan": func():
				Au.play("tap")
				Ui.close_modal()
				Game.star_map(),
			"party": func():
				Au.play("tap")
				Ui.close_modal()
				Game.ext("party", "open"),
		} })
	_refresh_room()


# ---------- the host hears the crew come and go ----------
func _on_join(pid: int, hi: Dictionary) -> void:
	_knock_until = 0.0
	var p := add_player(pid, _clean_name(hi.get("name")), _free_suit(int(hi.get("suit", SUITS[pid % SUITS.size()]))))
	Au.play("ding")
	_send_crew()
	if not started:
		lobby()
	else:
		Ui.toast("👋 " + p.name + " joined the crew", _w().x / 2, _w().y * 0.25, "#7be36a")
		_late_start(pid)
		if _party():
			_make_puppets()
			Game.ext("party", "joined", [pid])


## Which moment of the mission the crew is in, for a player who joins now (see late_join in game.gd).
func _moment():
	var s = Game.s
	var open: bool = flow_open and Ui.modal_open()
	if s == null or Game.mode == "title":
		return null
	if Game.mode in ["launch", "end", "vision"]:
		return { "kind": "end" }
	if Game.mode == "intro" or Game.mode == "brief":
		return { "kind": "welcome" }
	if Game.mode == "night":
		return { "kind": "night", "info": night_info, "r": last_report if last_report is Dictionary and last_report.get("sol") == s.sol else null }
	if open and flow_kind == "morning":
		return { "kind": "morning" }
	if open and flow_kind == "crisis":
		return { "kind": "crisis" }
	if open and flow_kind == "crisisResult":
		return { "kind": "crisisResult", "x": _clean(last_crisis_x) }
	return { "kind": "day" }


func _late_start(pid: int) -> void:
	var ph = _moment()
	if ph == null:
		return
	if ph.kind == "end":
		N.send(pid, { "t": "wait" })        # the rocket is leaving: they fly with the next mission
		return
	sync_now()                              # so the snapshot and the next changes line up
	_make_puppets()
	N.send(pid, { "t": "start", "opts": Game.opts.duplicate(), "data": _clean(Game.weather), "snap": _last_state, "items": _items_full(),
		"list": _list(), "rover": rover, "late": null if ph.kind == "welcome" else ph })


func _on_leave(pid: int, why: String) -> void:
	var p = players.get(pid)
	if p == null:
		return
	if started and Game.s:
		# whatever they carried falls where they stood; the rover stops where it is
		if p.puppet and p.puppet.carrying:
			Actors.with_astro(p.puppet, func(): Actors.set_down())
		if rover == pid:
			set_driver(null)
		Ui.toast("📡 " + p.name + (" left the outpost" if why == "left" or why == "closed" else " lost the connection"), _w().x / 2, _w().y * 0.25, "#ffd23f")
	_drop_puppet(p)
	players.erase(pid)
	_send_crew()
	if not started:
		lobby()


func _send_crew() -> void:
	N.broadcast({ "t": "crew", "list": _list(), "code": N.code, "started": started })


func _lost(_why := "") -> void:
	if not on:
		return
	var mid: bool = started and Game.mode != "title"
	leave(true)
	Game.title_scene()
	Ui.show_part("title", false)
	Ui.modal("<div class=\"big-icon\">📡</div><h2>" + ("The connection to the host was lost" if mid else "The crew has closed") + "</h2>" \
		+ "<p>" + ("Your game could no longer hear the host's game, so this mission is over for you. You can join again when the host starts a new mission." if mid else "The host left the crew.") + "</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn primary\" data-act=\"ok\">OK</button></div>",
		{ "actions": { "ok": func():
			Ui.close_modal()
			Ui.show_part("title", true)
			Ui.focus_title() } })


# =====================================================================
#  MESSAGES
# =====================================================================
func _on_message(pid: int, m: Dictionary) -> void:
	var t = m.get("t")
	if not (t is String) or not t.is_valid_identifier():
		return
	var fn: String = ("_h_" if host else "_g_") + str(t)
	if has_method(fn):
		call(fn, pid, m)


func _live() -> bool:
	return started and Game.s != null          # this screen has the mission (messages before that are not for it yet)


## Party mode (scripts/addons/party.gd) has no mission, but the crew's astronauts are sent and drawn all the same.
func _party() -> bool:
	return started and Game.mode == "party"


func _h_party(pid: int, m: Dictionary) -> void:
	Game.ext("party", "net", [pid, m])


func _g_party(pid: int, m: Dictionary) -> void:
	Game.ext("party", "net", [pid, m])


# ---------- the guest's side ----------
func _g_crew(_pid: int, m: Dictionary) -> void:
	var keep := {}
	var fresh: Array = []
	for q in m.get("list", []):
		var pid := int(q.pid)
		keep[pid] = true
		if not players.has(pid) and started and pid != me:
			fresh.append(q.name)
		add_player(pid, str(q.name), int(q.suit))
	if fresh.size() and Game.s and Game.mode != "title":
		Ui.toast("👋 " + ", ".join(fresh) + " joined the crew", _w().x / 2, _w().y * 0.25, "#7be36a")
	for k in players.keys():
		if not keep.has(k):
			_drop_puppet(players[k])
			players.erase(k)
	var mine = players.get(me)
	if mine:
		Game.opts.suit = mine.suit
	if not started or Game.mode == "title":
		lobby()
	else:
		_make_puppets()


func _g_bye(_pid: int, _m: Dictionary) -> void:
	_lost("left")


func _g_lobby(_pid: int, _m: Dictionary) -> void:
	started = false
	Game.title_scene()
	lobby()


func _g_start(_pid: int, m: Dictionary) -> void:
	_dbg("start arrived")
	N.busy(60000)
	started = true
	pending = null
	queued = []
	var o: Dictionary = Game.opts
	for k in ["site", "level", "sun", "shift"]:
		o[k] = m.opts.get(k, o[k])
	o.pioneer = "off"
	for q in m.get("list", []):
		add_player(int(q.pid), str(q.name), int(q.suit))
	var mine = players.get(me)
	if mine:
		o.suit = mine.suit
	Ui.close_modal()
	rover = m.get("rover")
	var snap: Dictionary = m.snap
	var s: Dictionary = snap.s
	s.site = Data.SITES[snap.site]
	s.level = Data.LEVELS[snap.level]
	s.rng = Rng32.new(int(s.get("seed", 1)))
	_last_state = snap
	Game.start_mission(m.data, { "s": s, "rigs": snap.get("rigs", []), "tut": snap.get("tut", {}), "items": m.get("items", []), "late": m.get("late") })


func _g_st(_pid: int, m: Dictionary) -> void:
	if Game.s == null or _last_state == null:
		return
	var mirror := { "s": Game.s, "rigs": Game.rigs, "tut": _last_state.get("tut", {}), "tutStep": _last_state.get("tutStep", 0) }
	for e in m.get("d", []):
		_set_path(mirror, e[0], e[1] if e.size() >= 2 else null, e.size() < 2)
	_last_state.tut = mirror.tut
	_last_state.tutStep = mirror.tutStep
	if not is_same(mirror.rigs, Game.rigs):
		Game.rigs = mirror.rigs
	# the crew's tutorial is shared (the first cell in the Air Maker counts for all); walking and jumping are your own,
	# and each screen says the tutorial's lines itself when its step moves on
	var ht = mirror.tut if mirror.tut is Dictionary else {}
	for k in ht:
		if k != "moved" and k != "jumped":
			Game.tut[k] = ht[k]
	Base.rigs = Game.rigs


func _g_items(_pid: int, m: Dictionary) -> void:
	if _live():
		_apply_items(m)


## the crew is finishing a mission (the rocket is leaving): wait in the crew room for the next one
func _g_wait(_pid: int, _m: Dictionary) -> void:
	lobby()
	var d = Ui.modal_doc
	if d and d.el("crew-waiting"):
		d.set_text("crew-waiting", "🚀 The crew is just finishing a mission. You will fly with them on the next one!")


## D: for each crewmate, how long before this packet the host heard their state (so a relayed state keeps its own time)
func _g_w(_pid: int, m: Dictionary) -> void:
	if not _live() and not _party():
		return
	var t := now()
	host_off = _offset(host_off, t - float(m.ts))
	var at: float = float(m.ts) + host_off
	var late := t - at
	var D: Dictionary = m.get("D", {})
	var P: Dictionary = m.get("P", {})
	for k in P:
		var p = players.get(int(k))
		if p == null or int(k) == me:
			continue
		_push(p.buf, { "t": at + float(D.get(k, 0)), "a": P[k] }, late)
	if m.get("R") and rover != me:
		_push(_rover_buf, { "t": at + float(m.get("RD", 0)), "a": m.R }, late)
	if m.get("I"):
		_flying_from_host(m.I, (late + N.rtt / 2.0) / 1000.0)      # a flying thing is shown where it is now


func _g_ev(_pid: int, m: Dictionary) -> void:
	if _live():
		Game.handle_events(m.get("ev", []))


func _g_say(_pid: int, m: Dictionary) -> void:
	Game.callv("say", m.get("a", [""]))


func _g_tip(_pid: int, m: Dictionary) -> void:
	Game.tip(str(m.id), str(m.text), m.get("vid", "?"), str(m.get("topic", "")))


func _g_toast(_pid: int, m: Dictionary) -> void:
	Game.toast_at(Vector3(m.p[0], m.p[1], m.p[2]), str(m.text), m.get("c", "#ffffff"))


func _g_snd(_pid: int, m: Dictionary) -> void:
	var o: Dictionary = (m.o as Dictionary).duplicate() if m.get("o") is Dictionary else {}
	if m.get("at") is Array:
		o.at = Vector3(m.at[0], m.at[1], m.at[2])
	Au.play(str(m.n), o)


func _g_line(_pid: int, m: Dictionary) -> void:
	Au.line(m.id, m.o if m.get("o") is Dictionary else {})


func _g_fx(_pid: int, m: Dictionary) -> void:
	var a: Array = m.get("a", [])
	if a.size() >= 6:
		World.burst(float(a[0]), float(a[1]), float(a[2]), int(a[3]), float(a[4]), int(a[5]), a[6] if a.size() > 6 and a[6] is Dictionary else {})


func _g_card(_pid: int, m: Dictionary) -> void:
	Game.find_card(m.f)


func _g_deny(_pid: int, m: Dictionary) -> void:
	Au.play("deny")
	if m.get("msg"):
		Game.say(str(m.msg), true)


func _g_drive(_pid: int, m: Dictionary) -> void:
	_driver_changed(m.get("pid"))


func _g_flow(_pid: int, m: Dictionary) -> void:
	_flow_from_host(m)


func _g_night(_pid: int, m: Dictionary) -> void:
	if _live():
		Game.end_day(m.get("info", {}) if m.get("info") is Dictionary else {})


func _g_report(_pid: int, m: Dictionary) -> void:
	if _live():
		Game.show_night(m.r)


func _g_launch(_pid: int, m: Dictionary) -> void:
	if not _live():
		return
	Game.ending = m.get("ending")
	Game.start_launch_scene(str(m.text) if m.get("text") else "", m.get("vid"))


func _g_reply(_pid: int, m: Dictionary) -> void:
	Game.MCTX.onReply.call(m.m)


## the host put you somewhere (morning, the end of a crisis job)
func _g_pos(_pid: int, m: Dictionary) -> void:
	var a = Actors.astro
	if a == null:
		return
	a.pos = Vector3(m.p[0], m.p[1], m.p[2])
	a.vel = Vector3.ZERO
	a.vy = 0.0
	a.on_ground = true
	if m.get("yaw") != null:
		a.yaw = float(m.yaw)


# ---------- the host's side ----------
func _h_p(pid: int, m: Dictionary) -> void:
	var p = players.get(pid)
	if p == null:
		return
	var t := now()
	p.off = _offset(p.off, t - float(m.ts))
	var at: float = float(m.ts) + p.off
	var k := int(m.get("k", 0))
	if k < p.k and p.k - k < 1000:
		return                     # an older one arriving late on the fast channel
	p.k = k
	_push(p.buf, { "t": at, "a": m.a }, t - at)
	p.st = m.a
	p.st_at = t
	p.st_t = at
	if m.get("r") and rover == pid:
		p.rov = m.r
		_push(_rover_buf, { "t": at, "a": m.r }, t - at)


func _h_act(pid: int, m: Dictionary) -> void:
	var p = players.get(pid)
	if p == null or p.puppet == null or Game.s == null:
		return
	_place(p, m.get("p"))
	var ok = run_as(pid, func(): return Game.do_offer(str(m.id), bool(m.get("alt", false))))
	if not ok:
		N.send(pid, { "t": "deny" })


func _h_drop(pid: int, m: Dictionary) -> void:
	var p = players.get(pid)
	if p == null or p.puppet == null:
		return
	_place(p, m.get("p"))
	run_as(pid, func():
		if Actors.astro.carrying == null:
			return
		Actors.set_down()
		var at: Vector3 = Actors.astro.pos          # the one who dropped it heard it already on their own screen
		N.broadcast({ "t": "snd", "n": "drop", "at": [_r2(at.x), _r2(at.y), _r2(at.z)] }, false, pid)
		acting -= 1
		Au.play("drop", { "at": at })
		acting += 1)


func _h_throw(pid: int, m: Dictionary) -> void:
	var p = players.get(pid)
	if p == null or p.puppet == null:
		return
	_place(p, m.get("p"))
	p.puppet.vel = Vector3(float(m.v[0]), 0, float(m.v[1]))
	run_as(pid, func():
		var it = Actors.throw_held(float(m.power), Vector2(float(m.f[0]), float(m.f[1])))
		if it:
			it.extra.hold = Game.clock + 0.12)


func _h_sim(pid: int, m: Dictionary) -> void:
	if not SIM_OK.has(str(m.get("fn"))) or Game.s == null:
		return
	run_as(pid, func(): Sim.callv(str(m.fn), [Game.s] + Array(m.get("args", []))))


func _h_op(pid: int, m: Dictionary) -> void:
	var p = players.get(pid)
	var fn = Game.OPS.get(str(m.get("fn")))
	if p == null or not (fn is Callable) or Game.s == null:
		return
	if m.get("p"):
		_place(p, m.p)
	var args: Array = m.get("args", [])
	run_as(pid, func(): fn.callv(args))


func _h_drive(pid: int, m: Dictionary) -> void:
	if not players.has(pid):
		return
	if m.get("on"):
		if rover != null and rover != pid:
			N.send(pid, { "t": "deny", "msg": name(rover) + " is driving the rover." })
			return
		set_driver(pid)
	elif rover == pid:
		set_driver(null)


## put a crewmate's body where their own game says it is, before doing something with it
func _place(p: Dictionary, a) -> void:
	if not (a is Array) or a.size() < 4 or p.puppet == null:
		return
	p.puppet.pos = Vector3(a[0], a[1], a[2])
	p.puppet.yaw = float(a[3])


## Do fn with a crewmate's astronaut, as that crewmate (what they hear and see comes back to them).
func run_as(pid: int, fn: Callable):
	var p = players.get(pid)
	var out
	if pid == 0 or p == null or p.puppet == null:
		acting += 1
		out = fn.call()
		acting -= 1
		return out
	var keep := ctx
	ctx = pid
	acting += 1
	out = Actors.with_astro(p.puppet, fn)
	ctx = keep
	acting -= 1
	return out


## The host's own action: its sounds and sparks in the world reach everyone.
func mine(fn: Callable):
	acting += 1
	var out = fn.call()
	acting -= 1
	return out


# ---------- the rover ----------
func set_driver(pid) -> void:
	rover = pid
	var r = Actors.rover
	r.remote = pid != null and pid != 0
	r.manned = pid != null
	if pid != 0 and r.driver:
		Game.exit_rover_local(true)
	_rover_buf.clear()
	N.broadcast({ "t": "drive", "pid": pid })


func can_drive() -> bool:
	return rover == null or rover == me


func ask_drive(yes: bool) -> void:
	N.to_host({ "t": "drive", "on": yes })


func _driver_changed(pid) -> void:
	rover = pid
	var r = Actors.rover
	if r == null:
		return
	_rover_buf.clear()
	if pid != null and int(pid) == me:
		r.remote = false
		r.manned = true
		if not r.driver:
			Game.enter_rover_local()
		return
	if r.driver:
		Game.exit_rover_local(true)
	r.remote = true
	r.manned = pid != null


func _rover_pose() -> Array:
	var r = Actors.rover
	return [_r2(r.pos.x), _r2(r.pos.y), _r2(r.pos.z), _r3(r.yaw), _r2(r.speed), _r3(r.pitch), _r3(r.roll), _r2(r.steer)]


func _follow_rover() -> void:
	var r = Actors.rover
	if r == null or not r.remote:
		return
	var e = _sample(_rover_buf, now() - _delay_of(_rover_buf))
	if e == null:
		return
	var a: Array = e.a
	var b: Array = e.b
	var k: float = e.k
	r.pos = Vector3(lerpf(a[0], b[0], k), lerpf(a[1], b[1], k), lerpf(a[2], b[2], k))
	if e.x > 0:
		r.pos.x += sin(b[3]) * b[4] * e.x
		r.pos.z += cos(b[3]) * b[4] * e.x
	r.yaw = _ang_lerp(a[3], b[3], k)
	r.speed = lerpf(a[4], b[4], k)
	r.pitch = lerpf(a[5], b[5], k)
	r.roll = lerpf(a[6], b[6], k)
	r.steer = float(b[7])


# =====================================================================
#  MOVEMENT: what you send, and how the others are drawn
# =====================================================================
# a state: [x, y, z, yaw, vx, vy, vz, flags, mode, room]   flags: 1 on the ground, 2 moving, 4 running, 8 aiming,
# 16 throwing, 32 out in the open (for the radiation), 64 carrying
func _my_state() -> Array:
	var a = Actors.astro
	var inp: Dictionary = Game.input
	var moving: bool = Vector2(inp.x, inp.z).length() > 0.2 and (Game.mode == "play" or Game.mode == "inside" or (Game.mode == "party" and Game._walking()))
	var out: bool = (Game.mode == "play" or Game.mode == "observe") and Game.room == null
	var f := (1 if a.on_ground else 0) | (2 if moving else 0) | (4 if inp.get("puff", false) and moving else 0) | (8 if a.aim else 0) \
		| (16 if a.throw_t > 0 else 0) | (32 if out else 0) | (64 if a.carrying else 0)
	var md: String = "hidden" if Game.mode in HIDDEN_MODES else a.mode
	return [_r2(a.pos.x), _r2(a.pos.y), _r2(a.pos.z), _r3(a.yaw), _r2(a.vel.x), _r2(a.vy), _r2(a.vel.z), f, md, str(Game.room) if Game.room != null else ""]


## clock offsets: how much later than the sender's clock a message arrives, at the quickest. It follows a slow drift up.
static func _offset(off, smp: float) -> float:
	if off == null or smp < off:
		return smp
	return off + (smp - off) * 0.01


## A buffer of states, in time order. It also learns how far apart they come (gap) and how late they arrive (late), so
## the drawing waits just long enough to always have the next state in hand (see _delay_of). The same state relayed
## twice by the host is kept once.
static func _push(buf: Buf, e: Dictionary, late) -> void:
	if buf.last_t != null and e.t <= buf.last_t + 0.5:
		if buf.e.size() and absf(e.t - buf.last_t) <= 0.5:
			return
	var i := buf.e.size()
	while i > 0 and buf.e[i - 1].t > e.t:
		i -= 1
	buf.e.insert(i, e)
	if buf.last_t != null and e.t > buf.last_t:
		var g: float = e.t - buf.last_t
		if g < 1000:
			buf.gap = buf.gap * 0.9 + g * 0.1 if buf.gap else g
	if late != null and late >= 0 and late < 2000:
		buf.late = maxf(late, buf.late * 0.97) if buf.late else late     # quick to rise, slow to fall
	if buf.last_t == null or e.t > buf.last_t:
		buf.last_t = e.t
	while buf.e.size() > 2 and buf.e[1].t < now() - 2000:
		buf.e.pop_front()


## how far behind real time to draw from this buffer: one and a half gaps plus the usual lateness, at least DELAY
static func _delay_of(buf: Buf) -> float:
	return minf(420, maxf(DELAY, (buf.gap if buf.gap else 50.0) * 1.5 + buf.late + 15))


## The two states around time t, and how far between them (k); x = seconds past the last one (to run ahead a little).
static func _sample(buf: Buf, t: float):
	var n := buf.e.size()
	if n == 0:
		return null
	var i := n - 1
	if t >= buf.e[i].t:
		return { "a": buf.e[i].a, "b": buf.e[i].a, "k": 0.0, "x": minf(MAX_EXTRA, t - buf.e[i].t) / 1000.0 }
	while i > 0 and buf.e[i - 1].t > t:
		i -= 1
	if i == 0:
		return { "a": buf.e[0].a, "b": buf.e[0].a, "k": 0.0, "x": 0.0 }
	var e0: Dictionary = buf.e[i - 1]
	var e1: Dictionary = buf.e[i]
	return { "a": e0.a, "b": e1.a, "k": (t - e0.t) / maxf(1.0, e1.t - e0.t), "x": 0.0 }


func _make_puppets() -> void:
	if Actors.astro == null or (Game.s == null and not _party()):
		return
	for p in _others():
		if p.puppet and Actors.crew.has(p.puppet):
			continue
		p.puppet = Actors.add_crewmate(int(p.suit))
		p.puppet.mode = "hidden"
		p.puppet.name = p.name
		p.puppet.peer = str(p.pid)
		var d = Base.spots.door
		p.puppet.pos = Vector3(d.x, Actors.ground_at(d.x, d.z + 2.4), d.z + 2.4)
		p.buf.clear()
		p.shown = false


## the world was built again (a new mission): the old bodies went with it
func world_built() -> void:
	if not on:
		return
	for p in _others():
		p.puppet = null
	_make_puppets()


func _drop_puppet(p: Dictionary) -> void:
	if p.puppet:
		if Actors.crew.has(p.puppet):
			Actors.remove_crewmate(p.puppet)
		p.puppet = null
	if p.tag:
		p.tag.queue_free()
		p.tag = null


func _pose_puppets(dt: float) -> void:
	var t := now()
	var mine_room: String = str(Game.room) if Game.room != null else ""
	for p in _others():
		var b = p.puppet
		if b == null:
			continue
		var e = _sample(p.buf, t - _delay_of(p.buf))
		if e == null:
			b.mode = "hidden"
			Actors.pose_crewmate(b, dt, false, false)
			continue
		var s0: Array = e.a
		var s1: Array = e.b
		var k: float = e.k
		var v := Vector3(lerpf(s0[0], s1[0], k), lerpf(s0[1], s1[1], k), lerpf(s0[2], s1[2], k))
		b.vel = Vector3(lerpf(s0[4], s1[4], k), 0, lerpf(s0[6], s1[6], k))
		if e.x > 0 and s1[8] == "walk":
			v.x += s1[4] * e.x
			v.z += s1[6] * e.x
			if not (int(s1[7]) & 1):
				v.y += s1[5] * e.x
		# a correction is eased in over a few frames instead of a jump; a long way (a new morning) is a jump
		if not p.shown or b.pos.distance_to(v) > 3 or s1[8] != "walk":
			b.pos = v
			p.shown = true
		else:
			b.pos = b.pos.lerp(v, 1 - exp(-dt / 0.05))
		b.yaw = _ang_lerp(s0[3], s1[3], k)
		b.vy = lerpf(s0[5], s1[5], k)
		var f := int(s1[7])
		var md: String = str(s1[8])
		var rm: String = str(s1[9])
		b.on_ground = (f & 1) != 0
		b.aim = (f & 8) != 0
		if (f & 16) and b.throw_t <= 0:
			b.throw_t = 0.35
		# in a room you are only seen by those in the same room; out in the open by those out in the open
		b.mode = "hidden" if rm != mine_room else md
		b.room = Actors.room if rm != "" else null
		if md == "drive" and rover != p.pid:
			b.mode = "walk"
		b.solid = b.mode == "walk" or b.mode == "busy"
		Actors.pose_crewmate(b, dt, (f & 2) != 0, (f & 4) != 0)
		p.mode = md
		p.room = rm
		p.out = (f & 32) != 0
		p.run = (f & 4) != 0 and (f & 2) != 0


# ---------- names over heads, and the crew in the corner ----------
func _name_tags() -> void:
	var show: bool = (Game.mode == "play" or Game.mode == "inside" or Game.mode == "party") and Game.cut == null and not Ui.modal_open()
	for p in _others():
		var b = p.puppet
		if p.tag == null:
			var l := Label.new()
			l.text = p.name
			l.add_theme_font_override("font", Style.font(700))
			l.add_theme_font_size_override("font_size", 14)
			l.add_theme_color_override("font_color", Color.WHITE)
			l.add_theme_stylebox_override("normal", Style.box(Color(6 / 255.0, 20 / 255.0, 60 / 255.0, 0.72), 99, _col(int(p.suit)), 2, Vector4(11, 3, 11, 4)))
			l.mouse_filter = Control.MOUSE_FILTER_IGNORE
			_layer.add_child(l)
			p.tag = l
		var vis: bool = show and b != null and b.group.visible and b.mode != "hidden"
		if vis:
			var pr: Dictionary = World.project(Vector3(b.pos.x, b.pos.y + (2.6 if b.mode == "drive" else 2.55), b.pos.z))
			vis = not pr.hidden and pr.dist < 120
			if vis:
				var sz: Vector2 = p.tag.get_combined_minimum_size()
				p.tag.size = sz
				p.tag.position = Vector2(roundf(pr.x - sz.x / 2), roundf(pr.y - sz.y))
				p.tag.modulate.a = 0.55 if pr.dist > 60 else 1.0
		p.tag.visible = vis


func _crew_hud() -> void:
	var show: bool = Game.s != null and (Game.mode == "play" or Game.mode == "inside" or Game.mode == "observe") and Game.cut == null
	_hud.visible = show
	if not show:
		return
	var storm: bool = Sim.storm_phase(Game.s) == "active"
	var rows: Array = []
	var key := ""
	for q in _list():
		var p = players[q.pid]
		var where := "out"
		if q.pid == me:
			where = "inside" if Game.room != null else ("rover" if Actors.rover and Actors.rover.driver else ("sit" if Game.mode == "observe" else "out"))
		else:
			where = "inside" if p.room != "" else ("rover" if p.mode == "drive" else ("sit" if p.mode == "sit" else ("gone" if p.mode == "hidden" or p.mode == "" else "out")))
		var ic: String = { "inside": "🏠", "rover": "🚙", "sit": "🪨", "out": "☢️" if storm else "👣", "gone": "…" }[where]
		var rt := 0.0
		if q.pid != me:
			rt = N.rtt_of(q.pid) if host else (N.rtt if q.pid == 0 else 0.0)
		var row := [q, ic, rt > 250, where == "out" and storm]
		rows.append(row)
		key += str(q.pid) + q.name + ic + str(row[2]) + str(row[3]) + "|"
	if key == _hud_key:
		return
	_hud_key = key
	for c in _hud_box.get_children():
		c.queue_free()
	for row in rows:
		var q: Dictionary = row[0]
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 8)
		h.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var dot := Panel.new()
		dot.custom_minimum_size = Vector2(12, 12)
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		dot.add_theme_stylebox_override("panel", Style.box(_col(int(q.suit)), 6, Color(1, 1, 1, 0.7), 2, Vector4.ZERO))
		h.add_child(dot)
		var nl := Label.new()
		nl.text = q.name
		nl.add_theme_font_override("font", Style.font(600))
		nl.add_theme_font_size_override("font_size", 14)
		nl.add_theme_color_override("font_color", Style.DANGER if row[3] else Style.INK)
		h.add_child(nl)
		var il: RichTextLabel = Ui.rich(Html.bb_text(row[1], 15), 15)
		il.autowrap_mode = TextServer.AUTOWRAP_OFF
		il.fit_content = true
		il.custom_minimum_size = Vector2(22, 0)
		il.mouse_filter = Control.MOUSE_FILTER_IGNORE
		h.add_child(il)
		if row[2]:
			var sl := Label.new()
			sl.text = "slow link"
			sl.add_theme_font_size_override("font_size", 11)
			sl.add_theme_color_override("font_color", Color("#ffb15c"))
			h.add_child(sl)
		_hud_box.add_child(h)


# =====================================================================
#  THINGS: the host says where each one is; the others draw it there
# =====================================================================
func _holder_pid(it) -> int:
	if it.holder == null:
		return -1
	if it.holder == local:
		return me
	for k in players:
		if players[k].puppet == it.holder:
			return int(k)
	return -1


func _holder_body(pid: int):
	if pid == me:
		return Actors.astro
	var p = players.get(pid)
	return p.puppet if p else null


func _item_key(it, hp: int) -> String:
	var k: String = str(it.state) + "|" + str(hp) + "|" + str(it.slot) + "|" + (str(it.tag) if it.tag else "")
	if it.state == "rest" or it.state == "fixed":
		k += "|" + str(_r2(it.pos.x)) + "," + str(_r2(it.pos.y)) + "," + str(_r2(it.pos.z))
	return k


func _item_row(it, hp: int) -> Dictionary:
	return { "id": it.id, "type": it.type, "data": _clean(it.data), "st": it.state, "p": [_r2(it.pos.x), _r2(it.pos.y), _r2(it.pos.z)],
		"v": [_r2(it.vel.x), _r2(it.vel.y), _r2(it.vel.z)], "h": hp, "sl": it.slot, "tag": str(it.tag) if it.tag else "" }


func _items_full() -> Array:
	var out: Array = []
	for it in Actors.items:
		out.append(_item_row(it, _holder_pid(it)))
	return out


func _items_diff() -> void:
	var add: Array = []
	var up: Array = []
	var del: Array = []
	var seen := {}
	for it in Actors.items:
		var hp := _holder_pid(it)
		var k := _item_key(it, hp)
		seen[it.id] = true
		if not _last_items.has(it.id):
			add.append(_item_row(it, hp))
		elif _last_items[it.id] != k:
			up.append([it.id, it.state, hp, it.slot, str(it.tag) if it.tag else "", _r2(it.pos.x), _r2(it.pos.y), _r2(it.pos.z), _r2(it.vel.x), _r2(it.vel.y), _r2(it.vel.z)])
		_last_items[it.id] = k
	for id in _last_items.keys():
		if not seen.has(id):
			del.append(id)
			_last_items.erase(id)
	if add.size() or up.size() or del.size():
		N.broadcast({ "t": "items", "add": add, "up": up, "del": del })


func _set_item(it, st: String, hp: int, sl: int, tag) -> void:
	var rv = Actors.rover
	if it.state == "bed" and it.slot >= 0 and rv.bed[it.slot] == it:
		rv.bed[it.slot] = null
	if it.holder and it.holder.carrying == it:
		it.holder.carrying = null
	it.holder = null
	it.state = st
	it.slot = sl
	it.tag = tag if tag is String and tag != "" else null
	if st == "held":
		var h = _holder_body(hp)
		if h:
			if h.carrying and h.carrying != it and h.carrying.holder == h:
				h.carrying.holder = null
			it.holder = h
			h.carrying = it
	if st == "bed" and sl >= 0 and sl < rv.bed.size():
		rv.bed[sl] = it
	if st != "fly":
		it.vel = Vector3.ZERO


func load_items(items: Array) -> void:
	for it in Actors.items.duplicate():
		Actors.remove(it)
	_apply_items({ "add": items, "up": [], "del": [] })


func _apply_items(m: Dictionary) -> void:
	var t := now()
	for r in m.get("add", []):
		var id := int(r.id)
		var p := Vector3(r.p[0], r.p[1], r.p[2])
		var it = Actors.by_id(id)
		if it == null:
			it = Actors.spawn(str(r.type), p, r.get("data"), str(r.st), id)
		it.pos = p
		_set_item(it, str(r.st), int(r.h), int(r.sl), r.get("tag", ""))
		it.vel = Vector3(r.v[0], r.v[1], r.v[2])
	for u in m.get("up", []):
		var it = Actors.by_id(int(u[0]))
		if it == null:
			continue
		# you just threw or put this down yourself: the host has not heard yet, so do not take it back into your hands
		if float(it.extra.get("pred", 0.0)) > t and u[1] == "held" and int(u[2]) == me:
			continue
		_set_item(it, str(u[1]), int(u[2]), int(u[3]), u[4])
		if u[1] != "held" and u[1] != "bed":
			it.pos = Vector3(u[5], u[6], u[7])
			it.vel = Vector3(u[8], u[9], u[10])
	for id in m.get("del", []):
		var it = Actors.by_id(int(id))
		if it:
			Actors.remove(it)


func _flying_now():
	var out: Array = []
	for it in Actors.items:
		if it.state == "fly":
			out.append([it.id, _r2(it.pos.x), _r2(it.pos.y), _r2(it.pos.z), _r2(it.vel.x), _r2(it.vel.y), _r2(it.vel.z)])
	return out if out.size() else null


## a guest's own copy of a flying thing falls by itself between the host's reports; each report nudges it back on course
func _flying_from_host(rows: Array, late: float) -> void:
	var t := now()
	var g: float = Actors.grav
	for f in rows:
		var it = Actors.by_id(int(f[0]))
		if it == null or it.state == "held" or it.state == "bed" or it.state == "fixed":
			continue
		if float(it.extra.get("pred", 0.0)) > t:
			continue
		var v := Vector3(f[1] + f[4] * late, f[2] + f[5] * late - 0.5 * g * late * late, f[3] + f[6] * late)
		if it.state != "fly":
			it.state = "fly"
			it.from = null
		if it.pos.distance_to(v) > 1.2:
			it.pos = v
		else:
			it.pos = it.pos.lerp(v, 0.3)
		it.vel = Vector3(f[4], f[5] - g * late, f[6])


# =====================================================================
#  THE MISSION STATE: the parts that changed, ten times a second
# =====================================================================
func _state_now() -> Dictionary:
	var s2 := {}
	for k in Game.s:
		if k != "site" and k != "level" and k != "rng":
			s2[k] = Game.s[k]
	var o: Dictionary = _clean({ "s": s2, "rigs": Game.rigs, "tut": Game.tut, "tutStep": Game.tut_step })
	o.site = Game.s.site.planet
	o.level = Game.s.level.id
	return o


static func _diff(a, b, path: Array, out: Array) -> void:
	if a is Dictionary and b is Dictionary:
		for k in b:
			if not a.has(k):
				out.append([path + [k], b[k]])
			else:
				_diff(a[k], b[k], path + [k], out)
		for k in a:
			if not b.has(k):
				out.append([path + [k]])
		return
	if a is Array and b is Array and a.size() == b.size():
		for i in b.size():
			_diff(a[i], b[i], path + [i], out)
		return
	if typeof(a) != typeof(b) or a != b:
		out.append([path, b])


static func _set_path(root: Dictionary, path: Array, value, del: bool) -> void:
	if path.is_empty():
		return
	var o = root
	for i in path.size() - 1:
		var k = path[i]
		var nxt = null
		if o is Dictionary:
			nxt = o.get(k)
		elif o is Array and k is int and k >= 0 and k < o.size():
			nxt = o[k]
		if not (nxt is Dictionary or nxt is Array):
			nxt = [] if path[i + 1] is int else {}
			if o is Array:
				if not (k is int) or k < 0:
					return
				if k >= o.size():
					o.resize(k + 1)
			o[k] = nxt
		o = nxt
	var last = path[path.size() - 1]
	if o is Dictionary:
		if del:
			o.erase(last)
		else:
			o[last] = value
	elif o is Array and last is int and last >= 0:
		if del:
			return
		if last >= o.size():
			o.resize(last + 1)
		o[last] = value


func sync_now() -> void:
	if not host or not started or Game.s == null:
		return
	var cur := _state_now()
	var d: Array = []
	if _last_state:
		_diff({ "s": _last_state.s, "rigs": _last_state.rigs, "tut": _last_state.tut, "tutStep": _last_state.tutStep },
			{ "s": cur.s, "rigs": cur.rigs, "tut": cur.tut, "tutStep": cur.tutStep }, [], d)
	_last_state = cur
	if d.size():
		N.broadcast({ "t": "st", "d": d })
	_items_diff()


# =====================================================================
#  STARTING A MISSION, AND EVERY FRAME
# =====================================================================
## The host's game has just started the mission: send it to the crew (players can still join later).
func mission_started(data) -> void:
	if not host:
		return
	started = true
	local = Actors.astro
	rover = null
	Actors.rover.remote = false
	Actors.rover.manned = false
	_last_items = {}
	_last_state = _state_now()
	var items := _items_full()
	for r in items:
		_last_items[r.id] = _item_key(Actors.by_id(r.id), r.h)
	var msg := { "t": "start", "opts": Game.opts.duplicate(), "data": _clean(data), "snap": _last_state, "items": items, "list": _list(), "rover": null }
	_dbg("start: %d bytes (weather %d, state %d)" % [var_to_bytes(msg).size(), var_to_bytes(msg.data).size(), var_to_bytes(_last_state).size()])
	N.broadcast(msg)
	_make_puppets()


## a guest's game has built the same mission from the host's snapshot
func guest_started(items) -> void:
	local = Actors.astro
	load_items(items if items is Array else [])
	_make_puppets()
	Actors.rover.remote = true
	Actors.rover.manned = rover != null
	_rover_buf.clear()


func frame(dt: float) -> void:
	if not on:
		return
	if (Game.s == null and not _party()) or not started or Actors.astro == null:
		_hud.visible = false
		return
	local = Actors.astro
	_send_t += dt
	_state_t += dt
	if _send_t >= SEND_EVERY:
		_send_t = 0.0
		var t := now()
		var mine_st := _my_state()
		if guest:
			_seq += 1
			var msg := { "t": "p", "k": _seq, "ts": t, "a": mine_st }
			if Actors.rover.driver and rover == me:
				msg.r = _rover_pose()
			N.to_host(msg, true)
		else:
			var P := { 0: mine_st }
			var D := {}
			for p in _others():
				if p.st != null and t - p.st_at < 3000:
					P[p.pid] = p.st
					D[p.pid] = roundf(p.st_t - t)
			var dr = players.get(rover) if rover != null and rover != 0 else null
			var has_rov: bool = dr != null and dr.rov != null
			N.broadcast({ "t": "w", "ts": t, "P": P, "D": D, "R": dr.rov if has_rov else _rover_pose(), "RD": roundf(dr.st_t - t) if has_rov else 0.0, "I": _flying_now() }, true)
			_items_diff()
	if host and _state_t >= STATE_EVERY:
		_state_t = 0.0
		sync_now()
	_follow_rover()
	_pose_puppets(dt)


func after_frame() -> void:
	if not on or not started:
		for p in players.values():
			if p.tag:
				p.tag.visible = false
		return
	_name_tags()
	_crew_hud()


## How much of the crew is out in the open, and running (the mission rules use these for air and radiation).
func crew_ctx(host_out: bool, host_run: bool) -> Dictionary:
	var n := 1
	var out := 1 if host_out else 0
	var run := 1 if host_run else 0
	var t := now()
	for p in _others():
		if p.st == null or t - p.st_at > 5000:
			continue
		n += 1
		var f := int(p.st[7])
		if f & 32:
			out += 1
		if (f & 4) and (f & 32):
			run += 1
	return { "outside": out / float(n), "sprint": run / float(n), "driving": rover != null and absf(Actors.rover.speed) > 0.6 }


# ---------- a guest asks the host to do things ----------
func _here() -> Array:
	var a = Actors.astro
	return [_r2(a.pos.x), _r2(a.pos.y), _r2(a.pos.z), _r3(a.yaw)]


func act(id: String, alt: bool) -> void:
	N.to_host({ "t": "act", "id": id, "alt": alt, "p": _here() })


func drop() -> void:
	var it = Actors.astro.carrying
	if it == null:
		return
	Actors.set_down()
	it.extra.pred = now() + 900.0
	N.to_host({ "t": "drop", "p": _here() })


func throw_held(power: float):
	var a = Actors.astro
	if a.carrying == null:
		return null
	var fw := World.forward()
	var f := [_r3(fw.x), _r3(fw.z)]
	var vel := [_r2(a.vel.x), _r2(a.vel.z)]
	var thrown = Actors.throw_held(power)
	if thrown:
		thrown.extra.pred = now() + 900.0
	N.to_host({ "t": "throw", "power": power, "f": f, "v": vel, "p": _here() })
	return thrown


## a rule change the guest's game also makes on its own copy at once (so the screen answers straight away)
func sim(fn: String, args: Array = []) -> void:
	N.to_host({ "t": "sim", "fn": fn, "args": _clean(args) })


func op(fn: String, args: Array = []) -> void:
	N.to_host({ "t": "op", "fn": fn, "args": _clean(args), "p": _here() })


# ---------- the host tells everyone ----------
func events(ev: Array) -> void:
	if not host or ev.is_empty():
		return
	sync_now()
	N.broadcast({ "t": "ev", "ev": _clean(ev) })


func send(pid: int, msg: Dictionary) -> void:
	N.send(pid, msg)


func broadcast(msg: Dictionary) -> void:
	if host:
		N.broadcast(_clean(msg))


func night(info: Dictionary) -> void:
	if host:
		sync_now()
		night_info = _clean(info)
		N.broadcast({ "t": "night", "info": night_info })


func report(r: Dictionary) -> void:
	if host:
		sync_now()
		last_report = _clean(r)
		N.broadcast({ "t": "report", "r": last_report })


func launch(text, vid, ending) -> void:
	if host:
		sync_now()
		N.broadcast({ "t": "launch", "text": text if text else null, "vid": vid, "ending": _clean(ending) })


func to_lobby() -> void:
	if host and started:
		started = false
		N.broadcast({ "t": "lobby" })


# ---------- the big moments: a card that opens on every screen, and the host's choice moves everyone on ----------
## flow: the names of the card's actions that belong to the host. On a guest's screen those buttons wait.
func modal(html: String, o: Dictionary, flow: Array, kind := "") -> Html.Doc:
	var acts: Dictionary = (o.get("actions", {}) as Dictionary).duplicate()
	var o2: Dictionary = o.duplicate()
	if host:
		for k in flow:
			var fn = acts.get(k)
			if not (fn is Callable):
				continue
			var key: String = k
			acts[key] = func(b = null):
				var v: String = Html.attr(b, "data-v") if b is Node else ""
				flow_open = false
				flow_data = null
				_call_act(fn, b)
				sync_now()
				N.broadcast({ "t": "flow", "act": key, "v": v, "x": _clean(flow_data) })
				flow_data = null
		flow_open = true
		flow_kind = kind
		if kind == "crisisResult":
			last_crisis_x = flow_data
		o2.actions = acts
		return Ui.modal(html, o2)
	var waiting := {}
	for k in flow:
		if acts.has(k):
			waiting[k] = acts[k]
			acts.erase(k)
	var note := "<p class=\"crew-waiting\">⏳ Waiting for <b>" + esc(name(0)) + "</b> (the host) to choose…</p>"
	var at := html.rfind("<div class=\"modal-actions\"")
	var h2 := (html.substr(0, at) + note + html.substr(at)) if at >= 0 else html + note
	o2.actions = acts
	var doc := Ui.modal(h2, o2)
	for b in doc.buttons:
		if is_instance_valid(b) and flow.has(Html.attr(b, "data-act")):
			b.disabled = true
	pending = { "acts": waiting, "doc": doc }
	if queued.size():
		_flow_from_host.call_deferred(queued.pop_front())
	return doc


func flow_paused() -> bool:
	return host and flow_open and Ui.modal_open()


func _flow_from_host(m: Dictionary) -> void:
	if m.get("act") == "pick" and m.get("x"):
		pending = null
		Game.crisis_result(m.x)
		return
	var p = pending
	if p == null or not p.acts.has(m.get("act")) or not Ui.modal_open() or not is_same(Ui.modal_doc, p.doc):
		queued.append(m)
		if queued.size() > 4:
			queued.pop_front()
		return
	pending = null
	var el := Control.new()
	el.set_meta("attrs", { "data-act": str(m.act), "data-v": str(m.get("v", "")) })
	_call_act(p.acts[m.act], el)
	el.queue_free()


# =====================================================================
#  WHAT YOU HEAR AND SEE WHEN SOMEBODY ELSE DOES SOMETHING
# =====================================================================
# While the host does a crewmate's action, what that action says is for the crewmate (sent to them), and the sounds
# and sparks it makes out in the world are for everyone. The host's own actions share their sounds and sparks too.
func _patch_feedback() -> void:
	Au.relay = _au_relay
	World.relay = _fx_relay


func _unpatch_feedback() -> void:
	Au.relay = Callable()
	World.relay = Callable()


## true: the sound is not for this screen
func _au_relay(kind: String, what, o: Dictionary) -> bool:
	if not (on and host):
		return false
	if kind == "play":
		if acting <= 0:
			return false
		var at = o.get("at")
		if at is Vector3:
			N.broadcast({ "t": "snd", "n": what, "at": [_r2(at.x), _r2(at.y), _r2(at.z)], "o": { "vol": o.vol } if o.has("vol") else null })
			return false
		if ctx:
			N.send(ctx, { "t": "snd", "n": what, "o": _clean(o) })
			return true
		return false
	if kind == "line" and ctx:
		N.send(ctx, { "t": "line", "id": what, "o": _clean(o) })
		return true
	return false


func _fx_relay(a: Array) -> void:
	if on and host and acting > 0:
		var out: Array = []
		for x in a:
			out.append(_r2(x) if x is float else _clean(x))
		N.broadcast({ "t": "fx", "a": out })


## game.gd asks: should this message go to a crewmate instead of this screen?
func route_say(args: Array) -> bool:
	if on and host and ctx:
		N.send(ctx, { "t": "say", "a": _clean(args) })
		return true
	return false


func route_tip(id: String, text: String, vid, topic: String) -> bool:
	if on and host and ctx:
		N.send(ctx, { "t": "tip", "id": id, "text": text, "vid": vid, "topic": topic })
		return true
	return false


func share_toast(pos: Vector3, text: String, color) -> void:
	if on and host and acting > 0:
		N.broadcast({ "t": "toast", "p": [_r2(pos.x), _r2(pos.y), _r2(pos.z)], "text": text, "c": color })


func share_card(f) -> void:
	if on and host and acting > 0:
		N.broadcast({ "t": "card", "f": _clean(f) })


func remote() -> bool:
	return on and host and ctx != 0


func _process(delta: float) -> void:
	if not on:
		return
	_room_t += delta
	if _room_t >= 2.0:
		_room_t = 0.0
		_refresh_room()
