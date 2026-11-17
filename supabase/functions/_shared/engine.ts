// Motor de regras: casa palavra-chave -> fluxo, cria/atualiza contato,
// aplica tag e envia a resposta pela Graph API.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buttonMsg, gateMsg, getFollowStatus, getUserProfile, type Msg, replyToComment, sendDM, sendPR, textMsg } from "./graph.ts";

// --- personalização de mensagens ------------------------------------------
// Suporta {nome} (primeiro nome, cai pro @usuario), {usuario} (@handle),
// {nome_completo}. Ex.: "Opa {nome}! 🚀"
function firstName(full?: string | null, username?: string | null): string {
  if (full && full.trim()) return full.trim().split(/\s+/)[0];
  if (username) return username;
  return "";
}

function personalize(text: string, vars: { nome: string; usuario: string; nome_completo: string }): string {
  return text
    .replace(/\{nome_completo\}/gi, vars.nome_completo)
    .replace(/\{nome\}/gi, vars.nome)
    .replace(/\{usuario\}/gi, vars.usuario)
    .replace(/\s{2,}/g, " ")   // limpa espaço duplo se alguma variável ficou vazia
    .replace(/\s+([!?.,])/g, "$1")
    .trim();
}

type Source = "comment" | "dm";

interface AccountRow { id: string; ig_user_id: string; }

// Carrega o token da conta (ig_tokens); fallback ao secret antigo do ambiente.
async function loadToken(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data } = await db.from("ig_tokens").select("access_token").eq("ig_account_id", accountId).maybeSingle();
  return data?.access_token ?? Deno.env.get("IG_PAGE_ACCESS_TOKEN") ?? null;
}
interface TriggerRow {
  id: string; flow_id: string; source: Source; match_type: string;
  keyword: string | null; media_id: string | null; public_reply: string | null; priority: number;
}
interface FlowBtn { title: string; url: string }
interface FlowStep { type: string; text?: string; buttons?: FlowBtn[] }
interface FlowRow {
  id: string;
  steps: FlowStep[];
  apply_tag_id: string | null;
  require_follow?: boolean;
  gate_text?: string | null;
  gate_button_label?: string | null;
  not_following_text?: string | null;
}

const FLOW_COLS = "id,steps,apply_tag_id,require_follow,gate_text,gate_button_label,not_following_text";

// --- matching ---------------------------------------------------------------
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function matches(trigger: TriggerRow, text: string): boolean {
  if (trigger.match_type === "any") return true;
  if (!trigger.keyword) return false;
  const hay = normalize(text);
  const needle = normalize(trigger.keyword);
  if (trigger.match_type === "exact") return hay === needle;
  if (trigger.match_type === "word") {
    // palavra isolada: casa só quando aparece como palavra inteira (bom p/ termos curtos, ex. "IA")
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, "u").test(hay);
  }
  return hay.includes(needle); // contains
}

// --- contato ----------------------------------------------------------------
async function upsertContact(
  db: SupabaseClient,
  accountId: string,
  igsid: string,
  extra: { username?: string; full_name?: string } = {},
  openWindow = false,
): Promise<string | null> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ig_account_id: accountId,
    igsid,
    last_interaction_at: now,
    ...(extra.username ? { username: extra.username } : {}),
    ...(extra.full_name ? { full_name: extra.full_name } : {}),
  };
  // janela de 24h abre quando o usuário fala com a conta (DM recebida)
  if (openWindow) {
    patch.messaging_window_until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  const { data, error } = await db
    .from("contacts")
    .upsert(patch, { onConflict: "ig_account_id,igsid" })
    .select("id")
    .single();
  if (error) { console.error("upsertContact", error); return null; }
  return data.id;
}

async function applyTag(db: SupabaseClient, contactId: string, tagId: string) {
  await db.from("contact_tags").upsert(
    { contact_id: contactId, tag_id: tagId },
    { onConflict: "contact_id,tag_id" },
  );
}

async function logMessage(db: SupabaseClient, row: Record<string, unknown>) {
  await db.from("messages").insert(row);
}

// --- execução do fluxo ------------------------------------------------------
async function loadTriggers(db: SupabaseClient, accountId: string, source: Source): Promise<TriggerRow[]> {
  const { data } = await db
    .from("triggers")
    .select("id,flow_id,source,match_type,keyword,media_id,public_reply,priority")
    .eq("ig_account_id", accountId)
    .eq("source", source)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  return (data ?? []) as TriggerRow[];
}

