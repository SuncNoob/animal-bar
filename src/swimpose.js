import * as THREE from 'three';

// Swimming posture layered on top of Tripo's (face-down) swim clip:
//  - tilt the body about the hips so the head rides above the water and looks ahead
//  - moving: a cute dog-paddle (front paws circling in front of the chest, alternating) + flutter kick
//  - idle: nearly upright treading water with slow paws
// Returns how far below the water surface the character root should sit.

const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _wq = new THREE.Quaternion(), LAT = new THREE.Vector3();
function rot(bone, axis, angle) {
  if (!bone) return;
  bone.parent.getWorldQuaternion(_pq).invert();
  _ax.copy(axis).applyQuaternion(_pq).normalize();
  bone.quaternion.premultiply(_q.setFromAxisAngle(_ax, angle));
}
const lerp = THREE.MathUtils.lerp;

export const DEPTH_IDLE = 0.48, DEPTH_MOVING = 0.39;

export function swimPose(ch, st, dt, { speed = 0, dash = false }) {
  const target = speed > 0.4 ? 1 : 0;
  st.w = (st.w ?? 0) + (target - (st.w ?? 0)) * Math.min(1, dt * 4);
  const w = st.w;
  if (!ch.tilt) return lerp(DEPTH_IDLE, DEPTH_MOVING, w);
  ch.tilt.rotation.x = lerp(-1.2, -0.45, w); // head up: upright treading → half-prone paddle
  const hz = lerp(0.9, dash ? 2.6 : 1.6, w);
  st.ph = ((st.ph ?? Math.random() * 6) + dt * Math.PI * 2 * hz) % (Math.PI * 200);
  const b = ch.bones, ph = st.ph;
  LAT.set(1, 0, 0).applyQuaternion(ch.tilt.getWorldQuaternion(_wq)); // the body's left-right axis in world space
  const amp = lerp(0.35, 0.6, w);
  // paws trace small loops: upper arm swings, forearm leads by a quarter turn; right side half a cycle later
  rot(b.L_Upperarm, LAT, amp * Math.sin(ph));
  rot(b.L_Forearm, LAT, amp * 0.9 * Math.sin(ph + Math.PI / 2));
  rot(b.R_Upperarm, LAT, amp * Math.sin(ph + Math.PI));
  rot(b.R_Forearm, LAT, amp * 0.9 * Math.sin(ph + Math.PI * 1.5));
  rot(b.L_Thigh, LAT, 0.3 * Math.sin(ph * 1.3));
  rot(b.R_Thigh, LAT, -0.3 * Math.sin(ph * 1.3));
  rot(b.Head, LAT, -0.35 * w); // chin up, eyes forward
  st.stroke = Math.sin(ph); // callers use this for splash timing
  return lerp(DEPTH_IDLE, DEPTH_MOVING, w) - Math.abs(Math.sin(ph)) * 0.025 * w; // tiny bob with each stroke
}

// Ease the tilt back to upright when leaving the water.
export function landPose(ch, dt) {
  if (ch.tilt && ch.tilt.rotation.x !== 0) { ch.tilt.rotation.x *= Math.max(0, 1 - dt * 8); if (Math.abs(ch.tilt.rotation.x) < 0.01) ch.tilt.rotation.x = 0; }
}

// 蹦迪: an over-the-top club dance layered on the idle clip — a hard head-bang on every beat, left and right fists taking
// turns punching the sky, the torso pumping and the hips swaying, a little hop each beat. The beat comes from the wall
// clock at the disco's 124 BPM, so everyone in the yard dances in step. `on` eases the moves in/out.
const BPM = 124, FWD = new THREE.Vector3(), SIDE = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
export function dancePose(ch, st, dt, on) {
  st.w = (st.w ?? 0) + ((on ? 1 : 0) - (st.w ?? 0)) * Math.min(1, dt * 7);
  const w = st.w; ch.hop = 0;
  if (w < 0.01 || !ch.bones) return;
  const beat = (Date.now() / 1000) * BPM / 60, ph = beat % 1;
  const hit = Math.pow(1 - ph, 3);                 // snaps on the beat, then relaxes
  const swing = Math.sin(Math.PI * beat);          // one full left/right exchange every two beats
  const L = 0.5 + 0.5 * swing, R = 1 - L;          // 1 = that fist is up
  const q = ch.root.getWorldQuaternion(_wq);
  FWD.set(0, 0, 1).applyQuaternion(q); SIDE.set(1, 0, 0).applyQuaternion(q);
  const b = ch.bones;
  // fists out in front of the chest, pumping up and down — left and right in turn, once per beat
  const pump = Math.sin(2 * Math.PI * beat), Lp = 0.5 + 0.5 * pump, Rp = 1 - Lp;
  rot(b.L_Upperarm, SIDE, -w * (0.75 + 1.15 * Lp));   // arms forward; the "up" fist punches up past the chin
  rot(b.R_Upperarm, SIDE, -w * (0.75 + 1.15 * Rp));
  rot(b.L_Upperarm, UPV, -w * 0.4);                    // fists towards the middle, not out wide
  rot(b.R_Upperarm, UPV, w * 0.4);
  rot(b.L_Forearm, SIDE, -w * (1.25 - 0.75 * Lp));      // elbows bent, fists up
  rot(b.R_Forearm, SIDE, -w * (1.25 - 0.75 * Rp));
  // head-bang + body pump on the beat, hips sway every two beats
  rot(b.Head, SIDE, w * (0.8 * hit - 0.18));
  rot(b.NeckTwist01, SIDE, w * 0.22 * hit);
  rot(b.Spine01, SIDE, w * 0.24 * hit);
  rot(b.Waist, UPV, w * 0.32 * swing);
  rot(b.Head, UPV, -w * 0.28 * swing);
  ch.hop = w * 0.12 * Math.sin(Math.PI * ph);      // a hop on every beat
  if (ch.tilt) ch.tilt.position.y += ch.hop;
}

