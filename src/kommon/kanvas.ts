// knexator's canvas

import * as twgl from "twgl.js";
import { Rectangle, Vec2, lerp } from "./math";
import * as m3 from "./m3"

export function initCtxFromSelector(canvas_selector: string): CanvasRenderingContext2D {
    const canvas = document.querySelector(canvas_selector)! as HTMLCanvasElement;

    // Assumption 1: canvas inner size is the same as display size
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const ctx = canvas.getContext("2d")!;

    return ctx;
}

export function initGlFromSelector(canvas_selector: string): WebGL2RenderingContext {
    const canvas = document.querySelector(canvas_selector)! as HTMLCanvasElement;

    // Assumption 1: transparent canvas is actually faster
    // Assumption 2: shader outputs are alpha-premultiplied
    // Assumption 3: canvas inner size is the same as display size
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true })!;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    return gl;
}

export function getCanvasSize(gl: WebGL2RenderingContext): Vec2 {
    let canvas = gl.canvas as HTMLCanvasElement;
    return new Vec2(canvas.clientWidth, canvas.clientHeight);
}

export function imageFromUrl(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.crossOrigin = 'Anonymous'; // to avoid CORS if used with Canvas
        img.src = url;
    });
}

export type ColorArray = [number, number, number, number];

export class ShakuStyleGraphics {
    position_cpu: Float32Array;
    uv_cpu: Float32Array;
    color_cpu: Float32Array;
    buffer_info: twgl.BufferInfo;
    shaders: Map<string, twgl.ProgramInfo>;
    vao_info: twgl.VertexArrayInfo;
    n_queued: number;
    cur_shader_name: string;
    private _matrix: Float32Array;
    constructor(
        public gl: WebGL2RenderingContext,
        public MAX_SPRITES: number = 2048,
    ) {
        this.shaders = new Map(Object.entries({
            "color": twgl.createProgramInfo(gl, [`#version 300 es
                uniform mat3 u_basis;

                in vec2 a_position;
                in vec2 a_uv;
                in vec4 a_color;

                out vec2 v_uv;
                out vec4 v_color;
                
                void main() {
                    gl_Position = vec4((u_basis * vec3(a_position, 1)).xy, 0, 1);
                    v_uv = a_uv;
                    v_color = a_color;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                in vec4 v_color;

                out vec4 out_color;
                void main() {
                    // Assume colors are not premultiplied
                    vec4 color = vec4(v_color.rgb * v_color.a, v_color.a);
                    out_color = color;
                }
            `]),
            fill_hex: twgl.createProgramInfo(gl, [`#version 300 es
                uniform mat3 u_basis;

                in vec2 a_position;
                in vec2 a_uv;
                in vec4 a_color;

                out vec2 v_uv;
                out vec4 v_color;
                
                void main() {
                    gl_Position = vec4((u_basis * vec3(a_position, 1)).xy, 0, 1);
                    v_uv = a_uv;
                    v_color = a_color;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                in vec4 v_color;

                out vec4 out_color;
                void main() {
                    vec2 p = abs(v_uv - .5) / 0.86602540378;
                    float dist = max(dot(p, vec2(.5, 0.86602540378)), p.x);
                    // Assume colors are not premultiplied
                    float delta = fwidth(dist) * 1.25;
                    out_color = vec4(v_color.rgb, mix(v_color.a, .0, smoothstep(.5 - delta, .5, dist)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            fill_circle: twgl.createProgramInfo(gl, [`#version 300 es
                uniform mat3 u_basis;

                in vec2 a_position;
                in vec2 a_uv;
                in vec4 a_color;

                out vec2 v_uv;
                out vec4 v_color;
                
                void main() {
                    gl_Position = vec4((u_basis * vec3(a_position, 1)).xy, 0, 1);
                    v_uv = a_uv;
                    v_color = a_color;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                in vec4 v_color;

                out vec4 out_color;
                void main() {
                    float dist = sqrt(dot(v_uv - .5, v_uv -.5));
                    // Assume colors are not premultiplied
                    float delta = fwidth(dist) * 1.25;
                    out_color = vec4(v_color.rgb, mix(v_color.a, .0, smoothstep(.5 - delta, .5, dist)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            // "texture": twgl.createProgramInfo(gl, [`#version 300 es
            //     // [-.5,+.5]^2
            //     in vec2 a_quad;
            //     uniform mat3 u_pos;
            //     uniform vec4 u_uvs;
            //     out vec2 v_uv;

            //     void main() {
            //         gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
            //         v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
            //     }
            //     `, `#version 300 es
            //     precision highp float;
            //     in vec2 v_uv;

            //     uniform sampler2D u_texture;

            //     out vec4 out_color;
            //     void main() {
            //         // Assume textures are premultiplied
            //         out_color = texture(u_texture, v_uv);
            //     }
            // `]),
        }));

        // 2 numbers, 4 bytes per number
        this.position_cpu = new Float32Array(2 * 4 * MAX_SPRITES);
        this.uv_cpu = new Float32Array(2 * 4 * MAX_SPRITES);
        this.color_cpu = new Float32Array(4 * 4 * MAX_SPRITES);

        const vertex_indices = new Uint16Array(MAX_SPRITES * 6);
        for (let k = 0; k < MAX_SPRITES; k += 1) {
            // top left triangle
            vertex_indices[k * 6 + 0] = k * 4 + 0;
            vertex_indices[k * 6 + 1] = k * 4 + 1;
            vertex_indices[k * 6 + 2] = k * 4 + 2;
            // bottom right triangle
            vertex_indices[k * 6 + 3] = k * 4 + 3;
            vertex_indices[k * 6 + 4] = k * 4 + 2;
            vertex_indices[k * 6 + 5] = k * 4 + 1;
        }

        this.buffer_info = twgl.createBufferInfoFromArrays(gl, {
            a_position: {
                data: 2 * 4 * MAX_SPRITES,
                numComponents: 2,
                type: Float32Array,
                drawType: gl.DYNAMIC_DRAW,
            },
            a_uv: {
                data: 2 * 4 * MAX_SPRITES,
                numComponents: 2,
                type: Float32Array,
                drawType: gl.DYNAMIC_DRAW,
            },
            a_color: {
                data: 4 * 4 * MAX_SPRITES,
                numComponents: 4,
                type: Float32Array,
                drawType: gl.DYNAMIC_DRAW,
            },
            indices: vertex_indices,
        });

        this.vao_info = twgl.createVertexArrayInfo(gl, Array.from(this.shaders.values()), this.buffer_info);

        this.cur_shader_name = "color";
        this.n_queued = 0;
        this._matrix = new Float32Array(9);
    }

    queueSquareFromCenter(center: Vec2, radius: number, color: ColorArray) {
        this.queueQuad(center.sub(Vec2.both(radius)), Vec2.both(radius * 2), Rectangle.unit, color);
    }

    // 01
    // 23
    queueQuad(top_left: Vec2, size: Vec2, uvs: Rectangle, color: ColorArray) {
        // 2 numbers, 4 vertices per quad
        let pos_index = this.n_queued * 2 * 4;
        pushVec2sToArray(this.position_cpu, pos_index, [
            top_left,
            top_left.addX(size.x),
            top_left.addY(size.y),
            top_left.add(size),
        ]);

        let uv_index = this.n_queued * 2 * 4;
        pushVec2sToArray(this.uv_cpu, uv_index, [
            uvs.topLeft,
            uvs.topLeft.addX(uvs.size.x),
            uvs.topLeft.addY(uvs.size.y),
            uvs.topLeft.add(uvs.size),
        ]);

        let color_index = this.n_queued * 4 * 4;
        for (let vertex = 0; vertex < 4; vertex++) {
            this.color_cpu[color_index + vertex * 4 + 0] = color[0];
            this.color_cpu[color_index + vertex * 4 + 1] = color[1];
            this.color_cpu[color_index + vertex * 4 + 2] = color[2];
            this.color_cpu[color_index + vertex * 4 + 3] = color[3];
        }

        this.n_queued += 1;
    }

    actuallyDraw() {
        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer_info.attribs!.a_position.buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.position_cpu, 0, this.n_queued * 4 * 2);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer_info.attribs!.a_uv.buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.uv_cpu, 0, this.n_queued * 4 * 2);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer_info.attribs!.a_color.buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.color_cpu, 0, this.n_queued * 4 * 4);

        let program_info = this.shaders.get(this.cur_shader_name)!;

        this.gl.useProgram(program_info.program)
        gl.bindVertexArray(this.vao_info.vertexArrayObject!);

        let canvas = this.gl.canvas as HTMLCanvasElement;
        m3.projection(canvas.clientWidth, canvas.clientHeight, this._matrix);
        twgl.setUniformsAndBindTextures(program_info, {
            u_basis: this._matrix,
        });

        twgl.drawBufferInfo(gl, this.vao_info, this.gl.TRIANGLES, this.n_queued * 6);

        this.n_queued = 0;
    }
}

function pushVec2sToArray(array: Float32Array, offset: number, values: Vec2[]): void {
    for (let k = 0; k < values.length; k++) {
        array[offset + 2 * k + 0] = values[k].x;
        array[offset + 2 * k + 1] = values[k].y;
    }
}

export type SpriteCall = {
    shader_name: string,
    params: Record<string, any>,
    center: Vec2,
    size: Vec2,
    radians_ccw: number,
    uvs: Rectangle,
};

export class NaiveSpriteGraphics {
    shaders: Map<string, twgl.ProgramInfo>;
    vao_info: twgl.VertexArrayInfo;
    private _matrix: Float32Array;

    constructor(
        public gl: WebGL2RenderingContext,
    ) {
        this.shaders = new Map(Object.entries({
            "color": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform vec4 u_color;

                out vec4 out_color;
                void main() {
                    // Assume colors are not premultiplied
                    vec4 color = vec4(u_color.rgb * u_color.a, u_color.a);
                    out_color = color;
                }
            `]),
            "texture": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform sampler2D u_texture;

                out vec4 out_color;
                void main() {
                    // Assume textures are premultiplied
                    out_color = texture(u_texture, v_uv);
                }
            `]),
            "texture_color": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform sampler2D u_texture;
                uniform vec4 u_color;

                out vec4 out_color;
                void main() {
                    vec4 color = vec4(u_color.rgb * u_color.a, u_color.a);
                    out_color = color * texture(u_texture, v_uv);
                }
            `]),
            "fill_hex": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform vec4 u_color;

                out vec4 out_color;
                void main() {
                    vec2 p = abs(v_uv - .5) / 0.86602540378;
                    float dist = max(dot(p, vec2(.5, 0.86602540378)), p.x);
                    // extra 25% for delta since i want a bit of extra aliasing
                    float delta = fwidth(dist) * 1.25;
                    out_color = vec4(u_color.rgb, mix(u_color.a, .0, smoothstep(.5 - delta, .5, dist)));
                    // out_color = vec4(u_color.rgb, mix(u_color.a, .0, smoothstep(-.01, .01, dist)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            "stroke_hex": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform vec4 u_color;
                uniform float u_radius_perc;
                uniform float u_width_perc;

                out vec4 out_color;
                void main() {
                    vec2 p = abs(v_uv - .5) / 0.86602540378;
                    float dist = max(dot(p, vec2(.5, 0.86602540378)), p.x);
                    float dist_to_radius = abs(u_radius_perc - dist);
                    float delta = fwidth(dist);
                    out_color = vec4(u_color.rgb, mix(u_color.a, .0, smoothstep(u_width_perc - delta, u_width_perc, dist_to_radius)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            "fill_circle": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform vec4 u_color;

                out vec4 out_color;
                void main() {
                    float dist = sqrt(dot(v_uv - .5, v_uv -.5));
                    // extra 25% for delta since i want a bit of extra aliasing
                    float delta = fwidth(dist) * 1.25;
                    out_color = vec4(u_color.rgb, mix(u_color.a, .0, smoothstep(.5 - delta, .5, dist)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            "stroke_circle": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform vec4 u_color;
                uniform float u_radius_perc;
                uniform float u_width_perc;

                out vec4 out_color;
                void main() {
                    float dist = sqrt(dot(v_uv - .5, v_uv -.5));
                    float dist_to_radius = abs(u_radius_perc - dist);
                    float delta = fwidth(dist);
                    out_color = vec4(u_color.rgb, mix(u_color.a, .0, smoothstep(u_width_perc - delta, u_width_perc, dist_to_radius)));
                    out_color.rgb *= out_color.a;
                }
            `]),
            "msdf": twgl.createProgramInfo(gl, [`#version 300 es
                // [-.5,+.5]^2
                in vec2 a_quad;
                uniform mat3 u_pos;
                uniform vec4 u_uvs;
                out vec2 v_uv;
                
                void main() {
                    gl_Position = vec4((u_pos * vec3(a_quad, 1)).xy, 0, 1);
                    v_uv = u_uvs.xy + (a_quad + .5) * u_uvs.zw;
                }
                `, `#version 300 es
                precision highp float;
                in vec2 v_uv;
                
                uniform sampler2D u_texture;
                uniform vec4 u_color;

                out vec4 out_color;

                float median(vec3 v) {
                    return max(min(v.x, v.y), min(max(v.x, v.y), v.z));
                }

                void main() {
                    vec3 raw =  texture(u_texture, v_uv).rgb;
                    float signed_distance = median(raw) - 0.5;
                    // that .7 is a total hack, TODO: revise
                    float alpha = clamp(.7 + signed_distance / fwidth(signed_distance), 0.0, 1.0);
                    out_color = vec4(u_color.rgb, u_color.a * alpha);
                    out_color.rgb *= out_color.a;
                }
            `]),
        }));

