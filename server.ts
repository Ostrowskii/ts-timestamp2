import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const port = 8080;
const wss = new WebSocketServer({ port });
const DB_DIRECTORY = path.join(process.cwd(), 'db');
const watching = new Map<string, Set<WebSocket>>();

const isValidRoomId = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);

const persistEntry = async (roomId: string, entry: unknown) => {
  try {
    const serialized = JSON.stringify(entry);
    if (serialized === undefined) {
      throw new Error('Entrada não serializável em JSON');
    }

    await fs.mkdir(DB_DIRECTORY, { recursive: true });
    const filePath = path.join(DB_DIRECTORY, `${roomId}.jsonl`);
    await fs.appendFile(filePath, `${serialized}\n`, { encoding: 'utf8' });
  } catch (error) {
    console.error(`Falha ao persistir mensagem da sala ${roomId}`, error);
  }
};

wss.on('listening', () => {
  console.log(`WebSocket server listening on ws://localhost:${port}`);
});

wss.on('connection', socket => {
  console.log('Client connected');

  socket.on('message', rawData => {
    const messageText = rawData.toString();
    console.log(`Received: ${messageText}`);

    let payload: {
      type?: string;
      room_id?: string;
      message?: unknown;
    } = {};

    try {
      payload = JSON.parse(messageText);
    } catch {
      // Ignora payload não JSON além do log acima.
    }

    if (payload.type === 'get time') {
      const response = {
        type: 'inform time',
        serverTime: Date.now(),
      };
      socket.send(JSON.stringify(response));
      return;
    }

    if (payload.type === 'watch') {
      const roomId = typeof payload.room_id === 'string' ? payload.room_id : '';
      if (!roomId || !isValidRoomId(roomId)) {
        console.warn('Mensagem watch ignorada: room_id inválido ou ausente.');
        return;
      }

      let watchersForRoom = watching.get(roomId);
      if (!watchersForRoom) {
        watchersForRoom = new Set<WebSocket>();
        watching.set(roomId, watchersForRoom);
      }
      watchersForRoom.add(socket);
      return;
    }

    if (payload.type === 'unwatch') {
      const roomId = typeof payload.room_id === 'string' ? payload.room_id : '';
      if (!roomId || !isValidRoomId(roomId)) {
        console.warn('Mensagem unwatch ignorada: room_id inválido ou ausente.');
        return;
      }

      const watchersForRoom = watching.get(roomId);
      if (!watchersForRoom) {
        return;
      }

      watchersForRoom.delete(socket);
      if (watchersForRoom.size === 0) {
        watching.delete(roomId);
      }

      return;
    }

    if (payload.type === 'post') {
      const roomId = typeof payload.room_id === 'string' ? payload.room_id : '';
      if (!roomId || !isValidRoomId(roomId)) {
        console.warn('Mensagem post ignorada: room_id inválido ou ausente.');
        return;
      }

      const originalMessage = payload.message;
      if (!originalMessage || typeof originalMessage !== 'object') {
        console.warn(`Mensagem post ignorada: message inválida para sala ${roomId}.`);
        return;
      }

      const outboundPayload = {
        type: 'post',
        room_id: roomId,
        message: originalMessage,
      };
      const outbound = JSON.stringify(outboundPayload);

      const watchersForRoom = watching.get(roomId);
      if (watchersForRoom && watchersForRoom.size > 0) {
        for (const clientSocket of watchersForRoom) {
          if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(outbound);
          }
        }
      }

      void persistEntry(roomId, outboundPayload);
      return;
    }
  });

  socket.on('close', () => {
    console.log('Client disconnected');
    for (const [roomId, sockets] of watching.entries()) {
      if (sockets.delete(socket) && sockets.size === 0) {
        watching.delete(roomId);
      }
    }
  });
});
