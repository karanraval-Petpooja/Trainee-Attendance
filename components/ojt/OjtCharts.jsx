'use client';
import { useRef, useState } from 'react';
import { Check, Download, Image as ImageIcon, Table2 } from 'lucide-react';
import { hasScores, summarizeOjt } from '@/lib/ojt';
import { useApp } from '../AppShell';

// Charts are plain SVG so they can be downloaded as PNG or copied as an image without extra libraries.
const FONT = 'Manrope, Segoe UI, Arial, sans-serif';
const C = { pass: '#10b981', fail: '#ef4444', absent: '#f59e0b', none: '#cbd5e1', present: '#10b981', ink: '#1D2750', grid: '#e2e8f0', text: '#334155', muted: '#94a3b8', bar: '#34437A' };

// ---------- export helpers ----------
async function svgToPngBlob(svg, scale = 2) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth;
  const h = vb && vb.height ? vb.height : svg.clientHeight;
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}
const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

function ChartCard({ title, subtitle, data, children, fileBase }) {
  const { showToast } = useApp();
  const box = useRef(null);
  const [done, setDone] = useState('');
  const flash = (k) => { setDone(k); setTimeout(() => setDone(''), 1500); };
  const svg = () => box.current?.querySelector('svg');
  const download = async () => saveBlob(await svgToPngBlob(svg()), `${fileBase}_${slug(title)}.png`);
  const copyImage = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPngBlob(svg()) })]);
      flash('img'); showToast('Chart copied. Paste it into Slides, Docs, WhatsApp or email.');
    } catch { showToast('Your browser blocked copying images. Use Download instead.', 'error'); }
  };
  const copyData = async () => {
    const tsv = data.map((r) => r.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); flash('data'); showToast('Data copied. Paste it into Excel or Google Sheets.'); }
    catch { showToast('Copy failed.', 'error'); }
  };
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div><h3 className="text-base font-bold">{title}</h3>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost btn-sm" onClick={download} title="Download as PNG"><Download size={14} />PNG</button>
          <button className="btn-ghost btn-sm" onClick={copyImage} title="Copy image to paste anywhere">{done === 'img' ? <Check size={14} /> : <ImageIcon size={14} />}Copy image</button>
          <button className="btn-ghost btn-sm" onClick={copyData} title="Copy the numbers to paste into Excel / Sheets">{done === 'data' ? <Check size={14} /> : <Table2 size={14} />}Copy data</button>
        </div>
      </div>
      <div ref={box} className="p-3">{children}</div>
    </section>
  );
}

