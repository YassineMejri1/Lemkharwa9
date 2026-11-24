extends Node
## Astro Outpost — party mode: short mini-games for 1 to 4 astronauts, each on their own screen.
##
## Every planet gets four mini-games, one for each tier: easy, intermediate, hard, extreme (GAMES, in that order).
## Each game is one script in scripts/party/. Only the Moon has its four so far.
## A party runs on the crew's network (scripts/addons/crew.gd): the host picks the games and keeps the score. Alone,
## your own game is the host.
## - `st` is the whole party as the host tells it: the game, the round, each player's result, the stars. The host
##   sends it whenever it changes, and every screen shows what it says.
## - Every screen builds the same round from st.seed (an Rng32), so falling meteors or the order of the Moon's phases
##   need no messages. A game only judges its own player, and tells the host the result with report().
## - The astronauts themselves are sent and drawn by crew mode, as in a mission.
## A game script has start() (build the props under P.root), round() (a round begins) and frame(dt); P is this node.
## shortcut: a player who joins in the middle of a game waits for the next one; add watching when it matters.

const TIERS := ["Easy", "Intermediate", "Hard", "Extreme"]
const TIER_COL := ["#7be36a", "#ffd23f", "#ffb15c", "#ff5468"]
const MEDALS := ["🥇", "🥈", "🥉", "4."]
const STARS := [3, 2, 1, 0]         # for 1st, 2nd, 3rd and 4th place
const COUNT := 3.0                  # the 3, 2, 1 before every round
const INTRO := 4.0                  # before a game's first round: time to read how to play
const GAP := 3.2                    # between two rounds
const GRACE := 2.0                  # once a round's time is up, the host waits this long for the last results
const END_WAIT := 2.2               # after the last round, a moment to see how it ended before the results
## what a game may report about its player, and the kind of each (see safe())
const FIELDS := { "v": TYPE_FLOAT, "txt": TYPE_STRING, "last": TYPE_STRING, "d": TYPE_INT, "step": TYPE_INT, "ms": TYPE_INT, "out": TYPE_BOOL, "crash": TYPE_BOOL }
## rounds: how many; max: seconds a round may last; last: the last one standing wins
const GAMES := {
	"star": { "planet": "moon", "icon": "🌠", "name": "Shooting Star", "kind": "reflex", "rounds": 5, "max": 9.0, "key": "SPACE", "hint": "Press when you see a shooting star",
		"text": "Be the quickest to spot the shooting star.",
		"how": "Watch the sky. The moment a shooting star streaks across it, press SPACE. Satellites and twinkling stars do not count: jump too early and you sit the round out." },
	"phase": { "planet": "moon", "icon": "🌗", "name": "Phase Chase", "kind": "memory", "rounds": 3, "max": 38.0, "key": "W A S D", "hint": "Run onto the Moon's phases in the order shown",
		"text": "Remember the Moon's phases, then run to them in order.",
		"how": "The hologram shows some of the Moon's phases, one after the other. Remember the order, then run onto the same pads in that order. A wrong pad costs points and a moment." },
	"eagle": { "planet": "moon", "icon": "🦅", "name": "Eagle Drop", "kind": "skill", "rounds": 3, "max": 45.0, "key": "SPACE", "hint": "Hold to fire the engine",
		"text": "Land softly, and sooner than your friends. Mind the fuel!",
		"how": "You are falling toward the Moon. Hold SPACE to fire the engine and slow down, but there is little fuel. Touch down slower than 4 m/s, and sooner than your friends." },
	"storm": { "planet": "moon", "icon": "☄️", "name": "Meteor Storm", "kind": "survival", "rounds": 1, "max": 68.0, "last": true, "key": "W A S D", "hint": "Keep out of the red rings!  SPACE jumps, SHIFT runs",
		"text": "Dodge the meteors. The last astronaut standing wins.",
		"how": "Meteors rain on the plain. A red ring shows where the next one lands: get out of it in time. One hit and you are out. The last astronaut standing wins." },
}

