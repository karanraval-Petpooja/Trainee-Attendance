export default function Logo({ size = 36, light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill={light ? '#ffffff' : '#1D2750'} />
        <rect x="8" y="9" width="6" height="22" rx="2" fill={light ? '#C7CFE4' : '#4A5A8A'} />
        <rect x="17" y="9" width="6" height="22" rx="2" fill={light ? '#C7CFE4' : '#4A5A8A'} />
        <rect x="26" y="9" width="6" height="22" rx="2" fill="#34D399" />
        <path d="M27 20.5l2 2 3.6-4.2" stroke={light ? '#1D2750' : '#ffffff'} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-display text-lg font-bold leading-none ${light ? 'text-white' : 'text-ink-900'}`}>Trainer Attendance</span>
    </div>
  );
}
