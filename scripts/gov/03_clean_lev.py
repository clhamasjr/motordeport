"""
03_clean_lev.py (GOVERNOS) — Remove TODA referencia a LEV (Lev Negocios / averbadora)
do catalogo de governos, preservando a regra do banco ao redor.

Reaproveita as regras do limpador federal (scripts/fed/03_clean_lev.py) apontando
para scripts/gov/convenios.json. Testado em 17/09/2026: 757 campos limpos, 0 restantes.

Roda DEPOIS do 02_parse.py e ANTES do 05_compact_seed.py — SO se o dono decidir
tirar a LEV do catalogo de governos (em 17/09/2026 a LEV aparecia em 73 de 107 convenios,
principalmente em "Quem faz a reserva de margem" e "* Verificar tambem Regra LEV *").
    python scripts/gov/02_parse.py
    python scripts/gov/03_clean_lev.py     <-- este (opcional)
    python scripts/gov/05_compact_seed.py
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
