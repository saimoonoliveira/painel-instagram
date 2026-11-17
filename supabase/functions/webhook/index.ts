// Webhook do Instagram (Meta).
//  GET  -> verificação de inscrição (hub.challenge)
//  POST -> eventos de comentários e mensagens (DM)
import { adminClient } from "../_shared/db.ts";
import { verifySignature } from "../_shared/verify.ts";
import { handleComment, handleMessage, handlePostback } from "../_shared/engine.ts";

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Verificação de inscrição (Meta chama uma vez ao configurar) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // --- Assinatura ---
  const raw = await req.text();
  let valid = false;
  try {
    valid = await verifySignature(raw, req.headers.get("x-hub-signature-256"));
  } catch (e) {
    console.error("verifySignature", e);
    return new Response("server error", { status: 500 });
  }
  if (!valid) return new Response("invalid signature", { status: 401 });

  // Responde 200 rápido para a Meta; processa em seguida.
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  try {
    await process(body);
  } catch (e) {
    console.error("process", e);
    // Ainda retornamos 200 para a Meta não reenviar em loop; erro fica logado.
  }
  return new Response("ok", { status: 200 });
});

async function process(body: any) {
  if (body.object !== "instagram") return;
  const db = adminClient();

  for (const entry of body.entry ?? []) {
    const igUserId: string = String(entry.id);
    // Só a conta dona do evento: nunca "adivinhar" outra (o antigo fallback de conta única
    // jogava DMs de contas desativadas dentro da conta ativa de outra pessoa).
    const { data: account } = await db
      .from("ig_account")
      .select("id,ig_user_id")
      .eq("ig_user_id", igUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (!account) { console.warn("conta não encontrada para", igUserId); continue; }

    // ---- Comentários ----
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value ?? {};
      const dedupe = `comment:${v.id}`;
      if (!(await claim(db, account.id, "comment", dedupe, change))) continue;
      const res = await handleComment(db, account, {
        commentId: v.id,
        text: v.text ?? "",
        mediaId: v.media?.id,
        fromId: v.from?.id,
        username: v.from?.username,
      });
      await finish(db, dedupe, res.matched ? "processed" : "ignored");
    }

    // ---- Mensagens (DM) e cliques em botão (postback) ----
    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue;        // ignora ecos das nossas próprias mensagens

      // clique num botão de ação (ex.: "Já estou seguindo")
      if (m.postback) {
        const dedupe = `postback:${m.postback.mid ?? m.timestamp ?? ""}:${m.sender?.id}`;
        if (!(await claim(db, account.id, "postback", dedupe, m))) continue;
        const res = await handlePostback(db, account, {
          senderId: m.sender?.id,
          payload: m.postback.payload ?? "",
        });
        await finish(db, dedupe, res.matched ? "processed" : "ignored");
        continue;
      }

      if (!m.message?.text) continue;          // demais casos: só texto
      const dedupe = `message:${m.message.mid}`;
      if (!(await claim(db, account.id, "message", dedupe, m))) continue;
      const res = await handleMessage(db, account, {
        mid: m.message.mid,
        text: m.message.text,
        senderId: m.sender?.id,
      });
      await finish(db, dedupe, res.matched ? "processed" : "ignored");
    }
  }
}

// Insere o evento com dedupe_key único. Se já existe, retorna false (não reprocessa).
async function claim(db: any, accountId: string, type: string, dedupe: string, raw: unknown): Promise<boolean> {
  const { error } = await db.from("events").insert({
    ig_account_id: accountId, event_type: type, dedupe_key: dedupe, raw,
  });
  if (error) {
    if (error.code === "23505") return false; // unique_violation = duplicado
    console.error("claim", error);
    return false;
  }
  return true;
}

async function finish(db: any, dedupe: string, status: string) {
  await db.from("events").update({ status, processed_at: new Date().toISOString() })
    .eq("dedupe_key", dedupe);
}
