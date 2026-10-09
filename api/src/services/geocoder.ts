/** Geocodificação: interface `Geocoder` (inalterada) + implementações.
 *
 *  GEOCODER_PROVIDER:
 *    'photon' (padrão do docker-compose) ou 'cascata' → CascadeGeocoder: geocodificador próprio (CNEFE/GeoSampa/CEP)
 *                     para endereço, e Photon para POI/autocomplete, com bbox da UF e validação do município;
 *    'cnefe'        → só o geocodificador próprio (sem chamadas externas, exceto ViaCEP p/ CEP de grande usuário);
 *    'photon_puro'  → comportamento antigo (só Photon, sem bbox nem validação).
 *  Ver docs/layers/geocoding.md. */
import { env } from '../config.js';
import { CnefeGeocoder, dedupe } from './geocoder/cnefe.js';
import { getMunicipios, municipioOfPoints, pointsInMunicipio, type Bbox, type MunicipioIndex } from './geocoder/municipios.js';
import { getCanon } from './geocoder/normalize.js';
import { parseAddress, type ParsedAddress } from './geocoder/parse.js';
import { photonSearch } from './geocoder/photon.js';
import { PRECISAO_RANK, type GeocodeResult, type Geocoder, type SearchOpts } from './geocoder/types.js';

export type { GeocodeResult, Geocoder, SearchOpts, Precisao } from './geocoder/types.js';

/** Photon (público por padrão; PHOTON_URL aponta para um auto-hospedado). */
export class PhotonGeocoder implements Geocoder {
  constructor(private baseUrl = env.photonUrl) {}
  async search(q: string, opts: SearchOpts & { bbox?: Bbox } = {}): Promise<GeocodeResult[]> {
    return photonSearch(q, { lat: opts.lat, lon: opts.lon, limit: opts.limit ?? 6, bbox: opts.bbox }, this.baseUrl);
  }
}

const SP_BBOX: Bbox = [-53.11, -25.32, -44.16, -19.78];

export interface GeocodeExplain {
  parsed: Omit<ParsedAddress, 'municipio'> & { municipio?: { cod: number; nome: string; uf: string } };
  uf: string;
  results: GeocodeResult[];
  photon?: { called: boolean; bbox?: Bbox; recebidos?: number; rejeitados?: number; erro?: string };
  ms: number;
}

export class CascadeGeocoder implements Geocoder {
  private readonly cnefe = new CnefeGeocoder();
  constructor(private readonly photon: PhotonGeocoder | null, private readonly viacep = process.env.VIACEP_URL !== '') {}

  async search(q: string, opts: SearchOpts = {}): Promise<GeocodeResult[]> {
    return (await this.explain(q, opts)).results;
  }

  async explain(q: string, opts: SearchOpts = {}): Promise<GeocodeExplain> {
    const t0 = Date.now();
    const limit = Math.min(Math.max(opts.limit ?? 6, 1), 20);
    const near = opts.lat !== undefined && opts.lon !== undefined && Number.isFinite(opts.lat) && Number.isFinite(opts.lon)
      ? { lat: opts.lat, lon: opts.lon } : undefined;
    const [canon, munis] = await Promise.all([getCanon(), getMunicipios()]);
    const parsed = parseAddress(q, canon, munis);
    const hardMun = parsed.municipio && !parsed.municipioFraco ? parsed.municipio : undefined;
    const uf = parsed.uf ?? hardMun?.uf ?? (near ? munis.ufAt(near.lat, near.lon) : undefined) ?? parsed.municipio?.uf ?? 'SP';

    let local: GeocodeResult[] = [];
    try {
      local = await this.cnefe.geocode(parsed, { near, limit, munis, canon, uf, viacep: this.viacep });
    } catch (e) {
      console.error('[geocoder] cascata local falhou:', (e as Error).message);
    }

    const photonInfo: GeocodeExplain['photon'] = { called: false };
    let photon: GeocodeResult[] = [];
    if (this.photon && this.needsPhoton(parsed, local)) {
      const bbox = hardMun ? expand(hardMun.bbox, 0.01) : (munis.ufBbox.get(uf) ?? SP_BBOX);
      photonInfo.called = true;
      photonInfo.bbox = bbox;
      try {
        const bias = near && inBbox(near, bbox) ? near : hardMun ? { lat: hardMun.lat, lon: hardMun.lon } : undefined;
        const raw = await this.photon.search(q, { ...bias, limit: Math.max(limit, 6), bbox });
        photonInfo.recebidos = raw.length;
        photon = await this.validatePhoton(raw, parsed, uf, munis);
        photonInfo.rejeitados = raw.length - photon.length;
      } catch (e) {
        photonInfo.erro = (e as Error).message;
        if (!local.length && !this.cnefeHasData(munis)) throw e;
      }
      // pontuação comparável à da cascata local: POI pesa mais quando a busca não parece endereço
      const base = parsed.enderecoLike ? 0.55 : 0.95;
      photon.forEach((r, i) => {
        const pref = parsed.municipioFraco && r.cod_ibge === parsed.municipio?.cod ? 0.1 : 0;
        r.score = Math.round((base - 0.03 * i + pref) * 1000) / 1000;
      });
    }

    const merged = dedupe([...local, ...photon])
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map((r) => ({ ...r, score: r.score === undefined ? undefined : Math.round(r.score * 1000) / 1000 }));
    const { municipio, ...rest } = parsed;
    return {
      parsed: { ...rest, municipio: municipio ? { cod: municipio.cod, nome: municipio.nome, uf: municipio.uf } : undefined },
      uf, results: merged, photon: photonInfo, ms: Date.now() - t0,
    };
  }

