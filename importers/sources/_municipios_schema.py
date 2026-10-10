"""Validador dos arquivos de município (data/raw/municipios/<ibge>.json) contra data/raw/municipios/schema.json.

Sem dependência nova: implementa o subconjunto do JSON Schema 2020-12 que o schema usa ($ref para #/$defs, type, enum,
const, required, properties, additionalProperties, items, minItems, maxItems, uniqueItems, pattern, minLength, minimum,
maximum, exclusiveMinimum, oneOf, anyOf, not). Palavra-chave fora desse subconjunto faz o validador falhar (nunca
ignora em silêncio). Depois do schema, `coerencia()` confere o que o schema não expressa (código IBGE x arquivo x UF,
status x confiança, janelas, referências entre regras e geometrias).
"""
from __future__ import annotations

import json
import pathlib
import re

SUPORTADAS = {'$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'enum', 'const', 'required', 'properties',
              'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'minLength', 'minimum',
              'maximum', 'exclusiveMinimum', 'oneOf', 'anyOf', 'not'}

# código IBGE da UF (2 primeiros dígitos do código do município)
UF_IBGE = {'11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
           '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
           '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'}


def _tipo_ok(v, t: str) -> bool:
    if t == 'null':
        return v is None
    if t == 'boolean':
        return isinstance(v, bool)
    if t == 'integer':
        return isinstance(v, int) and not isinstance(v, bool)
    if t == 'number':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == 'string':
        return isinstance(v, str)
    if t == 'array':
        return isinstance(v, list)
    if t == 'object':
        return isinstance(v, dict)
    raise ValueError(f'tipo de JSON Schema não suportado: {t}')


class Validador:
    def __init__(self, schema: dict):
        self.raiz = schema
        self._conferir_palavras(schema, '#')

    def _conferir_palavras(self, s, onde: str):
        if isinstance(s, dict):
            for k, v in s.items():
                if k not in SUPORTADAS:
                    raise ValueError(f'schema usa palavra-chave não suportada pelo validador: {k} ({onde})')
                if k in ('properties', '$defs'):
                    for nome, sub in v.items():
                        self._conferir_palavras(sub, f'{onde}/{k}/{nome}')
                elif k in ('items', 'additionalProperties', 'not') and isinstance(v, dict):
                    self._conferir_palavras(v, f'{onde}/{k}')
                elif k in ('oneOf', 'anyOf'):
                    for i, sub in enumerate(v):
                        self._conferir_palavras(sub, f'{onde}/{k}/{i}')

    def _ref(self, ref: str) -> dict:
        if not ref.startswith('#/'):
            raise ValueError(f'$ref externo não suportado: {ref}')
        s = self.raiz
        for parte in ref[2:].split('/'):
            s = s[parte]
        return s

    def erros(self, v, s: dict | None = None, caminho: str = '$') -> list[str]:
        s = self.raiz if s is None else s
        out: list[str] = []
        if '$ref' in s:
            out += self.erros(v, self._ref(s['$ref']), caminho)
        if 'type' in s:
            tipos = s['type'] if isinstance(s['type'], list) else [s['type']]
            if not any(_tipo_ok(v, t) for t in tipos):
                return out + [f'{caminho}: tipo deveria ser {"/".join(tipos)}']
        if 'const' in s and v != s['const']:
            out.append(f'{caminho}: deveria ser {json.dumps(s["const"], ensure_ascii=False)}')
        if 'enum' in s and v not in s['enum']:
            out.append(f'{caminho}: valor {json.dumps(v, ensure_ascii=False)} fora de {s["enum"]}')
        if isinstance(v, str):
            if 'minLength' in s and len(v) < s['minLength']:
                out.append(f'{caminho}: texto curto demais (mínimo {s["minLength"]})')
            if 'pattern' in s and not re.search(s['pattern'], v):
                out.append(f'{caminho}: "{v}" não casa com {s["pattern"]}')
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if 'minimum' in s and v < s['minimum']:
                out.append(f'{caminho}: menor que {s["minimum"]}')
            if 'maximum' in s and v > s['maximum']:
                out.append(f'{caminho}: maior que {s["maximum"]}')
            if 'exclusiveMinimum' in s and v <= s['exclusiveMinimum']:
                out.append(f'{caminho}: deveria ser maior que {s["exclusiveMinimum"]}')
        if isinstance(v, list):
            if 'minItems' in s and len(v) < s['minItems']:
                out.append(f'{caminho}: mínimo de {s["minItems"]} item(ns)')
            if 'maxItems' in s and len(v) > s['maxItems']:
                out.append(f'{caminho}: máximo de {s["maxItems"]} item(ns)')
            if s.get('uniqueItems') and len({json.dumps(x, sort_keys=True) for x in v}) < len(v):
                out.append(f'{caminho}: itens repetidos')
            if isinstance(s.get('items'), dict):
                for i, x in enumerate(v):
                    out += self.erros(x, s['items'], f'{caminho}[{i}]')
        if isinstance(v, dict):
            for k in s.get('required', []):
                if k not in v:
                    out.append(f'{caminho}: falta o campo obrigatório "{k}"')
            props = s.get('properties', {})
            for k, x in v.items():
                if k in props:
                    out += self.erros(x, props[k], f'{caminho}.{k}')
                elif s.get('additionalProperties') is False:
                    out.append(f'{caminho}: campo desconhecido "{k}"')
                elif isinstance(s.get('additionalProperties'), dict):
                    out += self.erros(x, s['additionalProperties'], f'{caminho}.{k}')
        if 'oneOf' in s:
            ok = [i for i, sub in enumerate(s['oneOf']) if not self.erros(v, sub, caminho)]
            if len(ok) != 1:
                out.append(f'{caminho}: deveria casar com exatamente uma das alternativas ({len(ok)} casaram)')
        if 'anyOf' in s and not any(not self.erros(v, sub, caminho) for sub in s['anyOf']):
            out.append(f'{caminho}: não casa com nenhuma das alternativas')
        if 'not' in s and not self.erros(v, s['not'], caminho):
            out.append(f'{caminho}: combinação de campos não permitida')
        return out


