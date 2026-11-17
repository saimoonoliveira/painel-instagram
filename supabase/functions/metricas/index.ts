// Métricas do Instagram para apps externos (ex.: um sistema de conteúdo), protegidas por METRICAS_KEY.
// O token da conta fica aqui no servidor (ig_tokens); o Mac só recebe os números.
// Protegida pela chave METRICAS_KEY, enviada no cabeçalho "x-chave".
//
//   GET ?acao=perfil&conta=<username>            perfil + se a permissão de métricas está liberada
//   GET ?acao=posts&conta=<username>&limite=60   posts recentes com curtidas, comentários e insights
//   GET ?acao=conta&conta=<username>&dias=28     métricas da conta (alcance, views, seguidores)
import { adminClient } from "../_shared/db.ts";
import { renovarSeNecessario } from "../_shared/token.ts";

const V = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const IG = `https://graph.instagram.com/${V}`;

const METRICAS = {
  REELS: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
  FEED: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "follows", "profile_visits"],
  BASICO: ["reach", "likes", "comments", "saved", "shares"],
};

type Json = Record<string, unknown>;

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
}

class ErroGraph extends Error {
  constructor(public codigo: number, mensagem: string) {
    super(mensagem);
  }
}

async function graph(token: string, caminho: string, params: Record<string, string> = {}): Promise<Json> {
  const url = caminho.startsWith("http") ? new URL(caminho) : new URL(`${IG}/${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.error) {
    const e = (corpo.error ?? {}) as Json;
    throw new ErroGraph(Number(e.code ?? r.status), String(e.message ?? `HTTP ${r.status}`));
  }
  return corpo;
}

// Código 10/200 ou mensagem de permissão: a permissão instagram_business_manage_insights não foi concedida.
const semPermissao = (e: unknown) =>
  e instanceof ErroGraph && (e.codigo === 10 || e.codigo === 200 || /permission/i.test(e.message));

async function perfil(token: string, igId: string) {
  const dados = await graph(token, "me", {
    fields: "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count",
  });
  let metricas = true;
  let detalhe = "";
  try {
    const ontem = Math.floor(Date.now() / 1000) - 86400 * 2;
    await graph(token, `${igId}/insights`, { metric: "reach", period: "day", since: String(ontem - 86400), until: String(ontem) });
  } catch (e) {
    if (semPermissao(e)) {
      metricas = false;
      detalhe = (e as Error).message;
    }
  }
  return { perfil: dados, permissoes: { metricas, detalhe } };
}

function lerInsights(resposta: Json): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const item of (resposta.data as Json[]) ?? []) {
    const valores = item.values as { value: number }[] | undefined;
    const total = item.total_value as { value: number } | undefined;
    const valor = total?.value ?? valores?.[0]?.value;
    if (typeof valor === "number") saida[String(item.name)] = valor;
  }
  return saida;
}

async function insightsDoPost(token: string, post: Json): Promise<Record<string, number> | "sem_permissao" | null> {
  const lista = post.media_product_type === "REELS" ? METRICAS.REELS : METRICAS.FEED;
  for (const metricas of [lista, METRICAS.BASICO]) {
    try {
      return lerInsights(await graph(token, `${post.id}/insights`, { metric: metricas.join(",") }));
    } catch (e) {
      if (semPermissao(e)) return "sem_permissao";
      // métrica não suportada para este post: tenta o conjunto básico
    }
  }
  return null;
}

async function posts(token: string, igId: string, limite: number) {
  const campos =
    "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count,is_shared_to_feed";
  const lista: Json[] = [];
  let pagina = await graph(token, `${igId}/media`, { fields: campos, limit: String(Math.min(limite, 50)) });
  while (true) {
    lista.push(...((pagina.data as Json[]) ?? []));
    const proxima = (pagina.paging as Json | undefined)?.next as string | undefined;
    if (lista.length >= limite || !proxima) break;
    pagina = await graph(token, proxima);
  }
  const selecionados = lista.slice(0, limite);
  let liberadas = true;
  // de 6 em 6 para não estourar o limite de chamadas
  for (let i = 0; i < selecionados.length; i += 6) {
    const lote = selecionados.slice(i, i + 6);
    const resultados = await Promise.all(lote.map((p) => (liberadas ? insightsDoPost(token, p) : Promise.resolve(null))));
    resultados.forEach((r, j) => {
      if (r === "sem_permissao") liberadas = false;
      else lote[j].insights = r;
    });
  }
  return { posts: selecionados, metricas_liberadas: liberadas };
}

async function conta(token: string, igId: string, dias: number) {
  const ate = Math.floor(Date.now() / 1000);
  const desde = ate - 86400 * Math.min(Math.max(dias, 1), 28);
  const janela = { period: "day", since: String(desde), until: String(ate) };
  const pedidos: Record<string, Record<string, string>> = {
    alcance_diario: { metric: "reach", metric_type: "time_series" },
    totais: { metric: "views,reach,accounts_engaged,total_interactions,profile_links_taps", metric_type: "total_value" },
    // a API aceita follow_type (FOLLOWER / NON_FOLLOWER), não follower_type
    views_por_publico: { metric: "views", metric_type: "total_value", breakdown: "follow_type" },
    seguidores: { metric: "follows_and_unfollows", metric_type: "total_value", breakdown: "follow_type" },
  };
  const saida: Json = { dias: Math.min(dias, 28) };
  for (const [nome, params] of Object.entries(pedidos)) {
    try {
      saida[nome] = await graph(token, `${igId}/insights`, { ...janela, ...params });
    } catch (e) {
      if (semPermissao(e)) return { sem_permissao: true };
      saida[nome] = { erro: (e as Error).message };
    }
  }
  return saida;
}

Deno.serve(async (req) => {
  const chave = Deno.env.get("METRICAS_KEY");
  if (!chave || req.headers.get("x-chave") !== chave) return json({ erro: "nao_autorizado" }, 401);

  const url = new URL(req.url);
  const acao = url.searchParams.get("acao") ?? "perfil";
  const usuario = (url.searchParams.get("conta") ?? "").replace(/^@/, "").toLowerCase();
  const db = adminClient();

  const { data: contas } = await db.from("ig_account").select("id, ig_user_id, username").eq("is_active", true);
  const conta_ = (contas ?? []).find((c) => (c.username ?? "").toLowerCase() === usuario) ?? (usuario ? null : contas?.[0]);
  if (!conta_) return json({ erro: "conta_nao_encontrada" }, 404);
  const { data: tk } = await db.from("ig_tokens").select("access_token, expires_at, updated_at")
    .eq("ig_account_id", conta_.id).maybeSingle();
  // mesma regra do engine: sem token renovado pelo login, vale o token do cadastro original (variável de ambiente)
  const reserva = Deno.env.get("IG_PAGE_ACCESS_TOKEN");
  const token = tk?.access_token ? await renovarSeNecessario(db, conta_.id, tk) : reserva;
  if (!token) return json({ erro: "sem_token" }, 409);

  try {
    if (!tk?.access_token) {
      const dono = await graph(token, "me", { fields: "user_id" });
      if (String(dono.user_id ?? dono.id) !== String(conta_.ig_user_id)) return json({ erro: "token_de_outra_conta" }, 409);
    }
    if (acao === "perfil") {
      const { data: atual } = await db.from("ig_tokens").select("expires_at").eq("ig_account_id", conta_.id).maybeSingle();
      return json({ ...(await perfil(token, conta_.ig_user_id)), conexao: { renovada_pelo_login: !!tk?.access_token, expira_em: atual?.expires_at ?? null } });
    }
    if (acao === "posts") return json(await posts(token, conta_.ig_user_id, Number(url.searchParams.get("limite") ?? 60)));
    if (acao === "conta") return json(await conta(token, conta_.ig_user_id, Number(url.searchParams.get("dias") ?? 28)));
    return json({ erro: "acao_invalida" }, 400);
  } catch (e) {
    if (e instanceof ErroGraph && (e.codigo === 190 || /session|expired|invalid/i.test(e.message))) {
      return json({ erro: "token_invalido", mensagem: e.message }, 409);
    }
    return json({ erro: "falha", mensagem: (e as Error).message }, 502);
  }
});
