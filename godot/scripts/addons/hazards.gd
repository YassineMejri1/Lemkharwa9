extends Node
## What a planet does to you. Only the planets after Mars have one (data/planets.json, "hazard"):
##   geysers (Europa)  vents in the ice. Each one hisses, then shoots water up for a moment. Stand on it and it throws
##                     you into the sky.
##   lava (Io)         glowing pools. Touch one and it knocks you back, and you drop what you carry. On every beat a
##                     pool spits and reaches twice as far.
##   worm (Sahrun)     the deepmaw, a giant sand worm (made up), from the web version's js/deepmaw.js. Stay on open
##                     sand too long on a hunting day and the ground shakes, the sand swirls where you stand, and it
##                     bursts out, arcs over and dives back in. Still in the ring: it swallows you, and you wake up
##                     at the airlock, short of air and time. Rocks, buildings and the rover are safe.
## In a crew every screen places the same hazards (a seeded Rng32) and times them from the mission's day clock (s.t),
## and each game only moves its own astronaut, so crew mode needs no new messages. The host's game decides when the
## deepmaw hunts and keeps the hunt in s.worm, which every crew game already receives with the mission.
## shortcut: hazards do not touch the rover, the crewmates' puppets or things you throw; add that when it matters.

const COUNT := { "geysers": 8, "lava": 10 }
const CLEAR := 30.0            # metres kept free around every place in Terrain.L, so no hazard sits on a job
const PERIOD := 12.0           # seconds from one shot of a geyser to its next; a lava pool spits on the same beat
const HISS := 1.5              # a geyser hisses this long before it shoots: time to step on, or off
const SHOT := 2.5
const SPIT := 0.6

var kind := ""
var list: Array = []           # { x, y, z, r, ph, m }: the place, its reach, its place in the beat, its glowing material
var _cool := 0.0               # after a hit, a moment before the next one

# the deepmaw: the numbers of js/deepmaw.js
const HUNT := { 5: [3], 8: [3, 6], 10: [3, 6, 8] }      # the days it hunts, by the length of the mission
const OPEN := 4.0              # seconds on open sand before it comes for you
const WARN := 5.0              # seconds of shaking before it bursts out (7.5 with the quake sensor set up)
const HOME := 0.4              # for this share of the warning it still steers toward you, then it is committed
const CATCH := 6.5             # metres: inside this ring when it bursts out, you are swallowed
const WORM_AIR := 10.0         # air to refill your suit after it spits you out
const WORM_TIME := 0.06        # the share of the shift lost inside it
const SEGS := 22               # the rings of its body
const GAP := 0.045             # from one ring to the next, as a share of its arc
const SPEED := 0.38            # arcs per second
var _open_t := 0.0             # how long you have stood on open sand
var _seen := -1.0              # the hunt this game is showing (its start time)
var _out := false              # that hunt has burst out of the sand
var _gulp := -1.0              # it has you: seconds until its mouth closes
var _body: Node3D = null
var _pit: MeshInstance3D = null


## every place the outpost uses, as flat points
static func _places() -> Array:
	var out: Array = []
	for v in Terrain.L.values():
		if v is Vector2:
			out.append(v)
		elif v is Array:
			out.append_array(v)
		else:
			out.append_array((v as Dictionary).values())
	return out


