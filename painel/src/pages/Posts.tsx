// Posts: os carrosséis produzidos para a conta, com a fila de aprovação
//   aguardando -> (ajustes) -> aprovado -> agendado -> postado
// Pensado primeiro para o celular: aprovar e publicar (agora ou agendado) pela função publicar,
// ou copiar a legenda e salvar os slides para postar à mão.
import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAccounts } from "../lib/account";
import { useConfirm } from "../lib/confirm";
import { Badge, Button, Card, Empty, Input, Textarea } from "../components/ui";
import type { Post, PostStatus } from "../lib/types";
import Resultados from "./Resultados";

const ETAPAS: { id: PostStatus; rotulo: string; cor: string }[] = [
  { id: "aguardando", rotulo: "Aguardando", cor: "#d9a441" },
  { id: "ajustes", rotulo: "Ajustes", cor: "#e15c5c" },
  { id: "aprovado", rotulo: "Aprovado", cor: "#3fb27f" },
  { id: "agendado", rotulo: "Agendado", cor: "#5b8def" },
  { id: "postado", rotulo: "Postado", cor: "#1f9d55" },
];
const etapa = (s: PostStatus) => ETAPAS.find((e) => e.id === s) ?? ETAPAS[0];
// Postado: verde cheio com check (não confunde com o verde claro do Aprovado); Agendado: com relógio
const Selo = ({ status }: { status: PostStatus }) => {
  const e = etapa(status);
  if (status === "postado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: e.cor }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        {e.rotulo}
      </span>
    );
  }
  return (
    <Badge color={e.cor}>
      {status === "agendado" && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      )}
      {e.rotulo}
    </Badge>
  );
};

const dia = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
const diaHora = (s?: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
// <input type="datetime-local"> trabalha na hora local, sem fuso (cortar o ISO daria a hora de Londres)
const paraCampo = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
};
// a função publicar trava o post enquanto publica; trava velha é de uma tentativa que caiu
const saindoAgora = (p: Post) => !!p.publicando_em && Date.now() - new Date(p.publicando_em).getTime() < 10 * 60e3;

