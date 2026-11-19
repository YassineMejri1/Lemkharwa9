class_name Synth
## The synthesized sounds of js/audio.js: stand-ins for any recording that is missing, and the few sounds that are
## meant to be pure tones (the radio key beeps, the radiation counter's click). Each recipe is rendered once into a
## buffer: tones with a quick exponential rise and fall (and an optional slide), and bursts of band-passed noise.

const RATE := 22050
## ["t", freq, dur, wave, vol, delay, slide]   ["n", dur, vol, delay, band freq]   ["=", other recipe]
const RECIPES := {
	"tap": [["t", 520, 0.07, "triangle", 0.14]],
	"grab": [["t", 330, 0.07, "triangle", 0.16], ["t", 495, 0.09, "triangle", 0.16, 0.05]],
	"drop": [["t", 300, 0.08, "triangle", 0.12, 0, 200]],
	"deny": [["t", 160, 0.16, "sawtooth", 0.12]],
	"jump": [["t", 300, 0.2, "sine", 0.14, 0, 620]],
	"land": [["n", 0.12, 0.18, 0, 300]],
	"thud": [["n", 0.1, 0.22, 0, 220], ["t", 90, 0.12, "sine", 0.2, 0, 50]],
	"step": [["n", 0.05, 0.05, 0, 500]],
	"throw": [["n", 0.22, 0.14, 0, 900], ["t", 420, 0.2, "sine", 0.08, 0, 760]],
	"plug": [["t", 220, 0.08, "square", 0.12], ["t", 440, 0.1, "square", 0.12, 0.07], ["t", 880, 0.22, "triangle", 0.16, 0.14]],
	"score": [["t", 880, 0.09, "triangle", 0.2], ["t", 1320, 0.16, "triangle", 0.2, 0.07]],
	"swish": [["t", 660, 0.14, "triangle", 0.2, 0], ["t", 880, 0.14, "triangle", 0.2, 0.06], ["t", 1100, 0.14, "triangle", 0.2, 0.12],
		["t", 1320, 0.14, "triangle", 0.2, 0.18], ["t", 1760, 0.14, "triangle", 0.2, 0.24]],
	"ice": [["t", 1400, 0.1, "sine", 0.18], ["t", 2100, 0.2, "sine", 0.14, 0.06]],
	"ding": [["t", 1046, 0.25, "sine", 0.18]],
	"air": [["n", 0.5, 0.12, 0, 2400], ["t", 600, 0.4, "sine", 0.1, 0, 900]],
	"pop": [["t", 500, 0.08, "sine", 0.16, 0, 900]],
	"warn": [["t", 740, 0.16, "square", 0.14], ["t", 560, 0.16, "square", 0.14, 0.18]],
	"click": [["n", 0.03, 0.3, 0, 3200]],
	"spark": [["n", 0.08, 0.2, 0, 4200], ["t", 1800, 0.05, "square", 0.06]],
	"door": [["t", 220, 0.25, "sine", 0.2, 0, 110], ["n", 0.25, 0.1, 0.05, 500]],
	"page": [["t", 660, 0.08, "sine", 0.12], ["t", 880, 0.12, "sine", 0.12, 0.07]],
	"good": [["t", 523, 0.14, "triangle", 0.18, 0], ["t", 659, 0.14, "triangle", 0.18, 0.09], ["t", 784, 0.14, "triangle", 0.18, 0.18]],
	"hit": [["t", 784, 0.1, "triangle", 0.2], ["t", 1175, 0.16, "triangle", 0.2, 0.08]],
	"bad": [["t", 330, 0.22, "sawtooth", 0.1], ["t", 247, 0.34, "sawtooth", 0.1, 0.18]],
	"photo": [["n", 0.05, 0.3, 0, 5000], ["n", 0.08, 0.2, 0.09, 2500]],
	"discovery": [["t", 523, 0.22, "triangle", 0.2, 0], ["t", 659, 0.22, "triangle", 0.2, 0.1], ["t", 784, 0.22, "triangle", 0.2, 0.2],
		["t", 1047, 0.22, "triangle", 0.2, 0.3], ["t", 1319, 0.22, "triangle", 0.2, 0.4]],
	"win": [["t", 523, 0.2, "triangle", 0.2, 0], ["t", 659, 0.2, "triangle", 0.2, 0.12], ["t", 784, 0.2, "triangle", 0.2, 0.24],
		["t", 1047, 0.2, "triangle", 0.2, 0.36], ["t", 784, 0.2, "triangle", 0.2, 0.48], ["t", 1047, 0.2, "triangle", 0.2, 0.6],
		["t", 1319, 0.2, "triangle", 0.2, 0.72]],
	"launch": [["t", 60, 6, "sawtooth", 0.22, 0, 240], ["n", 6, 0.3, 0, 400]],
	"beep": [["t", 880, 0.12, "square", 0.12]],
	"alarm": [["t", 880, 0.2, "square", 0.16, 0], ["t", 660, 0.1, "square", 0.12, 0.14], ["t", 880, 0.2, "square", 0.16, 0.3],
		["t", 660, 0.1, "square", 0.12, 0.44], ["t", 880, 0.2, "square", 0.16, 0.6], ["t", 660, 0.1, "square", 0.12, 0.74]],
	"core": [["=", "hit"]],
	"jam": [["n", 0.3, 0.2, 0, 700], ["t", 140, 0.25, "sawtooth", 0.12, 0, 70]],
	"bag": [["=", "pop"]],
	"brush": [["=", "pop"]],
	"harvest": [["=", "grab"]],
	"rover-start": [["=", "grab"]],
	"lose": [["=", "bad"]],
	"low": [["t", 520, 0.12, "sine", 0.1], ["t", 390, 0.2, "sine", 0.1, 0.14]],
	"daystart": [["=", "good"]],
	"night": [["=", "good"]],
	"storm-alert": [["=", "warn"]],
	"breath": [["n", 1.5, 0.045, 0, 420]],
	"hiss": [["n", 1.6, 0.16, 0, 3200], ["t", 140, 0.5, "sine", 0.16, 0.2, 70]],
	"rumble": [["n", 0.5, 0.2, 0, 170]],
	"touchdown": [["n", 0.6, 0.4, 0, 150], ["t", 70, 0.5, "sine", 0.3, 0, 36], ["n", 1.8, 0.1, 0.2, 900]],
	"radio": [["t", 2525, 0.16, "sine", 0.05], ["n", 0.12, 0.05, 0.16, 2600]],
	# Every message from Earth opens and closes with the two beeps real NASA radio used (Quindar tones)
	"key-open": [["t", 2525, 0.25, "sine", 0.05], ["n", 0.16, 0.05, 0.22, 2600]],
	"key-close": [["t", 2475, 0.25, "sine", 0.05], ["n", 0.12, 0.05, 0.18, 2600]],
	"pad": [["t", 130.8, 9, "sine", 0.06, 0], ["t", 261.6, 9, "sine", 0.018, 0.3], ["t", 196, 9, "sine", 0.06, 0.7], ["t", 392.98, 9, "sine", 0.018, 1.0],
		["t", 261.6, 9, "sine", 0.06, 1.4], ["t", 524.5, 9, "sine", 0.018, 1.7], ["t", 329.6, 9, "sine", 0.06, 2.1], ["t", 660.8, 9, "sine", 0.018, 2.4],
		["t", 493.9, 9, "sine", 0.06, 2.8], ["t", 990.3, 9, "sine", 0.018, 3.1]],
}


