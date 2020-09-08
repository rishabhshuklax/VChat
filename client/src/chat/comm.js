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

export class CommSocket {
  ws;
  eventHandlers = {};

  constructor(url, onOpenCallback) {
    this.ws = new WebSocket(url);

    this.ws.onopen = onOpenCallback;

    this.ws.onmessage = (msg) => {
      const msgObj = JSON.parse(msg.data);

      if (msgObj.event) {
        for (let handlerName in this.eventHandlers) {
          const event = this.eventHandlers[handlerName].event;
          const handler = this.eventHandlers[handlerName].handler;

          if (event === msgObj.event) return handler(msgObj.data);
        }
      }
    }
  }

  on(event, handlerName, handler) {
    this.eventHandlers[handlerName] = {
      event,
      handler
    }
  }

  off(handlerName) {
    delete this.eventHandlers[handlerName];
  }

  emit(event, data) {
    this.ws.send(JSON.stringify({
      event,
      data
    }))
  }
}

export function onEvent(ws, event, handler) {
  ws.on('message', (msg) => {
    const msgObj = JSON.parse(msg);

    if (msgObj.event === event) handler(msgObj);
  })
}

export function emit(ws, event, data) {
  ws.send(JSON.stringify({
    event,
    data
  }))
}