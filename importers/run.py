"""Runner dos importadores.

  docker compose --profile import run --rm importer --list
  docker compose --profile import run --rm importer oae_geosampa der_oae
  docker compose --profile import run --rm importer all
  docker compose --profile import run --rm importer all --seed-only   # não grava no banco, só gera seeds

Importador opcional: o módulo declara REQUIRES_ENV = ('VAR', ...). Em `all`, se faltar alguma dessas variáveis ele é
PULADO (não conta como falha nem mexe no banco); chamado pelo nome, roda e falha com a mensagem dele.
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
            print(f'{n:32s} layer={mod.LAYER_ID:22s} source={mod.SOURCE:14s} {mod.LICENSE}{opt}')
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
        try:
            mod = importlib.import_module(f'sources.{n}')
            if run_all and missing_env(mod):
                print(f'==> {n}: pulado (opcional; falta {", ".join(missing_env(mod))})')
                skipped.append(n)
                continue
            print(f'==> {n} ({mod.LAYER_ID}/{mod.SOURCE})')
            feats = common.validate(mod.fetch())
            notes = getattr(mod, 'NOTES', None)
            if not no_seed:
                p = common.write_seed(mod.LAYER_ID, mod.SOURCE, feats, mod.SOURCE_URL, mod.LICENSE, notes)
                print(f'    seed: {p} ({p.stat().st_size/1e6:.1f} MB)')
            if not seed_only:
                common.load_db(mod.LAYER_ID, mod.SOURCE, feats, mod.SOURCE_URL, mod.LICENSE, notes)
            print(f'    ok: {len(feats)} feições em {time.time()-t0:.0f}s')
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
