'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

/** Reject with a reason. For agent finds the reason is saved so the agents learn what not to send. */
export function RejectButton({ action, reasons }: { action: (reason: string) => Promise<unknown>; reasons: readonly string[] }) {
  const [reason, setReason] = useState(reasons[0]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">Reason for rejecting</label>
      <select id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-full border border-line bg-paper px-3 text-sm" disabled={pending}>
        {reasons.map((r) => <option key={r}>{r}</option>)}
      </select>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={pending}
        onClick={() => start(async () => {
          try {
            const r = (await action(reason)) as { message?: string } | undefined;
            toast(r?.message ?? 'Rejected', { tone: 'success' });
            router.refresh();
          } catch {
            toast('That didn’t work. Please try again.', { tone: 'error' });
          }
        })}
      >
        {pending ? <Spinner /> : <X size={15} aria-hidden="true" />} Reject
      </button>
    </span>
  );
}