func build(root: Node3D, site: String) -> void:
	list = []
	_body = null                # the old one went with the old world
	_pit = null
	_seen = -1.0
	_gulp = -1.0
	_open_t = 0.0
	kind = Data.SITES[site].get("hazard", "")
	if kind == "":
		return
	if kind == "worm":
		_pit = Mats.add(root, Mats.cyl(CATCH, CATCH, 0.06, 32), Mats.unlit(0x2a1808, 0.55), 0, 0, 0, false)
		_body = Node3D.new()
		root.add_child(_body)
		for i in SEGS:              # eleven metres thick at the head, thinner toward the tail; each ring is a barrel along its own y
			var r := 5.4 * (1.0 - 0.55 * i / SEGS)
			Mats.add(_body, Mats.cyl(r * 0.92, r, 3.8, 20), Mats.mat(0x9a8468 if i % 2 else 0x6e5a46))
		var head: Node3D = _body.get_child(0)
		Mats.add(head, Mats.torus(6.2, 0.8), Mats.mat(0x4a2e22), 0, 1.9, 0)                   # the lip
		Mats.add(head, Mats.cyl(4.9, 4.9, 0.1, 24), Mats.unlit(0x1a0200), 0, 1.95, 0, false)      # the dark of its mouth
		_pit.visible = false
		_body.visible = false
		return
	var rng := Rng32.new(40 + Data.PLANET_ORDER.find(site))
	var keep := _places()
	for _try in 600:
		if list.size() >= COUNT[kind]:
			break
		var a := rng.next() * TAU
		var d := 36.0 + rng.next() * 110.0
		var p := Vector2(cos(a) * d, sin(a) * d)
		var r := 1.2 if kind == "geysers" else 1.8 + rng.next() * 1.2
		if keep.any(func(q: Vector2) -> bool: return q.distance_to(p) < CLEAR) or list.any(func(h: Dictionary) -> bool: return Vector2(h.x, h.z).distance_to(p) < 14):
			continue
		var y := Terrain.height(p.x, p.y)
		var bump := 0.0
		for o in [Vector2(r, 0), Vector2(-r, 0), Vector2(0, r), Vector2(0, -r)]:
			bump += absf(Terrain.height(p.x + o.x, p.y + o.y) - y)
		if bump > 0.6:           # flat ground only: on a slope the ground would cut through it
			continue
		var m: StandardMaterial3D
		if kind == "geysers":
			Mats.add(root, Mats.cyl(0.5, 1.5, 0.5, 12), Mats.mat(0xb9c8d6), p.x, y + 0.2, p.y)
			m = Mats.glow(0x9fe8ff, 1.0)
			Mats.add(root, Mats.cyl(0.45, 0.45, 0.06, 12), m, p.x, y + 0.45, p.y, false)
		else:
			Mats.add(root, Mats.cyl(r + 0.15, r + 0.9, 0.36, 16), Mats.mat(0x2a1a12), p.x, y + 0.12, p.y)      # a low dark rim around the pool
			m = Mats.glow(0xff3b0a, 1.0)
			Mats.add(root, Mats.cyl(r, r, 0.06, 16), m, p.x, y + 0.29, p.y, false)
		list.append({ "x": p.x, "y": y, "z": p.y, "r": r, "ph": rng.next() * PERIOD, "m": m })


## Where a hazard is in its beat, in seconds since its shot began (0 .. PERIOD). The hiss is the last HISS seconds.
static func beat(t: float, ph: float) -> float:
	return fposmod(t + ph, PERIOD)


## The days a deepmaw may hunt today: the planned days up to today that it has not used yet (a day you stay safe
## carries the hunt over to the next).
static func hunt_days(total: int, sol: int, done: Array) -> Array:
	return (HUNT.get(total, [3]) as Array).filter(func(d: int) -> bool: return d < total and d <= sol and not done.has(d))


## Open sand: away from the outpost, from every building and boulder, from the table rock and from the edge of the map.
static func open_sand(x: float, z: float) -> bool:
	var p := Vector2(x, z)
	if p.length() < 48 or p.length() > Terrain.PLAY_R - 15 or p.distance_to(Terrain.L.mesa) < 30:
		return false
	return not Base.colliders.any(func(c: Dictionary) -> bool: return p.distance_to(Vector2(c.x, c.z)) - c.r < 10)


## A point on its way through the air: u = 0 where it bursts out, 1 where it dives back in. Below 0 and above 1 it
## is under the sand. The same numbers give the same arc in every player's game.
static func arc(ev: Dictionary, u: float) -> Vector3:
	var ex: float = ev.tx + ev.dx * ev.dist
	var ez: float = ev.tz + ev.dz * ev.dist
	return Vector3(lerpf(ev.tx, ex, u), lerpf(Terrain.height(ev.tx, ev.tz), Terrain.height(ex, ez), u) + 4.0 * ev.high * u * (1 - u), lerpf(ev.tz, ez, u))


## where a deepmaw is about to burst out, for the "RUN!" mark (null when none is coming)
func marker(s: Dictionary):
	var ev = s.get("worm", {}).get("ev")
	if kind != "worm" or ev == null or s.t - ev.t0 >= ev.warn:
		return null
	return Vector3(ev.tx, Terrain.height(ev.tx, ev.tz) + 3, ev.tz)


func _spray(p: Vector3, n: int, speed: float) -> void:
	for _i in n:
		var ang := randf() * TAU
		World.emit(p.x, p.y, p.z, { "vx": cos(ang) * randf() * speed, "vy": randf_range(0.4, 1.3) * speed, "vz": sin(ang) * randf() * speed,
			"life": 2.6, "size": 2.0, "grow": 2.4, "color": World.look.dust, "alpha": 0.7, "grav": World.gravity * 0.6 })


