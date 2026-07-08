import re

def anonymize_text(text: str) -> str:
    """
    Remove ou ofusca CPFs e CNPJs de um texto usando Expressões Regulares,
    garantindo que dados sensíveis não sejam enviados para modelos de IA de terceiros (Gemini).
    """
    if not text:
        return text
        
    # RegEx para CPF (formatado ou não) - Ex: 123.456.789-00 ou 12345678900
    cpf_pattern = r'\b(?:\d{3}\.){2}\d{3}-\d{2}\b|\b\d{11}\b'
    
    # RegEx para CNPJ (formatado ou não) - Ex: 12.345.678/0001-90 ou 12345678000190
    cnpj_pattern = r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b|\b\d{14}\b'
    
    # Substituir por tag de ofuscação
    text = re.sub(cpf_pattern, "[CPF OMITIDO]", text)
    text = re.sub(cnpj_pattern, "[CNPJ OMITIDO]", text)
    
    return text
