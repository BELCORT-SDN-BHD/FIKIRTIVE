import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXTS = [".tsx", ".ts"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

function directiveOf(src: string): "client" | "server" | null {
  if (/^\s*["']use client["'];/.test(src)) return "client";
  if (/^\s*["']use server["'];/.test(src)) return "server";
  return null;
}

function valueImports(src: string): string[] {
  const specs: string[] = [];
  const re = /^\s*import\s+(?!type\b)(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const match of src.matchAll(re)) specs.push(match[1]!);
  return specs;
}

function resolveLocalImport(spec: string, importer: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(process.cwd(), spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(importer), spec);
  else return null;

  for (const ext of SOURCE_EXTS) {
    const file = `${base}${ext}`;
    try {
      readFileSync(file);
      return file;
    } catch {}
  }
  for (const ext of SOURCE_EXTS) {
    const file = path.join(base, `index${ext}`);
    try {
      readFileSync(file);
      return file;
    } catch {}
  }
  return null;
}

describe("client core imports", () => {
  it("does not import the Node-capable @fikirtive/core barrel from client-reachable modules", () => {
    const roots = ["components", "app", "lib"].map((p) => path.join(process.cwd(), p));
    const files = roots.flatMap(walk);
    const clientRoots = files
      .filter((file) => directiveOf(readFileSync(file, "utf8")) === "client");

    const seen = new Set<string>();
    const reachable = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      if (directiveOf(src) === "server") return;
      reachable.add(file);
      for (const spec of valueImports(src)) {
        const next = resolveLocalImport(spec, file);
        if (next) visit(next);
      }
    };

    for (const root of clientRoots) visit(root);

    const offenders = [...reachable]
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return /from\s+["']@fikirtive\/core["']/.test(src);
      })
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
