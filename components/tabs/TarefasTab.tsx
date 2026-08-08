"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import Modal from "@/components/Modal";
import type { AccessEntry, Task, TaskPriority, TaskStatus } from "@/lib/domain/types";
import { deleteTask, upsertTask, watchAccessList, watchTasks } from "@/lib/firebase/data";
import { useAccess } from "@/components/tabs/AccessGuard";

const PRIORIDADE_META: Record<TaskPriority, { label: string; cor: string; peso: number }> = {
  critica: { label: "Crítica", cor: "var(--danger,var(--red))", peso: 3 },
  alta: { label: "Alta", cor: "var(--warning,#F4B942)", peso: 2 },
  media: { label: "Média", cor: "var(--info-2,var(--info))", peso: 1 },
  baixa: { label: "Baixa", cor: "var(--text-muted,var(--muted))", peso: 0 },
};
/** Tarefa sem prioridade definida (dado antigo) lê como "média" — nunca inventa "crítica" nem "baixa" por omissão. */
function prioridadeDe(t: Task): TaskPriority {
  return t.priority ?? "media";
}

function newId() {
  return "t" + Date.now() + Math.random().toString(36).slice(2, 6);
}

const COLS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "todo", label: "A Fazer", dot: "var(--accent)" },
  { status: "doing", label: "Fazendo", dot: "var(--yellow)" },
  { status: "done", label: "Concluído", dot: "var(--green)" },
];

