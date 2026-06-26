import { Parceiro, ProducaoMensal, CrmLog } from '../types';

export const initialParceiros: Parceiro[] = [
  {
    id: "p1",
    nome: "Silva & Cia Promotora",
    cnpj: "12.345.678/0001-90",
    contato_principal: "Carlos Silva",
    email: "carlos@silvacia.com.br",
    modelo_atuacao: "Híbrido",
    area_geografica: "Estadual",
    num_vendedores: 5,
    produtos_ativos: ["FGTS", "CLT"],
    vol_total_mensal: 180000,
    vol_prata_mensal: 40000,
    concorrentes: "Facta, V8",
    status: "Ativo",
    score_comercial: 59,
    classificacao: "Crescimento"
  },
  {
    id: "p2",
    nome: "MaxCrédito Corban",
    cnpj: "23.456.789/0001-01",
    contato_principal: "Ana Paula",
    email: "ana@maxcredito.com.br",
    modelo_atuacao: "Digital",
    area_geografica: "Nacional",
    num_vendedores: 12,
    produtos_ativos: ["FGTS", "CLT", "CGV", "Pix"],
    vol_total_mensal: 300000,
    vol_prata_mensal: 165000,
    concorrentes: "Fintech Y, Banco X",
    status: "Ativo",
    score_comercial: 97.5,
    classificacao: "Estratégico"
  },
  {
    id: "p3",
    nome: "Crédito Rápido Ltda",
    cnpj: "34.567.890/0001-12",
    contato_principal: "Roberto Lima",
    email: "roberto@creditorapido.com.br",
    modelo_atuacao: "Físico",
    area_geografica: "Local",
    num_vendedores: 3,
    produtos_ativos: ["FGTS"],
    vol_total_mensal: 50000,
    vol_prata_mensal: 0,
    concorrentes: "Novo Saque, Hub",
    status: "Reativação",
    score_comercial: 25.5,
    classificacao: "Desenvolvimento"
  },
  {
    id: "p4",
    nome: "Empreend. Financeiros",
    cnpj: "45.678.901/0001-23",
    contato_principal: "Fernanda Costa",
    email: "fernanda@empfinanceiros.com.br",
    modelo_atuacao: "Híbrido",
    area_geografica: "Regional",
    num_vendedores: 6,
    produtos_ativos: ["FGTS", "CLT"],
    vol_total_mensal: 220000,
    vol_prata_mensal: 44000,
    concorrentes: "Facta, Icred",
    status: "Ativo",
    score_comercial: 57.5,
    classificacao: "Crescimento"
  },
  {
    id: "p5",
    nome: "Promotora Norte Sul",
    cnpj: "56.789.012/0001-34",
    contato_principal: "João Melo",
    email: "joao@nortesul.com.br",
    modelo_atuacao: "Pastinhas",
    area_geografica: "Regional",
    num_vendedores: 4,
    produtos_ativos: ["CLT"],
    vol_total_mensal: 80000,
    vol_prata_mensal: 16000,
    concorrentes: "V8, VcTech",
    status: "Ativo",
    score_comercial: 41,
    classificacao: "Crescimento"
  },
  {
    id: "p6",
    nome: "CredFácil Corban",
    cnpj: "67.890.123/0001-45",
    contato_principal: "Marina Souza",
    email: "marina@credfacil.com.br",
    modelo_atuacao: "Digital",
    area_geografica: "Nacional",
    num_vendedores: 15,
    produtos_ativos: ["FGTS", "CLT", "Pix"],
    vol_total_mensal: 400000,
    vol_prata_mensal: 80000,
    concorrentes: "GranaTech, Lotús",
    status: "Ativo",
    score_comercial: 81.5,
    classificacao: "Estratégico"
  },
  {
    id: "p7",
    nome: "Finança Ativa Promotora",
    cnpj: "78.901.234/0001-56",
    contato_principal: "Pedro Alves",
    email: "pedro@financaativa.com.br",
    modelo_atuacao: "Físico",
    area_geografica: "Local",
    num_vendedores: 2,
    produtos_ativos: ["FGTS"],
    vol_total_mensal: 30000,
    vol_prata_mensal: 9000,
    concorrentes: "Happy, Nossa Fintech",
    status: "Ativo",
    score_comercial: 28.5,
    classificacao: "Desenvolvimento"
  },
  {
    id: "p8",
    nome: "Corban Sul Invest",
    cnpj: "89.012.345/0001-67",
    contato_principal: "Lucia Barros",
    email: "lucia@sulinvest.com.br",
    modelo_atuacao: "Híbrido",
    area_geografica: "Estadual",
    num_vendedores: 8,
    produtos_ativos: ["FGTS", "CLT", "CGV"],
    vol_total_mensal: 160000,
    vol_prata_mensal: 48000,
    concorrentes: "Unno, Icred",
    status: "Ativo",
    score_comercial: 65,
    classificacao: "Crescimento"
  }
];

