extends Node
## Party mode test: a robot plays the mini-games, alone or as two games on one computer (one hosts, one joins).
##   alone: Godot_console.exe --fixed-fps 30 --path . res://tools/party_test.tscn -- games=star,phase,eagle,storm shots=1
##   host:  ... res://tools/party_test.tscn -- role=host code=TESTP net=lan games=star,storm shots=1
##   guest: ... res://tools/party_test.tscn -- role=guest code=TESTP net=lan shots=1
## Options: games=<ids in order> (default: all four), max=<frames>, shots=1 saves res://tools/shots/party_<role>_*.png
## The guest's robot is the clumsy one: it jumps too early once, steps on a wrong pad, crashes its first lander and
## stands still in the meteor storm.
var args := {}
var f := 0
var role := "solo"
var queue: Array = []
var shots := {}
var last := ""
var done_f := -1
var was_on := false


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2:
			args[kv[0]] = kv[1]
	role = args.get("role", "solo")
	queue = Array(str(args.get("games", "star,phase,eagle,storm")).split(","))
	Game.boot()
	if role == "guest":
		Game.opts.suit = 0x3d9bff
	var C = Game.addons.crew
	if role == "solo":
		Game.ext("party", "open")
	elif role == "host":
		C._want_code = args.get("code", "TESTP")
		C.host_now("Hosty")
	else:
		get_tree().create_timer(float(args.get("wait", "2"))).timeout.connect(func(): C.join_code(args.get("code", "TESTP"), "Guesty"))


func _log(t: String) -> void:
	print("[%s %5d] %s" % [role, f, t])


func _shot(name: String) -> void:
	if args.get("shots", "0") != "1" or shots.has(name):
		return
	shots[name] = true
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://tools/shots/party_" + role + "_" + name + ".png")
	_log("shot " + name)


func _process(_dt: float) -> void:
	f += 1
	var P = Game.addons.party
	var C = Game.addons.crew
	if f > int(args.get("max", "9000")) or (done_f > 0 and f > done_f + 60):
		_log("the end: mode %s, party %s" % [Game.mode, P.st.ph])
		if C.on:
			C.leave(true)
		get_tree().quit()
		return
	var key := "%s %s r%s" % [P.st.ph, P.st.get("game", ""), P.st.get("round", "")]
	if key != last:
		last = key
		_log("party: " + key + ((" results " + str(P.st.res)) if P.st.ph in ["gap", "end"] else ""))
	if role == "host" and C.on and C.count() >= 2 and P.st.ph == "off":
		Ui.close_modal()
		P.open()
	if P.st.ph == "menu" and f % 45 == 0:
		if not shots.has("_menu" + str(P.st.n)):        # a look at the menu first, a pick the next time round
			shots["_menu" + str(P.st.n)] = true
			_shot("menu" + str(P.st.n))
		elif P.host() and (role == "solo" or C.count() >= 2):
			if queue.is_empty():
				if done_f < 0:
					_log("stars " + str(P.st.tot))
					done_f = f
			else:
				P._pick(queue.pop_front())
	if P.st.ph == "end":
		if Ui.modal_open():
			if not shots.has("_end" + str(P.st.n)):
				shots["_end" + str(P.st.n)] = f
				_log("rank " + str(P.st.rank))
			elif f > shots["_end" + str(P.st.n)] + 40:      # once the card has faded in
				_shot("results_" + str(P.st.game))
				if P.host() and f > shots["_end" + str(P.st.n)] + 90:
					P._to_menu()
		Game.stick = Vector2.ZERO
		Game.e_held = false
		return
	if P.game == null:
		if role == "guest" and done_f < 0 and P.st.ph == "off" and f > 600 and not C.on:
			done_f = f                 # the host has left: the test is over
		return
	Game.stick = Vector2.ZERO
	Game.e_held = false
	var g = P.game
	var a = Actors.astro
	var clumsy := role == "guest"
	if f % 90 == 0:
		_log("t %.1f on %s me %s %s" % [P.t, P.on, str(a.pos.snapped(Vector3.ONE * 0.1)), str(P.mine)])
		for pid in P.st.pl:
			if pid != P.me():
				var b = P.body(pid)
				_log("  sees %d: %s" % [pid, (str(b.pos.snapped(Vector3.ONE * 0.1)) + " " + b.mode) if b else "no body"])
	if P.on and not was_on:        # two games on one computer should say the same time, give or take the link
		_log("GO at %.2f s on the wall clock" % fmod(Time.get_unix_time_from_system(), 1000.0))
	was_on = P.on
	if not P.on:
		if P.t > -1.0 and P.t < -0.8:
			_shot(str(P.st.game) + "_ready")
		return
	match P.st.game:
		"star":
			if P.t > g._at + 0.2 and P.k == 0:
				_shot("star")
			if g._state == "" and (P.t > g._at + (0.42 if clumsy else 0.27) or (clumsy and P.k == 1 and P.t > 0.5)):
				Game.input.jump = true
		"phase":
			var show: float = g.seq.size() * g.SHOW
			if P.t > 1.2 and P.k == 0:
				_shot("phase_show")
			if P.t > show + 3.5 and P.k == 0:
				_shot("phase_run")
			if P.t > show and not g._fin and g._stun <= 0:
				var want: int = g.seq[g._step]
				if clumsy and P.k == 0 and g._step == 0 and g._miss == 0:
					want = (want + 4) % 8
				var pad: Dictionary = g.pads[want]
				var d := Vector2(pad.x - (a.pos.x - P.C.x), pad.z - (a.pos.z - P.C.z))
				Game.stick = d.normalized() if d.length() > 0.4 else Vector2.ZERO
		"eagle":
			var v: float = -g.vy
			var stop: float = (v * v - 2.0) / (2.0 * (g.THRUST - World.gravity))
			Game.e_held = g.flying and not (clumsy and P.k == 0) and v > 1.4 and stop >= g.y - 1.5 - v * 0.15
			if g.y < 45 and P.k == 0:
				_shot("eagle_fall")
			if not g.flying and P.k == 0:
				_shot("eagle_down")
		"storm":
			if P.t > 14:
				_shot("storm")
			if P.t > 40:
				_shot("storm_late")
			if not clumsy and not g._out:
				var here := Vector2(a.pos.x - P.C.x, a.pos.z - P.C.z)
				var push := Vector2.ZERO
				for m in g.meteors:
					if m.has("rock") and is_instance_valid(m.rock):
						var d := here - Vector2(m.x, m.z)
						if d.length() < m.r + 3.0:
							push += (d.normalized() if d.length() > 0.05 else Vector2(1, 0)) * (m.r + 3.0 - d.length())
				if here.length() > 8.0:
					push -= here.normalized() * (here.length() - 8.0)
				Game.stick = push.limit_length(1.0) if push.length() > 0.15 else Vector2.ZERO