// ---------- chart shapes ----------
function Donut({ title, items, centerLabel }) {
  const W = 560; const H = 300; const cx = 145; const cy = 155; const r = 105; const ir = 64;
  const total = items.reduce((n, x) => n + x.value, 0) || 1;
  let a0 = -Math.PI / 2;
  const arcs = items.filter((x) => x.value > 0).map((x) => {
    const a1 = a0 + (x.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const full = x.value === total;
    const d = full
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} M ${cx - ir} ${cy} A ${ir} ${ir} 0 1 0 ${cx + ir} ${cy} A ${ir} ${ir} 0 1 0 ${cx - ir} ${cy} Z`
      : `M ${p(a0, r).join(' ')} A ${r} ${r} 0 ${large} 1 ${p(a1, r).join(' ')} L ${p(a1, ir).join(' ')} A ${ir} ${ir} 0 ${large} 0 ${p(a0, ir).join(' ')} Z`;
    const out = { ...x, d };
    a0 = a1;
    return out;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" fontFamily={FONT} role="img" aria-label={title}>
      <rect width={W} height={H} fill="#fff" />
      <text x="20" y="28" fontSize="16" fontWeight="700" fill={C.ink}>{title}</text>
      {arcs.map((x) => <path key={x.label} d={x.d} fill={x.color} fillRule="evenodd" stroke="#fff" strokeWidth="2" />)}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="28" fontWeight="800" fill={C.ink}>{centerLabel.value}</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="12" fill={C.muted}>{centerLabel.label}</text>
      {items.map((x, i) => (
        <g key={x.label} transform={`translate(290, ${95 + i * 40})`}>
          <rect width="16" height="16" rx="4" fill={x.color} />
          <text x="26" y="13" fontSize="14" fill={C.text}>{x.label}</text>
          <text x="200" y="13" fontSize="14" fontWeight="700" fill={C.ink} textAnchor="end">{x.value}</text>
          <text x="206" y="13" fontSize="12" fill={C.muted}>{`(${Math.round(x.value * 1000 / total) / 10}%)`}</text>
        </g>
      ))}
    </svg>
  );
}

function Bars({ title, items, color = C.bar, xLabel, yLabel }) {
  const W = 640; const H = 320; const L = 52; const R = 16; const T = 48; const B = 56;
  const max = Math.max(1, ...items.map((x) => x.value));
  const step = Math.max(1, Math.ceil(max / 5));
  const top = step * Math.ceil(max / step);
  const bw = (W - L - R) / Math.max(1, items.length);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" fontFamily={FONT} role="img" aria-label={title}>
      <rect width={W} height={H} fill="#fff" />
      <text x="20" y="28" fontSize="16" fontWeight="700" fill={C.ink}>{title}</text>
      {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.grid} /><text x={L - 8} y={y(v) + 4} fontSize="11" fill={C.muted} textAnchor="end">{v}</text></g>
      ))}
      {items.map((x, i) => {
        const h = y(0) - y(x.value);
        return (
          <g key={x.label}>
            <rect x={L + i * bw + bw * 0.18} y={y(x.value)} width={bw * 0.64} height={Math.max(h, 0)} rx="4" fill={x.color || color} />
            {x.value > 0 && <text x={L + i * bw + bw / 2} y={y(x.value) - 6} fontSize="12" fontWeight="700" fill={C.ink} textAnchor="middle">{x.value}</text>}
            <text x={L + i * bw + bw / 2} y={H - B + 18} fontSize="12" fill={C.text} textAnchor="middle">{x.label}</text>
          </g>
        );
      })}
      {xLabel && <text x={(W + L) / 2} y={H - 12} fontSize="12" fill={C.muted} textAnchor="middle">{xLabel}</text>}
      {yLabel && <text x="14" y={T + (H - T - B) / 2} fontSize="12" fill={C.muted} textAnchor="middle" transform={`rotate(-90 14 ${T + (H - T - B) / 2})`}>{yLabel}</text>}
    </svg>
  );
}

function HBars({ title, items, max, suffix = '' }) {
  const rowH = 22; const T = 46; const L = 230; const R = 60; const W = 700;
  const H = T + items.length * rowH + 16;
  const m = max || Math.max(1, ...items.map((x) => x.value));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" fontFamily={FONT} role="img" aria-label={title}>
      <rect width={W} height={H} fill="#fff" />
      <text x="20" y="28" fontSize="16" fontWeight="700" fill={C.ink}>{title}</text>
      {items.map((x, i) => (
        <g key={`${x.label}-${i}`} transform={`translate(0, ${T + i * rowH})`}>
          <text x={L - 10} y="15" fontSize="12" fill={C.text} textAnchor="end">{x.label.length > 27 ? `${x.label.slice(0, 26)}…` : x.label}</text>
          <rect x={L} y="4" width={W - L - R} height="14" rx="3" fill="#f1f5f9" />
          <rect x={L} y="4" width={Math.max(2, (W - L - R) * (x.value / m))} height="14" rx="3" fill={x.color} />
          <text x={L + (W - L - R) * (x.value / m) + 6} y="15" fontSize="11" fontWeight="700" fill={C.ink}>{`${x.value}${suffix}`}</text>
        </g>
      ))}
    </svg>
  );
}

function GroupBars({ title, groups, series }) {
  const W = 700; const H = 340; const L = 48; const R = 16; const T = 60; const B = 70;
  const gw = (W - L - R) / Math.max(1, groups.length);
  const y = (v) => T + (H - T - B) * (1 - v / 100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" fontFamily={FONT} role="img" aria-label={title}>
      <rect width={W} height={H} fill="#fff" />
      <text x="20" y="28" fontSize="16" fontWeight="700" fill={C.ink}>{title}</text>
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(${20 + i * 150}, 40)`}><rect width="12" height="12" rx="3" fill={s.color} /><text x="18" y="11" fontSize="12" fill={C.text}>{s.label}</text></g>
      ))}
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.grid} /><text x={L - 8} y={y(v) + 4} fontSize="11" fill={C.muted} textAnchor="end">{v}%</text></g>
      ))}
      {groups.map((g, gi) => {
        const bw = (gw * 0.7) / series.length;
        return (
          <g key={g.label}>
            {series.map((s, si) => {
              const v = g[s.key] ?? 0;
              const x = L + gi * gw + gw * 0.15 + si * bw;
              return (
                <g key={s.key}>
                  <rect x={x} y={y(v)} width={bw - 3} height={y(0) - y(v)} rx="3" fill={s.color} />
                  <text x={x + (bw - 3) / 2} y={y(v) - 5} fontSize="10" fontWeight="700" fill={C.ink} textAnchor="middle">{Math.round(v)}</text>
                </g>
              );
            })}
            <text x={L + gi * gw + gw / 2} y={H - B + 18} fontSize="11" fill={C.text} textAnchor="middle">{g.label.length > 16 ? `${g.label.slice(0, 15)}…` : g.label}</text>
            <text x={L + gi * gw + gw / 2} y={H - B + 34} fontSize="10" fill={C.muted} textAnchor="middle">{g.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- the chart set ----------
export default function OjtCharts({ sessions }) {
  const rows = sessions.flatMap((s) => s.rows);
  const c = summarizeOjt(rows);
  const scored = hasScores(rows);
  const fileBase = sessions.length === 1 ? slug(sessions[0].title) : 'OJT';
  const many = sessions.length > 1;
  const subtitle = many ? `${sessions.length} sessions · ${rows.length} participants` : `${sessions[0]?.title || ''}${sessions[0]?.date ? ` · ${sessions[0].date}` : ''}`;

  const resultItems = [
    { label: 'Pass', value: c.pass, color: C.pass }, { label: 'Fail', value: c.fail, color: C.fail },
    { label: 'Absent (assessment)', value: c.assessAbsent, color: C.absent },
    ...(c.noScore ? [{ label: 'No score', value: c.noScore, color: C.none }] : []),
  ];
  const attItems = [{ label: 'Present', value: c.present, color: C.present }, { label: 'Absent', value: c.absent, color: C.fail }];

  const totals = rows.map((r) => r.total).filter(Boolean);
  const maxTotal = totals.length ? Math.max(...totals) : 0;
  const scoreValues = rows.filter((r) => r.score !== null && r.total === maxTotal).map((r) => r.score);
  const lowest = scoreValues.length ? Math.max(0, Math.min(...scoreValues) - 1) : 0;
  const scoreItems = maxTotal ? Array.from({ length: maxTotal - lowest + 1 }, (_, i) => i + lowest).map((s) => ({
    label: String(s), value: rows.filter((r) => r.score === s && r.total === maxTotal).length,
    color: rows.find((r) => r.score === s && r.result) ? (rows.find((r) => r.score === s && r.result).result === 'Pass' ? C.pass : C.fail) : C.bar,
  })) : [];
  // Groups follow the session length: 15-minute groups for short sessions, hours for long ones
  const longest = Math.max(0, ...rows.map((r) => r.duration_minutes || 0));
  const size = longest <= 90 ? 15 : longest <= 180 ? 30 : 60;
  const groups = Math.min(8, Math.max(2, Math.ceil((longest + 1) / size)));
  const label = (m) => (size < 60 ? `${m}` : `${m / 60}`);
  const unit = size < 60 ? ' min' : ' hr';
  const buckets = Array.from({ length: groups }, (_, i) => {
    const a = i * size; const last = i === groups - 1; const b = last ? 1e9 : a + size - 1;
    return { label: last ? `${label(a)}${unit}+` : `${label(a)}–${label(a + size)}${unit}`, value: rows.filter((r) => r.duration_minutes !== null && r.duration_minutes >= a && r.duration_minutes <= b).length };
  });
  const people = rows.filter((r) => r.score !== null && r.total)
    .map((r) => ({ label: r.full_name, value: Math.round(r.score * 1000 / r.total) / 10, color: r.result === 'Pass' ? C.pass : C.fail }))
    .sort((a, b) => b.value - a.value);
  const timed = rows.filter((r) => r.duration_minutes !== null && r.duration_minutes !== undefined)
    .map((r) => ({ label: r.full_name, value: r.duration_minutes, att: r.attendance || '', color: r.attendance === 'A' ? C.fail : C.pass }))
    .sort((a, b) => b.value - a.value);
  const perSession = sessions.map((s) => { const k = summarizeOjt(s.rows); return { label: s.title, sub: s.date || '', attendance: k.attendancePct || 0, pass: k.passPct || 0, avg: k.avgScorePct || 0 }; });

  if (!rows.length) return <div className="panel p-8 text-center text-sm text-slate-500">No participants to chart yet.</div>;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        {scored && <ChartCard title="Assessment result" subtitle={subtitle} fileBase={fileBase}
          data={[['Result', 'Count'], ...resultItems.map((x) => [x.label, x.value])]}>
          <Donut title="Assessment result" items={resultItems} centerLabel={{ value: c.passPct === null ? '—' : `${c.passPct}%`, label: 'pass rate' }} />
        </ChartCard>}
        <ChartCard title="Attendance" subtitle={subtitle} fileBase={fileBase}
          data={[['Attendance', 'Count'], ...attItems.map((x) => [x.label, x.value])]}>
          <Donut title="Attendance" items={attItems} centerLabel={{ value: c.attendancePct === null ? '—' : `${c.attendancePct}%`, label: 'present' }} />
        </ChartCard>
        {scored && scoreItems.length > 0 && (
          <ChartCard title="Score distribution" subtitle={`Out of ${maxTotal} · green = pass, red = fail`} fileBase={fileBase}
            data={[['Score', 'Participants'], ...scoreItems.map((x) => [x.label, x.value])]}>
            <Bars title={`Score distribution (out of ${maxTotal})`} items={scoreItems} xLabel="Score" yLabel="Participants" />
          </ChartCard>
        )}
        <ChartCard title="Time attended" subtitle={c.avgMinutes ? `Average ${Math.floor(c.avgMinutes / 60)} hr ${c.avgMinutes % 60} min` : subtitle} fileBase={fileBase}
          data={[['Time attended', 'Participants'], ...buckets.map((x) => [x.label, x.value])]}>
          <Bars title="Time attended" items={buckets} xLabel="Duration in the session" yLabel="Participants" />
        </ChartCard>
      </div>
      {many && (
        <ChartCard title="Sessions compared" subtitle={scored ? 'Attendance %, pass % and average score % per session' : 'Attendance % per session'} fileBase={fileBase}
          data={[['Session', 'Date', 'Attendance %', 'Pass %', 'Average score %'], ...perSession.map((s) => [s.label, s.sub, s.attendance, s.pass, s.avg])]}>
          <GroupBars title="Sessions compared" groups={perSession}
            series={scored
              ? [{ key: 'attendance', label: 'Attendance %', color: C.bar }, { key: 'pass', label: 'Pass %', color: C.pass }, { key: 'avg', label: 'Average score %', color: C.absent }]
              : [{ key: 'attendance', label: 'Attendance %', color: C.bar }]} />
        </ChartCard>
      )}
      {!scored && timed.length > 0 && (
        <ChartCard title="Time attended by participant" subtitle="Red = below the minimum (Absent)" fileBase={fileBase}
          data={[['Participant', 'Minutes', 'Attendance'], ...timed.map((x) => [x.label, x.value, x.att])]}>
          <HBars title="Time attended by participant (minutes)" items={timed} suffix=" min" />
        </ChartCard>
      )}
      {scored && people.length > 0 && (
        <ChartCard title="Score by participant" subtitle="Score %, highest first" fileBase={fileBase}
          data={[['Participant', 'Score %'], ...people.map((x) => [x.label, x.value])]}>
          <HBars title="Score by participant (%)" items={people} max={100} suffix="%" />
        </ChartCard>
      )}
    </div>
  );
}

export { svgToPngBlob, saveBlob };
