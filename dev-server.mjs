/**
 * Local development server.
 *
 * Runs the Vite dev server and the real signaling handler in one process on one
 * port, so `ws://localhost:5173/api/ws` behaves exactly like production. The old
 * setup ran the client on :3000 and the server on :8000 and relied on CRA's
 * `proxy` field, which does not proxy raw WebSocket connections at all — the
 * app could not actually connect in development.
 *
 * Requires Node 22.18+, which strips TypeScript types natively.
 */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

import { attachSignaling } from './server/signaling.ts';
import { createRoomStore } from './server/store/index.ts';
import { MAX_MESSAGE_BYTES } from './shared/protocol.ts';

const PORT = Number(process.env.PORT ?? 5173);

const store = createRoomStore();

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});

const httpServer = createHttpServer((request, response) => {
  if (request.url === '/api/ws') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ service: 'vchat-signaling', status: 'ok', store: store.kind }));
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
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

attachSignaling(wss, { store, connectionTtlMs: 3_600_000 });

httpServer.listen(PORT, () => {
  console.log(
    `\n  VChat dev server → http://localhost:${PORT}\n  signaling        → ws://localhost:${PORT}/api/ws\n`,
  );
});
