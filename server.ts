import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const port = 8080;
const wss = new WebSocketServer({ port });
const DB_DIRECTORY = path.join(process.cwd(), 'db');
const watching = new Map<string, Set<WebSocket>>();

const isValidRoomId = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);
const getRoomFilePath = (roomId: string) => path.join(DB_DIRECTORY, `${roomId}.jsonl`);

const persistEntry = async (roomId: string, entry: unknown) => {
  try {
    const serialized = JSON.stringify(entry);
    if (serialized === undefined) {
      throw new Error('Entrada não serializável em JSON');
    }

    await fs.mkdir(DB_DIRECTORY, { recursive: true });
    const filePath = getRoomFilePath(roomId);
    await fs.appendFile(filePath, `${serialized}\n`, { encoding: 'utf8' });
  } catch (error) {
    console.error(`Falha ao persistir mensagem da sala ${roomId}`, error);
  }
};

const loadMessagesSince = async (roomId: string, since: number) => {
  const filePath = getRoomFilePath(roomId);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const messages: Array<unknown> = [];
    for (const line of data.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        let messageTime: number | undefined;
        if (typeof parsed === 'object' && parsed !== null) {
          const maybeMessage = (parsed as { message?: unknown }).message;
          if (maybeMessage && typeof maybeMessage === 'object') {
            const maybeTime = (maybeMessage as { time?: unknown }).time;
            if (typeof maybeTime === 'number') {
              messageTime = maybeTime;
            }
          }
        }

        if (typeof messageTime === 'number' && messageTime >= since) {
          messages.push(parsed);
        }
      } catch (error) {
        console.warn(`Linha inválida ao processar histórico da sala ${roomId}: ${line}`, error);
      }
    }
    return messages;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    console.error(`Falha ao carregar histórico da sala ${roomId}`, error);
    return [];
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

    if (payload.type === 'resync') {
      const roomId = typeof payload.room_id === 'string' ? payload.room_id : '';
      const sinceField = (payload as { since?: unknown }).since;
      const since =
        typeof sinceField === 'number' && Number.isFinite(sinceField) ? sinceField : null;

      if (!roomId || !isValidRoomId(roomId) || since === null) {
        console.warn('Mensagem resync ignorada: parâmetros inválidos.');
        return;
      }

      void (async () => {
        const messages = await loadMessagesSince(roomId, since);
        const response = {
          type: 'resync-response' as const,
          room_id: roomId,
          messages,
        };
        socket.send(JSON.stringify(response));
      })();
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
