extends Node
## Mission Control: the operational heart of the habitat (a port of js/mission.js).
## This add-on owns everything the dome's workstations show and do:
##   - the Earth-Mars orbit instrument, drawn from the SAME model that gives the radio delay (Weather.planets),
##     so the picture and the number always agree
##   - a radio queue that respects the light-time delay in BOTH directions: a message to Earth arrives after one
##     trip, the answer after another; nothing from Earth is ever instant
##   - the mission log (storms, breakdowns, calls, milestones) that the screens and cards show
##   - the four station cards (Mission Control, life support, power, science) built from live simulation state
##   - the cutaway overlay that the game shows while the camera moves to the workstation
## The screens in the 3D room (interior add-on) call screen() to draw themselves.

const INK := Color("#eaf0ff")
const MUTED := Color("#8c99c4")
const AIR := Color("#4fd8ff")
const FOOD := Color("#7be36a")
const DOSE := Color("#ff6fb1")
const POWER := Color("#ffd23f")
const OK := Color("#4dff9a")
const BAD := Color("#ff5468")
const AMBER := Color("#ffb347")
const EARTH := Color("#5db2ff")
const MARS := Color("#ff7a4a")
const SUN := Color("#ffe08a")
const WATER := Color("#6fb9ff")
const SHIELD := Color("#c9a6ff")
const FONT := "lexend"
const MONO := "mono"

var _paths = null            # the two orbit paths, computed once from the shared model
var _orbit: Control = null   # the live diagram in the open card
var _orbit_t0 := 0.0
var _orbit_s = null
var _meters := []            # [{ id, label, v, color, value }] for the open card


static func _clamp(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))


static func _pct(v) -> int:
	return roundi(_clamp(float(v), 0, 100))


static func mmss(minutes: float) -> String:
	var sec := roundi(minutes * 60)
	return str(sec / 60) + "m " + ("%02d" % (sec % 60)) + "s"


static func _today(s: Dictionary) -> String:
	var w = Sim.weather(s)
	if w is Dictionary and w.get("date"):
		return str(w.date)
	return Weather.today_iso()


static func _dw(s: Dictionary) -> String:
	return str(s.site.dayWord)


static func _t(v) -> bool:
	return Js.truthy(v)


func _box(s: Dictionary) -> Dictionary:
	if not (s.get("comms") is Dictionary):
		s.comms = { "log": [], "events": [], "seq": 0, "flash": null, "outlookSeen": false }
	return s.comms


# ---------- the model behind every screen ----------
## One call gathers what the link needs: planet positions, real light-time and the game's compressed wait
## (Sim.comm_info keeps those consistent with the repair radio calls).
func model(s: Dictionary) -> Dictionary:
	var info: Dictionary = Sim.comm_info(s)
	var moon: bool = s.site.id == "moon"
	var p: Dictionary = Weather.planets(_today(s))
	var one_way: float = 1.5 if moon else float(info.wait) / 2.0
	var inflight := []
	for m in _box(s).log:
		if m.state == "transit":
			inflight.append(m)
	var cur = inflight.back() if inflight.size() else null
	var prog := 0.0
	if cur:
		prog = _clamp((float(s.t) - cur.t0) / maxf(0.1, cur.t1 - cur.t0), 0, 1)
	return { "moon": moon, "p": p, "minutes": 1.28 / 60.0 if moon else float(p.minutes), "oneWaySec": one_way, "dish": _t(s.m.comms.get("on")),
		"dishBroken": _t(s.m.comms.get("broken")), "cur": cur, "prog": prog, "pending": inflight.size(), "align": Weather.alignment(p), "info": info }


# ---------- the orbit instrument ----------
func _orbit_paths() -> Dictionary:
	if _paths == null:
		_paths = { "earth": Weather.orbit_path("earth", 140), "mars": Weather.orbit_path("mars", 180) }
	return _paths


## a dashed line whose dashes crawl along it (offset in pixels)
static func _dash(ci: CanvasItem, a: Vector2, b: Vector2, color: Color, width: float, on: float, off: float, offset: float) -> void:
	var L := a.distance_to(b)
	if L < 1:
		return
	var dir := (b - a) / L
	var period := on + off
	var d := fposmod(offset, period) - period
	while d < L:
		var d0 := maxf(0, d)
		var d1 := minf(L, d + on)
		if d1 > d0:
			ci.draw_line(a + dir * d0, a + dir * d1, color, width, true)
		d += period


## Draws the inner solar system seen from above, centred on (cx, cy) with Mars' orbit fitting in r.
## mdl: from model(); t: seconds, for the slow dash crawl and the signal pulse.
func draw_orbit(ci: CanvasItem, cx: float, cy: float, r: float, mdl: Dictionary, t: float, o: Dictionary = {}) -> void:
	var scale: float = o.get("scale", 1.0)
	var k := r / 1.72
	var P := _orbit_paths()
	var p: Dictionary = mdl.p
	var ex: float = cx + p.earth.x * k
	var ey: float = cy - p.earth.y * k
	var mx: float = cx + p.mars.x * k
	var my: float = cy - p.mars.y * k
	# faint range rings every 0.5 AU, so distances can be read off the picture
	var faint := Color(140 / 255.0, 160 / 255.0, 210 / 255.0, 0.1)
	for au in [0.5, 1.0, 1.5]:
		Paint.circle(ci, cx, cy, au * k, faint, 1)
	Paint.line(ci, cx - r, cy, cx + r, cy, faint, 1)
	Paint.line(ci, cx, cy - r, cx, cy + r, faint, 1)
	for pl in [["earth", Color(EARTH, 0.45)], ["mars", Color(MARS, 0.45)]]:
		var pts := PackedVector2Array()
		for q in P[pl[0]]:
			pts.append(Vector2(cx + q.x * k, cy - q.y * k))
		ci.draw_polyline(pts, pl[1], 1.2, true)
	# the Sun
	Paint.radial(ci, cx, cy, r * 0.09, [[0.0, Color("#fff8d6")], [0.5, SUN], [1.0, Color(SUN, 0)]])
	# the link line, with a pulse travelling along it while a message is in flight
	var live: bool = mdl.dish and not mdl.dishBroken
	_dash(ci, Vector2(ex, ey), Vector2(mx, my), Color(INK, 0.5 if live else 0.14), 1.2, 4, 5, t * 6)
	if mdl.cur and not mdl.moon:
		var up: bool = mdl.cur.dir == "up"
		var a := Vector2(mx, my) if up else Vector2(ex, ey)
		var b := Vector2(ex, ey) if up else Vector2(mx, my)
		for i in 4:
			var q := _clamp(mdl.prog - i * 0.035, 0, 1)
			var pp := a.lerp(b, q)
			Paint.circle(ci, pp.x, pp.y, (2.2 if i else 3.6) * scale, Color(1, 1, 1, 0.45 - i * 0.1) if i else Color.WHITE)
	# planets (Mars drawn a touch bigger than true scale so it reads at a distance)
	var pr := r * 0.055 * scale
	Paint.circle(ci, ex, ey, pr * 1.9, Color(EARTH, 0.22))
	Paint.circle(ci, ex, ey, pr, EARTH)
	Paint.circle(ci, mx, my, pr * 0.8, MARS)
	if mdl.moon:
		Paint.circle(ci, ex + pr * 1.6, ey - pr * 1.1, pr * 0.3, Color("#d8dbe6"))
	var fs := roundi(r * 0.11)
	Paint.text(ci, "Earth", ex + (-pr * 1.6 if ex < cx else pr * 1.6), ey, fs, EARTH, "right" if ex < cx else "left", 600, FONT)
	Paint.text(ci, "Mars", mx + (-pr * 1.5 if mx < cx else pr * 1.5), my, fs, MARS, "right" if mx < cx else "left", 600, FONT)
	# "you are here"
	var hx := ex if mdl.moon else mx
	var hy := ey if mdl.moon else my
	Paint.circle(ci, hx, hy, pr * 2.4, Color(1, 1, 1, 0.5 + sin(t * 3) * 0.25), 1.2)


