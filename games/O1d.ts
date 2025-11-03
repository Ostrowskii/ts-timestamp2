export type GameState = {
  x: number;
};

const clamp = (value: number): number => Math.max(0, Math.min(9, value));

export const initialState: GameState = { x: 5 };

export const on_post = (
  post: { data: unknown },
  state: GameState
): GameState => {
  if (post.data === 'up-pressed') {
    return { x: clamp(state.x - 1) };
  }
  if (post.data === 'down-pressed') {
    return { x: clamp(state.x + 1) };
  }
  return state;
};

export const on_tick = (state: GameState): GameState => state;

export const render = (state: GameState): void => {
  console.clear();
  for (let row = 0; row < 10; row += 1) {
    console.log(row === state.x ? 'X' : ' ');
  }
};

export const ticks_per_second = 0;
