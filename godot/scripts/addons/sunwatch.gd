extends Node
## Sun Watch: a console that shows the real Sun behind the mission (a port of js/sunwatch.js).
## It draws every real solar flare in the loaded NASA DONKI window on a chart (time goes across, strength goes up
## on a log scale with the bands C, M and X), highlights the real days this mission replays, and lists what each
## of those days meant in the game.
## Two honesty rules: it always says if the data is live or the saved archive, and it never shows the flares of a
## mission day the player has no way of knowing about yet. If something is missing it shows less; it never fails.

const DAY := 86400000.0
const DONKI := "https://ccmc.gsfc.nasa.gov/tools/DONKI/"
const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
# Chart layout. Across is in percent of the chart's width; down is in pixels: day numbers on top, the plot between
# TOP and BOT, dates underneath.
const GUT := 8.0
const WIDE := 90.0
const STRIP := 24.0
const TOP := 52.0
const BOT := 252.0
const TALL := 280.0
## what the strongest flare of a day means in the game (the levels from Weather.classify)
const STORMS := [["😎", "Quiet Sun"], ["⚡", "Small storm"], ["⚡⚡", "Medium storm"], ["⚡⚡⚡", "BIG storm"]]

var _m = null            # the model of the open card
var _chart: Control = null
var _pick := -1
var _doc: Html.Doc = null


# ---------- small helpers ----------
static func _esc(v) -> String:
	return Html.esc(str(v))


static func _list(v) -> Array:
	return v if v is Array else []


static func _r1(v: float) -> float:
	return roundf(v * 10) / 10


static func _plural(n: int, word: String) -> String:
	return str(n) + " " + word + ("" if n == 1 else "s")


static func _num(v, def := NAN) -> float:
	if v is int or v is float:
		return float(v)
	if v is String and v.is_valid_float():
		return float(v)
	return def


## "2024-05-10…" -> that day at 00:00 UTC in milliseconds (NAN if it is not a date)
static func day_ms(d) -> float:
	if not (d is String) or d.length() < 10:
		return NAN
	var p: String = d.substr(0, 10)
	if p[4] != "-" or p[7] != "-" or not p.substr(0, 4).is_valid_int():
		return NAN
	return Time.get_unix_time_from_datetime_string(p) * 1000.0


## "06:54" -> milliseconds since midnight (NAN if there is no time)
static func clock_ms(t) -> float:
	if not (t is String) or t.length() < 5 or t[2] != ":":
		return NAN
	var h: String = t.substr(0, 2)
	var m: String = t.substr(3, 2)
	if not h.is_valid_int() or not m.is_valid_int() or int(h) >= 24 or int(m) >= 60:
		return NAN
	return (int(h) * 60 + int(m)) * 60000.0


## "2024-05-10T06:54Z" -> milliseconds UTC
static func stamp_ms(t) -> float:
	return day_ms(t) + clock_ms(t.substr(11)) if t is String else NAN


static func _dt(ms: float) -> Dictionary:
	return Time.get_datetime_dict_from_unix_time(int(floor(ms / 1000.0)))


static func long_date(ms: float) -> String:
	var d := _dt(ms)
	return str(d.day) + " " + MONTHS[d.month - 1] + " " + str(d.year)


static func short_date(ms: float) -> String:
	var d := _dt(ms)
	return str(d.day) + " " + MONTHS[d.month - 1].substr(0, 3)


static func clock(ms: float) -> String:
	var d := _dt(ms)
	return "%02d:%02d" % [d.hour, d.minute]


## Flare class -> where it sits on the log scale: C1 = 0, M1 = 1, X1 = 2, X10 = 3. Each whole step is 10 times
## stronger. The band is the letter (anything below C counts as C).
static func strength(cls):
	if not (cls is String) or cls == "":
		return null
	var i := "ABCMX".find(cls[0].to_upper())
	if i < 0:
		return null
	var n := _num(cls.substr(1), 1.0)
	if not (n > 0):
		n = 1.0
	return { "log": i - 2 + log(n) / log(10.0), "band": "x" if i == 4 else ("m" if i == 3 else "c") }


