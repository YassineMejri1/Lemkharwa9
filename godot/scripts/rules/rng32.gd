class_name Rng32
extends RefCounted
## mulberry32, bit for bit the same as rng32() in sim.js: the same seed plans the same mission in both versions.

var a: int = 0


func _init(seed_value: int = 0) -> void:
	a = seed_value & 0xFFFFFFFF


## A number in [0, 1), like Math.random().
func next() -> float:
	a = (a + 0x6D2B79F5) & 0xFFFFFFFF
	var t := Js.imul((a ^ (a >> 15)) & 0xFFFFFFFF, (1 | a) & 0xFFFFFFFF)
	t = ((t + Js.imul((t ^ (t >> 7)) & 0xFFFFFFFF, (61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
