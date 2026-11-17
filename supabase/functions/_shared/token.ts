// Token do login do Instagram (ig_tokens), usado pelas funções metricas e publicar.
import { adminClient } from "./db.ts";

// O token do login dura 60 dias. Quando faltam menos de 20 (e ele tem mais de 1 dia), troca por um novo
// de 60 dias — assim a conexão não vence enquanto o Sistema de Conteúdo ou o agendador de posts forem usados.
// Vale também para o ManyChat, que lê o mesmo ig_tokens.
export async function renovarSeNecessario(
  db: ReturnType<typeof adminClient>,
  contaId: string,
  tk: { access_token: string; expires_at: string | null; updated_at: string | null },
): Promise<string> {
  if (!tk.expires_at) return tk.access_token;
  const falta = new Date(tk.expires_at).getTime() - Date.now();
  const idade = Date.now() - new Date(tk.updated_at ?? 0).getTime();
  if (falta > 20 * 86400e3 || idade < 86400e3) return tk.access_token;
  try {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", tk.access_token);
    const r = await fetch(url);
    const novo = await r.json();
    if (r.ok && novo.access_token) {
      const expira = new Date(Date.now() + Number(novo.expires_in ?? 60 * 86400) * 1000).toISOString();
      await db.from("ig_tokens").update({ access_token: novo.access_token, expires_at: expira, updated_at: new Date().toISOString() })
        .eq("ig_account_id", contaId);
      await db.from("ig_account").update({ token_expires_at: expira }).eq("id", contaId);
      return novo.access_token;
    }
  } catch {
    // segue com o token atual
  }
  return tk.access_token;
}
