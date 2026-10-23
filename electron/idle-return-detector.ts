/** Detect return to desktop input without treating failed reads as activity. */
export class IdleReturnDetector {
  private _previous: { duration: number; sampledAt: number } | null = null;

  constructor(private readonly _minimumIdleTime: number) {}

  sample(duration: number, sampledAt: number): number | null {
    // Existing idle providers return zero on failure. Wait for a successful
    // positive reading instead of freezing a review on an ambiguous zero.
    if (!Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    const previous = this._previous;
    this._previous = { duration, sampledAt };
    if (
      previous &&
      previous.duration >= this._minimumIdleTime &&
      duration < previous.duration
    ) {
      // Subtract the time since the input event, so the polling delay is not
      // counted as part of the absence being reviewed.
      return Math.max(
        previous.duration,
        previous.duration + sampledAt - previous.sampledAt - duration,
      );
    }
    return null;
  }
}
