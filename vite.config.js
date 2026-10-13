import { defineConfig } from 'vite';
import { Readable } from 'node:stream';

const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const [repositoryOwner, repositoryName] = (process.env.GITHUB_REPOSITORY || '').split('/');
const isUserOrOrgSite = repositoryName === `${repositoryOwner}.github.io`;
const base = process.env.GITHUB_ACTIONS && repositoryName && !isUserOrOrgSite
  ? `/${repositoryName}/`
  : '/';

function isPrivateIPv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function explainCameraConnectionError(error, target) {
  const code = error?.cause?.code;
  const address = target.host;
  if (code === 'ECONNREFUSED') return `El dispositivo ${address} rechazó la conexión. Verifica que la app de cámara esté transmitiendo y que el puerto sea correcto.`;
  if (code === 'ETIMEDOUT' || error?.name === 'TimeoutError') return `No hubo respuesta de ${address}. Comprueba que el teléfono siga transmitiendo, estén en la misma Wi-Fi y el router no tenga aislamiento de clientes.`;
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return `El equipo que ejecuta Vite no puede llegar a ${address}. Si Vite corre en WSL, Docker, una máquina virtual o un entorno remoto, usa una ejecución local en la misma red del teléfono.`;
  if (code === 'ENOTFOUND') return `No se encontró el host de cámara ${target.hostname}. Usa la IP local que muestra la app del teléfono.`;
  if (code?.startsWith('ERR_TLS') || code?.startsWith('ERR_SSL') || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') return 'Falló la conexión HTTPS de la cámara local. Muchas apps de cámara solo ofrecen HTTP; prueba http:// con la misma IP, puerto y ruta.';
  return `No se pudo conectar con ${address}${code ? ` (${code})` : ''}: ${error?.cause?.message || error.message}`;
}

function cameraStreamProxy() {
  const handle = async (request, response, next) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const probeOnly = requestUrl.pathname === '/camera-probe';
    if (requestUrl.pathname !== '/camera-stream' && !probeOnly) return next();
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'Método no permitido.' }));
      return;
    }

    let target;
    try {
      target = new URL(requestUrl.searchParams.get('url') || '');
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || !isPrivateIPv4(target.hostname)) {
        const message = 'Usa una cámara IPv4 privada de la red local.';
        response.writeHead(400, { 'content-type': probeOnly ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' })
          .end(probeOnly ? JSON.stringify({ error: message }) : message);
        return;
      }
    } catch {
      const message = 'La URL de cámara no es válida.';
      response.writeHead(400, { 'content-type': probeOnly ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' })
        .end(probeOnly ? JSON.stringify({ error: message }) : message);
      return;
    }

    const controller = new AbortController();
    response.on('close', () => controller.abort());
    try {
      const fetchSignal = probeOnly
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(6500)])
        : controller.signal;
      const upstream = await fetch(target, { headers: { accept: request.headers.accept || '*/*' }, signal: fetchSignal });
      if (probeOnly) {
        const contentType = upstream.headers.get('content-type') || '';
        await upstream.body?.cancel();
        controller.abort();
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ status: upstream.status, contentType }));
        return;
      }
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'x-content-type-options': 'nosniff',
      });
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
      else response.end();
    } catch (error) {
      if (response.headersSent || controller.signal.aborted) return;
      const message = explainCameraConnectionError(error, target);
      response.writeHead(502, { 'content-type': probeOnly ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' })
        .end(probeOnly ? JSON.stringify({ error: message }) : message);
    }
  };

  return {
    name: 'loop-local-camera-stream',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  base,
  plugins: [cameraStreamProxy()],
  server: {
    proxy: {
      '/ollama': {
        target: ollamaHost,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
});
