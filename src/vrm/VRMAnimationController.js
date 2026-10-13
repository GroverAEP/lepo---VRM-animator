import * as THREE from 'three';
import { VRMProceduralIdle } from './VRMProceduralIdle.js';

const ZERO_POSE = Object.freeze({ x: 0, y: 0, z: 0 });
const AXES = ['x', 'y', 'z'];
const BONES = ['hips','spine','chest','upperChest','neck','head','leftShoulder','rightShoulder','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot'];
const STATE_ALIASES = { idle: 'idle', walking: 'walking', walkingSlow: 'walking', running: 'running', turning: 'turning', talking: 'talking', listening: 'listening', reacting: 'reacting', interacting: 'interacting', sitting: 'sitting', customAnimation: 'customAnimation', dance: 'customAnimation' };

/** Per-model humanoid pose mixer. All targets are offsets from that model's normalized rest pose. */
export class VRMAnimationController {
  constructor(vrm, { animations = [] } = {}) {
    this.vrm = vrm;
    this.humanoid = vrm.humanoid;
    this.bones = new Map();
    this.rest = new Map();
    this.idle = new VRMProceduralIdle();
    this.state = 'idle'; this.previousState = 'idle'; this.blend = 1;
    this.time = 0; this.phase = 0; this.speed = 0; this.turn = 0; this.target = null; this.idlePose = {};
    this.gesturePose = {};
    this.poseNames = [...BONES];
    this.poseCache = new Map(['idle','walking','running','turning','interacting','talking','listening','reacting','sitting','customAnimation'].map((state) => [state, Object.fromEntries(BONES.map((name) => [name, { x: 0, y: 0, z: 0 }]))]));
    this.hipBaseY = null;
    this.relaxedArms = { left: 0, right: 0 };
    this.armRest = new Map();
    this.emotionPose = {};
    this.cameraHeadPose = { x: 0, y: 0, z: 0 };
    this.editorPose = {};
    this.editorEnabled = false;
    this.editorDirectBone = null;
    this.offsetEuler = new THREE.Euler(0, 0, 0, 'XYZ');
    this.offsetQuaternion = new THREE.Quaternion();
    this.targetQuaternion = new THREE.Quaternion();
    this.baseQuaternion = new THREE.Quaternion();
    this.worldQuaternion = new THREE.Quaternion();
    this.parentQuaternion = new THREE.Quaternion();
    this.armOrigin = new THREE.Vector3();
    this.armEnd = new THREE.Vector3();
    this.armDirection = new THREE.Vector3();
    this.armTargetDirection = new THREE.Vector3();
    this.armDelta = new THREE.Quaternion();
    this.idleMixer = null;
    this.idleAnimatedBones = new Set();
    vrm.scene.updateMatrixWorld(true);
    for (const name of BONES) {
      const bone = this.humanoid?.getNormalizedBoneNode(name);
      if (!bone) continue;
      this.bones.set(name, bone);
      this.rest.set(name, { rotation: bone.rotation.clone(), position: bone.position.clone() });
    }
    this.fingerBones = [];
    for (const side of ['left', 'right']) for (const digit of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) for (const joint of ['Proximal', 'Intermediate', 'Distal']) {
      const name = `${side}${digit}${joint}`, bone = this.humanoid?.getNormalizedBoneNode(name);
      if (bone) { this.bones.set(name, bone); this.rest.set(name, { rotation: bone.rotation.clone(), position: bone.position.clone() }); this.fingerBones.push({ name, bone }); for (const pose of this.poseCache.values()) pose[name] = { x: 0, y: 0, z: 0 }; }
    }
    this.poseNames.push(...this.fingerBones.map(({ name }) => name));
    this.hipBaseY = this.rest.get('hips')?.position.y ?? null;
    this.armRest.set('leftUpperArm', this.createRelaxedArmBase('left'));
    this.armRest.set('rightUpperArm', this.createRelaxedArmBase('right'));
    const idleClip = animations.find((clip) => /idle|rest/i.test(clip.name) && clip.tracks.some((track) => {
      const bracketName = track.name.match(/\[([^\]]+)\]/)?.[1];
      const nodeName = bracketName ?? track.name.split('.')[0];
      const node = vrm.scene.getObjectByName(nodeName);
      if (!node || ![...this.bones.values()].includes(node)) return false;
      for (const [name, bone] of this.bones) if (bone === node) this.idleAnimatedBones.add(name);
      return true;
    }));
    if (idleClip) {
      this.idleMixer = new THREE.AnimationMixer(vrm.scene);
      this.idleMixer.clipAction(idleClip).play();
    }
  }

  createRelaxedArmBase(side) {
    const upper = this.bones.get(`${side}UpperArm`), lower = this.bones.get(`${side}LowerArm`);
    const rest = this.rest.get(`${side}UpperArm`)?.rotation;
    if (!upper || !lower || !rest) return rest?.clone() ?? new THREE.Quaternion();
    upper.updateWorldMatrix(true, false); lower.updateWorldMatrix(true, false);
    upper.getWorldPosition(this.armOrigin);
    lower.getWorldPosition(this.armEnd);
    this.armDirection.subVectors(this.armEnd, this.armOrigin).normalize();
    if (this.armDirection.y < -0.58) return rest.clone();
    this.armTargetDirection.set(this.armDirection.x, 0, this.armDirection.z);
    if (this.armTargetDirection.lengthSq() < 0.01) this.armTargetDirection.set(side === 'left' ? 1 : -1, 0, 0);
    this.armTargetDirection.normalize().multiplyScalar(0.4);
    this.armTargetDirection.y = -0.9165;
    this.armTargetDirection.normalize();
    upper.getWorldQuaternion(this.worldQuaternion);
    this.armDelta.setFromUnitVectors(this.armDirection, this.armTargetDirection);
    this.worldQuaternion.premultiply(this.armDelta);
    upper.parent?.getWorldQuaternion(this.parentQuaternion);
    this.worldQuaternion.premultiply(this.parentQuaternion.invert());
    return this.worldQuaternion.clone();
  }

  setState(state) {
    const next = STATE_ALIASES[state] ?? 'idle';
    if (next === this.state) return;
    this.previousState = this.state;
    this.state = next;
    this.blend = 0;
  }

  setMotion({ speed = this.speed, turn = this.turn, target = this.target } = {}) {
    this.speed = Math.max(0, speed); this.turn = THREE.MathUtils.clamp(turn, -1, 1); this.target = target;
  }

  setGesturePose(pose) { this.gesturePose = pose ?? {}; }
  setEmotionPose(pose) { this.emotionPose = pose ?? {}; }
  setEditorPose(pose, enabled = true) {
    const wasEnabled = this.editorEnabled;
    this.editorPose = pose ?? {}; this.editorEnabled = Boolean(enabled);
    if (!this.editorEnabled) this.editorDirectBone = null;
    if (wasEnabled && !this.editorEnabled) for (const [name, bone] of this.bones) {
      const rest = this.rest.get(name); if (rest) bone.position.copy(rest.position);
    }
  }
  setEditorDirectBone(name = null) { this.editorDirectBone = name; }
  setHeadTracking(yaw = 0, pitch = 0, roll = 0) { this.cameraHeadPose.x = pitch; this.cameraHeadPose.y = yaw; this.cameraHeadPose.z = roll; }

  setOffset(pose, bone, axis, value) { if (pose[bone]) pose[bone][axis] = value; }

  poseFor(state) {
    if (state === 'idle') return this.idlePose;
    const pose = this.poseCache.get(state);
    for (const name of this.poseNames) { const axes = pose[name]; axes.x = 0; axes.y = 0; axes.z = 0; }
    const t = this.time, phase = this.phase, amount = THREE.MathUtils.clamp(this.speed / 1.4, 0, 1.5);
    if (state === 'walking' || state === 'running') {
      const run = state === 'running', stride = (run ? 0.42 : 0.23) * Math.max(0.35, amount);
      this.setOffset(pose,'spine','x',run?-0.105:-0.035); this.setOffset(pose,'spine','z',Math.sin(phase)*0.025); this.setOffset(pose,'hips','y',run?Math.abs(Math.sin(phase*2))*0.022:0);
      this.setOffset(pose,'leftUpperLeg','x',-Math.sin(phase)*stride); this.setOffset(pose,'rightUpperLeg','x',Math.sin(phase)*stride);
      this.setOffset(pose,'leftLowerLeg','x',Math.max(0,Math.sin(phase+1))*stride*0.78); this.setOffset(pose,'rightLowerLeg','x',Math.max(0,-Math.sin(phase+1))*stride*0.78);
      this.setOffset(pose,'leftUpperArm','x',Math.sin(phase)*stride*0.8); this.setOffset(pose,'rightUpperArm','x',-Math.sin(phase)*stride*0.8);
      this.setOffset(pose,'leftLowerArm','x',-0.08); this.setOffset(pose,'rightLowerArm','x',-0.08); this.setOffset(pose,'head','x',Math.sin(phase*2)*0.018);
    } else if (state === 'turning') {
      this.setOffset(pose,'spine','y',this.turn*0.18); this.setOffset(pose,'chest','y',this.turn*0.13); this.setOffset(pose,'head','y',this.turn*0.08);
    } else if (state === 'interacting') {
      this.setOffset(pose,'spine','x',0.11); this.setOffset(pose,'hips','x',0.035); this.setOffset(pose,'leftUpperArm','z',0.12); this.setOffset(pose,'rightUpperArm','z',-0.55); this.setOffset(pose,'rightUpperArm','x',-0.2); this.setOffset(pose,'rightLowerArm','z',-0.55); this.setOffset(pose,'head','x',0.1);
    } else if (state === 'talking') {
      this.setOffset(pose,'spine','x',Math.sin(t*2)*0.018); this.setOffset(pose,'leftUpperArm','z',0.08); this.setOffset(pose,'rightUpperArm','z',-0.08);
    } else if (state === 'listening') {
      this.setOffset(pose,'head','z',0.07); this.setOffset(pose,'head','x',Math.sin(t*0.65)*0.025); this.setOffset(pose,'spine','x',0.015);
    } else if (state === 'reacting') {
      this.setOffset(pose,'spine','x',-0.1); this.setOffset(pose,'head','x',-0.06); this.setOffset(pose,'leftUpperArm','z',0.18); this.setOffset(pose,'rightUpperArm','z',-0.18);
    } else if (state === 'sitting') {
      this.setOffset(pose,'leftUpperLeg','x',-0.85); this.setOffset(pose,'rightUpperLeg','x',-0.85); this.setOffset(pose,'leftLowerLeg','x',1.05); this.setOffset(pose,'rightLowerLeg','x',1.05); this.setOffset(pose,'spine','x',-0.035);
    } else if (state === 'customAnimation') {
      this.setOffset(pose,'spine','z',Math.sin(t*3)*0.12); this.setOffset(pose,'hips','y',Math.abs(Math.sin(t*4))*0.035);
      this.setOffset(pose,'leftUpperArm','z',0.72); this.setOffset(pose,'leftUpperArm','x',Math.sin(t*4)*0.38); this.setOffset(pose,'rightUpperArm','z',-0.72); this.setOffset(pose,'rightUpperArm','x',-Math.sin(t*4)*0.38);
      this.setOffset(pose,'leftUpperLeg','x',Math.sin(t*4)*0.22); this.setOffset(pose,'rightUpperLeg','x',-Math.sin(t*4)*0.22);
    }
    return pose;
  }

  update(dt) {
    this.time += dt;
    this.idleMixer?.update(dt);
    this.idlePose = this.idle.update(dt, this.state === 'idle' || this.previousState === 'idle' ? 1 : 0);
    const moving = this.state === 'walking' || this.state === 'running';
    this.phase += dt * (moving ? 4.4 + this.speed * (this.state === 'running' ? 4.6 : 1.6) : this.state === 'customAnimation' ? 5 : 0);
    this.blend = Math.min(1, this.blend + dt / 0.34);
    const previous = this.poseFor(this.previousState), current = this.poseFor(this.state);
    for (const name of this.poseNames) {
      const bone = this.bones.get(name), rest = this.rest.get(name);
      if (!bone || !rest) continue;
      // In direct editing mode, let TransformControls own the selected bone until the timeline changes.
      if (this.editorEnabled && name === this.editorDirectBone) continue;
      const clipBase = this.state === 'idle' && this.idleAnimatedBones.has(name) ? bone.rotation : rest.rotation;
      const oldPose = previous[name] ?? ZERO_POSE, newPose = current[name] ?? ZERO_POSE, gesture = this.gesturePose[name] ?? ZERO_POSE, emotion = this.emotionPose[name] ?? ZERO_POSE;
      this.baseQuaternion.copy(this.armRest.get(name) ?? this.baseQuaternion.setFromEuler(clipBase));
      for (const axis of AXES) {
        const camera = name === 'head' ? this.cameraHeadPose[axis] : 0;
        const offset = this.editorEnabled
          ? (this.editorPose[name]?.[axis] ?? 0)
          : THREE.MathUtils.lerp(oldPose[axis] ?? 0, newPose[axis] ?? 0, this.blend) + (gesture[axis] ?? 0) + (emotion[axis] ?? 0) + camera;
        this.offsetEuler[axis] = offset;
      }
      this.offsetQuaternion.setFromEuler(this.offsetEuler);
      this.targetQuaternion.copy(this.baseQuaternion).multiply(this.offsetQuaternion);
      bone.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-8 * dt));
      if (name === 'hips' && this.hipBaseY !== null) {
        const sitOffset = this.state === 'sitting' ? -0.24 : 0;
        if (this.editorEnabled) {
          const offset = this.editorPose[name]?.position ?? ZERO_POSE;
          bone.position.set(rest.position.x + (offset.x ?? 0), rest.position.y + (offset.y ?? 0), rest.position.z + (offset.z ?? 0));
        } else bone.position.y = THREE.MathUtils.damp(bone.position.y, this.hipBaseY + sitOffset, 6, dt);
      } else if (this.editorEnabled && this.editorPose[name]?.position) {
        const offset = this.editorPose[name].position;
        bone.position.set(rest.position.x + (offset.x ?? 0), rest.position.y + (offset.y ?? 0), rest.position.z + (offset.z ?? 0));
      } else if (!this.editorEnabled) {
        bone.position.copy(rest.position);
      }
    }
    for (const { name, bone } of this.fingerBones) {
      const rest = this.rest.get(name), base = rest.rotation;
      const curled = this.editorEnabled ? 0 : this.state === 'interacting' ? (name.includes('Proximal') ? 0.42 : 0.26) : 0;
      const emotion = this.emotionPose[name] ?? ZERO_POSE;
      const editor = this.editorEnabled ? this.editorPose[name] ?? ZERO_POSE : ZERO_POSE;
      this.offsetEuler.set(editor.x + curled + (this.editorEnabled ? 0 : emotion.x), editor.y, editor.z, 'XYZ');
      this.offsetQuaternion.setFromEuler(this.offsetEuler);
      this.targetQuaternion.copy(base).multiply(this.offsetQuaternion);
      bone.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-9 * dt));
    }
  }

  dispose() { if (this.idleMixer) { this.idleMixer.stopAllAction(); this.idleMixer.uncacheRoot(this.vrm.scene); this.idleMixer = null; } }
}
