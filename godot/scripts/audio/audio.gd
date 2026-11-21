extends Node
## Astro Outpost — sound (autoload "Au"). A port of js/audio.js.
## - Recorded sound effects, loops and background beds (assets/audio/sfx, settings in data/sfx.json). A sound whose
##   recording is missing falls back to a synthesized version (rendered once into a buffer), so the game is never silent.
## - The place decides how the world sounds: on the airless Moon you only hear what travels through your suit (muffled);
##   thin Mars air dulls sounds a little; inside the habitat everything outside is far away.
## - Sounds that have a place get quieter with distance and move left and right (3D players, our own distance curve).
## - Voice lines: assets/audio/landing (the film) and assets/audio/voice (Mission Control). Everything dips while someone speaks.
## - Music: the recorded pieces (assets/audio/music) and the generated background music (MusicGen, a port of js/music.js).
## - Read-aloud for younger players uses the system's text-to-speech voice.

const SFX_DIR := "res://assets/audio/sfx/"
const VOX_DIR := "res://assets/audio/voice/"
const MUS_DIR := "res://assets/audio/music/"
const MIX := 22050

## lp: how much treble the place lets through; range: how far sounds carry (1 = normal)
const ENV := { "open": { "lp": 20000.0, "gain": 1.0, "range": 1.0 }, "moon": { "lp": 1250.0, "gain": 0.9, "range": 0.6 },
	"mars": { "lp": 3800.0, "gain": 0.95, "range": 0.85 }, "in": { "lp": 700.0, "gain": 0.3, "range": 1.0 } }
const BEDS := ["amb-suit", "amb-mars-wind", "amb-mars-dust", "amb-hab", "amb-storm"]

var META := {}
var VOICE := {}
var VOICE_MATCH: Array = []
var MUSIC := {}

var on := true
## crew mode (scripts/addons/crew.gd): relay.call("play" or "line", what, o) is true when the sound is for a crewmate's screen
var relay := Callable()
var reading := false
var mute_lines := false                  # the recorded lines belong to the Moon and Mars: off on the planets after them (Game.fun)
var log_list: Array = []                 # what was played lately ('tap', 'synth:tap', 'loop:rover', 'voice:rack-intro'): for tests
var gen: Node                            # the generated music

var _streams := {}
var _synth := {}
var _last_at := {}
var _last_pick := {}
var _loops := {}
var _env: Dictionary = ENV.open
var _ear := { "x": 0.0, "z": 0.0, "on": false }
var _scene_key := ""
var _scene_dirty := false
var _beds := {}
var _hushed := false
var _ducked := false
var _bus := {}
var _lp: AudioEffectLowPassFilter
var _now := 0.0

# voices
var _voice: AudioStreamPlayer
var _line_q: Array = []
var _line_on := false
var _line_keyed := false
var _line_timer := -1.0
var _line_at := 0.0
var _voice_then := Callable()
var _speak_timer := -1.0
var _speak_text := ""
var _tts_voice := ""

# recorded music
var _mus := { "name": null, "p": null, "vol": 0.0, "top": 0.0, "old": [] }

# breathing
var _breath_t := 2.5
var _effort := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	META = _json("res://data/sfx.json")
	var v := _json("res://data/voice.json")
	VOICE = v.get("voice", {})
	VOICE_MATCH = v.get("match", [])
	MUSIC = v.get("music", {})
	_buses()
	_voice = AudioStreamPlayer.new()
	_voice.bus = "Voice"
	_voice.volume_db = linear_to_db(0.9)
	_voice.finished.connect(_voice_done)
	add_child(_voice)
	gen = preload("res://scripts/audio/music_gen.gd").new()
	gen.name = "MusicGen"
	add_child(gen)
	var vs := DisplayServer.tts_get_voices_for_language("en") if _tts_ok() else PackedStringArray()
	if vs.size():
		_tts_voice = vs[0]


