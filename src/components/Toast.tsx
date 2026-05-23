import { useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { Toast as ToastData } from '../store/appStore';

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const CONFIG = {
  success: {
    icon: <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />,
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/[0.08]',
    bar: 'bg-emerald-400',
    title: 'text-emerald-300',
  },
  error: {
    icon: <AlertCircle size={18} className="text-red-400 flex-shrink-0" />,
    border: 'border-red-500/30',
    bg: 'bg-red-500/[0.08]',
    bar: 'bg-red-400',
    title: 'text-red-300',
  },
  info: {
    icon: <Info size={18} className="text-sky-400 flex-shrink-0" />,
    border: 'border-sky-500/30',
    bg: 'bg-sky-500/[0.08]',
    bar: 'bg-sky-400',
    title: 'text-sky-300',
  },
} as const;

const DURATION = 4200; // ms — must match appStore auto-dismiss timeout

export function Toast({ toast, onDismiss }: ToastProps) {
  const { id, type, title, message } = toast;
  const c = CONFIG[type];
  const barRef = useRef<HTMLDivElement>(null);

  // Animate the progress bar shrinking over DURATION ms
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.transition = `width ${DURATION}ms linear`;
    // Trigger on next frame so the initial width paints first
    requestAnimationFrame(() => { el.style.width = '0%'; });
  }, []);

  return (
    <div
      className={`relative flex items-start gap-3 px-4 py-3.5 rounded-xl border shadow-2xl shadow-black/50 backdrop-blur-sm overflow-hidden min-w-[300px] max-w-[380px] animate-slide-in-right ${c.border} ${c.bg}`}
      role="alert"
    >
      {/* Progress bar at bottom */}
      <div
        ref={barRef}
        className={`absolute bottom-0 left-0 h-0.5 w-full rounded-full opacity-60 ${c.bar}`}
        style={{ transition: 'none' }}
      />

      {c.icon}

      <div className="flex-1 min-w-0 pt-0.5">
        <p className={`text-sm font-semibold leading-tight ${c.title}`}>{title}</p>
        <p className="text-slate-400 text-xs mt-0.5 leading-snug">{message}</p>
      </div>

      <button
        onClick={() => onDismiss(id)}
        className="text-slate-600 hover:text-white transition-colors flex-shrink-0 mt-0.5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastStackProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 items-end pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
