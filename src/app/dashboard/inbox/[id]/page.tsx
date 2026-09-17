"use client";

// /dashboard/inbox/[id]: one conversation, full page. The id carries its
// channel as a prefix: wa-<uuid> (WhatsApp), ig-<uuid> (Instagram),
// em-<uuid> (support email, which lives on its own page and is redirected).

import Link from "next/link";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { WaConversation } from "@/components/inbox/WaConversation";
import { IgConversation } from "@/components/inbox/IgConversation";
import { parseConversationId } from "@/lib/inbox/thread";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const parsed = parseConversationId(params?.id);

  useEffect(() => {
    if (parsed?.channel === "em") {
      router.replace(`/dashboard/inbox/email?id=${encodeURIComponent(parsed.id)}`);
    }
  }, [parsed?.channel, parsed?.id, router]);

  if (!parsed || parsed.channel === "em") {
    if (parsed?.channel === "em") return <div className="pm2-body"><div className="pm2-skel" /></div>;
    return (
      <div className="pm2-body">
        <div className="pm2-panel" style={{ padding: 20 }}>
          <b>This conversation was not found</b>
          <div style={{ marginTop: 6 }}>
            <Link className="pm2-lnk" href="/dashboard/inbox">Back to Inbox</Link>
          </div>
        </div>
      </div>
    );
  }

  if (parsed.channel === "ig") return <IgConversation id={parsed.id} />;
  return <WaConversation id={parsed.id} />;
}
