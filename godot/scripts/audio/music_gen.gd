extends Node
## Quiet background music made live (no audio files): slow, soft chords that fade in and out, now and then a single
## bell note, and a low hum in a storm. A port of js/music.js. The game picks a mood (title, work, storm, crisis, night,
## launch) and a site (Moon or Mars); this does the rest. Every note is a looping sine (or triangle) wave played at the
## right pitch, with its loudness shaped here every frame. It plays on its own bus ("Gen") with a low-pass filter.

const MASTER := 0.35   # loudness of the whole music bus
const CAP := 16        # most notes that may sound at once
const AHEAD := 0.6
const XFADE := 2.5
const GAINS := [0.034, 0.03, 0.028, 0.024, 0.02]
const SHIMMER := 0.007
const BELL := 0.016
const HUM := 0.03

# Notes are MIDI numbers (60 = middle C, 69 = A 440).  n: pad notes  s: quiet notes high above  c: a bell may also play C
const CALM := {
	"C": { "n": [48, 55, 60, 64, 71], "s": [79, 76], "to": ["Am", "Em", "F", "G"] },
	"Am": { "n": [45, 55, 60, 64, 71], "s": [76, 81], "to": ["C", "F", "Em", "G"] },
	"F": { "n": [53, 57, 60, 64, 69], "s": [76, 81], "c": true, "to": ["C", "Am"] },
	"G": { "n": [43, 50, 55, 64, 71], "s": [74, 79], "to": ["C", "Em", "Am"] },
	"Em": { "n": [52, 62, 67, 71, 76], "s": [79, 83], "to": ["C", "G", "Am"] },
}
const NIGHT := {
	"C": { "n": [48, 55, 64], "to": ["Am", "F", "G"] },
	"Am": { "n": [45, 60, 64], "to": ["C", "F", "G"] },
	"F": { "n": [45, 53, 60], "to": ["C", "Am"] },
	"G": { "n": [43, 50, 62], "to": ["C", "Am"] },
}
const STORM := {
	"Am": { "n": [45, 57, 60, 64], "to": ["F", "Dm", "Em"] },
	"F": { "n": [53, 57, 60, 64], "to": ["Am", "Dm"] },
	"Dm": { "n": [45, 53, 57, 62], "to": ["Am", "F"] },
	"Em": { "n": [52, 64, 67, 71], "to": ["Am"] },
}
const CRISIS := { "sus": { "n": [45, 57, 62, 71, 76], "to": ["sus"] } }
const LAUNCH := {
	"C": { "n": [48, 55, 60, 64, 71], "s": [79, 76], "to": ["F"] },
	"F": { "n": [53, 60, 64, 69, 76], "s": [81, 88], "c": true, "to": ["G"] },
	"G": { "n": [55, 62, 71, 76, 79], "s": [83, 86], "to": ["C"] },
}
const BELLS := [74, 76, 79, 81, 86, 88]
const BELLS_C := [72, 84]
var MOODS := {
	"title": { "set": CALM, "first": "C", "every": [10, 13], "atk": 3.5, "rel": 4, "lead": 1.5, "stag": 0.35, "lv": 1.05, "shim": 2, "bell": [5, 8] },
	"work": { "set": CALM, "first": "C", "every": [10, 14], "atk": 3.5, "rel": 4, "lead": 1.5, "stag": 0.35, "lv": 1, "shim": 1, "bell": [5, 9] },
	"night": { "set": NIGHT, "first": "Am", "every": [14, 18], "atk": 4, "rel": 4, "lead": 1.5, "stag": 0.6, "lv": 1, "shim": 0 },
	"storm": { "set": STORM, "first": "Am", "every": [10, 13], "atk": 3.5, "rel": 4, "lead": 1.5, "stag": 0.35, "lv": 0.95, "shim": 0, "drone": true },
	"crisis": { "set": CRISIS, "first": "sus", "every": [5, 5], "atk": 2, "rel": 2.6, "lead": 1.3, "stag": 0, "lv": 0.95, "shim": 0, "lock": true },
	"launch": { "set": LAUNCH, "first": "C", "every": [7, 8], "atk": 3, "rel": 3.5, "lead": 1.5, "stag": 0.3, "lv": 1.05, "shim": 2, "bell": [3, 5] },
}
const PLAIN := { "st": 0, "cut": 2500.0, "shim": 1.0 }
const SITES := { "moon": { "st": 2, "cut": 2800.0, "shim": 1.3 }, "mars": { "st": -5, "cut": 2000.0, "shim": 0.6 } }

