extends Node
## Compile check with the autoloads present: loads every add-on script (or the ones named with files=a.gd,b.gd)
## and prints whether each one compiled. Run: godot --headless --path . res://tools/check.tscn -- files=interior


func _ready() -> void:
	var names := []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("files="):
			names = a.substr(6).split(",")
	if names.is_empty():
		for f in DirAccess.get_files_at("res://scripts/addons"):
			if f.ends_with(".gd"):
				names.append(f.get_basename())
	for n in names:
		var path: String = n if n.begins_with("res://") else "res://scripts/addons/" + n + ".gd"
		var sc = load(path)
		var ok: bool = sc != null and sc.can_instantiate()
		print("[check] ", path, " ", "OK" if ok else "FAILED")
	get_tree().quit()
