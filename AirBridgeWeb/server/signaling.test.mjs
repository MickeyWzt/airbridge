import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";

function responseTo(socket, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("No signaling response")), 3000);
    function finish(error, data) {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(JSON.parse(data.toString()));
    }
    function onMessage(data) { finish(null, data); }
    function onClose() { finish(new Error("Server closed before responding")); }
    socket.once("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", finish);
    socket.send(payload);
  });
}

test("malformed signaling messages leave the server and room usable", { timeout: 15000 }, async (t) => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist-server/server/index.js", import.meta.url))], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let logs = "";
  child.stdout.on("data", (data) => { logs += data; });
  child.stderr.on("data", (data) => { logs += data; });
  const closed = once(child, "close");
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    child.kill();
    await closed;
    if (logs.includes("TypeError")) t.diagnostic(logs);
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.equal(child.exitCode, null, logs);
    try {
      const health = await fetch(base + "/health", { signal: AbortSignal.timeout(500) });
      ready = (await health.json()).ok;
      if (ready) break;
    } catch { /* Wait for the child to listen. */ }
    await delay(50);
  }
  assert.ok(ready, logs);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/signal`);
  sockets.push(socket);
  await once(socket, "open");

  assert.equal((await responseTo(socket, "{")).code, "bad_json");
  for (const value of [null, false, 1, "text", [], {}, { type: null }]) {
    assert.equal((await responseTo(socket, JSON.stringify(value))).code, "bad_message");
  }
  for (const fields of [
    { roomCode: { toString: null }, nickname: "Alice" },
    { roomCode: "test", nickname: { toString: null } },
    { roomCode: "test", nickname: "Alice", peerId: { toString: null } }
  ]) {
    assert.equal((await responseTo(socket, JSON.stringify({ type: "join_room", ...fields }))).code, "bad_join");
  }
  assert.equal((await responseTo(socket, '{"type":"future_message"}')).code, "unknown_message");
  assert.equal((await responseTo(socket, '{"type":"join_room","roomCode":"","nickname":""}')).code, "bad_join");

  // A well-formed join must still work on the same connection after rejection.
  const snapshot = new Promise((resolve) => {
    function onMessage(data) {
      const message = JSON.parse(data.toString());
      if (message.type === "room_snapshot") {
        socket.off("message", onMessage);
        resolve(message);
      }
    }
    socket.on("message", onMessage);
  });
  const joined = await responseTo(socket, JSON.stringify({
    type: "join_room", roomCode: "maintenance", nickname: "Alice", peerId: "maintenance-one"
  }));
  assert.equal(joined.type, "joined");
  assert.equal(joined.selfPeerId, "maintenance-one");
  assert.equal((await snapshot).peers.length, 1);
  assert.equal((await (await fetch(base + "/health")).json()).rooms, 1);
  assert.equal(child.exitCode, null, logs);
});