func _json(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var d = JSON.parse_string(f.get_as_text())
	return d if d is Dictionary else {}


## the mixer
##  UI ───────────────────────────────────────────────┐
##  FX ─────────────────────────────────┐             │
##  World → place filter ┐              ├→ Duck ──────┼→ Master → limiter
##  Amb ─────────────────┴→ Hush ───────┘             │
##  Synth, Voice, Music ──────────────────────────────┘
func _buses() -> void:
	var names := ["UI", "Duck", "Hush", "FX", "World", "Amb", "Synth", "Voice", "Music"]
	var send := { "UI": "Master", "Duck": "Master", "Hush": "Duck", "FX": "Duck", "World": "Hush", "Amb": "Hush", "Synth": "Master",
		"Voice": "Master", "Music": "Master" }
	for n in names:
		if AudioServer.get_bus_index(n) < 0:
			AudioServer.add_bus()
			AudioServer.set_bus_name(AudioServer.bus_count - 1, n)
	for n in names:
		AudioServer.set_bus_send(AudioServer.get_bus_index(n), send[n])
	var m := AudioServer.get_bus_index("Master")
	AudioServer.set_bus_volume_db(m, linear_to_db(0.55))
	if AudioServer.get_bus_effect_count(m) == 0:
		var lim := AudioEffectHardLimiter.new()
		lim.ceiling_db = -0.5
		lim.pre_gain_db = 0
		AudioServer.add_bus_effect(m, lim)
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("Synth"), linear_to_db(0.62))
	var w := AudioServer.get_bus_index("World")
	if AudioServer.get_bus_effect_count(w) == 0:
		_lp = AudioEffectLowPassFilter.new()
		_lp.cutoff_hz = 20000
		_lp.resonance = 0.5
		AudioServer.add_bus_effect(w, _lp)
	else:
		_lp = AudioServer.get_bus_effect(w, 0)
	for n in names:
		_bus[n] = { "i": AudioServer.get_bus_index(n), "want": 1.0, "cur": 1.0, "tc": 0.2 }
	_bus.Synth.want = 0.62
	_bus.Synth.cur = 0.62


func _note(s: String) -> void:
	log_list.append(s)
	if log_list.size() > 600:
		log_list.pop_front()


func _bus_for(m: Dictionary) -> String:
	return { "ui": "UI", "fx": "FX", "world": "World", "amb": "Amb" }.get(str(m.get("bus", "fx")), "FX")


# ---------- the recordings ----------
func _stream(key: String) -> AudioStream:
	if _streams.has(key):
		return _streams[key]
	var s: AudioStream = null
	for ext in [".ogg", ".mp3", ".wav"]:
		var p: String = SFX_DIR + key + ext
		if ResourceLoader.exists(p):
			s = load(p)
			break
	_streams[key] = s
	return s


# ---------- where you are, and where things are ----------
func ears(x: float, z: float, _camera = null) -> void:
	_ear.x = x
	_ear.z = z
	_ear.on = true


## how loud a sound at that spot is (left and right come from the 3D player)
func _place(at, range_m) -> float:
	if at == null or not _ear.on:
		return 1.0
	var v := _pos(at)
	var d := Vector2(v.x - _ear.x, v.z - _ear.z).length()
	var ref: float = (float(range_m) if range_m != null else 12.0) * _env.range
	var q := d / ref
	var g := 1.0 / (1.0 + q * q)
	if q > 5:
		g *= maxf(0, 1 - (q - 5) / 2)
	return g


func _player(stream: AudioStream, bus: String, at) -> Node:
	var p: Node
	if at != null:
		var p3 := AudioStreamPlayer3D.new()
		p3.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED
		p3.attenuation_filter_db = 0
		p3.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
		p3.panning_strength = 0.75
		p3.max_db = 6
		p = p3
	else:
		p = AudioStreamPlayer.new()
	p.stream = stream
	p.bus = bus
	add_child(p)
	if at != null:
		(p as Node3D).global_position = _pos(at)
	return p


static func _pos(at) -> Vector3:
	if at is Vector3:
		return at
	if at is Vector2:
		return Vector3(at.x, 1, at.y)
	if at is Dictionary:
		return Vector3(float(at.get("x", 0)), float(at.get("y", 1)), float(at.get("z", 0)))
	if at is Node3D:
		return at.global_position
	return Vector3.ZERO


