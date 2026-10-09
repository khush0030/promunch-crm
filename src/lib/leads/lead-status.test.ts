import { describe, expect, it } from 'vitest';
import { LEAD_STATUSES, STAGES, stageCounts, stageOf } from './lead-status';
import { isMissingSchema } from './schema-errors';

describe('lead-status', () => {
  it('maps every lead status to exactly one plain stage', () => {
    for (const s of LEAD_STATUSES) {
      const owners = Object.values(STAGES).filter((st) => (st.statuses as string[]).includes(s));
      expect(owners, s).toHaveLength(1);
    }
  });

  it('uses the owner colour code', () => {
    expect(STAGES[stageOf('no_contacts')].tone).toBe('grey');
    expect(STAGES[stageOf('ready')].tone).toBe('blue');
    expect(STAGES[stageOf('drafted')].tone).toBe('amber');
    expect(STAGES[stageOf('contacted')].tone).toBe('green');
    expect(STAGES[stageOf('replied')].tone).toBe('purple');
    expect(STAGES[stageOf('bounced')].tone).toBe('red');
    expect(STAGES[stageOf('skipped')].label).toBe('Not interested');
  });

  it("treats Don't send (skipped) as closed, never Ready", () => {
    expect(stageOf('skipped')).toBe('not_interested');
    expect(stageOf('listed')).toBe('no_email');
  });

  it('sums status counts into stages', () => {
    const c = stageCounts({ new: 2, crawling: 1, ready: 4, drafted: 3, approved: 1, contacted: 5, skipped: 1, suppressed: 2 });
    expect(c.checking).toBe(3);
    expect(c.ready).toBe(4);
    expect(c.waiting).toBe(3);
    expect(c.queued).toBe(1);
    expect(c.sent).toBe(5);
    expect(c.not_interested).toBe(3);
  });

  it('copy has no em dashes', () => {
    for (const st of Object.values(STAGES)) expect(st.label).not.toMatch(/—/);
  });
});

describe('isMissingSchema', () => {
  it('detects a missing function / column so code can fall back', () => {
    expect(isMissingSchema({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isMissingSchema({ code: '42703', message: 'column x does not exist' })).toBe(true);
    expect(isMissingSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});