async function loadFlow(db: SupabaseClient, flowId: string, accountId?: string): Promise<FlowRow | null> {
  let q = db.from("flows").select(FLOW_COLS).eq("id", flowId).eq("is_active", true);
  if (accountId) q = q.eq("ig_account_id", accountId);
  const { data } = await q.maybeSingle();
  return (data as FlowRow) ?? null;
}

type Vars = { nome: string; usuario: string; nome_completo: string };

// Converte um passo do fluxo na mensagem a enviar (texto ou botão). Null se vazio.
function stepMessage(step: FlowStep, vars: Vars): Msg | null {
  if (step.type === "buttons" && step.buttons?.length) {
    return buttonMsg(
      personalize(step.text ?? "", vars),
      step.buttons.filter((b) => b.url && b.title).map((b) => ({ title: personalize(b.title, vars), url: b.url })),
    );
  }
  if (step.text?.trim()) return textMsg(personalize(step.text, vars));
  return null;
}

// Texto pro log (inclui botões de forma legível).
function stepLogText(step: FlowStep): string {
  if (step.type === "buttons") {
    const btns = (step.buttons ?? []).map((b) => `[${b.title} → ${b.url}]`).join(" ");
    return `${step.text ?? ""} ${btns}`.trim();
  }
  return step.text ?? "";
}

type SendResult = { ok: boolean; status: number; body: unknown };
type Sender = (message: Msg) => Promise<SendResult>;

// Envia o conteúdo do fluxo (as mensagens/botões) pelo canal dado.
async function deliverFlow(
  db: SupabaseClient, accountId: string, contactId: string | null,
  triggerId: string | null, flow: FlowRow, vars: Vars, send: Sender, channel: string,
) {
  for (const step of flow.steps) {
    const message = stepMessage(step, vars);
    if (!message) continue;
    const r = await send(message);
    console.log("deliver", r.status, JSON.stringify(r.body));
    if (contactId) {
      await logMessage(db, {
        ig_account_id: accountId, contact_id: contactId, direction: "out",
        channel, text: stepLogText(step), trigger_id: triggerId,
      });
    }
  }
  if (contactId && flow.apply_tag_id) await applyTag(db, contactId, flow.apply_tag_id);
}

const GATE_DEFAULT = "Pra receber, você precisa estar me seguindo 😉 Segue lá e toque no botão abaixo 👇";
const NOT_FOLLOWING_DEFAULT = "Ainda não te encontrei seguindo 👀 Segue lá e toque no botão de novo 👇";

// Envia a trava (pede pra seguir + botão de ação que dispara a checagem).
async function deliverGate(
  db: SupabaseClient, accountId: string, contactId: string | null,
  triggerId: string | null, flow: FlowRow, vars: Vars, send: Sender, channel: string,
  useNotFollowing = false,
) {
  const text = personalize((useNotFollowing ? flow.not_following_text : flow.gate_text) || (useNotFollowing ? NOT_FOLLOWING_DEFAULT : GATE_DEFAULT), vars);
  const label = flow.gate_button_label || "Já estou seguindo";
  const r = await send(gateMsg(text, label, `unlock:${flow.id}`));
  console.log("gate", r.status, JSON.stringify(r.body));
  if (contactId) {
    await logMessage(db, {
      ig_account_id: accountId, contact_id: contactId, direction: "out",
      channel, text: `[trava] ${text}`, trigger_id: triggerId,
    });
  }
}

// --- handlers de eventos ----------------------------------------------------

