import WS from 'ws';

export interface Message {
  event: string,
  data: any
}

export const Events = {
  CREATE_ROOM: 'create_room',
  CREATE_ROOM_ERR: 'create_room_err',
  CREATE_ROOM_SUCCESS: 'create_room_success',
  RELAY_DATA: 'relay_data',
  RECV_DATA: 'recv_data',
  JOIN_ROOM: 'join_room',
  JOIN_ROOM_ERR: 'join_room_err',
  JOIN_ROOM_SUCCESS: 'join_room_success'
}

export function onEvent(ws: WS, event: string, handler: (msg: Message) => void) {
  ws.on('message', (msg: string) => {
    const msgObj: Message = JSON.parse(msg);

    if (msgObj.event === event) handler(msgObj);
  })
}

export function emit(ws: WS, event: string, data: any) {
  ws.send(JSON.stringify({
    event,
    data
  }))
}