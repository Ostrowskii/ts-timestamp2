import { WebSocketServer } from 'ws';

const port = 8080;
const wss = new WebSocketServer({ port });

wss.on('listening', () => {
  console.log(`WebSocket server listening on ws://localhost:${port}`);
});

wss.on('connection', socket => {
  console.log('Client connected');
  socket.on('message', data => {
    console.log(`Received: ${data}`);
  });
  socket.on('close', () => {
    console.log('Client disconnected');
  });
});
