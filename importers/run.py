"""Runner dos importadores.

  docker compose --profile import run --rm importer --list
  docker compose --profile import run --rm importer oae_geosampa der_oae
  docker compose --profile import run --rm importer all
  docker compose --profile import run --rm importer all --seed-only   # não grava no banco, só gera seeds

Importador opcional: o módulo declara REQUIRES_ENV = ('VAR', ...). Em `all`, se faltar alguma dessas variáveis ele é
PULADO (não conta como falha nem mexe no banco); chamado pelo nome, roda e falha com a mensagem dele.

Importador com várias fontes (ex.: municipios, uma fonte por município): o módulo expõe runs(arg) -> [{source,
source_url, license, notes, fetch}] e cada item vira um seed e uma carga próprios. `nome:arg` passa um filtro
(ex.: `municipios:3106200`).
"""
import importlib, pkgutil, sys, time, traceback
import common
import sources

def available():
    return sorted(m.name for m in pkgutil.iter_modules(sources.__path__) if not m.name.startswith('_'))

def missing_env(mod):
    import os
    return [v for v in getattr(mod, 'REQUIRES_ENV', ()) if not os.environ.get(v, '').strip()]

def main(argv):
    if not argv or '--list' in argv:
        for n in available():
            mod = importlib.import_module(f'sources.{n}')
            opt = f" [opcional: {', '.join(mod.REQUIRES_ENV)}]" if getattr(mod, 'REQUIRES_ENV', None) else ''
            multi = ' [várias fontes: nome:filtro]' if hasattr(mod, 'runs') else ''
            print(f'{n:32s} layer={mod.LAYER_ID:22s} source={mod.SOURCE:14s} {mod.LICENSE}{opt}{multi}')
        return 0
    seed_only = '--seed-only' in argv
    no_seed = '--no-seed' in argv
    names = [a for a in argv if not a.startswith('--')]
    run_all = names == ['all']
    if run_all:
        names = available()
    failed, skipped = [], []
    for n in names:
        t0 = time.time()
        n, _, arg = n.partition(':')
        try:
            mod = importlib.import_module(f'sources.{n}')
            if hasattr(mod, 'runs'):
                for job in mod.runs(arg or None):
                    t1 = time.time()
                    try:
                        print(f'==> {n}:{job["source"]} ({mod.LAYER_ID}/{job["source"]})')
                        feats = common.validate(job['fetch']())
                        if not no_seed:
                            p = common.write_seed(mod.LAYER_ID, job['source'], feats, job['source_url'], job['license'], job.get('notes'))
                            print(f'    seed: {p} ({p.stat().st_size/1e6:.1f} MB)')
                        if not seed_only:
                            common.load_db(mod.LAYER_ID, job['source'], feats, job['source_url'], job['license'], job.get('notes'))
                        print(f'    ok: {len(feats)} feições em {time.time()-t1:.0f}s')
                    except Exception:
                        traceback.print_exc()
                        failed.append(f'{n}:{job["source"]}')
                continue
            if arg:
                raise SystemExit(f'{n} não aceita filtro (":{arg}")')
            if run_all and missing_env(mod):
                print(f'==> {n}: pulado (opcional; falta {", ".join(missing_env(mod))})')
                skipped.append(n)
                continue
            print(f'==> {n} ({mod.LAYER_ID}/{mod.SOURCE})')
            feats = common.validate(mod.fetch())
            notes = getattr(mod, 'NOTES', None)
            # fontes que gravam em tabela própria (ex.: cet_suspensoes -> rule_suspensions, cnefe -> addr_point) informam a
            # contagem real (RECORD_COUNT) e, se quiserem, o próprio seed (SEED_SQL); as demais usam as feições de data_features
            count = getattr(mod, 'RECORD_COUNT', None)
            seed_sql = getattr(mod, 'SEED_SQL', None)
            if not no_seed:
                p = (common.write_seed_sql(mod.LAYER_ID, mod.SOURCE, seed_sql) if seed_sql is not None
                     else common.write_seed(mod.LAYER_ID, mod.SOURCE, feats, mod.SOURCE_URL, mod.LICENSE, notes, record_count=count))
                print(f'    seed: {p} ({p.stat().st_size/1e6:.1f} MB)')
            if not seed_only:
                common.load_db(mod.LAYER_ID, mod.SOURCE, feats, mod.SOURCE_URL, mod.LICENSE, notes, record_count=count)
            print(f'    ok: {len(feats)} feições{"" if count is None else f", {count} registros"} em {time.time()-t0:.0f}s')
        except Exception:
            traceback.print_exc()
            failed.append(n)
    if skipped:
        print('PULADOS (opcionais sem configuração):', ', '.join(skipped))
    if failed:
        print('FALHARAM:', ', '.join(failed))
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