        const buffer_info = twgl.createBufferInfoFromArrays(gl, {
            a_quad: {
                data: [
                    // bottom right
                    0.5, 0.5,
                    -.5, 0.5,
                    0.5, -.5,
                    // top left
                    -.5, -.5,
                    0.5, -.5,
                    -.5, 0.5,
                ],
                numComponents: 2,
            }
        });

        // single attribute so no problem with ordering, i hope
        this.vao_info = twgl.createVertexArrayInfo(gl, this.shaders.get("color")!, buffer_info);

        this._matrix = new Float32Array(9);
    }

    /** The core function: draw a quad */
    draw(shader_name: string, params: Record<string, any>, center: Vec2, size: Vec2, radians_ccw: number, uvs: Rectangle) {
        let programinfo = this.shaders.get(shader_name);
        if (programinfo === undefined) throw new Error(`no shader with name ${shader_name}`);
        this.gl.useProgram(programinfo.program!);
        this.gl.bindVertexArray(this.vao_info.vertexArrayObject!);

        let canvas = this.gl.canvas as HTMLCanvasElement;
        m3.projection(canvas.clientWidth, canvas.clientHeight, this._matrix);
        m3.translate(this._matrix, center.x, center.y, this._matrix);
        m3.rotate(this._matrix, radians_ccw, this._matrix);
        m3.scale(this._matrix, size.x, size.y, this._matrix);

        twgl.setUniformsAndBindTextures(programinfo, {
            u_pos: this._matrix,
            u_uvs: [uvs.topLeft.x, uvs.topLeft.y, uvs.size.x, uvs.size.y],
        });
        twgl.setUniformsAndBindTextures(programinfo, params);
        twgl.drawBufferInfo(this.gl, this.vao_info);
    }

    drawFromCall(call: SpriteCall) {
        this.draw(call.shader_name, call.params, call.center, call.size, call.radians_ccw, call.uvs);
    }

    drawTopLeft(shader_name: string, params: Record<string, any>, top_left: Vec2, size: Vec2, radians_ccw: number, uvs: Rectangle) {
        this.draw(shader_name, params, Vec2.add(top_left, Vec2.scale(size, .5)), size, radians_ccw, uvs);
    }

    // TODO: doesn't look as good as ctx, investigate better antialiasing
    drawLine(a: Vec2, b: Vec2, width: number, color: ColorArray) {
        let delta = Vec2.sub(b, a);
        let dist = Vec2.mag(delta);
        this.draw("color", { u_color: color }, Vec2.lerp(a, b, .5), new Vec2(dist, width), -Vec2.radians(delta), Rectangle.unit);
    }

    fillHex(center: Vec2, radius: number, fill_color: ColorArray) {
        // actual quad drawn is 1.5px wider than 2 * outer_radius,
        // the outermost 1.5 pixels are used for the gradient to transparency
        this.draw("fill_hex", { u_color: fill_color }, center, new Vec2(radius * 2 + 1.5, radius * 2 + 1.5), 0, Rectangle.unit);
    }

    strokeHex(center: Vec2, radius: number, stroke_color: ColorArray, width: number) {
        width += 1.5; // weird hack to be consistent with the width from drawLine
        let quad_side = radius * 2 + width + 1.5
        this.draw("stroke_hex", {
            u_color: stroke_color,
            u_radius_perc: radius / (2 * radius + width + 1.5),
            u_width_perc: .5 * width / (2 * radius + width + 1.5),
        }, center, new Vec2(quad_side, quad_side), 0, Rectangle.unit);
    }

    fillCircle(center: Vec2, radius: number, fill_color: ColorArray) {
        // actual quad drawn is 1.5px wider than 2 * outer_radius,
        // the outermost 1.5 pixels are used for the gradient to transparency
        this.draw("fill_circle", { u_color: fill_color }, center, new Vec2(radius * 2 + 1.5, radius * 2 + 1.5), 0, Rectangle.unit);
    }

    genCallForFillCircle(center: Vec2, radius: number, fill_color: ColorArray): SpriteCall {
        // actual quad drawn is 1.5px wider than 2 * outer_radius,
        // the outermost 1.5 pixels are used for the gradient to transparency
        return {
            shader_name: "fill_circle",
            params: { u_color: fill_color },
            center: center,
            size: new Vec2(radius * 2 + 1.5, radius * 2 + 1.5),
            radians_ccw: 0,
            uvs: Rectangle.unit
        };
    }


    genCallForStrokeCircle(center: Vec2, radius: number, stroke_color: ColorArray, width: number): SpriteCall {
        width += 1.5; // weird hack to be consistent with the width from drawLine
        let quad_side = radius * 2 + width + 1.5
        return {
            shader_name: "stroke_circle",
            params: {
                u_color: stroke_color,
                u_radius_perc: radius / (2 * radius + width + 1.5),
                u_width_perc: .5 * width / (2 * radius + width + 1.5),
            },
            center: center,
            size: new Vec2(quad_side, quad_side),
            radians_ccw: 0,
            uvs: Rectangle.unit,
        }
    }

    strokeCircle(center: Vec2, radius: number, stroke_color: ColorArray, width: number) {
        width += 1.5; // weird hack to be consistent with the width from drawLine
        let quad_side = radius * 2 + width + 1.5
        this.draw("stroke_circle", {
            u_color: stroke_color,
            u_radius_perc: radius / (2 * radius + width + 1.5),
            u_width_perc: .5 * width / (2 * radius + width + 1.5),
        }, center, new Vec2(quad_side, quad_side), 0, Rectangle.unit);
    }

    fillRect(center: Vec2, size: Vec2, fill_color: ColorArray) {
        this.draw("color", { u_color: fill_color }, center, size, 0, Rectangle.unit);
    }

    fillRectTopLeft(top_left: Vec2, size: Vec2, fill_color: ColorArray) {
        this.draw("color", { u_color: fill_color }, Vec2.add(top_left, Vec2.scale(size, .5)), size, 0, Rectangle.unit);
    }

    // doesn't really 100% belong here, oh well
    textLineCentered(font: Font, text: string, center: Vec2, font_size: number, color: ColorArray) {
        let default_char_data = font.char_data.get("?")!;
        let pending_draw: {
            screen: Rectangle,
            uvs: Rectangle,
        }[] = [];

        let cur_pos = new Vec2(0, 0);
        let prev_char: string | null = null;

        for (let char of text) {
            if (char === "\\n") {
                throw new Error("unimplemented line breaks");
                // cur_pos.x = 0;
                // cur_pos.y += font.line_height;
                // prev_char = null;
                // continue;
            }
            let char_data = font.char_data.get(char) || default_char_data;
            if (char !== " ") {
                let kerning = 0;
                if (prev_char) {
                    kerning = font.kernings.get(prev_char + char) ?? 0;
                }
                pending_draw.push({
                    screen: new Rectangle(
                        Vec2.add(Vec2.add(cur_pos, Vec2.scale(char_data.offset, font_size)), new Vec2(kerning, 0)),
                        Vec2.scale(char_data.screen_size, font_size)
                    ),
                    uvs: char_data.uvs
                });
            }
            cur_pos = cur_pos.addX(char_data.advance * font_size);
            prev_char = char;
        }

        let global_offset = Vec2.sub(center, new Vec2(cur_pos.x / 2, font.base * font_size - font_size / 6)); // this 6 is a magic number

        for (let quad of pending_draw) {
            this.drawTopLeft("msdf", {
                u_texture: font.atlas,
                u_color: color,
            }, Vec2.add(global_offset, quad.screen.topLeft), quad.screen.size, 0, quad.uvs);
        }
    }
}

