import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createBoard, addMember, deleteBoard, getBoards } from "../api/boards";
import type { BoardSummary } from "../api/boards";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";

export default function BoardsPage() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // My boards
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  // Create board state
  const [boardName, setBoardName] = useState("");
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  // Add member state
  const [boardIdForMember, setBoardIdForMember] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("editor");
  const [memberLoading, setMemberLoading] = useState(false);
  const [deletingBoardId, setDeletingBoardId] = useState<string | null>(null);

  // Confirm modal state (replaces window.confirm)
  const [confirmDelete, setConfirmDelete] = useState<{ boardId: string; boardName: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    setBoardsLoading(true);
    getBoards(token)
      .then((data) => setBoards(data.boards))
      .catch((err) => setBoardsError(err.message))
      .finally(() => setBoardsLoading(false));
  }, [token]);

  async function handleCreateBoard(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBoardError(null);
    setBoardLoading(true);
    try {
      const data = await createBoard(boardName, token);
      // Refresh the boards list then navigate
      const updated = await getBoards(token);
      setBoards(updated.boards);
      navigate(`/board/${data.board.id}`);
    } catch (err: unknown) {
      setBoardError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setBoardLoading(false);
    }
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMemberLoading(true);
    try {
      await addMember(boardIdForMember, memberEmail, memberRole, token);
      addToast("success", `Added ${memberEmail} as ${memberRole}`);
      setMemberEmail("");
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setMemberLoading(false);
    }
  }

  function handleDeleteBoard(boardId: string) {
    if (!token) return;
    const board = boards.find((item) => item.id === boardId);
    if (!board) return;
    setConfirmDelete({ boardId, boardName: board.name });
  }

  async function executeDeleteBoard() {
    if (!token || !confirmDelete) return;
    const { boardId } = confirmDelete;
    setConfirmDelete(null);

    setBoardsError(null);
    setDeletingBoardId(boardId);

    try {
      await deleteBoard(boardId, token);
      setBoards((current) => current.filter((item) => item.id !== boardId));
      addToast("success", "Board deleted successfully");
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to delete board");
    } finally {
      setDeletingBoardId(null);
    }
  }

  return (
    <div className="boards-page">
      <header className="boards-header">
        <div className="boards-header-inner">
          <h1>Kanban Sync</h1>
          <div className="boards-user">
            <span>Logged in as <strong>{user?.name}</strong></span>
            <button id="logout-btn" className="btn-ghost" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="boards-main">
        {/* My Boards */}
        <section className="boards-section">
          <h2>My Boards</h2>
          {boardsLoading && (
            <div className="boards-skeleton">
              <div className="boards-skeleton-row" />
              <div className="boards-skeleton-row" />
              <div className="boards-skeleton-row" />
            </div>
          )}
          {boardsError && <p className="form-error">{boardsError}</p>}
          {!boardsLoading && !boardsError && boards.length === 0 && (
            <div className="boards-empty-state">
              <p className="boards-empty-text">You have no boards yet. Create one below to get started.</p>
            </div>
          )}
          {boards.length > 0 && (
            <ul className="my-boards-list">
              {boards.map((b) => (
                <li key={b.id}>
                  <div className="my-board-row">
                    <button
                      className="my-board-card"
                      onClick={() => navigate(`/board/${b.id}`)}
                    >
                      <span className="my-board-name">{b.name}</span>
                      <span className={`member-role member-role--${b.role}`}>{b.role}</span>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-danger btn-sm"
                      onClick={() => handleDeleteBoard(b.id)}
                      disabled={deletingBoardId === b.id}
                      aria-label={`Delete board ${b.name}`}
                    >
                      {deletingBoardId === b.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Create Board */}
        <section className="boards-section">
          <h2>Create a New Board</h2>
          <form onSubmit={handleCreateBoard} className="inline-form" id="create-board-form">
            <input
              id="board-name-input"
              type="text"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="Board name"
              required
            />
            <button id="create-board-btn" type="submit" className="btn-primary" disabled={boardLoading}>
              {boardLoading ? "Creating…" : "Create Board"}
            </button>
          </form>
          {boardError && <p className="form-error">{boardError}</p>}
        </section>

        {/* Add Member */}
        <section className="boards-section">
          <h2>Add Member to Board</h2>
          <p className="section-hint">
            Invite another user by their email to collaborate on a board.
          </p>
          <form onSubmit={handleAddMember} className="member-form" id="add-member-form">
            <input
              id="member-board-id-input"
              type="text"
              value={boardIdForMember}
              onChange={(e) => setBoardIdForMember(e.target.value)}
              placeholder="Board UUID"
              required
            />
            <input
              id="member-email-input"
              type="email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="Member email"
              required
            />
            <select
              id="member-role-select"
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <button id="add-member-btn" type="submit" className="btn-secondary" disabled={memberLoading}>
              {memberLoading ? "Adding…" : "Add Member"}
            </button>
          </form>
        </section>
      </main>

      <ConfirmModal
        open={!!confirmDelete}
        title="Delete Board"
        message={confirmDelete ? `Delete board "${confirmDelete.boardName}"? This action cannot be undone.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeDeleteBoard}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
