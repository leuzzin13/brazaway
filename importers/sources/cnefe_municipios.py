"""Limites e nomes dos municípios (IBGE) → data_features (layer 'geocoding', kind 'municipio').

O geocodificador usa estes polígonos para:
  - reconhecer o município digitado ("..., Guarujá") e o nível "município" da cascata;
  - validar resultados do Photon (rejeitar ponto fora do município pedido) e montar o bbox da UF;
  - escolher a UF a partir da posição do usuário.
Malha "intermediaria" da API de malhas v3 (cerca de 1 MB por UF grande) + nomes da API de localidades.
UFs em GEO_UFS (padrão: Sudeste, a mesma região dos tiles do Valhalla).
"""
import json, os
from common import http_get

LAYER_ID = 'geocoding'
SOURCE = 'ibge-malhas'
SOURCE_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?intrarregiao=municipio&qualidade=intermediaria + /api/v1/localidades/estados/{uf}/municipios'
LICENSE = 'IBGE — Malha Municipal e API de localidades: dados públicos, uso livre com citação da fonte (IBGE)'
NOTES = 'Polígonos simplificados (qualidade intermediária) para reconhecer município e validar o geocodificador; não usar como limite legal.'

UF_SIGLA = {11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN',
            25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC',
            43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'}
MALHA = 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?intrarregiao=municipio&qualidade=intermediaria&formato=application/vnd.geo%2Bjson'
NOMES = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios'


def ufs() -> list[int]:
    raw = os.environ.get('GEO_UFS', '35,33,31,32,41,42,43,50,51,52,53')
    out = []
    for t in raw.split(','):
        t = t.strip().upper()
        if not t:
            continue
        if t.isdigit():
            out.append(int(t))
        else:
            out += [k for k, v in UF_SIGLA.items() if v == t]
    return out


def fetch():
    out = []
    for uf in ufs():
        nomes = {str(m['id']): m['nome'] for m in json.loads(http_get(NOMES.format(uf=uf), cache=f'geocoding/ibge_mun_{uf}.json', max_age_h=24 * 90))}
        malha = json.loads(http_get(MALHA.format(uf=uf), cache=f'geocoding/ibge_malha_{uf}.json', max_age_h=24 * 90))
        for f in malha['features']:
            cod = str(f['properties']['codarea'])
            nome = nomes.get(cod)
            if not nome:
                continue
            out.append({
                'source_id': cod,
                'geometry': f['geometry'],
                'name': nome,
                'kind': 'municipio',
                'props': {'cod_ibge': int(cod), 'uf': UF_SIGLA[uf], 'cod_uf': uf},
            })
        print(f'    UF {UF_SIGLA[uf]}: {sum(1 for o in out if o["props"]["cod_uf"] == uf)} municípios')
    return out
