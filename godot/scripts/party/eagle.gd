extends RefCounted
## Eagle Drop (the Moon, hard, skill). Everybody rides a small lander that falls toward the Moon, side by side.
## Holding the button fires the engine. The Moon pulls at its real 1.62 m/s2 and there is no air to slow you, so the
## only brake is the engine, and the fuel is short: fall as long as you dare, then burn. A soft touchdown scores, a
## quick one scores more, and coming in too fast is a crash.
## Your height travels to the others as your astronaut's place (crew mode sends it), and the engine's flame as the
## astronaut's "aim" flag, which nothing else uses while sitting.

const HEIGHT := [90.0, 120.0, 150.0]    # metres up at the start of each round
const FUEL := [7.0, 7.5, 8.0]           # seconds of engine
const THRUST := 6.5                     # m/s2 upward while the engine fires
const SAFE := [2.0, 4.0, 6.5]           # touching down slower than this (m/s) is perfect, good or hard; faster is a crash
const GRADES := [["Perfect landing!", "#7be36a", 500], ["Good landing", "#7be36a", 350], ["Hard landing", "#ffd23f", 150], ["Crash!", "#ff5468", 0]]
const LANE := 7.0                       # metres between two landers
const SEAT := Vector3(0, 1.55, 0.6)     # where the astronaut sits, from the lander's feet

var P
var landers := {}               # pid -> { g, flame }
var y := 0.0                    # your lander's feet above the ground
var vy := 0.0
var fuel := 0.0
var flying := false
var _base := 0
var _ladder: Control


## 0 perfect, 1 good, 2 hard, 3 crash
static func grade(speed: float) -> int:
	return 0 if speed <= SAFE[0] else (1 if speed <= SAFE[1] else (2 if speed <= SAFE[2] else 3))


## a landing's points: how soft it was, and (unless it was a crash) 12 off 500 for every second it took
static func points(speed: float, took: float) -> int:
	var g := grade(speed)
	return int(GRADES[g][2]) + (maxi(0, 500 - roundi(took * 12.0)) if g < 3 else 0)


func _lander(hex: int, x: float) -> Dictionary:
	var g := Node3D.new()
	g.position.x = x
	P.root.add_child(g)
	var foil := Mats.soft(0xd9a441, { "roughness": 0.35, "metallic": 0.7 })
	var grey := Mats.soft(0xc9ccd6, { "roughness": 0.5, "metallic": 0.3 })
	Mats.add(g, Mats.cyl(1.25, 1.45, 0.9, 8), foil, 0, 1.3, 0)                  # the gold stage with the tanks
	Mats.add(g, Mats.cyl(1.47, 1.47, 0.18, 8), Mats.soft(hex), 0, 1.3, 0)        # a band in the player's colour
	Mats.add(g, Mats.cyl(0.85, 1.1, 0.7, 8), grey, 0, 2.1, 0)                   # the cabin: the astronaut rides on it
	Mats.add(g, Mats.cyl(0.28, 0.6, 0.6, 12), Mats.soft(0x2c2f3a), 0, 0.6, 0)   # the engine bell
	for i in 4:
		var a := PI / 4 + i * PI / 2
		var top := Vector3(cos(a) * 1.2, 1.4, sin(a) * 1.2)
		var foot := Vector3(cos(a) * 2.0, 0.06, sin(a) * 2.0)
		var leg := Mats.add(g, Mats.cyl(0.07, 0.07, top.distance_to(foot), 6), grey)
		leg.position = (top + foot) / 2
		leg.quaternion = Quaternion(Vector3.UP, (top - foot).normalized())
		Mats.add(g, Mats.cyl(0.36, 0.36, 0.08, 10), grey, foot.x, 0.04, foot.z)
	var flame := Mats.add(g, Mats.cone(0.5, 2.6, 10), Mats.unlit(0xffb347, 0.85, true), 0, -1.0, 0, false)
	flame.rotation.x = PI                       # its point down
	flame.visible = false
	return { "g": g, "flame": flame }


func start() -> void:
	P.cam(Vector3(0, 5, 20), Vector3(0, 1.5, 0))
	for pid in P.st.pl:
		landers[pid] = _lander(int(P.st.who[pid].suit), P.lane(pid, LANE))
	_ladder = Control.new()
	_ladder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_ladder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ladder.draw.connect(_draw_ladder)
	P.extras.add_child(_ladder)


func stop() -> void:
	Au.stop_loop("descent")


func round() -> void:
	y = HEIGHT[P.k]
	vy = 0.0
	fuel = FUEL[P.k]
	flying = true
	_base = int(P.mine.get("v", 0.0))
	for pid in landers:
		landers[pid].g.rotation = Vector3.ZERO
	var a = Actors.astro
	a.mode = "sit"
	a.sit_k = 1.0
	a.relax_k = 0.0
	a.sit_walk = 0.0
	a.yaw = 0.0
	a.vel = Vector3.ZERO
	_ride(false)


