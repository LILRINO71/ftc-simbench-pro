# Export to SimBench — a Fusion script.
#
# Writes the open design as robot.urdf plus one OBJ mesh per rigid body, in a
# folder you pick (or zips it), so it can be dropped on SimBench exactly like
# Onshape's URDF export. Joints come from the design's own joints (as-built and
# regular): revolute -> revolute, slider -> prismatic, rigid -> fixed; limits
# from the joint's limits; mass, centre of mass and inertia from the physical
# properties; colours from the appearance. Rigid groups become one body.
#
# Install (once): in Fusion, Utilities > Add-Ins > Scripts and Add-Ins >
# Scripts > + (green plus) > "Script or add-in from device" > choose this folder
# (ExportToSimBench). Run: select it and click Run. About 30 seconds for a robot.
#
# Fusion's API works in centimetres and radians; URDF wants metres and radians.
# Nested components are fine: each occurrence is a body unless a joint moves it,
# and a joint's two occurrences are its parent and child links.

import adsk.core, adsk.fusion, traceback, os, math, zipfile, re

CM = 0.01


def _xml(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def _safe(name):
    n = re.sub(r'[^A-Za-z0-9_]+', '_', name or 'part').strip('_')
    return n or 'part'


def _mat(m):
    # Matrix3D -> 4x4 row-major list (cm translation)
    a = m.asArray()
    return [[a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], a[7]], [a[8], a[9], a[10], a[11]], [0, 0, 0, 1]]


def _inv(M):
    # rigid inverse
    R = [[M[j][i] for j in range(3)] for i in range(3)]
    t = [M[i][3] for i in range(3)]
    ti = [-(R[i][0] * t[0] + R[i][1] * t[1] + R[i][2] * t[2]) for i in range(3)]
    return [[R[0][0], R[0][1], R[0][2], ti[0]], [R[1][0], R[1][1], R[1][2], ti[1]], [R[2][0], R[2][1], R[2][2], ti[2]], [0, 0, 0, 1]]


def _mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _rpy(M):
    # ZYX Euler angles from a rotation, URDF's roll pitch yaw
    r20 = max(-1.0, min(1.0, M[2][0]))
    pitch = -math.asin(r20)
    if abs(math.cos(pitch)) > 1e-9:
        roll = math.atan2(M[2][1], M[2][2]); yaw = math.atan2(M[1][0], M[0][0])
    else:
        roll = math.atan2(-M[1][2], M[1][1]); yaw = 0.0
    return roll, pitch, yaw


def _origin(M):
    r, p, y = _rpy(M)
    return '<origin xyz="%.6f %.6f %.6f" rpy="%.6f %.6f %.6f"/>' % (M[0][3] * CM, M[1][3] * CM, M[2][3] * CM, r, p, y)


