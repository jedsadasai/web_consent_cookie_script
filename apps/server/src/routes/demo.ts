import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/** Demo host page with a strict nonce-based CSP, proving the widget needs no 'unsafe-inline'. */
export async function demoRoutes(app: FastifyInstance, opts: { dir: string }): Promise<void> {
  const [page, frame] = await Promise.all([
    readFile(join(opts.dir, 'index.html'), 'utf8'),
    readFile(join(opts.dir, 'frame.html'), 'utf8'),
  ]);

  const withNonce = (html: string) => {
    const nonce = randomBytes(16).toString('base64');
    return { nonce, html: html.split('__NONCE__').join(nonce) };
  };

  app.get('/', (_req, reply) => reply.redirect('/demo'));

  app.get('/demo', (_req, reply) => {
    const { nonce, html } = withNonce(page);
    return reply
      .header(
        'content-security-policy',
        [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonce}'`,
          `style-src 'self' 'nonce-${nonce}'`,
          "img-src 'self' data:",
          "connect-src 'self'",
          "frame-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; '),
      )
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html);
  });

  app.get('/demo/frame', (_req, reply) => {
    const { nonce, html } = withNonce(frame);
    return reply
      .header('content-security-policy', `default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors 'self'`)
      .header('x-frame-options', 'SAMEORIGIN')
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html);
  });
}
