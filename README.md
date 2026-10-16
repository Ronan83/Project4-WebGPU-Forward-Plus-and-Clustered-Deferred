WebGPU Forward+ and Clustered Deferred Shading
======================

**University of Pennsylvania, CIS 565: GPU Programming and Architecture, Project 4**

* Xuan Zhu
* Tested on: **Google Chrome 155** on Windows 11, AMD Ryzen AI 7 350, 32 GB DDR5, NVIDIA GeForce RTX 5070 Laptop GPU (personal laptop)
* All measurements at a **2560 × 1347** canvas, light radius 2, initial camera position.

### Live Demo

**[ronan83.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred](https://ronan83.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred)** (needs a WebGPU-capable browser such as Chrome)

[![](img/screenshot.png)](https://ronan83.github.io/Project4-WebGPU-Forward-Plus-and-Clustered-Deferred)

### Demo Video/GIF

**[Full demo video (39 s, MP4)](img/demo.mp4)**: Naive → Forward+ (500 → 3000 lights) → Clustered Deferred (3000 → 5000 lights, camera moving) → Forward+ at 5000 → Naive at 5000 (about 1 s per frame). Recorded straight from the WebGPU canvas on the RTX 5070.

![Demo GIF](img/demo.gif)

*20-second excerpt of the video above.*

**Contents:** [Overview](#overview) · [Features](#features) · [Performance Analysis](#performance-analysis) · [Optimizations](#optimization-1-end-the-depth-slicing-at-the-scenes-depth) · [Deployment note](#deployment-note-constants-stripped-by-the-production-bundler)

## Overview

The Sponza atrium is lit by up to 5,000 moving point lights. A naive forward renderer evaluates every light for every fragment, so its cost grows with *pixels × overdraw × lights*. Because each light only reaches 2 units, any given pixel is actually affected by a few dozen lights at most, and almost all of the naive work is wasted.

This project implements two renderers that avoid that waste by **clustering lights**:

| Renderer | Passes per frame |
|---|---|
| **Naive** | one forward pass, loops over all lights |
| **Forward+** | light-clustering compute pass → forward pass that loops only over the fragment's cluster |
| **Clustered Deferred** | light-clustering compute pass → G-buffer pass (position, normal, albedo) → fullscreen lighting pass that loops only over the pixel's cluster |

## Features

### Light clustering (shared by Forward+ and Clustered Deferred)

The view frustum is divided into a **32 × 18 × 24** grid of clusters: 32 × 18 screen-space tiles, each cut into 24 depth slices.

* **Exponential depth slices.** Slice *k* starts at `near · (clusterFar / near)^(k / 24)`, so slices are thin near the camera, where pixels are dense, and thick far away. The last slice extends to the camera's far plane so nothing is ever missed.
* **Compute shader, one thread per cluster.** Each thread unprojects its tile's 4 NDC corners at the slice's near and far depths with the inverse projection matrix, takes the min/max of those 8 view-space points as the cluster's AABB, then tests every light sphere against the AABB (closest-point-on-box distance ≤ radius). The indices of intersecting lights go into that cluster's list, capped at 512.
* **Data layout.** `struct Cluster { numLights: u32, lightIndices: array<u32, 512> }` in one storage buffer (2052 bytes per cluster). The camera uniform buffer holds `viewProj`, `view`, `invProj`, screen size, near and far (208 bytes, 16-byte aligned).
* **Lookup.** A fragment finds its cluster from `@builtin(position).xy / screenSize` (tile) and its view-space depth (slice). The same `zSliceFromDepth` function in `common.wgsl` is used by the compute and fragment shaders, so both sides always agree on the mapping. All cluster accesses go through WGSL pointers, so the 2 KB cluster struct is never copied.

### Forward+

This is the naive forward pass with one change: the fragment shader loops only over its cluster's light list instead of all lights. The vertex shader is shared with the naive renderer.

### Clustered Deferred

1. **G-buffer pass.** Writes world position (`rgba16float`), normal (`rgba16float`) and albedo (`rgba8unorm`). Alpha-tested fragments are discarded here, and no lighting is done.
2. **Fullscreen lighting pass.** One oversized triangle generated from `vertex_index` (no vertex buffer) covers the screen. Each pixel `textureLoad`s the G-buffer, finds its cluster exactly as Forward+ does, and shades with that cluster's lights. Pixels with albedo alpha = 0 (nothing drawn) are skipped.

## Performance Analysis

**How frame time was measured.** The renderer normally runs on `requestAnimationFrame`, which Chrome caps at the display refresh rate. For benchmarking, frames were instead run back to back, and each frame waited for `device.queue.onSubmittedWorkDone()` before the next one started. The reported number is the average frame time over 3 seconds, after a 1.5-second warm-up at each setting. The lights keep moving during the measurement, so repeated runs vary by roughly ±10%.

### Naive vs. Forward+ vs. Clustered Deferred

| Frame time (ms) | 500 lights | 1000 | 2000 | 3000 | 5000 |
|---|---|---|---|---|---|
| Naive | 130.73 | 177.16 | 334.46 | 500.50 | 1004.63 |
| Forward+ | 6.38 | 10.72 | 19.77 | 29.46 | 47.71 |
| Clustered Deferred | **4.76** | **5.97** | **7.80** | **10.10** | **14.29** |

![](img/perf_lights.png)

![](img/perf_fplus_vs_deferred.png)

**Is one of them faster?** Yes. Both clustered renderers are one to two orders of magnitude faster than naive: at 5000 lights, Forward+ is **21×** faster and Clustered Deferred is **70×** faster. Between the two, **Clustered Deferred is faster at every light count**. The gap grows with the number of lights, from 1.3× at 500 lights to 3.3× at 5000.

**Why deferred wins here.**
* **Overdraw.** Sponza has heavy depth complexity: columns, arches, curtains, and alpha-tested foliage. Forward+ runs the full lighting loop for every fragment that passes the depth test, including fragments that a closer surface overwrites later. Alpha-tested materials use `discard`, which further limits how much early-Z can reject. Deferred runs the expensive lighting loop **exactly once per pixel**, and its G-buffer pass does almost no work per fragment.
* **Coherence.** In the fullscreen pass, neighboring pixels almost always fall in the same cluster and read the same light list, so a warp walks one list in lockstep. In the forward pass, a 2×2 quad or warp can straddle triangles at different depths, and therefore different clusters, which causes divergence.
* **Lighting cost per pixel grows with light count; the G-buffer cost does not.** That is why the gap widens as lights are added.

**Is one better at certain workloads?** At low light counts, deferred's advantage shrinks to about 1.6 ms, because the G-buffer is a fixed cost: at 2560×1347 it writes and reads about 69 MB per frame (20 bytes/pixel). In a scene with little overdraw or few lights, Forward+ would close the gap or win. Deferred wins when there is heavy overdraw and many lights.

**Benefits and trade-offs.**

| | Forward+ | Clustered Deferred |
|---|---|---|
| Shading cost | grows with overdraw | once per pixel |
| Memory / bandwidth | just the cluster buffer | + G-buffer (≈69 MB at this resolution) |
| Transparency | natural (sorted forward pass) | needs a separate forward pass |
| MSAA | works out of the box | expensive (per-sample G-buffer) |
| Materials | any shader per material | limited to what fits in the G-buffer |

### Optimization 1: end the depth slicing at the scene's depth

At first the exponential slices spanned the whole range from `near = 0.1` to `far = 1000`. Sponza is only about 30 units deep, so roughly a third of the 24 slices covered empty space beyond the scene. The slices that did contain geometry were too thick, and each one collected more lights than necessary. I added a `clusterFar = 50` constant: slices are distributed up to 50 units, and the last slice still extends to the far plane, so correctness is unchanged.

![](img/perf_clusterfar.png)

| ms (grid 16×9×24) | F+ 1000 | F+ 3000 | F+ 5000 | Def 1000 | Def 3000 | Def 5000 |
|---|---|---|---|---|---|---|
| before (far = 1000) | 19.61 | 41.16 | 56.65 | 6.24 | 11.92 | 16.45 |
| after (clusterFar = 50) | 15.97 | 34.25 | 50.06 | 5.78 | 10.38 | 14.38 |
| improvement | 19% | 17% | 12% | 7% | 13% | 13% |

* **Best case:** the camera is inside the scene and all geometry falls within `clusterFar`. Every slice is useful, and per-cluster light lists are shortest.
* **Worst case:** the camera moves far outside the atrium. Most geometry then lands in the single, huge last slice, which collects many lights, so frame time can be worse than with uniform-to-far slicing.
* **Trade-off:** `clusterFar` is a scene-dependent constant. A robust version would derive it each frame from the scene bounds or from a depth prepass.

### Optimization 2: cluster grid resolution

All rows use clusterFar = 50 and 24 Z slices.

| ms | F+ 1000 | F+ 3000 | F+ 5000 | Def 1000 | Def 3000 | Def 5000 |
|---|---|---|---|---|---|---|
| 8×5 | 20.72 | 41.16 | 58.96 | 6.30 | 11.91 | 16.61 |
| 16×9 | 15.97 | 34.25 | 50.06 | 5.78 | 10.38 | 14.38 |
| **32×18** | **14.17** | **30.02** | 44.96 | **5.75** | **9.77** | **13.35** |
| 64×36 | 16.14 | 34.14 | **42.93** | 6.18 | 10.45 | 14.63 |

![](img/perf_grid.png)

Finer tiles mean shorter light lists per cluster, which makes shading cheaper. However, the clustering pass does `clusters × lights` sphere-AABB tests: at 64×36×24 that is 55,296 clusters × 5000 lights ≈ 276 M tests per frame, so the compute pass starts to dominate. Coarse tiles (8×5) also risk overflowing the 512-light cap at high light counts, which would drop lights. **32×18×24** is the best overall balance, so it is the final configuration. (Each sweep was a separate run, so numbers differ slightly from the main table.)

### How this could be optimized further

* **Cheaper clustering:** instead of testing every light against every cluster, compute each light's screen-space and depth range once and scatter it only into the clusters it overlaps. This turns `clusters × lights` into roughly `lights × clusters-touched`.
* **Skip empty clusters:** a depth prepass can mark which clusters actually contain geometry, so only those are clustered. This would also give Forward+ overdraw-free shading.
* **Smaller G-buffer:** pack octahedral normals and albedo into one `vec4u`, and reconstruct position from depth instead of storing it. This would cut the 20 bytes/pixel substantially and reduce deferred's fixed cost at low light counts.
* **Compute-shader lighting pass** for deferred, and **render bundles** to cut CPU draw-call overhead.

### Deployment note: constants stripped by the production bundler

The first GitHub Pages build rendered a completely black screen in every mode, even though `npm run dev` worked. Diffing the bundle showed why: the shader constants object (`constants` in `shaders.ts`) had lost `lightRadius` and `clusterFar`. Those two keys are only read inside the `eval()`'d shader template strings, so Rollup's property tree-shaking treated them as unused and removed them. The shaders then contained `undefined` and failed to compile. The dev server doesn't tree-shake, so the bug only appears in production. The fix is one line in `shaders.ts`, which makes the object escape so every key is kept:

```ts
(globalThis as any).__shaderConstants = constants;
```

### Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)
