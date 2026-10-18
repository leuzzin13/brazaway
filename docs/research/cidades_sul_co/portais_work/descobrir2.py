"""2ª passada: padrões adicionais de domínio. Retomável (cache)."""
import json, os
from concurrent.futures import ThreadPoolExecutor
from common import *
import common

def extra(m, falta_pref, falta_cam):
    uf = m['uf'].lower(); s = slug(m['nome']); sp = slug_sem_part(m['nome']); out = []
    for x in {s, sp}:
        # SaaS de câmara/prefeitura: para todos
        for h in (f'cm{x}.atende.net', f'camara{x}.atende.net', f'camaramunicipal{x}.atende.net', f'cm{x}.cittatec.com.br',
                  f'camara{x}.cittatec.com.br', f'camara{x}.megasofttransparencia.com.br', f'cm{x}.siscam.com.br',
                  f'camara{x}.siscam.com.br', f'{x}.camarasempapel.com.br', f'{x}.nopapercloud.com.br', f'camara{x}.nopapercloud.com.br',
                  f'{x}.cespro.com.br', f'{x}.oxy.elotech.com.br', f'{x}.eloweb.net', f'{x}.betha.cloud',
                  f'acessoainformacao.{x}.{uf}.gov.br', f'acessoainformacao.{x}.{uf}.leg.br',
                  f'acessoainformacao.camara{x}.{uf}.gov.br', f'transparencia.{x}.{uf}.gov.br'):
            out.append('https://' + h + '/')
        if falta_pref:
            for h in (f'prefeitura.{x}.{uf}.gov.br', f'portal.{x}.{uf}.gov.br', f'www.prefeitura{x}.{uf}.gov.br',
                      f'www.pm{x}.com.br', f'pm{x}.com.br', f'www.{x}{uf}.com.br', f'www.{x}.{uf}.gov.br.', f'www.prefeitura{x}.com.br',
                      f'www.{x}.com.br', f'prefeitura{x}.com.br', f'www.pm{x}{uf}.com.br', f'{x}{uf}.com.br', f'www.{x}-{uf}.com.br',
                      f'{x}-{uf}.com.br', f'www.municipio{x}.{uf}.gov.br', f'www.{x}.{uf}.gov.br'):
                out.append('https://' + h.rstrip('.') + '/')
        if falta_cam:
            for h in (f'legislativo.{x}.{uf}.leg.br', f'camara.{x}.{uf}.leg.br', f'camara{x}.{uf}.leg.br', f'www.camara{x}.{uf}.leg.br',
                      f'camaradevereadores{x}.{uf}.leg.br', f'camaramunicipal{x}.{uf}.leg.br', f'www.cm{x}.{uf}.leg.br',
                      f'camara.{x}.{uf}.gov.br', f'www.camaramunicipal{x}.{uf}.gov.br', f'www.camaramunicipal{x}.com.br',
                      f'camara{x}.com.br', f'www.camara{x}.com.br', f'cm{x}.com.br', f'www.cm{x}.com.br',
                      f'camaramunicipaldo{x}.{uf}.gov.br', f'camarade{x}.{uf}.gov.br', f'www.camarade{x}.com.br',
                      f'camara{x}{uf}.com.br', f'www.camara{x}{uf}.com.br', f'cm{x}{uf}.com.br', f'www.cm{x}{uf}.com.br',
                      f'camaramunicipal.{x}.{uf}.gov.br', f'cm{x}.{uf}.gov.br'):
                out.append('https://' + h + '/')
    return list(dict.fromkeys(out))

if __name__ == '__main__':
    common.carrega_cache()
    S = json.load(open(os.path.join(AQUI, 'sites.json')))
    urls = []
    for m in municipios():
        v = S[m['ibge']]
        urls += extra(m, not v['prefeitura'], not v['camara'])
    urls = list(dict.fromkeys(urls)); todo = [u for u in urls if u not in common._cache]
    print(len(urls), len(todo), flush=True)
    with ThreadPoolExecutor(48) as ex:
        list(ex.map(lambda u: common.get(u), todo))
    print('fim')
