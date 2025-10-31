export type TimelineEvent = {
  data: unknown;
  time: number;
  server_received_at: number;
};

export class Timeline {
  private events: TimelineEvent[] = [];

  add(event: TimelineEvent): void {
    const serializedData = JSON.stringify(event.data);
    const alreadyExists = this.events.some(
      existing => existing.time === event.time && JSON.stringify(existing.data) === serializedData
    );
    if (alreadyExists) {
      return;
    }

    if (this.events.length === 0 || event.time >= this.events[this.events.length - 1].time) {
      this.events.push(event);
      return;
    }

    const insertIndex = this.events.findIndex(existing => event.time <= existing.time);
    const targetIndex = insertIndex === -1 ? this.events.length : insertIndex;
    this.events.splice(targetIndex, 0, event);
  }

  getSnapshot(): TimelineEvent[] {
    return this.events.map(event => ({ ...event }));
  }
}
