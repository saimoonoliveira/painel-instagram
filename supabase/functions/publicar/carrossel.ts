// Os passos da Meta para publicar um carrossel (Content Publishing API, login do Instagram):
//   1 contêiner por slide (JPEG em URL pública) -> contêiner CAROUSEL com a legenda -> esperar FINISHED -> media_publish.
// Sem banco nem Deno.env aqui: o index.ts passa a chamada real à API, e o teste passa uma Meta de mentira.

export type Chamar = (caminho: string, params: Record<string, string>, metodo?: "GET" | "POST") => Promise<Record<string, unknown>>;

export class ErroMeta extends Error {
  constructor(mensagem: string, readonly codigo?: number) {
    super(mensagem);
  }
}

// Chamada real à graph.instagram.com, com o token no cabeçalho (nunca na URL).
export function chamarMeta(token: string, base: string): Chamar {
  return async (caminho, params, metodo = "GET") => {
    const url = new URL(`${base}/${caminho}`);
    const init: RequestInit = { method: metodo, headers: { Authorization: `Bearer ${token}` } };
    if (metodo === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    else init.body = new URLSearchParams(params);
    const r = await fetch(url, init);
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok || corpo.error) {
      throw new ErroMeta(corpo.error?.error_user_msg ?? corpo.error?.message ?? `HTTP ${r.status}`, corpo.error?.code);
    }
    return corpo;
  };
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
// resposta sem id = algo saiu errado na Meta; para aqui (a conferência do containerAnterior cobre a repetição)
const idDe = (r: Record<string, unknown>) => {
  if (!r.id) throw new ErroMeta("A Meta respondeu sem o id do que foi criado.");
  return String(r.id);
};

// Publica e devolve o id do post no Instagram. Devolve null quando o carrossel de uma tentativa anterior
// já tinha saído (a resposta se perdeu no caminho): nesse caso não publica de novo.
export async function publicarCarrossel(o: {
  meta: Chamar;
  igUserId: string;
  imagens: string[];
  legenda: string;
  containerAnterior: string | null;
  // grava o id do carrossel ANTES de publicar: é o que permite conferir, numa próxima tentativa, se ele já saiu
  guardarContainer: (id: string) => Promise<void>;
  espera?: { tentativas: number; intervaloMs: number };
}): Promise<string | null> {
  const { meta, igUserId } = o;
  if (o.containerAnterior) {
    const anterior = await meta(o.containerAnterior, { fields: "status_code" }).catch(() => null);
    if (anterior?.status_code === "PUBLISHED") return null;
  }

  // um slide por vez: se a Meta recusar um, a mensagem diz qual
  const filhos: string[] = [];
  for (const [i, image_url] of o.imagens.entries()) {
    try {
      filhos.push(idDe(await meta(`${igUserId}/media`, { image_url, is_carousel_item: "true" }, "POST")));
    } catch (e) {
      throw new ErroMeta(`Slide ${i + 1}: ${(e as Error).message}`, (e as ErroMeta).codigo);
    }
  }
  const id = idDe(await meta(`${igUserId}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: o.legenda }, "POST"));
  await o.guardarContainer(id);

  // fotos costumam ficar prontas em segundos; a Meta pede para não insistir por mais de 5 minutos
  const { tentativas, intervaloMs } = o.espera ?? { tentativas: 20, intervaloMs: 3000 };
  for (let i = 0; ; i++) {
    const { status_code } = await meta(id, { fields: "status_code" });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new ErroMeta(`A Meta não conseguiu processar o carrossel (${status_code}).`);
    if (i + 1 >= tentativas) throw new ErroMeta("A Meta ainda estava processando o carrossel. Tente de novo em alguns minutos.");
    await pausa(intervaloMs);
  }
  return idDe(await meta(`${igUserId}/media_publish`, { creation_id: id }, "POST"));
}

// Link público do post (para o botão "Abrir no Instagram"). Sem link não é erro: o post já saiu.
export async function linkDoPost(meta: Chamar, mediaId: string): Promise<string | null> {
  const r = await meta(mediaId, { fields: "permalink" }).catch(() => null);
  return r?.permalink ? String(r.permalink) : null;
}
