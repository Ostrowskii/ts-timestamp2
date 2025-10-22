import { WebSocketServer } from 'ws';

const port = 8080;
const wss = new WebSocketServer({ port });

wss.on('listening', () => {
  console.log(`WebSocket server listening on ws://localhost:${port}`);
});

wss.on('connection', socket => {
  console.log('Client connected');
  socket.on('message', rawData => {
    const messageText = rawData.toString();
    console.log(`Received: ${messageText}`);

    let payload: { type?: string } = {};
    try {
      payload = JSON.parse(messageText);
    } catch {
      // Non-JSON payloads are ignored beyond logging.
    }

    if (payload.type === 'get time') {
      const response = {
        type: 'inform time',
        serverTime: Date.now(),
      };
      socket.send(JSON.stringify(response));
    }
  });
  socket.on('close', () => {
    console.log('Client disconnected');
  });
});
