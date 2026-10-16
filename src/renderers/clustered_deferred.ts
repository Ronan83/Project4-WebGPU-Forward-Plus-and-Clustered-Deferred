import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
        // G-buffer pass
    gBufferSceneBindGroupLayout: GPUBindGroupLayout;
    gBufferSceneBindGroup: GPUBindGroup;
    gBufferPipeline: GPURenderPipeline;

    positionTexture: GPUTexture;
    normalTexture: GPUTexture;
    albedoTexture: GPUTexture;
    depthTexture: GPUTexture;
    positionTextureView: GPUTextureView;
    normalTextureView: GPUTextureView;
    albedoTextureView: GPUTextureView;
    depthTextureView: GPUTextureView;

    // fullscreen pass
    fullscreenSceneBindGroupLayout: GPUBindGroupLayout;
    fullscreenSceneBindGroup: GPUBindGroup;
    gBufferTexturesBindGroupLayout: GPUBindGroupLayout;
    gBufferTexturesBindGroup: GPUBindGroup;
    fullscreenPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

                const w = renderer.canvas.width;
        const h = renderer.canvas.height;
        const gUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

        this.positionTexture = renderer.device.createTexture({ label: "g-buffer position", size: [w, h], format: "rgba16float", usage: gUsage });
        this.normalTexture = renderer.device.createTexture({ label: "g-buffer normal", size: [w, h], format: "rgba16float", usage: gUsage });
        this.albedoTexture = renderer.device.createTexture({ label: "g-buffer albedo", size: [w, h], format: "rgba8unorm", usage: gUsage });
        this.depthTexture = renderer.device.createTexture({ label: "g-buffer depth", size: [w, h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.positionTextureView = this.positionTexture.createView();
        this.normalTextureView = this.normalTexture.createView();
        this.albedoTextureView = this.albedoTexture.createView();
        this.depthTextureView = this.depthTexture.createView();

        // ---------- G-buffer pass ----------
        this.gBufferSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "g-buffer scene bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } } // camera
            ]
        });
        this.gBufferSceneBindGroup = renderer.device.createBindGroup({
            label: "g-buffer scene bind group",
            layout: this.gBufferSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } }
            ]
        });

        this.gBufferPipeline = renderer.device.createRenderPipeline({
            label: "g-buffer pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "g-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gBufferSceneBindGroupLayout,
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
                module: renderer.device.createShaderModule({ label: "g-buffer vert shader", code: shaders.naiveVertSrc }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: renderer.device.createShaderModule({ label: "g-buffer frag shader", code: shaders.clusteredDeferredFragSrc }),
                targets: [
                    { format: "rgba16float" }, // position
                    { format: "rgba16float" }, // normal
                    { format: "rgba8unorm" }   // albedo
                ]
            }
        });

        // ---------- fullscreen pass ----------
        this.fullscreenSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "fullscreen scene bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },           // camera
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }, // lightSet
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } }  // clusterSet
            ]
        });
        this.fullscreenSceneBindGroup = renderer.device.createBindGroup({
            label: "fullscreen scene bind group",
            layout: this.fullscreenSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } }
            ]
        });

        this.gBufferTexturesBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "g-buffer textures bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, // position
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, // normal
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }  // albedo
            ]
        });
        this.gBufferTexturesBindGroup = renderer.device.createBindGroup({
            label: "g-buffer textures bind group",
            layout: this.gBufferTexturesBindGroupLayout,
            entries: [
                { binding: 0, resource: this.positionTextureView },
                { binding: 1, resource: this.normalTextureView },
                { binding: 2, resource: this.albedoTextureView }
            ]
        });

        this.fullscreenPipeline = renderer.device.createRenderPipeline({
            label: "fullscreen pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "fullscreen pipeline layout",
                bindGroupLayouts: [
                    this.fullscreenSceneBindGroupLayout,
                    this.gBufferTexturesBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({ label: "fullscreen vert shader", code: shaders.clusteredDeferredFullscreenVertSrc })
            },
            fragment: {
                module: renderer.device.createShaderModule({ label: "fullscreen frag shader", code: shaders.clusteredDeferredFullscreenFragSrc }),
                targets: [ { format: renderer.canvasFormat } ]
            }
        });
    }

    override draw() {
                const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        this.lights.doLightClustering(encoder);

        // 1) G-buffer pass
        const gBufferPass = encoder.beginRenderPass({
            label: "g-buffer pass",
            colorAttachments: [
                { view: this.positionTextureView, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
                { view: this.normalTextureView, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
                { view: this.albedoTextureView, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        gBufferPass.setPipeline(this.gBufferPipeline);
        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferSceneBindGroup);
        this.scene.iterate(node => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gBufferPass.drawIndexed(primitive.numIndices);
        });
        gBufferPass.end();

        // 2) fullscreen lighting pass
        const fullscreenPass = encoder.beginRenderPass({
            label: "fullscreen lighting pass",
            colorAttachments: [
                { view: canvasTextureView, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }
            ]
        });
        fullscreenPass.setPipeline(this.fullscreenPipeline);
        fullscreenPass.setBindGroup(0, this.fullscreenSceneBindGroup);
        fullscreenPass.setBindGroup(1, this.gBufferTexturesBindGroup);
        fullscreenPass.draw(3);
        fullscreenPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
