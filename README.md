# Voxelcraft

A playable Minecraft-style voxel sandbox that runs entirely in the browser, rendered with a
custom physically based WebGL2 pipeline in the spirit of Minecraft shader packs.

Everything is procedural: the infinite terrain, biomes, caves and trees, all block and item
textures (albedo, normal/height and PBR material maps), the sounds, the clouds and the sky. There
are no asset files.

## Getting started

```bash
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>), click **Play**, and the mouse is captured.
A production build is created with `npm run build` (output in `dist/`, served by `npm run preview`).

**Requirements:** a desktop browser with WebGL2 and float render targets (`EXT_color_buffer_float`).
It works in current Chrome, Edge, Safari and Firefox. `WEBGL_multi_draw` (Chrome/Edge/Safari) is used
when available for much lower draw overhead.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump · swim up · double-tap to toggle flying (Creative) |
| `Shift` | Sneak (won't fall off edges) · descend while flying |
| `Ctrl` / `R` | Sprint |
| Left mouse | Break block (hold to keep breaking) |
| Right mouse | Place block · use item (buckets, hoe, bone meal, flint and steel) · hold to eat · open crafting tables, furnaces and chests |
| Middle mouse | Pick the targeted block |
| `1`–`9` / wheel | Select hotbar slot |
| `E` | Inventory and 2×2 crafting (Survival) · creative inventory (Creative) |
| `Q` | Drop the held item (`Ctrl`+`Q`: the whole stack) |
| `[` / `]` | Rewind / fast-forward time of day |
| `F1` | Hide HUD |
| `F2` | Save a screenshot |
| `F3` | Debug overlay (FPS, position, biome, chunk and render stats) |
| `Esc` | Pause menu (settings, game mode, time presets) |

## Gameplay

- Infinite, seeded world streamed in chunks (16×16×256) by a pool of Web Workers.
- Biomes: plains, meadows, forests (oak, birch, dark), taiga, snowy plains and taiga, desert,
  savanna, beaches, rivers, oceans, mountains and snowy peaks.
- Terrain from continentalness, erosion and ridge noise, 3D density for overhangs, meandering rivers,
  spaghetti and cheese caves, lava pools deep underground, ores, and trees that stay consistent
  across chunk borders.
- Around 200 block types, including glass, water, ice, lava, torches, lanterns, glowstone, sea
  lanterns, metal and gem blocks, granite, diorite and andesite, stone-brick and sandstone variants,
  slabs, all 16 colours of wool, stained glass, terracotta, concrete and concrete powder, flowers,
  saplings, wheat, cactus and sugar cane.
- Minecraft-style flood-fill sky light and block light with smooth lighting and ambient occlusion.
- AABB physics with walking, sprinting, sneaking, jumping, swimming and creative flight.
- Creative mode (instant breaking, flight, every item in a tabbed, searchable inventory) and
  Survival mode (see below).
- Falling sand/gravel, plants that pop off when unsupported, water that flows into opened space,
  concrete powder that hardens in water, and obsidian where water meets lava.
- First-person held blocks, 3D extruded held items (like Minecraft's), an empty hand, swing, equip
  and eating animations, block-break particles, and procedural WebAudio (footsteps, digging,
  placing, wind, birds, crickets, muffled underwater audio, explosions).
- Worlds are saved automatically: edited chunks go to IndexedDB; the player, inventory, chests,
  furnaces and dropped items go to localStorage.

## Survival and crafting

- **Items.** 115 items besides the ~175 placeable blocks: sticks, coal and charcoal, raw and smelted metals,
  nuggets, gems, dusts, dyes in 16 colours, food, buckets, shears, flint and steel, a compass that
  points to the world spawn and a clock whose dial follows the sun,
  wood/stone/iron/gold/diamond tools and swords, and leather/chainmail/iron/gold/diamond armor. Items
  stack (to 64, 16 or 1) and tools and armor wear out, with a durability bar.
- **Inventory.** 36 slots plus 4 armor slots, with Minecraft's container controls: click to pick up,
  place, merge or swap, right-click to split or place one, shift-click to move between sections,
  drag to spread a stack, double-click to collect, `1`–`9` over a slot to swap with the hotbar, `Q`
  to drop.
- **Crafting.** A 2×2 grid in the inventory and a 3×3 grid at a crafting table, with 200 of
  Minecraft's shaped and shapeless recipes (mirrored shapes, "any planks/log/wool" ingredients) and
  tool repair by combining two worn tools. A **recipe book** lists what you can make, fills the grid
  for you (shift-click for as many as possible) and previews missing ingredients.
- **Smelting.** 44 smelting recipes in furnaces with fuel (coal, charcoal, wood, lava buckets…), cooking progress and a
  lit block state; they keep smelting while you're away. Chests and barrels hold 27 stacks.
- **Mining.** Minecraft's break times and harvest rules: the right tool is faster, ores need a
  pickaxe of the right tier to drop anything, stone drops cobblestone, gravel sometimes flint,
  leaves saplings, sticks and apples, grass seeds. Broken blocks drop items you walk over to pick up.
- **Farming and growth.** Till grass with a hoe, plant seeds, and wheat grows (faster near water).
  Saplings grow into trees, sugar cane and cacti get taller, grass spreads, and leaves decay after a
  tree is chopped down. Bone meal speeds things up.
- **Health and hunger.** Hearts, hunger and saturation, armor points and air bubbles. Fall, lava,
  fire, drowning, cactus, suffocation and starvation damage; natural regeneration; eating takes a
  moment. Armor absorbs damage and wears out. Dying drops your items; respawn at the world spawn.
  Difficulty (Peaceful, Easy, Normal, Hard) is in the settings.
- **TNT.** Light it with flint and steel: it flashes, then explodes with Minecraft's ray-based blast
  (blast resistance per block), sets off nearby TNT, drops some blocks and knocks you back.
- **Placement.** Slabs (top, bottom and double), furnaces, chests and jack o'lanterns that face
  you, and walking up slabs without jumping.
- **World generation additions.** Granite, diorite and andesite deposits, cobwebs in caves (a
  source of string) and fossils under deserts (bone blocks for bone meal).

## Rendering pipeline

A deferred renderer written directly against WebGL2 (`src/render/`):

1. **Attribute-less voxel meshes.** Every quad is a single RGBA32UI texel in a shared "quad heap"
   texture; `chunk.vert` pulls and expands quads by `gl_VertexID`. Greedy meshing merges faces with
   identical lighting. Each pass draws all chunks with one `WEBGL_multi_draw` call.
2. **Physically based atmosphere.** Transmittance, multiple-scattering and sky-view LUTs (after
   Hillaire 2020), plus a sun disk, a moon with phases, twinkling stars and a milky way. The sky is
   projected to L2 spherical harmonics for ambient light.
3. **Cascaded shadow maps.** Four cascades in a depth texture array, with PCSS contact-hardening
   soft shadows. The two far cascades update on alternate frames, and cave-only geometry is skipped.
4. **G-buffer → deferred lighting.** GGX specular, energy-aware diffuse, subsurface translucency
   for leaves and plants, SH sky ambient occluded by the voxel sky light, warm flickering block
   light, a dynamic light from a held torch, emissive blocks, and sky reflections for smooth or
   metallic blocks.
5. **Procedural PBR textures.** Every 16×16 texture has albedo, a normal map derived from a height
   field, and smoothness / F0 (metals) / subsurface / emission maps. Mipmaps are coverage-preserving.
6. **Volumetric clouds.** Tileable Perlin-Worley and Worley noise volumes are generated on the GPU,
   plus a weather map. Cumulus clouds are raymarched at half resolution with Beer / powder /
   multiple-scattering lighting, temporally accumulated, and cast shadows via a cloud shadow map.
7. **Water.** Animated normals, screen-space reflections with a sky fallback, refraction, depth
   absorption and in-scattering, sun glints, Snell's window and total internal reflection from
   below, caustics on submerged terrain, and underwater fog with god rays.
8. **Volumetric light.** Half-resolution raymarched sun and moon shafts through the shadow map
   and cloud gaps, plus valley mist that thickens at dawn.
9. **Distant terrain (LOD).** A toroidal height/material map streamed by the workers out to about
   2 km, rendered as a two-level clipmap and a far ocean plane. It uses the same lighting and
   aerial-perspective haze, so the world has a horizon instead of a fog wall.
10. **Post.** TAA (Catmull-Rom history, variance clipping), physically based bloom, eye adaptation,
    a night-vision (Purkinje) shift, AgX or ACES tonemapping, CAS-style sharpening, vignette and
    dithering.

All of these can be toggled in **Graphics & Settings**, and there are Low / Medium / High / Ultra
presets. On high-DPI laptops, **Render Resolution** is the most effective knob for performance.

## Project layout

```
src/
  main.ts                 entry point
  game/                   Game loop, Player physics, Input, Raycast, Audio, Save, Settings,
                          Inventory, Menu (container logic), TileEntities (furnaces, chests),
                          ItemEntities (dropped items), Mining (tools, drops), Growth (random ticks),
                          Survival (health, hunger), Explosions (TNT)
  world/                  blocks, items, recipes, constants, World (chunk streaming), WorkerPool, worker
    gen/                  noise + TerrainGenerator (biomes, caves, trees, ores, far-terrain samples)
    mesh/Mesher.ts        light propagation + greedy meshing into packed quads
  render/                 Renderer (pipeline), ChunkMeshes (quad heap), FarTerrain, Entities (held and
                          dropped items, particles), Atmosphere, math, gl helpers
    textures/             procedural block textures and item sprites
    shaders/              all GLSL (includes resolved at load time)
  ui/                     HUD, menus, container screens and recipe book, item icons
```

## Debugging

URL parameters: `?seed=123` selects a world, `?x=..&y=..&z=..&yaw=..&pitch=..` places the camera,
`&time=0.25` sets the time of day (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight), `&fly` enables
flight, `&freeze` stops the day cycle, and `&autoplay` starts without capturing the mouse.
`window.__game` exposes the running game in the console.
