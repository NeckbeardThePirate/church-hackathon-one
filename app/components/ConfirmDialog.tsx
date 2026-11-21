"use client";

import { useEffect, useRef } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** In-app confirmation. Never uses window.alert, confirm, or prompt. */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--sidebar)] p-5 text-[var(--ink)] shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-2 max-h-[50dvh] overflow-y-auto text-sm leading-relaxed text-[var(--ink-muted)] [scrollbar-gutter:stable]">
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-md border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-md border border-[color-mix(in_srgb,#c0533f_55%,var(--line))] bg-[color-mix(in_srgb,#c0533f_16%,var(--sidebar))] px-3 py-2 text-sm font-medium text-[var(--ink)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
