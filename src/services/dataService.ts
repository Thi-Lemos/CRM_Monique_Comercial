import { supabase } from '../supabaseClient';
import { Parceiro, ProducaoMensal, CrmLog, SemafaroStatus, TaskItem, CriteriosConfig, ProducaoSemanal } from '../types';
import { initialParceiros, initialProducao, initialLogs } from './mockData';
import { calculateScoreAndClassification } from './scoreCalculator';

const LOCAL_STORAGE_KEY = 'crm_prata_digital_db';
const LOCAL_CRITERIOS_KEY = 'crm_prata_digital_criterios';

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
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('parceiros')
          .select('*')
          .order('nome', { ascending: true });
        
        if (!error && data) {
          list = data as Parceiro[];
        }
      } catch (err) {
        console.warn('Falha ao conectar no Supabase, usando banco local:', err);
      }
    }
    if (list.length === 0) {
      list = getLocalDB().parceiros;
    }

    const config = await this.getCriterios();
    
    // Otimização N+1: Carregar todas as produções em lote em uma única consulta
    let allProds: ProducaoMensal[] = [];
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producao')
          .select('*');
        if (!error && data) {
          allProds = data as ProducaoMensal[];
        }
      } catch (err) {
        console.warn('Erro ao obter todas as produções do Supabase, usando local:', err);
      }
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

    for (let p of list) {
      p.propostas_pagas_semana = p.propostas_pagas_semana !== undefined && p.propostas_pagas_semana !== null ? p.propostas_pagas_semana : 0;
      
      // Otimização: Ler do mapa em memória ao invés de bater no banco para cada parceiro
      const prods = prodsMap[p.id] || [];
      const diasLimites = config.limites;
      const hoje = new Date();
      const dataCriacao = p.created_at ? new Date(p.created_at) : hoje;
      const diferencaCriacaoDias = (hoje.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24);

      const sortedProds = [...prods].sort((a, b) => (b.ano !== a.ano ? b.ano - a.ano : b.mes - a.mes));
      const ultimaProd = sortedProds[0];
      
      let statusCalculado: Parceiro['status'] = 'Onboarding';
      let temProducaoRecente = false;

      if (ultimaProd) {
        const volTotalUltimo = (ultimaProd.vol_fgts || 0) + (ultimaProd.vol_clt || 0) + (ultimaProd.vol_cgv || 0) + (ultimaProd.vol_pix || 0);
        if (volTotalUltimo > 0) {
          temProducaoRecente = true;
          const dataUltimaProd = new Date(ultimaProd.ano, ultimaProd.mes - 1, 28);
          const diasSemProd = (hoje.getTime() - dataUltimaProd.getTime()) / (1000 * 60 * 60 * 24);

          if (diasSemProd > diasLimites.dias_inatividade_winback) {
            statusCalculado = 'Reativação';
          } else {
            statusCalculado = 'Ativo';
          }
        }
      }

      if (!temProducaoRecente) {
        if (diferencaCriacaoDias <= diasLimites.dias_conversao_hunter) {
          statusCalculado = 'Onboarding';
        } else {
          statusCalculado = 'Reativação';
        }
      }

      if (p.status !== statusCalculado) {
        const statusAnterior = p.status;
        p.status = statusCalculado;

        if (statusCalculado === 'Ativo') {
          const processo = statusAnterior === 'Onboarding' ? 'Hunter' : 'Win-back';
          const resumo = statusAnterior === 'Onboarding'
            ? `Ativação automática: Novo parceiro ativado após registrar produção ativa de ${fmtCur(p.vol_prata_mensal)}.`
            : `Reativação automática: Parceiro reativado após registrar nova produção de ${fmtCur(p.vol_prata_mensal)}.`;

          this.saveLog({
            parceiro_id: p.id,
            data_contato: new Date().toISOString(),
            canal: 'WhatsApp',
            processo: (processo === 'Win-back' ? 'Win-back' : processo === 'Hunter' ? 'Hunter' : 'Farmer'),
            resumo,
            proxima_acao: 'Acompanhar produção e estreitar contato',
            data_proxima_acao: new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
            classificacao_pos_contato: p.classificacao,
            crm_atualizado: true
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
          const { data, error } = await supabase
            .from('parceiros')
            .insert([insertData])
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
      created_at: new Date().toISOString()
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
      // Usar a produção consolidada de referência de Maio de 2026 (mês anterior completo)
      const partnerProds = db.producao.filter(pr => pr.parceiro_id === prod.parceiro_id);
      const consolidado = partnerProds.find(pr => pr.ano === 2026 && pr.mes === 5);
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
    // Pega a produção consolidada de referência de Maio de 2026 (mês anterior completo)
    const { data: prods } = await supabase
      .from('producao')
      .select('*')
      .eq('parceiro_id', parceiroId)
      .eq('ano', 2026)
      .eq('mes', 5)
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
        let query = supabase.from('crm_logs').select('*');
        if (parceiroId) {
          query = query.eq('parceiro_id', parceiroId);
        }
        const { data, error } = await query.order('data_contato', { ascending: false });
        if (error) throw error;
        return data as CrmLog[];
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
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('producao')
          .select('*');
        if (!error && data) {
          return data as ProducaoMensal[];
        }
      } catch (err) {
        console.warn('Erro ao obter todas as produções do Supabase:', err);
      }
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

  async getCicloAtivacaoHunter(preloadedParceiros?: Parceiro[], preloadedProducoes?: ProducaoMensal[]): Promise<number> {
    const parceiros = preloadedParceiros || await this.getParceiros();
    let totalDias = 0;
    let totalContasAtivas = 0;

    // Criar mapa de produções por parceiro para evitar consultas repetidas
    const prodsMap: { [key: string]: ProducaoMensal[] } = {};
    if (preloadedProducoes) {
      for (const pr of preloadedProducoes) {
        if (!prodsMap[pr.parceiro_id]) {
          prodsMap[pr.parceiro_id] = [];
        }
        prodsMap[pr.parceiro_id].push(pr);
      }
    }

    for (const p of parceiros) {
      const producoes = preloadedProducoes ? (prodsMap[p.id] || []) : await this.getProducao(p.id);
      const comProd = producoes.filter(pr => ((pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0)) > 0);
      
      if (comProd.length > 0) {
        const sortedProd = [...comProd].sort((a,b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
        const primeiraProd = sortedProd[0];
        
        const dataPrimeiraProd = new Date(primeiraProd.ano, primeiraProd.mes - 1, 15);
        const dataCriacao = p.created_at ? new Date(p.created_at) : new Date(2026, 4, 1);
        
        const diffTempo = dataPrimeiraProd.getTime() - dataCriacao.getTime();
        const diffDias = Math.max(1, Math.round(diffTempo / (1000 * 60 * 60 * 24)));
        
        totalDias += diffDias;
        totalContasAtivas++;
      }
    }

    if (totalContasAtivas === 0) return 6;
    return Math.round(totalDias / totalContasAtivas);
  },

  async getTaxaReativacao(preloadedParceiros?: Parceiro[], preloadedLogs?: CrmLog[]): Promise<number> {
    const logs = preloadedLogs || await this.getLogs();
    const parceiros = preloadedParceiros || await this.getParceiros();
    
    const winbackPartners = new Set<string>();
    logs.forEach(log => {
      if (log.processo === 'Win-back') {
        winbackPartners.add(log.parceiro_id);
      }
    });

    if (winbackPartners.size === 0) return 25.0;

    let reativados = 0;
    winbackPartners.forEach(pId => {
      const partner = parceiros.find(p => p.id === pId);
      if (partner && partner.status === 'Ativo') {
        reativados++;
      }
    });

    return Math.round((reativados / winbackPartners.size) * 1000) / 10;
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

    // Último dia do mês de referência
    const refDate = new Date(refAno, refMes, 0);

    // Mapear produções por parceiro
    const prodsMap: Record<string, ProducaoMensal[]> = {};
    allProducoes.forEach(prod => {
      if (!prodsMap[prod.parceiro_id]) {
        prodsMap[prod.parceiro_id] = [];
      }
      prodsMap[prod.parceiro_id].push(prod);
    });

    const limites = limitesConfig || { dias_inatividade_winback: 60, dias_conversao_hunter: 7 };

    return parceiros
      .filter(p => {
        const createdDate = p.created_at ? new Date(p.created_at) : new Date(2026, 4, 1);
        return createdDate.getTime() <= refDate.getTime();
      })
      .map(p => {
        const createdDate = p.created_at ? new Date(p.created_at) : new Date(2026, 4, 1);
        const diffCriacaoTempo = refDate.getTime() - createdDate.getTime();
        const diferencaCriacaoDias = diffCriacaoTempo / (1000 * 60 * 60 * 24);

        const prods = prodsMap[p.id] || [];

        // Apenas produções anteriores ou iguais à referência
        const sortedProdsValidos = prods
          .filter(pr => (pr.ano < refAno) || (pr.ano === refAno && pr.mes <= refMes))
          .sort((a, b) => (b.ano !== a.ano ? b.ano - a.ano : b.mes - a.mes));

        // Achar a produção mais recente que tenha volume > 0
        let statusCalculado: Parceiro['status'] = 'Onboarding';
        let temProducaoRecente = false;

        // Calcular volume do parceiro específico no período selecionado (média mensal do período)
        let volAcumuladoPeriodo = 0;
        const numMonths = activeMonths.length;
        activeMonths.forEach(m => {
          const matchProd = prods.find(pr => pr.ano === m.ano && pr.mes === m.mes);
          if (matchProd) {
            volAcumuladoPeriodo += (matchProd.vol_fgts || 0) + (matchProd.vol_clt || 0) + (matchProd.vol_cgv || 0) + (matchProd.vol_pix || 0);
          }
        });
        const volPrataMensalPeriodo = volAcumuladoPeriodo / numMonths;

        const ultimaProdValida = sortedProdsValidos.find(pr => {
          const vol = (pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0);
          return vol > 0;
        });

        if (ultimaProdValida) {
          temProducaoRecente = true;
          const dataProd = new Date(ultimaProdValida.ano, ultimaProdValida.mes, 0);
          const diasSemProd = (refDate.getTime() - dataProd.getTime()) / (1000 * 60 * 60 * 24);

          if (diasSemProd > limites.dias_inatividade_winback) {
            statusCalculado = 'Reativação';
          } else {
            statusCalculado = 'Ativo';
          }
        }

        if (!temProducaoRecente) {
          if (diferencaCriacaoDias <= limites.dias_conversao_hunter) {
            statusCalculado = 'Onboarding';
          } else {
            statusCalculado = 'Reativação';
          }
        }

        return {
          ...p,
          status: statusCalculado,
          vol_prata_mensal: volPrataMensalPeriodo
        };
      });
  }
};

export const getMonthsForPeriod = (period: string) => {
  switch (period) {
    case 'junho_2026':
      return [{ ano: 2026, mes: 6 }];
    case 'maio_2026':
      return [{ ano: 2026, mes: 5 }];
    case 'abril_2026':
      return [{ ano: 2026, mes: 4 }];
    case 'marco_2026':
      return [{ ano: 2026, mes: 3 }];
    case 'fevereiro_2026':
      return [{ ano: 2026, mes: 2 }];
    case 'janeiro_2026':
      return [{ ano: 2026, mes: 1 }];
    case 'ultimos_3_meses':
      return [
        { ano: 2026, mes: 6 },
        { ano: 2026, mes: 5 },
        { ano: 2026, mes: 4 }
      ];
    case 'ultimos_6_meses':
      return [
        { ano: 2026, mes: 6 },
        { ano: 2026, mes: 5 },
        { ano: 2026, mes: 4 },
        { ano: 2026, mes: 3 },
        { ano: 2026, mes: 2 },
        { ano: 2026, mes: 1 }
      ];
    default:
      return [{ ano: 2026, mes: 6 }];
  }
};

export const getPeriodLabel = (period: string) => {
  switch (period) {
    case 'junho_2026': return 'Jun/2026';
    case 'maio_2026': return 'Mai/2026';
    case 'abril_2026': return 'Abr/2026';
    case 'marco_2026': return 'Mar/2026';
    case 'fevereiro_2026': return 'Fev/2026';
    case 'janeiro_2026': return 'Jan/2026';
    case 'ultimos_3_meses': return 'Média - Safras Recentes';
    case 'ultimos_6_meses': return 'Média - Semestre';
    default: return 'Jun/2026';
  }
};

