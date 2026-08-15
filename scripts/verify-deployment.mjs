/**
 * Smoke-tests a deployed VChat instance over the real wire protocol.
 *
 * Connects genuine WebSocket clients to the deployed signaling Function and
 * exercises every server behaviour a call depends on: joining, roster
 * propagation, addressed SDP/ICE relay, chat, media-state broadcast, departure
 * announcements, and resilience to malformed frames.
 *
 * This complements `e2e-call.mjs`, which drives real browsers and therefore
 * covers the media path. Together they cover both halves: this one proves the
 * deployed server is correct, that one proves the peer connection is.
 *
 * Usage: node scripts/verify-deployment.mjs https://your-deployment.vercel.app
 */
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';

const BASE_URL = (process.argv[2] ?? '').replace(/\/$/, '');
if (!BASE_URL) {
  console.error('Usage: node scripts/verify-deployment.mjs <https://deployment-url>');
  process.exit(2);
}

const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/api/ws`;

// Sandboxes and CI runners often mandate an egress proxy.
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const agent = proxy && !BASE_URL.includes('localhost') ? new HttpsProxyAgent(proxy) : undefined;

let failures = 0;
const sockets = [];

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '[32m✓[0m' : '[31m✗[0m'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A protocol-level client that records everything the server sends. */
class Client {
  received = [];

  static async connect(name) {
    const ws = new WebSocket(WS_URL, agent ? { agent } : {});
    const client = new Client();
    client.ws = ws;
    client.name = name;
    sockets.push(ws);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name}: connect timed out`)), 20_000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    ws.on('message', (data) => {
      try {
        client.received.push(JSON.parse(String(data)));
      } catch {
        client.received.push({ type: '__unparseable__' });
      }
    });
    return client;
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(raw) {
    this.ws.send(raw);
  }

  async next(type, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.received.find((message) => message.type === type);
      if (found) return found;
      await sleep(50);
    }
    throw new Error(
      `${this.name}: timed out waiting for "${type}"; saw [${this.received.map((m) => m.type).join(', ')}]`,
    );
  }

  count(type) {
    return this.received.filter((message) => message.type === type).length;
  }

  async join(roomId, displayName, password) {
    this.send({
      type: 'join',
      roomId,
      name: displayName,
      ...(password === undefined ? {} : { password }),
      state: { audio: true, video: true, screen: false },
    });
    return this.next('welcome');
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

const room = `dep${Math.floor(Math.random() * 1e6)}`;

console.log(`\nVChat deployment verification`);
console.log(`  target : ${BASE_URL}`);
console.log(`  room   : ${room}`);
console.log(`  proxy  : ${agent ? proxy : 'none'}\n`);

try {
  // --- Health and static hosting ------------------------------------------
  const health = await fetch(`${BASE_URL}/api/ws`, { dispatcher: undefined }).then((r) => r.json());
  check(
    'signaling health endpoint',
    health.status === 'ok',
    `store=${health.store} region=${health.region}`,
  );
  check('protocol version reported', typeof health.protocol === 'number', `v${health.protocol}`);

  const home = await fetch(BASE_URL);
  const homeHtml = await home.text();
  check('landing page served', home.ok && homeHtml.includes('<div id="root">'));

  const deep = await fetch(`${BASE_URL}/r/${room}`);
  check(
    'SPA deep link rewrites to the app',
    deep.ok && (await deep.text()).includes('<div id="root">'),
  );

  // --- Join and roster ----------------------------------------------------
  const ana = await Client.connect('ana');
  const anaWelcome = await ana.join(room, 'Ana');
  check('first peer joins and is welcomed', anaWelcome.self.name === 'Ana');
  check(
    'ICE servers delivered to client',
    anaWelcome.iceServers.length > 0,
    `${anaWelcome.iceServers.length} entries, turn=${health.turn}`,
  );
  check(
    'connection deadline advertised',
    anaWelcome.connectionDeadline > Date.now(),
    `${Math.round((anaWelcome.connectionDeadline - Date.now()) / 1000)}s`,
  );

  const ben = await Client.connect('ben');
  const benWelcome = await ben.join(room, 'Ben');
  check(
    'second peer sees the first in its roster',
    benWelcome.peers.length === 1 && benWelcome.peers[0].name === 'Ana',
  );

  const joinedEvent = await ana.next('peer-joined');
  check('existing peer is told about the newcomer', joinedEvent.peer.id === benWelcome.self.id);

  // --- Addressed relay ----------------------------------------------------
  const cara = await Client.connect('cara');
  await cara.join(room, 'Cara');
  await sleep(400);

  ana.send({
    type: 'signal',
    to: benWelcome.self.id,
    payload: { kind: 'description', description: { type: 'offer', sdp: 'v=0 verification' } },
  });
  const relayed = await ben.next('signal');
  check('signal reaches its addressee', relayed.from === anaWelcome.self.id);

  await sleep(700);
  check(
    'signal is NOT broadcast to other peers',
    cara.count('signal') === 0,
    'a mesh breaks if signaling fans out',
  );

  // --- Chat and state -----------------------------------------------------
  ana.send({ type: 'chat', text: 'deployment verification' });
  const chat = await ben.next('chat');
  check(
    'chat is delivered',
    chat.message.text === 'deployment verification' && chat.message.name === 'Ana',
  );

  ana.send({ type: 'state', state: { audio: false, video: true, screen: false } });
  const stateEvent = await ben.next('peer-state');
  check(
    'media state propagates',
    stateEvent.peerId === anaWelcome.self.id && stateEvent.state.audio === false,
  );

  // --- Reactions ----------------------------------------------------------
  ana.send({ type: 'reaction', emoji: '🎉' });
  const reaction = await ben.next('reaction');
  check(
    'reaction relayed to the room, sender included',
    reaction.emoji === '🎉' &&
      reaction.name === 'Ana' &&
      (await ana.next('reaction')).id === reaction.id,
  );

  // --- Latency ------------------------------------------------------------
  const pingSentAt = Date.now();
  ana.send({ type: 'ping', ts: pingSentAt });
  await ana.next('pong');
  check('server answers ping', true, `${Date.now() - pingSentAt}ms round trip`);

  // --- Resilience ---------------------------------------------------------
  ana.sendRaw('not json at all');
  ana.sendRaw('{"type":"unknown-command"}');
  const errorMessage = await ana.next('error');
  check(
    'malformed frames are rejected, not fatal',
    errorMessage.fatal === false,
    errorMessage.code,
  );

  // The room must still be fully functional after the bad frames above.
  const chatsBefore = ben.count('chat');
  ana.send({ type: 'chat', text: 'still alive' });
  await waitUntil(() => ben.count('chat') > chatsBefore, 'chat after malformed input');
  check(
    'server keeps serving after bad input',
    ben.received.some(
      (message) => message.type === 'chat' && message.message.text === 'still alive',
    ),
  );

  // --- Departure ----------------------------------------------------------
  cara.close();
  const left = await ana.next('peer-left');
  check('departures are announced', left.reason === 'disconnected' || left.reason === 'left');

  // --- Password protection -------------------------------------------------
  const lockedRoom = `${room}locked`;
  const owner = await Client.connect('owner');
  await owner.join(lockedRoom, 'Owner', 'correct-horse');

  const intruder = await Client.connect('intruder');
  intruder.send({
    type: 'join',
    roomId: lockedRoom,
    name: 'Intruder',
    password: 'wrong',
    state: { audio: true, video: true, screen: false },
  });
  const denied = await intruder.next('error');
  check('wrong password is refused', denied.code === 'BAD_PASSWORD', denied.code);

  const transcript = JSON.stringify([...owner.received, ...intruder.received]);
  check('room password is never echoed to clients', !transcript.includes('correct-horse'));
} catch (error) {
  console.error(`\n[31mFAILED[0m ${error.message}\n`);
  failures += 1;
} finally {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }
}

console.log(
  failures === 0 ? '\n[32mDeployment verified.[0m\n' : `\n[31m${failures} check(s) failed.[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
