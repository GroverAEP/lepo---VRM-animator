import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const AXES = ['x', 'y', 'z'];
const LABELS = {
  hips: 'Pelvis', spine: 'Columna', chest: 'Pecho', upperChest: 'Pecho alto', neck: 'Cuello', head: 'Cabeza',
  leftShoulder: 'Hombro izquierdo', rightShoulder: 'Hombro derecho', leftUpperArm: 'Brazo superior izquierdo', rightUpperArm: 'Brazo superior derecho',
  leftLowerArm: 'Antebrazo izquierdo', rightLowerArm: 'Antebrazo derecho', leftHand: 'Mano izquierda', rightHand: 'Mano derecha',
  leftUpperLeg: 'Muslo izquierdo', rightUpperLeg: 'Muslo derecho', leftLowerLeg: 'Pierna izquierda', rightLowerLeg: 'Pierna derecha',
  leftFoot: 'Pie izquierdo', rightFoot: 'Pie derecho', leftToes: 'Dedos pie izquierdo', rightToes: 'Dedos pie derecho',
};

const clonePose = (pose = {}) => Object.fromEntries(Object.entries(pose).map(([bone, axes]) => [bone, { x: Number(axes.x) || 0, y: Number(axes.y) || 0, z: Number(axes.z) || 0, ...(axes.position ? { position: { x: Number(axes.position.x) || 0, y: Number(axes.position.y) || 0, z: Number(axes.position.z) || 0 } } : {}) }]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerpAngle = (a, b, amount) => {
  const delta = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + delta * amount;
};

/** Keyframe editor for normalized VRM humanoid rotation offsets. */
export class VRMAnimationEditor {
  constructor({ getRuntime = () => null, scene, camera, renderer, orbitControls } = {}) {
    this.getRuntime = getRuntime;
    this.scene = scene; this.camera = camera; this.renderer = renderer; this.orbitControls = orbitControls;
    this.directMode = false; this.selectedBone = null; this.handleMeshes = new Map();
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.handleGeometry = new THREE.SphereGeometry(0.025, 10, 8);
    this.handleMaterial = new THREE.MeshBasicMaterial({ color: 0xccf36b, depthTest: false, transparent: true, opacity: 0.9 });
    this.selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    this.gizmo = new TransformControls(camera, renderer.domElement);
    this.gizmo.setSize(0.75); this.gizmo.setSpace('local'); this.gizmo.enabled = false;
    scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (event) => { this.orbitControls.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => this.captureGizmoPose());
    this.runtime = null;
    this.active = false;
    this.playing = false;
    this.timeMs = 0;
    this.lastUiTime = 0;
    this.selectedFrameTime = 0;
    this.clip = this.newClip();
    this.clips = [this.clip];
    this.clipIndex = 0;
    this.pose = {};
    this.boneNames = [];
    this.el = Object.fromEntries([
      'animationEditor', 'animEditorModelState', 'animClipSelect', 'animNewClipBtn', 'animClipName', 'animDuration', 'animFps', 'animPlayBtn', 'animStopBtn',
      'animKeyBtn', 'animDeleteKeyBtn', 'animRunPresetBtn', 'animImportInput', 'animExportBtn', 'animJsonExportBtn', 'animBoneSelect', 'animSeconds', 'animMillis',
      'animFrameReadout', 'animTimeReadout', 'animScrubber', 'animKeyMarkers', 'animInterpolation', 'animEditorStatus', 'animTimeline', 'animDirectModeBtn', 'animGizmoMode',
    ].map((id) => [id, document.getElementById(id)]));
    this.el.animRuler = this.el.animTimeline.querySelector('.anim-ruler');
    this.bind();
    this.renderer.domElement.addEventListener('pointerdown', (event) => this.pickBoneHandle(event), true);
    this.renderClip();
    this.refreshModel();
  }

  newClip() {
    return { name: 'Nueva animación', durationMs: 2000, fps: 30, interpolation: 'smooth', keyframes: [{ timeMs: 0, pose: {} }] };
  }

  createNewClip() {
    this.stop();
    this.clip = this.newClip();
    this.clip.name = `Animación ${this.clips.length + 1}`;
    this.clips.push(this.clip);
    this.clipIndex = this.clips.length - 1;
    this.selectedFrameTime = 0;
    this.timeMs = 0;
    this.pose = {};
    this.renderClip();
    this.applyPose();
    this.setStatus('Clip nuevo. Ajusta una articulación y guarda su primer keyframe.');
  }

  createRunningClip() {
    const durationMs = 1200, stride = 0.58, elbow = 0.32;
    const phases = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2];
    const keyframes = phases.map((phase) => {
      const swing = Math.sin(phase), bounce = (1 - Math.cos(phase * 2)) * 0.018;
      return {
        timeMs: Math.round(durationMs * phase / (Math.PI * 2)),
        pose: {
          hips: { x: 0.015, y: 0, z: Math.cos(phase) * 0.018, position: { x: 0, y: bounce, z: 0 } },
          spine: { x: -0.12, y: 0, z: Math.sin(phase) * 0.025 },
          chest: { x: -0.035, y: 0, z: Math.sin(phase + 0.2) * 0.018 },
          head: { x: 0.025 + Math.sin(phase * 2) * 0.025, y: 0, z: -Math.sin(phase) * 0.015 },
          leftUpperLeg: { x: -swing * stride, y: 0, z: 0 }, rightUpperLeg: { x: swing * stride, y: 0, z: 0 },
          leftLowerLeg: { x: Math.max(0, Math.sin(phase + 0.9)) * 0.82, y: 0, z: 0 },
          rightLowerLeg: { x: Math.max(0, Math.sin(phase + Math.PI + 0.9)) * 0.82, y: 0, z: 0 },
          leftUpperArm: { x: swing * 0.42, y: 0, z: 0.08 }, rightUpperArm: { x: -swing * 0.42, y: 0, z: -0.08 },
          leftLowerArm: { x: -elbow - Math.max(0, swing) * 0.12, y: 0, z: 0 },
          rightLowerArm: { x: -elbow - Math.max(0, -swing) * 0.12, y: 0, z: 0 },
          leftShoulder: { x: 0, y: 0, z: 0.035 }, rightShoulder: { x: 0, y: 0, z: -0.035 },
        },
      };
    });
    this.stop();
    this.clip = { name: 'Corrida · ciclo', durationMs, fps: 30, interpolation: 'smooth', loop: true, keyframes };
    this.clips.push(this.clip); this.clipIndex = this.clips.length - 1;
    this.timeMs = 0; this.selectedFrameTime = 0; this.renderClip(); this.seek(0);
    this.setStatus('Ciclo de corrida creado · edítalo, reprodúcelo en bucle o expórtalo como VRMA.');
  }

  selectClip(index) {
    if (!this.clips[index] || index === this.clipIndex) return;
    this.stop();
    this.clipIndex = index;
    this.clip = this.clips[index];
    this.timeMs = 0;
    this.selectedFrameTime = 0;
    this.renderClip();
    this.seek(0);
    this.setStatus(`Editando «${this.clip.name}».`);
  }

  bind() {
    const e = this.el;
    e.animClipSelect.addEventListener('change', () => this.selectClip(Number(e.animClipSelect.value)));
    e.animNewClipBtn.addEventListener('click', () => this.createNewClip());
    e.animClipName.addEventListener('input', () => {
      this.clip.name = e.animClipName.value.slice(0, 60) || 'Animación';
      const option = e.animClipSelect.options[this.clipIndex];
      if (option) option.textContent = this.clip.name;
    });
    e.animDuration.addEventListener('change', () => this.setDuration(e.animDuration.value));
    e.animFps.addEventListener('change', () => { this.clip.fps = clamp(Math.round(Number(e.animFps.value) || 30), 1, 120); e.animFps.value = this.clip.fps; this.updateTimeUI(); });
    e.animInterpolation.addEventListener('change', () => { this.clip.interpolation = e.animInterpolation.value; this.seek(this.timeMs); });
    e.animScrubber.addEventListener('input', () => this.seek(Number(e.animScrubber.value)));
    e.animSeconds.addEventListener('input', () => this.seekFromInputs());
    e.animMillis.addEventListener('input', () => this.seekFromInputs());
    e.animBoneSelect.addEventListener('change', () => this.updateAxisUI());
    for (const row of e.animationEditor.querySelectorAll('.anim-axis-row')) {
      const axis = row.dataset.axis;
      row.querySelector('.anim-axis-range').addEventListener('input', (event) => this.setAxis(axis, event.target.value));
      row.querySelector('.anim-axis-value').addEventListener('input', (event) => this.setAxis(axis, event.target.value));
    }
    e.animKeyBtn.addEventListener('click', () => this.saveKeyframe());
    e.animDeleteKeyBtn.addEventListener('click', () => this.deleteKeyframe());
    e.animRunPresetBtn.addEventListener('click', () => this.createRunningClip());
    e.animPlayBtn.addEventListener('click', () => this.play());
    e.animStopBtn.addEventListener('click', () => this.stop());
    e.animExportBtn.addEventListener('click', () => void this.exportVrma());
    this.el.animJsonExportBtn?.addEventListener('click', () => this.exportJsonClip());
    e.animImportInput.addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) void this.importClip(file); event.target.value = ''; });
    e.animDirectModeBtn.addEventListener('click', () => this.setDirectMode(!this.directMode));
    e.animGizmoMode.addEventListener('change', () => this.gizmo.setMode(e.animGizmoMode.value));
  }

  setRuntime(runtime) {
    this.runtime = runtime;
    for (const mesh of this.handleMeshes.values()) this.scene.remove(mesh);
    this.handleMeshes.clear(); this.gizmo.detach(); this.selectedBone = null;
    this.refreshModel();
    for (const [name] of runtime?.animation?.bones ?? []) {
      const marker = new THREE.Mesh(this.handleGeometry, this.handleMaterial);
      marker.name = `editor-joint-${name}`; marker.userData.boneName = name; marker.renderOrder = 999;
      marker.visible = this.active && this.directMode;
      this.scene.add(marker); this.handleMeshes.set(name, marker);
    }
    this.applyPose();
  }

  refreshModel() {
    const select = this.el.animBoneSelect;
    const animation = this.runtime?.animation;
    this.boneNames = animation ? [...animation.bones.keys()] : [];
    select.replaceChildren();
    for (const name of this.boneNames) select.add(new Option(LABELS[name] ?? name.replace(/([A-Z])/g, ' $1'), name));
    select.disabled = !this.boneNames.length;
    if (!this.boneNames.length) select.add(new Option('Primero carga un modelo VRM', ''));
    this.el.animEditorModelState.textContent = this.boneNames.length ? `${this.boneNames.length} articulaciones disponibles` : 'Carga un VRM';
    this.el.animEditorModelState.classList.toggle('ready', this.boneNames.length > 0);
    this.updateAxisUI();
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) this.gizmo.detach();
    this.gizmo.enabled = this.active && this.directMode;
    for (const marker of this.handleMeshes.values()) marker.visible = this.gizmo.enabled;
    if (this.runtime?.animation) this.runtime.animation.setEditorPose(this.pose, this.active);
  }

  setDirectMode(enabled) {
    this.directMode = Boolean(enabled);
    this.el.animationEditor.classList.toggle('direct-manip', this.directMode);
    this.el.animDirectModeBtn.setAttribute('aria-pressed', String(this.directMode));
    this.el.animDirectModeBtn.classList.toggle('active', this.directMode);
    this.gizmo.enabled = this.active && this.directMode;
    if (!this.gizmo.enabled) { this.gizmo.detach(); this.selectedBone = null; this.runtime?.animation?.setEditorDirectBone(null); }
    for (const marker of this.handleMeshes.values()) marker.visible = this.gizmo.enabled;
    this.setStatus(this.directMode ? 'Modo directo: selecciona una articulación en el personaje y mueve el gizmo.' : 'Modo de edición por articulación.');
  }

  pickBoneHandle(event) {
    if (!this.active || !this.directMode || !this.handleMeshes.size || event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.handleMeshes.values()].filter((mesh) => mesh.visible), false)[0];
    if (!hit) return;
    event.stopImmediatePropagation(); event.preventDefault();
    const name = hit.object.userData.boneName, bone = this.runtime?.animation?.bones.get(name);
    if (!bone) return;
    this.selectedBone = name;
    this.runtime.animation.setEditorDirectBone(name);
    for (const [joint, mesh] of this.handleMeshes) mesh.material = joint === name ? this.selectedMaterial : this.handleMaterial;
    this.gizmo.attach(bone); this.gizmo.setMode(this.el.animGizmoMode.value);
    this.el.animBoneSelect.value = name; this.updateAxisUI();
    this.setStatus(`${LABELS[name] ?? name}: manipulador directo activo. Pulsa + KEYFRAME para guardar la pose.`);
  }

  captureGizmoPose() {
    const name = this.selectedBone, animation = this.runtime?.animation, bone = animation?.bones.get(name), rest = animation?.rest.get(name);
    if (!name || !bone || !rest) return;
    const base = animation.armRest.get(name) ?? rest.rotation;
    const offset = base.clone().invert().multiply(bone.quaternion);
    const euler = new THREE.Euler().setFromQuaternion(offset, 'XYZ');
    const position = { x: bone.position.x - rest.position.x, y: bone.position.y - rest.position.y, z: bone.position.z - rest.position.z };
    this.pose[name] = { x: euler.x, y: euler.y, z: euler.z, position };
    const exact = this.clip.keyframes.find((frame) => Math.abs(frame.timeMs - this.timeMs) < 1);
    if (exact) exact.pose = clonePose(this.pose);
    this.updateAxisUI(); this.applyPose();
    this.el.animEditorStatus.textContent = exact ? `Keyframe actualizado · ${this.formatTime(exact.timeMs)} s.` : 'Pose de vista previa; pulsa + KEYFRAME para guardarla.';
  }

  updateHandles() {
    if (!this.gizmo.enabled || !this.runtime) return;
    for (const [name, mesh] of this.handleMeshes) {
      const bone = this.runtime.animation.bones.get(name);
      if (bone) bone.getWorldPosition(mesh.position);
    }
  }

  update(dt) {
    if (!this.active || !this.playing) return;
    this.timeMs += Math.max(0, dt) * 1000;
    if (this.timeMs >= this.clip.durationMs) {
      if (this.loop) this.timeMs %= this.clip.durationMs;
      else { this.timeMs = this.clip.durationMs; this.playing = false; this.el.animPlayBtn.textContent = '▶ REPRODUCIR'; }
    }
    this.evaluatePose();
    this.applyPose();
    if (performance.now() - this.lastUiTime > 35 || !this.playing) {
      this.lastUiTime = performance.now();
      this.updateTimeUI();
      this.markSelectedFrame();
    }
  }

  setDuration(value) {
    this.clip.durationMs = clamp(Math.round(Number(value) || 2000), 100, 30000);
    const frames = this.clip.keyframes.map((frame) => ({ ...frame, timeMs: Math.min(this.clip.durationMs, frame.timeMs) }))
      .sort((a, b) => a.timeMs - b.timeMs);
    this.clip.keyframes = frames.reduce((unique, frame) => {
      if (unique.length && unique[unique.length - 1].timeMs === frame.timeMs) unique[unique.length - 1] = frame;
      else unique.push(frame);
      return unique;
    }, []);
    this.el.animDuration.value = this.clip.durationMs;
    this.el.animScrubber.max = this.clip.durationMs;
    this.timeMs = Math.min(this.timeMs, this.clip.durationMs);
    this.renderClip();
    this.seek(this.timeMs);
  }

  seekFromInputs() {
    const seconds = clamp(Math.floor(Number(this.el.animSeconds.value) || 0), 0, 30);
    const millis = clamp(Math.floor(Number(this.el.animMillis.value) || 0), 0, 999);
    this.seek(Math.min(this.clip.durationMs, seconds * 1000 + millis));
  }

  seek(timeMs) {
    this.timeMs = clamp(Math.round(Number(timeMs) || 0), 0, this.clip.durationMs);
    this.runtime?.animation?.setEditorDirectBone(null);
    if (this.gizmo.object) this.gizmo.detach();
    this.selectedBone = null;
    this.evaluatePose();
    this.applyPose();
    this.updateTimeUI();
    this.markSelectedFrame();
    this.updateAxisUI();
  }

  evaluatePose() {
    const frames = [...this.clip.keyframes].sort((a, b) => a.timeMs - b.timeMs);
    if (!frames.length) { this.pose = {}; return; }
    let from = frames[0], to = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (this.timeMs >= frames[i].timeMs && this.timeMs <= frames[i + 1].timeMs) { from = frames[i]; to = frames[i + 1]; break; }
      if (this.timeMs < frames[0].timeMs) { from = to = frames[0]; break; }
      if (this.timeMs > frames[frames.length - 1].timeMs) from = to = frames[frames.length - 1];
    }
    const distance = to.timeMs - from.timeMs;
    let amount = distance ? clamp((this.timeMs - from.timeMs) / distance, 0, 1) : 0;
    if (this.clip.interpolation === 'step') amount = this.timeMs >= to.timeMs ? 1 : 0;
    else if (this.clip.interpolation === 'smooth') amount = amount * amount * (3 - 2 * amount);
    const names = new Set([...Object.keys(from.pose), ...Object.keys(to.pose)]);
    this.pose = {};
    for (const name of names) {
      const a = from.pose[name] ?? { x: 0, y: 0, z: 0 }, b = to.pose[name] ?? { x: 0, y: 0, z: 0 };
      this.pose[name] = Object.fromEntries(AXES.map((axis) => [axis, lerpAngle(a[axis] ?? 0, b[axis] ?? 0, amount)]));
      if (a.position || b.position) this.pose[name].position = Object.fromEntries(AXES.map((axis) => [axis, THREE.MathUtils.lerp(a.position?.[axis] ?? 0, b.position?.[axis] ?? 0, amount)]));
    }
  }

  applyPose() {
    this.runtime ??= this.getRuntime();
    this.runtime?.animation?.setEditorPose(this.pose, this.active);
  }

  setAxis(axis, rawDegrees) {
    if (!this.runtime || !this.boneNames.length) return;
    const degrees = clamp(Number(rawDegrees) || 0, -180, 180);
    const bone = this.el.animBoneSelect.value;
    this.runtime.animation.setEditorDirectBone(null);
    if (this.gizmo.object) this.gizmo.detach();
    this.selectedBone = null;
    this.pose[bone] ??= { x: 0, y: 0, z: 0 };
    this.pose[bone][axis] = degrees * Math.PI / 180;
    const exact = this.clip.keyframes.find((frame) => Math.abs(frame.timeMs - this.timeMs) < 1);
    if (exact) exact.pose = clonePose(this.pose);
    this.applyPose();
    this.updateAxisUI();
    this.renderMarkers();
    this.el.animEditorStatus.textContent = exact ? `Editando keyframe en ${this.formatTime(exact.timeMs)}.` : 'Pose de vista previa; pulsa + KEYFRAME para guardarla en la línea de tiempo.';
  }

  saveKeyframe() {
    if (!this.runtime) { this.setStatus('Carga un modelo VRM antes de editar articulaciones.'); return; }
    const timeMs = this.timeMs;
    const existing = this.clip.keyframes.find((frame) => Math.abs(frame.timeMs - timeMs) < 1);
    if (existing) existing.pose = clonePose(this.pose);
    else this.clip.keyframes.push({ timeMs, pose: clonePose(this.pose) });
    this.clip.keyframes.sort((a, b) => a.timeMs - b.timeMs);
    this.selectedFrameTime = timeMs;
    this.renderMarkers();
    this.setStatus(`Keyframe guardado en ${this.formatTime(timeMs)}.`);
  }

  deleteKeyframe() {
    const index = this.clip.keyframes.findIndex((frame) => Math.abs(frame.timeMs - this.selectedFrameTime) < 1);
    if (index < 0) { this.setStatus('Selecciona un keyframe de la línea de tiempo para borrarlo.'); return; }
    this.clip.keyframes.splice(index, 1);
    if (!this.clip.keyframes.length) this.clip.keyframes.push({ timeMs: 0, pose: {} });
    this.selectedFrameTime = -1;
    this.seek(this.timeMs);
    this.renderMarkers();
    this.setStatus('Keyframe borrado.');
  }

  play() {
    if (!this.runtime) { this.setStatus('Carga un modelo VRM para previsualizar la animación.'); return; }
    if (this.timeMs >= this.clip.durationMs) this.seek(0);
    this.loop = Boolean(this.clip.loop);
    this.playing = true;
    this.el.animPlayBtn.textContent = '▶ REPRODUCIENDO';
    this.setStatus(`Reproduciendo · ${this.clip.name}`);
  }

  stop() {
    this.playing = false;
    this.el.animPlayBtn.textContent = '▶ REPRODUCIR';
    this.seek(this.timeMs);
  }

  updateTimeUI() {
    const ms = Math.round(this.timeMs), seconds = Math.floor(ms / 1000), remainder = ms % 1000;
    this.el.animScrubber.value = ms;
    this.el.animSeconds.value = seconds;
    this.el.animMillis.value = remainder;
    this.el.animTimeReadout.textContent = `${this.formatTime(ms)} s · ${ms} ms`;
    this.el.animFrameReadout.textContent = `FRAME ${Math.round(ms * this.clip.fps / 1000)}`;
  }

  formatTime(ms) { return (ms / 1000).toFixed(3); }

  updateAxisUI() {
    const bone = this.el.animBoneSelect.value;
    const values = this.pose[bone] ?? { x: 0, y: 0, z: 0 };
    for (const row of this.el.animationEditor.querySelectorAll('.anim-axis-row')) {
      const degrees = Math.round((values[row.dataset.axis] ?? 0) * 180 / Math.PI);
      row.querySelector('.anim-axis-range').value = degrees;
      row.querySelector('.anim-axis-value').value = degrees;
    }
  }

  renderClip() {
    this.el.animClipSelect.replaceChildren(...this.clips.map((clip, index) => new Option(clip.name, index)));
    this.el.animClipSelect.value = String(this.clipIndex);
    this.el.animClipName.value = this.clip.name;
    this.el.animDuration.value = this.clip.durationMs;
    this.el.animFps.value = this.clip.fps;
    this.el.animInterpolation.value = this.clip.interpolation;
    this.el.animScrubber.max = this.clip.durationMs;
    [...this.el.animRuler.children].forEach((label, index, labels) => {
      const ms = Math.round(this.clip.durationMs * index / (labels.length - 1));
      label.textContent = `${(ms / 1000).toFixed(ms % 1000 ? 2 : 0)} s`;
    });
    this.renderMarkers();
    this.updateTimeUI();
  }

  renderMarkers() {
    const container = this.el.animKeyMarkers;
    container.replaceChildren();
    for (const frame of this.clip.keyframes) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'anim-key-marker';
      marker.classList.toggle('selected', Math.abs(frame.timeMs - this.selectedFrameTime) < 1);
      marker.style.left = `${(frame.timeMs / this.clip.durationMs) * 100}%`;
      marker.title = `Keyframe · ${this.formatTime(frame.timeMs)} s · ${frame.timeMs} ms`;
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('pointerdown', (event) => this.startMarkerDrag(event, frame));
      container.append(marker);
    }
  }

  startMarkerDrag(event, frame) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const track = this.el.animTimeline.getBoundingClientRect();
    const move = (pointerEvent) => {
      const ratio = clamp((pointerEvent.clientX - track.left) / track.width, 0, 1);
      const stepMs = 1000 / this.clip.fps;
      frame.timeMs = clamp(Math.round((ratio * this.clip.durationMs) / stepMs) * stepMs, 0, this.clip.durationMs);
      frame.timeMs = Math.round(frame.timeMs);
      this.clip.keyframes.sort((a, b) => a.timeMs - b.timeMs);
      this.selectedFrameTime = frame.timeMs; this.timeMs = frame.timeMs;
      this.renderMarkers(); this.evaluatePose(); this.applyPose(); this.updateTimeUI(); this.updateAxisUI();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      this.setStatus(`Keyframe movido a ${this.formatTime(frame.timeMs)} s · ${frame.timeMs} ms.`);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  }

  markSelectedFrame() {
    this.selectedFrameTime = this.clip.keyframes.find((frame) => Math.abs(frame.timeMs - this.timeMs) < 1)?.timeMs ?? -1;
    for (const marker of this.el.animKeyMarkers.children) marker.classList.toggle('selected', marker.title.includes(`· ${this.formatTime(this.selectedFrameTime)} s ·`) && this.selectedFrameTime >= 0);
  }

  setStatus(message) { this.el.animEditorStatus.textContent = message; }

  exportJsonClip() {
    const data = {
      format: 'loop-vrm-animation', version: 1, units: 'radians',
      boneSpace: 'normalized-vrm-humanoid-rest-offset',
      name: this.clip.name, durationMs: this.clip.durationMs, fps: this.clip.fps,
      interpolation: this.clip.interpolation, loop: Boolean(this.clip.loop),
      keyframes: [...this.clip.keyframes].sort((a, b) => a.timeMs - b.timeMs).map((frame) => ({ timeMs: frame.timeMs, pose: clonePose(frame.pose) })),
    };
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `${(this.clip.name || 'vrm-animation').replace(/[^\p{L}\p{N}_-]+/gu, '_')}.vrmanim.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    this.setStatus('Animación VRM exportada como JSON humanoide reutilizable.');
  }

  sampleClipPose(timeMs) {
    const frames = [...this.clip.keyframes].sort((a, b) => a.timeMs - b.timeMs);
    if (!frames.length) return {};
    let from = frames[0], to = frames.at(-1);
    for (let i = 0; i < frames.length - 1; i++) {
      if (timeMs >= frames[i].timeMs && timeMs <= frames[i + 1].timeMs) { from = frames[i]; to = frames[i + 1]; break; }
      if (timeMs < frames[0].timeMs) { from = to = frames[0]; break; }
      if (timeMs > frames.at(-1).timeMs) from = to = frames.at(-1);
    }
    const distance = to.timeMs - from.timeMs;
    let amount = distance ? clamp((timeMs - from.timeMs) / distance, 0, 1) : 0;
    if (this.clip.interpolation === 'step') amount = timeMs >= to.timeMs ? 1 : 0;
    else if (this.clip.interpolation === 'smooth') amount = amount * amount * (3 - 2 * amount);
    const pose = {};
    for (const name of new Set([...Object.keys(from.pose), ...Object.keys(to.pose)])) {
      const a = from.pose[name] ?? {}, b = to.pose[name] ?? {};
      pose[name] = Object.fromEntries(AXES.map((axis) => [axis, lerpAngle(a[axis] ?? 0, b[axis] ?? 0, amount)]));
      if (a.position || b.position) pose[name].position = Object.fromEntries(AXES.map((axis) => [axis, THREE.MathUtils.lerp(a.position?.[axis] ?? 0, b.position?.[axis] ?? 0, amount)]));
    }
    return pose;
  }

  async exportVrma() {
    const animation = this.runtime?.animation;
    if (!animation?.bones?.size) { this.setStatus('Carga un modelo VRM antes de exportar la animación.'); return; }
    const humanoidNames = new Set(['hips','spine','chest','upperChest','neck','head','leftShoulder','rightShoulder','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftToes','rightToes']);
    const bones = [...animation.bones].filter(([name]) => humanoidNames.has(name));
    if (!bones.some(([name]) => name === 'hips')) { this.setStatus('Este modelo no contiene la articulación de pelvis necesaria para VRMA.'); return; }
    const scene = new THREE.Scene(), nodes = new Map();
    for (const [name] of bones) { const node = new THREE.Object3D(); node.name = name; nodes.set(name, node); }
    const boneNameByObject = new Map(bones.map(([name, bone]) => [bone, name]));
    for (const [name, bone] of bones) {
      let parent = bone.parent;
      while (parent && !boneNameByObject.has(parent)) parent = parent.parent;
      const parentNode = parent ? nodes.get(boneNameByObject.get(parent)) : null;
      (parentNode ?? scene).add(nodes.get(name));
    }
    const frameStep = 1000 / clamp(Math.round(Number(this.clip.fps) || 30), 1, 120);
    const sampleTimes = [];
    for (let time = 0; time < this.clip.durationMs; time += frameStep) sampleTimes.push(time);
    if (!sampleTimes.length || sampleTimes.at(-1) < this.clip.durationMs) sampleTimes.push(this.clip.durationMs);
    const times = Float32Array.from(sampleTimes, (time) => time / 1000), tracks = [];
    const sampledPoses = sampleTimes.map((timeMs) => this.sampleClipPose(timeMs));
    for (const [name] of bones) {
      const values = new Float32Array(sampleTimes.length * 4);
      sampleTimes.forEach((timeMs, index) => {
        const pose = sampledPoses[index][name] ?? { x: 0, y: 0, z: 0 };
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.x, pose.y, pose.z, 'XYZ'));
        values.set([q.x, q.y, q.z, q.w], index * 4);
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
    }
    const hipsPositioned = sampledPoses.some((pose) => {
      const p = pose.hips?.position;
      return p && (Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) > 1e-6);
    });
    if (hipsPositioned) {
      const values = new Float32Array(sampleTimes.length * 3);
      sampleTimes.forEach((timeMs, index) => {
        const p = sampledPoses[index].hips?.position ?? { x: 0, y: 0, z: 0 };
        values.set([p.x, p.y, p.z], index * 3);
      });
      tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, values));
    }
    const clip = new THREE.AnimationClip(this.clip.name || 'VRM Animation', this.clip.durationMs / 1000, tracks);
    try {
      this.setStatus('Generando archivo VRMA…');
      const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [clip] });
      const finalGlb = this.addVrmaExtension(glb, nodes);
      const href = URL.createObjectURL(new Blob([finalGlb], { type: 'model/gltf-binary' }));
      const link = document.createElement('a'); link.href = href;
      link.download = `${(this.clip.name || 'vrm-animation').replace(/[^\p{L}\p{N}_-]+/gu, '_')}.vrma`;
      link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      this.setStatus(`VRMA exportado · ${bones.length} huesos · ${sampleTimes.length} muestras.`);
    } catch (error) {
      console.error('No se pudo exportar VRMA:', error);
      this.setStatus(`No se pudo generar el VRMA: ${error.message || 'error de exportación GLB'}`);
    }
  }

  addVrmaExtension(glb, nodes) {
    const view = new DataView(glb), decoder = new TextDecoder(), encoder = new TextEncoder();
    if (decoder.decode(new Uint8Array(glb, 0, 4)) !== 'glTF') throw new Error('El exportador no devolvió un GLB válido.');
    let offset = 12, json = null, binaryChunk = null;
    while (offset < glb.byteLength) {
      const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
      const chunk = glb.slice(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(decoder.decode(chunk).trim());
      else if (type === 0x004e4942) binaryChunk = chunk;
      offset += 8 + length;
    }
    if (!json) throw new Error('El GLB generado no contiene su manifiesto JSON.');
    const nodeIndices = new Map((json.nodes ?? []).map((node, index) => [node.name, index]));
    const humanBones = {};
    for (const name of nodes.keys()) {
      const node = nodeIndices.get(name);
      if (node !== undefined) humanBones[name] = { node };
    }
    if (!humanBones.hips) throw new Error('No se pudo asociar la pelvis al esqueleto exportado.');
    json.extensions ??= {};
    json.extensions.VRMC_vrm_animation = { specVersion: '1.0', humanoid: { humanBones } };
    json.extensionsUsed ??= [];
    if (!json.extensionsUsed.includes('VRMC_vrm_animation')) json.extensionsUsed.push('VRMC_vrm_animation');
    if (json.extensionsRequired && !json.extensionsRequired.includes('VRMC_vrm_animation')) json.extensionsRequired.push('VRMC_vrm_animation');
    const jsonBytesRaw = encoder.encode(JSON.stringify(json)), jsonLength = Math.ceil(jsonBytesRaw.length / 4) * 4;
    const paddedJson = new Uint8Array(jsonLength); paddedJson.fill(0x20); paddedJson.set(jsonBytesRaw);
    const binary = binaryChunk ? new Uint8Array(binaryChunk) : new Uint8Array();
    const totalLength = 12 + 8 + paddedJson.byteLength + (binaryChunk ? 8 + binary.byteLength : 0);
    const output = new ArrayBuffer(totalLength), out = new DataView(output), bytes = new Uint8Array(output);
    bytes.set(encoder.encode('glTF'), 0); out.setUint32(4, 2, true); out.setUint32(8, totalLength, true);
    out.setUint32(12, paddedJson.byteLength, true); out.setUint32(16, 0x4e4f534a, true); bytes.set(paddedJson, 20);
    if (binaryChunk) { const binOffset = 20 + paddedJson.byteLength; out.setUint32(binOffset, binary.byteLength, true); out.setUint32(binOffset + 4, 0x004e4942, true); bytes.set(binary, binOffset + 8); }
    return output;
  }

  async importClip(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'loop-vrm-animation' || data.version !== 1 || !Array.isArray(data.keyframes) || !data.keyframes.length || data.keyframes.length > 1000) {
        throw new Error('Formato inválido. Elige un archivo .vrmanim.json exportado por este editor.');
      }
      const durationMs = clamp(Math.round(Number(data.durationMs) || 2000), 100, 30000);
      const keyframes = data.keyframes.map((frame) => {
        const timeMs = clamp(Math.round(Number(frame.timeMs) || 0), 0, durationMs);
        const pose = {};
        if (frame.pose && typeof frame.pose === 'object') for (const [bone, axes] of Object.entries(frame.pose).slice(0, 256)) {
          if (!axes || typeof axes !== 'object') continue;
          pose[bone] = Object.fromEntries(AXES.map((axis) => [axis, clamp(Number(axes[axis]) || 0, -Math.PI, Math.PI)]));
          if (axes.position && typeof axes.position === 'object') pose[bone].position = Object.fromEntries(AXES.map((axis) => [axis, clamp(Number(axes.position[axis]) || 0, -0.5, 0.5)]));
        }
        return { timeMs, pose };
      }).sort((a, b) => a.timeMs - b.timeMs);
      this.clip = {
        name: String(data.name || file.name.replace(/\.vrmanim\.json$|\.json$/i, '')).slice(0, 60),
        durationMs, fps: clamp(Math.round(Number(data.fps) || 30), 1, 120),
        interpolation: ['smooth', 'linear', 'step'].includes(data.interpolation) ? data.interpolation : 'smooth', loop: Boolean(data.loop), keyframes,
      };
      this.clips.push(this.clip);
      this.clipIndex = this.clips.length - 1;
      this.playing = false;
      this.selectedFrameTime = -1;
      this.timeMs = 0;
      this.renderClip();
      this.seek(0);
      this.setStatus(`Importada «${this.clip.name}» · ${keyframes.length} keyframes.`);
    } catch (error) {
      this.setStatus(error.message || 'No se pudo importar el archivo de animación.');
    }
  }
}
