// Posts e stories da conta, para o painel ManyChat.
// Autentica pelo login do painel (JWT) e confirma via RLS que o usuário pode ver a conta
// pedida — assim um sócio nunca lê o conteúdo de outro. O token do Instagram fica no servidor.
//   POST { accountId }  ->  { posts, stories, stories_erro }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "../_shared/db.ts";

const V = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const IG = `https://graph.instagram.com/${V}`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function graph(token: string, path: string, params: Record<string, string>) {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${IG}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${r.status}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const user = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });

  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return json({ erro: "nao_autorizado" }, 401);

  // after: cursor da próxima página de posts ("Carregar mais"); baixar: id da mídia a baixar;
  // resultados: os últimos posts com os números de cada um (aba Posts > Resultados)
  const { accountId, after, baixar, resultados } = await req.json().catch(() => ({}));
  if (!accountId) return json({ erro: "conta_ausente" }, 400);

  // RLS: só volta a conta se este usuário pode vê-la
  const { data: conta } = await user.from("ig_account").select("id, ig_user_id").eq("id", accountId).maybeSingle();
  if (!conta) return json({ erro: "sem_acesso" }, 403);

  const db = adminClient();
  const { data: tk } = await db.from("ig_tokens").select("access_token").eq("ig_account_id", conta.id).maybeSingle();
  const token = tk?.access_token ?? Deno.env.get("IG_PAGE_ACCESS_TOKEN");
  if (!token) return json({ erro: "sem_token" }, 409);

  // Download: o navegador não consegue baixar direto do CDN do Instagram (CORS), então o arquivo passa
  // por aqui. A mídia é relida com o token DESTA conta — o token só enxerga mídias da própria conta.
  if (baixar) {
    if (!/^\d+$/.test(String(baixar))) return json({ erro: "midia_invalida" }, 400);
    try {
      const m = await graph(token, String(baixar), { fields: "media_url,media_type" });
      if (!m.media_url) return json({ erro: "sem_arquivo" }, 404);
      if (!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(new URL(m.media_url).hostname)) return json({ erro: "origem_invalida" }, 400);
      const f = await fetch(m.media_url);
      if (!f.ok || !f.body) return json({ erro: "falha_download" }, 502);
      // octet-stream: o supabase-js entrega como Blob (com video/mp4 ele leria como texto e corromperia)
      return new Response(f.body, { headers: { ...cors, "Content-Type": "application/octet-stream" } });
    } catch (e) {
      return json({ erro: "falha", mensagem: (e as Error).message }, 502);
    }
  }

  if (resultados) {
    try {
      const r = await graph(token, `${conta.ig_user_id}/media`, {
        fields: "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count",
        limit: "30",
      });
      const lista = (r.data ?? []) as Record<string, unknown>[];
      // mesmas métricas da função metricas; se alguma não vale para o tipo do post, cai no conjunto básico
      const REELS = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"];
      const FEED = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "follows", "profile_visits"];
      const BASICO = ["reach", "likes", "comments", "saved", "shares"];
      let liberadas = true;
      for (let i = 0; i < lista.length && liberadas; i += 6) {
        await Promise.all(lista.slice(i, i + 6).map(async (p) => {
          for (const metricas of [p.media_product_type === "REELS" ? REELS : FEED, BASICO]) {
            try {
              const ins = await graph(token, `${p.id}/insights`, { metric: metricas.join(",") });
              const valores: Record<string, number> = {};
              for (const item of ins.data ?? []) {
                const v = item.total_value?.value ?? item.values?.[0]?.value;
                if (typeof v === "number") valores[item.name] = v;
              }
              p.insights = valores;
              return;
            } catch (e) {
              if (/permission/i.test((e as Error).message)) { liberadas = false; return; }
            }
          }
        }));
      }
      return json({ posts: lista, metricas_liberadas: liberadas });
    } catch (e) {
      const msg = (e as Error).message;
      const expirado = /session|expired|invalid|190/i.test(msg);
      return json({ erro: expirado ? "token_invalido" : "falha", mensagem: msg }, expirado ? 409 : 502);
    }
  }

  try {
    // children: as fotos/vídeos de cada carrossel, para ver tudo dentro do painel
    const postFields =
      "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count,children{id,media_type,media_url,thumbnail_url}";
    const storyFields = "id,media_type,permalink,timestamp,thumbnail_url,media_url";
    const [posts, stories] = await Promise.all([
      graph(token, `${conta.ig_user_id}/media`, { fields: postFields, limit: "24", ...(after ? { after: String(after) } : {}) }),
      // stories só existem por 24h; se a permissão não cobrir, devolve a lista vazia + o motivo.
      // Nas páginas seguintes ("Carregar mais") os stories já vieram na primeira.
      after
        ? Promise.resolve({ data: [] })
        : graph(token, `${conta.ig_user_id}/stories`, { fields: storyFields }).catch((e) => ({ data: [], erro: (e as Error).message })),
    ]);
    const paging = (posts as { paging?: { next?: string; cursors?: { after?: string } } }).paging;
    const lista = ((posts as { data?: Record<string, unknown>[] }).data ?? []);

    // Visualizações de cada post (insights, exige instagram_business_manage_insights). De 8 em 8 para
    // não estourar o limite de chamadas; sem a permissão, para na primeira e avisa o painel.
    let viewsLiberadas = true;
    for (let i = 0; i < lista.length && viewsLiberadas; i += 8) {
      await Promise.all(lista.slice(i, i + 8).map(async (p) => {
        try {
          const r = await graph(token, `${p.id}/insights`, { metric: "views" });
          const item = r.data?.[0];
          p.views = item?.total_value?.value ?? item?.values?.[0]?.value ?? null;
        } catch (e) {
          if (/permission/i.test((e as Error).message)) viewsLiberadas = false;
        }
      }));
    }

    return json({
      posts: lista,
      views_liberadas: viewsLiberadas,
      stories: (stories as { data?: unknown[] }).data ?? [],
      stories_erro: (stories as { erro?: string }).erro ?? null,
      next: paging?.next ? paging.cursors?.after ?? null : null,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const expirado = /session|expired|invalid|190/i.test(msg);
    return json({ erro: expirado ? "token_invalido" : "falha", mensagem: msg }, expirado ? 409 : 502);
  }
});