## only ever link to a NASA page
static func nasa_link(url) -> String:
	if not (url is String) or not url.begins_with("https://"):
		return ""
	var host: String = url.substr(8).split("/")[0].to_lower()
	return url if (host == "nasa.gov" or host.ends_with(".nasa.gov")) and url.substr(8).contains("/") else ""


static func _t(v) -> bool:
	return Js.truthy(v)


# ---------- the mission days, and which of them may be shown ----------
# Past days and today are open. Today stays shut if no forecast came in (the Radio Dish was off yesterday) until
# the storm alarm sounds or the day ends. Tomorrow opens only when tonight's report carried a full forecast.
# Everything after the first shut day is shut.
static func mission_days(s: Dictionary) -> Array:
	var wx := _list(s.get("weather"))
	var sol := int(_num(s.get("sol"), 0))
	var over := _t(s.get("over"))
	var reports := {}
	for r in _list(s.get("log")):
		if r is Dictionary and r.get("sol"):
			reports[int(r.sol)] = r
	var st = s.get("storm")
	var seen: bool = st is Dictionary and (_t(st.get("warned")) or _t(st.get("active")) or _t(st.get("over")))
	var today_known: bool = _t(s.get("forecast")) or seen or _t(s.get("dayDone")) or _t(s.get("night"))
	var tonight = reports.get(sol)
	var tomorrow_known: bool = _t(s.get("night")) and tonight is Dictionary and tonight.get("forecast") is Dictionary and _t(tonight.forecast.get("full"))
	var out := []
	var shut := false
	var site_id: String = s.site.id if s.get("site") is Dictionary else ""
	for i in wx.size():
		var w: Dictionary = wx[i] if wx[i] is Dictionary else {}
		var n := i + 1
		var state: String
		if reports.has(n) or n < sol:
			state = "played"
		elif over:
			state = "ended" if n == sol else "missed"
		elif shut:
			state = "later"
		elif n == sol:
			state = "today" if today_known else "blind"
		elif n == sol + 1 and tomorrow_known:
			state = "forecast"
		else:
			state = "later"
		if state == "blind" or state == "later":
			shut = true
		var sep_link := nasa_link(w.sep.get("link")) if w.get("sep") is Dictionary else ""
		var cme_link := ""
		if w.get("cme") is Dictionary and w.cme.get("link"):
			cme_link = nasa_link(w.cme.link)
		elif w.get("arrive") is Dictionary:
			cme_link = nasa_link(w.arrive.get("link"))
		out.append({ "n": n, "state": state, "open": state != "blind" and state != "later", "today": n == sol and not over,
			"ms": day_ms(w.get("date")), "cls": str(w.cls) if w.get("cls") is String else "", "clock": clock_ms(w.get("time")),
			"level": clampi(roundi(_num(w.get("level"), 0)), 0, 3), "count": roundi(_num(w.get("count"), 0)), "link": nasa_link(w.get("link")),
			"report": reports.get(n), "story": str(Weather.describe(w, site_id).text) if w.get("date") else "", "sepLink": sep_link, "cmeLink": cme_link })
	return out


