export type TimelineEvent = {
  data: unknown;
  time: number;
  server_received_at: number;
};

export type TimelineInsertionResult = {
  index: number;
  inserted: boolean;
  replacedExisting: boolean;
  event: TimelineEvent;
};

type TimelineObserver = (result: TimelineInsertionResult) => void;

export class Timeline {
  private events: TimelineEvent[] = [];
  private observers: Set<TimelineObserver> = new Set();

  add(event: TimelineEvent): TimelineInsertionResult {
    const serializedData = JSON.stringify(event.data);
    const existingIndex = this.events.findIndex(
      existing =>
        existing.time === event.time && JSON.stringify(existing.data) === serializedData
    );

    if (existingIndex !== -1) {
      const existingEvent = this.events[existingIndex];
      const shouldReplace =
        Number.isFinite(event.server_received_at) &&
        (!Number.isFinite(existingEvent.server_received_at) ||
          event.server_received_at < existingEvent.server_received_at);

      if (shouldReplace) {
        this.events[existingIndex] = { ...event };
      }

      return {
        index: existingIndex,
        inserted: false,
        replacedExisting: shouldReplace,
        event: this.events[existingIndex],
      };
    }

    const storedEvent = { ...event };

    if (this.events.length === 0 || event.time >= this.events[this.events.length - 1].time) {
      this.events.push(storedEvent);
      const result: TimelineInsertionResult = {
        index: this.events.length - 1,
        inserted: true,
        replacedExisting: false,
        event: storedEvent,
      };
      this.notifyObservers(result);
      return result;
    }

    const insertIndex = this.events.findIndex(existing => event.time <= existing.time);
    const targetIndex = insertIndex === -1 ? this.events.length : insertIndex;
    this.events.splice(targetIndex, 0, storedEvent);

    const result: TimelineInsertionResult = {
      index: targetIndex,
      inserted: true,
      replacedExisting: false,
      event: storedEvent,
    };
    this.notifyObservers(result);
    return result;
  }

  addObserver(observer: TimelineObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  getSnapshot(): TimelineEvent[] {
    return this.events.map(event => ({ ...event }));
  }

  private notifyObservers(result: TimelineInsertionResult): void {
    if (!result.inserted) {
      return;
    }

    for (const observer of this.observers) {
      observer({
        index: result.index,
        inserted: true,
        replacedExisting: false,
        event: { ...result.event },
      });
    }
  }
}
