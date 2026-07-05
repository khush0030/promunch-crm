import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/leads/auth';
import { getKnowledgeBase } from '@/lib/leads/kb';
import { generateTemplateVariants } from '@/lib/leads/template-ai';

export const maxDuration = 60;

// "Draft with AI" in the template editor: brief in, 3 template variants out.
export async function POST(req: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { brief?: string; products?: string[] }
    | null;
  const brief = body?.brief?.trim();
  if (!brief) return NextResponse.json({ error: 'brief is required' }, { status: 400 });

  try {
    const knowledgeBase = await getKnowledgeBase();
    const variants = await generateTemplateVariants({
      brief: brief.slice(0, 600),
      products: body?.products?.slice(0, 8) ?? null,
      knowledgeBase,
    });
    return NextResponse.json({ variants });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
