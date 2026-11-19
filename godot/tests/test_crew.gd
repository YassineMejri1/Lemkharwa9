extends TestBase
## Crew mode without a network: the lock on the messages, crew codes, the mission state's changes, and the smoothing
## of crewmates' movement. (Two games talking to each other: tools/crew_test.tscn.)

const NET := preload("res://scripts/net/net.gd")
const CREW := preload("res://scripts/addons/crew.gd")


func run() -> void:
	# crew codes
	ok("code: cleaned", NET.clean_code(" ab-cde ") == "ABCDE", NET.clean_code(" ab-cde "))
	ok("code: from crew=", NET.clean_code("astro crew=xyzab") == "XYZAB")
	ok("code: too short stays short", NET.clean_code("ab1") == "AB")
	var c := NET.new_code()
	ok("code: new ones have 5 letters, no I or O", c.length() == 5 and c.find("I") < 0 and c.find("O") < 0, c)
	# the lock
	var a = NET.new()
	var b = NET.new()
	a._keys("ABCDE")
	b._keys("ABCDE")
	var msg := { "t": "p", "k": 7, "a": [1.25, 0.0, -3.5, 0.2, 0, 0, 0, 3, "walk", ""], "v": Vector3(1, 2, 3) }
	var sealed: PackedByteArray = a._seal(var_to_bytes(msg))
	var back = bytes_to_var(b._unseal(sealed))
	ok("lock: the same code opens it", back is Dictionary and back.k == 7 and back.a[8] == "walk" and back.v == Vector3(1, 2, 3))
	ok("lock: numbers keep their kind", back is Dictionary and typeof(back.k) == TYPE_INT)
	var other = NET.new()
	other._keys("ZZZZZ")
	ok("lock: another code does not open it", other._unseal(sealed).is_empty())
	var bent := sealed.duplicate()
	bent[20] ^= 1
	ok("lock: a changed message is refused", b._unseal(bent).is_empty())
	ok("lock: same message, different bytes each time", a._seal(var_to_bytes(msg)) != sealed)
	ok("lock: topics hide the code", a._base.find("ABCDE") < 0 and a._base == b._base)
	a.free()
	b.free()
	other.free()
	# the mission state: only what changed travels, and it lands in the same place
	var before := { "s": { "air": 50.0, "sol": 1, "m": { "air": { "power": 0 } }, "log": [1, 2] }, "tut": { "moved": true } }
	var after := { "s": { "air": 49.5, "sol": 1, "m": { "air": { "power": 1 } }, "log": [1, 2, 3], "new": "x" }, "tut": {} }
	var d: Array = []
	CREW._diff(before, after, [], d)
	ok("state: four changes and a removal", d.size() == 5, str(d))
	var mirror: Dictionary = before.duplicate(true)
	for e in d:
		CREW._set_path(mirror, e[0], e[1] if e.size() >= 2 else null, e.size() < 2)
	ok("state: the copy matches after the changes", mirror == after, str(mirror))
	ok("state: an int stays an int", typeof(mirror.s.m.air.power) == TYPE_INT)
	ok("state: copies leave objects out", not CREW._clean({ "a": 1, "o": Node, "f": func(): pass }).has("o"))
	# smoothing: a crewmate is drawn a little behind, between the two states around that time
	var buf := CREW.Buf.new()
	var t0 := CREW.now()
	CREW._push(buf, { "t": t0 - 200.0, "a": [0.0] }, 20.0)
	CREW._push(buf, { "t": t0 - 150.0, "a": [5.0] }, 20.0)
	CREW._push(buf, { "t": t0 - 150.0, "a": [9.0] }, 20.0)
	ok("smooth: the same state twice is kept once", buf.e.size() == 2)
	var s = CREW._sample(buf, t0 - 175.0)
	ok("smooth: halfway between", s != null and absf(s.k - 0.5) < 0.01 and s.a[0] == 0.0 and s.b[0] == 5.0, str(s))
	var x = CREW._sample(buf, t0 - 100.0)
	ok("smooth: a little past the last one runs ahead", x != null and x.x > 0.0 and x.x <= 0.161)
	ok("smooth: waits at least the delay", CREW._delay_of(buf) >= CREW.DELAY)
