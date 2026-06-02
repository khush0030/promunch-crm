"use client";

import { useEffect, useState } from "react";
import { Mail, Trash2, UserPlus, ShieldCheck, Clock } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { ALLOWED_DOMAINS_LABEL } from "@/lib/auth-domains";

type TeamUser = {
  id: string;
  email: string | null;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
};

export default function TeamPage() {
  const toast = useToast();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/team", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed to load team.");
      setUsers(d.users || []);
      setCurrentUserId(d.currentUserId || null);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Failed to load team." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Invite failed.");
      toast.push({ kind: "success", text: `Invite sent to ${email.trim()}.` });
      setEmail("");
      setName("");
      load();
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Invite failed." });
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRemove(u: TeamUser) {
    if (!confirm(`Remove ${u.email || u.name}? They'll lose access to the dashboard.`)) return;
    setRemovingId(u.id);
    try {
      const r = await fetch(`/api/team?id=${encodeURIComponent(u.id)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Remove failed.");
      toast.push({ kind: "info", text: `Removed ${u.email || u.name}.` });
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Remove failed." });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">
            Anyone you add gets full access to the dashboard — there are no roles. Only{" "}
            {ALLOWED_DOMAINS_LABEL} emails can be added.
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <UserPlus size={16} />
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Add a teammate</h2>
        </div>
        <form
          onSubmit={handleInvite}
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <div className="field" style={{ flex: "2 1 240px" }}>
            <label>Email</label>
            <input
              type="email"
              className="input"
              placeholder="teammate@promunch.in"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label>Name (optional)</label>
            <input
              type="text"
              className="input"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn primary"
            disabled={inviteBusy}
            style={{ justifyContent: "center", height: 38 }}
          >
            <Mail size={14} />
            {inviteBusy ? "Sending…" : "Send invite"}
          </button>
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          They&apos;ll get an email with a link to set a password and sign in.
        </p>
      </div>

      <div className="card">
        <div
          className="card-pad"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>
            Members{users.length ? ` (${users.length})` : ""}
          </h2>
        </div>
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {loading ? (
            <div className="card-pad muted">Loading…</div>
          ) : users.length === 0 ? (
            <div className="card-pad muted">No members yet.</div>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <Avatar name={u.name} size={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>
                        You
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {u.email}
                  </div>
                </div>
                <div
                  className="pill"
                  title={u.confirmed ? "Active" : "Invite pending — not yet accepted"}
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}
                >
                  {u.confirmed ? <ShieldCheck size={13} /> : <Clock size={13} />}
                  {u.confirmed ? "Active" : "Pending"}
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => handleRemove(u)}
                  disabled={u.id === currentUserId || removingId === u.id}
                  title={u.id === currentUserId ? "You can't remove yourself" : "Remove"}
                  style={{ padding: "6px 8px" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
