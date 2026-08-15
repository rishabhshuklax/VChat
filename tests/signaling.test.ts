/**
 * End-to-end signaling tests driving the real server over real WebSockets.
 *
 * These cover the failure modes that broke the previous implementation:
 * broadcast signaling in a mesh, a malformed frame killing the process, rooms
 * that outlive their occupants, and the room password leaking to participants.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { attachSignaling } from '../server/signaling.ts';
import { MemoryRoomStore } from '../server/store/memory.ts';
import {
  ERROR_CODES,
  decodeServerMessage,
  encode,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageOf,
} from '../shared/protocol.ts';

let server: Server;
let wss: WebSocketServer;
let store: MemoryRoomStore;
let shutdown: () => Promise<void>;
let url: string;
const clients: TestClient[] = [];

beforeEach(async () => {
  store = new MemoryRoomStore();
  server = createServer();
  wss = new WebSocketServer({ server, perMessageDeflate: false });
  shutdown = attachSignaling(wss, { store, heartbeatIntervalMs: 60_000 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await shutdown();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A scripted WebSocket client that records everything the server sends it. */
class TestClient {
  readonly received: ServerMessage[] = [];
  readonly #ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on('message', (data) => {
      const decoded = decodeServerMessage(String(data));
      if (decoded.ok) this.received.push(decoded.value);
      else throw new Error(`server sent an invalid message: ${decoded.error}`);
    });
  }

  static async connect(target: string): Promise<TestClient> {
    const ws = new WebSocket(target);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const client = new TestClient(ws);
    clients.push(client);
    return client;
  }

  send(message: ClientMessage): void {
    this.#ws.send(encode(message));
  }

  /** Sends a raw string, bypassing the protocol, to exercise the validator. */
  sendRaw(raw: string): void {
    this.#ws.send(raw);
  }

  async join(roomId: string, name: string, password?: string) {
    this.send({
      type: 'join',
      roomId,
      name,
      ...(password === undefined ? {} : { password }),
      state: { audio: true, video: true, screen: false },
    });
    return this.next('welcome');
  }

  /** Resolves with the next message of the given type. */
  async next<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 3000,
  ): Promise<ServerMessageOf<T>> {
    const deadline = Date.now() + timeoutMs;
    let index = 0;
    while (Date.now() < deadline) {
      while (index < this.received.length) {
        const message = this.received[index];
        index += 1;
        if (message && message.type === type) return message as ServerMessageOf<T>;
      }
      await sleep(5);
    }
    throw new Error(
      `timed out waiting for "${type}"; got: ${this.received.map((m) => m.type).join(', ') || '(nothing)'}`,
    );
  }

  count(type: ServerMessage['type']): number {
    return this.received.filter((message) => message.type === type).length;
  }

  async close(): Promise<void> {
    if (this.#ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.#ws.once('close', () => resolve());
      this.#ws.close();
    });
  }
}

const connect = () => TestClient.connect(url);

describe('joining', () => {
  it('welcomes the first peer into an empty room', async () => {
    const ana = await connect();
    const welcome = await ana.join('testroom', 'Ana');

    expect(welcome.self.name).toBe('Ana');
    expect(welcome.peers).toHaveLength(0);
    expect(welcome.iceServers.length).toBeGreaterThan(0);
    expect(welcome.connectionDeadline).toBeGreaterThan(Date.now());
  });

  it('tells an existing peer when someone new arrives, and lists them to the newcomer', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('testroom', 'Ana');

    const ben = await connect();
    const benWelcome = await ben.join('testroom', 'Ben');

    expect(benWelcome.peers.map((peer) => peer.name)).toEqual(['Ana']);

    const announcement = await ana.next('peer-joined');
    expect(announcement.peer.name).toBe('Ben');
    expect(announcement.peer.id).toBe(benWelcome.self.id);
    expect(announcement.peer.id).not.toBe(anaWelcome.self.id);
  });

  it('never announces a peer to itself', async () => {
    const ana = await connect();
    await ana.join('testroom', 'Ana');
    await sleep(100);
    expect(ana.count('peer-joined')).toBe(0);
  });
});

