// Pop-up de confirmação no estilo do app, no lugar do confirm() nativo do navegador.
// Uso:  const confirm = useConfirm();  if (!(await confirm("Excluir?"))) return;
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/ui";

type Opts = { message: string; confirmLabel?: string; danger?: boolean };
type State = { opts: Opts; resolve: (ok: boolean) => void };

const Ctx = createContext<(o: Opts | string) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  const confirm = useCallback(
    (o: Opts | string) =>
      new Promise<boolean>((resolve) => setState({ opts: typeof o === "string" ? { message: o } : o, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm leading-relaxed text-[var(--text)]">{state.opts.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>Cancelar</Button>
              <Button variant={state.opts.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                {state.opts.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
