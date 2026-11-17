// Helpers da API do Instagram (login do Instagram — graph.instagram.com).
// O token é passado por parâmetro (vem do banco ig_tokens, ou do env como fallback).

const GRAPH_VERSION = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

type GraphResult = { ok: boolean; status: number; body: unknown };

// Uma mensagem pode ser texto simples ou um template com botões.
export type Msg = Record<string, unknown>;

export interface BtnDef { title: string; url: string }

async function graphPost(token: string, path: string, body: Record<string, unknown>): Promise<GraphResult> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Mensagem de texto simples. */
export function textMsg(text: string): Msg {
  return { text };
}

/** Mensagem com botões (button template do Instagram). Até 3 botões, título ≤ 20 chars. */
export function buttonMsg(text: string, buttons: BtnDef[]): Msg {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640) || "👇",
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "web_url",
          url: b.url,
          title: b.title.slice(0, 20),
        })),
      },
    },
  };
}

/** Mensagem-trava: texto + 1 botão de AÇÃO (postback) que avisa o sistema ao ser tocado. */
export function gateMsg(text: string, label: string, payload: string): Msg {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640) || "👇",
        buttons: [{ type: "postback", title: (label || "Já segui").slice(0, 20), payload }],
      },
    },
  };
}

/** Retorna se o usuário segue a conta (is_user_follow_business). Null se indisponível. */
export async function getFollowStatus(token: string, igsid: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${igsid}?fields=is_user_follow_business`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.is_user_follow_business === "boolean" ? body.is_user_follow_business : null;
  } catch {
    return null;
  }
}

/** Envia DM (janela de 24h). "me" resolve para a própria conta IG do token. */
export function sendDM(token: string, igsid: string, message: Msg): Promise<GraphResult> {
  return graphPost(token, `me/messages`, { recipient: { id: igsid }, message });
}

/** Private reply: DM para quem comentou (janela de 7 dias). Recipient = comment_id. */
export function sendPR(token: string, commentId: string, message: Msg): Promise<GraphResult> {
  return graphPost(token, `me/messages`, { recipient: { comment_id: commentId }, message });
}

/** Resposta pública a um comentário. */
export function replyToComment(token: string, commentId: string, text: string): Promise<GraphResult> {
  return graphPost(token, `${commentId}/replies`, { message: text });
}

/** Perfil (nome/username) de um usuário pelo IGSID. Null se indisponível. */
export async function getUserProfile(token: string, igsid: string): Promise<{ name?: string; username?: string } | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${igsid}?fields=name,username`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return { name: body.name, username: body.username };
  } catch {
    return null;
  }
}
