// The S&GPU editor's copy of the alley: terryball.sbproj opens Assets/scenes/terryball.scene (s&box space). The
// editor's Play re-exports scene.json from it (SgpuSceneExporter), so it carries what the runtime scene holds: each
// OBJ mesh as an s&box-space OBJ under a ModelDoc model, textured materials as .vmat, colliders and rigidbodies, the
// citizen, the GPU components with their GameObject references, the sun and ambient light. Pins get one convex hull
// (the editor's HullCollider): the runtime scene's per-slab compound has no editor counterpart.
// Called by tools/make-scene.mjs after it writes scene.json (scene.extra.json's content included).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function writeEditorScene({ root, scene, INCH, r6, PIN_R, PIN_H, PROFILE_HULL }) {
  const guid = (s) => { const h = createHash('md5').update('terryball:' + s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  const vec = (v) => v.map(r6).join(',');
  const toSboxPos = (p) => [-p[2], -p[0], p[1]].map((x) => x / INCH);          // internal (m) -> s&box (in)
  const toSboxQuat = (q) => [-q[2], -q[0], q[1], q[3]];
  const toSboxSize = (s) => [s[2], s[0], s[1]].map((x) => x / INCH);
  const A = path.join(root, 'Assets');
  for (const d of ['models', 'materials/terryball', 'scenes']) fs.mkdirSync(path.join(A, d), { recursive: true });

  // meshes: the OBJ in s&box space, laid out for ModelDoc's Y-up import (a file point (x, y, z) lands at s&box (z, x, y))
  const vmdl = (name) => ['<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc29:version{3cec427c-1b0e-4d48-a90a-0436f33a6041} -->',
    '{', '\trootNode = ', '\t{', '\t\t_class = "RootNode"', '\t\tchildren = ', '\t\t[', '\t\t\t{', '\t\t\t\t_class = "RenderMeshList"', '\t\t\t\tchildren = ', '\t\t\t\t[', '\t\t\t\t\t{',
    '\t\t\t\t\t\t_class = "RenderMeshFile"', `\t\t\t\t\t\tfilename = "models/${name}.obj"`, '\t\t\t\t\t\timport_translation = [ 0.0, 0.0, 0.0 ]', '\t\t\t\t\t\timport_rotation = [ 0.0, 0.0, 0.0 ]',
    '\t\t\t\t\t\timport_scale = 1.0', '\t\t\t\t\t\talign_origin_x_type = "None"', '\t\t\t\t\t\talign_origin_y_type = "None"', '\t\t\t\t\t\talign_origin_z_type = "None"', '\t\t\t\t\t\tparent_bone = ""',
    '\t\t\t\t\t\timport_filter = ', '\t\t\t\t\t\t{', '\t\t\t\t\t\t\texclude_by_default = false', '\t\t\t\t\t\t\texception_list = [  ]', '\t\t\t\t\t\t}', '\t\t\t\t\t},', '\t\t\t\t]', '\t\t\t},', '\t\t]',
    '\t\tmodel_archetype = ""', '\t\tprimary_associated_entity = ""', '\t\tanim_graph_name = ""', '\t\tbase_model_name = ""', '\t}', '}', ''].join('\r\n');
  const objMeshes = new Set();
  for (const m of scene.meshes) {
    if (!m.obj || !fs.existsSync(path.join(root, m.obj))) continue;
    const lines = fs.readFileSync(path.join(root, m.obj), 'utf8').split(/\r?\n/).map((l) => {
      const t = l.trim().split(/\s+/);
      if (t[0] === 'v') return `v ${[-t[1], +t[2], -t[3]].map((x) => r6(x / INCH)).join(' ')}`;
      if (t[0] === 'vn') return `vn ${[-t[1], +t[2], -t[3]].map(r6).join(' ')}`;
      return l;
    });
    fs.writeFileSync(path.join(A, 'models', `${m.name}.obj`), lines.join('\n'));
    fs.writeFileSync(path.join(A, 'models', `${m.name}.vmdl`), vmdl(m.name));
    objMeshes.add(m.name);
  }

  // materials: textured ones become .vmat (the texture copied beside it); plain colours are the default material, tinted
  const mats = Object.fromEntries(scene.materials.map((m) => [m.name, m]));
  const matPaths = {};
  for (const m of scene.materials) {
    if (!m.texture || !fs.existsSync(path.join(root, m.texture))) continue;
    const tex = path.basename(m.texture);
    fs.copyFileSync(path.join(root, m.texture), path.join(A, 'materials', 'terryball', tex));
    const c = m.color || [1, 1, 1, 1];
    fs.writeFileSync(path.join(A, 'materials', 'terryball', `${m.name}.vmat`), ['// Terryball (tools/editor-scene.mjs)', 'Layer0', '{',
      '\tshader "shaders/complex.shader"', '\tg_flModelTintAmount "1.000"', `\tg_vColorTint "[${c.slice(0, 3).map((x) => x.toFixed(6)).join(' ')} 0.000000]"`,
      `\tTextureColor "materials/terryball/${tex}"`, `\tg_flMetalness "${(m.metallic || 0).toFixed(3)}"`, `\tg_flRoughnessScaleFactor "${(m.roughness ?? 0.5).toFixed(3)}"`, '}', ''].join('\r\n'));
    matPaths[m.name] = `materials/terryball/${m.name}.vmat`;
  }

  // GPU component fields that hold a GameObject (scene.json: an entity id)
  const REFS = new Set(['Ball', 'Lane']);
  const byId = new Map(scene.entities.map((e) => [e.id, e]));
  const pinHull = PROFILE_HULL.map((p) => vec(p));
  const objects = scene.entities.map((e) => {
    const comps = [];
    if (e.mesh === 'citizen') comps.push({ __type: 'Sandbox.SkinnedModelRenderer', __guid: guid(`${e.id}/model`), AnimationGraph: null, BodyGroups: 341, BoneMergeTarget: null,
      CreateAttachments: false, CreateBoneObjects: false, Model: 'models/citizen/citizen.vmdl', PlaybackRate: 1, RenderType: 'On', Tint: '1,1,1,1', UseAnimGraph: false });
    else if (objMeshes.has(e.mesh)) {
      const m = mats[e.material] || {};
      const textured = !!matPaths[e.material];
      comps.push({ __type: 'Sandbox.ModelRenderer', __guid: guid(`${e.id}/model`), BodyGroups: '__ALL_BODY_GROUPS__', Model: `models/${e.mesh}.vmdl`,
        MaterialOverride: textured ? matPaths[e.material] : 'materials/default.vmat', RenderType: e.castShadows === false ? 'Off' : 'On',
        Tint: textured ? '1,1,1,1' : vec(m.color || [1, 1, 1, 1]) });
    }
    const b = e.body;
    if (b) {
      const common = { Friction: b.friction ?? 0.6, Elasticity: b.restitution ?? 0, IsTrigger: false, Static: b.type === 'static' };
      if (b.shape === 'box') comps.push({ __type: 'Sandbox.BoxCollider', __guid: guid(`${e.id}/collider`), Scale: vec(toSboxSize(b.size)), Center: '0,0,0', ...common });
      else if (b.shape === 'sphere') comps.push({ __type: 'Sandbox.SphereCollider', __guid: guid(`${e.id}/collider`), Radius: r6(b.radius / INCH), Center: '0,0,0', ...common });
      else if (b.shape === 'compound') comps.push({ __type: 'Sandbox.HullCollider', __guid: guid(`${e.id}/collider`), Type: 'Points', Center: '0,0,0', Points: pinHull, ...common });
      if (b.type !== 'static') comps.push({ __type: 'Sandbox.Rigidbody', __guid: guid(`${e.id}/rigidbody`), Gravity: (b.gravity_scale ?? 1) !== 0,
        GravityScale: b.gravity_scale ?? 1, MotionEnabled: b.type === 'dynamic', StartAsleep: false, MassOverride: b.mass || 0,
        LinearDamping: b.linear_damping || 0, AngularDamping: b.angular_damping || 0 });
    }
    (e.components || []).forEach((c, i) => {
      const { type, enabled, ...values } = c;
      const fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k,
        REFS.has(k) && typeof v === 'number' && byId.has(v) ? { _type: 'gameobject', go: guid(`go/${v}`) } : Array.isArray(v) ? vec(v) : v]));
      comps.push({ __type: 'Sandbox.GpuComponent', __guid: guid(`${e.id}/gpu/${i}`), __enabled: enabled !== false, Flags: 0, ComponentType: type, ...fields });
    });
    const o = { __guid: guid(`go/${e.id}`), Flags: 0, Name: e.name || `Entity ${e.id}`, Position: vec(toSboxPos(e.position || [0, 0, 0])),
      Rotation: vec(toSboxQuat(e.rotation || [0, 0, 0, 1])), Enabled: true, Components: comps };
    if (e.scale) o.Scale = vec(e.scale);
    return o;
  });
  objects.unshift(
    { __guid: guid('camera'), Flags: 0, Name: 'Main Camera', Position: vec(toSboxPos(scene.camera.position)), Rotation: '0,0,0,1', Enabled: true,
      Components: [{ __type: 'Sandbox.CameraComponent', __guid: guid('camera/c'), BackgroundColor: '0.33,0.46,0.52,1', ClearFlags: 'All', FieldOfView: 70, IsMainCamera: true,
        Orthographic: false, OrthographicHeight: 1204, Priority: 1, RenderExcludeTags: '', RenderTags: '', TargetEye: 'None', Viewport: '0,0,1,1', ZFar: 60000, ZNear: 10 }] },
    // the sun: pitch 45 down, yaw 90 (forward (0, 0.71, -0.71), as the source scene's sun)
    { __guid: guid('sun'), Flags: 0, Name: 'Sun', Position: '0,0,2000', Rotation: '-0.270598,0.270598,0.653281,0.653281', Enabled: true,
      Components: [{ __type: 'Sandbox.DirectionalLight', __guid: guid('sun/l'), LightColor: '0.944,0.978,1,1', SkyColor: vec([...scene.environment.sky_top, 1]),
        Intensity: scene.environment.sun.intensity, Shadows: true, FogMode: 'Disabled' }] },
    { __guid: guid('ambient'), Flags: 0, Name: 'Ambient', Position: '0,0,0', Rotation: '0,0,0,1', Enabled: true,
      Components: [{ __type: 'Sandbox.AmbientLight', __guid: guid('ambient/l'), Color: vec([...scene.environment.ambient, 1]) }] });
  const doc = { __guid: guid('scene'), GameObjects: objects,
    SceneProperties: { FixedUpdateFrequency: 60, MaxFixedUpdates: 5, NetworkFrequency: 30, NetworkInterpolation: true, ThreadedAnimation: true, TimeScale: 1, UseFixedUpdate: true, NavMesh: { Enabled: false } },
    Title: 'terryball', Description: 'Terryball: four lanes, settees and the concourse, as GPU components.', ResourceVersion: 1, __references: [], __version: 1 };
  fs.writeFileSync(path.join(A, 'scenes', 'terryball.scene'), JSON.stringify(doc, null, 2).replace(/"__ALL_BODY_GROUPS__"/g, '18446744073709551615') + '\n');
  return `editor: Assets/scenes/terryball.scene (${objects.length} objects), ${objMeshes.size} models, ${Object.keys(matPaths).length} materials`;
}
