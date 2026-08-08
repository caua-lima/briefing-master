"use client";

import { useEffect, useRef, useState } from "react";

export type CommandItem = { id: string; label: string; icon?: React.ReactNode };

/**
 * Busca rápida (Ctrl/Cmd+K) pra pular direto pra uma aba sem clicar na
 * sidebar. Overlay global — abre/fecha por teclado de qualquer lugar do
 * app, não só quando um elemento específico está focado (diferente do
 * Modal.tsx genérico, cujo Escape só funciona se o foco já estiver dentro
 * dele). Mesmo padrão de listener global usado no DateRangePicker.
 *
 * Sem prop `open`: quem chama só monta este componente quando a busca está
 * aberta (`{paletteOpen && <CommandPalette ... />}`) — assim query/activeIdx
 * já nascem zerados a cada abertura, sem precisar de um efeito só pra
 * resetar estado.
 */
export default function CommandPalette({
  onClose,
  items,
  onSelect,
}: {
  onClose: () => void;
  items: CommandItem[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? items.filter((it) => it.label.toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  useEffect(() => {
    // O input ainda não existe no primeiro paint do overlay — sem o
    // requestAnimationFrame, o .focus() roda cedo demais e não faz nada.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = filtered[activeIdx];
        if (chosen) { onSelect(chosen.id); onClose(); }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [filtered, activeIdx, onClose, onSelect]);

  return (
    <div className="cmdk-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <input
          ref={inputRef}
          type="text"
          className="search-inp cmdk-input"
          placeholder="Ir para… (ex: pedidos, custos, dre)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-listbox"
          aria-activedescendant={filtered[activeIdx] ? `cmdk-opt-${filtered[activeIdx].id}` : undefined}
        />
        <ul className="cmdk-list" role="listbox" id="cmdk-listbox">
          {filtered.length === 0 ? (
            <li className="cmdk-empty">Nada encontrado.</li>
          ) : (
            filtered.map((it, i) => (
              <li
                key={it.id}
                id={`cmdk-opt-${it.id}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`cmdk-item${i === activeIdx ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { onSelect(it.id); onClose(); }}
              >
                {it.icon && <span className="cmdk-item-icon">{it.icon}</span>}
                <span>{it.label}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
