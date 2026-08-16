import React, { useState, useRef, KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface KanbanCardProps {
  id: string;
  title: string;
  onTitleChange: (newTitle: string) => void;
  isDragging?: boolean;
}

export default function KanbanCard({ id, title, onTitleChange, isDragging }: KanbanCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: sortableDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableDragging || isDragging ? 0.4 : 1,
  };

  function startEditing() {
    setDraft(title);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card ${sortableDragging ? "kanban-card--dragging" : ""}`}
      data-card-id={id}
    >
      {/* drag handle */}
      <span
        className="card-drag-handle"
        {...attributes}
        {...listeners}
        aria-label="Drag card"
      >
        ⠿
      </span>

      {editing ? (
        <input
          ref={inputRef}
          className="card-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="card-title"
          onDoubleClick={startEditing}
          title="Double-click to edit"
        >
          {title}
        </span>
      )}

      {!editing && (
        <button
          className="card-edit-btn"
          onClick={startEditing}
          title="Edit title"
          aria-label="Edit card title"
        >
          ✎
        </button>
      )}
    </div>
  );
}
