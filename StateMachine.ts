import { Timeline } from './timeline.ts';

export type SMParams<S> = {
  room_id: string;
  initial: S;
  on_post: (event: { data: unknown; time: number }, state: S) => S;
  on_tick: (state: S) => S;
  ticks_per_second: number;
};

export type StateMachine<S> = {
  get_state_at: (time: number) => S;
};

export function initStateMachine<S>(params: SMParams<S>, timeline: Timeline): StateMachine<S> {
  let currentState: S = params.initial;
  let lastSimulationTime = 0;
  let lastEventIndex = 0;

  const tickDuration = 1000 / params.ticks_per_second;

  return {
    get_state_at(targetTime: number): S {
      const events = timeline.getSnapshot();

      while (lastEventIndex < events.length && events[lastEventIndex].time <= targetTime) {
        const event = events[lastEventIndex];
        currentState = params.on_post({ data: event.data, time: event.time }, currentState);
        lastEventIndex++;
      }

      while (lastSimulationTime + tickDuration <= targetTime) {
        currentState = params.on_tick(currentState);
        lastSimulationTime += tickDuration;
      }

      return currentState;
    }
  };
}
