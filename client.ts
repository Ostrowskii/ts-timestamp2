import { WebSocket } from 'ws';

const message = process.argv[2] ?? 'Hello from client';
const socket = new WebSocket('ws://localhost:8080');

socket.on('open', () => {
  socket.send(message);
  console.log(`Sent: ${message}`);
  socket.close();
});

socket.on('error', err => {
  console.error('WebSocket connection error:', err);
});
