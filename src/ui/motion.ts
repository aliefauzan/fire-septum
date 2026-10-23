import { useEffect, useRef, useState } from 'react';

/** True when the user asked the OS for less motion; every animation here then collapses to its end state. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

/**
 * Animate a number towards `target` over `ms` (ease-out), so a changed result is seen to change
 * rather than silently replaced. Jumps straight to the target under reduced motion.
 */
export function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const shown = useRef(target);
  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(target)) { shown.current = target; setValue(target); return; }
    from.current = shown.current;
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      shown.current = from.current + (target - from.current) * easeOut(k);
      setValue(shown.current);
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return value;
}

/** Reveal `text` a few characters at a time, like a hash being written out. */
export function useTypewriter(text: string, msPerChar = 14): string {
  const [n, setN] = useState(reducedMotion() ? text.length : 0);
  useEffect(() => {
    if (reducedMotion()) { setN(text.length); return; }
    setN(0);
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const k = Math.min(text.length, Math.floor((now - start) / msPerChar));
      setN(k);
      if (k < text.length) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [text, msPerChar]);
  return text.slice(0, n);
}
