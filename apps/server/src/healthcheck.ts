// Docker HEALTHCHECK without curl/wget in the image.
const port = process.env.PORT ?? '8080';

fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2500) }).then(
  (res) => process.exit(res.ok ? 0 : 1),
  () => process.exit(1),
);
