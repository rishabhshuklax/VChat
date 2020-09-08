import WS from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { onEvent, emit, Message, Events } from '../../util/comm';
import { RoomData, Room } from './rooms';

export function joinRoomHandler(ws: WS, msg: Message, rooms: Map<string, Room>) {
  const roomData: RoomData = msg.data || {};

  if (rooms.has(roomData.id)) {
    if (rooms.get(roomData.id).password === roomData.password) { // Yes, this WILL be encrypted.
      const newPeerId = uuidv4();

      rooms.get(roomData.id).peers.forEach(peer =>       emit(ws, Events.ALL_PEERS, allCurrentPeers); // Send a list of all existing peers to the new peer
      {
        emit(peer.ws, Events.NEW_PEER_JOINED, {
          newPeerId,
          meta: {}
        })
      })

      rooms.get(roomData.id).peers.set(newPeerId, {
        ws,
        meta: {}
      })

      onEvent(ws, Events.RELAY_DATA, (msg: Message) => { // Relay any WebRTC data to every other peer in the room
        rooms.get(roomData.id).peers.forEach((peer, peerId) => {
          if (peerId !== newPeerId) emit(peer.ws, Events.RECV_DATA, msg.data);
        })
      })

      const allCurrentPeers = [];
      rooms.get(roomData.id).peers.forEach((peer, peerId) => {
        allCurrentPeers.push({
          id: peerId,
          meta: peer.meta
        })
      })

      ws.on('close', () => {
        rooms.get(roomData.id).peers.delete(newPeerId);
        rooms.get(roomData.id).peers.forEach(peer => {
          emit(peer.ws, Events.PEER_LEFT, {
            id: newPeerId,
            host: false,
            meta: {},
            reason: 'Disconnected.'
          })
        })
      })

      onEvent(ws, Events.LEAVE_ROOM, () => {
        rooms.get(roomData.id).peers.delete(newPeerId);
        rooms.get(roomData.id).peers.forEach(peer => {
          emit(peer.ws, Events.PEER_LEFT, {
            id: newPeerId,
            host: false,
            meta: {},
            reason: 'Left the room.'
          })
        })
      })

      emit(ws, Events.CREATE_ROOM_SUCCESS, {
        roomId: roomData.id,
        currentPeers: allCurrentPeers
      })
    }
    else emit(ws, Events.JOIN_ROOM_ERR, {
      errMsg: `Password incorrect.`
    })
  }
  else emit(ws, Events.JOIN_ROOM_ERR, {
    errMsg: `Room doesn't exist.`
  })
}