import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { useConfirm } from "../lib/confirm";
import { Button, Card, Empty, Input, Select } from "../components/ui";
import { PlayIcon, Viewer, type Slide } from "./Conteudo";

type Categoria = "concorrente" | "inspiracao" | "propria";

interface Perfil {
  id: string;
  username: string;
  categoria: Categoria;
  ativo: boolean;
  ultima_verificacao: string | null;
  run_id: string | null;
  erro: string | null;
  foto: string | null;
}

interface StoryArq {
  id: string;
  story_id: string;
  tipo: "video" | "imagem";
  arquivo: string;
  capa: string | null;
  postado_em: string | null;
  criado_em: string;
  perfis_monitorados?: { username: string } | null;
}

interface Referencia {
  id: string;
  etiqueta: string;
  nome: string | null;
  stories: string[];
  criado_em: string;
}

const CAMPOS = "id,story_id,tipo,arquivo,capa,postado_em,criado_em,perfis_monitorados(username)";

// cor do anel de cada lista vem do tema (index.css: --anel-*)
const ANEL: Record<Categoria, string> = {
  propria: "[background:var(--anel-propria)]",
  concorrente: "[background:var(--anel-concorrente)]",
  inspiracao: "[background:var(--anel-inspiracao)]",
};

const GRUPOS: { cat: Categoria; titulo: string }[] = [
  { cat: "propria", titulo: "Sua conta" },
  { cat: "concorrente", titulo: "Concorrentes" },
  { cat: "inspiracao", titulo: "Inspirações" },
];

// aceita @perfil, perfil ou o link do Instagram
function lerUsuario(txt: string) {
  const u = txt.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : null;
}

