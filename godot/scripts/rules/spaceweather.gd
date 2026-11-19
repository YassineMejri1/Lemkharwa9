extends Node
## Astro Outpost — real space weather, from NASA DONKI (the Space Weather Database). A port of js/spaceweather.js.
## Three different things, and only one of them is the crew's radiation storm:
## - a solar FLARE is a flash of light and X-rays. It reaches the Moon or Mars in minutes: the first sign.
## - a CORONAL MASS EJECTION (CME) is a huge, fast cloud of solar gas. It takes one to three days to cross space.
## - SOLAR ENERGETIC PARTICLES (SEPs) are protons sped up, mostly by the shock wave in front of a fast CME. They race
##   along the Sun's spiral magnetic field, so they reach a planet only if the eruption is on the part of the Sun that
##   is magnetically connected to it. THEY are the radiation storm.
## Moon: the particle storms NASA's satellites near Earth really measured (DONKI SEP), plus CME shock arrivals at Earth.
## Mars: no particle detector near Mars reports to DONKI, so each fast CME is checked against the real positions of
## Earth and Mars on that date, plus the WSA-ENLIL model's CME arrivals at Mars. Live data covers the last 30 days;
## the archive (data/archive_2024.json) covers 22 Apr – 31 May 2024.

const BASE := "https://ccmc.gsfc.nasa.gov/DONKI/WS/get/"
const DAY_S := 86400
const STRENGTH := [0, 6, 12, 24]        # GAME: badge points of a storm of level 0–3, before the site and level scales
const ARCHIVE_PATH := "res://data/archive_2024.json"

## the session's download, so a second mission today does not ask NASA again (sessionStorage in the web version)
var _cache := {}
var _archive = null


static func iso(unix: float) -> String:
	return Time.get_date_string_from_unix_time(int(unix))


static func parse_day(date_str: String) -> int:
	return Time.get_unix_time_from_datetime_string(date_str + "T00:00:00")


static func wrap180(d: float) -> float:
	return fposmod(d + 180.0, 360.0) - 180.0


# ---------- the data, trimmed to what the game uses ----------
static func slim_flares(list) -> Array:
	var out := []
	for f in (list if list is Array else []):
		if f is Dictionary and f.get("classType") is String and f.classType != "" and f.get("peakTime"):
			out.append({ "t": f.peakTime, "c": f.classType, "ar": f.get("activeRegionNum"), "loc": f.get("sourceLocation", "") if f.get("sourceLocation") else "", "link": f.get("link") })
	return out


static func slim_sep(list) -> Array:
	var out := []
	for e in (list if list is Array else []):
		if e is Dictionary and e.get("eventTime"):
			var inst := []
			for i in (e.get("instruments") if e.get("instruments") is Array else []):
				inst.append(str(i.get("displayName", "")) if i is Dictionary else "")
			out.append({ "t": e.eventTime, "inst": inst, "link": e.get("link") })
	return out


## the most accurate analysis of each CME (speed in km/s, direction as Stonyhurst longitude: 0 = toward Earth, west +)
static func slim_cme(list) -> Array:
	var out := []
	for c in (list if list is Array else []):
		if not (c is Dictionary) or not c.get("startTime"):
			continue
		var a = null
		for x in (c.get("cmeAnalyses") if c.get("cmeAnalyses") is Array else []):
			if x is Dictionary and x.get("isMostAccurate"):
				a = x
				break
		if a == null or a.get("speed") == null or a.get("longitude") == null or float(a.speed) < 600.0:
			continue
		out.append({ "t": c.startTime, "v": Js.mround(float(a.speed)), "lon": float(a.longitude), "half": a.get("halfAngle"), "link": c.get("link") })
	return out


## CME arrivals predicted by the WSA-ENLIL model: one per place and day (a direct hit beats a glancing blow)
static func slim_arrivals(list) -> Array:
	var by := {}
	var put := func(loc: String, t, gb, link) -> void:
		if not t:
			return
		var k: String = loc + "|" + str(t).substr(0, 10)
		if not by.has(k) or (by[k].gb and not gb):
			by[k] = { "loc": loc, "t": t, "gb": not not gb, "link": link }
	for x in (list if list is Array else []):
		if not (x is Dictionary):
			continue
		put.call("earth", x.get("estimatedShockArrivalTime"), x.get("isEarthGB"), x.get("link"))
		for i in (x.get("impactList") if x.get("impactList") is Array else []):
			if i is Dictionary and i.get("location") == "Mars":
				put.call("mars", i.get("arrivalTime"), i.get("isGlancingBlow"), x.get("link"))
	var keys := by.keys()
	keys.sort()
	var out := []
	for k in keys:
		out.append(by[k])
	return out