var st := { "ph": "off" }       # the party: ph off, menu, play, gap (between rounds) or end
var game = null                 # the mini-game on this screen, or null
var root: Node3D = null         # its props, at the middle of the arena; freed with the game
var extras: Control             # its own parts of the HUD; emptied with the game
var C := Vector3.ZERO           # the middle of the arena, on the ground
var t := 0.0                    # the round's clock: below zero during the countdown
var k := 0                      # the round, from 0
var on := false                 # the round is being played right now
var walk := false               # the game lets the keys move your astronaut (it says so every frame)
var mine := {}                  # your own result in this game

var _n := -1                    # the game (st.n) and the round this screen is showing
var _k := -1
var _planet := ""
var _world_id := 0              # the world the arena is in: a mission builds another one
var _dirty := false
var _send_t := 0.0
var _gap := 0.0
var _end_t := -1.0              # seconds until the results card; -1 not yet, -2 shown
var _count := 0
var _layer: CanvasLayer
var _big: Label
var _big_t := 0.0
var _how: Label
var _hud: Label
var _board: RichTextLabel
var _board_key := ""


func _ready() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 9
	_layer.visible = false
	add_child(_layer)
	var full := func(c: Control) -> Control:
		c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		c.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return c
	var holder: Control = full.call(Control.new())
	_layer.add_child(holder)
	extras = full.call(Control.new())
	holder.add_child(extras)
	var mid: Control = full.call(CenterContainer.new())
	holder.add_child(mid)
	var col := VBoxContainer.new()
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mid.add_child(col)
	_big = _text(84, 700, "exo2")
	col.add_child(_big)
	_how = _text(20, 600)
	_how.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_how.custom_minimum_size.x = 660
	col.add_child(_how)
	_hud = _text(24, 700)
	_hud.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_hud.offset_top = -122          # where the control hint was during the countdown
	_hud.offset_bottom = -84
	holder.add_child(_hud)
	var bp := PanelContainer.new()
	bp.add_theme_stylebox_override("panel", Style.box(Color(6 / 255.0, 20 / 255.0, 60 / 255.0, 0.68), 16, Color(0, 0, 0, 0), 0, Vector4(14, 10, 14, 10)))
	bp.anchor_left = 1.0
	bp.anchor_right = 1.0
	bp.offset_right = -12
	bp.offset_top = 12
	bp.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	bp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_board = Ui.rich("", 16)
	_board.autowrap_mode = TextServer.AUTOWRAP_OFF
	bp.add_child(_board)
	bp.visible = false
	holder.add_child(bp)


## words over the game: centred, with a dark edge so they read on the bright ground and on the black sky
func _text(size: int, weight: int, family := "lexend") -> Label:
	var l: Label = Ui.label("", size, Style.INK, weight, family)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", maxi(6, int(size / 7.0)))
	return l


# =====================================================================
#  WHAT A GAME SCRIPT USES
# =====================================================================
func me() -> int:
	var c = Game.crew()
	return c.me if c else 0


func host() -> bool:
	return not Game.guest()


## this player's astronaut on this screen (your own, or a crewmate's puppet), or null
func body(pid: int):
	if pid == me():
		return Actors.astro
	var c = Game.crew()
	var p = c.players.get(pid) if c else null
	return p.puppet if p else null


## where this player stands in a row of all the players, `gap` metres apart, around the middle
func lane(pid: int, gap: float) -> float:
	return (st.pl.find(pid) - (st.pl.size() - 1) / 2.0) * gap


## the same numbers on every screen, for this round
func rng(salt := 0) -> Rng32:
	return Rng32.new(int(st.seed) + k * 7919 + salt * 104729)


## the party button was pressed this frame / is held down
func pressed() -> bool:
	return Game.input.jump or Game.e_pressed


func held() -> bool:
	var pads := Input.get_connected_joypads()
	return Input.is_physical_key_pressed(KEY_SPACE) or Game.e_held or (not pads.is_empty() and Input.is_joy_button_pressed(pads[0], JOY_BUTTON_A))


