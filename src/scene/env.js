import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Dusk sky, key/fill lights, a soft environment map for reflections, and bloom so bulbs/lanterns glow.

export const SUN_DIR = new THREE.Vector3(-12, 16, 8).normalize();

export function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  return coarse || small ? 'low' : 'high';
}

function skyDome() {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN_DIR.clone() }, time: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uMoon: { value: 0 }, uMoonCol: { value: new THREE.Vector3(0.85, 1.0, 0.75) }, moonDir: { value: new THREE.Vector3(0.32, 0.5, -0.8).normalize() } }, // tint / moon: the light switch's 万圣 and 熄灯 nights
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir; uniform float time; uniform vec3 uTint; uniform float uMoon; uniform vec3 uMoonCol; uniform vec3 moonDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 zenith = vec3(0.05, 0.06, 0.20), mid = vec3(0.30, 0.18, 0.46), horizon = vec3(1.45, 0.66, 0.30);
        vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.13, h));
        col = mix(col, zenith, smoothstep(0.1, 0.55, h));
        float s = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
        col += vec3(1.0, 0.45, 0.2) * pow(s, 6.0) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.9; // warm glow where the sun set
        // stars only high up
        vec3 g = floor(vDir * 220.0); float st = step(0.9975, hash(g)) * smoothstep(0.35, 0.8, h);
        col += st * (0.6 + 0.4 * sin(time * 2.0 + hash(g) * 30.0));
        if (vDir.y < 0.0) col = mix(horizon * 0.5, vec3(0.12, 0.08, 0.12), smoothstep(0.0, -0.2, vDir.y));
        col *= uTint;
        float md = dot(normalize(vDir), moonDir);
        col += uMoonCol * uMoon * (smoothstep(0.9975, 0.9982, md) * 1.6 + pow(max(md, 0.0), 220.0) * 0.6 + pow(max(md, 0.0), 24.0) * 0.12); // moon disc + halo
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = -1; m.frustumCulled = false; return m;
}

export function setupEnvironment(renderer, scene, camera, quality) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene.background = new THREE.Color(0x2a2447);
  scene.fog = new THREE.Fog(0x3a2a48, 34, 90);
  const sky = skyDome(); scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;

  const hemi = new THREE.HemisphereLight(0xffd7b0, 0x3d2c4a, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb27a, 2.1);
  sun.position.copy(SUN_DIR).multiplyScalar(30); sun.castShadow = true;
  const sm = quality === 'low' ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 8, far: 60 }); // follows the player: crisp and cheap
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8a7cff, 0.35); rim.position.set(10, 8, -14); scene.add(rim); // cool sky rim from behind

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), quality === 'low' ? 0.45 : 0.55, 0.45, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  return {
    sky, sun, hemi, rim, composer, bloom,
    resize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); bloom.resolution.set(w * (quality === 'low' ? 0.5 : 1), h * (quality === 'low' ? 0.5 : 1)); },
    update(t, focus) { sky.material.uniforms.time.value = t; sky.position.copy(camera.position); if (focus) { sun.position.copy(focus).addScaledVector(SUN_DIR, 30); sun.target.position.copy(focus); sun.target.updateMatrixWorld(); } },
    render() { composer.render(); },
  };
}
