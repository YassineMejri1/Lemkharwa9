extends Node
## The lookout rock: sit down, and simply look. The flat rock where the landing film ends (Terrain.L.seat) is the
## crew's lookout. Walk up to it and press E: the astronaut steps in front of it, turns, sits down and leans back on
## his hands, and the camera settles behind his shoulder with a long lens. Then a slow reveal, and the player can look
## around, zoom, switch to the view through the visor (V), and stand up again (E) whenever they like.
##   Moon  Earth hangs low over the lit outpost, in a black sky full of stars and the Milky Way.
##   Mars  the real Martian sky: butterscotch by day, blue around a sunset; once it is dark enough, the stars, the
##         Milky Way and Earth as a bright blue-white evening star near the Sun.
## The mission clock waits while you sit (the game does not run the rules in this mode).
## This only drives the astronaut, the camera, the overlay and the deeper sky (World.observe). A port of js/observe.js.

const S := 0.84
const HIP := 0.86          # the astronaut's scale and hip height in model units
var st = null
var site := "moon"
var seat = null
var ui := {}
var _built_for: Node = null
var _hidden: Array = []


static func _ease(u: float) -> float:
	u = clampf(u, 0, 1)
	return u * u * (3 - 2 * u)


static func _seg(t: float, a: float, b: float) -> float:
	return clampf((t - a) / (b - a), 0, 1)


static func _ang_lerp(a: float, b: float, t: float) -> float:
	return a + wrapf(b - a, -PI, PI) * t


# ---------- the rock, and which way the seat faces ----------
func build() -> void:
	site = World.site_id
	st = null
	var L: Vector2 = Terrain.L.seat
	var R := Vector3(L.x, 0, L.y)
	var g0 := Terrain.height(R.x, R.z)
	var top := g0 + (Terrain.seat_top if Terrain.seat_top > 0 else 0.62)
	# Moon: face Earth, which hangs above the outpost from here. Mars: face between the outpost and the west, so the
	# sunset at the end of the shift (and Earth, the evening star beside it) is in the picture.
	var yaw := atan2(World.EARTH_DIR.x, World.EARTH_DIR.z) if site == "moon" else atan2(-R.x, -R.z) + 0.44
	var fx := sin(yaw)
	var fz := cos(yaw)
	var surface := func(x: float, z: float) -> float:
		var y: float = World.seat_height(x, z)
		return y if y > -1e8 else top
	var sx := R.x + fx * 1.0
	var sz := R.z + fz * 1.0
	seat = { "R": R, "yaw": yaw, "fx": fx, "fz": fz, "top": top,
		"hip": Vector3(sx, surface.call(sx, sz) + 0.02, sz),            # where the hips rest, near the front edge
		"front": Vector3(R.x + fx * 1.85, 0, R.z + fz * 1.85) }          # where he stands before he sits
	# a folded gold thermal blanket on the rock: the crew's sit-pad, so the rock reads as a seat
	var px := R.x + fx * 0.82
	var pz := R.z + fz * 0.82
	var pad := Node3D.new()
	pad.position = Vector3(px, surface.call(px, pz) + 0.008, pz)
	pad.rotation.y = yaw
	World.root.add_child(pad)
	var foil := StandardMaterial3D.new()
	foil.albedo_color = Mats.lin(0xd9a845)
	foil.metallic = 0.85
	foil.roughness = 0.38
	foil.emission_enabled = true
	foil.emission = Mats.lin(0x2a1a00)
	foil.emission_energy_multiplier = 0.25
	Mats.add(pad, Mats.box(0.66, 0.035, 0.5), foil)
	var m2 := Mats.add(pad, Mats.box(0.62, 0.02, 0.22), foil, 0, 0.026, -0.12)
	m2.rotation.x = 0.06
	Mats.add(pad, Mats.box(0.05, 0.05, 0.52), Mats.soft(0x3a4152, { "roughness": 0.8 }), 0.22, 0.012, 0)
	seat.pad = pad
	_built_for = World.root


func _ensure() -> void:
	if World.root and _built_for != World.root:
		build()


func near(p: Vector3) -> float:
	_ensure()
	return Vector2(p.x - seat.R.x, p.z - seat.R.z).length() if seat else 1e9


