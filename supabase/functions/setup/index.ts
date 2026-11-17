// Configuração única: descobre a conta IG a partir do token e cadastra em ig_account.
// Suporta token de login do Instagram (graph.instagram.com, IGAA...) e detecta
// tokens do Facebook (graph.facebook.com, EAA...). Protegida por SETUP_KEY.
import { adminClient } from "../_shared/db.ts";

const V = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const IG = `https://graph.instagram.com/${V}`;
const FB = `https://graph.facebook.com/${V}`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== Deno.env.get("SETUP_KEY") || !Deno.env.get("SETUP_KEY")) {
    return json({ error: "unauthorized" }, 401);
  }
  const token = Deno.env.get("IG_PAGE_ACCESS_TOKEN");
  if (!token) return json({ error: "IG_PAGE_ACCESS_TOKEN não configurado" }, 400);

  // Sonda o perfil de um IGSID: ?probe=<igsid>
  const probe = url.searchParams.get("probe");
  if (probe) {
    const r = await fetch(`${IG}/${probe}?fields=name,username,profile_pic`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return json({ status: r.status, body: await r.json() });
  }

  // Testa a checagem de follow: ?followcheck=<igsid>
  const fc = url.searchParams.get("followcheck");
  if (fc) {
    const r = await fetch(`${IG}/${fc}?fields=name,username,is_user_follow_business,is_business_follow_user,follower_count`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return json({ status: r.status, body: await r.json() });
  }

  if (url.searchParams.get("debug") === "1") {
    const secret = Deno.env.get("META_APP_SECRET") ?? "";
    return json({
      token: {
        tamanho: token.length,
        comeca_com: token.slice(0, 4),
        tem_espaco_ou_quebra: /\s/.test(token),
      },
      app_secret: {
        configurado: secret.length > 0,
        tamanho: secret.length,
        comeca_com: secret.slice(0, 3),
        parece_hex_32: /^[0-9a-f]{32}$/.test(secret),
        tem_espaco_ou_quebra: /\s/.test(secret),
      },
    });
  }

  // 1) Tenta como token de LOGIN DO INSTAGRAM (graph.instagram.com)
  const igRes = await fetch(`${IG}/me?fields=user_id,username,name,account_type`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const igData = await igRes.json();
  if (igRes.ok && (igData.user_id || igData.id)) {
    return await register(String(igData.user_id ?? igData.id), igData.username, igData.name);
  }

  // 2) Detecta se é token do FACEBOOK (graph.facebook.com) — diagnóstico
  const fbRes = await fetch(`${FB}/me?fields=id,name,instagram_business_account{id,username,name}&access_token=${token}`);
  const fbData = await fbRes.json();

  return json({
    error: "token_incompativel",
    hint: fbRes.ok
      ? "Este é um token do FACEBOOK (EAA). O app usa login do INSTAGRAM. Gere o token na tela 'Configuração da API com login do Instagram' → bloco 2 → botão de gerar (o token começa com IGAA)."
      : "O token não funcionou nem no Instagram nem no Facebook. Gere um token novo na tela 'Configuração da API com login do Instagram'.",
    instagram_login: igData,
    facebook_login: fbData,
  }, 400);

  async function register(igId: string, username?: string, name?: string) {
    const db = adminClient();
    const { data: row, error } = await db.from("ig_account").upsert({
      ig_user_id: igId,
      page_id: igId,
      username: username ?? null,
      display_name: name ?? username ?? null,
      is_active: true,
    }, { onConflict: "ig_user_id" }).select().single();
    if (error) return json({ error: "db_error", detail: error }, 500);

    // Inscreve a conta nos webhooks (comments + messages)
    const subRes = await fetch(`${IG}/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const sub = await subRes.json();

    // Consulta o estado atual da inscrição
    const checkRes = await fetch(`${IG}/me/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const check = await checkRes.json();

    return json({ ok: true, account: row, inscricao: sub, inscricao_atual: check });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}
