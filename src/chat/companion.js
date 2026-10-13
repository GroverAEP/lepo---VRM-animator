const includesAny = (text, words) => words.some((word) => text.includes(word));

export function replyToMessage(input) {
  const text = input.trim().toLocaleLowerCase('es');
  const sentiment = includesAny(text, ['odio', 'enojad', 'molest', 'fastidi', 'inutil', 'tonta', 'callate', 'cállate'])
    ? 'angry'
    : includesAny(text, ['triste', 'solo', 'sola', 'mal día', 'mal dia', 'problema', 'preocup', 'miedo', 'ansiedad', 'difícil', 'dificil'])
      ? 'sad'
      : includesAny(text, ['gracias', 'genial', 'increíble', 'increible', 'bonita', 'linda', 'me gusta', 'te quiero', 'feliz', 'bien hecho'])
        ? 'happy'
        : null;

  const math = text.match(/(?:cu[aá]nto es|calcula|resuelve)?\s*(-?\d+(?:[.,]\d+)?)\s*([+*/]|menos|por|entre)\s*(-?\d+(?:[.,]\d+)?)/);
  if (math) {
    const a = Number(math[1].replace(',', '.'));
    const b = Number(math[3].replace(',', '.'));
    const operator = ({ '+': '+', menos: '-', '-': '-', por: '*', '*': '*', entre: '/', '/': '/' })[math[2]];
    const result = operator === '+' ? a + b : operator === '-' ? a - b : operator === '*' ? a * b : b === 0 ? null : a / b;
    if (result !== null) return { text: `El resultado es ${Number(result.toFixed(6))}. ¿Quieres que hagamos otra cuenta?`, emotion: 'thoughtful', gesture: 'explain' };
  }

  if (includesAny(text, ['hola', 'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'qué tal'])) {
    return { text: '¡Hola! Me alegra que estés aquí. ¿Qué te gustaría conversar?', emotion: 'happy', gesture: 'wave' };
  }
  if (includesAny(text, ['cómo te llamas', 'quién eres', 'quien eres', 'tu nombre'])) {
    return { text: `Soy Mika, tu compañera virtual. Puedo conversar contigo y también explorar los objetos de este mundo.`, emotion: 'happy', gesture: 'explain' };
  }
  if (includesAny(text, ['cómo estás', 'como estas', 'cómo te sientes', 'como te sientes'])) {
    return { text: `Ahora me siento curiosa y contenta de hablar contigo. ¿Y tú, cómo estás?`, emotion: 'happy', gesture: 'nod' };
  }
  if (includesAny(text, ['qué puedes hacer', 'que puedes hacer', 'ayuda', 'cómo funciona', 'como funciona'])) {
    return { text: 'Puedo charlar, reaccionar a lo que me cuentas, mostrar emociones y gestos, y observar los objetos que colocas en la escena.', emotion: 'thoughtful', gesture: 'explain' };
  }
  if (includesAny(text, ['gracias', 'te quiero', 'me gustas', 'eres genial', 'eres linda', 'eres bonita'])) {
    return { text: '¡Gracias por decírmelo! Me hace mucha ilusión compartir este ratito contigo.', emotion: 'happy', gesture: 'laugh' };
  }
  if (includesAny(text, ['adiós', 'adios', 'hasta luego', 'nos vemos', 'chao'])) {
    return { text: '¡Hasta pronto! Me gustó conversar contigo. Aquí estaré cuando quieras volver.', emotion: 'happy', gesture: 'goodbye' };
  }
  if (sentiment === 'angry') {
    return { text: 'Noto que esto te molesta. Quiero entenderte; cuéntame qué pasó y trataré de escucharte con calma.', emotion: 'sad', gesture: 'nod' };
  }
  if (sentiment === 'sad') {
    return { text: 'Siento que estés pasando por eso. Estoy aquí para escucharte. ¿Qué es lo que más te preocupa ahora?', emotion: 'sad', gesture: 'nod' };
  }
  if (sentiment === 'happy') {
    return { text: '¡Se nota tu buena energía y me la contagias! Cuéntame un poco más.', emotion: 'happy', gesture: 'laugh' };
  }
  if (text.endsWith('?') || includesAny(text, ['qué ', 'que ', 'cómo ', 'como ', 'por qué', 'porque ', 'cuándo ', 'cuando ', 'dónde ', 'donde ', 'quién ', 'quien '])) {
    return { text: 'Buena pregunta. En esta versión puedo responder sobre mí, el visor y algunas cuentas sencillas. Para entender mejor tu pregunta, ¿me das un poco más de contexto?', emotion: 'thoughtful', gesture: 'scratchHead' };
  }
  return { text: 'Te escucho. ¿Qué significa eso para ti? Me gustaría entenderlo mejor.', emotion: 'curious', gesture: 'nod' };
}

export function inferUserSentiment(input) {
  const text = input.toLocaleLowerCase('es');
  if (includesAny(text, ['odio', 'enojad', 'molest', 'fastidi', 'inutil', 'tonta', 'callate', 'cállate'])) return 'angry';
  if (includesAny(text, ['triste', 'solo', 'sola', 'mal día', 'mal dia', 'problema', 'preocup', 'miedo', 'ansiedad', 'difícil', 'dificil'])) return 'sad';
  if (includesAny(text, ['gracias', 'genial', 'increíble', 'increible', 'bonita', 'linda', 'me gusta', 'te quiero', 'feliz', 'bien hecho'])) return 'happy';
  return null;
}
