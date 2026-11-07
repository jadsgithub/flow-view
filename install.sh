#!/usr/bin/env bash
# Instala o Flow View como skill de agente (Cursor, Claude Code, Codex, OpenCode).
#
# Uso (a partir de um clone local do repositório, depois de revisar o conteúdo):
#   bash install.sh                 # instala a skill em ~/.agents/skills/flow-view
#   bash install.sh all             # + atalhos (symlinks) para Cursor, Claude Code e OpenCode
#   bash install.sh cursor|claude|opencode   # só o atalho escolhido (instala a base se faltar)
#   bash install.sh --link          # modo desenvolvimento: aponta para este clone (sem copiar)
#   bash install.sh list            # mostra os destinos
#   bash install.sh uninstall       # remove a instalação e os atalhos
#
# A skill é um PACOTE AUTOCONTIDO (SKILL.md + flow-view/ com o CLI), como a skill
# do Archify: o agente roda o CLI pelo caminho absoluto da pasta instalada.
#
# Este script só COPIA arquivos locais. Ele não baixa nada, não usa rede e não
# executa código do repositório. Por segurança, NÃO recomendamos `curl ... | bash`:
# clone o repositório, confira a tag/assinatura da versão e rode localmente.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="flow-view"
BASE_DIR="${HOME}/.agents/skills/${NAME}"

# Itens que fazem parte do pacote instalado (nada de testes, CI, exemplos pesados).
PACKAGE_ITEMS=(SKILL.md LICENSE package.json README.md README.en.md CHANGELOG.md SECURITY.md flow-view)

link_targets() {
  echo "${HOME}/.cursor/skills/${NAME}"
  echo "${HOME}/.claude/skills/${NAME}"
  echo "${HOME}/.config/opencode/skills/${NAME}"
}

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

need_source() {
  [[ -f "${ROOT}/SKILL.md" && -f "${ROOT}/flow-view/bin/flow-view.mjs" ]] || {
    echo "Pacote incompleto em ${ROOT} (faltam SKILL.md ou flow-view/bin/flow-view.mjs)." >&2
    exit 1
  }
  command -v node >/dev/null 2>&1 || echo "Aviso: Node.js 18+ não encontrado no PATH; a skill precisa dele para rodar." >&2
}

# Remove um destino que NÓS criamos (symlink ou diretório da skill), sem seguir links.
remove_target() {
  local t="$1"
  if [[ -L "$t" || -e "$t" ]]; then
    case "$t" in
      */"${NAME}") rm -rf -- "$t" ;;
      *) echo "Recusando remover caminho inesperado: $t" >&2; exit 1 ;;
    esac
  fi
}

install_base() {
  need_source
  mkdir -p "$(dirname "${BASE_DIR}")"
  if [[ "${MODE_LINK}" == "1" ]]; then
    remove_target "${BASE_DIR}"
    ln -s "${ROOT}" "${BASE_DIR}"
    echo "Skill (modo desenvolvimento) -> ${BASE_DIR}  =>  ${ROOT}"
    return
  fi
  local tmp
  tmp="$(mktemp -d "$(dirname "${BASE_DIR}")/.${NAME}.XXXXXX")"
  for item in "${PACKAGE_ITEMS[@]}"; do
    [[ -e "${ROOT}/${item}" ]] && cp -R "${ROOT}/${item}" "${tmp}/${item}"
  done
  remove_target "${BASE_DIR}"
  mv "${tmp}" "${BASE_DIR}"
  chmod -R go-w "${BASE_DIR}"
  echo "Skill instalada em: ${BASE_DIR}"
}

link_one() {
  local dest="$1"
  mkdir -p "$(dirname "${dest}")"
  remove_target "${dest}"
  ln -s "${BASE_DIR}" "${dest}"
  echo "Atalho: ${dest} -> ${BASE_DIR}"
}

MODE_LINK=0
ACTION="base"
ARGS=()
for a in "$@"; do
  case "$a" in
    --link) MODE_LINK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
ACTION="${ARGS[0]:-base}"

case "${ACTION}" in
  base|agents|codex)
    install_base
    ;;
  all)
    install_base
    while IFS= read -r t; do link_one "$t"; done < <(link_targets)
    ;;
  cursor)   install_base; link_one "${HOME}/.cursor/skills/${NAME}" ;;
  claude)   install_base; link_one "${HOME}/.claude/skills/${NAME}" ;;
  opencode) install_base; link_one "${HOME}/.config/opencode/skills/${NAME}" ;;
  list)
    echo "${BASE_DIR}   (instalação principal; também lida por Cursor e Codex)"
    link_targets
    exit 0
    ;;
  uninstall)
    while IFS= read -r t; do remove_target "$t"; done < <(link_targets)
    remove_target "${BASE_DIR}"
    echo "Flow View removido."
    exit 0
    ;;
  *)
    echo "Alvo desconhecido: ${ACTION}" >&2
    usage >&2
    exit 1
    ;;
esac

echo
echo "Pronto. No agente, peça por exemplo:"
echo "  \"Use o Flow View e mostre o fluxo de POST /api/orders\""
echo "Teste rápido (CLI): node ${BASE_DIR}/flow-view/bin/flow-view.mjs --help"
