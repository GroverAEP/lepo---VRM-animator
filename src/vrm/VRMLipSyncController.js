const VISEMES = { a: 'aa', á: 'aa', e: 'ee', é: 'ee', i: 'ih', í: 'ih', o: 'oh', ó: 'oh', u: 'ou', ú: 'ou' };

/** Text-only speech is intentionally approximate; an analyser can replace the envelope when audio exists. */
export class VRMLipSyncController {
  constructor(facial, onTalking = () => {}) {
    this.facial = facial; this.onTalking = onTalking; this.sequence = [];
    this.cursor = 0; this.elapsed = 0; this.duration = 0; this.analyser = null; this.active = false;
    this.mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  }

  speak(text, millisecondsPerCharacter = 72) {
    this.sequence = [];
    for (const character of String(text).toLowerCase()) {
      if (/[.!?,;:]/.test(character)) this.sequence.push({ viseme: null, duration: /[.!?]/.test(character) ? 0.26 : 0.13 });
      else if (VISEMES[character]) this.sequence.push({ viseme: VISEMES[character], duration: millisecondsPerCharacter / 1000 });
      else if (/[a-záéíóúñ]/i.test(character)) this.sequence.push({ viseme: 'aa', duration: millisecondsPerCharacter / 1000 });
    }
    this.cursor = 0; this.elapsed = 0;
    this.duration = this.sequence.reduce((sum, part) => sum + part.duration, 0);
    this.active = this.duration > 0;
    this.onTalking(this.active);
  }

  setAudioAnalyser(analyser) { this.analyser = analyser ?? null; }

  update(dt) {
    const mouth = this.mouth;
    mouth.aa = 0; mouth.ih = 0; mouth.ou = 0; mouth.ee = 0; mouth.oh = 0;
    if (this.analyser?.getAverageFrequency) {
      const amplitude = Math.min(1, this.analyser.getAverageFrequency() / 150);
      mouth.aa = amplitude * 0.65;
      mouth.oh = amplitude * 0.22;
      this.active = amplitude > 0.035;
    } else if (this.active) {
      this.elapsed += dt;
      while (this.cursor < this.sequence.length && this.elapsed > this.sequence[this.cursor].duration) {
        this.elapsed -= this.sequence[this.cursor].duration;
        this.cursor++;
      }
      const part = this.sequence[this.cursor];
      if (part) mouth[part.viseme] = part.viseme ? Math.sin(Math.PI * Math.min(1, this.elapsed / part.duration)) * 0.58 : 0;
      else { this.active = false; this.onTalking(false); }
    }
    this.facial.setLayer('lip-sync', mouth);
  }

  stop() { this.active = false; this.sequence.length = 0; this.facial.setLayer('lip-sync', {}); this.onTalking(false); }
}
