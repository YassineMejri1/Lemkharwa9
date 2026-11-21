extends Node
## Astro Outpost — game data: sites, levels, rules, discoveries, instruments, facts (the old JA.* tables).
## The tables live in data/game_data.json, exported from js/data.js by tools/godot/export_data.js, so the web and the
## Godot versions can never disagree. Numbers marked REAL in js/data.js come from NASA (or the cited paper); numbers
## marked GAME are simplified game scales, and the in-game "Real science" page says so.
##
## JSON numbers arrive as floats. The rules keep them as floats (JavaScript has no integers either) and turn them into
## ints only to count or to index.

const DATA_PATH := "res://data/game_data.json"

var SOURCES: Dictionary
var SITES: Dictionary
var LEVELS: Dictionary
var SHIFTS: Array
var RULES: Dictionary
var MATS: Dictionary
var BUILDS: Dictionary
var CROPS: Dictionary
var MACHINES: Dictionary
var ITEMS: Dictionary
var GEO: Dictionary
var INSTRUMENTS: Dictionary
var PHOTOS: Dictionary
var DAYS: Array
var LAUNCH_DAY: Dictionary
var REPAIRS: Dictionary
var FACTS: Array
var MECHS: Array
var RANKS: Dictionary
var FAIL: Dictionary
## the order the levels appear in (a Dictionary from JSON keeps it, but this says so)
const LEVEL_ORDER := ["cadet", "commander", "veteran"]
## The planets in the order they unlock. Those after Mars live in data/planets.json (this game only: game_data.json
## is written from the web version). Each names the world it is built on ("like") and lists what differs. Its "id"
## stays that world, so every "moon" / "mars" branch and table still works; "planet" is the planet itself.
const PLANETS_PATH := "res://data/planets.json"
const PLANET_ORDER := ["moon", "mars", "europa", "titan", "io", "sahrun"]


func _init() -> void:
	var d: Dictionary = load_json(DATA_PATH)
	SOURCES = d.SOURCES
	SITES = d.SITES
	for k in SITES:
		SITES[k].planet = k
	var planets: Dictionary = load_json(PLANETS_PATH)
	for k in planets:
		var own: Dictionary = planets[k]
		var p: Dictionary = SITES[own.like].duplicate(true)
		for f in own:
			if f == "env":
				for e in own.env:
					p.env[e].merge(own.env[e], true)
			else:
				p[f] = own[f]
		p.planet = k
		SITES[k] = p
	LEVELS = d.LEVELS
	SHIFTS = d.SHIFTS
	RULES = d.RULES
	MATS = d.MATS
	BUILDS = d.BUILDS
	CROPS = d.CROPS
	MACHINES = d.MACHINES
	ITEMS = d.ITEMS
	GEO = d.GEO
	INSTRUMENTS = d.INSTRUMENTS
	PHOTOS = d.PHOTOS
	DAYS = d.DAYS
	LAUNCH_DAY = d.LAUNCH_DAY
	REPAIRS = d.REPAIRS
	FACTS = d.FACTS
	MECHS = d.MECHS
	RANKS = d.RANKS
	FAIL = d.FAIL


static func load_json(path: String):
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("Astro Outpost: could not read " + path)
		return {}
	var v = JSON.parse_string(text)
	if v == null:
		push_error("Astro Outpost: " + path + " is not valid JSON")
		return {}
	return v


## One "why did that happen?" explanation by id (JA.mech).
func mech(id: String):
	for m in MECHS:
		if m.id == id:
			return m
	return null


## The words and source of an explanation for one place: some differ between the Moon and Mars (JA.mechFor).
func mech_for(id: String, site: String):
	var m = mech(id)
	if m == null:
		return null
	return { "id": m.id, "icon": m.icon, "title": m.title, "holo": m.get("holo", null), "hint": m.get("hint", ""),
		"text": Js.by_site(m.text, site), "src": Js.by_site(m.src, site) }


## A source's name, for the small "Source:" line under a fact.
func source_name(id) -> String:
	var x = SOURCES.get(str(id))
	return x.name if x else ""
