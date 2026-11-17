// Resultados: os últimos posts do Instagram com os números de cada um, para ver rápido o que funciona.
// Vem da função conteudo (login do painel + RLS); casa com os posts do app pelo ig_media_id,
// que diz o título e se era carrossel ou frase. Reels e posts feitos fora do app também aparecem.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button, Card, Empty } from "../components/ui";
import type { Post } from "../lib/types";

type Midia = {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  permalink: string;
  timestamp: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
  insights?: Record<string, number>;
};

const METRICAS = [
  ["reach", "Alcance"],
  ["shares", "Envios"],
  ["saved", "Salvos"],
  ["follows", "Seguidores"],
  ["comments", "Comentários"],
  ["likes", "Curtidas"],
  ["profile_visits", "Visitas ao perfil"],
] as const;
type Metrica = (typeof METRICAS)[number][0];

const HORA = 3_600_000;
const horaSP = (iso: string) =>
  Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date(iso)));
const faixa = (h: number) => (h >= 6 && h < 11 ? "Manhã" : h >= 11 && h < 14 ? "Meio-dia" : h >= 14 && h < 18 ? "Tarde" : h >= 18 && h < 23 ? "Noite" : "Madrugada");
const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const idade = (iso: string) => {
  const h = Math.floor((Date.now() - Date.parse(iso)) / HORA);
  return h < 24 ? `há ${Math.max(h, 1)} h` : `há ${Math.floor(h / 24)} ${Math.floor(h / 24) === 1 ? "dia" : "dias"}`;
};
const num = (v: number | undefined) => (v === undefined ? "–" : v.toLocaleString("pt-BR"));

function valor(m: Midia, k: Metrica): number | undefined {
  return m.insights?.[k] ?? (k === "likes" ? m.like_count : k === "comments" ? m.comments_count : undefined);
}

function formato(m: Midia, p?: Post) {
  if (p) return p.titulo.startsWith("Frase") ? "Frase" : "Carrossel";
  if (m.media_product_type === "REELS") return "Reels";
  return m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Foto";
}

// média da métrica por grupo, só com posts de 24 h ou mais (post novo ainda está subindo)
function medias(midias: Midia[], grupo: (m: Midia) => string, k: Metrica) {
  const somas = new Map<string, { total: number; n: number }>();
  for (const m of midias) {
    const v = valor(m, k);
    if (v === undefined || Date.now() - Date.parse(m.timestamp) < 24 * HORA) continue;
    const g = somas.get(grupo(m)) ?? { total: 0, n: 0 };
    somas.set(grupo(m), { total: g.total + v, n: g.n + 1 });
  }
  return [...somas.entries()].map(([nome, s]) => ({ nome, media: Math.round(s.total / s.n), n: s.n })).sort((a, b) => b.media - a.media);
}

