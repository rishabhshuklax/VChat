# VChat

**Live at [call.thinkingmachinelabs.dev](https://call.thinkingmachinelabs.dev)**

Dead simple, cross-platform, peer-to-peer video chat. Share a link, talk face to face.

Audio and video travel **directly between participants** over WebRTC — encrypted with
DTLS-SRTP and never decoded by any server. The backend exists only to introduce peers to
one another and relay the handful of messages needed to set up a connection.

---

## Features

|                          |                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Instant rooms**        | No accounts, no downloads. A room exists as soon as someone joins it and disappears when the last person leaves. |
| **Up to 8 participants** | Full mesh — every peer connects directly to every other peer.                                                    |
| **Pre-join lobby**       | See yourself, pick your camera and microphone, and arrive muted if you want.                                     |
| **Screen sharing**       | One click, no renegotiation glitch, auto-promoted to the spotlight for everyone.                                 |
| **In-call chat**         | Ephemeral and never stored.                                                                                      |
| **Optional password**    | Set by whoever creates the room, hashed with scrypt, never echoed back to anyone.                                |
| **Active speaker**       | Web Audio metering rings the tile of whoever is talking.                                                         |
| **Connection quality**   | Per-peer RTT and packet-loss sampling from `getStats()`.                                                         |
| **Adaptive layout**      | Grid geometry is computed from the measured container, so tiles stay near 16:9 on any screen.                    |
| **Keyboard shortcuts**   | <kbd>M</kbd> mute · <kbd>V</kbd> camera · <kbd>S</kbd> screen · <kbd>C</kbd> chat · <kbd>P</kbd> participants    |
| **Reconnects itself**    | Signaling drops are routine on serverless; the client rejoins with its identity intact and media keeps flowing.  |

---

## Architecture

```
Browser A  ◀──────── media (WebRTC, DTLS-SRTP, direct) ────────▶  Browser B
    │                                                                 │
    └──────────▶  /api/ws  (Vercel Function, WebSocket)  ◀────────────┘
                   signaling only: who is here, and SDP/ICE relay
```

```
shared/protocol.ts    Wire protocol. Imported by BOTH client and server, so the
                      two ends cannot drift. Every inbound frame is zod-validated.

api/ws.ts             Vercel Function entrypoint. Exports a Node http.Server;
                      Vercel upgrades it exactly like a standalone ws deployment.
server/
  signaling.ts        Room membership + addressed SDP/ICE relay.
  security.ts         scrypt password hashing, room codes, token-bucket limiter.
  ice.ts              STUN/TURN configuration handed to clients.
  store/              Room state behind an interface:
    memory.ts           default; correct whenever one instance serves the room
    redis.ts            multi-instance; enabled by setting REDIS_URL
src/
  lib/call-engine.ts  The whole call as one observable object; React only renders.
  lib/mesh.ts         RTCPeerConnection per peer, perfect negotiation.
  lib/signaling.ts    Reconnecting WebSocket transport.
  lib/media.ts        getUserMedia / getDisplayMedia, device management.
  routes/, components/
```

### Why the store is an interface

Vercel makes no guarantee that two WebSocket connections for the same room reach the
same Function instance. Room state in a module-level `Map` is therefore invisible to a
second instance, and two callers can fail to discover each other.

- **Default (`MemoryRoomStore`)** — zero configuration, and exactly correct whenever a
  room is served by a single instance. That covers local development and small
  deployments.
- **`REDIS_URL` set (`RedisRoomStore`)** — roster in Redis hashes, fanout over Redis
  pub/sub. Rooms then behave identically across any number of instances.

Both back ends are verified by the **same conformance suite** (`tests/store.test.ts`), so
the adapter you use less often cannot silently diverge.

### Why perfect negotiation

Either side of a connection may need to renegotiate at any time — someone turns their
camera on, switches microphone, or starts presenting. Both offering at once ("glare")
breaks naive implementations. Each connection designates one side _polite_ purely by
comparing the two peer ids, then follows the
[MDN perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
algorithm. Audio and video transceivers are also created up front, so turning a camera on
mid-call is a `replaceTrack()` on an existing sender rather than a renegotiation.

---

## Running locally

```bash
npm install
npm run dev            # http://localhost:5173
```

One process serves the Vite dev server and the real signaling handler on one port, so
`ws://localhost:5173/api/ws` behaves exactly as it does in production.

To try a call, open the room link in two browser windows (or one normal and one private).

```bash
npm run verify         # typecheck + lint + unit tests + production build
npm test               # unit and signaling integration tests
npm run e2e            # drives two real browsers through a full call
```

`npm run e2e` needs a running instance and Chromium; it asserts that remote video is
actually decoding frames, not merely that the page rendered.

To smoke-test a deployed instance over the real wire protocol:

```bash
npm run verify:deploy -- https://your-deployment.vercel.app
```

That one connects real WebSocket clients and checks joining, addressed relay, chat,
media-state broadcast, departures, password rejection, and malformed-frame resilience.
Together the two scripts cover both halves — the server, and the peer connection.

To exercise the Redis store as well:

```bash
redis-server --port 6399 &
REDIS_TEST_URL=redis://127.0.0.1:6399 npm test
```

---

## Deploying

The repository deploys to Vercel as-is. WebSockets require **Fluid compute**, which
`vercel.json` enables via `"fluid": true`.

### Environment variables

All optional.

| Variable                                        | Purpose                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Adds a TURN relay. **Strongly recommended** — see below.                                      |
| `STUN_URLS`                                     | Overrides the default STUN servers (comma-separated).                                         |
| `REDIS_URL`                                     | Switches on the Redis room store for multi-instance deployments.                              |
| `REDIS_KEY_PREFIX`                              | Namespaces Redis keys when sharing an instance. Defaults to `vchat`.                          |
| `WS_CONNECTION_TTL_MS`                          | How long before the client pre-emptively reconnects. Keep below the Function's `maxDuration`. |
| `LOG_LEVEL`                                     | `debug` \| `info` \| `warn` \| `error`.                                                       |

### About TURN

STUN alone connects the large majority of peers, but calls **fail behind symmetric NAT
and many corporate firewalls**, where media has to be relayed. Without `TURN_*`
configured, expect a minority of participant pairs to be unable to connect.

A relay never sees your media in the clear — it forwards encrypted packets — so adding
one costs privacy nothing. Any standard TURN service works.

---

## Limits

- **8 participants.** A mesh sends one upstream copy per peer, so bandwidth grows
  linearly and gets uncomfortable beyond this. Larger calls need an SFU, which is a
  fundamentally different (and non-serverless) piece of infrastructure.
- **Rooms are ephemeral.** Nothing is persisted: no recordings, no chat history, no
  accounts. Closing the last connection destroys the room.
- **Screen share replaces your camera feed** rather than publishing a second video track,
  which keeps bandwidth flat.

## Licence

MIT
