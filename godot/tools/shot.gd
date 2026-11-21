extends Node
## Renders a few frames and saves a screenshot, for checking the look without opening the editor:
##   Godot_v4.7.2-stable_win64_console.exe --path . res://tools/shot.tscn -- site=mars cam=title out=res://tools/shots/a.png
var args := {}
var frames := 0
var hz: Node = load("res://scripts/addons/hazards.gd").new()      # the planet's geysers or lava: part of its look

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2:
			args[kv[0]] = kv[1]
	var t0 := Time.get_ticks_msec()
	World.build(args.get("site", "mars"))
	print("world built in ", Time.get_ticks_msec() - t0, " ms")
	World.cam.mode = args.get("cam", "title")
	World.env.t = float(args.get("t", "0.3"))
	if args.has("x"):
		World.cam.mode = "fixed"
		World.cam.fixed = { "pos": Vector3(float(args.x), float(args.get("y", "8")), float(args.z)), "look": Vector3(float(args.get("lx", "0")), float(args.get("ly", "2")), float(args.get("lz", "0"))) }
	if get_node_or_null("/root/Base") and args.get("base", "1") == "1":
		get_node("/root/Base").build(World.root, Data.SITES[args.get("site", "mars")].id)
	hz.build(World.root, args.get("site", "mars"))
	if hz.list.size():
		print("hazards at ", hz.list.map(func(h): return Vector2i(h.x, h.z)))
	if args.get("base", "1") == "1":
		Actors.build(World.root, args.get("site", "mars"))
		if World.cam.mode == "play":
			World.cam.focus = Actors.focus
			World.cam.yaw = float(args.get("yaw", "0"))
			World.cam.pitch = float(args.get("pitch", "0.35"))
			World.cam.dist = float(args.get("dist", "9"))
		if args.has("fp"):
			Actors.set_first_person(true)
			World.cam.fp = true
			World.cam.eye = Actors.eye

func _process(dt: float) -> void:
	frames += 1
	World.time = float(args.get("time", "0")) + frames * 0.016
	World.update(0.016 if frames > 2 else 100.0)
	Base.update(0.016, null)
	hz.update(0.016, { "t": World.time }, "play" if Actors.astro else "")
	if Actors.astro:
		var walk: String = args.get("walk", "0")
		var inp := { "x": 0.0, "z": -1.0 if walk != "0" else 0.0, "jump": args.get("jump", "") == str(frames), "sprint": walk == "2" }
		Actors.update(0.016, inp)
	if frames == 3 and args.has("ui"):
		_ui(args.ui)
	if frames == int(args.get("frames", "40")):
		var img := get_viewport().get_texture().get_image()
		img.save_png(args.get("out", "res://tools/shots/shot.png"))
		print("saved ", args.get("out", "res://tools/shots/shot.png"))
		get_tree().quit()


func _ui(which: String) -> void:
	var ui = get_node("/root/Ui")
	ui.show_part("title", which == "title")
	if which == "modal":
		ui.modal("<h2>🚀 Choose your mission</h2><p class=\"sub\">Pick where to land and how hard it should be.</p>"
			+ "<div class=\"cards\"><button class=\"pick sel\" data-act=\"a\"><em>🌕</em><b>The Moon</b><span>Close to Earth. Long days, no air.</span></button>"
			+ "<button class=\"pick\" data-act=\"b\"><em>🔴</em><b>Mars</b><span>Dust storms, thin air, far from home.</span></button></div>"
			+ "<div class=\"info-row alert\"><span class=\"ic\">☢</span><div><b>A big solar storm today!</b><p><span class=\"tagline\">Live NASA data</span> Soil bags 🧱 on the dome help. Press <kbd>E</kbd> to grab.</p></div></div>"
			+ "<ul><li>Carry 🔋 cells to sockets</li><li>Feed 🧊 ice to the 💨 air maker</li></ul>"
			+ "<div class=\"modal-actions\"><button class=\"btn ghost\" data-act=\"back\">Back</button><button class=\"btn primary\" data-act=\"go\">Launch 🚀</button></div>", {})
	elif which == "hud":
		var s: Dictionary = Sim.new_game({ "site": args.get("site", "mars"), "level": "commander", "weather": Weather.archive(), "seed": 7 })
		Sim.start_sol(s)
		s.t = s.dayLength * 0.35
		for k in ["hud", "goals", "radio", "prompt", "hands"]:
			ui.show_part(k, true)
		ui.set_hud(s)
		ui.set_goals("Today", [{ "icon": "🔋", "text": "Plug 2 cells into the air maker", "done": true }, { "icon": "🧊", "text": "Mine ice and feed it", "now": true }, { "icon": "🔬", "text": "Drill a core", "optional": true }])
		ui.banner("☢ Solar storm in 0:40 — get inside!", "")
		ui.say("Good morning, Commander! Plug the power cells in first.", null, true)
		ui.prompt("Pick up the power cell")
		ui.card({ "kind": "why", "icon": "💨", "title": "Why does ice make air?", "text": "Water is H₂O. Split it with power and you get oxygen to breathe.", "holo": "air" })
		ui.marks([{ "icon": "🔋", "label": "Cell", "x": 500, "y": 400, "cls": "goal" }])
		ui.tags([{ "text": "💨 Air maker", "x": 800, "y": 300 }])
