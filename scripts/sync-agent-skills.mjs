import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real files work on Windows checkouts without symlink privileges and on Linux CI.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.agents/skills');
const target = join(root, '.claude/skills');
const check = process.argv.includes('--check');
const variants = new Set(['graphify']); // Upstream has agent-specific tool instructions.
const mismatches = [];
let count = 0;

const manifest = JSON.parse(readFileSync(join(root, '.agents/skill-sources.json'), 'utf8'));
const graphifyVersion = manifest.sources.find(item => item.skill === 'graphify').package.split('==')[1];
for (const directory of [source, target]) {
  const marker = join(directory, 'graphify/.graphify_version');
  if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== graphifyVersion) {
    mismatches.push(`Graphify variant version must be ${graphifyVersion}: ${marker}`);
  }
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory() || variants.has(entry.name)) continue;
  const sourceDir = join(source, entry.name);
  if (!existsSync(join(sourceDir, 'SKILL.md'))) continue;
  const targetDir = join(target, entry.name);
  count++;
  for (const file of walk(sourceDir)) {
    const dest = join(targetDir, relative(sourceDir, file));
    if (existsSync(dest) && readFileSync(file).equals(readFileSync(dest))) continue;
    if (check) mismatches.push(relative(root, dest));
    else {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(file, dest);
    }
  }
  // Never silently delete Claude-only files: surface them for an explicit decision.
  if (existsSync(targetDir)) {
    for (const file of walk(targetDir)) {
      if (!existsSync(join(sourceDir, relative(targetDir, file)))) {
        mismatches.push(`Claude-only file: ${relative(root, file)}`);
      }
    }
  }
}
for (const entry of readdirSync(target, { withFileTypes: true })) {
  if (entry.isDirectory() && !variants.has(entry.name)
      && existsSync(join(target, entry.name, 'SKILL.md'))
      && !existsSync(join(source, entry.name, 'SKILL.md'))) {
    mismatches.push(`Promote Claude-only skill to .agents/skills: ${entry.name}`);
  }
}
if (mismatches.length) {
  console.error(mismatches.join('\n'));
  process.exitCode = 1;
} else console.log(`${count} shared skills ${check ? 'verified' : 'synced'}; Graphify keeps upstream agent variants.`);
