/**
 * useYjsBoard.ts
 *
 * The Yjs <-> React binding layer for the collaborative Kanban board.
 *
 * WHY THIS FILE IS THE HARD PART:
 * Yjs is a mutable CRDT that gets updated by network messages, IndexedDB
 * hydration, and local edits -- all outside React's render cycle. React
 * wants immutable snapshots it can diff. This hook is the adapter between
 * those two worlds. Every decision below exists to avoid one of two
 * failure modes: (a) stale UI that doesn't reflect remote edits, or
 * (b) infinite render loops / tearing from snapshot instability.
 */

import { useSyncExternalStore, useCallback, useMemo, useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";

// ---------------------------------------------------------------------------
// 1. Y.Doc LIFECYCLE MANAGEMENT
// ---------------------------------------------------------------------------
// WHY a module-level registry instead of creating the doc inside the hook:
// A Y.Doc owns the WebSocket connection for a board. If we created it in
// the component body (or naively in useEffect), every remount -- including
// React StrictMode's deliberate double-invoke in dev -- would tear down and
// re-establish the socket. Multiple components on the same page (board view
// + a sidebar widget, say) would also each open their OWN socket to the
// same room, which is wasteful and can cause update ordering weirdness.
//
// Instead: one Y.Doc + one WebsocketProvider per boardId, shared across
// every component that asks for it, reference-counted so it's torn down
// only when the last consumer unmounts.

interface BoardConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  // Persists the Y.Doc state to IndexedDB so offline edits survive a
  // browser refresh and are merged back with the server on reconnect.
  idbPersistence: IndexeddbPersistence;
  refCount: number;
}

const boardConnections = new Map<string, BoardConnection>();

function acquireBoardConnection(
  boardId: string,
  wsUrl: string,
  token: string
): BoardConnection {
  let conn = boardConnections.get(boardId);
  if (conn) {
    conn.refCount += 1;
    return conn;
  }

  const doc = new Y.Doc();
  // boardId is the WebSocket "room" key -- this is what makes two browser
  // tabs on the same board actually land in the same sync session.
  const provider = new WebsocketProvider(wsUrl, boardId, doc, {
    params: { token }, // sent as a query param; server validates + attaches RBAC role
  });

  // IndexedDB persistence: persists the Y.Doc locally so the client can
  // keep editing while offline and merge back when the WebSocket reconnects.
  // The DB name is namespaced to avoid any collision with other IndexedDB
  // users in the same origin. IndexedDB hydration and WebSocket sync BOTH
  // run concurrently on this same doc -- Yjs's CRDT merge reconciles them
  // automatically. We intentionally do NOT sequence one before the other.
  const idbPersistence = new IndexeddbPersistence(`kanban-board-${boardId}`, doc);

  conn = { doc, provider, idbPersistence, refCount: 1 };
  boardConnections.set(boardId, conn);
  return conn;
}

function releaseBoardConnection(boardId: string) {
  const conn = boardConnections.get(boardId);
  if (!conn) return;
  conn.refCount -= 1;
  if (conn.refCount <= 0) {
    conn.provider.destroy();      // closes the WebSocket cleanly
    conn.idbPersistence.destroy(); // closes the IndexedDB connection
    conn.doc.destroy();
    boardConnections.delete(boardId);
  }
}

// ---------------------------------------------------------------------------
// 2. DATA SHAPE ON THE Y.Doc
// ---------------------------------------------------------------------------
// Matches Section 5 of the spec:
// - Y.Map for column/card CONTENT (keyed by id) -- concurrent edits to
//   different fields of different cards merge trivially field-by-field.
// - Y.Array for ORDER -- column order, and card order within a column --
//   because reordering is the exact case where two users acting
//   concurrently (both dragging at once) is common, and Y.Array's move
//   semantics handle that without a central lock.

interface CardData {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
}

interface ColumnData {
  id: string;
  title: string;
}

interface BoardSnapshot {
  columnOrder: string[];
  columns: Record<string, ColumnData>;
  cardOrderByColumn: Record<string, string[]>;
  cards: Record<string, CardData>;
}

function getYTypes(doc: Y.Doc) {
  return {
    columnsMap: doc.getMap<ColumnData>("columns"),
    columnOrderArr: doc.getArray<string>("columnOrder"),
    cardsMap: doc.getMap<CardData>("cards"),
    // one Y.Array per column for that column's card order, stored in a
    // parent Y.Map keyed by columnId so it survives column add/remove
    cardOrderMap: doc.getMap<Y.Array<string>>("cardOrderByColumn"),
  };
}

// ---------------------------------------------------------------------------
// 3. SNAPSHOT DERIVATION -- the referential-stability trap
// ---------------------------------------------------------------------------
// useSyncExternalStore requires getSnapshot() to return the SAME reference
// across calls unless something actually changed (it does Object.is
// comparison to decide whether to re-render). If getSnapshot rebuilds a
// fresh plain object from the Yjs types on every call, React sees a "new"
// value every single render and either loops or re-renders constantly.
//
// Fix: derive the plain-JS snapshot ONCE per actual Yjs change event, cache
// it, and hand back the cached reference on every getSnapshot() call until
// the next real change invalidates it.

