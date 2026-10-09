import { featuresInBbox, featuresNearRoute, toFeatureCollection } from './data.js';
import type { RouteLayer } from './types.js';

/**
 * Pontes, viadutos, passarelas e túneis (GeoSampa + DER-SP). Nenhuma base aberta traz gabarito ou limite de peso,
 * então a camada é INFORMATIVA: conta as estruturas na rota e avisa veículos pesados/altos que o limite não é conhecido,
 * pedindo reporte. Limites oficiais ou reportados vêm das outras camadas/reportes.
 */
const layer: RouteLayer = {
  meta: {
    id: 'oae',
    label: 'Pontes e viadutos',
    description: 'Obras de arte especiais na rota (sem limite de peso/altura publicado pelos órgãos).',
    group: 'infraestrutura',
    sources: [
      { name: 'GeoSampa obra_arte (PMSP)', url: 'https://geosampa.prefeitura.sp.gov.br', license: 'CC-BY-SA 4.0' },
      { name: 'DER-SP OAE', url: 'https://dadosabertos.sp.gov.br/dataset/obras-de-arte-especiais-oae', license: 'CC-BY-4.0' },
    ],
    style: { kind: 'line', color: '#7c3aed', width: 3, minzoom: 13, icon: '🌉' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    if ((zoom ?? 12) < 12) return { type: 'FeatureCollection', features: [] };
    return toFeatureCollection(await featuresInBbox('oae', bbox, { limit: 4000 }));
  },

  async annotate(ctx, route) {
    const rows = await featuresNearRoute('oae', route.line.geometry, 12, { limit: 2000 });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind ?? 'outra'] = (counts[r.kind ?? 'outra'] ?? 0) + 1;
    const pontes = (counts.ponte ?? 0) + (counts.ponte_madeira ?? 0);
    const viadutos = counts.viaduto ?? 0;
    const passarelas = counts.passarela ?? 0;
    const tuneis = counts.tunel ?? 0;
    const summary = [`${pontes} ponte(s), ${viadutos} viaduto(s), ${passarelas} passarela(s), ${tuneis} túnel(is) a até 12 m da rota (trechos de borda; uma estrutura pode ter mais de um trecho).`];
    const warnings = [];
    const heavy = ctx.vehicle.weight_t > 23 || ctx.vehicle.height_m > 4.2;
    if (heavy && pontes + viadutos + tuneis > 0) {
      warnings.push({
        code: 'oae_limits_unknown', severity: 'info' as const,
        message: `A rota passa por pontes/viadutos/túneis cujo limite de peso e altura não é publicado pelos órgãos. Fique atento às placas R-14/R-15 e reporte o que encontrar.`,
      });
    }
    const madeira = rows.filter((r) => r.kind === 'ponte_madeira');
    for (const m of madeira.slice(0, 5)) {
      warnings.push({ code: 'wooden_bridge', severity: 'warn' as const, id: m.id, message: `Ponte de madeira na rota (${m.name ?? 'DER-SP'}): capacidade de carga desconhecida.` });
    }
    return { summary, warnings, data: { counts } };
  },
};

export default layer;
