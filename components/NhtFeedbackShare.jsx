'use client';
import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Laptop, MessageCircle, Monitor, Share2, X } from 'lucide-react';
import { formById } from '@/lib/feedbackForms';
import { useApp } from './AppShell';

// Share a feedback form (NHT, Sales, Upskill, OJT / PIP): the QR poster, the link, WhatsApp, or the phone's share sheet
export default function NhtFeedbackShare({ compact = false, formId = 'nht' }) {
  const { showToast } = useApp();
  const form = formById(formId);
  const NHT_FORM_URL = form.url; const NHT_MESSAGE = form.message; const NHT_POSTER = form.poster;
  const [zoom, setZoom] = useState(false);

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied.`); }
    catch { window.prompt('Copy this:', text); }
  };
  const share = async () => {
    try {
      const blob = await (await fetch(NHT_POSTER)).blob();
      const file = new File([blob], `${form.name.replace(/[^a-z0-9]+/gi, '-')}-Form.jpeg`, { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: form.name, text: NHT_MESSAGE }); return; }
      if (navigator.share) { await navigator.share({ title: form.name, text: NHT_MESSAGE, url: NHT_FORM_URL }); return; }
      await copy(NHT_MESSAGE, 'Message with link');
    } catch (e) { if (e?.name !== 'AbortError') copy(NHT_MESSAGE, 'Message with link'); }
  };
  // WhatsApp: open what the person already uses (no new login)
  //  phone → the WhatsApp app; computer → WhatsApp Desktop app or WhatsApp Web (same browser = already logged in)
  const [isPhone, setIsPhone] = useState(false);
  const [waMode, setWaMode] = useState(null); // 'app' | 'web' (computer only, remembered)
  const [waAsk, setWaAsk] = useState(false);
  useEffect(() => {
    setIsPhone(/android|iphone|ipad|ipod/i.test(navigator.userAgent));
    try { setWaMode(localStorage.getItem('waMode')); } catch { /* ignore */ }
  }, []);
  const text = encodeURIComponent(NHT_MESSAGE);
  const openWhatsApp = (mode) => {
    if (isPhone) {
      window.location.href = `whatsapp://send?text=${text}`;                 // the installed app, straight away
      setTimeout(() => { if (document.visibilityState === 'visible') window.location.href = `https://wa.me/?text=${text}`; }, 1500); // no app: fallback
      return;
    }
    const m = mode || waMode;
    if (!m) { setWaAsk(true); return; }
    try { localStorage.setItem('waMode', m); } catch { /* ignore */ }
    setWaMode(m); setWaAsk(false);
    if (m === 'app') {
      window.location.href = `whatsapp://send?text=${text}`;                 // WhatsApp Desktop opens directly
      showToast('Opening WhatsApp Desktop… If nothing opens, choose WhatsApp Web.');
    } else {
      window.open(`https://web.whatsapp.com/send?text=${text}`, 'whatsapp-web'); // reuses the open WhatsApp Web tab
    }
  };
  const fileName = `${form.name.replace(/[^a-z0-9]+/gi, '-')}-Form.jpeg`;
  const Tile = ({ icon: Icon, label, sub, tone, onClick, href, newTab }) => {
    const body = (
      <>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${tone}`}><Icon size={20} /></span>
        <span className="mt-1.5 text-xs font-semibold text-ink-900">{label}</span>
        {sub && <span className="text-[10px] text-slate-400">{sub}</span>}
      </>
    );
    const cls = 'flex min-w-[78px] flex-1 flex-col items-center rounded-2xl border border-slate-200 bg-white px-2 py-2.5 text-center hover:border-slate-300 hover:shadow-sm';
    return href
      ? <a className={cls} href={href} {...(newTab ? { target: '_blank', rel: 'noreferrer' } : { download: fileName })}>{body}</a>
      : <button type="button" className={cls} onClick={onClick}>{body}</button>;
  };

  const buttons = (
    <div className={compact ? '' : 'mt-4'}>
      <div className="flex flex-wrap gap-2">
        <Tile icon={Share2} label="Share" sub="poster + link" tone="bg-ink-800 text-white" onClick={share} />
        <Tile icon={MessageCircle} label="WhatsApp" sub={isPhone ? 'app' : waMode === 'app' ? 'desktop app' : waMode === 'web' ? 'WhatsApp Web' : 'app or web'} tone="bg-[#25D366] text-white" onClick={() => openWhatsApp()} />
        <Tile icon={Copy} label="Copy link" tone="bg-indigo-100 text-indigo-700" onClick={() => copy(NHT_FORM_URL, 'Form link')} />
        <Tile icon={Download} label="Download" sub="QR poster" tone="bg-amber-100 text-amber-700" href={NHT_POSTER} />
        <Tile icon={ExternalLink} label="Open form" tone="bg-sky-100 text-sky-700" href={NHT_FORM_URL} newTab />
      </div>
      {!isPhone && waAsk && (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-sm font-semibold text-ink-900">Open WhatsApp with…</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm bg-[#25D366] text-white hover:brightness-95" onClick={() => openWhatsApp('app')}><Monitor size={14} />WhatsApp Desktop app</button>
            <button type="button" className="btn btn-sm border border-emerald-300 bg-white text-emerald-800" onClick={() => openWhatsApp('web')}><Laptop size={14} />WhatsApp Web</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Your choice is remembered. WhatsApp Web opens in this browser, so if you are already logged in there, no login is needed.</p>
        </div>
      )}
      {!isPhone && waMode && !waAsk && (
        <button type="button" className="mt-2 text-xs text-slate-500 hover:underline" onClick={() => setWaAsk(true)}>
          WhatsApp opens in {waMode === 'app' ? 'the desktop app' : 'WhatsApp Web'} · change
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className={`flex ${compact ? 'flex-col gap-3 sm:flex-row sm:items-center' : 'flex-col gap-5 md:flex-row md:items-start'}`}>
        <button type="button" onClick={() => setZoom(true)} title="Open the QR poster"
          className={`shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow ${compact ? 'w-24' : 'w-full max-w-xs'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NHT_POSTER} alt={`${form.name} QR poster`} className="block h-auto w-full" />
        </button>
        <div className="min-w-0 flex-1">
          {!compact && (
            <>
              <h2 className="text-lg font-bold text-ink-900">{form.name}: share with trainees</h2>
              <p className="mt-0.5 text-sm text-slate-500">{form.when}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>On the last day of training, show the QR poster on screen (click it to open full size), or</li>
                <li>send the link / poster to the batch: <b>Share</b> on a phone, <b>WhatsApp</b>, or <b>Copy link</b>.</li>
                <li>Ask every trainee to fill the form before they leave the session.</li>
              </ol>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="truncate font-mono text-ink-800">{NHT_FORM_URL}</span>
              </div>
            </>
          )}
          {buttons}
        </div>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(false)} role="dialog" aria-label={`${form.name} QR poster`}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" onClick={() => setZoom(false)} aria-label="Close"><X size={20} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NHT_POSTER} alt={`${form.name} QR poster`} className="max-h-full max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
