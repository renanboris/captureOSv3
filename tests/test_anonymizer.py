import pytest
from api.anonymizer import anonymize_text

def test_anonymize_cpf():
    assert anonymize_text("Meu CPF é 123.456.789-00 e nada mais.") == "Meu CPF é [CPF OMITIDO] e nada mais."
    assert anonymize_text("CPF sem pontuacao: 12345678900.") == "CPF sem pontuacao: [CPF OMITIDO]."

def test_anonymize_cnpj():
    assert anonymize_text("A empresa X, CNPJ 12.345.678/0001-90.") == "A empresa X, CNPJ [CNPJ OMITIDO]."
    assert anonymize_text("CNPJ cru: 12345678000190") == "CNPJ cru: [CNPJ OMITIDO]"

def test_anonymize_mixed():
    text = "O João, CPF 123.456.789-00, abriu a empresa CNPJ 12.345.678/0001-90."
    expected = "O João, CPF [CPF OMITIDO], abriu a empresa CNPJ [CNPJ OMITIDO]."
    assert anonymize_text(text) == expected

def test_anonymize_empty_and_clean():
    assert anonymize_text("") == ""
    assert anonymize_text("Um texto totalmente normal e limpo.") == "Um texto totalmente normal e limpo."
    # 10 digits is not a CPF
    assert anonymize_text("1234567890") == "1234567890"
