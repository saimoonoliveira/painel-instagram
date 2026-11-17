// deno test supabase/functions/publicar/carrossel_test.ts
import { type Chamar, publicarCarrossel } from "./carrossel.ts";

function igual(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

// Meta de mentira: anota cada chamada e responde como a de verdade
function metaFalsa(status: string[], anterior?: string) {
  const chamadas: string[] = [];
  let n = 0;
  const meta: Chamar = async (caminho, params, metodo = "GET") => {
    chamadas.push(`${metodo} ${caminho} ${JSON.stringify(params)}`);
    if (metodo === "POST" && caminho.endsWith("/media_publish")) return { id: "post-1" };
    if (metodo === "POST" && params.media_type === "CAROUSEL") return { id: "carrossel" };
    if (metodo === "POST") return { id: `filho-${++n}` };
    if (caminho === "velho") return { status_code: anterior };
    return { status_code: status.shift() ?? "FINISHED" };
  };
  return { meta, chamadas };
}

const base = { igUserId: "123", imagens: ["https://x/1.jpg", "https://x/2.jpg"], legenda: "Oi", espera: { tentativas: 3, intervaloMs: 0 } };

Deno.test("monta os slides, o carrossel com a legenda, espera e publica", async () => {
  const { meta, chamadas } = metaFalsa(["IN_PROGRESS", "FINISHED"]);
  const guardados: string[] = [];
  const id = await publicarCarrossel({ ...base, meta, containerAnterior: null, guardarContainer: async (c) => { guardados.push(c); } });
  igual(id, "post-1", "id do post");
  igual(guardados, ["carrossel"], "guarda o carrossel antes de publicar");
  igual(chamadas, [
    `POST 123/media {"image_url":"https://x/1.jpg","is_carousel_item":"true"}`,
    `POST 123/media {"image_url":"https://x/2.jpg","is_carousel_item":"true"}`,
    `POST 123/media {"media_type":"CAROUSEL","children":"filho-1,filho-2","caption":"Oi"}`,
    `GET carrossel {"fields":"status_code"}`,
    `GET carrossel {"fields":"status_code"}`,
    `POST 123/media_publish {"creation_id":"carrossel"}`,
  ], "sequência de chamadas");
});

Deno.test("carrossel anterior que já saiu: não publica de novo", async () => {
  const { meta, chamadas } = metaFalsa([], "PUBLISHED");
  const id = await publicarCarrossel({ ...base, meta, containerAnterior: "velho", guardarContainer: async () => {} });
  igual(id, null, "sem id novo");
  igual(chamadas.length, 1, "só a conferência");
});

Deno.test("carrossel anterior que não saiu: monta um novo e publica", async () => {
  const { meta, chamadas } = metaFalsa([], "FINISHED");
  const id = await publicarCarrossel({ ...base, meta, containerAnterior: "velho", guardarContainer: async () => {} });
  igual(id, "post-1", "publicou");
  igual(chamadas.filter((c) => c.includes("media_publish")).length, 1, "publica uma vez só");
});

Deno.test("Meta demorando: desiste sem publicar", async () => {
  const { meta, chamadas } = metaFalsa(["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"]);
  let erro = "";
  await publicarCarrossel({ ...base, meta, containerAnterior: null, guardarContainer: async () => {} }).catch((e) => { erro = e.message; });
  igual(erro.startsWith("A Meta ainda estava processando"), true, "mensagem de espera");
  igual(chamadas.some((c) => c.includes("media_publish")), false, "não publicou");
});

Deno.test("falha ao guardar o carrossel: não publica", async () => {
  const { meta, chamadas } = metaFalsa([]);
  let erro = "";
  await publicarCarrossel({ ...base, meta, containerAnterior: null, guardarContainer: async () => { throw new Error("banco fora"); } })
    .catch((e) => { erro = e.message; });
  igual(erro, "banco fora", "erro do banco sobe");
  igual(chamadas.some((c) => c.includes("media_publish")), false, "não publicou");
});
