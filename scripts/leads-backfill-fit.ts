// Backfill fit_score for leads scored before fit scoring existed.
// Run: set -a && source .env.local && set +a && npx tsx scripts/leads-backfill-fit.ts
import { scoreFit } from '../src/lib/leads/fit';
import { supabaseAdmin } from '../src/lib/supabase-admin';

async function main() {
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, category, city, types, site_snippet, status')
    .is('fit_score', null)
    .neq('status', 'no_website')
    .order('created_at', { ascending: true });

  console.log(`${leads?.length ?? 0} leads to score`);
  for (const lead of leads ?? []) {
    try {
      const fit = await scoreFit({
        companyName: lead.name,
        category: lead.category,
        city: lead.city,
        types: lead.types,
        siteSnippet: lead.site_snippet,
      });
      await supabaseAdmin
        .from('leads')
        .update({ fit_score: fit.score, fit_reason: fit.reason })
        .eq('id', lead.id);
      console.log(`${String(fit.score).padStart(3)}  ${lead.name.slice(0, 40).padEnd(42)} ${fit.reason}`);
    } catch (e) {
      console.error(`FAIL ${lead.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().then(() => process.exit(0));