## puts your astronaut on the ground at (x, z) from the middle of the arena, standing still
func stand(x: float, z: float, yaw: float) -> void:
	var a = Actors.astro
	a.mode = "walk"
	a.pos = Vector3(C.x + x, Actors.ground_at(C.x + x, C.z + z), C.z + z)
	a.vel = Vector3.ZERO
	a.vy = 0.0
	a.on_ground = true
	a.yaw = yaw
	a.spin = 0.0


## a still camera, from and at points measured from the middle of the arena. "Up" on the keys is away from it.
func cam(from: Vector3, at: Vector3) -> void:
	World.cam.mode = "fixed"
	World.cam.fixed = { "pos": C + from, "look": C + at }
	World.cam.yaw = atan2(from.x - at.x, from.z - at.z)


## a round wall around the arena, r metres from the middle (the same one that keeps you inside the habitat)
func fence(r: float) -> void:
	Actors.room = { "cx": C.x, "cz": C.z, "r": r, "floor": C.y }


## a soft dot of light that always faces the camera (a star, a meteor's glow). shine() sets how bright it is.
func spark(size: float, hex: int) -> MeshInstance3D:
	var mi: MeshInstance3D = World._sprite(size, hex)
	mi.reparent(root, false)
	return mi


static func shine(mi: MeshInstance3D, a: float) -> void:
	(mi.material_override as StandardMaterial3D).albedo_color.a = a


## big words in the middle of the screen, for a moment
func big(text: String, color := "#ffffff", hold := 1.3) -> void:
	_big.text = text
	_big.add_theme_color_override("font_color", Color.from_string(color, Color.WHITE))
	_big.modulate.a = 1.0
	_big_t = hold


## the game's own line at the bottom (a height, a speed, whose turn it is)
func hud(text: String, color := "#f5f7ff") -> void:
	_hud.text = text
	_hud.add_theme_color_override("font_color", Color.from_string(color, Color.WHITE))


## A game tells the host how its own player is doing. v: the score (more is better); txt: the words beside the name;
## d: rounds finished; out: out of the game; and a few of the games' own (FIELDS).
func report(r: Dictionary) -> void:
	mine.merge(r, true)
	if host():
		st.res[me()] = mine.duplicate()
		_dirty = true
	else:
		Game.crew().N.to_host({ "t": "party", "n": st.n, "r": mine })


# =====================================================================
#  THE PARTY: who hosts, what travels
# =====================================================================
static func esc(x) -> String:
	return Html.esc(x)


## everyone who is here now: [{ pid, name, suit }]
func _here() -> Array:
	var c = Game.crew()
	return c._list() if c else [{ "pid": 0, "name": "You", "suit": int(Game.opts.suit) }]


## A result as it came over the network: only the fields a game may send, each of the right kind and a sane size.
static func safe(r) -> Dictionary:
	var out := {}
	if not (r is Dictionary):
		return out
	for f in FIELDS:
		var x = r.get(f)
		match FIELDS[f]:
			TYPE_FLOAT:
				if (x is float or x is int) and is_finite(float(x)):
					out[f] = clampf(float(x), -1e6, 1e6)
			TYPE_INT:
				if x is int:
					out[f] = clampi(x, -1, 100000)
			TYPE_BOOL:
				if x is bool:
					out[f] = x
			TYPE_STRING:
				if x is String:
					out[f] = x.substr(0, 40)
	return out


## The final table: [[pid, place, stars, words]], best first. Equal scores share a place. In a "last one standing"
## game whoever is still in beats everyone who is out. Alone there is nobody to beat, so no stars.
static func rank(pl: Array, res: Dictionary, last: bool) -> Array:
	var rows: Array = []
	for pid in pl:
		var r: Dictionary = res.get(pid, {})
		var alive: bool = last and not r.get("out", false)
		rows.append([pid, 1e7 if alive else float(r.get("v", 0.0)), "Last one standing!" if alive and pl.size() > 1 else str(r.get("txt", ""))])
	rows.sort_custom(func(a, b): return a[1] > b[1])
	var out: Array = []
	var place := 0
	for i in rows.size():
		if i > 0 and rows[i][1] < rows[i - 1][1]:
			place = i
		out.append([rows[i][0], place, STARS[mini(place, 3)] if pl.size() > 1 else 0, rows[i][2]])
	return out


