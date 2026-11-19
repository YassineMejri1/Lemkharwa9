extends Node
## The camera look. The world is finished like real space footage before it reaches the screen:
##   - light glow on anything bright (the Sun, lamps, rocket fire), and a wide lens streak on the brightest
##   - a sun flare with ghost rings that hides when a mountain covers the Sun
##   - a colour grade per world: the Moon like Apollo slide film, Mars like a rover camera
##   - film grain, soft corners and a little colour fringing
## and it reacts to the game: an aurora and streaks of light in a radiation storm, sheets of haze in Mars dust,
## a narrowing, fading view when the air runs low, frost on the visor in the cold and dark, and the cross marks of
## an Apollo camera on a postcard photo.
## Key X steps between Full, Lite and Off (and it steps down by itself if the frame rate drops). Key L picks a
## space-camera filter on top: Apollo film, rover eye, false colour or heat view.
## Godot adjustments: the glow itself is the Environment's own glow (Lite uses fewer, smaller levels; Off turns it
## off); everything else is one full-screen shader on a CanvasLayer under the HUD that reads the finished picture.
## A port of js/fx.js.

const LEVELS := ["Off", "Lite", "Full"]
const FILTERS := [
	{ "id": "natural", "icon": "🎥", "name": "Natural", "note": "Camera filter off: natural colours." },
	{ "id": "apollo", "icon": "🎞️", "name": "Apollo film", "note": "Apollo film! The astronauts' Moon cameras printed little crosses on every photo, so scientists could measure things in them." },
	{ "id": "rover", "icon": "🤖", "name": "Rover eye", "note": "Rover eye! The hazard cameras on the Curiosity rover see in black and white through a fisheye lens, to spot rocks near the wheels." },
	{ "id": "false", "icon": "🌈", "name": "False colour", "note": "False colour! Scientists stretch the colours in space photos so that different rocks and soils stand out." },
	{ "id": "heat", "icon": "🌡️", "name": "Heat view", "note": "Heat view (pretend)! Sunlit ground is hot and shadows are freezing. Real orbiters use heat cameras to map this." },
]

const SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform vec2 uRes = vec2(1280.0, 720.0);
uniform float uTime; uniform float uMotion = 1.0; uniform float uFull = 1.0;
uniform vec2 uSun; uniform float uSunVis; uniform float uOccLo = 0.6; uniform float uSite = 1.0;
uniform float uStreakAmt; uniform vec3 uStreakTint = vec3(0.55, 0.75, 1.0);
uniform float uStorm; uniform float uWarn; uniform float uDust; uniform float uAir; uniform float uCold;
uniform float uKick; uniform float uCine; uniform float uTitle; uniform float uInside; uniform float uSnap;
uniform float uFlash; uniform float uShock; uniform float uGlitch; uniform float uGlow; uniform float uFilter;

