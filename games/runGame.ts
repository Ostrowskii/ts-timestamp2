import { StateMachine } from '../StateMachine.ts';
import { ensureTimelineForRoom, runWatchCommand, type WatchOptions } from '../client.ts';
import { registerStateMachine, unregisterStateMachine } from '../stateMachineRegistry.ts';
import type { GameState } from './O1d.ts';
import { initialState, on_post, on_tick, render, ticks_per_second } from './O1d.ts';

const args = process.argv.slice(2);
const roomId = args[0];

const isValidRoomId = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);

if (!roomId) {
  console.error('Uso: npx ts-node games/runGame.ts <room_id>');
  process.exit(1);
}

if (!isValidRoomId(roomId)) {
  console.error('room_id deve conter apenas caracteres hexadecimais.');
  process.exit(1);
}

const timeline = ensureTimelineForRoom(roomId);

const stateMachine = new StateMachine<GameState>(
  {
    initial: initialState,
    on_post,
    on_tick,
    ticks_per_second,
  },
  timeline
);

registerStateMachine(roomId, stateMachine);

let lastRenderedState: GameState | null = null;

const renderIfChanged = () => {
  const state = stateMachine.get_state_at(Date.now());
  if (!lastRenderedState || state.x !== lastRenderedState.x) {
    lastRenderedState = state;
    render(state);
  }
};

renderIfChanged();

const unsubscribeTimeline = timeline.addObserver(() => {
  renderIfChanged();
});

const tickInterval = setInterval(renderIfChanged, 100);

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  clearInterval(tickInterval);
  unsubscribeTimeline();
  unregisterStateMachine(roomId);
};

const watchOptions: WatchOptions = {
  logTimeline: false,
  onShutdown: cleanup,
};

runWatchCommand(roomId, watchOptions);

process.on('exit', cleanup);