# ---------- the radio queue ----------
# kind: "status" | "help" | "repair" | "storm". Every message to Earth takes one light-trip; the answer takes
# another. The real minutes are shown; the clock runs in the game's compressed seconds.
static func _arrival(s: Dictionary, t1: float) -> Dictionary:
	if t1 <= float(s.dayLength) - 0.5:
		return { "sol": s.sol, "t": t1 }
	return { "sol": s.sol + 1, "t": 6.0 }                 # still travelling when the crew sleeps: it is there in the morning


func can_send(s: Dictionary) -> Dictionary:
	if not _t(s.m.comms.get("on")):
		return { "ok": false, "msg": "The Radio Dish is broken. No link to Earth until it is fixed." if _t(s.m.comms.get("broken")) else "The Radio Dish has no power. Plug a power cell into its socket to open the link." }
	return { "ok": true }


func send(s: Dictionary, kind: String, text: String, opts: Dictionary = {}) -> Dictionary:
	var can := can_send(s)
	if not can.ok:
		return can
	var b := _box(s)
	var mdl := model(s)
	var ow: float = mdl.oneWaySec
	var a1 := _arrival(s, float(s.t) + ow)
	b.seq += 1
	var up := { "id": b.seq, "kind": kind, "dir": "up", "from": "OUTPOST-01", "text": text, "sol": s.sol, "t0": float(s.t), "sol1": a1.sol, "t1": a1.t, "state": "transit", "minutes": mdl.minutes }
	b.log.append(up)
	# the answer starts back the moment the message lands on Earth
	var t2: float = float(opts.replyAt) if opts.get("replyAt") != null else a1.t + ow
	var a2 := _arrival(s, t2) if a1.sol == s.sol else { "sol": a1.sol, "t": a1.t + ow }
	b.seq += 1
	var down := { "id": b.seq, "kind": kind, "dir": "down", "from": "HOUSTON", "text": null, "icon": "📻", "sol": a1.sol, "t0": a1.t, "sol1": a2.sol, "t1": a2.t, "state": "queued",
		"silent": _t(opts.get("silent")), "minutes": mdl.minutes, "re": up.id }
	b.log.append(down)
	log_event(s, "📡", "Sent to Earth: " + text, 0)
	if b.log.size() > 24:
		b.log = b.log.slice(b.log.size() - 24)
	return { "ok": true, "msg": up, "reply": down, "oneWay": mdl.minutes, "oneWaySec": ow }


# Houston's answer is written when it arrives, from the state of the outpost at that moment.
static func _stale_now(s: Dictionary) -> bool:
	return Sim.stale(s) > 1


func _reply_text(s: Dictionary, kind: String) -> String:
	var R: Dictionary = Data.RULES
	var low := []
	if float(Js.orv(s.get("leak"), 0)) > 0:
		low.append("seal that leak first")
	if _stale_now(s):
		low.append("bake the CO₂ filter clean at the Air Scrubber")
	if s.get("water") != null and float(s.water) < float(R.get("waterWarn", 25)):
		low.append("water is low: an ice chunk in the tank")
	if float(s.air) < 30:
		low.append("air is your priority: cell plus ice in the Air Maker")
	if not (s.sol >= s.totalSols) and float(s.food) < Sim.dinner(s):
		low.append("tonight's dinner is not covered: harvest or plant now")
	if float(s.dose) >= 60:
		low.append("badge is high: more soil bags on the dome before the next storm")
	var ph: String = Sim.storm_phase(s)
	if kind == "storm":
		return "Houston copies. Stay inside until the all-clear" + (" — and we see it has passed, good work" if ph == "over" else "") + ". Your shielding is at " + str(roundi(Sim.shield(s) * 100)) + "%; every bag on the dome counts for the next one."
	if kind == "help":
		if low.size():
			return "Houston copies your request. Our recommendation, in order: " + "; ".join(low) + ". You are the one on site, Commander: your call."
		return "Houston copies. From here every system reads nominal. Keep the dish powered and we will keep watching the Sun for you."
	return "Houston copies your status: air " + str(_pct(s.air)) + "%, food " + str(_pct(s.food)) + "%, badge " + str(_pct(s.dose)) + "%" + ((". One note: " + str(low[0]) + ".") if low.size() else ". Looking good from here.")


## Called every frame by the game (only while a mission runs). ctx: { s, onReply }
func update(_dt: float, ctx: Dictionary) -> void:
	var s = ctx.get("s")
	if not (s is Dictionary):
		return
	var b := _box(s)
	var now_sol: int = s.sol
	var now_t: float = s.t
	for m in b.log:
		if m.state == "queued" and (m.sol < now_sol or (m.sol == now_sol and now_t >= m.t0)):
			m.state = "transit"
		if m.state == "transit" and (m.sol1 < now_sol or (m.sol1 == now_sol and now_t >= m.t1)):
			m.state = "received"
			if m.dir == "up":
				log_event(s, "🌍", "Earth received your message (" + mmss(m.minutes) + " later).", 0)
			else:
				if m.text == null:
					m.text = _reply_text(s, m.kind)
				log_event(s, "📻", "Houston: " + str(m.text), 0)
				var cb = ctx.get("onReply")
				if not m.silent and cb is Callable and cb.is_valid():
					cb.call(m)
	var fl = b.flash
	if fl is Dictionary and (fl.sol < s.sol or float(s.t) > fl.until):
		b.flash = null


# ---------- the mission log ----------
func log_event(s: Dictionary, icon: String, text: String, lvl: int = 0) -> void:
	var b := _box(s)
	b.events.append({ "sol": s.sol, "t": float(s.t), "icon": icon, "text": text, "lvl": lvl })
	if b.events.size() > 40:
		b.events.pop_front()


func flash(s: Dictionary, icon: String, text: String, secs := 25.0) -> void:
	_box(s).flash = { "icon": icon, "text": text, "sol": s.sol, "until": float(s.t) + secs }


static func _mach(id) -> String:
	return str(Data.MACHINES.get(id, {}).get("name", str(id)))


