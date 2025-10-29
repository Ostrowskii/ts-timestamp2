import { WebSocket } from 'ws';

const SERVER_URL = process.env.SERVER_URL ?? 'ws://18.228.238.147:8080';

type InformTimePayload = {
  type?: string;
  serverTime?: number;
};

type PostBroadcastPayload = {
  type?: string;
  room_id?: string;
  message?: {
    data?: unknown;
    time?: number;
  };
};

const isValidRoomId = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);

const args = process.argv.slice(2);

if (args.length === 0) {
  runTimeSynchronization();
} else {
  const command = args[0];
  switch (command) {
    case 'post': {
      const roomId = args[1];
      const messageData = args.slice(2).join(' ');
      if (!roomId || !messageData) {
        console.error('Uso: npx ts-node client.ts post <room_id> <mensagem>');
        process.exit(1);
      }
      if (!isValidRoomId(roomId)) {
        console.error('room_id deve conter apenas caracteres hexadecimais.');
        process.exit(1);
      }
      runPostCommand(roomId, messageData);
      break;
    }
    case 'watch': {
      const roomId = args[1];
      if (!roomId) {
        console.error('Uso: npx ts-node client.ts watch <room_id>');
        process.exit(1);
      }
      if (!isValidRoomId(roomId)) {
        console.error('room_id deve conter apenas caracteres hexadecimais.');
        process.exit(1);
      }
      runWatchCommand(roomId);
      break;
    }
    default:
      console.error(`Comando desconhecido: ${command}`);
      process.exit(1);
  }
}

function runTimeSynchronization() {
  const socket = new WebSocket(SERVER_URL);

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastRequestSentAt: number | null = null;
  let bestServerPing = Number.POSITIVE_INFINITY;
  let bestEstimatedDelta: number | null = null;

  const requestServerTime = () => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    lastRequestSentAt = Date.now();
    const payload = {
      type: 'get time',
      clientTime: lastRequestSentAt,
    };
    socket.send(JSON.stringify(payload));
  };

  const stopStreaming = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };

  socket.on('open', () => {
    console.log(
      `Conexão estabelecida com ${SERVER_URL} - iniciando requisições de horário a cada 1 segundo`
    );
    requestServerTime();
    intervalId = setInterval(requestServerTime, 1000);
  });

  socket.on('message', rawData => {
    const messageText = rawData.toString();
    let payload: InformTimePayload = {};

    try {
      payload = JSON.parse(messageText);
    } catch {
      console.log(`Mensagem não JSON recebida: ${messageText}`);
      return;
    }

    if (payload.type === 'inform time' && typeof payload.serverTime === 'number') {
      const receiveTime = Date.now();
      const estimatedServerDisplay =
        bestEstimatedDelta !== null ? receiveTime + bestEstimatedDelta : 'aguardando delta';

      console.log(`Tempo estimado do servidor: ${estimatedServerDisplay}`);

      if (lastRequestSentAt === null) {
        return;
      }

      const ping = receiveTime - lastRequestSentAt;

      if (ping < bestServerPing) {
        bestServerPing = ping;
        const estimatedMidpointClientTime = lastRequestSentAt + ping / 2;
        bestEstimatedDelta = payload.serverTime - estimatedMidpointClientTime;

        const estimatedServerNow = receiveTime + bestEstimatedDelta;
        console.log(
          `Novo melhor ping: ${bestServerPing} ms | O tempo do servidor é ${estimatedServerNow} | Delta estimado: ${bestEstimatedDelta} ms`
        );
      }
    }
  });

  socket.on('close', () => {
    console.log('Connection closed');
    stopStreaming();
  });

  socket.on('error', err => {
    console.error('WebSocket connection error:', err);
    stopStreaming();
  });

  process.on('SIGINT', () => {
    console.log('Received SIGINT - shutting down client');
    stopStreaming();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM - shutting down client');
    stopStreaming();
    process.exit(0);
  });
}

