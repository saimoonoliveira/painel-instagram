import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { NOME } from "../lib/nome";

function Icon({ path }: { path: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

const brandIcon = <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-4.2A8.4 8.4 0 1 1 21 11.5z" />;
const logoutIcon = <><path d="M15 17l5-5-5-5" /><path d="M20 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></>;

// celular: true = aparece na barra de baixo; o resto fica no "Mais" (8 abas não cabem numa barra de celular)
const nav = [
  { to: "/", label: "Dashboard", curto: "Início", end: true, celular: true, icon: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></> },
  { to: "/posts", label: "Posts", celular: true, icon: <><rect x="6" y="3" width="14" height="16" rx="2" /><path d="M3 7v12a2 2 0 0 0 2 2h11" /><path d="m10 10 2.5 2.5L17 8" /></> },
  { to: "/contacts", label: "Contatos", icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></> },
  { to: "/conteudo", label: "Conteúdo", celular: true, icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></> },
  { to: "/monitor", label: "Monitor", icon: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></> },
  { to: "/flows", label: "Fluxos", icon: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H15a3 3 0 0 1 3 3v6.5" /></> },
  { to: "/triggers", label: "Gatilhos", icon: <path d="M13 2 4 14h7l-1 8 9-12h-7z" /> },
  { to: "/inbox", label: "Inbox", celular: true, icon: <><path d="M4 5h16v14H4z" /><path d="M4 9h5l1.5 2.5h3L15 9h5" /></> },
  { to: "/integracao", label: "Conexão", icon: <><path d="M9 7 5.5 10.5a4.95 4.95 0 0 0 7 7L16 14" /><path d="m15 17 3.5-3.5a4.95 4.95 0 0 0-7-7L8 10" /></> },
];
const navCelular = nav.filter((n) => n.celular);
const navMais = nav.filter((n) => !n.celular);
const maisIcon = <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>;

function signOut() { supabase.auth.signOut(); }

function label(a: { username: string | null; display_name: string | null }) {
  return a.username ? `@${a.username}` : (a.display_name ?? "conta");
}

function AccountSwitcher({ compact = false }: { compact?: boolean }) {
  const { accounts, accountId, setAccountId } = useAccounts();
  if (accounts.length === 0) return null;
  if (accounts.length === 1) {
    return <span className="truncate text-xs text-[var(--text-faint)]">{label(accounts[0])}</span>;
  }
  return (
    <select
      aria-label="Trocar de conta"
      value={accountId ?? ""}
      onChange={(e) => setAccountId(e.target.value)}
      className={`max-w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text-dim)] outline-none focus:border-[var(--accent-line)] ${compact ? "text-xs" : "mt-0.5 text-xs"}`}
    >
      {accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
    </select>
  );
}

// Folha do "Mais" no celular: as abas que não cabem na barra de baixo
function MaisSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label="Mais opções">
      <button className="absolute inset-0 bg-black/60" aria-label="Fechar" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--border)] bg-[var(--sidebar)] px-3 pt-2"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
        {navMais.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={onClose}
            className={({ isActive }) =>
              `flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                isActive ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text)] hover:bg-[var(--surface-hover)]"
              }`
            }
          >
            <Icon path={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <button onClick={signOut} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-[var(--text-dim)] hover:bg-[var(--surface-hover)]">
          <Icon path={logoutIcon} />
          Sair
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mais, setMais] = useState(false);
  const { pathname } = useLocation();
  const emMais = navMais.some((n) => pathname.startsWith(n.to));
  return (
    <div className="flex min-h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{brandIcon}</svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text)]" translate="no">{NOME}</div>
            <AccountSwitcher />
          </div>
        </div>
        <nav className="flex-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  isActive ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`
              }
            >
              <Icon path={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={signOut} className="m-3 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
          <Icon path={logoutIcon} />
          Sair
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--sidebar)]/90 px-4 py-3 backdrop-blur md:hidden" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{brandIcon}</svg>
            </div>
            <span className="text-sm font-semibold text-[var(--text)]" translate="no">{NOME}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <AccountSwitcher compact />
            <button onClick={signOut} aria-label="Sair" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
              <Icon path={logoutIcon} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-10">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom nav — mobile */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[var(--border)] bg-[var(--sidebar)]/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {navCelular.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                isActive && !mais ? "text-[var(--accent-hi)]" : "text-[var(--text-dim)]"
              }`
            }
          >
            <Icon path={n.icon} />
            {n.curto ?? n.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMais((v) => !v)}
          aria-expanded={mais}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
            mais || emMais ? "text-[var(--accent-hi)]" : "text-[var(--text-dim)]"
          }`}
        >
          <Icon path={maisIcon} />
          Mais
        </button>
      </nav>
      {mais && <MaisSheet onClose={() => setMais(false)} />}
    </div>
  );
}
