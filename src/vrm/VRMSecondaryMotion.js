import * as THREE from 'three';

const SECONDARY_NAME = /hair|tail|ear|ribbon|ponytail|accessory|wing/i;

/** Keeps VRM spring-bones enabled and adds gentle sway only to named, unmanaged accessory nodes. */
export class VRMSecondaryMotion {
  constructor(vrm) {
    this.vrm = vrm; this.enabled = true; this.speed = 0; this.phase = 0; this.nodes = [];
    const manager = vrm.springBoneManager;
    this.springManager = manager ?? null;
    this.originalSpringUpdate = manager?.update;
    if (manager && this.originalSpringUpdate) {
      const original = this.originalSpringUpdate.bind(manager);
      manager.update = (dt) => { if (this.enabled) original(dt); };
    }
    const managed = new Set([...(manager?.joints ?? [])].map((joint) => joint.bone));
    const humanoid = new Set(Object.values(vrm.humanoid?.normalizedHumanBones ?? {}).map((bone) => bone?.node).filter(Boolean));
    vrm.scene.traverse((node) => {
      if (!node.isBone || !node.name || !SECONDARY_NAME.test(node.name) || managed.has(node) || humanoid.has(node)) return;
      this.nodes.push({ node, base: node.quaternion.clone(), velocity: 0, angle: 0, axis: node.name.toLowerCase().includes('tail') ? 'x' : 'z' });
    });
  }

  setEnabled(enabled) { this.enabled = Boolean(enabled); }
  setSpeed(speed) { this.speed = Math.max(0, speed); }

  update(dt) {
    if (!this.enabled || !this.nodes.length) return;
    this.phase += dt * (2.2 + this.speed * 2.8);
    const drive = Math.min(0.13, this.speed * 0.035);
    for (const item of this.nodes) {
      const target = Math.sin(this.phase + item.node.id * 0.31) * drive;
      item.velocity += (target - item.angle) * 18 * dt;
      item.velocity *= Math.exp(-6.5 * dt);
      item.angle = THREE.MathUtils.clamp(item.angle + item.velocity * dt, -0.16, 0.16);
      item.node.quaternion.copy(item.base);
      item.node.rotation[item.axis] += item.angle;
    }
  }

  dispose() {
    if (this.springManager && this.originalSpringUpdate) this.springManager.update = this.originalSpringUpdate;
    for (const item of this.nodes) item.node.quaternion.copy(item.base);
    this.nodes.length = 0;
  }
}
