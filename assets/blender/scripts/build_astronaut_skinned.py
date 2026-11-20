"""The astronaut of the Godot game (godot/assets/models/astronaut.glb), made from a detailed sculpted suit:
'Astronaut' by Jungle Jim (assets/blender/source/astronaut_jungle_jim.fbx).

That FBX is one still mesh with no skeleton, 1 unit tall, in an A-pose. This script rigs it to the joints the game
already animates (actors.gd), so the walk, run, jump, sit, drive, drill and throw poses all keep working:
  - it joins the suit and the life-support pack, puts the ankles over the origin and scales the suit so the hip joints
    sit at the game's RIG.hipY (0.86 model units);
  - it gives every vertex smooth weights for 14 bones: hips, body, legL/R, shinL/R, footL/R, armL/R, foreL/R, handL/R
    (the helmet, the chest hoses and the pack ride rigidly on the body; small loose bits move as one piece);
  - it lowers the A-pose arms so they hang at the sides, as the game's poses expect (the old astronaut's rest pose);
  - it adds empties named astro_hips, astro_body, astro_legL ... at the joints, the same names and parent/child order
    as the old part-built astronaut. actors.gd turns those empties and copies them onto the skeleton every frame;
  - it splits the skin in two: astro_torso (hips, chest, helmet, pack: hidden in helmet view) and astro_limbs;
  - it keeps the old astronaut's drill (astro_drill, astro_drillBit), placed between the hands of the drilling pose,
    and its blinking light (astro_antennaTip), now on a short antenna on top of the pack;
  - the orange trim becomes 'SuitAccent', which the game paints in each player's suit colour.
'L' parts are on -x, as before. Blender: +z up, the suit faces -y (game: +y up, faces +z).

Run:  blender -b --factory-startup --python assets/blender/scripts/build_astronaut_skinned.py
      (add  -- preview=DIR  to also render a few game poses there, to check the skinning)
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Vector, Quaternion, Matrix

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPTS)))
SRC = os.path.join(REPO, 'assets', 'blender', 'source', 'astronaut_jungle_jim.fbx')
OLD = os.path.join(REPO, 'assets', 'models', 'astronaut.glb')        # the old astronaut (web game): drill and light
OUT = os.path.join(REPO, 'godot', 'assets', 'models', 'astronaut.glb')

# ---- joints of the FBX, in its own units (1 = the suit's height), measured on the mesh; left side (-x) ----
HIP_Z, KNEE_Z, ANKLE_Z, WAIST_Z = 0.485, 0.28, 0.08, 0.56
LEG_X, LEG_Y = -0.088, -0.045               # hip, knee and ankle on one vertical line, so the game's leg IK fits
SHOULDER = Vector((-0.17, -0.035, 0.745))
ELBOW = Vector((-0.241, -0.067, 0.659))
WRIST = Vector((-0.279, -0.102, 0.574))
FINGERS = Vector((-0.330, -0.149, 0.458))
ARM_OUT = math.radians(12)                  # the upper arms hang this far out from the sides (the game adds its own swing)
SHIFT_Y = -LEG_Y                            # the ankles go over the origin
K = 0.86 / HIP_Z                            # model units per FBX unit: hips at the game's RIG.hipY

BONES = ['hips', 'body', 'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
         'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR']
PARENT = {'hips': None, 'body': 'hips', 'legL': 'hips', 'shinL': 'legL', 'footL': 'shinL', 'legR': 'hips',
          'shinR': 'legR', 'footR': 'shinR', 'armL': 'body', 'foreL': 'armL', 'handL': 'foreL',
          'armR': 'body', 'foreR': 'armR', 'handR': 'foreR'}
B = {n: i for i, n in enumerate(BONES)}


def smooth(e0, e1, x):
    """smoothstep from e0 (0) to e1 (1); e0 > e1 runs the other way"""
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp_keys(z, keys):
    """piecewise-linear value at heights z from [(z, value), ...] sorted by z"""
    return np.interp(z, [k[0] for k in keys], [k[1] for k in keys])


# ---------------------------------------------------------------- the mesh
def load_suit():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=SRC)
    parts = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(o in parts)
    bpy.context.view_layer.objects.active = max(parts, key=lambda o: len(o.data.vertices))
    bpy.ops.object.join()
    suit = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    suit.name = suit.data.name = 'astro_skin'
    return suit


def islands(me):
    """connected pieces of the mesh: an island number for every vertex"""
    n = len(me.vertices)
    ev = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', ev)
    parent = np.arange(n)

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b in ev.reshape(-1, 2):
        ra, rb = root(a), root(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([root(i) for i in range(n)])


# ---------------------------------------------------------------- the weights
def arm_frame(side):
    """shoulder, elbow, wrist and fingertips of one arm (side -1 = L, +1 = R)"""
    m = Vector((-side, 1, 1)) if side > 0 else Vector((1, 1, 1))
    return [Vector((p.x * m.x, p.y, p.z)) for p in (SHOULDER, ELBOW, WRIST, FINGERS)]


def weights(co, isl):
    """(n, 14) bone weights for the vertices co (FBX units)"""
    n = len(co)
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    W = np.zeros((n, len(BONES)))
    ax = -np.abs(x)                                      # every vertex seen as if on the left side
    # how much a vertex belongs to an arm: beyond a boundary that runs down the side of the chest, through the armpit
    # (where arm and chest touch) and out between the hands and the hips
    lo = lerp_keys(z, [(0.60, -0.185), (0.66, -0.15), (0.70, -0.175)])     # all arm from here outwards
    hi = lerp_keys(z, [(0.60, -0.165), (0.66, -0.135), (0.70, -0.12)])     # no arm from here inwards
    arm = smooth(hi, lo, ax) * (z > 0.43)
    for side, names in ((-1, ('armL', 'foreL', 'handL')), (1, ('armR', 'foreR', 'handR'))):
        S, E, Wr, T = (np.array(v) for v in arm_frame(side))
        u1, u2, u3 = ((b - a) / np.linalg.norm(b - a) for a, b in ((S, E), (E, Wr), (Wr, T)))
        ne = (u1 + u2) / np.linalg.norm(u1 + u2)
        nw = (u2 + u3) / np.linalg.norm(u2 + u3)
        fore = smooth(-0.02, 0.02, (co - E) @ ne)
        hand = smooth(-0.006, 0.012, (co - Wr) @ nw)
        on = arm * (np.sign(x) == side)
        W[:, B[names[0]]] = on * (1 - fore)
        W[:, B[names[1]]] = on * fore * (1 - hand)
        W[:, B[names[2]]] = on * fore * hand
    rest = 1 - arm
    # legs below the hips: thigh, then shin below the knee, then foot below the ankle; the two legs meet at the crotch
    leg = smooth(0.50, 0.43, z) * rest
    shin = smooth(0.31, 0.25, z)
    foot = smooth(0.10, 0.06, z)
    left = smooth(0.012, -0.012, x)
    for s, names in ((left, ('legL', 'shinL', 'footL')), (1 - left, ('legR', 'shinR', 'footR'))):
        W[:, B[names[0]]] = leg * s * (1 - shin)
        W[:, B[names[1]]] = leg * s * shin * (1 - foot)
        W[:, B[names[2]]] = leg * s * shin * foot
    torso = rest * (1 - smooth(0.50, 0.43, z))
    body = smooth(0.53, 0.61, z)
    W[:, B['hips']] = torso * (1 - body)
    W[:, B['body']] = torso * body
    # pieces that are not the suit itself: the helmet, the hoses, the pack ride on the body; small bits move as one
    main = np.bincount(isl).argmax()
    for k in np.unique(isl):
        if k == main:
            continue
        idx = np.nonzero(isl == k)[0]
        c = co[idx].mean(axis=0)
        if c[2] > 0.53 and abs(c[0]) < 0.17:
            W[idx] = 0
            W[idx, B['body']] = 1
        else:
            W[idx] = W[idx].mean(axis=0)
    W[W < 1e-3] = 0
    return W / W.sum(axis=1, keepdims=True)


# ---------------------------------------------------------------- arms down
def arm_turn(side):
    """the turn about the shoulder that brings an A-pose arm down to the side"""
    S, E, _, _ = arm_frame(side)
    want = Vector((side * math.sin(ARM_OUT), 0, -math.cos(ARM_OUT)))
    return (E - S).normalized().rotation_difference(want)


def lower_arms(co, nrm, loop_v, W):
    """move the arm vertices (and the corner normals) as the arm bones turn: linear blend skinning, like the game"""
    out_co, out_n = co.copy(), nrm.copy()
    for side, names in ((-1, ('armL', 'foreL', 'handL')), (1, ('armR', 'foreR', 'handR'))):
        S = np.array(arm_frame(side)[0])
        R = np.array(arm_turn(side).to_matrix())
        w = W[:, [B[n] for n in names]].sum(axis=1)
        out_co += w[:, None] * (((co - S) @ R.T + S) - co)
        wl = w[loop_v]
        out_n += wl[:, None] * (nrm @ R.T - nrm)
    out_n /= np.linalg.norm(out_n, axis=1, keepdims=True)
    return out_co, out_n


def joints():
    """every joint after the arms come down, in model units (Blender axes)"""
    J = {}
    f = lambda p: Vector(((p.x) * K, (p.y + SHIFT_Y) * K, p.z * K))
    J['hips'] = f(Vector((0, LEG_Y, HIP_Z)))
    J['body'] = f(Vector((0, LEG_Y, WAIST_Z)))
    for side, s in ((-1, 'L'), (1, 'R')):
        J['leg' + s] = f(Vector((side * -LEG_X, LEG_Y, HIP_Z)))
        J['shin' + s] = f(Vector((side * -LEG_X, LEG_Y, KNEE_Z)))
        J['foot' + s] = f(Vector((side * -LEG_X, LEG_Y, ANKLE_Z)))
        S, E, Wr, T = arm_frame(side)
        q = arm_turn(side)
        J['arm' + s] = f(S)
        J['fore' + s] = f(S + q @ (E - S))
        J['hand' + s] = f(S + q @ (Wr - S))
        J['tips' + s] = f(S + q @ (T - S))
    return J


# ---------------------------------------------------------------- the game's pose maths (Godot axes), for the drill
def g(v):
    return np.array([v[0], v[2], -v[1]])


def euler_xyz(a):
    cx, sx, cy, sy, cz, sz = math.cos(a[0]), math.sin(a[0]), math.cos(a[1]), math.sin(a[1]), math.cos(a[2]), math.sin(a[2])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def xf(pos, rot):
    m = np.eye(4)
    m[:3, :3] = euler_xyz(rot)
    m[:3, 3] = pos
    return m


def drill_pose(J):
    """the game's drilling pose (actors.gd pose(), mode busy): where the palms end up, seen from the body joint"""
    hips = xf([0, 0.86 - 0.07, 0], (0, 0, 0))
    body = hips @ xf(g(J['body'] - J['hips']), (0.2, 0, 0))
    palms = []
    for s, azr in (('L', 0.3), ('R', -0.3)):
        arm = body @ xf(g(J['arm' + s] - J['body']), (-0.95, 0, azr))
        fore = arm @ xf(g(J['fore' + s] - J['arm' + s]), (-0.7, 0, 0))
        hand = fore @ xf(g(J['hand' + s] - J['fore' + s]), (-0.3, 0, 0))
        palm = hand @ np.append(0.45 * g(J['tips' + s] - J['hand' + s]), 1)
        palms.append((np.linalg.inv(body) @ palm)[:3])
    return body, palms