## what E does next to the rock
func offer(_s, p: Vector3, offer_fn: Callable, run: Callable) -> void:
	_ensure()
	if seat == null or st != null:
		return
	offer_fn.call(near(p) - 1.55, 1.9, { "label": "Sit and observe", "run": run })


# ---------- the little overlay: two thin cinema bars, a few quiet lines, one hint ----------
func _build_ui() -> void:
	if not ui.is_empty():
		return
	var el := Control.new()
	el.name = "Observe"
	el.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	el.mouse_filter = Control.MOUSE_FILTER_IGNORE
	el.visible = false
	Ui.root.add_child(el)
	var vign := ColorRect.new()
	vign.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	vign.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = "shader_type canvas_item;\nvoid fragment() { vec2 d = (UV - vec2(0.5, 0.46)) / vec2(0.75, 0.70); COLOR = vec4(0.0, 0.0, 0.0, smoothstep(0.55, 1.0, length(d)) * 0.42); }"
	var sm := ShaderMaterial.new()
	sm.shader = sh
	vign.material = sm
	el.add_child(vign)
	var bars: Array = []
	for top in [true, false]:
		var b := ColorRect.new()
		b.color = Color.BLACK
		b.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
		b.offset_top = 0 if top else 0
		b.offset_bottom = 0
		el.add_child(b)
		bars.append(b)
	var info := VBoxContainer.new()
	info.position = Vector2(40, 82)
	info.custom_minimum_size = Vector2(420, 0)
	info.mouse_filter = Control.MOUSE_FILTER_IGNORE
	info.add_theme_constant_override("separation", 4)
	el.add_child(info)
	var mk := func(size: int, weight: int, col: Color) -> Label:
		var l := Label.new()
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size.x = 420
		l.add_theme_font_override("font", Style.font(weight))
		l.add_theme_font_size_override("font_size", size)
		l.add_theme_color_override("font_color", col)
		l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
		l.add_theme_constant_override("shadow_offset_y", 1)
		l.add_theme_constant_override("shadow_outline_size", 6)
		info.add_child(l)
		return l
	var b_l: Label = mk.call(13, 600, Color(1, 1, 1, 0.92))
	var l1: Label = mk.call(15, 300, Color(0.93, 0.95, 1, 0.9))
	var l2: Label = mk.call(15, 300, Color(0.93, 0.95, 1, 0.9))
	var l3: Label = mk.call(15, 300, Color(0.93, 0.95, 1, 0.9))
	var sm_l: Label = mk.call(12, 300, Color(0.78, 0.82, 0.92, 0.6))
	var lapse := Label.new()
	lapse.text = "●  TIME-LAPSE · SUNSET ON MARS"
	lapse.set_anchors_preset(Control.PRESET_CENTER_TOP)
	lapse.offset_left = -200
	lapse.offset_right = 200
	lapse.offset_top = 58
	lapse.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lapse.add_theme_font_override("font", Style.font(600, "exo2"))
	lapse.add_theme_font_size_override("font_size", 12)
	lapse.add_theme_color_override("font_color", Color(0.93, 0.95, 1, 0.8))
	el.add_child(lapse)
	var fade := ColorRect.new()
	fade.color = Color(0, 0, 0, 0)
	fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	el.add_child(fade)
	var hint := Button.new()
	hint.text = "E  Stand up   ·  drag to look around  ·  wheel to zoom  ·  V  visor"
	hint.theme_type_variation = "BtnGhost"
	hint.focus_mode = Control.FOCUS_NONE
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.offset_top = -46
	hint.offset_bottom = -10
	hint.pressed.connect(func(): stand())
	el.add_child(hint)
	ui = { "el": el, "vign": vign, "bars": bars, "info": info, "b": b_l, "l1": l1, "l2": l2, "l3": l3, "small": sm_l, "lapse": lapse, "fade": fade, "hint": hint,
		"bar_h": 0.0, "info_a": 0.0, "lapse_a": 0.0, "fade_a": 0.0, "hint_a": 0.0, "vign_a": 0.0 }


