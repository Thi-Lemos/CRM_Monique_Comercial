// weekUtils.ts — Definição e cálculo de semana civil
//
// Regras de negócio confirmadas:
//   • Semana: segunda 00:00 BRT → domingo 23:59:59 BRT
//   • Pertencimento ao mês = mês do DOMINGO (ex: semana 29/06–05/07 pertence a Julho)
//   • Semana 1 de julho = primeira semana cujo domingo cai em julho
//   • Semana cujo domingo cai em agosto = Semana 1 de agosto
//
// Todas as datas internas são strings ISO YYYY-MM-DD (sem fuso).
// BRT = UTC-3 (sem ajuste de horário de verão no Brasil desde 2019).

export interface WeekInfo {
  inicio: string;      // YYYY-MM-DD — segunda-feira
  fim: string;         // YYYY-MM-DD — domingo
  ano: number;         // ano do domingo (determina pertencimento)
  mes: number;         // mês do domingo (1-12)
  semana_num: number;  // número ordinal da semana dentro do mês
  label: string;       // "Semana 1 de Julho/2026"
  labelRange: string;  // "29/06 → 05/07"
}

export const NOMES_MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// --- Funções internas ---

/** Converte Date UTC para string YYYY-MM-DD no horário BRT (UTC-3). */
function toBRTDateStr(d: Date): string {
  // BRT = UTC − 3h; em ms = UTC − 10_800_000
  const brtMs = d.getTime() - 3 * 60 * 60 * 1000;
  return new Date(brtMs).toISOString().slice(0, 10);
}

/** Retorna um Date a partir de YYYY-MM-DD interpretado como meio-dia UTC
 *  (evita problemas de fuso em operações de dia inteiro). */
function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00Z');
}

/** Adiciona ou subtrai dias a uma string YYYY-MM-DD, retorna nova string. */
function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** getDayOfWeek: 0=Dom, 1=Seg, ..., 6=Sáb (UTC) */
function getDOW(dateStr: string): number {
  return parseDate(dateStr).getUTCDay();
}

// --- API pública ---

/**
 * Calcula a WeekInfo da semana civil que contém `date` (padrão: agora em BRT).
 *
 * Exemplo verificado (06/07/2026, segunda-feira):
 *   getWeekInfo() → { inicio:'2026-07-06', fim:'2026-07-12', ano:2026, mes:7,
 *                     semana_num:2, label:'Semana 2 de Julho/2026' }
 *
 * Semana anterior (29/06–05/07):
 *   getWeekInfo(new Date('2026-07-05T12:00:00Z'))
 *               → { inicio:'2026-06-29', fim:'2026-07-05', ano:2026, mes:7,
 *                   semana_num:1, label:'Semana 1 de Julho/2026' }
 */
export function getWeekInfo(date?: Date): WeekInfo {
  const d = date || new Date();
  const todayStr = toBRTDateStr(d);

  // Dia da semana em BRT (0=Dom … 6=Sáb)
  const dow = getDOW(todayStr);
  // Quantos dias subtrair para chegar na segunda-feira
  const daysToMon = dow === 0 ? 6 : dow - 1;

  const inicio = addDays(todayStr, -daysToMon);   // segunda
  const fim    = addDays(inicio, 6);               // domingo

  // Pertencimento = mês/ano do domingo
  const sundayDate = parseDate(fim);
  const ano = sundayDate.getUTCFullYear();
  const mes = sundayDate.getUTCMonth() + 1;

  // Número da semana dentro do mês:
  // Semana 1 = a semana cujo domingo é o primeiro domingo do mês.
  // Seu início (segunda) pode estar no mês anterior.
  const firstOfMonth = new Date(Date.UTC(ano, mes - 1, 1));
  const firstDow = firstOfMonth.getUTCDay(); // 0=Dom … 6=Sáb
  const daysUntilFirstSunday = firstDow === 0 ? 0 : 7 - firstDow;
  const firstSundayStr = new Date(Date.UTC(ano, mes - 1, 1 + daysUntilFirstSunday))
    .toISOString().slice(0, 10);
  const firstWeekMonday = addDays(firstSundayStr, -6);

  const diffDays =
    (parseDate(inicio).getTime() - parseDate(firstWeekMonday).getTime()) /
    (24 * 60 * 60 * 1000);
  const semana_num = Math.round(diffDays / 7) + 1;

  const mesNome = NOMES_MESES[mes - 1];
  const label = `Semana ${semana_num} de ${mesNome}/${ano}`;

  // labelRange: "29/06 → 05/07"
  const fmtDate = (s: string) => {
    const [_y, m, dd] = s.split('-');
    return `${dd}/${m}`;
  };
  const labelRange = `${fmtDate(inicio)} → ${fmtDate(fim)}`;

  return { inicio, fim, ano, mes, semana_num, label, labelRange };
}

/**
 * Retorna a WeekInfo da semana mais recente que já terminou completamente
 * (domingo já passou). Usado como padrão no ExcelImporter (importa na
 * segunda para a semana que acabou de fechar no domingo).
 */
export function getLastCompletedWeek(): WeekInfo {
  const now = new Date();
  const todayStr = toBRTDateStr(now);
  const dow = getDOW(todayStr); // 0=Dom … 6=Sáb

  if (dow === 0) {
    // Hoje é domingo: a semana que acabou de fechar é a semana atual.
    // Ainda não fechou completamente (estamos no último dia), então
    // retornamos a semana anterior.
    const lastMon = addDays(todayStr, -13);
    return getWeekInfo(parseDate(lastMon));
  } else {
    // Qualquer outro dia: a semana que fechou é a que contém o último domingo.
    const lastSunday = addDays(todayStr, -(dow)); // dow dias atrás = domingo passado
    return getWeekInfo(parseDate(lastSunday));
  }
}

/** Retorna a WeekInfo da semana civil corrente (para o formulário manual). */
export function getCurrentWeek(): WeekInfo {
  return getWeekInfo();
}

/** Formata data YYYY-MM-DD para exibição DD/MM/YYYY. */
export function fmtDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
