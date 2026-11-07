/**
 * Redação de segredos.
 *
 * O diagrama gerado embute trechos do código-fonte analisado. Se alguém deixou
 * uma chave de API ou senha "chumbada" no código, ela NÃO deve ir parar num
 * HTML que será compartilhado. Esta etapa troca valores que parecem segredos
 * por um marcador antes de gravar `flow.json` e `index.html`.
 *
 * É uma rede de proteção (heurística), não uma garantia: nunca versione
 * segredos no código e revise o HTML antes de publicá-lo.
 */

export const REDACTED = "«segredo removido»";

/** Padrões de credenciais com formato conhecido (o match inteiro é substituído). */
const KNOWN_FORMATS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g, // AWS temporary key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g, // Stripe
  /\bnpm_[A-Za-z0-9]{36}\b/g, // npm
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, // SendGrid
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/]+:[^\s@/]+@/g, // URL com senha
];

/**
 * Um nome que sugere segredo seguido (a até 40 caracteres, sem aspas no meio) de um literal
 * de texto sem espaços. Cobre tanto o código (`password: "abc12345"`) quanto a narrativa
 * (`A variável `password` recebe `"abc12345"``). Mantém o nome e remove só o valor.
 */
const SECRET_NAME = String.raw`(?:pass(?:word|wd|phrase)|pwd|senha|secret|segredo|client[_-]?secret|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer|credential)s?`;
const ASSIGNMENT = new RegExp(
  String.raw`(\b[\w$.-]*${SECRET_NAME}[\w$]*[\`"']?[^"'\`\n]{0,40}?)(["'\`]{1,2})([^"'\`\s]{8,})(["'\`]{1,2})`,
  "gi"
);
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{20,}/g;

/** Redige segredos em uma string. */
export function redactString(s) {
  if (typeof s !== "string" || s.length < 8) return s;
  let out = s;
  for (const re of KNOWN_FORMATS) out = out.replace(re, REDACTED);
  out = out.replace(ASSIGNMENT, (_m, lead, q1, _v, q2) => `${lead}${q1}${REDACTED}${q2}`);
  out = out.replace(BEARER, `$1${REDACTED}`);
  return out;
}

/** Redige, recursivamente, todas as strings de um valor JSON (chaves não são alteradas). */
export function redactDeep(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