# ---------- one-shot sounds ----------
## o: { at (a position), vol, rate, delay }
func _sample(name: String, m: Dictionary, o: Dictionary) -> bool:
	var n := int(m.get("n", 1))
	var key := name
	if n > 1:
		var k := randi() % n
		if k == _last_pick.get(name, -1):
			k = (k + 1) % n
		_last_pick[name] = k
		if k > 0:
			key = name + "-" + str(k + 1)
	var st := _stream(key)
	if st == null:
		st = _stream(name)
	if st == null:
		return false
	var gap := float(m.get("gap", 0))
	if gap > 0 and _last_at.has(name) and _now - _last_at[name] < gap:
		return true
	_last_at[name] = _now
	var at = o.get("at")
	var vol: float = float(m.get("vol", 0.5)) * float(o.get("vol", 1.0)) * _place(at, m.get("range"))
	_note(name)
	if vol < 0.004:
		return true
	var p := _player(st, _bus_for(m), at)
	p.volume_db = linear_to_db(vol)
	p.pitch_scale = maxf(0.05, float(o.get("rate", 1.0)) * (1 + randf_range(-1, 1) * float(m.get("pitch", 0))))
	p.finished.connect(p.queue_free)
	var delay := float(o.get("delay", 0))
	if delay > 0:
		get_tree().create_timer(delay, true, false, true).timeout.connect(func(): if is_instance_valid(p): p.play())
	else:
		p.play()
	return true


func play(name: String, o: Dictionary = {}) -> void:
	if relay.is_valid() and relay.call("play", name, o):
		return
	if not on:
		return
	var m = META.get(name)
	if m != null and _sample(name, m, o):
		return
	if Synth.RECIPES.has(name):
		_note("synth:" + name)
		_play_synth(name, float(o.get("delay", 0)))


func _play_synth(name: String, delay: float = 0.0) -> void:
	if not _synth.has(name):
		_synth[name] = Synth.render(name)
	var p := AudioStreamPlayer.new()
	p.stream = _synth[name]
	p.bus = "Synth"
	p.finished.connect(p.queue_free)
	add_child(p)
	if delay > 0:
		get_tree().create_timer(delay, true, false, true).timeout.connect(func(): if is_instance_valid(p): p.play())
	else:
		p.play()


# ---------- continuous sounds ----------
## p steers the sound while it runs: { rate, vol, at, fade, keep }
func loop(name: String, p: Dictionary = {}) -> void:
	if not on:
		stop_loop(name)
		return
	var L = _loops.get(name)
	var m: Dictionary = META.get(name, {})
	if L == null:
		var st := _stream(name)
		if st == null:
			if p.has("f"):
				_synth_loop(name, p)
			return
		st = st.duplicate()
		if "loop" in st:
			st.loop = true
		var pl := _player(st, _bus_for(m), p.get("at"))
		pl.volume_db = -80
		L = { "p": pl, "keep": p.get("keep", false), "g": 0.0, "want": 0.0, "tc": 0.08, "rate": 1.0, "stop": false }
		_loops[name] = L
		pl.play(randf() * maxf(0.0, st.get_length() - 0.1) if st.get_length() > 0 else 0.0)
		_note("loop:" + name)
	L.stop = false
	L.rate = float(p.get("rate", 1.0))
	L.want = maxf(0.0001, float(m.get("vol", 0.5)) * float(p.get("vol", 1.0)) * _place(p.get("at"), m.get("range")))
	L.tc = float(p.get("fade", 0.08))
	var at = p.get("at")
	if at != null and L.p is Node3D:
		(L.p as Node3D).global_position = _pos(at)


## a continuous sound with no recording: its synthesized stand-in, a plain tone steered by { f, v, type }
## (type: sine, square, triangle or sawtooth, as in the web version's oscillator)
func _synth_loop(name: String, p: Dictionary) -> void:
	var L = _loops.get(name)
	if L == null:
		var gen := AudioStreamGenerator.new()
		gen.mix_rate = 22050.0
		gen.buffer_length = 0.12
		var pl := AudioStreamPlayer.new()
		pl.stream = gen
		pl.bus = "Synth"
		pl.volume_db = -80
		add_child(pl)
		pl.play()
		L = { "p": pl, "keep": p.get("keep", false), "g": 0.0, "want": 0.0, "tc": 0.05, "rate": 1.0, "stop": false,
			"osc": pl.get_stream_playback(), "f": 100.0, "ff": -1.0, "ph": 0.0, "type": "sawtooth" }
		_loops[name] = L
		_note("synth-loop:" + name)
	L.stop = false
	L.f = float(p.get("f", 100.0))
	L.want = maxf(0.0001, float(p.get("v", 0.05)))
	L.tc = 0.05
	L.type = str(p.get("type", "sawtooth"))


