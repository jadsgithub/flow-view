/**
 * Tradução de código JS em português narrativo (sem LLM): condições, atribuições,
 * chamadas, respostas HTTP e erros. Convenção de texto: `código` e **destaque**.
 */

import {
  splitTop,
  findTopOp,
  stripParens,
  splitArgs,
  matchClose,
  skipString,
} from "./jsparse.mjs";

const STATUS_TEXT = {
  200: "OK",
  201: "Criado",
  202: "Aceito",
  204: "Sem conteúdo",
  301: "Movido",
  302: "Redirecionamento",
  304: "Não modificado",
  400: "Requisição inválida",
  401: "Não autorizado",
  402: "Pagamento necessário",
  403: "Proibido",
  404: "Não encontrado",
  405: "Método não permitido",
  409: "Conflito",
  410: "Removido",
  413: "Conteúdo grande demais",
  415: "Formato não suportado",
  422: "Dados inválidos",
  429: "Muitas requisições",
  500: "Erro interno",
  501: "Não implementado",
  502: "Falha no serviço de origem",
  503: "Serviço indisponível",
  504: "Tempo esgotado",
};

export function statusText(n) {
  const k = Number(n);
  if (STATUS_TEXT[k]) return STATUS_TEXT[k];
  if (k >= 500) return "Erro do servidor";
  if (k >= 400) return "Erro do cliente";
  if (k >= 300) return "Redirecionamento";
  return "Sucesso";
}

/** "o corpo" → "do corpo"; "os campos" → "dos campos"; demais → "de X". */
export const de = (s) => (/^o /.test(s) ? "d" + s : /^os /.test(s) ? "d" + s : /^a /.test(s) ? "d" + s : /^as /.test(s) ? "d" + s : "de " + s);

export const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";

export function trunc(s, n = 80) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

