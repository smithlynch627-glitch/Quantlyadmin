// Quantly Admin (internal tool). Roles: owner > admin > support; the API re-checks the role on every call.
// Owner actions on the contracts go through the Safe multisig: proposals are signed and executed in this panel.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { SITE_URL, activeChain } from './config';
import { clearSession } from './lib/session';
import { short } from './lib/format';
import { RANK, useMe, useOverview, type Role } from './lib/queries';
import { useProposals, useSafeInfo } from './lib/useSafe';
import { Address, FloatingMenu, Skeleton, explorer, useToast } from './components/ui';
import { useWalletUI } from './components/Wallet';
import {
  IconCopy, IconDownload, IconExternal, IconHome, IconLayers, IconLifebuoy, IconLock, IconLogs, IconLogoutAlt, IconMenu, IconMoon, IconNetwork,
  IconPen, IconSettings, IconShield, IconSliders, IconStar, IconSun, IconUsers, IconVault, IconWallet,
} from './components/Icons';
import Overview from './pages/Overview';
import Treasury from './pages/Treasury';
import Multisig from './pages/Multisig';
import Collections from './pages/Collections';
import Import from './pages/Import';
import Contracts from './pages/Contracts';
import Support from './pages/Support';
import Logs from './pages/Logs';
import SiteSettings from './pages/SiteSettings';
import BrandingPage from './pages/Branding';
import LegalPages from './pages/LegalPages';
import Team from './pages/Team';
import Network from './pages/Network';

const LOGO = 'https://res.cloudinary.com/otqaz5kp/image/upload/v1791035090/photo_2026-10-03_19-14-32.jpg';
const useBuiltInLogo = (e: { currentTarget: HTMLImageElement }) => { if (!e.currentTarget.src.endsWith('/logo.svg')) e.currentTarget.src = '/logo.svg'; };

export type Route = 'overview' | 'treasury' | 'multisig' | 'collections' | 'import' | 'contracts' | 'support' | 'logs' | 'settings' | 'branding' | 'legal' | 'team' | 'network';
export interface PageProps { role: Role; go: (r: Route) => void }
type NavItem = { id: Route; label: string; icon: ComponentType<{ size?: number }>; min: Role; title: string; sub: string; page: ComponentType<PageProps> };

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Dashboard', items: [
    { id: 'overview', label: 'Overview', icon: IconHome, min: 'support', title: 'Overview', sub: 'Marketplace health at a glance', page: Overview },
  ] },
  { group: 'Funds', items: [
    { id: 'treasury', label: 'Treasury', icon: IconVault, min: 'admin', title: 'Treasury', sub: 'Fee balances, withdrawals and their status', page: Treasury },
    { id: 'multisig', label: 'Multisig', icon: IconShield, min: 'admin', title: 'Multisig', sub: 'Safe owners, signatures and the transaction queue', page: Multisig },
  ] },
  { group: 'Marketplace', items: [
    { id: 'collections', label: 'Collections', icon: IconLayers, min: 'admin', title: 'Collections', sub: 'Visibility, verification and trading', page: Collections },
    { id: 'import', label: 'Import', icon: IconDownload, min: 'admin', title: 'Import collections', sub: 'Bring existing QMS collections to Quantly', page: Import },
    { id: 'contracts', label: 'Contracts & fees', icon: IconSliders, min: 'admin', title: 'Contracts & fees', sub: 'Marketplace, launchpad and pause controls', page: Contracts },
  ] },
  { group: 'Operations', items: [
    { id: 'support', label: 'Support', icon: IconLifebuoy, min: 'support', title: 'Support tickets', sub: 'Questions and problems from users', page: Support },
    { id: 'logs', label: 'Activity log', icon: IconLogs, min: 'admin', title: 'Activity log', sub: 'Every admin action, newest first', page: Logs },
  ] },
  { group: 'Settings', items: [
    { id: 'settings', label: 'Site settings', icon: IconSettings, min: 'admin', title: 'Site settings', sub: 'Community links on the website', page: SiteSettings },
    { id: 'branding', label: 'Logo & official collection', icon: IconStar, min: 'admin', title: 'Logo & official collection', sub: 'Site logo and the official collection\'s name, supply and artwork, live without a redeploy', page: BrandingPage },
    { id: 'legal', label: 'Legal pages', icon: IconPen, min: 'admin', title: 'Legal pages', sub: 'Terms of Use and Privacy Policy', page: LegalPages },
    { id: 'team', label: 'Team', icon: IconUsers, min: 'owner', title: 'Team', sub: 'Who can open this panel', page: Team },
    { id: 'network', label: 'Network', icon: IconNetwork, min: 'owner', title: 'Network', sub: 'Chain, RPC and contract addresses', page: Network },
  ] },
];
const ALL = NAV.flatMap((g) => g.items);

function useRoute(): [Route, (r: Route) => void] {
  const read = () => (window.location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] || 'overview') as Route;
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => { if (read() !== r) window.location.hash = `/${r}`; }, []);
  return [route, go];
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('quantly.admin.theme', next); } catch {}
    setTheme(next);
  };
  return [theme, toggle];
}

function Gate({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate__card rise">
        <img src={LOGO} alt="" onError={useBuiltInLogo} />
        <div className="stack" style={{ gap: 6 }}><h1>{title}</h1>{children && <div className="soft small">{children}</div>}</div>
        {action}
        <div className="tiny muted row" style={{ gap: 6 }}><IconLock size={13} />Quantly Admin · {activeChain.name}</div>
      </div>
    </div>
  );
}

