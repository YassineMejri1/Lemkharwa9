extends SceneTree
## Prints a model's node tree with positions and rotations:  -s res://tools/tree.gd -- astronaut rover
func _initialize() -> void:
	for name in OS.get_cmdline_user_args():
		var n: Node = load("res://assets/models/" + name + ".glb").instantiate()
		print("== ", name)
		_p(n, 0)
		n.free()
	quit()

func _p(n: Node, d: int) -> void:
	var extra := ""
	if n is Node3D:
		extra = " pos=%s rot=%s scale=%s" % [n.position, n.rotation, n.scale]
	if n is MeshInstance3D and n.mesh:
		extra += " aabb=%s" % [n.mesh.get_aabb()]
	print("  ".repeat(d), n.name, " (", n.get_class(), ")", extra)
	for c in n.get_children():
		_p(c, d + 1)