## Events from the rules (game handle_events). Returns a cutaway request for the big ones, or null.
func event(e: Dictionary, s: Dictionary):
	var type: String = e.get("type", "")
	if type == "storm":
		if e.phase == "warning":
			var on := _t(s.m.comms.get("on"))
			var msg := "Solar storm warning received. Crew moving to shelter." if on else "Increased radiation detected on suit sensor. Requesting guidance."
			log_event(s, "🌩️", "Earth: solar flare detected. Radiation storm inbound." if on else "Suit sensor: radiation rising. No warning from Earth (dish off).", 2)
			var r := send(s, "storm", msg)
			return { "kind": "alert", "title": "RADIATION STORM INBOUND", "text": msg, "sent": r.ok, "dur": 7.5 }
		if e.phase == "active":
			log_event(s, "☢️", "Radiation storm hitting the outpost.", 2)
			return null
		log_event(s, "✅", "Storm passed. All clear.", 0)
		flash(s, "✅", "ALL CLEAR · storm has passed", 20)
		return null
	if type == "break":
		var rep: Dictionary = Data.REPAIRS.get(e.machine, {})
		log_event(s, "⚠️", _mach(e.machine) + " failure: " + str(rep.get("title", "")), 1)
		return { "kind": "fault", "title": "SYSTEM FAULT · " + _mach(e.machine).to_upper(), "text": str(rep.get("title", "")) + " Repair on site, or request the procedure from Earth.", "dur": 6.0 }
	if type == "advice":
		log_event(s, "📻", "Houston: repair procedure for the " + _mach(e.machine) + " received.", 0)
		return { "kind": "reply", "title": "EARTH REPLY RECEIVED", "text": "HOUSTON: Procedure for the " + _mach(e.machine) + " attached. Go back to the machine to finish the repair.", "dur": 6.0 }
	if type == "daygoal":
		var g := str(s.get("day", {}).get("goal", {}).get("text", ""))
		log_event(s, "🎯", "Daily challenge complete: " + g, 0)
		flash(s, "🎯", "MILESTONE · " + g, 25)
		return null
	if type == "discovery":
		log_event(s, "🔬", "Lab result: " + str(e.get("find", {}).get("title", "")), 0)
		return null
	if type == "crisis":
		var v = Crisis.view(s)
		log_event(s, "🚨", "Crisis: " + (str(v.get("title", "")) if v is Dictionary else ""), 2)
		return null
	if type == "consequence":
		var tone: String = e.get("tone", "")
		log_event(s, "🟥" if tone == "bad" else ("🟩" if tone == "good" else "🟨"), str(e.text), 1 if tone == "bad" else 0)
		return null
	if type == "fail":
		log_event(s, "🛑", "ABORT: " + str(Data.FAIL.get(e.reason, {}).get("title", e.reason)), 2)
		return null
	if type == "devil" and e.get("phase") == "clean" and float(e.get("gain", 0)) > 0.01:
		log_event(s, "🌪️", "Dust devil crossed the solar field: +" + str(roundi(e.gain * 100)) + "% panel power.", 0)
		return null
	return null


## The repair call from the toolbox (Sim.ask_earth) goes through the same radio so the screens show it.
func repair_sent(s: Dictionary) -> void:
	var g = s.get("glitch")
	if not g:
		return
	send(s, "repair", "Requesting repair procedure for the " + _mach(g.machine) + ".", { "silent": true, "replyAt": g.get("replyAt") })


func milestone(s: Dictionary, icon: String, text: String) -> void:
	log_event(s, icon, text, 0)
	flash(s, icon, text, 25)


# ---------- what the room reacts to ----------
## lvl 0 nominal · 1 caution (a fault, stale air, a thin margin) · 2 alarm (storm, leak, near-abort)
func alert(s: Dictionary) -> Dictionary:
	var ph: String = Sim.storm_phase(s)
	var m: Dictionary = s.m
	if ph == "warning" or ph == "active":
		return { "lvl": 2, "text": "RADIATION STORM · STAY INSIDE" if ph == "active" else "STORM INBOUND · SHELTER" }
	if float(Js.orv(s.get("leak"), 0)) > 0:
		return { "lvl": 2, "text": "HULL LEAK · AIR ESCAPING" }
	if float(s.air) < 15 or float(s.dose) >= 85:
		return { "lvl": 2, "text": "AIR CRITICAL" if float(s.air) < 15 else "RADIATION LIMIT NEAR" }
	var broken := []
	for k in ["air", "food", "lab"]:
		if m.has(k) and _t(m[k].get("broken")):
			broken.append(k)
	if _t(s.rack.get("broken")):
		broken.append("rack")
	if broken.size():
		return { "lvl": 1, "text": "FAULT · " + _mach(broken[0]).to_upper() }
	if _stale_now(s):
		return { "lvl": 1, "text": "CO₂ HIGH · FILTER FULL" }
	if s.get("water") != null and float(s.water) <= 0:
		return { "lvl": 1, "text": "WATER TANK EMPTY" }
	if float(s.air) < 30:
		return { "lvl": 1, "text": "AIR LOW" }
	if s.sol < s.totalSols and float(s.food) < Sim.dinner(s):
		return { "lvl": 1, "text": "FOOD SHORT FOR DINNER" }
	return { "lvl": 0, "text": "ALL SYSTEMS NOMINAL" }


func power(s: Dictionary) -> Dictionary:
	var m: Dictionary = s.m
	var loads := (1 if m.air.power > 0 else 0) + (1 if m.food.lamp > 0 else 0) + (1 if m.lab.power > 0 else 0) + (1 if _t(m.comms.get("on")) else 0)
	var reserve: float = float(s.rack.cells) + float(s.rack.charge)
	return { "reserve": reserve, "cells": s.rack.cells, "charge": float(s.rack.charge), "loads": loads, "low": reserve < 0.35 and loads == 0, "eff": s.rack.eff, "sun": float(s.get("cellsToday", 0)) }


# =====================================================================
#  the screens in the 3D room
# =====================================================================
static func _header(ci: CanvasItem, w: float, title: String, right: String, lvl: int) -> void:
	var bgc := Color(BAD, 0.9) if lvl == 2 else (Color(AMBER, 0.85) if lvl == 1 else Color(AIR, 0.18))
	Paint.rect(ci, 0, 0, w, 44, bgc)
	var dark := Color("#140a10")
	Paint.text(ci, title, 18, 22, 22, dark if lvl else AIR, "left", 700, FONT, w * 0.62)
	if right != "":
		Paint.text(ci, right, w - 18, 22, 18, dark if lvl else MUTED, "right", 600, MONO, w * 0.36)


static func _bar(ci: CanvasItem, x: float, y: float, w: float, v: float, color: Color, label: String, value: String) -> void:
	Paint.text(ci, label, x, y, 19, INK, "left", 600, FONT, w * 0.62)
	Paint.text(ci, value, x + w, y, 19, INK, "right", 700, MONO)
	Paint.rrect(ci, x, y + 14, w, 10, 5, Color(1, 1, 1, 0.08))
	Paint.rrect(ci, x, y + 14, maxf(10, w * _clamp(v, 0, 1)), 10, 5, color)


static func _led(ci: CanvasItem, x: float, y: float, on: bool, color: Color, label: String, max_w := 0.0) -> void:
	Paint.circle(ci, x, y, 6, color if on else Color(1, 1, 1, 0.12))
	Paint.text(ci, label, x + 14, y, 17, INK, "left", 600, FONT, max_w)


## wrapped text, one line every lh pixels, at most max lines; returns the lines used
static func _wrap(ci: CanvasItem, text: String, x: float, y: float, w: float, lh: float, size: int, color: Color, max_lines := 0, family := FONT, weight := 500) -> int:
	var words := text.split(" ")
	var line := ""
	var n := 0
	for word in words:
		var test := word if line == "" else line + " " + word
		if Paint.text_width(test, size, weight, family) > w and line != "":
			Paint.text(ci, line, x, y + n * lh, size, color, "left", weight, family)
			line = word
			n += 1
			if max_lines and n >= max_lines:
				return n
		else:
			line = test
	if line != "":
		Paint.text(ci, line, x, y + n * lh, size, color, "left", weight, family)
		n += 1
	return n