## the host's state, as far as this screen can check it (an older or newer game may send another shape)
static func _valid(s) -> bool:
	if not (s is Dictionary) or not (s.get("ph") in ["menu", "play", "gap", "end"]) or not (s.get("tot") is Dictionary):
		return false
	if s.ph == "menu":
		return true
	return GAMES.has(s.get("game")) and s.get("pl") is Array and s.get("res") is Dictionary and s.get("who") is Dictionary \
		and s.get("rank") is Array and s.get("round") is int and s.get("n") is int and s.get("seed") is int and s.get("at") is float\
		and s.round >= 0 and s.round < GAMES[s.game].rounds


## the title screen's "Party games", and the host's button in the crew room
func open() -> void:
	if Game.guest() or st.ph != "off":
		return
	st = { "ph": "menu", "n": 0, "tot": {} }
	_share()


## crew.gd passes every "party" message on to here
func net(pid: int, m: Dictionary) -> void:
	if host():
		if (st.ph == "play" or st.ph == "gap") and m.get("n") == st.n and st.pl.has(pid):
			st.res[pid].merge(safe(m.get("r")), true)
			_dirty = true
	elif pid == 0 and _valid(m.get("st")):
		st = m.st
		_apply()


## somebody joined the crew while the party is on (the host hears it)
func joined(pid: int) -> void:
	if st.ph == "off" or not host():
		return
	_share()


## the host changed the party: every screen hears it, this one too
func _share() -> void:
	_dirty = false
	var c = Game.crew()
	if c and c.host:
		c.N.broadcast({ "t": "party", "st": st })
	_apply()


## makes this screen show what `st` says
func _apply() -> void:
	if st.ph == "off":
		return
	if Game.mode != "party":
		var c = Game.crew()
		if c:
			c.started = true        # for the crew this is "a mission": no crew room, and the astronauts are sent
		Game.mode = "party"
		Game.hide_hud()
		Ui.show_part("title", false)
		Actors.astro.mode = "hidden"
		_layer.visible = true
	if st.ph == "menu":
		_unload()
		_menu()
		return
	if not st.pl.has(me()):
		_unload()
		if Ui.modal_open() and Ui.modal_doc != null and Ui.modal_doc.el("party-wait") != null:
			return                  # the card is up already
		Ui.modal("<div class=\"big-icon\">" + GAMES[st.game].icon + "</div><h2>A game is on</h2><p class=\"sub\" id=\"party-wait\">The crew is in the middle of " + esc(GAMES[st.game].name) + ". You are in from the next game!</p>" 			+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"quit\">Leave the crew</button></div>", { "noFocus": true, "actions": { "quit": func(): _quit() } })
		return
	if st.n != _n:
		_load()
	if st.ph == "play" and st.round != _k:
		_round()
	if st.ph == "end" and _end_t == -1.0:
		_end_t = END_WAIT
	_draw_board()


## the game's place: the flat plain the town grows on in a mission, empty here
func _build(planet: String) -> void:
	if _planet != planet or World.root == null or World.root.get_instance_id() != _world_id:
		Game.ext("net", "busy", [60000])
		Game.build_world(planet, int(Game.opts.suit))
		_planet = planet
		_world_id = World.root.get_instance_id()
	C = Terrain.at("colony")
	World.env.t = 0.3
	Actors.set_first_person(false)


func _load() -> void:
	_unload()
	Ui.close_modal()
	_build(GAMES[st.game].planet)
	_n = st.n
	_k = -1
	mine = { "v": 0.0, "txt": "", "d": 0 }
	root = Node3D.new()
	root.position = C
	World.root.add_child(root)
	Au.music(null)
	game = load("res://scripts/party/" + st.game + ".gd").new()
	game.P = self
	game.start()


