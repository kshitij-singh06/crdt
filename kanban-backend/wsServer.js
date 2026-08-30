require("dotenv").config();

const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { setupWSConnection, getYDoc } = require("y-websocket/bin/utils");
const Y = require("yjs");
const { pool } = require("./db");

// ---------------------------------------------------------------------------
// Yjs wire-protocol constants (from y-protocols/sync)
// ---------------------------------------------------------------------------
// A Yjs WebSocket message is a binary frame whose first byte is the message
// CATEGORY:
//   0 = sync message (further sub-typed below)
//   1 = awareness message
//
// For category-0 (sync), the SECOND byte is the sync sub-type:
//   0 = SyncStep1  — "here is my state vector, tell me what I'm missing"
//   1 = SyncStep2  — "here are the structs/deletes you're missing" (a WRITE)
//   2 = Update     — an incremental document update (also a WRITE)
//
// Viewers must be allowed to send SyncStep1 (so they receive the current doc)
// and awareness messages, but BLOCKED from sending SyncStep2 and Update,
// which are the messages that mutate the server-side Y.Doc.
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

// ---------------------------------------------------------------------------
// RBAC message filter for viewer connections (Phase 4)
// ---------------------------------------------------------------------------
// WHY THIS APPROACH:
// setupWSConnection (y-websocket/bin/utils.js:237) does:
//   conn.binaryType = 'arraybuffer'
//   doc.conns.set(conn, new Set())
//   conn.on('message', message => messageListener(conn, doc, new Uint8Array(message)))
//
// It attaches its own 'message' listener via conn.on(). We CANNOT add a
// listener before it (EventEmitter fires listeners in registration order,
// and there's no way to "consume" an event and prevent later listeners from
// seeing it). Instead, we WRAP conn.on() itself: when setupWSConnection
// calls conn.on('message', originalHandler), our wrapper substitutes a
// filtering handler that inspects the message bytes BEFORE calling
// originalHandler -- dropping viewer mutations silently.
//
// CRITICAL: the wrapper ONLY intercepts 'message' event registration.
// All other events ('close', 'pong', 'error', etc.) pass through to the
// REAL EventEmitter.prototype.on untouched. This is essential -- if 'close'
// or 'pong' registrations were silently swallowed, the connection's ping
// interval would never clear (leaking timers) and doc.conns would never
// clean up (leaking memory and awareness state).
//
// The message parameter at fire-time is an ArrayBuffer (because
// setupWSConnection sets conn.binaryType = 'arraybuffer'). We wrap it in
// new Uint8Array(message) -- exactly as messageListener itself does --
// to safely read the category and sub-type bytes. The original handler
// still receives the raw ArrayBuffer, not our Uint8Array.

function wrapWsForViewer(ws) {
  const realOn = ws.on.bind(ws);

  ws.on = function(event, handler) {
    if (event !== "message") {
      // Pass through ALL non-message events untouched: close, pong, error,
      // ping, etc. Anything setupWSConnection or ws internals register.
      return realOn(event, handler);
    }

    // Wrap the 'message' handler with a filter that drops viewer mutations.
    const filteredHandler = (message) => {
      // message is an ArrayBuffer (conn.binaryType = 'arraybuffer').
      // Wrap in Uint8Array to read individual bytes safely.
      const data = new Uint8Array(message);

      if (data.length < 1) {
        // Empty/malformed message -- drop silently (nothing useful here).
        return;
      }

      const msgCategory = data[0];

      if (msgCategory === MSG_SYNC && data.length >= 2) {
        const syncType = data[1];
        if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
          // This is a mutation message from a viewer -- DROP it.
          console.log(
            `[ws][RBAC] Dropped sync message (sub-type ${syncType}) from viewer ${ws.userId} — viewers cannot send mutations`
          );
          return;
        }
        // SyncStep1 (syncType === 0) falls through — viewers need this to
        // receive the current doc state.
      }

      // Awareness messages (msgCategory === 1) and SyncStep1 pass through.
      handler(message);
    };

    return realOn("message", filteredHandler);
  };
}


const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.WS_PORT || 4001;