def _min(h: str) -> int:
    return int(h[:2]) * 60 + int(h[3:])


def coerencia(doc: dict, nome_arquivo: str | None = None, existe=lambda rel: True) -> list[str]:
    """Checagens que o schema não expressa. `existe(rel)` diz se um arquivo de geometria existe em data/raw/."""
    out: list[str] = []
    ibge = doc.get('ibge', '')
    if nome_arquivo and pathlib.Path(nome_arquivo).stem != ibge:
        out.append(f'o arquivo deve se chamar {ibge}.json (código IBGE do campo "ibge")')
    if UF_IBGE.get(ibge[:2]) != doc.get('uf'):
        out.append(f'uf "{doc.get("uf")}" não bate com o código IBGE {ibge} (UF {UF_IBGE.get(ibge[:2], "?")})')
    if doc.get('fonte_id') == 'ibge':
        out.append('fonte_id "ibge" é reservado (limites municipais)')
    regras = doc.get('regras', [])
    ids = [r.get('id') for r in regras]
    for i in sorted({x for x in ids if ids.count(x) > 1}):
        out.append(f'id de regra repetido: {i}')
    zonas = {r.get('id') for r in regras if r.get('tipo') == 'zona'}
    for r in regras:
        rid = r.get('id', '?')
        st, conf = r.get('status'), r.get('confianca')
        if st != 'ativa' and not r.get('status_motivo'):
            out.append(f'{rid}: status "{st}" exige status_motivo (por que não é aplicada)')
        if conf in ('baixa', 'unverifiable') and st == 'ativa':
            out.append(f'{rid}: confiança "{conf}" não pode entrar ativa (use status "desativada" com status_motivo)')
        if st == 'revogada' and not r.get('vigencia_fim'):
            out.append(f'{rid}: regra revogada exige vigencia_fim (data da revogação)')
        if st == 'ativa' and not r.get('janelas'):
            out.append(f'{rid}: regra ativa sem janelas de horário')
        if r.get('vigencia_inicio') and r.get('vigencia_fim') and r['vigencia_fim'] < r['vigencia_inicio']:
            out.append(f'{rid}: vigencia_fim antes de vigencia_inicio')
        janelas = list(r.get('janelas', [])) + [j for v in r.get('variantes', []) for j in v.get('janelas', [])]
        for j in janelas:
            if isinstance(j, dict) and j.get('from') and j.get('to') and _min(j['from']) >= _min(j['to']):
                out.append(f'{rid}: janela {j["from"]}–{j["to"]} vazia ou virando a noite (divida em duas janelas)')
        conds = list(r.get('alvo', {}).get('qualquer', [])) + list(r.get('alvo', {}).get('todas', []))
        for v in r.get('variantes', []):
            conds += list(v.get('quando', {}).get('qualquer', [])) + list(v.get('quando', {}).get('todas', []))
        for c in conds:
            if isinstance(c, dict) and (c.get('campo') == 'tipo') != ('em' in c):
                out.append(f'{rid}: condição "em" só serve (e é obrigatória) para o campo "tipo"')
        for v in r.get('variantes', []):
            q = v.get('quando', {})
            if not q.get('qualquer') and not q.get('todas'):
                out.append(f'{rid}: variante "{v.get("classe")}" sem condição em "quando"')
        if r.get('zona_vinculada') and r['zona_vinculada'] not in zonas:
            out.append(f'{rid}: zona_vinculada "{r["zona_vinculada"]}" não é uma regra-zona deste arquivo')
        if 'od_raio_m' in r and r.get('tipo') != 'zona':
            out.append(f'{rid}: od_raio_m (raio de acesso da origem/destino) só para regra do tipo zona')
        if r.get('excecao_destino_local_incisos') and not r.get('excecao_destino_local'):
            out.append(f'{rid}: excecao_destino_local_incisos sem excecao_destino_local')
        if 'ibge' in r and r['ibge'] is not None and r['ibge'] != ibge:
            out.append(f'{rid}: ibge da regra difere do arquivo (só null é aceito, para registro regional)')
        if 'ibge' in r and r['ibge'] is None and not r.get('abrangencia_ibge'):
            out.append(f'{rid}: registro regional (ibge null) exige abrangencia_ibge')
        geos = r.get('geometria', [])
        gids = [g.get('id') for g in geos if isinstance(g, dict) and g.get('id')]
        for g in geos:
            if not isinstance(g, dict):
                continue
            onde = f'{rid}: geometria {g.get("id") or g.get("arquivo") or "embutida"}'
            if g.get('construir') == 'trechos' and not r.get('trechos'):
                out.append(f'{onde}: construir "trechos" sem trechos na regra')
            if g.get('construir') == 'entorno' and not g.get('entorno'):
                out.append(f'{onde}: construir "entorno" sem o bloco entorno')
            if 'entorno' in g and g.get('construir') != 'entorno':
                out.append(f'{onde}: bloco entorno só com construir "entorno"')
            if ('construir' in g or 'formato' in g or 'omitir_ways_de' in g or 'como_gerar' in g) and 'arquivo' not in g:
                out.append(f'{onde}: construir/formato/omitir_ways_de/como_gerar só com "arquivo"')
            if ('simplificar' in g or 'casas' in g) and 'municipios' not in g:
                out.append(f'{onde}: simplificar/casas só com "municipios"')
            if 'municipios' in g and r.get('tipo') != 'zona':
                out.append(f'{onde}: "municipios" (união de limites) só para regra do tipo zona')
            for o in g.get('omitir_ways_de', []):
                if o not in gids or o == g.get('id'):
                    out.append(f'{onde}: omitir_ways_de "{o}" não é outra geometria desta regra')
            if 'arquivo' in g and g.get('construir', 'manual') == 'manual' and not existe(g['arquivo']):
                out.append(f'{onde}: arquivo ausente em data/raw/{g["arquivo"]}' + (f' — {g["como_gerar"]}' if g.get('como_gerar') else ''))
        if r.get('source_id') and len(geos) != 1:
            out.append(f'{rid}: source_id fixo só para regra com uma única geometria')
    return out


def carregar_schema(caminho: pathlib.Path) -> Validador:
    return Validador(json.loads(caminho.read_text()))


def validar(doc: dict, validador: Validador, nome_arquivo: str | None = None, existe=lambda rel: True) -> list[str]:
    erros = validador.erros(doc)
    # a coerência pressupõe a forma básica: só roda quando o schema passou
    return erros or coerencia(doc, nome_arquivo, existe)