describe('password protection', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const host = await connect();
    await host.join('locked', 'Host', 'opensesame');

    const intruder = await connect();
    intruder.send({
      type: 'join',
      roomId: 'locked',
      name: 'Intruder',
      password: 'guess',
      state: { audio: true, video: true, screen: false },
    });
    const error = await intruder.next('error');
    expect(error.code).toBe(ERROR_CODES.BAD_PASSWORD);
    expect(error.fatal).toBe(true);

    const guest = await connect();
    const welcome = await guest.join('locked', 'Guest', 'opensesame');
    expect(welcome.self.name).toBe('Guest');
  });

  it('never sends the room password to any participant', async () => {
    const host = await connect();
    await host.join('locked', 'Host', 'topsecret');
    const guest = await connect();
    await guest.join('locked', 'Guest', 'topsecret');

    guest.send({ type: 'leave' });
    await host.next('peer-left');
    await sleep(50);

    // The old build put the whole room record — password included — into the
    // peer-left payload it broadcast to everyone.
    const transcript = JSON.stringify([...host.received, ...guest.received]);
    expect(transcript).not.toContain('topsecret');
  });
});

describe('signal relay', () => {
  it('delivers a signal only to its addressee', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('mesh', 'Ana');
    const ben = await connect();
    const benWelcome = await ben.join('mesh', 'Ben');
    const cara = await connect();
    await cara.join('mesh', 'Cara');
    await sleep(50);

    ana.send({
      type: 'signal',
      to: benWelcome.self.id,
      payload: { kind: 'description', description: { type: 'offer', sdp: 'v=0 fake' } },
    });

    const relayed = await ben.next('signal');
    expect(relayed.from).toBe(anaWelcome.self.id);
    expect(relayed.payload.kind).toBe('description');

    // A mesh breaks if signaling is broadcast: Cara must not see this at all.
    await sleep(150);
    expect(cara.count('signal')).toBe(0);
  });

  it('relays ICE candidates intact', async () => {
    const ana = await connect();
    await ana.join('mesh', 'Ana');
    const ben = await connect();
    const benWelcome = await ben.join('mesh', 'Ben');

    ana.send({
      type: 'signal',
      to: benWelcome.self.id,
      payload: {
        kind: 'candidate',
        candidate: { candidate: 'candidate:1 1 udp 2113 10.0.0.1 5000 typ host', sdpMLineIndex: 0 },
      },
    });

    const relayed = await ben.next('signal');
    expect(relayed.payload.kind).toBe('candidate');
    if (relayed.payload.kind !== 'candidate') return;
    expect(relayed.payload.candidate.sdpMLineIndex).toBe(0);
  });

  it('refuses to signal before joining a room', async () => {
    const stray = await connect();
    stray.send({
      type: 'signal',
      to: '00000000-0000-4000-8000-000000000001',
      payload: { kind: 'candidate', candidate: { candidate: 'x' } },
    });
    expect((await stray.next('error')).code).toBe(ERROR_CODES.NOT_IN_ROOM);
  });
});

describe('chat and state', () => {
  it('broadcasts chat to everyone including the sender', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('chatty', 'Ana');
    const ben = await connect();
    await ben.join('chatty', 'Ben');

    ana.send({ type: 'chat', text: 'hello everyone' });

    const forBen = await ben.next('chat');
    expect(forBen.message.text).toBe('hello everyone');
    expect(forBen.message.name).toBe('Ana');
    expect(forBen.message.from).toBe(anaWelcome.self.id);

    // Echoing to the sender keeps one ordering authority: the server.
    expect((await ana.next('chat')).message.text).toBe('hello everyone');
  });

  it('broadcasts a reaction to everyone, sender included', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('reactive', 'Ana');
    const ben = await connect();
    await ben.join('reactive', 'Ben');

    ana.send({ type: 'reaction', emoji: '🎉' });

    const forBen = await ben.next('reaction');
    expect(forBen.emoji).toBe('🎉');
    expect(forBen.from).toBe(anaWelcome.self.id);
    expect(forBen.name).toBe('Ana');

    // The sender animates from the same broadcast, not a local echo.
    expect((await ana.next('reaction')).id).toBe(forBen.id);
  });

  it('relays ink strokes to everyone except the sender', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('inky', 'Ana');
    const ben = await connect();
    await ben.join('inky', 'Ben');

    ana.send({
      type: 'ink',
      stroke: 's1',
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
      done: false,
    });
    ana.send({ type: 'ink', stroke: 's1', points: [{ x: 0.5, y: 0.6 }], done: true });

    const inkForBen = await ben.next('ink');
    expect(inkForBen.from).toBe(anaWelcome.self.id);
    expect(inkForBen.stroke).toBe('s1');
    expect(inkForBen.points.length).toBeGreaterThan(0);

    // The sender drew locally already; the relay must not echo back.
    await sleep(200);
    expect(ana.count('ink')).toBe(0);
  });

  it('rejects ink with out-of-range coordinates', async () => {
    const ana = await connect();
    await ana.join('inky', 'Ana');
    ana.sendRaw(
      JSON.stringify({ type: 'ink', stroke: 's', points: [{ x: 2, y: 0 }], done: false }),
    );
    expect((await ana.next('error')).code).toBe(ERROR_CODES.INVALID_MESSAGE);
  });

  it('rejects a blank reaction', async () => {
    const ana = await connect();
    await ana.join('reactive', 'Ana');
    ana.sendRaw(JSON.stringify({ type: 'reaction', emoji: '   ' }));
    expect((await ana.next('error')).code).toBe(ERROR_CODES.INVALID_MESSAGE);
  });

  it('broadcasts a mute to other peers only', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('stateful', 'Ana');
    const ben = await connect();
    await ben.join('stateful', 'Ben');

    ana.send({ type: 'state', state: { audio: false, video: true, screen: false } });

    const update = await ben.next('peer-state');
    expect(update.peerId).toBe(anaWelcome.self.id);
    expect(update.state.audio).toBe(false);
    expect(ana.count('peer-state')).toBe(0);
  });
});

