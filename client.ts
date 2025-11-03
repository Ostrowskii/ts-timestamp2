import { WebSocket } from 'ws';
import { Timeline } from './timeline.ts';
import { getRegisteredStateMachine } from './stateMachineRegistry.ts';


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
    server_received_at?: number;
  };
};

const timelinesByRoom = new Map<string, Timeline>();
export const getTimelineForRoom = (roomId: string) =>
  timelinesByRoom.get(roomId);
export const ensureTimelineForRoom = (roomId: string): Timeline =>
  getOrCreateTimeline(roomId);

const isValidRoomId = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);

const getOrCreateTimeline = (roomId: string): Timeline => {
  let timeline = timelinesByRoom.get(roomId);
  if (!timeline) {
    timeline = new Timeline();
    timelinesByRoom.set(roomId, timeline);
  }
  return timeline;
};

const printRoomEvents = (roomId: string) => {
  const timeline = getOrCreateTimeline(roomId);
  const events = timeline.getSnapshot();
  console.log(`Eventos sala ${roomId}:`);
  console.log(JSON.stringify(events, null, 2));
};

if (import.meta.main) {
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

export type WatchOptions = {
  onTimelineUpdate?: () => void;
  onShutdown?: () => void;
  logTimeline?: boolean;
};

export function runWatchCommand(roomId: string, options: WatchOptions = {}) {
  let socket: WebSocket | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let manualShutdown = false;
  let awaitingResync = false;
  let cleanupExecuted = false;

  const clearReconnectAttempt = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const scheduleReconnect = () => {
    if (manualShutdown || reconnectTimeout) {
      return;
    }
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      console.log('Tentando reconectar ao servidor...');
      connect();
    }, 500);
  };

  const sendPayload = (payload: unknown) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  };

  const requestWatch = () => {
    awaitingResync = false;
    sendPayload({
      type: 'watch',
      room_id: roomId,
    });
  };

  const requestResyncIfNeeded = () => {
    const timeline = timelinesByRoom.get(roomId);
    let since = 0;

    if (timeline) {
      const events = timeline.getSnapshot();
      if (events.length > 0) {
        const last = events[events.length - 1];
        since = last.server_received_at;
      }
    }

    awaitingResync = true;
    sendPayload({
      type: 'resync',
      room_id: roomId,
      since,
    });
  };


  const handlePostMessage = (payload: PostBroadcastPayload) => {
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
    const serverReceivedAt = (message as { server_received_at?: unknown }).server_received_at;
    if (
      typeof message.time !== 'number' ||
      !('data' in message) ||
      typeof serverReceivedAt !== 'number'
    ) {
      return;
    }

    const timeline = getOrCreateTimeline(room);
    const insertion = timeline.add({
      data: (message as { data: unknown }).data,
      time: message.time,
      server_received_at: serverReceivedAt,
    });
    if (insertion.inserted || insertion.replacedExisting) {
      const stateMachine = getRegisteredStateMachine(room);
      if (stateMachine) {
        stateMachine.noteTimelineInsertion(insertion.index);
      }
      if (options.onTimelineUpdate) {
        options.onTimelineUpdate();
      } else if (options.logTimeline !== false) {
        printRoomEvents(room);
      }
    }
  };

  const handleResyncResponse = (payload: {
    type?: string;
    room_id?: string;
    messages?: unknown;
  }) => {
    if (
      payload.type !== 'resync-response' ||
      payload.room_id !== roomId ||
      !Array.isArray(payload.messages)
    ) {
      return;
    }

    const timeline = getOrCreateTimeline(roomId);
    let timelineChanged = false;
    let earliestIndex: number | null = null;
    for (const entry of payload.messages) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { type?: string }).type === 'post' &&
        (entry as { room_id?: string }).room_id === roomId
      ) {
        const message = (
          entry as { message?: { data?: unknown; time?: number; server_received_at?: number } }
        ).message;
        if (
          message &&
          typeof message === 'object' &&
          'data' in message &&
          typeof (message as { time?: unknown }).time === 'number' &&
          typeof (message as { server_received_at?: unknown }).server_received_at === 'number'
        ) {
          const insertion = timeline.add({
            data: (message as { data: unknown }).data,
            time: (message as { time: number }).time,
            server_received_at: (message as { server_received_at: number }).server_received_at,
          });
          if (insertion.inserted || insertion.replacedExisting) {
            timelineChanged = true;
            earliestIndex =
              earliestIndex === null ? insertion.index : Math.min(earliestIndex, insertion.index);
          }
        }
      }
    }

    if (timelineChanged) {
      if (earliestIndex !== null) {
        const stateMachine = getRegisteredStateMachine(roomId);
        if (stateMachine) {
          stateMachine.noteTimelineInsertion(earliestIndex);
        }
      }
      if (options.onTimelineUpdate) {
        options.onTimelineUpdate();
      } else if (options.logTimeline !== false) {
        printRoomEvents(roomId);
      }
    }
    awaitingResync = false;
    requestWatch();
  };

  const connect = () => {
    socket = new WebSocket(SERVER_URL);

    socket.on('open', () => {
      console.log(`Conexão estabelecida com ${SERVER_URL} - assistindo sala ${roomId}`);
      requestResyncIfNeeded();
    });

    socket.on('message', rawData => {
      const messageText = rawData.toString();
      let payload: unknown;
      try {
        payload = JSON.parse(messageText);
      } catch {
        console.log(`Mensagem não JSON recebida: ${messageText}`);
        return;
      }

      if (payload && typeof payload === 'object') {
        handlePostMessage(payload as PostBroadcastPayload);
        handleResyncResponse(payload as { type?: string; room_id?: string; messages?: unknown });
      }
    });

    socket.on('close', () => {
      console.log('Connection closed');
      if (!manualShutdown) {
        awaitingResync = false;
        scheduleReconnect();
      }
    });

    socket.on('error', err => {
      console.error('WebSocket connection error:', err);
    });
  };

  const stopWatching = () => {
    manualShutdown = true;
    awaitingResync = false;
    clearReconnectAttempt();
    if (!cleanupExecuted) {
      cleanupExecuted = true;
      if (options.onShutdown) {
        options.onShutdown();
      }
    }
    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      sendPayload({
        type: 'unwatch',
        room_id: roomId,
      });
      socket.close();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  connect();

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

export function runPostCommand(roomId: string, messageData: string) {
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
    const timeline = getOrCreateTimeline(roomId);
    const localInsertion = timeline.add({
      data: messageData,
      time: messageTime,
      server_received_at: Number.POSITIVE_INFINITY,
    });
    if (localInsertion.inserted || localInsertion.replacedExisting) {
      const stateMachine = getRegisteredStateMachine(roomId);
      if (stateMachine) {
        stateMachine.noteTimelineInsertion(localInsertion.index);
      }
      console.log('Ação aplicada localmente na timeline enquanto aguarda confirmação do servidor.');
      printRoomEvents(roomId);
    }

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
