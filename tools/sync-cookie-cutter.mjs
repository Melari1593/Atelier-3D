// Copia el conversor de Cookie-cutter (módulo ES) como script clásico para que
// dist/index.html siga funcionando al abrirlo directamente, sin servidor.
//
// Uso: node tools/sync-cookie-cutter.mjs <ruta a Cookie-cutter>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2];
if (!repo) {
  console.error('Uso: node tools/sync-cookie-cutter.mjs <ruta a Cookie-cutter>');
  process.exit(1);
}

const source = readFileSync(join(repo, 'js/converter.js'), 'utf8');
const names = [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
if (!names.length) throw new Error('No se encontraron funciones exportadas en converter.js');

let commit = 'desconocido';
try {
  commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

const body = source.replace(/^export function /gm, 'function ');
const out = `// Generado por tools/sync-cookie-cutter.mjs a partir de Cookie-cutter js/converter.js (${commit}).
// No editar a mano: los cambios van en Cookie-cutter y se vuelven a sincronizar.
(function (global) {
'use strict';
${body}
global.CookieCutter = { ${names.join(', ')} };
})(typeof window !== 'undefined' ? window : globalThis);
`;

const target = join(dirname(fileURLToPath(import.meta.url)), '../dist/js/cookie-cutter.js');
writeFileSync(target, out);
console.log(`dist/js/cookie-cutter.js actualizado (${names.length} funciones, ${commit})`);
