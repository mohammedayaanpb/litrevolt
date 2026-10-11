import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; ref?: Ref<HTMLButtonElement> }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props} />;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'accent' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return <span className="spinner"><LoaderCircle size={17} aria-hidden className="spin" /> {label}</span>;
}

export function Toast({ message, tone = 'success', onClose }: { message: string; tone?: 'success' | 'error'; onClose(): void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (tone === 'error' || paused) return;
    const timeout = window.setTimeout(onClose, 6500);
    return () => window.clearTimeout(timeout);
  }, [message, tone, onClose, paused]);
  return (
    <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      {tone === 'success' ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
      <span>{message}</span>
      <IconButton label="Dismiss" onClick={onClose}><X size={16} /></IconButton>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{hint && <span className="field-hint">{hint}</span>}{children}</label>;
}

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}