func _osc_fill(L: Dictionary, dt: float) -> void:
	var pb: AudioStreamGeneratorPlayback = L.osc
	var n := pb.get_frames_available()
	if n <= 0:
		return
	L.ff = L.f if L.ff < 0 else L.ff + (L.f - L.ff) * (1 - exp(-dt / 0.05))
	var step: float = L.ff / 22050.0
	var ph: float = L.ph
	var kind: String = L.type
	var buf := PackedVector2Array()
	buf.resize(n)
	for i in n:
		ph = fmod(ph + step, 1.0)
		var v: float
		if kind == "sine":
			v = sin(TAU * ph)
		elif kind == "square":
			v = 1.0 if ph < 0.5 else -1.0
		elif kind == "triangle":
			v = 4.0 * absf(ph - 0.5) - 1.0
		else:
			v = 2.0 * ph - 1.0
		buf[i] = Vector2(v, v)
	L.ph = ph
	pb.push_buffer(buf)


func stop_loop(name: String, fade: float = 0.04) -> void:
	var L = _loops.get(name)
	if L == null:
		return
	L.stop = true
	L.want = 0.0
	L.tc = fade


## hums and beds belong to the place, not to one action: they survive stop_all() and are steered every frame
func hum(name: String, want: bool, at = null, vol: float = 1.0) -> void:
	if want:
		loop(name, { "at": at, "vol": vol, "keep": true, "fade": 0.25 })
	else:
		stop_loop(name, 0.25)


func loops_playing() -> Array:
	return _loops.keys().filter(func(n): return not _loops[n].stop)


# ---------- the scene: how the world is filtered, and which background beds play ----------
## o.place: 'out' on the surface, 'in' the habitat; anything else is clear and has no bed
## o.site: 'moon' or 'mars'; o.dust: 0 to 1; o.storm: 0 none, 1 warning, 2 raging
func scene(o: Dictionary) -> void:
	var dd := float(o.get("dust", 0))
	var dust := 2 if dd > 0.7 else (1 if dd > 0.2 else 0)
	var storm := int(o.get("storm", 0))
	var pl := str(o.get("place", ""))
	var site := str(o.get("site", ""))
	var key := "%s,%s,%d,%d" % [pl, site, dust, storm]
	if key == _scene_key:
		return
	_scene_key = key
	var out := pl == "out"
	var inn := pl == "in"
	var mars := site == "mars"
	_env = ENV.get(site, ENV.open) if out else (ENV["in"] if inn else ENV.open)
	_beds = {
		"amb-suit": (0.8 if mars else 1.0) if out else 0.0,
		"amb-mars-wind": [1.0, 0.7, 0.4][dust] if out and mars else 0.0,
		"amb-mars-dust": [0.0, 0.5, 1.0][dust] if out and mars else 0.0,
		"amb-hab": 1.0 if inn else 0.0,
		"amb-storm": ((1.0 if out else (0.4 if inn else 0.0)) if storm == 2 else ((0.35 if out else (0.15 if inn else 0.0)) if storm == 1 else 0.0)),
	}
	_scene_dirty = true


func scene_key() -> String:
	return _scene_key


func _apply_scene() -> void:
	if not on:
		return
	_scene_dirty = false
	_bus.World.want = _env.gain
	_bus.World.tc = 0.25
	for name in BEDS:
		if _beds.get(name, 0.0) > 0:
			loop(name, { "vol": _beds[name], "keep": true, "fade": 0.7 })
		else:
			stop_loop(name, 0.7)


## a pop-up card pauses the game: the world drops back, like holding your breath
func hush(v: bool) -> void:
	if v == _hushed:
		return
	_hushed = v
	_bus.Hush.want = 0.3 if v else 1.0
	_bus.Hush.tc = 0.2


# ---------- breathing inside the helmet: slow at rest, quicker after a run ----------
func breathe(dt: float, running: bool) -> void:
	_effort += ((1.0 if running else 0.0) - _effort) * minf(1, dt * (0.5 if running else 0.22))
	_breath_t -= dt * (1 + _effort * 1.6)
	if _breath_t <= 0:
		_breath_t = 4.2
		play("breath", { "vol": 0.55 + _effort * 0.9, "rate": 1 + _effort * 0.25 })


# ---------- voices ----------
func _radio_key(opening: bool) -> void:
	_play_synth("key-open" if opening else "key-close")


func _cut() -> void:
	_voice_then = Callable()
	if _voice.playing:
		_voice.stop()


