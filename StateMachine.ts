import { Timeline } from './timeline.ts';
import type { TimelineEvent } from './timeline.ts';

export type SMParams<S> = {
  initial: S;
  on_post: (post: { data: unknown }, state: S) => S;
  on_tick: (state: S) => S;
  ticks_per_second: number;
};

type StateSnapshot<S> = {
  eventIndex: number;
  time: number;
  state: S;
  lastTickTime: number;
};

export class StateMachine<S> {
  private readonly params: SMParams<S>;
  private readonly timeline: Timeline;
  private readonly tickDuration: number;
  private readonly checkpoints: Array<StateSnapshot<S>> = [];
  private frontier: StateSnapshot<S>;
  private dirtyFromIndex: number | null = null;

  constructor(params: SMParams<S>, timeline: Timeline) {
    this.params = params;
    this.timeline = timeline;
    this.tickDuration =
      this.params.ticks_per_second > 0
        ? 1000 / this.params.ticks_per_second
        : Number.POSITIVE_INFINITY;

    const initialState = this.cloneState(this.params.initial);
    this.frontier = {
      eventIndex: 0,
      time: 0,
      state: initialState,
      lastTickTime: 0,
    };

  }

  noteTimelineInsertion(insertedIndex: number): void {
    if (insertedIndex < this.frontier.eventIndex) {
      this.dirtyFromIndex =
        this.dirtyFromIndex === null ? insertedIndex : Math.min(this.dirtyFromIndex, insertedIndex);
    }
  }

  get_state_at(targetTime: number): S {
    const events = this.timeline.getSnapshot();
    const startSnapshot = this.selectStartingSnapshot(events, targetTime);

    let state = this.cloneState(startSnapshot.state);
    let lastTickTime = startSnapshot.lastTickTime;
    let currentIndex = Math.min(startSnapshot.eventIndex, events.length);
    let lastProcessedEventTime = startSnapshot.time;

    ({ state, lastTickTime } = this.advanceTicks(state, lastTickTime, lastProcessedEventTime));

    while (currentIndex < events.length) {
      const event = events[currentIndex];
      if (event.time > targetTime) {
        break;
      }

      ({ state, lastTickTime } = this.advanceTicks(state, lastTickTime, event.time));
      lastProcessedEventTime = event.time;
      state = this.params.on_post({ data: event.data }, state);
      currentIndex += 1;
    }

    ({ state, lastTickTime } = this.advanceTicks(state, lastTickTime, targetTime));

    const snapshot: StateSnapshot<S> = {
      eventIndex: currentIndex,
      time: targetTime,
      state: this.cloneState(state),
      lastTickTime,
    };

    this.frontier = snapshot;
    this.maybeStoreCheckpoint(snapshot);

    if (currentIndex >= events.length) {
      this.dirtyFromIndex = null;
    }

    return this.cloneState(state);
  }

  private selectStartingSnapshot(
    events: TimelineEvent[],
    targetTime: number
  ): StateSnapshot<S> {
    if (this.dirtyFromIndex !== null) {
      this.pruneInvalidCheckpoints(this.dirtyFromIndex);
    }

    if (this.dirtyFromIndex === null) {
      if (
        this.frontier.eventIndex <= events.length &&
        this.frontier.time <= targetTime &&
        this.isFrontierCompatible(events)
      ) {
        return this.cloneSnapshot(this.frontier);
      }

      const latestCheckpoint = this.getLatestCheckpoint(events.length, targetTime);
      if (latestCheckpoint) {
        return this.cloneSnapshot(latestCheckpoint);
      }
    } else {
      const checkpoint = this.getLatestCheckpoint(this.dirtyFromIndex, targetTime);
      if (checkpoint) {
        return this.cloneSnapshot(checkpoint);
      }
    }

    const baselineTime =
      events.length > 0 && typeof events[0].time === 'number' ? events[0].time : targetTime;
    const initialState = this.cloneState(this.params.initial);
    return {
      eventIndex: 0,
      time: baselineTime,
      state: initialState,
      lastTickTime: baselineTime,
    };
  }

  private advanceTicks(
    state: S,
    fromTime: number,
    toTime: number
  ): { state: S; lastTickTime: number } {
    if (this.params.ticks_per_second <= 0 || !Number.isFinite(this.tickDuration)) {
      return { state, lastTickTime: toTime };
    }
    if (toTime <= fromTime) {
      return { state, lastTickTime: fromTime };
    }

    const elapsed = toTime - fromTime;
    const ticks = Math.floor((elapsed * this.params.ticks_per_second) / 1000);
    if (ticks <= 0) {
      return { state, lastTickTime: fromTime };
    }

    let nextState = state;
    for (let i = 0; i < ticks; i += 1) {
      nextState = this.params.on_tick(nextState);
    }

    const lastTickTime = fromTime + ticks * this.tickDuration;
    return { state: nextState, lastTickTime };
  }

  private pruneInvalidCheckpoints(cutoffIndex: number): void {
    if (this.checkpoints.length === 0) {
      return;
    }
    const firstInvalid = this.checkpoints.findIndex(
      checkpoint => checkpoint.eventIndex >= cutoffIndex
    );
    if (firstInvalid >= 0) {
      this.checkpoints.splice(firstInvalid);
    }
  }

  private getLatestCheckpoint(
    maxEventIndex: number,
    maxTime: number
  ): StateSnapshot<S> | null {
    for (let i = this.checkpoints.length - 1; i >= 0; i -= 1) {
      const checkpoint = this.checkpoints[i];
      if (checkpoint.eventIndex <= maxEventIndex && checkpoint.time <= maxTime) {
        return checkpoint;
      }
    }
    return null;
  }

  private maybeStoreCheckpoint(snapshot: StateSnapshot<S>): void {
    if (snapshot.eventIndex === 0) {
      return;
    }

    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && last.eventIndex === snapshot.eventIndex && last.time === snapshot.time) {
      return;
    }

    this.checkpoints.push(this.cloneSnapshot(snapshot));

    const MAX_CHECKPOINTS = 20;
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints.shift();
    }
  }

  private isFrontierCompatible(events: TimelineEvent[]): boolean {
    if (this.frontier.eventIndex === 0) {
      if (events.length === 0 && this.frontier.time === 0 && this.frontier.lastTickTime === 0) {
        return false;
      }
      if (events.length === 0) {
        return true;
      }
      const firstEventTime = events[0].time;
      return !(typeof firstEventTime === 'number' && firstEventTime > this.frontier.lastTickTime);
    }
    return true;
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

  private cloneSnapshot(snapshot: StateSnapshot<S>): StateSnapshot<S> {
    return {
      eventIndex: snapshot.eventIndex,
      time: snapshot.time,
      state: this.cloneState(snapshot.state),
      lastTickTime: snapshot.lastTickTime,
    };
  }
}
