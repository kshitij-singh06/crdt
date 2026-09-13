import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { getBoard, createColumn, createInvite } from "../api/boards";
import type { BoardDetail, BoardMember } from "../api/boards";
import { useYjsBoard } from "../hooks/useYjsBoard";
import BoardColumn from "../components/BoardColumn";
import CardDetailModal from "../components/CardDetailModal";
import { WS_BASE_URL } from "../config";



// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const { addToast } = useToast();

  // ── REST snapshot (one-time, for board name + members + seeding) ──────────
  const [restData, setRestData] = useState<BoardDetail | null>(null);
  const [restError, setRestError] = useState<string | null>(null);
  const [restLoading, setRestLoading] = useState(true);

  // ── Add Column UI state ───────────────────────────────────────────────────
  const [newColTitle, setNewColTitle] = useState("");
  const [addColLoading, setAddColLoading] = useState(false);

  // ── Member panel ──────────────────────────────────────────────────────────
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<BoardMember[]>([]);

  // ── Invite state (Phase 4 — token-based invites) ──────────────────────────
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  // ── Copy board ID ─────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  function copyBoardId() {
    if (!boardId) return;
    navigator.clipboard.writeText(boardId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Derive the current user's role on this board ──────────────────────────
  // Used for both the client-side defense-in-depth role guards in useYjsBoard
  // AND to conditionally hide mutation UI (add column/card, drag-and-drop).
  const myRole = restData?.members?.find((m) => m.user_id === user?.user_id)?.role ?? null;

  // ── Yjs hook ──────────────────────────────────────────────────────────────
  // userId and userName are passed so the hook can set the Awareness local
  // state (presence) and attribute comments to the correct author.
  const {
    columnOrder,
    columns,
    cardOrderByColumn,
    cards,
    commentsByCard,
    moveCard,
    updateCardField,
    addCard,
    addComment,
    provider,
    localSynced,
    doc,
    connectedUsers,
    setAwarenessEditingCard,
  } = useYjsBoard(
    boardId ?? "",
    WS_BASE_URL,
    token ?? "",
    myRole,
    user?.user_id ?? "",
    user?.name ?? ""
  );

  // ── Connection status (driven by y-websocket provider events) ─────────────
  // wsStatus mirrors provider's internal status string. We read it on mount
  // so the initial render is correct, then subscribe to 'status' events.
  const [wsStatus, setWsStatus] = useState<"connected" | "connecting" | "disconnected">(
    () => (provider.wsconnected ? "connected" : "disconnected")
  );
  // isManuallyOffline tracks whether the user explicitly hit "Go Offline".
  // We keep this separate from wsStatus because the provider may briefly
  // report "connecting" after a reconnect call, and we want the button
  // label to reflect user intent, not the transient state.
  const [isManuallyOffline, setIsManuallyOffline] = useState(false);
  // Guard ref so we don't call setState on an unmounted component
  // (edge case: user navigates away while the provider fires a final event).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const handleStatus = (event: { status: "connected" | "connecting" | "disconnected" }) => {
      if (mountedRef.current) setWsStatus(event.status);
    };
    provider.on("status", handleStatus);
    // Sync initial state in case the provider connected between render and effect.
    setWsStatus(provider.wsconnected ? "connected" : "disconnected");
    return () => {
      mountedRef.current = false;
      provider.off("status", handleStatus);
    };
  }, [provider]);

  function handleOfflineToggle() {
    if (isManuallyOffline) {
      // Go back online: re-establish the WebSocket.
      provider.connect();
      setIsManuallyOffline(false);
    } else {
      // Go offline: tear down the WebSocket (Yjs sees this identically to
      // an actual network drop). Local edits keep writing to the Y.Doc
      // and are persisted to IndexedDB by y-indexeddb.
      provider.disconnect();
      setIsManuallyOffline(true);
    }
  }

  // ── Initial REST fetch (board name, members list) ─────────────────────────
  useEffect(() => {
    if (!token || !boardId) {
      navigate("/login");
      return;
    }
    setRestLoading(true);
    getBoard(boardId, token)
      .then((data) => {
        setRestData(data);
        setMembers(data.members);
        setRestError(null);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load board";
        if (msg.includes("403") || msg.includes("401")) {
          navigate("/login");
        } else {
          setRestError(msg);
        }
      })
      .finally(() => setRestLoading(false));
  }, [boardId, token, navigate]);

  // ── DnD state ─────────────────────────────────────────────────────────────
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  // Track which column the active card is currently over during a drag
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function findColumnForCard(cardId: string): string | null {
    for (const [colId, cardIds] of Object.entries(cardOrderByColumn)) {
      if (cardIds.includes(cardId)) return colId;
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveCardId(id);
    setOverColumnId(findColumnForCard(id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) return;

    const overId = String(over.id);

    // Determine what column we're over
    // over.id can be a column id OR a card id
    const targetColumnId = columns[overId]
      ? overId // hovering directly over a column
      : findColumnForCard(overId) ?? overColumnId; // hovering over a card in a column

    if (targetColumnId && targetColumnId !== overColumnId) {
      setOverColumnId(targetColumnId);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    setActiveCardId(null);

    if (!over) {
      setOverColumnId(null);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    const fromColumnId = findColumnForCard(activeId);
    if (!fromColumnId) {
      setOverColumnId(null);
      return;
    }

    // Determine toColumnId: over.id is either a column or a card
    const toColumnId = columns[overId]
      ? overId
      : findColumnForCard(overId) ?? fromColumnId;

    // Determine toIndex
    const toCardIds = cardOrderByColumn[toColumnId] ?? [];

    let toIndex: number;
    if (columns[overId]) {
      // Dropped onto the column header/background → append at end
      toIndex = toCardIds.length;
      // But if moving within same column, don't duplicate
      if (fromColumnId === toColumnId) {
        toIndex = toCardIds.length - 1;
      }
    } else {
      // Dropped onto another card → place before/after it
      const overIndex = toCardIds.indexOf(overId);
      toIndex = overIndex === -1 ? toCardIds.length : overIndex;
    }

    // Clamp toIndex for intra-column moves (the card is still in the array)
    if (fromColumnId === toColumnId) {
      const fromIndex = toCardIds.indexOf(activeId);
      // arrayMove to find the correct final index (mirrors dnd-kit convention)
      const reordered = arrayMove(toCardIds, fromIndex, toIndex);
      toIndex = reordered.indexOf(activeId);
    }

    moveCard(activeId, fromColumnId, toColumnId, toIndex);
    setOverColumnId(null);
  }

  // ── Add Card handler ──────────────────────────────────────────────────────
  const handleAddCard = useCallback(
    (columnId: string, title: string) => {
      addCard(columnId, {
        id: crypto.randomUUID(),
        title,
        description: "",
        assigneeId: null,
      });
    },
    [addCard]
  );

  // ── Add Column handler ────────────────────────────────────────────────────
  async function handleAddColumn(e: FormEvent) {
    e.preventDefault();
    if (!token || !boardId) return;
    const trimmed = newColTitle.trim();
    if (!trimmed) return;

    setAddColLoading(true);
    try {
      const col = await createColumn(boardId, trimmed, token);
      doc.transact(() => {
        const columnsMap = doc.getMap("columns");
        if (!columnsMap.get(col.id)) {
          columnsMap.set(col.id, { id: col.id, title: col.title });
        }
      });
      setNewColTitle("");
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to add column");
    } finally {
      setAddColLoading(false);
    }
  }

  // ── Invite Member handler (Phase 4 — token-based) ─────────────────────────
  async function handleInviteMember(e: FormEvent) {
    e.preventDefault();
    if (!token || !boardId) return;
    setInviteLink(null);
    setInviteLinkCopied(false);
    setInviteLoading(true);
    try {
      const data = await createInvite(boardId, inviteEmail, inviteRole, token);
      addToast("success", `Invite created for ${inviteEmail} as ${inviteRole}`);
      setInviteLink(data.inviteLink);
      setInviteEmail("");
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setInviteLoading(false);
    }
  }

  function copyInviteLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setInviteLinkCopied(true);
      setTimeout(() => setInviteLinkCopied(false), 2000);
    });
  }

  // ── Card detail modal ──────────────────────────────────────────────────────
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const detailCard = detailCardId ? cards[detailCardId] : null;
  const detailComments = detailCardId ? (commentsByCard[detailCardId] ?? []) : [];

  const handleOpenDetail = useCallback((cardId: string) => {
    setDetailCardId(cardId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailCardId(null);
  }, []);

  const handleDetailUpdateField = useCallback(
    <K extends keyof import("../hooks/useYjsBoard").CardData>(
      field: K,
      value: import("../hooks/useYjsBoard").CardData[K]
    ) => {
      if (!detailCardId) return;
      updateCardField(detailCardId, field, value);
    },
    [detailCardId, updateCardField]
  );

  const handleDetailAddComment = useCallback(
    (text: string) => {
      if (!detailCardId) return;
      addComment(detailCardId, text);
    },
    [detailCardId, addComment]
  );

  // ── Awareness: build editingByUser map ───────────────────────────────────
  // For each connected user that has set an editingCardId in their awareness
  // state, map cardId → their name. A peer editing their own card overrides
  // their own previous entry (last write wins, one user per card display).
  // We exclude "self" from the editing indicator (you know you're editing).
  const editingByUser = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const u of connectedUsers) {
      if (u.userId === user?.user_id) continue; // skip self
      if (u.editingCardId) {
        map[u.editingCardId] = u.name;
      }
    }
    return map;
  }, [connectedUsers, user?.user_id]);

  // ── Active card data for DragOverlay ──────────────────────────────────────
  const activeCard = activeCardId ? cards[activeCardId] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  if (restLoading) {
    return (
      <div className="board-loading">
        <p className="board-loading-brand">Kanban Sync</p>
        <div className="spinner" />
        <p>Loading board…</p>
      </div>
    );
  }

  if (restError) {
    return (
      <div className="board-error">
        <p>Error: {restError}</p>
        <Link to="/boards">← Back to boards</Link>
      </div>
    );
  }

  return (
    <div className="board-page">
      {/* Board header */}
      <header className="board-header">
        <div className="board-header-left">
          <Link to="/boards" className="back-link">← Boards</Link>
          <h1 className="board-name">{restData?.board.name ?? "Board"}</h1>
          <button
            id="copy-board-id-btn"
            className="board-id-pill"
            onClick={copyBoardId}
            title="Click to copy Board ID"
          >
            <span className="board-id-label">ID</span>
            <code className="board-id-value">{boardId?.slice(0, 8)}…</code>
            <span className="board-id-copy-icon">{copied ? "✓ Copied" : "Copy"}</span>
          </button>
        </div>
        <div className="board-header-right">
          {/* Connection status + offline toggle ─────────────────────────── */}
          <div className="conn-status-group">
            {/* Local cache indicator */}
            {!localSynced && (
              <span className="conn-local-loading" title="Loading local cache…">
                <span className="conn-local-spinner" />Local cache…
              </span>
            )}
            {/* WebSocket status pill */}
            <span
              className={`conn-status-pill conn-status-pill--${
                isManuallyOffline ? "offline" : wsStatus
              }`}
              title={isManuallyOffline ? "Manually disconnected" : `WebSocket: ${wsStatus}`}
            >
              <span className="conn-status-dot" />
              {isManuallyOffline ? "Offline" : wsStatus === "connected" ? "Connected" : wsStatus === "connecting" ? "Connecting…" : "Disconnected"}
            </span>
            {/* Offline/Online toggle */}
            <button
              id="offline-toggle-btn"
              className={`btn-ghost btn-sm offline-toggle-btn${
                isManuallyOffline ? " offline-toggle-btn--offline" : ""
              }`}
              onClick={handleOfflineToggle}
              title={isManuallyOffline ? "Reconnect to server" : "Simulate going offline"}
            >
              {isManuallyOffline ? "Go Online" : "Go Offline"}
            </button>
          </div>

          {/* ── Presence avatar strip (Phase 5) ────────────────────────── */}
          {connectedUsers.length > 0 && (
            <div className="presence-avatars" aria-label="Connected users">
              {connectedUsers.map((u) => {
                const initials = u.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                const isSelf = u.userId === user?.user_id;
                return (
                  <span
                    key={u.userId}
                    className={`presence-avatar${isSelf ? " presence-avatar--self" : ""}`}
                    title={isSelf ? `${u.name} (you)` : u.name}
                    aria-label={isSelf ? `${u.name} (you)` : u.name}
                  >
                    {initials}
                  </span>
                );
              })}
            </div>
          )}

          <button
            id="toggle-members-btn"
            className="btn-ghost btn-sm"
            onClick={() => setShowMembers((v) => !v)}
          >
            {showMembers ? "▲ Members" : `▼ Members (${members.length})`}
          </button>
          <span className="board-user-badge">{user?.name}</span>
          <button id="board-logout-btn" className="btn-ghost btn-sm" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* Members panel — list + invite form */}
      {showMembers && (
        <div className="members-panel" id="members-panel">
          <div className="members-panel-inner">

            {/* Current members */}
            <div className="members-section">
              <p className="members-section-title">Members ({members.length})</p>
              <ul className="members-list">
                {members.map((m) => (
                  <li key={m.user_id} className="member-item">
                    <span className="member-name">{m.name}</span>
                    <span className="member-email">{m.email}</span>
                    <span className={`member-role member-role--${m.role}`}>{m.role}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Invite new member — only for owners/editors */}
            {myRole !== "viewer" && (
            <div className="members-invite">
              <p className="members-section-title">Invite someone</p>
              <form onSubmit={handleInviteMember} className="invite-form" id="invite-member-form">
                <input
                  id="invite-email-input"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  required
                />
                <select
                  id="invite-role-select"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  id="invite-submit-btn"
                  type="submit"
                  className="btn-primary btn-sm"
                  disabled={inviteLoading}
                >
                  {inviteLoading ? "Creating…" : "Create Invite"}
                </button>
              </form>
              {inviteLink && (
                <div className="invite-link-box">
                  <code className="invite-link-url">{inviteLink}</code>
                  <button
                    id="copy-invite-link-btn"
                    className="btn-ghost btn-sm"
                    onClick={copyInviteLink}
                    type="button"
                  >
                    {inviteLinkCopied ? "✓ Copied!" : "Copy Link"}
                  </button>
                </div>
              )}
            </div>
            )}

          </div>
        </div>
      )}


      {/* Add Column bar — hidden for viewers (they're read-only) */}
      {myRole !== "viewer" && (
      <div className="add-column-bar">
        <form onSubmit={handleAddColumn} className="inline-form" id="add-column-form">
          <input
            id="new-col-title-input"
            type="text"
            value={newColTitle}
            onChange={(e) => setNewColTitle(e.target.value)}
            placeholder="New column title"
            required
          />
          <button
            id="add-column-btn"
            type="submit"
            className="btn-secondary btn-sm"
            disabled={addColLoading}
          >
            {addColLoading ? "Adding…" : "+ Column"}
          </button>
        </form>
      </div>
      )}

      {/* Viewer badge */}
      {myRole === "viewer" && (
        <div className="viewer-badge">
          <span>View-only — you cannot edit this board</span>
        </div>
      )}

      {/* The board itself */}
      <div className="board-canvas">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="columns-row">
            {columnOrder.length === 0 && !restLoading && (
              <div className="board-empty">
                <p>No columns yet. Add one above, or wait for a peer to sync.</p>
              </div>
            )}

            {columnOrder.map((colId) => {
              const col = columns[colId];
              if (!col) return null;
              const cardIds = cardOrderByColumn[colId] ?? [];
              return (
                <BoardColumn
                  key={colId}
                  columnId={colId}
                  title={col.title}
                  cardIds={cardIds}
                  cards={cards}
                  onTitleChange={(cardId, newTitle) =>
                    updateCardField(cardId, "title", newTitle)
                  }
                  onAddCard={handleAddCard}
                  activeCardId={activeCardId}
                  onOpenDetail={handleOpenDetail}
                  editingByUser={editingByUser}
                  canEdit={myRole !== "viewer"}
                  onEditingStart={setAwarenessEditingCard}
                  onEditingEnd={() => setAwarenessEditingCard(null)}
                  commentsByCard={commentsByCard}
                />
              );
            })}
          </div>

          {/* Drag overlay — renders the card preview while dragging */}
          <DragOverlay>
            {activeCard ? (
              <div className="card-drag-overlay">
                <span className="card-drag-handle">⠿</span>
                <span className="card-title">{activeCard.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Card detail modal — rendered as a portal over everything */}
      {detailCard && (
        <CardDetailModal
          card={detailCard}
          members={members}
          comments={detailComments}
          isViewer={myRole === "viewer"}
          onClose={handleCloseDetail}
          onUpdateField={handleDetailUpdateField}
          onAddComment={handleDetailAddComment}
        />
      )}
    </div>
  );
}