export default function Resultados({ accountId, posts }: { accountId: string | null; posts: Post[] }) {
  const [dados, setDados] = useState<{ midias: Midia[]; liberadas: boolean } | null>(null);
  const [erro, setErro] = useState(false);
  const [metrica, setMetrica] = useState<Metrica>("reach");
  const [vez, setVez] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    setDados(null);
    setErro(false);
    supabase.functions.invoke("conteudo", { body: { accountId, resultados: true } }).then(({ data, error }) => {
      if (error || !data || data.erro) { setErro(true); return; }
      setDados({ midias: (data.posts as Midia[]) ?? [], liberadas: data.metricas_liberadas !== false });
    });
  }, [accountId, vez]);

  if (!accountId) return <Empty>Escolha uma conta para ver os resultados.</Empty>;
  if (erro) {
    return (
      <Card className="p-5 text-sm text-[var(--text-dim)]">
        Não deu para buscar os números no Instagram agora. Se continuar, reconecte a conta em Integração.
        <Button className="mt-3 min-h-11 w-full" variant="ghost" onClick={() => setVez((v) => v + 1)}>Tentar de novo</Button>
      </Card>
    );
  }
  if (!dados) return <Empty>Buscando os números no Instagram… leva alguns segundos.</Empty>;
  if (dados.midias.length === 0) return <Empty>Nenhum post publicado nesta conta ainda.</Empty>;

  const doApp = new Map(posts.filter((p) => p.ig_media_id).map((p) => [p.ig_media_id as string, p]));
  const fmt = (m: Midia) => formato(m, doApp.get(m.id));
  const rotulo = METRICAS.find(([k]) => k === metrica)![1];
  const lista = [...dados.midias].sort((a, b) => (valor(b, metrica) ?? -1) - (valor(a, metrica) ?? -1));
  const porFormato = medias(dados.midias, fmt, metrica);
  const porHorario = medias(dados.midias, (m) => faixa(horaSP(m.timestamp)), metrica);
  const chip = (ativo: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
      ativo ? "border-[var(--accent-line)] bg-[var(--chip-bg)] text-[var(--chip-text)]" : "border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--surface-hover)]"
    }`;

  return (
    <div>
      {!dados.liberadas && (
        <Card className="mb-4 border-[var(--danger)] p-4 text-sm text-[var(--text)]">
          O Instagram não liberou as métricas desta conta: só aparecem curtidas e comentários. Reconecte em Integração e aceite a permissão de métricas.
        </Card>
      )}

      <div className="sem-barra -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label="Ordenar pela métrica">
        {METRICAS.map(([k, r]) => (
          <button key={k} className={chip(metrica === k)} aria-pressed={metrica === k} onClick={() => setMetrica(k)}>{r}</button>
        ))}
      </div>

      {[["Média por formato", porFormato], ["Média por horário", porHorario]].map(([titulo, grupos]) =>
        (grupos as ReturnType<typeof medias>).length > 0 && (
          <Card key={titulo as string} className="mb-3 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">{titulo as string} · {rotulo}</p>
            <div className="mt-2 grid gap-1.5">
              {(grupos as ReturnType<typeof medias>).map((g, i) => (
                <div key={g.nome} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={i === 0 ? "font-semibold text-[var(--text)]" : "text-[var(--text-dim)]"}>
                    {g.nome} <span className="text-xs text-[var(--text-faint)]">({g.n} {g.n === 1 ? "post" : "posts"})</span>
                  </span>
                  <span className={`nums ${i === 0 ? "font-semibold text-[var(--accent-hi)]" : "text-[var(--text)]"}`}>{num(g.media)}</span>
                </div>
              ))}
            </div>
          </Card>
        ),
      )}
      <p className="mb-4 text-xs text-[var(--text-faint)]">As médias usam só posts com 24 horas ou mais: post novo ainda está subindo.</p>

      <div className="grid gap-2">
        {lista.map((m) => {
          const titulo = doApp.get(m.id)?.titulo ?? ((m.caption ?? "").split("\n")[0].slice(0, 90) || "Sem legenda");
          const capa = m.thumbnail_url || m.media_url || "";
          return (
            <a key={m.id} href={m.permalink} target="_blank" rel="noreferrer"
              className="flex gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2.5 hover:bg-[var(--surface-hover)]">
              <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-[var(--surface-2)]">
                {capa && <img src={capa} alt="" loading="lazy" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-medium leading-snug text-[var(--text)]">{titulo}</p>
                  <p className="shrink-0 text-right">
                    <span className="nums block text-base font-semibold text-[var(--accent-hi)]">{num(valor(m, metrica))}</span>
                    <span className="block text-[10px] text-[var(--text-faint)]">{rotulo.toLowerCase()}</span>
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-faint)]">{fmt(m)} · {quando(m.timestamp)} · {idade(m.timestamp)}</p>
                <p className="nums mt-1 text-[11px] text-[var(--text-dim)]">
                  {METRICAS.filter(([k]) => k !== metrica && valor(m, k) !== undefined).map(([k, r]) => `${r} ${num(valor(m, k))}`).join(" · ")}
                </p>
              </div>
            </a>
          );
        })}
      </div>

      <Button className="mt-4 min-h-11 w-full" variant="ghost" onClick={() => setVez((v) => v + 1)}>Atualizar os números</Button>
    </div>
  );
}
