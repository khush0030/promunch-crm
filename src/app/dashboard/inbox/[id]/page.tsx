"use client";

// /dashboard/inbox/[id]: one conversation, full page. The id carries its
// channel as a prefix: wa-<uuid> (WhatsApp), ig-<uuid> (Instagram),
// em-<uuid> (support email, which lives on its own page and is redirected).

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { WaConversation } from "@/components/inbox/WaConversation";
import { IgConversation } from "@/components/inbox/IgConversation";
import { NotFoundCard } from "@/components/inbox/shared";
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
    return <NotFoundCard />;
  }

  // Full width like the rest of the Inbox; keyed so moving between chats
  // never carries a typed reply over to another customer.
  return (
    <div className="pm2-wide">
      {parsed.channel === "ig" ? <IgConversation key={parsed.id} id={parsed.id} /> : <WaConversation key={parsed.id} id={parsed.id} />}
    </div>
  );
}
