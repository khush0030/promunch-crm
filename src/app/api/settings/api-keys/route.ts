// Owner-only API key management. GET = list (masked), POST = live-test a key,
// PUT = replace/save, DELETE = remove dashboard-stored keys (one or many).
// Values never leave the server unmasked; audit entries record actions, never values.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import {
  EDITABLE_KEYS,
  KEY_NAME_RE,
  bustSecretCache,
  requireSecretsOwner,
  testSecret,
} from "@/lib/secrets";

export const dynamic = "force-dynamic";

const REGISTRY = new Set(EDITABLE_KEYS.map((k) => k.name));
const mask = (v: string) => (v.length >= 8 ? `····${v.slice(-4)}` : "····");

type StoredRow = { name: string; value: string; updated_by: string | null; updated_at: string };

async function loadStored(): Promise<{ rows: StoredRow[]; migrationPending: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("app_secrets")
    .select("name, value, updated_by, updated_at")
    .order("name");
  if (error) return { rows: [], migrationPending: true };
  return { rows: (data ?? []) as StoredRow[], migrationPending: false };
}

export async function GET() {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  const { rows, migrationPending } = await loadStored();
  const stored = new Map(rows.map((r) => [r.name, r]));

  const keys = EDITABLE_KEYS.map((def) => {
    const db = stored.get(def.name);
    const envVal = process.env[def.name];
    const effective = db?.value ?? envVal ?? null;
    return {
      ...def,
      custom: false,
      source: db ? "dashboard" : envVal ? "env" : "missing",
      masked: effective ? mask(effective) : null,
      updatedAt: db?.updated_at ?? null,
      updatedBy: db?.updated_by ?? null,
    };
  });

  const custom = rows
    .filter((r) => !REGISTRY.has(r.name))
    .map((r) => ({
      name: r.name,
      label: r.name,
      group: "Custom",
      hint: "Available to dashboard code via getSecret()",
      testable: false,
      custom: true,
      source: "dashboard" as const,
      masked: mask(r.value),
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));

  return NextResponse.json({ keys: [...keys, ...custom], migrationPending });
}

export async function POST(req: Request) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  const { name, value } = (await req.json().catch(() => ({}))) as { name?: string; value?: string };
  if (!name || !KEY_NAME_RE.test(name)) {
    return NextResponse.json({ error: "invalid key name" }, { status: 400 });
  }
  // Test the provided value, or the currently effective one when omitted.
  let candidate = value?.trim();
  if (!candidate) {
    const { rows } = await loadStored();
    candidate = rows.find((r) => r.name === name)?.value ?? process.env[name] ?? "";
  }
  if (!candidate) return NextResponse.json({ ok: false, detail: "no value to test" });
  return NextResponse.json(await testSecret(name, candidate));
}

export async function PUT(req: Request) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  const { name, value } = (await req.json().catch(() => ({}))) as { name?: string; value?: string };
  if (!name || !KEY_NAME_RE.test(name)) {
    return NextResponse.json({ error: "invalid key name (use UPPER_SNAKE_CASE)" }, { status: 400 });
  }
  const trimmed = (value ?? "").trim();
  if (trimmed.length < 8) {
    return NextResponse.json({ error: "value too short to be a real key" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("app_secrets").upsert({
    name,
    value: trimmed,
    updated_by: gate.user.email ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    const pending = /app_secrets/.test(error.message) || error.code === "42P01";
    return NextResponse.json(
      { error: pending ? "app_secrets migration not applied yet — run 20260705240000_app_secrets.sql" : error.message },
      { status: 500 }
    );
  }

  bustSecretCache(name);
  await recordAudit({
    action: "secrets.replace",
    entityType: "app_secret",
    entityId: name,
    summary: `API key ${name} replaced from dashboard`,
    actor: gate.user,
  });
  return NextResponse.json({ ok: true, masked: mask(trimmed) });
}

export async function DELETE(req: Request) {
  const gate = await requireSecretsOwner();
  if (!gate.ok) return gate.response;

  // Accepts { name } (single) or { names: [...] } (bulk). Built-in keys only
  // lose their dashboard override and fall back to the environment value (or
  // read "Not configured"); the panel says so in its confirm before calling.
  const body = (await req.json().catch(() => ({}))) as { name?: string; names?: string[] };
  const raw = Array.isArray(body.names) ? body.names : body.name ? [body.name] : [];
  const names = [...new Set(raw)];
  if (names.length === 0 || names.length > 100 || !names.every((n) => typeof n === "string" && KEY_NAME_RE.test(n))) {
    return NextResponse.json({ error: "invalid key names" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from("app_secrets").delete().in("name", names).select("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const removed = (data ?? []).map((r) => r.name as string);
  for (const name of removed) {
    bustSecretCache(name);
    const builtIn = REGISTRY.has(name);
    await recordAudit({
      action: "secrets.delete",
      entityType: "app_secret",
      entityId: name,
      summary: builtIn
        ? `API key ${name} dashboard value removed (falls back to environment)`
        : `Custom API key ${name} removed`,
      actor: gate.user,
    });
  }
  return NextResponse.json({ ok: true, removed });
}
