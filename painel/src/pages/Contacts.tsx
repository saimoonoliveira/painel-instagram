import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import type { Contact, Tag } from "../lib/types";
import { Badge, Card, Empty, Input } from "../components/ui";

interface ContactWithTags extends Contact {
  contact_tags: { tag_id: string }[];
}

export default function Contacts() {
  const { accountId } = useAccounts();
  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [tags, setTags] = useState<Record<string, Tag>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) { setContacts([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const [{ data: c }, { data: t }] = await Promise.all([
        supabase
          .from("contacts")
          .select("*, contact_tags(tag_id)")
          .eq("ig_account_id", accountId)
          .order("last_interaction_at", { ascending: false })
          .limit(500),
        supabase.from("tags").select("*").eq("ig_account_id", accountId),
      ]);
      setContacts((c as ContactWithTags[]) ?? []);
      setTags(Object.fromEntries(((t as Tag[]) ?? []).map((x) => [x.id, x])));
      setLoading(false);
    })();
  }, [accountId]);

  const filtered = contacts.filter((c) => {
    const s = q.toLowerCase();
    return !s || (c.username ?? "").toLowerCase().includes(s) || (c.full_name ?? "").toLowerCase().includes(s);
  });

  function windowOpen(c: Contact) {
    return c.messaging_window_until && new Date(c.messaging_window_until) > new Date();
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Contatos</h1>
          <p className="mt-1 text-sm text-[var(--text-dim)]"><span className="nums">{contacts.length}</span> pessoas que interagiram</p>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="busca" className="sr-only">Buscar contatos</label>
          <Input id="busca" type="search" placeholder="Buscar por @ ou nome…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card>
        {loading ? (
          <Empty>Carregando…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>Nenhum contato ainda. Assim que alguém comentar ou mandar DM, aparece aqui.</Empty>
        ) : (
          <>
          {/* celular: um cartão por contato, sem tabela cortada para o lado */}
          <ul className="md:hidden">
            {filtered.map((c) => (
              <li key={c.id} className="border-b border-[var(--border)] px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text)]">{c.username ? `@${c.username}` : c.igsid}</div>
                    {c.full_name && <div className="truncate text-xs text-[var(--text-faint)]">{c.full_name}</div>}
                  </div>
                  {windowOpen(c) ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--ok)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden="true" />janela aberta
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-[var(--text-faint)]">janela fechada</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {c.contact_tags.map((ct) => {
                    const tag = tags[ct.tag_id];
                    return tag ? <Badge key={ct.tag_id} color={tag.color}>{tag.name}</Badge> : null;
                  })}
                  <span className="nums ml-auto text-xs text-[var(--text-faint)]">
                    {new Date(c.last_interaction_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                  <th className="px-4 py-3 font-medium">Contato</th>
                  <th className="px-4 py-3 font-medium">Tags</th>
                  <th className="px-4 py-3 font-medium">Janela 24h</th>
                  <th className="px-4 py-3 font-medium">Última interação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--text)]">{c.username ? `@${c.username}` : c.igsid}</div>
                      {c.full_name && <div className="text-xs text-[var(--text-faint)]">{c.full_name}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.contact_tags.map((ct) => {
                          const tag = tags[ct.tag_id];
                          return tag ? <Badge key={ct.tag_id} color={tag.color}>{tag.name}</Badge> : null;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {windowOpen(c) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ok)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-hidden="true" />aberta
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-faint)]">fechada</span>
                      )}
                    </td>
                    <td className="nums px-4 py-3 text-xs text-[var(--text-dim)]">
                      {new Date(c.last_interaction_at).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
