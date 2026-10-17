import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    pipeline: GPURenderPipeline;

    // depth prepass (extra credit): draw depth first, then shade only the visible surface
    usePrepass: boolean;
    prepassPipeline?: GPURenderPipeline;

    constructor(stage: Stage, usePrepass = false) {
        super(stage);
        this.usePrepass = usePrepass;

        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "forward+ scene uniforms bind group layout",
            entries: [
                { // camera
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterSet
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "forward+ scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } }
            ]
        });

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        this.pipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "forward+ pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            // with the prepass, depth is already final: only the fragment with exactly that depth is shaded
            depthStencil: {
                depthWriteEnabled: !usePrepass,
                depthCompare: usePrepass ? "equal" : "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "forward+ vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ frag shader",
                    code: shaders.forwardPlusFragSrc,
                }),
                targets: [ { format: renderer.canvasFormat } ]
            }
        });
        if (usePrepass) {
            this.prepassPipeline = renderer.device.createRenderPipeline({
                label: "forward+ depth prepass pipeline",
                layout: renderer.device.createPipelineLayout({
                    label: "forward+ depth prepass pipeline layout",
                    bindGroupLayouts: [
                        this.sceneUniformsBindGroupLayout,
                        renderer.modelBindGroupLayout,
                        renderer.materialBindGroupLayout
                    ]
                }),
                depthStencil: {
                    depthWriteEnabled: true,
                    depthCompare: "less",
                    format: "depth24plus"
                },
                vertex: {
                    module: renderer.device.createShaderModule({
                        label: "depth prepass vert shader",
                        code: shaders.naiveVertSrc
                    }),
                    buffers: [ renderer.vertexBufferLayout ]
                },
                fragment: {
                    module: renderer.device.createShaderModule({
                        label: "depth prepass frag shader",
                        code: shaders.depthPrepassFragSrc
                    }),
                    targets: []
                }
            });
        }
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        this.lights.doLightClustering(encoder);

        if (this.usePrepass) {
            // depth-only pass: fills the depth buffer with the closest surface per pixel
            const prepass = encoder.beginRenderPass({
                label: "forward+ depth prepass",
                colorAttachments: [],
                depthStencilAttachment: {
                    view: this.depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store"
                }
            });
            prepass.setPipeline(this.prepassPipeline!);
            prepass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
            this.scene.iterate(node => {
                prepass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
            }, material => {
                prepass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
            }, primitive => {
                prepass.setVertexBuffer(0, primitive.vertexBuffer);
                prepass.setIndexBuffer(primitive.indexBuffer, 'uint32');
                prepass.drawIndexed(primitive.numIndices);
            });
            prepass.end();
        }

        const renderPass = encoder.beginRenderPass({
            label: "forward+ render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: this.usePrepass ? "load" : "clear", // keep the prepass depth
                depthStoreOp: "store"
            }
        });
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);

        this.scene.iterate(node => {
            renderPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            renderPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            renderPass.setVertexBuffer(0, primitive.vertexBuffer);
            renderPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            renderPass.drawIndexed(primitive.numIndices);
        });

        renderPass.end();
        renderer.device.queue.submit([encoder.finish()]);
    }
}
