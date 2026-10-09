import { Tag } from "@/components/pm";
import { STAGES, stageOf, type Stage } from "@/lib/leads/lead-status";

// The ONE plain status a business shows, colour = meaning.
export function StageTag({ status, stage, children }: { status?: string | null; stage?: Stage; children?: React.ReactNode }) {
  const st = stage ?? stageOf(status);
  const s = STAGES[st];
  return (
    <Tag tone={s.tone} dot>
      {children ?? s.label}
    </Tag>
  );
}

export default StageTag;
