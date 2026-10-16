// one big triangle that covers the whole screen
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f
{
    let positions = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(positions[vertexIndex], 0.0, 1.0);
}