@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @builtin(position) fragPos: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    // which cluster is this fragment in?
    let tile = vec2u(in.fragPos.xy / camera.screenSize * vec2f(${clusterX}, ${clusterY}));
    let depth = -(camera.viewMat * vec4f(in.pos, 1.0)).z;
    let cz = zSliceFromDepth(depth, camera.near, f32(${clusterFar}));
    let c = vec3u(min(tile.x, ${clusterX} - 1u), min(tile.y, ${clusterY} - 1u), cz);
    let cluster = &clusterSet.clusters[clusterIndex(c)];

    let nor = normalize(in.nor);
    var totalLightContrib = vec3f(0, 0, 0);
    let numLights = (*cluster).numLights;
    for (var i = 0u; i < numLights; i++) {
        let light = lightSet.lights[(*cluster).lightIndices[i]];
        totalLightContrib += calculateLightContrib(light, in.pos, nor);
    }

    var finalColor = diffuseColor.rgb * totalLightContrib;
    return vec4(finalColor, 1);
}