// WHY setupWSConnection instead of writing the Yjs sync protocol by hand:
// Yjs's wire protocol (sync step 1/2, update messages, awareness messages)
// is nontrivial to get right, and y-websocket ships a reference
// implementation of exactly that protocol as `setupWSConnection`. Per the
// spec (Section 4), using the y-websocket reference provider server-side
// is an explicitly sanctioned option -- the actual custom engineering
// here is the AUTH layer wrapped around it, not reimplementing Yjs's sync
// algorithm from scratch. `docName` passed to setupWSConnection is the
// "room" key -- clients connecting with the same docName share the same
// Y.Doc state and receive each other's updates.
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server-side Yjs seeding
// ---------------------------------------------------------------------------

/**
 * Fetches the board snapshot from Postgres and writes it into `doc` inside a
 * single Yjs transaction. Called at most once per room lifetime — subsequent
 * connections reuse the already-populated in-memory doc.
 */
async function seedDocFromPostgres(doc, boardId) {
  const colResult = await pool.query(
    "SELECT id, title, position FROM board_column WHERE board_id = $1 ORDER BY position",
    [boardId]
  );
  const cardResult = await pool.query(
    `SELECT c.id, c.column_id, c.title, c.description, c.assignee_id, c.position
     FROM card c
     JOIN board_column bc ON bc.id = c.column_id
     WHERE bc.board_id = $1
     ORDER BY c.position`,
    [boardId]
  );

  const columns = colResult.rows;
  const cards = cardResult.rows;

  if (columns.length === 0) return; // empty board — nothing to seed

  const columnsMap = doc.getMap("columns");
  const columnOrderArr = doc.getArray("columnOrder");
  const cardsMap = doc.getMap("cards");
  const cardOrderMap = doc.getMap("cardOrderByColumn");

  // Build fast-lookup sets of IDs already present in the Y.Arrays.
  // This makes seeding IDEMPOTENT: if IndexedDB already hydrated the
  // same data into this doc (possible when the client reconnects after
  // the server restarted and GC'd its in-memory room), we will NOT push
  // duplicate Y.Array entries -- duplicate string values with DIFFERENT
  // Yjs item identifiers are the root cause of the "all Account 1's cols
  // then all Account 2's cols" ordering bug.
  const existingColumnOrder = new Set(columnOrderArr.toArray());
  const existingCardOrders = {};
  cardOrderMap.forEach((arr, colId) => {
    existingCardOrders[colId] = new Set(arr.toArray());
  });

  doc.transact(() => {
    for (const col of columns) {
      // Idempotent: update the map value (Y.Map is LWW, safe to overwrite),
      // but only push to the order array if this column isn't already there.
      columnsMap.set(col.id, { id: col.id, title: col.title });
      if (!existingColumnOrder.has(col.id)) {
        columnOrderArr.push([col.id]);
      }

      const colCards = cards
        .filter((c) => c.column_id === col.id)
        .sort((a, b) => a.position - b.position);

      let orderArr = cardOrderMap.get(col.id);
      if (!orderArr) {
        orderArr = new Y.Array();
        cardOrderMap.set(col.id, orderArr);
      }
      const existingInCol = existingCardOrders[col.id] ?? new Set();

      for (const card of colCards) {
        cardsMap.set(card.id, {
          id: card.id,
          columnId: card.column_id,
          title: card.title,
          description: card.description ?? "",
          assigneeId: card.assignee_id ?? null,
        });
        if (!existingInCol.has(card.id)) {
          orderArr.push([card.id]);
        }
      }
    }
  });

  console.log(`[ws] Seeded room ${boardId} from Postgres (${columns.length} columns, ${cards.length} cards)`);
}