## Flare class -> how big the FLASH looked (A, B, C, M, X: each letter 10 times stronger). This is not the crew's dose.
static func classify(cls) -> Dictionary:
	if not (cls is String) or cls == "":
		return { "level": 0, "strength": 0 }
	var letter: String = cls.substr(0, 1).to_upper()
	var num := _lead_float(cls.substr(1))
	if num == 0.0:
		num = 1.0
	if letter == "X":
		return { "level": 3, "strength": Js.mround(20 + minf(10, num)) }
	if letter == "M" and num >= 5:
		return { "level": 2, "strength": 12 }
	if letter == "M":
		return { "level": 1, "strength": 6 }
	return { "level": 0, "strength": 0 }


static func rank(cls) -> float:
	if not (cls is String) or cls == "":
		return -1
	var order := "ABCMX".find(cls.substr(0, 1).to_upper())
	return order * 100 + _lead_float(cls.substr(1))


## parseFloat: the number at the start of a text (0 when there is none)
static func _lead_float(s: String) -> float:
	var re := RegEx.new()
	re.compile("^\\s*[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?")
	var m := re.search(s)
	return float(m.get_string()) if m else 0.0


# ---------- where do the particles go? ----------
# The Sun turns while the solar wind blows out, so its magnetic field lines are spirals (the Parker spiral). A planet
# is linked to a spot on the Sun that lies west of the planet's own direction: about 58° for Earth, about 88° for Mars
# (Sun's turn 2.7e-6 rad/s, solar wind 400 km/s). The closer an eruption is to that spot, and the faster its CME,
# the more particles reach the planet (the fall-off with angle follows studies of many SEP events: about 43° wide).
const OMEGA_SUN := 2.7e-6
const V_WIND := 400.0
const SEP_WIDTH := 43.0
const LIGHT_MIN_PER_AU := 8.3167
const KM_PER_AU := 149597870.7


static func footpoint_deg(r_au: float) -> float:
	return OMEGA_SUN * r_au * KM_PER_AU / V_WIND * 180.0 / PI


func connection(date_str: String, lon: float, speed: float, site_id: String) -> Dictionary:
	var p := planets(date_str)
	var obs: Dictionary = p.mars if site_id == "mars" else p.earth
	var obs_lon := wrap180((obs.lon - p.earth.lon) * 180.0 / PI)          # the site's direction seen from the Sun; 0 = Earth
	var foot := obs_lon + footpoint_deg(obs.r)
	var theta := absf(wrap180(lon - foot))
	var score := maxf(0, (speed - 600.0) / 1000.0) * exp(-theta * theta / (2 * SEP_WIDTH * SEP_WIDTH))
	return { "theta": theta, "score": score, "level": 3 if score >= 1.2 else 2 if score >= 0.6 else 1 if score >= 0.3 else 0 }


## A measured particle event near Earth: how strong? GOES satellites count protons above 10 MeV; above 100 MeV is the
## most dangerous kind. Events seen only by STEREO-A (far from Earth) did not reach the Moon.
static func sep_level(inst: Array) -> int:
	var all := " | ".join(PackedStringArray(inst))
	if _test("(?i)GOES[^|]*>\\s*100\\s*MeV", all):
		return 3
	if _test("(?i)GOES", all):
		return 2
	if _test("(?i)SOHO|ACE|EPAM|EPHIN|COSTEP", all):
		return 1
	return 0


static func _test(pattern: String, text: String) -> bool:
	var re := RegEx.new()
	re.compile(pattern)
	return re.search(text) != null


# ---------- loading ----------
func archive() -> Dictionary:
	if _archive == null:
		_archive = Data.load_json(ARCHIVE_PATH)
	var a: Dictionary = _archive
	return { "source": "archive", "start": a.start, "end": a.end, "downloaded": a.get("downloaded"),
		"flares": a.flares, "sep": a.get("sep", []), "cme": a.get("cme", []), "arrivals": a.get("arrivals", []), "notes": a.get("notes", []) }


