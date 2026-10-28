// Bundles the widget into a single self-contained IIFE (CSS inlined) and
// writes a manifest with the content hash + SRI integrity for the server.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(await readFile(root('./package.json'), 'utf8'));
const outDir = root('./dist');

/** Import `.css` files as a minified string. */
const cssAsText = {
  name: 'css-as-text',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { code } = await transform(source, { loader: 'css', minify: true, target: ['chrome90', 'safari14', 'firefox90'] });
      return { contents: `export default ${JSON.stringify(code.trim())};`, loader: 'js' };
    });
  },
};

const result = await build({
  entryPoints: [root('./src/index.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2018'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  write: false,
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/*! cookie-consent v${pkg.version} */` },
  plugins: [cssAsText],
});

const code = result.outputFiles[0].contents;

// The server swaps these literals for POLICY_URL and THEME; fail the build if minification changed their form.
for (const slot of ['"__CC_DEFAULT_POLICY_URL__"', '"__CC_DEFAULT_THEME__"']) {
  const slots = Buffer.from(code).toString('utf8').split(slot).length - 1;
  if (slots !== 1) throw new Error(`expected one ${slot} literal in the bundle, found ${slots}`);
}
const hash = createHash('sha256').update(code).digest('hex').slice(0, 16);
const integrity = `sha384-${createHash('sha384').update(code).digest('base64')}`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/consent.min.js`, code);
await writeFile(
  `${outDir}/consent.manifest.json`,
  JSON.stringify({ version: pkg.version, file: 'consent.min.js', hash, integrity, bytes: code.length }, null, 2),
);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`consent.min.js  ${kb(code.length)}  (gzip ${kb(gzipSync(code).length)})  ${integrity}`);