var on := true
var mood := "off"
var site: Dictionary = PLAIN
var _hushed := false
var _bus := -1
var _lp: AudioEffectLowPassFilter
var _bus_g := 0.0
var _bus_want := 0.0
var _clock := 0.0
var _seq = null
var _voices: Array = []
var _dying: Array = []
var _quiet_until := 0.0
var _tables := {}
var _unlocked := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_bus = AudioServer.get_bus_index("Gen")
	if _bus < 0:
		AudioServer.add_bus()
		_bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(_bus, "Gen")
		AudioServer.set_bus_send(_bus, "Master")
		_lp = AudioEffectLowPassFilter.new()
		_lp.cutoff_hz = site.cut
		_lp.resonance = 0.7
		AudioServer.add_bus_effect(_bus, _lp)
	else:
		_lp = AudioServer.get_bus_effect(_bus, 0)
	AudioServer.set_bus_volume_db(_bus, -80)
	# one looping table per wave and register: pitch_scale then stays between about 0.3 and 3
	for wave in ["sine", "triangle"]:
		for cycles in [4, 32]:
			_tables[wave + str(cycles)] = _table(wave, cycles)


func _table(wave: String, cycles: int) -> AudioStreamWAV:
	var n := 2048
	var buf := PackedFloat32Array()
	buf.resize(n)
	for i in n:
		var x := fmod(float(i) * cycles / n, 1.0)
		buf[i] = sin(TAU * x) if wave == "sine" else 4.0 * absf(x - 0.5) - 1.0
	var w := Synth.to_wav(buf, 44100)
	w.loop_mode = AudioStreamWAV.LOOP_FORWARD
	w.loop_begin = 0
	w.loop_end = n
	return w


func _hz(m: float) -> float:
	return 440.0 * pow(2.0, (m + site.st - 69) / 12.0)


static func _soft(f: float) -> float:
	return sqrt(440.0 / f) if f > 440 else 1.0


static func _between(a: float, b: float) -> float:
	return a + randf() * (b - a)


static func _cents(c: float) -> float:
	return pow(2.0, randf_range(-1, 1) * c / 1200.0)


func _live_at(t: float) -> int:
	var n := 0
	for v in _voices:
		if v.end > t:
			n += 1
	return n


## one note, with its loudness shape: { kind 'swell' (rise, hold, fall) or 'bell' (strike and ring out) }
func _voice(wave: String, f: float, t0: float, t_end: float, shape: Dictionary, layer: Dictionary, trem := false) -> Dictionary:
	var hi := f > 250.0
	var cyc := 32 if hi else 4
	var p := AudioStreamPlayer.new()
	p.stream = _tables[wave + str(cyc)]
	p.bus = "Gen"
	p.volume_db = -80
	p.pitch_scale = f / (44100.0 * cyc / 2048.0)
	add_child(p)
	var v := { "p": p, "t0": t0, "end": t_end, "shape": shape, "layer": layer, "trem": trem, "started": false }
	_voices.append(v)
	return v


func _gain(v: Dictionary, t: float) -> float:
	var s: Dictionary = v.shape
	var t0: float = v.t0
	if t < t0:
		return 0.0
	var peak: float = s.peak
	if s.kind == "bell":
		var dec: float = s.dec
		if t < t0 + 0.03:
			return peak * (t - t0) / 0.03
		if t < t0 + dec:
			return peak * pow(0.004, (t - t0 - 0.03) / (dec - 0.03))
		return maxf(0, peak * 0.004 * (1 - (t - t0 - dec) / 0.08))
	var atk_end: float = minf(t0 + s.atk, s.rel_at)
	if t < atk_end:
		return peak * (t - t0) / maxf(0.001, atk_end - t0)
	if t < s.rel_at:
		return peak
	return maxf(0, peak * (1 - (t - s.rel_at) / s.rel))


