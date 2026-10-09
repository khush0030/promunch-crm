// One plain status per business for the B2B one-path flow
// (Find -> Pick -> Write -> Approve -> Send -> Replies). Pure: shared by the
// API (counts) and the dashboard (Tags). Colour = meaning:
//   No email = grey, Ready = blue, Waiting for approval = amber,
//   Sent = green, Replied = purple, Bounced = red.

export type LeadStatus =
  | 'new' | 'crawling' | 'listed' | 'no_contacts' | 'no_website'
  | 'ready' | 'drafting' | 'drafted' | 'approved'
  | 'contacted' | 'replied' | 'bounced'
  | 'suppressed' | 'skipped';

export const LEAD_STATUSES: LeadStatus[] = [
  'new', 'crawling', 'listed', 'no_contacts', 'no_website',
  'ready', 'drafting', 'drafted', 'approved',
  'contacted', 'replied', 'bounced',
  'suppressed', 'skipped',
];

export type Stage =
  | 'checking' | 'no_email' | 'ready' | 'writing' | 'waiting' | 'queued'
  | 'sent' | 'replied' | 'not_interested' | 'bounced';

export type StageTone = 'green' | 'blue' | 'red' | 'amber' | 'purple' | 'teal' | 'grey';

export const STAGES: Record<Stage, { label: string; tone: StageTone; statuses: LeadStatus[] }> = {
  checking: { label: 'Checking', tone: 'grey', statuses: ['new', 'crawling'] },
  no_email: { label: 'No email', tone: 'grey', statuses: ['listed', 'no_contacts', 'no_website'] },
  ready: { label: 'Ready', tone: 'blue', statuses: ['ready'] },
  writing: { label: 'Writing', tone: 'blue', statuses: ['drafting'] },
  waiting: { label: 'Waiting for approval', tone: 'amber', statuses: ['drafted'] },
  queued: { label: 'Sending soon', tone: 'teal', statuses: ['approved'] },
  sent: { label: 'Sent', tone: 'green', statuses: ['contacted'] },
  replied: { label: 'Replied', tone: 'purple', statuses: ['replied'] },
  not_interested: { label: 'Not interested', tone: 'grey', statuses: ['suppressed', 'skipped'] },
  bounced: { label: 'Bounced', tone: 'red', statuses: ['bounced'] },
};

export const STAGE_ORDER: Stage[] = [
  'checking', 'no_email', 'ready', 'writing', 'waiting', 'queued', 'sent', 'replied', 'not_interested', 'bounced',
];

const STAGE_OF = new Map<string, Stage>();
for (const k of STAGE_ORDER) for (const s of STAGES[k].statuses) STAGE_OF.set(s, k);

export function stageOf(status: string | null | undefined): Stage {
  return STAGE_OF.get(status ?? '') ?? 'no_email';
}

/** Statuses a business can be in to have emails written for it. */
export const WRITABLE_STATUSES: LeadStatus[] = ['ready'];
/** Statuses where "Find more emails" makes sense. */
export const FINDABLE_STATUSES: LeadStatus[] = ['listed', 'no_contacts', 'no_website'];
/** Statuses where a verified email exists. */
export const EMAIL_STATUSES: LeadStatus[] = [
  'ready', 'drafting', 'drafted', 'approved', 'contacted', 'replied', 'bounced',
];
/** Leads that must never be contacted (again). */
export const CLOSED_STATUSES: LeadStatus[] = ['replied', 'bounced', 'suppressed', 'skipped'];

export type StageCounts = Record<Stage, number>;

export function stageCounts(byStatus: Record<string, number>): StageCounts {
  const out = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as StageCounts;
  for (const [status, n] of Object.entries(byStatus)) out[stageOf(status)] += n || 0;
  return out;
}
