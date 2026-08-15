/**
 * ICE server configuration handed to clients in the `welcome` message.
 *
 * STUN alone resolves the large majority of connections but fails behind
 * symmetric NAT and some corporate firewalls, where media must be relayed. Set
 * the TURN_* variables to add a relay and close that gap.
 */
import type { IceServer } from '../shared/protocol.ts';

const DEFAULT_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
];

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildIceServers(env: NodeJS.ProcessEnv = process.env): IceServer[] {
  const servers: IceServer[] = [];

  const stunUrls = splitList(env.STUN_URLS);
  servers.push({ urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN });

  const turnUrls = splitList(env.TURN_URLS);
  if (turnUrls.length > 0) {
    const username = env.TURN_USERNAME;
    const credential = env.TURN_CREDENTIAL;
    if (username && credential) {
      servers.push({ urls: turnUrls, username, credential });
    }
  }

  return servers;
}

/** True when a relay is configured, i.e. calls should survive symmetric NAT. */
export function hasTurn(env: NodeJS.ProcessEnv = process.env): boolean {
  return splitList(env.TURN_URLS).length > 0 && Boolean(env.TURN_USERNAME && env.TURN_CREDENTIAL);
}
