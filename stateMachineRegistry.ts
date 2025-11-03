import type { StateMachine } from './StateMachine.ts';

const registry = new Map<string, StateMachine<unknown>>();

export const registerStateMachine = <S>(roomId: string, machine: StateMachine<S>): void => {
  registry.set(roomId, machine as StateMachine<unknown>);
};

export const unregisterStateMachine = (roomId: string): void => {
  registry.delete(roomId);
};

export const getRegisteredStateMachine = (roomId: string): StateMachine<unknown> | undefined => {
  return registry.get(roomId);
};
