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

import { useSyncExternalStore, useCallback, useMemo, useEffect } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

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

  conn = { doc, provider, refCount: 1 };
  boardConnections.set(boardId, conn);
  return conn;
}

function releaseBoardConnection(boardId: string) {
  const conn = boardConnections.get(boardId);
  if (!conn) return;
  conn.refCount -= 1;
  if (conn.refCount <= 0) {
    conn.provider.destroy(); // closes the socket cleanly
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

  const cardOrderByColumn: Record<string, string[]> = {};
  cardOrderMap.forEach((arr, columnId) => {
    cardOrderByColumn[columnId] = arr.toArray();
  });

  return {
    columnOrder: columnOrderArr.toArray(),
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

export function useYjsBoard(boardId: string, wsUrl: string, token: string) {
  const { doc, provider } = useMemo(
    () => acquireBoardConnection(boardId, wsUrl, token),
    [boardId, wsUrl, token]
  );

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

  const moveCard = useCallback(
    (cardId: string, fromColumnId: string, toColumnId: string, toIndex: number) => {
      // TODO(Phase 4): if (currentUserRole === 'viewer') return;
      doc.transact(() => {
        const { cardsMap, cardOrderMap } = getYTypes(doc);

        const fromArr = cardOrderMap.get(fromColumnId);
        const toArr = cardOrderMap.get(toColumnId);
        if (!fromArr || !toArr) return;

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
    [doc]
  );

  const updateCardField = useCallback(
    <K extends keyof CardData>(cardId: string, field: K, value: CardData[K]) => {
      // TODO(Phase 4): if (currentUserRole === 'viewer') return;
      doc.transact(() => {
        const { cardsMap } = getYTypes(doc);
        const card = cardsMap.get(cardId);
        if (!card) return;
        cardsMap.set(cardId, { ...card, [field]: value });
      });
    },
    [doc]
  );

  const addCard = useCallback(
    (columnId: string, card: Omit<CardData, "columnId">) => {
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
    [doc]
  );

  return {
    ...snapshot,
    moveCard,
    updateCardField,
    addCard,
    // exposing provider + doc lets a presence/awareness hook (Phase 5)
    // and the future y-indexeddb wiring (Phase 3) hook into the same
    // shared connection without re-deriving it.
    provider,
    doc,
  };
}