# ---------- everything the card needs, worked out once ----------
static func build(s, data) -> Dictionary:
	if not (s is Dictionary):
		s = null
	if not (data is Dictionary):
		data = null
	var m := { "s": s, "days": mission_days(s) if s else [], "pts": [], "total": 0, "ok": false, "full": data != null and data.get("flares") is Array }
	m.source = str(Js.orv(s.get("weatherSource") if s else null, Js.orv(data.get("source") if data else null, "")))
	m.fallback = (s != null and _t(s.get("weatherFallback"))) or (data != null and _t(data.get("fallback")))
	m.fetched = day_ms(data.get("fetchedAt")) if data else NAN
	m.saved = day_ms(data.get("downloaded")) if data else NAN
	m.dayWord = str(s.site.dayWord) if s and s.get("site") is Dictionary and s.site.get("dayWord") else "Day"
	# every flare we may draw: the full NASA list, or (without it) the strongest flare of each open mission day
	var all := []
	if m.full:
		for f in data.flares:
			if not (f is Dictionary):
				continue
			var k = strength(f.get("c"))
			var ms := stamp_ms(f.get("t"))
			if k and not is_nan(ms):
				all.append({ "ms": ms, "cls": str(f.c), "log": k.log, "band": k.band, "timed": true })
	else:
		for d in m.days:
			var k = strength(d.cls) if d.open else null
			if k and not is_nan(d.ms):
				all.append({ "ms": d.ms + (DAY / 2 if is_nan(d.clock) else d.clock), "cls": d.cls, "log": k.log, "band": k.band, "timed": not is_nan(d.clock) })
	# the run of real days the chart covers
	var t0 := day_ms(data.get("start")) if data else NAN
	var t1 := day_ms(data.get("end")) if data else NAN
	if is_nan(t0) or is_nan(t1) or t1 < t0:
		t0 = INF
		t1 = -INF
		for p in all:
			var dd := floorf(p.ms / DAY) * DAY
			t0 = minf(t0, dd)
			t1 = maxf(t1, dd)
	for d in m.days:
		if not is_nan(d.ms):
			t0 = minf(t0, d.ms)
			t1 = maxf(t1, d.ms)
	if is_inf(t0) or is_inf(t1):
		return m
	if t1 - t0 > 92 * DAY:
		t0 = t1 - 92 * DAY
	m.t0 = t0
	m.t1 = t1
	m.span = t1 + DAY - t0
	m.nDays = roundi(m.span / DAY)
	m.ok = true
	# never draw the flares of a mission day that is still shut
	var shut_days := []
	for d in m.days:
		if not d.open and not is_nan(d.ms):
			shut_days.append(d)
	m.shut0 = shut_days[0].ms if shut_days.size() else NAN
	m.shut1 = shut_days.back().ms + DAY if shut_days.size() else NAN
	m.top = 3.0          # the chart reaches X10 at least
	m.count = { "c": 0, "m": 0, "x": 0 }
	for p in all:
		if p.ms < t0 or p.ms >= t0 + m.span:
			continue
		m.total += 1
		m.top = maxf(m.top, p.log + 0.12)
		if not is_nan(m.shut0) and p.ms >= m.shut0 and p.ms < m.shut1:
			continue
		m.count[p.band] += 1
		m.pts.append(p)
	m.pts.sort_custom(func(a, b): return a.ms < b.ms)
	return m


# ---------- 1. heading and where the data comes from ----------
static func _row(icon: String, title: String, body: String, cls := "") -> String:
	return "<div class=\"info-row" + (" " + cls if cls else "") + "\"><span class=\"ic\">" + icon + "</span><div><b>" + title + "</b><p>" + body + "</p></div></div>"


static func head_html(m: Dictionary) -> String:
	var range_txt := ("from <b>" + _esc(long_date(m.t0)) + "</b> to <b>" + _esc(long_date(m.t1)) + "</b>") if m.ok else ""
	var lead: String
	if not m.ok:
		lead = "Sun Watch shows real solar flares, recorded by NASA on real dates."
	elif m.full and not m.total:
		lead = "This is the real Sun. NASA listed no solar flares at all " + range_txt + "."
	elif m.full:
		lead = "These are real solar flares. NASA recorded all " + str(m.total) + " of them, " + range_txt + "."
	else:
		lead = "These are real solar flares. NASA recorded them " + range_txt + "."
	var box := ""
	if m.fallback:
		box = _row("📼", "Saved NASA records (not live)", "You asked for live data, but NASA could not be reached. So this mission uses saved NASA records instead. This is not live data.")
	elif m.source == "live":
		var when := "when this mission started"
		if not is_nan(m.fetched):
			var today := floorf(Time.get_unix_time_from_system() * 1000.0 / DAY) * DAY
			when = "today" if m.fetched == today else "on " + _esc(long_date(m.fetched))
		box = _row("🛰️", "Live from NASA", "The game fetched this list from NASA " + when + ". These are the newest flares NASA has listed.")
	elif m.source == "archive":
		# 10 May 2024 was the peak of the strongest storm at Earth in about 20 years
		var may_ms := day_ms("2024-05-10")
		var may: bool = m.ok and m.t0 <= may_ms and m.t1 >= may_ms
		box = _row("📼", "Saved NASA records (not live)", "This list is saved inside the game. It is not live data." +
			(" It covers one of the most active months on the Sun in 20 years." if may else "") +
			("" if is_nan(m.saved) else " It was copied from NASA on " + _esc(long_date(m.saved)) + "."))
	return "<h2>☀️ Sun Watch</h2><p class=\"sub\">The real Sun behind your mission.</p><p>" + lead + "</p>" + box


