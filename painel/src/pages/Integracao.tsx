import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { useConfirm } from "../lib/confirm";
import { Button, Card, Empty } from "../components/ui";

const IG_APP_ID = import.meta.env.VITE_INSTAGRAM_APP_ID as string; // ID do app da Meta de cada instalação
const REDIRECT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth`;
// insights: métricas dos posts e da conta, lidas por apps externos (função metricas)
// content_publish: botão "Publicar agora" e agendamento da aba Posts (função publicar)
const SCOPE = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights,instagram_business_content_publish";

async function startConnect() {
  if (!IG_APP_ID) return alert("Falta configurar VITE_INSTAGRAM_APP_ID no painel (veja INSTALAR.md).");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const nonce = crypto.randomUUID();
  await supabase.from("oauth_pending").insert({ nonce, user_id: user.id });
  const p = new URLSearchParams({
    enable_fb_login: "0",
    force_authentication: "1",
    client_id: IG_APP_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    state: nonce,
  });
  window.location.href = `https://www.instagram.com/oauth/authorize?${p.toString()}`;
}

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

export default function Integracao() {
  const { account, loading } = useAccounts();
  const confirm = useConfirm();
  const [disconnecting, setDisconnecting] = useState(false);
  const [flash, setFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("conectado")) setFlash({ type: "ok", text: "Conexão atualizada com sucesso!" });
    else if (q.get("erro")) setFlash({ type: "err", text: `Não foi possível conectar (${q.get("erro")}). Tente de novo.` });
    if (q.get("conectado") || q.get("erro")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const expired = account?.token_expires_at ? new Date(account.token_expires_at) <= new Date() : false;
  const connected = !!account && account.is_active && !expired;

  async function disconnect() {
    if (!account) return;
    if (!(await confirm({ message: "Desconectar esta conta do Instagram? As automações dela vão parar até reconectar.", confirmLabel: "Desconectar", danger: true }))) return;
    setDisconnecting(true);
    await supabase.from("ig_account").update({ is_active: false }).eq("id", account.id);
    setDisconnecting(false);
    window.location.reload();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Conexão</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Sua conexão com o Instagram</p>
      </div>

      {flash && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            flash.type === "ok"
              ? "border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok)]"
              : "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]"
          }`}
          aria-live="polite"
        >
          {flash.text}
        </div>
      )}

      <Card className="p-6">
        {loading ? (
          <Empty>Carregando…</Empty>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] text-[var(--on-accent)]" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" /></svg>
                </div>
                <div>
                  <div className="text-base font-semibold text-[var(--text)]">Integração — Instagram</div>
                  <div className="text-xs text-[var(--text-faint)]">API do Instagram · comentários e mensagens</div>
                </div>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  connected ? "bg-[var(--ok)]/15 text-[var(--ok)]" : "bg-[var(--danger)]/15 text-[var(--danger)]"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--ok)]" : "bg-[var(--danger)]"}`} aria-hidden="true" />
                {connected ? "Conectado" : expired ? "Token expirado" : "Desconectado"}
              </span>
            </div>

            <p className="mt-4 text-sm text-[var(--text-dim)]">
              Conecte sua conta profissional do Instagram para o sistema responder comentários e DMs automaticamente.
            </p>

            {account && (
              <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">Conta do Instagram</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text)]">
                  {account.username ? `@${account.username}` : account.display_name ?? "—"}
                </div>
                <div className="nums mt-0.5 text-xs text-[var(--text-faint)]">ID: {account.ig_user_id}</div>
                {account.connected_at && (
                  <div className="mt-2 text-sm text-[var(--text-dim)]">Conectado em {fmtDate(account.connected_at)}</div>
                )}
                <div className={`text-sm ${expired ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>
                  Token válido até {fmtDate(account.token_expires_at)}
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={startConnect}>
                {account ? "Renovar conexão" : "Conectar Instagram"}
              </Button>
              {account && (
                <Button variant="ghost" onClick={startConnect}>Conectar outra conta</Button>
              )}
              {account?.is_active && (
                <Button variant="danger" onClick={disconnect} disabled={disconnecting}>
                  {disconnecting ? "Desconectando…" : "Desconectar"}
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-[var(--text-faint)]">
        Ao clicar em conectar, você faz login no Instagram e autoriza o app. O token dura ~60 dias — é só tocar em “Renovar conexão” quando quiser estender.
      </p>
    </div>
  );
}
