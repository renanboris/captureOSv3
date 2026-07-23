import pytest
from api.anonymizer import anonymize_text
from api.db_services import save_organization_settings, get_organization_settings
from api.intelligence_engine import _anonymize_if_enabled

def test_anonymize_granular_types():
    raw_text = "João com CPF 123.456.789-00, CNPJ 12.345.678/0001-90, email joao@exemplo.com e fone (47) 99999-8888."

    # Standard (only CPF & CNPJ)
    res_default = anonymize_text(raw_text)
    assert "[CPF OMITIDO]" in res_default
    assert "[CNPJ OMITIDO]" in res_default
    assert "joao@exemplo.com" in res_default

    # Custom: Only CPF
    res_cpf_only = anonymize_text(raw_text, config={"cpf": True, "cnpj": False, "email": False, "telefone": False})
    assert "[CPF OMITIDO]" in res_cpf_only
    assert "12.345.678/0001-90" in res_cpf_only
    assert "joao@exemplo.com" in res_cpf_only

    # Custom: Email & Telefone enabled
    res_email_phone = anonymize_text(raw_text, config={"cpf": False, "cnpj": False, "email": True, "telefone": True})
    assert "123.456.789-00" in res_email_phone
    assert "12.345.678/0001-90" in res_email_phone
    assert "[EMAIL OMITIDO]" in res_email_phone
    assert "[TELEFONE OMITIDO]" in res_email_phone

def test_organization_settings_anonymization():
    org_id = "test_org_privacy_toggle"

    # Save custom org settings with anonymization disabled
    save_organization_settings(org_id, {
        "disable_whitelist": True,
        "allowed_domains": ["localhost"],
        "anonimizacao_ativa": False,
        "anonimizar_tipos": {"cpf": True, "cnpj": True, "email": False, "telefone": False}
    })

    settings = get_organization_settings(org_id)
    assert settings["anonimizacao_ativa"] is False

    raw_text = "CPF 123.456.789-00"
    processed = _anonymize_if_enabled(raw_text, org_id)
    assert processed == raw_text  # Preserved because anonimizacao_ativa = False

    # Enable anonymization for org
    save_organization_settings(org_id, {
        "disable_whitelist": True,
        "allowed_domains": ["localhost"],
        "anonimizacao_ativa": True,
        "anonimizar_tipos": {"cpf": True, "cnpj": False, "email": False, "telefone": False}
    })

    processed_enabled = _anonymize_if_enabled(raw_text, org_id)
    assert "[CPF OMITIDO]" in processed_enabled
