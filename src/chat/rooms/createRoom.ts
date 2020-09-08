import WS from 'ws';

import { onEvent, emit, Message, Events } from '../../util/comm';
import { RoomData, Room } from './rooms';

export function createRoomHandler(ws: WS, msg: Message, rooms: Map<string, Room>) {
  const data: RoomData = msg.data || {};

  if (data.id) {
    if (rooms.has(data.id)) {
      emit(ws, Events.CREATE_ROOM_ERR, {
        errMsg: 'Room already exists.'
      })
    }
    else {
      rooms.set(data.id, {
        peers: new Map().set('host', {
          ws,
          meta: {}
        }),
        id: data.id,
        password: data.password
      })

      onEvent(ws, Events.RELAY_DATA, (msg: Message) => { // Relay any WebRTC data to every other peer in the room
        rooms.get(data.id).peers.forEach((peer, peerId) => {
          if (peerId !== 'host') emit(peer.ws, Events.RECV_DATA, msg.data);
        })
      })

      ws.on('close', () => {
        rooms.get(data.id).peers.delete('host');
        rooms.get(data.id).peers.forEach(peer => {
          emit(peer.ws, Events.PEER_LEFT, {
            id: 'host',
            host: true,
            meta: {},
            reason: 'Disconnected.'
          })
        })
      })

      onEvent(ws, Events.LEAVE_ROOM, () => {
        rooms.get(data.id).peers.delete('host');
        rooms.get(data.id).peers.forEach(peer => {
          emit(peer.ws, Events.PEER_LEFT, {
            id: data,
            host: false,
            meta: {},
            reason: 'Left the room.'
          })
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
}