func stop_voice() -> void:
	_line_timer = -1
	_line_q = []
	_line_on = false
	_line_keyed = false
	_cut()


func _start_clip(path: String, then: Callable = Callable()) -> bool:
	_cut()
	if not ResourceLoader.exists(path):
		if then.is_valid():
			then.call_deferred()
		return false
	_voice.stream = load(path)
	_voice_then = then
	_voice.play()
	return true


func _voice_done() -> void:
	var t := _voice_then
	_voice_then = Callable()
	if t.is_valid():
		t.call()


## the landing film: one clip, by its path (res://assets/audio/landing/....mp3)
func voice(path: String) -> void:
	stop_voice()
	_quiet()
	_note("voice:" + path)
	_start_clip(path)


func _line_next() -> void:
	_line_timer = -1
	if _line_q.is_empty():
		var keyed := _line_keyed
		_line_on = false
		_line_keyed = false
		if keyed:
			_radio_key(false)
		return
	var id: String = _line_q.pop_front()
	_line_at = _now
	_start_clip(VOX_DIR + id + ".mp3", _line_next)


## Mission Control: one line, or several in a row, by id (data/voice.json).
## Returns true when a recording will be heard. o.plain: no radio beeps around it.
func line(ids, o: Dictionary = {}) -> bool:
	if mute_lines:
		return false
	if relay.is_valid() and relay.call("line", ids, o):
		return false
	if ids is String:
		ids = [ids]
	if ids == null:
		return false
	var list: Array = []
	for id in ids:
		if id and VOICE.has(id):
			list.append(id)
	if list.is_empty() or not (on or reading):
		return false
	stop_voice()
	_quiet()
	_line_q = list.duplicate()
	_line_on = true
	_line_at = _now
	_note("voice:" + "+".join(list))
	if o.get("plain", false):
		_line_next()
		return true
	_line_keyed = true
	_radio_key(true)
	_line_timer = 0.38
	return true


func voice_playing() -> bool:
	return _line_on or _voice.playing


var _by_text := {}


static func _norm(t: String) -> String:
	var out := ""
	for c in t.to_lower():
		var u := c.unicode_at(0)
		out += c if (u >= 97 and u <= 122) or (u >= 48 and u <= 57) or c == " " else " "
	while out.find("  ") >= 0:
		out = out.replace("  ", " ")
	return out.strip_edges()


## Which recorded line says these words? The exact words first, then the patterns for bubbles whose words change.
func voice_for(text: String):
	if _by_text.is_empty():
		for id in VOICE:
			_by_text[_norm(str(VOICE[id].t))] = id
	var t := _norm(text)
	if _by_text.has(t):
		return _by_text[t]
	for m in VOICE_MATCH:
		if VOICE.has(m[1]) and t.begins_with(m[0]):
			return m[1]
	return null


# ---------- read-aloud ----------
func _tts_ok() -> bool:
	return ProjectSettings.get_setting("audio/general/text_to_speech", false) and DisplayServer.has_feature(DisplayServer.FEATURE_TEXT_TO_SPEECH)


func can_read() -> bool:
	return _tts_ok() and _tts_voice != ""


func set_reading(v: bool) -> void:
	reading = v
	if not v:
		_quiet()


func reading_on() -> bool:
	return reading


static func _strip_emoji(t: String) -> String:
	var out := ""
	for c in t:
		var u := c.unicode_at(0)
		if (u >= 0x1F000 and u <= 0x1FFFF) or (u >= 0x2600 and u <= 0x27BF) or u == 0xFE0F or u == 0x200D:
			continue
		out += c
	return out


func speak(text: String) -> void:
	if not reading or not can_read():
		return
	_speak_text = Html.plain(_strip_emoji(str(text)))
	if DisplayServer.tts_is_speaking():
		DisplayServer.tts_stop()
	_speak_timer = 0.07


func _quiet() -> void:
	_speak_timer = -1
	if _tts_ok():
		DisplayServer.tts_stop()


