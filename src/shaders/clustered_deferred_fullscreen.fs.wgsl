@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;

@group(1) @binding(0) var gPosition: texture_2d<f32>;
@group(1) @binding(1) var gNormal: texture_2d<f32>;
@group(1) @binding(2) var gAlbedo: texture_2d<f32>;

@fragment
fn main(@builtin(position) fragPos: vec4f) -> @location(0) vec4f
{
    let pixel = vec2i(fragPos.xy);
    let albedo = textureLoad(gAlbedo, pixel, 0);
    if (albedo.a == 0.0) {
        return vec4f(0, 0, 0, 1); // background, nothing was drawn here
    }
    let pos = textureLoad(gPosition, pixel, 0).xyz;
    let nor = textureLoad(gNormal, pixel, 0).xyz;

    // same cluster lookup as Forward+
    let tile = vec2u(fragPos.xy / camera.screenSize * vec2f(${clusterX}, ${clusterY}));
    let depth = -(camera.viewMat * vec4f(pos, 1.0)).z;
    let cz = zSliceFromDepth(depth, camera.near, camera.far);
    let c = vec3u(min(tile.x, ${clusterX} - 1u), min(tile.y, ${clusterY} - 1u), cz);
    let cluster = &clusterSet.clusters[clusterIndex(c)];

    var totalLightContrib = vec3f(0, 0, 0);
    let numLights = (*cluster).numLights;
    for (var i = 0u; i < numLights; i++) {
        let light = lightSet.lights[(*cluster).lightIndices[i]];
        totalLightContrib += calculateLightContrib(light, pos, nor);
    }

    return vec4f(albedo.rgb * totalLightContrib, 1.0);
}