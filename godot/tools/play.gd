extends Node
## A robot player for testing: starts a mission, presses the main button on every card, walks to each goal and
## presses E. Run it headless and fast:
##   Godot_console.exe --headless --fixed-fps 30 --path . res://tools/play.tscn -- site=moon level=cadet
## Options: shots=1 (with a window) saves screenshots to res://tools/shots/play_*.png, max=<frames>, inside=1 (visit the habitat)
var args := {}
var f := 0
var last_mode := ""
var last_sol := 0
var stuck := 0.0
var last_pos := Vector3.ZERO
var shots := {}
var wander := 0.0
var last_dist := 1e9


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2:
			args[kv[0]] = kv[1]
	Game.boot()
	Game.opts.site = args.get("site", "moon")
	Game.opts.level = args.get("level", "cadet")
	Game.opts.sun = "archive"
	if args.has("shift"):
		Game.opts.shift = int(args.shift)
	if args.has("pioneer"):
		Game.opts.pioneer = "on"
	if args.has("nointro"):
		Game.intro_seen[Game.opts.site] = true
	Game.launch()


func _log(t: String) -> void:
	print("[bot %6d] %s" % [f, t])


func _press_primary() -> bool:
	var doc = Ui.modal_doc if Ui.modal_open() else null
	if doc == null and Ui.info_open() and not args.has("sunwatch") and not args.has("keep"):
		Ui.close_info()
		return true
	if doc == null:
		return false
	var best = null
	for b in doc.buttons:
		if not is_instance_valid(b) or not b.is_visible_in_tree():
			continue
		var cls := str(Html.attr(b, "class"))
		var act := str(Html.attr(b, "data-act"))
		if act in ["quit", "how", "change", "leave", "science", "journal", "sun", "cert", "future"]:
			continue
		if cls.find("primary") >= 0:
			best = b
			break
		if best == null and (cls.find("pick") >= 0 or act == "pick" or cls.find("opt") >= 0):
			best = b
	if best == null:
		return false
	_log("press " + str(Html.attr(best, "data-act")) + " on modal")
	best.pressed.emit()
	return true


func _shot(name: String) -> void:
	if args.get("shots", "0") != "1" or shots.has(name):
		return
	shots[name] = true
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png("res://tools/shots/play_" + name + ".png")
	_log("shot " + name)


