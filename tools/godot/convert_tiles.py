"""Astro Outpost - turn the regolith tiles exported by export_surface.js into PNG files.
Godot's JPEG decoder stalls on the JPEGs that Blender wrote, so the Godot version uses PNG copies.
Run from the repository root, after export_surface.js:  python tools/godot/convert_tiles.py"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'godot', 'assets', 'surface')
for name in ['ground_moon_a', 'ground_moon_n', 'ground_mars_a', 'ground_mars_n']:
    src = os.path.join(OUT, name + '.jpg')
    Image.open(src).convert('RGB').save(os.path.join(OUT, name + '.png'))
    os.remove(src)
    imp = src + '.import'
    if os.path.exists(imp):
        os.remove(imp)
    print('wrote', name + '.png')