const fmtHora = (s?: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
const fmtDia = (s: string) => new Date(s).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
const quando = (s: StoryArq) => s.postado_em ?? s.criado_em;
const cronologico = (a: StoryArq, b: StoryArq) => quando(a).localeCompare(quando(b));

async function assinar(lista: StoryArq[]) {
  const caminhos = lista.flatMap((s) => (s.capa ? [s.arquivo, s.capa] : [s.arquivo]));
  const urls: Record<string, string> = {};
  if (!caminhos.length) return urls;
  const { data } = await supabase.storage.from("stories").createSignedUrls(caminhos, 60 * 60);
  for (const l of data ?? []) if (l.path && l.signedUrl) urls[l.path] = l.signedUrl;
  return urls;
}

function slidesDe(lista: StoryArq[], urls: Record<string, string>): Slide[] {
  return lista.map((s) => ({
    id: s.id,
    type: s.tipo === "video" ? "VIDEO" : "IMAGE",
    url: urls[s.arquivo] ?? "",
    poster: s.capa ? urls[s.capa] : undefined,
    timestamp: quando(s),
    baixar: async () => {
      const nome = `${s.perfis_monitorados?.username ?? "story"}-${quando(s).slice(0, 10)}-${s.story_id}.${s.tipo === "video" ? "mp4" : "jpg"}`;
      const { data, error } = await supabase.storage.from("stories").createSignedUrl(s.arquivo, 600, { download: nome });
      if (error || !data) throw error ?? new Error("sem link");
      const a = document.createElement("a");
      a.href = data.signedUrl;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  }));
}

function Miniatura({ s, urls, onClick, ordem }: { s: StoryArq; urls: Record<string, string>; onClick: () => void; ordem?: number }) {
  const thumb = s.capa ? urls[s.capa] : s.tipo === "imagem" ? urls[s.arquivo] : undefined;
  return (
    <button
      onClick={onClick}
      aria-label={ordem ? `Story ${ordem} da sequência` : `Ver story de ${fmtHora(s.postado_em)}`}
      aria-pressed={ordem !== undefined ? true : undefined}
      className={`group relative aspect-[9/16] w-full overflow-hidden rounded-xl border bg-[var(--surface-2)] ${ordem ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-[var(--border)]"}`}
    >
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
      ) : (
        <span className="grid h-full place-items-center text-xs text-[var(--text-faint)]">vídeo</span>
      )}
      {s.tipo === "video" && <PlayIcon />}
      {ordem !== undefined && (
        <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-sm font-semibold text-[var(--on-accent)]">{ordem}</span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5 text-left text-xs font-medium text-white">
        {new Date(quando(s)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </button>
  );
}

function Stories({ perfil, accountId, etiquetas, onSalvo }: { perfil: Perfil; accountId: string; etiquetas: string[]; onSalvo: () => void }) {
  const [stories, setStories] = useState<StoryArq[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<number | null>(null);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [selecionando, setSelecionando] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [etiqueta, setEtiqueta] = useState("");
  const [nome, setNome] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setStories(null);
    (async () => {
      let q = supabase.from("stories_arquivados").select(CAMPOS).eq("perfil_id", perfil.id);
      if (de) q = q.gte("postado_em", new Date(`${de}T00:00:00`).toISOString());
      if (ate) q = q.lte("postado_em", new Date(`${ate}T23:59:59.999`).toISOString());
      const { data } = await q.order("postado_em", { ascending: false, nullsFirst: false }).limit(500);
      const lista = (data as unknown as StoryArq[]) ?? [];
      // dias do mais novo para o mais antigo; dentro do dia, na ordem em que foram postados (como no Instagram)
      lista.sort((a, b) => fmtDiaChave(b).localeCompare(fmtDiaChave(a)) || cronologico(a, b));
      setUrls(await assinar(lista));
      setStories(lista);
    })();
  }, [perfil.id, perfil.ultima_verificacao, de, ate]);

  function alternar(s: StoryArq) {
    const n = new Set(sel);
    if (n.has(s.id)) n.delete(s.id);
    else n.add(s.id);
    setSel(n);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const ids = (stories ?? []).filter((s) => sel.has(s.id)).sort(cronologico).map((s) => s.id);
    const { error } = await supabase.from("referencias").insert({ ig_account_id: accountId, etiqueta: etiqueta.trim(), nome: nome.trim() || null, stories: ids });
    if (error) { setMsg("Não foi possível salvar agora."); return; }
    setMsg(`Sequência de ${ids.length} stories salva em "${etiqueta.trim()}". Veja na aba Referências.`);
    setSel(new Set());
    setSelecionando(false);
    setEtiqueta("");
    setNome("");
    onSalvo();
  }

  // posição de cada selecionado na sequência (ordem de postagem)
  const ordem = new Map((stories ?? []).filter((s) => sel.has(s.id)).sort(cronologico).map((s, i) => [s.id, i + 1]));

  const dias: { dia: string; itens: { s: StoryArq; idx: number }[] }[] = [];
  (stories ?? []).forEach((s, idx) => {
    const dia = fmtDia(quando(s));
    if (dias.at(-1)?.dia !== dia) dias.push({ dia, itens: [] });
    dias.at(-1)!.itens.push({ s, idx });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--text-dim)]">
          De
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="mt-1 w-40" />
        </label>
        <label className="text-xs text-[var(--text-dim)]">
          Até
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="mt-1 w-40" />
        </label>
        {(de || ate) && <Button variant="ghost" onClick={() => { setDe(""); setAte(""); }}>Limpar datas</Button>}
        <div className="ml-auto flex gap-2">
          {selecionando ? (
            <Button variant="ghost" onClick={() => { setSelecionando(false); setSel(new Set()); }}>Cancelar</Button>
          ) : (
            <Button variant="ghost" onClick={() => { setSelecionando(true); setMsg(""); }} disabled={!stories?.length}>Salvar sequência</Button>
          )}
        </div>
      </div>

      {selecionando && (
        <Card className="p-4">
          <p className="text-sm text-[var(--text-dim)]">
            Toque nos stories da sequência. <span className="nums font-medium text-[var(--text)]">{sel.size} selecionado(s)</span>. Eles ficam na ordem em que foram postados.
          </p>
          {sel.size > 0 && (
            <form onSubmit={salvar} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input list="etiquetas" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Classificação (ex.: Pitch de evento)" aria-label="Classificação" required className="sm:flex-1" />
              <datalist id="etiquetas">{etiquetas.map((t) => <option key={t} value={t} />)}</datalist>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (opcional)" aria-label="Nome da sequência" className="sm:flex-1" />
              <Button type="submit" disabled={!etiqueta.trim()}>Salvar {sel.size} stories</Button>
            </form>
          )}
        </Card>
      )}
      {msg && <p role="status" className="text-sm text-[var(--text-dim)]">{msg}</p>}

      {!stories ? (
        <Empty>Carregando stories…</Empty>
      ) : stories.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-faint)]">
          {de || ate ? "Nenhum story guardado nesse período." : "Nenhum story guardado ainda. Eles entram aqui a cada verificação (1 vez por dia)."}
        </p>
      ) : (
        dias.map((d) => (
          <div key={d.dia}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">{d.dia} · {d.itens.length}</div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {d.itens.map(({ s, idx }) => (
                <Miniatura key={s.id} s={s} urls={urls} ordem={selecionando ? ordem.get(s.id) : undefined}
                  onClick={() => (selecionando ? alternar(s) : setViewer(idx))} />
              ))}
            </div>
          </div>
        ))
      )}
      {viewer !== null && stories && (
        <Viewer slides={slidesDe(stories, urls)} start={viewer} kind="story" accountId={accountId} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

// chave de dia para ordenar (AAAA-MM-DD no fuso do navegador)
function fmtDiaChave(s: StoryArq) {
  const d = new Date(quando(s));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Metrica { perfil_id: string; dia: string; seguidores: number | null }
interface PostM { perfil_id: string; tipo: "estatico" | "carrossel" | "reels"; curtidas: number | null; comentarios: number | null }
type Coluna = "seguidores" | "variacao" | "posts" | "estatico" | "carrossel" | "reels" | "curtidas" | "comentarios" | "engaj";

const COLUNAS: { k: Coluna; t: string }[] = [
  { k: "seguidores", t: "Seguidores" }, { k: "variacao", t: "Variação" }, { k: "posts", t: "Posts" },
  { k: "estatico", t: "Estático" }, { k: "carrossel", t: "Carrossel" }, { k: "reels", t: "Reels" },
  { k: "curtidas", t: "Curtidas" }, { k: "comentarios", t: "Comentários" }, { k: "engaj", t: "Engaj. por seguidores" },
];
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const fmtN = (n: number | null) => (n === null ? "—" : compacto.format(n));
const ROTULO: Record<Categoria, string> = { propria: "Você", concorrente: "Concorrente", inspiracao: "Inspiração" };

function Avatar({ p, fotos, tamanho }: { p: Perfil; fotos: Record<string, string>; tamanho: string }) {
  return (
    <span className={`shrink-0 rounded-full p-[2px] ${ANEL[p.categoria]}`} aria-hidden="true">
      {p.foto && fotos[p.foto] ? (
        <img src={fotos[p.foto]} alt="" className={`${tamanho} rounded-full border-2 border-[var(--surface)] bg-[var(--surface-2)] object-cover`} />
      ) : (
        <span className={`${tamanho} grid place-items-center rounded-full border-2 border-[var(--surface)] bg-[var(--surface-2)] text-sm font-semibold uppercase text-[var(--text)]`}>
          {p.username.replace(/[^a-z0-9]/g, "")[0] ?? "@"}
        </span>
      )}
    </span>
  );
}

function Comparativo({ accountId, perfis, fotos, minhaConta, onIncluir }: {
  accountId: string; perfis: Perfil[]; fotos: Record<string, string>; minhaConta: string | null; onIncluir: () => Promise<void>;
}) {
  const [dias, setDias] = useState(30);
  const [metricas, setMetricas] = useState<Metrica[] | null>(null);
  const [posts, setPosts] = useState<PostM[]>([]);
  const [ordem, setOrdem] = useState<{ k: Coluna; desc: boolean }>({ k: "seguidores", desc: true });
  const [incluindo, setIncluindo] = useState(false);

  useEffect(() => {
    (async () => {
      const desde = new Date(Date.now() - dias * 864e5).toISOString();
      const [{ data: m }, { data: p }] = await Promise.all([
        // shortcut: lê todos os retratos da conta; com anos de histórico, filtrar por período no banco
        supabase.from("perfil_metricas").select("perfil_id,dia,seguidores").eq("ig_account_id", accountId).order("dia").limit(20000),
        supabase.from("perfil_posts").select("perfil_id,tipo,curtidas,comentarios").eq("ig_account_id", accountId).gte("postado_em", desde).limit(20000),
      ]);
      setMetricas((m as Metrica[]) ?? []);
      setPosts((p as PostM[]) ?? []);
    })();
  }, [accountId, dias, perfis]);

  if (!metricas) return <Empty>Carregando…</Empty>;

  const inicio = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const linhas = perfis.map((p) => {
    const ms = metricas.filter((m) => m.perfil_id === p.id && m.seguidores !== null);
    const ultimo = ms.at(-1) ?? null;
    const base = ms.find((m) => m.dia >= inicio) ?? null;
    const ps = posts.filter((x) => x.perfil_id === p.id);
    const visiveis = ps.filter((x) => x.curtidas !== null);
    const somaCurt = visiveis.reduce((a, x) => a + (x.curtidas ?? 0), 0);
    const engajPost = visiveis.reduce((a, x) => a + (x.curtidas ?? 0) + (x.comentarios ?? 0), 0);
    const seguidores = ultimo?.seguidores ?? null;
    return {
      p,
      ocultas: ps.length - visiveis.length,
      v: {
        seguidores,
        // precisa de 2 dias de medição dentro do período
        variacao: ultimo && base && ultimo.dia !== base.dia ? ultimo.seguidores! - base.seguidores! : null,
        posts: ps.length,
        estatico: ps.filter((x) => x.tipo === "estatico").length,
        carrossel: ps.filter((x) => x.tipo === "carrossel").length,
        reels: ps.filter((x) => x.tipo === "reels").length,
        curtidas: visiveis.length ? somaCurt : null,
        comentarios: ps.reduce((a, x) => a + (x.comentarios ?? 0), 0),
        // média de (curtidas + comentários) por post com curtida visível, sobre os seguidores
        engaj: seguidores && visiveis.length ? engajPost / visiveis.length / seguidores : null,
      } as Record<Coluna, number | null>,
    };
  });
  linhas.sort((a, b) => {
    if ((a.p.categoria === "propria") !== (b.p.categoria === "propria")) return a.p.categoria === "propria" ? -1 : 1;
    const x = a.v[ordem.k] ?? -Infinity, y = b.v[ordem.k] ?? -Infinity;
    return ordem.desc ? y - x : x - y;
  });
  const temPropria = perfis.some((p) => p.categoria === "propria");
  const chip = (ativo: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${ativo ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "border border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Período">
          {[7, 30, 90].map((d) => (
            <button key={d} className={chip(dias === d)} aria-pressed={dias === d} onClick={() => setDias(d)}>Últimos {d} dias</button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-faint)]">
          {metricas[0] ? `Medindo desde ${new Date(`${metricas[0].dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}` : "Sem medições ainda"}
        </span>
        {!temPropria && minhaConta && (
          <Button variant="ghost" className="ml-auto" disabled={incluindo} onClick={async () => { setIncluindo(true); await onIncluir(); setIncluindo(false); }}>
            {incluindo ? "Incluindo… (até 1 min)" : `Incluir @${minhaConta} como "Você"`}
          </Button>
        )}
      </div>

      {perfis.length === 0 ? (
        <Card className="p-6 text-sm text-[var(--text-faint)]">Adicione perfis na aba Perfis para comparar.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-faint)]">
                <th scope="col" className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 font-medium">Conta</th>
                {COLUNAS.map((c) => (
                  <th key={c.k} scope="col" className="px-3 py-3 text-right font-medium"
                    aria-sort={ordem.k === c.k ? (ordem.desc ? "descending" : "ascending") : "none"}>
                    <button onClick={() => setOrdem({ k: c.k, desc: ordem.k === c.k ? !ordem.desc : true })}
                      className={`inline-flex items-center gap-1 hover:text-[var(--text)] ${ordem.k === c.k ? "text-[var(--text)]" : ""}`}>
                      {c.t}{ordem.k === c.k && <span aria-hidden="true">{ordem.desc ? "↓" : "↑"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, v, ocultas }) => (
                <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar p={p} fotos={fotos} tamanho="h-8 w-8" />
                      <div>
                        <div className="font-medium text-[var(--text)]">@{p.username}</div>
                        <div className="text-xs text-[var(--text-faint)]">{ROTULO[p.categoria]}</div>
                      </div>
                    </div>
                  </td>
                  <td className="nums px-3 py-3 text-right text-[var(--text)]">{fmtN(v.seguidores)}</td>
                  <td className={`nums px-3 py-3 text-right ${v.variacao === null ? "text-[var(--text-faint)]" : v.variacao >= 0 ? "text-[#22c55e]" : "text-[var(--danger)]"}`}
                    title={v.variacao === null ? "Precisa de pelo menos 2 dias de medição" : undefined}>
                    {v.variacao === null ? "—" : `${v.variacao >= 0 ? "+" : ""}${v.variacao.toLocaleString("pt-BR")}`}
                  </td>
                  <td className="nums px-3 py-3 text-right text-[var(--text)]">{v.posts}</td>
                  <td className="nums px-3 py-3 text-right text-[var(--text-dim)]">{v.estatico}</td>
                  <td className="nums px-3 py-3 text-right text-[var(--text-dim)]">{v.carrossel}</td>
                  <td className="nums px-3 py-3 text-right text-[var(--text-dim)]">{v.reels}</td>
                  <td className="nums px-3 py-3 text-right text-[var(--text)]" title={ocultas ? `${ocultas} post(s) com curtidas ocultas pelo perfil` : undefined}>
                    {fmtN(v.curtidas)}{ocultas > 0 && <span className="ml-1 text-[var(--text-faint)]">*</span>}
                  </td>
                  <td className="nums px-3 py-3 text-right text-[var(--text)]">{fmtN(v.comentarios)}</td>
                  <td className="nums px-3 py-3 text-right text-[var(--text)]">
                    {v.engaj === null ? "—" : `${(v.engaj * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-[var(--text-faint)]">
        Posts, curtidas e comentários dos posts publicados no período. * = o perfil esconde as curtidas de alguns posts; o engajamento usa só os posts com curtidas visíveis.
        Atualizado 1 vez por dia.
      </p>
    </div>
  );
}

function Referencias({ accountId, refs, onMudou }: { accountId: string; refs: Referencia[]; onMudou: () => void }) {
  const confirm = useConfirm();
  const [stories, setStories] = useState<Record<string, StoryArq>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ slides: Slide[]; start: number } | null>(null);

  useEffect(() => {
    (async () => {
      const ids = [...new Set(refs.flatMap((r) => r.stories))];
      if (!ids.length) { setStories({}); return; }
      const { data } = await supabase.from("stories_arquivados").select(CAMPOS).in("id", ids);
      const lista = (data as unknown as StoryArq[]) ?? [];
      setUrls(await assinar(lista));
      setStories(Object.fromEntries(lista.map((s) => [s.id, s])));
    })();
  }, [refs]);

  const etiquetas = [...new Set(refs.map((r) => r.etiqueta))].sort();
  const mostradas = filtro ? refs.filter((r) => r.etiqueta === filtro) : refs;
  const chip = (ativo: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${ativo ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "border border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`;

  async function excluir(r: Referencia) {
    if (!(await confirm({ message: `Excluir a referência "${r.nome || r.etiqueta}"? Os stories continuam guardados no perfil.`, confirmLabel: "Excluir", danger: true }))) return;
    await supabase.from("referencias").delete().eq("id", r.id);
    onMudou();
  }

  if (refs.length === 0)
    return <Card className="p-6 text-sm text-[var(--text-faint)]">Nenhuma referência ainda. Abra um perfil, toque em "Salvar sequência", escolha os stories e dê uma classificação (ex.: Pitch de evento).</Card>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Classificação">
        <button className={chip(filtro === null)} aria-pressed={filtro === null} onClick={() => setFiltro(null)}>Todas · {refs.length}</button>
        {etiquetas.map((t) => (
          <button key={t} className={chip(filtro === t)} aria-pressed={filtro === t} onClick={() => setFiltro(t)}>
            {t} · {refs.filter((r) => r.etiqueta === t).length}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {mostradas.map((r) => {
          const lista = r.stories.map((id) => stories[id]).filter(Boolean);
          const perfis = [...new Set(lista.map((s) => s.perfis_monitorados?.username).filter(Boolean))];
          return (
            <Card key={r.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-hi)]">{r.etiqueta}</span>
                  {r.nome && <span className="ml-2 font-medium text-[var(--text)]">{r.nome}</span>}
                  <div className="nums mt-1 text-xs text-[var(--text-faint)]">
                    {lista.length} stories · {perfis.map((u) => `@${u}`).join(", ")} · {lista[0] ? fmtDia(quando(lista[0])) : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setViewer({ slides: slidesDe(lista, urls), start: 0 })} disabled={!lista.length}>Assistir sequência</Button>
                  <Button variant="danger" onClick={() => excluir(r)}>Excluir</Button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {lista.map((s, i) => (
                  <Miniatura key={s.id} s={s} urls={urls} onClick={() => setViewer({ slides: slidesDe(lista, urls), start: i })} />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {viewer && <Viewer slides={viewer.slides} start={viewer.start} kind="story" accountId={accountId} onClose={() => setViewer(null)} />}
    </div>
  );
}

export default function Monitor() {
  const { accountId, account } = useAccounts();
  const confirm = useConfirm();
  const [aba, setAba] = useState<"perfis" | "comparativo" | "referencias">("perfis");
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [refs, setRefs] = useState<Referencia[]>([]);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("concorrente");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [verificando, setVerificando] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [fotos, setFotos] = useState<Record<string, string>>({});

  async function load() {
    if (!accountId) { setPerfis([]); setRefs([]); setLoading(false); return; }
    const [{ data: p }, { data: s }, { data: r }] = await Promise.all([
      supabase.from("perfis_monitorados").select("id,username,categoria,ativo,ultima_verificacao,run_id,erro,foto").eq("ig_account_id", accountId).order("criado_em"),
      // shortcut: conta os stories no navegador; com dezenas de milhares, trocar por uma view com count
      supabase.from("stories_arquivados").select("perfil_id").eq("ig_account_id", accountId).limit(20000),
      supabase.from("referencias").select("id,etiqueta,nome,stories,criado_em").eq("ig_account_id", accountId).order("criado_em", { ascending: false }),
    ]);
    const c: Record<string, number> = {};
    for (const x of (s as { perfil_id: string }[]) ?? []) c[x.perfil_id] = (c[x.perfil_id] ?? 0) + 1;
    const lista = (p as Perfil[]) ?? [];
    const caminhos = lista.map((x) => x.foto).filter((f): f is string => !!f);
    if (caminhos.length) {
      const { data: links } = await supabase.storage.from("stories").createSignedUrls(caminhos, 60 * 60);
      const f: Record<string, string> = {};
      for (const l of links ?? []) if (l.path && l.signedUrl) f[l.path] = l.signedUrl;
      setFotos(f);
    }
    setPerfis(lista);
    setRefs((r as Referencia[]) ?? []);
    setContagem(c);
    setLoading(false);
  }

  useEffect(() => { setLoading(true); load(); }, [accountId]);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const username = lerUsuario(novo);
    if (!username) { setAviso({ tipo: "erro", texto: "Perfil inválido. Use o @ ou o link do Instagram." }); return; }
    const { error } = await supabase.from("perfis_monitorados").insert({ ig_account_id: accountId, username, categoria });
    if (error) {
      setAviso({ tipo: "erro", texto: error.code === "23505" ? `@${username} já está na lista.` : "Não foi possível adicionar agora." });
      return;
    }
    setNovo("");
    setAviso({ tipo: "ok", texto: `@${username} adicionado. A primeira verificação acontece em até 15 minutos, ou clique em "Verificar agora".` });
    load();
  }

  async function verificar(p: Perfil) {
    setVerificando(p.id);
    setAviso(null);
    const { data } = await supabase.functions.invoke("vigiar", { body: { perfilId: p.id } });
    const r = (data ?? {}) as { ok?: boolean; status?: string; novos?: number; encontrados?: number; mensagem?: string };
    setVerificando(null);
    if (r.status === "SUCCEEDED") {
      setAviso({
        tipo: "ok",
        texto: r.encontrados === 0 ? `@${p.username} não tem story no ar agora.` : `@${p.username}: ${r.novos} story(s) novo(s) guardado(s).`,
      });
    } else if (r.status === "RUNNING") {
      setAviso({ tipo: "ok", texto: `A coleta de @${p.username} ainda está rodando. Os stories aparecem aqui em até 15 minutos.` });
    } else {
      setAviso({ tipo: "erro", texto: `Não deu para verificar @${p.username} agora${r.mensagem || r.status ? ` (${r.mensagem ?? r.status})` : ""}.` });
    }
    load();
  }

  // a própria conta entra como perfil "propria": aparece como "Você" no Comparativo e arquiva os seus stories
  async function incluirMinhaConta() {
    if (!accountId || !account?.username) return;
    const { data } = await supabase.from("perfis_monitorados")
      .insert({ ig_account_id: accountId, username: account.username.toLowerCase(), categoria: "propria" }).select("id").single();
    if (data) await supabase.functions.invoke("vigiar", { body: { perfilId: data.id } });
    await load();
  }

  async function mudarCategoria(p: Perfil, cat: Categoria) {
    await supabase.from("perfis_monitorados").update({ categoria: cat }).eq("id", p.id);
    load();
  }

  async function alternar(p: Perfil) {
    await supabase.from("perfis_monitorados").update({ ativo: !p.ativo }).eq("id", p.id);
    load();
  }

  async function remover(p: Perfil) {
    if (!(await confirm({ message: `Remover @${p.username} da lista?`, confirmLabel: "Remover", danger: true }))) return;
    await supabase.from("perfis_monitorados").delete().eq("id", p.id);
    load();
  }

  const tab = (ativo: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${ativo ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Monitor</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Stories de concorrentes e inspirações, guardados a partir de quando você começa a acompanhar</p>
      </div>

      <div className="mb-6 flex gap-1" role="tablist">
        <button role="tab" aria-selected={aba === "perfis"} className={tab(aba === "perfis")} onClick={() => setAba("perfis")}>Perfis</button>
        <button role="tab" aria-selected={aba === "comparativo"} className={tab(aba === "comparativo")} onClick={() => setAba("comparativo")}>Comparativo</button>
        <button role="tab" aria-selected={aba === "referencias"} className={tab(aba === "referencias")} onClick={() => setAba("referencias")}>
          Referências <span className="nums text-[var(--text-faint)]">· {refs.length}</span>
        </button>
      </div>

      {loading ? (
        <Empty>Carregando…</Empty>
      ) : aba === "comparativo" ? (
        accountId && <Comparativo accountId={accountId} perfis={perfis} fotos={fotos} minhaConta={account?.username ?? null} onIncluir={incluirMinhaConta} />
      ) : aba === "referencias" ? (
        accountId && <Referencias accountId={accountId} refs={refs} onMudou={load} />
      ) : (
        <>
          <Card className="mb-6 p-4">
            <form onSubmit={adicionar} className="flex flex-col gap-2 sm:flex-row">
              <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="@perfil ou link do Instagram" aria-label="Perfil do Instagram" className="flex-1" />
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)} aria-label="Lista" className="sm:w-44">
                <option value="concorrente">Concorrente</option>
                <option value="inspiracao">Inspiração</option>
              </Select>
              <Button type="submit" disabled={!novo.trim() || !accountId}>Adicionar</Button>
            </form>
            {aviso && (
              <p role="status" className={`mt-3 text-sm ${aviso.tipo === "ok" ? "text-[var(--text-dim)]" : "text-[var(--danger)]"}`}>{aviso.texto}</p>
            )}
          </Card>

          {GRUPOS.map((g) => {
            const lista = perfis.filter((p) => p.categoria === g.cat);
            if (g.cat === "propria" && lista.length === 0) return null;
            return (
              <section key={g.cat} className="mb-8">
                <div className="mb-3 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-[var(--text)]">{g.titulo}</h2>
                  <span className="nums rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--text-dim)]">{lista.length}</span>
                </div>
                {lista.length === 0 ? (
                  <Card className="p-5 text-sm text-[var(--text-faint)]">Nenhum perfil em {g.titulo.toLowerCase()} ainda.</Card>
                ) : (
                  <div className="space-y-3">
                    {lista.map((p) => (
                      <Card key={p.id} className={`p-4 transition-colors ${aberto === p.id ? "border-[var(--border-strong)]" : "hover:border-[var(--border-strong)]"} ${p.ativo ? "" : "opacity-60"}`}>
                        <div className="flex items-center gap-3 sm:gap-4">
                          <button onClick={() => setAberto(aberto === p.id ? null : p.id)} aria-expanded={aberto === p.id} className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4">
                            <Avatar p={p} fotos={fotos} tamanho="h-11 w-11" />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-[var(--text)]">@{p.username}</span>
                              <span className="nums mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-faint)]">
                                <span><span className="font-medium text-[var(--text-dim)]">{contagem[p.id] ?? 0}</span> stories</span>
                                <span aria-hidden="true">·</span>
                                <span>verificado {fmtHora(p.ultima_verificacao)}</span>
                                {p.run_id && <span className="text-[var(--accent-hi)]">· coletando…</span>}
                                {!p.ativo && <span>· pausado</span>}
                              </span>
                              {p.erro && <span className="mt-1 block text-xs text-[var(--danger)]">{p.erro}</span>}
                            </span>
                          </button>
                          <button onClick={() => verificar(p)} disabled={verificando !== null || !p.ativo}
                            aria-label={`Verificar @${p.username} agora`} title={verificando === p.id ? "Verificando… (até 1 min)" : "Verificar agora"}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40 disabled:hover:bg-transparent">
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={verificando === p.id ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
                          </button>
                          <div className="relative shrink-0">
                            <button onClick={() => setMenu(menu === p.id ? null : p.id)} aria-label={`Opções de @${p.username}`} aria-haspopup="menu" aria-expanded={menu === p.id}
                              className="grid h-9 w-9 place-items-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
                            </button>
                            {menu === p.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} aria-hidden="true" />
                                <div role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(null)}
                                  className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
                                  {[
                                    ...(p.categoria === "propria" ? [] : [{ txt: p.categoria === "concorrente" ? "Mover para Inspirações" : "Mover para Concorrentes", fn: () => mudarCategoria(p, p.categoria === "concorrente" ? "inspiracao" : "concorrente") }]),
                                    { txt: "Abrir no Instagram", fn: () => window.open(`https://www.instagram.com/${p.username}/`, "_blank", "noopener") },
                                    { txt: p.ativo ? "Pausar acompanhamento" : "Retomar acompanhamento", fn: () => alternar(p) },
                                    ...(!contagem[p.id] ? [{ txt: "Remover", fn: () => remover(p), perigo: true }] : []),
                                  ].map((o) => (
                                    <button key={o.txt} role="menuitem" onClick={() => { setMenu(null); o.fn(); }}
                                      className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)] ${"perigo" in o ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>
                                      {o.txt}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
                            className={`hidden shrink-0 text-[var(--text-faint)] transition-transform sm:block ${aberto === p.id ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
                        </div>
                        {aberto === p.id && accountId && (
                          <div className="mt-4 border-t border-[var(--border)] pt-4">
                            <Stories perfil={p} accountId={accountId} etiquetas={[...new Set(refs.map((r) => r.etiqueta))].sort()} onSalvo={load} />
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
