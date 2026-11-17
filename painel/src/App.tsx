import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { AccountProvider } from "./lib/account";
import { ConfirmProvider } from "./lib/confirm";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import DoisFatores from "./pages/DoisFatores";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import Conteudo from "./pages/Conteudo";
import Monitor from "./pages/Monitor";
import Posts from "./pages/Posts";
import Flows from "./pages/Flows";
import Triggers from "./pages/Triggers";
import Inbox from "./pages/Inbox";
import Integracao from "./pages/Integracao";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // 2FA obrigatório: "ok" = senha + código; senão, a etapa que falta
  const [etapa, setEtapa] = useState<"ok" | "codigo" | "cadastrar" | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setEtapa(null);
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) =>
      setEtapa(data?.currentLevel === "aal2" ? "ok" : data?.nextLevel === "aal2" ? "codigo" : "cadastrar"),
    );
  }, [session]);

  const carregando = <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-dim)]" aria-live="polite">Carregando…</div>;
  if (!ready) return carregando;
  if (!session) return <Login />;
  if (!etapa) return carregando;
  if (etapa !== "ok") return <DoisFatores key={etapa} modo={etapa} />;

  return (
    <AccountProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="posts" element={<Posts />} />
              <Route path="conteudo" element={<Conteudo />} />
              <Route path="monitor" element={<Monitor />} />
              <Route path="flows" element={<Flows />} />
              <Route path="triggers" element={<Triggers />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="integracao" element={<Integracao />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </AccountProvider>
  );
}
