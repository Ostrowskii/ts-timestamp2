import { Timeline } from './timeline.ts';

export type SMParams<S> = {
  initial: S;
  on_post: (post: { data: unknown }, state: S) => S;
  on_tick: (state: S) => S;
  ticks_per_second: number;
};

export class StateMachine<S> {
  private readonly params: SMParams<S>;
  private readonly timeline: Timeline;

  constructor(params: SMParams<S>, timeline: Timeline) {
    this.params = params;
    this.timeline = timeline;
  }

  get_state_at(time: number): S {
    const events = this.timeline.getSnapshot().filter(event => event.time <= time);

    let state = this.cloneState(this.params.initial);

    for (const event of events) {
      state = this.params.on_post({ data: event.data }, state);
    }

    if (events.length === 0) {
      return state;
    }

    const firstEventTime = events[0].time;
    if (typeof firstEventTime !== 'number') {
      return state;
    }

    const ticks =
      firstEventTime <= time
        ? Math.floor(((time - firstEventTime) * this.params.ticks_per_second) / 1000)
        : 0;

    for (let i = 0; i < ticks; i += 1) {
      state = this.params.on_tick(state);
    }

    return state;
  }

  private cloneState(value: S): S {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    if (Array.isArray(value)) {
      return [...value] as unknown as S;
    }
    if (value && typeof value === 'object') {
      return { ...(value as Record<string, unknown>) } as S;
    }
    return value;
  }
}
