import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RouteLayer } from './types.js';

let cache: Promise<RouteLayer[]> | null = null;

/** Descobre automaticamente todos os arquivos `*.layer.(ts|js)` desta pasta (sem registro manual). */
export function loadLayers(): Promise<RouteLayer[]> {
  if (!cache) {
    cache = (async () => {
      const dir = dirname(fileURLToPath(import.meta.url));
      const files = readdirSync(dir).filter((f) => /\.layer\.(ts|js)$/.test(f) && !f.endsWith('.d.ts')).sort();
      const out: RouteLayer[] = [];
      const seen = new Set<string>();
      for (const f of files) {
        const mod = await import(pathToFileURL(join(dir, f)).href);
        const layer = mod.default as RouteLayer | undefined;
        if (!layer?.meta?.id) throw new Error(`Camada ${f} não exporta default { meta: { id } }`);
        if (seen.has(layer.meta.id)) throw new Error(`id de camada duplicado: ${layer.meta.id}`);
        seen.add(layer.meta.id);
        out.push(layer);
      }
      return out;
    })();
  }
  return cache;
}

export async function getLayer(id: string): Promise<RouteLayer | undefined> {
  return (await loadLayers()).find((l) => l.meta.id === id);
}
