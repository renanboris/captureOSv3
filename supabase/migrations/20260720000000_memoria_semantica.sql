-- SQL Schema definition for memoria_semantica and clique_reports

CREATE TABLE IF NOT EXISTS memoria_semantica (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    modulo_id VARCHAR(255) NOT NULL,
    hash_intencao VARCHAR(64) NOT NULL,
    estrategia_vencedora VARCHAR(50) NOT NULL, -- 'css_selector', 'xpath', 'texto', 'gemini_vision'
    seletor TEXT NOT NULL,
    hits INTEGER DEFAULT 1,
    falhas_consecutivas INTEGER DEFAULT 0,
    hitl_corrigido BOOLEAN DEFAULT FALSE,
    ultimo_uso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memoria_semantica_lookup 
ON memoria_semantica(org_id, modulo_id, hash_intencao);

CREATE TABLE IF NOT EXISTS clique_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) NOT NULL,
    passo INTEGER NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    reported_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clique_reports_lookup 
ON clique_reports(session_id, passo, reported_at);
