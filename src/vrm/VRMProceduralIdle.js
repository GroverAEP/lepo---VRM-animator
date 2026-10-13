export class VRMProceduralIdle {
  constructor() {
    this.time = 0; this.weight = 1;
    this.pose = {
      spine: { x: 0, z: 0 }, chest: { x: 0 }, hips: { y: 0 }, head: { x: 0, z: 0 },
      leftUpperArm: { z: 0 }, rightUpperArm: { z: 0 }, leftHand: { x: 0 }, rightHand: { x: 0 },
    };
  }

  update(dt, weight = 1) {
    this.time += dt;
    this.weight += (weight - this.weight) * (1 - Math.exp(-4 * dt));
    const t = this.time;
    this.pose.spine.x = Math.sin(t * 1.25) * 0.014 * this.weight;
    this.pose.spine.z = Math.sin(t * 0.43) * 0.012 * this.weight;
    this.pose.chest.x = Math.sin(t * 1.25 + 0.2) * 0.009 * this.weight;
    this.pose.hips.y = Math.sin(t * 0.7) * 0.006 * this.weight;
    this.pose.head.x = Math.sin(t * 0.73) * 0.018 * this.weight;
    this.pose.head.z = Math.sin(t * 0.51) * 0.014 * this.weight;
    this.pose.leftUpperArm.z = 0.025 * this.weight; this.pose.rightUpperArm.z = -0.025 * this.weight;
    this.pose.leftHand.x = Math.sin(t * 0.9) * 0.025 * this.weight;
    this.pose.rightHand.x = Math.sin(t * 0.83 + 1) * 0.025 * this.weight;
    return this.pose;
  }
}
