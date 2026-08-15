/**
 * Vercel Function entrypoint for the signaling WebSocket.
 *
 * Vercel Functions serve WebSockets by exporting a Node HTTP server, which is
 * upgraded exactly like a standalone `ws` deployment. Fluid compute is required
 * and is enabled via `fluid: true` in vercel.json.
 *
 * A plain GET (no Upgrade header) returns a health payload, which makes the
 * deployment verifiable with curl.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../shared/protocol.js';
import { attachSignaling } from '../server/signaling.js';
import { hasTurn } from '../server/ice.js';
import { createRoomStore } from '../server/store/index.js';
import { log } from '../server/logger.js';

/**
 * Function instances are reused across connections under Fluid compute, so the
 * store and server are created once per instance rather than per request.
 */
const store = createRoomStore();

const server = createServer((request, response) => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        service: 'vchat-signaling',
        status: 'ok',
        protocol: PROTOCOL_VERSION,
        store: store.kind,
        turn: hasTurn(),
        region: process.env.VERCEL_REGION ?? 'local',
      }),
    );
    return;
  }
  response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
  response.end('Method Not Allowed');
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  // Signaling traffic is small and latency-sensitive; compression costs more
  // than it saves and has known memory-fragmentation issues under `ws`.
  perMessageDeflate: false,
});

const shutdown = attachSignaling(wss, {
  store,
  // Kept just under the Function's maxDuration (300s in vercel.json, the limit
  // available on every plan) so the client reconnects on its own terms rather
  // than being cut off mid-call.
  connectionTtlMs: Number(process.env.WS_CONNECTION_TTL_MS ?? 280_000),
});

// Vercel sends SIGTERM before reclaiming an instance. Closing sockets cleanly
// means peers see an immediate departure instead of waiting for a timeout.
process.on('SIGTERM', () => {
  log.info('SIGTERM received, closing signaling server');
  void shutdown().finally(() => {
    wss.close();
    server.close();
  });
});

export default server;
