import { mkdirSync, copyFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
mkdirSync(new URL('dist/', root), { recursive: true });
for (const file of ['index.html', 'styles.css', 'logo.svg', 'aniway-mark.svg']) copyFileSync(new URL(file, root), new URL(`dist/${file}`, root));
await build({
  entryPoints: [fileURLToPath(new URL('app.js',root))],
  outfile: fileURLToPath(new URL('dist/app.js',root)),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('Built Crunchy API Studio with GSAP, Framer Motion, and syntax highlighting.');
