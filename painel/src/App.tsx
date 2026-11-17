import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { AccountProvider } from "./lib/account";
import { ConfirmProvider } from "./lib/confirm";
import Layout from "./components/Layout";
import Login from "./pages/Login";
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-[var(--text-dim)]" aria-live="polite">Carregando…</div>;
  if (!session) return <Login />;

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