function fmtData(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function isAtrasada(t: Task): boolean {
  if (!t.dueDate || t.status === "done") return false;
  return t.dueDate < new Date().toISOString().slice(0, 10);
}

type Filtro = "todas" | "pra-mim" | "criei-eu";

export default function TarefasTab() {
  const { email } = useAccess();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pessoas, setPessoas] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [openNew, setOpenNew] = useState(false);

  useEffect(() => {
    const u1 = watchTasks((ts) => { setTasks(ts); setLoading(false); });
    const u2 = watchAccessList((es) => setPessoas(es));
    return () => { u1(); u2(); };
  }, []);

  const visiveis = useMemo(() => {
    if (filtro === "pra-mim") return tasks.filter((t) => t.assignedTo === email);
    if (filtro === "criei-eu") return tasks.filter((t) => t.createdBy === email);
    return tasks;
  }, [tasks, filtro, email]);

  const porColuna = (status: TaskStatus) => visiveis.filter((t) => t.status === status);

  async function mover(t: Task, status: TaskStatus) {
    if (t.status === status) return;
    await upsertTask({ ...t, status }).catch(() => {});
  }

  async function excluir(t: Task) {
    if (!confirm(`Excluir a tarefa "${t.title}"?`)) return;
    await deleteTask(t.id).catch(() => {});
  }

  const minhas = tasks.filter((t) => t.assignedTo === email).length;
  const criadas = tasks.filter((t) => t.createdBy === email).length;
  const abertas = tasks.filter((t) => t.status !== "done").length;

  // Distância mínima antes de considerar arrasto (não clique) — sem isso, um
  // toque simples pra abrir "Editar" já dispararia um drag. PointerSensor
  // cobre mouse e toque igual, então funciona no celular também.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  function onDragStart(e: DragStartEvent) {
    const t = tasks.find((x) => x.id === e.active.id) ?? null;
    setDraggingTask(t);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDraggingTask(null);
    const overStatus = e.over?.id as TaskStatus | undefined;
    const t = tasks.find((x) => x.id === e.active.id);
    if (!t || !overStatus) return;
    await mover(t, overStatus);
  }

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Tarefas</h2></div>
        <div className="tab-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenNew(true)}>＋ Nova Tarefa</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Em aberto</div><div className="k-val">{abertas}</div><div className="k-sub">{tasks.length} no total</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Pra mim</div><div className="k-val" style={{ color: "var(--yellow)" }}>{minhas}</div><div className="k-sub">atribuídas a você</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Criadas por mim</div><div className="k-val" style={{ color: "var(--green)" }}>{criadas}</div></div>
      </div>

      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button type="button" className={`seg-btn ${filtro === "todas" ? "active" : ""}`} onClick={() => setFiltro("todas")}>Todas</button>
        <button type="button" className={`seg-btn ${filtro === "pra-mim" ? "active" : ""}`} onClick={() => setFiltro("pra-mim")}>Pra mim</button>
        <button type="button" className={`seg-btn ${filtro === "criei-eu" ? "active" : ""}`} onClick={() => setFiltro("criei-eu")}>Criei eu</button>
      </div>

      {loading ? (
        <div className="empty-state">Carregando…</div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="kanban-board">
            {COLS.map((col) => {
              const itens = porColuna(col.status);
              return (
                <KanbanColuna key={col.status} status={col.status} label={col.label} dot={col.dot} count={itens.length}>
                  {itens.length === 0 ? (
                    <div className="kanban-empty">Nenhuma tarefa aqui{draggingTask ? " · solte pra mover" : ""}</div>
                  ) : (
                    itens.map((t) => (
                      <DraggableTaskCard
                        key={t.id}
                        task={t}
                        onMover={(s) => mover(t, s)}
                        onEditar={() => setEditTask(t)}
                        onExcluir={() => excluir(t)}
                      />
                    ))
                  )}
                </KanbanColuna>
              );
            })}
          </div>
          <DragOverlay>
            {draggingTask ? <TaskCard task={draggingTask} onMover={() => {}} onEditar={() => {}} onExcluir={() => {}} arrastando /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {openNew && (
        <TaskModal pessoas={pessoas} minhaEmail={email} task={null} onClose={() => setOpenNew(false)} />
      )}
      {editTask && (
        <TaskModal pessoas={pessoas} minhaEmail={email} task={editTask} onClose={() => setEditTask(null)} />
      )}
    </div>
  );
}

/** Coluna do quadro — é o alvo do "solte aqui" do drag-and-drop. */
function KanbanColuna({ status, label, dot, count, children }: {
  status: TaskStatus; label: string; dot: string; count: number; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="kanban-col" ref={setNodeRef} style={isOver ? { borderColor: "var(--accent)", background: "rgba(233,169,45,.05)" } : undefined}>
      <div className="kanban-col-head">
        <span className="kanban-col-title">
          <span className="kanban-dot" style={{ background: dot }} />{label} ({count})
        </span>
      </div>
      <div className="kanban-cards">{children}</div>
    </div>
  );
}

/** Envolve o card com o arrasto — só o "grip" no topo inicia o drag, então
 *  clicar em Editar/Excluir/mover continua funcionando normalmente. */
function DraggableTaskCard({ task, onMover, onEditar, onExcluir }: {
  task: Task;
  onMover: (s: TaskStatus) => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.35 : 1 }}>
      <TaskCard task={task} onMover={onMover} onEditar={onEditar} onExcluir={onExcluir} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function TaskCard({ task, onMover, onEditar, onExcluir, dragHandleProps, arrastando }: {
  task: Task;
  onMover: (s: TaskStatus) => void;
  onEditar: () => void;
  onExcluir: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  arrastando?: boolean;
}) {
  const idx = COLS.findIndex((c) => c.status === task.status);
  const atrasada = isAtrasada(task);
  return (
    <div className={`kanban-card pri-${task.status}`} style={arrastando ? { boxShadow: "0 10px 30px rgba(0,0,0,.45)", cursor: "grabbing" } : undefined}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {dragHandleProps && (
          <span
            {...dragHandleProps}
            title="Arraste pra mover"
            style={{ cursor: "grab", color: "var(--muted)", flexShrink: 0, marginTop: 2, padding: "2px 2px", touchAction: "none" }}
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
              <circle cx="3" cy="2" r="1.4" /><circle cx="9" cy="2" r="1.4" />
              <circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" />
              <circle cx="3" cy="14" r="1.4" /><circle cx="9" cy="14" r="1.4" />
            </svg>
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
      <div className="kanban-card-title">{task.title}</div>
      {task.description && <div className="kanban-card-desc">{task.description}</div>}
      <div className="kanban-card-meta">
        <span className="severity-chip" style={{ color: PRIORIDADE_META[prioridadeDe(task)].cor, background: "transparent", border: `1px solid ${PRIORIDADE_META[prioridadeDe(task)].cor}` }}>
          {PRIORIDADE_META[prioridadeDe(task)].label}
        </span>
        {task.assignedToName && <span className="chip chip-accent">👤 {task.assignedToName}</span>}
        {task.dueDate && <span className={`chip ${atrasada ? "chip-red" : "chip-muted"}`}>{atrasada ? "atrasada · " : ""}{fmtData(task.dueDate)}</span>}
      </div>
      <div className="kanban-card-foot">
        <span style={{ fontSize: ".68rem", color: "var(--muted)" }}>
          {task.createdByName ? `por ${task.createdByName}` : ""}
        </span>
        <div className="row-actions">
          <div className="kanban-move-btns">
            <button type="button" className="btn btn-ghost btn-xs" title="Mover pra trás" disabled={idx <= 0} onClick={() => onMover(COLS[idx - 1].status)}>←</button>
            <button type="button" className="btn btn-ghost btn-xs" title="Mover pra frente" disabled={idx >= COLS.length - 1} onClick={() => onMover(COLS[idx + 1].status)}>→</button>
          </div>
          <button type="button" className="btn btn-warning btn-xs" onClick={onEditar}>Editar</button>
          <button type="button" className="btn btn-danger btn-xs" onClick={onExcluir}>Excluir</button>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}

function TaskModal({ pessoas, minhaEmail, task, onClose }: {
  pessoas: AccessEntry[];
  minhaEmail: string;
  task: Task | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? minhaEmail);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task ? prioridadeDe(task) : "media");
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!title.trim()) { alert("Dê um título pra tarefa."); return; }
    setSaving(true);
    try {
      const pessoa = pessoas.find((p) => p.email === assignedTo);
      const eu = pessoas.find((p) => p.email === minhaEmail);
      const next: Task = {
        id: task?.id || newId(),
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assignedTo: assignedTo || undefined,
        assignedToName: pessoa?.displayName || assignedTo || undefined,
        dueDate: dueDate || undefined,
        createdBy: task?.createdBy ?? minhaEmail,
        createdByName: task?.createdByName ?? (eu?.displayName || minhaEmail),
        createdAt: task?.createdAt ?? Date.now(),
      };
      await upsertTask(next);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">{task ? "Editar Tarefa" : "Nova Tarefa"}</div>

      <div className="config-field">
        <label>Título</label>
        <input type="text" placeholder="Ex: Responder cliente sobre devolução" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>

      <div className="config-field">
        <label>Descrição (opcional)</label>
        <input type="text" placeholder="Detalhes da tarefa…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="form-grid">
        <div className="config-field" style={{ margin: 0 }}>
          <label>Atribuir pra</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">— ninguém —</option>
            {pessoas.map((p) => (
              <option key={p.email} value={p.email}>
                {p.displayName || p.email}{p.email === minhaEmail ? " (eu)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="config-field" style={{ margin: 0 }}>
          <label>Prazo (opcional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div className="config-field">
        <label>Prioridade</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
          {(["critica", "alta", "media", "baixa"] as const).map((p) => (
            <option key={p} value={p}>{PRIORIDADE_META[p].label}</option>
          ))}
        </select>
      </div>

      <div className="config-field">
        <label>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
          {COLS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
        </select>
      </div>

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={onSave} disabled={saving}>
          {saving ? "Salvando…" : "Salvar Tarefa"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
