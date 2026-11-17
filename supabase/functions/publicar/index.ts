// Publica no Instagram os carrosséis da aba Posts.
//   POST { postId }           login do painel (JWT + RLS)          -> publica agora: { ok, link } ou { ok: false, mensagem }
//   POST { postId, verificar } idem, antes de agendar               -> confere conexão e permissão de publicar: { ok } ou { ok: false, mensagem }
//   POST { agendados: true }  cabeçalho x-chave = PUBLICAR_KEY     -> publica os agendados que já venceram
//                             (o pg_cron chama a cada minuto, só quando há algum vencido: migração 0008)
// Enquanto publica, o post fica travado (publicando_em): clique duplo, botão e agendador nunca publicam 2 vezes.
// Se falhar, o post volta para "Aprovado" com o motivo em erro_publicacao (o agendador não tenta de novo sozinho).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "../_shared/db.ts";
import { renovarSeNecessario } from "../_shared/token.ts";
import { chamarMeta, ErroMeta, linkDoPost, publicarCarrossel } from "./carrossel.ts";

const V = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const IG = `https://graph.instagram.com/${V}`;
// uma publicação leva menos de 2 minutos; trava mais velha que isso é de uma execução que caiu no meio
const TRAVA_MIN = 10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type Db = ReturnType<typeof adminClient>;

// O que a pessoa lê na tela quando não sai
function motivo(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  const c = (e as ErroMeta)?.codigo;
  if (c === 10 || c === 200 || /permission/i.test(m)) {
    return "Falta a permissão de publicar. Reconecte a conta em Integração e aceite a permissão nova.";
  }
  if (c === 190 || /session has expired|access token/i.test(m)) return "A conexão com o Instagram venceu. Reconecte a conta em Integração.";
  return m;
}

// Token da conta, renovado se estiver perto de vencer. Conta desconectada no app (Integração) não publica.
async function contaParaPublicar(db: Db, contaId: string) {
  const { data: conta } = await db.from("ig_account").select("id, ig_user_id, is_active").eq("id", contaId).maybeSingle();
  if (!conta?.is_active) throw new Error("A conta está desconectada no app. Reconecte em Integração.");
  const { data: tk } = await db.from("ig_tokens").select("access_token, expires_at, updated_at").eq("ig_account_id", conta.id).maybeSingle();
  if (!tk?.access_token) throw new Error("A conta não tem o login do Instagram salvo. Reconecte em Integração.");
  return { igUserId: String(conta.ig_user_id), meta: chamarMeta(await renovarSeNecessario(db, conta.id, tk), IG) };
}

async function publicarPost(db: Db, postId: string): Promise<string | null> {
  const trava = new Date(Date.now() - TRAVA_MIN * 60e3).toISOString();
  const { data: post } = await db.from("posts")
    .update({ publicando_em: new Date().toISOString(), erro_publicacao: null })
    .eq("id", postId)
    .in("status", ["aprovado", "agendado"])
    .is("ig_media_id", null)
    .or(`publicando_em.is.null,publicando_em.lt."${trava}"`)
    .select("id, ig_account_id, status, legenda, slides, agendado_para, ig_container_id")
    .maybeSingle();
  if (!post) {
    throw new Error("Esse post não pode ser publicado agora: precisa estar Aprovado ou Agendado e não pode já estar saindo ou ter saído pelo app.");
  }

  try {
    const { meta, igUserId } = await contaParaPublicar(db, post.ig_account_id);
    const legenda = (post.legenda ?? "").trim();
    if (legenda.length > 2200) throw new Error(`A legenda tem ${legenda.length} caracteres; o limite do Instagram é 2.200.`);
    const slides = (post.slides ?? []) as { jpg: string; ig?: string }[];
    if (slides.length < 2 || slides.length > 20) throw new Error(`O carrossel precisa ter de 2 a 20 slides (tem ${slides.length}).`);
    // ig = JPEG em alta para publicar (a Meta só aceita JPEG); posts antigos sem ele usam a prévia
    const { data: urls } = await db.storage.from("posts").createSignedUrls(slides.map((s) => s.ig ?? s.jpg), 60 * 60);
    const imagens = (urls ?? []).map((u) => u.signedUrl).filter(Boolean) as string[];
    if (imagens.length !== slides.length) throw new Error("Não achei todos os slides no armazenamento do app.");

    const mediaId = await publicarCarrossel({
      meta,
      igUserId,
      imagens,
      legenda,
      containerAnterior: post.ig_container_id,
      guardarContainer: async (id) => {
        const { error } = await db.from("posts").update({ ig_container_id: id }).eq("id", post.id);
        if (error) throw new Error("Não deu para salvar o andamento no banco. Nada foi publicado.");
      },
    });

    // daqui para baixo o post já está no ar: nada mais volta para "Aprovado"
    const link = mediaId ? await linkDoPost(meta, mediaId) : null;
    await db.from("posts").update({
      status: "postado",
      postado_em: new Date().toISOString(),
      ig_media_id: mediaId,
      link,
      publicando_em: null,
      erro_publicacao: mediaId ? null : "Saiu numa tentativa anterior; o app não guardou o link. Cole o link do post se quiser.",
    }).eq("id", post.id);
    return link;
  } catch (e) {
    let msg = motivo(e);
    if (post.status === "agendado" && post.agendado_para) {
      const hora = new Date(post.agendado_para).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      msg = `Era para sair em ${hora}. ${msg}`;
    }
    // volta para Aprovado e sem data: o agendador não insiste sozinho num erro que precisa de você
    await db.from("posts").update({ status: "aprovado", agendado_para: null, publicando_em: null, erro_publicacao: msg }).eq("id", post.id);
    throw new Error(msg);
  }
}

async function publicarVencidos(db: Db) {
  const { data: vencidos } = await db.from("posts").select("id")
    .eq("status", "agendado").lte("agendado_para", new Date().toISOString()).is("publicando_em", null)
    .order("agendado_para").limit(5);
  const feitos: { id: string; ok: boolean; erro?: string }[] = [];
  for (const p of vencidos ?? []) {
    try {
      await publicarPost(db, p.id);
      feitos.push({ id: p.id, ok: true });
    } catch (e) {
      feitos.push({ id: p.id, ok: false, erro: (e as Error).message });
    }
  }
  return feitos;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);
  const corpo = await req.json().catch(() => ({}));
  const db = adminClient();

  if (corpo.agendados) {
    const chave = Deno.env.get("PUBLICAR_KEY");
    if (!chave || req.headers.get("x-chave") !== chave) return json({ erro: "nao_autorizado" }, 401);
    return json({ publicados: await publicarVencidos(db) });
  }

  // botão "Publicar agora": só publica post de conta que esta pessoa enxerga (RLS)
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return json({ erro: "nao_autorizado" }, 401);
  const postId = String(corpo.postId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(postId)) return json({ erro: "post_invalido" }, 400);
  const { data: visivel } = await user.from("posts").select("id, ig_account_id").eq("id", postId).maybeSingle();
  if (!visivel) return json({ erro: "sem_acesso" }, 403);

  try {
    if (corpo.verificar) {
      // antes de agendar: sem isso, um agendamento sem permissão só daria erro na hora marcada
      const { meta, igUserId } = await contaParaPublicar(db, visivel.ig_account_id);
      await meta(`${igUserId}/content_publishing_limit`, { fields: "quota_usage" });
      return json({ ok: true });
    }
    return json({ ok: true, link: await publicarPost(db, postId) });
  } catch (e) {
    return json({ ok: false, mensagem: motivo(e) });
  }
});
