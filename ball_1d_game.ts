import { StateMachine } from './StateMachine.ts';
import type { SMParams } from './StateMachine.ts';
import { getTimelineForRoom } from './client.ts'; // <-- IMPORTANTE

type State = {
  pos: number;
  up: boolean;
  down: boolean;
};

const initialState: State = {
  pos: 0,
  up: false,
  down: false,
};

const onPost: SMParams<State>['on_post'] = (post, state) => {
  if (post.data === 'up-pressed')   return { ...state, up: true };
  if (post.data === 'up-released')  return { ...state, up: false };
  if (post.data === 'down-pressed') return { ...state, down: true };
  if (post.data === 'down-released')return { ...state, down: false };
  return state;
};

const onTick: SMParams<State>['on_tick'] = state => ({
  pos: state.pos + (state.up ? 1 : 0) - (state.down ? 1 : 0),
  up: state.up,
  down: state.down,
});

const room_id = "a1b2c3";

// <- PEGA o timeline do watcher
const timeline = getTimelineForRoom(room_id);
if (!timeline) {
  console.log("Nenhum timeline ativo para essa sala. Rode:");
  console.log(`  npx ts-node client.ts watch ${room_id}`);
  process.exit(1);
}

const params: SMParams<State> = {
  initial: initialState,
  on_post: onPost,
  on_tick: onTick,
  ticks_per_second: 24,
};

const sm = new StateMachine(params, timeline);

setInterval(() => {
  const state = sm.get_state_at(Date.now());
  console.log(state.pos);
}, 1000);
