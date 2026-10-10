import { query } from '../db.js';
import { RouteIndex, angleDiff180, dbg, distM, fmtNum, nearRoute } from './federal_restricoes.layer.js';
import type { LayerWarning, RouteLayer } from './types.js';

/**
 * Pontes e viadutos das rodovias federais — camada INFORMATIVA, nunca bloqueia a rota.
 *  - DNITGeo `oae_sgo` + nota técnica do PROARTE/DNIT (painel Power BI; Norma DNIT 010/2024-PRO: 1 crítica ... 5 excelente);
 *  - ANTT "Pontes e similares" (concessões federais, CC-BY);
 *  - Alertas de serviços do DNIT (interdições/restrições de ponte) — pendentes de revisão humana; só os aprovados em
 *    dnit_alertas_curadoria viram restrição (na camada federal_restricoes).
 * Nota 1–2 gera aviso 'warn' e pedido de reporte: a nota não é limite de peso (Res. DNIT 11/2022, art. 29 §5º) e as
 * vistorias publicadas são de 2020–2021.
 */

type LonLat = [number, number];
const NOTA_DESC: Record<number, string> = { 1: 'crítica', 2: 'ruim', 3: 'regular', 4: 'boa', 5: 'excelente' };
const PORTANTES = new Set(['ponte', 'ponte_madeira', 'pontilhao', 'viaduto']);
const TIPO_LABEL: Record<string, string> = {
  ponte: 'ponte', ponte_madeira: 'ponte de madeira', pontilhao: 'pontilhão', viaduto: 'viaduto', passarela: 'passarela',
  passagem_superior: 'passagem superior', passagem_inferior: 'passagem inferior', tunel: 'túnel', passagem_fauna: 'passagem de fauna',
  bueiro: 'bueiro', inservivel: 'OAE inservível', outra: 'OAE', alerta_dnit: 'alerta do DNIT',
};
const ALERTA_DIAS = 120;

