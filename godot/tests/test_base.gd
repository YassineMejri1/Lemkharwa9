class_name TestBase
extends RefCounted
## A tiny test toolkit: ok(name, condition, extra). Each test file extends this and has a run() method.

var passed := 0
var failed := 0
var quiet := false


func ok(name: String, cond: bool, extra: String = "") -> bool:
	if cond:
		passed += 1
	else:
		failed += 1
	if not cond or not quiet:
		print(("PASS " if cond else "FAIL ") + name + ("  [" + extra + "]" if extra != "" else ""))
	return cond


func run() -> void:
	pass