func _process(_dt: float) -> void:
	f += 1
	if f > int(args.get("max", "200000")):
		_log("max frames, quitting. mode=" + Game.mode)
		get_tree().quit()
		return
	var s = Game.s
	if f % 1800 == 0:
		_log("state mode %s modal %s info %s holo %s mini %s cut %s t %s" % [Game.mode, Ui.modal_open(), Ui.info_open(), Game.holo_open(), Game.mini, Game.cut, str(s.t) if s else "-"])
	if Game.mode != last_mode:
		_log("mode " + last_mode + " -> " + Game.mode + ((" sol " + str(s.sol) + " air " + str(snappedf(s.air, 0.1)) + " food " + str(snappedf(s.food, 0.1)) + " dose " + str(snappedf(s.dose, 0.1))) if s else ""))
		last_mode = Game.mode
		if Game.mode in ["play", "inside", "night", "end", "brief", "launch"]:
			_shot(Game.mode + str(s.sol if s else 0))
	if s and s.sol != last_sol:
		last_sol = s.sol
	if Game.mode == "play" and f % 100 == 0:
		if args.get("map", "0") == "1" and not Game.map_open:
			Game.toggle_map(true)
		if args.get("pov", "0") == "1" and not Game.pov:
			Game.set_pov(true)
	for n in str(args.get("shotat", "")).split(",", false):
		if f == int(n):
			_shot("f" + n)
			if Game.mode == "intro":
				_log("film time %.1f" % float(Game.ext("intro", "time")))
	if args.has("inside") and s and f == int(args.inside):
		Game.go_inside(args.get("room", "hab"))
		_log("went inside: mode " + Game.mode + " room " + str(Game.room))
		if args.has("nopov"):
			Game.set_pov(false, true)
			World.cam.dist = float(args.nopov)
	if args.has("station") and s and Game.mode == "inside" and f == int(args.inside) + 20:
		if args.has("dish"):
			s.m.comms.on = true
		Game.room_action(args.station).call()
		_log("station " + args.station + " opened, cut " + str(Game.cut != null))
	if args.has("send") and s and f == int(args.inside) + 80 and Ui.modal_open():
		Ui.modal_doc.act(args.send, null)
		_log("sent " + args.send + ": modal " + str(Ui.modal_open()) + " log " + str(s.comms.log.size() if s.get("comms") else 0))
	if args.has("inside") and s and Game.mode == "inside" and f > int(args.inside) and f < int(args.inside) + int(args.get("stay", "400")):
		Game.stick = Vector2.ZERO
		if args.has("turn"):
			World.cam.yaw += float(args.turn) / 30.0
		return
	if args.has("sunwatch") and s and f == int(args.sunwatch):
		var d = Game.ext("sunwatch", "open", [s, Game.weather])
		_log("sun watch opened: " + str(d != null) + " info " + str(Ui.info_open()))
	if args.has("sunwatch") and s and f > int(args.sunwatch) and Ui.info_open():
		return
	if args.has("postcard") and s and f == int(args.postcard):
		Game.snap_postcard()
		_log("postcard snapped, info " + str(Ui.info_open()))
	if args.has("cert") and s and f == int(args.cert):
		var info: Dictionary = Game.certificate_info()
		info.name = "Sam"
		Game.ext("keepsake", "open_certificate", [info])
		_log("certificate opened, info " + str(Ui.info_open()))
	if args.has("save") and s and f == int(args.save) and Ui.info_open():
		Ui.info_doc.act("save", null)
	if args.has("pio") and s and _pioneer_test(s):
		return
	if args.has("colony") and s and _colony_test(s):
		return
	if args.has("holo") and s and _holo_test():
		return
	if args.has("keep") and s and Ui.info_open():
		return
	if args.has("filter") and f == int(args.get("filterat", "220")):
		Game.ext("fx", "set_filter", [int(args.filter)])
	if args.get("journal", "") == str(f):
		Game.open_journal()
	if args.has("observe") and s:
		var o := int(args.observe)
		if f == o:
			var L: Vector2 = Terrain.L.seat
			Actors.astro.pos = Vector3(L.x + 3, Terrain.height(L.x + 3, L.y + 3), L.y + 3)
		elif f == o + 5:
			Game.stick = Vector2.ZERO
			Game.start_observe()
			_log("observe started: mode " + Game.mode)
		elif f == o + 1500:
			Game.ext("observe", "stand", [false])
		if f > o and f < o + 1600 and Game.mode == "observe":
			Game.stick = Vector2.ZERO
			return
	if args.has("rock") and s and f == int(args.rock):
		s.sky = null
		Game.ext("sky", "update", [0.016, s, Game.SKY])
		s.sky.days[str(s.sol)] = 0.0
		_log("meteorite forced")
	if args.has("rock") and s and s.get("sky") and s.sky.site != null and f == int(args.rock) + 120:
		var cs: Dictionary = s.sky.site
		Actors.astro.pos = Vector3(cs.x + 1.5, Terrain.height(cs.x + 1.5, cs.z), cs.z)
		if Actors.astro.carrying != null:
			Game.put_down()
		_log("walked to the crater")
	if args.has("rock") and s and s.get("sky") and f % 150 == 0:
		var k: Dictionary = s.sky
		_log("sky fall=%s site=%s found=%s finds=%d goal=%s" % [k.fall != null, k.site, k.found, s.finds.size(), Game.goal.get("text", "") if Game.goal else ""])
	if s and args.get("cheat", "0") == "1" and Game.mode == "play":
		s.air = maxf(s.air, 70.0)
		s.food = maxf(s.food, 60.0)
		s.dose = minf(s.dose, 20.0)
	if Game.mode == "end" and Ui.modal_open():
		_shot("end")
		if f % 30 == 0:
			_log("mission over: " + str(s.get("over")))
			get_tree().quit()
		return
	if f % 20 == 0 and (Ui.modal_open() or (Ui.info_open() and str(f - int(args.get("journal", "-999"))).to_int() > 60)):
		if not _press_primary() and f % 600 == 0:
			var bs := []
			for b in Ui.modal_doc.buttons:
				bs.append(str(Html.attr(b, "data-act")) + ":" + str(Html.attr(b, "class")))
			_log("stuck on a modal, buttons " + str(bs))
		return
	if f % 900 == 0 and Game.mode != "play":
		_log("waiting in mode " + Game.mode + " modal " + str(Ui.modal_open()) + " info " + str(Ui.info_open()) + " holo " + str(Game.holo_open()) + " mini " + str(Game.mini != null))
	if Game.mode == "inside":
		if f % 90 == 0 and Game.s.t < Game.s.dayLength * 0.85:
			Game.exit_hab()
		return
	if Game.mode != "play" or Ui.modal_open():
		Game.stick = Vector2.ZERO
		return
	_drive(s)


