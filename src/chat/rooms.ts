import WS from 'ws';
import { onEvent, Events, Message, emit } from '../util/comm';

export interface Room {
  peers: Map<string, WS>,
  id: string,
  password: string // Encrypted, of course
}

export interface CreateRoomData {
  id: string,
  password: string // Encrypted, of course
}

const rooms: Map<string, Room> = new Map();

export function setRooms(wss: WS.Server) {
  wss.on('connection', (ws: WS) => {
    onEvent(ws, Events.CREATE_ROOM, (msg: Message) => {
      const data: CreateRoomData = msg.data || {};

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
  })
}