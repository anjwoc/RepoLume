interface RepoLumeMarkProps {
  size?: number;
  className?: string;
}

export function RepoLumeMark({ size = 32, className }: RepoLumeMarkProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="repolume-mark-top" x1="20" y1="20" x2="108" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2388ff" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="repolume-mark-middle" x1="25" y1="48" x2="103" y2="101" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#6d5ce7" />
        </linearGradient>
      </defs>
      <path d="M64 64 111 88 64 114 17 88Z" fill="#17243b" />
      <path d="M64 40 108 64 64 91 20 64Z" fill="url(#repolume-mark-middle)" />
      <path d="M64 14 106 38 64 64 22 38Z" fill="url(#repolume-mark-top)" />
      <path d="M24 39 64 63l40-24" fill="none" stroke="#8cc8ff" strokeOpacity=".75" strokeWidth="2" />
    </svg>
  );
}
