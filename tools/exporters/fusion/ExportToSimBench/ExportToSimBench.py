"""Export to SimBench: a Fusion script that writes the robot, joints and all.

Run it in Fusion: Utilities > Scripts and Add-Ins > the green + > pick this
folder > Run. It asks for a folder and writes there:

    <design>.mjcf.xml   the robot as a MuJoCo model: a body per rigid group,
                        a joint per revolute, slider or cylindrical joint,
                        with its axis, pivot and limits, and each body's mass
    meshes/*.stl        each body's shape

Drop the .xml and the meshes folder together on SimBench (or zip them).
SimBench reads MJCF (src/mjcf.js) into the same robot an Onshape import gives.

How it reads the design:
  * Every Fusion joint and as-built joint is read. Rigid joints and rigid
    groups glue occurrences into one body. Revolute and cylindrical joints
    become hinges, slider joints slides; their limits come across when they
    are switched on. Pin-slot, planar and ball joints are reported and left
    out (SimBench simulates turns and slides).
  * The grounded occurrence (or the first one) is the chassis. Bodies hang
    off it along the joints; a joint that would close a loop becomes an
    MJCF <connect> at its pivot, so a four-bar keeps its fourth pin.
  * Name a joint exactly as the device's configuration name in your
    OpMode ("liftMotor", "clawServo") and SimBench binds it by itself.

Units: Fusion works in centimetres inside its API; everything here is
written in metres and radians (<compiler angle="radian">).

STATUS: written against the Fusion API reference, not yet run in Fusion.
Please report what goes wrong (docs/robot-package.md). MIT licence, like
the rest of tools/exporters.
"""
import os
import traceback

import adsk.core
import adsk.fusion

CM = 0.01  # Fusion's internal length unit, in metres


def _xyz(p, scale=CM):
    return "%.6f %.6f %.6f" % (p.x * scale, p.y * scale, p.z * scale)


def _safe(name):
    out = "".join(c if c.isalnum() or c in "_-" else "_" for c in name)
    return out or "part"


def _joint_frame(joint):
    """The joint's pivot (a Point3D, cm) and axis (a Vector3D), in the root
    assembly's frame. A joint's geometry is in the context of the component
    that owns it, so a joint inside a sub-assembly is asked for its proxy in
    the root first."""
    j = joint
    motion = j.jointMotion
    geo = j.geometryOrOriginOne
    if isinstance(geo, adsk.fusion.JointOrigin):
        geo = geo.geometry
    origin = geo.origin
    axis = None
    kind = motion.jointType
    if kind == adsk.fusion.JointTypes.RevoluteJointType:
        axis = motion.rotationAxisVector
    elif kind == adsk.fusion.JointTypes.SliderJointType:
        axis = motion.slideDirectionVector
    elif kind == adsk.fusion.JointTypes.CylindricalJointType:
        axis = motion.rotationAxisVector
    if axis is None:
        axis = geo.primaryAxisVector
    return origin, axis


def _limits(motion):
    """(lo, hi) in radians or metres, or None when the limits are off."""
    kind = motion.jointType
    lim = None
    lin = False
    if kind in (adsk.fusion.JointTypes.RevoluteJointType, adsk.fusion.JointTypes.CylindricalJointType):
        lim = motion.rotationLimits
    elif kind == adsk.fusion.JointTypes.SliderJointType:
        lim = motion.slideLimits
        lin = True
    if lim is None or not (lim.isMinimumValueEnabled or lim.isMaximumValueEnabled):
        return None
    k = CM if lin else 1.0
    lo = lim.minimumValue * k if lim.isMinimumValueEnabled else (-1e3 if lin else -3.14159265)
    hi = lim.maximumValue * k if lim.isMaximumValueEnabled else (1e3 if lin else 3.14159265)
    return lo, hi


