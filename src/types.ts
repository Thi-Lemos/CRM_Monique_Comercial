import { WeekInfo } from './utils/weekUtils';

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
  vol_total_mercado: number;
  vol_prata_mensal: number;
  concorrentes?: string;
  descricao?: string;
  status: 'Ativo' | 'Onboarding' | 'Inativo' | 'Reativado';
  score_comercial: number; // 0 - 100
  classificacao: 'Estratégico' | 'Crescimento' | 'Desenvolvimento';
  propostas_pagas_semana?: number;
  created_at?: string;
  updated_at?: string;
  vol_total_detalhes?: {
    mes1: string;
    valor1: number;
    mes2: string;
    valor2: number;
    mes3: string;
    valor3: number;
  };
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
  created_at?: string;
}

export interface CrmLog {
  id?: string;
  parceiro_id: string;
  data_contato: string;
  canal: 'WhatsApp' | 'Ligação' | 'Reunião' | 'E-mail';
  processo: 'Farmer' | 'Win-back' | 'Hunter';
  resumo: string; // máx 500 caracteres
  proxima_acao?: string | null;
  data_proxima_acao?: string | null;
  classificacao_pos_contato: 'Estratégico' | 'Crescimento' | 'Desenvolvimento';
  crm_atualizado: boolean;
  score_no_momento?: number;
  origem?: 'manual' | 'sistema'; // 'sistema' = gerado automaticamente por transição de status; 'manual' = registrado pela Monique

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

export interface EventoSemana {
  id?: string;
  semana_inicio: string;   // YYYY-MM-DD — domingo
  semana_fim: string;      // YYYY-MM-DD — sábado
  ano: number;
  mes: number;
  semana_num: number;
  tipo: 'ativacao' | 'reativacao';
  parceiro_id: string;
  origem: 'crm_direto' | 'planilha';
  created_at?: string;
  // Campo enriquecido em memória (não persiste no banco)
  parceiro_nome?: string;
}

export interface SemafaroStatus {
  hunter: 'Verde' | 'Vermelho';
  farmer: 'Verde' | 'Vermelho';
  hunterAcao: string;
  farmerAcao: string;
  statusGeral: string;
  // Campos novos — semana civil
  hunterAtivacoes: EventoSemana[];
  hunterReativacoes: EventoSemana[];
  farmerPropostasSemana: number;
  semanaInfo: WeekInfo;
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
    meta_taxa_ativos: number;
    meta_churn: number;
    meta_media_produtos: number;
    meta_taxa_reativacao: number;
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
  // Limiares de score para as classificacoes
  score_thresholds: {
    estrategico: number;
    crescimento: number;
  };
  // Faixas de pontuacao para criterios numericos continuos (N1, N2, N3)
  score_notas: {
    vol_total_faixas: [number, number, number, number];
    concentracao_faixas: [number, number, number, number];
    vendedores_faixas: [number, number, number, number];
  };
}

export interface ProducaoSemanal {
  id?: string;
  parceiro_id: string;
  ano: number;
  mes: number;
  semana: number;           // número ordinal dentro do mês (1-5)
  semana_inicio?: string;   // YYYY-MM-DD — domingo (fonte de verdade para deduplicação)
  vol_fgts: number;
  vol_clt: number;
  vol_cgv: number;
  vol_pix: number;
  vol_total?: number;       // Calculado
  propostas_pagas: number;
  origem_entrada?: 'planilha' | 'manual';
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
