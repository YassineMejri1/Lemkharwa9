extends SceneTree
## Lists the nodes and materials inside each imported model:  godot --headless --path . -s tools/inspect_models.gd
func _initialize() -> void:
	var dir := DirAccess.open("res://assets/models")
	for f in dir.get_files():
		if not f.ends_with(".glb"):
			continue
		var ps: PackedScene = load("res://assets/models/" + f)
		var n := ps.instantiate()
		var out := []
		_walk(n, out, 0)
		print(f + ": " + " ".join(out))
		n.free()
	quit()

func _walk(n: Node, out: Array, depth: int) -> void:
	var s := n.name
	if n is MeshInstance3D and n.mesh:
		var mats := []
		for i in n.mesh.get_surface_count():
			var m = n.mesh.surface_get_material(i)
			mats.append((m.resource_name if m else "none") + ("/T" if m is BaseMaterial3D and m.albedo_texture else "") + ("/VC" if m is BaseMaterial3D and m.vertex_color_use_as_albedo else ""))
		s += "[" + ",".join(mats) + "]"
	if depth > 0:
		out.append(s)
	for c in n.get_children():
		_walk(c, out, depth + 1)
