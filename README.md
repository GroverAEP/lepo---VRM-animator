# LOOP · VRM Playground

Escena interactiva 3D para cargar personajes VRM, moverlos y observar cómo reaccionan a objetos.

## Publicar gratis con GitHub Pages

1. Crea un repositorio **vacío** en GitHub, sin README, licencia ni `.gitignore`. Para un sitio de proyecto puedes usar, por ejemplo, `loop-vrm-playground`.
2. Desde la carpeta del proyecto, conecta y sube esta copia:

   ```sh
   git remote add origin https://github.com/TU-USUARIO/NOMBRE-DEL-REPOSITORIO.git
   git add .
   git commit -m "Preparar LOOP para GitHub Pages"
   git push -u origin main
   ```

   Reemplaza `TU-USUARIO` y `NOMBRE-DEL-REPOSITORIO` por los de tu repositorio. Incluye la carpeta `.github/workflows`; `.gitignore` omite `node_modules`, `dist` y archivos `.vrm`.
3. En GitHub abre **Settings → Pages** y en **Build and deployment → Source** elige **GitHub Actions**.
4. Cada push a `main` compilará y publicará el sitio. El primer despliegue puede tardar unos minutos. La dirección aparecerá en **Settings → Pages** y en la ejecución del workflow `Deploy to GitHub Pages`.

El sitio público sirve la escena y sus funciones que corren en el navegador. Los visitantes pueden cargar su propio archivo `.vrm` desde su equipo; esos modelos no se envían al sitio. La cámara integrada requiere permiso y HTTPS, que GitHub Pages proporciona. El seguimiento facial descarga el modelo de MediaPipe desde Google cuando se activa por primera vez.

**Funciones que requieren ejecución local:** GitHub Pages solo sirve archivos estáticos, así que no ejecuta el proxy de cámara ni el proxy de desarrollo para Ollama. El chat conserva sus respuestas básicas locales; para usar Ollama o una cámara IP con el proxy, inicia la app con `npm install` y `npm run dev` en un equipo de tu red. No expongas Ollama directamente a internet. El seguimiento con cámara integrada sí está disponible en el sitio publicado.

Los archivos VRM personales se excluyen del repositorio para evitar subir modelos grandes o con licencia ajena. Si quieres compartir un modelo, revisa primero su licencia y distribúyelo por separado.

## Iniciar

```sh
npm install
npm run dev
```

Abre la URL local que muestra Vite. Para usar otro personaje, pulsa el botón ↑ en la tarjeta del personaje o arrastra un archivo `.vrm` a la ventana. La escena carga archivos VRM locales; no los sube a ningún servidor.

## Chat con un modelo local

El chat puede usar **Ollama**. Instala Ollama y abre el chat; también puedes escribir el nombre del modelo y pulsar **DESCARGAR Y ACTIVAR** para instalarlo desde la interfaz:

```sh
npm run dev
```

Deja Ollama activo y abre el chat del visor. La aplicación intenta conectarse al iniciar; el selector muestra los modelos instalados y el botón ↻ vuelve a consultar Ollama. Como alternativa, puedes instalar `qwen3:1.7b` desde una terminal con `ollama pull qwen3:1.7b`. También acepta otros nombres publicados por Ollama, por ejemplo `llama3.2:1b`. Qwen3 1.7B ocupa alrededor de 1.4 GB en la biblioteca de Ollama; el uso real de memoria también depende del contexto y del sistema.

En desarrollo, Vite reenvía `/ollama` a `http://127.0.0.1:11434` para evitar configurar CORS en el navegador. Para apuntar a otra dirección, inicia Vite con `OLLAMA_HOST=http://HOST:11434 npm run dev`. El proxy de Vite solo existe durante desarrollo. Para una publicación estática, configura `VITE_OLLAMA_BASE_URL` con la dirección de Ollama y permite el origen del sitio mediante `OLLAMA_ORIGINS` en Ollama; evita exponer el servicio de Ollama directamente a redes públicas.

El modelo genera respuestas en español y devuelve una emoción y un gesto para animar al personaje. El chat conserva una ventana corta del diálogo mientras la página está abierta. Si Ollama no está disponible, se mantiene el chat básico por reglas locales.

## Cámara del teléfono o cámara IP

Abre la pestaña **CÁMARA**, elige **Stream MJPEG por IP** o **Stream de video por URL**, escribe la IP, puerto y ruta que proporciona la aplicación de cámara del teléfono, y pulsa **INICIAR SEGUIMIENTO**. Puedes escribir `192.168.1.25:8080/video` sin `http://`. El teléfono y el equipo que ejecuta el visor deben estar en la misma red Wi-Fi. La ruta `/video` se agrega automáticamente para MJPEG si no escribes una. En desarrollo, Vite transmite el stream mediante un proxy local para evitar CORS; solo acepta direcciones IPv4 privadas de la red local. El navegador debe poder reproducir el formato de video; RTSP no se reproduce directamente. La cámara integrada del equipo continúa disponible con **Cámara de este equipo**.

## Controles