func _drive(s) -> void:
	var a = Actors.astro
	if args.get("debug", "0") == "1" and f % 300 == 0:
		var its := []
		for it in Actors.items:
			its.append("%s/%s/%s@%s" % [it.type, it.state, it.tag, str(it.pos.snapped(Vector3.ONE))])
		_log("rack cells %s items %s astro %s goal %s" % [str(s.rack.cells), str(its), str(a.pos.snapped(Vector3.ONE * 0.1)), str(Game.goal.target if Game.goal else null)])
	if Actors.rover.driver:
		Game.exit_rover_local()
	# use whatever is in reach now and then
	var lbl: String = str(Game.action.label) if Game.action else ""
	var skip: bool = lbl.find("rover") >= 0 or lbl == "Put down" or lbl == "Sit and observe" or ((lbl.find("inside") >= 0 or lbl.find("Go in") >= 0) and s.t < s.dayLength * 0.85)
	if Game.action and Game.action.has("run") and f % 15 == 0 and not skip:
		Game.e_pressed = true
		Game.e_held = true
	elif f % 15 == 5:
		Game.e_held = false
	if Game.mini != null:
		var m: Dictionary = Game.mini
		if m.type == "drill":
			Game.e_held = true
			Game.stick = Vector2(clampf((m.zc - m.x) * 4.0, -1, 1), 0)
		elif m.type == "dial" and m.lock <= 0 and absf(m.needle - m.c) <= m.w / 3:
			Game.e_pressed = true
		return
	var target = Game.goal.target if Game.goal else null
	if wander > 0:
		wander -= 1.0 / 30.0
		target = null
	var dir := Vector3.ZERO
	if target is Vector3:
		dir = Vector3(target.x - a.pos.x, 0, target.z - a.pos.z)
		if dir.length() < 1.6:
			dir = Vector3.ZERO
	else:
		dir = Vector3(sin(f * 0.004), 0, cos(f * 0.004))
	if dir.length() > 0.01:
		dir = dir.normalized()
		var yaw: float = World.cam.yaw
		var fw := Vector3(-sin(yaw), 0, -cos(yaw))
		var rt := Vector3(cos(yaw), 0, -sin(yaw))
		Game.stick = Vector2(dir.dot(rt), -dir.dot(fw))
		Game.look_idle = 0.0
	else:
		Game.stick = Vector2.ZERO
	if f % 300 == 100:
		Game.input.jump = true
	# no progress toward the goal for 3 s: hop next to it (this tests the game, not the robot's path finding)
	if f % 90 == 0:
		var dist := 1e9
		if target is Vector3:
			dist = Vector2(target.x - a.pos.x, target.z - a.pos.z).length()
		if target is Vector3 and dist > 2.5 and dist > last_dist - 1.0:
			var back := Vector3(a.pos.x - target.x, 0, a.pos.z - target.z).normalized() * 1.8
			a.pos = Vector3(target.x + back.x, Actors.ground_at(target.x + back.x, target.z + back.z) + 0.1, target.z + back.z)
			a.vel = Vector3.ZERO
			_log("hop to " + Game.goal.icon + " " + str(a.pos.snapped(Vector3.ONE)))
		last_dist = dist
	if f % 900 == 0:
		_log("t=%.0f/%.0f air %.1f food %.1f dose %.1f goal %s carrying %s at %s moved %.0f act %s" % [s.t, s.dayLength, s.air, s.food, s.dose, Game.goal.text if Game.goal else "-", a.carrying.type if a.carrying else "-", str(a.pos.snapped(Vector3.ONE)), a.moved, Game.action.label if Game.action else "-"])


