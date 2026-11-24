extends RefCounted
## Meteor Storm (the Moon, extreme, survival). Meteors rain on the plain, more and more of them. The Moon has no air
## to burn them up, so every one reaches the ground. A red ring on the ground shows where the next one lands, and
## fills up as it comes. One hit and you are out; the last astronaut standing wins.
## The whole storm is planned from the game's seed (plan()), so every screen sees the same meteors with no messages.
## Each game only checks its own astronaut and reports the hit.

const ARENA := 13.0             # the fence, metres from the middle
const LENGTH := 60.0            # the storm ends then: whoever still stands has survived it
const PEAK := 45.0              # from the first meteor to the thickest part of the storm, in seconds
const EVERY := [1.1, 0.24]      # seconds between two meteors: at the start, at the peak
const WARN := [2.2, 1.1]        # seconds a ring shows before its meteor lands: at the start, at the peak
const FROM := Vector3(-14, 42, -10)     # a meteor comes in from up there, measured from where it lands

var P
var meteors: Array = []         # plan(), and once a meteor shows: its ring `m`, its rock `rock`
var _next := 0
var _out := false
var _out_t := 0.0


## The storm: [{ t (it lands), warn (its ring shows this long before), x, z, r (its blast) }], in the order the rings show.
static func plan(r: Rng32) -> Array:
	var out: Array = []
	var at := 1.5
	while at < LENGTH:
		var u := clampf(at / PEAK, 0, 1)
		var warn := lerpf(WARN[0], WARN[1], u)
		var d := sqrt(r.next()) * (ARENA - 0.5)             # the square root spreads them evenly over the disc
		var a := r.next() * TAU
		out.append({ "t": at + warn, "warn": warn, "x": cos(a) * d, "z": sin(a) * d, "r": 5.2 if out.size() % 6 == 5 else 2.4 + r.next() * 1.6 })
		at += lerpf(EVERY[0], EVERY[1], u) * (0.7 + 0.6 * r.next())
	return out


## does a meteor landing at (x, z) with blast r hit an astronaut whose feet are at `at` (both from the middle)?
## A jump at the right moment clears a small one.
static func hits(m: Dictionary, at: Vector3) -> bool:
	return Vector3(at.x - m.x, at.y + 0.9, at.z - m.z).length() < float(m.r) + 0.3


func start() -> void:
	P.cam(Vector3(0, 21, 24), Vector3(0, 0, -1))
	Mats.add(P.root, Mats.torus(ARENA + 0.4, 0.1, 64, 6), Mats.glow(0x4fd8ff, 1.4), 0, 0.08, 0, false)      # the fence


func round() -> void:
	meteors = plan(P.rng())
	_next = 0
	_out = false
	P.fence(ARENA)
	var a: float = P.st.pl.find(P.me()) / float(P.st.pl.size()) * TAU
	P.stand(sin(a) * 4.0, cos(a) * 4.0, a)


func _show(m: Dictionary) -> void:
	m.m = Mats.unlit(0xff3030, 0.2)
	m.ring = Mats.add(P.root, Mats.cyl(m.r, m.r, 0.04, 28), m.m, m.x, 0.05, m.z, false)
	m.rock = Mats.add(P.root, Mats.ball(m.r * 0.3, 8, 6), Mats.glow(0xff8a3a, 1.5), 0, 0, 0, false)


func _land(m: Dictionary) -> void:
	m.ring.queue_free()
	m.rock.queue_free()
	var p: Vector3 = P.C + Vector3(m.x, 0, m.z)
	var a = Actors.astro
	var near: float = clampf(1.0 - Vector2(a.pos.x - p.x, a.pos.z - p.z).length() / 30.0, 0, 1)
	Au.play("thud", { "at": p, "vol": 1.0 if m.r > 4 else 0.7 })
	World.cam.shake = maxf(World.cam.shake, (0.45 if m.r > 4 else 0.25) * near)
	World.burst(p.x, p.y + 0.3, p.z, 26, 4.0 + m.r, 0xffb060, { "life": 0.7, "size": 0.4 })
	World.dust(p.x, p.z, 12, 2.0 + m.r, 0.8)
	if _out or not P.on or not hits(m, a.pos - P.C):
		return
	# knocked off your feet and out of the game: thrown away from the blast
	_out = true
	_out_t = 2.2
	var away := Vector2(a.pos.x - p.x, a.pos.z - p.z).normalized() if Vector2(a.pos.x - p.x, a.pos.z - p.z).length() > 0.05 else Vector2(1, 0)
	Actors.room = null
	a.vel = Vector3(away.x * 9.0, 0, away.y * 9.0)
	a.vy = 6.5
	a.on_ground = false
	a.spin = 2.0
	Au.play("bad")
	P.big("💥 Out!", "#ff5468", 2.0)
	P.report({ "v": P.t, "txt": "%.1f s" % P.t, "out": true, "d": 1 })


func frame(dt: float) -> void:
	var t: float = P.t
	while P.on and _next < meteors.size() and meteors[_next].t - meteors[_next].warn <= t:
		_show(meteors[_next])
		_next += 1
	for m in meteors:
		if not m.has("rock") or not is_instance_valid(m.rock):
			continue
		var u: float = clampf(1.0 - (m.t - t) / m.warn, 0, 1)        # 0 as its ring shows, 1 as it lands
		m.m.albedo_color.a = 0.15 + 0.55 * u * u
		m.rock.position = Vector3(m.x, 0.2, m.z) + FROM * (1.0 - u)
		var w: Vector3 = m.rock.global_position
		World.emit(w.x, w.y, w.z, { "life": 0.35, "size": m.r * 0.3, "grow": 0.3, "color": 0xffc070, "alpha": 0.7 })
		if u >= 1.0:
			_land(m)
		elif P.st.ph != "play":                 # the game is over: the storm stops
			m.ring.queue_free()
			m.rock.queue_free()
	if _out:
		# once the tumble is over you watch the rest from outside the fence
		if _out_t > 0:
			_out_t -= dt
			if _out_t <= 0:
				P.stand(-ARENA - 3.5, P.lane(P.me(), 2.0), PI / 2)
	elif P.on and t >= LENGTH and P.mine.get("d", 0) == 0:
		Au.play("win")
		P.big("You survived the storm!", "#7be36a", 2.5)
		P.report({ "v": LENGTH, "txt": "Survived the whole storm!", "d": 1 })
	P.walk = P.on and not _out
	P.hud(("Survived  %.1f s" % t) if P.on and not _out else "")