const unq = (s) => s.replace(/\?$/, "");
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const STR_RE = /^(["'`])(?:\\.|(?!\1)[^\\])*\1$/s;
const isStringLit = (e) => STR_RE.test(e.trim());
const isLiteral = (e) => {
  const t = e.trim();
  return isStringLit(t) || /^-?\d+(\.\d+)?$/.test(t) || /^(true|false|null|undefined)$/.test(t);
};

/* ------------------------------------------------------------------ */
/* Expressões → frase                                                  */
/* ------------------------------------------------------------------ */

const REQ_FIELD = {
  query: (n) => `o parâmetro de query ${code(n)}`,
  body: (n) => `o campo ${code(n)} do corpo (body)`,
  params: (n) => `o parâmetro de rota ${code(n)}`,
  headers: (n) => `o cabeçalho ${code(n)}`,
  cookies: (n) => `o cookie ${code(n)}`,
};
const REQ_WHOLE = {
  query: "os parâmetros de query",
  body: "o corpo (body) da requisição",
  params: "os parâmetros de rota",
  headers: "os cabeçalhos da requisição",
  cookies: "os cookies",
};

/** Retorna { kind, name } se a expressão lê dados da requisição. */
export function requestRead(e) {
  const t = stripParens(e.trim().replace(/^await\s+/, ""));
  let m = t.match(/^(?:req|request)\.(query|body|params|headers|cookies)\??\.([\w$]+)$/);
  if (m) return { kind: m[1], name: m[2] };
  m = t.match(/^(?:req|request)\.(query|body|params|headers|cookies)\??\[\s*["']([^"']+)["']\s*\]$/);
  if (m) return { kind: m[1], name: m[2] };
  m = t.match(/^(?:req|request)\.(query|body|params|headers|cookies)$/);
  if (m) return { kind: m[1], name: null };
  m = t.match(/^c\.req\.(query|param|header)\(\s*["']([^"']+)["']\s*\)$/);
  if (m) return { kind: m[1] === "param" ? "params" : m[1] === "header" ? "headers" : "query", name: m[2] };
  return null;
}

export function describeExpr(raw) {
  let e = String(raw).trim().replace(/^await\s+/, "");
  e = stripParens(e);
  if (!e) return code("");
  if (isStringLit(e) || /^-?\d+(\.\d+)?$/.test(e)) return code(e);
  if (e === "true") return "verdadeiro";
  if (e === "false") return "falso";
  if (e === "null" || e === "undefined") return "vazio (nulo)";

  const rr = requestRead(e);
  if (rr) return rr.name ? REQ_FIELD[rr.kind](rr.name) : REQ_WHOLE[rr.kind];
  if (/^(?:req|request)\.user$/.test(e)) return `o usuário autenticado (${code(e)})`;

  for (const op of ["||", "??"]) {
    const p = splitTop(e, op);
    if (p && p.length === 2 && isLiteral(p[1])) {
      return `${describeExpr(p[0])} (se ausente, usa ${describeExpr(p[1])})`;
    }
  }

  const conv = e.match(/^(String|Number|Boolean|parseInt|parseFloat)\(([\s\S]*)\)$/);
  if (conv && matchClose(e, e.indexOf("(")) === e.length - 1) {
    const to = { String: "texto", Number: "número", Boolean: "verdadeiro/falso", parseInt: "número inteiro", parseFloat: "número" }[conv[1]];
    return `${describeExpr(conv[2])}, convertido para ${to}`;
  }

  const idxM = e.match(/^([\w$]+(?:\??\.[\w$]+)*)\[([\s\S]+)\]$/);
  if (idxM && matchClose(e, e.indexOf("[")) === e.length - 1) {
    return `o item de ${code(idxM[1])} cuja chave é ${describeExpr(idxM[2])}`;
  }

  if (/^\{[\s\S]*\}$/.test(e)) return `um objeto ${code(trunc(e, 50))}`;
  if (/^\[[\s\S]*\]$/.test(e)) return `uma lista ${code(trunc(e, 50))}`;

  const call = e.match(/^(?:new\s+)?[\w$.?]+\s*\(/);
  if (call && matchClose(e, e.indexOf("(")) === e.length - 1) {
    return `o resultado de ${code(trunc(e, 60))}`;
  }
  return code(trunc(e, 60));
}

/* ------------------------------------------------------------------ */
/* Nomes → verbos                                                      */
/* ------------------------------------------------------------------ */

const VERBS = {
  check: "Verifica", verify: "Verifica", validate: "Valida", ensure: "Garante", assert: "Garante",
  is: "Checa se é", has: "Checa se tem", can: "Checa se pode", load: "Carrega", get: "Obtém",
  fetch: "Busca", find: "Busca", read: "Lê", list: "Lista", query: "Consulta", create: "Cria",
  insert: "Insere", save: "Salva", store: "Armazena", add: "Adiciona", update: "Atualiza",
  set: "Define", delete: "Remove", remove: "Remove", destroy: "Remove", send: "Envia",
  notify: "Notifica", publish: "Publica", emit: "Dispara evento", calculate: "Calcula",
  compute: "Calcula", parse: "Interpreta", format: "Formata", build: "Monta", map: "Converte",
  transform: "Transforma", apply: "Aplica", process: "Processa", handle: "Trata",
  authenticate: "Autentica", authorize: "Autoriza", charge: "Cobra", pay: "Processa pagamento de",
  reserve: "Reserva", cancel: "Cancela", confirm: "Confirma", generate: "Gera", hash: "Gera hash de",
  sign: "Assina", encrypt: "Criptografa", decrypt: "Descriptografa", register: "Registra",
  login: "Autentica", logout: "Encerra sessão de", refresh: "Renova", sync: "Sincroniza",
  upload: "Envia arquivo de", download: "Baixa", render: "Renderiza", resolve: "Resolve",
  apply_: "Aplica",
};

function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase());
}

/** `loadUser` → { title: "Carrega user", verb: "Carrega", noun: "user" } */
export function humanizeName(name) {
  const w = words(name);
  const verb = VERBS[w[0]];
  const rest = w.slice(1).map((x) => (x === "by" ? "por" : x)).join(" ");
  if (!verb) return { title: `Executa ${name}`, verb: null, noun: w.join(" ") };
  return { title: rest ? `${verb} ${rest}` : verb, verb, noun: rest };
}

const AUTH_RE = /auth|login|token|session|jwt|credential/i;
const PERM_RE = /permission|authori[sz]e|role|admin|\bacl\b|can[A-Z]|isOwner|hasAccess|policy/i;
const VALID_RE = /valid|schema|sanitiz|isEmail|isUUID/i;

/* ------------------------------------------------------------------ */
/* Condições                                                           */
/* ------------------------------------------------------------------ */

const mk = (q, nq, pos, neg) => ({ q, nq, pos, neg });
const swap = (d) => ({ q: d.nq, nq: d.q, pos: d.neg, neg: d.pos });

const CMP = ["===", "!==", "==", "!=", ">=", "<=", ">", "<"];

function hasBoolOp(e) {
  if (findTopOp(e, CMP)) return true;
  if (/^!/.test(e)) return true;
  if (splitTop(e, "&&")) return true;
  const p = splitTop(e, "||");
  return Boolean(p && p.some(hasBoolOp));
}

export function isConditionLike(raw) {
  return hasBoolOp(stripParens(String(raw).trim().replace(/^await\s+/, "")));
}

const LEN_PHRASE = {
  "===": (n) => (n === "0" ? "estiver vazio" : `tiver exatamente ${n} item(ns)`),
  "==": (n) => (n === "0" ? "estiver vazio" : `tiver exatamente ${n} item(ns)`),
  "!==": (n) => (n === "0" ? "tiver itens" : `não tiver exatamente ${n} item(ns)`),
  "!=": (n) => (n === "0" ? "tiver itens" : `não tiver exatamente ${n} item(ns)`),
  ">": (n) => (n === "0" ? "tiver itens" : `tiver mais de ${n} item(ns)`),
  ">=": (n) => (n === "1" ? "tiver itens" : `tiver pelo menos ${n} item(ns)`),
  "<": (n) => (n === "1" ? "estiver vazio" : `tiver menos de ${n} item(ns)`),
  "<=": (n) => (n === "0" ? "estiver vazio" : `tiver no máximo ${n} item(ns)`),
};
const LEN_NEG = {
  "estiver vazio": "tiver itens",
  "tiver itens": "estiver vazio",
};
const NUM_OP = {
  ">": ["for maior que", "for menor ou igual a"],
  ">=": ["for maior ou igual a", "for menor que"],
  "<": ["for menor que", "for maior ou igual a"],
  "<=": ["for menor ou igual a", "for maior que"],
};
const TYPE_PT = {
  string: "texto", number: "número", boolean: "verdadeiro/falso", object: "objeto",
  function: "função", undefined: "indefinido",
};

function describeCallCondition(path, argsStr) {
  const segs = path.split(/\??\./);
  const name = segs[segs.length - 1];
  const recv = segs.slice(0, -1).join(".");
  const args = splitArgs(argsStr);
  const a0 = args[0] ? describeExpr(args[0]) : "";
  const callCode = code(trunc(`${path}(${argsStr})`, 60));

  if (name === "isArray" && /Array$/.test(recv)) {
    return mk(`${cap(a0)} é uma lista?`, `${cap(a0)} NÃO é uma lista?`, `${a0} for uma lista`, `${a0} não for uma lista`);
  }
  if (/^(includes|has)$/.test(name) && recv) {
    const r = describeExpr(recv);
    return mk(`${cap(r)} contém ${a0}?`, `${cap(r)} NÃO contém ${a0}?`, `${r} contiver ${a0}`, `${r} não contiver ${a0}`);
  }
  if (/^(startsWith|endsWith)$/.test(name) && recv) {
    const r = describeExpr(recv);
    const w = name === "startsWith" ? "começa com" : "termina com";
    return mk(`${cap(r)} ${w} ${a0}?`, `${cap(r)} NÃO ${w} ${a0}?`, `${r} ${w === "começa com" ? "começar com" : "terminar com"} ${a0}`, `${r} não ${w === "começa com" ? "começar com" : "terminar com"} ${a0}`);
  }
  if (name === "test" && /^\/.*\/[gimsuy]*$/.test(recv)) {
    return mk(`${cap(a0)} segue o formato esperado?`, `${cap(a0)} NÃO segue o formato esperado?`, `${a0} seguir o formato esperado (${code(recv)})`, `${a0} não seguir o formato esperado (${code(recv)})`);
  }
  if (PERM_RE.test(name)) {
    return mk("O usuário tem permissão?", "O usuário NÃO tem permissão?", `o usuário tiver permissão (${callCode} retorna verdadeiro)`, `o usuário não tiver permissão (${callCode} retorna falso)`);
  }
  if (AUTH_RE.test(name)) {
    return mk("O usuário está autenticado?", "O usuário NÃO está autenticado?", `a autenticação for válida (${callCode} retorna verdadeiro)`, `a autenticação falhar (${callCode} retorna falso)`);
  }
  if (VALID_RE.test(name)) {
    return mk("Os dados são válidos?", "Os dados são inválidos?", `os dados forem válidos (${callCode} retorna verdadeiro)`, `os dados forem inválidos (${callCode} retorna falso)`);
  }
  const h = humanizeName(name);
  const what = h.verb ? h.title.toLowerCase() : callCode;
  return mk(`${cap(what)} dá positivo? (${callCode})`, `${cap(what)} dá negativo? (${callCode})`, `${callCode} retornar verdadeiro`, `${callCode} retornar falso`);
}

export function describeCondition(raw) {
  let e = stripParens(String(raw).trim().replace(/\bawait\s+/g, ""));

  let p = splitTop(e, "||");
  if (p) {
    const ds = p.map(describeCondition);
    return mk(
      ds.map((d) => unq(d.q)).join(" ou ") + "?",
      ds.map((d) => unq(d.nq)).join(" e ") + "?",
      ds.map((d) => d.pos).join(" ou "),
      ds.map((d) => d.neg).join(" e ")
    );
  }
  p = splitTop(e, "&&");
  if (p) {
    const ds = p.map(describeCondition);
    return mk(
      ds.map((d) => unq(d.q)).join(" e ") + "?",
      ds.map((d) => unq(d.nq)).join(" ou ") + "?",
      ds.map((d) => d.pos).join(" e "),
      ds.map((d) => d.neg).join(" ou ")
    );
  }

  if (e.startsWith("!") && !e.startsWith("!=")) return swap(describeCondition(e.slice(1)));

  const cmp = findTopOp(e, CMP);
  if (cmp) {
    const L = e.slice(0, cmp.i).trim();
    const R = e.slice(cmp.i + cmp.op.length).trim();
    const op = cmp.op;
    const isEq = op === "===" || op === "==";
    const isNe = op === "!==" || op === "!=";

    if ((isEq || isNe) && /^(null|undefined|void 0)$/.test(R)) {
      const l = describeExpr(L);
      const d = mk(`${cap(l)} está ausente (nulo)?`, `${cap(l)} está presente?`, `${l} estiver ausente (nulo)`, `${l} estiver presente`);
      return isNe ? swap(d) : d;
    }
    const ty = L.match(/^typeof\s+(.+)$/);
    if ((isEq || isNe) && ty && isStringLit(R)) {
      const t = R.trim().slice(1, -1);
      const l = describeExpr(ty[1]);
      const tp = TYPE_PT[t] || t;
      const d = mk(`${cap(l)} é do tipo ${tp}?`, `${cap(l)} NÃO é do tipo ${tp}?`, `${l} for do tipo ${tp}`, `${l} não for do tipo ${tp}`);
      return isNe ? swap(d) : d;
    }
    const len = L.match(/^(.+?)\??\.length$/);
    if (len && /^\d+$/.test(R)) {
      const l = describeExpr(len[1]);
      const pos = LEN_PHRASE[op](R);
      const neg = LEN_NEG[pos] || `não ${pos}`;
      const q = pos === "estiver vazio" ? `${cap(l)} está vazio?` : pos === "tiver itens" ? `${cap(l)} tem itens?` : `${cap(l)} ${pos.replace(/^tiver/, "tem").replace(/^não tiver/, "NÃO tem")}?`;
      const nq = neg === "estiver vazio" ? `${cap(l)} está vazio?` : neg === "tiver itens" ? `${cap(l)} tem itens?` : `${cap(l)} ${neg.replace(/^tiver/, "tem").replace(/^não tiver/, "NÃO tem")}?`;
      return mk(q, nq, `${l} ${pos}`, `${l} ${neg}`);
    }
    const l = describeExpr(L);
    const r = describeExpr(R);
    if (isEq) return mk(`${cap(l)} é igual a ${r}?`, `${cap(l)} é diferente de ${r}?`, `${l} for igual a ${r}`, `${l} for diferente de ${r}`);
    if (isNe) return mk(`${cap(l)} é diferente de ${r}?`, `${cap(l)} é igual a ${r}?`, `${l} for diferente de ${r}`, `${l} for igual a ${r}`);
    const [pw, nw] = NUM_OP[op];
    return mk(`${cap(l)} ${pw.replace("for", "é")} ${r}?`, `${cap(l)} ${nw.replace("for", "é")} ${r}?`, `${l} ${pw} ${r}`, `${l} ${nw} ${r}`);
  }

  const callM = e.match(/^([\w$.?]+)\s*\(/);
  if (callM && matchClose(e, e.indexOf("(")) === e.length - 1) {
    const open = e.indexOf("(");
    return describeCallCondition(e.slice(0, open).trim(), e.slice(open + 1, -1));
  }

  const lenM = e.match(/^(.+?)\??\.length$/);
  if (lenM) {
    const l = describeExpr(lenM[1]);
    return mk(`${cap(l)} tem itens?`, `${cap(l)} está vazio?`, `${l} tiver itens`, `${l} estiver vazio`);
  }
  const okM = e.match(/^(.+?)\??\.(ok|success|succeeded)$/);
  if (okM) {
    const o = okM[1];
    return mk(
      `A resposta de ${code(o)} foi bem-sucedida?`,
      `A resposta de ${code(o)} falhou?`,
      `a resposta de ${code(o)} vier com sucesso (${code(e)})`,
      `a resposta de ${code(o)} vier com falha (${code(e)} é falso)`
    );
  }
  if (/\.(valid|isValid)$/.test(e)) {
    return mk("Os dados são válidos?", "Os dados são inválidos?", `os dados forem válidos (${code(e)})`, `os dados forem inválidos (${code(e)} é falso)`);
  }
  if (requestRead(e)) {
    const d = describeExpr(e);
    return mk(`${cap(d)} foi informado?`, `${cap(d)} NÃO foi informado?`, `${d} for informado`, `${d} não for informado`);
  }
  if (/^(?:req|request)\.user$/.test(e)) {
    return mk("Existe usuário autenticado?", "NÃO existe usuário autenticado?", `houver usuário autenticado (${code(e)})`, `não houver usuário autenticado (${code(e)})`);
  }
  const c = code(trunc(e, 50));
  return mk(`${cap(c)} está preenchido?`, `${cap(c)} está vazio ou ausente?`, `${c} estiver preenchido (valor verdadeiro)`, `${c} estiver vazio ou ausente`);
}

/** Texto de uma decisão (`if (...)`) em formato de história. */
export function describeDecision(expr) {
  const d = describeCondition(expr);
  return {
    ...d,
    title: d.q,
    story:
      `Aqui o fluxo se divide por uma regra do código. O sistema pergunta: **${d.q.replace(/\?$/, "")}?** ` +
      `A resposta decide qual caminho seguir — os dois caminhos possíveis estão descritos abaixo.`,
  };
}

/* ------------------------------------------------------------------ */
/* Instruções                                                          */
/* ------------------------------------------------------------------ */

function bodyOfCall(e, startIdx) {
  const open = e.indexOf("(", startIdx);
  if (open < 0) return "";
  const close = matchClose(e, open);
  return e.slice(open + 1, close < 0 ? undefined : close).trim();
}

/** Tenta ler status e corpo de um retorno de resposta HTTP. */
export function parseResponse(expr) {
  const e = stripParens(expr.trim().replace(/^await\s+/, ""));
  const isResp = /^(res|reply|response|NextResponse|Response|c|ctx|h)\b/.test(e);
  if (!isResp) return null;

  let status = null;
  let m = e.match(/\b(?:status|code)\(\s*(\d{3})\s*\)/);
  if (m) status = Number(m[1]);

  const sendM = e.match(/\.(json|send|end|redirect|render|sendStatus|text|html)\s*\(/);
  let body = "";
  let method = sendM ? sendM[1] : null;
  if (sendM) body = bodyOfCall(e, sendM.index);

  if (method === "sendStatus") {
    status = Number(body) || status;
    body = "";
  }
  if (status == null) {
    m = e.match(/\bstatus\s*:\s*(\d{3})/);
    if (m) status = Number(m[1]);
  }
  if (status == null && sendM) {
    const a = splitArgs(body);
    if (a.length >= 2 && /^\d{3}$/.test(a[1])) {
      status = Number(a[1]);
      body = a[0];
    }
  }
  if (!sendM && status == null) return null;
  if (method === "redirect") return { status: status || 302, body, redirect: true };
  if (status == null) status = 200;
  return { status, body };
}

function parseObjectFields(body) {
  const t = body.trim();
  if (!/^\{[\s\S]*\}$/.test(t)) return [];
  const inner = t.slice(1, -1);
  const parts = splitArgs(inner);
  return parts
    .map((p) => {
      const kv = p.match(/^["']?([\w$-]+)["']?\s*:\s*([\s\S]+)$/);
      if (kv) return { k: kv[1], v: kv[2].trim() };
      if (/^[\w$]+$/.test(p)) return { k: p, v: p };
      return null;
    })
    .filter(Boolean);
}

function describeReturn(rest) {
  const e = rest.trim();
  if (!e) {
    return {
      nodeType: "return",
      title: "Encerra a função",
      story: "Encerra esta função sem devolver valor e volta para quem a chamou.",
      facts: [],
      tone: "neutral",
    };
  }
  const resp = parseResponse(e);
  if (resp) {
    const st = resp.status;
    const txt = statusText(st);
    const tone = st >= 400 ? "error" : "ok";
    const facts = [{ k: "Status HTTP", v: `${st} · ${txt}` }];
    const fields = parseObjectFields(resp.body);
    if (fields.length) {
      for (const f of fields) facts.push({ k: `Devolve \`${f.k}\``, v: describeExpr(f.v) });
    } else if (resp.body) {
      facts.push({ k: "Corpo", v: code(trunc(resp.body, 80)) });
    }
    if (resp.redirect) {
      return {
        nodeType: "return",
        title: "Redireciona o cliente",
        story: `Encerra a requisição **redirecionando** o cliente para ${describeExpr(resp.body)}.`,
        facts,
        tone: "ok",
        outcome: { status: st, statusText: txt, tone: "ok" },
      };
    }
    const bodyTxt = resp.body ? ` devolvendo ${code(trunc(resp.body, 80))}` : "";
    const verdict =
      tone === "error"
        ? st === 401 || st === 403
          ? "É um caminho de **recusa**: o acesso é negado e o processamento para aqui."
          : st === 404
          ? "É um caminho de **não encontrado**: o que foi pedido não existe e o processamento para aqui."
          : st >= 500
          ? "É um caminho de **falha**: algo deu errado e o cliente recebe um erro."
          : "É um caminho de **rejeição**: a requisição é recusada e o processamento para aqui."
        : "É um caminho de **sucesso**: o pedido foi atendido e o processamento termina aqui.";
    return {
      nodeType: "return",
      title: `Responde ${st} · ${txt}`,
      story: `Encerra a requisição respondendo **${st} (${txt})**${bodyTxt}. ${verdict}`,
      facts,
      tone,
      outcome: { status: st, statusText: txt, tone, detail: resp.body ? trunc(resp.body.replace(/\s+/g, " "), 38) : "" },
    };
  }
  return {
    nodeType: "return",
    title: "Retorna um valor",
    story: `Devolve ${describeExpr(e)} para quem chamou e encerra esta função.`,
    facts: [{ k: "Valor devolvido", v: code(trunc(e, 80)) }],
    tone: "neutral",
  };
}

function describeThrow(rest) {
  const e = rest.trim();
  const m = e.match(/^(?:new\s+)?([\w$.]+)\s*\(([\s\S]*)\)$/);
  const cls = m ? m[1] : "erro";
  const args = m ? splitArgs(m[2]) : [];
  const msg = args[0] && isStringLit(args[0]) ? args[0].trim().slice(1, -1) : null;
  return {
    nodeType: "throw",
    title: msg ? `Lança erro: “${trunc(msg, 40)}”` : `Lança ${cls}`,
    short: `Lança o erro ${code(cls)}${msg ? ` com a mensagem “${msg}”` : ""}, interrompendo este caminho.`,
    story:
      `Lança o erro ${code(cls)}${msg ? ` com a mensagem “${msg}”` : ""}. ` +
      `Isso **interrompe** o caminho atual: o fluxo salta para o tratamento de erro (${code("catch")}) mais próximo; ` +
      `se não existir nenhum, a requisição termina com erro interno.`,
    facts: msg ? [{ k: "Mensagem do erro", v: `“${msg}”` }] : [],
    tone: "error",
  };
}

const EXTERNAL_RE = /\b(axios|got|superagent|ky|http|https)\.(get|post|put|patch|delete|request)\s*\(/;

function externalInfo(rhs) {
  const f = rhs.match(/\bfetch\s*\(/);
  if (f) {
    const args = splitArgs(bodyOfCall(rhs, f.index));
    const url = args[0] ? trunc(args[0], 70) : "?";
    const opts = args[1] || "";
    const mm = opts.match(/method\s*:\s*["'](\w+)["']/i);
    return { url: stripQuotes(url), method: (mm ? mm[1] : "GET").toUpperCase() };
  }
  const a = rhs.match(EXTERNAL_RE);
  if (a) {
    const args = splitArgs(bodyOfCall(rhs, a.index));
    return { url: stripQuotes(args[0] ? trunc(args[0], 70) : "?"), method: a[2].toUpperCase() };
  }
  return null;
}

function hostOf(url) {
  const m = String(url).match(/^https?:\/\/([^/\s"'`]+)/);
  return m ? m[1] : "";
}

function stripQuotes(s) {
  const t = s.trim();
  return isStringLit(t) ? t.slice(1, -1) : t;
}

/** Descreve uma chamada de função/método. */
export function describeCall(path, argsStr, opt = {}, ctx = {}) {
  const segs = path.split(/\??\./);
  const name = segs[segs.length - 1];
  const recv = segs.slice(0, -1).join(".");
  const args = splitArgs(argsStr);

  if (/^(console|logger|log)$/.test(recv.split(".")[0]) && recv) {
    return {
      nodeType: "function",
      title: "Registra log",
      story: `Escreve uma mensagem de log (${code(`${recv}.${name}`)}): ${args.map(describeExpr).join(", ") || "sem texto"}. Não altera o resultado da requisição.`,
      facts: [],
      tone: "neutral",
      callName: name,
    };
  }
  if (name === "push" && recv) {
    const errish = /err|invalid|problem|issue|fail/i.test(recv);
    return {
      nodeType: "function",
      title: errish ? "Registra um problema encontrado" : `Adiciona item em ${recv}`,
      story: errish
        ? `Registra o problema ${args.map(describeExpr).join(", ")} na lista ${code(recv)} — assim o sistema acumula todos os problemas para devolvê-los juntos.`
        : `Adiciona à lista ${code(recv)} ${args.map(describeExpr).join(", ")}.`,
      short: errish
        ? `Registra o problema ${args.map(describeExpr).join(", ")} em ${code(recv)}.`
        : `Adiciona ${args.map(describeExpr).join(", ")} à lista ${code(recv)}.`,
      facts: [],
      tone: "neutral",
      callName: name,
    };
  }

  const callee = ctx.resolver ? ctx.resolver.resolve(name, recv, { deep: ctx.deep !== false }) : null;
  const h = humanizeName(name);
  const title = h.verb ? h.title : `Chama ${name}`;
  const target = opt.isNew
    ? `cria uma nova instância de ${code(name)}`
    : recv
    ? `chama o método ${code(name)} de ${code(recv)}`
    : `chama a função ${code(name)}`;

  let story = cap(target);
  if (args.length) story += `, passando ${args.map(describeExpr).join("; ")}`;
  if (opt.varName) story += ` — e guarda o resultado na variável ${code(opt.varName)}`;
  story += ".";
  const short = story;
  if (opt.awaited) story += " É uma operação assíncrona: o fluxo espera a resposta antes de seguir.";
  if (callee) {
    story += ` A implementação está em ${code(`${callee.file}:${callee.line}`)}${callee.className ? `, na classe ${code(callee.className)}` : ""} — veja **“Por dentro de ${name}”** nos detalhes.`;
  }

  const facts = [];
  if (callee && callee.params.length) {
    callee.params.forEach((p, i) => {
      if (args[i] !== undefined) facts.push({ k: `Parâmetro ${code(p)}`, v: describeExpr(args[i]) });
    });
    for (const u of callee.usesFields || []) {
      facts.push({ k: `Campos de ${code(u.param)} usados`, v: u.fields.map(code).join(", ") });
    }
  } else if (args.length) {
    args.forEach((a, i) => facts.push({ k: `Argumento ${i + 1}`, v: describeExpr(a) }));
  }

  const bareVerb = h.verb && !h.noun;
  return {
    nodeType: "function",
    title: opt.isNew ? `Cria ${name}` : bareVerb && recv ? `${title} (${recv})` : title,
    story,
    short,
    facts,
    tone: "neutral",
    callName: name,
    receiver: recv || null,
    callee,
  };
}

function describeAssign(target, rhs, ctx, decl) {
  const r = rhs.trim();
  const isDestruct = /^[{[]/.test(target);

  if (isDestruct) {
    const names = target
      .replace(/[{}[\]]/g, "")
      .split(",")
      .map((s) => s.split(":").pop().split("=")[0].trim())
      .filter(Boolean);
    const rr = requestRead(r);
    const src = describeExpr(r);
    const facts = names.map((n) => ({
      k: code(n),
      v: rr && rr.kind ? REQ_FIELD[rr.kind](n) : `parte de ${src}`,
    }));
    return {
      nodeType: "assignment",
      title: rr ? "Lê os dados da requisição" : "Separa campos de um objeto",
      story: `Separa ${de(src)} os campos ${names.map(code).join(", ")} e guarda cada um em uma variável de mesmo nome.`,
      facts,
      tone: "neutral",
      varName: names.join(", "),
    };
  }

  const ext = externalInfo(r);
  if (ext) {
    return {
      nodeType: "external_call",
      title: `Chama serviço externo${hostOf(ext.url) ? ` (${hostOf(ext.url)})` : ""}`,
      story:
        `Faz uma chamada HTTP **${ext.method}** para ${code(ext.url)} e guarda a resposta na variável ${code(target)}. ` +
        `É uma dependência externa: se o serviço falhar ou demorar, o fluxo pode ser afetado.`,
      facts: [
        { k: "Serviço", v: code(ext.url) },
        { k: "Método HTTP", v: ext.method },
      ],
      tone: "neutral",
      varName: target,
    };
  }

  const stripped = r.replace(/^await\s+/, "");
  const awaited = /^await\s+/.test(r);
  const isNew = /^new\s+/.test(stripped);
  const callM = stripped.replace(/^new\s+/, "").match(/^([\w$.?]+)\s*\(/);
  if (callM && !requestRead(stripped)) {
    const body = stripped.replace(/^new\s+/, "");
    const open = body.indexOf("(");
    if (matchClose(body, open) === body.length - 1 && !/^(String|Number|Boolean|parseInt|parseFloat)$/.test(callM[1])) {
      const d = describeCall(callM[1], body.slice(open + 1, -1), { awaited, isNew, varName: target }, ctx);
      return { ...d, varName: target };
    }
  }

  if (isConditionLike(r)) {
    const c = describeCondition(r);
    return {
      nodeType: "assignment",
      title: `Define ${target}`,
      story: `A variável ${code(target)} passa a valer **verdadeiro** quando ${c.pos}; caso contrário, **falso**.`,
      facts: [],
      tone: "neutral",
      varName: target,
    };
  }

  const rr = requestRead(stripped) || (/^(String|Number|Boolean|parseInt|parseFloat)\(/.test(stripped) ? true : null);
  const lead = rr ? "Lê" : "Define";
  return {
    nodeType: "assignment",
    title: rr ? `Lê ${target} da requisição` : `${decl === "let" ? "Inicia" : "Define"} ${target}`,
    story: `${lead === "Lê" ? "Lê" : "A variável"} ${lead === "Lê" ? `${describeExpr(r)} e guarda na variável ${code(target)}` : `${code(target)} recebe ${describeExpr(r)}`}.`,
    facts: [],
    tone: "neutral",
    varName: target,
  };
}

/**
 * Descreve uma instrução simples.
 * @returns {{ nodeType: string, title: string, story: string, facts: {k:string,v:string}[], tone: string, outcome?: object, callName?: string, varName?: string, callee?: object }}
 */
export function describeStatement(text, ctx = {}) {
  const t = String(text).trim().replace(/;+\s*$/, "").trim();

  if (/^return\b/.test(t)) return describeReturn(t.replace(/^return\s*/, ""));
  if (/^throw\b/.test(t)) return describeThrow(t.replace(/^throw\s*/, ""));
  if (!/^(const|let|var)\b/.test(t) && parseResponse(t)) return describeReturn(t);

  let m = t.match(/^(const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[\w$]+)\s*(?::[^=]+?)?=\s*([\s\S]+)$/);
  if (m) return describeAssign(m[2], m[3], ctx, m[1]);

  m = t.match(/^([\w$.\]["']+)\s*(\+|-|\*|\/)=(?!=)\s*([\s\S]+)$/);
  if (m) {
    const [, tgt, op, rhs] = m;
    const r = describeExpr(rhs);
    const story = {
      "+": `Soma ${r} ao valor de ${code(tgt)}.`,
      "-": `Subtrai ${r} do valor de ${code(tgt)}.`,
      "*": `Multiplica ${code(tgt)} por ${r}.`,
      "/": `Divide ${code(tgt)} por ${r}.`,
    }[op];
    return { nodeType: "assignment", title: `Atualiza ${tgt}`, story, facts: [], tone: "neutral", varName: tgt };
  }
  m = t.match(/^([\w$.\]["']+)\s*=(?!=)\s*([\s\S]+)$/);
  if (m) return describeAssign(m[1], m[2], ctx, null);

  const body = t.replace(/^await\s+/, "");
  const awaited = /^await\s+/.test(t);
  const isNew = /^new\s+/.test(body);
  const callM = body.replace(/^new\s+/, "").match(/^([\w$.?]+)\s*\(/);
  if (callM) {
    const b = body.replace(/^new\s+/, "");
    const open = b.indexOf("(");
    const close = matchClose(b, open);
    const ext = externalInfo(b);
    if (ext) {
      return {
        nodeType: "external_call",
        title: `Chama serviço externo${hostOf(ext.url) ? ` (${hostOf(ext.url)})` : ""}`,
        story: `Faz uma chamada HTTP **${ext.method}** para ${code(ext.url)}.`,
        facts: [{ k: "Serviço", v: code(ext.url) }],
        tone: "neutral",
      };
    }
    if (close >= 0) {
      // encadeamentos (a.b().c()) viram texto genérico apenas no último elo
      const tail = b.slice(close + 1).trim();
      if (!tail) return describeCall(callM[1], b.slice(open + 1, close), { awaited, isNew }, ctx);
    }
  }

  return {
    nodeType: "unknown",
    title: "Executa uma instrução",
    story: `Executa ${code(trunc(t, 100))}.`,
    facts: [],
    tone: "neutral",
  };
}

/* ------------------------------------------------------------------ */
/* Dados de entrada da requisição                                      */
/* ------------------------------------------------------------------ */

export function findRequestInputs(body) {
  const seen = new Set();
  const out = [];
  const add = (where, name) => {
    const k = `${where}:${name}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ where, name });
    }
  };
  for (const m of body.matchAll(/\b(?:req|request)\.(query|body|params|headers|cookies)\??\.([\w$]+)/g)) add(m[1], m[2]);
  for (const m of body.matchAll(/\b(?:req|request)\.(query|body|params|headers|cookies)\??\[\s*["']([^"']+)["']\s*\]/g)) add(m[1], m[2]);
  for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:req|request)\.(query|body|params|headers|cookies)\b/g)) {
    m[1].split(",").forEach((p) => {
      const n = p.split(":")[0].split("=")[0].trim();
      if (n && !n.startsWith("...")) add(m[2], n);
    });
  }
  for (const m of body.matchAll(/\bc\.req\.(query|param|header)\(\s*["']([^"']+)["']\s*\)/g)) {
    add(m[1] === "param" ? "params" : m[1] === "header" ? "headers" : "query", m[2]);
  }
  for (const m of body.matchAll(/searchParams\.get\(\s*["']([^"']+)["']\s*\)/g)) add("query", m[1]);
  return out;
}

const WHERE_PT = {
  query: "query string",
  body: "corpo (body)",
  params: "parâmetros de rota",
  headers: "cabeçalhos",
  cookies: "cookies",
};

export function describeInputs(inputs) {
  const groups = new Map();
  for (const i of inputs) {
    if (!groups.has(i.where)) groups.set(i.where, []);
    groups.get(i.where).push(i.name);
  }
  return [...groups.entries()].map(([where, names]) => ({
    k: cap(WHERE_PT[where] || where),
    v: names.map(code).join(", "),
  }));
}

export { skipString };
