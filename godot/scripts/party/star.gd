extends RefCounted
## Shooting Star (the Moon, easy, reflex). The crew stands in a row and watches the black sky. A shooting star
## streaks across it once in every round: the first to press wins the round. A satellite gliding by or a star that
## flares up is not a shooting star, and pressing before the real one costs you the round.
## Each game times its own player from the moment the star shows on that screen, so a slow link costs nobody time.

const WAIT := [2.0, 6.0]        # the star comes this long after the round begins (seconds)
const WINDOW := 1.5             # ...and counts for this long
const FLIGHT := 0.7             # seconds it takes to cross the sky
const SKY := 1500.0             # how far away the sky's lights are drawn

var P
var _at := 0.0                  # when this round's star appears
var _dir := 1.0
var _el := 0.35
var _trail: Array = []          # the star: its head, then its tail
var _decoys: Array = []         # { t, sat, az, el, sp }
var _state := ""                # "" still watching, then "hit", "early" or "miss"
var _total := 0
var _told := false


## 1000 points for an instant answer, one less for every millisecond
static func points(ms: int) -> int:
	return maxi(0, 1000 - ms)


func start() -> void:
	P.cam(Vector3(0, 2.2, 11), Vector3(0, 4.0, -10))
	P.stand(P.lane(P.me(), 2.2), 0, PI)         # backs to the camera, faces to the sky
	for i in 16:
		_trail.append(P.spark(70.0 - i * 3.8, 0xffffff if i == 0 else 0xfff2d8))


func round() -> void:
	var r: Rng32 = P.rng()
	_at = lerpf(WAIT[0], WAIT[1], r.next())
	_dir = 1.0 if r.next() < 0.5 else -1.0
	_el = 0.3 + r.next() * 0.1               # under the top of the screen, over the hills
	_state = ""
	_told = false
	for d in _decoys:
		d.sp.queue_free()
	_decoys = []
	# up to two lights that are not a shooting star, each gone a good moment before the real one
	for i in 2:
		var at: float = 0.6 + r.next() * maxf(0.1, _at - 1.6)
		if r.next() < 0.65 and at < _at - 0.9:
			var sat: bool = r.next() < 0.5
			_decoys.append({ "t": at, "sat": sat, "az": (r.next() - 0.5) * 0.9, "el": 0.15 + r.next() * 0.27, "sp": P.spark(16.0 if sat else 46.0, 0xdfe8ff) })


func _end(state: String, ms: int) -> void:
	_state = state
	_total += points(ms) if state == "hit" else 0
	var words: String = (str(ms) + " ms") if state == "hit" else ("Too early!" if state == "early" else "Missed it")
	P.big(words, "#7be36a" if state == "hit" else "#ff5468")
	Au.play("good" if state == "hit" else "bad")
	P.report({ "v": float(_total), "txt": str(_total) + " pts", "last": words, "ms": ms if state == "hit" else -1, "d": P.k + 1 })


func frame(_dt: float) -> void:
	var t: float = P.t
	var eye: Vector3 = World.camera.global_position
	var u := (t - _at) / FLIGHT
	for i in _trail.size():
		var q := u - i * 0.014                  # the tail follows the head
		var show: bool = P.on and q > 0.0 and q < 1.0
		P.shine(_trail[i], (1.0 - i / 16.0) * minf(1.0, q * 10.0) * minf(1.0, (1.0 - q) * 4.0) if show else 0.0)
		if show:
			_trail[i].global_position = eye + World._sky_dir(PI + _dir * lerpf(-0.5, 0.45, q), _el - 0.2 * q) * SKY
	for d in _decoys:
		var q: float = (t - d.t) / (3.5 if d.sat else 0.5)
		var show: bool = P.on and q > 0.0 and q < 1.0
		# a satellite is a small steady light that glides; a flare swells and fades on the spot
		P.shine(d.sp, (0.85 * minf(1.0, minf(q, 1.0 - q) * 8.0) if d.sat else sin(q * PI)) if show else 0.0)
		if show:
			d.sp.global_position = eye + World._sky_dir(PI + d.az + ((q - 0.5) * 0.8 if d.sat else 0.0), d.el) * SKY
	if P.st.ph == "gap" and not _told and P.st.pl.size() > 1:
		_told = true
		var best := -1
		var who := ""
		for pid in P.st.pl:
			var r: Dictionary = P.st.res[pid]
			var ms := int(r.get("ms", -1))
			if int(r.get("d", 0)) == P.k + 1 and ms >= 0 and (best < 0 or ms < best):
				best = ms
				who = str(P.st.who[pid].name)
		P.big(("⚡ " + who + " · " + str(best) + " ms") if best >= 0 else "Nobody got it!", "#ffd23f", 2.2)
	if not P.on or _state != "":
		return
	if P.pressed():
		var a = Actors.astro
		if a.on_ground:                         # everybody sees who jumped, and when
			a.vy = 3.7
			a.on_ground = false
			a.air_t = 0.0
			Au.play("jump")
		_end("early" if t < _at else "hit", int((t - _at) * 1000.0))
	elif t > _at + WINDOW:
		_end("miss", 0)
