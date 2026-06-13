// Shared brand knowledge base for the B2B outreach drafter.
//
// Reads the SAME kb_documents Master KB the WhatsApp + email agents use (see
// promunch-email-agent/_shared/brand.ts getKnowledgeBase) so cold-email drafts
// state only real product facts — flavours, whether a product is roasted or
// fried, actual pack prices — instead of hardcoded guesses that drift wrong.
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mirror the edge agents' KB_CHAR_BUDGET so all channels prompt-stuff the same
// amount of the brand KB without blowing up context.
const KB_CHAR_BUDGET = 12000;

/** Returns the Master KB as a single prompt-ready string, or '' if unavailable. */
export async function getKnowledgeBase(): Promise<string> {
  try {
    const { data: docs } = await supabaseAdmin
      .from('kb_documents')
      .select('name, raw_text')
      .eq('status', 'ready');
    let kb = (docs ?? [])
      .filter((d) => d.raw_text && String(d.raw_text).trim())
      .map((d) => `## ${d.name}\n${d.raw_text}`)
      .join('\n\n');
    if (kb.length > KB_CHAR_BUDGET) kb = kb.slice(0, KB_CHAR_BUDGET);
    return kb;
  } catch (e) {
    console.warn('getKnowledgeBase failed:', e);
    return '';
  }
}
