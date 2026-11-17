import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { IgAccount } from "./types";

interface AccountCtx {
  accounts: IgAccount[];
  account: IgAccount | null;
  accountId: string | null;
  setAccountId: (id: string) => void;
  isAdmin: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<AccountCtx>({
  accounts: [], account: null, accountId: null,
  setAccountId: () => {}, isAdmin: false, loading: true, reload: async () => {},
});

const KEY = "mcs.accountId";

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [accountId, setAccountIdState] = useState<string | null>(() => localStorage.getItem(KEY));
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [{ data: accs }, { data: admin }] = await Promise.all([
      supabase.from("ig_account").select("*").order("created_at", { ascending: true }),
      supabase.from("app_admins").select("user_id").maybeSingle(),
    ]);
    const list = (accs as IgAccount[]) ?? [];
    setAccounts(list);
    setIsAdmin(!!admin);
    setAccountIdState((prev) => {
      const valid = prev && list.some((a) => a.id === prev);
      return valid ? prev : (list.find((a) => a.is_active)?.id ?? list[0]?.id ?? null);
    });
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  function setAccountId(id: string) {
    localStorage.setItem(KEY, id);
    setAccountIdState(id);
  }

  const account = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <Ctx.Provider value={{ accounts, account, accountId, setAccountId, isAdmin, loading, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAccounts = () => useContext(Ctx);