// 骑车: on the 'sit' clip — legs pedal in turn, arms reach forward for the handlebar, torso leans in, head up.
export function ridePose(ch, st, dt, on, speed = 0, bike = null) {
  st.w = (st.w ?? 0) + ((on ? 1 : 0) - (st.w ?? 0)) * Math.min(1, dt * 10);
  const w = st.w; if (w < 0.01 || !ch.bones) return;
  st.ph = ((st.ph ?? 0) + dt * (1.5 + speed * 2.2)) % (Math.PI * 200);
  const q = ch.root.getWorldQuaternion(_wq), b = ch.bones;
  FWD.set(0, 0, 1).applyQuaternion(q); SIDE.set(1, 0, 0).applyQuaternion(q);
  rot(b.Spine01, SIDE, w * 0.28); rot(b.Head, SIDE, -w * 0.3); // lean into the bars, eyes on the road
  if (bike) { // chibi legs can't reach the cranks: straighten them and point the feet at the turning pedals; paws to the grips
    for (const [side, T, C, F, U, A, H] of [[-1, b.L_Thigh, b.L_Calf, b.L_Foot, b.L_Upperarm, b.L_Forearm, b.L_Hand], [1, b.R_Thigh, b.R_Calf, b.R_Foot, b.R_Upperarm, b.R_Forearm, b.R_Hand]]) {
      straighten(T, C, F, 0.7 * w); aim(T, F, bike.pedalWorld(_tgt, side, 0.06), w);
      straighten(U, A, H, 0.5 * w); aim(U, H, bike.handWorld(_tgt, side), w);
    }
    return;
  }
  const p = Math.sin(st.ph);
  rot(b.L_Thigh, SIDE, -w * (0.35 + 0.45 * p)); rot(b.R_Thigh, SIDE, -w * (0.35 - 0.45 * p));
  rot(b.L_Calf, SIDE, w * (0.25 + 0.35 * p)); rot(b.R_Calf, SIDE, w * (0.25 - 0.35 * p));
  rot(b.L_Upperarm, SIDE, -w * 1.15); rot(b.R_Upperarm, SIDE, -w * 1.15);
  rot(b.L_Upperarm, UPV, w * 0.15); rot(b.R_Upperarm, UPV, -w * 0.15);
  rot(b.L_Forearm, SIDE, -w * 0.35); rot(b.R_Forearm, SIDE, -w * 0.35);
}

// turn `bone` about its pivot so that its descendant `tip` points at `target` (world), `k` of the way
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _axis = new THREE.Vector3(), _tgt = new THREE.Vector3();
function aim(bone, tip, target, k) {
  if (!bone || !tip || k <= 0) return;
  bone.updateWorldMatrix(true, true); bone.getWorldPosition(_a); tip.getWorldPosition(_b);
  _b.sub(_a); _c.copy(target).sub(_a); if (_b.lengthSq() < 1e-10 || _c.lengthSq() < 1e-10) return;
  _b.normalize(); _c.normalize(); _axis.crossVectors(_b, _c);
  const s = _axis.length(); if (s < 1e-6) return;
  rot(bone, _axis.divideScalar(s), Math.atan2(s, _b.dot(_c)) * k);
}
// unbend the joint between `upper` and `lower` (knee / elbow) by `k`: the lower bone continues the upper one's line
function straighten(upper, lower, tip, k) {
  if (!upper || !lower || !tip) return;
  upper.updateWorldMatrix(true, true); upper.getWorldPosition(_a); lower.getWorldPosition(_tgt);
  _tgt.multiplyScalar(2).sub(_a); aim(lower, tip, _tgt, k);
}

// 冲浪: standing on the board — knees bent, arms out for balance, a little sway. `on` eases it in and out.
export function surfPose(ch, st, dt, on, speed = 0) {
  st.w = (st.w ?? 0) + ((on ? 1 : 0) - (st.w ?? 0)) * Math.min(1, dt * 8);
  const w = st.w; if (w < 0.01 || !ch.bones) return;
  st.t = (st.t ?? 0) + dt;
  const q = ch.root.getWorldQuaternion(_wq), b = ch.bones, sway = Math.sin(st.t * 2.3), fast = Math.min(1, speed / 6);
  FWD.set(0, 0, 1).applyQuaternion(q); SIDE.set(1, 0, 0).applyQuaternion(q);
  rot(b.L_Upperarm, FWD, w * (1.15 + 0.2 * sway)); rot(b.R_Upperarm, FWD, -w * (1.15 - 0.2 * sway)); // arms out to the sides
  rot(b.L_Forearm, FWD, w * 0.25); rot(b.R_Forearm, FWD, -w * 0.25);
  rot(b.L_Thigh, SIDE, -w * 0.32); rot(b.R_Thigh, SIDE, -w * 0.32); rot(b.L_Calf, SIDE, w * 0.5); rot(b.R_Calf, SIDE, w * 0.5); // knees bent
  rot(b.Spine01, SIDE, w * (0.18 + 0.15 * fast)); rot(b.Spine01, FWD, w * 0.12 * sway); rot(b.Head, SIDE, -w * 0.2);
}
