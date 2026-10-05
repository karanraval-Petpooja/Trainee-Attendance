'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, Bell, CalendarDays, ChevronDown, CalendarRange, CheckCircle2, ClipboardList, FileSpreadsheet, Flag, GraduationCap, PieChart, History, LayoutDashboard,
  LogOut, Menu, Settings, UserCircle, Users, X,
} from 'lucide-react';
import { sb } from '@/lib/supabase';
import { fmtLong, nowInTz } from '@/lib/dates';
import Logo from './Logo';
import NotificationBell from './NotificationBell';
import { ErrorText, PageLoader } from './ui';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Sidebar sections. Reports are grouped together; data entry and setup sit in their own section.
const REPORTS = [
  { href: '/reports', label: 'Monthly Sheet', icon: FileSpreadsheet },
  { href: '/rag', label: 'RAG Report', icon: Flag },
  { href: '/history', label: 'Attendance History', icon: History },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
];
const TRAINER_GROUPS = [
  { id: 'home', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { id: 'attendance', title: 'Attendance', items: [
    { href: '/attendance', label: 'Mark Attendance', icon: CheckCircle2 },
    { href: '/timeline', label: 'Date-wise Calendar', icon: CalendarRange },
  ] },
  { id: 'data', title: 'Data & Setup', items: [
    { href: '/trainees', label: 'My Trainees & Batches', icon: GraduationCap },
  ] },
  { id: 'ojt', title: 'OJT / Upskill / PIP / Refresher', items: [
    { href: '/ojt', label: 'Sessions', icon: ClipboardList },
    { href: '/ojt/charts', label: 'Charts', icon: PieChart },
  ] },
  { id: 'reports', title: 'Reports', items: REPORTS },
  { id: 'account', title: 'Account', items: [
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/profile', label: 'Profile', icon: UserCircle },
  ] },
];
const MANAGER_GROUPS = [
  { id: 'home', items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  { id: 'attendance', title: 'Attendance', items: [
    { href: '/attendance', label: 'Attendance Register', icon: CheckCircle2 },
    { href: '/timeline', label: 'Date-wise Calendar', icon: CalendarRange },
  ] },
  { id: 'data', title: 'Data & Setup', items: [
    { href: '/trainees', label: 'Trainees & Batches', icon: GraduationCap },
    { href: '/trainers', label: 'Trainers', icon: Users },
    { href: '/settings', label: 'Settings', icon: Settings },
  ] },
  { id: 'ojt', title: 'OJT / Upskill / PIP / Refresher', items: [
    { href: '/ojt', label: 'Sessions', icon: ClipboardList },
    { href: '/ojt/charts', label: 'Charts', icon: PieChart },
  ] },
  { id: 'reports', title: 'Reports', items: REPORTS },
  { id: 'account', title: 'Account', items: [
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/profile', label: 'Profile', icon: UserCircle },
  ] },
];
const MANAGER_ONLY = ['/trainers', '/settings'];

export default function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [now, setNow] = useState(null);
  const [toast, setToast] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  // Sidebar sections start closed; the one holding the current page opens automatically
  const [expanded, setExpanded] = useState({});
  const toggleGroup = (id, isOpen) => setExpanded((c) => ({ ...c, [id]: !isOpen }));
  const [fatal, setFatal] = useState('');
  const settingsRef = useRef(null);
  const prevNow = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const reloadSettings = useCallback(async () => {
    const { data } = await sb().from('settings').select('*').eq('id', 1).single();
    if (data) {
      settingsRef.current = data;
      setSettings(data);
      const n = nowInTz(data.timezone);
      prevNow.current = n;
      setNow(n);
    }
    return data;
  }, []);
  const reloadNotifications = useCallback(async (uid) => {
    const { data } = await sb().from('notifications').select('*').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(100);
    setNotifications(data || []);
  }, []);

  const pushBrowser = (n) => {
    const s = settingsRef.current;
    if (!s?.browser_notifications_enabled || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(n.title, { body: n.message, tag: n.id }); } catch { /* some mobile browsers block this */ }
    }
  };

  // Boot: session → profile → settings → run missed-attendance check → notifications + realtime
  useEffect(() => {
    let alive = true;
    let channel;
    (async () => {
      const { data: { session } } = await sb().auth.getSession();
      if (!session) { router.replace('/login'); return; }
      const { data: prof, error } = await sb().from('profiles').select('*').eq('id', session.user.id).single();
      if (!alive) return;
      if (error || !prof) { setFatal('No profile is linked to this login. Ask your manager to add you as a trainer.'); return; }
      if (prof.status !== 'active') { await sb().auth.signOut(); router.replace('/login?inactive=1'); return; }
      setProfile(prof);
      await reloadSettings();
      try { await sb().rpc('process_missed_attendance'); } catch { /* non-blocking */ }
      if (!alive) return;
      await reloadNotifications(prof.id);
      if (!alive) return;
      channel = sb().channel(`notifications-${prof.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${prof.id}` }, (payload) => {
          setNotifications((list) => (list.some((x) => x.id === payload.new.id) ? list : [payload.new, ...list]));
          pushBrowser(payload.new);
        })
        .subscribe();
    })();
    const { data: sub } = sb().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });
    return () => {
      alive = false;
      if (channel) sb().removeChannel(channel);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live clock. When the deadline passes (or the day changes) while the app is open, run the check.
  useEffect(() => {
    if (!settings) return undefined;
    const id = setInterval(async () => {
      const n = nowInTz(settings.timezone);
      const prev = prevNow.current;
      prevNow.current = n;
      setNow(n);
      const crossed = prev && (prev.date !== n.date || (prev.time <= settings.attendance_deadline && n.time > settings.attendance_deadline));
      if (crossed) {
        await sb().rpc('process_missed_attendance');
        if (profile) reloadNotifications(profile.id);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [settings, profile, reloadNotifications]);

  // Role guard
  useEffect(() => {
    if (profile && profile.role !== 'manager' && MANAGER_ONLY.some((p) => pathname.startsWith(p))) router.replace('/dashboard');
  }, [profile, pathname, router]);

  useEffect(() => { setNavOpen(false); setExpanded({}); }, [pathname]);

  const markRead = useCallback(async (id) => {
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, read_status: true } : n)));
    await sb().from('notifications').update({ read_status: true }).eq('id', id);
  }, []);
  const markAllRead = useCallback(async () => {
    if (!profile) return;
    setNotifications((list) => list.map((n) => ({ ...n, read_status: true })));
    await sb().from('notifications').update({ read_status: true }).eq('user_id', profile.id).eq('read_status', false);
  }, [profile]);

  const groups = profile?.role === 'manager' ? MANAGER_GROUPS : TRAINER_GROUPS;
  const nav = groups.flatMap((g) => g.items);
  const isReport = REPORTS.some((r) => pathname.startsWith(r.href));
  const activeHref = nav.map((n) => n.href).filter((h) => pathname === h || pathname.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];
  const unread = notifications.filter((n) => !n.read_status).length;
  const title = nav.find((n) => n.href === activeHref)?.label || 'Trainer Attendance';

  const logout = async () => {
    await sb().auth.signOut();
    router.replace('/login');
  };

  if (fatal) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorText>{fatal}</ErrorText>
        <button className="btn-secondary mt-4" onClick={logout}>Sign out</button>
      </div>
    );
  }
  if (!profile || !settings || !now) return <PageLoader label="Opening your register" />;

  const value = {
    profile, settings, now, tz: settings.timezone, notifications, unread,
    showToast, reloadSettings, markRead, markAllRead,
    reloadNotifications: () => reloadNotifications(profile.id),
  };

  return (
    <Ctx.Provider value={value}>
      <div className="min-h-screen">
        {navOpen && <div className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" onClick={() => setNavOpen(false)} />}
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-ink-900 text-ink-100 transition-transform lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-16 items-center justify-between px-5">
            <Logo size={32} light />
            <button className="rounded-lg p-1 text-ink-300 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={20} /></button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
            {groups.map((g) => {
              const hasActive = g.items.some((it) => it.href === activeHref);
              const open = !g.title || (expanded[g.id] ?? hasActive);
              return (
                <div key={g.id} className={g.title ? 'pt-3' : ''}>
                  {g.title && (
                    <button onClick={() => toggleGroup(g.id, open)} aria-expanded={open}
                      className="flex w-full items-center justify-between px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400 hover:text-ink-200">
                      {g.title}
                      <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                    </button>
                  )}
                  {open && g.items.map(({ href, label, icon: Icon }) => {
                    const active = href === activeHref;
                    return (
                      <Link key={href} href={href}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white'}`}>
                        <Icon size={18} className={active ? 'text-emerald-300' : ''} />
                        <span className="flex-1">{label}</span>
                        {href === '/notifications' && unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{unread}</span>}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
            <div className="pt-3" />
            <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-300 hover:bg-white/5 hover:text-white">
              <LogOut size={18} /> Logout
            </button>
          </nav>
          <div className="border-t border-white/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20 font-display text-sm font-bold text-emerald-200">
                {profile.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{profile.name}</div>
                <div className="text-xs capitalize text-ink-300">{profile.role}{profile.employee_id ? ` · ${profile.employee_id}` : ''}</div>
              </div>
            </div>
          </div>
        </aside>

        <div className="lg:pl-64">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur lg:px-8">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-bold text-ink-900">{title}</div>
              <div className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex"><CalendarDays size={12} />{fmtLong(now.date)}</div>
            </div>
            <NotificationBell />
          </header>
          <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
            {isReport && (
              <div className="no-scrollbar -mx-1 mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Reports">
                {REPORTS.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} role="tab" aria-selected={active}
                      className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-ink-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                      <Icon size={16} />{label}
                    </Link>
                  );
                })}
              </div>
            )}
            {children}
          </main>
        </div>

        {toast && (
          <div key={toast.id} className={`animate-pop fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${toast.type === 'error' ? 'bg-red-600' : 'bg-ink-900'}`}>
            {toast.type !== 'error' && <span className="mr-2 text-emerald-300">✓</span>}{toast.message}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
