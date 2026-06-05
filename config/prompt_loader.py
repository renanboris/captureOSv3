"""Carregador de prompts versionados (prompts/).

Fonte única de verdade dos prompts dos agentes de IA. Lê os arquivos ``.txt`` em
``prompts/``, resolve as diretivas ``[[INCLUDE: rel]]`` (inlining dos blocos
compartilhados) e extrai a SYSTEM INSTRUCTION.

Formato dos arquivos de agente
-------------------------------
Cada arquivo tem três partes, delimitadas por linhas exatas:

    # ... cabeçalho de documentação (não vai ao modelo) ...
    ===SYSTEM===
    ... system_instruction (persona + regras + formato de saída) ...
    ===USER===
    ... template de conteúdo do usuário (placeholders {var}) ...

Regras:
- Tudo ANTES de ``===SYSTEM===`` é cabeçalho de documentação e é ignorado.
- O texto entre ``===SYSTEM===`` e ``===USER===`` é a system_instruction.
- O texto após ``===USER===`` é o template do usuário (não usado pelo loader).
- ``[[INCLUDE: rel]]`` dentro da seção SYSTEM é substituído pelo conteúdo do
  arquivo referenciado (relativo ao diretório do prompt pai).
- ``[[INCLUDE:...]]`` em linhas de comentário ``#`` do cabeçalho é ignorado.

Os blocos compartilhados em ``prompts/shared/*.txt`` são texto puro sem delimitadores.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

# prompts/ fica na raiz do repositório (irmão de config/).
PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

_INCLUDE_RE = re.compile(r"^\[\[INCLUDE:\s*(.+?)\s*\]\]\s*$")

_DELIM_SYSTEM = "===SYSTEM==="
_DELIM_USER   = "===USER==="


def _resolve_includes(text: str, base_dir: Path, _seen: frozenset[Path] = frozenset()) -> str:
    """Substitui cada ``[[INCLUDE: rel]]`` (em linha própria) pelo conteúdo do arquivo.

    Resolve recursivamente; protege contra ciclos via ``_seen``.
    Linhas que começam com ``#`` são ignoradas (não expandidas).
    """
    out_lines: list[str] = []
    for line in text.splitlines():
        # Comentários de documentação: nunca expandir includes neles.
        if line.lstrip().startswith("#"):
            out_lines.append(line)
            continue

        m = _INCLUDE_RE.match(line.strip())
        if m:
            rel = m.group(1)
            target = (base_dir / rel).resolve()
            if target in _seen:
                continue  # ciclo: ignora silenciosamente
            if not target.exists():
                raise FileNotFoundError(
                    f"Include não encontrado: {rel!r} "
                    f"(referenciado a partir de {base_dir})"
                )
            content = target.read_text(encoding="utf-8")
            expanded = _resolve_includes(content, target.parent, _seen | {target})
            out_lines.append(expanded)
        else:
            out_lines.append(line)

    return "\n".join(out_lines)


@lru_cache(maxsize=None)
def _load_system(prompt_name: str) -> str:
    """Carrega e devolve a system instruction extraída do prompt. Cacheado."""
    path = (PROMPTS_DIR / prompt_name).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Prompt não encontrado: {prompt_name} ({path})")

    raw = path.read_text(encoding="utf-8")

    # Encontra os delimitadores (compara a linha strip()ada).
    lines = raw.splitlines()
    sys_start = next(
        (i for i, l in enumerate(lines) if l.strip() == _DELIM_SYSTEM), None
    )
    user_start = next(
        (i for i, l in enumerate(lines) if l.strip() == _DELIM_USER), None
    )

    if sys_start is None:
        raise ValueError(
            f"Delimitador '{_DELIM_SYSTEM}' não encontrado em {prompt_name}"
        )
    if user_start is None or user_start <= sys_start:
        raise ValueError(
            f"Delimitador '{_DELIM_USER}' não encontrado (ou fora de ordem) em {prompt_name}"
        )

    # Extrai as linhas da system_instruction (entre os dois delimitadores).
    system_raw = "\n".join(lines[sys_start + 1 : user_start])

    # Resolve includes apenas na seção system.
    return _resolve_includes(system_raw, path.parent).strip()


def load_system_instruction(prompt_name: str) -> str:
    """Devolve a SYSTEM INSTRUCTION completa de um agente.

    Lê ``prompts/<prompt_name>``, extrai o conteúdo entre ``===SYSTEM===`` e
    ``===USER===``, resolve todos os ``[[INCLUDE: ...]]`` e devolve o texto pronto
    para passar ao modelo como ``system_instruction``.

    Parameters
    ----------
    prompt_name:
        Nome do arquivo em ``prompts/``, ex.: ``"motor_intencao.v1.txt"``.
    """
    return _load_system(prompt_name)


def clear_cache() -> None:
    """Limpa o cache de prompts (útil em testes que editam arquivos)."""
    _load_system.cache_clear()