func _follow(set: Dictionary, last: String, prev) -> String:
	var to: Array = set[last].to
	var pick: Array = to.filter(func(x): return x != last and x != prev)
	if pick.is_empty():
		pick = to.filter(func(x): return x != last)
	if pick.is_empty():
		return last
	return pick[randi() % pick.size()]


func _chord(t0: float) -> bool:
	var cfg: Dictionary = _seq.cfg
	var name: String = cfg.first if _seq.last == null else _follow(cfg.set, _seq.last, _seq.prev)
	var c: Dictionary = cfg.set[name]
	var n: int = c.n.size()
	var every := _between(cfg.every[0], cfg.every[1])
	var t_rel: float = t0 + every - cfg.lead
	var atk: float = minf(cfg.atk, XFADE) if _seq.quick and _seq.last == null else float(cfg.atk)
	if _live_at(t0) + n > CAP:
		return false
	for i in n:
		var f := _hz(c.n[i])
		if cfg.get("lock", false):
			f = round(f * every) / every
		else:
			f *= _cents(4)
		var t: float = t0 + i * cfg.stag
		_voice("sine", f, t, t_rel + cfg.rel + 0.05, { "kind": "swell", "peak": GAINS[i] * cfg.lv * _soft(f), "atk": atk, "rel_at": t_rel, "rel": float(cfg.rel) }, _seq.layer)
	var s: Array = c.get("s", [])
	for i in mini(int(cfg.shim), s.size()):
		if _live_at(t0) + 1 > CAP:
			break
		var f2 := _hz(s[i]) * 1.0025 * _cents(2)
		var t2: float = t0 + (n + i) * cfg.stag
		_voice("triangle", f2, t2, t_rel + cfg.rel + 0.05, { "kind": "swell", "peak": SHIMMER * site.shim * cfg.lv * _soft(f2), "atk": atk, "rel_at": t_rel, "rel": float(cfg.rel) }, _seq.layer)
	if _seq.last == null:
		_seq.next_bell = t0 + _between(4, 7)
	_seq.prev = _seq.last
	_seq.last = name
	_seq.chord = c
	_seq.chord_at = t0
	_seq.next_chord = t0 + every
	return true


func _bell(t: float) -> void:
	var c: Dictionary = _seq.chord
	var list: Array = BELLS
	if c.get("c", false) and t > _seq.chord_at + 3 and t < _seq.next_chord - 1.5:
		list = BELLS + BELLS_C
	var pick := list.filter(func(x): return x != _seq.last_bell)
	_seq.last_bell = pick[randi() % pick.size()]
	if _live_at(t) + 1 > CAP:
		return
	var f := _hz(_seq.last_bell) * _cents(2)
	var dec := _between(2, 3)
	_voice("sine", f, t, t + dec + 0.1, { "kind": "bell", "peak": BELL * _soft(f), "dec": dec }, _seq.layer)


## the storm hum: a low A and the A above it, the loudness swaying slowly
func _drone(t0: float) -> bool:
	var length := 20.0
	var fade := 4.0
	if _live_at(t0) + 2 > CAP:
		return false
	var f := _hz(33)
	while f < 50:
		f *= 2
	for i in 2:
		_voice("sine", f * (i + 1), t0, t0 + length + fade + 0.05, { "kind": "swell", "peak": HUM * (1 - i * 0.4), "atk": fade, "rel_at": t0 + length, "rel": fade }, _seq.layer, true)
	_seq.next_drone = t0 + length
	return true


func _cut(v: Dictionary, at: float) -> void:
	if at < v.end:
		v.end = at


func _sweep(now: float) -> void:
	for i in range(_voices.size() - 1, -1, -1):
		var v: Dictionary = _voices[i]
		if v.end <= now:
			v.p.queue_free()
			_voices.remove_at(i)
	for i in range(_dying.size() - 1, -1, -1):
		if _dying[i].end <= now:
			_dying.remove_at(i)