static func _ops(name: String) -> Array:
	var out: Array = []
	for op in RECIPES.get(name, []):
		if op[0] == "=":
			out.append_array(_ops(op[1]))
		else:
			out.append(op)
	return out


static func render(name: String) -> AudioStreamWAV:
	var ops := _ops(name)
	var total := 0.05
	for op in ops:
		if op[0] == "t":
			total = maxf(total, float(op[2]) + (float(op[5]) if op.size() > 5 else 0.0) + 0.03)
		else:
			total = maxf(total, float(op[1]) + (float(op[3]) if op.size() > 3 else 0.0))
	var n := int(total * RATE) + 1
	var buf := PackedFloat32Array()
	buf.resize(n)
	for op in ops:
		if op[0] == "t":
			_tone(buf, float(op[1]), float(op[2]), str(op[3]), float(op[4]), float(op[5]) if op.size() > 5 else 0.0, float(op[6]) if op.size() > 6 else 0.0)
		else:
			_noise(buf, float(op[1]), float(op[2]), float(op[3]) if op.size() > 3 else 0.0, float(op[4]) if op.size() > 4 else 1800.0)
	return to_wav(buf, RATE)


static func to_wav(buf: PackedFloat32Array, rate: int) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(buf.size() * 2)
	for i in buf.size():
		bytes.encode_s16(i * 2, int(clampf(buf[i], -1, 1) * 32767))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.stereo = false
	w.data = bytes
	return w


static func _wave(type: String, ph: float) -> float:
	var x := ph - floorf(ph)
	match type:
		"square":
			return 1.0 if x < 0.5 else -1.0
		"sawtooth":
			return 2.0 * x - 1.0
		"triangle":
			return 4.0 * absf(x - 0.5) - 1.0
	return sin(TAU * x)


## a tone: rises exponentially from silence to vol in 12 ms, falls exponentially to silence at dur; slide: the frequency it glides to
static func _tone(buf: PackedFloat32Array, freq: float, dur: float, type: String, vol: float, delay: float, slide: float) -> void:
	var i0 := int(delay * RATE)
	var n := int((dur + 0.03) * RATE)
	var ph := 0.0
	var atk := 0.012
	for k in n:
		var i := i0 + k
		if i >= buf.size():
			break
		var t := float(k) / RATE
		var f := freq
		if slide > 0:
			f = freq * pow(slide / freq, minf(1, t / dur))
		ph += f / RATE
		var g: float
		if t < atk:
			g = 0.0001 * pow(vol / 0.0001, t / atk)
		elif t < dur:
			g = vol * pow(0.0001 / vol, (t - atk) / (dur - atk))
		else:
			g = 0.0
		buf[i] += _wave(type, ph) * g


## noise that fades out over dur, through a band-pass filter (Q 1, as the Web Audio default)
static func _noise(buf: PackedFloat32Array, dur: float, vol: float, delay: float, freq: float) -> void:
	var i0 := int(delay * RATE)
	var n := int(dur * RATE)
	var w0 := TAU * minf(freq, RATE * 0.45) / RATE
	var alpha := sin(w0) / 2.0
	var a0 := 1 + alpha
	var b0 := alpha / a0
	var b2 := -alpha / a0
	var a1 := -2 * cos(w0) / a0
	var a2 := (1 - alpha) / a0
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for k in n:
		var i := i0 + k
		if i >= buf.size():
			break
		var x := randf_range(-1, 1) * (1 - float(k) / n)
		var y := b0 * x + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = x
		y2 = y1
		y1 = y
		buf[i] += y * vol
