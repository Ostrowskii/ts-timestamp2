import { initStateMachine } from './StateMachine.ts';
import type { SMParams } from './StateMachine.ts';
import { Timeline } from './timeline.ts';

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
  const nextState = { ...state };

  if (post.data === 'up-pressed') {
    nextState.up = true;
  }
  if (post.data === 'up-released') {
    nextState.up = false;
  }
  if (post.data === 'down-pressed') {
    nextState.down = true;
  }
  if (post.data === 'down-released') {
    nextState.down = false;
  }

  return nextState;
};

const onTick: SMParams<State>['on_tick'] = state => {
  const nextState = { ...state };

  if (state.up) {
    nextState.pos += 1;
  }
  if (state.down) {
    nextState.pos -= 1;
  }

  return nextState;
};

const params: SMParams<State> = {
  room_id: 'ball_1d_game',
  initial: initialState,
  on_post: onPost,
  on_tick: onTick,
  ticks_per_second: 24,
};

const timeline = new Timeline();
const sm = initStateMachine(params, timeline);

setInterval(() => {
  const state = sm.get_state_at(Date.now());
  console.log(state.pos);
}, 1000);
