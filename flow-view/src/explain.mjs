/**
 * Texto explicativo genérico por tipo de nó (sem LLM).
 * Usado apenas como fallback quando o tracer não gerou a narrativa (ex.: Python/Go).
 */

function trimSnippet(s, max = 220) {
  if (!s) return "";
  const t = String(s).trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function explainNode(n) {
  const sn = trimSnippet(n.snippet || n.technical);
  const fn = n.symbol?.functionName;
  const join = (...p) => p.filter(Boolean).join(" ");

  switch (n.type) {
    case "route_entry":
      return "A requisição HTTP chega aqui. A partir deste ponto o fluxo mostra, passo a passo, o que acontece até a resposta ao cliente.";
    case "condition":
      if (n.branch === "catch") {
        return join("Se algum passo anterior falhar, o fluxo cai aqui para tratar o erro.", sn && `Trecho: ${sn}`);
      }
      return join("O código avalia uma condição e escolhe um dos caminhos seguintes (setas “sim” e “não”).", sn && `Trecho avaliado: ${sn}`);
    case "validation":
      return join("Verifica se os dados ou permissões atendem às regras antes de seguir.", sn && `Detalhe: ${sn}`);
    case "function":
      return join(
        fn ? `Chama ${fn}, um passo de lógica do negócio ou da infraestrutura.` : "Executa uma função: um passo de processamento.",
        sn && `No código: ${sn}`
      );
    case "external_call":
      return join("Conversa com o mundo externo (rede, API ou serviço de terceiros).", sn && `Chamada: ${sn}`);
    case "return":
      return join("Encerra este trecho e devolve a resposta ao cliente (ou ao chamador).", sn && `Retorno: ${sn}`);
    case "throw":
      return join("Interrompe o caminho normal por causa de um erro.", sn && `Trecho: ${sn}`);
    case "group":
      return join("Bloco estrutural que agrupa passos (ex.: try).", sn && `Trecho: ${sn}`);
    default:
      return sn || trimSnippet(n.label) || "Etapa mapeada no fluxo da rota.";
  }
}
