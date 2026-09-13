import { useState, useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface KanbanCardProps {
  id: string;
  title: string;
  onTitleChange: (newTitle: string) => void;
  isDragging?: boolean;
  /** Called when the user clicks the card body (not the drag handle) to open the detail modal. */
  onOpenDetail: () => void;
  /** Called with the cardId when the user starts inline-title editing (for Awareness). */
  onEditingStart?: (cardId: string) => void;
  /** Called when the user stops inline-title editing (for Awareness). */
  onEditingEnd?: () => void;
  /** Name of a remote peer currently editing this card's title (Awareness presence bonus). */
  editingUser?: string | null;
  /** Number of comments on this card, shown as a badge. */
  commentCount?: number;
}

export default function KanbanCard({
  id,
  title,
  onTitleChange,
  isDragging,
  onOpenDetail,
  onEditingStart,
  onEditingEnd,
  editingUser,
  commentCount,
}: KanbanCardProps) {
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

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableDragging || isDragging ? 0.4 : 1,
  };

  function startEditing() {
    setDraft(title);
    setEditing(true);
    onEditingStart?.(id);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    }
    setEditing(false);
    onEditingEnd?.();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") {
      setEditing(false);
      onEditingEnd?.();
    }
  }

  /**
   * Handle clicks on the card body to open the detail modal.
   * Guards:
   *  - Not while dnd-kit is currently dragging (sortableDragging).
   *  - Not while the user is inline-editing the title.
   * The drag handle has its own listeners and does NOT trigger this.
   */
  function handleCardBodyClick() {
    if (sortableDragging || editing) return;
    onOpenDetail();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card ${sortableDragging ? "kanban-card--dragging" : ""}`}
      data-card-id={id}
      onClick={handleCardBodyClick}
    >
      {/* drag handle — has dnd-kit listeners; clicking it does NOT open modal */}
      <span
        className="card-drag-handle"
        {...attributes}
        {...listeners}
        aria-label="Drag card"
        onClick={(e) => e.stopPropagation()} // prevent bubbling to card body onClick
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
          onDoubleClick={(e) => { e.stopPropagation(); startEditing(); }}
          title="Double-click to edit title · Click to open detail"
        >
          {title}
        </span>
      )}

      {!editing && (
        <button
          className="card-edit-btn"
          onClick={(e) => { e.stopPropagation(); startEditing(); }}
          title="Edit title"
          aria-label="Edit card title"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>
      )}

      {/* Comment count badge */}
      {!editing && (commentCount ?? 0) > 0 && (
        <span className="card-comment-badge" title={`${commentCount} comment${commentCount !== 1 ? 's' : ''}`}>
          💬 {commentCount}
        </span>
      )}

      {/* Awareness presence bonus: show who else is editing this card */}
      {editingUser && (
        <span className="card-editing-indicator" title={`${editingUser} is editing`}>
          {editingUser}
        </span>
      )}
    </div>
  );
}