export async function handleComment(
  db: SupabaseClient,
  account: AccountRow,
  ev: { commentId: string; text: string; mediaId?: string; fromId?: string; username?: string },
) {
  const triggers = await loadTriggers(db, account.id, "comment");
  const trigger = triggers.find((t) =>
    (!t.media_id || t.media_id === ev.mediaId) && matches(t, ev.text)
  );
  if (!trigger) return { matched: false };

  const flow = await loadFlow(db, trigger.flow_id);
  if (!flow) return { matched: false };

  const token = await loadToken(db, account.id);
  if (!token) { console.error("sem token para a conta", account.id); return { matched: false }; }

  // busca nome/@ da pessoa pra personalizar
  const profile = ev.fromId ? await getUserProfile(token, ev.fromId) : null;
  const username = ev.username ?? profile?.username;
  const vars = {
    nome: firstName(profile?.name, username),
    usuario: username ? `@${username}` : "",
    nome_completo: profile?.name ?? username ?? "",
  };

  const contactId = ev.fromId
    ? await upsertContact(db, account.id, ev.fromId, { username, full_name: profile?.name })
    : null;

  if (contactId) {
    await logMessage(db, {
      ig_account_id: account.id, contact_id: contactId, direction: "in",
      channel: "comment", text: ev.text, trigger_id: trigger.id, external_id: ev.commentId,
    });
  }

  // resposta pública opcional — se houver várias linhas, sorteia uma (evita repetição)
  if (trigger.public_reply) {
    const opts = trigger.public_reply.split("\n").map((s) => s.trim()).filter(Boolean);
    const chosen = opts.length ? opts[Math.floor(Math.random() * opts.length)] : trigger.public_reply;
    const r = await replyToComment(token, ev.commentId, personalize(chosen, vars));
    console.log("replyToComment", r.status);
  }

  // DM (private reply): se o fluxo exige follow, manda a trava; senão, o conteúdo
  const send: Sender = (msg) => sendPR(token, ev.commentId, msg);
  if (flow.require_follow) {
    await deliverGate(db, account.id, contactId, trigger.id, flow, vars, send, "private_reply");
  } else {
    await deliverFlow(db, account.id, contactId, trigger.id, flow, vars, send, "private_reply");
  }
  return { matched: true, trigger_id: trigger.id };
}

export async function handleMessage(
  db: SupabaseClient,
  account: AccountRow,
  ev: { mid: string; text: string; senderId: string },
) {
  const token = await loadToken(db, account.id);
  if (!token) { console.error("sem token para a conta", account.id); return { matched: false }; }

  // busca nome/@ pra personalizar
  const profile = await getUserProfile(token, ev.senderId);
  const vars = {
    nome: firstName(profile?.name, profile?.username),
    usuario: profile?.username ? `@${profile.username}` : "",
    nome_completo: profile?.name ?? profile?.username ?? "",
  };

  // qualquer DM recebida abre a janela de 24h
  const contactId = await upsertContact(
    db, account.id, ev.senderId,
    { username: profile?.username, full_name: profile?.name }, true,
  );

  if (contactId) {
    await logMessage(db, {
      ig_account_id: account.id, contact_id: contactId, direction: "in",
      channel: "dm", text: ev.text, external_id: ev.mid,
    });
  }

  const triggers = await loadTriggers(db, account.id, "dm");
  const trigger = triggers.find((t) => matches(t, ev.text));
  if (!trigger) return { matched: false };

  const flow = await loadFlow(db, trigger.flow_id);
  if (!flow) return { matched: false };

  const send: Sender = (msg) => sendDM(token, ev.senderId, msg);
  if (flow.require_follow) {
    await deliverGate(db, account.id, contactId, trigger.id, flow, vars, send, "dm");
  } else {
    await deliverFlow(db, account.id, contactId, trigger.id, flow, vars, send, "dm");
  }
  return { matched: true, trigger_id: trigger.id };
}

// --- postback (clique no botão de ação, ex.: "Já estou seguindo") -----------
export async function handlePostback(
  db: SupabaseClient,
  account: AccountRow,
  ev: { senderId: string; payload: string },
) {
  if (!ev.payload?.startsWith("unlock:")) return { matched: false };
  const flowId = ev.payload.slice("unlock:".length);

  const token = await loadToken(db, account.id);
  if (!token) { console.error("sem token", account.id); return { matched: false }; }

  const flow = await loadFlow(db, flowId, account.id);
  if (!flow) return { matched: false };

  const profile = await getUserProfile(token, ev.senderId);
  const username = profile?.username;
  const vars: Vars = {
    nome: firstName(profile?.name, username),
    usuario: username ? `@${username}` : "",
    nome_completo: profile?.name ?? username ?? "",
  };
  const contactId = await upsertContact(db, account.id, ev.senderId, { username, full_name: profile?.name }, true);

  const follows = await getFollowStatus(token, ev.senderId);
  const send: Sender = (msg) => sendDM(token, ev.senderId, msg);

  if (follows === true) {
    await deliverFlow(db, account.id, contactId, null, flow, vars, send, "dm");
    return { matched: true, released: true };
  }
  // não segue (ou não deu pra verificar) → reenvia a trava com a msg de "ainda não segue"
  await deliverGate(db, account.id, contactId, null, flow, vars, send, "dm", true);
  return { matched: true, released: false };
}
