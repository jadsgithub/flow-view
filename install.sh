#!/usr/bin/env bash
# Instala a skill do Flow View para agentes (Cursor / Claude Code / Codex / OpenCode).
#
# Uso (a partir de um clone local do repositório, depois de revisar o conteúdo):
#   bash install.sh cursor | claude | codex | opencode | list
#
# Este script só COPIA o arquivo SKILL.md para o diretório de skills escolhido.
# Ele não baixa nada, não usa rede e não executa código do repositório.
# Por segurança, NÃO recomendamos `curl ... | bash`: clone o repositório,
# confira a tag/assinatura da versão desejada e rode o script localmente.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="${ROOT}/SKILL.md"

usage() {
  echo "Uso: install.sh [cursor|claude|codex|opencode|list]"
  echo "  cursor   -> ~/.cursor/skills/flow-view/"
  echo "  claude   -> ~/.claude/skills/flow-view/"
  echo "  codex    -> ~/.agents/skills/flow-view/"
  echo "  opencode -> ~/.config/opencode/skills/flow-view/"
  echo "  list     -> imprime os destinos"
}

case "${1:-cursor}" in
  cursor)   SKILL_DIR="${HOME}/.cursor/skills/flow-view" ;;
  claude)   SKILL_DIR="${HOME}/.claude/skills/flow-view" ;;
  codex)    SKILL_DIR="${HOME}/.agents/skills/flow-view" ;;
  opencode) SKILL_DIR="${HOME}/.config/opencode/skills/flow-view" ;;
  list)
    echo "~/.cursor/skills/flow-view"
    echo "~/.claude/skills/flow-view"
    echo "~/.agents/skills/flow-view"
    echo "~/.config/opencode/skills/flow-view"
    exit 0
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Alvo desconhecido: $1" >&2
    usage
    exit 1
    ;;
esac

if [[ ! -f "${SKILL_SRC}" ]]; then
  echo "SKILL.md não encontrado em ${ROOT}" >&2
  exit 1
fi

mkdir -p "${SKILL_DIR}"
cp -f "${SKILL_SRC}" "${SKILL_DIR}/SKILL.md"
echo "Flow View instalado em: ${SKILL_DIR}"
echo "O CLI continua no repositório: rode  node ${ROOT}/flow-view/bin/flow-view.mjs --help"
