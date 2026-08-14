/**
 * testWsClient.js
 *
 * Simulates two browser tabs connecting to the same board room, without
 * needing React yet. Client A writes a value into a shared Y.Map; Client B
 * should observe that change arrive over the WebSocket, proving the
 * server is actually relaying Yjs updates between peers -- not just
 * accepting connections.
 *
 * FILL IN BEFORE RUNNING:
 *   BOARD_ID -> a real board id you own (from your earlier /boards POST)
 *   TOKEN    -> a valid JWT for a user who is a MEMBER of that board
 *               (grab one from your /auth/login response)
 *
 * Run with: node testWsClient.js
 */

const Y = require("yjs");
const { WebsocketProvider } = require("y-websocket");
const WebSocket = require("ws"); // Node has no built-in WebSocket global (pre-v22-ish),
                                  // so y-websocket needs this passed explicitly below.

const WS_URL = "ws://localhost:4001";
const BOARD_ID = "9429f21d-b428-427a-b06c-5e7b79cb889a";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjYzI2Y2MxYi05MzUxLTQzOTEtOTEzOS04ZWYzZTZlMjc4NTIiLCJpYXQiOjE3ODY2OTQ4MzgsImV4cCI6MTc4NzI5OTYzOH0.ziqwDvqWm5cWRSbrS8Nv3l77BH9p-2QGbdR1v76EgsY";

function connectClient(label) {
  const doc = new Y.Doc();

  const provider = new WebsocketProvider(WS_URL, BOARD_ID, doc, {
    WebSocketPolyfill: WebSocket, // required in Node -- WebsocketProvider
                                   // expects `WebSocket` to exist globally,
                                   // which is only true in browsers by default.
    params: { token: TOKEN },
  });

  provider.on("status", (event) => {
    console.log(`[${label}] connection status: ${event.status}`); // "connecting" | "connected" | "disconnected"
  });

  provider.on("sync", (isSynced) => {
    console.log(`[${label}] synced: ${isSynced}`);
  });

  const testMap = doc.getMap("__test");
  testMap.observe(() => {
    console.log(`[${label}] observed change ->`, testMap.toJSON());
  });

  return { doc, provider, testMap };
}

const clientA = connectClient("A");
const clientB = connectClient("B");

// Give both clients a few seconds to connect and complete initial sync
// before A writes anything -- otherwise A's write could fire before B is
// even connected, and this test would falsely look broken.
setTimeout(() => {
  console.log("\n--- Client A writing a value ---\n");
  clientA.testMap.set("hello", `written by A at ${new Date().toISOString()}`);
}, 3000);

// Give the write time to propagate, then report pass/fail and exit.
setTimeout(() => {
  const aValue = clientA.testMap.get("hello");
  const bValue = clientB.testMap.get("hello");

  console.log("\n--- Result ---");
  console.log("Client A sees:", aValue);
  console.log("Client B sees:", bValue);

  if (aValue && aValue === bValue) {
    console.log("\n✅ SUCCESS -- B received A's update through the WebSocket server.");
  } else {
    console.log("\n❌ FAILED -- B did not receive A's update. Check server logs / token / boardId.");
  }

  clientA.provider.destroy();
  clientB.provider.destroy();
  process.exit(0);
}, 6000);