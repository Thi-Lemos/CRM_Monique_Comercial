import { supabase } from '../supabaseClient';
import { Parceiro, ProducaoMensal, CrmLog, SemafaroStatus, TaskItem, CriteriosConfig, ProducaoSemanal } from '../types';
import { initialParceiros, initialProducao, initialLogs } from './mockData';
import { calculateScoreAndClassification } from './scoreCalculator';

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
    farmer_concentracao_minima: 30
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
  uptoMes: number
): StatusTimelineEntry[] {
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
    status = 'Onboarding';
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
          const monthEndDate = new Date(curAno, curMes, 0);
          const diasDesdeCriacao = (monthEndDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
          if (hasProd) {
            status = 'Ativo';
          } else if (diasDesdeCriacao > limites.dias_conversao_hunter) {
            status = 'Inativo';
          }
          break;
        }
        case 'Ativo': {
          if (lastProdMonth) {
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
  refMes: number
): Parceiro['status'] {
  const timeline = computeStatusTimeline(createdAt, parceiroProds, limites, refAno, refMes);
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
          return data.config as CriteriosConfig;
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
    return JSON.parse(local);
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
    const fmtCur = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
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

      const statusCalculado = computeStatusAtMonth(p.created_at, prods, diasLimites, refAgora.ano, refAgora.mes);

      if (p.status !== statusCalculado) {
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

  // --- PRODUÇÃO ---
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

  // --- SEMÁFORO & METAS ---
  async getSemafaroStatus(preloadedParceiros?: Parceiro[], preloadedLogs?: CrmLog[]): Promise<SemafaroStatus> {
    const parceiros = preloadedParceiros || await this.getParceiros();
    const config = await this.getCriterios();
    
    // Farmer: propostas pagas na semana de toda a carteira ativa comparado à meta
    const ativos = parceiros.filter(p => p.status === 'Ativo');
    const propostasPagasTotal = ativos.reduce((sum, p) => sum + (p.propostas_pagas_semana || 0), 0);
    
    // Hunter: contagem de ativações/reativações nos últimos 7 dias
    const logs = preloadedLogs || await this.getLogs();
    const hoje = new Date();
    const umaSemanaAtras = new Date(hoje.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    let novosAtivosSemana = 0;
    let reativadosSemana = 0;
    
    logs.forEach(log => {
      const dataLog = new Date(log.data_contato);
      if (dataLog >= umaSemanaAtras) {
        if (log.resumo && log.resumo.includes('Ativação automática')) {
          novosAtivosSemana++;
        }
        if (log.resumo && log.resumo.includes('Reativação automática')) {
          reativadosSemana++;
        }
      }
    });

    const metaFarmer = config.metas.farmer_propostas_pagas_semana;
    const metaHunterNovos = config.metas.hunter_novos_ativos_semana;
    const metaHunterReativados = config.metas.hunter_reativacoes_semana;

    const farmerStatus = (propostasPagasTotal >= metaFarmer) ? 'Verde' : 'Vermelho';
    const hunterStatus = (novosAtivosSemana >= metaHunterNovos || reativadosSemana >= metaHunterReativados) ? 'Verde' : 'Vermelho';
    
    let hunterAcao = '';
    let farmerAcao = '';
    let statusGeral = '';

    if (hunterStatus === 'Verde' && farmerStatus === 'Verde') {
      statusGeral = 'Meta Atingida!';
      hunterAcao = `Ritmo excelente! Conseguiu ${novosAtivosSemana} ativações e ${reativadosSemana} reativações nesta semana (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Parceiros saudáveis. Produção semanal de ${propostasPagasTotal} propostas superou a meta de ${metaFarmer}.`;
    } else if (hunterStatus === 'Verde' && farmerStatus === 'Vermelho') {
      statusGeral = 'Prospecção Forte, Carteira com Baixo Volume';
      hunterAcao = `Novas contas ativadas/reativadas (${novosAtivosSemana} ativações, ${reativadosSemana} reativações).`;
      farmerAcao = `Alerta! Produção semanal de ${propostasPagasTotal} propostas ficou abaixo da meta de ${metaFarmer}. Estimular parceiros da carteira Farmer.`;
    } else if (hunterStatus === 'Vermelho' && farmerStatus === 'Verde') {
      statusGeral = 'Carteira Saudável, Prospecção Lenta';
      hunterAcao = `Necessário foco em ativação. Apenas ${novosAtivosSemana} ativações e ${reativadosSemana} reativações na semana (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Farmer saudável. Excelente engajamento com ${propostasPagasTotal} propostas na semana (meta: ${metaFarmer}).`;
    } else {
      statusGeral = 'Semana Crítica';
      hunterAcao = `Urgente! Aumentar prospecção. Apenas ${novosAtivosSemana} ativações e ${reativadosSemana} reativações (meta: ${metaHunterNovos}/${metaHunterReativados}).`;
      farmerAcao = `Atenção total! Produção semanal de ${propostasPagasTotal} propostas está abaixo da meta de ${metaFarmer}. Ação de engajamento Farmer emergencial necessária.`;
    }

    return {
      hunter: hunterStatus,
      farmer: farmerStatus,
      hunterAcao,
      farmerAcao,
      statusGeral
    };
  },

  // --- COMPROMISSOS/CALENDÁRIO ---
  async getTasks(): Promise<TaskItem[]> {
    const logs = await this.getLogs();
    const parceiros = await this.getParceiros();
    const tasks: TaskItem[] = [];
    
    // Cada log que possui próxima ação gera uma tarefa
    logs.forEach(log => {
      if (log.proxima_acao && log.data_proxima_acao) {
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

  async saveProducaoSemanal(prod: Partial<ProducaoSemanal>, overrideLast?: boolean): Promise<ProducaoSemanal> {
    const db = getLocalDB();
    const parceiroId = prod.parceiro_id!;
    const ano = prod.ano!;
    const mes = prod.mes!;
    
    let semana = prod.semana;
    
    if (!semana) {
      // Auto-incremento inteligente: buscar produções existentes e contar
      let existentes: ProducaoSemanal[] = [];
      if (supabase) {
        try {
          const { data } = await supabase
            .from('producoes_semanais')
            .select('*')
            .eq('parceiro_id', parceiroId)
            .eq('ano', ano)
            .eq('mes', mes);
          existentes = data || [];
        } catch (e) {
          existentes = (db.producoes_semanais || []).filter(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
        }
      } else {
        existentes = (db.producoes_semanais || []).filter(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes);
      }

      if (overrideLast && existentes.length > 0) {
        const sorted = [...existentes].sort((a, b) => b.semana - a.semana);
        semana = sorted[0].semana;
      } else {
        semana = existentes.length + 1;
        if (semana > 5) semana = 5;
      }
    }

    const vol_total = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);
    const item: ProducaoSemanal = {
      ...prod,
      semana,
      vol_total,
      propostas_pagas: prod.propostas_pagas || 0,
      created_at: prod.created_at || new Date().toISOString()
    } as ProducaoSemanal;

    // Atualizar propostas pagas na semana diretamente no Parceiro para alimentar o Semáforo
    if (supabase) {
      try {
        await supabase
          .from('parceiros')
          .update({ propostas_pagas_semana: item.propostas_pagas })
          .eq('id', parceiroId);
      } catch (e) {
        console.warn('Erro ao atualizar propostas_pagas_semana no Supabase, usando local:', e);
      }
    } else {
      const pIdx = db.parceiros.findIndex(p => p.id === parceiroId);
      if (pIdx !== -1) {
        db.parceiros[pIdx].propostas_pagas_semana = item.propostas_pagas;
        saveLocalDB(db);
      }
    }

    if (supabase) {
      try {
        let result;
        const { data: check } = await supabase
          .from('producoes_semanais')
          .select('id')
          .eq('parceiro_id', parceiroId)
          .eq('ano', ano)
          .eq('mes', mes)
          .eq('semana', semana)
          .maybeSingle();

        if (check?.id) {
          const { data, error } = await supabase
            .from('producoes_semanais')
            .update(item)
            .eq('id', check.id)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          const { data, error } = await supabase
            .from('producoes_semanais')
            .insert([item])
            .select()
            .single();
          if (error) throw error;
          result = data;
        }
        
        await this.consolidateMensal(parceiroId, ano, mes);
        return result as ProducaoSemanal;
      } catch (err) {
        console.warn('Erro ao salvar semana no Supabase, usando local:', err);
      }
    }

    const updatedDb = getLocalDB();
    if (!updatedDb.producoes_semanais) updatedDb.producoes_semanais = [];
    const idx = updatedDb.producoes_semanais.findIndex(p => p.parceiro_id === parceiroId && p.ano === ano && p.mes === mes && p.semana === semana);
    
    if (idx !== -1) {
      updatedDb.producoes_semanais[idx] = { ...updatedDb.producoes_semanais[idx], ...item };
    } else {
      const newItem = {
        ...item,
        id: 'prod_sem_' + Math.random().toString(36).substr(2, 9)
      };
      updatedDb.producoes_semanais.push(newItem);
    }
    saveLocalDB(updatedDb);

    await this.consolidateMensal(parceiroId, ano, mes);
    return item;
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

        // Calcular volume do parceiro específico no período selecionado (média mensal do período)
        let volAcumuladoPeriodo = 0;
        activeMonths.forEach(m => {
          const matchProd = prods.find(pr => pr.ano === m.ano && pr.mes === m.mes);
          if (matchProd) {
            volAcumuladoPeriodo += (matchProd.vol_fgts || 0) + (matchProd.vol_clt || 0) + (matchProd.vol_cgv || 0) + (matchProd.vol_pix || 0);
          }
        });
        const volPrataMensalPeriodo = volAcumuladoPeriodo / numMonths;

        return {
          ...p,
          status: statusCalculado,
          vol_prata_mensal: volPrataMensalPeriodo,
          vol_total_mensal: (p.vol_total_mensal || 0) > 0 ? Math.max(p.vol_total_mensal, volPrataMensalPeriodo) : 0
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
  const anterior = shiftMonth(atual.ano, atual.mes, -1);
  return buildMonthKey(anterior.ano, anterior.mes);
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

