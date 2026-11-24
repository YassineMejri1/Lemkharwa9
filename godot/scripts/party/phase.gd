extends RefCounted
## Phase Chase (the Moon, intermediate, memory). Eight pads lie in a ring, one for each phase of the Moon, in the
## order of its month (clockwise from the New Moon). A hologram shows a few phases one after the other; then
## everybody runs onto those pads in the same order. Each round the order is one phase longer.
## The phases are drawn by a shader the way the Moon really shows them: the edge of the sunlight is half an ellipse.

const NAMES := ["New Moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full Moon", "Waning gibbous", "Last quarter", "Waning crescent"]
const RING := 9.0               # metres from the middle to each pad
const PAD := 1.7                # a pad's radius
const SHOW := 0.9               # seconds for each phase of the order
const BONUS := 30.0             # a finished order earns 10 points for every second left of this
const SHADER := """
shader_type spatial;
render_mode unshaded;
uniform float phase = 0.0;      // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
uniform float gain = 1.0;
void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) {
		discard;
	}
	float limb = sqrt(1.0 - p.y * p.y);         // half the disc's width at this height
	float edge = cos(phase * TAU) * limb;       // where the edge of the sunlight crosses it
	float sun = phase < 0.5 ? smoothstep(edge - 0.03, edge + 0.03, p.x) : 1.0 - smoothstep(-edge - 0.03, -edge + 0.03, p.x);
	sun *= step(0.02, phase);
	// three dark seas
	float seas = 1.0 - 0.22 * (3.0 - smoothstep(0.12, 0.38, length(p - vec2(-0.3, -0.32))) - smoothstep(0.1, 0.3, length(p - vec2(0.3, -0.05))) - smoothstep(0.08, 0.26, length(p - vec2(-0.1, 0.4))));
	vec3 col = mix(vec3(0.04, 0.045, 0.07), vec3(1.0, 0.97, 0.88) * seas * gain, sun);
	ALBEDO = mix(col, vec3(0.45, 0.52, 0.7), smoothstep(0.92, 0.97, r) * 0.7);
}
"""

var P
var pads: Array = []            # { x, z, m (its ring of light), flash, hex }
var holo: ShaderMaterial
var screen: MeshInstance3D        # the hologram: there only while it shows a phase, so a New Moon is not "off"
var seq: Array = []             # this round's order: indexes into NAMES
var _step := 0                  # how many of them you have reached
var _miss := 0
var _base := 0                  # your points from the rounds before
var _on := -1                   # the pad you stand on
var _stun := 0.0
var _said := -1
var _fin := false


## `n` phases, never the same one twice in a row
static func order(r: Rng32, n: int) -> Array:
	var out: Array = []
	for i in n:
		var p := int(r.next() * 8) % 8
		if out.size() and p == out[-1]:
			p = (p + 1 + int(r.next() * 6)) % 8
		out.append(p)
	return out


## a round's points: 100 for each pad reached, 25 off for each wrong one, and the seconds left when you finish
static func points(steps: int, miss: int, done: bool, took: float) -> int:
	return maxi(0, steps * 100 - miss * 25) + (roundi(maxf(0.0, BONUS - took) * 10) if done else 0)


func _disc(mesh: PrimitiveMesh, x: float, y: float, z: float, phase: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = holo.shader
	m.set_shader_parameter("phase", phase)
	Mats.add(P.root, mesh, m, x, y, z, false)
	return m


func start() -> void:
	P.cam(Vector3(0, 21, 24), Vector3(0, 0, -1))
	P.fence(13.0)
	holo = ShaderMaterial.new()
	holo.shader = Shader.new()
	holo.shader.code = SHADER
	holo.set_shader_parameter("gain", 1.6)
	var q := QuadMesh.new()
	q.size = Vector2(6.0, 6.0)
	screen = Mats.add(P.root, q, holo, 0, 3.6, -1.0, false)       # over the middle of the ring
	screen.rotation.x = -0.7                      # leaning back, to face the camera
	for i in 8:
		var ang := i / 8.0 * TAU                # the New Moon at the far side, then clockwise
		var x := sin(ang) * RING
		var z := -cos(ang) * RING
		Mats.add(P.root, Mats.cyl(PAD, PAD + 0.15, 0.12, 24), Mats.mat(0x2a2d3a), x, 0.06, z)
		var m := Mats.glow(0xffe9a8, 0.25)
		Mats.add(P.root, Mats.torus(PAD, 0.09, 32, 6), m, x, 0.14, z, false)
		var top := PlaneMesh.new()
		top.size = Vector2(PAD * 1.75, PAD * 1.75)
		_disc(top, x, 0.13, z, i / 8.0)
		pads.append({ "x": x, "z": z, "m": m, "flash": 0.0, "hex": 0xffe9a8 })


func round() -> void:
	seq = order(P.rng(), 3 + P.k)
	_step = 0
	_miss = 0
	_base = int(P.mine.get("v", 0.0))
	_on = -1
	_stun = 0.0
	_said = -1
	_fin = false
	P.stand(P.lane(P.me(), 1.6), 0, PI)


func _tell() -> void:
	var pts := _base + points(_step, _miss, _fin, P.t - seq.size() * SHOW)
	var r := { "v": float(pts), "txt": str(pts) + " pts", "step": _step, "last": "%d of %d" % [_step, seq.size()] }
	if _fin:
		r.d = P.k + 1
	P.report(r)


func frame(dt: float) -> void:
	var t: float = P.t
	var i := int(t / SHOW) if t >= 0 else -1
	var showing: bool = P.on and i < seq.size() and fmod(t, SHOW) < SHOW - 0.2
	screen.visible = showing
	if showing:
		holo.set_shader_parameter("phase", seq[i] / 8.0)
		if i != _said:
			_said = i
			Au.play("ding", { "rate": 0.7 + seq[i] * 0.09 })
		P.hud("%d.  %s" % [i + 1, NAMES[seq[i]]], "#ffd23f")
	elif P.on and not _fin and i >= seq.size():
		P.hud("Your turn:  %d of %d" % [_step, seq.size()])
	else:
		P.hud("")
	for j in 8:
		var pad: Dictionary = pads[j]
		pad.flash = maxf(0.0, pad.flash - dt)
		var lit: bool = showing and seq[i] == j
		Mats.set_color(pad.m, pad.hex if pad.flash > 0 else 0xffe9a8)
		Mats.energy(pad.m, 3.0 if lit or pad.flash > 0 else 0.25)
	_stun = maxf(0.0, _stun - dt)
	P.walk = P.on and _stun <= 0
	if not P.on or _fin or i < seq.size():
		return
	var a = Actors.astro
	var here := -1
	for j in 8:
		if a.on_ground and Vector2(a.pos.x - P.C.x - pads[j].x, a.pos.z - P.C.z - pads[j].z).length() < PAD:
			here = j
	if here == _on:
		return
	_on = here
	if here < 0:
		return
	var right: bool = here == seq[_step]
	pads[here].flash = 0.5
	pads[here].hex = 0x4dff9a if right else 0xff5468
	if right:
		_step += 1
		_fin = _step == seq.size()
		Au.play("good" if _fin else "ding", { "rate": 1.0 if _fin else 0.7 + here * 0.09 })
		if _fin:
			P.big("✓ All %d!" % _step, "#7be36a")
	else:
		_miss += 1
		_stun = 1.0
		a.spin = 0.6                            # a dizzy turn on the spot
		a.vel = Vector3.ZERO
		Au.play("deny")
		Game.toast_at(a.pos + Vector3(0, 2.4, 0), "✗ " + NAMES[here], "#ff5468")
	_tell()
