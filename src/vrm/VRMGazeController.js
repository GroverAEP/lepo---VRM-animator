import * as THREE from 'three';

export class VRMGazeController {
  constructor(vrm, facial, origin = () => new THREE.Vector3(), targetParent = null) {
    this.vrm = vrm;
    this.facial = facial;
    this.origin = origin;
    this.anchor = new THREE.Object3D();
    this.anchor.name = 'vrm-gaze-target';
    (targetParent ?? vrm.scene).add(this.anchor);
    this.focus = null;
    this.elapsed = 0;
    this.nextSaccade = 1.1;
    this.nextBlink = 2.8;
    this.blinkUntil = 0;
    this.blinkStart = 0;
    this.look = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.local = new THREE.Vector3();
    this.head = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
    this.leftEye = vrm.humanoid?.getNormalizedBoneNode('leftEye') ?? null;
    this.rightEye = vrm.humanoid?.getNormalizedBoneNode('rightEye') ?? null;
    this.eyeBases = [this.leftEye, this.rightEye].filter(Boolean).map((bone) => [bone, bone.rotation.clone()]);
  }

  setFocus(target) { this.focus = target ?? null; }

  setEnabled(enabled) { if (!enabled) { if (this.vrm.lookAt) this.vrm.lookAt.target = null; this.facial.blink(0); } }

  update(dt) {
    this.elapsed += dt;
    if (this.focus) {
      if (this.focus.isObject3D) this.focus.getWorldPosition(this.goal);
      else this.goal.copy(this.focus);
    } else if (this.elapsed >= this.nextSaccade) {
      const center = this.origin();
      this.goal.set(center.x + (Math.random() - 0.5) * 1.1, center.y + 1.45 + (Math.random() - 0.5) * 0.65, center.z + 1.3);
      this.nextSaccade = this.elapsed + 1.3 + Math.random() * 3.2;
    }
    this.look.lerp(this.goal, 1 - Math.exp(-5.5 * dt));
    this.anchor.position.copy(this.look);
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.anchor;
    else this.updateEyeBones(dt);

    if (this.elapsed >= this.nextBlink && !this.blinkUntil) {
      this.blinkStart = this.elapsed;
      this.blinkUntil = this.elapsed + 0.19;
      this.nextBlink = this.elapsed + 2.1 + Math.random() * 4.4;
    }
    if (this.blinkUntil) {
      const phase = (this.elapsed - this.blinkStart) / (this.blinkUntil - this.blinkStart);
      const weight = Math.sin(Math.PI * THREE.MathUtils.clamp(phase, 0, 1));
      this.facial.blink(weight);
      if (this.elapsed >= this.blinkUntil) this.blinkUntil = 0;
    } else this.facial.blink(0);
  }

  updateEyeBones(dt) {
    if (!this.head || !this.eyeBases.length) return;
    this.head.updateWorldMatrix(true, false);
    const local = this.head.worldToLocal(this.local.copy(this.look));
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.28, 0.28);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.18, 0.18);
    for (const [bone, base] of this.eyeBases) {
      bone.rotation.x = THREE.MathUtils.damp(bone.rotation.x, base.x + pitch, 7, dt);
      bone.rotation.y = THREE.MathUtils.damp(bone.rotation.y, base.y + yaw, 7, dt);
    }
  }

  dispose() {
    this.anchor.parent?.remove(this.anchor);
    this.facial.setLayer('blink', {});
  }
}