func _unload() -> void:
	if game == null:
		return
	if game.has_method("stop"):
		game.stop()
	game = null
	if is_instance_valid(root):
		root.queue_free()
	root = null
	for c in extras.get_children():
		c.queue_free()
	_n = -1
	_k = -1
	on = false
	walk = false
	_end_t = -1.0
	_big.text = ""
	_how.text = ""
	_hud.text = ""
	_board.get_parent().visible = false
	_board_key = ""
	Ui.banner(null)
	Ui.prompt(null)
	Actors.room = null
	Actors.fp = Game.pov            # the next world is built with the view you chose
	var a = Actors.astro
	if a:
		a.mode = "hidden"
		a.aim = false
		a.sit_k = 0.0
	World.cam.mode = "title"


func _round() -> void:
	_k = st.round
	k = _k
	# Every screen counts the round from the moment the host announced it (st.at, on the host's clock), so a slow link
	# or a computer that took a while to build the Moon is not behind the others: its countdown is shorter instead.
	var lead := COUNT + (INTRO if k == 0 else 0.0)
	var c = Game.crew()
	var off = (c.host_off if c.guest else 0.0) if c else 0.0        # the host's clock on this computer (crew.gd keeps it)
	t = -lead + (clampf((Time.get_ticks_msec() - float(st.at) - off) / 1000.0, 0.0, lead - 0.5) if off != null else 0.0)
	on = false
	walk = false
	_count = 0
	_end_t = -1.0
	var G: Dictionary = GAMES[st.game]
	Ui.prompt(G.hint, G.key)
	if k == 0:
		big(G.name, "#ffd23f", INTRO)
		_how.text = G.how
	game.round()


## leaving the party (Game.title_scene calls this, whoever asked for the title)
func stop() -> void:
	if st.ph == "off":
		return
	_unload()
	st = { "ph": "off" }
	_layer.visible = false


## may the keys move your astronaut? (game.gd asks every frame)
func walking() -> bool:
	return walk


# =====================================================================
#  THE HOST: picking a game, moving the rounds on, the final table
# =====================================================================
func _pick(id: String) -> void:
	if not host() or not GAMES.has(id):
		return
	Au.play("swish")
	_build(GAMES[id].planet)        # before the round is announced, so the host's own clock loses nothing to it
	var pl: Array = []
	var who := {}
	var res := {}
	for q in _here():
		pl.append(q.pid)
		who[q.pid] = { "name": q.name, "suit": q.suit }
		res[q.pid] = { "v": 0.0, "txt": "", "d": 0 }
		if not st.tot.has(q.pid):
			st.tot[q.pid] = 0
	st.merge({ "ph": "play", "n": int(st.n) + 1, "game": id, "seed": randi() & 0x3fffffff, "round": 0, "at": float(Time.get_ticks_msec()), "pl": pl, "who": who, "res": res, "rank": [] }, true)
	_share()


func _host_step(dt: float) -> void:
	if st.ph == "gap":
		_gap -= dt
		if _gap <= 0:
			st.round += 1
			st.at = float(Time.get_ticks_msec())
			st.ph = "play"
			_share()
		return
	if st.ph != "play" or game == null:
		return
	var G: Dictionary = GAMES[st.game]
	var here: Array = _here().map(func(q): return q.pid).filter(func(pid): return st.pl.has(pid))      # whoever left is not waited for
	var left: Array = here.filter(func(pid): return not st.res[pid].get("out", false))
	var done: bool = left.all(func(pid): return int(st.res[pid].get("d", 0)) > st.round)
	if done or t > G.max + GRACE or (G.get("last", false) and left.size() <= (1 if here.size() > 1 else 0)):
		if st.round + 1 < G.rounds and not left.is_empty():
			st.ph = "gap"
			_gap = GAP
		else:
			st.rank = rank(st.pl, st.res, G.get("last", false))
			for r in st.rank:
				st.tot[r[0]] = int(st.tot.get(r[0], 0)) + r[2]
			st.ph = "end"
		_share()