func _info_text(s, dark_now = null) -> Dictionary:
	var place: String = s.site.place if s else ""
	if site == "moon":
		return { "b": place + " · The Moon", "l1": "Earth is 384,400 km away. Its light takes 1.3 seconds to get here.",
			"l2": "The sky is black even at noon: there is no air to scatter sunlight.",
			"l3": "No air means no shooting stars. Watch instead for tiny flashes where space dust hits the ground." }
	var date = Sim.weather(s).get("date") if s else null
	var mins: float = Weather.mars_delay_min(date) if date else 0.0
	var dist := (str(roundi(mins * 60 * 299792.458 / 1e6)) + " million km away") if mins else "many millions of km away"
	var dark: bool = dark_now if dark_now != null else World.sky_dark() > 0.35
	return { "b": place + " · Mars", "l1": "Earth is " + dist + ((". A radio call takes " + str(roundi(mins)) + " minutes.") if mins else "."),
		"l2": "The bright blue-white star low in the west is Earth. The faint dot beside it is our Moon." if dark else "By day the dusty sky glows butterscotch. Sunsets here are blue.",
		"l3": "Shooting stars here are grains of space dust burning up in the thin air." if dark else "Stay a while: the Sun is about to set." }


func _set_info(t: Dictionary) -> void:
	ui.b.text = str(t.b).to_upper()
	ui.l1.text = t.l1
	ui.l2.text = t.l2
	ui.l3.text = t.get("l3", "")


# ---------- start ----------
func active() -> bool:
	return st != null


## ctx: { s, pov (helmet view on?), done(result) called once he is standing again }
func start(ctx: Dictionary) -> bool:
	_ensure()
	if st != null or seat == null:
		return false
	var a = Actors.astro
	_build_ui()
	st = { "t": 0.0, "phase": "walk", "done": ctx.done, "s": ctx.s, "visor": 0.0, "wantVisor": ctx.get("pov", false), "yawU": 0.0, "pitchU": 0.0, "zoom": 1.0,
		"fov": World.camera.fov, "c0": World.camera.global_position, "l0": World.camera.global_position - World.camera.global_transform.basis.z * 20,
		"standT": 0.0, "music": false, "t0": 0.0, "tv": 0.0, "p0": Vector3.ZERO, "back": null, "pov": false, "restored": false }
	a.mode = "sit"
	a.sit_k = 0.0
	a.relax_k = 0.0
	a.look = 0.0
	a.sit_walk = 1.0
	a.vel = Vector3.ZERO
	if Actors.fp:
		Actors.set_first_person(false)          # the body must be seen from behind the shoulder
	World.cam.mode = "cine"
	World.cam.cine.roll = 0.0
	World.cam.cine.pos = st.c0
	World.cam.cine.look = st.l0
	World.cam.cine.fov = st.fov
	_set_info(_info_text(ctx.s))
	# Mars: the time-lapse runs the sky on from now to a starry night (the mission clock stays where it was)
	st.lapse = site == "mars"
	st.sky0 = World.env.t
	st.darkInfo = World.sky_dark() > 0.35
	ui.small.text = "The mission clock waits while you rest."
	ui.el.visible = true
	# everything else steps aside while you look
	_hidden = []
	for id in ["hud", "goals", "radio", "prompt", "hands", "card", "rover-hud"]:
		if Ui.shown(id):
			_hidden.append(id)
			Ui.show_part(id, false)
	if Game.has_addon("minimap"):
		Game.ext("minimap", "show", [false])
	return true


# ---------- the shot ----------
## Behind the right shoulder, low, with a long lens. yaw and pitch are where the view points.
static func _shot(H: Vector3, yaw: float, pitch: float, dist: float, side: float, up: float) -> Array:
	var cp := cos(pitch)
	var fx := sin(yaw)
	var fz := cos(yaw)
	var out := Vector3(H.x - fx * dist - fz * side, H.y + up, H.z - fz * dist + fx * side)
	var gy := Terrain.height(out.x, out.z) + 0.35
	if out.y < gy:
		out.y = gy
	return [out, Vector3(out.x + fx * cp * 60, out.y + sin(pitch) * 60, out.z + fz * cp * 60)]


