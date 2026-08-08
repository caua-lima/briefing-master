"use client";

import { useEffect } from "react";

export default function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Listener global, não local: preso ao onKeyDown do overlay, o Escape só
  // funcionava se o foco já estivesse DENTRO do modal — mas ao abrir por
  // clique, o foco costuma continuar no botão que abriu (fora do modal), e
  // Escape não fazia nada. Mesmo padrão do CommandPalette/DateRangePicker.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-overlay active"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className={`modal-box ${wide ? "modal-box-wide" : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