describe('leaving', () => {
  it('announces an explicit leave', async () => {
    const ana = await connect();
    await ana.join('goodbye', 'Ana');
    const ben = await connect();
    const benWelcome = await ben.join('goodbye', 'Ben');

    ben.send({ type: 'leave' });
    const left = await ana.next('peer-left');
    expect(left.peerId).toBe(benWelcome.self.id);
    expect(left.reason).toBe('left');
  });

  it('announces an abrupt disconnect', async () => {
    const ana = await connect();
    await ana.join('goodbye', 'Ana');
    const ben = await connect();
    const benWelcome = await ben.join('goodbye', 'Ben');

    await ben.close();
    const left = await ana.next('peer-left');
    expect(left.peerId).toBe(benWelcome.self.id);
    expect(left.reason).toBe('disconnected');
  });

  it('deletes the room once everyone has gone, so the code can be reused', async () => {
    const ana = await connect();
    await ana.join('ephemeral', 'Ana');
    expect(store.roomCount).toBe(1);

    await ana.close();
    await sleep(100);

    // The old build kept empty rooms forever, permanently claiming the code.
    expect(await store.peers('ephemeral')).toHaveLength(0);
    expect(store.roomCount).toBe(0);
  });
});

describe('resilience', () => {
  it('survives malformed frames and keeps serving other calls', async () => {
    const ana = await connect();
    const anaWelcome = await ana.join('resilient', 'Ana');
    const ben = await connect();
    await ben.join('resilient', 'Ben');

    // Any one of these crashed the previous server, taking every call with it.
    ana.sendRaw('this is not json');
    ana.sendRaw('{"type":"nonsense"}');
    ana.sendRaw('null');
    ana.sendRaw(JSON.stringify({ type: 'join' }));

    const error = await ana.next('error');
    expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
    expect(error.fatal).toBe(false);

    // The room is still fully functional afterwards.
    ana.send({ type: 'chat', text: 'still here' });
    expect((await ben.next('chat')).message.text).toBe('still here');
    expect(anaWelcome.self.id).toBeTruthy();
  });

  it('answers pings so the client can measure liveness', async () => {
    const ana = await connect();
    await ana.join('resilient', 'Ana');
    ana.send({ type: 'ping', ts: 1234 });
    expect((await ana.next('pong')).ts).toBe(1234);
  });

  it('turns down a room that is over capacity', async () => {
    const joined = await Promise.all(
      Array.from({ length: 8 }, async (_unused, index) => {
        const client = await connect();
        await client.join('full', `Peer ${index}`);
        return client;
      }),
    );
    expect(joined).toHaveLength(8);

    const latecomer = await connect();
    latecomer.send({
      type: 'join',
      roomId: 'full',
      name: 'Latecomer',
      state: { audio: true, video: true, screen: false },
    });
    expect((await latecomer.next('error')).code).toBe(ERROR_CODES.ROOM_FULL);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