# ---------- 2. the chart ----------
static func _x_at(m: Dictionary, ms: float, w: float) -> float:
	return (GUT + WIDE * clampf((ms - m.t0) / m.span, 0, 1)) / 100.0 * w


static func _y_at(m: Dictionary, lg: float) -> float:
	return BOT - clampf(lg, 0, m.top) / m.top * (BOT - TOP)


static func _tip(p: Dictionary) -> String:
	return str(p.cls) + " flare · " + long_date(p.ms) + (" · peak at " + clock(p.ms) + " UTC" if p.timed else "")


static func _mission_days(m: Dictionary) -> Array:
	var out := []
	for d in m.days:
		if not is_nan(d.ms):
			out.append(d)
	return out


static func _today(days: Array):
	for d in days:
		if d.today:
			return d
	return null


func _draw_chart(c: Control, m: Dictionary) -> void:
	var w := c.size.x
	var f := Paint.font(600, "lexend")
	var left := GUT / 100.0 * w
	var right := (GUT + WIDE) / 100.0 * w
	var days := _mission_days(m)
	var today = _today(days)
	# the three bands; each one is 10 times stronger than the band below it
	for b in [["x", 2.0, m.top, "X", Color(Style.DANGER, 0.13)], ["m", 1.0, 2.0, "M", Color(Style.POWER, 0.07)], ["c", 0.0, 1.0, "C", Color(Style.AIR, 0.07)]]:
		var y1 := _y_at(m, b[2])
		var y0 := _y_at(m, b[1])
		Paint.rect(c, left, y1, right - left, y0 - y1, b[4])
		Paint.text(c, b[3], left / 2, (y0 + y1) / 2, 17, Style.INK, "center", 700)
	for v in [1.0, 2.0]:
		Paint.line(c, left, _y_at(m, v), right, _y_at(m, v), Style.LINE, 1)
	var y5 := _y_at(m, 1 + log(5.0) / log(10.0))       # M5: from here up an M flare makes a medium storm
	_dashed(c, Vector2(left, y5), Vector2(right, y5), Color(Style.MUTED, 0.7), 1, 2, 5)
	Paint.line(c, left, BOT, right, BOT, Style.MUTED, 1)
	# dates along the bottom
	var step := 7 if m.nDays > 21 else (3 if m.nDays > 10 else (2 if m.nDays > 5 else 1))
	var i := 0
	while i < m.nDays:
		var tx := _x_at(m, m.t0 + (i + 0.5) * DAY, w)
		Paint.line(c, tx, BOT, tx, BOT + 5, Style.MUTED, 1)
		Paint.text(c, short_date(m.t0 + i * DAY), tx, BOT + 17, 12, Style.MUTED, "center", 600)
		i += step
	# the days this mission replays: a band with the mission day numbers on top
	if days.size():
		var a := _x_at(m, days[0].ms, w)
		var b2 := _x_at(m, days.back().ms + DAY, w)
		var on_left := (a + b2) / 2 < w / 2
		Paint.rrect(c, a, STRIP, b2 - a, BOT - STRIP, 5, Color(Style.POWER, 0.08))
		Paint.rrect(c, a, STRIP, b2 - a, BOT - STRIP, 5, Style.POWER, 1.5)
		Paint.rrect(c, a, STRIP, b2 - a, 22, 5, Color(Style.POWER, 0.25))
		var cap: String = "Your mission" + ((" · today is " + m.dayWord + " " + str(today.n)) if today else "")
		Paint.text(c, cap, a if on_left else b2, 12, 13, Style.POWER, "left" if on_left else "right", 700)
		if today:
			var tx0 := _x_at(m, today.ms, w)
			Paint.rect(c, tx0, TOP, _x_at(m, today.ms + DAY, w) - tx0, BOT - TOP, Color(Style.POWER, 0.16))
		for k in days.size():
			var d: Dictionary = days[k]
			var cx := _x_at(m, d.ms + DAY / 2, w)
			var sx := _x_at(m, d.ms, w)
			if k:
				Paint.line(c, sx, STRIP, sx, STRIP + 22, Color(Style.POWER, 0.3), 1)
				Paint.line(c, sx, TOP, sx, BOT, Color(Style.POWER, 0.3), 1)
			if d.today:
				Paint.circle(c, cx, STRIP + 11, 11, Style.POWER)
			var room: bool = (_x_at(m, d.ms + DAY, w) - sx) > 16
			if room or d.today or k == 0 or k == days.size() - 1:
				Paint.text(c, str(d.n), cx, STRIP + 11, 13, Color("#2a1c00") if d.today else Style.INK, "center", 700 if d.today else 600)
	# one mark per real flare: C and M are dots, X is a diamond (so it is not colour alone)
	for band in ["c", "m", "x"]:
		for p in m.pts:
			if p.band != band:
				continue
			var x := _x_at(m, p.ms, w)
			var y := _y_at(m, p.log)
			if band == "x":
				c.draw_colored_polygon(PackedVector2Array([Vector2(x, y - 7), Vector2(x + 6.5, y), Vector2(x, y + 7), Vector2(x - 6.5, y)]), Style.DANGER)
			else:
				Paint.circle(c, x, y, 4, Style.POWER if band == "m" else Style.AIR)
	# a white ring around the strongest flare of each open mission day: that flare sets the storm
	for d in days:
		var k = strength(d.cls) if d.open else null
		if k:
			Paint.circle(c, _x_at(m, d.ms + (DAY / 2 if is_nan(d.clock) else d.clock), w), _y_at(m, k.log), 8.5, Style.INK, 2)
	# days the player may not know about yet stay covered
	if not is_nan(m.shut0):
		var h0 := _x_at(m, m.shut0, w)
		var h1 := _x_at(m, m.shut1, w)
		Paint.rect(c, h0, TOP, h1 - h0, BOT - TOP, Color(Style.PANEL_SOLID, 0.88))
		Paint.stroke_rect(c, h0, TOP, h1 - h0, BOT - TOP, Style.MUTED, 1.5)
		Paint.text(c, "?", (h0 + h1) / 2, (TOP + BOT) / 2, 24, Style.MUTED, "center", 700)
	# the flare you point at
	if _pick >= 0 and _pick < m.pts.size():
		var pp: Dictionary = m.pts[_pick]
		Paint.circle(c, _x_at(m, pp.ms, w), _y_at(m, pp.log), 12, Style.AIR, 3)
	f = f


