import json
from pathlib import Path
import pytest
import sys
sys.path.insert(0,str(Path(__file__).parents[1]))
from scraping.worker import validate_config, WorkerError

def test_example_has_no_live_propertyhk_activation_or_guessable_identity():
    cfg=json.loads((Path(__file__).parents[1]/'config/sources.example.json').read_text(encoding='utf-8'))['sources']['propertyhk']
    assert cfg['publishEnabled'] is False
    assert cfg['id_scope_verified'] is False
    assert cfg['absence_detection_enabled'] is False
    assert cfg['id_scope'] is None
    assert all(cfg['branch_urls'][b] is None for b in ['EPS','EPT','EPW'])
    with pytest.raises(WorkerError,match='id_scope_unverified'):
        validate_config('propertyhk',cfg)