# ---------------------------------------------------------------- building the model
def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def set_materials(suit):
    for m in suit.data.materials:
        if 'Safety orange' in m.name:
            m.name = 'SuitAccent'
        elif 'Helmet lamps' in m.name:
            p = principled(m)
            p.inputs['Emission Color'].default_value = p.inputs['Base Color'].default_value
            p.inputs['Emission Strength'].default_value = 2.5


def old_parts():
    """the drill, its bit and the blinking light of the old astronaut, as loose meshes"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=OLD)
    got = {}
    for o in set(bpy.data.objects) - before:
        if o.name in ('astro_drill', 'astro_drillBit', 'astro_antennaTip'):
            got[o.name] = o.data
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o, do_unlink=True)
    return got


def empty(name, parent, loc):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.empty_display_size = 0.08
    return o


def mesh_obj(name, data, parent, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    return o


def build(preview=None):
    suit = load_suit()
    me = suit.data
    n = len(me.vertices)
    co = np.zeros(n * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    loop_v = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', loop_v)
    nrm = np.zeros(len(me.loops) * 3)
    me.corner_normals.foreach_get('vector', nrm)
    nrm = nrm.reshape(-1, 3)

    W = weights(co, islands(me))
    co, nrm = lower_arms(co, nrm, loop_v, W)
    co = (co + np.array([0, SHIFT_Y, 0])) * K
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    me.normals_split_custom_set([tuple(v) for v in nrm])
    set_materials(suit)
    for name in BONES:
        vg = suit.vertex_groups.new(name=name)
        col = W[:, B[name]]
        for i in np.nonzero(col)[0]:
            vg.add([int(i)], float(col[i]), 'REPLACE')

    # helmet view hides the torso: hips, chest, helmet and pack
    tw = W[:, B['hips']] + W[:, B['body']]
    torso_face = [tw[list(p.vertices)].mean() >= 0.5 for p in me.polygons]
    bpy.ops.object.select_all(action='DESELECT')
    suit.select_set(True)
    bpy.context.view_layer.objects.active = suit
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    for f in bm.faces:
        f.select_set(False)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        if torso_face[f.index]:
            f.select_set(True)
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    torso = next(o for o in bpy.context.selected_objects if o != suit)
    torso.name = torso.data.name = 'astro_torso'
    suit.name = suit.data.name = 'astro_limbs'

    old = old_parts()

    # skeleton: every bone points up with no roll, so in the game its rest has no turn, like the empties
    J = joints()
    root = empty('Astronaut', None, (0, 0, 0))
    arm_data = bpy.data.armatures.new('astro_rig')
    rig = bpy.data.objects.new('astro_rig', arm_data)
    bpy.context.scene.collection.objects.link(rig)
    rig.parent = root
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = J[name]
        eb.tail = J[name] + Vector((0, 0, 0.1))
        eb.roll = 0
    for name in BONES:
        if PARENT[name]:
            arm_data.edit_bones[name].parent = arm_data.edit_bones[PARENT[name]]
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in (torso, suit):
        o.parent = rig
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig

    # the empties the game turns (the old astronaut's node names and pivots)
    E = {}
    for name in BONES:
        p = PARENT[name]
        E[name] = empty('astro_' + name, E[p] if p else root, J[name] - (J[p] if p else Vector()))

    # the blinking light, on a short antenna on top of the pack (right side, at the back, like the old one)
    pack_top = co[(np.abs(co[:, 0] - 0.12 * K) < 0.02 * K) & (np.abs(co[:, 1] - 0.155 * K) < 0.02 * K)][:, 2].max()
    base = Vector((0.12 * K, 0.155 * K, pack_top - 0.01))
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.008, depth=0.13, location=base + Vector((0, 0, 0.065)))
    stalk = bpy.context.active_object
    stalk.name = stalk.data.name = 'astro_antenna'
    stalk.data.materials.append(next(m for m in suit.data.materials if 'Gunmetal' in m.name))
    for poly in stalk.data.polygons:
        poly.use_smooth = True
    stalk.parent = E['body']
    stalk.location = base + Vector((0, 0, 0.065)) - J['body']
    tip = mesh_obj('astro_antennaTip', old['astro_antennaTip'], E['body'], base + Vector((0, 0, 0.14)) - J['body'])
    tip.scale = (0.4, 0.4, 0.4)

    # the drill: its T-handle (0.31 either side of the middle, 0.29 above the drill's origin) between the palms of the
    # drilling pose; the bit long enough to reach the ground
    body_m, palms = drill_pose(J)
    mid = (palms[0] + palms[1]) / 2
    s = float(np.clip(abs(palms[0][0] - palms[1][0]) / 2 / 0.31, 0.5, 1.0))
    origin = mid - np.array([0, 0.29 * s, 0])
    o_world = body_m @ np.append(origin, 1)
    down = body_m[:3, :3] @ np.array([0, -1, 0])
    reach = (o_world[1] + 0.03) / -down[1]
    drill = mesh_obj('astro_drill', old['astro_drill'], E['body'], Vector((origin[0], -origin[2], origin[1])))
    drill.scale = (s, s, s)
    bit = mesh_obj('astro_drillBit', old['astro_drillBit'], drill)
    bit.scale = (1, 1, reach / (0.9 * s))

    print('RIG for actors.gd: hipX %.3f hipY %.3f kneeY %.3f ankleY %.3f waistY %.3f shX %.3f shY %.3f elbowY %.3f wristY %.3f'
          % (-J['legL'].x, J['hips'].z, J['shinL'].z, J['footL'].z, J['body'].z, -J['armL'].x, J['armL'].z, J['foreL'].z, J['handL'].z))
    sole = co[co[:, 2] < 0.02 * K]
    print('foot: front %.3f back %.3f (toe ~ 3/4 of the front, heel ~ 4/5 of the back), height %.3f'
          % (-sole[:, 1].min(), sole[:, 1].max(), co[:, 2].max()))
    print('drill: scale %.2f origin %s, bit x%.2f' % (s, np.round(origin, 3), reach / (0.9 * s)))

    if preview:
        render_poses(rig, preview)
        for pb in rig.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_euler = (0, 0, 0)

    bpy.ops.object.select_all(action='DESELECT')
    for o in [root] + list(root.children_recursive):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False,
                              export_skins=True, export_animations=False, export_morph=False, export_yup=True,
                              export_def_bones=False, export_extras=False, export_cameras=False, export_lights=False)
    print('wrote', OUT)


# ---------------------------------------------------------------- checking the skin
POSES = {
    'rest': {},
    'walk': {'legL': (-0.55, 0, -0.03), 'shinL': (0.35, 0, 0), 'footL': (0.2, 0, 0), 'legR': (0.35, 0, 0.03),
             'shinR': (0.9, 0, 0), 'footR': (-0.3, 0, 0), 'armL': (0.5, 0, 0.2), 'foreL': (-0.5, 0, 0),
             'armR': (-0.6, 0, -0.2), 'foreR': (-0.9, 0, 0), 'body': (0.1, 0.1, 0)},
    'drill': {'hips@': (0, -0.07, 0), 'body': (0.2, 0, 0), 'armL': (-0.95, 0, 0.3), 'armR': (-0.95, 0, -0.3),
              'foreL': (-0.7, 0, 0), 'foreR': (-0.7, 0, 0), 'handL': (-0.3, 0, 0), 'handR': (-0.3, 0, 0)},
    'seated': {'hips@': (0, -0.12, 0), 'legL': (-1.5, 0, -0.06), 'legR': (-1.5, 0, 0.06), 'shinL': (1.42, 0, 0),
               'shinR': (1.42, 0, 0), 'armL': (-1.05, 0, 0.12), 'armR': (-1.05, 0, -0.12), 'foreL': (-0.45, 0, 0),
               'foreR': (-0.45, 0, 0), 'body': (0.04, 0, 0)},
    'throw': {'armL': (-2.65, 0, 0.2), 'armR': (-2.65, 0, -0.2), 'foreL': (-0.9, 0, 0), 'foreR': (-0.9, 0, 0),
              'body': (-0.12, 0, 0)},
}


def render_poses(rig, folder):
    """bones point up with no roll, so a bone's own axes are the game's (x, y up, z forward): the game's rotations
    go in as they are, in the game's XYZ order (Blender calls that ZYX)"""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x, sc.render.resolution_y = 700, 800
    sc.world = bpy.data.worlds.new('preview')
    sc.world.color = (0.2, 0.22, 0.25)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.2
    sc.collection.objects.link(cam)
    sc.camera = cam
    for pb in rig.pose.bones:
        pb.rotation_mode = 'ZYX'
    for pose, rot in POSES.items():
        for pb in rig.pose.bones:
            pb.location = rot.get(pb.name + '@', (0, 0, 0))
            pb.rotation_euler = rot.get(pb.name, (0, 0, 0))
        for view, d in (('front', Vector((0.35, -1, 0.15))), ('side', Vector((1, -0.15, 0.1)))):
            d.normalize()
            cam.location = Vector((0, 0, 0.95)) + d * 6
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(folder, '%s_%s.png' % (pose, view))
            bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    args = dict(a.split('=', 1) for a in sys.argv[sys.argv.index('--') + 1:] if '=' in a) if '--' in sys.argv else {}
    build(args.get('preview'))
