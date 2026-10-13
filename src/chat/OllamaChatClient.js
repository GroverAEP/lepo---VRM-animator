const EMOTIONS = new Set(['neutral', 'happy', 'sad', 'angry', 'surprised', 'thoughtful', 'curious']);
const GESTURES = new Set(['wave', 'goodbye', 'point', 'crossedArms', 'scratchHead', 'shrug', 'nod', 'shakeHead', 'laugh', 'surprised', 'handsOnHips', 'explain']);
const SYSTEM_PROMPT = `Eres Mika, una compañera virtual cálida, curiosa y respetuosa dentro de un visor 3D. Responde siempre en español, directamente a lo que la persona dice, en 1 a 3 frases breves. Conserva el contexto de la conversación. Si comparte algo difícil, escucha con empatía y no diagnostiques. Devuelve únicamente un objeto JSON con estas claves: "reply" (texto para decir), "emotion" (una de neutral, happy, sad, angry, surprised, thoughtful, curious), y "gesture" (una de wave, goodbye, point, crossedArms, scratchHead, shrug, nod, shakeHead, laugh, surprised, handsOnHips, explain; puede ser cadena vacía). No afirmes que puedes ver, oír o hacer acciones que no estén disponibles.`;

async function readJsonResponse(response, service) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const type = response.headers.get('content-type') || 'tipo desconocido';
    throw new Error(`${service} devolvió una respuesta que no es JSON (HTTP ${response.status}, ${type}). Comprueba que Ollama esté activo y que la URL del servicio sea correcta.`);
  }
}

function parseAssistantContent(content) {
  const raw = String(content ?? '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed) return parsed;
  } catch {}
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try { return JSON.parse(json); } catch {}
  }
  return { reply: raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() };
}

export class OllamaChatClient {
  constructor({ baseUrl = import.meta.env.VITE_OLLAMA_BASE_URL || '/ollama', onStatus = () => {} } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.onStatus = onStatus;
    this.models = [];
    this.model = localStorage.getItem('loop-ollama-model') || 'qwen3:1.7b';
    this.history = [];
    this.connected = false;
  }

  async connect() {
    this.onStatus('Conectando con Ollama…', 'loading');
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4500) });
      if (!response.ok) throw new Error(`Ollama respondió ${response.status}`);
      const data = await readJsonResponse(response, 'Ollama');
      this.models = (data.models ?? []).map((model) => model.name).filter(Boolean);
      this.connected = true;
      if (this.models.includes(this.model)) {
        // Keep the selected model when it is installed.
      } else if (this.models.length) {
        this.model = this.models[0];
      }
      this.onStatus(this.models.length ? `Ollama conectado · ${this.models.length} modelo(s)` : 'Ollama está activo; instala un modelo para conversar', this.models.length ? 'connected' : 'empty');
      return this.models;
    } catch (error) {
      this.connected = false;
      this.onStatus('Sin conexión · respuestas básicas', 'offline');
      throw error;
    }
  }

  setModel(model) {
    this.model = model;
    localStorage.setItem('loop-ollama-model', model);
  }

  async pull(model, onProgress = () => {}) {
    const name = model.trim();
    if (!name) throw new Error('Escribe el nombre de un modelo.');
    this.onStatus(`Descargando ${name}…`, 'loading');
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
    });
    if (!response.ok || !response.body) throw new Error(`Ollama no pudo descargar el modelo (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consume = (line) => {
      if (!line.trim()) return;
      let update;
      try { update = JSON.parse(line); }
      catch { throw new Error('Ollama devolvió datos de descarga en un formato inesperado. Comprueba que /api/pull responda desde Ollama.'); }
      if (update.error) throw new Error(update.error);
      const progress = update.total ? Math.round((update.completed / update.total) * 100) : null;
      onProgress({ status: update.status ?? 'Descargando…', progress, completed: update.completed ?? 0, total: update.total ?? 0 });
      this.onStatus(progress === null ? `${update.status ?? 'Descargando'} · ${name}` : `Descargando ${name} · ${progress}%`, 'loading');
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    this.setModel(name);
    await this.connect();
    if (!this.models.includes(name)) throw new Error(`La descarga terminó, pero Ollama no muestra ${name} en su lista.`);
    this.setModel(name);
    return name;
  }

  async respond(userText) {
    if (!this.connected || !this.models.includes(this.model)) throw new Error('No hay un modelo local seleccionado.');
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.history.slice(-12),
      { role: 'user', content: userText },
    ];
    this.onStatus(`Generando con ${this.model}…`, 'loading');
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false, format: 'json', options: { temperature: 0.7, num_predict: 160 } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`Ollama respondió ${response.status}`);
    const data = await readJsonResponse(response, 'Ollama');
    const parsed = parseAssistantContent(data.message?.content);
    const reply = String(parsed.reply ?? parsed.text ?? '').trim();
    if (!reply) throw new Error('El modelo devolvió una respuesta vacía.');
    const emotion = EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'curious';
    const gesture = GESTURES.has(parsed.gesture) ? parsed.gesture : '';
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    this.history = this.history.slice(-16);
    this.onStatus(`Ollama · ${this.model}`, 'connected');
    return { text: reply, emotion, gesture };
  }
}
