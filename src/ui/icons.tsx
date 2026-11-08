import React from 'react';
type P = { size?: number; className?: string; strokeWidth?: number };
const S = ({ size = 18, className, strokeWidth = 1.7, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);
export const Icon = {
  chevron: (p: P) => <S {...p}><path d="m7 10 5 5 5-5" /></S>,
  search: (p: P) => <S {...p}><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></S>,
  pc: (p: P) => <S {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></S>,
  server: (p: P) => <S {...p}><rect x="5" y="3" width="14" height="8" rx="2" /><rect x="5" y="13" width="14" height="8" rx="2" /><path d="M9 7h.01M9 17h.01M13 7h3M13 17h3" /></S>,
  switch: (p: P) => <S {...p}><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M7 10.5h9l-2-2M17 13.5H8l2 2" /></S>,
  router: (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 6.5v4M10.3 8.2 12 6.5l1.7 1.7M12 17.5v-4M10.3 15.8 12 17.5l1.7-1.7M6.5 12h4M17.5 12h-4" /></S>,
  firewall: (p: P) => <S {...p}><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3Z" /><path d="M9 12h6M12 9v6" /></S>,
  ap: (p: P) => <S {...p}><path d="M5 10a10 10 0 0 1 14 0M8 13a5.5 5.5 0 0 1 8 0" /><circle cx="12" cy="16.5" r="1" /><rect x="6" y="19" width="12" height="2.5" rx="1.2" /></S>,
  cursor: (p: P) => <S {...p}><path d="M5 3.5 18 10l-5.5 1.8L10.5 18 5 3.5Z" /></S>,
  cable: (p: P) => <S {...p}><path d="M7 4v4a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v6" /><rect x="5" y="2" width="4" height="3" rx="1" /><rect x="15" y="19" width="4" height="3" rx="1" /></S>,
  note: (p: P) => <S {...p}><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4" /></S>,
  fit: (p: P) => <S {...p}><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></S>,
  plus: (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  minus: (p: P) => <S {...p}><path d="M5 12h14" /></S>,
  trash: (p: P) => <S {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>,
  copy: (p: P) => <S {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></S>,
  terminal: (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7 9 3 3-3 3M12.5 15H17" /></S>,
  play: (p: P) => <S {...p}><path d="M7 4.5v15l12-7.5z" /></S>,
  pause: (p: P) => <S {...p}><path d="M8 5v14M16 5v14" /></S>,
  next: (p: P) => <S {...p}><path d="M5 5v14l10-7zM19 5v14" /></S>,
  prev: (p: P) => <S {...p}><path d="M19 5v14L9 12zM5 5v14" /></S>,
  reset: (p: P) => <S {...p}><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></S>,
  sun: (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>,
  moon: (p: P) => <S {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></S>,
  book: (p: P) => <S {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></S>,
  folder: (p: P) => <S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>,
  save: (p: P) => <S {...p}><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></S>,
  download: (p: P) => <S {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></S>,
  upload: (p: P) => <S {...p}><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></S>,
  filePlus: (p: P) => <S {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></S>,
  x: (p: P) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>,
  check: (p: P) => <S {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></S>,
  bulb: (p: P) => <S {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" /></S>,
  info: (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></S>,
  menu: (p: P) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>,
  sliders: (p: P) => <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>,
  packet: (p: P) => <S {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></S>,
  sparkle: (p: P) => <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></S>,
};
// Illustrations vectorielles d’équipements, intégrées au fichier autonome.
export function DeviceIcon({ kind, size = 52, modelId }: { kind: string; size?: number; modelId?: string }) {
  const laptop = modelId === 'laptop';
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const screen = `screen-${uid}`, metal = `metal-${uid}`, body = `body-${uid}`;
  return <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true">
    <defs>
      <linearGradient id={screen} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#d8f0ff"/><stop offset="1" stopColor="#81b7db"/></linearGradient>
      <linearGradient id={metal} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#f3f7f9"/><stop offset="1" stopColor="#aabac4"/></linearGradient>
      <linearGradient id={body} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#7790a2"/><stop offset="1" stopColor="#435b6c"/></linearGradient>
    </defs>
    <ellipse cx="36" cy="64" rx="25" ry="3" fill="#536a79" opacity=".13"/>
    {kind === 'pc' && (laptop ? <>
      <rect x="9" y="11" width="54" height="38" rx="4" fill="#354b5d"/><rect x="12" y="14" width="48" height="32" rx="2" fill={`url(#${screen})`}/><circle cx="36" cy="12.8" r=".7" fill="#c2d0d9"/><path d="M6 49h60l-4 8H10z" fill={`url(#${metal})`}/><path d="M11 50h50M29 53h14" stroke="#8799a6" strokeWidth="1.5" strokeLinecap="round"/>
    </> : <>
      <rect x="5" y="11" width="49" height="36" rx="4" fill="#344a5b"/><rect x="8" y="14" width="43" height="29" rx="2" fill={`url(#${screen})`}/><path d="M12 17h31" stroke="#fff" opacity=".55" strokeWidth="1.5"/><circle cx="29.5" cy="45" r=".7" fill="#b5d6ec"/><path d="M29 47v7m-9 3h18" stroke="#8da2b0" strokeWidth="4" strokeLinecap="round"/><rect x="56" y="23" width="11" height="35" rx="2.5" fill={`url(#${body})`}/><path d="M59 28h5M59 31h5" stroke="#bfccd3" strokeWidth="1"/><circle cx="61.5" cy="52" r="1.3" fill="#79d7af"/>
    </>)}
    {kind === 'printer' && <><rect x="17" y="8" width="38" height="19" rx="3" fill="#e7eff3" stroke="#708695" strokeWidth="2"/><path d="M23 13h26M23 18h22" stroke="#a2b5c0" strokeWidth="1.5"/><rect x="10" y="24" width="52" height="29" rx="5" fill={`url(#${body})`}/><rect x="17" y="40" width="38" height="21" rx="2" fill="#f5f8fa" stroke="#9cacb6"/><path d="M23 46h26M23 51h22M23 56h20" stroke="#a2b5c0" strokeWidth="1.5"/><circle cx="53" cy="31" r="2" fill="#53c496"/></>}
    {kind === 'server' && <><rect x="14" y="5" width="44" height="59" rx="6" fill={`url(#${body})`}/><path d="M18 9h36v51H18z" fill="#506b7a"/>{[11,27,43].map(y=><g key={y}><rect x="19" y={y} width="34" height="13" rx="2.5" fill={`url(#${metal})`}/><path d={`M23 ${y+4}h15M23 ${y+7}h12`} stroke="#8d9faa" strokeWidth="1.5"/><circle cx="48" cy={y+6.5} r="1.8" fill="#36a978"/></g>)}</>}
    {(kind === 'switch' || kind === 'router' || kind === 'firewall') && <><rect x="5" y="21" width="62" height="31" rx="5" fill={`url(#${body})`}/><path d="M9 25h54v19H9z" fill={`url(#${metal})`}/><path d="M10 26h52" stroke="#fff" strokeWidth="1" opacity=".7"/>{kind === 'switch' ? <g fill="#435e70">{[0,1,2,3,4,5,6].map(i=><g key={i}><rect x={12+i*6} y="30" width="4.5" height="8" rx=".8"/><path d={`M${13+i*6} 31h2.5`} stroke="#9cb7c6" strokeWidth=".6"/></g>)}</g> : <><g fill="#496577">{[0,1,2,3].map(i=><rect key={i} x={13+i*8} y="30" width="6" height="8" rx="1"/>)}</g><path d="M49 30h9M49 33h9M49 36h9" stroke="#889da9" strokeWidth="1"/></>}<circle cx="59" cy="41" r="1.5" fill="#43b983"/><path d="M11 49h50" stroke="#aabdc8" opacity=".55" strokeWidth="1"/></>}
    {kind === 'ap' && <><path d="M19 25Q36 9 53 25M25 30Q36 20 47 30" stroke="#6c9fbe" strokeWidth="2.5" fill="none" strokeLinecap="round"/><rect x="10" y="34" width="52" height="23" rx="8" fill={`url(#${metal})`} stroke="#829aa8" strokeWidth="1.5"/><path d="M17 38h38" stroke="#fff" opacity=".65"/><circle cx="36" cy="47" r="2" fill="#39ab78"/></>}
    {kind === 'phone' && <><rect x="23" y="4" width="26" height="63" rx="9" fill={`url(#${body})`}/><rect x="26" y="9" width="20" height="22" rx="3" fill={`url(#${screen})`}/><path d="M29 12h11" stroke="#fff" opacity=".6"/><circle cx="36" cy="36" r="2.5" fill="#d1e0e7"/><g fill="#e3edf1">{[42,48,54,60].map(y=>[30,36,42].map(x=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.15"/>))}</g></>}
  </svg>;
}
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M9 11h14M9 16h14M9 21h14" opacity=".45" />
        <path d="M12 8v16M20 8v16" />
      </g>
      <circle cx="12" cy="16" r="2.6" fill="#fff" /><circle cx="20" cy="11" r="2.6" fill="#fff" /><circle cx="20" cy="21" r="2.6" fill="#fff" />
    </svg>
  );
}