## { source: "live"|"archive", start, end, flares, sep, cme, arrivals, fallback? }, awaited:  var data = await Weather.load_data("live")
## Live needs the flares, the particle events and the CMEs; the ENLIL arrivals are a bonus. If NASA cannot be
## reached, the archive is used and marked as a fallback (the game must then say clearly it is not live).
func load_data(mode: String) -> Dictionary:
	if mode != "live":
		await get_tree().process_frame
		return archive()
	var end_t := Time.get_unix_time_from_system()
	var start_t := end_t - 30 * DAY_S
	var key := "ja-donki2-" + iso(end_t)
	var q := "?startDate=" + iso(start_t) + "&endDate=" + iso(end_t)
	if _cache.has(key):
		await get_tree().process_frame
		return _cache[key]
	var whats := ["FLR", "SEP", "CME", "WSAEnlilSimulations"]
	var results := {}
	var pending := [whats.size()]
	for what in whats:
		var req := HTTPRequest.new()
		req.timeout = 12.0
		add_child(req)
		req.request_completed.connect(func(result: int, code: int, _h, body: PackedByteArray) -> void:
			var v = null
			if result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300:
				var text := body.get_string_from_utf8()
				v = [] if text.strip_edges() == "" else JSON.parse_string(text)     # no events = empty reply
				if not (v is Array):
					v = null
			results[what] = v
			pending[0] -= 1
			req.queue_free())
		var err := req.request(BASE + what + q)
		if err != OK:
			results[what] = null
			pending[0] -= 1
			req.queue_free()
	var waited := 0.0
	while pending[0] > 0 and waited < 13.0:
		await get_tree().process_frame
		waited += get_process_delta_time()
	if results.get("FLR") == null or results.get("SEP") == null or results.get("CME") == null:
		var a := archive()
		a.fallback = true      # the UI must say clearly that this is NOT live data
		return a
	var data := { "source": "live", "start": iso(start_t), "end": iso(end_t), "flares": slim_flares(results.FLR), "sep": slim_sep(results.SEP),
		"cme": slim_cme(results.CME), "arrivals": slim_arrivals(results.get("WSAEnlilSimulations") if results.get("WSAEnlilSimulations") != null else []),
		"notes": [], "fetchedAt": Time.get_datetime_string_from_system(true) + "Z" }
	_cache[key] = data
	return data


# ---------- one entry per real calendar day, for one site ----------
# level 0–3 is the radiation storm that reached the site that day; cause says what it was:
#   "sep"   particles measured near Earth (Moon), or a CME well connected to Mars (Mars)
#   "cme"   a CME's shock wave arriving (a smaller particle storm)
# cls/time/link/loc describe the day's strongest flare (seen from Earth): the flash, not the dose.
func by_day(data: Dictionary, site_id: String) -> Array:
	var mars := site_id == "mars"
	var days := []
	var index := {}
	var t0 := parse_day(data.start)
	var t1 := parse_day(data.end)
	var t := t0
	while t <= t1:
		var d := { "date": iso(t), "cls": null, "level": 0, "strength": 0, "link": null, "time": null, "count": 0, "loc": "",
			"cause": null, "sep": null, "cme": null, "arrive": null, "note": null }
		index[d.date] = d
		days.append(d)
		t += DAY_S
	for f in data.get("flares", []):
		var d = index.get(str(f.t).substr(0, 10))
		if d == null or not (f.get("c") is String):
			continue
		d.count += 1
		if d.cls == null or rank(f.c) > rank(d.cls):
			d.cls = f.c
			d.link = f.get("link")
			d.time = str(f.t).substr(11, 5)
			d.loc = f.get("loc", "") if f.get("loc") else ""
	var raise := func(d: Dictionary, level: int, cause: String) -> bool:
		if level > d.level:
			d.level = level
			d.cause = cause
			return true
		return false
	if not mars:
		for e in data.get("sep", []):
			var d = index.get(str(e.t).substr(0, 10))
			var lv := sep_level(e.get("inst", []))
			if d != null and raise.call(d, lv, "sep"):
				d.sep = { "time": str(e.t).substr(11, 5), "inst": ", ".join(PackedStringArray(e.get("inst", []))), "link": e.get("link") }
	else:
		for c in data.get("cme", []):
			var d = index.get(str(c.t).substr(0, 10))
			if d == null:
				continue
			var k := connection(d.date, float(c.lon), float(c.v), "mars")
			if raise.call(d, k.level, "sep"):
				d.cme = { "time": str(c.t).substr(11, 5), "v": c.v, "lon": c.lon, "theta": Js.mround(k.theta), "link": c.get("link") }
	for a in data.get("arrivals", []):
		var d = index.get(str(a.t).substr(0, 10))
		if d == null or a.get("gb") or a.get("loc") != ("mars" if mars else "earth"):
			continue
		d.arrive = { "time": str(a.t).substr(11, 5), "link": a.get("link") }
		raise.call(d, 1, "cme")
	for n in data.get("notes", []):
		if n.get("site") == ("mars" if mars else "moon") and index.has(n.date):
			index[n.date].note = { "text": n.text, "src": n.get("src") }
	for d in days:
		d.strength = STRENGTH[int(d.level)]
	return days


