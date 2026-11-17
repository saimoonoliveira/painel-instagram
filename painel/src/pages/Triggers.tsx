import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { useConfirm } from "../lib/confirm";
import type { Flow, Trigger } from "../lib/types";
import { Badge, Button, Card, Empty, Input, Label, Select, Textarea } from "../components/ui";

export default function Triggers() {
  const { accountId } = useAccounts();
  const confirm = useConfirm();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [editing, setEditing] = useState<Partial<Trigger> | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!accountId) { setTriggers([]); setFlows([]); setLoading(false); return; }
    const [{ data: tr }, { data: f }] = await Promise.all([
      supabase.from("triggers").select("*").eq("ig_account_id", accountId).order("priority", { ascending: false }),
      supabase.from("flows").select("*").eq("ig_account_id", accountId).eq("is_active", true).order("name"),
    ]);
    setTriggers((tr as Trigger[]) ?? []);
    setFlows((f as Flow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [accountId]);

  const flowName = (id: string) => flows.find((f) => f.id === id)?.name ?? "—";

  function newTrigger() {
    setEditing({ source: "comment", match_type: "contains", keyword: "", flow_id: "", public_reply: "", media_id: "", priority: 0, is_active: true });
  }

  async function save() {
    if (!editing || !accountId || !editing.flow_id) return;
    const payload = {
      ig_account_id: accountId,
      flow_id: editing.flow_id,
      source: editing.source ?? "comment",
      match_type: editing.match_type ?? "contains",
      keyword: editing.match_type === "any" ? null : (editing.keyword || null),
      media_id: editing.media_id || null,
      public_reply: editing.source === "comment" ? (editing.public_reply || null) : null,
      priority: editing.priority ?? 0,
      is_active: editing.is_active ?? true,
    };
    if (editing.id) await supabase.from("triggers").update(payload).eq("id", editing.id);
    else await supabase.from("triggers").insert(payload);
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: "Excluir este gatilho?", confirmLabel: "Excluir", danger: true }))) return;
    await supabase.from("triggers").delete().eq("id", id);
    load();
  }

  if (editing) {
    const isComment = editing.source === "comment";
    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold text-[var(--text)]">{editing.id ? "Editar Gatilho" : "Novo Gatilho"}</h1>
        <Card className="space-y-5 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Origem</Label>
              <Select value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value as Trigger["source"] })}>
                <option value="comment">Comentário → DM</option>
                <option value="dm">Mensagem no Direct</option>
              </Select>
            </div>
            <div>
              <Label>Tipo de correspondência</Label>
              <Select value={editing.match_type} onChange={(e) => setEditing({ ...editing, match_type: e.target.value as Trigger["match_type"] })}>
                <option value="contains">Contém a palavra</option>
                <option value="word">Palavra isolada (ex.: IA)</option>
                <option value="exact">Palavra exata</option>
                <option value="any">Qualquer texto</option>
              </Select>
            </div>
          </div>
          {editing.match_type !== "any" && (
            <div>
              <Label>Palavra-chave</Label>
              <Input value={editing.keyword ?? ""} onChange={(e) => setEditing({ ...editing, keyword: e.target.value })} placeholder="Ex.: EU QUERO" />
            </div>
          )}
          <div>
            <Label>Fluxo a disparar</Label>
            <Select value={editing.flow_id ?? ""} onChange={(e) => setEditing({ ...editing, flow_id: e.target.value })}>
              <option value="">— selecione —</option>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            {flows.length === 0 && <p className="mt-1 text-xs text-[var(--warn)]">Crie um fluxo antes.</p>}
          </div>
          {isComment && (
            <>
              <div>
                <Label>Resposta pública ao comentário (opcional)</Label>
                <Textarea rows={2} value={editing.public_reply ?? ""} onChange={(e) => setEditing({ ...editing, public_reply: e.target.value })} placeholder="Ex.: Te mandei no direct! 📩" />
              </div>
              <div>
                <Label>Restringir a um post/reel (media_id, opcional)</Label>
                <Input value={editing.media_id ?? ""} onChange={(e) => setEditing({ ...editing, media_id: e.target.value })} placeholder="vazio = qualquer post" />
              </div>
            </>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={!accountId || !editing.flow_id}>Salvar</Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-[var(--text)]">Gatilhos</h1>
          <p className="mt-1 text-sm text-[var(--text-faint)]">O que dispara cada fluxo</p>
        </div>
        <Button onClick={newTrigger} disabled={!accountId} className="shrink-0 whitespace-nowrap">+ Novo</Button>
      </div>
      <Card>
        {loading ? <Empty>Carregando…</Empty> : triggers.length === 0 ? (
          <Empty>Nenhum gatilho ainda.</Empty>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {triggers.map((t) => (
              <div key={t.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <Badge color={t.source === "comment" ? "#ff6229" : "#3fb27f"}>
                    {t.source === "comment" ? "Comentário" : "Direct"}
                  </Badge>
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text)]">
                      {t.match_type === "any" ? "Qualquer texto" : `"${t.keyword}"`}
                      <span className="text-[var(--text-faint)]"> → {flowName(t.flow_id)}</span>
                    </div>
                    <div className="text-xs text-[var(--text-faint)]">{t.match_type}{t.is_active ? "" : " · inativo"}</div>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                  <Button variant="ghost" className="min-h-10" onClick={() => setEditing(t)}>Editar</Button>
                  <Button variant="danger" className="min-h-10" onClick={() => remove(t.id)}>Excluir</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