function kmTxt(km: unknown): string {
  const n = Number(km);
  return Number.isFinite(n) && km !== null && km !== '' ? ` km ${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : '';
}
function ano(d: unknown): string | null { return typeof d === 'string' && d.length >= 4 ? d.slice(0, 4) : null; }
function dataBr(d: unknown): string | null {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null;
}

interface Row { id: string; source: string; source_id: string; name: string | null; kind: string | null; props: any; geometry: GeoJSON.Geometry; status?: string }

const layer: RouteLayer = {
  meta: {
    id: 'pontes_federais',
    label: 'Pontes federais (DNIT/ANTT)',
    description: 'Pontes e viadutos de rodovias federais com nota técnica do DNIT (PROARTE), OAEs das concessões (ANTT) e alertas de interdição do DNIT. Informativa.',
    group: 'infraestrutura',
    sources: [
      { name: 'DNIT/DNITGeo — OAEs (vgeo:oae_sgo)', url: 'https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs', license: 'Dado público DNIT, sem licença explícita (AccessConstraints=NONE)' },
      { name: 'DNIT/PROARTE — painel "Obras de Arte Especiais" (nota técnica SGO)', url: 'https://app.powerbi.com/view?r=eyJrIjoiZWU3NWRjYjQtNGVmMS00ZmEwLTk2MmYtODM3NWIxYWRlZWZhIiwidCI6IjQ0MTBhNmY2LWM2MTMtNGNkNy05M2VjLTY1MzBhZjdhMzA1MyJ9', license: 'Sem licença declarada (painel público do DNIT): uso informativo com citação' },
      { name: 'ANTT — Pontes e similares das rodovias concedidas', url: 'https://dados.antt.gov.br/dataset/pontes-similares', license: 'CC-BY (Creative Commons Atribuição)' },
      { name: 'DNIT — Alertas de serviços (notícias)', url: 'https://www.gov.br/dnit/pt-br/central-de-conteudos/noticias-alerta-de-servicos', license: 'Portal gov.br CC BY-ND 3.0: só fatos e link' },
    ],
    style: { kind: 'circle', color: '#b45309', radius: 5, width: 4, minzoom: 7, icon: '🌉' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 10;
    // zoom baixo: só o que pede atenção (nota 1–2, madeira e alertas)
    const where = z < 10 ? `and (f.source = 'dnit-alertas' or (f.props->>'nota')::int <= 2 or f.kind = 'ponte_madeira')` : '';
    const r = await query<Row>(
      `select f.id::text, f.source, f.source_id, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry,
              coalesce(c.status, 'pendente_revisao') as status
         from data_features f left join dnit_alertas_curadoria c on f.source = 'dnit-alertas' and c.source_id = f.source_id
        where f.layer_id = 'pontes_federais' and f.geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
          and (f.source <> 'dnit-alertas' or c.status = 'aprovado' or f.valid_from is null or f.valid_from > now() - interval '${ALERTA_DIAS} days')
          and coalesce(c.status, '') <> 'rejeitado'
          ${where}
        limit 4000`,
      bbox,
    ).catch(async () => (await query<Row>(
      `select id::text, source, source_id, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry from data_features f
        where layer_id = 'pontes_federais' and geom && ST_MakeEnvelope($1,$2,$3,$4,4326) ${where} limit 4000`, bbox)));
    return {
      type: 'FeatureCollection',
      features: r.rows.map((row) => {
        const p = row.props ?? {};
        let geometry = row.geometry;
        let properties: Record<string, unknown>;
        if (row.source === 'dnit-alertas') {
          if (Array.isArray(p.ponto)) geometry = { type: 'Point', coordinates: p.ponto };
          properties = {
            name: row.name, 'Alerta DNIT': p.tipo_alerta === 'interdicao' ? 'interdição' : p.tipo_alerta === 'restricao_peso' ? 'restrição de carga' : 'outro',
            'Situação': row.status === 'aprovado' ? 'revisado (aplicado na rota)' : 'pendente de revisão (não aplicado)',
            'Rodovia': `BR-${p.br}/${p.uf}${kmTxt(p.km)}`, 'Ponte': p.oae_nome ?? null, 'Publicado': dataBr(p.publicado_em), 'Link': p.url,
          };
        } else if (row.source === 'antt') {
          properties = {
            name: row.name, 'Tipo': TIPO_LABEL[row.kind ?? ''] ?? row.kind, 'Concessionária': p.concessionaria, 'Rodovia': `${p.rodovia ?? ''}${kmTxt(p.km)}`,
            'Pista': [p.pista, p.sentido].filter(Boolean).join(' · ') || null, 'Extensão': p.extensao_m != null ? `${fmtNum(p.extensao_m, 1)} m` : null,
            'Nota DNIT': 'não publicada (concessão)', 'Fonte': 'ANTT',
          };
        } else {
          properties = {
            name: row.name, 'Tipo': TIPO_LABEL[row.kind ?? ''] ?? row.kind,
            'Nota DNIT': p.nota ? `${p.nota} (${NOTA_DESC[p.nota]})` : 'sem nota publicada',
            'Vistoria': dataBr(p.data_vistoria), 'Rodovia': `BR-${p.br}/${p.uf}${kmTxt(p.km)}`, 'Estrutura': p.estrutura ?? null,
            'Extensão': p.extensao_m != null ? `${fmtNum(p.extensao_m, 1)} m` : null, 'Largura': p.largura_m != null ? `${fmtNum(p.largura_m, 1)} m` : null,
            'PROARTE': p.proarte_status ?? null, 'Administração': p.administracao ?? null, 'Fonte': p.fonte,
          };
        }
        return { type: 'Feature' as const, id: row.id, geometry, properties: { id: row.id, kind: row.kind, nota: p.nota ?? null, source: row.source, ...properties } };
      }),
    };
  },

  async annotate(ctx, route) {
    const t0 = Date.now();
    const coords = route.line.geometry.coordinates as LonLat[];
    const idx = new RouteIndex(coords);
    const rows = (await nearRoute(route.line.geometry, 'pontes_federais', `f.source in ('dnit', 'antt')`, 0.00035, 6000)) as Row[];

    // a OAE é "da rota" se a rota passa POR ela (não por baixo): ponto a ≤30 m com rumo da rota alinhado ao da OAE
    // (rotação do DNITGeo + 90° = rumo da rodovia; conferido na pesquisa: mediana 0,9°) ou, na ANTT, início e fim a ≤30 m.
    const onRoute = rows.filter((r) => {
      if (!PORTANTES.has(r.kind ?? '')) return false;
      if (r.geometry.type === 'Point') {
        const n = idx.nearest(r.geometry.coordinates as LonLat);
        if (n.d > 30) return false;
        const rot = Number(r.props.rotacao);
        if (r.props.rotacao == null || !Number.isFinite(rot)) return n.d <= 15;
        return angleDiff180(idx.bearing(n.seg), (((rot + 90) % 180) + 180) % 180) <= 30;
      }
      if (r.geometry.type === 'LineString') {
        const c = r.geometry.coordinates as LonLat[];
        return idx.nearest(c[0]).d <= 30 && idx.nearest(c[c.length - 1]).d <= 30;
      }
      return false;
    });
    dbg(`pontes: ${rows.length} perto, ${onRoute.length} na rota`, t0);
    const dnit = onRoute.filter((r) => r.source === 'dnit');
    const antt = onRoute.filter((r) => r.source === 'antt').filter((a) => {
      const c = (a.geometry.type === 'LineString' ? a.geometry.coordinates[0] : (a.geometry as GeoJSON.Point).coordinates) as LonLat;
      return !dnit.some((d) => distM((d.geometry as GeoJSON.Point).coordinates as LonLat, c) < 100);
    });

    const warnings: LayerWarning[] = [];
    const porNota: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, sem: 0 };
    for (const d of dnit) porNota[d.props.nota ? String(d.props.nota) : 'sem']++;
    const pos = (r: Row) => idx.nearest((r.geometry.type === 'Point' ? r.geometry.coordinates : (r.geometry as GeoJSON.LineString).coordinates[0]) as LonLat).seg;
    const baixas = dnit.filter((d) => d.props.nota === 1 || d.props.nota === 2).sort((a, b) => pos(a) - pos(b));
    for (const b of baixas.slice(0, 6)) {
      const [lon, lat] = (b.geometry as GeoJSON.Point).coordinates;
      const vist = ano(b.props.data_vistoria);
      warnings.push({
        code: 'ponte_nota_baixa', severity: 'warn', id: b.id, lat, lon,
        message: `Ponte com nota técnica ${b.props.nota} (${NOTA_DESC[b.props.nota]}) no DNIT: ${b.name ?? 'OAE'} (BR-${b.props.br}/${b.props.uf}${kmTxt(b.props.km)})${vist ? `, vistoria de ${vist}` : ''}. A nota não é limite de peso: respeite a placa R-14 e, se houver restrição ou interdição, reporte no app.`,
      });
    }
    if (baixas.length > 6) {
      warnings.push({ code: 'ponte_nota_baixa', severity: 'warn', message: `Mais ${baixas.length - 6} ponte(s) com nota 1–2 no DNIT na rota: fique atento às placas de peso e reporte o que encontrar.` });
    }
    const madeira = onRoute.filter((r) => r.kind === 'ponte_madeira');
    for (const m of madeira.slice(0, 4)) {
      const [lon, lat] = (m.geometry.type === 'Point' ? m.geometry.coordinates : (m.geometry as GeoJSON.LineString).coordinates[0]) as LonLat;
      warnings.push({
        code: 'ponte_madeira_federal', severity: 'warn', id: m.id, lat, lon,
        message: `Ponte de madeira na rota: ${m.name ?? 'OAE'} (BR-${m.props.br}/${m.props.uf}${kmTxt(m.props.km)}). Capacidade de carga não publicada: confira a placa de peso e reporte se houver limite.`,
      });
    }

    // alertas do DNIT perto da rota (pendentes = só informação; aprovados já entram como restrição na federal_restricoes)
    const al = await query<Row & { status: string; acao: string | null }>(
      `with l as (select ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 0.0001) as g)
       select f.id::text, f.source, f.source_id, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry,
              coalesce(c.status, 'pendente_revisao') as status, c.acao
         from data_features f left join dnit_alertas_curadoria c on c.source_id = f.source_id, l
        where f.layer_id = 'pontes_federais' and f.source = 'dnit-alertas'
          and ST_DWithin(f.geom, l.g, 0.003)
          and coalesce(c.status, 'pendente_revisao') <> 'rejeitado'
          and (c.status = 'aprovado' or f.valid_from is null or f.valid_from > now() - interval '${ALERTA_DIAS} days')
        order by f.valid_from desc nulls last limit 20`,
      [JSON.stringify(route.line.geometry)],
    ).catch(() => ({ rows: [] as (Row & { status: string; acao: string | null })[] }));
    for (const a of al.rows) {
      const p = a.props ?? {};
      const [lon, lat] = Array.isArray(p.ponto) ? p.ponto : [undefined, undefined];
      warnings.push(a.status === 'aprovado'
        ? { code: 'alerta_dnit_revisado', severity: 'info', id: a.source_id, lat, lon, message: `Alerta do DNIT revisado no trajeto: “${a.name}”. Aplicado na rota para os veículos afetados.` }
        : { code: 'alerta_dnit_pendente', severity: 'info', id: a.source_id, lat, lon, message: `Alerta do DNIT perto da rota, ainda não revisado: “${a.name}” (${dataBr(p.publicado_em) ?? 'sem data'}). Confira a sinalização no local.` });
    }

    dbg('pontes: alertas', t0);
    const total = dnit.length + antt.length;
    const summary: string[] = [];
    if (total) {
      const partes = [`${total} ponte(s)/viaduto(s) federal(is) na rota`];
      if (baixas.length) {
        const anos = [...new Set(baixas.map((b) => ano(b.props.data_vistoria)).filter(Boolean))].sort();
        partes.push(`${baixas.length} com nota 1–2 no DNIT${anos.length ? ` (vistorias ${anos.join(', ')})` : ''}`);
      }
      if (madeira.length) partes.push(`${madeira.length} de madeira`);
      if (antt.length) partes.push(`${antt.length} em concessão (ANTT, sem nota publicada)`);
      summary.push(`${partes.join('; ')}.`);
    }
    if (al.rows.length) summary.push(`${al.rows.length} alerta(s) do DNIT sobre ponte perto da rota (${al.rows.filter((a) => a.status !== 'aprovado').length} pendente(s) de revisão).`);

    return {
      summary,
      warnings,
      data: {
        pontes: total,
        por_nota: porNota,
        nota_baixa: baixas.map((b) => ({
          id: b.id, nome: b.name, br: b.props.br, uf: b.props.uf, km: b.props.km, nota: b.props.nota, data_vistoria: b.props.data_vistoria,
          lon: (b.geometry as GeoJSON.Point).coordinates[0], lat: (b.geometry as GeoJSON.Point).coordinates[1],
        })),
        // sugestão para o app abrir o reporte colaborativo (base própria, separada do OSM)
        reportar: [...baixas, ...madeira].slice(0, 10).map((b) => {
          const c = (b.geometry.type === 'Point' ? b.geometry.coordinates : (b.geometry as GeoJSON.LineString).coordinates[0]) as LonLat;
          return { type: 'weight_limit', lon: c[0], lat: c[1], nome: b.name, pergunta: 'Há placa de peso (R-14) ou interdição nesta ponte?' };
        }),
        alertas: al.rows.map((a) => ({ id: a.source_id, titulo: a.name, status: a.status, url: a.props?.url, publicado_em: a.props?.publicado_em })),
      },
    };
  },
};

export default layer;
