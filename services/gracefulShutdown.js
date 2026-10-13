// Keep shutdown separate from Express routes so it can be tested without MongoDB.
function installShutdown({ server, disconnect, flushLogs, timeoutMs = 15000, processRef = process }) {
  let shutdownPromise;
  function shutdown(reason, exitCode = 0) {
    // A second signal must not close MongoDB while requests are still running.
    if (shutdownPromise) return shutdownPromise;
    processRef.exitCode = exitCode;
    console.log(`Shutting down (${reason}). Waiting for active requests…`);
    const deadline = setTimeout(() => {
      console.error('Shutdown timed out. Forcing the server to stop.');
      server.closeAllConnections();
      processRef.exit(1);
    }, timeoutMs);
    shutdownPromise = (async () => {
      try {
        await new Promise((resolve, reject) => {
          // Stops new connections and waits for active HTTP responses to finish.
          server.close(error => {
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
            else resolve();
          });
        });
        await disconnect();
        await flushLogs();
        console.log('Shutdown complete. MongoDB disconnected and logs saved.');
      } catch {
        console.error('Shutdown failed. Forcing the server to stop.');
        processRef.exit(1);
      } finally {
        clearTimeout(deadline);
        processRef.removeListener('SIGINT', onInterrupt);
        processRef.removeListener('SIGTERM', onTerminate);
      }
    })();
    return shutdownPromise;
  }
  const onInterrupt = () => { void shutdown('SIGINT'); };
  const onTerminate = () => { void shutdown('SIGTERM'); };
  processRef.on('SIGINT', onInterrupt);
  processRef.on('SIGTERM', onTerminate);
  return shutdown;
}
module.exports = installShutdown;