func _worm(dt: float, s: Dictionary, mode: String) -> void:
	if not is_instance_valid(_body):
		return
	var a = Actors.astro
	var me := Vector2(a.pos.x, a.pos.z)
	var host: bool = not Game.guest()
	var on_foot: bool = mode == "play" and not Actors.rover.driver and (a.mode == "walk" or a.mode == "busy")
	if mode == "play":
		Game.tip("worm", "Deepmaws, giant sand worms, hunt on the open sand far from the outpost. If the ground starts to shake, run for rocks, a building or the rover!")
	if not s.has("worm"):
		if not host:
			return
		s.worm = { "done": [], "ev": null, "last": 0 }
	var w: Dictionary = s.worm
	# the host: on a hunting day, a player who lingers on open sand on foot gets hunted
	if w.ev == null and host:
		var days := hunt_days(int(s.totalSols), int(s.sol), w.done)
		var ph := Sim.storm_phase(s)
		var hunted: bool = on_foot and a.mode == "walk" and not days.is_empty() and w.last != s.sol and open_sand(me.x, me.y) \
			and s.t > s.dayLength * 0.2 and s.t < s.dayLength * 0.88 and ph != "warning" and ph != "active" and not Game.crisis_open and Game.mini == null
		_open_t = _open_t + dt if hunted else 0.0
		if _open_t > OPEN:
			_open_t = 0.0
			# where it dives back in: 36 to 52 m away, on open sand, never toward the outpost
			var dir := me.normalized()
			var dist := 40.0
			for _k in 16:
				var b := Vector2.from_angle(randf() * TAU) * randf_range(36, 52)
				if (me + b).length() > me.length() - 5 and open_sand(me.x + b.x, me.y + b.y):
					dir = b.normalized()
					dist = b.length()
					break
			w.done.append(days[0])
			w.last = s.sol
			w.ev = { "sol": s.sol, "t0": s.t, "warn": 7.5 if s.inst.get("seismo") else WARN, "tx": me.x, "tz": me.y, "dx": dir.x, "dz": dir.y, "dist": dist, "high": randf_range(24, 32) }
			Game.say("The ground is shaking! Something HUGE is coming up under you. Run for the rocks or the rover!", true)
	var ev = w.ev
	if ev == null or int(ev.sol) != int(s.sol):
		if ev != null and host:
			w.ev = null
		_body.visible = false
		_pit.visible = false
		_gulp = -1.0
		return
	if _seen != ev.t0:
		_seen = ev.t0
		_out = false
		_gulp = -1.0
	var tw: float = s.t - ev.t0
	var from := arc(ev, 0)
	if tw < ev.warn:
		# 1. the warning: it steers toward you for a moment, then the sand swirls and sinks where it will come up
		if host and mode == "play" and tw < ev.warn * HOME:
			ev.tx = lerpf(ev.tx, me.x, minf(1, dt * 2.2))
			ev.tz = lerpf(ev.tz, me.y, minf(1, dt * 2.2))
		var k: float = tw / ev.warn
		_body.visible = false
		_pit.visible = true
		_pit.position = from + Vector3(0, 0.15, 0)
		_pit.scale = Vector3.ONE * (0.4 + 0.6 * k)
		# it lies along the slope, so the ground does not cut through it
		_pit.quaternion = Quaternion(Vector3.UP, Vector3(Terrain.height(ev.tx - 2, ev.tz) - Terrain.height(ev.tx + 2, ev.tz), 4, Terrain.height(ev.tx, ev.tz - 2) - Terrain.height(ev.tx, ev.tz + 2)).normalized())
		for _i in 2:
			var ang := randf() * TAU
			var rr := CATCH * randf_range(0.6, 1.1)
			World.emit(from.x + cos(ang) * rr, from.y + 0.2, from.z + sin(ang) * rr, { "vx": -sin(ang) * 6 - cos(ang) * 1.8, "vy": 0.3 + k * 1.2, "vz": cos(ang) * 6 - sin(ang) * 1.8,
				"life": 0.7, "size": 0.3 + k * 0.25, "grow": 1.1, "color": World.look.dust, "alpha": 0.5, "grav": World.gravity * 0.3 })
		World.cam.shake = maxf(World.cam.shake, (0.08 + 0.6 * k * k) * clampf(1 - me.distance_to(Vector2(ev.tx, ev.tz)) / 140, 0, 1) * (1.0 if mode == "play" else 0.5))
		return
	# 2. out of the sand, over the top and back in
	_pit.visible = false
	var head: float = -0.1 + (tw - ev.warn) * SPEED
	if not _out:
		_out = true
		Au.play("launch")
		_spray(from + Vector3(0, 1, 0), 90, 14)
		var d := me.distance_to(Vector2(ev.tx, ev.tz))
		if on_foot and d < CATCH:
			_gulp = 1.3             # it has you: for a moment you ride up in its mouth
			Au.play("bad")
		elif host and mode == "play" and d < 60:
			Game.say("That was close! A deepmaw, a giant sand worm! It cannot burrow through rock, so rocks, buildings and the rover are safe places.", true)
	_body.visible = true
	for i in SEGS:
		var u := head - i * GAP
		var seg: Node3D = _body.get_child(i)
		seg.visible = u > -0.2 and u < 1.2
		if seg.visible:
			seg.position = arc(ev, u)
			seg.quaternion = Quaternion(Vector3.UP, (arc(ev, u + 0.01) - arc(ev, u - 0.01)).normalized())
	if head > 0 and head - SEGS * GAP < 0:
		_spray(from, 2, 6)           # sand flies where it leaves the ground...
	if head > 1 and head - SEGS * GAP < 1:
		_spray(arc(ev, 1), 2, 6)     # ...and where it dives back in
	if _gulp > 0:
		_gulp -= dt
		a.pos = arc(ev, head) + Vector3(0, 2, 0)
		a.vel = Vector3.ZERO
		a.vy = 0
		a.on_ground = false
		if _gulp <= 0:
			# It does not like the taste of a spacesuit: you wake up at the airlock, short of air and time. What you
			# carried is left out on the sand (on the web it is gone).
			if host:
				s.air = maxf(0, s.air - WORM_AIR)
				s.today.extra.append({ "res": "air", "text": "Refilling your suit after the deepmaw spat you out", "v": -WORM_AIR })
			Game.skip_time(WORM_TIME, true, " of the shift lost inside the deepmaw")
			Game.say("GULP! The deepmaw did not like the taste of your spacesuit and spat you out. The crew dragged you back to the airlock. Refilling your suit took " + str(int(WORM_AIR)) + " air. Next time, run for the rocks!", true)
	if head - SEGS * GAP > 1.1:          # its tail is back under the sand: it is gone
		_body.visible = false
		if host:
			w.ev = null


