@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> clusterSet: ClusterSet;

// NDC (x, y) on the far plane -> view-space point, then scale it onto the plane z = -depth
fn ndcToViewAtDepth(ndc: vec2f, depth: f32) -> vec3f {
    let p = camera.invProjMat * vec4f(ndc, 1.0, 1.0);
    let v = p.xyz / p.w;
    return v * (depth / -v.z);
}

fn sphereIntersectsAABB(center: vec3f, radius: f32, bmin: vec3f, bmax: vec3f) -> bool {
    let closest = clamp(center, bmin, bmax);
    let d = center - closest;
    return dot(d, d) <= radius * radius;
}

@compute
@workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let numClusters = u32(${clusterX} * ${clusterY} * ${clusterZ});
    let idx = gid.x;
    if (idx >= numClusters) {
        return;
    }

    let cx = idx % ${clusterX};
    let cy = (idx / ${clusterX}) % ${clusterY};
    let cz = idx / (${clusterX} * ${clusterY});

    // screen-space tile bounds in NDC (y flipped: tile row 0 is the top of the screen)
    let uvMin = vec2f(f32(cx), f32(cy)) / vec2f(${clusterX}, ${clusterY});
    let uvMax = vec2f(f32(cx + 1), f32(cy + 1)) / vec2f(${clusterX}, ${clusterY});
    let ndcMin = vec2f(uvMin.x * 2.0 - 1.0, 1.0 - uvMax.y * 2.0);
    let ndcMax = vec2f(uvMax.x * 2.0 - 1.0, 1.0 - uvMin.y * 2.0);

    // exponential depth slice bounds (positive view-space depth)
    let ratio = f32(${clusterFar}) / camera.near;
    let zNear = camera.near * pow(ratio, f32(cz) / f32(${clusterZ}));
    var zFar = camera.near * pow(ratio, f32(cz + 1) / f32(${clusterZ}));
    if (cz == ${clusterZ} - 1) {
        zFar = camera.far; // last slice catches everything beyond clusterFar
    }

    // 8 corners of the frustum slice -> view-space AABB
    let p0 = ndcToViewAtDepth(ndcMin, zNear);
    let p1 = ndcToViewAtDepth(ndcMax, zNear);
    let p2 = ndcToViewAtDepth(vec2f(ndcMin.x, ndcMax.y), zNear);
    let p3 = ndcToViewAtDepth(vec2f(ndcMax.x, ndcMin.y), zNear);
    let p4 = ndcToViewAtDepth(ndcMin, zFar);
    let p5 = ndcToViewAtDepth(ndcMax, zFar);
    let p6 = ndcToViewAtDepth(vec2f(ndcMin.x, ndcMax.y), zFar);
    let p7 = ndcToViewAtDepth(vec2f(ndcMax.x, ndcMin.y), zFar);
    let bmin = min(min(min(p0, p1), min(p2, p3)), min(min(p4, p5), min(p6, p7)));
    let bmax = max(max(max(p0, p1), max(p2, p3)), max(max(p4, p5), max(p6, p7)));

    let cluster = &clusterSet.clusters[idx];
    var count = 0u;
    for (var i = 0u; i < lightSet.numLights; i++) {
        let lightView = (camera.viewMat * vec4f(lightSet.lights[i].pos, 1.0)).xyz;
        if (sphereIntersectsAABB(lightView, ${lightRadius}, bmin, bmax)) {
            (*cluster).lightIndices[count] = i;
            count++;
            if (count >= ${maxLightsPerCluster}) {
                break;
            }
        }
    }
    (*cluster).numLights = count;
}
