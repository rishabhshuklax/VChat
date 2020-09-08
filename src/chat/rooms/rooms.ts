import WS from 'ws';

import { onEvent, Events, Message } from '../../util/comm';
import { createRoomHandler } from './createRoom';
import { joinRoomHandler } from './joinRoom';

export interface Peer {
  ws: WS,
  meta: any // TODO: Add name etc later
}

export interface Room {
  peers: Map<string, Peer>,
  id: string,
  password: string // Encrypted, of course
}

export interface RoomData {
  id: string,
  password: string // Encrypted, of course
}

const rooms: Map<string, Room> = new Map();

export function setRooms(wss: WS.Server) {
  wss.on('connection', (ws: WS) => {
    onEvent(ws, Events.CREATE_ROOM, (msg: Message) => { // Room Create
      createRoomHandler(ws, msg, rooms);
    })

    onEvent(ws, Events.JOIN_ROOM, (msg: Message) => {
      joinRoomHandler(ws, msg, rooms);
    })
  })
}