  private cnefeHasData(munis: MunicipioIndex) { return munis.covered().length > 0; }

  /** Photon só quando a cascata local não resolveu bem (POI, nome de lugar, número não achado...) */
  private needsPhoton(p: ParsedAddress, local: GeocodeResult[]): boolean {
    const best = local.reduce((m, r) => Math.min(m, r.precisao ? PRECISAO_RANK[r.precisao] : 9), 9);
    if (!p.street && p.cep && local.length) return false;          // só CEP
    if (!p.street && p.municipio && !p.bairro) return false;      // só cidade ("Cajamar")
    if (p.numero !== undefined && best <= 1) return false;        // número exato/aproximado já resolvido
    if (p.semNumero && best <= 2 && local.length) return false;   // s/n: lista de estabelecimentos do CNEFE
    return true;
  }

  /** Rejeita resultado fora do município digitado (ou fora da UF de referência) e anota município/UF. */
  private async validatePhoton(rs: GeocodeResult[], p: ParsedAddress, uf: string, munis: MunicipioIndex): Promise<GeocodeResult[]> {
    if (!rs.length) return rs;
    if (!munis.hasPolygons) {
      // sem polígonos (importador cnefe_municipios não rodou): compara o nome da cidade
      if (!p.municipio || p.municipioFraco) return rs;
      const target = p.municipio.canon;
      const canon = await getCanon();
      return rs.filter((r) => r.municipio && canon.canon(r.municipio) === target);
    }
    if (p.municipio && !p.municipioFraco) {
      const ok = await pointsInMunicipio(rs, p.municipio.cod, 300);
      return rs.filter((_, i) => ok[i]).map((r) => ({ ...r, municipio: p.municipio!.nome, uf: p.municipio!.uf, cod_ibge: p.municipio!.cod }));
    }
    const cods = await municipioOfPoints(rs);
    const out: GeocodeResult[] = [];
    rs.forEach((r, i) => {
      const m = cods[i] !== null ? munis.byCod.get(cods[i]!) : undefined;
      const ufLoaded = [...munis.byCod.values()].some((x) => x.uf === uf);
      if (m ? m.uf === uf : !ufLoaded) out.push(m ? { ...r, municipio: m.nome, uf: m.uf, cod_ibge: m.cod } : r);
    });
    return out;
  }
}

function expand(b: Bbox, d: number): Bbox { return [b[0] - d, b[1] - d, b[2] + d, b[3] + d]; }
function inBbox(p: { lat: number; lon: number }, b: Bbox) { return p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3]; }

export function makeGeocoder(): Geocoder {
  switch (env.geocoderProvider) {
    case 'photon_puro':
      return new PhotonGeocoder();
    case 'cnefe':
      return new CascadeGeocoder(null);
    case 'cascata':
    case 'photon':
    default:
      return new CascadeGeocoder(new PhotonGeocoder());
  }
}
