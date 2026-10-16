// CHECKITOUT: code that you add here will be prepended to all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

struct Cluster {
    numLights: u32,
    lightIndices: array<u32, ${maxLightsPerCluster}>
}

struct ClusterSet {
    clusters: array<Cluster>
}

struct CameraUniforms {
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    invProjMat: mat4x4f,
    screenSize: vec2f,
    near: f32,
    far: f32
}

fn clusterIndex(c: vec3u) -> u32 {
    return c.x + c.y * ${clusterX} + c.z * ${clusterX} * ${clusterY};
}

// view-space depth (positive) -> exponential Z slice
fn zSliceFromDepth(depth: f32, near: f32, far: f32) -> u32 {
    let s = log(depth / near) / log(far / near) * f32(${clusterZ});
    return u32(clamp(s, 0.0, f32(${clusterZ} - 1)));
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}
