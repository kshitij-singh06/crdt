/**
 * CardDetailModal.tsx
 *
 * A modal overlay for viewing and editing a card's full detail:
 * title, description, assignee, and comments.
 *
 * Rendered via ReactDOM.createPortal into document.body so it sits on
 * top of dnd-kit's drag context and the board canvas without z-index
 * stacking issues.
 *
 * Viewer role: all inputs are disabled and the comment Post button is
 * hidden, consistent with the read-only pattern established in Phase 4.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { CardData, Comment } from "../hooks/useYjsBoard";

interface BoardMember {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

interface CardDetailModalProps {
  card: CardData;
  members: BoardMember[];
  comments: Comment[];
  isViewer: boolean;
  onClose: () => void;
  onUpdateField: <K extends keyof CardData>(field: K, value: CardData[K]) => void;
  onAddComment: (text: string) => void;
}

/** Format a Date.now() timestamp as a human-readable relative or absolute string. */
function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function CardDetailModal({
  card,
  members,
  comments,
  isViewer,
  onClose,
  onUpdateField,
  onAddComment,
}: CardDetailModalProps) {
  // ── Title editing ─────────────────────────────────────────────────────────
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync if card.title changes from a remote peer while modal is open.
  useEffect(() => {
    if (!editingTitle) setTitleDraft(card.title);
  }, [card.title, editingTitle]);

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== card.title) {
      onUpdateField("title", trimmed);
    } else {
      setTitleDraft(card.title); // revert draft if empty or unchanged
    }
    setEditingTitle(false);
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitTitle();
    if (e.key === "Escape") { setTitleDraft(card.title); setEditingTitle(false); }
  }

  // ── Description editing ───────────────────────────────────────────────────
  // Description uses a controlled textarea that commits on blur.
  const [descDraft, setDescDraft] = useState(card.description ?? "");
  const [editingDesc, setEditingDesc] = useState(false);

  useEffect(() => {
    if (!editingDesc) setDescDraft(card.description ?? "");
  }, [card.description, editingDesc]);

  function commitDesc() {
    const trimmed = descDraft.trim();
    if (trimmed !== (card.description ?? "").trim()) {
      onUpdateField("description", trimmed);
    }
    setEditingDesc(false);
  }

  // ── Assignee ─────────────────────────────────────────────────────────────
  function handleAssigneeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    onUpdateField("assigneeId", val === "" ? null : val);
  }

  // ── Comments ──────────────────────────────────────────────────────────────
  const [commentText, setCommentText] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever a new comment arrives.
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  function handlePostComment(e: FormEvent) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed) return;
    onAddComment(trimmed);
    setCommentText("");
  }

  // ── Close on Escape / click-outside ──────────────────────────────────────
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Close only if the user clicked the dark overlay, not the modal content.
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Assignee display name helper ──────────────────────────────────────────
  const assigneeName = card.assigneeId
    ? members.find((m) => m.user_id === card.assigneeId)?.name ?? "Unknown"
    : null;

  // ── Portal render ─────────────────────────────────────────────────────────
  return createPortal(
    <div
      className="card-detail-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Card detail: ${card.title}`}
    >
      <div className="card-detail-modal">
        {/* Header */}
        <div className="card-detail-header">
          {editingTitle && !isViewer ? (
            <input
              ref={titleInputRef}
              className="card-detail-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              autoFocus
            />
          ) : (
            <h2
              className={`card-detail-title${!isViewer ? " card-detail-title--editable" : ""}`}
              onClick={() => { if (!isViewer) { setTitleDraft(card.title); setEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 0); } }}
              title={!isViewer ? "Click to edit title" : undefined}
            >
              {card.title}
            </h2>
          )}
          <button
            className="card-detail-close"
            onClick={onClose}
            aria-label="Close card detail"
            id="card-detail-close-btn"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="card-detail-body">

          {/* Description section */}
          <section className="card-detail-section">
            <p className="card-detail-section-label">Description</p>
            {editingDesc && !isViewer ? (
              <textarea
                className="card-detail-desc-textarea"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={commitDesc}
                autoFocus
                rows={4}
                placeholder="Add a description…"
              />
            ) : (
              <div
                className={`card-detail-desc-view${!isViewer ? " card-detail-desc-view--editable" : ""}`}
                onClick={() => { if (!isViewer) setEditingDesc(true); }}
                title={!isViewer ? "Click to edit description" : undefined}
              >
                {card.description
                  ? card.description
                  : <span className="card-detail-desc-placeholder">{isViewer ? "No description." : "Click to add a description…"}</span>
                }
              </div>
            )}
          </section>

          {/* Assignee section */}
          <section className="card-detail-section">
            <p className="card-detail-section-label">Assignee</p>
            {isViewer ? (
              <div className="card-detail-assignee-display">
                {assigneeName ?? <span className="card-detail-desc-placeholder">Unassigned</span>}
              </div>
            ) : (
              <select
                className="card-detail-assignee-select"
                value={card.assigneeId ?? ""}
                onChange={handleAssigneeChange}
                id="card-detail-assignee-select"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            )}
          </section>

          {/* Comments section */}
          <section className="card-detail-section card-detail-comments-section">
            <p className="card-detail-section-label">
              Comments
              {comments.length > 0 && (
                <span className="card-detail-comment-count">{comments.length}</span>
              )}
            </p>

            <div className="card-detail-comments-list">
              {comments.length === 0 && (
                <p className="card-detail-no-comments">No comments yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="comment-item">
                  <div className="comment-header">
                    <span className="comment-author">{c.authorName}</span>
                    <span className="comment-time" title={new Date(c.createdAt).toLocaleString()}>
                      {formatTimestamp(c.createdAt)}
                    </span>
                  </div>
                  <p className="comment-text">{c.text}</p>
                </div>
              ))}
              <div ref={commentsEndRef} />
            </div>

            {/* Comment input — hidden for viewers */}
            {!isViewer && (
              <form
                className="comment-form"
                onSubmit={handlePostComment}
                id="card-detail-comment-form"
              >
                <textarea
                  className="comment-input"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment…"
                  rows={2}
                  onKeyDown={(e) => {
                    // Ctrl/Cmd+Enter submits, plain Enter is a newline.
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      handlePostComment(e as unknown as FormEvent);
                    }
                  }}
                />
                <div className="comment-form-actions">
                  <span className="comment-form-hint">Ctrl+Enter to post</span>
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    id="card-detail-comment-submit"
                    disabled={!commentText.trim()}
                  >
                    Post
                  </button>
                </div>
              </form>
            )}
          </section>

        </div>
      </div>
    </div>,
    document.body
  );
}
