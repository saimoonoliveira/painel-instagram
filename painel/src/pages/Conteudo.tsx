import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { Button, Card, Empty } from "../components/ui";

interface Media {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
  views?: number | null;
  children?: { data: Media[] };
}

interface Arquivado {
  id: string;
  story_id: string;
  tipo: "video" | "imagem";
  arquivo: string;
  capa: string | null;
  postado_em: string | null;
  criado_em: string;
}

interface Payload {
  posts?: Media[];
  stories?: Media[];
  stories_erro?: string | null;
  views_liberadas?: boolean;
  next?: string | null;
  erro?: string;
  mensagem?: string;
}

// Uma "tela" do visualizador: um story, um post, ou um item de carrossel.
export interface Slide {
  id: string;
  baixar?: () => Promise<void>; // arquivo guardado (Monitor): baixa do nosso armazenamento, não da Meta
  type?: string;
  url: string;
  poster?: string;
  permalink?: string;
  timestamp?: string;
}

export interface ViewerState {
  slides: Slide[];
  start: number;
  kind: "story" | "reel" | "post";
  post?: Media;
}

const thumb = (m: Media) => m.thumbnail_url || m.media_url || "";
const fmt = (s?: string) => (s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
const fmtHora = (s?: string) => (s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const nums = (n?: number) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "—");

const toSlide = (m: Media, permalink = m.permalink): Slide => ({
  id: m.id,
  type: m.media_type,
  url: m.media_url || "",
  poster: m.thumbnail_url,
  permalink,
  timestamp: m.timestamp,
});
const slidesOf = (p: Media): Slide[] =>
  p.children?.data?.length ? p.children.data.map((c) => toSlide(c, p.permalink)) : [toSlide(p)];

// Player oficial do Instagram (embed): toca reels/vídeos que a API entrega sem arquivo (música protegida).
// Stories não têm embed.
function embedUrl(permalink?: string) {
  const m = permalink?.match(/instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([^/?#]+)/);
  return m ? `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/embed/` : null;
}

async function baixarArquivo(accountId: string, s: Slide, kind: ViewerState["kind"]) {
  const { data, error } = await supabase.functions.invoke("conteudo", { body: { accountId, baixar: s.id } });
  if (error || !(data instanceof Blob)) throw new Error("falha");
  const dia = s.timestamp ? s.timestamp.slice(0, 10) : "instagram";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(data);
  a.download = `${kind}-${dia}-${s.id}.${s.type === "VIDEO" ? "mp4" : "jpg"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function erroTexto(erro: string) {
  if (erro === "token_invalido") return "Conexão com o Instagram expirou. Reconecte na aba Conexão.";
  if (erro === "sem_token") return "Esta conta ainda não está conectada ao Instagram.";
  if (erro === "sem_acesso") return "Você não tem acesso a esta conta.";
  return "Não foi possível carregar o conteúdo agora. Tente de novo.";
}

export const PlayIcon = () => (
  <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
  </span>
);

export function Viewer({ slides, start, kind, post, accountId, onClose }: ViewerState & { accountId: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [dl, setDl] = useState<"idle" | "busy" | "err">("idle");
  const s = slides[i];
  const go = (d: number) => { setDl("idle"); setI((x) => Math.min(slides.length - 1, Math.max(0, x + d))); };
  const embed = !s.url ? embedUrl(s.permalink) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  async function baixar() {
    setDl("busy");
    try { await (s.baixar ? s.baixar() : baixarArquivo(accountId, s, kind)); setDl("idle"); } catch { setDl("err"); }
  }

  const navBtn = "absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/80 disabled:opacity-0";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Visualizar mídia" onClick={onClose}>
      <button onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" style={{ marginTop: "env(safe-area-inset-top)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>

      <div className="relative flex max-h-full w-full max-w-md flex-col" onClick={(e) => e.stopPropagation()}>
        {slides.length > 1 && (
          <div className="mb-2 flex gap-1" aria-hidden="true">
            {slides.map((x, j) => (
              <div key={x.id} className={`h-0.5 flex-1 rounded-full ${j <= i ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>
        )}

        <div className="relative grid place-items-center overflow-hidden rounded-xl bg-black">
          {s.url ? (
            s.type === "VIDEO" ? (
              <video key={s.id} src={s.url} poster={s.poster} controls autoPlay playsInline onEnded={() => go(1)} className="max-h-[74vh] w-full" />
            ) : (
              <img key={s.id} src={s.url} alt="" className="max-h-[74vh] w-full object-contain" />
            )
          ) : embed ? (
            <iframe key={s.id} src={embed} title="Player do Instagram" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen className="h-[74vh] w-full border-0 bg-white" />
          ) : (
            // Story com música protegida: a Meta não entrega o arquivo e story não tem player oficial
            <div className="relative w-full">
              {s.poster && <img src={s.poster} alt="" className="max-h-[74vh] w-full object-contain opacity-40" />}
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">
                A Meta não libera o vídeo deste story pela API (geralmente por causa da música). Ele abre no Instagram.
              </div>
            </div>
          )}

          {slides.length > 1 && (
            <>
              <button onClick={() => go(-1)} disabled={i === 0} aria-label="Anterior" className={`${navBtn} left-2`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button onClick={() => go(1)} disabled={i === slides.length - 1} aria-label="Próximo" className={`${navBtn} right-2`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          {s.url ? (
            <Button onClick={baixar} disabled={dl === "busy"} className="flex-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
              {dl === "busy" ? "Baixando…" : dl === "err" ? "Falhou — tentar de novo" : s.type === "VIDEO" ? "Baixar vídeo" : "Baixar imagem"}
            </Button>
          ) : (
            <p className="flex-1 text-xs text-white/55">Download indisponível: a Meta não libera o arquivo deste vídeo (música protegida).</p>
          )}
          {s.permalink && (
            <a href={s.permalink} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg px-3 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white">
              Abrir no Instagram
            </a>
          )}
        </div>

        <div className="mt-2 max-h-[14vh] overflow-y-auto text-sm text-white/85">
          {post?.caption && <p className="whitespace-pre-line">{post.caption}</p>}
          <div className="nums mt-2 flex items-center gap-3 text-xs text-white/55">
            {post && typeof post.views === "number" && <span>👁 {nums(post.views)}</span>}
            {post && <span>♥ {nums(post.like_count)}</span>}
            {post && <span>💬 {nums(post.comments_count)}</span>}
            <span>{fmtHora(s.timestamp ?? post?.timestamp)}</span>
            {slides.length > 1 && <span>{i + 1}/{slides.length}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Conteudo() {
  const { accountId } = useAccounts();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [soReels, setSoReels] = useState(false);
  const [maisVistos, setMaisVistos] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const contaAtual = useRef(accountId);
  contaAtual.current = accountId;
  const fileira = useRef<HTMLDivElement>(null);
  const [arquivo, setArquivo] = useState<{ itens: Arquivado[]; urls: Record<string, string>; temConta: boolean } | null>(null);

  // stories antigos: o que o Monitor guardou da própria conta (perfil "propria"), desde que foi incluída
  useEffect(() => {
    setArquivo(null);
    if (!accountId) return;
    (async () => {
      const { data: perf } = await supabase.from("perfis_monitorados").select("id")
        .eq("ig_account_id", accountId).eq("categoria", "propria").maybeSingle();
      if (!perf) { setArquivo({ itens: [], urls: {}, temConta: false }); return; }
      const { data: rows } = await supabase.from("stories_arquivados").select("id,story_id,tipo,arquivo,capa,postado_em,criado_em")
        .eq("perfil_id", perf.id).order("postado_em", { ascending: false, nullsFirst: false }).limit(300);
      const itens = (rows as Arquivado[]) ?? [];
      const caminhos = itens.flatMap((x) => (x.capa ? [x.arquivo, x.capa] : [x.arquivo]));
      const urls: Record<string, string> = {};
      if (caminhos.length) {
        const { data: links } = await supabase.storage.from("stories").createSignedUrls(caminhos, 60 * 60);
        for (const l of links ?? []) if (l.path && l.signedUrl) urls[l.path] = l.signedUrl;
      }
      if (contaAtual.current === accountId) setArquivo({ itens, urls, temConta: true });
    })();
  }, [accountId]);

  useEffect(() => {
    if (!accountId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase.functions
      .invoke("conteudo", { body: { accountId } })
      .then(({ data, error }) => { if (contaAtual.current === accountId) setData((data as Payload) ?? { erro: error ? "falha" : undefined }); })
      .catch(() => setData({ erro: "falha" }))
      .finally(() => setLoading(false));
  }, [accountId]);

  // todos=true segue página por página até o fim (para ordenar por views sobre todos os reels)
  async function carregarMais(todos = false) {
    if (!accountId || !data?.next) return;
    const conta = accountId;
    let cursor: string | null | undefined = data.next;
    setLoadingMore(true);
    while (cursor) {
      const { data: d } = await supabase.functions.invoke("conteudo", { body: { accountId: conta, after: cursor } });
      const mais = d as Payload | null;
      // para se trocou de conta no meio do carregamento
      if (contaAtual.current !== conta || !mais?.posts) break;
      setData((prev) => ({ ...prev, posts: [...(prev?.posts ?? []), ...mais.posts!], next: mais.next ?? null }));
      cursor = todos ? mais.next : null;
    }
    setLoadingMore(false);
  }

  const posts = data?.posts ?? [];
  const stories = data?.stories ?? [];
  const noAr = stories.map((s) => ({ key: s.id, thumb: thumb(s), video: s.media_type === "VIDEO", quando: s.timestamp ?? "", noAr: true, slide: toSlide(s) }));
  // o mesmo story vem com ids diferentes da Meta e do Apify: casa pelo horário de postagem (até 2 min)
  const tempos = noAr.map((x) => new Date(x.quando).getTime());
  const antigos = (arquivo?.itens ?? [])
    .filter((x) => !tempos.some((t) => Math.abs(t - new Date(x.postado_em ?? x.criado_em).getTime()) < 120e3))
    .map((x) => {
      const quando = x.postado_em ?? x.criado_em;
      const u = arquivo!.urls;
      const slide: Slide = {
        id: x.id, type: x.tipo === "video" ? "VIDEO" : "IMAGE", url: u[x.arquivo] ?? "",
        poster: x.capa ? u[x.capa] : undefined, timestamp: quando,
        baixar: async () => {
          const nome = `story-${quando.slice(0, 10)}-${x.story_id}.${x.tipo === "video" ? "mp4" : "jpg"}`;
          const { data: l, error } = await supabase.storage.from("stories").createSignedUrl(x.arquivo, 600, { download: nome });
          if (error || !l) throw error ?? new Error("sem link");
          const a = document.createElement("a");
          a.href = l.signedUrl;
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
      };
      return { key: x.id, thumb: x.capa ? u[x.capa] : x.tipo === "imagem" ? u[x.arquivo] : "", video: x.tipo === "video", quando, noAr: false, slide };
    });
  const fila = [...noAr, ...antigos].sort((a, b) => b.quando.localeCompare(a.quando));
  const rolar = (lado: 1 | -1) => fileira.current?.scrollBy({ left: lado * fileira.current.clientWidth * 0.8, behavior: "smooth" });
  const filtrados = soReels ? posts.filter((p) => p.media_product_type === "REELS") : posts;
  const mostrados = maisVistos ? [...filtrados].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)) : filtrados;
  const chip = (ativo: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${ativo ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`;

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Conteúdo</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Assista e baixe seus stories, reels e posts</p>
      </div>

      {loading ? (
        <Empty>Carregando do Instagram…</Empty>
      ) : data?.erro ? (
        <Card className="p-6 text-sm text-[var(--text-dim)]">
          {erroTexto(data.erro)}
          {data.erro === "token_invalido" || data.erro === "sem_token" ? (
            <Link to="/integracao" className="ml-1 font-medium text-[var(--accent-hi)] hover:underline">Ir para Conexão →</Link>
          ) : null}
        </Card>
      ) : (
        <>
          {/* Stories: no ar agora (Meta, 24h) + arquivo da própria conta (Monitor) */}
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-[var(--text-dim)]">Stories</span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" /> no ar agora · {noAr.length}
              </span>
              {arquivo?.temConta && (
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--text-faint)]" aria-hidden="true" /> arquivo · {antigos.length}
                </span>
              )}
            </div>
            {fila.length === 0 ? (
              <Card className="p-5 text-sm text-[var(--text-faint)]">
                {data?.stories_erro
                  ? "Stories indisponíveis para esta conexão (pode exigir reconectar o Instagram)."
                  : "Nenhum story no ar agora. Eles aparecem aqui enquanto estiverem publicados (24h)."}
              </Card>
            ) : (
              <div className="relative">
                <div ref={fileira} className="flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2">
                  {fila.map((it, idx) => (
                    <button
                      key={it.key}
                      onClick={() => setViewer({ slides: fila.map((x) => x.slide), start: idx, kind: "story" })}
                      aria-label={`Ver story de ${fmtHora(it.quando)}${it.noAr ? " (no ar)" : ""}`}
                      className={`group relative aspect-[9/16] w-24 shrink-0 snap-start overflow-hidden rounded-xl border-2 bg-[var(--surface-2)] ${it.noAr ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
                    >
                      {it.thumb ? (
                        <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-[var(--text-faint)]">{it.video ? "vídeo" : "imagem"}</div>
                      )}
                      {it.video && <PlayIcon />}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1 text-left text-[10px] font-medium leading-tight text-white">
                        {fmt(it.quando)}
                        {!it.noAr && <span className="block text-white/70">{new Date(it.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
                      </div>
                    </button>
                  ))}
                </div>
                {fila.length > 6 && (
                  <>
                    <button onClick={() => rolar(-1)} aria-label="Stories mais novos"
                      className="absolute left-0 top-1/2 hidden h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-lg hover:bg-[var(--surface-hover)] md:grid">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <button onClick={() => rolar(1)} aria-label="Stories mais antigos"
                      className="absolute right-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-lg hover:bg-[var(--surface-hover)] md:grid">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  </>
                )}
              </div>
            )}
            {arquivo && !arquivo.temConta && (
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                Para guardar os stories desta conta depois que saem do ar, inclua ela em <Link to="/monitor" className="text-[var(--accent-hi)] hover:underline">Monitor → Comparativo</Link>.
              </p>
            )}
          </div>

          {/* Posts e reels */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-[var(--text-dim)]">Posts e reels <span className="nums text-[var(--text-faint)]">· {posts.length} carregados</span></div>
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1 rounded-full border border-[var(--border)] p-0.5" role="group" aria-label="Tipo">
                <button className={chip(!soReels)} aria-pressed={!soReels} onClick={() => setSoReels(false)}>Todos</button>
                <button className={chip(soReels)} aria-pressed={soReels} onClick={() => setSoReels(true)}>Só reels</button>
              </div>
              <div className="flex gap-1 rounded-full border border-[var(--border)] p-0.5" role="group" aria-label="Ordem">
                <button className={chip(!maisVistos)} aria-pressed={!maisVistos} onClick={() => setMaisVistos(false)}>Recentes</button>
                <button className={chip(maisVistos)} aria-pressed={maisVistos} onClick={() => setMaisVistos(true)}>Mais vistos</button>
              </div>
            </div>
          </div>
          {maisVistos && data?.views_liberadas === false && (
            <Card className="mb-3 p-4 text-sm text-[var(--text-dim)]">
              As visualizações não vieram: a conexão desta conta não tem a permissão de métricas.
              <Link to="/integracao" className="ml-1 font-medium text-[var(--accent-hi)] hover:underline">Renovar conexão →</Link>
            </Card>
          )}
          {maisVistos && data?.next && data?.views_liberadas !== false && (
            <p className="mb-3 text-xs text-[var(--text-faint)]">
              O ranking considera só os {posts.length} já carregados. Use "Carregar todos" para ranquear todos os seus posts.
            </p>
          )}
          {mostrados.length === 0 ? (
            <Empty>{soReels ? "Nenhum reel entre os carregados." : "Nenhum post encontrado nesta conta."}</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {mostrados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setViewer({ slides: slidesOf(p), start: 0, kind: p.media_product_type === "REELS" ? "reel" : "post", post: p })}
                  aria-label={p.caption ? `Ver post: ${p.caption.slice(0, 60)}` : "Ver post"}
                  className="group overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="relative aspect-square bg-[var(--surface-2)]">
                    {thumb(p) ? (
                      <img src={thumb(p)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-[var(--text-faint)]">{p.media_type}</div>
                    )}
                    {p.media_type === "VIDEO" && <PlayIcon />}
                    {p.media_product_type === "REELS" ? (
                      <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Reel</span>
                    ) : p.media_type === "CAROUSEL_ALBUM" ? (
                      <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Carrossel</span>
                    ) : null}
                  </div>
                  <div className="p-3">
                    {p.caption ? (
                      <p className="line-clamp-2 text-xs text-[var(--text-dim)]">{p.caption}</p>
                    ) : (
                      <p className="text-xs text-[var(--text-faint)]">Sem legenda</p>
                    )}
                    <div className="nums mt-2 flex items-center gap-3 text-[11px] text-[var(--text-faint)]">
                      {typeof p.views === "number" && <span className={maisVistos ? "font-semibold text-[var(--accent-hi)]" : ""}>👁 {nums(p.views)}</span>}
                      <span>♥ {nums(p.like_count)}</span>
                      <span>💬 {nums(p.comments_count)}</span>
                      <span className="ml-auto">{fmt(p.timestamp)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {data?.next && (
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="ghost" onClick={() => carregarMais()} disabled={loadingMore}>
                {loadingMore ? `Carregando… (${posts.length})` : "Carregar mais"}
              </Button>
              <Button variant="ghost" onClick={() => carregarMais(true)} disabled={loadingMore}>Carregar todos</Button>
            </div>
          )}
        </>
      )}

      {viewer && accountId && <Viewer {...viewer} accountId={accountId} onClose={() => setViewer(null)} />}
    </div>
  );
}