type CharData = {
    // after drawing this char, how many pixels should the cursor move forward, assuming a font size of 1
    advance: number,
    // how much in pixels to offset the cursor for drawing, assuming a font size of 1
    offset: Vec2,
    // how many pixels the quad takes on screen, assuming a font size of 1
    screen_size: Vec2,
    // uvs for extracting this char from the atlas
    uvs: Rectangle,
}

export type Font = {
    // char to use when the requested char isn't found
    default_char: string,
    char_data: Map<string, CharData>,
    // assuming a font size of 1; key is both chars
    kernings: Map<string, number>,
    // after finishing a line, how many pixels should the cursor move down, assuming a font size of 1
    line_height: number,
    // how many pixels between the absolute top of the line to the base of the characters, assuming a font size of 1
    base: number,
    atlas: WebGLTexture,
}

/**
 * Example usage:
 * import font_arial_data from "./fonts/Arial.json"
 * let font_arial_atlas = twgl.createTexture(gl, { src: getUrl("./fonts/Arial.png") });
 * let font_arial = createFont(font_arial_data, font_arial_atlas);
 */
export function createFont(mainfont_data: any, atlas_image: WebGLTexture, default_char: string = "?"): Font {
    let original_size = mainfont_data.info.size;
    let charFromId = new Map<number, string>();
    let mainfont_char_data = new Map<string, CharData>(mainfont_data.chars.map((charData: any) => {
        charFromId.set(charData.id, charData.char);
        return [charData.char, <CharData>{
            id: charData.id,
            uvs: new Rectangle(
                new Vec2(
                    charData.x / mainfont_data.common.scaleW,
                    charData.y / mainfont_data.common.scaleH,
                ),
                new Vec2(
                    charData.width / mainfont_data.common.scaleW,
                    charData.height / mainfont_data.common.scaleH,
                ),
            ),
            offset: new Vec2(charData.xoffset / original_size, charData.yoffset / original_size),
            // if font size was 1, how many screen pixels it would look like on screen?
            screen_size: new Vec2(charData.width / original_size, charData.height / original_size),
            // after drawing this character, how much to move the cursor
            advance: charData.xadvance / original_size,
        }]
    }));
    if (!mainfont_char_data.has(default_char)) throw new Error(`invalid default char ${default_char}; font has ${[...mainfont_char_data.keys()].join('')}`);
    let kernings = new Map<string, number>(mainfont_data.kernings.map((kerning: { first: number, second: number, amount: number }) => {
        let char_1 = charFromId.get(kerning.first)!;
        let char_2 = charFromId.get(kerning.second)!;
        return [char_1 + char_2, kerning.amount / original_size];
    }));
    return {
        default_char: default_char,
        char_data: mainfont_char_data,
        kernings: kernings,
        line_height: mainfont_data.common.lineHeight / original_size,
        base: mainfont_data.common.base / original_size,
        atlas: atlas_image,
    };
}