# Plain words for what one real day sent to a site. Every screen that explains a storm uses this, so they can never
# disagree. Returns { text, flash, cause }.
static func inst_words(inst: String) -> String:
	if _test("(?i)GOES[^,]*>\\s*100\\s*MeV", inst):
		return "NASA and NOAA's GOES satellites counted protons with more than 100 MeV of energy"
	if _test("(?i)GOES", inst):
		return "NASA and NOAA's GOES satellites counted protons with more than 10 MeV of energy"
	return "the SOHO and ACE spacecraft counted extra fast protons"


func describe(d, site_id: String) -> Dictionary:
	var mars := site_id == "mars"
	if d == null:
		return { "text": "No space-weather data for this day.", "flash": "", "cause": null }
	var date: String = pretty_date(d.date) if d.get("date") else "that day"
	var text: String
	var flash: String = ("The strongest flare seen from Earth that day was class " + str(d.cls) + (", at " + str(d.time) + " UTC" if d.get("time") else "") + ".") if d.get("cls") else "Earth saw no big solar flares that day."
	if not d.level:
		if d.get("cls"):
			text = "On " + date + " the Sun flashed, but no storm of particles reached " + ("Mars" if mars else "the Moon") + ". A flare is a flash of light and X-rays; the danger for the crew is the fast particles, and none came."
		else:
			text = "On " + date + " the Sun was quiet, with no particle storm."
		return { "text": text + " " + flash, "flash": flash, "cause": null }
	if d.cause == "sep" and not mars:
		text = "On " + date + " " + inst_words(d.sep.inst if d.get("sep") else "") + " near Earth: a solar particle storm. The Moon travels right next to Earth, so it was hit too."
	elif d.cause == "sep":
		text = "On " + date + " a cloud of solar gas (a CME) left the Sun at " + (Js.grouped(float(d.cme.v)) + " km/s" if d.get("cme") else "high speed") + \
			" from the part of the Sun that is magnetically linked to Mars, so its fast particles could race along the field to Mars."
	else:
		text = "On " + date + " NASA's space-weather model says a cloud of solar gas (a CME) swept past " + ("Mars" if mars else "Earth and the Moon") + \
			". The shock wave at its front carries extra fast particles: a small radiation storm."
	if d.get("note"):
		text += " " + str(d.note.text)
	return { "text": text + " " + flash, "flash": flash, "cause": d.cause }


# Choose a run of consecutive real days for the mission. The level sets how stormy a window we look for; rng picks
# among the matching windows so replays differ.
func pick_window(data: Dictionary, n_sols: int, level_id: String, rng: Rng32, site_id: String) -> Array:
	var days := by_day(data, site_id)
	if days.size() < n_sols:
		return days
	var lv: Dictionary = Data.LEVELS.get(level_id, {})
	var target = (lv.get("stormsArchive") if data.source == "archive" else lv.get("storms"))
	if target == null:
		target = [2, 6]
	var wins := []
	for i in range(days.size() - n_sols + 1):
		var score := 0
		for j in n_sols:
			score += int(days[i + j].level)
		wins.append({ "i": i, "score": score })
	# Nobody lands in a storm: the first day (the "living off the land" lesson) must be calm, and the second day
	# (the "shield up" lesson, when the first soil bags go on) may not bring a big one. The days stay real and in order.
	var calm_start := wins.filter(func(w): return days[w.i].level == 0 and (n_sols < 2 or days[w.i + 1].level < 3))
	if calm_start.size():
		wins = calm_start
	var good := wins.filter(func(w): return w.score >= target[0] and w.score <= target[1])
	if good.is_empty():
		var mid := (float(target[0]) + float(target[1])) / 2.0
		var best := INF
		for w in wins:
			best = minf(best, absf(w.score - mid))
		good = wins.filter(func(w): return absf(w.score - mid) == best)
	var pick: Dictionary = good[int(floor(rng.next() * good.size()))]
	return days.slice(pick.i, pick.i + n_sols)


