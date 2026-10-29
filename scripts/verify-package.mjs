import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'crunchy-api-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const packed = JSON.parse(execFileSync(npm, ['pack', '--silent', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }))[0];
  const files = new Set(packed.files.map(file => file.path));
  for (const path of ['dist/index.js', 'dist/index.d.ts', 'src/index.ts', 'LICENSE', 'README.md']) {
    assert.ok(files.has(path), `Missing packaged file: ${path}`);
  }
  assert.ok(![...files].some(path => path.startsWith('test/') || path.startsWith('node_modules/')));
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], { cwd: temporary, stdio: 'pipe' });
  writeFileSync(join(temporary, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import { CrunchyrollClient, CrunchyrollApiError, CrunchyrollAuthError, CrunchyrollValidationError } from 'crunchy-api';
    assert.equal(new CrunchyrollClient().isAuthenticated(), false);
    assert.ok(new CrunchyrollAuthError('error') instanceof CrunchyrollApiError);
    assert.ok(new CrunchyrollValidationError('error') instanceof Error);
  `);
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'pipe' });
  writeFileSync(join(temporary, 'consumer.mts'), `
    import { CrunchyrollClient, type AuthSession, type WatchlistResponse, type SeriesInfo, type CrunchyrollRequestOptions, type PaginationOptions } from 'crunchy-api';
    const client = new CrunchyrollClient();
    const session: AuthSession = { accessToken: 'token', tokenType: 'Bearer' };
    client.setSession(session);
    const result: Promise<WatchlistResponse> = client.getWatchlist({ n: 25 });
    // @ts-expect-error Pagination must be numeric.
    client.getWatchlist({ n: '25' });
    const options: CrunchyrollRequestOptions = { signal: new AbortController().signal };
    const pagination: PaginationOptions = { maxPages: 2, ...options };
    const series: Promise<SeriesInfo> = client.getSeriesInfo('series', undefined, options);
    const iterator: AsyncGenerator = client.iterateWatchlist({}, pagination);
    void result; void series; void iterator;
  `);
  writeFileSync(join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' }, files: ['consumer.mts'] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', temporary], { cwd: temporary, stdio: 'pipe' });
  for (const path of [...files].filter(path => path.endsWith('.map'))) {
    const mapPath = join(temporary, 'node_modules/crunchy-api', path);
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    for (const source of map.sources) {
      readFileSync(fileURLToPath(new URL(source, pathToFileURL(mapPath))));
    }
  }
  console.log(`Verified ${packed.id}: installed ESM imports, TypeScript consumer, package contents, and source maps.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
