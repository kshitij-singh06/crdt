import { useState } from "react";
import type { FormEvent } from "react";

interface AddCardFormProps {
  columnId: string;
  onAdd: (columnId: string, title: string) => void;
}

export default function AddCardForm({ columnId, onAdd }: AddCardFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(columnId, trimmed);
    setTitle("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        className="add-card-btn"
        id={`add-card-btn-${columnId}`}
        onClick={() => setOpen(true)}
      >
        + Add card
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="add-card-form" id={`add-card-form-${columnId}`}>
      <input
        className="add-card-input"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Card title…"
        autoFocus
        required
      />
      <div className="add-card-actions">
        <button type="submit" className="btn-primary btn-sm" id={`add-card-submit-${columnId}`}>
          Add
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
