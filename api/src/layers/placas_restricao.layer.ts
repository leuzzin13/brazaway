import * as turf from '@turf/turf';
import { featuresInBbox, featuresNearRoute, type NearRouteRow } from './data.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Placas de regulamentação de restrição a caminhões no inventário de Sinalização Vertical do DER-SP
 * (rodovias estaduais não concedidas). Significados conforme o Manual Brasileiro de Sinalização de Trânsito,
 * Vol. I (CONTRAN); infração por desrespeito: CTB art. 187, I (R-9) e art. 231, IV (dimensões) / V (peso).
 *
 * O inventário NÃO traz o número da placa (só código, rodovia, km e data do levantamento), então a camada
 * nunca bloqueia: avisa "placa de limite X a N m da rota — confira". Sem sentido de tráfego: a placa pode valer
 * para a pista oposta ou para uma via que cruza a rota.
 */

/** Distância máxima (m) entre a placa e a rota para avisar. Placas ficam no acostamento/canteiro (5–20 m do eixo). */
export const PLACA_RAIO_M = 30;
/** Placas iguais a menos disto uma da outra viram um aviso só (pares nos dois lados da pista, repetições). */
const AGRUPAR_M = 150;
const MAX_WARNINGS = 10;

const LIMITE: Record<string, string> = {
  'R-9': 'proibição de caminhões',
  'R-14': 'peso bruto total',
  'R-15': 'altura',
  'R-16': 'largura',
  'R-17': 'peso por eixo',
  'R-18': 'comprimento',
};

function texto(codes: string[]): string {
  const cs = codes.filter((c) => LIMITE[c]);
  if (cs.length === 1 && cs[0] === 'R-9') return 'Placa de proibição de caminhões (R-9)';
  return `Placa de limite de ${cs.map((c) => `${LIMITE[c]} (${c})`).join(' e ')}`;
}

/** 'SP 036' -> 'SP-036' ; 'SPA 036/036' -> 'SPA-036/036' */
export function rodoviaTxt(rod: unknown): string {
  return String(rod ?? '').trim().replace(/^(SPA|SPI|SPM|SP)\s*-?\s*(\d)/i, (_m, a: string, d: string) => `${a.toUpperCase()}-${d}`);
}

function kmTxt(rod: unknown, km: unknown): string {
  if (!rod) return '';
  const k = Number(km);
  return ` (${rodoviaTxt(rod)}${km != null && Number.isFinite(k) ? ` km ${String(Math.round(k * 10) / 10).replace('.', ',')}` : ''})`;
}

const layer: RouteLayer = {
  meta: {
    id: 'placas_restricao',
    label: 'Placas de restrição (DER-SP)',
    description: 'Placas R-9 e R-14 a R-18 (proibição de caminhões, peso, altura, largura, peso por eixo, comprimento) nas rodovias do DER-SP. O valor da placa não é publicado: confira no local.',
    group: 'restricoes',
    sources: [
      { name: 'DER-SP Sinalização Vertical', url: 'https://dadosabertos.sp.gov.br/dataset/sinalizacao-vertical', license: 'CC-BY-4.0' },
    ],
    style: { kind: 'circle', color: '#dc2626', radius: 5, minzoom: 9, icon: '⛔' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 8) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox('placas_restricao', bbox, { limit: 3000 });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => {
        const p = r.props as Record<string, unknown>;
        return {
          type: 'Feature', id: r.id, geometry: r.geometry,
          properties: {
            id: r.id, name: r.name, kind: r.kind, placa: p.codigo_original, significado: p.descricao,
            valor: 'não publicado (confira no local)', rodovia: p.rodovia ? rodoviaTxt(p.rodovia) : null, km: p.km,
            levantamento: p.levantamento, atende_norma: p.atende_norma, ctb: p.ctb, source: r.source,
          },
        };
      }),
    };
  },

  async annotate(ctx, route) {
    const rows = await featuresNearRoute('placas_restricao', route.line.geometry, PLACA_RAIO_M, { limit: 500 });
    if (!rows.length) return { summary: [], data: { placas: [] } };

    // agrupa repetições (mesmo conjunto de códigos a menos de AGRUPAR_M)
    const grupos: { row: NearRouteRow; codes: string[]; n: number }[] = [];
    for (const r of rows) {
      const codes = ((r.props as { codigos?: string[] }).codigos ?? [r.kind ?? '']).filter(Boolean);
      const key = codes.join('+');
      const g = grupos.find((x) => x.codes.join('+') === key
        && turf.distance(turf.point((x.row.geometry as GeoJSON.Point).coordinates), turf.point((r.geometry as GeoJSON.Point).coordinates), { units: 'meters' }) <= AGRUPAR_M);
      if (g) { g.n += 1; if (r.distance_m < g.row.distance_m) g.row = { ...r, fraction: g.row.fraction }; }
      else grupos.push({ row: r, codes, n: 1 });
    }
    grupos.sort((a, b) => a.row.fraction - b.row.fraction);

    const warnings: LayerWarning[] = grupos.slice(0, MAX_WARNINGS).map((g) => {
      const p = g.row.props as Record<string, unknown>;
      const [lon, lat] = (g.row.geometry as GeoJSON.Point).coordinates;
      const proib = g.codes.length === 1 && g.codes[0] === 'R-9';
      return {
        code: proib ? 'placa_proibicao_caminhao' : 'placa_limite',
        severity: 'warn',
        id: g.row.id, lat, lon,
        message: `${texto(g.codes)} a ${Math.round(g.row.distance_m)} m da rota${kmTxt(p.rodovia, p.km)} — confira ${proib ? 'se vale para sua pista e horário' : 'o valor no local'}.`,
      };
    });
    if (grupos.length > MAX_WARNINGS) {
      warnings.push({ code: 'placa_limite_mais', severity: 'info', message: `Mais ${grupos.length - MAX_WARNINGS} placa(s) de restrição perto da rota: veja a camada "Placas de restrição" no mapa.` });
    }

    const porCodigo: Record<string, number> = {};
    for (const g of grupos) for (const c of g.codes) porCodigo[c] = (porCodigo[c] ?? 0) + 1;
    const resumo = Object.entries(porCodigo).sort().map(([c, n]) => `${c} ×${n}`).join(', ');
    return {
      summary: [`${grupos.length} placa(s) de restrição do DER-SP a até ${PLACA_RAIO_M} m da rota (${resumo}); o valor não é publicado.`],
      warnings,
      data: {
        raio_m: PLACA_RAIO_M,
        placas: grupos.map((g) => {
          const p = g.row.props as Record<string, unknown>;
          return { id: g.row.id, codigos: g.codes, rodovia: p.rodovia ? rodoviaTxt(p.rodovia) : null, km: p.km, distance_m: Math.round(g.row.distance_m), repeticoes: g.n, levantamento: p.levantamento };
        }),
      },
    };
  },
};

export default layer;