- **Clic + arrastrar:** agarrar y mover el personaje.
- **Soltar:** lanzar; la velocidad del movimiento se convierte en impulso.
- **Rueda del mouse:** acercar o alejar la cámara.
- **Arrastrar el fondo:** orbitar la cámara.
- **＋ COLOCAR OBJETO:** activa el modo de colocación; haz clic en el suelo para crear un objeto. El personaje lo mira, lo analiza y se acerca.
- **Arrastrar un objeto y soltarlo:** el objeto sale lanzado. El personaje también recoge automáticamente el objeto que acaba de descubrir y lo lanza al terminar de analizarlo.
- **Caminar y correr:** el personaje camina despacio cuando el objeto está cerca y corre si tiene que recorrer más distancia; ambas velocidades tienen ciclos de brazos y piernas.
- **✦ ANIMAR:** reproduce gestos corporales como saludar, explicar, asentir, reír, encogerse de hombros y rascarse la cabeza.
- **Pestañas PERSONAJE / CÁMARA:** cambian el panel del visor sin recargar ni detener la escena 3D.
- **EDITOR:** carga un VRM y entra en EDITOR para crear clips con keyframes en la franja horizontal bajo el personaje. **CREAR CORRIDA** agrega un ciclo editable de carrera. Arrastra los marcadores para cambiar el tiempo de cada keyframe. Activa **MANIPULAR EN PERSONAJE**, pulsa un punto de articulación y usa el gizmo para girar o moverlo; **＋ KEYFRAME** guarda la pose en el tiempo actual. **EXPORTAR VRMA** genera un archivo glTF binario `.vrma` con la extensión humanoide VRMA 1.0 para usarlo en herramientas compatibles. **JSON PROPIO** conserva el formato `.vrmanim.json` para volver a importar el clip en este editor.
- **Seguimiento facial:** carga un VRM, abre la pestaña CÁMARA y activa el seguimiento. Con permiso de cámara, el personaje copia la mirada, el parpadeo, la apertura de la boca, las expresiones y la orientación de la cabeza. Requiere HTTPS o localhost. El motor y WASM de MediaPipe se incluyen con la app; la primera activación descarga el modelo facial desde Google. El análisis del video corre en el navegador y los fotogramas no se envían.
- **✋ CARICIAS:** activa el modo, mantén pulsado y desliza la mano blanca sobre el personaje. Las caricias elevan la paciencia y mejoran su ánimo; si está feliz, puede empezar a bailar.
- **Estado de ánimo y paciencia:** el panel muestra cómo se siente. La paciencia baja lentamente y una interacción amable la recupera. En los VRM se usan las expresiones faciales disponibles, además de animar el cuerpo.
- **RAGDOLL ON/OFF:** activar gravedad y articulaciones físicas. En este modo también puedes agarrar y lanzar partes del cuerpo.
- **↻:** devolver el personaje a la escena.

La conducta reactiva del escenario no requiere conexión. El seguimiento facial descarga MediaPipe, WASM y el modelo la primera vez que se activa; después el video se analiza localmente y no se transmite. Los VRM con soporte de mirada usan el sistema LookAt del modelo; el personaje de muestra mueve pupilas y cabeza. El ragdoll usa `cannon-es`, con bisagras giratorias en codos y rodillas, articulaciones de cono y torsión en hombros y caderas, y colisión entre los segmentos no conectados del rig. En modelos VRM, se simulan los huesos humanoides reconocidos por el formato.

## Controlador de personajes VRM

El controlador está separado en `src/vrm/`: runtime, mezclador de poses, reposo procedural, mirada, expresiones, labios, gestos, movimiento secundario y anatomía optativa. Cada personaje tiene instancias y temporizadores propios. Se usa el esqueleto humanoide normalizado disponible en `@pixiv/three-vrm` 3.4; los huesos y expresiones ausentes se omiten. Los clips de reposo solo se reproducen si el GLTF trae un clip llamado `idle` o `rest` y sus pistas apuntan a huesos humanoides normalizados; de lo contrario entra el reposo procedural. El sistema de resortes VRM incluido en los propios modelos permanece activo por defecto.

El runtime del personaje cargado se expone como `window.vrmCharacter` para que el juego active acciones desde sus eventos:

```js
window.vrmCharacter.setState('sitting'); // idle, walking, running, turning, talking, listening, reacting, interacting, sitting, customAnimation
window.vrmCharacter.clearManualState();
window.vrmCharacter.playGesture('wave', 2.4); // nod, shakeHead, point, shrug, laugh, explain, crossedArms...
window.vrmCharacter.setMood('happy'); // neutral, calm, curious, happy, sad, angry, surprised, afraid, confused, shy
window.vrmCharacter.wink('left');
window.vrmCharacter.setExpression('relaxed', 0.4);
window.vrmCharacter.speak('Hola, ¿cómo estás?'); // visemas aproximados del texto, no fonemas exactos
window.vrmCharacter.setEnabled('secondary', false);
```

Para sincronizar una voz, pasa un `THREE.AudioAnalyser` con `setAudioAnalyser(analyser)` antes de llamar `speak`. `registerAnatomyNode(node, options)` solo simula huesos registrados explícitamente; el módulo está apagado por defecto y no adivina qué nodo anatómico debe mover. Los estados manuales tienen prioridad sobre el comportamiento automático hasta llamar `clearManualState()`.
