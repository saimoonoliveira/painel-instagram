// Monitor: coleta os stories de concorrentes/inspirações pelo Apify e guarda no bucket "stories".
//   POST { agendados: true }  cabeçalho x-chave = VIGIAR_KEY (pg_cron de 15 em 15 min: migração 0009)
//                             -> recolhe coletas que terminaram e inicia as dos perfis vencidos (20h)
//   POST { perfilId }         login do painel (JWT + RLS) -> "Verificar agora": coleta e espera até ~100s
// Plano grátis do Apify: 1 perfil por execução, então cada perfil tem a sua.
// Tudo é idempotente (story único por perfil, upload com upsert): se cair no meio, a próxima rodada completa.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "../_shared/db.ts";

const ATOR = "dami_studio~instagram-stories-scraper";
const API = "https://api.apify.com/v2";
const VENCE_H = 20; // story vive 24h: verificar a cada ~20h pega todos sem pagar o mesmo 2 vezes

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Db = ReturnType<typeof adminClient>;
type Perfil = { id: string; ig_account_id: string; username: string; run_id: string | null; run_iniciado_em: string | null };
type Item = Record<string, unknown>;

async function apify(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get("APIFY_TOKEN")}`, "Content-Type": "application/json" },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? `Apify HTTP ${r.status}`);
  return body;
}

const perfis = (db: Db) => db.from("perfis_monitorados");

async function iniciar(db: Db, p: Perfil) {
  const run = await apify(`/acts/${ATOR}/runs?timeout=180`, {
    method: "POST",
    body: JSON.stringify({ profiles: [p.username], mode: "storiesOnly", includeHighlights: false, maxStoriesPerProfile: 100 }),
  });
  p.run_id = run.data.id;
  p.run_iniciado_em = new Date().toISOString();
  await perfis(db).update({ run_id: p.run_id, run_iniciado_em: p.run_iniciado_em, erro: null }).eq("id", p.id);
}

async function guardar(db: Db, url: string, caminho: string, tipo: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const { error } = await db.storage.from("stories").upload(caminho, await r.arrayBuffer(), { contentType: tipo, upsert: true });
  if (error) throw error;
}

const quando = (v: unknown) => {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  return typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
};

// Recolhe a coleta do perfil: se terminou, guarda os stories novos. Devolve o status do Apify.
async function recolher(db: Db, p: Perfil) {
  const run = (await apify(`/actor-runs/${p.run_id}`)).data;
  if (run.status === "READY" || run.status === "RUNNING") {
    if (Date.now() - new Date(p.run_iniciado_em ?? 0).getTime() < 30 * 60e3) return { status: run.status };
    run.status = "TRAVADA";
  }
  if (run.status !== "SUCCEEDED") {
    // falhou: tenta de novo em ~2h em vez de esperar o dia seguinte
    const nova = new Date(Date.now() - (VENCE_H - 2) * 3600e3).toISOString();
    await perfis(db).update({ run_id: null, erro: `coleta ${run.status}`, ultima_verificacao: nova }).eq("id", p.id);
    return { status: run.status };
  }

  const itens: Item[] = await apify(`/datasets/${run.defaultDatasetId}/items?clean=true`);
  // linhas de resumo/diagnóstico não têm mídia
  const stories = itens.filter((i) => i.storyId && (i.videoUrl || i.imageUrl) && i.recordType !== "highlight");
  const { data: ja } = await db.from("stories_arquivados").select("story_id").eq("perfil_id", p.id)
    .in("story_id", stories.map((s) => String(s.storyId)));
  const existentes = new Set((ja ?? []).map((r) => r.story_id));

  // foto de perfil oficial: guardada a cada verificação, então acompanha se o perfil trocar
  let foto: string | undefined;
  const fotoUrl = itens.map((i) => i.ownerProfilePicUrl ?? i.profilePicUrl).find(Boolean);
  if (fotoUrl) {
    foto = `${p.ig_account_id}/${p.username}/perfil.jpg`;
    await guardar(db, String(fotoUrl), foto, "image/jpeg").catch(() => (foto = undefined));
  }

  let novos = 0, falhas = 0;
  for (const s of stories) {
    const storyId = String(s.storyId);
    if (existentes.has(storyId)) continue;
    try {
      const video = !!s.videoUrl;
      const base = `${p.ig_account_id}/${p.username}/${storyId}`;
      const arquivo = `${base}.${video ? "mp4" : "jpg"}`;
      await guardar(db, String(video ? s.videoUrl : s.imageUrl), arquivo, video ? "video/mp4" : "image/jpeg");
      let capa: string | null = null;
      if (video && s.imageUrl) {
        capa = `${base}-capa.jpg`;
        await guardar(db, String(s.imageUrl), capa, "image/jpeg").catch(() => (capa = null));
      }
      // o resto da linha (links, menções, duração...) vai inteiro; os links de mídia expiram, então saem
      const { imageUrl: _i, videoUrl: _v, ownerProfilePicUrl: _o, ...extras } = s;
      await db.from("stories_arquivados").upsert({
        perfil_id: p.id, ig_account_id: p.ig_account_id, story_id: storyId,
        tipo: video ? "video" : "imagem", arquivo, capa,
        postado_em: quando(s.takenAt), legenda: (s.caption as string) || null, extras,
      }, { onConflict: "perfil_id,story_id", ignoreDuplicates: true });
      novos++;
    } catch (e) {
      falhas++;
      console.error("story", storyId, (e as Error).message);
    }
  }
  await perfis(db).update({
    run_id: null, ultima_verificacao: new Date().toISOString(),
    erro: falhas ? `${falhas} story(s) não baixaram` : null,
    ...(foto ? { foto } : {}),
  }).eq("id", p.id);
  return { status: "SUCCEEDED", encontrados: stories.length, novos, falhas, tipos: [...new Set(itens.map((i) => i.recordType))] };
}

const PERFIL_ATOR = "apify~instagram-profile-scraper";
// o retrato é 1 por dia, no fuso de Brasília
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && v >= 0 ? v : null); // -1 = curtidas escondidas
const tipoPost = (x: Item) =>
  x.type === "Sidecar" ? "carrossel" : x.type === "Video" || x.productType === "clips" ? "reels" : "estatico";

// Retrato diário (seguidores, posts recentes com curtidas/comentários) dos perfis vencidos, numa execução só.
// Um @ acompanhado por mais de uma conta é coletado uma vez e vale para todas.
async function retratos(db: Db, lista: (Perfil & { metricas_em: string | null })[]) {
  const limite = Date.now() - VENCE_H * 3600e3;
  const devidos = lista.filter((p) => !p.metricas_em || new Date(p.metricas_em).getTime() < limite).slice(0, 30);
  const nomes = [...new Set(devidos.map((p) => p.username))];
  if (!nomes.length) return null;
  // síncrono: sai em segundos por perfil; 30 perfis ainda cabem no limite de 150s da função
  const itens: Item[] = await apify(`/acts/${PERFIL_ATOR}/run-sync-get-dataset-items?timeout=120`, {
    method: "POST",
    body: JSON.stringify({ usernames: nomes }),
  });
  const porNome = new Map(itens.map((i) => [String(i.username ?? "").toLowerCase(), i]));
  let ok = 0;
  for (const p of devidos) {
    const it = porNome.get(p.username);
    const agora = new Date().toISOString();
    if (!it || it.error) {
      // privado, inexistente ou bloqueado na coleta: tenta de novo no próximo dia
      await perfis(db).update({ metricas_em: agora }).eq("id", p.id);
      continue;
    }
    const r1 = await db.from("perfil_metricas").upsert({
      perfil_id: p.id, ig_account_id: p.ig_account_id, dia: hojeBR(),
      seguidores: num(it.followersCount), seguindo: num(it.followsCount), posts_total: num(it.postsCount),
    });
    const posts = ((it.latestPosts as Item[]) ?? []).filter((x) => x.id);
    const r2 = posts.length
      ? await db.from("perfil_posts").upsert(posts.map((x) => ({
        perfil_id: p.id, ig_account_id: p.ig_account_id, post_id: String(x.id), shortcode: x.shortCode ?? null,
        tipo: tipoPost(x), postado_em: quando(x.timestamp), curtidas: num(x.likesCount), comentarios: num(x.commentsCount),
        visualizacoes: num(x.videoViewCount ?? x.videoPlayCount), atualizado_em: agora,
      })))
      : { error: null };
    if (r1.error || r2.error) console.error("retrato", p.username, r1.error?.message, r2.error?.message);
    // foto oficial também para quem nunca teve story no ar
    let foto: string | undefined;
    const fotoUrl = it.profilePicUrlHD ?? it.profilePicUrl;
    if (fotoUrl) {
      foto = `${p.ig_account_id}/${p.username}/perfil.jpg`;
      await guardar(db, String(fotoUrl), foto, "image/jpeg").catch(() => (foto = undefined));
    }
    await perfis(db).update({ metricas_em: agora, ...(foto ? { foto } : {}) }).eq("id", p.id);
    ok++;
  }
  return { perfis: nomes.length, ok };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!Deno.env.get("APIFY_TOKEN")) return json({ erro: "sem_apify" }, 500);
  const body = await req.json().catch(() => ({}));
  const db = adminClient();

  if (body.agendados) {
    const chave = Deno.env.get("VIGIAR_KEY");
    if (!chave || req.headers.get("x-chave") !== chave) return json({ erro: "nao_autorizado" }, 401);
    const { data } = await perfis(db).select("*").eq("ativo", true);
    const limite = Date.now() - VENCE_H * 3600e3;
    const res = [];
    for (const p of (data ?? []) as (Perfil & { ultima_verificacao: string | null })[]) {
      try {
        if (p.run_id) res.push({ perfil: p.username, ...(await recolher(db, p)) });
        else if (!p.ultima_verificacao || new Date(p.ultima_verificacao).getTime() < limite) {
          await iniciar(db, p);
          res.push({ perfil: p.username, status: "INICIADA" });
        }
      } catch (e) {
        await perfis(db).update({ erro: (e as Error).message }).eq("id", p.id);
        res.push({ perfil: p.username, erro: (e as Error).message });
      }
    }
    let metricas: unknown = null;
    try {
      metricas = await retratos(db, (data ?? []) as (Perfil & { metricas_em: string | null })[]);
    } catch (e) {
      metricas = { erro: (e as Error).message };
    }
    return json({ ok: true, res, metricas });
  }

  // "Verificar agora" pelo painel: só perfis que a RLS deixa este usuário ver
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return json({ erro: "nao_autorizado" }, 401);
  const { data: p } = await user.from("perfis_monitorados").select("*").eq("id", body.perfilId ?? "").maybeSingle();
  if (!p) return json({ erro: "sem_acesso" }, 403);

  try {
    // retrato do perfil na hora (seguidores, posts): é o que aparece no Comparativo
    await retratos(db, [{ ...p, metricas_em: null }]).catch((e) => console.error("retrato", (e as Error).message));
    if (!p.run_id) await iniciar(db, p);
    // espera a coleta (até ~80s); se não terminar, o agendador recolhe em até 15 min
    for (let i = 0; i < 16; i++) {
      const r = await recolher(db, p);
      if (r.status !== "READY" && r.status !== "RUNNING") return json({ ok: r.status === "SUCCEEDED", ...r });
      await new Promise((ok) => setTimeout(ok, 5000));
    }
    return json({ ok: true, status: "RUNNING" });
  } catch (e) {
    await perfis(db).update({ erro: (e as Error).message }).eq("id", p.id);
    return json({ ok: false, mensagem: (e as Error).message }, 502);
  }
});
