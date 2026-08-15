/**
 * Local development server.
 *
 * Runs the Vite dev server and the real signaling handler in one process on one
 * port, so `ws://localhost:5173/api/ws` behaves exactly like production. The old
 * setup ran the client on :3000 and the server on :8000 and relied on CRA's
 * `proxy` field, which does not proxy raw WebSocket connections at all — the
 * app could not actually connect in development.
 *
 * Server modules are loaded through Vite's SSR pipeline rather than imported
 * directly. Server code uses `.js` import specifiers (the TypeScript ESM
 * convention, and what Vercel's per-file transpile requires at runtime); Vite
 * resolves those back to the `.ts` sources, whereas a bare Node import would
 * look for `.js` files that do not exist on disk.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 5173);

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});

const { attachSignaling } = await vite.ssrLoadModule('/server/signaling.ts');
const { createRoomStore } = await vite.ssrLoadModule('/server/store/index.ts');
const { MAX_MESSAGE_BYTES } = await vite.ssrLoadModule('/shared/protocol.ts');

const store = createRoomStore();

/**
 * Chaos switch, development only: `/api/debug/outage?ms=3000` severs every
 * live signaling socket and refuses upgrades for the window. This is how the
 * e2e suite (and manual QA) proves a signaling outage is survived gracefully —
 * media keeps flowing, seats are held, and clients resume without churn.
 */
let outageUntil = 0;

const httpServer = createHttpServer((request, response) => {
  if (request.url === '/api/ws') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ service: 'vchat-signaling', status: 'ok', store: store.kind }));
    return;
  }
  if (request.url?.startsWith('/api/debug/outage')) {
    const ms = Number(new URL(request.url, 'http://localhost').searchParams.get('ms') ?? 2000);
    outageUntil = Date.now() + ms;
    for (const client of wss.clients) client.terminate();
    console.log(`[chaos] signaling outage for ${ms}ms`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ outageUntil }));
    return;
  }
  vite.middlewares(request, response);
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
});

// Vite owns its own HMR WebSocket, so only claim the signaling path.
httpServer.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname !== '/api/ws') return;
  if (Date.now() < outageUntil) {
    socket.destroy(); // the chaos window is still open
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

attachSignaling(wss, { store, connectionTtlMs: 3_600_000 });

httpServer.listen(PORT, () => {
  console.log(
    `\n  VChat dev server → http://localhost:${PORT}\n  signaling        → ws://localhost:${PORT}/api/ws\n`,
  );
});