// O bucket é privado: as imagens abrem por links assinados que valem 1 hora.
async function assinar(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("posts").createSignedUrls(paths, 60 * 60);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

// Salva os slides originais (PNG): no celular abre a folha de compartilhar (Salvar imagens / Instagram);
// no computador, baixa um arquivo por slide.
async function salvarSlides(post: Post) {
  const urls = await assinar(post.slides.map((s) => s.png));
  const arquivos = await Promise.all(
    post.slides.map(async (s, i) => {
      const r = await fetch(urls[s.png]);
      if (!r.ok) throw new Error("falha");
      return new File([await r.blob()], `${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" });
    }),
  );
  if (navigator.canShare?.({ files: arquivos })) {
    try {
      await navigator.share({ files: arquivos, title: post.titulo });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // a pessoa fechou a folha de compartilhar
    }
  }
  for (const f of arquivos) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    await new Promise((r) => setTimeout(r, 250)); // o navegador barra vários downloads de uma vez
  }
}

const dataLonga = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

// O post como ele aparece no feed do Instagram (modo escuro): cabeçalho com o @, carrossel de arrastar com o
// contador "1/10" que some sozinho, ícones de curtir/comentar/enviar/salvar, pontinhos e a legenda com "mais".
function PostInstagram({ post, conta, legenda }: { post: Post; conta: string; legenda: string | null }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [contador, setContador] = useState(true);
  const [aberta, setAberta] = useState(false);
  const trilho = useRef<HTMLDivElement>(null);
  const n = post.slides.length;

  useEffect(() => { assinar(post.slides.map((s) => s.jpg)).then(setUrls); }, [post.id]);
  // como no Instagram: o "1/10" aparece ao trocar de slide e some depois de 2,5 s
  useEffect(() => {
    setContador(true);
    const t = setTimeout(() => setContador(false), 2500);
    return () => clearTimeout(t);
  }, [i]);

  const ir = (d: number) => {
    const el = trilho.current;
    if (el) el.scrollTo({ left: el.clientWidth * Math.min(n - 1, Math.max(0, i + d)), behavior: "smooth" });
  };
  const seta = "absolute top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black shadow transition-opacity hover:bg-white disabled:opacity-0 md:grid";
  const icone = "h-6 w-6";
  const quando = post.status === "postado" && post.postado_em
    ? dataLonga(post.postado_em)
    : post.agendado_para ? `${dataLonga(post.agendado_para)} · ${post.status === "agendado" ? "agendado" : "pré-agendado"}` : "Prévia";
  // o feed mostra só o começo: até o 1º parágrafo, cerca de duas linhas de celular, e "… mais"
  const texto = (legenda ?? "").trim();
  const inicio = texto.split("\n")[0].trim();
  const resumo = inicio.length + conta.length > 80 ? inicio.slice(0, 80 - conta.length).replace(/\s+\S*$/, "") : inicio;
  const cortada = resumo.length < texto.length;

  return (
    <article className="-mx-4 bg-black text-white sm:mx-auto sm:max-w-[470px] sm:overflow-hidden sm:rounded-lg sm:border sm:border-[#262626]" aria-label="Prévia do post no Instagram">
      {/* cabeçalho */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full p-[2px]" style={{ background: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)" }} aria-hidden="true">
          <span className="grid h-full w-full place-items-center rounded-full border-2 border-black bg-[#262626] text-[11px] font-semibold">{conta.charAt(0).toUpperCase()}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{conta}</span>
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
      </div>

      {/* carrossel */}
      <div className="relative">
        <div
          ref={trilho}
          onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          className="sem-barra flex snap-x snap-mandatory overflow-x-auto"
          aria-label={`Slides do carrossel, ${n} no total`}
        >
          {post.slides.map((s, k) => (
            <div key={s.jpg} className="aspect-[4/5] w-full shrink-0 snap-center bg-[#121212]">
              {urls[s.jpg] ? (
                <img src={urls[s.jpg]} alt={`Slide ${k + 1}`} loading={k < 2 ? "eager" : "lazy"} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full animate-pulse bg-[#1c1c1c]" />
              )}
            </div>
          ))}
        </div>
        {n > 1 && (
          <span className={`nums pointer-events-none absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium transition-opacity duration-300 ${contador ? "opacity-100" : "opacity-0"}`}>
            {i + 1}/{n}
          </span>
        )}
        <button onClick={() => ir(-1)} disabled={i === 0} aria-label="Slide anterior" className={`${seta} left-2`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <button onClick={() => ir(1)} disabled={i === n - 1} aria-label="Próximo slide" className={`${seta} right-2`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>

      {/* ícones e pontinhos (só ilustração: nada aqui curte ou envia) */}
      <div className="relative flex items-center px-3 pt-2.5 pb-1" aria-hidden="true">
        <div className="flex items-center gap-4">
          <svg className={icone} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M16.8 3.6c-2 0-3.7 1.1-4.8 2.8-1.1-1.7-2.8-2.8-4.8-2.8A4.9 4.9 0 0 0 2.4 8.7c0 5.5 9.6 11.7 9.6 11.7s9.6-6.2 9.6-11.7a4.9 4.9 0 0 0-4.8-5.1z" /></svg>
          <svg className={icone} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M20.7 16.1A9.5 9.5 0 1 0 12 21.5c1.6 0 3.1-.4 4.4-1.1l4.6 1.1-1.2-4.4z" /></svg>
          <svg className={icone} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M22 3 9.2 10.1" /><path d="M22 3 15.4 21l-4.1-8.4L3 8.8z" /></svg>
        </div>
        {n > 1 && (
          <div className="absolute left-1/2 flex -translate-x-1/2 gap-1">
            {post.slides.map((s, k) => (
              <span key={s.jpg} className={`h-1.5 w-1.5 rounded-full ${k === i ? "bg-[#0095f6]" : "bg-[#737373]"}`} />
            ))}
          </div>
        )}
        <svg className={`${icone} ml-auto`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M19 21 12 15.5 5 21V3.5h14z" /></svg>
      </div>

      {/* legenda: o começo e "… mais", como no feed; tocar abre inteira */}
      <div className="px-3 pt-1 pb-3 text-[14px] leading-[18px]">
        {texto && (aberta || !cortada ? (
          <p className="whitespace-pre-line break-words"><b className="font-semibold">{conta}</b> {texto}</p>
        ) : (
          <button onClick={() => setAberta(true)} className="block w-full break-words text-left">
            <b className="font-semibold">{conta}</b> {resumo.replace(/[.,;:]$/, "")}… <span className="text-[#a8a8a8]">mais</span>
          </button>
        ))}
        <p className="mt-1.5 text-[11px] uppercase tracking-wide text-[#a8a8a8]">{quando}</p>
      </div>
    </article>
  );
}

type Modo = null | "ajuste" | "agendar" | "postar";

function Detalhe({ post, onClose, onChange }: { post: Post; onClose: () => void; onChange: (p: Post) => void }) {
  const { account } = useAccounts();
  const confirm = useConfirm();
  const [modo, setModo] = useState<Modo>(null);
  const [nota, setNota] = useState("");
  const [quando, setQuando] = useState("");
  const [link, setLink] = useState(post.link ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [versao, setVersao] = useState<"completa" | "curta">("completa");
  const [copiado, setCopiado] = useState(false);
  const [baixando, setBaixando] = useState<"" | "busy" | "err">("");
  const [publicando, setPublicando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, []);

  async function mudar(patch: Partial<Post>) {
    setSalvando(true);
    setErro("");
    // qualquer mudança feita à mão resolve o aviso da última publicação que não saiu
    const { data, error } = await supabase.from("posts").update({ ...patch, erro_publicacao: null }).eq("id", post.id).select().single();
    setSalvando(false);
    if (error || !data) { setErro("Não deu para salvar. Confira a conexão e tente de novo."); return; }
    onChange(data as Post);
    setModo(null);
  }

  // Publica pela função publicar e relê o post: status, link e motivo de erro vêm do banco
  async function publicarAgora() {
    const ok = await confirm({
      message: `Publicar agora no Instagram de @${account?.username ?? "sua conta"}? O carrossel vai para o feed na hora, com a legenda completa. Depois, só dá para apagar pelo Instagram.`,
      confirmLabel: "Publicar agora",
    });
    if (!ok) return;
    setPublicando(true);
    setErro("");
    const { data: r, error } = await supabase.functions.invoke("publicar", { body: { postId: post.id } });
    const { data } = await supabase.from("posts").select("*").eq("id", post.id).single();
    setPublicando(false);
    if (data) onChange(data as Post);
    if (error) setErro("Não deu para falar com o servidor. Confira a conexão e tente de novo.");
    else if (r?.ok === false && !(data as Post | null)?.erro_publicacao) setErro(r.mensagem ?? "Não deu para publicar.");
  }

  // Antes de agendar, confere se a conta está conectada e com a permissão de publicar:
  // sem isso, o problema só apareceria na hora marcada, com o post sem sair
  async function agendar(dataIso = new Date(quando).toISOString()) {
    setSalvando(true);
    setErro("");
    const { data: r, error } = await supabase.functions.invoke("publicar", { body: { postId: post.id, verificar: true } });
    if (error || !r?.ok) {
      setSalvando(false);
      setErro(r?.mensagem ?? "Não deu para conferir a conexão com o Instagram. Tente de novo.");
      return;
    }
    await mudar({ status: "agendado", agendado_para: dataIso, notas: null });
  }

  // Pré-agendado: a data vem proposta e o post só entra na agenda (e sai sozinho) quando você confirma.
  // Data que já passou não agenda: publicaria na hora.
  function confirmarAgenda() {
    if (!post.agendado_para || new Date(post.agendado_para).getTime() <= Date.now() + 60e3) {
      setQuando("");
      setModo("agendar");
      setErro("A data proposta já passou. Escolha outra.");
      return;
    }
    agendar(post.agendado_para);
  }

  async function copiar() {
    const texto = versao === "curta" ? post.legenda_curta : post.legenda;
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function salvar() {
    setBaixando("busy");
    try { await salvarSlides(post); setBaixando(""); } catch { setBaixando("err"); }
  }

  const legenda = versao === "curta" ? post.legenda_curta : post.legenda;
  const s = post.status;
  const pre = !!post.agendado_para && s !== "agendado" && s !== "postado";
  const saindo = publicando || saindoAgora(post);
  const futuro = !!quando && new Date(quando).getTime() > Date.now() + 60e3;
  const aba = (ativo: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${ativo ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)]" role="dialog" aria-modal="true" aria-label={post.titulo}>
      <header
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)]/90 px-2 py-2 backdrop-blur"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button onClick={onClose} aria-label="Voltar para os posts" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">{post.titulo}</div>
        <span className="shrink-0 pr-2"><Selo status={s} /></span>
      </header>

      <div className="mx-auto max-w-xl px-4 pt-4" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        <p className="mb-2 text-xs text-[var(--text-faint)]">Como vai aparecer no Instagram</p>
        <PostInstagram post={post} conta={account?.username ?? "sua.conta"} legenda={legenda} />

        {/* Etapa e ação principal */}
        <Card className="mt-4 p-4">
          <div className="text-sm text-[var(--text-dim)]">
            {pre && <p className="mb-1">Pré-agendado para <b className="text-[var(--text)]">{diaHora(post.agendado_para)}</b>. Só vai para a agenda quando você confirmar.</p>}
            {s === "aguardando" && "Esperando a sua aprovação."}
            {s === "ajustes" && <>Pediram ajustes{post.notas ? ":" : "."}</>}
            {s === "aprovado" && "Aprovado. Publique agora, agende ou marque como postado."}
            {s === "agendado" && <>Agendado para <b className="text-[var(--text)]">{diaHora(post.agendado_para)}</b>. O app publica sozinho nessa hora.</>}
            {s === "postado" && <>Postado{post.postado_em ? ` em ${dia(post.postado_em)}` : ""}.</>}
          </div>
          {s === "ajustes" && post.notas && <p className="mt-2 whitespace-pre-line rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--text)]">{post.notas}</p>}
          {post.erro_publicacao && !saindo && (
            <p role="alert" className={`mt-2 rounded-lg p-3 text-sm ${s === "postado" ? "bg-[var(--surface-2)] text-[var(--text-dim)]" : "border border-[var(--danger)] text-[var(--danger)]"}`}>
              {s === "postado" ? post.erro_publicacao : `Não publicou. ${post.erro_publicacao}`}
            </p>
          )}

          {saindo && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--text)]" role="status">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--text-faint)] border-t-transparent" aria-hidden="true" />
              Publicando no Instagram… leva até um minuto.
            </p>
          )}

          {modo === null && !saindo && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {pre && (
                <Button className="col-span-2 min-h-11" disabled={salvando} onClick={confirmarAgenda}>
                  {salvando ? "Conferindo…" : `Aprovar e agendar para ${diaHora(post.agendado_para)}`}
                </Button>
              )}
              {(s === "aguardando" || s === "ajustes") && (
                <>
                  <Button className="min-h-11" variant={pre ? "ghost" : undefined} disabled={salvando} onClick={() => mudar({ status: "aprovado", notas: null })}>{pre ? "Só aprovar" : "Aprovar"}</Button>
                  <Button className="min-h-11" variant="ghost" onClick={() => { setNota(post.notas ?? ""); setModo("ajuste"); }}>Pedir ajuste</Button>
                </>
              )}
              {s === "aprovado" && (
                <>
                  <Button className="col-span-2 min-h-11" onClick={publicarAgora}>Publicar agora</Button>
                  <Button className="min-h-11" variant="ghost" onClick={() => { setQuando(""); setModo("agendar"); }}>Agendar</Button>
                  <Button className="min-h-11" variant="ghost" onClick={() => setModo("postar")}>Já postei</Button>
                </>
              )}
              {s === "agendado" && (
                <>
                  <Button className="col-span-2 min-h-11" onClick={publicarAgora}>Publicar agora</Button>
                  <Button className="min-h-11" variant="ghost" onClick={() => { setQuando(paraCampo(post.agendado_para)); setModo("agendar"); }}>Mudar data</Button>
                  <Button className="min-h-11" variant="ghost" disabled={salvando} onClick={() => mudar({ status: "aprovado", agendado_para: null })}>Tirar da agenda</Button>
                </>
              )}
              {s === "postado" && (
                post.link ? (
                  <a href={post.link} target="_blank" rel="noreferrer" className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--surface-2)] px-3.5 text-sm font-medium text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-hover)]">
                    Abrir no Instagram
                  </a>
                ) : (
                  <Button className="col-span-2 min-h-11" variant="ghost" onClick={() => setModo("postar")}>Adicionar o link do post</Button>
                )
              )}
            </div>
          )}

          {modo === "ajuste" && (
            <div className="mt-3 space-y-2">
              <Textarea rows={3} autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="O que precisa mudar? Ex.: trocar a foto do slide 3" aria-label="O que precisa mudar" />
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-11" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
                <Button className="min-h-11" disabled={salvando || !nota.trim()} onClick={() => mudar({ status: "ajustes", notas: nota.trim() })}>Enviar pedido</Button>
              </div>
            </div>
          )}

          {modo === "agendar" && (
            <div className="mt-3 space-y-2">
              <Input type="datetime-local" value={quando} min={paraCampo(new Date().toISOString())} onChange={(e) => setQuando(e.target.value)} aria-label="Data e hora da postagem" className="min-h-11" />
              <p className="text-xs text-[var(--text-faint)]">
                {quando && !futuro ? "Escolha um horário daqui para a frente." : "Na hora marcada, o app publica sozinho no Instagram, com a legenda completa."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-11" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
                <Button className="min-h-11" disabled={salvando || !futuro} onClick={() => agendar()}>{salvando ? "Conferindo…" : "Agendar"}</Button>
              </div>
            </div>
          )}

          {modo === "postar" && (
            <div className="mt-3 space-y-2">
              <Input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link do post no Instagram (opcional)" aria-label="Link do post no Instagram" className="min-h-11" />
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-11" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
                <Button
                  className="min-h-11"
                  disabled={salvando}
                  onClick={() => mudar({ status: "postado", postado_em: post.postado_em ?? new Date().toISOString(), link: link.trim() || null })}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          )}

          {erro && <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{erro}</p>}

          {modo === null && !saindo && (
            <label className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-faint)]">
              Mover para outra etapa
              <select
                value={s}
                disabled={salvando}
                // Agendado publica sozinho: só entra pela escolha de data (uma data velha publicaria na hora)
                onChange={(e) => {
                  if (e.target.value === "agendado") { setQuando(""); setModo("agendar"); return; }
                  mudar({ status: e.target.value as PostStatus, ...(s === "agendado" ? { agendado_para: null } : {}) });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-dim)] outline-none focus:border-[var(--accent-line)]"
              >
                {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
              </select>
            </label>
          )}
        </Card>

        {/* Salvar os slides para postar */}
        <Button variant="ghost" className="mt-3 min-h-12 w-full" onClick={salvar} disabled={baixando === "busy"}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
          {baixando === "busy" ? "Preparando os slides…" : baixando === "err" ? "Não deu certo, tentar de novo" : `Salvar os ${post.slides.length} slides em alta`}
        </Button>

        {/* Legenda */}
        <Card className="mt-4 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-[var(--text)]">Legenda</div>
            {post.legenda_curta && (
              <div className="flex gap-1 rounded-full border border-[var(--border)] p-0.5" role="group" aria-label="Versão da legenda">
                <button className={aba(versao === "completa")} aria-pressed={versao === "completa"} onClick={() => setVersao("completa")}>Completa</button>
                <button className={aba(versao === "curta")} aria-pressed={versao === "curta"} onClick={() => setVersao("curta")}>Curta</button>
              </div>
            )}
          </div>
          {legenda ? (
            <>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">{legenda}</p>
              <Button className="mt-3 min-h-11 w-full" onClick={copiar}>{copiado ? "Legenda copiada" : "Copiar legenda"}</Button>
            </>
          ) : (
            <p className="text-sm text-[var(--text-faint)]">Sem legenda.</p>
          )}
        </Card>

        {post.fontes && (
          <details className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--text-dim)]">Fontes e créditos</summary>
            <p className="mt-3 whitespace-pre-line break-words text-xs leading-relaxed text-[var(--text-dim)]">{post.fontes}</p>
          </details>
        )}
      </div>
    </div>
  );
}

export default function Posts() {
  const { accountId } = useAccounts();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [erro, setErro] = useState(false);
  const [capas, setCapas] = useState<Record<string, string>>({});
  // "pre": pré-agendado (tem data proposta, mas ainda não foi confirmado) — não se mistura com o Agendado de fato
  const [filtro, setFiltro] = useState<PostStatus | "todos" | "pre">("todos");
  // o post aberto fica na URL: o "voltar" do celular fecha o detalhe em vez de sair da aba
  const [params, setParams] = useSearchParams();
  const abertoId = params.get("post");
  const aba = params.get("aba") === "resultados" ? "resultados" : "fila";

  useEffect(() => {
    if (!accountId) { setPosts([]); return; }
    setPosts(null);
    setErro(false);
    supabase
      .from("posts")
      .select("*")
      .eq("ig_account_id", accountId)
      .order("criado_em", { ascending: false })
      .then(async ({ data, error }) => {
        if (error) { setErro(true); setPosts([]); return; }
        const lista = (data as Post[]) ?? [];
        setPosts(lista);
        setCapas(await assinar(lista.filter((p) => p.slides[0]).map((p) => p.slides[0].jpg)));
      });
  }, [accountId]);

  const lista = posts ?? [];
  const conta = (s: PostStatus) => lista.filter((p) => p.status === s).length;
  // os que têm data (pré-agendados e agendados) vêm primeiro, na ordem em que saem; o resto segue do mais novo
  const naFila = (p: Post) => !!p.agendado_para && p.status !== "postado";
  const preAgendado = (p: Post) => naFila(p) && p.status !== "agendado";
  const mostrados = (filtro === "todos" ? lista : filtro === "pre" ? lista.filter(preAgendado) : lista.filter((p) => p.status === filtro))
    .slice()
    .sort((a, b) => Number(naFila(b)) - Number(naFila(a)) || (naFila(a) && naFila(b) ? Date.parse(a.agendado_para!) - Date.parse(b.agendado_para!) : 0));
  const aberto = lista.find((p) => p.id === abertoId) ?? null;
  const abrir = (id: string) => setParams({ post: id });
  const fechar = () => (window.history.state?.idx > 0 ? window.history.back() : setParams({}, { replace: true }));
  const chip = (ativo: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
      ativo ? "border-[var(--accent-line)] bg-[var(--chip-bg)] text-[var(--chip-text)]" : "border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"
    }`;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Posts</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Carrosséis para aprovar, agendar e postar</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-[var(--radius)] border border-[var(--border)] p-1" role="tablist" aria-label="Ver">
        {(["fila", "resultados"] as const).map((a) => (
          <button
            key={a}
            role="tab"
            aria-selected={aba === a}
            onClick={() => setParams(a === "resultados" ? { aba: a } : {}, { replace: true })}
            className={`min-h-10 rounded-[calc(var(--radius)-4px)] text-sm font-medium transition-colors ${aba === a ? "bg-[var(--chip-bg)] text-[var(--chip-text)]" : "text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"}`}
          >
            {a === "fila" ? "Fila" : "Resultados"}
          </button>
        ))}
      </div>

      {aba === "resultados" ? (
        <Resultados accountId={accountId} posts={lista} />
      ) : posts === null ? (
        <Empty>Carregando os posts…</Empty>
      ) : erro ? (
        <Card className="p-6 text-sm text-[var(--text-dim)]">Não foi possível carregar os posts agora. Tente de novo.</Card>
      ) : lista.length === 0 ? (
        <Empty>Nenhum post produzido para esta conta ainda.</Empty>
      ) : (
        <>
          {filtro === "todos" && conta("aguardando") > 0 && (
            <button
              onClick={() => setFiltro("aguardando")}
              className="mb-4 flex w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-3 text-left"
            >
              <span className="text-sm text-[var(--text)]">
                <b className="nums">{conta("aguardando")}</b> {conta("aguardando") === 1 ? "post esperando" : "posts esperando"} a sua aprovação
              </span>
              <span className="shrink-0 text-xs font-medium text-[var(--accent-hi)]">Ver →</span>
            </button>
          )}

          <div className="sem-barra -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Filtrar por etapa">
            <button className={chip(filtro === "todos")} aria-pressed={filtro === "todos"} onClick={() => setFiltro("todos")}>
              Todos <span className="nums opacity-60">{lista.length}</span>
            </button>
            {ETAPAS.map((e) => (
              <Fragment key={e.id}>
                {e.id === "agendado" && (
                  <button className={chip(filtro === "pre")} aria-pressed={filtro === "pre"} onClick={() => setFiltro("pre")}>
                    Pré-agendado <span className="nums opacity-60">{lista.filter(preAgendado).length}</span>
                  </button>
                )}
                <button className={chip(filtro === e.id)} aria-pressed={filtro === e.id} onClick={() => setFiltro(e.id)}>
                  {e.rotulo} <span className="nums opacity-60">{conta(e.id)}</span>
                </button>
              </Fragment>
            ))}
          </div>

          {mostrados.length === 0 ? (
            <Empty>Nenhum post nesta etapa.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {mostrados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => abrir(p.id)}
                  aria-label={`Abrir post: ${p.titulo}`}
                  className="group overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[var(--border-strong)]"
                >
                  <div className="relative aspect-[4/5] bg-[var(--surface-2)]">
                    {capas[p.slides[0]?.jpg] ? (
                      <img src={capas[p.slides[0].jpg]} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-[var(--surface-hover)]" />
                    )}
                    <span className="nums absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{p.slides.length} slides</span>
                  </div>
                  <div className="p-3">
                    <Selo status={p.status} />
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-[var(--text)]">{p.titulo}</p>
                    <p className={`nums mt-1.5 text-[11px] ${p.erro_publicacao && p.status !== "postado" ? "text-[var(--danger)]" : "text-[var(--text-faint)]"}`}>
                      {saindoAgora(p) ? "Publicando…" : p.erro_publicacao && p.status !== "postado" ? "Não publicou: abra para ver"
                        : p.status === "agendado" && p.agendado_para ? `Para ${diaHora(p.agendado_para)}`
                        : p.agendado_para && p.status !== "postado" ? `Pré-agendado: ${diaHora(p.agendado_para)}`
                        : p.status === "postado" && p.postado_em ? `Postado ${dia(p.postado_em)}` : `Criado ${dia(p.criado_em)}`}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {aberto && (
        <Detalhe
          key={aberto.id}
          post={aberto}
          onClose={fechar}
          onChange={(novo) => setPosts((prev) => (prev ?? []).map((p) => (p.id === novo.id ? novo : p)))}
        />
      )}
    </div>
  );
}
