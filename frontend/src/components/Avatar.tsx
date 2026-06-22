interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function Avatar({ name, src, size = 40 }: AvatarProps) {
  const dim = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={dim}
        className="rounded-full object-cover ring-1 ring-slate-200"
      />
    );
  }
  return (
    <span
      style={dim}
      className="grid place-items-center rounded-full bg-brand-100 font-semibold text-brand-700 ring-1 ring-brand-200"
    >
      <span style={{ fontSize: size * 0.36 }}>{initials(name)}</span>
    </span>
  );
}