func _head_point() -> Vector3:              # the middle of the helmet when seated
	return Vector3(seat.hip.x - seat.fx * 0.08, seat.hip.y + 0.86, seat.hip.z - seat.fz * 0.08)


## input: { x, z } from the keys or stick (looks around slowly)
func step(dt: float, input: Dictionary) -> void:
	if st == null:
		return
	var a = Actors.astro
	st.t += dt
	var t: float = st.t
	var moon := site == "moon"
	var ph: String = st.phase
	# ---- the astronaut ----
	if ph == "walk":
		# step to the front of the rock, then turn your back to it
		var fx: float = seat.front.x - a.pos.x
		var fz: float = seat.front.z - a.pos.z
		var d := Vector2(fx, fz).length()
		if d > 0.08 and t < 3:
			var sp := minf(2.4, d * 3)
			a.vel = Vector3(fx / d * sp, 0, fz / d * sp)
			a.sit_walk = sp
			a.pos.x += a.vel.x * dt
			a.pos.z += a.vel.z * dt
			a.yaw = _ang_lerp(a.yaw, atan2(fx, fz), minf(1, dt * 8))
		else:
			a.vel = Vector3.ZERO
			a.sit_walk = 0.01
			a.yaw = _ang_lerp(a.yaw, seat.yaw, minf(1, dt * 5))
		a.pos.y = Terrain.height(a.pos.x, a.pos.z)
		if (d <= 0.08 or t >= 3) and absf(wrapf(seat.yaw - a.yaw, -PI, PI)) < 0.06:
			st.phase = "sit"
			st.t0 = t
			st.p0 = a.pos
			a.sit_walk = 0.0
	elif ph == "sit" or ph == "view":
		var u: float = t - st.t0
		a.sit_k = _ease(_seg(u, 0, 1.5))
		a.relax_k = _ease(_seg(u, 1.7, 3.0))
		a.yaw = _ang_lerp(a.yaw, seat.yaw, minf(1, dt * 4))
		var sy: float = seat.hip.y - HIP * S          # where the feet-level origin goes when the hips rest on the rock
		a.pos.x = lerpf(st.p0.x, seat.hip.x, _ease(_seg(u, 0.25, 1.4)))
		a.pos.z = lerpf(st.p0.z, seat.hip.z, _ease(_seg(u, 0.25, 1.4)))
		a.pos.y = lerpf(st.p0.y, sy, _ease(_seg(u, 0.3, 1.5))) - sin(PI * _seg(u, 1.2, 1.7)) * 0.025
		a.look = lerpf(a.look, clampf(st.yawU, -0.5, 0.5), minf(1, dt * 2))
		if ph == "sit" and u >= 1.5:
			st.phase = "view"
			st.tv = t
			Au.play("land", { "vol": 0.35 })
			World.dust(a.pos.x - seat.fx * 0.3, a.pos.z - seat.fz * 0.3, 5, 0.8, 0.3)
	elif ph == "stand":
		var u: float = t - st.standT
		a.relax_k = minf(a.relax_k, 1 - _ease(_seg(u, 0, 0.7)))
		a.sit_k = minf(a.sit_k, 1 - _ease(_seg(u, 0.5, 1.6)))
		a.look = lerpf(a.look, 0, minf(1, dt * 3))
		var m := _ease(_seg(u, 0.6, 1.7))
		a.pos.x = lerpf(seat.hip.x, seat.front.x, m)
		a.pos.z = lerpf(seat.hip.z, seat.front.z, m)
		a.pos.y = lerpf(seat.hip.y - HIP * S, Terrain.height(seat.front.x, seat.front.z), _ease(_seg(u, 0.6, 1.6)))
	ph = st.phase
	# ---- looking around: keys and stick turn the view slowly (drag and wheel come through look / zoom) ----
	if ph == "view":
		st.yawU = clampf(st.yawU - float(input.get("x", 0.0)) * dt * 0.7, -2.4, 2.4)
		st.pitchU = clampf(st.pitchU - float(input.get("z", 0.0)) * dt * 0.45, -0.32, 0.62)
	st.visor = lerpf(st.visor, 1.0 if st.wantVisor and ph == "view" else 0.0, minf(1, dt * 2.6))
	var fp: bool = st.visor > 0.5
	if fp != Actors.fp:
		Actors.set_first_person(fp)
	# ---- the camera ----
	var H := _head_point()
	var tv: float = (t - st.tv) if ph == "view" else (99.0 if ph == "stand" else 0.0)
	var rev := _ease(_seg(tv, 0.8, 9))                  # the slow reveal after he has settled
	var yaw: float = seat.yaw + 0.14 + st.yawU
	var pitch: float = lerpf(0.02, 0.11 if moon else 0.07, rev) + st.pitchU
	var breathe := sin(World.time * 1.45) * 0.006
	# a tall screen sees less from side to side: a wider lens, and the astronaut nearer the middle
	var narrow := clampf(World.aspect() / 1.35, 0.4, 1)
	var sh := _shot(H, yaw, pitch, lerpf(2.6, 4.1, rev), lerpf(0.8, 1.05, rev) * narrow, lerpf(0.14, 0.42, rev) + breathe)
	var v1: Vector3 = sh[0]
	var v2: Vector3 = sh[1]
	var fov: float = minf(78, lerpf(46, 36, rev) / sqrt(narrow)) * st.zoom
	if st.visor > 0.001:                                 # through the visor: eyes in the helmet, legs below
		var e := Vector3(H.x + sin(yaw) * 0.14, H.y + 0.04 + breathe, H.z + cos(yaw) * 0.14)
		var cp := cos(pitch)
		v1 = v1.lerp(e, st.visor)
		v2 = v2.lerp(e + Vector3(sin(yaw) * cp * 60, sin(pitch) * 60, cos(yaw) * cp * 60), st.visor)
		fov = lerpf(fov, 60 * st.zoom, st.visor)
	# from the gameplay camera into the shot (and back out again when standing)
	var c: Dictionary = World.cam.cine
	if ph == "stand":
		var into := 1 - _ease(_seg(t - st.standT, 0.2, 2.0))
		# where the normal camera will be: behind him, looking the way he faced
		var by := yaw + PI
		var bp := 0.36
		var bd: float = World.cam.get("dist", 11.0)
		var fo := Vector3(a.pos.x, a.pos.y + 1.7, a.pos.z)
		var bpos: Vector3
		var blook: Vector3
		if st.pov:
			bpos = fo
			blook = Vector3(a.pos.x - sin(by) * 20, a.pos.y + 1.6, a.pos.z - cos(by) * 20)
		else:
			bpos = fo + Vector3(sin(by) * cos(bp) * bd, sin(bp) * bd, cos(by) * cos(bp) * bd)
			blook = fo
		c.pos = bpos.lerp(v1, into)
		c.look = blook.lerp(v2, into)
		c.fov = lerpf(66.0 if st.pov else 52.0, fov, into)
	else:
		var into := _ease(_seg(t, 0, 3.4))
		c.pos = st.c0.lerp(v1, into)
		c.look = st.l0.lerp(v2, into)
		c.fov = lerpf(st.fov, fov, into)
	c.roll = 0.0
	# ---- the sky, the sound, the overlay ----
	var sky := (1 - _ease(_seg(t - st.standT, 0, 1.6))) if ph == "stand" else _ease(_seg(tv, 0.5, 7))
	World.observe(sky)
	# Mars: a time-lapse of the sunset, on into the night. Only the sky moves on; the mission clock does not.
	if st.lapse:
		if ph == "view":
			World.env.t = lerpf(st.sky0, 1.22, _ease(_seg(tv, 2, 30)))
		elif ph == "stand" and not st.restored and t - st.standT > 0.7:
			st.restored = true
			World.env.t = st.sky0                 # back to now, behind the fade
		var dk := World.sky_dark() > 0.35
		if ph == "view" and dk != st.darkInfo:
			st.darkInfo = dk
			_set_info(_info_text(st.s, dk))
	Au.breathe(dt, false)
	if not st.music and tv > 1.2 and ph == "view":
		st.music = true
		Au.music("vista")
	var want_info: bool = ph == "view" and (((tv > 5 and tv < 19) or (tv > 31 and tv < 52)) if st.lapse else (tv > 5 and tv < 26))
	_ui_frame(dt, ph != "stand" and t > 1.2, want_info, st.lapse and ph == "view" and tv > 2 and tv < 31,
		st.lapse and ph == "stand" and t - st.standT < 0.85, ph == "view" and tv > 2.5, ph == "view" and tv > 11)
	if ph == "stand" and t - st.standT >= 2.0:
		_finish()


