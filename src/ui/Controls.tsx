import { useEffect, useRef, type ReactNode } from 'react';

/** Apple-style segmented control: one choice out of a few, always visible. */
export function Segmented<T extends string>({ value, onChange, options, label, full }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  label: string;
  full?: boolean;
}) {
  return (
    <div className={`segmented ${full ? 'full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Modal sheet over a dimming scrim. Esc, the scrim and "Done" all close it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="sheet-body">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn plain" onClick={onClose}>Done</button>
        </header>
        {open && children}
      </div>
    </dialog>
  );
}

/** Pull-down menu anchored to its button. Outside click and Esc close it. */
export function Menu({ label, primary, children }: { label: ReactNode; primary?: boolean; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { const d = ref.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.open) ref.current.open = false; };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details ref={ref} className="menu">
      <summary className={`btn ${primary ? 'primary' : ''}`}><span className="menu-label-row">{label}<span className="menu-chev" aria-hidden /></span></summary>
      <div className="menu-body">{children(close)}</div>
    </details>
  );
}
