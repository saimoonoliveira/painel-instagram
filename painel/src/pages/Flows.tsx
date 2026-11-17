import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { useConfirm } from "../lib/confirm";
import type { Flow, FlowStep, Tag } from "../lib/types";
import { Button, Card, Empty, Input, Label, Select, Textarea } from "../components/ui";

export default function Flows() {
  const { accountId } = useAccounts();
  const confirm = useConfirm();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [editing, setEditing] = useState<Partial<Flow> | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!accountId) { setFlows([]); setTags([]); setLoading(false); return; }
    const [{ data: f }, { data: t }] = await Promise.all([
      supabase.from("flows").select("*").eq("ig_account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("tags").select("*").eq("ig_account_id", accountId).order("name"),
    ]);
    setFlows((f as Flow[]) ?? []);
    setTags((t as Tag[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [accountId]);

  function newFlow() {
    setEditing({ name: "", steps: [{ type: "text", text: "" }], apply_tag_id: null, is_active: true, require_follow: false, gate_button_label: "Já estou seguindo" });
  }

  function stepValid(s: FlowStep) {
    return s.type === "buttons"
      ? (s.buttons ?? []).some((b) => b.url.trim() && b.title.trim())
      : !!s.text.trim();
  }

  async function save() {
    if (!editing || !accountId) return;
    const steps = (editing.steps ?? []).filter(stepValid).map((s) =>
      s.type === "buttons"
        ? { type: "buttons" as const, text: s.text, buttons: (s.buttons ?? []).filter((b) => b.url.trim() && b.title.trim()) }
        : { type: "text" as const, text: s.text },
    );
    const payload = {
      ig_account_id: accountId,
      name: editing.name ?? "Sem nome",
      steps,
      apply_tag_id: editing.apply_tag_id || null,
      is_active: editing.is_active ?? true,
      require_follow: editing.require_follow ?? false,
      gate_text: editing.require_follow ? (editing.gate_text || null) : null,
      gate_button_label: editing.require_follow ? (editing.gate_button_label || null) : null,
      not_following_text: editing.require_follow ? (editing.not_following_text || null) : null,
    };
    if (editing.id) await supabase.from("flows").update(payload).eq("id", editing.id);
    else await supabase.from("flows").insert(payload);
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!(await confirm({ message: "Excluir este fluxo?", confirmLabel: "Excluir", danger: true }))) return;
    await supabase.from("flows").delete().eq("id", id);
    load();
  }

  // --- edição de passos ---
  function patchStep(i: number, patch: Partial<FlowStep>) {
    const steps = [...(editing!.steps ?? [])];
    steps[i] = { ...steps[i], ...patch };
    setEditing({ ...editing!, steps });
  }
  function setStepType(i: number, type: "text" | "buttons") {
    const s = editing!.steps![i];
    patchStep(i, type === "buttons"
      ? { type, buttons: s.buttons?.length ? s.buttons : [{ title: "", url: "" }] }
      : { type });
  }
  function setButton(i: number, field: "title" | "url", value: string) {
    const s = editing!.steps![i];
    const buttons = [{ ...(s.buttons?.[0] ?? { title: "", url: "" }), [field]: value }];
    patchStep(i, { buttons });
  }
  function addStep() {
    setEditing({ ...editing!, steps: [...(editing!.steps ?? []), { type: "text", text: "" }] });
  }
  function removeStep(i: number) {
    const steps = [...(editing!.steps ?? [])];
    steps.splice(i, 1);
    setEditing({ ...editing!, steps });
  }

  if (editing) {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold text-[var(--text)]">{editing.id ? "Editar Fluxo" : "Novo Fluxo"}</h1>
        <Card className="space-y-5 p-6">
          <div>
            <Label>Nome do fluxo</Label>
            <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Link do curso" />
          </div>
          <div>
            <Label>Mensagens (enviadas em sequência)</Label>
            <div className="space-y-3">
              {(editing.steps ?? []).map((s: FlowStep, i: number) => (
                <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="w-40">
                      <Select value={s.type} onChange={(e) => setStepType(i, e.target.value as "text" | "buttons")}>
                        <option value="text">💬 Texto</option>
                        <option value="buttons">🔘 Botão</option>
                      </Select>
                    </div>
                    <Button variant="ghost" onClick={() => removeStep(i)} type="button" aria-label={`Remover mensagem ${i + 1}`}>✕</Button>
                  </div>
                  <Textarea rows={2} value={s.text} onChange={(e) => patchStep(i, { text: e.target.value })} placeholder={s.type === "buttons" ? "Texto acima do botão…" : "Texto da mensagem…"} />
                  {s.type === "buttons" && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
                      <Input maxLength={20} value={s.buttons?.[0]?.title ?? ""} onChange={(e) => setButton(i, "title", e.target.value)} placeholder="Texto do botão" />
                      <Input type="url" value={s.buttons?.[0]?.url ?? ""} onChange={(e) => setButton(i, "url", e.target.value)} placeholder="https://link-de-destino.com" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addStep} type="button" className="mt-2 text-sm font-medium text-[var(--accent-hi)] hover:underline">+ adicionar mensagem</button>
          </div>
          <div>
            <Label>Aplicar tag ao rodar (opcional)</Label>
            <Select value={editing.apply_tag_id ?? ""} onChange={(e) => setEditing({ ...editing, apply_tag_id: e.target.value || null })}>
              <option value="">— nenhuma —</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={!!editing.require_follow}
                onChange={(e) => setEditing({ ...editing, require_follow: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--text)]">🔒 Exigir seguir antes de liberar</span>
            </label>
            <p className="mt-1.5 text-xs text-[var(--text-faint)]">
              A pessoa recebe primeiro um pedido pra te seguir + um botão. As mensagens acima só são liberadas depois que o sistema confirma que ela realmente segue.
            </p>
            {editing.require_follow && (
              <div className="mt-4 space-y-3">
                <div>
                  <Label>Mensagem pedindo pra seguir</Label>
                  <Textarea rows={2} value={editing.gate_text ?? ""} onChange={(e) => setEditing({ ...editing, gate_text: e.target.value })} placeholder="Pra receber, você precisa estar me seguindo 😉 Segue lá e toque no botão 👇" />
                </div>
                <div>
                  <Label>Texto do botão</Label>
                  <Input maxLength={20} value={editing.gate_button_label ?? ""} onChange={(e) => setEditing({ ...editing, gate_button_label: e.target.value })} placeholder="Já estou seguindo" />
                </div>
                <div>
                  <Label>Mensagem quando ainda não segue</Label>
                  <Textarea rows={2} value={editing.not_following_text ?? ""} onChange={(e) => setEditing({ ...editing, not_following_text: e.target.value })} placeholder="Ainda não te achei seguindo 👀 Segue e toque no botão de novo 👇" />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={!accountId}>Salvar</Button>
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
          <h1 className="text-2xl font-semibold text-[var(--text)]">Fluxos</h1>
          <p className="mt-1 text-sm text-[var(--text-faint)]">As mensagens automáticas que os gatilhos disparam</p>
        </div>
        <Button onClick={newFlow} disabled={!accountId} className="shrink-0 whitespace-nowrap">+ Novo</Button>
      </div>
      <Card>
        {loading ? <Empty>Carregando…</Empty> : flows.length === 0 ? (
          <Empty>Nenhum fluxo ainda. Crie o primeiro.</Empty>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {flows.map((f) => (
              <div key={f.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text)]">{f.name}</div>
                  <div className="text-xs text-[var(--text-faint)]">
                    {f.steps.length} mensagem(ns)
                    {f.steps.some((s) => s.type === "buttons") ? " · com botão" : ""}
                    {f.require_follow ? " · 🔒 segue p/ liberar" : ""}
                    {f.is_active ? "" : " · inativo"}
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                  <Button variant="ghost" className="min-h-10" onClick={() => setEditing(f)}>Editar</Button>
                  <Button variant="danger" className="min-h-10" onClick={() => remove(f.id)}>Excluir</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
