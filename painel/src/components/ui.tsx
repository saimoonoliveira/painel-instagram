import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-btn)] px-3.5 py-2 text-sm font-medium transition-[transform,background-color,border-color,opacity] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100";
  const variants = {
    primary: "bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hi)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-faint)] disabled:opacity-100 disabled:shadow-none shadow-[0_1px_2px_rgba(0,0,0,0.4)]",
    ghost: "bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)]",
    danger: "bg-transparent text-[var(--danger)] border border-[var(--border)] hover:border-[var(--danger)]/50 hover:bg-[var(--danger)]/10",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

const field = "w-full rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors duration-150 focus:border-[var(--accent-line)] focus:bg-[var(--surface-hover)]";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${field} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${field} resize-y ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${field} appearance-none bg-[var(--surface-2)] text-[var(--text)] ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] ${className}`}>{children}</div>;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium tracking-wide text-[var(--text-dim)] uppercase">{children}</label>;
}

export function Badge({ children, color }: { children: ReactNode; color?: string | null }) {
  const c = color ?? "#8b5cf6";
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: c + "1f", color: c, boxShadow: `inset 0 0 0 1px ${c}33` }}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-sm text-[var(--text-faint)]">{children}</div>;
}