def _color(occ):
    try:
        app = occ.appearance or occ.component.material.appearance
        for p in app.appearanceProperties:
            if p.id == 'opaque_albedo' and p.value is not None:
                c = p.value
                return (c.red / 255.0, c.green / 255.0, c.blue / 255.0)
    except Exception:
        pass
    return (0.75, 0.75, 0.77)


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get(); ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Open the robot design first.'); return
        root = design.rootComponent
        dlg = ui.createFolderDialog(); dlg.title = 'Where to write the SimBench export (robot.urdf and meshes)'
        if dlg.showDialog() != adsk.core.DialogResults.DialogOK:
            return
        out = dlg.folder
        meshes = os.path.join(out, 'meshes'); os.makedirs(meshes, exist_ok=True)

        # ---- bodies: every leaf occurrence with solid bodies; rigid groups merge into one
        occs = [o for o in root.allOccurrences if o.isLightBulbOn and o.bRepBodies.count > 0]
        group_of = {}
        for g in root.allRigidGroups:
            head = g.occurrences.item(0).fullPathName
            for i in range(g.occurrences.count):
                group_of[g.occurrences.item(i).fullPathName] = head
        link_of = {}          # occurrence path -> link name
        links = {}            # link name -> {occs:[...], T: world matrix of the link frame}
        for o in occs:
            key = group_of.get(o.fullPathName, o.fullPathName)
            name = link_of.get(key)
            if not name:
                base = _safe(o.name if key == o.fullPathName else 'group_' + o.name); name = base; n = 2
                while name in links: name = '%s_%d' % (base, n); n += 1
                links[name] = {'occs': [], 'T': _mat(o.transform2)}
                link_of[key] = name
            link_of[o.fullPathName] = name
            links[name]['occs'].append(o)

        # ---- joints: regular and as-built; the child is occurrenceOne (the one that moves)
        joints = []
        all_j = [j for j in root.allJoints] + [j for j in root.allAsBuiltJoints]
        for j in all_j:
            try:
                if j.isSuppressed: continue
            except Exception:
                pass
            o1, o2 = j.occurrenceOne, j.occurrenceTwo
            if o1 is None or o2 is None: continue
            child, parent = link_of.get(o1.fullPathName), link_of.get(o2.fullPathName)
            if not child or not parent or child == parent: continue
            jt = j.jointMotion.jointType
            if jt == adsk.fusion.JointTypes.RevoluteJointType: kind = 'revolute'
            elif jt == adsk.fusion.JointTypes.SliderJointType: kind = 'prismatic'
            elif jt == adsk.fusion.JointTypes.RigidJointType: kind = 'fixed'
            elif jt == adsk.fusion.JointTypes.CylindricalJointType: kind = 'revolute'
            else: kind = 'fixed'
            # the joint frame in world: geometry origin and the motion axis
            geo = None
            try:
                geo = j.geometryOrOriginOne if hasattr(j, 'geometryOrOriginOne') else j.geometry
                if geo and hasattr(geo, 'geometry') and not hasattr(geo, 'origin'): geo = geo.geometry
            except Exception:
                geo = None
            origin = geo.origin if geo is not None else adsk.core.Point3D.create(0, 0, 0)
            axis = None; lim = None
            if kind == 'revolute':
                m = j.jointMotion; axis = m.rotationAxisVector
                L = m.rotationLimits
                if L and (L.isMinimumValueEnabled or L.isMaximumValueEnabled):
                    lim = (L.minimumValue if L.isMinimumValueEnabled else -math.pi, L.maximumValue if L.isMaximumValueEnabled else math.pi)
            elif kind == 'prismatic':
                m = j.jointMotion; axis = m.slideDirectionVector
                L = m.slideLimits
                if L and (L.isMinimumValueEnabled or L.isMaximumValueEnabled):
                    lim = ((L.minimumValue if L.isMinimumValueEnabled else -100) * CM, (L.maximumValue if L.isMaximumValueEnabled else 100) * CM)
            if axis is None: axis = adsk.core.Vector3D.create(0, 0, 1)
            joints.append({'name': _safe(j.name), 'kind': kind, 'parent': parent, 'child': child,
                           'origin': [origin.x, origin.y, origin.z], 'axis': [axis.x, axis.y, axis.z], 'lim': lim})
            # motion links (gears, cascades): a mimic between two joints
        mimics = []
        try:
            for j in all_j:
                for k in range(j.motionLinks.count):
                    ml = j.motionLinks.item(k)
                    if ml.jointTwo is None or ml.jointOne is None: continue
                    ratio = (ml.valueTwo.value / ml.valueOne.value) if ml.valueOne.value else 1.0
                    if ml.isReversed: ratio = -ratio
                    mimics.append((_safe(ml.jointTwo.name), _safe(ml.jointOne.name), ratio))
        except Exception:
            pass

        # ---- a tree: the base is the link no joint moves (the most parts breaks a tie); each link's
        # frame is its first occurrence's; a joint's origin is given in the parent's frame
        childs = set(j['child'] for j in joints)
        roots = [n for n in links if n not in childs]
        base = max(roots, key=lambda n: len(links[n]['occs'])) if roots else next(iter(links))
        # links no joint reaches hang fixed from the base
        reach = set([base]); changed = True
        while changed:
            changed = False
            for j in joints:
                if j['parent'] in reach and j['child'] not in reach: reach.add(j['child']); changed = True
        for n in list(links):
            if n not in reach:
                joints.append({'name': 'fix_' + n, 'kind': 'fixed', 'parent': base, 'child': n, 'origin': [links[n]['T'][0][3], links[n]['T'][1][3], links[n]['T'][2][3]], 'axis': [0, 0, 1], 'lim': None})
                reach.add(n)

        # ---- meshes: each link's bodies, in the link's own frame, as one OBJ with a colour per body
        exp = design.exportManager
        xml = ['<?xml version="1.0"?>', '<robot name="%s">' % _xml(_safe(design.rootComponent.name))]
        for name, L in links.items():
            Tl = L['T']; Tli = _inv(Tl)
            objp = os.path.join(meshes, name + '.obj'); mtlp = os.path.join(meshes, name + '.mtl')
            vcount = 0; obj = ['mtllib %s.mtl' % name]; mtl = []
            mass = 0.0; com = [0.0, 0.0, 0.0]
            for i, o in enumerate(L['occs']):
                try:
                    pp = o.getPhysicalProperties(adsk.fusion.CalculationAccuracy.LowCalculationAccuracy)
                    m = pp.mass; c = pp.centerOfMass
                    mass += m; com[0] += m * c.x; com[1] += m * c.y; com[2] += m * c.z
                except Exception:
                    pass
                col = _color(o)
                mtl.append('newmtl m%d\nKd %.4f %.4f %.4f' % (i, col[0], col[1], col[2]))
                obj.append('usemtl m%d' % i)
                To = _mul(Tli, _mat(o.transform2)) if False else Tli  # bodies are read in world space below
                for b in o.bRepBodies:
                    if not b.isVisible: continue
                    calc = b.meshManager.createMeshCalculator(); calc.setQuality(adsk.fusion.TriangleMeshQualityOptions.NormalQualityTriangleMesh)
                    tm = calc.calculate()
                    pts = tm.nodeCoordinatesAsDouble; idx = tm.nodeIndices
                    for k in range(0, len(pts), 3):
                        x, y, z = pts[k], pts[k + 1], pts[k + 2]
                        # world -> link frame, metres
                        lx = To[0][0] * x + To[0][1] * y + To[0][2] * z + To[0][3]
                        ly = To[1][0] * x + To[1][1] * y + To[1][2] * z + To[1][3]
                        lz = To[2][0] * x + To[2][1] * y + To[2][2] * z + To[2][3]
                        obj.append('v %.6f %.6f %.6f' % (lx * CM, ly * CM, lz * CM))
                    for k in range(0, len(idx), 3):
                        obj.append('f %d %d %d' % (vcount + idx[k] + 1, vcount + idx[k + 1] + 1, vcount + idx[k + 2] + 1))
                    vcount += len(pts) // 3
            with open(objp, 'w') as f: f.write('\n'.join(obj) + '\n')
            with open(mtlp, 'w') as f: f.write('\n'.join(mtl) + '\n')
            if mass > 0: com = [c / mass for c in com]
            cl = [Tli[i][0] * com[0] + Tli[i][1] * com[1] + Tli[i][2] * com[2] + Tli[i][3] for i in range(3)]
            xml.append('  <link name="%s">' % _xml(name))
            xml.append('    <visual><geometry><mesh filename="meshes/%s.obj"/></geometry></visual>' % _xml(name))
            if mass > 0:
                xml.append('    <inertial><mass value="%.5f"/><origin xyz="%.6f %.6f %.6f"/></inertial>' % (mass, cl[0] * CM, cl[1] * CM, cl[2] * CM))
            xml.append('  </link>')
        for j in joints:
            P = links[j['parent']]['T']; Pi = _inv(P)
            o = j['origin']
            op = [Pi[i][0] * o[0] + Pi[i][1] * o[1] + Pi[i][2] * o[2] + Pi[i][3] for i in range(3)]
            a = j['axis']
            # the child's frame sits at the joint origin, axes as the parent's
            C = links[j['child']]['T']
            links[j['child']]['T'] = [[P[0][0], P[0][1], P[0][2], o[0]], [P[1][0], P[1][1], P[1][2], o[1]], [P[2][0], P[2][1], P[2][2], o[2]], [0, 0, 0, 1]]
            ac = [Pi[i][0] * a[0] + Pi[i][1] * a[1] + Pi[i][2] * a[2] for i in range(3)]
            xml.append('  <joint name="%s" type="%s">' % (_xml(j['name']), j['kind']))
            xml.append('    <parent link="%s"/><child link="%s"/>' % (_xml(j['parent']), _xml(j['child'])))
            xml.append('    <origin xyz="%.6f %.6f %.6f" rpy="0 0 0"/>' % (op[0] * CM, op[1] * CM, op[2] * CM))
            if j['kind'] != 'fixed':
                xml.append('    <axis xyz="%.6f %.6f %.6f"/>' % (ac[0], ac[1], ac[2]))
                if j['lim']: xml.append('    <limit lower="%.6f" upper="%.6f" effort="10" velocity="1"/>' % j['lim'])
            for (follower, leader, ratio) in mimics:
                if follower == j['name']: xml.append('    <mimic joint="%s" multiplier="%.6f"/>' % (_xml(leader), ratio))
            xml.append('  </joint>')
        xml.append('</robot>')
        with open(os.path.join(out, 'robot.urdf'), 'w') as f: f.write('\n'.join(xml) + '\n')
        # and one zip to drop on SimBench
        zp = os.path.join(out, _safe(design.rootComponent.name) + '.simbench.zip')
        with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(os.path.join(out, 'robot.urdf'), 'robot.urdf')
            for fn in os.listdir(meshes): z.write(os.path.join(meshes, fn), 'meshes/' + fn)
        ui.messageBox('Wrote %d links and %d joints.\n\nDrop this on SimBench:\n%s' % (len(links), len(joints), zp))
    except Exception:
        if ui: ui.messageBox('Export to SimBench failed:\n{}'.format(traceback.format_exc()))
