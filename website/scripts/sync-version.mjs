// Copies the product version from ../openide-version.json (the repository
// root) into src/lib/version.json so the website never drifts from the
// released product. Safe to run when the root file is unavailable (e.g. when
// the website is deployed from its own directory): it just keeps the copy.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', '..', 'openide-version.json');
const target = path.resolve(here, '..', 'src', 'lib', 'version.json');

if (!existsSync(source)) {
  console.log('[sync-version] openide-version.json not found, keeping the committed copy.');
  process.exit(0);
}

const root = JSON.parse(readFileSync(source, 'utf8'));
const next = {
  version: root.version,
  channel: root.channel,
  codeOss: root.codeOss?.version ?? '',
};
writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
console.log(`[sync-version] website now reports OpenIDE ${next.version} (${next.channel}).`);