export const initialProducao: ProducaoMensal[] = [
  // Silva & Cia
  { parceiro_id: "p1", ano: 2026, mes: 1, vol_fgts: 18000, vol_clt: 20000, vol_cgv: 0, vol_pix: 2000 },
  { parceiro_id: "p1", ano: 2026, mes: 2, vol_fgts: 17000, vol_clt: 21000, vol_cgv: 0, vol_pix: 2000 },
  { parceiro_id: "p1", ano: 2026, mes: 3, vol_fgts: 19000, vol_clt: 22000, vol_cgv: 0, vol_pix: 1500 },
  { parceiro_id: "p1", ano: 2026, mes: 4, vol_fgts: 20000, vol_clt: 18000, vol_cgv: 0, vol_pix: 2000 },
  { parceiro_id: "p1", ano: 2026, mes: 5, vol_fgts: 21000, vol_clt: 19000, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p1", ano: 2026, mes: 6, vol_fgts: 22000, vol_clt: 18000, vol_cgv: 0, vol_pix: 0 },

  // MaxCrédito Corban
  { parceiro_id: "p2", ano: 2026, mes: 1, vol_fgts: 80000, vol_clt: 70000, vol_cgv: 10000, vol_pix: 5000 },
  { parceiro_id: "p2", ano: 2026, mes: 2, vol_fgts: 82000, vol_clt: 71000, vol_cgv: 10000, vol_pix: 5000 },
  { parceiro_id: "p2", ano: 2026, mes: 3, vol_fgts: 85000, vol_clt: 69000, vol_cgv: 12000, vol_pix: 4000 },
  { parceiro_id: "p2", ano: 2026, mes: 4, vol_fgts: 80000, vol_clt: 75000, vol_cgv: 10000, vol_pix: 5000 },
  { parceiro_id: "p2", ano: 2026, mes: 5, vol_fgts: 83000, vol_clt: 72000, vol_cgv: 11000, vol_pix: 6000 },
  { parceiro_id: "p2", ano: 2026, mes: 6, vol_fgts: 85000, vol_clt: 70000, vol_cgv: 12000, vol_pix: 5000 },

  // Crédito Rápido (Zerado há 60+ dias, Reativação)
  { parceiro_id: "p3", ano: 2026, mes: 1, vol_fgts: 12000, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p3", ano: 2026, mes: 2, vol_fgts: 8000, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p3", ano: 2026, mes: 3, vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p3", ano: 2026, mes: 4, vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p3", ano: 2026, mes: 5, vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p3", ano: 2026, mes: 6, vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },

  // Empreend. Financeiros
  { parceiro_id: "p4", ano: 2026, mes: 5, vol_fgts: 22000, vol_clt: 20000, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p4", ano: 2026, mes: 6, vol_fgts: 24000, vol_clt: 20000, vol_cgv: 0, vol_pix: 0 },

  // Promotora Norte Sul
  { parceiro_id: "p5", ano: 2026, mes: 5, vol_fgts: 0, vol_clt: 18000, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p5", ano: 2026, mes: 6, vol_fgts: 0, vol_clt: 16000, vol_cgv: 0, vol_pix: 0 },

  // CredFácil Corban
  { parceiro_id: "p6", ano: 2026, mes: 5, vol_fgts: 40000, vol_clt: 35000, vol_cgv: 0, vol_pix: 5000 },
  { parceiro_id: "p6", ano: 2026, mes: 6, vol_fgts: 42000, vol_clt: 33000, vol_cgv: 0, vol_pix: 5000 },

  // Finança Ativa Promotora
  { parceiro_id: "p7", ano: 2026, mes: 5, vol_fgts: 8000, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },
  { parceiro_id: "p7", ano: 2026, mes: 6, vol_fgts: 9000, vol_clt: 0, vol_cgv: 0, vol_pix: 0 },

  // Corban Sul Invest
  { parceiro_id: "p8", ano: 2026, mes: 5, vol_fgts: 25000, vol_clt: 20000, vol_cgv: 3000, vol_pix: 0 },
  { parceiro_id: "p8", ano: 2026, mes: 6, vol_fgts: 26000, vol_clt: 19000, vol_cgv: 3000, vol_pix: 0 }
];

export const initialLogs: CrmLog[] = [
  {
    parceiro_id: "p1",
    data_contato: "2026-06-10T14:30:00Z",
    canal: "WhatsApp",
    processo: "Farmer",
    resumo: "Diagnóstico de concentração — parceiro quer testar CGV para diversificar carteira e aumentar cashback.",
    proxima_acao: "Enviar proposta CGV",
    data_proxima_acao: "2026-06-12",
    classificacao_pos_contato: "Crescimento",
    crm_atualizado: true,
    score_no_momento: 55,
    diagnostico_causa: "Operacional / Expansão",
    diagnostico_dor: "Falta de outros produtos ativos na carteira comercial",
    diagnostico_motivador: "Cashback + diversificação de produtos",
    diagnostico_concorrentes: "Facta, V8",
    diagnostico_interesse: "CGV",
    diagnostico_objecao: "Nenhuma objeção comercial no momento",
    diagnostico_gargalo: "Treinamento da equipe de vendas em CGV",
    passos_acao_parceiro: "Confirmar quantidade de operadores que farão o treinamento",
    passos_acao_interna: "Criar material e roteiro de apoio para CGV"
  },
  {
    parceiro_id: "p2",
    data_contato: "2026-06-08T10:00:00Z",
    canal: "Reunião",
    processo: "Farmer",
    resumo: "Revisão mensal de produção — volumes dentro do planejado e com alta concentração (55%).",
    proxima_acao: "Manter cadência semanal",
    data_proxima_acao: "2026-06-15",
    classificacao_pos_contato: "Estratégico",
    crm_atualizado: true,
    score_no_momento: 97.5
  },
  {
    parceiro_id: "p3",
    data_contato: "2026-06-05T16:00:00Z",
    canal: "Ligação",
    processo: "Win-back",
    resumo: "Parceiro em reativação há 60+ dias. Diagnóstico de inatividade: migrou operações para concorrentes devido a comissão.",
    proxima_acao: "Apresentar cashback do Prata + diferencial Pix no Cartão",
    data_proxima_acao: "2026-06-07",
    classificacao_pos_contato: "Desenvolvimento",
    crm_atualizado: true,
    score_no_momento: 25.5,
    diagnostico_causa: "Opera com concorrente (comissão maior)",
    diagnostico_dor: "Baixa taxa de aprovação no CLT da concorrência",
    diagnostico_motivador: "Comissão / Cashback",
    diagnostico_concorrentes: "Novo Saque, Hub",
    diagnostico_interesse: "FGTS BMS (Tabela Golaço) + Pix no Cartão",
    diagnostico_objecao: "Exigência de volume mínimo para cashback",
    diagnostico_gargalo: "Falta de integração via API",
    passos_acao_parceiro: "Analisar proposta de cashback progressivo",
    passos_acao_interna: "Solicitar liberação da tabela Golaço para o parceiro"
  },
  {
    parceiro_id: "p4",
    data_contato: "2026-06-03T11:00:00Z",
    canal: "WhatsApp",
    processo: "Farmer",
    resumo: "Parceiro interessado em adicionar CGV à operação atual. Atualmente só opera FGTS/CLT.",
    proxima_acao: "Agendar treinamento CGV",
    data_proxima_acao: "2026-06-10",
    classificacao_pos_contato: "Crescimento",
    crm_atualizado: true
  },
  {
    parceiro_id: "p5",
    data_contato: "2026-06-01T09:30:00Z",
    canal: "Ligação",
    processo: "Farmer",
    resumo: "Volume de produção estável, mas concentração no Prata muito baixa (20%). Risco de perda silenciosa.",
    proxima_acao: "Propor inclusão do produto FGTS BMS (tabela Golaço)",
    data_proxima_acao: "2026-06-08",
    classificacao_pos_contato: "Crescimento",
    crm_atualizado: true
  },
  {
    parceiro_id: "p6",
    data_contato: "2026-05-28T15:00:00Z",
    canal: "Reunião",
    processo: "Farmer",
    resumo: "Alto volume de mercado, mas concentração em apenas 20%. Grande oportunidade captável.",
    proxima_acao: "Propor estrutura de metas com cashback progressivo",
    data_proxima_acao: "2026-06-04",
    classificacao_pos_contato: "Crescimento",
    crm_atualizado: true
  },
  {
    parceiro_id: "p7",
    data_contato: "2026-05-25T11:30:00Z",
    canal: "WhatsApp",
    processo: "Farmer",
    resumo: "Parceiro de menor porte, opera apenas FGTS física local. Quer conhecer novas opções.",
    proxima_acao: "Apresentar Pix no Cartão como 2º produto",
    data_proxima_acao: "2026-06-02",
    classificacao_pos_contato: "Desenvolvimento",
    crm_atualizado: true
  },
  {
    parceiro_id: "p8",
    data_contato: "2026-05-20T10:00:00Z",
    canal: "Ligação",
    processo: "Farmer",
    resumo: "Resultado positivo na operação do produto CGV. Quer ampliar o leque.",
    proxima_acao: "Apresentar Pix no Cartão como 4º produto",
    data_proxima_acao: "2026-05-27",
    classificacao_pos_contato: "Estratégico",
    crm_atualizado: true
  }
];
