// Construction : esbuild regroupe l'application dans dist/ (version multi-fichiers + version autonome trame.html).
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const serve = process.argv.includes('--serve');
const outdir = 'dist';
const options = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: !serve,
  sourcemap: serve,
  outdir,
  entryNames: 'app',
  loader: { '.svg': 'text' },
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
  logLevel: 'info',
};

const template = await readFile('template.html', 'utf8');
await mkdir(outdir, { recursive: true });
const tw = await postcss([tailwindcss({ content: ['./src/**/*.{ts,tsx}'], corePlugins: { preflight: false } })]).process(await readFile('src/ui/tailwind.input.css', 'utf8'), { from: 'src/ui/tailwind.input.css' });
await writeFile('src/ui/tailwind.generated.css', tw.css);

async function writeHtml() {
  const html = template
    .replace('<!--CSS-->', '<link rel="stylesheet" href="./app.css">')
    .replace('<!--JS-->', '<script type="module" src="./app.js"></script>');
  await writeFile(join(outdir, 'index.html'), html);
}

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await writeHtml();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
  const port = Number(process.env.PORT) || 5173;
  createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = join(outdir, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('Introuvable'); }
  }).listen(port, () => console.log(`\n  Trame est disponible sur http://localhost:${port}\n  (Ctrl+C pour arrêter)\n`));
} else {
  await esbuild.build(options);
  await writeHtml();
  // Version autonome : un seul fichier HTML, utilisable hors ligne en double-cliquant dessus.
  const js = (await readFile(join(outdir, 'app.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const css = await readFile(join(outdir, 'app.css'), 'utf8');
  const single = template
    .replace('<!--CSS-->', () => `<style>${css}</style>`)
    .replace('<!--JS-->', () => `<script type="module">${js}</script>`);
  await writeFile(join(outdir, 'trame.html'), single);
  await writeFile('index.html', single);
  console.log('dist/index.html, dist/app.js, dist/app.css et dist/trame.html (autonome) générés.');
}