# ---------- recorded music ----------
## Fade to a piece of music (by id, see data/voice.json), or to silence with music(null). Returns true when it exists.
func music(name) -> bool:
	if name != null and not MUSIC.has(name):
		name = null
	if name == _mus.name:
		return name != null
	if _mus.p:
		_mus.old.append({ "p": _mus.p, "vol": _mus.vol })
	_mus.name = name
	_mus.p = null
	_mus.vol = 0.0
	if name != null:
		var path: String = MUS_DIR + name + ".mp3"
		if not ResourceLoader.exists(path):
			_mus.name = null
			return false
		var st: AudioStreamMP3 = load(path).duplicate()
		st.loop = MUSIC[name].get("loop", false)
		var p := AudioStreamPlayer.new()
		p.stream = st
		p.bus = "Music"
		p.volume_db = -80
		add_child(p)
		p.finished.connect(func():
			if _mus.p == p:
				_mus.p = null
				_mus.name = null
			p.queue_free())
		_mus.p = p
		_mus.top = float(MUSIC[name].get("v", 0.5))
		_note("music:" + name)
		if on:
			p.play()
	return name != null


func music_on() -> bool:
	return _mus.name != null


func _music_frame(dt: float, talking: bool) -> void:
	if _mus.p:
		var want: float = _mus.top * (0.45 if talking else 1.0) if on else 0.0
		_mus.vol += clampf(want - _mus.vol, -dt * 0.6, dt * 0.45)
		(_mus.p as AudioStreamPlayer).volume_db = linear_to_db(clampf(_mus.vol, 0, 1)) if _mus.vol > 0.0005 else -80.0
	for i in range(_mus.old.size() - 1, -1, -1):
		var o: Dictionary = _mus.old[i]
		o.vol -= dt * 0.5
		if o.vol <= 0:
			if is_instance_valid(o.p):
				o.p.queue_free()
			_mus.old.remove_at(i)
		elif is_instance_valid(o.p):
			o.p.volume_db = linear_to_db(clampf(o.vol, 0, 1))


# ---------- switches ----------
func stop_all() -> void:
	for n in _loops.keys():
		if not _loops[n].keep:
			stop_loop(n)
	stop_voice()


func unlock() -> bool:
	gen.unlock()
	return true


func set_sound(v: bool) -> void:
	on = v
	if not v:
		for n in _loops.keys():
			stop_loop(n)
		if not reading:
			stop_voice()
		if _mus.p:
			_mus.p.stream_paused = true
	else:
		_scene_dirty = true
		if _mus.p:
			_mus.p.stream_paused = false
			if not _mus.p.playing:
				_mus.p.play()
	gen.set_on(v)


func sound_on() -> bool:
	return on


# ---------- once a frame (runs by itself) ----------
func _process(dt: float) -> void:
	_now += dt
	var talking := voice_playing()
	if _line_on and _now - _line_at > 25:
		stop_voice()                     # a clip that never started must not hold the others up
	if _line_timer >= 0:
		_line_timer -= dt
		if _line_timer < 0:
			_line_next()
	if _speak_timer >= 0:
		_speak_timer -= dt
		if _speak_timer < 0 and reading and can_read():
			DisplayServer.tts_speak(_speak_text, _tts_voice, 80, 1.15, 0.95)
	if on:
		if _scene_dirty:
			_apply_scene()
		if talking != _ducked:
			_ducked = talking
			_bus.Duck.want = 0.5 if talking else 1.0
			_bus.Duck.tc = 0.08 if talking else 0.4
	# the place filter and the faders glide like the web version's setTargetAtTime
	_lp.cutoff_hz += (_env.lp - _lp.cutoff_hz) * (1 - exp(-dt / 0.25))
	for n in _bus:
		var b: Dictionary = _bus[n]
		if absf(b.cur - b.want) > 0.0005:
			b.cur += (b.want - b.cur) * (1 - exp(-dt / maxf(0.01, b.tc)))
			AudioServer.set_bus_volume_db(b.i, linear_to_db(maxf(0.0001, b.cur)))
	for n in _loops.keys():
		var L: Dictionary = _loops[n]
		L.g += (L.want - L.g) * (1 - exp(-dt / maxf(0.01, L.tc)))
		var p = L.p
		if not is_instance_valid(p):
			_loops.erase(n)
			continue
		p.volume_db = linear_to_db(maxf(0.00001, L.g))
		if L.has("osc"):
			_osc_fill(L, dt)
		else:
			p.pitch_scale += (L.rate - p.pitch_scale) * (1 - exp(-dt / 0.08))
		if L.stop and L.g < 0.0008:
			p.queue_free()
			_loops.erase(n)
	_music_frame(dt, talking)


## the old name, kept so code ported from the web version reads the same
func frame(_dt: float) -> void:
	pass
