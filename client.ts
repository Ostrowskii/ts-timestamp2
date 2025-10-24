import { WebSocket } from 'ws';

const socket = new WebSocket('ws://18.228.238.147:8080');

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastRequestSentAt: number | null = null;
let bestServerPing = Number.POSITIVE_INFINITY;

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
  console.log(`Solicitado horário ao servidor às ${lastRequestSentAt}`);
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
  console.log('Conexão estabelecida - iniciando requisições de horário a cada 1 segundo');
  requestServerTime();
  intervalId = setInterval(requestServerTime, 1000);
});

socket.on('message', rawData => {
  const messageText = rawData.toString();
  let payload: { type?: string; serverTime?: number } = {};

  try {
    payload = JSON.parse(messageText);
  } catch {
    console.log(`Mensagem não JSON recebida: ${messageText}`);
    return;
  }

  if (payload.type === 'inform time') {
    const receiveTime = Date.now();
    console.log(`Servidor informou horário: ${payload.serverTime}`);

    if (lastRequestSentAt !== null && typeof payload.serverTime === 'number') {
      const ping = receiveTime - lastRequestSentAt;
      const estimatedServerTime = payload.serverTime - ping / 2;
      console.log(
        `Ping atual: ${ping} ms | Horário estimado do servidor no envio: ${estimatedServerTime}`
      );

      if (ping < bestServerPing) {
        bestServerPing = ping;
        console.log(`server ping menor é de ${bestServerPing} ms`);
      }
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