/**
 * Per-room lock: the first connection to call this sets an in-flight Promise
 * SYNCHRONOUSLY (before any await) so every subsequent connection that arrives
 * during the Postgres round-trip awaits the SAME promise instead of starting a
 * parallel seed. Once the seed resolves (or rejects), the lock is cleared so
 * the NEXT connection can run its own seed.
 *
 * WHY no fast-path "length > 0" check here:
 * The old fast path skipped the seed whenever columnOrderArr was non-empty.
 * This broke offline-first: if a client created columns via REST while offline
 * (so they exist in Postgres but only in columnsMap locally), and then
 * reconnected to a room that already had OTHER columns, the fast path fired and
 * the new offline columns were never added to columnOrderArr. They only appeared
 * via the columnsMap fallback in deriveSnapshot, in per-client insertion order,
 * causing divergent orderings (acc1 saw 1-3-2-4, acc2 saw 2-4-1-3).
 *
 * By always running the idempotent seed, every new connection ensures that all
 * Postgres columns are in columnOrderArr in the correct position order. The
 * idempotent check (existingColumnOrder.has) guarantees no duplicate pushes.
 * The only cost is one extra Postgres query per WS connection, which is
 * acceptable for this demo.
 */
const seedingPromises = new Map(); // boardId -> in-flight seed Promise

async function seedDocFromPostgresOnce(doc, boardId) {
  // Lock already held: another connection is mid-seed — wait for it.
  // We still return early here to avoid a second seed immediately after the
  // first finishes (the first seed's result already covers all Postgres rows).
  if (seedingPromises.has(boardId)) {
    await seedingPromises.get(boardId);
    return;
  }

  // We are the first — set the lock BEFORE the first await so any connection
  // arriving during the async Postgres call sees the lock already held.
  const seedPromise = seedDocFromPostgres(doc, boardId).finally(() => {
    seedingPromises.delete(boardId);
  });
  seedingPromises.set(boardId, seedPromise);
  await seedPromise;
}

const server = http.createServer();
const wss = new WebSocket.Server({ noServer: true });


// WHY we handle the WebSocket upgrade manually instead of just doing `new WebSocket.Server({ server })`:
// The default pattern accepts EVERY incoming connection at the WebSocket layer, with no way to reject before the handshake completes. We need to authenticate (valid JWT) and authorize (is this user a member of this board) BEFORE accepting the socket -- rejecting with a proper HTTP status code (401/403) at the upgrade stage, rather than accepting the connection and then just closing it, which is a worse signal for any client trying to distinguish "wrong password" from "network blip."
server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // The Yjs client (WebsocketProvider) connects to `${wsUrl}/${boardId}`,
    // so the room name arrives as the URL path -- strip the leading slash.
    const boardId = url.pathname.slice(1);
    const token = url.searchParams.get("token");

    if (!boardId || !token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const memberResult = await pool.query(
      "SELECT role FROM board_member WHERE board_id = $1 AND user_id = $2",
      [boardId, payload.userId]
    );

    if (memberResult.rows.length === 0) {
      // Not a member at all -- no read or write access to this board's room.
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const role = memberResult.rows[0].role;

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Stash the role on the socket itself. We're NOT yet using this to block writes -- viewers are intentionally allowed to connect and RECEIVE live updates (per spec Section 6, viewers see live state same as everyone else). Blocking a viewer's local mutations from being accepted server-side is Phase 4 work; this stash is what that future check will read.
      ws.userId = payload.userId;
      ws.role = role;
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    console.error("WebSocket upgrade error:", err);
    socket.destroy();
  }
});

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const boardId = url.pathname.slice(1);

  // Seed the room's Y.Doc from Postgres exactly once, before the client
  // receives any sync messages. getYDoc() returns the same in-memory doc
  // instance that setupWSConnection will use, so writes here are immediately
  // visible to the connecting client during the sync handshake.
  const doc = getYDoc(boardId);
  await seedDocFromPostgresOnce(doc, boardId);

  // Hands off the now-seeded, authenticated socket to y-websocket's
  // connection handler for the actual Yjs sync protocol work.
  //
  // RBAC (Phase 4): for viewer-role connections, wrap ws.on('message') so
  // that mutations (SyncStep2, Update) are silently dropped before they
  // reach y-websocket's messageListener — which would otherwise apply them
  // to the server's Y.Doc and broadcast them to all peers. The wrapper
  // leaves non-message events untouched so heartbeat/cleanup still works.
  if (ws.role === "viewer") {
    wrapWsForViewer(ws);
  }
  setupWSConnection(ws, req, { docName: boardId, gc: true });

});

server.listen(PORT, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});