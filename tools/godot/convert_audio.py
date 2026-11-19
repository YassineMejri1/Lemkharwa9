"""Copies the game's sounds into the Godot project (godot/assets/audio).

One-shot sounds, voice lines and music stay mp3. The looping sounds (machines, the rover, the background beds) are
made seamless the same way js/audio.js did it at run time: the silence an mp3 carries at both ends is cut and the
tail is faded into the head. They are written as .ogg, which Godot loops without a gap.
Needs ffmpeg on the PATH and numpy.   python tools/godot/convert_audio.py
"""
import json, os, shutil, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "audio")
DST = os.path.join(ROOT, "godot", "assets", "audio")
META = json.load(open(os.path.join(ROOT, "godot", "data", "sfx.json"), encoding="utf-8"))
SR = 44100


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def seamless(d):
    n = len(d)
    th = 0.003
    loud = np.nonzero(np.abs(d[:, 0]) >= th)[0]
    if len(loud) == 0:
        return d
    a, z = loud[0], loud[-1]
    length = z - a + 1
    xf = int(min(0.7 * SR, length * 0.2))
    out_len = length - xf
    if out_len < SR * 0.5:
        return d
    out = d[a:a + out_len].copy()
    u = np.arange(xf) / xf * 1.5708
    out[:xf] = d[a:a + xf] * np.sin(u)[:, None] + d[a + out_len:a + out_len + xf] * np.cos(u)[:, None]
    return out


def encode_ogg(d, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-", "-c:a", "libvorbis", "-q:a", "5", path],
                   input=d.astype(np.float32).tobytes(), check=True)


def main():
    for sub in ["voice", "music", "landing"]:
        os.makedirs(os.path.join(DST, sub), exist_ok=True)
        for f in os.listdir(os.path.join(SRC, sub)):
            if f.endswith(".mp3"):
                shutil.copy2(os.path.join(SRC, sub, f), os.path.join(DST, sub, f))
    os.makedirs(os.path.join(DST, "sfx"), exist_ok=True)
    loops = 0
    for f in sorted(os.listdir(os.path.join(SRC, "sfx"))):
        if not f.endswith(".mp3"):
            continue
        name = f[:-4]
        if META.get(name, {}).get("loop"):
            encode_ogg(seamless(decode(os.path.join(SRC, "sfx", f))), os.path.join(DST, "sfx", name + ".ogg"))
            loops += 1
        else:
            shutil.copy2(os.path.join(SRC, "sfx", f), os.path.join(DST, "sfx", f))
    print("sounds copied,", loops, "loops made seamless")


if __name__ == "__main__":
    sys.exit(main())
