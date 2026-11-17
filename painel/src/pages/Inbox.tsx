import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import type { Contact, Message } from "../lib/types";
import { Card, Empty } from "../components/ui";

export default function Inbox() {
  const { accountId } = useAccounts();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) { setContacts([]); setSelected(null); setLoading(false); return; }
    setLoading(true);
    setSelected(null);
    supabase
      .from("contacts")
      .select("*")
      .eq("ig_account_id", accountId)
      .order("last_interaction_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setContacts((data as Contact[]) ?? []);
        setLoading(false);
      });
  }, [accountId]);

  useEffect(() => {
    if (!selected) return;
    supabase
      .from("messages")
      .select("*")
      .eq("contact_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setMessages((data as Message[]) ?? []));
  }, [selected]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[var(--text)]">Inbox</h1>
      <Card className="flex h-[75vh] overflow-hidden">
        {/* Lista de contatos — some no mobile quando há conversa aberta */}
        <div className={`w-full shrink-0 overflow-auto border-r border-[var(--border)] md:block md:w-64 ${selected ? "hidden" : "block"}`}>
          {loading ? (
            <Empty>Carregando…</Empty>
          ) : contacts.length === 0 ? (
            <Empty>Sem conversas</Empty>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${
                  selected?.id === c.id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <div className="truncate text-sm font-medium text-[var(--text)]">
                  {c.username ? `@${c.username}` : c.igsid}
                </div>
                <div className="nums text-xs text-[var(--text-faint)]">
                  {new Date(c.last_interaction_at).toLocaleDateString("pt-BR")}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Conversa — some no mobile quando nenhuma está aberta */}
        <div className={`flex-1 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
          {!selected ? (
            <Empty>Selecione uma conversa</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--text)]">
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Voltar para a lista"
                  className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--surface-hover)] md:hidden"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                {selected.username ? `@${selected.username}` : selected.igsid}
              </div>
              <div className="flex-1 space-y-3 overflow-auto bg-[var(--bg)] px-4 py-4 md:px-5">
                {messages.length === 0 ? (
                  <Empty>Sem mensagens registradas</Empty>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm break-words ${
                          m.direction === "out"
                            ? "bg-[var(--accent)] text-[var(--on-accent)]"
                            : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]"
                        }`}
                      >
                        {m.text}
                        <div className={`nums mt-1 text-[10px] ${m.direction === "out" ? "text-white/70" : "text-[var(--text-faint)]"}`}>
                          {m.channel} · {new Date(m.created_at).toLocaleString("pt-BR")}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