// the picture, with y up like the original (so every position below reads the same as in fx.js)
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 srgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
vec3 scr(vec2 u) { return lin(textureLod(screen_tex, vec2(u.x, 1.0 - u.y), 0.0).rgb); }
vec3 scrb(vec2 u, float lod) { return lin(textureLod(screen_tex, vec2(u.x, 1.0 - u.y), lod).rgb); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float inv(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
float seg(vec2 p, vec2 a, vec2 b, float w) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return inv(0.0, w, length(pa - ba * h)); }
float disc(vec2 p, vec2 c, float r, float soft) { return inv(r * (1.0 - soft), r, length(p - c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float crosses(vec2 uv, float aspect) { vec2 cell = abs(fract(vec2(uv.x * aspect, uv.y) * 4.0 + 0.5) - 0.5) / 4.0; return step(min(cell.x, cell.y), 0.0013) * step(max(cell.x, cell.y), 0.017); }
vec3 heat(float t) { vec3 a = vec3(0.02, 0.0, 0.14); vec3 b = vec3(0.46, 0.02, 0.6); vec3 c = vec3(0.95, 0.26, 0.2); vec3 e = vec3(1.0, 0.76, 0.12); vec3 f = vec3(1.0, 1.0, 0.92);
	return t < 0.25 ? mix(a, b, t / 0.25) : (t < 0.5 ? mix(b, c, (t - 0.25) / 0.25) : (t < 0.75 ? mix(c, e, (t - 0.5) / 0.25) : mix(e, f, (t - 0.75) / 0.25))); }
vec3 shoulder(vec3 x) { vec3 t = max(x - 0.82, 0.0); return min(x, vec3(0.82)) + 0.18 * (1.0 - exp(-t / 0.18)); }

void fragment() {
	vec2 vUv = vec2(SCREEN_UV.x, 1.0 - SCREEN_UV.y);
	float asp = uRes.x / uRes.y;
	vec2 uv = vUv;
	float tq = floor(uTime * 18.0);
	// film gate weave during the films
	uv += uCine * uMotion * (vec2(noise(vec2(uTime * 7.0, 1.3)), noise(vec2(2.1, uTime * 6.0))) - 0.5) * 0.0018;
	// storm interference: thin bands of the picture slip sideways
	float tear = step(0.992 - uStorm * 0.03, noise(vec2(uv.y * 38.0, tq)));
	uv.x += tear * uStorm * uMotion * (hash(vec2(tq, floor(uv.y * 90.0))) - 0.5) * 0.02;
	if (uGlitch > 0.001) { float band = floor(uv.y * 34.0 + uTime * 9.0); float rg = hash(vec2(band, floor(uTime * 22.0))); if (rg > 0.78) uv.x += (rg - 0.89) * 0.5 * uGlitch * uMotion; }
	vec2 cc = uv - 0.5, ca = vec2(cc.x * asp, cc.y);
	float r2 = dot(cc, cc), rr = length(ca);
	// colour fringing, stronger toward the corners and when something hits hard
	float ab = (0.5 + 3.0 * uKick + 4.0 * uShock + 1.6 * uStorm + 0.8 * uCine) * r2 * 0.018;
	vec3 c = vec3(scr(uv + cc * ab).r, scr(uv).g, scr(uv - cc * ab).b);
	if (uShock > 0.001) { vec3 acc = c; for (int i = 1; i < 6; i++) acc += scr(uv - cc * uShock * 0.035 * float(i)); c = acc / 6.0; }
	// a warm swell of glow (the steady glow is the Environment's own)
	if (uGlow > 0.001) c += scrb(uv, 4.0) * uGlow * 0.8;
	// a long sideways smear of the brightest light: the "anamorphic" streak of film lenses
	if (uFull > 0.5 && uStreakAmt > 0.001) {
		vec3 s = vec3(0.0); float wsum = 0.0;
		for (int i = -8; i <= 8; i++) {
			float fi = float(i), w = exp(-abs(fi) * 0.28);
			vec3 t = scrb(uv + vec2(fi * 0.022, 0.0), 3.0);
			s += t * smoothstep(0.9, 1.0, max(t.r, max(t.g, t.b))) * w; wsum += w;     // only what is near white even when blurred: lamps, the Sun, fire
		}
		c += s / wsum * uStreakTint * uStreakAmt * 0.9;
	}
	// sun flare: is the Sun really visible? read the picture right where it should be
	if (uSunVis > 0.001) {
		vec2 sp = uSun; float lum = 0.0;
		if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0) {
			vec2 o = vec2(0.006 / asp, 0.006);
			vec3 s = scr(sp) + scr(sp + o) + scr(sp - o) + scr(sp + vec2(o.x, -o.y)) + scr(sp + vec2(-o.x, o.y));
			s *= 0.2; lum = max(s.r, max(s.g, s.b));
		}
		float occ = smoothstep(uOccLo, uOccLo + 0.3, lum) * uSunVis;
		vec2 sa = vec2((sp.x - 0.5) * asp, sp.y - 0.5), d = ca - sa;
		float dl = length(d), ang = atan(d.y, d.x);
		vec3 warm = mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.86, 0.66), uSite);
		float rays = pow(noise(vec2(ang * 9.0, 3.0)) * noise(vec2(ang * 23.0 + 5.0, 1.0)), 2.0);
		c += warm * occ * (exp(-dl * 9.0) * 0.35 + rays * exp(-dl * 4.5) * 0.5);
		// ghosts: little coloured rings lined up through the middle of the lens
		vec2 ax = -sa; vec3 g = vec3(0.0);
		g += vec3(0.35, 0.7, 1.0) * disc(ca, sa + ax * 0.55, 0.035, 0.6) * 0.18;
		g += vec3(0.6, 1.0, 0.55) * disc(ca, sa + ax * 1.25, 0.06, 0.3) * 0.10;
		g += vec3(1.0, 0.5, 0.85) * disc(ca, sa + ax * 1.6, 0.022, 0.8) * 0.22;
		g += mix(vec3(0.5, 0.6, 1.0), vec3(1.0, 0.55, 0.3), uSite) * disc(ca, sa + ax * 2.1, 0.13, 0.15) * 0.06;
		float halo = inv(0.0, 0.03, abs(length(ca) - 0.42 - 0.1 * length(sa))) * 0.04;
		g += vec3(1.0, 0.7, 0.9) * halo;
		c += g * occ * (1.0 - 0.6 * uInside);
	}
	c = shoulder(c + uFlash);
	// the grade: Moon = cold Apollo slide film, Mars = warm rover camera, inside = cosy lamp light
	float L = luma(c);
	vec3 shadowT = mix(vec3(0.86, 0.95, 1.10), vec3(0.98, 0.84, 0.78), uSite);
	vec3 highT = mix(vec3(1.03, 1.00, 0.96), vec3(1.05, 0.99, 0.90), uSite);
	c *= mix(shadowT, highT, smoothstep(0.0, 0.5, L));
	c = mix(c, c * vec3(1.08, 1.0, 0.86), uInside);
	float sat = mix(0.88, 1.08, uSite) + 0.06 * uInside + 0.08 * uTitle;
	L = luma(c);
	c = max(mix(vec3(L), c, sat), 0.0);
	float con = mix(1.10, 1.08, uSite);
	c = max((c - 0.16) * con + 0.16, 0.0) * mix(0.97, 1.0, uSite);
	// Mars dust: moving sheets of haze
	if (uDust > 0.001) {
		float hz = fbm(vec2(uv.x * 2.4 * asp - uTime * 0.22 * uMotion, uv.y * 3.0 + uTime * 0.03));
		vec3 haze = vec3(0.86, 0.62, 0.42) * (0.55 + 0.6 * L);
		c = mix(c, haze, uDust * (0.12 + 0.38 * hz) * (0.6 + 0.4 * (1.0 - uv.y)));
	}
	// radiation storm: aurora at the edges and streaks of light
	float edge = smoothstep(0.2, 0.75, rr);
	if (uStorm + uWarn > 0.001) {
		float a = fbm(vec2(atan(ca.y, ca.x) * 2.5 + uTime * 0.25 * uMotion, rr * 5.0 - uTime * 0.9 * uMotion));
		c += vec3(1.0, 0.22, 0.72) * edge * a * uStorm * 0.55;
		c += vec3(0.25, 1.0, 0.75) * edge * edge * (1.0 - a) * uStorm * 0.18;
		c += vec3(1.0, 0.25, 0.65) * edge * edge * uWarn * (0.10 + 0.08 * sin(uTime * 6.0));
		if (uMotion > 0.5) {
			for (int i = 0; i < 9; i++) {
				float fi = float(i), ph = uTime * 7.0 + fi * 0.37, slot = floor(ph), age = fract(ph);
				if (hash(vec2(slot, fi)) < uStorm * 0.6) {
					vec2 p = vec2((hash(vec2(slot + 1.3, fi)) - 0.5) * asp, hash(vec2(slot + 7.1, fi)) - 0.5);
					float an = hash(vec2(slot, fi + 3.0)) * 6.2832, ln = 0.01 + 0.07 * hash(vec2(fi, slot + 2.0));
					vec2 dir = vec2(cos(an), sin(an)) * ln;
					float fade = pow(1.0 - age, 4.0);
					c += vec3(1.0, 0.92, 1.0) * fade * (seg(ca, p, p + dir, 0.0022) * 1.6 + disc(ca, p, 0.012, 1.0) * 0.5);
				}
			}
		}
	}
	// cold and dark: frost creeps in from the visor edges
	if (uCold > 0.001) {
		float fr = fbm(ca * 7.0 + 3.0), ridge = 1.0 - abs(fbm(ca * 16.0) * 2.0 - 1.0);
		float m = smoothstep(0.42, 0.85, rr + (fr - 0.5) * 0.4) * uCold;
		c = mix(c, vec3(0.72, 0.84, 0.98) * (0.35 + 0.8 * L), m * (0.25 + 0.5 * pow(ridge, 5.0)));
	}
	// low air: the view narrows and fades, pulsing like breathing
	if (uAir > 0.001) {
		float br = 0.5 + 0.5 * sin(uTime * (1.6 + uAir * 1.4));
		float tun = smoothstep(0.18, 0.72, rr) * uAir * (0.65 + 0.35 * br * uMotion);
		L = luma(c);
		c = mix(c, vec3(L) * vec3(0.85, 0.92, 1.05), uAir * 0.55);
		c *= 1.0 - tun * 0.9;
	}
	// warm light leak drifting across the title and the films
	float leakAmt = max(uTitle, uCine * 0.6);
	if (leakAmt > 0.001) {
		vec2 lp = vec2(-0.75 * asp + 0.25 * sin(uTime * 0.11), 0.45 + 0.1 * sin(uTime * 0.07));
		c += mix(vec3(1.0, 0.42, 0.18), vec3(1.0, 0.6, 0.25), uSite) * inv(0.0, 1.1, length(ca - lp)) * 0.06 * leakAmt;
		vec2 lq = vec2(0.8 * asp, -0.5 + 0.1 * cos(uTime * 0.09));
		c += vec3(0.3, 0.45, 1.0) * inv(0.0, 0.9, length(ca - lq)) * 0.04 * leakAmt;
	}
	// soft dark corners
	float vig = inv(0.28, 1.05, length(ca * vec2(0.85, 1.0)));
	c *= mix(1.0, vig, 0.5 + 0.25 * uCine + 0.2 * uSnap);
	// postcard photo: the black cross marks of an Apollo Hasselblad camera
	if (uSnap > 0.001) {
		float sp2 = uRes.y / 5.0; vec2 px = vUv * uRes - uRes * 0.5;
		vec2 f = mod(px + sp2 * 0.5, sp2) - sp2 * 0.5;
		float arm = sp2 * 0.07, w = max(0.8, uRes.y / 900.0);
		float cr = max(step(abs(f.x), arm) * step(abs(f.y), w), step(abs(f.y), arm) * step(abs(f.x), w));
		c = mix(c, vec3(0.015), cr * min(1.0, uSnap * 1.5) * 0.85);
	}
	vec3 col = srgb(c);
	// space-camera filters (key L)
	if (uFilter > 0.5) {
		if (uFilter < 1.5) {
			float g = luma(col); col = mix(col, vec3(g), 0.5); col = col * vec3(1.03, 1.0, 0.93) + vec3(0.0, 0.014, 0.034) * (1.0 - g); col = (col - 0.5) * 1.14 + 0.5;
			col = mix(col, vec3(0.03), crosses(vUv, asp) * 0.85);
		} else if (uFilter < 2.5) {
			float g2 = (luma(col) - 0.5) * 1.3 + 0.52; col = vec3(g2) * (1.0 - smoothstep(0.6, 0.72, rr)) * (0.95 + 0.05 * sin(vUv.y * uRes.y * 1.4));
		} else if (uFilter < 3.5) {
			float g3 = luma(col); col = g3 + (col - g3) * 2.7; col = (col - 0.5) * 1.1 + 0.5;
		} else { col = heat(clamp(luma(col) * 1.08, 0.0, 1.0)); }
		col = clamp(col, 0.0, 1.0);
	}
	// film grain, after the colour is final so it looks even everywhere
	float seed = uMotion > 0.5 ? fract(uTime * 7.31) * 91.0 : 0.0;
	float gr = hash(floor(vUv * uRes) + seed) - 0.5;
	float amt = 0.035 + 0.035 * uCine + 0.035 * uDust + 0.03 * uStorm + 0.02 * uTitle;
	col += gr * amt * (1.0 - 0.5 * dot(col, vec3(0.33)));
	COLOR = vec4(col, 1.0);
}
"""

var level := 2
var filter := 0
var _user_set := false
var _layer: CanvasLayer
var _rect: ColorRect
var _mat: ShaderMaterial
var _time := 0.0
var _play_t := 0.0
var _snap_t := 0.0
var _perf := { "t": 0.0, "n": 0, "sum": 0.0 }
var _state := { "mode": "title", "site": "mars", "room": "", "pov": false, "air": 100.0 }
## the smoothed game state that drives the look (read it for tests)
var look := { "storm": 0.0, "warn": 0.0, "dust": 0.0, "air": 0.0, "cold": 0.0, "kick": 0.0, "cine": 0.0, "title": 0.0, "inside": 0.0, "site": 1.0, "sunVis": 0.0 }
## short jolts the game asks for: flash (white), shock (the lens is shaken), glitch (the picture tears), glow (a warm swell)
var pu := { "flash": 0.0, "shock": 0.0, "glitch": 0.0, "glow": 0.0 }


func _ready() -> void:
	var saved = Game._load_pref("fx", null)
	_user_set = saved != null
	level = clampi(int(saved), 0, 2) if saved != null else (1 if OS.has_feature("mobile") else 2)
	_layer = CanvasLayer.new()
	_layer.name = "CameraLook"
	_layer.layer = 1                  # over the 3D world, under the HUD (Ui is layer 10)
	add_child(_layer)
	_rect = ColorRect.new()
	_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = SHADER
	_mat = ShaderMaterial.new()
	_mat.shader = sh
	_rect.material = _mat
	_layer.add_child(_rect)
	_apply_level()


func build(_site: String) -> void:
	_apply_level()


# ---------- the levels and filters ----------
func available() -> bool:
	return true


func level_name() -> String:
	return LEVELS[level]


func set_level(n: int, by_user := true) -> int:
	level = posmod(n, 3)
	if by_user:
		_user_set = true
		Game._save_pref("fx", level)
	_apply_level()
	return level


func next_level() -> int:              # full, lite, off, full...
	return set_level(2 if level == 0 else level - 1)


func _apply_level() -> void:
	if _layer:
		_layer.visible = level > 0
	var env: Environment = World.environment
	if env == null:
		return
	env.glow_enabled = level > 0
	for i in 7:
		env.set_glow_level(i, 0.0)
	env.set_glow_level(1, 1.0)
	env.set_glow_level(3, 1.0)
	if level >= 2:
		env.set_glow_level(5, 0.6)       # the wide, soft halo only in Full


func current() -> Dictionary:
	return FILTERS[filter]


func set_filter(i: int) -> Dictionary:
	filter = posmod(i, FILTERS.size())
	return FILTERS[filter]


func next_filter() -> Dictionary:
	return set_filter(filter + 1)


func pulse(kind: String, amount = null) -> void:
	if not pu.has(kind):
		return
	pu[kind] = maxf(pu[kind], 1.0 if amount == null else float(amount))


func snap() -> void:
	_snap_t = 1.6


## the game fills this in every frame: { mode, site, room, pov, air }
func set_state(st: Dictionary) -> void:
	_state = st


# ---------- every frame ----------
func _ease(key: String, want: float, dt: float, speed := 3.0) -> void:
	look[key] += (want - look[key]) * minf(1, dt * speed)


func _read_game(dt: float) -> void:
	var env: Dictionary = World.env
	var mode: String = _state.get("mode", "title")
	var mars: bool = World.site_id != "moon"
	var out := mode == "play" or mode == "observe"
	var s = Game.s
	var phase: String = Sim.storm_phase(s) if s else ""
	look.site = 1.0 if mars else 0.0
	_ease("storm", env.stormShown * (1.0 if out else (0.15 if mode == "inside" else 0.6)), dt, 4)
	_ease("warn", 1.0 if out and phase == "warning" else 0.0, dt, 3)
	_ease("dust", env.dustShown if mars else 0.0, dt, 2)
	var air: float = float(_state.get("air", 100.0))
	_ease("air", clampf((28 - air) / 24, 0, 1) if s and (out or mode == "inside") else 0.0, dt, 1.5)
	_ease("cold", clampf((env.dark - 0.55) / 0.4, 0, 1) * (0.7 if mars else 0.8) if out else 0.0, dt, 0.6)
	_ease("cine", 1.0 if World.cam.mode == "cine" or mode == "intro" or mode == "launch" else 0.0, dt, 2)
	_ease("title", 1.0 if mode == "title" or mode == "brief" else 0.0, dt, 2)
	_ease("inside", 1.0 if mode == "inside" else 0.0, dt, 2.5)
	look.kick = clampf(float(World.cam.shake) * 2.2, 0, 1)
	# where is the Sun on screen, and is it in front of us?
	var cam: Camera3D = World.camera
	var vis := 0.0
	var su := Vector2(-1, -1)
	if cam:
		var fwd := -cam.global_transform.basis.z
		var front := fwd.dot(World.sun_dir)
		var p := cam.global_position + World.sun_dir * 1000
		if front > 0.05 and not cam.is_position_behind(p):
			var vs := get_viewport().get_visible_rect().size
			var sp := cam.unproject_position(p)
			su = Vector2(sp.x / vs.x, 1.0 - sp.y / vs.y)
			var on_screen := clampf(1 - (maxf(absf(su.x - 0.5), absf(su.y - 0.5)) - 0.5) / 0.4, 0, 1)    # fades out just past the screen edge
			vis = clampf((front - 0.05) * 4, 0, 1) * on_screen
	_mat.set_shader_parameter("uSun", su)
	_ease("sunVis", vis * (1 - look.dust * 0.85) * (1 - look.inside), dt, 6)     # indoors the Sun only shows through a window


func _set_uniforms() -> void:
	var vs := get_viewport().get_visible_rect().size
	var moon: bool = look.site == 0.0
	var m := _mat
	m.set_shader_parameter("uRes", vs)
	m.set_shader_parameter("uTime", _time)
	m.set_shader_parameter("uFull", 1.0 if level >= 2 else 0.0)
	m.set_shader_parameter("uSite", look.site)
	m.set_shader_parameter("uSunVis", look.sunVis)
	m.set_shader_parameter("uOccLo", 0.55 if moon else 0.7)
	m.set_shader_parameter("uStreakAmt", (0.9 if moon else 0.55) + 0.5 * look.cine)
	m.set_shader_parameter("uStreakTint", Vector3(0.5, 0.72, 1.0) if moon else Vector3(1.0, 0.72, 0.45))
	for k in ["storm", "warn", "dust", "air", "cold", "kick", "cine", "title", "inside"]:
		m.set_shader_parameter("u" + k.capitalize(), look[k])
	m.set_shader_parameter("uSnap", clampf(_snap_t / 1.6, 0, 1))
	m.set_shader_parameter("uFlash", pu.flash)
	m.set_shader_parameter("uShock", pu.shock)
	m.set_shader_parameter("uGlitch", pu.glitch)
	m.set_shader_parameter("uGlow", pu.glow)
	m.set_shader_parameter("uFilter", float(filter))
	# the Environment's glow: a little more on the title and in the films
	var env: Environment = World.environment
	if env and level > 0:
		env.glow_intensity = (0.5 if moon else 0.45) * (1 + 0.3 * look.title + 0.45 * look.cine)
		# only real lights glow, not bright ground: a higher threshold, and a cap so a big bright surface filling the
		# view (looking down at sunlit dust) cannot wash the whole frame (the web version's uThresh and uCap)
		env.glow_hdr_threshold = 1.3 if moon else 1.5
		env.glow_hdr_luminance_cap = 2.5 if moon else 1.8


## watch the frame rate while playing and step down if it struggles (unless the player picked a level).
## Real time between frames, so a run with a fixed game step (the test bot) measures the true speed.
var _last_us := 0


func _watch_perf(_dt: float) -> void:
	var now := Time.get_ticks_usec()
	var dt := clampf((now - _last_us) / 1e6, 0, 0.25) if _last_us > 0 else 0.0
	_last_us = now
	if _user_set or level == 0 or dt <= 0:
		return
	_perf.t += dt
	_perf.sum += dt
	_perf.n += 1
	if _perf.t < 4:
		return
	var avg: float = _perf.sum / _perf.n
	_perf = { "t": 0.0, "n": 0, "sum": 0.0 }
	if avg > 1.0 / 38:
		set_level(level - 1, false)


func _process(dt: float) -> void:
	if not Game.booted or World.camera == null:
		return
	_snap_t = maxf(0, _snap_t - dt)
	pu.flash *= exp(-dt * 6)
	pu.shock *= exp(-dt * 4.5)
	pu.glitch *= exp(-dt * 5)
	pu.glow *= exp(-dt * 2.4)
	if level == 0:
		return
	_time += dt
	_read_game(dt)
	if _state.get("mode", "") == "play":
		_play_t += dt
		if _play_t > 3:                     # skip the loading hiccup when a day starts
			_watch_perf(dt)
	else:
		_play_t = 0.0
		_last_us = 0
	_set_uniforms()