function deriveSnapshot(doc: Y.Doc): BoardSnapshot {
  const { columnsMap, columnOrderArr, cardsMap, cardOrderMap } =
    getYTypes(doc);

  // Pass 1 — authoritative order from the server-seeded Y.Array.
  // Only the server's idempotent seed (wsServer.js) ever pushes to this
  // array. Clients stopped pushing here to eliminate the "same ID, two
  // Yjs items" duplicate that caused divergent per-peer orderings.
  // We deduplicate and skip any ID whose columnsMap entry hasn't arrived
  // yet (transient gap during a multi-message merge).
  const seenCols = new Set<string>();
  const columnOrder: string[] = [];

  for (const id of columnOrderArr.toArray()) {
    if (!seenCols.has(id) && columnsMap.get(id)) {
      seenCols.add(id);
      columnOrder.push(id);
    }
  }

  // Pass 2 — columnsMap fallback for columns not yet in columnOrderArr.
  // Two cases land here:
  //   a) Column created while ONLINE: REST succeeded and columnsMap was
  //      updated locally, but the server only adds to columnOrderArr on a
  //      new WS connection event (the seed). The column is visible here
  //      immediately and migrates to Pass 1 on the next reconnect.
  //   b) Column created while OFFLINE: same — REST succeeded, columnsMap
  //      updated; columnOrderArr will be populated by the server on
  //      reconnect in correct Postgres position order.
  for (const [id] of columnsMap.entries()) {
    if (!seenCols.has(id)) {
      seenCols.add(id);
      columnOrder.push(id);
    }
  }

  const cardOrderByColumn: Record<string, string[]> = {};
  cardOrderMap.forEach((arr, columnId) => {
    const seenCards = new Set<string>();
    cardOrderByColumn[columnId] = arr.toArray().filter((id) => {
      if (seenCards.has(id)) return false;
      seenCards.add(id);
      return true;
    });
  });

  // Guarantee every column has a cardOrderByColumn entry so the renderer
  // never receives undefined for cardIds.
  for (const id of columnOrder) {
    if (!cardOrderByColumn[id]) cardOrderByColumn[id] = [];
  }

  // Cross-column dedup for concurrent moves: when two offline clients
  // move the same card to different columns, Yjs Y.Array inserts from
  // BOTH clients survive the CRDT merge — the card's ID ends up in two
  // columns' order arrays simultaneously. The card's canonical column is
  // determined by cardsMap (Y.Map LWW — deterministic, both peers agree).
  // Filter stale entries from the "losing" column so the card appears
  // only in its authoritative column.
  for (const colId of Object.keys(cardOrderByColumn)) {
    cardOrderByColumn[colId] = cardOrderByColumn[colId].filter((cardId) => {
      const card = cardsMap.get(cardId);
      // Keep if: card data hasn't arrived yet (transient) OR columnId matches
      return !card || card.columnId === colId;
    });
  }

  return {
    columnOrder,
    columns: Object.fromEntries(columnsMap.entries()),
    cardOrderByColumn,
    cards: Object.fromEntries(cardsMap.entries()),
  };
}

function createSnapshotCache(doc: Y.Doc) {
  let cached: BoardSnapshot = deriveSnapshot(doc);
  return {
    get: () => cached,
    invalidate: () => {
      cached = deriveSnapshot(doc);
    },
  };
}

// ---------------------------------------------------------------------------
// 4. THE HOOK
// ---------------------------------------------------------------------------

