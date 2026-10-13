import { VRMAnimationController } from './VRMAnimationController.js';
import { VRMFacialController } from './VRMFacialController.js';
import { VRMGazeController } from './VRMGazeController.js';
import { VRMGestureController } from './VRMGestureController.js';
import { VRMLipSyncController } from './VRMLipSyncController.js';
import { VRMSecondaryMotion } from './VRMSecondaryMotion.js';
import { VRMAnatomyController } from './VRMAnatomyController.js';
import { VRMBodyEmotionController } from './VRMBodyEmotionController.js';

/** Per-character coordinator. Every controller owns its own targets and timing. */
export class VRMCharacterRuntime {
  constructor(vrm, { origin = () => vrm.scene.position, targetParent = null, animations = [], onStateChange = () => {} } = {}) {
    this.vrm = vrm;
    this.onStateChange = onStateChange;
    this.state = 'idle';
    this.automaticState = 'idle';
    this.manualState = null;
    this.enabled = { animation: true, gaze: true, facial: true, lipSync: true, gestures: true, secondary: true, anatomy: false };
    this.animation = new VRMAnimationController(vrm, { animations });
    this.facial = new VRMFacialController(vrm);
    this.bodyEmotion = new VRMBodyEmotionController();
    this.gaze = new VRMGazeController(vrm, this.facial, origin, targetParent);
    this.gestures = new VRMGestureController();
    this.lipSync = new VRMLipSyncController(this.facial, (talking) => {
      if (talking) this.applyState('talking');
      else if (this.state === 'talking') this.applyState(this.manualState ?? this.automaticState);
    });
    this.secondary = new VRMSecondaryMotion(vrm);
    this.anatomy = new VRMAnatomyController();
    this.motion = { speed: 0, turn: 0, target: null };
    this.mood = 'neutral'; this.moodIntensity = 1;
    this.cameraEmotion = null;
    this.facial.setMood('neutral'); this.bodyEmotion.setEmotion('neutral');
  }

  applyState(state) {
    this.state = state;
    this.animation.setState(state);
    this.onStateChange(state);
  }

  setState(state) { this.manualState = state; this.applyState(state); }
  setAutomaticState(state) { this.automaticState = state; if (!this.manualState && !this.lipSync.active) this.applyState(state); }
  clearManualState() { this.manualState = null; this.applyState(this.automaticState); }

  setMotion(motion) { Object.assign(this.motion, motion); this.animation.setMotion(this.motion); this.secondary.setSpeed(this.motion.speed); this.anatomy.setSpeed(this.motion.speed); }
  setFocus(target) { this.gaze.setFocus(target); }
  setMood(mood, intensity = 1) {
    if (this.mood === mood && this.moodIntensity === intensity) return;
    this.mood = mood; this.moodIntensity = intensity;
    this.facial.setMood(mood === 'thoughtful' ? 'confused' : mood, intensity);
    this.bodyEmotion.setEmotion(this.cameraEmotion ?? mood, intensity);
  }
  setFaceTracking(weights = {}) { this.facial.setLayer('camera-tracking', weights); }
  setCameraEmotion(emotion) {
    const next = emotion ?? null;
    if (this.cameraEmotion === next) return;
    this.cameraEmotion = next;
    const faceMood = this.cameraEmotion ?? this.mood;
    this.bodyEmotion.setEmotion(faceMood, this.moodIntensity);
    this.facial.setMood(faceMood === 'thoughtful' ? 'confused' : faceMood, this.moodIntensity);
  }
  setHeadTracking(yaw = 0, pitch = 0, roll = 0) { this.animation.setHeadTracking(yaw, pitch, roll); }
  setEmotion(name, intensity = 1) { this.facial.setEmotion(name, intensity); }
  setExpression(name, intensity = 1) { this.facial.setLayer('custom', { [name]: intensity }); }
  wink(side = 'left', duration = 0.3) { this.facial.wink(side, duration); }
  playGesture(name, duration) { return this.gestures.play(name, duration); }
  speak(text, millisecondsPerCharacter) { this.lipSync.speak(text, millisecondsPerCharacter); }
  setAudioAnalyser(analyser) { this.lipSync.setAudioAnalyser(analyser); }
  registerAnatomyNode(node, options) { return this.anatomy.registerNode(node, options); }

  setEnabled(module, enabled) {
    if (!(module in this.enabled)) return false;
    this.enabled[module] = Boolean(enabled);
    if (module === 'gaze') this.gaze.setEnabled(enabled);
    if (module === 'facial' && !enabled) { this.facial.layers.clear(); this.facial.current.clear(); this.vrm.expressionManager?.resetValues(); }
    if (module === 'secondary') this.secondary.setEnabled(enabled);
    if (module === 'anatomy') this.anatomy.setEnabled(enabled);
    return true;
  }

  update(dt) {
    if (this.enabled.lipSync) this.lipSync.update(dt); else this.lipSync.stop();
    if (this.enabled.gestures) this.animation.setGesturePose(this.gestures.update(dt));
    else this.animation.setGesturePose({});
    if (this.enabled.animation) {
      this.animation.setEmotionPose(this.bodyEmotion.update(dt, this.animation.fingerBones));
      this.animation.update(dt);
    }
    if (this.enabled.gaze) this.gaze.update(dt); else { this.gaze.setFocus(null); this.gaze.setEnabled(false); }
    if (this.enabled.facial) this.facial.update(dt);
    if (this.enabled.secondary) this.secondary.update(dt);
    if (this.enabled.anatomy) this.anatomy.update(dt);
    this.vrm.update(dt);
  }

  dispose() {
    this.lipSync.stop(); this.gaze.dispose(); this.secondary.dispose(); this.anatomy.dispose();
    this.facial.layers.clear(); this.animation.dispose(); this.animation.bones.clear(); this.animation.rest.clear();
  }
}