static func _dashed(c: CanvasItem, a: Vector2, b: Vector2, color: Color, width: float, on: float, off: float) -> void:
	var L := a.distance_to(b)
	var dir := (b - a) / maxf(L, 0.001)
	var d := 0.0
	while d < L:
		c.draw_line(a + dir * d, a + dir * minf(L, d + on), color, width)
		d += on + off


func _chart_input(ev: InputEvent) -> void:
	if _m == null or _chart == null:
		return
	if ev is InputEventMouseMotion or (ev is InputEventMouseButton and ev.pressed):
		var pos: Vector2 = ev.position
		var w := _chart.size.x
		var best := -1
		var mn := 26.0 * 26.0
		for i in _m.pts.size():
			var p: Dictionary = _m.pts[i]
			var q := Vector2(_x_at(_m, p.ms, w), _y_at(_m, p.log)).distance_squared_to(pos)
			if q < mn:
				mn = q
				best = i
		if best >= 0 and best != _pick:
			_show(best)
	elif ev is InputEventKey and ev.pressed and _m.pts.size():
		var step := 1 if ev.keycode == KEY_RIGHT else (-1 if ev.keycode == KEY_LEFT else 0)
		if step:
			_chart.accept_event()
			_show((0 if step > 0 else _m.pts.size() - 1) if _pick < 0 else clampi(_pick + step, 0, _m.pts.size() - 1))