export class Color {
    constructor(
        public r: number,
        public g: number,
        public b: number,
        public a: number = 1.0,
    ) { }

    toArray(): ColorArray {
        return [this.r, this.g, this.b, this.a];
    }

    clone(): Color {
        return new Color(this.r, this.g, this.b, this.a);
    }

    toHex(include_alpha: boolean = false): string {
        let i = (f: number) => Math.floor(255 * f).toString(16).padStart(2, '0');
        let result = `#${i(this.r)}${i(this.g)}${i(this.b)}`
        if (include_alpha) {
            result += `${i(this.a)}`
        }
        return result;
    }

    static lerp(a: Color, b: Color, t: number): Color {
        return new Color(
            lerp(a.r, b.r, t),
            lerp(a.g, b.g, t),
            lerp(a.b, b.b, t),
            lerp(a.a, b.a, t),
        );
    }

    static fromHex(hex_str: string, alpha: number = 1): Color {
        let hex_number = Number(hex_str.replace('#', '0x'));
        return Color.fromInt(hex_number, alpha);
    }

    static fromInt(hex_number: number, alpha: number = 1): Color {
        return new Color(
            (hex_number >> 16) / 255,
            (hex_number >> 8 & 0xff) / 255,
            (hex_number & 0xff) / 255,
            alpha
        );
    }
}