export interface Parceiro {
  id: string;
  nome: string;
  cnpj: string;
  contato_principal: string;
  email?: string;
  modelo_atuacao: 'Físico' | 'Digital' | 'Pastinhas' | 'Híbrido';
  area_geografica: 'Local' | 'Regional' | 'Estadual' | 'Nacional';
  num_vendedores: number;
  produtos_ativos: string[]; // ex: ['FGTS', 'CLT']
  vol_total_mensal: number;
  vol_prata_mensal: number;
  concorrentes?: string;
  status: 'Ativo' | 'Onboarding' | 'Reativação';
  score_comercial: number; // 0 - 100
  classificacao: 'Estratégico' | 'Crescimento' | 'Desenvolvimento';
  propostas_pagas_semana?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProducaoMensal {
  id?: string;
  parceiro_id: string;
  ano: number;
  mes: number;
  vol_fgts: number;
  vol_clt: number;
  vol_cgv: number;
  vol_pix: number;
  vol_total?: number; // Calculado
  propostas_pagas?: number;
}

export interface CrmLog {
  id?: string;
  parceiro_id: string;
  data_contato: string;
  canal: 'WhatsApp' | 'Ligação' | 'Reunião' | 'E-mail';
  processo: 'Farmer' | 'Win-back' | 'Hunter';
  resumo: string; // máx 500 caracteres
  proxima_acao: string;
  data_proxima_acao: string;
  classificacao_pos_contato: 'Estratégico' | 'Crescimento' | 'Desenvolvimento';
  crm_atualizado: boolean;
  score_no_momento?: number;
  
  // Questionário Pós-Reunião (Módulo 5/Blocos 1, 2 e 3)
  diagnostico_causa?: string;
  diagnostico_dor?: string;
  diagnostico_motivador?: string;
  diagnostico_concorrentes?: string;
  diagnostico_interesse?: string;
  diagnostico_objecao?: string;
  diagnostico_gargalo?: string;
  passos_acao_parceiro?: string;
  passos_acao_interna?: string;
  created_at?: string;
}

export interface SemafaroStatus {
  hunter: 'Verde' | 'Vermelho';
  farmer: 'Verde' | 'Vermelho';
  hunterAcao: string;
  farmerAcao: string;
  statusGeral: string;
}

export interface TaskItem {
  id: string;
  title: string;
  date: string;
  done: boolean;
  parceiro_nome: string;
  parceiro_id: string;
  responsavel?: string;
}

export interface CriteriosConfig {
  metas: {
    hunter_novos_ativos_semana: number;
    hunter_reativacoes_semana: number;
    farmer_propostas_pagas_semana: number;
    farmer_concentracao_minima: number;
  };
  limites: {
    dias_inatividade_winback: number;
    dias_conversao_hunter: number;
  };
  pesos_score: {
    vol_total: number;
    concentracao: number;
    num_vendedores: number;
    area_geografica: number;
    produtos_ativos: number;
    modelo_atuacao: number;
    diversificacao: number;
  };
}

export interface ProducaoSemanal {
  id?: string;
  parceiro_id: string;
  ano: number;
  mes: number;
  semana: number; // 1 a 5
  vol_fgts: number;
  vol_clt: number;
  vol_cgv: number;
  vol_pix: number;
  vol_total?: number; // Calculado
  propostas_pagas: number;
  created_at?: string;
}

export interface CustomTask {
  id: string;
  title: string;
  dayOfWeek: 'Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta';
  done: boolean;
  isDynamic: boolean;
  parceiroId?: string;
}