static func _bg(ci: CanvasItem, w: float, h: float) -> void:
	Paint.vgrad(ci, 0, 0, w, h, Color("#0a1222"), Color("#060b17"))
	var y := 0.0
	while y < h:
		Paint.rect(ci, 0, y, w, 1, Color(1, 1, 1, 0.025))         # a faint scan texture
		y += 4


## the panoramic Mission Control display: orbit link · comms · log
func _draw_main(ci: CanvasItem, w: float, h: float, s: Dictionary, t: float) -> void:
	var mdl := model(s)
	var al := alert(s)
	var b := _box(s)
	_bg(ci, w, h)
	_header(ci, w, "MISSION CONTROL · OUTPOST-01 · " + ("MOON" if mdl.moon else "MARS"), _dw(s) + " " + str(s.sol) + " · " + _today(s), al.lvl)
	# left: the instrument
	var ox := w * 0.2
	var oy := 44 + (h - 44) * 0.47
	var orad := minf(w * 0.17, (h - 44) * 0.4)
	Paint.text(ci, "EARTH–MOON LINK · 384,400 KM" if mdl.moon else "EARTH–MARS LINK · " + str(roundi(mdl.p.km / 1e6)) + " MILLION KM", ox, 62, 15, MUTED, "center", 600, MONO, w * 0.38)
	draw_orbit(ci, ox, oy + 8, orad, mdl, t, { "scale": 1.0 })
	Paint.text(ci, "mean orbits · about ±3%", ox, h - 14, 13, MUTED, "center", 500, MONO)
	# middle: the link
	var lx := w * 0.42
	var lw := w * 0.3
	var up: bool = mdl.cur != null and mdl.cur.dir == "up"
	Paint.text(ci, "MOON → EARTH" if mdl.moon else ("MARS → EARTH" if up else ("EARTH → MARS" if mdl.cur else "ONE-WAY LIGHT TIME")), lx, 66, 15, MUTED, "left", 600, MONO)
	Paint.text(ci, "1.3 s" if mdl.moon else mmss(mdl.minutes), lx, 106, 48, INK, "left", 700, MONO)
	var status: String
	var sc: Color
	if not mdl.dish:
		status = "DISH FAULT · NO LINK" if mdl.dishBroken else "DISH UNPOWERED · NO LINK"
		sc = BAD
	elif mdl.cur:
		status = "SIGNAL IN TRANSIT · " + str(roundi(mdl.prog * 100)) + "%"
		sc = POWER
	else:
		status = "LINK OPEN · LISTENING"
		sc = OK
	Paint.circle(ci, lx + 7, 148, 6, sc)
	Paint.text(ci, status, lx + 20, 148, 17, sc, "left", 700, MONO, lw - 20)
	Paint.rrect(ci, lx, 164, lw, 8, 4, Color(1, 1, 1, 0.08))
	if mdl.cur:
		Paint.rrect(ci, lx, 164, maxf(8, lw * mdl.prog), 8, 4, POWER)
	var last = null
	for i in range(b.log.size() - 1, -1, -1):
		if b.log[i].state != "queued":
			last = b.log[i]
			break
	Paint.text(ci, "LAST TRANSMISSION", lx, 196, 14, MUTED, "left", 600, MONO)
	var lt := "No transmissions yet this mission."
	if last:
		lt = ("OUTPOST-01: " if last.dir == "up" else "HOUSTON: ") + (str(last.text) if last.text != null else "…")
	_wrap(ci, lt, lx, 218, lw, 20, 16, INK, 3)
	Paint.text(ci, "PENDING " + str(mdl.pending) + "  ·  " + ("NEAR-INSTANT LINK" if mdl.moon else "MARS–EARTH: " + str(mdl.align).to_upper()), lx, h - 22, 14, MUTED, "left", 600, MONO, w * 0.56)
	# right: the log
	var rx := w * 0.75
	var rw := w * 0.23
	Paint.text(ci, "MISSION LOG", rx, 66, 15, MUTED, "left", 600, MONO)
	var y := 92.0
	if b.events.is_empty():
		Paint.text(ci, "Quiet so far.", rx, y, 15, MUTED, "left", 500)
	var ev: Array = b.events.slice(maxi(0, b.events.size() - 6))
	ev.reverse()
	for e in ev:
		if y > h - 60:
			break
		var col := BAD if e.lvl == 2 else (AMBER if e.lvl == 1 else INK)
		var n := _wrap(ci, str(e.icon) + " " + str(e.text), rx, y, rw, 18, 15, col, 2)
		y += n * 18 + 6
	# a milestone or an alert banner across the bottom
	if b.flash or al.lvl:
		var fl: bool = b.flash != null and not al.lvl
		var text: String = (str(b.flash.icon) + " " + str(b.flash.text)) if fl else al.text
		var col2 := OK if fl else (BAD if al.lvl == 2 else AMBER)
		var pulse := (0.6 + sin(t * 6) * 0.3) if al.lvl == 2 else 0.85
		Paint.rect(ci, w * 0.4, h - 48, w * 0.6, 48, Color(col2, 0.18 * pulse))
		Paint.text(ci, text, w - 18, h - 24, 20, col2, "right", 700, MONO, w * 0.56)


static func _growing(m: Dictionary) -> int:
	var n := 0
	for bd in m.food.beds:
		if bd.state == "growing" or bd.state == "ripe":
			n += 1
	return n


static func _water_k(s: Dictionary) -> float:
	if s.get("water") != null:
		return _clamp(float(s.water) / 100.0, 0, 1)
	return _clamp(float(s.m.food.get("water", 0)) / float(Data.RULES.get("waterSols", 1)), 0, 1)