func _run() -> void:
	var now := _clock
	_sweep(now)
	if _seq == null:
		return
	var cfg: Dictionary = _seq.cfg
	if _seq.next_chord <= now + AHEAD:
		if not _chord(maxf(_seq.next_chord, now + 0.05)):
			_seq.next_chord = now + 0.3
	if cfg.get("drone", false) and _seq.next_drone <= now + AHEAD:
		if not _drone(maxf(_seq.next_drone, now + 0.05)):
			_seq.next_drone = now + 0.3
	if cfg.has("bell") and _seq.chord != null and _seq.next_bell <= now + AHEAD:
		var t := maxf(_seq.next_bell, now + 0.05)
		_seq.next_bell = t + _between(cfg.bell[0], cfg.bell[1])
		_bell(t)


func _begin(delay: float, quick: bool) -> void:
	var t := maxf(_clock, _quiet_until) + (delay if delay > 0 else 0.05)
	_seq = { "mood": mood, "cfg": MOODS[mood], "layer": { "g": 1.0, "from": -1.0, "len": 1.0, "end": INF }, "quick": quick, "last": null, "prev": null,
		"chord": null, "chord_at": 0.0, "next_chord": t, "next_drone": t, "next_bell": INF, "last_bell": 0 }


func _retire(fade: float) -> void:
	var L: Dictionary = _seq.layer
	L.from = _clock
	L.len = fade
	L.end = _clock + fade + 0.1
	for v in _voices:
		if v.layer == L:
			_cut(v, L.end)
	_dying.append(L)
	_seq = null


func _silence(at: float) -> void:
	if _seq != null:
		_seq.layer.end = at
		_dying.append(_seq.layer)
		_seq = null
	for L in _dying:
		if L.end > at:
			L.end = at
	for v in _voices:
		_cut(v, at)
	_quiet_until = at


func _apply(restart := false, delay := 0.0) -> void:
	if not _unlocked:
		return
	var want := on and not _hushed
	var open := _bus_want > 0
	if want != open:
		_bus_want = MASTER if want else 0.0
		if not want:
			_silence(_clock + (0.3 if _hushed else 0.5))
	if _bus_want <= 0:
		return
	var quick := false
	if _seq != null and (restart or _seq.mood != mood):
		_retire(XFADE)
		quick = delay <= 0
	if _seq == null and mood != "off":
		_begin(delay, quick)
		_run()


## call from a tap or a key press; safe to call again and again
func unlock() -> bool:
	_unlocked = true
	_apply()
	return true


func set_on(v: bool) -> void:
	on = v
	_apply()


func is_on() -> bool:
	return on


## 'off', 'title', 'work', 'storm', 'crisis', 'night' or 'launch'; anything else counts as 'off'
func set_mood(name: String) -> void:
	name = name if MOODS.has(name) else "off"
	if name == mood and not _hushed:
		return
	mood = name
	_hushed = false
	_apply()


## 'moon' or 'mars'; anything else is the plain key of the title screen
func set_site(id: String) -> void:
	var s: Dictionary = SITES.get(id, PLAIN)
	if s == site:
		return
	var moved: bool = s.st != site.st
	site = s
	if moved and _seq != null:
		_apply(true, 2.2)


## quick fade to silence that keeps the mood; resume() or the next set_mood() undoes it
func hush() -> void:
	_hushed = true
	_apply()


func resume() -> void:
	if _hushed:
		_hushed = false
		_apply()


func _process(dt: float) -> void:
	_clock += minf(dt, 0.25)
	if _unlocked:
		_run()
	var tc := 0.25 if _bus_want > 0 else 0.06
	_bus_g += (_bus_want - _bus_g) * (1 - exp(-dt / tc))
	AudioServer.set_bus_volume_db(_bus, linear_to_db(maxf(0.00001, _bus_g)))
	_lp.cutoff_hz += (site.cut - _lp.cutoff_hz) * (1 - exp(-dt / 0.5))
	var trem := 1.0 + 0.3 * sin(TAU * 0.5 * _clock)
	for v in _voices:
		var g := _gain(v, _clock)
		var L: Dictionary = v.layer
		if L.from >= 0:
			g *= clampf(1 - (_clock - L.from) / L.len, 0, 1)
		if v.trem:
			g *= trem
		if _clock >= v.end:
			g = 0
		var p: AudioStreamPlayer = v.p
		if not v.started and _clock >= v.t0 - 0.02:
			v.started = true
			p.play()
		p.volume_db = linear_to_db(maxf(0.000001, g))


func voices_alive() -> int:
	return _voices.size()
