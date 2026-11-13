'use client';
import { useEffect, useRef, useState } from 'react';

// The video meeting, running INSIDE the app page (Jitsi). Phones stay in the browser (no app download prompt).
export default function JitsiRoom({ pass, onLeave, apiRef }) {
  const box = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let api = null; let gone = false;
    const start = () => {
      if (gone || !box.current || !window.JitsiMeetExternalAPI) return;
      api = new window.JitsiMeetExternalAPI(pass.domain, {
        roomName: pass.room, parentNode: box.current, jwt: pass.jwt || undefined, width: '100%', height: '100%',
        userInfo: { displayName: pass.name },
        configOverwrite: { prejoinPageEnabled: false, disableDeepLinking: true, subject: pass.title, startWithAudioMuted: !pass.host },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false },
      });
      if (apiRef) apiRef.current = api;
      api.addListener('readyToClose', () => onLeave?.());
    };
    if (window.JitsiMeetExternalAPI) start();
    else {
      const sc = document.createElement('script');
      sc.src = pass.script; sc.async = true;
      sc.onload = start; sc.onerror = () => setError('The video service could not be loaded. Check the internet connection and try again.');
      document.body.appendChild(sc);
    }
    return () => { gone = true; try { api?.dispose(); } catch { /* ignore */ } };
  }, [pass]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-900">
      <div ref={box} className="h-full w-full" />
      {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">{error}</div>}
    </div>
  );
}
