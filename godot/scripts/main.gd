extends Node
## The game's first scene: everything lives in the autoloads, this only starts them in order.

func _ready() -> void:
	Game.boot.call_deferred()
