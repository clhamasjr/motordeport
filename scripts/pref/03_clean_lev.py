"""
03_clean_lev.py (PREFEITURAS) — Remove TODA referencia a LEV (Lev Negocios / averbadora)
do catalogo de prefeituras, preservando a regra do banco ao redor.

Reaproveita as regras do limpador federal (scripts/fed/03_clean_lev.py) apontando
para scripts/pref/convenios.json. Mesmo padrao do scripts/gov/03_clean_lev.py.

Roda DEPOIS do 02_parse.py e ANTES do 05_compact_seed.py (decisao do dono em 17/09/2026:
a LhamasCred nao opera mais via LEV — remover em federal, governos e prefeituras).
No seed de 05/05/2026 a LEV aparecia ~1.467x (+518 e-mails @levnegocios) em 420 convenios.
    python scripts/pref/02_parse.py
    python scripts/pref/03_clean_lev.py     <-- este
    python scripts/pref/05_compact_seed.py
"""
import sys, importlib.util
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

HERE = Path(__file__).parent
FED = HERE.parent / 'fed' / '03_clean_lev.py'

spec = importlib.util.spec_from_file_location('clean_lev_fed', FED)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.JSON_PATH = HERE / 'convenios.json'

if __name__ == '__main__':
    mod.main()
