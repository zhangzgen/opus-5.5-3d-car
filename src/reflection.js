// Planar mirror pass for the y = 0 road plane. Renders the scene from a mirrored camera into
// a half-resolution HDR target; the road shader samples it with roughness-driven streak blur.
import * as THREE from 'three';

export class PlanarReflection {
  constructor(scale = 0.5) {
    this.scale = scale;
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.matrix = new THREE.Matrix4();
    this._bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._rot = new THREE.Matrix4();
    this.enabled = true;
  }

  setSize(w, h) {
    this.target.setSize(Math.max(2, Math.floor(w * this.scale)), Math.max(2, Math.floor(h * this.scale)));
  }

  render(renderer, scene, camera) {
    const cam = this.camera;
    const camPos = this._v.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.02) return;
    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    cam.position.set(camPos.x, -camPos.y, camPos.z);
    this._t.copy(this._look);
    this._t.y = -this._t.y;
    cam.up.set(0, 1, 0).applyMatrix4(this._rot);
    cam.up.y = -cam.up.y;
    cam.lookAt(this._t);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    this.matrix.copy(this._bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // oblique near plane so nothing below the road leaks into the mirror
    this._plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(cam.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const p = cam.projectionMatrix.elements;
    const q = this._q;
    q.x = (Math.sign(clip.x) + p[8]) / p[0];
    q.y = (Math.sign(clip.y) + p[9]) / p[5];
    q.z = -1.0;
    q.w = (1.0 + p[10]) / p[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    p[2] = clip.x;
    p[6] = clip.y;
    p[10] = clip.z + 1.0 - 0.003;
    p[14] = clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }
}
