// OAuth do Instagram (login por dentro da ferramenta).
// Fluxo: painel manda o usuário pro authorize do Instagram -> volta aqui com ?code
//  -> troca por token curto -> troca por token longo (60 dias)
//  -> salva em ig_account/ig_tokens -> assina webhooks -> volta pro painel.
import { adminClient } from "../_shared/db.ts";

const V = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const IG = `https://graph.instagram.com/${V}`;

function redirectTo(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const painel = Deno.env.get("PAINEL_URL");
  if (!painel) return new Response("Falta o secret PAINEL_URL (endereço do painel na Vercel).", { status: 500 });
  // IMPORTANTE: dentro do Supabase, req.url é a URL interna (http, sem /functions/v1).
  // O redirect_uri da troca de token PRECISA ser idêntico ao usado no authorize (o público).
  const redirectUri = Deno.env.get("OAUTH_REDIRECT_URI")
    ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/oauth`;

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error) return redirectTo(`${painel}/?erro=${encodeURIComponent(error)}`);
  if (!code) return redirectTo(`${painel}/?erro=sem_code`);

  const appId = Deno.env.get("INSTAGRAM_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appId || !appSecret) return new Response("config ausente (INSTAGRAM_APP_ID/META_APP_SECRET)", { status: 500 });

  try {
    // 1) code -> token curto (+ user_id)
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const shortJson = await shortRes.json();
    const short = shortJson.access_token ?? shortJson?.data?.[0]?.access_token;
    if (!short) return redirectTo(`${painel}/?erro=troca_token`);

    // 2) token curto -> token longo (60 dias)
    const longRes = await fetch(
      `${IG}/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${short}`,
    );
    const longJson = await longRes.json();
    const longToken = longJson.access_token ?? short;
    const expiresIn = Number(longJson.expires_in ?? 60 * 24 * 3600); // segundos
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3) perfil da conta
    const meRes = await fetch(`${IG}/me?fields=user_id,username,name`, {
      headers: { Authorization: `Bearer ${longToken}` },
    });
    const me = await meRes.json();
    const igId = String(me.user_id ?? me.id ?? "");
    if (!igId) return redirectTo(`${painel}/?erro=perfil&detalhe=${encodeURIComponent(JSON.stringify(me))}`);

    // 4) salva conta + token
    const db = adminClient();
    const now = new Date().toISOString();
    const { data: acc, error: accErr } = await db.from("ig_account").upsert({
      ig_user_id: igId,
      page_id: igId,
      username: me.username ?? null,
      display_name: me.name ?? me.username ?? null,
      is_active: true,
      connected_at: now,
      token_expires_at: expiresAt,
    }, { onConflict: "ig_user_id" }).select("id").single();
    if (accErr || !acc) return redirectTo(`${painel}/?erro=db`);

    await db.from("ig_tokens").upsert({
      ig_account_id: acc.id,
      access_token: longToken,
      expires_at: expiresAt,
      updated_at: now,
    }, { onConflict: "ig_account_id" });

    // 4b) vincula a conta ao usuário que iniciou (state = nonce)
    const nonce = url.searchParams.get("state");
    if (nonce) {
      const { data: pend } = await db.from("oauth_pending").select("user_id").eq("nonce", nonce).maybeSingle();
      if (pend?.user_id) {
        await db.from("account_access").upsert(
          { ig_account_id: acc.id, user_id: pend.user_id },
          { onConflict: "ig_account_id,user_id" },
        );
        await db.from("oauth_pending").delete().eq("nonce", nonce);
      }
    }

    // 5) assina webhooks (comments + messages)
    await fetch(`${IG}/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${longToken}` },
    });

    return redirectTo(`${painel}/?conectado=1`);
  } catch (e) {
    console.error("oauth", e);
    return redirectTo(`${painel}/?erro=excecao`);
  }
});
