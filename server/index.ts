// ============================================================
// Custom server: HTTP + Next.js + Socket.IO
// ============================================================

import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { registerHandlers } from "./socket/handlers";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../shared/events";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handler);

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: dev ? { origin: "*" } : undefined,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
  });

  registerHandlers(io);

  httpServer.listen(port, () => {
    console.log(`> Tenable server ready on http://${hostname}:${port}`);
    console.log(`> Room Site:   http://${hostname}:${port}/room`);
    console.log(`> Player Site: http://${hostname}:${port}/play`);
  });
});
