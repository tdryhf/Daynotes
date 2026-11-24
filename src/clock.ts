/**
 * Edit times for shared records. When two devices change the same record, the copy with the later
 * edit time wins, so the times follow the server's clock rather than this device's, which may be set
 * wrong. Until the server has been reached, the device's own clock is used.
 */

/** Differences smaller than this are ordinary network jitter, not a wrong clock. */
const SKEW_TOLERANCE_MS = 5_000;
/** A measurement that took longer than this can't place the server's time precisely enough. */
const MAX_ROUND_TRIP_MS = 10_000;

export function createClock(readDeviceTime: () => number = Date.now) {
  let offsetMs = 0;
  let lastStamp = Number.NEGATIVE_INFINITY;
  return {
    /** The current time on the server's clock, always later than any stamp handed out before. */
    stamp() {
      lastStamp = Math.max(lastStamp + 1, Math.round(readDeviceTime() + offsetMs));
      return lastStamp;
    },
    /** Updates how far this device's clock is from the server's, from a request sent at `sentAt` and answered at `receivedAt` (device time). */
    learnServerTime(serverMs: number, sentAt: number, receivedAt: number) {
      if (!Number.isFinite(serverMs) || receivedAt < sentAt || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;
      const skew = serverMs - (sentAt + receivedAt) / 2;
      offsetMs = Math.abs(skew) > SKEW_TOLERANCE_MS ? skew : 0;
    },
  };
}

const clock = createClock();
/** Edit time for a shared record (`updatedAt`, `deletedAt`). */
export const editTime = clock.stamp;
export const learnServerTime = clock.learnServerTime;
