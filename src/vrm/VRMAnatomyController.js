import * as THREE from 'three';

/** Opt-in only: callers must register a known accessory/anatomy bone explicitly. */
export class VRMAnatomyController {
  constructor() { this.enabled = false; this.items = new Set(); this.speed = 0; this.phase = 0; }

  registerNode(node, { maxAngle = 0.12, axis = 'x' } = {}) {
    if (!node?.isBone || !['x', 'y', 'z'].includes(axis)) return false;
    this.items.add({ node, axis, base: node.rotation.clone(), maxAngle: THREE.MathUtils.clamp(maxAngle, 0, 0.2), angle: 0, velocity: 0 });
    return true;
  }

  setEnabled(enabled) { this.enabled = Boolean(enabled); }
  setSpeed(speed) { this.speed = Math.max(0, speed); }

  update(dt) {
    if (!this.enabled) return;
    this.phase += dt * (2 + this.speed * 2.5);
    for (const item of this.items) {
      const target = Math.sin(this.phase + item.node.id * 0.27) * Math.min(item.maxAngle, this.speed * 0.025);
      item.velocity += (target - item.angle) * 14 * dt;
      item.velocity *= Math.exp(-5.8 * dt);
      item.angle = THREE.MathUtils.clamp(item.angle + item.velocity * dt, -item.maxAngle, item.maxAngle);
      item.node.rotation.copy(item.base);
      item.node.rotation[item.axis] += item.angle;
    }
  }

  dispose() { for (const item of this.items) item.node.rotation.copy(item.base); this.items.clear(); }
}
