// HDR post chain: MSAA scene → bloom → speed blur, chromatic fringe, ACES tone map, grade, grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uNitro: { value: 0 },
    uExposure: { value: 1.0 },
    uAberr: { value: 0.0012 },
    uVignette: { value: 0.85 },
    uGrain: { value: 0.035 },
    uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uNitro, uExposure, uAberr, uVignette, uGrain, uFlash;
    uniform vec2 uCenter;
    varying vec2 vUv;
    vec3 mxRRTODT(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 mxACES(vec3 color) {
      const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color = ACESInputMat * color;
      color = mxRRTODT(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec2 dir = vUv - uCenter;
      float dist = length(dir);
      float amt = (uSpeed * 0.028 + uNitro * 0.03) * smoothstep(0.12, 0.75, dist);
      float ab = uAberr * (1.0 + uNitro * 2.5) * dist;
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 10; i++) {
        float t = float(i) / 9.0;
        float w = 1.0 - t * 0.55;
        vec2 o = dir * amt * t;
        vec2 uv = vUv - o;
        col.r += texture2D(tDiffuse, uv - dir * ab).r * w;
        col.g += texture2D(tDiffuse, uv).g * w;
        col.b += texture2D(tDiffuse, uv + dir * ab).b * w;
        wsum += w;
      }
      col /= wsum;
      if (any(isnan(col))) col = vec3(0.0);
      col *= uExposure;
      col += uFlash;
      col = mxACES(col);
      // grade: cool shadows, warm highlights, a touch of contrast
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.92, 1.0, 1.12), (1.0 - smoothstep(0.0, 0.35, l)) * 0.35);
      col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.45, 1.0, l) * 0.3);
      col = toSRGB(col);
      col = (col - 0.5) * 1.05 + 0.5;
      float vig = smoothstep(1.05, 0.25, length((vUv - 0.5) * vec2(1.25, 1.0)));
      col *= mix(1.0, vig, uVignette);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.31) * 100.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.5, 1.9);
    // sanitise the bloom input: clamp HDR peaks and drop any NaN before it gets blurred across the frame
    this.bloom.materialHighPassFilter.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 defaultColor;
      uniform float defaultOpacity;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 c = texel.rgb;
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        c = clamp(c, 0.0, 32.0);
        float v = dot(c, vec3(0.299, 0.587, 0.114));
        float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
        gl_FragColor = mix(vec4(defaultColor.rgb, defaultOpacity), vec4(c, texel.a), alpha);
      }`;
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.final = new ShaderPass(FinalShader);
    this.final.material.toneMapped = false;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;
  }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }
  setBloom(on) { this.bloom.enabled = on; }
  render(dt) {
    this.u.uTime.value += dt;
    this.composer.render(dt);
  }
}