func _ui_frame(dt: float, bars: bool, info: bool, lapse: bool, fade: bool, hint: bool, quiet: bool) -> void:
	var vh: float = Ui.root.size.y
	ui.bar_h = lerpf(ui.bar_h, vh * 0.065 if bars else 0.0, minf(1, dt * 1.6))
	ui.bars[0].offset_bottom = ui.bar_h
	ui.bars[1].offset_top = -ui.bar_h
	ui.vign_a = lerpf(ui.vign_a, 1.0 if bars else 0.0, minf(1, dt * 0.8))
	ui.vign.modulate.a = ui.vign_a
	ui.info_a = lerpf(ui.info_a, 1.0 if info else 0.0, minf(1, dt * 1.0))
	ui.info.modulate.a = ui.info_a
	ui.info.position.y = 82 + ui.bar_h * 0.3 + (1 - ui.info_a) * 6
	ui.lapse_a = lerpf(ui.lapse_a, 1.0 if lapse else 0.0, minf(1, dt * 1.6))
	ui.lapse.modulate.a = ui.lapse_a * (0.6 + 0.4 * absf(sin(World.time * 2)))
	ui.lapse.offset_top = ui.bar_h + 12
	ui.fade_a = lerpf(ui.fade_a, 1.0 if fade else 0.0, minf(1, dt * 5))
	ui.fade.color.a = ui.fade_a
	ui.hint_a = lerpf(ui.hint_a, (0.38 if quiet else 0.85) if hint else 0.0, minf(1, dt * 1.6))
	ui.hint.modulate.a = ui.hint_a
	ui.hint.mouse_filter = Control.MOUSE_FILTER_STOP if hint else Control.MOUSE_FILTER_IGNORE


