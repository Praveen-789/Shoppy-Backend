# Graceful shutdown

When the running backend receives SIGINT (normally Ctrl+C) or SIGTERM (commonly
sent by a hosting service), it closes in this order:

1. Stop accepting new HTTP connections with server.close().
2. Wait for active HTTP responses to finish. MongoDB stays connected during this step.
3. Disconnect Mongoose from MongoDB.
4. Flush queued file logs.
5. Let Node exit naturally with exit code 0.

services/gracefulShutdown.js owns this sequence. server.js installs it for the
actual server started by npm start or npm run dev. Importing the Express app in
smoke tests does not install global signal handlers.

Repeated signals reuse the same shutdown. A 15-second deadline covers the entire
sequence; if it expires, connections are forcibly closed and the process exits
with code 1. Cleanup failures also exit with code 1. Server listen errors trigger
the same cleanup with a failure exit code, so a port conflict does not leave the
MongoDB connection keeping the process alive.

Graceful shutdown gives active requests time to return a response. It cannot
protect against power loss or forced termination, and a request exceeding the
deadline can still be interrupted. Checkout transactions and idempotent retries
remain necessary. Restart tools and Windows process termination may force-stop
Node without sending either supported signal; use Ctrl+C with npm start for the
normal interactive shutdown path.

Run npm run test:shutdown. The test uses a real local HTTP server to prove that
an active response finishes before database/log cleanup and new connections are
refused. It also checks repeated signals, cleanup errors, and deadlines during
HTTP draining, database disconnect and log flushing, without touching MongoDB.