# =====================================================================
#  EVERY FRAME (game.gd calls this while the mode is "party")
# =====================================================================
func step(dt: float) -> void:
	if st.ph == "off":
		return
	if _big_t > 0:
		_big_t -= dt
		_big.modulate.a = clampf(_big_t / 0.3, 0, 1)
	if host():
		_host_step(dt)
		_send_t += dt
		if _dirty and _send_t > 0.1:
			_send_t = 0.0
			_share()
	if game == null:
		return
	var G: Dictionary = GAMES[st.game]
	if st.ph == "play":
		var was := t
		t += dt
		if t < 0 and t > -COUNT and ceili(-t) != _count:
			_count = ceili(-t)
			_how.text = ""
			big(str(_count), "#ffffff", 0.9)
			Au.play("beep")
		elif t >= 0 and was < 0:
			_how.text = ""
			Ui.prompt(null)             # the hint has been read: the game needs the room
			big("GO!", "#7be36a", 0.8)
			Au.play("score")
	on = st.ph == "play" and t >= 0
	if not on:
		walk = false
	game.frame(dt)
	var head: String = G.icon + " " + G.name + ((" · round %d of %d" % [k + 1, G.rounds]) if G.rounds > 1 else "")
	if on:
		Ui.banner(head + " · " + Game.clock_text(maxf(0, G.max - t)), "info")
	else:
		Ui.banner(head if st.ph != "end" else null, "info")
	if _end_t >= 0:
		_end_t -= dt
		if _end_t < 0:
			_end_t = -2.0           # shown: not again for this game
			_results()


# =====================================================================
#  THE CARDS AND THE SCORE BOARD
# =====================================================================
func _dot(suit) -> String:
	return "<span style=\"color:#%06x\">●</span> " % int(suit)


func _menu() -> void:
	var c = Game.crew()
	var h := host()
	var html := "<div class=\"big-icon\">🎉</div><h2>Party games</h2><p class=\"sub\" id=\"party-menu\">Short games for 1 to 4 astronauts. Every planet has four of them: easy, intermediate, hard and extreme.</p>"
	var soon: Array = []
	for p in Data.PLANET_ORDER:
		var ids: Array = GAMES.keys().filter(func(id): return GAMES[id].planet == p)
		if ids.is_empty():
			soon.append(str(Data.SITES[p].short))
			continue
		html += "<h3>" + str(Data.SITES[p].emoji) + " " + esc(Data.SITES[p].short) + "</h3><div class=\"cards\">"
		for i in ids.size():
			var G: Dictionary = GAMES[ids[i]]
			html += "<button class=\"pick\" data-act=\"play\" data-v=\"" + ids[i] + "\"><em>" + G.icon + "</em><b>" + G.name + "</b><span><span style=\"color:" + TIER_COL[i] + "\">" + TIERS[i] + "</span> · " + G.kind + ". " + esc(G.text) + "</span></button>"
		html += "</div>"
	if soon.size():
		html += "<p class=\"sub\">Coming next: " + esc(", ".join(soon)) + ".</p>"
	if c:
		html += "<h3>Stars so far</h3>"
		for q in _here():
			html += "<p>" + _dot(q.suit) + "<b>" + esc(q.name) + "</b>" + (" · you" if q.pid == me() else "") + " · ⭐ " + str(int(st.tot.get(q.pid, 0))) + "</p>"
	if not h:
		html += "<p class=\"crew-waiting\">⏳ Waiting for <b>" + esc(c.name(0)) + "</b> (the host) to pick a game…</p>"
	html += "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"quit\">" + (("◀ Crew room" if h else "Leave the crew") if c else "◀ Back") + "</button>" \
		+ ("" if c else "<button class=\"btn ghost\" data-act=\"friends\">🧑‍🚀 Play with friends</button>") + "</div>"
	var keep: bool = Ui.modal_open() and Ui.modal_doc != null and Ui.modal_doc.el("party-menu") != null     # redrawn (somebody joined): the focus stays
	var doc := Ui.modal(html, { "cls": "wide", "noFocus": keep, "actions": {
		"play": func(el): _pick(Html.attr(el, "data-v")),
		"quit": func(): _quit(),
		"friends": func():
			Au.play("tap")
			Game.title_scene()
			Ui.title_actions.crew.call(),
	} })
	for b in doc.buttons:
		if not h and Html.attr(b, "data-act") == "play":
			b.disabled = true