func look(dx: float, dy: float) -> void:
	if st == null or st.phase != "view":
		return
	st.yawU = clampf(st.yawU - dx * 0.0042, -2.4, 2.4)
	st.pitchU = clampf(st.pitchU - dy * 0.0032, -0.32, 0.62)


func zoom(dir: float) -> void:
	if st == null:
		return
	st.zoom = clampf(st.zoom * (1.08 if dir > 0 else 1 / 1.08), 0.55, 1.5)


func toggle_view() -> void:
	if st == null or st.phase != "view":
		return
	st.wantVisor = not st.wantVisor
	Au.play("swish")


## stand up (E, Escape, or the hint button); returns true when that started it
func stand(pov = null) -> bool:
	if st == null or st.phase == "stand":
		return false
	if st.phase == "walk":
		_finish()                              # not sat down yet: just stop
		return true
	st.phase = "stand"
	st.standT = st.t
	st.pov = st.wantVisor if pov == null else bool(pov)
	Au.music(null)
	Au.play("swish", { "vol": 0.5 })
	return true


func _finish() -> void:
	if st == null:
		return
	var a = Actors.astro
	var done: Callable = st.done
	var yaw: float = seat.yaw + 0.14 + st.yawU
	var pov: bool = st.pov
	if st.lapse and not st.restored:
		World.env.t = st.sky0
	a.sit_k = 0.0
	a.relax_k = 0.0
	a.look = 0.0
	a.sit_walk = 0.0
	a.mode = "walk"
	a.vel = Vector3.ZERO
	a.pos.y = Terrain.height(a.pos.x, a.pos.z)
	a.on_ground = true
	a.vy = 0.0
	a.yaw = yaw
	World.observe(0)
	ui.el.visible = false
	ui.bar_h = 0.0
	ui.info_a = 0.0
	ui.hint_a = 0.0
	for id in _hidden:
		Ui.show_part(id, true)
	_hidden = []
	st = null
	if done.is_valid():
		done.call({ "yaw": yaw, "pov": pov })


## the game is leaving the surface (a modal, the night, a quit): drop out at once
func cancel() -> void:
	if st != null:
		Au.music(null)
		_finish()