func _show(i: int) -> void:
	_pick = i
	if _doc:
		_doc.set_text("sw-read", _tip(_m.pts[i]))
	_chart.queue_redraw()


func chart_html(m: Dictionary) -> String:
	if not m.ok:
		return "<p class=\"sub\">No flare list is loaded yet. Start a mission to see the real Sun here.</p>"
	var days := _mission_days(m)
	var today = _today(days)
	var intro := ""
	if days.size():
		intro = "<p>The yellow band is your mission: " + _esc(m.dayWord + " 1 to " + m.dayWord + " " + str(days.back().n)) + " replay " + _esc(long_date(days[0].ms)) + " to " + _esc(long_date(days.back().ms)) + ".</p>"
	return "<h3>📈 The real Sun, flare by flare</h3>" + intro + "<canvas id=\"sw-chart\" width=\"700\" height=\"" + str(int(TALL)) + "\"></canvas>" + \
		"<p class=\"sub\" id=\"sw-read\">" + ("Point at a dot, or tap it, to see that real flare." if m.pts.size() else "") + "</p>" + key_html(m, days, today)


## The key under the chart: every colour also has a shape or a place, and a label.
static func key_html(m: Dictionary, days: Array, today) -> String:
	var li := [
		"<li><span style=\"color:" + Style.hx(Style.DANGER) + "\">◆</span><span><b>X flare</b> = BIG storm</span></li>",
		"<li><span style=\"color:" + Style.hx(Style.POWER) + "\">●</span><span><b>M flare</b> = small storm. Above the dashed line (M5) = medium storm</span></li>",
		"<li><span style=\"color:" + Style.hx(Style.AIR) + "\">●</span><span><b>C flare</b> = too weak for a storm. A quiet day</span></li>"]
	if days.size():
		li.append("<li><span>◯</span><span><b>White ring</b> = the strongest flare of a mission day. It sets the storm</span></li>")
		if today:
			li.append("<li><span style=\"color:" + Style.hx(Style.POWER) + "\">⬤</span><span><b>Yellow circle</b> = today, " + _esc(m.dayWord + " " + str(today.n)) + "</span></li>")
	if not is_nan(m.shut0):
		li.append("<li><span>?</span><span><b>?</b> = days you cannot know yet. Their flares stay hidden</span></li>")
	var notes := "<p class=\"sub\">Left to right is time. Higher up is stronger. Each letter is 10 times stronger than the one before: M is 10 times C, and X is 10 times M. So each band of the chart is a 10 times jump.</p>"
	if not m.full:
		notes += "<p class=\"sub\">The full flare list is not loaded, so this chart shows only the strongest flare of each mission day.</p>"
	elif not m.count.c and m.source == "archive":
		notes += "<p class=\"sub\">The saved list keeps only M and X flares. That is why the C band is empty.</p>"
	return "<ul class=\"harder\">" + "".join(li) + "</ul>" + notes


# ---------- 3. one row per mission day ----------
## What a finished day did to the radiation badge, read from that day's night report.
static func happened(m: Dictionary, d: Dictionary) -> String:
	var r = d.report
	if not (r is Dictionary):
		return ""
	var storm := NAN
	for l in _list(r.get("lines")):
		if l is Dictionary and l.get("res") == "dose":
			for p in _list(l.get("parts")):
				if p is Dictionary and str(p.get("text", "")).to_lower().contains("solar storm"):
					storm = _num(p.get("v"))
	var out: String
	if d.level > 0:
		out = ("The storm added <b>" + str(_r1(storm)) + "%</b> to your radiation badge.") if storm > 0 else "The storm added almost nothing to your radiation badge."
	else:
		out = "No storm hit the outpost."
	var b := _num(r.before.get("dose")) if r.get("before") is Dictionary else NAN
	var a := _num(r.after.get("dose")) if r.get("after") is Dictionary else NAN
	if not is_nan(b) and not is_nan(a):
		out += " Badge that " + _esc(str(m.dayWord).to_lower()) + ": " + str(roundi(b)) + "% → " + str(roundi(a)) + "%."
	return out


