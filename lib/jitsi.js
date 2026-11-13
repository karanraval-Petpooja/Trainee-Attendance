// In-app video (Jitsi). Where the video runs is set by environment variables:
//   JaaS (8x8, for testing):  JAAS_APP_ID, JAAS_KID, JAAS_PRIVATE_KEY      → domain 8x8.vc, signed passes
//   Own Jitsi server:         NEXT_PUBLIC_JITSI_DOMAIN = meet.yourdomain.com (no passes needed)
import crypto from 'crypto';

export const roomOf = (code) => `petpooja-${code}`;

export function jitsiConfig() {
  const appId = (process.env.JAAS_APP_ID || '').trim();
  if (appId && process.env.JAAS_KID && process.env.JAAS_PRIVATE_KEY) return { mode: 'jaas', domain: '8x8.vc', appId };
  const domain = (process.env.NEXT_PUBLIC_JITSI_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (domain) return { mode: 'self', domain };
  return null;
}

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

// JaaS meeting pass (JWT, RS256). Host: moderator + recording / transcription; trainees: guests.
export function jaasToken({ appId, room, name, id, moderator, minutes = 12 * 60 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: process.env.JAAS_KID.trim(), typ: 'JWT' };
  const payload = {
    aud: 'jitsi', iss: 'chat', sub: appId, room, nbf: now - 10, exp: now + minutes * 60,
    context: {
      user: { id: id || crypto.randomUUID(), name: name || 'Trainee', moderator: moderator ? 'true' : 'false' },
      features: { recording: moderator ? 'true' : 'false', transcription: moderator ? 'true' : 'false', livestreaming: 'false', 'outbound-call': 'false' },
    },
  };
  const data = `${b64u(header)}.${b64u(payload)}`;
  const key = process.env.JAAS_PRIVATE_KEY.replace(/\\n/g, '\n');
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(key).toString('base64url');
  return `${data}.${sig}`;
}
