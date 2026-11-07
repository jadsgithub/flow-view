# Política de Segurança

*[English summary at the bottom](#english-summary).*

O Flow View lê código-fonte (às vezes de terceiros) e gera um arquivo HTML que as pessoas abrem no navegador e compartilham. Por isso tratamos segurança como requisito de primeira classe, e agradecemos a quem nos ajuda a manter o projeto seguro.

## Versões com suporte

Enquanto o projeto estiver na série `0.x`, apenas a **versão mais recente** recebe correções de segurança. Depois da `1.0.0`, as duas últimas séries *minor* serão suportadas.

| Versão | Suporte de segurança |
| ------ | -------------------- |
| última `0.x` | ✅ |
| anteriores   | ❌ atualize para a última |

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub:

👉 **[Reportar uma vulnerabilidade](https://github.com/jadsgithub/flow-view/security/advisories/new)**

Inclua, se possível:

- versão afetada (`flow-view --version`), sistema operacional e versão do Node.js;
- passos mínimos para reproduzir (um trecho de código/rota que dispare o problema);
- impacto esperado (execução de código, vazamento de arquivo, XSS no HTML gerado etc.);
- sugestão de correção, se tiver.

**O que você pode esperar de nós**

| Etapa | Prazo-alvo |
| ----- | ---------- |
| Confirmação de recebimento | até 3 dias corridos |
| Avaliação inicial e severidade (CVSS) | até 7 dias |
| Correção ou plano de mitigação | até 30 dias para severidade alta/crítica; até 90 dias para as demais |
| Divulgação coordenada | após a correção publicada; damos crédito a quem relatou (se desejar) |

É um projeto mantido de forma voluntária; os prazos são metas de boa-fé.

## Escopo

**Dentro do escopo**

- Execução de código ao analisar um repositório (o Flow View **nunca** deve executar o código analisado);
- Leitura de arquivos fora da `--root` (path traversal, symlinks);
- XSS ou qualquer script não autorizado no `index.html` gerado; enfraquecimento da CSP;
- Vazamento de segredos para `flow.json`/`index.html` (falhas da redação de segredos);
- Negação de serviço por entrada maliciosa (ReDoS, consumo ilimitado de memória/tempo);
- Injeção de comando em `flow-view` ou `install.sh`;
- Comprometimento da cadeia de suprimentos (workflows, releases, dependências).

**Fora do escopo**

- Vulnerabilidades no código **que você analisa** com o Flow View (a ferramenta apenas o descreve);
- Segredos que a redação heurística não reconheceu em formatos incomuns *(mas relate para melhorarmos os padrões)*;
- Ataques que exijam acesso prévio à máquina do usuário ou a edição do `index.html` gerado;
- Relatórios automáticos sem prova de conceito.

## Modelo de segurança (resumo)

| Ameaça | Mitigação |
| ------ | --------- |
| Código analisado malicioso tenta rodar algo | Análise **100% estática**: sem `eval`, sem `Function`, sem `require/import` dinâmico do alvo, sem executar o projeto |
| Import relativo (`../../etc/…`) ou symlink para ler arquivos fora do projeto | Toda leitura é validada com `realpath` e restrita à `--root`; symlinks não são seguidos na varredura |
| Arquivo gigante / entrada patológica para travar a ferramenta | Limite de 1,5 MB por arquivo, 20 mil arquivos e profundidade 24; padrões de rota escapados antes de virar regex |
| Texto do código vira HTML (XSS) | Todo texto é escapado antes de entrar no DOM; dados embutidos como JSON com `<` escapado |
| Mesmo assim, um bug de escape | **CSP** restritiva no HTML: `default-src 'none'`, script só por hash SHA-256, `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'` |
| Segredo "chumbado" no código vai parar no HTML compartilhado | **Redação de segredos** (chaves AWS/GitHub/Slack/Google/Stripe, JWT, chaves privadas, URLs com senha, `password = "…"`) antes de gravar |
| JSON adulterado via `--render-only` | Validação estrutural e redação também no caminho de renderização |
| Injeção de comando ao abrir o navegador | `spawn` sem shell, com argumentos em vetor (no Windows via `rundll32`, sem `cmd`) |
| Dependência maliciosa (supply chain) | **Zero dependências** de runtime; nenhum script de `install`; Actions fixadas por SHA; Dependabot; Dependency Review |
| Release adulterada | Releases só a partir da `main`, com **proveniência SLSA** atestada (`gh attestation verify`) e `SHA256SUMS` |
| *Prompt injection* via nomes/strings do código lidos por um agente de IA | O `SKILL.md` instrui o agente a tratar o conteúdo como dado, nunca como instrução |

Detalhes e premissas em [docs/threat-model.md](./docs/threat-model.md).

### Boas práticas para quem usa

- Revise o `index.html` antes de compartilhá-lo: ele contém **trechos do seu código**.
- Não publique `flow-view-output/` em repositórios (já está no `.gitignore`).
- Ao instalar a skill, **clone o repositório numa tag**, revise e rode `bash install.sh` localmente; evite `curl | bash`.
- Verifique a procedência de uma release:

  ```bash
  gh attestation verify flow-view-X.Y.Z.tgz --repo jadsgithub/flow-view
  sha256sum -c SHA256SUMS
  ```

## English summary

Flow View statically analyzes source code (possibly untrusted) and produces a standalone HTML file.
Please **do not open public issues for vulnerabilities**: use
[GitHub private vulnerability reporting](https://github.com/jadsgithub/flow-view/security/advisories/new).
We acknowledge reports within 3 days, triage within 7 and aim to fix high/critical issues within 30 days.
Only the latest `0.x` release is supported. In scope: code execution, path traversal outside `--root`,
XSS/CSP bypass in the generated HTML, secret leakage into the output, DoS via crafted input and
supply-chain issues. Out of scope: bugs in the code you analyze with the tool.
