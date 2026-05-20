const PALETTE = ["#b9303f", "#5a8c52", "#bb8a2c", "#5b7e96", "#8a6fb0", "#c0667f"];

export function avatarColor(seed: string | null | undefined): string {
  if (!seed) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function avatarInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 28,
  fontSize,
}: { name: string | null | undefined; size?: number; fontSize?: number }) {
  return (
    <div
      className="avatar"
      style={{
        background: avatarColor(name),
        width: size,
        height: size,
        fontSize: fontSize ?? Math.max(10, Math.round(size * 0.38)),
      }}
    >
      {avatarInitials(name)}
    </div>
  );
}
