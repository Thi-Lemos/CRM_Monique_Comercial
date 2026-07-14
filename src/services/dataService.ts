import { supabase } from '../supabaseClient';
import { Parceiro, ProducaoMensal, CrmLog, SemafaroStatus, TaskItem, CriteriosConfig, ProducaoSemanal, EventoSemana } from '../types';
import { initialParceiros, initialProducao, initialLogs } from './mockData';
import { calculateScoreAndClassification } from './scoreCalculator';
import { getWeekInfo, getCurrentWeek, WeekInfo } from '../utils/weekUtils';

const LOCAL_STORAGE_KEY = 'crm_prata_digital_db';
const LOCAL_CRITERIOS_KEY = 'crm_prata_digital_criterios';

// Toda a base de 724 parceiros legados foi carregada em massa no Supabase entre
// 31/05/2026 e 30/06/2026 — created_at deles reflete a data da importação, não a
// data real de entrada como parceiro (essa informação não existe para a base legada).
// A partir de 01/07/2026, cadastro passou a ser feito manualmente e direto no CRM,
// então created_at passa a refletir a data real de cadastro.
// Por isso, a regra de Onboarding (janela de dias_conversao_hunter) só pode ser
// aplicada a parceiros criados a partir deste corte — antes dele, sem produção
// válida sempre cai em Inativo, nunca em Onboarding.
const DATA_CORTE_CONFIABILIDADE_CADASTRO = new Date('2026-07-01T00:00:00Z');

const DEFAULT_CRITERIOS: CriteriosConfig = {
  metas: {
    hunter_novos_ativos_semana: 2,
    hunter_reativacoes_semana: 1,
    farmer_propostas_pagas_semana: 1200,
    farmer_concentracao_minima: 30,
    meta_taxa_ativos: 70,
    meta_churn: 10,
    meta_media_produtos: 2,
    meta_taxa_reativacao: 25
  },
  limites: {
    dias_inatividade_winback: 60,
    dias_conversao_hunter: 7
  },
  pesos_score: {
    vol_total: 25,
    concentracao: 20,
    num_vendedores: 15,
    area_geografica: 15,
    produtos_ativos: 10,
    modelo_atuacao: 10,
    diversificacao: 5
  },
  score_thresholds: {
    estrategico: 70,
    crescimento: 40
  },
  score_notas: {
    vol_total_faixas: [30000, 80000, 150000, 300000],
    concentracao_faixas: [10, 20, 30, 50],
    vendedores_faixas: [1, 3, 5, 10]
  }
};

interface LocalDB {
  parceiros: Parceiro[];
  producao: ProducaoMensal[];
  logs: CrmLog[];
  producoes_semanais?: ProducaoSemanal[];
}

// --- MÁQUINA DE ESTADOS DE STATUS (Onboarding / Ativo / Inativo / Reativado) ---
//
// Máquina de estados confirmada com o negócio:
//   Onboarding → Ativo     : produziu dentro da janela de dias_conversao_hunter
//   Onboarding → Inativo   : passou da janela sem produzir
//   Ativo      → Inativo   : 60+ dias sem produção (decaimento por data, não por mês)
//   Inativo    → Reativado : produziu no mês M (qualquer volume > 0)
//   Reativado  → Ativo     : produziu também no mês M+1 (confirma a reativação)
//   Reativado  → Inativo   : não produziu no mês M+1 (não confirmou)
//
// Diferente do cálculo anterior (que olhava só o instante presente), "Reativado"
// exige memória: só existe se o parceiro esteve em Inativo antes. Por isso o status
// é obtido simulando mês a mês, desde o início observável da história do parceiro
// até o mês de referência desejado — não há mais como calcular olhando só "agora".
//
// Início observável da história ("mês 1" da simulação):
//   • Parceiro novo (created_at >= DATA_CORTE_CONFIABILIDADE_CADASTRO): começa em
//     Onboarding no mês de criação.
//   • Parceiro legado (created_at < corte, cadastro em massa): created_at não reflete
//     a data real de entrada. A simulação começa no mês mais antigo entre created_at
//     e o primeiro mês em que existe QUALQUER registro de produção para ele. Nesse
//     mês inicial: se já havia produção > 0, presumimos que já era parceiro
//     estabelecido e ele começa direto como Ativo (não passa pela cerimônia
//     Inativo → Reativado só por não termos dados anteriores a março/2026); se não
//     havia produção, começa como Inativo (sem evidência de atividade).
export interface StatusTimelineEntry {
  ano: number;
  mes: number;
  status: Parceiro['status'];
}

const shiftMonthRaw = (ano: number, mes: number, delta: number) => {
  const totalMeses = ano * 12 + (mes - 1) + delta;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = ((totalMeses % 12) + 12) % 12 + 1;
  return { ano: novoAno, mes: novoMes };
};

export function computeStatusTimeline(
  createdAt: string | undefined,
  parceiroProds: ProducaoMensal[],
  limites: { dias_inatividade_winback: number; dias_conversao_hunter: number },
  uptoAno: number,
  uptoMes: number,
  // Status registrado no banco para este parceiro. Usado apenas em parceiros novos
  // (pós-DATA_CORTE) que ainda não produziram: se for diferente de 'Onboarding',
  // indica que foi definido manualmente no cadastro e deve ser o ponto de partida
  // da simulação em vez de forçar Onboarding.
  statusNoBanco?: Parceiro['status']
): StatusTimelineEntry[] {
  // Mês civil corrente (horário de Brasília). Transições de inativação
  // (Ativo → Inativo e Onboarding → Inativo) NUNCA devem ser disparadas no mês
  // ainda em aberto: a regra de negócio é que inativação só é verificada quando
  // a última semana do mês for importada, o que só ocorre depois que o mês fecha.
  const nowBrasilia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const currentOpenAno = nowBrasilia.getFullYear();
  const currentOpenMes = nowBrasilia.getMonth() + 1;

  const createdDate = createdAt ? new Date(createdAt) : new Date(2026, 4, 1);
  const isLegacy = createdDate < DATA_CORTE_CONFIABILIDADE_CADASTRO;

  const volByMonth = new Map<string, number>();
  parceiroProds.forEach(p => {
    const vol = (p.vol_fgts || 0) + (p.vol_clt || 0) + (p.vol_cgv || 0) + (p.vol_pix || 0);
    const key = `${p.ano}-${p.mes}`;
    volByMonth.set(key, (volByMonth.get(key) || 0) + vol);
  });

  let earliestProdMonth: { ano: number; mes: number } | null = null;
  parceiroProds.forEach(p => {
    if (!earliestProdMonth || p.ano < earliestProdMonth.ano || (p.ano === earliestProdMonth.ano && p.mes < earliestProdMonth.mes)) {
      earliestProdMonth = { ano: p.ano, mes: p.mes };
    }
  });

  let startAno = createdDate.getFullYear();
  let startMes = createdDate.getMonth() + 1;
  if (isLegacy && earliestProdMonth) {
    const ep = earliestProdMonth as { ano: number; mes: number };
    if (ep.ano < startAno || (ep.ano === startAno && ep.mes < startMes)) {
      startAno = ep.ano;
      startMes = ep.mes;
    }
  }

  // Se o mês de referência pedido for anterior ao início observável da história
  // do parceiro (ex.: parceiro criado depois do mês de referência), não há o que
  // simular — devolve o status inicial "cru" nesse mês de referência.
  if (uptoAno < startAno || (uptoAno === startAno && uptoMes < startMes)) {
    const fallback: Parceiro['status'] = isLegacy ? 'Inativo' : 'Onboarding';
    return [{ ano: uptoAno, mes: uptoMes, status: fallback }];
  }

  let status: Parceiro['status'];
  if (isLegacy) {
    const firstVol = volByMonth.get(`${startAno}-${startMes}`) || 0;
    status = firstVol > 0 ? 'Ativo' : 'Inativo';
  } else {
    // Parceiro novo (pós-corte): começa em Onboarding por padrão.
    // Exceção: se o status registrado no banco for diferente de Onboarding, significa
    // que foi definido manualmente no cadastro (ex.: parceiro vindo de outra carteira,
    // já Ativo ou já Inativo). Nesse caso, respeita o status do banco como ponto de
    // partida, sem passar pela janela de Onboarding.
    if (statusNoBanco && statusNoBanco !== 'Onboarding') {
      status = statusNoBanco;
    } else {
      status = 'Onboarding';
    }
  }

  const timeline: StatusTimelineEntry[] = [];
  let lastProdMonth: { ano: number; mes: number } | null = null;
  let reativadoTriggerMonth: { ano: number; mes: number } | null = null;

  let curAno = startAno;
  let curMes = startMes;
  let isFirstMonth = true;

  while (curAno < uptoAno || (curAno === uptoAno && curMes <= uptoMes)) {
    const vol = volByMonth.get(`${curAno}-${curMes}`) || 0;
    const hasProd = vol > 0;
    if (hasProd) lastProdMonth = { ano: curAno, mes: curMes };

    if (!isFirstMonth) {
      switch (status) {
        case 'Onboarding': {
          // Upward transition (→ Ativo): fires on any import with production, regardless of month.
          // Downward transition (→ Inativo): based solely on days since registration — fires
          // as soon as dias_conversao_hunter days have elapsed without production, on any import,
          // including during the current open month. This is independent of month-end closing.
          if (hasProd) {
            status = 'Ativo';
          } else {
            const monthEndDate = new Date(curAno, curMes, 0);
            const diasDesdeCriacao = (monthEndDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
            if (diasDesdeCriacao > limites.dias_conversao_hunter) {
              status = 'Inativo';
            }
          }
          break;
        }
        case 'Ativo': {
          // Downward transition (→ Inativo): only when the month is already closed —
          // never fire inactivation during the current open month.
          const isCurrentOpenMonth = curAno === currentOpenAno && curMes === currentOpenMes;
          if (!isCurrentOpenMonth && lastProdMonth) {
            const monthEndDate = new Date(curAno, curMes, 0);
            const lastProdEndDate = new Date(lastProdMonth.ano, lastProdMonth.mes, 0);
            const diasSemProd = (monthEndDate.getTime() - lastProdEndDate.getTime()) / (1000 * 60 * 60 * 24);
            if (diasSemProd > limites.dias_inatividade_winback) {
              status = 'Inativo';
            }
          }
          break;
        }
        case 'Inativo': {
          if (hasProd) {
            status = 'Reativado';
            reativadoTriggerMonth = { ano: curAno, mes: curMes };
          }
          break;
        }
        case 'Reativado': {
          if (reativadoTriggerMonth) {
            const nextMonth = shiftMonthRaw(reativadoTriggerMonth.ano, reativadoTriggerMonth.mes, 1);
            if (curAno === nextMonth.ano && curMes === nextMonth.mes) {
              status = hasProd ? 'Ativo' : 'Inativo';
              reativadoTriggerMonth = null;
            }
          }
          break;
        }
      }
    }

    timeline.push({ ano: curAno, mes: curMes, status });
    isFirstMonth = false;

    const next = shiftMonthRaw(curAno, curMes, 1);
    curAno = next.ano;
    curMes = next.mes;
  }

  return timeline;
}

// Retorna apenas o status vigente em um mês de referência específico (último
// item da simulação até aquele mês).
// Retorna o volume Prata (FGTS + CLT + CGV + Cartão/PIX) do mês de produção mais
// recente já lançado para o parceiro — independe de qualquer período/mês
// selecionado em filtros de tela. Usado em "VOL. PRATA ATUAL" (ficha do parceiro)
// e na coluna "Vol. Prata" da Carteira de Parceiros.
export function getVolPrataUltimaProducao(prods: ProducaoMensal[]): number {
  if (!prods || prods.length === 0) return 0;

  let maisRecente: ProducaoMensal | null = null;
  for (const p of prods) {
    if (!maisRecente || p.ano > maisRecente.ano || (p.ano === maisRecente.ano && p.mes > maisRecente.mes)) {
      maisRecente = p;
    }
  }
  if (!maisRecente) return 0;

  return (maisRecente.vol_fgts || 0) + (maisRecente.vol_clt || 0) + (maisRecente.vol_cgv || 0) + (maisRecente.vol_pix || 0);
}

export function computeStatusAtMonth(
  createdAt: string | undefined,
  parceiroProds: ProducaoMensal[],
  limites: { dias_inatividade_winback: number; dias_conversao_hunter: number },
  refAno: number,
  refMes: number,
  statusNoBanco?: Parceiro['status']
): Parceiro['status'] {
  const timeline = computeStatusTimeline(createdAt, parceiroProds, limites, refAno, refMes, statusNoBanco);
  return timeline[timeline.length - 1].status;
}

// Busca TODAS as linhas de uma tabela no Supabase, paginando automaticamente.
//
// Por quê isso existe: o Supabase/PostgREST impõe um teto de linhas por
// requisição configurado no próprio projeto (hoje 1000 — Dashboard > Settings
// > API > Max Rows). Esse teto SOBREPÕE qualquer `.range()` maior pedido pelo
// cliente: pedir `.range(0, 9999)` não garante 10 mil linhas, garante "até o
// teto do projeto", silenciosamente, sem erro. Enquanto uma tabela tem menos
// linhas que o teto, isso passa despercebido — e o bug reaparece sozinho,
// sem nenhuma mudança de código, assim que a tabela cresce além dele.
//
// Esta função elimina essa classe de bug: busca em lotes de PAGE_SIZE e só
// para quando uma página vier incompleta (ou vazia), então sempre traz 100%
// dos dados, não importa quantas linhas a tabela tenha hoje ou vier a ter.
async function fetchAllRows<T>(table: string, selectClause: string = '*'): Promise<T[]> {
  if (!supabase) return [];
  const PAGE_SIZE = 1000;
  let allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectClause)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.warn(`Falha ao paginar tabela "${table}" no Supabase:`, error);
      break;
    }
    if (!data || data.length === 0) break;

    allRows = allRows.concat(data as T[]);

    if (data.length < PAGE_SIZE) break; // última página (incompleta = fim dos dados)
    from += PAGE_SIZE;
  }

  return allRows;
}