## your astronaut rides the lander; aim: the engine is firing
func _ride(burn: bool) -> void:
	var a = Actors.astro
	a.aim = burn
	a.vy = vy
	a.pos = P.C + Vector3(P.lane(P.me(), LANE), y, 0) + SEAT


func _touch() -> void:
	var a = Actors.astro
	var speed := -vy
	var g := grade(speed)
	var pts := _base + points(speed, P.t)
	y = 0.0
	vy = 0.0
	flying = false
	_ride(false)
	if g == 3:
		Au.play("thud")
		Au.play("bad")
		World.cam.shake = 0.5
		World.burst(a.pos.x, P.C.y + 1.0, a.pos.z, 36, 9.0, 0xffa040, { "life": 0.9, "size": 0.5 })
		# thrown clear of the wreck
		a.mode = "walk"
		a.sit_k = 0.0
		a.on_ground = false
		a.vy = 6.0
		a.vel = Vector3(randf_range(-3, 3), 0, randf_range(2, 5))
		a.spin = 1.5
	else:
		Au.play("touchdown")
	World.dust(a.pos.x, a.pos.z, 16, 3.0, 0.7)
	P.big(GRADES[g][0], GRADES[g][1])
	P.report({ "v": float(pts), "txt": str(pts) + " pts", "last": "%.1f m/s" % speed, "crash": g == 3, "d": P.k + 1 })


func frame(dt: float) -> void:
	var burn := false
	if flying:
		if P.on:
			burn = P.held() and fuel > 0.0
			if burn:
				fuel -= dt
			vy += ((THRUST if burn else 0.0) - World.gravity) * dt
			y += vy * dt
		_ride(burn)
		if y <= 0.0:
			_touch()
	if burn:
		Au.loop("descent", { "vol": 0.9, "rate": 1.1 })
	else:
		Au.stop_loop("descent", 0.15)
	if flying and P.on:
		# orange: even a full burn from here would not stop you in time
		var need: float = (vy * vy - SAFE[1] * SAFE[1]) / (2.0 * (THRUST - World.gravity)) if vy < -SAFE[1] else 0.0
		P.hud("%d m   ·   %.1f m/s   ·   fuel %d%%" % [roundi(y), -vy, roundi(100.0 * maxf(0.0, fuel) / FUEL[P.k])], "#7be36a" if -vy <= SAFE[1] else ("#ffb15c" if need > y else "#f5f7ff"))
	else:
		P.hud("")
	# every lander stays under its rider; once the rider is off it (thrown out by a crash), it lies where it fell
	for pid in landers:
		var L: Dictionary = landers[pid]
		var b = P.body(pid)
		var riding: bool = b != null and b.mode == "sit"
		if riding:
			L.g.position.y = maxf(0.0, b.pos.y - P.C.y - SEAT.y)
		L.flame.visible = riding and b.aim
		if L.flame.visible:
			L.flame.scale = Vector3(1, randf_range(0.7, 1.25), 1)
			var p: Vector3 = L.g.global_position
			World.emit(p.x, p.y - 1.5, p.z, { "vx": randf_range(-1, 1), "vy": -9.0, "vz": randf_range(-1, 1), "life": 0.5, "size": 0.5, "grow": 2.2, "color": 0xffd9a0, "alpha": 0.6 })
		var r: Dictionary = P.st.res.get(pid, {})
		if r.get("crash", false) and int(r.get("d", 0)) == P.k + 1:
			L.g.rotation.z = 0.45
	# the camera rides down with you, looking a little ahead of the fall
	World.cam.fixed = { "pos": P.C + Vector3(0, y + 5.0 + vy * 0.35, 20), "look": P.C + Vector3(0, y + 1.5 + vy * 0.35, 0) }
	_ladder.queue_redraw()


## at the left of the screen: how high everybody is, from the start height down to the ground
func _draw_ladder() -> void:
	var h: float = _ladder.size.y
	var x := 46.0
	var y0 := h * 0.22
	var y1 := h * 0.78
	_ladder.draw_line(Vector2(x, y0), Vector2(x, y1), Color(1, 1, 1, 0.35), 3.0)
	_ladder.draw_line(Vector2(x - 14, y1), Vector2(x + 14, y1), Color(1, 1, 1, 0.7), 3.0)
	for pid in landers:
		var up: float = clampf(landers[pid].g.position.y / HEIGHT[P.k], 0, 1)
		var col := Color.hex((int(P.st.who[pid].suit) << 8) | 0xFF)
		_ladder.draw_circle(Vector2(x + (10 if pid == P.me() else 0), lerpf(y1, y0, up)), 9.0 if pid == P.me() else 6.0, col)
