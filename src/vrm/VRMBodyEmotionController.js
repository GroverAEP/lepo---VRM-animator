import * as THREE from 'three';

const POSES = {
  neutral: { leftLowerArm: { x: -0.055 }, rightLowerArm: { x: -0.055 } },
  happy: { head: { z: -0.055, x: -0.025 }, chest: { x: -0.018 }, leftUpperArm: { x: -0.045 }, rightUpperArm: { x: -0.045 }, leftHand: { z: -0.08 }, rightHand: { z: 0.08 } },
  sad: { head: { x: 0.13, z: 0.025 }, chest: { x: 0.075 }, spine: { x: 0.055 }, leftShoulder: { z: 0.035 }, rightShoulder: { z: -0.035 }, leftUpperArm: { x: 0.06 }, rightUpperArm: { x: 0.06 } },
  angry: { head: { x: -0.08 }, chest: { x: -0.035 }, spine: { x: -0.025 }, leftShoulder: { z: -0.04 }, rightShoulder: { z: 0.04 }, leftUpperArm: { x: -0.08, z: -0.06 }, rightUpperArm: { x: -0.08, z: 0.06 }, leftLowerArm: { x: -0.1 }, rightLowerArm: { x: -0.1 } },
  surprised: { head: { x: -0.08 }, chest: { x: -0.055 }, leftShoulder: { z: -0.045 }, rightShoulder: { z: 0.045 }, leftUpperArm: { z: -0.13 }, rightUpperArm: { z: 0.13 } },
  thoughtful: { head: { x: 0.045, z: 0.09 }, neck: { y: 0.07 }, leftUpperArm: { x: -0.05 }, rightUpperArm: { x: -0.12, z: 0.12 }, rightLowerArm: { x: -0.18 }, rightHand: { x: -0.08 } },
};

const ALIASES = { calm: 'neutral', curious: 'neutral', confused: 'thoughtful', shy: 'happy', impatient: 'angry', afraid: 'surprised', sorrow: 'sad', joy: 'happy' };

/** Smooth additive body posture layer, independent from facial expressions and locomotion. */
export class VRMBodyEmotionController {
  constructor() {
    this.emotion = 'neutral';
    this.intensity = 1;
    this.pose = {};
    this.target = {};
    this.transitionSpeed = 3.8;
    for (const bone of ['hips','spine','chest','upperChest','neck','head','leftShoulder','rightShoulder','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand', ...Array.from({length: 30}, (_, i) => `finger${i}`)]) {
      this.pose[bone] = { x: 0, y: 0, z: 0 };
      this.target[bone] = { x: 0, y: 0, z: 0 };
    }
  }

  setEmotion(emotion, intensity = 1) {
    this.emotion = ALIASES[emotion] ?? emotion;
    this.intensity = THREE.MathUtils.clamp(intensity, 0, 1.5);
  }

  update(dt, fingerBones = []) {
    for (const name in this.target) this.target[name].x = this.target[name].y = this.target[name].z = 0;
    const source = POSES[this.emotion] ?? POSES.neutral;
    for (const bone in source) {
      const axes = source[bone];
      const target = this.target[bone];
      if (target) for (const axis of ['x','y','z']) target[axis] = (axes[axis] ?? 0) * this.intensity;
    }
    if (this.emotion === 'surprised') {
      for (let i = 0; i < fingerBones.length; i++) {
        const name = typeof fingerBones[i] === 'string' ? fingerBones[i] : fingerBones[i].name;
        if (!name.includes('Thumb')) {
          const fingerTarget = this.target[name] ?? (this.target[name] = { x: 0, y: 0, z: 0 });
          if (!this.pose[name]) this.pose[name] = { x: 0, y: 0, z: 0 };
          fingerTarget.x -= 0.12 * this.intensity;
        }
      }
    }
    const blend = 1 - Math.exp(-this.transitionSpeed * dt);
    for (const name in this.pose) {
      const current = this.pose[name], target = this.target[name] ?? ZERO;
      current.x += (target.x - current.x) * blend;
      current.y += (target.y - current.y) * blend;
      current.z += (target.z - current.z) * blend;
    }
    return this.pose;
  }
}

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