## pio=N: at frame N walk up to a boulder, break it with the hammer, open the workshop, then place and build a panel
var _pk := -1
var _p0 := -1
func _pioneer_test(s) -> bool:
	var P = Game.addons.get("pioneer")
	if P == null or Game.mode != "play":
		return false
	var o := int(args.pio)
	if _p0 < 0 and f >= o:
		_p0 = f
		var best := 1e9
		for k in Terrain.boulders.size():
			var b: Dictionary = Terrain.boulders[k]
			var d: float = Vector2(b.x, b.z).length()
			if not b.seat and b.r > 1.0 and d > 30 and d < best and P._breakable(k):
				best = d
				_pk = k
		var b2: Dictionary = Terrain.boulders[_pk]
		var away: Vector2 = Vector2(-b2.x, -b2.z).normalized()
		var at: Vector2 = Vector2(b2.x, b2.z) + away * (b2.r + 1.0)
		Actors.astro.pos = Vector3(at.x, Actors.ground_at(at.x, at.y) + 0.05, at.y)
		Actors.astro.vel = Vector3.ZERO
		World.cam.yaw = atan2(-(b2.x - at.x), -(b2.z - at.y))
		World.cam.pitch = 0.32
		World.cam.dist = 7.0
		_log("pioneer: by boulder %d r %.2f need %d" % [_pk, b2.r, P._rock_of(_pk).need])
	if _p0 < 0:
		return false
	var t := f - _p0
	Game.stick = Vector2.ZERO
	if t < 300 and t % 18 == 10 and P._breakable(_pk):
		P._swing_at(_pk)
	if t == 26:
		_shot("pio_ring")
	if t == 300:
		_log("pioneer: rock gone %s mats %s pieces left %d" % [not P._breakable(_pk), str(s.mats), P.pieces.size()])
		s.mats = { "rock": 30, "metal": 12, "glass": 12 }
		P.menu()
		_log("pioneer: menu open %s" % Ui.info_open())
	if t == 330:
		_shot("pio_menu")
	if t == 360:
		Ui.close_info()
		_log("pioneer: placing %s" % P._start_place("panel"))
	if t == 380:
		_shot("pio_ghost")
		_log("pioneer: ghost ok %s msg '%s'" % [P.place.ok if P.place else null, P.place.msg if P.place else ""])
	if t == 390 and P.place and not P.place.ok:
		World.cam.yaw += 1.2
	if t == 400:
		P._confirm_place()
		_log("pioneer: built %s structs %d" % [str(s.built), P.structs.size()])
	if t == 412:
		_shot("pio_rise")
	if t == 470:
		_shot("pio_built")
	if t > 480:
		return false
	return true


# ---------- holo=1: draw every step of every hologram and save them as contact sheets (two scenes a sheet) ----------
var _hq: Array = []
var _hi := -1
var _hat := 0
var _hids: Array = []
var _hsheet: Image = null
var _hui := 0


func _holo_test() -> bool:
	if Game.mode != "play" and not Game.holo_open() and _hui == 0:
		return false
	if _hi == -1:
		var S: Dictionary = Game.ext("holo", "scenes")
		_hids = S.keys()
		for id in _hids:
			var inf = Game.ext("holo", "info", [id, Game.holo_data(id)])
			for k in inf.steps.size():
				_hq.append([id, k])
		_log("holo: %d scenes, %d steps" % [_hids.size(), _hq.size()])
		_hi = 0
		_hat = f + 2
	if _hi < _hq.size():
		var it: Array = _hq[_hi]
		if f == _hat:
			Game.ext("holo", "draw", [it[0], Game.holo_data(it[0]), it[1], float(args.get("ht", "3"))])
		elif f == _hat + 3:
			var img := get_viewport().get_texture().get_image()
			var c: Control = Game.addons.holo.canvas
			var k := img.get_width() / get_viewport().get_visible_rect().size.x
			var r := c.get_global_rect()
			var part := img.get_region(Rect2i(Vector2i(r.position * k), Vector2i(r.size * k)))
			part.resize(480, 270, Image.INTERPOLATE_LANCZOS)
			var n := _hids.find(it[0])
			if _hsheet == null:
				_hsheet = Image.create(1920, 540, false, img.get_format())
				_hsheet.fill(Color(0.1, 0.1, 0.1))
			_hsheet.blit_rect(part, Rect2i(0, 0, 480, 270), Vector2i(int(it[1]) * 480, (n % 2) * 270))
			_hi += 1
			_hat = f + 1
			var nxt = _hq[_hi][0] if _hi < _hq.size() else ""
			if _hi >= _hq.size() or (_hids.find(nxt) / 2 != n / 2):
				_hsheet.save_png("res://tools/shots/holo_%02d.png" % (n / 2))
				_log("holo sheet %d saved" % (n / 2))
				_hsheet = null
		return true
	# then the real thing: open one through the game, page through it with the keys, and close it
	if _hui == 0:
		Game.ext("holo", "close")
		_hui = f
		var ok := Game.show_holo(str(args.get("holoui", "shield")))
		_log("holo opened through the game: " + str(ok) + " open " + str(Game.holo_open()))
	elif f == _hui + 45:
		_shot("holo_ui")
	elif f == _hui + 60:
		var ev := InputEventKey.new()
		ev.physical_keycode = KEY_RIGHT
		ev.pressed = true
		Input.parse_input_event(ev)
	elif f == _hui + 150:
		_shot("holo_ui2")
		_log("holo step after a right arrow: " + str(Game.addons.holo.cur.step if Game.addons.holo.cur else -1))
	elif f == _hui + 160:
		var ev := InputEventKey.new()
		ev.physical_keycode = KEY_ESCAPE
		ev.pressed = true
		Input.parse_input_event(ev)
	elif f == _hui + 170:
		_log("holo open after Escape: " + str(Game.holo_open()))
		return false
	return f < _hui + 170


