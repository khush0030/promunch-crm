import { describe, expect, it } from 'vitest';
import { inSendWindow, istMidnightUtc, nextSendAt } from './schedule';

// Helper: build a UTC Date for a given IST wall-clock time (IST = UTC+5:30).
function ist(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
}

describe('istMidnightUtc', () => {
  it('returns the UTC instant of the current IST midnight', () => {
    const now = ist(2026, 7, 5, 14, 0);
    expect(istMidnightUtc(now).toISOString()).toBe(ist(2026, 7, 5, 0, 0).toISOString());
  });

  it('rolls to the previous IST day before 05:30 UTC', () => {
    const now = new Date(Date.UTC(2026, 6, 5, 2, 0)); // 07:30 IST Jul 5
    expect(istMidnightUtc(now).toISOString()).toBe(ist(2026, 7, 5, 0, 0).toISOString());
  });
});

describe('inSendWindow', () => {
  it('is closed before start, open at start, open before end, closed at end', () => {
    expect(inSendWindow(ist(2026, 7, 5, 8, 59), 9, 18)).toBe(false);
    expect(inSendWindow(ist(2026, 7, 5, 9, 0), 9, 18)).toBe(true);
    expect(inSendWindow(ist(2026, 7, 5, 17, 59), 9, 18)).toBe(true);
    expect(inSendWindow(ist(2026, 7, 5, 18, 0), 9, 18)).toBe(false);
  });
});

describe('nextSendAt', () => {
  it('waitDays 0 inside the window sends now', () => {
    const now = ist(2026, 7, 5, 11, 0);
    expect(nextSendAt(now, 0, 9, 18).toISOString()).toBe(now.toISOString());
  });

  it('waitDays 0 outside the window clamps to the next window start', () => {
    const now = ist(2026, 7, 5, 20, 0);
    expect(nextSendAt(now, 0, 9, 18).toISOString()).toBe(ist(2026, 7, 6, 9, 0).toISOString());
  });

  it('waitDays 0 before the window opens clamps to today 9:00 IST', () => {
    const now = ist(2026, 7, 5, 6, 0);
    expect(nextSendAt(now, 0, 9, 18).toISOString()).toBe(ist(2026, 7, 5, 9, 0).toISOString());
  });

  it('waitDays N adds days and clamps into the window', () => {
    const now = ist(2026, 7, 5, 20, 0);
    expect(nextSendAt(now, 3, 9, 18).toISOString()).toBe(ist(2026, 7, 9, 9, 0).toISOString());
  });

  it('waitDays N landing inside the window keeps the wall-clock time', () => {
    const now = ist(2026, 7, 5, 11, 30);
    expect(nextSendAt(now, 3, 9, 18).toISOString()).toBe(ist(2026, 7, 8, 11, 30).toISOString());
  });
});