def _current_value(motion):
    """Where the joint is now (radians or metres): Fusion's limits are measured
    from its zero, SimBench measures from the pose the model is drawn in."""
    kind = motion.jointType
    try:
        if kind in (adsk.fusion.JointTypes.RevoluteJointType, adsk.fusion.JointTypes.CylindricalJointType):
            return motion.rotationValue
        if kind == adsk.fusion.JointTypes.SliderJointType:
            return motion.slideValue * CM
    except Exception:
        pass
    return 0.0


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox("Open the robot's design first.")
            return
        root = design.rootComponent

        dlg = ui.createFolderDialog()
        dlg.title = "Where should SimBench's files go?"
        if dlg.showDialog() != adsk.core.DialogResults.DialogOK:
            return
        out = dlg.folder
        mesh_dir = os.path.join(out, "meshes")
        os.makedirs(mesh_dir, exist_ok=True)

        occs = [o for o in root.allOccurrences if o.isVisible and o.bRepBodies.count > 0]
        if not occs:
            ui.messageBox("The design has no visible bodies in components.")
            return
        key = {o.entityToken: i for i, o in enumerate(occs)}

        # ---- rigid groups: union-find over occurrences
        parent = list(range(len(occs)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        def union(a, b):
            a, b = find(a), find(b)
            if a != b:
                parent[b] = a

        def idx(occ):
            if occ is None:
                return None
            k = key.get(occ.entityToken)
            if k is not None:
                return k
            # a joint on a sub-assembly occurrence: the first of its own occurrences stands for it
            for i, o in enumerate(occs):
                if o.fullPathName.startswith(occ.fullPathName + "+"):
                    return i
            return None

        joints = []
        notes = []
        for j in list(getattr(root, "allJoints", [])) + list(getattr(root, "allAsBuiltJoints", [])):
            try:
                if j.isSuppressed:
                    continue
                a, b = idx(j.occurrenceOne), idx(j.occurrenceTwo)
                if a is None or b is None:
                    continue
                kind = j.jointMotion.jointType
                if kind == adsk.fusion.JointTypes.RigidJointType:
                    union(a, b)
                    continue
                if kind not in (adsk.fusion.JointTypes.RevoluteJointType, adsk.fusion.JointTypes.SliderJointType,
                                adsk.fusion.JointTypes.CylindricalJointType):
                    notes.append("%s is a %s joint; SimBench simulates turns and slides, so it's left out" % (j.name, kind))
                    continue
                joints.append((j, a, b))
            except Exception:
                notes.append("couldn't read joint %s" % getattr(j, "name", "?"))
        for g in list(getattr(root, "allRigidGroups", None) or getattr(root, "rigidGroups", None) or []):
            try:
                if g.isSuppressed:
                    continue
                members = [idx(o) for o in g.occurrences]
                members = [m for m in members if m is not None]
                for m in members[1:]:
                    union(members[0], m)
            except Exception:
                pass

        # ---- bodies, and the tree out from the ground
        groups = {}
        for i in range(len(occs)):
            groups.setdefault(find(i), []).append(i)
        ground = next((find(i) for i, o in enumerate(occs) if o.isGrounded), find(0))
        tree = {ground: None}
        kids = {g: [] for g in groups}
        loops = []
        frontier = [ground]
        edges = [(j, find(a), find(b)) for j, a, b in joints]
        used = set()
        while frontier:
            g = frontier.pop(0)
            for n, (j, a, b) in enumerate(edges):
                if n in used or g not in (a, b):
                    continue
                used.add(n)
                other = b if a == g else a
                if other == a and other == b:
                    continue
                if other in tree:
                    loops.append((j, a, b))
                    continue
                tree[other] = (g, j)
                kids[g].append(other)
                frontier.append(other)
        loose = [g for g in groups if g not in tree]
        for g in loose:
            notes.append("%s isn't joined to the chassis by any joint; it rides with the chassis" % occs[groups[g][0]].name)
            union(ground, groups[g][0])

        # ---- meshes and masses
        em = design.exportManager
        names = {}

        def body_name(g):
            if g not in names:
                base = _safe(occs[groups[g][0]].component.name)
                n, k = base, 1
                while n in names.values():
                    k += 1
                    n = "%s_%d" % (base, k)
                names[g] = n
            return names[g]

        mesh_files = {}
        masses = {}
        for g, members in groups.items():
            files = []
            kg = 0.0
            for i in members:
                o = occs[i]
                fn = "%s_%d.stl" % (_safe(o.name), i)
                opt = em.createSTLExportOptions(o, os.path.join(mesh_dir, fn))
                opt.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementLow
                opt.isBinaryFormat = True
                opt.sendToPrintUtility = False
                try:
                    # the meshes' scale below assumes centimetres, Fusion's own unit
                    opt.unitType = adsk.fusion.DistanceUnits.CentimeterDistanceUnits
                except Exception:
                    notes.append("couldn't set the STL unit; if the robot comes in 10x off, the design's units differ")
                em.execute(opt)
                files.append(fn)
                try:
                    kg += o.getPhysicalProperties(adsk.fusion.CalculationAccuracy.LowCalculationAccuracy).mass
                except Exception:
                    pass
            mesh_files[g] = files
            masses[g] = kg

        # ---- the model. Every body's frame is the root's (no pos, no rotation),
        # so the STLs, which Fusion writes in the root's frame, sit where they are drawn
        lines = ['<mujoco model="%s">' % _safe(design.rootComponent.name),
                 '  <compiler angle="radian"/>',
                 '  <asset>']
        for g in groups:
            if g not in tree:
                continue
            for fn in mesh_files[g]:
                lines.append('    <mesh name="%s" file="meshes/%s" scale="%g %g %g"/>' % (fn[:-4], fn, CM, CM, CM))
        lines.append('  </asset>')
        lines.append('  <worldbody>')

        def emit(g, depth):
            pad = "  " * (depth + 2)
            lines.append('%s<body name="%s">' % (pad, body_name(g)))
            link = tree[g]
            if link is not None:
                j = link[1]
                origin, axis = _joint_frame(j)
                kind = j.jointMotion.jointType
                jt = "slide" if kind == adsk.fusion.JointTypes.SliderJointType else "hinge"
                attrs = 'name="%s" type="%s" pos="%s" axis="%s"' % (_safe(j.name), jt, _xyz(origin), _xyz(axis, 1.0))
                lim = _limits(j.jointMotion)
                if lim:
                    now = _current_value(j.jointMotion)
                    attrs += ' range="%.6f %.6f"' % (lim[0] - now, lim[1] - now)
                lines.append('%s  <joint %s/>' % (pad, attrs))
            if masses[g] > 0:
                lines.append('%s  <inertial pos="0 0 0" mass="%.5f" diaginertia="1e-4 1e-4 1e-4"/>' % (pad, masses[g]))
            for fn in mesh_files[g]:
                lines.append('%s  <geom type="mesh" mesh="%s"/>' % (pad, fn[:-4]))
            for k in kids[g]:
                emit(k, depth + 1)
            lines.append('%s</body>' % pad)

        emit(ground, 0)
        lines.append('  </worldbody>')
        if loops:
            lines.append('  <equality>')
            for j, a, b in loops:
                origin, _ = _joint_frame(j)
                lines.append('    <connect body1="%s" body2="%s" anchor="%s"/>' % (body_name(a), body_name(b), _xyz(origin)))
            lines.append('  </equality>')
        lines.append('</mujoco>')

        name = _safe(design.rootComponent.name)
        path = os.path.join(out, name + ".mjcf.xml")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        msg = "Wrote %s with %d bodies and %d joints.\nDrop it and the meshes folder on SimBench." % (path, len(tree), len(tree) - 1)
        if notes:
            msg += "\n\nTo check:\n- " + "\n- ".join(notes[:12])
        ui.messageBox(msg)
    except Exception:
        if ui:
            ui.messageBox("Export to SimBench failed:\n%s" % traceback.format_exc())
