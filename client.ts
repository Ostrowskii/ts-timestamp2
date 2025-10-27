import { WebSocket } from 'ws';

const socket = new WebSocket('ws://18.228.238.147:8080');

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

  if (payload.type === 'inform time' && typeof payload.serverTime === 'number') {
    const receiveTime = Date.now();

    if (lastRequestSentAt === null) {
      const deltaDisplay =
        bestEstimatedDelta !== null ? `${bestEstimatedDelta} ms` : 'aguardando delta';
      console.log(
        `Ping: aguardando cálculo | Tempo do servidor: ${payload.serverTime} | Tempo SERVIDOR estimado: ${
          bestEstimatedDelta !== null ? receiveTime + bestEstimatedDelta : 'aguardando delta'
        } | Delta estimado: ${deltaDisplay}`
      );
      return;
    }

    const ping = receiveTime - lastRequestSentAt;
    const localPlusDelta =
      bestEstimatedDelta !== null ? receiveTime + bestEstimatedDelta : 'aguardando delta';
    const deltaDisplay = bestEstimatedDelta !== null ? `${bestEstimatedDelta} ms` : 'aguardando delta';

    console.log(
      `Ping: ${ping} ms | Tempo do servidor: ${payload.serverTime} | Tempo SERVIDOR estimado: ${localPlusDelta} | Delta estimado: ${deltaDisplay}`
    );

    if (ping < bestServerPing) {
      bestServerPing = ping;
      const estimatedMidpointClientTime = lastRequestSentAt + ping / 2;
      bestEstimatedDelta = payload.serverTime - estimatedMidpointClientTime;

      const estimatedServerNow = receiveTime + bestEstimatedDelta;
      console.log(
        `O tempo do servidor é ${estimatedServerNow} (delta estimado: ${bestEstimatedDelta} ms)`
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
