import { WebSocket } from 'ws';

const message = process.argv[2] ?? 'Hello from client';
const socket = new WebSocket('ws://localhost:8080');

let intervalId: ReturnType<typeof setInterval> | null = null;

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
  socket.send(message);
  console.log(`Sent: ${message}`);
  console.log('Streaming timestamps to server every millisecond');

  intervalId = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      const timestamp = Date.now();
      socket.send(timestamp.toString());
      console.log(`Timestamp sent: ${timestamp}`);
    }
  }, 1);
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
