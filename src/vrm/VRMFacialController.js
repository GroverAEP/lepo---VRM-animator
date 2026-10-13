const MOODS = {
  neutral: {}, calm: { relaxed: 0.18 }, curious: { surprised: 0.18 }, happy: { happy: 0.72 },
  sad: { sad: 0.62 }, angry: { angry: 0.58 }, surprised: { surprised: 0.82 },
  afraid: { surprised: 0.45, sad: 0.18 }, confused: { confused: 0.4, lookLeft: 0.15 },
  shy: { shy: 0.35, relaxed: 0.18 }, impatient: { angry: 0.22, relaxed: 0.08 },
};

/** Smoothly combines named facial layers without assuming every VRM has every preset. */
export class VRMFacialController {
  constructor(vrm) {
    this.manager = vrm?.expressionManager;
    this.layers = new Map();
    this.current = new Map();
    this.resolved = new Map();
    this.target = new Map();
    this.known = new Set();
    this.blinkWeights = { blink: 0, blinkLeft: 0, blinkRight: 0 };
    this.winkWeights = { blinkLeft: 0, blinkRight: 0, blink: 0 };
    this.winkSide = 'left'; this.winkElapsed = 0; this.winkDuration = 0.3;
    this.speed = 9;
  }

  resolve(name) {
    if (!this.manager) return null;
    if (this.resolved.has(name)) return this.resolved.get(name);
    let actual = this.manager.getExpression(name) ? name : null;
    if (!actual) {
      const aliases = {
        confused: /confus|doubt|question/i, shy: /shy|blush|embarrass/i,
        fear: /fear|scared|afraid/i, squint: /squint|narrow|half.?close/i,
        smile: /smile|happy/i, blush: /blush|cheek/i,
      };
      const pattern = aliases[name];
      if (pattern) actual = this.manager.expressions.find((expression) => pattern.test(expression.expressionName))?.expressionName ?? null;
    }
    this.resolved.set(name, actual);
    return actual;
  }

  setLayer(layer, weights = {}) { this.layers.set(layer, weights); }

  setMood(mood, intensity = 1) {
    this.setLayer('mood', Object.fromEntries(Object.entries(MOODS[mood] ?? {}).map(([key, value]) => [key, value * intensity])));
  }

  setEmotion(name, intensity = 1) {
    const weights = MOODS[name] ?? { [name]: intensity };
    this.setLayer('emotion', Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * intensity])));
  }

  blink(weight) { this.blinkWeights.blink = weight; this.blinkWeights.blinkLeft = weight; this.blinkWeights.blinkRight = weight; this.setLayer('blink', this.blinkWeights); }
  wink(side = 'left', duration = 0.3) { this.winkSide = side === 'right' ? 'right' : 'left'; this.winkElapsed = 0; this.winkDuration = Math.max(0.12, duration); }

  update(dt) {
    if (!this.manager) return;
    if (this.winkElapsed < this.winkDuration) {
      this.winkElapsed += dt;
      const weight = Math.sin(Math.PI * Math.min(1, this.winkElapsed / this.winkDuration));
      this.winkWeights.blinkLeft = this.winkSide === 'left' ? weight : 0;
      this.winkWeights.blinkRight = this.winkSide === 'right' ? weight : 0;
      this.winkWeights.blink = 0;
      this.layers.set('wink', this.winkWeights);
    } else this.layers.delete('wink');
    const target = this.target; target.clear();
    for (const weights of this.layers.values()) {
      for (const name in weights) {
        const value = weights[name];
        const actual = this.resolve(name);
        if (actual) target.set(actual, Math.min(1, (target.get(actual) ?? 0) + value));
      }
    }
    const known = this.known; known.clear();
    for (const name of this.current.keys()) known.add(name);
    for (const name of target.keys()) known.add(name);
    for (const name of known) {
      const next = target.get(name) ?? 0;
      const value = this.current.get(name) ?? 0;
      const blended = value + (next - value) * (1 - Math.exp(-this.speed * dt));
      this.current.set(name, blended);
      this.manager.setValue(name, blended);
    }
  }
}
