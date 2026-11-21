extends Node
## What a planet does to you. Only the planets after Mars have one (data/planets.json, "hazard"):
##   geysers (Europa)  vents in the ice. Each one hisses, then shoots water up for a moment. Stand on it and it throws
##                     you into the sky.
##   lava (Io)         glowing pools. Touch one and it knocks you back, and you drop what you carry. On every beat a
##                     pool spits and reaches twice as far.
## In a crew every screen places the same hazards (a seeded Rng32) and times them from the mission's day clock (s.t),
## and each game only moves its own astronaut, so crew mode needs no new messages.
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
	kind = Data.SITES[site].get("hazard", "")
	if kind == "":
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


func update(dt: float, s: Dictionary, mode: String) -> void:
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
