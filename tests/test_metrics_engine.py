import pytest
from api.metrics_engine import calculate_structural_diff

def test_structural_diff_identical():
    ia_roteiro = [{"passo": 1, "texto": "A"}, {"passo": 2, "texto": "B"}]
    human_roteiro = [{"passo": 1, "texto": "A"}, {"passo": 2, "texto": "B"}]
    diff = calculate_structural_diff(ia_roteiro, human_roteiro)
    assert diff == 0.0

def test_structural_diff_totally_different():
    ia_roteiro = [{"passo": 1, "texto": "AAAA"}]
    human_roteiro = [{"passo": 1, "texto": "BBBB"}]
    diff = calculate_structural_diff(ia_roteiro, human_roteiro)
    assert diff > 0.0  # Deveria ser 100.0 se não fosse o thresholding

def test_structural_diff_partial():
    ia_roteiro = [
        {"passo": 1, "texto": "O rato roeu a roupa"},
        {"passo": 2, "texto": "B"}
    ]
    human_roteiro = [
        {"passo": 1, "texto": "O rato roeu a roupa do rei"},
        {"passo": 2, "texto": "B"}
    ]
    diff = calculate_structural_diff(ia_roteiro, human_roteiro)
    assert diff == 50.0

def test_structural_diff_empty():
    assert calculate_structural_diff([], []) == 0.0
    assert calculate_structural_diff([{"passo": 1, "texto": "A"}], []) == 0.0
