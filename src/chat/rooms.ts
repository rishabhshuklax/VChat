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
    })

    onEvent(ws, Events.JOIN_ROOM, (msg: Message) => {
      const roomData: RoomData = msg.data || {};

      if (rooms.has(roomData.id)) {
        if (rooms.get(roomData.id).password === roomData.password) { // Yes, this WILL be encrypted.
          const newPeerId = uuidv4();

          rooms.get(roomData.id).peers.forEach(peer => {
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

          emit(ws, Events.ALL_PEERS, allCurrentPeers); // Send a list of all existing peers to the new peer

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