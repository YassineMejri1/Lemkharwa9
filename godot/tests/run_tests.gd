extends Node
## Runs every test file and quits with exit code 0 (all passed) or 1. Run without a window:
##   Godot_v4.7.2-stable_win64_console.exe --headless --path godot res://tests/run_tests.tscn
## Pick files with  -- only=rules,world

const FILES := {
	"rules": "res://tests/test_rules.gd",
	"ui": "res://tests/test_ui.gd",
	"crew": "res://tests/test_crew.gd",
}


func _ready() -> void:
	_run.call_deferred()


func _run() -> void:
	var only := []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("only="):
			only = a.substr(5).split(",")
	var passed := 0
	var failed := 0
	for key in FILES:
		if only.size() and not key in only:
			continue
		print("\n=== " + key + " ===")
		var t: TestBase = load(FILES[key]).new()
		t.run()
		passed += t.passed
		failed += t.failed
	print("\n%d passed, %d failed" % [passed, failed])
	get_tree().quit(1 if failed else 0)
