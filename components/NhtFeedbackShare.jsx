'use client';
import { useState } from 'react';
import { Copy, Download, ExternalLink, MessageCircle, Share2, X } from 'lucide-react';
import { NHT_FORM_URL, NHT_MESSAGE, NHT_POSTER } from '@/lib/nhtFeedback';
import { useApp } from './AppShell';

// Share the NHT feedback form: the QR poster, the link, WhatsApp, or the phone's share sheet
export default function NhtFeedbackShare({ compact = false }) {
  const { showToast } = useApp();
  const [zoom, setZoom] = useState(false);

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied.`); }
    catch { window.prompt('Copy this:', text); }
  };
  const share = async () => {
    try {
      const blob = await (await fetch(NHT_POSTER)).blob();
      const file = new File([blob], 'NHT-Feedback-Form.jpeg', { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'NHT Feedback', text: NHT_MESSAGE }); return; }
      if (navigator.share) { await navigator.share({ title: 'NHT Feedback', text: NHT_MESSAGE, url: NHT_FORM_URL }); return; }
      await copy(NHT_MESSAGE, 'Message with link');
    } catch (e) { if (e?.name !== 'AbortError') copy(NHT_MESSAGE, 'Message with link'); }
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(NHT_MESSAGE)}`;

  const buttons = (
    <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-4'}`}>
      <button type="button" className="btn-primary btn-sm" onClick={share}><Share2 size={14} />Share</button>
      <a className="btn-secondary btn-sm" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>
      <button type="button" className="btn-secondary btn-sm" onClick={() => copy(NHT_FORM_URL, 'Form link')}><Copy size={14} />Copy link</button>
      <a className="btn-secondary btn-sm" href={NHT_POSTER} download="NHT-Feedback-Form.jpeg"><Download size={14} />Download QR poster</a>
      <a className="btn-ghost btn-sm" href={NHT_FORM_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open form</a>
    </div>
  );

  return (
    <>
      <div className={`flex ${compact ? 'flex-col gap-3 sm:flex-row sm:items-center' : 'flex-col gap-5 md:flex-row md:items-start'}`}>
        <button type="button" onClick={() => setZoom(true)} title="Open the QR poster"
          className={`shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow ${compact ? 'w-24' : 'w-full max-w-xs'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NHT_POSTER} alt="NHT Feedback QR poster" className="block h-auto w-full" />
        </button>
        <div className="min-w-0 flex-1">
          {!compact && (
            <>
              <h2 className="text-lg font-bold text-ink-900">Share with trainees at the end of training</h2>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(false)} role="dialog" aria-label="NHT Feedback QR poster">
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" onClick={() => setZoom(false)} aria-label="Close"><X size={20} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={NHT_POSTER} alt="NHT Feedback QR poster" className="max-h-full max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