func _draw_life(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	var m: Dictionary = s.m
	var al := alert(s)
	var beds: Array = m.food.beds
	var growing := _growing(m)
	var hot: bool = al.lvl and (al.text.contains("AIR") or al.text.contains("LEAK") or al.text.contains("CO"))
	_bg(ci, w, h)
	_header(ci, w, "LIFE SUPPORT", al.text if hot else "ECLSS", al.lvl if hot else 0)
	var x := 22.0
	var bw := w - 44
	var st: float = Sim.stale(s)
	var stale := st > 1
	var leak := float(Js.orv(s.get("leak"), 0))
	var need: float = Sim.air_drain(s) * st + leak
	_bar(ci, x, 78, bw, float(s.air) / 100, AIR, "AIR", str(_pct(s.air)) + "%")
	Paint.text(ci, "crew draws " + str(roundi(need)) + " per shift" + (" · LEAK" if leak > 0 else ""), x, 114, 14, MUTED, "left", 500, MONO)
	var filt = null if s.get("filter") == null else _clamp(float(s.filter), 0, 100)
	var fwarn := float(Data.RULES.get("filterWarn", 30))
	_led(ci, x + 6, 146, true, BAD if stale else (AMBER if filt != null and filt < fwarn else OK), "CO₂ filter · " + ("FULL — air going stale" if stale else (str(roundi(filt)) + "% clean" if filt != null else "nominal")), bw - 20)
	var water := _water_k(s)
	_bar(ci, x, 184, bw, water, WATER, "WATER TANK (crew + plants)", str(roundi(water * 100)) + "%")
	_led(ci, x + 6, 234, growing > 0, FOOD, "Greenhouse · " + str(growing) + " of " + str(beds.size()) + " beds growing" + (" · lamps off" if m.food.lamp <= 0 and growing else (" · no water" if water <= 0 and growing else "")), bw - 20)
	var air_txt := "FAULT" if _t(m.air.get("broken")) else ("running · " + str(m.air.get("queue", 0)) + " ice queued" if m.air.power > 0 else "unpowered")
	_led(ci, x + 6, 262, true, BAD if _t(m.air.get("broken")) else (OK if m.air.power > 0 else AMBER), "Air Maker · " + air_txt, bw - 20)
	Paint.text(ci, "FOOD STORE " + str(_pct(s.food)) + "% · dinner −" + str(Js.num(Sim.dinner(s))), x, h - 16, 13, MUTED, "left", 500, MONO)


static func _rover_cap(s: Dictionary) -> float:
	return maxf(1, Sim.rover_cap(s))


func _draw_power(ci: CanvasItem, w: float, h: float, s: Dictionary) -> void:
	var m: Dictionary = s.m
	var pw := power(s)
	_bg(ci, w, h)
	_header(ci, w, "POWER", "REDUCED POWER" if pw.low else "NOMINAL", 1 if pw.low else 0)
	var x := 22.0
	var bw := w - 44
	_bar(ci, x, 78, bw, _clamp(pw.sun / 8.0, 0, 1), POWER, "SUNLIGHT TODAY", "≈" + str(roundi(pw.sun)) + " cells")
	_bar(ci, x, 124, bw, pw.charge, POWER, "RACK · charging cell", str(roundi(pw.charge * 100)) + "%")
	Paint.text(ci, "CELLS READY", x, 162, 14, MUTED, "left", 500, MONO)
	var rmax := int(Data.RULES.get("rackMax", 4))
	for i in rmax:
		Paint.rrect(ci, x + 110 + i * 34, 154, 26, 16, 4, POWER if i < int(pw.cells) else Color(1, 1, 1, 0.1))
	Paint.text(ci, "PANELS", x, 188, 14, MUTED, "left", 500, MONO)
	var k := 0
	for e in pw.eff:
		var ef := float(e)
		Paint.rrect(ci, x + 110 + k * 90, 182, 80, 12, 6, Color(1, 1, 1, 0.08))
		Paint.rrect(ci, x + 110 + k * 90, 182, maxf(8, 80 * ef), 12, 6, OK if ef > 0.85 else (AMBER if ef > 0.65 else BAD))
		k += 1
	var loads := [["Air Maker", m.air.power > 0, _t(m.air.get("broken"))], ["Greenhouse lamps", m.food.lamp > 0, _t(m.food.get("broken"))], ["Science Lab", m.lab.power > 0, _t(m.lab.get("broken"))],
		["Soil Bagger", m.bag.pending > 0, _t(m.bag.get("broken"))], ["Radio Dish", _t(m.comms.get("on")), _t(m.comms.get("broken"))]]
	for i in loads.size():
		var L: Array = loads[i]
		var cx := x + (i % 2) * (bw / 2)
		var cy := 222.0 + (i / 2) * 26
		_led(ci, cx + 6, cy, L[1] or L[2], BAD if L[2] else OK, str(L[0]) + (" · FAULT" if L[2] else ("" if L[1] else " · off")), bw / 2 - 24)
	Paint.text(ci, "ROVER BATTERY " + str(roundi(float(m.rover.charge) / _rover_cap(s) * 100)) + "%", x, h - 16, 13, MUTED, "left", 500, MONO)


func _env_look(s: Dictionary) -> Dictionary:
	var env: Dictionary = Sim.env(s)
	var envs: Dictionary = s.site.get("env", {})
	return envs.get(env.get("kind", ""), { "icon": "🌤️", "label": "Clear", "why": "" })


func _forecast_text(s: Dictionary) -> String:
	var wx = Sim.weather(s)
	if _t(s.get("forecast")):
		var lv := int(wx.get("level", 0)) if wx is Dictionary else 0
		return (["", "Small", "Medium", "BIG"][clampi(lv, 0, 3)] + " solar storm expected today") if lv else "Quiet Sun today"
	return "No forecast (dish was off)"


func _draw_env(ci: CanvasItem, w: float, h: float, s: Dictionary, _t2: float) -> void:
	var ph: String = Sim.storm_phase(s)
	var look := _env_look(s)
	var lvl := 2 if (ph == "active" or ph == "warning") else (1 if float(s.dose) >= 75 else 0)
	_bg(ci, w, h)
	_header(ci, w, "SCIENCE · ENVIRONMENT", "STORM NOW" if ph == "active" else ("STORM INBOUND" if ph == "warning" else str(look.label).to_upper()), lvl)
	var x := 22.0
	var bw := w - 44
	var sh: float = Sim.shield(s)
	_bar(ci, x, 78, bw, float(s.dose) / 100, DOSE, "RADIATION BADGE", str(_pct(s.dose)) + "%")
	_bar(ci, x, 124, bw, sh, SHIELD, "DOME SHIELDING", str(roundi(sh * 100)) + "% · " + str(s.bags) + "/" + str(Data.RULES.get("shieldSlots", 16)) + " bags")
	Paint.text(ci, "SPACE WEATHER", x, 168, 14, MUTED, "left", 600, MONO)
	var line := "Radiation storm in progress" if ph == "active" else ("Storm arriving · get inside" if ph == "warning" else ("Storm passed · all clear" if ph == "over" else _forecast_text(s)))
	Paint.text(ci, line, x, 190, 20, BAD if (ph == "active" or ph == "warning") else INK, "left", 700, FONT, bw)
	Paint.text(ci, "SURFACE", x, 236, 14, MUTED, "left", 600, MONO)
	Paint.text(ci, str(look.icon) + " " + str(look.label) + " · ≈" + str(roundi(float(s.get("cellsToday", 0)))) + " cells of sun", x, 256, 18, INK, "left", 600, FONT, bw)
	var parts := []
	for d in Data.INSTRUMENTS.get(s.site.id, []):
		parts.append(("● " if s.inst.get(d.id) else "○ ") + str(d.name))
	Paint.text(ci, "INSTRUMENTS  " + "   ".join(parts), x, h - 16, 13, MUTED, "left", 500, MONO, bw)


func screen(id: String, ci: CanvasItem, w: float, h: float, s: Dictionary, t: float) -> void:
	match id:
		"main": _draw_main(ci, w, h, s, t)
		"life": _draw_life(ci, w, h, s)
		"power": _draw_power(ci, w, h, s)
		"env": _draw_env(ci, w, h, s, t)


# =====================================================================
#  the station cards
# =====================================================================
static func _row(icon: String, title: String, text: String, cls := "") -> String:
	return "<div class=\"info-row" + (" " + cls if cls != "" else "") + "\"><span class=\"ic\">" + icon + "</span><div><b>" + Html.esc(title) + "</b><p>" + Html.esc(text) + "</p></div></div>"


func _meter(label: String, v: float, color: Color, value: String) -> String:
	var id := "mc-mtr-" + str(_meters.size())
	_meters.append({ "id": id, "label": label, "v": _clamp(v, 0, 1), "color": color, "value": value })
	return "<canvas id=\"" + id + "\" width=\"300\" height=\"34\"></canvas>"


static func _clock_text(t: float) -> String:
	return str(int(t / 60)) + ":" + ("%02d" % int(fmod(t, 60)))


func _log_html(s: Dictionary, n: int) -> String:
	var evs: Array = _box(s).events
	var ev: Array = evs.slice(maxi(0, evs.size() - n))
	ev.reverse()
	if ev.is_empty():
		return "<p class=\"sub\">Nothing logged yet. Storms, faults, calls to Earth and milestones will appear here.</p>"
	var out := "<ul class=\"harder\">"
	for e in ev:
		var col := "#ff5468" if e.lvl == 2 else ("#ffb347" if e.lvl == 1 else "#eaf0ff")
		out += "<li><span>" + _dw(s).substr(0, 1) + str(e.sol) + " " + _clock_text(e.t) + "</span><span style=\"color:" + col + "\">" + Html.esc(str(e.icon) + " " + str(e.text)) + "</span></li>"
	return out + "</ul>"


func _comms_html(s: Dictionary, mdl: Dictionary) -> String:
	var b := _box(s)
	var last = null
	for i in range(b.log.size() - 1, -1, -1):
		if b.log[i].state != "queued":
			last = b.log[i]
			break
	var status: String
	if not mdl.dish:
		status = "<span style=\"color:#ff5468\">NO LINK · " + ("dish fault" if mdl.dishBroken else "dish unpowered") + "</span>"
	elif mdl.cur:
		status = "<span style=\"color:#ffd23f\">SIGNAL IN TRANSIT · " + ("to Earth" if mdl.cur.dir == "up" else "from Earth") + " · " + str(roundi(mdl.prog * 100)) + "%</span>"
	else:
		status = "<span style=\"color:#4dff9a\">LINK OPEN · listening</span>"
	var last_txt := "none"
	if last:
		last_txt = Html.esc((("you → Earth: " if last.dir == "up" else "Earth → you: ") + (str(last.text) if last.text != null else "…")).substr(0, 90))
	return "<div class=\"mc-row\"><div><p class=\"sub\">" + ("MOON → EARTH" if mdl.moon else "ONE-WAY LIGHT TIME") + "</p><h2>" + ("1.3 s" if mdl.moon else mmss(mdl.minutes)) + "</h2><p class=\"sub\">" + \
		("384,400 km" if mdl.moon else str(roundi(mdl.p.km / 1e6)) + " million km · " + str(mdl.align)) + "</p></div>" + \
		"<div><p class=\"sub\">STATUS</p><p><b>" + status + "</b></p><p class=\"sub\">pending " + str(mdl.pending) + " · last: " + last_txt + "</p></div></div>"


## ctx: { s, weather, onSend(result, kind) }
func open(id: String, ctx: Dictionary) -> void:
	var s: Dictionary = ctx.s
	var mdl := model(s)
	var R: Dictionary = Data.RULES
	var actions := {}
	_meters = []
	var close_btn := func() -> String:
		return "<div class=\"modal-actions\">" + ("<button class=\"btn ghost\" data-act=\"sun\">☀️ Sun Watch</button>" if id == "console" and Game.has_addon("sunwatch") else "") + \
			"<button class=\"btn primary\" data-act=\"ok\">Back to the room</button></div>"
	actions.ok = func():
		Au.play("tap")
		Ui.close_modal()
	var html := ""
	if id == "console":
		var can := can_send(s)
		var dis := "" if can.ok else " disabled"
		var broken: bool = s.get("glitch") is Dictionary and s.glitch.get("state") == "broken"
		html = "<div class=\"mc-card\"><div class=\"mc-head\"><p class=\"sub\">📻 Mission Control workstation</p><h2>Earth link</h2></div>" + \
			"<canvas id=\"mc-orbit\" width=\"640\" height=\"340\"></canvas>" + _comms_html(s, mdl) + \
			"<p class=\"sub\">Radio travels at the speed of light, and light still needs " + ("1.3 seconds to reach the Moon" if mdl.moon else mmss(mdl.minutes) + " to cross " + str(roundi(mdl.p.km / 1e6)) + " million km") + \
			". Every message waits that long each way. Positions come from the mean orbits of the planets for today's real date, about ±3%.</p>" + \
			"<h3>Transmit</h3><div class=\"mc-actions\">" + \
			"<button class=\"opt\" data-act=\"status\"" + dis + "><b>📨 Send status report</b><span>Air, food and radiation readings. Houston answers after a full round trip.</span></button>" + \
			"<button class=\"opt\" data-act=\"help\"" + dis + "><b>🆘 Request guidance</b><span>" + ("A machine is broken: Earth will send the repair procedure." if broken else "Ask Earth what to fix first. The answer takes two light-trips.") + "</span></button></div>" + \
			("" if can.ok else "<p class=\"sub\" style=\"color:#ff5468\">" + Html.esc(can.msg) + "</p>") + \
			"<h3>Mission log</h3>" + _log_html(s, 8) + close_btn.call() + "</div>"
		actions.sun = func():
			Au.play("tap")
			Ui.close_modal()
			Game.ext("sunwatch", "open", [s, ctx.get("weather")])
		actions.status = func():
			var r := send(s, "status", "Status report: air " + str(_pct(s.air)) + "%, food " + str(_pct(s.food)) + "%, radiation badge " + str(_pct(s.dose)) + "%. Crew nominal.")
			if not r.ok:
				Au.play("deny")
				return
			Ui.close_modal()
			var cb = ctx.get("onSend")
			if cb is Callable and cb.is_valid():
				cb.call(r, "status")
		actions.help = func():
			var r: Dictionary
			if s.get("glitch") is Dictionary and s.glitch.get("state") == "broken":
				var a: Dictionary = Sim.ask_earth(s)
				if not a.ok:
					Au.play("deny")
					return
				repair_sent(s)
				var lg: Array = _box(s).log
				r = { "ok": true, "msg": lg[lg.size() - 2], "oneWay": mdl.minutes }
			else:
				r = send(s, "help", "Requesting guidance: which system should the crew prioritise?")
				if not r.ok:
					Au.play("deny")
					return
			Ui.close_modal()
			var cb = ctx.get("onSend")
			if cb is Callable and cb.is_valid():
				cb.call(r, "help")
	elif id == "life":
		var m: Dictionary = s.m
		var st: float = Sim.stale(s)
		var stale := st > 1
		var leak := float(Js.orv(s.get("leak"), 0))
		var need: float = Sim.air_drain(s) * st + leak
		var left := maxf(0, 1 - float(s.t) / float(s.dayLength))
		var growing := _growing(m)
		var water := _water_k(s) * 100
		var filt = null if s.get("filter") == null else _clamp(float(s.filter), 0, 100)
		var fwarn := float(R.get("filterWarn", 30))
		var mods = s.get("mods")
		var recycle = roundi(float(mods.recycle) * 100) if mods is Dictionary and mods.get("recycle") != null else null
		html = "<div class=\"mc-card\"><div class=\"mc-head\"><p class=\"sub\">🫁 Life-support station</p><h2>Air, water, food</h2></div>" + \
			_meter("Air", float(s.air) / 100, AIR, str(_pct(s.air)) + "%") + \
			(_meter("CO₂ filter", filt / 100.0, BAD if stale else (AMBER if filt < fwarn else OK), str(roundi(filt)) + "% clean") if filt != null else "") + \
			_meter("Water tank", water / 100, WATER, str(roundi(water)) + "%") + _meter("Food store", float(s.food) / 100, FOOD, str(_pct(s.food)) + "%") + \
			_row("💨", "Crew breathing · " + str(roundi(need * left)) + " air still needed today", "The crew draws about " + str(roundi(need)) + " air per shift" + (", more while the air is stale" if stale else "") + ". The Air Maker turns one ice chunk into " + str(Js.num(Sim.air_per_ice(s))) + " air, but only with a power cell plugged in.", "alert" if float(s.air) < need * left else "good") + \
			_row("🧪", "CO₂ filter · " + ("FULL" if stale else (str(roundi(filt)) + "% clean" if filt != null else "nominal")), "The filter is saturated, carbon dioxide is building up and the tanks must push out extra air. A power cell at the Air Scrubber bakes it clean." if stale else "Every breath out is CO₂. On the Space Station it is soaked up by beds of zeolite that are baked clean and used again; a failed scrubber is one of the fastest ways a cabin becomes dangerous.", "alert" if stale else "") + \
			_row("💧", "Water tank · " + str(roundi(water)) + "%" + (" · recycler returns " + str(recycle) + "%" if recycle != null else ""), "One tank serves the crew and the plants, and only ice adds new water. Plants need light AND water, so every ice chunk is a choice between the Air Maker and this tank. On the Space Station about 98% of water is recycled, even sweat and breath.", "alert" if water <= 0 else "") + \
			_row("🥬", "Greenhouse · " + str(growing) + " of " + str(m.food.beds.size()) + " beds growing", "Dinner tonight costs " + str(Js.num(Sim.dinner(s))) + " food. A bed needs about a full " + _dw(s).to_lower() + " to ripen, so what you plant now is tomorrow's meal, not tonight's.", "alert" if s.sol < s.totalSols and float(s.food) < Sim.dinner(s) else "") + \
			close_btn.call() + "</div>"
	elif id == "power":
		var pw := power(s)
		var mm: Dictionary = s.m
		var rmax := int(R.get("rackMax", 4))
		var effs := ""
		var sum := 0.0
		var k := 0
		for e in pw.eff:
			var ef := float(e)
			sum += ef
			k += 1
			effs += _meter("Panel " + str(k), ef, OK if ef > 0.85 else (AMBER if ef > 0.65 else BAD), str(roundi(ef * 100)) + "%")
		var avg := sum / maxf(1, pw.eff.size())
		html = "<div class=\"mc-card\"><div class=\"mc-head\"><p class=\"sub\">⚡ Power station</p><h2>Generation and loads</h2></div>" + \
			_meter("Sunlight today", pw.sun / 8.0, POWER, "≈" + str(roundi(pw.sun)) + " cells") + _meter("Cell on the rack", pw.charge, POWER, str(roundi(pw.charge * 100)) + "%") + \
			_meter("Cells ready", float(pw.cells) / rmax, POWER, str(pw.cells) + " / " + str(rmax)) + effs + \
			_row("🟠" if pw.low else "🟢", "Reduced power: no reserve and nothing running" if pw.low else ("Power " + (str(pw.loads) + " load" + ("s" if pw.loads > 1 else "") + " running" if pw.loads else "nominal · no loads yet")),
				"Every power cell is one choice. Air Maker, Greenhouse lamps, Lab, Soil Bagger, Radio Dish and the rover all drink from the same rack, and panels stop charging after " + str(roundi(float(R.get("chargeSpan", 0.8)) * 100)) + "% of the shift when the Sun gets low.", "alert" if pw.low else "good") + \
			_row("☀️", "Panels at " + str(roundi(avg * 100)) + "% average", "Dust settles on the glass all day; brush a panel and it is back to 100%. The real Opportunity rover lived 14 years longer than planned because wind gusts cleaned its panels." if s.site.id == "mars" else "The Sun moves across the sky, so a fixed panel slowly loses output. Turn it to face the Sun again and it is back to 100%.") + \
			_row("🚙", "Rover battery " + str(roundi(float(mm.rover.charge) / _rover_cap(s) * 100)) + "%", "The battery only drains while driving. One cell gives " + str(R.get("roverPerCell", 60)) + " seconds of driving.") + \
			close_btn.call() + "</div>"
	else:
		var ph: String = Sim.storm_phase(s)
		var look := _env_look(s)
		var sf: float = Sim.shield(s)
		var fc := _forecast_text(s)
		if _t(s.get("forecast")):
			fc = fc.replace("Quiet Sun today", "Quiet Sun today (forecast from Earth)")
		else:
			fc = "No forecast today (the dish was off)"
		var head_icon := "☢️" if ph == "active" else ("🌩️" if ph == "warning" else ("✅" if ph == "over" else "🌤️"))
		var head := "Radiation storm in progress" if ph == "active" else ("Storm arriving: stay inside" if ph == "warning" else ("Storm passed: all clear" if ph == "over" else fc))
		var body := ("If a storm comes, the Radio Dish gives " + str(R.get("warnDish", 30)) + " s of warning; without it the suit sensor gives only " + str(R.get("warnNoDish", 8)) + " s. Inside, the walls and " + str(s.bags) + " soil bags block " + str(roundi(sf * 100)) + "% of the radiation.") if ph == "none" else \
			("A radiation storm is a flood of fast particles from a solar flare. Inside, the walls and " + str(s.bags) + " soil bags block " + str(roundi(sf * 100)) + "% of it.")
		var insts: Array = Data.INSTRUMENTS.get(s.site.id, [])
		var names := []
		for d in insts:
			names.append(("✓ " if s.inst.get(d.id) else "○ ") + str(d.name))
		html = "<div class=\"mc-card\"><div class=\"mc-head\"><p class=\"sub\">🔭 Science · environment station</p><h2>Radiation and the Sun</h2></div>" + \
			_meter("Radiation badge", float(s.dose) / 100, DOSE, str(_pct(s.dose)) + "%") + _meter("Dome shielding", sf, SHIELD, str(roundi(sf * 100)) + "%") + \
			_row(head_icon, head, body, "alert" if (ph == "active" or ph == "warning") else "") + \
			_row(str(look.icon), str(look.label) + " · about " + str(roundi(float(s.get("cellsToday", 0)))) + " power cells of sunlight", str(look.get("why", ""))) + \
			_row("📡", "Instruments deployed: " + str(s.inst.size()) + " of " + str(insts.size()), " · ".join(names) + ". Each one adds a perk: the radiation sensor lengthens storm warnings; the weather station adds tomorrow's sunlight forecast.") + \
			"<h3>Mission log</h3>" + _log_html(s, 6) + close_btn.call() + "</div>"
	var doc: Html.Doc = Ui.modal(html, { "cls": "wide", "actions": actions })
	# the meters: a label, a bar and a value, drawn on their own little canvases
	for mt in _meters:
		var c: Control = doc.el(mt.id)
		if c == null:
			continue
		c.custom_minimum_size = Vector2(0, 34)
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var d: Dictionary = mt
		c.draw.connect(func(): _draw_meter(c, d))
	# the diagram in the card keeps moving while it is open
	_orbit = doc.el("mc-orbit")
	_orbit_s = s
	_orbit_t0 = Time.get_ticks_msec() / 1000.0
	if _orbit:
		_orbit.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		_orbit.draw.connect(func():
			if _orbit_s == null or not is_instance_valid(_orbit):
				return
			var t := Time.get_ticks_msec() / 1000.0 - _orbit_t0
			var sz := _orbit.size
			Paint.rrect(_orbit, 0, 0, sz.x, sz.y, 14, Color("#060b17"))
			draw_orbit(_orbit, sz.x / 2, sz.y / 2, minf(sz.x, sz.y) * 0.46, model(_orbit_s), t, { "scale": 1.1 }))


static func _draw_meter(c: Control, d: Dictionary) -> void:
	var w := c.size.x
	var lw := minf(170.0, w * 0.3)
	var vw := 120.0
	Paint.text(c, d.label, 0, 17, 16, MUTED, "left", 600, FONT, lw - 8)
	Paint.rrect(c, lw, 11, w - lw - vw, 12, 6, Color(1, 1, 1, 0.08))
	Paint.rrect(c, lw, 11, maxf(12, (w - lw - vw) * d.v), 12, 6, d.color)
	Paint.text(c, d.value, w, 17, 16, INK, "right", 700, FONT, vw - 10)


# =====================================================================
#  the cutaway overlay (the camera move itself is in the game)
# =====================================================================
var _mc: PanelContainer = null
var _mc_hold: VBoxContainer = null
var _mc_box: StyleBoxFlat
var _mc_p := {}
var _mc_fill := 0.0
var _mc_fill_want := 0.0


func _label(size: int, color: Color, family := MONO, weight := 700) -> Label:
	var l := Label.new()
	l.add_theme_font_override("font", Paint.font(weight, family))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _build_overlay() -> void:
	if _mc and is_instance_valid(_mc):
		return
	# a full-screen column that keeps the band at the bottom centre, whatever the window size
	_mc_hold = VBoxContainer.new()
	_mc_hold.name = "MissionOverlay"
	_mc_hold.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_mc_hold.offset_bottom = -26
	_mc_hold.alignment = BoxContainer.ALIGNMENT_END
	_mc_hold.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mc = PanelContainer.new()
	_mc.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_mc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mc_hold.add_child(_mc)
	_mc_box = StyleBoxFlat.new()
	_mc_box.bg_color = Color(5 / 255.0, 10 / 255.0, 24 / 255.0, 0.86)
	_mc_box.set_corner_radius_all(18)
	_mc_box.content_margin_left = 20
	_mc_box.content_margin_right = 20
	_mc_box.content_margin_top = 14
	_mc_box.content_margin_bottom = 12
	_mc_box.shadow_color = Color(0, 0, 0, 0.5)
	_mc_box.shadow_size = 18
	_mc_box.shadow_offset = Vector2(0, 10)
	_mc.add_theme_stylebox_override("panel", _mc_box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 5)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mc.add_child(v)
	_mc_p.from = _label(12, AIR)
	_mc_p.from.text = "📻  MISSION CONTROL — EARTH"
	_mc_p.title = _label(20, INK)
	_mc_p.msg = _label(17, Color("#dfe5ff"), FONT, 400)
	_mc_p.msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var r1 := HBoxContainer.new()
	_mc_p.dir = _label(13, MUTED, MONO, 600)
	_mc_p.dir.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_mc_p.delay = _label(13, MUTED, MONO, 600)
	r1.add_child(_mc_p.dir)
	r1.add_child(_mc_p.delay)
	var bar := Control.new()
	bar.custom_minimum_size = Vector2(0, 8)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.draw.connect(func():
		var w := bar.size.x
		Paint.rrect(bar, 0, 1, w, 6, 3, Color(1, 1, 1, 0.1))
		if _mc_fill > 0.005:
			var fw := maxf(6, w * _mc_fill)
			bar.draw_polygon(PackedVector2Array([Vector2(0, 1), Vector2(fw, 1), Vector2(fw, 7), Vector2(0, 7)]), PackedColorArray([AIR, Color.WHITE, Color.WHITE, AIR])))
	_mc_p.bar = bar
	var r2 := HBoxContainer.new()
	_mc_p.status = _label(13, POWER, MONO, 600)
	_mc_p.status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_mc_p.hint = _label(13, MUTED, MONO, 600)
	_mc_p.hint.text = "E · continue"
	r2.add_child(_mc_p.status)
	r2.add_child(_mc_p.hint)
	for c in [_mc_p.from, _mc_p.title, _mc_p.msg, r1, bar, r2]:
		v.add_child(c)
	_mc_hold.visible = false
	Ui.root.add_child(_mc_hold)


func _place_overlay() -> void:
	var w := minf(640.0, Ui.root.size.x - 32)
	_mc.custom_minimum_size = Vector2(w, 0)
	_mc_p.msg.custom_minimum_size = Vector2(w - 40, 0)       # a known width, so the wrapped text knows its height


## data: { kind: alert|fault|reply|send|console, title, text, msg (a radio entry, optional) }; null hides it
func overlay(data = null, s = null) -> void:
	if data == null:
		if _mc_hold and is_instance_valid(_mc_hold):
			_mc_hold.visible = false
		return
	_build_overlay()
	var mdl = model(s) if s is Dictionary else null
	var msg = data.get("msg")
	if msg == null and mdl:
		msg = mdl.cur
	var kind: String = str(data.get("kind", ""))
	_mc_p.title.text = str(data.get("title")) if data.get("title") else ""
	_mc_p.msg.text = str(data.get("text")) if data.get("text") else ""
	_mc_p.delay.text = ("ONE-WAY DELAY 1.3 s" if mdl.moon else "ESTIMATED ONE-WAY DELAY " + mmss(mdl.minutes)) if mdl else ""
	var dir_text := "LINK OPEN"
	if msg is Dictionary and mdl:
		if msg.get("dir") == "up":
			dir_text = "MOON → EARTH" if mdl.moon else "MARS → EARTH"
		else:
			dir_text = "EARTH → MOON" if mdl.moon else "EARTH → MARS"
	elif mdl and not mdl.dish:
		dir_text = "NO LINK · DISH UNPOWERED"
	_mc_p.dir.text = dir_text
	# the frame and the colours say what kind of message it is
	_mc_box.set_border_width_all(2 if kind in ["alert", "fault"] else 0)
	_mc_box.border_color = BAD if kind == "alert" else AMBER
	_mc_p.from.add_theme_color_override("font_color", Color("#ffa3b1") if kind == "alert" else AIR)
	_mc_p.title.add_theme_color_override("font_color", Color("#ffa3b1") if kind == "alert" else (Color("#ffd9a8") if kind == "fault" else (OK if kind == "reply" else INK)))
	_mc_p.hint.visible = not Game.get("touch") if Game.get("touch") != null else true
	var was: bool = _mc_hold.visible
	_mc_hold.visible = true
	_mc_fill = 0.0
	_place_overlay()
	overlay_frame(s)
	if not was:
		_mc_hold.modulate.a = 0
		_mc_hold.offset_top = 24
		_mc_hold.offset_bottom = -2
		var tw := create_tween().set_parallel(true)
		tw.tween_property(_mc_hold, "modulate:a", 1.0, 0.25)
		tw.tween_property(_mc_hold, "offset_top", 0.0, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_property(_mc_hold, "offset_bottom", -26.0, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func overlay_frame(s = null) -> void:
	if _mc_hold == null or not is_instance_valid(_mc_hold) or not _mc_hold.visible or not (s is Dictionary):
		return
	var mdl := model(s)
	if mdl.cur:
		_mc_fill_want = mdl.prog
		_mc_p.status.text = "SIGNAL IN TRANSIT · " + str(roundi(mdl.prog * 100)) + "%"
	else:
		_mc_fill_want = 1.0 if mdl.dish else 0.0
		_mc_p.status.text = ("SIGNAL " + ("DELIVERED" if _box(s).log.size() else "READY")) if mdl.dish else "NO LINK"


func _process(dt: float) -> void:
	if _orbit and is_instance_valid(_orbit) and _orbit.is_visible_in_tree():
		_orbit.queue_redraw()
	elif _orbit and not is_instance_valid(_orbit):
		_orbit = null
		_orbit_s = null
	if _mc_hold and is_instance_valid(_mc_hold) and _mc_hold.visible:
		_mc_fill += (_mc_fill_want - _mc_fill) * minf(1, dt * 8)
		_mc_p.bar.queue_redraw()
