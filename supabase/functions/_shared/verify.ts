// Verificação da assinatura X-Hub-Signature-256 enviada pela Meta.
// Garante que o payload veio da Meta e não foi adulterado.

const encoder = new TextEncoder();

export async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret) throw new Error("META_APP_SECRET não configurado (Supabase secret)");
  if (!header) return false;

  const expectedPrefix = "sha256=";
  if (!header.startsWith(expectedPrefix)) return false;
  const provided = header.slice(expectedPrefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computed, provided);
}

// Comparação em tempo constante para evitar timing attacks.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