## back to the crew room (the host takes everyone there), out of the crew (a guest), or back to the title (alone)
func _quit() -> void:
	Au.play("tap")
	Ui.close_modal()
	if Game.guest():
		Game.crew().leave()
	else:
		Game.title_scene()


func _results() -> void:
	var G: Dictionary = GAMES[st.game]
	var c = Game.crew()
	var h := host()
	var rows := ""
	var won := false
	for r in st.rank:
		var w: Dictionary = st.who.get(r[0], {})
		won = won or (r[0] == me() and r[1] == 0)
		rows += "<div class=\"info-row" + (" good" if r[1] == 0 else "") + "\"><span class=\"ic\">" + (MEDALS[mini(int(r[1]), 3)] if c else str(G.icon)) + "</span><div><b>" + _dot(w.get("suit", 0xffffff)) + esc(w.get("name", "Someone")) + "</b><p>" \
			+ esc(r[3]) + ((" · +" + str(r[2]) + " ⭐ (" + str(int(st.tot.get(r[0], 0))) + " in all)") if c else "") + "</p></div></div>"
	var first: Dictionary = st.who.get(st.rank[0][0], {}) if st.rank.size() else {}
	var tie: bool = st.rank.size() > 1 and st.rank[1][1] == 0
	var title: String = (G.icon + " " + G.name) if not c else ("🤝 A tie in " + G.name + "!" if tie else "🏆 " + esc(first.get("name", "Someone")) + " wins " + G.name + "!")
	Au.play("win" if won else "good")
	Ui.modal("<h2>" + title + "</h2>" + rows + ("" if h else "<p class=\"crew-waiting\">⏳ Waiting for <b>" + esc(c.name(0)) + "</b> (the host) to choose…</p>") \
		+ "<div class=\"modal-actions\">" + ("<button class=\"btn ghost\" data-act=\"menu\">🎉 Another game</button><button class=\"btn primary\" data-act=\"again\">↻ Play again</button>" if h \
			else "<button class=\"btn ghost\" data-act=\"quit\">Leave the crew</button>") + "</div>",
		{ "actions": {
			"menu": func(): _to_menu(),
			"again": func(): _pick(st.game),
			"quit": func(): _quit(),
		} })


func _to_menu() -> void:
	if host():
		Au.play("tap")
		st.ph = "menu"
		_share()


## the Esc key (game.gd). Alone the game waits behind this card; in a crew it goes on.
func pause() -> void:
	if Ui.modal_open():
		return
	Au.play("tap")
	var c = Game.crew()
	Ui.modal("<h2>⏸ Party games</h2><p class=\"sub\">" + ("The game goes on for your crew while this card is open." if c else "The game waits while this card is open.") + "</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"quit\">" + (("End the party" if host() else "Leave the crew") if c else "Leave") + "</button>" \
		+ ("<button class=\"btn ghost\" data-act=\"menu\">🎉 Another game</button>" if host() else "") + "<button class=\"btn primary\" data-act=\"back\">Keep playing</button></div>",
		{ "actions": {
			"quit": func(): _quit(),
			"menu": func():
				Ui.close_modal()
				_to_menu(),
			"back": func():
				Au.play("tap")
				Ui.close_modal(),
		} })


## the players of this game in the corner: their stars, and how each one is doing
func _draw_board() -> void:
	var key := str(st.res) + str(st.tot) + str(st.round)
	if key == _board_key:
		return
	_board_key = key
	var lines: Array = []
	for pid in st.pl:
		var w: Dictionary = st.who.get(pid, {})
		var r: Dictionary = st.res.get(pid, {})
		var words := str(r.get("txt", ""))
		if r.get("last", "") != "" and int(r.get("d", 0)) > st.round:
			words += " · " + str(r.last)
		lines.append("[color=#%06x]●[/color] [b]%s[/b]%s  [color=#b3bde0]%s[/color]" % [int(w.get("suit", 0xffffff)), Html.bb_text(str(w.get("name", "?"))),
			("  ⭐" + str(int(st.tot.get(pid, 0)))) if st.pl.size() > 1 else "", Html.bb_text(words)])
	_board.text = "\n".join(lines)
	_board.get_parent().visible = true
