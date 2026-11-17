import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { Card, Empty } from "../components/ui";

interface Msg { direction: "in" | "out"; channel: string; trigger_id: string | null; created_at: string; }
interface Contact { id: string; created_at: string; messaging_window_until: string | null; username: string | null; last_interaction_at: string; }
interface Trig { id: string; keyword: string | null; source: string; }

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtDay(d: Date) { return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); }

export default function Dashboard() {
  const { accountId } = useAccounts();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [trigs, setTrigs] = useState<Trig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) { setMsgs([]); setContacts([]); setTrigs([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const [m, c, t] = await Promise.all([
        supabase.from("messages").select("direction,channel,trigger_id,created_at").eq("ig_account_id", accountId).order("created_at", { ascending: false }).limit(5000),
        supabase.from("contacts").select("id,created_at,messaging_window_until,username,last_interaction_at").eq("ig_account_id", accountId).order("last_interaction_at", { ascending: false }).limit(5000),
        supabase.from("triggers").select("id,keyword,source").eq("ig_account_id", accountId),
      ]);
      setMsgs((m.data as Msg[]) ?? []);
      setContacts((c.data as Contact[]) ?? []);
      setTrigs((t.data as Trig[]) ?? []);
      setLoading(false);
    })();
  }, [accountId]);

  if (loading) return <Empty>Carregando…</Empty>;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);

  const dmsSent = msgs.filter((m) => m.direction === "out").length;
  const commentsIn = msgs.filter((m) => m.direction === "in" && m.channel === "comment").length;
  const newContacts7d = contacts.filter((c) => new Date(c.created_at) >= weekAgo).length;
  const windowsOpen = contacts.filter((c) => c.messaging_window_until && new Date(c.messaging_window_until) > now).length;

  const days: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = startOfDay(new Date(now.getTime() - i * 864e5));
    const next = new Date(day.getTime() + 864e5);
    const count = msgs.filter((m) => m.direction === "out" && new Date(m.created_at) >= day && new Date(m.created_at) < next).length;
    days.push({ label: fmtDay(day), count });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.count));

  const byTrig = new Map<string, number>();
  msgs.filter((m) => m.direction === "out" && m.trigger_id).forEach((m) => {
    byTrig.set(m.trigger_id!, (byTrig.get(m.trigger_id!) ?? 0) + 1);
  });
  const ranking = [...byTrig.entries()]
    .map(([id, count]) => ({ trig: trigs.find((t) => t.id === id), count }))
    .filter((r) => r.trig)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const kpis = [
    { label: "Contatos", value: contacts.length, hint: `${newContacts7d} nos últimos 7 dias` },
    { label: "DMs Enviadas", value: dmsSent, hint: "respostas automáticas" },
    { label: "Comentários", value: commentsIn, hint: "que dispararam fluxo" },
    { label: "Janelas 24h", value: windowsOpen, hint: "podem receber DM agora" },
  ];

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Visão geral das suas automações</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="relative overflow-hidden p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-line)] to-transparent" aria-hidden="true" />
            <div className="nums text-3xl font-semibold text-[var(--text)]">{k.value}</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">{k.label}</div>
            <div className="mt-0.5 text-xs text-[var(--text-faint)]">{k.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-5 text-sm font-medium text-[var(--text-dim)]">DMs Enviadas · últimos 7 dias</div>
          {days.every((d) => d.count === 0) && (
            <p className="mb-2 text-xs text-[var(--text-faint)]">Nenhuma DM enviada nos últimos 7 dias.</p>
          )}
          <div className="flex h-48 items-end gap-3">
            {days.map((d) => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="nums text-xs font-medium text-[var(--text-dim)]">{d.count || ""}</div>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-[var(--accent)] to-[var(--accent-hi)]"
                  style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? "6px" : "0" }}
                />
                <div className="nums text-[10px] text-[var(--text-faint)]">{d.label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 text-sm font-medium text-[var(--text-dim)]">Gatilhos Mais Acionados</div>
          {ranking.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--text-faint)]">Sem ativações ainda</div>
          ) : (
            <div className="space-y-3">
              {ranking.map((r) => (
                <div key={r.trig!.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text)]">
                      {r.trig!.keyword ? `“${r.trig!.keyword}”` : "Qualquer texto"}
                    </div>
                    <div className="text-xs text-[var(--text-faint)]">{r.trig!.source === "comment" ? "Comentário" : "Direct"}</div>
                  </div>
                  <div className="nums shrink-0 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent-hi)]">
                    {r.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-4 text-sm font-medium text-[var(--text-dim)]">Contatos Recentes</div>
        {contacts.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-faint)]">Nenhum contato ainda</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {contacts.slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 truncate text-sm font-medium text-[var(--text)]">{c.username ? `@${c.username}` : c.id}</div>
                <div className="nums shrink-0 text-xs text-[var(--text-faint)]">{new Date(c.last_interaction_at).toLocaleString("pt-BR")}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
