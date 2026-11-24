extends TestBase
## Party mode without a network or a screen: the final table, what a guest's game may report, and each mini-game's
## rules and plans. (A robot playing the games for real: tools/party_test.tscn.)

const PARTY := preload("res://scripts/addons/party.gd")
const STAR := preload("res://scripts/party/star.gd")
const PHASE := preload("res://scripts/party/phase.gd")
const EAGLE := preload("res://scripts/party/eagle.gd")
const STORM := preload("res://scripts/party/storm.gd")


func run() -> void:
	# four games for every planet that has any, each with its script
	for p in Data.PLANET_ORDER:
		var ids: Array = PARTY.GAMES.keys().filter(func(id): return PARTY.GAMES[id].planet == p)
		ok("games: " + p + " has none or four", ids.size() == 0 or ids.size() == PARTY.TIERS.size(), str(ids))
		for id in ids:
			var g = load("res://scripts/party/" + id + ".gd").new()
			ok("games: " + id + " can start, begin a round and run", g.has_method("start") and g.has_method("round") and g.has_method("frame"))
	# the final table
	var res := { 0: { "v": 300.0, "txt": "a" }, 1: { "v": 900.0, "txt": "b" }, 2: { "v": 300.0, "txt": "c" }, 3: { "v": 10.0, "txt": "d" } }
	var r: Array = PARTY.rank([0, 1, 2, 3], res, false)
	ok("rank: the best is first with 3 stars", r[0] == [1, 0, 3, "b"], str(r))
	ok("rank: equal scores share second place", r[1][1] == 1 and r[2][1] == 1 and r[1][2] == 2 and r[2][2] == 2, str(r))
	ok("rank: the one after a tie is fourth", r[3] == [3, 3, 0, "d"], str(r))
	ok("rank: alone there are no stars", PARTY.rank([0], res, false) == [[0, 0, 0, "a"]])
	ok("rank: someone who never reported comes last", PARTY.rank([0, 7], res, false)[1][0] == 7)
	var last: Array = PARTY.rank([0, 1], { 0: { "v": 50.0, "txt": "50.0 s", "out": true }, 1: { "v": 0.0, "txt": "" } }, true)
	ok("rank: still standing beats a longer time", last[0][0] == 1 and last[0][3] == "Last one standing!" and last[1][3] == "50.0 s", str(last))
	# what a guest's game may report
	var s: Dictionary = PARTY.safe({ "v": 12, "txt": "x".repeat(99), "d": 2, "out": "yes", "evil": [1], "ms": 3.5, "crash": true, "last": 5 })
	ok("safe: known fields of the right kind only", s.keys() == ["v", "txt", "d", "crash"], str(s.keys()))
	ok("safe: a number becomes a score, long words are cut", typeof(s.v) == TYPE_FLOAT and s.txt.length() == 40)
	ok("safe: not a result at all", PARTY.safe("boo").is_empty() and PARTY.safe({ "v": INF }).is_empty())
	ok("state: a menu passes", PARTY._valid({ "ph": "menu", "n": 0, "tot": {} }))
	ok("state: junk and unknown games do not", not PARTY._valid(null) and not PARTY._valid({ "ph": "play", "tot": {}, "game": "chess" }) and not PARTY._valid({ "ph": "boo", "tot": {} }))
	# Shooting Star
	ok("star: quicker is more", STAR.points(200) == 800 and STAR.points(1500) == 0)
	# Phase Chase
	var a: Array = PHASE.order(Rng32.new(5), 12)
	var same := false
	for i in range(1, a.size()):
		same = same or a[i] == a[i - 1]
	ok("phase: 12 phases, none twice in a row", a.size() == 12 and not same and a.all(func(p): return p >= 0 and p < 8), str(a))
	ok("phase: the same seed gives the same order", a == PHASE.order(Rng32.new(5), 12) and a != PHASE.order(Rng32.new(6), 12))
	ok("phase: points", PHASE.points(2, 1, false, 9.0) == 175 and PHASE.points(3, 0, true, 10.0) == 500 and PHASE.points(0, 3, false, 0.0) == 0)
	# Eagle Drop
	ok("eagle: grades", EAGLE.grade(1.0) == 0 and EAGLE.grade(3.9) == 1 and EAGLE.grade(6.0) == 2 and EAGLE.grade(9.0) == 3)
	ok("eagle: soft and quick beats soft and slow beats a crash", EAGLE.points(1.5, 13.0) > EAGLE.points(1.5, 30.0) and EAGLE.points(3.0, 40.0) > EAGLE.points(9.0, 10.0) and EAGLE.points(9.0, 10.0) == 0)
	# Meteor Storm
	var plan: Array = STORM.plan(Rng32.new(9))
	var inside: bool = plan.all(func(m): return Vector2(m.x, m.z).length() < STORM.ARENA and m.t > m.warn and m.t - m.warn < STORM.LENGTH)
	ok("storm: every meteor lands inside the fence, in time", plan.size() > 60 and inside, str(plan.size()))
	ok("storm: it gets thicker", plan[-1].t - plan[-2].t < plan[1].t - plan[0].t + 0.6 and plan[-1].warn < plan[0].warn)
	ok("storm: the same seed gives the same storm", str(plan) == str(STORM.plan(Rng32.new(9))) and str(plan) != str(STORM.plan(Rng32.new(10))))
	var m := { "x": 2.0, "z": 0.0, "r": 2.5 }
	ok("storm: in the ring is hit, outside is not", STORM.hits(m, Vector3(3.5, 0, 0)) and not STORM.hits(m, Vector3(5.5, 0, 0)))
	ok("storm: a high jump clears a small one", not STORM.hits(m, Vector3(2.0, 3.0, 0)))
