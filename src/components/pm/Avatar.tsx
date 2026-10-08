import { avatarColorToken, avatarTextColor, avatarTint, initials } from "@/lib/pm/avatar";

export type Channel = "wa" | "ig" | "em";

const CHANNEL_LETTER: Record<Channel, string> = { wa: "W", ig: "I", em: "E" };

// Contact avatar: initials in a tone picked by a stable hash of the name, on a
// soft tint of it (calm: no filled colour blocks),
// with an optional small channel badge overlay (WhatsApp/Instagram/email).
// `src` (a teammate's profile photo) replaces the initials when given.
export function Avatar({
  name,
  channel,
  size = 28,
  src,
}: {
  name: string;
  channel?: Channel;
  size?: number;
  src?: string | null;
}) {
  const token = avatarColorToken(name);
  const custom = size !== 28 && size !== 34;
  return (
    <span className="pm2-av-wrap" style={{ width: size, height: size }}>
      <span
        className={`pm2-av${size === 34 ? " lg" : ""}`}
        style={{
          background: avatarTint(token),
          color: avatarTextColor(token),
          ...(custom ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : null),
          ...(src ? { overflow: "hidden" } : null),
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          initials(name)
        )}
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
