import { avatarColorToken, avatarTextColor, initials } from "@/lib/pm/avatar";

export type Channel = "wa" | "ig" | "em";

const CHANNEL_LETTER: Record<Channel, string> = { wa: "W", ig: "I", em: "E" };

// Contact avatar: initials on a colour picked by a stable hash of the name,
// with an optional small channel badge overlay (WhatsApp/Instagram/email).
export function Avatar({
  name,
  channel,
  size = 28,
}: {
  name: string;
  channel?: Channel;
  size?: 28 | 34;
}) {
  const token = avatarColorToken(name);
  return (
    <span className="pm2-av-wrap" style={{ width: size, height: size }}>
      <span
        className={`pm2-av${size === 34 ? " lg" : ""}`}
        style={{ background: token, color: avatarTextColor(token) }}
      >
        {initials(name)}
      </span>
      {channel ? (
        <span className={`pm2-ch-ic ch-${channel} ch`} aria-hidden="true">
          {CHANNEL_LETTER[channel]}
        </span>
      ) : null}
    </span>
  );
}

export default Avatar;
