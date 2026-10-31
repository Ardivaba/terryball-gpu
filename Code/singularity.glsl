/*
 * singularity.glsl: the Pin Singularity's engine calls that GPU# has no API for (Code/Singularity.gs, Graviton.gs).
 * Shared code (no fields): GPU# classes reach it through [GlslBuiltins] Sg (Graviton.gs).
 *
 * Rain pin k is physics body SGS_BODY_BASE + k (spawned into that explicit slot) and scene instance
 * sg_alloc_base + k of the project's GPU instance pool ("gpuInstances" in project.json). The body is flagged
 * SG_BODY_EXPORT with its user id = that instance, so the physics step itself writes the pin's transform into the
 * instance the renderer draws: no copy pass, nothing read back.
 */
#ifndef SINGULARITY_GLSL
#define SINGULARITY_GLSL 1

#define SGS_BODY_BASE 1024u
#define SGS_EXPORT 1024u   /* SGP_BODY_EXPORT (physics_layout.h) */

#if defined(SGPU_PHYSICS_GLSL) && !defined(SG_PHYS_NO_BUFFERS)
/* a dynamic capsule along the pin's axis (s&box z = internal +Y), into its explicit body slot */
void sgsSpawnPin(uint k, vec3 pos, vec4 rot, float radius, float halfHeight, float mass, vec3 vel, vec3 angVel, uint instance)
{
    uint b = SGS_BODY_BASE + k;
    sgSpawnBodyEx(b, SG_BODY_DYNAMIC, SG_SHAPE_CAPSULE, sgSboxToWorld(pos), sgSboxQuatToWorld(rot),
                  vec3(radius, halfHeight, radius) * SG_SBOX_M, -mass, 0.35, 0.25, sgSboxToWorld(vel), sgSboxDirToWorld(angVel),
                  1.0, 0u, 0u, instance);
    sgSetBodyFlags(b, SGS_EXPORT, 0u);
    sgSetCollisionFilter(b, 0u, 1u | (0xFFFFu << 16));   /* the world's category: it meets everything */
}
void sgsDestroyPin(uint k) { sgDestroyBody(SGS_BODY_BASE + k); }
/* solid (meets everything) or a ghost (meets nothing: the collapse, where the pins pass through each other) */
void sgsSolidPin(uint k, bool solid) { sgSetCollisionFilter(SGS_BODY_BASE + k, 0u, solid ? 1u | (0xFFFFu << 16) : 1u); }
bool sgsPinAlive(uint k) { return sgBodyAlive(SGS_BODY_BASE + k); }
#else
void sgsSpawnPin(uint k, vec3 pos, vec4 rot, float radius, float halfHeight, float mass, vec3 vel, vec3 angVel, uint instance) {}
void sgsDestroyPin(uint k) {}
void sgsSolidPin(uint k, bool solid) {}
bool sgsPinAlive(uint k) { return false; }
#endif

#if defined(SGPU_SCENE_GLSL) && !defined(SG_SCENE_NO_ALLOC) && !defined(SG_SCENE_READONLY_INSTANCES)
uint sgsInstance(uint k) { return sg_alloc_base + k; }
uint sgsPoolSize() { return sg_alloc_size; }
/* the material an entity's instance draws with (the heat materials ride on Graviton 0..7) */
uint sgsMaterialOf(uint entity) { uint s = sgSceneFindEntity(entity); return s == SG_NONE ? SG_NONE : sg_instances[s].material; }
uint sgsMeshOf(uint entity) { uint s = sgSceneFindEntity(entity); return s == SG_NONE ? SG_NONE : sg_instances[s].mesh; }
/* take pool slot k for rain pin k (the pool is the Singularity's alone), placed until the first export */
void sgsShowPin(uint k, uint mesh, uint material, vec3 pos, vec4 rot)
{
    uint s = sg_alloc_base + k;
    if (k >= sg_alloc_size) return;
    sg_instances[s].position = vec4(sgSboxToWorld(pos), 0.0);
    sg_instances[s].rotation = sgSboxQuatToWorld(rot);
    sg_instances[s].scale = vec4(1.0, 1.0, 1.0, 0.0);
    sg_instances[s].mesh = mesh;
    sg_instances[s].material = material;
    sg_instances[s].entityId = 0u;
    sg_instances[s].flags = SG_INSTANCE_ALIVE | SG_INSTANCE_VISIBLE | SG_INSTANCE_SHADOW;
}
void sgsLookPin(uint k, uint material, float scale)
{
    uint s = sg_alloc_base + k;
    if (k >= sg_alloc_size || sg_instances[s].flags == 0u) return;
    sg_instances[s].material = material;
    sg_instances[s].scale.xyz = vec3(scale);
}
void sgsHidePin(uint k)
{
    uint s = sg_alloc_base + k;
    if (k >= sg_alloc_size) return;
    sg_instances[s].flags = 0u;
    sg_instances[s].mesh = SG_NONE;
}
#else
uint sgsInstance(uint k) { return k; }
uint sgsPoolSize() { return 0u; }
uint sgsMaterialOf(uint entity) { return 0u; }
uint sgsMeshOf(uint entity) { return 0u; }
void sgsShowPin(uint k, uint mesh, uint material, vec3 pos, vec4 rot) {}
void sgsLookPin(uint k, uint material, float scale) {}
void sgsHidePin(uint k) {}
#endif

#endif
