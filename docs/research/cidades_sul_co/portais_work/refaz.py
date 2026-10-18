"""Refaz pedidos que falharam por causa transitória (nx pode ser falso-negativo ~0,1%; erros de conexão; redirect http)."""
import sys
from concurrent.futures import ThreadPoolExecutor
import common
common.carrega_cache()
modo = sys.argv[1] if len(sys.argv) > 1 else 'erros'
if modo == 'erros':
    todo = [u for u, r in common._cache.items() if r['status'] == 0 and not r['nx'] and not r['err'].startswith('ssl:')]
else:
    todo = [u for u, r in common._cache.items() if r['nx']]
print(len(todo), flush=True)
with ThreadPoolExecutor(30) as ex:
    list(ex.map(lambda u: common.get(u, refaz=True), todo))
print('fim')
