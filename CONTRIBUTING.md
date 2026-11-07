# Contribuindo com o Flow View

Obrigado pelo interesse! Este guia explica como contribuir de forma rápida e segura.
Ao participar, você concorda com o [Código de Conduta](./CODE_OF_CONDUCT.md).

> 🔐 **Encontrou uma vulnerabilidade?** Não abra issue pública. Siga a [Política de Segurança](./SECURITY.md).

## Ambiente

Requisitos: **Node.js 18+** e git. O projeto **não tem dependências**: não existe `npm install` a fazer.

```bash
git clone https://github.com/jadsgithub/flow-view.git
cd flow-view
npm run verify        # sintaxe + versões + testes
npm run demo          # gera o diagrama do app de exemplo
```

## Fluxo de trabalho

1. Abra (ou comente) uma issue descrevendo o problema/ideia antes de mudanças grandes.
2. Faça um *fork* e crie uma branch a partir da `main`: `git switch -c fix/descricao-curta`.
3. Faça mudanças pequenas e focadas, **com testes** (`test/*.test.mjs`, usando `node:test`).
4. Rode `npm run verify`.
5. Abra o PR preenchendo o template. A `main` é protegida: PR + CI verde + commits assinados + histórico linear.

## Commits: Conventional Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/pt-br/) porque eles alimentam o
versionamento e o changelog:

| Tipo | Quando usar | Efeito no SemVer |
| ---- | ----------- | ---------------- |
| `fix:` | correção de bug | PATCH |
| `feat:` | nova funcionalidade | MINOR |
| `feat!:` / rodapé `BREAKING CHANGE:` | quebra de compatibilidade (flags, formato do `flow.json`) | MAJOR |
| `security:` / `fix(security):` | correção de segurança | PATCH (ou maior) |
| `docs:` `test:` `refactor:` `perf:` `ci:` `chore:` | sem mudança de comportamento | nenhum |

Exemplo: `fix(scanner): escapar metacaracteres do padrão de rota`

### Commits assinados

Todos os commits na `main` precisam ser **assinados** (GPG, SSH ou S/MIME): veja
[Assinando commits](https://docs.github.com/pt/authentication/managing-commit-signature-verification).
Habilite o selo "Verified" no seu GitHub antes do primeiro PR.

## Regras do projeto

- **Sem dependências novas.** Se for realmente necessário, justifique no PR (tamanho, manutenção, licença, risco).
- **Nunca execute o código analisado** e nunca leia fora da `--root` (use `isInside()` de `src/security.mjs`).
- Todo texto que vem do código analisado e entra no HTML precisa passar por `esc()`/`rich()`.
- Não inclua segredos, caminhos locais nem dados reais em código, fixtures ou exemplos.
- Atualize o `CHANGELOG.md` (seção `[Unreleased]`) em mudanças visíveis ao usuário.
- Mantenha o estilo existente (ESM, sem ponto e vírgula opcional inventado, comentários em português).

## Versionamento e releases

Seguimos [SemVer 2.0.0](https://semver.org/lang/pt-BR/). A versão vive em **um único lugar**
(`package.json`) e é conferida contra `.cursor-plugin/plugin.json`, `CHANGELOG.md` e a tag
pelo `scripts/check.mjs`. O processo completo de release (somente mantenedores) está em
[docs/releasing.md](./docs/releasing.md).

## O que é uma boa contribuição?

- Novo framework no scanner (ex.: Koa, NestJS, Laravel) com **testes e exemplo**;
- Melhoria da narrativa em português (ou tradução para outros idiomas);
- Mais padrões de detecção de segredos (com casos de teste para falsos positivos);
- Acessibilidade e responsividade do viewer;
- Correção de bugs reproduzíveis com um trecho mínimo de handler.
