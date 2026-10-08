import { Instagram, Mail, MessageCircle } from "lucide-react";
import s from "./channel.module.css";

export type InboxChannel = "wa" | "ig" | "em";

export const CHANNEL_NAME: Record<InboxChannel, string> = { wa: "WhatsApp", ig: "Instagram", em: "Email" };

/** Channel glyph in its colour (WhatsApp green, Email blue, Instagram pink). */
export function ChannelIcon({ channel, size = 14 }: { channel: InboxChannel; size?: number }) {
  const Icon = channel === "wa" ? MessageCircle : channel === "ig" ? Instagram : Mail;
  return <Icon className={s[channel]} width={size} height={size} strokeWidth={2.2} aria-hidden="true" />;
}

/** Icon + channel name as coloured text: tells WhatsApp and Email apart at a glance. */
export function ChannelTag({ channel, label = true }: { channel: InboxChannel; label?: boolean }) {
  return (
    <span className={`${s.tag} ${s[channel]}`} title={CHANNEL_NAME[channel]}>
      <ChannelIcon channel={channel} size={13} />
      {label ? CHANNEL_NAME[channel] : <span className={s.sr}>{CHANNEL_NAME[channel]}</span>}
    </span>
  );
}

export default ChannelTag;