# ---------- colony=N: at frame N rebuild the town (timed), show it from four sides, land a ship, then play the future film ----------
var _c0 := -1
const _CVIEWS := [[Vector3(0, 18, 62), Vector3(0, 2, 0)], [Vector3(42, 46, 42), Vector3(0, 0, -2)], [Vector3(15, 6, 17), Vector3(5, 2, -3)],
	[Vector3(-34, 22, -46), Vector3(0, 3, -10)], [Vector3(-26, 9, 34), Vector3(-14, 2, 16)]]


func _cview(C, v: Array) -> void:
	var p: Vector3 = v[0]
	var l: Vector3 = v[1]
	World.cam.mode = "cine"
	World.cam.cine.pos = Vector3(C.wx(p.x, p.z), C.h0 + p.y, C.wz(p.x, p.z))
	World.cam.cine.look = Vector3(C.wx(l.x, l.z), C.h0 + l.y, C.wz(l.x, l.z))
	World.cam.cine.fov = 52.0


func _colony_test(s) -> bool:
	var C = Game.addons.get("colony")
	if C == null:
		return false
	if _c0 < 0:
		if Game.mode != "play" or f < int(args.colony):
			return false
		_c0 = f
		C.set_stage(0)
		C.grp.queue_free()
		var t0 := Time.get_ticks_usec()
		C.build(World.root, World.site_id)
		_log("colony: built in %.0f ms, %d units, town %s" % [(Time.get_ticks_usec() - t0) / 1000.0, C.units.size(), C.town()])
		C.set_stage(int(args.get("cstage", "5")))
		_log("colony: stage %d people %d colliders %d" % [C.stage(), C.people(), Base.colliders.size()])
	var t := f - _c0
	Game.stick = Vector2.ZERO
	var nv: int = _CVIEWS.size()
	if t < nv * 24:
		_cview(C, _CVIEWS[t / 24])
		if t % 24 == 18:
			_shot("colony_v%d" % (t / 24))
		return true
	var a := nv * 24
	if args.has("arrive") and t < a + 340:
		if t == a:
			C.set_stage(int(args.arrive) - 1)
			C.set_stage(int(args.arrive), { "arrive": true })
			_log("colony: arriving %s" % C.busy())
		_cview(C, [Vector3(-20, 14, 44), Vector3(0, 8, -14)])
		if t == a + 60 or t == a + 170 or t == a + 230 or t == a + 330:
			_shot("colony_arrive%d" % (t - a))
		return true
	if args.has("arrive"):
		a += 340
	if args.has("vision"):
		if t == a:
			World.cam.mode = "play"
			Game.play_vision()
			_log("colony: vision mode %s time %.1f" % [Game.mode, C.vision_time()])
		for k in [3, 12, 26, 40, 51]:
			if t == a + k * 30:
				_log("colony: film t %.1f mode %s" % [C.vision_time(), Game.mode])
				_shot("colony_film%02d" % k)
		if t == a + 57 * 30:
			_log("colony: after film mode %s stage %d vis %s" % [Game.mode, C.stage(), C.vis != null])
			return false
		return Game.mode == "vision" or t < a + 57 * 30
	World.cam.mode = "play"
	return false