## Today, while the shift is still running.
static func right_now(m: Dictionary, d: Dictionary) -> String:
	var s: Dictionary = m.s
	var st = s.get("storm")
	var got := _num(s.today.get("doseStorm")) if s.get("today") is Dictionary else NAN
	if d.level > 0 and st is Dictionary:
		if _t(st.get("over")):
			return "The storm has passed." + (" So far it added <b>" + str(_r1(got)) + "%</b> to your radiation badge." if got >= 0.05 else "")
		if _t(st.get("active")):
			return "The storm is hitting right now. Stay inside!"
		if _t(st.get("warned")):
			return "The storm is on its way. Get home!"
		return "A storm will hit some time today. Be ready to run home!"
	return "A storm is forecast for today." if d.level > 0 else "No storm today."


static func row_html(m: Dictionary, d: Dictionary) -> String:
	var low := str(m.dayWord).to_lower()
	var date := "Date not known" if is_nan(d.ms) else long_date(d.ms)
	var when := "today" if d.today else ("tomorrow" if d.state == "forecast" else "")
	var chip := "<b" + (" style=\"color:" + Style.hx(Style.POWER) + "\"" if d.today else "") + ">" + _esc(m.dayWord + " " + str(d.n)) + "</b>"
	var head := chip + " · <b>" + _esc(date) + "</b>" + ((" <em>" + when + "</em>") if when else "")
	if not d.open:
		var blind: bool = d.state == "blind"
		return _row("❓", head + "  ·  " + ("No forecast" if blind else "Not yet"),
			"No forecast. The Radio Dish was off, so Earth could not warn you. Look again later today." if blind else "Not yet. Play this " + _esc(low) + " to see what the Sun did.")
	var links := []
	if d.sepLink:
		links.append("<a href=\"" + _esc(d.sepLink) + "\">particle storm record</a>")
	if d.cmeLink:
		links.append("<a href=\"" + _esc(d.cmeLink) + "\">CME record</a>")
	if d.link:
		links.append("<a href=\"" + _esc(d.link) + "\">flare record</a>")
	var flare := _esc(d.story if d.story else ("Strongest flare: class " + d.cls + "." if d.cls else "No flare listed that day.")) + \
		(" NASA listed " + str(d.count) + " flares that day." if d.count > 1 else "") + (" NASA: " + " · ".join(links) if links.size() else "")
	var what := ""
	match d.state:
		"played": what = happened(m, d)
		"today": what = right_now(m, d)
		"forecast": what = "Forecast from Earth. Your Radio Dish was on, so you know what is coming."
		"ended": what = "The mission ended on this " + _esc(low) + "."
		"missed": what = "The mission ended before this " + _esc(low) + "."
	var st: Array = STORMS[clampi(d.level, 0, 3)]
	var col := Style.OK if d.level == 0 else (Style.POWER if d.level < 3 else Style.DANGER)
	return "<div class=\"info-row" + (" alert" if d.level >= 2 else "") + "\"><span class=\"ic\">" + st[0].substr(0, 1) + "</span><div><b>" + head + \
		"  ·  <span style=\"color:" + Style.hx(col) + "\">" + st[0] + " " + st[1] + "</span></b><p>" + flare + "</p>" + ("<p><b>" + what + "</b></p>" if what else "") + "</div></div>"


static func rows_html(m: Dictionary) -> String:
	if m.days.is_empty():
		return ""
	var s: Dictionary = m.s
	var hit := 0
	var out := _num(s.stats.get("stormOut")) if s.get("stats") is Dictionary else NAN
	var st = s.get("storm")
	for d in m.days:
		if d.level > 0 and (d.state == "played" or (d.state == "today" and st is Dictionary and (_t(st.get("active")) or _t(st.get("over"))))):
			hit += 1
	var sum := ""
	if hit and not is_nan(out):
		var sofar := "In this mission" if _t(s.get("over")) else "So far"
		sum = "<p>" + (("🏅 " + sofar + " you were never caught outside in a solar storm. Nice work!") if out < 1 else (sofar + " you were caught outside in a solar storm for about " + _esc(_plural(roundi(out), "second")) + ".")) + "</p>"
	var rows := ""
	for d in m.days:
		rows += row_html(m, d)
	return "<h3>🗓️ Your mission, day by real day</h3><p class=\"sub\">Each mission " + _esc(str(m.dayWord).to_lower()) + " replays one real day. The chart above shows the flares: flashes of light. Each row says what really reached " + \
		("Mars" if s.site.id == "mars" else "the Moon") + ": a storm of fast particles, or nothing.</p>" + rows + sum


