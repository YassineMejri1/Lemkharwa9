class_name Js
## Small helpers that make GDScript behave like the JavaScript the rules were first written in, so the numbers
## (and the words built from them) come out exactly the same as in the web version.


## Math.round: halves round up (toward +infinity), unlike GDScript's round(), which rounds them away from zero.
static func mround(x: float) -> int:
	return int(floor(x + 0.5))


## A number written the way JavaScript writes it in text: 5 (not 5.0), 2.5, -3.
static func num(v) -> String:
	if v is int:
		return str(v)
	var f := float(v)
	if is_equal_approx(f, roundf(f)) and absf(f) < 1e15:
		return str(int(roundf(f)))
	return str(f)


## Number.prototype.toFixed
static func fixed(v: float, digits: int) -> String:
	return ("%." + str(digits) + "f") % v if digits > 0 else str(Js.mround(v))


## toLocaleString('en-US') for whole numbers: 1,234,567
static func grouped(v: float) -> String:
	var n := Js.mround(v)
	var neg := n < 0
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if neg else "") + s + out


## A text, or one of two texts chosen by site ({ "moon": ..., "mars": ... }), as data.js does it.
static func by_site(v, site: String):
	if v is Dictionary:
		return v.get(site)
	return v


## Math.imul: a 32-bit multiply, without relying on 64-bit overflow.
static func imul(a: int, b: int) -> int:
	var al := a & 0xFFFF
	var ah := (a >> 16) & 0xFFFF
	var bl := b & 0xFFFF
	var bh := (b >> 16) & 0xFFFF
	return (al * bl + (((ah * bl + al * bh) & 0xFFFF) << 16)) & 0xFFFFFFFF


## A deep copy of plain data (Dictionary / Array) that leaves objects (such as an Rng32) shared.
static func copy(v):
	if v is Dictionary or v is Array:
		return v.duplicate(true)
	return v


## Array.prototype.indexOf, comparing with == so that 2 finds 2.0 (JSON numbers arrive as floats)
static func index_of(arr: Array, v) -> int:
	for i in arr.size():
		if typeof(arr[i]) == typeof(v) or (arr[i] is float or arr[i] is int) and (v is float or v is int):
			if arr[i] == v:
				return i
	return -1


## JavaScript truthiness: null, false, 0, NaN and "" are false (an empty Dictionary or Array is TRUE, unlike GDScript)
static func truthy(v) -> bool:
	if v == null:
		return false
	if v is bool:
		return v
	if v is int:
		return v != 0
	if v is float:
		return v != 0.0 and not is_nan(v)
	if v is String or v is StringName:
		return v != ""
	return true


## a || b
static func orv(a, b):
	return a if Js.truthy(a) else b


## [...].filter(Boolean)
static func compact(arr: Array) -> Array:
	return arr.filter(func(x): return Js.truthy(x))
