import { idleReducer, initialIdleState } from './idle.reducer';
import { resetIdle, setIdleTime, triggerIdle } from './idle.actions';

const freeze = (idleTime: number): { type: string; idleTime: number } => ({
  type: '[Idle] Freeze idle time',
  idleTime,
});

describe('idle review duration', () => {
  it('captures the ended period while keeping the review open', () => {
    const idle = idleReducer(initialIdleState, triggerIdle({ idleTime: 120000 }));
    const frozen = idleReducer(idle, freeze(179000));
    expect(frozen.isIdle).toBeTrue();
    expect(frozen.idleTime).toBe(179000);
  });
  it('ignores late timer ticks and repeated return events after freezing', () => {
    const idle = idleReducer(initialIdleState, triggerIdle({ idleTime: 120000 }));
    const frozen = idleReducer(idle, freeze(179000));
    expect(idleReducer(frozen, setIdleTime({ idleTime: 300000 }))).toEqual(frozen);
    expect(idleReducer(frozen, freeze(999999))).toEqual(frozen);
  });
  it('allows the next idle episode to count after explicit review completion', () => {
    const frozen = idleReducer(
      idleReducer(initialIdleState, triggerIdle({ idleTime: 120000 })),
      freeze(179000),
    );
    const next = idleReducer(
      idleReducer(frozen, resetIdle()),
      triggerIdle({ idleTime: 60000 }),
    );
    expect(idleReducer(next, setIdleTime({ idleTime: 61000 })).idleTime).toBe(61000);
  });
  it('does not freeze an inactive review', () => {
    expect(idleReducer(initialIdleState, freeze(120000))).toEqual(initialIdleState);
  });
});
