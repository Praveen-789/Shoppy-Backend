# Learning Node.js through Shoppy

## Step 1: Trace HTTP requests (implemented)

Run `npm start` and open the shop. Every HTTP request produces one JSON log line
with its method, path, status, duration and a unique request ID. Browser developer
tools show the same ID in the `X-Request-Id` response header. Unexpected server
errors include that ID in their JSON response and error log, helping you match
the failure to its request.

Read `middleware/requestLogger.js` and its registration in `server.js`:

- `node:crypto` supplies `randomUUID()`; no extra package is needed.
- `process.hrtime.bigint()` measures elapsed time with a monotonic clock.
- HTTP responses emit `finish` when Node finishes sending the response and `close`
  when the connection closes. Neither guarantees the client received the data.
- `.once()` handles an event once; a guard prevents duplicate logs when both fire.
- An interrupted response has `completed: false` and a null status.
- Middleware runs in registration order. Logging comes before JSON parsing so
  invalid JSON is logged too.
- JSON logs are easy to search or feed into a log service. Bodies, cookies and
  query strings are deliberately omitted. Paths still appear, so don't place
  secrets in URL path segments. Raw exception messages are also omitted.

Run `npm run test:logging` for HTTP tests without needing MongoDB.
The existing error middleware handles malformed JSON, large bodies and unexpected
errors; it now also delegates errors after headers have already been sent.

## Saving logs to files

Request and unexpected request-error logs also go to `logs/shoppy-YYYY-MM-DD.log`.
The folder is created on the first logged request and is ignored by Git. Dates
in filenames and timestamps use UTC. Restart the backend after updating the code.
Startup messages still appear only in the terminal.

Read `services/logWriter.js` to learn `node:fs/promises`, `node:path`,
`Buffer.byteLength()` and Promise sequencing. File writes are asynchronous; a
Promise queue preserves their order without blocking request handling.

Each file is limited to 5 MB, with three rotating backups (`.1` is the newest).
Today and the previous six UTC days are retained; cleanup happens on the first
write of a new day. Only matching Shoppy log files are removed. A 1 MB queue limit
prevents slow disks from accumulating unlimited pending logs. Disk failures or
queue overflow leave terminal output available and print one warning per process.
An individual entry larger than the file limit is also terminal-only.

This writer supports one backend process. Writes are best effort: a forced exit
can lose pending entries. Multiple processes should use a shared logging service
or a logger designed for that setup. `flush()` is available for tests and future
graceful shutdown work.

Run `npm run test:log-files` to check ordering, size rotation, retention, date
changes and disk-failure handling. To watch today's file in PowerShell:

```powershell
Get-Content "D:\Shoppy\shoppy-node\logs\shoppy-$([DateTime]::UtcNow.ToString('yyyy-MM-dd')).log" -Tail 20 -Wait
```

## Next learning steps

1. Streaming vendor CSV exports: database cursors, async iteration, streams,
   backpressure and cancellation.
2. Graceful shutdown: process signals, stopping new requests and closing MongoDB.
3. Persistent background jobs: order notifications, retries and idempotency.
4. Live order progress: Server-Sent Events, connection cleanup and authorization.
5. Caching and performance: measure a bottleneck, then add expiry and invalidation.

Implement these separately so each feature has a clear purpose and a small enough
change to study. Worker threads can wait for actual CPU-heavy work.
