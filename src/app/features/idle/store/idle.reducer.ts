import { createReducer, on } from '@ngrx/store';
import { freezeIdleTime, resetIdle, setIdleTime, triggerIdle } from './idle.actions';

export const IDLE_FEATURE_KEY = 'idle';

export interface IdleState {
  isIdle: boolean;
  idleTime: number;
  isIdleTimeFrozen: boolean;
}

export const initialIdleState: IdleState = {
  isIdle: false,
  idleTime: 0,
  isIdleTimeFrozen: false,
};

export const idleReducer = createReducer(
  initialIdleState,

  on(triggerIdle, (state, { idleTime }) => ({
    ...state,
    isIdle: true,
    idleTime,
    isIdleTimeFrozen: false,
  })),
  on(resetIdle, () => ({ ...initialIdleState })),
  on(freezeIdleTime, (state, { idleTime }) =>
    state.isIdle && !state.isIdleTimeFrozen
      ? { ...state, idleTime, isIdleTimeFrozen: true }
      : state,
  ),
  on(setIdleTime, (state, { idleTime }) =>
    state.isIdleTimeFrozen ? state : { ...state, idleTime },
  ),
);