function runWatchCommand(roomId: string) {
  const socket = new WebSocket(SERVER_URL);
  const eventsByRoom = new Map<string, Array<{ data: unknown; time: number }>>();

  const stopWatching = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };

  socket.on('open', () => {
    console.log(`Conexão estabelecida com ${SERVER_URL} - assistindo sala ${roomId}`);
    socket.send(
      JSON.stringify({
        type: 'watch',
        room_id: roomId,
      })
    );
  });

  socket.on('message', rawData => {
    const messageText = rawData.toString();
    let payload: PostBroadcastPayload = {};

    try {
      payload = JSON.parse(messageText);
    } catch {
      console.log(`Mensagem não JSON recebida: ${messageText}`);
      return;
    }

    if (
      payload.type !== 'post' ||
      typeof payload.room_id !== 'string' ||
      !payload.message ||
      typeof payload.message !== 'object'
    ) {
      return;
    }

    const room = payload.room_id;
    const { message } = payload;

    if (typeof message.time !== 'number' || !('data' in message)) {
      return;
    }

    let eventList = eventsByRoom.get(room);
    if (!eventList) {
      eventList = [];
      eventsByRoom.set(room, eventList);
    }

    const newEvent = {
      data: (message as { data: unknown }).data,
      time: message.time,
    };

    if (eventList.length === 0 || newEvent.time > eventList[eventList.length - 1].time) {
      eventList.push(newEvent);
    } else {
      const insertIndex = eventList.findIndex(existingEvent => newEvent.time <= existingEvent.time);
      const targetIndex = insertIndex === -1 ? eventList.length : insertIndex;
      eventList.splice(targetIndex, 0, newEvent);
    }

    console.log(`Eventos sala ${room}:`);
    console.log(JSON.stringify(eventList, null, 2));
  });

  socket.on('close', () => {
    console.log('Connection closed');
  });

  socket.on('error', err => {
    console.error('WebSocket connection error:', err);
  });

  process.on('SIGINT', () => {
    console.log('Received SIGINT - shutting down watch client');
    stopWatching();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM - shutting down watch client');
    stopWatching();
    process.exit(0);
  });
}

function runPostCommand(roomId: string, messageData: string) {
  const socket = new WebSocket(SERVER_URL);

  let lastRequestSentAt: number | null = null;
  let deltaEstimate: number | null = null;
  let postSent = false;

  const sendPostMessage = () => {
    if (postSent || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    postSent = true;
    const messageTime = Math.round(Date.now() + (deltaEstimate ?? 0));
    const payload = {
      type: 'post',
      room_id: roomId,
      message: {
        data: messageData,
        time: messageTime,
      },
    };

    socket.send(JSON.stringify(payload), err => {
      if (err) {
        console.error('Falha ao enviar mensagem post:', err);
        process.exitCode = 1;
      } else {
        console.log('Mensagem post enviada com sucesso');
      }

      setTimeout(() => socket.close(), 100);
    });
  };

  socket.on('open', () => {
    console.log(`Conexão estabelecida com ${SERVER_URL} - obtendo horário antes de enviar post`);
    lastRequestSentAt = Date.now();
    socket.send(
      JSON.stringify({
        type: 'get time',
        clientTime: lastRequestSentAt,
      })
    );

    setTimeout(() => {
      if (!postSent) {
        console.warn('Servidor não respondeu a tempo; usando relógio local.');
        sendPostMessage();
      }
    }, 500);
  });

  socket.on('message', rawData => {
    if (postSent) {
      return;
    }

    const messageText = rawData.toString();
    let payload: InformTimePayload = {};

    try {
      payload = JSON.parse(messageText);
    } catch {
      return;
    }

    if (payload.type === 'inform time' && typeof payload.serverTime === 'number') {
      if (lastRequestSentAt === null) {
        return;
      }
      const receiveTime = Date.now();
      const ping = receiveTime - lastRequestSentAt;
      const estimatedMidpointClientTime = lastRequestSentAt + ping / 2;
      deltaEstimate = payload.serverTime - estimatedMidpointClientTime;
      sendPostMessage();
    }
  });

  socket.on('close', () => {
    if (!postSent) {
      console.error('Conexão encerrada antes do envio da mensagem.');
      process.exitCode = 1;
    } else {
      console.log('Conexão encerrada');
    }
  });

  socket.on('error', err => {
    console.error('WebSocket connection error:', err);
    process.exitCode = 1;
  });
}
