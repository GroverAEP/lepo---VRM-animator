import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const VISION_WASM = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MOTION_KEYS = ['gazeX', 'gazeY', 'headYaw', 'headPitch', 'headRoll'];

/** Camera frames stay in the browser; only the landmark values reach the character runtime. */
export class VRMCameraFaceTracker {
  constructor({ onFrame = () => {}, onStatus = () => {} } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.stream = null;
    this.sourceConnected = false;
    this.landmarker = null;
    this.video = null;
    this.imageSource = null;
    this.imagePreview = null;
    this.frameCanvas = document.createElement('canvas');
    this.frameContext = this.frameCanvas.getContext('2d', { willReadFrequently: true });
    this.frameRequest = 0;
    this.running = false;
    this.lastVideoTime = -1;
    this.lastInference = 0;
    this.lastTimestamp = 0;
    this.lastSmoothTime = performance.now();
    this.baseline = null;
    this.blendshapeValues = Object.create(null);
    this.faceWeights = {};
    this.filtered = { gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, headRoll: 0 };
    this.onVisibilityChange = () => {
      if (document.hidden) this.cancelFrame();
      else if (this.running) this.scheduleFrame();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async start(video, { url = '', type = 'device', imagePreview = null } = {}) {
    if (this.running) return;
    this.video = video;
    this.imagePreview = imagePreview;
    try {
      if (type === 'device') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS o localhost y un navegador compatible.');
        this.onStatus('Solicitando permiso de cámara…');
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        });
        video.srcObject = this.stream;
        await video.play();
        this.sourceConnected = true;
      } else {
        const normalizedUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;
        let cameraUrl;
        try { cameraUrl = new URL(normalizedUrl); } catch { throw new Error('Escribe una IP y puerto válidos, por ejemplo 192.168.1.25:8080/video.'); }
        if (!['http:', 'https:'].includes(cameraUrl.protocol)) throw new Error('La cámara debe usar HTTP o HTTPS.');
        if (type === 'mjpeg' && cameraUrl.pathname === '/') cameraUrl.pathname = '/video';
        const encodedUrl = encodeURIComponent(cameraUrl.toString());
        let probeResponse;
        try {
          probeResponse = await fetch(`/camera-probe?url=${encodedUrl}`, { signal: AbortSignal.timeout(8000) });
        } catch {
          throw new Error('No se pudo contactar el servidor del visor para probar la cámara. Comprueba que la página siga abierta desde npm run dev y reiníciala si acabas de cambiar vite.config.js.');
        }
        const probeBody = await probeResponse.text();
        let probe;
        try {
          probe = JSON.parse(probeBody);
        } catch {
          const responseType = probeResponse.headers.get('content-type') || 'desconocido';
          throw new Error(`El servidor del proyecto no devolvió el diagnóstico de cámara esperado (HTTP ${probeResponse.status}, ${responseType}). Reinicia la aplicación con «npm run dev» y vuelve a intentarlo.`);
        }
        if (!probeResponse.ok) throw new Error(probe.error || 'No se pudo contactar la cámara.');
        if (typeof probe.status !== 'number') throw new Error('El servidor respondió un diagnóstico de cámara incompleto. Reinicia «npm run dev» y vuelve a intentarlo.');
        if (probe.status < 200 || probe.status >= 300) throw new Error(`La cámara respondió HTTP ${probe.status}. Verifica la ruta y si requiere iniciar sesión.`);
        const contentType = String(probe.contentType || '').toLowerCase();
        let sourceType = type;
        if (contentType.startsWith('multipart/x-mixed-replace') || contentType.includes('mjpeg')) sourceType = 'mjpeg';
        else if (contentType.startsWith('video/')) sourceType = 'video';
        else if (contentType.startsWith('text/html')) throw new Error('La URL abre una página web, no el stream. Copia la ruta de video/MJPEG de la app de cámara.');
        if (contentType.startsWith('image/') && !contentType.includes('motion-jpeg')) throw new Error('La URL entrega una imagen fija, no video en vivo. Usa la dirección MJPEG de la app.');
        const streamUrl = `/camera-stream?url=${encodedUrl}`;
        this.onStatus('Conectando con la cámara IP…');
        if (sourceType === 'mjpeg') {
          if (!imagePreview) throw new Error('No se encontró el visor para la cámara IP.');
          this.imageSource = imagePreview;
          imagePreview.hidden = false;
          imagePreview.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('No se recibió imagen. Comprueba la URL y que la cámara esté en la misma red.')), 12000);
            imagePreview.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
            imagePreview.addEventListener('error', () => { clearTimeout(timer); reject(new Error('No se pudo abrir la URL MJPEG. Revisa la dirección, la red y los permisos CORS de la cámara.')); }, { once: true });
            imagePreview.src = streamUrl;
          });
          this.sourceConnected = true;
        } else {
          video.crossOrigin = 'anonymous';
          video.src = streamUrl;
          try {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('La cámara no inició un stream de video reproducible.')), 12000);
              video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
              video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('El navegador rechazó el formato del stream.')); }, { once: true });
              void video.play().then(() => { if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { clearTimeout(timer); resolve(); } }).catch(reject);
            });
            this.sourceConnected = true;
          } catch (videoError) {
            // Many phone camera apps expose MJPEG but label it as a generic file.
            // Retry it as an image stream before reporting the browser's media error.
            if (!imagePreview) throw videoError;
            video.pause();
            video.removeAttribute('src');
            video.load();
            this.imageSource = imagePreview;
            imagePreview.hidden = false;
            imagePreview.crossOrigin = 'anonymous';
            try {
              await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('No se recibió imagen del stream.')), 12000);
                imagePreview.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
                imagePreview.addEventListener('error', () => { clearTimeout(timer); reject(new Error('La URL no entrega un video compatible ni un stream MJPEG.')); }, { once: true });
                imagePreview.src = streamUrl;
              });
              this.sourceConnected = true;
            } catch {
              this.imageSource = null;
              throw new Error(`El navegador no pudo reproducir este stream (tipo detectado: ${contentType || 'desconocido'}). Usa una URL HTTP de video MP4/H.264 o MJPEG; RTSP y páginas web no son compatibles.`);
            }
          }
        }
      }
      this.onStatus('Cargando motor de reconocimiento facial…');
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(VISION_WASM);
      } catch {
        throw new Error('No se pudieron cargar los archivos locales del motor facial. Reinicia el visor y verifica que /mediapipe/wasm se esté sirviendo.');
      }
      const options = { runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false };
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' } });
      } catch {
        try {
          this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' } });
        } catch {
          throw new Error('No se pudo cargar el modelo de rostro de Google. Revisa el acceso a storage.googleapis.com y vuelve a iniciar el seguimiento.');
        }
      }
      this.running = true;
      this.lastVideoTime = -1;
      this.lastInference = 0;
      this.lastTimestamp = 0;
      this.lastSmoothTime = performance.now();
      this.baseline = null;
      this.onStatus('Buscando rostro…');
      this.scheduleFrame();
      return type === 'device' ? 'device' : this.imageSource ? 'mjpeg' : 'video';
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  scheduleFrame() {
    if (!this.running || document.hidden || this.frameRequest) return;
    this.frameRequest = requestAnimationFrame((now) => this.processFrame(now));
  }

  processFrame(now) {
    this.frameRequest = 0;
    const sourceReady = this.imageSource
      ? this.imageSource.complete && this.imageSource.naturalWidth > 0
      : this.video && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (!this.running || !sourceReady) {
      this.scheduleFrame();
      return;
    }
    const newFrame = this.imageSource || this.video.currentTime !== this.lastVideoTime;
    if (newFrame && now - this.lastInference >= 33) {
      this.lastVideoTime = this.imageSource ? now : this.video.currentTime;
      this.lastInference = now;
      const timestamp = Math.max(now, this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      try {
        let frameSource = this.video;
        if (this.imageSource) {
          const width = Math.min(640, this.imageSource.naturalWidth);
          const height = Math.max(1, Math.round(width * this.imageSource.naturalHeight / this.imageSource.naturalWidth));
          if (this.frameCanvas.width !== width || this.frameCanvas.height !== height) { this.frameCanvas.width = width; this.frameCanvas.height = height; }
          this.frameContext.drawImage(this.imageSource, 0, 0, width, height);
          frameSource = this.frameCanvas;
        }
        const result = this.landmarker.detectForVideo(frameSource, timestamp);
        const categories = result.faceBlendshapes?.[0]?.categories ?? [];
        const landmarks = result.faceLandmarks?.[0];
        if (landmarks?.length >= 264) {
          const values = this.blendshapeValues;
          for (const key of Object.keys(values)) values[key] = 0;
          for (const category of categories) values[category.categoryName] = category.score;
          this.mapFaceWeights(values, this.faceWeights);
          const motion = this.readMotion(landmarks, values);
          this.onFrame({ facePresent: true, weights: this.faceWeights, emotion: this.readEmotion(values), ...motion });
          this.onStatus('Rostro detectado · seguimiento activo');
        } else {
          this.baseline = null;
          this.onFrame({ facePresent: false, weights: {}, emotion: null, gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, headRoll: 0 });
          this.onStatus('Acércate a la cámara para detectar tu rostro');
        }
      } catch (error) {
        console.error('Error durante el seguimiento facial:', error);
        if (this.imageSource) {
          this.running = false;
          const detail = String(error?.message || '').slice(0, 120);
          void this.stop({ notify: false }).then(() => this.onStatus(`No se pudo analizar el stream MJPEG${detail ? `: ${detail}` : '. Comprueba que sea un stream continuo.'}`));
        } else this.onStatus('Se perdió el seguimiento; intentando recuperar…');
      }
    }
    this.scheduleFrame();
  }

  mapFaceWeights(values, weights) {
    const blinkLeft = values.eyeBlinkLeft ?? 0;
    const blinkRight = values.eyeBlinkRight ?? 0;
    const jaw = values.jawOpen ?? 0;
    const smile = Math.max(values.mouthSmileLeft ?? 0, values.mouthSmileRight ?? 0);
    const frown = Math.max(values.mouthFrownLeft ?? 0, values.mouthFrownRight ?? 0);
    const browDown = Math.max(values.browDownLeft ?? 0, values.browDownRight ?? 0);
    const browUp = values.browInnerUp ?? 0;
    const wide = Math.max(values.eyeWideLeft ?? 0, values.eyeWideRight ?? 0);
    weights.happy = smile * 0.8;
    weights.sad = Math.max(frown * 0.62, browUp * 0.38);
    weights.angry = browDown * 0.68;
    weights.surprised = Math.max(wide * 0.72, jaw * 0.36, browUp * 0.44);
    weights.aa = jaw * 0.82;
    weights.blinkLeft = blinkLeft;
    weights.blinkRight = blinkRight;
    weights.blink = Math.max(blinkLeft, blinkRight);
    weights.lookLeft = Math.max(values.eyeLookInLeft ?? 0, values.eyeLookOutRight ?? 0) * 0.72;
    weights.lookRight = Math.max(values.eyeLookOutLeft ?? 0, values.eyeLookInRight ?? 0) * 0.72;
    weights.lookUp = Math.max(values.eyeLookUpLeft ?? 0, values.eyeLookUpRight ?? 0) * 0.62;
    weights.lookDown = Math.max(values.eyeLookDownLeft ?? 0, values.eyeLookDownRight ?? 0) * 0.62;
  }

  readEmotion(values) {
    const smile = Math.max(values.mouthSmileLeft ?? 0, values.mouthSmileRight ?? 0);
    const frown = Math.max(values.mouthFrownLeft ?? 0, values.mouthFrownRight ?? 0);
    const browDown = Math.max(values.browDownLeft ?? 0, values.browDownRight ?? 0);
    if ((values.eyeWideLeft ?? 0) > 0.58 || (values.eyeWideRight ?? 0) > 0.58 || (values.jawOpen ?? 0) > 0.7) return 'surprised';
    if (browDown > 0.48) return 'angry';
    if (frown > 0.42 || (values.browInnerUp ?? 0) > 0.58) return 'sad';
    if (smile > 0.38) return 'happy';
    return 'neutral';
  }

  readMotion(landmarks, blendshapes) {
    const nose = landmarks[1], eyeLeft = landmarks[33], eyeRight = landmarks[263];
    const eyeWidth = Math.max(0.001, Math.abs(eyeRight.x - eyeLeft.x));
    const eyeMidX = (eyeLeft.x + eyeRight.x) * 0.5;
    const eyeMidY = (eyeLeft.y + eyeRight.y) * 0.5;
    let gazeX = 0, gazeY = 0;
    if (landmarks.length > 477) {
      gazeX = (eyeRatio(landmarks[468].x, landmarks[33].x, landmarks[133].x) + eyeRatio(landmarks[473].x, landmarks[362].x, landmarks[263].x)) - 1;
      const leftTop = landmarks[159].y, leftBottom = landmarks[145].y;
      const rightTop = landmarks[386].y, rightBottom = landmarks[374].y;
      const leftY = (landmarks[468].y - leftTop) / Math.max(0.001, leftBottom - leftTop);
      const rightY = (landmarks[473].y - rightTop) / Math.max(0.001, rightBottom - rightTop);
      gazeY = 1 - (leftY + rightY);
    }
    gazeX += (blendshapes.eyeLookOutLeft ?? 0) - (blendshapes.eyeLookInLeft ?? 0);
    gazeX = clamp(gazeX * 0.62, -1, 1);
    gazeY += (blendshapes.eyeLookUpLeft ?? 0) - (blendshapes.eyeLookDownLeft ?? 0);
    gazeY = clamp(gazeY * 0.62, -1, 1);
    const raw = {
      gazeX,
      gazeY,
      headYaw: clamp((nose.x - eyeMidX) / eyeWidth * 1.7, -0.8, 0.8),
      headPitch: clamp((nose.y - eyeMidY) / eyeWidth - 0.5, -0.7, 0.7),
      headRoll: Math.atan2(eyeRight.y - eyeLeft.y, eyeRight.x - eyeLeft.x),
    };
    if (!this.baseline) this.baseline = { ...raw };
    raw.headYaw = clamp((raw.headYaw - this.baseline.headYaw) * 1.25, -0.55, 0.55);
    raw.headPitch = clamp((raw.headPitch - this.baseline.headPitch) * 1.2, -0.42, 0.42);
    raw.headRoll = clamp(raw.headRoll - this.baseline.headRoll, -0.38, 0.38);
    const now = performance.now();
    const blend = 1 - Math.exp(-10 * Math.max(0.001, (now - this.lastSmoothTime) / 1000));
    this.lastSmoothTime = now;
    for (const key of MOTION_KEYS) this.filtered[key] += (raw[key] - this.filtered[key]) * blend;
    return this.filtered;
  }

  cancelFrame() {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }

  async stop({ notify = true } = {}) {
    this.running = false;
    this.cancelFrame();
    this.landmarker?.close();
    this.landmarker = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.sourceConnected = false;
    if (this.video) {
      this.video.srcObject = null;
      if (!this.stream && this.video.src) { this.video.removeAttribute('src'); this.video.load(); }
    }
    if (this.imagePreview) { this.imagePreview.removeAttribute('src'); this.imagePreview.hidden = true; }
    this.imageSource = null;
    this.imagePreview = null;
    this.video = null;
    this.baseline = null;
    this.filtered.gazeX = this.filtered.gazeY = this.filtered.headYaw = this.filtered.headPitch = this.filtered.headRoll = 0;
    this.onFrame({ facePresent: false, weights: {}, emotion: null, gazeX: 0, gazeY: 0, headYaw: 0, headPitch: 0, headRoll: 0 });
    if (notify) this.onStatus('Cámara apagada');
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}

function eyeRatio(irisX, cornerA, cornerB) {
  const low = Math.min(cornerA, cornerB), width = Math.max(0.001, Math.abs(cornerB - cornerA));
  return clamp((irisX - low) / width, 0, 1);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
