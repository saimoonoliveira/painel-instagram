import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { NOME } from "../lib/nome";
import { Button, Card, Input, Label } from "../components/ui";

// Segunda etapa do login. "cadastrar": primeira vez (QR code); "codigo": já tem o app configurado.
export default function DoisFatores({ modo }: { modo: "cadastrar" | "codigo" }) {
  const [fator, setFator] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [segredo, setSegredo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const iniciado = useRef(false); // StrictMode roda o efeito 2x; um cadastro só

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setErr(error.message);
      if (modo === "codigo") {
        const f = data.totp.find((x) => x.status === "verified");
        return f ? setFator(f.id) : setErr("Nenhum app configurado. Saia e entre de novo.");
      }
      // cadastro abandonado deixa um fator "não verificado" que impede criar outro
      for (const f of data.all.filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const r = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: NOME });
      if (r.error) return setErr(r.error.message);
      setFator(r.data.id);
      setSegredo(r.data.totp.secret);
      const q = r.data.totp.qr_code;
      setQr(q.startsWith("data:") ? q : `data:image/svg+xml;utf-8,${encodeURIComponent(q)}`);
    })();
  }, [modo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fator) return;
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator, code: codigo });
    setLoading(false);
    // sucesso: o Supabase troca a sessão (aal2) e o App segue sozinho
    if (error) setErr(error.code === "mfa_verification_failed" ? "Código inválido ou expirado. Confira o app e tente de novo." : error.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold text-[var(--text)]">Verificação em duas etapas</h1>
        {modo === "cadastrar" ? (
          <>
            <p className="mt-2 text-sm text-[var(--text-dim)]">
              Obrigatória para entrar. No celular, abra um app autenticador (Google Authenticator, Authy ou o app Senhas do iPhone) e escaneie o código abaixo.
            </p>
            <div className="mt-5 grid place-items-center rounded-xl bg-white p-3">
              {qr ? <img src={qr} alt="QR code para o app autenticador" width={184} height={184} /> : <div className="h-[184px] w-[184px]" aria-hidden="true" />}
            </div>
            {segredo && (
              <p className="mt-3 text-xs text-[var(--text-faint)]">
                Não consegue escanear? Digite esta chave no app:{" "}
                <span className="nums select-all break-all font-mono text-[var(--text-dim)]">{segredo}</span>
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-dim)]">Digite o código de 6 dígitos que aparece no seu app autenticador.</p>
        )}
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <Label htmlFor="codigo">Código</Label>
            <Input
              id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              placeholder="000000" autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} required
            />
          </div>
          {err && <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]" aria-live="polite">{err}</div>}
          <Button type="submit" className="w-full" disabled={loading || !fator || codigo.length !== 6}>
            {loading ? "Verificando…" : modo === "cadastrar" ? "Ativar e entrar" : "Entrar"}
          </Button>
        </form>
        <button onClick={() => supabase.auth.signOut()} className="mt-4 w-full text-center text-sm text-[var(--text-faint)] hover:text-[var(--text)]">
          Sair
        </button>
      </Card>
    </div>
  );
}
