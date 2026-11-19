extends Node
## The Field Journal. Every piece of real science you meet (a "why did that happen?" card, a rock discovery, a
## night-report fact, what real crews did in a crisis...) becomes a page here and stays, mission after mission.
## Pages not found yet show a hint about where to look. Kept on this computer only (user://journal.json).
## A port of js/journal.js.

const FILE := "user://journal.json"
const GROUPS := [
	{ "kind": "why", "icon": "🧠", "name": "Why things happen" },
	{ "kind": "find", "icon": "🔬", "name": "Rock discoveries" },
	{ "kind": "inst", "icon": "🛰️", "name": "Instruments" },
	{ "kind": "photo", "icon": "📸", "name": "Postcards" },
	{ "kind": "crisis", "icon": "🧭", "name": "What real crews did" },
	{ "kind": "day", "icon": "💡", "name": "Daily lessons" },
	{ "kind": "fact", "icon": "🛰️", "name": "Real space facts" },
]
var data = null
var cache := {}


func _load() -> Dictionary:
	if data != null:
		return data
	data = {}
	if FileAccess.file_exists(FILE):
		var j = JSON.parse_string(FileAccess.get_file_as_string(FILE))
		if j is Dictionary:
			data = j
	return data


func _save() -> void:
	var f := FileAccess.open(FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))


static func _pick(v, site: String) -> String:
	if v is String:
		return v
	if v is Dictionary:
		return str(v.get(site, ""))
	return "" if v == null else str(v)


## Every page there is to find in one place, in the order the journal shows them.
func pages(site: String) -> Array:
	if cache.has(site):
		return cache[site]
	var out: Array = []
	var word := "sol" if site == "mars" else "day"
	var add_page := func(kind: String, id, icon: String, title: String, text: String, src, hint: String, holo = ""):
		out.append({ "kind": kind, "id": str(id), "icon": icon, "title": title, "text": text, "src": src, "hint": hint, "holo": holo if holo else "" })
	for m in Data.MECHS:
		if not m.get("site") or m.site == site:
			add_page.call("why", m.id, m.icon, m.title, _pick(m.text, site), _pick(m.get("src"), site), str(m.get("hint", "")), m.get("holo", ""))
	var geo: Array = Data.GEO.get(site, [])
	for i in geo.size():
		var place: Dictionary = geo[i]
		for n in place.finds.size():
			var f: Dictionary = place.finds[n]
			add_page.call("find", str(i) + "-" + str(n), place.icon, f.title, f.text, f.get("src"), "Drill " + ("a second" if n else "a") + " rock core at the " + place.name + " and study it in the Lab.")
	for x in Data.INSTRUMENTS.get(site, []):
		add_page.call("inst", x.id, x.icon, x.name, x.text, x.get("src"), "Carry the " + x.name + " from the rocket pad to its blue ring.")
	var photos: Array = Data.PHOTOS.get(site, [])
	for i in photos.size():
		var x: Dictionary = photos[i]
		add_page.call("photo", i, "📸", x.name, x.text, x.get("src"), "Find a photo spot and take a postcard photo.")
	for id in Crisis.ORDER:
		var c: Dictionary = Crisis.C[id]
		var fake := { "site": { "id": site } }
		add_page.call("crisis", id, c.icon, c.title, Crisis.science_for(id, fake), Crisis.src_for(id, fake), "Live through this crisis: " + str(c.alarm).to_lower() + ". It does not come on every mission.")
	for i in Data.DAYS.size():
		var d: Dictionary = Data.DAYS[i]
		add_page.call("day", i, d.icon, d.topic, _pick(d.learn, site), _pick(d.get("src"), site), "Reach " + word + " " + str(i + 1) + " of a mission.")
	if not Data.LAUNCH_DAY.is_empty():
		var L: Dictionary = Data.LAUNCH_DAY
		add_page.call("day", "launch", L.icon, L.topic, _pick(L.learn, site), _pick(L.get("src"), site), "Reach the last " + word + " of a mission.")
	for f in Data.FACTS:
		if f.site == "any" or f.site == site:
			add_page.call("fact", f.id, "🛰️", "", f.text, f.get("src"), "Turns up in a night report.")
	cache[site] = out
	return out


func has(site: String, kind: String, id) -> bool:
	var d = _load().get(site)
	return d is Dictionary and d.has(kind + ":" + str(id))