# Where Earth and Mars are on a real date, in AU, seen from above the Sun (x toward the vernal equinox). Mean orbits
# plus a first-order correction for their oval shape: good to a few percent, so everything built on it is shown to
# players as "about". The same model gives the radio delay and the orbit picture on Mission Control's screen.
const ORBITS := {
	"earth": { "L0": 100.46, "rate": 0.98564736, "peri": 102.94, "a": 1.0, "e": 0.0167, "period": 365.25 },
	"mars": { "L0": 355.45, "rate": 0.52402075, "peri": 336.04, "a": 1.5237, "e": 0.0934, "period": 686.98 }
}


static func planet_at(o: Dictionary, days: float) -> Dictionary:
	var L: float = (o.L0 + o.rate * days) * PI / 180.0
	var M: float = L - o.peri * PI / 180.0
	var v: float = M + 2 * o.e * sin(M)
	var r: float = o.a * (1 - o.e * o.e) / (1 + o.e * cos(v))
	var lon: float = v + o.peri * PI / 180.0
	return { "x": r * cos(lon), "y": r * sin(lon), "r": r, "lon": lon }


## Math.hypot in doubles (Vector2 holds 32-bit floats, which would not match the web version's numbers)
static func _hypot(x: float, y: float) -> float:
	return sqrt(x * x + y * y)


static func days_since_2000(date_str: String) -> float:
	return float(Time.get_unix_time_from_datetime_string(date_str + "T12:00:00") - 946728000) / DAY_S


## The angle at the Sun between the two planets, 0–180°: 0 = Mars close behind Earth (opposition), 180 = on the far
## side of the Sun (conjunction).
static func sep_deg(E: Dictionary, Mx: Dictionary) -> float:
	var d := fposmod((Mx.lon - E.lon) * 180.0 / PI, 360.0)
	return 360.0 - d if d > 180.0 else d


func planets(date_str: String) -> Dictionary:
	var d := days_since_2000(date_str)
	var E := planet_at(ORBITS.earth, d)
	var Mx := planet_at(ORBITS.mars, d)
	var au := _hypot(E.x - Mx.x, E.y - Mx.y)
	var E1 := planet_at(ORBITS.earth, d + 1)
	var M1 := planet_at(ORBITS.mars, d + 1)
	var closing := _hypot(E1.x - M1.x, E1.y - M1.y) < au      # getting closer or farther? compare with the next day
	return { "date": date_str, "days": d, "earth": E, "mars": Mx, "au": au, "km": au * KM_PER_AU, "minutes": au * LIGHT_MIN_PER_AU,
		"sep": sep_deg(E, Mx), "closing": closing, "orbits": ORBITS }


## A short label for where the two planets are in their dance around the Sun.
static func alignment(p: Dictionary) -> String:
	if p.sep < 35:
		return "close approach"
	if p.sep > 145:
		return "far side of the Sun"
	return "drawing closer" if p.closing else "drawing apart"


## the whole path of a planet, as n points, for drawing (same formula, so the dot sits on the line)
static func orbit_path(planet: String, n: int) -> Array:
	var o: Dictionary = ORBITS[planet]
	var out := []
	for i in n + 1:
		out.append(planet_at(o, float(i) / n * o.period))
	return out


## Estimated one-way radio delay Earth <-> Mars, in minutes, for a real date.
func mars_delay_min(date_str: String) -> float:
	return planets(date_str).minutes


const MONTHS := ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


static func pretty_date(date_str) -> String:
	var p := str(date_str).split("-")
	if p.size() < 3:
		return str(date_str)
	return str(int(p[2])) + " " + MONTHS[int(p[1]) - 1] + " " + p[0]


static func today_iso() -> String:
	return Time.get_date_string_from_system(true)
