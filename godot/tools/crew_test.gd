extends Node
## Crew mode test: two games on one computer, one hosts and one joins, and both play.
##   host:  Godot_console.exe --fixed-fps 30 --path . res://tools/crew_test.tscn -- role=host code=TESTQ net=lan shots=1
##   guest: Godot_console.exe --fixed-fps 30 --path . res://tools/crew_test.tscn -- role=guest code=TESTQ net=lan shots=1
## Options: site=moon|mars, max=<frames>, net=lan (direct only) or net=relay (relay only), grab=1 (the guest picks
## up a power cell from the Solar Rack through the host), shots=1 saves res://tools/shots/crew_<role>_*.png
var args := {}
var f := 0
var role := "host"
var launched := false
var play_f := -1
var last_mode := ""
var shots := {}
var grabbed := false


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2:
			args[kv[0]] = kv[1]
	role = args.get("role", "host")
	Game.boot()
	Game.opts.site = args.get("site", "moon")
	Game.opts.level = args.get("level", "cadet")
	Game.opts.sun = "archive"
	Game.intro_seen[Game.opts.site] = true
	if role == "guest":
		Game.opts.suit = 0x3d9bff
	if args.has("shift"):
		Game.opts.shift = int(args.shift)
	var C = Game.addons.get("crew")
	if C == null:
		_log("no crew add-on")
		get_tree().quit()
		return
	if role == "menu":
		C.open_menu(args.get("code", ""))
		get_tree().create_timer(1.5).timeout.connect(func():
			await _shot("menu")
			get_tree().quit())
		return
	if role == "host":
		C._want_code = args.get("code", "TESTQ")
		C.host_now("Hosty")
	else:
		get_tree().create_timer(float(args.get("wait", "2"))).timeout.connect(func(): C.join_code(args.get("code", "TESTQ"), "Guesty"))


func _log(t: String) -> void:
	print("[%s %5d] %s" % [role, f, t])


func _shot(name: String) -> void:
	if args.get("shots", "0") != "1" or shots.has(name):
		return
	shots[name] = true
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://tools/shots/crew_" + role + "_" + name + ".png")
	_log("shot " + name)


func _press() -> void:
	var doc = Ui.modal_doc if Ui.modal_open() else null
	if doc == null:
		if Ui.info_open():
			Ui.close_info()
		return
	if doc.el("crew-list") or doc.el("crew-status"):
		return               # the crew menus are handled by the test itself
	for b in doc.buttons:
		if not is_instance_valid(b) or not b.is_visible_in_tree() or b.disabled:
			continue
		var act := str(Html.attr(b, "data-act"))
		if act in ["quit", "how", "change", "leave", "science", "journal", "sun", "cert", "future"]:
			continue
		if str(Html.attr(b, "class")).find("primary") >= 0 or act == "pick":
			_log("press " + act)
			b.pressed.emit()
			return


func _process(_dt: float) -> void:
	f += 1
	if role == "menu":
		return
	var C = Game.addons.get("crew")
	var N = Game.addons.get("net")
	if f > int(args.get("max", "1500")):
		_log("max frames: mode " + Game.mode)
		if C and C.on:
			C.leave(true)
		get_tree().quit()
		return
	if f % 60 == 0:
		_log("mode %s on %s started %s crew %d net %s/%s rtt %d/%d relay %s" % [Game.mode, C.on, C.started, C.count(), N.role, N.mode, roundi(N.rtt), roundi(N.rtt_of(1)), N.relay_on])
	if Game.mode != last_mode:
		_log("mode " + last_mode + " -> " + Game.mode)
		last_mode = Game.mode
	if C.on and not C.started and f % 30 == 0 and Ui.modal_open() and Ui.modal_doc.el("crew-list"):
		_shot("room")
	if role == "host" and C.on and (C.count() >= 2 or args.has("solo")) and not launched and Game.mode == "title":
		launched = true
		_log("crew is %d: launching" % C.count())
		Ui.close_modal()
		Game.launch()
	if f % 20 == 0:
		_press()
	if Game.s and Game.s.sol != int(shots.get("_sol", 0)):
		shots["_sol"] = Game.s.sol
		_log("sol %d (mode %s)" % [Game.s.sol, Game.mode])
	if Game.mode == "night" and not shots.has("_night"):
		shots["_night"] = true
		get_tree().create_timer(2.5).timeout.connect(func(): _shot("night"))
	if Game.s == null or (Game.mode != "play" and Game.mode != "inside"):
		Game.stick = Vector2.ZERO
		return
	if play_f < 0:
		play_f = f
		_log("in the mission: sol %d players %s" % [Game.s.sol, str(C.players.keys())])
	var t := f - play_f
	var other = null
	for p in C._others():
		if p.puppet and p.puppet.mode != "hidden":
			other = p.puppet
	if t < 300:
		# walk: the host in a slow circle, the guest out and back
		if role == "host":
			Game.stick = Vector2(cos(t / 40.0), sin(t / 40.0)) * 0.8
		else:
			Game.stick = Vector2(0.9 if (t / 90) % 2 == 0 else -0.9, 0.3)
	elif t < 640 and other:
		# then find each other: walk up to the crewmate and look at them
		var d := Vector2(other.pos.x - Actors.astro.pos.x, other.pos.z - Actors.astro.pos.z)
		World.cam.yaw = atan2(-d.x, -d.y) + 0.35
		World.cam.dist = 9.0
		Game.stick = Vector2(0, -1).rotated(-0.35) if d.length() > (4.0 if role == "host" else 2.5) else Vector2.ZERO
	elif args.get("grab", "0") == "1" and role == "guest" and not grabbed:
		_grab(C, t)
	else:
		Game.stick = Vector2.ZERO
	if t % 90 == 0:
		for p in C._others():
			var b = p.puppet
			_log("sees %s: %s at %s mode %s" % [p.name, "puppet" if b else "no puppet", str(b.pos.snapped(Vector3.ONE * 0.1)) if b else "-", b.mode if b else "-"])
		_log("me at %s carrying %s items %d" % [str(Actors.astro.pos.snapped(Vector3.ONE * 0.1)), str(Actors.astro.carrying.type) if Actors.astro.carrying else "nothing", Actors.items.size()])
	if t == 240:
		_shot("play")
	if t == 620:
		_shot("meet")


## the guest walks to the Solar Rack and takes a power cell: the host's game does it, and the cell comes back in hand
func _grab(C, t: int) -> void:
	var rack: Vector3 = Base.spots.rack
	var a = Actors.astro
	var d := Vector2(rack.x - a.pos.x, rack.z - a.pos.z)
	if Actors.astro.carrying:
		grabbed = true
		Game.stick = Vector2.ZERO
		_log("got it: carrying " + str(a.carrying.type) + " after %d frames" % t)
		_shot("grab")
		return
	if d.length() > 2.2:
		World.cam.yaw = atan2(-d.x, -d.y)
		Game.stick = Vector2(0, -1)
		return
	Game.stick = Vector2.ZERO
	if f % 20 == 0 and Game.action:
		_log("action: " + str(Game.action.get("label", "?")))
		Game.e_pressed = true