## Write a page into the journal. Returns true the first time, so the game can celebrate a new page.
func add(site: String, kind: String, id) -> bool:
	if not Data.SITES.has(site):
		return false
	var k := kind + ":" + str(id)
	if not pages(site).any(func(p): return p.kind == kind and p.id == str(id)):
		return false
	var d: Dictionary = _load()
	if not d.has(site):
		d[site] = {}
	if d[site].has(k):
		return false
	d[site][k] = 1
	_save()
	return true


func count(site: String) -> Dictionary:
	var have := 0
	var all := pages(site)
	for p in all:
		if has(site, p.kind, p.id):
			have += 1
	return { "have": have, "total": all.size() }


func totals() -> Dictionary:
	var a := count("moon")
	var b := count("mars")
	return { "have": a.have + b.have, "total": a.total + b.total }


func _page_html(site: String, p: Dictionary, can_holo: Callable) -> String:
	if not has(site, p.kind, p.id):
		return "<div class=\"info-row\"><span class=\"ic\">❔</span><div><b>Not found yet</b><p>" + Html.esc(p.hint) + "</p></div></div>"
	var src = Data.SOURCES.get(p.src) if p.src is String else null
	return "<div class=\"info-row\"><span class=\"ic\">" + p.icon + "</span><div>" + (("<b>" + Html.esc(p.title) + "</b>") if p.title != "" else "") + "<p>" + Html.esc(p.text) + "</p>" \
		+ (("<small>Source: " + Html.esc(src.name) + "</small>") if src else "") \
		+ (("<button class=\"btn ghost small\" data-act=\"holo\" data-v=\"" + p.holo + "\">▶ Play the hologram</button>") if p.holo != "" and can_holo.call(p.holo) else "") + "</div></div>"


func html(site: String, can_holo: Callable) -> String:
	var all := pages(site)
	var c := count(site)
	var moon := count("moon")
	var mars := count("mars")
	var out := "<h2>📓 Field Journal</h2><p class=\"sub\">Every piece of real science you meet is kept here, mission after mission. Empty pages tell you where to look.</p>" \
		+ "<div class=\"modal-actions\"><button class=\"btn " + ("primary" if site == "moon" else "ghost") + "\" data-act=\"site\" data-v=\"moon\">🌙 Moon " + str(moon.have) + "/" + str(moon.total) + "</button>" \
		+ "<button class=\"btn " + ("primary" if site == "mars" else "ghost") + "\" data-act=\"site\" data-v=\"mars\">🔴 Mars " + str(mars.have) + "/" + str(mars.total) + "</button></div>" \
		+ "<p class=\"sub\"><b>" + str(c.have) + "</b> of " + str(c.total) + " pages found on " + Html.esc(Data.SITES[site].name) + (" · every single one! 🏆" if c.have >= c.total else "") + "</p>"
	for g in GROUPS:
		var list: Array = all.filter(func(p): return p.kind == g.kind)
		if list.is_empty():
			continue
		var found: Array = list.filter(func(p): return has(site, p.kind, p.id))
		var missing: Array = list.filter(func(p): return not has(site, p.kind, p.id))
		out += "<h3>" + g.icon + " " + g.name + " · " + str(found.size()) + "/" + str(list.size()) + "</h3>"
		# found pages first, so there is something to read at the top of each chapter; then a few of the empty ones
		for p in found:
			out += _page_html(site, p, can_holo)
		var show := 3 if found.size() else 2
		for i in mini(missing.size(), show):
			out += _page_html(site, missing[i], can_holo)
		if missing.size() > show:
			out += "<p class=\"sub\">…and " + str(missing.size() - show) + " more pages still to find.</p>"
	return out


## Open the journal on top of whatever is showing. hooks.holo(id) plays a hologram; hooks.sound() makes the tap sound.
func open(site: String, hooks: Dictionary = {}) -> void:
	var can_holo := func(id) -> bool: return hooks.has("holo") and Game.holo_has(id)
	_draw(site if Data.SITES.has(site) else "moon", hooks, can_holo)


func _draw(site: String, hooks: Dictionary, can_holo: Callable) -> void:
	var doc: Html.Doc = Game.open_info(html(site, can_holo))
	doc.on("site", func(el):
		if hooks.has("sound"):
			hooks.sound.call()
		_draw(str(Html.attr(el, "data-v")), hooks, can_holo))
	doc.on("holo", func(el): hooks.holo.call(str(Html.attr(el, "data-v"))))