export default function AdminApp({ apiReachable }: { apiReachable: boolean }) {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnect, forget } = useWalletUI();
  const me = useMe();
  const role = me.data?.role;
  const logout = () => { clearSession(address); forget(); disconnect(); };

  if (!apiReachable) {
    return <Gate title="API not reachable">Check VITE_API_URL, and that this site's address ({window.location.origin}) is in ADMIN_ORIGINS on the backend.</Gate>;
  }
  if (!address) {
    return <Gate title="Quantly Admin" action={<button className="btn btn--lg" onClick={openConnect}><IconWallet size={18} />Connect admin wallet</button>}>Sign in with an admin wallet. A hardware wallet is recommended for Safe owners.</Gate>;
  }
  if (me.isLoading) return <div className="gate"><div className="gate__card"><Skeleton h={56} w={56} r={16} /><Skeleton h={22} w={220} /><Skeleton h={42} w={200} r={99} /></div></div>;
  if (!role) {
    return (
      <Gate title="No admin access" action={<div className="row-wrap" style={{ justifyContent: 'center' }}><button className="btn" onClick={() => me.refetch()}>Sign in again</button><button className="btn btn--outline" onClick={logout}>Disconnect</button></div>}>
        {(me.error as Error)?.message || `${short(address)} is not an admin.`}
      </Gate>
    );
  }
  return <Shell role={role} address={address} logout={logout} />;
}

function Shell({ role, address, logout }: { role: Role; address: string; logout: () => void }) {
  const [route, go] = useRoute();
  const [open, setOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const allowed = ALL.filter((i) => RANK[role] >= RANK[i.min]);
  const current = allowed.find((i) => i.id === route) || allowed[0];
  const isAdmin = RANK[role] >= RANK.admin;
  const overview = useOverview();
  const queue = useProposals('queue', isAdmin);
  const safe = useSafeInfo();
  const me = address.toLowerCase();
  const toSign = useMemo(() => {
    if (!isAdmin || !safe.data?.owners.includes(me)) return 0;
    return (queue.data?.proposals || []).filter((p) => !p.signatures.some((s) => s.signer === me)).length;
  }, [isAdmin, queue.data, safe.data, me]);
  const badges: Partial<Record<Route, { n: number; alert?: boolean }>> = {
    multisig: { n: toSign || (queue.data?.proposals.length ?? 0), alert: toSign > 0 },
    support: { n: overview.data?.tickets.open ?? 0 },
  };
  useEffect(() => { setOpen(false); }, [route]);
  const Page = current.page;
  const status = overview.data?.network.status;

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Admin navigation">
        <div className="sidebar__brand">
          <img src={LOGO} alt="" onError={useBuiltInLogo} />
          <div><b>Quantly Admin</b><span>Launchpad & Marketplace</span></div>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => RANK[role] >= RANK[i.min]);
          if (!items.length) return null;
          return (
            <nav className="nav-group" key={g.group} aria-label={g.group}>
              <div className="nav-group__label">{g.group}</div>
              {items.map((i) => {
                const b = badges[i.id];
                return (
                  <a key={i.id} href={`#/${i.id}`} className="nav-item" aria-current={current.id === i.id ? 'page' : undefined} onClick={() => setOpen(false)}>
                    <i.icon size={18} />{i.label}
                    {b && b.n > 0 && <span className={`nav-item__badge ${b.alert ? 'nav-item__badge--alert' : ''}`} title={i.id === 'multisig' && b.alert ? 'Waiting for your signature' : undefined}>{b.n}</span>}
                  </a>
                );
              })}
            </nav>
          );
        })}
        <div className="sidebar__foot">
          <div className="net-card">
            <span className={`live-dot ${status?.degraded ? 'live-dot--bad' : ''}`} />
            <div style={{ minWidth: 0 }}><b>{activeChain.name}</b><span className="muted">Chain {activeChain.id}{overview.data?.network.isTestnet ? ' · testnet' : ''}</span></div>
          </div>
          <a className="nav-item" href={SITE_URL} target="_blank" rel="noreferrer"><IconExternal size={17} />Open marketplace</a>
        </div>
      </aside>
      <div className={`scrim ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}><IconMenu size={18} /></button>
          <div className="topbar__title"><h1>{current.title}</h1><p>{current.sub}</p></div>
          <div className="topbar__right">
            <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
            <WalletMenu address={address} role={role} logout={logout} isOwner={!!safe.data?.owners.includes(me)} />
          </div>
        </header>
        <main className="content" key={current.id}>
          <Page role={role} go={go} />
        </main>
      </div>
    </div>
  );
}

function WalletMenu({ address, role, logout, isOwner }: { address: string; role: Role; logout: () => void; isOwner: boolean }) {
  const toast = useToast();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={btn} className="wallet-chip" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar-dot" style={{ background: `linear-gradient(135deg, #${address.slice(2, 8)}, #${address.slice(-6)})` }} />
        <span className="hide-sm mono">{short(address)}</span>
        <span className="tag tag--ink">{role}</span>
      </button>
      <FloatingMenu anchor={btn} open={open} onClose={close} minWidth={260}>
        <div className="float-menu__head">
          <div className="tiny muted">Signed in as {role}{isOwner ? ' · Safe owner' : ''}</div>
          <div className="row" style={{ marginTop: 4 }}><Address value={address} /></div>
        </div>
        <hr />
        <a href={explorer('address', address)} target="_blank" rel="noreferrer"><IconExternal size={16} />View on explorer</a>
        <button onClick={() => { navigator.clipboard?.writeText(address).then(() => toast('Address copied', 'success')); }}><IconCopy size={16} />Copy address</button>
        <hr />
        <button className="is-danger" onClick={logout}><IconLogoutAlt size={16} />Disconnect</button>
      </FloatingMenu>
    </>
  );
}