# ---------- 4. how to read this, and the source ----------
static func source_html(m) -> String:
	var tail := ""
	if m is Dictionary:
		tail = " Live list." if m.source == "live" and not m.fallback else (" Saved list, not live." if m.source == "archive" or m.fallback else "")
	return "<p class=\"sub\">Source: <a href=\"" + DONKI + "\">NASA DONKI</a>, the Space Weather Database Of Notifications, Knowledge, Information." + tail + "</p>"


static func facts_html(m: Dictionary) -> String:
	return "<h3>🔎 How to read this</h3>" + \
		_row("☀️", "What is a solar flare?", "A giant flash on the Sun: light and X-rays. It takes about 8 minutes to reach Earth and the Moon, and about 13 minutes to reach Mars. It is the first sign that something happened.") + \
		_row("☁️", "What is a CME?", "A coronal mass ejection: a giant cloud of solar gas thrown into space. It takes one to three days to cross to Earth or Mars. A fast one pushes a shock wave ahead of it, like a boat's bow wave.") + \
		_row("☢️", "So what is a radiation storm?", "Protons sped up to huge speeds, mostly by that shock wave. They race along the Sun's spiral magnetic field, so they only reach a planet that is linked to the right part of the Sun. Big flares often send none your way. That is why the crew watches for particles, not flashes.") + \
		_row("🔠", "What do the letters mean?", "Scientists sort flares by strength: A, B, C, M and X. Each letter is 10 times stronger than the one before. The number counts steps inside a letter: an M2 is twice as strong as an M1.") + \
		_row("🌙", "Why is the Moon hit harder than Mars?", "The Moon has no air at all, so nothing slows a solar storm down. Mars has thin air that soaks up part of it. In this game a storm on Mars is half as strong as on the Moon. That half is a game number.") + \
		"<p class=\"sub\"><b>Real:</b> every flare, particle storm, CME, date and time here (NASA DONKI). On the Moon, the particle storms are the ones NASA's satellites measured near Earth. On Mars, no detector reports to DONKI, so the game checks each fast CME against where Mars really was and how well it was linked to the eruption. <b>Game:</b> how many badge points a storm costs.</p>" + \
		source_html(m)


# ---------- public ----------
func html(s, data) -> String:
	var m := build(s, data)
	_m = m
	return "<div class=\"sunwatch\">" + head_html(m) + chart_html(m) + (rows_html(m) if m.s else "") + facts_html(m) + "</div>"


## Open the card on top of the game. Point at the chart (or click it, or use the arrow keys) and the nearest
## flare is read out below it.
func open(s, data = null):
	var h := html(s, data)
	_pick = -1
	_doc = Game.open_info(h)
	if _doc == null:
		return null
	_chart = _doc.el("sw-chart")
	if _chart and _m.ok:
		var m: Dictionary = _m
		_chart.custom_minimum_size = Vector2(0, TALL)
		_chart.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_chart.mouse_filter = Control.MOUSE_FILTER_STOP
		_chart.focus_mode = Control.FOCUS_ALL
		_chart.draw.connect(func(): _draw_chart(_chart, m))
		_chart.gui_input.connect(_chart_input)
	# the info card puts the focus on "Got it" at the bottom of this long card: scroll back up to the heading
	var sc = _doc.root.get_parent()
	if sc is ScrollContainer:
		sc.set_deferred("scroll_vertical", 0)
		(func(): if is_instance_valid(sc): sc.scroll_vertical = 0).call_deferred()
	return _doc
