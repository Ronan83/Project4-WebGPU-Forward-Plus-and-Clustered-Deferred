// Depth prepass: writes depth only. The alpha test must match the lighting pass,
// otherwise cut-out leaves would block the surfaces behind them.

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput)
{
    if (textureSample(diffuseTex, diffuseTexSampler, in.uv).a < 0.5f) {
        discard;
    }
}
