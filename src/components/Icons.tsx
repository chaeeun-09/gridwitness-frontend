const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const IconVillage = () => (
  <svg {...base}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></svg>
)
export const IconLive = () => (
  <svg {...base}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
)
export const IconAnalysis = () => (
  <svg {...base}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 16v-4M12 16V9M16 16v-6" /></svg>
)
export const IconSettings = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
)
/** 로고: 송전탑 + 지켜보는 센서 점 (public/favicon.svg와 같은 모양) */
export const IconLogo = () => (
  <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden>
    <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 18 L19 52 M32 18 L45 52" />
      <path d="M20 26 H44 M23 35 H41" />
      <path d="M26.5 35 L37.5 45 M37.5 35 L26.5 45" />
    </g>
    <circle cx="32" cy="11" r="5.5" fill="#7c97ff" />
  </svg>
)
export const IconDashboard = () => (
  <svg {...base}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
)
export const IconDatabase = () => (
  <svg {...base}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>
)
export const IconHistory = () => (
  <svg {...base}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
)
const small = { ...base, width: 16, height: 16 }
export const IconBolt = () => (
  <svg {...small}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
)
export const IconWave = () => (
  <svg {...small}><path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" /></svg>
)
export const IconShield = () => (
  <svg {...small}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
)
export const IconPlug = () => (
  <svg {...small}><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></svg>
)
export const IconHouse = () => (
  <svg {...small}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>
)
export const IconLamp = () => (
  <svg {...small}><path d="M9 21h6M12 21V9" /><path d="M12 9c0-3 2-5 5-5h1" /><path d="M16 4h4l-1 3h-2z" /></svg>
)
export const IconChevron = () => (
  <svg {...small}><path d="m9 6 6 6-6 6" /></svg>
)
export const IconMenu = () => (
  <svg {...small}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)
export const IconUpload = () => (
  <svg {...small}><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
)
export const IconAlert = () => (
  <svg {...small}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
)
export const IconInbox = () => (
  <svg {...small}><path d="M4 13h4l1 3h6l1-3h4" /><path d="M5 5h14l1 8v6H4v-6z" /></svg>
)
export const IconPlus = () => (
  <svg {...small}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconSun = () => (
  <svg {...small}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const IconMoon = () => (
  <svg {...small}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
)
export const IconX = () => (
  <svg {...small}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const IconDownload = () => (
  <svg {...small}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
)
export const IconPower = () => (
  <svg {...base} width={20} height={20} strokeWidth={2.2}><path d="M12 3v8" /><path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
)
export const IconShieldCheck = () => (
  <svg {...small}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
)
export const IconUsers = () => (
  <svg {...small}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c2 .8 3.5 2.8 3.5 5.6" /></svg>
)
export const IconSliders = () => (
  <svg {...small}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
)
export const IconArrowRight = () => (
  <svg {...small}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const IconBrain = () => (
  <svg {...small}><path d="M9 4a3 3 0 0 0-3 3v.3A3.5 3.5 0 0 0 4 10.5c0 1 .4 1.9 1.1 2.5A3.5 3.5 0 0 0 7 19a3 3 0 0 0 5-1.5V6a2 2 0 0 0-3-2z" /><path d="M15 4a3 3 0 0 1 3 3v.3a3.5 3.5 0 0 1 2 3.2c0 1-.4 1.9-1.1 2.5A3.5 3.5 0 0 1 17 19a3 3 0 0 1-5-1.5" /></svg>
)
export const IconBars = () => (
  <svg {...small}><path d="M5 20V12M12 20V5M19 20v-9" /></svg>
)
export const IconPerson = () => (
  <svg {...small}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /></svg>
)
export const IconSearch = () => (
  <svg {...small}><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></svg>
)
export const IconTower = () => (
  <svg {...small}><path d="M12 3v3M8 6h8M9.5 6 7 21M14.5 6 17 21M8.4 12h7.2M7.6 17h8.8M9 12l6 5M15 12l-6 5" /></svg>
)
