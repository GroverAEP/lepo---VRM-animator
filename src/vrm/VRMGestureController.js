const GESTURES = {
  wave: { rightUpperArm: { z: -0.9 }, rightLowerArm: { z: -0.8, y: 0.32 } },
  goodbye: { rightUpperArm: { z: -0.85 }, rightLowerArm: { z: -0.75, y: 0.28 } },
  point: { rightUpperArm: { z: -0.55 }, rightLowerArm: { z: -0.1, x: -0.55 } },
  crossedArms: { leftUpperArm: { z: 0.6, x: -0.2 }, rightUpperArm: { z: -0.6, x: -0.2 }, leftLowerArm: { z: -0.7 }, rightLowerArm: { z: 0.7 } },
  scratchHead: { rightUpperArm: { z: -0.85 }, rightLowerArm: { z: -1.1 } },
  shrug: { leftUpperArm: { z: 0.75 }, rightUpperArm: { z: -0.75 }, spine: { z: 0.04 } },
  nod: { head: { x: 0.14 } }, shakeHead: { head: { y: 0.16 } },
  laugh: { spine: { x: -0.12 }, leftUpperArm: { z: 0.22 }, rightUpperArm: { z: -0.22 } },
  surprised: { spine: { x: -0.12 }, leftUpperArm: { z: 0.38 }, rightUpperArm: { z: -0.38 } },
  handsOnHips: { leftUpperArm: { z: 0.75 }, rightUpperArm: { z: -0.75 }, leftLowerArm: { z: -0.75 }, rightLowerArm: { z: 0.75 } },
  explain: { leftUpperArm: { z: 0.48 }, rightUpperArm: { z: -0.48 }, leftLowerArm: { x: -0.3 }, rightLowerArm: { x: -0.3 } },
  waveGoodbye: { rightUpperArm: { z: -0.9 }, rightLowerArm: { z: -0.8, y: 0.32 } },
};

/** Gesture clips blend in and out, and can be interrupted with another gesture. */
export class VRMGestureController {
  constructor() {
    this.active = null; this.elapsed = 0; this.duration = 2; this.fade = 0.22;
    this.output = Object.create(null);
    for (const pose of Object.values(GESTURES)) for (const bone of Object.keys(pose)) this.output[bone] ??= { x: 0, y: 0, z: 0 };
    this.bones = Object.keys(this.output);
    this.trackMap = new Map(Object.entries(GESTURES).map(([name, pose]) => [name, Object.entries(pose).flatMap(([bone, axes]) => Object.entries(axes).map(([axis, value]) => ({ bone, axis, value })))]));
    this.activeTracks = null;
  }

  play(name, duration = 2) {
    const key = name.replace(/[- ]/g, '').replace(/^./, (letter) => letter.toLowerCase());
    const aliases = { farewell: 'goodbye', waveBye: 'waveGoodbye', scratchNape: 'scratchHead', salute: 'wave' };
    this.active = GESTURES[aliases[key] ?? key] ? (aliases[key] ?? key) : null;
    this.activeTracks = this.active ? this.trackMap.get(this.active) : null;
    this.elapsed = 0;
    this.duration = Math.max(0.4, duration);
    return Boolean(this.active);
  }

  update(dt) {
    for (const name of this.bones) { this.output[name].x = 0; this.output[name].y = 0; this.output[name].z = 0; }
    if (!this.active) return this.output;
    this.elapsed += dt;
    const envelope = Math.min(1, this.elapsed / this.fade, Math.max(0, (this.duration - this.elapsed) / this.fade));
    for (const track of this.activeTracks) {
      const wave = this.active === 'wave' || this.active === 'goodbye' || this.active === 'waveGoodbye'
        ? (track.axis === 'y' ? Math.sin(this.elapsed * 9) * 0.24 : track.value)
        : this.active === 'nod' ? track.value * Math.sin(this.elapsed * 7)
          : this.active === 'shakeHead' ? track.value * Math.sin(this.elapsed * 6) : track.value;
      this.output[track.bone][track.axis] = wave * envelope;
    }
    if (this.elapsed >= this.duration) this.active = null;
    return this.output;
  }
}
