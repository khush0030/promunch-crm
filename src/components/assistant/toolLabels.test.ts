import { describe, expect, it, vi } from "vitest";

// The tool module builds a Supabase admin client at import time; only its keys
// matter here, so stub the server-side dependencies.
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/leads/kb", () => ({ getKnowledgeBase: async () => null }));

import { assistantTools } from "@/lib/assistant/tools";
import { buildInstructions } from "@/lib/assistant/prompt";
import {
  FIELD_LABELS,
  TOOL_LABELS,
  fieldLabel,
  humanize,
  scrubInternalNames,
  sourcesOf,
  toolDoneLabel,
  toolPendingLabel,
  toolSourceLabel,
} from "./toolLabels";

const toolNames = Object.keys(assistantTools);

describe("Maya tool labels", () => {
  it("gives every defined tool a business label", () => {
    for (const name of toolNames) {
      expect(TOOL_LABELS, name).toHaveProperty(name);
    }
    expect(Object.keys(TOOL_LABELS).sort()).toEqual([...toolNames].sort());
  });

  it("never shows a raw identifier for a defined tool", () => {
    for (const name of toolNames) {
      for (const label of [toolSourceLabel(name), toolPendingLabel(name), toolDoneLabel(name), toolSourceLabel(`tool-${name}`)]) {
        expect(label, name).not.toContain("_");
        expect(label, name).not.toContain(name);
      }
    }
    for (const label of Object.values(FIELD_LABELS)) expect(label).not.toContain("_");
  });

  it("maps the reported identifiers to business words", () => {
    expect(toolSourceLabel("get_system_health")).toBe("System health");
    expect(toolSourceLabel("query_orders")).toBe("Sales");
    expect(fieldLabel("wa_jobs_recent_failures")).toBe("WhatsApp send failures");
  });

  it("humanises unknown tools and fields instead of leaking them", () => {
    expect(humanize("get_ig_dm_backlog")).toBe("Instagram dm backlog");
    expect(toolSourceLabel("tool-get_new_thing")).toBe("New thing");
    expect(toolPendingLabel("some_future_tool")).not.toContain("_");
    expect(fieldLabel("kb_chunks_count")).toBe("Knowledge base chunks count");
  });

  it("builds de-duplicated sources from parts", () => {
    expect(
      sourcesOf([{ type: "text" }, { type: "tool-get_system_health" }, { type: "tool-get_system_health" }, { type: "tool-query_orders" }])
    ).toEqual(["System health", "Sales"]);
  });
});

describe("Maya system prompt", () => {
  const prompt = buildInstructions();

  it("forbids internal names in answers", () => {
    expect(prompt).toContain("Business words only");
    expect(prompt).toMatch(/Never mention tool names, function names, database table or column names/);
  });

  it("keeps the brand rules", () => {
    expect(prompt).toContain("PROMUNCH (all caps)");
    expect(prompt).toContain("Never use em dashes");
    expect(prompt).toContain("Your Munchy Pal");
    expect(prompt).toContain("Always answer from tool results");
  });
});

describe("scrubInternalNames", () => {
  it("rewrites tool, table and field names into business words", () => {
    expect(scrubInternalNames("I ran `get_system_health`. The wa_jobs_recent_failures list has 3 rows."))
      .toBe("I ran system health. The WhatsApp send failures list has 3 rows.");
    expect(scrubInternalNames("Checked last_status on each job")).toBe("Checked last status on each job");
    expect(scrubInternalNames("| cron_jobs | ok |")).toBe("| Scheduled jobs | ok |");
  });

  it("leaves URLs, emails and normal words alone", () => {
    const s = "Link https://promunch.in/?utm_source=whatsapp&utm_campaign=edamame_launch and a_b@x.com, PROMUNCH10, order #2083.";
    expect(scrubInternalNames(s)).toBe(s);
  });

  it("leaves no underscores in a typical old answer", () => {
    const out = scrubInternalNames("From get_system_health: shopify_last_order_at is today, connector_errors_24h is 0, gmail_watch ok.");
    expect(out).not.toMatch(/_/);
  });
});
