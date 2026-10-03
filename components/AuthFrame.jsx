import Logo from './Logo';

const SAMPLE = [
  { d: '29', m: 'Oct', day: 'Thu', s: '✅', l: '10 marked' },
  { d: '30', m: 'Oct', day: 'Fri', s: '✅', l: '10 marked' },
  { d: '31', m: 'Oct', day: 'Sat', s: '🟡', l: 'Holiday' },
  { d: '1', m: 'Nov', day: 'Sun', s: '🔵', l: 'Week off' },
  { d: '2', m: 'Nov', day: 'Mon', s: '⏳', l: 'Today', today: true },
];

export default function AuthFrame({ children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <Logo light />
        <div>
          <p className="max-w-md font-display text-[44px] font-bold leading-[1.05] tracking-tight">
            One register. Every date, in order.
          </p>
          <p className="mt-4 max-w-sm text-ink-200">Mark your whole batch in a few taps. Unmarked days are caught automatically and reach the right manager.</p>
          <div className="mt-10 flex gap-3" aria-hidden="true">
            {SAMPLE.map((c) => (
              <div key={c.d + c.m} className={`w-[104px] shrink-0 rounded-2xl p-3.5 ${c.today ? 'bg-white text-ink-900' : 'bg-white/[0.07] text-white'}`}>
                <div className="flex items-baseline gap-1"><span className="font-display text-2xl font-extrabold">{c.d}</span><span className={`text-[10px] font-bold ${c.today ? 'text-slate-500' : 'text-ink-300'}`}>{c.m.toUpperCase()}</span></div>
                <div className={`text-[11px] ${c.today ? 'text-slate-500' : 'text-ink-300'}`}>{c.day}</div>
                <div className="mt-5 text-sm">{c.s}</div>
                <div className="text-[11px] font-semibold">{c.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-ink-300">Daily attendance · reminders · escalations</div>
      </div>
      <div className="flex items-center justify-center bg-paper px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