function getLocalDB(): LocalDB {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!data) {
    const db: LocalDB = {
      parceiros: initialParceiros.map((p, idx) => ({ 
        ...p, 
        propostas_pagas_semana: p.propostas_pagas_semana || 0,
        created_at: p.created_at || new Date(2026, 4, 1 + idx * 2).toISOString()
      })),
      producao: initialProducao,
      logs: initialLogs,
      producoes_semanais: []
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(db));
    return db;
  }
  const parsed = JSON.parse(data);
  parsed.parceiros = (parsed.parceiros || []).map((p: any, idx: number) => ({
    ...p,
    propostas_pagas_semana: p.propostas_pagas_semana !== undefined ? p.propostas_pagas_semana : 0,
    created_at: p.created_at || new Date(2026, 4, 1 + idx * 2).toISOString()
  }));
  if (!parsed.producoes_semanais) {
    parsed.producoes_semanais = [];
  }
  return parsed;
}

function saveLocalDB(db: LocalDB) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(db));
}

export const dataService = {
  isSupabaseEnabled(): boolean {
    return !!supabase;
  },

  // --- AUTENTICAÇÃO ---
  async signIn(email: string, password: string): Promise<{ user: any; error: any }> {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      return { user: data?.user, error };
    } else {
      // Login Simulado Local (Monique)
      if (email === 'monique@pratadigital.com.br' && password === 'prata123') {
        const fakeUser = { id: 'monique-id', email, role: 'gerente', nome: 'Monique' };
        localStorage.setItem('crm_session', JSON.stringify(fakeUser));
        return { user: fakeUser, error: null };
      }
      return { user: null, error: { message: 'Credenciais inválidas no modo offline. Use monique@pratadigital.com.br / prata123.' } };
    }
  },

  async signOut(): Promise<void> {
    if (supabase) {
      await supabase.auth.signOut();
    } else {
      localStorage.removeItem('crm_session');
    }
  },

  async getCurrentUser(): Promise<any> {
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } else {
      const session = localStorage.getItem('crm_session');
      return session ? JSON.parse(session) : null;
    }
  },

  // --- CONFIGURAÇÃO DE CRITÉRIOS ---
  async getCriterios(): Promise<CriteriosConfig> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('criterios_config')
          .select('config')
          .single();
        if (!error && data?.config) {
          const stored = data.config as CriteriosConfig;
          // Mescla com defaults para garantir compatibilidade com configs antigas
          return {
            ...DEFAULT_CRITERIOS,
            ...stored,
            metas: { ...DEFAULT_CRITERIOS.metas, ...stored.metas },
            score_thresholds: { ...DEFAULT_CRITERIOS.score_thresholds, ...(stored.score_thresholds || {}) },
            score_notas: {
              vol_total_faixas: stored.score_notas?.vol_total_faixas ?? DEFAULT_CRITERIOS.score_notas.vol_total_faixas,
              concentracao_faixas: stored.score_notas?.concentracao_faixas ?? DEFAULT_CRITERIOS.score_notas.concentracao_faixas,
              vendedores_faixas: stored.score_notas?.vendedores_faixas ?? DEFAULT_CRITERIOS.score_notas.vendedores_faixas,
            },
          };
        }
      } catch (err) {
        console.warn('Erro ao carregar critérios do Supabase, usando local:', err);
      }
    }
    const local = localStorage.getItem(LOCAL_CRITERIOS_KEY);
    if (!local) {
      localStorage.setItem(LOCAL_CRITERIOS_KEY, JSON.stringify(DEFAULT_CRITERIOS));
      return DEFAULT_CRITERIOS;
    }
    const stored = JSON.parse(local) as CriteriosConfig;
    return {
      ...DEFAULT_CRITERIOS,
      ...stored,
      metas: { ...DEFAULT_CRITERIOS.metas, ...stored.metas },
      score_thresholds: { ...DEFAULT_CRITERIOS.score_thresholds, ...(stored.score_thresholds || {}) },
      score_notas: {
        vol_total_faixas: stored.score_notas?.vol_total_faixas ?? DEFAULT_CRITERIOS.score_notas.vol_total_faixas,
        concentracao_faixas: stored.score_notas?.concentracao_faixas ?? DEFAULT_CRITERIOS.score_notas.concentracao_faixas,
        vendedores_faixas: stored.score_notas?.vendedores_faixas ?? DEFAULT_CRITERIOS.score_notas.vendedores_faixas,
      },
    };
  },

  async saveCriterios(config: CriteriosConfig): Promise<CriteriosConfig> {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('criterios_config')
          .update({ config, updated_at: new Date().toISOString() })
          .eq('id', '00000000-0000-0000-0000-000000000000');
        if (!error) return config;
      } catch (err) {
        console.warn('Erro ao salvar critérios no Supabase, usando local:', err);
      }
    }
    localStorage.setItem(LOCAL_CRITERIOS_KEY, JSON.stringify(config));
    return config;
  },

  getLastWeeklyUploadDate(): string {
    const data = localStorage.getItem('crm_prata_digital_last_upload_semanal');
    if (!data) {
      return new Date(2026, 5, 27).toISOString(); // Data simulada padrão
    }
    return data;
  },

  setLastWeeklyUploadDate(dateStr: string): void {
    localStorage.setItem('crm_prata_digital_last_upload_semanal', dateStr);
  },

  async saveParceiroStatusOnly(id: string, status: Parceiro['status']): Promise<void> {
    if (supabase) {
      try {
        await supabase
          .from('parceiros')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
      } catch (e) {
        console.warn('Erro ao salvar status do parceiro no Supabase:', e);
      }
    } else {
      const db = getLocalDB();
      const idx = db.parceiros.findIndex(p => p.id === id);
      if (idx !== -1) {
        db.parceiros[idx].status = status;
        saveLocalDB(db);
      }
    }
  },

  // --- PARCEIROS ---
  async getParceiros(): Promise<Parceiro[]> {
    let list: Parceiro[] = [];
    try {
      list = await fetchAllRows<Parceiro>('parceiros');
      list.sort((a, b) => a.nome.localeCompare(b.nome));
    } catch (err) {
      console.warn('Falha ao conectar no Supabase, usando banco local:', err);
    }
    if (list.length === 0) {
      list = getLocalDB().parceiros;
    }

    // Auto-cura para parceiros duplicados sem CNPJ
    const vistosSemCnpj = new Set<string>();
    const idsParaDeletar = new Set<string>();
    list.forEach(p => {
      const cnpjLimpo = (p.cnpj || '').replace(/\D/g, '');
      const semCnpj = cnpjLimpo === '';
      if (semCnpj) {
        const nomeNormalizado = p.nome.trim().toLowerCase();
        if (vistosSemCnpj.has(nomeNormalizado)) {
          idsParaDeletar.add(p.id);
        } else {
          vistosSemCnpj.add(nomeNormalizado);
        }
      }
    });

    if (idsParaDeletar.size > 0) {
      list = list.filter(p => !idsParaDeletar.has(p.id));
      
      const db = getLocalDB();
      db.parceiros = db.parceiros.filter(p => !idsParaDeletar.has(p.id));
      db.producao = db.producao.filter(pr => !idsParaDeletar.has(pr.parceiro_id));
      db.logs = db.logs.filter(l => !idsParaDeletar.has(l.parceiro_id));
      saveLocalDB(db);

      if (supabase) {
        for (const id of idsParaDeletar) {
          try {
            const { error } = await supabase.from('parceiros').delete().eq('id', id);
            if (error) {
              console.error('Erro ao excluir parceiro duplicado sem CNPJ no Supabase:', error);
            }
          } catch (err: any) {
            console.error('Falha de rede ao excluir no Supabase:', err);
          }
        }
      }
    }

    const config = await this.getCriterios();
    
    // Otimização N+1: Carregar todas as produções em lote (paginado, ver fetchAllRows)
    let allProds: ProducaoMensal[] = [];
    try {
      allProds = await fetchAllRows<ProducaoMensal>('producao');
    } catch (err) {
      console.warn('Erro ao obter todas as produções do Supabase, usando local:', err);
    }
    if (allProds.length === 0) {
      allProds = getLocalDB().producao;
    }

    // Criar mapa de relacionamento parceiro_id -> produções
    const prodsMap: { [key: string]: ProducaoMensal[] } = {};
    for (const prod of allProds) {
      if (!prodsMap[prod.parceiro_id]) {
        prodsMap[prod.parceiro_id] = [];
      }
      prodsMap[prod.parceiro_id].push(prod);
    }

    const finalParceiros: Parceiro[] = [];
    const fmtCur = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    const hoje = new Date();
    // Referência de "status vigente agora": o mês fechado mais recente (mês anterior
    // ao atual). Evita que o meio do mês em curso, sem produção lançada ainda,
    // dispare transições precoces (ex.: Reativado -> Inativo antes mesmo do mês
    // seguinte ter sido consolidado).
    const refAgora = shiftMonthRaw(hoje.getFullYear(), hoje.getMonth() + 1, -1);

    for (let p of list) {
      p.propostas_pagas_semana = p.propostas_pagas_semana !== undefined && p.propostas_pagas_semana !== null ? p.propostas_pagas_semana : 0;

      // Otimização: Ler do mapa em memória ao invés de bater no banco para cada parceiro
      const prods = prodsMap[p.id] || [];
      const diasLimites = config.limites;

      const statusCalculado = computeStatusAtMonth(p.created_at, prods, diasLimites, refAgora.ano, refAgora.mes, p.status);

      if (p.status !== statusCalculado) {
        // Classificar se a transição é ascendente (para um status "melhor")
        // ou descendente (para um status "pior"/"neutro")
        const upwardTransitions: Array<{ from: Parceiro['status']; to: Parceiro['status'] }> = [
          { from: 'Onboarding', to: 'Ativo' },
          { from: 'Inativo',    to: 'Reativado' },
          { from: 'Reativado',  to: 'Ativo' },
        ];
        const isUpward = upwardTransitions.some(t => t.from === p.status && t.to === statusCalculado);

        // Para transições ascendentes: só aplicar se o parceiro NÃO tiver produção
        // no mês corrente. Se tiver, significa que detectAndFireUpwardTransitions já
        // disparou a transição com referência mais recente e não devemos reverter.
        const mesCorrente = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
        const temProducaoCorrenteNaTabela = prods.some(
          pr => pr.ano === mesCorrente.ano && pr.mes === mesCorrente.mes &&
                ((pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0)) > 0
        );
        if (isUpward && temProducaoCorrenteNaTabela) {
          // Transição ascendente já tratada por detectAndFireUpwardTransitions — não sobrescrever.
          finalParceiros.push(p);
          continue;
        }

        const statusAnterior = p.status;
        p.status = statusCalculado;

        if (statusCalculado === 'Ativo' && statusAnterior === 'Onboarding') {
          this.saveLog({
            parceiro_id: p.id,
            data_contato: new Date().toISOString(),
            canal: 'WhatsApp',
            processo: 'Hunter',
            resumo: `Ativação automática: Novo parceiro ativado após registrar produção ativa de ${fmtCur(p.vol_prata_mensal)}.`,
            proxima_acao: 'Acompanhar produção e estreitar contato',
            data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
            classificacao_pos_contato: p.classificacao,
            crm_atualizado: true,
            origem: 'sistema'
          }).catch(console.error);
        } else if (statusCalculado === 'Reativado' && statusAnterior === 'Inativo') {
          this.saveLog({
            parceiro_id: p.id,
            data_contato: new Date().toISOString(),
            canal: 'WhatsApp',
            processo: 'Win-back',
            resumo: `Reativação automática: Parceiro voltou a produzir e passou para Reativado (produção de ${fmtCur(p.vol_prata_mensal)}).`,
            proxima_acao: 'Confirmar manutenção da produção no mês seguinte',
            data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
            classificacao_pos_contato: p.classificacao,
            crm_atualizado: true,
            origem: 'sistema'
          }).catch(console.error);
        } else if (statusCalculado === 'Ativo' && statusAnterior === 'Reativado') {
          this.saveLog({
            parceiro_id: p.id,
            data_contato: new Date().toISOString(),
            canal: 'WhatsApp',
            processo: 'Farmer',
            resumo: 'Consolidação automática: Parceiro manteve produção no mês seguinte à reativação e passou para Ativo.',
            proxima_acao: 'Manter acompanhamento de rotina',
            data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
            classificacao_pos_contato: p.classificacao,
            crm_atualizado: true,
            origem: 'sistema'
          }).catch(console.error);
        } else if (statusCalculado === 'Inativo' && statusAnterior === 'Reativado') {
          this.saveLog({
            parceiro_id: p.id,
            data_contato: new Date().toISOString(),
            canal: 'WhatsApp',
            processo: 'Win-back',
            resumo: 'Parceiro reativado não manteve produção no mês seguinte e retornou para Inativo.',
            proxima_acao: 'Reavaliar estratégia de reativação',
            data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
            classificacao_pos_contato: p.classificacao,
            crm_atualizado: true,
            origem: 'sistema'
          }).catch(console.error);
        }

        this.saveParceiroStatusOnly(p.id, statusCalculado).catch(console.error);
      }

      finalParceiros.push(p);
    }

    return finalParceiros;
  },

  async saveParceiro(parceiro: Partial<Parceiro>): Promise<Parceiro> {
    const config = await this.getCriterios();
    const { score, classificacao } = calculateScoreAndClassification(parceiro, config);
    const updated = {
      ...parceiro,
      score_comercial: score,
      classificacao: classificacao,
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        let result;
        if (parceiro.id && !parceiro.id.startsWith('p') && parceiro.id.length > 5) {
          const { data, error } = await supabase
            .from('parceiros')
            .update(updated)
            .eq('id', parceiro.id)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          const { id, ...insertData } = updated;
          const finalInsertData = {
            ...insertData,
            created_at: parceiro.created_at || new Date().toISOString()
          };
          const { data, error } = await supabase
            .from('parceiros')
            .insert([finalInsertData])
            .select()
            .single();
          if (error) throw error;
          result = data;
        }
        return result as Parceiro;
      } catch (err) {
        console.warn('Falha ao gravar no Supabase, usando banco local:', err);
      }
    }

    const db = getLocalDB();
    if (parceiro.id) {
      const idx = db.parceiros.findIndex(p => p.id === parceiro.id);
      if (idx !== -1) {
        db.parceiros[idx] = { ...db.parceiros[idx], ...updated } as Parceiro;
        saveLocalDB(db);
        return db.parceiros[idx];
      }
    }
    
    const newPartner: Parceiro = {
      ...updated,
      id: 'p_' + Math.random().toString(36).substr(2, 9),
      created_at: parceiro.created_at || new Date().toISOString()
    } as Parceiro;
    db.parceiros.push(newPartner);
    saveLocalDB(db);
    return newPartner;
  },

  async deleteParceiro(id: string): Promise<void> {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('parceiros')
          .delete()
          .eq('id', id);
        if (error) throw error;
        return;
      } catch (err) {
        console.warn('Falha ao excluir no Supabase, usando banco local:', err);
      }
    }

    const db = getLocalDB();
    db.parceiros = db.parceiros.filter(p => p.id !== id);
    db.producao = db.producao.filter(pr => pr.parceiro_id !== id);
    db.logs = db.logs.filter(l => l.parceiro_id !== id);
    saveLocalDB(db);
  },

  // Verifica parceiros em Onboarding que ultrapassaram a janela de dias_conversao_hunter
  // sem registrar produção e os inativa automaticamente.
  // Chamado na abertura do sistema (checkUser), independente de importação de planilha.
  async checkAndInactivateOnboarding(
    diasConversao: number = 7
  ): Promise<{ inativados: string[] }> {
    const inativados: string[] = [];
    const agora = new Date();

    try {
      // Buscar apenas parceiros em Onboarding pós-corte (created_at confiável)
      const DATA_CORTE = new Date('2026-07-01T00:00:00Z');

      let candidatos: Parceiro[] = [];
      if (supabase) {
        const { data, error } = await supabase
          .from('parceiros')
          .select('*')
          .eq('status', 'Onboarding');
        if (error) throw error;
        candidatos = (data as Parceiro[]).filter(p => {
          const criacao = new Date(p.created_at || '');
          return criacao >= DATA_CORTE;
        });
      } else {
        const db = getLocalDB();
        candidatos = db.parceiros.filter(p => {
          if (p.status !== 'Onboarding') return false;
          const criacao = new Date(p.created_at || '');
          return criacao >= DATA_CORTE;
        });
      }

      for (const parceiro of candidatos) {
        const criacao = new Date(parceiro.created_at || '');
        const diasDesde = (agora.getTime() - criacao.getTime()) / (1000 * 60 * 60 * 24);

        if (diasDesde <= diasConversao) continue;

        // Verificar se tem alguma produção registrada (semanal ou mensal)
        let temProducao = false;
        if (supabase) {
          const [{ data: semanais }, { data: mensais }] = await Promise.all([
            supabase.from('producoes_semanais').select('id, vol_total').eq('parceiro_id', parceiro.id),
            supabase.from('producao').select('id, vol_total').eq('parceiro_id', parceiro.id)
          ]);
          temProducao =
            (semanais || []).some((s: any) => (s.vol_total || 0) > 0) ||
            (mensais || []).some((m: any) => (m.vol_total || 0) > 0);
        } else {
          const db = getLocalDB();
          temProducao = db.producao.some(
            pr => pr.parceiro_id === parceiro.id && (pr.vol_total || 0) > 0
          );
        }

        if (temProducao) continue;

        // Sem producao e fora da janela: inativar
        if (supabase) {
          await supabase
            .from('parceiros')
            .update({ status: 'Inativo' })
            .eq('id', parceiro.id);

          // Gravar log de sistema
          await supabase.from('crm_logs').insert([{
            parceiro_id: parceiro.id,
            data_contato: agora.toISOString(),
            canal: 'Sistema',
            processo: 'Inativacao Automatica',
            resumo: `Inativacao automatica: Parceiro em Onboarding ha ${Math.floor(diasDesde)} dias sem registrar producao (janela: ${diasConversao} dias).`,
            origem: 'sistema',
            created_at: agora.toISOString()
          }]);
        } else {
          const db = getLocalDB();
          const idx = db.parceiros.findIndex(p => p.id === parceiro.id);
          if (idx !== -1) {
            db.parceiros[idx].status = 'Inativo';
            saveLocalDB(db);
          }
        }

        inativados.push(parceiro.nome);
      }
    } catch (err) {
      console.warn('checkAndInactivateOnboarding: erro ao verificar parceiros:', err);
    }

    return { inativados };
  },

  // --- PRODUCAO ---
  async getProducao(parceiroId: string): Promise<ProducaoMensal[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producao')
          .select('*')
          .eq('parceiro_id', parceiroId)
          .order('ano', { ascending: true })
          .order('mes', { ascending: true });
        if (error) throw error;
        return data as ProducaoMensal[];
      } catch (err) {
        console.warn('Falha ao ler produção no Supabase, usando banco local:', err);
      }
    }
    return getLocalDB().producao
      .filter(p => p.parceiro_id === parceiroId)
      .sort((a, b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
  },

  async saveProducao(prod: ProducaoMensal): Promise<ProducaoMensal> {
    const vol_total = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);
    const item = { ...prod, vol_total };

    if (supabase) {
      try {
        let result;
        if (prod.id) {
          const { data, error } = await supabase
            .from('producao')
            .update(item)
            .eq('id', prod.id)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          const { data, error } = await supabase
            .from('producao')
            .insert([item])
            .select()
            .single();
          if (error) throw error;
          result = data;
        }
        
        // Atualizar o volume Prata mensal total na tabela parceiros
        await this.recalculateParceiroPrataVolume(prod.parceiro_id);
        
        return result as ProducaoMensal;
      } catch (err) {
        console.warn('Falha ao gravar produção no Supabase, usando banco local:', err);
      }
    }

    const db = getLocalDB();
    if (prod.id) {
      const idx = db.producao.findIndex(p => p.id === prod.id);
      if (idx !== -1) {
        db.producao[idx] = item;
      }
    } else {
      const idx = db.producao.findIndex(p => p.parceiro_id === prod.parceiro_id && p.ano === prod.ano && p.mes === prod.mes);
      if (idx !== -1) {
        db.producao[idx] = { ...db.producao[idx], ...item };
      } else {
        const newItem = {
          ...item,
          id: 'prod_' + Math.random().toString(36).substr(2, 9)
        };
        db.producao.push(newItem);
      }
    }
    saveLocalDB(db);
    
    // Atualizar localmente o parceiro
    const partnerIdx = db.parceiros.findIndex(p => p.id === prod.parceiro_id);
    if (partnerIdx !== -1) {
      // Usa o mês fechado mais recente (mês anterior ao atual) como referência;
      // se esse mês ainda não tiver produção lançada, cai para o registro mais
      // recente disponível até essa referência (nunca fixo, sempre dinâmico).
      const partnerProds = db.producao.filter(pr => pr.parceiro_id === prod.parceiro_id);
      const refAtual = getCurrentPeriodRef();
      const referencia = shiftMonth(refAtual.ano, refAtual.mes, -1);
      const consolidado = partnerProds
        .filter(pr => pr.ano < referencia.ano || (pr.ano === referencia.ano && pr.mes <= referencia.mes))
        .sort((a, b) => (b.ano * 12 + b.mes) - (a.ano * 12 + a.mes))[0];
      if (consolidado) {
        db.parceiros[partnerIdx].vol_prata_mensal = (consolidado.vol_fgts || 0) + (consolidado.vol_clt || 0) + (consolidado.vol_cgv || 0) + (consolidado.vol_pix || 0);
        // Recalcular score
        const { score, classificacao } = calculateScoreAndClassification(db.parceiros[partnerIdx]);
        db.parceiros[partnerIdx].score_comercial = score;
        db.parceiros[partnerIdx].classificacao = classificacao;
      }
    }
    saveLocalDB(db);

    return prod;
  },

  async recalculateParceiroPrataVolume(parceiroId: string) {
    if (!supabase) return;
    // Usa o mês fechado mais recente (mês anterior ao atual) como referência;
    // se esse mês ainda não tiver produção lançada, cai para o registro mais
    // recente disponível até essa referência (nunca fixo, sempre dinâmico).
    const refAtual = getCurrentPeriodRef();
    const referencia = shiftMonth(refAtual.ano, refAtual.mes, -1);
    const { data: prods } = await supabase
      .from('producao')
      .select('*')
      .eq('parceiro_id', parceiroId)
      .or(`ano.lt.${referencia.ano},and(ano.eq.${referencia.ano},mes.lte.${referencia.mes})`)
      .order('ano', { ascending: false })
      .order('mes', { ascending: false })
      .limit(1);

    if (prods && prods.length > 0) {
      const consolidado = prods[0];
      const volPrata = parseFloat(consolidado.vol_fgts || 0) + parseFloat(consolidado.vol_clt || 0) + parseFloat(consolidado.vol_cgv || 0) + parseFloat(consolidado.vol_pix || 0);
      
      // Pega o parceiro para recalcular o score
      const { data: partner } = await supabase
        .from('parceiros')
        .select('*')
        .eq('id', parceiroId)
        .single();
      
      if (partner) {
        partner.vol_prata_mensal = volPrata;
        const { score, classificacao } = calculateScoreAndClassification(partner);
        await supabase
          .from('parceiros')
          .update({
            vol_prata_mensal: volPrata,
            score_comercial: score,
            classificacao: classificacao
          })
          .eq('id', parceiroId);
      }
    }
  },

  // --- CRM LOGS / INTERAÇÕES ---
  async getLogs(parceiroId?: string): Promise<CrmLog[]> {
    if (supabase) {
      try {
        if (parceiroId) {
          // Filtrado por parceiro: volume sempre pequeno, não precisa paginar.
          const { data, error } = await supabase
            .from('crm_logs')
            .select('*')
            .eq('parceiro_id', parceiroId)
            .order('data_contato', { ascending: false });
          if (error) throw error;
          return data as CrmLog[];
        }
        // Sem filtro: busca em massa, sujeita ao teto de linhas do projeto
        // Supabase caso a tabela cresça — paginar para trazer 100% dos dados.
        const allLogs = await fetchAllRows<CrmLog>('crm_logs');
        return allLogs.sort((a, b) => b.data_contato.localeCompare(a.data_contato));
      } catch (err) {
        console.warn('Falha ao ler logs no Supabase, usando banco local:', err);
      }
    }
    const db = getLocalDB();
    if (parceiroId) {
      return db.logs.filter(l => l.parceiro_id === parceiroId).sort((a,b) => b.data_contato.localeCompare(a.data_contato));
    }
    return db.logs.sort((a,b) => b.data_contato.localeCompare(a.data_contato));
  },

  async saveLog(log: CrmLog): Promise<CrmLog> {
    const logItem = {
      ...log,
      origem: log.origem || 'manual',
      created_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('crm_logs')
          .insert([logItem])
          .select()
          .single();
        if (error) throw error;
        return data as CrmLog;
      } catch (err) {
        console.warn('Falha ao gravar log no Supabase, usando banco local:', err);
      }
    }

    const db = getLocalDB();
    const newLog = {
      ...logItem,
      id: 'log_' + Math.random().toString(36).substr(2, 9)
    };
    db.logs.push(newLog);
    saveLocalDB(db);
    return newLog;
  },

  // --- EVENTOS DE SEMANA (ativações / reativações por semana civil) ---
  async getEventosSemana(semanaInicio: string): Promise<EventoSemana[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('eventos_semana')
          .select('*')
          .eq('semana_inicio', semanaInicio);
        if (!error && data) return data as EventoSemana[];
      } catch (err) {
        console.warn('Erro ao ler eventos_semana no Supabase:', err);
      }
    }
    return [];
  },

  async saveEventoSemana(evento: Omit<EventoSemana, 'id' | 'created_at'>): Promise<EventoSemana | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('eventos_semana')
          .insert([evento])
          .select()
          .single();
        if (error) throw error;
        return data as EventoSemana;
      } catch (err) {
        console.warn('Erro ao salvar evento_semana no Supabase:', err);
      }
    }
    return null;
  },

  // --- TRANSIÇÕES IMEDIATAS (ascendentes) ---
  //
  // Chamado pelo ExcelImporter quando a semana importada é a ÚLTIMA do mês.
  // Avalia todos os parceiros e aplica apenas transições DESCENDENTES:
  //   Ativo → Inativo   (não produziu no mês que fechou)
  //   Reativado → Inativo (idem)
  //   Onboarding → Inativo (superou janela dias_conversao_hunter sem produzir)
  // Transições ascendentes já foram tratadas em detectAndFireUpwardTransitions.
  async runEndOfMonthDownwardTransitions(
    closedAno: number,
    closedMes: number,
    config: CriteriosConfig
  ): Promise<{ inativados: string[] }> {
    const parceiros = await this.getParceiros();
    const inativados: string[] = [];

    const downwardSources: Parceiro['status'][] = ['Ativo', 'Reativado', 'Onboarding'];

    for (const p of parceiros) {
      if (!downwardSources.includes(p.status)) continue;

      // Buscar produções mensais do parceiro para o histórico completo
      const prods = await this.getProducao(p.id);

      // Calcular status ao final do mês fechado
      const statusFechamento = computeStatusAtMonth(
        p.created_at,
        prods,
        config.limites,
        closedAno,
        closedMes,
        p.status
      );

      // Só aplicar se for transição descendente (Ativo/Reativado/Onboarding → Inativo)
      if (statusFechamento === 'Inativo' && p.status !== 'Inativo') {
        await this.saveParceiroStatusOnly(p.id, 'Inativo');
        inativados.push(p.nome);
      }
    }

    return { inativados };
  },

  // Chamado após qualquer saveProducaoSemanal (planilha ou manual).
  // Avalia o status do parceiro usando o mês CORRENTE (incluindo produção parcial)
  // e dispara apenas transições ascendentes que ainda não foram disparadas nessa semana.
  // Transições descendentes (Ativo→Inativo, Reativado→Inativo) permanecem avaliadas
  // no fechamento do mês por runEndOfMonthDownwardTransitions().
  async detectAndFireUpwardTransitions(
    parceiro: Parceiro,
    allProds: ProducaoMensal[],
    config: CriteriosConfig,
    weekInfo: WeekInfo,
    origem: 'planilha' | 'crm_direto'
  ): Promise<{ disparou: boolean; tipo: 'ativacao' | 'reativacao' | 'reativado_para_ativo' | null }> {
    const hoje = new Date();
    const refAno = hoje.getFullYear();
    const refMes = hoje.getMonth() + 1;

    const newStatus = computeStatusAtMonth(parceiro.created_at, allProds, config.limites, refAno, refMes, parceiro.status);
    const currentStatus = parceiro.status;

    if (newStatus === currentStatus) return { disparou: false, tipo: null };

    const isOnboardingToAtivo   = newStatus === 'Ativo'     && currentStatus === 'Onboarding';
    const isInativoToReativado  = newStatus === 'Reativado' && currentStatus === 'Inativo';
    const isReativadoToAtivo    = newStatus === 'Ativo'     && currentStatus === 'Reativado';

    if (!isOnboardingToAtivo && !isInativoToReativado && !isReativadoToAtivo) {
      return { disparou: false, tipo: null };
    }

    const tipoEvento: 'ativacao' | 'reativacao' =
      isOnboardingToAtivo ? 'ativacao' : 'reativacao';

    const fmtCur = (val: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    const volPrata = getVolPrataUltimaProducao(allProds);

    // Atualizar status imediatamente no banco
    parceiro.status = newStatus;
    await this.saveParceiroStatusOnly(parceiro.id, newStatus).catch(console.error);

    // Para Reativado→Ativo: atualiza status e gera log, mas NÃO cria evento_semana
    // (a reativação já foi contada no evento Inativo→Reativado anterior)
    if (isReativadoToAtivo) {
      await this.saveLog({
        parceiro_id: parceiro.id,
        data_contato: new Date().toISOString(),
        canal: 'WhatsApp',
        processo: 'Farmer',
        resumo: `Consolidação automática: Parceiro manteve produção no mês seguinte à reativação e passou para Ativo (vol. Prata ${fmtCur(volPrata)}).`,
        proxima_acao: 'Manter acompanhamento de rotina',
        data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        classificacao_pos_contato: parceiro.classificacao,
        crm_atualizado: true,
        origem: 'sistema'
      }).catch(console.error);
      return { disparou: true, tipo: 'reativado_para_ativo' };
    }

    // Verificar deduplicação: se já existe evento para esse parceiro+tipo+semana, não registrar novamente
    const eventosExistentes = await this.getEventosSemana(weekInfo.inicio);
    const jaExiste = eventosExistentes.some(
      e => e.parceiro_id === parceiro.id && e.tipo === tipoEvento
    );

    if (!jaExiste) {
      await this.saveEventoSemana({
        semana_inicio: weekInfo.inicio,
        semana_fim: weekInfo.fim,
        ano: weekInfo.ano,
        mes: weekInfo.mes,
        semana_num: weekInfo.semana_num,
        tipo: tipoEvento,
        parceiro_id: parceiro.id,
        origem
      });
    }

    // Gerar log automático de CRM
    if (isOnboardingToAtivo) {
      await this.saveLog({
        parceiro_id: parceiro.id,
        data_contato: new Date().toISOString(),
        canal: 'WhatsApp',
        processo: 'Hunter',
        resumo: `Ativação automática: Novo parceiro ativou na ${weekInfo.label} com produção Prata de ${fmtCur(volPrata)}.`,
        proxima_acao: 'Acompanhar produção e estreitar contato',
        data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        classificacao_pos_contato: parceiro.classificacao,
        crm_atualizado: true,
        origem: 'sistema'
      }).catch(console.error);
    } else if (isInativoToReativado) {
      await this.saveLog({
        parceiro_id: parceiro.id,
        data_contato: new Date().toISOString(),
        canal: 'WhatsApp',
        processo: 'Win-back',
        resumo: `Reativação automática: Parceiro voltou a produzir na ${weekInfo.label} (vol. Prata ${fmtCur(volPrata)}).`,
        proxima_acao: 'Confirmar manutenção da produção no mês seguinte',
        data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
        classificacao_pos_contato: parceiro.classificacao,
        crm_atualizado: true,
        origem: 'sistema'
      }).catch(console.error);
    }

    return { disparou: true, tipo: tipoEvento };
  },

  // --- SEMÁFORO & METAS ---
  async getSemafaroStatus(preloadedParceiros?: Parceiro[]): Promise<SemafaroStatus> {
    const parceiros = preloadedParceiros || await this.getParceiros();
    const config = await this.getCriterios();
    const weekInfo = getCurrentWeek();

    // FARMER: soma propostas_pagas das producoes_semanais da semana civil corrente
    let farmerPropostasSemana = 0;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producoes_semanais')
          .select('propostas_pagas')
          .eq('semana_inicio', weekInfo.inicio);
        if (!error && data) {
          farmerPropostasSemana = data.reduce((sum: number, r: any) => sum + (r.propostas_pagas || 0), 0);
        }
      } catch (err) {
        console.warn('Erro ao buscar propostas_pagas da semana:', err);
      }
    }

    // HUNTER: eventos_semana da semana civil corrente, enriquecidos com nomes
    const eventos = await this.getEventosSemana(weekInfo.inicio);
    const parceiroMap = new Map(parceiros.map(p => [p.id, p.nome]));
    const hunterAtivacoes: EventoSemana[] = eventos
      .filter(e => e.tipo === 'ativacao')
      .map(e => ({ ...e, parceiro_nome: parceiroMap.get(e.parceiro_id) || 'Desconhecido' }));
    const hunterReativacoes: EventoSemana[] = eventos
      .filter(e => e.tipo === 'reativacao')
      .map(e => ({ ...e, parceiro_nome: parceiroMap.get(e.parceiro_id) || 'Desconhecido' }));

    const novosAtivosSemana  = hunterAtivacoes.length;
    const reativadosSemana   = hunterReativacoes.length;

    const metaFarmer          = config.metas.farmer_propostas_pagas_semana;
    const metaHunterNovos     = config.metas.hunter_novos_ativos_semana;
    const metaHunterReativados = config.metas.hunter_reativacoes_semana;

    const farmerStatus = farmerPropostasSemana >= metaFarmer ? 'Verde' : 'Vermelho';
    const hunterStatus = (novosAtivosSemana >= metaHunterNovos || reativadosSemana >= metaHunterReativados) ? 'Verde' : 'Vermelho';

    let hunterAcao = '';
    let farmerAcao = '';
    let statusGeral = '';

    if (hunterStatus === 'Verde' && farmerStatus === 'Verde') {
      statusGeral = 'Meta Atingida!';
      hunterAcao = `Ritmo excelente! ${novosAtivosSemana} ativações e ${reativadosSemana} reativações nesta semana (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Parceiros saudáveis. ${farmerPropostasSemana} propostas pagas nesta semana, superando a meta de ${metaFarmer}.`;
    } else if (hunterStatus === 'Verde' && farmerStatus === 'Vermelho') {
      statusGeral = 'Prospecção Forte, Carteira com Baixo Volume';
      hunterAcao = `${novosAtivosSemana} ativações e ${reativadosSemana} reativações registradas.`;
      farmerAcao = `Alerta! ${farmerPropostasSemana} propostas nesta semana, abaixo da meta de ${metaFarmer}. Estimular parceiros da carteira.`;
    } else if (hunterStatus === 'Vermelho' && farmerStatus === 'Verde') {
      statusGeral = 'Carteira Saudável, Prospecção Lenta';
      hunterAcao = `Foco em ativação necessário. Apenas ${novosAtivosSemana} ativações e ${reativadosSemana} reativações (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Farmer saudável. ${farmerPropostasSemana} propostas nesta semana (meta: ${metaFarmer}).`;
    } else {
      statusGeral = 'Semana Crítica';
      hunterAcao = `Urgente! Apenas ${novosAtivosSemana} ativações e ${reativadosSemana} reativações (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Atenção total! ${farmerPropostasSemana} propostas nesta semana, abaixo da meta de ${metaFarmer}.`;
    }

    return {
      hunter: hunterStatus,
      farmer: farmerStatus,
      hunterAcao,
      farmerAcao,
      statusGeral,
      hunterAtivacoes,
      hunterReativacoes,
      farmerPropostasSemana,
      semanaInfo: weekInfo
    };
  },

  // --- COMPROMISSOS/CALENDÁRIO ---
  async getTasks(): Promise<TaskItem[]> {
    const logs = await this.getLogs();
    const parceiros = await this.getParceiros();
    const tasks: TaskItem[] = [];
    
    // Apenas logs registrados manualmente pela Monique geram tarefas.
    // Logs automáticos de transição de status (origem === 'sistema') são excluídos.
    logs.forEach(log => {
      if (log.proxima_acao && log.data_proxima_acao && log.origem !== 'sistema') {
        const partner = parceiros.find(p => p.id === log.parceiro_id);
        tasks.push({
          id: 'task_' + log.id,
          title: log.proxima_acao,
          date: log.data_proxima_acao,
          done: false,
          parceiro_nome: partner ? partner.nome : 'Parceiro Desconhecido',
          parceiro_id: log.parceiro_id
        });
      }
    });

    return tasks.sort((a,b) => a.date.localeCompare(b.date));
  },

  async deleteTask(taskId: string): Promise<void> {
    const logId = taskId.replace('task_', '');
    if (supabase) {
      try {
        const { error } = await supabase
          .from('crm_logs')
          .update({ proxima_acao: null, data_proxima_acao: null })
          .eq('id', logId);
        if (error) throw error;
      } catch (err) {
        console.error('Erro ao apagar tarefa no Supabase:', err);
        throw err;
      }
    } else {
      const db = getLocalDB();
      const idx = db.logs.findIndex(l => l.id === logId);
      if (idx !== -1) {
        db.logs[idx].proxima_acao = '';
        db.logs[idx].data_proxima_acao = '';
        saveLocalDB(db);
      }
    }
  },

  async getAllProducao(): Promise<ProducaoMensal[]> {
    try {
      const allProds = await fetchAllRows<ProducaoMensal>('producao');
      if (allProds.length > 0) return allProds;
    } catch (err) {
      console.warn('Erro ao obter todas as produções do Supabase:', err);
    }
    return getLocalDB().producao;
  },

  // Busca TODAS as produções semanais de todos os parceiros (usada pelo Dashboard
  // para consolidar dados do mês atual quando não há registro mensal fechado).
  async getAllProducoesSemanais(): Promise<ProducaoSemanal[]> {
    try {
      const allSemanais = await fetchAllRows<ProducaoSemanal>('producoes_semanais');
      if (allSemanais.length > 0) return allSemanais;
    } catch (err) {
      console.warn('Erro ao obter todas as produções semanais do Supabase:', err);
    }
    return getLocalDB().producoes_semanais || [];
  },

  // --- PRODUÇÃO SEMANAL ---
  async getProducoesSemanais(parceiroId: string): Promise<ProducaoSemanal[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producoes_semanais')
          .select('*')
          .eq('parceiro_id', parceiroId)
          .order('ano', { ascending: true })
          .order('mes', { ascending: true })
          .order('semana', { ascending: true });
        if (!error && data) return data as ProducaoSemanal[];
      } catch (err) {
        console.warn('Erro ao ler producoes_semanais no Supabase, usando local:', err);
      }
    }
    const db = getLocalDB();
    return (db.producoes_semanais || [])
      .filter(p => p.parceiro_id === parceiroId)
      .sort((a,b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes !== b.mes ? a.mes - b.mes : a.semana - b.semana));
  },

  // Salva (ou faz upsert) de uma produção semanal.
  //
  // FONTE DE VERDADE: semana_inicio (string YYYY-MM-DD — segunda-feira).
  //   - ano, mes e semana_num são SEMPRE derivados de getWeekInfo(semana_inicio).
  //     Qualquer valor de ano/mes passado pelo chamador é ignorado.
  //   - Deduplicação por (parceiro_id, semana_inicio). Se já existe registro:
  //       • origem 'planilha' vs existente 'manual' → SKIP silencioso (manual prevalece)
  //       • qualquer outro caso                      → UPSERT (sobrescreve)
  //
  // Após salvar: chama consolidateMensal + detectAndFireUpwardTransitions.
  async saveProducaoSemanal(
    prod: Partial<ProducaoSemanal> & { semana_inicio: string; origem_entrada: 'planilha' | 'manual' }
  ): Promise<ProducaoSemanal> {
    const parceiroId = prod.parceiro_id!;
    const origemEntrada = prod.origem_entrada;

    // 1. Derivar (ano, mes, semana_num) da semana_inicio — ignora caller's ano/mes
    const weekInfo = getWeekInfo(new Date(prod.semana_inicio + 'T12:00:00Z'));
    const ano = weekInfo.ano;
    const mes = weekInfo.mes;
    const semana = weekInfo.semana_num;

    // 2. Checar registro existente por (parceiro_id, semana_inicio)
    let existingRecord: ProducaoSemanal | null = null;
    if (supabase) {
      try {
        const { data } = await supabase
          .from('producoes_semanais')
          .select('*')
          .eq('parceiro_id', parceiroId)
          .eq('semana_inicio', prod.semana_inicio)
          .maybeSingle();
        if (data) existingRecord = data as ProducaoSemanal;
      } catch (e) {
        console.warn('Erro ao checar dedup por semana_inicio:', e);
      }
    } else {
      const db = getLocalDB();
      existingRecord = (db.producoes_semanais || []).find(
        p => p.parceiro_id === parceiroId && p.semana_inicio === prod.semana_inicio
      ) || null;
    }

    // 3. Regra de deduplicação: manual PREVALECE sobre planilha
    if (existingRecord && origemEntrada === 'planilha' && existingRecord.origem_entrada === 'manual') {
      console.info(
        `[saveProducaoSemanal] SKIP — ${parceiroId} semana ${prod.semana_inicio}: ` +
        `entrada manual existente prevalece sobre planilha.`
      );
      return existingRecord;
    }

    const vol_total = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);
    const item: ProducaoSemanal = {
      ...prod,
      ano,
      mes,
      semana,
      semana_inicio: prod.semana_inicio,
      vol_total,
      propostas_pagas: prod.propostas_pagas || 0,
      origem_entrada: origemEntrada,
      created_at: prod.created_at || new Date().toISOString()
    } as ProducaoSemanal;

    let result: ProducaoSemanal = item;

    if (supabase) {
      try {
        if (existingRecord?.id) {
          // UPSERT: sobrescreve o registro existente
          const { data, error } = await supabase
            .from('producoes_semanais')
            .update(item)
            .eq('id', existingRecord.id)
            .select()
            .single();
          if (error) throw error;
          result = data as ProducaoSemanal;
        } else {
          const { data, error } = await supabase
            .from('producoes_semanais')
            .insert([item])
            .select()
            .single();
          if (error) throw error;
          result = data as ProducaoSemanal;
        }
      } catch (err) {
        console.warn('Erro ao salvar semana no Supabase, usando local:', err);
      }
    } else {
      const db = getLocalDB();
      if (!db.producoes_semanais) db.producoes_semanais = [];
      const idx = db.producoes_semanais.findIndex(
        p => p.parceiro_id === parceiroId && p.semana_inicio === prod.semana_inicio
      );
      if (idx !== -1) {
        db.producoes_semanais[idx] = { ...db.producoes_semanais[idx], ...item };
        result = db.producoes_semanais[idx];
      } else {
        const newItem = { ...item, id: 'prod_sem_' + Math.random().toString(36).substr(2, 9) };
        db.producoes_semanais.push(newItem);
        result = newItem;
      }
      saveLocalDB(db);
    }

    // 4. Consolidar o mês (recalcula producao mensal a partir das semanas)
    await this.consolidateMensal(parceiroId, ano, mes);

    // 5. Disparar transições ascendentes imediatas
    //    Busca apenas o parceiro específico e suas produções — sem getParceiros() completo.
    try {
      const config = await this.getCriterios();
      if (supabase) {
        const [parceiroResult, prodsResult] = await Promise.all([
          supabase.from('parceiros').select('*').eq('id', parceiroId).single(),
          supabase.from('producao').select('*').eq('parceiro_id', parceiroId)
        ]);
        const parceiro = parceiroResult.data as Parceiro | null;
        const parceiroProds = (prodsResult.data || []) as ProducaoMensal[];
        if (parceiro) {
          await this.detectAndFireUpwardTransitions(
            parceiro, parceiroProds, config, weekInfo,
            origemEntrada === 'planilha' ? 'planilha' : 'crm_direto'
          );
        }
      }
    } catch (e) {
      console.warn('Erro ao detectar transições após saveProducaoSemanal:', e);
    }

    // 6. Manter propostas_pagas_semana no cadastro do parceiro (campo legado,
    //    semáforo não lê mais daqui, mas mantemos por compatibilidade)
    if (supabase) {
      try {
        await supabase
          .from('parceiros')
          .update({ propostas_pagas_semana: item.propostas_pagas })
          .eq('id', parceiroId);
      } catch (e) {
        console.warn('Erro ao atualizar propostas_pagas_semana no Supabase:', e);
      }
    }

    return result;
  },

  // Edita campos de um registro semanal existente.
  // Recalcula vol_total, re-consolida o mês e dispara transições ascendentes.
  async updateProducaoSemanal(id: string, updates: Partial<ProducaoSemanal>): Promise<ProducaoSemanal> {
    // Buscar registro atual para ter o contexto completo
    let current: ProducaoSemanal | null = null;
    if (supabase) {
      const { data } = await supabase.from('producoes_semanais').select('*').eq('id', id).single();
      current = data as ProducaoSemanal | null;
    }
    if (!current) throw new Error('Registro semanal não encontrado: ' + id);

    const vol_total =
      (updates.vol_fgts  ?? current.vol_fgts  ?? 0) +
      (updates.vol_clt   ?? current.vol_clt   ?? 0) +
      (updates.vol_cgv   ?? current.vol_cgv   ?? 0) +
      (updates.vol_pix   ?? current.vol_pix   ?? 0);

    const merged = { ...current, ...updates, vol_total };

    let result: ProducaoSemanal = merged;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producoes_semanais')
          .update(merged)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        result = data as ProducaoSemanal;
      } catch (err) {
        console.warn('Erro ao atualizar semana no Supabase:', err);
        throw err;
      }
    }

    await this.consolidateMensal(current.parceiro_id, current.ano, current.mes);

    // Disparar transições ascendentes após edição
    try {
      const config = await this.getCriterios();
      const weekInfo = getWeekInfo(new Date((current.semana_inicio || '2026-01-01') + 'T12:00:00Z'));
      if (supabase) {
        const [parceiroResult, prodsResult] = await Promise.all([
          supabase.from('parceiros').select('*').eq('id', current.parceiro_id).single(),
          supabase.from('producao').select('*').eq('parceiro_id', current.parceiro_id)
        ]);
        const parceiro = parceiroResult.data as Parceiro | null;
        const parceiroProds = (prodsResult.data || []) as ProducaoMensal[];
        if (parceiro) {
          await this.detectAndFireUpwardTransitions(
            parceiro, parceiroProds, config, weekInfo, 'crm_direto'
          );
        }
      }
    } catch (e) {
      console.warn('Erro ao detectar transições após updateProducaoSemanal:', e);
    }

    return result;
  },

  // Exclui um registro semanal e re-consolida o mês.
  // Se nenhuma semana restar naquele mês, consolida também exclui o registro mensal.
  // Transições descendentes (Ativo→Inativo) NÃO são disparadas aqui — avaliadas no
  // fechamento do mês por getParceiros().
  async deleteProducaoSemanal(id: string, parceiroId: string, ano: number, mes: number): Promise<void> {
    if (supabase) {
      try {
        const { error } = await supabase.from('producoes_semanais').delete().eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.warn('Erro ao excluir semana no Supabase:', err);
        throw err;
      }
    } else {
      const db = getLocalDB();
      db.producoes_semanais = (db.producoes_semanais || []).filter(p => p.id !== id);
      saveLocalDB(db);
    }
    // consolidateMensal agora deleta o registro mensal se não restar nenhuma semana
    await this.consolidateMensal(parceiroId, ano, mes);
  },

  // Edita campos de um registro mensal LEGADO (sem semanas vinculadas).
  // NÃO dispara detectAndFireUpwardTransitions — é correção pontual de dado legado.
  async updateProducaoMensal(id: string, updates: Partial<ProducaoMensal>): Promise<ProducaoMensal> {
    const vol_total =
      (updates.vol_fgts  ?? 0) +
      (updates.vol_clt   ?? 0) +
      (updates.vol_cgv   ?? 0) +
      (updates.vol_pix   ?? 0);

    const merged = { ...updates, vol_total };

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producao')
          .update(merged)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        await this.recalculateParceiroPrataVolume((data as ProducaoMensal).parceiro_id);
        return data as ProducaoMensal;
      } catch (err) {
        console.warn('Erro ao atualizar produção mensal legada no Supabase:', err);
        throw err;
      }
    }
    throw new Error('updateProducaoMensal requer Supabase');
  },

  // Exclui registro mensal LEGADO (sem semanas vinculadas) e em cascata
  // exclui também quaisquer producoes_semanais do mesmo (parceiro_id, ano, mes),
  // caso existam (segurança).
  async deleteProducaoMensal(id: string, parceiroId: string, ano: number, mes: number): Promise<void> {
    if (supabase) {
      try {
        // Cascata: excluir semanas do mesmo mês, se houver
        await supabase
          .from('producoes_semanais')
          .delete()
          .eq('parceiro_id', parceiroId)
          .eq('ano', ano)
          .eq('mes', mes);
        // Excluir o registro mensal
        const { error } = await supabase.from('producao').delete().eq('id', id);
        if (error) throw error;
        await this.recalculateParceiroPrataVolume(parceiroId);
      } catch (err) {
        console.warn('Erro ao excluir produção mensal no Supabase:', err);
        throw err;
      }
    } else {
      const db = getLocalDB();
      db.producoes_semanais = (db.producoes_semanais || []).filter(
        p => !(p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes)
      );
      db.producao = db.producao.filter(p => p.id !== id);
      saveLocalDB(db);
    }
  },

  async consolidateMensal(parceiroId: string, ano: number, mes: number): Promise<void> {
    const db = getLocalDB();
    let semanais: ProducaoSemanal[] = [];

    if (supabase) {
      try {
        const { data } = await supabase
          .from('producoes_semanais')
          .select('*')
          .eq('parceiro_id', parceiroId)
          .eq('ano', ano)
          .eq('mes', mes);
        semanais = data || [];
      } catch (e) {
        semanais = (db.producoes_semanais || []).filter(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
      }
    } else {
      semanais = (db.producoes_semanais || []).filter(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
    }

    let sumFgts = 0;
    let sumClt = 0;
    let sumCgv = 0;
    let sumPix = 0;
    let sumPropostas = 0;

    semanais.forEach(s => {
      sumFgts += s.vol_fgts || 0;
      sumClt += s.vol_clt || 0;
      sumCgv += s.vol_cgv || 0;
      sumPix += s.vol_pix || 0;
      sumPropostas += s.propostas_pagas || 0;
    });

    if (semanais.length > 0) {
      // Semanas existem: recalcular total mensal a partir delas
      let prodMensalId: string | undefined;
      if (supabase) {
        try {
          const { data } = await supabase
            .from('producao')
            .select('id')
            .eq('parceiro_id', parceiroId)
            .eq('ano', ano)
            .eq('mes', mes)
            .maybeSingle();
          prodMensalId = data?.id;
        } catch (e) {
          const m = db.producao.find(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
          prodMensalId = m?.id;
        }
      } else {
        const m = db.producao.find(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
        prodMensalId = m?.id;
      }

      await this.saveProducao({
        id: prodMensalId,
        parceiro_id: parceiroId,
        ano,
        mes,
        vol_fgts: sumFgts,
        vol_clt: sumClt,
        vol_cgv: sumCgv,
        vol_pix: sumPix,
        propostas_pagas: sumPropostas
      });
    } else {
      // Nenhuma semana restou: excluir o registro mensal correspondente (se existir).
      // Isso só acontece quando a ÚLTIMA semana de um mês é deletada por deleteProducaoSemanal.
      // Registros mensais legados (criados sem semanas) nunca chegam aqui porque
      // deleteProducaoSemanal só é chamado sobre semanas que existem.
      if (supabase) {
        try {
          await supabase
            .from('producao')
            .delete()
            .eq('parceiro_id', parceiroId)
            .eq('ano', ano)
            .eq('mes', mes);
        } catch (e) {
          console.warn('Erro ao excluir registro mensal após remoção da última semana:', e);
        }
      } else {
        const db2 = getLocalDB();
        db2.producao = db2.producao.filter(
          p => !(p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes)
        );
        saveLocalDB(db2);
      }
    }
  },

  getParceirosComStatusNoPeriodo(
    parceiros: Parceiro[],
    allProducoes: ProducaoMensal[],
    period: string,
    limitesConfig?: { dias_inatividade_winback: number; dias_conversao_hunter: number }
  ): Parceiro[] {
    const activeMonths = getMonthsForPeriod(period);
    
    // Encontrar o maior mês/ano do período
    let refAno = 0;
    let refMes = 0;
    activeMonths.forEach(m => {
      if (m.ano > refAno || (m.ano === refAno && m.mes > refMes)) {
        refAno = m.ano;
        refMes = m.mes;
      }
    });

    // Mapear produções por parceiro
    const prodsMap: Record<string, ProducaoMensal[]> = {};
    allProducoes.forEach(prod => {
      if (!prodsMap[prod.parceiro_id]) {
        prodsMap[prod.parceiro_id] = [];
      }
      prodsMap[prod.parceiro_id].push(prod);
    });

    const limites = limitesConfig || { dias_inatividade_winback: 60, dias_conversao_hunter: 7 };
    const numMonths = activeMonths.length;

    return parceiros
      .map(p => {
        const prods = prodsMap[p.id] || [];

        // Apenas produções anteriores ou iguais à referência entram na simulação —
        // isso garante que "status no período X" nunca enxergue produção futura.
        const prodsAteReferencia = prods.filter(pr => (pr.ano < refAno) || (pr.ano === refAno && pr.mes <= refMes));

        const statusCalculado = computeStatusAtMonth(p.created_at, prodsAteReferencia, limites, refAno, refMes);

        // vol_prata_mensal = produção Prata do mês anterior fechado (mês imediatamente
        // anterior ao refMes/refAno). É esse valor que alimenta concentração, ordenação
        // e exibição de "Vol. Prata" na listagem e na ficha do parceiro.
        // vol_total_mensal = campo fixo cadastrado manualmente na ficha (média dos 3
        // últimos meses informados pelo operador). Não é recalculado aqui — vem do banco.
        // A concentração (vol_prata / vol_total) é capada em 100% no ponto de exibição.
        const { ano: anoAnt, mes: mesAnt } = shiftMonth(refAno, refMes, -1);
        const prodMesAnterior = prods.find(pr => pr.ano === anoAnt && pr.mes === mesAnt);
        const volPrataMesAnterior = prodMesAnterior
          ? (prodMesAnterior.vol_fgts || 0) + (prodMesAnterior.vol_clt || 0) +
            (prodMesAnterior.vol_cgv || 0) + (prodMesAnterior.vol_pix || 0)
          : 0;

        return {
          ...p,
          status: statusCalculado,
          vol_prata_mensal: volPrataMesAnterior,
          vol_total_mensal: p.vol_total_mensal || 0
        };
      });
  },

  // Taxa Reativação = quantidade de parceiros que transicionaram de Inativo para
  // Reativado durante o período, dividido pelo total de parceiros que estavam em
  // Inativo no mês imediatamente anterior ao início do período.
  //
  // Não depende de "produzir em todos os meses" nem de qualquer outra regra ligada
  // ao seletor — depende exclusivamente de a transição Inativo -> Reativado ter
  // ocorrido em algum ponto da linha do tempo dentro do período selecionado.
  getTaxaReativacaoNoPeriodo(
    parceiros: Parceiro[],
    allProducoes: ProducaoMensal[],
    period: string,
    limitesConfig?: { dias_inatividade_winback: number; dias_conversao_hunter: number }
  ): number {
    const activeMonths = getMonthsForPeriod(period);
    const limites = limitesConfig || { dias_inatividade_winback: 60, dias_conversao_hunter: 7 };

    // Achar o menor e o maior mês/ano do período selecionado
    let minAno = 9999, minMes = 13, maxAno = 0, maxMes = 0;
    activeMonths.forEach(m => {
      if (m.ano < minAno || (m.ano === minAno && m.mes < minMes)) { minAno = m.ano; minMes = m.mes; }
      if (m.ano > maxAno || (m.ano === maxAno && m.mes > maxMes)) { maxAno = m.ano; maxMes = m.mes; }
    });

    // Mês imediatamente anterior ao início do período — universo de base da taxa.
    const mesBase = shiftMonth(minAno, minMes, -1);

    const prodsMap: Record<string, ProducaoMensal[]> = {};
    allProducoes.forEach(prod => {
      if (!prodsMap[prod.parceiro_id]) prodsMap[prod.parceiro_id] = [];
      prodsMap[prod.parceiro_id].push(prod);
    });

    // Universo: parceiros cujo status simulado no mês base é Inativo
    const parceirosEmInativo = parceiros.filter(p => {
      const prods = (prodsMap[p.id] || []).filter(pr =>
        (pr.ano < mesBase.ano) || (pr.ano === mesBase.ano && pr.mes <= mesBase.mes)
      );
      return computeStatusAtMonth(p.created_at, prods, limites, mesBase.ano, mesBase.mes) === 'Inativo';
    });

    if (parceirosEmInativo.length === 0) return 0;

    // Para cada parceiro do universo, simula a linha do tempo até o fim do período
    // e verifica se em algum mês DENTRO do período o status virou 'Reativado'.
    // Como o mês base confirma 'Inativo', a primeira ocorrência de 'Reativado'
    // dentro do período é, por construção, a transição Inativo -> Reativado.
    let reativados = 0;
    parceirosEmInativo.forEach(p => {
      const prods = (prodsMap[p.id] || []).filter(pr =>
        (pr.ano < maxAno) || (pr.ano === maxAno && pr.mes <= maxMes)
      );
      const timeline = computeStatusTimeline(p.created_at, prods, limites, maxAno, maxMes);
      const transicionou = timeline.some(entry =>
        entry.status === 'Reativado' &&
        activeMonths.some(m => m.ano === entry.ano && m.mes === entry.mes)
      );
      if (transicionou) reativados++;
    });

    return Math.round((reativados / parceirosEmInativo.length) * 1000) / 10;
  }
};

// --- Sistema de Períodos Dinâmico (baseado na data real do sistema) ---
// Chave de mês individual usa o formato "AAAA-M" (ex: "2026-7"), gerado e
// interpretado dinamicamente. Não há mais listas fixas de meses/anos: a cada
// virada de mês, o "mês atual" e as opções do seletor se atualizam sozinhos.

const NOMES_MES_COMPLETO = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const NOMES_MES_ABREV = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

// Referência de "hoje" segundo o relógio do sistema. Isolado em uma função
// própria para que todo o resto do módulo dependa de uma única fonte de verdade.
export const getCurrentPeriodRef = () => {
  const now = new Date();
  return { ano: now.getFullYear(), mes: now.getMonth() + 1 };
};

// Desloca um mês/ano em `delta` meses (aceita negativos). Ex: shiftMonth(2026, 1, -1) => {ano: 2025, mes: 12}
export const shiftMonth = (ano: number, mes: number, delta: number) => {
  const totalMeses = ano * 12 + (mes - 1) + delta;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = ((totalMeses % 12) + 12) % 12 + 1;
  return { ano: novoAno, mes: novoMes };
};

const buildMonthKey = (ano: number, mes: number) => `${ano}-${mes}`;

export const getMonthShortLabel = (ano: number, mes: number) => `${NOMES_MES_ABREV[mes - 1]}/${ano}`;

const parseMonthKey = (period: string): { ano: number; mes: number } | null => {
  const match = /^(\d{4})-(\d{1,2})$/.exec(period);
  if (!match) return null;
  return { ano: parseInt(match[1], 10), mes: parseInt(match[2], 10) };
};

export const getMonthsForPeriod = (period: string) => {
  const atual = getCurrentPeriodRef();

  if (period === 'ultimos_3_meses') {
    return [0, -1, -2].map(d => shiftMonth(atual.ano, atual.mes, d));
  }
  if (period === 'ultimos_6_meses') {
    return [0, -1, -2, -3, -4, -5].map(d => shiftMonth(atual.ano, atual.mes, d));
  }

  const parsed = parseMonthKey(period);
  if (parsed) return [parsed];

  // Fallback: mês atual real
  return [atual];
};

export const getPeriodLabel = (period: string) => {
  if (period === 'ultimos_3_meses') return 'Média - Safras Recentes';
  if (period === 'ultimos_6_meses') return 'Média - Semestre';

  const parsed = parseMonthKey(period);
  if (parsed) return getMonthShortLabel(parsed.ano, parsed.mes);

  const atual = getCurrentPeriodRef();
  return getMonthShortLabel(atual.ano, atual.mes);
};

// Período padrão ao carregar a tela: o mês imediatamente anterior ao atual
// (mês fechado mais recente, com dados completos).
export const getDefaultPeriod = () => {
  const atual = getCurrentPeriodRef();
  return buildMonthKey(atual.ano, atual.mes);
};

// Gera as opções do seletor de período dinamicamente: mês atual + 5 meses
// anteriores, mais as médias agregadas. Nada fixo — recalculado a cada render.
export const getPeriodOptions = () => {
  const atual = getCurrentPeriodRef();
  const opcoes: { value: string; label: string }[] = [];

  for (let d = 0; d >= -5; d--) {
    const { ano, mes } = shiftMonth(atual.ano, atual.mes, d);
    const nomeCompleto = `${NOMES_MES_COMPLETO[mes - 1]}/${ano}`;
    opcoes.push({
      value: buildMonthKey(ano, mes),
      label: d === 0 ? `${nomeCompleto} (Mês Atual)` : nomeCompleto
    });
  }

  opcoes.push({ value: 'ultimos_3_meses', label: 'Últimos 3 meses (Média)' });
  opcoes.push({ value: 'ultimos_6_meses', label: 'Últimos 6 meses (Média)' });

  return opcoes;
};

