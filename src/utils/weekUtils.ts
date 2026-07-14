// weekUtils.ts — Definição e cálculo de semana civil
//
// Regras de negócio confirmadas:
//   • Semana: domingo 00:00 BRT → sábado 23:59:59 BRT
//   • Pertencimento ao mês = mês do SÁBADO (último dia da semana)
//   • Semana 1 de julho = primeira semana cujo sábado cai em julho
//   • Semana cujo sábado cai em agosto = Semana 1 de agosto
//
// Exemplo verificado:
//   Semana 1 de Julho/2026 = 28/06 (dom) → 04/07 (sáb)
//   Semana 2 de Julho/2026 = 05/07 (dom) → 11/07 (sáb)
//
// Todas as datas internas são strings ISO YYYY-MM-DD (sem fuso).
// BRT = UTC-3 (sem ajuste de horário de verão no Brasil desde 2019).

export interface WeekInfo {
  inicio: string;      // YYYY-MM-DD — domingo
  fim: string;         // YYYY-MM-DD — sábado
  ano: number;         // ano do sábado (determina pertencimento)
  mes: number;         // mês do sábado (1-12)
  semana_num: number;  // número ordinal da semana dentro do mês
  label: string;       // "Semana 1 de Julho/2026"
  labelRange: string;  // "28/06 → 04/07"
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
 * Exemplos verificados:
 *   getWeekInfo(new Date('2026-07-01T12:00:00Z'))
 *               → { inicio:'2026-06-28', fim:'2026-07-04', ano:2026, mes:7,
 *                   semana_num:1, label:'Semana 1 de Julho/2026' }
 *
 *   getWeekInfo(new Date('2026-07-05T12:00:00Z'))
 *               → { inicio:'2026-07-05', fim:'2026-07-11', ano:2026, mes:7,
 *                   semana_num:2, label:'Semana 2 de Julho/2026' }
 */
export function getWeekInfo(date?: Date): WeekInfo {
  const d = date || new Date();
  const todayStr = toBRTDateStr(d);

  // Dia da semana em BRT (0=Dom … 6=Sáb)
  const dow = getDOW(todayStr);
  // Quantos dias subtrair para chegar no domingo
  const daysToSun = dow; // 0=Dom→0, 1=Seg→1, ..., 6=Sáb→6

  const inicio = addDays(todayStr, -daysToSun);  // domingo
  const fim    = addDays(inicio, 6);              // sábado

  // Pertencimento = mês/ano do sábado (último dia)
  const saturdayDate = parseDate(fim);
  const ano = saturdayDate.getUTCFullYear();
  const mes = saturdayDate.getUTCMonth() + 1;

  // Número da semana dentro do mês:
  // Semana 1 = a semana cujo sábado é o primeiro sábado do mês.
  // Seu início (domingo) pode estar no mês anterior.
  const firstOfMonth = new Date(Date.UTC(ano, mes - 1, 1));
  const firstDow = firstOfMonth.getUTCDay(); // 0=Dom … 6=Sáb
  // Dias até o primeiro sábado do mês
  const daysUntilFirstSat = firstDow === 6 ? 0 : 6 - firstDow;
  const firstSaturdayStr = new Date(Date.UTC(ano, mes - 1, 1 + daysUntilFirstSat))
    .toISOString().slice(0, 10);
  const firstWeekSunday = addDays(firstSaturdayStr, -6);

  const diffDays =
    (parseDate(inicio).getTime() - parseDate(firstWeekSunday).getTime()) /
    (24 * 60 * 60 * 1000);
  const semana_num = Math.round(diffDays / 7) + 1;

  const mesNome = NOMES_MESES[mes - 1];
  const label = `Semana ${semana_num} de ${mesNome}/${ano}`;

  // labelRange: "28/06 → 04/07"
  const fmtDate = (s: string) => {
    const [_y, m, dd] = s.split('-');
    return `${dd}/${m}`;
  };
  const labelRange = `${fmtDate(inicio)} → ${fmtDate(fim)}`;

  return { inicio, fim, ano, mes, semana_num, label, labelRange };
}

/**
 * Retorna a WeekInfo da semana mais recente que já terminou completamente
 * (sábado já passou). Usado como padrão no ExcelImporter (importa no
 * domingo ou depois para a semana que acabou de fechar no sábado).
 */
export function getLastCompletedWeek(): WeekInfo {
  const now = new Date();
  const todayStr = toBRTDateStr(now);
  const dow = getDOW(todayStr); // 0=Dom … 6=Sáb

  if (dow === 0) {
    // Hoje é domingo: a semana que fechou ontem (sábado) é a anterior.
    const lastSat = addDays(todayStr, -1);
    return getWeekInfo(parseDate(lastSat));
  } else {
    // Qualquer outro dia: a semana que fechou é a que contém o último sábado.
    const lastSaturday = addDays(todayStr, -(dow === 6 ? 0 : dow + 1));
    return getWeekInfo(parseDate(lastSaturday));
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

/**
 * Retorna true se a WeekInfo fornecida é a ÚLTIMA semana do mês.
 * Critério: a semana seguinte (cujo sábado cai 7 dias depois) pertence a um mês diferente.
 * Usado pelo ExcelImporter para disparar a avaliação de inativação ao fechar o mês.
 */
export function isLastWeekOfMonth(week: WeekInfo): boolean {
  const nextSaturday = addDays(week.fim, 7);
  const nextSaturdayDate = parseDate(nextSaturday);
  const nextMes = nextSaturdayDate.getUTCMonth() + 1;
  const nextAno = nextSaturdayDate.getUTCFullYear();
  return nextMes !== week.mes || nextAno !== week.ano;
}