export function useYjsBoard(
  boardId: string,
  wsUrl: string,
  token: string,
  role: "owner" | "editor" | "viewer" | null = null
) {
  const { doc, provider, idbPersistence } = useMemo(
    () => acquireBoardConnection(boardId, wsUrl, token),
    [boardId, wsUrl, token]
  );

  // localSynced: true once IndexedDB has finished loading whatever was
  // previously persisted into this doc. The UI uses this to distinguish
  // "still hydrating from local cache" from "connected to server."
  const [localSynced, setLocalSynced] = useState(
    // If the persistence object is already synced (e.g. shared connection
    // being re-used), initialise true immediately rather than waiting for
    // an event that will never fire again.
    () => idbPersistence.synced
  );

  useEffect(() => {
    // The 'synced' event fires exactly once, after the initial IndexedDB
    // load completes. If it already fired before this effect ran (because
    // this is a re-used shared connection), the useState initialiser above
    // already captured it -- no event needed.
    if (idbPersistence.synced) {
      setLocalSynced(true);
      return;
    }
    const onSynced = () => setLocalSynced(true);
    idbPersistence.once("synced", onSynced);
    // No cleanup needed: .once() removes the listener after it fires.
    // Even if the component unmounts first, a stale setState is a no-op in React 18.
  }, [idbPersistence]);

  // Release the connection's ref count when this component unmounts or
  // boardId changes -- mirrors the acquire above.
  useEffect(() => {
    return () => releaseBoardConnection(boardId);
  }, [boardId]);

  const cacheRef = useMemo(() => createSnapshotCache(doc), [doc]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // observeDeep, not observe: a change to a nested Y.Map's value (e.g.
      // editing a card's title inside cardsMap) needs to notify us even
      // though cardsMap's own top-level entries "look" unchanged.
      const { columnsMap, columnOrderArr, cardsMap, cardOrderMap } =
        getYTypes(doc);

      const handler = () => {
        cacheRef.invalidate(); // recompute the plain-JS snapshot ONCE here
        onStoreChange(); // then tell React a new snapshot is available
      };

      columnsMap.observeDeep(handler);
      columnOrderArr.observe(handler);
      cardsMap.observeDeep(handler);
      cardOrderMap.observeDeep(handler);

      return () => {
        columnsMap.unobserveDeep(handler);
        columnOrderArr.unobserve(handler);
        cardsMap.unobserveDeep(handler);
        cardOrderMap.unobserveDeep(handler);
      };
    },
    [doc, cacheRef]
  );

  const getSnapshot = useCallback(() => cacheRef.get(), [cacheRef]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // -------------------------------------------------------------------------
  // 5. MUTATIONS -- local edits flowing INTO the Yjs doc
  // -------------------------------------------------------------------------
  // Every mutation is wrapped in doc.transact(). This isn't just style:
  // transact() batches the resulting Yjs updates into a single network
  // message and a single set of observer callbacks, instead of firing one
  // update per field write. For moveCard below, which touches two
  // Y.Arrays, that batching is what prevents observers (and remote peers)
  // from ever seeing the "half-moved" intermediate state.
  //
  // NOTE on RBAC (Section 6 of the spec): the viewer-cannot-mutate check
  // belongs here, at the single choke point every mutation passes through
  // -- not scattered across every call site. Wire in the role check once
  // Phase 4 lands; stubbed as a TODO so the shape is obvious now.

  const isViewer = role === "viewer";

  const moveCard = useCallback(
    (cardId: string, fromColumnId: string, toColumnId: string, toIndex: number) => {
      if (isViewer) {
        console.warn("[useYjsBoard] moveCard blocked — viewer role cannot mutate");
        return;
      }
      doc.transact(() => {
        const { cardsMap, cardOrderMap } = getYTypes(doc);

        const fromArr = cardOrderMap.get(fromColumnId);
        if (!fromArr) return;

        // Lazily create the destination column's order array if it has
        // never held a card before (same pattern as addCard).
        let toArr = cardOrderMap.get(toColumnId);
        if (!toArr) {
          toArr = new Y.Array<string>();
          cardOrderMap.set(toColumnId, toArr);
        }

        const fromIndex = fromArr.toArray().indexOf(cardId);
        if (fromIndex === -1) return;

        fromArr.delete(fromIndex, 1);
        toArr.insert(toIndex, [cardId]);

        if (fromColumnId !== toColumnId) {
          const card = cardsMap.get(cardId);
          if (card) cardsMap.set(cardId, { ...card, columnId: toColumnId });
        }
      });
    },
    [doc, isViewer]
  );

  const updateCardField = useCallback(
    <K extends keyof CardData>(cardId: string, field: K, value: CardData[K]) => {
      if (isViewer) {
        console.warn("[useYjsBoard] updateCardField blocked — viewer role cannot mutate");
        return;
      }
      doc.transact(() => {
        const { cardsMap } = getYTypes(doc);
        const card = cardsMap.get(cardId);
        if (!card) return;
        cardsMap.set(cardId, { ...card, [field]: value });
      });
    },
    [doc, isViewer]
  );

  const addCard = useCallback(
    (columnId: string, card: Omit<CardData, "columnId">) => {
      if (isViewer) {
        console.warn("[useYjsBoard] addCard blocked — viewer role cannot mutate");
        return;
      }
      doc.transact(() => {
        const { cardsMap, cardOrderMap } = getYTypes(doc);
        cardsMap.set(card.id, { ...card, columnId });
        let orderArr = cardOrderMap.get(columnId);
        if (!orderArr) {
          orderArr = new Y.Array<string>();
          cardOrderMap.set(columnId, orderArr);
        }
        orderArr.push([card.id]);
      });
    },
    [doc, isViewer]
  );

  return {
    ...snapshot,
    moveCard,
    updateCardField,
    addCard,
    // localSynced: true once IndexedDB has finished hydrating the doc.
    // Distinct from WebSocket sync -- the client may be locally synced
    // but still connecting to the server (or fully offline).
    localSynced,
    // exposing provider + doc lets a presence/awareness hook (Phase 5)
    // hook into the same shared connection without re-deriving it.
    provider,
    doc,
  };
}