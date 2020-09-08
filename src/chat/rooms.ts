import WS from 'ws';
import { onEvent, Events, Message, emit } from '../util/comm';
import { v4 as uuidv4 } from 'uuid';

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
      const data: RoomData = msg.data || {};

      if (data.id) {
        if (rooms.has(data.id)) {
          emit(ws, Events.CREATE_ROOM_ERR, {
            errMsg: 'Room already exists.'
          })
        }
        else {
          rooms.set(data.id, {
            peers: new Map().set('host', ws),
            id: data.id,
            password: data.password
          })

          onEvent(ws, Events.RELAY_DATA, (msg: Message) => { // Relay any WebRTC data to every other peer in the room
            rooms.get(data.id).peers.forEach(peer => {
              emit(peer.ws, Events.RECV_DATA, msg.data);
            })
          })

          emit(ws, Events.CREATE_ROOM_SUCCESS, {
            roomId: data.id
          })
        }
      }
      else {
        emit(ws, Events.CREATE_ROOM_ERR, {
          errMsg: 'Room id not provided'
        })
      }
    })

    onEvent(ws, Events.JOIN_ROOM, (msg: Message) => {
      const roomData: RoomData = msg.data;

      if (rooms.has(roomData.id)) {
        if (rooms.get(roomData.id).password === roomData.password) { // Yes, this WILL be encrypted.
          rooms.get(roomData.id).peers.set(uuidv4(), {
            ws,
            meta: {}
          })

          onEvent(ws, Events.RELAY_DATA, (msg: Message) => { // Relay any WebRTC data to every other peer in the room
            rooms.get(roomData.id).peers.forEach(peer => {
              emit(peer.ws, Events.RECV_DATA, msg.data);
            })
          })

          emit(ws, Events.CREATE_ROOM_SUCCESS, {
            roomId: roomData.id
          })
        }
        else emit(ws, Events.JOIN_ROOM_ERR, {
          errMsg: `Password incorrect.`
        })
      }
      else emit(ws, Events.JOIN_ROOM_ERR, {
        errMsg: `Room doesn't exist.`
      })
    })
  })
}