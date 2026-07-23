import re
from typing import Optional, Dict

def anonymize_text(text: str, config: Optional[Dict[str, bool]] = None) -> str:
    """
    Remove ou ofusca dados sensíveis de um texto usando Expressões Regulares,
    garantindo que dados não desejados não sejam enviados para modelos de IA de terceiros.
    Aceita um dicionário de configurações com booleans para: 'cpf', 'cnpj', 'email', 'telefone'.
    """
    if not text:
        return text
        
    if config is None:
        config = {"cpf": True, "cnpj": True, "email": False, "telefone": False}

    # CPF (formatado ou não) - Ex: 123.456.789-00 ou 12345678900
    if config.get("cpf", True):
        cpf_pattern = r'\b(?:\d{3}\.){2}\d{3}-\d{2}\b|\b\d{11}\b'
        text = re.sub(cpf_pattern, "[CPF OMITIDO]", text)

    # CNPJ (formatado ou não) - Ex: 12.345.678/0001-90 ou 12345678000190
    if config.get("cnpj", True):
        cnpj_pattern = r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b|\b\d{14}\b'
        text = re.sub(cnpj_pattern, "[CNPJ OMITIDO]", text)

    # E-mail
    if config.get("email", False):
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        text = re.sub(email_pattern, "[EMAIL OMITIDO]", text)

    # Telefone (formatado ou não)
    if config.get("telefone", False):
        phone_pattern = r'\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4}\b'
        text = re.sub(phone_pattern, "[TELEFONE OMITIDO]", text)

    return text