func update(dt: float, s: Dictionary, mode: String) -> void:
	if kind == "worm":
		_worm(dt, s, mode)
		return
	if list.is_empty() or mode != "play":
		return
	_cool = maxf(0, _cool - dt)
	var a = Actors.astro
	var free: bool = a.mode == "walk" and _cool <= 0
	for h in list:
		var u := beat(s.t, h.ph)
		var dx: float = a.pos.x - h.x
		var dz: float = a.pos.z - h.z
		var d := sqrt(dx * dx + dz * dz)
		if kind == "geysers":
			var shot := u < SHOT
			Mats.energy(h.m, 3.0 if shot else (1.8 if u > PERIOD - HISS else 0.6))
			if shot or u > PERIOD - HISS:
				for _i in (3 if shot else 1):
					World.emit(h.x, h.y + 0.5, h.z, { "vx": randf_range(-0.8, 0.8), "vy": randf_range(9, 15) if shot else randf_range(1, 2.5), "vz": randf_range(-0.8, 0.8),
						"life": 1.5 if shot else 0.6, "size": 0.45, "grow": 1.6, "color": 0xdff4ff, "alpha": 0.7, "grav": World.gravity * 0.5 })
			if shot and free and d < h.r and a.pos.y - h.y < 3:
				a.vy = 6.0
				a.on_ground = false
				_cool = 1.0
				Au.play("hiss")
				World.cam.shake = maxf(World.cam.shake, 0.25)
				Game.tip("geyser", "Whoosh! A geyser! Water from the ocean under the ice shoots out here. It hisses just before it fires.")
		else:
			var spit := u < SPIT
			Mats.energy(h.m, 2.6 if spit else 1.0 + sin(s.t * 2.0 + h.ph) * 0.3)
			if spit:
				World.emit(h.x, h.y + 0.2, h.z, { "vx": randf_range(-3, 3), "vy": randf_range(4, 8), "vz": randf_range(-3, 3),
					"life": 0.9, "size": 0.2, "grow": 0.4, "color": 0xffa040, "alpha": 1.0, "grav": World.gravity })
			if free and d < h.r * (2.0 if spit else 0.85) and a.pos.y - h.y < 1.0:
				var n := Vector2(dx, dz) / d if d > 0.01 else Vector2(1, 0)
				a.vel.x = n.x * 7.0
				a.vel.z = n.y * 7.0
				a.vy = 3.0
				a.on_ground = false
				_cool = 1.0
				if a.carrying:
					Game.put_down()
				Au.play("bad")
				World.cam.shake = maxf(World.cam.shake, 0.35)
				Game.tip("lava", "Hot! Keep off the glowing lava: it knocks you back and you drop what you carry.")
