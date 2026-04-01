export function createLogger() {
  const now = () => new Date().toISOString();

  return {
    info(message, extra = undefined) {
      if (extra === undefined) {
        console.log(`[${now()}] INFO  ${message}`);
        return;
      }
      console.log(`[${now()}] INFO  ${message}`, extra);
    },
    warn(message, extra = undefined) {
      if (extra === undefined) {
        console.warn(`[${now()}] WARN  ${message}`);
        return;
      }
      console.warn(`[${now()}] WARN  ${message}`, extra);
    },
    error(message, extra = undefined) {
      if (extra === undefined) {
        console.error(`[${now()}] ERROR ${message}`);
        return;
      }
      console.error(`[${now()}] ERROR ${message}`, extra);
    },
  };
}
